// ui/modal_flow_embedded.js
// Picker "Flow embedded" — vedi ui/modal_flow_embedded.php per il contesto.
// Richiede: window.__FLOWEMB_CALLER_PANEL__ impostato dal click handler in
// dashboard.php prima di aprire #modalFlowEmbedded.

// Bersaglio "Dashboard" (2026-10-04, _doc/arch-flow-dashboard.md §3.4): in cima
// all'elenco la Config caricata nella dashboard — i suoi flow dashboard si aprono
// e si creano qui, come quelli di un oggetto. Senza Config caricata la voce dice
// "Nessuna dashboard attiva".

import { getOpenPanelsForFlow } from "../app/FLE_sub_modules/FLE-panels.mjs";
import { fleListForObject, fleListForDashboard } from "../app/FLE_sub_modules/FLE-api.mjs";
import { getCurrentDshp }       from "../app/dashboard_cfg.mjs";
// Testi: lang/*.json, chiavi modal.flow_embedded.* (_doc/arch-i18n-a11y.md §2).
import { t, te }                from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const modalEl = document.getElementById("modalFlowEmbedded");
  if (!modalEl) return;

  const panelsAreaEl  = document.getElementById("flowEmbPanelsArea");
  const targetTitleEl = document.getElementById("flowEmbTargetTitle");
  const flowsAreaEl   = document.getElementById("flowEmbFlowsArea");
  const statusEl      = document.getElementById("flowEmbStatus");
  const confirmBtn    = document.getElementById("flowEmbConfirmBtn");

  const LINKS_API = "ui/modal_objmod_links_tools.php";

  let callerPanel   = null;
  let selectedTarget = null;   // oggetto: { kind:'object', bodyEl, app, objId, name, panelEl } · dashboard: { kind:'dashboard', dshpId, name, app:'Dashboard' }
  let selectedFlowId = null;   // flow_id esistente sull'oggetto target (apri) — null = altra opzione
  let selectedSeed   = null;   // { flowId, scope } — nuovo flow COPIATO da un flow condiviso — null = altra opzione
  let seedScope       = "wp";  // scope corrente del selettore "copia da condiviso"

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  function setStatus(msg, isErr = false) {
    statusEl.textContent = msg || "";
    statusEl.className = "small me-auto " + (isErr ? "text-danger" : "text-muted");
  }

  function updateConfirmState() {
    confirmBtn.disabled = !(callerPanel && selectedTarget);
  }

  function renderPanelsList() {
    const panels = getOpenPanelsForFlow({ exclude: callerPanel })
      .filter(p => p.objId > 0)   // un flow embedded richiede sempre un obj_id valido
      .map(p => ({ ...p, kind: "object" }));

    const COLORS = { TJS: 'primary', ECH: 'success', MPS: 'warning', OSD: 'info', PSG: 'info' };

    const ul = document.createElement("div");
    ul.className = "list-group";

    // Prima voce: la Dashboard Config caricata (flow dashboard)
    const cfg = getCurrentDshp();
    const dashItem = document.createElement("button");
    dashItem.type = "button";
    dashItem.className = "list-group-item list-group-item-action py-2 px-2 small";
    if (cfg) {
      dashItem.innerHTML = `
        <span class="badge bg-dark me-2"><i class="bi bi-layout-three-columns" aria-hidden="true"></i> ${te("modal.flow_embedded.dashboard")}</span>
        ${esc(cfg.dshpName)}
        <span class="text-muted ms-1">#${cfg.dshpId}</span>
      `;
      const target = { kind: "dashboard", dshpId: cfg.dshpId, name: cfg.dshpName, app: "Dashboard" };
      dashItem.addEventListener("click", () => selectTarget(target, dashItem, ul));
    } else {
      dashItem.disabled = true;
      dashItem.innerHTML = `
        <span class="badge bg-secondary me-2"><i class="bi bi-layout-three-columns" aria-hidden="true"></i> ${te("modal.flow_embedded.dashboard")}</span>
        <span class="text-muted">${te("modal.flow_embedded.no_dashboard")}</span>
      `;
    }
    ul.appendChild(dashItem);

    if (panels.length === 0) {
      const none = document.createElement("div");
      none.className = "text-muted small mt-2";
      none.textContent = t("modal.flow_embedded.no_panels.@");
      panelsAreaEl.innerHTML = "";
      panelsAreaEl.appendChild(ul);
      panelsAreaEl.appendChild(none);
      return;
    }

    panels.forEach((p) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "list-group-item list-group-item-action py-2 px-2 small";
      item.innerHTML = `
        <span class="badge bg-${COLORS[p.app] ?? 'secondary'} me-2">${esc(p.app)}</span>
        ${esc(p.name)}
        <span class="text-muted ms-1">#${p.objId}</span>
      `;
      item.addEventListener("click", () => selectTarget(p, item, ul));
      ul.appendChild(item);
    });

    panelsAreaEl.innerHTML = "";
    panelsAreaEl.appendChild(ul);
  }

  async function selectTarget(target, itemEl, listEl) {
    selectedTarget = target;
    selectedFlowId = null;
    selectedSeed   = null;
    seedScope      = "wp";

    listEl.querySelectorAll(".list-group-item").forEach(el => el.classList.remove("active"));
    itemEl.classList.add("active");

    targetTitleEl.textContent = target.kind === "dashboard"
      ? t("modal.flow_embedded.target_dashboard", { name: target.name, id: target.dshpId })
      : t("modal.flow_embedded.target_object", { app: target.app, name: target.name, id: target.objId });
    flowsAreaEl.innerHTML = `<div class="text-muted small">${te("modal.flow_embedded.loading_flows")}</div>`;
    updateConfirmState();

    try {
      const res = target.kind === "dashboard"
        ? await fleListForDashboard(target.dshpId)
        : await fleListForObject(target.objId);
      const flows = res.ok ? (res.data ?? []) : [];
      renderFlowsList(flows);
    } catch (e) {
      flowsAreaEl.innerHTML = `<div class="text-danger small">${esc(e.message || String(e))}</div>`;
    }
  }

  function renderFlowsList(flows) {
    const form = document.createElement("div");
    const isDash = selectedTarget?.kind === "dashboard";

    // Opzione "Nuovo flow" — sempre presente, selezionata di default.
    const newWrap = document.createElement("div");
    newWrap.className = "form-check mb-2";
    newWrap.innerHTML = `
      <input class="form-check-input" type="radio" name="flowEmbPick" id="flowEmbPickNew" checked>
      <label class="form-check-label" for="flowEmbPickNew">
        <i class="bi bi-plus-circle me-1" aria-hidden="true"></i>${isDash ? te("modal.flow_embedded.new_dashboard") : te("modal.flow_embedded.new_object")}
      </label>
    `;
    form.appendChild(newWrap);
    newWrap.querySelector("input").addEventListener("change", () => { selectedFlowId = null; selectedSeed = null; });

    if (flows.length > 0) {
      const hr = document.createElement("hr");
      hr.className = "my-2";
      form.appendChild(hr);

      flows.forEach(f => {
        const wrap = document.createElement("div");
        wrap.className = "form-check mb-1";
        const id = `flowEmbPick${f.flow_id}`;
        wrap.innerHTML = `
          <input class="form-check-input" type="radio" name="flowEmbPick" id="${id}" value="${f.flow_id}">
          <label class="form-check-label" for="${id}">
            <span class="badge bg-secondary me-1">${f.flow_id}</span>
            ${esc(f.flow_name || "")}
          </label>
        `;
        wrap.querySelector("input").addEventListener("change", () => { selectedFlowId = f.flow_id; selectedSeed = null; });
        form.appendChild(wrap);
      });
    } else {
      const none = document.createElement("div");
      none.className = "text-muted small mt-1";
      none.textContent = isDash
        ? t("modal.flow_embedded.none_dashboard")
        : t("modal.flow_embedded.none_object.@");
      form.appendChild(none);
    }

    flowsAreaEl.innerHTML = "";
    flowsAreaEl.appendChild(form);
    flowsAreaEl.appendChild(renderSeedSection());
  }

  // Opzione "Nuovo, copiato da un flow condiviso esistente" — cerca flow
  // embedded ALTROVE (altro oggetto/WP/ricerca) con flow_share sufficiente
  // per lo scope scelto, riusando la stessa API/soglie di
  // ui/modal_objmod_links_tools.php (già usata per "Collega oggetto↔modello").
  // Selezionarne uno NON collega il record esistente: al conferma apre
  // model_FLE.mjs con il grafo copiato ma senza flow_id (__embeddedTarget.
  // seedFlowId), così il primo salvataggio crea una copia indipendente sul
  // nuovo oggetto invece di aggiornare la sorgente.
  function renderSeedSection() {
    const wrap = document.createElement("div");
    wrap.className = "mt-3 pt-2 border-top";

    const head = document.createElement("div");
    head.className = "small text-muted mb-1";
    head.innerHTML = `<i class="bi bi-files me-1" aria-hidden="true"></i>${te("modal.flow_embedded.seed_title")}`;
    wrap.appendChild(head);

    const scopeWrap = document.createElement("div");
    scopeWrap.className = "btn-group btn-group-sm mb-2";
    scopeWrap.setAttribute("role", "group");
    scopeWrap.setAttribute("aria-label", t("modal.flow_embedded.scope_group"));
    scopeWrap.innerHTML = `
      <input type="radio" class="btn-check" name="flowEmbSeedScope" id="flowEmbSeedScopeWp" autocomplete="off" checked>
      <label class="btn btn-outline-secondary" for="flowEmbSeedScopeWp">${te("modal.flow_embedded.scope.wp.@")}</label>
      <input type="radio" class="btn-check" name="flowEmbSeedScope" id="flowEmbSeedScopeRes" autocomplete="off">
      <label class="btn btn-outline-secondary" for="flowEmbSeedScopeRes">${te("modal.flow_embedded.scope.research.@")}</label>
      <input type="radio" class="btn-check" name="flowEmbSeedScope" id="flowEmbSeedScopeGlobal" autocomplete="off">
      <label class="btn btn-outline-secondary" for="flowEmbSeedScopeGlobal">${te("modal.flow_embedded.scope.global")}</label>
    `;
    wrap.appendChild(scopeWrap);

    const listWrap = document.createElement("div");
    wrap.appendChild(listWrap);

    const scopeInputs = { wp: "flowEmbSeedScopeWp", res: "flowEmbSeedScopeRes", global: "flowEmbSeedScopeGlobal" };
    Object.entries(scopeInputs).forEach(([scope, id]) => {
      scopeWrap.querySelector(`#${id}`).addEventListener("change", () => {
        seedScope = scope;
        selectedSeed = null;
        loadSeedCandidates(listWrap);
      });
    });

    loadSeedCandidates(listWrap);
    return wrap;
  }

  async function loadSeedCandidates(listWrap) {
    if (!selectedTarget) return;
    listWrap.innerHTML = `<div class="text-muted small">${te("common.loading")}</div>`;

    let flows = [];
    try {
      const url = selectedTarget.kind === "dashboard"
        ? `${LINKS_API}?action=list_flows_for_dashboard&scope=${encodeURIComponent(seedScope)}&dshp_id=${selectedTarget.dshpId}`
        : `${LINKS_API}?action=list_flows_for_object&scope=${encodeURIComponent(seedScope)}&obj_id=${selectedTarget.objId}`;
      const res = await fetch(url, { credentials: "same-origin" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || t("modal.flow_embedded.err_load"));
      flows = json.data ?? [];
    } catch (e) {
      listWrap.innerHTML = `<div class="text-danger small">${esc(e.message || String(e))}</div>`;
      return;
    }

    if (flows.length === 0) {
      listWrap.innerHTML = `<div class="text-muted small">${te("modal.flow_embedded.no_seed")}</div>`;
      return;
    }

    const form = document.createElement("div");
    flows.forEach(f => {
      const wrap = document.createElement("div");
      wrap.className = "form-check mb-1";
      const id = `flowEmbSeedPick${f.flow_id}`;
      wrap.innerHTML = `
        <input class="form-check-input" type="radio" name="flowEmbPick" id="${id}">
        <label class="form-check-label" for="${id}">
          <span class="badge bg-secondary me-1">${f.flow_id}</span>
          ${esc(f.flow_name || "")}
        </label>
      `;
      wrap.querySelector("input").addEventListener("change", () => {
        selectedFlowId = null;
        selectedSeed = { flowId: f.flow_id, scope: seedScope };
      });
      form.appendChild(wrap);
    });

    listWrap.innerHTML = "";
    listWrap.appendChild(form);
  }

  function resetPicker() {
    selectedTarget = null;
    selectedFlowId = null;
    selectedSeed   = null;
    seedScope      = "wp";
    targetTitleEl.textContent = t("modal.flow_embedded.select_target.@");
    flowsAreaEl.innerHTML = "";
    setStatus("");
    updateConfirmState();
  }

  modalEl.addEventListener("shown.bs.modal", function () {
    callerPanel = window.__FLOWEMB_CALLER_PANEL__ || null;
    resetPicker();
    renderPanelsList();
  });

  confirmBtn.addEventListener("click", () => {
    if (!callerPanel || !selectedTarget) return;

    const renderer = window.ModelRenderers?.FLE;
    if (typeof renderer !== "function") {
      setStatus(t("modal.flow_embedded.err_renderer"), true);
      return;
    }

    const isDash = selectedTarget.kind === "dashboard";
    const label = isDash
      ? t("modal.flow_embedded.panel_label_dashboard", { name: selectedTarget.name })
      : t("modal.flow_embedded.panel_label_object", { app: selectedTarget.app, name: selectedTarget.name });

    // Oggetto sintetico: object.obj_app='FLE' fa risolvere model_FLE.mjs
    // (vedi template_XXX.mjs::loadSpec, che sceglie il modulo in base a
    // obj_app, non alla chiave usata per invocare il renderer). obj_id resta
    // null: non è un vero oggetto DB, il target reale sta in __embeddedTarget.
    // 'FLE' qui è solo la SIGLA INTERNA dell'editor dei flow, non un'APP degli
    // oggetti: dal 2026-10-04 non esistono oggetti obj_app='FLE' e FLE non è
    // nella tabella app. Stessa cosa in app/dashboard_cfg.mjs e FLE-panels.mjs.
    const syntheticObject = {
      obj_app: "FLE",
      obj_id:  null,
      obj_name: label,
      __embeddedTarget: {
        kind:   isDash ? "dashboard" : "object",
        objId:  isDash ? null : selectedTarget.objId,
        dshpId: isDash ? selectedTarget.dshpId : null,
        app:    selectedTarget.app,
        name:   selectedTarget.name,
        bodyEl: isDash ? null : selectedTarget.bodyEl,
        flowId: selectedFlowId,
        seedFlowId: selectedSeed?.flowId ?? null,
        seedScope:  selectedSeed?.scope ?? null,
      },
    };

    try {
      renderer(callerPanel, syntheticObject, []);
    } catch (e) {
      console.error("Renderer FLE error:", e);
      setStatus(t("modal.flow_embedded.err_open"), true);
      return;
    }

    const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
    bsModal.hide();
  });
})();
