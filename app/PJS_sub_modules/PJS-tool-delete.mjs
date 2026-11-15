// APP/PJS_sub_modules/PJS-tool-delete.mjs

import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import {
  ensureSelectionState,
  clearSelection,
  syncSelectionMeta
} from "./PJS-selection-core.mjs";
import { clearSelectionUI } from "./PJS-selection-ui.mjs";
import { setDirty } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";

/**
 * Delete current selection
 * - azione immediata, non è un tool persistente
 * - salva snapshot history PRIMA della modifica
 * - rimuove gli item selezionati dal project
 * - pulisce selection + selection UI
 */
export function deleteSelection(ctx, opts = {}) {
  const { state, cmdUI } = ctx || {};
  if (!state?.scope?.project) return false;

  ensureSelectionState(state);

  const items = Array.from(state.selection || []).filter(Boolean);
  if (!items.length) {
    cmdUI?.update?.({
      status: t("app.pjs.delete.no_selection")
    });
    return false;
  }

  const project = state.scope.project;
  const history = state.history || null;
  const label = opts.label || "Cancella selezione";

  // snapshot BEFORE
  if (history) {
    try {
      pushSnapshot(history, {
        label,
        snapshot: exportProjectJSON(state)
      });
    } catch (err) {
      console.warn("[DELETE] history snapshot failed:", err);
    }
  }

  let removed = 0;

  for (const it of items) {
    try {
      // evita di toccare runtime UI anche se per errore finisse in selection
      if (it?.data?.__uiRuntime) continue;
      if (it?.layer === state._uiLayer) continue;

      it.remove();
      removed++;
    } catch (err) {
      console.warn("[DELETE] item remove failed:", err, it);
    }
  }

  clearSelection(state);
  clearSelectionUI(state);
  syncSelectionMeta(state);

  try { setDirty(state, true); } catch {}

  cmdUI?.update?.({
    status: removed
      ? t("app.pjs.delete.removed", { n: removed })
      : t("app.pjs.delete.none_removed")
  });

  state.scope.view.update?.();
  ctx.onSelectionChanged?.({
    count: state.selectionCount,
    hasSelection: state.hasSelection,
    items: []
  });

  return removed > 0;
}