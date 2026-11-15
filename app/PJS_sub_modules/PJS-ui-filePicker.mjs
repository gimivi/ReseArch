// app/PJS_sub_modules/PJS-ui-filePicker.mjs
// File picker modale standalone per selezione file da subfolder WP.
// Usa gli stessi endpoint di modal_models.js:
//   GET  ui/modal_sub_folders_tools.php?action=list  → subfolder del WP
//   POST ui/modal_models_tools.php {action:"list_dir", folder_id, path}
//
// showFilePicker({ accept }) → Promise<{ url, filename, relPath } | null>
//   accept: array estensioni (default: immagini comuni)
//
// URL costruita da window.data_path + res_folder_name + wp_folder_name + subfolder + cwd + filename

import { t, te } from "../shared/i18n.mjs";

const SUBFOLDER_API = 'ui/modal_sub_folders_tools.php';
const MODEL_API     = 'ui/modal_models_tools.php';

const IMAGE_EXTS    = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff'];

let _modal   = null;
let _bsModal = null;
let _resolve = null;
let _accept  = null;
let _loadState = { folderId: null, rootFolderName: null, cwd: '' };

function _ensureModal() {
  if (_modal) return;
  _modal = document.createElement('div');
  _modal.className = 'modal fade';
  _modal.setAttribute('data-bs-backdrop', 'static');
  _modal.tabIndex = -1;
  _modal.setAttribute('aria-labelledby', 'pjs-fp-title');
  _modal.innerHTML = `
<div class="modal-dialog modal-fullscreen-md-down modal-dialog-centered modal-lg">
  <div class="modal-content bg-dark text-light border-secondary">
    <div class="modal-header border-secondary py-2">
      <h6 class="modal-title" id="pjs-fp-title">${te('app.pjs.fp.title')}</h6>
      <span id="pjs-fp-breadcrumb" class="ms-3 small text-secondary flex-grow-1 text-truncate"></span>
    </div>
    <div class="modal-body p-2" style="height:420px;overflow:hidden">
      <div class="d-flex gap-2 h-100">
        <div style="width:170px;min-width:120px;overflow-y:auto;border-right:1px solid #444;padding-right:6px">
          <div class="small text-muted mb-1">${te('app.pjs.fp.subfolders.@')}</div>
          <div id="pjs-fp-roots" class="list-group list-group-flush"></div>
        </div>
        <div style="width:150px;min-width:100px;overflow-y:auto;border-right:1px solid #444;padding-right:6px">
          <div class="small text-muted mb-1">${te('app.pjs.fp.folders')}</div>
          <div id="pjs-fp-dirs" class="list-group list-group-flush"></div>
        </div>
        <div style="flex:1;overflow-y:auto">
          <div class="small text-muted mb-1">${te('common.file')}</div>
          <div id="pjs-fp-files" class="list-group list-group-flush"></div>
          <div id="pjs-fp-hint" class="small text-muted mt-2" role="status">${te('app.pjs.fp.pick_subfolder')}</div>
        </div>
      </div>
    </div>
    <div class="modal-footer border-secondary py-2">
      <button class="btn btn-sm btn-secondary" id="pjs-fp-cancel">${te('common.cancel')}</button>
    </div>
  </div>
</div>`;
  document.body.appendChild(_modal);
  _bsModal = new bootstrap.Modal(_modal);

  _modal.querySelector('#pjs-fp-cancel').addEventListener('click', () => _dismiss(null));
  _modal.addEventListener('hidden.bs.modal', () => _dismiss(null));
}

function _dismiss(value) {
  const cb = _resolve;
  _resolve = null;
  cb?.(value);
}

function _setBreadcrumb(txt) {
  const el = _modal?.querySelector('#pjs-fp-breadcrumb');
  if (el) el.textContent = txt;
}

function _setHint(txt) {
  const el = _modal?.querySelector('#pjs-fp-hint');
  if (el) el.textContent = txt;
}

