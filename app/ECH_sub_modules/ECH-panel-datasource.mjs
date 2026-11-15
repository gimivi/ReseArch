// ECH_sub_modules/ECH-panel-datasource.mjs
// Pannello modale Bootstrap per configurare mod_spec.dataSource.
//
// Uso:
//   import { openDataSourcePanel } from "./ECH_sub_modules/ECH-panel-datasource.mjs";
//   openDataSourcePanel(currentModSpec, async (updatedModSpec) => {
//       // salva su DB + ridisegna
//   });

import { t, te } from "../shared/i18n.mjs";

const MODAL_ID = "echDatasourceModal";

// ============================================================
// ENTRY POINT
// ============================================================

/**
 * Apre il pannello di configurazione della sorgente dati.
 * @param {object}   modSpec  - mod_spec corrente (letto da state)
 * @param {function} onSave   - callback async(updatedModSpec) chiamata al salvataggio
 */
export function openDataSourcePanel(modSpec, onSave) {
    ensureModal();

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById(MODAL_ID));
    populateForm(modSpec);

    // Rimuove handler precedenti
    const saveBtn = document.getElementById(`${MODAL_ID}-save`);
    const newSave = saveBtn.cloneNode(true);
    saveBtn.replaceWith(newSave);

    newSave.addEventListener("click", async () => {
        const updated = collectForm(modSpec);
        if (!updated) return;                      // validazione fallita
        modal.hide();
        await onSave(updated);
    });

    modal.show();
}

// ============================================================
// CREAZIONE MODALE (una sola volta)
// ============================================================

function ensureModal() {
    if (document.getElementById(MODAL_ID)) return;

    const div = document.createElement("div");
    div.innerHTML = `
<div class="modal fade" id="${MODAL_ID}" tabindex="-1" aria-labelledby="${MODAL_ID}-title" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-scrollable">
    <div class="modal-content bg-body text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="${MODAL_ID}-title">${te("app.ech.ds.title")}</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${te("common.close")}"></button>
      </div>

      <div class="modal-body">

        <!-- Tipo sorgente -->
        <div class="mb-3">
          <label class="form-label fw-semibold" for="${MODAL_ID}-type">${te("app.ech.ds.type")}</label>
          <select class="form-select" id="${MODAL_ID}-type">
            <option value="mysql">${te("app.ech.ds.type_mysql")}</option>
            <option value="json">${te("app.ech.ds.type_json")}</option>
            <option value="csv_url">${te("app.ech.ds.type_csv")}</option>
          </select>
        </div>

        <!-- Sezione MySQL -->
        <div id="${MODAL_ID}-sec-mysql">
          <div class="mb-3">
            <label class="form-label fw-semibold" for="${MODAL_ID}-sql">${te("app.ech.ds.sql")} <span class="text-muted">${te("app.ech.ds.sql_only_select")}</span></label>
            <textarea class="form-control font-monospace" id="${MODAL_ID}-sql" rows="5"
              placeholder="SELECT categoria, SUM(valore) AS totale FROM mia_tabella GROUP BY categoria"></textarea>
            <div class="form-text text-warning-emphasis">${te("app.ech.ds.sql_admin")}</div>
          </div>
        </div>

        <!-- Sezione JSON -->
        <div id="${MODAL_ID}-sec-json" style="display:none">
          <div class="mb-3">
            <label class="form-label fw-semibold" for="${MODAL_ID}-json-url">${te("app.ech.ds.json_url")}</label>
            <input type="text" class="form-control" id="${MODAL_ID}-json-url"
              placeholder="${te("app.ech.ds.json_url_ph")}">
          </div>
          <div class="mb-3">
            <label class="form-label fw-semibold" for="${MODAL_ID}-json-inline">${te("app.ech.ds.json_inline")} <span class="text-muted">${te("app.ech.ds.json_inline_note")}</span></label>
            <textarea class="form-control font-monospace" id="${MODAL_ID}-json-inline" rows="5"
              placeholder='[{"category":"A","value":10}, {"category":"B","value":20}]'></textarea>
          </div>
        </div>

        <!-- Sezione CSV URL -->
        <div id="${MODAL_ID}-sec-csv" style="display:none">
          <div class="mb-3">
            <label class="form-label fw-semibold" for="${MODAL_ID}-csv-url">${te("app.ech.ds.csv_url")}</label>
            <input type="text" class="form-control" id="${MODAL_ID}-csv-url"
              placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=0">
          </div>
          <div class="row g-2 mb-3">
            <div class="col-4">
              <label class="form-label" for="${MODAL_ID}-csv-delim">${te("app.ech.ds.delimiter")}</label>
              <input type="text" class="form-control" id="${MODAL_ID}-csv-delim" value="," maxlength="2">
            </div>
            <div class="col-8 d-flex align-items-end pb-1">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="${MODAL_ID}-csv-header" checked>
                <label class="form-check-label" for="${MODAL_ID}-csv-header">${te("app.ech.ds.first_row_header")}</label>
              </div>
            </div>
          </div>
        </div>

        <!-- Mapping -->
        <hr>
        <div class="mb-1">
          <label class="form-label fw-semibold" for="${MODAL_ID}-mapping">${te("app.ech.ds.mapping")}
            <span class="text-muted small ms-2">
              ${te("app.ech.ds.mapping_format")}
            </span>
          </label>
          <textarea class="form-control font-monospace" id="${MODAL_ID}-mapping" rows="4"
            placeholder='{ "category": "mese", "value": "totale", "series": "tipo" }'></textarea>
          <div class="form-text">
            ${te("app.ech.ds.mapping_common")} <code>category</code>, <code>value</code>, <code>series</code>,
            <code>name</code>, <code>x</code>, <code>y</code>, <code>indicator</code>,
            <code>source</code>, <code>target</code>.
            ${te("app.ech.ds.mapping_indexes")} <code>"category": 0, "value": 1</code>.
          </div>
        </div>

      </div><!-- /modal-body -->

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${te("common.cancel")}</button>
        <button type="button" class="btn btn-primary" id="${MODAL_ID}-save">${te("app.ech.save_refresh")}</button>
      </div>

    </div>
  </div>
</div>`;
    document.body.appendChild(div.firstElementChild);

    // Aggiorna visibilità sezioni al cambio tipo
    document.getElementById(`${MODAL_ID}-type`).addEventListener("change", updateSections);
}

