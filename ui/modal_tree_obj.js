// ui/modal_tree_obj.js
// Richiede global: research[res_id,res_perm], workpackage[wp_id,wp_perm], user[id,user_type]
// e opzionale: window.ModelRenderers[appKey](models, {object, container})

import { t, te } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const modalEl = document.getElementById("modalTreeObj");
  if (!modalEl) return;

  const wpLabelEl = document.getElementById("treeObjWpLabel");
  const statusEl = document.getElementById("treeObjStatus");
  const refreshBtn = document.getElementById("treeObjRefreshBtn");

  const treeContainer = document.getElementById("treeObjContainer");

  const selectedTitleEl = document.getElementById("treeObjSelectedTitle");
  const detailsEl = document.getElementById("treeObjDetails");
  const modelsAreaEl = document.getElementById("treeObjModelsArea");
  const modelsCountEl = document.getElementById("treeObjModelsCount");
  const flowsAreaEl = document.getElementById("treeObjFlowsArea");
  const flowsCountEl = document.getElementById("treeObjFlowsCount");

  const API = "ui/modal_tree_obj_tools.php";

  let treeData = null;
  let selectedObj = null;

  let callerPanel = null;
  let lastLoadedModels = [];
  let lastLoadedFlows = [];
  const selectedModelIds = new Set();  // mod_id dei modelli da caricare
  const selectedFlowIds  = new Set();  // flow_id dei flow embedded da caricare



  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  /**
   * Autori di un oggetto o modello: il primo autore sempre visibile; se ce ne sono altri
   * (autori o collaboratori) segue "et al.", focalizzabile, con l'elenco completo nel tooltip.
   * list = [{ user_id, name, role:'A'|'C' }] nell'ordine scelto (auth_ord, modal_tree_obj_tools.php):
   * il primo è il creatore, salvo spostamenti nella finestra degli autori.
   */
  function authorsHtml(list) {
    if (!Array.isArray(list) || !list.length) return "";
    const first = list[0];
    let html = esc(first.name);
    if (list.length > 1) {
      const full = list
        .map(a => `${a.name} (${t(a.role === "C" ? "modal.item_authors.role.C" : "modal.item_authors.role.A")})`)
        .join(", ");
      html += ` <span class="text-decoration-underline" style="cursor:help" tabindex="0"` +
              ` data-bs-toggle="tooltip" data-bs-title="${esc(full)}"` +
              ` aria-label="${esc(t("modal.tree_obj.authors_all", { list: full }))}">${te("modal.tree_obj.et_al")}</span>`;
    }
    return html;
  }

  function enableTooltips(rootEl) {
    rootEl.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
      try { new bootstrap.Tooltip(el); } catch {}
    });
  }

  function setStatus(msg, isErr = false) {
    statusEl.textContent = msg || "";
    statusEl.className = "ms-auto small " + (isErr ? "text-danger" : "text-muted");
  }

  async function apiGet(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    const j = await r.json().catch(() => null);
    if (!j) throw new Error(t('errors.invalid_response'));
    if (!r.ok || !j.success) throw new Error(j.error || t('errors.server_status', { status: r.status }));
    return j;
  }

  function clearSelection() {
    selectedObj = null;
    selectedModelIds.clear();
    selectedFlowIds.clear();
    selectedTitleEl.textContent = t('modal.tree_obj.select_object.@');
    detailsEl.innerHTML = "";
    modelsAreaEl.innerHTML = "";
    modelsCountEl.textContent = "";
    flowsAreaEl.innerHTML = "";
    flowsCountEl.textContent = "";
  }

  /**
   * Intestazione di un gruppo dell'albero: <button aria-expanded> che apre/chiude bodyEl
   * (tastiera: Tab, Invio, Spazio; WCAG 2.1.1, fase 7 di _doc/arch-i18n-a11y.md).
   */
  function makeToggle(labelHtml, bodyEl, open, extraClass) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-link p-0 text-start text-body text-decoration-none " + (extraClass || "");
    const render = (isOpen) => {
      btn.innerHTML = `<span aria-hidden="true">${isOpen ? "▾" : "▸"}</span> ${labelHtml}`;
      btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      bodyEl.style.display = isOpen ? "" : "none";
    };
    render(open);
    btn.addEventListener("click", () => render(bodyEl.style.display === "none"));
    return btn;
  }

  // Simple collapsible tree builder (TypeA -> TypeB -> Objects)
