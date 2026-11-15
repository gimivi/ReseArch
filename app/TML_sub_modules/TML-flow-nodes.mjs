// app/TML_sub_modules/TML-flow-nodes.mjs
// Nodi FLE per la timeline TML (_doc/module-tml-timeline.md §6). Regole: _doc/guide-fle-regole-nodi.md
//
// Lavorano sul pannello attraverso graph._appContext (TML-flow-runner.mjs::buildTMLAppContext):
// funzionano in un flow dell'oggetto TML e con "Testa su panel" su un pannello TML. Senza
// pannello non fanno nulla; i nodi TML/Date/* funzionano ovunque.
//
// Formati delle porte (uno per porta):
//   tempi           number, millisecondi UTC (TML/Date/* per convertire)
//   item            object { id, type, start, end, content, title, group, class[], tags[], link, data, layer }
//   id              string        ids, class, tags   array di stringhe
//
// Famiglie:
//   TML/Events/*   sorgenti (onStart → localEvents → runStep → onExecute emette)
//   azioni         solo onAction (niente onExecute); errori con la porta d'errore del fork
//   TML/Date/*, TML/Item/Make   calcolo puro in onExecute

import * as D from "./TML-dates.mjs";
import { splitList } from "../FLE_sub_modules/FLE-web-nodes.mjs";

const COL = {
    event:   ['#062a1a', '#0a4a2e'],
    make:    ['#14532d', '#166534'],   // creazione astratta
    create:  ['#064e3b', '#065f46'],   // creazione intensa
    get:     ['#1a2a4a', '#1e3a5f'],
    set:     ['#2a1a4a', '#4a1d96'],
    calc:    ['#1e3a5f', '#1e40af'],
    del:     ['#3a1a1a', '#7f1d1d'],
    anim:    ['#3a1a5a', '#6d28d9'],
};

const CTX_HELP = 'Works in a flow of the TML object or with "Testa su panel" on a TML panel; elsewhere it does nothing.';
const OPT = ' (optional: right-click on the node → Inputs/Outputs)';
const ERR = (when) => `event — ${when}. Port hidden by default: right-click → Show error`;

