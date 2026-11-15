// app/HTM_sub_modules/HTM-markdown-dom.mjs
// Markdown → elementi della pagina, in modo SICURO (2026-10-06): ogni elemento è creato con
// createElement e il testo inserito con textContent / nodi di testo. Non si usa mai innerHTML,
// quindi un testo che arriva da un modello (Ollama, ComfyUI) non può far eseguire nulla: i tag
// scritti nel testo restano testo. I link sono ammessi solo http(s) e si aprono in una nuova
// scheda (rel="noopener noreferrer"); niente immagini.
//
// Stesso sottoinsieme di FLE-markdown-canvas.mjs (nodo Note): titoli, grassetto, corsivo, codice,
// link, elenchi annidati, citazioni, linee, blocchi di codice, tabelle. Ogni a capo è un a capo.
// Classi per lo stile: il contenitore riceve "md"; tabelle "md-table".

import { parseInline } from "../FLE_sub_modules/FLE-markdown-canvas.mjs";

const SAFE_URL = /^https?:\/\//i;

function inline(doc, parent, text, base) {
    for (const s of parseInline(text, base)) {
        let node = doc.createTextNode(s.text);
        if (s.code) { const c = doc.createElement('code'); c.append(node); node = c; }
        if (s.italic) { const e = doc.createElement('em'); e.append(node); node = e; }
        if (s.bold) { const b = doc.createElement('strong'); b.append(node); node = b; }
        if (s.link && s.href && SAFE_URL.test(s.href.trim())) {
            const a = doc.createElement('a');
            a.href = s.href.trim(); a.target = '_blank'; a.rel = 'noopener noreferrer';
            a.append(node); node = a;
        }
        parent.append(node);
    }
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

/** Converte il Markdown in un DocumentFragment (da inserire con replaceChildren / append). */
export function renderMarkdownDOM(text, doc = document) {
    const frag = doc.createDocumentFragment();
    const lines = String(text ?? '').replace(/\t/g, '    ').split('\n');
    let para = null;                      // paragrafo aperto (righe consecutive, unite da <br>)
    let lists = [];                       // pila degli elenchi aperti: { el, level, ordered }
    const closePara = () => { para = null; };
    const closeLists = () => { lists = []; };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // blocco di codice
        if (/^\s*```/.test(line)) {
            closePara(); closeLists();
            const code = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
            const pre = doc.createElement('pre'), c = doc.createElement('code');
            c.textContent = code.join('\n');
            pre.append(c); frag.append(pre);
            continue;
        }

        // tabella
        if (/^\s*\|/.test(line) && i + 1 < lines.length && isSepRow(lines[i + 1])) {
            closePara(); closeLists();
            const head = splitRow(line);
            const align = splitRow(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
            const table = doc.createElement('table'); table.className = 'md-table';
            const thead = doc.createElement('thead'), trh = doc.createElement('tr');
            head.forEach((h, k) => { const th = doc.createElement('th'); if (align[k]) th.style.textAlign = align[k]; inline(doc, th, h); trh.append(th); });
            thead.append(trh); table.append(thead);
            const tbody = doc.createElement('tbody');
            i += 2;
            while (i < lines.length && /^\s*\|/.test(lines[i])) {
                const tr = doc.createElement('tr');
                splitRow(lines[i]).forEach((cell, k) => { const td = doc.createElement('td'); if (align[k]) td.style.textAlign = align[k]; inline(doc, td, cell); tr.append(td); });
                tbody.append(tr);
                i++;
            }
            i--;
            table.append(tbody);
            frag.append(table);
            continue;
        }

        // riga vuota: chiude paragrafi ed elenchi
        if (!line.trim()) { closePara(); closeLists(); continue; }

        // linea orizzontale
        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { closePara(); closeLists(); frag.append(doc.createElement('hr')); continue; }

        // titolo
        const h = /^\s*(#{1,6})\s+(.*)$/.exec(line);
        if (h) {
            closePara(); closeLists();
            const el = doc.createElement('h' + h[1].length);
            inline(doc, el, h[2]);
            frag.append(el);
            continue;
        }

        // citazione
        const q = /^\s*>\s?(.*)$/.exec(line);
        if (q) {
            closePara(); closeLists();
            const last = frag.lastChild;
            const bq = (last && last.nodeName === 'BLOCKQUOTE') ? last : frag.appendChild(doc.createElement('blockquote'));
            if (bq.childNodes.length) bq.append(doc.createElement('br'));
            inline(doc, bq, q[1]);
            continue;
        }

        // elenco
        const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
        if (li) {
            closePara();
            const level = Math.floor(li[1].length / 2), ordered = /\d/.test(li[2]);
            while (lists.length && lists[lists.length - 1].level > level) lists.pop();
            let top = lists[lists.length - 1];
            if (!top || top.level < level || top.ordered !== ordered) {
                if (top && top.level === level) lists.pop();
                const el = doc.createElement(ordered ? 'ol' : 'ul');
                if (ordered) { const n = parseInt(li[2], 10); if (n > 1) el.start = n; }
                const parentList = lists[lists.length - 1];
                if (parentList && parentList.level < level && parentList.el.lastElementChild) parentList.el.lastElementChild.append(el);
                else frag.append(el);
                top = { el, level, ordered };
                lists.push(top);
            }
            const item = doc.createElement('li');
            inline(doc, item, li[3]);
            top.el.append(item);
            continue;
        }

        // paragrafo: righe consecutive nello stesso <p>, separate da <br>
        closeLists();
        if (!para) { para = doc.createElement('p'); frag.append(para); }
        else para.append(doc.createElement('br'));
        inline(doc, para, line);
    }
    return frag;
}

/** Sostituisce il contenuto di el con il Markdown convertito (aggiunge la classe "md"). */
export function setMarkdown(el, text) {
    el.classList.add('md');
    el.replaceChildren(renderMarkdownDOM(text, el.ownerDocument || document));
}
