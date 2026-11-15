// NON MODIFICARE QUESTA PARTE ------------------------
/**
 * app/model_XXX.mjs
 * Default specialization (fallback) for model_XXX.mjs
 *
 * Contract:
 * export default {
 *   async renderBody({ panel, headerEl, bodyEl, object, models, signal }) {},
 *   getLeftMenu({ panel, headerEl, bodyEl, object, models }) => { title, items },
 *   getRightMenu({ panel, headerEl, bodyEl, object, models }) => { title, items },
 *   destroy() {}
 * }
 */


// INSERIRE QUI SOTTO L'IMPORT AD EVENTUALI LINRERIE E MODULI ESTERNI

import { initWindow, getState, activateWindow, deactivateWindow } from "./PJS_sub_modules/PJS-core.mjs";
import { attachOverlay } from "./PJS_sub_modules/PJS-overlay.mjs";
import { importEnvelope, exportEnvelope, restoreUiLayerAfterImport } from "./PJS_sub_modules/PJS-io.mjs";
import { openDrawingsModal } from "./PJS_sub_modules/PJS-ui-dwgModal.mjs";
import { saveDrawing } from "./PJS_sub_modules/PJS-storage-api.mjs";

import { ensureToolSystem, setActiveTool } from "./PJS_sub_modules/PJS-tools.mjs";
import { ensureSnapSystem } from "./PJS_sub_modules/PJS-snap.mjs";

// in alto tra gli import di model_OSD.mjs
import { openLayerModal } from "./PJS_sub_modules/PJS-ui-layerModal.mjs";
import { openSettingsModal } from "./PJS_sub_modules/PJS-ui-settingsModal.mjs";

import { deleteSelection } from "./PJS_sub_modules/PJS-tool-delete.mjs";
import { openTextStylesModal } from "./PJS_sub_modules/PJS-ui-textStylesModal.mjs";
import { openPropertiesDialog } from "./PJS_sub_modules/PJS-cmd-properties.mjs";
import { openFiltersPanel, applyFiltersFromEnv } from "./OSD_sub_modules/OSD-ui-filtersModal.mjs";
import { ICONS } from "./PJS_sub_modules/PJS-icons.mjs";
import { undo, redo, exportProjectJSON } from "./PJS_sub_modules/PJS-history.mjs";
import { ojsLoadFlows, ojsRunStep, ojsAttachOsdWiring } from "./OSD_sub_modules/OSD-flow-runner.mjs";
import { attachInteractive } from "./PJS_sub_modules/PJS-interactive.mjs";
import { t } from "./shared/i18n.mjs";

// INSERIRE QUI SOTTO VARIABILI GLOBALI \ CONFIGURAZIONE \ STATE
// -------------------------------
// CONFIG / STATE
// -------------------------------

const STATE_KEY = "_APP_STATE_";

// Registro istanze attive per best-effort destroy() globale
const ACTIVE_BODIES = new Set();

