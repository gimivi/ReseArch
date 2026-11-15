// APP/PJS_sub_modules/PJS-tools.mjs
import { getState, activateWindow, deactivateWindow } from "./PJS-core.mjs";
import { t } from "../shared/i18n.mjs";
import { createPointTool } from "./PJS-tool-point.mjs";
import { createSelectTool } from "./PJS-tool-select.mjs";
import { createLineTool } from "./PJS-tool-line.mjs";
import { createPolylineTool } from "./PJS-tool-polyline.mjs";
import { createRectTool } from "./PJS-tool-rect.mjs";
import { createCircleTool } from "./PJS-tool-circle.mjs";
import { createEllipseTool } from "./PJS-tool-ellipse.mjs";
import { createEllipseAxesTool } from "./PJS-tool-ellipse-axes.mjs";
import { createArcTool } from "./PJS-tool-arc.mjs";
import { createPolygonTool } from "./PJS-tool-polygon.mjs";
import { createArcCSETool } from "./PJS-tool-arc-cse.mjs";
import { createCircle2PTool } from "./PJS-tool-circle-2p.mjs";
import { createCircle3PTool } from "./PJS-tool-circle-3p.mjs";
import { createRectEdgeTool } from "./PJS-tool-rect-edge.mjs";
import { createPolygonEdgeTool } from "./PJS-tool-polygon-edge.mjs";
import { createStarTool } from "./PJS-tool-star.mjs";
import { createCurveTool } from "./PJS-tool-curve.mjs";

import { createMoveTool, createCopyTool } from "./PJS-tool-translate.mjs";
import { createRotateTool } from "./PJS-tool-rotate.mjs";
import { createScaleTool } from "./PJS-tool-scale.mjs";

import { createTextTool  } from "./PJS-tool-text.mjs";
import { createLinkTool  } from "./PJS-tool-link.mjs";
import { createImageTool } from "./PJS-tool-image.mjs";
import { createSvgTool   } from "./PJS-tool-svg.mjs";

/**
 * Tool manager:
 * - gestisce tool Paper per finestra (PaperScope)
 * - gestisce input overlay (pointerEvents) e routing pan/zoom a OSD
 *
 * Convenzioni:
 * - Navigate (nessun tool): overlay pointerEvents="none"
 * - Tool attivo: overlay pointerEvents="auto"
 * - Space premuto: pan mode temporaneo -> overlay pointerEvents="none" finché Space è giù
 * - Wheel su overlay: zoom OSD (sempre quando overlay è "auto")
 */

const TOOL_FACTORIES = {
  arc: createArcTool,
  arc_cse: createArcCSETool,
  circle: createCircleTool,
  circle_2p: createCircle2PTool,
  circle_3p: createCircle3PTool,
  curve: createCurveTool,
  ellipse: createEllipseTool,
  ellipse_axes: createEllipseAxesTool,
  line: createLineTool,
  point: createPointTool,
  polygon: createPolygonTool,
  polygon_edge: createPolygonEdgeTool,
  polyline: createPolylineTool,
  rect: createRectTool,
  rect_edge: createRectEdgeTool,
  select: createSelectTool,
  star: createStarTool,

  move: createMoveTool,
  copy: createCopyTool,
  rotate: createRotateTool,
  scale: createScaleTool,

  text:  createTextTool,
  link:  createLinkTool,
  image: createImageTool,
  svg:   createSvgTool,

};


export function ensureToolSystem(bodyEl) {
  const state = getState(bodyEl);
  if (!state) throw new Error("PJS-tools: stato PJS non inizializzato");

  if (state.tools) return state.tools;

  state.tools = {
    activeName: "navigate",
    lastToolName: null,
    lastToolParams: null,
    paperTool: null,
    cleanupFns: [],
    isSpaceDown: false,
    isTempPan: false,
    _altDown: false,
    _rmbInstalled: false,
    _rmbTarget: null,
    _rmbHandlers: null,
    onRmbClose: null,
    onEscCancel: null,

  };

  return state.tools;
}

function canUseTools(state) {
  if (!state?.dwg?.dwg_id) {
    return { ok: false, msg: t("app.pjs.guard.no_drawing") };
  }

  const env = state._env;
  if (!env?.layers?.length) {
    return { ok: false, msg: t("app.pjs.guard.invalid_drawing") };
  }

  const activeId = env.workspace?.defaults?.activeLayerId;
  if (!activeId) {
    return { ok: false, msg: t("app.pjs.guard.no_active_layer") };
  }

  const L = env.layers.find(x => x.id === activeId);
  if (!L) {
    return { ok: false, msg: t("app.pjs.guard.invalid_active_layer") };
  }

  if (L.visible === false) {
    return { ok: false, msg: t("app.pjs.guard.active_layer_off") };
  }

  return { ok: true };
}





