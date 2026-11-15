// APP/PJS_sub_modules/PJS-selection-query.mjs

import { ensureSelectionState } from "./PJS-selection-core.mjs";

/**
 * Selection query / picking
 * - nessuna mutazione selection
 * - nessun disegno UI
 */

export function isSelectable(state, item, opts = {}) {
  ensureSelectionState(state);
  if (!item) return false;

  const {
    allowUI = false,
    activeLayerOnly = false,
    ignoreLockedItems = true,
    ignoreLockedLayers = true,
    ignoreHiddenLayers = true,
    kindAllow = null
  } = opts;

  const uiLayer = state._uiLayer;
  const env = state._env || {};
  const selCfg = env.workspace?.selection || {};

  if (selCfg.enabled === false) return false;

  if (!allowUI) {
    if (item.layer === uiLayer) return false;
    if (item.data?.kind === "__ui_bbox__") return false;
    if (item.data?.kind === "__ui_dragrect__") return false;
    if (item.data?.kind === "__ui_handle__") return false;
    if (item.data?.kind === "__ui_transform_handle__") return false;
  }

  if (item.data?.__preview) return false;

  // Esclude i figli interni dei Group testo e dei Group SVG
  if (item.data?.__textPart) return false;
  if (item.data?.__svgChild) return false;

  const kind = item.data?.kind;

  // kind filtering da workspace attuale
  if (selCfg.allow && kind && selCfg.allow[kind] === false) return false;

  // kind filter esplicito chiamante
  if (kindAllow && kind) {
    if (typeof kindAllow === "function") {
      if (!kindAllow(kind, item)) return false;
    } else if (Array.isArray(kindAllow)) {
      if (!kindAllow.includes(kind)) return false;
    } else if (typeof kindAllow === "object") {
      if (kindAllow[kind] === false) return false;
    }
  }

  const effIgnoreLockedItems = opts.ignoreLockedItems ?? true;
  if (effIgnoreLockedItems && ignoreLockedItems !== false) {
    if (item.data?.locked) return false;
  }

  const lid = item.data?.layerId;
  const layerRec = env.layers?.find?.((x) => x.id === lid) || null;

  const effIgnoreLockedLayers = opts.ignoreLockedLayers ?? (selCfg.ignoreLockedLayers !== false);
  if (effIgnoreLockedLayers && ignoreLockedLayers !== false) {
    if (layerRec?.locked) return false;
  }

  const effIgnoreHiddenLayers = opts.ignoreHiddenLayers ?? (selCfg.ignoreHiddenLayers !== false);
  if (effIgnoreHiddenLayers && ignoreHiddenLayers !== false) {
    if (layerRec?.visible === false) return false;
  }

  const activeLayerFilter =
    activeLayerOnly ||
    selCfg.activeLayerOnly === true ||
    selCfg.onlyActiveLayer === true;

  if (activeLayerFilter) {
    const activeLayerId = env.workspace?.defaults?.activeLayerId || null;
    if (activeLayerId && lid !== activeLayerId) return false;
  }

  return true;
}

export function pickSelectableItem(state, point, opts = {}) {
  ensureSelectionState(state);

  const tolerance = Number.isFinite(opts.tolerance)
    ? opts.tolerance
    : Number.isFinite(state._env?.workspace?.selection?.tolerancePx)
      ? state._env.workspace.selection.tolerancePx
      : 6;

  const hit = state.scope.project.hitTest(point, {
    fill: true,
    stroke: true,
    segments: true,
    tolerance,
  });

  if (!hit?.item) return null;

  // Se il colpo è su un figlio interno di un Group testo o SVG, risali al Group
  let item = hit.item;
  while (item && (item.data?.__textPart || item.data?.__svgChild)) {
    item = item.parent;
  }
  if (!item) return null;

  return isSelectable(state, item, opts) ? item : null;
}

export function collectBoxSelectableItems(state, viewA, viewB, opts = {}) {
  ensureSelectionState(state);

  const scope = state.scope;
  const crossing = viewB.x < viewA.x; // R->L = crossing

  const aProj = scope.view.viewToProject(viewA);
  const bProj = scope.view.viewToProject(viewB);
  const rectProj = new scope.Rectangle(aProj, bProj);

  const candidates = scope.project.getItems({
    match: (it) => isSelectable(state, it, opts)
  });

  const picked = [];
  for (const it of candidates) {
    const bb = it.bounds;
    if (!bb) continue;

    if (crossing) {
      if (bb.intersects(rectProj) || rectProj.intersects(bb)) {
        picked.push(it);
      }
    } else {
      const contained =
        rectProj.contains(bb.topLeft) &&
        rectProj.contains(bb.topRight) &&
        rectProj.contains(bb.bottomLeft) &&
        rectProj.contains(bb.bottomRight);

      if (contained) picked.push(it);
    }
  }

  return {
    picked,
    crossing,
    rectProj
  };
}

export function getSelectionBoundsProject(state, items = null, opts = {}) {
  ensureSelectionState(state);

  const source = items
    ? normalizeItems(items)
    : Array.from(state.selection || []);

  let bProj = null;
  for (const it of source) {
    if (!it) continue;
    if (opts.filterSelectable && !isSelectable(state, it, opts)) continue;

    const bb = it.bounds;
    if (!bb) continue;

    bProj = bProj ? bProj.unite(bb) : bb.clone();
  }

  return bProj;
}

function normalizeItems(items) {
  if (!items) return [];
  if (items instanceof Set) return Array.from(items);
  if (Array.isArray(items)) return items.filter(Boolean);
  return [items].filter(Boolean);
}