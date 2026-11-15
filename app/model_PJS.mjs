// model_PJS.mjs
// Paper.js drawing canvas standalone — strumenti base (select/rect/ellipse/circle/erase/import SVG).
//
// Nota: stato tenuto in una variabile di modulo (__paperApp), non su bodyEl[STATE_KEY].
// Non supporta più pannelli PJS aperti contemporaneamente (si sovrascriverebbero).
// Il sistema di disegno maturo e multi-istanza usato in produzione è quello embedded
// in model_OSD.mjs, vedi app/PJS_sub_modules/ e _doc/module-pjs-paperjs.md.

import { t } from "./shared/i18n.mjs";

let __paperApp = {
  scope: null,            // paper.PaperScope
  canvas: null,           // HTMLCanvasElement
  resizeObserver: null,   // ResizeObserver
  activeToolId: "select",
  tools: new Map(),       // id -> paper.Tool
  selectedItem: null,     // paper.Item
  dragOffset: null,       // paper.Point
  // drawing state
  drawStart: null,        // paper.Point
  drawItem: null,         // paper.Item
  // style defaults
  style: {
    strokeColor: "#111",
    fillColor: "rgba(0,0,0,0.06)",
    strokeWidth: 2,
  },
};

function getObjectDisplayName(object) {
  if (!object) return t("app.osd.object.@");
  return (
    object.obj_name ||
    object.obj_title ||
    object.name ||
    object.title ||
    t("app.osd.object_n.@", { id: object.obj_id ?? "" }).trim()
  );
}

export default {
  async renderBody({ bodyEl, object, models, signal }) {
    bodyEl.innerHTML = "";
    bodyEl.style.position = "relative";
    bodyEl.style.width = "100%";
    bodyEl.style.height = "100%";
    bodyEl.style.overflow = "hidden";

    const canvas = document.createElement("canvas");
    canvas.setAttribute("resize", "true"); // Paper.js hint
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.touchAction = "none"; // allow pointer interactions
    bodyEl.appendChild(canvas);

    // PaperScope isolato per non collidere con altre eventuali istanze paper
    const scope = new paper.PaperScope();
    scope.setup(canvas);

    __paperApp.scope = scope;
    __paperApp.canvas = canvas;

    buildPaperTools(scope);

    const doResize = () => {
      if (!__paperApp.canvas || !__paperApp.scope) return;
      const rect = bodyEl.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      __paperApp.canvas.width = w;
      __paperApp.canvas.height = h;
      __paperApp.scope.view.viewSize = new __paperApp.scope.Size(w, h);
      __paperApp.scope.view.update();
    };

    doResize();

    const ro = new ResizeObserver(() => doResize());
    ro.observe(bodyEl);
    __paperApp.resizeObserver = ro;

    setActiveTool("select");

    signal?.addEventListener("abort", () => {
      try { this.destroy(); } catch {}
    }, { once: true });
  },

  getLeftMenu({ object }) {
    return {
      title: getObjectDisplayName(object),
      items: [],
    };
  },

  getRightMenu() {
    return {
      title: "☰",
      items: [
        { id: "paper-select",  label: t("app.pjs.legacy.select_move"), onClick: () => setActiveTool("select") },
        { id: "paper-rect",    label: t("app.pjs.tool.rect"), onClick: () => setActiveTool("rect") },
        { id: "paper-ellipse", label: t("app.pjs.tool.ellipse"), onClick: () => setActiveTool("ellipse") },
        { id: "paper-circle",  label: t("app.pjs.tool.circle"), onClick: () => setActiveTool("circle") },
        { id: "paper-erase",   label: t("app.pjs.legacy.erase"), onClick: () => setActiveTool("erase") },
        { type: "divider" },
        { id: "paper-import-svg-url", label: t("app.pjs.legacy.import_svg_url"), onClick: () => importSvgFromUrl() },
        { id: "paper-clear",          label: t("app.pjs.legacy.clear"), onClick: () => clearPaperProject() },
      ],
    };
  },

  destroy() {
    try { __paperApp.resizeObserver?.disconnect?.(); } catch {}

    try {
      __paperApp.scope?.project?.clear?.();
      __paperApp.scope?.remove?.();
    } catch {}

    __paperApp.scope = null;
    __paperApp.canvas = null;
    __paperApp.tools?.clear?.();
    __paperApp.selectedItem = null;
    __paperApp.dragOffset = null;
    __paperApp.drawStart = null;
    __paperApp.drawItem = null;
  },
};

/* =======================
   Paper.js tools
   ======================= */

function setActiveTool(toolId) {
  __paperApp.activeToolId = toolId;
  const scope = __paperApp.scope;
  if (!scope) return;

  const tool = __paperApp.tools.get(toolId);
  if (!tool) return;

  tool.activate();
}

