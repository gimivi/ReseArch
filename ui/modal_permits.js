// modal_permits.js
// Richiede global: Tabulator, research[res_id], workpackage[wp_id], userType
// (stringa user_type dell'utente corrente — usata solo per mostrare/nascondere
// la colonna di selezione e il bottone "Invia email ai selezionati", riservati
// all'amministratore X; il controllo vero è lato server).

import { t, te } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const API = "ui/modal_permits_tools.php";

  // -------- Helpers --------
  function apiGet(url) {
    return fetch(url, { credentials: "same-origin" }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!j) throw new Error(t('errors.invalid_response'));
      if (!r.ok || !j.success) throw new Error(j.error || t('errors.server_status', { status: r.status }));
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
      if (!j) throw new Error(t('errors.invalid_response'));
      if (!r.ok || !j.success) throw new Error(j.error || t('errors.server_status', { status: r.status }));
      return j;
    });
  }

  function setStatus(el, msg) {
    if (el) el.textContent = msg || "";
  }

  // -------- Mapping ruoli --------
  // Research: Blank / W / I / C — gli utenti U della piattaforma solo C (_doc/arch-permessi.md §11.2)
  const RES_ROLE_LABEL = {
    "": "",
    "W": t("role.W.@"),
    "I": t("role.I.@"),
    "C": t("role.C.@"),
  };

  // Workpackage: Blank / I / C — chi è C sulla ricerca solo C
  const WP_ROLE_LABEL = {
    "": "",
    "I": t("role.I.@"),
    "C": t("role.C.@"),
  };

  const PLATFORM_ROLE_LABEL = { "I": t("role.I.@"), "U": t("role.U.@") };

  // Ruoli ammessi per una riga
  function allowedResRoles(row) { return row.user_type === "U" ? ["", "C"] : ["", "W", "I", "C"]; }
  function allowedWpRoles(row)  { return row.res_perm === "C" ? ["", "C"] : ["", "I", "C"]; }

  // Voci del menu a tendina: il ruolo vuoto ha un'etichetta visibile ("— Nessun ruolo —"),
  // altrimenti la riga vuota del menu non si vede e non si può togliere un ruolo.
  const NONE_LABEL = t('modal.permits.role.none');
  function pickLabels(map, codes) {
    const out = {};
    codes.forEach(c => { out[c] = c === "" ? NONE_LABEL : map[c]; });
    return out;
  }

  function invertMap(map) {
    // label -> code
    const out = {};
    Object.keys(map).forEach(code => {
      const label = map[code];
      out[label] = code;
    });
    // consenti anche "" -> ""
    out[""] = "";
    return out;
  }

  const RES_LABEL_TO_CODE = invertMap(RES_ROLE_LABEL);
  const WP_LABEL_TO_CODE  = invertMap(WP_ROLE_LABEL);

  // Editor values: Tabulator list editor accetta un oggetto {value: label}
  function editorValuesFromMap(map) {
    const vals = {};
    Object.keys(map).forEach(code => {
      vals[code] = map[code];
    });
    return vals;
  }

  // -------- Dirty tracking generico --------
  function makeDirtyTracker(btnSave, btnCancel) {
    let dirty = false;
    return {
      markDirty() {
        dirty = true;
        btnSave.disabled = false;
        btnCancel.disabled = false;
      },
      clearDirty() {
        dirty = false;
        btnSave.disabled = true;
        btnCancel.disabled = true;
      },
      isDirty() { return dirty; }
    };
  }

  // -------- Invio email ai selezionati (condiviso dalle modali Users) --------
  // Riservato all'amministratore (X): il bottone/pannello restano nascosti per
  // chiunque altro, e comunque il server (ui/modal_permits_tools.php azione
  // 'send_email') rifiuta la richiesta a chi non è X — l'occultamento qui è
  // solo UX, non il controllo di sicurezza (quello è lato server).
  function wireEmailBulkAction({ table, barEl, btnEmail, composeEl, subjectEl, bodyEl, sendBtn, cancelBtn, statusEl, apiAction }) {
    if (!barEl || !btnEmail) return;
    if (userType !== "X") return; // resta nascosto, come impostato nel markup

    barEl.classList.replace("d-none", "d-flex");   // nascosta con d-none nel markup (d-flex vinceva su display:none)

    function updateButtonState() {
      const n = table.getSelectedData().length;
      btnEmail.disabled = n === 0;
      btnEmail.textContent = "";
      btnEmail.innerHTML = `<i class="bi bi-envelope" aria-hidden="true"></i> ${n ? te('modal.permits.email.send_selected_n', { n }) : te('modal.permits.email.send_selected')}`;
    }

    table.on("rowSelectionChanged", updateButtonState);
    // stato iniziale dopo ogni load (i dati vengono rimpiazzati)
    table.on("dataChanged", updateButtonState);

    btnEmail.addEventListener("click", () => {
      composeEl.style.display = "";
      subjectEl.value = "";
      bodyEl.value = "";
      setStatus(statusEl, "");
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

      if (!user_ids.length) { setStatus(statusEl, t('modal.permits.email.no_recipients')); return; }
      if (!subject) { setStatus(statusEl, t('modal.permits.email.need_subject')); return; }
      if (!body) { setStatus(statusEl, t('modal.permits.email.need_body')); return; }

      sendBtn.disabled = true;
      setStatus(statusEl, t('modal.permits.email.sending'));
      try {
        const res = await apiPost({ action: apiAction, user_ids, subject, body });
        const { sent, failed } = res.data || { sent: 0, failed: [] };
        let msg = t('modal.permits.email.sent', { n: sent });
        if (failed && failed.length) {
          msg += " " + t('modal.permits.email.failed', { n: failed.length, emails: failed.map(f => f.email).join(", ") });
        }
        setStatus(statusEl, msg);
        if (!failed || !failed.length) {
          setTimeout(() => { composeEl.style.display = "none"; }, 1500);
        }
      } catch (e) {
        console.error(e);
        setStatus(statusEl, t('modal.permits.email.send_error', { error: e.message || String(e) }));
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  // =========================================================
  // MODALE RICERCA
  // =========================================================
  const modalRes = document.getElementById("modalResPermits");
  if (modalRes) {
    const tableEl = document.getElementById("resPermitsTable");
    const lblEl = document.getElementById("resPermitsResLabel");
    const statusEl = document.getElementById("resPermitsStatus");
    const btnSave = document.getElementById("btnResPermitsSave");
    const btnCancel = document.getElementById("btnResPermitsCancel");

    const dirty = makeDirtyTracker(btnSave, btnCancel);

    let table = null;
    let snapshot = null; // per annulla

    function takeSnapshot() {
      snapshot = table ? table.getData().map(r => ({ ...r })) : null;
    }

    function restoreSnapshot() {
      if (table && snapshot) {
        table.replaceData(snapshot.map(r => ({ ...r })));
        dirty.clearDirty();
        setStatus(statusEl, t('modal.permits.changes_reverted'));
      }
    }

    async function load() {
      const resId = research?.res_id;
      lblEl.textContent = resId ?? "";
      setStatus(statusEl, t('common.loading'));

      const url = `${API}?action=list_res_users&res_id=${encodeURIComponent(resId)}`;
      const res = await apiGet(url);
      const rows = (res.data || []).map(r => ({
        ...r,
        // orig_perm per confronto
        orig_perm: r.perm || "",
        perm: r.perm || "",
      }));

      table.replaceData(rows);
      takeSnapshot();
      dirty.clearDirty();
      setStatus(statusEl, t('modal.permits.loaded', { n: rows.length }));
    }

    function buildTable() {
      table = new Tabulator(tableEl, {
        layout: "fitColumns",
        height: "60vh",
        reactiveData: true,
        placeholder: t('modal.permits.no_users'),
        selectableRows: userType === "X" ? true : false,

        columns: [
          ...(userType === "X" ? [{
            formatter: "rowSelection", titleFormatter: "rowSelection",
            hozAlign: "center", headerSort: false, width: 40,
            cellClick: (e, cell) => cell.getRow().toggleSelect(),
          }] : []),

          { title: t('user.last_name'), field: "last_name", widthGrow: 2, minWidth: 180 },
          { title: t('user.first_name'), field: "first_name", widthGrow: 2, minWidth: 180 },
          { title: t('user.username'), field: "user_name", widthGrow: 2, minWidth: 160 },
          {
            title: t('modal.platform_users.col.platform_role'), field: "user_type", widthGrow: 1, minWidth: 140,
            formatter: (cell) => PLATFORM_ROLE_LABEL[cell.getValue() || ""] || "",
          },

          {
            title: t('modal.permits.res.col_role.@'),
            field: "perm",
            widthGrow: 2,
            minWidth: 220,
            headerSort: false,

            formatter: (cell) => RES_ROLE_LABEL[cell.getValue() || ""] || "",

            editor: "list",
            editorParams: (cell) => ({
              values: pickLabels(RES_ROLE_LABEL, allowedResRoles(cell.getRow().getData())),
              // dropdown true migliora UX
              listOnEmpty: true,
            }),

            cellEdited: (cell) => {
              const v = cell.getValue() || "";
              if (!allowedResRoles(cell.getRow().getData()).includes(v)) {
                cell.setValue("");
              }
              dirty.markDirty();
              setStatus(statusEl, t('modal.permits.unsaved'));
            },
          },
        ],

        initialSort: [
          { column: "last_name", dir: "asc" },
          { column: "first_name", dir: "asc" },
        ],
      });

      wireEmailBulkAction({
        table,
        barEl: document.getElementById("resPermitsBulkBar"),
        btnEmail: document.getElementById("btnResPermitsEmail"),
        composeEl: document.getElementById("resPermitsEmailCompose"),
        subjectEl: document.getElementById("resPermitsEmailSubject"),
        bodyEl: document.getElementById("resPermitsEmailBody"),
        sendBtn: document.getElementById("btnResPermitsEmailSend"),
        cancelBtn: document.getElementById("btnResPermitsEmailCancel"),
        statusEl: document.getElementById("resPermitsEmailStatus"),
        apiAction: "send_email",
      });
    }

    btnCancel?.addEventListener("click", restoreSnapshot);

    btnSave?.addEventListener("click", async () => {
      if (!table) return;
      const resId = research?.res_id;

      const rows = table.getData();
      const changes = [];

      for (const r of rows) {
        const before = (r.orig_perm || "");
        const now = (r.perm || "");
        if (before !== now) {
          changes.push({ user_id: r.user_id, before, now });
        }
      }

      if (!changes.length) {
        dirty.clearDirty();
        setStatus(statusEl, t('modal.permits.no_changes'));
        return;
      }

      try {
        setStatus(statusEl, t('modal.permits.saving_n', { n: changes.length }));
        await apiPost({
          action: "save_res_perms",
          res_id: resId,
          changes,
        });
        await load();
        setStatus(statusEl, t('modal.permits.saved'));
      } catch (e) {
        console.error(e);
        alert(e.message || String(e));
      }
    });

    modalRes.addEventListener("shown.bs.modal", async () => {
      if (!table) buildTable();
      await load();
      // redraw utile in modale
      setTimeout(() => table && table.redraw(true), 60);
    });
  }

  // =========================================================
  // MODALE WORKPACKAGE
  // =========================================================
  const modalWp = document.getElementById("modalWpPermits");
  if (modalWp) {
    const tableEl = document.getElementById("wpPermitsTable");
    const lblEl = document.getElementById("wpPermitsWpLabel");
    const statusEl = document.getElementById("wpPermitsStatus");
    const btnSave = document.getElementById("btnWpPermitsSave");
    const btnCancel = document.getElementById("btnWpPermitsCancel");

    const dirty = makeDirtyTracker(btnSave, btnCancel);

    let table = null;
    let snapshot = null;

    function takeSnapshot() {
      snapshot = table ? table.getData().map(r => ({ ...r })) : null;
    }

    function restoreSnapshot() {
      if (table && snapshot) {
        table.replaceData(snapshot.map(r => ({ ...r })));
        dirty.clearDirty();
        setStatus(statusEl, t('modal.permits.changes_reverted'));
      }
    }

    async function load() {
      const resId = research?.res_id;
      const wpId = workpackage?.wp_id;

      lblEl.textContent = wpId ?? "";
      setStatus(statusEl, t('common.loading'));

      const url = `${API}?action=list_wp_users&res_id=${encodeURIComponent(resId)}&wp_id=${encodeURIComponent(wpId)}`;
      const res = await apiGet(url);
      const rows = (res.data || []).map(r => ({
        ...r,
        orig_perm: r.perm || "",
        perm: r.perm || "",
      }));

      table.replaceData(rows);
      takeSnapshot();
      dirty.clearDirty();
      setStatus(statusEl, t('modal.permits.loaded', { n: rows.length }));
    }

    function buildTable() {
      table = new Tabulator(tableEl, {
        layout: "fitColumns",
        height: "60vh",
        reactiveData: true,
        placeholder: t('modal.permits.no_users'),

        columns: [
          { title: t('user.last_name'), field: "last_name", widthGrow: 2, minWidth: 180 },
          { title: t('user.first_name'), field: "first_name", widthGrow: 2, minWidth: 180 },

          {
            title: t('modal.permits.wp.col_role.@'),
            field: "perm",
            widthGrow: 2,
            minWidth: 220,
            headerSort: false,

            formatter: (cell) => WP_ROLE_LABEL[cell.getValue() || ""] || "",

            editor: "list",
            editorParams: (cell) => ({
              values: pickLabels(WP_ROLE_LABEL, allowedWpRoles(cell.getRow().getData())),
              listOnEmpty: true,
            }),

            cellEdited: (cell) => {
              const v = cell.getValue() || "";
              if (!allowedWpRoles(cell.getRow().getData()).includes(v)) {
                cell.setValue("");
              }
              dirty.markDirty();
              setStatus(statusEl, t('modal.permits.unsaved'));
            },
          },
        ],

        initialSort: [
          { column: "last_name", dir: "asc" },
          { column: "first_name", dir: "asc" },
        ],
      });
    }

    btnCancel?.addEventListener("click", restoreSnapshot);

    btnSave?.addEventListener("click", async () => {
      if (!table) return;
      const resId = research?.res_id;
      const wpId = workpackage?.wp_id;

      const rows = table.getData();
      const changes = [];

      for (const r of rows) {
        const before = (r.orig_perm || "");
        const now = (r.perm || "");
        if (before !== now) {
          changes.push({ user_id: r.user_id, before, now });
        }
      }

      if (!changes.length) {
        dirty.clearDirty();
        setStatus(statusEl, t('modal.permits.no_changes'));
        return;
      }

      try {
        setStatus(statusEl, t('modal.permits.saving_n', { n: changes.length }));
        await apiPost({
          action: "save_wp_perms",
          res_id: resId,
          wp_id: wpId,
          changes,
        });
        await load();
        setStatus(statusEl, t('modal.permits.saved'));
      } catch (e) {
        console.error(e);
        alert(e.message || String(e));
      }
    });

    modalWp.addEventListener("shown.bs.modal", async () => {
      if (!table) buildTable();
      await load();
      setTimeout(() => table && table.redraw(true), 60);
    });
  }

})();
