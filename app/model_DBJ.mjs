// model_DBJ.mjs
// JSON data viewer — dati da mod_spec.data.records, layout Tabulator
//
// App Bus:
//   emette selection:change al click riga (se mod_spec.busKey configurato)
//   riceve  data:refresh    → ricarica mod_spec da api/mod_spec_tool.php
//   riceve  selection:change → evidenzia la riga corrispondente
//
// Flow embedded (Contesto 3, DBS/DBJ/*): stato minimo su bodyEl[STATE_KEY],
// affiancato (non sostituito) a bodyEl.__tabulator/__modSpec storici — vedi
// DBJ_sub_modules/DBJ-flow-runner.mjs.

import { appBusOn, appBusEmit } from "./app-bus.mjs";
import { dbjLoadFlows } from "./DBJ_sub_modules/DBJ-flow-runner.mjs";
import { t, te } from "./shared/i18n.mjs";

const STATE_KEY = "__DBJ_STATE__";

function getObjectDisplayName(object) {
  if (!object) return t("app.dbj.object.@");
  return (
    object.obj_name ||
    object.obj_title ||
    object.name ||
    object.title ||
    t("app.dbj.object_n.@", { id: object.obj_id ?? "" }).trim()
  );
}

export default {
  /**
   * Render the body content for the selected object.
   * This default implementation:
   * - shows object summary
   * - lists models filtered by mod_obj_id (if available) or shows all models
   * - provides a placeholder "viewer area"
   */
  async renderBody({ bodyEl, object, models, cmdUI, signal }) {
    const spec = parseModSpec(models[0]?.mod_spec);

      if (!spec) {
        bodyEl.textContent = t("app.dbj.no_spec");
        return null;
      }

      const data  = Array.isArray(spec?.data?.records) ? spec.data.records : [];
      const modId = models[0]?.mod_id ?? null;

      // IMPORTANTISSIMO: il container deve avere un'altezza reale,
      // altrimenti 100% non significa nulla.
      // Qui vincoliamo l'host a non espandere il container.
      const tableHost = document.createElement("div");
      tableHost.className = "tabulator-host";
      tableHost.style.width = "100%";
      tableHost.style.height = "100%";
      tableHost.style.overflow = "hidden";
      bodyEl.appendChild(tableHost);

      const TabulatorCtor =
        (typeof Tabulator !== "undefined") ? Tabulator :
        (window?.Tabulator ? window.Tabulator : null);

      if (!TabulatorCtor) {
        tableHost.textContent = t("app.dbj.no_tabulator");
        return null;
      }

      const tabColumns = specToTabulatorColumns(spec, data);

      const table = new TabulatorCtor(tableHost, {
        data,
        columns: tabColumns,

        layout: "fitColumns",
        height: "100%",
        placeholder: t("app.dbj.no_records"),

        // paginazione: niente selector, solo pagine
        pagination: "local",
        paginationSize: 10,          // valore iniziale, poi lo ricalcoliamo
        paginationCounter: "rows",

        movableColumns: true,
        resizableColumnFit: true,
      });

      // ---- Auto page size: al build e dopo ogni render ----
      // (alcune versioni usano eventi leggermente diversi; questi due coprono quasi tutto)
      if (typeof table.on === "function") {
        table.on("tableBuilt", () => autoFitPageSize(table, bodyEl));
        table.on("renderComplete", () => autoFitPageSize(table, bodyEl));
      }

      // Bind evento in modo esplicito — più affidabile del config "rowClick"
      // passato al costruttore (vedi ui/modal_objmod_links.js per lo stesso
      // pattern, con lo stesso commento, già verificato altrove nel progetto).
      table.on("rowClick", (e, row) => {
        _onRowClick(row.getData(), bodyEl.__modSpec, object, cmdUI, bodyEl[STATE_KEY]);
      });

      // ResizeObserver: quando il container cambia altezza -> ricalcola page size
      let raf = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          autoFitPageSize(table, bodyEl);
          try { table.redraw(true); } catch {}
        });
      });
      ro.observe(bodyEl);

      bodyEl.__tabulatorResizeObserver = ro;
      bodyEl.__tabulator = table;
      bodyEl.__modSpec = spec;

      // Stato minimo per i flow embedded (Contesto 3, DBS/DBJ/*) — affianca
      // bodyEl.__tabulator/__modSpec, non li sostituisce. spec è un getter
      // lazy: _reloadData() riassegna bodyEl.__modSpec, non questo state.
      const state = {
        bodyEl, object, cmdUI, table,
        mod_id:       modId,
        selectedRow:  null,
        localEvents:  new EventTarget(),
        get spec()    { return bodyEl.__modSpec; },
        refresh:      () => _reloadData(modId, table, bodyEl, signal),
        getRecords:   () => (bodyEl.__modSpec?.data?.records ?? []),
      };
      bodyEl[STATE_KEY] = state;

      // Primo fit (nel caso gli eventi arrivino tardi)
      requestAnimationFrame(() => autoFitPageSize(table, bodyEl));

      // Flow embedded (Contesto 3): unico canale per costruire logica reattiva
      // ai record/selezione di questo pannello — stesso principio di MPS/OSD/TJS.
      await dbjLoadFlows(state, object, signal);

      // ── App Bus: receiver ────────────────────────────────────────────────

      appBusOn('data:refresh', msg => {
        if (!_shouldHandleMsg(msg, object)) return;
        _reloadData(modId, table, bodyEl, signal);
      }, signal);

      appBusOn('selection:change', msg => {
        if (!_shouldHandleMsg(msg, object)) return;
        const busKey = bodyEl.__modSpec?.busKey;
        const value  = msg.payload?.value;
        if (!busKey || value === undefined) return;
        _highlightRow(table, busKey, value);
      }, signal);

      signal?.addEventListener('abort', () => {
        ro.disconnect();
        try { table.destroy(); } catch {}
        delete bodyEl.__tabulatorResizeObserver;
        delete bodyEl.__tabulator;
        delete bodyEl.__modSpec;
        delete bodyEl.__tabulatorPageSize;
        delete bodyEl[STATE_KEY];
      }, { once: true });

      return table;
  },

  /**
   * Left menu:
   * title is forced by template, but we still return something sane.
   */
  getLeftMenu({ object }) {
    return {
      title: getObjectDisplayName(object),
      items: [],
    };
  },

  getRightMenu() {
    return { title: '☰', items: [] };
  },

  destroy() {},
};

