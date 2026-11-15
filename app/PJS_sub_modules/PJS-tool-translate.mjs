// APP/PJS_sub_modules/PJS-tool-translate.mjs

import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import {
  ensureSelectionState,
  clearSelection,
  syncSelectionMeta
} from "./PJS-selection-core.mjs";
import { refreshSelectionUI } from "./PJS-selection-ui.mjs";
import { setDirty } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";
import {
  ensureSnapSystem,
  snapPick,
  snapUpdateMarker,
  snapClearMarker,
  snapAddConstructionPoint,
  snapClearConstructionPoints
} from "./PJS-snap.mjs";

import {
  ensureCommandPointSystem,
  resolveCommandPoint,
  clearCommandPointUi
} from "./PJS-command-point.mjs";



export function createMoveTool(paperTool, ctx) {
  return createTranslateTool(paperTool, ctx, { mode: "move" });
}

export function createCopyTool(paperTool, ctx) {
  return createTranslateTool(paperTool, ctx, { mode: "copy" });
}

function createTranslateTool(paperTool, ctx, { mode = "move" } = {}) {
  const { state, cmdUI } = ctx;
  ensureSelectionState(state);
  ensureCommandPointSystem(ctx.bodyEl);


  state._translateCmd = {
    mode,
    commandPhase: "execute",
    basePoint: null,
    targetPoint: null,
    previewItems: [],
    ui: {
      baseMarker: null,
      vectorLine: null
    },
    refreshUi: null
  };

function getSelectionItems() {
  return Array.from(state.selection || []).filter(Boolean);
}


  function title() {
    return mode === "copy" ? "Copy" : "Move";
  }

  function fmt(n) {
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
  }

  function clearPreview() {
    const c = state._translateCmd;
    for (const it of c.previewItems || []) {
      try { it.remove(); } catch {}
    }
    c.previewItems = [];
  }

  function clearTranslateUi() {
    const ui = state._translateCmd?.ui;
    try { ui?.baseMarker?.remove?.(); } catch {}
    try { ui?.vectorLine?.remove?.(); } catch {}
    if (ui) {
      ui.baseMarker = null;
      ui.vectorLine = null;
    }
  }

  function updateCmdUI() {

 console.log("[TRANSLATE][cmdUI.update]", {
    mode: title(),
    selectionCount: state.selectionCount,
    basePoint: !!state._translateCmd?.basePoint,
    targetPoint: !!state._translateCmd?.targetPoint
  });




    const c = state._translateCmd;

    if (!state.selectionCount) {
      cmdUI?.update?.({
        status: t(mode === "copy" ? "app.pjs.prompt.copy.no_selection" : "app.pjs.prompt.move.no_selection"),
        hints: t("app.pjs.hint.select_first"),
        controls: ""
      });
      return;
    }

    if (!c.basePoint) {
      cmdUI?.update?.({
        status: t(mode === "copy" ? "app.pjs.prompt.copy.base" : "app.pjs.prompt.move.base"),
        hints: t("app.pjs.hint.base_point"),
        controls: ""
      });
      return;
    }

    const dx = c.targetPoint ? (c.targetPoint.x - c.basePoint.x) : 0;
    const dy = c.targetPoint ? (c.targetPoint.y - c.basePoint.y) : 0;

    cmdUI?.update?.({
      status: t(mode === "copy" ? "app.pjs.prompt.copy.target" : "app.pjs.prompt.move.target"),
      hints: t("app.pjs.hint.target_point"),
      controls: `ΔX=${fmt(dx)} • ΔY=${fmt(dy)}`
    });
  }

  function drawBaseMarker() {
    const c = state._translateCmd;
    try { c.ui.baseMarker?.remove?.(); } catch {}
    c.ui.baseMarker = null;

    if (!c.basePoint || !state._uiLayer) return;

    const p = state.scope.view.projectToView(c.basePoint);

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
      kind: "__ui_translate_base__",
      __uiRuntime: true
    };

    c.ui.baseMarker = marker;
  }

  function drawVectorLine() {
    const c = state._translateCmd;
    try { c.ui.vectorLine?.remove?.(); } catch {}
    c.ui.vectorLine = null;

    if (!c.basePoint || !c.targetPoint || !state._uiLayer) return;

    const a = state.scope.view.projectToView(c.basePoint);
    const b = state.scope.view.projectToView(c.targetPoint);

    const line = new state.scope.Path.Line({
      from: a,
      to: b,
      insert: false
    });

    state._uiLayer.addChild(line);
    line.strokeColor = "#00ffff";
    line.strokeWidth = 2;
    line.dashArray = [6, 4];
    line.data = {
      kind: "__ui_translate_vector__",
      __uiRuntime: true
    };

    c.ui.vectorLine = line;
  }

  function buildPreview(targetPoint) {
    const c = state._translateCmd;
    clearPreview();

    if (!c.basePoint || !targetPoint) return;

    const dx = targetPoint.x - c.basePoint.x;
    const dy = targetPoint.y - c.basePoint.y;

    const srcItems = Array.from(state.selection || []).filter(Boolean);

    for (const src of srcItems) {
      try {
        const clone = src.clone();
        clone.translate(new state.scope.Point(dx, dy));
        clone.opacity = 0.45;
        clone.data = {
          ...(clone.data || {}),
          __preview: true
        };
        c.previewItems.push(clone);
      } catch {}
    }
  }

  function refreshTranslateUi() {
    const c = state._translateCmd;
    buildPreview(c.targetPoint);
    drawBaseMarker();
    drawVectorLine();
    updateCmdUI();
    state.scope.view.update?.();
  }

  function finishCommand({ keepBase = false } = {}) {

    try { clearCommandPointUi(ctx); } catch {}
    try { snapClearConstructionPoints(ctx.bodyEl); } catch {}

    clearPreview();
    clearTranslateUi();

    const c = state._translateCmd;
    c.targetPoint = null;
    if (!keepBase) c.basePoint = null;

    updateCmdUI();
    state.scope.view.update?.();
  }

  function commitTransform(targetPoint) {
    const c = state._translateCmd;
    if (!c.basePoint || !targetPoint) return false;

    const dx = targetPoint.x - c.basePoint.x;
    const dy = targetPoint.y - c.basePoint.y;
    const delta = new state.scope.Point(dx, dy);

    const project = state.scope.project;
    const history = state.history || null;

    if (history) {
      try {
        pushSnapshot(history, {
          label: c.mode === "copy" ? "Trasforma: Copia" : "Trasforma: Sposta",
          snapshot: exportProjectJSON(state)
        });
      } catch (err) {
        console.warn("[TRANSLATE] history snapshot failed:", err);
      }
    }

    const srcItems = Array.from(state.selection || []).filter(Boolean);

    if (c.mode === "move") {
      for (const it of srcItems) {
        try { it.translate(delta); } catch {}
      }
    } else {
      const newItems = [];
      for (const it of srcItems) {
        try {
          const clone = it.clone();
          clone.translate(delta);
          newItems.push(clone);
        } catch {}
      }

      clearSelection(state);
      for (const it of newItems) {
        state.selection.add(it);
      }
      syncSelectionMeta(state);
    }

    try { setDirty(state, true); } catch {}

    clearPreview();
    refreshSelectionUI(state);

    cmdUI?.update?.({
      status: c.mode === "copy" ? t("app.pjs.prompt.copy.done") : t("app.pjs.prompt.move.done"),
      hints: "",
      controls: ""
    });

    state.scope.view.update?.();
    ctx.onSelectionChanged?.({
      count: state.selectionCount,
      hasSelection: state.hasSelection,
      items: Array.from(state.selection || [])
    });

    return true;
  }

  // callback per overlay.sync()
  state._translateCmd.refreshUi = () => {
    drawBaseMarker();
    drawVectorLine();
    // preview clones sono in project/image space: non serve ricrearli su zoom/pan
    // basta riallineare gli elementi UI screen-space.
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

  const c = state._translateCmd;

  const picked = resolveCommandPoint(ctx, {
    rawPoint: event.point,
    basePoint: c.basePoint,
    event,
    allowSnap: true,
    allowOrtho: !!c.basePoint,
    allowGrid: true
  });

  if (!c.basePoint) {
    c.basePoint = picked.point.clone();
    c.targetPoint = null;

    try { snapAddConstructionPoint(ctx.bodyEl, c.basePoint.clone()); } catch {}

    refreshTranslateUi();
    return;
  }

  c.targetPoint = picked.point.clone();
  try { snapAddConstructionPoint(ctx.bodyEl, c.targetPoint.clone()); } catch {}

  commitTransform(c.targetPoint);
  finishCommand();
};



  // preview continua anche con solo movimento mouse
    paperTool.onMouseMove = (event) => {
    if (ctx.isTempPan?.()) return;

    const c = state._translateCmd;
    if (!state.selectionCount) return;

    // pre-P1: mostra solo marker snap del resolver condiviso
    if (!c.basePoint) {
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
        basePoint: c.basePoint,
        event,
        allowSnap: true,
        allowOrtho: true,
        allowGrid: true
    });

    c.targetPoint = picked.point.clone();
    refreshTranslateUi();
    };

    paperTool.onMouseDrag = (event) => {
    if (ctx.isTempPan?.()) return;

    const c = state._translateCmd;
    if (!state.selectionCount) return;
    if (!c.basePoint) return;

    const picked = resolveCommandPoint(ctx, {
        rawPoint: event.point,
        basePoint: c.basePoint,
        event,
        allowSnap: true,
        allowOrtho: true,
        allowGrid: true
    });

    c.targetPoint = picked.point.clone();
    refreshTranslateUi();
    };



  paperTool.onKeyDown = (event) => {
    if (event.key !== "escape") return;
    finishCommand();
  };

  updateCmdUI();

return () => {
  try { clearPreview(); } catch {}
  try { clearTranslateUi(); } catch {}
  try { clearCommandPointUi(ctx); } catch {}
  try { snapClearConstructionPoints(ctx.bodyEl); } catch {}
  try { if (state._translateCmd) state._translateCmd.refreshUi = null; } catch {}
  try { state._translateCmd = null; } catch {}
  try { state.scope.view.update?.(); } catch {}
};
}