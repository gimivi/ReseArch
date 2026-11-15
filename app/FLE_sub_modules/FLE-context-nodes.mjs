// app/FLE_sub_modules/FLE-context-nodes.mjs
// Nodi di contesto (2026-10-04): caricano una libreria esterna e le danno un NOME di
// contesto, che gli altri nodi usano senza fili — prima realizzazione di
// _doc/arch-nodi-utente.md §7.3 e §8 (là chiamato "Lib/Load").
//
//   ReseArch/Context/Library List — sceglie una libreria dal catalogo del server
//                                   (lib/libraries.json) e ne fornisce il riferimento
//   ReseArch/Context/Library      — carica una libreria (dal riferimento collegato oppure da
//                                   url/mode/global/init scritti a mano), la inizializza e la
//                                   registra in graph._fleContexts[name] come Promise
//   ReseArch/Context/Call         — chiama una funzione / crea un oggetto / legge un valore
//                                   della libreria di un contesto
//   ReseArch/Context/Method       — chiama un metodo / legge una proprietà di un oggetto
//
// Uso da un altro nodo: un widget "context" con il nome, poi
//   const lib = await fleUseContext(this, this.properties.context);
// Il nodo aspetta che la libreria sia pronta: non serve un ordine di avvio particolare
// (versione semplice, senza il caricamento anticipato fleStartGraph() degli appunti).
//
// Sicurezza: Library carica ed esegue codice da un URL, quindi è un NODO CRITICO
// (FV_CRITICAL_TYPES in api/flow_validation.php): un flow che lo usa gira per gli altri
// utenti solo dopo la validazione. Call e Method raggiungono solo ciò che una Library ha
// caricato e rifiutano i percorsi che porterebbero a Function (constructor, __proto__,
// prototype): niente esecuzione di codice arbitrario.
//
// Regole dei nodi: _doc/guide-fle-regole-nodi.md

const INITS = ['none', 'factory', 'emscripten'];
const _cache = new Map();   // "mode|url|global|init" → Promise<lib>: una sola richiesta per URL e pagina

/** URL assoluto: i percorsi relativi valgono rispetto alla PAGINA (dashboard.php), non a questo file. */
function absUrl(url) {
    try { return new URL(url, document.baseURI).href; } catch { return url; }
}

/**
 * Toglie il "then" dai moduli Emscripten: in molte build il modulo pronto ha ancora un metodo
 * then, e risolverci una Promise la farebbe aspettare per sempre (si risolve con se stesso).
 */
function unthen(m) {
    if (m && typeof m === 'object' && !(m instanceof Promise) && typeof m.then === 'function') {
        try { delete m.then; } catch { /* non configurabile */ }
        if (typeof m.then === 'function') { try { m.then = undefined; } catch { /* ignora */ } }
    }
    return m;
}

/** Aspetta un modulo Emscripten (Promise, oggetto con then, oppure Module con onRuntimeInitialized). */
function awaitEmscripten(m, timeoutMs = 120000) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('initialization not finished after ' + (timeoutMs / 1000) + ' s: is init right for this library?')), timeoutMs); });
    const ready = new Promise((resolve, reject) => {
        if (!m) { reject(new Error('empty library')); return; }
        if (typeof m.then === 'function') {
            m.then(v => resolve(unthen(v)), reject);
        } else if (m.calledRun || m.Mat || m.HEAP8) {
            resolve(m);   // già pronto
        } else if ('onRuntimeInitialized' in m || typeof m === 'object') {
            const prev = m.onRuntimeInitialized;
            m.onRuntimeInitialized = () => { try { prev?.(); } finally { resolve(unthen(m)); } };
        } else {
            resolve(m);
        }
    });
    return Promise.race([ready, timeout]).finally(() => clearTimeout(timer));
}

/** Applica l'inizializzazione dichiarata (none | factory | emscripten). */
async function initLibrary(lib, init) {
    if (init === 'factory') {
        const fn = typeof lib === 'function' ? lib : lib?.default;
        if (typeof fn !== 'function') throw new Error('init "factory": the library does not export a function to call');
        return unthen(await awaitEmscripten(fn()));
    }
    if (init === 'emscripten') return awaitEmscripten(lib);
    return unthen(lib);
}