/* =======================
   App Bus
   ======================= */

function _shouldHandleMsg(msg, object) {
  const p = msg?.payload ?? {};
  if (p.sourceApp === 'DBJ') return false; // evita loop sulla propria emissione
  if (p.targetApp && p.targetApp !== 'DBJ') return false;
  if (p.targetObjId != null && Number(p.targetObjId) !== Number(object?.obj_id)) return false;
  return true;
}

function _onRowClick(rowData, spec, object, cmdUI, state) {
  // Sorgente locale per DBS/DBJ/Events/OnRowSelected — indipendente dall'App
  // Bus, sempre valorizzata (a differenza dell'emissione selection:change
  // sotto, che richiede mod_spec.busKey configurato). Stesso criterio di
  // MPS (_emitMarkerSelection in model_MPS.mjs).
  if (state) {
    state.selectedRow = rowData;
    state.localEvents?.dispatchEvent(new CustomEvent('rowSelected', { detail: rowData }));
  }

  const busKey = spec?.busKey;
  if (!busKey) {
    cmdUI?.update?.({ status: te('app.dbj.no_buskey') });
    console.warn('[DBJ] mod_spec.busKey mancante: selection:change non emesso.');
    return;
  }
  if (!rowData || !(busKey in rowData)) {
    cmdUI?.update?.({ status: te('app.dbj.buskey_missing', { key: busKey }) });
    console.warn('[DBJ] busKey non presente nel record:', busKey, rowData);
    return;
  }
  appBusEmit('selection:change', {
    objId:     object?.obj_id ?? null,
    sourceApp: 'DBJ',
    field:     busKey,
    value:     rowData[busKey],
    row:       rowData,
  });
}

