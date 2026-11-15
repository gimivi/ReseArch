// APP/PJS_sub_modules/PJS-tool-select.mjs
import { t } from "../shared/i18n.mjs";

import {
  ensureSelectionState,
  clearSelection,
  applySelectionMode,
  beginSelectionSession,
  endSelectionSession,
  syncSelectionMeta
} from "./PJS-selection-core.mjs";

import {
  pickSelectableItem,
  collectBoxSelectableItems
} from "./PJS-selection-query.mjs";

import {
  refreshSelectionUI,
  clearSelectionUI,
  drawSelectionDragRect,
  clearSelectionDragRect
} from "./PJS-selection-ui.mjs";

/**
 * Select tool
 *
 * Comportamento:
 * - click: seleziona item sotto cursore
 * - Shift+click: aggiunge
 * - Ctrl+click: rimuove
 * - drag L->R: window/contained
 * - drag R->L: crossing/intersect
 * - RMB: no-op qui (gestito centralmente dal CAD manager)
 *
 * Note architetturali:
 * - geometrie in image/project space
 * - UI selection su layer __ui__ in view/screen space
 * - nessuna matrix applicata ai layer
 */

export function createSelectTool(paperTool, ctx) {
  const { state, cmdUI } = ctx;

  ensureSelectionState(state);

  function viewPoint(projectPoint) {
    return state.scope.view.projectToView(projectPoint);
  }

  function readMods(event) {
    return {
      shift: !!event?.modifiers?.shift,
      ctrl: !!event?.modifiers?.control
    };
  }

  function updateCmdUI() {
    syncSelectionMeta(state);

    cmdUI?.update?.({
      status: state.selectionCount
        ? t("app.pjs.prompt.select.count", { n: state.selectionCount })
        : t("app.pjs.prompt.select.none"),
      hints: t("app.pjs.hint.select_tool")
    });

    ctx.onSelectionChanged?.({
      count: state.selectionCount,
      hasSelection: state.hasSelection,
      items: Array.from(state.selection || [])
    });
  }

  function refreshAll() {
    refreshSelectionUI(state);
    updateCmdUI();
    state.scope.view.update?.();
  }

  function commitSelection(items, mods) {
    applySelectionMode(state, items, mods);
    refreshAll();
  }

  function clearSelectionOnly() {
    clearSelection(state);
    clearSelectionUI(state);
    updateCmdUI();
    state.scope.view.update?.();
  }

  function beginEmptyDragSelection(event) {
    const startView = viewPoint(event.point);

    beginSelectionSession(state, {
      dragStartView: startView,
      dragHadHit: false
    });

    drawSelectionDragRect(state, startView, startView);
  }

  function beginHitSession(event) {
    beginSelectionSession(state, {
      dragStartView: viewPoint(event.point),
      dragHadHit: true
    });
  }

  function endSessionAndCleanup() {
    clearSelectionDragRect(state);
    endSelectionSession(state);
    state.scope.view.update?.();
  }

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan?.()) return;

    // RMB: no-op qui; gestito dal manager CAD centrale
    if (event?.event?.button === 2) return;

    state.scope.activate?.();

    const mods = readMods(event);
    const item = pickSelectableItem(state, event.point);


    //Debug
    console.log("[SELECT][mouseDown] hit item =", item, "kind=", item?.data?.kind, "layerId=", item?.data?.layerId);
    //

    if (item) {
      beginHitSession(event);
      commitSelection([item], mods);

      //Debug
      console.log("[SELECT][after commit] selectionCount=", state.selectionCount, "selection=", Array.from(state.selection || []).map(it => ({ kind: it?.data?.kind, layerId: it?.data?.layerId })));
      //
      return;
    }

    beginEmptyDragSelection(event);
  };

  paperTool.onMouseDrag = (event) => {
    const session = state._selectionSession;
    if (!session?.dragActive) return;
    if (session.dragHadHit) return;

    const curView = viewPoint(event.point);
    drawSelectionDragRect(state, session.dragStartView, curView);
  };

  paperTool.onMouseUp = (event) => {
    const session = state._selectionSession;
    if (!session?.dragActive) return;

    // Se il mouseDown era già su item, non c'è box-select da completare
    if (session.dragHadHit) {
      endSessionAndCleanup();
      return;
    }

    const mods = readMods(event);
    const endView = viewPoint(event.point);

    const dx = Math.abs(endView.x - session.dragStartView.x);
    const dy = Math.abs(endView.y - session.dragStartView.y);
    const isClickish = dx < 3 && dy < 3;

    if (isClickish) {
      // click vuoto: comportamento attuale
      if (!mods.shift && !mods.ctrl) {
        clearSelectionOnly();
      } else {
        updateCmdUI();
        state.scope.view.update?.();
      }

      endSessionAndCleanup();
      return;
    }

    const { picked } = collectBoxSelectableItems(
      state,
      session.dragStartView,
      endView
    );

    commitSelection(picked, mods);
    endSessionAndCleanup();
  };

  paperTool.onKeyDown = (event) => {
    if (event.key !== "escape") return;

    // Select tool: ESC svuota selezione, non gestisce exit tool
    clearSelectionOnly();
    endSelectionSession(state);
  };

  // sync iniziale
  updateCmdUI();
  refreshSelectionUI(state);
  state.scope.view.update?.();

  // teardown
  return () => {
    try {
      clearSelectionDragRect(state);
    } catch {}

    try {
      endSelectionSession(state);
    } catch {}

    // NON cancellare la selezione:
    // deve restare disponibile per Move / Copy / Delete
    // e deve restare anche visibile tramite bbox/UI selection.

    try {
      updateCmdUI();
    } catch {}
  };
}