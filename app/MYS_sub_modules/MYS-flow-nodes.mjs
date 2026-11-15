// app/MYS_sub_modules/MYS-flow-nodes.mjs
// Nodi LiteGraph context-aware per pannelli MYS (griglia MySQL, con CRUD).
// Leggono/scrivono lo stato del pannello via graph._appContext (vedi
// MYS-flow-runner.mjs) — mai import diretto di model_MYS.mjs (isolamento
// per pannello, stesso pattern di MPS-flow-nodes.mjs/GSH-flow-nodes.mjs).
//
// Tre famiglie:
//   DBS/MYS/Events/* — sorgenti (onStart → _pending → onExecute).
//   DBS/MYS/Data/*   — azioni di lettura/refresh (onAction).
//   DBS/MYS/Row/*    — azioni di scrittura (onAction, asincrone) — solo se
//                      l'oggetto è scrivibile (ctx.writable, stesso flag
//                      che nella UI nasconde "Nuova riga"/disabilita
//                      l'editing celle). Se non scrivibile: no-op silenzioso
//                      + warning in console + messaggio negli hints del
//                      footer del pannello (ctx.cmdUI), nessun output
//                      "errore" dedicato — decisione di progetto 2026-08-26.

import { t } from "../shared/i18n.mjs";

function _blockedNotWritable(nodeLabel, ctx) {
    console.warn(`[MYS-flow-nodes] ${nodeLabel}: object not writable (writable=false), write ignored.`);
    ctx?.cmdUI?.update?.({ hints: t('app.mys.flow.write_blocked.@', { node: nodeLabel }) });
}

