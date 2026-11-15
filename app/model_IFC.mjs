// model_IFC.mjs
// Plugin specializzato per viewer BIM/IFC via @thatopen/components 3.6.0
// Contratto piattaforma: export default { renderBody, getToolbar, getLeftMenu, getRightMenu, destroy }
//
// Caricamento adattivo per estensione (da models[].mod_abs_url):
//   .frag  → caricamento diretto (fragments.core.load) — rapido, nessun WASM
//   .ifc   → conversione on-the-fly (OBC.IfcLoader + web-ifc WASM) — più lento ma nessuna pre-elaborazione
//
// Three.js: il bundle +esm di jsDelivr importa "/npm/three@0.186.1/+esm" (e alcuni addons);
// l'importmap di dashboard.php rimappa quegli URL sui file build/ della piattaforma,
// così IFC e TJS usano la STESSA istanza di Three. Aggiornando @thatopen o Three,
// controllare la versione di three che il bundle importa e allineare l'importmap.

import * as OBC from "https://cdn.jsdelivr.net/npm/@thatopen/components@3.6.0/+esm";
// components-front: misure (LengthMeasurement, AreaMeasurement) e RendererWith2D per le loro
// etichette CSS2D. Importa "/npm/@thatopen/components@3.6.0/+esm" = stessa istanza di OBC.
import * as OBCF from "https://cdn.jsdelivr.net/npm/@thatopen/components-front@3.6.0/+esm";
import * as THREE from "three";
import { t, te } from "./shared/i18n.mjs";
import { ifcLoadFlows } from "./IFC_sub_modules/IFC-flow-runner.mjs";
import { panelLevel } from "./shared/ui_level.mjs";

// ── Costanti ────────────────────────────────────────────────────────────────

const STATE_KEY  = "__IFC_RENDER_STATE__";
const ACTIVE_BODIES = new Set();

// Worker scaricato una sola volta per sessione (module-level cache).
// La versione deve corrispondere a @thatopen/components (stesso monorepo, stesso tag).
// GitHub Pages (engine_fragment/resources/worker.mjs) punta sempre all'ultimo commit
// e può essere incompatibile con una versione pinata di components → usare jsDelivr.
const WORKER_URL = "https://cdn.jsdelivr.net/npm/@thatopen/fragments@3.6.0/dist/Worker/worker.mjs";

// Versione web-ifc WASM: components/fragments 3.6.0 richiedono web-ifc >=0.0.77 (peerDependencies).
// Il bundle +esm importa web-ifc@0.0.78, ma il pacchetto 0.0.78 è incoerente: il JS chiama
// StreamMeshes con 4 argomenti, il suo web-ifc.wasm ne registra 3 ("BindingError ... expected 3").
// Quindi l'importmap di dashboard.php rimappa web-ifc@0.0.78/+esm → 0.0.77 e qui il WASM è 0.0.77:
// API JS e WASM devono essere SEMPRE della stessa versione.
// Non usare autoSetWasm: legge Components.release (fermo a "2.4.3" nel bundle) e sceglierebbe un web-ifc vecchio.
const WEB_IFC_VERSION = "0.0.77";
let _workerBlobUrl = null;        // stringa URL blob (dopo il primo fetch)
let _workerFetchPromise = null;   // Promise in volo (evita fetch concorrenti)

async function resolveWorkerUrl() {
  if (_workerBlobUrl) return _workerBlobUrl;
  if (!_workerFetchPromise) {
    _workerFetchPromise = fetch(WORKER_URL, { cache: "force-cache" })
      .then(r => {
        if (!r.ok) throw new Error(`Worker fetch ${r.status} ${r.statusText}`);
        return r.blob();
      })
      .then(blob => {
        _workerBlobUrl = URL.createObjectURL(
          new File([blob], "worker.mjs", { type: "text/javascript" })
        );
        return _workerBlobUrl;
      });
  }
  return _workerFetchPromise;
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function makeHost(bodyEl) {
  const host = document.createElement("div");
  host.dataset.ifcHost = "1";
  host.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  bodyEl.appendChild(host);
  return host;
}

function patchCanvas(host) {
  // SimpleRenderer crea il canvas dopo components.init() — lo patchiamo subito
  const canvas = host.querySelector("canvas");
  if (!canvas) return;
  canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;display:block;";
  canvas.addEventListener("wheel", e => e.preventDefault(), { passive: false });
}

// ── Lifecycle helpers ────────────────────────────────────────────────────────

function destroyBodyInstance(bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st || st.stopped) return;
  st.stopped = true;

  try { st.resizeObserver?.disconnect(); } catch {}
  try { clearTimeout(st.fragTimer); } catch {}
  try { st.listeners?.abort(); } catch {}
  try { st.components?.dispose(); } catch {}
  try { st.host?.remove(); } catch {}
  try { st.rpanel?.remove(); } catch {}

  // ripristina style bodyEl
  try {
    bodyEl.style.position = st.prevStyle.position;
    bodyEl.style.overflow = st.prevStyle.overflow;
  } catch {}

  try { delete bodyEl[STATE_KEY]; } catch {}
  ACTIVE_BODIES.delete(bodyEl);
}

// ── Utility estensione URL ───────────────────────────────────────────────────

