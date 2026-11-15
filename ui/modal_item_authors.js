// ui/modal_item_authors.js
// Autori (A) e collaboratori (C) di un oggetto o modello (ui/modal_item_authors.php).
// Esporta window.raOpenItemAuthors({ kind: 'object'|'model', id, name, onSaved(authors) }).
// Le modifiche restano in memoria fino a Salva, che sostituisce l'elenco sul server
// (ui/modal_item_authors_tools.php ricontrolla permessi e candidati).
import { t } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const API = "ui/modal_item_authors_tools.php";

  const modalEl   = document.getElementById("modalItemAuthors");
  if (!modalEl) return;
  const titleEl   = document.getElementById("modalItemAuthorsTitle");
  const listEl    = document.getElementById("itemAuthorsList");
  const addRowEl  = document.getElementById("itemAuthorsAddRow");
  const selectEl  = document.getElementById("itemAuthorsCandidate");
  const addBtn    = document.getElementById("itemAuthorsAddBtn");
  const saveBtn   = document.getElementById("itemAuthorsSaveBtn");
  const statusEl  = document.getElementById("itemAuthorsStatus");

  let cur = null;   // { kind, id, authors:[{user_id,name,role}], candidates, canManage, onSaved, dirty }

  const roleLabel = (r) => t(r === "C" ? "modal.item_authors.role.C" : "modal.item_authors.role.A");
  const setStatus = (msg) => { statusEl.textContent = msg || ""; };

  /** Pulsante icona della riga (sposta su/giù, togli). */
  function iconBtn(icon, label, extraClass, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-sm btn-link p-0 " + extraClass;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
    b.addEventListener("click", onClick);
    return b;
  }

  /** Sposta l'elemento i di delta posizioni (l'ordine diventa auth_ord al salvataggio). */
  function move(i, delta, focusSel) {
    const j = i + delta;
    if (j < 0 || j >= cur.authors.length) return;
    [cur.authors[i], cur.authors[j]] = [cur.authors[j], cur.authors[i]];
    cur.dirty = true;
    render();
    // il fuoco resta sul pulsante corrispondente della riga spostata (o sull'altro, se ai bordi)
    const row = listEl.children[j];
    (row?.querySelector(focusSel + ":not([disabled])") || row?.querySelector("button:not([disabled])"))?.focus();
  }

  function render() {
    listEl.replaceChildren();
    cur.authors.forEach((a, i) => {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex align-items-center gap-2";

      // Posizione: la prima è quella mostrata come "creatore et al." nell'albero degli oggetti
      const pos = document.createElement("span");
      pos.className = "text-secondary small";
      pos.textContent = `${i + 1}.`;

      const name = document.createElement("span");
      name.className = "flex-grow-1";
      name.textContent = a.name;

      const badge = document.createElement("span");
      badge.className = "badge " + (a.role === "C" ? "text-bg-info" : "text-bg-secondary");
      badge.textContent = roleLabel(a.role);

      li.append(pos, name, badge);

      if (cur.canManage) {
        const up = iconBtn("bi-arrow-up", t("modal.item_authors.move_up", { name: a.name }), "text-secondary js-up", () => move(i, -1, ".js-up"));
        const down = iconBtn("bi-arrow-down", t("modal.item_authors.move_down", { name: a.name }), "text-secondary js-down", () => move(i, +1, ".js-down"));
        up.disabled = i === 0;
        down.disabled = i === cur.authors.length - 1;
        li.append(up, down);
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn-sm btn-link text-danger p-0";
        const label = t("modal.item_authors.remove", { name: a.name });
        del.title = label;
        del.setAttribute("aria-label", label);
        del.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
        del.addEventListener("click", () => {
          cur.authors = cur.authors.filter((x) => x.user_id !== a.user_id);
          cur.dirty = true;
          render();
          addBtn.focus();
        });
        li.append(del);
      }
      listEl.append(li);
    });
    if (!cur.authors.length) {
      const li = document.createElement("li");
      li.className = "list-group-item text-secondary";
      li.textContent = t("modal.item_authors.none");
      listEl.append(li);
    }

    // Candidati non ancora in elenco
    const inList = new Set(cur.authors.map((a) => a.user_id));
    selectEl.replaceChildren();
    for (const c of cur.candidates) {
      if (inList.has(c.user_id)) continue;
      const o = document.createElement("option");
      o.value = String(c.user_id);
      o.textContent = `${c.name} — ${roleLabel(c.role)}`;
      selectEl.append(o);
    }
    const hasCandidates = selectEl.options.length > 0;
    addRowEl.hidden = !cur.canManage;
    selectEl.disabled = addBtn.disabled = !hasCandidates;

    saveBtn.hidden = !cur.canManage;
    saveBtn.disabled = !cur.dirty;
  }

  addBtn.addEventListener("click", () => {
    const uid = Number(selectEl.value);
    const c = cur.candidates.find((x) => x.user_id === uid);
    if (!c) return;
    cur.authors.push({ user_id: c.user_id, name: c.name, role: c.role });
    cur.dirty = true;
    render();
    selectEl.focus();
  });

  saveBtn.addEventListener("click", async () => {
    if (!cur.authors.some((a) => a.role === "A")) {
      setStatus(t("modal.item_authors.err.need_author"));
      return;
    }
    saveBtn.disabled = true;
    setStatus(t("common.saving"));
    try {
      const r = await fetch(API, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save", kind: cur.kind, id: cur.id,
          authors: cur.authors.map((a) => ({ user_id: a.user_id, role: a.role })),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || t("errors.server_status", { status: r.status }));
      cur.authors = j.data.authors || [];
      cur.dirty = false;
      render();
      setStatus(t("common.saved"));
      cur.onSaved?.(cur.authors);
    } catch (e) {
      setStatus(e.message || String(e));
      saveBtn.disabled = false;
    }
  });

  modalEl.addEventListener("hide.bs.modal", (ev) => {
    if (cur?.dirty && !confirm(t("modal.item_authors.confirm_discard"))) ev.preventDefault();
  });

  window.raOpenItemAuthors = async function ({ kind, id, name, onSaved } = {}) {
    cur = { kind, id: Number(id), authors: [], candidates: [], canManage: false, onSaved, dirty: false };
    titleEl.textContent = t(kind === "model" ? "modal.item_authors.title_model.@" : "modal.item_authors.title_object.@", { name: name || `#${id}` });
    setStatus(t("common.loading"));
    listEl.replaceChildren();
    addRowEl.hidden = true;
    saveBtn.hidden = true;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    try {
      const r = await fetch(`${API}?action=get&kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`, { credentials: "same-origin" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || t("errors.server_status", { status: r.status }));
      cur.authors = j.data.authors || [];
      cur.candidates = j.data.candidates || [];
      cur.canManage = !!j.data.can_manage;
      render();
      setStatus(cur.canManage ? "" : t("modal.item_authors.read_only"));
    } catch (e) {
      setStatus(e.message || String(e));
    }
  };
})();
