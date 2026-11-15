// model_TML.mjs
// Timeline per ReseArch (vis-timeline). Progetto e decisioni: _doc/module-tml-timeline.md
//
// ── Dati e configurazione ─────────────────────────────────────────────────────
//   Sorgenti (dato della ricerca), ognuna un modello dell'oggetto (TML-sources.mjs):
//     file JSON { "groups": [...], "items": [...] }  ·  fogli Google Sheets (§3.3)
//   ogni sorgente appartiene a un livello (mod_spec.layer, §3.5).
//   modello di configurazione (§3): il modello il cui mod_spec contiene almeno una di queste
//   chiavi, scelto per contenuto (l'ordine dei modelli non conta); di solito "Nessun file":
//   {
//     "view": { "start", "end", "min", "max",       // date storiche (§2), opzionali
//               "zoomMin": "1d", "zoomMax": "5000y",
//               "orientation": "top"|"bottom", "stack": true,
//               "era": "auto"|"always"|"never",
//               "cursor": null | data },
//     "css": ["tema.css"],                           // file nella cartella del modello (§11.1)
//     "cssText": "…" | ["…"],                        // CSS scritto nel mod_spec (§11.1)
//     "layerMode": "stack"|"merge",                  // livelli affiancati o fusi (§3.5)
//     "layers": { "<id>": { "label", "css": [], "cssText", "visible", "open" } }
//   }
//   + ogni modello il cui file è un .css si applica sempre (§11.1).
//
// Date: stringhe "YYYY[-MM[-DD[THH:mm[:ss]]]]" con anno storico (-753 = 753 a.C.) o numero
// intero = anno; nei nodi e nel bus millisecondi UTC (TML-dates.mjs).
// Testi (content, title, etichette dei gruppi) sempre come testo, mai HTML.
//
// vis-timeline NON è in dashboard.php: si carica qui al primo uso (singleton). Il bundle
// standalone inserisce da sé il proprio CSS; css/TML.css va caricato dopo.

import { appBusOn, appBusEmit } from './app-bus.mjs';
import * as D from './TML_sub_modules/TML-dates.mjs';
import { applyModelCss, modelFolderUrl } from './shared/model-css.mjs';
import { tmlLoadFlows } from './TML_sub_modules/TML-flow-runner.mjs';
import { tmlSlug, classifyModels, fetchSource, DEFAULT_LAYER } from './TML_sub_modules/TML-sources.mjs';
import { t, te } from './shared/i18n.mjs';

export { tmlSlug };

const STATE_KEY  = '__TML_STATE__';
const VIS_JS     = 'lib/vis-timeline/vis-timeline-graph2d.min.js';   // vis-timeline 8.5.4
const TML_CSS    = 'css/TML.css';
const CURSOR_ID  = 'tml-cursor';
const ITEM_TYPES = new Set(['point', 'box', 'range', 'background']);
const NO_GROUP   = '__tml_none';
const LAYER_ROOT = '__tml_layer:';
const YEAR_MS    = 31556952000;
const INLINE_CSS = 'mod_spec.cssText';   // nome della voce CSS scritta nel mod_spec (§11.1)

// ── Caricamento lazy di vis-timeline + css/TML.css ──────────────────────────────

let _visPromise = null;

function _ensureBaseCss() {
    if (document.querySelector('link[data-tml-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = TML_CSS;
    link.dataset.tmlCss = '1';
    document.head.appendChild(link);   // dopo gli <style> inseriti da vis-timeline
}

function _ensureVis() {
    if (window.vis?.Timeline) { _ensureBaseCss(); return Promise.resolve(window.vis); }
    if (_visPromise) return _visPromise;
    _visPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = VIS_JS;
        s.onload = () => {
            if (window.vis?.Timeline) { _ensureBaseCss(); resolve(window.vis); }
            else reject(new Error(t('app.tml.err.vis_unavailable')));
        };
        s.onerror = () => { _visPromise = null; reject(new Error(t('app.tml.err.load_failed', { file: VIS_JS }))); };
        document.head.appendChild(s);
    });
    return _visPromise;
}

// ── Utilità ─────────────────────────────────────────────────────────────────────

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const _strArray = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]))
    .map(x => String(x ?? '').trim()).filter(Boolean);

/** Precisione adatta a una durata visibile (etichette di finestra e cursore). */
function _precisionForSpan(span) {
    if (span > 60 * YEAR_MS) return 'year';
    if (span > 2 * YEAR_MS)  return 'month';
    if (span > 3 * 86400000) return 'day';
    return 'minute';
}

function _shouldHandleMsg(msg, object) {
    const p = msg?.payload ?? {};
    if (p.targetApp && p.targetApp !== 'TML') return false;
    if (p.targetObjId != null && Number(p.targetObjId) !== Number(object?.obj_id)) return false;
    return true;
}

function _busEmit(state, type, payload) {
    appBusEmit(type, { objId: state.object?.obj_id ?? null, ...payload },
        { sourceApp: 'TML', sourcePanelId: state.object?.obj_id ?? null });
}

// ── Normalizzazione dei dati ───────────────────────────────────────────────────
//
// "Forma porta" di un item (nodi, bus, state.items): come nel file ma con date in ms
//   { id, type, start, end, content, title, group, class: [], tags: [], link, data }
// dateMode 'file': start/end nel formato dei dati (§2); 'ms': già in millisecondi.

function _readDate(v, dateMode, what) {
    if (dateMode === 'ms') {
        if (v == null || v === '') return null;
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(t('app.tml.err.not_ms', { what }));
        return { ms: n, precision: null };
    }
    if (v == null || v === '') return null;
    return D.parseHistDate(v);
}

/**
 * @returns {{ item: object, precision: {start, end} }}
 * @throws Error se l'item non è valido
 */
function _normItem(raw, idx, dateMode) {
    if (!raw || typeof raw !== 'object') throw new Error(t('app.tml.err.item_not_object', { n: idx + 1 }));
    const id = raw.id != null && raw.id !== '' ? String(raw.id) : `i${idx + 1}`;
    const s = _readDate(raw.start, dateMode, 'start');
    if (!s) throw new Error(t('app.tml.err.item_no_start', { id }));
    const e = _readDate(raw.end, dateMode, 'end');
    const type = raw.type ? String(raw.type) : (e ? 'range' : 'box');
    if (!ITEM_TYPES.has(type)) throw new Error(t('app.tml.err.item_bad_type', { id, type }));
    if ((type === 'range' || type === 'background') && !e) throw new Error(t('app.tml.err.item_needs_end', { id, type }));
    if (e && e.ms < s.ms) throw new Error(t('app.tml.err.item_end_before_start', { id }));
    return {
        item: {
            id, type,
            start:   s.ms,
            end:     (type === 'point' || type === 'box') ? null : (e?.ms ?? null),
            content: raw.content != null ? String(raw.content) : '',
            title:   raw.title != null ? String(raw.title) : '',
            group:   raw.group != null && raw.group !== '' ? String(raw.group) : null,
            class:   _strArray(raw.class),
            tags:    _strArray(raw.tags),
            link:    raw.link && typeof raw.link === 'object' ? raw.link : null,
            data:    raw.data && typeof raw.data === 'object' ? raw.data : null,
            layer:   raw.layer != null && raw.layer !== '' ? String(raw.layer) : null,
        },
        precision: { start: s.precision, end: e?.precision ?? null },
    };
}