function getUrlExt(url) {
  const clean = String(url || "").split("?")[0].split("#")[0];
  const dot   = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

// ── Fragment iteration (OBC 3.x può restituire Map o array) ─────────────────

function forEachFragment(fragments, fn) {
  const list = fragments?.list;
  if (!list) return;
  if (typeof list.forEach === "function") {
    list.forEach((model) => { try { fn(model); } catch {} });
  } else if (typeof list[Symbol.iterator] === "function") {
    for (const entry of list) {
      const model = Array.isArray(entry) ? entry[1] : entry;
      try { fn(model); } catch {}
    }
  }
}

// ── Camera: inquadra tutto ───────────────────────────────────────────────────
// Senza inquadratura la camera resta a (50,50,50) verso l'origine: il punto di rotazione
// può essere lontano dal modello e il trascinamento col tasto destro (truck, proporzionale
// alla distanza dal punto di rotazione) lo porta fuori vista.

function fitAll(st, animate = true) {
  const { fragments, world } = st;
  if (!fragments?.list?.size) return;
  const sphere = new THREE.Sphere();
  try {
    const box = new THREE.Box3();
    forEachFragment(fragments, m => { if (m?.box && !m.box.isEmpty()) box.union(m.box); });
    if (box.isEmpty()) return;
    box.getBoundingSphere(sphere);
  } catch { return; }
  const r = Math.max(sphere.radius, 0.01);
  // piani di ritaglio e distanze proporzionati al modello
  try {
    const cam = world.camera.three;
    cam.near = Math.min(Math.max(r / 5000, 0.01), 1);
    cam.far  = Math.max(5000, r * 50);
    cam.updateProjectionMatrix();
    const c = world.camera.controls;
    if ("maxDistance" in c) c.maxDistance = Math.max(1e6, r * 100);
  } catch {}
  try { world.camera.controls.fitToSphere(sphere, animate); } catch {}
}

// ── Selezione + proprietà ────────────────────────────────────────────────────

const SEL_MATERIAL = {
  customId: "ifc-selection",
  color: new THREE.Color("#fbbf24"),
  renderedFaces: 0,   // FRAGS.RenderedFaces.ONE
  opacity: 1,
  transparent: false,
};

// Dati dell'elemento: attributi + Pset/quantità (IsDefinedBy), materiali, contenitore spaziale.
// Le relazioni non elencate restano spente (DefinesOccurrence riporterebbe tutti gli elementi del Pset).
const ITEM_DATA_CONFIG = {
  attributesDefault: true,
  relationsDefault: { attributes: false, relations: false },
  relations: {
    IsDefinedBy:          { attributes: true,  relations: true  },
    DefinesOccurrence:    { attributes: false, relations: false },
    HasAssociations:      { attributes: true,  relations: false },
    ContainedInStructure: { attributes: true,  relations: false },
  },
};

// Eventi per i nodi dei flow (state.localEvents, letti da IFC/Events/*):
//   "select"        { guid, localId, category, name, modelId, source }  — source "user" | "flow"
//   "deselect"      { source }
//   "modelsLoaded"  { count, modelIds }
//   "cameraSettled" { position, target }
// L'App NON usa l'App Bus: il collegamento con gli altri pannelli si fa nel flow
// (IFC/Events/OnSelect → App Bus/Emitter, App Bus/Receiver → IFC/Selection/Select By Guid).

function dispatchLocal(st, name, detail) {
  try { st.localEvents?.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { console.warn("[IFC] event:", e); }
}

function selectionInfo(st) {
  const sel = st.selection;
  if (!sel) return null;
  const d = sel.data && !sel.data.__error ? sel.data : null;
  return {
    guid:     d?._guid?.value ?? d?.GlobalId?.value ?? null,
    localId:  sel.localId,
    category: d?._category?.value ?? null,
    name:     d?.Name?.value != null ? String(d.Name.value) : null,
    modelId:  sel.model.modelId,
  };
}

// silent: nessun evento "deselect" (usato quando subito dopo arriva una nuova selezione)
async function clearSelection(st, { source = "user", silent = false } = {}) {
  const sel = st.selection;
  st.selection = null;
  if (sel?.model) {
    try { await sel.model.resetHighlight([sel.localId]); } catch {}
    // l'elemento aveva un colore dato dal flow (IFC/Visibility/Color): lo rimette
    const colored = st.colorMap.get(`${sel.model.modelId}:${sel.localId}`);
    if (colored) { try { await sel.model.highlight([sel.localId], colored); } catch {} }
    try { await st.fragments.core.update(true); } catch {}
  }
  renderProps(st);
  markTreeSelection(st);
  if (!silent) applyXray(st);
  if (sel && !silent) dispatchLocal(st, "deselect", { source });
}

// source: "user" (clic, albero) | "flow" (nodo IFC/Selection/Select By Guid)
// fit:    inquadra l'elemento
async function selectItem(st, model, localId, { source = "user", fit = false } = {}) {
  if (st.selection?.model === model && st.selection?.localId === localId) {
    if (fit) fitItem(st, model, localId);
    return;
  }
  await clearSelection(st, { silent: true });
  st.selection = { model, localId, data: null };
  try { await model.highlight([localId], SEL_MATERIAL); } catch (e) { console.warn("[IFC] highlight:", e); }
  try { await st.fragments.core.update(true); } catch {}
  renderProps(st);   // intestazione subito, dati quando arrivano
  markTreeSelection(st);
  if (fit) fitItem(st, model, localId);
  try {
    const [data] = await model.getItemsData([localId], ITEM_DATA_CONFIG);
    if (st.selection?.model !== model || st.selection?.localId !== localId) return;   // selezione cambiata nel frattempo
    st.selection.data = data || {};
  } catch (e) {
    console.warn("[IFC] getItemsData:", e);
    if (st.selection) st.selection.data = { __error: e.message };
  }
  renderProps(st);
  applyXray(st);
  dispatchLocal(st, "select", { ...selectionInfo(st), source });
}

function fitItem(st, model, localId) {
  try { st.world.camera.fitToItems({ [model.modelId]: new Set([localId]) }); } catch (e) { console.warn("[IFC] fit:", e); }
}

// ── API per i nodi dei flow (state.flowApi → ctx.ifc in IFC-flow-runner.mjs) ──
// Tutti gli elementi si indicano con il GlobalId IFC (stringa) o con liste di GlobalId.

function flattenItemData(d) {
  const out = {};
  if (!d) return out;
  for (const [k, v] of Object.entries(d)) {
    if (!k.startsWith("_") && isAttr(v)) out[k] = v.value;
  }
  for (const rel of (Array.isArray(d.IsDefinedBy) ? d.IsDefinedBy : [])) {
    const sets = Array.isArray(rel.RelatingPropertyDefinition) ? rel.RelatingPropertyDefinition : [rel];
    for (const pset of sets) {
      const props = pset.HasProperties || pset.Quantities;
      if (!Array.isArray(props)) continue;
      const psName = String(pset.Name?.value ?? pset._category?.value ?? "Pset");
      for (const pr of props) {
        if (isAttr(pr?.Name)) out[`${psName}.${pr.Name.value}`] = propValue(pr) ?? null;
      }
    }
  }
  for (const c of (Array.isArray(d.ContainedInStructure) ? d.ContainedInStructure : [])) {
    const src = (Array.isArray(c.RelatingStructure) ? c.RelatingStructure[0] : null) || c;
    if (src?._category) { out.ContainedIn = src.Name?.value ?? null; out.ContainedInClass = src._category.value; }
  }
  const mats = (Array.isArray(d.HasAssociations) ? d.HasAssociations : [])
    .filter(m => m?._category).map(m => m.Name?.value ?? m.LayerSetName?.value).filter(Boolean);
  if (mats.length) out.Materials = mats.join(", ");
  return out;
}

function matchValue(actual, wanted, mode) {
  if (actual === null || actual === undefined || actual === "") return false;
  if (wanted === "" || wanted === null || wanted === undefined) return true;   // basta che esista
  const a = String(actual).toLowerCase(), w = String(wanted).toLowerCase();
  if (mode === "contains") return a.includes(w);
  const na = Number(actual), nw = Number(wanted);
  if (Number.isFinite(na) && Number.isFinite(nw) && String(wanted).trim() !== "") return na === nw;
  return a === w;
}

// Elementi di una classe IFC (vuota = tutti quelli con geometria)
async function idsOfCategory(model, category) {
  if (!category) return (await model.getItemsIdsWithGeometry()) || [];
  const res = await model.getItemsOfCategories([new RegExp(`^${escRe(category)}$`, "i")]);
  return Object.values(res || {}).flat();
}

// Ricerca: category (classe IFC, vuota = tutte le classi con geometria),
// attribute ("Name" oppure "Pset.Proprietà", vuoto = nessun filtro), value (vuoto = basta che esista),
// match "equals" | "contains". → Map(model → localId[])
async function findItems(st, { category = "", attribute = "", value = "", match = "equals" } = {}) {
  const out = new Map();
  const attr = String(attribute).trim();
  const usesPset = needsRelations(attr);
  for (const model of st.fragments.list.values()) {
    let ids = await idsOfCategory(model, String(category).trim());
    if (attr) {
      const keep = [];
      const cfg = usesPset ? ITEM_DATA_CONFIG : {
        attributesDefault: false, attributes: [attr],
        relationsDefault: { attributes: false, relations: false },
      };
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const data = await model.getItemsData(batch, cfg);
        data.forEach((d, j) => {
          const v = usesPset ? flattenItemData(d)[attr] : d?.[attr]?.value;
          if (matchValue(v, value, match)) keep.push(batch[j]);
        });
        if (st.stopped) return new Map();
      }
      ids = keep;
    }
    if (ids.length) out.set(model, ids);
  }
  return out;
}

// Campi ricavati da flattenItemData (relazioni), non attributi IFC: si leggono come i Pset
const DERIVED_KEYS = new Set(["ContainedIn", "ContainedInClass", "Materials"]);
const needsRelations = attr => attr.includes(".") || DERIVED_KEYS.has(attr);

// Chiave di raggruppamento: numeri arrotondati (3799.9999999 e 3800.0000001 sono lo stesso valore)
function valueKey(v) {
  const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  return Number.isFinite(n) ? { key: `n:${+n.toFixed(3)}`, value: +n.toFixed(3) } : { key: `s:${String(v)}`, value: v };
}

const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function makeFlowApi(st) {
  const models = () => [...st.fragments.list.values()];

  // GUID → { model, localId } (primo modello che lo contiene)
  async function find(guid) {
    if (!guid) return null;
    for (const model of models()) {
      let ids = [];
      try { ids = await model.getLocalIdsByGuids([String(guid)]); } catch {}
      const id = ids?.[0];
      if (id !== undefined && id !== null) return { model, localId: id };
    }
    return null;
  }

  // lista di GUID → Map(model → localId[])
  async function group(guids) {
    const list = (Array.isArray(guids) ? guids : []).map(String).filter(Boolean);
    const out = new Map();
    if (!list.length) return out;
    for (const model of models()) {
      let ids = [];
      try { ids = await model.getLocalIdsByGuids(list); } catch {}
      const found = (ids || []).filter(id => id !== undefined && id !== null);
      if (found.length) out.set(model, found);
    }
    return out;
  }

  return {
    get modelsLoaded() { return !!st.modelsLoaded; },
    modelIds: () => models().map(m => m.modelId),
    getSelection: () => selectionInfo(st),

    async selectByGuid(guid, { fit = false } = {}) {
      const f = await find(guid);
      if (!f) return false;
      await selectItem(st, f.model, f.localId, { source: "flow", fit });
      return true;
    },
    clearSelection: () => clearSelection(st, { source: "flow" }),

    // { properties: { attributo | "Pset.Proprietà": valore }, category, name, localId, modelId } | null
    async getProperties(guid) {
      const f = await find(guid);
      if (!f) return null;
      const [d] = await f.model.getItemsData([f.localId], ITEM_DATA_CONFIG);
      return {
        properties: flattenItemData(d),
        category:   d?._category?.value ?? null,
        name:       d?.Name?.value != null ? String(d.Name.value) : null,
        localId:    f.localId,
        modelId:    f.model.modelId,
      };
    },

    // Ricerca (vedi findItems): restituisce la lista dei GlobalId
    async find(params = {}) {
      const guids = [];
      for (const [model, ids] of await findItems(st, params)) {
        guids.push(...((await model.getGuidsByLocalIds(ids)) || []).filter(Boolean));
      }
      return guids;
    },

    // [{ category, count }] delle classi con geometria, tutti i modelli insieme
    async categories() {
      const counts = new Map();
      for (const model of models()) {
        const cats = (await model.getItemsWithGeometryCategories()) || [];
        for (const c of cats) counts.set(c ?? "—", (counts.get(c ?? "—") || 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([category, count]) => ({ category, count }));
    },

    // Albero spaziale: { name, category, localId, guid, children } — stessa idea di TJS/Scene/GetTree
    async spatialTree() {
      const trees = [];
      for (const model of models()) {
        const root = await model.getSpatialStructure();
        if (!root) continue;
        const ids = [];
        const collect = n => { if (hasLocalId(n)) ids.push(n.localId); (n.children || []).forEach(collect); };
        collect(root);
        const info = new Map();
        for (let i = 0; i < ids.length; i += 500) {
          const batch = ids.slice(i, i + 500);
          const [names, guids] = await Promise.all([fetchNames(model, batch), model.getGuidsByLocalIds(batch)]);
          batch.forEach((id, j) => info.set(id, { ...(names.get(id) || {}), guid: guids?.[j] ?? null }));
        }
        const conv = n0 => {
          const n = flatNode(n0);   // gruppi per classe con un solo elemento → l'elemento (come la finestra Albero)
          const m = hasLocalId(n) ? info.get(n.localId) : null;
          return {
            name:     m?.name || n.category || m?.cat || "",
            category: n.category || m?.cat || "",
            localId:  hasLocalId(n) ? n.localId : null,
            guid:     m?.guid ?? null,
            children: (n.children || []).map(conv),
          };
        };
        trees.push(conv(root));
      }
      if (trees.length === 1) return trees[0];
      return { name: "IFC", category: "", localId: null, guid: null, children: trees };
    },

    async setVisible(guids, visible) {
      for (const [model, ids] of await group(guids)) await setItemsVisible(st, model, ids, !!visible);
    },
    async isolate(guids) {
      const map = {};
      for (const [model, ids] of await group(guids)) map[model.modelId] = new Set(ids);
      await st.components.get(OBC.Hider).isolate(map);
    },
    showAll: () => showAll(st),
    async setCategoryVisible(category, visible) {
      for (const model of models()) await setItemsVisible(st, model, await idsOfCategory(model, category), !!visible);
      st.win.cats?.list.querySelectorAll(".ifc-cat-row").forEach(row => {
        if (row.querySelector("label")?.textContent === category) row.querySelector("input").checked = !!visible;
      });
    },

    // Colore dato dal flow; resta anche dopo una selezione/deselezione dell'elemento
    async color(guids, hex) {
      for (const [model, ids] of await group(guids)) await colorIds(st, model, ids, hex);
      await st.fragments.core.update(true);
      applyXray(st);
    },
    resetColors: () => resetColorsAll(st),

    // Raggi X: tutto trasparente tranne selezione ed elementi colorati
    setXray: on => setXray(st, on),
    get xray() { return !!st.xray; },

    // Colora per valore → legenda [{ value, color, count }]
    colorByValue: (category, attribute) => colorByValue(st, { category, attribute }),

    // Viste salvate (mod_spec.views del primo modello)
    listViews: () => st.views.map(v => ({ name: v.name, plan: v.plan ?? null })),
    async goToView(name) {
      const v = st.views.find(x => x.name === name);
      if (!v) return false;
      await goToView(st, v);
      return true;
    },

    fitAll: () => fitAll(st, true),
    async fitItems(guids) {
      const map = {};
      for (const [model, ids] of await group(guids)) map[model.modelId] = new Set(ids);
      if (Object.keys(map).length) await st.world.camera.fitToItems(map);
      return Object.keys(map).length > 0;
    },
    getView() {
      const c = st.world.camera.controls;
      const P = c.getPosition(new THREE.Vector3()), T = c.getTarget(new THREE.Vector3());
      return { position: { x: P.x, y: P.y, z: P.z }, target: { x: T.x, y: T.y, z: T.z } };
    },
    async setView(position, target, animate = true) {
      const c = st.world.camera.controls;
      await c.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, !!animate);
    },

    // Piano di sezione: point e normal {x,y,z}; resta visibile la parte verso cui punta la normale
    addPlane(point, normal) {
      const n = new THREE.Vector3(normal.x, normal.y, normal.z);
      if (n.lengthSq() < 1e-12) throw new Error("normal is a zero vector");
      return getClipper(st).createFromNormalAndCoplanarPoint(
        st.world, n.normalize(), new THREE.Vector3(point.x, point.y, point.z));
    },
    clearPlanes() { try { st.clipper?.deleteAll(); } catch {} },
    planesCount: () => st.clipper?.list?.size ?? 0,

    // Misure fatte nel pannello (strumenti Lunghezza e Area): valori in m e m²
    async getMeasures() {
      const vals = kind => [...(st.measurers[kind]?.list ?? [])]
        .map(m => Number(m?.value ?? m?.rawValue)).filter(Number.isFinite);
      const volumes = [];
      for (const v of (st.measurers.volume?.list ?? [])) {
        try { const n = Number(await v.getValue()); if (Number.isFinite(n)) volumes.push(n); } catch {}
      }
      return { lengths: vals("length"), areas: vals("area"), angles: vals("angle"), volumes };
    },
    clearMeasures() {
      for (const m of Object.values(st.measurers)) { try { m.cancelCreation?.(); m.list.clear(); } catch {} }
    },
    setOutlines: on => setOutlines(st, on),
    setOrtho: on => setOrtho(st, on),
    get ortho() { return !!st.ortho; },
  };
}

async function pickAt(st) {
  try {
    const hit = await st.raycaster.castRay();
    if (st.stopped) return null;
    return hit && hit.fragments && hit.localId != null ? hit : null;
  } catch (e) {
    console.warn("[IFC] pick:", e);
    return null;
  }
}

// ── Formattazione valori ──

const isAttr = v => v && typeof v === "object" && !Array.isArray(v) && "value" in v;

function fmtValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? t("common.yes") : t("common.no");
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toFixed(4));
  return String(v);
}

// Classe IFC così come la salva Fragments (es. "IFCWALLSTANDARDCASE")
function categoryLabel(cat) {
  return String(cat || "—");
}

