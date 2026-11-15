// ui/modal_db_maintenance.js — finestra "Manutenzione database" (ui/modal_db_maintenance.php).
// Analizza: chiede a api/db_maintenance_tool.php i controlli con righe trovate e id d'esempio.
// Pulisci: esegue i controlli spuntati (solo quelli correggibili), poi rianalizza.
import { t, te } from "../app/shared/i18n.mjs";

(function () {
  "use strict";
  const API = "api/db_maintenance_tool.php";
  const modalEl = document.getElementById("modalDbMaintenance");
  if (!modalEl) return;
  const tablesEl  = document.getElementById("dbmTables");
  const statusEl  = document.getElementById("dbmStatus");
  const btnAnalyze = document.getElementById("dbmAnalyze");
  const btnClean   = document.getElementById("dbmClean");

  const GROUPS = ["orphans", "periodic", "report"];
  const helpEl     = document.getElementById("modalDbMaintHelp");
  const helpTitle  = document.getElementById("modalDbMaintHelpLabel");
  const helpBody   = document.getElementById("dbmHelpBody");
  let skipAnalyze = false;   // ritorno dall'aiuto: la finestra si riapre senza rifare l'analisi
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  let rows = [];

  const setStatus = (msg, cls = "") => { statusEl.className = "mt-2 small " + cls; statusEl.textContent = msg || ""; };

  function updateCleanBtn() {
    btnClean.disabled = !tablesEl.querySelector("input[type=checkbox]:checked");
  }

  function render() {
    tablesEl.replaceChildren();
    for (const g of GROUPS) {
      const list = rows.filter((r) => r.group === g);
      if (!list.length) continue;
      const sec = document.createElement("section");
      sec.className = "mb-3";
      sec.innerHTML = `<h3 class="h6 mt-2">${te(`modal.db_maint.group.${g}`)}</h3>
        <p class="small text-secondary mb-1">${te(`modal.db_maint.group_help.${g}`)}</p>
        <div class="table-responsive"><table class="table table-sm align-middle mb-0">
          <thead><tr>
            <th scope="col" style="width:2.5rem">${g === "report" ? "" : `<span class="visually-hidden">${te("modal.db_maint.col.select")}</span>`}</th>
            <th scope="col">${te("modal.db_maint.col.check")}</th>
            <th scope="col" class="text-end" style="width:6rem">${te("modal.db_maint.col.rows")}</th>
            <th scope="col">${te("modal.db_maint.col.sample")}</th>
          </tr></thead>
          <tbody>${list.map((r) => {
            const label = t(`modal.db_maint.check.${r.key}`, { n: r.param ?? "" });
            const id = `dbm-${r.key}`;
            const can = r.fixable && Number(r.count) > 0;
            const cb = r.fixable
              ? `<input class="form-check-input" type="checkbox" id="${id}" data-key="${esc(r.key)}" ${can ? "checked" : "disabled"}>`
              : "";
            const count = r.count === null
              ? `<span class="text-danger" title="${esc(r.error)}">${te("modal.db_maint.unavailable")}</span>`
              : (Number(r.count) > 0 ? `<strong>${esc(r.count)}</strong>` : "0");
            const sample = (r.sample || []).map(esc).join(", ") + (Number(r.count) > (r.sample || []).length ? " …" : "");
            // Istruzioni operative (solo controlli "da verificare a mano", con query in r.help)
            const help = r.help
              ? ` <button type="button" class="btn btn-sm btn-link p-0 ms-1 align-baseline dbm-help" data-key="${esc(r.key)}"
                   title="${te("modal.db_maint.help.open", { check: label })}" aria-label="${te("modal.db_maint.help.open", { check: label })}">
                   <i class="bi bi-question-circle" aria-hidden="true"></i></button>`
              : "";
            return `<tr>
              <td>${cb}</td>
              <td>${r.fixable ? `<label for="${id}" class="mb-0">${esc(label)}</label>` : esc(label)}${help}</td>
              <td class="text-end">${count}</td>
              <td class="small text-secondary">${sample || "—"}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>`;
      tablesEl.appendChild(sec);
    }
    updateCleanBtn();
  }

  async function analyze() {
    btnAnalyze.disabled = true;
    btnClean.disabled = true;
    setStatus(t("modal.db_maint.analyzing"));
    try {
      const r = await fetch(`${API}?action=analyze`, { credentials: "same-origin" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || t("errors.server_status", { status: r.status }));
      rows = j.data || [];
      render();
      const total = rows.filter((x) => x.fixable).reduce((s, x) => s + (Number(x.count) || 0), 0);
      setStatus(total ? t("modal.db_maint.found", { n: total }) : t("modal.db_maint.nothing"));
    } catch (e) {
      setStatus(e.message || String(e), "text-danger");
    } finally {
      btnAnalyze.disabled = false;
    }
  }

  async function clean() {
    const keys = [...tablesEl.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.dataset.key);
    if (!keys.length) return;
    if (!confirm(t("modal.db_maint.confirm", { n: keys.length }))) return;
    btnClean.disabled = true;
    btnAnalyze.disabled = true;
    setStatus(t("modal.db_maint.cleaning"));
    try {
      const r = await fetch(API, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clean", keys }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || t("errors.server_status", { status: r.status }));
      const n = Object.values(j.data || {}).reduce((s, x) => s + (Number(x) || 0), 0);
      await analyze();
      setStatus(t("modal.db_maint.cleaned", { n }), "text-success");
    } catch (e) {
      setStatus(e.message || String(e), "text-danger");
      btnAnalyze.disabled = false;
      updateCleanBtn();
    }
  }

  // ── Aiuto: significato, come verificare, come correggere (query da copiare) ──
  function sqlBlock(sql) {
    const wrap = document.createElement("div");
    wrap.className = "position-relative mb-3";
    const pre = document.createElement("pre");
    pre.className = "bg-body-tertiary border rounded p-2 small mb-0";
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = sql;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn btn-sm btn-outline-secondary position-absolute top-0 end-0 m-1";
    copy.textContent = t("modal.db_maint.help.copy");
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(sql); copy.textContent = t("modal.db_maint.help.copied"); }
      catch { copy.textContent = t("modal.db_maint.help.copy_failed"); }
      setTimeout(() => { copy.textContent = t("modal.db_maint.help.copy"); }, 2000);
    });
    wrap.append(pre, copy);
    return wrap;
  }

  function openHelp(row) {
    const label = t(`modal.db_maint.check.${row.key}`, { n: row.param ?? "" });
    helpTitle.textContent = t("modal.db_maint.help.title", { check: label });
    const h = (txt) => { const e = document.createElement("h3"); e.className = "h6 mt-3"; e.textContent = txt; return e; };
    const p = (txt) => { const e = document.createElement("p"); e.className = "small"; e.textContent = txt; return e; };
    const ol = (txt) => {
      const e = document.createElement("ol");
      e.className = "small";
      for (const step of String(txt).split("\n").filter(Boolean)) {
        const li = document.createElement("li"); li.textContent = step; e.appendChild(li);
      }
      return e;
    };
    const ids = (row.sample || []).join(", ") + (Number(row.count) > (row.sample || []).length ? " …" : "");
    helpBody.replaceChildren(
      h(t("modal.db_maint.help.what")), p(t(`modal.db_maint.help.${row.key}.what`)),
      p(t("modal.db_maint.help.found", { n: row.count ?? 0, ids: ids || "—" })),
      h(t("modal.db_maint.help.check")), p(t("modal.db_maint.help.check_text")), sqlBlock(row.help.view),
      h(t("modal.db_maint.help.fix")), ol(t(`modal.db_maint.help.${row.key}.steps`)), sqlBlock(row.help.fix),
      p(t("modal.db_maint.help.after")),
    );
    // La finestra principale si chiude e torna alla chiusura dell'aiuto (due modali insieme
    // si contendono il fuoco); senza rifare l'analisi.
    modalEl.addEventListener("hidden.bs.modal", () => bootstrap.Modal.getOrCreateInstance(helpEl).show(), { once: true });
    helpEl.addEventListener("hidden.bs.modal", () => {
      skipAnalyze = true;
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }, { once: true });
    bootstrap.Modal.getInstance(modalEl)?.hide();
  }

  tablesEl.addEventListener("click", (ev) => {
    const b = ev.target.closest(".dbm-help");
    if (!b) return;
    const row = rows.find((r) => r.key === b.dataset.key);
    if (row?.help) openHelp(row);
  });

  tablesEl.addEventListener("change", updateCleanBtn);
  btnAnalyze.addEventListener("click", analyze);
  btnClean.addEventListener("click", clean);
  modalEl.addEventListener("shown.bs.modal", () => {
    if (skipAnalyze) { skipAnalyze = false; return; }
    analyze();
  });
})();
