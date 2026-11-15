// app/PJS_sub_modules/PJS-tool-image.mjs
// Tool PJS: inserimento immagine raster dal file picker WP.
// Click → file picker (subfolder WP) → dialog (larghezza, ID interattivo) → Raster nel layer attivo.
// PNG con canale alpha supportato nativamente da Paper.js Raster.

import { setDirty } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";
import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import { showInputDialog } from "./PJS-ui-inputDialog.mjs";
import { showFilePicker } from "./PJS-ui-filePicker.mjs";

export function createImageTool(paperTool, ctx) {
  const { state, cmdUI } = ctx;
  const body = ctx.bodyEl;
  const prevCursor = body?.style?.cursor || "";
  if (body?.style) body.style.cursor = "crosshair";

  function getActiveLayerId() {
    return state._env?.workspace?.defaults?.activeLayerId ?? "L1";
  }

  function getActiveDrawingLayer() {
    const ui       = state._uiLayer;
    const activeId = getActiveLayerId();
    for (const L of state.scope.project.layers) {
      if (L === ui) continue;
      if (L.data?.layerId === activeId) return L;
    }
    const L = new state.scope.Layer();
    L.name = activeId;
    L.data = { layerId: activeId };
    return L;
  }

  ctx.setRmbClose?.(() => ctx.exitTool());
  ctx.setEscCancel?.(() => ctx.exitTool());
  paperTool.onKeyDown = (e) => { if (e.key === "escape") ctx.exitTool(); };

  paperTool.onMouseDown = async (event) => {
    if (ctx.isTempPan()) return;
    if (event?.event?.button === 2) return;
    if (!state._env?.layers?.length) return;

    const pos = event.point.clone();

    // Step 1: scelta file dalla subfolder WP
    const file = await showFilePicker();
    if (!file) { ctx.exitTool(); return; }

    // Step 2: configurazione (larghezza + ID interattivo)
    const result = await showInputDialog({
      title: t("app.pjs.image.dialog_title"),
      fields: [
        {
          id: "width", label: t("app.pjs.image.width"), type: "number",
          value: 500, min: 1,
        },
        {
          id: "interactiveId", label: t("app.pjs.ctrl.interactive_id"), type: "text",
          placeholder: t("app.pjs.image.id_placeholder"),
          value: '',
        },
      ],
    });
    if (!result) { ctx.exitTool(); return; }

    state.scope.activate();
    getActiveDrawingLayer().activate();

    const targetW  = Math.max(1, Number(result.width) || 500);
    const layerId  = getActiveLayerId();
    const interId  = result.interactiveId?.trim() || '';

    const raster = new state.scope.Raster({ source: file.url, position: pos });
    raster.data = {
      kind:          "image",
      url:           file.url,
      relPath:       file.relPath,
      filename:      file.filename,
      layerId,
      interactiveId: interId,
    };

    raster.on("load", () => {
      if (!state.scope) return;
      state.scope.activate();
      if (raster.width > 0) raster.scale(targetW / raster.width);
      raster.position = pos;
      setDirty(ctx.bodyEl, true);
      if (state.history) {
        try { pushSnapshot(state.history, { label: "Immagine", snapshot: exportProjectJSON(state) }); } catch {}
      }
      state.scope.view.update();
      cmdUI?.update?.({ status: t("app.pjs.image.inserted", { name: file.filename }) });
    });

    raster.on("error", () => {
      cmdUI?.update?.({ hints: t("app.pjs.image.load_error", { name: file.filename }) });
      try { raster.remove(); state.scope?.view?.update(); } catch {}
    });

    ctx.exitTool();
  };

  cmdUI?.show?.({
    status:   t("common.image"),
    hints:    t("app.pjs.hint.place"),
    controls: "",
  });

  return () => {
    if (body?.style) body.style.cursor = prevCursor;
    cmdUI?.hide?.({ clear: true });
  };
}