// valore di una proprietà/quantità: NominalValue, LengthValue, AreaValue, VolumeValue, CountValue…
function propValue(p) {
  if (isAttr(p.NominalValue)) return p.NominalValue.value;
  for (const [k, v] of Object.entries(p)) {
    if (k.endsWith("Value") && isAttr(v)) return v.value;
  }
  return undefined;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function addRow(list, name, value) {
  const row = el("div", "ifc-prop-row");
  row.appendChild(el("span", "ifc-prop-k", name));
  const v = el("span", "ifc-prop-v", fmtValue(value));
  v.title = fmtValue(value);
  row.appendChild(v);
  list.appendChild(row);
}

function addSection(list, title) {
  const s = el("div", "tjs-rpanel-section", title);
  s.setAttribute("role", "heading");
  s.setAttribute("aria-level", "3");
  list.appendChild(s);
}

// ── Finestre della colonna destra (.tjs-rpanel, stesso stile delle finestre TJS) ──
// props = Proprietà, tree = Albero spaziale, cats = Categorie

const WINDOWS = {
  props: { icon: "bi-info-square", color: "#fbbf24", title: "app.ifc.props.title", btn: "btnIfcProps", render: s => renderProps(s) },
  tree:  { icon: "bi-diagram-3",   color: "#60a5fa", title: "app.ifc.tree.title",  btn: "btnIfcTree",  render: s => renderTree(s)  },
  cats:  { icon: "bi-funnel",      color: "#34d399", title: "app.ifc.cats.title",  btn: "btnIfcCats",  render: s => renderCats(s)  },
  plans: { icon: "bi-layers",      color: "#a78bfa", title: "app.ifc.plans.title", btn: "btnIfcPlans", render: s => renderPlans(s) },
  search:{ icon: "bi-search",      color: "#f472b6", title: "app.ifc.search.title",btn: "btnIfcSearch",render: s => renderSearch(s)},
  colorby:{ icon: "bi-palette2",   color: "#fb923c", title: "app.ifc.colorby.title", btn: "btnIfcColorBy", render: s => renderColorBy(s) },
  views: { icon: "bi-bookmark-star", color: "#38bdf8", title: "app.ifc.views.title", btn: "btnIfcViews", render: s => renderViews(s) },
};
const WINDOW_ORDER = Object.keys(WINDOWS);

function ensureWindow(st, key) {
  if (st.win[key]) return st.win[key];
  const def = WINDOWS[key];
  const item = el("div", "tjs-rpanel-item");
  item.dataset.ifcWin = key;
  item.setAttribute("role", "region");
  item.setAttribute("aria-label", t(def.title));
  item.innerHTML = `
    <div class="tjs-rpanel-hdr">
      <span class="tjs-rpanel-hdr-title">
        <i class="bi ${def.icon}" style="color:${def.color}" aria-hidden="true"></i> ${te(def.title)}
      </span>
      <div class="tjs-rpanel-hdr-btns">
        <button type="button" class="tjs-rpanel-hdr-btn" data-ifc="close"
                title="${te("common.close")}" aria-label="${te("common.close")}">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <div class="tjs-rpanel-list" data-ifc="list"></div>`;
  item.querySelector('[data-ifc="close"]').addEventListener("click", () => setWindowVisible(st, key, false));
  // ordine fisso nella colonna: Proprietà, Albero, Categorie
  const next = [...st.rpanel.children].find(n => WINDOW_ORDER.indexOf(n.dataset.ifcWin) > WINDOW_ORDER.indexOf(key));
  st.rpanel.insertBefore(item, next || null);
  const w = { el: item, list: item.querySelector('[data-ifc="list"]'), visible: false, built: false };
  if (key === "props") w.list.setAttribute("aria-live", "polite");
  st.win[key] = w;
  return w;
}

function setWindowVisible(st, key, on) {
  const w = on ? ensureWindow(st, key) : st.win[key];
  if (w) {
    w.visible = !!on;
    w.el.style.display = on ? "" : "none";   // .tjs-rpanel-item è display:flex: [hidden] non basta
  }
  st.rpanel.classList.toggle("is-active", Object.values(st.win).some(x => x?.visible));
  if (on) WINDOWS[key].render(st);
  syncToolbar(st);
}

function toggleWindow(st, key) {
  setWindowVisible(st, key, !st.win[key]?.visible);
}

function renderProps(st) {
  const w = st.win.props;
  if (!w?.visible) return;
  const list = w.list;
  list.replaceChildren();
  const sel = st.selection;
  if (!sel) {
    list.appendChild(el("div", "ifc-prop-empty", t("app.ifc.props.empty")));
    return;
  }
  const d = sel.data;
  if (!d) { list.appendChild(el("div", "ifc-prop-empty", t("app.ifc.props.loading"))); return; }
  if (d.__error) { list.appendChild(el("div", "ifc-prop-empty", t("app.ifc.props.error", { msg: d.__error }))); return; }

  // Identità
  addSection(list, t("app.ifc.props.identity"));
  addRow(list, t("app.ifc.props.class"), categoryLabel(d._category?.value));
  if (isAttr(d.Name))        addRow(list, "Name", d.Name.value);
  addRow(list, "GlobalId", d._guid?.value ?? d.GlobalId?.value);
  addRow(list, t("app.ifc.props.model"), sel.model?.modelId);
  addRow(list, "localId", sel.localId);

  // Attributi diretti
  const skip = new Set(["Name", "GlobalId"]);
  const attrs = Object.entries(d).filter(([k, v]) => !k.startsWith("_") && !skip.has(k) && isAttr(v));
  if (attrs.length) {
    addSection(list, t("app.ifc.props.attributes"));
    for (const [k, v] of attrs) addRow(list, k, v.value);
  }

  // Contenitore spaziale
  for (const c of (Array.isArray(d.ContainedInStructure) ? d.ContainedInStructure : [])) {
    const parent = Array.isArray(c.RelatingStructure) ? c.RelatingStructure[0] : null;
    const src = parent || c;
    if (!src?._category) continue;
    addSection(list, t("app.ifc.props.container"));
    addRow(list, categoryLabel(src._category.value), src.Name?.value);
  }

  // Pset e quantità
  for (const rel of (Array.isArray(d.IsDefinedBy) ? d.IsDefinedBy : [])) {
    const sets = [];
    // IFC: elemento → IfcRelDefinesByProperties → RelatingPropertyDefinition (Pset/Qto);
    // Fragments di solito collega direttamente il Pset: gestisco entrambe le forme
    if (Array.isArray(rel.RelatingPropertyDefinition)) sets.push(...rel.RelatingPropertyDefinition);
    else sets.push(rel);
    for (const pset of sets) {
      const props = pset.HasProperties || pset.Quantities;
      if (!Array.isArray(props)) continue;
      const rows = props.filter(p => isAttr(p?.Name));
      if (!rows.length) continue;
      addSection(list, String(pset.Name?.value ?? categoryLabel(pset._category?.value)));
      for (const p of rows) addRow(list, p.Name.value, propValue(p));
    }
  }

  // Materiali
  const mats = (Array.isArray(d.HasAssociations) ? d.HasAssociations : []).filter(m => m?._category);
  if (mats.length) {
    addSection(list, t("app.ifc.props.materials"));
    for (const m of mats) addRow(list, categoryLabel(m._category.value), m.Name?.value ?? m.LayerSetName?.value);
  }
}

// ── Visibilità ───────────────────────────────────────────────────────────────

async function setItemsVisible(st, model, ids, visible) {
  if (!ids.length) return;
  try { await model.setVisible(ids, visible); } catch (e) { console.warn("[IFC] setVisible:", e); }
  try { await st.fragments.core.update(true); } catch {}
}

// pulsanti occhio dell'albero e caselle delle categorie tornano a "visibile"
function resetVisibilityUI(st) {
  st.win.tree?.list.querySelectorAll('[data-ifc="eye"]').forEach(b => setEyeButton(b, true));
  st.win.cats?.list.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = true; });
}

async function showAll(st) {
  try { await st.components.get(OBC.Hider).set(true); } catch (e) { console.warn("[IFC] showAll:", e); }
  resetVisibilityUI(st);
  st.cmdUI?.update?.({ status: t("app.ifc.status.show_all") });
}

async function isolateSelection(st) {
  const sel = st.selection;
  if (!sel) { st.cmdUI?.update?.({ status: t("app.ifc.status.isolate_none") }); return; }
  // un contenitore (piano, spazio…) isola anche ciò che contiene
  let ids = [sel.localId];
  try { ids = ids.concat((await sel.model.getItemsChildren([sel.localId])) || []); } catch {}
  try {
    await st.components.get(OBC.Hider).isolate({ [sel.model.modelId]: new Set(ids) });
  } catch (e) { console.warn("[IFC] isolate:", e); }
  st.cmdUI?.update?.({ status: t("app.ifc.status.isolated", { n: ids.length }) });
}

// ── Albero spaziale ──────────────────────────────────────────────────────────

const TREE_PAGE = 300;   // figli mostrati per nodo (i livelli con migliaia di elementi restano leggibili)

const hasLocalId = n => n?.localId !== undefined && n?.localId !== null;

// Nome e classe IFC per gli id dati. Nella struttura spaziale di Fragments 3.x gli elementi
// hanno localId ma category vuota; i nodi di raggruppamento per classe hanno category e niente localId.
async function fetchNames(model, ids) {
  const out = new Map();   // localId → { name, cat }
  if (!ids.length) return out;
  try {
    const data = await model.getItemsData(ids, {
      attributesDefault: false,
      attributes: ["Name"],
      relationsDefault: { attributes: false, relations: false },
    });
    data.forEach((d, i) => {
      const n = d?.Name?.value;
      out.set(ids[i], {
        name: n !== undefined && n !== null && n !== "" ? String(n) : "",
        cat: d?._category?.value || "",
      });
    });
  } catch (e) { console.warn("[IFC] names:", e); }
  return out;
}

// Gruppo per classe con un solo elemento (IFCSITE (1) → "Default"): mostro direttamente l'elemento
function flatNode(n) {
  while (n && !hasLocalId(n) && n.category && n.children?.length === 1) n = n.children[0];
  return n;
}

function subtreeIds(node, out = []) {
  if (hasLocalId(node)) out.push(node.localId);
  for (const c of node.children || []) subtreeIds(c, out);
  return out;
}

function setEyeButton(btn, visible) {
  btn.dataset.visible = visible ? "1" : "0";
  btn.setAttribute("aria-pressed", String(!visible));
  btn.title = t(visible ? "app.ifc.tree.hide" : "app.ifc.tree.show");
  btn.setAttribute("aria-label", btn.title);
  btn.querySelector("i").className = visible ? "bi bi-eye" : "bi bi-eye-slash";
}

function buildTreeNode(st, model, node, depth, info) {
  const name = info?.name || "";
  const li = el("li");
  li.setAttribute("role", "treeitem");
  const kids = node.children || [];
  const row = el("div", "ifc-tree-row");
  row.style.paddingLeft = `${4 + depth * 12}px`;

  const tog = el("button", "ifc-tree-btn");
  tog.type = "button";
  tog.dataset.ifc = "tog";
  if (kids.length) {
    tog.innerHTML = '<i class="bi bi-chevron-right" aria-hidden="true"></i>';
    tog.setAttribute("aria-label", t("app.ifc.tree.expand"));
    li.setAttribute("aria-expanded", "false");
  } else {
    tog.disabled = true;
    tog.setAttribute("aria-hidden", "true");
    tog.tabIndex = -1;
  }
  row.appendChild(tog);

  const hasId = hasLocalId(node);
  const cat = node.category || info?.cat || "";
  const lbl = el("button", "ifc-tree-label");
  lbl.type = "button";
  lbl.appendChild(el("span", "ifc-tree-name", name || cat || (hasId ? `#${node.localId}` : "—")));
  if (name && cat) lbl.appendChild(el("span", "ifc-tree-cat", cat));
  if (!hasId && kids.length) lbl.appendChild(el("span", "ifc-tree-cat", `(${kids.length})`));
  lbl.title = [name, cat].filter(Boolean).join(" — ");
  lbl.dataset.modelId = model.modelId;
  if (hasId) {
    lbl.dataset.localId = String(node.localId);
    lbl.addEventListener("click", () => selectItem(st, model, node.localId));
  } else if (kids.length) {
    lbl.addEventListener("click", () => tog.click());
  }
  row.appendChild(lbl);

  const eye = el("button", "ifc-tree-btn");
  eye.type = "button";
  eye.dataset.ifc = "eye";
  eye.innerHTML = '<i class="bi bi-eye" aria-hidden="true"></i>';
  setEyeButton(eye, true);
  eye.addEventListener("click", async () => {
    const vis = eye.dataset.visible !== "1";
    // anche gli occhi dei figli già aperti seguono il padre
    li.querySelectorAll('[data-ifc="eye"]').forEach(b => setEyeButton(b, vis));
    await setItemsVisible(st, model, subtreeIds(node), vis);
  });
  row.appendChild(eye);
  li.appendChild(row);

  if (kids.length) {
    let childUl = null;
    tog.addEventListener("click", async () => {
      const open = li.getAttribute("aria-expanded") === "true";
      li.setAttribute("aria-expanded", String(!open));
      tog.setAttribute("aria-label", t(open ? "app.ifc.tree.expand" : "app.ifc.tree.collapse"));
      tog.querySelector("i").className = open ? "bi bi-chevron-right" : "bi bi-chevron-down";
      if (open) { if (childUl) childUl.style.display = "none"; return; }
      if (childUl) { childUl.style.display = ""; return; }
      childUl = el("ul", "ifc-tree");
      childUl.setAttribute("role", "group");
      li.appendChild(childUl);
      const page = kids.slice(0, TREE_PAGE).map(flatNode);
      const names = await fetchNames(model, page.filter(hasLocalId).map(k => k.localId));
      if (st.stopped) return;
      const parentHidden = eye.dataset.visible !== "1";
      for (const k of page) {
        const child = buildTreeNode(st, model, k, depth + 1, names.get(k.localId));
        if (parentHidden) child.querySelectorAll('[data-ifc="eye"]').forEach(b => setEyeButton(b, false));
        childUl.appendChild(child);
      }
      if (kids.length > TREE_PAGE) {
        const more = el("li", "ifc-tree-more", t("app.ifc.tree.more", { n: kids.length - TREE_PAGE }));
        more.style.paddingLeft = `${16 + (depth + 1) * 12}px`;
        childUl.appendChild(more);
      }
      markTreeSelection(st);
    });
  }
  return li;
}