export function registerTMLFlowNodes() {
    const LG = window.LiteGraph;
    if (!LG) { console.warn('[TML-flow-nodes] LiteGraph not available'); return; }
    if (window._TML_FLOW_NODES_REGISTERED) return;
    window._TML_FLOW_NODES_REGISTERED = true;

    // ── helper ──────────────────────────────────────────────────────────────
    const _out  = (n, name, v) => { const i = n.findOutputSlot(name); if (i !== -1) n.setOutputData(i, v); };
    const _fire = (n, name, p) => { const i = n.findOutputSlot(name); if (i !== -1) n.triggerSlot(i, p); };
    const _in   = (n, name) => { const i = n.findInputSlot(name); return i === -1 ? undefined : n.getInputData(i); };
    /** Ingresso collegato → suo valore; altrimenti la proprietà (widget). */
    const _val = (n, name) => {
        const i = n.findInputSlot(name);
        if (i !== -1 && n.inputs[i].link != null) return n.getInputData(i);
        return n.properties?.[name];
    };
    const _ctx = (n) => {
        const c = n.graph?._appContext;
        return c && c.ready && typeof c.addItem === 'function' ? c : null;
    };
    const _color = (n, k) => { n.color = COL[k][0]; n.bgcolor = COL[k][1]; };
    const _fit = (n, w = 210) => { const s = n.computeSize(); n.size = [Math.max(w, s[0]), s[1]]; };

    /** Porte opzionali: menu Inputs/Outputs + rimovibili anche dopo il caricamento di un flow. */
    function optionalPorts(Ctor, { inputs = [], outputs = [] }) {
        if (inputs.length) {
            Ctor.prototype.onGetInputs = function () {
                return inputs.filter(([n]) => this.findInputSlot(n) === -1).map(([n, t]) => [n, t, { removable: true }]);
            };
        }
        if (outputs.length) {
            Ctor.prototype.onGetOutputs = function () {
                return outputs.filter(([n]) => this.findOutputSlot(n) === -1).map(([n, t]) => [n, t, { removable: true }]);
            };
        }
        const prev = Ctor.prototype.onConfigure;
        Ctor.prototype.onConfigure = function (o) {
            for (const s of this.inputs ?? [])  if (inputs.some(([n]) => n === s.name))  s.removable = true;
            for (const s of this.outputs ?? []) if (outputs.some(([n]) => n === s.name)) s.removable = true;
            prev?.call(this, o);
        };
    }

    /** Nodo azione: trigger → fn(ctx) → done; errori sulla porta d'errore. */
    function actionNode(Ctor, fn) {
        Ctor.error_output = true;
        Ctor.prototype.onAction = function () {
            const ctx = _ctx(this);
            if (!ctx) return;
            this.clearError?.();
            try { fn.call(this, ctx); }
            catch (err) { this.triggerError?.(err); return; }
            _fire(this, 'done');
        };
    }

    /** Nodo evento: si aggancia a ctx.localEvents[evName] e in onExecute emette. */
    function eventNode(Ctor, evName, emit) {
        Ctor.prototype.onStart = function () {
            this._cleanup?.(); this._cleanup = null;
            const ctx = this.graph?._appContext;
            const bus = ctx?.localEvents;
            if (!bus) return;
            this._pending = null;
            const g = this.graph;
            const h = (ev) => { this._pending = ev.detail; try { g.runStep(1); } catch { /* noop */ } };
            bus.addEventListener(evName, h);
            this._cleanup = () => bus.removeEventListener(evName, h);
            ctx.signal?.addEventListener('abort', () => this._cleanup?.(), { once: true });
        };
        Ctor.prototype.onStop = function () { this._cleanup?.(); this._cleanup = null; };
        Ctor.prototype.onRemoved = Ctor.prototype.onStop;
        Ctor.prototype.onExecute = function () {
            if (this._pending == null) return;
            const p = this._pending;
            this._pending = null;
            emit.call(this, p);
            _fire(this, 'trigger');
        };
    }

    const reg = (type, Ctor) => LG.registerNodeType(type, Ctor);

    // ═════════════════════════════════════════════════════════════════════════
    // TML/Events
    // ═════════════════════════════════════════════════════════════════════════

    function OnSelect() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('item', 'object');
        this.addOutput('id', 'string');
        _color(this, 'event'); _fit(this);
    }
    OnSelect.title = 'Events On Select';
    OnSelect.desc  = 'Fires when an item of the timeline is selected (click, or TML/Item/Select with emit). ' + CTX_HELP;
    OnSelect.portHelp = {
        outputs: {
            trigger: 'event — on every item selection',
            item:    'object — selected item { id, type, start, end (ms), content, title, group, class, tags, link, data, layer }',
            id:      'string — id of the item',
            group:   'string — id of the group (lane), null if without group' + OPT,
            start:   'number — start in ms UTC' + OPT,
            end:     'number — end in ms UTC, null for point/box' + OPT,
            byUser:  'boolean — true if the selection comes from a click' + OPT,
        },
    };
    optionalPorts(OnSelect, { outputs: [['group', 'string'], ['start', 'number'], ['end', 'number'], ['byUser', 'boolean']] });
    eventNode(OnSelect, 'select', function (d) {
        _out(this, 'item', d.item); _out(this, 'id', d.item.id);
        _out(this, 'group', d.item.group); _out(this, 'start', d.item.start); _out(this, 'end', d.item.end);
        _out(this, 'byUser', !!d.byUser);
    });
    reg('TML/Events/OnSelect', OnSelect);

    function OnRangeChanged() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('start', 'number');
        this.addOutput('end', 'number');
        this.addOutput('byUser', 'boolean');
        _color(this, 'event'); _fit(this);
    }
    OnRangeChanged.title = 'Events On Range Changed';
    OnRangeChanged.desc  = 'Fires at the end of a pan or zoom of the timeline. ' + CTX_HELP;
    OnRangeChanged.portHelp = {
        outputs: {
            trigger: 'event — at the end of a pan/zoom (not during the movement)',
            start:   'number — start of the visible window, ms UTC',
            end:     'number — end of the visible window, ms UTC',
            byUser:  'boolean — true if done by the user, false if by code (SetWindow, Fit, FocusItem)',
        },
    };
    eventNode(OnRangeChanged, 'rangechanged', function (d) {
        _out(this, 'start', d.start); _out(this, 'end', d.end); _out(this, 'byUser', d.byUser);
    });
    reg('TML/Events/OnRangeChanged', OnRangeChanged);

    function OnCursorChanged() {
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('time', 'number');
        this.addOutput('byUser', 'boolean');
        _color(this, 'event'); _fit(this);
    }
    OnCursorChanged.title = 'Events On Cursor Changed';
    OnCursorChanged.desc  = 'Fires when the timeline cursor moves (dragged, Cursor Set, every step of Cursor Play). ' + CTX_HELP;
    OnCursorChanged.portHelp = {
        outputs: {
            trigger: 'event — on every cursor movement',
            time:    'number — cursor position, ms UTC',
            byUser:  'boolean — true if dragged by the user',
        },
    };
    eventNode(OnCursorChanged, 'cursorchanged', function (d) {
        _out(this, 'time', d.time); _out(this, 'byUser', !!d.byUser);
    });
    reg('TML/Events/OnCursorChanged', OnCursorChanged);

    // ═════════════════════════════════════════════════════════════════════════
    // TML/View
    // ═════════════════════════════════════════════════════════════════════════

    function SetWindow() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('start', 'number');
        this.addInput('end', 'number');
        this.addOutput('done', LG.EVENT);
        this.addProperty('animate', true, 'boolean');
        this.addWidget('toggle', 'animate', true, v => { this.properties.animate = !!v; }, { property: 'animate' });
        _color(this, 'set'); _fit(this);
    }
    SetWindow.title = 'View Set Window';
    SetWindow.desc  = 'Shows the given time range. ' + CTX_HELP;
    SetWindow.portHelp = {
        inputs: {
            trigger: 'event — moves the view',
            start:   'number — start, ms UTC (TML/Date/Parse to write it as a date)',
            end:     'number — end, ms UTC; must be after start',
        },
        outputs: { done: 'event — view set', error: ERR('start/end missing or end not after start') },
        properties: { animate: 'animates the movement' },
    };
    actionNode(SetWindow, function (ctx) { ctx.setWindow(_in(this, 'start'), _in(this, 'end'), this.properties.animate); });
    reg('TML/View/SetWindow', SetWindow);

    function Fit() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done', LG.EVENT);
        _color(this, 'set'); _fit(this, 170);
    }
    Fit.title = 'View Fit';
    Fit.desc  = 'Fits the view to all items, or only to those given in "ids". ' + CTX_HELP;
    Fit.portHelp = {
        inputs: {
            trigger: 'event — fits the view',
            ids:     'array of strings — ids of the items to frame; empty = all' + OPT,
        },
        outputs: { done: 'event — view fitted', error: ERR('panel not ready') },
    };
    optionalPorts(Fit, { inputs: [['ids', 'array']] });
    actionNode(Fit, function (ctx) { ctx.fit(_in(this, 'ids')); });
    reg('TML/View/Fit', Fit);

    function FocusItem() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id', 'string');
        this.addOutput('done', LG.EVENT);
        _color(this, 'set'); _fit(this, 170);
    }
    FocusItem.title = 'View Focus Item';
    FocusItem.desc  = 'Centers the view on an item (without selecting it). ' + CTX_HELP;
    FocusItem.portHelp = {
        inputs:  { trigger: 'event — centers', id: 'string — id of the item' },
        outputs: { done: 'event — view centered', error: ERR('no item with this id') },
    };
    actionNode(FocusItem, function (ctx) { ctx.focusItem(_in(this, 'id')); });
    reg('TML/View/FocusItem', FocusItem);

    function GetWindow() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done', LG.EVENT);
        this.addOutput('start', 'number');
        this.addOutput('end', 'number');
        _color(this, 'get'); _fit(this, 170);
    }
    GetWindow.title = 'View Get Window';
    GetWindow.desc  = 'Reads the visible time range. ' + CTX_HELP;
    GetWindow.portHelp = {
        inputs:  { trigger: 'event — reads the view' },
        outputs: {
            done:  'event — values updated',
            start: 'number — start of the visible window, ms UTC',
            end:   'number — end of the visible window, ms UTC',
            error: ERR('panel not ready'),
        },
    };
    actionNode(GetWindow, function (ctx) { const w = ctx.getWindow(); _out(this, 'start', w.start); _out(this, 'end', w.end); });
    reg('TML/View/GetWindow', GetWindow);

    // ═════════════════════════════════════════════════════════════════════════
    // TML/Item
    // ═════════════════════════════════════════════════════════════════════════

    function Make() {
        this.addInput('start', 'number');
        this.addInput('end', 'number');
        this.addInput('content', 'string');
        this.addInput('group', 'string');
        this.addOutput('item', 'object');
        _color(this, 'make'); _fit(this, 170);
    }
    Make.title = 'Item Make';
    Make.desc  = 'Builds an item to add with TML/Item/Add or to use in TML/Data/Load. Works anywhere.';
    Make.portHelp = {
        inputs: {
            start:   'number — start, ms UTC (required: without it the output is null)',
            end:     'number — end, ms UTC; empty = point-in-time event (box)',
            content: 'string — text on the item (plain text)',
            group:   'string — id of the group (lane); a new group is created',
            id:      'string — id; empty = assigned by Add (n1, n2…)' + OPT,
            type:    'string — point, box, range, background; empty = range if there is an end, otherwise box' + OPT,
            title:   'string — note in the tooltip' + OPT,
            class:   'array of strings — CSS classes (tml-c-<name>)' + OPT,
            tags:    'array of strings — tags for the filters' + OPT,
            data:    'object — free fields, passed through unchanged' + OPT,
        },
        outputs: { item: 'object — item { id, type, start, end, content, group, title, class, tags, data }, null without start' },
    };
    optionalPorts(Make, { inputs: [['id', 'string'], ['type', 'string'], ['title', 'string'], ['class', 'array'], ['tags', 'array'], ['data', 'object']] });
    Make.prototype.onExecute = function () {
        const start = _in(this, 'start');
        if (start == null || start === '') { _out(this, 'item', null); return; }
        const it = { start, end: _in(this, 'end') ?? null, content: _in(this, 'content') ?? '', group: _in(this, 'group') ?? null };
        for (const k of ['id', 'type', 'title', 'class', 'tags', 'data']) {
            const v = _in(this, k);
            if (v != null && v !== '') it[k] = v;
        }
        _out(this, 'item', it);
    };
    reg('TML/Item/Make', Make);

    function Add() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('item', 'object');
        this.addOutput('done', LG.EVENT);
        this.addOutput('id', 'string');
        _color(this, 'create'); _fit(this, 170);
    }
    Add.title = 'Item Add';
    Add.desc  = 'Adds an item to the timeline (does not save the model file). ' + CTX_HELP;
    Add.portHelp = {
        inputs:  { trigger: 'event — adds', item: 'object — item with start/end in ms (usually from TML/Item/Make)' },
        outputs: {
            done:  'event — item added',
            id:    'string — id of the added item',
            error: ERR('invalid item (start missing, unknown type, end before start) or id already present'),
        },
    };
    actionNode(Add, function (ctx) { _out(this, 'id', ctx.addItem(_in(this, 'item'))); });
    reg('TML/Item/Add', Add);

    function Update() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id', 'string');
        this.addInput('fields', 'object');
        this.addOutput('done', LG.EVENT);
        _color(this, 'set'); _fit(this, 170);
    }
    Update.title = 'Item Update';
    Update.desc  = 'Changes some fields of an item. ' + CTX_HELP;
    Update.portHelp = {
        inputs: {
            trigger: 'event — updates',
            id:      'string — id of the item',
            fields:  'object — only the fields to change, e.g. { "content": "…", "end": 1234 } (dates in ms)',
        },
        outputs: { done: 'event — item updated', error: ERR('non-existent id or invalid fields') },
    };
    actionNode(Update, function (ctx) { ctx.updateItem(_in(this, 'id'), _in(this, 'fields')); });
    reg('TML/Item/Update', Update);

    function Remove() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id', 'string');
        this.addOutput('done', LG.EVENT);
        _color(this, 'del'); _fit(this, 170);
    }
    Remove.title = 'Item Remove';
    Remove.desc  = 'Removes an item from the timeline (not from the model file). ' + CTX_HELP;
    Remove.portHelp = {
        inputs:  { trigger: 'event — removes', id: 'string — id of the item' },
        outputs: { done: 'event — item removed', error: ERR('no item with this id') },
    };
    actionNode(Remove, function (ctx) { ctx.removeItem(_in(this, 'id')); });
    reg('TML/Item/Remove', Remove);

    function Get() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id', 'string');
        this.addOutput('done', LG.EVENT);
        this.addOutput('item', 'object');
        _color(this, 'get'); _fit(this, 170);
    }
    Get.title = 'Item Get';
    Get.desc  = 'Reads an item by id. ' + CTX_HELP;
    Get.portHelp = {
        inputs:  { trigger: 'event — reads', id: 'string — id of the item' },
        outputs: { done: 'event — item read', item: 'object — item, dates in ms', error: ERR('no item with this id') },
    };
    actionNode(Get, function (ctx) { _out(this, 'item', ctx.getItem(_in(this, 'id'))); });
    reg('TML/Item/Get', Get);

    function List() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done', LG.EVENT);
        this.addOutput('items', 'array');
        this.addOutput('count', 'number');
        _color(this, 'get'); _fit(this, 170);
    }
    List.title = 'Item List';
    List.desc  = 'Lists the items of the timeline (all of them, including those hidden by a filter). ' + CTX_HELP;
    List.portHelp = {
        inputs: {
            trigger: 'event — lists',
            group:   'string — only the items of this group and its subgroups' + OPT,
        },
        outputs: { done: 'event — list ready', items: 'array of items (dates in ms)', count: 'number — how many', error: ERR('panel not ready') },
    };
    optionalPorts(List, { inputs: [['group', 'string']] });
    actionNode(List, function (ctx) { const l = ctx.listItems(_in(this, 'group')); _out(this, 'items', l); _out(this, 'count', l.length); });
    reg('TML/Item/List', List);

    function Select() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('ids', 'array');
        this.addOutput('done', LG.EVENT);
        this.addProperty('emit', false, 'boolean');
        this.addWidget('toggle', 'emit', false, v => { this.properties.emit = !!v; }, { property: 'emit' });
        _color(this, 'set'); _fit(this, 170);
    }
    Select.title = 'Item Select';
    Select.desc  = 'Selects items on the timeline. With "emit" it behaves like a click: OnSelect and selection:change on the bus. ' + CTX_HELP;
    Select.portHelp = {
        inputs:  { trigger: 'event — selects', ids: 'array of strings — ids to select; empty = deselect all' },
        outputs: { done: 'event — selection made', error: ERR('panel not ready') },
        properties: { emit: 'publishes the selection of the first id like a user click' },
    };
    actionNode(Select, function (ctx) { ctx.selectItems(_in(this, 'ids'), this.properties.emit); });
    reg('TML/Item/Select', Select);

    function SetClass() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id', 'string');
        this.addInput('class', 'array');
        this.addOutput('done', LG.EVENT);
        this.addProperty('op', 'set', 'string');
        this.addWidget('combo', 'op', 'set', v => { this.properties.op = v; }, { values: ['set', 'add', 'remove'], property: 'op' });
        _color(this, 'set'); _fit(this, 170);
    }
    SetClass.title = 'Item Set Class';
    SetClass.desc  = 'Changes the CSS classes of an item (tml-c-<name> in the model CSS), e.g. to highlight it. ' + CTX_HELP;
    SetClass.portHelp = {
        inputs: {
            trigger: 'event — applies',
            id:      'string — id of the item',
            class:   'array of strings — class names (without the tml-c- prefix)',
        },
        outputs: { done: 'event — classes changed', error: ERR('no item with this id') },
        properties: { op: 'set = replaces the classes, add = adds, remove = removes' },
    };
    actionNode(SetClass, function (ctx) { ctx.setItemClass(_in(this, 'id'), _in(this, 'class'), this.properties.op); });
    reg('TML/Item/SetClass', SetClass);

    // Normalizzazione di un item per l'App Bus (2026-10-20): calcolo puro, funziona anche senza
    // pannello; record piatto da passare a un Emitter, coordinate numeriche o null (mai 0).
    /** Testo → numero ("41,90134" e "41.90134"); vuoto o non numerico → null. */
    const _coord = (v) => {
        const s = String(v ?? '').trim().replace(',', '.');
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    };
    function ToRecord() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('item', 'object');
        this.addOutput('done', LG.EVENT);
        this.addOutput('record', 'object');
        this.addOutput('id', 'string');
        this.addOutput('name', 'string');
        this.addOutput('geo', 'object');
        this.addOutput('hasGeo', 'boolean');
        this.addProperty('latField', 'lat', 'string');
        this.addProperty('lngField', 'lon', 'string');
        this.addProperty('altField', 'alt', 'string');
        this.addProperty('headField', 'head', 'string');
        this.addProperty('listFields', '', 'string');
        this.addWidget('text', 'latField', 'lat', v => { this.properties.latField = String(v ?? '').trim(); }, { property: 'latField' });
        this.addWidget('text', 'lngField', 'lon', v => { this.properties.lngField = String(v ?? '').trim(); }, { property: 'lngField' });
        this.addWidget('text', 'altField', 'alt', v => { this.properties.altField = String(v ?? '').trim(); }, { property: 'altField' });
        this.addWidget('text', 'headField', 'head', v => { this.properties.headField = String(v ?? '').trim(); }, { property: 'headField' });
        this.addWidget('text', 'listFields', '', v => { this.properties.listFields = String(v ?? '').trim(); }, { property: 'listFields' });
        _color(this, 'calc'); _fit(this, 190);
    }
    ToRecord.title = 'Item To Record';
    ToRecord.desc  = 'Turns a timeline item (e.g. from Events On Select) into a flat record to publish with an App Bus Emitter: original id, name, dates, numeric coordinates and the data columns. Pure calculation: works in any context.';
    ToRecord.error_output = true;
    ToRecord.portHelp = {
        inputs: {
            trigger: 'event — converts',
            item:    'object — timeline item { id, type, start, end, content, title, group, class, tags, link, data, layer }',
        },
        outputs: {
            done:   'event — record ready',
            record: 'object — { id, layer, name, start, end, group, tags, lat, lng, altitude, heading, data } plus one array for each column of listFields: id and group without the layer prefix, start/end in ms (end null for point/box), lat/lng/altitude/heading numbers or null. The whole record works as "view" of MPS Camera FlyTo (heading = preferred arrival direction) and as data of MPS Marker Add',
            id:     'string — original id of the record, without the "<layer>:" prefix added when the timeline has several layers',
            name:   'string — label of the item',
            geo:    'object — { lat, lng, altitude } as numbers (altitude null if the column is empty), null if the record has no valid coordinates',
            hasGeo: 'boolean — true if geo is not null',
            error:  ERR('item missing or not an object'),
        },
        properties: {
            latField: 'column of item.data with the latitude (default "lat"); comma or point as decimal separator',
            lngField: 'column of item.data with the longitude (default "lon")',
            altField: 'column of item.data with the ground altitude in metres above SEA LEVEL (default "alt"), used by MPS Camera FlyTo to frame the place; empty cell = null (MPS Geo Elevation can fill it)',
            headField: 'column of item.data with the preferred viewing direction in degrees, 0 = looking north, 90 = east (default "head"); used by MPS Camera FlyTo with headingMode auto; empty cell = null',
            listFields: 'columns of item.data that contain a list, separated by commas (e.g. "links" or "links,authors"): each one is added to the record, with the same name, as an array of strings (JSON list ["a","b"], or items separated by new lines, ";", "|", ","; see String Split List). Names already used by the record (id, name, tags…) are skipped. Empty = none',
        },
    };
    ToRecord.prototype.onAction = function () {
        this.clearError?.();
        const it = _in(this, 'item');
        if (!it || typeof it !== 'object' || Array.isArray(it)) { this.triggerError?.(new Error('item missing or not an object')); return; }
        const rawId = String(it.id ?? '');
        const prefix = it.layer != null ? `${it.layer}:` : null;
        const id = prefix && rawId.startsWith(prefix) ? rawId.slice(prefix.length) : rawId;
        const data = it.data && typeof it.data === 'object' ? it.data : {};
        const lat = _coord(data[this.properties.latField]);
        const lng = _coord(data[this.properties.lngField]);
        const altitude = this.properties.altField ? _coord(data[this.properties.altField]) : null;
        const heading  = this.properties.headField ? _coord(data[this.properties.headField]) : null;
        const geo = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng, altitude } : null;
        const name = String(it.content ?? '');
        _out(this, 'record', {
            id, layer: it.layer ?? null, name,
            start: it.start ?? null, end: it.end ?? null,
            group: it.group != null ? (prefix && String(it.group).startsWith(prefix) ? String(it.group).slice(prefix.length) : String(it.group)) : null,
            tags: Array.isArray(it.tags) ? [...it.tags] : [],
            lat: geo ? geo.lat : null, lng: geo ? geo.lng : null, altitude: geo ? geo.altitude : null, heading,
            data: { ...data },
            ...this._lists(data),
        });
        _out(this, 'id', id);
        _out(this, 'name', name);
        _out(this, 'geo', geo);
        _out(this, 'hasGeo', !!geo);
        _fire(this, 'done');
    };
    const RECORD_KEYS = new Set(['id', 'layer', 'name', 'start', 'end', 'group', 'tags', 'lat', 'lng', 'altitude', 'heading', 'data']);
    /** Colonne di listFields → { colonna: [stringhe] } (campo libero, nomi del record esclusi). */
    ToRecord.prototype._lists = function (data) {
        const out = {};
        for (const f of String(this.properties.listFields ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
            if (!RECORD_KEYS.has(f)) out[f] = splitList(data[f]);
        }
        return out;
    };
    reg('TML/Item/ToRecord', ToRecord);


    // ═════════════════════════════════════════════════════════════════════════
    // TML/Group, TML/Filter
    // ═════════════════════════════════════════════════════════════════════════

    function GroupList() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done', LG.EVENT);
        this.addOutput('groups', 'array');
        _color(this, 'get'); _fit(this, 170);
    }
    GroupList.title = 'Group List';
    GroupList.desc  = 'Lists the groups (lanes). ' + CTX_HELP;
    GroupList.portHelp = {
        inputs:  { trigger: 'event — lists' },
        outputs: {
            done:   'event — list ready',
            groups: 'array of { id, content, title, class, order, nested, open, visible, layer } — layer null = shared group',
            error:  ERR('panel not ready'),
        },
    };
    actionNode(GroupList, function (ctx) { _out(this, 'groups', ctx.listGroups()); });
    reg('TML/Group/List', GroupList);

    function GroupSetVisible() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id', 'string');
        this.addInput('visible', 'boolean');
        this.addOutput('done', LG.EVENT);
        this.addProperty('visible', true, 'boolean');
        this.addWidget('toggle', 'visible', true, v => { this.properties.visible = !!v; }, { property: 'visible' });
        _color(this, 'set'); _fit(this, 170);
    }
    GroupSetVisible.title = 'Group Set Visible';
    GroupSetVisible.desc  = 'Shows or hides a group (lane). ' + CTX_HELP;
    GroupSetVisible.portHelp = {
        inputs: {
            trigger: 'event — applies',
            id:      'string — id of the group',
            visible: 'boolean — if connected, overrides the widget',
        },
        outputs: { done: 'event — done', error: ERR('no group with this id') },
        properties: { visible: 'value used if the visible input is not connected' },
    };
    actionNode(GroupSetVisible, function (ctx) { ctx.setGroupVisible(_in(this, 'id'), !!_val(this, 'visible')); });
    reg('TML/Group/SetVisible', GroupSetVisible);

    function FilterApply() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('filter', 'object');
        this.addOutput('done', LG.EVENT);
        this.addOutput('count', 'number');
        _color(this, 'set'); _fit(this, 170);
    }
    FilterApply.title = 'Filter Apply';
    FilterApply.desc  = 'Shows only the items that match the filter (or dims the others). ' + CTX_HELP;
    FilterApply.portHelp = {
        inputs: {
            trigger: 'event — applies',
            filter:  'object { tags?: [..] (at least one), groups?: [..] (with their subgroups), layers?: [..] (layer ids), from?: ms, to?: ms (overlapping items), text?: string (in content/title), mode?: "hide" | "dim" } — conditions combined with AND',
        },
        outputs: { done: 'event — filter applied', count: 'number — items that pass the filter', error: ERR('"filter" is not an object') },
    };
    actionNode(FilterApply, function (ctx) { _out(this, 'count', ctx.applyFilter(_in(this, 'filter'))); });
    reg('TML/Filter/Apply', FilterApply);

    function FilterClear() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done', LG.EVENT);
        _color(this, 'set'); _fit(this, 170);
    }
    FilterClear.title = 'Filter Clear';
    FilterClear.desc  = 'Removes the filter: all items become visible again. ' + CTX_HELP;
    FilterClear.portHelp = {
        inputs:  { trigger: 'event — removes the filter' },
        outputs: { done: 'event — done', error: ERR('panel not ready') },
    };
    actionNode(FilterClear, function (ctx) { ctx.clearFilter(); });
    reg('TML/Filter/Clear', FilterClear);

    function LayerList() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done', LG.EVENT);
        this.addOutput('layers', 'array');
        _color(this, 'get'); _fit(this, 170);
    }
    LayerList.title = 'Layer List';
    LayerList.desc  = 'Lists the layers of the timeline (a layer = a set of sheets or files, mod_spec.layer). ' + CTX_HELP;
    LayerList.portHelp = {
        inputs:  { trigger: 'event — lists' },
        outputs: { done: 'event — list ready', layers: 'array of { id, label, visible, count } — count = items of the layer', error: ERR('panel not ready') },
    };
    actionNode(LayerList, function (ctx) { _out(this, 'layers', ctx.listLayers()); });
    reg('TML/Layer/List', LayerList);

    function LayerSetVisible() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('id', 'string');
        this.addInput('visible', 'boolean');
        this.addOutput('done', LG.EVENT);
        this.addProperty('visible', true, 'boolean');
        this.addWidget('toggle', 'visible', true, v => { this.properties.visible = !!v; }, { property: 'visible' });
        _color(this, 'set'); _fit(this, 170);
    }
    LayerSetVisible.title = 'Layer Set Visible';
    LayerSetVisible.desc  = 'Shows or hides a layer: its items, its groups and its CSS. ' + CTX_HELP;
    LayerSetVisible.portHelp = {
        inputs: {
            trigger: 'event — applies',
            id:      'string — id of the layer (mod_spec.layer)',
            visible: 'boolean — if connected, overrides the widget',
        },
        outputs: { done: 'event — done', error: ERR('no layer with this id') },
        properties: { visible: 'value used if the visible input is not connected' },
    };
    actionNode(LayerSetVisible, function (ctx) { ctx.setLayerVisible(_in(this, 'id'), !!_val(this, 'visible')); });
    reg('TML/Layer/SetVisible', LayerSetVisible);

    // ═════════════════════════════════════════════════════════════════════════
    // TML/Cursor
    // ═════════════════════════════════════════════════════════════════════════

    function CursorSet() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('time', 'number');
        this.addOutput('done', LG.EVENT);
        this.addProperty('visible', true, 'boolean');
        this.addWidget('toggle', 'visible', true, v => { this.properties.visible = !!v; }, { property: 'visible' });
        _color(this, 'set'); _fit(this, 170);
    }
    CursorSet.title = 'Cursor Set';
    CursorSet.desc  = 'Moves the cursor (vertical line) to the given time and publishes it on the bus (tml:cursor:changed). ' + CTX_HELP;
    CursorSet.portHelp = {
        inputs:  { trigger: 'event — moves', time: 'number — time, ms UTC' },
        outputs: { done: 'event — cursor moved', error: ERR('"time" is not a number') },
        properties: { visible: 'off = hides the cursor (time ignored)' },
    };
    actionNode(CursorSet, function (ctx) {
        ctx.setCursor(this.properties.visible ? _in(this, 'time') : null, { emit: true, byUser: false });
    });
    reg('TML/Cursor/Set', CursorSet);

    function CursorGet() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done', LG.EVENT);
        this.addOutput('time', 'number');
        _color(this, 'get'); _fit(this, 170);
    }
    CursorGet.title = 'Cursor Get';
    CursorGet.desc  = 'Reads the cursor position. ' + CTX_HELP;
    CursorGet.portHelp = {
        inputs:  { trigger: 'event — reads' },
        outputs: { done: 'event — read', time: 'number — ms UTC, null if the cursor is hidden', error: ERR('panel not ready') },
    };
    actionNode(CursorGet, function (ctx) { _out(this, 'time', ctx.getCursor()); });
    reg('TML/Cursor/Get', CursorGet);

    function CursorPlay() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('stop', LG.ACTION);
        this.addInput('from', 'number');
        this.addInput('to', 'number');
        this.addOutput('done', LG.EVENT);
        this.addOutput('change', LG.EVENT);
        this.addOutput('time', 'number');
        this.addProperty('duration', 10, 'number');
        this.addProperty('loop', false, 'boolean');
        this.addWidget('number', 'duration', 10, v => { this.properties.duration = Math.max(0.1, Number(v) || 10); }, { min: 0.1, step: 10, precision: 1, property: 'duration' });
        this.addWidget('toggle', 'loop', false, v => { this.properties.loop = !!v; }, { property: 'loop' });
        this._seq = 0; this._raf = 0;
        _color(this, 'anim'); _fit(this);
    }
    CursorPlay.title = 'Cursor Play';
    CursorPlay.desc  = 'Moves the cursor from "from" to "to" over the given time: emits change at every step, done at the end, and publishes the final position on the bus. Used to drive other panels (e.g. phases in TJS). ' + CTX_HELP;
    CursorPlay.error_output = true;
    CursorPlay.portHelp = {
        inputs: {
            trigger: 'event — starts (a new start begins again from the beginning)',
            stop:    'event — stops where it is (without done)',
            from:    'number — start time, ms UTC; not connected = start of the view',
            to:      'number — end time, ms UTC; not connected = end of the view',
        },
        outputs: {
            done:   'event — reached "to" (never fires with loop)',
            change: 'event — at every step (about 60 per second); the bus does NOT receive every step, only the final position',
            time:   'number — current position, ms UTC',
            error:  ERR('from/to are not numbers'),
        },
        properties: { duration: 'duration of the run in seconds', loop: 'starts again from "from" at the end of the run' },
    };
    CursorPlay.prototype._halt = function () {
        this._seq++;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
    };
    CursorPlay.prototype.onAction = function (action) {
        const ctx = _ctx(this);
        if (action === 'stop') { this._halt(); return; }
        if (!ctx) return;
        this.clearError?.();
        this._halt();
        const w = ctx.getWindow();
        const from = Number(_in(this, 'from') ?? w.start);
        const to   = Number(_in(this, 'to') ?? w.end);
        if (!Number.isFinite(from) || !Number.isFinite(to)) { this.triggerError?.(new Error('"from" and "to" must be times in ms')); return; }
        const seq = this._seq;
        const dur = Math.max(0.1, Number(this.properties.duration) || 10) * 1000;
        // t0 = primo fotogramma: il timestamp di requestAnimationFrame può precedere
        // performance.now() letto qui, e darebbe una frazione negativa
        let t0 = null;
        ctx.signal?.addEventListener('abort', () => this._halt(), { once: true });
        const step = (now) => {
            if (seq !== this._seq || !ctx.ready) return;
            if (t0 == null) t0 = now;
            let k = (now - t0) / dur;
            if (k >= 1 && this.properties.loop) { t0 = now; k = 0; }
            k = Math.max(0, Math.min(1, k));
            const t = from + (to - from) * k;
            try { ctx.setCursor(t, { emit: k >= 1, byUser: false }); }
            catch (err) { this.triggerError?.(err); return; }
            _out(this, 'time', t);
            _fire(this, 'change');
            if (k >= 1) { this._raf = 0; _fire(this, 'done'); return; }
            this._raf = requestAnimationFrame(step);
        };
        this._raf = requestAnimationFrame(step);
    };
    CursorPlay.prototype.onStop = function () { this._halt(); };
    CursorPlay.prototype.onRemoved = CursorPlay.prototype.onStop;
    reg('TML/Cursor/Play', CursorPlay);

    // ═════════════════════════════════════════════════════════════════════════
    // TML/Data, TML/Theme
    // ═════════════════════════════════════════════════════════════════════════

    function DataLoad() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('data', 'object');
        this.addOutput('done', LG.EVENT);
        this.addOutput('count', 'number');
        _color(this, 'create'); _fit(this, 170);
    }
    DataLoad.title = 'Data Load';
    DataLoad.desc  = 'Replaces all the data of the timeline (does not save the model file). ' + CTX_HELP;
    DataLoad.portHelp = {
        inputs: {
            trigger: 'event — loads',
            data:    'object { groups: [ { id, content, class, order, nested, open, visible, layer } ], items: [ item with start/end in ms and layer ] } — ids already combined with the layer ("rossi:cesare") stay as they are',
        },
        outputs: {
            done:  'event — data loaded (invalid items are skipped and reported in the footer)',
            count: 'number — items loaded',
            error: ERR('"data" is not an object'),
        },
    };
    actionNode(DataLoad, function (ctx) { _out(this, 'count', ctx.loadData(_in(this, 'data'))); });
    reg('TML/Data/Load', DataLoad);

    function ThemeList() {
        this.addInput('trigger', LG.ACTION);
        this.addOutput('done', LG.EVENT);
        this.addOutput('themes', 'array');
        _color(this, 'get'); _fit(this, 170);
    }
    ThemeList.title = 'Theme List';
    ThemeList.desc  = 'Lists the model CSS files (mod_spec.css) and whether they are active. ' + CTX_HELP;
    ThemeList.portHelp = {
        inputs:  { trigger: 'event — lists' },
        outputs: { done: 'event — list ready', themes: 'array of { name, active } — name = file name', error: ERR('panel not ready') },
    };
    actionNode(ThemeList, function (ctx) { _out(this, 'themes', ctx.listThemes()); });
    reg('TML/Theme/List', ThemeList);

    function ThemeSetActive() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('name', 'string');
        this.addOutput('done', LG.EVENT);
        this.addProperty('active', true, 'boolean');
        this.addWidget('toggle', 'active', true, v => { this.properties.active = !!v; }, { property: 'active' });
        _color(this, 'set'); _fit(this, 170);
    }
    ThemeSetActive.title = 'Theme Set Active';
    ThemeSetActive.desc  = 'Turns one of the model CSS files on or off (e.g. an "exhibition" theme for a presentation). ' + CTX_HELP;
    ThemeSetActive.portHelp = {
        inputs:  { trigger: 'event — applies', name: 'string — file name, as in mod_spec.css (e.g. "mostra.css")' },
        outputs: { done: 'event — done', error: ERR('no CSS with this name in mod_spec.css') },
        properties: { active: 'on or off' },
    };
    actionNode(ThemeSetActive, function (ctx) { ctx.setThemeActive(_in(this, 'name'), this.properties.active); });
    reg('TML/Theme/SetActive', ThemeSetActive);

    // ═════════════════════════════════════════════════════════════════════════
    // TML/Date — calcolo puro, funziona ovunque
    // ═════════════════════════════════════════════════════════════════════════

    function DateParse() {
        this.addInput('text', 'string');
        this.addOutput('time', 'number');
        this.addOutput('precision', 'string');
        _color(this, 'calc'); _fit(this, 170);
    }
    DateParse.title = 'Date Parse';
    DateParse.desc  = 'Reads a historical date written as in the timeline data ("-753-04-21", "1492", "1492-10-12T14:30"). Works anywhere.';
    DateParse.portHelp = {
        inputs:  { text: 'string — YYYY, YYYY-MM, YYYY-MM-DD, YYYY-MM-DDTHH:mm; negative year = BC (-753 = 753 BC), year 0 does not exist' },
        outputs: {
            time:      'number — ms UTC; null if the date is not valid',
            precision: 'string — year, month, day, minute or second (how precise the written date was)',
        },
    };
    DateParse.prototype.onExecute = function () {
        const r = D.tryParseHistDate(_in(this, 'text'));
        _out(this, 'time', r?.ms ?? null);
        _out(this, 'precision', r?.precision ?? null);
    };
    reg('TML/Date/Parse', DateParse);

    function DateFormat() {
        this.addInput('time', 'number');
        this.addOutput('text', 'string');
        this.addProperty('precision', 'day', 'string');
        this.addProperty('era', 'auto', 'string');
        this.addWidget('combo', 'precision', 'day', v => { this.properties.precision = v; }, { values: D.PRECISIONS, property: 'precision' });
        this.addWidget('combo', 'era', 'auto', v => { this.properties.era = v; }, { values: ['auto', 'always', 'never'], property: 'era' });
        _color(this, 'calc'); _fit(this);
    }
    DateFormat.title = 'Date Format';
    DateFormat.desc  = 'Writes a time as a readable date in Italian ("753 a.C.", "12 ottobre 1492"). Works anywhere.';
    DateFormat.portHelp = {
        inputs:  { time: 'number — ms UTC' },
        outputs: { text: 'string — readable date (Italian); empty if time is missing' },
        properties: {
            precision: 'year, month, day, minute, second',
            era:       'auto = "a.C." only before Christ; always = also "d.C."; never = signed year (-753)',
        },
    };
    DateFormat.prototype.onExecute = function () {
        const t = _in(this, 'time');
        _out(this, 'text', t == null || t === '' ? '' : D.formatHistDate(Number(t), this.properties.precision, this.properties.era, this.properties.era === 'always'));
    };
    reg('TML/Date/Format', DateFormat);

    function DateFromParts() {
        this.addInput('year', 'number');
        this.addInput('month', 'number');
        this.addInput('day', 'number');
        this.addOutput('time', 'number');
        _color(this, 'calc'); _fit(this, 170);
    }
    DateFromParts.title = 'Date From Parts';
    DateFromParts.desc  = 'Builds a time from (historical) year, month and day. Works anywhere.';
    DateFromParts.portHelp = {
        inputs: {
            year:  'number — historical year: -753 = 753 BC; 0 does not exist',
            month: 'number — 1–12; empty = 1',
            day:   'number — 1–31; empty = 1',
        },
        outputs: { time: 'number — ms UTC; null if the date does not exist' },
    };
    DateFromParts.prototype.onExecute = function () {
        const y = _in(this, 'year');
        let t = null;
        if (y != null && y !== '') {
            try { t = D.fromParts(Number(y), _in(this, 'month') ?? 1, _in(this, 'day') ?? 1); } catch { t = null; }
        }
        _out(this, 'time', t);
    };
    reg('TML/Date/FromParts', DateFromParts);

    function DateToParts() {
        this.addInput('time', 'number');
        this.addOutput('year', 'number');
        this.addOutput('month', 'number');
        this.addOutput('day', 'number');
        _color(this, 'calc'); _fit(this, 170);
    }
    DateToParts.title = 'Date To Parts';
    DateToParts.desc  = 'Splits a time into (historical) year, month and day. Works anywhere.';
    DateToParts.portHelp = {
        inputs:  { time: 'number — ms UTC' },
        outputs: { year: 'number — historical year (-753 = 753 BC)', month: 'number — 1–12', day: 'number — 1–31' },
    };
    DateToParts.prototype.onExecute = function () {
        const t = _in(this, 'time');
        const p = t == null || t === '' ? null : D.toParts(Number(t));
        _out(this, 'year', p?.year ?? null); _out(this, 'month', p?.month ?? null); _out(this, 'day', p?.day ?? null);
    };
    reg('TML/Date/ToParts', DateToParts);
}
