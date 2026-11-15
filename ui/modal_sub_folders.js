// modal_sub_folders.js
// Richiede global: Tabulator, research[res_id,res_perm], workpackage[wp_id,wp_perm], user[id,user_type]

import { t, te } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const modalEl = document.getElementById("modalSubFolders");
  const tableEl = document.getElementById("subFoldersTable");
  const btnAdd = document.getElementById("btnSubFolderAdd");
  const wpLabel = document.getElementById("subFoldersWpLabel");

  if (!modalEl || !tableEl) return;

  // Endpoint nuovo (Opzione B: figli di wp_folder_id via folder_parent_id)
  const API_URL = "ui/modal_sub_folders_tools.php";

  let subFoldersTable = null;

  function apiFetch(url, opts = {}) {
    return fetch(url, {
      credentials: "same-origin",
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    }).then(async (r) => {
      const data = await r.json().catch(() => null);
      if (!r.ok || !data) {
        const msg = (data && data.error) ? data.error : t('errors.server_status', { status: r.status });
        throw new Error(msg);
      }
      if (!data.success) throw new Error(data.error || t('modal.sub_folders.err.failed'));
      return data;
    });
  }

  function normalizeNameClient(name) {
    if (name == null) return "";
    name = String(name).trim();

    // vieto spazi
    if (/\s/.test(name)) return null;

    // solo A-Z a-z 0-9 _
    if (!/^[A-Za-z0-9_]{1,30}$/.test(name)) return null;

    // capitalizza prima lettera se è una lettera
    const first = name.charAt(0);
    if (/[a-z]/.test(first)) {
      name = first.toUpperCase() + name.slice(1);
    }
    return name;
  }

  function canManage() {
    // FIX (2026-09-16): research/workpackage (json_encode di $_SESSION['research']/
    // ['workpackage'], vedi dashboard.php) portano il permesso nella chiave 'perm',
    // non 'res_perm'/'wp_perm' — senza fallback, isPI/isWPL erano sempre false e
    // solo l'amministratore vedeva il bottone/le celle abilitate. Stesso bug e
    // stesso fix lato server in ui/modal_sub_folders_tools.php.
    try {
      const isAdmin = String(user?.user_type ?? "") === "X";
      const isPI = String(research?.res_perm ?? research?.perm ?? "") === "P";
      const isWPL = String(workpackage?.wp_perm ?? workpackage?.perm ?? "") === "W";
      return isAdmin || isPI || isWPL;
    } catch {
      return false;
    }
  }

  function initTable() {
    wpLabel.textContent = `${workpackage.wp_id}`;

    subFoldersTable = new Tabulator(tableEl, {
      layout: "fitColumns",
      height: "60vh",
      placeholder: t('modal.sub_folders.empty.@'),
      reactiveData: true,

      ajaxURL: `${API_URL}?action=list`,
      ajaxResponse: function (url, params, response) {
        // response = {success:true, data:{items:[...]}}
        return (response.data && response.data.items) ? response.data.items : [];
      },

      columns: [
        { title: t('common.id'), field: "folder_id", width: 110, hozAlign: "right", headerSort: true },

        {
          title: t('common.name'),
          field: "folder_name",
          editor: "input",
          editable: () => canManage(),
          validator: [
            { type: "required" },
            {
              type: function (cell, value) {
                const norm = normalizeNameClient(value);
                return norm !== null;
              },
            },
          ],
          cellEdited: async function (cell) {
            const row = cell.getRow();
            const data = row.getData();

            const norm = normalizeNameClient(data.folder_name);
            if (norm === null) {
              alert(t('modal.sub_folders.err.invalid_name'));
              cell.restoreOldValue();
              return;
            }

            // Aggiorna visivamente se capitalizzato
            if (norm !== data.folder_name) {
              row.update({ folder_name: norm });
            }

            try {
              const res = await apiFetch(API_URL, {
                method: "POST",
                body: JSON.stringify({
                  action: "update",
                  folder_id: data.folder_id,
                  folder_name: norm,
                  folder_description: data.folder_description ?? "",
                }),
              });

              // opzionale: riallinea con risposta server se vuoi
              if (res?.data?.item) row.update(res.data.item);
            } catch (e) {
              alert(e.message);
              cell.restoreOldValue();
            }
          },
        },

        {
          title: t('common.description'),
          field: "folder_description",
          editor: "input",
          editable: () => canManage(),
          cellEdited: async function (cell) {
            const row = cell.getRow();
            const data = row.getData();

            try {
              const res = await apiFetch(API_URL, {
                method: "POST",
                body: JSON.stringify({
                  action: "update",
                  folder_id: data.folder_id,
                  folder_name: data.folder_name,
                  folder_description: data.folder_description ?? "",
                }),
              });

              if (res?.data?.item) row.update(res.data.item);
            } catch (e) {
              alert(e.message);
              cell.restoreOldValue();
            }
          },
        },

        {
          title: t('modal.sub_folders.col.creator_id'),
          field: "creator_id",
          width: 120,
          hozAlign: "right",
          headerSort: true,
        },

        {
          title: "",
          width: 110,
          headerSort: false,
          hozAlign: "center",
          formatter: function () {
            return `<button type="button" class="btn btn-outline-danger btn-sm">${te('common.delete')}</button>`;
          },
          cellClick: async function (e, cell) {
            if (!canManage()) {
              alert(t('errors.not_authorized'));
              return;
            }

            const row = cell.getRow();
            const data = row.getData();

            if (!confirm(t('modal.sub_folders.confirm_delete.@', { name: data.folder_name }))) return;

            try {
              await apiFetch(API_URL, {
                method: "POST",
                body: JSON.stringify({
                  action: "delete",
                  folder_id: data.folder_id,
                }),
              });

              row.delete();
            } catch (err) {
              alert(err.message);
            }
          },
        },
      ],
    });
  }

  async function addSubFolder() {
    if (!canManage()) {
      alert(t('errors.not_authorized'));
      return;
    }

    let name = prompt(t('modal.sub_folders.prompt_name.@'), "");
    if (name === null) return;

    name = normalizeNameClient(name);
    if (name === null) {
      alert(t('modal.sub_folders.err.invalid_name'));
      return;
    }

    let desc = prompt(t('modal.sub_folders.prompt_description'), "");
    if (desc === null) desc = "";

    try {
      const res = await apiFetch(API_URL, {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          folder_name: name,
          folder_description: desc,
        }),
      });

      // res.data.item = record inserito
      const item = res?.data?.item;
      if (item) subFoldersTable.addData([item], true);
      else subFoldersTable.setData(`${API_URL}?action=list`);
    } catch (e) {
      alert(e.message);
    }
  }

  // Bootstrap show event
  modalEl.addEventListener("shown.bs.modal", function () {
    if (!subFoldersTable) initTable();
    else subFoldersTable.setData(`${API_URL}?action=list`);
  });

  if (btnAdd) btnAdd.addEventListener("click", addSubFolder);
})();
