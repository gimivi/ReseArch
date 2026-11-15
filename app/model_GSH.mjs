// model_GSH.mjs
// Visualizzatore tabellare per Google Sheets (sola lettura).
//
// mod_spec (da models.mod_spec nel DB):
// {
//   "apiUrl":        "api/gsh_data.php",   // opzionale, default gsh_data.php
//   "spreadsheetId": "1BxiMVs0XRA5n...",   // OBBLIGATORIO — ID del foglio
//   "gid":           "0",                  // GID della scheda (0 = prima), default "0"
//   "hasHeaders":    true,                 // prima riga = intestazioni (default true)
//   "limit":         1000,                 // max righe caricate
//   "pageSize":      25,                   // righe per pagina Tabulator
//   "autoRefresh":   0,                    // secondi tra auto-refresh (0 = disabilitato)
//   "searchFields":  ["Nome", "Città"],    // campi per ricerca client-side
//   "busKey":        "id",                 // campo chiave per App Bus selection:change
//   "columns": [                           // configurazione colonne Tabulator (opzionale)
//     { "field": "Nome", "title": "Nome teatro", "width": 200 }
//   ]
// }
//
// Multi-scheda: usare un modello per ogni scheda (gid diverso).
// Il menu sinistro mostra le schede se ci sono più modelli associati all'oggetto.

import { appBusOn, appBusEmit, APP_EVENT_TYPES } from './app-bus.mjs';
import { gshLoadFlows } from './GSH_sub_modules/GSH-flow-runner.mjs';
import { t, te, formatDate, formatNumber } from './shared/i18n.mjs';

const STATE_KEY = '__GSH_STATE__';

// ─────────────────────────────────────────────────────────────────────────────

