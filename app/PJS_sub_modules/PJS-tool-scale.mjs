// APP/PJS_sub_modules/PJS-tool-scale.mjs

import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import { setDirty } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";
import {
  ensureSelectionState
} from "./PJS-selection-core.mjs";
import { refreshSelectionUI } from "./PJS-selection-ui.mjs";
import {
  ensureCommandPointSystem,
  resolveCommandPoint,
  clearCommandPointUi
} from "./PJS-command-point.mjs";
import {
  snapAddConstructionPoint,
  snapClearConstructionPoints
} from "./PJS-snap.mjs";

export function createScaleTool(paperTool, ctx) {
  const { state, cmdUI } = ctx;

  ensureSelectionState(state);
  ensureCommandPointSystem(ctx.bodyEl);

  const pivot0 = getSelectionCenter(state);

  state._scaleCmd = {
    pivotPoint: pivot0,
    fromPoint: null,
    toPoint: null,

    uniform: false,
    sx: 1,
    sy: 1,

    stepMode: "from", // "pivot" | "from" | "to"

    previewItems: [],
    ui: {
      pivotMarker: null,
      fromLine: null,
      toLine: null
    },
    refreshUi: null
  };

  function fmt(n) {
    return Number.isFinite(n) ? n.toFixed(3) : "1.000";
  }

  function clearPreview() {
    const c = state._scaleCmd;
    for (const it of c.previewItems || []) {
      try { it.remove(); } catch {}
    }
    c.previewItems = [];
  }

  function clearScaleUi() {
    const ui = state._scaleCmd?.ui;
    try { ui?.pivotMarker?.remove?.(); } catch {}
    try { ui?.fromLine?.remove?.(); } catch {}
    try { ui?.toLine?.remove?.(); } catch {}

    if (ui) {
      ui.pivotMarker = null;
      ui.fromLine = null;
      ui.toLine = null;
    }
  }

  function getUniformLock(event = null) {
    const c = state._scaleCmd;
    return !!c.uniform || !!event?.modifiers?.shift || !!ctx.tools?._shiftDown;
  }

  function computeScaleFactors(event = null) {
    const c = state._scaleCmd;
    if (!c.pivotPoint || !c.fromPoint || !c.toPoint) {
      return { sx: 1, sy: 1 };
    }

    const px = c.pivotPoint.x;
    const py = c.pivotPoint.y;

    const dx0 = c.fromPoint.x - px;
    const dy0 = c.fromPoint.y - py;
    const dx1 = c.toPoint.x - px;
    const dy1 = c.toPoint.y - py;

    const uniform = getUniformLock(event);

    if (uniform) {
      const r0 = Math.hypot(dx0, dy0);
      const r1 = Math.hypot(dx1, dy1);
      const s = (r0 > 1e-9) ? (r1 / r0) : 1;
      return { sx: s, sy: s };
    }

    const sx = Math.abs(dx0) > 1e-9 ? (dx1 / dx0) : 1;
    const sy = Math.abs(dy0) > 1e-9 ? (dy1 / dy0) : 1;
    return { sx, sy };
  }

  function updateFactors(event = null) {
    const c = state._scaleCmd;
    const f = computeScaleFactors(event);
    c.sx = f.sx;
    c.sy = f.sy;
    return f;
  }

  function buildControls() {
    const c = state._scaleCmd;
    const wrap = document.createElement("div");
    wrap.className = "d-flex align-items-center gap-2 flex-wrap";

    const chkWrap = document.createElement("label");
    chkWrap.className = "form-check-label small d-flex align-items-center gap-1";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "form-check-input mt-0";
    chk.checked = !!c.uniform;
    chk.addEventListener("change", () => {
      c.uniform = !!chk.checked;
      updateFactors();
      updateCmdUI();
      refreshScaleUi();
    });

    chkWrap.append(chk, document.createTextNode(t("app.pjs.ctrl.uniform")));

    const sxSpan = document.createElement("span");
    sxSpan.className = "small";
    sxSpan.textContent = `SX: ${fmt(c.sx)}`;

    const sySpan = document.createElement("span");
    sySpan.className = "small";
    sySpan.textContent = `SY: ${fmt(c.sy)}`;

    const btnPivot = document.createElement("button");
    btnPivot.type = "button";
    btnPivot.className = "btn btn-sm btn-outline-secondary";
    btnPivot.textContent = t("app.pjs.ctrl.set_pivot");
    btnPivot.addEventListener("click", () => {
      c.stepMode = "pivot";
      updateCmdUI();
    });

    const btnReset = document.createElement("button");
    btnReset.type = "button";
    btnReset.className = "btn btn-sm btn-outline-secondary";
    btnReset.textContent = t("app.pjs.ctrl.reset_pivot");
    btnReset.addEventListener("click", () => {
      c.pivotPoint = getSelectionCenter(state);
      c.stepMode = "from";
      c.fromPoint = null;
      c.toPoint = null;
      c.sx = 1;
      c.sy = 1;
      clearPreview();
      refreshScaleUi();
    });

    wrap.append(chkWrap, sxSpan, sySpan, btnPivot, btnReset);
    return wrap;
  }

  function updateCmdUI() {
    const c = state._scaleCmd;

    if (!state.selectionCount) {
      cmdUI?.update?.({
        status: t("app.pjs.prompt.scale.no_selection"),
        hints: t("app.pjs.hint.select_first"),
        controls: null
      });
      return;
    }

    if (c.stepMode === "pivot") {
      cmdUI?.update?.({
        status: t("app.pjs.prompt.scale.pivot"),
        hints: t("app.pjs.hint.pivot"),
        controls: buildControls()
      });
      return;
    }

    if (!c.fromPoint) {
      cmdUI?.update?.({
        status: t("app.pjs.status.scale_start"),
        hints: t("app.pjs.hint.scale_initial"),
        controls: buildControls()
      });
      return;
    }

    cmdUI?.update?.({
      status: t("app.pjs.prompt.scale.final"),
      hints: t("app.pjs.hint.scale_final"),
      controls: buildControls()
    });
  }

  function drawPivotMarker() {
    const c = state._scaleCmd;
    try { c.ui.pivotMarker?.remove?.(); } catch {}
    c.ui.pivotMarker = null;

    if (!c.pivotPoint || !state._uiLayer) return;

    const p = state.scope.view.projectToView(c.pivotPoint);

    const marker = new state.scope.Path.Circle({
      center: p,
      radius: 6,
      insert: false
    });

    state._uiLayer.addChild(marker);
    marker.strokeColor = "#00ffff";
    marker.strokeWidth = 2;
    marker.fillColor = null;
    marker.data = {
      kind: "__ui_scale_pivot__",
      __uiRuntime: true
    };

    c.ui.pivotMarker = marker;
  }

  function drawGuideLines() {
    const c = state._scaleCmd;

    try { c.ui.fromLine?.remove?.(); } catch {}
    try { c.ui.toLine?.remove?.(); } catch {}
    c.ui.fromLine = null;
    c.ui.toLine = null;

    if (!c.pivotPoint || !state._uiLayer) return;

    const pV = state.scope.view.projectToView(c.pivotPoint);

    if (c.fromPoint) {
      const fV = state.scope.view.projectToView(c.fromPoint);
      const line = new state.scope.Path.Line({
        from: pV,
        to: fV,
        insert: false
      });
      state._uiLayer.addChild(line);
      line.strokeColor = "#00ffff";
      line.strokeWidth = 2;
      line.dashArray = [6, 4];
      line.data = { kind: "__ui_scale_from__", __uiRuntime: true };
      c.ui.fromLine = line;
    }

    if (c.fromPoint && c.toPoint) {
      const tV = state.scope.view.projectToView(c.toPoint);
      const line = new state.scope.Path.Line({
        from: pV,
        to: tV,
        insert: false
      });
      state._uiLayer.addChild(line);
      line.strokeColor = "#00ffff";
      line.strokeWidth = 2;
      line.dashArray = [3, 3];
      line.data = { kind: "__ui_scale_to__", __uiRuntime: true };
      c.ui.toLine = line;
    }
  }

  function applyNonUniformScale(item, sx, sy, pivot) {
    // Scala anisotropa rispetto al pivot in image/project space.
    // Usiamo una matrix esplicita per evitare dipendenze da overload non uniformi.
    const scope = state.scope;
    const m = new scope.Matrix();

    m.translate(pivot.x, pivot.y);
    m.scale(sx, sy);
    m.translate(-pivot.x, -pivot.y);

    item.transform(m);
  }

  function buildPreview(event = null) {
    const c = state._scaleCmd;
    clearPreview();

    if (!c.pivotPoint || !c.fromPoint || !c.toPoint) return;

    const { sx, sy } = updateFactors(event);
    const srcItems = Array.from(state.selection || []).filter(Boolean);

    for (const src of srcItems) {
      try {
        const clone = src.clone();
        applyNonUniformScale(clone, sx, sy, c.pivotPoint);
        clone.opacity = 0.45;
        clone.data = {
          ...(clone.data || {}),
          __preview: true
        };
        c.previewItems.push(clone);
      } catch {}
    }
  }

  function refreshScaleUi(event = null) {
    buildPreview(event);
    drawPivotMarker();
    drawGuideLines();
    updateCmdUI();
    state.scope.view.update?.();
  }

  function finishCommand() {
    try { clearCommandPointUi(ctx); } catch {}
    try { snapClearConstructionPoints(ctx.bodyEl); } catch {}

    clearPreview();
    clearScaleUi();

    const c = state._scaleCmd;
    c.fromPoint = null;
    c.toPoint = null;
    c.sx = 1;
    c.sy = 1;
    c.stepMode = "from";

    updateCmdUI();
    state.scope.view.update?.();
  }

  function commitScale(event = null) {
    const c = state._scaleCmd;
    if (!c.pivotPoint || !c.fromPoint || !c.toPoint) return false;

    const { sx, sy } = updateFactors(event);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return false;

    const project = state.scope.project;
    const history = state.history || null;

    if (history) {
      try {
        pushSnapshot(history, {
          label: "Trasforma: Scala",
          snapshot: exportProjectJSON(state)
        });
      } catch (err) {
        console.warn("[SCALE] history snapshot failed:", err);
      }
    }

    const srcItems = Array.from(state.selection || []).filter(Boolean);
    for (const it of srcItems) {
      try {
        applyNonUniformScale(it, sx, sy, c.pivotPoint);
      } catch {}
    }

    try { setDirty(state, true); } catch {}
    clearPreview();
    refreshSelectionUI(state);

    cmdUI?.update?.({
      status: t("app.pjs.prompt.scale.done"),
      hints: "",
      controls: null
    });

    state.scope.view.update?.();
    ctx.onSelectionChanged?.({
      count: state.selectionCount,
      hasSelection: state.hasSelection,
      items: Array.from(state.selection || [])
    });

    return true;
  }

  state._scaleCmd.refreshUi = () => {
    drawPivotMarker();
    drawGuideLines();
    updateCmdUI();
    state.scope.view.update?.();
  };

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan?.()) return;
    if (event?.event?.button === 2) return;
    if (!state.selectionCount) {
      updateCmdUI();
      return;
    }

    const c = state._scaleCmd;

    const picked = resolveCommandPoint(ctx, {
      rawPoint: event.point,
      basePoint: c.pivotPoint,
      event,
      allowSnap: true,
      allowOrtho: false,
      allowGrid: true
    });

    if (c.stepMode === "pivot") {
      c.pivotPoint = picked.point.clone();
      c.fromPoint = null;
      c.toPoint = null;
      c.sx = 1;
      c.sy = 1;
      c.stepMode = "from";
      try { snapAddConstructionPoint(ctx.bodyEl, c.pivotPoint.clone()); } catch {}
      refreshScaleUi(event);
      return;
    }

    if (!c.fromPoint) {
      c.fromPoint = picked.point.clone();
      c.toPoint = null;
      try { snapAddConstructionPoint(ctx.bodyEl, c.fromPoint.clone()); } catch {}
      refreshScaleUi(event);
      return;
    }

    c.toPoint = picked.point.clone();
    try { snapAddConstructionPoint(ctx.bodyEl, c.toPoint.clone()); } catch {}
    commitScale(event);
    finishCommand();
  };

  paperTool.onMouseMove = (event) => {
    if (ctx.isTempPan?.()) return;

    const c = state._scaleCmd;
    if (!state.selectionCount) return;

    if (c.stepMode === "pivot") {
      resolveCommandPoint(ctx, {
        rawPoint: event.point,
        basePoint: null,
        event,
        allowSnap: true,
        allowOrtho: false,
        allowGrid: true
      });
      return;
    }

    if (!c.fromPoint) {
      resolveCommandPoint(ctx, {
        rawPoint: event.point,
        basePoint: null,
        event,
        allowSnap: true,
        allowOrtho: false,
        allowGrid: true
      });
      return;
    }

    const picked = resolveCommandPoint(ctx, {
      rawPoint: event.point,
      basePoint: c.pivotPoint,
      event,
      allowSnap: true,
      allowOrtho: false,
      allowGrid: true
    });

    c.toPoint = picked.point.clone();
    refreshScaleUi(event);
  };

  paperTool.onMouseDrag = (event) => {
    if (ctx.isTempPan?.()) return;

    const c = state._scaleCmd;
    if (!state.selectionCount) return;
    if (!c.fromPoint) return;

    const picked = resolveCommandPoint(ctx, {
      rawPoint: event.point,
      basePoint: c.pivotPoint,
      event,
      allowSnap: true,
      allowOrtho: false,
      allowGrid: true
    });

    c.toPoint = picked.point.clone();
    refreshScaleUi(event);
  };

  paperTool.onKeyDown = (event) => {
    if (event.key !== "escape") return;
    finishCommand();
  };

  updateCmdUI();

  return () => {
    try { clearPreview(); } catch {}
    try { clearScaleUi(); } catch {}
    try { clearCommandPointUi(ctx); } catch {}
    try { snapClearConstructionPoints(ctx.bodyEl); } catch {}
    try { if (state._scaleCmd) state._scaleCmd.refreshUi = null; } catch {}
    try { state._scaleCmd = null; } catch {}
    try { state.scope.view.update?.(); } catch {}
  };
}

function getSelectionCenter(state) {
  const items = Array.from(state.selection || []).filter(Boolean);
  let b = null;

  for (const it of items) {
    const bb = it?.bounds;
    if (!bb) continue;
    b = b ? b.unite(bb) : bb.clone();
  }

  return b ? b.center.clone() : new state.scope.Point(0, 0);
}