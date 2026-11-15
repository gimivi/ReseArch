// app/dashboard_cfg.mjs
// Gestisce la modale #modalDashboardCfg (configurazioni pannelli dashboard).
//
// Esporta:
//   initDashboardCfg()
//   restoreConfig(dshpId)  — ripristina una config nel dashboard
//   loadDefaultConfig()    — carica la Config predefinita del WP all'apertura (tutti gli utenti)
//   getCurrentDshp()       — { dshpId, dshpName } della Config caricata, o null
//
// Config caricata (2026-10-04, _doc/arch-flow-dashboard.md §3.1): si imposta solo
// quando una Config viene applicata (Applica, predefinita all'apertura), resta
// valida se poi si spostano o aggiungono pannelli. A ogni cambio dispatcha su
// window CustomEvent 'dcfg:loaded' { dshpId, dshpName } (dshpId null = nessuna):
// lo ascolta il runtime dei flow dashboard, che esegue i flow collegati a lei.
//
// Diritti (2026-10-13, _doc/arch-permessi.md §11.7.1): la modale è per tutti. Chi non
// modifica vede, carica e (se crea nel WP) copia; il server manda can_edit / can_copy per
// riga e can_create / can_set_default (azione rights). Copia da altri WP: "Importa".

import { serialize, deserialize } from '../ui/dashboard_windows.mjs';
import { t, te } from './shared/i18n.mjs';
import { pageLevel } from "./shared/ui_level.mjs";

const EP     = 'api/wp_dashboard_cfg_tool.php';
const EP_OBJ = 'ui/modal_tree_obj_tools.php';

