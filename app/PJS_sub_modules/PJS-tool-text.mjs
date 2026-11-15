// app/PJS_sub_modules/PJS-tool-text.mjs
// Tool PJS: inserimento testo multi-riga in image space.
// Click → dialog (textarea + stile + giustificazione) → Group nel layer attivo.
// Il Group contiene: PointText (+ Path.Rectangle bordo se lo stile lo prevede).

import { setDirty } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";
import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import { showInputDialog } from "./PJS-ui-inputDialog.mjs";
import { getTextStyles, findTextStyle, applyTextStyle } from "./PJS-ui-textStylesModal.mjs";

export function createTextTool(paperTool, ctx) {
  const { state, cmdUI } = ctx;
  const body = ctx.bodyEl;
  const prevCursor = body?.style?.cursor || "";
  if (body?.style) body.style.cursor = "text";

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

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan()) return;
    if (event?.event?.button === 2) return;
    if (!state._env?.layers?.length) return;

    const pos     = event.point.clone();
    const env     = state._env;
    const defs    = env?.workspace?.defaults || {};
    const styles  = getTextStyles(env);

    const styleOptions = [
      { value: '', label: t('app.pjs.text.no_style') },
      ...styles.map(s => ({ value: s.id, label: s.name })),
    ];

    showInputDialog({
      title:  t("app.pjs.text.insert"),
      fields: [
        {
          id: "text", label: t("app.pjs.tool.text"), type: "textarea", rows: 4,
          placeholder: t("app.pjs.text.placeholder"),
        },
        {
          id: "styleId", label: t("app.pjs.text.style"), type: "select",
          options: styleOptions,
          value: defs.lastTextStyleId || '',
        },
        {
          id: "just", label: t("app.pjs.text.justification"), type: "select",
          options: [
            { value: "left",   label: t("app.pjs.text.left") },
            { value: "center", label: t("app.pjs.text.center") },
            { value: "right",  label: t("app.pjs.text.right") },
          ],
          value: defs.lastTextJust || "left",
        },
        {
          id: "size", label: t("app.pjs.text.size"), type: "number",
          value: defs.fontSize ?? 50, min: 1,
        },
        {
          id: "interactiveId", label: t("app.pjs.ctrl.interactive_id"), type: "text",
          placeholder: t("app.pjs.text.id_placeholder"),
          value: '',
        },
      ],
    }).then(result => {
      if (!result || !result.text.trim()) { ctx.exitTool(); return; }

      // Ricorda ultime scelte nei defaults
      defs.lastTextStyleId = result.styleId;
      defs.lastTextJust    = result.just;

      state.scope.activate();
      getActiveDrawingLayer().activate();

      const layerId = getActiveLayerId();

      // Crea PointText
      const textItem = new state.scope.PointText(pos);
      textItem.content = result.text;
      textItem.data    = { __textPart: true };

      // Crea Group contenitore
      const group = new state.scope.Group([textItem]);
      group.data = { kind: "text", layerId, interactiveId: result.interactiveId?.trim() || '' };

      // Applica stile selezionato o defaults layer
      const selectedStyle = result.styleId ? findTextStyle(env, result.styleId) : null;
      if (selectedStyle) {
        applyTextStyle(group, selectedStyle, state.scope);
        // Giustificazione del dialog ha precedenza su quella dello stile
        textItem.justification = result.just || "left";
      } else {
        const layerStyle = env.layers?.find(x => x.id === layerId)?.style || {};
        textItem.fontFamily    = defs.fontFamily || "Arial";
        textItem.fontSize      = Math.max(1, Number(result.size) || 50);
        textItem.fillColor     = layerStyle.strokeColor || "#000000";
        textItem.justification = result.just || "left";
      }

      setDirty(ctx.bodyEl, true);
      if (state.history) try { pushSnapshot(state.history, { label: "Testo", snapshot: exportProjectJSON(state) }); } catch {}
      state.scope.view.update();
      cmdUI?.update?.({ status: t("app.pjs.text.inserted") });
      ctx.exitTool();
    });
  };

  cmdUI?.show?.({
    status:   t("app.pjs.tool.text"),
    hints:    t("app.pjs.hint.place"),
    controls: "",
  });

  return () => {
    if (body?.style) body.style.cursor = prevCursor;
    cmdUI?.hide?.({ clear: true });
  };
}