function buildPaperTools(scope) {
  __paperApp.tools.clear();

  const applyDefaultStyle = (item) => {
    item.strokeColor = __paperApp.style.strokeColor;
    item.fillColor = __paperApp.style.fillColor;
    item.strokeWidth = __paperApp.style.strokeWidth;
    item.closed = true;
    return item;
  };

  const hitTest = (point) => {
    const opts = { fill: true, stroke: true, segments: true, tolerance: 8 };
    const res = scope.project.hitTest(point, opts);
    return res?.item ?? null;
  };

  // --- Select / Move ---
  const selectTool = new scope.Tool();
  selectTool.onMouseDown = (e) => {
    const item = hitTest(e.point);
    __paperApp.selectedItem = item;
    __paperApp.dragOffset = null;

    scope.project.activeLayer.selected = false;
    if (item) {
      item.selected = true;
      __paperApp.dragOffset = e.point.subtract(item.position);
    }
  };
  selectTool.onMouseDrag = (e) => {
    const item = __paperApp.selectedItem;
    if (!item) return;
    const off = __paperApp.dragOffset ?? new scope.Point(0, 0);
    item.position = e.point.subtract(off);
  };
  selectTool.onMouseUp = () => {
    __paperApp.dragOffset = null;
  };
  __paperApp.tools.set("select", selectTool);

  // --- Rectangle ---
  const rectTool = new scope.Tool();
  rectTool.onMouseDown = (e) => {
    __paperApp.drawStart = e.point;
    __paperApp.drawItem = applyDefaultStyle(
      new scope.Path.Rectangle(new scope.Rectangle(e.point, e.point))
    );
  };
  rectTool.onMouseDrag = (e) => {
    if (!__paperApp.drawStart || !__paperApp.drawItem) return;
    const r = new scope.Rectangle(__paperApp.drawStart, e.point);
    const tmp = new scope.Path.Rectangle(r);
    __paperApp.drawItem.removeSegments();
    __paperApp.drawItem.addSegments(tmp.segments);
    tmp.remove();
    __paperApp.drawItem.closed = true;
  };
  rectTool.onMouseUp = () => {
    __paperApp.drawStart = null;
    __paperApp.drawItem = null;
  };
  __paperApp.tools.set("rect", rectTool);

  // --- Ellipse ---
  const ellipseTool = new scope.Tool();
  ellipseTool.onMouseDown = (e) => {
    __paperApp.drawStart = e.point;
    const r = new scope.Rectangle(e.point, e.point);
    __paperApp.drawItem = applyDefaultStyle(new scope.Path.Ellipse(r));
  };
  ellipseTool.onMouseDrag = (e) => {
    if (!__paperApp.drawStart || !__paperApp.drawItem) return;
    const r = new scope.Rectangle(__paperApp.drawStart, e.point);
    const tmp = new scope.Path.Ellipse(r);
    __paperApp.drawItem.removeSegments();
    __paperApp.drawItem.addSegments(tmp.segments);
    tmp.remove();
    __paperApp.drawItem.closed = true;
  };
  ellipseTool.onMouseUp = () => {
    __paperApp.drawStart = null;
    __paperApp.drawItem = null;
  };
  __paperApp.tools.set("ellipse", ellipseTool);

  // --- Circle ---
  const circleTool = new scope.Tool();
  circleTool.onMouseDown = (e) => {
    __paperApp.drawStart = e.point;
    __paperApp.drawItem = applyDefaultStyle(new scope.Path.Circle(e.point, 1));
  };
  circleTool.onMouseDrag = (e) => {
    if (!__paperApp.drawStart || !__paperApp.drawItem) return;
    const radius = e.point.getDistance(__paperApp.drawStart);
    const tmp = new scope.Path.Circle(__paperApp.drawStart, Math.max(1, radius));
    __paperApp.drawItem.removeSegments();
    __paperApp.drawItem.addSegments(tmp.segments);
    tmp.remove();
    __paperApp.drawItem.closed = true;
  };
  circleTool.onMouseUp = () => {
    __paperApp.drawStart = null;
    __paperApp.drawItem = null;
  };
  __paperApp.tools.set("circle", circleTool);

  // --- Erase ---
  const eraseTool = new scope.Tool();
  const tryEraseAt = (point) => {
    const item = hitTest(point);
    if (!item) return;
    if (item === scope.project.activeLayer) return;
    item.remove();
  };
  eraseTool.onMouseDown = (e) => tryEraseAt(e.point);
  eraseTool.onMouseDrag = (e) => tryEraseAt(e.point);
  __paperApp.tools.set("erase", eraseTool);
}

/* =======================
   SVG import / clear
   ======================= */

async function importSvgFromUrl() {
  const scope = __paperApp.scope;
  if (!scope) return;

  const url = prompt(t("app.pjs.legacy.svg_url_prompt"));
  if (!url) return;

  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const svgText = await r.text();

    scope.project.importSVG(svgText, {
      expandShapes: true,
      onLoad: (item) => {
        const vb = scope.view.bounds.clone();
        vb.width *= 0.92;
        vb.height *= 0.92;

        if (item?.bounds && !item.bounds.isEmpty()) {
          item.fitBounds(vb);
          item.position = scope.view.center;
        }
        scope.view.update();
      },
      onError: (err) => {
        console.error("importSVG error:", err);
        alert(t("app.pjs.legacy.svg_import_failed"));
      },
    });
  } catch (e) {
    console.error(e);
    alert(t("app.pjs.legacy.svg_download_failed"));
  }
}

function clearPaperProject() {
  const scope = __paperApp.scope;
  if (!scope) return;
  scope.project.activeLayer.removeChildren();
  scope.project.activeLayer.selected = false;
  __paperApp.selectedItem = null;
  scope.view.update();
}
