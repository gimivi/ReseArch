// APP/PJS_sub_modules/PJS-tool-polygon-edge.mjs
// CAD Regular Polygon by Edge
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

export function createPolygonEdgeTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  let p1 = null;
  let p2 = null;
  let hover = null;
  let preview = null;
  let rubber = null; // rubber band additiva (P1-P2)
  let phase = 0; // 0 p1, 1 p2, 2 preview/commit
  let sides = 6;

  let committed = false;
  let cancelled = false;

  // Cursor: crosshair during command, restore on exit
  const _cursorPrev = ctx.bodyEl?.style?.cursor || "";
  if (ctx.bodyEl) ctx.bodyEl.style.cursor = "crosshair";
  function _restoreCursor() {
    if (ctx.bodyEl) ctx.bodyEl.style.cursor = _cursorPrev;
  }

  // Idle snap hover (show snap marker before first point)
  let _hoverT = null;
  let _hoverEvt = null;

  function scheduleSnapHover(event, excludeItems = []) {
    if (phase !== 0 || p1) return;
    _hoverEvt = event;
    if (_hoverT) clearTimeout(_hoverT);
    _hoverT = setTimeout(() => {
      if (phase !== 0 || p1 || !_hoverEvt) return;
      let p = _hoverEvt.point.clone();
      const s = pickSnapPt(p, excludeItems);
      if (s) snapUpdateMarker(ctx.bodyEl, s, _hoverEvt.point);
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

  // Rubber band: colore layer corrente, tratteggiata, spessore metà del layer corrente
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

  function pickSnapPt(p, exclude = []) {
    if (ctx.isAltDown?.()) return null;
    return snapPick(ctx.bodyEl, p, { excludeItems: exclude });
  }

  function unit(v) {
    const len = v.length;
    return (len > 1e-9) ? v.divide(len) : v;
  }

  function cross(a, b) {
    return a.x * b.y - a.y * b.x;
  }

  function computeCenter(sideSign) {
    // Given side endpoints p1,p2 and N, find circumcenter.
    const n = Math.max(3, Math.min(64, Math.floor(Number(sides) || 3)));
    const s = p1.getDistance(p2);
    if (s < 1e-6) return null;

    const mid = p1.add(p2).divide(2);
    const v = p2.subtract(p1);
    const u = unit(v);
    const left = new state.scope.Point(-u.y, u.x);

    // distance from midpoint to circumcenter along normal:
    // d = s/(2*tan(pi/n))
    const ang = Math.PI / n;
    const tanA = Math.tan(ang);
    if (Math.abs(tanA) < 1e-9) return null;

    const d = s / (2 * tanA);
    return mid.add(left.multiply(d * sideSign));
  }

  function buildPolygonPoints(sideSign) {
    const n = Math.max(3, Math.min(64, Math.floor(Number(sides) || 3)));
    const c = computeCenter(sideSign);
    if (!c) return null;

    const a0 = Math.atan2(p1.y - c.y, p1.x - c.x);
    const a1 = Math.atan2(p2.y - c.y, p2.x - c.x);

    // choose sign (cw/ccw) that makes p2 close to rotating p1 by one step
    const step = 2 * Math.PI / n;
    const p2v = new state.scope.Point(Math.cos(a1), Math.sin(a1));
    const ccw = new state.scope.Point(Math.cos(a0 + step), Math.sin(a0 + step));
    const cw = new state.scope.Point(Math.cos(a0 - step), Math.sin(a0 - step));
    const errCCW = ccw.subtract(p2v).length;
    const errCW = cw.subtract(p2v).length;
    const dir = (errCCW <= errCW) ? 1 : -1;

    const r = c.getDistance(p1);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + dir * step * i;
      pts.push(c.add([Math.cos(a) * r, Math.sin(a) * r]));
    }
    return { center: c, radius: r, pts };
  }

  function sideSignFromHover(hp) {
    if (!p1 || !p2 || !hp) return 1;
    const v = p2.subtract(p1);
    const w = hp.subtract(p1);
    return (cross(v, w) >= 0) ? 1 : -1; // left side = +1
  }

  function buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "pjs-ctrls";

    const inpN = document.createElement("input");
    inpN.type = "number";
    inpN.step = "1";
    inpN.min = "3";
    inpN.max = "64";
    inpN.value = String(sides);
    inpN.style.width = "70px";
    inpN.setAttribute("aria-label", t("app.pjs.ctrl.sides"));
    inpN.onchange = () => {
      sides = Number(inpN.value);
      updatePreview();
    };

    const btnUndo = document.createElement("button");
    btnUndo.type = "button";
    btnUndo.textContent = t("app.pjs.ctrl.undo_last");
    btnUndo.className = "btn btn-sm";
    btnUndo.onclick = () => undoPoint();

    wrap.appendChild(document.createTextNode("N: "));
    wrap.appendChild(inpN);
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
      footerStatus(t("app.pjs.prompt.polygon_edge.p1"));
      return;
    }
    if (phase === 1) {
      footerStatus(t("app.pjs.prompt.polygon_edge.p2"));
      return;
    }

    const sign = sideSignFromHover(hover || p2);
    const res = (p1 && p2) ? buildPolygonPoints(sign) : null;
    const side = (p1 && p2) ? p1.getDistance(p2) : 0;
    const R = res?.radius ?? 0;
    footerStatus(
      t("app.pjs.prompt.polygon_edge.measure", { n: Number(sides) || 0, side: side.toFixed(1), r: R.toFixed(1) }) + (extra ? " • " + extra : "")
    );
  }

  function footerClear() {
    cmdUI.hide({ clear: true });
  }

  function updatePreview() {
    if (phase !== 2 || !p1 || !p2 || !hover) return;

    const sign = sideSignFromHover(hover);
    const res = buildPolygonPoints(sign);
    if (!res) return;

    try { preview?.remove(); } catch {}
    const { layerId, style } = getActiveLayerStyleAndId();

    preview = new state.scope.Path(res.pts);
    preview.closed = true;
    preview.data = {
      kind: "polygon",
      layerId,
      __preview: true,
      snapCenter: true,
      mode: "edge",
      sides: Number(sides) || 0
    };
    applyStyle(preview, style);

    footerUpdate();
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

    clearRubber();

    p1 = null;
    p2 = null;
    hover = null;
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
      snapClearMarker(ctx.bodyEl);

      try { preview?.remove(); } catch {}
      preview = null;

      p2 = null;
      hover = null;
      phase = 1;

      clearRubber();
      try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

      footerStatus(t("app.pjs.prompt.polygon_edge.p2"), {
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

      footerStatus(t("app.pjs.prompt.polygon_edge.p1"), {
        controls: buildControls(),
        ensureVisible: true
      });
      footerUpdate();
      state.scope.view.update();
    }
  }

  function commit() {
    if (phase !== 2 || !p1 || !p2 || !hover) return;

    const sign = sideSignFromHover(hover);
    const res = buildPolygonPoints(sign);
    if (!res) return;

    try { preview?.remove(); } catch {}
    preview = null;
    clearRubber();

    const { layerId, style } = getActiveLayerStyleAndId();
    const final = new state.scope.Path(res.pts);
    final.closed = true;
    final.data = {
      kind: "polygon",
      layerId,
      snapCenter: true,
      mode: "edge",
      sides: Number(sides) || 0,
      p1: [p1.x, p1.y],
      p2: [p2.x, p2.y],
      center: [res.center.x, res.center.y],
      radius: res.radius,
      sideSign: sign
    };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Poligono (Edge)", snapshot: exportProjectJSON(state) }); } catch {}

    snapClearMarker(ctx.bodyEl);
    // mark P3 at commit (hover point used for side selection)
    snapAddConstructionPoint(ctx.bodyEl, hover);
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    resetStateOnly();

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeCommand() {
    // RMB con tool attivo = chiude il comando.
    // Per polygon-edge:
    // - se siamo in fase preview, fa commit
    // - altrimenti esce semplicemente
    if (phase === 2 && p1 && p2 && hover) {
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
      const s = pickSnapPt(p);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else snapClearMarker(ctx.bodyEl);

      p1 = p;
      snapAddConstructionPoint(ctx.bodyEl, p1);
      phase = 1;

      footerStatus(t("app.pjs.prompt.polygon_edge.p2"), {
        controls: buildControls(),
        ensureVisible: true
      });
      footerUpdate();
      state.scope.view.update();
      return;
    }

    if (phase === 1) {
      let p = event.point.clone();
      const s = pickSnapPt(p, [
        ...(preview ? [preview] : []),
        ...(rubber ? [rubber] : [])
      ]);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else snapClearMarker(ctx.bodyEl);

      p2 = p;
      snapAddConstructionPoint(ctx.bodyEl, p2);

      clearRubber();

      phase = 2;
      hover = p2.clone();

      footerStatus(t("app.pjs.prompt.polygon_edge.move"), {
        controls: buildControls(),
        ensureVisible: true
      });
      footerUpdate();
      state.scope.view.update();
      return;
    }

    if (phase === 2) {
      commit();
    }
  };

  paperTool.onMouseMove = (event) => {
    if (phase === 0) {
      scheduleSnapHover(event);
      return;
    }

    if (phase === 1 && p1 && !p2) {
      // rubber band while choosing P2
      let p = event.point.clone();
      const s = pickSnapPt(p, [
        ...(preview ? [preview] : []),
        ...(rubber ? [rubber] : [])
      ]);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else snapClearMarker(ctx.bodyEl);

      updateRubber(p1, p);
      state.scope.view.update();
      return;
    }

    if (phase !== 2 || !p1 || !p2) return;

    let p = event.point.clone();
    const s = pickSnapPt(p, [
      ...(preview ? [preview] : []),
      ...(rubber ? [rubber] : [])
    ]);
    if (s) {
      p = s.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s, event.point);
    } else snapClearMarker(ctx.bodyEl);

    hover = p;
    updatePreview();
  };

  // Re-apply after manager footer init so controls are visible immediately
  setTimeout(() => {
    footerStatus(t("app.pjs.prompt.polygon_edge.p1"), {
      controls: buildControls(),
      ensureVisible: true
    });
    footerUpdate();
  }, 0);

  return () => {
    snapClearMarker(ctx.bodyEl);
    clearRubber();

    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
    }
    _hoverEvt = null;

    // Se il tool esce dopo finish corretto, NON toccare i construction points:
    // devono sparire col delay già programmato.
    if (!committed && cancelled) {
      try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}
    }

    _restoreCursor();
    footerClear();
  };
}