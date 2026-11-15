// app/PJS_sub_modules/PJS-ui-textStylesModal.mjs
// Gestione stili testo del disegno PJS.
// Stili salvati in env.workspace.textStyles[] (parte di mod_spec, per-modello).
//
// Esportazioni pubbliche:
//   openTextStylesModal(bodyEl)                   — apre la modale di gestione
//   getTextStyles(env)                            — array degli stili
//   findTextStyle(env, id)                        — stile per ID
//   applyTextStyle(groupOrText, style, scope)     — applica uno stile a un item testo

import { getState, setDirty } from "./PJS-core.mjs";
import { t, te } from "../shared/i18n.mjs";

// I nomi degli stili li scrive l'utente: vanno protetti prima di finire in innerHTML / value=""
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

const FONTS = [
  "Arial", "Helvetica", "Verdana", "Tahoma", "Trebuchet MS",
  "Times New Roman", "Georgia", "Garamond",
  "Courier New", "Consolas",
  "sans-serif", "serif", "monospace",
];

// ── Helpers pubblici ──────────────────────────────────────────────────────────

export function getTextStyles(env) {
  return env?.workspace?.textStyles || [];
}

export function findTextStyle(env, id) {
  return getTextStyles(env).find(s => s.id === id) || null;
}

function ensureStyles(env) {
  env.workspace              = env.workspace || {};
  env.workspace.textStyles   = env.workspace.textStyles || [];
  return env.workspace.textStyles;
}

function defaultStyle(id) {
  return {
    id,
    name:          t('app.pjs.ts.default_name', { n: id.slice(-4) }),
    fontFamily:    'Arial',
    fontSize:      50,
    color:         '#000000',
    justification: 'left',
    border: { enabled: false, strokeColor: '#000000', strokeWidth: 2, padding: 5 },
    shadow: { enabled: false, color: '#000000', opacity: 0.5, blur: 4, offsetX: 2, offsetY: 2 },
  };
}

// ── Applica stile a un item testo ─────────────────────────────────────────────
// groupOrText: Paper.js Group (nuovo formato) o PointText (legacy).
// Per Group: applica a PointText figlio + gestisce rect bordo.
// Per PointText diretto: applica solo proprietà testo (nessun bordo).

export function applyTextStyle(groupOrText, style, scope) {
  if (!groupOrText || !style || !scope) return;

  const isGroup = !!groupOrText.children;
  const textItem = isGroup
    ? groupOrText.children.find(c => c.content !== undefined && !c.data?.__textBorder)
    : groupOrText;

  if (!textItem) return;

  // Proprietà testo
  textItem.fontFamily    = style.fontFamily  || 'Arial';
  textItem.fontSize      = style.fontSize    || 50;
  textItem.fillColor     = style.color       || '#000000';
  textItem.justification = style.justification || 'left';

  // Ombra
  if (style.shadow?.enabled) {
    const sc = new scope.Color(style.shadow.color || '#000000');
    sc.alpha = style.shadow.opacity ?? 0.5;
    textItem.shadowColor  = sc;
    textItem.shadowBlur   = style.shadow.blur   ?? 4;
    textItem.shadowOffset = new scope.Point(
      style.shadow.offsetX ?? 2,
      style.shadow.offsetY ?? 2
    );
  } else {
    textItem.shadowColor = null;
  }

  // Bordo (solo su Group)
  if (isGroup) {
    // Rimuove rect bordo precedente
    groupOrText.children
      .filter(c => c.data?.__textBorder)
      .forEach(c => c.remove());

    if (style.border?.enabled) {
      const pad  = style.border.padding || 0;
      const rect = new scope.Path.Rectangle({
        rectangle:   textItem.strokeBounds.expand(pad),
        strokeColor: style.border.strokeColor || '#000000',
        strokeWidth: style.border.strokeWidth  || 1,
        fillColor:   null,
      });
      rect.data = { __textPart: true, __textBorder: true };
      groupOrText.addChild(rect);
    }

    groupOrText.data.styleId = style.id;
  }
}

