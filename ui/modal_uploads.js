// modal_uploads.js
// Caricamento file nelle subfolder del workpackage. Dal 2026-10-03 la modale
// mostra anche il contenuto della cartella corrente (sottocartelle navigabili,
// file con dimensione e data, come il selettore file dei Modelli) e carica i
// file NELLA CARTELLA CHE SI STA GUARDANDO: il percorso corrente viene premesso
// a relativePath, che il server già usa per le sottocartelle.
//
// Testi da catalogo (chiavi modal.uploads.*): _doc/arch-i18n-a11y.md §2.
// Lo stato di ogni file in coda è un codice (state) e il testo si compone solo
// in renderQueue, così il controllo sugli errori non dipende dalla lingua.

import { t, te, formatDate } from "../app/shared/i18n.mjs";

(function () {
  "use strict";

  const modal = document.getElementById("modalUpload");
  if (!modal) return;

  const $ = (id) => document.getElementById(id);
  const folderList  = $("uploadFolderList");
  const dropzone    = $("uploadDropzone");
  const queueEl     = $("uploadQueue");
  const btnUpload   = $("btnStartUpload");
  const fileInput   = $("fileInput");
  const folderInput = $("folderInput");
  const listingEl   = $("uploadListing");
  const breadcrumb  = $("uploadBreadcrumb");
  const dateHeader  = $("uploadDateHeader");
  const actionsHeader = $("uploadActionsHeader");
  const targetLabel = $("uploadTargetLabel");
  const btnRoot     = $("uploadBtnRoot");
  const btnUp       = $("uploadBtnUp");
  const btnRefresh  = $("uploadBtnRefresh");

  const API = "ui/modal_uploads_tools.php";
  const SUBFOLDERS_API = "ui/modal_sub_folders_tools.php";

  let targetFolderId = null;   // subfolder (folders.folder_id)
  let rootName = "";           // nome della subfolder
  let cwd = "";                // percorso corrente dentro la subfolder ("" = radice)
  let queue = [];
  let uploading = false;

  // ---------------- formattazione ----------------
  function fmtSize(n) {
    if (n == null) return "";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, v = Number(n);
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i ? v.toFixed(v < 10 ? 1 : 0) : v) + " " + u[i];
  }
  function fmtDate(sec) {
    if (!sec) return "";
    return formatDate(new Date(sec * 1000), { dateStyle: "short", timeStyle: "short" });
  }
  function cell(tr, text, cls) {
    const td = document.createElement("td");
    td.textContent = text;
    if (cls) td.className = cls;
    tr.appendChild(td);
    return td;
  }
  function message(text) {
    listingEl.innerHTML = "";
    const tr = document.createElement("tr");
    const td = cell(tr, text, "text-muted");
    td.colSpan = 4;
    listingEl.appendChild(tr);
  }

  // ---------------- SUBFOLDER ----------------
  async function loadFolders() {
    folderList.innerHTML = "";
    targetFolderId = null; rootName = ""; cwd = "";
    updateNav();
    message(t('modal.uploads.no_folder.@'));

    const r = await fetch(`${SUBFOLDERS_API}?action=list`, { credentials: "same-origin" });
    const j = await r.json();
    const items = j?.data?.items || [];
    items.forEach(f => {
      const a = document.createElement("a");
      a.href = "#";
      a.className = "list-group-item list-group-item-action";
      a.textContent = f.folder_name;
      a.onclick = e => {
        e.preventDefault();
        folderList.querySelectorAll(".active").forEach(x => x.classList.remove("active"));
        a.classList.add("active");
        targetFolderId = f.folder_id;
        rootName = f.folder_name;
        loadDir("");
      };
      folderList.appendChild(a);
    });
    if (!items.length) {
      folderList.innerHTML = `<div class="small text-muted p-2">${te('modal.uploads.no_folders.@')}</div>`;
    }
  }

  // ---------------- CONTENUTO CARTELLA ----------------
  async function loadDir(path) {
    if (!targetFolderId) return;
    message(t('common.loading'));
    try {
      const url = `${API}?action=list_dir&folder_id=${encodeURIComponent(targetFolderId)}&path=${encodeURIComponent(path || "")}`;
      const r = await fetch(url, { credentials: "same-origin" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) throw new Error(j?.error || t('errors.server_status', { status: r.status }));
      const d = j.data;
      cwd = d.cwd || "";
      rootName = d.root_name || rootName;
      // date_kind arriva dal server ("creazione" | "modifica"): è un codice, non un testo
      dateHeader.textContent = d.date_kind === "creazione" ? t('modal.uploads.col.created') : t('modal.uploads.col.modified');
      dateHeader.title = d.date_kind === "creazione"
        ? t('modal.uploads.col.created_title')
        : t('modal.uploads.col.modified_title');
      renderListing(d);
    } catch (e) {
      message(t('modal.uploads.error', { msg: e.message }));
    }
    updateNav();
  }

  function renderListing(d) {
    listingEl.innerHTML = "";
    // cestino sui file solo per l'amministratore (il server ripete il controllo)
    const canDelete = !!d.can_delete;
    actionsHeader.classList.toggle("d-none", !canDelete);
    if (!d.exists) return message(t('modal.uploads.not_on_disk.@'));
    if (!d.dirs.length && !d.files.length) return message(t('modal.uploads.empty.@'));

    for (const dir of d.dirs) {
      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      const td = cell(tr, "");
      td.innerHTML = '<i class="bi bi-folder-fill text-warning me-1" aria-hidden="true"></i>';
      td.appendChild(document.createTextNode(dir.name));
      cell(tr, t('modal.uploads.items', { n: dir.items }), "text-end text-muted");
      cell(tr, fmtDate(dir.date));
      if (canDelete) cell(tr, "");
      tr.title = t('modal.uploads.open_folder.@');
      tr.addEventListener("click", () => loadDir(cwd ? `${cwd}/${dir.name}` : dir.name));
      listingEl.appendChild(tr);
    }
    for (const f of d.files) {
      const tr = document.createElement("tr");
      const td = cell(tr, "");
      td.innerHTML = '<i class="bi bi-file-earmark me-1" aria-hidden="true"></i>';
      td.appendChild(document.createTextNode(f.name));
      cell(tr, fmtSize(f.size), "text-end");
      cell(tr, fmtDate(f.date));
      if (canDelete) {
        const tdDel = cell(tr, "", "text-end");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-sm btn-outline-danger py-0 px-1";
        btn.innerHTML = '<i class="bi bi-trash" aria-hidden="true"></i>';
        btn.title = t('modal.uploads.delete_tip');
        btn.setAttribute("aria-label", t('modal.uploads.delete_aria', { name: f.name }));
        btn.addEventListener("click", () => deleteFile(f.name, btn));
        tdDel.appendChild(btn);
      }
      listingEl.appendChild(tr);
    }
  }

  // ---------------- CANCELLAZIONE (solo amministratore) ----------------
  // Prima chiede al server quali modelli usano il file, poi la conferma li elenca.
  async function deleteFile(name, btn) {
    const path = cwd ? `${cwd}/${name}` : name;
    btn.disabled = true;
    try {
      const q = `folder_id=${encodeURIComponent(targetFolderId)}&path=${encodeURIComponent(path)}`;
      const r = await fetch(`${API}?action=file_usage&${q}`, { credentials: "same-origin" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) throw new Error(j?.error || t('errors.server_status', { status: r.status }));

      const models = j.data.models || [];
      let text = t('modal.uploads.delete_confirm', { name: path });
      if (models.length) {
        text += "\n\n" + t('modal.uploads.delete_used', { n: models.length }) + "\n"
          + models.map(m => `• ${m.mod_name} (#${m.mod_id})`).join("\n");
      }
      if (!window.confirm(text)) { btn.disabled = false; return; }

      const fd = new FormData();
      fd.append("action", "delete_file");
      fd.append("folder_id", targetFolderId);
      fd.append("path", path);
      const r2 = await fetch(API, { method: "POST", body: fd, credentials: "same-origin" });
      const j2 = await r2.json().catch(() => null);
      if (!r2.ok || !j2?.success) throw new Error(j2?.error || t('errors.server_status', { status: r2.status }));
      loadDir(cwd);
    } catch (e) {
      btn.disabled = false;
      window.alert(t('modal.uploads.error', { msg: e.message }));
    }
  }

  function updateNav() {
    const has = !!targetFolderId;
    btnRoot.disabled = !has || !cwd;
    btnUp.disabled = !has || !cwd;
    btnRefresh.disabled = !has;
    const where = has ? (cwd ? `${rootName} / ${cwd}` : rootName) : "";
    breadcrumb.textContent = has ? where : t('modal.uploads.pick_folder.@');
    targetLabel.textContent = has ? where : "—";
    updateUploadState();
  }

  btnRoot.addEventListener("click", () => loadDir(""));
  btnUp.addEventListener("click", () => loadDir(cwd.split("/").slice(0, -1).join("/")));
  btnRefresh.addEventListener("click", () => loadDir(cwd));

  // ---------------- CODA ----------------
  function addFile(file, relPath = "") {
    queue.push({ file, relativePath: relPath, state: "queued" });
    renderQueue();
  }

  function renderQueue() {
    queueEl.innerHTML = "";
    queue.forEach((q) => {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between gap-2";
      const name = document.createElement("span");
      name.className = "text-truncate";
      name.textContent = q.relativePath || q.file.name;
      const st = document.createElement("span");
      st.className = q.state === "error" ? "text-danger" : "text-muted";
      st.textContent = `${fmtSize(q.file.size)} · ${queueStatusText(q)}`;
      li.append(name, st);
      queueEl.appendChild(li);
    });
    updateUploadState();
  }

  // Testo dello stato di un file in coda (state: queued | uploading | done | error)
  function queueStatusText(q) {
    switch (q.state) {
      case "uploading": return q.progress == null
        ? t('modal.uploads.q.uploading')
        : t('modal.uploads.q.uploading_pct', { pct: q.progress });
      case "done":  return t('modal.uploads.q.done');
      case "error": return t('modal.uploads.q.error', { msg: q.error || "" });
      default:      return t('modal.uploads.q.queued');
    }
  }

  function updateUploadState() {
    btnUpload.disabled = uploading || !(targetFolderId && queue.length);
  }

  // ---------------- DRAG & DROP ----------------
  dropzone.addEventListener("dragover", e => {
    e.preventDefault();
    dropzone.classList.add("bg-light");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("bg-light"));
  dropzone.addEventListener("drop", e => {
    e.preventDefault();
    dropzone.classList.remove("bg-light");
    for (const it of e.dataTransfer.items) {
      const entry = it.webkitGetAsEntry?.();
      if (entry) traverseEntry(entry, "");
      else {
        const file = it.getAsFile();
        if (file) addFile(file);
      }
    }
  });

  function traverseEntry(entry, path) {
    if (entry.isFile) {
      entry.file(f => addFile(f, path + f.name));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries restituisce i file a blocchi (≈100 alla volta in Chrome):
      // va richiamato finché non torna un blocco vuoto
      const readAll = () => reader.readEntries(entries => {
        if (!entries.length) return;
        entries.forEach(en => traverseEntry(en, path + entry.name + "/"));
        readAll();
      });
      readAll();
    }
  }

  // ---------------- SELETTORI ----------------
  fileInput.onchange = () => { Array.from(fileInput.files || []).forEach(f => addFile(f)); fileInput.value = ""; };
  folderInput.onchange = () => {
    Array.from(folderInput.files || []).forEach(f => addFile(f, f.webkitRelativePath || ""));
    folderInput.value = "";
  };
  $("btnSelectFiles").onclick = (e) => { e.stopPropagation(); fileInput.click(); };
  $("btnSelectFolder").onclick = (e) => { e.stopPropagation(); folderInput.click(); };

  // ---------------- UPLOAD ----------------
  btnUpload.onclick = async () => {
    if (!targetFolderId || !queue.length) return;
    uploading = true;
    updateUploadState();
    const prefix = cwd ? cwd + "/" : "";   // destinazione = cartella che si sta guardando

    for (const q of queue) {
      q.state = "uploading"; q.progress = null;
      renderQueue();

      const fd = new FormData();
      fd.append("file", q.file);
      fd.append("folder_id", targetFolderId);
      // il server usa la parte "cartella" di relativePath come sottocartella di destinazione
      fd.append("relativePath", prefix + (q.relativePath || q.file.name));

      const res = await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", API, true);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) { q.progress = Math.round(ev.loaded / ev.total * 100); renderQueue(); }
        };
        xhr.onload = () => {
          let j = null;
          try { j = JSON.parse(xhr.responseText); } catch {}
          resolve({ status: xhr.status, json: j, raw: xhr.responseText });
        };
        xhr.onerror = () => resolve({ status: xhr.status || 0, json: null, raw: "" });
        xhr.send(fd);
      });

      if (res.status === 200 && res.json && res.json.success) {
        q.state = "done";
      } else {
        const msg = res.json?.error || t('modal.uploads.upload_failed', { status: res.status });
        q.state = "error"; q.error = msg;
        console.error("Upload error:", msg, res.raw);
      }
      renderQueue();
    }

    // restano in elenco solo quelli non riusciti, per poterli ritentare
    queue = queue.filter(q => q.state === "error");
    uploading = false;
    renderQueue();
    loadDir(cwd);
  };

  modal.addEventListener("shown.bs.modal", loadFolders);
})();
