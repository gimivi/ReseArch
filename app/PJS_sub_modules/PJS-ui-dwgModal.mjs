// APP/PJS_sub_modules/PJS-ui-dwgModal.mjs
import { listDrawings, loadDrawing, newDrawing, deleteDrawing, updateMeta, duplicateDrawing } from "./PJS-storage-api.mjs";
import { t, te, formatDate } from "../shared/i18n.mjs";
import { panelLevel } from "../shared/ui_level.mjs";

function fmtDT(s) { return s ?? ""; }

// Etichette dei livelli di visibilità (chiavi comuni visibility.*)
const VIS_KEYS = ["visibility.author.@", "visibility.workgroup", "visibility.research.@", "visibility.dissemination", "visibility.public", "visibility.guests"];
const visLabel = (v) => (VIS_KEYS[Number(v)] ? t(VIS_KEYS[Number(v)]) : "");
const visOptions = (max) => VIS_KEYS.slice(0, max + 1).map((k, i) => ({ label: t(k), value: i }));



export async function openDrawingsModal({ panel, headerEl, bodyEl, mod_id, makeTemplateEnvelope, onOpen, signal, footer }) {
  // footer: { setStatus,setHints,setControls }

  footer?.setStatus?.(t("app.pjs.dwg.listing"));
  // Livello del pannello (_doc/arch-permessi.md §11.4): sotto 30 niente crea/elimina/duplica/modifica metadati
  const j = await listDrawings({ mod_id, signal });
  // can_create dal server (api/pjs.php): modifica il modello o un oggetto del WP a cui è collegato
  const canEdit = panelLevel(bodyEl) >= 30 && j.can_create !== false;
  const currentUserId = j.current_user_id;
  const rows = j.data || [];

  // --- Modale base (usa la tua infrastruttura modale; qui creo una modale semplice) ---
  const modal = document.createElement("div");
  modal.className = "modal fade show";
  modal.style.display = "block";
  modal.tabIndex = -1;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "pjsDwgTitle");
  modal.innerHTML = `
    <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
      <div class="modal-content bg-body text-body">
        <div class="modal-header">
          <h5 class="modal-title" id="pjsDwgTitle">${te("app.pjs.dwg.modal_title", { id: mod_id })}</h5>
          <button type="button" class="btn-close" aria-label="${te("common.close")}"></button>
        </div>
        <div class="modal-body">
          <div class="d-flex gap-2 mb-2 align-items-center">
            ${canEdit ? `<button class="btn btn-sm btn-primary" id="btnNew">${te("common.new")}</button>` : ""}
            <button class="btn btn-sm btn-secondary" id="btnOpen" disabled>${te("common.open")}</button>
            ${canEdit ? `<button class="btn btn-sm btn-danger" id="btnDelete" disabled>${te("common.delete")}</button>` : ""}
            ${canEdit ? `<button class="btn btn-sm btn-outline-secondary" id="btnDup" disabled>${te("common.duplicate")}</button>` : ""}
            <div class="ms-auto">
              <input class="form-control form-control-sm" id="txtFilter" placeholder="${te("app.pjs.dwg.filter_ph")}" aria-label="${te("common.filter")}">
            </div>
          </div>
          <div id="tabDwg"></div>
          <div class="small text-muted mt-2" id="lblInfo" role="status"></div>
        </div>
      </div>
    </div>
  `;
  // Finestra costruita a mano (non bootstrap.Modal): fuoco, Esc e ritorno del fuoco li gestisce
  // questo modulo (WCAG 2.1.1 / 2.4.3, fase 7 di _doc/arch-i18n-a11y.md).
  const opener = document.activeElement;
  document.body.appendChild(modal);

  const onKey = (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
    if (ev.key !== "Tab") return;
    // il Tab resta dentro la finestra
    const f = [...modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus(); }
    else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
  };
  modal.addEventListener("keydown", onKey);

  const close = () => {
    modal.remove();
    footer?.setStatus?.(t("app.pjs.dwg.ready"));
    if (opener?.isConnected) opener.focus();
  };
  modal.querySelector(".btn-close").addEventListener("click", close);
  modal.querySelector(".btn-close").focus();

  const info = modal.querySelector("#lblInfo");
  const tabEl = modal.querySelector("#tabDwg");

  // Tabulator globale già presente nel tuo ambiente
  const table = new Tabulator(tabEl, {
    data: rows,
    layout: "fitColumns",
    height: "60vh",
    selectable: 1,
    initialSort: [{ column: "dwg_time_last", dir: "desc" }],
    columns: [
      { title: t("common.name"), field: "dwg_name", editor: canEdit ? "input" : false, widthGrow: 2 },
      { title: t("app.pjs.dwg.col_version"), field: "dwg_version", editor: canEdit ? "input" : false, width: 110 },
      { title: t("common.description"), field: "dwg_description", editor: canEdit ? "input" : false, widthGrow: 3 },
      { title: t("app.pjs.dwg.col_last_name"), field: "author_last_name", headerSort: true, width: 140 },
      { title: t("app.pjs.dwg.col_first_name"), field: "author_first_name", headerSort: true, width: 140 },
      { title: t("app.pjs.dwg.col_last"), field: "dwg_time_last", formatter: (c)=>fmtDT(c.getValue()), width: 170 },
{
  title: t("app.pjs.dwg.col_show"),
  field: "dwg_show",
  editor: canEdit ? "list" : false,
  editorParams: {
    values: visOptions(5),
  },
  formatter: (cell) => visLabel(cell.getValue()),
  width: 150,
},

{
  title: t("app.pjs.dwg.col_share"),
  field: "dwg_share",
  editor: canEdit ? "list" : false,
  editorParams: {
    values: visOptions(3),
  },
  formatter: (cell) => visLabel(cell.getValue()),
  width: 150,
},
    ],
    rowFormatter: (row) => {
      const d = row.getData();
      const isOwner = d.dwg_author_id === currentUserId;
      row.getElement().style.opacity = isOwner ? "1" : "0.75";
    },
    cellEditing: (cell) => {
      const d = cell.getRow().getData();
      const isOwner = d.dwg_author_id === currentUserId;
      if (!isOwner || !canEdit) return false; // blocca edit se non owner o livello < 30
      return true;
    },
  });

  // filtro
  modal.querySelector("#txtFilter").addEventListener("input", (e) => {
    const v = e.target.value.trim().toLowerCase();
    if (!v) table.clearFilter(true);
    else {
      table.setFilter((data) => {
        return (
          String(data.dwg_name || "").toLowerCase().includes(v) ||
          String(data.dwg_description || "").toLowerCase().includes(v) ||
          String(data.author_first_name || "").toLowerCase().includes(v) ||
          String(data.author_last_name || "").toLowerCase().includes(v)
        );
      });
    }
  });

  let selected = null;
  const btnOpen = modal.querySelector("#btnOpen");
  const btnDel = modal.querySelector("#btnDelete");
  const btnDup = modal.querySelector("#btnDup");

  function refreshButtons() {
    if (!selected) {
      btnOpen.disabled = true;
    if (btnDel) btnDel.disabled = true;
    if (btnDup) btnDup.disabled = true;
      info.textContent = "";
      return;
    }
    const isOwner = selected.dwg_author_id === currentUserId;
    btnOpen.disabled = false;
    if (btnDup) btnDup.disabled = false;
    if (btnDel) btnDel.disabled = !isOwner;
    info.textContent = !canEdit ? "" : (isOwner ? t("app.pjs.dwg.info_owner") : t("app.pjs.dwg.info_other"));
  }

  table.on("rowClick", (e, row) => { selected = row.getData(); refreshButtons(); });
  table.on("rowDblClick", async () => { if (selected) await doOpen(); });

  // inline save immediato: updateMeta ad ogni cellEdited
  table.on("cellEdited", async (cell) => {
    const row = cell.getRow();
    const d = row.getData();
    const isOwner = d.dwg_author_id === currentUserId;
    if (!isOwner || !canEdit) return;

    const field = cell.getField();
    const patch = {};
    patch[field] = d[field];

    footer?.setStatus?.(t("app.pjs.dwg.meta_updating"));
    try {
      await updateMeta({ dwg_id: d.dwg_id, patch, signal });
      footer?.setStatus?.(t("app.pjs.dwg.meta_updated"));
    } catch (err) {
      footer?.setHints?.(t("app.pjs.dwg.meta_error", { msg: err.message }));
    }
  });

  async function doOpen() {
    footer?.setStatus?.(t("app.pjs.dwg.loading"));
    const r = await loadDrawing({ dwg_id: selected.dwg_id, signal });
    await onOpen?.(r.data, r.current_user_id);
    close();
  }

  btnOpen.addEventListener("click", doOpen);

  modal.querySelector("#btnNew")?.addEventListener("click", async () => {
    const now = new Date();
    const name = t("app.pjs.dwg.new_name", { date: formatDate(now, { dateStyle: "short", timeStyle: "medium" }) });
    const env = makeTemplateEnvelope({ mod_id });

    footer?.setStatus?.(t("app.pjs.dwg.creating"));
    const r = await newDrawing({
      mod_id,
      dwg_name: name,
      dwg_description: "",
      dwg_version: "v1",
      dwg_sce_json: env,
      dwg_show: 1,
      dwg_share: 1,
      signal
    });

    // apri subito
    const rr = await loadDrawing({ dwg_id: r.data.dwg_id, signal });
    await onOpen?.(rr.data, rr.current_user_id);
    close();
  });

  btnDel?.addEventListener("click", async () => {
    if (!selected) return;
    if (!confirm(t("app.pjs.dwg.confirm_delete", { name: selected.dwg_name }))) return;
    footer?.setStatus?.(t("app.pjs.dwg.deleting"));
    await deleteDrawing({ dwg_id: selected.dwg_id, signal });
    // refresh list
    const j2 = await listDrawings({ mod_id, signal });
    table.setData(j2.data || []);
    selected = null;
    refreshButtons();
    footer?.setStatus?.(t("common.deleted"));
  });

  btnDup?.addEventListener("click", async () => {
    if (!selected) return;
    const name = t("app.pjs.dwg.copy_name", { name: selected.dwg_name }).slice(0, 50);
    footer?.setStatus?.(t("app.pjs.dwg.duplicating"));
    const r = await duplicateDrawing({ dwg_id: selected.dwg_id, dwg_name: name, dwg_description: selected.dwg_description || "", signal });
    const rr = await loadDrawing({ dwg_id: r.data.dwg_id, signal });
    await onOpen?.(rr.data, rr.current_user_id);
    close();
  });

  refreshButtons();
}
