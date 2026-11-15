// modal_objects.js
import { t, te } from "../app/shared/i18n.mjs";

(function () {
  if (!window.Tabulator) {
    console.error("Tabulator non disponibile (window.Tabulator mancante).");
    return;
  }

  const resId = Number(window.CURRENT_RES_ID || 0);
  const wpId  = Number(window.CURRENT_WP_ID || 0);

  const elTable  = document.getElementById("objects-table");
  const elStatus = document.getElementById("objStatus");

  const btnSave   = document.getElementById("objBtnSave");
  const btnCancel = document.getElementById("objBtnCancel");

  const modalEl = document.getElementById("objectsEditModal");

  let table = null;

  // tracking
  const insertedTempIds = new Set(); // tempId delle righe nuove
  const deletedObjIds   = new Set(); // obj_id numerici eliminati (server-side)
  const invalidObjIds   = new Set(); // obj_id/tempId non validi
  const dirtyKeys       = new Set(); // obj_id (number) o tempId (string)

  let hasDirty = false;

  // Permessi per riga (2026-10-10, passo 4 di _doc/arch-permessi.md §11.9): il server
  // manda can_create (nuovi oggetti e duplicati) e can_edit su ogni oggetto. Le righe
  // nuove sono sempre modificabili. Il server ricontrolla tutto al salvataggio.
  let canCreate = false;
  const rowEditable = (data) => rowIsTemp(data) || !!data.can_edit;
  const cellEditable = (cell) => rowEditable(cell.getRow().getData());

  // apps lookup (cod -> title)
  let apps = []; // [{value:'ABC', label:'Titolo'}]
  let appTitleByCode = new Map();

  const OBJ_SHOW_LABELS = {
    0: t("visibility.author.@"),
    1: t("visibility.workgroup"),
    2: t("visibility.research.@"),
    3: t("visibility.dissemination"),
    4: t("visibility.public"),
    5: t("visibility.guests"),
  };
  // obj_share (§11.6): chi collega modelli e flow all'oggetto — 0 chi lo modifica,
  // 1 anche i membri del WP, 2 anche i membri della ricerca.
  const OBJ_SHARE_VALUES = [0, 1, 2];

  // Nomi degli autori nella colonna "Autori"
  const escAuth = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const KIND = "object", ID_FIELD = "obj_id", NAME_FIELD = "obj_name";

  function setStatus(msg) {
    if (elStatus) elStatus.textContent = msg || "";
  }

  function setDirty(on) {
    hasDirty = !!on;
    refreshFooterButtons();
  }

  function refreshFooterButtons() {
    const canSave = hasDirty;
    if (btnSave) btnSave.disabled = !canSave;
    if (btnCancel) btnCancel.disabled = !hasDirty;
  }

  async function apiRead() {
    const resp = await fetch("ui/modal_objects_tools.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", res_id: resId, wp_id: wpId }),
    });
    const json = await resp.json();
    if (!resp.ok || !json.ok) throw new Error(json.error || t("errors.server_status", { status: resp.status }));
    return json;
  }

  async function apiSave(payload) {
    const resp = await fetch("ui/modal_objects_tools.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    if (!resp.ok || !json.ok) throw new Error(json.error || t("errors.server_status", { status: resp.status }));
    return json;
  }

  function normalizeShow(v) {
    const n = Number(v);
    return [0, 1, 2, 3, 4, 5].includes(n) ? n : 1;
  }

  function normalizeShare(v) {
    const n = Number(v);
    return OBJ_SHARE_VALUES.includes(n) ? n : 1;
  }

  function normalizeRow(row) {
    const out = { ...row };

    out.obj_show = normalizeShow(out.obj_show);
    out.obj_share = normalizeShare(out.obj_share);

    if (typeof out.obj_app === "string") out.obj_app = out.obj_app.trim().substring(0, 3);
    else out.obj_app = "";

    if (typeof out.obj_name === "string") out.obj_name = out.obj_name.trim();
    if (typeof out.obj_type_A === "string") out.obj_type_A = out.obj_type_A.trim();
    if (typeof out.obj_type_B === "string") out.obj_type_B = out.obj_type_B.trim();
    if (typeof out.obj_description === "string") out.obj_description = out.obj_description.trim();

    return out;
  }

  function getRowKey(data) {
    return data.obj_id;
  }

  function rowIsTemp(data) {
    return typeof data.obj_id === "string" && data.obj_id.startsWith("tmp_");
  }

  function makeTempId() {
    return "tmp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function validateRow(data) {
    const key = getRowKey(data);

    const nameOk  = (data.obj_name || "").trim().length > 0;
    const typeAOk = (data.obj_type_A || "").trim().length > 0;
    const appOk   = (data.obj_app || "").trim().length > 0;

    const ok = nameOk && typeAOk && appOk;

    if (!ok) invalidObjIds.add(key);
    else invalidObjIds.delete(key);

    refreshFooterButtons();
    return ok;
  }

  function markInserted(tempId) {
    insertedTempIds.add(tempId);
    dirtyKeys.add(tempId);
    setDirty(true);
  }

  function markUpdated(objIdOrTemp) {
    dirtyKeys.add(objIdOrTemp);
    setDirty(true);
  }

  function markDeleted(objIdOrTemp) {
    if (typeof objIdOrTemp === "string" && objIdOrTemp.startsWith("tmp_")) {
      insertedTempIds.delete(objIdOrTemp);
      dirtyKeys.delete(objIdOrTemp);
      invalidObjIds.delete(objIdOrTemp);
    } else {
      const idNum = Number(objIdOrTemp);
      if (idNum > 0) {
        deletedObjIds.add(idNum);
        dirtyKeys.delete(idNum);
        invalidObjIds.delete(idNum);
      }
    }
    setDirty(true);
  }

  function resetTracking() {
    insertedTempIds.clear();
    deletedObjIds.clear();
    invalidObjIds.clear();
    dirtyKeys.clear();
    hasDirty = false;
    refreshFooterButtons();
  }

  function buildColumns() {
    const actionsCol = {
      title: canCreate
        ? `<button type="button" class="btn btn-sm btn-link p-0 obj-hdr-new" title="${te("common.new")}" aria-label="${te("common.new")}"><span aria-hidden="true">＋</span></button>`
        : "",
      field: "__actions",
      width: 70,
      headerSort: false,
      hozAlign: "center",

      headerClick: function (e) {
        const tgt = e.target;
        if (tgt && tgt.closest(".obj-hdr-new")) {
          insertNewRowAtTop();
        }
      },

      formatter: function (cell) {
        const dup = canCreate
          ? `<button type="button" class="btn btn-sm btn-link p-0 me-2 obj-act-dup" title="${te("common.duplicate")}" aria-label="${te("common.duplicate")}"><span aria-hidden="true">⧉</span></button>`
          : "";
        const del = rowEditable(cell.getRow().getData())
          ? `<button type="button" class="btn btn-sm btn-link p-0 text-danger obj-act-del" title="${te("common.delete")}" aria-label="${te("common.delete")}"><span aria-hidden="true">🗑</span></button>`
          : `<i class="bi bi-lock text-muted" role="img" title="${te("common.read_only")}" aria-label="${te("common.read_only")}"></i>`;
        return dup + del;
      },

      cellClick: function (e, cell) {
        const row = cell.getRow();
        const tgt = e.target;

        if (tgt.closest(".obj-act-dup")) return duplicateRow(row);
        if (tgt.closest(".obj-act-del")) return deleteRow(row);
      }
    };

    const appEditorParams = {
      values: apps.map(x => ({ label: x.label, value: x.value })),
      clearable: true,
    };

    return [
      actionsCol,
      { title: t("common.id"), field: "obj_id", width: 80, hozAlign: "right", editor: false },
      { title: t("modal.objects.col.name_required"), field: "obj_name", editor: "input", editable: cellEditable },
      { title: t("common.description"), field: "obj_description", editor: "input", editable: cellEditable },
      { title: t("modal.objects.col.type_a_required"), field: "obj_type_A", editor: "input", editable: cellEditable },
      { title: t("modal.objects.col.type_b"), field: "obj_type_B", editor: "input", editable: cellEditable },
      {
        title: t("modal.objects.col.app_required"),
        field: "obj_app",
        editor: "list",
        editable: cellEditable,
        editorParams: appEditorParams,
        formatter: function (cell) {
          const code = (cell.getValue() || "").trim();
          if (!code) return "";
          return appTitleByCode.get(code) || code;
        },
        width: 160,
      },
      {
        title: t("modal.objects.col.show"),
        field: "obj_show",
        editor: "list",
        editable: cellEditable,
        editorParams: {
          values: [0, 1, 2, 3, 4, 5].map(v => ({ label: OBJ_SHOW_LABELS[v], value: v })),
        },
        formatter: (cell) => OBJ_SHOW_LABELS[Number(cell.getValue())] ?? "",
        width: 150,
      },
      {
        title: t("modal.objects.col.share"),
        headerTooltip: t("modal.objects.col.share_tooltip.@"),
        field: "obj_share",
        editor: "list",
        editable: cellEditable,
        editorParams: {
          values: OBJ_SHARE_VALUES.map(v => ({ label: OBJ_SHOW_LABELS[v], value: v })),
        },
        formatter: (cell) => OBJ_SHOW_LABELS[Number(cell.getValue())] ?? "",
        width: 150,
      },
      {
        // Autori e collaboratori (passo 7): elenco nella finestra ui/modal_item_authors.php
        title: t("modal.item_authors.col"),
        field: "authors",
        headerSort: false,
        width: 170,
        formatter: (cell) => {
          const d = cell.getRow().getData();
          if (rowIsTemp(d)) return `<span class="text-muted small">${te("modal.item_authors.after_save")}</span>`;
          const list = Array.isArray(d.authors) ? d.authors : [];
          const names = list.map(a => escAuth(a.name) + (a.role === "C" ? ` <span class="text-muted">(${te("modal.item_authors.role_short.C")})</span>` : "")).join(", ");
          return `<button type="button" class="btn btn-link btn-sm p-0 text-start" title="${te("modal.item_authors.open")}">${names || "—"}</button>`;
        },
        cellClick: (e, cell) => {
          const d = cell.getRow().getData();
          if (rowIsTemp(d) || typeof window.raOpenItemAuthors !== "function") return;
          window.raOpenItemAuthors({
            kind: KIND, id: d[ID_FIELD], name: d[NAME_FIELD],
            onSaved: (authors) => cell.getRow().update({ authors }),
          });
        },
      },
    ];
  }

  async function reload() {
    try {
      setStatus(t("common.loading"));
      const payload = await apiRead();

      const data = payload.data || [];
      // apps = solo le APP selezionabili dall'utente (editor della colonna);
      // app_titles = tutte, così un oggetto di un'APP non più selezionabile
      // mostra comunque il titolo e non il codice nudo (step 0, arch-abilitazioni.md).
      apps = payload.apps || [];
      canCreate = !!payload.can_create;
      appTitleByCode = new Map(Object.entries(payload.app_titles || {}));
      for (const x of apps) if (!appTitleByCode.has(x.value)) appTitleByCode.set(x.value, x.label);

      if (!table) {
        table = new Tabulator(elTable, {
          layout: "fitColumns",
          height: "60vh",
          selectable: false,
          index: "obj_id",
          columns: buildColumns(),
          data: data,

          rowFormatter: function (row) {
            const d = row.getData();
            const key = getRowKey(d);
            const invalid = invalidObjIds.has(key);
            row.getElement().style.opacity = invalid ? "0.85" : "1";
            row.getElement().style.outline = invalid ? "2px solid rgba(220,53,69,0.35)" : "";
          },
        });

        table.on("cellEdited", (cell) => {
          const row = cell.getRow();
          const rowData = normalizeRow(row.getData());

          row.update(rowData);

          validateRow(rowData);
          markUpdated(getRowKey(rowData));
          row.reformat();
        });

        table.on("dataChanged", () => {
          table.getRows().forEach(r => r.reformat());
        });

      } else {
        table.setColumns(buildColumns());
        table.replaceData(data);
      }

      resetTracking();
      data.forEach(r => validateRow(normalizeRow(r)));
      setStatus(t("modal.objects.status.loaded", { n: data.length }));
    } catch (e) {
      console.error(e);
      setStatus(t("modal.objects.status.load_error", { error: e.message }));
    }
  }

  function insertNewRowAtTop() {
    if (!table || !canCreate) return;

    const tempId = makeTempId();
    const newRow = normalizeRow({
      obj_id: tempId,
      obj_name: "",
      obj_description: "",
      obj_type_A: "",
      obj_type_B: "",
      obj_app: "",
      obj_show: 1,
      obj_share: 1,
    });

    table.addRow(newRow, true);
    markInserted(tempId);
    validateRow(newRow);
    setStatus(t("modal.objects.status.row_created"));
  }

  function duplicateRow(row) {
    if (!table || !canCreate) return;

    const src = normalizeRow(row.getData());
    const tempId = makeTempId();

    const copy = normalizeRow({
      obj_id: tempId,
      obj_name: (src.obj_name || "") + " (copy)",
      obj_description: src.obj_description || "",
      obj_type_A: src.obj_type_A || "",
      obj_type_B: src.obj_type_B || "",
      obj_app: src.obj_app || "",
      obj_show: src.obj_show,
      obj_share: src.obj_share,
    });

    table.addRow(copy, false, row);
    markInserted(tempId);
    validateRow(copy);
    setStatus(t("modal.objects.status.duplicated"));
  }

  function deleteRow(row) {
    if (!table) return;

    const data = row.getData();
    if (!rowEditable(data)) return;
    const key = getRowKey(data);

    const ok = confirm(rowIsTemp(data)
      ? t("modal.objects.confirm_delete_unsaved")
      : t("modal.objects.confirm_delete.@", { id: data.obj_id }));
    if (!ok) return;

    markDeleted(key);
    row.delete();
    setStatus(t("modal.objects.status.row_deleted"));
  }

  async function saveAll() {
    if (!table) return;

    const rows = table.getData().map(normalizeRow);
    rows.forEach(validateRow);

    if (invalidObjIds.size > 0) {
      setStatus(t("modal.objects.status.fill_required"));
      table.getRows().forEach(r => r.reformat());
      return;
    }

    const inserts = [];
    const updates = [];

    for (const r of rows) {
      const key = getRowKey(r);

      if (rowIsTemp(r) && insertedTempIds.has(key)) {
        const { obj_id, can_edit, authors, ...rest } = r;
        inserts.push(rest);
        continue;
      }

      if (dirtyKeys.has(key) && !rowIsTemp(r) && rowEditable(r)) {
        const { can_edit, authors, ...rest } = r;
        updates.push(rest);
      }
    }

    const deletes = Array.from(deletedObjIds.values());

    if (inserts.length === 0 && updates.length === 0 && deletes.length === 0) {
      setStatus(t("modal.objects.status.no_changes"));
      resetTracking();
      return;
    }

    try {
      setStatus(t("common.saving"));
      if (btnSave) btnSave.disabled = true;

      await apiSave({
        action: "batch",
        res_id: resId,
        wp_id: wpId,
        inserts,
        updates,
        deletes,
      });

      await reload();
      setStatus(t("common.saved"));
    } catch (e) {
      console.error(e);
      setStatus(t("modal.objects.status.save_error", { error: e.message }));
      refreshFooterButtons();
    }
  }

  async function cancelAll() {
    const ok = confirm(t("modal.objects.confirm_discard"));
    if (!ok) return;
    await reload();
    setStatus(t("modal.objects.status.discarded"));
  }

  function onHideModal(ev) {
    if (!hasDirty) return;
    const ok = confirm(t("modal.objects.confirm_close_unsaved"));
    if (!ok) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  btnSave?.addEventListener("click", () => saveAll());
  btnCancel?.addEventListener("click", () => cancelAll());

  modalEl?.addEventListener("shown.bs.modal", () => reload());
  modalEl?.addEventListener("hide.bs.modal", onHideModal);

})();