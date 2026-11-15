// app/FLE_sub_modules/FLE-error-nodes.mjs
// Gestione degli errori nei flow (2026-10-04).
//
//   Flow/Error Info — trasforma l'evento della porta 'error' di un nodo (porta del fork
//                     LiteGraph, patch 3: tasto destro sul nodo → Show error) in dati
//                     collegabili: messaggio, titolo e tipo del nodo, ora.
//
// L'evento 'error' porta con sé { message, node, title, type, time } come parametro
// (LGraphNode.prototype.triggerError, lib/litegraph/PATCHES.md §3).
// Regole dei nodi: _doc/guide-fle-regole-nodi.md

export function registerErrorNodes(LG) {
    if (!LG) return;

    function ErrorInfo() {
        this.addInput('trigger',  LG.ACTION);
        this.addOutput('done',    LG.EVENT);
        this.addOutput('message', 'string');
        this.addOutput('title',   'string');
        this.addOutput('type',    'string');
        this.addOutput('time',    'number');
        this.addOutput('info',    'object');
        this._last = '';
        this.color   = '#1f2937';   // famiglia Instradamento
        this.bgcolor = '#374151';
        this.size    = [220, 140];
    }
    ErrorInfo.title = 'Error Info';
    ErrorInfo.desc  = 'Receives the "error" event of a node (port shown with right click → Show error) and returns its message and origin as data';
    ErrorInfo.portHelp = {
        inputs: {
            trigger: 'event — connect to the "error" port of a node; receives its parameter { message, node, title, type, time }',
        },
        outputs: {
            done:    'event — fired after the error data has been written',
            message: 'text — reason for the error',
            title:   'text — title of the node that raised the error',
            type:    'text — node type, e.g. "Media/Image/Load"',
            time:    'number — time of the error in milliseconds (Date.now())',
            info:    'object — the full error { message, node, title, type, time } (node = id of the node in the graph)',
        },
    };
    ErrorInfo.prototype.onAction = function (action, param) {
        const e = (param && typeof param === 'object')
            ? param
            : { message: param != null ? String(param) : 'error without description', node: null, title: '', type: '', time: Date.now() };
        this.setOutputData(this.findOutputSlot('message'), e.message ?? '');
        this.setOutputData(this.findOutputSlot('title'),   e.title ?? '');
        this.setOutputData(this.findOutputSlot('type'),    e.type ?? '');
        this.setOutputData(this.findOutputSlot('time'),    e.time ?? null);
        this.setOutputData(this.findOutputSlot('info'),    e);
        this._last = `${e.title ? e.title + ': ' : ''}${e.message ?? ''}`;
        this.setDirtyCanvas(true, false);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    ErrorInfo.prototype.onDrawForeground = function (ctx2d) {
        if (!this._last || this.flags.collapsed) return;
        ctx2d.save();
        ctx2d.font = '9px monospace';
        ctx2d.fillStyle = 'rgba(248,113,113,0.9)';
        ctx2d.fillText(this._last.slice(0, 40), 6, this.size[1] - 6);
        ctx2d.restore();
    };
    LG.registerNodeType('Flow/Error Info', ErrorInfo);
}