// -------------------------------
// SPECIALIZATION EXPORT (plugin)
// -------------------------------
export default {
  async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {
    if (!bodyEl) throw new Error("PJS.renderBody: bodyEl mancante");

    // Se per qualche motivo fosse rimasto uno stato precedente sullo stesso bodyEl, pulisco.
    destroyBodyInstance(bodyEl);

    // --- UI base del viewport (nota: stai modificando un div creato altrove) ---
    // NB: lo facciamo idempotente e ripristiniamo in destroy.
    const prevBodyStyle = {
      position: bodyEl.style.position,
      overflow: bodyEl.style.overflow,
    };

    bodyEl.style.position = bodyEl.style.position || "relative";
    bodyEl.style.overflow = "hidden";

    //Questo è lo state Key riguardante OSD la procedura PJS-core aggiungera un'oggetto pjs cone gli stati specifici dell'overlay Paper.JS
    bodyEl[STATE_KEY] = bodyEl[STATE_KEY] || {};
    bodyEl[STATE_KEY].cmdUI = cmdUI;
    bodyEl[STATE_KEY].mod_id = models?.[0]?.mod_id;
    bodyEl[STATE_KEY].prevBodyStyle = prevBodyStyle;

    ACTIVE_BODIES.add(bodyEl);
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", () => destroyBodyInstance(bodyEl), { once: true });
    }

    // (2026-10-03) Modello "senza file": OSD ha bisogno dell'immagine (ImageProperties.xml)
    if (!models?.[0]?.mod_abs_url) {
        cmdUI?.show?.({ status: t("app.osd.no_image_file.@") });
        return;
    }

    try {


        const response = await fetch(models[0].mod_abs_url);

        if (!response.ok) {
            throw new Error(`Errore nel caricamento XML: ${response.status}`);
        }

        const text = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");

        const xmlNode = xmlDoc.getElementsByTagName("IMAGE_PROPERTIES")[0];

        if (!xmlNode) {
            throw new Error("Nodo IMAGE_PROPERTIES non trovato.");
        }

        const imgWidth = parseInt(xmlNode.getAttribute('WIDTH')) || 0;
        const imgHeight = parseInt(xmlNode.getAttribute('HEIGHT')) || 0;

        if (isNaN(imgWidth) || isNaN(imgHeight)) {
            throw new Error("Attributi WIDTH o HEIGHT non validi.");
        }
        
        const gpx_url = models[0].mod_abs_url.substring(0, models[0].mod_abs_url.lastIndexOf('/') + 1);

        const viewer =  Set2DViewer(bodyEl, object, gpx_url, imgWidth, imgHeight);

        const mod_id = models?.[0]?.mod_id;
        const winId = (object?.obj_id ?? bodyEl.id ?? crypto.randomUUID()).toString();

        const pjs = initWindow(bodyEl, { winId, mod_id });

        // viewer: ora Set2DViewer ritorna viewer
        pjs.overlay = attachOverlay(bodyEl, viewer);
        pjs.viewer  = viewer;

        // Baseline snapshot: progetto vuoto = stato iniziale per undo
        if (pjs.history) pjs.history.currentSnapshot = exportProjectJSON(pjs);

        // attiva input solo sulla finestra attiva (se gestisci focus finestre)
        deactivateWindow(bodyEl);        // default: OSD riceve input
        ensureToolSystem(bodyEl);        // prepara tool system

        // Flow embedded: carica grafi LiteGraph collegati all'oggetto (idempotente, no-op se assenti)
        pjs.flowGraphs        = [];
        await ojsLoadFlows(object, pjs, { cmdUI, bodyEl, signal });
        ojsAttachOsdWiring(pjs, { bodyEl, signal });
        attachInteractive(bodyEl, { signal });



    } catch (error) {
        console.error("Errore in ShowGigaP:", error.message);
    }

  },

  getLeftMenu({ object }) {
    // Nessuna voce propria: i comandi e gli stati dei nodi ReseArch/Menu/* dei flow
    // li aggiunge template_XXX.mjs per tutte le App (app/shared/panel-flow.mjs).
    return {
      title: getObjectDisplayName(object),
      items: [],
    };
  },

  getRightMenu() {
    // Voci statiche reali (non placeholder no-op). I comandi dei nodi ReseArch/Menu/Command
    // dei flow li aggiunge template_XXX.mjs (app/shared/panel-flow.mjs).
    const staticItems = [
      { type: "button", id: "models0", label: t("app.osd.object.@"), class: "dropdown-item panel-models" },
      { id: "models", label: t("panel.objects.@"), onClick: () => openModelsPanel() },
    ];
    return { title: "☰", items: staticItems };
  },

  // FIX: prendiamo headerEl/panel dal ctx, così in futuro puoi fare cose più intelligenti.
  // Qui lo usiamo indirettamente perché i bottoni sono in toolbar (header), non nel body.
  getToolbar({ panel, headerEl, bodyEl }) {
    const root = headerEl ?? panel;
    
    //Specifica di OSD-PJS
    const st = bodyEl[STATE_KEY];
    const pjs = st?.pjs;
    const cmdUI = st?.cmdUI;

    function ensureSnap() {
      try { ensureSnapSystem(bodyEl); } catch {}
      return pjs?._env?.workspace?.snap;
    }

    function activate(name) {
      // prefer the official tool setter to keep RMB logic/guards in one place
      setActiveTool(bodyEl, name, { cmdUI });
    }

    function snapItem(type, label) {
      const snap = ensureSnap();
      const on = !!snap?.types?.[type];
      return {
        label,
        iconClass: on ? "bi bi-check2" : "",
        onClick: () => {
          const s = ensureSnap();
          if (!s) return;
          s.types[type] = !s.types[type];
          cmdUI?.update?.({ status: t(s.types[type] ? "app.pjs.snap.type_on" : "app.pjs.snap.type_off", { label }) });
        }
      };
    }

    const snap = ensureSnap();
    const snapEnabled = !!snap?.enabled;
    // Fine specifica di OSD-PJS

    return {
      items: [
      //IO FIle
      //DWG Open List (Open\New\Delete)
        {
          type: "button",
          id: "btnOpen",
          iconClass: "bi bi-folder2-open",
          className: "icon-only",
          title: t("app.pjs.dwg.open_title"),
          onClick: async () => {
              const st = bodyEl?.[STATE_KEY];
              // models non è nel contesto di getToolbar: il mod_id lo salva renderBody nello stato
              const mod_id = st?.mod_id;
              if (!mod_id) { st?.cmdUI?.update?.({ hints: t("app.pjs.dwg.no_model") }); return; }

              // cmdUI lo hai in renderBody; nel toolbar puoi usare bodyEl[STATE_KEY].cmdUI se lo salvi lì
              const footer = st?.cmdUI || null;

              await openDrawingsModal({
                panel,
                headerEl,
                bodyEl,
                mod_id,
                makeTemplateEnvelope,
                footer,
                onOpen: async (row, currentUserId) => {
                  // row contiene dwg_sce_json + metadata (come da API)
                  const pjs = getState(bodyEl);

                  // isOwner: edit/salva abilitato solo se author==current
                  const isOwner = row.dwg_author_id === currentUserId;

                  pjs.dwg = {
                    dwg_id: row.dwg_id,
                    dwg_name: row.dwg_name,
                    dwg_version: row.dwg_version,
                    dwg_author_id: row.dwg_author_id,
                    dwg_show: row.dwg_show,
                    dwg_share: row.dwg_share,
                    isOwner
                  };

                  importEnvelope(bodyEl, row.dwg_sce_json);

                  // Reset undo/redo: il disegno caricato è il nuovo baseline
                  const _pjsH = getState(bodyEl);
                  if (_pjsH?.history) {
                    _pjsH.history.undoStack.length = 0;
                    _pjsH.history.redoStack.length = 0;
                    _pjsH.history.currentSnapshot = exportProjectJSON(_pjsH);
                  }

                  applyFiltersFromEnv(bodyEl);
                  footer?.update?.({ status: t("app.pjs.dwg.opened", { name: row.dwg_name }) });

                  // Aggiorna nodi onExecute (DrawingIsOpen, LayerGetActive, ecc.)
                  ojsRunStep(_pjsH);
                }
              });
            }

        },
      //DWG Sawe ---------------------------------------  
        {
          type: "button",
          id: "btnSave",
          iconClass: "bi bi-floppy",
          className: "icon-only",
          title: t("app.pjs.dwg.save_title"),
          minLevel: 30,
            onClick: async () => {
              const pjs = getState(bodyEl);
              const st = bodyEl?.[STATE_KEY];
              const footer = st?.cmdUI || null;

              if (!pjs?.dwg?.dwg_id) { footer?.update?.({ hints: t("app.pjs.dwg.none_open") }); return; }
              if (!pjs.dwg.isOwner) { footer?.update?.({ hints: t("app.pjs.dwg.other_author") }); return; }
              if (!pjs.dirty) { footer?.update?.({ status: t("app.pjs.dwg.no_changes") }); return; }

              footer?.update?.({ status: t("common.saving") });

              
              //debug
                console.log("SAVE start", { dirty: pjs.dirty, dwg_id: pjs.dwg?.dwg_id });
              //end debug
              
              
              const env = exportEnvelope(bodyEl);

              //debug
               console.log("SAVE exportEnvelope OK", env);
              //end debug


              // aggiorna drawingId in meta
              env.meta = env.meta || {};
              env.meta.drawingId = pjs.dwg.dwg_id;


              //debug
                  console.log("SAVE calling saveDrawing", {
                dwg_id: pjs.dwg.dwg_id,
                hasPaper: !!env.paper,
                hasProjectJSON: !!env.paper?.projectJSON,
                layers: env.layers?.map?.(l => ({ id: l.id, name: l.name }))
              });
              //end debug


              await saveDrawing({
                dwg_id: pjs.dwg.dwg_id,
                dwg_name: pjs.dwg.dwg_name,
                dwg_description: pjs.dwg.dwg_description || "",
                dwg_version: pjs.dwg.dwg_version || "v1",
                dwg_sce_json: env,
                dwg_show: pjs.dwg.dwg_show ?? 1,
                dwg_share: pjs.dwg.dwg_share ?? 1
              });


              //debug
              console.log("SAVE saveDrawing OK");
              //end debug




              pjs.dirty = false;
              footer?.update?.({ status: t("common.saved") });
              pjs.localEvents?.dispatchEvent(new CustomEvent('drawingSaved', { detail: { dwg_id: pjs.dwg?.dwg_id ?? null } }));
            }
        },
      { type: "divider" },

      //Drawing Line
      {
        type: "dropdown",
        iconClass: "bi bi-slash-lg",
        title: t("app.pjs.group.lines"),
        minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
        items: [
          { iconHtml: ICONS.point,    title: t("app.pjs.tool.point"),    onClick: () => activate("point") },
          { iconHtml: ICONS.line,     title: t("app.pjs.tool.line"),     onClick: () => activate("line") },
          { iconHtml: ICONS.polyline, title: t("app.pjs.tool.polyline"), onClick: () => activate("polyline") },
          { iconHtml: ICONS.curve,    title: t("app.pjs.tool.curve"),    onClick: () => activate("curve") },
          { type: "divider" },
          { label: t("app.pjs.tool.spline"),   iconClass: "bi bi-bezier2", onClick: () => {} },
          { label: t("app.pjs.tool.freehand"), iconClass: "bi bi-pencil",  onClick: () => {} },
        ]
      },

      //Drawing Polygon
      {
        type: "dropdown",
        iconClass: "bi bi-pentagon",
        title: t("app.pjs.group.polygons"),
        minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
        items: [
          { iconHtml: ICONS.rect,         title: t("app.pjs.tool.rect"),         onClick: () => activate("rect") },
          { label: t("app.pjs.tool.rect_edge"), iconClass: "bi bi-bounding-box", onClick: () => activate("rect_edge") },
          { iconHtml: ICONS.polygon,      title: t("app.pjs.tool.polygon"),      onClick: () => activate("polygon") },
          { iconHtml: ICONS.polygon_edge, title: t("app.pjs.tool.polygon_edge"), onClick: () => activate("polygon_edge") },
          { iconHtml: ICONS.star,         title: t("app.pjs.tool.star"), onClick: () => activate("star") },
        ]
      },

      //Drawing Quadrics
      {
        type: "dropdown",
        iconClass: "bi bi-circle",
        title: t("app.pjs.group.quadrics"),
        minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
        items: [
          { iconHtml: ICONS.arc_cse,     title: t("app.pjs.tool.arc_cse"),     onClick: () => activate("arc_cse") },
          { iconHtml: ICONS.arc_3p,      title: t("app.pjs.tool.arc_3p"),      onClick: () => activate("arc") },
          { iconHtml: ICONS.circle,      title: t("app.pjs.tool.circle"),        onClick: () => activate("circle") },
          { iconHtml: ICONS.circle_2p,   title: t("app.pjs.tool.circle_2p"),   onClick: () => activate("circle_2p") },
          { iconHtml: ICONS.circle_3p,   title: t("app.pjs.tool.circle_3p"),   onClick: () => activate("circle_3p") },
          { iconHtml: ICONS.ellipse,     title: t("app.pjs.tool.ellipse"),       onClick: () => activate("ellipse") },
          { iconHtml: ICONS.ellipse_axes, title: t("app.pjs.tool.ellipse_axes"), onClick: () => activate("ellipse_axes") },
        ]
      },

      //Text, image, tag, marker, link
      {
        type: "dropdown",
        iconClass: "bi bi-pin-map",
        title: t("app.pjs.group.annotations"),
        minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
        items: [
          { label: t("app.pjs.tool.text"),    iconClass: "bi bi-type",        onClick: () => activate("text")  },
          { iconHtml: ICONS.image, title: t("common.image"),            onClick: () => activate("image") },
          { label: t("app.pjs.tool.marker"),   iconClass: "bi bi-vector-pen",  onClick: () => activate("svg")   },
          { label: t("app.pjs.tool.quote_na"), iconClass: "bi bi-quote",       onClick: () => activate("")      },
          { type: "divider" },
          { label: t("app.pjs.tool.text_styles"), onClick: () => openTextStylesModal(bodyEl) },
        ]
      },

      { type: "divider" },
      {
        type: "dropdown",
        title: t("app.pjs.group.transform"),
        minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
        iconClass: "bi bi-arrows-move",        
        items: [
          { iconHtml: ICONS.select, title: t("common.select"), onClick: () => activate("select") },
          { label: t("app.pjs.tool.move"),   iconClass: "bi bi-arrows-move",  onClick: () => activate("move") },
          { label: t("common.copy"),   iconClass: "bi bi-copy",         onClick: () => activate("copy") },
          { iconHtml: ICONS.rotate, title: t("app.pjs.tool.rotate"), onClick: () => setActiveTool(bodyEl, "rotate", { cmdUI: st?.cmdUI }) },
          { iconHtml: ICONS.scale,  title: t("app.pjs.tool.scale"),  onClick: () => setActiveTool(bodyEl, "scale",  { cmdUI: st?.cmdUI }) },
          { iconHtml: ICONS.mirror, title: t("app.pjs.tool.mirror"), onClick: () => activate("") },
          { type: "divider" },
          { label: t("app.pjs.tool.properties"), onClick: () => openPropertiesDialog({ state: getState(bodyEl), bodyEl, cmdUI: st?.cmdUI }) },
          { label: t("common.delete"), iconClass: "bi bi-delete", onClick: () => deleteSelection({state: getState(bodyEl), cmdUI: st?.cmdUI })},
        ]
      },
      {
        type: "dropdown",
        title: t("app.pjs.group.edit_tools"),
        minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
        iconClass: "bi bi-tools",
        items: [
          { iconHtml: ICONS.trim,   title: t("app.pjs.tool.trim"),   onClick: () => activate("") },
          { iconHtml: ICONS.extend, title: t("app.pjs.tool.extend"), onClick: () => activate("") },
          { iconHtml: ICONS.fillet, title: t("app.pjs.tool.fillet"), onClick: () => activate("") },
          { label: t("app.pjs.tool.radius_na"), iconClass: "bi bi-circle", onClick: () => activate("") },
          { iconHtml: ICONS.divide, title: t("app.pjs.tool.divide"), onClick: () => activate("") },
          { label: t("app.pjs.tool.join_na"),   iconClass: "bi bi-node-plus", onClick: () => activate("") },

        ]
      },

      { type: "divider" },

             {
          type: "button",
          id: "btnUndo",
          iconClass: "bi bi-arrow-90deg-left",
          className: "icon-only",
          title: t("app.pjs.undo"),
          minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
          onClick: () => {
            const _pjs = getState(bodyEl);
            if (!_pjs?.history) return;
            const snap = undo(_pjs.history);
            if (!snap) return;
            _pjs.scope.activate();
            _pjs.scope.project.importJSON(snap);
            restoreUiLayerAfterImport(_pjs);
            if (_pjs.selection) { _pjs.selection.clear(); _pjs.selectionCount = 0; _pjs.hasSelection = false; }
            _pjs.overlay?.sync?.();
            st?.cmdUI?.update?.({ status: t("app.pjs.undo") });
          }
        },
        {
          type: "button",
          id: "btnRedo",
          iconClass: "bi bi-arrow-90deg-right",
          className: "icon-only",
          title: t("app.pjs.redo"),
          minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
          onClick: () => {
            const _pjs = getState(bodyEl);
            if (!_pjs?.history) return;
            const snap = redo(_pjs.history);
            if (!snap) return;
            _pjs.scope.activate();
            _pjs.scope.project.importJSON(snap);
            restoreUiLayerAfterImport(_pjs);
            if (_pjs.selection) { _pjs.selection.clear(); _pjs.selectionCount = 0; _pjs.hasSelection = false; }
            _pjs.overlay?.sync?.();
            st?.cmdUI?.update?.({ status: t("app.pjs.redo") });
          }
        },
        { type: "divider" },


      //Layers
        {
          type: "button",
          id: "btnLayers",
          iconClass: "bi bi-layers",
          className: "icon-only",
          title: t("app.pjs.layers.title"),
          minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
            onClick: async () => {
              try { await openLayerModal({ panel, headerEl, bodyEl }); }
              catch (e) { cmdUI?.update?.({ hints: String(e?.message || e) }); }
            }
        },
      //Setting
        {
          type: "button",
          id: "btnSettings",
          iconClass: "bi bi-sliders",
          className: "icon-only",
          title: t("app.pjs.settings.title"),
          minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
          onClick: async () => { await openSettingsModal({ panel, headerEl, bodyEl }); }
        },
      //Filtri immagine OSD (WebGL)
        {
          type: "button",
          iconClass: "bi bi-sliders2",
          className: "icon-only",
          title: t("app.osd.filters.title"),
          onClick: async () => { await openFiltersPanel({ bodyEl }); },
        },

      

      
    ]
  };

  },

  // best-effort: la pulizia vera avviene su AbortSignal (per istanza).
  destroy() {
    // Se rimangono istanze vive per qualche motivo, prova a ripulirle.
    for (const bodyEl of Array.from(ACTIVE_BODIES)) {
      destroyBodyInstance(bodyEl);
    }
  },
};

  // -------------------------------
  // HELPERS (lifecycle / UI / misc)
  // -------------------------------
  