export default {

  async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {
    _destroyInstance(bodyEl);

    const arr = Array.isArray(models) ? models : [];
    if (!arr.length) { bodyEl.textContent = t('app.gsh.no_models.@'); return; }

    const Tabulator = window.Tabulator;
    if (!Tabulator) { bodyEl.textContent = t('app.gsh.no_tabulator'); return; }

    // ── DOM ───────────────────────────────────────────────────────────────────

    bodyEl.innerHTML = `
      <div class="gsh-wrap">
        <div class="gsh-toolbar">
          <button type="button" class="gsh-refresh gsh-tb-btn" title="${te('common.refresh')}" aria-label="${te('common.refresh')}">
            <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
          </button>
          <input type="search" class="gsh-search" placeholder="${te('app.gsh.search_ph')}" aria-label="${te('common.search')}">
          <div class="gsh-col-vis">
            <button type="button" class="gsh-col-vis-btn gsh-tb-btn" title="${te('app.gsh.col_visibility')}" aria-label="${te('app.gsh.col_visibility')}">
              <i class="bi bi-layout-three-columns" aria-hidden="true"></i>
            </button>
            <div class="gsh-col-vis-menu"></div>
          </div>
          <a class="gsh-open-link gsh-tb-btn" href="#" target="_blank" rel="noopener"
             title="${te('app.gsh.open_in_sheets')}" aria-label="${te('app.gsh.open_in_sheets')}" style="display:none">
            <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
          </a>
          <span class="gsh-status" role="status" aria-live="polite"></span>
          <span class="gsh-refresh-time"></span>
        </div>
        <div class="gsh-grid"></div>
      </div>
    `;

    const gridEl       = bodyEl.querySelector('.gsh-grid');
    const statusEl     = bodyEl.querySelector('.gsh-status');
    const refreshTime  = bodyEl.querySelector('.gsh-refresh-time');
    const btnRefresh   = bodyEl.querySelector('.gsh-refresh');
    const searchEl     = bodyEl.querySelector('.gsh-search');
    const colVisBtn    = bodyEl.querySelector('.gsh-col-vis-btn');
    const colVisMenu   = bodyEl.querySelector('.gsh-col-vis-menu');
    const openLink     = bodyEl.querySelector('.gsh-open-link');

    const setStatus = (msg, isErr = false) => {
      statusEl.textContent = msg || '';
      statusEl.style.color = isErr ? '#f66' : '';
    };

    const markRefreshTime = () => {
      refreshTime.textContent = t('app.gsh.updated_at', { time: formatDate(new Date(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
    };

    // ── Stato ─────────────────────────────────────────────────────────────────

    const firstSpec = _parseSpec(arr[0]);
    const state = {
      bodyEl,
      object,                 // per objId nel payload App Bus (_onRowClick)
      cmdUI,                  // per gli hints del footer da nodi flow embedded
      table:          null,
      activeModelIdx: 0,
      mod_id:         arr[0]?.mod_id ?? null,
      spec:           firstSpec,
      apiUrl:         firstSpec.apiUrl || 'api/gsh_data.php',
      selectedRow:    null,
      switchModel:    null,   // assegnato sotto
      setStatus,              // per avvisi da funzioni module-level (es. _onRowClick)
      // EventTarget locale, indipendente dall'App Bus — sorgente per il nodo
      // flow DBS/GSH/Events/OnRowSelected. Vedi _onRowClick.
      localEvents: new EventTarget(),
      // Wrapper sottili sulle funzioni module-level già usate dalla UI —
      // nessuna logica duplicata, stesso principio di model_MPS.mjs.
      refresh: () => loadAndRender(),
      getRows: () => state.table?.getData() ?? [],
    };
    bodyEl[STATE_KEY] = state;

    signal?.addEventListener('abort', () => _destroyInstance(bodyEl), { once: true });

    // Flow embedded (Contesto 3): unico canale per costruire logica reattiva
    // ai dati/selezione di questo pannello — stesso principio di MPS/OSD/TJS.
    await gshLoadFlows(state, object, signal);

    // ── Link "Apri in Google Sheets" ──────────────────────────────────────────

    function updateOpenLink() {
      const sid = state.spec.spreadsheetId;
      const gid = state.spec.gid ?? '0';
      if (sid) {
        openLink.href = `https://docs.google.com/spreadsheets/d/${sid}/edit#gid=${gid}`;
        openLink.style.display = '';
      } else {
        openLink.style.display = 'none';
      }
    }

    // ── Fetch dati ────────────────────────────────────────────────────────────

    async function fetchData() {
      setStatus(t('common.loading'));
      const resp = await fetch(state.apiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'fetch', mod_id: state.mod_id }),
        signal,
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json?.success) {
        throw new Error(json?.message || t('app.gsh.err.api', { status: resp.status }));
      }
      return json.data?.rows ?? json.data ?? [];
    }

    // ── Colonne ───────────────────────────────────────────────────────────────

    function resolveColumns(rows) {
      const s = state.spec;
      if (Array.isArray(s.columns) && s.columns.length) {
        return s.columns.map(c => _applyFormatter(c));
      }
      if (!rows.length) return [];
      return Object.keys(rows[0]).map(k => ({ title: k, field: k }));
    }

    // ── Visibilità colonne ────────────────────────────────────────────────────

    function buildColVisMenu() {
      colVisMenu.innerHTML = '';
      if (!state.table) return;
      state.table.getColumns().forEach(col => {
        const field = col.getField();
        if (!field) return;
        const label = document.createElement('label');
        label.className = 'gsh-col-vis-item';
        const cb = document.createElement('input');
        cb.type    = 'checkbox';
        cb.checked = col.isVisible();
        cb.addEventListener('change', () => {
          if (cb.checked) state.table.showColumn(field);
          else            state.table.hideColumn(field);
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + (col.getDefinition().title || field)));
        colVisMenu.appendChild(label);
      });
    }

    colVisBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      colVisMenu.style.display = colVisMenu.style.display !== 'none' ? 'none' : 'block';
    }, { signal });

    document.addEventListener('click', () => { colVisMenu.style.display = 'none'; }, { signal });

    // ── Ricerca client-side ───────────────────────────────────────────────────

    let _searchTimer = null;
    searchEl.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        if (!state.table) return;
        const term = searchEl.value.trim();
        if (!term) { state.table.clearFilter(); return; }
        const fields = state.spec.searchFields
          || state.table.getColumns().map(c => c.getField()).filter(Boolean);
        state.table.setFilter([fields.map(f => ({ field: f, type: 'like', value: term }))]);
      }, 350);
    }, { signal });

    // ── Carica e renderizza ───────────────────────────────────────────────────

    async function loadAndRender() {
      try {
        const rows    = await fetchData();
        const columns = resolveColumns(rows);

        if (!state.table) {
          state.table = new Tabulator(gridEl, {
            data:           rows,
            columns,
            layout:         'fitDataStretch',
            height:         '100%',
            pagination:     true,
            paginationSize: state.spec.pageSize || 25,
            movableColumns: true,
          });

          // Bind evento in modo esplicito — più affidabile del config
          // "rowClick" passato al costruttore (vedi ui/modal_objmod_links.js
          // per lo stesso pattern, già verificato altrove nel progetto).
          state.table.on('rowClick', (e, row) => {
            _onRowClick(row.getData(), state);
          });
        } else {
          state.table.setColumns(columns);
          await state.table.setData(rows);
        }

        buildColVisMenu();
        markRefreshTime();
        setStatus(t('app.gsh.rows', { n: rows.length }));
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') return;
        setStatus(e.message, true);
        if (!state.table) {
          state.table = new Tabulator(gridEl, { data: [], columns: [], height: '100%' });
        }
      }
    }

    // ── Auto-refresh ──────────────────────────────────────────────────────────

    const autoSec = parseInt(state.spec.autoRefresh ?? 0, 10);
    if (autoSec > 0) {
      const timer = setInterval(() => {
        if (!signal?.aborted) loadAndRender();
      }, autoSec * 1000);
      signal.addEventListener('abort', () => clearInterval(timer), { once: true });
    }

    // ── Switch scheda (multi-modello) ─────────────────────────────────────────

    state.switchModel = async (idx) => {
      if (idx === state.activeModelIdx) return;
      const newM = arr[idx];
      if (!newM) return;

      const newSpec = _parseSpec(newM);
      if (!newSpec.spreadsheetId) {
        setStatus(t('app.gsh.no_spreadsheet_id.@', { n: idx + 1 }), true);
        return;
      }

      state.activeModelIdx = idx;
      state.spec           = newSpec;
      state.mod_id         = newM.mod_id ?? state.mod_id;
      state.apiUrl         = newSpec.apiUrl || 'api/gsh_data.php';

      if (state.table) {
        try { state.table.destroy(); } catch {}
        state.table = null;
      }

      searchEl.value = '';
      updateOpenLink();
      _setLeftMenuActive(headerEl, idx);

      await loadAndRender();
    };

    // ── Refresh manuale ───────────────────────────────────────────────────────

    btnRefresh.addEventListener('click', () => loadAndRender(), { signal });

    // ── App Bus ───────────────────────────────────────────────────────────────

    appBusOn(APP_EVENT_TYPES.DATA_REFRESH, ({ payload }) => {
      if (!payload?.targetApp || payload.targetApp === 'GSH') loadAndRender();
    }, signal);

    appBusOn(APP_EVENT_TYPES.SELECTION_CHANGE, ({ payload }) => {
      if (payload?.sourceApp === 'GSH') return;
      const busKey = state.spec.busKey;
      if (!busKey || payload?.field !== busKey) return;
      _highlightRow(state, busKey, payload.value);
    }, signal);

    // ── Prima renderizzazione ─────────────────────────────────────────────────

    updateOpenLink();
    await loadAndRender();
  },

  // ── Menu sinistro — lista schede ─────────────────────────────────────────────

  getLeftMenu({ panel, headerEl, bodyEl, object, models }) {
    const arr = Array.isArray(models) ? models : [];
    if (arr.length <= 1) return { title: _objectName(object), items: [] };

    const activeIdx = bodyEl?.[STATE_KEY]?.activeModelIdx ?? 0;

    return {
      title: _objectName(object),
      items: arr.map((m, i) => {
        const s = _parseSpec(m);
        return {
          id:     `gsh-tab-${i}`,
          label:  m.mod_name || m.mod_title || s.sheetName || t('app.gsh.sheet_n', { n: i + 1 }),
          active: i === activeIdx,
          onClick: () => bodyEl?.[STATE_KEY]?.switchModel?.(i),
        };
      }),
    };
  },

  // ── Toolbar globale ──────────────────────────────────────────────────────────

  getToolbar({ bodyEl }) {
    const st = () => bodyEl?.[STATE_KEY];
    return {
      items: [
        {
          type: 'button', id: 'btnGshRefresh', iconClass: 'bi bi-arrow-clockwise',
          className: 'icon-only', title: t('app.gsh.refresh_data'), attrs: { 'aria-label': t('app.gsh.refresh_data') },
          onClick: () => {
            appBusEmit(APP_EVENT_TYPES.DATA_REFRESH, { sourceApp: 'GSH' });
          },
        },
        { type: 'divider' },
        {
          type: 'button', id: 'btnGshExportCsv', iconClass: 'bi bi-filetype-csv',
          className: 'icon-only', title: t('app.gsh.export_csv'), attrs: { 'aria-label': t('app.gsh.export_csv') },
          onClick: () => st()?.table?.download('csv', 'export.csv'),
        },
      ],
    };
  },

  getRightMenu() { return { title: '☰', items: [] }; },

  destroy() {},
};

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function _setLeftMenuActive(headerEl, idx) {
  if (!headerEl) return;
  const ul = headerEl.querySelector("[data-menu='left'] ul.dropdown-menu")
          || headerEl.querySelector(".menu-left ul.dropdown-menu")
          || headerEl.querySelector(".dropdown-left ul.dropdown-menu")
          || headerEl.querySelectorAll("ul.dropdown-menu")[0];
  ul?.querySelectorAll('.dropdown-item').forEach((a, i) => {
    a.classList.toggle('active', i === idx);
  });
}

