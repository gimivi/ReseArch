// app/GSH_sub_modules/GSH-flow-nodes.mjs
// Nodi LiteGraph context-aware per pannelli GSH (Google Sheets, sola
// lettura). Leggono lo stato del pannello via graph._appContext (vedi
// GSH-flow-runner.mjs) — mai import diretto di model_GSH.mjs (isolamento
// per pannello, stesso pattern di MPS-flow-nodes.mjs/DBJ-flow-nodes.mjs).
//
// GSH è di sola lettura (nessuna CRUD, il foglio Google è la fonte dati):
// il set di nodi riflette esattamente le capacità reali del modulo.
//
// Due famiglie:
//   DBS/GSH/Events/* — sorgenti (onStart → _pending → onExecute).
//   DBS/GSH/Data/*   — azioni (onAction): leggono/ricaricano i dati del
//                      pannello quando ricevono un trigger EVENT.

export function registerGSHFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[GSH-flow-nodes] LiteGraph not available'); return; }
    if (window._GSH_FLOW_NODES_REGISTERED) return;
    window._GSH_FLOW_NODES_REGISTERED = true;

    const COLOR   = '#1a3a1a';
    const BGCOLOR = '#2a6828';
    const EVCOLOR   = '#1a2a3a';
    const EVBGCOLOR = '#2a4a68';

    // ─────────────────────────────────────────────────────────────────────────
    // DBS/GSH/Events/OnRowSelected
    // ─────────────────────────────────────────────────────────────────────────
    function GSHEventsOnRowSelected() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('row',     'object');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 80];
    }
    GSHEventsOnRowSelected.title = 'Events On Row Selected';
    GSHEventsOnRowSelected.desc  = 'Fires when a row of the table is clicked';
    GSHEventsOnRowSelected.portHelp = {
        outputs: {
            trigger: "Event: fires once for every click on a row of the Tabulator table.",
            row: "JS object of the clicked row — the keys are the column names of the Google Sheets sheet, as returned by Tabulator (row.getData()).",
        },
    };
    GSHEventsOnRowSelected.prototype.onStart = function () {
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
    GSHEventsOnRowSelected.prototype.onStop = function () {
        this._cleanup?.();
        this._cleanup = null;
    };
    GSHEventsOnRowSelected.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(1, p);
        this.triggerSlot(0);
    };
    LG.registerNodeType('DBS/GSH/Events/OnRowSelected', GSHEventsOnRowSelected);


    // ─────────────────────────────────────────────────────────────────────────
    // DBS/GSH/Data/Refresh
    // ─────────────────────────────────────────────────────────────────────────
    function GSHDataRefresh() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [180, 60];
    }
    GSHDataRefresh.title = 'Data Refresh';
    GSHDataRefresh.desc  = 'Reloads the sheet from the server and realigns the table (asynchronous)';
    GSHDataRefresh.portHelp = {
        inputs: {
            trigger: "Action trigger: starts the refresh (fetch of the Google sheet + realignment of the Tabulator table).",
        },
        outputs: {
            done: "Event: fires ONLY when the fetch has completed successfully — not when the input trigger is received.",
        },
    };
    GSHDataRefresh.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.refresh) return;
        const self = this;
        // triggerSlot propaga subito ai link collegati — vedi la stessa nota
        // in DBJDataRefresh (DBJ-flow-nodes.mjs).
        Promise.resolve(ctx.refresh())
            .then(() => { try { self.triggerSlot(0); } catch {} })
            .catch(err => console.warn('[GSH-flow-nodes] refresh:', err));
    };
    LG.registerNodeType('DBS/GSH/Data/Refresh', GSHDataRefresh);


    // ─────────────────────────────────────────────────────────────────────────
    // DBS/GSH/Data/GetRows
    // ─────────────────────────────────────────────────────────────────────────
    function GSHDataGetRows() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('rows',   'array');
        this.addOutput('count',  'number');
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [180, 80];
    }
    GSHDataGetRows.title = 'Data Get Rows';
    GSHDataGetRows.desc  = 'Returns the current rows of the table (data already loaded, no fetch)';
    GSHDataGetRows.portHelp = {
        inputs: {
            trigger: "Action trigger: when received, reads the current state of the Tabulator table (already in memory, no network fetch).",
        },
        outputs: {
            rows: "Array of JS objects — all the rows currently shown in the table (Tabulator.getData()), keys = column names of the sheet.",
            count: "Integer — length of the 'rows' array.",
        },
    };
    GSHDataGetRows.prototype.onAction = function () {
        const ctx  = this.graph?._appContext;
        const rows = ctx?.getRows?.() ?? [];
        this.setOutputData(0, rows);
        this.setOutputData(1, rows.length);
    };
    LG.registerNodeType('DBS/GSH/Data/GetRows', GSHDataGetRows);


    // ─────────────────────────────────────────────────────────────────────────
    // DBS/GSH/Data/GetSelectedRow
    // ─────────────────────────────────────────────────────────────────────────
    function GSHDataGetSelectedRow() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('row',    'object');
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [190, 60];
    }
    GSHDataGetSelectedRow.title = 'Data Get Selected Row';
    GSHDataGetSelectedRow.desc  = "Returns the last row selected in the panel (null if none)";
    GSHDataGetSelectedRow.portHelp = {
        inputs: {
            trigger: "Action trigger: when received, reads the last row clicked in the panel.",
        },
        outputs: {
            row: "JS object of the selected row (same keys = columns of the sheet), or null if no row has been clicked since the panel was opened.",
        },
    };
    GSHDataGetSelectedRow.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        this.setOutputData(0, ctx?.selectedRow ?? null);
    };
    LG.registerNodeType('DBS/GSH/Data/GetSelectedRow', GSHDataGetSelectedRow);
}
