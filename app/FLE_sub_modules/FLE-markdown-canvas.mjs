// app/FLE_sub_modules/FLE-markdown-canvas.mjs
// Markdown disegnato su un canvas 2D (2026-10-06) — per il nodo Debug/Note e per le anteprime.
// Non produce HTML: interpreta un sottoinsieme di Markdown e disegna testo, quindi nessun rischio
// di codice eseguito, e il testo resta nitido a ogni zoom del grafo.
//
// Supportato:
//   # … ######  titoli            **grassetto**  *corsivo*  _corsivo_  `codice`  [testo](url)
//   - * +  elenchi (anche annidati con 2 spazi)   1.  elenchi numerati
//   > citazione        --- / *** / ___  linea orizzontale
//   ``` blocchi di codice ```   (carattere monospaziato)
//   | tabelle | con | riga | di | separazione |   (colonne allineate, :--- :---: ---: per l'allineamento)
// Ogni a capo del testo è un a capo anche nel disegno (come nei commenti di GitHub).
//
// Uso:
//   const lay = layoutMarkdown(ctx, text, { width, fontSize, format });   // misura e impagina
//   drawLayout(ctx, lay, x, y);                                           // disegna
// lay.height = altezza totale. Conviene tenere in cache lay finché testo/larghezza non cambiano.

const COLORS = {
    text: '#e2e8f0', heading: '#ffffff', muted: '#94a3b8', link: '#93c5fd',
    codeBg: 'rgba(0,0,0,0.28)', rule: 'rgba(255,255,255,0.22)', quote: 'rgba(148,163,184,0.7)',
    th: 'rgba(255,255,255,0.08)',
};
const SANS = 'sans-serif';
const MONO = 'ui-monospace, Consolas, "Courier New", monospace';

function fontOf(st, size) {
    return `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${size}px ${st.code ? MONO : SANS}`;
}

/** Testo con formattazione in linea → segmenti { text, bold, italic, code, link }. */
export function parseInline(src, base = {}) {
    const out = [];
    let i = 0, buf = '';
    const st = { bold: !!base.bold, italic: !!base.italic, code: false, link: false };
    const flush = () => { if (buf) { out.push({ text: buf, ...st }); buf = ''; } };
    while (i < src.length) {
        const c = src[i], n = src[i + 1];
        if (c === '\\' && i + 1 < src.length) { buf += n; i += 2; continue; }
        if (c === '`') {
            const j = src.indexOf('`', i + 1);
            if (j > i) { flush(); out.push({ text: src.slice(i + 1, j), ...st, code: true }); i = j + 1; continue; }
        }
        if (c === '[') {
            const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
            if (m) { flush(); out.push(...parseInline(m[1], st).map(s => ({ ...s, link: true, href: m[2] }))); i += m[0].length; continue; }
        }
        if ((c === '*' && n === '*') || (c === '_' && n === '_')) { flush(); st.bold = !st.bold; i += 2; continue; }
        if (c === '*' || (c === '_' && !/\w/.test(src[i - 1] || '') )) {
            // corsivo: solo se c'è una chiusura più avanti (un * isolato resta un asterisco)
            if (st.italic || src.indexOf(c, i + 1) > i + 1) { flush(); st.italic = !st.italic; i += 1; continue; }
        }
        buf += c; i += 1;
    }
    flush();
    return out;
}

/** Spezza segmenti in righe entro maxW: [[{text, style}, …], …] con le larghezze misurate. */
function wrapSegments(ctx, segs, maxW, size) {
    const lines = [];
    let line = [], lineW = 0;
    const pushWord = (word, st) => {
        ctx.font = fontOf(st, size);
        let w = ctx.measureText(word).width;
        if (lineW + w > maxW && line.length && word.trim()) {
            lines.push({ parts: line, width: lineW });
            line = []; lineW = 0;
            if (!word.trim()) return;                       // niente spazi a inizio riga
        }
        // parola più lunga della riga: spezzata a caratteri
        while (w > maxW && word.length > 1) {
            let k = word.length - 1;
            while (k > 1 && ctx.measureText(word.slice(0, k)).width > maxW - lineW) k--;
            line.push({ text: word.slice(0, k), st, w: ctx.measureText(word.slice(0, k)).width });
            lines.push({ parts: line, width: lineW + ctx.measureText(word.slice(0, k)).width });
            line = []; lineW = 0;
            word = word.slice(k); w = ctx.measureText(word).width;
        }
        line.push({ text: word, st, w });
        lineW += w;
    };
    for (const s of segs) for (const word of s.text.split(/(\s+)/)) if (word) pushWord(word, s);
    if (line.length || !lines.length) lines.push({ parts: line, width: lineW });
    return lines;
}