function buildTreeUI(data) {
  treeContainer.innerHTML = "";

  if (!data || !data.groups || !data.groups.length) {
    treeContainer.innerHTML = `<div class="text-muted small">${te('modal.tree_obj.empty_tree.@')}</div>`;
    return;
  }

  // ROOT: "Ambiti informativi"
  const rootWrap = document.createElement("div");
  rootWrap.className = "mb-2";

  const rootBody = document.createElement("div");
  rootBody.style.marginLeft = "14px";
  rootWrap.appendChild(makeToggle(te('modal.tree_obj.root'), rootBody, true, "fw-semibold"));   // aperta di default
  rootWrap.appendChild(rootBody);

  // Helper: render lista oggetti
  function appendObjects(containerEl, objectsArr) {
    (objectsArr || []).forEach((obj) => {
      // Pulsante: si sceglie anche da tastiera; aria-current segna l'oggetto scelto
      const item = document.createElement("button");
      item.type = "button";
      item.className = "btn btn-sm w-100 d-flex align-items-center gap-2 py-1 px-1 rounded text-start text-body tree-obj-item";

      // placeholder icon
      const ico = document.createElement("span");
      ico.textContent = "📄";
      ico.title = t('modal.tree_obj.object_icon.@');
      ico.setAttribute("aria-hidden", "true");
      item.appendChild(ico);

      const name = document.createElement("span");
      name.innerHTML = esc(obj.obj_name);
      item.appendChild(name);

      item.onmouseenter = () => item.classList.add("bg-light");
      item.onmouseleave = () => item.classList.remove("bg-light");
      item.onclick = async () => {
        treeContainer.querySelectorAll(".tree-obj-item[aria-current]").forEach(b => b.removeAttribute("aria-current"));
        item.setAttribute("aria-current", "true");
        await selectObject(obj);
      };

      containerEl.appendChild(item);
    });
  }

  // TYPE A -> (optional TYPE B) -> objects
  data.groups.forEach((gA) => {
    const aWrap = document.createElement("div");
    aWrap.className = "mb-2";

    const aBody = document.createElement("div");
    aBody.style.marginLeft = "14px";
    aWrap.appendChild(makeToggle(esc(gA.typeA || "(TypeA)"), aBody, false, "fw-semibold"));
    aWrap.appendChild(aBody);

    (gA.groupsB || []).forEach((gB) => {
      const typeB = String(gB.typeB ?? "").trim();

      // Se TypeB vuoto: porta gli oggetti direttamente sotto TypeA
      if (typeB === "") {
        appendObjects(aBody, gB.objects);
        return;
      }

      // Altrimenti: livello TypeB
      const bWrap = document.createElement("div");
      bWrap.className = "mb-1";

      const bBody = document.createElement("div");
      bBody.style.marginLeft = "14px";
      bWrap.appendChild(makeToggle(esc(typeB), bBody, false, ""));
      bWrap.appendChild(bBody);

      appendObjects(bBody, gB.objects);
      aBody.appendChild(bWrap);
    });

    rootBody.appendChild(aWrap);
  });

  treeContainer.appendChild(rootWrap);
}




function renderObjectDetails(obj) {
  const parts = [];

  parts.push(`<div><strong>${esc(obj.obj_name)}</strong> <span class="text-muted small">(id=${esc(obj.obj_id)})</span></div>`);

  // Descrizione (nuova)
  if (obj.obj_description && String(obj.obj_description).trim() !== "") {
    parts.push(`<div class="mt-1">${esc(obj.obj_description)}</div>`);
  } else {
    parts.push(`<div class="mt-1 text-muted small">${te('modal.tree_obj.no_description')}</div>`);
  }

  parts.push(
    `<div class="small text-muted mt-2">` +
      `TypeA: ${esc(obj.obj_type_A)} • ` +
      `TypeB: ${esc(obj.obj_type_B)} • ` +
      `App: ${esc(obj.obj_app || "")}` +
    `</div>`
  );

  const authors = authorsHtml(obj.authors);
  if (authors) parts.push(`<div class="small mt-1">${te("modal.tree_obj.authors")} ${authors}</div>`);

  detailsEl.innerHTML = parts.join("");
  enableTooltips(detailsEl);
}