/**
 * Carica e inizializza una libreria (con cache per pagina).
 * mode: 'esm' (import) | 'script' (tag <script> + variabile globale). init: none | factory | emscripten.
 */
export function fleLoadLibrary(url, mode = 'esm', globalName = '', init = 'none') {
    const abs = absUrl(url);
    const key = `${mode}|${abs}|${globalName}|${init}`;
    if (_cache.has(key)) return _cache.get(key);
    let p;
    if (mode === 'script') {
        p = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = abs;
            s.async = true;
            s.onload  = () => {
                const lib = globalName ? window[globalName] : true;
                if (globalName && lib == null) reject(new Error(`script loaded but the global variable "${globalName}" does not exist`));
                else resolve({ lib });   // in una scatola: un modulo Emscripten ha then (vedi unthen)
            };
            s.onerror = () => reject(new Error(`cannot load the script ${abs}`));
            document.head.appendChild(s);
        });
    } else {
        p = import(/* webpackIgnore: true */ abs).then(ns => ({ lib: ns }));
    }
    p = p.then(box => initLibrary(box.lib, init));
    // un caricamento fallito non resta in cache: si può riprovare
    p = p.catch(err => { _cache.delete(key); throw err; });
    _cache.set(key, p);
    return p;
}

let _catalog = null;
/** Catalogo delle librerie del server (lib/libraries.json), letto una volta per pagina. */
export function fleLibraryCatalog() {
    if (!_catalog) {
        _catalog = fetch(absUrl('lib/libraries.json'), { cache: 'no-cache' })
            .then(r => { if (!r.ok) throw new Error(`catalog lib/libraries.json: HTTP ${r.status}`); return r.json(); })
            .then(j => Array.isArray(j?.libraries) ? j.libraries : [])
            .catch(err => { _catalog = null; throw err; });
    }
    return _catalog;
}
let _catalogIds = [];   // per i valori del combo (sincroni)
fleLibraryCatalog().then(list => { _catalogIds = list.map(l => l.id); }).catch(() => {});

/**
 * Libreria del contesto `name` nel grafo del nodo (Promise). Rifiuta con un messaggio
 * chiaro se nessun nodo Context/Library del grafo usa quel nome.
 */
export function fleUseContext(node, name) {
    name = String(name ?? '').trim();
    if (!name) return Promise.resolve(null);
    const entry = node?.graph?._fleContexts?.[name];
    if (!entry) {
        return Promise.reject(new Error(`context "${name}" not defined: add to the flow a ReseArch/Context/Library node with name = ${name}`));
    }
    return entry;
}

