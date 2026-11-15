// APP/PJS_sub_modules/PJS-tool-arc-cse.mjs
// CAD - Arc Center-Start-End
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

export function createArcCSETool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  let pCenter = null;     // P1
  let pStart = null;      // P2
  let pEndHover = null;   // P3 hover/final
  let preview = null;
  let rubber = null;
  let phase = 0;          // 0=center, 1=start, 2=end

  let committed = false;
  let cancelled = false;

  const _cursorPrev = ctx.bodyEl?.style?.cursor || "";
  if (ctx.bodyEl) ctx.bodyEl.style.cursor = "crosshair";
  function _restoreCursor() {
    if (ctx.bodyEl) ctx.bodyEl.style.cursor = _cursorPrev;
  }

  let _hoverTimer = null;
  let _hoverEvt = null;

  function scheduleSnapHover(event, excludeItems = []) {
    if (ctx.isAltDown?.()) {
      snapClearMarker(ctx.bodyEl);
      return;
    }

    if (phase !== 0 || pCenter) return;

    _hoverEvt = event;
    if (_hoverTimer) clearTimeout(_hoverTimer);

    _hoverTimer = setTimeout(() => {
      const ev = _hoverEvt;
      _hoverEvt = null;
      _hoverTimer = null;
      if (!ev) return;

      let p = ev.point.clone();
      const s = pickSnap(p, excludeItems);
      if (s) snapUpdateMarker(ctx.bodyEl, s, ev.point);
      else snapClearMarker(ctx.bodyEl);

      state.scope.view.update();
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

  function applyRubberStyle(p, style) {
    const sw = Number(style.strokeWidth || 1);
    const half = Math.max(0.5, sw / 2);

    p.strokeColor = style.strokeColor || "#000000";
    p.strokeWidth = half;

    const dash = Math.max(2, half * 4);
    p.dashArray = [dash, dash];

    p.fillColor = null;
  }

  function clearRubber() {
    try { rubber?.remove(); } catch {}
    rubber = null;
  }

  function updateRubber(a, b) {
    if (!a || !b) return;

    clearRubber();

    const { layerId, style } = getActiveLayerStyleAndId();
    rubber = new state.scope.Path([a, b]);
    rubber.data = { kind: "rubber", layerId, __preview: true, __rubber: true };
    applyRubberStyle(rubber, style);
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

  function normalizeAngleDelta(d) {
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    return d;
  }

  function buildArcPoints(center, start, end, steps = 64) {
    const r = center.getDistance(start);
    if (r < 0.5) return null;

    const ang0 = Math.atan2(start.y - center.y, start.x - center.x);
    const ang1 = Math.atan2(end.y - center.y, end.x - center.x);
    const d = normalizeAngleDelta(ang1 - ang0);

    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = ang0 + d * (i / steps);
      pts.push(center.add([Math.cos(a) * r, Math.sin(a) * r]));
    }
    return { points: pts, radius: r };
  }

  function buildPreviewArc(endPt) {
    const res = buildArcPoints(pCenter, pStart, endPt, 32);
    if (!res) throw new Error("radius too small");

    try { preview?.remove(); } catch {}
    preview = null;

    const { layerId, style } = getActiveLayerStyleAndId();
    preview = new state.scope.Path(res.points);
    preview.data = { kind: "arc_cse", layerId, __preview: true, snapCenter: true };
    applyStyle(preview, style);
  }

  function resetStateOnly() {
    if (_hoverTimer) {
      clearTimeout(_hoverTimer);
      _hoverTimer = null;
      _hoverEvt = null;
    }

    try { preview?.remove(); } catch {}
    preview = null;

    clearRubber();

    pCenter = null;
    pStart = null;
    pEndHover = null;
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
      pEndHover = null;
      phase = 1;

      try { preview?.remove(); } catch {}
      preview = null;
      clearRubber();

      try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

      footerStatus(t("app.pjs.prompt.arc_cse.start"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
      return;
    }

    if (phase === 1) {
      try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}
      resetStateOnly();

      footerStatus(t("app.pjs.prompt.arc_cse.center"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
    }
  }

  function commit() {
    if (phase !== 2 || !pCenter || !pStart || !pEndHover) return;

    const res = buildArcPoints(pCenter, pStart, pEndHover, 64);
    if (!res) return;

    try { preview?.remove(); } catch {}
    preview = null;
    clearRubber();

    const { layerId, style } = getActiveLayerStyleAndId();
    const final = new state.scope.Path(res.points);
    final.data = {
      kind: "arc_cse",
      layerId,
      center: [pCenter.x, pCenter.y],
      start: [pStart.x, pStart.y],
      end: [pEndHover.x, pEndHover.y],
      radius: res.radius,
      snapCenter: true
    };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Arco CSE", snapshot: exportProjectJSON(state) }); } catch {}

    snapClearMarker(ctx.bodyEl);
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    resetStateOnly();

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeCommand() {
    // RMB con tool attivo = chiude il comando.
    // Per arc CSE:
    // - in fase 2, se il preview esiste, commit
    // - altrimenti semplice uscita
    if (phase === 2 && pCenter && pStart && pEndHover) {
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
      _restoreCursor();
      return ctx.exitTool();
    }
    if (event.key === "enter") return commit(); // allowed, but not advertised
    if (event.key === "backspace") return undoPoint();
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

      pCenter = p;
      snapAddConstructionPoint(ctx.bodyEl, pCenter);

      phase = 1;
      footerStatus(t("app.pjs.prompt.arc_cse.start"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
      return;
    }

    if (phase === 1) {
      let p = event.point.clone();
      const exclude = [
        ...(preview ? [preview] : []),
        ...(rubber ? [rubber] : [])
      ];
      const s = pickSnap(p, exclude);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      pStart = p;
      snapAddConstructionPoint(ctx.bodyEl, pStart);

      clearRubber();

      phase = 2;
      footerStatus(t("app.pjs.prompt.arc_cse.end"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
      return;
    }

    if (phase === 2) {
      let p = event.point.clone();
      const exclude = [
        ...(preview ? [preview] : []),
        ...(rubber ? [rubber] : [])
      ];
      const s = pickSnap(p, exclude);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      pEndHover = p;
      snapAddConstructionPoint(ctx.bodyEl, pEndHover);

      commit();
    }
  };

  paperTool.onMouseMove = (event) => {
    if (phase === 0) {
      scheduleSnapHover(event);
      return;
    }
    if (!pCenter) return;

    let p = event.point.clone();
    const exclude = [
      ...(preview ? [preview] : []),
      ...(rubber ? [rubber] : [])
    ];
    const s = pickSnap(p, exclude);
    if (s) {
      p = s.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    if (phase === 1) {
      updateRubber(pCenter, p);
      footerStatus(t("app.pjs.prompt.arc_cse.start"));
      state.scope.view.update();
      return;
    }

    if (phase !== 2 || !pStart) return;

    pEndHover = p;

    const r = pCenter.getDistance(pStart);
    const d = pCenter.getDistance(p);
    let rbEnd = p;
    if (d > 1e-6 && d <= r) {
      rbEnd = pCenter.add(p.subtract(pCenter).normalize(r));
    }

    updateRubber(pCenter, rbEnd);

    try {
      buildPreviewArc(p);
      footerStatus(t("app.pjs.prompt.arc_cse.end"));
    } catch {
      footerStatus(t("app.pjs.prompt.arc_cse.no_preview"));
    }

    state.scope.view.update();
  };

  // Re-apply after manager footer init so controls are visible immediately
  setTimeout(() => {
    footerStatus(t("app.pjs.prompt.arc_cse.center"), {
      controls: buildControls(),
      ensureVisible: true
    });
  }, 0);

  return () => {
    if (_hoverTimer) {
      clearTimeout(_hoverTimer);
      _hoverTimer = null;
      _hoverEvt = null;
    }

    snapClearMarker(ctx.bodyEl);
    clearRubber();

    // Se il tool esce dopo finish corretto, NON toccare i construction points:
    // devono sparire col delay già programmato.
    if (!committed && cancelled) {
      try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}
    }

    _restoreCursor();
    footerClear();
  };
}