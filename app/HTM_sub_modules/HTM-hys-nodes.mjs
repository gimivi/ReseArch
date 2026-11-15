// app/HTM_sub_modules/HTM-hys-nodes.mjs
//
// Nodi HTM legati a HySpace:
//   HTM/HYS/Ricerca Musei — ricerca delle esercitazioni e musei generati (erede di
//     WT3DNode_Search.aspx): "Vai" porta HySpace su un risultato, "Genera museo" crea
//     un museo tematico dai risultati (api/hys_museum_tool.php), "I miei musei" li
//     elenca/apre/rinomina/elimina. Le uscite vanno a HySpace via bus:
//        Ricerca Musei ─ go / exercise         ──→ App Bus Emitter "hys:goto" (bus ON)
//        Ricerca Musei ─ openMuseum / museum   ──→ App Bus Emitter "hys:museum" (bus ON)
//     e nel flow di HySpace: App Bus Receiver "hys:goto" → HYS/Navigate/Go To,
//                            App Bus Receiver "hys:museum" → HYS/Settings/Museum.
//   HTM/HYS/Scheda Esercitazione — la scheda di un'esercitazione (erede di
//     WT3DNode_ViewEse.aspx, _doc/Old_HS/HTML): titolo, autore, descrizione (più
//     abstract e parole chiave, che la vecchia pagina leggeva senza mostrare) e i
//     paragrafi in ordine (titoletto, miniatura cliccabile con didascalia, testo).
//     Dati da api/HySpace_rest_api.php?id_ese=N (campo "node"); stile ripreso da
//     Valenti_HySpace.css, confinato sotto .hys-scheda.
//   HTM/HYS/Archivio Esercitazioni — elenco delle esercitazioni per anno e tipo (erede di
//     Ese_Archivio2.aspx / GestisciEsercitazioni.aspx, _doc/Ese): "Scheda" e "Vedi" escono
//     come eventi per un pannello scheda e un pannello TJS (TJS/Model/Load URL), via bus;
//     per l'amministratore "File" (finestra di upload/download della cartella dell'esercitazione)
//     ed "Elimina" con doppia conferma. Il modello si salva dal pannello TJS, con le modifiche,
//     col nodo TJS/Model/Save Esercitazione; il suo esito ("salvato") aggiorna la riga.
//
// Uso tipico, pannello HTML (mode:"flow") accanto a un pannello HySpace:
//   ReseArch/App Bus/Receiver (evento "hys:room:enter", bus ON)
//      ├─ trigger ──→ trigger
//      └─ payload ──→ exercise             (il payload contiene id_ese)
//
// Sicurezza: i testi dei paragrafi possono contenere HTML (la pagina .NET li stampava
// così com'erano): passano da un filtro a lista bianca (tag di formattazione e link
// http/https), mai eseguiti come script.

import { t, formatDate, formatNumber } from '../shared/i18n.mjs';
import { panelLevel } from '../shared/ui_level.mjs';

// I nodi (titoli, help, porte, proprietà) sono in inglese fisso; l'interfaccia che
// costruiscono nel pannello per chi visita passa da t() (chiavi app.hys.card/search/archive.*).

const STYLE_ID = 'hys-scheda-style';
const CSS = `
.hys-scheda { font-family: Arial, Helvetica, sans-serif; color: #222; padding: 10px 14px 18px; box-sizing: border-box;
              height: 100%; overflow-y: auto; background: #fff; line-height: 1.35; }
.hys-scheda .Titolo      { font-weight: bold; font-size: 1.5em; margin: 0 0 .15em; }
.hys-scheda .Titoletto   { font-weight: bold; font-size: 1.05em; margin: .9em 0 .25em; }
.hys-scheda .Autore      { font-size: 1.15em; font-style: italic; margin: 0 0 .6em; }
.hys-scheda .Descrizione,
.hys-scheda .Abstract,
.hys-scheda .Corpo       { font-size: 1em; text-align: justify; margin: 0 0 .7em; }
.hys-scheda .Chiavi      { font-size: .95em; font-style: italic; text-align: justify; margin: 0 0 .7em; color: #555; }
.hys-scheda .Didascalia  { font-size: .8em; font-style: italic; text-align: center; margin: .2em 0 .6em; color: #444; }
.hys-scheda .hys-par     { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.hys-scheda .hys-par-img { flex: 0 0 240px; max-width: 100%; }
.hys-scheda .hys-par-img img { width: 100%; height: auto; display: block; cursor: zoom-in; border: 0; }
.hys-scheda .hys-par-txt { flex: 1 1 260px; min-width: 200px; }
.hys-scheda .hys-stato   { color: #777; font-style: italic; padding: 1em 0; }
.hys-scheda .hys-errore  { color: #a33; }
.hys-scheda hr           { border: 0; border-top: 1px solid #ddd; margin: 1em 0 .4em; }
.hys-lightbox { position: absolute; inset: 0; background: rgba(0,0,0,.85); display: flex; flex-direction: column;
                align-items: center; justify-content: center; z-index: 20; cursor: zoom-out; padding: 12px; box-sizing: border-box; }
.hys-lightbox img { max-width: 100%; max-height: calc(100% - 48px); object-fit: contain; }
.hys-lightbox .hys-lb-cap { color: #eee; font: italic .9em Arial, sans-serif; margin-top: 8px; text-align: center; }
.hys-lightbox a { color: #9fd7ff; font: .8em Arial, sans-serif; margin-top: 4px; }
.hys-ricerca { font-family: Arial, Helvetica, sans-serif; color: #222; padding: 8px 10px 14px; box-sizing: border-box;
               height: 100%; overflow-y: auto; background: #fff; font-size: 13px; }
.hys-ricerca .hr-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 6px; }
.hys-ricerca input[type=text] { flex: 1 1 180px; min-width: 120px; padding: 4px 6px; border: 1px solid #aab; border-radius: 3px; font: inherit; }
.hys-ricerca button { padding: 3px 10px; border: 1px solid #6a7fb0; border-radius: 3px; background: #eef2fb; color: #123; font: inherit; cursor: pointer; }
.hys-ricerca button:disabled { opacity: .45; cursor: default; }
.hys-ricerca button.hr-primary { background: #34579a; color: #fff; border-color: #34579a; }
.hys-ricerca label { font-size: .92em; white-space: nowrap; cursor: pointer; }
.hys-ricerca select { font: inherit; padding: 2px 4px; }
.hys-ricerca .hr-stato { color: #555; font-size: .92em; margin: 4px 0; }
.hys-ricerca .hr-errore { color: #a33; }
.hys-ricerca .hr-item { display: flex; gap: 10px; padding: 7px 4px; border-bottom: 1px solid #e3e6ee; }
.hys-ricerca .hr-item:nth-child(even) { background: #f3f6fb; }
.hys-ricerca .hr-item img { width: 88px; height: 66px; object-fit: cover; flex: 0 0 88px; background: #ddd; }
.hys-ricerca .hr-txt { flex: 1 1 auto; min-width: 0; }
.hys-ricerca .hr-title { font-weight: bold; }
.hys-ricerca .hr-author { font-style: italic; color: #555; margin-bottom: 2px; }
.hys-ricerca .hr-abs { font-size: .9em; color: #444; max-height: 4.2em; overflow-y: auto; text-align: justify; }
.hys-ricerca .hr-box { border: 1px solid #d5dae6; border-radius: 4px; padding: 6px 8px; margin-top: 10px; }
.hys-ricerca summary { cursor: pointer; font-weight: bold; }
.hys-ricerca .hr-mus { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 4px 0; border-bottom: 1px dotted #ccd; }
.hys-ricerca .hr-mus .hr-mus-name { flex: 1 1 200px; }
.hys-ricerca .hr-mus small { color: #666; }
.hys-archivio select { max-width: 100%; }
.hys-archivio .ha-link { cursor: pointer; color: #1d3f7a; }
.hys-archivio .ha-link:hover { text-decoration: underline; }
.hys-archivio .ha-side { flex: 0 0 150px; display: flex; flex-direction: column; gap: 4px; align-items: stretch; }
.hys-archivio .ha-model { display: flex; flex-direction: column; gap: 3px; border-top: 1px dotted #ccd; padding-top: 3px; }
.hys-archivio .ha-file { font-size: .85em; color: #444; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hys-archivio .ha-none { font-style: italic; color: #888; }
.hys-archivio .ha-ok { font-size: .85em; color: #2a7a2a; font-weight: bold; }
.hys-archivio button.ha-del { background: #fbeeee; border-color: #b06a6a; color: #7a1d1d; margin-top: 4px; }
.ha-files { position: absolute; inset: 0; z-index: 25; background: #fff; display: flex; flex-direction: column; gap: 4px;
            padding: 8px 10px; box-sizing: border-box; font: 13px Arial, Helvetica, sans-serif; color: #222; }
.ha-files .ha-files-head { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid #d5dae6; padding-bottom: 4px; }
.ha-files .ha-close { margin-left: auto; font-size: 18px; line-height: 1; padding: 0 8px; border: 1px solid #aab; background: #f3f3f3; cursor: pointer; }
.ha-files .hr-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ha-files select, .ha-files input[type=file] { font: inherit; max-width: 100%; }
.ha-files button { padding: 3px 10px; border: 1px solid #6a7fb0; border-radius: 3px; background: #eef2fb; color: #123; font: inherit; cursor: pointer; }
.ha-files button.hr-primary { background: #34579a; color: #fff; border-color: #34579a; }
.ha-files .hr-stato { color: #555; font-size: .92em; }
.ha-files .hr-errore { color: #a33; }
.ha-files .ha-files-list { flex: 1 1 auto; overflow-y: auto; border-top: 1px solid #e3e6ee; }
.ha-files .ha-f { display: flex; gap: 8px; align-items: center; padding: 4px 2px; border-bottom: 1px solid #eef0f5; }
.ha-files .ha-f:nth-child(even) { background: #f6f8fc; }
.ha-files .ha-f-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ha-files .ha-f small { color: #666; white-space: nowrap; }
.ha-files .ha-ok { color: #2a7a2a; font-weight: bold; }
`;