function _normGroup(raw, idx) {
    if (!raw || typeof raw !== 'object' || raw.id == null || raw.id === '') throw new Error(t('app.tml.err.group_no_id', { n: idx + 1 }));
    return {
        id:      String(raw.id),
        content: raw.content != null ? String(raw.content) : String(raw.id),
        title:   raw.title != null ? String(raw.title) : '',
        class:   _strArray(raw.class),
        order:   Number.isFinite(Number(raw.order)) ? Number(raw.order) : idx,
        nested:  _strArray(raw.nested),
        open:    raw.open !== false,
        visible: raw.visible !== false,
        layer:   null,   // livello del gruppo (§3.5); null = gruppo comune
    };
}

// ── Livelli (§3.5) ──────────────────────────────────────────────────────────────

/** Livelli affiancati: ogni livello è un gruppo radice con le sue corsie. */
const _stacked = (state) => state.multi && state.layerMode === 'stack';

const _isLaneOrRoot = (id) => id === NO_GROUP || id.startsWith(`${NO_GROUP}:`) || id.startsWith(LAYER_ROOT);

const _layerVisible = (state, id) => id == null || state.layers.get(id)?.visible !== false;

const _groupVisible = (state, g) => g.visible && _layerVisible(state, g.layer);

/**
 * Visibilità effettiva delle corsie nel DataSet: la corsia, il suo livello e ogni antenato visibili,
 * e ogni antenato aperto. vis-timeline 8.5.4 al caricamento nasconde solo i figli diretti di un
 * gruppo chiuso (i nipoti di una corsia aperta dentro un livello chiuso finivano sciolti in cima) e,
 * aprendo un gruppo col clic, rende visibili tutti i discendenti, anche quelli nascosti (visibile = no).
 * Aggiorna solo le differenze, quindi richiamata dal proprio evento 'update' si ferma.
 */
function _syncGroupVisibility(state) {
    const ds = state.groupsDS;
    if (!ds || !state.hasGroups) return;
    const parent = new Map();
    for (const g of state.groups.values()) for (const n of g.nested) parent.set(n, g.id);
    const fix = [];
    for (const g of state.groups.values()) {
        let shown = _groupVisible(state, g);
        for (let pid = parent.get(g.id), n = 0; shown && pid != null && n < 64; pid = parent.get(pid), n++) {
            const a = state.groups.get(pid);
            shown = !!a && _groupVisible(state, a) && ds.get(pid)?.showNested !== false;
        }
        const d = ds.get(g.id);
        if (d && d.visible !== shown) fix.push({ id: g.id, visible: shown });
    }
    if (fix.length) ds.update(fix);
}

// ── Corsie disattivate (doppio clic sull'etichetta, 2026-10-20) ─────────────────
// Etichetta in grigio (.tml-disabled), item della corsia e delle sue sottocorsie nascosti, non si
// apre. state.disabled = id scelti (restano alla ricarica: gli id sono stabili);
// state.disabledLanes = scelti + discendenti, usato dal filtro della DataView e dal footer.

function _computeDisabledLanes(state) {
    const out = new Set();
    const walk = (id, n = 0) => {
        if (out.has(id) || n > 64) return;
        out.add(id);
        for (const c of state.groups.get(id)?.nested ?? []) walk(c, n + 1);
    };
    for (const id of state.disabled) if (state.groups.has(id)) walk(id);
    state.disabledLanes = out;
}

function _setGroupEnabled(state, id, enabled) {
    const g = state.groups.get(id);
    if (!g || state.disabled.has(id) === !enabled) return;
    if (enabled) state.disabled.delete(id); else state.disabled.add(id);
    _computeDisabledLanes(state);
    const upd = { id, className: _toVisGroup(state, g).className };
    if (!enabled && g.nested.length) { upd.showNested = false; g.open = false; }
    state.groupsDS.update(upd);
    state.itemsView.refresh();
    _updateFooter(state);
}

/** mod_spec.layers → Map id → { label, css, visible } (id ridotti a [a-z0-9-]). */
function _layerConf(spec) {
    const out = new Map();
    const raw = spec.layers && typeof spec.layers === 'object' && !Array.isArray(spec.layers) ? spec.layers : {};
    for (const [k, v] of Object.entries(raw)) {
        const id = tmlSlug(k);
        if (!id) continue;
        const c = v && typeof v === 'object' ? v : {};
        const css = _strArray(c.css).map(String);
        const cssText = _cssText(c.cssText);
        if (cssText) css.push(`${INLINE_CSS}:${id}`);
        out.set(id, { label: c.label != null ? String(c.label) : '', css, cssText, visible: c.visible !== false, open: c.open !== false });
    }
    return out;
}

/** cssText del mod_spec: stringa o array di righe → testo ('' se assente). */
const _cssText = (v) => (Array.isArray(v) ? v.map(String).join('\n') : (v != null ? String(v) : '')).trim();

/**
 * Voci CSS per model-css.mjs (§11.1), in ordine: modelli il cui file è un .css, mod_spec.css,
 * mod_spec.cssText, poi quelle dei livelli. main = nomi sempre accesi.
 */
function _cssEntries(cssModels, spec, layerConf) {
    const entries = [], seen = new Set();
    const add = (e) => {
        const n = typeof e === 'string' ? e : e.name;
        if (n && !seen.has(n)) { seen.add(n); entries.push(e); }
    };
    for (const m of cssModels) add({ name: String(m.mod_filename).split('/').pop(), url: m.mod_abs_url });
    _strArray(spec.css).map(String).forEach(add);
    const text = _cssText(spec.cssText);
    if (text) add({ name: INLINE_CSS, text });
    const main = entries.map(e => (typeof e === 'string' ? e : e.name));
    for (const [id, c] of layerConf) {
        for (const n of c.css) add(n === `${INLINE_CSS}:${id}` ? { name: n, text: c.cssText } : n);
    }
    return { entries, main };
}

