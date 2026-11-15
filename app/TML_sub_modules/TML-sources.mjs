// app/TML_sub_modules/TML-sources.mjs
// Sorgenti dei dati di una timeline TML: file JSON del modello e fogli Google Sheets.
// Progetto: _doc/module-tml-timeline.md §3.3 (fogli) e §3.5 (livelli).
//
// Ogni modello dell'oggetto è una sorgente:
//   - file JSON (mod_abs_url *.json)      → { groups, items } così come sono nel file
//   - foglio (mod_spec.spreadsheetId)     → righe da api/gsh_data.php (stesso proxy di GSH),
//                                           convertite secondo mod_spec.role
// Il risultato è sempre { groups, items } nel formato del file (date come stringhe §2):
// la normalizzazione e i livelli li fa model_TML.mjs.

import { t } from '../shared/i18n.mjs';

export const GSH_API = 'api/gsh_data.php';
export const DEFAULT_LAYER = 'base';
const ROLES = new Set(['items', 'groups', 'eras']);

/** Nome per le classi CSS e per i livelli: minuscole, [a-z0-9-]. */
export function tmlSlug(s) {
    return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseSpec(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return {}; }
}

const _isJsonFile = (m) => /\.json$/i.test(String(m?.mod_filename || m?.mod_abs_url || '').split('?')[0]);
export const isCssFile = (m) => /\.css$/i.test(String(m?.mod_filename || '').split('?')[0]);

/** Chiavi che rendono un mod_spec "di configurazione" (§3). */
const CONFIG_KEYS = ['view', 'layers', 'layerMode', 'css', 'cssText'];
const _isConfig = (spec) => CONFIG_KEYS.some(k => spec[k] != null);
const _byModId = (a, b) => (Number(a.model.mod_id) || 0) - (Number(b.model.mod_id) || 0);

/**
 * Modelli dell'oggetto → modello di configurazione e sorgenti.
 * Configurazione = il modello il cui mod_spec contiene view/layers/layerMode/css/cssText, scelto per
 * contenuto: l'ordine dei modelli (mod_id DESC dal backend) non conta. Se sono più d'uno vale il più
 * vecchio (mod_id più basso), con avviso; se non ce n'è nessuno, il primo modello-file .css (per la
 * cartella dei CSS). I modelli il cui file è un .css (cssModels) si applicano sempre, dal più vecchio.
 * @returns {{ config: object|null, spec: object, sources: Array<{ kind, model, spec, role, layer, name }>,
 *             cssModels: object[], warnings: string[] }}
 */
export function classifyModels(models) {
    const arr = Array.isArray(models) ? models.filter(Boolean) : [];
    const sources = [];
    const configs = [], cssModels = [];
    for (const [i, m] of arr.entries()) {
        const spec = parseSpec(m.mod_spec);
        const name = m.mod_name || m.mod_title || spec.sheetName || t('app.tml.src.model_n.@', { n: i + 1 });
        const layer = tmlSlug(spec.layer) || null;
        if (_isConfig(spec)) configs.push({ model: m, spec, name });
        if (isCssFile(m) && m.mod_abs_url) cssModels.push({ model: m });
        if (spec.spreadsheetId) {
            sources.push({ kind: 'sheet', model: m, spec, role: ROLES.has(spec.role) ? spec.role : 'items', layer, name });
        } else if (m.mod_abs_url && _isJsonFile(m)) {
            sources.push({ kind: 'json', model: m, spec, role: 'all', layer, name });
        }
    }
    configs.sort(_byModId);
    cssModels.sort(_byModId);
    const warnings = configs.length > 1
        ? [t('app.tml.src.warn_many_configs', { name: configs[0].name, others: configs.slice(1).map(c => c.name).join(', ') })]
        : [];
    return {
        config: configs[0]?.model ?? cssModels[0]?.model ?? null,
        spec: configs[0]?.spec ?? {},
        sources,
        cssModels: cssModels.map(c => c.model),
        warnings,
    };
}

// ── Lettura ─────────────────────────────────────────────────────────────────────

async function _fetchJson(src, signal) {
    const res = await fetch(src.model.mod_abs_url, { cache: 'no-cache', credentials: 'same-origin', signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error(t('app.tml.src.err_file_shape'));
    return { groups: Array.isArray(json.groups) ? json.groups : [], items: Array.isArray(json.items) ? json.items : [], warnings: [] };
}

async function _fetchRows(src, signal) {
    const res = await fetch(GSH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'fetch', mod_id: src.model.mod_id }),
        signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) throw new Error(json?.message || `HTTP ${res.status}`);
    const rows = json.data?.rows ?? [];
    return Array.isArray(rows) ? rows : [];
}

/**
 * Legge una sorgente.
 * @returns {Promise<{ groups: any[], items: any[], warnings: string[] }>}
 * @throws Error se la sorgente non si legge
 */
export async function fetchSource(src, signal) {
    if (src.kind === 'json') return _fetchJson(src, signal);
    const rows = await _fetchRows(src, signal);
    const label = t('app.tml.src.sheet_label', { name: src.name });
    if (src.role === 'groups') return { items: [], ...rowsToGroups(rows, src.spec.mapping, label) };
    return { groups: [], ...rowsToItems(rows, src.spec.mapping, label, src.role === 'eras' ? 'background' : null) };
}

// ── Righe di un foglio → item / gruppi ────────────────────────────────────────

