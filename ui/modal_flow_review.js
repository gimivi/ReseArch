// modal_flow_review.js
// Modale "Validazione flow": coda dei flow in attesa, revisione del codice dei
// nodi critici (testo, mai eseguito), validazione singola o in blocco, storico e
// revoca. Tutti i controlli veri sono lato server (api/flow_review_tool.php).
// Step 6 di _doc/arch-abilitazioni.md.
// Testi: lang/*.json, chiavi modal.flow_review.* (_doc/arch-i18n-a11y.md §2).
import { t } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const modalEl = document.getElementById("modalFlowReview");
  if (!modalEl) return;

  const API = "api/flow_review_tool.php";
  const $ = (id) => document.getElementById(id);
  const el = {
    queue: $("frQueue"), queueCount: $("frQueueCount"), btnReload: $("btnFrReload"),
    bulkBox: $("frBulkBox"), btnBulk: $("btnFrBulk"), bulkCount: $("frBulkCount"),
    empty: $("frEmpty"), detail: $("frDetail"), title: $("frTitle"), meta: $("frMeta"),
    critical: $("frCritical"), removed: $("frRemoved"), note: $("frNote"),
    btnValidate: $("btnFrValidate"), btnHistory: $("btnFrHistory"), history: $("frHistory"),
    status: $("frStatus"), includeApproved: $("frIncludeApproved"),
  };

  let queue = [];
  let canBulk = false;
  let current = null;          // { item, detail }
  const selected = new Set();  // flow_id selezionati per la validazione in blocco

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

  function make(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---------------------------------------------------------------- coda
  function renderQueue() {
    el.queue.innerHTML = "";
    const pending = queue.filter(q => q.flow_review === "pending");
    el.queueCount.textContent = String(pending.length);
    el.bulkBox.classList.toggle("d-none", !canBulk || pending.length < 2);

    for (const q of queue) {
      const row = make("div", "list-group-item list-group-item-action py-1 d-flex gap-2 align-items-start"
        + (current?.item.flow_id === q.flow_id ? " active" : ""));
      if (canBulk && q.flow_review === "pending") {
        const cb = make("input", "form-check-input mt-1 flex-shrink-0");
        cb.type = "checkbox";
        cb.checked = selected.has(q.flow_id);
        cb.setAttribute("aria-label", t("modal.flow_review.select_flow", { id: q.flow_id }));
        cb.addEventListener("click", (ev) => ev.stopPropagation());
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(q.flow_id); else selected.delete(q.flow_id);
          updateBulk();
        });
        row.appendChild(cb);
      }
      const box = make("div", "flex-grow-1 text-truncate");
      box.appendChild(make("div", "fw-semibold text-truncate", `#${q.flow_id} ${q.flow_name}`));
      box.appendChild(make("div", "text-truncate opacity-75",
        `${q.author_name || "?"}${q.author_is_me ? " " + t("modal.flow_review.you") : ""} — ${q.res_title} / ${q.wp_title}`));
      const typeLabel = q.flow_type === "dashboard" ? t("modal.flow_review.type.dashboard") : t("modal.flow_review.type.object.@");
      box.appendChild(make("div", "opacity-75",
        q.flow_review === "approved"
          ? `${typeLabel} · ${t("modal.flow_review.approved")}`
          : `${typeLabel} · ${q.has_published ? t("modal.flow_review.changed_published") : t("modal.flow_review.never_published")}`));
      row.appendChild(box);
      row.addEventListener("click", () => openDetail(q));
      // Tastiera (WCAG 2.1.1): la riga si raggiunge col Tab e si apre con Invio o Spazio
      row.tabIndex = 0;
      if (current?.item.flow_id === q.flow_id) row.setAttribute("aria-current", "true");
      row.addEventListener("keydown", (ev) => {
        if (ev.target !== row || (ev.key !== "Enter" && ev.key !== " ")) return;
        ev.preventDefault();
        openDetail(q);
      });
      el.queue.appendChild(row);
    }
    if (!queue.length) el.queue.appendChild(make("div", "text-muted p-2", t("modal.flow_review.queue_empty")));
    updateBulk();
  }

  function updateBulk() {
    for (const id of [...selected]) if (!queue.some(q => q.flow_id === id)) selected.delete(id);
    el.bulkCount.textContent = String(selected.size);
    el.btnBulk.disabled = selected.size === 0;
  }

  async function loadQueue() {
    setStatus(t("common.loading"));
    const data = await api(`${API}?action=queue${el.includeApproved.checked ? "&include_approved=1" : ""}`);
    queue = data.items || [];
    canBulk = !!data.can_bulk;
    if (current && !queue.some(q => q.flow_id === current.item.flow_id)) closeDetail();
    renderQueue();
    setStatus("");
  }

  // ---------------------------------------------------------------- dettaglio
  function closeDetail() {
    current = null;
    el.detail.classList.add("d-none");
    el.empty.classList.remove("d-none");
  }

  function codeBlock(code) {
    const pre = make("pre", "border rounded p-2 small mb-1", code || t("modal.flow_review.code_empty"));
    pre.style.cssText = "max-height:260px;overflow:auto;background:#f8f9fa;color:#212529;white-space:pre-wrap;";
    return pre;
  }

  const STATUS_BADGE = { nuovo: "bg-warning text-dark", modificato: "bg-danger", invariato: "bg-secondary" };
  // Stato del nodo critico (valore del server, invariato) → testo mostrato
  const STATUS_KEY = { nuovo: "modal.flow_review.status.new", modificato: "modal.flow_review.status.changed", invariato: "modal.flow_review.status.unchanged" };

  function renderDetail() {
    const { item, detail } = current;
    el.title.textContent = `#${detail.flow_id} ${detail.flow_name}`;
    const metaParams = {
      author: item.author_name || "?", research: item.res_title, wp: item.wp_title,
      draft: detail.nodes_draft, published: detail.nodes_published,
    };
    el.meta.textContent = detail.nodes_published !== null
      ? t("modal.flow_review.meta_published.@", metaParams)
      : t("modal.flow_review.meta_unpublished.@", metaParams);

    el.critical.innerHTML = "";
    if (!detail.critical.length) {
      el.critical.appendChild(make("div", "alert alert-info small py-1",
        t("modal.flow_review.no_critical")));
    }
    for (const c of detail.critical) {
      const card = make("div", "border rounded p-2 mb-2");
      const head = make("div", "d-flex gap-2 align-items-center mb-1 small");
      head.appendChild(make("span", `badge ${STATUS_BADGE[c.status] || "bg-secondary"}`, STATUS_KEY[c.status] ? t(STATUS_KEY[c.status]) : c.status));
      head.appendChild(make("strong", "", `${c.title || c.type} #${c.id}`));
      head.appendChild(make("span", "text-muted", c.type));
      card.appendChild(head);

      card.appendChild(make("div", "small text-muted", t("modal.flow_review.code_draft")));
      card.appendChild(codeBlock(c.code));
      if (c.status === "modificato") {
        card.appendChild(make("div", "small text-muted", t("modal.flow_review.code_published")));
        card.appendChild(codeBlock(c.published_code));
      }
      // Solo admin: promuovere questo Script a nodo di libreria (codice non modificabile, riusabile)
      if (canBulk && c.type === "Script/Flexi") {
        const pb = make("button", "btn btn-outline-primary btn-sm py-0 mb-1", t("modal.flow_review.promote"));
        pb.type = "button";
        pb.addEventListener("click", () => promote(c));
        card.appendChild(pb);
      }
      const links = make("div", "small");
      links.appendChild(make("div", "", t("modal.flow_review.receives", { list: c.inputs.length ? c.inputs.join("; ") : t("modal.flow_review.no_links") })));
      links.appendChild(make("div", "", t("modal.flow_review.sends", { list: c.outputs.length ? c.outputs.join("; ") : t("modal.flow_review.no_links") })));
      card.appendChild(links);
      el.critical.appendChild(card);
    }

    el.removed.innerHTML = "";
    if (detail.removed?.length) {
      el.removed.appendChild(make("div", "small text-muted",
        t("modal.flow_review.removed", { list: detail.removed.map(r => `${r.title || r.type} #${r.id}`).join(", ") })));
    }

    // Già validato: niente da validare (resta lo storico, con la revoca per l'admin)
    el.btnValidate.disabled = detail.flow_review !== "pending";
    el.history.classList.add("d-none");
    el.empty.classList.add("d-none");
    el.detail.classList.remove("d-none");
  }

  async function openDetail(item) {
    try {
      setStatus(t("common.loading"));
      const detail = await api(`${API}?action=detail&flow_id=${item.flow_id}`);
      current = { item, detail };
      el.note.value = "";
      renderDetail();
      renderQueue();
      setStatus("");
    } catch (e) {
      setStatus(t("modal.flow_review.err", { msg: e.message }));
    }
  }

  // ---------------------------------------------------------------- azioni
  async function validate(items, note) {
    const res = await api(API, { action: "validate", items, note });
    const ok = res.validated.length;
    const ko = res.failed.map(f => `#${f.flow_id}: ${f.error}`);
    setStatus(ko.length
      ? t("modal.flow_review.validated_failed", { n: ok, list: ko.join("; ") })
      : t("modal.flow_review.validated", { n: ok }));
    return res;
  }

  async function validateCurrent() {
    if (!current) return;
    if (!confirm(t("modal.flow_review.confirm_validate.@", { id: current.detail.flow_id }))) return;
    try {
      el.btnValidate.disabled = true;
      await validate([{ flow_id: current.detail.flow_id, hash: current.detail.hash }], el.note.value.trim());
      closeDetail();
      await loadQueue();
    } catch (e) {
      setStatus(t("modal.flow_review.err", { msg: e.message }));
    } finally {
      el.btnValidate.disabled = false;
    }
  }

  async function validateBulk() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(t("modal.flow_review.confirm_bulk", { n: ids.length }))) return;
    try {
      el.btnBulk.disabled = true;
      setStatus(t("modal.flow_review.reading_versions"));
      // L'hash di ogni bozza, così la validazione riguarda esattamente il contenuto attuale
      const items = [];
      for (const id of ids) {
        const d = await api(`${API}?action=detail&flow_id=${id}`);
        if (d.hash) items.push({ flow_id: id, hash: d.hash });
      }
      await validate(items, "Validazione in blocco");   // nota salvata nello storico (dato): non tradotta
      selected.clear();
      closeDetail();
      await loadQueue();
    } catch (e) {
      setStatus(t("modal.flow_review.err", { msg: e.message }));
    } finally {
      updateBulk();
    }
  }

  async function promote(c) {
    const category = prompt(t("modal.flow_review.prompt_category"), "");
    if (!category) return;
    const name = prompt(t("modal.flow_review.prompt_name"), c.title && c.title !== "Script" ? c.title : "");
    if (!name) return;
    const desc = prompt(t("modal.flow_review.prompt_desc"), "") ?? "";
    try {
      const res = await api("api/fle_library_tool.php", {
        action: "promote", flow_id: current.detail.flow_id, node_id: c.id, category, name, desc,
      });
      setStatus(t("modal.flow_review.promoted", { node: `${res.category}/${res.name}`, version: res.version }));
    } catch (e) {
      setStatus(t("modal.flow_review.err", { msg: e.message }));
    }
  }

  async function showHistory() {
    if (!current) return;
    try {
      const data = await api(`${API}?action=history&flow_id=${current.detail.flow_id}`);
      el.history.innerHTML = "";
      if (!data.validations.length) el.history.appendChild(make("div", "small text-muted", t("modal.flow_review.history_empty")));
      const list = make("ul", "list-group small");
      for (const v of data.validations) {
        const li = make("li", "list-group-item py-1 d-flex gap-2 align-items-center");
        const txt = `${v.validated_at} — ${v.validated_by || "?"}${v.note ? ` — ${v.note}` : ""}` +
          (v.is_published ? " · " + t("modal.flow_review.history_published") : "") +
          (v.revoked_at ? " · " + t("modal.flow_review.history_revoked", { date: v.revoked_at }) : "");
        li.appendChild(make("span", "flex-grow-1", txt));
        if (data.can_revoke && !v.revoked_at) {
          const b = make("button", "btn btn-outline-danger btn-sm py-0", t("modal.flow_review.revoke"));
          b.type = "button";
          b.addEventListener("click", async () => {
            if (!confirm(t("modal.flow_review.confirm_revoke"))) return;
            try {
              await api(API, { action: "revoke", val_id: v.val_id });
              setStatus(t("modal.flow_review.revoked"));
              await showHistory();
              await loadQueue();
            } catch (e) { setStatus(t("modal.flow_review.err", { msg: e.message })); }
          });
          li.appendChild(b);
        }
        list.appendChild(li);
      }
      el.history.appendChild(list);
      el.history.classList.remove("d-none");
    } catch (e) {
      setStatus(t("modal.flow_review.err", { msg: e.message }));
    }
  }

  el.btnReload.addEventListener("click", () => loadQueue().catch(e => setStatus(t("modal.flow_review.err", { msg: e.message }))));
  el.includeApproved.addEventListener("change", () => loadQueue().catch(e => setStatus(t("modal.flow_review.err", { msg: e.message }))));
  el.btnValidate.addEventListener("click", validateCurrent);
  el.btnBulk.addEventListener("click", validateBulk);
  el.btnHistory.addEventListener("click", showHistory);
  modalEl.addEventListener("shown.bs.modal", () => loadQueue().catch(e => setStatus(t("modal.flow_review.err", { msg: e.message }))));
})();
