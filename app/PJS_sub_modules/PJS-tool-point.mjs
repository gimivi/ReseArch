// APP/PJS_sub_modules/PJS-tool-point.mjs
import { setDirty } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";
import { pushSnapshot, exportProjectJSON } from "./PJS-history.mjs";
import {
  ensureSnapSystem,
  snapPick,
  snapUpdateMarker,
  snapClearMarker,
  snapAddConstructionPoint,
  snapClearConstructionPoints
} from "./PJS-snap.mjs";

/**
 * Tool Punto (versione aggiornata per overlay con view.matrix):
 * - Click: inserisce un simbolo "X" in IMAGE SPACE (project coords)
 * - Usa lo stile del layer attivo (layer-only)
 * - Rispetta workflow obbligato: richiede disegno aperto + layer attivo valido (guard nel tool manager)
 */

export function createPointTool(paperTool, ctx) {
  const { state, cmdUI } = ctx;

  const body = ctx.bodyEl;
  const prevCursor = body?.style?.cursor;
  if (body?.style) body.style.cursor = "crosshair";

  let hoverTimer = null;
  let lastMovePt = null;

  function getActiveLayerStyleAndId() {
    const env = state._env;
    const activeId = env.workspace?.defaults?.activeLayerId;
    const L = env.layers.find(x => x.id === activeId);
    return { layerId: activeId, style: (L?.style || {}) };
  }

  function applyStyle(item, style) {
    item.strokeColor = style.strokeColor || "#000000";
    item.strokeWidth = Number(style.strokeWidth || 1);
    item.dashArray = Array.isArray(style.dashArray) ? style.dashArray : [];
    item.fillColor = null;
  }

  function getPointTypeAndScale(style) {
    const pt = (style?.pointType || style?.pt || "cross").toString();
    const sPraw = Number(style?.sP ?? style?.sp ?? 1);
    const sP = Number.isFinite(sPraw) ? Math.max(1, Math.min(99, Math.round(sPraw))) : 1;
    return { pointType: pt, sP };
  }

  function drawPointSymbol(scope, imgPt, pointType, sP, style) {
    // Base box: 12x12 (as requested). Scale affects the symbol size around insertion point.
    const baseBox = 12;
    const half = (baseBox / 2) * sP;

    const items = [];

    const mkLine = (a, b) => {
      const p = new scope.Path.Line(a, b);
      applyStyle(p, style);
      return p;
    };

    const mkRect = () => {
      const r = new scope.Rectangle(imgPt.subtract([half, half]), [half * 2, half * 2]);
      const p = new scope.Path.Rectangle({ rectangle: r });
      applyStyle(p, style);
      return p;
    };

    const mkCircle = (fill = false) => {
      const p = new scope.Path.Circle({ center: imgPt, radius: Math.max(0.5, half) });
      applyStyle(p, style);
      p.fillColor = fill ? (style.fillColor || style.strokeColor || "#000000") : null;
      return p;
    };

    switch (pointType.toLowerCase()) {
      case "x":
      case "diag":
        items.push(mkLine(new scope.Point(imgPt.x - half, imgPt.y - half), new scope.Point(imgPt.x + half, imgPt.y + half)));
        items.push(mkLine(new scope.Point(imgPt.x - half, imgPt.y + half), new scope.Point(imgPt.x + half, imgPt.y - half)));
        break;
      case "dot":
        items.push(mkCircle(true));
        break;
      case "circle":
        items.push(mkCircle(false));
        break;
      case "square":
        items.push(mkRect());
        break;
      case "cross":
      case "+":
      default:
        items.push(mkLine(new scope.Point(imgPt.x - half, imgPt.y), new scope.Point(imgPt.x + half, imgPt.y)));
        items.push(mkLine(new scope.Point(imgPt.x, imgPt.y - half), new scope.Point(imgPt.x, imgPt.y + half)));
        break;
    }

    const g = new scope.Group(items);
    g.data = g.data || {};
    g.data.kind = "point";
    g.data.p = [imgPt.x, imgPt.y];
    return g;
  }

  function getActiveDrawingLayer() {
    const env = state._env;
    const ui = state._uiLayer;
    const activeId = env.workspace?.defaults?.activeLayerId;

    for (const L of state.scope.project.layers) {
      if (L === ui) continue;
      if (L.data?.layerId === activeId) return L;
    }

    // se non esiste, crealo
    const L = new state.scope.Layer();
    L.name = activeId || "Layer";
    L.data = L.data || {};
    L.data.layerId = activeId || "L1";
    return L;
  }

  function cleanup() {
    if (hoverTimer) {
      try { clearTimeout(hoverTimer); } catch {}
      hoverTimer = null;
    }
    snapClearMarker(body);
    if (body?.style) body.style.cursor = prevCursor || "";
    cmdUI?.hide?.({ clear: true });
  }

  function showFooterStatus({ layerId, style }, extra = "") {
    const { pointType, sP } = getPointTypeAndScale(style);
    const snapTypes = state._env?.workspace?.snap?.types || {};
    const enabled = state._env?.workspace?.snap?.enabled !== false;
    const osnap = enabled
      ? [
          snapTypes.endpoint ? "end" : null,
          snapTypes.midpoint ? "mid" : null,
          snapTypes.center ? "cent" : null,
          snapTypes.intersection ? "int" : null
        ].filter(Boolean).join(" ")
      : "off";

    cmdUI?.show?.({
      status: t("app.pjs.prompt.point.status", { pt: pointType, sp: sP }) + (extra ? " • " + extra : ""),
      hints: t("app.pjs.hint.point_osnap", { osnap })
    });
  }

  paperTool.onKeyDown = (event) => {
    if (event.key === "escape") return ctx.exitTool();
  };

  // Snap hover marker BEFORE first point: idle hover (70ms)
  paperTool.onMouseMove = (event) => {
    if (ctx.isTempPan()) return;
    if (!state._env?.layers?.length) return;

    ensureSnapSystem(body);

    lastMovePt = event.point?.clone?.() || null;
    if (!lastMovePt) return;

    if (hoverTimer) {
      try { clearTimeout(hoverTimer); } catch {}
    }

    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (!lastMovePt) return;

      const hoverPt = lastMovePt.clone();
      const snap = (ctx.isAltDown?.()) ? null : snapPick(body, hoverPt);
      if (snap) snapUpdateMarker(body, snap, hoverPt);
      else snapClearMarker(body);

      const active = getActiveLayerStyleAndId();
      const extra = snap?.kind ? `snap=${snap.kind}` : "";
      showFooterStatus(active, extra);
    }, 70);
  };

  paperTool.onMouseDown = (event) => {
    if (ctx.isTempPan()) return;
    if (event?.event?.button === 2) return; // right click ignore

    // Sicurezza: il guard nel tool manager dovrebbe già impedirlo
    if (!state._env?.layers?.length) return;

    state.scope.activate();
    getActiveDrawingLayer().activate();

    // Con view.matrix = M, event.point è già in IMAGE SPACE
    ensureSnapSystem(ctx.bodyEl);

    let imgPt = event.point.clone();
    const snap = (ctx.isAltDown?.()) ? null : snapPick(ctx.bodyEl, imgPt);
    if (snap) {
      imgPt = snap.imgPoint;
      snapUpdateMarker(ctx.bodyEl, snap, event.point);
    } else {
      snapClearMarker(ctx.bodyEl);
    }

    const { layerId, style } = getActiveLayerStyleAndId();

    const { pointType, sP } = getPointTypeAndScale(style);
    const g = drawPointSymbol(state.scope, imgPt, pointType, sP, style);
    g.data = g.data || {};
    g.data.layerId = layerId;

    // White marker (construction point) with TTL=1500ms
    snapAddConstructionPoint(body, imgPt);
    snapClearConstructionPoints(body, { delayMs: 1500 });

    state.scope.view.update();
    setDirty(ctx.bodyEl, true);
    if (state.history) try { pushSnapshot(state.history, { label: "Punto", snapshot: exportProjectJSON(state) }); } catch {}

    const extra = snap?.kind ? `snap=${snap.kind}` : "";
    cmdUI?.update?.({ status: t("app.pjs.prompt.point.status_xy", { pt: pointType, sp: sP, x: imgPt.x.toFixed(1), y: imgPt.y.toFixed(1) }) + (extra ? " • " + extra : "") });
  };

  return () => cleanup();
}
