// APP/PJS_sub_modules/PJS-tool-line.mjs (CAD - click + rubber-band; fixed layer/style)
import { setDirty } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";
import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import {
  ensureSnapSystem,
  snapPick,
  snapUpdateMarker,
  snapClearMarker,
  snapAddConstructionPoint,
  snapClearConstructionPoints
} from "./PJS-snap.mjs";



export function createLineTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  // cursor management (pointer -> crosshair while tool active)
  const _cursorEl = ctx.bodyEl;
  const _prevCursor = _cursorEl?.style?.cursor || "";
  if (_cursorEl) _cursorEl.style.cursor = "crosshair";

  let startImg = null;
  let tempLine = null;
  let hoverImg = null;
  let committed = false;

  function getActiveLayerStyleAndId() {
    const env = state._env;
    const activeId = env.workspace?.defaults?.activeLayerId;
    const L = env.layers?.find(x => x.id === activeId);
    return { layerId: activeId, style: (L?.style || {}) };
  }

  function applyStyle(p, style) {
    p.strokeColor = style.strokeColor || "#000000";
    p.strokeWidth = Number(style.strokeWidth || 1);
    p.dashArray = Array.isArray(style.dashArray) ? style.dashArray : [];
    p.fillColor = null;
  }

  function getActiveDrawingLayer() {
    const env = state._env;
    const ui = state._uiLayer;
    const activeId = env.workspace?.defaults?.activeLayerId;

    for (const L of state.scope.project.layers) {
      if (L === ui) continue;
      if (L.data?.layerId === activeId) return L;
    }
    const L = new state.scope.Layer();
    L.name = activeId || "Layer";
    L.data = L.data || {};
    L.data.layerId = activeId || "L1";
    return L;
  }

function footerStatus(status, mode = "update") {
  const payload = { status, hints: undefined, controls: undefined };

  if (mode === "show") cmdUI.show(payload);
  else cmdUI.update(payload);
}


  function footerClear() {
    cmdUI.hide({ clear: true });
  }

  function pickSnap(imgPoint, exclude = []) {
    if (ctx.isAltDown?.()) return null;
    return snapPick(ctx.bodyEl, imgPoint, { excludeItems: exclude });
  }

function updateHoverSnap(event, excludeItems = []) {
  if (ctx.isAltDown?.()) {
    snapClearMarker(ctx.bodyEl);
    state._snapMissCount = 0;
    return null;
  }

  const p = event.point.clone();
  const s = pickSnap(p, excludeItems);

  if (s) {
    state._snapMissCount = 0;
    snapUpdateMarker(ctx.bodyEl, s, event.point);
    return s;
  }

  // Non spegnere subito al primo frame senza snap
  state._snapMissCount = (state._snapMissCount || 0) + 1;
  if (state._snapMissCount >= 3) {
    snapClearMarker(ctx.bodyEl);
    state._snapMissCount = 0;
  }

  return null;
}

  function cancelTemp(msg = t("app.pjs.prompt.line.start")) {
    try { tempLine?.remove(); } catch {}
    tempLine = null;
    startImg = null;
    hoverImg = null;
    snapClearMarker(ctx.bodyEl);
    // keep UI clean if user cancels mid-command
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 });
   footerStatus(msg, "show");
    state.scope.view.update();
  }

  function commitLine(p0, p1) {
    const len = p0.getDistance(p1);
    if (len < 0.5) return cancelTemp(t("app.pjs.prompt.line.too_short"));

    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Linea", snapshot: exportProjectJSON(state) }); } catch {}

     tempLine = null;
    startImg = null;
    hoverImg = null;
    snapClearMarker(ctx.bodyEl);
    // fade out construction point markers after finishing the command
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    committed = true;
    footerClear();
    ctx.exitTool();;
    state.scope.view.update();
  }

  function commitFromHover() {
    if (!startImg || !tempLine || !hoverImg) return;
    try {
      tempLine.segments[0].point = startImg;
      tempLine.segments[1].point = hoverImg;
      tempLine.data.__preview = false;
    } catch {}
    commitLine(startImg.clone(), hoverImg.clone());
  }

  paperTool.onKeyDown = (event) => {
    if (event.key === "escape") {
      footerClear();
      return ctx.exitTool();
    }
    if (event.key === "enter") commitFromHover();
  };

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan()) return;
    if (event?.event?.button === 2) return;
    if (!state._env?.layers?.length) return;

    ensureSnapSystem(ctx.bodyEl);
    state.scope.activate();
    getActiveDrawingLayer().activate();

    if (!startImg) {
      let p0 = event.point.clone();
      const s0 = updateHoverSnap(event);
      if (s0) p0 = s0.imgPoint;

      startImg = p0;
      hoverImg = p0.clone();

      // marker for P1
      snapAddConstructionPoint(ctx.bodyEl, startImg);

      const { layerId, style } = getActiveLayerStyleAndId();
      tempLine = new state.scope.Path([p0, p0.clone()]);
      tempLine.data = { kind: "line", layerId, __preview: true };
      applyStyle(tempLine, style);

      footerStatus(t("app.pjs.prompt.line.end"));
      state.scope.view.update();
      return;
    }

    let endImg = event.point.clone();
    const s1 = updateHoverSnap(event, tempLine ? [tempLine] : []);
    if (s1) endImg = s1.imgPoint;

    hoverImg = endImg.clone();

    // marker for P2
    snapAddConstructionPoint(ctx.bodyEl, hoverImg);

    try { tempLine.data.__preview = false; } catch {}
    commitLine(startImg.clone(), endImg.clone());
  };

  paperTool.onMouseMove = (event) => {
    // pre-P1: show snap marker directly on hover (no timer)
    if (!startImg && !tempLine) {
      updateHoverSnap(event);
      return;
    }

    if (!tempLine || !startImg) return;

    let p = event.point.clone();
    const s = updateHoverSnap(event, [tempLine]);
    if (s) p = s.imgPoint;

    hoverImg = p.clone();
    tempLine.segments[1].point = p;

    const len = startImg.getDistance(p);
    footerStatus(t("app.pjs.prompt.line.measure", { l: len.toFixed(1) }));
    state.scope.view.update();
  };

  footerStatus(t("app.pjs.prompt.line.start"), "show");

return () => {
  try { tempLine?.remove(); } catch {}
  tempLine = null;
  startImg = null;
  hoverImg = null;

  snapClearMarker(ctx.bodyEl);

  // Cancella subito i construction markers solo se il comando
  // NON è terminato con commit normale
  if (!committed) {
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 });
  }

  footerClear();

  if (_cursorEl) _cursorEl.style.cursor = _prevCursor;
};
}
