// modal_platform_users.js
// Richiede global: Tabulator, userType, userId (dell'utente corrente —
// entrambi esposti da researches.php). Usati solo per la UI (nascondere il
// bottone "Accedi come" sulla propria riga/sugli altri admin): il controllo
// vero è lato server (modal_platform_users_tools.php, api/impersonate_tool.php).
// La modale stessa è raggiungibile solo da amministratori — voce di menu
// nascosta a chiunque altro (ui/header.php, $showPlatformUsers).

import { t, te } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const modalEl = document.getElementById("modalPlatformUsers");
  if (!modalEl) return;

  const API = "ui/modal_platform_users_tools.php";

  function apiGet(url) {
    return fetch(url, { credentials: "same-origin" }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!j) throw new Error(t("errors.invalid_response"));
      if (!r.ok || !j.success) throw new Error(j.error || t("errors.server_status", { status: r.status }));
      return j;
    });
  }

  function apiPost(payload) {
    return fetch(API, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!j) throw new Error(t("errors.invalid_response"));
      if (!r.ok || !j.success) throw new Error(j.error || t("errors.server_status", { status: r.status }));
      return j;
    });
  }

  function setStatus(el, msg) {
    if (el) el.textContent = msg || "";
  }

  const ROLE_LABEL = { "V": t("role.V.@"), "U": t("role.U.@"), "I": t("role.I.@"), "P": t("role.P.@") };

  const tableEl = document.getElementById("platformUsersTable");
  const statusEl = document.getElementById("platformUsersStatus");
  const btnSave = document.getElementById("btnPlatformUsersSave");
  const btnCancel = document.getElementById("btnPlatformUsersCancel");

  let dirty = false;
  function markDirty() {
    dirty = true;
    btnSave.disabled = false;
    btnCancel.disabled = false;
  }
  function clearDirty() {
    dirty = false;
    btnSave.disabled = true;
    btnCancel.disabled = true;
  }

  let table = null;
  let snapshot = null;

  function takeSnapshot() {
    snapshot = table ? table.getData().map(r => ({ ...r })) : null;
  }
  function restoreSnapshot() {
    if (table && snapshot) {
      table.replaceData(snapshot.map(r => ({ ...r })));
      clearDirty();
      setStatus(statusEl, t("modal.platform_users.changes_reverted"));
    }
  }

  async function load() {
    setStatus(statusEl, t("common.loading"));
    const res = await apiGet(`${API}?action=list_users`);
    const rows = (res.data || []).map(r => ({
      ...r,
      orig_user_type: r.user_type || "",
    }));
    table.replaceData(rows);
    takeSnapshot();
    clearDirty();
    setStatus(statusEl, t("modal.platform_users.loaded", { n: rows.length }));
  }

  // -------- Invio email ai selezionati --------
  function wireEmailBulkAction() {
    const barEl = document.getElementById("platformUsersBulkBar");
    const btnEmail = document.getElementById("btnPlatformUsersEmail");
    const composeEl = document.getElementById("platformUsersEmailCompose");
    const subjectEl = document.getElementById("platformUsersEmailSubject");
    const bodyEl = document.getElementById("platformUsersEmailBody");
    const sendBtn = document.getElementById("btnPlatformUsersEmailSend");
    const cancelBtn = document.getElementById("btnPlatformUsersEmailCancel");
    const emailStatusEl = document.getElementById("platformUsersEmailStatus");
    if (!barEl || !btnEmail) return;

    barEl.classList.replace("d-none", "d-flex");   // nascosta con d-none nel markup

    function updateButtonState() {
      const n = table.getSelectedData().length;
      btnEmail.disabled = n === 0;
      const label = n ? te("modal.platform_users.email_selected_n", { n }) : te("modal.platform_users.email_selected");
      btnEmail.innerHTML = `<i class="bi bi-envelope" aria-hidden="true"></i> ${label}`;
    }
    table.on("rowSelectionChanged", updateButtonState);
    table.on("dataChanged", updateButtonState);

    btnEmail.addEventListener("click", () => {
      composeEl.style.display = "";
      subjectEl.value = "";
      bodyEl.value = "";
      setStatus(emailStatusEl, "");
      subjectEl.focus();
    });

    cancelBtn.addEventListener("click", () => {
      composeEl.style.display = "none";
    });

    sendBtn.addEventListener("click", async () => {
      const rows = table.getSelectedData();
      const user_ids = rows.map(r => r.user_id);
      const subject = subjectEl.value.trim();
      const body = bodyEl.value.trim();

      if (!user_ids.length) { setStatus(emailStatusEl, t("modal.platform_users.no_recipients")); return; }
      if (!subject) { setStatus(emailStatusEl, t("modal.platform_users.email_subject_required")); return; }
      if (!body) { setStatus(emailStatusEl, t("modal.platform_users.email_body_required")); return; }

      sendBtn.disabled = true;
      setStatus(emailStatusEl, t("modal.platform_users.email_sending"));
      try {
        const res = await apiPost({ action: "send_email", user_ids, subject, body });
        const { sent, failed } = res.data || { sent: 0, failed: [] };
        let msg = t("modal.platform_users.email_sent", { n: Number(sent) || 0 });
        if (failed && failed.length) {
          msg += " " + t("modal.platform_users.email_failed", { n: failed.length, list: failed.map(f => f.email).join(", ") });
        }
        setStatus(emailStatusEl, msg);
        if (!failed || !failed.length) {
          setTimeout(() => { composeEl.style.display = "none"; }, 1500);
        }
      } catch (e) {
        console.error(e);
        setStatus(emailStatusEl, t("modal.platform_users.email_error", { error: e.message || String(e) }));
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  function buildTable() {
    table = new Tabulator(tableEl, {
      layout: "fitColumns",
      height: "60vh",
      reactiveData: true,
      placeholder: t("modal.platform_users.no_users"),
      selectableRows: true,

      columns: [
        {
          formatter: "rowSelection", titleFormatter: "rowSelection",
          hozAlign: "center", headerSort: false, width: 40,
          cellClick: (e, cell) => cell.getRow().toggleSelect(),
        },
        { title: t("user.last_name"), field: "last_name", widthGrow: 2, minWidth: 180 },
        { title: t("user.first_name"), field: "first_name", widthGrow: 2, minWidth: 180 },
        { title: t("user.username"), field: "user_name", widthGrow: 2, minWidth: 160 },
        {
          title: t("modal.platform_users.col.platform_role"),
          field: "user_type",
          widthGrow: 2,
          minWidth: 220,
          headerSort: false,

          formatter: (cell) => ROLE_LABEL[cell.getValue() || ""] || (cell.getValue() || ""),

          editor: "list",
          editorParams: { values: ROLE_LABEL },

          cellEdited: (cell) => {
            const v = cell.getValue() || "";
            if (!["V", "U", "I", "P"].includes(v)) {
              cell.restoreOldValue();
              return;
            }
            markDirty();
            setStatus(statusEl, t("modal.platform_users.unsaved"));
          },
        },

        // "Accedi come" — impersonazione (api/impersonate_tool.php). Assente
        // per l'amministratore stesso e per gli altri amministratori (X non
        // impersonabile, vedi anche il controllo — indipendente — lato server).
        {
          title: "", width: 140, headerSort: false, hozAlign: "center",
          formatter: (cell) => {
            const d = cell.getData();
            if (d.user_type === "X" || Number(d.user_id) === Number(userId)) return "";
            const name = [d.first_name, d.last_name].filter(Boolean).join(" ") || d.user_name || d.email || "";
            return `<button type="button" class="btn btn-outline-secondary btn-sm" aria-label="${te("modal.platform_users.impersonate_as", { name })}">${te("modal.platform_users.impersonate")}</button>`;
          },
          cellClick: async (e, cell) => {
            const d = cell.getData();
            if (d.user_type === "X" || Number(d.user_id) === Number(userId)) return;

            const label = [d.first_name, d.last_name].filter(Boolean).join(" ") || d.user_name || d.email;
            if (!confirm(t("modal.platform_users.impersonate_confirm", { name: label }))) return;

            try {
              const r = await fetch("api/impersonate_tool.php", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start", user_id: d.user_id }),
              });
              const j = await r.json().catch(() => null);
              if (!j || !j.success) throw new Error((j && j.error) || t("errors.server_status", { status: r.status }));
              window.location.href = j.data?.redirect || "researches.php";
            } catch (err) {
              alert(t("modal.platform_users.error", { error: err.message || String(err) }));
            }
          },
        },
      ],

      initialSort: [
        { column: "last_name", dir: "asc" },
        { column: "first_name", dir: "asc" },
      ],
    });

    wireEmailBulkAction();
  }

  btnCancel?.addEventListener("click", restoreSnapshot);

  btnSave?.addEventListener("click", async () => {
    if (!table) return;

    const rows = table.getData();
    const changes = [];
    for (const r of rows) {
      const before = r.orig_user_type || "";
      const now = r.user_type || "";
      if (before !== now) changes.push({ user_id: r.user_id, now });
    }

    if (!changes.length) {
      clearDirty();
      setStatus(statusEl, t("modal.platform_users.no_changes"));
      return;
    }

    try {
      setStatus(statusEl, t("modal.platform_users.saving_n", { n: changes.length }));
      const res = await apiPost({ action: "save_user_types", changes });
      await load();
      let msg = t("modal.platform_users.save_done");
      if (res?.data?.skipped_self) {
        msg += " " + t("modal.platform_users.skipped_self");
      }
      setStatus(statusEl, msg);
    } catch (e) {
      console.error(e);
      alert(e.message || String(e));
    }
  });

  modalEl.addEventListener("shown.bs.modal", async () => {
    if (!table) buildTable();
    await load();
    setTimeout(() => table && table.redraw(true), 60);
  });
})();