function markTreeSelection(st) {
  const list = st.win.tree?.list;
  if (!list) return;
  list.querySelectorAll(".ifc-tree-label.is-selected").forEach(b => {
    b.classList.remove("is-selected");
    b.removeAttribute("aria-current");
  });
  const sel = st.selection;
  if (!sel) return;
  const b = list.querySelector(
    `.ifc-tree-label[data-model-id="${CSS.escape(sel.model.modelId)}"][data-local-id="${sel.localId}"]`);
  if (b) { b.classList.add("is-selected"); b.setAttribute("aria-current", "true"); }
}

async function renderTree(st) {
  const w = st.win.tree;
  if (!w?.visible) return;
  if (w.built) { markTreeSelection(st); return; }
  w.built = true;
  w.list.replaceChildren(el("div", "ifc-prop-empty", t("app.ifc.props.loading")));
  const ul = el("ul", "ifc-tree");
  ul.setAttribute("role", "tree");
  ul.setAttribute("aria-label", t("app.ifc.tree.title"));
  const models = [...st.fragments.list.values()];
  for (const model of models) {
    let root = null;
    try { root = await model.getSpatialStructure(); } catch (e) { console.warn("[IFC] spatial:", e); }
    if (st.stopped) return;
    if (!root || (!root.children && !hasLocalId(root))) continue;
    if (models.length > 1) {
      // più modelli: un nodo col nome del modello sopra la sua radice
      ul.appendChild(buildTreeNode(st, model, { category: "", children: [root] }, 0, { name: model.modelId, cat: "" }));
    } else {
      const top = flatNode(root);
      const names = await fetchNames(model, hasLocalId(top) ? [top.localId] : []);
      ul.appendChild(buildTreeNode(st, model, top, 0, names.get(top.localId)));
    }
  }
  w.list.replaceChildren(ul.children.length ? ul : el("div", "ifc-prop-empty", t("app.ifc.tree.empty")));
  // apre i livelli con un solo figlio (Progetto → Sito → Edificio…) fino ai piani
  let level = [...ul.children];
  for (let d = 0; d < 6 && level.length === 1; d++) {
    const tog = level[0].querySelector(':scope > .ifc-tree-row > [data-ifc="tog"]:not([disabled])');
    if (!tog) break;
    tog.click();
    await new Promise(r => setTimeout(r, 0));
    const sub = level[0].querySelector(":scope > ul");
    // il click è asincrono (nomi dal worker): aspetta che i figli compaiano
    for (let i = 0; i < 50 && sub && !sub.children.length; i++) await new Promise(r => setTimeout(r, 40));
    level = sub ? [...sub.children] : [];
  }
}

// ── Categorie ────────────────────────────────────────────────────────────────

async function renderCats(st) {
  const w = st.win.cats;
  if (!w?.visible || w.built) return;
  w.built = true;
  w.list.replaceChildren(el("div", "ifc-prop-empty", t("app.ifc.props.loading")));
  const byCat = new Map();   // categoria → [{ model, ids }]
  for (const model of st.fragments.list.values()) {
    try {
      // due elenchi allineati: id degli elementi con geometria e loro categoria
      const ids  = await model.getItemsIdsWithGeometry();
      const cats = await model.getItemsWithGeometryCategories();
      const local = new Map();
      ids.forEach((id, i) => {
        const c = cats[i] ?? "—";
        if (!local.has(c)) local.set(c, []);
        local.get(c).push(id);
      });
      for (const [c, list] of local) {
        if (!byCat.has(c)) byCat.set(c, []);
        byCat.get(c).push({ model, ids: list });
      }
    } catch (e) { console.warn("[IFC] categories:", e); }
    if (st.stopped) return;
  }
  if (!byCat.size) { w.list.replaceChildren(el("div", "ifc-prop-empty", t("app.ifc.cats.empty"))); return; }

  const box = el("div");
  const bar = el("div", "ifc-cats-bar");
  const mkBar = (label, vis) => {
    const b = el("button", "tjs-rpanel-addbar-btn", label);
    b.type = "button";
    b.addEventListener("click", async () => {
      box.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = vis; });
      for (const parts of byCat.values()) for (const p of parts) await setItemsVisible(st, p.model, p.ids, vis);
    });
    return b;
  };
  bar.append(mkBar(t("app.ifc.cats.all"), true), mkBar(t("app.ifc.cats.none"), false));
  box.appendChild(bar);

  const fs = el("fieldset", "ifc-cats");
  fs.appendChild(el("legend", "visually-hidden", t("app.ifc.cats.title")));
  let n = 0;
  for (const c of [...byCat.keys()].sort()) {
    const parts = byCat.get(c);
    const count = parts.reduce((a, p) => a + p.ids.length, 0);
    const id = `ifcCat_${st.uid}_${n++}`;
    const row = el("div", "ifc-prop-row ifc-cat-row");
    const cb = el("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.checked = true;
    cb.addEventListener("change", async () => {
      for (const p of parts) await setItemsVisible(st, p.model, p.ids, cb.checked);
    });
    const lab = el("label", "ifc-prop-k", categoryLabel(c));
    lab.htmlFor = id;
    lab.title = categoryLabel(c);
    row.append(cb, lab, el("span", "ifc-prop-v ifc-cat-count", String(count)));
    fs.appendChild(row);
  }
  box.appendChild(fs);
  w.list.replaceChildren(box);
}

// ── Piante per piano (OBC.Views) ─────────────────────────────────────────────
// Una vista dall'alto per ogni IfcBuildingStorey (taglio 0,25 m sopra il livello del piano),
// con camera ortogonale propria. "Vista 3D" torna alla camera normale.

async function renderPlans(st) {
  const w = st.win.plans;
  if (!w?.visible) return;
  if (!w.built) {
    w.built = true;
    w.list.replaceChildren(el("div", "ifc-prop-empty", t("app.ifc.props.loading")));
    await ensurePlans(st);
    if (st.stopped) return;
  }
  const box = el("div", "ifc-plans");
  const mk = (id, label) => {
    const b = el("button", "ifc-tree-label ifc-plan-btn", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(st.openPlan === id));
    if (st.openPlan === id) b.classList.add("is-selected");
    b.addEventListener("click", () => openPlan(st, id));
    return b;
  };
  box.appendChild(mk(null, t("app.ifc.plans.view3d")));
  if (!st.plans?.length) box.appendChild(el("div", "ifc-prop-empty", t("app.ifc.plans.empty")));
  for (const v of st.plans || []) box.appendChild(mk(v.id, String(v.id)));
  w.list.replaceChildren(box);
}

async function openPlan(st, id) {
  const views = st.components.get(OBC.Views);
  try {
    if (id == null) views.close();
    else {
      views.open(id);
      // inquadra il modello nella pianta (camera ortogonale della vista)
      const sphere = new THREE.Sphere();
      const bb = new THREE.Box3();
      forEachFragment(st.fragments, m => { if (m?.box && !m.box.isEmpty()) bb.union(m.box); });
      if (!bb.isEmpty()) { bb.getBoundingSphere(sphere); await st.world.camera.controls.fitToSphere(sphere, false); }
    }
    st.openPlan = id ?? null;
    st.cmdUI?.update?.({ status: id == null ? t("app.ifc.status.plan_closed") : t("app.ifc.status.plan_open", { name: id }) });
  } catch (e) {
    console.warn("[IFC] plan:", e);
  }
  try { await st.fragments.core.update(true); } catch {}
  renderPlans(st);
}

// ── Colori dati dal flow / da Cerca / da Colora per valore ───────────────────
// Restano anche dopo selezione e deselezione (state.colorMap), si tolgono con resetColorsAll.

function colorMaterial(hex) {
  return { customId: `ifc-color-${hex}`, color: new THREE.Color(hex), renderedFaces: 0, opacity: 1, transparent: false };
}

async function colorIds(st, model, ids, hex) {
  const mat = colorMaterial(hex);
  const sel = st.selection?.model === model ? st.selection.localId : null;
  const apply = ids.filter(id => id !== sel);   // la selezione resta gialla
  ids.forEach(id => st.colorMap.set(`${model.modelId}:${id}`, mat));
  if (apply.length) await model.highlight(apply, mat);
}

async function resetColorsAll(st) {
  st.colorMap.clear();
  for (const model of st.fragments.list.values()) { try { await model.resetHighlight(); } catch {} }
  const sel = st.selection;
  if (sel) { try { await sel.model.highlight([sel.localId], SEL_MATERIAL); } catch {} }
  await st.fragments.core.update(true);
  applyXray(st);
}

// ── Raggi X (Fragments: model.setGhostItems, trasparenza su GPU) ─────────────
// Attivi: tutto è trasparente tranne la selezione e gli elementi colorati.

async function applyXray(st) {
  if (st.stopped) return;
  for (const model of st.fragments.list.values()) {
    try {
      if (!st.xray) { model.clearGhost(); continue; }
      const keep = [];
      if (st.selection?.model === model) keep.push(st.selection.localId);
      const prefix = `${model.modelId}:`;
      for (const k of st.colorMap.keys()) if (k.startsWith(prefix)) keep.push(Number(k.slice(prefix.length)));
      await model.setGhostItems(keep, true);
    } catch (e) { console.warn("[IFC] xray:", e); }
  }
  try { await st.fragments.core.update(true); } catch {}
}

function setXray(st, on) {
  st.xray = !!on;
  applyXray(st);
  st.cmdUI?.update?.({ status: t(st.xray ? "app.ifc.status.xray_on" : "app.ifc.status.xray_off") });
  syncToolbar(st);
}

// ── Colora per valore ────────────────────────────────────────────────────────

// Colori distinguibili (Okabe-Ito + complementari), poi grigio per "altri valori"
const VALUE_PALETTE = ["#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00",
                       "#cc79a7", "#bcbd22", "#17becf", "#8c564b", "#e377c2", "#9467bd"];
const VALUE_MAX = 24;         // valori con un colore proprio; gli altri insieme
const OTHER_COLOR = "#9ca3af";

// → legenda [{ value, color, count, items: Map(model → localId[]) }] ordinata per valore
async function colorByValue(st, { category = "", attribute = "" } = {}) {
  const attr = String(attribute).trim();
  if (!attr) throw new Error("attribute is empty");
  const usesPset = needsRelations(attr);
  const cfg = usesPset ? ITEM_DATA_CONFIG : {
    attributesDefault: false, attributes: [attr], relationsDefault: { attributes: false, relations: false },
  };
  const groups = new Map();   // valore (stringa) → { value, items: Map(model → ids) }
  for (const model of st.fragments.list.values()) {
    const ids = await idsOfCategory(model, String(category).trim());
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const data = await model.getItemsData(batch, cfg);
      data.forEach((d, j) => {
        const v = usesPset ? flattenItemData(d)[attr] : d?.[attr]?.value;
        if (v === null || v === undefined || v === "") return;   // senza valore: non colorato
        const { key, value } = valueKey(v);
        if (!groups.has(key)) groups.set(key, { value, items: new Map() });
        const g = groups.get(key);
        if (!g.items.has(model)) g.items.set(model, []);
        g.items.get(model).push(batch[j]);
      });
      if (st.stopped) return [];
    }
  }
  const all = [...groups.values()];
  const numeric = all.length > 0 && all.every(g => Number.isFinite(Number(g.value)));
  all.sort((a, b) => numeric ? Number(a.value) - Number(b.value) : String(a.value).localeCompare(String(b.value)));
  const count = g => [...g.items.values()].reduce((a, ids) => a + ids.length, 0);

  let legend = all.slice(0, VALUE_MAX).map((g, i) => ({
    value: g.value, color: VALUE_PALETTE[i % VALUE_PALETTE.length], count: count(g), items: g.items,
  }));
  if (all.length > VALUE_MAX) {
    const items = new Map();
    for (const g of all.slice(VALUE_MAX)) for (const [m, ids] of g.items) items.set(m, [...(items.get(m) || []), ...ids]);
    legend.push({ value: null, other: all.length - VALUE_MAX, color: OTHER_COLOR, count: count({ items }), items });
  }
  await resetColorsAll(st);
  for (const g of legend) for (const [model, ids] of g.items) await colorIds(st, model, ids, g.color);
  await st.fragments.core.update(true);
  applyXray(st);
  return legend;
}