// ── Modale ───────────────────────────────────────────────────────────────────

let _modal = null, _bsModal = null;

function ensureModal() {
  if (_modal) return;
  _modal = document.createElement('div');
  _modal.className = 'modal fade';
  _modal.setAttribute('data-bs-backdrop', 'static');
  _modal.setAttribute('data-bs-keyboard', 'false');
  _modal.tabIndex = -1;
  _modal.setAttribute('aria-labelledby', 'pjs-ts-title');
  _modal.innerHTML = `
<div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-centered">
  <div class="modal-content bg-dark text-light border-secondary">
    <div class="modal-header border-secondary py-2">
      <h6 class="modal-title" id="pjs-ts-title">${te('app.pjs.ts.title')}</h6>
      <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="${te('common.close')}"></button>
    </div>
    <div class="modal-body p-0" style="min-height:420px">
      <div class="d-flex" style="min-height:420px">
        <div id="pjs-ts-sidebar"
             style="width:190px;border-right:1px solid #444;padding:8px;flex-shrink:0;
                    display:flex;flex-direction:column">
          <div id="pjs-ts-list"
               style="flex:1;overflow-y:auto;max-height:360px"></div>
          <button class="btn btn-sm btn-outline-secondary w-100 mt-2"
                  id="pjs-ts-add">+ ${te('common.add')}</button>
        </div>
        <div id="pjs-ts-form" style="flex:1;padding:14px;overflow-y:auto">
          <p class="text-muted small mt-2">${te('app.pjs.ts.pick')}</p>
        </div>
      </div>
    </div>
    <div class="modal-footer border-secondary py-2">
      <button class="btn btn-sm btn-secondary" data-bs-dismiss="modal">${te('common.close')}</button>
    </div>
  </div>
</div>`;
  document.body.appendChild(_modal);
  _bsModal = new bootstrap.Modal(_modal);
}

// ── Rendering lista ───────────────────────────────────────────────────────────

function renderList(styles, activeId, onSelect, onDelete) {
  const listEl = _modal.querySelector('#pjs-ts-list');
  listEl.innerHTML = '';
  for (const s of styles) {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;padding:4px 6px;border-radius:4px;' +
      'cursor:pointer;margin-bottom:2px;' +
      (s.id === activeId ? 'background:#2a3a5e;' : 'background:transparent;');
    row.innerHTML =
      `<span class="small text-truncate" style="flex:1;max-width:130px">${esc(s.name)}</span>` +
      `<button class="btn btn-sm p-0 px-1 text-danger border-0" data-del="${esc(s.id)}" aria-label="${te('common.delete')}" title="${te('common.delete')}"><span aria-hidden="true">×</span></button>`;
    row.querySelector('span').addEventListener('click', () => onSelect(s.id));
    row.querySelector('[data-del]').addEventListener('click', e => {
      e.stopPropagation(); onDelete(s.id);
    });
    listEl.appendChild(row);
  }
}

// ── Rendering form ────────────────────────────────────────────────────────────

