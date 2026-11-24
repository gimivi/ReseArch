// app/FLE_sub_modules/FLE-loop-nodes.mjs
// Cicli per la preparazione dei dati nei flow (2026-10-03):
//   Flow/Loop/For Each — scorre un array
//   Flow/Loop/Repeat   — contatore da/a/passo
//   Flow/Loop/While    — ripete finché la condizione è vera
//   Flow/Loop/Collect  — raccoglie i valori dei giri in un array
//   Params/Array/Series — genera una serie numerica (inizio, incremento, quanti)
//   Params/Array/Accumulate — lista che cresce a ogni trigger, con etichette e colori (2026-11-22)
//
// Tutti i cicli partono da un 'trigger' e segnalano la fine con 'done', che è
// sempre la PRIMA uscita (convenzione dei nodi FLE, 2026-10-04).
// Nessuno contiene codice scritto dall'utente: non sono nodi critici (niente
// validazione dei flow).
//
// ── Come funziona un giro (LiteGraph 0.7.18) ──────────────────────────────────
// Gli EVENTI sono sincroni: triggerSlot('loop') esegue SUBITO, a ogni giro, i
// nodi a valle collegati per evento (Script, Collect, nodi con 'trigger'...).
// I DATI invece si ricalcolano una volta per ciclo del grafo: un nodo di calcolo
// (Formula, somma, Vector...) messo tra 'item' e lo Script darebbe il valore del
// giro precedente. Per questo, prima di ogni 'loop', il nodo ricalcola i nodi di
// dati che dipendono dalle sue uscite (_refreshDownstreamData), in ordine di
// esecuzione. Si può disattivare con la property refreshData.
//
// ── Eventi rimandati (LiteGraph.use_deferred_actions) ─────────────────────────
// In LiteGraph 0.7.18 use_deferred_actions vale true di default: un evento
// diretto a un nodo che ha ANCHE onExecute viene accodato e eseguito al giro
// successivo del grafo, non subito. Per un ciclo sarebbe un errore silenzioso
// (il corpo girerebbe dopo, tutto insieme, con i dati dell'ultimo giro). Per
// questo ogni ciclo esegue i propri giri dentro _sync(), che disattiva il
// rinvio per la durata del ciclo e lo ripristina subito dopo: tutta la catena
// del corpo (anche più nodi a valle) avviene giro per giro. Collect non ha
// onExecute, quindi non viene mai rimandato.
//
// ── Sicurezza ─────────────────────────────────────────────────────────────────
// Un ciclo sincrono infinito blocca la pagina: ogni ciclo ha maxIterations.
// While può anche girare "un giro per frame" (asincrono), per cicli lunghi.
// L'ingresso 'stop' ferma il ciclo dopo il giro in corso.

