// APP/PJS_sub_modules/PJS-tool-circle.mjs
// CAD - Circle center + radius/diameter
// Uniformato ai criteri consolidati:
// - Geometry in image space
// - Snap via PJS-snap
// - Cursor crosshair during tool
// - White construction markers on picked points
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

export function createCircleTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  let center = null;
  let preview = null;
  let radius = null;
  let mode = "radius"; // "radius" | "diameter"

  let committed = false;
  let cancelled = false;

  // Snap hover pre-first point
  let _hoverT = null;
  let _hoverEvt = null;

  // Cursor management
  const _cursorEl = ctx.bodyEl;
  const _prevCursor = _cursorEl?.style?.cursor || "";
  if (_cursorEl) _cursorEl.style.cursor = "crosshair";

  // Rubber band center -> cursor
  let rubber = null;

  let selMode = null;
  let inpVal = null;

  function clearRubber() {
    try { rubber?.remove(); } catch {}
    rubber = null;
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

  function effectiveRadiusFromDistance(dist) {
    return (mode === "diameter") ? (dist / 2) : dist;
  }

  function buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "pjs-ctrls";

    selMode = document.createElement("select");
    selMode.setAttribute("aria-label", t("app.pjs.ctrl.size_mode"));
    const o1 = document.createElement("option");
    o1.value = "radius";
    o1.textContent = t("app.pjs.ctrl.radius");

    const o2 = document.createElement("option");
    o2.value = "diameter";
    o2.textContent = t("app.pjs.ctrl.diameter");

    selMode.appendChild(o1);
    selMode.appendChild(o2);
    selMode.value = mode;
    selMode.onchange = () => {
      mode = selMode.value;
      footerUpdate();
    };

    inpVal = document.createElement("input");
    inpVal.type = "number";
    inpVal.step = "1";
    inpVal.placeholder = mode === "diameter" ? "D" : "R";
    inpVal.style.width = "90px";
    inpVal.setAttribute("aria-label", t("app.pjs.ctrl.value"));
    inpVal.onchange = () => applyValue();

    const btnApply = document.createElement("button");
    btnApply.type = "button";
    btnApply.textContent = t("common.apply");
    btnApply.className = "btn btn-sm";
    btnApply.onclick = () => applyValue();

    wrap.appendChild(selMode);
    wrap.appendChild(inpVal);
    wrap.appendChild(btnApply);

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
    if (!center) {
      footerStatus(t("app.pjs.prompt.circle.center"));
      return;
    }

    const r = radius ?? 0;
    const d = r * 2;
    const msg = t("app.pjs.prompt.circle.measure", { r: r.toFixed(1), d: d.toFixed(1) }) + (extra ? " • " + extra : "");
    footerStatus(msg);

    if (inpVal) inpVal.placeholder = mode === "diameter" ? "D" : "R";
  }

  function footerClear() {
    cmdUI.hide({ clear: true });
  }

  function updatePreview(r) {
    radius = r;

    try { preview?.remove(); } catch {}
    const { layerId, style } = getActiveLayerStyleAndId();

    preview = new state.scope.Path.Circle({ center, radius: r });
    preview.data = { kind: "circle", layerId, __preview: true, snapCenter: true };
    applyStyle(preview, style);

    state.scope.view.update();
  }

  function applyValue() {
    if (!center) return;
    const v = Number(inpVal?.value);
    if (!isFinite(v) || v <= 0) return;

    const r = (mode === "diameter") ? (v / 2) : v;
    updatePreview(r);
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

    clearRubber();

    center = null;
    radius = null;
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
    if (!center || !radius || radius < 0.5) return;

    try { preview?.remove(); } catch {}
    preview = null;
    clearRubber();

    const { layerId, style } = getActiveLayerStyleAndId();
    const final = new state.scope.Path.Circle({ center, radius });
    final.data = {
      kind: "circle",
      layerId,
      center: [center.x, center.y],
      radius,
      mode,
      snapCenter: true
    };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Cerchio", snapshot: exportProjectJSON(state) }); } catch {}

    snapClearMarker(ctx.bodyEl);
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    resetStateOnly();

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeCommand() {
    // RMB con tool attivo = chiude il comando.
    // Per circle center+radius, se il preview esiste si fa commit.
    if (!center || !radius || radius < 0.5) {
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

    if (!center) {
      let p0 = event.point.clone();
      const s0 = pickSnap(p0);
      if (s0) {
        p0 = s0.imgPoint;
        snapUpdateMarker(ctx.bodyEl, s0, event.point);
      } else {
        snapClearMarker(ctx.bodyEl);
      }

      center = p0;
      snapAddConstructionPoint(ctx.bodyEl, center);

      footerStatus(
        mode === "diameter" ? t("app.pjs.prompt.circle.diameter") : t("app.pjs.prompt.circle.radius"),
        { controls: buildControls(), ensureVisible: true }
      );
      footerUpdate();
      state.scope.view.update();
      return;
    }

    let p1 = event.point.clone();
    const s1 = pickSnap(p1, preview ? [preview] : []);
    if (s1) {
      p1 = s1.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s1, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    const dist = center.getDistance(p1);
    const r = effectiveRadiusFromDistance(dist);
    if (r >= 0.5) updatePreview(r);

    snapAddConstructionPoint(ctx.bodyEl, p1);
    commit();
  };

  paperTool.onMouseMove = (event) => {
    if (!center) {
      scheduleSnapHover(event);
      return;
    }

    let p1 = event.point.clone();
    const s1 = pickSnap(p1, preview ? [preview] : []);
    if (s1) {
      p1 = s1.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s1, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    const dist = center.getDistance(p1);
    const r = effectiveRadiusFromDistance(dist);
    if (r < 0.5) return;

    updatePreview(r);
    updateRubber(center, p1);
    footerUpdate();
  };

  // Re-apply after manager footer init so controls are visible immediately
  setTimeout(() => {
    footerStatus(t("app.pjs.prompt.circle.center"), {
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
    clearRubber();

    if (!committed && cancelled) {
      try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}
    }

    if (_cursorEl) _cursorEl.style.cursor = _prevCursor || "";
    footerClear();
  };
}