function _onRowClick(rowData, state) {
  state.selectedRow = rowData;
  // Sorgente locale per DBS/GSH/Events/OnRowSelected — indipendente dall'App
  // Bus, sempre valorizzata (a differenza dell'emissione selection:change
  // sotto, che richiede mod_spec.busKey configurato).
  state.localEvents?.dispatchEvent(new CustomEvent('rowSelected', { detail: rowData }));

  const busKey = state.spec.busKey;
  if (!busKey) {
    state.setStatus?.(t('app.gsh.no_buskey'), true);
    console.warn('[GSH] mod_spec.busKey mancante: selection:change non emesso.');
    return;
  }
  if (!(busKey in rowData)) {
    state.setStatus?.(t('app.gsh.buskey_missing', { key: busKey }), true);
    console.warn('[GSH] busKey non presente nel record:', busKey, rowData);
    return;
  }
  appBusEmit(APP_EVENT_TYPES.SELECTION_CHANGE, {
    objId:     state.object?.obj_id ?? null,
    sourceApp: 'GSH',
    field:     busKey,
    value:     rowData[busKey],
    row:       rowData,
  });
}

function _highlightRow(state, busKey, value) {
  const table = state.table;
  if (!table) return;
  try {
    table.getRows().forEach(r => r.getElement()?.classList.remove('gsh-row-selected'));
    const row = table.getRows().find(r => r.getData()[busKey] == value);
    if (row) {
      row.getElement()?.classList.add('gsh-row-selected');
      row.scrollTo();
    }
  } catch { /* silenzioso */ }
}

