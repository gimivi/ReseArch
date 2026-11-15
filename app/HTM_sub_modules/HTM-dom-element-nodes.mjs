// app/HTM_sub_modules/HTM-dom-element-nodes.mjs
// Nodi che AGISCONO SU ELEMENTI GIÀ PRESENTI nel documento HTM (2026-10-04): l'autore scrive
// l'HTML (textarea, pulsanti, riquadri con id) e il flow li aggancia con HTM/DOM/Query, poi:
//
//   HTM/DOM/On Event  — ascolta un evento dell'elemento (click, input, change, submit, keydown
//                       con filtro tasto es. Ctrl+Enter) ed emette trigger
//   HTM/DOM/Get Value — legge il valore (campi/textarea → value, checkbox → booleano, altri → testo)
//   HTM/DOM/Set Value — imposta il valore di un campo
//   HTM/DOM/Set Text  — scrive il testo di un elemento (sostituisce o aggiunge; mai come HTML)
//   HTM/DOM/Set Class — aggiunge / toglie / alterna classi
//   HTM/DOM/Set Attr  — imposta o toglie un attributo (rifiuta on* e URL javascript:)
//   HTM/DOM/Get Image — immagine scelta con <input type="file"> (o un <img>) → uscita immagine
//   HTM/DOM/Get Files — documenti (txt, md, csv, json, pdf, rtf) e immagini scelti in un campo file
//   HTM/DOM/Set Image — mostra un'immagine in un <img> o in un <canvas>
//   HTM/DOM/Set Options — riempie un <select> con un elenco (es. i modelli di Ollama)
//   HTM/DOM/Chat View — dialogo a fumetti (messaggi dell'utente e risposta che cresce), per le
//                       chat con AI/Ollama/Chat
//   HTM/DOM/Button Row — fila di pulsanti da un array (2026-10-21)
//   HTM/DOM/Set HTML  — scrive HTML ripulito (HTM-sanitize.mjs) in un elemento (2026-10-21)
//   HTM/DOM/On Selection — testo selezionato in un elemento (2026-10-21)
//   HTM/Frame/Navigate — pagina dell'iframe di un documento mode:"iframe" (2026-10-21)
//
// Tutti i nodi che ricevono un evento lavorano solo in onAction (niente onExecute: regole dei
// nodi §3, use_deferred_actions). On Event è una SORGENTE di eventi: aggancia il listener in
// onExecute, che nel pannello HTM gira al primo runStep e a ogni evento DOM (HTM-flow-runner).
// Regole dei nodi: _doc/guide-fle-regole-nodi.md

import { renderMarkdownDOM } from "./HTM-markdown-dom.mjs";
import { sanitizeHTML } from "./HTM-sanitize.mjs";
import { pdfEnsureWorker } from "../PDF_sub_modules/PDF-core.mjs";

const COL_EVENT = ['#062a1a', '#0a4a2e'];   // Eventi
const COL_GET   = ['#1a2a4a', '#1e3a5f'];   // Get
const COL_SET   = ['#2a1a4a', '#4a1d96'];   // Set (modifica)
const COL_UI    = ['#0c4a6e', '#0369a1'];   // UI

const isEl = (v) => !!v && typeof v === 'object' && v.nodeType === 1;

/** "Ctrl+Enter", "Shift+Enter", "Escape", "a"… → funzione che dice se un KeyboardEvent corrisponde. */
function keyMatcher(spec) {
    const parts = String(spec || '').split('+').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return () => true;
    const key = parts.pop().toLowerCase();
    const mods = new Set(parts.map(p => p.toLowerCase()));
    return (e) => {
        if (String(e.key || '').toLowerCase() !== key) return false;
        const ctrl = e.ctrlKey || e.metaKey;   // Cmd su macOS vale come Ctrl
        return ctrl === (mods.has('ctrl') || mods.has('cmd')) &&
               !!e.shiftKey === mods.has('shift') &&
               !!e.altKey === mods.has('alt');
    };
}

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster']);
function attrAllowed(name, value) {
    const n = String(name || '').trim().toLowerCase();
    if (!n || !/^[a-z_:][\w:.-]*$/.test(n)) return 'invalid attribute name';
    if (n.startsWith('on') || n === 'srcdoc') return `attribute "${n}" not allowed (it would run code)`;
    if (URL_ATTRS.has(n)) {
        const v = String(value ?? '').replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
        if (/^(javascript|vbscript):|^data:text\/html/.test(v)) return `URL not allowed in "${n}"`;
    }
    return null;
}

// ── Lettura di documenti (HTM/DOM/Get Files) ─────────────────────────────────
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json']);
// attributo accept del campo file quando il flow dice se il modello legge immagini (ingresso allow_images)
const DOC_ACCEPT = [...TEXT_EXT, 'pdf', 'rtf'].map(e => '.' + e).join(',');

/** 'image' | 'pdf' | 'rtf' | 'text' | null (non supportato). Il tipo MIME manca spesso (es. .md su Windows). */
function fileKind(file) {
    const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? '').toLowerCase();
    const type = String(file.type || '');
    if (type.startsWith('image/')) return 'image';
    if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
    if (ext === 'rtf' || /rtf$/.test(type)) return 'rtf';
    if (TEXT_EXT.has(ext) || type.startsWith('text/')) return 'text';
    return null;
}

/** Testo di un PDF (strato di testo, pagina per pagina) con pdf.js, già caricato dalla dashboard. */
async function pdfText(file) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('PDF reader not available (pdf.js not loaded)');
    pdfEnsureWorker();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
        const pages = [];
        for (let n = 1; n <= doc.numPages; n++) {
            const tc = await (await doc.getPage(n)).getTextContent();
            let s = '';
            for (const it of tc.items) { s += it.str ?? ''; if (it.hasEOL) s += '\n'; }
            if (s.trim()) pages.push(`[page ${n}]\n${s.trim()}`);
        }
        return pages.join('\n\n');
    } finally { doc.destroy(); }
}

/** Testo semplice di un RTF: paragrafi, caratteri \'hh (Windows-1252) e \uN; tolti tabelle dei font,
 *  colori, stili, immagini e gruppi \*. Lettura semplice, non una conversione fedele. */
function rtfText(rtf) {
    const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'listtable', 'listoverridetable', 'themedata', 'colorschememapping', 'datastore', 'xmlnstbl', 'rsidtbl', 'generator', 'latentstyles']);
    const cp1252 = new TextDecoder('windows-1252');
    let out = '', i = 0, depth = 0, skipDepth = 0, ucSkip = 1, pendingSkip = 0;
    const emit = (c) => { if (!skipDepth) { if (pendingSkip > 0) { pendingSkip--; return; } out += c; } };
    while (i < rtf.length) {
        const c = rtf[i];
        if (c === '{') { depth++; i++; continue; }
        if (c === '}') { if (skipDepth && depth === skipDepth) skipDepth = 0; depth--; i++; continue; }
        if (c === '\\') {
            const nx = rtf[i + 1];
            if (nx === '\\' || nx === '{' || nx === '}') { emit(nx); i += 2; continue; }
            if (nx === '*') { if (!skipDepth) skipDepth = depth; i += 2; continue; }
            if (nx === "'") { emit(cp1252.decode(new Uint8Array([parseInt(rtf.substr(i + 2, 2), 16) || 32]))); i += 4; continue; }
            if (nx === '~') { emit(' '); i += 2; continue; }
            if (nx === '\n' || nx === '\r') { emit('\n'); i += 2; continue; }
            const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 40));
            if (!m) { i += 2; continue; }
            i += m[0].length;
            const word = m[1], arg = m[2] != null ? Number(m[2]) : null;
            if (SKIP.has(word)) { if (!skipDepth) skipDepth = depth; continue; }
            if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') emit('\n');
            else if (word === 'tab' || word === 'cell') emit('\t');
            else if (word === 'row') emit('\n');
            else if (word === 'uc' && arg != null) ucSkip = arg;
            else if (word === 'u' && arg != null) { emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg)); if (!skipDepth) pendingSkip = ucSkip; }
            continue;
        }
        if (c === '\r' || c === '\n') { i++; continue; }
        emit(c); i++;
    }
    return out.replace(/[ \t]+\n/g, '\n');
}

