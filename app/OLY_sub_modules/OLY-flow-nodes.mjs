// app/OLY_sub_modules/OLY-flow-nodes.mjs
// Nodi LiteGraph per i pannelli OLY (cartografia, OpenLayers) — _doc/module-oly-openlayers.md §10.
// Leggono e comandano il pannello solo via graph._appContext (OLY-flow-runner.mjs):
//   ctx.oly          → API del pannello (makeFlowApi in model_OLY.mjs)
//   ctx.localEvents  → eventi del pannello (select, deselect, click, moveEnd, layersLoaded)
//
// L'App non usa l'App Bus: per collegarla ad altri pannelli si usano questi nodi con App Bus/Emitter
// e Receiver (es. OLY/Events/OnSelect → Emitter; Receiver → OLY/Feature/Select).
// I layer si indicano con il loro nome (titolo nella finestra Layer). Le coordinate geografiche sono
// {lon, lat} in gradi WGS84; quelle proiettate {x, y} in metri.
// Regole: _doc/guide-fle-regole-nodi.md (done primo, porte per nome, nodi a evento senza onExecute).

export function registerOLYFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[OLY-flow-nodes] LiteGraph non disponibile'); return; }
    if (window._OLY_FLOW_NODES_REGISTERED) return;
    window._OLY_FLOW_NODES_REGISTERED = true;

    const ACTION = LG.ACTION ?? -1;
    const EVENT  = LG.EVENT  ?? -1;

    const C_EVENT  = ['#062a1a', '#0a4a2e'];
    const C_GET    = ['#1a2a4a', '#1e3a5f'];
    const C_SET    = ['#2a1a4a', '#4a1d96'];
    const C_CREATE = ['#064e3b', '#065f46'];
    const C_DELETE = ['#3a1a1a', '#7f1d1d'];
    const C_CALC   = ['#1e3a5f', '#1e40af'];
    const paint = (node, [c, bg]) => { node.color = c; node.bgcolor = bg; };

    const CONTEXTS = 'Works in the flow of an OLY object and with "Test on panel" on an OLY panel; does nothing in dashboard flows.';
    const NO_PANEL = 'no OLY panel: this node works in the flow of an OLY object or with "Test on panel" on an OLY panel';
    const LONLAT = '{lon, lat} in degrees (WGS84)';

    // ── helper ───────────────────────────────────────────────────────────────
    const olyOf  = node => node.graph?._appContext?.oly ?? null;
    const _out   = (node, name, v) => { const i = node.findOutputSlot(name); if (i >= 0) node.setOutputData(i, v); };
    const _fire  = (node, name)    => { const i = node.findOutputSlot(name); if (i >= 0) node.triggerSlot(i); };
    const _linked = (node, name)   => { const i = node.findInputSlot(name); return i >= 0 && node.inputs[i]?.link != null; };
    const _in    = (node, name)    => { const i = node.findInputSlot(name); return i >= 0 ? node.getInputData(i) : undefined; };
    const _strIn = (node, name, prop) => {
        if (_linked(node, name)) { const v = _in(node, name); return v == null ? '' : String(v); }
        return String(node.properties[prop] ?? '');
    };
    const _numIn = (node, name, prop) => {
        const v = _linked(node, name) ? Number(_in(node, name)) : Number(node.properties[prop]);
        return Number.isFinite(v) ? v : null;
    };
    // {lon, lat} oppure [lon, lat]
    const _lonlat = v => {
        if (Array.isArray(v) && v.length >= 2 && Number.isFinite(+v[0]) && Number.isFinite(+v[1])) return { lon: +v[0], lat: +v[1] };
        if (v && Number.isFinite(+v.lon) && Number.isFinite(+v.lat)) return { lon: +v.lon, lat: +v.lat };
        return null;
    };

    async function _run(node, fn) {
        const seq = node._seq = (node._seq || 0) + 1;
        node.clearError?.();
        const api = olyOf(node);
        if (!api) { node.triggerError?.(new Error(NO_PANEL)); return; }
        try { await fn(api, () => seq === node._seq); }
        catch (e) { if (seq === node._seq) node.triggerError?.(e); }
    }

    function addText(node, prop, def, label = prop) {
        node.addProperty(prop, def, 'string');
        node.addWidget('text', label, def, v => { node.properties[prop] = v; }, { property: prop });
    }
    function addToggle(node, prop, def, label = prop) {
        node.addProperty(prop, def, 'boolean');
        node.addWidget('toggle', label, def, v => { node.properties[prop] = v; }, { property: prop });
    }
    function addNumber(node, prop, def, opts = {}) {
        node.addProperty(prop, def, 'number');
        node.addWidget('number', prop, def, v => { node.properties[prop] = v; }, { property: prop, ...opts });
    }

    // ── Events ───────────────────────────────────────────────────────────────

    function wireLocal(node, eventName, accept) {
        node._cleanup?.();
        node._cleanup = null;
        node._pending = null;
        const ctx = node.graph?._appContext;
        const bus = ctx?.localEvents;
        if (!bus) return;
        const g = node.graph;
        const handler = ev => {
            if (accept && !accept(ev.detail)) return;
            node._pending = ev.detail ?? {};
            try { g.runStep(1); } catch {}
        };
        bus.addEventListener(eventName, handler);
        node._cleanup = () => bus.removeEventListener(eventName, handler);
        ctx.signal?.addEventListener('abort', () => node._cleanup?.(), { once: true });
    }

    function makeEventNode({ type, title, desc, event, outputs, help, accept, init, start, size }) {
        function N() {
            this.addOutput('trigger', EVENT);
            for (const [name, ty] of outputs) this.addOutput(name, ty);
            init?.call(this);
            this._pending = null;
            this._cleanup = null;
            paint(this, C_EVENT);
            this.size = size ?? [230, 40 + 20 * (outputs.length + 1)];
        }
        N.title = title;
        N.desc = desc + ' ' + CONTEXTS;
        N.portHelp = { inputs: {}, outputs: help };
        N.prototype.onStart = function () {
            wireLocal(this, event, accept ? d => accept.call(this, d) : null);
            start?.call(this);
        };
        N.prototype.onStop = function () { this._cleanup?.(); this._cleanup = null; };
        N.prototype.onExecute = function () {
            if (this._pending == null) return;
            const d = this._pending; this._pending = null;
            for (const [name] of outputs) _out(this, name, d[name] ?? null);
            _fire(this, 'trigger');
        };
        LG.registerNodeType(type, N);
        return N;
    }

    const ONLY_USER = 'only user: ON (default) = fires only for selections made by clicking; OFF = also for selections made by the flow (Feature Select). Keep it ON when the flow sends the selection to the App Bus and receives it back, to avoid loops.';
    makeEventNode({
        type: 'OLY/Events/OnSelect', title: 'Events On Select',
        desc: 'Fires when a feature of a file layer (GeoJSON, KML, GPX) is selected.',
        event: 'select',
        outputs: [['layer', 'string'], ['name', 'string'], ['properties', 'object'], ['position', 'object'], ['source', 'string']],
        help: {
            trigger:    'event — emitted when a feature is selected',
            layer:      'string — name of the layer (as in the Layers window)',
            name:       'string — feature name (attribute name / nome / title…), or "#n"',
            properties: 'object — all the attributes of the feature',
            position:   LONLAT + ' — the point, or the center of a line/area',
            source:     'string — "user" (click) or "flow" (OLY/Feature/Select)',
        },
        init() { addToggle(this, 'only_user', true, 'only user'); },
        accept(d) { return !this.properties.only_user || d?.source !== 'flow'; },
        size: [240, 180],
    }).portHelp.properties = { only_user: ONLY_USER };

    makeEventNode({
        type: 'OLY/Events/OnDeselect', title: 'Events On Deselect',
        desc: 'Fires when the selection is cleared (click on empty space or Feature Clear Selection).',
        event: 'deselect',
        outputs: [['source', 'string']],
        help: { trigger: 'event — emitted when nothing is selected any more', source: 'string — "user" or "flow"' },
    });

    makeEventNode({
        type: 'OLY/Events/OnClick', title: 'Events On Click',
        desc: 'Fires at every click on the map (also on empty space), with the coordinates of the point. Not while a measurement tool is on.',
        event: 'click',
        outputs: [['lonlat', 'object'], ['xy', 'object'], ['crs', 'string']],
        help: {
            trigger: 'event — emitted at every single click on the map',
            lonlat:  LONLAT,
            xy:      '{x, y} — the same point in the coordinate system chosen for the footer (metres, or degrees for EPSG:4326)',
            crs:     'string — that coordinate system, e.g. "EPSG:3004"',
        },
    });

    makeEventNode({
        type: 'OLY/Events/OnServiceInfo', title: 'Events On Service Info',
        desc: 'Fires after a click on the map when a service of the catalog with feature info (e.g. the Cadastre) is on: what the service says about that point. One event per service.',
        event: 'serviceInfo',
        outputs: [['service', 'string'], ['features', 'array'], ['lonlat', 'object']],
        help: {
            trigger:  'event — emitted when the service has answered (also with no features)',
            service:  'string — id of the service in the catalog, e.g. "catasto-ade"',
            features: 'array of {layer, properties} — properties: the values given by the service, e.g. NationalCadastralReference for a parcel',
            lonlat:   LONLAT + ' — the clicked point',
        },
        size: [240, 120],
    });

    makeEventNode({
        type: 'OLY/Events/OnMoveEnd', title: 'Events On Move End',
        desc: 'Fires when the map stops after a pan, zoom or rotation (user or flow).',
        event: 'moveEnd',
        outputs: [['center', 'object'], ['zoom', 'number'], ['extent', 'array']],
        help: {
            trigger: 'event — emitted when the view stops moving',
            center:  LONLAT,
            zoom:    'number — zoom level (0 world … 22 detail)',
            extent:  'array — [west, south, east, north] in degrees',
        },
    });

    makeEventNode({
        type: 'OLY/Events/OnLayersLoaded', title: 'Events On Layers Loaded',
        desc: 'Fires once the layers of the panel are loaded (immediately at flow start if they already are).',
        event: 'layersLoaded',
        outputs: [['count', 'number'], ['layers', 'array']],
        help: {
            trigger: 'event — emitted once, when the layers are ready',
            count:   'number — layers loaded without errors',
            layers:  'array of string — their names',
        },
        start() {
            const api = olyOf(this);
            if (!api?.layersLoaded) return;
            const names = api.listLayers().filter(l => !l.error).map(l => l.title);
            this._pending = { count: names.length, layers: names };
            const g = this.graph;
            setTimeout(() => { try { g?.runStep(1); } catch {} }, 0);
        },
    });

    // ── Nodi a evento: costruttore comune ────────────────────────────────────

    function makeAction({ type, title, desc, color = C_SET, inputs = [], outputs = [], init, size, help = {}, run, notFound = false }) {
        function N() {
            this.addInput('trigger', ACTION);
            for (const [n, ty] of inputs) this.addInput(n, ty);
            this.addOutput('done', EVENT);
            if (notFound) this.addOutput('not_found', EVENT);
            for (const [n, ty] of outputs) this.addOutput(n, ty);
            init?.call(this);
            paint(this, color);
            this.size = size ?? [220, 60 + 20 * Math.max(inputs.length, outputs.length)];
        }
        N.title = title;
        N.desc = desc + ' ' + CONTEXTS;
        N.error_output = true;
        N.portHelp = {
            inputs:  { trigger: help.trigger ?? 'event — runs the node', ...(help.inputs || {}) },
            outputs: {
                done: help.done ?? 'event — emitted after the outputs are written',
                ...(notFound ? { not_found: help.not_found ?? 'event — nothing found (no done)' } : {}),
                ...(help.outputs || {}),
                error: 'error — when there is no OLY panel or the command fails',
            },
            ...(help.properties ? { properties: help.properties } : {}),
        };
        N.prototype.onAction = function () {
            const node = this;
            _run(node, async (api, current) => {
                const r = await run.call(node, api);
                if (!current()) return;
                if (r === false) { _fire(node, 'not_found'); return; }
                if (r && typeof r === 'object' && !Array.isArray(r)) for (const [k, v] of Object.entries(r)) _out(node, k, v);
                _fire(node, 'done');
            });
        };
        LG.registerNodeType(type, N);
        return N;
    }

    const LAYER_HELP = 'string — name of the layer as in the Layers window (case-insensitive)';

    // ── View ─────────────────────────────────────────────────────────────────

    makeAction({
        type: 'OLY/View/Get', title: 'View Get', color: C_GET,
        desc: 'Reads the current view of the map.',
        outputs: [['center', 'object'], ['zoom', 'number'], ['rotation', 'number'], ['extent', 'array']],
        help: { outputs: { center: LONLAT, zoom: 'number — zoom level', rotation: 'number — degrees', extent: 'array — [west, south, east, north] in degrees' } },
        run: api => api.getView(),
    });

    makeAction({
        type: 'OLY/View/Set', title: 'View Set',
        desc: 'Moves the map to a center and zoom.',
        inputs: [['center', 'object'], ['zoom', 'number']],
        init() { addNumber(this, 'zoom', 17, { min: 0, max: 22, step: 10, precision: 1 }); addToggle(this, 'animate', true); },
        size: [220, 110],
        help: {
            inputs: { center: LONLAT + ' or [lon, lat]', zoom: 'number — if connected it prevails on the widget' },
            done: 'event — emitted when the map has arrived',
            properties: { zoom: 'number — 0 (world) … 22 (detail)', animate: 'boolean — smooth movement' },
        },
        async run(api) {
            const c = _lonlat(_in(this, 'center'));
            if (!c) throw new Error('center must be {lon, lat} or [lon, lat]');
            await api.setView(c, _numIn(this, 'zoom', 'zoom'), !!this.properties.animate);
        },
    });

    makeAction({
        type: 'OLY/View/Fit All', title: 'View Fit All',
        desc: 'Frames all the visible layers, like the "Fit all layers" button.',
        run: api => api.fitAll(),
    });

    makeAction({
        type: 'OLY/View/Fit Layer', title: 'View Fit Layer', notFound: true,
        desc: 'Frames one layer.',
        inputs: [['layer', 'string']],
        init() { addText(this, 'layer', ''); },
        size: [220, 80],
        help: { inputs: { layer: LAYER_HELP + '; if connected it prevails on the widget' }, not_found: 'event — no layer with that name, or it has no extent (services)' },
        run(api) { return api.fitLayer(_strIn(this, 'layer', 'layer')); },
    });

    makeAction({
        type: 'OLY/View/Go To View', title: 'View Go To View', notFound: true,
        desc: 'Goes to a view of the Views window by name (center, zoom, base and layers turned on).',
        inputs: [['name', 'string']],
        init() { addText(this, 'name', ''); },
        size: [220, 80],
        help: { inputs: { name: 'string — view name; if connected it prevails on the widget' }, not_found: 'event — no view with that name' },
        run(api) { return api.goToView(_strIn(this, 'name', 'name')); },
    });

    // ── Layer ────────────────────────────────────────────────────────────────

    makeAction({
        type: 'OLY/Layer/List', title: 'Layer List', color: C_GET,
        desc: 'Lists the layers of the panel.',
        outputs: [['layers', 'array'], ['names', 'array']],
        help: { outputs: { layers: 'array of {title, kind, visible, opacity, error} — kind: vector, raster, image, service, flow', names: 'array of string — layer names' } },
        run(api) { const l = api.listLayers(); return { layers: l, names: l.map(x => x.title) }; },
    });

    makeAction({
        type: 'OLY/Layer/Visible', title: 'Layer Visible', notFound: true,
        desc: 'Shows or hides a layer.',
        inputs: [['layer', 'string'], ['visible', 'boolean']],
        init() { addText(this, 'layer', ''); addToggle(this, 'visible', true); },
        size: [220, 100],
        help: { inputs: { layer: LAYER_HELP, visible: 'boolean — if connected it prevails on the widget' }, not_found: 'event — no layer with that name' },
        run(api) {
            const v = _linked(this, 'visible') ? !!_in(this, 'visible') : !!this.properties.visible;
            return api.setLayerVisible(_strIn(this, 'layer', 'layer'), v);
        },
    });

    makeAction({
        type: 'OLY/Layer/Opacity', title: 'Layer Opacity', notFound: true,
        desc: 'Changes the opacity of a layer.',
        inputs: [['layer', 'string'], ['opacity', 'number']],
        init() { addText(this, 'layer', ''); addNumber(this, 'opacity', 1, { min: 0, max: 1, step: 1, precision: 2 }); },
        size: [220, 100],
        help: { inputs: { layer: LAYER_HELP, opacity: 'number — 0 (invisible) … 1 (opaque); if connected it prevails on the widget' }, not_found: 'event — no layer with that name' },
        run(api) { return api.setLayerOpacity(_strIn(this, 'layer', 'layer'), _numIn(this, 'opacity', 'opacity') ?? 1); },
    });

    makeAction({
        type: 'OLY/Layer/Set Base', title: 'Layer Set Base',
        desc: 'Changes the base map (an id of the service catalog, or "none").',
        inputs: [['base', 'string']],
        init() { addText(this, 'base', 'osm'); },
        size: [220, 80],
        help: { inputs: { base: 'string — "osm", "opentopomap", "esri-imagery"… (lib/map-services.json) or "none"; if connected it prevails on the widget' } },
        run(api) { return api.setBase(_strIn(this, 'base', 'base')); },
    });

    makeAction({
        type: 'OLY/Layer/Add GeoJSON', title: 'Layer Add GeoJSON', color: C_CREATE,
        desc: 'Draws GeoJSON data received by the flow as a layer (e.g. from a table or a service). A second call with the same name replaces its features.',
        inputs: [['geojson', 0]],
        init() { addText(this, 'name', 'flow layer'); addText(this, 'color', '#2563eb'); addText(this, 'label', ''); },
        size: [240, 120],
        help: {
            inputs: { geojson: 'object — GeoJSON FeatureCollection, Feature or Geometry, coordinates in WGS84 [lon, lat]' },
            done: 'event — emitted after the layer is drawn',
            outputs: { count: 'number — features drawn' },
            properties: { name: 'string — layer name (also to replace or remove it)', color: 'string — "#rrggbb"', label: 'string — attribute written on the map, empty = none' },
        },
        outputs: [['count', 'number']],
        run(api) {
            const gj = _in(this, 'geojson');
            if (!gj || typeof gj !== 'object') throw new Error('geojson must be a GeoJSON object');
            return { count: api.addGeoJSON(String(this.properties.name || 'flow layer'), gj, { color: this.properties.color, label: this.properties.label }) };
        },
    });

    makeAction({
        type: 'OLY/Layer/Remove', title: 'Layer Remove', color: C_DELETE, notFound: true,
        desc: 'Removes a layer added by the flow (Layer Add GeoJSON). The layers of the models are not removed: hide them with Layer Visible.',
        inputs: [['layer', 'string']],
        init() { addText(this, 'layer', ''); },
        size: [220, 80],
        help: { inputs: { layer: 'string — name given in Layer Add GeoJSON' }, not_found: 'event — no flow layer with that name' },
        run(api) { return api.removeFlowLayer(_strIn(this, 'layer', 'layer')); },
    });

    // ── Feature ──────────────────────────────────────────────────────────────

    const MATCH = ['equals', 'contains'];
    const findInit = function () {
        addText(this, 'layer', '');
        addText(this, 'attribute', 'name');
        this.addProperty('match', 'equals', 'string');
        this.addWidget('combo', 'match', 'equals', v => { this.properties.match = v; }, { values: MATCH, property: 'match' });
        addText(this, 'value', '');
    };
    const findParams = node => ({
        layer: String(node.properties.layer || ''),
        attribute: String(node.properties.attribute || ''),
        value: _strIn(node, 'value', 'value'),
        match: MATCH.includes(node.properties.match) ? node.properties.match : 'equals',
    });
    const FIND_PROPS = {
        layer: 'string — layer name; empty = all the file layers',
        attribute: 'string — attribute name; empty = any attribute',
        match: '"equals" (numbers as numbers, text ignoring case) or "contains"',
        value: 'string — value to look for (the value input, if connected, prevails)',
    };

    makeAction({
        type: 'OLY/Feature/Find', title: 'Feature Find', color: C_GET,
        desc: 'Finds the features of the file layers with an attribute value.',
        inputs: [['value', 'string']],
        outputs: [['features', 'array'], ['count', 'number']],
        init: findInit,
        size: [250, 170],
        help: {
            inputs: { value: 'string — value to look for; if connected it prevails on the widget' },
            outputs: { features: 'array of {layer, name, properties, position} — position: ' + LONLAT, count: 'number — features found' },
            properties: FIND_PROPS,
        },
        run(api) { const f = api.findFeatures(findParams(this)); return { features: f, count: f.length }; },
    });

    makeAction({
        type: 'OLY/Feature/Select', title: 'Feature Select', notFound: true,
        desc: 'Selects (and frames) the first feature with an attribute value, as a click would: e.g. App Bus/Receiver → Select with attribute = the id shared with a table.',
        inputs: [['value', 'string']],
        init() { findInit.call(this); addToggle(this, 'fit', true); },
        size: [250, 190],
        help: {
            inputs: { value: 'string — value to look for; if connected it prevails on the widget' },
            done: 'event — emitted after the selection',
            not_found: 'event — no feature with that value',
            properties: { ...FIND_PROPS, fit: 'boolean — frame the selected feature' },
        },
        run(api) { return api.selectFeature(findParams(this), !!this.properties.fit); },
    });

    makeAction({
        type: 'OLY/Feature/Get Selection', title: 'Feature Get Selection', color: C_GET,
        desc: 'Reads the selected feature (null outputs if nothing is selected).',
        outputs: [['layer', 'string'], ['name', 'string'], ['properties', 'object'], ['position', 'object']],
        help: { outputs: { layer: 'string — layer name', name: 'string — feature name', properties: 'object — attributes', position: LONLAT } },
        run(api) { const s = api.getSelection(); return s ?? { layer: null, name: null, properties: null, position: null }; },
    });

    makeAction({
        type: 'OLY/Feature/Clear Selection', title: 'Feature Clear Selection',
        desc: 'Clears the selection.',
        run(api) { api.clearSelection(); },
    });

    makeAction({
        type: 'OLY/Feature/Color By Value', title: 'Feature Color By Value',
        desc: 'Gives one color to each value of an attribute of a layer, like the "Color by value" window.',
        outputs: [['legend', 'array']],
        init() { addText(this, 'layer', ''); addText(this, 'attribute', ''); },
        size: [240, 100],
        help: {
            outputs: { legend: 'array of {value, color, count} — sorted by value; after 24 values one grey group with value null' },
            properties: { layer: LAYER_HELP, attribute: 'string — attribute name' },
        },
        run(api) { return { legend: api.colorByValue(String(this.properties.layer || ''), String(this.properties.attribute || '')) }; },
    });

    makeAction({
        type: 'OLY/Feature/Reset Styles', title: 'Feature Reset Styles',
        desc: 'Removes colors and filters (Color by value, Show only) from the features.',
        run(api) { api.resetStyles(); },
    });

    // ── Coordinate e misure ──────────────────────────────────────────────────

    // Calcolo puro (nessun pannello): ricalcolato quando viene letto (lib/litegraph, patch 7)
    function CoordTransform() {
        this.addInput('point', 0);
        this.addOutput('point', 'object');
        this.addProperty('from', 'EPSG:4326', 'string');
        this.addProperty('to', 'EPSG:3004', 'string');
        this.addWidget('text', 'from', 'EPSG:4326', v => { this.properties.from = v; }, { property: 'from' });
        this.addWidget('text', 'to', 'EPSG:3004', v => { this.properties.to = v; }, { property: 'to' });
        paint(this, C_CALC);
        this.size = [220, 90];
    }
    CoordTransform.title = 'Coord Transform';
    CoordTransform.desc  = 'Converts a point between coordinate systems (WGS84, Gauss-Boaga, UTM RDN2008/ETRS89/WGS84, Web Mercator). Needs the OpenLayers libraries, loaded by an OLY panel.';
    CoordTransform.pure = true;
    CoordTransform.portHelp = {
        inputs:  { point: '{lon, lat} or [lon, lat] when "from" is EPSG:4326/4258/6706; otherwise {x, y} or [x, y] in metres' },
        outputs: { point: '{lon, lat} when "to" is geographic, otherwise {x, y} in metres; null if the input is not a point or the system is unknown' },
        properties: { from: 'string — e.g. "EPSG:4326"', to: 'string — e.g. "EPSG:3004", "EPSG:6708", "EPSG:32633", "EPSG:3857"' },
    };
    const GEO = new Set(['EPSG:4326', 'EPSG:4258', 'EPSG:6706']);
    CoordTransform.prototype.onExecute = function () {
        const ol = window.ol, v = this.getInputData(0);
        const from = String(this.properties.from || ''), to = String(this.properties.to || '');
        let xy = null;
        if (Array.isArray(v) && v.length >= 2) xy = [+v[0], +v[1]];
        else if (v && Number.isFinite(+v.lon) && Number.isFinite(+v.lat)) xy = [+v.lon, +v.lat];
        else if (v && Number.isFinite(+v.x) && Number.isFinite(+v.y)) xy = [+v.x, +v.y];
        if (!ol?.proj || !xy || !xy.every(Number.isFinite) || !ol.proj.get(from) || !ol.proj.get(to)) { this.setOutputData(0, null); return; }
        const [a, b] = ol.proj.transform(xy, from, to);
        this.setOutputData(0, GEO.has(to) ? { lon: a, lat: b } : { x: a, y: b });
    };
    LG.registerNodeType('OLY/Coord/Transform', CoordTransform);

    makeAction({
        type: 'OLY/Measure/Get All', title: 'Measure Get All', color: C_GET,
        desc: 'Reads the distances and areas measured in the panel.',
        outputs: [['lengths', 'array'], ['areas', 'array']],
        help: { outputs: { lengths: 'array of number — metres, one per distance measurement', areas: 'array of number — square metres, one per area measurement' } },
        run: api => api.getMeasures(),
    });
}