function destroyBodyInstance(bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st) return;

  // ferma i flow graphs LiteGraph (vivono in pjs.flowGraphs)
  try {
    const pjs = getState(bodyEl);
    for (const g of pjs?.flowGraphs ?? []) { g.stop?.(); }
    if (pjs) pjs.flowGraphs = [];
  } catch {}

  // ripristino style bodyEl
  try {
    bodyEl.style.position = st.prevBodyStyle?.position ?? "";
    bodyEl.style.overflow = st.prevBodyStyle?.overflow ?? "";
  } catch {}

  try { delete bodyEl[STATE_KEY]; } catch {}
  ACTIVE_BODIES.delete(bodyEl);
}


    
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
  

  // Placeholder: nel tuo file era chiamata ma non definita
  function openModelsPanel() {
    console.log("openModelsPanel(): TODO");
  }

//-----------------------  PARTE DEDICATA A OpenSeaDragon ------------------------




// -- Impostazione OSD Viewer  ------------------
function Set2DViewer(container, object, gpx_url,imgWidth, imgHeight) {
    // Creazione dell'oggetto MyWorld per gestire le informazioni del modello
    
    /*
    const MyWorld = {
        Mod_Id: ObjInfo.id,
        Mod_Name: ObjInfo.name,
        Mod_Desc: ObjInfo.description,
        Dwg_Id: null,
        Dwg_Name: "",
        Dwg_Desc: ""
    };

    */
    // Configurazione di OpenSeaDragon

    //container.id="OSD-Viewer"
    
    const OSDparam = {
        
        //id: container.id,
        element: container,  // ✅ NON usare id
        constrainDuringPan: true,
        zoomPerClick: 1.0, // Disabilita lo zoom al click
        prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@6.0.0/build/openseadragon/images/',
        tileSources: [{
            type: "zoomifytileservice",
            tilesUrl: gpx_url,
            width: imgWidth,
            height: imgHeight
        }],
        showNavigationControl: false,
        showNavigator: false,
        //gestureSettingsMouse: {
            //clickToZoom: false,
            //dblClickToZoom: true,
           // dragToPan: false, // Disabilitiamo il pan di default sul sinistro
            // Personalizziamo i tasti del mouse:
            //pinchToZoom: true,
        //},
    };

    // Inizializzazione del Viewer
    const viewer = OpenSeadragon(OSDparam);

    // in fondo a Set2DViewer(...)
    return viewer;

}
function makeTemplateEnvelope({ mod_id }) {
  const now = new Date().toISOString();
  return {
    schema: "OSD_PJS_ANNOTATION",
    schemaVersion: 1,
    meta: {
      drawingId: null,
      objectId: mod_id,
      imageKey: `mod_id:${mod_id}`,
      createdAt: now,
      updatedAt: now,
      appVersion: "model_OSD.mjs@1.0",
    },
    workspace: {
      //units: "image-px",
      snap: {
        enabled: true,
        tolerancePx: 8,
        types: { endpoint: true, center: true, midpoint: true, intersection: true },
        priority: ["endpoint", "center", "midpoint", "intersection"],
      },
      defaults: {
        activeLayerId: "L1",
        rotateStepDeg: 15,
        scaleFromCenter: true,
        scaleUniform: true,
        rectCornerRadius: 0,
        polygonSides: 5,
        fontFamily: "Arial",
        fontSize: 12,
        textJustification: "left",
        pointStyle: { shape: "x", size: 6, screenConsistent: true },
      },
    },
    layers: [
      {
        id: "L1",
        name: "Layer 01",
        visible: true,
        locked: false,
        style: {
          strokeColor: "#000000",
          fillColor: "transparent",
          strokeWidth: 1,
          lineType: "continuous",
          dashArray: [],
        },
      },
    ],
    paper: { paperVersion: "0.12.x", projectJSON: {} },
  };
}
