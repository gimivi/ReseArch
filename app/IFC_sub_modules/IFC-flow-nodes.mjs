// app/IFC_sub_modules/IFC-flow-nodes.mjs
// Nodi LiteGraph per i pannelli IFC (BIM, That Open Components / Fragments).
// Leggono e comandano il pannello solo via graph._appContext (IFC-flow-runner.mjs):
//   ctx.ifc          → API del pannello (makeFlowApi in model_IFC.mjs)
//   ctx.localEvents  → eventi del pannello (select, deselect, modelsLoaded, cameraSettled)
//
// L'App IFC non usa l'App Bus: per collegarla ad altri pannelli si usano questi nodi con
// App Bus/Emitter e Receiver (es. IFC/Events/OnSelect → Emitter; Receiver → Select By Guid).
//
// Gli elementi si indicano con il GlobalId IFC: "guid" (string) per uno, "guids" (array di
// string) per una lista. Da un solo guid a una lista: Params/Array/Maker.
//
// Famiglie: Events (sorgenti), Selection, Data (lettura), Visibility, Camera.
// Regole: _doc/guide-fle-regole-nodi.md (done primo, porte per nome, nodi a evento senza onExecute).

export function registerIFCFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[IFC-flow-nodes] LiteGraph non disponibile'); return; }
    if (window._IFC_FLOW_NODES_REGISTERED) return;
    window._IFC_FLOW_NODES_REGISTERED = true;

    const ACTION = LG.ACTION ?? -1;
    const EVENT  = LG.EVENT  ?? -1;

    // Colori per famiglia di comportamento (guide-fle-regole-nodi.md §10)
    const C_EVENT = ['#062a1a', '#0a4a2e'];
    const C_GET   = ['#1a2a4a', '#1e3a5f'];
    const C_SET   = ['#2a1a4a', '#4a1d96'];
    const paint = (node, [c, bg]) => { node.color = c; node.bgcolor = bg; };

    const CONTEXTS = 'Works in the flow of an IFC object and with "Test on panel" on an IFC panel; does nothing in dashboard flows.';
    const NO_PANEL = 'no IFC panel: this node works in the flow of an IFC object or with "Test on panel" on an IFC panel';

    // ── helper ───────────────────────────────────────────────────────────────
    const ifcOf  = node => node.graph?._appContext?.ifc ?? null;
    const _out   = (node, name, v) => { const i = node.findOutputSlot(name); if (i >= 0) node.setOutputData(i, v); };
    const _fire  = (node, name)    => { const i = node.findOutputSlot(name); if (i >= 0) node.triggerSlot(i); };
    const _slot  = (node, name)    => node.findInputSlot(name);
    const _linked = (node, name)   => { const i = _slot(node, name); return i >= 0 && node.inputs[i]?.link != null; };
    const _in    = (node, name)    => { const i = _slot(node, name); return i >= 0 ? node.getInputData(i) : undefined; };
    // ingresso collegato prevale sul widget (proprietà)
    const _strIn = (node, name, prop) => {
        if (_linked(node, name)) { const v = _in(node, name); return v == null ? '' : String(v); }
        return String(node.properties[prop] ?? '');
    };
    const _guids = (node) => { const v = _in(node, 'guids'); return Array.isArray(v) ? v.map(String).filter(Boolean) : []; };
    // {x,y,z} oppure [x,y,z] (eccezione dichiarata per i vettori, guide §2)
    const _vec = v => {
        if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(n => Number.isFinite(Number(n)))) {
            return { x: Number(v[0]), y: Number(v[1]), z: Number(v[2]) };
        }
        if (v && ['x', 'y', 'z'].every(k => Number.isFinite(Number(v[k])))) {
            return { x: Number(v.x), y: Number(v.y), z: Number(v.z) };
        }
        return null;
    };

    // Lavoro asincrono: contatore di sequenza (un nuovo trigger supera il precedente),
    // errori sulla porta d'errore del fork, nessuna eccezione se manca il pannello.
    async function _run(node, fn) {
        const seq = node._seq = (node._seq || 0) + 1;
        node.clearError?.();
        const api = ifcOf(node);
        if (!api) { node.triggerError?.(new Error(NO_PANEL)); return; }
        try {
            await fn(api, () => seq === node._seq);
        } catch (e) {
            if (seq === node._seq) node.triggerError?.(e);
        }
    }

    // Nodi Events/*: onStart → evento → _pending + runStep(1) → onExecute emette
    function _wireLocalEvent(node, eventName, accept) {
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

    function makeEventNode({ type, title, desc, event, outputs, help, accept, size, init, start }) {
        function N() {
            this.addOutput('trigger', EVENT);
            for (const [name, t] of outputs) this.addOutput(name, t);
            init?.call(this);
            this._pending = null;
            this._cleanup = null;
            paint(this, C_EVENT);
            this.size = size ?? [220, 40 + 20 * (outputs.length + 1)];
        }
        N.title = title;
        N.desc = desc;
        N.portHelp = { outputs: help, inputs: {} };
        N.prototype.onStart = function () {
            _wireLocalEvent(this, event, accept ? d => accept.call(this, d) : null);
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

    // ═════════════════════════════════════════════════════════════════════════
    // Events
    // ═════════════════════════════════════════════════════════════════════════

    const ONLY_USER_HELP = 'only user: ON (default) = fires only for selections made by the user (click in the model or in the tree); OFF = also for selections made by the flow (Select By Guid). Keep it ON when the flow sends the selection to the App Bus and receives it back, to avoid loops.';

    makeEventNode({
        type: 'IFC/Events/OnSelect', title: 'Events On Select',
        desc: 'Fires when an IFC element is selected. ' + CONTEXTS,
        event: 'select',
        outputs: [['guid', 'string'], ['localId', 'number'], ['category', 'string'], ['name', 'string'], ['modelId', 'string'], ['source', 'string']],
        help: {
            trigger:  'event — emitted when an element is selected, after its data has been read',
            guid:     'string — IFC GlobalId of the element (22 characters)',
            localId:  'number — id of the element inside its model (Fragments localId)',
            category: 'string — IFC class as stored by Fragments, e.g. "IFCWALL"',
            name:     'string — IFC Name attribute; null if missing',
            modelId:  'string — id of the model that contains the element (file name without extension)',
            source:   'string — "user" (click, tree) or "flow" (IFC/Selection/Select By Guid)',
        },
        init() {
            this.addProperty('only_user', true, 'boolean');
            this.addWidget('toggle', 'only user', true, v => { this.properties.only_user = v; }, { property: 'only_user' });
        },
        accept(d) { return !this.properties.only_user || d?.source !== 'flow'; },
        size: [230, 190],
    }).portHelp.properties = { only_user: ONLY_USER_HELP };

    makeEventNode({
        type: 'IFC/Events/OnDeselect', title: 'Events On Deselect',
        desc: 'Fires when the selection is cleared (click on empty space, Selection Clear). ' + CONTEXTS,
        event: 'deselect',
        outputs: [['source', 'string']],
        help: {
            trigger: 'event — emitted when nothing is selected any more (not when the selection moves to another element)',
            source:  'string — "user" or "flow" (IFC/Selection/Clear)',
        },
        init() {
            this.addProperty('only_user', true, 'boolean');
            this.addWidget('toggle', 'only user', true, v => { this.properties.only_user = v; }, { property: 'only_user' });
        },
        accept(d) { return !this.properties.only_user || d?.source !== 'flow'; },
        size: [220, 80],
    }).portHelp.properties = { only_user: ONLY_USER_HELP };

    makeEventNode({
        type: 'IFC/Events/OnModelsLoaded', title: 'Events On Models Loaded',
        desc: 'Fires once the IFC/FRAG models of the panel are loaded (immediately at flow start if they already are). ' + CONTEXTS,
        event: 'modelsLoaded',
        outputs: [['count', 'number'], ['modelIds', 'array']],
        help: {
            trigger:  'event — emitted once, when the models are ready; use it to start chains that need the model',
            count:    'number — models loaded',
            modelIds: 'array of string — model ids (file names without extension)',
        },
        // I flow partono dopo il caricamento: se i modelli ci sono già, l'evento parte subito
        start() {
            const api = ifcOf(this);
            if (!api?.modelsLoaded) return;
            const ids = api.modelIds();
            this._pending = { count: ids.length, modelIds: ids };
            const g = this.graph;
            setTimeout(() => { try { g?.runStep(1); } catch {} }, 0);
        },
    });

    makeEventNode({
        type: 'IFC/Events/OnCameraSettled', title: 'Events On Camera Settled',
        desc: 'Fires when the camera stops after a movement (user or flow). ' + CONTEXTS,
        event: 'cameraSettled',
        outputs: [['position', 'object'], ['target', 'object']],
        help: {
            trigger:  'event — emitted when the camera comes to rest',
            position: '{x,y,z} in metres — camera position',
            target:   '{x,y,z} in metres — point the camera looks at (orbit point)',
        },
    });

    // ═════════════════════════════════════════════════════════════════════════
    // Selection
    // ═════════════════════════════════════════════════════════════════════════

    function SelectionGet() {
        this.addInput('trigger', ACTION);
        this.addOutput('done', EVENT);
        for (const [n, t] of [['guid', 'string'], ['localId', 'number'], ['category', 'string'], ['name', 'string'], ['modelId', 'string']]) this.addOutput(n, t);
        paint(this, C_GET);
        this.size = [210, 140];
    }
    SelectionGet.title = 'Selection Get';
    SelectionGet.desc  = 'Reads the selected IFC element. ' + CONTEXTS;
    SelectionGet.error_output = true;
    SelectionGet.portHelp = {
        inputs:  { trigger: 'event — reads the current selection' },
        outputs: {
            done:     'event — emitted after the outputs are written (also when nothing is selected)',
            guid:     'string — IFC GlobalId; null if nothing is selected',
            localId:  'number — Fragments localId; null if nothing is selected',
            category: 'string — IFC class, e.g. "IFCSLAB"; null if nothing is selected',
            name:     'string — IFC Name; null if missing or nothing selected',
            modelId:  'string — model id; null if nothing is selected',
            error:    'error — when there is no IFC panel',
        },
    };
    SelectionGet.prototype.onAction = function () {
        _run(this, async (api) => {
            const s = api.getSelection();
            for (const n of ['guid', 'localId', 'category', 'name', 'modelId']) _out(this, n, s ? s[n] ?? null : null);
            _fire(this, 'done');
        });
    };
    LG.registerNodeType('IFC/Selection/Get', SelectionGet);

    function SelectByGuid() {
        this.addInput('trigger', ACTION);
        this.addInput('guid', 'string');
        this.addOutput('done', EVENT);
        this.addOutput('not_found', EVENT);
        this.addProperty('fit', true, 'boolean');
        this.addWidget('toggle', 'fit', true, v => { this.properties.fit = v; }, { property: 'fit' });
        paint(this, C_SET);
        this.size = [220, 90];
    }
    SelectByGuid.title = 'Selection Select By Guid';
    SelectByGuid.desc  = 'Selects (and optionally frames) the element with the given IFC GlobalId, as a click would. ' + CONTEXTS;
    SelectByGuid.error_output = true;
    SelectByGuid.portHelp = {
        inputs: {
            trigger: 'event — selects the element',
            guid:    'string — IFC GlobalId (22 characters); empty → not_found',
        },
        outputs: {
            done:      'event — emitted after the selection, once the element data is read',
            not_found: 'event — no loaded model contains that GlobalId',
            error:     'error — when there is no IFC panel or the model cannot be read',
        },
        properties: { fit: 'boolean — ON: the camera frames the selected element' },
    };
    SelectByGuid.prototype.onAction = function () {
        const guid = String(_in(this, 'guid') ?? '').trim();
        _run(this, async (api, current) => {
            const ok = guid ? await api.selectByGuid(guid, { fit: !!this.properties.fit }) : false;
            if (!current()) return;
            _fire(this, ok ? 'done' : 'not_found');
        });
    };
    LG.registerNodeType('IFC/Selection/Select By Guid', SelectByGuid);

    function SelectionClear() {
        this.addInput('trigger', ACTION);
        this.addOutput('done', EVENT);
        paint(this, C_SET);
        this.size = [180, 50];
    }
    SelectionClear.title = 'Selection Clear';
    SelectionClear.desc  = 'Clears the selection. ' + CONTEXTS;
    SelectionClear.error_output = true;
    SelectionClear.portHelp = {
        inputs:  { trigger: 'event — clears the selection' },
        outputs: { done: 'event — emitted after the selection is cleared', error: 'error — when there is no IFC panel' },
    };
    SelectionClear.prototype.onAction = function () {
        _run(this, async (api, current) => { await api.clearSelection(); if (current()) _fire(this, 'done'); });
    };
    LG.registerNodeType('IFC/Selection/Clear', SelectionClear);

    // ═════════════════════════════════════════════════════════════════════════
    // Data
    // ═════════════════════════════════════════════════════════════════════════

    function GetProperties() {
        this.addInput('trigger', ACTION);
        this.addInput('guid', 'string');
        this.addOutput('done', EVENT);
        this.addOutput('not_found', EVENT);
        this.addOutput('properties', 'object');
        this.addOutput('category', 'string');
        this.addOutput('name', 'string');
        paint(this, C_GET);
        this.size = [220, 120];
    }
    GetProperties.title = 'Data Get Properties';
    GetProperties.desc  = 'Reads all the data of an IFC element as one flat object (attributes, property sets, quantities, container, materials). ' + CONTEXTS;
    GetProperties.error_output = true;
    GetProperties.portHelp = {
        inputs: {
            trigger: 'event — reads the data',
            guid:    'string — IFC GlobalId of the element',
        },
        outputs: {
            done:       'event — emitted after the outputs are written',
            not_found:  'event — no loaded model contains that GlobalId (or guid is empty)',
            properties: 'object — flat: attributes by name ("Name", "ObjectType", "Tag"…), property sets and quantities as "PsetName.Property" (e.g. "Pset_WallCommon.FireRating"), "ContainedIn" / "ContainedInClass" (storey or space), "Materials" (names, comma-separated)',
            category:   'string — IFC class, e.g. "IFCWALL"',
            name:       'string — IFC Name; null if missing',
            error:      'error — when there is no IFC panel or the model cannot be read',
        },
    };
    GetProperties.prototype.onAction = function () {
        const guid = String(_in(this, 'guid') ?? '').trim();
        _run(this, async (api, current) => {
            const r = guid ? await api.getProperties(guid) : null;
            if (!current()) return;
            if (!r) { _out(this, 'properties', null); _out(this, 'category', null); _out(this, 'name', null); _fire(this, 'not_found'); return; }
            _out(this, 'properties', r.properties);
            _out(this, 'category', r.category);
            _out(this, 'name', r.name);
            _fire(this, 'done');
        });
    };
    LG.registerNodeType('IFC/Data/Get Properties', GetProperties);

    function GetProperty() {
        this.addInput('trigger', ACTION);
        this.addInput('guid', 'string');
        this.addInput('property', 'string');
        this.addOutput('done', EVENT);
        this.addOutput('not_found', EVENT);
        this.addOutput('value', 0);
        this.addProperty('property', 'Name', 'string');
        this.addWidget('text', 'property', 'Name', v => { this.properties.property = v; }, { property: 'property' });
        paint(this, C_GET);
        this.size = [240, 110];
    }
    GetProperty.title = 'Data Get Property';
    GetProperty.desc  = 'Reads one value of an IFC element: an attribute ("Name") or a property/quantity ("Pset_WallCommon.FireRating"). ' + CONTEXTS;
    GetProperty.error_output = true;
    GetProperty.portHelp = {
        inputs: {
            trigger:  'event — reads the value',
            guid:     'string — IFC GlobalId of the element',
            property: 'string — "Attribute" or "PsetName.Property", same keys as Data Get Properties; if connected it prevails on the widget',
        },
        outputs: {
            done:      'event — emitted after value is written',
            not_found: 'event — element or property not found (value = null)',
            value:     'string, number or boolean — the value as stored in the IFC file (lengths in model units, usually metres)',
            error:     'error — when there is no IFC panel or the model cannot be read',
        },
        properties: { property: 'string — key to read when the property input is not connected' },
    };
    GetProperty.prototype.onAction = function () {
        const guid = String(_in(this, 'guid') ?? '').trim();
        const key  = _strIn(this, 'property', 'property').trim();
        _run(this, async (api, current) => {
            const r = guid && key ? await api.getProperties(guid) : null;
            if (!current()) return;
            const v = r ? r.properties[key] : undefined;
            _out(this, 'value', v ?? null);
            _fire(this, v === undefined ? 'not_found' : 'done');
        });
    };
    LG.registerNodeType('IFC/Data/Get Property', GetProperty);

    const MATCH = ['equals', 'contains'];
    function DataFind() {
        this.addInput('trigger', ACTION);
        this.addInput('value', 'string');
        this.addOutput('done', EVENT);
        this.addOutput('guids', 'array');
        this.addOutput('count', 'number');
        this.addProperty('category', '', 'string');
        this.addProperty('attribute', '', 'string');
        this.addProperty('value', '', 'string');
        this.addProperty('match', 'equals', 'string');
        this.addWidget('text',  'category',  '', v => { this.properties.category = v; },  { property: 'category' });
        this.addWidget('text',  'attribute', '', v => { this.properties.attribute = v; }, { property: 'attribute' });
        this.addWidget('text',  'value',     '', v => { this.properties.value = v; },     { property: 'value' });
        this.addWidget('combo', 'match', 'equals', v => { this.properties.match = v; },   { values: MATCH, property: 'match' });
        paint(this, C_GET);
        this.size = [250, 190];
    }
    DataFind.title = 'Data Find';
    DataFind.desc  = 'Finds the IFC elements of a class and/or with an attribute or property value; returns their GlobalIds. ' + CONTEXTS;
    DataFind.error_output = true;
    DataFind.portHelp = {
        inputs: {
            trigger: 'event — runs the search (large models: a few seconds when a property set is filtered)',
            value:   'string — value to look for; if connected it prevails on the widget',
        },
        outputs: {
            done:  'event — emitted when the search ends',
            guids: 'array of string — GlobalIds of the elements found (empty array if none)',
            count: 'number — elements found',
            error: 'error — when there is no IFC panel or the model cannot be read',
        },
        properties: {
            category:  'string — IFC class, e.g. "IFCWALL" (case-insensitive); empty = all the classes with geometry',
            attribute: 'string — "Name", "ObjectType"… or "PsetName.Property" (e.g. "Pset_WallCommon.FireRating"); empty = no filter on values',
            value:     'string — value to compare; empty = the attribute just has to exist and not be empty',
            match:     '"equals" (numbers compared as numbers, text ignoring case) or "contains" (text contains, ignoring case)',
        },
    };
    DataFind.prototype.onAction = function () {
        const params = {
            category:  String(this.properties.category ?? ''),
            attribute: String(this.properties.attribute ?? ''),
            value:     _strIn(this, 'value', 'value'),
            match:     MATCH.includes(this.properties.match) ? this.properties.match : 'equals',
        };
        _run(this, async (api, current) => {
            const guids = await api.find(params);
            if (!current()) return;
            _out(this, 'guids', guids);
            _out(this, 'count', guids.length);
            _fire(this, 'done');
        });
    };
    LG.registerNodeType('IFC/Data/Find', DataFind);

    function DataCategories() {
        this.addInput('trigger', ACTION);
        this.addOutput('done', EVENT);
        this.addOutput('categories', 'array');
        paint(this, C_GET);
        this.size = [210, 60];
    }
    DataCategories.title = 'Data Categories';
    DataCategories.desc  = 'Lists the IFC classes that have geometry, with how many elements each. ' + CONTEXTS;
    DataCategories.error_output = true;
    DataCategories.portHelp = {
        inputs:  { trigger: 'event — reads the classes' },
        outputs: {
            done:       'event — emitted after categories is written',
            categories: 'array of {category, count} — e.g. [{category:"IFCBEAM", count:375}, …], sorted by class',
            error:      'error — when there is no IFC panel or the model cannot be read',
        },
    };
    DataCategories.prototype.onAction = function () {
        _run(this, async (api, current) => {
            const c = await api.categories();
            if (!current()) return;
            _out(this, 'categories', c);
            _fire(this, 'done');
        });
    };
    LG.registerNodeType('IFC/Data/Categories', DataCategories);

    function DataSpatialTree() {
        this.addInput('trigger', ACTION);
        this.addOutput('done', EVENT);
        this.addOutput('tree', 'object');
        paint(this, C_GET);
        this.size = [210, 60];
    }
    DataSpatialTree.title = 'Data Spatial Tree';
    DataSpatialTree.desc  = 'Reads the spatial structure (project → site → building → storeys → elements) as a tree, e.g. for an ECharts tree. ' + CONTEXTS;
    DataSpatialTree.error_output = true;
    DataSpatialTree.portHelp = {
        inputs:  { trigger: 'event — reads the tree (large models: a few seconds)' },
        outputs: {
            done:  'event — emitted after tree is written',
            tree:  'object — {name, category, localId, guid, children:[…]}; nodes without localId group the elements of one class. With several models the root is {name:"IFC", children:[one tree per model]}',
            error: 'error — when there is no IFC panel or the model cannot be read',
        },
    };
    DataSpatialTree.prototype.onAction = function () {
        _run(this, async (api, current) => {
            const tree = await api.spatialTree();
            if (!current()) return;
            _out(this, 'tree', tree);
            _fire(this, 'done');
        });
    };
    LG.registerNodeType('IFC/Data/Spatial Tree', DataSpatialTree);

    // ═════════════════════════════════════════════════════════════════════════
    // Visibility
    // ═════════════════════════════════════════════════════════════════════════

    const GUIDS_HELP = 'array of string — IFC GlobalIds (e.g. from Data Find; a single guid → Params/Array/Maker); empty or not an array → nothing happens';

    function makeGuidsAction({ type, title, desc, doneHelp, run, extra }) {
        function N() {
            this.addInput('trigger', ACTION);
            this.addInput('guids', 'array');
            this.addOutput('done', EVENT);
            extra?.init?.call(this);
            paint(this, C_SET);
            this.size = extra?.size ?? [200, 70];
        }
        N.title = title;
        N.desc  = desc + ' ' + CONTEXTS;
        N.error_output = true;
        N.portHelp = {
            inputs:  { trigger: 'event — applies the change', guids: GUIDS_HELP, ...(extra?.inputs || {}) },
            outputs: { done: doneHelp, error: 'error — when there is no IFC panel or the model cannot be changed' },
            ...(extra?.properties ? { properties: extra.properties } : {}),
        };
        N.prototype.onAction = function () {
            const guids = _guids(this);
            _run(this, async (api, current) => { await run.call(this, api, guids); if (current()) _fire(this, 'done'); });
        };
        LG.registerNodeType(type, N);
    }

    makeGuidsAction({
        type: 'IFC/Visibility/Isolate', title: 'Visibility Isolate',
        desc: 'Shows only the given elements and hides everything else.',
        doneHelp: 'event — emitted after the change; Show All brings everything back',
        run: (api, guids) => api.isolate(guids),
    });
    makeGuidsAction({
        type: 'IFC/Visibility/Hide', title: 'Visibility Hide',
        desc: 'Hides the given elements.',
        doneHelp: 'event — emitted after the elements are hidden',
        run: (api, guids) => api.setVisible(guids, false),
    });
    makeGuidsAction({
        type: 'IFC/Visibility/Show', title: 'Visibility Show',
        desc: 'Shows the given elements again.',
        doneHelp: 'event — emitted after the elements are shown',
        run: (api, guids) => api.setVisible(guids, true),
    });
    makeGuidsAction({
        type: 'IFC/Visibility/Color', title: 'Visibility Color',
        desc: 'Colors the given elements (e.g. one color per value of a property). The color stays until Reset Colors.',
        doneHelp: 'event — emitted after the elements are colored',
        run(api, guids) {
            const c = _strIn(this, 'color', 'color').trim();
            const hex = /^#?[0-9a-f]{6}$/i.test(c) ? (c.startsWith('#') ? c : '#' + c) : null;
            if (!hex) throw new Error(`color "${c}" is not a #rrggbb color`);
            return api.color(guids, hex);
        },
        extra: {
            init() {
                this.addInput('color', 'string');
                this.addProperty('color', '#f97316', 'string');
                this.addWidget('text', 'color', '#f97316', v => { this.properties.color = v; }, { property: 'color' });
            },
            size: [220, 100],
            inputs: { color: 'string — "#rrggbb"; if connected it prevails on the widget' },
            properties: { color: 'string — "#rrggbb" used when the color input is not connected' },
        },
    });

    function makeSimpleAction({ type, title, desc, doneHelp, run, color = C_SET, init, size, properties }) {
        function N() {
            this.addInput('trigger', ACTION);
            this.addOutput('done', EVENT);
            init?.call(this);
            paint(this, color);
            this.size = size ?? [190, 50];
        }
        N.title = title;
        N.desc  = desc + ' ' + CONTEXTS;
        N.error_output = true;
        N.portHelp = {
            inputs:  { trigger: 'event — runs the command' },
            outputs: { done: doneHelp, error: 'error — when there is no IFC panel or the command fails' },
            ...(properties ? { properties } : {}),
        };
        N.prototype.onAction = function () {
            _run(this, async (api, current) => { await run.call(this, api); if (current()) _fire(this, 'done'); });
        };
        LG.registerNodeType(type, N);
        return N;
    }

    makeSimpleAction({
        type: 'IFC/Visibility/Show All', title: 'Visibility Show All',
        desc: 'Shows every element again (after Isolate, Hide, categories, tree eyes).',
        doneHelp: 'event — emitted when everything is visible',
        run: api => api.showAll(),
    });
    makeSimpleAction({
        type: 'IFC/Visibility/Reset Colors', title: 'Visibility Reset Colors',
        desc: 'Removes the colors given by Visibility Color (the selection stays highlighted).',
        doneHelp: 'event — emitted after the colors are removed',
        run: api => api.resetColors(),
    });
    makeSimpleAction({
        type: 'IFC/Visibility/Category Visible', title: 'Visibility Category Visible',
        desc: 'Shows or hides all the elements of an IFC class, like the Categories window.',
        doneHelp: 'event — emitted after the change',
        init() {
            this.addProperty('category', 'IFCWALL', 'string');
            this.addProperty('visible', false, 'boolean');
            this.addWidget('text', 'category', 'IFCWALL', v => { this.properties.category = v; }, { property: 'category' });
            this.addWidget('toggle', 'visible', false, v => { this.properties.visible = v; }, { property: 'visible' });
        },
        size: [230, 100],
        properties: {
            category: 'string — IFC class as in the Categories window, e.g. "IFCWALL" (case-insensitive)',
            visible:  'boolean — ON shows, OFF hides',
        },
        run(api) {
            const cat = String(this.properties.category ?? '').trim();
            if (!cat) throw new Error('category is empty');
            return api.setCategoryVisible(cat, !!this.properties.visible);
        },
    });

    // ═════════════════════════════════════════════════════════════════════════
    // Camera
    // ═════════════════════════════════════════════════════════════════════════

    makeSimpleAction({
        type: 'IFC/Camera/Fit All', title: 'Camera Fit All',
        desc: 'Frames all the loaded models, like the "Fit all" button.',
        doneHelp: 'event — emitted when the framing starts (the camera moves smoothly)',
        run: api => api.fitAll(),
    });

    function FitItems() {
        this.addInput('trigger', ACTION);
        this.addInput('guids', 'array');
        this.addOutput('done', EVENT);
        this.addOutput('not_found', EVENT);
        paint(this, C_SET);
        this.size = [200, 70];
    }
    FitItems.title = 'Camera Fit Items';
    FitItems.desc  = 'Frames the given elements. ' + CONTEXTS;
    FitItems.error_output = true;
    FitItems.portHelp = {
        inputs:  { trigger: 'event — frames the elements', guids: GUIDS_HELP },
        outputs: {
            done:      'event — emitted when the camera has arrived',
            not_found: 'event — none of the GlobalIds is in the loaded models',
            error:     'error — when there is no IFC panel',
        },
    };
    FitItems.prototype.onAction = function () {
        const guids = _guids(this);
        _run(this, async (api, current) => {
            const ok = guids.length ? await api.fitItems(guids) : false;
            if (current()) _fire(this, ok ? 'done' : 'not_found');
        });
    };
    LG.registerNodeType('IFC/Camera/Fit Items', FitItems);

    function GetView() {
        this.addInput('trigger', ACTION);
        this.addOutput('done', EVENT);
        this.addOutput('position', 'object');
        this.addOutput('target', 'object');
        paint(this, C_GET);
        this.size = [200, 80];
    }
    GetView.title = 'Camera Get View';
    GetView.desc  = 'Reads the camera position and the point it looks at. ' + CONTEXTS;
    GetView.error_output = true;
    GetView.portHelp = {
        inputs:  { trigger: 'event — reads the view' },
        outputs: {
            done:     'event — emitted after the outputs are written',
            position: '{x,y,z} in metres — camera position',
            target:   '{x,y,z} in metres — orbit point the camera looks at',
            error:    'error — when there is no IFC panel',
        },
    };
    GetView.prototype.onAction = function () {
        _run(this, async (api) => {
            const v = api.getView();
            _out(this, 'position', v.position);
            _out(this, 'target', v.target);
            _fire(this, 'done');
        });
    };
    LG.registerNodeType('IFC/Camera/Get View', GetView);

    function SetView() {
        this.addInput('trigger', ACTION);
        this.addInput('position', 'object');
        this.addInput('target', 'object');
        this.addOutput('done', EVENT);
        this.addProperty('animate', true, 'boolean');
        this.addWidget('toggle', 'animate', true, v => { this.properties.animate = v; }, { property: 'animate' });
        paint(this, C_SET);
        this.size = [210, 100];
    }
    SetView.title = 'Camera Set View';
    SetView.desc  = 'Moves the camera to a position, looking at a target point (e.g. a view read with Get View). ' + CONTEXTS;
    SetView.error_output = true;
    SetView.portHelp = {
        inputs: {
            trigger:  'event — moves the camera',
            position: '{x,y,z} or [x,y,z], in metres — camera position',
            target:   '{x,y,z} or [x,y,z], in metres — point to look at (becomes the orbit point)',
        },
        outputs: {
            done:  'event — emitted when the camera has arrived (at the end of the animation)',
            error: 'error — when there is no IFC panel or position/target are not points',
        },
        properties: { animate: 'boolean — ON: smooth movement; OFF: immediate' },
    };
    SetView.prototype.onAction = function () {
        const p = _vec(_in(this, 'position')), t = _vec(_in(this, 'target'));
        _run(this, async (api, current) => {
            if (!p || !t) throw new Error('position and target must be {x,y,z} or [x,y,z]');
            await api.setView(p, t, !!this.properties.animate);
            if (current()) _fire(this, 'done');
        });
    };
    LG.registerNodeType('IFC/Camera/Set View', SetView);

    // ═════════════════════════════════════════════════════════════════════════
    // Section / Measure
    // ═════════════════════════════════════════════════════════════════════════

    const C_DELETE = ['#3a1a1a', '#7f1d1d'];

    function SectionAddPlane() {
        this.addInput('trigger', ACTION);
        this.addInput('point', 'object');
        this.addInput('normal', 'object');
        this.addOutput('done', EVENT);
        paint(this, C_SET);
        this.size = [210, 80];
    }
    SectionAddPlane.title = 'Section Add Plane';
    SectionAddPlane.desc  = 'Adds a section plane through a point; the part the normal points to stays visible (e.g. normal {0,-1,0} at storey height + 1.2 m = plan cut). ' + CONTEXTS;
    SectionAddPlane.error_output = true;
    SectionAddPlane.portHelp = {
        inputs: {
            trigger: 'event — adds the plane',
            point:   '{x,y,z} or [x,y,z], in metres — a point of the plane',
            normal:  '{x,y,z} or [x,y,z] — direction of the part that STAYS visible (not necessarily unit length)',
        },
        outputs: {
            done:  'event — emitted after the plane is added (it can be dragged with its arrows; Section Clear or the toolbar button removes it)',
            error: 'error — when there is no IFC panel or point/normal are not vectors',
        },
    };
    SectionAddPlane.prototype.onAction = function () {
        const p = _vec(_in(this, 'point')), n = _vec(_in(this, 'normal'));
        _run(this, async (api, current) => {
            if (!p || !n) throw new Error('point and normal must be {x,y,z} or [x,y,z]');
            api.addPlane(p, n);
            if (current()) _fire(this, 'done');
        });
    };
    LG.registerNodeType('IFC/Section/Add Plane', SectionAddPlane);

    makeSimpleAction({
        type: 'IFC/Section/Clear', title: 'Section Clear',
        desc: 'Removes all the section planes (also those made with the Section tool).',
        doneHelp: 'event — emitted after the planes are removed',
        color: C_DELETE,
        run: api => api.clearPlanes(),
    });

    function MeasureGetAll() {
        this.addInput('trigger', ACTION);
        this.addOutput('done', EVENT);
        this.addOutput('lengths', 'array');
        this.addOutput('areas', 'array');
        this.addOutput('angles', 'array');
        this.addOutput('volumes', 'array');
        paint(this, C_GET);
        this.size = [200, 120];
    }
    MeasureGetAll.title = 'Measure Get All';
    MeasureGetAll.desc  = 'Reads the measurements made in the panel with the Length, Area, Angle and Volume tools (also the saved ones). ' + CONTEXTS;
    MeasureGetAll.error_output = true;
    MeasureGetAll.portHelp = {
        inputs:  { trigger: 'event — reads the measurements' },
        outputs: {
            done:    'event — emitted after the outputs are written',
            lengths: 'array of number, in metres — one per length measurement, in creation order (empty if none)',
            areas:   'array of number, in square metres — one per area measurement (empty if none)',
            angles:  'array of number, in degrees — one per angle measurement (empty if none)',
            volumes: 'array of number, in cubic metres — one per volume measurement, i.e. the total volume of the elements in it (empty if none)',
            error:   'error — when there is no IFC panel',
        },
    };
    MeasureGetAll.prototype.onAction = function () {
        _run(this, async (api, current) => {
            const m = await api.getMeasures();
            if (!current()) return;
            _out(this, 'lengths', m.lengths);
            _out(this, 'areas', m.areas);
            _out(this, 'angles', m.angles);
            _out(this, 'volumes', m.volumes);
            _fire(this, 'done');
        });
    };
    LG.registerNodeType('IFC/Measure/Get All', MeasureGetAll);

    // ═════════════════════════════════════════════════════════════════════════
    // X-ray, color by value, saved views
    // ═════════════════════════════════════════════════════════════════════════

    makeSimpleAction({
        type: 'IFC/Visibility/X-Ray', title: 'Visibility X-Ray',
        desc: 'Turns the X-ray on or off: everything becomes transparent except the selection and the colored elements, like the toolbar button.',
        doneHelp: 'event — emitted after the change',
        init() {
            this.addInput('on', 'boolean');
            this.addProperty('on', true, 'boolean');
            this.addWidget('toggle', 'on', true, v => { this.properties.on = v; }, { property: 'on' });
        },
        size: [200, 80],
        properties: { on: 'boolean — ON = X-ray, OFF = normal; the on input, if connected, prevails' },
        run(api) {
            const v = _linked(this, 'on') ? _in(this, 'on') : this.properties.on;
            api.setXray(!!v);
        },
    }).portHelp.inputs.on = 'boolean — ON = X-ray, OFF = normal; if connected it prevails on the widget';

    function ColorByValue() {
        this.addInput('trigger', ACTION);
        this.addOutput('done', EVENT);
        this.addOutput('legend', 'array');
        this.addProperty('category', '', 'string');
        this.addProperty('attribute', 'ObjectType', 'string');
        this.addWidget('text', 'category', '', v => { this.properties.category = v; }, { property: 'category' });
        this.addWidget('text', 'attribute', 'ObjectType', v => { this.properties.attribute = v; }, { property: 'attribute' });
        paint(this, C_SET);
        this.size = [250, 110];
    }
    ColorByValue.title = 'Visibility Color By Value';
    ColorByValue.desc  = 'Gives one color to each value of an attribute or property (e.g. material, fire rating), like the "Color by value" window; replaces the previous colors. ' + CONTEXTS;
    ColorByValue.error_output = true;
    ColorByValue.portHelp = {
        inputs:  { trigger: 'event — colors the elements (large models: a few seconds with a property set)' },
        outputs: {
            done:   'event — emitted after the elements are colored',
            legend: 'array of {value, color, count} — sorted by value (numbers as numbers); after 24 values the rest is one grey group with value null; elements without a value are not colored',
            error:  'error — when there is no IFC panel or attribute is empty',
        },
        properties: {
            category:  'string — IFC class, e.g. "IFCWALL"; empty = all the classes with geometry',
            attribute: 'string — "ObjectType", "Name"… or "PsetName.Property" (keys of Data Get Properties)',
        },
    };
    ColorByValue.prototype.onAction = function () {
        const category = String(this.properties.category ?? ''), attribute = String(this.properties.attribute ?? '');
        _run(this, async (api, current) => {
            const legend = await api.colorByValue(category, attribute);
            if (!current()) return;
            _out(this, 'legend', legend.map(g => ({ value: g.value, color: g.color, count: g.count })));
            _fire(this, 'done');
        });
    };
    LG.registerNodeType('IFC/Visibility/Color By Value', ColorByValue);

    function SavedViews() {
        this.addInput('trigger', ACTION);
        this.addOutput('done', EVENT);
        this.addOutput('views', 'array');
        this.addOutput('names', 'array');
        paint(this, C_GET);
        this.size = [200, 80];
    }
    SavedViews.title = 'Camera Saved Views';
    SavedViews.desc  = 'Lists the views of the "Views" window (saved in the model spec, plus those added and not saved yet). ' + CONTEXTS;
    SavedViews.error_output = true;
    SavedViews.portHelp = {
        inputs:  { trigger: 'event — reads the list' },
        outputs: {
            done:  'event — emitted after the outputs are written',
            views: 'array of {name, plan} — plan = name of the floor plan the view was taken in, or null for the 3D view',
            names: 'array of string — just the names, e.g. for a menu',
            error: 'error — when there is no IFC panel',
        },
    };
    SavedViews.prototype.onAction = function () {
        _run(this, async (api) => {
            const v = api.listViews();
            _out(this, 'views', v);
            _out(this, 'names', v.map(x => x.name));
            _fire(this, 'done');
        });
    };
    LG.registerNodeType('IFC/Camera/Saved Views', SavedViews);

    function GoToView() {
        this.addInput('trigger', ACTION);
        this.addInput('name', 'string');
        this.addOutput('done', EVENT);
        this.addOutput('not_found', EVENT);
        this.addProperty('name', '', 'string');
        this.addWidget('text', 'name', '', v => { this.properties.name = v; }, { property: 'name' });
        paint(this, C_SET);
        this.size = [210, 90];
    }
    GoToView.title = 'Camera Go To View';
    GoToView.desc  = 'Moves the camera to a view of the "Views" window by name (opening its floor plan, if it has one). ' + CONTEXTS;
    GoToView.error_output = true;
    GoToView.portHelp = {
        inputs: {
            trigger: 'event — goes to the view',
            name:    'string — view name, exactly as in the Views window; if connected it prevails on the widget',
        },
        outputs: {
            done:      'event — emitted when the camera has arrived',
            not_found: 'event — no view with that name',
            error:     'error — when there is no IFC panel',
        },
        properties: { name: 'string — view name used when the name input is not connected' },
    };
    GoToView.prototype.onAction = function () {
        const name = _strIn(this, 'name', 'name').trim();
        _run(this, async (api, current) => {
            const ok = name ? await api.goToView(name) : false;
            if (current()) _fire(this, ok ? 'done' : 'not_found');
        });
    };
    LG.registerNodeType('IFC/Camera/Go To View', GoToView);

    makeSimpleAction({
        type: 'IFC/Visibility/Outlines', title: 'Visibility Outlines',
        desc: 'Turns the outlines of the elements on or off (drawing-like rendering), like the toolbar button.',
        doneHelp: 'event — emitted after the change',
        init() {
            this.addInput('on', 'boolean');
            this.addProperty('on', true, 'boolean');
            this.addWidget('toggle', 'on', true, v => { this.properties.on = v; }, { property: 'on' });
        },
        size: [200, 80],
        properties: { on: 'boolean — ON = outlines, OFF = normal rendering; the on input, if connected, prevails' },
        run(api) { api.setOutlines(!!(_linked(this, 'on') ? _in(this, 'on') : this.properties.on)); },
    }).portHelp.inputs.on = 'boolean — ON = outlines; if connected it prevails on the widget';

    const PROJECTIONS = ['perspective', 'orthographic'];
    makeSimpleAction({
        type: 'IFC/Camera/Projection', title: 'Camera Projection',
        desc: 'Switches the 3D view between perspective and orthographic projection (not while a floor plan is open: plans are always orthographic).',
        doneHelp: 'event — emitted after the change',
        init() {
            this.addProperty('projection', 'orthographic', 'string');
            this.addWidget('combo', 'projection', 'orthographic', v => { this.properties.projection = v; }, { values: PROJECTIONS, property: 'projection' });
        },
        size: [230, 70],
        properties: { projection: '"perspective" or "orthographic"' },
        run(api) { return api.setOrtho(this.properties.projection === 'orthographic'); },
    });

    makeSimpleAction({
        type: 'IFC/Measure/Clear', title: 'Measure Clear',
        desc: 'Removes all the length, area, angle and volume measurements.',
        doneHelp: 'event — emitted after the measurements are removed',
        color: C_DELETE,
        run: api => api.clearMeasures(),
    });
}
