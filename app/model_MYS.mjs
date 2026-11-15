// model_MYS.mjs
// Visualizzatore/editor tabellare MySQL per ReseArch.
//
// Fase 2: ricerca full-text client-side, toggle visibilità colonne
// Fase 3: CRUD inline — doppio clic per editare, +riga, elimina
// Multi-tabella: switch via menu sinistro (un modello per tabella)
//
// mod_spec (da models.mod_spec nel DB):
// {
//   "apiUrl":       "api/grid.php",      // opzionale
//   "table":        "nome_tabella",      // OBBLIGATORIO
//   "fields":       ["*"],
//   "where":        [{"field":"x","op":"=","value":"y"}],
//   "orderBy":      [{"field":"data","dir":"desc"}],
//   "limit":        200,
//   "pageSize":     25,
//   "pkField":      "id",               // fallback se il server non lo manda
//   "searchFields": ["Nome","Città"],    // campi per la ricerca client-side
//   "columns": [                        // configurazione colonne Tabulator (opzionale)
//     { "field":"id",   "title":"#",    "width":60, "frozen":true },
//     { "field":"nome", "title":"Nome", "width":200 }
//   ],
//   "busKey": "id"                      // campo chiave per App Bus selection:change
// }

import { appBusOn, appBusEmit, APP_EVENT_TYPES } from './app-bus.mjs';
import { mysLoadFlows } from './MYS_sub_modules/MYS-flow-runner.mjs';
import { t, te, formatDate, formatNumber } from './shared/i18n.mjs';

const STATE_KEY = '__MYS_STATE__';

// ─────────────────────────────────────────────────────────────────────────────

