// app/FLE_sub_modules/FLE-signal-nodes.mjs
// Trattamento dei valori dei sensori (2026-10-12) — _doc/arch-iot-dispositivi.md §6 (passo 2)
//
//   IoT/Smooth     — toglie il tremolio: media esponenziale o media mobile
//   IoT/Map Range  — porta un intervallo in un altro (0-1023 del potenziometro → 0-360°)
//   IoT/Throttle   — al più N valori al secondo, sempre l'ultimo (mai in coda)
//   IoT/Calibrate  — memorizza uno zero e lo sottrae (potenziometro al centro, inclinazione a riposo)
//
// Non dipendono dai dispositivi: vanno bene anche per altre sorgenti (slider, mouse, App Bus).
// Valori: un numero, oppure un array di numeri trattato elemento per elemento (es. acc=x,y,z).
//
// Regole dei nodi: _doc/guide-fle-regole-nodi.md

const SMOOTH_MODES = ['exponential', 'moving average'];

/** Numero o array di numeri (finiti), altrimenti null. */
function asSignal(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (Array.isArray(v) && v.length && v.every(x => typeof x === 'number' && Number.isFinite(x))) return v;
    return null;
}
/** Applica f elemento per elemento (numero o array); b può essere numero, array o null. */
function zip(a, b, f) {
    if (Array.isArray(a)) return a.map((x, i) => f(x, Array.isArray(b) ? (b[i] ?? 0) : (b ?? 0), i));
    return f(a, Array.isArray(b) ? (b[0] ?? 0) : (b ?? 0), 0);
}
/** Stessa forma (entrambi numeri, o array della stessa lunghezza). */
function sameShape(a, b) {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    return !Array.isArray(a) || a.length === b.length;
}
const SIGNAL_HELP = 'number, or array of numbers (each element treated separately, e.g. acc = x,y,z)';

function drawText(node, ctx2d, text) {
    if (!text || node.research_error || node.flags.collapsed) return;
    ctx2d.save();
    ctx2d.font = '9px monospace';
    ctx2d.fillStyle = 'rgba(255,255,255,0.45)';
    const max = Math.max(10, Math.floor((node.size[0] - 12) / 5.4));
    ctx2d.fillText(text.length > max ? text.slice(0, max - 1) + '…' : text, 6, node.size[1] - 6);
    ctx2d.restore();
}
function fmt(v) {
    const r = (x) => Math.round(x * 1000) / 1000;
    return Array.isArray(v) ? v.map(r).join(', ') : String(r(v));
}
/** Scrive value, ridisegna al più 10 volte al secondo, emette done (dopo i dati). */
function emit(node, v) {
    node.setOutputData(node.findOutputSlot('value'), v);
    node._status = fmt(v);
    if (!node._redrawTimer) node._redrawTimer = setTimeout(() => { node._redrawTimer = null; node.setDirtyCanvas?.(true, false); }, 100);
    node.triggerSlot(node.findOutputSlot('done'));
}
function readValue(node) {
    const v = asSignal(node.getInputData(node.findInputSlot('value')));
    if (v == null) node.triggerError?.(new Error('"value" must be a number or an array of numbers'));
    return v;
}

