// APP/PJS_sub_modules/PJS-tool-ellipse.mjs
// CAD - Ellipse by bbox (2 points)
// Uniformato ai criteri consolidati:
// - Geometry in image space
// - Snap via PJS-snap
// - Cursor crosshair during tool
// - White construction markers on picked points
// - RMB closes command
// - Esc cancels command
// - Enter allowed but not advertised
// - Shift = circle bbox
// - From center = checkbox only
// - Alt = bypass snap only
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

export function createEllipseTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  let start = null;
  let preview = null;
  let rubberRect = null;
  let lastRect = null;
  let lastEnd = null;

  let optCircle = false; // square bbox => circle
  let optCenter = false; // start is center (checkbox only)

  let committed = false;
  let cancelled = false;

  let inpW, inpH, chkCircle, chkCenter;

  // Snap hover before first click
  let _hoverT = null;
  let _hoverEvt = null;

  // Cursor
  const _cursorEl = ctx.bodyEl;
  const _prevCursor = _cursorEl?.style?.cursor || "";
  if (_cursorEl) _cursorEl.style.cursor = "crosshair";

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

  function clearRubberRect() {
    try { rubberRect?.remove(); } catch {}
    rubberRect = null;
  }

  function updateRubberRect(rect) {
    if (!rect) return;
    clearRubberRect();
    const { layerId, style } = getActiveLayerStyleAndId();
    rubberRect = new state.scope.Path.Rectangle(rect);
    rubberRect.data = { kind: "rubber-rect", layerId, __preview: true, __rubber: true };
    applyRubberStyle(rubberRect, style);
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
    _hoverEvt = event;
    if (_hoverT) clearTimeout(_hoverT);

    _hoverT = setTimeout(() => {
      _hoverT = null;
      const ev = _hoverEvt;
      _hoverEvt = null;
      if (!ev) return;

      if (ctx.isAltDown?.()) {
        snapClearMarker(ctx.bodyEl);
        return;
      }

      let p = ev.point.clone();
      const s = pickSnap(p, excludeItems);
      if (s) snapUpdateMarker(ctx.bodyEl, s, ev.point);
      else snapClearMarker(ctx.bodyEl);
    }, 70);
  }

  // start resta l'ancora:
  // - vertice se optCenter=false
  // - centro  se optCenter=true
  // Se optCircle=true forza bbox quadrata mantenendo la stessa ancora.
  function makeRectFrom(startPt, rawEndPt) {
    let dx = rawEndPt.x - startPt.x;
    let dy = rawEndPt.y - startPt.y;

    if (optCircle) {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (Math.sign(dx) || 1) * side;
      dy = (Math.sign(dy) || 1) * side;
    }

    if (optCenter) {
      const p1 = startPt.add([-dx, -dy]);
      const p2 = startPt.add([ dx,  dy]);
      return new state.scope.Rectangle(p1, p2);
    }

    const p2 = startPt.add([dx, dy]);
    return new state.scope.Rectangle(startPt, p2);
  }

  function updatePreview(rect) {
    lastRect = rect;

    try { preview?.remove(); } catch {}
    const { layerId, style } = getActiveLayerStyleAndId();

    preview = new state.scope.Path.Ellipse(rect);
    preview.data = { kind: "ellipse", layerId, __preview: true, snapCenter: true };
    applyStyle(preview, style);

    state.scope.view.update();
  }

  function buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "pjs-ctrls";

    chkCircle = document.createElement("input");
    chkCircle.type = "checkbox";
    chkCircle.checked = optCircle;
    chkCircle.onchange = () => {
      optCircle = chkCircle.checked;
      if (start && lastEnd) {
        const rect = makeRectFrom(start, lastEnd);
        updateRubberRect(rect);
        updatePreview(rect);
        footerUpdate();
      } else {
        footerStatus(undefined, { controls: buildControls() });
      }
    };

    chkCenter = document.createElement("input");
    chkCenter.type = "checkbox";
    chkCenter.checked = optCenter;
    chkCenter.onchange = () => {
      optCenter = chkCenter.checked;
      if (start && lastEnd) {
        const rect = makeRectFrom(start, lastEnd);
        updateRubberRect(rect);
        updatePreview(rect);
        footerUpdate();
      } else {
        footerStatus(undefined, { controls: buildControls() });
      }
    };

    const l1 = document.createElement("label");
    l1.style.marginLeft = "10px";
    l1.appendChild(chkCircle);
    l1.appendChild(document.createTextNode(" " + t("app.pjs.ctrl.circle_bbox")));

    const l2 = document.createElement("label");
    l2.style.marginLeft = "10px";
    l2.appendChild(chkCenter);
    l2.appendChild(document.createTextNode(" " + t("app.pjs.ctrl.from_center")));

    inpW = document.createElement("input");
    inpW.type = "number";
    inpW.step = "1";
    inpW.placeholder = "W";
    inpW.style.width = "80px";
    inpW.setAttribute("aria-label", t("app.pjs.ctrl.width"));
    inpW.onchange = () => applyWH();

    inpH = document.createElement("input");
    inpH.type = "number";
    inpH.step = "1";
    inpH.placeholder = "H";
    inpH.style.width = "80px";
    inpH.setAttribute("aria-label", t("app.pjs.ctrl.height"));
    inpH.onchange = () => applyWH();

    const btnApply = document.createElement("button");
    btnApply.type = "button";
    btnApply.textContent = t("app.pjs.ctrl.apply_wh");
    btnApply.className = "btn btn-sm";
    btnApply.onclick = () => applyWH();

    wrap.appendChild(inpW);
    wrap.appendChild(inpH);
    wrap.appendChild(btnApply);
    wrap.appendChild(l1);
    wrap.appendChild(l2);

    return wrap;
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

  function footerUpdate(extra = "") {
    if (!lastRect) {
      footerStatus(t("app.pjs.prompt.ellipse.p1"));
      return;
    }

    const w = Math.abs(lastRect.width);
    const h = Math.abs(lastRect.height);
    const msg = t("app.pjs.prompt.ellipse.measure", { w: w.toFixed(1), h: h.toFixed(1) }) + (extra ? " • " + extra : "");
    footerStatus(msg);

    if (inpW) inpW.value = w.toFixed(1);
    if (inpH) inpH.value = h.toFixed(1);
  }

  function footerClear() {
    cmdUI.hide({ clear: true });
  }

  function applyWH() {
    if (!start) return;

    const w = Number(inpW?.value);
    const h = Number(inpH?.value);
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return;

    let p1;
    if (optCenter) {
      p1 = start.add([w / 2, h / 2]);
    } else {
      p1 = start.add([w, h]);
    }

    lastEnd = p1.clone();

    const rect = makeRectFrom(start, p1);
    updateRubberRect(rect);
    updatePreview(rect);
    footerUpdate();
  }

  function resetStateOnly() {
    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
      _hoverEvt = null;
    }

    try { preview?.remove(); } catch {}
    preview = null;

    clearRubberRect();

    start = null;
    lastRect = null;
    lastEnd = null;
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
    if (!lastRect) return;

    try { preview?.remove(); } catch {}
    preview = null;
    clearRubberRect();

    const { layerId, style } = getActiveLayerStyleAndId();
    const final = new state.scope.Path.Ellipse(lastRect);
    final.data = {
      kind: "ellipse",
      layerId,
      snapCenter: true,
      mode: "bbox",
      rect: {
        x: lastRect.x,
        y: lastRect.y,
        width: lastRect.width,
        height: lastRect.height
      }
    };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Ellisse", snapshot: exportProjectJSON(state) }); } catch {}

    snapClearMarker(ctx.bodyEl);
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    resetStateOnly();

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeCommand() {
    // RMB con tool attivo = chiude il comando.
    // Per ellipse 2P, se il preview esiste si fa commit.
    if (!start || !lastRect) {
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
      return ctx.exitTool();
    }
    if (event.key === "enter") commit(); // allowed, but not advertised
  };

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan()) return;
    if (event?.event?.button === 2) return;
    if (!state._env?.layers?.length) return;

    ensureSnapSystem(ctx.bodyEl);
    state.scope.activate();
    getActiveDrawingLayer().activate();

    optCircle = !!event.modifiers?.shift || !!chkCircle?.checked;
    optCenter = !!chkCenter?.checked; // Alt non usato qui: Alt = no snap

    if (!start) {
      let p0 = event.point.clone();
      const s0 = pickSnap(p0);
      if (s0) {
        p0 = s0.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s0, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      start = p0;
      snapAddConstructionPoint(ctx.bodyEl, start);

      footerStatus(t("app.pjs.prompt.ellipse.p2"), {
        controls: buildControls(),
        ensureVisible: true
      });

      state.scope.view.update();
      return;
    }

    commit();
  };

  paperTool.onMouseMove = (event) => {
    if (!start) {
      scheduleSnapHover(event, [
        ...(preview ? [preview] : []),
        ...(rubberRect ? [rubberRect] : [])
      ]);
      return;
    }

    optCircle = !!event.modifiers?.shift || !!chkCircle?.checked;
    optCenter = !!chkCenter?.checked;

    let p1 = event.point.clone();
    const exclude = [
      ...(preview ? [preview] : []),
      ...(rubberRect ? [rubberRect] : [])
    ];
    const s1 = pickSnap(p1, exclude);
    if (s1) {
      p1 = s1.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s1, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    lastEnd = p1.clone();

    const rect = makeRectFrom(start, p1);
    updateRubberRect(rect);
    updatePreview(rect);
    footerUpdate();
  };

  // Re-apply after manager footer init so controls are visible immediately
  setTimeout(() => {
    footerStatus(t("app.pjs.prompt.ellipse.p1"), {
      controls: buildControls(),
      ensureVisible: true
    });
  }, 0);

  return () => {
    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
      _hoverEvt = null;
    }

    snapClearMarker(ctx.bodyEl);
    clearRubberRect();

    if (!committed && cancelled) {
      try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}
    }

    if (_cursorEl) _cursorEl.style.cursor = _prevCursor || "";
    footerClear();
  };
}