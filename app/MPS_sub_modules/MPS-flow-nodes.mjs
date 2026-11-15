// app/MPS_sub_modules/MPS-flow-nodes.mjs
// Nodi LiteGraph context-aware per pannelli MPS (Google Maps).
// Leggono/scrivono lo stato del pannello via graph._appContext (vedi
// MPS-flow-runner.mjs) — mai import diretto di model_MPS.mjs (isolamento
// per pannello, stesso pattern di TJS-flow-nodes.mjs / OSD-flow-nodes.mjs).
//
// Due famiglie:
//   MPS/Events/*  — sorgenti (onStart → _pending → onExecute, come
//                   OSD/Events/*): si agganciano da sole ai listener reali
//                   della mappa, producono trigger+dati.
//   MPS/Camera/*, MPS/Marker/*, MPS/Style/*, MPS/Geo/* — azioni (onAction, non
//                   onExecute): non emettono un valore ad ogni step del
//                   grafo, agiscono solo quando ricevono un trigger EVENT —
//                   tipicamente da MPS/Events/*, da un App Bus Receiver
//                   (AppBus-flow-nodes.mjs).

export function registerMPSFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[MPS-flow-nodes] LiteGraph not available'); return; }
    if (window._MPS_FLOW_NODES_REGISTERED) return;
    window._MPS_FLOW_NODES_REGISTERED = true;

    const COLOR   = '#04303a';
    const BGCOLOR = '#0a5a68';
    const EVCOLOR   = '#062a1a';
    const EVBGCOLOR = '#0a4a2e';

    // ─────────────────────────────────────────────────────────────────────────
    // MPS/Events — nodi reattivi (pattern onStart → _pending → onExecute),
    // stesso schema di OSD/Events/* (OSD-flow-nodes.mjs). Sono la sorgente che
    // alimenta un App Bus Emitter (AppBus-flow-nodes.mjs) — quello resta generico
    // e app-agnostico, questi sanno agganciarsi ai listener reali della mappa.
    // ─────────────────────────────────────────────────────────────────────────

    function MPSEventsOnViewSettled() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('view',    'object');
        this._pending = null;
        this._cleanup = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 80];
    }
    MPSEventsOnViewSettled.title = 'Events On View Settled';
    MPSEventsOnViewSettled.desc  = 'Fires at the end of a pan/zoom/animation (idle in 2D, gmp-steadystate/gmp-steadychange in 3D)';
    MPSEventsOnViewSettled.portHelp = {
        outputs: {
            trigger: 'Trigger (EVENT): emitted once every time the map stops after a pan/zoom/animation.',
            view:    'Current view object: { lat, lng, altitude?, tilt?, heading?, range?, zoom? } — same shape accepted as input by Camera FlyTo (the optional fields are present only on 3D maps).',
        },
    };
    MPSEventsOnViewSettled.prototype.onStart = function () {
        const ctx = this.graph?._appContext;
        const map = ctx?.map;
        if (!map) return;
        this._pending = null;
        const g = this.graph, self = this;
        const fire = () => {
            self._pending = ctx.readView?.() ?? null;
            try { g.runStep(1); } catch {}
        };

        if (ctx.mod_spec?.type === '2D') {
            // Google Maps 2D: API a eventi propria (google.maps.event), non
            // DOM — l'handle di addListener serve per la rimozione pulita.
            const handle = google.maps.event.addListener(map, 'idle', fire);
            this._cleanup = () => { try { google.maps.event.removeListener(handle); } catch {} };
        } else {
            // 3D: CustomElement DOM — nome evento non uniforme nella doc
            // ufficiale, registro entrambi (stesso pattern di model_MPS.mjs).
            const onSteady = ev => { if (ev?.isSteady) fire(); };
            map.addEventListener('gmp-steadystate', onSteady);
            map.addEventListener('gmp-steadychange', onSteady);
            this._cleanup = () => {
                try { map.removeEventListener('gmp-steadystate', onSteady); } catch {}
                try { map.removeEventListener('gmp-steadychange', onSteady); } catch {}
            };
        }
        ctx.signal?.addEventListener('abort', () => this._cleanup?.(), { once: true });
    };
    MPSEventsOnViewSettled.prototype.onStop = function () {
        this._cleanup?.();
        this._cleanup = null;
    };
    MPSEventsOnViewSettled.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(1, p);
        this.triggerSlot(0);
    };
    LG.registerNodeType('MPS/Events/OnViewSettled', MPSEventsOnViewSettled);


    function MPSEventsOnMarkerClick() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('marker',  'object');  // { lat, lng, altitude, nome, id_mrk, colore }
        this._pending = null;
        this.color   = EVCOLOR;
        this.bgcolor = EVBGCOLOR;
        this.size    = [210, 80];
    }
    MPSEventsOnMarkerClick.title = 'Events On Marker Click';
    MPSEventsOnMarkerClick.desc  = 'Fires when a marker is clicked: markers of the mod_spec (3D only) and markers created by Marker Add / Add List (2D and 3D)';
    MPSEventsOnMarkerClick.portHelp = {
        outputs: {
            trigger: 'Trigger (EVENT): emitted once for every real user click on a marker.',
            marker:  'Clicked marker object. mod_spec marker: { lat, lng, altitude, nome, id_mrk, colore }. Flow marker: { id, id_mrk, name, nome, group, lat, lng, altitude, source: "flow", data } (data = the object given to Marker Add).',
        },
    };
    MPSEventsOnMarkerClick.prototype.onStart = function () {
        // Rimuove un'eventuale sottoscrizione precedente prima di ricrearla —
        // onStart può essere richiamato più volte quando il contesto del grafo
        // cambia (model_FLE.mjs::_injectTestContext), stesso motivo di
        // Receiver.onStart (App Bus) (AppBus-flow-nodes.mjs).
        this._cleanup?.();
        this._cleanup = null;
        const ctx = this.graph?._appContext;
        const bus = ctx?.localEvents;
        if (!bus || !ctx?.signal) return;
        this._pending = null;
        const g = this.graph, self = this;
        const handler = ev => {
            self._pending = ev.detail;
            try { g.runStep(1); } catch {}
        };
        bus.addEventListener('markerClick', handler);
        this._cleanup = () => bus.removeEventListener('markerClick', handler);
        ctx.signal.addEventListener('abort', () => this._cleanup?.(), { once: true });
    };
    MPSEventsOnMarkerClick.prototype.onStop = function () {
        this._cleanup?.();
        this._cleanup = null;
    };
    MPSEventsOnMarkerClick.prototype.onExecute = function () {
        if (this._pending == null) return;
        const p = this._pending;
        this._pending = null;
        this.setOutputData(1, p);
        this.triggerSlot(0);
    };
    LG.registerNodeType('MPS/Events/OnMarkerClick', MPSEventsOnMarkerClick);


    // ─────────────────────────────────────────────────────────────────────────
    // MPS/Camera/GetPosition
    // ─────────────────────────────────────────────────────────────────────────
    function MPSCameraGetPosition() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('lat',  'number');
        this.addOutput('lng',  'number');
        this.addOutput('view', 'object');
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [200, 90];
    }
    MPSCameraGetPosition.title = 'Camera Get Position';
    MPSCameraGetPosition.desc  = 'Returns the current map view (center + zoom/tilt/heading/range)';
    MPSCameraGetPosition.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): reads the current view at this moment.',
        },
        outputs: {
            lat:  'Latitude of the map center (number) — null if the view is not available.',
            lng:  'Longitude of the map center (number) — null if the view is not available.',
            view: 'Full view object: { lat, lng, altitude?, tilt?, heading?, range?, zoom? } — same shape accepted by Camera FlyTo.',
        },
    };
    MPSCameraGetPosition.prototype.onAction = function () {
        const ctx  = this.graph?._appContext;
        const view = ctx?.readView?.();
        if (!view) return;
        this.setOutputData(0, view.lat ?? null);
        this.setOutputData(1, view.lng ?? null);
        this.setOutputData(2, view);
    };
    LG.registerNodeType('MPS/Camera/GetPosition', MPSCameraGetPosition);


    // ─────────────────────────────────────────────────────────────────────────
    // MPS/Camera/FlyTo
    // ─────────────────────────────────────────────────────────────────────────
    // Opzioni (2026-10-20). Gli ingressi numerici compaiono a richiesta (tasto destro → Inputs).
    // Quote sul livello del mare e range sempre passato: vedi _applyView in model_MPS.mjs.
    const FLY_OPTIONAL_INPUTS = [['heading', 'number'], ['tilt', 'number'], ['range', 'number'], ['altitude', 'number'], ['duration', 'number']];
    const FLY_MIN_KEEP_RANGE  = 200;   // m: "keep" non lascia mai la camera dentro gli edifici
    function MPSCameraFlyTo() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('view',    'object');  // stessa forma di Camera Get Position / mps:view:changed
        this.addProperty('headingMode',  'auto', 'string');
        this.addProperty('tiltMode',     'auto', 'string');
        this.addProperty('rangeMode',    'auto', 'string');
        this.addProperty('altitudeMode', 'auto', 'string');
        this.addProperty('motion',       'fly',  'string');
        this.addProperty('duration',     1200,   'number');
        this.addWidget('combo', 'headingMode', 'auto', v => { this.properties.headingMode = v; }, { values: ['auto', 'north', 'keep', 'input'], property: 'headingMode' });
        this.addWidget('combo', 'tiltMode',    'auto', v => { this.properties.tiltMode = v; },    { values: ['auto', 'keep', 'input'], property: 'tiltMode' });
        this.addWidget('combo', 'rangeMode',   'auto', v => { this.properties.rangeMode = v; },   { values: ['auto', 'keep', 'input'], property: 'rangeMode' });
        this.addWidget('combo', 'altitudeMode','auto', v => { this.properties.altitudeMode = v; },{ values: ['auto', 'current', 'input'], property: 'altitudeMode' });
        this.addWidget('combo', 'motion',      'fly',  v => { this.properties.motion = v; },      { values: ['fly', 'glide', 'jump'], property: 'motion' });
        this.addWidget('number', 'duration',   1200,   v => { this.properties.duration = Math.max(0, Math.round(Number(v) || 0)); },
            { min: 0, max: 30000, step: 1000, precision: 0, property: 'duration' });
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [240, 210];
    }
    MPSCameraFlyTo.title = 'Camera FlyTo';
    MPSCameraFlyTo.desc  = 'Frames the place received as input (object { lat, lng, altitude?, tilt?, heading?, range?, zoom? }): on 3D maps the camera looks at that point from "range" metres away. altitude is above SEA LEVEL: give the ground altitude of the place (a data column, or the Geo Elevation node before this one), otherwise the altitude of the point looked at now is used. The widgets choose arrival direction, tilt, distance, altitude and kind of movement';
    MPSCameraFlyTo.portHelp = {
        inputs: {
            trigger:  'Trigger (ACTION): starts moving the camera towards "view".',
            view:     'Target view object: { lat, lng, altitude?, tilt?, heading?, range?, zoom? } — "lat"/"lng" required (without them the node does nothing), the other optional fields apply only on 3D maps. altitude = metres above sea level of the looked-at point (ground altitude of the place).',
            heading:  'number — arrival direction in degrees (0 = looking north, 90 = east), used when headingMode = input. Optional: right click → Inputs',
            tilt:     'number — arrival tilt in degrees (0 = from above, 90 = horizontal), used when tiltMode = input. Optional: right click → Inputs',
            range:    'number — arrival distance in metres between camera and target, used when rangeMode = input. Optional: right click → Inputs',
            altitude: 'number — metres above sea level of the looked-at point, used when altitudeMode = input. Optional: right click → Inputs',
            duration: 'number — duration of the movement in ms; when connected it replaces the duration widget. Optional: right click → Inputs',
        },
        properties: {
            headingMode:  'auto = heading of "view", otherwise north (original) · north = always looking north · keep = same direction as the current camera · input = from the "heading" input (a preferred view of a building)',
            tiltMode:     'auto = tilt of "view", otherwise 60° (original) · keep = current tilt · input = from the "tilt" input',
            rangeMode:    'auto = range of "view", otherwise mod_spec.range, otherwise 300 m · keep = current distance, at least 200 m · input = from the "range" input',
            altitudeMode: 'auto = altitude of "view" (above sea level), otherwise that of the point looked at now · current = always that of the point looked at now (places in the same flat area) · input = from the "altitude" input',
            motion:       'fly = Google flyCameraTo, rises and descends along an arc (original) · glide = straight slide at the same height, smooth start and stop (a click on the map stops it) · jump = immediate',
            duration:     'duration of the movement in ms (default 1200, original); 0 = immediate',
        },
    };
    MPSCameraFlyTo.prototype.onGetInputs = function () {
        return FLY_OPTIONAL_INPUTS.filter(([n]) => this.findInputSlot(n) === -1).map(([n, t]) => [n, t, { removable: true }]);
    };
    MPSCameraFlyTo.prototype.onConfigure = function () {
        for (const s of this.inputs ?? []) if (FLY_OPTIONAL_INPUTS.some(([n]) => n === s.name)) s.removable = true;
    };
    /** Ingresso opzionale numerico: valore finito, altrimenti null. */
    MPSCameraFlyTo.prototype._num = function (name) {
        const i = this.findInputSlot(name);
        if (i === -1) return null;
        const v = this.getInputData(i);
        if (v == null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };
    MPSCameraFlyTo.prototype.onAction = function () {
        const ctx  = this.graph?._appContext;
        const view = this.getInputData(1);
        if (!view || view.lat == null || view.lng == null) return;
        const p = this.properties;
        const out = { ...view };
        const needCur = p.headingMode === 'keep' || p.tiltMode === 'keep' || p.rangeMode === 'keep';
        const cur = needCur ? ctx?.readView?.() : null;
        // 'auto' lascia il campo di "view" (o il default originale in _applyView)
        if (p.headingMode === 'north') out.heading = 0;
        else if (p.headingMode === 'keep' && cur?.heading != null) out.heading = cur.heading;
        else if (p.headingMode === 'input') { const v = this._num('heading'); if (v != null) out.heading = v; }
        if (p.tiltMode === 'keep' && cur?.tilt != null) out.tilt = cur.tilt;
        else if (p.tiltMode === 'input') { const v = this._num('tilt'); if (v != null) out.tilt = v; }
        if (p.rangeMode === 'keep' && cur?.range != null) out.range = Math.max(FLY_MIN_KEEP_RANGE, cur.range);
        else if (p.rangeMode === 'input') { const v = this._num('range'); if (v != null) out.range = Math.max(0, v); }
        // 'current': senza quota _applyView usa quella del punto guardato ora
        if (p.altitudeMode === 'current') delete out.altitude;
        else if (p.altitudeMode === 'input') { const v = this._num('altitude'); if (v != null) out.altitude = v; }
        const duration = this._num('duration') ?? p.duration;
        ctx?.applyView?.(out, { motion: p.motion, duration });
    };
    LG.registerNodeType('MPS/Camera/FlyTo', MPSCameraFlyTo);


    // ─────────────────────────────────────────────────────────────────────────
    // MPS/Marker/List
    // ─────────────────────────────────────────────────────────────────────────
    function MPSMarkerList() {
        this.addInput('trigger',  LG.ACTION);
        this.addOutput('markers', 'array');
        this.addOutput('count',   'number');
        this.addProperty('source', 'config', 'string');
        this.addProperty('group',  '',       'string');
        this.addWidget('combo', 'source', 'config', v => { this.properties.source = v; }, { values: ['config', 'flow'], property: 'source' });
        this.addWidget('text',  'group',  '',       v => { this.properties.group = String(v ?? '').trim(); }, { property: 'group' });
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [210, 110];
    }
    MPSMarkerList.title = 'Marker List';
    MPSMarkerList.desc  = 'Lists the markers: those of the mod_spec (source = config, data only) or those created by Marker Add / Add List (source = flow)';
    MPSMarkerList.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): reads the list of markers at this moment.',
        },
        outputs: {
            markers: 'Array of marker objects. config: [{ lat, lng, altitude, nome, id_mrk, colore }, ...] (as in mod_spec.coordinates). flow: [{ id, id_mrk, name, nome, group, lat, lng, altitude, source, data }, ...].',
            count:   'Number of markers in the array (integer).',
        },
        properties: {
            source: 'config = markers of mod_spec.coordinates · flow = markers created by the flow nodes',
            group:  'only with source = flow: markers of this group; empty = all',
        },
    };
    MPSMarkerList.prototype.onAction = function () {
        const ctx     = this.graph?._appContext;
        const markers = this.properties.source === 'flow'
            ? (ctx?.listFlowMarkers?.(this.properties.group || null) ?? [])
            : (ctx?.listMarkers?.() ?? []);
        this.setOutputData(0, markers);
        this.setOutputData(1, markers.length);
    };
    LG.registerNodeType('MPS/Marker/List', MPSMarkerList);


    // ─────────────────────────────────────────────────────────────────────────
    // MPS/Marker/GoTo
    // ─────────────────────────────────────────────────────────────────────────
    function MPSMarkerGoTo() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id_mrk',  'string');
        this.addOutput('done',   LG.EVENT);
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [190, 70];
    }
    MPSMarkerGoTo.title = 'Marker Go To';
    MPSMarkerGoTo.desc  = 'Same as clicking the marker with this id_mrk: emits selection:change (the camera movement depends on the selection:change receiver already present in MPS)';
    MPSMarkerGoTo.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): runs the action (same as a click on the marker).',
            id_mrk:  'Marker identifier (string, the marker\'s "id_mrk" field) on which to simulate the click.',
        },
        outputs: {
            done: 'Trigger (EVENT): emitted only if the marker with this id_mrk exists and was found — no trigger if id_mrk matches nothing.',
        },
    };
    MPSMarkerGoTo.prototype.onAction = function () {
        const ctx    = this.graph?._appContext;
        const id_mrk = this.getInputData(1);
        if (id_mrk == null || !ctx?.goToMarker) return;
        if (ctx.goToMarker(id_mrk)) this.triggerSlot(0);
    };
    LG.registerNodeType('MPS/Marker/GoTo', MPSMarkerGoTo);


    // ─────────────────────────────────────────────────────────────────────────
    // MPS/Marker/ViewTo
    // ─────────────────────────────────────────────────────────────────────────
    function MPSMarkerViewTo() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id_mrk',  'string');
        this.addOutput('done',   LG.EVENT);
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [190, 70];
    }
    MPSMarkerViewTo.title = 'Marker View To';
    MPSMarkerViewTo.desc  = 'Turns the camera towards the marker (heading) without moving its position — 3D maps only';
    MPSMarkerViewTo.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): runs the action.',
            id_mrk:  'Marker identifier (string, "id_mrk" field) to turn the camera towards.',
        },
        outputs: {
            done: 'Trigger (EVENT): emitted only if the marker exists and the camera was turned — no trigger on 2D maps or for a non-existent id_mrk.',
        },
    };
    MPSMarkerViewTo.prototype.onAction = function () {
        const ctx    = this.graph?._appContext;
        const id_mrk = this.getInputData(1);
        if (id_mrk == null || !ctx?.viewToMarker) return;
        if (ctx.viewToMarker(id_mrk)) this.triggerSlot(0);
    };
    LG.registerNodeType('MPS/Marker/ViewTo', MPSMarkerViewTo);


    // ─────────────────────────────────────────────────────────────────────────
    // MPS/Style/SetStyle
    // ─────────────────────────────────────────────────────────────────────────
    function MPSStyleSetStyle() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id_mrk',  'string');
        this.addInput('color',   'string');  // hex es. "#FBBC04"; vuoto = rimuove il colore custom
        this.addOutput('done',   LG.EVENT);
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [190, 85];
    }
    MPSStyleSetStyle.title = 'Set Style';
    MPSStyleSetStyle.desc  = 'Sets (or removes, if color is empty) the pin color of the marker with this id_mrk: mod_spec markers (3D only) or markers created by Marker Add (2D and 3D, id = their id). For more than the color use Marker Update';
    MPSStyleSetStyle.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): runs the action.',
            id_mrk:  'Marker identifier (string, "id_mrk" field) to apply the style to.',
            color:   'Pin color as a hexadecimal string (e.g. "#FBBC04") — an empty string removes the custom color and restores the default one.',
        },
        outputs: {
            done: 'Trigger (EVENT): emitted only if the marker exists and the style was applied successfully.',
        },
    };
    MPSStyleSetStyle.prototype.onAction = function () {
        const ctx    = this.graph?._appContext;
        const id_mrk = this.getInputData(1);
        const colore = this.getInputData(2);
        if (id_mrk == null || !ctx?.setMarkerStyle) return;
        if (ctx.setMarkerStyle(id_mrk, colore)) this.triggerSlot(0);
    };
    LG.registerNodeType('MPS/Style/SetStyle', MPSStyleSetStyle);


    // ─────────────────────────────────────────────────────────────────────────
    // MPS/Marker — segnaposto creati dal flow (2026-10-20), 2D e 3D.
    // Stato in model_MPS.mjs (state.flowMarkers, _addFlowMarker…); qui solo i nodi.
    // Colori per comportamento (module-fle-architettura.md §10).
    // ─────────────────────────────────────────────────────────────────────────
    const C_ABSTRACT = ['#14532d', '#166534'];   // Creazione astratta: lo stile
    const C_CREATE   = ['#064e3b', '#065f46'];   // Creazione intensa: segnaposto sulla mappa
    const C_SET      = ['#2a1a4a', '#4a1d96'];
    const C_DELETE   = ['#3a1a1a', '#7f1d1d'];
    const C_ANIM     = ['#3a1a5a', '#6d28d9'];
    const C_PAID     = ['#4a3010', '#a16207'];   // servizio esterno a pagamento (Elevation API)
    const paint = (node, [c, bg]) => { node.color = c; node.bgcolor = bg; };
    const _isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

    const MARKER_ID_HELP    = 'field of the data object used as marker id (default "id"); same id = the marker is replaced. Missing = automatic id';
    const MARKER_LABEL_HELP = 'field of the data object shown as label and tooltip (default "name", as in TML Item To Record)';
    const MARKER_CLICK_HELP = 'event = a click fires Events On Marker Click · select = also emits selection:change, like mod_spec markers (the map flies to the marker) · none = not clickable';
    const MARKER_DATA_HELP  = 'needs lat and lng (also lon, latitude/longitude; comma or point); altitude optional, metres above sea level; color, glyph, icon optional, they override the style for this marker; every other field is kept in "data"';

    /** Widget comuni ad Add e Add List. */
    function _markerAddWidgets(node) {
        node.addProperty('group',      'flow',  'string');
        node.addProperty('idField',    'id',    'string');
        node.addProperty('labelField', 'name',  'string');
        node.addProperty('onClick',    'event', 'string');
        node.addWidget('text',  'group',      'flow',  v => { node.properties.group = String(v ?? '').trim() || 'flow'; }, { property: 'group' });
        node.addWidget('text',  'idField',    'id',    v => { node.properties.idField = String(v ?? '').trim(); },          { property: 'idField' });
        node.addWidget('text',  'labelField', 'name',  v => { node.properties.labelField = String(v ?? '').trim(); },       { property: 'labelField' });
        node.addWidget('combo', 'onClick',    'event', v => { node.properties.onClick = v; }, { values: ['event', 'select', 'none'], property: 'onClick' });
    }
    function _markerOpts(node, style, index) {
        const p = node.properties;
        return { group: p.group || 'flow', idField: p.idField, labelField: p.labelField, onClick: p.onClick, style: _isObj(style) ? style : null, index };
    }


    // MPS/Marker/Style — calcolo puro (pure: ricalcolato quando un altro nodo lo legge)
    function MPSMarkerStyle() {
        this.addOutput('style', 'object');
        const P = (name, def, type) => this.addProperty(name, def, type);
        P('color', '#d93025', 'string'); P('borderColor', '', 'string'); P('glyphColor', '', 'string');
        P('glyph', '', 'string'); P('icon', '', 'string'); P('scale', 1, 'number'); P('showLabel', true, 'boolean');
        P('altitudeMode', 'mesh', 'string'); P('height', 10, 'number'); P('extruded', true, 'boolean');
        P('occluded', true, 'boolean'); P('collision', 'required', 'string'); P('zIndex', 0, 'number');
        const txt = (name) => this.addWidget('text', name, this.properties[name], v => { this.properties[name] = String(v ?? '').trim(); }, { property: name });
        const tog = (name) => this.addWidget('toggle', name, this.properties[name], v => { this.properties[name] = !!v; }, { property: name });
        txt('color'); txt('borderColor'); txt('glyphColor'); txt('glyph'); txt('icon');
        this.addWidget('number', 'scale', 1, v => { this.properties.scale = Math.min(4, Math.max(0.3, Number(v) || 1)); }, { min: 0.3, max: 4, step: 1, precision: 1, property: 'scale' });
        tog('showLabel');
        this.addWidget('combo', 'altitudeMode', 'mesh', v => { this.properties.altitudeMode = v; }, { values: ['mesh', 'ground', 'relative', 'absolute'], property: 'altitudeMode' });
        this.addWidget('number', 'height', 10, v => { this.properties.height = Number(v) || 0; }, { min: -100, max: 2000, step: 10, precision: 0, property: 'height' });
        tog('extruded'); tog('occluded');
        this.addWidget('combo', 'collision', 'required', v => { this.properties.collision = v; }, { values: ['required', 'optional', 'priority'], property: 'collision' });
        this.addWidget('number', 'zIndex', 0, v => { this.properties.zIndex = Math.round(Number(v) || 0); }, { min: -1000, max: 1000, step: 10, precision: 0, property: 'zIndex' });
        paint(this, C_ABSTRACT);
        this.size = [240, 330];
    }
    MPSMarkerStyle.title = 'Marker Style';
    MPSMarkerStyle.desc  = 'Builds the look of the markers for Marker Add / Add List / Update: pin colors, glyph or icon, size, label, height and collisions. Pure calculation, no trigger needed';
    MPSMarkerStyle.pure  = true;
    MPSMarkerStyle.portHelp = {
        outputs: { style: 'object — { color, borderColor, glyphColor, glyph, icon, scale, showLabel, altitudeMode, height, extruded, occluded, collision, zIndex }' },
        properties: {
            color:        'pin background, CSS color (e.g. "#d93025"); empty = Google red',
            borderColor:  'pin border color; empty = darker shade of the background',
            glyphColor:   'color of the glyph (the dot or text inside the pin); empty = default',
            glyph:        'text inside the pin (1-2 characters or an emoji) · "@" = first letter of the label · "#" = order number in Add List · empty = the default dot',
            icon:         'image inside the pin instead of the glyph: URL (absolute, or relative to the dashboard), better a small square SVG or PNG',
            scale:        'pin size, 1 = normal (0.3-4)',
            showLabel:    'shows the label next to the pin (2D) or above it (3D); off = only the tooltip',
            altitudeMode: '3D only — mesh = "height" metres above buildings or ground (default, good in town) · ground = laid on the ground · relative = "height" metres above the ground · absolute = data altitude (sea level) + "height"; without altitude it behaves as relative',
            height:       '3D only — metres used by altitudeMode (default 10)',
            extruded:     '3D only — vertical line from the pin down to the ground',
            occluded:     '3D only — on = the pin stays visible behind buildings · off = hidden by buildings',
            collision:    'required = always shown · optional = hidden when it overlaps others · priority = always shown and hides the optional ones it overlaps',
            zIndex:       'drawing order among markers, higher = in front (0 = automatic)',
        },
    };
    MPSMarkerStyle.prototype.onExecute = function () {
        const p = this.properties;
        this.setOutputData(0, {
            color: p.color, borderColor: p.borderColor, glyphColor: p.glyphColor, glyph: p.glyph, icon: p.icon,
            scale: p.scale, showLabel: !!p.showLabel, altitudeMode: p.altitudeMode, height: p.height,
            extruded: !!p.extruded, occluded: !!p.occluded, collision: p.collision, zIndex: p.zIndex || null,
        });
    };
    LG.registerNodeType('MPS/Marker/Style', MPSMarkerStyle);


    // MPS/Marker/Add
    function MPSMarkerAdd() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('marker',  'object');
        this.addInput('style',   'object');
        this.addOutput('done',   LG.EVENT);
        this.addOutput('id',     'string');
        this.addOutput('marker', 'object');
        _markerAddWidgets(this);
        paint(this, C_CREATE);
        this.size = [230, 170];
    }
    MPSMarkerAdd.title = 'Marker Add';
    MPSMarkerAdd.desc  = 'Puts a marker on the map (2D and 3D) from a data object { lat, lng, … }, e.g. a TML record. Same id = the old marker is replaced. Look from Marker Style; clicks go to Events On Marker Click';
    MPSMarkerAdd.error_output = true;
    MPSMarkerAdd.portHelp = {
        inputs: {
            trigger: 'event — adds (or replaces) the marker',
            marker:  'object — the data of the marker: ' + MARKER_DATA_HELP,
            style:   'object — from Marker Style (optional); without it, Google red pin with label',
        },
        outputs: {
            done:   'event — marker on the map',
            id:     'string — id of the marker (from idField, or automatic)',
            marker: 'object — { id, id_mrk, name, nome, group, lat, lng, altitude, source: "flow", data }',
            error:  'event — no lat/lng, map not ready or marker refused by Google',
        },
        properties: { group: 'group name, to remove or frame markers together (default "flow")', idField: MARKER_ID_HELP, labelField: MARKER_LABEL_HELP, onClick: MARKER_CLICK_HELP },
    };
    MPSMarkerAdd.prototype.onAction = function () {
        this.clearError?.();
        const ctx = this.graph?._appContext;
        if (!ctx?.addFlowMarker) { this.triggerError?.(new Error('no MPS map in this context')); return; }
        const res = ctx.addFlowMarker(this.getInputData(1), _markerOpts(this, this.getInputData(2), null));
        if (res?.error) { this.triggerError?.(new Error(res.error)); return; }
        this.setOutputData(1, res.rec.id);
        this.setOutputData(2, res.rec);
        this.triggerSlot(0);
    };
    LG.registerNodeType('MPS/Marker/Add', MPSMarkerAdd);


    // MPS/Marker/AddList
    function MPSMarkerAddList() {
        this.addInput('trigger',  LG.ACTION);
        this.addInput('markers',  'array');
        this.addInput('style',    'object');
        this.addOutput('done',    LG.EVENT);
        this.addOutput('ids',     'array');
        this.addOutput('count',   'number');
        _markerAddWidgets(this);
        this.addProperty('replace', true,  'boolean');
        this.addProperty('fit',     false, 'boolean');
        this.addWidget('toggle', 'replace', true,  v => { this.properties.replace = !!v; }, { property: 'replace' });
        this.addWidget('toggle', 'fit',     false, v => { this.properties.fit = !!v; },     { property: 'fit' });
        paint(this, C_CREATE);
        this.size = [230, 215];
    }
    MPSMarkerAddList.title = 'Marker Add List';
    MPSMarkerAddList.desc  = 'Puts many markers on the map (2D and 3D) from an array of data objects, e.g. all the records of a TML layer. Can clear the group first and frame the result';
    MPSMarkerAddList.error_output = true;
    MPSMarkerAddList.portHelp = {
        inputs: {
            trigger: 'event — adds the markers',
            markers: 'array — data objects, one per marker: ' + MARKER_DATA_HELP,
            style:   'object — from Marker Style (optional), same for all; a glyph "#" numbers them in order',
        },
        outputs: {
            done:  'event — markers on the map (also when some items were skipped)',
            ids:   'array — ids of the markers added, in order',
            count: 'number — how many were added',
            error: 'event — markers is not an array, map not ready, or some items had no valid lat/lng (the others are added)',
        },
        properties: {
            group: 'group of the new markers (default "flow")', idField: MARKER_ID_HELP, labelField: MARKER_LABEL_HELP, onClick: MARKER_CLICK_HELP,
            replace: 'on = first removes the markers already in the group (a new list replaces the old one) · off = adds to them',
            fit:     'on = at the end frames all the markers of the group (as Marker Fit)',
        },
    };
    MPSMarkerAddList.prototype.onAction = function () {
        this.clearError?.();
        const ctx  = this.graph?._appContext;
        const list = this.getInputData(1);
        if (!ctx?.addFlowMarker) { this.triggerError?.(new Error('no MPS map in this context')); return; }
        if (!Array.isArray(list)) { this.triggerError?.(new Error('markers is not an array')); return; }
        const group = this.properties.group || 'flow';
        if (this.properties.replace) ctx.removeFlowMarkers({ group });
        const style = this.getInputData(2);
        const ids = [];
        let skipped = 0, lastErr = '';
        list.forEach((data, i) => {
            const res = ctx.addFlowMarker(data, _markerOpts(this, style, i));
            if (res?.error) { skipped++; lastErr = res.error; } else ids.push(res.rec.id);
        });
        if (this.properties.fit && ids.length) ctx.fitFlowMarkers(group, {});
        this.setOutputData(1, ids);
        this.setOutputData(2, ids.length);
        this.triggerSlot(0);
        if (skipped) this.triggerError?.(new Error(`${skipped} of ${list.length} skipped: ${lastErr}`));
    };
    LG.registerNodeType('MPS/Marker/AddList', MPSMarkerAddList);


    // MPS/Marker/Update
    function MPSMarkerUpdate() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id',      'string');
        this.addInput('style',   'object');
        this.addInput('marker',  'object');
        this.addOutput('done',   LG.EVENT);
        paint(this, C_SET);
        this.size = [200, 100];
    }
    MPSMarkerUpdate.title = 'Marker Update';
    MPSMarkerUpdate.desc  = 'Changes a marker created by Marker Add: new style fields (merged with the current ones) and/or new data (position, label…). E.g. highlight the clicked marker with a bigger, different-colored style';
    MPSMarkerUpdate.error_output = true;
    MPSMarkerUpdate.portHelp = {
        inputs: {
            trigger: 'event — applies the changes',
            id:      'string — id of the marker',
            style:   'object — style fields to change (from Marker Style, or an object with only some fields, e.g. { color: "#1a73e8", scale: 1.5 }); optional',
            marker:  'object — data fields to change (lat/lng move it, the labelField renames it); optional',
        },
        outputs: { done: 'event — marker updated', error: 'event — no marker with this id' },
    };
    MPSMarkerUpdate.prototype.onAction = function () {
        this.clearError?.();
        const ctx = this.graph?._appContext;
        const id  = this.getInputData(1);
        if (!ctx?.updateFlowMarker) { this.triggerError?.(new Error('no MPS map in this context')); return; }
        if (!ctx.updateFlowMarker(id, this.getInputData(2), this.getInputData(3))) { this.triggerError?.(new Error(`no marker with id "${id ?? ''}"`)); return; }
        this.triggerSlot(0);
    };
    LG.registerNodeType('MPS/Marker/Update', MPSMarkerUpdate);


    // MPS/Marker/Remove
    function MPSMarkerRemove() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id',      'string');
        this.addOutput('done',   LG.EVENT);
        this.addOutput('count',  'number');
        this.addProperty('scope', 'id',   'string');
        this.addProperty('group', 'flow', 'string');
        this.addWidget('combo', 'scope', 'id',   v => { this.properties.scope = v; }, { values: ['id', 'group', 'all'], property: 'scope' });
        this.addWidget('text',  'group', 'flow', v => { this.properties.group = String(v ?? '').trim(); }, { property: 'group' });
        paint(this, C_DELETE);
        this.size = [210, 110];
    }
    MPSMarkerRemove.title = 'Marker Remove';
    MPSMarkerRemove.desc  = 'Removes markers created by the flow: one (by id), a group, or all. The mod_spec markers are not touched';
    MPSMarkerRemove.portHelp = {
        inputs: { trigger: 'event — removes', id: 'string — id of the marker, used when scope = id' },
        outputs: { done: 'event — always, also when nothing was removed', count: 'number — how many were removed' },
        properties: { scope: 'id = the marker of the "id" input · group = all the markers of "group" · all = all the flow markers', group: 'group used when scope = group' },
    };
    MPSMarkerRemove.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.removeFlowMarkers) return;
        const p = this.properties;
        const sel = p.scope === 'all' ? { all: true } : p.scope === 'group' ? { group: p.group || 'flow' } : { id: this.getInputData(1) };
        if (p.scope === 'id' && (sel.id == null || sel.id === '')) { this.setOutputData(1, 0); this.triggerSlot(0); return; }
        this.setOutputData(1, ctx.removeFlowMarkers(sel));
        this.triggerSlot(0);
    };
    LG.registerNodeType('MPS/Marker/Remove', MPSMarkerRemove);


    // MPS/Marker/Fit
    function MPSMarkerFit() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done',   LG.EVENT);
        this.addOutput('count',  'number');
        this.addProperty('group',    '',    'string');
        this.addProperty('motion',   'fly', 'string');
        this.addProperty('duration', 1500,  'number');
        this.addWidget('text',   'group',    '',    v => { this.properties.group = String(v ?? '').trim(); }, { property: 'group' });
        this.addWidget('combo',  'motion',   'fly', v => { this.properties.motion = v; }, { values: ['fly', 'glide', 'jump'], property: 'motion' });
        this.addWidget('number', 'duration', 1500,  v => { this.properties.duration = Math.max(0, Math.round(Number(v) || 0)); }, { min: 0, max: 30000, step: 1000, precision: 0, property: 'duration' });
        paint(this, C_ANIM);
        this.size = [210, 125];
    }
    MPSMarkerFit.title = 'Marker Fit';
    MPSMarkerFit.desc  = 'Frames the markers created by the flow (one group or all): 2D zooms to contain them, 3D looks at their middle from a distance that shows them all';
    MPSMarkerFit.portHelp = {
        inputs: { trigger: 'event — frames' },
        outputs: { done: 'event — only if there was at least one marker', count: 'number — how many markers were framed' },
        properties: {
            group:    'group to frame; empty = all the flow markers',
            motion:   '3D only — fly = arc · glide = straight slide · jump = immediate',
            duration: '3D only — duration in ms',
        },
    };
    MPSMarkerFit.prototype.onAction = function () {
        const ctx = this.graph?._appContext;
        if (!ctx?.fitFlowMarkers) return;
        const p = this.properties;
        const n = ctx.fitFlowMarkers(p.group || null, { motion: p.motion, duration: p.duration });
        this.setOutputData(1, n);
        if (n) this.triggerSlot(0);
    };
    LG.registerNodeType('MPS/Marker/Fit', MPSMarkerFit);


    // ─────────────────────────────────────────────────────────────────────────
    // MPS/Geo — quota del terreno dalla Elevation API di Google (2026-10-20).
    // Nodo a parte, non dentro FlyTo: ogni richiesta è un costo separato e deve restare visibile.
    // Cache per pagina (fra pannelli e flow): lo stesso punto si paga una volta per sessione.
    // Non serve la mappa: basta Google Maps caricato (dashboard.php).
    // ─────────────────────────────────────────────────────────────────────────
    const ELEV_CACHE = window.__RA_ELEVATION_CACHE || (window.__RA_ELEVATION_CACHE = new Map());
    const _elevKey = (lat, lng) => `${lat.toFixed(5)},${lng.toFixed(5)}`;   // ~1 m
    const _toNum = (v) => {
        if (v == null || v === '') return null;
        const n = Number(typeof v === 'string' ? v.trim().replace(',', '.') : v);
        return Number.isFinite(n) ? n : null;
    };
    const _latLng = (p) => {
        if (!_isObj(p)) return null;
        const lat = _toNum(p.lat ?? p.latitude), lng = _toNum(p.lng ?? p.lon ?? p.longitude);
        return lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
    };
    /** Quote (m sul livello del mare) per più punti: prima la cache, poi richieste da 512 punti. */
    async function _elevations(points) {
        const values = points.map(p => ELEV_CACHE.get(_elevKey(p.lat, p.lng)) ?? null);
        const missing = values.map((v, i) => (v == null ? i : -1)).filter(i => i !== -1);
        let requests = 0;
        if (missing.length) {
            if (!window.google?.maps?.importLibrary) throw new Error('Google Maps not loaded');
            const { ElevationService } = await google.maps.importLibrary('elevation');
            const svc = new ElevationService();
            for (let k = 0; k < missing.length; k += 512) {
                const chunk = missing.slice(k, k + 512);
                requests++;
                const res = await svc.getElevationForLocations({ locations: chunk.map(i => points[i]) });
                (res?.results ?? []).forEach((r, j) => {
                    const e = Number(r?.elevation), i = chunk[j];
                    if (!Number.isFinite(e)) return;
                    values[i] = e;
                    ELEV_CACHE.set(_elevKey(points[i].lat, points[i].lng), e);
                });
            }
        }
        return { values, requests, cached: points.length - missing.length };
    }
    /** Contatore sul nodo: le richieste pagate restano sotto gli occhi. */
    function _drawElevStats(ctx2d) {
        if (this.flags?.collapsed) return;
        ctx2d.save();
        ctx2d.font = '11px sans-serif';
        ctx2d.fillStyle = '#fde68a';
        ctx2d.fillText(`Google requests: ${this._requests || 0} · from cache: ${this._cached || 0}`, 8, this.size[1] - 8);
        ctx2d.restore();
    }
    const ELEV_COMMON_PROPS = {
        mode:   'missing = asks only for points without a valid altitude (default, saves requests) · always = asks for every point, overwriting the altitude',
        field:  'field where the altitude is written (default "altitude", the one read by Camera FlyTo and Marker Add)',
        offset: 'metres added to the ground altitude before writing it (e.g. 10 to aim at the middle of a building); 0 = ground',
    };
    function _elevProps(node) {
        node.addProperty('mode',   'missing',  'string');
        node.addProperty('field',  'altitude', 'string');
        node.addProperty('offset', 0,          'number');
        node.addWidget('combo',  'mode',   'missing',  v => { node.properties.mode = v; }, { values: ['missing', 'always'], property: 'mode' });
        node.addWidget('text',   'field',  'altitude', v => { node.properties.field = String(v ?? '').trim() || 'altitude'; }, { property: 'field' });
        node.addWidget('number', 'offset', 0,          v => { node.properties.offset = Number(v) || 0; }, { min: -100, max: 500, step: 10, precision: 0, property: 'offset' });
    }


    // MPS/Geo/Elevation
    function MPSGeoElevation() {
        this.addInput('trigger',   LG.ACTION);
        this.addInput('point',     'object');
        this.addOutput('done',     LG.EVENT);
        this.addOutput('point',    'object');
        this.addOutput('elevation','number');
        _elevProps(this);
        this._requests = 0; this._cached = 0; this._token = 0;
        paint(this, C_PAID);
        this.size = [260, 140];
    }
    MPSGeoElevation.title = 'Geo Elevation';
    MPSGeoElevation.desc  = 'Adds the ground altitude (metres above sea level) to a point { lat, lng } using the Google Elevation API — a PAID service billed apart from the maps. By default it asks only when the point has no altitude yet, and the same point is asked once per session. Put it before Camera FlyTo or Marker Add';
    MPSGeoElevation.error_output = true;
    MPSGeoElevation.portHelp = {
        inputs: {
            trigger: 'event — completes the point',
            point:   'object — { lat, lng, … } (also lon, latitude/longitude); all the other fields are kept',
        },
        outputs: {
            done:      'event — point ready (also without a request, if it already had the altitude)',
            point:     'object — copy of the point with the altitude in "field"',
            elevation: 'number — ground altitude in metres above sea level (without offset)',
            error:     'event — no valid lat/lng, or Google refused the request (Elevation API not enabled on the key, quota…)',
        },
        properties: ELEV_COMMON_PROPS,
    };
    MPSGeoElevation.prototype.onDrawForeground = _drawElevStats;
    MPSGeoElevation.prototype.onAction = async function () {
        this.clearError?.();
        const point = this.getInputData(1);
        const ll = _latLng(point);
        if (!ll) { this.triggerError?.(new Error('point without valid lat/lng')); return; }
        const p = this.properties, field = p.field || 'altitude';
        const have = _toNum(point[field]);
        if (p.mode !== 'always' && have != null) {
            this.setOutputData(1, { ...point });
            this.setOutputData(2, have);
            this.triggerSlot(0);
            return;
        }
        const token = ++this._token;
        try {
            const { values, requests, cached } = await _elevations([ll]);
            if (token !== this._token) return;   // nel frattempo è arrivato un altro punto
            this._requests += requests; this._cached += cached;
            this.setDirtyCanvas?.(true, false);
            const e = values[0];
            if (e == null) { this.triggerError?.(new Error('no altitude returned for this point')); return; }
            this.setOutputData(1, { ...point, [field]: e + (Number(p.offset) || 0) });
            this.setOutputData(2, e);
            this.triggerSlot(0);
        } catch (err) {
            if (token === this._token) this.triggerError?.(err);
        }
    };
    LG.registerNodeType('MPS/Geo/Elevation', MPSGeoElevation);


    // MPS/Geo/ElevationList
    function MPSGeoElevationList() {
        this.addInput('trigger',  LG.ACTION);
        this.addInput('points',   'array');
        this.addOutput('done',    LG.EVENT);
        this.addOutput('points',  'array');
        this.addOutput('requests','number');
        _elevProps(this);
        this._requests = 0; this._cached = 0; this._token = 0;
        paint(this, C_PAID);
        this.size = [260, 140];
    }
    MPSGeoElevationList.title = 'Geo Elevation List';
    MPSGeoElevationList.desc  = 'Adds the ground altitude (metres above sea level) to every point of an array using the Google Elevation API — a PAID service billed apart from the maps. Up to 512 points per request; points that already have it, or were asked before in this session, cost nothing. Put it before Marker Add List';
    MPSGeoElevationList.error_output = true;
    MPSGeoElevationList.portHelp = {
        inputs: {
            trigger: 'event — completes the points',
            points:  'array — objects { lat, lng, … }; items without valid lat/lng pass unchanged',
        },
        outputs: {
            done:     'event — points ready',
            points:   'array — copies of the points with the altitude in "field", same order',
            requests: 'number — Google requests made this time (0 = all from data or cache)',
            error:    'event — points is not an array, or Google refused the request',
        },
        properties: ELEV_COMMON_PROPS,
    };
    MPSGeoElevationList.prototype.onDrawForeground = _drawElevStats;
    MPSGeoElevationList.prototype.onAction = async function () {
        this.clearError?.();
        const list = this.getInputData(1);
        if (!Array.isArray(list)) { this.triggerError?.(new Error('points is not an array')); return; }
        const p = this.properties, field = p.field || 'altitude', offset = Number(p.offset) || 0;
        const ask = [];   // { i, ll }
        list.forEach((pt, i) => {
            const ll = _latLng(pt);
            if (ll && (p.mode === 'always' || _toNum(pt[field]) == null)) ask.push({ i, ll });
        });
        const token = ++this._token;
        try {
            const { values, requests, cached } = ask.length ? await _elevations(ask.map(a => a.ll)) : { values: [], requests: 0, cached: 0 };
            if (token !== this._token) return;
            this._requests += requests; this._cached += cached;
            this.setDirtyCanvas?.(true, false);
            const out = list.map(pt => (_isObj(pt) ? { ...pt } : pt));
            ask.forEach((a, k) => { if (values[k] != null) out[a.i][field] = values[k] + offset; });
            this.setOutputData(1, out);
            this.setOutputData(2, requests);
            this.triggerSlot(0);
        } catch (err) {
            if (token === this._token) this.triggerError?.(err);
        }
    };
    LG.registerNodeType('MPS/Geo/ElevationList', MPSGeoElevationList);
}
