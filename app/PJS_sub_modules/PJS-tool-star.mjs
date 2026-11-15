// APP/PJS_sub_modules/PJS-tool-star.mjs
// CAD Star Polygon (Paper.js Path.Star)
// Uniformato ai criteri consolidati:
// - Click P1=center
// - Move: preview outer radius + rotation defined by P1->cursor
// - Click P2=commit (P1-P2 defines BOTH radius and rotation)
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
  snapClearConstructionPoints
} from "./PJS-snap.mjs";

export function createStarTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  let center = null;       // P1
  let aimPt = null;        // P2 (defines radius + rotation)
  let rOuter = 0;
  let rInner = 0;
  let preview = null;
  let rubber = null;       // rubber band additiva (P1-P2)

  let points = 5;
  let innerRatio = 0.5; // inner radius = outer * ratio
  let innerMode = false; // if true, cursor defines inner vertex radius

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
    if (center) return;
    _hoverEvt = event;
    if (_hoverT) clearTimeout(_hoverT);
    _hoverT = setTimeout(() => {
      if (center || !_hoverEvt) return;
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

  function rotateStarToDirection(path, c, dirPt) {
    // Align first outer vertex to the direction (c -> dirPt)
    try {
      const seg0 = path.segments?.[0]?.point;
      if (!seg0) return;
      const curAng = Math.atan2(seg0.y - c.y, seg0.x - c.x);
      const desAng = Math.atan2(dirPt.y - c.y, dirPt.x - c.x);
      const deltaDeg = (desAng - curAng) * 180 / Math.PI;
      path.rotate(deltaDeg, c);
    } catch {}
  }

  function buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "pjs-ctrls";

    const inpN = document.createElement("input");
    inpN.type = "number";
    inpN.step = "1";
    inpN.min = "3";
    inpN.max = "64";
    inpN.value = String(points);
    inpN.style.width = "70px";
    inpN.setAttribute("aria-label", t("app.pjs.ctrl.star_points"));
    inpN.onchange = () => {
      points = Number(inpN.value);
      if (center && rOuter > 1) updatePreview(aimPt || center.add([rOuter, 0]));
    };

    const inpRatio = document.createElement("input");
    inpRatio.type = "number";
    inpRatio.step = "0.05";
    inpRatio.min = "0.05";
    inpRatio.max = "0.95";
    inpRatio.value = String(innerRatio);
    inpRatio.style.width = "80px";
    inpRatio.setAttribute("aria-label", t("app.pjs.ctrl.inner_ratio"));
    inpRatio.onchange = () => {
      innerRatio = Number(inpRatio.value);
      if (center && rOuter > 1) updatePreview(aimPt || center.add([rOuter, 0]));
    };

    const chkInner = document.createElement("input");
    chkInner.type = "checkbox";
    chkInner.checked = !!innerMode;
    chkInner.onchange = () => {
      innerMode = !!chkInner.checked;
      if (center && aimPt) updatePreview(aimPt);
    };

    const lblInner = document.createElement("label");
    lblInner.style.marginLeft = "10px";
    lblInner.appendChild(chkInner);
    lblInner.appendChild(document.createTextNode(" " + t("app.pjs.ctrl.inner_mode")));

    wrap.appendChild(document.createTextNode("N: "));
    wrap.appendChild(inpN);
    wrap.appendChild(document.createTextNode(" " + t("app.pjs.ctrl.ratio") + " "));
    wrap.appendChild(inpRatio);
    wrap.appendChild(lblInner);

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

  function updatePreview(mousePt) {
    if (!center || !mousePt) return;

    aimPt = mousePt;
    const d = center.getDistance(mousePt);
    if (d < 1) return;

    const n = Math.max(3, Math.min(64, Math.floor(Number(points) || 5)));
    const ratio = Math.max(0.05, Math.min(0.95, Number(innerRatio) || 0.5));

    if (innerMode) {
      // Cursor defines INNER vertex radius
      rInner = Math.max(0.5, d);
      rOuter = Math.max(rInner + 0.5, rInner / ratio);
    } else {
      // Cursor defines OUTER vertex radius
      rOuter = d;
      rInner = Math.max(0.5, rOuter * ratio);
    }

    try { preview?.remove(); } catch {}
    preview = null;

    const { layerId, style } = getActiveLayerStyleAndId();

    // IMPORTANT: Paper.js signature in this project is treated as (outer, inner)
    preview = innerMode
      ? new state.scope.Path.Star(center, n, rInner, rOuter)
      : new state.scope.Path.Star(center, n, rOuter, rInner);

    rotateStarToDirection(preview, center, mousePt);

    preview.data = {
      kind: "star",
      layerId,
      __preview: true,
      snapCenter: true,
      points: n,
      rInner,
      rOuter,
      innerMode
    };
    applyStyle(preview, style);

    footerStatus(t(innerMode ? "app.pjs.prompt.star.measure_inner" : "app.pjs.prompt.star.measure", { n, r: rOuter.toFixed(1), ri: rInner.toFixed(1) }));
    state.scope.view.update();
  }

  function resetStateOnly() {
    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
      _hoverEvt = null;
    }

    try { preview?.remove(); } catch {}
    preview = null;

    clearRubber();

    center = null;
    aimPt = null;
    rOuter = 0;
    rInner = 0;
  }

  function cancelCommand() {
    cancelled = true;

    snapClearMarker(ctx.bodyEl);
    try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}

    resetStateOnly();

    footerClear();
    state.scope.view.update();
  }

  function commit() {
    if (!center || rOuter < 1) return;

    const n = Math.max(3, Math.min(64, Math.floor(Number(points) || 5)));
    const ratio = Math.max(0.05, Math.min(0.95, Number(innerRatio) || 0.5));

    // Recompute radii defensively based on current mode
    if (innerMode) {
      rInner = Math.max(0.5, rInner || (aimPt ? center.getDistance(aimPt) : 0));
      rOuter = Math.max(rInner + 0.5, rInner / ratio);
    } else {
      rOuter = Math.max(0.5, rOuter);
      rInner = Math.max(0.5, rOuter * ratio);
    }

    try { preview?.remove(); } catch {}
    preview = null;
    clearRubber();

    const { layerId, style } = getActiveLayerStyleAndId();
    const final = innerMode
      ? new state.scope.Path.Star(center, n, rInner, rOuter)
      : new state.scope.Path.Star(center, n, rOuter, rInner);

    rotateStarToDirection(final, center, aimPt || center.add([rOuter, 0]));

    final.data = {
      kind: "star",
      layerId,
      snapCenter: true,
      points: n,
      rInner,
      rOuter,
      innerMode,
      center: [center.x, center.y],
      p2: aimPt ? [aimPt.x, aimPt.y] : null
    };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Stella", snapshot: exportProjectJSON(state) }); } catch {}
    snapClearMarker(ctx.bodyEl);

    // Markers fade after command end
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    resetStateOnly();

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeCommand() {
    // RMB con tool attivo = chiude il comando.
    // Per star: se il preview esiste si fa commit, altrimenti semplice uscita.
    if (!center || rOuter < 1) {
      footerClear();
      ctx.exitTool?.();
      return;
    }
    commit();
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
  };

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan()) return;
    if (event?.event?.button === 2) return;
    if (!state._env?.layers?.length) return;

    ensureSnapSystem(ctx.bodyEl);
    state.scope.activate();
    getActiveDrawingLayer().activate();

    if (!center) {
      let p = event.point.clone();
      const s = pickSnapPt(p);
      if (s) {
        p = s.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      center = p;
      snapAddConstructionPoint(ctx.bodyEl, center);

      footerStatus(t("app.pjs.prompt.star.radius"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
      return;
    }

    // second click: commit using this P2 (radius + rotation)
    let p2 = event.point.clone();
    const exclude = [
      ...(preview ? [preview] : []),
      ...(rubber ? [rubber] : [])
    ];
    const s2 = pickSnapPt(p2, exclude);
    if (s2) {
      p2 = s2.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s2, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    aimPt = p2;
    snapAddConstructionPoint(ctx.bodyEl, p2);
    updatePreview(p2);
    commit();
  };

  paperTool.onMouseMove = (event) => {
    if (!center) {
      scheduleSnapHover(event, preview ? [preview] : []);
      return;
    }

    let p = event.point.clone();
    const exclude = [
      ...(preview ? [preview] : []),
      ...(rubber ? [rubber] : [])
    ];
    const s = pickSnapPt(p, exclude);
    if (s) {
      p = s.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    updateRubber(center, p);
    updatePreview(p);
  };

  // Re-apply after manager footer init so controls are visible immediately
  setTimeout(() => {
    footerStatus(t("app.pjs.prompt.star.center"), {
      controls: buildControls(),
      ensureVisible: true
    });
  }, 0);

  return () => {
    snapClearMarker(ctx.bodyEl);

    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
      _hoverEvt = null;
    }

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