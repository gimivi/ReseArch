// modal_capabilities.js
// Modale admin "Abilitazioni": profili (abilitazioni + utenti) e configurazione
// delle APP. Il controllo vero dei permessi è lato server
// (ui/modal_capabilities_tools.php). Step 2 di _doc/arch-abilitazioni.md.

import { t, te } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const modalEl = document.getElementById("modalCapabilities");
  if (!modalEl) return;

  const API = "ui/modal_capabilities_tools.php";
  const $ = (id) => document.getElementById(id);

  const el = {
    status: $("capStatus"),
    profileList: $("capProfileList"), btnNewProfile: $("btnCapNewProfile"),
    empty: $("capProfileEmpty"), form: $("capProfileForm"),
    name: $("capProfileName"), desc: $("capProfileDesc"), isDefault: $("capProfileDefault"),
    grantApps: $("capGrantApps"), grantTplAdvanced: $("capGrantTplAdvanced"), grantPerms: $("capGrantPerms"),
    membersBox: $("capMembersBox"), members: $("capMembers"), membersCount: $("capMembersCount"),
    membersSearch: $("capMembersSearch"), membersOnlySel: $("capMembersOnlySel"),
    btnSaveProfile: $("btnCapSaveProfile"), btnDeleteProfile: $("btnCapDeleteProfile"),
    appsBody: $("capAppsBody"), btnSaveApps: $("btnCapSaveApps"),
    cspTab: $("capTabCspBtn"), cspBody: $("capCspBody"),
    btnCspReload: $("btnCapCspReload"), btnCspClear: $("btnCapCspClear"),
  };

  const ACCESS_LABEL = { all: t("common.all"), granted: t("modal.capabilities.access.granted"), admin: t("modal.capabilities.access.admin.@") };
  const STATUS_LABEL = { active: t("modal.capabilities.status.active"), beta: t("modal.capabilities.status.beta"), hidden: t("modal.capabilities.status.hidden") };

  let data = { profiles: [], apps: [], users: [], perms: [] };
  let current = null;        // profilo in modifica (copia); profile_id 0 = nuovo
  let selMembers = new Set();
  let profileDirty = false;
  let appsDirty = false;

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

  function check(id, label, checked, extraClass = "") {
    const wrap = document.createElement("div");
    wrap.className = "form-check " + extraClass;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    input.id = id;
    input.checked = checked;
    const lab = document.createElement("label");
    lab.className = "form-check-label";
    lab.htmlFor = id;
    lab.textContent = label;
    wrap.append(input, lab);
    return { wrap, input };
  }

  // ================================================================ PROFILI
  function renderProfileList() {
    el.profileList.innerHTML = "";
    for (const p of data.profiles) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "list-group-item list-group-item-action py-1"
        + (current && current.profile_id === p.profile_id ? " active" : "");
      const who = p.is_default ? t("modal.capabilities.members_all") : t("modal.capabilities.members_n", { n: p.members.length });
      b.innerHTML = `<div class="d-flex justify-content-between gap-2"><span class="text-truncate"></span><span class="badge bg-secondary flex-shrink-0"></span></div>`;
      b.querySelector(".text-truncate").textContent = p.profile_name;
      b.querySelector(".badge").textContent = who;
      b.title = p.profile_desc || "";
      b.addEventListener("click", () => selectProfile(p));
      el.profileList.appendChild(b);
    }
    if (!data.profiles.length) el.profileList.innerHTML = `<div class="text-muted small p-2">${te("modal.capabilities.no_profiles")}</div>`;
  }

  function hasGrant(p, kind, ref) {
    return p.grants.some(g => g.kind === kind && g.ref === ref);
  }

  function renderGrants(p) {
    el.grantApps.innerHTML = "";
    for (const a of data.apps) {
      const note = a.app_access === "granted" ? "" : a.app_access === "all" ? ` — ${t("modal.capabilities.app_note.all")}` : ` — ${t("modal.capabilities.app_note.admin.@")}`;
      const c = check(`capApp_${a.app_cod}`, `${a.app_cod} — ${a.app_title}${note}`, hasGrant(p, "app", a.app_cod),
        a.app_access === "granted" ? "" : "opacity-50");
      c.input.dataset.app = a.app_cod;
      c.input.addEventListener("change", () => { profileDirty = true; });
      el.grantApps.appendChild(c.wrap);
    }
    el.grantTplAdvanced.checked = hasGrant(p, "template_level", "advanced");

    el.grantPerms.innerHTML = "";
    for (const perm of data.perms) {
      const c = check(`capPerm_${perm.ref}`, perm.label, hasGrant(p, "perm", perm.ref));
      c.input.dataset.perm = perm.ref;
      c.input.addEventListener("change", () => { profileDirty = true; });
      el.grantPerms.appendChild(c.wrap);
    }
  }

  function renderMembers() {
    const q = el.membersSearch.value.trim().toLowerCase();
    const onlySel = el.membersOnlySel.checked;
    el.members.innerHTML = "";
    let shown = 0;
    for (const u of data.users) {
      const label = `${u.last_name || ""} ${u.first_name || ""}`.trim() + ` — ${u.email}` + (u.user_type === "X" ? " " + t("modal.capabilities.member_admin_note.@") : "");
      if (q && !label.toLowerCase().includes(q)) continue;
      if (onlySel && !selMembers.has(u.user_id)) continue;
      const c = check(`capUser_${u.user_id}`, label, selMembers.has(u.user_id));
      c.input.addEventListener("change", () => {
        if (c.input.checked) selMembers.add(u.user_id); else selMembers.delete(u.user_id);
        profileDirty = true;
        updateMembersCount();
      });
      el.members.appendChild(c.wrap);
      shown++;
    }
    if (!shown) el.members.innerHTML = `<div class="text-muted">${te("modal.capabilities.no_users")}</div>`;
    updateMembersCount();
  }

  function updateMembersCount() {
    el.membersCount.textContent = `(${selMembers.size})`;
  }

  function applyDefaultState() {
    // "Vale per tutti": l'elenco utenti non serve (e al salvataggio viene svuotato).
    el.membersBox.classList.toggle("opacity-50", el.isDefault.checked);
    el.membersBox.querySelectorAll("input").forEach(i => { i.disabled = el.isDefault.checked; });
  }

  function confirmDiscard() {
    return !profileDirty || confirm(t("modal.capabilities.discard_profile"));
  }

  function selectProfile(p) {
    if (!confirmDiscard()) return;
    current = { ...p };
    el.name.value = p.profile_name;
    el.desc.value = p.profile_desc;
    el.isDefault.checked = !!p.is_default;
    selMembers = new Set(p.members);
    el.membersSearch.value = "";
    el.membersOnlySel.checked = false;
    renderGrants(p);
    renderMembers();
    applyDefaultState();
    el.empty.classList.add("d-none");
    el.form.classList.remove("d-none");
    el.btnDeleteProfile.disabled = !p.profile_id;
    profileDirty = false;
    renderProfileList();
    setStatus(p.profile_id ? "" : t("modal.capabilities.new_profile_unsaved"));
  }

  function collectGrants() {
    const grants = [];
    el.grantApps.querySelectorAll("input[data-app]").forEach(i => {
      if (i.checked) grants.push({ kind: "app", ref: i.dataset.app });
    });
    if (el.grantTplAdvanced.checked) grants.push({ kind: "template_level", ref: "advanced" });
    el.grantPerms.querySelectorAll("input[data-perm]").forEach(i => {
      if (i.checked) grants.push({ kind: "perm", ref: i.dataset.perm });
    });
    return grants;
  }

  async function saveProfile() {
    if (!current) return;
    const profile = {
      profile_id: current.profile_id || 0,
      profile_name: el.name.value.trim(),
      profile_desc: el.desc.value.trim(),
      is_default: el.isDefault.checked ? 1 : 0,
      grants: collectGrants(),
      members: [...selMembers],
    };
    if (!profile.profile_name) { setStatus(t("modal.capabilities.name_required")); el.name.focus(); return; }
    try {
      el.btnSaveProfile.disabled = true;
      const res = await api(API, { action: "save_profile", profile });
      profileDirty = false;
      await load(res.profile_id);
      setStatus(t("modal.capabilities.profile_saved"));
    } catch (e) {
      setStatus(t("modal.capabilities.error", { error: e.message }));
    } finally {
      el.btnSaveProfile.disabled = false;
    }
  }

  async function deleteProfile() {
    if (!current?.profile_id) return;
    if (!confirm(t("modal.capabilities.delete_confirm", { name: current.profile_name }))) return;
    try {
      await api(API, { action: "delete_profile", profile_id: current.profile_id });
      profileDirty = false;
      current = null;
      el.form.classList.add("d-none");
      el.empty.classList.remove("d-none");
      await load();
      setStatus(t("modal.capabilities.profile_deleted"));
    } catch (e) {
      setStatus(t("modal.capabilities.error", { error: e.message }));
    }
  }

  // ================================================================ APP
  function select(options, value) {
    const s = document.createElement("select");
    s.className = "form-select form-select-sm";
    for (const [v, label] of Object.entries(options)) s.add(new Option(label, v));
    s.value = value;
    return s;
  }

  function renderApps() {
    el.appsBody.innerHTML = "";
    for (const a of data.apps) {
      const tr = document.createElement("tr");
      tr.dataset.app = a.app_cod;
      const tdCod = document.createElement("td"); tdCod.textContent = a.app_cod;
      const tdTitle = document.createElement("td"); tdTitle.textContent = a.app_title;
      const tdAccess = document.createElement("td");
      const sAccess = select(ACCESS_LABEL, a.app_access); sAccess.dataset.field = "app_access";
      sAccess.setAttribute("aria-label", t("modal.capabilities.aria.access_for", { app: a.app_cod }));
      tdAccess.appendChild(sAccess);
      const tdStatus = document.createElement("td");
      const sStatus = select(STATUS_LABEL, a.app_status); sStatus.dataset.field = "app_status";
      sStatus.setAttribute("aria-label", t("modal.capabilities.aria.status_for", { app: a.app_cod }));
      tdStatus.appendChild(sStatus);
      const tdSort = document.createElement("td");
      const iSort = document.createElement("input");
      iSort.type = "number"; iSort.step = "10"; iSort.className = "form-control form-control-sm";
      iSort.value = a.app_sort; iSort.dataset.field = "app_sort";
      iSort.setAttribute("aria-label", t("modal.capabilities.aria.sort_for", { app: a.app_cod }));
      tdSort.appendChild(iSort);
      tr.append(tdCod, tdTitle, tdAccess, tdStatus, tdSort);
      el.appsBody.appendChild(tr);
    }
    appsDirty = false;
    el.btnSaveApps.disabled = true;
  }

  async function saveApps() {
    const apps = [...el.appsBody.querySelectorAll("tr")].map(tr => ({
      app_cod: tr.dataset.app,
      app_access: tr.querySelector('[data-field="app_access"]').value,
      app_status: tr.querySelector('[data-field="app_status"]').value,
      app_sort: Number(tr.querySelector('[data-field="app_sort"]').value) || 0,
    }));
    try {
      el.btnSaveApps.disabled = true;
      await api(API, { action: "save_apps", apps });
      // Aggiorna i dati locali senza ricaricare il profilo aperto (che
      // potrebbe avere modifiche non ancora salvate).
      const byCod = new Map(apps.map(a => [a.app_cod, a]));
      data.apps = data.apps
        .map(a => ({ ...a, ...byCod.get(a.app_cod) }))
        .sort((x, y) => x.app_sort - y.app_sort || x.app_title.localeCompare(y.app_title));
      renderApps();
      if (current && !profileDirty) renderGrants(current);
      setStatus(t("modal.capabilities.apps_saved"));
    } catch (e) {
      el.btnSaveApps.disabled = false;
      setStatus(t("modal.capabilities.error", { error: e.message }));
    }
  }

  // ================================================================ CSP
  async function loadCsp() {
    el.cspBody.innerHTML = `<tr><td colspan="5" class="text-muted">${te("common.loading")}</td></tr>`;
    try {
      const rows = await api(`${API}?action=csp_list`);
      el.cspBody.innerHTML = "";
      for (const r of rows) {
        const tr = document.createElement("tr");
        for (const [v, cls] of [[r.directive, ""], [r.blocked, "text-break"], [r.page, ""], [r.hits, "text-end"], [r.last_seen, "text-nowrap"]]) {
          const td = document.createElement("td");
          td.textContent = v;
          if (cls) td.className = cls;
          tr.appendChild(td);
        }
        tr.title = r.sample || "";   // URL completo del primo caso, al passaggio del mouse
        el.cspBody.appendChild(tr);
      }
      if (!rows.length) el.cspBody.innerHTML = `<tr><td colspan="5" class="text-muted">${te("modal.capabilities.csp_none")}</td></tr>`;
    } catch (e) {
      el.cspBody.innerHTML = "";
      setStatus(t("modal.capabilities.csp_error", { error: e.message }));
    }
  }

  async function clearCsp() {
    if (!confirm(t("modal.capabilities.csp_clear_confirm"))) return;
    try {
      const res = await api(API, { action: "csp_clear" });
      setStatus(t("modal.capabilities.csp_deleted", { n: Number(res.deleted) || 0 }));
      await loadCsp();
    } catch (e) {
      setStatus(t("modal.capabilities.error", { error: e.message }));
    }
  }

  // ================================================================ caricamento
  async function load(selectId) {
    setStatus(t("common.loading"));
    data = await api(`${API}?action=list`);
    renderApps();
    const sel = selectId ? data.profiles.find(p => p.profile_id === selectId) : null;
    if (sel) { profileDirty = false; selectProfile(sel); } else renderProfileList();
    if (!sel) setStatus(t("modal.capabilities.loaded", { profiles: data.profiles.length, users: data.users.length }));
  }

  // ================================================================ eventi
  el.btnNewProfile.addEventListener("click", () => {
    if (!confirmDiscard()) return;
    profileDirty = false;
    selectProfile({ profile_id: 0, profile_name: "", profile_desc: "", is_default: 0, grants: [], members: [] });
    profileDirty = true;
    el.name.focus();
  });
  el.btnSaveProfile.addEventListener("click", saveProfile);
  el.btnDeleteProfile.addEventListener("click", deleteProfile);
  el.isDefault.addEventListener("change", () => { profileDirty = true; applyDefaultState(); });
  for (const i of [el.name, el.desc, el.grantTplAdvanced]) {
    i.addEventListener("input", () => { profileDirty = true; });
    i.addEventListener("change", () => { profileDirty = true; });
  }
  el.membersSearch.addEventListener("input", () => { renderMembers(); applyDefaultState(); });
  el.membersOnlySel.addEventListener("change", () => { renderMembers(); applyDefaultState(); });
  el.appsBody.addEventListener("change", () => { appsDirty = true; el.btnSaveApps.disabled = false; });
  el.appsBody.addEventListener("input", () => { appsDirty = true; el.btnSaveApps.disabled = false; });
  el.btnSaveApps.addEventListener("click", saveApps);
  el.cspTab.addEventListener("shown.bs.tab", loadCsp);
  el.btnCspReload.addEventListener("click", loadCsp);
  el.btnCspClear.addEventListener("click", clearCsp);

  modalEl.addEventListener("shown.bs.modal", () => {
    load(current?.profile_id).catch(e => setStatus(t("modal.capabilities.error", { error: e.message })));
  });
  modalEl.addEventListener("hide.bs.modal", (ev) => {
    if ((profileDirty || appsDirty) && !confirm(t("modal.capabilities.close_unsaved"))) {
      ev.preventDefault();
      return;
    }
    profileDirty = false;
    appsDirty = false;
  });
})();
