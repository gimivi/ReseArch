// APP/PJS_sub_modules/PJS-selection-ui.mjs

import { ensureSelectionState, selectionCount } from "./PJS-selection-core.mjs";
import { getSelectionBoundsProject } from "./PJS-selection-query.mjs";

/**
 * Selection UI
 * - runtime only su layer __ui__
 * - bbox e drag-rect in screen/view space
 */

export function clearSelectionUI(state) {
  ensureSelectionState(state);

  try { state._selectionUI?.bboxItem?.remove?.(); } catch {}
  try { state._selectionUI?.dragRectItem?.remove?.(); } catch {}

  state._selectionUI.bboxItem = null;
  state._selectionUI.dragRectItem = null;
}

export function clearSelectionBBox(state) {
  ensureSelectionState(state);
  try { state._selectionUI?.bboxItem?.remove?.(); } catch {}
  state._selectionUI.bboxItem = null;
}

export function clearSelectionDragRect(state) {
  ensureSelectionState(state);
  try { state._selectionUI?.dragRectItem?.remove?.(); } catch {}
  state._selectionUI.dragRectItem = null;
}

export function refreshSelectionUI(state, opts = {}) {
  ensureSelectionState(state);
  clearSelectionBBox(state);

  if (selectionCount(state) === 0) {
    state.scope.view.update?.();
    return null;
  }

  const bProj = getSelectionBoundsProject(state, null, { filterSelectable: false });
  if (!bProj) {
    state.scope.view.update?.();
    return null;
  }

  const scope = state.scope;
  const uiLayer = state._uiLayer;
  if (!uiLayer) return null;

  const tlV = scope.view.projectToView(bProj.topLeft);
  const brV = scope.view.projectToView(bProj.bottomRight);
  const bView = new scope.Rectangle(tlV, brV);

  uiLayer.activate();
  uiLayer.bringToFront?.();

const bboxItem = new scope.Path.Rectangle({ rectangle: bView, insert: false });
uiLayer.addChild(bboxItem);




  bboxItem.strokeColor = opts.strokeColor || "#00ffff";
  bboxItem.strokeWidth = Number.isFinite(opts.strokeWidth) ? opts.strokeWidth : 3;
  bboxItem.dashArray = Array.isArray(opts.dashArray) ? opts.dashArray : [4, 4];
  bboxItem.fillColor = null;
  bboxItem.data = {
    kind: "__ui_bbox__",
    __uiRuntime: true
  };

  state._selectionUI.bboxItem = bboxItem;



console.log("[SELECT][bbox parent/layer]", {
  parentClass: bboxItem.parent?.constructor?.name,
  layerName: bboxItem.layer?.name,
  isOnUiLayer: bboxItem.layer === state._uiLayer,
  uiLayerIndex: state.scope.project.layers.indexOf(state._uiLayer),
  bboxLayerIndex: state.scope.project.layers.indexOf(bboxItem.layer),
  activeLayerName: state.scope.project.activeLayer?.name
});


    console.log("[SELECT][refreshSelectionUI] bbox created", {
    uiLayerName: state._uiLayer?.name,
    selectionCount: state.selectionCount,
    bProj: bProj,
    bView: bView,
    bboxItem: bboxItem
    });

console.log("[SELECT][bbox style]", {
  visible: bboxItem.visible,
  strokeColor: bboxItem.strokeColor?.toCSS?.(true) || bboxItem.strokeColor,
  strokeWidth: bboxItem.strokeWidth,
  dashArray: bboxItem.dashArray,
  layerVisible: state._uiLayer?.visible,
  layerLocked: state._uiLayer?.locked
});



  scope.view.update?.();
  return bboxItem;
}

export function drawSelectionDragRect(state, viewA, viewB, opts = {}) {
  ensureSelectionState(state);

  const scope = state.scope;
  const uiLayer = state._uiLayer;
  if (!uiLayer) return null;

  const r = new scope.Rectangle(viewA, viewB);

  uiLayer.activate();
  uiLayer.bringToFront?.();

  let rect = state._selectionUI.dragRectItem;
  if (!rect) {
    rect = new scope.Path.Rectangle(r);
    rect.strokeColor = opts.strokeColor || "#00ffff";
    rect.strokeWidth = Number.isFinite(opts.strokeWidth) ? opts.strokeWidth : 2;
    rect.dashArray = Array.isArray(opts.dashArray) ? opts.dashArray : [6, 4];
    rect.fillColor = null;
    rect.data = {
      kind: "__ui_dragrect__",
      __uiRuntime: true
    };
    state._selectionUI.dragRectItem = rect;
  } else {
    rect.removeSegments();
    rect.add(new scope.Point(r.left, r.top));
    rect.add(new scope.Point(r.right, r.top));
    rect.add(new scope.Point(r.right, r.bottom));
    rect.add(new scope.Point(r.left, r.bottom));
    rect.closed = true;
  }

  scope.view.update?.();
  return rect;
}

export function syncSelectionUIAfterOverlay(state, opts = {}) {
  // utile da chiamare quando overlay/view ha già risincronizzato __ui__
  return refreshSelectionUI(state, opts);
}