export function registerLoopNodes(LG) {
    if (!LG || LG.registered_node_types['Flow/Loop/For Each']) return;

    const EVENT  = LG.EVENT;
    const ACTION = LG.ACTION;
    const COLOR   = '#1f2937';   // famiglia Instradamento (Flow), tassonomia §10
    const BGCOLOR = '#374151';
    const MAX_DEFAULT = 100000;

    // ─── helper comuni ───────────────────────────────────────────────────────
    function _out(node, name, value) {
        const i = node.findOutputSlot(name);
        if (i !== -1) node.setOutputData(i, value);
    }
    function _trigger(node, name, param) {
        const i = node.findOutputSlot(name);
        if (i !== -1) node.triggerSlot(i, param);
    }
    function _in(node, name) {
        const i = node.findInputSlot(name);
        return i === -1 ? undefined : node.getInputData(i);
    }
    /** Valore da ingresso collegato, altrimenti dalla property. */
    function _num(node, name, prop) {
        const v = Number(_in(node, name) ?? node.properties[prop]);
        return Number.isFinite(v) ? v : Number(node.properties[prop]) || 0;
    }

    /**
     * Ricalcola i nodi di DATI raggiungibili dalle uscite di dati di `node`
     * (fili non-evento), nell'ordine di esecuzione del grafo — così i nodi
     * del corpo del ciclo leggono i valori del giro corrente.
     */
    function _refreshDownstreamData(node) {
        const graph = node.graph;
        if (!graph || !node.properties.refreshData) return;
        const reach = new Set();
        const stack = [node];
        while (stack.length) {
            const n = stack.pop();
            for (const out of n.outputs ?? []) {
                if (out.type === EVENT || !out.links) continue;
                for (const linkId of out.links) {
                    const link = graph.links[linkId];
                    const t = link && graph.getNodeById(link.target_id);
                    if (t && t !== node && !reach.has(t)) { reach.add(t); stack.push(t); }
                }
            }
        }
        if (!reach.size) return;
        const order = graph._nodes_in_order?.length ? graph._nodes_in_order : graph._nodes;
        for (const n of order) {
            if (!reach.has(n) || !n.onExecute) continue;
            if (n.mode !== undefined && n.mode !== LG.ALWAYS) continue;   // nodi disattivati/bypass
            try { n.onExecute(); } catch (e) { console.error('[Flow/Loop] ricalcolo dati:', n.type, e); }
        }
    }

    /** Esegue fn con gli eventi sincroni (vedi "Eventi rimandati" in testa al file). */
    function _sync(fn) {
        const prev = LG.use_deferred_actions;
        LG.use_deferred_actions = false;
        try { return fn(); } finally { LG.use_deferred_actions = prev; }
    }

    function _commonProps(node) {
        node.addProperty('maxIterations', MAX_DEFAULT, 'number');
        node.addProperty('refreshData', true, 'boolean');
    }
    const COMMON_HELP_IN = {
        trigger: "Trigger (ACTION): starts the loop. While the loop is running, a new trigger is ignored.",
        stop:    "Trigger (ACTION): stops the loop after the current iteration (then 'done' is fired anyway).",
    };
    const COMMON_HELP_OUT = {
        loop: "EVENT fired at EVERY iteration: connect it to the nodes of the loop body (Script, Collect 'add', nodes with trigger). It is synchronous: the next iteration starts when the body has finished.",
        done: "EVENT fired at the end of the loop (also if stopped or if the iteration limit was reached). Parameter: number of iterations run.",
    };
    const COMMON_DESC =
        " Connect the loop body to the 'loop' event; the computation nodes between the loop outputs and the body are " +
        "recomputed at every iteration (property refreshData). Safety limit: property maxIterations.";

    // ─── Flow/Loop/For Each ──────────────────────────────────────────────────
    function ForEach() {
        this.addInput('trigger',    ACTION);
        this.addInput('array',      'array');
        this.addInput('stop',       ACTION);
        this.addOutput('done',      EVENT);
        this.addOutput('loop',      EVENT);
        this.addOutput('item',      0);
        this.addOutput('index',     'number');
        this.addOutput('count',     'number');
        _commonProps(this);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 110];
        this._running = false; this._stop = false;
    }
    ForEach.title = 'For Each';
    ForEach.desc  = "Iterates over an array: for each element sets item and index and fires 'loop'; at the end 'done'." + COMMON_DESC;
    ForEach.portHelp = {
        inputs:  { ...COMMON_HELP_IN, array: "The array to iterate over (a non-array value is treated as a one-element array; null = no iteration)." },
        outputs: { ...COMMON_HELP_OUT, item: "The element of the current iteration.", index: "Index (0-based) of the current iteration.", count: "Number of elements in the array." },
    };
    ForEach.prototype.onAction = function (action) {
        if (action === 'stop') { this._stop = true; return; }
        if (action !== 'trigger' || this._running) return;
        let arr = _in(this, 'array');
        if (arr == null) arr = [];
        else if (!Array.isArray(arr)) arr = [arr];
        const max = Math.max(0, Math.floor(this.properties.maxIterations));
        _out(this, 'count', arr.length);
        this._running = true; this._stop = false;
        let n = 0;
        _sync(() => {
            try {
                for (let i = 0; i < arr.length && n < max && !this._stop; i++, n++) {
                    _out(this, 'item', arr[i]);
                    _out(this, 'index', i);
                    _refreshDownstreamData(this);
                    _trigger(this, 'loop', arr[i]);
                }
                if (n >= max && n < arr.length) console.warn(`[For Each] limite maxIterations (${max}) raggiunto: elaborati ${n} di ${arr.length}`);
            } finally {
                this._running = false;
            }
            _trigger(this, 'done', n);
        });
    };
    LG.registerNodeType('Flow/Loop/For Each', ForEach);

    // ─── Flow/Loop/Repeat ────────────────────────────────────────────────────
    function Repeat() {
        this.addProperty('from', 0, 'number');
        this.addProperty('to', 9, 'number');
        this.addProperty('step', 1, 'number');
        this.addWidget('number', 'from', 0, v => { this.properties.from = v; }, { property: 'from' });
        this.addWidget('number', 'to',   9, v => { this.properties.to = v; },   { property: 'to' });
        this.addWidget('number', 'step', 1, v => { this.properties.step = v; }, { property: 'step' });
        this.addInput('trigger',    ACTION);
        this.addInput('from',       'number');
        this.addInput('to',         'number');
        this.addInput('step',       'number');
        this.addInput('stop',       ACTION);
        this.addOutput('done',      EVENT);
        this.addOutput('loop',      EVENT);
        this.addOutput('i',         'number');
        _commonProps(this);
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [190, 170];
        this._running = false; this._stop = false;
    }
    Repeat.title = 'Repeat';
    Repeat.desc  = "For loop: i goes from 'from' to 'to' (inclusive) by 'step' (negative allowed, never 0). At every iteration sets i and fires 'loop'; at the end 'done'." + COMMON_DESC +
        " To build an array: loop → Collect 'add', i → (calculations) → Collect 'value', done → Collect 'deliver'. " +
        "Prefer values computed from i to nodes that keep a memory (Counter, Accumulate, Var Set): these do not restart at the next run. " +
        "Example, staircase points: x = floor((i+1)/2)·stepX, y = floor(i/2)·stepY with Operation and Floor, then Object Vec3 → Collect 'value'. " +
        "Grid: connect loop to the trigger of a second Repeat, the loop of the second one to Collect 'add' and done of the FIRST one to 'deliver'.";
    Repeat.portHelp = {
        inputs:  { ...COMMON_HELP_IN, from: "Start value (overrides the widget).", to: "End value, inclusive (overrides the widget).", step: "Increment at every iteration, negative allowed; 0 is not allowed (overrides the widget)." },
        outputs: { ...COMMON_HELP_OUT, i: "Counter value in the current iteration." },
    };
    Repeat.prototype.onAction = function (action) {
        if (action === 'stop') { this._stop = true; return; }
        if (action !== 'trigger' || this._running) return;
        const from = _num(this, 'from', 'from'), to = _num(this, 'to', 'to'), step = _num(this, 'step', 'step');
        const max = Math.max(0, Math.floor(this.properties.maxIterations));
        let n = 0;
        _sync(() => {
        if (step === 0) {
            console.warn('[Repeat] step = 0: nessun giro');
        } else {
            this._running = true; this._stop = false;
            // tolleranza per i passi decimali (es. 0.1): evita di perdere l'ultimo valore
            const eps = Math.abs(step) * 1e-9;
            try {
                for (let k = 0; n < max && !this._stop; k++, n++) {
                    const i = from + k * step;   // moltiplicazione, non somme ripetute: niente accumulo di errore
                    if (step > 0 ? i > to + eps : i < to - eps) break;
                    _out(this, 'i', i);
                    _refreshDownstreamData(this);
                    _trigger(this, 'loop', i);
                }
                if (n >= max) console.warn(`[Repeat] limite maxIterations (${max}) raggiunto`);
            } finally {
                this._running = false;
            }
        }
        _trigger(this, 'done', n);
        });
    };
    LG.registerNodeType('Flow/Loop/Repeat', Repeat);

    // ─── Flow/Loop/While ─────────────────────────────────────────────────────
    function While() {
        this.addProperty('mode', 'sync', 'enum', { values: ['sync', 'per frame'] });
        this.addWidget('combo', 'mode', 'sync', v => { this.properties.mode = v; },
            { property: 'mode', values: ['sync', 'per frame'] });
        this.addInput('trigger',    ACTION);
        this.addInput('condition',  'boolean');
        this.addInput('stop',       ACTION);
        this.addOutput('done',      EVENT);
        this.addOutput('loop',      EVENT);
        this.addOutput('index',     'number');
        _commonProps(this);
        this.properties.maxIterations = 10000;
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [210, 110];
        this._running = false; this._stop = false; this._raf = null;
    }
    While.title = 'While';
    While.desc  = "Repeats 'loop' while 'condition' is true (checked BEFORE every iteration, after recomputing the data nodes: " +
        "the condition can depend on 'index' or on what the body did, e.g. through Params/Variables). " +
        "Mode 'per frame': does not block the page, suited to long loops; 'sync': faster." + COMMON_DESC;
    While.portHelp = {
        inputs:  { ...COMMON_HELP_IN, condition: "Boolean: the loop goes on while it is true. Not connected = false (no iteration)." },
        outputs: { ...COMMON_HELP_OUT, index: "Number (0-based) of the current iteration." },
    };
    While.prototype._check = function () {
        _refreshDownstreamData(this);
        // la condizione può essere calcolata a valle di 'index': chiede il ricalcolo anche al nodo a monte
        const i = this.findInputSlot('condition');
        return !!(i !== -1 && this.getInputData(i, true));
    };
    While.prototype._finish = function (n) {
        this._running = false; this._raf = null;
        _sync(() => _trigger(this, 'done', n));
    };
    While.prototype.onAction = function (action) {
        if (action === 'stop') { this._stop = true; return; }
        if (action !== 'trigger' || this._running) return;
        const max = Math.max(0, Math.floor(this.properties.maxIterations));
        this._running = true; this._stop = false;
        let n = 0;
        if (this.properties.mode === 'per frame') {
            const step = () => {
                if (!this.graph || this._stop || n >= max) { if (n >= max) console.warn(`[While] limite maxIterations (${max}) raggiunto`); return this._finish(n); }
                _out(this, 'index', n);
                if (!this._check()) return this._finish(n);
                _sync(() => _trigger(this, 'loop', n));
                n++;
                this._raf = requestAnimationFrame(step);
            };
            step();
            return;
        }
        _sync(() => {
            try {
                while (n < max && !this._stop) {
                    _out(this, 'index', n);
                    if (!this._check()) break;
                    _trigger(this, 'loop', n);
                    n++;
                }
                if (n >= max) console.warn(`[While] limite maxIterations (${max}) raggiunto`);
            } finally {
                this._running = false;
            }
            _trigger(this, 'done', n);
        });
    };
    While.prototype.onStop = function () {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null; this._running = false;
    };
    While.prototype.onRemoved = While.prototype.onStop;
    LG.registerNodeType('Flow/Loop/While', While);

    // ─── Flow/Loop/Collect ───────────────────────────────────────────────────
    function Collect() {
        this.addProperty('clearAfterDeliver', true, 'boolean');
        this.addInput('add',     ACTION);
        this.addInput('value',   0);
        this.addInput('deliver', ACTION);
        this.addInput('clear',   ACTION);
        this.addOutput('done',   EVENT);
        this.addOutput('array',  'array');
        this.addOutput('count',  'number');
        this.color = COLOR; this.bgcolor = BGCOLOR;
        this.size  = [180, 100];
        this._buf = [];
    }
    Collect.title = 'Collect';
    Collect.desc  = "Collects the values of the iterations of a loop into an array. Typical pattern: loop → (body) → Collect 'add'; calculated value → Collect 'value'; done of the loop → Collect 'deliver'; done of Collect → trigger of the node that uses the array. " +
        "The position in the array is the order of the 'add' events: no index needed. " +
        "On deliver it outputs the array and fires 'done', then (property clearAfterDeliver) starts again empty for the next loop.";
    Collect.portHelp = {
        inputs: {
            add:     "Trigger (ACTION): adds to the list the value on 'value' (or, if not connected, the event parameter).",
            value:   "The value to add at every 'add' (any type).",
            deliver: "Trigger (ACTION): publishes the collected list on 'array' and fires 'done'.",
            clear:   "Trigger (ACTION): empties the list without delivering it.",
        },
        outputs: {
            done:  "EVENT fired on deliver, after updating 'array'. Parameter: the array.",
            array: "Array of the collected values (copy), updated on deliver.",
            count: "Number of values collected so far.",
        },
    };
    Collect.prototype.onAction = function (action, param) {
        if (action === 'add') {
            const i = this.findInputSlot('value');
            const linked = i !== -1 && this.inputs[i].link != null;
            this._buf.push(linked ? this.getInputData(i) : param);
            _out(this, 'count', this._buf.length);
        } else if (action === 'deliver') {
            const arr = this._buf.slice();
            if (this.properties.clearAfterDeliver) this._buf = [];
            _out(this, 'array', arr);
            _out(this, 'count', this._buf.length);
            _trigger(this, 'done', arr);
        } else if (action === 'clear') {
            this._buf = [];
            _out(this, 'count', 0);
        }
    };
    // Niente onExecute, di proposito: con use_deferred_actions un nodo che ce l'ha
    // riceverebbe add/deliver al giro successivo del grafo (vedi testa del file).
    LG.registerNodeType('Flow/Loop/Collect', Collect);

    // ─── Params/Array/Series ─────────────────────────────────────────────────
    function Series() {
        this.addProperty('start', 0, 'number');
        this.addProperty('increment', 1, 'number');
        this.addProperty('count', 10, 'number');
        this.addWidget('number', 'start',     0,  v => { this.properties.start = v; },     { property: 'start' });
        this.addWidget('number', 'increment', 1,  v => { this.properties.increment = v; }, { property: 'increment' });
        this.addWidget('number', 'count',     10, v => { this.properties.count = Math.max(0, Math.floor(v)); }, { property: 'count', precision: 0, step: 10 });
        this.addInput('trigger',   ACTION);
        this.addInput('start',     'number');
        this.addInput('increment', 'number');
        this.addInput('count',     'number');
        this.addOutput('done', EVENT);
        this.addOutput('array', 'array');
        this.addProperty('maxValues', 1000000, 'number');
        this.color   = '#1a2a4a';   // famiglia Get / dati
        this.bgcolor = '#1e3a5f';
        this.size    = [200, 150];
    }
    Series.title = 'Series';
    Series.desc  = "Generates a numeric series: 'count' values starting from 'start', each increased by 'increment' (negative or decimal allowed). " +
        "Example: start 0, increment 0.5, count 5 → [0, 0.5, 1, 1.5, 2]. The array is always up to date; with 'trigger' 'done' is fired too.";
    Series.portHelp = {
        inputs: {
            trigger:   "Trigger (ACTION, optional): recomputes the series and fires 'done' — handy in data preparation chains.",
            start:     "First value (overrides the widget).",
            increment: "Difference between a value and the next one (overrides the widget).",
            count:     "How many values to generate, integer ≥ 0 (overrides the widget). Safety limit: property maxValues.",
        },
        outputs: {
            done:  "EVENT fired after the trigger, with the array as parameter.",
            array: "Array of the generated values.",
        },
    };
    Series.prototype._compute = function () {
        const start = _num(this, 'start', 'start');
        const inc   = _num(this, 'increment', 'increment');
        let count   = Math.max(0, Math.floor(_num(this, 'count', 'count')));
        const max   = Math.max(0, Math.floor(this.properties.maxValues));
        if (count > max) { console.warn(`[Series] count (${count}) oltre maxValues (${max}): troncato`); count = max; }
        const key = `${start}|${inc}|${count}`;
        if (key !== this._key) {   // ricalcola solo se cambiano i parametri
            this._key = key;
            // inizio + k*incremento (non somme ripetute): niente accumulo di errore sui decimali
            this._arr = Array.from({ length: count }, (_, k) => start + k * inc);
        }
        _out(this, 'array', this._arr);
        return this._arr;
    };
    Series.prototype.onExecute = function () { this._compute(); };
    Series.prototype.onAction  = function () { _trigger(this, 'done', this._compute()); };
    LG.registerNodeType('Params/Array/Series', Series);

    // ─── Params/Array/Accumulate (2026-11-22) ────────────────────────────────
    // Tiene una lista che cresce a ogni 'trigger' (es. i punti cliccati su una mappa) e
    // la riconsegna intera; 'clear' la svuota. Agli oggetti può dare un'etichetta
    // progressiva (P1, P2…) e un colore da una tavolozza, così segnaposti e serie di un
    // grafico si riconoscono. Niente onExecute: con use_deferred_actions trigger e clear
    // arriverebbero al giro successivo del grafo (vedi testa del file).
    function Accumulate() {
        this.addInput('trigger', ACTION);
        this.addInput('item',    0);
        this.addInput('clear',   ACTION);
        this.addOutput('done',  EVENT);
        this.addOutput('items', 'array');
        this.addOutput('count', 'number');
        this.addOutput('last',  0);
        this.addOutput('full',  EVENT);
        this.addProperty('max', 0, 'number');
        this.addProperty('label_field', '', 'string');
        this.addProperty('label_prefix', 'P', 'string');
        this.addProperty('colors', '', 'string');
        this.addWidget('number', 'max', 0, v => { this.properties.max = Math.max(0, Math.round(Number(v) || 0)); }, { min: 0, max: 10000, step: 10, precision: 0, property: 'max' });
        this.addWidget('text', 'label_field', '', v => { this.properties.label_field = String(v ?? '').trim(); }, { property: 'label_field' });
        this.addWidget('text', 'label_prefix', 'P', v => { this.properties.label_prefix = String(v ?? ''); }, { property: 'label_prefix' });
        this.addWidget('text', 'colors', '', v => { this.properties.colors = String(v ?? '').replace(/\s+/g, ''); }, { property: 'colors' });
        this._items = [];
        this.color   = '#1e3a5f';   // famiglia Calcolo
        this.bgcolor = '#1e40af';
        this.size    = [240, 214];
    }
    Accumulate.title = 'Accumulate';
    Accumulate.desc  = "Keeps a list that grows at every 'trigger' (e.g. the points clicked on a map) and gives it back whole at every change; 'clear' empties it. " +
        "Objects can get a progressive label (P1, P2…) and a color from a palette, so that markers and chart series match. The list lives while the flow runs (not saved).";
    Accumulate.portHelp = {
        inputs: {
            trigger: "event — adds 'item' to the list",
            item:    "any — the value to add; objects are copied (the original is not changed)",
            clear:   "event — empties the list (and restarts the labels from 1)",
        },
        outputs: {
            done:  "event — after every change: item added or list emptied",
            items: "array — the whole list, oldest first (a new array at every change)",
            count: "number — items in the list",
            last:  "any — the item just added, with label and color; null after clear",
            full:  "event — 'max' reached: the item was NOT added (clear first)",
        },
        properties: {
            max:          "maximum number of items, 0 = no limit",
            label_field:  "objects only: field that gets the label (e.g. \"label\"); empty = no label",
            label_prefix: "text before the order number: \"P\" → P1, P2…",
            colors:       "objects only: CSS colors separated by commas (e.g. \"#d9480f,#1c7ed6\"), given in turn in the \"color\" field; empty = no color. Use the same list for the chart colors",
        },
    };
    Accumulate.prototype.onAction = function (action) {
        if (action === 'clear') {
            this._items = [];
            this._emit(null);
            return;
        }
        const p = this.properties;
        const max = Math.max(0, Math.round(Number(p.max) || 0));
        if (max && this._items.length >= max) { _trigger(this, 'full'); return; }
        let item = _in(this, 'item');
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            item = { ...item };
            const n = this._items.length + 1;
            if (p.label_field) item[p.label_field] = `${p.label_prefix ?? ''}${n}`;
            const colors = String(p.colors ?? '').split(',').map(s => s.trim()).filter(Boolean);
            if (colors.length) item.color = colors[(n - 1) % colors.length];
        }
        this._items = [...this._items, item];
        this._emit(item);
    };
    Accumulate.prototype._emit = function (last) {
        _out(this, 'items', this._items);
        _out(this, 'count', this._items.length);
        _out(this, 'last', last);
        _trigger(this, 'done');
    };
    Accumulate.prototype.onStart = function () { this._items = []; };
    LG.registerNodeType('Params/Array/Accumulate', Accumulate);
}