// ── filtro HTML a lista bianca ───────────────────────────────────────────────
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI',
                         'SUB', 'SUP', 'SMALL', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'A']);

function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<div>${String(html ?? '')}</div>`, 'text/html');
    const clean = (node, out) => {
        for (const ch of [...node.childNodes]) {
            if (ch.nodeType === 3) { out.appendChild(document.createTextNode(ch.textContent)); continue; }
            if (ch.nodeType !== 1) continue;
            const tag = ch.tagName;
            if (!ALLOWED.has(tag)) {                       // tag non ammesso: ne tengo solo il testo
                if (tag !== 'SCRIPT' && tag !== 'STYLE') clean(ch, out);
                continue;
            }
            const el = document.createElement(tag);
            if (tag === 'A') {
                const href = ch.getAttribute('href') ?? '';
                if (/^https?:\/\//i.test(href) || href.startsWith('/')) {
                    el.setAttribute('href', href);
                    el.setAttribute('target', '_blank');
                    el.setAttribute('rel', 'noopener');
                }
            }
            clean(ch, el);
            out.appendChild(el);
        }
    };
    const frag = document.createDocumentFragment();
    clean(doc.body.firstChild, frag);
    return frag;
}

// testo semplice con a capo → paragrafo; testo con tag → filtrato
function richText(className, value) {
    const p = document.createElement('div');
    p.className = className;
    const s = String(value ?? '');
    if (/<[a-z!/]/i.test(s)) p.appendChild(sanitize(s));
    else s.split(/\r?\n/).forEach((line, i) => { if (i) p.appendChild(document.createElement('br')); p.appendChild(document.createTextNode(line)); });
    return p;
}

function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
}

export function registerHTMHysNodes() {
    const LG = window.LiteGraph;
    if (!LG) return;
    if (window._HTM_HYS_NODES_REGISTERED) return;
    window._HTM_HYS_NODES_REGISTERED = true;

    const COLOR   = '#3a2400';
    const BGCOLOR = '#6a4a00';

    // ─────────────────────────────────────────────────────────────────────────
    // HTM/HYS/Scheda Esercitazione
    // ─────────────────────────────────────────────────────────────────────────
    function HTMHysScheda() {
        this.addInput('trigger',       LG.ACTION);
        this.addInput('exercise', 'number,object');
        this.addOutput('done', LG.EVENT);
        this.addOutput('data', 'object');
        this.addProperty('id_ese', 0);
        this.addProperty('showAbstract', true);
        this.addProperty('showKeywords', true);
        this.addWidget('number', 'initial id_ese', 0, v => { this.properties.id_ese = Math.max(0, Math.round(v)); }, { property: 'id_ese', min: 0, step: 10, precision: 0 });
        this.addWidget('toggle', 'show abstract', true, v => { this.properties.showAbstract = v; }, { property: 'showAbstract' });
        this.addWidget('toggle', 'show keywords', true, v => { this.properties.showKeywords = v; }, { property: 'showKeywords' });
        this._root = null;
        this._shown = 0;
        this._ctrl = null;
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [250, 130];
    }
    HTMHysScheda.title = 'Exercise Card';
    HTMHysScheda.desc  = 'Shows in the HTML panel the card of a HySpace exercise (title, author, description, paragraphs with images) — connect it to an App Bus Receiver on the "hys:room:enter" event to follow the museum rooms';
    HTMHysScheda.portHelp = {
        inputs: {
            trigger: 'Trigger (ACTION): loads and shows the exercise of the "exercise" input (if it is the one already shown, it does not reload).',
            exercise: 'id_ese (number) or an object containing id_ese — for example the payload of App Bus Receiver on the HySpace "hys:room:enter" event.',
        },
        outputs: {
            done: 'Trigger (EVENT): card shown.',
            data: 'The exercise data as returned by the HySpace API (titolo, autore, descrizione, abstract, chiavi, paragrafi…).',
        },
        properties: {
            id_ese: 'Exercise shown when the panel opens, before any event arrives (0 = none: an invitation to enter a HySpace room is shown).',
            showAbstract: 'Shows the exercise abstract below the description.',
            showKeywords: 'Shows the exercise keywords.',
        },
    };

    HTMHysScheda.prototype._ensureRoot = function () {
        const container = this.graph?._appContext?.container;
        if (!container) return null;
        if (!document.getElementById(STYLE_ID)) {
            const st = document.createElement('style');
            st.id = STYLE_ID;
            st.textContent = CSS;
            document.head.appendChild(st);
        }
        if (!this._root || !this._root.isConnected || this._root.parentElement !== container) {
            this._root?.remove();
            this._root = el('div', 'hys-scheda');
            if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
            container.appendChild(this._root);
        }
        return this._root;
    };

    HTMHysScheda.prototype._status = function (text, isError = false) {
        const root = this._ensureRoot();
        if (!root) return;
        const s = el('div', 'hys-stato' + (isError ? ' hys-errore' : ''), text);
        s.setAttribute('role', 'status');
        root.replaceChildren(s);
    };

    HTMHysScheda.prototype._lightbox = function (src, caption) {
        const container = this.graph?._appContext?.container;
        if (!container || !src) return;
        const box = el('div', 'hys-lightbox');
        const img = document.createElement('img');
        img.src = src;
        img.alt = caption || '';
        box.appendChild(img);
        if (caption) box.appendChild(el('div', 'hys-lb-cap', caption));
        const a = el('a', null, t('app.hys.card.open_new_tab'));
        a.href = src; a.target = '_blank'; a.rel = 'noopener';
        a.addEventListener('click', (e) => e.stopPropagation());
        box.appendChild(a);
        box.addEventListener('click', () => box.remove());
        container.appendChild(box);
    };

    HTMHysScheda.prototype._render = function (n) {
        const root = this._ensureRoot();
        if (!root) return;
        const frag = document.createDocumentFragment();
        frag.appendChild(el('div', 'Titolo', n.title || t('app.hys.untitled')));
        frag.appendChild(el('div', 'Titoletto', t('app.hys.card.author.@')));
        frag.appendChild(el('div', 'Autore', n.author || ''));
        if (n.descrizione) {
            frag.appendChild(el('div', 'Titoletto', t('common.description')));
            frag.appendChild(richText('Descrizione', n.descrizione));
        }
        if (this.properties.showAbstract && n.abstract) {
            frag.appendChild(el('div', 'Titoletto', t('app.hys.field.abstract')));
            frag.appendChild(richText('Abstract', n.abstract));
        }
        if (this.properties.showKeywords && n.chiavi) {
            frag.appendChild(el('div', 'Titoletto', t('app.hys.field.keywords')));
            frag.appendChild(el('div', 'Chiavi', n.chiavi));
        }
        const pars = Array.isArray(n.paragraphs) ? n.paragraphs : [];
        if (pars.length) frag.appendChild(document.createElement('hr'));
        for (const p of pars) {
            if (p.titolo) frag.appendChild(el('div', 'Titoletto', p.titolo));
            const row = el('div', 'hys-par');
            if (p.immagine) {
                const col = el('div', 'hys-par-img');
                const img = document.createElement('img');
                img.loading = 'lazy';
                img.src = p.icona || p.immagine;
                img.alt = p.didascalia || p.titolo || '';
                img.title = t('app.hys.card.zoom');
                img.addEventListener('click', () => this._lightbox(p.immagine, p.didascalia));
                col.appendChild(img);
                if (p.didascalia) col.appendChild(el('div', 'Didascalia', p.didascalia));
                row.appendChild(col);
            }
            const txt = el('div', 'hys-par-txt');
            if (p.corpo) txt.appendChild(richText('Corpo', p.corpo));
            row.appendChild(txt);
            frag.appendChild(row);
        }
        root.replaceChildren(frag);
        root.scrollTop = 0;
    };

    HTMHysScheda.prototype._show = async function (idEse) {
        const id = Number(idEse);
        if (!(id > 0) || id === this._shown) return;
        this._ctrl?.abort();
        const ctrl = (this._ctrl = new AbortController());
        this._status(t('app.hys.card.loading'));
        try {
            const res = await fetch(`api/HySpace_rest_api.php?id_ese=${id}`, { credentials: 'same-origin', signal: ctrl.signal });
            const j = await res.json().catch(() => null);
            if (ctrl.signal.aborted) return;
            if (!res.ok || !j?.success) { this._status(t('app.hys.notice.exercise_error', { id, error: j?.message ?? 'HTTP ' + res.status }), true); return; }
            this._shown = id;
            this._render(j.node);
            this.setOutputData(this.findOutputSlot('data'), j.node);
            this.triggerSlot(this.findOutputSlot('done'));
        } catch (e) {
            if (e?.name !== 'AbortError') this._status(t('app.hys.notice.exercise_error', { id, error: e?.message ?? e }), true);
        }
    };

    HTMHysScheda.prototype.onStart = function () {
        this._shown = 0;
        const id = Number(this.properties.id_ese);
        if (id > 0) this._show(id);
        else this._status(t('app.hys.card.enter_room'));
    };
    HTMHysScheda.prototype.onAction = function () {
        const v = this.getInputData(1);
        const id = v && typeof v === 'object' ? (v.id_ese ?? v.node?.id_ese) : v;
        this._show(id);
    };
    HTMHysScheda.prototype.onStop = function () {
        this._ctrl?.abort();
        this._ctrl = null;
    };
    HTMHysScheda.prototype.onRemoved = function () {
        this.onStop();
        try { this._root?.remove(); } catch {}
        this._root = null;
    };
    LG.registerNodeType('HTM/HYS/Scheda Esercitazione', HTMHysScheda);


    // ─────────────────────────────────────────────────────────────────────────
    // HTM/HYS/Ricerca Musei
    // ─────────────────────────────────────────────────────────────────────────
    // [codice del campo per l'API, chiave del testo mostrato]
    const FIELDS = [
        ['chiavi', 'app.hys.field.keywords'], ['titolo', 'common.title'], ['abstract', 'app.hys.field.abstract'],
        ['descrizione', 'common.description'], ['cognome', 'app.hys.field.student_surname'],
    ];
    const API = 'api/hys_museum_tool.php';

    async function apiGet(params) {
        const r = await fetch(`${API}?${new URLSearchParams(params)}`, { credentials: 'same-origin' });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        return j.data;
    }
    async function apiPost(body) {
        const r = await fetch(API, { method: 'POST', credentials: 'same-origin',
                                     headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        return j.data;
    }
    const WHEN_OPTS = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' };
    const when = (ts) => { const d = new Date(String(ts ?? '').replace(' ', 'T')); return isNaN(d) ? String(ts ?? '') : formatDate(d, WHEN_OPTS); };
    // frase intera per museo con nome / senza nome (data di creazione)
    const museumMsg = (keyNamed, keyDated, m, params = {}) => m.name
        ? t(keyNamed, { ...params, name: m.name })
        : t(keyDated, { ...params, date: when(m.created_at) });
    const fieldLabel = (f) => { const k = FIELDS.find(([c]) => c === f)?.[1]; return k ? t(k) : f; };
    const queryLabel = (q) => q ? t('app.hys.search.query_label', { q: q.q ?? '', fields: (q.fields ?? []).map((f) => fieldLabel(f).toLowerCase()).join(', ') }) : '';

    function HTMHysRicerca() {
        this.addOutput('go',         LG.EVENT);
        this.addOutput('exercise',   'object');
        this.addOutput('openMuseum', LG.EVENT);
        this.addOutput('museum',     'object');
        this.addProperty('fields', 'chiavi');
        this.addProperty('perPage', 20);
        this.addProperty('vertical', 'student path');
        this.addWidget('text',   'default fields', 'chiavi', v => { this.properties.fields = v; }, { property: 'fields' });
        this.addWidget('number', 'results per page', 20, v => { this.properties.perPage = Math.max(5, Math.min(50, Math.round(v))); }, { property: 'perPage', min: 5, max: 50, step: 50, precision: 0 });
        this.addWidget('combo',  'vertical', 'student path', v => { this.properties.vertical = v; },
                       { values: ['student path', 'none'], property: 'vertical' });
        this._root = null;
        this._ui = null;
        this._page = 1;
        this._total = 0;
        this._last = null;      // ultima ricerca { fields, q }
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [260, 120];
    }
    HTMHysRicerca.title = 'Museum Search';
    HTMHysRicerca.desc  = 'Search of HySpace exercises and museums generated from the results (successor of WT3DNode_Search): the panel buttons "Vai" (go) and "Apri" (open museum) come out as events to send to HySpace via the bus';
    HTMHysRicerca.portHelp = {
        outputs: {
            go: 'Trigger (EVENT): "Vai" pressed on a result.',
            exercise: 'Object { id_ese, title, author } of the result — for App Bus Emitter (e.g. event "hys:goto", bus ON) → in the HySpace flow App Bus Receiver → HYS/Navigate/Go To.',
            openMuseum: 'Trigger (EVENT): museum just generated, or opened from "I miei musei".',
            museum: 'Object { mus_id, name, created_at, start_id_ese, n_nodes, vertical, query } — for App Bus Emitter (e.g. "hys:museum", bus ON) → in the HySpace flow App Bus Receiver → HYS/Settings/Museum.',
        },
        properties: {
            fields: 'Search fields checked when the panel opens, comma separated (API codes): chiavi (keywords), titolo (title), abstract, descrizione (description), cognome (student surname).',
            perPage: 'Results per page (5–50).',
            vertical: 'Default choice for generated museums: student path = stairs up and down following each student\'s path (as in the curated museum), none = only the rooms of the search.',
        },
    };

    HTMHysRicerca.prototype._emitGo = function (item) {
        this.setOutputData(this.findOutputSlot('exercise'), { id_ese: item.id_ese, title: item.title, author: item.author });
        this.triggerSlot(this.findOutputSlot('go'));
    };
    HTMHysRicerca.prototype._emitMuseum = function (m) {
        this.setOutputData(this.findOutputSlot('museum'), m);
        this.triggerSlot(this.findOutputSlot('openMuseum'));
    };

    HTMHysRicerca.prototype._build = function () {
        const container = this.graph?._appContext?.container;
        if (!container) return false;
        if (this._root?.isConnected && this._root.parentElement === container) return true;
        if (!document.getElementById(STYLE_ID)) {
            const st = document.createElement('style');
            st.id = STYLE_ID;
            st.textContent = CSS;
            document.head.appendChild(st);
        }
        this._root?.remove();
        const root = (this._root = el('div', 'hys-ricerca'));
        const ui = (this._ui = {});

        // riga di ricerca
        const r1 = el('div', 'hr-row');
        ui.q = document.createElement('input');
        ui.q.type = 'text';
        ui.q.placeholder = t('app.hys.search.placeholder');
        ui.q.setAttribute('aria-label', t('app.hys.search.placeholder'));
        ui.search = el('button', 'hr-primary', t('common.search'));
        r1.append(ui.q, ui.search);
        // campi
        const r2 = el('div', 'hr-row');
        const pre = String(this.properties.fields ?? 'chiavi').split(/[,;\s]+/).filter(Boolean);
        ui.fields = FIELDS.map(([k, labelKey]) => {
            const lab = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = k;
            cb.checked = pre.includes(k) || (!pre.length && k === 'chiavi');
            lab.append(cb, document.createTextNode(' ' + t(labelKey)));
            r2.appendChild(lab);
            return cb;
        });
        // stato e pagine
        const r3 = el('div', 'hr-row');
        ui.status = el('div', 'hr-stato', t('app.hys.search.hint'));
        ui.status.setAttribute('role', 'status');
        ui.status.style.flex = '1 1 auto';
        ui.prev = el('button', null, '‹');
        ui.next = el('button', null, '›');
        ui.prev.setAttribute('aria-label', t('app.hys.search.prev_page'));
        ui.next.setAttribute('aria-label', t('app.hys.search.next_page'));
        ui.prev.disabled = ui.next.disabled = true;
        r3.append(ui.status, ui.prev, ui.next);
        ui.list = el('div');

        // generatore
        const gen = el('div', 'hr-box');
        const g1 = el('div', 'hr-row');
        ui.name = document.createElement('input');
        ui.name.type = 'text';
        ui.name.placeholder = t('app.hys.search.name_placeholder');
        ui.name.setAttribute('aria-label', t('app.hys.search.name_placeholder'));
        ui.vertical = document.createElement('select');
        ui.vertical.setAttribute('aria-label', t('app.hys.search.vertical_label'));
        for (const [v, key] of [['student', 'app.hys.search.vertical_student'], ['none', 'app.hys.search.vertical_none']]) {
            const o = el('option', null, t(key)); o.value = v; ui.vertical.appendChild(o);
        }
        ui.vertical.value = this.properties.vertical === 'none' ? 'none' : 'student';
        ui.generate = el('button', 'hr-primary', t('app.hys.search.generate'));
        ui.generate.disabled = true;
        g1.append(ui.name, ui.vertical, ui.generate);
        gen.append(el('div', 'hr-stato', t('app.hys.search.generate_hint')), g1);

        // i miei musei
        ui.mine = document.createElement('details');
        ui.mine.className = 'hr-box';
        ui.mine.appendChild(el('summary', null, t('app.hys.search.my_museums')));
        ui.mineList = el('div', 'hr-stato', '…');
        ui.mineList.setAttribute('aria-live', 'polite');
        ui.mine.appendChild(ui.mineList);

        // Generare musei e consultare i propri: dal livello 20 (utente), _doc/arch-i18n-a11y.md §5.
        // Sotto (osservatori) resta solo la ricerca. Il server ricontrolla (api/hys_museum_tool.php).
        const canMuseums = panelLevel(container) >= 20;
        root.append(r1, r2, r3, ui.list, ...(canMuseums ? [gen, ui.mine] : []));
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        container.appendChild(root);

        // eventi
        const run = () => this._search(1);
        ui.search.addEventListener('click', run);
        ui.q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
        ui.prev.addEventListener('click', () => this._search(this._page - 1));
        ui.next.addEventListener('click', () => this._search(this._page + 1));
        ui.generate.addEventListener('click', () => this._generate());
        ui.mine.addEventListener('toggle', () => { if (ui.mine.open) this._loadMine(); });
        return true;
    };

    HTMHysRicerca.prototype._fields = function () {
        const f = this._ui.fields.filter((cb) => cb.checked).map((cb) => cb.value);
        return f.length ? f : ['chiavi'];
    };

    HTMHysRicerca.prototype._search = async function (page) {
        const ui = this._ui;
        const q = ui.q.value.trim();
        if (!q) { ui.status.textContent = t('app.hys.search.need_word'); return; }
        const fields = this._fields();
        const size = Number(this.properties.perPage) || 20;
        ui.status.textContent = t('app.hys.search.searching');
        ui.status.classList.remove('hr-errore');
        try {
            const d = await apiGet({ action: 'search', fields: fields.join(','), q, page: String(Math.max(1, page)), size: String(size) });
            this._last = { fields, q };
            this._page = d.page;
            this._total = d.total;
            const from = d.total ? (d.page - 1) * d.size + 1 : 0, to = Math.min(d.total, d.page * d.size);
            ui.status.textContent = d.total ? t('app.hys.search.results', { from, to, total: d.total }) : t('app.hys.none_found');
            ui.prev.disabled = d.page <= 1;
            ui.next.disabled = to >= d.total;
            ui.generate.disabled = !d.total;
            ui.generate.textContent = d.total ? t('app.hys.search.generate_n', { n: Math.min(d.total, 500) }) : t('app.hys.search.generate');
            ui.list.replaceChildren(...d.items.map((it) => this._item(it)));
        } catch (e) {
            ui.status.textContent = t('app.hys.search.failed', { error: e.message });
            ui.status.classList.add('hr-errore');
        }
    };

    HTMHysRicerca.prototype._item = function (it) {
        const row = el('div', 'hr-item');
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = '';
        if (it.cover_url) img.src = it.cover_url;
        const txt = el('div', 'hr-txt');
        txt.append(el('div', 'hr-title', it.title), el('div', 'hr-author', it.author));
        if (it.abstract) txt.appendChild(el('div', 'hr-abs', it.abstract));
        const go = el('button', null, t('app.hys.search.go'));
        go.title = t('app.hys.search.go_title');
        go.addEventListener('click', () => this._emitGo(it));
        row.append(img, txt, go);
        return row;
    };

    HTMHysRicerca.prototype._generate = async function () {
        const ui = this._ui;
        const last = this._last;
        if (!last) return;
        ui.generate.disabled = true;
        ui.status.textContent = t('app.hys.search.generating');
        try {
            const m = await apiPost({ action: 'generate', fields: last.fields, q: last.q,
                                      name: ui.name.value.trim(), vertical: ui.vertical.value });
            ui.status.textContent = museumMsg('app.hys.search.generated_named', 'app.hys.search.generated_dated', m, { n: Number(m.n_nodes) || 0 })
                                  + (m.truncated ? ' ' + t('app.hys.search.limit_500') : '');
            ui.name.value = '';
            this._emitMuseum(m);
            if (ui.mine.open) this._loadMine();
        } catch (e) {
            ui.status.textContent = t('app.hys.search.generate_failed', { error: e.message });
            ui.status.classList.add('hr-errore');
        } finally {
            ui.generate.disabled = !this._total;
        }
    };

    HTMHysRicerca.prototype._loadMine = async function () {
        const box = this._ui.mineList;
        box.textContent = t('common.loading');
        try {
            const list = await apiGet({ action: 'list' });
            if (!list.length) { box.textContent = t('app.hys.search.no_museums'); return; }
            box.replaceChildren(...list.map((m) => {
                const row = el('div', 'hr-mus');
                const name = el('div', 'hr-mus-name');
                const info = t(m.name ? 'app.hys.search.museum_info' : 'app.hys.search.museum_info_temp',
                               { n: Number(m.n_nodes) || 0, query: queryLabel(m.query) });
                name.append(el('b', null, m.name || t('app.hys.search.unnamed')), document.createTextNode(' — ' + when(m.created_at) + ' '),
                            el('small', null, info));
                const open = el('button', 'hr-primary', t('common.open'));
                open.addEventListener('click', () => this._emitMuseum(m));
                const ren = el('button', null, t('common.rename'));
                ren.addEventListener('click', async () => {
                    const n = window.prompt(t('app.hys.search.rename_prompt'), m.name ?? '');
                    if (n === null) return;
                    try { await apiPost({ action: 'rename', mus_id: m.mus_id, name: n }); this._loadMine(); }
                    catch (e) { window.alert(t('app.hys.search.rename_failed', { error: e.message })); }
                });
                const del = el('button', null, t('common.delete'));
                del.addEventListener('click', async () => {
                    if (!window.confirm(museumMsg('app.hys.search.confirm_delete_named', 'app.hys.search.confirm_delete_dated', m))) return;
                    try { await apiPost({ action: 'delete', mus_id: m.mus_id }); this._loadMine(); }
                    catch (e) { window.alert(t('app.hys.delete_failed', { error: e.message })); }
                });
                row.append(name, open, ren, del);
                return row;
            }));
        } catch (e) {
            box.textContent = t('app.hys.list_unavailable', { error: e.message });
        }
    };

    HTMHysRicerca.prototype.onStart = function () { this._build(); };
    HTMHysRicerca.prototype.onExecute = function () { if (!this._root?.isConnected) this._build(); };
    HTMHysRicerca.prototype.onRemoved = function () {
        try { this._root?.remove(); } catch {}
        this._root = null;
        this._ui = null;
    };
    LG.registerNodeType('HTM/HYS/Ricerca Musei', HTMHysRicerca);


    // ─────────────────────────────────────────────────────────────────────────
    // HTM/HYS/Archivio Esercitazioni
    // ─────────────────────────────────────────────────────────────────────────
    const ARCH_API = 'api/hys_archive_tool.php';
    // [codice del campo per l'API, chiave del testo mostrato]
    const ARCH_FIELDS = [
        ['titolo', 'common.title'], ['chiavi', 'app.hys.field.keywords'], ['abstract', 'app.hys.field.abstract'],
        ['descrizione', 'common.description'], ['cognome', 'app.hys.field.surname'],
    ];
    const MODEL_EXT = new Set(['glb', 'gltf', 'wrl', 'wrz', 'vrml', 'obj', 'ply', 'drc']);
    const MAX_UPLOAD = 100 * 1048576;     // come requestLimits del Web.config
    const size = (n) => {
        if (n < 1048576) return formatNumber(Math.max(1, Math.round(n / 1024))) + ' kB';
        const d = n < 10485760 ? 2 : 1;
        return formatNumber(n / 1048576, { minimumFractionDigits: d, maximumFractionDigits: d }) + ' MB';
    };

    async function archGet(params) {
        const r = await fetch(`${ARCH_API}?${new URLSearchParams(params)}`, { credentials: 'same-origin' });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        return j.data;
    }
    async function archPost(query, body, contentType) {
        const r = await fetch(`${ARCH_API}${query}`, { method: 'POST', credentials: 'same-origin',
                                                      headers: { 'Content-Type': contentType }, body });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        return j.data;
    }

    function HTMHysArchivio() {
        this.addInput('saved', LG.ACTION);
        this.addInput('file',  'object');
        this.addOutput('card',     LG.EVENT);
        this.addOutput('exercise', 'object');
        this.addOutput('view',     LG.EVENT);
        this.addOutput('model',    'object');
        this.addProperty('fields', 'titolo');
        this.addProperty('onlyWithModel', false);
        this.addWidget('text',   'default fields', 'titolo', v => { this.properties.fields = v; }, { property: 'fields' });
        this.addWidget('toggle', 'only with model', false, v => { this.properties.onlyWithModel = v; }, { property: 'onlyWithModel' });
        this._root = null;
        this._ui = null;
        this._admin = false;
        this._rows = new Map();     // id_ese → { it, row }
        this._files = null;         // finestra "File" aperta: { it, box, refresh }
        this.color   = COLOR;
        this.bgcolor = BGCOLOR;
        this.size    = [280, 120];
    }
    HTMHysArchivio.title = 'Exercise Archive';
    HTMHysArchivio.desc  = 'Archive of HySpace exercises by year and type (successor of Ese_Archivio2 / GestisciEsercitazioni): the panel buttons "Scheda" (card) and "Vedi" (view) come out as events to send via the bus to an Exercise Card panel and to a TJS panel (TJS/Model/Load URL); for the administrator "File" (upload/download in the exercise folder) and "Elimina" (delete)';
    HTMHysArchivio.portHelp = {
        inputs: {
            saved: 'Trigger (ACTION): a model has been saved — updates the exercise row (and the File window, if open).',
            file: 'Object { id_ese, model_file, model_url, model_set } from the "file" output of TJS/Model/Save Esercitazione, received via the bus (App Bus Receiver, e.g. "ese:salvato").',
        },
        outputs: {
            card: 'Trigger (EVENT): "Scheda" (or the title) pressed on an exercise.',
            exercise: 'Object { id_ese, title, author } — for App Bus Emitter (e.g. event "ese:scheda", bus ON) → in the card panel flow App Bus Receiver → HTM/HYS/Scheda Esercitazione (Exercise Card).',
            view: 'Trigger (EVENT): "Vedi" pressed (or the title, or "Vedi" on a 3D file in the File window).',
            model: 'Object { model_url, model_file, id_ese, title } — for App Bus Emitter (e.g. event "ese:modello", bus ON) → in the TJS panel flow App Bus Receiver → TJS/Model/Load URL.',
        },
        properties: {
            fields: 'Search fields checked when the panel opens, comma separated (API codes): titolo (title), chiavi (keywords), abstract, descrizione (description), cognome (surname).',
            onlyWithModel: '"solo con modello" (only with model) checkbox — the "Ha il VRML" of the old page — checked when the panel opens.',
        },
    };

    HTMHysArchivio.prototype._emitScheda = function (it) {
        this.setOutputData(this.findOutputSlot('exercise'), { id_ese: it.id_ese, title: it.title, author: it.author });
        this.triggerSlot(this.findOutputSlot('card'));
    };
    HTMHysArchivio.prototype._emitModel = function (it) {
        if (!it.model_url) return;
        this.setOutputData(this.findOutputSlot('model'), { model_url: it.model_url, model_file: it.model_file, id_ese: it.id_ese, title: it.title });
        this.triggerSlot(this.findOutputSlot('view'));
    };

    HTMHysArchivio.prototype._build = function () {
        const container = this.graph?._appContext?.container;
        if (!container) return false;
        if (this._root?.isConnected && this._root.parentElement === container) return true;
        if (!document.getElementById(STYLE_ID)) {
            const st = document.createElement('style');
            st.id = STYLE_ID;
            st.textContent = CSS;
            document.head.appendChild(st);
        }
        this._root?.remove();
        const root = (this._root = el('div', 'hys-ricerca hys-archivio'));
        const ui = (this._ui = {});

        const r1 = el('div', 'hr-row');
        ui.aa = document.createElement('select');
        ui.aa.title = t('app.hys.archive.year');
        ui.aa.setAttribute('aria-label', t('app.hys.archive.year'));
        ui.tipo = document.createElement('select');
        ui.tipo.title = t('app.hys.archive.exercise');
        ui.tipo.setAttribute('aria-label', t('app.hys.archive.exercise'));
        ui.tipo.style.flex = '1 1 200px';
        r1.append(ui.aa, ui.tipo);

        const r2 = el('div', 'hr-row');
        ui.q = document.createElement('input');
        ui.q.type = 'text';
        ui.q.placeholder = t('app.hys.archive.placeholder');
        ui.q.setAttribute('aria-label', t('app.hys.archive.placeholder'));
        ui.search = el('button', 'hr-primary', t('common.search'));
        r2.append(ui.q, ui.search);

        const r3 = el('div', 'hr-row');
        const pre = String(this.properties.fields ?? 'titolo').split(/[,;\s]+/).filter(Boolean);
        ui.fields = ARCH_FIELDS.map(([k, labelKey]) => {
            const lab = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = k;
            cb.checked = pre.includes(k) || (!pre.length && k === 'titolo');
            lab.append(cb, document.createTextNode(' ' + t(labelKey)));
            r3.appendChild(lab);
            return cb;
        });
        const labM = document.createElement('label');
        ui.hasModel = document.createElement('input');
        ui.hasModel.type = 'checkbox';
        ui.hasModel.checked = !!this.properties.onlyWithModel;
        labM.append(ui.hasModel, document.createTextNode(' ' + t('app.hys.archive.only_with_model.@')));
        r3.appendChild(labM);

        ui.status = el('div', 'hr-stato', t('app.hys.archive.hint'));
        ui.status.setAttribute('role', 'status');
        ui.list = el('div');
        root.append(r1, r2, r3, ui.status, ui.list);
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        container.appendChild(root);

        const run = () => this._search();
        ui.search.addEventListener('click', run);
        ui.q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
        ui.aa.addEventListener('change', () => this._loadTypes());
        this._loadYears();
        return true;
    };

    HTMHysArchivio.prototype._setStatus = function (text, isError = false) {
        const s = this._ui?.status;
        if (!s) return;
        s.textContent = text;
        s.classList.toggle('hr-errore', isError);
    };

    HTMHysArchivio.prototype._loadYears = async function () {
        const ui = this._ui;
        try {
            const years = await archGet({ action: 'years' });
            ui.aa.replaceChildren(...years.map((y) => { const o = el('option', null, y); o.value = y; return o; }));
            await this._loadTypes();
        } catch (e) {
            this._setStatus(t('app.hys.archive.years_unavailable', { error: e.message }), true);
        }
    };

    HTMHysArchivio.prototype._loadTypes = async function () {
        const ui = this._ui;
        try {
            const types = await archGet({ action: 'types', aa: ui.aa.value });
            const all = el('option', null, t('app.hys.archive.all_types'));
            all.value = '';
            ui.tipo.replaceChildren(...types.map((ty) => { const o = el('option', null, ty.ese_desc); o.value = ty.ese_cod; return o; }), all);
        } catch (e) {
            this._setStatus(t('app.hys.archive.types_unavailable', { error: e.message }), true);
        }
    };

    HTMHysArchivio.prototype._search = async function () {
        const ui = this._ui;
        const fields = ui.fields.filter((cb) => cb.checked).map((cb) => cb.value);
        const params = { action: 'list', ese_cod: ui.tipo.value, q: ui.q.value.trim(), fields: (fields.length ? fields : ['titolo']).join(',') };
        if (ui.hasModel.checked) params.has_model = '1';
        if (!params.ese_cod && !params.q) { this._setStatus(t('app.hys.archive.need_choice'), true); return; }
        this._setStatus(t('app.hys.search.searching'));
        try {
            const d = await archGet(params);
            this._admin = !!d.admin;
            this._setStatus(d.total ? t(d.truncated ? 'app.hys.archive.count_truncated' : 'app.hys.archive.count', { n: Number(d.total) })
                                    : t('app.hys.none_found'));
            this._rows.clear();
            ui.list.replaceChildren(...d.items.map((it) => this._row(it)));
        } catch (e) {
            this._setStatus(t('app.hys.search.failed', { error: e.message }), true);
        }
    };

    HTMHysArchivio.prototype._row = function (it) {
        const row = el('div', 'hr-item');
        this._rows.set(it.id_ese, { it, row });
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = '';
        if (it.cover_url) img.src = it.cover_url;

        const txt = el('div', 'hr-txt');
        const title = el('div', 'hr-title', it.title || t('app.hys.untitled'));
        title.classList.add('ha-link');
        title.title = t('app.hys.archive.show_card_model.@');
        title.addEventListener('click', () => { this._emitScheda(it); this._emitModel(it); });
        txt.append(title, el('div', 'hr-author', it.author + (it.hidden ? ' · ' + t('app.hys.archive.hidden') : '')));
        if (it.abstract) txt.appendChild(el('div', 'hr-abs', it.abstract));

        const side = el('div', 'ha-side');
        const b1 = el('button', null, t('app.hys.archive.card'));
        b1.addEventListener('click', () => this._emitScheda(it));
        side.appendChild(b1);

        const model = el('div', 'ha-model');
        if (it.model_file) {
            model.appendChild(el('div', 'ha-file', it.model_file));
            model.lastChild.title = it.model_file;
            const b2 = el('button', null, t('app.hys.archive.view'));
            b2.title = t('app.hys.archive.view_title.@');
            b2.addEventListener('click', () => this._emitModel(it));
            model.appendChild(b2);
            if (it.model_ext === 'glb') {
                model.appendChild(el('span', 'ha-ok', 'GLB ✓'));
            }
        } else {
            model.appendChild(el('div', 'ha-file ha-none', t('app.hys.archive.no_model.@')));
        }
        side.appendChild(model);

        if (this._admin) {
            const files = el('button', null, t('common.file'));
            files.title = t('app.hys.archive.files_title.@');
            files.addEventListener('click', () => this._openFiles(it));
            side.appendChild(files);
            const del = el('button', 'ha-del', t('common.delete'));
            del.title = t('app.hys.archive.delete_title.@');
            del.addEventListener('click', () => this._delete(it, row));
            side.appendChild(del);
        }
        row.append(img, txt, side);
        return row;
    };

    /** Esito di TJS/Model/Save Esercitazione (via bus): aggiorna la riga e la finestra File. */
    HTMHysArchivio.prototype.onAction = function () {
        const f = this.getInputData(this.findInputSlot('file'));
        const id = Number(f?.id_ese);
        if (!(id > 0)) return;
        const entry = this._rows.get(id);
        if (entry && f.model_set && f.model_file) {
            Object.assign(entry.it, { model_file: f.model_file, model_url: f.model_url, model_ext: String(f.model_file).split('.').pop().toLowerCase() });
            const fresh = this._row(entry.it);
            entry.row.replaceWith(fresh);
            this._setStatus(t('app.hys.archive.model_saved.@', { author: entry.it.author, file: f.model_file }));
        }
        if (this._files?.it.id_ese === id) this._files.refresh();
    };

    // ── finestra "File": cartella dell'esercitazione (solo amministratore) ────────
    HTMHysArchivio.prototype._openFiles = function (it) {
        const container = this.graph?._appContext?.container;
        if (!container) return;
        this._files?.box.remove();
        const box = el('div', 'ha-files');
        const head = el('div', 'ha-files-head');
        head.append(el('b', null, t('app.hys.archive.files_head')), document.createTextNode(`${it.title || t('app.hys.untitled')} · ${it.author}`));
        const close = el('button', 'ha-close', '×');
        close.title = t('common.close');
        close.setAttribute('aria-label', t('common.close'));
        head.appendChild(close);

        const bar = el('div', 'hr-row');
        const dir = document.createElement('select');
        dir.title = t('app.hys.archive.target_folder.@');
        dir.setAttribute('aria-label', t('app.hys.archive.target_folder.@'));
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.setAttribute('aria-label', t('app.hys.archive.choose_files'));
        const up = el('button', 'hr-primary', t('common.upload'));
        bar.append(el('span', null, t('app.hys.archive.upload_to')), dir, input, up);
        const status = el('div', 'hr-stato', t('app.hys.archive.list_loading'));
        status.setAttribute('role', 'status');
        const list = el('div', 'ha-files-list');
        box.append(head, bar, status, list);
        container.appendChild(box);

        const say = (msg, err = false) => { status.textContent = msg; status.classList.toggle('hr-errore', err); };
        const refresh = async () => {
            try {
                const d = await archGet({ action: 'files', id_ese: String(it.id_ese) });
                const keep = dir.value;
                dir.replaceChildren(...d.dirs.map((p) => { const o = el('option', null, p ? p + '/' : t('app.hys.archive.main_folder.@')); o.value = p; return o; }));
                if (d.dirs.includes(keep)) dir.value = keep;
                list.replaceChildren(...d.files.map((f) => {
                    const r = el('div', 'ha-f');
                    const name = el('div', 'ha-f-name', f.path);
                    name.title = f.path;
                    if (f.path === d.model_file) name.appendChild(el('span', 'ha-ok', ' · ' + t('app.hys.archive.model_mark.@')));
                    const a = document.createElement('a');
                    a.href = f.url;
                    a.download = f.path.split('/').pop();
                    a.textContent = t('common.download');
                    r.append(name, el('small', null, `${size(f.size)} · ${f.mtime}`), a);
                    if (MODEL_EXT.has(f.path.split('.').pop().toLowerCase())) {
                        const v = el('button', null, t('app.hys.archive.view'));
                        v.title = t('app.hys.archive.view_file_title');
                        v.addEventListener('click', () => this._emitModel({ ...it, model_url: f.url, model_file: f.path }));
                        r.appendChild(v);
                    }
                    return r;
                }));
                say(t('app.hys.archive.file_count', { n: d.files.length }));
            } catch (e) {
                say(t('app.hys.list_unavailable', { error: e.message }), true);
            }
        };
        const upload = async () => {
            const files = [...(input.files ?? [])];
            if (!files.length) { say(t('app.hys.archive.choose_files'), true); return; }
            up.disabled = true;
            let done = 0;
            const skipped = [];
            try {
                for (const file of files) {
                    if (file.size > MAX_UPLOAD) { skipped.push(t('app.hys.archive.skip_too_big', { name: file.name })); continue; }
                    say(t('app.hys.archive.sending', { name: file.name, size: size(file.size) }));
                    const send = async (overwrite) => {
                        const q = new URLSearchParams({ action: 'upload', id_ese: String(it.id_ese), dir: dir.value, name: file.name, overwrite: overwrite ? '1' : '0' });
                        const r = await fetch(`${ARCH_API}?${q}`, { method: 'POST', credentials: 'same-origin',
                                                                   headers: { 'Content-Type': 'application/octet-stream' }, body: file });
                        return { r, j: await r.json().catch(() => null) };
                    };
                    let { r, j } = await send(false);
                    if (r.status === 409 && j?.exists) {
                        if (!window.confirm(t('app.hys.archive.confirm_overwrite', { name: j.path ?? file.name }))) { skipped.push(t('app.hys.archive.skip_not_overwritten', { name: file.name })); continue; }
                        ({ r, j } = await send(true));
                    }
                    if (!r.ok || !j?.ok) { skipped.push(`${file.name} (${j?.error || 'HTTP ' + r.status})`); continue; }
                    done++;
                }
            } finally {
                up.disabled = false;
                input.value = '';
            }
            await refresh();
            say(skipped.length ? t('app.hys.archive.uploaded_some', { n: done, skipped: skipped.join('; ') })
                               : t('app.hys.archive.uploaded', { n: done }), skipped.length > 0);
        };
        up.addEventListener('click', upload);
        close.addEventListener('click', () => { box.remove(); if (this._files?.box === box) this._files = null; });
        this._files = { it, box, refresh };
        refresh();
    };

    HTMHysArchivio.prototype._delete = async function (it, row) {
        if (!window.confirm(t('app.hys.archive.confirm_delete.@', { id: it.id_ese, title: it.title, author: it.author }))) return;
        // la parola da scrivere segue la lingua; all'API va sempre il codice fisso 'ELIMINA'
        const word = t('app.hys.archive.confirm_word');
        const w = window.prompt(t('app.hys.archive.confirm_second', { word }));
        if (w === null) return;
        if (w.trim() !== word) { window.alert(t('app.hys.archive.confirm_wrong')); return; }
        try {
            const d = await archPost('', JSON.stringify({ action: 'delete', id_ese: it.id_ese, confirm: 'ELIMINA' }), 'application/json');
            row.remove();
            this._rows.delete(it.id_ese);
            if (this._files?.it.id_ese === it.id_ese) { this._files.box.remove(); this._files = null; }
            this._setStatus(t('app.hys.archive.deleted.@', { id: it.id_ese, folder: d.folder }));
        } catch (e) {
            this._setStatus(t('app.hys.delete_failed', { error: e.message }), true);
        }
    };

    HTMHysArchivio.prototype.onStart = function () { this._build(); };
    HTMHysArchivio.prototype.onExecute = function () { if (!this._root?.isConnected) this._build(); };
    HTMHysArchivio.prototype.onRemoved = function () {
        try { this._root?.remove(); this._files?.box.remove(); } catch {}
        this._files = null;
        this._root = null;
        this._ui = null;
    };
    LG.registerNodeType('HTM/HYS/Archivio Esercitazioni', HTMHysArchivio);
}
