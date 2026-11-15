// app/PJS_sub_modules/PJS-cmd-properties.mjs
// Comando "Proprietà": dialog contestuale in base alla selezione corrente.
//   Solo testo   → contenuto, stile, giustificazione, ID interattivo, layer
//   Solo marker  → tipo, scala, rotazione, etichetta, ID interattivo, layer
//   Solo immagine→ file (sfoglia), larghezza, ID interattivo, layer
//   Misto/altro  → solo layer

import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import { setDirty } from "./PJS-core.mjs";
import {
  ensureSelectionState, clearSelection,
  applySelectionMode, syncSelectionMeta
} from "./PJS-selection-core.mjs";
import { clearSelectionUI, refreshSelectionUI } from "./PJS-selection-ui.mjs";
import { getTextStyles, findTextStyle, applyTextStyle } from "./PJS-ui-textStylesModal.mjs";
import { getMarker, getMarkerOptions } from "./PJS-svg-markers.mjs";
import { importMarkerAt } from "./PJS-tool-svg.mjs";
import { showFilePicker } from "./PJS-ui-filePicker.mjs";
import { t, te } from "../shared/i18n.mjs";

function getTextChild(item) {
  if (item.content !== undefined) return item;
  return item.children?.find?.(c => c.content !== undefined && !c.data?.__textBorder) || null;
}

let _modal = null, _bsModal = null;

function ensureModal() {
  if (_modal) return;
  _modal = document.createElement('div');
  _modal.className = 'modal fade';
  _modal.setAttribute('data-bs-backdrop', 'static');
  _modal.tabIndex = -1;
  _modal.setAttribute('aria-labelledby', 'pjs-prop-title');
  _modal.innerHTML = `
<div class="modal-dialog modal-fullscreen-md-down modal-dialog-centered" style="max-width:480px">
  <div class="modal-content bg-dark text-light border-secondary">
    <div class="modal-header border-secondary py-2">
      <h6 class="modal-title" id="pjs-prop-title">${te('app.pjs.tool.properties')}</h6>
    </div>
    <div class="modal-body py-2" id="pjs-prop-body"></div>
    <div class="modal-footer border-secondary py-2 gap-1">
      <button class="btn btn-sm btn-secondary" id="pjs-prop-cancel">${te('common.cancel')}</button>
      <button class="btn btn-sm btn-primary"   id="pjs-prop-ok">${te('common.apply')}</button>
    </div>
  </div>
</div>`;
  document.body.appendChild(_modal);
  _bsModal = new bootstrap.Modal(_modal);
}

// ── Campo comune: ID interattivo ──────────────────────────────────────────────

function buildInteractiveIdField(currentId) {
  return `
<div class="mb-2">
  <label class="form-label small mb-1" for="pjs-prop-interactive-id">${te('app.pjs.ctrl.interactive_id')}</label>
  <input type="text" class="form-control form-control-sm bg-dark text-light border-secondary"
         id="pjs-prop-interactive-id" placeholder="${te('app.pjs.text.id_placeholder')}" value="${_esc(currentId || '')}">
</div>`;
}

// ── Costruttori HTML dei pannelli ─────────────────────────────────────────────

function buildLayerSelect(layers, currentLayerId) {
  const opts = layers.map(l =>
    `<option value="${l.id}" ${l.id === currentLayerId ? 'selected' : ''}>${l.name || l.id}</option>`
  ).join('');
  return `
<div class="mb-2">
  <label class="form-label small mb-1" for="pjs-prop-layer">${te('app.pjs.prop.layer')}</label>
  <select class="form-select form-select-sm bg-dark text-light border-secondary"
          id="pjs-prop-layer">${opts}</select>
</div>`;
}

