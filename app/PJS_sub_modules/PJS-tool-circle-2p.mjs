// APP/PJS_sub_modules/PJS-tool-circle-2p.mjs
// CAD - Circle 2P Diameter: p1, p2
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

export function createCircle2PTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  let p1 = null;
  let p2Hover = null;
  let preview = null;

  let committed = false;
  let cancelled = false;

  let _hoverT = null;
  let _hoverEvt = null;

  const _cursorEl = ctx.bodyEl;
  const _prevCursor = _cursorEl?.style?.cursor || "";
  if (_cursorEl) _cursorEl.style.cursor = "crosshair";

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

  function footerUpdate() {
    if (!p1 || !p2Hover) {
      footerStatus(t("app.pjs.prompt.circle_2p.p1"));
      return;
    }

    const d = p1.getDistance(p2Hover);
    const r = d / 2;
    footerStatus(t("app.pjs.prompt.circle_2p.measure", { d: d.toFixed(1), r: r.toFixed(1) }));
  }

  function footerClear() {
    cmdUI.hide({ clear: true });
  }

  function updatePreview() {
    if (!p1 || !p2Hover) return;

    const d = p1.getDistance(p2Hover);
    if (d < 1) return;

    const center = p1.add(p2Hover).divide(2);
    const r = d / 2;

    try { preview?.remove(); } catch {}
    const { layerId, style } = getActiveLayerStyleAndId();

    preview = new state.scope.Path.Circle({ center, radius: r });
    preview.data = { kind: "circle", layerId, __preview: true, snapCenter: true, mode: "2p" };
    applyStyle(preview, style);

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

    p1 = null;
    p2Hover = null;
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
    if (!p1 || !p2Hover) return;

    const d = p1.getDistance(p2Hover);
    if (d < 1) return;

    const center = p1.add(p2Hover).divide(2);
    const r = d / 2;

    try { preview?.remove(); } catch {}
    preview = null;

    const { layerId, style } = getActiveLayerStyleAndId();
    const final = new state.scope.Path.Circle({ center, radius: r });
    final.data = {
      kind: "circle",
      layerId,
      snapCenter: true,
      mode: "2p",
      diameterP1: [p1.x, p1.y],
      diameterP2: [p2Hover.x, p2Hover.y],
      center: [center.x, center.y],
      radius: r
    };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Cerchio 2P", snapshot: exportProjectJSON(state) }); } catch {}

    snapClearMarker(ctx.bodyEl);
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    resetStateOnly();

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeCommand() {
    // RMB con tool attivo = chiude il comando.
    // Per circle 2P, se il preview esiste si fa commit.
    if (!p1 || !p2Hover) {
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

    if (!p1) {
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
      p2Hover = p.clone();

      footerStatus(t("app.pjs.prompt.circle_2p.p2"), {
        ensureVisible: true
      });
      state.scope.view.update();
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

    p2Hover = p;
    snapAddConstructionPoint(ctx.bodyEl, p2Hover);
    commit();
  };

  paperTool.onMouseMove = (event) => {
    if (!p1) {
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

    p2Hover = p;
    updatePreview();
    footerUpdate();
  };

  // Re-apply after manager footer init so tool state is visible immediately
  setTimeout(() => {
    footerStatus(t("app.pjs.prompt.circle_2p.p1"), {
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

    if (!committed && cancelled) {
      try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}
    }

    if (_cursorEl) _cursorEl.style.cursor = _prevCursor || "";
    footerClear();
  };
}