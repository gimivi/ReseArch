// APP/PJS_sub_modules/PJS-tool-arc.mjs
// CAD - Arc 3P: start, through, end
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

export function createArcTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  let pStart = null;
  let pThrough = null;
  let pEndHover = null;

  let preview = null;
  let rubber = null;
  let phase = 0; // 0=start, 1=through, 2=end

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
    if (phase !== 0 || pStart) return;

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
    p.dashArray = [Math.max(2, half * 4), Math.max(2, half * 4)];
    p.fillColor = null;
  }

  function clearRubber() {
    try { rubber?.remove?.(); } catch {}
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

  function buildPreviewLine(toPt) {
    try { preview?.remove?.(); } catch {}
    const { layerId, style } = getActiveLayerStyleAndId();
    preview = new state.scope.Path([pStart, toPt]);
    preview.data = { kind: "arc-preview-line", layerId, __preview: true };
    applyStyle(preview, style);
  }

  function buildPreviewArc(endPt) {
    try { preview?.remove?.(); } catch {}
    const { layerId, style } = getActiveLayerStyleAndId();
    const arc = new state.scope.Path.Arc(pStart, pThrough, endPt);
    arc.data = { kind: "arc", layerId, __preview: true, snapCenter: true };
    applyStyle(arc, style);
    preview = arc;
  }

  function resetStateOnly() {
    if (_hoverTimer) {
      clearTimeout(_hoverTimer);
      _hoverTimer = null;
      _hoverEvt = null;
    }

    try { preview?.remove?.(); } catch {}
    preview = null;

    clearRubber();

    pStart = null;
    pThrough = null;
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

      try { preview?.remove?.(); } catch {}
      preview = null;
      clearRubber();

      try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

      footerStatus(t("app.pjs.prompt.arc.through"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
      return;
    }

    if (phase === 1) {
      try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

      resetStateOnly();

      footerStatus(t("app.pjs.prompt.arc.start"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
    }
  }

  function commit() {
    if (phase !== 2 || !pStart || !pThrough || !pEndHover) return;

    try { preview?.remove?.(); } catch {}
    preview = null;
    clearRubber();

    const { layerId, style } = getActiveLayerStyleAndId();
    const final = new state.scope.Path.Arc(pStart, pThrough, pEndHover);
    final.data = {
      kind: "arc",
      layerId,
      start: [pStart.x, pStart.y],
      through: [pThrough.x, pThrough.y],
      end: [pEndHover.x, pEndHover.y],
      snapCenter: true
    };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Arco 3P", snapshot: exportProjectJSON(state) }); } catch {}

    snapClearMarker(ctx.bodyEl);
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    resetStateOnly();

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeCommand() {
    // RMB con tool attivo = chiude il comando.
    // Per arc 3P:
    // - in fase 2, se il preview esiste, commit
    // - altrimenti semplice uscita
    if (phase === 2 && pStart && pThrough && pEndHover) {
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

      pStart = p;
      snapAddConstructionPoint(ctx.bodyEl, pStart);

      phase = 1;
      footerStatus(t("app.pjs.prompt.arc.through"), {
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

      pThrough = p;
      snapAddConstructionPoint(ctx.bodyEl, pThrough);

      clearRubber();

      phase = 2;
      footerStatus(t("app.pjs.prompt.arc.end"), {
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
    if (!pStart) return;

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
      buildPreviewLine(p);
      updateRubber(pStart, p);
      footerStatus(t("app.pjs.prompt.arc.through"));
      state.scope.view.update();
      return;
    }

    if (phase !== 2 || !pThrough) return;

    pEndHover = p;
    updateRubber(pThrough, p);

    try {
      buildPreviewArc(p);
      footerStatus(t("app.pjs.prompt.arc.end"));
    } catch {
      buildPreviewLine(p);
      footerStatus(t("app.pjs.prompt.arc.collinear"));
    }

    state.scope.view.update();
  };

  // Re-apply after manager footer init so controls are visible immediately
  setTimeout(() => {
    footerStatus(t("app.pjs.prompt.arc.start"), {
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