function buildTextPanel(items, styles, layers) {
  const firstLayerId = items[0].data?.layerId || (layers[0]?.id ?? '');
  const firstStyleId = items[0].data?.styleId || '';
  const firstJust    = getTextChild(items[0])?.justification || 'left';
  const firstContent = items.length === 1
    ? (getTextChild(items[0])?.content || '') : '';
  const firstInterId = items[0].data?.interactiveId || '';

  const styleOpts = `<option value="">${te('app.pjs.text.no_style')}</option>` +
    styles.map(s =>
      `<option value="${s.id}" ${s.id === firstStyleId ? 'selected' : ''}>${s.name}</option>`
    ).join('');

  const justMap = { left: te('app.pjs.text.left'), center: te('app.pjs.text.center'), right: te('app.pjs.text.right') };

  return buildLayerSelect(layers, firstLayerId) + `
<div class="mb-2">
  <label class="form-label small mb-1" for="pjs-prop-text">${te('app.pjs.tool.text')}</label>
  <textarea class="form-control form-control-sm bg-dark text-light border-secondary"
            id="pjs-prop-text" rows="4" style="font-family:monospace;resize:vertical"
            ${items.length > 1 ? `disabled placeholder="${te('app.pjs.prop.multiple')}"` : ''}
            >${_esc(firstContent)}</textarea>
</div>
<div class="row g-2 mb-2">
  <div class="col-8">
    <label class="form-label small mb-1" for="pjs-prop-style">${te('app.pjs.text.style')}</label>
    <select class="form-select form-select-sm bg-dark text-light border-secondary"
            id="pjs-prop-style">${styleOpts}</select>
  </div>
  <div class="col-4">
    <label class="form-label small mb-1" for="pjs-prop-just">${te('app.pjs.prop.just_short')}</label>
    <select class="form-select form-select-sm bg-dark text-light border-secondary"
            id="pjs-prop-just">
      ${Object.entries(justMap).map(([v, l]) =>
        `<option value="${v}" ${v === firstJust ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
  </div>
</div>` + buildInteractiveIdField(firstInterId);
}

function buildMarkerPanel(items, layers) {
  const first        = items[0].data || {};
  const firstLayerId = first.layerId  || (layers[0]?.id ?? '');
  const firstMkrId   = first.markerId || '';
  const firstScale   = first.svgScale    ?? 80;
  const firstRot     = first.svgRotation ?? 0;
  const firstLabel   = items.length === 1 ? (first.markerLabel || '') : '';
  const firstInterId = first.interactiveId || '';

  const markerOpts = getMarkerOptions().map(o =>
    `<option value="${o.value}" ${o.value === firstMkrId ? 'selected' : ''}>${o.label}</option>`
  ).join('');

  return buildLayerSelect(layers, firstLayerId) + `
<div class="mb-2">
  <label class="form-label small mb-1" for="pjs-prop-marker">${te('app.pjs.svg.type')}</label>
  <select class="form-select form-select-sm bg-dark text-light border-secondary"
          id="pjs-prop-marker">${markerOpts}</select>
</div>
<div class="row g-2 mb-2">
  <div class="col-6">
    <label class="form-label small mb-1" for="pjs-prop-scale">${te('app.pjs.prop.scale')}</label>
    <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary"
           id="pjs-prop-scale" value="${firstScale}" min="1">
  </div>
  <div class="col-6">
    <label class="form-label small mb-1" for="pjs-prop-rotation">${te('app.pjs.svg.rotation')}</label>
    <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary"
           id="pjs-prop-rotation" value="${firstRot}" step="1">
  </div>
</div>
<div class="mb-2">
  <label class="form-label small mb-1" for="pjs-prop-label">${te('app.pjs.svg.label')}</label>
  <input type="text" class="form-control form-control-sm bg-dark text-light border-secondary"
         id="pjs-prop-label" value="${_esc(firstLabel)}"
         ${items.length > 1 ? `disabled placeholder="${te('app.pjs.prop.multiple')}"` : ''}>
</div>` + buildInteractiveIdField(firstInterId);
}

function buildImagePanel(items, layers) {
  const first        = items[0].data || {};
  const firstLayerId = first.layerId  || (layers[0]?.id ?? '');
  const firstInterId = first.interactiveId || '';
  const displayPath  = first.relPath || first.filename || first.url || '—';
  const firstWidth   = items.length === 1 ? (Math.round(items[0].bounds?.width) || '') : '';

  return buildLayerSelect(layers, firstLayerId) + `
<div class="mb-2">
  <label class="form-label small mb-1" for="pjs-prop-img-path">${te('app.pjs.prop.current_file')}</label>
  <div class="d-flex gap-2 align-items-center">
    <input type="text" class="form-control form-control-sm bg-dark text-light border-secondary"
           id="pjs-prop-img-path" value="${_esc(displayPath)}" readonly>
    <button type="button" class="btn btn-sm btn-outline-secondary flex-shrink-0"
            id="pjs-prop-img-browse">${te('app.pjs.prop.browse')}</button>
  </div>
  <input type="hidden" id="pjs-prop-img-url"     value="${_esc(first.url     || '')}">
  <input type="hidden" id="pjs-prop-img-relpath" value="${_esc(first.relPath || '')}">
  <input type="hidden" id="pjs-prop-img-fname"   value="${_esc(first.filename || '')}">
</div>
<div class="mb-2">
  <label class="form-label small mb-1" for="pjs-prop-img-width">${te(items.length > 1 ? 'app.pjs.prop.img_width_multi' : 'app.pjs.image.width')}</label>
  <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary"
         id="pjs-prop-img-width" value="${firstWidth}" min="1"
         ${items.length > 1 ? 'disabled' : ''}>
</div>` + buildInteractiveIdField(firstInterId);
}

function buildMixedPanel(items, layers) {
  const firstLayerId = items[0].data?.layerId || (layers[0]?.id ?? '');
  return buildLayerSelect(layers, firstLayerId) +
    `<p class="text-muted small mb-0">${te('app.pjs.prop.mixed')}</p>`;
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
  );
}

// ── Apertura modale ───────────────────────────────────────────────────────────

export function openPropertiesDialog({ state, bodyEl, cmdUI }) {
  ensureModal();
  ensureSelectionState(state);

  const items = Array.from(state.selection || []).filter(Boolean);
  if (!items.length) {
    cmdUI?.update?.({ status: t("app.pjs.prop.no_selection") });
    return;
  }

  const env    = state._env || {};
  const layers = env.layers || [];
  const styles = getTextStyles(env);

  const allText   = items.every(it => it.data?.kind === 'text');
  const allMarker = items.every(it => it.data?.kind === 'marker');
  const allImage  = items.every(it => it.data?.kind === 'image');

  _modal.querySelector('#pjs-prop-title').textContent =
    allText   ? t('app.pjs.prop.title_text')   :
    allMarker ? t('app.pjs.prop.title_marker')  :
    allImage  ? t('app.pjs.prop.title_image'):
                t('app.pjs.tool.properties');

  _modal.querySelector('#pjs-prop-body').innerHTML =
    allText   ? buildTextPanel(items, styles, layers)  :
    allMarker ? buildMarkerPanel(items, layers)         :
    allImage  ? buildImagePanel(items, layers)          :
                buildMixedPanel(items, layers);

  // Wiring "Sfoglia..." per il pannello immagine
  if (allImage) {
    _modal.querySelector('#pjs-prop-img-browse')?.addEventListener('click', async () => {
      const file = await showFilePicker();
      if (!file) return;
      _modal.querySelector('#pjs-prop-img-path').value    = file.relPath;
      _modal.querySelector('#pjs-prop-img-url').value     = file.url;
      _modal.querySelector('#pjs-prop-img-relpath').value = file.relPath;
      _modal.querySelector('#pjs-prop-img-fname').value   = file.filename;
    });
  }

  const okBtn     = _modal.querySelector('#pjs-prop-ok');
  const cancelBtn = _modal.querySelector('#pjs-prop-cancel');
  const q         = id => _modal.querySelector(id);
  let settled     = false;

  function cleanup() {
    okBtn.removeEventListener('click', onOk);
    cancelBtn.removeEventListener('click', onCancel);
  }

  function onCancel() {
    if (settled) return;
    settled = true; cleanup(); _bsModal.hide();
  }

  function onOk() {
    if (settled) return;
    settled = true; cleanup();

    const newLayerId = q('#pjs-prop-layer')?.value;

    if (allText) {
      _applyTextProps(items, { newLayerId, q, env, state, bodyEl });
    } else if (allMarker) {
      _applyMarkerProps(items, { newLayerId, q, state, bodyEl, cmdUI });
    } else if (allImage) {
      _applyImageProps(items, { newLayerId, q, state, bodyEl, cmdUI });
    } else {
      _applyLayerOnly(items, { newLayerId, state });
    }

    try {
      pushSnapshot(state.history, {
        label: 'Proprietà',
        snapshot: exportProjectJSON(state),
      });
    } catch {}

    syncSelectionMeta(state);
    refreshSelectionUI(state);
    setDirty(bodyEl, true);
    state.scope.view.update?.();
    cmdUI?.update?.({ status: t('app.pjs.prop.updated') });
    _bsModal.hide();
  }

  okBtn.addEventListener('click', onOk);
  cancelBtn.addEventListener('click', onCancel);
  _modal.addEventListener('hidden.bs.modal', () => {
    if (!settled) { settled = true; cleanup(); }
  }, { once: true });

  _bsModal.show();
}

// ── Applicatori ───────────────────────────────────────────────────────────────

function _findLayer(state, layerId) {
  return state.scope.project.layers.find(L => L.data?.layerId === layerId) || null;
}

function _applyLayerOnly(items, { newLayerId, state }) {
  const targetLayer = newLayerId ? _findLayer(state, newLayerId) : null;
  for (const item of items) {
    if (targetLayer && item.data?.layerId !== newLayerId) {
      targetLayer.addChild(item);
      item.data.layerId = newLayerId;
    }
  }
}

function _applyTextProps(items, { newLayerId, q, env, state, bodyEl }) {
  const newText    = q('#pjs-prop-text')?.value;
  const newStyleId = q('#pjs-prop-style')?.value;
  const newJust    = q('#pjs-prop-just')?.value;
  const newInterId = q('#pjs-prop-interactive-id')?.value?.trim() ?? null;
  const targetLayer = newLayerId ? _findLayer(state, newLayerId) : null;

  for (const item of items) {
    if (targetLayer && item.data?.layerId !== newLayerId) {
      targetLayer.addChild(item);
      item.data.layerId = newLayerId;
    }

    const textChild = getTextChild(item);

    if (textChild && items.length === 1 && newText !== null) {
      textChild.content = newText;
    }

    if (newStyleId) {
      const style = findTextStyle(env, newStyleId);
      if (style) applyTextStyle(item, style, state.scope);
    }

    if (newJust && textChild) textChild.justification = newJust;

    if (newInterId !== null) item.data.interactiveId = newInterId;
  }
}

function _applyMarkerProps(items, { newLayerId, q, state, bodyEl, cmdUI }) {
  const newMarkerId  = q('#pjs-prop-marker')?.value;
  const newScale     = Number(q('#pjs-prop-scale')?.value)    || 80;
  const newRotation  = Number(q('#pjs-prop-rotation')?.value) || 0;
  const newLabel     = q('#pjs-prop-label')?.value || '';
  const newInterId   = q('#pjs-prop-interactive-id')?.value?.trim() || '';
  const newMarker    = getMarker(newMarkerId);

  if (!newMarker) return;

  clearSelection(state);
  clearSelectionUI(state);

  const newItems = [];
  for (const item of items) {
    const pos     = item.position.clone();
    const layerId = newLayerId || item.data?.layerId || '';
    const layer   = _findLayer(state, layerId) ||
                    state.scope.project.layers.find(L => !L.data?.__ui__);

    item.remove();

    const newItem = importMarkerAt({
      marker:        newMarker,
      label:         items.length === 1 ? newLabel : (item.data?.markerLabel || ''),
      scale:         newScale,
      rotation:      newRotation,
      pos,
      layer,
      layerId,
      scope:         state.scope,
      bodyEl,
      interactiveId: newInterId,
    });

    if (newItem) newItems.push(newItem);
  }

  if (newItems.length) applySelectionMode(state, newItems, {});
}

function _applyImageProps(items, { newLayerId, q, state, bodyEl, cmdUI }) {
  const newUrl     = q('#pjs-prop-img-url')?.value     || null;
  const newRelPath = q('#pjs-prop-img-relpath')?.value || null;
  const newFname   = q('#pjs-prop-img-fname')?.value   || null;
  const newWidth   = items.length === 1 ? (Number(q('#pjs-prop-img-width')?.value) || null) : null;
  const newInterId = q('#pjs-prop-interactive-id')?.value?.trim() ?? null;
  const targetLayer = newLayerId ? _findLayer(state, newLayerId) : null;

  for (const item of items) {
    if (targetLayer && item.data?.layerId !== newLayerId) {
      targetLayer.addChild(item);
      item.data.layerId = newLayerId;
    }

    if (newInterId !== null) item.data.interactiveId = newInterId;

    // File cambiato
    if (newUrl && newUrl !== item.data?.url) {
      item.data.url     = newUrl;
      item.data.relPath = newRelPath || '';
      item.data.filename = newFname || '';
      const targetW = newWidth || (item.bounds?.width || 500);
      item.source = newUrl;
      item.on('load', () => {
        try {
          state.scope.activate();
          if (item.width > 0) item.scale(targetW / item.width);
          state.scope.view.update?.();
          cmdUI?.update?.({ status: t('app.pjs.prop.image_updated') });
        } catch {}
      });
    } else if (newWidth && items.length === 1) {
      // solo ridimensionamento
      const currentW = item.bounds?.width || 0;
      if (currentW > 0 && Math.abs(currentW - newWidth) > 0.5) {
        item.scale(newWidth / currentW);
      }
    }
  }
}
