// app/FLE_sub_modules/FLE-app-script-node.mjs
// Nodo "script dedicato a un'APP" (step 9 di _doc/arch-abilitazioni.md §7):
// sostituisce il codice che prima stava DENTRO i modelli (file .mjs di JSX,
// modalità "inject" di HTM). Il codice vive ora in un flow embedded, quindi
// passa dalla validazione dei flow: questi tipi sono nell'elenco dei nodi
// critici lato server (api/flow_validation.php, FV_CRITICAL_TYPES).
//
// Differenze da Script/Flexi: il codice riceve già gli oggetti dell'APP
// (es. board e JXG per JSX, container per HTM) oltre a `vars`, e di default
// gira UNA volta all'avvio del flow (property run_on_start), come faceva il
// vecchio setup() dei file JSX. L'ingresso 'run' lo rilancia a comando.
// Uscite: 'done' (EVENT), 'result' (valore restituito), 'error' (EVENT).

/**
 * @param {object} LG          — window.LiteGraph
 * @param {object} opt
 * @param {string} opt.title
 * @param {string} opt.desc
 * @param {string[]} opt.contextNames  — nomi delle variabili passate al codice
 * @param {(graph) => (object|null)} opt.getContext — valori per contextNames, null se il pannello non c'è
 * @param {string} opt.defaultCode
 * @param {string} opt.missingContext — messaggio quando getContext() è null
 */
export function makeAppScriptNode(LG, opt) {
    const names = [...opt.contextNames, 'vars'];

    function AppScript() {
        this.addProperty('code', opt.defaultCode, 'string');
        this.addProperty('run_on_start', true, 'boolean');
        this.addWidget('button', '✏  Edit code', null, () => this._openEditor());
        this.addWidget('toggle', 'run on start', true, v => { this.properties.run_on_start = v; }, { property: 'run_on_start' });
        this.addInput('run', LG.ACTION);
        this.addOutput('done', LG.EVENT);
        this.addOutput('result', 0);
        this.addOutput('error', LG.EVENT);
        this.color   = '#1e3a5f';
        this.bgcolor = '#1e40af';
        this.size    = [240, 90];
        this._fn = null; this._fnCode = null; this._pending = false; this._lastError = null;
    }
    AppScript.title = opt.title;
    AppScript.desc  = opt.desc;
    AppScript.portHelp = {
        inputs:  { run: "Trigger (ACTION): runs the code again on demand (in addition to the optional run on start)." },
        outputs: {
            done:   "EVENT fired if the code finishes without errors.",
            result: "The value returned by the code with `return` (any type).",
            error:  "EVENT with the error message, instead of 'done'.",
        },
    };

    AppScript.prototype.onStart = function () {
        this._pending = !!this.properties.run_on_start;
    };
    AppScript.prototype.onExecute = function () {
        if (!this._pending) return;
        this._pending = false;
        this._run();
    };
    AppScript.prototype.onAction = function () {
        this._run();
    };

    AppScript.prototype._run = function () {
        const ctx = opt.getContext(this.graph);
        if (!ctx) return this._fail(opt.missingContext);
        const vars = this.graph ? (this.graph.vars = this.graph.vars || {}) : {};
        let result;
        try {
            // Compilato solo quando cambia il codice
            if (this._fnCode !== this.properties.code) {
                // eslint-disable-next-line no-new-func
                this._fn = new Function(...names, `"use strict";\n${this.properties.code}`);
                this._fnCode = this.properties.code;
            }
            result = this._fn(...opt.contextNames.map(n => ctx[n]), vars);
        } catch (err) {
            return this._fail(err?.message || String(err), err);
        }
        // Codice asincrono (await dentro una funzione async restituita): gestito
        Promise.resolve(result).then(
            (v) => { this._lastError = null; this.setOutputData(1, v); this.triggerSlot(0); this.setDirtyCanvas(true, true); },
            (err) => this._fail(err?.message || String(err), err),
        );
    };

    AppScript.prototype._fail = function (msg, err) {
        if (err) console.error(`[${opt.title}]`, err);
        this._lastError = msg;
        this.triggerSlot(2, msg);
        this.setDirtyCanvas(true, true);
    };

    // Stesso editor a modale di Script/Flexi (riusato, non duplicato), con un
    // suggerimento sulle variabili disponibili.
    AppScript.prototype._parseNames = () => [];
    AppScript.prototype._openEditor = function () {
        const flexi = LG.registered_node_types?.['Script/Flexi'];
        if (!flexi?.prototype?._openEditor) { alert('Editor not available.'); return; }
        flexi.prototype._openEditor.call(this);
        const hint = document.getElementById('_fle_flexi_script_modal_hint');
        if (hint) hint.textContent = `Available variables: ${names.join(', ')}  ·  return: value on the 'result' output`;
    };

    AppScript.prototype.onDrawForeground = function (ctx) {
        if (!this._lastError) return;
        ctx.fillStyle = '#f87171';
        ctx.font      = 'bold 10px monospace';
        ctx.fillText('⚠ ' + this._lastError.substring(0, 32), 6, this.size[1] - 6);
    };

    return AppScript;
}
