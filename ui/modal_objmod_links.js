// modal_objmod_links.js (UPDATED — toggle Models/Flows, bersaglio Oggetti/Dashboard)
// Richiede global: Tabulator, research[res_id,res_perm], workpackage[wp_id,wp_perm], user[user_type]
//
// Bersaglio (2026-10-04, _doc/arch-flow-dashboard.md §7): in cima si sceglie A COSA
// si aggancia — "Oggetti" (predefinito: sopra gli oggetti, sotto Models o Flows)
// oppure "Dashboard" (sopra le Dashboard Config del WP, sotto i flow dashboard).
// Esporta window.openLinksForDashboard(dshpId): apre la modale sul bersaglio
// Dashboard con quella Config già selezionata (pulsante Link della Dashboard Config).

import { getCurrentDshp } from "../app/dashboard_cfg.mjs";
import { t, te } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const modalEl = document.getElementById("modalObjModLinks");
  if (!modalEl) return;

  const objTableEl = document.getElementById("objTable");
  const modTableEl = document.getElementById("modTable");
  const wpLabelEl = document.getElementById("objmodWpLabel");
  const hintEl = document.getElementById("objmodSelectedObjHint");
  const btnSave = document.getElementById("btnObjModSave");
  const availableLabelEl = document.getElementById("objmodAvailableLabel");
  const helpAlertEl = document.getElementById("objmodHelpAlert");
  const titleEl = document.getElementById("modalObjModLinksLabel");
  const targetLabelEl = document.getElementById("objmodTargetLabel");

  const scopeWp = document.getElementById("objmodScopeWp");
  const scopeRes = document.getElementById("objmodScopeRes");
  const scopeGlobal = document.getElementById("objmodScopeGlobal");
  const counterEl = document.getElementById("objmodCounter");

  const kindModels = document.getElementById("objmodKindModels");
  const kindFlows = document.getElementById("objmodKindFlows");
  const kindModelsLabel = document.getElementById("objmodKindModelsLabel");

  const targetObjects = document.getElementById("objmodTargetObjects");
  const targetDash = document.getElementById("objmodTargetDash");

  const API = "ui/modal_objmod_links_tools.php";

  // Doppio share (2026-10-10, passo 4 di _doc/arch-permessi.md §11.6): il server manda
  // can_link sul bersaglio (oggetto: obj_share; configurazione: X/P/W) e su ogni modello
  // o flow. Si spunta solo se lo consentono entrambi; il server ricontrolla al salvataggio.
  const targetCanLink = () => !!selectedObj?.can_link;
  const rowCanLink = (d) => targetCanLink() && !!d.can_link;

  let objTable = null;
  let modTable = null;
  let selectedObj = null;        // riga selezionata sopra: oggetto o Dashboard Config
  let pendingDshpId = null;      // Config da preselezionare all'apertura (openLinksForDashboard)

  const dirtyAdded = new Set();
  const dirtyRemoved = new Set();

  function currentTarget() {
    return targetDash.checked ? "dashboard" : "objects";
  }

  function currentKind() {
    // Per le Dashboard Config si collegano solo flow (dashboard)
    if (currentTarget() === "dashboard") return "flows";
    return kindFlows.checked ? "flows" : "models";
  }

  function idField() {
    return currentKind() === "flows" ? "flow_id" : "mod_id";
  }

  function targetIdField() {
    return currentTarget() === "dashboard" ? "dshp_id" : "obj_id";
  }

  function currentScope() {
    if (scopeWp.checked) return "wp";
    if (scopeRes.checked) return "res";
    return "global";
  }

  function setSaveEnabled() {
    btnSave.disabled = !(targetCanLink() && (dirtyAdded.size > 0 || dirtyRemoved.size > 0));
    btnSave.title = (selectedObj && !targetCanLink()) ? t("modal.objmod_links.no_permission.@") : "";
  }

  function updateCounter() {
    if (!counterEl) return;

    const data = modTable ? modTable.getData() : [];
    if (!selectedObj || !data.length) {
      counterEl.style.display = "none";
      counterEl.textContent = "";
      return;
    }

    const total = data.length;
    const linked = data.filter(r => !!r.linked).length;
    const dirty = dirtyAdded.size + dirtyRemoved.size;

    counterEl.style.display = "";
    counterEl.className = "ms-auto small " + (dirty > 0 ? "text-warning-emphasis fw-semibold" : "text-muted");   // giallo su bianco: contrasto insufficiente
    counterEl.textContent = dirty > 0
      ? t("modal.objmod_links.counter_dirty", { linked, total, dirty })
      : t("modal.objmod_links.counter", { linked, total });
  }

  function resetDirty() {
    dirtyAdded.clear();
    dirtyRemoved.clear();
    setSaveEnabled();
    updateCounter();
  }

  function emptyHint() {
    return currentTarget() === "dashboard"
      ? t("modal.objmod_links.hint.dashboard")
      : t("modal.objmod_links.hint.objects.@");
  }

  function updateKindLabels() {
    const isDash = currentTarget() === "dashboard";
    const isFlows = currentKind() === "flows";

    // Bersaglio Dashboard: "Models" non ha senso, resta solo "Flows"
    if (kindModels) kindModels.disabled = isDash;
    if (kindModelsLabel) kindModelsLabel.style.display = isDash ? "none" : "";
    if (isDash && kindFlows) kindFlows.checked = true;

    if (targetLabelEl) targetLabelEl.textContent = isDash ? t("modal.objmod_links.target_label.dashboard.@") : t("modal.objmod_links.target_label.objects.@");
    if (availableLabelEl) availableLabelEl.textContent = isDash ? t("modal.objmod_links.available.flows_dashboard")
                                                       : (isFlows ? t("modal.objmod_links.available.flows") : t("modal.objmod_links.available.models.@"));
    if (titleEl) titleEl.textContent = isDash ? t("modal.objmod_links.title.dashboard_flows")
                                     : (isFlows ? t("modal.objmod_links.title.objects_flows.@") : t("modal.objmod_links.title.objects_models.@"));
    if (helpAlertEl) {
      helpAlertEl.textContent = isDash
        ? t("modal.objmod_links.help.dashboard")
        : isFlows
        ? t("modal.objmod_links.help.flows.@")
        : t("modal.objmod_links.help.models.@");
    }
  }

  async function apiGet(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    const j = await r.json().catch(() => null);
    if (!j) {
      const txt = await r.text().catch(() => "");
      throw new Error(t("modal.objmod_links.err.not_json_snippet", { status: r.status, snippet: txt.slice(0, 120) }));
    }
    if (!r.ok || !j.success) throw new Error(j.error || t("errors.server_status", { status: r.status }));
    return j;
  }

  async function apiPost(bodyObj) {
    const r = await fetch(API, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    });
    const j = await r.json().catch(() => null);
    if (!j) throw new Error(t("modal.objmod_links.err.not_json", { status: r.status }));
    if (!r.ok || !j.success) throw new Error(j.error || t("errors.server_status", { status: r.status }));
    return j;
  }

  // ── Tabella del bersaglio (sopra) ─────────────────────────────────────────

  function objectColumns() {
    return [
      { title: t("common.id"), field: "obj_id", width: 60, hozAlign: "right" },
      { title: t("common.name"), field: "obj_name", minWidth: 180, widthGrow: 2 },
      { title: t("common.description"), field: "obj_description", minWidth: 320, widthGrow: 4, formatter: "textarea" },
      { title: t("modal.objmod_links.col.type_a"), field: "obj_type_A", minWidth: 180, widthGrow: 1 },
      { title: t("modal.objmod_links.col.type_b"), field: "obj_type_B", minWidth: 180, widthGrow: 1 },
    ];
  }

  function dashColumns() {
    const current = getCurrentDshp()?.dshpId ?? null;
    return [
      {
        title: `<i class="bi bi-star-fill" aria-hidden="true"></i><span class="visually-hidden">${te("modal.objmod_links.col.default")}</span>`,
        field: "is_default", width: 44, hozAlign: "center", headerSort: false,
        headerTooltip: t("modal.objmod_links.col.default_tooltip.@"),
        formatter: c => c.getValue()
          ? `<i class="bi bi-star-fill text-warning" role="img" title="${te("modal.objmod_links.col.default")}" aria-label="${te("modal.objmod_links.col.default")}"></i>`
          : "",
      },
      { title: t("common.id"), field: "dshp_id", width: 60, hozAlign: "right" },
      {
        title: t("common.name"), field: "dshp_name", minWidth: 180, widthGrow: 2,
        formatter: c => {
          const d = c.getRow().getData();
          const name = String(c.getValue() ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
          return d.dshp_id === current ? `${name} <span class="badge bg-info text-dark ms-1">${te("modal.objmod_links.in_use")}</span>` : name;
        },
      },
      { title: t("common.description"), field: "dshp_description", minWidth: 280, widthGrow: 3 },
      { title: t("modal.objmod_links.col.flow"), field: "flow_count", width: 70, hozAlign: "right", headerTooltip: t("modal.objmod_links.col.flow_tooltip") },
      { title: t("modal.objmod_links.col.updated"), field: "updated_at", width: 140, formatter: c => String(c.getValue() ?? "").slice(0, 16) },
    ];
  }

  function targetListUrl() {
    return currentTarget() === "dashboard" ? `${API}?action=list_dashboard_configs` : `${API}?action=list_objects`;
  }

  function initObjTable() {
    const isDash = currentTarget() === "dashboard";
    objTable = new Tabulator(objTableEl, {
      layout: "fitColumns",
      height: "20vh",
      placeholder: isDash ? t("modal.objmod_links.empty.dashboard.@") : t("modal.objmod_links.empty.objects.@"),
      selectable: 1,
      index: targetIdField(),
      ajaxResponse: (url, params, response) => response.data || [],
      columns: isDash ? dashColumns() : objectColumns(),
    });

    objTable.on("rowClick", (e, row) => selectTarget(row.getData()));
  }

  /** Ricrea la tabella di sopra per il bersaglio corrente e la carica. */
  async function rebuildObjTable() {
    if (objTable) {
      objTable.destroy();
      objTable = null;
    }
    initObjTable();
    // tableBuilt: setData su una tabella non ancora costruita viene ignorato
    await new Promise(res => objTable.on("tableBuilt", res));
    await objTable.setData(targetListUrl());
  }

  async function selectTarget(data) {
    selectedObj = data;
    hintEl.textContent = currentTarget() === "dashboard"
      ? t("modal.objmod_links.selected.dashboard", { name: data.dshp_name, id: data.dshp_id })
      : t("modal.objmod_links.selected.object.@", { name: data.obj_name, id: data.obj_id });

    resetDirty();

    try {
      await loadLinkableForSelectedObject();
      setTimeout(() => {
        if (modTable) modTable.redraw(true);
      }, 50);
    } catch (err) {
      console.error("Errore loadLinkableForSelectedObject:", err);
      alert(err.message || String(err));
    }
  }

  // ── Tabella dei collegabili (sotto) ───────────────────────────────────────

  function linkColumnDef() {
    return {
      title: t("modal.objmod_links.col.link"),
      field: "linked",
      width: 60,
      hozAlign: "center",
      headerSort: false,
      formatter: (cell) => {
        const v = !!cell.getValue();
        const disabled = !rowCanLink(cell.getRow().getData());
        return `<input type="checkbox" aria-label="${te("modal.objmod_links.linked")}" ${v ? "checked" : ""} ${disabled ? "disabled" : ""} />`;
      },
      cellClick: (e, cell) => {
        const row = cell.getRow();
        const d = row.getData();
        if (!rowCanLink(d)) return;

        const newVal = !d.linked;
        row.update({ linked: newVal });

        const id = Number(d[idField()]);
        const orig = !!d._orig_linked;

        if (orig === false && newVal === true) {
          dirtyAdded.add(id);
          dirtyRemoved.delete(id);
        } else if (orig === true && newVal === false) {
          dirtyRemoved.add(id);
          dirtyAdded.delete(id);
        } else {
          dirtyAdded.delete(id);
          dirtyRemoved.delete(id);
        }

        setSaveEnabled();
        updateCounter();
      },
    };
  }

  function modelColumns() {
    return [
      { title: t("common.id"), field: "mod_id", width: 60, hozAlign: "right" },
      { title: t("common.name"), field: "mod_name", minWidth: 180, widthGrow: 2 },
      { title: t("common.description"), field: "mod_description", minWidth: 260, widthGrow: 2 },
      { title: t("modal.objmod_links.col.wp.@"), field: "wp_id", width: 70, hozAlign: "right" },
      { title: t("common.folder"), field: "folder_name", minWidth: 160, widthGrow: 1 },
      { title: t("common.file"), field: "mod_filename", minWidth: 220, widthGrow: 2 },
      { title: t("modal.objmod_links.col.share"), field: "mod_share", width: 80, hozAlign: "right" },
      linkColumnDef(),
    ];
  }

  function flowColumns() {
    return [
      { title: t("common.id"), field: "flow_id", width: 60, hozAlign: "right" },
      { title: t("common.name"), field: "flow_name", minWidth: 200, widthGrow: 2 },
      { title: t("common.description"), field: "flow_description", minWidth: 280, widthGrow: 3 },
      { title: t("modal.objmod_links.col.wp.@"), field: "flow_wp", width: 70, hozAlign: "right" },
      { title: t("modal.objmod_links.col.share"), field: "flow_share", width: 80, hozAlign: "right" },
      linkColumnDef(),
    ];
  }

  function initModTable() {
    modTable = new Tabulator(modTableEl, {
      layout: "fitColumns",
      height: "20vh",
      placeholder: currentTarget() === "dashboard" ? t("modal.objmod_links.placeholder.dashboard") : t("modal.objmod_links.placeholder.objects.@"),
      reactiveData: true,
      index: idField(),
      columns: currentKind() === "flows" ? flowColumns() : modelColumns(),
    });
  }

  function rebuildModTableForKind() {
    if (modTable) {
      modTable.destroy();
      modTable = null;
    }
    initModTable();
  }

  async function loadLinkableForSelectedObject() {
    if (!selectedObj) {
      if (modTable) modTable.replaceData([]);
      updateCounter();
      return;
    }
    if (!modTable) initModTable();

    const scope = currentScope();
    let url;
    if (currentTarget() === "dashboard") {
      url = `${API}?action=list_flows_for_dashboard&scope=${encodeURIComponent(scope)}` +
            `&dshp_id=${encodeURIComponent(selectedObj.dshp_id)}`;
    } else {
      const action = currentKind() === "flows" ? "list_flows_for_object" : "list_models";
      url = `${API}?action=${action}&scope=${encodeURIComponent(scope)}` +
            `&obj_id=${encodeURIComponent(selectedObj.obj_id)}`;
    }

    const res = await apiGet(url);

    const rows = (res.data || []).map(r => ({
      ...r,
      _orig_linked: !!r.linked,
      linked: !!r.linked,
    }));

    await modTable.replaceData(rows);
    modTable.redraw(true);
    resetDirty();
  }

  async function saveChanges() {
    if (!targetCanLink()) return;
    if (dirtyAdded.size === 0 && dirtyRemoved.size === 0) return;

    const isDash = currentTarget() === "dashboard";
    const payload = isDash
      ? { action: "save_dashboard_flow_links", dshp_id: selectedObj.dshp_id }
      : { action: currentKind() === "flows" ? "save_flow_links" : "save_links", obj_id: selectedObj.obj_id };
    payload.added = Array.from(dirtyAdded);
    payload.removed = Array.from(dirtyRemoved);

    try {
      await apiPost(payload);
      if (isDash) {
        // Numero di flow aggiornato nella riga, selezione mantenuta
        const keepId = selectedObj.dshp_id;
        await objTable.setData(targetListUrl());
        objTable.selectRow(keepId);
        selectedObj = objTable.getRow(keepId)?.getData() ?? selectedObj;
        // Config in uso nella dashboard: il runtime riesegue i flow con i nuovi collegamenti
        const cur = getCurrentDshp();
        if (cur && cur.dshpId === keepId) {
          window.dispatchEvent(new CustomEvent("dcfg:loaded", { detail: { dshpId: cur.dshpId, dshpName: cur.dshpName } }));
        }
      }
      await loadLinkableForSelectedObject();
    } catch (e) {
      console.error("save_links error:", e);
      alert(e.message || String(e));
    }
  }

  btnSave.addEventListener("click", saveChanges);

  [scopeWp, scopeRes, scopeGlobal].forEach(r => {
    r.addEventListener("change", async () => {
      if (!selectedObj) return;
      try {
        await loadLinkableForSelectedObject();
      } catch (err) {
        console.error("Errore cambio scope:", err);
        alert(err.message || String(err));
      }
    });
  });

  [kindModels, kindFlows].forEach(r => {
    r.addEventListener("change", async () => {
      updateKindLabels();
      resetDirty();
      rebuildModTableForKind();
      try {
        await loadLinkableForSelectedObject();
      } catch (err) {
        console.error("Errore cambio kind:", err);
        alert(err.message || String(err));
      }
    });
  });

  /** Cambio di bersaglio (Oggetti/Dashboard): riparte da zero, senza selezione. */
  async function switchTarget(preselectDshpId = null) {
    selectedObj = null;
    hintEl.textContent = emptyHint();
    updateKindLabels();
    resetDirty();
    rebuildModTableForKind();
    try {
      await rebuildObjTable();
      if (preselectDshpId && currentTarget() === "dashboard") {
        const row = objTable.getRow(preselectDshpId);
        if (row) {
          objTable.selectRow(preselectDshpId);
          row.scrollTo?.();
          await selectTarget(row.getData());
        }
      }
    } catch (err) {
      console.error("Errore cambio bersaglio:", err);
      alert(err.message || String(err));
    }
  }

  [targetObjects, targetDash].forEach(r => {
    r.addEventListener("change", () => switchTarget());
  });

  modalEl.addEventListener("shown.bs.modal", function () {
    wpLabelEl.textContent = `${workpackage.wp_id}`;

    // Predefinito: Oggetti, salvo apertura da openLinksForDashboard()
    const preselect = pendingDshpId;
    pendingDshpId = null;
    targetDash.checked = !!preselect;
    targetObjects.checked = !preselect;
    kindModels.checked = !preselect;
    kindFlows.checked = !!preselect;

    switchTarget(preselect).then(() => {
      setTimeout(() => {
        if (objTable) objTable.redraw(true);
        if (modTable) modTable.redraw(true);
      }, 80);
    });
  });

  /** Apre la modale sul bersaglio Dashboard con la Config dshpId selezionata. */
  window.openLinksForDashboard = function (dshpId) {
    pendingDshpId = Number(dshpId) || null;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  };

})();
