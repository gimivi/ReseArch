// app/PJS_sub_modules/PJS-flow-nodes.mjs
// Nodi LiteGraph context-aware per Paper.js / OSD.
// Ogni nodo legge this.graph._appContext per accedere allo stato PJS vivo del pannello.
// Registrazione idempotente tramite window._PJS_FLOW_NODES_REGISTERED.
//
// Menu contestuale LiteGraph → sottomenu "PJS":
//   PJS/Events/*  — nodi reattivi (selectionChanged, toolChanged, drawingSaved)
//   PJS/Drawing/* — disegno corrente (apri, salva, info)
//   PJS/Tool/*    — tool system (attiva, naviga)
//   PJS/Layer/*   — gestione layer envelope
//   PJS/Selection/* — query e controllo selezione
//   PJS/Item/*    — query e cancellazione item
//   PJS/History/* — undo / redo
//   PJS/Snap/*    — snap system
//   (footer: ReseArch/Panel/Status e /Hints in FLE-nodes.mjs, per tutte le App — ex PJS/Panel/*)

import { getState } from "./PJS-core.mjs";
import { undo, redo, canUndo, canRedo } from "./PJS-history.mjs";
import { setActiveTool } from "./PJS-tools.mjs";
import { deleteSelection } from "./PJS-tool-delete.mjs";
import { applyLayerStyles, exportEnvelope } from "./PJS-io.mjs";
import { saveDrawing } from "./PJS-storage-api.mjs";
import { getSelectionBoundsProject } from "./PJS-selection-query.mjs";
import { clearSelection } from "./PJS-selection-core.mjs";

