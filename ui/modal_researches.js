// ui/modal_researches.js
// Richiede global: Tabulator, Bootstrap (Modal), user (array con id e user_type)

(function () {
  "use strict";

  const modalEl = document.getElementById("modalResearches");
  const tableEl = document.getElementById("researchesTable");
  const btnAdd = document.getElementById("btnResearchAdd");
  const btnDel = document.getElementById("btnResearchDelete");

  const modalLongEl = document.getElementById("modalLongTextEditor");
  const longTitleEl = document.getElementById("longTextTitle");
  const longValueEl = document.getElementById("longTextValue");
  const longHintEl  = document.getElementById("longTextHint");
  const btnLongSave = document.getElementById("btnLongTextSave");

  const modalCreateEl = document.getElementById("modalResearchCreate");
  const btnCreate = document.getElementById("btnCreateResearch");
  const newErrEl = document.getElementById("newResError");

  if (!modalEl || !tableEl) return;

  const API_URL = "ui/modal_researches_tools.php";

  let table = null;

  let longEditCtx = null; // {row, field, title}

  function apiFetch(url, opts = {}) {
    return fetch(url, {
      credentials: "same-origin",
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    }).then(async (r) => {
      const data = await r.json().catch(() => null);
      if (!r.ok || !data) {
        const msg = (data && data.error) ? data.error : t("errors.server_status", { status: r.status });
        throw new Error(msg);
      }
      if (!data.success) throw new Error(data.error || t("errors.generic"));
      return data;
    });
  }

  // ===== Validazione folder_name client (max 30, no spazi, solo A-Z a-z 0-9 _) =====
  function normalizeFolderNameClient(name) {
    if (name == null) return "";
    name = String(name).trim();

    if (name === "") return null;
    if (/\s/.test(name)) return null;
    if (!/^[A-Za-z0-9_]{1,30}$/.test(name)) return null;

    const first = name.charAt(0);
    if (/[a-z]/.test(first)) {
      name = first.toUpperCase() + name.slice(1);
    }
    return name;
  }

  // ===== Formatter “preview” con ellissi + tooltip =====
  function previewFormatter(cell) {
    const v = cell.getValue();
    if (v == null) return "";
    const s = String(v);
    const max = 60;
    const short = s.length > max ? (s.slice(0, max) + "…") : s;
    // div con ellissi via CSS inline
    return `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(short)}</div>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function tooltipFull(cell) {
    const v = cell.getValue();
    if (v == null || v === "") return "";
    return String(v);
  }

  function showLongEditor(row, field, title, hint) {
    longEditCtx = { row, field, title };
    longTitleEl.textContent = title || t("modal.researches.long.edit_text");
    longValueEl.value = row.getData()[field] ?? "";
    longHintEl.textContent = hint || "";
    new bootstrap.Modal(modalLongEl).show();
  }

  async function saveRowUpdate(row) {
    const d = row.getData();

    // Normalizza folder_name (se presente)
    if (typeof d.res_folder_name === "string") {
      const norm = normalizeFolderNameClient(d.res_folder_name);
      if (norm === null) throw new Error(t("modal.researches.err.folder_invalid.@"));
      if (norm !== d.res_folder_name) {
        await row.update({ res_folder_name: norm });
      }
    }

    await apiFetch(API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "update",
        res_id: d.res_id,
        res_folder_name: d.res_folder_name,
        res_year: d.res_year ?? "",
        res_title: d.res_title ?? "",
        res_subtitle: d.res_subtitle ?? "",
        res_abstract: d.res_abstract ?? "",
        res_caption: d.res_caption ?? "",
        res_show: Number(d.res_show ?? 0),
      }),
    });
  }

  function initTable() {
    table = new Tabulator(tableEl, {
      layout: "fitColumns",
      height: "60vh",
      placeholder: t("researches.none.@"),
      reactiveData: true,
      selectable: 1,

      ajaxURL: `${API_URL}?action=list`,
      ajaxResponse: function (url, params, response) {
        return response.data || [];
      },

      rowSelectionChanged: function (data, rows) {
        btnDel.disabled = !(rows && rows.length === 1);
      },

      columns: [
        // res_id non editabile
        { title: t("common.id"), field: "res_id", width: 50, hozAlign: "right", headerSort: true },

        // res_folder_name: editor input, validazione
        {
          title: t("common.folder"),
          field: "res_folder_name",
          editor: "input",
          validator: [
            { type: "required" },
            {
              type: function (cell, value) {
                return normalizeFolderNameClient(value) !== null;
              },
            },
          ],
          tooltip: tooltipFull,
          cellEdited: async function (cell) {
            const row = cell.getRow();
            try {
              await saveRowUpdate(row);
            } catch (e) {
              alert(e.message);
              cell.restoreOldValue();
            }
          },
        },

        { title: t("modal.researches.col.year"), field: "res_year", editor: "input", width: 70, headerSort: true,
          validator: [
            {
              type: function (cell, value) {
                if (value === "" || value == null) return true;
                const n = parseInt(value, 10);
                return /^\d{4}$/.test(String(value).trim()) && n >= 1900 && n <= 2200;
              },
            },
          ],
          cellEdited: async function (cell) {
            const row = cell.getRow();
            try { await saveRowUpdate(row); }
            catch (e) { alert(e.message); cell.restoreOldValue(); }
          }
        },

        { title: t("common.title"), field: "res_title", editor: "input", headerSort: true,
          tooltip: tooltipFull,
          cellEdited: async function (cell) {
            const row = cell.getRow();
            try { await saveRowUpdate(row); }
            catch (e) { alert(e.message); cell.restoreOldValue(); }
          }
        },

        // Campi lunghi: preview + tooltip; click apre modale editor
        {
          title: t("common.subtitle"),
          field: "res_subtitle",
          formatter: previewFormatter,
          tooltip: tooltipFull,
          cellClick: function (e, cell) {
            const row = cell.getRow();
            showLongEditor(
              row,
              "res_subtitle",
              t("modal.researches.long.edit_subtitle"),
              t("modal.researches.long.hint_subtitle")
            );
          },
        },

        {
          title: t("modal.researches.col.abstract"),
          field: "res_abstract",
          formatter: previewFormatter,
          tooltip: tooltipFull,
          cellClick: function (e, cell) {
            const row = cell.getRow();
            showLongEditor(row, "res_abstract", t("modal.researches.long.edit_abstract"), t("modal.researches.long.hint_multiline"));
          },
        },

        {
          title: t("modal.researches.col.caption"),
          field: "res_caption",
          formatter: previewFormatter,
          tooltip: tooltipFull,
          cellClick: function (e, cell) {
            const row = cell.getRow();
            showLongEditor(row, "res_caption", t("modal.researches.long.edit_caption"), t("modal.researches.long.hint_multiline"));
          },
        },

        // res_show: list editor
        {
          title: t("common.visibility"),
          field: "res_show",
          width: 100,
          editor: "list",
          editorParams: {
            // Scala unica 0-4 (_doc/arch-permessi.md §11.5)
            values: [
              { label: t("modal.researches.show.private"), value: 0 },
              { label: t("modal.researches.show.workgroup"), value: 1 },
              { label: t("visibility.research.@"), value: 2 },
              { label: t("modal.researches.show.dissemination"), value: 3 },
              { label: t("modal.researches.show.public"), value: 4 },
              { label: t("modal.researches.show.guests"), value: 5 },
            ],
          },
          formatter: function (cell) {
            const v = Number(cell.getValue());
            if (v === 0) return te("modal.researches.show.private");
            if (v === 1) return te("modal.researches.show.workgroup");
            if (v === 2) return te("visibility.research.@");
            if (v === 3) return te("modal.researches.show.dissemination");
            if (v === 4) return te("modal.researches.show.public");
            if (v === 5) return te("modal.researches.show.guests");
            return String(cell.getValue() ?? "");
          },
          cellEdited: async function (cell) {
            const row = cell.getRow();
            try { await saveRowUpdate(row); }
            catch (e) { alert(e.message); cell.restoreOldValue(); }
          },
        },

        // Campi derivati utili (non editabili): PI / Investigators (già calcolati in tools? al momento list ritorna solo res_perm+folder)
        // Se vuoi mostrarli, possiamo estendere list per includerli come in researches.php.
        { title: t("modal.researches.col.perm"), field: "res_perm", width: 50, headerSort: true },
      ],
    });
  }

  // ===== Long text save =====
  btnLongSave.addEventListener("click", async function () {
    if (!longEditCtx) return;
    const { row, field } = longEditCtx;

    try {
      await row.update({ [field]: longValueEl.value });
      await saveRowUpdate(row);
      bootstrap.Modal.getInstance(modalLongEl)?.hide();
    } catch (e) {
      alert(e.message);
    }
  });

  // ===== Create flow =====
  function resetCreateForm() {
    newErrEl.classList.add("d-none");
    newErrEl.textContent = "";

    document.getElementById("newResFolderName").value = "";
    document.getElementById("newResShow").value = "1";
    document.getElementById("newResTitle").value = "";
    document.getElementById("newResYear").value = "";
    document.getElementById("newResSubtitle").value = "";
    document.getElementById("newResAbstract").value = "";
    document.getElementById("newResCaption").value = "";
  }

  btnAdd.addEventListener("click", function () {
    resetCreateForm();
    new bootstrap.Modal(modalCreateEl).show();
  });

  btnCreate.addEventListener("click", async function () {
    const folderRaw = document.getElementById("newResFolderName").value;
    const folder = normalizeFolderNameClient(folderRaw);
    const res_show = Number(document.getElementById("newResShow").value);
    const res_title = document.getElementById("newResTitle").value || "";
    const res_year = document.getElementById("newResYear").value || "";
    const res_subtitle = document.getElementById("newResSubtitle").value || "";
    const res_abstract = document.getElementById("newResAbstract").value || "";
    const res_caption = document.getElementById("newResCaption").value || "";

    if (folder === null) {
      newErrEl.textContent = t("modal.researches.err.folder_invalid.@");
      newErrEl.classList.remove("d-none");
      return;
    }
    if (res_year && (!/^\d{4}$/.test(res_year.trim()) || parseInt(res_year, 10) < 1900 || parseInt(res_year, 10) > 2200)) {
      newErrEl.textContent = t("modal.researches.err.year_invalid");
      newErrEl.classList.remove("d-none");
      return;
    }

    if (!res_title.trim()) {
      newErrEl.textContent = t("modal.researches.err.title_required");
      newErrEl.classList.remove("d-none");
      return;
    }

    try {
      const res = await apiFetch(API_URL, {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          res_folder_name: folder,
          res_show,
          res_title,
          res_year,
          res_subtitle,
          res_abstract,
          res_caption,
        }),
      });

      // aggiungi record e seleziona
      if (table) {
        table.addData([res.data], true);
        table.selectRow(res.data.res_id);
      }

      bootstrap.Modal.getInstance(modalCreateEl)?.hide();
    } catch (e) {
      newErrEl.textContent = e.message;
      newErrEl.classList.remove("d-none");
    }
  });

  // ===== Delete flow =====
  btnDel.addEventListener("click", async function () {
    if (!table) return;
    const rows = table.getSelectedRows();
    if (!rows || rows.length !== 1) return;

    const row = rows[0];
    const d = row.getData();
    const ok = confirm(t("modal.researches.confirm_delete.@", { title: d.res_title ?? "" }));
    if (!ok) return;

    try {
      await apiFetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "delete", res_id: d.res_id }),
      });
      row.delete();
      btnDel.disabled = true;
    } catch (e) {
      alert(e.message);
    }
  });

  // Bootstrap show event (inizializza o ricarica)
  modalEl.addEventListener("shown.bs.modal", function () {
    if (!table) initTable();
    else table.setData(`${API_URL}?action=list`);
  });

})();
