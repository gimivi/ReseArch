// app/AppBus-flow-nodes.mjs
// Nodi LiteGraph che comunicano con l'App Bus (app/app-bus.mjs) — menu "ReseArch/App Bus".
// Sostituiscono (2026-10-04) ReseArch/App/Local Emitter|Receiver e
// ReseArch/Dashboard/App Emitter|Receiver: una sola coppia, che si collega al bus da
// sola in ogni contesto (flow dell'oggetto, editor in pannello, runtime della dashboard),
// senza codice di collegamento esterno nel runtime o nell'editor.
//
//   Emitter  — al trigger PUBBLICA sul bus, sul topic configurato, il payload in ingresso
//              (eventualmente ridotto ai campi scelti); poi emette "done".
//   Receiver — ASCOLTA il topic sul bus ed emette "trigger" + "payload" a ogni messaggio.
//
// Toggle "bus" (predefinito ON, utile in sviluppo): spento, l'Emitter non pubblica ma
// emette comunque "done"/"→payload" (il resto del grafo si prova senza inviare nulla agli
// altri pannelli); il Receiver non ascolta. Per fermare del tutto un nodo: Mode → Disabled.
//
// Toggle "retain" dell'Emitter (2026-10-07, predefinito OFF): il bus ricorda l'ultimo
// messaggio del topic e il Receiver che si iscrive DOPO lo riceve subito (pannello aperto
// dopo l'emissione, flow avviato più tardi). Il messaggio trattenuto si cancella quando il
// grafo dell'Emitter si ferma (chiusura del pannello o del flow). Un nuovo messaggio dello
// stesso topic sostituisce il precedente.
//
// Messaggi del proprio grafo: l'Emitter marca il payload pubblicato con _fromFlow =
// etichetta del grafo (graph._fleBusTag); il Receiver ignora SOLO i messaggi con la stessa
// etichetta. Riceve quindi gli eventi delle APP e degli altri flow, anche dello stesso
// oggetto. I cicli sincroni fra grafi (A → B → A) si fermano a profondità MAX_DEPTH.
//
// Regole dei nodi: _doc/guide-fle-regole-nodi.md · Bus: _doc/arch-app-bus.md

import { appBusEmit, appBusOn, appBusRetained, appBusClearRetained } from "./app-bus.mjs";
import { getFieldsForTopic }     from "./FLE_sub_modules/FLE-app-schemas.mjs";

/**
 * Selezione dei campi di un payload: vuoto = tutto, un nome = valore diretto,
 * più nomi separati da virgola/punto e virgola = sottoinsieme { nome: valore, ... }.
 */
export function extractFields(data, fieldsRaw) {
    const raw = (fieldsRaw || '').trim();
    if (!raw) return data;
    const names = raw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    if (names.length === 1) return data?.[names[0]];
    const out = {};
    for (const n of names) out[n] = data?.[n];
    return out;
}

/** Etichetta del grafo per riconoscere i propri messaggi sul bus (creata se manca). */
function busTag(graph) {
    if (!graph) return null;
    if (!graph._fleBusTag) graph._fleBusTag = `graph:${Math.random().toString(36).slice(2, 10)}`;
    return graph._fleBusTag;
}

// Profondità di esecuzioni annidate scatenate dal bus (cicli fra grafi)
let _depth = 0;
const MAX_DEPTH = 8;