export default {

  async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal, level }) {
    _destroyInstance(bodyEl);

    // ── Modelli ───────────────────────────────────────────────────────────────

    const arr = Array.isArray(models) ? models : [];
    if (!arr.length) { bodyEl.textContent = t('app.mys.no_models.@'); return; }

    const Tabulator = window.Tabulator;
    if (!Tabulator) { bodyEl.textContent = t('app.mys.no_tabulator'); return; }

    // ── DOM ───────────────────────────────────────────────────────────────────

    bodyEl.innerHTML = `
      <div class="mys-wrap">
        <div class="mys-toolbar">
          <button type="button" class="mys-refresh mys-tb-btn" title="${te('common.refresh')}" aria-label="${te('common.refresh')}">
            <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
          </button>
          <input type="search" class="mys-search" placeholder="${te('app.mys.search_ph')}" aria-label="${te('common.search')}">
          <div class="mys-col-vis">
            <button type="button" class="mys-col-vis-btn mys-tb-btn" title="${te('app.mys.col_visibility')}" aria-label="${te('app.mys.col_visibility')}">
              <i class="bi bi-layout-three-columns" aria-hidden="true"></i>
            </button>
            <div class="mys-col-vis-menu"></div>
          </div>
          <button type="button" class="mys-add-row mys-tb-btn" title="${te('app.mys.new_row')}" style="display:none">
            <i class="bi bi-plus-lg" aria-hidden="true"></i> ${te('app.mys.row')}
          </button>
          <span class="mys-status" role="status" aria-live="polite"></span>
        </div>
        <div class="mys-grid"></div>
      </div>
    `;

    const gridEl     = bodyEl.querySelector('.mys-grid');
    const statusEl   = bodyEl.querySelector('.mys-status');
    const btnRefresh = bodyEl.querySelector('.mys-refresh');
    const searchEl   = bodyEl.querySelector('.mys-search');
    const colVisBtn  = bodyEl.querySelector('.mys-col-vis-btn');
    const colVisMenu = bodyEl.querySelector('.mys-col-vis-menu');
    const btnAddRow  = bodyEl.querySelector('.mys-add-row');

    const setStatus = (msg, isErr = false) => {
      statusEl.textContent = msg || '';
      statusEl.style.color = isErr ? '#f66' : '';
    };

    // ── Stato (fonte unica di verità per spec, mod_id, ecc.) ──────────────────
    // Tutte le funzioni leggono da state, non da variabili di closure iniziali.
    // Questo permette a switchModel() di cambiare tabella senza ricreare i listener.

    const firstSpec = _parseSpec(arr[0]);
    const state = {
      bodyEl,
      object,                 // per objId nel payload App Bus (_onRowClick)
      cmdUI,                  // per gli hints del footer da nodi flow embedded
      table:          null,
      activeModelIdx: 0,
      mod_id:         arr[0]?.mod_id ?? null,
      spec:           firstSpec,
      apiUrl:         firstSpec.apiUrl || 'api/grid.php',
      selectedRow:    null,
      pkField:        firstSpec.pkField || 'id',
      writable:       false,
      // Comandi di modifica nell'interfaccia (riga nuova, elimina, editing celle): servono
      // il permesso del server (writable) e almeno il livello autore (§5). I flow usano writable.
      canEditUI:      false,
      switchModel:    null,   // assegnato sotto
      setStatus,              // per avvisi da funzioni module-level (es. _onRowClick)
      // EventTarget locale, indipendente dall'App Bus — sorgente per il nodo
      // flow DBS/MYS/Events/OnRowSelected. Vedi _onRowClick.
      localEvents: new EventTarget(),
      // Wrapper sottili su apiCall/loadAndRender già esistenti — nessuna
      // logica CRUD duplicata, stesso principio di model_MPS.mjs. Il
      // refresh dopo ogni scrittura tiene la griglia visibile allineata.
      refresh: (extraWhere = []) => loadAndRender(extraWhere),
      insertRow: async (data) => {
        const res = await apiCall({ action: 'insert', data });
        await loadAndRender();
        return res;
      },
      updateRow: async (pk, data) => {
        const res = await apiCall({ action: 'update', pk, data });
        await loadAndRender();
        return res;
      },
      deleteRow: async (pk) => {
        await apiCall({ action: 'delete', pk });
        await loadAndRender();
      },
    };
    bodyEl[STATE_KEY] = state;

    // Flow embedded (Contesto 3): unico canale per costruire logica reattiva
    // ai dati/selezione di questo pannello — stesso principio di MPS/OSD/TJS.
    await mysLoadFlows(state, object, signal);

    signal?.addEventListener('abort', () => _destroyInstance(bodyEl), { once: true });

    // ── API helper ────────────────────────────────────────────────────────────

    async function apiCall(payload) {
      const resp = await fetch(state.apiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...payload, mod_id: state.mod_id }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json?.success) throw new Error(json?.message || t('app.mys.err.server'));
      return json.data;
    }

    // ── Fetch dati ────────────────────────────────────────────────────────────

    function buildRequest(extraWhere = [], extraOrder = []) {
      const s = state.spec;
      return {
        action:  'list',
        mod_id:  state.mod_id,
        fields:  s.fields  || ['*'],
        where:   extraWhere,
        orderBy: extraOrder,
        limit:   s.limit   || 200,
      };
    }

    async function fetchData(extraWhere = [], extraOrder = []) {
      setStatus(t('common.loading'));
      const resp = await fetch(state.apiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildRequest(extraWhere, extraOrder)),
        signal,
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json?.success) {
        throw new Error(json?.message || t('app.mys.err.api', { status: resp.status }));
      }
      const d        = json.data;
      const rows     = Array.isArray(d) ? d : (d?.rows ?? []);
      const pkField  = d?.pkField  ?? state.spec.pkField ?? 'id';
      const writable = d?.writable ?? false;
      return { rows, pkField, writable };
    }

    // ── CRUD — aggiorna cella esistente ───────────────────────────────────────

    async function _onCellEdited(cell) {
      const row = cell.getRow();
      if (row.getData()._new) return;
      const pk    = row.getData()[state.pkField];
      const field = cell.getField();
      const val   = cell.getValue();
      try {
        await apiCall({ action: 'update', pk, data: { [field]: val } });
        setStatus(t('app.mys.updated'));
      } catch (e) {
        try { cell.restoreOldValue(); } catch {}
        setStatus(e.message, true);
      }
    }

    // ── CRUD — salva nuova riga ───────────────────────────────────────────────

    async function _saveNewRow(row) {
      const raw  = row.getData();
      const data = Object.fromEntries(
        Object.entries(raw)
          .filter(([k]) => !k.startsWith('_') && k !== state.pkField)
      );
      if (!Object.values(data).some(v => v !== '' && v !== null && v !== undefined)) {
        setStatus(t('app.mys.fill_one'), true);
        return;
      }
      try {
        const res = await apiCall({ action: 'insert', data });
        await row.update({ ...raw, _new: false, [state.pkField]: res.insertId });
        state.table?.redraw();
        setStatus(t('app.mys.inserted', { id: res.insertId }));
      } catch (e) {
        setStatus(e.message, true);
      }
    }

    // ── CRUD — elimina riga ───────────────────────────────────────────────────

    async function _deleteRow(row) {
      const pk = row.getData()[state.pkField];
      if (!confirm(t('app.mys.confirm_delete', { field: state.pkField, pk }))) return;
      try {
        await apiCall({ action: 'delete', pk });
        row.delete();
        setStatus(t('common.deleted'));
      } catch (e) {
        setStatus(e.message, true);
      }
    }

    // ── Colonna azioni ────────────────────────────────────────────────────────

    function _buildActionsColumn() {
      return {
        title: '', field: '_act', width: 54, frozen: true,
        headerSort: false, resizable: false, hozAlign: 'center',
        formatter: (cell) => {
          const isNew = !!cell.getRow().getData()._new;
          if (isNew) {
            return `<button class="mys-btn-save"    title="${te('common.save')}" aria-label="${te('common.save')}"><span aria-hidden="true">✓</span></button>`
                 + `<button class="mys-btn-discard" title="${te('common.cancel')}" aria-label="${te('common.cancel')}"><span aria-hidden="true">✗</span></button>`;
          }
          return `<button class="mys-btn-delete" title="${te('common.delete')}" aria-label="${te('common.delete')}"><span aria-hidden="true">🗑</span></button>`;
        },
        cellClick: (e, cell) => {
          const btn = e.target.closest?.('button');
          if (!btn) return;
          const row = cell.getRow();
          if      (btn.classList.contains('mys-btn-save'))    _saveNewRow(row);
          else if (btn.classList.contains('mys-btn-discard')) row.delete();
          else if (btn.classList.contains('mys-btn-delete'))  _deleteRow(row);
        },
      };
    }

    // ── Risoluzione colonne ───────────────────────────────────────────────────

    function resolveColumns(rows) {
      const s = state.spec;
      let cols = [];
      if (Array.isArray(s.columns) && s.columns.length) {
        cols = s.columns.map(c => _applyFormatter(c));
      } else if (rows.length) {
        cols = Object.keys(rows[0]).map(k => ({ title: k, field: k }));
      }

      if (state.canEditUI) {
        cols = cols.map(c => {
          if (c.field === state.pkField || c.field === '_act' || c.editable === false) return c;
          return { ...c, editor: c.editor ?? 'input', editTriggerEvent: 'dblclick' };
        });
        cols = [_buildActionsColumn(), ...cols];
      }

      return cols;
    }

    // ── Visibilità colonne ────────────────────────────────────────────────────

    function buildColVisMenu() {
      colVisMenu.innerHTML = '';
      if (!state.table) return;
      state.table.getColumns().forEach(col => {
        const field = col.getField();
        if (!field || field === '_act') return;
        const label = document.createElement('label');
        label.className = 'mys-col-vis-item';
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
          || state.table.getColumns()
               .map(c => c.getField())
               .filter(f => f && f !== '_act' && f !== state.pkField);
        state.table.setFilter([fields.map(f => ({ field: f, type: 'like', value: term }))]);
      }, 350);
    }, { signal });

    // ── Carica e renderizza ───────────────────────────────────────────────────

    async function loadAndRender(extraWhere = []) {
      try {
        const { rows, pkField, writable } = await fetchData(extraWhere);
        state.pkField  = pkField;
        state.writable = writable;
        state.canEditUI = writable && (level ?? window.RA_CTX?.level ?? 50) >= 30;

        btnAddRow.style.display = state.canEditUI ? '' : 'none';

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
            cellEdited(cell) {
              if (state.canEditUI) _onCellEdited(cell);
            },
          });

          // Bind evento in modo esplicito — più affidabile del config
          // "rowClick" passato al costruttore (vedi ui/modal_objmod_links.js
          // per lo stesso pattern, già verificato altrove nel progetto).
          state.table.on('rowClick', (e, row) => {
            if (e.target.closest?.('.mys-btn-save,.mys-btn-discard,.mys-btn-delete')) return;
            _onRowClick(row.getData(), state, state.spec);
          });
        } else {
          state.table.setColumns(columns);
          await state.table.setData(rows);
        }

        buildColVisMenu();
        setStatus(t('app.mys.records', { n: rows.length }));
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') return;
        setStatus(e.message, true);
        if (!state.table) {
          state.table = new Tabulator(gridEl, { data: [], columns: [], height: '100%' });
        }
      }
    }

    // ── Switch modello (multi-tabella) ────────────────────────────────────────

    state.switchModel = async (idx) => {
      if (idx === state.activeModelIdx) return;
      const newM = arr[idx];
      if (!newM) return;

      const newSpec = _parseSpec(newM);
      if (!newSpec.table) {
        setStatus(t('app.mys.table_not_configured.@', { n: idx + 1 }), true);
        return;
      }

      state.activeModelIdx = idx;
      state.spec           = newSpec;
      state.mod_id         = newM.mod_id ?? state.mod_id;
      state.apiUrl         = newSpec.apiUrl || 'api/grid.php';
      state.pkField        = newSpec.pkField || 'id';

      // Distruggi il Tabulator corrente per ricrearlo con le nuove colonne
      if (state.table) {
        try { state.table.destroy(); } catch {}
        state.table = null;
      }

      // Reset ricerca
      searchEl.value = '';

      // Aggiorna l'evidenziazione active nel menu sinistro
      _setLeftMenuActive(headerEl, idx);

      await loadAndRender();
    };

    // ── Nuova riga ────────────────────────────────────────────────────────────

    btnAddRow.addEventListener('click', () => {
      if (!state.table || !state.canEditUI) return;
      state.table.addRow({ _new: true }, true).then(row => {
        try {
          const firstEditable = row.getCells()
            .find(c => c.getField() !== '_act' && c.getField() !== state.pkField);
          firstEditable?.edit?.();
        } catch {}
      });
    }, { signal });

    // ── Refresh ───────────────────────────────────────────────────────────────

    btnRefresh.addEventListener('click', () => loadAndRender(), { signal });

    // ── App Bus ───────────────────────────────────────────────────────────────

    appBusOn(APP_EVENT_TYPES.DATA_REFRESH, ({ payload }) => {
      if (!payload?.targetApp || payload.targetApp === 'MYS') loadAndRender();
    }, signal);

    appBusOn(APP_EVENT_TYPES.SELECTION_CHANGE, ({ payload }) => {
      if (payload?.sourceApp === 'MYS') return;
      const busKey = state.spec.busKey;
      if (!busKey || payload?.field !== busKey) return;
      _highlightRow(state, busKey, payload.value);
    }, signal);

    appBusOn(APP_EVENT_TYPES.FILTER_APPLY, ({ payload }) => {
      if (payload?.sourceApp === 'MYS') return;
      if (payload?.targetApp && payload.targetApp !== 'MYS') return;
      const filters = Array.isArray(payload?.filters) ? payload.filters : [];
      loadAndRender(filters);
    }, signal);

    // ── Prima renderizzazione ─────────────────────────────────────────────────

    await loadAndRender();
  },

  // ── Menu sinistro — lista tabelle ────────────────────────────────────────────

  getLeftMenu({ panel, headerEl, bodyEl, object, models }) {
    const arr = Array.isArray(models) ? models : [];
    if (arr.length <= 1) return { title: _objectName(object), items: [] };

    const activeIdx = bodyEl?.[STATE_KEY]?.activeModelIdx ?? 0;

    return {
      title: _objectName(object),
      items: arr.map((m, i) => ({
        id:     `mys-tbl-${i}`,
        label:  m.mod_name || m.mod_title || _parseSpec(m).table || t('app.mys.table_n', { n: i + 1 }),
        active: i === activeIdx,
        onClick: () => {
          bodyEl?.[STATE_KEY]?.switchModel?.(i);
        },
      })),
    };
  },

  // ── Toolbar globale ──────────────────────────────────────────────────────────

  getToolbar({ bodyEl }) {
    const st = () => bodyEl?.[STATE_KEY];
    return {
      items: [
        {
          type: 'button', id: 'btnMysRefresh', iconClass: 'bi bi-arrow-clockwise',
          className: 'icon-only', title: t('app.mys.refresh_data'), attrs: { 'aria-label': t('app.mys.refresh_data') },
          onClick: () => {
            appBusEmit(APP_EVENT_TYPES.DATA_REFRESH, { sourceApp: 'MYS' });
          },
        },
        { type: 'divider' },
        {
          type: 'button', id: 'btnMysExportCsv', iconClass: 'bi bi-filetype-csv',
          className: 'icon-only', title: t('app.mys.export_csv'), attrs: { 'aria-label': t('app.mys.export_csv') },
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

// Aggiorna la classe active nel dropdown sinistro dopo uno switch di modello.
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

function _onRowClick(rowData, state, spec) {
  state.selectedRow = rowData;
  // Sorgente locale per DBS/MYS/Events/OnRowSelected — indipendente dall'App
  // Bus, sempre valorizzata (a differenza dell'emissione selection:change
  // sotto, che richiede mod_spec.busKey configurato).
  state.localEvents?.dispatchEvent(new CustomEvent('rowSelected', { detail: rowData }));

  const busKey = spec.busKey;
  if (!busKey) {
    state.setStatus?.(t('app.mys.no_buskey'), true);
    console.warn('[MYS] mod_spec.busKey mancante: selection:change non emesso.');
    return;
  }
  if (!(busKey in rowData)) {
    state.setStatus?.(t('app.mys.buskey_missing', { key: busKey }), true);
    console.warn('[MYS] busKey non presente nel record:', busKey, rowData);
    return;
  }
  appBusEmit(APP_EVENT_TYPES.SELECTION_CHANGE, {
    objId:     state.object?.obj_id ?? null,
    sourceApp: 'MYS',
    field:     busKey,
    value:     rowData[busKey],
    row:       rowData,
  });
}

function _highlightRow(state, busKey, value) {
  const table = state.table;
  if (!table) return;
  try {
    table.getRows().forEach(r => r.getElement()?.classList.remove('mys-row-selected'));
    const row = table.getRows().find(r => r.getData()[busKey] == value);
    if (row) {
      row.getElement()?.classList.add('mys-row-selected');
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
  if (!object) return t('app.mys.table');
  return object.obj_name || object.obj_title || object.name || object.title
      || t('app.mys.object_n.@', { id: object.obj_id ?? '' }).trim();
}

function _destroyInstance(bodyEl) {
  const s = bodyEl?.[STATE_KEY];
  if (!s) return;
  try { s.table?.destroy?.(); } catch {}
  try { delete bodyEl[STATE_KEY]; } catch {}
}