// Wrapper pubblico: esegue il cambio tool vero e proprio (_setActiveToolImpl,
// che ha diversi return anticipati — navigate, tool sconosciuto, guard
// selezione…) poi notifica SEMPRE il risultato finale su state.localEvents,
// qualunque sia il percorso interno seguito. Sorgente di PJS/Events/OnToolChanged
// (PJS-flow-nodes.mjs).
export function setActiveTool(bodyEl, name, opts = {}) {
  _setActiveToolImpl(bodyEl, name, opts);
  const state = getState(bodyEl);
  state?.localEvents?.dispatchEvent(new CustomEvent('toolChanged', {
    detail: { toolName: state?.tools?.activeName ?? 'navigate' },
  }));
}

function _setActiveToolImpl(bodyEl, name, { cmdUI } = {}) {
  const state = getState(bodyEl);
  const tools = ensureToolSystem(bodyEl);

  // chiudi tool precedente
  teardownActiveTool(bodyEl, { cmdUI });

  // assicura che RMB sia sempre attivo anche in Navigate
  installRmbCadHandlers(bodyEl, { cmdUI });

  // navigate = nessun tool (OSD prende tutto)
  if (!name || name === "navigate") {
    tools.activeName = "navigate";
    deactivateWindow(bodyEl);
    cmdUI?.update?.({
      status: t("app.pjs.status.navigate"),
      hints: t("app.pjs.hint.navigate"),
      controls: ""
    });
    return;
  }

  const factory = TOOL_FACTORIES[name];
  if (!factory) {
    tools.activeName = "navigate";
    deactivateWindow(bodyEl);
    cmdUI?.update?.({
      status: t("app.pjs.status.navigate"),
      hints: t("app.pjs.hint.unknown_tool", { name }),
      controls: ""
    });
    return;
  }

  // 🔒 GUARD OBBLIGATORIO
  const chk = canUseTools(state);
  if (!chk.ok) {
    tools.activeName = "navigate";
    deactivateWindow(bodyEl);
    cmdUI?.update?.({
      status: t("app.pjs.status.navigate"),
      hints: chk.msg,
      controls: ""
    });
    return;
  }

  if ((name === "move" || name === "copy") && !(state.selectionCount > 0)) {
    tools.activeName = "navigate";
    deactivateWindow(bodyEl);
    cmdUI?.update?.({
      status: name === "copy" ? t("common.copy") : t("app.pjs.tool.move"),
      hints: t("app.pjs.hint.no_selection"),
      controls: ""
    });
    return;
  }

  
  // memorizza l’ultimo tool reale attivato con successo
  tools.lastToolName = name;
  tools.lastToolParams = null;

  // attiva overlay input
  tools.activeName = name;
  activateWindow(bodyEl);

  // installa pan/zoom helpers (wheel + space)
  installPanZoomHelpers(bodyEl, { cmdUI });

  // crea e attiva tool paper
  state.scope.activate();
  const paperTool = new state.scope.Tool();
  tools.paperTool = paperTool;

  const ctx = {
    bodyEl,
    state,
    tools,
    cmdUI,
    isTempPan: () => tools.isTempPan === true,
    isAltDown: () => tools._altDown === true,
    exitTool: () => setActiveTool(bodyEl, "navigate", { cmdUI }),

    setRmbClose: (fn) => {
      tools.onRmbClose = (typeof fn === "function") ? fn : null;
    },
    setEscCancel: (fn) => {
      tools.onEscCancel = (typeof fn === "function") ? fn : null;
    },

  };

  const teardown = factory(paperTool, ctx);
  if (typeof teardown === "function") tools.cleanupFns.push(teardown);

  // UI
  if (name === "select") cmdUI?.show?.({ status: t("common.select"), hints: t("app.pjs.hint.select"), controls: "" });
  if (name === "move") cmdUI?.show?.({status: t("app.pjs.tool.move"),hints: t("app.pjs.hint.move"), controls: ""});
  if (name === "copy") cmdUI?.show?.({status: t("common.copy"),hints: t("app.pjs.hint.move"), controls: ""});
  if (name === "rotate") cmdUI?.show?.({  status: t("app.pjs.status.rotate_start"),  hints: t("app.pjs.hint.rotate_start"),  controls: ""});
  if (name === "scale") cmdUI?.show?.({  status: t("app.pjs.status.scale_start"),  hints: t("app.pjs.hint.scale_start"),  controls: ""});

  if (name === "point") cmdUI?.update?.({ status: t("app.pjs.tool.point"), hints: t("app.pjs.hint.point"), controls: "" });
  if (name === "line") cmdUI?.update?.({ status: t("app.pjs.tool.line"), hints: t("app.pjs.hint.two_points"), controls: "" });
  if (name === "polyline") cmdUI?.update?.({ status: t("app.pjs.tool.polyline"), hints: t("app.pjs.hint.polyline"), controls: "" });
  if (name === "rect") cmdUI?.update?.({ status: t("app.pjs.tool.rect"), hints: t("app.pjs.hint.two_points"), controls: "" });
  if (name === "circle") cmdUI?.update?.({ status: t("app.pjs.status.circle"), hints: t("app.pjs.hint.center_commit"), controls: "" });
  if (name === "ellipse") cmdUI?.update?.({ status: t("app.pjs.tool.ellipse"), hints: t("app.pjs.hint.ellipse"), controls: "" });
  if (name === "ellipse_axes") cmdUI?.update?.({ status: t("app.pjs.tool.ellipse_axes"), hints: t("app.pjs.hint.ellipse_axes"), controls: "" });
  if (name === "arc") cmdUI?.update?.({ status: t("app.pjs.tool.arc_3p"), hints: t("app.pjs.hint.arc"), controls: "" });
  if (name === "polygon") cmdUI?.update?.({ status: t("app.pjs.tool.polygon"), hints: t("app.pjs.hint.center_commit"), controls: "" });
  if (name === "arc_cse") cmdUI?.update?.({ status: t("app.pjs.tool.arc_cse"), hints: t("app.pjs.hint.arc_cse"), controls: "" });
  if (name === "circle_2p") cmdUI?.update?.({ status: t("app.pjs.status.circle_2p"), hints: t("app.pjs.hint.two_points"), controls: "" });
  if (name === "circle_3p") cmdUI?.update?.({ status: t("app.pjs.tool.circle_3p"), hints: t("app.pjs.hint.circle_3p"), controls: "" });
  if (name === "rect_edge") cmdUI?.update?.({ status: t("app.pjs.tool.rect_edge"), hints: t("app.pjs.hint.rect_edge"), controls: "" });
  if (name === "polygon_edge") cmdUI?.update?.({ status: t("app.pjs.tool.polygon_edge"), hints: t("app.pjs.hint.polygon_edge"), controls: "" });
  if (name === "star") cmdUI?.update?.({ status: t("app.pjs.tool.star"), hints: t("app.pjs.hint.center_commit"), controls: "" });
  if (name === "curve") cmdUI?.update?.({ status: t("app.pjs.tool.curve"), hints: t("app.pjs.hint.center_commit"), controls: "" });
}



