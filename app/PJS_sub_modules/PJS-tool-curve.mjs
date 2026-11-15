// APP/PJS_sub_modules/PJS-tool-curve.mjs
// CAD - Curve (Catmull-Rom spline through control points -> Bezier path)
// Uniformato ai criteri operativi di polyline:
// - Geometry in image space
// - Snap via PJS-snap
// - Cursor crosshair during tool
// - White construction markers on each picked point
// - Backspace removes last point + last marker
// - RMB closes command (open curve)
// - Esc cancels command
// - C closes geometry
// - Markers fade after 1500ms on finish

import { setDirty } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";
import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import {
  ensureSnapSystem,
  snapPick,
  snapUpdateMarker,
  snapClearMarker,
  snapAddConstructionPoint,
  snapRemoveLastConstructionPoint,
  snapClearConstructionPoints
} from "./PJS-snap.mjs";

export function createCurveTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  // Cursor handling
  const _cursorEl = ctx.bodyEl;
  const _prevCursor = _cursorEl?.style?.cursor ?? "";
  if (_cursorEl) _cursorEl.style.cursor = "crosshair";

  const IDLE_HOVER_MS = 70;
  let _hoverT = null;
  let _hoverEvt = null;

  let ctrlPts = [];     // committed control points
  let hoverPt = null;   // current hover point
  let preview = null;   // preview path
  let isDrawing = false;
  let committed = false;
  let cancelled = false;

  function getActiveLayerStyleAndId() {
    const env = state._env;
    const activeId = env.workspace?.defaults?.activeLayerId;
    const L = env.layers.find(x => x.id === activeId);
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

  function pickSnap(p, exclude = []) {
    if (ctx.isAltDown?.()) return null;
    return snapPick(ctx.bodyEl, p, { excludeItems: exclude });
  }

  function scheduleSnapHover(event, excludeItems = []) {
    if (ctx.isTempPan?.()) return;
    if (ctx.isAltDown?.()) {
      snapClearMarker(ctx.bodyEl);
      return;
    }

    _hoverEvt = event;
    if (_hoverT) clearTimeout(_hoverT);

    _hoverT = setTimeout(() => {
      _hoverT = null;
      if (!_hoverEvt) return;

      const ev = _hoverEvt;
      let p = ev.point.clone();
      const s = pickSnap(p, excludeItems);
      if (s) snapUpdateMarker(ctx.bodyEl, s, ev.point);
      else snapClearMarker(ctx.bodyEl);
    }, IDLE_HOVER_MS);
  }

  function buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "pjs-ctrls";

    const btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.textContent = t("app.pjs.ctrl.close_c");
    btnClose.className = "btn btn-sm";
    btnClose.onclick = () => closeAndFinish();

    const btnUndo = document.createElement("button");
    btnUndo.type = "button";
    btnUndo.textContent = t("app.pjs.ctrl.undo_last");
    btnUndo.className = "btn btn-sm";
    btnUndo.onclick = () => undoPoint();

    wrap.appendChild(btnClose);
    wrap.appendChild(btnUndo);

    return wrap;
  }

  function footerStatus(status, { controls = undefined, ensureVisible = false } = {}) {
    const payload = { status, hints: undefined, controls };

    if (ensureVisible) {
      const footerEl = cmdUI.el?.();
      const visible = !!footerEl?.classList?.contains("is-visible");
      if (visible) cmdUI.update(payload);
      else cmdUI.show(payload);
      return;
    }

    cmdUI.update(payload);
  }

  function footerClear() {
    cmdUI.hide({ clear: true });
  }

  // ---- Catmull-Rom (centripetal) -> Bezier ----

  function _dist(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function _add(a, b) { return new state.scope.Point(a.x + b.x, a.y + b.y); }
  function _sub(a, b) { return new state.scope.Point(a.x - b.x, a.y - b.y); }
  function _mul(a, k) { return new state.scope.Point(a.x * k, a.y * k); }

  function catmullRomBezierControls(p0, p1, p2, p3, alpha = 0.5) {
    const eps = 1e-9;
    const t0 = 0;
    const t1 = t0 + Math.pow(_dist(p0, p1) + eps, alpha);
    const t2 = t1 + Math.pow(_dist(p1, p2) + eps, alpha);
    const t3 = t2 + Math.pow(_dist(p2, p3) + eps, alpha);

    const dt21 = Math.max(eps, t2 - t1);
    const dt20 = Math.max(eps, t2 - t0);
    const dt31 = Math.max(eps, t3 - t1);

    const m1 = _mul(_sub(p2, p0), dt21 / dt20);
    const m2 = _mul(_sub(p3, p1), dt21 / dt31);

    const c1 = _add(p1, _mul(m1, 1 / 3));
    const c2 = _sub(p2, _mul(m2, 1 / 3));

    return { c1, c2 };
  }

  function buildBezierPath(points, closed) {
    const P = points.slice();

    const path = new state.scope.Path();
    path.closed = !!closed;

    if (P.length === 0) return path;
    if (P.length === 1) {
      path.add(P[0]);
      return path;
    }

    const n = P.length;
    function get(i) {
      if (!closed) {
        if (i < 0) return P[0];
        if (i >= n) return P[n - 1];
        return P[i];
      }
      const k = ((i % n) + n) % n;
      return P[k];
    }

    path.add(get(0));

    const segCount = closed ? n : (n - 1);
    for (let i = 0; i < segCount; i++) {
      const p0 = get(i - 1);
      const p1 = get(i);
      const p2 = get(i + 1);
      const p3 = get(i + 2);

      const { c1, c2 } = catmullRomBezierControls(p0, p1, p2, p3, 0.5);

      const currSeg = path.segments[i];
      currSeg.handleOut = _sub(c1, p1);

      const nextPoint = p2;
      const nextSeg = new state.scope.Segment(nextPoint);
      nextSeg.handleIn = _sub(c2, nextPoint);
      path.add(nextSeg);
    }

    if (closed) {
      if (path.segments.length > n) {
        path.segments[path.segments.length - 1].remove();
      }
      path.closed = true;
    }

    return path;
  }

  function updatePreview() {
    const pts = ctrlPts.slice();
    if (isDrawing && hoverPt) pts.push(hoverPt);

    if (pts.length < 2) {
      try { preview?.remove(); } catch {}
      preview = null;
      state.scope.view.update();
      return;
    }

    try { preview?.remove(); } catch {}
    preview = null;

    const { layerId, style } = getActiveLayerStyleAndId();
    preview = buildBezierPath(pts, false);
    preview.data = { kind: "curve", layerId, __preview: true, mode: "spline" };
    applyStyle(preview, style);

    footerStatus(t("app.pjs.prompt.curve.points", { n: `${ctrlPts.length}${hoverPt ? "+" : ""}` }));
    state.scope.view.update();
  }

  function cancelCommand() {
    cancelled = true;

    snapClearMarker(ctx.bodyEl);
    try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}

    try { preview?.remove(); } catch {}
    preview = null;

    ctrlPts = [];
    hoverPt = null;
    isDrawing = false;

    footerClear();
    state.scope.view.update();
  }

  function finish(closed = false) {
    if (ctrlPts.length < 2) {
      cancelCommand();
      return;
    }

    try { preview?.remove(); } catch {}
    preview = null;

    const { layerId, style } = getActiveLayerStyleAndId();
    const final = buildBezierPath(ctrlPts, !!closed);
    final.data = {
      kind: "curve",
      layerId,
      mode: "spline",
      closed: !!closed,
      ctrl: ctrlPts.map(p => [p.x, p.y])
    };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Curva", snapshot: exportProjectJSON(state) }); } catch {}

    snapClearMarker(ctx.bodyEl);
    try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 }); } catch {}

    ctrlPts = [];
    hoverPt = null;
    isDrawing = false;

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeAndFinish() {
    if (ctrlPts.length < 3) {
      footerStatus(t("app.pjs.prompt.curve.min_close"));
      return;
    }
    finish(true);
  }

  function closeCommand() {
    if (!isDrawing || ctrlPts.length === 0) {
      footerClear();
      ctx.exitTool?.();
      return;
    }
    finish(false);
  }

  function undoPoint() {
    if (ctrlPts.length === 0) return;
    ctrlPts.pop();
    try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

    if (ctrlPts.length === 0) {
      try { preview?.remove(); } catch {}
      preview = null;
      hoverPt = null;
      isDrawing = false;
      footerStatus(t("app.pjs.prompt.curve.p1"), { controls: buildControls(), ensureVisible: true });
      state.scope.view.update();
      return;
    }

    hoverPt = ctrlPts[ctrlPts.length - 1].clone();
    updatePreview();
  }

  function isNearFirst(p, pxTol = 12) {
    if (ctrlPts.length === 0) return false;
    const v = state.scope.view;
    const first = ctrlPts[0];
    const a = v.projectToView(first);
    const b = v.projectToView(p);
    const dx = a.x - b.x, dy = a.y - b.y;
    return (dx * dx + dy * dy) <= (pxTol * pxTol);
  }

  // CAD hooks
  ctx.setRmbClose?.(closeCommand);
  ctx.setEscCancel?.(cancelCommand);

  paperTool.onKeyDown = (event) => {
    if (event.key === "escape") {
      cancelCommand();
      return ctx.exitTool();
    }
    if (event.key === "enter") return finish(false); // allowed but not advertised
    if (event.key === "backspace") return undoPoint();
    if (event.key === "c") return closeAndFinish();
  };

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan?.()) return;
    if (event?.event?.button === 2) return;
    if (!state._env?.layers?.length) return;

    ensureSnapSystem(ctx.bodyEl);
    state.scope.activate();
    getActiveDrawingLayer().activate();

    // double click => close command open
    if (event?.event?.detail >= 2 && isDrawing) return finish(false);

    let p = event.point.clone();
    const exclude = [...(preview ? [preview] : [])];
    const s = pickSnap(p, exclude);
    if (s) {
      p = s.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    if (!isDrawing) {
      ctrlPts = [p];
      isDrawing = true;
      hoverPt = p.clone();
      snapAddConstructionPoint(ctx.bodyEl, p);

      footerStatus(t("app.pjs.prompt.curve.p2"), {
        controls: buildControls(),
        ensureVisible: true
      });
      updatePreview();
      return;
    }

    if (ctrlPts.length >= 3 && isNearFirst(p, 12)) {
      snapAddConstructionPoint(ctx.bodyEl, p);
      finish(true);
      return;
    }

    ctrlPts.push(p);
    snapAddConstructionPoint(ctx.bodyEl, p);
    hoverPt = p.clone();
    updatePreview();
  };

  paperTool.onMouseMove = (event) => {
    if (!isDrawing || ctrlPts.length === 0) {
      scheduleSnapHover(event, []);
      return;
    }

    let p = event.point.clone();
    const exclude = [...(preview ? [preview] : [])];
    const s = pickSnap(p, exclude);
    if (s) {
      p = s.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    hoverPt = p;
    updatePreview();
  };

  footerStatus(t("app.pjs.prompt.curve.p1"), {
    controls: buildControls(),
    ensureVisible: true
  });

  return () => {
    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
    }
    _hoverEvt = null;

    try { preview?.remove(); } catch {}
    preview = null;

    snapClearMarker(ctx.bodyEl);

    // Se il tool esce dopo finish corretto, NON toccare i construction points:
    // devono sparire col delay già programmato.
    if (!committed && cancelled) {
      try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}
    }

    if (_cursorEl) _cursorEl.style.cursor = _prevCursor || "";

    footerClear();
  };
}