function _highlightRow(table, busKey, value) {
  if (!table) return;
  try {
    table.getRows().forEach(r => r.getElement()?.classList.remove('dbj-row-selected'));
    const row = table.getRows().find(r => r.getData()[busKey] == value);
    if (row) {
      row.getElement()?.classList.add('dbj-row-selected');
      row.scrollTo();
    }
  } catch { /* silenzioso */ }
}

// Ricarica mod_spec dal server (un altro pannello/flow può averlo modificato)
// e riallinea colonne + dati della griglia.
async function _reloadData(modId, table, bodyEl, signal) {
  if (!modId || !table) return;
  try {
    const resp = await fetch(`api/mod_spec_tool.php?action=load&mod_id=${modId}`, { signal });
    const json = await resp.json();
    if (!json?.ok) return;
    const spec = parseModSpec(json.data?.mod_spec);
    if (!spec) return;
    const data = Array.isArray(spec?.data?.records) ? spec.data.records : [];
    table.setColumns(specToTabulatorColumns(spec, data));
    await table.setData(data);
    bodyEl.__modSpec = spec;
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') return;
    console.warn('[DBJ] data:refresh reload error:', e);
  }
}

function parseModSpec(modSpecRaw) {
  if (!modSpecRaw) return null;
  if (typeof modSpecRaw === "object") return modSpecRaw;

  if (typeof modSpecRaw === "string") {
    const s = modSpecRaw.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch (e) {
      throw new Error(t("app.dbj.spec_invalid", { msg: e.message }));
    }
  }
  return null;
}

function specToTabulatorColumns(spec, records) {
  const specColumns = Array.isArray(spec?.view?.columns) ? spec.view.columns : [];

  if (specColumns.length > 0) {
    return specColumns.map((c) => {
      const field = c.field;
      const title = c.caption ?? c.field ?? "";
      const mode = (c.mode ?? "rw").toLowerCase();

      const col = {
        title,
        field,
        editable: mode === "rw",
        headerSort: true,
      };

      // width opzionale (numero px o stringa, es. "20%")
      if (c.width !== undefined && c.width !== null && c.width !== "") {
        col.width = c.width;
      }

      return col;
    });
  }

  if (records?.length) {
    return Object.keys(records[0]).map((k) => ({
      title: k,
      field: k,
      editable: false,
      headerSort: true,
    }));
  }
  return [];
}

/**
 * Calcola quante righe stanno nello spazio visibile e imposta la page size.
 * - sottrae header e footer (paginatore)
 * - misura l'altezza di una riga reale se possibile
 */
function autoFitPageSize(table, containerEl) {
  const root = table?.element; // elemento Tabulator
  if (!root || !containerEl) return;

  const containerH = containerEl.clientHeight;
  if (!containerH || containerH < 50) return;

  const headerEl = root.querySelector(".tabulator-header");
  const footerEl = root.querySelector(".tabulator-footer"); // paginatore
  const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
  const footerH = footerEl ? footerEl.getBoundingClientRect().height : 0;

  // spazio per le righe (body)
  const available = Math.max(0, containerH - headerH - footerH);

  // misura riga: prendi la prima riga renderizzata se c'è
  let rowH = 0;
  const firstRow = root.querySelector(".tabulator-row");
  if (firstRow) rowH = firstRow.getBoundingClientRect().height;

  // fallback prudente se non ancora renderizzato
  if (!rowH || rowH < 10) rowH = 28;

  // quante righe ci stanno (almeno 1)
  const pageSize = Math.max(1, Math.floor(available / rowH));

  // evita loop inutili
  if (containerEl.__tabulatorPageSize !== pageSize) {
    containerEl.__tabulatorPageSize = pageSize;
    if (typeof table.setPageSize === "function") {
      table.setPageSize(pageSize);
    }
  }
}