function _applyFormatter(colDef) {
  if (!colDef.formatter || typeof colDef.formatter !== 'string') return colDef;
  const fmtMap = {
    date: (cell) => {
      const v = cell.getValue(); if (!v) return '';
      try { return formatDate(new Date(v)); } catch { return v; }
    },
    datetime: (cell) => {
      const v = cell.getValue(); if (!v) return '';
      try { return formatDate(new Date(v), { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }); } catch { return v; }
    },
    money: (cell) => {
      const v = parseFloat(cell.getValue()); if (isNaN(v)) return '';
      return formatNumber(v, { minimumFractionDigits: 2 });
    },
    boolean: (cell) => cell.getValue() ? '✔' : '✗',
    badge: (cell) => {
      const v = cell.getValue(); if (v == null) return '';
      const colors = colDef.colors || {};
      const bg = colors[v] || '#4477ff';
      return `<span style="background:${bg};color:#fff;padding:2px 7px;border-radius:10px;font-size:11px">${v}</span>`;
    },
    link: (cell) => {
      const v = cell.getValue(); if (!v) return '';
      return `<a href="${v}" target="_blank" rel="noopener" style="color:#7af">${v}</a>`;
    },
    image: (cell) => {
      const v = cell.getValue(); if (!v) return '';
      return `<img src="${v}" style="max-height:40px;max-width:80px;object-fit:contain">`;
    },
  };
  const fn = fmtMap[colDef.formatter];
  if (!fn) return colDef;
  return { ...colDef, formatter: fn };
}

function _parseSpec(m) {
  if (!m?.mod_spec) return {};
  try {
    return typeof m.mod_spec === 'string' ? JSON.parse(m.mod_spec) : (m.mod_spec || {});
  } catch { return {}; }
}

function _objectName(object) {
  if (!object) return 'Google Sheet';
  return object.obj_name || object.obj_title || object.name || object.title
      || t('app.gsh.object_n.@', { id: object.obj_id ?? '' }).trim();
}

function _destroyInstance(bodyEl) {
  const s = bodyEl?.[STATE_KEY];
  if (!s) return;
  try { s.table?.destroy?.(); } catch {}
  try { delete bodyEl[STATE_KEY]; } catch {}
}
