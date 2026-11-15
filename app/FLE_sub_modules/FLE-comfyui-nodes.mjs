// app/FLE_sub_modules/FLE-comfyui-nodes.mjs
// Nodi del ponte ReseArch ↔ ComfyUI (2026-10-04) — _doc/integrazione-comfyui.md §9
//
//   AI/ComfyUI/Run     — esegue un workflow pubblicato in ComfyUI (nodo ReseArch Publish): un
//                        ingresso per ogni ReseArch *Input e un'uscita per ogni ReseArch *Output,
//                        riconosciuti dalla key
//   AI/ComfyUI/Receive — riceve i risultati con una key qualunque sia chi ha avviato il workflow
//                        (anche "Queue" in ComfyUI): l'annuncio research.output del pacchetto
//   AI/ComfyUI/Progress — stato dei Run del flow (coda, avanzamento, tempi), uguale per ogni workflow:
//                        il Run lo annuncia con client.emitRun, Progress lo ascolta (2026-10-17)
//   AI/ComfyUI/Queue  — stato della coda (in esecuzione / in attesa), anche in tempo reale
//   AI/ComfyUI/Jobs    — job recenti con tempi di attesa ed esecuzione, durata media
//   AI/ComfyUI/System  — risorse del server (GPU, VRAM, RAM)
//
// Connessione: ReseArch/Context/Service con type comfyui (widget "service" = il suo nome).
// Le porte di Run si salvano nel flow e NON vengono ricostruite al caricamento (si
// perderebbero i collegamenti): si allineano scegliendo il workflow o con "Update ports".
// Regole dei nodi: _doc/guide-fle-regole-nodi.md

import { fleUseService, fleReportStatus } from "./FLE-service-nodes.mjs";

// model = modello 3D: l'uscita è l'URL del file (testo), da collegare a TJS/Model/Load URL
// depth: mappa delle distanze EXR (ReseArch Depth Output) → URL, per TJS/Panorama/Set Depth (2026-10-19)
const PORT_TYPE = { text: 'string', number: 'number', image: 'image', model: 'string', depth: 'string' };
const PUBLISH_CLASS = 'ReseArchPublish';
// porte fisse di Run: nomi riservati (una key di workflow uguale darebbe errore)
// workflow = ingresso opzionale: esegue un altro workflow con le stesse porte (2026-10-17)
const RESERVED = new Set(['trigger', 'done', 'error', 'workflow']);
const FIXED_IN = new Set(['trigger', 'workflow']), FIXED_OUT = new Set(['done']);
const secs = (ms) => (ms == null ? null : Math.round(ms / 100) / 10);

function drawText(node, ctx2d, text, color) {
    if (!text || node.research_error || node.flags.collapsed) return;
    ctx2d.save();
    ctx2d.font = '9px monospace';
    ctx2d.fillStyle = color || 'rgba(255,255,255,0.45)';
    const max = Math.max(10, Math.floor((node.size[0] - 12) / 5.4));
    ctx2d.fillText(text.length > max ? text.slice(0, max - 1) + '…' : text, 6, node.size[1] - 6);
    ctx2d.restore();
}

/** Valore pronto per l'uscita di un nodo: testo, numero, immagine caricata, URL di un modello 3D. */
async function entryValue(client, entry) {
    if (entry.kind === 'image') return client.loadImage(entry);
    if (entry.kind === 'model' || entry.kind === 'depth') return client.fileUrl(entry);
    if (entry.kind === 'number') return Number(entry.value);
    return String(entry.value ?? '');
}

