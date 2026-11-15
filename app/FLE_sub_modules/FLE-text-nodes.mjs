// app/FLE_sub_modules/FLE-text-nodes.mjs
// Visualizzazione di testi lunghi nel canvas dei flow (2026-10-04).
//
//   Debug/Text View — mostra un testo con a capo automatico sulle parole, scorrimento con la
//                     rotella e copia; pensato per le risposte di AI/Ollama/Chat (anche in
//                     streaming: chunk → trigger, partial → text).
//
// Debug/Inspect resta il nodo per i DATI (mostra tutto come JSON e non va a capo).
// In futuro, per un dialogo vero: pannello HTM con area di testo e Markdown, guidato da un
// flow embedded (vedi _doc/integrazione-ollama.md §5).
// Regole dei nodi: _doc/guide-fle-regole-nodi.md

const FONT = '11px sans-serif';
const LH   = 14;    // altezza riga
const PADX = 8;
const SBW  = 4;     // larghezza barra di scorrimento

function copyText(text) {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}
function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignora */ }
    ta.remove();
}

/** Righe del testo a capo sulle parole entro maxW (le parole più lunghe di una riga si spezzano). */
function wrapText(ctx, text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
        if (!para) { out.push(''); continue; }
        let line = '';
        for (const word of para.split(/(\s+)/)) {          // conserva gli spazi come separatori
            if (!word) continue;
            const test = line + word;
            if (ctx.measureText(test).width <= maxW) { line = test; continue; }
            if (line.trim()) out.push(line.trimEnd());
            line = /^\s+$/.test(word) ? '' : word;
            while (ctx.measureText(line).width > maxW && line.length > 1) {   // parola più lunga della riga
                let n = line.length - 1;
                while (n > 1 && ctx.measureText(line.slice(0, n)).width > maxW) n--;
                out.push(line.slice(0, n));
                line = line.slice(n);
            }
        }
        out.push(line.trimEnd());
    }
    return out;
}

export function registerTextNodes(LG) {
    if (!LG) return;

    function TextView() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('text',    'string');
        this._text    = '';
        this._lines   = [];
        this._wrapKey = '';
        this._scrollY = 0;        // prima riga visibile
        this._follow  = true;     // segue la fine del testo (finché l'utente non risale)
        this.resizable = true;
        this.color   = '#1a1a2e';  // come Debug/Inspect
        this.bgcolor = '#16213e';
        this.size    = [340, 240];
    }
    TextView.title = 'Text View';
    TextView.desc  = 'Shows a long text, with automatic word wrap, mouse-wheel scrolling and copy (right click). For structured data use Debug/Inspect';
    TextView.portHelp = {
        inputs: {
            trigger: 'event — updates the shown text by reading "text". With Ollama Chat: "chunk" to see the response grow, or "done" to see it once complete',
            text:    'text to show (line breaks are kept). With Ollama Chat: "partial" (together with chunk) or "response" (together with done)',
        },
        outputs: {},
    };

    /** Spazio occupato in alto dalle due porte d'ingresso e dalla riga di intestazione. */
    TextView.prototype._top = function () { return 2 * LG.NODE_SLOT_HEIGHT + LH; };
    TextView.prototype._visible = function () { return Math.max(1, Math.floor((this.size[1] - this._top() - 6) / LH)); };
    TextView.prototype._maxScroll = function () { return Math.max(0, this._lines.length - this._visible()); };

    TextView.prototype.onAction = function () {
        const v = this.getInputData(this.findInputSlot('text'));
        this._text = v == null ? '' : String(v);
        this._wrapKey = '';            // righe da ricalcolare al prossimo disegno
        this.setDirtyCanvas(true, false);
    };

    TextView.prototype.onDrawForeground = function (ctx) {
        if (this.flags.collapsed) return;
        const W = this.size[0], H = this.size[1];
        ctx.save();
        ctx.font = FONT;
        const textW = W - PADX * 2 - SBW - 2;
        const key = `${textW}|${this._text.length}|${this._text.slice(-32)}`;
        if (key !== this._wrapKey) {
            this._lines = this._text ? wrapText(ctx, this._text, textW) : [];
            this._wrapKey = key;
            if (this._follow) this._scrollY = this._maxScroll();
            else this._scrollY = Math.min(this._scrollY, this._maxScroll());
        }

        // intestazione: caratteri e parole (sotto le porte, non scorre)
        const words = this._text.trim() ? this._text.trim().split(/\s+/).length : 0;
        const top = this._top();
        ctx.font = '9px monospace';
        ctx.fillStyle = 'rgba(255,200,120,0.85)';
        ctx.fillText(this._text ? `${this._text.length} characters · ${words} words` : 'no text', PADX, top - 4);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath(); ctx.moveTo(PADX - 4, top); ctx.lineTo(W - 6, top); ctx.stroke();

        // testo
        ctx.font = FONT;
        ctx.fillStyle = 'rgba(230,236,245,0.92)';
        const vis = this._visible();
        let y = top + LH - 2;
        for (let i = this._scrollY; i < this._lines.length && i < this._scrollY + vis; i++) {
            ctx.fillText(this._lines[i], PADX, y);
            y += LH;
        }

        // barra di scorrimento
        const max = this._maxScroll();
        if (max > 0) {
            const sbX = W - SBW - 3, sbTop = top + 2, sbH = H - sbTop - 4;
            const thumbH = Math.max(16, sbH * vis / this._lines.length);
            const thumbY = sbTop + (sbH - thumbH) * (this._scrollY / max);
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillRect(sbX, sbTop, SBW, sbH);
            ctx.fillStyle = 'rgba(160,190,255,0.55)';
            ctx.fillRect(sbX, thumbY, SBW, thumbH);
        }
        ctx.restore();
    };

    TextView.prototype.onMouseWheel = function (e) {
        const max = this._maxScroll();
        if (max === 0) return false;   // niente da scorrere: lascia passare lo zoom del canvas
        const step = e.deltaY > 0 ? 3 : -3;
        this._scrollY = Math.max(0, Math.min(this._scrollY + step, max));
        this._follow = this._scrollY >= max;   // tornato in fondo → riprende a seguire il testo
        this.setDirtyCanvas(true, false);
        e.preventDefault?.();
        e.stopPropagation?.();
        return true;
    };

    TextView.prototype.onResize = function () { this._wrapKey = ''; };

    TextView.prototype.getExtraMenuOptions = function (_graph, options) {
        options.push({ content: '📋 Copy text', callback: () => copyText(this._text) });
        options.push({ content: '⤓ Go to end', callback: () => { this._follow = true; this._scrollY = this._maxScroll(); this.setDirtyCanvas(true, false); } });
    };

    LG.registerNodeType('Debug/Text View', TextView);
}