/** Livelli presenti: prima quelli di mod_spec.layers, poi nell'ordine delle sorgenti. */
function _buildLayers(state, list) {
    const layers = new Map();
    const add = (id) => {
        if (layers.has(id)) return;
        const c = state.layerConf.get(id) ?? {};
        const prev = state.layers.get(id);
        layers.set(id, {
            id,
            label:   c.label || (id === DEFAULT_LAYER ? t('app.tml.layer_default') : id),
            css:     c.css ?? [],
            visible: prev ? prev.visible : c.visible !== false,
            open:    c.open !== false,   // riga del livello aperta all'avvio (modo "stack")
            count:   0,
        });
    };
    for (const id of state.layerConf.keys()) add(id);
    for (const src of list) if (src.layer || src.items.length) add(src.layer ?? DEFAULT_LAYER);
    return layers;
}

/** CSS dei livelli: acceso se è in mod_spec.css o se almeno un livello visibile lo usa. */
function _syncLayerCss(state) {
    if (!state.css) return;
    const files = new Set();
    for (const l of state.layers.values()) l.css.forEach(f => files.add(f));
    for (const f of files) {
        const on = state.mainCss.includes(f) || [...state.layers.values()].some(l => l.visible && l.css.includes(f));
        state.css.setActive(f, on);
    }
}

// ── Stato e costruzione della timeline ─────────────────────────────────────────

function _destroy(bodyEl) {
    const st = bodyEl?.[STATE_KEY];
    if (!st) return;
    st.stopped = true;
    try { st.timeline?.destroy(); } catch { /* noop */ }
    try { st.root?.remove(); } catch { /* noop */ }
    try { delete bodyEl[STATE_KEY]; } catch { /* noop */ }
}

function _showMessage(state, text) {
    state.canvas.replaceChildren();
    const d = document.createElement('div');
    d.className = 'tml-message';
    d.textContent = text;
    state.root.appendChild(d);
}

/** Classi di un item: tipo, classi, tag, gruppo, filtro. */
function _itemClassName(state, it) {
    const cls = [`tml-t-${it.type}`];
    for (const c of it.class) { const s = tmlSlug(c); if (s) cls.push(`tml-c-${s}`); }
    for (const tag of it.tags) { const s = tmlSlug(tag); if (s) cls.push(`tml-tag-${s}`); }
    if (it.group) { const s = tmlSlug(it.group); if (s) cls.push(`tml-g-${s}`); }
    if (it.layer) { const s = tmlSlug(it.layer); if (s) cls.push(`tml-l-${s}`); }
    if (state.filter?.mode === 'dim' && !state.filterPass.has(it.id)) cls.push('tml-filtered-out');
    return cls.join(' ');
}

function _dateLabel(state, ms, precision) {
    return D.formatHistDate(ms, precision ?? 'day', state.era, state.showAD);
}

/**
 * Tooltip: titolo, date, nota. vis-timeline lo inserisce con innerHTML (filtrato dalla sua
 * xss): qui ogni testo dei dati passa da _esc, quindi nessun HTML dei dati arriva alla pagina.
 */
function _tooltipHtml(state, it) {
    const prec = state.precision.get(it.id) ?? {};
    const when = it.end != null
        ? `${_dateLabel(state, it.start, prec.start)} – ${_dateLabel(state, it.end, prec.end)}`
        : _dateLabel(state, it.start, prec.start);
    let html = `<div><b>${_esc(it.content)}</b></div><div>${_esc(when)}</div>`;
    if (it.title) html += `<div style="margin-top:4px">${_esc(it.title)}</div>`;
    return html;
}

/** Corsia in cui disegnare un item senza gruppo: "—" globale o del livello, o la radice del livello. */
function _laneFor(state, it) {
    if (it.group) return it.group;
    if (it.type === 'background') return undefined;   // fascia su tutta la timeline
    if (_stacked(state)) {
        const L = it.layer ?? DEFAULT_LAYER;
        const lane = `${NO_GROUP}:${L}`;
        if (state.groups.has(lane)) return lane;
        if (state.groups.has(LAYER_ROOT + L)) return LAYER_ROOT + L;
    }
    return state.hasGroups ? NO_GROUP : undefined;
}

function _toVisItem(state, it) {
    return {
        id:        it.id,
        type:      it.type,
        start:     new Date(it.start),
        end:       it.end != null ? new Date(it.end) : undefined,
        content:   it.content,
        title:     _tooltipHtml(state, it),
        group:     _laneFor(state, it),
        className: _itemClassName(state, it),
        _layer:    it.layer,
    };
}

/** Livello di ogni gruppo nell'albero (0 = principale): vis-timeline lo vuole per i sottogruppi. */
function _groupLevels(groups) {
    const parent = new Map();
    for (const g of groups.values()) for (const c of g.nested) if (!parent.has(c)) parent.set(c, g.id);
    const level = new Map();
    const depth = (id, seen = new Set()) => {
        if (level.has(id)) return level.get(id);
        if (seen.has(id)) return 0;   // cicli: li tratta come gruppi principali
        seen.add(id);
        const p = parent.get(id);
        const d = p == null ? 0 : depth(p, seen) + 1;
        level.set(id, d);
        return d;
    };
    for (const id of groups.keys()) depth(id);
    return level;
}

function _toVisGroup(state, g, level = 0) {
    const cls = [`tml-g-${tmlSlug(g.id)}`, ...g.class.map(c => `tml-c-${tmlSlug(c)}`)];
    if (g.layer) cls.push(`tml-l-${tmlSlug(g.layer)}`);
    if (g.isLayerRoot) cls.push('tml-layer');
    if (state.disabled?.has(g.id)) cls.push('tml-disabled');
    return {
        id:           g.id,
        content:      g.content,
        title:        g.title || undefined,
        className:    cls.join(' '),
        order:        g.order,
        treeLevel:    level,
        nestedGroups: g.nested.length ? g.nested : undefined,
        showNested:   g.open,
        visible:      _groupVisible(state, g),
    };
}

/**
 * { groups, items } dei nodi (date in ms) → sorgenti per livello. Gli id già composti
 * ("rossi:cesare", come li restituiscono Item/List e Group/List) non vengono prefissati due volte.
 */
function _dataToSources(data) {
    const byLayer = new Map();
    const get = (layer) => {
        const L = layer != null && layer !== '' ? (tmlSlug(layer) || null) : null;
        if (!byLayer.has(L)) byLayer.set(L, { layer: L, groups: [], items: [] });
        return byLayer.get(L);
    };
    for (const g of Array.isArray(data?.groups) ? data.groups : []) get(g?.layer).groups.push(g);
    for (const it of Array.isArray(data?.items) ? data.items : []) get(it?.layer).items.push(it);
    return [...byLayer.values()];
}

/**
 * Sostituisce tutti i dati della timeline.
 * @param {Array<{ layer: string|null, groups: any[], items: any[] }>} list  sorgenti (§3.5)
 * @param {'file'|'ms'} dateMode
 * @returns {{ count: number, warnings: string[] }}
 */
