// APP/PJS_sub_modules/PJS-tool-circle-3p.mjs
// CAD - Circle 3P: p1, p2, p3
// Uniformato ai criteri consolidati:
// - Geometry in image space
// - Snap via PJS-snap
// - Cursor crosshair during tool
// - White construction markers on picked points
// - Backspace removes last point + last marker
// - RMB closes command
// - Esc cancels command
// - Enter allowed but not advertised
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

export function createCircle3PTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  let p1 = null;
  let p2 = null;
  let p3Hover = null;
  let preview = null;
  let phase = 0; // 0 p1, 1 p2, 2 p3

  let committed = false;
  let cancelled = false;

  // Snap hover pre-first point
  let _hoverT = null;
  let _hoverEvt = null;

  // Cursor
  const _cursorEl = ctx.bodyEl;
  const _prevCursor = _cursorEl?.style?.cursor || "";
  if (_cursorEl) _cursorEl.style.cursor = "crosshair";

  function scheduleSnapHover(event, excludeItems = []) {
    _hoverEvt = event;
    if (_hoverT) clearTimeout(_hoverT);

    _hoverT = setTimeout(() => {
      _hoverT = null;
      if (!_hoverEvt) return;

      if (ctx.isAltDown?.()) {
        snapClearMarker(ctx.bodyEl);
        return;
      }

      let p = _hoverEvt.point.clone();
      const s = pickSnap(p, excludeItems);
      if (s) snapUpdateMarker(ctx.bodyEl, s, _hoverEvt.point);
      else snapClearMarker(ctx.bodyEl);
    }, 70);
  }

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

  function footerStatus(status, { controls = undefined, ensureVisible = false } = {}) {
    const payload = { status };
    if (controls !== undefined) payload.controls = controls;

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

  function buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "pjs-ctrls";

    const btnUndo = document.createElement("button");
    btnUndo.type = "button";
    btnUndo.textContent = t("app.pjs.ctrl.undo_last");
    btnUndo.className = "btn btn-sm";
    btnUndo.onclick = () => undoPoint();

    wrap.appendChild(btnUndo);
    return wrap;
  }

  function circleFrom3Points(A, B, C) {
    const ax = A.x, ay = A.y;
    const bx = B.x, by = B.y;
    const cx = C.x, cy = C.y;

    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-6) return null;

    const ax2ay2 = ax * ax + ay * ay;
    const bx2by2 = bx * bx + by * by;
    const cx2cy2 = cx * cx + cy * cy;

    const ux = (ax2ay2 * (by - cy) + bx2by2 * (cy - ay) + cx2cy2 * (ay - by)) / d;
    const uy = (ax2ay2 * (cx - bx) + bx2by2 * (ax - cx) + cx2cy2 * (bx - ax)) / d;

    const center = new state.scope.Point(ux, uy);
    const r = center.getDistance(A);
    return { center, radius: r };
  }

  function updatePreview2P(p2HoverLocal) {
    if (!p1 || !p2HoverLocal) return;
    const d = p1.getDistance(p2HoverLocal);
    if (d < 1) return;

    const center = p1.add(p2HoverLocal).divide(2);
    const r = d / 2;

    try { preview?.remove(); } catch {}
    const { layerId, style } = getActiveLayerStyleAndId();

    preview = new state.scope.Path.Circle({ center, radius: r });
    preview.data = {
      kind: "circle",
      layerId,
      __preview: true,
      snapCenter: true,
      mode: "3p-pre2p"
    };
    applyStyle(preview, style);

    footerStatus(t("app.pjs.prompt.circle_3p.pre_measure", { d: d.toFixed(1), r: r.toFixed(1) }));
    state.scope.view.update();
  }

  function updatePreview() {
    if (phase !== 2 || !p1 || !p2 || !p3Hover) return;
    const res = circleFrom3Points(p1, p2, p3Hover);
    if (!res || res.radius < 0.5) return;

    try { preview?.remove(); } catch {}
    const { layerId, style } = getActiveLayerStyleAndId();

    preview = new state.scope.Path.Circle({ center: res.center, radius: res.radius });
    preview.data = {
      kind: "circle",
      layerId,
      __preview: true,
      snapCenter: true,
      mode: "3p"
    };
    applyStyle(preview, style);

    footerStatus(t("app.pjs.prompt.circle_3p.measure", { r: res.radius.toFixed(1) }));
    state.scope.view.update();
  }

  function resetStateOnly() {
    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
    }
    _hoverEvt = null;

    try { preview?.remove(); } catch {}
    preview = null;

    p1 = null;
    p2 = null;
    p3Hover = null;
    phase = 0;
  }

  function cancelCommand() {
    cancelled = true;

    snapClearMarker(ctx.bodyEl);
    try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}

    resetStateOnly();

    footerClear();
    state.scope.view.update();
  }

  function undoPoint() {
    if (phase === 2) {
      p3Hover = null;
      phase = 1;

      try { preview?.remove(); } catch {}
      preview = null;

      try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

      footerStatus(t("app.pjs.prompt.circle_3p.p2"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
      return;
    }

    if (phase === 1) {
      try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

      resetStateOnly();

      footerStatus(t("app.pjs.prompt.circle_3p.p1"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
    }
  }

  function commit() {
    if (phase !== 2 || !p1 || !p2 || !p3Hover) return;

    const res = circleFrom3Points(p1, p2, p3Hover);
    if (!res || res.radius < 0.5) {
      footerStatus(t("app.pjs.prompt.circle_3p.collinear"));
      return;
    }

    try { preview?.remove(); } catch {}
    preview = null;

    const { layerId, style } = getActiveLayerStyleAndId();
    const final = new state.scope.Path.Circle({ center: res.center, radius: res.radius });
    final.data = {
      kind: "circle",
      layerId,
      snapCenter: true,
      mode: "3p",
      p1: [p1.x, p1.y],
      p2: [p2.x, p2.y],
      p3: [p3Hover.x, p3Hover.y],
      center: [res.center.x, res.center.y],
      radius: res.radius
    };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Cerchio 3P", snapshot: exportProjectJSON(state) }); } catch {}

    snapClearMarker(ctx.bodyEl);
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    resetStateOnly();

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeCommand() {
    // RMB con tool attivo = chiude il comando.
    // Per circle 3P:
    // - in fase 2, se il preview esiste, commit
    // - altrimenti semplice uscita
    if (phase === 2 && p1 && p2 && p3Hover) {
      commit();
      return;
    }

    footerClear();
    ctx.exitTool?.();
  }

  // CAD hooks
  ctx.setRmbClose?.(closeCommand);
  ctx.setEscCancel?.(cancelCommand);

  paperTool.onKeyDown = (event) => {
    if (event.key === "escape") {
      cancelCommand();
      return ctx.exitTool();
    }
    if (event.key === "enter") commit(); // allowed, but not advertised
    if (event.key === "backspace") undoPoint();
  };

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan()) return;
    if (event?.event?.button === 2) return;
    if (!state._env?.layers?.length) return;

    ensureSnapSystem(ctx.bodyEl);
    state.scope.activate();
    getActiveDrawingLayer().activate();

    if (phase === 0) {
      let p = event.point.clone();
      const s = pickSnap(p);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      p1 = p;
      snapAddConstructionPoint(ctx.bodyEl, p1);
      phase = 1;

      footerStatus(t("app.pjs.prompt.circle_3p.p2"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
      return;
    }

    if (phase === 1) {
      let p = event.point.clone();
      const s = pickSnap(p, preview ? [preview] : []);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      p2 = p;
      snapAddConstructionPoint(ctx.bodyEl, p2);
      phase = 2;
      p3Hover = p.clone();

      footerStatus(t("app.pjs.prompt.circle_3p.p3"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
      return;
    }

    if (phase === 2) {
      let p = event.point.clone();
      const s = pickSnap(p, preview ? [preview] : []);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      p3Hover = p;
      snapAddConstructionPoint(ctx.bodyEl, p3Hover);
      commit();
    }
  };

  paperTool.onMouseMove = (event) => {
    if (phase === 0 || !p1) {
      scheduleSnapHover(event);
      return;
    }

    let p = event.point.clone();
    const s = pickSnap(p, preview ? [preview] : []);
    if (s) {
      p = s.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    if (phase === 1) {
      updatePreview2P(p);
      return;
    }

    if (phase !== 2 || !p2) return;

    p3Hover = p;
    updatePreview();
  };

  setTimeout(() => {
    footerStatus(t("app.pjs.prompt.circle_3p.p1"), {
      controls: buildControls(),
      ensureVisible: true
    });
  }, 0);

  return () => {
    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
    }

    snapClearMarker(ctx.bodyEl);

    if (!committed && cancelled) {
      try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}
    }

    if (_cursorEl) _cursorEl.style.cursor = _prevCursor || "";
    footerClear();
  };
}