// modal_fle_library.js
// Modale admin "Libreria nodi": elenco dei nodi di libreria, nuova versione,
// ritiro/riattivazione delle versioni. Controlli veri lato server
// (api/fle_library_tool.php). Step 8 di _doc/arch-abilitazioni.md.
// Testi: lang/*.json, chiavi modal.fle_library.* (_doc/arch-i18n-a11y.md §2).
import { t, te } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const modalEl = document.getElementById("modalFleLibrary");
  if (!modalEl) return;

  const API = "api/fle_library_tool.php";
  const $ = (id) => document.getElementById(id);
  const el = {
    list: $("flList"), btnNew: $("btnFlNew"), empty: $("flEmpty"), form: $("flForm"),
    category: $("flCategory"), name: $("flName"), fixedNote: $("flFixedNote"), desc: $("flDesc"),
    inputs: $("flInputs"), outputs: $("flOutputs"), code: $("flCode"),
    btnSave: $("btnFlSave"), versions: $("flVersions"), status: $("flStatus"),
  };

  let nodes = [];
  let current = null;   // { category, name, versions } oppure null per un nodo nuovo

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
  const setStatus = (m) => { el.status.textContent = m || ""; };
  const key = (n) => `${n.category}/${n.name}`;

  function renderList() {
    el.list.innerHTML = "";
    for (const n of nodes) {
      const last = n.versions[n.versions.length - 1];
      const active = n.versions.filter(v => v.status === "approved").length;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "list-group-item list-group-item-action py-1" + (current && key(current) === key(n) ? " active" : "");
      b.innerHTML = `<div class="d-flex justify-content-between gap-2"><span class="text-truncate"></span><span class="badge bg-secondary flex-shrink-0"></span></div>`;
      b.querySelector(".text-truncate").textContent = key(n);
      b.querySelector(".badge").textContent = `v${last.version}`;
      if (!active) b.classList.add("opacity-50");
      b.addEventListener("click", () => select(n));
      el.list.appendChild(b);
    }
    if (!nodes.length) el.list.innerHTML = `<div class="text-muted small p-2">${te("modal.fle_library.list_empty")}</div>`;
  }

  function select(n) {
    current = n;
    const last = n ? n.versions[n.versions.length - 1] : null;
    el.category.value = n?.category ?? "";
    el.name.value     = n?.name ?? "";
    el.category.disabled = el.name.disabled = !!n;
    el.fixedNote.textContent = n ? t("modal.fle_library.fixed_note") : "";
    el.desc.value    = last?.desc ?? "";
    el.inputs.value  = last?.inputs ?? "";
    el.outputs.value = last?.outputs ?? "result";
    el.code.value    = last?.code ?? "return { result: null };";
    renderVersions();
    el.empty.classList.add("d-none");
    el.form.classList.remove("d-none");
    renderList();
  }

  function renderVersions() {
    el.versions.innerHTML = "";
    if (!current) { el.versions.innerHTML = `<li class="list-group-item text-muted">${te("modal.fle_library.no_versions")}</li>`; return; }
    for (const v of [...current.versions].reverse()) {
      const li = document.createElement("li");
      li.className = "list-group-item py-1 d-flex gap-2 align-items-center";
      const txt = document.createElement("span");
      txt.className = "flex-grow-1";
      txt.textContent = `v${v.version} — ${v.created_at} — ${v.approved_by || "?"}` + (v.status === "retired" ? " · " + t("modal.fle_library.retired_tag") : "");
      li.appendChild(txt);
      const show = document.createElement("button");
      show.type = "button"; show.className = "btn btn-outline-secondary btn-sm py-0"; show.textContent = t("modal.fle_library.load_into_form");
      show.title = t("modal.fle_library.load_into_form_hint");
      show.addEventListener("click", () => {
        el.desc.value = v.desc; el.inputs.value = v.inputs; el.outputs.value = v.outputs; el.code.value = v.code;
        setStatus(t("modal.fle_library.loaded_version", { version: v.version }));
      });
      li.appendChild(show);
      const tog = document.createElement("button");
      tog.type = "button";
      tog.className = "btn btn-sm py-0 " + (v.status === "retired" ? "btn-outline-success" : "btn-outline-danger");
      tog.textContent = v.status === "retired" ? t("modal.fle_library.reactivate") : t("modal.fle_library.retire");
      tog.title = v.status === "retired" ? t("modal.fle_library.reactivate_hint") : t("modal.fle_library.retire_hint");
      tog.addEventListener("click", async () => {
        try {
          await api(API, { action: "set_status", lib_id: v.lib_id, status: v.status === "retired" ? "approved" : "retired" });
          await load(key(current));
          setStatus(t("modal.fle_library.status_updated"));
        } catch (e) { setStatus(t("modal.fle_library.err", { msg: e.message })); }
      });
      li.appendChild(tog);
      el.versions.appendChild(li);
    }
  }

  async function save() {
    const payload = {
      action: "save",
      category: el.category.value.trim(),
      name: el.name.value.trim(),
      desc: el.desc.value.trim(),
      inputs: el.inputs.value,
      outputs: el.outputs.value,
      code: el.code.value,
    };
    try {
      // Controllo di sintassi locale: il server non esegue JS
      // eslint-disable-next-line no-new-func
      new Function(...payload.inputs.split(",").map(s => s.trim()).filter(Boolean), "vars", payload.code);
    } catch (e) {
      setStatus(t("modal.fle_library.err_syntax", { msg: e.message }));
      return;
    }
    const node = `${payload.category}/${payload.name}`;
    const question = current
      ? t("modal.fle_library.confirm_save_version", { node })
      : t("modal.fle_library.confirm_save_new", { node });
    if (!confirm(question)) return;
    try {
      el.btnSave.disabled = true;
      const res = await api(API, payload);
      await load(`${res.category}/${res.name}`);
      setStatus(t("modal.fle_library.saved_version", { version: res.version }));
    } catch (e) {
      setStatus(t("modal.fle_library.err", { msg: e.message }));
    } finally {
      el.btnSave.disabled = false;
    }
  }

  async function load(selectKey) {
    nodes = await api(`${API}?action=admin_list`);
    const sel = selectKey ? nodes.find(n => key(n) === selectKey) : null;
    if (sel) select(sel); else renderList();
  }

  el.btnNew.addEventListener("click", () => { select(null); setStatus(t("modal.fle_library.status_new_node")); el.category.focus(); });
  el.btnSave.addEventListener("click", save);
  modalEl.addEventListener("shown.bs.modal", () => load(current ? key(current) : null).catch(e => setStatus(t("modal.fle_library.err", { msg: e.message }))));
})();