export function registerPJSFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[PJS-flow-nodes] LiteGraph non disponibile'); return; }
    if (window._PJS_FLOW_NODES_REGISTERED) return;
    window._PJS_FLOW_NODES_REGISTERED = true;

    const ACTION = LG.ACTION ?? -1;
    const EVENT  = LG.EVENT  ?? -1;

    const EVCOLOR   = '#062a1a';
    const EVBGCOLOR = '#0a4a2e';

    // ─────────────────────────────────────────────────────────────────────────
    // PJS/Events — nodi reattivi (pattern onStart → _pending → onExecute),
    // stesso schema di MPS/Events/* e TJS/Events/*. Si agganciano a
    // state.pjs.localEvents (dispatch aggiunto in OSD-flow-runner.mjs per
    // OnSelectionChanged, in PJS-tools.mjs::setActiveTool per OnToolChanged,
    // in model_OSD.mjs + PJS-flow-nodes.mjs::PJSDrawingSave per OnDrawingSaved
    // — stessi punti che già alimentano appBusEmit/cmdUI, nessuna logica
    // duplicata).
    // ─────────────────────────────────────────────────────────────────────────

    function PJSEventsOnSelectionChanged() {
        this.addOutput('trigger', EVENT);
        this.addOutput('items',   'array');
        this.addOutput('count',   'number');
        this._pending = null;
        this._bus     = null;
        this._handler = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [220, 90];
    }
    PJSEventsOnSelectionChanged.title = 'Events On Selection Changed';
    PJSEventsOnSelectionChanged.desc  = 'Fires when the selection of Paper.js items changes';
    PJSEventsOnSelectionChanged.portHelp = {
        outputs: {
            trigger: 'Event: emitted right after the selection has changed.',
            items:   'Array of lightweight objects { kind, layerId } — one per selected item. They are NOT paper.Item/paper.Path (no geometry/style), only kind (type, e.g. "line"/"circle") and layerId; for full data use PJS/Selection/GetItems.',
            count:   'Number of selected items (same value as items.length).',
        },
    };
    PJSEventsOnSelectionChanged.prototype.onStart = function () {
        this._cleanup();
        const ctx = this.graph?._appContext;
        const bus = ctx?.pjs?.()?.localEvents;
        if (!bus || !ctx?.signal) return;
        this._pending = null;
        const g = this.graph, self = this;
        this._handler = ev => { self._pending = ev.detail; try { g.runStep(1); } catch {} };
        bus.addEventListener('selectionChanged', this._handler);
        this._bus = bus;
        ctx.signal.addEventListener('abort', () => this._cleanup(), { once: true });
    };
    PJSEventsOnSelectionChanged.prototype._cleanup = function () {
        if (this._bus && this._handler) this._bus.removeEventListener('selectionChanged', this._handler);
        this._bus = null;
        this._handler = null;
    };
    PJSEventsOnSelectionChanged.prototype.onStop = function () { this._cleanup(); };
    PJSEventsOnSelectionChanged.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(1, p.items ?? []);
        this.setOutputData(2, p.count ?? 0);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Events/OnSelectionChanged', PJSEventsOnSelectionChanged);


    function PJSEventsOnToolChanged() {
        this.addOutput('trigger',  EVENT);
        this.addOutput('toolName', 'string');
        this._pending = null;
        this._bus     = null;
        this._handler = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 80];
    }
    PJSEventsOnToolChanged.title = 'Events On Tool Changed';
    PJSEventsOnToolChanged.desc  = 'Fires when the active drawing tool changes';
    PJSEventsOnToolChanged.portHelp = {
        outputs: {
            trigger:  'Event: emitted right after the tool change.',
            toolName: 'Name of the new active tool, as a string (e.g. "select", "line", "circle", "navigate", …) — see the full list in the combo of PJS/Tool/Activate.',
        },
    };
    PJSEventsOnToolChanged.prototype.onStart = function () {
        this._cleanup();
        const ctx = this.graph?._appContext;
        const bus = ctx?.pjs?.()?.localEvents;
        if (!bus || !ctx?.signal) return;
        this._pending = null;
        const g = this.graph, self = this;
        this._handler = ev => { self._pending = ev.detail; try { g.runStep(1); } catch {} };
        bus.addEventListener('toolChanged', this._handler);
        this._bus = bus;
        ctx.signal.addEventListener('abort', () => this._cleanup(), { once: true });
    };
    PJSEventsOnToolChanged.prototype._cleanup = function () {
        if (this._bus && this._handler) this._bus.removeEventListener('toolChanged', this._handler);
        this._bus = null;
        this._handler = null;
    };
    PJSEventsOnToolChanged.prototype.onStop = function () { this._cleanup(); };
    PJSEventsOnToolChanged.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(1, p.toolName ?? 'navigate');
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Events/OnToolChanged', PJSEventsOnToolChanged);


    function PJSEventsOnDrawingSaved() {
        this.addOutput('trigger', EVENT);
        this.addOutput('dwg_id',  'number');
        this._pending = null;
        this._bus     = null;
        this._handler = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [200, 80];
    }
    PJSEventsOnDrawingSaved.title = 'Events On Drawing Saved';
    PJSEventsOnDrawingSaved.desc  = 'Fires when a drawing is saved successfully (UI or flow)';
    PJSEventsOnDrawingSaved.portHelp = {
        outputs: {
            trigger: 'Event: emitted right after a successful save, from the UI or from PJS/Drawing/Save.',
            dwg_id:  'Numeric id of the saved drawing (null if not available).',
        },
    };
    PJSEventsOnDrawingSaved.prototype.onStart = function () {
        this._cleanup();
        const ctx = this.graph?._appContext;
        const bus = ctx?.pjs?.()?.localEvents;
        if (!bus || !ctx?.signal) return;
        this._pending = null;
        const g = this.graph, self = this;
        this._handler = ev => { self._pending = ev.detail; try { g.runStep(1); } catch {} };
        bus.addEventListener('drawingSaved', this._handler);
        this._bus = bus;
        ctx.signal.addEventListener('abort', () => this._cleanup(), { once: true });
    };
    PJSEventsOnDrawingSaved.prototype._cleanup = function () {
        if (this._bus && this._handler) this._bus.removeEventListener('drawingSaved', this._handler);
        this._bus = null;
        this._handler = null;
    };
    PJSEventsOnDrawingSaved.prototype.onStop = function () { this._cleanup(); };
    PJSEventsOnDrawingSaved.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(1, p.dwg_id ?? null);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Events/OnDrawingSaved', PJSEventsOnDrawingSaved);


    // ─────────────────────────────────────────────────────────────────────────
    // PJS/Drawing — stato del disegno corrente
    // ─────────────────────────────────────────────────────────────────────────

    function PJSDrawingIsOpen() {
        this.addOutput('isOpen', 'boolean');
        this.addOutput('dwg_id', 'number');
        this.color   = '#0f2940';
        this.bgcolor = '#1a4a7a';
        this.size    = [200, 60];
    }
    PJSDrawingIsOpen.title = 'Drawing Is Open';
    PJSDrawingIsOpen.desc  = 'True if a drawing is open in the panel';
    PJSDrawingIsOpen.portHelp = {
        outputs: {
            isOpen: 'true if the panel has a drawing loaded (dwg_id set), false otherwise.',
            dwg_id: 'Numeric id of the open drawing, or null if none.',
        },
    };
    PJSDrawingIsOpen.prototype.onExecute = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        const dwg = pjs?.dwg;
        this.setOutputData(0, !!(dwg?.dwg_id));
        this.setOutputData(1, dwg?.dwg_id ?? null);
    };
    LG.registerNodeType('PJS/Drawing/IsOpen', PJSDrawingIsOpen);


    function PJSDrawingGetInfo() {
        this.addInput('trigger', ACTION);
        this.addOutput('dwg_name',  'string');
        this.addOutput('dwg_id',    'number');
        this.addOutput('isOwner',   'boolean');
        this.addOutput('dirty',     'boolean');
        this.addOutput('version',   'string');
        this.color   = '#0f2940';
        this.bgcolor = '#1a4a7a';
        this.size    = [210, 130];
    }
    PJSDrawingGetInfo.title = 'Drawing Get Info';
    PJSDrawingGetInfo.desc  = 'Returns the metadata of the open drawing';
    PJSDrawingGetInfo.portHelp = {
        inputs: { trigger: 'Pulse: reads and emits the current metadata.' },
        outputs: {
            dwg_name: 'Name of the drawing (string), or null if no drawing is open.',
            dwg_id:   'Numeric id of the drawing, or null.',
            isOwner:  'true if the current user owns the drawing (can save it).',
            dirty:    'true if the panel has changes not saved yet.',
            version:  'Version string of the drawing (e.g. "v1"), or null.',
        },
    };
    PJSDrawingGetInfo.prototype.onAction = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        const dwg = pjs?.dwg;
        this.setOutputData(0, dwg?.dwg_name  ?? null);
        this.setOutputData(1, dwg?.dwg_id    ?? null);
        this.setOutputData(2, dwg?.isOwner   ?? false);
        this.setOutputData(3, pjs?.dirty     ?? false);
        this.setOutputData(4, dwg?.dwg_version ?? null);
    };
    LG.registerNodeType('PJS/Drawing/GetInfo', PJSDrawingGetInfo);


    function PJSDrawingIsDirty() {
        this.addOutput('dirty', 'boolean');
        this.color   = '#0f2940';
        this.bgcolor = '#1a4a7a';
        this.size    = [180, 50];
    }
    PJSDrawingIsDirty.title = 'Drawing Is Dirty';
    PJSDrawingIsDirty.desc  = 'True if there are unsaved changes';
    PJSDrawingIsDirty.portHelp = {
        outputs: { dirty: 'true if the drawing has changes not saved to the DB yet.' },
    };
    PJSDrawingIsDirty.prototype.onExecute = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        this.setOutputData(0, pjs?.dirty ?? false);
    };
    LG.registerNodeType('PJS/Drawing/IsDirty', PJSDrawingIsDirty);


    function PJSDrawingSave() {
        this.addInput('trigger', ACTION);
        this.addOutput('done',   EVENT);
        this.addOutput('error',  'string');
        this.color   = '#0f2940';
        this.bgcolor = '#1a4a7a';
        this.size    = [200, 80];
    }
    PJSDrawingSave.title = 'Drawing Save';
    PJSDrawingSave.desc  = 'Saves the current drawing (only if isOwner and dirty)';
    PJSDrawingSave.portHelp = {
        inputs: { trigger: 'Pulse: starts the save (asynchronous — the actual save happens after "done" has already been emitted).' },
        outputs: {
            done:   'Event: emitted immediately, BEFORE the asynchronous save completes (it does not guarantee success — only that the save has started).',
            error:  'Error string if the save cannot even start (no drawing open, or the user is not the owner); null otherwise. This output is also a second event channel: it is triggered (besides being set) when a precondition fails.',
        },
    };
    PJSDrawingSave.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const pjs = ctx?.pjs?.();
        if (!pjs?.dwg?.dwg_id) {
            this.setOutputData(1, 'No drawing open');
            this.triggerSlot(1); return;
        }
        if (!pjs.dwg.isOwner) {
            this.setOutputData(1, 'You are not the author');
            this.triggerSlot(1); return;
        }
        const bodyEl = ctx.bodyEl;
        const cmdUI  = ctx.cmdUI;
        cmdUI?.update?.({ status: 'Saving...' });
        this.setOutputData(1, null);
        this.triggerSlot(0);
        (async () => {
            try {
                const env = exportEnvelope(bodyEl);
                env.meta = env.meta || {};
                env.meta.drawingId = pjs.dwg.dwg_id;
                await saveDrawing({
                    dwg_id:          pjs.dwg.dwg_id,
                    dwg_name:        pjs.dwg.dwg_name,
                    dwg_description: pjs.dwg.dwg_description || '',
                    dwg_version:     pjs.dwg.dwg_version     || 'v1',
                    dwg_sce_json:    env,
                    dwg_show:        pjs.dwg.dwg_show  ?? 1,
                    dwg_share:       pjs.dwg.dwg_share ?? 1,
                });
                pjs.dirty = false;
                cmdUI?.update?.({ status: 'Saved.' });
                pjs.localEvents?.dispatchEvent(new CustomEvent('drawingSaved', { detail: { dwg_id: pjs.dwg?.dwg_id ?? null } }));
            } catch (e) {
                cmdUI?.update?.({ hints: `Error: ${e?.message || e}` });
            }
        })();
    };
    LG.registerNodeType('PJS/Drawing/Save', PJSDrawingSave);


    function PJSDrawingClose() {
        this.addInput('trigger', ACTION);
        this.addOutput('done',   EVENT);
        this.color   = '#0f2940';
        this.bgcolor = '#1a4a7a';
        this.size    = [190, 70];
    }
    PJSDrawingClose.title = 'Drawing Close';
    PJSDrawingClose.desc  = 'Closes the current drawing and resets the state';
    PJSDrawingClose.portHelp = {
        inputs:  { trigger: 'Pulse: closes the drawing (clears the Paper.js project and the history, without saving).' },
        outputs: { done: 'Event: emitted after closing.' },
    };
    PJSDrawingClose.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const pjs = ctx?.pjs?.();
        if (!pjs) return;
        pjs.scope?.activate?.();
        try { pjs.scope?.project?.clear?.(); } catch {}
        pjs.dwg   = null;
        pjs.dirty = false;
        pjs._env  = null;
        if (pjs.history) {
            pjs.history.undoStack.length  = 0;
            pjs.history.redoStack.length  = 0;
            pjs.history.currentSnapshot   = null;
        }
        try { pjs.overlay?.sync?.(); } catch {}
        try { pjs.scope?.view?.update?.(); } catch {}
        ctx.cmdUI?.update?.({ status: 'Drawing closed.' });
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Drawing/Close', PJSDrawingClose);


    // ─────────────────────────────────────────────────────────────────────────
    // PJS/Tool — tool system
    // ─────────────────────────────────────────────────────────────────────────

    const _TOOLS = ['select','line','polyline','curve','rect','rect_edge','polygon',
                    'polygon_edge','star','arc','arc_cse','circle','circle_2p',
                    'circle_3p','ellipse','ellipse_axes','point','text','link',
                    'image','svg','move','copy','rotate','scale'];

    function PJSToolActivate() {
        this.addProperty('toolName', 'select', 'string');
        this.addWidget('combo', 'tool', 'select', v => { this.properties.toolName = v; },
            { values: _TOOLS, property: 'toolName' });
        this.addInput('trigger',   ACTION);
        this.addInput('toolName',  'string');
        this.addOutput('done',     EVENT);
        this.addOutput('error',    'string');
        this.color   = '#0a2a15';
        this.bgcolor = '#155a2a';
        this.size    = [220, 100];
    }
    PJSToolActivate.title = 'Tool Activate';
    PJSToolActivate.desc  = 'Activates a Paper.js drawing tool';
    PJSToolActivate.portHelp = {
        inputs: {
            trigger:  'Pulse: activates the tool.',
            toolName: 'Tool name as a string (e.g. "select", "line", "circle", "text", "move", …) — if connected it overrides the value chosen in the node combo. Full list in the combo itself.',
        },
        outputs: {
            done:   'Event: emitted if the tool was activated successfully.',
            error:  'Error message (string) if toolName is missing or activation fails; null if all is well. This output is also a second event channel, triggered only on error.',
        },
    };
    PJSToolActivate.prototype.onAction = function () {
        const ctx  = this.graph?._appContext;
        const name = this.getInputData(1) ?? this.properties.toolName;
        if (!name) { this.setOutputData(1, 'toolName missing'); this.triggerSlot(1); return; }
        try {
            setActiveTool(ctx.bodyEl, name, { cmdUI: ctx.cmdUI });
            this.setOutputData(1, null);
            this.triggerSlot(0);
        } catch (e) {
            this.setOutputData(1, String(e?.message || e));
            this.triggerSlot(1);
        }
    };
    LG.registerNodeType('PJS/Tool/Activate', PJSToolActivate);


    function PJSToolGetActive() {
        this.addOutput('toolName', 'string');
        this.color   = '#0a2a15';
        this.bgcolor = '#155a2a';
        this.size    = [190, 50];
    }
    PJSToolGetActive.title = 'Tool Get Active';
    PJSToolGetActive.desc  = 'Name of the currently active tool';
    PJSToolGetActive.portHelp = {
        outputs: { toolName: 'Name of the active tool (string), "navigate" if no drawing tool is active.' },
    };
    PJSToolGetActive.prototype.onExecute = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        this.setOutputData(0, pjs?.tools?.activeName ?? 'navigate');
    };
    LG.registerNodeType('PJS/Tool/GetActive', PJSToolGetActive);


    function PJSToolNavigate() {
        this.addInput('trigger', ACTION);
        this.addOutput('done',   EVENT);
        this.color   = '#0a2a15';
        this.bgcolor = '#155a2a';
        this.size    = [180, 65];
    }
    PJSToolNavigate.title = 'Tool Navigate';
    PJSToolNavigate.desc  = 'Returns to Navigate mode (no active tool)';
    PJSToolNavigate.portHelp = {
        inputs:  { trigger: 'Pulse: deactivates the current drawing tool.' },
        outputs: { done: 'Event: emitted after switching to Navigate.' },
    };
    PJSToolNavigate.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        setActiveTool(ctx.bodyEl, 'navigate', { cmdUI: ctx.cmdUI });
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Tool/Navigate', PJSToolNavigate);


    // ─────────────────────────────────────────────────────────────────────────
    // PJS/Layer — gestione layer envelope
    // ─────────────────────────────────────────────────────────────────────────

    function PJSLayerGetAll() {
        this.addInput('trigger', ACTION);
        this.addOutput('layers', 'array');
        this.addOutput('count',  'number');
        this.color   = '#2a0a40';
        this.bgcolor = '#4a1a70';
        this.size    = [200, 80];
    }
    PJSLayerGetAll.title = 'Layer Get All';
    PJSLayerGetAll.desc  = 'Lists all layers [{id,name,visible,locked}]';
    PJSLayerGetAll.portHelp = {
        inputs:  { trigger: 'Pulse: reads and emits the layer list.' },
        outputs: {
            layers: 'Array of objects { id, name, visible, locked } (one per layer of the envelope) — id/name strings, visible/locked booleans.',
            count:  'Number of layers (= layers.length).',
        },
    };
    PJSLayerGetAll.prototype.onAction = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        const layers = (pjs?._env?.layers ?? []).map(l => ({
            id: l.id, name: l.name, visible: !!l.visible, locked: !!l.locked
        }));
        this.setOutputData(0, layers);
        this.setOutputData(1, layers.length);
    };
    LG.registerNodeType('PJS/Layer/GetAll', PJSLayerGetAll);


    function PJSLayerGetActive() {
        this.addOutput('layerId',   'string');
        this.addOutput('layerName', 'string');
        this.color   = '#2a0a40';
        this.bgcolor = '#4a1a70';
        this.size    = [200, 65];
    }
    PJSLayerGetActive.title = 'Layer Get Active';
    PJSLayerGetActive.desc  = 'Id and name of the current active layer';
    PJSLayerGetActive.portHelp = {
        outputs: {
            layerId:   'Id (string) of the active layer, or null if not set.',
            layerName: 'Name (string) of the active layer, or null if the layer was not found in the envelope.',
        },
    };
    PJSLayerGetActive.prototype.onExecute = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        const env = pjs?._env;
        const id  = env?.workspace?.defaults?.activeLayerId ?? null;
        const rec = env?.layers?.find?.(l => l.id === id) ?? null;
        this.setOutputData(0, id);
        this.setOutputData(1, rec?.name ?? null);
    };
    LG.registerNodeType('PJS/Layer/GetActive', PJSLayerGetActive);


    function PJSLayerSetActive() {
        this.addProperty('layerId', 'L1', 'string');
        this.addWidget('text', 'layerId', 'L1', v => { this.properties.layerId = v; }, { property: 'layerId' });
        this.addInput('trigger',  ACTION);
        this.addInput('layerId',  'string');
        this.addOutput('done',    EVENT);
        this.addOutput('error',   'string');
        this.color   = '#2a0a40';
        this.bgcolor = '#4a1a70';
        this.size    = [210, 100];
    }
    PJSLayerSetActive.title = 'Layer Set Active';
    PJSLayerSetActive.desc  = 'Sets the current active layer';
    PJSLayerSetActive.portHelp = {
        inputs: {
            trigger: 'Pulse: applies the active layer change.',
            layerId: 'Id of the layer (string) to make active — if connected it overrides the node property "layerId".',
        },
        outputs: {
            done:   'Event: emitted if the layer exists and was set as active.',
            error:  'Message (string) if the id does not match any layer of the envelope; null otherwise. Triggered as a second event channel only on error.',
        },
    };
    PJSLayerSetActive.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const pjs = ctx?.pjs?.();
        const id  = this.getInputData(1) ?? this.properties.layerId;
        const env = pjs?._env;
        if (!env) return;
        const layer = env.layers?.find?.(l => l.id === id);
        if (!layer) {
            this.setOutputData(1, `Layer "${id}" not found`);
            this.triggerSlot(1); return;
        }
        if (!env.workspace) env.workspace = {};
        if (!env.workspace.defaults) env.workspace.defaults = {};
        env.workspace.defaults.activeLayerId = id;
        this.setOutputData(1, null);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Layer/SetActive', PJSLayerSetActive);


    function PJSLayerSetVisible() {
        this.addProperty('layerId', 'L1',  'string');
        this.addProperty('visible', true,  'boolean');
        this.addWidget('text',   'layerId', 'L1',  v => { this.properties.layerId = v; }, { property: 'layerId' });
        this.addWidget('toggle', 'visible', true,  v => { this.properties.visible = v; }, { property: 'visible' });
        this.addInput('trigger',  ACTION);
        this.addInput('layerId',  'string');
        this.addInput('visible',  'boolean');
        this.addOutput('done',    EVENT);
        this.color   = '#2a0a40';
        this.bgcolor = '#4a1a70';
        this.size    = [210, 115];
    }
    PJSLayerSetVisible.title = 'Layer Set Visible';
    PJSLayerSetVisible.desc  = 'Shows or hides a layer';
    PJSLayerSetVisible.portHelp = {
        inputs: {
            trigger: 'Pulse: applies the visibility.',
            layerId: 'Id of the layer (string) — if connected it overrides the property "layerId".',
            visible: 'true = show the layer, false = hide it — if connected it overrides the property "visible".',
        },
        outputs: { done: 'Event: emitted after the update (no separate error — if the layer does not exist the node exits silently without emitting anything).' },
    };
    PJSLayerSetVisible.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const pjs = ctx?.pjs?.();
        const id  = this.getInputData(1) ?? this.properties.layerId;
        const vis = this.getInputData(2) ?? this.properties.visible;
        const layer = pjs?._env?.layers?.find?.(l => l.id === id);
        if (!layer) return;
        layer.visible = Boolean(vis);
        try { applyLayerStyles(ctx.bodyEl); } catch {}
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Layer/SetVisible', PJSLayerSetVisible);


    function PJSLayerSetLocked() {
        this.addProperty('layerId', 'L1',  'string');
        this.addProperty('locked',  false, 'boolean');
        this.addWidget('text',   'layerId', 'L1',   v => { this.properties.layerId = v; }, { property: 'layerId' });
        this.addWidget('toggle', 'locked',  false,  v => { this.properties.locked = v; }, { property: 'locked' });
        this.addInput('trigger',  ACTION);
        this.addInput('layerId',  'string');
        this.addInput('locked',   'boolean');
        this.addOutput('done',    EVENT);
        this.color   = '#2a0a40';
        this.bgcolor = '#4a1a70';
        this.size    = [210, 115];
    }
    PJSLayerSetLocked.title = 'Layer Set Locked';
    PJSLayerSetLocked.desc  = 'Locks or unlocks a layer';
    PJSLayerSetLocked.portHelp = {
        inputs: {
            trigger: 'Pulse: applies the lock/unlock.',
            layerId: 'Id of the layer (string) — if connected it overrides the property "layerId".',
            locked:  'true = lock the layer (not selectable/editable), false = unlock — if connected it overrides the property "locked".',
        },
        outputs: { done: 'Event: emitted after the update (no separate error — if the layer does not exist the node exits silently without emitting anything).' },
    };
    PJSLayerSetLocked.prototype.onAction = function () {
        const ctx    = this.graph?._appContext;
        const pjs    = ctx?.pjs?.();
        const id     = this.getInputData(1) ?? this.properties.layerId;
        const locked = this.getInputData(2) ?? this.properties.locked;
        const layer  = pjs?._env?.layers?.find?.(l => l.id === id);
        if (!layer) return;
        layer.locked = Boolean(locked);
        try { applyLayerStyles(ctx.bodyEl); } catch {}
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Layer/SetLocked', PJSLayerSetLocked);


    // ─────────────────────────────────────────────────────────────────────────
    // PJS/Selection — query e controllo della selezione corrente
    // ─────────────────────────────────────────────────────────────────────────

    function PJSSelectionHasSelection() {
        this.addOutput('hasSelection', 'boolean');
        this.addOutput('count',        'number');
        this.color   = '#0a2a2a';
        this.bgcolor = '#1a4a4a';
        this.size    = [200, 65];
    }
    PJSSelectionHasSelection.title = 'Selection Has Selection';
    PJSSelectionHasSelection.desc  = 'True if at least one item is selected';
    PJSSelectionHasSelection.portHelp = {
        outputs: {
            hasSelection: 'true if at least one item is selected.',
            count:        'Number of selected items.',
        },
    };
    PJSSelectionHasSelection.prototype.onExecute = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        this.setOutputData(0, pjs?.hasSelection ?? false);
        this.setOutputData(1, pjs?.selectionCount ?? 0);
    };
    LG.registerNodeType('PJS/Selection/HasSelection', PJSSelectionHasSelection);


    function PJSSelectionGetCount() {
        this.addInput('trigger', ACTION);
        this.addOutput('count',  'number');
        this.color   = '#0a2a2a';
        this.bgcolor = '#1a4a4a';
        this.size    = [180, 65];
    }
    PJSSelectionGetCount.title = 'Selection Get Count';
    PJSSelectionGetCount.desc  = 'Number of currently selected items';
    PJSSelectionGetCount.portHelp = {
        inputs:  { trigger: 'Pulse: reads and emits the count.' },
        outputs: { count: 'Number of selected items.' },
    };
    PJSSelectionGetCount.prototype.onAction = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        this.setOutputData(0, pjs?.selectionCount ?? 0);
    };
    LG.registerNodeType('PJS/Selection/GetCount', PJSSelectionGetCount);


    function PJSSelectionGetItems() {
        this.addInput('trigger', ACTION);
        this.addOutput('items',  'array');   // [{kind,layerId,bounds,data}]
        this.addOutput('count',  'number');
        this.color   = '#0a2a2a';
        this.bgcolor = '#1a4a4a';
        this.size    = [210, 80];
    }
    PJSSelectionGetItems.title = 'Selection Get Items';
    PJSSelectionGetItems.desc  = 'Data of the selected items [{kind,layerId,bounds,data}]';
    PJSSelectionGetItems.portHelp = {
        inputs: { trigger: 'Pulse: reads and emits the selection data.' },
        outputs: {
            items: 'Array of objects { kind, layerId, bounds, data } — one per selected item. kind/layerId strings (or null); bounds is { x, y, width, height } in Paper.js project coordinates, or null if the item has no bounding box; data is the full Paper.js data.* object (custom metadata, not geometry).',
            count: 'Number of selected items (= items.length).',
        },
    };
    PJSSelectionGetItems.prototype.onAction = function () {
        const pjs   = this.graph?._appContext?.pjs?.();
        const items = Array.from(pjs?.selection ?? []).map(it => ({
            kind:    it.data?.kind    ?? null,
            layerId: it.data?.layerId ?? null,
            bounds:  it.bounds ? {
                x: it.bounds.x, y: it.bounds.y,
                width: it.bounds.width, height: it.bounds.height
            } : null,
            data: it.data ?? {},
        }));
        this.setOutputData(0, items);
        this.setOutputData(1, items.length);
    };
    LG.registerNodeType('PJS/Selection/GetItems', PJSSelectionGetItems);


    function PJSSelectionGetBounds() {
        this.addInput('trigger', ACTION);
        this.addOutput('bounds',  'object');   // {x,y,width,height}
        this.addOutput('center',  'object');   // {x,y}
        this.color   = '#0a2a2a';
        this.bgcolor = '#1a4a4a';
        this.size    = [200, 80];
    }
    PJSSelectionGetBounds.title = 'Selection Get Bounds';
    PJSSelectionGetBounds.desc  = 'Bounding box of the whole selection in image coords';
    PJSSelectionGetBounds.portHelp = {
        inputs: { trigger: 'Pulse: reads and emits the bounding box.' },
        outputs: {
            bounds: 'Object { x, y, width, height } — combined bounding box of the whole selection, in image coordinates (not screen/viewport coordinates); null if nothing is selected.',
            center: 'Object { x, y } — center of the bounding box, same image coordinates; null if nothing is selected.',
        },
    };
    PJSSelectionGetBounds.prototype.onAction = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        if (!pjs) return;
        const b = getSelectionBoundsProject(pjs, null);
        if (b) {
            this.setOutputData(0, { x: b.x, y: b.y, width: b.width, height: b.height });
            this.setOutputData(1, { x: b.center.x, y: b.center.y });
        } else {
            this.setOutputData(0, null);
            this.setOutputData(1, null);
        }
    };
    LG.registerNodeType('PJS/Selection/GetBounds', PJSSelectionGetBounds);


    function PJSSelectionClear() {
        this.addInput('trigger', ACTION);
        this.addOutput('done',   EVENT);
        this.color   = '#0a2a2a';
        this.bgcolor = '#1a4a4a';
        this.size    = [180, 65];
    }
    PJSSelectionClear.title = 'Selection Clear';
    PJSSelectionClear.desc  = 'Deselects all items';
    PJSSelectionClear.portHelp = {
        inputs:  { trigger: 'Pulse: deselects everything.' },
        outputs: { done: 'Event: emitted after deselecting.' },
    };
    PJSSelectionClear.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const pjs = ctx?.pjs?.();
        if (!pjs) return;
        clearSelection(pjs);
        try { pjs.overlay?.sync?.(); } catch {}
        try { pjs.scope?.view?.update?.(); } catch {}
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Selection/Clear', PJSSelectionClear);


    // ─────────────────────────────────────────────────────────────────────────
    // PJS/Item — query e operazioni sugli item Paper.js
    // ─────────────────────────────────────────────────────────────────────────

    function PJSItemGetAll() {
        this.addInput('trigger', ACTION);
        this.addOutput('items',  'array');
        this.addOutput('count',  'number');
        this.color   = '#2a0a0a';
        this.bgcolor = '#4a1515';
        this.size    = [200, 80];
    }
    PJSItemGetAll.title = 'Item Get All';
    PJSItemGetAll.desc  = 'All geometric items in the current project';
    PJSItemGetAll.portHelp = {
        inputs: { trigger: 'Pulse: reads and emits the item list.' },
        outputs: {
            items: 'Array of objects { kind, layerId, data } — one per geometric item in the project (internal UI layers and parts of composite items such as text/SVG are excluded). kind/layerId strings (or null); data is the Paper.js data.* object. They are NOT native paper.Item/paper.Path — no geometry/path/style.',
            count: 'Number of items (= items.length).',
        },
    };
    PJSItemGetAll.prototype.onAction = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        if (!pjs) return;
        const ui   = pjs._uiLayer;
        const items = [];
        for (const layer of pjs.scope?.project?.layers ?? []) {
            if (layer === ui) continue;
            for (const it of layer.children ?? []) {
                if (it.data?.__textPart || it.data?.__svgChild) continue;
                items.push({
                    kind:    it.data?.kind    ?? null,
                    layerId: it.data?.layerId ?? null,
                    data:    it.data ?? {},
                });
            }
        }
        this.setOutputData(0, items);
        this.setOutputData(1, items.length);
    };
    LG.registerNodeType('PJS/Item/GetAll', PJSItemGetAll);


    const _KINDS = ['line','polyline','curve','rect','polygon','star','arc',
                    'circle','ellipse','point','text','link','image','svg'];

    function PJSItemGetByKind() {
        this.addProperty('kind', 'line', 'string');
        this.addWidget('combo', 'kind', 'line', v => { this.properties.kind = v; },
            { values: _KINDS, property: 'kind' });
        this.addInput('trigger', ACTION);
        this.addInput('kind',    'string');
        this.addOutput('items',  'array');
        this.addOutput('count',  'number');
        this.color   = '#2a0a0a';
        this.bgcolor = '#4a1515';
        this.size    = [210, 100];
    }
    PJSItemGetByKind.title = 'Item Get By Kind';
    PJSItemGetByKind.desc  = 'Items filtered by type (line, circle, text, …)';
    PJSItemGetByKind.portHelp = {
        inputs: {
            trigger: 'Pulse: reads and emits the filtered items.',
            kind:    'Item type to look for, as a string (one of the combo values: line, polyline, curve, rect, polygon, star, arc, circle, ellipse, point, text, link, image, svg) — if connected it overrides the property "kind".',
        },
        outputs: {
            items: 'Array of objects { kind, layerId, data } — only the items whose data.kind matches the requested filter.',
            count: 'Number of items found (= items.length).',
        },
    };
    PJSItemGetByKind.prototype.onAction = function () {
        const pjs  = this.graph?._appContext?.pjs?.();
        const kind = this.getInputData(1) ?? this.properties.kind;
        if (!pjs || !kind) return;
        const ui    = pjs._uiLayer;
        const items = [];
        for (const layer of pjs.scope?.project?.layers ?? []) {
            if (layer === ui) continue;
            for (const it of layer.children ?? []) {
                if (it.data?.kind === kind) {
                    items.push({ kind, layerId: it.data?.layerId ?? null, data: it.data ?? {} });
                }
            }
        }
        this.setOutputData(0, items);
        this.setOutputData(1, items.length);
    };
    LG.registerNodeType('PJS/Item/GetByKind', PJSItemGetByKind);


    function PJSItemGetByLayer() {
        this.addProperty('layerId', 'L1', 'string');
        this.addWidget('text', 'layerId', 'L1', v => { this.properties.layerId = v; }, { property: 'layerId' });
        this.addInput('trigger',  ACTION);
        this.addInput('layerId',  'string');
        this.addOutput('items',   'array');
        this.addOutput('count',   'number');
        this.color   = '#2a0a0a';
        this.bgcolor = '#4a1515';
        this.size    = [210, 100];
    }
    PJSItemGetByLayer.title = 'Item Get By Layer';
    PJSItemGetByLayer.desc  = 'Items filtered by layerId';
    PJSItemGetByLayer.portHelp = {
        inputs: {
            trigger: 'Pulse: reads and emits the filtered items.',
            layerId: 'Id of the layer (string) to filter by — if connected it overrides the property "layerId".',
        },
        outputs: {
            items: 'Array of objects { kind, layerId, data } — only the items whose data.layerId matches the requested filter.',
            count: 'Number of items found (= items.length).',
        },
    };
    PJSItemGetByLayer.prototype.onAction = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        const id  = this.getInputData(1) ?? this.properties.layerId;
        if (!pjs || !id) return;
        const ui    = pjs._uiLayer;
        const items = [];
        for (const layer of pjs.scope?.project?.layers ?? []) {
            if (layer === ui) continue;
            for (const it of layer.children ?? []) {
                if (it.data?.layerId === id) {
                    items.push({ kind: it.data?.kind ?? null, layerId: id, data: it.data ?? {} });
                }
            }
        }
        this.setOutputData(0, items);
        this.setOutputData(1, items.length);
    };
    LG.registerNodeType('PJS/Item/GetByLayer', PJSItemGetByLayer);


    function PJSItemDeleteSelected() {
        this.addInput('trigger',        ACTION);
        this.addOutput('done',          EVENT);
        this.addOutput('deletedCount',  'number');
        this.color   = '#2a0a0a';
        this.bgcolor = '#4a1515';
        this.size    = [210, 80];
    }
    PJSItemDeleteSelected.title = 'Item Delete Selected';
    PJSItemDeleteSelected.desc  = 'Deletes the selected items with a history snapshot';
    PJSItemDeleteSelected.portHelp = {
        inputs: { trigger: 'Pulse: deletes the current selection (the operation can be undone with PJS/History/Undo, a snapshot is saved before deleting).' },
        outputs: {
            done:         'Event: emitted after deleting.',
            deletedCount: 'Number of items that were selected before deleting.',
        },
    };
    PJSItemDeleteSelected.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const pjs = ctx?.pjs?.();
        if (!pjs) return;
        const before = pjs.selectionCount ?? 0;
        deleteSelection({ state: pjs, cmdUI: ctx.cmdUI });
        this.setOutputData(1, before);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Item/DeleteSelected', PJSItemDeleteSelected);


    // ─────────────────────────────────────────────────────────────────────────
    // PJS/History — undo / redo
    // ─────────────────────────────────────────────────────────────────────────

    function PJSHistoryCanUndo() {
        this.addOutput('canUndo', 'boolean');
        this.color   = '#2a1a05';
        this.bgcolor = '#4a2a0a';
        this.size    = [180, 50];
    }
    PJSHistoryCanUndo.title = 'History Can Undo';
    PJSHistoryCanUndo.desc  = 'True if Undo is possible';
    PJSHistoryCanUndo.portHelp = {
        outputs: { canUndo: 'true if there is at least one snapshot in the Undo stack.' },
    };
    PJSHistoryCanUndo.prototype.onExecute = function () {
        const h = this.graph?._appContext?.history?.();
        this.setOutputData(0, h ? canUndo(h) : false);
    };
    LG.registerNodeType('PJS/History/CanUndo', PJSHistoryCanUndo);


    function PJSHistoryCanRedo() {
        this.addOutput('canRedo', 'boolean');
        this.color   = '#2a1a05';
        this.bgcolor = '#4a2a0a';
        this.size    = [180, 50];
    }
    PJSHistoryCanRedo.title = 'History Can Redo';
    PJSHistoryCanRedo.desc  = 'True if Redo is possible';
    PJSHistoryCanRedo.portHelp = {
        outputs: { canRedo: 'true if there is at least one snapshot in the Redo stack.' },
    };
    PJSHistoryCanRedo.prototype.onExecute = function () {
        const h = this.graph?._appContext?.history?.();
        this.setOutputData(0, h ? canRedo(h) : false);
    };
    LG.registerNodeType('PJS/History/CanRedo', PJSHistoryCanRedo);


    function PJSHistoryUndo() {
        this.addInput('trigger', ACTION);
        this.addOutput('done',   EVENT);
        this.addOutput('ok',     'boolean');
        this.color   = '#2a1a05';
        this.bgcolor = '#4a2a0a';
        this.size    = [180, 80];
    }
    PJSHistoryUndo.title = 'History Undo';
    PJSHistoryUndo.desc  = 'Undoes the last operation';
    PJSHistoryUndo.portHelp = {
        inputs:  { trigger: 'Pulse: runs Undo (restores the Paper.js project from the previous snapshot and clears the selection).' },
        outputs: {
            done: 'Event: always emitted, both on success and when there was nothing to undo.',
            ok:   'true if Undo was actually performed, false if the stack was empty (no action).',
        },
    };
    PJSHistoryUndo.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const pjs = ctx?.pjs?.();
        const h   = pjs?.history;
        if (!h) { this.setOutputData(1, false); this.triggerSlot(0); return; }
        const snap = undo(h);
        if (!snap) { this.setOutputData(1, false); this.triggerSlot(0); return; }
        pjs.scope.activate();
        pjs.scope.project.importJSON(snap);
        if (pjs.selection) { pjs.selection.clear(); pjs.selectionCount = 0; pjs.hasSelection = false; }
        try { pjs.overlay?.sync?.(); } catch {}
        ctx.cmdUI?.update?.({ status: 'Undo' });
        this.setOutputData(1, true);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/History/Undo', PJSHistoryUndo);


    function PJSHistoryRedo() {
        this.addInput('trigger', ACTION);
        this.addOutput('done',   EVENT);
        this.addOutput('ok',     'boolean');
        this.color   = '#2a1a05';
        this.bgcolor = '#4a2a0a';
        this.size    = [180, 80];
    }
    PJSHistoryRedo.title = 'History Redo';
    PJSHistoryRedo.desc  = 'Redoes the last undone operation';
    PJSHistoryRedo.portHelp = {
        inputs:  { trigger: 'Pulse: runs Redo (restores the Paper.js project from the next snapshot and clears the selection).' },
        outputs: {
            done: 'Event: always emitted, both on success and when there was nothing to redo.',
            ok:   'true if Redo was actually performed, false if the stack was empty (no action).',
        },
    };
    PJSHistoryRedo.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const pjs = ctx?.pjs?.();
        const h   = pjs?.history;
        if (!h) { this.setOutputData(1, false); this.triggerSlot(0); return; }
        const snap = redo(h);
        if (!snap) { this.setOutputData(1, false); this.triggerSlot(0); return; }
        pjs.scope.activate();
        pjs.scope.project.importJSON(snap);
        if (pjs.selection) { pjs.selection.clear(); pjs.selectionCount = 0; pjs.hasSelection = false; }
        try { pjs.overlay?.sync?.(); } catch {}
        ctx.cmdUI?.update?.({ status: 'Redo' });
        this.setOutputData(1, true);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/History/Redo', PJSHistoryRedo);


    // ─────────────────────────────────────────────────────────────────────────
    // PJS/Snap — sistema di snap
    // ─────────────────────────────────────────────────────────────────────────

    function PJSSnapIsEnabled() {
        this.addOutput('enabled', 'boolean');
        this.color   = '#0a1a2a';
        this.bgcolor = '#1a2a4a';
        this.size    = [180, 50];
    }
    PJSSnapIsEnabled.title = 'Snap Is Enabled';
    PJSSnapIsEnabled.desc  = 'True if snap is enabled';
    PJSSnapIsEnabled.portHelp = {
        outputs: { enabled: 'true if global snap is active.' },
    };
    PJSSnapIsEnabled.prototype.onExecute = function () {
        const pjs = this.graph?._appContext?.pjs?.();
        this.setOutputData(0, pjs?._env?.workspace?.snap?.enabled ?? false);
    };
    LG.registerNodeType('PJS/Snap/IsEnabled', PJSSnapIsEnabled);


    function PJSSnapSetEnabled() {
        this.addProperty('enabled', true, 'boolean');
        this.addWidget('toggle', 'enabled', true, v => { this.properties.enabled = v; }, { property: 'enabled' });
        this.addInput('trigger',  ACTION);
        this.addInput('enabled',  'boolean');
        this.addOutput('done',    EVENT);
        this.color   = '#0a1a2a';
        this.bgcolor = '#1a2a4a';
        this.size    = [200, 90];
    }
    PJSSnapSetEnabled.title = 'Snap Set Enabled';
    PJSSnapSetEnabled.desc  = 'Turns global snap on or off';
    PJSSnapSetEnabled.portHelp = {
        inputs: {
            trigger: 'Pulse: applies the change.',
            enabled: 'true = turn global snap on, false = turn it off — if connected it overrides the property "enabled".',
        },
        outputs: { done: 'Event: emitted after the update (no output if the workspace snap does not exist yet).' },
    };
    PJSSnapSetEnabled.prototype.onAction = function () {
        const pjs  = this.graph?._appContext?.pjs?.();
        const snap = pjs?._env?.workspace?.snap;
        if (!snap) return;
        const v = this.getInputData(1) ?? this.properties.enabled;
        snap.enabled = Boolean(v);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Snap/SetEnabled', PJSSnapSetEnabled);


    function PJSSnapGetTypes() {
        this.addOutput('endpoint',     'boolean');
        this.addOutput('midpoint',     'boolean');
        this.addOutput('center',       'boolean');
        this.addOutput('intersection', 'boolean');
        this.color   = '#0a1a2a';
        this.bgcolor = '#1a2a4a';
        this.size    = [200, 100];
    }
    PJSSnapGetTypes.title = 'Snap Get Types';
    PJSSnapGetTypes.desc  = 'State of the individual snap types';
    PJSSnapGetTypes.portHelp = {
        outputs: {
            endpoint:     'true if snapping to endpoints (ends of paths) is active.',
            midpoint:     'true if snapping to midpoints is active.',
            center:       'true if snapping to centers (e.g. of circles/rectangles) is active.',
            intersection: 'true if snapping to intersections between paths is active.',
        },
    };
    PJSSnapGetTypes.prototype.onExecute = function () {
        const t = this.graph?._appContext?.pjs?.()?._env?.workspace?.snap?.types ?? {};
        this.setOutputData(0, !!t.endpoint);
        this.setOutputData(1, !!t.midpoint);
        this.setOutputData(2, !!t.center);
        this.setOutputData(3, !!t.intersection);
    };
    LG.registerNodeType('PJS/Snap/GetTypes', PJSSnapGetTypes);


    const _SNAP_TYPES = ['endpoint', 'midpoint', 'center', 'intersection'];

    function PJSSnapSetType() {
        this.addProperty('type',    'endpoint', 'string');
        this.addProperty('enabled', true,       'boolean');
        this.addWidget('combo',  'type',    'endpoint', v => { this.properties.type = v; },
            { values: _SNAP_TYPES, property: 'type' });
        this.addWidget('toggle', 'enabled', true,       v => { this.properties.enabled = v; }, { property: 'enabled' });
        this.addInput('trigger',  ACTION);
        this.addInput('type',     'string');
        this.addInput('enabled',  'boolean');
        this.addOutput('done',    EVENT);
        this.color   = '#0a1a2a';
        this.bgcolor = '#1a2a4a';
        this.size    = [210, 115];
    }
    PJSSnapSetType.title = 'Snap Set Type';
    PJSSnapSetType.desc  = 'Turns a specific snap type on or off';
    PJSSnapSetType.portHelp = {
        inputs: {
            trigger: 'Pulse: applies the change.',
            type:    'Snap type to configure, as a string: "endpoint", "midpoint", "center" or "intersection" — if connected it overrides the property "type".',
            enabled: 'true = turn that snap type on, false = turn it off — if connected it overrides the property "enabled".',
        },
        outputs: { done: 'Event: emitted after the update (no output if the workspace snap does not exist yet).' },
    };
    PJSSnapSetType.prototype.onAction = function () {
        const pjs  = this.graph?._appContext?.pjs?.();
        const snap = pjs?._env?.workspace?.snap;
        if (!snap) return;
        const type = this.getInputData(1) ?? this.properties.type;
        const v    = this.getInputData(2) ?? this.properties.enabled;
        if (!snap.types) snap.types = {};
        snap.types[type] = Boolean(v);
        this.triggerSlot(0);
    };
    LG.registerNodeType('PJS/Snap/SetType', PJSSnapSetType);
}
