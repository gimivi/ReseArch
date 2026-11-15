// app/FLE_sub_modules/FLE-start-nodes.mjs
// Flow/Events/OnStart (2026-10-07): evento emesso una volta all'avvio del flow.
//
// Nei flow di un oggetto i runner chiamano onStart di ogni nodo quando il pannello è pronto
// (in TJS dopo il caricamento dei modelli); nell'editor lo chiama graph.start(). L'evento
// parte al giro successivo (setTimeout 0), quando TUTTI i nodi hanno ricevuto onStart: un
// Receiver o un nodo che si aggancia in onStart è già pronto a valle.
// Esempio: OnStart → TJS/Scene/GetTree → App Bus Emitter (retain).
// Regole dei nodi: _doc/guide-fle-regole-nodi.md

export function registerStartNodes(LG) {
    if (!LG) return;

    function OnStart() {
        this.addOutput('trigger', LG.EVENT);
        this._pending = false;
        this._timer = 0;
        this.color   = '#062a1a';   // famiglia Eventi
        this.bgcolor = '#0a4a2e';
        this.size    = [170, 30];
    }
    OnStart.title = 'On Start';
    OnStart.desc  = 'Fires an event once, when the flow starts (panel ready, dashboard flow started, editor started). Works in every context';
    OnStart.portHelp = {
        outputs: {
            trigger: 'event — once when the flow starts, after all nodes have been started; again if the flow is restarted (e.g. "Test on panel")',
        },
    };
    OnStart.prototype.onStart = function () {
        clearTimeout(this._timer);
        const g = this.graph;
        this._timer = setTimeout(() => {
            this._timer = 0;
            if (!g || this.graph !== g) return;   // nodo tolto nel frattempo
            this._pending = true;
            try { g.runStep(1); } catch (e) { console.error('[Flow/Events/OnStart] runStep:', e); }
        }, 0);
    };
    OnStart.prototype.onStop = function () { clearTimeout(this._timer); this._timer = 0; this._pending = false; };
    OnStart.prototype.onRemoved = OnStart.prototype.onStop;
    OnStart.prototype.onExecute = function () {
        if (!this._pending) return;
        this._pending = false;
        this.triggerSlot(this.findOutputSlot('trigger'));
    };
    LG.registerNodeType('Flow/Events/OnStart', OnStart);
}