/** Intestazione normalizzata: minuscole, senza accenti, spazi e trattini → _. */
const _key = (h) => String(h ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_');

const ITEM_COLS = {
    id: ['id'], type: ['tipo', 'type'], start: ['inizio', 'start'], end: ['fine', 'end'],
    content: ['etichetta', 'content'], title: ['nota', 'title'], group: ['gruppo', 'group'],
    class: ['classi', 'classe', 'class'], tags: ['tag', 'tags'], objId: ['obj_id', 'objid'],
};
const GROUP_COLS = {
    id: ['id'], content: ['etichetta', 'content'], title: ['nota', 'title'], parent: ['padre', 'parent'],
    order: ['ordine', 'order'], open: ['aperto', 'open'], visible: ['visibile', 'visible'],
    class: ['classi', 'classe', 'class'],
};
const TYPE_ALIASES = { punto: 'point', evento: 'box', periodo: 'range', intervallo: 'range', epoca: 'background', sfondo: 'background' };
const TRUE_VALUES  = new Set(['si', 'sì', 'yes', 'true', '1', 'x', 'vero']);
const FALSE_VALUES = new Set(['no', 'false', '0', 'falso']);

/** Campo → intestazione originale del foglio (mapping del mod_spec prima degli alias). */
function _columns(rows, cols, mapping) {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const byKey = new Map(headers.map(h => [_key(h), h]));
    const out = {};
    for (const [field, aliases] of Object.entries(cols)) {
        const mapped = mapping && typeof mapping === 'object' ? mapping[field] : null;
        if (mapped != null && byKey.has(_key(mapped))) { out[field] = byKey.get(_key(mapped)); continue; }
        const h = aliases.map(a => byKey.get(a)).find(Boolean);
        if (h) out[field] = h;
    }
    return out;
}

const _cell = (row, h) => (h == null ? '' : String(row[h] ?? '').trim());
const _list = (v) => String(v ?? '').split('|').map(x => x.trim()).filter(Boolean);
const _bool = (v) => {
    const k = String(v ?? '').trim().toLowerCase();
    if (TRUE_VALUES.has(k)) return true;
    if (FALSE_VALUES.has(k)) return false;
    return undefined;
};
const _isEmptyRow = (row) => Object.values(row).every(v => String(v ?? '').trim() === '');

/**
 * Righe di un foglio item/epoche → item nel formato del file.
 * @param {string|null} forceType  'background' per il foglio delle epoche
 */
export function rowsToItems(rows, mapping, label, forceType = null) {
    const warnings = [];
    const items = [];
    const col = _columns(rows, ITEM_COLS, mapping);
    if (rows.length && !col.start) warnings.push(t('app.tml.src.warn_no_start_col', { label }));
    const known = new Set(Object.values(col));
    rows.forEach((row, i) => {
        if (_isEmptyRow(row)) return;
        const id = _cell(row, col.id);
        if (!id) { warnings.push(t('app.tml.src.warn_row_no_id', { label, row: i + 2 })); return; }
        const typeRaw = _cell(row, col.type).toLowerCase();
        const it = {
            id,
            start:   _cell(row, col.start),
            content: _cell(row, col.content),
        };
        const type = forceType ?? (TYPE_ALIASES[typeRaw] ?? typeRaw);
        if (type) it.type = type;
        const end = _cell(row, col.end);       if (end) it.end = end;
        const title = _cell(row, col.title);   if (title) it.title = title;
        const group = _cell(row, col.group);   if (group) it.group = group;
        const cls = _list(_cell(row, col.class)); if (cls.length) it.class = cls;
        const tags = _list(_cell(row, col.tags)); if (tags.length) it.tags = tags;
        const objId = Number(_cell(row, col.objId));
        if (Number.isInteger(objId) && objId > 0) it.link = { objId };
        const data = {};
        for (const [h, v] of Object.entries(row)) {
            if (known.has(h) || !String(h).trim()) continue;
            const s = String(v ?? '').trim();
            if (s !== '') data[h] = s;
        }
        if (Object.keys(data).length) it.data = data;
        items.push(it);
    });
    return { items, warnings };
}

/** Righe del foglio dei gruppi → gruppi nel formato del file (padre → nested). */
export function rowsToGroups(rows, mapping, label) {
    const warnings = [];
    const groups = [];
    const col = _columns(rows, GROUP_COLS, mapping);
    const parents = [];
    rows.forEach((row, i) => {
        if (_isEmptyRow(row)) return;
        const id = _cell(row, col.id);
        if (!id) { warnings.push(t('app.tml.src.warn_row_no_id', { label, row: i + 2 })); return; }
        const g = { id, content: _cell(row, col.content) || id, nested: [] };
        const title = _cell(row, col.title); if (title) g.title = title;
        const cls = _list(_cell(row, col.class)); if (cls.length) g.class = cls;
        const order = _cell(row, col.order); if (order !== '' && Number.isFinite(Number(order))) g.order = Number(order);
        const open = _bool(_cell(row, col.open)); if (open !== undefined) g.open = open;
        const visible = _bool(_cell(row, col.visible)); if (visible !== undefined) g.visible = visible;
        const parent = _cell(row, col.parent);
        if (parent) parents.push([id, parent, i + 2]);
        groups.push(g);
    });
    const byId = new Map(groups.map(g => [g.id, g]));
    for (const [id, parent, rowNum] of parents) {
        const p = byId.get(parent);
        if (!p) { warnings.push(t('app.tml.src.warn_parent_missing', { label, row: rowNum, parent })); continue; }
        if (parent === id) { warnings.push(t('app.tml.src.warn_parent_self', { label, row: rowNum })); continue; }
        p.nested.push(id);
    }
    return { groups, warnings };
}