function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = []; let buf = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && s[i + 1] === '|') { buf += '|'; i++; continue; }
        if (s[i] === '|') { cells.push(buf.trim()); buf = ''; continue; }
        buf += s[i];
    }
    cells.push(buf.trim());
    return cells;
}
const isSepRow = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

/**
 * Impagina il testo. opts: { width, fontSize = 11, format = 'markdown' | 'text' }.
 * Restituisce { ops: [...], height } con coordinate relative all'angolo in alto a sinistra.
 */
export function layoutMarkdown(ctx, text, opts = {}) {
    const W = Math.max(40, opts.width || 200);
    const fs = opts.fontSize || 11;
    const lh = Math.round(fs * 1.35);
    const ops = [];
    let y = 0;
    ctx.save();
    ctx.textBaseline = 'top';

    const drawLines = (lines, x, size, color, lineH) => {
        for (const ln of lines) {
            let cx = x;
            for (const p of ln.parts) {
                if (p.st.code) ops.push({ t: 'rect', x: cx - 1, y: y - 1, w: p.w + 2, h: lineH, color: COLORS.codeBg });
                ops.push({ t: 'text', x: cx, y, str: p.text, font: fontOf(p.st, size), color: p.st.link ? COLORS.link : color });
                if (p.st.link) ops.push({ t: 'line', x1: cx, y1: y + size + 1, x2: cx + p.w, y2: y + size + 1, color: COLORS.link });
                cx += p.w;
            }
            y += lineH;
        }
    };

    if (opts.format === 'text') {
        for (const raw of String(text ?? '').split('\n')) drawLines(wrapSegments(ctx, [{ text: raw }], W, fs), 0, fs, COLORS.text, lh);
        ctx.restore();
        return { ops, height: y };
    }

    const lines = String(text ?? '').replace(/\t/g, '    ').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // blocco di codice
        if (/^\s*```/.test(line)) {
            const code = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
            const cfs = Math.max(8, fs - 1), clh = Math.round(cfs * 1.35);
            const top = y; y += 4;
            const rows = [];
            for (const c of code) for (const ln of wrapSegments(ctx, [{ text: c || ' ', code: true }], W - 12, cfs)) rows.push(ln);
            ops.push({ t: 'rect', x: 0, y: top, w: W, h: rows.length * clh + 8, color: COLORS.codeBg });
            for (const ln of rows) {
                ops.push({ t: 'text', x: 6, y, str: ln.parts.map(p => p.text).join(''), font: fontOf({ code: true }, cfs), color: COLORS.text });
                y += clh;
            }
            y += 8;
            continue;
        }

        // tabella: riga di intestazione + riga di separazione
        if (/^\s*\|/.test(line) && i + 1 < lines.length && isSepRow(lines[i + 1])) {
            const head = splitRow(line);
            const align = splitRow(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left');
            const body = [];
            i += 2;
            while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(splitRow(lines[i++]));
            i--;
            const ncol = Math.max(head.length, ...body.map(r => r.length));
            const rows = [head, ...body].map(r => Array.from({ length: ncol }, (_, k) => r[k] ?? ''));
            const pad = 5;
            // larghezza naturale (contenuto su una riga) e minima (parola più lunga) delle colonne;
            // se non entrano: ogni colonna tiene almeno la sua parola più lunga e lo spazio che resta
            // si divide in proporzione al contenuto (come le tabelle dei browser)
            const natural = Array(ncol).fill(20), minimum = Array(ncol).fill(20);
            rows.forEach((r, ri) => r.forEach((cell, k) => {
                let w = 0;
                for (const s of parseInline(cell, { bold: ri === 0 })) {
                    ctx.font = fontOf(s, fs);
                    w += ctx.measureText(s.text).width;
                    for (const word of s.text.split(/\s+/)) minimum[k] = Math.max(minimum[k], ctx.measureText(word).width + pad * 2);
                }
                natural[k] = Math.max(natural[k], w + pad * 2);
            }));
            const total = natural.reduce((a, b) => a + b, 0);
            let colW = natural;
            if (total > W) {
                const minTotal = minimum.reduce((a, b) => a + b, 0);
                if (minTotal >= W) {
                    colW = minimum.map(m => m * W / minTotal);          // spazio insufficiente: parole spezzate
                } else {
                    const extra = total - minTotal;
                    colW = natural.map((n, k) => minimum[k] + (W - minTotal) * ((n - minimum[k]) / (extra || 1)));
                }
            }
            const tableW = colW.reduce((a, b) => a + b, 0);
            y += 2;
            const top = y;
            rows.forEach((r, ri) => {
                const cells = r.map((cell, k) => wrapSegments(ctx, parseInline(cell, { bold: ri === 0 }), colW[k] - pad * 2, fs));
                const rh = Math.max(...cells.map(c => c.length)) * lh + 6;
                if (ri === 0) ops.push({ t: 'rect', x: 0, y, w: tableW, h: rh, color: COLORS.th });
                let cx = 0;
                cells.forEach((cl, k) => {
                    let cy = y + 3;
                    for (const ln of cl) {
                        const off = align[k] === 'right' ? colW[k] - pad * 2 - ln.width : align[k] === 'center' ? (colW[k] - pad * 2 - ln.width) / 2 : 0;
                        let tx = cx + pad + Math.max(0, off);
                        for (const p of ln.parts) {
                            if (p.st.code) ops.push({ t: 'rect', x: tx - 1, y: cy - 1, w: p.w + 2, h: lh, color: COLORS.codeBg });
                            ops.push({ t: 'text', x: tx, y: cy, str: p.text, font: fontOf(p.st, fs), color: p.st.link ? COLORS.link : (ri === 0 ? COLORS.heading : COLORS.text) });
                            tx += p.w;
                        }
                        cy += lh;
                    }
                    cx += colW[k];
                });
                y += rh;
                ops.push({ t: 'line', x1: 0, y1: y, x2: tableW, y2: y, color: COLORS.rule });
            });
            // bordi esterni e verticali
            ops.push({ t: 'line', x1: 0, y1: top, x2: tableW, y2: top, color: COLORS.rule });
            let vx = 0;
            for (let k = 0; k <= ncol; k++) { ops.push({ t: 'line', x1: vx, y1: top, x2: vx, y2: y, color: COLORS.rule }); vx += colW[k] ?? 0; }
            y += 6;
            continue;
        }

        // riga vuota
        if (!line.trim()) { y += Math.round(lh * 0.5); continue; }

        // linea orizzontale
        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
            y += 4;
            ops.push({ t: 'line', x1: 0, y1: y, x2: W, y2: y, color: COLORS.rule });
            y += 6;
            continue;
        }

        // titolo
        const h = /^\s*(#{1,6})\s+(.*)$/.exec(line);
        if (h) {
            const size = Math.round(fs * [1.6, 1.4, 1.22, 1.1, 1.0, 1.0][h[1].length - 1]);
            y += h[1].length <= 2 ? 4 : 2;
            drawLines(wrapSegments(ctx, parseInline(h[2], { bold: true }), W, size), 0, size, COLORS.heading, Math.round(size * 1.3));
            if (h[1].length <= 2) { ops.push({ t: 'line', x1: 0, y1: y + 1, x2: W, y2: y + 1, color: COLORS.rule }); y += 4; }
            y += 2;
            continue;
        }

        // citazione
        const q = /^\s*>\s?(.*)$/.exec(line);
        if (q) {
            const top = y;
            drawLines(wrapSegments(ctx, parseInline(q[1], { italic: true }), W - 12, fs), 10, fs, COLORS.muted, lh);
            ops.push({ t: 'rect', x: 2, y: top, w: 3, h: y - top, color: COLORS.quote });
            continue;
        }

        // elenco puntato o numerato
        const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
        if (li) {
            const level = Math.floor(li[1].length / 2);
            const indent = 6 + level * 14;
            const marker = /\d/.test(li[2]) ? li[2] : (level % 2 ? '◦' : '•');
            ctx.font = fontOf({}, fs);
            const mw = Math.max(10, ctx.measureText(marker + ' ').width);
            ops.push({ t: 'text', x: indent, y, str: marker, font: fontOf({}, fs), color: COLORS.muted });
            drawLines(wrapSegments(ctx, parseInline(li[3]), W - indent - mw, fs), indent + mw, fs, COLORS.text, lh);
            continue;
        }

        // paragrafo (ogni a capo è un a capo)
        drawLines(wrapSegments(ctx, parseInline(line), W, fs), 0, fs, COLORS.text, lh);
    }
    ctx.restore();
    return { ops, height: y };
}

/** Disegna un'impaginazione a partire da (x, y). */
export function drawLayout(ctx, lay, x = 0, y = 0) {
    ctx.save();
    ctx.textBaseline = 'top';
    for (const op of lay.ops) {
        if (op.t === 'text') { ctx.font = op.font; ctx.fillStyle = op.color; ctx.fillText(op.str, x + op.x, y + op.y); }
        else if (op.t === 'rect') { ctx.fillStyle = op.color; ctx.fillRect(x + op.x, y + op.y, op.w, op.h); }
        else if (op.t === 'line') {
            ctx.strokeStyle = op.color; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x + op.x1 + 0.5, y + op.y1 + 0.5); ctx.lineTo(x + op.x2 + 0.5, y + op.y2 + 0.5); ctx.stroke();
        }
    }
    ctx.restore();
}