function _setSources(state, list, dateMode) {
    const warnings = [];
    state.lastData = { list, dateMode };
    state.layers = _buildLayers(state, list);
    state.multi = state.layers.size > 1;
    const stacked = _stacked(state);
    const strip = (id, L) => (L && id.startsWith(`${L}:`) ? id.slice(L.length + 1) : id);
    const gid = (L, id) => (stacked && L ? `${L}:${id}` : id);
    const iid = (L, id) => (state.multi ? `${L}:${id}` : id);

    // ── gruppi: di un livello o comuni (sorgente senza layer) ───────────────────
    const groups = new Map();
    const groupSrc = new Map();
    list.forEach((src, si) => {
        const L = src.layer ?? null;
        (Array.isArray(src.groups) ? src.groups : []).forEach((raw, i) => {
            try {
                const g = _normGroup(raw, i);
                g.id = gid(L, strip(g.id, L));
                g.nested = g.nested.map(n => gid(L, strip(n, L)));
                g.layer = L;
                const prev = groups.get(g.id);
                if (!prev) { groups.set(g.id, g); groupSrc.set(g.id, si); return; }
                if (groupSrc.get(g.id) === si) throw new Error(t('app.tml.err.group_duplicate', { id: g.id }));
                // stesso id da un'altra sorgente: una corsia sola (modo "merge" o due fogli dello stesso livello)
                prev.nested = [...new Set([...prev.nested, ...g.nested])];
                if (prev.layer !== g.layer) prev.layer = null;
            } catch (e) { warnings.push(e.message); }
        });
    });

    // ── item ───────────────────────────────────────────────────────────────────
    const items = new Map();
    state.precision = new Map();
    list.forEach((src) => {
        const L = src.layer ?? DEFAULT_LAYER;
        (Array.isArray(src.items) ? src.items : []).forEach((raw, i) => {
            try {
                const { item, precision } = _normItem(raw, i, dateMode);
                item.layer = L;
                item.id = iid(L, strip(item.id, L));
                if (items.has(item.id)) throw new Error(t('app.tml.err.item_duplicate', { id: item.id }));
                if (item.group) {
                    // il gruppo si cerca nel livello, poi fra i comuni; altrimenti nasce nel livello
                    const local = strip(item.group, L);
                    const own = gid(L, local);
                    if (groups.has(own)) item.group = own;
                    else if (groups.has(local) && !groups.get(local).layer) item.group = local;
                    else {
                        item.group = own;
                        const g = _normGroup({ id: own, content: local }, groups.size);
                        g.layer = stacked ? L : null;
                        groups.set(own, g);
                    }
                }
                items.set(item.id, item);
                state.precision.set(item.id, precision);
                const layer = state.layers.get(L);
                if (layer) layer.count++;
            } catch (e) { warnings.push(e.message); }
        });
    });

    // sottogruppi inesistenti
    for (const g of groups.values()) {
        const missing = g.nested.filter(id => !groups.has(id));
        if (missing.length) {
            warnings.push(t('app.tml.err.group_missing_nested', { id: g.id, list: missing.join(', ') }));
            g.nested = g.nested.filter(id => groups.has(id));
        }
    }

    const loose = (L) => [...items.values()].some(it => !it.group && it.type !== 'background' && (L == null || it.layer === L));
    if (stacked) {
        // un gruppo radice per livello con le sue corsie principali (+ "—" per gli item senza gruppo)
        const childOf = new Set();
        for (const g of groups.values()) g.nested.forEach(n => childOf.add(n));
        let idx = 0;
        for (const layer of state.layers.values()) {
            const L = layer.id;
            const top = [...groups.values()].filter(g => g.layer === L && !childOf.has(g.id)).map(g => g.id);
            if (top.length && loose(L)) {
                const lane = _normGroup({ id: `${NO_GROUP}:${L}`, content: '—', order: 1e9 }, 0);
                lane.layer = L;
                groups.set(lane.id, lane);
                top.push(lane.id);
            }
            // aperta/chiusa: alla ricarica resta com'era, al primo caricamento layers.<id>.open
            const wasOpen = state.groupsDS?.get(LAYER_ROOT + L)?.showNested;
            const root = _normGroup({ id: LAYER_ROOT + L, content: layer.label, order: -1e6 + idx++, open: wasOpen ?? layer.open }, 0);
            root.nested = top;
            root.layer = L;
            root.isLayerRoot = true;
            groups.set(root.id, root);
        }
    }

    state.items = items;
    state.groups = groups;
    state.hasGroups = groups.size > 0;
    if (!stacked && state.hasGroups && loose(null)) {
        groups.set(NO_GROUP, _normGroup({ id: NO_GROUP, content: '—', order: 1e9 }, groups.size));
    }

    const yearOne = D.fromParts(1);
    state.showAD = [...items.values()].some(it => it.start < yearOne) ||
                   (state.viewMin != null && state.viewMin < yearOne);

    _computeFilter(state);
    _computeDisabledLanes(state);
    state.groupsDS.clear();
    state.itemsDS.clear();
    if (state.hasGroups) {
        const levels = _groupLevels(groups);
        state.groupsDS.add([...groups.values()].map(g => _toVisGroup(state, g, levels.get(g.id) ?? 0)));
        state.timeline.setGroups(state.groupsDS);
        _syncGroupVisibility(state);
    } else {
        state.timeline.setGroups(null);
    }
    state.itemsDS.add([...items.values()].map(it => _toVisItem(state, it)));
    state.itemsView.refresh();
    _syncLayerCss(state);
    return { count: items.size, warnings };
}

// ── Filtro ───────────────────────────────────────────────────────────────────

/** Gruppi più tutti i loro sottogruppi. */
function _withNested(state, ids) {
    const out = new Set();
    const visit = (id) => {
        if (out.has(id)) return;
        out.add(id);
        for (const n of state.groups.get(id)?.nested ?? []) visit(n);
    };
    ids.forEach(visit);
    return out;
}

function _computeFilter(state) {
    const f = state.filter;
    state.filterPass = new Set();
    for (const it of state.items.values()) {
        if (!f) { state.filterPass.add(it.id); continue; }
        let ok = true;
        if (f.tags?.length)   ok = ok && it.tags.some(tag => f.tags.includes(tag));
        if (f.groups?.length) ok = ok && it.group != null && _withNested(state, f.groups).has(it.group);
        if (f.layers?.length) ok = ok && f.layers.includes(it.layer);
        const end = it.end ?? it.start;
        if (f.from != null)   ok = ok && end >= f.from;
        if (f.to != null)     ok = ok && it.start <= f.to;
        if (f.text)           ok = ok && `${it.content}\n${it.title}`.toLowerCase().includes(f.text.toLowerCase());
        if (ok) state.filterPass.add(it.id);
    }
}