function renderForm(style, onSave) {
  const formEl = _modal.querySelector('#pjs-ts-form');
  const fontOpts = FONTS.map(f =>
    `<option value="${f}" ${f === style.fontFamily ? 'selected' : ''}>${f}</option>`
  ).join('');
  const justMap = { left: te('app.pjs.text.left'), center: te('app.pjs.text.center'), right: te('app.pjs.text.right') };

  formEl.innerHTML = `
<div class="row g-2">
  <div class="col-8">
    <label class="form-label small mb-1" for="pjs-ts-name">${te('app.pjs.ts.name')}</label>
    <input type="text" class="form-control form-control-sm bg-dark text-light border-secondary"
           id="pjs-ts-name" value="${esc(style.name)}">
  </div>
  <div class="col-4">
    <label class="form-label small mb-1" for="pjs-ts-just">${te('app.pjs.prop.just_short')}</label>
    <select class="form-select form-select-sm bg-dark text-light border-secondary" id="pjs-ts-just">
      ${Object.entries(justMap).map(([v,l]) =>
        `<option value="${v}" ${style.justification===v?'selected':''}>${l}</option>`).join('')}
    </select>
  </div>
  <div class="col-7">
    <label class="form-label small mb-1" for="pjs-ts-font">${te('app.pjs.ts.font')}</label>
    <select class="form-select form-select-sm bg-dark text-light border-secondary"
            id="pjs-ts-font">${fontOpts}</select>
  </div>
  <div class="col-3">
    <label class="form-label small mb-1" for="pjs-ts-size">${te('app.pjs.ts.size')}</label>
    <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary"
           id="pjs-ts-size" value="${style.fontSize}" min="1">
  </div>
  <div class="col-2">
    <label class="form-label small mb-1" for="pjs-ts-color">${te('common.color')}</label>
    <input type="color" class="form-control form-control-color w-100 border-secondary"
           id="pjs-ts-color" value="${style.color}" style="height:31px;padding:2px">
  </div>

  <div class="col-12"><hr class="border-secondary my-1"></div>

  <div class="col-12">
    <div class="form-check form-switch mb-1">
      <input class="form-check-input" type="checkbox" id="pjs-ts-border-en"
             ${style.border.enabled ? 'checked' : ''}>
      <label class="form-check-label small" for="pjs-ts-border-en">${te('app.pjs.ts.border')}</label>
    </div>
  </div>
  <div class="col-4 pjs-ts-bfields">
    <label class="form-label small mb-1" for="pjs-ts-border-color">${te('common.color')}</label>
    <input type="color" class="form-control form-control-color w-100 border-secondary"
           id="pjs-ts-border-color" value="${style.border.strokeColor}" style="height:31px;padding:2px">
  </div>
  <div class="col-4 pjs-ts-bfields">
    <label class="form-label small mb-1" for="pjs-ts-border-w">${te('app.pjs.ts.border_width')}</label>
    <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary"
           id="pjs-ts-border-w" value="${style.border.strokeWidth}" min="0.5" step="0.5">
  </div>
  <div class="col-4 pjs-ts-bfields">
    <label class="form-label small mb-1" for="pjs-ts-border-pad">${te('app.pjs.ts.padding')}</label>
    <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary"
           id="pjs-ts-border-pad" value="${style.border.padding}" min="0">
  </div>

  <div class="col-12"><hr class="border-secondary my-1"></div>

  <div class="col-12">
    <div class="form-check form-switch mb-1">
      <input class="form-check-input" type="checkbox" id="pjs-ts-shadow-en"
             ${style.shadow.enabled ? 'checked' : ''}>
      <label class="form-check-label small" for="pjs-ts-shadow-en">${te('app.pjs.ts.shadow')}</label>
    </div>
  </div>
  <div class="col-3 pjs-ts-sfields">
    <label class="form-label small mb-1" for="pjs-ts-shadow-color">${te('common.color')}</label>
    <input type="color" class="form-control form-control-color w-100 border-secondary"
           id="pjs-ts-shadow-color" value="${style.shadow.color}" style="height:31px;padding:2px">
  </div>
  <div class="col-3 pjs-ts-sfields">
    <label class="form-label small mb-1" for="pjs-ts-shadow-op">${te('app.pjs.ts.opacity')}</label>
    <input type="range" class="form-range mt-2" id="pjs-ts-shadow-op"
           min="0" max="1" step="0.05" value="${style.shadow.opacity ?? 0.5}">
  </div>
  <div class="col-2 pjs-ts-sfields">
    <label class="form-label small mb-1" for="pjs-ts-shadow-blur">${te('app.pjs.ts.blur')}</label>
    <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary"
           id="pjs-ts-shadow-blur" value="${style.shadow.blur}" min="0">
  </div>
  <div class="col-2 pjs-ts-sfields">
    <label class="form-label small mb-1" for="pjs-ts-shadow-x">${te('app.pjs.ts.offset_x')}</label>
    <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary"
           id="pjs-ts-shadow-x" value="${style.shadow.offsetX}">
  </div>
  <div class="col-2 pjs-ts-sfields">
    <label class="form-label small mb-1" for="pjs-ts-shadow-y">${te('app.pjs.ts.offset_y')}</label>
    <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary"
           id="pjs-ts-shadow-y" value="${style.shadow.offsetY}">
  </div>

  <div class="col-12 mt-1">
    <button class="btn btn-sm btn-primary" id="pjs-ts-save-btn">${te('app.pjs.ts.save')}</button>
  </div>
</div>`;

  const q = id => formEl.querySelector(id);

  function syncOpacity(fields, enabled) {
    fields.forEach(el => {
      el.style.opacity       = enabled ? '' : '0.35';
      el.style.pointerEvents = enabled ? '' : 'none';
    });
  }

  syncOpacity([...formEl.querySelectorAll('.pjs-ts-bfields')], style.border.enabled);
  syncOpacity([...formEl.querySelectorAll('.pjs-ts-sfields')], style.shadow.enabled);

  q('#pjs-ts-border-en').addEventListener('change', () =>
    syncOpacity([...formEl.querySelectorAll('.pjs-ts-bfields')], q('#pjs-ts-border-en').checked));
  q('#pjs-ts-shadow-en').addEventListener('change', () =>
    syncOpacity([...formEl.querySelectorAll('.pjs-ts-sfields')], q('#pjs-ts-shadow-en').checked));

  q('#pjs-ts-save-btn').addEventListener('click', () => {
    onSave({
      id:            style.id,
      name:          q('#pjs-ts-name').value.trim() || style.name,
      fontFamily:    q('#pjs-ts-font').value,
      fontSize:      Math.max(1, Number(q('#pjs-ts-size').value) || 50),
      color:         q('#pjs-ts-color').value,
      justification: q('#pjs-ts-just').value,
      border: {
        enabled:     q('#pjs-ts-border-en').checked,
        strokeColor: q('#pjs-ts-border-color').value,
        strokeWidth: Math.max(0.5, Number(q('#pjs-ts-border-w').value) || 1),
        padding:     Math.max(0, Number(q('#pjs-ts-border-pad').value) || 5),
      },
      shadow: {
        enabled:  q('#pjs-ts-shadow-en').checked,
        color:    q('#pjs-ts-shadow-color').value,
        opacity:  Number(q('#pjs-ts-shadow-op').value),
        blur:     Math.max(0, Number(q('#pjs-ts-shadow-blur').value) || 4),
        offsetX:  Number(q('#pjs-ts-shadow-x').value) || 2,
        offsetY:  Number(q('#pjs-ts-shadow-y').value) || 2,
      },
    });
  });
}