async function _get(params) {
    const res = await fetch(`${EP}?${new URLSearchParams(params)}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}
async function _post(body) {
    const res = await fetch(EP, {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify(body),
    });
    // FIX (2026-09-21, segnalato dall'utente — "salvataggio con nome troppo
    // lungo va in errore generico 500"): prima si buttava via il body della
    // risposta su !res.ok, mostrando solo "HTTP 500" — il server (wp_dashboard_
    // cfg_tool.php) risponde SEMPRE con un JSON {ok:false, error:"..."} anche
    // sugli errori, messaggio reale incluso (es. "dshp_name supera 30
    // caratteri"), ma non arrivava mai all'utente. Ora si legge il body anche
    // in caso di errore HTTP, e si usa error/message se presente.
    let data = null;
    try { data = await res.json(); } catch { /* risposta non-JSON, es. 502 da un proxy */ }
    if (!res.ok) {
        throw new Error(data?.error || data?.message || t('errors.server_status', { status: res.status }));
    }
    return data ?? { ok: false, error: t('app.dcfg.empty_response') };
}

// Visibilità della configurazione (dshp_show, scala unica 0-4, _doc/arch-permessi.md §11.7):
// chi la vede e la carica. Il massimo (max_show) arriva dal server: res_show e wp_show.
const _VIS_KEYS = ['visibility.author.@', 'visibility.workgroup', 'visibility.research.@', 'visibility.dissemination', 'visibility.public', 'visibility.guests'];
const _visLabel = (v) => t(_VIS_KEYS[Number(v)] ?? _VIS_KEYS[1]);
// Copia (dshp_share 0-3): stesse etichette dello share dei flow (ui/modal_flows.js)
const _shareValues = () => _VIS_KEYS.slice(0, 4).map((k, v) => ({ label: t(k), value: v }));

/** Avviso della regola 2 del §11.7: contenuti con show più basso della configurazione. */
function _showWarnings(warnings) {
    if (!Array.isArray(warnings) || !warnings.length) return;
    const list = warnings
        .map(w => t(`app.dcfg.warn.item.${w.type}`, { id: w.id, name: w.name, show: _visLabel(w.show) }))
        .join('\n');
    alert(t('app.dcfg.warn.low_show', { list }));
}

// Limiti colonna DB (sql/migration_dashboard_cfg.sql) — replicati qui per
// validare PRIMA di inviare, invece di scoprirlo dall'errore del server.
const NAME_MAX = 30;
const DESC_MAX = 255;

/**
 * Chiede un valore con window.prompt(), segnalando il limite di caratteri nel
 * messaggio e ri-chiedendo (senza perdere quanto scritto) finché non rientra
 * nel limite o l'utente annulla. Ritorna null se annullato.
 */
function _promptWithLimit(message, defaultValue, maxLen) {
    let value = defaultValue;
    for (;;) {
        const input = prompt(t('app.dcfg.prompt_limit', { message, max: maxLen }), value);
        if (input === null) return null;   // annullato
        const trimmed = input.trim();
        if (trimmed.length <= maxLen) return trimmed;
        alert(t('app.dcfg.too_long', { len: trimmed.length, max: maxLen }));
        value = trimmed;   // ripropone il testo scritto, non lo perde
    }
}

// ============================================================
// Stato modulo
// ============================================================

let _table       = null;
let _selectedRow = null;
let _current     = null;   // { dshpId, dshpName } — Config caricata nella dashboard
let _rights      = { can_create: false, can_set_default: false, max_show: 1 };   // azione rights

/** Config caricata nella dashboard, o null. */
export function getCurrentDshp() {
    return _current ? { ..._current } : null;
}

/** Imposta la Config caricata: indicatore nel footer, evento, evidenza in tabella. */
function _setCurrent(dshpId, dshpName) {
    _current = dshpId ? { dshpId: Number(dshpId), dshpName: dshpName ?? '' } : null;

    const ind  = document.getElementById('dcfg-current');
    const name = document.getElementById('dcfg-current-name');
    if (ind && name) {
        name.textContent = _current ? _current.dshpName : '';
        ind.hidden = !_current;
    }
    _table?.redraw(true);   // rowFormatter rimette l'evidenza sulla riga in uso

    window.dispatchEvent(new CustomEvent('dcfg:loaded', {
        detail: { dshpId: _current?.dshpId ?? null, dshpName: _current?.dshpName ?? '' },
    }));
}

/**
 * Carica la Config predefinita del WP (workpackages.wp_default_dshp_id, arrivata
 * con la globale `workpackage` di dashboard.php). Chiamata una volta all'apertura
 * della dashboard, per TUTTI gli utenti (non dipende dalla modale, riservata a chi
 * può modificare). Senza predefinita dispatcha comunque 'dcfg:loaded' con null,
 * così il runtime sa che non c'è nessuna Config da eseguire.
 */
export async function loadDefaultConfig() {
    // La predefinita si chiede al server, che la restituisce solo a chi la può vedere
    // (dshp_show, regola 4 del §11.7); se manca o non è visibile si parte senza Config.
    let id = 0;
    try {
        const res = await _get({ action: 'get_default' });
        if (res.ok) id = Number(res.data?.dshp_id) || 0;
    } catch (_) { /* nessuna predefinita */ }
    if (id > 0) {
        await restoreConfig(id);
        if (_current?.dshpId === id) return;
    }
    _setCurrent(null);
}

// ============================================================
// INIT
// ============================================================

export function initDashboardCfg() {
    const modalEl = document.getElementById('modalDashboardCfg');
    if (!modalEl) return;

    modalEl.addEventListener('shown.bs.modal',  _onShown);
    modalEl.addEventListener('hidden.bs.modal', _onHidden);

    _bind('dcfg-btn-new',       'click', _onNew);
    _bind('dcfg-btn-overwrite', 'click', _onOverwrite);
    _bind('dcfg-btn-dup',    'click', _onDuplicate);
    _bind('dcfg-btn-del',    'click', _onDelete);
    _bind('dcfg-btn-thumb',  'click', _onUpdateThumb);
    _bind('dcfg-btn-link',   'click', _onLink);
    _bind('dcfg-btn-apply',  'click', _onApply);
    _bind('dcfg-btn-import', 'click', _onImportToggle);
    _bind('dcfg-import-scope', 'change', _refreshImport);
}

// ============================================================
// LIFECYCLE
// ============================================================

async function _onShown() {
    try {
        const r = await _get({ action: 'rights' });
        if (r.ok) _rights = { ..._rights, ...r.data };
    } catch (_) { /* restano i diritti minimi: sola lettura */ }
    _applyRights();
    await _refreshTable();
}

function _onHidden() {
    // Nascondi preview e pannello di importazione
    const prev = document.getElementById('dcfg-preview');
    if (prev) prev.hidden = true;
    const imp = document.getElementById('dcfg-import');
    if (imp) imp.hidden = true;
    _el('dcfg-btn-import')?.setAttribute('aria-expanded', 'false');
}

/**
 * Pulsanti che dipendono dal ruolo nel WP, non dalla riga. Chi non crea configurazioni
 * non ne è autore, quindi non modifica nulla: per lui la modale serve solo a caricare.
 */
function _applyRights() {
    const canCreate = !!_rights.can_create;
    const readOnly  = !canCreate && !_rights.can_set_default;
    for (const id of ['dcfg-btn-new', 'dcfg-btn-import']) {
        const b = _el(id);
        if (b) b.hidden = !canCreate;
    }
    for (const id of ['dcfg-btn-overwrite', 'dcfg-btn-dup', 'dcfg-btn-del', 'dcfg-btn-thumb', 'dcfg-btn-link']) {
        const b = _el(id);
        if (b) b.hidden = readOnly;
    }
    const note = _el('dcfg-readonly-note');
    if (note) note.hidden = !readOnly;
}

// ============================================================
// TABULATOR
// ============================================================

async function _refreshTable() {
    const tableEl = document.getElementById('dcfg-table');
    if (!tableEl || typeof Tabulator === 'undefined') return;

    let data = [];
    try {
        const res = await _get({ action: 'list' });
        if (res.ok) data = res.data ?? [];
    } catch (_) {}
    _rowCount = data.length;   // per il suggerimento "seleziona una configurazione"

    if (_table) {
        _selectedRow = null;
        _table.replaceData(data);
        _updateButtons(null);
        return;
    }

    _table = new Tabulator(tableEl, {
        data,
        layout:      'fitColumns',
        height:      '55vh',
        selectable:  false,
        placeholder: `<span style="color:#9ca3af;font-size:.8rem">${te('app.dcfg.table.empty')}</span>`,
        // Riga della Config caricata nella dashboard (vedi _setCurrent)
        rowFormatter: row => {
            row.getElement().classList.toggle('dcfg-row-current', row.getData().dshp_id === _current?.dshpId);
        },
        columns: [
            {
                // Config predefinita del WP: caricata all'apertura della dashboard,
                // i suoi flow girano per tutti (_doc/arch-flow-dashboard.md §3.2).
                // Una sola per WP: cliccare la stella la sposta qui, o la toglie.
                title: `<i class="bi bi-star-fill" role="img" aria-label="${te('app.dcfg.col.default')}"></i>`, field: 'is_default', width: 44,
                hozAlign: 'center', headerSort: false,
                headerTooltip: t('app.dcfg.col.default_tooltip.@'),
                formatter: cell => {
                    if (!_rights.can_set_default) {
                        return cell.getValue()
                            ? `<i class="bi bi-star-fill text-warning" role="img" title="${te('app.dcfg.col.default')}" aria-label="${te('app.dcfg.col.default')}"></i>`
                            : '';
                    }
                    return cell.getValue()
                        ? `<i class="bi bi-star-fill text-warning" role="img" title="${te('app.dcfg.default.is_default')}" aria-label="${te('app.dcfg.default.is_default')}"></i>`
                        : `<i class="bi bi-star text-secondary" role="img" title="${te('app.dcfg.default.make')}" aria-label="${te('app.dcfg.default.make')}"></i>`;
                },
                cellClick: async (_e, cell) => {
                    if (!_rights.can_set_default) return;   // la predefinita la scelgono X, P, W
                    const d = cell.getRow().getData();
                    const makeDefault = !d.is_default;
                    if (makeDefault && !confirm(t('app.dcfg.default.confirm.@', { name: d.dshp_name }))) return;
                    try {
                        const res = await _post({ action: 'set_default', dshp_id: makeDefault ? d.dshp_id : null });
                        if (!res.ok) throw new Error(res.error);
                        if (typeof workpackage !== 'undefined' && workpackage) {
                            workpackage.wp_default_dshp_id = res.data?.dshp_id ?? null;
                        }
                        await _refreshTable();
                    } catch (err) {
                        alert(t('app.dcfg.err.set_default', { error: err.message }));
                    }
                },
            },
            { title: t('common.id'), field: 'dshp_id', width: 50, hozAlign: 'right' },
            {
                title: t('common.name'), field: 'dshp_name', minWidth: 130,
                editor: 'input',
                editable: _canEditCell,
                // maxlength nativo dell'<input>: il browser impedisce di
                // digitare oltre il limite, invece di scoprirlo dall'errore
                // del server dopo l'invio (stesso limite di NAME_MAX/schema DB).
                editorParams: { elementAttributes: { maxlength: String(NAME_MAX) } },
                cellEdited: async cell => {
                    const d = cell.getRow().getData();
                    if (!d.dshp_id) return;
                    try {
                        await _post({ action: 'update', dshp_id: d.dshp_id, dshp_name: d.dshp_name });
                        // Rinominata la Config in uso: aggiorna il nome nel footer
                        if (_current?.dshpId === d.dshp_id) {
                            _current.dshpName = d.dshp_name;
                            const n = document.getElementById('dcfg-current-name');
                            if (n) n.textContent = d.dshp_name;
                        }
                    } catch (err) {
                        alert(t('app.dcfg.err.save_name', { error: err.message }));
                        cell.restoreOldValue();
                    }
                },
            },
            {
                title: t('common.description'), field: 'dshp_description', minWidth: 200,
                editor: 'input',
                editable: _canEditCell,
                editorParams: { elementAttributes: { maxlength: String(DESC_MAX) } },
                cellEdited: async cell => {
                    const d = cell.getRow().getData();
                    if (!d.dshp_id) return;
                    try {
                        await _post({ action: 'update', dshp_id: d.dshp_id, dshp_description: d.dshp_description });
                    } catch (err) {
                        alert(t('app.dcfg.err.save_desc', { error: err.message }));
                        cell.restoreOldValue();
                    }
                },
            },
            {
                // Chi vede e carica la configurazione: non oltre ricerca e WP (max_show dal server)
                title: t('app.dcfg.col.show'), field: 'dshp_show', width: 130,
                headerTooltip: t('app.dcfg.col.show_tooltip.@'),
                formatter: cell => _visLabel(cell.getValue()),
                editor: 'list',
                editable: _canEditCell,
                editorParams: cell => {
                    const max = Number(cell.getRow().getData().max_show ?? 4);
                    return { values: _VIS_KEYS.slice(0, max + 1).map((_k, v) => ({ label: _visLabel(v), value: v })) };
                },
                cellEdited: async cell => {
                    const d = cell.getRow().getData();
                    if (!d.dshp_id) return;
                    try {
                        const res = await _post({ action: 'update', dshp_id: d.dshp_id, dshp_show: Number(d.dshp_show) });
                        if (!res.ok) throw new Error(res.error);
                        _showWarnings(res.data?.warnings);
                    } catch (err) {
                        alert(t('app.dcfg.err.save_show', { error: err.message }));
                        cell.restoreOldValue();
                    }
                },
            },
            {
                // Chi può copiarla (dshp_share 0-3, §11.7.1): 0 nessuno salvo chi la modifica,
                // 1 nel WP, 2 negli altri WP della ricerca, 3 in qualunque ricerca
                title: t('app.dcfg.col.share'), field: 'dshp_share', width: 130,
                headerTooltip: t('app.dcfg.col.share_tooltip.@'),
                formatter: cell => t(_VIS_KEYS[Number(cell.getValue())] ?? _VIS_KEYS[1]),
                editor: 'list',
                editable: _canEditCell,
                editorParams: { values: _shareValues() },
                cellEdited: async cell => {
                    const d = cell.getRow().getData();
                    if (!d.dshp_id) return;
                    try {
                        const res = await _post({ action: 'update', dshp_id: d.dshp_id, dshp_share: Number(d.dshp_share) });
                        if (!res.ok) throw new Error(res.error);
                    } catch (err) {
                        alert(t('app.dcfg.err.save_share', { error: err.message }));
                        cell.restoreOldValue();
                    }
                },
            },
            {
                // Flow dashboard collegati: girano quando la Config è caricata
                title: t('app.dcfg.col.flows'), field: 'flow_count', width: 60, hozAlign: 'right',
                headerTooltip: t('app.dcfg.col.flows_tooltip'),
                formatter: cell => cell.getValue() ? String(cell.getValue()) : '<span class="text-secondary">—</span>',
            },
            {
                title: t('app.dcfg.col.thumb'), field: 'has_ico', width: 60, hozAlign: 'center', headerSort: false,
                formatter: cell => cell.getValue()
                    ? `<i class="bi bi-image text-info" role="img" title="${te('app.dcfg.thumb.present')}" aria-label="${te('app.dcfg.thumb.present')}"></i>`
                    : '<span class="text-secondary">—</span>',
            },
            {
                title: t('app.dcfg.col.updated'), field: 'updated_at', width: 145,
                formatter: cell => (cell.getValue() ?? '').slice(0, 16),
            },
        ],
    });

    // Listener DOM diretto — aggiunto una volta sola. In fase di CATTURA (2026-10-15): sulle
    // colonne modificabili (nome, descrizione, visibilità, copia) Tabulator ferma il clic
    // (e.stopPropagation() in Edit.edit, anche quando la cella non è modificabile), quindi in
    // fase di bolla la riga si selezionava solo cliccando le colonne senza editor (id, stella).
    if (!tableEl._dcfgListenerBound) {
        tableEl._dcfgListenerBound = true;
        tableEl.addEventListener('click', async (e) => {
            const rowEl = e.target.closest('.tabulator-row');
            if (!rowEl) return;
            const row = _table.getRows().find(r => r.getElement() === rowEl);
            if (!row) return;
            if (_selectedRow) _selectedRow.getElement()?.classList.remove('dcfg-row-sel');
            _selectedRow = row;
            rowEl.classList.add('dcfg-row-sel');
            _updateButtons(row.getData());
            await _showPreview(row.getData());
        }, true);
    }

    _updateButtons(null);
}

/** Celle modificabili solo sulle righe che l'utente modifica (can_edit dal server). */
function _canEditCell(cell) {
    return !!cell.getRow().getData().can_edit;
}

// Pulsanti che agiscono sulla riga selezionata: senza selezione il suggerimento dice di sceglierne una
const _ROW_BUTTONS = ['dcfg-btn-apply', 'dcfg-btn-dup', 'dcfg-btn-overwrite'];
let _rowCount = 0;

function _updateButtons(row) {
    const has  = !!row;
    const edit = has && !!row.can_edit;
    for (const id of _ROW_BUTTONS) {
        const b = _el(id);
        if (!b) continue;
        b.dataset.hint ??= b.title;   // testo originale, dal markup
        b.title = has ? b.dataset.hint : t('app.dcfg.select_row');
    }
    const hint = _el('dcfg-select-hint');
    if (hint) hint.hidden = has || _rowCount === 0;
    _el('dcfg-btn-overwrite').disabled = !edit;
    _el('dcfg-btn-dup').disabled   = !(has && row.can_copy);
    _el('dcfg-btn-del').disabled   = !edit;
    _el('dcfg-btn-thumb').disabled = !edit;
    _el('dcfg-btn-apply').disabled = !has;
    // Link: serve anche la modale Collegamenti nella pagina
    if (_el('dcfg-btn-link')) _el('dcfg-btn-link').disabled = !edit || typeof window.openLinksForDashboard !== 'function';
}

// ── Link: flow dashboard della configurazione selezionata ─────
// Apre la modale Link (ui/modal_objmod_links.js) sul bersaglio "Dashboard" con
// questa Config già selezionata (_doc/arch-flow-dashboard.md §7).

function _onLink() {
    if (!_selectedRow) return;
    const d = _selectedRow.getData();
    if (typeof window.openLinksForDashboard !== 'function') {
        alert(t('app.dcfg.links_unavailable'));
        return;
    }
    const linksEl = document.getElementById('modalObjModLinks');
    bootstrap.Modal.getInstance(document.getElementById('modalDashboardCfg'))?.hide();
    // Alla chiusura della Link si torna alla Dashboard Config (con i conteggi aggiornati)
    linksEl?.addEventListener('hidden.bs.modal', () => {
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalDashboardCfg')).show();
    }, { once: true });
    window.openLinksForDashboard(d.dshp_id);
}

// ============================================================
// CRUD
// ============================================================

async function _onNew() {
    const defName = t('app.dcfg.new.default_name');
    const name = _promptWithLimit(t('app.dcfg.new.prompt_name'), defName, NAME_MAX);
    if (name === null) return;
    const desc = _promptWithLimit(t('app.dcfg.new.prompt_desc'), '', DESC_MAX);
    if (desc === null) return;

    const cfg  = _captureLayout();
    const ico  = _generateSchema(cfg);   // schema grafico sempre

    try {
        const res = await _post({
            action:           'create',
            dshp_name:        name || defName,
            dshp_description: desc,
            dshp_cfg:         cfg,
            dshp_ico:         ico,
        });
        if (!res.ok) throw new Error(res.error);
        await _refreshTable();
        _showWarnings(res.data?.warnings);
    } catch (err) {
        alert(t('app.dcfg.err.create', { error: err.message }));
    }
}

// ── Sovrascrivi selezionata col layout corrente ────────────────

async function _onOverwrite() {
    if (!_selectedRow) return;
    const d = _selectedRow.getData();
    const ok = confirm(t('app.dcfg.overwrite.confirm', { name: d.dshp_name }));
    if (!ok) return;

    const cfg = _captureLayout();
    const ico = _generateSchema(cfg);
    try {
        const res = await _post({ action: 'update', dshp_id: d.dshp_id, dshp_cfg: cfg, dshp_ico: ico });
        if (!res.ok) throw new Error(res.error);
        await _refreshTable();
        _showWarnings(res.data?.warnings);
        await _showPreview({ ...d, has_ico: !!ico });
    } catch (err) {
        alert(t('app.dcfg.err.overwrite', { error: err.message }));
    }
}

async function _onDuplicate() {
    if (!_selectedRow) return;
    const d = _selectedRow.getData();
    try {
        const res = await _post({ action: 'duplicate', dshp_id: d.dshp_id });
        if (!res.ok) throw new Error(res.error);
        await _refreshTable();
        _showWarnings(res.data?.warnings);
    } catch (err) {
        alert(t('app.dcfg.err.duplicate', { error: err.message }));
    }
}

// ── Importa da un altro WP (dshp_share, §11.7.1) ──────────────

function _onImportToggle() {
    const box = _el('dcfg-import');
    const btn = _el('dcfg-btn-import');
    if (!box) return;
    box.hidden = !box.hidden;
    btn?.setAttribute('aria-expanded', box.hidden ? 'false' : 'true');
    if (!box.hidden) _refreshImport();
}

async function _refreshImport() {
    const list  = _el('dcfg-import-list');
    const scope = _el('dcfg-import-scope')?.value === 'global' ? 'global' : 'res';
    if (!list) return;
    list.textContent = t('app.dcfg.import.loading');
    let rows = [];
    try {
        const res = await _get({ action: 'list_shared', scope });
        if (!res.ok) throw new Error(res.error);
        rows = res.data ?? [];
    } catch (err) {
        list.textContent = t('app.dcfg.err.generic', { error: err.message });
        return;
    }
    list.replaceChildren();
    if (!rows.length) {
        const p = document.createElement('p');
        p.className = 'dcfg-import-empty';
        p.textContent = t('app.dcfg.import.empty');
        list.appendChild(p);
        return;
    }
    const table = document.createElement('table');
    table.className = 'dcfg-import-table';
    const cap = document.createElement('caption');
    cap.className = 'visually-hidden';
    cap.textContent = t('app.dcfg.import.caption');
    const hr = document.createElement('tr');
    const heads = [t('app.dcfg.import.col.research'), t('app.dcfg.import.col.wp'), t('common.name'),
                   t('common.description'), t('app.dcfg.col.share'), null];
    for (const h of heads) {
        const th = document.createElement('th');
        th.scope = 'col';
        if (h === null) {
            const s = document.createElement('span');
            s.className = 'visually-hidden';
            s.textContent = t('app.dcfg.import.col.action');
            th.appendChild(s);
        } else {
            th.textContent = h;
        }
        hr.appendChild(th);
    }
    const thead = document.createElement('thead');
    thead.appendChild(hr);
    const tbody = document.createElement('tbody');
    for (const r of rows) {
        const tr = document.createElement('tr');
        for (const v of [r.res_title, r.wp_title, r.dshp_name, r.dshp_description, t(_VIS_KEYS[r.dshp_share] ?? _VIS_KEYS[1])]) {
            const td = document.createElement('td');
            td.textContent = v ?? '';
            tr.appendChild(td);
        }
        const td = document.createElement('td');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm btn-outline-success';
        b.textContent = t('app.dcfg.import.copy_here');
        b.setAttribute('aria-label', t('app.dcfg.import.copy_here_named', { name: r.dshp_name }));
        b.addEventListener('click', () => _onImport(r));
        td.appendChild(b);
        tr.appendChild(td);
        tbody.appendChild(tr);
    }
    table.append(cap, thead, tbody);
    list.appendChild(table);
}

async function _onImport(r) {
    if (!confirm(t('app.dcfg.import.confirm.@', { name: r.dshp_name, wp: r.wp_title }))) return;
    try {
        const res = await _post({ action: 'import', dshp_id: r.dshp_id });
        if (!res.ok) throw new Error(res.error);
        await _refreshTable();
        _showWarnings(res.data?.warnings);
    } catch (err) {
        alert(t('app.dcfg.err.import', { error: err.message }));
    }
}

async function _onDelete() {
    if (!_selectedRow) return;
    const d = _selectedRow.getData();
    if (!confirm(t('app.dcfg.delete.confirm', { name: d.dshp_name }))) return;
    try {
        const res = await _post({ action: 'delete', dshp_id: d.dshp_id });
        if (!res.ok) throw new Error(res.error);
        const prev = document.getElementById('dcfg-preview');
        if (prev) prev.hidden = true;
        // Il server ha tolto anche i legami ai flow e la predefinita
        if (typeof workpackage !== 'undefined' && Number(workpackage?.wp_default_dshp_id) === d.dshp_id) {
            workpackage.wp_default_dshp_id = null;
        }
        // Eliminata la Config in uso: il layout resta, ma non c'è più una Config caricata
        if (_current?.dshpId === d.dshp_id) _setCurrent(null);
        await _refreshTable();
    } catch (err) {
        alert(t('app.dcfg.err.delete', { error: err.message }));
    }
}

// ── Aggiorna thumbnail ────────────────────────────────────────

async function _onUpdateThumb() {
    if (!_selectedRow) return;
    const d = _selectedRow.getData();

    // Chiedi all'utente il tipo di thumbnail
    const choice = confirm(t('app.dcfg.thumb.choose'));

    let ico;
    if (choice) {
        // Schema grafico: carica prima la config per avere dshp_cfg
        try {
            const r = await _get({ action: 'load', dshp_id: d.dshp_id });
            if (!r.ok) throw new Error(r.error);
            ico = _generateSchema(r.data.dshp_cfg);
        } catch (err) {
            alert(t('app.dcfg.err.generic', { error: err.message }));
            return;
        }
    } else {
        // Screenshot via html2canvas
        ico = await _captureScreenshot();
        if (!ico) { alert(t('app.dcfg.thumb.screenshot_unavailable')); return; }
    }

    try {
        const res = await _post({ action: 'update', dshp_id: d.dshp_id, dshp_ico: ico });
        if (!res.ok) throw new Error(res.error);
        await _refreshTable();
        // Aggiorna preview
        await _showPreview(d);
    } catch (err) {
        alert(t('app.dcfg.err.thumb', { error: err.message }));
    }
}

// ── Applica configurazione alla dashboard ─────────────────────

async function _onApply() {
    if (!_selectedRow) return;
    const d = _selectedRow.getData();
    const ok = confirm(t('app.dcfg.apply.confirm', { name: d.dshp_name }));
    if (!ok) return;

    bootstrap.Modal.getInstance(document.getElementById('modalDashboardCfg'))?.hide();
    await restoreConfig(d.dshp_id);
}

// ============================================================
// PREVIEW THUMBNAIL
// ============================================================

async function _showPreview(rowData) {
    const prevEl  = document.getElementById('dcfg-preview');
    const imgEl   = document.getElementById('dcfg-preview-img');
    const descEl  = document.getElementById('dcfg-preview-desc');
    if (!prevEl || !imgEl || !descEl) return;

    if (!rowData.has_ico) {
        prevEl.hidden = true;
        return;
    }

    try {
        const res = await _get({ action: 'load', dshp_id: rowData.dshp_id });
        if (!res.ok || !res.data.dshp_ico) { prevEl.hidden = true; return; }
        imgEl.src      = res.data.dshp_ico;
        descEl.textContent = rowData.dshp_description || '';
        prevEl.hidden  = false;
    } catch (_) {
        prevEl.hidden = true;
    }
}

// ============================================================
// LAYOUT helpers
// ============================================================

function _captureLayout() {
    // Cattura il BSP tree completo (contiene objectId per ogni foglia)
    const bsp = serialize();

    // Lista piatta per il thumbnail
    const panels = [];
    document.querySelectorAll('.panel.wm-panel').forEach(el => {
        const objId = el._wmLeaf?.savedState?.objectId;
        if (!objId) return;
        const rect = el.getBoundingClientRect();
        panels.push({
            obj_id:   Number(objId),
            obj_name: el.dataset.currentObjectName || '',
            app:      el.dataset.currentApp || '',
            x:        Math.round(rect.left),
            y:        Math.round(rect.top),
            w:        Math.round(rect.width),
            h:        Math.round(rect.height),
        });
    });
    return { bsp, panels, captured_at: new Date().toISOString() };
}

/**
 * Carica una configurazione dashboard dal DB e la ripristina (Applica, predefinita
 * all'apertura). Il layout si salva solo da questa modale: il vecchio
 * saveLayoutForFlow() della modale dei flow dashboard è stato rimosso (2026-10-04).
 */
export async function restoreConfig(dshpId) {
    try {
        const res = await _get({ action: 'load', dshp_id: dshpId });
        if (!res.ok) throw new Error(res.error);
        // Config caricata solo se il layout è stato davvero ripristinato
        if (await _restoreLayout(res.data.dshp_cfg)) {
            _setCurrent(res.data.dshp_id, res.data.dshp_name);
        }
    } catch (err) {
        alert(t('app.dcfg.err.restore', { error: err.message }));
    }
}

/** Ricostruisce il layout. false = formato non supportato (layout non toccato). */
async function _restoreLayout(cfg) {
    if (!cfg?.bsp) {
        alert(t('app.dcfg.restore.unsupported'));
        return false;
    }

    // Ricostruisce il BSP tree: restituisce [{ leafEl, objectId, selectedModelIds, embeddedFlow }]
    const leaves         = deserialize(cfg.bsp);
    const toLoad          = leaves.filter(l => l.objectId != null);
    const toLoadEmbedded  = leaves.filter(l => l.embeddedFlow != null);

    if (toLoad.length === 0 && toLoadEmbedded.length === 0) return true; // layout vuoto, nessun oggetto

    let loaded = 0, failed = 0;
    const needsReconnect = [];   // etichette dei pannelli flow embedded ripristinati senza contesto live

    for (const { leafEl, objectId, selectedModelIds } of toLoad) {
        try {
            const res = await fetch(
                `${EP_OBJ}?action=models_by_obj&obj_id=${encodeURIComponent(objectId)}`,
                { credentials: 'same-origin' }
            );
            const data = await res.json();
            if (!data.success || !data.data?.object) throw new Error('Oggetto non trovato');

            const obj      = data.data.object;
            const appKey   = obj.obj_app;
            const allModels = data.data.models ?? [];
            // Riproduce la selezione modelli salvata (checkbox in modal_tree_obj.js
            // al momento del salvataggio) — assente/vuota = comportamento di
            // sempre, carica tutti i modelli collegati all'oggetto.
            const models = (Array.isArray(selectedModelIds) && selectedModelIds.length)
                ? allModels.filter(m => selectedModelIds.includes(m.mod_id))
                : allModels;

            if (!appKey || typeof window.ModelRenderers?.[appKey] !== 'function') {
                console.warn(`[dashboard-cfg] nessun renderer per app="${appKey}"`);
                failed++;
                continue;
            }

            // Carica l'oggetto nel pannello (asincrono, non aspettiamo)
            window.ModelRenderers[appKey](leafEl, obj, models);
            loaded++;
        } catch (err) {
            console.warn(`[dashboard-cfg] errore caricamento obj ${objectId}:`, err.message);
            // Oggetto non visibile all'utente (o non più esistente): il pannello resta con un
            // avviso, il resto della configurazione si carica (regola 2 del §11.7)
            const body = leafEl.querySelector('.panel-body');
            if (body) body.innerHTML = `<div class="p-3 text-secondary small" role="status">${te('app.dcfg.restore.unavailable')}</div>`;
            failed++;
        }
    }

    // Pannelli "flow embedded" in editing — ricostruiscono il grafo e i
    // metadata del target (objId/app/name), ma MAI il riferimento DOM live
    // (bodyEl) al pannello bersaglio: non è serializzabile, e comunque il
    // pannello bersaglio potrebbe non esistere ancora/più — vedi
    // _doc/arch-dashboard-windows.md §10. Il contesto "Testa su panel" va
    // rifatto a mano; li elenchiamo in un unico alert a fine ripristino
    // invece di uno per pannello (bloccante, fastidioso con più di uno).
    // Editor dei flow: non si riapre sotto il livello 20 (_doc/arch-permessi.md §11.4)
    const canOpenFlowEditor = pageLevel() >= 20;
    for (const { leafEl, embeddedFlow } of toLoadEmbedded) {
        if (!canOpenFlowEditor) continue;
        try {
            if (typeof window.ModelRenderers?.FLE !== 'function') {
                console.warn('[dashboard-cfg] renderer FLE non disponibile');
                failed++;
                continue;
            }
            const label  = `[${embeddedFlow.app}] ${embeddedFlow.name}`;
            const isDash = embeddedFlow.kind === 'dashboard';
            // Oggetto sintetico, mai salvato: obj_app 'FLE' è solo la SIGLA
            // INTERNA che fa caricare l'editor dei flow (model_FLE.mjs), non
            // un'APP degli oggetti — vedi ui/modal_flow_embedded.js.
            const syntheticObject = {
                obj_app:  'FLE',
                obj_id:   null,
                obj_name: isDash
                    ? t('modal.flow_embedded.panel_label_dashboard', { name: embeddedFlow.name })
                    : t('modal.flow_embedded.panel_label_object', { app: embeddedFlow.app, name: embeddedFlow.name }),
                __embeddedTarget: {
                    kind:   isDash ? 'dashboard' : 'object',
                    objId:  embeddedFlow.objId,
                    dshpId: embeddedFlow.dshpId ?? null,
                    app:    embeddedFlow.app,
                    name:   embeddedFlow.name,
                    flowId: embeddedFlow.flowId,
                    // bodyEl volutamente assente: nessun contesto live da
                    // agganciare al ripristino, model_FLE.mjs gestisce già
                    // questo caso (controllo `embeddedTarget?.bodyEl`).
                },
            };
            window.ModelRenderers.FLE(leafEl, syntheticObject, []);
            // Un flow dashboard non legge la scena di un pannello: niente da ricollegare
            if (!isDash) needsReconnect.push(label);
            loaded++;
        } catch (err) {
            console.warn('[dashboard-cfg] errore caricamento flow embedded:', err.message);
            failed++;
        }
    }

    if (failed > 0) {
        console.warn(`[dashboard-cfg] ripristino: ${loaded} ok, ${failed} falliti`);
    }

    if (needsReconnect.length > 0) {
        alert(t('app.dcfg.restore.reconnect', {
            n:    needsReconnect.length,
            list: needsReconnect.map(l => `• ${l}`).join('\n'),
        }));
    }
    return true;
}

// ============================================================
// THUMBNAIL generation
// ============================================================

/**
 * Genera uno schema grafico a blocchi colorati del layout corrente.
 * I pannelli vengono disegnati proporzionalmente su un canvas 100px alto.
 * Restituisce una data URL PNG.
 */
function _generateSchema(cfg) {
    const panels = cfg?.panels ?? [];
    if (!panels.length) return null;

    const TH = 100;
    const vw = window.innerWidth  || 1280;
    const vh = window.innerHeight || 720;
    const TW = Math.round(TH * vw / vh);

    const cvs = document.createElement('canvas');
    cvs.width  = TW;
    cvs.height = TH;
    const ctx  = cvs.getContext('2d');

    // Sfondo
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, TW, TH);

    // Colori per tipo app
    const APP_COLORS = {
        ECH: '#1d4ed8',
        TJS: '#166534',
        PSG: '#7c3aed',
        FLE: '#92400e',
    };
    const DEFAULT_COLOR = '#374151';

    for (const p of panels) {
        const px = Math.round((p.x / vw) * TW);
        const py = Math.round((p.y / vh) * TH);
        const pw = Math.max(4, Math.round((p.w / vw) * TW));
        const ph = Math.max(4, Math.round((p.h / vh) * TH));
        ctx.fillStyle   = APP_COLORS[p.app] ?? DEFAULT_COLOR;
        ctx.fillRect(px + 1, py + 1, pw - 2, ph - 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth   = 1;
        ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    }

    return cvs.toDataURL('image/png');
}

/**
 * Cattura uno screenshot del contenuto dashboard via html2canvas.
 * Carica html2canvas in modo lazy da CDN se non già disponibile.
 * Restituisce una data URL PNG oppure null in caso di errore.
 */
async function _captureScreenshot() {
    try {
        if (!window.html2canvas) {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src     = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
                s.onload  = resolve;
                s.onerror = () => reject(new Error('html2canvas non caricato'));
                document.head.appendChild(s);
            });
        }
        const target = document.getElementById('panelRoot') || document.body;
        const full   = await window.html2canvas(target, {
            scale:      1,
            useCORS:    true,
            allowTaint: true,
            logging:    false,
        });
        // Ridimensiona a 100px altezza
        const TH = 100;
        const TW = Math.round(TH * full.width / full.height);
        const out = document.createElement('canvas');
        out.width  = TW;
        out.height = TH;
        out.getContext('2d').drawImage(full, 0, 0, TW, TH);
        return out.toDataURL('image/png');
    } catch (err) {
        console.warn('[dashboard-cfg] screenshot failed:', err.message);
        return null;
    }
}

// ============================================================
// HELPERS
// ============================================================

function _bind(id, ev, fn) { document.getElementById(id)?.addEventListener(ev, fn); }
function _el(id)            { return document.getElementById(id); }
