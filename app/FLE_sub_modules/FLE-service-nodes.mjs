// app/FLE_sub_modules/FLE-service-nodes.mjs
// Servizi esterni nei flow (2026-10-04) — _doc/arch-servizi-esterni.md, _doc/integrazione-ollama.md
//
//   ReseArch/Context/Service — definisce la connessione a un servizio (Ollama o ComfyUI, modalità
//                              direct) e la registra con un NOME di contesto in
//                              graph._fleServices[name]; gli altri nodi la usano senza fili
//   AI/Ollama/Chat           — chat con un modello Ollama; la memoria della conversazione è
//                              tenuta dal nodo (l'API di Ollama è senza stato)
//   AI/Ollama/Status         — versione, modelli caricati in memoria, VRAM occupata
//   AI/Ollama/Model Info     — capacità (vision…), contesto massimo, dimensione di un modello
//
// Uso da un altro nodo: widget "service" con il nome, poi
//   const svc = await fleUseService(this, this.properties.service, 'ollama');
//
// Sicurezza: Service apre una connessione verso un indirizzo scelto nel flow → NODO CRITICO
// (FV_CRITICAL_TYPES in api/flow_validation.php, property url). I nodi che lo usano no.
// Modalità proxy (servizi in rete via api/service_proxy.php): passo 3 della specifica, non
// ancora disponibile.
//
// Regole dei nodi: _doc/guide-fle-regole-nodi.md

import { createComfyClient } from "./FLE-comfyui-client.mjs";

const SERVICE_TYPES = ['ollama', 'comfyui'];
const SERVICE_MODES = ['direct', 'proxy'];
const DEFAULT_URLS  = { ollama: 'http://localhost:11434', comfyui: 'http://127.0.0.1:8188' };