// ── Apertura modale ───────────────────────────────────────────────────────────

export function openTextStylesModal(bodyEl) {
  ensureModal();
  const state = getState(bodyEl);
  if (!state?._env) return;

  const styles = ensureStyles(state._env);
  let activeId = null;

  function refresh() {
    renderList(styles, activeId, select, del);
  }

  function select(id) {
    activeId = id;
    refresh();
    const s = styles.find(x => x.id === id);
    if (s) renderForm(s, save);
  }

  function del(id) {
    const idx = styles.findIndex(x => x.id === id);
    if (idx >= 0) styles.splice(idx, 1);
    if (activeId === id) {
      activeId = null;
      _modal.querySelector('#pjs-ts-form').innerHTML =
        `<p class="text-muted small mt-2">${te('app.pjs.ts.pick')}</p>`;
    }
    setDirty(bodyEl, true);
    refresh();
  }

  function save(updated) {
    const idx = styles.findIndex(x => x.id === updated.id);
    if (idx >= 0) styles[idx] = updated;
    activeId = updated.id;
    setDirty(bodyEl, true);
    refresh();
    renderForm(updated, save);
  }

  _modal.querySelector('#pjs-ts-add').onclick = () => {
    const id = 'ts' + Date.now();
    styles.push(defaultStyle(id));
    setDirty(bodyEl, true);
    select(id);
  };

  refresh();
  _bsModal.show();
}