async function _apiGet(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  const j = await r.json().catch(() => null);
  if (!j || !r.ok || !j.success) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

async function _apiPost(body) {
  const r = await fetch(MODEL_API, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!j || !r.ok || !j.success) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

function _buildUrl(rootFolderName, cwd, filename) {
  const base  = String(window.data_path || '').replace(/\/?$/, '/');
  const res   = String(window.research?.res_folder_name || '');
  const wp    = String(window.workpackage?.wp_folder_name || '');
  const parts = [res, wp, rootFolderName, ...(cwd ? cwd.split('/') : []), filename].filter(Boolean);
  return base + parts.join('/');
}

async function _loadDir(folderId, rootFolderName, cwd) {
  const dirsEl  = _modal.querySelector('#pjs-fp-dirs');
  const filesEl = _modal.querySelector('#pjs-fp-files');
  dirsEl.innerHTML  = '';
  filesEl.innerHTML = '';
  _setHint(t('common.loading'));
  _setBreadcrumb(rootFolderName + (cwd ? ' / ' + cwd : ''));

  try {
    const res   = await _apiPost({ action: 'list_dir', folder_id: folderId, path: cwd || '' });
    const dirs  = res.data?.dirs  || [];
    const allFiles = res.data?.files || [];
    const files = _accept?.length
      ? allFiles.filter(f => _accept.includes(f.split('.').pop().toLowerCase()))
      : allFiles;
    const actualCwd = res.data?.cwd ?? cwd ?? '';

    _loadState.cwd = actualCwd;
    _setBreadcrumb(rootFolderName + (actualCwd ? ' / ' + actualCwd : ''));
    _setHint(!dirs.length && !files.length ? t('app.pjs.fp.empty') : '');

    // Parent link
    if (actualCwd) {
      const parts  = actualCwd.split('/').filter(Boolean);
      const parent = parts.slice(0, -1).join('/');
      const a = _mkLink('⬆ ..', () => _loadDir(folderId, rootFolderName, parent));
      dirsEl.appendChild(a);
    }

    for (const d of dirs) {
      const next = actualCwd ? `${actualCwd}/${d}` : d;
      dirsEl.appendChild(_mkLink('📁 ' + d, () => _loadDir(folderId, rootFolderName, next)));
    }

    for (const f of files) {
      const url     = _buildUrl(rootFolderName, actualCwd, f);
      const relPath = [rootFolderName, ...(actualCwd ? actualCwd.split('/') : []), f].filter(Boolean).join('/');
      const a = _mkLink('📄 ' + f, () => {
        _bsModal.hide();
        _dismiss({ url, filename: f, relPath });
      });
      filesEl.appendChild(a);
    }
  } catch (err) {
    _setHint(t('app.pjs.fp.error', { msg: err.message }));
  }
}

function _mkLink(text, onclick) {
  const a = document.createElement('a');
  a.href = '#';
  a.className = 'list-group-item list-group-item-action list-group-item-dark py-1 small';
  a.textContent = text;
  a.onclick = (e) => { e.preventDefault(); onclick(); };
  return a;
}

export async function showFilePicker({ accept = IMAGE_EXTS } = {}) {
  _ensureModal();
  _accept = accept;
  _loadState = { folderId: null, rootFolderName: null, cwd: '' };

  _modal.querySelector('#pjs-fp-roots').innerHTML  = '';
  _modal.querySelector('#pjs-fp-dirs').innerHTML   = '';
  _modal.querySelector('#pjs-fp-files').innerHTML  = '';
  _setBreadcrumb('');
  _setHint(t('app.pjs.fp.loading_subfolders'));

  return new Promise(resolve => {
    _resolve = resolve;
    _bsModal.show();

    _apiGet(`${SUBFOLDER_API}?action=list`).then(res => {
      const items = res.data?.items || [];
      _setHint(items.length ? t('app.pjs.fp.pick_left') : t('app.pjs.fp.no_subfolders.@'));
      const rootsEl = _modal.querySelector('#pjs-fp-roots');
      for (const f of items) {
        const a = _mkLink(f.folder_name, () => {
          rootsEl.querySelectorAll('.active').forEach(x => x.classList.remove('active'));
          a.classList.add('active');
          _loadDir(f.folder_id, f.folder_name, '');
        });
        rootsEl.appendChild(a);
      }
    }).catch(err => {
      _setHint(t('app.pjs.fp.error', { msg: err.message }));
    });
  });
}