// ============================================================
// POPULATE / COLLECT
// ============================================================

function populateForm(modSpec) {
    const ds = modSpec?.dataSource ?? {};
    const type = ds.type ?? "mysql";

    setVal(`${MODAL_ID}-type`,        type);
    setVal(`${MODAL_ID}-sql`,         ds.sql    ?? "");
    setVal(`${MODAL_ID}-json-url`,    ds.url    ?? "");
    setVal(`${MODAL_ID}-json-inline`, ds.inline ? JSON.stringify(ds.inline, null, 2) : "");
    setVal(`${MODAL_ID}-csv-url`,     ds.url    ?? "");
    setVal(`${MODAL_ID}-csv-delim`,   ds.delimiter ?? ",");

    const headerEl = document.getElementById(`${MODAL_ID}-csv-header`);
    if (headerEl) headerEl.checked = ds.hasHeader !== false;

    const mapping = ds.mapping ?? {};
    setVal(`${MODAL_ID}-mapping`, Object.keys(mapping).length > 0
        ? JSON.stringify(mapping, null, 2)
        : "");

    updateSections();
}

function collectForm(modSpec) {
    const type = getVal(`${MODAL_ID}-type`);

    // Mapping
    const mappingRaw = getVal(`${MODAL_ID}-mapping`).trim();
    let mapping = {};
    if (mappingRaw) {
        try { mapping = JSON.parse(mappingRaw); }
        catch { alert(t("app.ech.ds.err_mapping_json")); return null; }
    }

    let dataSource = { type, mapping };

    if (type === "mysql") {
        const sql = getVal(`${MODAL_ID}-sql`).trim();
        if (!sql) { alert(t("app.ech.ds.err_sql_required")); return null; }
        dataSource.sql = sql;

    } else if (type === "json") {
        const url    = getVal(`${MODAL_ID}-json-url`).trim();
        const inline = getVal(`${MODAL_ID}-json-inline`).trim();
        if (url) {
            dataSource.url = url;
        } else if (inline) {
            try { dataSource.inline = JSON.parse(inline); }
            catch { alert(t("app.ech.ds.err_inline_json")); return null; }
        } else {
            alert(t("app.ech.ds.err_url_or_inline")); return null;
        }

    } else if (type === "csv_url") {
        const url = getVal(`${MODAL_ID}-csv-url`).trim();
        if (!url) { alert(t("app.ech.ds.err_csv_url_required")); return null; }
        dataSource.url       = url;
        dataSource.delimiter = getVal(`${MODAL_ID}-csv-delim`) || ",";
        dataSource.hasHeader = document.getElementById(`${MODAL_ID}-csv-header`)?.checked ?? true;
    }

    return { ...modSpec, dataSource };
}

// ============================================================
// UI HELPERS
// ============================================================

function updateSections() {
    const type = getVal(`${MODAL_ID}-type`);
    toggle(`${MODAL_ID}-sec-mysql`, type === "mysql");
    toggle(`${MODAL_ID}-sec-json`,  type === "json");
    toggle(`${MODAL_ID}-sec-csv`,   type === "csv_url");
}

function toggle(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? "" : "none";
}
function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val ?? "";
}
function getVal(id) {
    return document.getElementById(id)?.value ?? "";
}
