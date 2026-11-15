// APP/PJS_sub_modules/PJS-tool-rect-edge.mjs
// CAD Rectangle by Edge + Height
// Uniformato ai criteri consolidati:
// - Geometry in image space
// - Snap via PJS-snap
// - Cursor crosshair during tool
// - White construction markers on each picked point
// - Backspace removes last point + last marker
// - RMB closes command
// - Esc cancels command
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

export function createRectEdgeTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  const _cursorEl = ctx.bodyEl;
  const _prevCursor = _cursorEl?.style?.cursor || "";
  if (_cursorEl) _cursorEl.style.cursor = "crosshair";

  let p1 = null;
  let p2 = null;
  let h = 0;
  let preview = null;
  let phase = 0; // 0: p1, 1: p2(edge), 2: height
  let lastMouse = null;
  let rubber = null;

  let committed = false;
  let cancelled = false;

  let inpH = null;

  let _hoverT = null;
  let _hoverEvt = null;

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
    p.strokeColor = style.strokeColor || "#000000";
    p.strokeWidth = Math.max(0.5, Number(style.strokeWidth || 1) / 2);
    p.dashArray = [8, 6];
    p.fillColor = null;
  }

  function clearRubber() {
    try { rubber?.remove?.(); } catch {}
    rubber = null;
  }

  function updateRubber(toPt) {
    if (!p1 || !toPt) return;
    const { layerId, style } = getActiveLayerStyleAndId();

    if (!rubber) {
      rubber = new state.scope.Path({
        segments: [p1.clone(), toPt.clone()],
        closed: false
      });
      rubber.data = { kind: "rubber", layerId, __preview: true, __rubber: true };
      applyRubberStyle(rubber, style);
    } else {
      rubber.segments[0].point = p1.clone();
      rubber.segments[1].point = toPt.clone();
      applyRubberStyle(rubber, style);
    }
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

  function pickSnapPt(p, exclude = []) {
    if (ctx.isAltDown?.()) return null;
    return snapPick(ctx.bodyEl, p, { excludeItems: exclude });
  }

  function scheduleSnapHover(event, excludeItems = []) {
    _hoverEvt = event;
    if (_hoverT) clearTimeout(_hoverT);

    _hoverT = setTimeout(() => {
      _hoverT = null;
      const ev = _hoverEvt;
      _hoverEvt = null;

      try {
        if (!ev) return;
        if (ctx.isAltDown?.()) {
          snapClearMarker(ctx.bodyEl);
          return;
        }

        let p = ev.point.clone();
        const s = pickSnapPt(p, excludeItems);
        if (s) snapUpdateMarker(ctx.bodyEl, s, ev.point);
        else snapClearMarker(ctx.bodyEl);
      } catch {
        // ignore
      }
    }, 70);
  }

  function unit(v) {
    const len = v.length;
    return (len > 1e-9) ? v.divide(len) : v;
  }

  function edgeVec() {
    return p2.subtract(p1);
  }

  function edgeLen() {
    return p1 && p2 ? p1.getDistance(p2) : 0;
  }

  function signedHeightFromMouse(mousePt) {
    const v = edgeVec();
    const u = unit(v);
    const n = new state.scope.Point(-u.y, u.x); // left normal
    const w = mousePt.subtract(p1);
    return w.dot(n);
  }

  function buildRectPoints(heightSigned) {
    const v = edgeVec();
    const u = unit(v);
    const n = new state.scope.Point(-u.y, u.x);
    const hh = heightSigned;

    const p3 = p2.add(n.multiply(hh));
    const p4 = p1.add(n.multiply(hh));
    return [p1, p2, p3, p4];
  }

  function buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "pjs-ctrls";

    inpH = document.createElement("input");
    inpH.type = "number";
    inpH.step = "1";
    inpH.placeholder = "H";
    inpH.style.width = "80px";
    inpH.setAttribute("aria-label", t("app.pjs.ctrl.height"));
    inpH.onchange = () => {
      const v = Number(inpH.value);
      if (!isFinite(v)) return;
      const s = (h === 0 && lastMouse) ? Math.sign(signedHeightFromMouse(lastMouse)) : (Math.sign(h) || 1);
      h = s * Math.abs(v);
      updatePreview();
      footerUpdate();
    };

    const btnApply = document.createElement("button");
    btnApply.type = "button";
    btnApply.textContent = t("app.pjs.ctrl.apply_h");
    btnApply.className = "btn btn-sm";
    btnApply.onclick = () => inpH?.onchange?.();

    const btnFlip = document.createElement("button");
    btnFlip.type = "button";
    btnFlip.textContent = t("app.pjs.ctrl.flip_side");
    btnFlip.className = "btn btn-sm";
    btnFlip.onclick = () => {
      h = -h;
      updatePreview();
      footerUpdate();
    };

    const btnUndo = document.createElement("button");
    btnUndo.type = "button";
    btnUndo.textContent = t("app.pjs.ctrl.undo_last");
    btnUndo.className = "btn btn-sm";
    btnUndo.onclick = () => undoPoint();

    wrap.appendChild(inpH);
    wrap.appendChild(btnApply);
    wrap.appendChild(btnFlip);
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

  function footerUpdate(extra = "") {
    if (phase === 0) {
      footerStatus(t("app.pjs.prompt.rect_edge.p1"));
      return;
    }
    if (phase === 1) {
      footerStatus(t("app.pjs.prompt.rect_edge.p2"));
      return;
    }

    const L = edgeLen();
    const HH = Math.abs(h || 0);
    footerStatus(t("app.pjs.prompt.rect_edge.measure", { l: L.toFixed(1), h: HH.toFixed(1) }) + (extra ? " • " + extra : ""));

    if (inpH) inpH.value = HH ? HH.toFixed(1) : "";
  }

  function footerClear() {
    cmdUI.hide({ clear: true });
  }

  function updatePreview() {
    if (phase !== 2 || !p1 || !p2) return;

    try { preview?.remove(); } catch {}
    const { layerId, style } = getActiveLayerStyleAndId();

    const pts = buildRectPoints(h);
    preview = new state.scope.Path(pts);
    preview.closed = true;
    preview.data = { kind: "rect", layerId, __preview: true, mode: "edge", snapCenter: true };
    applyStyle(preview, style);

    state.scope.view.update();
  }

  function resetStateOnly() {
    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
      _hoverEvt = null;
    }

    clearRubber();

    try { preview?.remove(); } catch {}
    preview = null;

    p1 = null;
    p2 = null;
    h = 0;
    phase = 0;
    lastMouse = null;
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
      snapClearMarker(ctx.bodyEl);

      try { preview?.remove(); } catch {}
      preview = null;

      p2 = null;
      h = 0;
      phase = 1;
      lastMouse = null;

      clearRubber();
      try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

      footerStatus(t("app.pjs.prompt.rect_edge.p2"), {
        controls: buildControls(),
        ensureVisible: true
      });
      footerUpdate();
      state.scope.view.update();
      return;
    }

    if (phase === 1) {
      snapClearMarker(ctx.bodyEl);
      try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

      resetStateOnly();

      footerStatus(t("app.pjs.prompt.rect_edge.p1"), {
        controls: buildControls(),
        ensureVisible: true
      });
      footerUpdate();
      state.scope.view.update();
    }
  }

  function commit() {
    if (phase !== 2 || !p1 || !p2) return;
    if (edgeLen() < 1) return;
    if (Math.abs(h) < 1) return;

    try { preview?.remove(); } catch {}
    preview = null;
    clearRubber();

    const { layerId, style } = getActiveLayerStyleAndId();
    const pts = buildRectPoints(h);
    const final = new state.scope.Path(pts);
    final.closed = true;
    final.data = {
      kind: "rect",
      layerId,
      mode: "edge",
      p1: [p1.x, p1.y],
      p2: [p2.x, p2.y],
      height: h,
      snapCenter: true
    };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Rettangolo (Edge)", snapshot: exportProjectJSON(state) }); } catch {}

    snapClearMarker(ctx.bodyEl);
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    resetStateOnly();

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
    return;
  }

  function closeCommand() {
    // RMB con tool attivo = chiude il comando.
    // Per rect-edge:
    // - se siamo in fase altezza, chiude facendo commit aperto del comando
    // - se siamo in fase precedente, esce semplicemente
    if (phase === 2 && p1 && p2 && Math.abs(h) >= 1) {
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
      const s = pickSnapPt(p);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      p1 = p;
      snapAddConstructionPoint(ctx.bodyEl, p1);

      clearRubber();
      phase = 1;

      footerStatus(t("app.pjs.prompt.rect_edge.p2"), {
        controls: buildControls(),
        ensureVisible: true
      });
      footerUpdate();
      state.scope.view.update();
      return;
    }

    if (phase === 1) {
      let p = event.point.clone();
      const s = pickSnapPt(p, rubber ? [rubber] : []);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      p2 = p;
      snapAddConstructionPoint(ctx.bodyEl, p2);

      clearRubber();
      phase = 2;
      lastMouse = p2.clone();
      h = 0;

      footerStatus(t("app.pjs.prompt.rect_edge.height"), {
        controls: buildControls(),
        ensureVisible: true
      });
      footerUpdate();
      state.scope.view.update();
      return;
    }

    if (phase === 2) {
      let p = event.point.clone();
      const s = pickSnapPt(p, preview ? [preview] : []);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      lastMouse = p;
      h = signedHeightFromMouse(p);

      snapAddConstructionPoint(ctx.bodyEl, p); // P3 marker
      updatePreview();
      footerUpdate();

      commit();
    }
  };

  paperTool.onMouseMove = (event) => {
    if (phase === 0) {
      scheduleSnapHover(event, [...(preview ? [preview] : []), ...(rubber ? [rubber] : [])]);
      return;
    }

    if (phase === 1 && p1 && !p2) {
      let p = event.point.clone();
      const s = pickSnapPt(p, rubber ? [rubber] : []);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      updateRubber(p);
      state.scope.view.update();
      return;
    }

    if (phase !== 2 || !p1 || !p2) return;

    let p = event.point.clone();
    const s = pickSnapPt(p, preview ? [preview] : []);
    if (s) {
      p = s.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    lastMouse = p;
    h = signedHeightFromMouse(p);
    updatePreview();
    footerUpdate();
  };

  setTimeout(() => {
    footerStatus(t("app.pjs.prompt.rect_edge.p1"), {
      controls: buildControls(),
      ensureVisible: true
    });
    footerUpdate();
  }, 0);

  return () => {
    try {
      if (_cursorEl) _cursorEl.style.cursor = _prevCursor;
    } catch {}

    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
      _hoverEvt = null;
    }

    snapClearMarker(ctx.bodyEl);
    clearRubber();

    // Se il tool esce dopo finish corretto, NON toccare i construction points:
    // devono sparire col delay già programmato.
    if (!committed && cancelled) {
      try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}
    }

    footerClear();
  };
}