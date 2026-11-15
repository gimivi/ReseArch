// modal_mod_spec_templates.js
// Gestione dei template mod_spec (tabella mod_spec_templates) — solo
// amministratore. Elenco a sinistra (filtro per APP + ricerca), dettaglio a
// destra. Il controllo vero dei permessi è lato server
// (ui/modal_mod_spec_templates_tools.php). Step 1 di _doc/arch-abilitazioni.md.

import { t, te } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const modalEl = document.getElementById("modalModSpecTemplates");
  if (!modalEl) return;

  const API = "ui/modal_mod_spec_templates_tools.php";
  const $ = (id) => document.getElementById(id);

  const el = {
    filterApp: $("mstFilterApp"), search: $("mstSearch"), list: $("mstList"),
    empty: $("mstEmpty"), form: $("mstForm"), status: $("mstStatus"),
    app: $("mstApp"), name: $("mstName"), level: $("mstLevel"), sort: $("mstSort"),
    active: $("mstActive"), help: $("mstHelp"), spec: $("mstSpec"),
    btnNew: $("btnMstNew"), btnSave: $("btnMstSave"),
    btnDuplicate: $("btnMstDuplicate"), btnDelete: $("btnMstDelete"),
  };

  let templates = [];
  let apps = [];
  let current = null;   // template in modifica (copia), tpl_id 0 = nuovo
  let dirty = false;

  async function api(url, payload) {
    const opt = { credentials: "same-origin" };
    if (payload) {
      opt.method = "POST";
      opt.headers = { "Content-Type": "application/json" };
      opt.body = JSON.stringify(payload);
    }
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => null);
    if (!j) throw new Error(t("errors.invalid_response"));
    if (!r.ok || !j.success) throw new Error(j.error || t("errors.server_status", { status: r.status }));
    return j.data;
  }

  function setStatus(msg) { el.status.textContent = msg || ""; }

  function appTitle(cod) {
    return apps.find(a => a.cod === cod)?.title || cod;
  }

  // ---------------------------------------------------------------- elenco
  function renderList() {
    const f = el.filterApp.value;
    const q = el.search.value.trim().toLowerCase();
    el.list.innerHTML = "";
    const shown = templates.filter(tpl =>
      (!f || tpl.app_cod === f) && (!q || tpl.tpl_name.toLowerCase().includes(q)));

    for (const tpl of shown) {
      const a = document.createElement("button");
      a.type = "button";
      a.className = "list-group-item list-group-item-action py-1"
        + (current && current.tpl_id === tpl.tpl_id ? " active" : "");
      a.innerHTML = `<div class="d-flex justify-content-between gap-2">
          <span class="text-truncate"></span>
          <span class="badge bg-secondary flex-shrink-0"></span>
        </div>`;
      a.querySelector(".text-truncate").textContent = tpl.tpl_name;
      a.querySelector(".badge").textContent = tpl.app_cod;
      if (!tpl.is_active) a.classList.add("text-decoration-line-through", "opacity-50");
      if (tpl.tpl_level === "advanced") a.title = t("modal.mod_spec_templates.level.advanced_short");
      a.addEventListener("click", () => selectTemplate(tpl));
      el.list.appendChild(a);
    }
    if (!shown.length) el.list.innerHTML = `<div class="text-muted small p-2">${te("modal.mod_spec_templates.no_templates")}</div>`;
  }

  function fillAppSelects() {
    const keep = el.filterApp.value;
    el.filterApp.innerHTML = `<option value="">${te("modal.mod_spec_templates.all_apps")}</option>`;
    el.app.innerHTML = "";
    for (const a of apps) {
      el.filterApp.add(new Option(`${a.cod} — ${a.title}`, a.cod));
      el.app.add(new Option(`${a.cod} — ${a.title}`, a.cod));
    }
    el.filterApp.value = keep;
  }

  // -------------------------------------------------------------- dettaglio
  function confirmDiscard() {
    return !dirty || confirm(t("modal.mod_spec_templates.discard"));
  }

  function selectTemplate(tpl) {
    if (!confirmDiscard()) return;
    current = { ...tpl };
    el.app.value = tpl.app_cod;
    el.name.value = tpl.tpl_name;
    el.level.value = tpl.tpl_level;
    el.sort.value = tpl.tpl_sort;
    el.active.checked = !!tpl.is_active;
    el.help.value = tpl.tpl_help;
    el.spec.value = tpl.tpl_spec;
    el.empty.classList.add("d-none");
    el.form.classList.remove("d-none");
    el.btnDelete.disabled = !tpl.tpl_id;
    el.btnDuplicate.disabled = !tpl.tpl_id;
    dirty = false;
    setStatus(tpl.tpl_id
      ? t("modal.mod_spec_templates.selected", { id: tpl.tpl_id, app: appTitle(tpl.app_cod) })
      : t("modal.mod_spec_templates.new_unsaved"));
    renderList();
  }

  function newTemplate(base) {
    const app = base?.app_cod || el.filterApp.value || "CUS";
    const sameApp = templates.filter(tpl => tpl.app_cod === app);
    selectTemplate({
      tpl_id: 0,
      app_cod: app,
      tpl_name: base ? t("modal.mod_spec_templates.name_copy", { name: base.tpl_name }) : "",
      tpl_level: base?.tpl_level || "base",
      tpl_sort: Math.max(0, ...sameApp.map(tpl => tpl.tpl_sort)) + 10,
      is_active: 1,
      tpl_help: base?.tpl_help || "",
      tpl_spec: base?.tpl_spec || "{\n}",
    });
    dirty = true; // un nuovo template va salvato o scartato esplicitamente
    el.name.focus();
  }

  async function save() {
    if (!current) return;
    let spec;
    try {
      spec = JSON.parse(el.spec.value);
    } catch (e) {
      setStatus(t("modal.mod_spec_templates.spec_invalid_detail", { error: e.message }));
      el.spec.focus();
      return;
    }
    if (spec === null || typeof spec !== "object") {
      setStatus(t("modal.mod_spec_templates.spec_invalid"));
      return;
    }
    const payload = {
      tpl_id: current.tpl_id || 0,
      app_cod: el.app.value,
      tpl_name: el.name.value.trim(),
      tpl_level: el.level.value,
      tpl_help: el.help.value,
      tpl_spec: el.spec.value,
      tpl_sort: Number(el.sort.value) || 0,
      is_active: el.active.checked ? 1 : 0,
    };
    if (!payload.tpl_name) { setStatus(t("modal.mod_spec_templates.name_required")); el.name.focus(); return; }

    try {
      el.btnSave.disabled = true;
      const res = await api(API, { action: "save", tpl: payload });
      dirty = false;
      await load(res.tpl_id);
      setStatus(t("common.saved"));
    } catch (e) {
      setStatus(t("modal.mod_spec_templates.error", { error: e.message }));
    } finally {
      el.btnSave.disabled = false;
    }
  }

  async function remove() {
    if (!current?.tpl_id) return;
    if (!confirm(t("modal.mod_spec_templates.delete_confirm", { name: current.tpl_name }))) return;
    try {
      await api(API, { action: "delete", tpl_id: current.tpl_id });
      dirty = false;
      current = null;
      el.form.classList.add("d-none");
      el.empty.classList.remove("d-none");
      await load();
      setStatus(t("common.deleted"));
    } catch (e) {
      setStatus(t("modal.mod_spec_templates.error", { error: e.message }));
    }
  }

  async function load(selectId) {
    setStatus(t("common.loading"));
    const data = await api(`${API}?action=list`);
    templates = data.templates || [];
    apps = data.apps || [];
    fillAppSelects();
    const sel = selectId ? templates.find(tpl => tpl.tpl_id === selectId) : null;
    if (sel) { dirty = false; selectTemplate(sel); } else renderList();
    if (!sel) setStatus(t("modal.mod_spec_templates.count", { n: templates.length }));
  }

  // ---------------------------------------------------------------- eventi
  el.filterApp.addEventListener("change", renderList);
  el.search.addEventListener("input", renderList);
  el.btnNew.addEventListener("click", () => { if (confirmDiscard()) { dirty = false; newTemplate(null); } });
  el.btnDuplicate.addEventListener("click", () => { if (current && confirmDiscard()) { dirty = false; newTemplate(current); } });
  el.btnSave.addEventListener("click", save);
  el.btnDelete.addEventListener("click", remove);
  for (const input of [el.app, el.name, el.level, el.sort, el.active, el.help, el.spec]) {
    input.addEventListener("input", () => { dirty = true; });
    input.addEventListener("change", () => { dirty = true; });
  }

  modalEl.addEventListener("shown.bs.modal", () => {
    load(current?.tpl_id).catch(e => setStatus(t("modal.mod_spec_templates.error", { error: e.message })));
  });
  modalEl.addEventListener("hide.bs.modal", (ev) => {
    if (dirty && !confirm(t("modal.mod_spec_templates.close_unsaved"))) {
      ev.preventDefault();
      return;
    }
    dirty = false;
  });
})();
