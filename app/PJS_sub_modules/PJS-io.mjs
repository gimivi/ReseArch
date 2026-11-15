// APP/PJS_sub_modules/PJS-io.mjs
import { getState, setDirty } from "./PJS-core.mjs";

function isUiLayer(layer) {
  return !!layer && (layer.name === "__ui__" || layer.data?.isUiLayer === true);
}

function defaultLayerStyle() {
  return {
    strokeColor: "#000000",
    fillColor: "transparent",
    strokeWidth: 1,
    lineType: "continuous",
    dashArray: []
  };
}

function ensureUiLayerRoot(st) {
  st.scope.activate();

  let ui = st.scope.project.layers.find(l => isUiLayer(l));
  if (!ui) {
    ui = new st.scope.Layer();
  }

  ui.name = "__ui__";
  ui.data = ui.data || {};
  ui.data.isUiLayer = true;
  ui.visible = true;
  ui.locked = false;

ui.applyMatrix = false;

try {
  ui.matrix.reset();
  if (st._osdMatrix?.inverted) {
    ui.matrix.append(st._osdMatrix.inverted());
  }
} catch {
  try { ui.matrix.reset(); } catch {}
}

  try { ui.bringToFront?.(); } catch {}
  st._uiLayer = ui;
  return ui;
}

function getProjectGeometryLayers(st) {
  return (st.scope.project.layers || []).filter(pl => !isUiLayer(pl));
}

export function exportEnvelope(bodyEl) {
  const st = getState(bodyEl);
  st.scope.activate();

  const env = structuredClone(st._env || {}); // manteniamo meta/workspace/layers
  env.paper = env.paper || {};

  // __ui__ non deve mai essere persistito nel disegno.
  const ui = st.scope.project.layers.find(l => isUiLayer(l));
  const hadUi = !!ui;
  try {
    if (ui) ui.remove();
    env.paper.projectJSON = st.scope.project.exportJSON({ asString: false });
  } finally {
    if (hadUi) ensureUiLayerRoot(st);
    st.scope.view.update?.();
  }

  // Aggiorna timestamps
  const now = new Date().toISOString();
  env.meta = env.meta || {};
  env.meta.updatedAt = now;
  if (!env.meta.createdAt) env.meta.createdAt = now;

  // Sicurezza: __ui__ non deve mai entrare nei layer logici persistiti
  if (Array.isArray(env.layers)) {
    env.layers = env.layers.filter(l => l?.name !== "__ui__" && l?.id !== "__UI__");
  }

  return env;
}

export function importEnvelope(bodyEl, env) {
  const st = getState(bodyEl);
  st.scope.activate();

  // salva env nello state per export successivo
  st._env = env || {};

  // importa project
  st.scope.project.clear();
  if (env?.paper?.projectJSON) {
    st.scope.project.importJSON(env.paper.projectJSON);
  }

  // __ui__ va SEMPRE riallineato dopo clear/importJSON
  ensureUiLayerRoot(st);

  // applica mapping layerId e stili layer-only
  normalizeLayers(bodyEl);
  applyLayerStyles(bodyEl);

  // lascia __ui__ sopra a tutto
  ensureUiLayerRoot(st);
  try { st.overlay?.sync?.(); } catch {}

console.log("IO AFTER IMPORT/SYNC", {
  viewMatrix: st.scope.view.matrix?.values,
  uiMatrix: st._uiLayer?.matrix?.values,
  uiName: st._uiLayer?.name,
  uiIndex: st.scope.project.layers.indexOf(st._uiLayer),
  layers: st.scope.project.layers.map(l => ({
    id: l._id,
    name: l.name
  }))
});






  setDirty(bodyEl, false);
}

export function restoreUiLayerAfterImport(st) {
  ensureUiLayerRoot(st);
  st._snapConstruction = [];
  st._snapMarker = null;
}

export function normalizeLayers(bodyEl) {
  const st = getState(bodyEl);
  const env = st._env || (st._env = {});

  // Assicura almeno un layer logico utente
  if (!Array.isArray(env.layers) || env.layers.length === 0) {
    env.layers = [{
      id: "L1",
      name: "Layer 01",
      visible: true,
      locked: false,
      style: defaultLayerStyle()
    }];
  }

  // __ui__ non deve mai apparire nei layer logici utente
  env.layers = env.layers.filter(l => l?.name !== "__ui__" && l?.id !== "__UI__");

  // Considera solo i layer Paper geometrici (esclude __ui__)
  const paperLayers = getProjectGeometryLayers(st);

  // Mappa Paper layers in ordine su env.layers se manca layerId
  for (let i = 0; i < paperLayers.length; i++) {
    const pl = paperLayers[i];
    if (!pl.data) pl.data = {};
    if (!pl.data.layerId) {
      const lid = `L${i + 1}`;
      pl.data.layerId = lid;
      if (!env.layers.find(x => x.id === lid)) {
        env.layers.push({
          id: lid,
          name: pl.name || `Layer ${String(i + 1).padStart(2, "0")}`,
          visible: true,
          locked: false,
          style: defaultLayerStyle()
        });
      }
    }
  }

  // Assicura item.layerId solo sui layer geometrici
  const fallbackLayerId = env.layers[0]?.id || "L1";
  for (const pl of paperLayers) {
    const lid = pl.data?.layerId || fallbackLayerId;
    pl.children?.forEach?.(it => {
      if (!it.data) it.data = {};
      if (!it.data.layerId) it.data.layerId = lid;
    });
  }

  // activeLayerId valido (su layer utente, mai __ui__)
  env.workspace = env.workspace || {};
  env.workspace.defaults = env.workspace.defaults || {};
  if (!env.workspace.defaults.activeLayerId || !env.layers.find(l => l.id === env.workspace.defaults.activeLayerId)) {
    env.workspace.defaults.activeLayerId = env.layers[0]?.id || "L1";
  }

  // workspace.snap defaults
  env.workspace.snap = env.workspace.snap || {
    enabled: true,
    tolerancePx: 8,
    types: { endpoint: true, midpoint: false, center: false, intersection: false }
  };

  // Garanzia finale: __ui__ esiste ma resta fuori dalla normalizzazione dei layer utente
  ensureUiLayerRoot(st);
}

export function applyLayerStyles(bodyEl) {
  const st = getState(bodyEl);
  const env = st._env || {};
  const layerMap = new Map((env.layers || []).map(l => [l.id, l]));

  // applica stile e visibilità/lock solo ai layer geometrici (mai __ui__)
  for (const pl of getProjectGeometryLayers(st)) {
    const lid = pl.data?.layerId;
    const L = layerMap.get(lid);
    if (!L) continue;

    pl.visible = !!L.visible;
    pl.locked = !!L.locked;

    const style = L.style || {};
    const dash = Array.isArray(style.dashArray) ? style.dashArray : [];
    pl.children?.forEach?.(it => {
      it.strokeColor = style.strokeColor || "#000000";
      it.fillColor = (style.fillColor && style.fillColor !== "transparent") ? style.fillColor : null;
      it.strokeWidth = Number(style.strokeWidth || 1);
      it.dashArray = dash;
    });
  }

  // __ui__ sempre disponibile, visibile e sopra a tutto
  ensureUiLayerRoot(st);
  st.scope.view.update?.();
}
