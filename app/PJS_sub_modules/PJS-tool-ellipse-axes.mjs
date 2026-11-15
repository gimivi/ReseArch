// APP/PJS_sub_modules/PJS-tool-ellipse-axes.mjs
// CAD - Ellipse by axes: major + minor
// Uniformato ai criteri consolidati:
// - Geometry in image space
// - Snap via PJS-snap
// - Cursor crosshair during tool
// - White construction markers on picked points
// - Backspace removes last point + last marker
// - RMB closes command
// - Esc cancels command
// - Enter allowed but not advertised
// - Checkbox "Centro" retained
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

export function createEllipseAxesTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  const _cursorEl = ctx.bodyEl;
  const _prevCursor = _cursorEl?.style?.cursor || "";
  if (_cursorEl) _cursorEl.style.cursor = "crosshair";

  let p1 = null;
  let p2 = null;
  let p3 = null;

  let phase = 0;         // 0=P1, 1=P2, 2=P3
  let optCenter = false; // checkbox "Centro"

  let preview = null;
  let rubber = null;

  let committed = false;
  let cancelled = false;

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
    const sw = Number(style.strokeWidth || 1);
    const half = Math.max(0.5, sw / 2);
    p.strokeColor = style.strokeColor || "#000000";
    p.strokeWidth = half;
    const dash = Math.max(2, half * 4);
    p.dashArray = [dash, dash];
    p.fillColor = null;
  }

  function clearPreview() {
    try { preview?.remove(); } catch {}
    preview = null;
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
    if (phase === 0) {
      footerStatus(t("app.pjs.prompt.ellipse_axes.p1"));
      return;
    }
    if (phase === 1) {
      footerStatus(
        optCenter
          ? t("app.pjs.prompt.ellipse_axes.p2_semi")
          : t("app.pjs.prompt.ellipse_axes.p2_full")
      );
      return;
    }
    if (phase === 2) {
      footerStatus(extra ? `${t("app.pjs.prompt.ellipse_axes.p3")} • ${extra}` : t("app.pjs.prompt.ellipse_axes.p3"));
    }
  }

  function footerClear() {
    cmdUI.hide({ clear: true });
  }

  function buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "pjs-ctrls";

    const chkCenter = document.createElement("input");
    chkCenter.type = "checkbox";
    chkCenter.checked = optCenter;
    chkCenter.onchange = () => {
      optCenter = chkCenter.checked;
      footerStatus(undefined, { controls: buildControls() });
      footerUpdate();
    };

    const lblCenter = document.createElement("label");
    lblCenter.style.marginLeft = "10px";
    lblCenter.appendChild(chkCenter);
    lblCenter.appendChild(document.createTextNode(" " + t("app.pjs.ctrl.from_center")));

    const btnUndo = document.createElement("button");
    btnUndo.type = "button";
    btnUndo.textContent = t("app.pjs.ctrl.undo_last");
    btnUndo.className = "btn btn-sm";
    btnUndo.onclick = () => undoPoint();

    wrap.appendChild(btnUndo);
    wrap.appendChild(lblCenter);
    return wrap;
  }

  function computeMajor(p1Local, p2Local) {
    if (!p1Local || !p2Local) return null;

    if (optCenter) {
      const center = p1Local.clone();
      const v = p2Local.subtract(p1Local);
      const a = v.length;
      if (a < 0.5) return null;
      const u = v.normalize();
      const angleDeg = u.angle;
      return { center, a, u, angleDeg };
    } else {
      const center = p1Local.add(p2Local).divide(2);
      const v = p2Local.subtract(p1Local);
      const a = v.length / 2;
      if (a < 0.5) return null;
      const u = v.normalize();
      const angleDeg = u.angle;
      return { center, a, u, angleDeg };
    }
  }

  function computeMinorSemiAxis(center, majorU, a, p3Local) {
    if (!center || !majorU || !p3Local) return null;

    const v = p3Local.subtract(center);
    const perpU = new state.scope.Point(-majorU.y, majorU.x);
    const signedB = v.dot(perpU);
    const b = Math.abs(signedB);

    if (b < 0.5) {
      return { b: 0, perpU, endpoint: center.clone(), signedB: 0 };
    }

    const endpoint = center.add(perpU.multiply(signedB));
    return { b, perpU, endpoint, signedB };
  }

  function updateEllipsePreview(p2Hover, p3Hover) {
    const major = computeMajor(p1, p2Hover || p2);
    if (!major) return;

    let b = 0;
    if (phase === 2 && p3Hover) {
      const minor = computeMinorSemiAxis(major.center, major.u, major.a, p3Hover);
      b = minor?.b || 0;
    }

    clearPreview();

    const { layerId, style } = getActiveLayerStyleAndId();
    preview = new state.scope.Path.Ellipse({
      center: major.center,
      radius: [major.a, Math.max(0.5, b)]
    });
    preview.rotate(major.angleDeg, major.center);

    preview.data = { kind: "ellipse", layerId, __preview: true, mode: "axes", snapCenter: true };
    applyStyle(preview, style);
  }

  function resetStateOnly() {
    if (_hoverT) {
      clearTimeout(_hoverT);
      _hoverT = null;
      _hoverEvt = null;
    }

    clearPreview();
    clearRubber();

    p1 = null;
    p2 = null;
    p3 = null;
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
      p3 = null;
      phase = 1;
      clearPreview();
      clearRubber();

      // rimuove la marca di P2
      try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

      footerStatus(
        optCenter
          ? t("app.pjs.prompt.ellipse_axes.p2_semi")
          : t("app.pjs.prompt.ellipse_axes.p2_full"),
        { controls: buildControls(), ensureVisible: true }
      );
      state.scope.view.update();
      return;
    }

    if (phase === 1) {
      // rimuove la marca di P1
      try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

      resetStateOnly();

      footerStatus(t("app.pjs.prompt.ellipse_axes.p1"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
    }
  }

  function commit() {
    if (phase !== 2 || !p1 || !p2 || !p3) return;

    const major = computeMajor(p1, p2);
    if (!major) {
      footerUpdate(t("app.pjs.prompt.ellipse_axes.major_short"));
      return;
    }

    const minor = computeMinorSemiAxis(major.center, major.u, major.a, p3);
    const b = minor?.b || 0;
    if (b < 0.5) {
      footerUpdate(t("app.pjs.prompt.ellipse_axes.minor_short"));
      return;
    }

    clearPreview();
    clearRubber();

    const { layerId, style } = getActiveLayerStyleAndId();

    const final = new state.scope.Path.Ellipse({
      center: major.center,
      radius: [major.a, b]
    });
    final.rotate(major.angleDeg, major.center);

    final.data = {
      kind: "ellipse",
      layerId,
      snapCenter: true,
      mode: "axes",
      optCenter: !!optCenter,
      p1: [p1.x, p1.y],
      p2: [p2.x, p2.y],
      p3: [p3.x, p3.y],
      center: [major.center.x, major.center.y],
      a: major.a,
      b,
      angleDeg: major.angleDeg
    };
    applyStyle(final, style);

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Ellisse assi", snapshot: exportProjectJSON(state) }); } catch {}
    snapClearMarker(ctx.bodyEl);
    snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 });

    resetStateOnly();

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeCommand() {
    // RMB con tool attivo = chiude il comando.
    // Per ellipse-axes:
    // - in fase 2, se P3 esiste, commit
    // - altrimenti semplice uscita
    if (phase === 2 && p1 && p2 && p3) {
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

      footerStatus(
        optCenter
          ? t("app.pjs.prompt.ellipse_axes.p2_semi")
          : t("app.pjs.prompt.ellipse_axes.p2_full"),
        { controls: buildControls(), ensureVisible: true }
      );
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

      p2 = p;
      snapAddConstructionPoint(ctx.bodyEl, p2);
      clearRubber();

      phase = 2;
      footerStatus(t("app.pjs.prompt.ellipse_axes.p3"), {
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

      p3 = p;
      snapAddConstructionPoint(ctx.bodyEl, p3);

      const major = computeMajor(p1, p2);
      if (major) {
        const minor = computeMinorSemiAxis(major.center, major.u, major.a, p3);
        if (minor?.endpoint) {
          snapAddConstructionPoint(ctx.bodyEl, minor.endpoint);
        }
      }

      commit();
    }
  };

  paperTool.onMouseMove = (event) => {
    if (phase === 0) {
      scheduleSnapHover(event, [
        ...(preview ? [preview] : []),
        ...(rubber ? [rubber] : [])
      ]);
      return;
    }
    if (!p1) return;

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
      updateRubber(p1, p);
      footerUpdate();
      state.scope.view.update();
      return;
    }

    if (phase === 2 && p2) {
      const major = computeMajor(p1, p2);
      if (!major) return;

      const minor = computeMinorSemiAxis(major.center, major.u, major.a, p);
      updateRubber(major.center, minor.endpoint);

      updateEllipsePreview(null, p);
      footerUpdate(`a=${major.a.toFixed(1)} b=${(minor.b || 0).toFixed(1)}`);
      state.scope.view.update();
    }
  };

  setTimeout(() => {
    footerStatus(t("app.pjs.prompt.ellipse_axes.p1"), {
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