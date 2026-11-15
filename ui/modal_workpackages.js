// ui/modal_workpackages.js
// Richiede global: Tabulator, Bootstrap (Modal), user, research

(function () {
  "use strict";

  const t = window.t;

  const modalEl = document.getElementById("modalWorkpackages");
  const tableEl = document.getElementById("workpackagesTable");
  const btnAdd = document.getElementById("btnWpAdd");
  const btnDel = document.getElementById("btnWpDelete");

  const modalLongEl = document.getElementById("modalWpLongTextEditor");
  const longTitleEl = document.getElementById("wpLongTextTitle");
  const longValueEl = document.getElementById("wpLongTextValue");
  const longHintEl  = document.getElementById("wpLongTextHint");
  const btnLongSave = document.getElementById("btnWpLongTextSave");

  const modalCreateEl = document.getElementById("modalWpCreate");
  const btnCreate = document.getElementById("btnCreateWp");
  const newErrEl = document.getElementById("newWpError");

  if (!modalEl || !tableEl) return;

  const API_URL = "ui/modal_workpackages_tools.php";

  let table = null;
  let longEditCtx = null; // {row, field}

  const WP_SHOW_LABELS = {
    0: t("visibility.author.@"),
    1: t("visibility.workgroup"),
    2: t("visibility.research.@"),
    3: t("visibility.dissemination"),
    4: t("visibility.public"),
    5: t("visibility.guests"),
  };

  function apiFetch(opts = {}) {
    return fetch(API_URL, {
      credentials: "same-origin",
      method: opts.method || "POST",
      headers: { "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : null,
    }).then(async (r) => {
      const data = await r.json().catch(() => null);
      if (!r.ok || !data) throw new Error((data && data.error) || t("errors.server_status", { status: r.status }));
      if (!data.success) throw new Error(data.error || t("modal.workpackages.error.failed"));
      return data;
    });
  }

  function apiList() {
    const url = `${API_URL}?action=list`;
    return fetch(url, { credentials: "same-origin" })
      .then(r => r.json())
      .then(j => {
        if (!j || !j.success) throw new Error((j && j.error) || t("modal.workpackages.error.list"));
        return j.data || [];
      });
  }

  // folder_name: max 30, no spazi, solo A-Z a-z 0-9 _
  function normalizeFolderNameClient(name) {
    if (name == null) return "";
    name = String(name).trim();
    if (name === "") return null;
    if (/\s/.test(name)) return null;
    if (!/^[A-Za-z0-9_]{1,30}$/.test(name)) return null;

    const first = name.charAt(0);
    if (/[a-z]/.test(first)) name = first.toUpperCase() + name.slice(1);
    return name;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function previewFormatter(cell) {
    const v = cell.getValue();
    if (v == null) return "";
    const s = String(v);
    const max = 60;
    const short = s.length > max ? (s.slice(0, max) + "…") : s;
    return `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(short)}</div>`;
  }

  function tooltipFull(cell) {
    const v = cell.getValue();
    return (v == null || v === "") ? "" : String(v);
  }

  function showLongEditor(row, field, title, hint) {
    longEditCtx = { row, field };
    longTitleEl.textContent = title || t("modal.workpackages.long.title");
    longValueEl.value = row.getData()[field] ?? "";
    longHintEl.textContent = hint || "";
    new bootstrap.Modal(modalLongEl).show();
  }

  async function saveRowUpdate(row) {
    const d = row.getData();

    // normalize wp_folder_name
    if (typeof d.wp_folder_name === "string") {
      const norm = normalizeFolderNameClient(d.wp_folder_name);
      if (norm === null) throw new Error(t("modal.workpackages.error.folder_invalid.@"));
      if (norm !== d.wp_folder_name) await row.update({ wp_folder_name: norm });
    }

    await apiFetch({
      body: {
        action: "update",
        wp_id: d.wp_id,
        wp_folder_name: d.wp_folder_name,
        wp_title: d.wp_title ?? "",
        wp_subtitle: d.wp_subtitle ?? "",
        wp_abstract: d.wp_abstract ?? "",
        wp_caption: d.wp_caption ?? "",
        wp_ord: Number(d.wp_ord ?? 0),
        wp_show: Number(d.wp_show ?? 0),
        wp_share: Number(d.wp_share ?? 0),
      },
    });
  }

  function initTable() {
    table = new Tabulator(tableEl, {
      layout: "fitColumns",
      height: "60vh",
      placeholder: t("workpackages.none.@"),
      reactiveData: true,
      selectable: 1,

      columns: [
        { title: "wp_id", field: "wp_id", width: 90, hozAlign: "right", headerSort: true },

        {
          title: t("common.folder"),
          field: "wp_folder_name",
          editor: "input",
          validator: [
            { type: "required" },
            { type: (cell, value) => normalizeFolderNameClient(value) !== null },
          ],
          tooltip: tooltipFull,
          cellEdited: async (cell) => {
            try { await saveRowUpdate(cell.getRow()); }
            catch (e) { alert(e.message); cell.restoreOldValue(); }
          },
        },

        { title: t("common.order"), field: "wp_ord", width: 90, editor: "number", headerSort: true,
          cellEdited: async (cell) => {
            try { await saveRowUpdate(cell.getRow()); }
            catch (e) { alert(e.message); cell.restoreOldValue(); }
          }
        },

        {
          title: t("common.visibility"),
          field: "wp_show",
          width: 150,
          editor: "list",
          editorParams: {
            values: [
              { label: WP_SHOW_LABELS[0], value: 0 },
              { label: WP_SHOW_LABELS[1], value: 1 },
              { label: WP_SHOW_LABELS[2], value: 2 },
              { label: WP_SHOW_LABELS[3], value: 3 },
              { label: WP_SHOW_LABELS[4], value: 4 },
              { label: WP_SHOW_LABELS[5], value: 5 },
            ]
          },
          formatter: (cell) => WP_SHOW_LABELS[Number(cell.getValue())] ?? "",
          cellEdited: async (cell) => {
            try { await saveRowUpdate(cell.getRow()); }
            catch (e) { alert(e.message); cell.restoreOldValue(); }
          },
        },

        { title: t("common.title"), field: "wp_title", editor: "input", headerSort: true, tooltip: tooltipFull,
          cellEdited: async (cell) => {
            try { await saveRowUpdate(cell.getRow()); }
            catch (e) { alert(e.message); cell.restoreOldValue(); }
          }
        },

        {
          title: t("common.subtitle"),
          field: "wp_subtitle",
          formatter: previewFormatter,
          tooltip: tooltipFull,
          cellClick: (e, cell) => showLongEditor(cell.getRow(), "wp_subtitle", t("modal.workpackages.long.edit_subtitle"), t("modal.workpackages.long.hint")),
        },

        {
          title: t("modal.workpackages.col.abstract"),
          field: "wp_abstract",
          formatter: previewFormatter,
          tooltip: tooltipFull,
          cellClick: (e, cell) => showLongEditor(cell.getRow(), "wp_abstract", t("modal.workpackages.long.edit_abstract"), t("modal.workpackages.long.hint")),
        },

        {
          title: t("modal.workpackages.col.caption"),
          field: "wp_caption",
          formatter: previewFormatter,
          tooltip: tooltipFull,
          cellClick: (e, cell) => showLongEditor(cell.getRow(), "wp_caption", t("modal.workpackages.long.edit_caption"), t("modal.workpackages.long.hint")),
        },

        { title: "wp_perm", field: "wp_perm", width: 110, headerSort: true },
      ],

      rowSelectionChanged: (data, rows) => {
        btnDel.disabled = !(rows && rows.length === 1);
      },
    });
  }

  // Save long text
  btnLongSave?.addEventListener("click", async () => {
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

  function resetCreateForm() {
    newErrEl.classList.add("d-none");
    newErrEl.textContent = "";
    document.getElementById("newWpFolderName").value = "";
    document.getElementById("newWpTitle").value = "";
    document.getElementById("newWpSubtitle").value = "";
    document.getElementById("newWpAbstract").value = "";
    document.getElementById("newWpCaption").value = "";
    document.getElementById("newWpOrd").value = "0";
    document.getElementById("newWpShow").value = "0";
  }

  btnAdd?.addEventListener("click", () => {
    resetCreateForm();
    new bootstrap.Modal(modalCreateEl).show();
  });

  btnCreate?.addEventListener("click", async () => {
    const folder = normalizeFolderNameClient(document.getElementById("newWpFolderName").value);
    const wp_title = document.getElementById("newWpTitle").value || "";
    const wp_subtitle = document.getElementById("newWpSubtitle").value || "";
    const wp_abstract = document.getElementById("newWpAbstract").value || "";
    const wp_caption = document.getElementById("newWpCaption").value || "";
    const wp_ord = Number(document.getElementById("newWpOrd").value || 0);
    const wp_show = Number(document.getElementById("newWpShow").value || 0);

    if (folder === null) {
      newErrEl.textContent = t("modal.workpackages.error.folder_invalid.@");
      newErrEl.classList.remove("d-none");
      return;
    }
    if (!wp_title.trim()) {
      newErrEl.textContent = t("modal.workpackages.error.title_required");
      newErrEl.classList.remove("d-none");
      return;
    }

    try {
      const res = await apiFetch({
        body: {
          action: "create",
          wp_folder_name: folder,
          wp_title,
          wp_subtitle,
          wp_abstract,
          wp_caption,
          wp_ord,
          wp_show,
        },
      });

      if (table) {
        table.addData([res.data], true);
        table.selectRow(res.data.wp_id);
      }
      bootstrap.Modal.getInstance(modalCreateEl)?.hide();
    } catch (e) {
      newErrEl.textContent = e.message;
      newErrEl.classList.remove("d-none");
    }
  });

  btnDel?.addEventListener("click", async () => {
    if (!table) return;
    const rows = table.getSelectedRows();
    if (!rows || rows.length !== 1) return;

    const row = rows[0];
    const d = row.getData();

    const ok = confirm(t("modal.workpackages.confirm_delete.@", { title: d.wp_title ?? "" }));
    if (!ok) return;

    try {
      await apiFetch({ body: { action: "delete", wp_id: d.wp_id } });
      row.delete();
      btnDel.disabled = true;
    } catch (e) {
      alert(e.message);
    }
  });

  modalEl.addEventListener("shown.bs.modal", async () => {
    try {
      if (!table) initTable();
      const rows = await apiList();
      table.replaceData(rows);
      setTimeout(() => table && table.redraw(true), 60);
    } catch (e) {
      alert(e.message);
    }
  });

})();
