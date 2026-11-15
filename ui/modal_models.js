// modal_models.js
// Richiede global: Tabulator, research[res_id,res_perm], workpackage[wp_id,wp_perm], user[user_type]
//
// Stesso pattern batch di ui/modal_objects.js (righe temporanee, colonna
// __actions con "+"/duplica/elimina, un solo Salva/Annulla) — sostituisce il
// precedente salvataggio immediato per-cella (ajaxURL + reactiveData). Il
// file picker e l'editor spec restano sub-modali separati ma ora aggiornano
// solo la riga in memoria (row.update()), senza POST immediato: il POST
// avviene una sola volta, al Salva, insieme a tutte le altre modifiche.
//
// Testi da catalogo (chiavi modal.models.*): _doc/arch-i18n-a11y.md §2.

import { t, te } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const modalEl = document.getElementById("modalModels");
  const tableEl = document.getElementById("modelsTable");
  const wpLabel = document.getElementById("modelsWpLabel");
  const elStatus = document.getElementById("modelsStatus");

  const btnSave   = document.getElementById("modelsBtnSave");
  const btnCancel = document.getElementById("modelsBtnCancel");

  // File picker elements
  const fpModalEl = document.getElementById("modalModelFilePicker");
  const fpFoldersEl = document.getElementById("modelFpFolders");
  const fpDirsEl = document.getElementById("modelFpDirs");
  const fpFilesEl = document.getElementById("modelFpFiles");
  const fpHintEl = document.getElementById("modelFpHint");
  const fpBreadcrumbEl = document.getElementById("modelFpBreadcrumb");
  const fpUpBtn = document.getElementById("modelFpUpBtn");
  const fpRootBtn = document.getElementById("modelFpRootBtn");
  const fpNoneBtn = document.getElementById("modelFpNoneBtn");

  // Spec editor
  const specModalEl = document.getElementById("modalModelSpec");
  const specTemplateSel = document.getElementById("modelSpecTemplate");
  const specHelp = document.getElementById("modelSpecHelp");
  const specShowAdvanced = document.getElementById("modelSpecShowAdvanced");
  const specText = document.getElementById("modelSpecText");
  const specStatus = document.getElementById("modelSpecStatus");
  const btnSpecValidate = document.getElementById("btnSpecValidate");
  const btnSpecFormat = document.getElementById("btnSpecFormat");
  const btnSpecSave = document.getElementById("btnSpecSave");

  if (!modalEl || !tableEl) return;

  const API = "ui/modal_models_tools.php";
  const SUBFOLDERS_API = "ui/modal_sub_folders_tools.php"; // list subfolders (session context)

  // Permessi (2026-10-10, passo 4 di _doc/arch-permessi.md §11.9): creano modelli
  // X, P della ricerca, W e I del WP; ogni modello porta can_edit dal server (X, P,
  // W, autori e collaboratori). Le righe nuove sono sempre modificabili. Il server
  // ricontrolla tutto al salvataggio.
  const canCreate = (() => {
    try {
      const isAdmin = String(user?.user_type ?? "") === "X";
      const isPI = String(research?.res_perm ?? research?.perm ?? "") === "P";
      const wpPerm = String(workpackage?.wp_perm ?? workpackage?.perm ?? "");
      return isAdmin || isPI || wpPerm === "W" || wpPerm === "I";
    } catch {
      return false;
    }
  })();
  const rowEditable = (data) => rowIsTemp(data) || !!data.can_edit;
  const cellEditable = (cell) => rowEditable(cell.getRow().getData());

  let modelsTable = null;

  // tracking (stesso schema di modal_objects.js/modal_flows.js)
  const insertedTempIds = new Set();
  const deletedModIds   = new Set();
  const invalidModIds   = new Set();
  const dirtyKeys        = new Set();
  let hasDirty = false;

  // File picker state
  let fpCurrentRow = null;
  let fpRootFolderId = null; // subfolder folder_id
  let fpCwd = "";            // path relativo dentro subfolder ('' = root)

  // Spec editor state
  let specCurrentRow = null;

  // Template caricati da api/cfg_mod_spec.php (tabella mod_spec_templates,
  // già filtrati sulle APP abilitate per l'utente) al primo utilizzo.
  let _specTemplates = null; // array [{ tpl_id, type, app_title, name, level, help, spec }]

  async function loadSpecTemplates() {
    if (_specTemplates) return _specTemplates;
    try {
      const r = await fetch('api/cfg_mod_spec.php', { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _specTemplates = await r.json();
    } catch (e) {
      console.warn('Template mod_spec non caricabili, uso fallback:', e.message);
      _specTemplates = [{ type: 'CUS', app_title: 'Custom', name: 'Custom', level: 'base', help: t('modal.models.spec.fallback_help'), spec: { type: 'custom' } }];
    }
    return _specTemplates;
  }

  // Scala di visibilità/condivisione: valore numerico salvato → chiave del catalogo.
  const SCALE_KEYS = {
    0: "visibility.author.@",
    1: "visibility.workgroup",
    2: "visibility.research.@",
    3: "visibility.dissemination",
    4: "visibility.public",
    5: "visibility.guests",
  };
  const MOD_SHOW_VALUES  = [0, 1, 2, 3, 4, 5];
  const MOD_SHARE_VALUES = [0, 1, 2, 3];

  // Nomi degli autori nella colonna "Autori"
  const escAuth = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const KIND = "model", ID_FIELD = "mod_id", NAME_FIELD = "mod_name";

  function scaleLabel(v, allowed) {
    const n = Number(v);
    return allowed.includes(n) ? t(SCALE_KEYS[n]) : "";
  }
  function scaleOptions(allowed) {
    return allowed.map((n) => ({ label: t(SCALE_KEYS[n]), value: n }));
  }

  function apiJSON(bodyObj) {
    return fetch(API, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!j) throw new Error(t('errors.server_status', { status: r.status }));
      if (!r.ok || !j.success) throw new Error(j.error || t('errors.server_status', { status: r.status }));
      return j;
    });
  }

  function apiGET(url) {
    return fetch(url, { credentials: "same-origin" }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!j) throw new Error(t('errors.server_status', { status: r.status }));
      if (!r.ok || !j.success) throw new Error(j.error || t('errors.server_status', { status: r.status }));
      return j;
    });
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  function setStatus(msg) {
    if (elStatus) elStatus.textContent = msg || "";
  }

  function setDirty(on) {
    hasDirty = !!on;
    refreshFooterButtons();
  }

  function refreshFooterButtons() {
    if (btnSave) btnSave.disabled = !hasDirty;
    if (btnCancel) btnCancel.disabled = !hasDirty;
  }

  function normalizeShow(v) {
    const n = Number(v);
    return [0, 1, 2, 3, 4, 5].includes(n) ? n : 1;
  }
  function normalizeShare(v) {
    const n = Number(v);
    return [0, 1, 2, 3].includes(n) ? n : 1;
  }

  function normalizeRow(row) {
    const out = { ...row };
    out.mod_show  = normalizeShow(out.mod_show);
    out.mod_share = normalizeShare(out.mod_share);
    out.folder_id = Number(out.folder_id) || 0;
    if (typeof out.mod_name === "string") out.mod_name = out.mod_name.trim();
    if (typeof out.mod_description === "string") out.mod_description = out.mod_description.trim();
    if (typeof out.mod_filename === "string") out.mod_filename = out.mod_filename.trim();
    // (2026-10-03) "Nessun file": cartella 0 e nome vuoto, scelto esplicitamente
    // dal selettore. Le righe salvate così lo sono per definizione; le righe
    // nuove passano __nofile:false finché non si sceglie (file o "nessun file").
    if (out.__nofile === undefined) out.__nofile = out.folder_id === 0 && !out.mod_filename;
    return out;
  }

  function getRowKey(data) {
    return data.mod_id;
  }

  function rowIsTemp(data) {
    return typeof data.mod_id === "string" && data.mod_id.startsWith("tmp_");
  }

  function makeTempId() {
    return "tmp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function validateRow(data) {
    const key = getRowKey(data);
    const nameOk   = (data.mod_name || "").trim().length > 0;
    const fileOk   = (data.mod_filename || "").trim().length > 0;
    const folderOk = Number(data.folder_id) > 0;
    const ok = nameOk && ((fileOk && folderOk) || !!data.__nofile);
    if (!ok) invalidModIds.add(key);
    else invalidModIds.delete(key);
    refreshFooterButtons();
    return ok;
  }

  function markInserted(tempId) {
    insertedTempIds.add(tempId);
    dirtyKeys.add(tempId);
    setDirty(true);
  }
  function markUpdated(modIdOrTemp) {
    dirtyKeys.add(modIdOrTemp);
    setDirty(true);
  }
  function markDeleted(modIdOrTemp) {
    if (typeof modIdOrTemp === "string" && modIdOrTemp.startsWith("tmp_")) {
      insertedTempIds.delete(modIdOrTemp);
      dirtyKeys.delete(modIdOrTemp);
      invalidModIds.delete(modIdOrTemp);
    } else {
      const idNum = Number(modIdOrTemp);
      if (idNum > 0) {
        deletedModIds.add(idNum);
        dirtyKeys.delete(idNum);
        invalidModIds.delete(idNum);
      }
    }
    setDirty(true);
  }
  function resetTracking() {
    insertedTempIds.clear();
    deletedModIds.clear();
    invalidModIds.clear();
    dirtyKeys.clear();
    hasDirty = false;
    refreshFooterButtons();
  }

  // -------- Spec helpers --------
  function setSpecStatus(ok, msg) {
    specStatus.textContent = msg || "";
    specStatus.className = "ms-auto small " + (ok ? "text-success" : "text-danger");
  }

  function validateSpecText() {
    const txt = specText.value.trim();
    try {
      const obj = JSON.parse(txt || "{}");
      setSpecStatus(true, t('modal.models.spec.json_ok'));
      return obj;
    } catch (e) {
      setSpecStatus(false, t('modal.models.spec.json_invalid', { msg: e.message }));
      return null;
    }
  }

  function formatSpecText() {
    const obj = validateSpecText();
    if (!obj) return;
    specText.value = JSON.stringify(obj, null, 2);
  }

  // -------- File picker (navigabile) --------
  function setBreadcrumb(rootName, cwd) {
    const path = cwd ? `${rootName} / ${cwd}` : rootName;
    fpBreadcrumbEl.textContent = path;
  }

  function parentPath(p) {
    if (!p) return "";
    const parts = p.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
  }

  async function openFilePickerForRow(row) {
    fpCurrentRow = row;
    fpRootFolderId = null;
    fpCwd = "";

    fpFoldersEl.innerHTML = "";
    fpDirsEl.innerHTML = "";
    fpFilesEl.innerHTML = "";
    fpHintEl.textContent = t('modal.models.fp.pick_subfolder.@');
    fpBreadcrumbEl.textContent = "";

    const res = await apiGET(`${SUBFOLDERS_API}?action=list`);
    const folders = res.data?.items || [];

    folders.forEach((f) => {
      const a = document.createElement("a");
      a.href = "#";
      a.className = "list-group-item list-group-item-action";
      a.textContent = f.folder_name;

      a.onclick = async (e) => {
        e.preventDefault();
        fpFoldersEl.querySelectorAll(".active").forEach(x => x.classList.remove("active"));
        a.classList.add("active");

        fpRootFolderId = f.folder_id;
        fpCwd = "";
        setBreadcrumb(f.folder_name, fpCwd);

        await loadDir(fpRootFolderId, fpCwd);
      };

      fpFoldersEl.appendChild(a);
    });

    const m = bootstrap.Modal.getOrCreateInstance(fpModalEl);
    m.show();
  }

  async function loadDir(rootFolderId, cwd) {
    fpDirsEl.innerHTML = "";
    fpFilesEl.innerHTML = "";
    fpHintEl.textContent = t('common.loading');

    const res = await apiJSON({
      action: "list_dir",
      folder_id: rootFolderId,
      path: cwd || "",
    });

    const rootName = res.data?.root_name || t('modal.models.fp.subfolder_fallback.@');
    const dirs = res.data?.dirs || [];
    const files = res.data?.files || [];
    fpCwd = res.data?.cwd || "";

    setBreadcrumb(rootName, fpCwd);

    fpHintEl.textContent = t('modal.models.fp.counts.@', { dirs: dirs.length, files: files.length });

    if (!dirs.length) {
      const div = document.createElement("div");
      div.className = "small text-muted mt-2";
      div.textContent = t('modal.models.fp.no_dirs.@');
      fpDirsEl.appendChild(div);
    } else {
      dirs.forEach((dn) => {
        const a = document.createElement("a");
        a.href = "#";
        a.className = "list-group-item list-group-item-action";
        a.innerHTML = `<span aria-hidden="true">📁</span> <span>${escapeHtml(dn)}</span>`;
        a.onclick = async (e) => {
          e.preventDefault();
          const next = fpCwd ? `${fpCwd}/${dn}` : dn;
          await loadDir(rootFolderId, next);
        };
        fpDirsEl.appendChild(a);
      });
    }

    if (!files.length) {
      const div = document.createElement("div");
      div.className = "small text-muted mt-2";
      div.textContent = t('modal.models.fp.no_files.@');
      fpFilesEl.appendChild(div);
    } else {
      files.forEach((fn) => {
        const a = document.createElement("a");
        a.href = "#";
        a.className = "list-group-item list-group-item-action";
        a.innerHTML = `<span aria-hidden="true">📄</span> <span>${escapeHtml(fn)}</span>`;

        a.onclick = (e) => {
          e.preventDefault();
          if (!fpCurrentRow || !fpRootFolderId) return;

          const rel = fpCwd ? `${fpCwd}/${fn}` : fn;

          // Aggiorna solo la riga in memoria — nessun POST qui, la scelta
          // del file diventa parte delle modifiche pendenti come qualunque
          // altra cella (vedi markUpdated/validateRow).
          fpCurrentRow.update({
            folder_id: fpRootFolderId,
            mod_folder_id: fpRootFolderId,
            mod_filename: rel,
            __nofile: false,
          });
          const d = normalizeRow(fpCurrentRow.getData());
          markUpdated(getRowKey(d));
          validateRow(d);
          fpCurrentRow.reformat();

          bootstrap.Modal.getOrCreateInstance(fpModalEl).hide();
        };

        fpFilesEl.appendChild(a);
      });
    }
  }

  // "Nessun file (dati dal flow)": modello senza file — l'APP parte senza caricare
  // dati da file e il mod_spec continua a configurarla (2026-10-03).
  fpNoneBtn?.addEventListener("click", () => {
    if (!fpCurrentRow) return;
    fpCurrentRow.update({ folder_id: 0, mod_folder_id: 0, mod_filename: "", __nofile: true, is_missing: 0 });
    const d = normalizeRow(fpCurrentRow.getData());
    markUpdated(getRowKey(d));
    validateRow(d);
    fpCurrentRow.reformat();
    bootstrap.Modal.getOrCreateInstance(fpModalEl).hide();
  });

  fpUpBtn?.addEventListener("click", async () => {
    if (!fpRootFolderId) return;
    const up = parentPath(fpCwd);
    await loadDir(fpRootFolderId, up);
  });

  fpRootBtn?.addEventListener("click", async () => {
    if (!fpRootFolderId) return;
    await loadDir(fpRootFolderId, "");
  });

  // -------- Colonne --------
  function buildColumns() {
    const actionsCol = {
      title: canCreate
        ? `<button type="button" class="btn btn-sm btn-link p-0 mod-hdr-new" title="${te('common.new')}" aria-label="${te('common.new')}"><span aria-hidden="true">＋</span></button>`
        : "",
      field: "__actions",
      width: 70,
      headerSort: false,
      hozAlign: "center",

      headerClick: function (e) {
        if (e.target && e.target.closest(".mod-hdr-new")) insertNewRowAtTop();
      },

      formatter: function (cell) {
        const dup = canCreate
          ? `<button type="button" class="btn btn-sm btn-link p-0 me-2 mod-act-dup" title="${te('common.duplicate')}" aria-label="${te('common.duplicate')}"><span aria-hidden="true">⧉</span></button>`
          : "";
        const del = rowEditable(cell.getRow().getData())
          ? `<button type="button" class="btn btn-sm btn-link p-0 text-danger mod-act-del" title="${te('common.delete')}" aria-label="${te('common.delete')}"><span aria-hidden="true">🗑</span></button>`
          : `<i class="bi bi-lock text-muted" role="img" title="${te('common.read_only')}" aria-label="${te('common.read_only')}"></i>`;
        return dup + del;
      },

      cellClick: function (e, cell) {
        const row = cell.getRow();
        if (e.target.closest(".mod-act-dup")) return duplicateRow(row);
        if (e.target.closest(".mod-act-del")) return deleteRow(row);
      }
    };

    return [
      actionsCol,
      { title: t('common.id'), field: "mod_id", width: 60, hozAlign: "right", editor: false },

      {
        title: t('modal.models.col.name'),
        field: "mod_name",
        editor: "input",
        editable: cellEditable,
      },

      {
        title: t('common.description'),
        field: "mod_description",
        editor: "input",
        editable: cellEditable,
      },

      {
        title: t('modal.models.col.filename'),
        field: "mod_filename",
        editor: false,
        formatter: (cell) => {
          const v = cell.getValue();
          if (v) return escapeHtml(v);
          return cell.getRow().getData().__nofile
            ? `<span class="badge text-bg-light border" title="${te('modal.models.nofile_title')}">${te('modal.models.nofile_badge')}</span>`
            : `<span class="text-muted">${te('modal.models.select_file')}</span>`;
        },
        cellClick: async (e, cell) => {
          if (!cellEditable(cell)) return;
          await openFilePickerForRow(cell.getRow());
        },
      },

      {
        title: t('modal.models.col.spec'),
        field: "mod_spec",
        formatter: () => `<button type="button" class="btn btn-outline-secondary btn-sm px-2" title="${te('modal.models.edit_spec')}" aria-label="${te('modal.models.edit_spec')}">
          <i class="bi bi-pencil" aria-hidden="true"></i>
        </button>`,
        cellClick: (e, cell) => {
          if (!cellEditable(cell)) return;
          openSpecEditor(cell.getRow());
        },
        width: 50,
        hozAlign: "center",
        headerSort: false,
      },

      {
        title: t('modal.models.col.show'),
        field: "mod_show",
        editor: "list",
        editable: cellEditable,
        editorParams: {
          values: scaleOptions(MOD_SHOW_VALUES),
        },
        formatter: (cell) => scaleLabel(cell.getValue(), MOD_SHOW_VALUES),
        width: 100,
      },

      {
        title: t('modal.models.col.share'),
        field: "mod_share",
        editor: "list",
        editable: cellEditable,
        editorParams: {
          values: scaleOptions(MOD_SHARE_VALUES),
        },
        formatter: (cell) => scaleLabel(cell.getValue(), MOD_SHARE_VALUES),
        width: 100,
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

      {
        title: t('modal.models.col.file_check'),
        field: "is_missing",
        width: 80,
        hozAlign: "center",
        editor: false,
        formatter: (cell) => {
          if (cell.getRow().getData().__nofile) return `<span class="badge bg-secondary" title="${te('modal.models.nofile_short.@')}">—</span>`;
          const miss = !!cell.getValue();
          return miss
            ? `<span class="badge bg-warning text-dark">${te('modal.models.file_missing')}</span>`
            : `<span class="badge bg-success">${te('common.ok')}</span>`;
        },
      },

      { title: "wp_id", field: "wp_id", visible: false },
      { title: "folder_id", field: "folder_id", visible: false },
    ];
  }

  // -------- Load/Reload --------
  async function reload() {
    try {
      setStatus(t('common.loading'));
      const res = await apiGET(`${API}?action=list_models`);
      const data = res.data || [];

      if (!modelsTable) {
        modelsTable = new Tabulator(tableEl, {
          layout: "fitColumns",
          height: "60vh",
          selectable: false,
          index: "mod_id",
          columns: buildColumns(),
          data: data,
          placeholder: t('modal.models.empty.@'),

          rowFormatter: function (row) {
            const d = row.getData();
            const key = getRowKey(d);
            const invalid = invalidModIds.has(key);
            row.getElement().style.opacity = invalid ? "0.85" : "1";
            row.getElement().style.outline = invalid ? "2px solid rgba(220,53,69,0.35)" : "";
            if (d.is_missing) row.getElement().classList.add("table-warning");
            else row.getElement().classList.remove("table-warning");
          },
        });

        modelsTable.on("cellEdited", (cell) => {
          if (!cellEditable(cell)) return;
          const field = cell.getField();
          if (field === "is_missing" || field === "mod_filename" || field === "mod_spec") return;
          const row = cell.getRow();
          const rowData = normalizeRow(row.getData());
          row.update(rowData);
          validateRow(rowData);
          markUpdated(getRowKey(rowData));
          row.reformat();
        });

        modelsTable.on("dataChanged", () => {
          modelsTable.getRows().forEach(r => r.reformat());
        });

      } else {
        modelsTable.setColumns(buildColumns());
        modelsTable.replaceData(data);
      }

      resetTracking();
      data.forEach(r => validateRow(normalizeRow(r)));
      setStatus(t('modal.models.loaded', { n: data.length }));
    } catch (e) {
      console.error(e);
      setStatus(t('modal.models.load_error', { msg: e.message }));
    }
  }

  // -------- Nuovo / Duplica / Elimina --------
  async function insertNewRowAtTop() {
    if (!modelsTable || !canCreate) return;

    const templates = await loadSpecTemplates();
    const defaultSpec = templates[0]?.spec ?? { type: 'custom' };

    const tempId = makeTempId();
    const newRow = normalizeRow({
      mod_id: tempId,
      mod_name: "",
      mod_description: "",
      mod_filename: "",
      folder_id: 0,
      mod_spec: defaultSpec,
      mod_show: 1,
      mod_share: 1,
      is_missing: 1,
      __nofile: false,   // da scegliere: un file oppure "nessun file"
    });

    const row = await modelsTable.addRow(newRow, true);
    markInserted(tempId);
    validateRow(newRow);
    setStatus(t('modal.models.new_created.@'));
    await openFilePickerForRow(row);
  }

  function duplicateRow(row) {
    if (!modelsTable || !canCreate) return;

    const src = normalizeRow(row.getData());
    const tempId = makeTempId();

    const copy = normalizeRow({
      mod_id: tempId,
      mod_name: (src.mod_name || "") + " (copy)",
      mod_description: src.mod_description || "",
      mod_filename: src.mod_filename || "",
      folder_id: src.folder_id || 0,
      mod_spec: src.mod_spec,
      mod_show: src.mod_show,
      mod_share: src.mod_share,
      is_missing: src.is_missing,
      __nofile: src.__nofile,
    });

    modelsTable.addRow(copy, false, row);
    markInserted(tempId);
    validateRow(copy);
    setStatus(t('modal.models.duplicated'));
  }

  function deleteRow(row) {
    if (!modelsTable) return;

    const data = row.getData();
    if (!rowEditable(data)) return;
    const key = getRowKey(data);

    const question = rowIsTemp(data)
      ? t('modal.models.confirm_delete_unsaved.@')
      : t('modal.models.confirm_delete.@', { id: data.mod_id });
    const ok = confirm(question);
    if (!ok) return;

    markDeleted(key);
    row.delete();
    setStatus(t('modal.models.row_deleted'));
  }

  // -------- Salva / Annulla --------
  async function saveAll() {
    if (!modelsTable) return;

    const rows = modelsTable.getData().map(normalizeRow);
    rows.forEach(validateRow);

    if (invalidModIds.size > 0) {
      setStatus(t('modal.models.fill_required'));
      modelsTable.getRows().forEach(r => r.reformat());
      return;
    }

    const inserts = [];
    const updates = [];

    for (const r of rows) {
      const key = getRowKey(r);

      if (rowIsTemp(r) && insertedTempIds.has(key)) {
        const { mod_id, is_missing, wp_id, __nofile, can_edit, authors, ...rest } = r;
        inserts.push(rest);
        continue;
      }

      if (dirtyKeys.has(key) && !rowIsTemp(r) && rowEditable(r)) {
        const { is_missing, wp_id, __nofile, can_edit, authors, ...rest } = r;
        updates.push(rest);
      }
    }

    const deletes = Array.from(deletedModIds.values());

    if (inserts.length === 0 && updates.length === 0 && deletes.length === 0) {
      setStatus(t('modal.models.no_changes'));
      resetTracking();
      return;
    }

    try {
      setStatus(t('common.saving'));
      if (btnSave) btnSave.disabled = true;

      await apiJSON({ action: "batch", inserts, updates, deletes });

      await reload();
      setStatus(t('common.saved'));
    } catch (e) {
      console.error(e);
      setStatus(t('modal.models.save_error', { msg: e.message }));
      refreshFooterButtons();
    }
  }

  async function cancelAll() {
    const ok = confirm(t('modal.models.confirm_cancel'));
    if (!ok) return;
    await reload();
    setStatus(t('modal.models.cancelled'));
  }

  function onHideModal(ev) {
    if (!hasDirty) return;
    const ok = confirm(t('modal.models.confirm_close'));
    if (!ok) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  // -------- Spec editor --------
  // Picker raggruppato per APP (optgroup). I template 'advanced' (molto
  // specifici) compaiono solo con "mostra avanzati". option.value resta
  // l'indice in _specTemplates, come prima.
  async function populateSpecTemplates() {
    const templates = await loadSpecTemplates();
    const showAdvanced = !!specShowAdvanced?.checked;
    // Nessun template avanzato per questo utente (profili, step 2): la casella non serve.
    const wrap = specShowAdvanced?.closest(".form-check");
    if (wrap) wrap.classList.toggle("d-none", !templates.some(tpl => tpl.level === "advanced"));
    specTemplateSel.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = t('modal.models.spec.choose_template');
    specTemplateSel.appendChild(placeholder);

    let group = null, groupKey = null;
    templates.forEach((tpl, i) => {
      if (tpl.level === "advanced" && !showAdvanced) return;
      const key = tpl.type || "";
      if (key !== groupKey) {
        group = document.createElement("optgroup");
        group.label = tpl.app_title || key || t('modal.models.spec.group_other');
        specTemplateSel.appendChild(group);
        groupKey = key;
      }
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = tpl.level === "advanced" ? t('modal.models.spec.advanced_item', { name: tpl.name }) : tpl.name;
      group.appendChild(opt);
    });
  }

  specShowAdvanced?.addEventListener("change", () => populateSpecTemplates());

  function openSpecEditor(row) {
    specCurrentRow = row;
    const d = row.getData();
    let obj;
    try {
      obj = typeof d.mod_spec === "string" ? JSON.parse(d.mod_spec || "{}") : (d.mod_spec || {});
    } catch {
      obj = { type: "custom" };
    }

    specText.value = JSON.stringify(obj, null, 2);
    specTemplateSel.value = ""; // torna al segnaposto: riscegliere lo stesso template fa scattare 'change'
    setSpecStatus(true, "");
    if (specHelp) specHelp.textContent = t('modal.models.spec.help_default');

    bootstrap.Modal.getOrCreateInstance(specModalEl).show();
  }

  specTemplateSel.addEventListener("change", () => {
    if (specTemplateSel.value === "") return;
    const i = Number(specTemplateSel.value);
    const tpl = _specTemplates?.[i];
    specText.value = JSON.stringify(tpl?.spec ?? { type: "custom" }, null, 2);
    if (specHelp) specHelp.textContent = tpl?.help || t('modal.models.spec.no_help');
    setSpecStatus(true, t('modal.models.spec.applied'));
  });

  btnSpecValidate.addEventListener("click", () => validateSpecText());
  btnSpecFormat.addEventListener("click", () => formatSpecText());

  btnSpecSave.addEventListener("click", () => {
    if (!specCurrentRow) return;

    const obj = validateSpecText();
    if (!obj) return;

    // Solo in memoria — il salvataggio vero avviene al Salva del modale principale.
    specCurrentRow.update({ mod_spec: obj });
    const d = normalizeRow(specCurrentRow.getData());
    markUpdated(getRowKey(d));
    specCurrentRow.reformat();

    bootstrap.Modal.getOrCreateInstance(specModalEl).hide();
  });

  // -------- lifecycle --------
  btnSave?.addEventListener("click", () => saveAll());
  btnCancel?.addEventListener("click", () => cancelAll());

  modalEl.addEventListener("shown.bs.modal", function () {
    wpLabel.textContent = `${workpackage.wp_id}`;
    populateSpecTemplates();
    reload();
  });
  modalEl.addEventListener("hide.bs.modal", onHideModal);
})();