export function teardownActiveTool(bodyEl, { cmdUI } = {}) {
  const state = getState(bodyEl);
  if (!state?.tools) return;

  const tools = state.tools;

  // cleanup fns
  for (const fn of tools.cleanupFns) {
    try { fn(); } catch {}
  }
  tools.cleanupFns = [];

  // remove paper tool
  try {
    if (tools.paperTool) tools.paperTool.remove();
  } catch {}
  tools.paperTool = null;

  tools.onRmbClose = null;
  tools.onEscCancel = null;

  // pan/zoom listeners
  uninstallPanZoomHelpers(bodyEl);

  // torna a navigate di default (ma non cambiamo activeName qui: lo fa setActiveTool)
  deactivateWindow(bodyEl);
  cmdUI?.update?.({ controls: "" });
}

function installPanZoomHelpers(bodyEl, { cmdUI } = {}) {
  const state = getState(bodyEl);
  const tools = state.tools;
  const { viewer, overlay } = state;

  if (!viewer || !overlay?.canvas) return;

  // Wheel -> zoom OSD (quando overlay cattura)
  const onWheel = (e) => {
    // se overlay non cattura, OSD già gestisce wheel: non interveniamo
    if (overlay.canvas.style.pointerEvents !== "auto") return;

    // impedisce scroll pagina
    e.preventDefault();

    // zoom factor da deltaY
    const delta = e.deltaY || 0;
    const factor = Math.pow(1.0015, -delta);

    // ref point in viewport coords
    const px = new OpenSeadragon.Point(e.offsetX, e.offsetY);
    const vpPoint = viewer.viewport.viewerElementToViewportCoordinates(px);

    viewer.viewport.zoomBy(factor, vpPoint, true);
    viewer.viewport.applyConstraints();
  };

  overlay.canvas.addEventListener("wheel", onWheel, { passive: false });
  tools.cleanupFns.push(() => {
    try { overlay.canvas.removeEventListener("wheel", onWheel); } catch {}
  });

  // Space -> pan temporaneo (OSD deve ricevere drag)
   const onKeyDown = (e) => {
    if (e.key === "Alt") {
      tools._altDown = true;
      return;
    }

    if (e.code !== "Space") return;
    if (tools.isSpaceDown) return;
    tools.isSpaceDown = true;
    tools.isTempPan = true;

    deactivateWindow(bodyEl);
    cmdUI?.update?.({ hints: t("app.pjs.hint.space_pan") });
  };

  const onKeyUp = (e) => {
    if (e.key === "Alt") {
      tools._altDown = false;
      return;
    }

    if (e.code !== "Space") return;
    tools.isSpaceDown = false;
    tools.isTempPan = false;

    if (tools.activeName && tools.activeName !== "navigate") {
      activateWindow(bodyEl);

      if (tools.activeName === "point") cmdUI?.update?.({ hints: t("app.pjs.hint.point_resume") });
      if (tools.activeName === "select") cmdUI?.update?.({ hints: t("app.pjs.hint.select_resume") });
      if (tools.activeName === "move") cmdUI?.update?.({ hints: t("app.pjs.hint.move") });
      if (tools.activeName === "copy") cmdUI?.update?.({ hints: t("app.pjs.hint.move") });
     
      if ((name === "move" || name === "copy" || name === "rotate") && !(state.selectionCount > 0)) {
          tools.activeName = "navigate";
          deactivateWindow(bodyEl);
          cmdUI?.update?.({
          status: name === "copy" ? t("common.copy") : (name === "rotate" ? t("app.pjs.tool.rotate") : t("app.pjs.tool.move")),
          hints: t("app.pjs.hint.no_selection"),
          controls: ""
      });
      return;
      }

      if ((name === "move" || name === "copy" || name === "rotate" || name === "scale") && !(state.selectionCount > 0)) {
        tools.activeName = "navigate";
        deactivateWindow(bodyEl);
        cmdUI?.update?.({
          status:
            name === "copy" ? t("common.copy") :
            name === "rotate" ? t("app.pjs.tool.rotate") :
            name === "scale" ? t("app.pjs.tool.scale") :
            t("app.pjs.tool.move"),
          hints: t("app.pjs.hint.no_selection"),
          controls: ""
        });
        return;
      }

    }

  };

 
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  tools._pz = { onWheel, onKeyDown, onKeyUp };
}

