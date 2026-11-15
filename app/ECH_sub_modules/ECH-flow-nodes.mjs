// app/ECH_sub_modules/ECH-flow-nodes.mjs
// Nodi LiteGraph context-aware per pannelli ECH (ECharts). Leggono/scrivono
// lo stato del pannello via graph._appContext (vedi ECH-flow-runner.mjs) —
// mai import diretto di model_ECH.mjs (isolamento per pannello, stesso
// pattern di MPS-flow-nodes.mjs/PDF-flow-nodes.mjs).
//
// model_ECH.mjs usa già il vecchio App Bus diretto (appBusOn/appBusEmit,
// non FLE) per selection:change/filter:apply/data:refresh — i nodi Events/*
// qui sotto NON duplicano quella logica: si agganciano a
// graph._appContext.localEvents, una EventTarget dedicata dispatchata dagli
// stessi punti che già emettono sull'App Bus (state.localEvents in
// model_ECH.mjs), stesso principio di DBJ/GSH/MYS/PDF.
//
// Tre famiglie:
//   ECH/Events/* — sorgenti (onStart → _pending → onExecute).
//   ECH/Chart/*  — azioni: lettura/scrittura sul chart (onAction).
//   ECH/Graph/*  — conversioni a evento, funzionano ovunque: preparano i dati per i
//                  template graph-basic / tree-basic (2026-10-07).