function renderColorBy(st) {
  const w = st.win.colorby;
  if (!w?.visible || w.built) return;
  w.built = true;
  const uid = `ifcC_${st.uid}`;
  const form = el("form", "ifc-form");
  form.innerHTML = `
    <label for="${uid}_cat">${te("app.ifc.search.category")}</label>
    <select id="${uid}_cat" data-f="category"><option value="">${te("app.ifc.search.all_classes")}</option></select>
    <label for="${uid}_attr">${te("app.ifc.colorby.attribute")}</label>
    <input id="${uid}_attr" data-f="attribute" type="text" list="${uid}_keys" placeholder="ObjectType · Pset_WallCommon.FireRating" autocomplete="off" required>
    <datalist id="${uid}_keys"></datalist>
    <div class="ifc-form-row">
      <button type="submit" class="tjs-rpanel-addbar-btn"><i class="bi bi-palette2" aria-hidden="true"></i>&nbsp;${te("app.ifc.colorby.run")}</button>
      <button type="button" class="tjs-rpanel-addbar-btn" data-f="reset"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>&nbsp;${te("app.ifc.search.reset")}</button>
    </div>
    <p class="ifc-form-hint">${te("app.ifc.colorby.hint")}</p>`;
  const status = el("div", "ifc-prop-empty");
  status.setAttribute("aria-live", "polite");
  const legendEl = el("ul", "ifc-legend");
  legendEl.setAttribute("aria-label", t("app.ifc.colorby.legend"));
  w.list.replaceChildren(form, status, legendEl);

  (async () => {
    try {
      const sel = form.querySelector('[data-f="category"]');
      for (const c of await st.flowApi.categories()) {
        const o = el("option", "", `${c.category} (${c.count})`);
        o.value = c.category;
        sel.appendChild(o);
      }
    } catch {}
  })();
  // suggerimenti: le chiavi dell'elemento selezionato (attributi e Pset)
  const fillKeys = async () => {
    const dl = form.querySelector("datalist");
    const info = selectionInfo(st);
    if (!info?.guid) return;
    try {
      const r = await st.flowApi.getProperties(info.guid);
      dl.replaceChildren(...Object.keys(r?.properties || {}).map(k => { const o = el("option"); o.value = k; return o; }));
    } catch {}
  };
  form.querySelector('[data-f="attribute"]').addEventListener("focus", fillKeys);

  let legend = [];
  let isolated = null;
  const renderLegend = () => {
    legendEl.replaceChildren();
    legend.forEach((g, i) => {
      const li = el("li", "ifc-legend-row");
      const b = el("button", "ifc-tree-label");
      b.type = "button";
      b.setAttribute("aria-pressed", String(isolated === i));
      if (isolated === i) b.classList.add("is-selected");
      const sw = el("span", "ifc-swatch");
      sw.style.background = g.color;
      sw.setAttribute("aria-hidden", "true");
      const label = g.value === null ? t("app.ifc.colorby.others", { n: g.other }) : fmtValue(g.value);
      b.append(sw, el("span", "ifc-tree-name", label), el("span", "ifc-tree-cat", String(g.count)));
      b.title = t("app.ifc.colorby.isolate_hint");
      b.addEventListener("click", async () => {
        if (isolated === i) { isolated = null; await showAll(st); }
        else {
          isolated = i;
          const map = {};
          for (const [m, ids] of g.items) map[m.modelId] = new Set(ids);
          await st.components.get(OBC.Hider).isolate(map);
        }
        renderLegend();
      });
      li.appendChild(b);
      legendEl.appendChild(li);
    });
  };

  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const f = k => form.querySelector(`[data-f="${k}"]`).value;
    status.textContent = t("app.ifc.search.running");
    legendEl.replaceChildren();
    isolated = null;
    try {
      legend = await colorByValue(st, { category: f("category"), attribute: f("attribute") });
    } catch (e) {
      status.textContent = t("app.ifc.props.error", { msg: e.message });
      return;
    }
    if (st.stopped) return;
    const total = legend.reduce((a, g) => a + g.count, 0);
    status.textContent = legend.length ? t("app.ifc.colorby.done", { n: legend.length, total }) : t("app.ifc.colorby.none");
    renderLegend();
  });
  form.querySelector('[data-f="reset"]').addEventListener("click", async () => {
    legend = []; isolated = null;
    legendEl.replaceChildren();
    status.textContent = "";
    await resetColorsAll(st);
    await showAll(st);
  });
}

// ── Viste salvate (mod_spec.views del primo modello dell'oggetto) ────────────
// { name, position:{x,y,z}, target:{x,y,z}, plan: <nome della pianta> | null }

function parseSpec(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

function specRow(st) {
  return (st.models || []).find(r => /\.(ifc|frag)$/i.test(String(r?.mod_abs_url || "").split(/[?#]/)[0])) || null;
}

function loadViews(st) {
  const views = parseSpec(specRow(st)?.mod_spec).views;
  return (Array.isArray(views) ? views : [])
    .filter(v => v && typeof v.name === "string" && v.position && v.target)
    .map(v => ({ name: v.name, position: v.position, target: v.target, plan: v.plan ?? null }));
}

async function ensurePlans(st) {
  if (st.plans) return st.plans;
  try {
    const views = st.components.get(OBC.Views);
    views.world = st.world;
    st.plans = await views.createFromIfcStoreys({ world: st.world });
  } catch (e) { console.warn("[IFC] plans:", e); st.plans = []; }
  return st.plans;
}

async function goToView(st, v) {
  if (v.plan) {
    const plans = await ensurePlans(st);
    if (plans.some(p => p.id === v.plan)) await openPlan(st, v.plan);
  } else if (st.openPlan) {
    await openPlan(st, null);
  }
  const c = st.world.camera.controls;
  await c.setLookAt(v.position.x, v.position.y, v.position.z, v.target.x, v.target.y, v.target.z, true);
  st.cmdUI?.update?.({ status: t("app.ifc.views.went", { name: v.name }) });
}

// Scrive una chiave nel mod_spec del primo modello (api/mod_spec_tool.php, come TJS); le altre chiavi restano.
// value undefined = toglie la chiave. → true se salvato
async function saveSpecKey(st, key, value) {
  const row = specRow(st);
  if (!row?.mod_id) { st.cmdUI?.update?.({ status: t("app.ifc.views.no_model") }); return false; }
  const spec = { ...parseSpec(row.mod_spec) };
  if (value === undefined) delete spec[key]; else spec[key] = value;
  try {
    const res = await fetch("api/mod_spec_tool.php", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ action: "save", mod_id: row.mod_id, mod_spec: spec }),
    });
    const data = await res.json().catch(() => null);
    if (data?.ok) { row.mod_spec = spec; return true; }
    st.cmdUI?.update?.({ status: t("app.ifc.views.error", { msg: data?.error || `HTTP ${res.status}` }) });
  } catch {
    st.cmdUI?.update?.({ status: t("errors.network") });
  }
  return false;
}

async function saveViews(st) {
  st.cmdUI?.update?.({ status: t("app.ifc.views.saving") });
  if (await saveSpecKey(st, "views", st.views.map(v => ({ ...v })))) {
    st.viewsDirty = false;
    st.cmdUI?.update?.({ status: t("app.ifc.views.saved", { n: st.views.length }) });
  }
  renderViews(st);
}

// ── Misure salvate (mod_spec.measures del primo modello) ─────────────────────
// { lengths: [{ start:[x,y,z], end:[x,y,z] }], areas: [{ points:[[x,y,z], …] }] } in metri

const r3 = n => Math.round(n * 1e4) / 1e4;   // 0,1 mm
const v3 = v => [r3(v.x), r3(v.y), r3(v.z)];

async function measuresToSpec(st) {
  const lengths = [...(st.measurers.length?.list ?? [])]
    .filter(l => l?.start && l?.end).map(l => ({ start: v3(l.start), end: v3(l.end) }));
  const areas = [...(st.measurers.area?.list ?? [])]
    .map(a => ({ points: [...(a?.points ?? [])].map(v3) })).filter(a => a.points.length >= 3);
  const angles = [...(st.measurers.angle?.list ?? [])]
    .filter(a => a?.start && a?.vertex && a?.end)
    .map(a => ({ start: v3(a.start), vertex: v3(a.vertex), end: v3(a.end) }));
  // volumi: gli elementi sommati, per GlobalId (validi anche se il modello viene riconvertito)
  const volumes = [];
  for (const v of (st.measurers.volume?.list ?? [])) {
    const guids = [];
    for (const [modelId, ids] of Object.entries(v?.items ?? {})) {
      const model = st.fragments.list.get(modelId);
      if (!model || !ids?.size) continue;
      try { guids.push(...((await model.getGuidsByLocalIds([...ids])) || []).filter(Boolean)); } catch {}
    }
    if (guids.length) volumes.push({ guids });
  }
  return { lengths, areas, angles, volumes };
}

async function saveMeasures(st) {
  const m = await measuresToSpec(st);
  const empty = !m.lengths.length && !m.areas.length && !m.angles.length && !m.volumes.length;
  st.cmdUI?.update?.({ status: t("app.ifc.measures.saving") });
  if (await saveSpecKey(st, "measures", empty ? undefined : m)) {
    st.cmdUI?.update?.({ status: empty ? t("app.ifc.measures.saved_none")
      : t("app.ifc.measures.saved", { l: m.lengths.length, a: m.areas.length, g: m.angles.length, v: m.volumes.length }) });
  }
}

// All'apertura: ricrea le misure salvate (stesso percorso delle misure fatte a mano: list.add)
async function restoreMeasures(st) {
  const m = parseSpec(specRow(st)?.mod_spec).measures;
  if (!m || typeof m !== "object") return;
  const V = a => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every(Number.isFinite)
    ? new THREE.Vector3(a[0], a[1], a[2]) : null;
  let n = 0;
  try {
    for (const l of (Array.isArray(m.lengths) ? m.lengths : [])) {
      const a = V(l?.start), b = V(l?.end);
      if (!a || !b) continue;
      getMeasurer(st, "length").list.add(new OBCF.Line(a, b));
      n++;
    }
    for (const ar of (Array.isArray(m.areas) ? m.areas : [])) {
      const pts = (Array.isArray(ar?.points) ? ar.points : []).map(V).filter(Boolean);
      if (pts.length < 3) continue;
      const area = new OBCF.Area();
      area.points.add(...pts);
      getMeasurer(st, "area").list.add(area);
      n++;
    }
    for (const an of (Array.isArray(m.angles) ? m.angles : [])) {
      const a = V(an?.start), b = V(an?.vertex), c = V(an?.end);
      if (!a || !b || !c) continue;
      const angle = new OBCF.Angle(a, b, c);
      angle.units = "deg";
      getMeasurer(st, "angle").list.add(angle);
      n++;
    }
    for (const vol of (Array.isArray(m.volumes) ? m.volumes : [])) {
      const guids = (Array.isArray(vol?.guids) ? vol.guids : []).map(String).filter(Boolean);
      if (!guids.length) continue;
      const items = {};
      for (const model of st.fragments.list.values()) {
        const ids = ((await model.getLocalIdsByGuids(guids)) || []).filter(id => id !== null && id !== undefined);
        if (ids.length) items[model.modelId] = new Set(ids);
      }
      if (!Object.keys(items).length) continue;
      const v = new OBCF.Volume(st.components);
      v.items = items;
      getMeasurer(st, "volume").list.add(v);
      n++;
    }
  } catch (e) { console.warn("[IFC] restore measures:", e); }
  if (n) st.cmdUI?.update?.({ status: t("app.ifc.measures.restored", { n }) });
}

// ── Piani di sezione salvati (mod_spec.planes del primo modello) ─────────────
// [{ point:[x,y,z], normal:[x,y,z] }]: punto del piano e direzione della parte che resta visibile.
// Si leggono da plane.three (THREE.Plane), che segue anche gli spostamenti fatti con le frecce.

async function savePlanes(st) {
  const planes = [...(st.clipper?.list?.values() ?? [])].map(pl => {
    const n = pl.three.normal, c = pl.three.coplanarPoint(new THREE.Vector3());
    return { point: v3(c), normal: [r3(n.x), r3(n.y), r3(n.z)] };
  });
  st.cmdUI?.update?.({ status: t("app.ifc.planes.saving") });
  if (await saveSpecKey(st, "planes", planes.length ? planes : undefined)) {
    st.cmdUI?.update?.({ status: planes.length ? t("app.ifc.planes.saved", { n: planes.length }) : t("app.ifc.planes.saved_none") });
  }
}

function restorePlanes(st) {
  const list = parseSpec(specRow(st)?.mod_spec).planes;
  if (!Array.isArray(list)) return;
  const ok = a => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every(Number.isFinite);
  let n = 0;
  for (const pl of list) {
    if (!ok(pl?.point) || !ok(pl?.normal)) continue;
    try {
      st.flowApi.addPlane({ x: pl.point[0], y: pl.point[1], z: pl.point[2] },
                          { x: pl.normal[0], y: pl.normal[1], z: pl.normal[2] });
      n++;
    } catch (e) { console.warn("[IFC] restore plane:", e); }
  }
  if (n) st.cmdUI?.update?.({ status: t("app.ifc.planes.restored", { n }) });
}

// ── Contorni (PostproductionRenderer, stile COLOR_PEN) e proiezione ──────────

function setOutlines(st, on) {
  st.outlines = !!on;
  try {
    const pp = st.world.renderer.postproduction;
    if (st.outlines) {
      pp.enabled = true;
      pp.style = OBCF.PostproductionAspect.COLOR_PEN;
    } else {
      pp.enabled = false;
    }
  } catch (e) { console.warn("[IFC] outlines:", e); }
  st.cmdUI?.update?.({ status: t(st.outlines ? "app.ifc.status.outlines_on" : "app.ifc.status.outlines_off") });
  syncToolbar(st);
}

async function setOrtho(st, on) {
  if (st.openPlan) { st.cmdUI?.update?.({ status: t("app.ifc.status.ortho_plan") }); return; }
  const cam = st.world.camera;
  if (!cam?.projection) return;
  try {
    await cam.projection.set(on ? "Orthographic" : "Perspective");
    st.ortho = cam.projection.current === "Orthographic";
    forEachFragment(st.fragments, m => m.useCamera(cam.three));
    await st.fragments.core.update(true);
  } catch (e) { console.warn("[IFC] projection:", e); }
  st.cmdUI?.update?.({ status: t(st.ortho ? "app.ifc.status.ortho_on" : "app.ifc.status.ortho_off") });
  syncToolbar(st);
}

function renderViews(st) {
  const w = st.win.views;
  if (!w?.visible) return;
  const uid = `ifcV_${st.uid}`;
  const canSave = panelLevel(st.bodyEl) >= 30;   // salvataggi nel mod_spec dal livello autore
  const form = el("form", "ifc-form");
  form.innerHTML = `
    <label for="${uid}_name">${te("app.ifc.views.name")}</label>
    <div class="ifc-form-row">
      <input id="${uid}_name" type="text" autocomplete="off" required>
      <button type="submit" class="tjs-rpanel-addbar-btn"><i class="bi bi-plus-lg" aria-hidden="true"></i>&nbsp;${te("app.ifc.views.add")}</button>
    </div>`;
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const name = form.querySelector("input").value.trim();
    if (!name) return;
    const v = { ...st.flowApi.getView(), name, plan: st.openPlan ?? null };
    const i = st.views.findIndex(x => x.name === name);
    if (i >= 0) st.views[i] = v; else st.views.push(v);   // stesso nome = aggiorna
    st.viewsDirty = true;
    renderViews(st);
  });
  const list = el("ul", "ifc-tree ifc-views");
  list.setAttribute("aria-label", t("app.ifc.views.title"));
  if (!st.views.length) list.appendChild(el("li", "ifc-prop-empty", t("app.ifc.views.empty")));
  st.views.forEach((v, i) => {
    const li = el("li", "ifc-tree-row");
    const go = el("button", "ifc-tree-label");
    go.type = "button";
    go.appendChild(el("span", "ifc-tree-name", v.name));
    if (v.plan) go.appendChild(el("span", "ifc-tree-cat", v.plan));
    go.addEventListener("click", () => goToView(st, v));
    const del = el("button", "ifc-tree-btn");
    del.type = "button";
    del.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
    del.title = t("app.ifc.views.remove", { name: v.name });
    del.setAttribute("aria-label", del.title);
    del.addEventListener("click", () => { st.views.splice(i, 1); st.viewsDirty = true; renderViews(st); });
    li.append(go, del);
    list.appendChild(li);
  });
  const nodes = [form, list];
  if (canSave) {
    const bar = el("div", "ifc-cats-bar");
    const save = el("button", "tjs-rpanel-addbar-btn");
    save.type = "button";
    save.innerHTML = '<i class="bi bi-cloud-upload" aria-hidden="true"></i>';
    save.appendChild(document.createTextNode("\u00a0" + t("app.ifc.views.save")));
    save.addEventListener("click", () => saveViews(st));
    bar.appendChild(save);
    if (st.viewsDirty) bar.appendChild(el("span", "ifc-form-hint", t("app.ifc.views.unsaved")));
    nodes.push(bar);
  } else if (st.viewsDirty) {
    nodes.push(el("p", "ifc-form-hint", t("app.ifc.views.memory_only")));
  }
  w.list.replaceChildren(...nodes);
}