function uninstallPanZoomHelpers(bodyEl) {
  const state = getState(bodyEl);
  const tools = state?.tools;
  if (!tools?._pz) return;

  const { overlay } = state;
  try { overlay?.canvas?.removeEventListener("wheel", tools._pz.onWheel); } catch {}
  try { window.removeEventListener("keydown", tools._pz.onKeyDown); } catch {}
  try { window.removeEventListener("keyup", tools._pz.onKeyUp); } catch {}

  tools._pz = null;
  tools.isSpaceDown = false;
  tools.isTempPan = false;
  tools._altDown = false;
}

export function onEscNavigate(bodyEl, { cmdUI } = {}) {
  // helper: ESC torna a navigate
  setActiveTool(bodyEl, "navigate", { cmdUI });
}
function installRmbCadHandlers(bodyEl, { cmdUI } = {}) {
  const state = getState(bodyEl);
  const tools = ensureToolSystem(bodyEl);

  const target = state?.viewer?.container || state?.overlay?.canvas || bodyEl;
  if (!target) return;

  if (tools._rmbInstalled && tools._rmbTarget === target) return;

  if (tools._rmbInstalled && tools._rmbTarget && tools._rmbHandlers) {
    try { tools._rmbTarget.removeEventListener("contextmenu", tools._rmbHandlers.onContextMenu); } catch {}
    try { tools._rmbTarget.removeEventListener("pointerdown", tools._rmbHandlers.onPointerDown); } catch {}
    tools._rmbInstalled = false;
    tools._rmbTarget = null;
    tools._rmbHandlers = null;
  }

  const onContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

const onPointerDown = (e) => {
  if (e.button !== 2) return;

  e.preventDefault();
  e.stopPropagation();

  if (tools.activeName && tools.activeName !== "navigate") {
    if (typeof tools.onRmbClose === "function") {
      try {
        tools.onRmbClose();
      } catch {
        setActiveTool(bodyEl, "navigate", { cmdUI });
      }
    } else {
      setActiveTool(bodyEl, "navigate", { cmdUI });
    }
    return;
  }

  if (tools.lastToolName) {
    setActiveTool(bodyEl, tools.lastToolName, { cmdUI });
  }
};

  target.addEventListener("contextmenu", onContextMenu, { passive: false });
  target.addEventListener("pointerdown", onPointerDown, { passive: false });

  tools._rmbInstalled = true;
  tools._rmbTarget = target;
  tools._rmbHandlers = { onContextMenu, onPointerDown };
}