export function registerMYSFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[MYS-flow-nodes] LiteGraph not available'); return; }
    if (window._MYS_FLOW_NODES_REGISTERED) return;
    window._MYS_FLOW_NODES_REGISTERED = true;

    const COLOR   = '#3a2a1a';
    const BGCOLOR = '#684a28';
    const WCOLOR   = '#3a1a1a';
    const WBGCOLOR = '#682828';
    const EVCOLOR   = '#1a2a3a';
    const EVBGCOLOR = '#2a4a68';

    // ─────────────────────────────────────────────────────────────────────────
    // DBS/MYS/Events/OnRowSelected
    // ─────────────────────────────────────────────────────────────────────────
    function MYSEventsOnRowSelected() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('row',     'object');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 80];
    }
    MYSEventsOnRowSelected.title = 'Events On Row Selected';
    MYSEventsOnRowSelected.desc  = 'Fires when a row of the table is clicked';
    MYSEventsOnRowSelected.portHelp = {
        outputs: {
            trigger: "Event: fires once for every click on a row of the grid.",
            row: "JS object of the clicked row — keys = columns of the MySQL table, including the one configured as primary key (model property 'pkField', default 'id').",
        },
    };
    MYSEventsOnRowSelected.prototype.onStart = function () {
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
    MYSEventsOnRowSelected.prototype.onStop = function () {
        this._cleanup?.();
        this._cleanup = null;
    };
    MYSEventsOnRowSelected.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(1, p);
        this.triggerSlot(0);
    };
    LG.registerNodeType('DBS/MYS/Events/OnRowSelected', MYSEventsOnRowSelected);


    // ─────────────────────────────────────────────────────────────────────────
    // DBS/MYS/Data/Refresh
    // ─────────────────────────────────────────────────────────────────────────
    function MYSDataRefresh() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('where',   'array');   // opzionale: [{field,op,value}] — assente/vuoto = refresh semplice
        this.addOutput('done',   LG.EVENT);
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [190, 70];
    }
    MYSDataRefresh.title = 'Data Refresh';
    MYSDataRefresh.desc  = 'Reloads the data from the server (with an optional where filter) and realigns the grid (asynchronous)';
    MYSDataRefresh.portHelp = {
        inputs: {
            trigger: "Action trigger: starts the refresh (fetch from the server + realignment of the grid).",
            where: "Optional — array of SQL-like conditions [{field, op, value}, ...] passed as a server-side filter; if missing or not an array, refresh without filter (all rows, following the model's pagination).",
        },
        outputs: {
            done: "Event: fires ONLY when the fetch has completed successfully — not when the input trigger is received.",
        },
    };
    MYSDataRefresh.prototype.onAction = function () {
        const ctx   = this.graph?._appContext;
        if (!ctx?.refresh) return;
        const where = this.getInputData(1);
        const self  = this;
        // triggerSlot propaga subito ai link collegati — vedi la stessa nota
        // in DBJDataRefresh (DBJ-flow-nodes.mjs), primo caso di onAction
        // asincrono nel codebase.
        Promise.resolve(ctx.refresh(Array.isArray(where) ? where : []))
            .then(() => { try { self.triggerSlot(0); } catch {} })
            .catch(err => console.warn('[MYS-flow-nodes] refresh:', err));
    };
    LG.registerNodeType('DBS/MYS/Data/Refresh', MYSDataRefresh);


    // ─────────────────────────────────────────────────────────────────────────
    // DBS/MYS/Data/GetSelectedRow
    // ─────────────────────────────────────────────────────────────────────────
    function MYSDataGetSelectedRow() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('row',    'object');
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [190, 60];
    }
    MYSDataGetSelectedRow.title = 'Data Get Selected Row';
    MYSDataGetSelectedRow.desc  = "Returns the last row selected in the panel (null if none)";
    MYSDataGetSelectedRow.portHelp = {
        inputs: {
            trigger: "Action trigger: when received, reads the last row clicked in the panel.",
        },
        outputs: {
            row: "JS object of the selected row (keys = columns of the table, including the primary key), or null if no row has been clicked since the panel was opened.",
        },
    };
    MYSDataGetSelectedRow.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        this.setOutputData(0, ctx?.selectedRow ?? null);
    };
    LG.registerNodeType('DBS/MYS/Data/GetSelectedRow', MYSDataGetSelectedRow);


    // ─────────────────────────────────────────────────────────────────────────
    // DBS/MYS/Row/Insert
    // ─────────────────────────────────────────────────────────────────────────
    function MYSRowInsert() {
        this.addInput('trigger',   LG.ACTION);
        this.addInput('data',      'object');
        this.addOutput('done',     LG.EVENT);
        this.addOutput('insertId', 'number');
        this.color   = WCOLOR;
        this.bgcolor = WBGCOLOR;
        this.size    = [190, 85];
    }
    MYSRowInsert.title = 'Row Insert';
    MYSRowInsert.desc  = 'Inserts a new row (asynchronous) — only if the panel is writable';
    MYSRowInsert.portHelp = {
        inputs: {
            trigger: "Action trigger: starts the insert. If the panel is not writable (model property 'writable' set to false), the action is ignored (only a warning in the console + a hint in the footer) — neither 'done' nor 'insertId' is output.",
            data: "JS object {columnName: value, ...} with the fields to insert — do NOT include the primary key, the DB generates it. If missing/null/undefined, no insert.",
        },
        outputs: {
            done: "Event: fires ONLY when the insert has completed successfully on the server (after the automatic refresh of the grid).",
            insertId: "Number — the ID generated by the DB for the new row (res.insertId from the API response), or null if the response does not include it.",
        },
    };
    MYSRowInsert.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.writable) { _blockedNotWritable('Row Insert', ctx); return; }
        const data = this.getInputData(1);
        if (!data || !ctx.insertRow) return;
        const self = this;
        ctx.insertRow(data)
            .then(res => {
                self.setOutputData(1, res?.insertId ?? null);
                try { self.triggerSlot(0); } catch {}
            })
            .catch(err => console.warn('[MYS-flow-nodes] insertRow:', err));
    };
    LG.registerNodeType('DBS/MYS/Row/Insert', MYSRowInsert);


    // ─────────────────────────────────────────────────────────────────────────
    // DBS/MYS/Row/Update
    // ─────────────────────────────────────────────────────────────────────────
    function MYSRowUpdate() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('pk',      0);
        this.addInput('data',    'object');
        this.addOutput('done',   LG.EVENT);
        this.color   = WCOLOR;
        this.bgcolor = WBGCOLOR;
        this.size    = [190, 90];
    }
    MYSRowUpdate.title = 'Row Update';
    MYSRowUpdate.desc  = 'Updates an existing row (asynchronous) — only if the panel is writable';
    MYSRowUpdate.portHelp = {
        inputs: {
            trigger: "Action trigger: starts the update. If the panel is not writable, the action is ignored (warning in the console + hint in the footer).",
            pk: "Primary key value of the row to update (model column 'pkField', default 'id') — the type depends on the DB schema, usually a number. If null/undefined, no update.",
            data: "JS object {columnName: newValue, ...} — only the fields to change, the whole row is not needed. If null/undefined, no update.",
        },
        outputs: {
            done: "Event: fires ONLY when the update has completed successfully on the server (after the automatic refresh of the grid).",
        },
    };
    MYSRowUpdate.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.writable) { _blockedNotWritable('Row Update', ctx); return; }
        const pk   = this.getInputData(1);
        const data = this.getInputData(2);
        if (pk == null || !data || !ctx.updateRow) return;
        const self = this;
        ctx.updateRow(pk, data)
            .then(() => { try { self.triggerSlot(0); } catch {} })
            .catch(err => console.warn('[MYS-flow-nodes] updateRow:', err));
    };
    LG.registerNodeType('DBS/MYS/Row/Update', MYSRowUpdate);


    // ─────────────────────────────────────────────────────────────────────────
    // DBS/MYS/Row/Delete
    // ─────────────────────────────────────────────────────────────────────────
    function MYSRowDelete() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('pk',      0);
        this.addOutput('done',   LG.EVENT);
        this.color   = WCOLOR;
        this.bgcolor = WBGCOLOR;
        this.size    = [190, 70];
    }
    MYSRowDelete.title = 'Row Delete';
    MYSRowDelete.desc  = 'Deletes a row (asynchronous, no confirmation) — only if the panel is writable';
    MYSRowDelete.portHelp = {
        inputs: {
            trigger: "Action trigger: starts the delete IMMEDIATELY, with no confirmation dialog (unlike manual deletion from the grid, which asks for confirmation). If the panel is not writable, the action is ignored (warning in the console + hint in the footer).",
            pk: "Primary key value of the row to delete (model column 'pkField', default 'id'). If null/undefined, no delete.",
        },
        outputs: {
            done: "Event: fires ONLY when the delete has completed successfully on the server (after the automatic refresh of the grid).",
        },
    };
    MYSRowDelete.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.writable) { _blockedNotWritable('Row Delete', ctx); return; }
        const pk = this.getInputData(1);
        if (pk == null || !ctx.deleteRow) return;
        const self = this;
        ctx.deleteRow(pk)
            .then(() => { try { self.triggerSlot(0); } catch {} })
            .catch(err => console.warn('[MYS-flow-nodes] deleteRow:', err));
    };
    LG.registerNodeType('DBS/MYS/Row/Delete', MYSRowDelete);
}