// ── Cerca ────────────────────────────────────────────────────────────────────

const SEARCH_LIMIT = 300;   // righe mostrate; Isola e Colora valgono per tutti i risultati

async function renderSearch(st) {
  const w = st.win.search;
  if (!w?.visible || w.built) return;
  w.built = true;
  const uid = `ifcS_${st.uid}`;
  const form = el("form", "ifc-form");
  form.setAttribute("role", "search");
  form.innerHTML = `
    <label for="${uid}_cat">${te("app.ifc.search.category")}</label>
    <select id="${uid}_cat" data-f="category"><option value="">${te("app.ifc.search.all_classes")}</option></select>
    <label for="${uid}_attr">${te("app.ifc.search.attribute")}</label>
    <input id="${uid}_attr" data-f="attribute" type="text" placeholder="Name · Pset_WallCommon.FireRating" autocomplete="off">
    <label for="${uid}_val">${te("app.ifc.search.value")}</label>
    <div class="ifc-form-row">
      <select data-f="match" aria-label="${te("app.ifc.search.match")}">
        <option value="equals">${te("app.ifc.search.equals")}</option>
        <option value="contains">${te("app.ifc.search.contains")}</option>
      </select>
      <input id="${uid}_val" data-f="value" type="text" autocomplete="off">
    </div>
    <div class="ifc-form-row">
      <button type="submit" class="tjs-rpanel-addbar-btn"><i class="bi bi-search" aria-hidden="true"></i>&nbsp;${te("app.ifc.search.run")}</button>
    </div>`;
  const status = el("div", "ifc-prop-empty");
  status.setAttribute("aria-live", "polite");
  const actions = el("div", "ifc-cats-bar");
  const results = el("ul", "ifc-tree ifc-search-results");
  results.setAttribute("aria-label", t("app.ifc.search.results"));
  w.list.replaceChildren(form, status, actions, results);

  // classi per il menu
  try {
    const sel = form.querySelector('[data-f="category"]');
    for (const c of await st.flowApi.categories()) {
      const o = el("option", "", `${c.category} (${c.count})`);
      o.value = c.category;
      sel.appendChild(o);
    }
  } catch {}

  let found = new Map();   // ultimo risultato: model → localId[]
  const allMap = () => {
    const map = {};
    for (const [m, ids] of found) map[m.modelId] = new Set(ids);
    return map;
  };
  const mkAct = (label, icon, fn) => {
    const b = el("button", "tjs-rpanel-addbar-btn");
    b.type = "button";
    b.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
    b.appendChild(document.createTextNode(" " + label));
    b.addEventListener("click", fn);
    return b;
  };
  const colorIn = el("input");
  colorIn.type = "color";
  colorIn.value = "#f97316";
  colorIn.setAttribute("aria-label", t("app.ifc.search.color_pick"));

  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const f = k => form.querySelector(`[data-f="${k}"]`).value;
    status.textContent = t("app.ifc.search.running");
    results.replaceChildren();
    actions.replaceChildren();
    try {
      found = await findItems(st, { category: f("category"), attribute: f("attribute"), value: f("value"), match: f("match") });
    } catch (e) {
      status.textContent = t("app.ifc.props.error", { msg: e.message });
      return;
    }
    if (st.stopped) return;
    const total = [...found.values()].reduce((a, ids) => a + ids.length, 0);
    status.textContent = t("app.ifc.search.count", { n: total });
    if (!total) return;
    actions.append(
      mkAct(t("app.ifc.search.isolate"), "bi-bullseye", async () => {
        await st.components.get(OBC.Hider).isolate(allMap());
      }),
      mkAct(t("app.ifc.tb.fit"), "bi-arrows-fullscreen", () => {
        try { st.world.camera.fitToItems(allMap()); } catch {}
      }),
      colorIn,
      mkAct(t("app.ifc.search.color"), "bi-palette", async () => {
        const guids = [];
        for (const [m, ids] of found) guids.push(...((await m.getGuidsByLocalIds(ids)) || []).filter(Boolean));
        await st.flowApi.color(guids, colorIn.value);
      }),
      mkAct(t("app.ifc.search.reset"), "bi-arrow-counterclockwise", async () => {
        await st.flowApi.resetColors();
        await showAll(st);
      }),
    );
    // righe: nome e classe, clic = seleziona e inquadra
    let shown = 0;
    for (const [model, ids] of found) {
      const page = ids.slice(0, SEARCH_LIMIT - shown);
      if (!page.length) break;
      const names = await fetchNames(model, page);
      if (st.stopped) return;
      for (const id of page) {
        const info = names.get(id) || {};
        const li = el("li");
        const b = el("button", "ifc-tree-label");
        b.type = "button";
        b.appendChild(el("span", "ifc-tree-name", info.name || `#${id}`));
        if (info.cat) b.appendChild(el("span", "ifc-tree-cat", info.cat));
        b.addEventListener("click", () => selectItem(st, model, id, { fit: true }));
        li.appendChild(b);
        results.appendChild(li);
      }
      shown += page.length;
    }
    if (total > shown) results.appendChild(el("li", "ifc-tree-more", t("app.ifc.search.more", { n: total - shown })));
  });
}

// ── Salva come .frag ─────────────────────────────────────────────────────────
// I modelli aperti da .ifc (convertiti nel browser) si salvano come .frag nella stessa cartella e con lo
// stesso nome; all'apertura successiva il pannello usa il .frag se non è più vecchio dell'.ifc
// (cachedFragFor). Upload con ui/modal_uploads_tools.php: stessi permessi del caricamento file.

