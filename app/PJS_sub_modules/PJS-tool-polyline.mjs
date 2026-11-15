// APP/PJS_sub_modules/PJS-tool-polyline.mjs (CAD v3 - RMB close / ESC cancel)
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

export function createPolylineTool(paperTool, ctx) {
  ensureSnapSystem(ctx.bodyEl);
  const { state, cmdUI } = ctx;

  // Cursor management
  const _cursorEl = ctx.bodyEl;
  const _prevCursor = _cursorEl?.style?.cursor ?? "";
  if (_cursorEl) _cursorEl.style.cursor = "crosshair";

  let path = null;
  let isDrawing = false;
  let firstPt = null;
  let autoClose = true;
  let committed = false;
  let cancelled = false;

  // Idle-hover snap preview
  let _hoverT = null;
  let _hoverEvt = null;

  function scheduleSnapHover(event, exclude = []) {
    _hoverEvt = event;
    if (_hoverT) clearTimeout(_hoverT);
    _hoverT = setTimeout(() => {
      _hoverT = null;
      const ev = _hoverEvt;
      if (!ev) return;
      if (ctx.isAltDown?.()) {
        snapClearMarker(ctx.bodyEl);
        return;
      }
      let p = ev.point.clone();
      const s = pickSnap(p, exclude);
      if (s) snapUpdateMarker(ctx.bodyEl, s, ev.point);
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

  function pxDist(aImg, bImg) {
    const a = state.scope.view.projectToView(aImg);
    const b = state.scope.view.projectToView(bImg);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function pickSnap(imgPoint, exclude = []) {
    if (ctx.isAltDown?.()) return null;
    return snapPick(ctx.bodyEl, imgPoint, { excludeItems: exclude });
  }

  function buildControls() {
    const wrap = document.createElement("div");
    wrap.className = "pjs-ctrls";

    const btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.textContent = t("app.pjs.ctrl.close_c");
    btnClose.className = "btn btn-sm";
    btnClose.onclick = () => closeAndFinish();

    const btnUndo = document.createElement("button");
    btnUndo.type = "button";
    btnUndo.textContent = t("app.pjs.ctrl.undo_last");
    btnUndo.className = "btn btn-sm";
    btnUndo.onclick = () => popVertex();

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = autoClose;
    chk.onchange = () => {
      autoClose = chk.checked;
      footerStatus(undefined, { controls: buildControls() });
    };

    const lbl = document.createElement("label");
    lbl.style.marginLeft = "10px";
    lbl.appendChild(chk);
    lbl.appendChild(document.createTextNode(" " + t("app.pjs.ctrl.auto_close")));

    wrap.appendChild(btnClose);
    wrap.appendChild(btnUndo);
    wrap.appendChild(lbl);

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

  function footerUpdateStatus(extra = "") {
    const n = path ? Math.max(0, path.segments.length - 1) : 0; // exclude rubber
    const base = isDrawing ? t("app.pjs.prompt.polyline.vertices", { n }) : t("app.pjs.prompt.polyline.first");
    footerStatus(extra ? `${base} • ${extra}` : base);
  }

  function footerClear() {
    cmdUI.hide({ clear: true });
  }

  function cancelCommand() {
    cancelled = true;
    snapClearMarker(ctx.bodyEl);
    try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}
    try { path?.remove(); } catch {}
    path = null;
    isDrawing = false;
    firstPt = null;
    footerClear();
    state.scope.view.update();
  }

  function popVertex() {
    if (!path) return;
    // keep at least: first vertex + rubber
    if (path.segments.length <= 2) return;

    path.removeSegment(path.segments.length - 2);
    try { snapRemoveLastConstructionPoint(ctx.bodyEl); } catch {}

    footerUpdateStatus();
    state.scope.view.update();
  }

  function finish(closed = false) {
    if (!path) {
      cancelCommand();
      return;
    }

    // remove rubber
    if (path.segments.length >= 2) {
      try { path.removeSegment(path.segments.length - 1); } catch {}
    }

    if (closed && path.segments.length >= 3) path.closed = true;

    if (path.segments.length < 2) {
      cancelCommand();
      return;
    }

    committed = true;
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Polilinea", snapshot: exportProjectJSON(state) }); } catch {}

    snapClearMarker(ctx.bodyEl);
    try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 1500 }); } catch {}

    path = null;
    isDrawing = false;
    firstPt = null;

    footerClear();
    state.scope.view.update();

    ctx.exitTool?.();
  }

  function closeAndFinish() {
    if (!path) return;
    const verts = path.segments.length - 1; // exclude rubber
    if (verts < 3) {
      footerUpdateStatus(t("app.pjs.prompt.polyline.min_close"));
      return;
    }
    finish(true);
  }

  // RMB con tool attivo = chiude il comando, non annulla.
  // Per polyline: chiusura "aperta", quindi rimuove il rubber,
  // fa commit della spezzata e lascia le marche con delay.
  function closeCommand() {
    if (!path || !isDrawing) {
      footerClear();
      ctx.exitTool?.();
      return;
    }
    finish(false);
  }

  function nearStart(pImg) {
    if (!firstPt) return false;
    const tolPx = Number(state._env?.workspace?.snap?.tolerancePx ?? 12);
    return pxDist(firstPt, pImg) <= tolPx;
  }

  // Register CAD hooks, if supported by the tool manager.
  ctx.setRmbClose?.(closeCommand);
  ctx.setEscCancel?.(cancelCommand);

  paperTool.onKeyDown = (event) => {
    if (event.key === "escape") {
      cancelCommand();
      return ctx.exitTool();
    }
    if (event.key === "enter") return finish(false); // allowed, but not advertised in hints
    if (event.key === "backspace") return popVertex();
    if (event.key === "c") return closeAndFinish();
  };

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan()) return;
    if (event?.event?.button === 2) return;
    if (!state._env?.layers?.length) return;

    ensureSnapSystem(ctx.bodyEl);
    state.scope.activate();
    getActiveDrawingLayer().activate();

    // double click finish
    if (event?.event?.detail >= 2 && isDrawing) return finish(false);

    let p = event.point.clone();
    const s0 = pickSnap(p, path ? [path] : []);
    if (s0) {
      p = s0.imgPoint;
      snapUpdateMarker(ctx.bodyEl, s0, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    if (!isDrawing) {
      const { layerId, style } = getActiveLayerStyleAndId();

      path = new state.scope.Path();
      path.data = { kind: "polyline", layerId };
      applyStyle(path, style);

      path.add(p);
      firstPt = p.clone();
      try { snapAddConstructionPoint(ctx.bodyEl, firstPt); } catch {}
      path.add(p.clone()); // rubber

      isDrawing = true;
      footerStatus(t("app.pjs.prompt.polyline.first"), {
        controls: buildControls(),
        ensureVisible: true
      });
      state.scope.view.update();
      return;
    }

    // close by clicking near start (if enabled)
    if (autoClose && (path.segments.length - 1) >= 3 && nearStart(p)) {
      return closeAndFinish();
    }

    // add vertex before rubber
    path.insert(path.segments.length - 1, p);
    try { snapAddConstructionPoint(ctx.bodyEl, p); } catch {}
    footerUpdateStatus();
    state.scope.view.update();
  };

  paperTool.onMouseMove = (event) => {
    // Pre-start: show snap marker before first vertex
    if (!isDrawing || !path) {
      scheduleSnapHover(event, []);
      return;
    }

    // During drawing: snap marker also updated
    scheduleSnapHover(event, [path]);

    let p = event.point.clone();
    const s1 = pickSnap(p, [path]);
    if (s1) {
      p = s1.imgPoint;
    } else {
      // allow snapping to the first vertex of the polyline-in-construction (for closure)
      const verts = path ? (path.segments.length - 1) : 0; // exclude rubber
      if (autoClose && firstPt && verts >= 3 && nearStart(p)) {
        const synth = { kind: "endpoint", imgPoint: firstPt.clone(), item: path, _d: 0 };
        try { snapUpdateMarker(ctx.bodyEl, synth, event.point); } catch {}
        p = firstPt.clone();
      }
    }

    path.segments[path.segments.length - 1].point = p;

    footerUpdateStatus(
      autoClose && firstPt && nearStart(p) && (path.segments.length - 1) >= 3
        ? t("app.pjs.prompt.polyline.click_close")
        : ""
    );

    state.scope.view.update();
  };

  footerStatus(t("app.pjs.prompt.polyline.first"), {
    controls: buildControls(),
    ensureVisible: true
  });

  return () => {
    try {
      if (_cursorEl) _cursorEl.style.cursor = _prevCursor;
    } catch {}

    if (_hoverT) clearTimeout(_hoverT);
    _hoverT = null;
    _hoverEvt = null;

    snapClearMarker(ctx.bodyEl);

    // Se il tool esce per annullamento esplicito, pulizia immediata.
    // Se esce dopo finish/close corretto, NON toccare i construction points:
    // devono sparire col delay già programmato.
    if (!committed && cancelled) {
      try { snapClearConstructionPoints(ctx.bodyEl, { delayMs: 0 }); } catch {}
    }

    footerClear();
  };
}