function renderModelsList(models) {
  if (!models || models.length === 0) {
    modelsAreaEl.innerHTML = `<div class="text-muted small">${te('modal.tree_obj.no_models.@')}</div>`;
    return;
  }

  // Default: tutti selezionati
  selectedModelIds.clear();
  models.forEach(m => selectedModelIds.add(m.mod_id));

  const ul = document.createElement("ul");
  ul.className = "list-group";

  models.forEach(m => {
    const li = document.createElement("li");
    li.className = "list-group-item d-flex gap-2 align-items-center";

    // Checkbox selezione
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "form-check-input flex-shrink-0";
    chk.checked = true;
    chk.title = t('modal.tree_obj.include_model.@');
    chk.setAttribute("aria-labelledby", `treeObjModName_${m.mod_id}`);
    chk.addEventListener("change", () => {
      if (chk.checked) selectedModelIds.add(m.mod_id);
      else selectedModelIds.delete(m.mod_id);
      // Aggiorna stato del Load button
      const loadBtn = document.getElementById("treeObjLoadBtn");
      if (loadBtn) loadBtn.disabled = !(selectedObj && callerPanel && selectedModelIds.size > 0);
    });
    li.appendChild(chk);

    // mod_id con tooltip su filename
    const idSpan = document.createElement("span");
    idSpan.className = "badge bg-secondary";
    idSpan.textContent = String(m.mod_id);
    idSpan.setAttribute("data-bs-toggle", "tooltip");
    idSpan.setAttribute("data-bs-title", String(m.mod_filename || ""));
    li.appendChild(idSpan);

    // mod_name con tooltip su description
    const nameSpan = document.createElement("span");
    nameSpan.className = "text-body";
    nameSpan.id = `treeObjModName_${m.mod_id}`;
    nameSpan.textContent = String(m.mod_name || "");
    nameSpan.setAttribute("data-bs-toggle", "tooltip");
    nameSpan.setAttribute("data-bs-title", String(m.mod_description || ""));
    li.appendChild(nameSpan);

    // Autori del modello: primo autore + "et al." con l'elenco nel tooltip
    const authors = authorsHtml(m.authors);
    if (authors) {
      const authSpan = document.createElement("span");
      authSpan.className = "small text-muted ms-auto text-end";
      authSpan.innerHTML = authors;
      li.appendChild(authSpan);
    }

    ul.appendChild(li);
  });

  modelsAreaEl.innerHTML = "";
  modelsAreaEl.appendChild(ul);

  // abilita i tooltips bootstrap
  enableTooltips(ul);
}