const UPLOAD_API = "ui/modal_uploads_tools.php";
const fragSibling = url => String(url).replace(/\.ifc(?=$|[?#])/i, ".frag");

async function headTime(url) {
  const r = await fetch(url, { method: "HEAD", cache: "no-store", credentials: "same-origin" });
  if (!r.ok) return null;
  const lm = Date.parse(r.headers.get("Last-Modified") || "");
  return { lm };
}

async function cachedFragFor(ifcUrl) {
  try {
    const fragUrl = fragSibling(ifcUrl);
    if (fragUrl === ifcUrl) return null;
    const [f, i] = await Promise.all([headTime(fragUrl), headTime(ifcUrl)]);
    if (!f) return null;
    // .ifc sostituito dopo il salvataggio del .frag → il .frag è vecchio
    if (i && Number.isFinite(i.lm) && Number.isFinite(f.lm) && f.lm < i.lm) return null;
    return fragUrl;
  } catch {
    return null;
  }
}

async function saveFrag(st) {
  const items = [...st.modelRows.values()].filter(e => e.sourceExt === "ifc" && !e.fromFrag);
  if (!items.length) { st.cmdUI?.update?.({ status: t("app.ifc.frag.nothing") }); return; }
  const rel = e => String(e.row.mod_filename || "").replace(/\\/g, "/").replace(/\.ifc$/i, ".frag");
  if (!window.confirm(t("app.ifc.frag.confirm", { files: items.map(rel).join("\n") }))) return;
  let ok = 0;
  for (const e of items) {
    const model = st.fragments.list.get(e.modelId);
    if (!model) continue;
    st.cmdUI?.update?.({ status: t("app.ifc.frag.saving", { name: rel(e) }) });
    try {
      const bytes = await model.getBuffer(false);
      const fd = new FormData();
      fd.append("file", new File([bytes], rel(e).split("/").pop(), { type: "application/octet-stream" }));
      fd.append("folder_id", String(e.row.mod_folder_id ?? ""));
      fd.append("relativePath", rel(e));
      const r = await fetch(UPLOAD_API, { method: "POST", body: fd, credentials: "same-origin" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) throw new Error(j?.error || `HTTP ${r.status}`);
      e.fromFrag = true;
      ok++;
    } catch (err) {
      console.warn("[IFC] save frag:", err);
      st.cmdUI?.update?.({ status: t("app.ifc.frag.error", { name: rel(e), msg: err.message }) });
      return;
    }
  }
  st.cmdUI?.update?.({ status: t("app.ifc.frag.saved", { n: ok }) });
}

// ── Strumenti del doppio clic: sezione e misure ─────────────────────────────
// Un solo strumento attivo alla volta (st.tool):
//   null      → doppio clic = punto di rotazione; clic = selezione
//   "clip"    → doppio clic su una faccia = nuovo piano di sezione (OBC.Clipper, trascinabile)
//   "length"  → doppio clic = primo punto, doppio clic = secondo punto (OBCF.LengthMeasurement)
//   "area"    → doppio clic su una faccia = area della faccia (OBCF.AreaMeasurement, mode "face")
// Con uno strumento attivo il clic non seleziona. Esc annulla la misura in corso,
// Canc con il mouse sopra una misura la toglie.

// Pulsanti a interruttore degli strumenti; le misure stanno nel menu "Misure" (#btnIfcMeasures)
const TOOL_BUTTONS = { clip: "btnIfcClip" };

// Misuratori di components-front e loro unità
// icon/label/title: voce del menu "Misure"
const MEASURE_KINDS = {
  length: { cls: () => OBCF.LengthMeasurement, units: "m",   icon: "bi-rulers",       label: "app.ifc.menu.length", title: "app.ifc.tb.length" },
  area:   { cls: () => OBCF.AreaMeasurement,   units: "m2",  icon: "bi-bounding-box", label: "app.ifc.menu.area",   title: "app.ifc.tb.area" },
  angle:  { cls: () => OBCF.AngleMeasurement,  units: "deg", icon: "bi-triangle",     label: "app.ifc.menu.angle",  title: "app.ifc.tb.angle" },
  volume: { cls: () => OBCF.VolumeMeasurement, units: "m3",  icon: "bi-box-seam",     label: "app.ifc.menu.volume", title: "app.ifc.tb.volume" },
};
const isMeasureTool = tool => !!MEASURE_KINDS[tool];

function getClipper(st) {
  if (!st.clipper) {
    st.clipper = st.components.get(OBC.Clipper);
    st.clipper.enabled = true;
  }
  return st.clipper;
}

function getMeasurer(st, kind) {
  if (!st.measurers[kind]) {
    const m = st.components.get(MEASURE_KINDS[kind].cls());
    m.world = st.world;
    m.color = new THREE.Color("#f97316");
    m.rounding = 2;
    m.units = MEASURE_KINDS[kind].units;
    if (kind === "area") m.mode = "face";
    m.enabled = false;
    st.measurers[kind] = m;
  }
  return st.measurers[kind];
}

function setTool(st, tool) {
  const next = st.tool === tool ? null : tool;   // stesso pulsante = spegne
  for (const [kind, m] of Object.entries(st.measurers)) {
    try { m.cancelCreation?.(); m.enabled = next === kind; } catch {}
  }
  if (isMeasureTool(next)) getMeasurer(st, next).enabled = true;
  st.tool = next;
  st.cmdUI?.update?.({ status: t(next ? "app.ifc.status.tool_" + next : "app.ifc.status.tool_off") });
  syncToolbar(st);
}

function clearClipPlanes(st) {
  try { st.clipper?.deleteAll(); } catch (e) { console.warn("[IFC] clipper:", e); }
  st.cmdUI?.update?.({ status: t("app.ifc.status.clip_cleared") });
}

function clearMeasures(st) {
  for (const m of Object.values(st.measurers)) {
    try { m.cancelCreation?.(); m.list.clear(); } catch (e) { console.warn("[IFC] measures:", e); }
  }
  st.cmdUI?.update?.({ status: t("app.ifc.status.measures_cleared") });
}

// ── Toolbar: stato dei pulsanti ──

function syncToolbar(st) {
  const root = st.toolbarRoot;
  if (!root?.querySelector) return;
  const set = (id, on) => {
    const btn = root.querySelector(`#${id}`);
    if (!btn) return;
    btn.classList.toggle("active", !!on);
    btn.setAttribute("aria-pressed", String(!!on));
  };
  for (const [key, def] of Object.entries(WINDOWS)) set(def.btn, st.win[key]?.visible);
  for (const [tool, id] of Object.entries(TOOL_BUTTONS)) set(id, st.tool === tool);
  // Menu "Misure": il pulsante prende l'icona dello strumento acceso, la voce attiva è segnata
  const mb = root.querySelector("#btnIfcMeasures");
  if (mb) {
    const kind = isMeasureTool(st.tool) ? MEASURE_KINDS[st.tool] : null;
    mb.classList.toggle("active", !!kind);
    const ic = mb.querySelector("i");
    if (ic) ic.className = `bi ${kind ? kind.icon : "bi-rulers"}`;
    const title = kind ? t("app.ifc.tb.measures_active", { tool: t(kind.label) }) : t("app.ifc.tb.measures");
    mb.title = title;
    mb.setAttribute("aria-label", title);
    mb.parentElement?.querySelectorAll(".dropdown-item").forEach(a => {
      const on = !!kind && a.title === t(kind.title);
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
  }
  set("btnIfcXray", st.xray);
  set("btnIfcOutlines", st.outlines);
  set("btnIfcOrtho", st.ortho);
}

// ── Mouse sul canvas: clic = selezione, doppio clic = punto di rotazione o piano di sezione ──

function installPointer(st) {
  const canvas = st.world.renderer.three.domElement;
  const opts = { signal: st.listeners.signal };
  let down = null;
  canvas.addEventListener("pointerdown", e => {
    down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  }, opts);
  canvas.addEventListener("pointerup", async e => {
    if (!down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 4) return;   // era una rotazione o il trascinamento di un piano
    if (st.tool) return;      // sezione/misure: il clic non seleziona
    const hit = await pickAt(st);
    if (st.stopped) return;
    if (hit) {
      if (!st.win.props?.visible) setWindowVisible(st, "props", true);
      await selectItem(st, hit.fragments, hit.localId);
    } else {
      await clearSelection(st);
    }
  }, opts);
  canvas.addEventListener("dblclick", async () => {
    try {
      if (st.tool === "clip")   { await getClipper(st).create(st.world); return; }
      if (st.tool === "length") { await getMeasurer(st, "length").create(); return; }
      if (st.tool === "area")   { await getMeasurer(st, "area").create(); return; }
      // angolo: tre doppi clic (inizio, vertice, fine)
      if (st.tool === "angle")  { await getMeasurer(st, "angle").create(); return; }
      // volume: doppio clic sugli elementi da sommare; doppio clic nel vuoto (o Invio) chiude
      if (st.tool === "volume") {
        const m = getMeasurer(st, "volume");
        if (await pickAt(st)) await m.create(); else m.endCreation();
        return;
      }
    } catch (e) { console.warn("[IFC] " + st.tool + ":", e); return; }
    const hit = await pickAt(st);
    if (!hit?.point || st.stopped) return;
    try { st.world.camera.controls.setOrbitPoint(hit.point.x, hit.point.y, hit.point.z); } catch {}
  }, opts);
  // Canc / Backspace con il mouse sopra una misura: la toglie
  let hover = false;
  canvas.addEventListener("pointerenter", () => { hover = true; }, opts);
  canvas.addEventListener("pointerleave", () => { hover = false; }, opts);
  window.addEventListener("keydown", e => {
    if (!hover || !isMeasureTool(st.tool)) return;
    if (e.target instanceof HTMLElement && e.target.closest("input,textarea,select,[contenteditable]")) return;
    if (e.key === "Enter" && st.tool === "volume") { try { st.measurers.volume?.endCreation(); } catch {} return; }
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    try { st.measurers[st.tool]?.delete(); } catch (e2) { console.warn("[IFC] delete measure:", e2); }
  }, opts);
}

// ── Plugin export ─────────────────────────────────────────────────────────────

export default {

  // ── renderBody ─────────────────────────────────────────────────────────────
  async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {

    // idempotente: pulisci eventuale istanza precedente sullo stesso bodyEl
    destroyBodyInstance(bodyEl);

    const prevStyle = { position: bodyEl.style.position, overflow: bodyEl.style.overflow };
    bodyEl.style.position = bodyEl.style.position || "relative";
    bodyEl.style.overflow = "hidden";

    const host = makeHost(bodyEl);

    cmdUI?.show({ status: te("app.ifc.status.init"), hints: "" });

    // ── OBC setup ─────────────────────────────────────────────────────────
    const components = new OBC.Components();
    const worlds     = components.get(OBC.Worlds);
    const world      = worlds.create();

    world.scene    = new OBC.SimpleScene(components);
    // PostproductionRenderer = RendererWith2D (etichette CSS2D delle misure) + contorni (postproduzione, spenta di default)
    world.renderer = new OBCF.PostproductionRenderer(components, host);
    // OrthoPerspectiveCamera = SimpleCamera + proiezione ortogonale (pulsante Ortogonale)
    world.camera   = new OBC.OrthoPerspectiveCamera(components);

    components.init();

    // camera clip planes (valori ragionevoli; non 1e9)
    try {
      const cam = world.camera.three;
      cam.near = 0.01;
      cam.far  = 5000;
      cam.updateProjectionMatrix();
    } catch {}

    // camera controls: zoom e pan più morbidi
    try {
      const c = world.camera.controls;
      if ("dollySpeed"    in c) c.dollySpeed    = 0.2;
      if ("truckSpeed"    in c) c.truckSpeed    = 0.2;
      if ("dollyToCursor" in c) c.dollyToCursor = false;
      if ("maxDistance"   in c) c.maxDistance   = 1e6;
      if ("minDistance"   in c) c.minDistance   = 0.05;
    } catch {}

    world.scene.setup();
    world.scene.three.background = null;
    patchCanvas(host);

    // ── Worker ────────────────────────────────────────────────────────────
    cmdUI?.update({ status: te("app.ifc.status.engine") });
    let workerUrl;
    try {
      workerUrl = await resolveWorkerUrl();
    } catch (e) {
      cmdUI?.update({ status: te("app.ifc.err.worker", { msg: e.message }) });
      destroyBodyInstance(bodyEl);
      return;
    }

    if (signal?.aborted) { destroyBodyInstance(bodyEl); return; }

    // ── FragmentsManager ──────────────────────────────────────────────────
    const fragments = components.get(OBC.FragmentsManager);
    fragments.init(workerUrl);

    // Z-fighting fix deterministico (indice progressivo, non Math.random)
    let _matIdx = 0;
    fragments.core.models.materials.list.onItemSet.add(({ value: mat }) => {
      if (!("isLodMaterial" in mat && mat.isLodMaterial)) {
        mat.polygonOffset       = true;
        mat.polygonOffsetUnits  = 1;
        mat.polygonOffsetFactor = (_matIdx++ % 4) + 1;
      }
    });

    // quando un fragment è pronto: aggiunge alla scena e aggiorna LOD
    fragments.list.onItemSet.add(({ value: model }) => {
      model.useCamera(world.camera.three);
      world.scene.three.add(model.object);
      fragments.core.update(true);
    });

    // ── Caricamento modelli ───────────────────────────────────────────────
    const modelRows = new Map();   // modelId → { row, modelId, sourceExt, fromFrag }
    const supportedModels = (Array.isArray(models) ? models : [])
      .filter(m => { const e = getUrlExt(m?.mod_abs_url); return e === "frag" || e === "ifc"; });

    if (supportedModels.length === 0) {
      cmdUI?.update({ status: te("app.ifc.no_files.@") });
    } else {
      // ── IfcLoader: preparato solo al primo .ifc da convertire ─────────
      let ifcLoaderPromise = null;
      const getIfcLoader = () => ifcLoaderPromise ??= (async () => {
        const ifcLoader = components.get(OBC.IfcLoader);
        console.log(`[IFC] IfcLoader setup — web-ifc WASM @ ${WEB_IFC_VERSION}`);
        await ifcLoader.setup({
          autoSetWasm: false,
          wasm: { path: `https://cdn.jsdelivr.net/npm/web-ifc@${WEB_IFC_VERSION}/`, absolute: true },
        });
        // Impostazioni di compatibilità per file IFC legacy (IFC2x3, heritage, ecc.)
        if (ifcLoader.settings?.webIfc) {
          ifcLoader.settings.webIfc.COORDINATE_TO_ORIGIN = true;
          ifcLoader.settings.webIfc.OPTIMIZE_PROFILES    = true;
        }
        // Dati BIM: in 3.x load() importa di default Pset, quantità, materiali e struttura
        // spaziale (Project/Site/Building/Storey); "includeProperties" non esiste più.
        return ifcLoader;
      })();

      if (signal?.aborted) { destroyBodyInstance(bodyEl); return; }

      cmdUI?.update({ status: te("app.ifc.status.loading_models.@", { n: supportedModels.length }) });
      let loaded = 0;

      await Promise.all(supportedModels.map(async (row) => {
        const url   = row.mod_abs_url;
        const ext   = getUrlExt(url);
        const label = row.mod_name || url.split("/").pop();
        const modelId = url.split("/").pop().replace(/\.(ifc|frag)$/i, "") || `model_${loaded}`;

        try {
          // .ifc con un .frag salvato accanto (pulsante "Salva come .frag") e non più vecchio:
          // si apre il .frag, senza conversione
          const cachedFrag = ext === "ifc" ? await cachedFragFor(url) : null;
          const res = await fetch(cachedFrag || url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          if (signal?.aborted) return;

          if (ext === "frag" || cachedFrag) {
            // ── percorso veloce: carica frammenti pre-convertiti ─────────
            await fragments.core.load(buffer, { modelId });
            if (cachedFrag) cmdUI?.update({ status: te("app.ifc.status.frag_cache", { label }) });

          } else if (ext === "ifc") {
            // ── percorso on-the-fly: converti IFC via web-ifc WASM ──────
            let ifcLoader = null;
            try { ifcLoader = await getIfcLoader(); } catch (e) { console.warn("[IFC] IfcLoader setup warning:", e); }
            if (!ifcLoader) throw new Error(t("app.ifc.err.no_loader"));
            // load(data, coordinate, name): converte IFC → Fragment e lo aggiunge tramite
            // l'evento fragments.list.onItemSet già registrato sopra.
            // name è obbligatorio di fatto: diventa il modelId nel worker (senza → modelId undefined).
            await ifcLoader.load(new Uint8Array(buffer), true, modelId);
          }

          modelRows.set(modelId, { row, modelId, sourceExt: ext, fromFrag: ext === "frag" || !!cachedFrag });
          loaded++;
          cmdUI?.update({ status: te("app.ifc.status.loaded_n", { n: loaded, total: supportedModels.length, label }) });

        } catch (e) {
          cmdUI?.update({ status: te("app.ifc.err.model", { label, msg: e.message }) });
          console.warn("[IFC] load error:", url, e);
        }
      }));

      cmdUI?.update({ status: loaded ? te("app.ifc.status.done") : te("app.ifc.status.none_loaded.@") });
    }

    if (signal?.aborted) { destroyBodyInstance(bodyEl); return; }

    await fragments.core.update(true);

    // ── Stato ─────────────────────────────────────────────────────────────
    const state = {
      stopped: false,
      host,
      components,
      fragments,
      world,
      resizeObserver: null,
      fragTimer: 0,
      prevStyle,
      listeners: new AbortController(),
      toolbarRoot: headerEl ?? panel,
      raycaster: components.get(OBC.Raycasters).get(world),
      rpanel: null,          // colonna destra (.tjs-rpanel)
      win: {},               // finestre della colonna: props, tree, cats → { el, list, visible, built }
      selection: null,       // { model, localId, data }
      clipper: null,         // OBC.Clipper, creato al primo piano di sezione
      localEvents: new EventTarget(),   // eventi per i nodi IFC/Events/* (vedi dispatchLocal)
      modelRows,             // modelId → riga del modello e formato di partenza (Salva come .frag)
      plans: null,           // viste di pianta (OBC.Views.createFromIfcStoreys), create alla prima apertura
      openPlan: null,        // id della pianta aperta, null = vista 3D
      xray: false,           // raggi X attivi (applyXray)
      views: [],             // viste salvate (mod_spec.views), caricate dopo la creazione dello stato
      viewsDirty: false,     // viste cambiate e non ancora salvate nel mod_spec
      outlines: false,       // contorni (postproduzione)
      ortho: false,          // proiezione ortogonale nella vista 3D
      flowApi: null,         // API per i nodi (makeFlowApi) → ctx.ifc
      colorMap: new Map(),   // "modelId:localId" → materiale dato da IFC/Visibility/Color
      modelsLoaded: true,    // a questo punto i modelli sono già caricati
      models: Array.isArray(models) ? models : [],
      modelsRoot: null,      // gruppo per i modelli aggiunti dai flow (TJS/Model/Load URL)
      bodyEl,
      object,
      tool: null,            // strumento del doppio clic: null | "clip" | "length" | "area"
      measurers: {},         // { length, area } creati al primo uso
      objId: object?.obj_id ?? null,
      cmdUI,
      uid: Math.random().toString(36).slice(2, 8),   // id univoci nel DOM (più pannelli IFC aperti)
    };
    bodyEl[STATE_KEY] = state;
    ACTIVE_BODIES.add(bodyEl);

    // Colonna destra per le finestre (stile condiviso con TJS, css/ReseArch.css §16)
    state.rpanel = document.createElement("div");
    state.rpanel.className = "tjs-rpanel";
    bodyEl.appendChild(state.rpanel);

    installPointer(state);
    fitAll(state, false);
    syncToolbar(state);

    // Flow dell'oggetto: API per i nodi IFC/*, radice per i modelli caricati dai nodi TJS
    state.flowApi = makeFlowApi(state);
    state.views = loadViews(state);
    restorePlanes(state);
    restoreMeasures(state).catch(e => console.warn("[IFC] restore measures:", e));
    state.modelsRoot = new THREE.Group();
    state.modelsRoot.name = "IFC_FLOW_MODELS_ROOT";
    world.scene.three.add(state.modelsRoot);
    world.camera.controls.addEventListener("rest", () => {
      if (state.stopped) return;
      try { dispatchLocal(state, "cameraSettled", state.flowApi.getView()); } catch {}
    });
    dispatchLocal(state, "modelsLoaded", { count: fragments.list.size, modelIds: state.flowApi.modelIds() });
    // senza await: il resto dell'avvio (resize, LOD) non aspetta la lettura dei flow dal server
    ifcLoadFlows(state, object, signal).catch(e => console.warn("[IFC] flow:", e));

    // ── Resize throttled ──────────────────────────────────────────────────
    let lastW = 0, lastH = 0, resizeRAF = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRAF) return;
      resizeRAF = requestAnimationFrame(() => {
        resizeRAF = 0;
        if (state.stopped) return;
        const r = host.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width));
        const h = Math.max(1, Math.round(r.height));
        if (w === lastW && h === lastH) return;
        lastW = w; lastH = h;
        try { world.renderer.update(); }   catch {}
        try { fragments.core.update(true); } catch {}
      });
    });
    resizeObserver.observe(host);
    state.resizeObserver = resizeObserver;

    // ── Fragment LOD update su fine gesto camera ──────────────────────────
    world.camera.controls.addEventListener("update", () => {
      clearTimeout(state.fragTimer);
      state.fragTimer = setTimeout(() => {
        if (state.stopped) return;
        try {
          forEachFragment(fragments, model => model.useCamera(world.camera.three));
          fragments.core.update(true);
        } catch {}
      }, 140);
    });

    // ── Render loop ───────────────────────────────────────────────────────
    // Nessun ciclo nostro: components.init() avvia già il suo (Components.update →
    // world.update(delta) → camera + renderer). Un secondo ciclo che chiamava
    // controls.update() SENZA delta rendeva NaN la camera nelle transizioni animate
    // (trascinamento col tasto destro = truck con smoothing) e il modello spariva.

    // ── AbortSignal cleanup ───────────────────────────────────────────────
    signal?.addEventListener("abort", () => destroyBodyInstance(bodyEl), { once: true });
  },

  // ── Menus / Toolbar ────────────────────────────────────────────────────────

  getLeftMenu({ object }) {
    return {
      title: object?.obj_name ?? "IFC",
      items: [],
    };
  },

  getRightMenu({ bodyEl }) {
    return {
      title: "☰",
      items: [
        // TODO: sezioni, filtro categoria IFC, selezione per GUID
      ],
    };
  },

  getToolbar({ panel, headerEl, bodyEl }) {
    const st = () => bodyEl?.[STATE_KEY];
    const run = fn => () => { const s = st(); if (s && !s.stopped) fn(s); };
    const btn = (id, icon, key, fn) => ({
      type: "button", id, iconClass: icon, className: "icon-only",
      title: t(key), attrs: { "aria-label": t(key) }, onClick: run(fn),
    });
    const toggleBtn = (id, icon, key, fn) => ({
      type: "button", id, iconClass: icon, className: "icon-only",
      title: t(key), attrs: { "aria-label": t(key), "aria-pressed": "false" }, onClick: run(fn),
    });
    // strumenti in memoria dal livello utente, salvataggi dal livello autore (_doc/arch-permessi.md §11.4)
    const lvl = (item, minLevel) => ({ ...item, minLevel });
    // voce di un menu a tendina: etichetta breve, titolo (descrizione) lungo
    const menuItem = (icon, labelKey, titleKey, fn) => ({ iconClass: icon, label: t(labelKey), title: t(titleKey), onClick: run(fn) });
    return {
      items: [
        {
          type: "button", id: "btnIfcFit", iconClass: "bi bi-arrows-fullscreen",
          className: "icon-only", title: t("app.ifc.tb.fit"), attrs: { "aria-label": t("app.ifc.tb.fit") },
          onClick: () => { const s = st(); if (s && !s.stopped) fitAll(s, true); },
        },
        { type: "divider" },
        toggleBtn("btnIfcProps", "bi bi-info-square", "app.ifc.tb.props", s => toggleWindow(s, "props")),
        toggleBtn("btnIfcTree",  "bi bi-diagram-3",   "app.ifc.tb.tree",  s => toggleWindow(s, "tree")),
        toggleBtn("btnIfcCats",  "bi bi-funnel",      "app.ifc.tb.cats",  s => toggleWindow(s, "cats")),
        toggleBtn("btnIfcPlans", "bi bi-layers",      "app.ifc.tb.plans", s => toggleWindow(s, "plans")),
        toggleBtn("btnIfcSearch","bi bi-search",      "app.ifc.tb.search",s => toggleWindow(s, "search")),
        toggleBtn("btnIfcColorBy","bi bi-palette2",   "app.ifc.tb.colorby", s => toggleWindow(s, "colorby")),
        toggleBtn("btnIfcViews", "bi bi-bookmark-star","app.ifc.tb.views", s => toggleWindow(s, "views")),
        toggleBtn("btnIfcXray",  "bi bi-transparency", "app.ifc.tb.xray",  s => setXray(s, !s.xray)),
        toggleBtn("btnIfcOutlines", "bi bi-pencil",     "app.ifc.tb.outlines", s => setOutlines(s, !s.outlines)),
        toggleBtn("btnIfcOrtho",  "bi bi-box",          "app.ifc.tb.ortho",  s => setOrtho(s, !s.ortho)),
        { type: "divider" },
        btn("btnIfcIsolate", "bi bi-bullseye", "app.ifc.tb.isolate", s => isolateSelection(s)),
        btn("btnIfcShowAll", "bi bi-eye",      "app.ifc.tb.show_all", s => showAll(s)),
        { type: "divider" },
        lvl(toggleBtn("btnIfcClip", "bi bi-scissors", "app.ifc.tb.clip", s => setTool(s, "clip")), 20),
        lvl(btn("btnIfcClipClear", "bi bi-x-square", "app.ifc.tb.clip_clear", s => clearClipPlanes(s)), 20),
        // Misure: un menu (strumento acceso = stessa voce di nuovo per spegnerlo)
        lvl({
          type: "dropdown", id: "btnIfcMeasures", iconClass: "bi bi-rulers", className: "icon-only",
          title: t("app.ifc.tb.measures"),
          items: [
            ...Object.entries(MEASURE_KINDS).map(([kind, k]) =>
              menuItem(`bi ${k.icon}`, k.label, k.title, s => setTool(s, kind))),
            { type: "divider" },
            menuItem("bi bi-eraser", "app.ifc.menu.measures_clear", "app.ifc.tb.measures_clear", s => clearMeasures(s)),
          ],
        }, 20),
        // Salvataggi nel modello (livello autore)
        lvl({
          type: "dropdown", id: "btnIfcSaves", iconClass: "bi bi-cloud-upload", className: "icon-only",
          title: t("app.ifc.tb.saves"),
          items: [
            menuItem("bi bi-cloud-arrow-up", "app.ifc.menu.save_frag",     "app.ifc.tb.save_frag",     s => saveFrag(s)),
            menuItem("bi bi-rulers",         "app.ifc.menu.save_measures", "app.ifc.tb.measures_save", s => saveMeasures(s)),
            menuItem("bi bi-scissors",       "app.ifc.menu.save_planes",   "app.ifc.tb.clip_save",     s => savePlanes(s)),
          ],
        }, 30),
      ],
    };
  },

  // ── destroy (best-effort su tutte le istanze ancora vive) ─────────────────
  destroy() {
    for (const bodyEl of Array.from(ACTIVE_BODIES)) {
      destroyBodyInstance(bodyEl);
    }
  },
};
