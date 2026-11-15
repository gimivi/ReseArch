// app/FLE_sub_modules/FLE-web-nodes.mjs
// Nodi generali per elenchi, scelte e indirizzi web (2026-10-21):
//   String/Split List        — testo (elenco JSON, a capo, ; , |) → array di stringhe
//   Params/Array/Find        — primo elemento di un array con un campo uguale a un valore (found / not_found)
//   Flow/Switch              — smista un evento secondo un valore (o un suo campo): un'uscita per caso
//   Web/URL/Describe         — indirizzo → { url, host, file, ext, kind, label, icon, … }
//   Web/URL/Describe List    — lo stesso per un array di indirizzi
//   Web/URL/Frame Check      — chiede al server se l'indirizzo si lascia mostrare in un iframe (cache)
//   Web/URL/Frame Check List — controlla in anticipo un elenco (riempie la cache)
//   Web/Open Window          — apre un indirizzo in una nuova scheda del browser
//   Web/Wikipedia/Article    — voce di Wikipedia (titolo o indirizzo) → HTML ripulito + riassunto
//
// Nodi di rete solo verso la piattaforma (api/frame_check.php) e verso *.wikipedia.org (API
// pubblica con CORS): nessuna richiesta a indirizzi arbitrari (regole dei nodi §12).
// Nessuno esegue codice scritto nel grafo: non sono nodi critici.
// Regole dei nodi: _doc/guide-fle-regole-nodi.md · Doc: _doc/module-fle-architettura.md §6.8

const COL_CALC  = ['#1e3a5f', '#1e40af'];   // Calcolo
const COL_ROUTE = ['#1f2937', '#374151'];   // Instradamento
const COL_GET   = ['#1a2a4a', '#1e3a5f'];   // Get (legge dal server / da Wikipedia)
const COL_UI    = ['#0c4a6e', '#0369a1'];   // UI

// ─── Funzioni esportate (riusate da altri nodi, es. TML/Item/ToRecord) ────────

/**
 * Testo → array di stringhe pulite. auto: elenco JSON ["a","b"] se il testo inizia con "[",
 * altrimenti il primo separatore presente fra a capo, ";", "|", ",". Vuoti tolti.
 */
export function splitList(value, separator = 'auto', unique = true) {
    let items;
    if (Array.isArray(value)) items = value;
    else {
        const s = value == null ? '' : String(value).trim();
        if (!s) return [];
        const SEP = { comma: ',', semicolon: ';', pipe: '|', space: /\s+/, newline: /\r?\n/ };
        if (separator === 'auto' && s.startsWith('[')) {
            try { const j = JSON.parse(s); if (Array.isArray(j)) items = j; } catch { /* non è JSON: separatori */ }
        }
        if (!items) {
            let sep = SEP[separator];
            if (!sep) sep = /\r?\n/.test(s) ? /\r?\n/ : s.includes(';') ? ';' : s.includes('|') ? '|' : ',';
            items = s.split(sep);
        }
    }
    const out = items
        .map(x => (x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x)).trim())
        .filter(Boolean);
    return unique ? [...new Set(out)] : out;
}

const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'tif', 'tiff']);
const VID_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const AUD_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac']);
const KIND_ICON = { pdf: 'bi-file-earmark-pdf', image: 'bi-image', video: 'bi-film', audio: 'bi-music-note-beamed', wikipedia: 'bi-wikipedia', page: 'bi-globe2' };
const _decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Indirizzo http(s) → descrizione, oppure null se non è un indirizzo http(s) valido. */
export function describeUrl(raw) {
    let u;
    try { u = new URL(String(raw ?? '').trim()); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./, '');
    const segs = u.pathname.split('/').filter(Boolean);
    const file = segs.length ? _decode(segs[segs.length - 1]) : '';
    const ext = (/\.([a-z0-9]{1,5})$/i.exec(file)?.[1] ?? '').toLowerCase();
    const wm = /^([a-z-]+)(?:\.m)?\.wikipedia\.org$/i.exec(u.hostname);
    const wikiTitle = wm && u.pathname.startsWith('/wiki/') ? _decode(u.pathname.slice(6)) : null;
    const kind = wikiTitle ? 'wikipedia' : ext === 'pdf' ? 'pdf' : IMG_EXT.has(ext) ? 'image'
               : VID_EXT.has(ext) ? 'video' : AUD_EXT.has(ext) ? 'audio' : 'page';
    let label;
    if (wikiTitle) label = wikiTitle.replace(/_/g, ' ');
    else if (file && ext) label = file;
    else {
        const p = _decode(u.pathname.replace(/\/$/, ''));
        label = host + (p.length > 1 ? (p.length > 28 ? ' …' + p.slice(-24) : p) : '');
    }
    return {
        url: u.href, host, path: u.pathname, file, ext, kind, label, title: u.href, icon: KIND_ICON[kind],
        wikiLang: wikiTitle ? wm[1].toLowerCase() : null, wikiTitle,
    };
}