function _applyFilter(state, filter) {
    if (filter != null && typeof filter !== 'object') throw new Error(t('app.tml.err.must_be_object', { name: 'filter' }));
    state.filter = filter ? {
        tags:   _strArray(filter.tags),
        groups: _strArray(filter.groups),
        layers: _strArray(filter.layers).map(tmlSlug),
        from:   filter.from != null && filter.from !== '' ? Number(filter.from) : null,
        to:     filter.to != null && filter.to !== '' ? Number(filter.to) : null,
        text:   filter.text ? String(filter.text) : '',
        mode:   filter.mode === 'dim' ? 'dim' : 'hide',
    } : null;
    _computeFilter(state);
    // le classi cambiano solo con "dim" (o passando da dim a nulla): aggiorna tutti gli item
    state.itemsDS.update([...state.items.values()].map(it => ({ id: it.id, className: _itemClassName(state, it) })));
    state.itemsView.refresh();
    _updateFooter(state);
    return state.filterPass.size;
}

// ── Cursore ──────────────────────────────────────────────────────────────────

function _cursorLabel(state, ms) {
    const w = state.timeline.getWindow();
    return _dateLabel(state, ms, _precisionForSpan(+w.end - +w.start));
}

function _setCursor(state, ms, { emit = true, byUser = false } = {}) {
    const tl = state.timeline;
    if (ms == null) {
        if (state.cursor != null) { try { tl.removeCustomTime(CURSOR_ID); } catch { /* noop */ } }
        state.cursor = null;
        return;
    }
    const tm = Number(ms);
    if (!Number.isFinite(tm)) throw new Error(t('app.tml.err.not_ms', { what: '"time"' }));
    if (state.cursor == null) tl.addCustomTime(new Date(tm), CURSOR_ID);
    else tl.setCustomTime(new Date(tm), CURSOR_ID);
    tl.setCustomTimeMarker(_cursorLabel(state, tm), CURSOR_ID, false);
    state.cursor = tm;
    state.localEvents.dispatchEvent(new CustomEvent('cursorchanged', { detail: { time: tm, byUser } }));
    if (emit) _busEmit(state, 'tml:cursor:changed', { time: tm, byUser });
}

// ── Selezione ────────────────────────────────────────────────────────────────

function _emitSelection(state, id, byUser) {
    const it = state.items.get(id);
    if (!it) return;
    state.localEvents.dispatchEvent(new CustomEvent('select', { detail: { item: it, byUser } }));
    _busEmit(state, 'selection:change', {
        targetObjId: state.object?.obj_id ?? null,   // solo i pannelli dello stesso oggetto (come MPS)
        field: 'item', value: it.id, row: it,
        start: it.start, end: it.end, group: it.group, layer: it.layer, link: it.link,
    });
}

// ── Footer ───────────────────────────────────────────────────────────────────

function _windowLabel(state) {
    const w = state.timeline?.getWindow?.();
    if (!w) return '';
    const p = _precisionForSpan(+w.end - +w.start);
    return `${_dateLabel(state, +w.start, p)} – ${_dateLabel(state, +w.end, p)}`;
}

function _updateFooter(state, { show = false } = {}) {
    if (!state.timeline) return;
    const total = state.items.size;
    let shown = 0;
    for (const it of state.items.values()) {
        if (state.filterPass.has(it.id) && _layerVisible(state, it.layer) && !state.disabledLanes.has(_laneFor(state, it))) shown++;
    }
    const parts = [_esc(_windowLabel(state)), te('app.tml.footer.items', { n: shown === total ? total : `${shown}/${total}` })];
    if (state.multi) {
        const on = [...state.layers.values()].filter(l => l.visible).length;
        parts.push(te('app.tml.footer.layers', { n: on === state.layers.size ? state.layers.size : `${on}/${state.layers.size}` }));
    }
    if (state.filter) parts.push(te('app.tml.footer.filter_on'));
    const status = parts.join(' · ');
    const hints = state.warnings.length
        ? t('app.tml.footer.warnings', { n: state.warnings.length, list: `${state.warnings.slice(0, 3).join(' · ')}${state.warnings.length > 3 ? ' …' : ''}` })
        : '';
    if (show) state.cmdUI?.show?.({ status, hints });
    else state.cmdUI?.update?.({ status, hints });
}

// ── Caricamento dati e CSS ────────────────────────────────────────────────────

/**
 * Legge tutte le sorgenti in parallelo; una sorgente che non si legge diventa un avviso.
 * @returns {Promise<{ list: Array<{ layer, groups, items }>, warnings: string[] }>}
 */
async function _fetchAll(state) {
    const res = await Promise.allSettled(state.sources.map(src => fetchSource(src, state.signal)));
    const list = [], warnings = [];
    res.forEach((r, i) => {
        const src = state.sources[i];
        if (r.status === 'fulfilled') {
            list.push({ layer: src.layer, groups: r.value.groups, items: r.value.items });
            warnings.push(...r.value.warnings);
        } else {
            const p = { name: src.name, msg: r.reason?.message ?? r.reason };
            warnings.push(src.kind === 'sheet' ? t('app.tml.warn_sheet', p) : t('app.tml.warn_file', p));
        }
    });
    if (!list.length && warnings.length) throw new Error(warnings.join(' · '));
    return { list, warnings };
}

async function _reloadAll(state) {
    const { list, warnings: readWarnings } = await _fetchAll(state);
    if (state.stopped) return;
    const { warnings } = _setSources(state, list, 'file');
    const css = state.css ? await state.css.reload() : { errors: [] };
    if (state.stopped) return;
    _syncLayerCss(state);
    state.warnings = [...state.configWarnings, ...readWarnings, ...warnings, ...css.errors];
    if (state.cursor != null) state.timeline.setCustomTimeMarker(_cursorLabel(state, state.cursor), CURSOR_ID, false);
    _updateFooter(state, { show: true });
}

// ── Metodi per i nodi flow (TML-flow-runner.mjs → _appContext) ─────────────────