export function registerECHFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[ECH-flow-nodes] LiteGraph not available'); return; }
    if (window._ECH_FLOW_NODES_REGISTERED) return;
    window._ECH_FLOW_NODES_REGISTERED = true;

    const COLOR   = '#4a2a1a';
    const BGCOLOR = '#784a28';
    const EVCOLOR   = '#1a2a3a';
    const EVBGCOLOR = '#2a4a68';

    // Helper comune ai nodi Events/*: onStart auto-pulente (rimuove una
    // sottoscrizione precedente prima di ricrearla — onStart può essere
    // richiamato più volte quando il contesto del grafo cambia, vedi
    // model_FLE.mjs::_reinitGraphNodes / module-fle-architettura.md §4.2).
    function _wireLocalEvent(node, eventName) {
        node._cleanup?.();
        node._cleanup = null;
        const ctx = node.graph?._appContext;
        const bus = ctx?.localEvents;
        if (!bus) return;
        node._pending = null;
        const g = node.graph;
        const handler = ev => {
            node._pending = ev.detail;
            try { g.runStep(1); } catch {}
        };
        bus.addEventListener(eventName, handler);
        node._cleanup = () => bus.removeEventListener(eventName, handler);
        ctx.signal?.addEventListener('abort', () => node._cleanup?.(), { once: true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Events/OnClick
    // ─────────────────────────────────────────────────────────────────────────
    function ECHEventsOnClick() {
        this.addOutput('trigger',    LG.EVENT);
        this.addOutput('field',      'string');
        this.addOutput('value',      0);
        this.addOutput('seriesName', 'string');
        this.addOutput('dataIndex',  'number');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 110];
    }
    ECHEventsOnClick.title = 'Events On Click';
    ECHEventsOnClick.desc  = 'Fires when an element of the chart is clicked (same data as selection:change)';
    ECHEventsOnClick.portHelp = {
        outputs: {
            trigger:    'Event: emitted on every click on an element of the chart.',
            field:      'Category name (X axis entry) of the clicked point — string, may be missing depending on the chart type.',
            value:      'Value of the clicked point (number, or [x,y] array for scatter/line depending on the series).',
            seriesName: 'Name of the series the clicked point belongs to — string.',
            dataIndex:  'Index (0-based) of the point within the data array of its series.',
            data:       'Object — the clicked element as it is in the chart data. For a graph/tree from ECH/Graph/FromTree: { id (= uuid of the TJS object), name, type, … }; for a graph edge { source, target }. Optional: right-click on the node → Outputs.',
        },
    };
    ECHEventsOnClick.prototype.onGetOutputs = function () {
        return this.findOutputSlot('data') === -1 ? [['data', 'object', { removable: true }]] : [];
    };
    ECHEventsOnClick.prototype.onConfigure = function () {
        const o = this.outputs?.find(s => s.name === 'data');
        if (o) o.removable = true;
    };
    ECHEventsOnClick.prototype.onStart = function () { _wireLocalEvent(this, 'click'); };
    ECHEventsOnClick.prototype.onStop  = function () { this._cleanup?.(); this._cleanup = null; };
    ECHEventsOnClick.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending; this._pending = null;
        this.setOutputData(1, p.field);
        this.setOutputData(2, p.value);
        this.setOutputData(3, p.seriesName);
        this.setOutputData(4, p.dataIndex);
        const di = this.findOutputSlot('data');
        if (di !== -1) this.setOutputData(di, p.data ?? null);
        this.triggerSlot(0);
    };
    LG.registerNodeType('ECH/Events/OnClick', ECHEventsOnClick);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Events/OnLegendChange
    // ─────────────────────────────────────────────────────────────────────────
    function ECHEventsOnLegendChange() {
        this.addOutput('trigger',  LG.EVENT);
        this.addOutput('selected', 'object');   // { nomeSerie: boolean, ... }
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 80];
    }
    ECHEventsOnLegendChange.title = 'Events On Legend Change';
    ECHEventsOnLegendChange.desc  = 'Fires when the visibility of a series changes in the legend';
    ECHEventsOnLegendChange.portHelp = {
        outputs: {
            trigger:  'Event: emitted on every visibility change in the legend.',
            selected: 'Object {seriesName: boolean, ...} — one key per series of the chart, true if visible, false if hidden. Same format accepted as input by Chart/SetLegend.',
        },
    };
    ECHEventsOnLegendChange.prototype.onStart = function () { _wireLocalEvent(this, 'legendChange'); };
    ECHEventsOnLegendChange.prototype.onStop  = function () { this._cleanup?.(); this._cleanup = null; };
    ECHEventsOnLegendChange.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending; this._pending = null;
        this.setOutputData(1, p.selected);
        this.triggerSlot(0);
    };
    LG.registerNodeType('ECH/Events/OnLegendChange', ECHEventsOnLegendChange);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Events/OnDataZoom
    // ─────────────────────────────────────────────────────────────────────────
    function ECHEventsOnDataZoom() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('start',   'number');
        this.addOutput('end',     'number');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [200, 80];
    }
    ECHEventsOnDataZoom.title = 'Events On Data Zoom';
    ECHEventsOnDataZoom.desc  = 'Fires when the zoom on the data axis changes (slider or brush)';
    ECHEventsOnDataZoom.portHelp = {
        outputs: {
            trigger: 'Event: emitted on every zoom change.',
            start:   'Percentage (0–100) where the visible zoom window starts.',
            end:     'Percentage (0–100) where the visible zoom window ends — same format accepted as input by Chart/SetZoom.',
        },
    };
    ECHEventsOnDataZoom.prototype.onStart = function () { _wireLocalEvent(this, 'dataZoom'); };
    ECHEventsOnDataZoom.prototype.onStop  = function () { this._cleanup?.(); this._cleanup = null; };
    ECHEventsOnDataZoom.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending; this._pending = null;
        this.setOutputData(1, p.start);
        this.setOutputData(2, p.end);
        this.triggerSlot(0);
    };
    LG.registerNodeType('ECH/Events/OnDataZoom', ECHEventsOnDataZoom);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Events/OnDataLoaded
    // ─────────────────────────────────────────────────────────────────────────
    function ECHEventsOnDataLoaded() {
        this.addOutput('trigger',  LG.EVENT);
        this.addOutput('count',    'number');
        this.addOutput('template', 'string');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [200, 90];
    }
    ECHEventsOnDataLoaded.title = 'Events On Data Loaded';
    ECHEventsOnDataLoaded.desc  = 'Fires when a new dataset has finished rendering (configured dataSource or Chart/SetData)';
    ECHEventsOnDataLoaded.portHelp = {
        outputs: {
            trigger:  'Event: emitted right after the chart has finished redrawing with a new dataset.',
            count:    'Number of rows of the dataset just loaded.',
            template: 'Name/type of the chart template used for rendering (string, e.g. "bar", "line", "pie" — depends on the panel configuration).',
        },
    };
    ECHEventsOnDataLoaded.prototype.onStart = function () { _wireLocalEvent(this, 'dataLoaded'); };
    ECHEventsOnDataLoaded.prototype.onStop  = function () { this._cleanup?.(); this._cleanup = null; };
    ECHEventsOnDataLoaded.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending; this._pending = null;
        this.setOutputData(1, p.count);
        this.setOutputData(2, p.template);
        this.triggerSlot(0);
    };
    LG.registerNodeType('ECH/Events/OnDataLoaded', ECHEventsOnDataLoaded);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Chart/Highlight
    // ─────────────────────────────────────────────────────────────────────────
    function ECHChartHighlight() {
        this.addInput('trigger',    LG.ACTION);
        this.addInput('field',      'string');    // nome categoria (asse X) — alternativa a seriesName+dataIndex
        this.addInput('seriesName', 'string');
        this.addInput('dataIndex',  'number');
        this.addOutput('done',      LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [200, 100];
    }
    ECHChartHighlight.title = 'Chart Highlight';
    ECHChartHighlight.desc  = 'Highlights a point (seriesName+dataIndex) or a category (field) — same effect as the selection:change receiver';
    ECHChartHighlight.portHelp = {
        inputs: {
            trigger:    'Trigger: applies the highlight when it receives an event.',
            field:      'Name of the category (X axis) to highlight — string. Alternative to seriesName+dataIndex: use one or the other depending on what you want to highlight.',
            seriesName: 'Name of the series of the point to highlight — string, used together with dataIndex.',
            dataIndex:  'Index (0-based) of the point to highlight within the series given in seriesName.',
        },
        outputs: {
            done: 'Event: emitted right after the highlight has been applied.',
        },
    };
    ECHChartHighlight.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.highlight) return;
        ctx.highlight({
            field:      this.getInputData(1),
            seriesName: this.getInputData(2),
            dataIndex:  this.getInputData(3),
        });
        this.triggerSlot(0);
    };
    LG.registerNodeType('ECH/Chart/Highlight', ECHChartHighlight);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Chart/Downplay
    // ─────────────────────────────────────────────────────────────────────────
    function ECHChartDownplay() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [170, 50];
    }
    ECHChartDownplay.title = 'Chart Downplay';
    ECHChartDownplay.desc  = 'Removes the current highlight (no point/category highlighted)';
    ECHChartDownplay.portHelp = {
        inputs:  { trigger: 'Trigger: removes the current highlight when it receives an event.' },
        outputs: { done:    'Event: emitted right after the highlight has been removed.' },
    };
    ECHChartDownplay.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.downplay) return;
        ctx.downplay();
        this.triggerSlot(0);
    };
    LG.registerNodeType('ECH/Chart/Downplay', ECHChartDownplay);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Chart/SetZoom
    // ─────────────────────────────────────────────────────────────────────────
    function ECHChartSetZoom() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('start',   'number');   // 0–100, percentuale
        this.addInput('end',     'number');
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 80];
    }
    ECHChartSetZoom.title = 'Chart Set Zoom';
    ECHChartSetZoom.desc  = 'Sets the zoom on the data axis (percentage 0–100) — same effect as the filter:apply.zoom receiver';
    ECHChartSetZoom.portHelp = {
        inputs: {
            trigger: 'Trigger: applies the zoom when it receives an event.',
            start:   'Percentage (0–100) where the zoom window to show starts.',
            end:     'Percentage (0–100) where the zoom window to show ends.',
        },
        outputs: { done: 'Event: emitted right after the zoom has been applied.' },
    };
    ECHChartSetZoom.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.setZoom) return;
        ctx.setZoom(this.getInputData(1), this.getInputData(2));
        this.triggerSlot(0);
    };
    LG.registerNodeType('ECH/Chart/SetZoom', ECHChartSetZoom);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Chart/SetLegend
    // ─────────────────────────────────────────────────────────────────────────
    function ECHChartSetLegend() {
        this.addInput('trigger',  LG.ACTION);
        this.addInput('selected', 'object');   // { nomeSerie: boolean, ... }
        this.addOutput('done',    LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 70];
    }
    ECHChartSetLegend.title = 'Chart Set Legend';
    ECHChartSetLegend.desc  = 'Shows/hides series in the legend — same effect as the filter:apply.legend receiver';
    ECHChartSetLegend.portHelp = {
        inputs: {
            trigger:  'Trigger: applies the legend state when it receives an event.',
            selected: 'Object {seriesName: boolean, ...} — one key per series to show (true) or hide (false); series not listed are left unchanged.',
        },
        outputs: { done: 'Event: emitted right after the legend has been updated.' },
    };
    ECHChartSetLegend.prototype.onAction = function () {
        const ctx      = this.graph?._appContext;
        const selected = this.getInputData(1);
        if (!ctx?.setLegend || !selected) return;
        ctx.setLegend(selected);
        this.triggerSlot(0);
    };
    LG.registerNodeType('ECH/Chart/SetLegend', ECHChartSetLegend);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Chart/GetData
    // ─────────────────────────────────────────────────────────────────────────
    function ECHChartGetData() {
        this.addInput('trigger',  LG.ACTION);
        this.addOutput('rows',    'array');
        this.addOutput('headers', 'array');
        this.addOutput('count',   'number');
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 90];
    }
    ECHChartGetData.title = 'Chart Get Data';
    ECHChartGetData.desc  = 'Returns the normalized dataset of the last rendering (configured dataSource or Chart/SetData)';
    ECHChartGetData.portHelp = {
        inputs: { trigger: 'Trigger: reads the current dataset when it receives an event (passive node, no event output — connect the data outputs directly downstream).' },
        outputs: {
            rows:    'Array of records — one key/value object per row of the dataset (already normalized, same format as DBS/*/Data/Get*).',
            headers: 'Array of strings with the column names of the dataset.',
            count:   'Number of rows of the dataset (equal to rows.length).',
        },
    };
    ECHChartGetData.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const ds  = ctx?.getData?.() ?? null;
        this.setOutputData(0, ds?.rows    ?? []);
        this.setOutputData(1, ds?.headers ?? []);
        this.setOutputData(2, ds?.meta?.count ?? (ds?.rows?.length ?? 0));
    };
    LG.registerNodeType('ECH/Chart/GetData', ECHChartGetData);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Chart/GetSelected
    // ─────────────────────────────────────────────────────────────────────────
    function ECHChartGetSelected() {
        this.addInput('trigger',    LG.ACTION);
        this.addOutput('field',     'string');
        this.addOutput('value',     0);
        this.addOutput('selection', 'object');   // { field, value, seriesName, dataIndex }
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [200, 80];
    }
    ECHChartGetSelected.title = 'Chart Get Selected';
    ECHChartGetSelected.desc  = 'Returns the last point clicked on the chart (null if none)';
    ECHChartGetSelected.portHelp = {
        inputs: { trigger: 'Trigger: reads the current selection when it receives an event (passive node, no event output).' },
        outputs: {
            field:     'Category name (X axis) of the last clicked point — string, null if no click has happened yet.',
            value:     'Value of the last clicked point — null if no click has happened yet.',
            selection: 'Full object {field, value, seriesName, dataIndex} of the last selection, or null if no click has happened yet.',
        },
    };
    ECHChartGetSelected.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        const sel = ctx?.getSelected?.() ?? null;
        this.setOutputData(0, sel?.field ?? null);
        this.setOutputData(1, sel?.value ?? null);
        this.setOutputData(2, sel);
    };
    LG.registerNodeType('ECH/Chart/GetSelected', ECHChartGetSelected);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Chart/SetData
    // ─────────────────────────────────────────────────────────────────────────
    function ECHChartSetData() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('rows',    'array');   // array di record, o {rows,headers,meta} già normalizzato
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [200, 70];
    }
    ECHChartSetData.title = 'Chart Set Data';
    ECHChartSetData.desc  = 'Replaces the chart data with the data received (asynchronous) — bypasses mod_spec.dataSource, compatible with the output of DBS/*/Data/Get*';
    ECHChartSetData.portHelp = {
        inputs: {
            trigger: 'Trigger: replaces the chart data when it receives an event.',
            rows:    'Array of records (key/value objects, one per row) to use as the new dataset — or an already normalized object {rows, headers, meta}. Directly compatible with the "rows" output of DBS/*/Data/Get*.',
        },
        outputs: { done: 'Event: emitted when the chart has finished redrawing with the new data (asynchronous operation — not emitted immediately in onAction).' },
    };
    ECHChartSetData.prototype.onAction = function () {
        const ctx  = this.graph?._appContext;
        const rows = this.getInputData(1);
        if (!rows || !ctx?.setData) return;
        const self = this;
        // triggerSlot propaga subito ai link collegati appena richiamato — vedi
        // la stessa nota in DBJDataRefresh (DBJ-flow-nodes.mjs).
        Promise.resolve(ctx.setData(rows))
            .then(ok => { if (ok) { try { self.triggerSlot(0); } catch {} } })
            .catch(err => console.warn('[ECH-flow-nodes] setData:', err));
    };
    LG.registerNodeType('ECH/Chart/SetData', ECHChartSetData);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Chart/Refresh
    // ─────────────────────────────────────────────────────────────────────────
    function ECHChartRefresh() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [170, 50];
    }
    ECHChartRefresh.title = 'Chart Refresh';
    ECHChartRefresh.desc  = 'Reloads the data from the source configured in mod_spec.dataSource (asynchronous)';
    ECHChartRefresh.portHelp = {
        inputs:  { trigger: 'Trigger: starts reloading when it receives an event.' },
        outputs: { done:    'Event: emitted when reloading has completed (asynchronous operation — not emitted immediately in onAction).' },
    };
    ECHChartRefresh.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.refresh) return;
        const self = this;
        Promise.resolve(ctx.refresh())
            .then(() => { try { self.triggerSlot(0); } catch {} })
            .catch(err => console.warn('[ECH-flow-nodes] refresh:', err));
    };
    LG.registerNodeType('ECH/Chart/Refresh', ECHChartRefresh);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Chart/ExportPNG
    // ─────────────────────────────────────────────────────────────────────────
    function ECHChartExportPNG() {
        this.addInput('trigger',  LG.ACTION);
        this.addInput('filename', 'string');
        this.addOutput('done',    LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 70];
    }
    ECHChartExportPNG.title = 'Chart Export PNG';
    ECHChartExportPNG.desc  = 'Downloads the chart as PNG (optional filename, default "chart.png")';
    ECHChartExportPNG.portHelp = {
        inputs: {
            trigger:  'Trigger: starts the download when it receives an event.',
            filename: 'Name of the file to download — string, optional (default "chart.png" if not connected or empty).',
        },
        outputs: { done: 'Event: emitted right after the download has started.' },
    };
    ECHChartExportPNG.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.exportPNG) return;
        ctx.exportPNG(this.getInputData(1));
        this.triggerSlot(0);
    };
    LG.registerNodeType('ECH/Chart/ExportPNG', ECHChartExportPNG);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Chart/ToggleTheme
    // ─────────────────────────────────────────────────────────────────────────
    function ECHChartToggleTheme() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [180, 50];
    }
    ECHChartToggleTheme.title = 'Chart Toggle Theme';
    ECHChartToggleTheme.desc  = 'Toggles dark/light theme (recreates the chart, asynchronous) — same effect as the item in the right menu';
    ECHChartToggleTheme.portHelp = {
        inputs:  { trigger: 'Trigger: toggles the theme when it receives an event.' },
        outputs: { done:    'Event: emitted when the chart has been recreated (asynchronous operation — not emitted immediately in onAction).' },
    };
    ECHChartToggleTheme.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.toggleTheme) return;
        const self = this;
        Promise.resolve(ctx.toggleTheme())
            .then(() => { try { self.triggerSlot(0); } catch {} })
            .catch(err => console.warn('[ECH-flow-nodes] toggleTheme:', err));
    };
    LG.registerNodeType('ECH/Chart/ToggleTheme', ECHChartToggleTheme);


    // ─────────────────────────────────────────────────────────────────────────
    // ECH/Graph/FromTree (2026-10-07)
    // Albero { name, uuid, type, children } (es. TJS/Scene/GetTree, anche via App Bus) →
    // righe per ECH/Chart/SetData, nel formato del template graph-basic o tree-basic.
    // Grafo: nodo id = uuid (ECharts collega gli archi per id: nomi ripetuti non sono
    // un problema), name = nome o, se vuoto, il tipo; categoria = tipo, livello oppure un
    // campo del nodo (widget "category" + "field", 2026-10-08): è la categoria a dare
    // colore e voci di legenda.
    // A evento (trigger → done) e non continuo: collegato fra un Receiver e SetData, un
    // nodo continuo verrebbe ricalcolato DOPO che SetData ha già letto le righe (vuote).
    // ─────────────────────────────────────────────────────────────────────────
    /** Valore di un percorso "a.b.c" in un oggetto (undefined se manca). */
    const pathGet = (obj, path) => String(path ?? '').split('.').filter(Boolean)
        .reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), obj);

    function treeToRows(tree, format, maxNodes, category, field) {
        const max = Math.max(1, Number(maxNodes) || 1000);
        const label = n => (n?.name ? String(n.name) : String(n?.type ?? ''));
        let count = 0;
        if (format === 'tree') {
            const build = n => {
                count++;
                const out = { id: n.uuid ?? null, name: label(n), type: n.type ?? '', value: (n.children ?? []).length };
                const kids = [];
                for (const c of n.children ?? []) { if (count >= max) break; kids.push(build(c)); }
                if (kids.length) out.children = kids;
                return out;
            };
            return { rows: [build(tree)], count };
        }
        const nodes = [], links = [], cats = new Map();
        const catOf = k => { if (!cats.has(k)) cats.set(k, cats.size); return cats.get(k); };
        // per livello: in visita in profondità il primo nodo di un livello compare sempre dopo
        // il primo del livello precedente, quindi l'indice di categoria (= colore) è il livello
        const catKey = (n, depth) => {
            if (category === 'level') return `Level ${depth}`;
            if (category === 'field') {
                const v = pathGet(n, field || 'userData.category');
                return v == null || v === '' ? '(none)' : String(v);
            }
            return String(n.type ?? '');
        };
        const walk = (n, parentId, depth) => {
            count++;
            const id = String(n.uuid ?? `n${count}`);
            const cat = catOf(catKey(n, depth));
            nodes.push({ id, name: label(n), type: n.type ?? '', level: depth, category: cat, value: (n.children ?? []).length });
            if (parentId != null) links.push({ source: parentId, target: id });
            for (const c of n.children ?? []) { if (count >= max) break; walk(c, id, depth + 1); }
        };
        walk(tree, null, 0);
        return { rows: [{ nodes, links, categories: [...cats.keys()].map(name => ({ name })) }], count };
    }

    function ECHGraphFromTree() {
        this.addProperty('format',   'graph', 'string');
        this.addProperty('maxNodes', 1000,    'number');
        this.addWidget('combo',  'format',   'graph', v => { this.properties.format = v; }, { values: ['graph', 'tree'], property: 'format' });
        this.addWidget('number', 'maxNodes', 1000, v => { this.properties.maxNodes = Math.max(1, Math.round(Number(v) || 1000)); }, { min: 1, step: 100, precision: 0, property: 'maxNodes' });
        // ultimo widget: i flow salvati ripristinano i valori dei widget per posizione
        this.addProperty('category', 'type', 'string');
        this.addWidget('combo',  'category', 'type', v => { this.properties.category = v; }, { values: ['type', 'level', 'field'], property: 'category' });
        this.addProperty('field', 'userData.category', 'string');
        this.addWidget('text',   'field', 'userData.category', v => { this.properties.field = String(v ?? '').trim(); }, { property: 'field' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('tree',    'object');
        this.addOutput('done',  LG.EVENT);
        this.addOutput('rows',  'array');
        this.addOutput('count', 'number');
        this.color   = '#1e3a5f';   // famiglia Calcolo
        this.bgcolor = '#1e40af';
        this.size    = [220, 144];
    }
    ECHGraphFromTree.title = 'Graph From Tree';
    ECHGraphFromTree.desc  = 'Converts a tree { name, uuid, type, children } (e.g. from TJS/Scene/GetTree, also via App Bus) into data for ECH/Chart/SetData: network graph (graph-basic template) or tree (tree-basic template). Works anywhere';
    ECHGraphFromTree.error_output = true;
    ECHGraphFromTree.portHelp = {
        inputs: {
            trigger: 'event — converts (usually from the trigger of the App Bus Receiver)',
            tree:    'object { name, uuid, type, children: [...] } — the Receiver payload as it is',
        },
        outputs: {
            done:  'event — rows ready: connect it to the trigger of ECH/Chart/SetData',
            rows:  'array with a single element, to connect to "rows" of ECH/Chart/SetData. graph: [{ nodes: [{ id: uuid, name, type, level, category, value: number of children }], links: [{ source, target }], categories: [{ name: type or "Level N" }] }]; tree: [{ id, name, type, value, children }]',
            count: 'number — nodes included (root included)',
            error: 'event — "tree" missing or not an object. Port hidden by default: right-click → Show error',
        },
        properties: {
            format:   'graph = network graph (mod_spec "template": "graph-basic"); tree = tree (mod_spec "template": "tree-basic"). Must match the panel template',
            maxNodes: 'maximum number of nodes: beyond it branches are cut (a scene with thousands of objects makes the graph unreadable and slow)',
            category: 'graph only: type = one color and one legend entry per object type (Group, Mesh…); level = one per depth ("Level 0" the root, "Level 1" its children…); field = the value stored in the node at the path given in "field" (nodes without a value go into "(none)"). Colors are chosen in order with templateConfig.colors in the mod_spec: with "level" the first color is level 0, with "field" the order is the one in which values appear in the tree',
            field:    'only with category = field: dotted path of the value in the node, e.g. userData.category (field copied by TJS/Scene/GetTree, userData widget) or the name of a field of a tree from another source',
        },
    };
    ECHGraphFromTree.prototype.onAction = function () {
        this.clearError?.();
        const tree = this.getInputData(this.findInputSlot('tree'));
        if (!tree || typeof tree !== 'object' || Array.isArray(tree)) {
            this.triggerError?.(new Error('"tree" must be an object { name, uuid, type, children }'));
            return;
        }
        const { rows, count } = treeToRows(tree, this.properties.format, this.properties.maxNodes, this.properties.category, this.properties.field);
        this.setOutputData(this.findOutputSlot('rows'), rows);
        this.setOutputData(this.findOutputSlot('count'), count);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    LG.registerNodeType('ECH/Graph/FromTree', ECHGraphFromTree);
}