// Cache per pagina dei controlli iframe (fra nodi, flow e pannelli) + richieste in corso
const FRAME_CACHE = window.__RA_FRAME_CHECK_CACHE || (window.__RA_FRAME_CHECK_CACHE = new Map());
const FRAME_PENDING = new Map();

/** Risultato già noto (o deducibile senza server) per l'indirizzo, altrimenti null. */
function frameCheckCached(url) {
    try { if (new URL(url, location.href).origin === location.origin) return { frameable: true, reason: 'same site' }; } catch { /* sotto */ }
    return FRAME_CACHE.get(url) ?? null;
}

/** { frameable, reason } dal server (api/frame_check.php); un errore di rete vale "non incorporabile" e non resta in cache. */
export async function frameCheck(url) {
    const known = frameCheckCached(url);
    if (known) return known;
    if (FRAME_PENDING.has(url)) return FRAME_PENDING.get(url);
    const p = (async () => {
        try {
            const resp = await fetch(`api/frame_check.php?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' });
            const j = await resp.json().catch(() => null);
            if (!resp.ok || !j?.ok) return { frameable: false, reason: `check failed: ${j?.error || 'HTTP ' + resp.status}` };
            const r = { frameable: !!j.data?.frameable, reason: String(j.data?.reason ?? '') };
            FRAME_CACHE.set(url, r);
            return r;
        } catch (err) {
            return { frameable: false, reason: `check failed: ${err?.message || err}` };
        } finally {
            FRAME_PENDING.delete(url);
        }
    })();
    FRAME_PENDING.set(url, p);
    return p;
}

// ─── Nodi ─────────────────────────────────────────────────────────────────────

export function registerWebNodes(LG) {
    if (!LG || LG.registered_node_types['Web/URL/Describe']) return;
    const EVENT = LG.EVENT, ACTION = LG.ACTION;
    const paint = (n, [c, bg]) => { n.color = c; n.bgcolor = bg; };
    const out  = (n, name, v) => { const i = n.findOutputSlot(name); if (i !== -1) n.setOutputData(i, v); };
    const fire = (n, name, p) => { const i = n.findOutputSlot(name); if (i !== -1) n.triggerSlot(i, p); };
    const inp  = (n, name) => { const i = n.findInputSlot(name); return i === -1 ? undefined : n.getInputData(i); };
    /** Testo di stato disegnato in basso sul nodo (es. "checking…"). */
    function drawStatus(ctx2d) {
        if (!this._status || this.flags?.collapsed) return;
        ctx2d.save();
        ctx2d.font = '10px sans-serif';
        ctx2d.fillStyle = 'rgba(255,255,255,0.6)';
        ctx2d.fillText(this._status, 8, this.size[1] - 6);
        ctx2d.restore();
    }

    // ── String/Split List ────────────────────────────────────────────────────
    function SplitList() {
        this.addInput('trigger', ACTION);
        this.addInput('text', 'string');
        this.addOutput('done', EVENT);
        this.addOutput('list', 'array');
        this.addOutput('count', 'number');
        this.addProperty('separator', 'auto', 'string');
        this.addProperty('unique', true, 'boolean');
        this.addWidget('combo', 'separator', 'auto', v => { this.properties.separator = v; }, { values: ['auto', 'comma', 'semicolon', 'newline', 'pipe', 'space'], property: 'separator' });
        this.addWidget('toggle', 'unique', true, v => { this.properties.unique = !!v; }, { property: 'unique' });
        paint(this, COL_CALC);
        this.size = [210, 100];
    }
    SplitList.title = 'Split List';
    SplitList.desc  = 'Turns a text that contains a list into an array of strings: a JSON list ["a","b"], or items separated by new lines, ";", "|", "," or spaces. Trims every item and drops the empty ones';
    SplitList.portHelp = {
        inputs: {
            trigger: 'event — splits the text',
            text:    'string — e.g. a sheet cell: ["https://…","https://…"] or "red; green; blue". Empty or null = empty array',
        },
        outputs: {
            done:  'event — list ready',
            list:  'array of strings, in the original order',
            count: 'number — items in the list',
        },
        properties: {
            separator: 'auto = JSON list if the text starts with "[", otherwise the first separator found among new line, ";", "|", "," · or a fixed separator',
            unique:    'on = repeated items appear once',
        },
    };
    SplitList.prototype.onAction = function () {
        const list = splitList(inp(this, 'text'), this.properties.separator, this.properties.unique);
        out(this, 'list', list);
        out(this, 'count', list.length);
        fire(this, 'done');
    };
    LG.registerNodeType('String/Split List', SplitList);

    // ── Params/Array/Find ────────────────────────────────────────────────────
    function ArrayFind() {
        this.addInput('trigger', ACTION);
        this.addInput('array', 'array');
        this.addInput('value', 'string');
        this.addOutput('done', EVENT);
        this.addOutput('found', EVENT);
        this.addOutput('not_found', EVENT);
        this.addOutput('item', 0);
        this.addOutput('index', 'number');
        this.addProperty('field', '', 'string');
        this.addProperty('value', '', 'string');
        this.addProperty('match', 'equals', 'string');
        this.addProperty('ignoreCase', true, 'boolean');
        this.addWidget('text', 'field', '', v => { this.properties.field = String(v ?? '').trim(); }, { property: 'field' });
        this.addWidget('text', 'value', '', v => { this.properties.value = String(v ?? ''); }, { property: 'value' });
        this.addWidget('combo', 'match', 'equals', v => { this.properties.match = v; }, { values: ['equals', 'contains', 'starts with'], property: 'match' });
        this.addWidget('toggle', 'ignoreCase', true, v => { this.properties.ignoreCase = !!v; }, { property: 'ignoreCase' });
        paint(this, COL_CALC);
        this.size = [220, 170];
    }
    ArrayFind.title = 'Array Find';
    ArrayFind.desc  = 'Finds the first item of an array whose field (or the item itself) matches a value, and fires found or not_found. E.g. the Wikipedia link among the links of a record (field kind = wikipedia), the first PDF, the row with a given code';
    ArrayFind.portHelp = {
        inputs: {
            trigger: 'event — searches',
            array:   'array — items (objects, or plain values when "field" is empty). Missing or empty = not found',
            value:   'string — value to look for; when connected it replaces the "value" widget',
        },
        outputs: {
            done:      'event — search finished (fired before found / not_found)',
            found:     'event — an item matches',
            not_found: 'event — no item matches (item null, index -1)',
            item:      'the first matching item (object or value), null if not found',
            index:     'number — its position from 0, -1 if not found',
        },
        properties: {
            field:      'field compared in every item, also nested with dots (e.g. "kind", "data.code"); empty = the item itself',
            value:      'value to look for (used when the "value" input is not connected)',
            match:      'equals · contains · starts with — compared as text',
            ignoreCase: 'on = "PDF" and "pdf" match',
        },
    };
    ArrayFind.prototype.onAction = function () {
        const arr = inp(this, 'array');
        const linked = inp(this, 'value');
        const want = String(linked != null ? linked : (this.properties.value ?? ''));
        const P = this.properties;
        const norm = (x) => (P.ignoreCase ? x.toLowerCase() : x);
        const w = norm(want);
        const get = (it) => (P.field ? P.field.split('.').reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), it) : it);
        const test = (it) => {
            const v = get(it);
            if (v == null) return false;
            const s = norm(typeof v === 'object' ? JSON.stringify(v) : String(v));
            return P.match === 'contains' ? s.includes(w) : P.match === 'starts with' ? s.startsWith(w) : s === w;
        };
        const index = Array.isArray(arr) ? arr.findIndex(test) : -1;
        out(this, 'item', index >= 0 ? arr[index] : null);
        out(this, 'index', index);
        fire(this, 'done');
        fire(this, index >= 0 ? 'found' : 'not_found');
    };
    LG.registerNodeType('Params/Array/Find', ArrayFind);

    // ── Flow/Switch ──────────────────────────────────────────────────────────
    const SWITCH_FIXED = ['other', '→value'];
    function Switch() {
        this.addInput('trigger', ACTION);
        this.addInput('value', 0);
        this.addProperty('field', '', 'string');
        this.addProperty('cases', 'a,b', 'string');
        this.addProperty('ignoreCase', true, 'boolean');
        this.addWidget('text', 'field', '', v => { this.properties.field = String(v ?? '').trim(); }, { property: 'field' });
        this.addWidget('text', 'cases', 'a,b', v => { this.properties.cases = String(v ?? ''); this._syncOutputs(); }, { property: 'cases' });
        this.addWidget('toggle', 'ignoreCase', true, v => { this.properties.ignoreCase = !!v; }, { property: 'ignoreCase' });
        this._syncOutputs();
        paint(this, COL_ROUTE);
        this.size = [220, 150];
    }
    Switch.title = 'Switch';
    Switch.desc  = 'Routes an event by value: compares the value (or one of its fields) with the cases and fires the output with the same name, or "other" when nothing matches. E.g. kind of a link: pdf → PDF panel, wikipedia → article panel';
    Switch.portHelp = {
        inputs: {
            trigger: 'event — compares and fires one output',
            value:   'any type — the value to compare, or an object whose "field" is compared',
        },
        outputs: {
            '<case>':  'event — one output per case written in "cases", fired when the value equals that case',
            other:     'event — fired when no case matches (also for an empty value)',
            '→value':  'the same value received, to pass it on to the nodes of the chosen branch',
        },
        properties: {
            field:      'field to compare when value is an object, also nested with dots (e.g. "kind", "data.type"); empty = the value itself',
            cases:      'cases separated by commas, e.g. "pdf,wikipedia,image": every case becomes an output. Changing the cases rebuilds the outputs (links of removed cases are lost)',
            ignoreCase: 'on = "PDF" and "pdf" are the same case',
        },
    };
    Switch.prototype._cases = function () {
        const names = String(this.properties.cases ?? '').split(',').map(s => s.trim()).filter(Boolean);
        return [...new Set(names)].filter(n => !SWITCH_FIXED.includes(n));
    };
    /** Uscite = casi + other + →value; ricostruite solo se cambiano (i fili restano dove i nomi coincidono). */
    Switch.prototype._syncOutputs = function () {
        const want = [...this._cases(), ...SWITCH_FIXED];
        const have = (this.outputs ?? []).map(o => o.name);
        if (want.length === have.length && want.every((n, i) => n === have[i])) return;
        // toglie le uscite che non servono più (dal fondo), poi aggiunge quelle mancanti e riordina
        for (let i = have.length - 1; i >= 0; i--) if (!want.includes(have[i])) this.removeOutput(i);
        for (const n of want) if (this.findOutputSlot(n) === -1) this.addOutput(n, n === '→value' ? 0 : EVENT);
        const order = (this.outputs ?? []).map(o => o.name);
        if (!want.every((n, i) => n === order[i])) {
            // riordino: LiteGraph non sposta le uscite; si ricostruiscono senza fili (caso raro: casi riordinati)
            while (this.outputs?.length) this.removeOutput(this.outputs.length - 1);
            for (const n of want) this.addOutput(n, n === '→value' ? 0 : EVENT);
        }
        const min = this.computeSize?.();
        if (min) this.size = [Math.max(this.size?.[0] ?? 0, min[0]), Math.max(this.size?.[1] ?? 0, min[1])];
        this.setDirtyCanvas?.(true, true);
    };
    Switch.prototype.onConfigure = function () { this._syncOutputs(); };
    Switch.prototype.onAction = function () {
        const v = inp(this, 'value');
        let key = v;
        const field = this.properties.field;
        if (field) key = field.split('.').reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), v);
        const s = key == null ? '' : String(key);
        const ic = this.properties.ignoreCase;
        const hit = s ? this._cases().find(c => (ic ? c.toLowerCase() === s.toLowerCase() : c === s)) : null;
        out(this, '→value', v);
        fire(this, hit ?? 'other');
    };
    LG.registerNodeType('Flow/Switch', Switch);

    // ── Web/URL/Describe ─────────────────────────────────────────────────────
    const INFO_HELP = 'object — { url, host, path, file, ext, kind, label, title, icon, wikiLang, wikiTitle }: kind = pdf, image, video, audio, wikipedia or page (from the extension and the site); label = Wikipedia title, file name or short address; icon = Bootstrap icon class (e.g. "bi-file-earmark-pdf"); title = the full address';
    function Describe() {
        this.addInput('trigger', ACTION);
        this.addInput('url', 'string');
        this.addOutput('done', EVENT);
        this.addOutput('info', 'object');
        this.addOutput('kind', 'string');
        this.addOutput('label', 'string');
        paint(this, COL_CALC);
        this.size = [200, 100];
    }
    Describe.title = 'URL Describe';
    Describe.desc  = 'Describes a web address without contacting it: site, file name, extension, kind (pdf, image, video, audio, wikipedia, page), a readable label and an icon. Useful for buttons, lists and to route links by kind';
    Describe.error_output = true;
    Describe.portHelp = {
        inputs: { trigger: 'event — describes', url: 'string — http or https address' },
        outputs: {
            done:  'event — description ready',
            info:  INFO_HELP,
            kind:  'string — pdf · image · video · audio · wikipedia · page',
            label: 'string — readable label',
            error: 'event — not an http(s) address. Port hidden by default: right click → Show error',
        },
    };
    Describe.prototype.onAction = function () {
        this.clearError?.();
        const info = describeUrl(inp(this, 'url'));
        if (!info) { this.triggerError?.(new Error('not an http(s) address')); return; }
        out(this, 'info', info); out(this, 'kind', info.kind); out(this, 'label', info.label);
        fire(this, 'done');
    };
    LG.registerNodeType('Web/URL/Describe', Describe);

    function DescribeList() {
        this.addInput('trigger', ACTION);
        this.addInput('urls', 'array');
        this.addOutput('done', EVENT);
        this.addOutput('items', 'array');
        this.addOutput('count', 'number');
        paint(this, COL_CALC);
        this.size = [200, 80];
    }
    DescribeList.title = 'URL Describe List';
    DescribeList.desc  = 'Describes every address of an array (as URL Describe): the result is ready for DOM Button Row (label, icon, title) and for routing by kind. Items that are not http(s) addresses are skipped';
    DescribeList.portHelp = {
        inputs: { trigger: 'event — describes', urls: 'array of strings — addresses (e.g. from String Split List or a record field)' },
        outputs: {
            done:  'event — descriptions ready (also for an empty array)',
            items: 'array of objects, one per valid address: ' + INFO_HELP,
            count: 'number — valid addresses',
        },
    };
    DescribeList.prototype.onAction = function () {
        const list = inp(this, 'urls');
        const items = (Array.isArray(list) ? list : []).map(describeUrl).filter(Boolean);
        out(this, 'items', items); out(this, 'count', items.length);
        fire(this, 'done');
    };
    LG.registerNodeType('Web/URL/Describe List', DescribeList);

    // ── Web/URL/Frame Check ──────────────────────────────────────────────────
    const FRAME_REASON = 'string — why: "same site", "allowed", "X-Frame-Options: SAMEORIGIN", "CSP frame-ancestors", "pdf" (browsers do not show PDFs in a sandboxed frame), "HTTP 403", "check failed: …"';
    function FrameCheck() {
        this.addInput('trigger', ACTION);
        this.addInput('url', 'string');
        this.addOutput('done', EVENT);
        this.addOutput('frameable', EVENT);
        this.addOutput('blocked', EVENT);
        this.addOutput('→url', 'string');
        this.addOutput('reason', 'string');
        this._token = 0; this._status = '';
        paint(this, COL_GET);
        this.size = [210, 130];
    }
    FrameCheck.title = 'URL Frame Check';
    FrameCheck.desc  = 'Asks the platform server whether a site accepts to be shown inside a frame (iframe) of another site, reading its X-Frame-Options and Content-Security-Policy headers. The answer is cached per page: an address already checked (e.g. by Frame Check List when the list arrived) answers at once, so a following Open Window is not blocked as a popup';
    FrameCheck.error_output = true;
    FrameCheck.portHelp = {
        inputs: { trigger: 'event — checks', url: 'string — http(s) address' },
        outputs: {
            done:      'event — answer ready (fired before frameable/blocked)',
            frameable: 'event — the site can be shown in an iframe (e.g. send it on the bus to an HTM iframe panel)',
            blocked:   'event — it cannot (or the check failed): open it with Web Open Window',
            '→url':    'string — the same address, for the next nodes',
            reason:    FRAME_REASON,
            error:     'event — not an http(s) address. Port hidden by default: right click → Show error',
        },
    };
    FrameCheck.prototype._emit = function (url, r) {
        this._status = '';
        out(this, '→url', url); out(this, 'reason', r.reason);
        fire(this, 'done');
        fire(this, r.frameable ? 'frameable' : 'blocked');
        this.setDirtyCanvas?.(true, false);
    };
    FrameCheck.prototype.onAction = function () {
        this.clearError?.();
        const info = describeUrl(inp(this, 'url'));
        if (!info) { this.triggerError?.(new Error('not an http(s) address')); return; }
        const token = ++this._token;
        const known = frameCheckCached(info.url);
        if (known) { this._emit(info.url, known); return; }   // subito: dentro il gesto del clic
        this._status = 'checking…';
        this.setDirtyCanvas?.(true, false);
        frameCheck(info.url).then(r => { if (token === this._token) this._emit(info.url, r); });
    };
    FrameCheck.prototype.onDrawForeground = drawStatus;
    LG.registerNodeType('Web/URL/Frame Check', FrameCheck);

    function FrameCheckList() {
        this.addInput('trigger', ACTION);
        this.addInput('urls', 'array');
        this.addOutput('done', EVENT);
        this.addOutput('results', 'array');
        this.addOutput('frameable', 'array');
        this._token = 0; this._status = '';
        paint(this, COL_GET);
        this.size = [210, 100];
    }
    FrameCheckList.title = 'URL Frame Check List';
    FrameCheckList.desc  = 'Checks in advance, on the platform server, which addresses of an array can be shown in an iframe, and keeps the answers in the cache: the URL Frame Check of a later click answers at once. Up to 4 checks at a time';
    FrameCheckList.portHelp = {
        inputs: {
            trigger: 'event — checks the list',
            urls:    'array — addresses as strings, or objects with a "url" field (e.g. the items of URL Describe List)',
        },
        outputs: {
            done:      'event — all the answers are ready',
            results:   'array of { url, frameable, reason } in the order of the list (only valid http(s) addresses); reason: ' + FRAME_REASON,
            frameable: 'array of strings — the addresses that can be shown in an iframe',
        },
    };
    FrameCheckList.prototype.onAction = async function () {
        const list = inp(this, 'urls');
        const urls = [...new Set((Array.isArray(list) ? list : [])
            .map(x => describeUrl(x && typeof x === 'object' ? x.url : x)?.url).filter(Boolean))];
        const token = ++this._token;
        this._status = urls.length ? `checking ${urls.length}…` : '';
        this.setDirtyCanvas?.(true, false);
        const results = new Array(urls.length);
        let next = 0;
        const worker = async () => { while (next < urls.length) { const i = next++; results[i] = { url: urls[i], ...(await frameCheck(urls[i])) }; } };
        await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
        if (token !== this._token) return;
        this._status = '';
        out(this, 'results', results);
        out(this, 'frameable', results.filter(r => r.frameable).map(r => r.url));
        fire(this, 'done');
        this.setDirtyCanvas?.(true, false);
    };
    FrameCheckList.prototype.onDrawForeground = drawStatus;
    LG.registerNodeType('Web/URL/Frame Check List', FrameCheckList);

    // ── Web/Open Window ──────────────────────────────────────────────────────
    function OpenWindow() {
        this.addInput('trigger', ACTION);
        this.addInput('url', 'string');
        this.addOutput('done', EVENT);
        paint(this, COL_UI);
        this.size = [190, 60];
    }
    OpenWindow.title = 'Open Window';
    OpenWindow.desc  = 'Opens a web address in a new browser tab. Browsers allow it only right after a click of the user: put it in a chain that starts from a click and does not wait for slow answers';
    OpenWindow.error_output = true;
    OpenWindow.portHelp = {
        inputs: { trigger: 'event — opens', url: 'string — http(s) address, or a path of the platform' },
        outputs: {
            done:  'event — tab opened',
            error: 'event — not an http(s) address, or the browser blocked the popup (too long after the click, or popups disabled). Port hidden by default: right click → Show error',
        },
    };
    OpenWindow.prototype.onAction = function () {
        this.clearError?.();
        const raw = String(inp(this, 'url') ?? '').trim();
        let u = null;
        try { u = new URL(raw, location.href); } catch { /* sotto */ }
        if (!raw || !u || (u.protocol !== 'http:' && u.protocol !== 'https:')) { this.triggerError?.(new Error('not an http(s) address')); return; }
        const w = window.open(u.href, '_blank');
        if (!w) { this.triggerError?.(new Error('blocked by the browser: allow popups for this site, or open it from a click')); return; }
        try { w.opener = null; } catch { /* altra origine */ }
        fire(this, 'done');
    };
    LG.registerNodeType('Web/Open Window', OpenWindow);

    // ── Web/Wikipedia/Article ────────────────────────────────────────────────
    function WikiArticle() {
        this.addInput('trigger', ACTION);
        this.addInput('page', 'string');
        this.addOutput('done', EVENT);
        this.addOutput('html', 'string');
        this.addOutput('title', 'string');
        this.addOutput('summary', 'object');
        this.addOutput('url', 'string');
        this.addProperty('lang', 'it', 'string');
        this.addProperty('images', true, 'boolean');
        this.addProperty('links', 'panel', 'string');
        this.addWidget('text', 'lang', 'it', v => { this.properties.lang = String(v ?? '').trim().toLowerCase() || 'it'; }, { property: 'lang' });
        this.addWidget('toggle', 'images', true, v => { this.properties.images = !!v; }, { property: 'images' });
        this.addWidget('combo', 'links', 'panel', v => { this.properties.links = v; }, { values: ['panel', 'new tab', 'text'], property: 'links' });
        this._token = 0; this._status = '';
        paint(this, COL_GET);
        this.size = [230, 160];
    }
    WikiArticle.title = 'Wikipedia Article';
    WikiArticle.desc  = 'Reads a Wikipedia article through its public API (no iframe): HTML with sections, headings, links, images, tables and the infobox, cleaned of navigation boxes and styles, ready for HTM DOM Set HTML. Inside the panel the text can be selected and read (HTM DOM On Selection)';
    WikiArticle.error_output = true;
    WikiArticle.portHelp = {
        inputs: {
            trigger: 'event — loads the article',
            page:    'string — article title (e.g. "Teatro Bibiena") or a Wikipedia address (https://it.wikipedia.org/wiki/…, also the mobile one); the address also gives the language',
        },
        outputs: {
            done:    'event — article ready',
            html:    'string — <article class="ra-wiki"> with title and content; internal links (links = panel) are elements with role="button", data-wiki-title="<title>" and data-wiki-url="<address>": catch them with HTM DOM On Event (attr = data-wiki-url, it keeps the language) and send the value to the "page" of a Wikipedia Article node',
            title:   'string — article title as written by Wikipedia (after redirects)',
            summary: 'object — { title, description, extract, thumbnail, coordinates: {lat, lon} | null, url } from the summary API (null if missing)',
            url:     'string — address of the article on Wikipedia',
            error:   'event — empty page, article not found, or Wikipedia not reachable. Port hidden by default: right click → Show error',
        },
        properties: {
            lang:   'language of Wikipedia when "page" is a title (it, en, fr…)',
            images: 'off = images and figures removed (lighter text)',
            links:  'panel = internal links become elements with data-wiki-url for the flow, external ones open in a new tab · new tab = every link opens in a new tab · text = links become plain text',
        },
    };
    WikiArticle.prototype.onAction = async function () {
        this.clearError?.();
        const raw = String(inp(this, 'page') ?? '').trim();
        if (!raw) { this.triggerError?.(new Error('empty page')); return; }
        let lang = this.properties.lang || 'it', title = raw;
        const d = describeUrl(raw);
        if (d?.wikiTitle) { lang = d.wikiLang; title = d.wikiTitle; }
        else if (d) { this.triggerError?.(new Error('not a Wikipedia address')); return; }
        if (!/^[a-z-]{2,12}$/.test(lang)) { this.triggerError?.(new Error(`invalid language "${lang}"`)); return; }
        title = title.replace(/ /g, '_');
        const base = `https://${lang}.wikipedia.org`;
        const opts = { headers: { 'Api-User-Agent': 'ReseArch research platform' } };
        const token = ++this._token;
        this._status = 'loading…';
        this.setDirtyCanvas?.(true, false);
        try {
            const [htmlResp, sumResp] = await Promise.all([
                fetch(`${base}/w/rest.php/v1/page/${encodeURIComponent(title)}/html`, opts),
                fetch(`${base}/api/rest_v1/page/summary/${encodeURIComponent(title)}`, opts).catch(() => null),
            ]);
            if (!htmlResp.ok) throw new Error(htmlResp.status === 404 ? `article "${title.replace(/_/g, ' ')}" not found` : `Wikipedia: HTTP ${htmlResp.status}`);
            const src = await htmlResp.text();
            const sum = sumResp?.ok ? await sumResp.json().catch(() => null) : null;
            if (token !== this._token) return;
            const realTitle = sum?.title || title.replace(/_/g, ' ');
            const html = cleanWikiHtml(src, { lang, base, title: realTitle, images: !!this.properties.images, links: this.properties.links });
            const url = sum?.content_urls?.desktop?.page || `${base}/wiki/${encodeURIComponent(realTitle.replace(/ /g, '_'))}`;
            this._status = '';
            out(this, 'html', html);
            out(this, 'title', realTitle);
            out(this, 'summary', sum ? {
                title: sum.title ?? realTitle, description: sum.description ?? '', extract: sum.extract ?? '',
                thumbnail: sum.thumbnail?.source ?? null,
                coordinates: sum.coordinates ? { lat: sum.coordinates.lat, lon: sum.coordinates.lon } : null, url,
            } : null);
            out(this, 'url', url);
            fire(this, 'done');
        } catch (err) {
            if (token !== this._token) return;
            this._status = '';
            this.triggerError?.(err);
        }
        this.setDirtyCanvas?.(true, false);
    };
    WikiArticle.prototype.onDrawForeground = drawStatus;
    LG.registerNodeType('Web/Wikipedia/Article', WikiArticle);
}

/**
 * HTML di Parsoid (API REST di MediaWiki) → <article class="ra-wiki">: toglie stili, script,
 * riquadri di navigazione e marcature interne; link interni come elementi data-wiki-title (o
 * nuova scheda / testo); immagini con indirizzo assoluto. Il risultato passa comunque dalla
 * pulizia di HTM/DOM/Set HTML prima di entrare nella pagina.
 */
function cleanWikiHtml(src, { lang, base, title, images, links }) {
    const doc = new DOMParser().parseFromString(src, 'text/html');
    const body = doc.body;
    body.querySelectorAll('script, style, link, meta, .navbox, .subnavbox, .noprint, .metadata, .mw-editsection, .mw-empty-elt, .mw-ref-follow')
        .forEach(el => el.remove());
    if (!images) body.querySelectorAll('figure, img, .thumb, .gallery').forEach(el => el.remove());
    body.querySelectorAll('img').forEach(img => {
        for (const a of ['src', 'srcset']) {
            const v = img.getAttribute(a);
            if (v) img.setAttribute(a, v.replace(/(^|,\s*)\/\//g, '$1https://'));
        }
        img.setAttribute('loading', 'lazy');
        img.removeAttribute('resource');
    });
    body.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || '';
        const isRef = !!a.closest('sup.reference') || /#cite_/.test(href);
        if (isRef || links === 'text') { a.replaceWith(...a.childNodes); return; }
        const internal = href.startsWith('./') ? _decode(href.slice(2).split('#')[0]) : null;
        if (internal && links === 'panel' && !/^[A-Za-z]+:/.test(internal)) {
            // link interno: elemento cliccabile per il flow (nessuna navigazione della dashboard)
            const span = doc.createElement('span');
            span.className = 'ra-wiki-link';
            span.setAttribute('role', 'button');
            span.setAttribute('tabindex', '0');
            span.setAttribute('data-wiki-title', internal.replace(/_/g, ' '));
            span.setAttribute('data-wiki-url', `${base}/wiki/${href.slice(2).split('#')[0]}`);
            span.setAttribute('title', internal.replace(/_/g, ' '));
            span.append(...a.childNodes);
            a.replaceWith(span);
            return;
        }
        const abs = internal != null ? `${base}/wiki/${href.slice(2)}` : href.startsWith('//') ? 'https:' + href : href;
        if (!/^https?:/i.test(abs)) { a.replaceWith(...a.childNodes); return; }
        a.setAttribute('href', abs);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
    });
    // marcature interne di Parsoid e id che potrebbero scontrarsi con quelli della dashboard
    body.querySelectorAll('*').forEach(el => {
        for (const at of [...el.attributes]) {
            const n = at.name;
            if (n === 'about' || n === 'typeof' || n === 'resource' || n === 'prefix' || n.startsWith('data-mw')) el.removeAttribute(n);
            else if (n === 'id') el.setAttribute('id', 'wiki-' + at.value);
        }
    });
    const art = doc.createElement('article');
    art.className = 'ra-wiki';
    art.setAttribute('lang', lang);
    const h1 = doc.createElement('h1');
    h1.textContent = title;
    art.append(h1, ...body.childNodes);
    return art.outerHTML;
}