export function registerSignalNodes(LG) {
    if (!LG) return;

    // ─────────────────────────────────────────────────────────────────────────
    // IoT/Smooth
    // ─────────────────────────────────────────────────────────────────────────
    function IoTSmooth() {
        this.addProperty('mode',   'exponential', 'string');
        this.addProperty('alpha',  0.3,           'number');
        this.addProperty('window', 5,             'number');
        this.addWidget('combo',  'mode',   'exponential', v => { this.properties.mode = v; this._reset(); }, { values: SMOOTH_MODES, property: 'mode' });
        this.addWidget('number', 'alpha',  0.3, v => { this.properties.alpha = Math.min(1, Math.max(0.01, v)); }, { min: 0.01, max: 1, step: 0.05, precision: 2, property: 'alpha' });
        this.addWidget('number', 'window', 5,   v => { this.properties.window = Math.max(1, Math.round(v)); this._reset(); }, { min: 1, max: 200, step: 1, precision: 0, property: 'window' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('reset',   LG.ACTION);
        this.addInput('value',   0);
        this.addOutput('done',  LG.EVENT);
        this.addOutput('value', 0);
        this._reset();
        this._status = '';
        this.color   = '#1e3a5f';   // famiglia Calcolo
        this.bgcolor = '#1e40af';
        this.size    = [220, 130];
    }
    IoTSmooth.error_output = true;
    IoTSmooth.title = 'IoT Smooth';
    IoTSmooth.desc  = 'Smooths a value that trembles (potentiometer, accelerometer): exponential average or moving average of the last values. Smoother = slower to follow';
    IoTSmooth.portHelp = {
        inputs: {
            trigger: 'event — a new value has arrived (e.g. the done of IoT Receive)',
            reset:   'event — forgets the previous values: the next value passes as it is',
            value:   SIGNAL_HELP,
        },
        outputs: {
            done:  'event — smoothed value ready',
            value: 'the smoothed value, same form as the input (number or array)',
            error: 'event — "value" is not a number or an array of numbers. Port hidden by default: right click → Show error',
        },
        properties: {
            mode:   'exponential: each new value counts as much as "alpha" (no memory of a window, the usual choice) · moving average: average of the last "window" values',
            alpha:  'exponential only: weight of the new value, 0.01-1. 1 = no smoothing; 0.3 = moderate; 0.1 = strong but slow',
            window: 'moving average only: how many values to average',
        },
    };
    IoTSmooth.prototype._reset = function () { this._y = null; this._buf = []; };
    IoTSmooth.prototype.onAction = function (action) {
        if (action === 'reset') { this._reset(); return; }
        this.clearError?.();
        const x = readValue(this);
        if (x == null) return;
        let y;
        if (this.properties.mode === 'moving average') {
            if (this._buf.length && !sameShape(this._buf[0], x)) this._buf = [];
            this._buf.push(x);
            const n = Math.max(1, Math.round(this.properties.window || 1));
            while (this._buf.length > n) this._buf.shift();
            const k = this._buf.length;
            y = this._buf.reduce((acc, v) => zip(acc, v, (a, b) => a + b / k), zip(x, null, () => 0));
        } else {
            const a = Math.min(1, Math.max(0.01, Number(this.properties.alpha) || 0.3));
            y = (this._y == null || !sameShape(this._y, x)) ? x : zip(this._y, x, (prev, cur) => prev + a * (cur - prev));
        }
        this._y = y;
        emit(this, y);
    };
    IoTSmooth.prototype.onStop    = function () { this._reset(); };
    IoTSmooth.prototype.onRemoved = function () { clearTimeout(this._redrawTimer); };
    IoTSmooth.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('IoT/Smooth', IoTSmooth);


    // ─────────────────────────────────────────────────────────────────────────
    // IoT/Map Range
    // ─────────────────────────────────────────────────────────────────────────
    function IoTMapRange() {
        this.addProperty('in_min',   0,    'number');
        this.addProperty('in_max',   1023, 'number');
        this.addProperty('out_min',  0,    'number');
        this.addProperty('out_max',  360,  'number');
        this.addProperty('clamp',    true, 'boolean');
        this.addProperty('deadzone', 0,    'number');
        this.addWidget('number', 'in_min',   0,    v => { this.properties.in_min = v; },   { step: 10, precision: 3, property: 'in_min' });
        this.addWidget('number', 'in_max',   1023, v => { this.properties.in_max = v; },   { step: 10, precision: 3, property: 'in_max' });
        this.addWidget('number', 'out_min',  0,    v => { this.properties.out_min = v; },  { step: 10, precision: 3, property: 'out_min' });
        this.addWidget('number', 'out_max',  360,  v => { this.properties.out_max = v; },  { step: 10, precision: 3, property: 'out_max' });
        this.addWidget('toggle', 'clamp',    true, v => { this.properties.clamp = !!v; },  { property: 'clamp' });
        this.addWidget('number', 'deadzone', 0,    v => { this.properties.deadzone = Math.min(0.9, Math.max(0, v)); }, { min: 0, max: 0.9, step: 0.05, precision: 2, property: 'deadzone' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('value',   0);
        this.addOutput('done',  LG.EVENT);
        this.addOutput('value', 0);
        this._status = '';
        this.color   = '#1e3a5f';   // famiglia Calcolo
        this.bgcolor = '#1e40af';
        this.size    = [220, 210];
    }
    IoTMapRange.error_output = true;
    IoTMapRange.title = 'IoT Map Range';
    IoTMapRange.desc  = 'Converts a value from one range to another, e.g. 0-1023 of a potentiometer to 0-360 degrees. out_min greater than out_max inverts the direction';
    IoTMapRange.portHelp = {
        inputs: {
            trigger: 'event — converts the current value',
            value:   SIGNAL_HELP,
        },
        outputs: {
            done:  'event — converted value ready',
            value: 'the converted value, same form as the input',
            error: 'event — "value" is not a number or an array of numbers, or in_min = in_max. Port hidden by default: right click → Show error',
        },
        properties: {
            in_min:   'input value that becomes out_min (e.g. 0 for a potentiometer, -180 for an angle)',
            in_max:   'input value that becomes out_max (e.g. 1023 on ESP8266/Arduino with the serial-test sketch, 4095 on ESP32 read at 12 bits)',
            out_min:  'output value for in_min',
            out_max:  'output value for in_max (smaller than out_min = reversed direction)',
            clamp:    'on: values outside the input range stop at the ends of the output range',
            deadzone: 'share of the range around the center that gives exactly the center of the output, 0-0.9 (e.g. 0.1 for a joystick that does not return exactly to the middle); 0 = none',
        },
    };
    IoTMapRange.prototype.onAction = function () {
        this.clearError?.();
        const x = readValue(this);
        if (x == null) return;
        const { in_min, in_max, out_min, out_max, clamp } = this.properties;
        if (in_max === in_min) { this.triggerError?.(new Error('in_min and in_max must differ')); return; }
        const dz = Math.min(0.9, Math.max(0, Number(this.properties.deadzone) || 0));
        const map = (v) => {
            let t = (v - in_min) / (in_max - in_min);          // 0..1 nell'intervallo d'ingresso
            if (clamp) t = Math.min(1, Math.max(0, t));
            if (dz > 0) {
                // zona morta attorno al centro, il resto riscalato per non avere salti
                const c = t - 0.5, h = dz / 2;
                t = Math.abs(c) <= h ? 0.5 : 0.5 + Math.sign(c) * (Math.abs(c) - h) / (0.5 - h) * 0.5;
            }
            return out_min + t * (out_max - out_min);
        };
        emit(this, Array.isArray(x) ? x.map(map) : map(x));
    };
    IoTMapRange.prototype.onRemoved = function () { clearTimeout(this._redrawTimer); };
    IoTMapRange.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('IoT/Map Range', IoTMapRange);


    // ─────────────────────────────────────────────────────────────────────────
    // IoT/Throttle
    // ─────────────────────────────────────────────────────────────────────────
    function IoTThrottle() {
        this.addProperty('max_per_s', 30, 'number');
        this.addWidget('number', 'max_per_s', 30, v => { this.properties.max_per_s = Math.min(240, Math.max(0.1, v)); }, { min: 0.1, max: 240, step: 5, precision: 1, property: 'max_per_s' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('value',   0);
        this.addOutput('done',  LG.EVENT);
        this.addOutput('value', 0);
        this._last = -Infinity;   // il primo valore passa subito
        this._timer = null;
        this._held = undefined;
        this._status = '';
        this.color   = '#1f2937';   // famiglia Instradamento
        this.bgcolor = '#374151';
        this.size    = [210, 80];
    }
    IoTThrottle.title = 'IoT Throttle';
    IoTThrottle.desc  = 'Lets through at most N values per second: the values arriving in between are not queued, only the last one is given when its turn comes. To avoid overloading what follows (redraws, commands to a device)';
    IoTThrottle.portHelp = {
        inputs: {
            trigger: 'event — a new value has arrived',
            value:   'any value (number, array, text, object): passed through unchanged',
        },
        outputs: {
            done:  'event — a value passes: at once if enough time has passed since the previous one, otherwise when its turn comes (with the last value arrived)',
            value: 'the value let through, unchanged',
        },
        properties: {
            max_per_s: 'maximum number of values per second, 0.1-240 (e.g. 30 to follow a sensor smoothly, 5 for commands to a slow device)',
        },
    };
    IoTThrottle.prototype._pass = function (v) {
        this._last = performance.now();
        this.setOutputData(this.findOutputSlot('value'), v);
        this._status = v != null && typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (!this._redrawTimer) this._redrawTimer = setTimeout(() => { this._redrawTimer = null; this.setDirtyCanvas?.(true, false); }, 100);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    IoTThrottle.prototype.onAction = function () {
        const v = this.getInputData(this.findInputSlot('value'));
        const gap = 1000 / Math.max(0.1, Number(this.properties.max_per_s) || 30);
        const wait = gap - (performance.now() - this._last);
        if (wait <= 0 && !this._timer) { this._pass(v); return; }
        this._held = v;                     // si tiene solo l'ultimo
        if (this._timer) return;
        this._timer = setTimeout(() => {
            this._timer = null;
            const h = this._held;
            this._held = undefined;
            this._pass(h);
        }, Math.max(0, wait));
    };
    IoTThrottle.prototype.onStop    = function () { clearTimeout(this._timer); this._timer = null; this._held = undefined; };
    IoTThrottle.prototype.onRemoved = function () { this.onStop(); clearTimeout(this._redrawTimer); };
    IoTThrottle.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('IoT/Throttle', IoTThrottle);


    // ─────────────────────────────────────────────────────────────────────────
    // IoT/Calibrate
    // ─────────────────────────────────────────────────────────────────────────
    function IoTCalibrate() {
        this.addProperty('zero', '', 'string');
        this.addWidget('text', 'zero', '', v => { this.properties.zero = String(v ?? '').trim(); }, { property: 'zero' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('capture', LG.ACTION);
        this.addInput('value',   0);
        this.addOutput('done',  LG.EVENT);
        this.addOutput('value', 0);
        this._lastIn = null;
        this._status = '';
        this.color   = '#1e3a5f';   // famiglia Calcolo
        this.bgcolor = '#1e40af';
        this.size    = [220, 110];
    }
    IoTCalibrate.error_output = true;
    IoTCalibrate.title = 'IoT Calibrate';
    IoTCalibrate.desc  = 'Subtracts a stored zero from the value: "capture" stores the current value as zero (potentiometer in the middle, device lying still). The zero is saved with the flow';
    IoTCalibrate.portHelp = {
        inputs: {
            trigger: 'event — a new value has arrived: gives value minus zero',
            capture: 'event — the last value received becomes the zero (e.g. from a "Calibrate" button of a page). From now on that position gives 0',
            value:   SIGNAL_HELP + '. For an inclination, calibrate the angles (pitch, roll) and not the raw accelerations: subtracting the accelerations at rest would also remove gravity',
        },
        outputs: {
            done:  'event — calibrated value ready',
            value: 'value minus zero, same form as the input; with an empty zero the value passes unchanged',
            error: 'event — "value" is not a number or an array of numbers, or "capture" before any value. Port hidden by default: right click → Show error',
        },
        properties: {
            zero: 'the stored zero, as text: a number (512) or numbers separated by commas (1.5,-3.2); empty = no correction. Set by "capture" and saved with the flow; can also be written by hand',
        },
    };
    IoTCalibrate.prototype._zero = function () {
        const z = String(this.properties.zero ?? '').trim();
        if (!z) return null;
        const parts = z.split(',').map(p => Number(p.trim()));
        if (parts.some(n => !Number.isFinite(n))) return null;
        return parts.length === 1 ? parts[0] : parts;
    };
    IoTCalibrate.prototype.onAction = function (action) {
        this.clearError?.();
        if (action === 'capture') {
            if (this._lastIn == null) {
                const v = asSignal(this.getInputData(this.findInputSlot('value')));
                if (v == null) { this.triggerError?.(new Error('nothing to capture: no value received yet')); return; }
                this._lastIn = v;
            }
            const r = (x) => Math.round(x * 1e6) / 1e6;
            this.properties.zero = Array.isArray(this._lastIn) ? this._lastIn.map(r).join(',') : String(r(this._lastIn));
            const w = this.widgets?.find(x => x.name === 'zero');
            if (w) w.value = this.properties.zero;
            this.setDirtyCanvas(true, false);
            emit(this, zip(this._lastIn, this._lastIn, () => 0));   // la posizione attuale ora vale zero
            return;
        }
        const x = readValue(this);
        if (x == null) return;
        this._lastIn = x;
        const z = this._zero();
        emit(this, z == null ? x : zip(x, z, (a, b) => a - b));
    };
    IoTCalibrate.prototype.onRemoved = function () { clearTimeout(this._redrawTimer); };
    IoTCalibrate.prototype.onDrawForeground = function (ctx2d) { drawText(this, ctx2d, this._status); };
    LG.registerNodeType('IoT/Calibrate', IoTCalibrate);
}
