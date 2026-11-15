// APP/PJS_sub_modules/PJS-tool-rotate.mjs

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

export function createRotateTool(paperTool, ctx) {
  const { state, cmdUI } = ctx;

  ensureSelectionState(state);
  ensureCommandPointSystem(ctx.bodyEl);

  const pivot0 = getSelectionCenter(state);

  state._rotateCmd = {
    stepDeg: 15,
    pivotPoint: pivot0,
    fromPoint: null,
    toPoint: null,
    stepMode: "from", // "pivot" | "from" | "to"
    previewItems: [],
    ui: {
      pivotMarker: null,
      fromLine: null,
      toLine: null,
      arcGuide: null
    },
    refreshUi: null
  };

  function fmt(n) {
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
  }

  function normalizeDeg(a) {
    let x = a;
    while (x <= -180) x += 360;
    while (x > 180) x -= 360;
    return x;
  }

  function getAngleDeg(pivot, point) {
    const dx = point.x - pivot.x;
    const dy = point.y - pivot.y;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }

  function getDeltaAngleDeg() {
    const c = state._rotateCmd;
    if (!c.pivotPoint || !c.fromPoint || !c.toPoint) return 0;

    const a0 = getAngleDeg(c.pivotPoint, c.fromPoint);
    const a1 = getAngleDeg(c.pivotPoint, c.toPoint);
    let d = normalizeDeg(a1 - a0);

    if (ctx.tools?._shiftDown && c.stepDeg > 0) {
      d = Math.round(d / c.stepDeg) * c.stepDeg;
    }

    return d;
  }

  function clearPreview() {
    const c = state._rotateCmd;
    for (const it of c.previewItems || []) {
      try { it.remove(); } catch {}
    }
    c.previewItems = [];
  }

  function clearRotateUi() {
    const ui = state._rotateCmd?.ui;
    try { ui?.pivotMarker?.remove?.(); } catch {}
    try { ui?.fromLine?.remove?.(); } catch {}
    try { ui?.toLine?.remove?.(); } catch {}
    try { ui?.arcGuide?.remove?.(); } catch {}

    if (ui) {
      ui.pivotMarker = null;
      ui.fromLine = null;
      ui.toLine = null;
      ui.arcGuide = null;
    }
  }

  function buildControls() {
    const c = state._rotateCmd;
    const wrap = document.createElement("div");
    wrap.className = "d-flex align-items-center gap-2 flex-wrap";

    const stepLbl = document.createElement("label");
    stepLbl.textContent = t("app.pjs.ctrl.step");
    stepLbl.className = "small";

    const stepInp = document.createElement("input");
    stepInp.type = "number";
    stepInp.min = "0";
    stepInp.max = "99";
    stepInp.step = "1";
    stepInp.value = String(c.stepDeg ?? 15);
    stepInp.style.width = "70px";
    stepInp.setAttribute("aria-label", t("app.pjs.ctrl.step_deg"));
    stepInp.className = "form-control form-control-sm";
    stepInp.addEventListener("change", () => {
      const v = Number(stepInp.value);
      c.stepDeg = Number.isFinite(v) ? Math.max(0, Math.min(99, v)) : 15;
      updateCmdUI();
      refreshRotateUi();
    });

    const ang = document.createElement("span");
    ang.className = "small";
    ang.textContent = t("app.pjs.ctrl.angle", { a: fmt(getDeltaAngleDeg()) });

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
      clearPreview();
      refreshRotateUi();
    });

    wrap.append(stepLbl, stepInp, ang, btnPivot, btnReset);
    return wrap;
  }

  function updateCmdUI() {
    const c = state._rotateCmd;

    if (!state.selectionCount) {
      cmdUI?.update?.({
        status: t("app.pjs.prompt.rotate.no_selection"),
        hints: t("app.pjs.hint.select_first"),
        controls: null
      });
      return;
    }

    if (c.stepMode === "pivot") {
      cmdUI?.update?.({
        status: t("app.pjs.prompt.rotate.pivot"),
        hints: t("app.pjs.hint.pivot"),
        controls: buildControls()
      });
      return;
    }

    if (!c.fromPoint) {
      cmdUI?.update?.({
        status: t("app.pjs.status.rotate_start"),
        hints: t("app.pjs.hint.rotate_initial"),
        controls: buildControls()
      });
      return;
    }

    cmdUI?.update?.({
      status: t("app.pjs.prompt.rotate.final"),
      hints: t("app.pjs.hint.rotate_final"),
      controls: buildControls()
    });
  }

  function drawPivotMarker() {
    const c = state._rotateCmd;
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
      kind: "__ui_rotate_pivot__",
      __uiRuntime: true
    };

    c.ui.pivotMarker = marker;
  }

  function drawGuideLines() {
    const c = state._rotateCmd;

    try { c.ui.fromLine?.remove?.(); } catch {}
    try { c.ui.toLine?.remove?.(); } catch {}
    try { c.ui.arcGuide?.remove?.(); } catch {}
    c.ui.fromLine = null;
    c.ui.toLine = null;
    c.ui.arcGuide = null;

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
      line.data = { kind: "__ui_rotate_from__", __uiRuntime: true };
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
      line.data = { kind: "__ui_rotate_to__", __uiRuntime: true };
      c.ui.toLine = line;
    }
  }

  function buildPreview() {
    const c = state._rotateCmd;
    clearPreview();

    if (!c.pivotPoint || !c.fromPoint || !c.toPoint) return;

    const angleDeg = getDeltaAngleDeg();
    const srcItems = Array.from(state.selection || []).filter(Boolean);

    for (const src of srcItems) {
      try {
        const clone = src.clone();
        clone.rotate(angleDeg, c.pivotPoint);
        clone.opacity = 0.45;
        clone.data = {
          ...(clone.data || {}),
          __preview: true
        };
        c.previewItems.push(clone);
      } catch {}
    }
  }

  function refreshRotateUi() {
    buildPreview();
    drawPivotMarker();
    drawGuideLines();
    updateCmdUI();
    state.scope.view.update?.();
  }

  function finishCommand() {
    try { clearCommandPointUi(ctx); } catch {}
    try { snapClearConstructionPoints(ctx.bodyEl); } catch {}

    clearPreview();
    clearRotateUi();

    const c = state._rotateCmd;
    c.fromPoint = null;
    c.toPoint = null;
    c.stepMode = "from";

    updateCmdUI();
    state.scope.view.update?.();
  }

  function commitRotate() {
    const c = state._rotateCmd;
    if (!c.pivotPoint || !c.fromPoint || !c.toPoint) return false;

    const angleDeg = getDeltaAngleDeg();
    if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) < 1e-9) return false;

    const project = state.scope.project;
    const history = state.history || null;

    if (history) {
      try {
        pushSnapshot(history, {
          label: "Trasforma: Ruota",
          snapshot: exportProjectJSON(state)
        });
      } catch (err) {
        console.warn("[ROTATE] history snapshot failed:", err);
      }
    }

    const srcItems = Array.from(state.selection || []).filter(Boolean);
    for (const it of srcItems) {
      try { it.rotate(angleDeg, c.pivotPoint); } catch {}
    }

    try { setDirty(state, true); } catch {}
    clearPreview();
    refreshSelectionUI(state);

    cmdUI?.update?.({
      status: t("app.pjs.prompt.rotate.done"),
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

  state._rotateCmd.refreshUi = () => {
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

    const c = state._rotateCmd;

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
      c.stepMode = "from";
      try { snapAddConstructionPoint(ctx.bodyEl, c.pivotPoint.clone()); } catch {}
      refreshRotateUi();
      return;
    }

    if (!c.fromPoint) {
      c.fromPoint = picked.point.clone();
      c.toPoint = null;
      try { snapAddConstructionPoint(ctx.bodyEl, c.fromPoint.clone()); } catch {}
      refreshRotateUi();
      return;
    }

    c.toPoint = picked.point.clone();
    try { snapAddConstructionPoint(ctx.bodyEl, c.toPoint.clone()); } catch {}
    commitRotate();
    finishCommand();
  };

  paperTool.onMouseMove = (event) => {
    if (ctx.isTempPan?.()) return;

    const c = state._rotateCmd;
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
    refreshRotateUi();
  };

  paperTool.onMouseDrag = (event) => {
    if (ctx.isTempPan?.()) return;

    const c = state._rotateCmd;
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
    refreshRotateUi();
  };

  paperTool.onKeyDown = (event) => {
    if (event.key !== "escape") return;
    finishCommand();
  };

  updateCmdUI();

  return () => {
    try { clearPreview(); } catch {}
    try { clearRotateUi(); } catch {}
    try { clearCommandPointUi(ctx); } catch {}
    try { snapClearConstructionPoints(ctx.bodyEl); } catch {}
    try { if (state._rotateCmd) state._rotateCmd.refreshUi = null; } catch {}
    try { state._rotateCmd = null; } catch {}
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