// ── Copia negli appunti (HTM/DOM/Chat View) ──────────────────────────────────
// Negli appunti vanno due versioni insieme: HTML (Word, mail: titoli, grassetti, elenchi, tabelle)
// e testo pulito (Blocco note: niente simboli Markdown; tabelle con colonne separate da tabulazioni,
// incollabili anche in un foglio di calcolo). Il programma di destinazione sceglie quella che sa usare.

/** Testo pulito di un elemento reso dal Markdown: blocchi separati da righe vuote, elenchi "- " / "1. ". */
function chatBlockText(el, depth = 0) {
    let s = '';
    for (const n of el.childNodes) {
        if (n.nodeType === 3) { s += n.nodeValue; continue; }
        if (n.nodeType !== 1 || n.classList.contains('msg-copy')) continue;
        const tag = n.tagName;
        if (/^H[1-6]$/.test(tag) || tag === 'P' || tag === 'DIV') {
            s += '\n\n' + chatBlockText(n, depth).trim() + '\n\n';
        } else if (tag === 'BLOCKQUOTE') {
            s += '\n\n' + chatBlockText(n, depth).trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
        } else if (tag === 'UL' || tag === 'OL') {
            let i = 0;
            const items = [...n.children].filter(c => c.tagName === 'LI').map(li => {
                i++;
                const mark = tag === 'OL' ? `${i}. ` : '- ';
                // le sottoliste portano già il loro rientro
                return '  '.repeat(depth) + mark + chatBlockText(li, depth + 1).trim().replace(/\n{2,}/g, '\n');
            });
            s += '\n' + items.join('\n') + '\n\n';
        } else if (tag === 'PRE') {
            s += '\n\n' + n.textContent.replace(/\n$/, '') + '\n\n';
        } else if (tag === 'TABLE') {
            const rows = [...n.querySelectorAll('tr')]
                .map(tr => [...tr.children].map(c => c.textContent.trim().replace(/\s+/g, ' ')).join('\t'));
            s += '\n\n' + rows.join('\n') + '\n\n';
        } else if (tag === 'BR') {
            s += '\n';
        } else if (tag === 'HR') {
            s += '\n\n' + '-'.repeat(24) + '\n\n';
        } else {
            s += chatBlockText(n, depth);   // in linea: strong, em, code, a, span…
        }
    }
    return s;
}
const chatPlain = (el) => chatBlockText(el).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const chatEsc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

/** HTML di un corpo di messaggio per Word: stili essenziali in linea (le classi della pagina non arrivano). */
function chatHtml(body) {
    if (!body.classList.contains('md')) return chatEsc(body.textContent).replace(/\n/g, '<br>');   // testo semplice
    const c = body.cloneNode(true);
    c.querySelectorAll('.msg-copy').forEach(b => b.remove());
    c.querySelectorAll('table').forEach(t => { t.setAttribute('border', '1'); t.style.borderCollapse = 'collapse'; });
    c.querySelectorAll('th, td').forEach(td => { td.style.border = '1px solid #999'; td.style.padding = '3px 6px'; });
    c.querySelectorAll('pre').forEach(x => { x.style.fontFamily = 'Consolas, monospace'; x.style.background = '#f3f4f6'; x.style.padding = '6px'; });
    c.querySelectorAll('code').forEach(x => { x.style.fontFamily = 'Consolas, monospace'; });
    return c.innerHTML;
}

/** Scrive negli appunti HTML e testo. Senza Clipboard API (pagina non https, browser vecchio) usa l'evento copy. */
async function chatCopyRich(html, text) {
    try {
        if (navigator.clipboard?.write && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({
                'text/html':  new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([text], { type: 'text/plain' }),
            })]);
            return;
        }
    } catch { /* si prova con l'evento copy */ }
    const onCopy = (e) => { e.clipboardData.setData('text/html', html); e.clipboardData.setData('text/plain', text); e.preventDefault(); };
    document.addEventListener('copy', onCopy, { once: true });
    const ok = document.execCommand('copy');
    document.removeEventListener('copy', onCopy);
    if (!ok) throw new Error('the browser did not allow copying to the clipboard');
}

