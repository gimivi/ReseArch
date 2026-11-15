// app/PJS_sub_modules/PJS-tool-link.mjs
// Tool PJS: inserimento annotazione link in image space.
// Click → dialog etichetta/URL/dimensione → PointText blu nel layer attivo.
// L'URL è conservato in item.data.href per uso futuro (navigate, export, ecc.).

import { setDirty } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";
import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import { showInputDialog } from "./PJS-ui-inputDialog.mjs";

export function createLinkTool(paperTool, ctx) {
  const { state, cmdUI } = ctx;
  const body = ctx.bodyEl;
  const prevCursor = body?.style?.cursor || "";
  if (body?.style) body.style.cursor = "crosshair";

  function getActiveLayerId() {
    return state._env?.workspace?.defaults?.activeLayerId ?? "L1";
  }

  function getActiveDrawingLayer() {
    const ui      = state._uiLayer;
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

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan()) return;
    if (event?.event?.button === 2) return;
    if (!state._env?.layers?.length) return;

    const pos  = event.point.clone();
    const defs = state._env?.workspace?.defaults || {};

    showInputDialog({
      title: t("app.pjs.link.dialog_title"),
      fields: [
        { id: "text", label: t("app.pjs.link.label"), type: "text",   placeholder: t("app.pjs.link.label_placeholder") },
        { id: "url",  label: "URL",                         type: "url",    placeholder: "https://..." },
        { id: "size", label: t("app.pjs.link.size"), type: "number", value: defs.fontSize ?? 50, min: 1 },
      ],
    }).then(result => {
      if (!result || !result.text.trim()) { ctx.exitTool(); return; }

      state.scope.activate();
      getActiveDrawingLayer().activate();

      const item = new state.scope.PointText(pos);
      item.content       = result.text;
      item.fontSize      = Math.max(1, Number(result.size) || 50);
      item.fontFamily    = defs.fontFamily        || "Arial";
      item.justification = defs.textJustification || "left";
      item.fillColor     = "#0077cc"; // colore link
      item.data = { kind: "link", href: result.url || "", layerId: getActiveLayerId() };

      setDirty(ctx.bodyEl, true);
      if (state.history) try { pushSnapshot(state.history, { label: "Link", snapshot: exportProjectJSON(state) }); } catch {}
      state.scope.view.update();
      cmdUI?.update?.({ status: t("app.pjs.link.inserted", { text: result.text }) });
      ctx.exitTool();
    });
  };

  cmdUI?.show?.({
    status: t("app.pjs.link.status"),
    hints:  t("app.pjs.hint.place"),
    controls: "",
  });

  return () => {
    if (body?.style) body.style.cursor = prevCursor;
    cmdUI?.hide?.({ clear: true });
  };
}
