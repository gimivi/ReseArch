// app/PJS_sub_modules/PJS-ui-inputDialog.mjs
// Bootstrap modal riusabile per i tool che richiedono input testuale.
// Restituisce Promise<{fieldId: value, ...}|null>

import { t, te } from "../shared/i18n.mjs";

let _modal    = null;
let _bsModal  = null;
let _cleanup  = null;

function ensureModal() {
  if (_modal) return;

  _modal = document.createElement('div');
  _modal.className = 'modal fade';
  _modal.id = 'pjs-input-dialog';
  _modal.tabIndex = -1;
  _modal.setAttribute('data-bs-backdrop', 'static');
  _modal.setAttribute('data-bs-keyboard', 'false');
  _modal.setAttribute('aria-labelledby', 'pjs-id-title');
  _modal.innerHTML = `
<div class="modal-dialog modal-fullscreen-md-down modal-dialog-centered modal-sm">
  <div class="modal-content bg-dark text-light border-secondary">
    <div class="modal-header border-secondary py-2">
      <h6 class="modal-title" id="pjs-id-title"></h6>
    </div>
    <div class="modal-body py-2" id="pjs-id-body"></div>
    <div class="modal-footer border-secondary py-2 gap-1">
      <button type="button" class="btn btn-sm btn-secondary" id="pjs-id-cancel">${te('common.cancel')}</button>
      <button type="button" class="btn btn-sm btn-primary"   id="pjs-id-ok">${te('common.ok')}</button>
    </div>
  </div>
</div>`;

  document.body.appendChild(_modal);
  _bsModal = new bootstrap.Modal(_modal);
}

/**
 * Mostra un dialog modale con campi configurabili.
 * @param {{ title:string, fields:Array<{id,label,type?,value?,placeholder?,min?,max?,step?,rows?}>, okLabel?:string }} opts
 * @returns {Promise<object|null>}  resolve con { id: value } o null se annullato
 */
export function showInputDialog({ title, fields, okLabel = t('common.ok') }) {
  ensureModal();

  // Scollega i listener del ciclo precedente
  if (_cleanup) { try { _cleanup(); } catch {} _cleanup = null; }

  _modal.querySelector('#pjs-id-title').textContent = title;
  _modal.querySelector('#pjs-id-ok').textContent    = okLabel;

  const bodyEl = _modal.querySelector('#pjs-id-body');
  bodyEl.innerHTML = '';

  const inputs = {};
  for (const f of fields) {
    const wrap = document.createElement('div');
    wrap.className = 'mb-2';

    const lbl = document.createElement('label');
    lbl.className = 'form-label small mb-1';
    lbl.htmlFor = `pjs-id-f-${f.id}`;
    lbl.textContent = f.label;
    wrap.appendChild(lbl);

    let inp;
    if (f.type === 'textarea') {
      inp = document.createElement('textarea');
      inp.rows = f.rows || 3;
      inp.className = 'form-control form-control-sm bg-dark text-light border-secondary';
    } else if (f.type === 'select') {
      inp = document.createElement('select');
      inp.className = 'form-select form-select-sm bg-dark text-light border-secondary';
      for (const opt of (f.options || [])) {
        const o = document.createElement('option');
        o.value  = String(opt.value ?? '');
        o.textContent = opt.label ?? String(opt.value ?? '');
        inp.appendChild(o);
      }
    } else {
      inp = document.createElement('input');
      inp.type = f.type || 'text';
      inp.className = 'form-control form-control-sm bg-dark text-light border-secondary';
      if (f.placeholder !== undefined) inp.placeholder = f.placeholder;
      if (f.min         !== undefined) inp.min         = String(f.min);
      if (f.max         !== undefined) inp.max         = String(f.max);
      if (f.step        !== undefined) inp.step        = String(f.step);
    }
    inp.id = `pjs-id-f-${f.id}`;
    if (f.value !== undefined) inp.value = String(f.value);

    wrap.appendChild(inp);
    bodyEl.appendChild(wrap);
    inputs[f.id] = inp;
  }

  return new Promise(resolve => {
    let settled = false;

    function settle(val) {
      if (settled) return;
      settled = true;
      _bsModal.hide();
      resolve(val);
    }

    function onOk() {
      const result = {};
      for (const [id, inp] of Object.entries(inputs)) result[id] = inp.value;
      settle(result);
    }

    function onCancel() { settle(null); }
    function onHidden()  { if (!settled) settle(null); }
    function onKeydown(e) { if (e.key === 'Enter') { e.preventDefault(); onOk(); } }

    const okBtn  = _modal.querySelector('#pjs-id-ok');
    const canBtn = _modal.querySelector('#pjs-id-cancel');

    okBtn.addEventListener('click', onOk);
    canBtn.addEventListener('click', onCancel);
    _modal.addEventListener('hidden.bs.modal', onHidden, { once: true });
    _modal.addEventListener('keydown', onKeydown);

    _cleanup = () => {
      okBtn.removeEventListener('click', onOk);
      canBtn.removeEventListener('click', onCancel);
      _modal.removeEventListener('keydown', onKeydown);
    };

    _bsModal.show();
    // Focus al primo campo dopo l'animazione di apertura
    setTimeout(() => { Object.values(inputs)[0]?.focus(); }, 300);
  });
}