// ── Client Ollama ───────────────────────────────────────────────────────────
function createOllamaClient(baseUrl) {
    const base = String(baseUrl || '').trim().replace(/\/+$/, '');
    const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
    /** Risposta HTTP già controllata (errori con messaggio chiaro). */
    async function send(path, init = {}) {
        let res;
        try {
            res = await fetch(base + path, init);
        } catch (err) {
            if (err?.name === 'AbortError') throw err;
            throw new Error(`Ollama not reachable at ${base}: is it running? It must allow the origin ${origin} (variable OLLAMA_ORIGINS)`);
        }
        if (!res.ok) {
            let msg = '';
            try { msg = (await res.json())?.error || ''; } catch { /* corpo non JSON */ }
            throw new Error(`Ollama ${res.status}${msg ? ': ' + msg : ''}`);
        }
        return res;
    }
    async function request(path, init = {}) { return (await send(path, init)).json(); }
    // Elenco dei modelli: richieste contemporanee unite in una sola, risultato tenuto per qualche
    // secondo (all'apertura di un flow lo chiedono il Service e ogni Chat)
    const MODELS_TTL = 5000;
    let models = [], modelsAt = 0, modelsInflight = null;
    const shown = new Map();   // nome modello → Promise di /api/show (le capacità non cambiano)
    return {
        type: 'ollama',
        url: base,
        /** Ultimo elenco dei modelli ottenuto (sincrono, per i menu a tendina). */
        get cachedModels() { return models; },
        /** Versione di Ollama. */
        async version() { return (await request('/api/version'))?.version ?? '?'; },
        /** Modelli caricati in memoria (/api/ps): [{ name, size, size_vram, expires_at, details }]. */
        async running() { return (await request('/api/ps'))?.models ?? []; },
        /** Nomi dei modelli installati. */
        listModels() {
            if (modelsInflight) return modelsInflight;
            if (modelsAt && Date.now() - modelsAt < MODELS_TTL) return Promise.resolve(models);
            modelsInflight = request('/api/tags')
                .then(j => { models = (j?.models ?? []).map(m => m.name).filter(Boolean); modelsAt = Date.now(); return models; })
                .finally(() => { modelsInflight = null; });
            return modelsInflight;
        },
        /**
         * Scheda di un modello (/api/show), tenuta in memoria: { capabilities, family, parameters,
         * quantization, context_length }. capabilities = ["completion", "vision", "tools", "thinking", …];
         * vuoto con versioni di Ollama che non le riportano.
         */
        show(model) {
            const name = String(model || '');
            if (!shown.has(name)) {
                const p = request('/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name }) })
                    .then(j => {
                        const info = j?.model_info ?? {};
                        const ctxKey = Object.keys(info).find(k => k.endsWith('.context_length'));
                        return {
                            capabilities:   Array.isArray(j?.capabilities) ? j.capabilities : [],
                            family:         j?.details?.family ?? '',
                            parameters:     j?.details?.parameter_size ?? '',
                            quantization:   j?.details?.quantization_level ?? '',
                            context_length: ctxKey ? Number(info[ctxKey]) || null : null,
                        };
                    });
                p.catch(() => shown.delete(name));   // errore (es. Ollama spento): si riprova la volta dopo
                shown.set(name, p);
            }
            return shown.get(name);
        },
        /**
         * Una richiesta di chat in streaming: Ollama manda la risposta a pezzi (una riga JSON per
         * pezzo); onChunk(testoFinora, pezzo) è chiamata a ogni pezzo. Restituisce il testo completo.
         * onStats({ duration_s, tokens, tokens_per_s }) è chiamata con i tempi dell'ultimo pezzo.
         */
        async chat({ model, messages, temperature, numCtx, signal, onChunk, onStats }) {
            const body = { model, messages, stream: true, options: {} };
            if (Number.isFinite(temperature)) body.options.temperature = temperature;
            if (numCtx > 0) body.options.num_ctx = Math.round(numCtx);   // contesto: il valore di base di Ollama è piccolo
            const res = await send('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = '', text = '';
            const handle = (line) => {
                if (!line.trim()) return false;
                const j = JSON.parse(line);
                if (j.error) throw new Error('Ollama: ' + j.error);
                const piece = j.message?.content ?? '';
                if (piece) { text += piece; onChunk?.(text, piece); }
                if (j.done && onStats) {
                    // durate in nanosecondi (API di Ollama)
                    const tokens = Number(j.eval_count) || 0, evalNs = Number(j.eval_duration) || 0;
                    onStats({
                        duration_s:   j.total_duration ? Math.round(j.total_duration / 1e8) / 10 : null,
                        tokens,
                        tokens_per_s: evalNs > 0 ? Math.round(tokens / (evalNs / 1e9) * 10) / 10 : null,
                    });
                }
                return !!j.done;
            };
            for (;;) {
                const { value, done } = await reader.read();
                if (value) buf += decoder.decode(value, { stream: true });
                let nl;
                while ((nl = buf.indexOf('\n')) !== -1) {
                    const line = buf.slice(0, nl);
                    buf = buf.slice(nl + 1);
                    if (handle(line)) { reader.cancel().catch(() => {}); return text; }
                }
                if (done) { handle(buf); return text; }
            }
        },
    };
}

/**
 * Client del servizio `name` nel grafo del nodo (Promise). Rifiuta con un messaggio chiaro se
 * nessun nodo Context/Service del grafo usa quel nome, o se il servizio è di un altro tipo.
 */
export function fleUseService(node, name, type) {
    name = String(name ?? '').trim();
    if (!name) return Promise.reject(new Error('set the service name ("service" widget)'));
    const entry = node?.graph?._fleServices?.[name];
    if (!entry) {
        return Promise.reject(new Error(`service "${name}" not defined: add to the flow a ReseArch/Context/Service node with name = ${name}`));
    }
    return entry.then(client => {
        if (type && client.type !== type) throw new Error(`the service "${name}" is of type ${client.type}, ${type} is needed`);
        return client;
    });
}

/**
 * Messaggio di stato di un nodo: scritto sul nodo, nell'uscita opzionale "status" (testo) e annunciato
 * dall'uscita opzionale "progress" (evento) — al più una volta al secondo (l'ultimo messaggio arriva
 * comunque), subito se force (fine, errore). Per mostrare l'avanzamento in una pagina HTM.
 */
export function fleReportStatus(node, text, force = false) {
    node._status = text ?? '';
    node.setDirtyCanvas?.(true, false);
    const si = node.findOutputSlot('status'), pi = node.findOutputSlot('progress');
    if (si !== -1) node.setOutputData(si, node._status);
    if (pi === -1) return;
    clearTimeout(node._progressTimer);
    node._progressTimer = null;
    const wait = 1000 - (Date.now() - (node._progressAt || 0));
    const emit = () => { node._progressTimer = null; node._progressAt = Date.now(); node.triggerSlot(pi); };
    if (force || wait <= 0) emit();
    else node._progressTimer = setTimeout(emit, wait);
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

export function registerServiceNodes(LG) {
    if (!LG) return;

    // ─────────────────────────────────────────────────────────────────────────
    // ReseArch/Context/Service
    // ─────────────────────────────────────────────────────────────────────────
    function ContextService() {
        this.addProperty('name', '',       'string');
        this.addProperty('type', 'ollama', 'string');
        this.addProperty('mode', 'direct', 'string');
        this.addProperty('url',  'http://localhost:11434', 'string');
        this.addWidget('text',  'name', '',       v => { this.properties.name = String(v ?? '').trim(); this._connect(); }, { property: 'name' });
        this.addWidget('combo', 'type', 'ollama', v => {
            // cambiando tipo, se l'url è ancora quello predefinito dell'altro tipo, passa al predefinito di questo
            if (Object.values(DEFAULT_URLS).includes(this.properties.url) && DEFAULT_URLS[v]) {
                this.properties.url = DEFAULT_URLS[v];
                const w = this.widgets?.find(x => x.name === 'url');
                if (w) w.value = DEFAULT_URLS[v];
            }
            this.properties.type = v; this._connect();
        }, { values: SERVICE_TYPES, property: 'type' });
        this.addWidget('combo', 'mode', 'direct', v => { this.properties.mode = v; this._connect(); }, { values: SERVICE_MODES, property: 'mode' });
        this.addWidget('text',  'url',  'http://localhost:11434', v => { this.properties.url = String(v ?? '').trim(); this._connect(); }, { property: 'url' });
        this.addInput('trigger',  LG.ACTION);
        this.addOutput('done',    LG.EVENT);
        this.addOutput('service', 'service');
        this._status = '';
        this._registered = null;
        this._seq = 0;
        this.color   = '#14532d';   // famiglia Creazione astratta
        this.bgcolor = '#166534';
        this.size    = [300, 150];
    }
    ContextService.error_output = true;
    ContextService.title = 'Context Service';
    ContextService.desc  = 'Defines the connection to an external service (Ollama or ComfyUI) and makes it available to the other nodes of the flow under a context name, without links (critical node: requires flow validation)';
    ContextService.portHelp = {
        inputs: {
            trigger: 'event — checks the connection again (e.g. after starting the service)',
        },
        outputs: {
            done:    'event — service reachable (checked when the flow opens, at every change and at every trigger)',
            service: 'service — reference to the client, for those who prefer to connect it with a link',
            error:   'event — service not reachable or invalid configuration. Port hidden by default: right click → Show error',
        },
        properties: {
            name: 'context name, e.g. ollama: the other nodes write it in their "service" widget',
            type: 'service type: ollama (language models) · comfyui (image workflows; requires the research_bridge package in ComfyUI)',
            mode: 'direct: the browser calls the service (Ollama on your own PC, or on the network with HTTPS) · proxy: through the platform server (not available yet)',
            url:  'direct only: service address, e.g. http://localhost:11434 (Ollama) or http://127.0.0.1:8188 (ComfyUI). The service must be started allowing the platform origin: OLLAMA_ORIGINS for Ollama, --enable-cors-header for ComfyUI',
        },
    };
    /** Crea il client, lo registra con il nome e verifica la connessione. */
    ContextService.prototype._connect = function () {
        const g = this.graph;
        if (!g) return;
        g._fleServices = g._fleServices || {};
        const seq = ++this._seq;
        if (this._registered && g._fleServices[this._registered]?._owner === this) delete g._fleServices[this._registered];
        this._registered = null;
        this.clearError?.();
        this.setOutputData(this.findOutputSlot('service'), null);
        const { name, type, mode, url } = this.properties;
        const fail = (msg) => { this._status = ''; this.triggerError?.(new Error(msg)); };
        if (!name) { this._status = 'set name'; this.setDirtyCanvas(true, false); return; }
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) { fail('invalid name (letters, digits, _)'); return; }
        if (!SERVICE_TYPES.includes(type)) { fail(`type "${type}" not available`); return; }
        if (mode === 'proxy') { fail('proxy mode not available yet: use direct'); return; }
        if (!/^https?:\/\//i.test(url || '')) { fail('url must start with http:// or https://'); return; }

        // stesso tipo e stesso indirizzo: si tiene il client (e la sua connessione), si ripete solo la verifica
        let client = this._client;
        const changed = !client || client.type !== type || client.url !== url.trim().replace(/\/+$/, '');
        if (changed) {
            this._client?.close?.();
            client = type === 'comfyui' ? createComfyClient(url) : createOllamaClient(url);
            this._client = client;
        }
        const entry = Promise.resolve(client);
        entry._owner = this;
        entry._client = client;             // accesso sincrono (menu "model" di Ollama Chat)
        g._fleServices[name] = entry;
        this._registered = name;
        this.setOutputData(this.findOutputSlot('service'), client);
        // chi ascolta il servizio (es. AI/ComfyUI/Receive) si riaggancia al client nuovo
        if (changed) for (const n of g._nodes ?? []) { if (n !== this) try { n.onServiceChanged?.(name); } catch (e) { console.error(e); } }

        this._status = 'checking connection…';
        this.setDirtyCanvas(true, false);
        const check = type === 'comfyui'
            ? client.check().then(i => `connected — ComfyUI ${i.version}`)
            : client.listModels().then(m => `connected — ${m.length} models`);
        check.then(text => {
            if (seq !== this._seq) return;
            this._status = text;
            this.setDirtyCanvas(true, false);
            this.triggerSlot(this.findOutputSlot('done'));
        }).catch(err => {
            if (seq !== this._seq) return;
            fail(err?.message || String(err));
        });
    };
    ContextService.prototype.onAction    = function () { this._connect(); };
    ContextService.prototype.onAdded     = function () { this._connect(); };
    ContextService.prototype.onConfigure = function () { this._connect(); };
    // grafo fermato (runner, editor): chiude le connessioni aperte; chi ascolta si riaggancia in onStart
    ContextService.prototype.onStop = function () { this._client?.close?.(); };
    ContextService.prototype.onRemoved = function () {
        this._client?.close?.();
        this._client = null;
        const g = this.graph;
        if (g?._fleServices && this._registered && g._fleServices[this._registered]?._owner === this) delete g._fleServices[this._registered];
        this._registered = null;
    };
    ContextService.prototype.onDrawForeground = function (ctx2d) {
        drawText(this, ctx2d, this._status, this._status.startsWith('connected') ? 'rgba(120,255,120,0.8)' : null);
    };
    LG.registerNodeType('ReseArch/Context/Service', ContextService);


    // ─────────────────────────────────────────────────────────────────────────
    // AI/Ollama/Chat
    // ─────────────────────────────────────────────────────────────────────────
    const CHAT_OPT_INPUTS  = [['history', 'array'], ['model', 'string'], ['context', 'string'], ['images', 'array']];
    const IMG_MAX_SIDE = 1536;   // immagini per i modelli vision: oltre, Ollama le riduce comunque

    /** Immagine (HTMLImageElement, canvas, video) → base64 JPEG senza prefisso, come vuole Ollama. */
    function imageToBase64(img) {
        const w0 = img.naturalWidth || img.videoWidth || img.width, h0 = img.naturalHeight || img.videoHeight || img.height;
        if (!w0 || !h0) throw new Error('image empty or not loaded yet');
        const k = Math.min(1, IMG_MAX_SIDE / Math.max(w0, h0));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);   // JPEG: niente trasparenza
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        try { return c.toDataURL('image/jpeg', 0.9).split(',')[1]; }
        catch (err) {
            if (err?.name === 'SecurityError') throw new Error('image from another site without CORS permission: it cannot be sent to the model');
            throw err;
        }
    }
    const CHAT_OPT_OUTPUTS = [['chunk', LG.EVENT], ['partial', 'string'], ['history', 'array'], ['duration_s', 'number'], ['tokens_per_s', 'number'], ['status', 'string'], ['progress', LG.EVENT]];
    const CHUNK_MS = 80;   // al più un evento chunk ogni 80 ms (Ollama manda decine di pezzi al secondo)

    function OllamaChat() {
        this.addProperty('service',     'ollama', 'string');
        this.addProperty('model',       '',       'string');
        this.addProperty('system',      '',       'string');
        this.addProperty('temperature', 0.7,      'number');
        this.addProperty('max_turns',   20,       'number');
        this.addProperty('num_ctx',     0,        'number');
        this.addWidget('text',   'service',     'ollama', v => { this.properties.service = String(v ?? '').trim(); }, { property: 'service' });
        this.addWidget('combo',  'model',       '',       v => { this.properties.model = v; }, { values: () => this._modelValues(), property: 'model' });
        this.addWidget('text',   'system',      '',       v => { this.properties.system = String(v ?? ''); }, { property: 'system' });
        this.addWidget('number', 'temperature', 0.7,      v => { this.properties.temperature = v; }, { min: 0, max: 2, step: 0.1, precision: 2, property: 'temperature' });
        this.addWidget('number', 'max_turns',   20,       v => { this.properties.max_turns = Math.max(1, Math.round(v)); }, { min: 1, max: 200, step: 10, precision: 0, property: 'max_turns' });
        this.addWidget('number', 'num_ctx',     0,        v => { this.properties.num_ctx = Math.max(0, Math.round(v)); }, { min: 0, max: 262144, step: 20480, precision: 0, property: 'num_ctx' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('reset',   LG.ACTION);
        this.addInput('prompt',  'string');
        this.addOutput('done',     LG.EVENT);
        this.addOutput('response', 'string');
        // history (ingresso e uscita): opzionali, tasto destro → Inputs / Outputs
        this._history = [];        // memoria della conversazione: NON salvata nel flow
        this._lastHistoryIn = null;
        this._models = [];
        this._status = '';
        this._seq = 0;
        this._abort = null;
        this.color   = '#1e3a5f';   // famiglia Calcolo
        this.bgcolor = '#1e40af';
        this.size    = [280, 210];
    }
    OllamaChat.error_output = true;
    OllamaChat.title = 'Ollama Chat';
    OllamaChat.desc  = 'Chat with an Ollama model: on trigger sends the prompt and returns the response. The node keeps the conversation memory (Ollama remembers nothing between requests); reset clears it';
    OllamaChat.portHelp = {
        inputs: {
            trigger: 'event — sends "prompt" as a new message; if it arrives while a response is in progress, it stops it and the new question starts',
            reset:   'event — clears the conversation memory (the "system" instructions stay)',
            prompt:  'text — the question',
            history: 'array of { role, content } — conversation to resume from: replaces the node memory at the first trigger after it arrives (optional: right click → Inputs)',
            model:   'text — model to query, e.g. chosen from a menu of the page (DOM Set Options + DOM Get Value); when connected and not empty it overrides the "model" widget (optional: right click → Inputs)',
            context: 'text — documents to send with the question (e.g. "text" of HTM/DOM/Get Files): added to the message and kept in the conversation memory, so follow-up questions can refer to them. Read when the trigger arrives (optional: right click → Inputs)',
            images:  'array of images — sent with the question to models with the "vision" capability (e.g. "images" of HTM/DOM/Get Files); with other models the node gives an error. Only for this question: the memory keeps a note, not the images (optional: right click → Inputs)',
        },
        outputs: {
            done:     'event — response complete',
            response: 'text — the model response',
            chunk:    'event — the response is arriving: fired while the model writes (at most every 80 ms; "partial" is already updated). To see the text grow, e.g. in a text node (optional: right click → Outputs)',
            partial:  'text — the response received so far, updated at every "chunk"; when complete it equals "response" (optional)',
            duration_s:   'number — total duration of the last response in seconds, measured by Ollama (including model loading) (optional)',
            tokens_per_s: 'number — generation speed of the last response, in tokens per second (optional)',
            status:       'text — the state written on the node: "waiting for <model>…", "generating… N characters", "N exchanges in memory · <model>", "error: …" (optional)',
            progress:     'event — the state changed (at most once per second; immediately at the end of the response and on error): connect it with "status" to DOM Set Text to show progress in a page (optional)',
            history:  'array of { role, content } — the conversation updated after the response, without the system message (optional: right click → Outputs)',
            error:    'event — service not reachable, missing model, empty prompt. Port hidden by default: right click → Show error',
        },
        properties: {
            service:     'name of a ReseArch/Context/Service node of type ollama',
            model:       'Ollama model (list of installed models); the first use of a model is slow because it must be loaded into memory',
            system:      'initial instructions for the model, e.g. "Answer in Italian, concisely"; empty = none',
            temperature: 'creativity of the response: 0 = more predictable, 1 and above = more varied',
            max_turns:   'how many question/answer exchanges to keep in memory: the oldest are dropped (the model reads a limited number of words anyway)',
            num_ctx:     'context size in tokens (how much text the model reads at once: memory + documents + question); 0 = the Ollama default, which is small (a few thousand tokens). Raise it for long documents, e.g. 32768: it uses more VRAM. The model maximum is given by AI/Ollama/Model Info (context_length)',
        },
    };
    /** Valori del menu "model": l'ultimo elenco noto del servizio; intanto lo aggiorna (per la prossima apertura). */
    OllamaChat.prototype._modelValues = function () {
        const client = this.graph?._fleServices?.[this.properties.service]?._client;
        if (client) { this._models = client.cachedModels; this._refreshModels(); }
        const cur = this.properties.model;
        return (cur && !this._models.includes(cur)) ? [cur, ...this._models] : (this._models.length ? this._models : [cur || '']);
    };
    OllamaChat.prototype._refreshModels = async function () {
        try {
            const svc = await fleUseService(this, this.properties.service, 'ollama');
            this._models = await svc.listModels();
            if (!this.properties.model && this._models.length) {
                this.properties.model = this._models[0];
                const w = this.widgets?.find(x => x.name === 'model');
                if (w) w.value = this.properties.model;
            }
            this.setDirtyCanvas(true, false);
        } catch { /* servizio non ancora pronto: l'elenco si riprova al prossimo trigger */ }
    };
    // Nessuna richiesta all'apertura del flow: l'elenco dei modelli si chiede all'apertura del menu
    // "model" o al primo trigger senza modello scelto
    OllamaChat.prototype.onConfigure = function () {
        for (const s of this.inputs  ?? []) if (CHAT_OPT_INPUTS.some(([n]) => n === s.name))  s.removable = true;
        for (const s of this.outputs ?? []) if (CHAT_OPT_OUTPUTS.some(([n]) => n === s.name)) s.removable = true;
    };
    OllamaChat.prototype.onGetInputs = function () {
        return CHAT_OPT_INPUTS.filter(([n]) => this.findInputSlot(n) === -1).map(([n, t]) => [n, t, { removable: true }]);
    };
    OllamaChat.prototype.onGetOutputs = function () {
        return CHAT_OPT_OUTPUTS.filter(([n]) => this.findOutputSlot(n) === -1).map(([n, t]) => [n, t, { removable: true }]);
    };
    OllamaChat.prototype._turnsText = function () {
        const n = Math.floor(this._history.length / 2);
        return `${n} ${n === 1 ? 'exchange' : 'exchanges'} in memory · ${this._activeModel || this.properties.model || 'no model'}`;
    };
    OllamaChat.prototype._trim = function () {
        const max = Math.max(1, Math.round(this.properties.max_turns || 20)) * 2;
        if (this._history.length > max) this._history = this._history.slice(this._history.length - max);
    };
    OllamaChat.prototype._setOut = function (name, value) {
        const i = this.findOutputSlot(name);
        if (i !== -1) this.setOutputData(i, value);
    };
    OllamaChat.prototype.onAction = async function (action) {
        if (action === 'reset') {
            this._abort?.abort();
            this._seq++;
            this._history = [];
            this.clearError?.();
            fleReportStatus(this, this._turnsText(), true);
            this._setOut('history', []);
            this.setDirtyCanvas(true, false);
            return;
        }
        // trigger
        const seq = ++this._seq;
        this._abort?.abort();               // interrompe la risposta in corso
        const abort = new AbortController();
        this._abort = abort;
        this.clearError?.();

        // conversazione da cui ripartire (ingresso opzionale): adottata una volta, al suo arrivo
        const hi = this.findInputSlot('history');
        const histIn = hi !== -1 ? this.getInputData(hi) : null;
        if (Array.isArray(histIn) && histIn !== this._lastHistoryIn) {
            this._lastHistoryIn = histIn;
            this._history = histIn
                .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
                .map(m => ({ role: m.role, content: m.content }));
        }

        const prompt = String(this.getInputData(this.findInputSlot('prompt')) ?? '').trim();
        // documenti e immagini (ingressi opzionali): letti SUBITO, prima di ogni attesa, perché il
        // flow può svuotarli appena dopo il trigger (allegati che valgono per una sola domanda)
        const ci = this.findInputSlot('context'), ii = this.findInputSlot('images');
        const context = ci !== -1 ? String(this.getInputData(ci) ?? '').trim() : '';
        const imagesIn = ii !== -1 ? this.getInputData(ii) : null;
        const images = Array.isArray(imagesIn) ? imagesIn.filter(Boolean) : [];
        const fail = (err) => {
            if (seq !== this._seq) return;
            this._abort = null;
            fleReportStatus(this, 'error: ' + (err?.message || err), true);
            this.triggerError?.(err);
        };
        if (!prompt) { fail(new Error('empty prompt')); return; }

        let svc;
        try { svc = await fleUseService(this, this.properties.service, 'ollama'); }
        catch (err) { fail(err); return; }
        if (seq !== this._seq) return;
        // modello: dall'ingresso "model" (es. menu della pagina) se collegato e non vuoto, altrimenti dal widget
        const mi = this.findInputSlot('model');
        const modelIn = mi !== -1 ? String(this.getInputData(mi) ?? '').trim() : '';
        if (!modelIn && !this.properties.model) {
            await this._refreshModels();
            if (seq !== this._seq) return;
            if (!this.properties.model) { fail(new Error('no model: install one in Ollama (ollama pull <name>) and choose it in the "model" widget')); return; }
        }
        const model = modelIn || this.properties.model;
        this._activeModel = model;

        // immagini: solo ai modelli con la capacità "vision" (se Ollama non riporta le capacità, si prova)
        let b64 = [];
        if (images.length) {
            try {
                const info = await svc.show(model).catch(() => null);
                if (info?.capabilities?.length && !info.capabilities.includes('vision')) {
                    throw new Error(`the model ${model} does not accept images (no "vision" capability): choose a vision model, e.g. gemma3, llava, qwen2.5vl`);
                }
                b64 = images.map(imageToBase64);
            } catch (err) { fail(err); return; }
            if (seq !== this._seq) return;
        }

        const content = context ? `${prompt}\n\n---\nAttached documents:\n\n${context}` : prompt;
        const user = { role: 'user', content };
        this._trim();
        const messages = [];
        if (this.properties.system) messages.push({ role: 'system', content: this.properties.system });
        messages.push(...this._history, b64.length ? { ...user, images: b64 } : user);
        // in memoria le immagini restano solo come nota (pesano troppo per rimandarle a ogni domanda)
        if (b64.length) user.content += `\n\n[${b64.length} ${b64.length === 1 ? 'image' : 'images'} attached to this question]`;

        const numCtx = Math.max(0, Math.round(Number(this.properties.num_ctx) || 0));
        const estTokens = Math.round(messages.reduce((a, m) => a + m.content.length, 0) / 4);
        const ctxWarn = estTokens > (numCtx || 4096) ? ` · ~${estTokens} tokens: may exceed the context, raise num_ctx` : '';

        fleReportStatus(this, `waiting for ${model}… (the first use of the model can take time)${ctxWarn}`, true);
        this._setOut('partial', '');
        this.setDirtyCanvas(true, false);
        // streaming: "partial" aggiornato a ogni pezzo, "chunk" al più ogni CHUNK_MS
        let lastChunk = 0, pendingChunk = null;
        const emitChunk = () => {
            pendingChunk = null;
            if (seq !== this._seq) return;
            lastChunk = Date.now();
            const ci = this.findOutputSlot('chunk');
            if (ci !== -1) this.triggerSlot(ci);
        };
        const onChunk = (sofar) => {
            if (seq !== this._seq) return;
            fleReportStatus(this, `generating… ${sofar.length} characters`);
            this._setOut('partial', sofar);
            this.setDirtyCanvas(true, false);
            if (pendingChunk) return;
            const wait = CHUNK_MS - (Date.now() - lastChunk);
            if (wait <= 0) emitChunk(); else pendingChunk = setTimeout(emitChunk, wait);
        };
        let text, stats = null;
        try {
            text = await svc.chat({ model, messages, temperature: Number(this.properties.temperature), numCtx, signal: abort.signal, onChunk, onStats: (st) => { stats = st; } });
        } catch (err) {
            if (err?.name === 'AbortError') return;   // interrotta da un nuovo trigger o da reset
            fail(err);
            return;
        }
        if (seq !== this._seq) return;
        if (pendingChunk) { clearTimeout(pendingChunk); emitChunk(); }   // ultimo pezzo, prima di done
        this._abort = null;
        this._history.push(user, { role: 'assistant', content: text });
        this._trim();
        fleReportStatus(this, this._turnsText(), true);
        this._setOut('response', text);
        this._setOut('partial', text);
        this._setOut('duration_s', stats?.duration_s ?? null);
        this._setOut('tokens_per_s', stats?.tokens_per_s ?? null);
        this._setOut('history', this._history.map(m => ({ ...m })));
        this.setDirtyCanvas(true, false);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    OllamaChat.prototype.onRemoved = function () { this._abort?.abort(); this._seq++; };
    OllamaChat.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('AI/Ollama/Chat', OllamaChat);


    // ─────────────────────────────────────────────────────────────────────────
    // AI/Ollama/Status — versione, modelli caricati in memoria, VRAM occupata
    // ─────────────────────────────────────────────────────────────────────────
    const GB = (b) => (b == null ? null : Math.round(b / 1e8) / 10);
    function OllamaStatus() {
        this.addProperty('service', 'ollama', 'string');
        this.addWidget('text', 'service', 'ollama', v => { this.properties.service = String(v ?? '').trim(); }, { property: 'service' });
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',         LG.EVENT);
        this.addOutput('server',       'string');
        this.addOutput('vram_used_gb', 'number');
        this.addOutput('loaded',       'string');
        this.addOutput('models',       'array');
        this.addOutput('installed',    'array');
        this.addOutput('address',      'string');
        this._status = '';
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [250, 150];
    }
    OllamaStatus.error_output = true;
    OllamaStatus.title = 'Ollama Status';
    OllamaStatus.desc  = 'On trigger reads the state of the Ollama server: version and address, models loaded in memory, VRAM they use and GPU share. Ollama reports neither a job queue nor the GPU name';
    OllamaStatus.portHelp = {
        inputs: { trigger: 'event — reads the state (e.g. from the done of Context Service on opening and from the done of Ollama Chat after every response)' },
        outputs: {
            done:         'event — state read',
            server:       'text — program, version and address, e.g. "Ollama 0.12.3 · localhost:11434" (address as written in Context Service)',
            vram_used_gb: 'number — VRAM used by the loaded models, in GB (0 if no model is in memory)',
            loaded:       'text — models in memory, with size and split between graphics card memory and RAM, e.g. "gemma3:12b · 9.1 GB · 76% in VRAM, 24% in RAM" (the RAM part is processed by the CPU, slower). It is NOT the GPU load. If memory is empty: "none (Ollama loads the model at the first question)" — Ollama unloads models after about 5 minutes of inactivity',
            installed:    'array of texts — models installed in Ollama (for a choice menu: DOM Set Options)',
            address:      'text — only the address, e.g. "localhost:11434" (as written in Context Service); set also when Ollama does not answer, before error (e.g. next to a connection light in the page)',
            models:       'array of { name, size_gb, vram_gb, gpu_pct, expires } — details of the loaded models; expires = when Ollama will unload them from memory',
            error:        'event — missing service or Ollama not reachable. Port hidden by default: right click → Show error',
        },
        properties: { service: 'name of a ReseArch/Context/Service node of type ollama' },
    };
    OllamaStatus.prototype.onAction = async function () {
        this.clearError?.();
        let svc, version, running, installed, host = '';
        try {
            svc = await fleUseService(this, this.properties.service, 'ollama');
            host = svc.url;
            try { host = new URL(svc.url).host; } catch { /* resta l'url */ }
            this.setOutputData(this.findOutputSlot('address'), host);   // anche se il server non risponde
            [version, running, installed] = await Promise.all([svc.version(), svc.running(), svc.listModels().catch(() => [])]);
        } catch (err) { this._status = ''; this.triggerError?.(err); return; }
        const models = running.map(m => ({
            name:    m.name || m.model,
            size_gb: GB(m.size),
            vram_gb: GB(m.size_vram),
            gpu_pct: m.size ? Math.round((m.size_vram || 0) / m.size * 100) : null,
            expires: m.expires_at || null,
        }));
        const vram = Math.round(running.reduce((a, m) => a + (m.size_vram || 0), 0) / 1e8) / 10;
        const where = (m) => m.gpu_pct == null ? '' : m.gpu_pct >= 100 ? ' · all in VRAM' : m.gpu_pct <= 0 ? ' · all in RAM (CPU)' : ` · ${m.gpu_pct}% in VRAM, ${100 - m.gpu_pct}% in RAM`;
        const loaded = models.length
            ? models.map(m => `${m.name}${m.size_gb != null ? ` · ${m.size_gb} GB` : ''}${where(m)}`).join(' | ')
            : 'none (Ollama loads the model at the first question)';
        const out = (n, v) => this.setOutputData(this.findOutputSlot(n), v);
        out('server', `Ollama ${version} · ${host}`);
        out('vram_used_gb', vram);
        out('loaded', loaded);
        out('models', models);
        out('installed', installed);
        this._status = `${models.length} ${models.length === 1 ? 'model' : 'models'} in memory · VRAM ${vram} GB`;
        this.setDirtyCanvas(true, false);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    OllamaStatus.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('AI/Ollama/Status', OllamaStatus);


    // ─────────────────────────────────────────────────────────────────────────
    // AI/Ollama/Model Info (2026-10-15) — capacità e contesto di un modello (/api/show)
    // ─────────────────────────────────────────────────────────────────────────
    function OllamaModelInfo() {
        this.addProperty('service', 'ollama', 'string');
        this.addProperty('model',   '',       'string');
        this.addWidget('text', 'service', 'ollama', v => { this.properties.service = String(v ?? '').trim(); }, { property: 'service' });
        this.addWidget('text', 'model',   '',       v => { this.properties.model = String(v ?? '').trim(); }, { property: 'model' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('model',   'string');
        this.addOutput('done',           LG.EVENT);
        this.addOutput('summary',        'string');
        this.addOutput('capabilities',   'array');
        this.addOutput('vision',         'boolean');
        this.addOutput('context_length', 'number');
        this.addOutput('parameters',     'string');
        this.addOutput('family',         'string');
        this._status = '';
        this.color   = '#1a2a4a';   // famiglia Get
        this.bgcolor = '#1e3a5f';
        this.size    = [250, 190];
    }
    OllamaModelInfo.error_output = true;
    OllamaModelInfo.title = 'Ollama Model Info';
    OllamaModelInfo.desc  = 'On trigger reads what a model can do: capabilities (text, images, tools…), maximum context, size and family. Useful to show it in the page or to send images only to vision models';
    OllamaModelInfo.portHelp = {
        inputs: {
            trigger: 'event — reads the model information',
            model:   'text — model name (e.g. from the menu of the page via DOM Get Value); when connected and not empty it overrides the widget',
        },
        outputs: {
            done:           'event — information read',
            summary:        'text — one line, e.g. "gemma3:12b · 12.2B · Q4_K_M · context 131072 · completion, vision"',
            capabilities:   'array of texts — e.g. ["completion", "vision"]: completion = writes text, vision = accepts images, tools = calls functions, thinking = reasons before answering, embedding = only vectors. Empty with Ollama versions that do not report them',
            vision:         'boolean — true if the model accepts images; also true when Ollama does not report the capabilities (old versions): then Ollama Chat simply tries',
            context_length: 'number — maximum context of the model in tokens (the num_ctx of Ollama Chat can go up to this value); null if unknown',
            parameters:     'text — size of the model, e.g. "12.2B" (billions of parameters)',
            family:         'text — model family, e.g. "gemma3"',
            error:          'event — missing service, Ollama not reachable, model not installed. Port hidden by default: right click → Show error',
        },
        properties: {
            service: 'name of a ReseArch/Context/Service node of type ollama',
            model:   'model name, used when the "model" input is not connected',
        },
    };
    OllamaModelInfo.prototype.onAction = async function () {
        this.clearError?.();
        const mi = this.findInputSlot('model');
        const model = String((mi !== -1 ? this.getInputData(mi) : null) ?? '').trim() || this.properties.model;
        let info;
        try {
            if (!model) throw new Error('no model: connect "model" or write it in the widget');
            const svc = await fleUseService(this, this.properties.service, 'ollama');
            info = await svc.show(model);
        } catch (err) { this._status = ''; this.triggerError?.(err); return; }
        const caps = info.capabilities;
        const summary = [model, info.parameters, info.quantization,
            info.context_length ? `context ${info.context_length}` : '', caps.length ? caps.join(', ') : 'capabilities not reported'].filter(Boolean).join(' · ');
        const out = (n, v) => this.setOutputData(this.findOutputSlot(n), v);
        out('summary', summary);
        out('capabilities', caps);
        out('vision', !caps.length || caps.includes('vision'));   // capacità non riportate: si prova, come Ollama Chat
        out('context_length', info.context_length);
        out('parameters', info.parameters);
        out('family', info.family);
        this._status = caps.length ? caps.join(', ') : 'capabilities not reported';
        this.setDirtyCanvas(true, false);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    OllamaModelInfo.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('AI/Ollama/Model Info', OllamaModelInfo);
}