// ── Percorsi sicuri (Call / Method) ──────────────────────────────────────────
const FORBIDDEN = new Set(['constructor', '__proto__', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
function splitPath(path) {
    const parts = String(path ?? '').trim().split('.').map(s => s.trim()).filter(Boolean);
    if (!parts.length) throw new Error('empty path');
    for (const p of parts) if (FORBIDDEN.has(p)) throw new Error(`path not allowed: "${p}"`);
    return parts;
}
/** Risolve "a.b.c" a partire da root: { owner, value } (owner = oggetto che contiene l'ultimo pezzo). */
function resolvePath(root, path) {
    const parts = splitPath(path);
    let owner = null, value = root;
    for (const p of parts) {
        if (value == null) throw new Error(`"${p}": the previous value is empty`);
        owner = value;
        value = value[p];
    }
    if (value === Function || value === Function.prototype || value === globalThis) throw new Error('path not allowed');
    return { owner, value };
}
function toArgs(v) {
    if (v == null) return [];
    if (!Array.isArray(v)) throw new Error('"args" must be an array (also with a single argument: [value])');
    return v;
}

function drawText(node, ctx2d, text, color) {
    if (!text || node.research_error || node.flags.collapsed) return;
    ctx2d.save();
    ctx2d.font = '9px monospace';
    ctx2d.fillStyle = color || 'rgba(255,255,255,0.45)';
    const max = Math.max(10, Math.floor((node.size[0] - 12) / 5.4));
    ctx2d.fillText(text.length > max ? text.slice(0, max - 1) + '…' : text, 6, node.size[1] - 6);
    ctx2d.restore();
}

export function registerContextNodes(LG) {
    if (!LG) return;

    // ─────────────────────────────────────────────────────────────────────────
    // ReseArch/Context/Library List
    // ─────────────────────────────────────────────────────────────────────────
    function LibraryList() {
        this.addProperty('library', '', 'string');
        this.addWidget('combo', 'library', '', v => { this.properties.library = v; this._emit(); },
                       { values: () => _catalogIds, property: 'library' });
        this.addOutput('done',    LG.EVENT);
        this.addOutput('library', 'library_ref');
        this._status = '';
        this._seq = 0;
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [300, 80];
    }
    LibraryList.error_output = true;
    LibraryList.title = 'Library List';
    LibraryList.desc  = 'Chooses a library among those available on the server (catalog lib/libraries.json) and provides its reference to Context Library';
    LibraryList.portHelp = {
        outputs: {
            done:    'event — fired when the reference is ready (when the flow opens and at every change of choice)',
            library: 'library reference { id, title, version, url, mode, global, init } — connects only to the "library" input of ReseArch/Context/Library',
            error:   'event — catalog not reachable or library not in the catalog. Port hidden by default: right click → Show error',
        },
    };
    LibraryList.prototype._emit = async function () {
        const seq = ++this._seq;
        this.clearError?.();
        const id = this.properties.library;
        if (!id) { this._status = 'choose a library'; this.setDirtyCanvas(true, false); return; }
        let list;
        try { list = await fleLibraryCatalog(); }
        catch (err) { if (seq === this._seq) { this._status = ''; this.triggerError?.(err); } return; }
        if (seq !== this._seq) return;
        _catalogIds = list.map(l => l.id);
        const e = list.find(l => l.id === id);
        if (!e) { this._status = ''; this.triggerError?.(new Error(`"${id}" is not in the catalog lib/libraries.json`)); return; }
        const ref = { id: e.id, title: e.title || e.id, version: e.version || '', url: e.url,
                      mode: e.mode || 'esm', global: e.global || '', init: e.init || 'none' };
        this._status = `${ref.title} ${ref.version}${e.desc ? ' — ' + e.desc : ''}`;
        const slot = this.findOutputSlot('library');
        this.setOutputData(slot, ref);
        // avvisa i Context Library collegati: il riferimento arriva in modo asincrono
        for (const linkId of this.outputs[slot].links ?? []) {
            const link = this.graph?.links?.[linkId];
            const target = link && this.graph.getNodeById(link.target_id);
            target?.onLibraryRef?.();
        }
        this.setDirtyCanvas(true, false);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    LibraryList.prototype.onAdded     = function () { this._emit(); };
    LibraryList.prototype.onConfigure = function () { this._emit(); };
    LibraryList.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('ReseArch/Context/Library List', LibraryList);


    // ─────────────────────────────────────────────────────────────────────────
    // ReseArch/Context/Library
    // ─────────────────────────────────────────────────────────────────────────
    const MODES = ['esm', 'script'];

    function ContextLibrary() {
        this.addProperty('name',   '',     'string');
        this.addProperty('url',    '',     'string');
        this.addProperty('mode',   'esm',  'string');
        this.addProperty('global', '',     'string');
        this.addProperty('init',   'none', 'string');
        this.addWidget('text',  'name',   '',     v => { this.properties.name   = String(v ?? '').trim(); this._load(); }, { property: 'name' });
        this.addWidget('text',  'url',    '',     v => { this.properties.url    = String(v ?? '').trim(); this._load(); }, { property: 'url' });
        this.addWidget('combo', 'mode',   'esm',  v => { this.properties.mode   = v; this._load(); }, { values: MODES, property: 'mode' });
        this.addWidget('text',  'global', '',     v => { this.properties.global = String(v ?? '').trim(); this._load(); }, { property: 'global' });
        this.addWidget('combo', 'init',   'none', v => { this.properties.init   = v; this._load(); }, { values: INITS, property: 'init' });
        this.addInput('library', 'library_ref');
        this.addOutput('done',  LG.EVENT);
        this.addOutput('lib',   'object');
        this._status   = '';
        this._registered = null;   // nome con cui è registrato nel grafo
        this._pending  = null;     // { resolve, reject } della Promise registrata, finché non è risolta
        this._seq      = 0;
        this.color   = '#14532d';   // famiglia Creazione astratta
        this.bgcolor = '#166534';
        this.size    = [300, 170];
    }
    ContextLibrary.error_output = true;   // porta 'error' del fork (patch 3): tasto destro → Show error
    ContextLibrary.title = 'Context Library';
    ContextLibrary.desc  = 'Loads an external library (from the server catalog through Library List, or from a URL) and makes it available to the other nodes of the flow under a context name, without links (critical node: requires flow validation)';
    ContextLibrary.portHelp = {
        inputs: {
            library: 'library reference ("library" output of ReseArch/Context/Library List) — when connected it overrides the url, mode, global, init widgets',
        },
        outputs: {
            done:  'event — fired when the library is loaded, initialized and ready',
            lib:   'object — the ready library (the ES module, the global variable in script mode, or the result of the initialization), for those who prefer to connect it with a link',
            error: 'event — fired if loading or initialization fails; parameter { message, node, title, type, time }. Port hidden by default: right click on the node → Show error (the message is written in red on the node anyway)',
        },
        properties: {
            url:  'path on the server (e.g. lib/rhino3dm/rhino3dm.module.js, relative to the page) or full URL with a fixed version',
            init: 'none: the library is ready as soon as it is loaded · factory: calls the exported function and waits for its result (e.g. rhino3dm) · emscripten: waits for the WASM runtime (e.g. OpenCV)',
        },
    };
    /** Riferimento da usare: dall'ingresso collegato, oppure dai widget. 'wait' = collegato ma non ancora arrivato. */
    ContextLibrary.prototype._ref = function () {
        const slot = this.findInputSlot('library');
        const linkId = slot !== -1 ? this.inputs[slot].link : null;
        if (linkId != null) {
            const link = this.graph?.links?.[linkId];
            let ref = link?.data;
            if (ref == null && link) ref = this.graph.getNodeById(link.origin_id)?.outputs?.[link.origin_slot]?._data;
            return ref && ref.url ? ref : 'wait';
        }
        const { url, mode, global: g, init } = this.properties;
        return url ? { url, mode: mode === 'script' ? 'script' : 'esm', global: g, init: INITS.includes(init) ? init : 'none' } : null;
    };
    /** (Ri)carica la libreria e la registra nel grafo con il nome di contesto. */
    ContextLibrary.prototype._load = function () {
        const g = this.graph;
        if (!g) return;
        g._fleContexts = g._fleContexts || {};
        const seq = ++this._seq;
        const prevPending = this._pending;
        if (this._registered && g._fleContexts[this._registered]?._owner === this) delete g._fleContexts[this._registered];
        this._registered = null;
        this._pending = null;
        this.clearError?.();
        const name = this.properties.name;
        const ref = this._ref();
        if (!name || !ref) { this._status = 'set name and url (or connect Library List)'; prevPending?.reject(new Error(`context "${name}" removed`)); this.setDirtyCanvas(true, false); return; }
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) { this._status = ''; prevPending?.reject(new Error('invalid name')); this.triggerError?.(new Error('invalid name (letters, digits, _)')); return; }

        // Promise registrata subito: chi chiede il contesto prima che sia pronto aspetta
        let pending;
        const entry = new Promise((resolve, reject) => { pending = { resolve, reject }; });
        entry._owner = this;
        entry.catch(() => {});              // l'errore è gestito sotto e da chi usa il contesto
        g._fleContexts[name] = entry;
        this._registered = name;
        this._pending = pending;
        prevPending?.resolve(entry);        // chi aspettava la versione precedente aspetta questa

        if (ref === 'wait') { this._status = 'waiting for the reference from the catalog…'; this.setDirtyCanvas(true, false); return; }

        this._status = 'loading…';
        this.setDirtyCanvas(true, false);
        fleLoadLibrary(ref.url, ref.mode, ref.global, ref.init).then(lib => {
            if (seq !== this._seq) return;   // superato da un caricamento più recente
            this._pending = null;
            pending.resolve(lib);
            this._status = 'ready' + (ref.title ? ` — ${ref.title} ${ref.version || ''}` : '');
            this.setOutputData(this.findOutputSlot('lib'), lib);
            this.setDirtyCanvas(true, false);
            this.triggerSlot(this.findOutputSlot('done'));
        }).catch(err => {
            if (seq !== this._seq) return;
            this._pending = null;
            pending.reject(err);
            this._status = '';
            this.setOutputData(this.findOutputSlot('lib'), null);
            this.triggerError?.(new Error(`"${name}": ${err?.message || err}`));
        });
    };
    // onAdded: nodo aggiunto a mano. onConfigure: flow caricato — LiteGraph aggiunge il nodo al
    // grafo PRIMA di applicare le proprietà salvate, quindi il caricamento vero parte qui.
    ContextLibrary.prototype.onAdded     = function () { this._load(); };
    ContextLibrary.prototype.onConfigure = function () { this._load(); };
    ContextLibrary.prototype.onLibraryRef = function () { this._load(); };   // chiamato da Library List
    ContextLibrary.prototype.onConnectionsChange = function (type, slot) {
        if (type === LG.INPUT && this.inputs?.[slot]?.name === 'library' && this.graph && !this.graph._configuring) this._load();
    };
    ContextLibrary.prototype.onRemoved = function () {
        const g = this.graph;
        if (g?._fleContexts && this._registered && g._fleContexts[this._registered]?._owner === this) delete g._fleContexts[this._registered];
        this._pending?.reject(new Error(`context "${this._registered}" removed`));
        this._pending = null;
        this._registered = null;
    };
    ContextLibrary.prototype.onDrawForeground = function (ctx2d) {
        drawText(this, ctx2d, this._status, this._status.startsWith('ready') ? 'rgba(120,255,120,0.8)' : null);
    };
    LG.registerNodeType('ReseArch/Context/Library', ContextLibrary);


    // ─────────────────────────────────────────────────────────────────────────
    // ReseArch/Context/Call
    // ─────────────────────────────────────────────────────────────────────────
    const CALL_KINDS = ['call', 'new', 'get'];

    function ContextCall() {
        this.addProperty('context', '',     'string');
        this.addProperty('path',    '',     'string');
        this.addProperty('kind',    'call', 'string');
        this.addWidget('text',  'context', '',     v => { this.properties.context = String(v ?? '').trim(); }, { property: 'context' });
        this.addWidget('text',  'path',    '',     v => { this.properties.path    = String(v ?? '').trim(); }, { property: 'path' });
        this.addWidget('combo', 'kind',    'call', v => { this.properties.kind    = v; }, { values: CALL_KINDS, property: 'kind' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('args',    'array');
        this.addOutput('done',   LG.EVENT);
        this.addOutput('result', 0);
        this._status = '';
        this._seq = 0;
        this.color   = '#1e3a5f';   // famiglia Calcolo
        this.bgcolor = '#1e40af';
        this.size    = [260, 120];
    }
    ContextCall.error_output = true;
    ContextCall.title = 'Context Call';
    ContextCall.desc  = 'On trigger uses the library of a context: calls one of its functions (call), creates one of its objects (new) or reads a value (get)';
    ContextCall.portHelp = {
        inputs: {
            trigger: 'event — runs the call',
            args:    'array — arguments, always as an array even if there is only one: [value]. Empty = no arguments. Ignored with kind = get',
        },
        outputs: {
            done:   'event — fired when the result is ready (if the function returns a Promise, after awaiting it)',
            result: 'any — value returned by the function, created object, or value read; the type depends on the called function (see the library documentation)',
            error:  'event — missing context, nonexistent or not allowed path, args not an array, library exception. Port hidden by default: right click → Show error',
        },
        properties: {
            context: 'context name (the "name" of a ReseArch/Context/Library node)',
            path:    'name in the library, dots allowed: e.g. imread, Mat, COLOR_RGBA2GRAY (OpenCV) · File3dm.fromByteArray, Point3d (rhino3dm)',
            kind:    'call: calls the function · new: creates an object (constructor) · get: reads the value (e.g. a constant)',
        },
    };
    ContextCall.prototype.onAction = async function () {
        const seq = ++this._seq;
        this.clearError?.();
        const { context, path, kind } = this.properties;
        let result;
        try {
            if (!context) throw new Error('set the context');
            const lib = await fleUseContext(this, context);
            const { owner, value } = resolvePath(lib, path);
            if (kind === 'get') {
                result = value;
            } else {
                if (typeof value !== 'function') throw new Error(`"${path}" is not a function${kind === 'new' ? ' (constructor)' : ''}`);
                const args = toArgs(this.getInputData(this.findInputSlot('args')));
                result = kind === 'new' ? new value(...args) : value.apply(owner, args);
                if (result && typeof result.then === 'function') result = unthen(await result);
            }
        } catch (err) {
            if (seq !== this._seq) return;
            this._status = '';
            this.setOutputData(this.findOutputSlot('result'), null);
            this.triggerError?.(err);
            return;
        }
        if (seq !== this._seq) return;
        this._status = `${kind} ${path} → ${describe(result)}`;
        this.setOutputData(this.findOutputSlot('result'), result);
        this.setDirtyCanvas(true, false);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    ContextCall.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('ReseArch/Context/Call', ContextCall);


    // ─────────────────────────────────────────────────────────────────────────
    // ReseArch/Context/Method
    // ─────────────────────────────────────────────────────────────────────────
    const METHOD_KINDS = ['call', 'get'];

    function ContextMethod() {
        this.addProperty('method', '',     'string');
        this.addProperty('kind',   'call', 'string');
        this.addWidget('text',  'method', '',     v => { this.properties.method = String(v ?? '').trim(); }, { property: 'method' });
        this.addWidget('combo', 'kind',   'call', v => { this.properties.kind   = v; }, { values: METHOD_KINDS, property: 'kind' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('object',  0);
        this.addInput('args',    'array');
        this.addOutput('done',   LG.EVENT);
        this.addOutput('result', 0);
        this._status = '';
        this._seq = 0;
        this.color   = '#1e3a5f';   // famiglia Calcolo
        this.bgcolor = '#1e40af';
        this.size    = [240, 100];
    }
    ContextMethod.error_output = true;
    ContextMethod.title = 'Context Method';
    ContextMethod.desc  = 'On trigger uses an object created by a library (e.g. the result of Context Call): calls one of its methods (call) or reads a property (get)';
    ContextMethod.portHelp = {
        inputs: {
            trigger: 'event — runs the call',
            object:  'library object to act on, e.g. an OpenCV Mat or a rhino3dm File3dm (usually the result of Context Call or of another Context Method)',
            args:    'array — method arguments, always as an array: [value]. Empty = no arguments. Ignored with kind = get',
        },
        outputs: {
            done:   'event — fired when the result is ready (Promises awaited)',
            result: 'any — value returned by the method or property read; for methods without a result (e.g. delete) it is undefined',
            error:  'event — missing object, nonexistent or not allowed method, args not an array, library exception. Port hidden by default: right click → Show error',
        },
        properties: {
            method: 'name of the method or property, dots allowed: e.g. delete, rows, objects, toThreejsJSON',
            kind:   'call: calls the method · get: reads the property',
        },
    };
    ContextMethod.prototype.onAction = async function () {
        const seq = ++this._seq;
        this.clearError?.();
        const { method, kind } = this.properties;
        let result;
        try {
            const obj = this.getInputData(this.findInputSlot('object'));
            if (obj == null) throw new Error('no input object');
            const { owner, value } = resolvePath(obj, method);
            if (kind === 'get') {
                result = value;
            } else {
                if (typeof value !== 'function') throw new Error(`"${method}" is not a method of the object`);
                result = value.apply(owner, toArgs(this.getInputData(this.findInputSlot('args'))));
                if (result && typeof result.then === 'function') result = unthen(await result);
            }
        } catch (err) {
            if (seq !== this._seq) return;
            this._status = '';
            this.setOutputData(this.findOutputSlot('result'), null);
            this.triggerError?.(err);
            return;
        }
        if (seq !== this._seq) return;
        this._status = `${kind} ${method} → ${describe(result)}`;
        this.setOutputData(this.findOutputSlot('result'), result);
        this.setDirtyCanvas(true, false);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    ContextMethod.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('ReseArch/Context/Method', ContextMethod);
}

/** Descrizione breve di un valore per la riga di stato del nodo. */
function describe(v) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (Array.isArray(v)) return `array(${v.length})`;
    if (typeof v === 'object') return v.constructor?.name || 'object';
    if (typeof v === 'string') return `"${v.slice(0, 20)}"`;
    return String(v);
}