export function registerAppBusFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[AppBus-flow-nodes] LiteGraph non disponibile'); return; }
    if (window._APPBUS_FLOW_NODES_REGISTERED) return;
    window._APPBUS_FLOW_NODES_REGISTERED = true;

    // Famiglia di colore dedicata ai nodi che comunicano con il bus (guide-fle-regole-nodi.md §10)
    const COLOR   = '#3a2a00';
    const BGCOLOR = '#5a4200';

    /** Hint dei campi noti per il topic + stato del toggle, disegnati in basso sul nodo. */
    function drawFooter(node, ctx2d) {
        ctx2d.save();
        ctx2d.font = '9px monospace';
        if (node._fieldsHint) {
            ctx2d.fillStyle = 'rgba(255,255,255,0.32)';
            ctx2d.fillText(`fields: ${node._fieldsHint}`, 6, node.size[1] - 18);
        }
        ctx2d.fillStyle = node.properties.bus ? 'rgba(120,255,120,0.7)' : 'rgba(255,255,255,0.3)';
        ctx2d.fillText((node.properties.bus ? 'bus: ON' : 'bus: off') + (node.properties.retain ? ' · retain' : ''), 6, node.size[1] - 6);
        ctx2d.restore();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ReseArch/App Bus/Emitter
    // ─────────────────────────────────────────────────────────────────────────
    const EMITTER_OPTIONAL_OUTPUTS = [['→payload', 0]];

    function Emitter() {
        this.addProperty('topic',  '',   'string');
        this.addProperty('fields', '',   'string');
        this.addProperty('bus',    true, 'boolean');
        this.addWidget('text', 'topic', '', v => {
            this.properties.topic = String(v ?? '').trim();
            this._fieldsHint = getFieldsForTopic(this.properties.topic).join(', ');
        }, { property: 'topic' });
        this.addWidget('text',   'fields', '', v => { this.properties.fields = String(v ?? '').trim(); }, { property: 'fields' });
        this.addWidget('toggle', 'bus',    true, v => { this.properties.bus = v; }, { property: 'bus' });
        this.addProperty('retain', false, 'boolean');
        this.addWidget('toggle', 'retain', false, v => {
            this.properties.retain = !!v;
            if (!v) this._clearRetained();
        }, { property: 'retain' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('payload', 0);
        this.addOutput('done', LG.EVENT);
        // '→payload' opzionale (tasto destro → Outputs)
        this._fieldsHint = '';
        this._retainedTopics = new Set();
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [230, 142];
    }
    Emitter.title = 'Emitter';
    Emitter.desc  = 'On trigger publishes the input payload on the App Bus, on the configured topic (bus OFF: does not publish but still fires done)';
    Emitter.portHelp = {
        inputs: {
            trigger: 'event — publishes the payload on the bus (if the "bus" toggle is on) and then fires done',
            payload: 'any type — the value to publish. With empty "fields" everything is published; one name = only that field; several comma-separated names = subset. A plain object is published with its keys (plus objId/sourceApp of the panel); any other type as { value: payload }',
        },
        properties: {
            topic:  'channel name: the Receiver with the same topic receives the message',
            fields: 'payload fields to publish; empty = all',
            bus:    'off = does not publish (still fires done)',
            retain: 'on = the bus remembers the last message of the topic and delivers it also to Receivers that subscribe later (panel opened later). It is cleared when this flow stops',
        },
        outputs: {
            done:      'event — fired after publishing, or immediately if the "bus" toggle is off',
            '→payload': 'the same value received on "payload", to chain other nodes (optional: right click on the node → Outputs)',
        },
    };
    Emitter.prototype.onGetOutputs = function () {
        return EMITTER_OPTIONAL_OUTPUTS
            .filter(([name]) => this.findOutputSlot(name) === -1)
            .map(([name, type]) => [name, type, { removable: true }]);
    };
    Emitter.prototype.onConfigure = function () {
        for (const o of this.outputs ?? []) {
            if (EMITTER_OPTIONAL_OUTPUTS.some(([n]) => n === o.name)) o.removable = true;
        }
        this._fieldsHint = getFieldsForTopic(this.properties.topic).join(', ');
    };
    Emitter.prototype.onAction = function () {
        const payload = this.getInputData(this.findInputSlot('payload'));

        if (this.properties.bus && this.properties.topic) {
            const data       = extractFields(payload, this.properties.fields);
            const ctx        = this.graph?._appContext;
            const isPlainObj = data && typeof data === 'object' && !Array.isArray(data);
            const out = {
                objId:     ctx?.objId     ?? null,
                sourceApp: ctx?.sourceApp ?? null,
                ...(isPlainObj ? data : { value: data }),
                _fromFlow: busTag(this.graph),
            };
            appBusEmit(this.properties.topic, out, {
                sourceApp:     ctx?.sourceApp     ?? null,
                sourcePanelId: ctx?.sourcePanelId ?? null,
                retain:        !!this.properties.retain,
            });
            if (this.properties.retain && !this._retainedTopics.has(this.properties.topic)) {
                this._retainedTopics.add(this.properties.topic);
                ctx?.signal?.addEventListener('abort', () => this._clearRetained(), { once: true });
            }
        }

        // prima i dati, poi l'evento (triggerSlot chiama subito i nodi a valle)
        const p = this.findOutputSlot('→payload');
        if (p !== -1) this.setOutputData(p, payload);
        const d = this.findOutputSlot('done');
        if (d !== -1) this.triggerSlot(d);
    };
    /** Cancella i messaggi trattenuti pubblicati da questo grafo (solo se sono ancora i suoi). */
    Emitter.prototype._clearRetained = function () {
        const tag = busTag(this.graph);
        for (const topic of this._retainedTopics ?? []) {
            appBusClearRetained(topic, m => m?.payload?._fromFlow === tag);
        }
        this._retainedTopics?.clear();
    };
    Emitter.prototype.onRemoved = function () { this._clearRetained(); };
    Emitter.prototype.onDrawForeground = function (ctx2d) { drawFooter(this, ctx2d); };
    LG.registerNodeType('ReseArch/App Bus/Emitter', Emitter);


    // ─────────────────────────────────────────────────────────────────────────
    // ReseArch/App Bus/Receiver
    // ─────────────────────────────────────────────────────────────────────────
    const RECEIVER_OPTIONAL_OUTPUTS = [['panel', 'string']];

    function Receiver() {
        this.addProperty('topic',  '',   'string');
        this.addProperty('fields', '',   'string');
        this.addProperty('bus',    true, 'boolean');
        this.addWidget('text', 'topic', '', v => {
            this.properties.topic = String(v ?? '').trim();
            this._fieldsHint = getFieldsForTopic(this.properties.topic).join(', ');
            this._subscribe();
        }, { property: 'topic' });
        this.addWidget('text',   'fields', '', v => { this.properties.fields = String(v ?? '').trim(); }, { property: 'fields' });
        this.addWidget('toggle', 'bus',    true, v => { this.properties.bus = v; this._subscribe(); }, { property: 'bus' });
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('payload', 0);
        // 'panel' opzionale (tasto destro → Outputs)
        this._pending      = null;
        this._unsubscribe  = null;
        this._fieldsHint   = '';
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [230, 110];
    }
    Receiver.title = 'Receiver';
    Receiver.desc  = 'Listens to an App Bus topic and fires trigger + payload at every message (ignores only the messages published by its own graph)';
    Receiver.portHelp = {
        outputs: {
            trigger: 'event — fired at every message received on the topic (only if the "bus" toggle is on)',
            payload: 'the message payload: whole with empty "fields", the direct value with a single name, a subset { name: value } with several comma-separated names',
            panel:   'text — panel that published the message (sourcePanelId, or objName / obj:<id> from the payload); optional: right click on the node → Outputs',
        },
    };
    Receiver.prototype.onGetOutputs = function () {
        return RECEIVER_OPTIONAL_OUTPUTS
            .filter(([name]) => this.findOutputSlot(name) === -1)
            .map(([name, type]) => [name, type, { removable: true }]);
    };
    Receiver.prototype.onConfigure = function () {
        for (const o of this.outputs ?? []) {
            if (RECEIVER_OPTIONAL_OUTPUTS.some(([n]) => n === o.name)) o.removable = true;
        }
        this._fieldsHint = getFieldsForTopic(this.properties.topic).join(', ');
    };
    /** (Ri)aggancia l'ascolto: all'avvio del grafo, all'aggiunta del nodo, al cambio di topic o toggle. */
    Receiver.prototype._subscribe = function () {
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._pending = null;
        if (!this.properties.bus || !this.properties.topic) return;
        const ctx = this.graph?._appContext;
        if (!ctx?.signal) return;   // grafo non ancora avviato in un contesto: si aggancia in onStart

        const self = this;
        const topic = this.properties.topic;
        const deliver = msg => {
            const p = msg?.payload ?? {};
            if (p._fromFlow && p._fromFlow === busTag(self.graph)) return;   // messaggio del proprio grafo
            if (_depth >= MAX_DEPTH) {
                console.warn(`[App Bus] ciclo fra flow interrotto (profondità ${MAX_DEPTH}) — topic "${topic}".`);
                return;
            }
            const { _fromFlow, ...clean } = p;
            self._pending = {
                payload: clean,
                panel:   msg?.sourcePanelId ?? clean.objName ?? (clean.objId != null ? `obj:${clean.objId}` : null),
            };
            _depth++;
            try { self.graph?.runStep(1); } catch (e) { console.error('[App Bus] runStep:', e); }
            finally { _depth--; }
        };
        this._unsubscribe = appBusOn(topic, deliver, ctx.signal);

        // Messaggio trattenuto (Emitter con "retain"): consegnato subito, dopo che il grafo
        // ha finito di avviarsi (gli altri nodi devono aver ricevuto onStart)
        const retained = appBusRetained(topic);
        if (retained) {
            const sub = this._unsubscribe;
            setTimeout(() => {
                if (this._unsubscribe !== sub || ctx.signal.aborted) return;   // nel frattempo riagganciato o fermato
                deliver(retained);
            }, 0);
        }
    };
    Receiver.prototype.onStart   = function () { this._subscribe(); };
    Receiver.prototype.onAdded   = function () { this._subscribe(); };
    Receiver.prototype.onStop    = function () { this._unsubscribe?.(); this._unsubscribe = null; };
    Receiver.prototype.onRemoved = function () { this._unsubscribe?.(); this._unsubscribe = null; };
    Receiver.prototype.onExecute = function () {
        if (this._pending == null) return;
        const { payload, panel } = this._pending;
        this._pending = null;
        const pi = this.findOutputSlot('panel');
        if (pi !== -1) this.setOutputData(pi, panel);
        this.setOutputData(this.findOutputSlot('payload'), extractFields(payload, this.properties.fields));
        this.triggerSlot(this.findOutputSlot('trigger'));
    };
    Receiver.prototype.onDrawForeground = function (ctx2d) { drawFooter(this, ctx2d); };
    LG.registerNodeType('ReseArch/App Bus/Receiver', Receiver);
}