export function registerHTMDomElementNodes(LG) {
    if (!LG) return;

    const inEl = (node) => {
        const v = node.getInputData(node.findInputSlot('el'));
        if (!isEl(v)) throw new Error('no element in "el" (connect HTM/DOM/Query with a selector that matches something)');
        return v;
    };
    // nodi Set/Get: errori sulla porta d'errore del fork, done dopo l'effetto
    const actionNode = (Ctor, fn) => {
        Ctor.error_output = true;
        Ctor.prototype.onAction = function () {
            this.clearError?.();
            try { fn.call(this); }
            catch (err) { this.triggerError?.(err); return; }
            this.triggerSlot(this.findOutputSlot('done'));
        };
    };

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/On Event
    // ─────────────────────────────────────────────────────────────────────────
    const EVENTS = ['click', 'input', 'change', 'submit', 'keydown', 'focus', 'blur'];
    function OnEvent() {
        this.addProperty('event', 'click', 'string');
        this.addProperty('key',   '',      'string');
        this.addProperty('attr',  '',      'string');
        this.addWidget('combo', 'event', 'click', v => { this.properties.event = v; this._unbind(); }, { values: EVENTS, property: 'event' });
        this.addWidget('text',  'key',   '',      v => { this.properties.key = String(v ?? '').trim(); this._unbind(); }, { property: 'key' });
        this.addWidget('text',  'attr',  '',      v => { this.properties.attr = String(v ?? '').trim(); this._unbind(); }, { property: 'attr' });
        this.addInput('el', 'object');
        this.addOutput('trigger', LG.EVENT);
        // 'event' (l'evento DOM) e 'value' (attributo dell'elemento colpito): uscite opzionali
        this._bound = null; this._handler = null;
        this.color = COL_EVENT[0]; this.bgcolor = COL_EVENT[1];
        this.size = [220, 104];
    }
    OnEvent.title = 'DOM On Event';
    OnEvent.desc  = 'Listens to an event of an element already in the document (e.g. a button click, Ctrl+Enter in a textarea) and fires trigger';
    OnEvent.portHelp = {
        inputs: { el: 'DOM element to listen to, usually the output of HTM/DOM/Query (e.g. "#chat-send")' },
        outputs: {
            trigger: 'event — fired on every real user event on the element',
            event:   'object — the DOM event (Event/KeyboardEvent), to read its details (optional: right click → Outputs)',
            value:   "text — with 'attr' set: value of that attribute on the element hit, e.g. the data-help of the button clicked inside a container (optional: right click → Outputs)",
        },
        properties: {
            event: 'event to listen to: click, input (on every keystroke), change, submit (form), keydown (key pressed), focus, blur. click also fires with Enter or Space on an element with role="button" that is not a real button (e.g. <img role="button" tabindex="0">): then the "event" output is the keyboard event',
            key:   'keydown only: key to filter, with modifiers, e.g. Ctrl+Enter, Shift+Enter, Enter, Escape; empty = any key. The filtered key does not reach the field (no line break with Enter)',
            attr:  'optional, e.g. data-help: listen on a container (el) and fire only when the event hits an element inside it that has this attribute (the element itself or one of its parents within el); its value goes to the output value. One node serves all the buttons of a page. Empty = any event on el',
        },
    };
    OnEvent.prototype.onGetOutputs = function () {
        const out = [];
        if (this.findOutputSlot('event') === -1) out.push(['event', 'object', { removable: true }]);
        if (this.findOutputSlot('value') === -1) out.push(['value', 'string', { removable: true }]);
        return out;
    };
    OnEvent.prototype.onConfigure = function () {
        for (const o of this.outputs ?? []) if (o.name === 'event' || o.name === 'value') o.removable = true;
    };
    OnEvent.prototype._unbind = function () {
        if (this._bound && this._handler) this._bound.removeEventListener(this._evName, this._handler);
        if (this._bound && this._kbHandler) this._bound.removeEventListener('keydown', this._kbHandler);
        this._bound = null; this._handler = null; this._kbHandler = null;
    };
    OnEvent.prototype.onExecute = function () {
        const el = this.getInputData(0);
        if (el === this._bound) return;
        this._unbind();
        if (!isEl(el)) return;
        const ev = this.properties.event || 'click';
        const match = ev === 'keydown' ? keyMatcher(this.properties.key) : null;
        // attr: delega — solo eventi su un elemento (o un suo antenato dentro el) con quell'attributo
        const attr = /^[A-Za-z_][\w.:-]*$/.test(this.properties.attr || '') ? this.properties.attr : '';
        this._handler = (e) => {
            let hit = null;
            if (attr) {
                hit = e.target?.closest?.(`[${attr}]`);
                if (!hit || !el.contains(hit)) return;
            }
            if (match) { if (!match(e)) return; if (this.properties.key) e.preventDefault(); }
            if (ev === 'submit') e.preventDefault();          // un form non deve ricaricare la pagina
            const oi = this.findOutputSlot('event');
            if (oi !== -1) this.setOutputData(oi, e);
            const vi = this.findOutputSlot('value');
            if (vi !== -1) this.setOutputData(vi, hit ? (hit.getAttribute(attr) ?? '') : '');
            this.triggerSlot(this.findOutputSlot('trigger'));
        };
        this._evName = ev;
        el.addEventListener(ev, this._handler);
        // (2026-10-17) click anche da tastiera: Invio o Spazio su un elemento con role="button" che non
        // è un pulsante vero (es. <img role="button" tabindex="0">). I pulsanti, i link e i campi
        // generano già il click da soli: lì non si fa nulla, altrimenti l'evento arriverebbe due volte.
        if (ev === 'click') {
            this._kbHandler = (e) => {
                if ((e.key !== 'Enter' && e.key !== ' ') || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
                const t = e.target;
                if (!t?.matches?.('[role="button"]') || /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(t.tagName)) return;
                e.preventDefault();                           // Spazio non fa scorrere la pagina
                this._handler(e);
            };
            el.addEventListener('keydown', this._kbHandler);
        }
        this._bound = el;
    };
    OnEvent.prototype.onRemoved = function () { this._unbind(); };
    LG.registerNodeType('HTM/DOM/On Event', OnEvent);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Get Value
    // ─────────────────────────────────────────────────────────────────────────
    function GetValue() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('el', 'object');
        this.addOutput('done', LG.EVENT);
        this.addOutput('value', 0);
        this.color = COL_GET[0]; this.bgcolor = COL_GET[1];
        this.size = [200, 60];
    }
    GetValue.title = 'DOM Get Value';
    GetValue.desc  = 'On trigger reads the value of an element: the text typed in a field or textarea, true/false for a checkbox, the text for other elements';
    GetValue.portHelp = {
        inputs: {
            trigger: 'event — reads the value',
            el:      'DOM element (usually from HTM/DOM/Query, e.g. "#chat-prompt")',
        },
        outputs: {
            done:  'event — value read',
            value: 'text for fields, textarea, select and other elements; boolean for checkbox and radio',
            error: 'event — no element in "el". Port hidden by default: right click → Show error',
        },
    };
    actionNode(GetValue, function () {
        const el = inEl(this);
        let v;
        if (el.type === 'checkbox' || el.type === 'radio') v = !!el.checked;
        else if ('value' in el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) v = String(el.value ?? '');
        else v = el.textContent ?? '';
        this.setOutputData(this.findOutputSlot('value'), v);
    });
    LG.registerNodeType('HTM/DOM/Get Value', GetValue);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Set Value
    // ─────────────────────────────────────────────────────────────────────────
    function SetValue() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('el', 'object');
        this.addInput('value', 0);
        this.addOutput('done', LG.EVENT);
        this.color = COL_SET[0]; this.bgcolor = COL_SET[1];
        this.size = [200, 80];
    }
    SetValue.title = 'DOM Set Value';
    SetValue.desc  = 'On trigger sets the value of a field, textarea or checkbox (e.g. clears the prompt after sending)';
    SetValue.portHelp = {
        inputs: {
            trigger: 'event — sets the value',
            el:      'field, textarea, select or checkbox (usually from HTM/DOM/Query)',
            value:   'text for fields/textarea/select; boolean for checkbox and radio. Empty = clears the field',
        },
        outputs: {
            done:  'event — value set',
            error: 'event — no element, or the element is not a field. Port hidden by default: right click → Show error',
        },
    };
    actionNode(SetValue, function () {
        const el = inEl(this);
        const v = this.getInputData(this.findInputSlot('value'));
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!v;
        else if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.value = v == null ? '' : String(v);
        else throw new Error(`<${el.tagName.toLowerCase()}> is not a field: to write text use HTM/DOM/Set Text`);
    });
    LG.registerNodeType('HTM/DOM/Set Value', SetValue);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Set Text
    // ─────────────────────────────────────────────────────────────────────────
    function SetText() {
        this.addProperty('mode', 'replace', 'string');
        this.addProperty('tooltip', false, 'boolean');
        this.addProperty('format', 'text', 'string');
        this.addWidget('combo', 'mode', 'replace', v => { this.properties.mode = v; }, { values: ['replace', 'append'], property: 'mode' });
        this.addWidget('combo', 'format', 'text', v => { this.properties.format = v; }, { values: ['text', 'markdown'], property: 'format' });
        this.addWidget('toggle', 'tooltip', false, v => { this.properties.tooltip = !!v; }, { property: 'tooltip' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('el', 'object');
        this.addInput('text', 'string,number');   // anche numeri (es. running, wait_s), scritti come testo
        this.addOutput('done', LG.EVENT);
        this.color = COL_SET[0]; this.bgcolor = COL_SET[1];
        this.size = [200, 100];
    }
    SetText.title = 'DOM Set Text';
    SetText.desc  = 'On trigger writes text into an element (replaces or appends). Always as plain text: any tags do not become HTML';
    SetText.portHelp = {
        inputs: {
            trigger: 'event — writes the text',
            el:      'DOM element (usually from HTM/DOM/Query)',
            text:    'text (or number, written as text) to write; line breaks show if the element has white-space: pre-wrap in the CSS',
        },
        outputs: {
            done:  'event — text written',
            error: 'event — no element in "el". Port hidden by default: right click → Show error',
        },
        properties: {
            mode:    'replace: replaces the content · append: appends at the end',
            tooltip: 'on: the same text also becomes the tooltip (title) of the element, visible on mouse hover — useful with text truncated by CSS (text-overflow: ellipsis)',
            format:  'text: plain text · markdown: headings, bold, italic, code, lists, quotes, tables, http(s) links — converted into page elements without ever inserting HTML (text coming from a model cannot run anything); the container gets the "md" class',
        },
    };
    actionNode(SetText, function () {
        const el = inEl(this);
        const t = this.getInputData(this.findInputSlot('text'));
        const s = t == null ? '' : String(t);
        const md = this.properties.format === 'markdown';
        if (md) el.classList.add('md');
        if (this.properties.mode === 'append') el.append(md ? renderMarkdownDOM(s) : document.createTextNode(s));
        else if (md) el.replaceChildren(renderMarkdownDOM(s));
        else el.textContent = s;
        if (this.properties.tooltip) el.title = el.textContent;
    });
    LG.registerNodeType('HTM/DOM/Set Text', SetText);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Set Class
    // ─────────────────────────────────────────────────────────────────────────
    function SetClass() {
        this.addProperty('action', 'add', 'string');
        this.addWidget('combo', 'action', 'add', v => { this.properties.action = v; }, { values: ['add', 'remove', 'toggle'], property: 'action' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('el', 'object');
        this.addInput('class', 'string');
        this.addOutput('done', LG.EVENT);
        this.color = COL_SET[0]; this.bgcolor = COL_SET[1];
        this.size = [200, 100];
    }
    SetClass.title = 'DOM Set Class';
    SetClass.desc  = 'On trigger adds, removes or toggles one or more CSS classes of an element (to show/hide or change style)';
    SetClass.portHelp = {
        inputs: {
            trigger: 'event — applies',
            el:      'DOM element (usually from HTM/DOM/Query)',
            class:   'one or more space-separated classes, e.g. "d-none" or "active highlighted"',
        },
        outputs: {
            done:  'event — classes applied',
            error: 'event — no element or no class. Port hidden by default: right click → Show error',
        },
        properties: { action: 'add: adds · remove: removes · toggle: adds if missing, removes if present' },
    };
    actionNode(SetClass, function () {
        const el = inEl(this);
        const list = String(this.getInputData(this.findInputSlot('class')) ?? '').split(/\s+/).filter(Boolean);
        if (!list.length) throw new Error('no class in "class"');
        const a = this.properties.action;
        for (const c of list) {
            if (a === 'remove') el.classList.remove(c);
            else if (a === 'toggle') el.classList.toggle(c);
            else el.classList.add(c);
        }
    });
    LG.registerNodeType('HTM/DOM/Set Class', SetClass);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Set Attr
    // ─────────────────────────────────────────────────────────────────────────
    function SetAttr() {
        this.addProperty('attr', '', 'string');
        this.addWidget('text', 'attr', '', v => { this.properties.attr = String(v ?? '').trim(); }, { property: 'attr' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('el', 'object');
        this.addInput('value', 0);
        this.addOutput('done', LG.EVENT);
        this.color = COL_SET[0]; this.bgcolor = COL_SET[1];
        this.size = [200, 100];
    }
    SetAttr.title = 'DOM Set Attr';
    SetAttr.desc  = 'On trigger sets or removes an attribute of an element (e.g. disabled, placeholder, src, title). Attributes that would run code are rejected';
    SetAttr.portHelp = {
        inputs: {
            trigger: 'event — applies',
            el:      'DOM element (usually from HTM/DOM/Query)',
            value:   'text = attribute value; true = attribute present without value (e.g. disabled); false, null or empty = attribute removed',
        },
        outputs: {
            done:  'event — attribute applied',
            error: 'event — no element, invalid name, or attribute/URL not allowed (on…, srcdoc, javascript:). Port hidden by default: right click → Show error',
        },
        properties: { attr: 'attribute name, e.g. disabled, placeholder, src, title, aria-label' },
    };
    actionNode(SetAttr, function () {
        const el = inEl(this);
        const name = this.properties.attr;
        const v = this.getInputData(this.findInputSlot('value'));
        const why = attrAllowed(name, v);
        if (why) throw new Error(why);
        if (v === false || v == null || v === '') el.removeAttribute(name);
        else el.setAttribute(name, v === true ? '' : String(v));
    });
    LG.registerNodeType('HTM/DOM/Set Attr', SetAttr);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Get Image — immagine scelta con <input type="file">, oppure un <img> della pagina
    // ─────────────────────────────────────────────────────────────────────────
    function GetImage() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('el', 'object');
        this.addOutput('done', LG.EVENT);
        this.addOutput('image', 'image');
        this._objectUrl = null;   // URL temporaneo del file letto per ultimo (liberato al successivo)
        this._seq = 0;
        this.color = COL_GET[0]; this.bgcolor = COL_GET[1];
        this.size = [200, 60];
    }
    GetImage.error_output = true;
    GetImage.title = 'DOM Get Image';
    GetImage.desc  = 'On trigger reads an image from the page: the file chosen in an <input type="file"> (e.g. from the user\'s computer) or an <img>. The output is an image usable by AI/ComfyUI/Run, Media/Image/Info, DOM Set Image…';
    GetImage.portHelp = {
        inputs: {
            trigger: 'event — reads the image (e.g. from the change event of DOM On Event on the file field)',
            el:      'DOM element: <input type="file"> (the first chosen file is read) or <img> (usually from HTM/DOM/Query)',
        },
        outputs: {
            done:  'event — image ready',
            image: 'image (HTMLImageElement)',
            url:   'text — address of the image read (optional: right click → Outputs): for a file from the computer a temporary blob: address, valid in this page (also for the other panels of the dashboard) until another file is read; for an <img> its src. E.g. to App Bus Emitter → TJS/Texture/Load in another panel',
            error: 'event — no element, no file chosen, file that is not an image or not readable. Port hidden by default: right click → Show error',
        },
    };
    GetImage.prototype.onGetOutputs = function () {
        return this.findOutputSlot('url') === -1 ? [['url', 'string', { removable: true }]] : [];
    };
    GetImage.prototype.onConfigure = function () {
        const s = this.outputs?.find(o => o.name === 'url');
        if (s) s.removable = true;
    };
    GetImage.prototype.onAction = async function () {
        const seq = ++this._seq;
        this.clearError?.();
        let img, src = null;
        try {
            const el = inEl(this);
            if (el.tagName === 'INPUT' && el.type === 'file') {
                const file = el.files?.[0];
                if (!file) throw new Error('no file chosen');
                if (file.type && !file.type.startsWith('image/')) throw new Error(`"${file.name}" is not an image (${file.type})`);
                const url = URL.createObjectURL(file);
                img = await new Promise((resolve, reject) => {
                    const i = new Image();
                    i.onload = () => resolve(i);
                    i.onerror = () => reject(new Error(`image not readable: ${file.name}`));
                    i.src = url;
                });
                if (seq !== this._seq) { URL.revokeObjectURL(url); return; }
                if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);   // il file precedente non serve più
                this._objectUrl = url;
                src = url;
            } else if (el.tagName === 'IMG') {
                if (!el.getAttribute('src')) throw new Error('<img> without an image');
                if (!(el.complete && el.naturalWidth)) {
                    await new Promise((resolve, reject) => {
                        el.addEventListener('load', resolve, { once: true });
                        el.addEventListener('error', () => reject(new Error('<img> image not loaded')), { once: true });
                    });
                }
                img = el;
                src = el.currentSrc || el.src;
            } else {
                throw new Error(`<${el.tagName.toLowerCase()}> does not contain an image: use <input type="file"> or <img>`);
            }
        } catch (err) { if (seq === this._seq) this.triggerError?.(err); return; }
        if (seq !== this._seq) return;
        this.setOutputData(this.findOutputSlot('image'), img);
        const ui = this.findOutputSlot('url');
        if (ui !== -1) this.setOutputData(ui, src);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    GetImage.prototype.onRemoved = function () {
        if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
        this._objectUrl = null;
    };
    LG.registerNodeType('HTM/DOM/Get Image', GetImage);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Get Files (2026-10-15) — documenti e immagini scelti in un <input type="file">:
    // testo di txt/md/csv/json/pdf/rtf in un'unica uscita, immagini a parte (es. per AI/Ollama/Chat)
    // ─────────────────────────────────────────────────────────────────────────
    function GetFiles() {
        this.addProperty('max_chars', 200000, 'number');
        this.addWidget('number', 'max_chars', 200000, v => { this.properties.max_chars = Math.max(1000, Math.round(v)); },
                       { min: 1000, max: 2000000, step: 100000, precision: 0, property: 'max_chars' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('el', 'object');
        this.addOutput('done',   LG.EVENT);
        this.addOutput('text',   'string');
        this.addOutput('images', 'array');
        this.addOutput('names',  'array');
        this.addOutput('note',   'string');
        this._urls = [];   // URL temporanei delle immagini lette per ultime (liberati alla lettura successiva)
        this._seq = 0;
        this.color = COL_GET[0]; this.bgcolor = COL_GET[1];
        this.size = [220, 150];
    }
    GetFiles.error_output = true;
    GetFiles.title = 'DOM Get Files';
    GetFiles.desc  = 'On trigger reads the files chosen in an <input type="file"> (also "multiple"): the text of txt, md, csv, json, pdf and rtf documents in one output, the images in another. No file chosen: empty outputs (useful to clear the attachments after sending)';
    GetFiles.portHelp = {
        inputs: {
            trigger: 'event — reads the files (e.g. from the change event of DOM On Event on the file field)',
            el:      '<input type="file"> (usually from HTM/DOM/Query)',
            allow_images: 'boolean — whether images are wanted, e.g. "vision" of AI/Ollama/Model Info. On every trigger it sets the "accept" attribute of the field (false: the file dialog offers only documents) and false ignores the images already chosen, saying why. Not connected: the field is left as written in the page (optional: right click → Inputs)',
        },
        outputs: {
            done:   'event — files read (also when none is chosen: empty outputs)',
            text:   'text — the documents one after the other, each preceded by "### File: <name>"; empty if there are none. PDF: only the text layer (a scanned PDF has none)',
            images: 'array of images (HTMLImageElement) — the chosen images, e.g. for the "images" input of AI/Ollama/Chat',
            names:  'array of texts — names of the files read',
            note:   'text — one line for the page, e.g. "📎 report.pdf · photo.jpg"; ignored files are listed with the reason; empty if no file is chosen',
            error:  'event — no element, element that is not a file field, file that cannot be read. Port hidden by default: right click → Show error',
        },
        properties: {
            max_chars: 'maximum characters per document: a longer text is cut (the note says so). A model reads a limited amount of text anyway (num_ctx of Ollama Chat)',
        },
    };
    GetFiles.prototype.onAction = async function () {
        const seq = ++this._seq;
        this.clearError?.();
        const max = Math.max(1000, Math.round(Number(this.properties.max_chars) || 200000));
        const docs = [], images = [], names = [], notes = [], skipped = [], urls = [];
        try {
            const el = inEl(this);
            if (!(el.tagName === 'INPUT' && el.type === 'file')) throw new Error(`<${el.tagName.toLowerCase()}> is not a file field: use <input type="file">`);
            const ai = this.findInputSlot('allow_images');
            const allow = ai === -1 || !this.isInputConnected(ai) ? null : !!this.getInputData(ai);
            if (allow !== null) el.accept = allow ? `${DOC_ACCEPT},image/*` : DOC_ACCEPT;
            for (const file of el.files ?? []) {
                const kind = fileKind(file);
                if (kind === 'image' && allow === false) {
                    skipped.push(`${file.name} (the chosen model does not read images)`);
                } else if (kind === 'image') {
                    const url = URL.createObjectURL(file);
                    urls.push(url);
                    images.push(await new Promise((resolve, reject) => {
                        const i = new Image();
                        i.onload = () => resolve(i);
                        i.onerror = () => reject(new Error(`image not readable: ${file.name}`));
                        i.src = url;
                    }));
                    names.push(file.name); notes.push(file.name);
                } else if (kind) {
                    let text = kind === 'pdf' ? await pdfText(file) : kind === 'rtf' ? rtfText(await file.text()) : await file.text();
                    text = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
                    let label = file.name;
                    if (!text) label += kind === 'pdf' ? ' (no text: scanned PDF?)' : ' (empty)';
                    else if (text.length > max) { text = text.slice(0, max); label += ` (cut at ${max} characters)`; }
                    if (text) docs.push(`### File: ${file.name}\n\n${text}`);
                    names.push(file.name); notes.push(label);
                } else {
                    skipped.push(/\.docx?$/i.test(file.name) ? `${file.name} (Word: save it as PDF)` : `${file.name} (format not supported)`);
                }
                if (seq !== this._seq) { urls.forEach(u => URL.revokeObjectURL(u)); return; }
            }
        } catch (err) {
            urls.forEach(u => URL.revokeObjectURL(u));
            if (seq === this._seq) this.triggerError?.(err);
            return;
        }
        if (seq !== this._seq) { urls.forEach(u => URL.revokeObjectURL(u)); return; }
        this._urls.forEach(u => URL.revokeObjectURL(u));   // le immagini precedenti non servono più
        this._urls = urls;
        let note = notes.length ? '📎 ' + notes.join(' · ') : '';
        if (skipped.length) note += (note ? ' — ' : '') + 'ignored: ' + skipped.join(', ');
        const out = (n, v) => this.setOutputData(this.findOutputSlot(n), v);
        out('text', docs.join('\n\n'));
        out('images', images);
        out('names', names);
        out('note', note);
        this.triggerSlot(this.findOutputSlot('done'));
    };
    GetFiles.prototype.onConfigure = function () {
        const s = this.inputs?.find(i => i.name === 'allow_images');
        if (s) s.removable = true;
    };
    GetFiles.prototype.onGetInputs = function () {
        return this.findInputSlot('allow_images') === -1 ? [['allow_images', 'boolean', { removable: true }]] : [];
    };
    GetFiles.prototype.onRemoved = function () {
        this._urls.forEach(u => URL.revokeObjectURL(u));
        this._urls = [];
    };
    LG.registerNodeType('HTM/DOM/Get Files', GetFiles);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Set Image — mostra un'immagine in un <img> o in un <canvas>
    // ─────────────────────────────────────────────────────────────────────────
    function SetImage() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('el', 'object');
        this.addInput('image', 'image');
        this.addOutput('done', LG.EVENT);
        this.color = COL_SET[0]; this.bgcolor = COL_SET[1];
        this.size = [200, 80];
    }
    SetImage.title = 'DOM Set Image';
    SetImage.desc  = 'On trigger shows an image in an <img> or <canvas> of the page (e.g. the result of AI/ComfyUI/Run); with an empty image it removes it';
    SetImage.portHelp = {
        inputs: {
            trigger: 'event — shows the image',
            el:      '<img> (takes the image address) or <canvas> (the image is drawn fitted, without distortion) — usually from HTM/DOM/Query',
            image:   'image (HTMLImageElement, canvas or video) — e.g. an image output of AI/ComfyUI/Run or DOM Get Image. Empty = removes the image',
        },
        outputs: {
            done:  'event — image shown (or removed)',
            error: 'event — no element, element that is not <img> or <canvas>, image from another site without CORS permission (canvas/video only). Port hidden by default: right click → Show error',
        },
    };
    /** Indirizzo da dare a un <img>: quello dell'immagine, oppure un'istantanea PNG di canvas/video. */
    function imageSrc(image) {
        const tag = String(image.tagName || '').toUpperCase();
        if (tag === 'CANVAS') return image.toDataURL('image/png');
        if (tag === 'VIDEO') {
            const c = document.createElement('canvas');
            c.width = image.videoWidth; c.height = image.videoHeight;
            c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
            return c.toDataURL('image/png');
        }
        const src = image.currentSrc || image.src;
        if (!src) throw new Error('image without an address');
        return src;
    }
    actionNode(SetImage, function () {
        const el = inEl(this);
        const image = this.getInputData(this.findInputSlot('image'));
        if (el.tagName === 'IMG') {
            if (image == null) { el.removeAttribute('src'); return; }
            const src = imageSrc(image);
            if (el.src !== src) el.src = src;
        } else if (el.tagName === 'CANVAS') {
            const ctx = el.getContext('2d');
            ctx.clearRect(0, 0, el.width, el.height);
            if (image == null) return;
            const w = image.naturalWidth || image.videoWidth || image.width, h = image.naturalHeight || image.videoHeight || image.height;
            if (!w || !h) throw new Error('image empty or not loaded yet');
            const k = Math.min(el.width / w, el.height / h);
            ctx.drawImage(image, (el.width - w * k) / 2, (el.height - h * k) / 2, w * k, h * k);
        } else {
            throw new Error(`<${el.tagName.toLowerCase()}> cannot show an image: use <img> or <canvas>`);
        }
    });
    LG.registerNodeType('HTM/DOM/Set Image', SetImage);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Set Options — riempie un <select>
    // ─────────────────────────────────────────────────────────────────────────
    function SetOptions() {
        this.addInput('trigger', LG.ACTION);
        this.addInput('el', 'object');
        this.addInput('options', 'array');
        this.addInput('selected', 'string');
        this.addOutput('done', LG.EVENT);
        this.color = COL_SET[0]; this.bgcolor = COL_SET[1];
        this.size = [210, 100];
    }
    SetOptions.title = 'DOM Set Options';
    SetOptions.desc  = 'On trigger fills a <select> of the page with a list of items (e.g. the models installed in Ollama) and picks the one to select';
    SetOptions.portHelp = {
        inputs: {
            trigger:  'event — fills the menu',
            el:       '<select> element (usually from HTM/DOM/Query)',
            options:  'array of strings (value and visible text are the same) or of objects { value, label }',
            selected: 'text — value to select; if not connected or not in the list the current choice is kept (if still present), otherwise the first item',
        },
        outputs: {
            done:  'event — menu filled (read the chosen item with DOM Get Value)',
            error: 'event — no element, element that is not a <select>, options is not an array. Port hidden by default: right click → Show error',
        },
    };
    actionNode(SetOptions, function () {
        const el = inEl(this);
        if (el.tagName !== 'SELECT') throw new Error(`<${el.tagName.toLowerCase()}> is not a menu: use a <select>`);
        const opts = this.getInputData(this.findInputSlot('options'));
        if (!Array.isArray(opts)) throw new Error('"options" must be an array');
        const want = this.getInputData(this.findInputSlot('selected'));
        const keep = el.value;
        el.replaceChildren(...opts.map(o => {
            const op = document.createElement('option');
            const value = (o && typeof o === 'object') ? String(o.value ?? '') : String(o ?? '');
            op.value = value;
            op.textContent = (o && typeof o === 'object') ? String(o.label ?? value) : value;
            return op;
        }));
        const values = opts.map(o => (o && typeof o === 'object') ? String(o.value ?? '') : String(o ?? ''));
        if (want != null && values.includes(String(want))) el.value = String(want);
        else if (values.includes(keep)) el.value = keep;
    });
    LG.registerNodeType('HTM/DOM/Set Options', SetOptions);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Chat View
    // ─────────────────────────────────────────────────────────────────────────
    function ChatView() {
        this.addProperty('user_label',      'You',        'string');
        this.addProperty('assistant_label', 'Assistant',  'string');
        this.addProperty('format',          'markdown',   'string');
        this.addProperty('copy_label',      'Copy',       'string');
        this.addWidget('text', 'user_label',      'You',        v => { this.properties.user_label = String(v ?? ''); },      { property: 'user_label' });
        this.addWidget('text', 'assistant_label', 'Assistant',  v => { this.properties.assistant_label = String(v ?? ''); }, { property: 'assistant_label' });
        this.addWidget('combo', 'format', 'markdown', v => { this.properties.format = v; }, { values: ['markdown', 'text'], property: 'format' });
        this.addWidget('text', 'copy_label', 'Copy', v => { this.properties.copy_label = String(v ?? ''); }, { property: 'copy_label' });
        this.addInput('add_user',     LG.ACTION);
        this.addInput('update_reply', LG.ACTION);
        this.addInput('clear',        LG.ACTION);
        this.addInput('parent',  'object');
        this.addInput('prompt',  'string');
        this.addInput('partial', 'string');
        this.addInput('copy_all', LG.ACTION);
        this.addOutput('done', LG.EVENT);
        this.addOutput('el',   'object');
        this.addOutput('copied', LG.EVENT);
        this._root = null;     // <div class="chat-view"> creato dal nodo
        this._reply = null;    // fumetto della risposta in corso
        this.color = COL_UI[0]; this.bgcolor = COL_UI[1];
        this.size = [240, 200];
    }
    ChatView.error_output = true;
    ChatView.title = 'DOM Chat View';
    ChatView.desc  = 'Shows a chat dialog with bubbles: adds the user messages and writes the reply as it arrives (for AI/Ollama/Chat). Replies in Markdown (headings, lists, tables, code…) converted into page elements without ever inserting HTML, or plain text. CSS classes: msg, msg-user, msg-assistant, msg-role, msg-body, md';
    ChatView.portHelp = {
        inputs: {
            add_user:     'event — adds a bubble with the text of "prompt" (the user message); the next reply goes into a new bubble',
            update_reply: 'event — writes "partial" into the bubble of the current reply (creates it if missing). Connect chunk of Ollama Chat: it arrives while the reply grows and one last time, with the full text, before done (an input accepts only one wire: no need to connect done too)',
            clear:        'event — clears the dialog (e.g. with the reset of Ollama Chat)',
            parent:       'element in which to show the dialog, usually HTM/DOM/Query on a scrolling box (e.g. "#chat-log"); if not connected, the document container',
            prompt:       'text of the user message (read by add_user)',
            partial:      'text of the reply so far (read by update_reply): partial or response of Ollama Chat',
            copy_all:     'event — copies the whole conversation to the clipboard, e.g. from DOM On Event (click) on a "Copy conversation" button: formatted (Word, mail) and plain text (Notepad) together',
        },
        outputs: {
            done:   'event — dialog updated',
            el:     'the <div class="chat-view"> that contains the bubbles',
            copied: 'event — a reply or the whole conversation has been copied to the clipboard',
            error:  'event — no HTM document in which to show the dialog, or copy refused by the browser. Port hidden by default: right click → Show error',
        },
        properties: {
            user_label:      'label above the user messages',
            assistant_label: 'label above the replies',
            format:          'markdown: replies are formatted (headings, bold, lists, tables, code, http(s) links) without ever inserting HTML · text: plain text. User messages always stay plain text',
            copy_label:      'tooltip and accessible name of the copy button on each reply (class msg-copy), e.g. "Copia"; empty = no button',
        },
    };
    // Flow salvati prima del 2026-10-11: aggiunge le porte di copia se mancano
    ChatView.prototype.onConfigure = function () {
        if (this.findInputSlot('copy_all') === -1) this.addInput('copy_all', LG.ACTION);
        if (this.findOutputSlot('copied') === -1) this.addOutput('copied', LG.EVENT);
        if (this.properties.copy_label == null) this.properties.copy_label = 'Copy';
    };
    ChatView.prototype._parent = function () {
        const p = this.getInputData(this.findInputSlot('parent'));
        return isEl(p) ? p : (this.graph?._appContext?.container ?? null);
    };
    ChatView.prototype._ensureRoot = function () {
        const parent = this._parent();
        if (!parent) throw new Error('no HTM document: the flow must be attached to an HTM object in flow mode');
        if (!this._root) { this._root = document.createElement('div'); this._root.className = 'chat-view'; }
        if (this._root.parentElement !== parent) parent.appendChild(this._root);
        this.setOutputData(this.findOutputSlot('el'), this._root);
        return parent;
    };
    ChatView.prototype._bubble = function (role) {
        const d = document.createElement('div');
        d.className = `msg msg-${role}`;
        const label = role === 'user' ? this.properties.user_label : this.properties.assistant_label;
        if (label) { const r = document.createElement('span'); r.className = 'msg-role'; r.textContent = label; d.append(r); }
        // Pulsante di copia sulle risposte (copy_label vuoto = nessun pulsante)
        const copyLabel = String(this.properties.copy_label ?? '').trim();
        if (role === 'assistant' && copyLabel) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'msg-copy';
            b.title = copyLabel;
            b.setAttribute('aria-label', copyLabel);
            b.textContent = '⧉';
            b.style.cssText = 'float:right;border:0;background:transparent;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;color:inherit;opacity:.7';
            b.addEventListener('click', () => this._copy([d], b));
            d.append(b);
        }
        d._body = document.createElement('div');
        d._body.className = 'msg-body';
        d.append(d._body);
        this._root.append(d);
        return d;
    };
    /** Copia i fumetti indicati (uno solo: senza etichette; più d'uno: "Etichetta:" prima di ognuno). */
    ChatView.prototype._copy = async function (bubbles, btn) {
        const parts = bubbles.filter(b => b._body);
        if (!parts.length) return;
        const many = parts.length > 1;
        const text = parts.map(b => {
            const lab = b.querySelector('.msg-role')?.textContent ?? '';
            return (many && lab ? lab + ':\n' : '') + chatPlain(b._body);
        }).join('\n\n');
        const html = parts.map(b => {
            const lab = b.querySelector('.msg-role')?.textContent ?? '';
            return (many && lab ? `<p><b>${chatEsc(lab)}</b></p>` : '') + `<div>${chatHtml(b._body)}</div>`;
        }).join('');
        try {
            await chatCopyRich(html, text);
            if (btn) { const old = btn.textContent; btn.textContent = '✓'; setTimeout(() => { btn.textContent = old; }, 1500); }
            this.triggerSlot(this.findOutputSlot('copied'));
        } catch (err) {
            this.triggerError?.(err);
        }
    };
    /** Testo del fumetto: Markdown (solo risposte, se format = markdown) o testo semplice. */
    ChatView.prototype._setBody = function (bubble, text, markdown) {
        const s = text == null ? '' : String(text);
        if (markdown) { bubble._body.classList.add('md'); bubble._body.replaceChildren(renderMarkdownDOM(s)); }
        else bubble._body.textContent = s;
    };
    /** Scorre in fondo se l'utente era già in fondo (non lo strappa se è risalito a leggere). */
    ChatView.prototype._scroll = function (scroller, wasAtBottom) {
        if (wasAtBottom) scroller.scrollTop = scroller.scrollHeight;
    };
    ChatView.prototype.onAction = function (action) {
        this.clearError?.();
        let scroller;
        try { scroller = this._ensureRoot(); }
        catch (err) { this.triggerError?.(err); return; }
        const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
        if (action === 'clear') {
            this._root.replaceChildren();
            this._reply = null;
        } else if (action === 'add_user') {
            const t = String(this.getInputData(this.findInputSlot('prompt')) ?? '').trim();   // es. nota allegati vuota
            this._reply = null;
            this._setBody(this._bubble('user'), t, false);
        } else if (action === 'update_reply') {
            const t = this.getInputData(this.findInputSlot('partial'));
            if (!this._reply) this._reply = this._bubble('assistant');
            this._setBody(this._reply, t, this.properties.format !== 'text');
        } else if (action === 'copy_all') {
            this._copy([...this._root.querySelectorAll(':scope > .msg')], null);
            return;
        }
        this._scroll(scroller, atBottom || action === 'add_user');
        this.triggerSlot(this.findOutputSlot('done'));
    };
    ChatView.prototype.onRemoved = function () { try { this._root?.remove(); } catch {} this._root = null; this._reply = null; };
    LG.registerNodeType('HTM/DOM/Chat View', ChatView);
    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Button Row (2026-10-21)
    // ─────────────────────────────────────────────────────────────────────────
    const BTN_VARIANTS = ['outline-primary', 'primary', 'outline-secondary', 'secondary', 'light', 'link'];
    function ButtonRow() {
        this.addProperty('labelField', 'label', 'string');
        this.addProperty('valueField', '', 'string');
        this.addProperty('iconField', 'icon', 'string');
        this.addProperty('titleField', 'title', 'string');
        this.addProperty('variant', 'outline-primary', 'string');
        this.addProperty('small', true, 'boolean');
        this.addProperty('mode', 'buttons', 'string');
        this.addProperty('wrap', true, 'boolean');
        this.addProperty('label', '', 'string');
        const txt = (name) => this.addWidget('text', name, this.properties[name], v => { this.properties[name] = String(v ?? '').trim(); }, { property: name });
        txt('labelField'); txt('valueField'); txt('iconField'); txt('titleField');
        this.addWidget('combo', 'variant', 'outline-primary', v => { this.properties.variant = v; }, { values: BTN_VARIANTS, property: 'variant' });
        this.addWidget('toggle', 'small', true, v => { this.properties.small = !!v; }, { property: 'small' });
        this.addWidget('combo', 'mode', 'buttons', v => { this.properties.mode = v; }, { values: ['buttons', 'toggle'], property: 'mode' });
        this.addWidget('toggle', 'wrap', true, v => { this.properties.wrap = !!v; }, { property: 'wrap' });
        txt('label');
        this.addInput('trigger', LG.ACTION);
        this.addInput('parent', 'object');
        this.addInput('items', 'array');
        this.addOutput('done', LG.EVENT);
        this.addOutput('click', LG.EVENT);
        this.addOutput('value', 0);
        this.addOutput('item', 0);
        this.addOutput('index', 'number');
        this._root = null;
        this.color = COL_UI[0]; this.bgcolor = COL_UI[1];
        this.size = [240, 300];
    }
    ButtonRow.error_output = true;
    ButtonRow.title = 'DOM Button Row';
    ButtonRow.desc  = 'Creates a row of buttons from an array (texts, or objects with label, value, icon, title fields) and replaces it at every new array; a click fires click with the value, the item and its position. For menus of choices, filters, tabs, lists of links. CSS classes: ra-btnrow, ra-btnrow-wrap';
    ButtonRow.portHelp = {
        inputs: {
            trigger: 'event — (re)builds the row from "items"',
            parent:  'element in which to put the row, usually HTM/DOM/Query (e.g. "#links"); if not connected, the document container',
            items:   'array — strings (each one is label and value) or objects (fields chosen with the widgets, e.g. the items of URL Describe List). Empty array = no buttons',
        },
        outputs: {
            done:  'event — row built',
            click: 'event — fired at every click on a button (also with the keyboard)',
            value: 'the value of the button clicked: the field "valueField" of the item, or the whole item if valueField is empty, or the string',
            item:  'the whole item of the button clicked (object or string)',
            index: 'number — position of the button clicked, from 0',
            error: 'event — no HTM document to put the row in. Port hidden by default: right click → Show error',
        },
        properties: {
            labelField: 'field of the objects shown as text of the button (default "label")',
            valueField: 'field of the objects given as value (e.g. "url"); empty = the whole item',
            iconField:  'field with a Bootstrap icon class, e.g. "bi-file-earmark-pdf" (default "icon"); empty or missing = no icon',
            titleField: 'field shown as tooltip (default "title"); missing = the label',
            variant:    'look of the buttons (Bootstrap classes btn-…)',
            small:      'on = small buttons (btn-sm)',
            mode:       'buttons = plain buttons · toggle = the clicked button stays active (aria-pressed), like a tab',
            wrap:       'on = the buttons go on a new line when the row is full · off = one line that scrolls sideways',
            label:      'accessible name of the group of buttons, read by screen readers (e.g. "Links of the theatre")',
        },
    };
    ButtonRow.prototype.onAction = function () {
        this.clearError?.();
        const p = this.getInputData(this.findInputSlot('parent'));
        const parent = isEl(p) ? p : (this.graph?._appContext?.container ?? null);
        if (!isEl(parent) || parent instanceof HTMLIFrameElement) { this.triggerError?.(new Error('no HTM document: connect "parent" or use the flow of an HTM object in flow mode')); return; }
        const items = this.getInputData(this.findInputSlot('items'));
        const list = Array.isArray(items) ? items : [];
        const P = this.properties;
        const root = this._root && this._root.parentNode === parent ? this._root : document.createElement('div');
        root.className = 'ra-btnrow' + (P.wrap ? ' ra-btnrow-wrap' : '');
        root.setAttribute('role', 'group');
        if (P.label) root.setAttribute('aria-label', P.label); else root.removeAttribute('aria-label');
        root.replaceChildren();
        const field = (it, name) => (name && it && typeof it === 'object' ? it[name] : undefined);
        list.forEach((it, i) => {
            const isObj = it && typeof it === 'object';
            const label = String((isObj ? field(it, P.labelField) ?? it.label : it) ?? '').trim() || `#${i + 1}`;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `btn btn-${BTN_VARIANTS.includes(P.variant) ? P.variant : 'outline-primary'}${P.small ? ' btn-sm' : ''}`;
            const icon = String(field(it, P.iconField) ?? '');
            if (/^bi-[\w-]+$/.test(icon)) {
                const ic = document.createElement('i');
                ic.className = `bi ${icon}`;
                ic.setAttribute('aria-hidden', 'true');
                b.append(ic, ' ');
            }
            const span = document.createElement('span');
            span.className = 'ra-btnrow-label';
            span.textContent = label;
            b.append(span);
            b.title = String(field(it, P.titleField) ?? label);
            if (P.mode === 'toggle') b.setAttribute('aria-pressed', 'false');
            b.addEventListener('click', () => {
                if (P.mode === 'toggle') root.querySelectorAll('button').forEach(x => {
                    const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', String(on));
                });
                const value = isObj ? (P.valueField ? field(it, P.valueField) : it) : it;
                this.setOutputData(this.findOutputSlot('value'), value ?? null);
                this.setOutputData(this.findOutputSlot('item'), it);
                this.setOutputData(this.findOutputSlot('index'), i);
                this.triggerSlot(this.findOutputSlot('click'));
            });
            root.append(b);
        });
        if (!root.parentNode) parent.append(root);
        this._root = root;
        this.triggerSlot(this.findOutputSlot('done'));
    };
    ButtonRow.prototype.onRemoved = function () { try { this._root?.remove(); } catch {} this._root = null; };
    LG.registerNodeType('HTM/DOM/Button Row', ButtonRow);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/Set HTML (2026-10-21)
    // ─────────────────────────────────────────────────────────────────────────
    function SetHTML() {
        this.addProperty('mode', 'replace', 'string');
        this.addProperty('styles', false, 'boolean');
        this.addProperty('toTop', true, 'boolean');
        this.addWidget('combo', 'mode', 'replace', v => { this.properties.mode = v; }, { values: ['replace', 'append'], property: 'mode' });
        this.addWidget('toggle', 'styles', false, v => { this.properties.styles = !!v; }, { property: 'styles' });
        this.addWidget('toggle', 'toTop', true, v => { this.properties.toTop = !!v; }, { property: 'toTop' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('el', 'object');
        this.addInput('html', 'string');
        this.addOutput('done', LG.EVENT);
        this.color = COL_SET[0]; this.bgcolor = COL_SET[1];
        this.size = [200, 125];
    }
    SetHTML.title = 'DOM Set HTML';
    SetHTML.desc  = 'On trigger writes HTML into an element (e.g. a Wikipedia article): headings, links, images and tables stay, everything that could run code is removed first (scripts, frames, on… attributes, javascript: addresses)';
    SetHTML.portHelp = {
        inputs: {
            trigger: 'event — writes the HTML',
            el:      'DOM element (usually from HTM/DOM/Query, e.g. "#article")',
            html:    'string — HTML to write (e.g. html of Web Wikipedia Article). Empty = clears the element (replace)',
        },
        outputs: {
            done:  'event — HTML written',
            error: 'event — no element in "el". Port hidden by default: right click → Show error',
        },
        properties: {
            mode:   'replace = replaces the content · append = adds at the end',
            styles: 'off (default) = <style> blocks are removed too: a style coming from outside would change the whole dashboard · on = kept (only for HTML you wrote)',
            toTop:  'on (default, replace only) = after writing, the element and the box that scrolls it go back to the top: a new article does not appear already scrolled'
        },
    };
    actionNode(SetHTML, function () {
        const el = inEl(this);
        const html = String(this.getInputData(this.findInputSlot('html')) ?? '');
        const { fragment, removed } = sanitizeHTML(html, { stripStyles: !this.properties.styles });
        if (removed) console.warn(`[HTM/DOM/Set HTML] removed ${removed} executable elements/attributes`);
        if (this.properties.mode === 'append') { el.append(fragment); return; }
        el.replaceChildren(fragment);
        if (this.properties.toTop) {
            // l'elemento e i suoi antenati che scorrono, fino al contenitore del documento HTM
            for (let n = el; n && n !== document.body; n = n.parentElement) {
                if (n.scrollTop) n.scrollTop = 0;
                if (n.classList?.contains('htm-inject')) break;
            }
        }
    });
    LG.registerNodeType('HTM/DOM/Set HTML', SetHTML);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/DOM/On Selection (2026-10-21) — sorgente di eventi, come On Event
    // ─────────────────────────────────────────────────────────────────────────
    function OnSelection() {
        this.addProperty('minLength', 2, 'number');
        this.addWidget('number', 'minLength', 2, v => { this.properties.minLength = Math.max(1, Math.round(Number(v) || 1)); }, { min: 1, max: 1000, step: 10, precision: 0, property: 'minLength' });
        this.addInput('el', 'object');
        this.addOutput('trigger', LG.EVENT);
        this.addOutput('text', 'string');
        this._bound = null; this._off = null; this._last = '';
        this.color = COL_EVENT[0]; this.bgcolor = COL_EVENT[1];
        this.size = [210, 80];
    }
    OnSelection.title = 'DOM On Selection';
    OnSelection.desc  = 'Fires when the user selects some text inside an element (with the mouse or the keyboard) and gives the selected text. Works on the document of the panel (flow mode), not inside an iframe of another site';
    OnSelection.portHelp = {
        inputs: { el: 'element to watch, usually HTM/DOM/Query (e.g. "#article"); if not connected, the whole document of the panel' },
        outputs: {
            trigger: 'event — fired when a new selection of at least "minLength" characters ends inside el',
            text:    'string — the selected text, trimmed',
        },
        properties: { minLength: 'minimum number of characters (default 2): a simple click does not count' },
    };
    OnSelection.prototype._unbind = function () { this._off?.(); this._off = null; this._bound = null; };
    OnSelection.prototype.onExecute = function () {
        const v = this.getInputData(0);
        const el = isEl(v) ? v : (this.graph?._appContext?.container ?? null);
        if (el === this._bound) return;
        this._unbind();
        if (!isEl(el) || el instanceof HTMLIFrameElement) return;
        let timer = 0;
        const check = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const sel = window.getSelection?.();
                if (!sel || sel.isCollapsed || !sel.rangeCount) { this._last = ''; return; }
                const r = sel.getRangeAt(0);
                if (!el.contains(r.commonAncestorContainer)) return;
                const text = String(sel).replace(/\s+/g, ' ').trim();
                if (text.length < (this.properties.minLength || 1) || text === this._last) return;
                this._last = text;
                this.setOutputData(this.findOutputSlot('text'), text);
                this.triggerSlot(this.findOutputSlot('trigger'));
            }, 200);
        };
        const onKey = (e) => { if (e.shiftKey || e.key === 'Shift') check(); };
        el.addEventListener('mouseup', check);
        el.addEventListener('keyup', onKey);
        el.addEventListener('touchend', check);
        this._off = () => {
            clearTimeout(timer);
            el.removeEventListener('mouseup', check);
            el.removeEventListener('keyup', onKey);
            el.removeEventListener('touchend', check);
        };
        this._bound = el;
    };
    OnSelection.prototype.onStop = function () { this._unbind(); };
    OnSelection.prototype.onRemoved = function () { this._unbind(); };
    LG.registerNodeType('HTM/DOM/On Selection', OnSelection);

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/Frame/Navigate (2026-10-21) — pagina dell'iframe di un documento HTM mode:"iframe"
    // ─────────────────────────────────────────────────────────────────────────
    function FrameNavigate() {
        this.addProperty('mobileWiki', false, 'boolean');
        this.addWidget('toggle', 'mobileWiki', false, v => { this.properties.mobileWiki = !!v; }, { property: 'mobileWiki' });
        this.addInput('trigger', LG.ACTION);
        this.addInput('url', 'string');
        this.addOutput('done', LG.EVENT);
        this.addOutput('→url', 'string');
        this.color = COL_SET[0]; this.bgcolor = COL_SET[1];
        this.size = [210, 80];
    }
    FrameNavigate.error_output = true;
    FrameNavigate.title = 'Frame Navigate';
    FrameNavigate.desc  = 'Loads a web address in the iframe of the panel (HTM object with mode "iframe"). Many sites refuse to be shown inside another site: check first with Web URL Frame Check. The ↗ button of the panel opens the current page in a new tab';
    FrameNavigate.portHelp = {
        inputs: {
            trigger: 'event — loads the page',
            url:     'string — http(s) address or path of the platform; empty = back to "no page"',
        },
        outputs: {
            done:   'event — page requested (the browser cannot tell whether the site then refused the iframe)',
            '→url': 'string — the address actually loaded (after mobileWiki)',
            error:  'event — not an http(s) address, or the panel is not an HTM document in iframe mode. Port hidden by default: right click → Show error',
        },
        properties: { mobileWiki: 'on = Wikipedia addresses use the mobile version (xx.m.wikipedia.org), better in narrow panels' },
    };
    FrameNavigate.prototype.onAction = function () {
        this.clearError?.();
        const ctx = this.graph?._appContext;
        if (!ctx?.navigate) { this.triggerError?.(new Error('not an HTM panel')); return; }
        const r = ctx.navigate(this.getInputData(this.findInputSlot('url')), { mobileWiki: !!this.properties.mobileWiki });
        if (r?.error) { this.triggerError?.(new Error(r.error)); return; }
        this.setOutputData(this.findOutputSlot('→url'), r?.url ?? '');
        this.triggerSlot(this.findOutputSlot('done'));
    };
    LG.registerNodeType('HTM/Frame/Navigate', FrameNavigate);
}