function _attachApi(state) {
    const need = (id) => {
        const it = state.items.get(String(id ?? ''));
        if (!it) throw new Error(t('app.tml.err.no_item', { id }));
        return it;
    };
    const putItem = (it) => {
        state.items.set(it.id, it);
        _computeFilter(state);
        state.itemsDS.update(_toVisItem(state, it));
        state.itemsView.refresh();
    };

    Object.assign(state, {
        addItem(raw) {
            const n = state._autoId = (state._autoId ?? 0) + 1;
            const src = { ...raw };
            if (src.id == null || src.id === '') src.id = `n${n}`;
            const { item, precision } = _normItem(src, 0, 'ms');
            if (state.items.has(item.id)) throw new Error(t('app.tml.err.item_exists', { id: item.id }));
            // livello: quello indicato se esiste, altrimenti il primo (o "base")
            const L = tmlSlug(item.layer);
            item.layer = state.layers.has(L) ? L : (state.layers.keys().next().value ?? DEFAULT_LAYER);
            if (!state.layers.has(item.layer)) {
                state.layers.set(item.layer, { id: item.layer, label: item.layer === DEFAULT_LAYER ? t('app.tml.layer_default') : item.layer, css: [], visible: true, count: 0 });
            }
            const root = _stacked(state) ? state.groups.get(LAYER_ROOT + item.layer) : null;
            if (item.group && !state.groups.has(item.group) && root) {
                // livelli affiancati: la corsia nuova nasce dentro il gruppo radice del livello
                const prefix = `${item.layer}:`;
                const g = _normGroup({ id: item.group, content: item.group.startsWith(prefix) ? item.group.slice(prefix.length) : item.group }, state.groups.size);
                g.layer = item.layer;
                state.groups.set(g.id, g);
                root.nested.push(g.id);
                state.groupsDS.add(_toVisGroup(state, g, 1));
                state.groupsDS.update({ id: root.id, nestedGroups: root.nested });
            } else if (item.group && !state.groups.has(item.group)) {
                const hadGroups = state.hasGroups;
                const g = _normGroup({ id: item.group }, state.groups.size);
                state.groups.set(g.id, g);
                state.hasGroups = true;
                state.groupsDS.add(_toVisGroup(state, g));
                if (!hadGroups) {
                    // prima corsia: gli item già presenti senza gruppo vanno nella corsia "—"
                    const loose = [...state.items.values()].filter(x => !x.group && x.type !== 'background');
                    if (loose.length) {
                        const ng = _normGroup({ id: NO_GROUP, content: '—', order: 1e9 }, state.groups.size);
                        state.groups.set(NO_GROUP, ng);
                        state.groupsDS.add(_toVisGroup(state, ng));
                    }
                    state.timeline.setGroups(state.groupsDS);
                    state.itemsDS.update(loose.map(x => _toVisItem(state, x)));
                }
            }
            state.precision.set(item.id, { start: precision.start, end: precision.end });
            state.layers.get(item.layer).count++;
            putItem(item);
            _updateFooter(state);
            return item.id;
        },
        updateItem(id, fields) {
            if (!fields || typeof fields !== 'object') throw new Error(t('app.tml.err.must_be_object', { name: 'fields' }));
            const cur = need(id);
            const { item } = _normItem({ ...cur, ...fields, id: cur.id }, 0, 'ms');
            putItem(item);
        },
        removeItem(id) {
            const it = need(id);
            state.items.delete(it.id);
            state.itemsDS.remove(it.id);
            const layer = state.layers.get(it.layer);
            if (layer) layer.count = Math.max(0, layer.count - 1);
            _computeFilter(state);
            state.itemsView.refresh();
            _updateFooter(state);
        },
        getItem: (id) => need(id),
        listItems(group) {
            const all = [...state.items.values()];
            if (group == null || group === '') return all;
            const set = _withNested(state, [String(group)]);
            return all.filter(it => it.group != null && set.has(it.group));
        },
        selectItems(ids, emit) {
            const list = _strArray(ids).filter(id => state.items.has(id));
            state.timeline.setSelection(list);
            if (emit && list.length) _emitSelection(state, list[0], false);
            return list.length;
        },
        setItemClass(id, classes, op) {
            const it = need(id);
            const add = _strArray(classes);
            let next;
            if (op === 'add')         next = [...new Set([...it.class, ...add])];
            else if (op === 'remove') next = it.class.filter(c => !add.includes(c));
            else                      next = add;
            putItem({ ...it, class: next });
        },
        setWindow(start, end, animate) {
            const s = Number(start), e = Number(end);
            if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) throw new Error(t('app.tml.err.bad_window'));
            state.timeline.setWindow(new Date(s), new Date(e), { animation: !!animate });
        },
        getWindow() {
            const w = state.timeline.getWindow();
            return { start: +w.start, end: +w.end };
        },
        fit(ids) {
            const list = _strArray(ids).filter(id => state.items.has(id));
            if (list.length) state.timeline.focus(list);
            else state.timeline.fit();
        },
        focusItem(id) { need(id); state.timeline.focus(String(id)); },
        listGroups: () => [...state.groups.values()].filter(g => !_isLaneOrRoot(g.id)).map(g => ({
            id: g.id, content: g.content, title: g.title, class: [...g.class], order: g.order,
            nested: g.nested.filter(n => !_isLaneOrRoot(n)), open: g.open, visible: g.visible, enabled: !state.disabled.has(g.id), layer: g.layer,
        })),
        setGroupVisible(id, visible) {
            const g = state.groups.get(String(id ?? ''));
            if (!g || _isLaneOrRoot(g.id)) throw new Error(t('app.tml.err.no_group', { id }));
            g.visible = !!visible;
            state.groupsDS.update({ id: g.id, visible: _groupVisible(state, g) });
        },
        listLayers: () => [...state.layers.values()].map(({ id, label, visible, count }) => ({ id, label, visible, count })),
        setLayerVisible(id, visible) {
            const layer = state.layers.get(tmlSlug(id));
            if (!layer) throw new Error(t('app.tml.err.no_layer', { id }));
            layer.visible = !!visible;
            state.groupsDS.update([...state.groups.values()].filter(g => g.layer === layer.id)
                .map(g => ({ id: g.id, visible: _groupVisible(state, g) })));
            state.itemsView.refresh();
            _syncLayerCss(state);
            _updateFooter(state);
        },
        setLayerMode(mode) {
            if (mode !== 'stack' && mode !== 'merge') throw new Error(t('app.tml.err.bad_mode'));
            if (state.layerMode === mode) return;
            state.layerMode = mode;
            if (!state.lastData) return;
            const { warnings } = _setSources(state, state.lastData.list, state.lastData.dateMode);
            state.warnings = warnings;
            _updateFooter(state);
        },
        applyFilter: (filter) => _applyFilter(state, filter),
        clearFilter: () => _applyFilter(state, null),
        setCursor: (ms, opts) => _setCursor(state, ms, opts),
        getCursor: () => state.cursor,
        loadData(data) {
            if (!data || typeof data !== 'object') throw new Error(t('app.tml.err.bad_data'));
            const { count, warnings } = _setSources(state, _dataToSources(data), 'ms');
            state.warnings = warnings;
            _updateFooter(state);
            return count;
        },
        listThemes: () => (state.css?.list() ?? []).map(({ name, active }) => ({ name, active })),
        setThemeActive(name, on) {
            if (!state.css?.setActive(String(name ?? ''), on)) throw new Error(t('app.tml.err.no_css', { name }));
        },
    });
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default {

    async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {
        _destroy(bodyEl);

        const { config, spec, sources, cssModels, warnings: configWarnings } = classifyModels(models);
        const view = spec.view && typeof spec.view === 'object' ? spec.view : {};

        bodyEl.style.position = bodyEl.style.position || 'relative';
        bodyEl.style.overflow = 'hidden';
        const root = document.createElement('div');
        root.className = 'tml-root';
        const canvas = document.createElement('div');
        canvas.className = 'tml-canvas';
        root.appendChild(canvas);
        bodyEl.appendChild(root);

        const state = {
            stopped: false,
            object, cmdUI, signal, panel, bodyEl,
            config, spec, view, sources, configWarnings,
            mod_id: config?.mod_id ?? null,
            layerConf: _layerConf(spec),
            layers: new Map(),
            layerMode: spec.layerMode === 'merge' ? 'merge' : 'stack',
            multi: false,
            lastData: null,
            mainCss: [],
            root, canvas,
            timeline: null, itemsDS: null, itemsView: null, groupsDS: null,
            items: new Map(), groups: new Map(), precision: new Map(),
            hasGroups: false,
            stack: view.stack !== false,
            filter: null, filterPass: new Set(),
            disabled: new Set(), disabledLanes: new Set(),   // corsie disattivate (doppio clic)
            cursor: null,
            era: ['auto', 'always', 'never'].includes(view.era) ? view.era : 'auto',
            showAD: false,
            viewMin: D.tryParseHistDate(view.min)?.ms ?? null,
            warnings: [],
            css: null,
            localEvents: new EventTarget(),   // sorgente dei nodi TML/Events/*
        };
        bodyEl[STATE_KEY] = state;
        signal?.addEventListener('abort', () => _destroy(bodyEl), { once: true });

        if (!sources.length) {
            _showMessage(state, t('app.tml.no_data.@'));
            return;
        }

        cmdUI?.show?.({ status: te('app.tml.status.loading') });

        // libreria, dati e CSS in parallelo; i CSS dei livelli si aggiungono a quelli principali
        let vis, loaded;
        const { entries: cssEntries, main: mainCss } = _cssEntries(cssModels, spec, state.layerConf);
        state.mainCss = mainCss;
        state.css = applyModelCss({ root, rootClass: 'tml-root', baseUrl: modelFolderUrl(config), files: cssEntries, signal });
        try {
            [vis, loaded] = await Promise.all([_ensureVis(), _fetchAll(state)]);
        } catch (e) {
            if (signal?.aborted) return;
            _showMessage(state, t('app.tml.err.unavailable', { msg: e.message }));
            cmdUI?.hide?.();
            return;
        }
        if (signal?.aborted) return;

        // ── opzioni ──────────────────────────────────────────────────────────
        const opt = (v) => D.tryParseHistDate(v);
        const start = opt(view.start), end = opt(view.end), min = opt(view.min), max = opt(view.max);
        const options = {
            moment:          (d) => vis.moment(d).utc(),
            orientation:     { axis: view.orientation === 'bottom' ? 'bottom' : 'top', item: 'top' },
            stack:           state.stack,
            showCurrentTime: false,
            selectable:      true,
            multiselect:     true,
            editable:        false,
            height:          '100%',
            verticalScroll:  true,
            margin:          { item: { horizontal: 6, vertical: 6 } },
            groupOrder:      (a, b) => (a.order ?? 0) - (b.order ?? 0),
            tooltip:         { followMouse: true, overflowMethod: 'cap', delay: 250 },
            format:          D.makeAxisFormat(() => ({ era: state.era, showAD: state.showAD })),
            // testi sempre come testo: template restituisce un elemento costruito con textContent
            template:        (item) => { const s = document.createElement('span'); s.textContent = item?.content ?? ''; return s; },
            groupTemplate:   (group) => { const s = document.createElement('span'); s.textContent = group?.content ?? ''; return s; },
            zoomMax:         D.parseDuration(view.zoomMax) ?? 20000 * YEAR_MS,
        };
        const zoomMin = D.parseDuration(view.zoomMin);
        if (zoomMin != null) options.zoomMin = zoomMin;
        if (start && end && end.ms > start.ms) { options.start = new Date(start.ms); options.end = new Date(end.ms); }
        if (min) options.min = new Date(min.ms);
        if (max) options.max = new Date(max.ms);

        state.itemsDS   = new vis.DataSet();
        state.groupsDS  = new vis.DataSet();
        // apertura/chiusura col clic (vis aggiorna showNested e visible nel DataSet): stato e visibilità
        state.groupsDS.on('update', (_e, props) => {
            if (state.stopped) return;
            const reclose = [];
            for (const d of props?.data ?? []) {
                const g = d && state.groups.get(d.id);
                if (!g || d.showNested == null) continue;
                if (d.showNested !== false && state.disabled.has(g.id)) reclose.push({ id: g.id, showNested: false });
                else g.open = d.showNested !== false;
            }
            if (reclose.length) { state.groupsDS.update(reclose); return; }   // corsia disattivata: non si apre
            _syncGroupVisibility(state);
        });
        state.itemsView = new vis.DataView(state.itemsDS, {
            filter: (it) => _layerVisible(state, it._layer) && !state.disabledLanes.has(it.group) &&
                (state.filter?.mode !== 'hide' || state.filterPass.has(it.id)),
        });
        try {
            state.timeline = new vis.Timeline(canvas, state.itemsView, options);
        } catch (e) {
            _showMessage(state, t('app.tml.err.vis', { msg: e.message }));
            return;
        }

        const { warnings } = _setSources(state, loaded.list, 'file');
        if (!options.start) state.timeline.fit({ animation: false });
        _attachApi(state);

        // ── eventi della timeline ───────────────────────────────────────────
        // doppio clic sull'etichetta di una corsia: attiva / disattiva
        state.timeline.on('doubleClick', (p) => {
            if (state.stopped || p?.what !== 'group-label' || p.group == null) return;
            const id = String(p.group);
            if (id === NO_GROUP || id.startsWith(`${NO_GROUP}:`)) return;
            _setGroupEnabled(state, id, state.disabled.has(id));
        });
        state.timeline.on('select', ({ items }) => {
            if (state.stopped || !items?.length) return;
            _emitSelection(state, String(items[0]), true);
        });
        state.timeline.on('rangechanged', ({ start: s, end: e, byUser }) => {
            if (state.stopped) return;
            const detail = { start: +s, end: +e, byUser: !!byUser };
            state.localEvents.dispatchEvent(new CustomEvent('rangechanged', { detail }));
            _busEmit(state, 'tml:range:changed', detail);
            if (state.cursor != null) state.timeline.setCustomTimeMarker(_cursorLabel(state, state.cursor), CURSOR_ID, false);
            _updateFooter(state);
        });
        state.timeline.on('timechange', ({ id, time }) => {
            if (id !== CURSOR_ID || state.stopped) return;
            state.timeline.setCustomTimeMarker(_cursorLabel(state, +time), CURSOR_ID, false);
        });
        state.timeline.on('timechanged', ({ id, time }) => {
            if (id !== CURSOR_ID || state.stopped) return;
            _setCursor(state, +time, { emit: true, byUser: true });
        });

        const cur = opt(view.cursor);
        if (cur) _setCursor(state, cur.ms, { emit: false });

        const css = await state.css.ready;
        if (signal?.aborted) return;
        _syncLayerCss(state);
        state.warnings = [...state.configWarnings, ...loaded.warnings, ...warnings, ...css.errors];
        _updateFooter(state, { show: true });

        // ── bus: solo data:refresh; le reazioni fra pannelli si fanno con un flow ──
        appBusOn('data:refresh', (msg) => {
            if (!_shouldHandleMsg(msg, object) || state.stopped) return;
            _reloadAll(state).catch(e => state.cmdUI?.show?.({ status: te('app.tml.err.reload', { msg: e.message }) }));
        }, signal);

        await tmlLoadFlows(state, object, signal);
    },

    getToolbar({ bodyEl }) {
        const st = () => { const s = bodyEl?.[STATE_KEY]; return s?.timeline ? s : null; };
        return {
            items: [
                { type: 'button', id: 'btnTmlZoomIn',  iconClass: 'bi bi-zoom-in',  className: 'icon-only', title: t('app.tml.tb.zoom_in'), attrs: { 'aria-label': t('app.tml.tb.zoom_in') },
                  onClick: () => st()?.timeline.zoomIn(0.5) },
                { type: 'button', id: 'btnTmlZoomOut', iconClass: 'bi bi-zoom-out', className: 'icon-only', title: t('app.tml.tb.zoom_out'), attrs: { 'aria-label': t('app.tml.tb.zoom_out') },
                  onClick: () => st()?.timeline.zoomOut(0.5) },
                { type: 'button', id: 'btnTmlFit',     iconClass: 'bi bi-arrows-expand-vertical', className: 'icon-only', title: t('app.tml.fit_all'), attrs: { 'aria-label': t('app.tml.fit_all') },
                  onClick: () => st()?.timeline.fit() },
                { type: 'divider' },
                { type: 'button', id: 'btnTmlCursor',  iconClass: 'bi bi-vr', className: 'icon-only', title: t('app.tml.tb.cursor'), attrs: { 'aria-label': t('app.tml.tb.cursor') },
                  onClick: () => {
                      const s = st(); if (!s) return;
                      if (s.cursor != null) { _setCursor(s, null); return; }
                      const w = s.timeline.getWindow();
                      _setCursor(s, (+w.start + +w.end) / 2, { emit: true, byUser: true });
                  } },
            ],
        };
    },

    getLeftMenu({ bodyEl }) {
        const s = bodyEl?.[STATE_KEY];
        const groups = s?.timeline ? [...s.groups.values()].filter(g => !_isLaneOrRoot(g.id)) : [];
        const groupItems = groups.map(g => ({
            id: `tml-group-${g.id}`,
            label: _stacked(s) && g.layer ? `${s.layers.get(g.layer)?.label ?? g.layer} › ${g.content}` : g.content,
            getValue: () => (g.visible ? t('app.tml.menu.visible') : t('app.tml.menu.hidden')),
            onClick: () => { try { s.setGroupVisible(g.id, !g.visible); } catch { /* noop */ } },
        }));
        if (!s?.multi) return { header: groups.length ? t('app.tml.menu.groups') : undefined, items: groupItems };
        const layerItems = [...s.layers.values()].map(l => ({
            id: `tml-layer-${l.id}`,
            label: `${l.label} (${l.count})`,
            // s.layers si ricostruisce a ogni caricamento: lo stato si rilegge per id
            getValue: () => (s.layers.get(l.id)?.visible !== false ? t('app.tml.menu.visible') : t('app.tml.menu.hidden')),
            onClick: () => { try { s.setLayerVisible(l.id, s.layers.get(l.id)?.visible === false); } catch { /* noop */ } },
        }));
        return {
            header: t('app.tml.menu.layers'),
            items: groupItems.length ? [...layerItems, { type: 'divider' }, ...groupItems] : layerItems,
        };
    },

    getRightMenu({ bodyEl }) {
        const s = bodyEl?.[STATE_KEY];
        if (!s?.timeline) return { items: [] };
        const setNested = (open) => {
            s.groupsDS.update([...s.groups.values()].filter(g => g.nested.length).map(g => { g.open = open; return { id: g.id, showNested: open }; }));
        };
        const items = [
            { id: 'tml-fit', label: t('app.tml.fit_all'), onClick: () => s.timeline.fit() },
            { id: 'tml-stack', label: t('app.tml.menu.stack'), getValue: () => (s.stack ? t('common.yes') : t('common.no')),
              onClick: () => { s.stack = !s.stack; s.timeline.setOptions({ stack: s.stack }); } },
            { id: 'tml-open',  label: t('app.tml.menu.open_groups'),  onClick: () => setNested(true) },
            { id: 'tml-close', label: t('app.tml.menu.close_groups'), onClick: () => setNested(false) },
            { id: 'tml-nofilter', label: t('app.tml.menu.clear_filter'), getValue: () => (s.filter ? t('app.tml.menu.active') : t('common.none')),
              onClick: () => { if (s.filter) s.clearFilter(); } },
        ];
        if (s.multi) {
            items.push({ id: 'tml-layermode', label: t('app.tml.menu.layers'), getValue: () => (s.layerMode === 'merge' ? t('app.tml.menu.merged') : t('app.tml.menu.stacked')),
              onClick: () => { try { s.setLayerMode(s.layerMode === 'merge' ? 'stack' : 'merge'); } catch { /* noop */ } } });
        }
        const cssList = s.css?.list() ?? [];
        if (cssList.length) {
            items.push({ type: 'divider' });
            items.push({ id: 'tml-css-reload', label: t('app.tml.menu.reload_css'), onClick: () => {
                s.css.reload().then(r => { s.warnings = r.errors; _updateFooter(s, { show: true }); });
            } });
            for (const c of cssList) {
                items.push({
                    id: `tml-css-${c.name}`,
                    label: c.name,
                    getValue: () => { const e = s.css.list().find(x => x.name === c.name); return !e?.ok ? t('common.error') : (e.active ? t('app.tml.menu.active') : t('app.tml.menu.off')); },
                    onClick: () => { const e = s.css.list().find(x => x.name === c.name); s.css.setActive(c.name, !e?.active); },
                });
            }
        }
        return { items };
    },

    destroy() { /* cleanup su AbortSignal */ },
};
