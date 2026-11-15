// ui/modal_flows.js
// Stesso pattern di ui/modal_objects.js (righe temporanee, colonna
// __actions con duplica/elimina per riga, batch Salva/Annulla) applicato
// all'elenco dei flow del WP. API: api/flows_tool.php (list/batch/duplicate).
//
// Elenco unico (2026-10-04, _doc/arch-flow-dashboard.md §6): flow dell'oggetto e
// flow dashboard insieme, colonna "Tipo" e filtro Tutti/Oggetto/Dashboard. Il
// tipo di una riga nuova si sceglie nella colonna Tipo (predefinito: quello del
// filtro); poi non cambia. Il salvataggio manda un batch per tipo.
// Testi: lang/*.json, chiavi modal.flows.* (_doc/arch-i18n-a11y.md §2).
import { t, te } from "../app/shared/i18n.mjs";

(function () {
  if (!window.Tabulator) {
    console.error("Tabulator non disponibile (window.Tabulator mancante).");
    return;
  }

  const wpId = Number(window.CURRENT_WP_ID_FLOWS || 0);

  const elTable  = document.getElementById("flows-table");
  const elStatus = document.getElementById("flowsStatus");

  const btnSave   = document.getElementById("flowsBtnSave");
  const btnCancel = document.getElementById("flowsBtnCancel");

  const modalEl = document.getElementById("modalFlows");

  let table = null;

  // Regola unica (arch-permessi.md §8ter): un flow lo modificano solo il suo autore
  // e l'amministratore. Il server manda can_edit per riga; le righe altrui sono in
  // sola lettura (si possono duplicare: la copia è propria). authors != null = admin
  // (riassegnazione dell'autore).
  let authors = null;          // [{ id, name }] per l'amministratore, altrimenti null

  const canEditRow = (cell) => cell.getRow().getData().can_edit !== false;

  // tracking
  const insertedTempIds = new Set(); // tempId delle righe nuove
  const deletedFlowIds  = new Map(); // flow_id numerici eliminati (server-side) → flow_type
  const invalidFlowIds  = new Set(); // flow_id/tempId non validi
  const dirtyKeys       = new Set(); // flow_id (number) o tempId (string)

  let hasDirty = false;

  // Scala di visibilità (0..5, 5 = ospiti) e di condivisione (0..3): etichette dal catalogo, lette al momento
  // (non al caricamento del modulo)
  const SCOPE_KEYS = [
    "visibility.author.@",
    "visibility.workgroup",
    "visibility.research.@",
    "visibility.dissemination",
    "visibility.public",
    "visibility.guests",
  ];
  const scopeLabel  = (n) => (SCOPE_KEYS[n] ? t(SCOPE_KEYS[n]) : "");
  const scopeValues = (max) => SCOPE_KEYS.slice(0, max + 1).map((k, i) => ({ label: t(k), value: i }));
  const showLabel   = (v) => { const n = Number(v); return n >= 0 && n <= 5 ? scopeLabel(n) : ""; };
  const shareLabel  = (v) => { const n = Number(v); return n >= 0 && n <= 3 ? scopeLabel(n) : ""; };

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

  async function apiReadType(flowType) {
    const resp = await fetch(`api/flows_tool.php?action=list&flow_type=${flowType}`, {
      credentials: "same-origin",
    });
    const json = await resp.json();
    if (!resp.ok || !json.ok) throw new Error(json.error || t("errors.server_status", { status: resp.status }));
    return (json.data || []).map(r => ({ ...r, flow_type: flowType }));
  }

  /** Entrambi i tipi, più recenti in alto. */
  async function apiRead() {
    const [objs, dash] = await Promise.all([apiReadType("object"), apiReadType("dashboard")]);
    const data = objs.concat(dash)
      .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
    return { data };
  }

  /** Filtro per tipo scelto in alto: 'all' | 'object' | 'dashboard'. */
  function currentTypeFilter() {
    return document.querySelector('input[name="flowsTypeFilter"]:checked')?.value || "all";
  }

  function applyTypeFilter() {
    if (!table) return;
    const type = currentTypeFilter();
    if (type === "all") table.clearFilter();
    else table.setFilter("flow_type", "=", type);
  }

  async function apiSave(payload) {
    const resp = await fetch("api/flows_tool.php", {
      method: "POST",
      credentials: "same-origin",
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
    return [0, 1, 2, 3].includes(n) ? n : 1;
  }

  function normalizeRow(row) {
    const out = { ...row };
    out.flow_show  = normalizeShow(out.flow_show);
    out.flow_share = normalizeShare(out.flow_share);
    out.flow_role  = out.flow_role === "config" ? "config" : "behavior";
    out.flow_edit  = Number(out.flow_edit ?? 1) === 0 ? 0 : 1;
    out.flow_type  = out.flow_type === "dashboard" ? "dashboard" : "object";
    if (typeof out.flow_name === "string") out.flow_name = out.flow_name.trim();
    if (typeof out.flow_description === "string") out.flow_description = out.flow_description.trim();
    return out;
  }

  function getRowKey(data) {
    return data.flow_id;
  }

  function rowIsTemp(data) {
    return typeof data.flow_id === "string" && data.flow_id.startsWith("tmp_");
  }

  function makeTempId() {
    return "tmp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function validateRow(data) {
    const key = getRowKey(data);
    const ok = (data.flow_name || "").trim().length > 0;
    if (!ok) invalidFlowIds.add(key);
    else invalidFlowIds.delete(key);
    refreshFooterButtons();
    return ok;
  }

  function markInserted(tempId) {
    insertedTempIds.add(tempId);
    dirtyKeys.add(tempId);
    setDirty(true);
  }

  function markUpdated(flowIdOrTemp) {
    dirtyKeys.add(flowIdOrTemp);
    setDirty(true);
  }

  function markDeleted(flowIdOrTemp, flowType) {
    if (typeof flowIdOrTemp === "string" && flowIdOrTemp.startsWith("tmp_")) {
      insertedTempIds.delete(flowIdOrTemp);
      dirtyKeys.delete(flowIdOrTemp);
      invalidFlowIds.delete(flowIdOrTemp);
    } else {
      const idNum = Number(flowIdOrTemp);
      if (idNum > 0) {
        deletedFlowIds.set(idNum, flowType === "dashboard" ? "dashboard" : "object");
        dirtyKeys.delete(idNum);
        invalidFlowIds.delete(idNum);
      }
    }
    setDirty(true);
  }

  function resetTracking() {
    insertedTempIds.clear();
    deletedFlowIds.clear();
    invalidFlowIds.clear();
    dirtyKeys.clear();
    hasDirty = false;
    refreshFooterButtons();
  }

  function buildColumns() {
    const actionsCol = {
      title: `<button type="button" class="btn btn-sm btn-link p-0 flow-hdr-new" title="${te("common.new")}" aria-label="${te("common.new")}"><span aria-hidden="true">＋</span></button>`,
      field: "__actions",
      width: 70,
      headerSort: false,
      hozAlign: "center",

      headerClick: function (e) {
        if (e.target && e.target.closest(".flow-hdr-new")) insertNewRowAtTop();
      },

      formatter: function (cell) {
        const mine = cell.getRow().getData().can_edit !== false;
        return `
          <button type="button" class="btn btn-sm btn-link p-0 me-2 flow-act-dup" title="${te("modal.flows.action.duplicate")}" aria-label="${te("modal.flows.action.duplicate")}"><span aria-hidden="true">⧉</span></button>
          ${mine
            ? `<button type="button" class="btn btn-sm btn-link p-0 text-danger flow-act-del" title="${te("common.delete")}" aria-label="${te("common.delete")}"><span aria-hidden="true">🗑</span></button>`
            : `<span class="text-muted" role="img" title="${te("modal.flows.action.locked.@")}" aria-label="${te("modal.flows.action.locked.@")}">🔒</span>`}
        `;
      },

      cellClick: function (e, cell) {
        const row = cell.getRow();
        if (e.target.closest(".flow-act-dup")) return duplicateRow(row);
        if (e.target.closest(".flow-act-del") && row.getData().can_edit !== false) return deleteRow(row);
      }
    };

    return [
      actionsCol,
      { title: t("common.id"), field: "flow_id", width: 80, hozAlign: "right", editor: false },
      {
        // Tipo: scelto solo sulle righe nuove (poi fisso — cambia il bersaglio del flow)
        title: t("common.type"),
        field: "flow_type",
        width: 120,
        editor: "list",
        editable: (cell) => rowIsTemp(cell.getRow().getData()),
        editorParams: {
          values: [
            { label: t("modal.flows.type.object.@"), value: "object" },
            { label: t("modal.flows.type.dashboard"), value: "dashboard" },
          ],
        },
        formatter: (cell) => cell.getValue() === "dashboard"
          ? `<span class="badge bg-dark" title="${te("modal.flows.type.dashboard_hint")}"><i class="bi bi-layout-three-columns" aria-hidden="true"></i> ${te("modal.flows.type.dashboard")}</span>`
          : `<span class="badge bg-secondary" title="${te("modal.flows.type.object_hint.@")}"><i class="bi bi-box2" aria-hidden="true"></i> ${te("modal.flows.type.object.@")}</span>`,
      },
      { title: `${t("common.name")} *`, field: "flow_name", editor: "input", editable: canEditRow },
      { title: t("common.description"), field: "flow_description", editor: "input", editable: canEditRow },
      {
        title: t("modal.flows.col.role"),
        field: "flow_role",
        editor: "list",
        editable: canEditRow,
        editorParams: {
          values: [
            { label: t("modal.flows.role.behavior"), value: "behavior" },
            { label: t("modal.flows.role.config"), value: "config" },
          ],
        },
        formatter: (cell) => cell.getValue() === "config"
          ? `<span class="badge bg-info text-dark" title="${te("modal.flows.role.config_hint.@")}">${te("modal.flows.role.config")}</span>`
          : `<span title="${te("modal.flows.role.behavior_hint.@")}">${te("modal.flows.role.behavior")}</span>`,
        width: 150,
      },
      {
        title: t("common.author"),
        field: "author_id",
        editor: "list",
        editable: () => !!authors,
        editorParams: () => ({ values: (authors || []).map(a => ({ label: a.name, value: a.id })) }),
        formatter: (cell) => {
          const d = cell.getRow().getData();
          if (rowIsTemp(d)) return `<span class="text-muted">${te("modal.flows.author_you")}</span>`;
          const a = authors?.find(x => x.id === Number(d.author_id));
          const name = a?.name ?? d.author_name ?? "";
          return name ? escapeHtml(name) : '<span class="text-muted">—</span>';
        },
        width: 160,
      },
      {
        title: t("modal.flows.col.show"),
        field: "flow_show",
        editor: "list",
        editable: canEditRow,
        editorParams: { values: scopeValues(5) },
        formatter: (cell) => showLabel(cell.getValue()),
        width: 150,
      },
      {
        title: t("modal.flows.col.share"),
        field: "flow_share",
        editor: "list",
        editable: canEditRow,
        editorParams: { values: scopeValues(3) },
        formatter: (cell) => shareLabel(cell.getValue()),
        width: 150,
      },
      {
        // flow_edit (arch-abilitazioni.md §5.6): se spento, chi non è l'autore può
        // collegare ed eseguire il flow ma non aprirne il sorgente né copiarlo.
        title: t("modal.flows.col.open_source"),
        field: "flow_edit",
        editor: "tickCross",
        editable: canEditRow,
        formatter: "tickCross",
        hozAlign: "center",
        width: 120,
        headerTooltip: t("modal.flows.col.open_source_hint"),
        mutator: (v) => Number(v ?? 1) === 0 ? 0 : 1,
      },
      {
        title: t("modal.flows.col.links"),
        field: "link_count",
        editor: false,
        width: 130,
        hozAlign: "center",
        formatter: (cell) => {
          const n = Number(cell.getValue() ?? 0);
          const dash = cell.getRow().getData().flow_type === "dashboard";
          if (n <= 0) return `<span class="badge bg-warning text-dark">${te("modal.flows.links_none")}</span>`;
          return dash
            ? `<span class="badge bg-secondary">${te("modal.flows.links_configs", { n })}</span>`
            : `<span class="badge bg-secondary">${te("modal.flows.links_objects.@", { n })}</span>`;
        },
      },
      {
        // Validazione dei nodi critici (_doc/arch-abilitazioni.md §5): in attesa =
        // il codice gira solo per l'autore; si valida da menu utente → Validazione flow.
        title: t("modal.flows.col.review"),
        field: "flow_review",
        editor: false,
        width: 130,
        formatter: (cell) => ({
          none: "",
          approved: `<span class="badge bg-success">${te("modal.flows.review.approved")}</span>`,
          pending: `<span class="badge bg-warning text-dark" title="${te("modal.flows.review.pending_hint.@")}">${te("modal.flows.review.pending")}</span>`,
        })[cell.getValue()] ?? "",
      },
      { title: t("modal.flows.col.updated"), field: "updated_at", editor: false, width: 150 },
    ];
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Candidati autore: la richiesta riesce solo all'amministratore (403 per gli altri)
  async function loadAuthors() {
    try {
      const resp = await fetch("api/flows_tool.php?action=list_authors", { credentials: "same-origin" });
      const json = await resp.json().catch(() => null);
      authors = resp.ok && json?.ok ? (json.data || []) : null;
    } catch { authors = null; }
  }

  async function reload() {
    try {
      setStatus(t("common.loading"));
      await loadAuthors();
      const payload = await apiRead();
      const data = payload.data || [];

      if (!table) {
        table = new Tabulator(elTable, {
          layout: "fitColumns",
          height: "60vh",
          selectable: false,
          index: "flow_id",
          columns: buildColumns(),
          data: data,
          // filtro per tipo già attivo alla costruzione (setFilter prima di
          // tableBuilt non è affidabile)
          initialFilter: currentTypeFilter() === "all" ? [] : [{ field: "flow_type", type: "=", value: currentTypeFilter() }],

          rowFormatter: function (row) {
            const d = row.getData();
            const key = getRowKey(d);
            const invalid = invalidFlowIds.has(key);
            row.getElement().style.opacity = invalid ? "0.85" : (d.can_edit === false ? "0.75" : "1");
            row.getElement().title = d.can_edit === false
              ? (d.author_name
                  ? t("modal.flows.row_readonly.@", { name: d.author_name })
                  : t("modal.flows.row_readonly_other.@"))
              : "";
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
        await table.replaceData(data);
        applyTypeFilter();
      }

      resetTracking();
      data.forEach(r => validateRow(normalizeRow(r)));
      setStatus(t("modal.flows.status_loaded", { n: data.length }));
    } catch (e) {
      console.error(e);
      setStatus(t("modal.flows.err_load", { msg: e.message }));
    }
  }

  function insertNewRowAtTop() {
    if (!table) return;

    const tempId = makeTempId();
    const filter = currentTypeFilter();
    const newRow = normalizeRow({
      flow_id: tempId,
      flow_type: filter === "dashboard" ? "dashboard" : "object",
      flow_name: "",
      flow_description: "",
      flow_show: 1,
      flow_share: 1,
      flow_edit: 1,
      flow_role: "behavior",
      can_edit: true,
      link_count: 0,
      updated_at: "",
    });

    table.addRow(newRow, true);
    markInserted(tempId);
    validateRow(newRow);
    setStatus(t("modal.flows.status_new_row"));
  }

  function duplicateRow(row) {
    if (!table) return;

    const src = normalizeRow(row.getData());
    const tempId = makeTempId();

    const copy = normalizeRow({
      flow_id: tempId,
      flow_type: src.flow_type,
      flow_name: (src.flow_name || "") + " (copy)",
      flow_description: src.flow_description || "",
      flow_show: src.flow_show,
      flow_share: src.flow_share,
      flow_edit: src.flow_edit,
      flow_role: "behavior",
      can_edit: true,
      link_count: 0,
      updated_at: "",
    });

    if (rowIsTemp(src)) {
      // Riga sorgente ancora non salvata: nessun flow_id reale da duplicare
      // server-side — la copia resta un semplice inserimento locale.
      table.addRow(copy, false, row);
      markInserted(tempId);
      validateRow(copy);
      setStatus(t("modal.flows.status_dup_local"));
      return;
    }

    // Riga già persistita: duplica subito server-side (contenuto grafo
    // incluso, vedi api/flows_tool.php action=duplicate) così la copia
    // porta con sé il flow_fle — poi ricarica la lista.
    (async () => {
      try {
        setStatus(t("modal.flows.status_duplicating"));
        await apiSave({ action: "duplicate", flow_id: src.flow_id });
        await reload();
        setStatus(t("modal.flows.status_duplicated"));
      } catch (e) {
        console.error(e);
        setStatus(t("modal.flows.err_duplicate", { msg: e.message }));
      }
    })();
  }

  function deleteRow(row) {
    if (!table) return;

    const data = row.getData();
    const key = getRowKey(data);

    // Frasi intere per ogni caso (riga nuova / senza collegamenti / collegata a configurazioni o oggetti)
    const n = Number(data.link_count || 0);
    const id = data.flow_id;
    let msg;
    if (rowIsTemp(data)) msg = t("modal.flows.confirm_delete_temp");
    else if (n <= 0) msg = t("modal.flows.confirm_delete", { id });
    else if (data.flow_type === "dashboard") msg = t("modal.flows.confirm_delete_linked_configs", { id, n });
    else msg = t("modal.flows.confirm_delete_linked_objects.@", { id, n });
    const ok = confirm(msg);
    if (!ok) return;

    markDeleted(key, data.flow_type);
    row.delete();
    setStatus(t("modal.flows.status_row_deleted"));
  }

  async function saveAll() {
    if (!table) return;

    const rows = table.getData().map(normalizeRow);
    rows.forEach(validateRow);

    if (invalidFlowIds.size > 0) {
      setStatus(t("modal.flows.err_name_required"));
      table.getRows().forEach(r => r.reformat());
      return;
    }

    // Un batch per tipo: il server applica inserts/updates/deletes a un solo flow_type
    const byType = {
      object:    { inserts: [], updates: [], deletes: [] },
      dashboard: { inserts: [], updates: [], deletes: [] },
    };

    for (const r of rows) {
      const key = getRowKey(r);
      const bucket = byType[r.flow_type === "dashboard" ? "dashboard" : "object"];

      if (rowIsTemp(r) && insertedTempIds.has(key)) {
        const { flow_id, flow_type, link_count, updated_at, can_edit, author_id, author_name, ...rest } = r;
        bucket.inserts.push(rest);
        continue;
      }

      if (dirtyKeys.has(key) && !rowIsTemp(r)) {
        const { flow_type, link_count, updated_at, can_edit, author_name, ...rest } = r;
        if (!authors) delete rest.author_id;   // riassegnazione: solo admin
        bucket.updates.push(rest);
      }
    }

    for (const [id, type] of deletedFlowIds) byType[type].deletes.push(id);

    const total = Object.values(byType).reduce((n, b) => n + b.inserts.length + b.updates.length + b.deletes.length, 0);
    if (total === 0) {
      setStatus(t("modal.flows.status_no_changes"));
      resetTracking();
      return;
    }

    try {
      setStatus(t("common.saving"));
      if (btnSave) btnSave.disabled = true;

      for (const [flowType, b] of Object.entries(byType)) {
        if (!b.inserts.length && !b.updates.length && !b.deletes.length) continue;
        await apiSave({
          action: "batch",
          flow_type: flowType,
          wp_id: wpId,
          inserts: b.inserts,
          updates: b.updates,
          deletes: b.deletes,
          // conferma già chiesta riga per riga (deleteRow, con il numero di collegamenti);
          // il server vieta comunque l'eliminazione se il flow è usato da altri WP
          force_delete: b.deletes.length > 0,
        });
      }

      await reload();
      setStatus(t("common.saved"));
    } catch (e) {
      console.error(e);
      setStatus(t("modal.flows.err_save", { msg: e.message }));
      refreshFooterButtons();
    }
  }

  async function cancelAll() {
    const ok = confirm(t("modal.flows.confirm_cancel"));
    if (!ok) return;
    await reload();
    setStatus(t("modal.flows.status_cancelled"));
  }

  function onHideModal(ev) {
    if (!hasDirty) return;
    const ok = confirm(t("modal.flows.confirm_close_dirty"));
    if (!ok) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  btnSave?.addEventListener("click", () => saveAll());
  btnCancel?.addEventListener("click", () => cancelAll());

  document.querySelectorAll('input[name="flowsTypeFilter"]').forEach(r => {
    r.addEventListener("change", () => applyTypeFilter());
  });

  modalEl?.addEventListener("shown.bs.modal", () => reload());
  modalEl?.addEventListener("hide.bs.modal", onHideModal);

})();