export function registerComfyNodes(LG) {
    if (!LG) return;

    // ─────────────────────────────────────────────────────────────────────────
    // AI/ComfyUI/Run
    // ─────────────────────────────────────────────────────────────────────────
    function ComfyRun() {
        this.addProperty('service',  'comfy', 'string');
        this.addProperty('workflow', '',      'string');
        this.addProperty('maxImageSide', 2048, 'number');
        this.addWidget('text',  'service',  'comfy', v => { this.properties.service = String(v ?? '').trim(); }, { property: 'service' });
        this.addWidget('combo', 'workflow', '',      v => { this.properties.workflow = v; this._updatePorts(); },
                       { values: () => this._workflowValues(), property: 'workflow' });
        this.addWidget('number', 'maxImageSide', 2048, v => { this.properties.maxImageSide = Math.max(0, Math.round(v)); },
                       { min: 0, max: 16384, step: 5120, precision: 0, property: 'maxImageSide' });
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        // ingressi/uscite dalle key del workflow scelto (vedi _updatePorts)
        this._workflows = [];
        this._status = '';
        this._seq = 0;
        this._promptId = null;
        this._off = null;
        this.color   = '#1e3a5f';   // famiglia Calcolo
        this.bgcolor = '#1e40af';
        this.size    = [280, 140];
    }
    ComfyRun.error_output = true;
    ComfyRun.title = 'ComfyUI Run';
    ComfyRun.desc  = 'On trigger runs in ComfyUI a workflow published with the ReseArch Publish node: the input values go to the ReseArch *Input nodes with the same key, the results of the ReseArch *Output nodes come out of the outputs with the same key. Queue position, progress and times: AI/ComfyUI/Progress';
    ComfyRun.portHelp = {
        inputs: {
            trigger: 'event — runs the workflow; if it arrives while a run is in progress, it stops it and the new one starts',
            workflow: 'text — runs this workflow instead of the one in the widget (e.g. from a dropdown in the page, with DOM Get Value); empty = the widget. It must have the same keys and types of the node ports, otherwise error and no run: right click → Check workflows compatibility (optional: right click → Inputs)',
        },
        outputs: {
            done:  'event — workflow completed, outputs ready (images are already loaded; a 3D model comes out as the file URL, to connect to the url input of TJS/Model/Load URL; a distance map (ReseArch Depth Output) as the EXR URL, for TJS/Panorama/Set Depth)',
            error: 'event — ComfyUI not reachable, invalid workflow (the message gives the node), error during the run, image that cannot be loaded. Port hidden by default: right click → Show error',
        },
        properties: {
            service:  'name of a ReseArch/Context/Service node of type comfyui',
            workflow: 'workflow published in ComfyUI with the ReseArch Publish node. The other inputs and outputs of the node are the keys of its ReseArch Input/Output nodes (text, number, image); if the workflow changes in ComfyUI: right click → Update ports. An unconnected input keeps the test value written in ComfyUI. With the workflow input connected it is the reference for the ports',
            maxImageSide: 'pixels — images sent to ComfyUI are scaled down so that the longer side is at most this value (proportions kept); 0 = original size. Large images are slow to send and may exceed the ComfyUI upload limit (--max-upload-size, 100 MB by default)',
        },
    };
    ComfyRun.prototype.onGetInputs = function () {
        return this.findInputSlot('workflow') === -1 ? [['workflow', 'string', { removable: true }]] : [];
    };
    ComfyRun.prototype.onConfigure = function () {
        const s = this.inputs?.find(i => i.name === 'workflow');
        if (s) s.removable = true;
    };
    /**
     * Differenze fra le porte del nodo e le key di un workflow ({ inputs, outputs } con key e kind):
     * [] = compatibile. Contano key e tipo, non l'ordine: le porte si collegano per nome.
     */
    ComfyRun.prototype._portDiff = function (def) {
        const have = {
            input:  (this.inputs  ?? []).filter(s => !FIXED_IN.has(s.name)).map(s => [s.name, s.type]),
            output: (this.outputs ?? []).filter(s => !FIXED_OUT.has(s.name) && !s.research_error).map(s => [s.name, s.type]),
        };
        const want = {
            input:  (def?.inputs  ?? []).map(i => [i.key, PORT_TYPE[i.kind] || 0]),
            output: (def?.outputs ?? []).map(o => [o.key, PORT_TYPE[o.kind] || 0]),
        };
        const diffs = [];
        for (const dir of ['input', 'output']) {
            for (const [k, t] of have[dir]) {
                const w = want[dir].find(([wk]) => wk === k);
                if (!w) diffs.push(`missing ${dir} «${k}» (${t})`);
                else if (w[1] !== t) diffs.push(`${dir} «${k}» is ${w[1]}, expected ${t}`);
            }
            for (const [k, t] of want[dir]) if (!have[dir].some(([hk]) => hk === k)) diffs.push(`extra ${dir} «${k}» (${t})`);
        }
        return diffs;
    };
    ComfyRun.prototype._checkCompatibility = async function () {
        try {
            const svc = await fleUseService(this, this.properties.service, 'comfyui');
            const list = await svc.listWorkflows(true);
            const ok = [], ko = [];
            for (const w of list) {
                if (w.name === this.properties.workflow) continue;
                const diffs = this._portDiff(w);
                if (diffs.length) ko.push(`  ${w.name}: ${diffs.join('; ')}`); else ok.push(`  ${w.name}`);
            }
            const msg = `Workflows that can go to the "workflow" input of this node (same keys and types as "${this.properties.workflow || '—'}"):\n\n` +
                (ok.length ? ok.join('\n') : '  none') +
                (ko.length ? `\n\nNot compatible:\n${ko.join('\n')}` : '');
            fleReportStatus(this, `${ok.length} compatible workflow${ok.length === 1 ? '' : 's'}`);
            if (typeof window !== 'undefined' && window.alert) window.alert(msg);
        } catch (err) { this.triggerError?.(err); }
    };
    ComfyRun.prototype._client = function () { return this.graph?._fleServices?.[this.properties.service]?._client ?? null; };
    ComfyRun.prototype._workflowValues = function () {
        const c = this._client();
        if (c?.type === 'comfyui') {
            this._workflows = c.cachedWorkflows;
            c.listWorkflows().then(l => { this._workflows = l; }).catch(() => {});
        }
        const names = this._workflows.map(w => w.name);
        const cur = this.properties.workflow;
        return (cur && !names.includes(cur)) ? [cur, ...names] : (names.length ? names : [cur || '']);
    };
    /**
     * Porte dinamiche = key del workflow; si toccano solo quelle cambiate (i collegamenti delle altre
     * restano). Restituisce { lost, added }: porte tolte che avevano fili, porte nuove.
     */
    ComfyRun.prototype._syncPorts = function (def) {
        const clash = [...(def?.inputs ?? []), ...(def?.outputs ?? [])].find(x => RESERVED.has(x.key));
        if (clash) throw new Error(`in the workflow the key "${clash.key}" is reserved (${[...RESERVED].join(', ')}): rename it in ComfyUI`);
        const wantIn  = (def?.inputs  ?? []).map(i => [i.key, PORT_TYPE[i.kind] || 0]);
        const wantOut = (def?.outputs ?? []).map(o => [o.key, PORT_TYPE[o.kind] || 0]);
        const lost = [], added = [];
        for (let i = (this.inputs?.length ?? 0) - 1; i >= 0; i--) {
            const s = this.inputs[i];
            if (FIXED_IN.has(s.name)) continue;
            if (!wantIn.some(([k, t]) => k === s.name && t === s.type)) {
                if (s.link != null) lost.push({ name: s.name, dir: 'input', links: 1 });
                this.removeInput(i);
            }
        }
        for (const [k, t] of wantIn) if (this.findInputSlot(k) === -1) { this.addInput(k, t); added.push({ name: k, dir: 'input' }); }
        for (let i = (this.outputs?.length ?? 0) - 1; i >= 0; i--) {
            const s = this.outputs[i];
            if (FIXED_OUT.has(s.name) || s.research_error) continue;
            if (!wantOut.some(([k, t]) => k === s.name && t === s.type)) {
                if (s.links?.length) lost.push({ name: s.name, dir: 'output', links: s.links.length });
                this.removeOutput(i);
            }
        }
        for (const [k, t] of wantOut) if (this.findOutputSlot(k) === -1) { this.addOutput(k, t); added.push({ name: k, dir: 'output' }); }
        this.setSize([Math.max(this.size[0], 280), Math.max(this.computeSize()[1], 120)]);
        this.setDirtyCanvas(true, true);
        return { lost, added };
    };
    ComfyRun.prototype._updatePorts = async function () {
        this.clearError?.();
        try {
            const svc = await fleUseService(this, this.properties.service, 'comfyui');
            if (!this.properties.workflow) { this._syncPorts(null); return; }
            const def = await svc.getWorkflow(this.properties.workflow);
            const { lost, added } = this._syncPorts(def);
            fleReportStatus(this, `${def.inputs.length} inputs, ${def.outputs.length} outputs`);
            // (2026-10-07) porte tolte che avevano fili: i collegamenti sono andati persi, va detto
            // (es. key cambiata in ComfyUI: "mesh" → "model"; prima spariva tutto in silenzio)
            if (lost.length) {
                const fmt = (p) => `«${p.name}» (${p.dir}${p.links ? `, ${p.links} ${p.links === 1 ? 'link' : 'links'}` : ''})`;
                const msg = `Update ports — workflow "${this.properties.workflow}":\n\n` +
                    `removed the connected ports ${lost.map(fmt).join(', ')}: they no longer exist in the workflow and their links have been removed.` +
                    (added.length ? `\n\nNew ports (to connect): ${added.map(p => `«${p.name}» (${p.dir})`).join(', ')}.` : '') +
                    `\n\nIf a key was renamed in ComfyUI, reconnect the links to the new port.`;
                console.warn('[ComfyUI Run] ' + msg.replace(/\n+/g, ' '));
                fleReportStatus(this, `warning: connected ports removed (${lost.map(p => p.name).join(', ')})`);
                if (typeof window !== 'undefined' && window.alert) window.alert(msg);
            }
        } catch (err) { fleReportStatus(this, ''); this.triggerError?.(err); }
        this.setDirtyCanvas(true, false);
    };
    ComfyRun.prototype.getExtraMenuOptions = function (_graph, options) {
        options.push({ content: '⟳ Update ports from workflow', callback: () => {
            const c = this._client(); c?.listWorkflows?.(true).catch(() => {});
            this._updatePorts();
        } });
        options.push({ content: 'Check workflows compatibility', callback: () => this._checkCompatibility() });
    };
    ComfyRun.prototype._stopCurrent = function () {
        clearInterval(this._ticker); this._ticker = null;
        this._off?.(); this._off = null;
        if (this._promptId) { const c = this._client(); c?.cancel?.(this._promptId).catch(() => {}); this._promptId = null; }
    };
    ComfyRun.prototype.onAction = async function () {
        const seq = ++this._seq;
        this._stopCurrent();
        this.clearError?.();
        let svc, def;
        // stato: scritto sul nodo e annunciato ai nodi ComfyUI Progress dello stesso servizio
        // workflow eseguito: l'ingresso opzionale, se ha un nome, altrimenti il widget
        const wi = this.findInputSlot('workflow');
        const override = wi !== -1 ? String(this.getInputData(wi) ?? '').trim() : '';
        const workflow = override || this.properties.workflow;
        const report = (phase, text, force = false, more = {}) => {
            if (seq !== this._seq) return;
            fleReportStatus(this, text, force);
            svc?.emitRun?.({ workflow, node: this.id, phase, text, position: null, percent: null, wait_s: null, exec_s: null, ...more });
        };
        const fail = (err) => {
            if (seq !== this._seq) return;
            clearInterval(this._ticker); this._ticker = null;
            this._off?.(); this._off = null; this._promptId = null;
            report('error', 'error: ' + (err?.message || err), true);
            this.triggerError?.(err);
        };
        try {
            svc = await fleUseService(this, this.properties.service, 'comfyui');
            if (!workflow) throw new Error('choose a workflow ("workflow" widget)');
            report('preparing', 'preparing…');
            def = await svc.getWorkflow(workflow);
            if (workflow !== this.properties.workflow) {
                const diffs = this._portDiff(def);
                if (diffs.length) throw new Error(`workflow "${workflow}" is not compatible with "${this.properties.workflow || '—'}" (the node ports): ${diffs.join('; ')}`);
            }
        } catch (err) { fail(err); return; }
        if (seq !== this._seq) return;

        // il workflow con i valori degli ingressi; senza il nodo Publish (non deve risalvarsi)
        const prompt = structuredClone(def.prompt || {});
        for (const [id, n] of Object.entries(prompt)) if (n?.class_type === PUBLISH_CLASS) delete prompt[id];
        try {
            for (const inp of def.inputs) {
                const slot = this.findInputSlot(inp.key);
                if (slot === -1 || this.inputs[slot].type !== (PORT_TYPE[inp.kind] || 0)) {
                    throw new Error(`the workflow has changed (key "${inp.key}"): right click → Update ports`);
                }
                const v = this.getInputData(slot);
                if (v == null) continue;                          // non collegato: resta il valore di prova
                const target = prompt[inp.node]?.inputs;
                if (!target) continue;
                if (inp.kind === 'image') {
                    report('preparing', `sending image "${inp.key}"…`);
                    target.image = await svc.uploadImage(v, `research_${inp.key}_${Date.now()}.png`, { maxSide: Number(this.properties.maxImageSide) || 0 });
                } else if (inp.kind === 'number') {
                    const n = Number(v);
                    if (!Number.isFinite(n)) throw new Error(`"${inp.key}" is not a number`);
                    target.value = n;
                } else {
                    target.value = String(v);
                }
                if (seq !== this._seq) return;
            }
        } catch (err) { fail(err); return; }

        // eventi di esecuzione dal WebSocket (con riserva: interrogazione della storia)
        const buffered = [];
        let promptId = null, finish = null;
        let queuedAt = null, startedAt = null, step = '', percent = null, lastQueueCheck = 0;
        const show = () => {
            if (seq !== this._seq || !startedAt) return;
            report('running', `running ${Math.round((Date.now() - startedAt) / 1000)} s${step ? ' · ' + step : ''}`, false,
                   { percent, wait_s: queuedAt ? secs(startedAt - queuedAt) : null, exec_s: secs(Date.now() - startedAt) });
        };
        const markStarted = () => {
            if (startedAt) return;
            startedAt = Date.now();
            clearInterval(this._ticker);
            this._ticker = setInterval(show, 1000);
        };
        // posizione in coda (solo finché non parte): ricalcolata quando ComfyUI annuncia un cambio di coda
        let queueTimer = null;
        const checkQueue = async () => {
            if (startedAt || !promptId) return;
            // al più una lettura ogni 300 ms; un avviso arrivato nel frattempo non si perde: lettura rimandata
            const waitMs = 300 - (Date.now() - lastQueueCheck);
            if (waitMs > 0) { if (!queueTimer) queueTimer = setTimeout(() => { queueTimer = null; checkQueue(); }, waitMs); return; }
            lastQueueCheck = Date.now();
            try {
                const q = await svc.getQueue();
                if (startedAt || seq !== this._seq) return;
                if (q.running.some(j => j.id === promptId)) { markStarted(); show(); return; }
                const pos = q.pending.findIndex(j => j.id === promptId);
                if (pos !== -1) {
                    report('queued', `queued: position ${pos + 1}${q.running.length ? ' (after the running job)' : ''}`, false,
                           { position: pos + 1, wait_s: queuedAt ? secs(Date.now() - queuedAt) : null });
                }
            } catch { /* coda non leggibile: resta "queued…" */ }
        };
        const handle = (msg) => {
            const d = msg?.data;
            if (msg?.type === 'status') { checkQueue(); return; }
            if (!d || d.prompt_id !== promptId) return;
            if (msg.type === 'execution_start') {
                markStarted(); show();
            } else if (msg.type === 'executing' && d.node != null) {
                markStarted(); step = prompt[d.node]?.class_type || String(d.node); percent = null; show();
            } else if (msg.type === 'progress') {
                markStarted(); step = `${prompt[d.node]?.class_type || ''} ${d.value}/${d.max}`.trim();
                percent = d.max > 0 ? Math.round(d.value / d.max * 100) : null; show();
            } else if (msg.type === 'execution_success') {
                finish?.(null);
            } else if (msg.type === 'execution_error') {
                finish?.(new Error(`error in ComfyUI (${d.node_type || 'node ' + d.node_id}): ${d.exception_message || 'unknown'}`));
            } else if (msg.type === 'execution_interrupted') {
                finish?.(new Error('run interrupted in ComfyUI'));
            }
        };
        let socketOk = true;
        try { await svc.ensureSocket(); } catch { socketOk = false; }
        this._off = svc.on((msg) => { if (promptId) handle(msg); else buffered.push(msg); });

        try {
            report('queued', 'queued…');
            queuedAt = Date.now();
            promptId = await svc.queuePrompt(prompt);
        } catch (err) { fail(err); return; }
        if (seq !== this._seq) { svc.cancel(promptId).catch(() => {}); return; }
        this._promptId = promptId;

        const outcome = new Promise((resolve) => { finish = resolve; });
        buffered.splice(0).forEach(handle);
        checkQueue();
        // riserva: se il WebSocket non c'è (o perde un messaggio), si guarda la storia a intervalli
        const poll = setInterval(async () => {
            try {
                const h = await svc.history(promptId);
                const st = h?.status;
                if (st?.completed || st?.status_str === 'success') finish(null);
                else if (st?.status_str === 'error') {
                    const m = (st.messages || []).find(x => x[0] === 'execution_error')?.[1];
                    finish(new Error(`error in ComfyUI: ${m?.exception_message || 'unknown'}`));
                }
            } catch { /* riprova */ }
        }, socketOk ? 5000 : 1000);
        const err = await outcome;
        clearInterval(poll);
        clearInterval(this._ticker); this._ticker = null;
        if (seq !== this._seq) return;
        if (err) { fail(err); return; }

        // risultati: dalla storia del prompt (fonte completa), per key
        let waitS = null, execS = null;
        try {
            report('running', 'reading results…', false, { percent: 100 });
            const h = await svc.history(promptId);
            // tempi misurati da ComfyUI (istanti di invio, inizio e fine registrati nella storia)
            const t = svc.timing(h);
            waitS = (t.created != null && t.start != null) ? secs(t.start - t.created) : null;
            execS = (t.start != null && t.end != null) ? secs(t.end - t.start) : (startedAt ? secs(Date.now() - startedAt) : null);
            const entries = [];
            for (const out of Object.values(h?.outputs ?? {})) entries.push(...(out?.research ?? []));
            for (const o of def.outputs) {
                const e = entries.find(x => x.key === o.key && x.kind === o.kind);
                const slot = this.findOutputSlot(o.key);
                if (slot === -1) continue;
                this.setOutputData(slot, e ? await entryValue(svc, e) : null);
                if (seq !== this._seq) return;
            }
        } catch (e) { fail(e); return; }
        this._off?.(); this._off = null; this._promptId = null;
        report('completed', execS != null ? `completed in ${execS} s${waitS ? ` (queued ${waitS} s)` : ''}` : 'completed', true,
               { percent: 100, wait_s: waitS, exec_s: execS });
        this.triggerSlot(this.findOutputSlot('done'));
    };
    ComfyRun.prototype.onRemoved = function () { this._seq++; this._stopCurrent(); };
    ComfyRun.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status, this._status.startsWith('completed') ? 'rgba(120,255,120,0.8)' : null); };
    LG.registerNodeType('AI/ComfyUI/Run', ComfyRun);


    // ─────────────────────────────────────────────────────────────────────────
    // AI/ComfyUI/Receive
    // ─────────────────────────────────────────────────────────────────────────
    const KINDS = ['text', 'number', 'image', 'model', 'depth'];
    function ComfyReceive() {
        this.addProperty('service', 'comfy', 'string');
        this.addProperty('key',     '',      'string');
        this.addProperty('kind',    'text',  'string');
        this.addWidget('text',  'service', 'comfy', v => { this.properties.service = String(v ?? '').trim(); this._subscribe(); }, { property: 'service' });
        this.addWidget('text',  'key',     '',      v => { this.properties.key = String(v ?? '').trim(); this._subscribe(); }, { property: 'key' });
        this.addWidget('combo', 'kind',    'text',  v => { this.properties.kind = v; this._applyKind(); this._subscribe(); }, { values: KINDS, property: 'kind' });
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('value',   'string');
        this._off = null;
        this._status = '';
        this._seq = 0;
        this.color   = '#062a1a';   // famiglia Eventi
        this.bgcolor = '#0a4a2e';
        this.size    = [240, 110];
    }
    ComfyReceive.error_output = true;
    ComfyReceive.title = 'ComfyUI Receive';
    ComfyReceive.desc  = 'Receives the results of the ComfyUI ReseArch Output nodes with a given key, whoever started the workflow (also the ComfyUI Queue button)';
    ComfyReceive.portHelp = {
        outputs: {
            trigger: 'event — a result with the given key has arrived (the "value" output is already set)',
            value:   'the result according to the "kind" widget: text, number, image, (model) the URL of the 3D model to connect to TJS/Model/Load URL, or (depth) the URL of the distance map EXR to connect to TJS/Panorama/Set Depth',
            error:   'event — missing service or image that cannot be loaded. Port hidden by default: right click → Show error',
        },
        properties: {
            service: 'name of a ReseArch/Context/Service node of type comfyui',
            key:     'key of the ReseArch Output node to listen to',
            kind:    'result type: text (ReseArch Text Output), number (Number Output), image (Image Output), model (Model Output: URL of the 3D file), depth (Depth Output: URL of the distance map EXR)',
        },
    };
    ComfyReceive.prototype._applyKind = function () {
        const t = PORT_TYPE[this.properties.kind] || 'string';
        const s = this.outputs?.[this.findOutputSlot('value')];
        if (s && s.type !== t) { s.type = t; this.setDirtyCanvas(true, true); }
    };
    ComfyReceive.prototype._unsubscribe = function () { this._off?.(); this._off = null; };
    ComfyReceive.prototype._subscribe = async function () {
        const seq = ++this._seq;
        this._unsubscribe();
        this.clearError?.();
        const { service, key, kind } = this.properties;
        if (!key) { this._status = 'set the key'; this.setDirtyCanvas(true, false); return; }
        let svc;
        try { svc = await fleUseService(this, service, 'comfyui'); }
        catch (err) { if (seq === this._seq) { this._status = ''; this.triggerError?.(err); } return; }
        if (seq !== this._seq) return;
        this._status = `listening: ${key} (${kind})`;
        this.setDirtyCanvas(true, false);
        this._off = svc.on(async (msg) => {
            if (msg?.type !== 'research.output') return;
            const e = msg.data;
            if (!e || e.key !== key || e.kind !== kind) return;
            try {
                const v = await entryValue(svc, e);
                this.setOutputData(this.findOutputSlot('value'), v);
                this._status = `received: ${key} · ${new Date().toLocaleTimeString()}`;
                this.setDirtyCanvas(true, false);
                this.triggerSlot(this.findOutputSlot('trigger'));
            } catch (err) { this.triggerError?.(err); }
        });
    };
    ComfyReceive.prototype.onConfigure = function () { this._applyKind(); setTimeout(() => this._subscribe(), 0); };
    ComfyReceive.prototype.onAdded     = function () { setTimeout(() => this._subscribe(), 0); };
    ComfyReceive.prototype.onStart     = function () { this._subscribe(); };
    ComfyReceive.prototype.onServiceChanged = function (name) { if (name === this.properties.service) this._subscribe(); };
    ComfyReceive.prototype.onStop      = function () { this._seq++; this._unsubscribe(); };
    ComfyReceive.prototype.onRemoved   = function () { this._seq++; this._unsubscribe(); };
    ComfyReceive.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('AI/ComfyUI/Receive', ComfyReceive);


    // ─────────────────────────────────────────────────────────────────────────
    // AI/ComfyUI/Progress (2026-10-17) — lo stato dei Run, separato dalle loro porte di workflow
    // ─────────────────────────────────────────────────────────────────────────
    const PHASES = 'preparing, queued, running, completed, error';
    function ComfyProgress() {
        this.addProperty('service',  'comfy', 'string');
        this.addProperty('workflow', '',      'string');
        this.addWidget('text',  'service',  'comfy', v => { this.properties.service = String(v ?? '').trim(); this._subscribe(); }, { property: 'service' });
        this.addWidget('combo', 'workflow', '',      v => { this.properties.workflow = v; this._status = ''; this.setDirtyCanvas(true, false); },
                       { values: () => this._workflowValues(), property: 'workflow' });
        this.addOutput('change',   LG.EVENT);
        this.addOutput('status',   'string');
        this.addOutput('phase',    'string');
        this.addOutput('percent',  'number');
        this.addOutput('wait_s',   'number');
        this.addOutput('exec_s',   'number');
        this.addOutput('workflow', 'string');
        this._workflows = [];
        this._off = null; this._seq = 0; this._status = '';
        this._phase = null; this._at = 0; this._timer = null;
        this.color   = '#062a1a';   // famiglia Eventi
        this.bgcolor = '#0a4a2e';
        this.size    = [250, 190];
    }
    ComfyProgress.error_output = true;
    ComfyProgress.title = 'ComfyUI Progress';
    ComfyProgress.desc  = 'State of the ComfyUI Run nodes of this flow, whatever the workflow: queue position, progress, times, completion or error. To show progress in a page or in the panel footer';
    ComfyProgress.portHelp = {
        outputs: {
            change:   'event — the state changed (at most once per second; immediately when the phase changes, at the end and on error); the other outputs are already updated',
            status:   'text — the state written on the Run node: "queued: position N", "running N s · <node> step/total", "completed in N s (queued M s)", "error: …"',
            phase:    `text — ${PHASES}: e.g. to show or hide a progress bar`,
            percent:  'number — 0-100, steps of the ComfyUI node running now (e.g. the sampler); empty when ComfyUI does not report steps; 100 at the end',
            wait_s:   'number — seconds in the queue (while waiting: so far; at the end: measured by ComfyUI)',
            exec_s:   'number — seconds of run time (while running: so far; at the end: measured by ComfyUI)',
            workflow: 'text — the workflow of the Run that sent the state',
            error:    'event — missing service. Port hidden by default: right click → Show error (an error of the Run arrives as phase "error", not here)',
        },
        properties: {
            service:  'name of a ReseArch/Context/Service node of type comfyui (the same as the Run nodes)',
            workflow: 'empty = all the Run nodes of the flow on this service; or the name of one workflow',
        },
    };
    ComfyProgress.prototype._workflowValues = function () {
        const c = this.graph?._fleServices?.[this.properties.service]?._client ?? null;
        if (c?.type === 'comfyui') {
            this._workflows = c.cachedWorkflows;
            c.listWorkflows().then(l => { this._workflows = l; }).catch(() => {});
        }
        const names = this._workflows.map(w => w.name);
        const cur = this.properties.workflow;
        return ['', ...(cur && !names.includes(cur) ? [cur] : []), ...names];
    };
    ComfyProgress.prototype._unsubscribe = function () {
        this._off?.(); this._off = null;
        clearTimeout(this._timer); this._timer = null;
    };
    ComfyProgress.prototype._subscribe = async function () {
        const seq = ++this._seq;
        this._unsubscribe();
        this.clearError?.();
        let svc;
        try { svc = await fleUseService(this, this.properties.service, 'comfyui'); }
        catch (err) { if (seq === this._seq) this.triggerError?.(err); return; }
        if (seq !== this._seq) return;
        this._off = svc.onRun((info) => this._apply(info));
    };
    ComfyProgress.prototype._apply = function (info) {
        const wf = this.properties.workflow;
        if (wf && info.workflow !== wf) return;
        const out = (n, v) => { const i = this.findOutputSlot(n); if (i !== -1) this.setOutputData(i, v); };
        out('status', info.text);
        out('phase', info.phase);
        out('percent', info.percent);
        out('wait_s', info.wait_s);
        out('exec_s', info.exec_s);
        out('workflow', info.workflow);
        this._status = wf ? info.text : `${info.workflow}: ${info.text}`;
        this.setDirtyCanvas(true, false);
        // evento al più una volta al secondo; subito a ogni cambio di fase (fine ed errore compresi)
        const force = info.phase !== this._phase;
        this._phase = info.phase;
        clearTimeout(this._timer); this._timer = null;
        const emit = () => { this._timer = null; this._at = Date.now(); this.triggerSlot(this.findOutputSlot('change')); };
        const wait = 1000 - (Date.now() - this._at);
        if (force || wait <= 0) emit();
        else this._timer = setTimeout(emit, wait);
    };
    ComfyProgress.prototype.onConfigure = function () { setTimeout(() => this._subscribe(), 0); };
    ComfyProgress.prototype.onAdded     = function () { setTimeout(() => this._subscribe(), 0); };
    ComfyProgress.prototype.onStart     = function () { this._subscribe(); };
    ComfyProgress.prototype.onServiceChanged = function (name) { if (name === this.properties.service) this._subscribe(); };
    ComfyProgress.prototype.onStop      = function () { this._seq++; this._unsubscribe(); };
    ComfyProgress.prototype.onRemoved   = function () { this._seq++; this._unsubscribe(); };
    ComfyProgress.prototype.onDrawForeground = function (ctx2d) {
        drawText(this, ctx2d, this._status || (this.properties.workflow ? `waiting: ${this.properties.workflow}` : 'waiting: all workflows'),
                 this._phase === 'completed' ? 'rgba(120,255,120,0.8)' : null);
    };
    LG.registerNodeType('AI/ComfyUI/Progress', ComfyProgress);


    // ─────────────────────────────────────────────────────────────────────────
    // Informazioni sul server: coda, job recenti, risorse (famiglia Get)
    // ─────────────────────────────────────────────────────────────────────────
    const COL_GET = ['#1a2a4a', '#1e3a5f'];
    const GB = (bytes) => (bytes == null ? null : Math.round(bytes / 1e8) / 10);   // byte → GB, 1 decimale

    // ── AI/ComfyUI/Queue ─────────────────────────────────────────────────────
    function ComfyQueue() {
        this.addProperty('service', 'comfy', 'string');
        this.addWidget('text', 'service', 'comfy', v => { this.properties.service = String(v ?? '').trim(); this._subscribe(); }, { property: 'service' });
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',    LG.EVENT);
        this.addOutput('running', 'number');
        this.addOutput('pending', 'number');
        this.addOutput('jobs',    'array');
        // 'change' (evento a ogni cambio della coda): uscita opzionale
        this._off = null; this._seq = 0; this._status = ''; this._last = null; this._busy = null;   // _last null: la prima lettura conta come cambiamento
        this.color = COL_GET[0]; this.bgcolor = COL_GET[1];
        this.size = [240, 110];
    }
    ComfyQueue.error_output = true;
    ComfyQueue.title = 'ComfyUI Queue';
    ComfyQueue.desc  = 'State of the ComfyUI queue: how many jobs are running and pending, in their order; with the optional change output it notifies every change of the queue';
    ComfyQueue.portHelp = {
        inputs: { trigger: 'event — reads the queue now' },
        outputs: {
            done:    'event — queue read (after a trigger)',
            running: 'number — running jobs (usually 0 or 1)',
            pending: 'number — pending jobs',
            jobs:    'array of { id, status, position, mine, created } — first the running ones (status in_progress), then the pending ones (pending) in order; mine = queued by this flow; created = submission time (ms)',
            change:  'event — the queue changed (ComfyUI notice on the WebSocket, no polling); the other outputs are already updated (optional: right click → Outputs)',
            error:   'event — missing service or ComfyUI not reachable. Port hidden by default: right click → Show error',
        },
        properties: { service: 'name of a ReseArch/Context/Service node of type comfyui' },
    };
    ComfyQueue.prototype.onGetOutputs = function () {
        return this.findOutputSlot('change') === -1 ? [['change', LG.EVENT, { removable: true }]] : [];
    };
    ComfyQueue.prototype._read = async function () {
        const svc = await fleUseService(this, this.properties.service, 'comfyui');
        const q = await svc.getQueue();
        const jobs = [...q.running, ...q.pending];
        this.setOutputData(this.findOutputSlot('running'), q.running.length);
        this.setOutputData(this.findOutputSlot('pending'), q.pending.length);
        this.setOutputData(this.findOutputSlot('jobs'), jobs);
        const mine = jobs.filter(j => j.mine).length;
        this._status = `${q.running.length} running · ${q.pending.length} pending${mine ? ` · ${mine} from this flow` : ''}`;
        this.setDirtyCanvas(true, false);
        const sig = jobs.map(j => j.id + j.status).join('|');
        const changed = sig !== this._last;
        this._last = sig;
        return changed;
    };
    ComfyQueue.prototype.onAction = async function () {
        this.clearError?.();
        try { await this._read(); } catch (err) { this._status = ''; this.triggerError?.(err); return; }
        this.triggerSlot(this.findOutputSlot('done'));
    };
    ComfyQueue.prototype._subscribe = async function () {
        const seq = ++this._seq;
        this._off?.(); this._off = null;
        if (this.findOutputSlot('change') === -1) return;     // senza "change" non serve ascoltare
        let svc;
        try { svc = await fleUseService(this, this.properties.service, 'comfyui'); } catch { return; }
        if (seq !== this._seq) return;
        this._off = svc.on((msg) => {
            if (msg?.type !== 'status') return;
            if (this._busy) return;                            // una lettura alla volta
            this._busy = this._read()
                .then(changed => { const ci = this.findOutputSlot('change'); if (changed && ci !== -1) this.triggerSlot(ci); })
                .catch(err => this.triggerError?.(err))
                .finally(() => { this._busy = null; });
        });
    };
    ComfyQueue.prototype.onConnectionsChange = function (type, slot) {
        if (type === LG.OUTPUT && this.outputs?.[slot]?.name === 'change') setTimeout(() => this._subscribe(), 0);
    };
    ComfyQueue.prototype.onConfigure = function () {
        const s = this.outputs?.find(o => o.name === 'change');
        if (s) s.removable = true;
        setTimeout(() => this._subscribe(), 0);
    };
    ComfyQueue.prototype.onOutputAdded = function () { setTimeout(() => this._subscribe(), 0); };
    ComfyQueue.prototype.onOutputRemoved = function () { setTimeout(() => this._subscribe(), 0); };
    ComfyQueue.prototype.onStart = function () { this._subscribe(); };
    ComfyQueue.prototype.onServiceChanged = function (name) { if (name === this.properties.service) this._subscribe(); };
    ComfyQueue.prototype.onStop = function () { this._seq++; this._off?.(); this._off = null; };
    ComfyQueue.prototype.onRemoved = function () { this.onStop(); };
    ComfyQueue.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('AI/ComfyUI/Queue', ComfyQueue);

    // ── AI/ComfyUI/Jobs ──────────────────────────────────────────────────────
    const JOB_FILTERS = ['all', 'completed', 'failed'];
    function ComfyJobs() {
        this.addProperty('service', 'comfy', 'string');
        this.addProperty('limit',   20,      'number');
        this.addProperty('status',  'all',   'string');
        this.addWidget('text',   'service', 'comfy', v => { this.properties.service = String(v ?? '').trim(); }, { property: 'service' });
        this.addWidget('number', 'limit',   20,      v => { this.properties.limit = Math.max(1, Math.min(200, Math.round(v))); }, { min: 1, max: 200, step: 10, precision: 0, property: 'limit' });
        this.addWidget('combo',  'status',  'all',   v => { this.properties.status = v; }, { values: JOB_FILTERS, property: 'status' });
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',       LG.EVENT);
        this.addOutput('jobs',       'array');
        this.addOutput('avg_exec_s', 'number');
        this._status = '';
        this.color = COL_GET[0]; this.bgcolor = COL_GET[1];
        this.size = [240, 130];
    }
    ComfyJobs.error_output = true;
    ComfyJobs.title = 'ComfyUI Jobs';
    ComfyJobs.desc  = 'On trigger lists the recent ComfyUI jobs with state and times (queue wait, run) and the average duration: useful to estimate how long it will take';
    ComfyJobs.portHelp = {
        inputs: { trigger: 'event — reads the recent jobs' },
        outputs: {
            done:       'event — list read',
            jobs:       'array of { id, status, created, wait_s, exec_s } from the most recent — status: pending, in_progress, completed, failed, cancelled; created = submission time (ms); wait_s / exec_s in seconds (null if not known yet)',
            avg_exec_s: 'number — average run time of the completed jobs in the list, in seconds (null if none)',
            error:      'event — missing service, ComfyUI not reachable, or a ComfyUI version without the job list. Port hidden by default: right click → Show error',
        },
        properties: {
            service: 'name of a ReseArch/Context/Service node of type comfyui',
            limit:   'maximum number of jobs, from the most recent',
            status:  'all: all · completed: completed only · failed: failed only',
        },
    };
    ComfyJobs.prototype.onAction = async function () {
        this.clearError?.();
        let list;
        try {
            const svc = await fleUseService(this, this.properties.service, 'comfyui');
            const st = this.properties.status === 'all' ? '' : this.properties.status;
            list = await svc.getJobs({ limit: this.properties.limit || 20, status: st });
        } catch (err) { this._status = ''; this.triggerError?.(err); return; }
        const jobs = list.map(j => ({
            id: j.id,
            status: j.status,
            created: j.create_time ?? null,
            wait_s: (j.create_time != null && j.execution_start_time != null) ? secs(j.execution_start_time - j.create_time) : null,
            exec_s: (j.execution_start_time != null && j.execution_end_time != null) ? secs(j.execution_end_time - j.execution_start_time) : null,
        }));
        const done = jobs.filter(j => j.status === 'completed' && j.exec_s != null);
        const avg = done.length ? Math.round(done.reduce((a, j) => a + j.exec_s, 0) / done.length * 10) / 10 : null;
        this.setOutputData(this.findOutputSlot('jobs'), jobs);
        this.setOutputData(this.findOutputSlot('avg_exec_s'), avg);
        this._status = `${jobs.length} job${avg != null ? ` · average ${avg} s` : ''}`;
        this.setDirtyCanvas(true, false);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    ComfyJobs.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('AI/ComfyUI/Jobs', ComfyJobs);

    // ── AI/ComfyUI/System ────────────────────────────────────────────────────
    function ComfySystem() {
        this.addProperty('service', 'comfy', 'string');
        this.addWidget('text', 'service', 'comfy', v => { this.properties.service = String(v ?? '').trim(); }, { property: 'service' });
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',          LG.EVENT);
        this.addOutput('gpu',           'string');
        this.addOutput('vram_free_gb',  'number');
        this.addOutput('vram_total_gb', 'number');
        this.addOutput('ram_free_gb',   'number');
        this.addOutput('info',          'object');
        this.addOutput('server',        'string');
        this.addOutput('address',       'string');
        this._status = '';
        this.color = COL_GET[0]; this.bgcolor = COL_GET[1];
        this.size = [250, 170];
    }
    ComfySystem.error_output = true;
    ComfySystem.title = 'ComfyUI System';
    ComfySystem.desc  = 'On trigger reads the ComfyUI server resources: graphics card, free and total video memory (VRAM), free RAM, versions';
    ComfySystem.portHelp = {
        inputs: { trigger: 'event — reads the resources now' },
        outputs: {
            done:          'event — resources read',
            gpu:           'text — name of the first compute device (usually the graphics card)',
            vram_free_gb:  'number — free video memory, in GB (first device)',
            vram_total_gb: 'number — total video memory, in GB',
            ram_free_gb:   'number — free server RAM, in GB',
            server:        'text — program, version and address of the server, e.g. "ComfyUI 0.3.62 · 127.0.0.1:8188" (address as written in Context Service)',
            address:       'text — only the address, e.g. "127.0.0.1:8188" (as written in Context Service); set also when ComfyUI does not answer, before error (e.g. next to a connection light in the page)',
            info:          'object — everything ComfyUI reports: { system: { os, ram_total, ram_free, comfyui_version, python_version, pytorch_version, … }, devices: [ { name, type, vram_total, vram_free, … } ] } (bytes)',
            error:         'event — missing service or ComfyUI not reachable. Port hidden by default: right click → Show error',
        },
        properties: { service: 'name of a ReseArch/Context/Service node of type comfyui' },
    };
    ComfySystem.prototype.onAction = async function () {
        this.clearError?.();
        let st, svc, host = '';
        try {
            svc = await fleUseService(this, this.properties.service, 'comfyui');
            host = svc.url;
            try { host = new URL(svc.url).host; } catch { /* resta l'url */ }
            this.setOutputData(this.findOutputSlot('address'), host);   // anche se il server non risponde
            st = await svc.systemStats();
        } catch (err) { this._status = ''; this.triggerError?.(err); return; }
        const dev = st?.devices?.[0] ?? null;
        const out = (n, v) => this.setOutputData(this.findOutputSlot(n), v);
        out('gpu', dev?.name ?? null);
        out('vram_free_gb', GB(dev?.vram_free));
        out('vram_total_gb', GB(dev?.vram_total));
        out('ram_free_gb', GB(st?.system?.ram_free));
        out('info', st ?? null);
        out('server', `ComfyUI ${st?.system?.comfyui_version || '?'} · ${host}`);
        this._status = dev ? `${String(dev.name || dev.type).replace(/^cuda:\d+\s*/, '')} · VRAM ${GB(dev.vram_free)}/${GB(dev.vram_total)} GB` : 'no device';
        this.setDirtyCanvas(true, false);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    ComfySystem.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('AI/ComfyUI/System', ComfySystem);
}
