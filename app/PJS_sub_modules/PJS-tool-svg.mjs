// app/PJS_sub_modules/PJS-tool-svg.mjs
// Tool PJS: inserimento marker SVG da libreria predefinita (PJS-svg-markers.mjs).
// Click → dialog (tipo marker, scala, rotazione, etichetta) → importSVG nel layer attivo.
//
// importMarkerAt() è esportata e usata anche da PJS-cmd-properties.mjs.

import { setDirty, getState } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";
import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import { showInputDialog } from "./PJS-ui-inputDialog.mjs";
import { getMarker, getMarkerOptions } from "./PJS-svg-markers.mjs";

// ── Funzione condivisa di importazione ────────────────────────────────────────
// Importa un marker SVG nel progetto Paper.js alle coordinate pos.
// Restituisce l'item Paper.js creato, oppure null in caso di errore.

export function importMarkerAt({ marker, label, scale, rotation, pos, layer, layerId, scope, bodyEl, interactiveId = '' }) {
  if (!marker || !layer || !scope) return null;

  // Sostituisce {{label}} se il marker lo prevede
  const svgStr = marker.hasLabel
    ? marker.svg.replace(/\{\{label\}\}/g, label || marker.labelDefault || '')
    : marker.svg;

  scope.activate();
  layer.activate();

  let item;
  try {
    item = scope.project.importSVG(svgStr, { expandShapes: true });
  } catch (e) {
    console.warn('[SVG-tool] importSVG error', e);
    return null;
  }
  if (!item) return null;

  // Scala alla larghezza richiesta
  const targetW = Math.max(1, scale || 80);
  const currW   = item.bounds?.width || 1;
  if (Math.abs(currW - targetW) > 0.01) item.scale(targetW / currW);

  // Rotazione assoluta
  if (rotation && Math.abs(rotation) > 0.01) item.rotate(rotation);

  // Posizionamento
  item.position = pos;

  // Marca figli come non-selezionabili individualmente
  _markChildren(item);

  // Dati item
  item.data = {
    kind:          'marker',
    layerId:       layerId || layer.data?.layerId || '',
    markerId:      marker.id,
    markerLabel:   marker.hasLabel ? (label || marker.labelDefault || '') : '',
    svgScale:      targetW,
    svgRotation:   rotation || 0,
    interactiveId: interactiveId || '',
  };

  setDirty(bodyEl, true);
  const _h = getState(bodyEl)?.history;
  if (_h) try { pushSnapshot(_h, { label: "SVG", snapshot: exportProjectJSON(getState(bodyEl)) }); } catch {}
  scope.view.update();
  return item;
}

// Marca ricorsivamente i figli di un Group SVG come non-selezionabili
function _markChildren(item) {
  if (!item?.children) return;
  for (const child of item.children) {
    child.data = { ...(child.data || {}), __svgChild: true };
    _markChildren(child);
  }
}

// ── Tool ──────────────────────────────────────────────────────────────────────

export function createSvgTool(paperTool, ctx) {
  const { state, cmdUI } = ctx;
  const body = ctx.bodyEl;
  const prevCursor = body?.style?.cursor || "";
  if (body?.style) body.style.cursor = "crosshair";

  function getActiveLayerId() {
    return state._env?.workspace?.defaults?.activeLayerId ?? "L1";
  }

  function getActiveDrawingLayer() {
    const ui       = state._uiLayer;
    const activeId = getActiveLayerId();
    for (const L of state.scope.project.layers) {
      if (L === ui) continue;
      if (L.data?.layerId === activeId) return L;
    }
    const L = new state.scope.Layer();
    L.name = activeId;
    L.data = { layerId: activeId };
    return L;
  }

  ctx.setRmbClose?.(() => ctx.exitTool());
  ctx.setEscCancel?.(() => ctx.exitTool());
  paperTool.onKeyDown = (e) => { if (e.key === "escape") ctx.exitTool(); };

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan()) return;
    if (event?.event?.button === 2) return;
    if (!state._env?.layers?.length) return;

    const pos  = event.point.clone();
    const defs = state._env?.workspace?.defaults || {};

    showInputDialog({
      title:  t("app.pjs.svg.insert"),
      fields: [
        {
          id: "markerId", label: t("app.pjs.svg.type"), type: "select",
          options: getMarkerOptions(),
          value: defs.lastSvgMarkerId || getMarkerOptions()[0]?.value || '',
        },
        {
          id: "scale", label: t("app.pjs.svg.scale"), type: "number",
          value: defs.lastSvgScale ?? 80, min: 1,
        },
        {
          id: "rotation", label: t("app.pjs.svg.rotation"), type: "number",
          value: defs.lastSvgRotation ?? 0, step: 1,
        },
        {
          id: "label", label: t("app.pjs.svg.label"), type: "text",
          placeholder: "A",
          value: defs.lastSvgLabel || '',
        },
        {
          id: "interactiveId", label: t("app.pjs.ctrl.interactive_id"), type: "text",
          placeholder: t("app.pjs.svg.id_placeholder"),
          value: defs.lastSvgInteractiveId || '',
        },
      ],
    }).then(result => {
      if (!result) { ctx.exitTool(); return; }

      const marker = getMarker(result.markerId);
      if (!marker) { ctx.exitTool(); return; }

      // Persiste le ultime scelte
      defs.lastSvgMarkerId       = result.markerId;
      defs.lastSvgScale          = Number(result.scale)    || 80;
      defs.lastSvgRotation       = Number(result.rotation) || 0;
      defs.lastSvgLabel          = result.label;
      defs.lastSvgInteractiveId  = result.interactiveId || '';

      const layer = getActiveDrawingLayer();
      importMarkerAt({
        marker,
        label:         result.label,
        scale:         Number(result.scale)    || 80,
        rotation:      Number(result.rotation) || 0,
        pos,
        layer,
        layerId:       getActiveLayerId(),
        scope:         state.scope,
        bodyEl:        ctx.bodyEl,
        interactiveId: result.interactiveId?.trim() || '',
      });

      cmdUI?.update?.({ status: t("app.pjs.svg.inserted", { name: marker.label }) });
      ctx.exitTool();
    });
  };

  cmdUI?.show?.({
    status:   t("app.pjs.svg.insert"),
    hints:    t("app.pjs.hint.place"),
    controls: "",
  });

  return () => {
    if (body?.style) body.style.cursor = prevCursor;
    cmdUI?.hide?.({ clear: true });
  };
}
