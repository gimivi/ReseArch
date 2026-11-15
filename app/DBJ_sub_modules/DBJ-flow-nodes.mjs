// app/DBJ_sub_modules/DBJ-flow-nodes.mjs
// Nodi LiteGraph context-aware per pannelli DBJ (JSON data viewer, Tabulator
// su mod_spec.data.records). Leggono/scrivono lo stato del pannello via
// graph._appContext (vedi DBJ-flow-runner.mjs) — mai import diretto di
// model_DBJ.mjs (isolamento per pannello, stesso pattern di
// MPS-flow-nodes.mjs/OSD-flow-nodes.mjs).
//
// DBJ è di sola lettura (nessuna CRUD, a differenza di MYS) e senza
// multi-modello (a differenza di GSH/MYS): il set di nodi riflette
// esattamente le capacità reali del modulo, niente di inventato.
//
// Due famiglie:
//   DBS/DBJ/Events/* — sorgenti (onStart → _pending → onExecute, come
//                      MPS/Events/*): si agganciano da sole al localEvents
//                      del pannello, producono trigger+dati.
//   DBS/DBJ/Data/*   — azioni (onAction, non onExecute): leggono/ricaricano
//                      i dati del pannello quando ricevono un trigger EVENT.

export function registerDBJFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[DBJ-flow-nodes] LiteGraph not available'); return; }
    if (window._DBJ_FLOW_NODES_REGISTERED) return;
    window._DBJ_FLOW_NODES_REGISTERED = true;

    const COLOR   = '#2a1a3a';
    const BGCOLOR = '#4a2a68';
    const EVCOLOR   = '#1a2a3a';
    const EVBGCOLOR = '#2a4a68';

    // ─────────────────────────────────────────────────────────────────────────
    // DBS/DBJ/Events/OnRowSelected
    // ─────────────────────────────────────────────────────────────────────────
    function DBJEventsOnRowSelected() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('row',     'object');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 80];
    }
    DBJEventsOnRowSelected.title = 'Events On Row Selected';
    DBJEventsOnRowSelected.desc  = 'Fires when a row of the table is clicked';
    DBJEventsOnRowSelected.portHelp = {
        outputs: {
            trigger: "Event: fires once for every click on a row of the Tabulator table.",
            row: "JS object of the clicked row — the same keys/values as the row in mod_spec.data.records (free structure, depends on the columns of the JSON loaded in the model), not an ID.",
        },
    };
    DBJEventsOnRowSelected.prototype.onStart = function () {
        // Rimuove un'eventuale sottoscrizione precedente prima di ricrearla —
        // onStart può essere richiamato più volte quando il contesto del
        // grafo cambia (model_FLE.mjs::_injectTestContext/_reinitGraphNodes),
        // stesso motivo di MPSEventsOnMarkerClick (MPS-flow-nodes.mjs).
        this._cleanup?.();
        this._cleanup = null;
        const ctx = this.graph?._appContext;
        const bus = ctx?.localEvents;
        if (!bus) return;
        this._pending = null;
        const g = this.graph, self = this;
        const handler = ev => {
            self._pending = ev.detail;
            try { g.runStep(1); } catch {}
        };
        bus.addEventListener('rowSelected', handler);
        this._cleanup = () => bus.removeEventListener('rowSelected', handler);
        ctx.signal?.addEventListener('abort', () => this._cleanup?.(), { once: true });
    };
    DBJEventsOnRowSelected.prototype.onStop = function () {
        this._cleanup?.();
        this._cleanup = null;
    };
    DBJEventsOnRowSelected.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(1, p);
        this.triggerSlot(0);
    };
    LG.registerNodeType('DBS/DBJ/Events/OnRowSelected', DBJEventsOnRowSelected);


    // ─────────────────────────────────────────────────────────────────────────
    // DBS/DBJ/Data/GetRecords
    // ─────────────────────────────────────────────────────────────────────────
    function DBJDataGetRecords() {
        this.addInput('trigger',  LG.ACTION);
        this.addOutput('records', 'array');
        this.addOutput('count',   'number');
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [190, 80];
    }
    DBJDataGetRecords.title = 'Data Get Records';
    DBJDataGetRecords.desc  = "Returns the panel's current records (mod_spec.data.records)";
    DBJDataGetRecords.portHelp = {
        inputs: {
            trigger: "Action trigger: when received, reads the current state and sets the outputs.",
        },
        outputs: {
            records: "Array of JS objects — the panel's whole mod_spec.data.records as loaded in the table, no filter applied.",
            count: "Integer — length of the 'records' array (records.length).",
        },
    };
    DBJDataGetRecords.prototype.onAction = function () {
        const ctx     = this.graph?._appContext;
        const records = ctx?.getRecords?.() ?? [];
        this.setOutputData(0, records);
        this.setOutputData(1, records.length);
    };
    LG.registerNodeType('DBS/DBJ/Data/GetRecords', DBJDataGetRecords);


    // ─────────────────────────────────────────────────────────────────────────
    // DBS/DBJ/Data/Refresh
    // ─────────────────────────────────────────────────────────────────────────
    function DBJDataRefresh() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [180, 60];
    }
    DBJDataRefresh.title = 'Data Refresh';
    DBJDataRefresh.desc  = 'Reloads mod_spec from the server and realigns the table (asynchronous)';
    DBJDataRefresh.portHelp = {
        inputs: {
            trigger: "Action trigger: starts the refresh (fetch from the server + realignment of the Tabulator table).",
        },
        outputs: {
            done: "Event: fires ONLY when the fetch has completed successfully (after the Promise is awaited) — not when the input trigger is received.",
        },
    };
    DBJDataRefresh.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.refresh) return;
        const self = this;
        // triggerSlot propaga subito ai link collegati (LiteGraph segue i
        // link sincronicamente, non serve un giro di graph.runStep) — primo
        // caso nel codebase di onAction asincrono: refresh() è una fetch,
        // il trigger a valle parte solo a caricamento completato.
        Promise.resolve(ctx.refresh())
            .then(() => { try { self.triggerSlot(0); } catch {} })
            .catch(err => console.warn('[DBJ-flow-nodes] refresh:', err));
    };
    LG.registerNodeType('DBS/DBJ/Data/Refresh', DBJDataRefresh);
}
