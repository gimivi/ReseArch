// APP/PJS_sub_modules/PJS-overlay.mjs
import { getState } from "./PJS-core.mjs";
import { snapReprojectUi } from "./PJS-snap.mjs";
import { refreshSelectionUI } from "./PJS-selection-ui.mjs";

/**
 * Paper.js overlay su OpenSeadragon con geometrie in IMAGE SPACE (project coords).
 *
 * Scelta architetturale:
 * - Gli oggetti Paper sono in image space.
 * - Applichiamo la trasformazione (image -> viewerElement px) alla *view* di Paper:
 *      scope.view.matrix = M
 * - Il layer __ui__ deve restare screen-space:
 *      uiLayer.matrix = M.inverted()
 *
 * Vantaggi:
 * - event.point dei tool è già in image space (nessuna conversione custom necessaria).
 * - niente instabilità dovuta al cambiare matrix dei layer durante drag.
 */

export function attachOverlay(bodyEl, viewer) {
  const state = getState(bodyEl);
  state.viewer = viewer;

  // Canvas overlay
  const canvas = document.createElement("canvas");
  canvas.className = "pjs-overlay-canvas";
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none"; // diventa "auto" solo quando tool attivo
  canvas.style.zIndex = "10";

  const container = viewer.container;
  container.style.position = "relative";
  container.appendChild(canvas);

  // Prevent browser context menu on RMB inside the viewer.
  // RMB is used as a CAD command gesture (exit/repeat), so the default menu is unwanted.
  const _onContextMenu = (e) => {
    e.preventDefault();
  };
  const _onMouseDown = (e) => {
    if (e.button === 2) e.preventDefault();
  };
  container.addEventListener("contextmenu", _onContextMenu, { passive: false });
  container.addEventListener("mousedown", _onMouseDown, { passive: false });

  // Setup PaperScope su questo canvas
  state.scope.activate();
  state.scope.setup(canvas);

  // UI layer screen-space
  ensureUiLayer(state);

  // Matrice corrente (image -> view px)
  state._osdMatrix = new state.scope.Matrix(); // identity

  function resizeCanvasToContainer() {
    const r = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const h = Math.max(1, Math.floor(r.height));
    canvas.width = w;
    canvas.height = h;
    state.scope.view.viewSize = new state.scope.Size(w, h);
  }

  function computeImageToViewMatrix() {
    const p0 = viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0));
    const pX = viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(1, 0));
    const pY = viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 1));

    const a = pX.x - p0.x;
    const b = pX.y - p0.y;
    const c = pY.x - p0.x;
    const d = pY.y - p0.y;

    // Paper.Matrix(a, c, b, d, tx, ty)
    const m = new state.scope.Matrix(a, c, b, d, p0.x, p0.y);

    // evita matrice singolare nelle fasi iniziali (viewer non pronto)
    const det = a * d - b * c;
    if (!isFinite(det) || Math.abs(det) < 1e-12) return state._osdMatrix;

    return m;
  }

function applyViewMatrix(m) {
  // 1) geometrie (project=image) -> view(px)
  state.scope.view.matrix = m;

  // 2) UI layer: screen-space (annulla la view-matrix)
  ensureUiLayer(state);

  try {
    const inv = m.inverted();
    state._uiLayer.applyMatrix = false;
    state._uiLayer.matrix.reset();
    state._uiLayer.matrix.append(inv);
  } catch {
    state._uiLayer.applyMatrix = false;
    state._uiLayer.matrix.reset();
  }

  state._uiLayer.visible = true;
  state._uiLayer.locked = false;
  state._uiLayer.opacity = 1;
  state._uiLayer.bringToFront?.();

  state._osdMatrix = m;
}
 function sync() {
  resizeCanvasToContainer();
  const m = computeImageToViewMatrix();
  applyViewMatrix(m);
  try { snapReprojectUi(bodyEl); } catch {}
  try { if (state.selectionCount > 0) refreshSelectionUI(state); } catch {}
  try { state._translateCmd?.refreshUi?.(); } catch {}
  try { state._rotateCmd?.refreshUi?.(); } catch {}
  try { state._scaleCmd?.refreshUi?.(); } catch {}

  state.scope.view.update();
}

  const onViewport = () => sync();

  viewer.addHandler("open", onViewport);
  viewer.addHandler("animation", onViewport);
  viewer.addHandler("resize", onViewport);
  viewer.addHandler("update-viewport", onViewport);

  sync();

  state.overlay = {
    canvas,
    sync,

    /**
     * Conversioni utili:
     * - viewPointToImagePoint: da pixel canvas a image space (project coords)
     * - imagePointToViewPoint: da image space a pixel canvas
     *
     * Nota: con view.matrix impostata, i tool possono usare direttamente event.point (image space).
     */
    viewPointToImagePoint(viewPt) {
      return state.scope.view.viewToProject(viewPt);
    },
    imagePointToViewPoint(imgPt) {
      return state.scope.view.projectToView(imgPt);
    },

    detach() {
      try {
        viewer.removeHandler("open", onViewport);
        viewer.removeHandler("animation", onViewport);
        viewer.removeHandler("resize", onViewport);
        viewer.removeHandler("update-viewport", onViewport);
      } catch {}
      try {
        container.removeEventListener("contextmenu", _onContextMenu);
        container.removeEventListener("mousedown", _onMouseDown);
      } catch {}
      try { canvas.remove(); } catch {}
    }
  };

  return state.overlay;
}

function ensureUiLayer(state) {
  let ui = state.scope.project.layers.find(l => l.name === "__ui__");
  if (!ui) {
    ui = new state.scope.Layer();
    ui.name = "__ui__";
    ui.data = ui.data || {};
    ui.data.isUiLayer = true;
  }

  ui.visible = true;
  ui.locked = false;
  ui.opacity = 1;
  ui.bringToFront?.();

  state._uiLayer = ui;
  return ui;
}