function renderFlowsList(flows) {
  flowsCountEl.textContent = flows?.length ? t('modal.tree_obj.flows_count', { n: flows.length }) : "";

  if (!flows || flows.length === 0) {
    flowsAreaEl.innerHTML = `<div class="text-muted small">${te('modal.tree_obj.no_flows.@')}</div>`;
    return;
  }

  // Default: tutti selezionati — stesso pattern di renderModelsList/selectedModelIds.
  selectedFlowIds.clear();
  flows.forEach(f => selectedFlowIds.add(f.flow_id));

  const ul = document.createElement("ul");
  ul.className = "list-group";

  flows.forEach(f => {
    const li = document.createElement("li");
    li.className = "list-group-item d-flex gap-2 align-items-center";

    // Flow di configurazione: sempre caricati (e per primi) — casella bloccata.
    // Il vincolo vale comunque lato runner (FLE-api.mjs::filterSelectedFlows).
    const isConfig = f.flow_role === "config";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "form-check-input flex-shrink-0";
    chk.checked = true;
    chk.disabled = isConfig;
    chk.title = isConfig
      ? t('modal.tree_obj.flow_config_title.@')
      : t('modal.tree_obj.flow_run_title');
    chk.setAttribute("aria-labelledby", `treeObjFlowName_${f.flow_id}`);
    chk.addEventListener("change", () => {
      if (chk.checked) selectedFlowIds.add(f.flow_id);
      else selectedFlowIds.delete(f.flow_id);
    });
    li.appendChild(chk);

    const idSpan = document.createElement("span");
    idSpan.className = "badge bg-secondary";
    idSpan.textContent = String(f.flow_id);
    li.appendChild(idSpan);

    const nameSpan = document.createElement("span");
    nameSpan.className = "text-body";
    nameSpan.id = `treeObjFlowName_${f.flow_id}`;
    nameSpan.textContent = String(f.flow_name || "");
    if (f.flow_description) {
      nameSpan.setAttribute("data-bs-toggle", "tooltip");
      nameSpan.setAttribute("data-bs-title", String(f.flow_description));
    }
    li.appendChild(nameSpan);

    if (isConfig) {
      const roleSpan = document.createElement("span");
      roleSpan.className = "badge bg-info text-dark ms-auto";
      roleSpan.textContent = t('modal.tree_obj.config_badge');
      li.appendChild(roleSpan);
    }

    ul.appendChild(li);
  });

  flowsAreaEl.innerHTML = "";
  flowsAreaEl.appendChild(ul);

  ul.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
    try { new bootstrap.Tooltip(el); } catch {}
  });
}



  async function selectObject(obj) {
    selectedObj = obj;
    selectedTitleEl.textContent = t('modal.tree_obj.selected_object.@', { name: obj.obj_name });
    renderObjectDetails(obj);
    modelsAreaEl.innerHTML = `<div class="text-muted small">${te('modal.tree_obj.loading_models.@')}</div>`;
    modelsCountEl.textContent = "";
    flowsAreaEl.innerHTML = "";
    flowsCountEl.textContent = "";

    try {
      const res = await apiGet(`${API}?action=models_by_obj&obj_id=${encodeURIComponent(obj.obj_id)}`);
      const models = res.data?.models || [];
      const flows  = res.data?.flows  || [];
      modelsCountEl.textContent = t('modal.tree_obj.models_count.@', { n: models.length });

        lastLoadedModels = models;
        lastLoadedFlows  = flows;
        renderModelsList(models);  // imposta selectedModelIds con tutti i mod_id
        renderFlowsList(flows);    // imposta selectedFlowIds con tutti i flow_id

        const loadBtn = document.getElementById("treeObjLoadBtn");
        if (loadBtn) loadBtn.disabled = !(selectedObj && callerPanel && selectedModelIds.size > 0);

    } catch (e) {
      modelsAreaEl.innerHTML = `<div class="text-danger small" role="alert">${esc(e.message || String(e))}</div>`;
    }
  }

  async function loadTree() {
    setStatus(t('modal.tree_obj.loading_tree'));
    clearSelection();

    try {
      const res = await apiGet(`${API}?action=tree`);
      treeData = res.data || null;
      buildTreeUI(treeData);
      setStatus("");

    } catch (e) {
      treeContainer.innerHTML = `<div class="text-danger small" role="alert">${esc(e.message || String(e))}</div>`;
      setStatus(e.message || String(e), true);
    }
  }

  refreshBtn?.addEventListener("click", loadTree);

    modalEl.addEventListener("shown.bs.modal", function () {
    callerPanel = window.__TREEOBJ_CALLER_PANEL__ || null;

    const loadBtn = document.getElementById("treeObjLoadBtn");
    if (loadBtn) loadBtn.disabled = true;

    wpLabelEl.textContent = `${workpackage?.wp_id ?? ""}`;
    loadTree();
    });




    const loadBtn = document.getElementById("treeObjLoadBtn");
    loadBtn?.addEventListener("click", () => {
    if (!selectedObj) return;

    if (!callerPanel) {
        alert(t('modal.tree_obj.err.no_caller_panel'));
        return;
    }

    const appKey = String(selectedObj.obj_app || "").trim();
    const renderer = (appKey && window.ModelRenderers) ? window.ModelRenderers[appKey] : null;

    if (typeof renderer !== "function") {
        alert(t('modal.tree_obj.err.no_renderer', { app: appKey }));
        return;
    }

    // Carica solo i modelli con checkbox selezionata
    const modelsToLoad = (lastLoadedModels || []).filter(m => selectedModelIds.has(m.mod_id));
    if (!modelsToLoad.length) {
        alert(t('modal.tree_obj.err.select_model.@'));
        return;
    }

    // Selezione flow embedded da eseguire: passata "a bordo" di selectedObj
    // invece che come parametro aggiuntivo, per non toccare la convenzione
    // "FINAL" (container, object, models) di model_renderers.js. I flow-runner
    // (TJS/OSD/MPS) leggono object.__loadFlowIds per filtrare cosa caricare;
    // se assente (pannello aperto per altra via, es. picker di test FLE),
    // caricano tutti i flow collegati come comportamento di default.
    selectedObj.__loadFlowIds = (lastLoadedFlows || [])
        .filter(f => selectedFlowIds.has(f.flow_id))
        .map(f => f.flow_id);

    try {
           renderer(callerPanel, selectedObj, modelsToLoad);

    } catch (e) {
        console.error("Renderer error:", e);
        alert(t('modal.tree_obj.err.renderer'));
    }
    });

})();
