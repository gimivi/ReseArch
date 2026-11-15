// model_TJS.mjs
// Renderer Three.js per modelli "TJS" (array models)
// Specialization for template_XXX.mjs
//
// Obiettivi di questo file:
// - creare scena + renderer e montare canvas nel bodyEl
// - caricare modelli in parallelo
// - installare controls (Orbit/EyeLock) + tools (transform/cut)
// - collegarsi a cmdUI (footer del panel) tramite ctx.cmdUI
// - cleanup robusto su AbortSignal (per istanza/pannello)

import { THREE, loadAnyModel, applyPointShape } from "./TJS_sub_modules/TJS-loaders.mjs";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ControlsManager } from "./TJS_sub_modules/TJS-controls-manager.mjs";
import { EyeLockControls } from "./TJS_sub_modules/TJS-eyelock-controls.mjs";

import { tjsToggleProjection } from "./TJS_sub_modules/TJS-projection.mjs";
import { tjsSetMainView, tjsViewAlongDirection } from "./TJS_sub_modules/TJS-mainviews.mjs";

import { tjsCreateTransformTool } from "./TJS_sub_modules/TJS-transform.mjs";
import { tjsCreateCutTool } from "./TJS_sub_modules/TJS-cut-core.mjs";

import {
  tjsHideSelected,
  tjsToggleWireframeSelected,
  tjsEraseSelected,
  tjsTargetAtSelection,
  tjsCameraAtSelection,
} from "./TJS_sub_modules/TJS-selection-actions.mjs";

import { tjsBusEmit, tjsFindModelWrapper } from "./TJS_sub_modules/TJS-bus.mjs";
import { tjsLoadFlows } from "./TJS_sub_modules/TJS-flow-runner.mjs";
import { TJS_createExtensionHost } from "./TJS_sub_modules/TJS-extensions.mjs";
import { TJS_checkModel, TJS_formatModelWarnings } from "./TJS_sub_modules/TJS-model-check.mjs";
import { tjsCreatePickManager } from "./TJS_sub_modules/TJS-pick-manager.mjs";
import { tjsCreateMeasureTool } from "./TJS_sub_modules/TJS-measure-tool.mjs";
import { tjsCreateSceneTree }    from "./TJS_sub_modules/TJS-scene-tree.mjs";
import { tjsCreateLightManager }  from "./TJS_sub_modules/TJS-light-manager.mjs";
import { tjsCreateCutManager }    from "./TJS_sub_modules/TJS-cut-manager.mjs";
import { tjsCreateCameraManager } from "./TJS_sub_modules/TJS-camera-manager.mjs";
import { tjsCreateEnvManager }     from "./TJS_sub_modules/TJS-env-manager.mjs";
import { tjsCreateMaterialEditor } from "./TJS_sub_modules/TJS-material-editor.mjs";
import { tjsCreateClay }           from "./TJS_sub_modules/TJS-clay.mjs";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass }     from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass }       from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass }     from "three/addons/postprocessing/OutputPass.js";
import { t } from "./shared/i18n.mjs";

// -------------------------------
// CONFIG / STATE
// -------------------------------

const STATE_KEY = "__TJS_RENDER_STATE__";

// registriamo le istanze attive (best-effort, per fallback destroy())
const ACTIVE_BODIES = new Set();

// Griglia: tienila coerente in un solo posto
const GRID = { size: 100, divisions: 20 };
const gridStep = GRID.size / GRID.divisions;

/**
 * Dati di un'intersezione Three.js (raycast) nella forma usata da lastHit,
 * dal bus (selection:change) e dai nodi TJS/Events/* — un solo punto di verità
 * per il mirino EyeLock (onPick) e per il click in Orbit (selezione).
 *   hitPoint      {x,y,z}  punto colpito, coordinate mondo
 *   normal        {x,y,z}  normale della faccia (spazio locale dell'oggetto)
 *   face          numero   indice del TRIANGOLO colpito (hit.faceIndex). Fino al
 *                          2026-10-03 conteneva per errore l'indice del materiale.
 *   materialIndex numero   indice del materiale della faccia (gruppi multi-materiale)
 *   uv / uv1      {u,v}    coordinate di mappa nel canale UV principale / secondo,
 *                          interpolate sul triangolo; null se la geometria non ha UV
 *                          (nuvole di punti, linee, mesh senza mappatura)
 * Con hit null restituisce tutti i campi a null.
 */
function _tjsHitDetails(hit) {
  const v3 = (v) => (v ? { x: v.x, y: v.y, z: v.z } : null);
  const uv = (v) => (v ? { u: v.x, v: v.y } : null);
  return {
    hitPoint:      v3(hit?.point),
    normal:        v3(hit?.face?.normal),
    face:          hit?.faceIndex ?? null,
    materialIndex: hit?.face?.materialIndex ?? null,
    uv:            uv(hit?.uv),
    uv1:           uv(hit?.uv1),
  };
}

// -------------------------------
// SPECIALIZATION EXPORT (plugin)
// -------------------------------

export default {
  async renderBody({ panel, headerEl, bodyEl, object, models, cmdUI, signal }) {
    if (!bodyEl) throw new Error("TJS.renderBody: bodyEl mancante");

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

    // --- Scene / Camera / Renderer ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101018);

    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
    camera.position.set(8, 6, 10);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      stencil: true,               // required for stencil-based clipping caps
      powerPreference: "high-performance",
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(bodyEl.clientWidth || 1, bodyEl.clientHeight || 1, false);
    renderer.shadowMap.enabled   = true;
    renderer.shadowMap.type      = THREE.PCFShadowMap;   // dalla r186 PCF è morbido (PCFSoft rimosso)
    renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace    = THREE.SRGBColorSpace;

    // --- EffectComposer (RenderPass → [GTAOPass opzionale] → OutputPass) ---
    // Render target con stencil: senza, con l'occlusione accesa il riempimento Stencil del taglio
    // (TJS-cut-stencil) non si disegna (il target predefinito del composer non ha stencil buffer).
    const renderPass = new RenderPass(scene, camera);
    const outputPass = new OutputPass();
    const composer   = new EffectComposer(renderer,
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, stencilBuffer: true }));
    composer.addPass(renderPass);
    composer.addPass(outputPass);

    const canvas = renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";

    bodyEl.appendChild(canvas);

    // --- Luci + Griglia (minimo indispensabile) ---
    {
      // Luce di base: regolata e salvata nella finestra Ambiente (TJS-env-manager, baseLight),
      // che mette il sole su azimut/elevazione intorno al modello e ne adatta l'ombra
      const ambient = new THREE.AmbientLight(0xffffff, 0.6);
      ambient.name = "TJS_BASE_AMBIENT";
      scene.add(ambient);

      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.name = "TJS_BASE_SUN";
      dir.position.set(10, 12, 8);
      dir.castShadow               = false;   // OFF di default — si accende dalla finestra Ambiente
      dir.shadow.mapSize.setScalar(2048);
      scene.add(dir);
      scene.add(dir.target);                  // il bersaglio si sposta sul centro del modello

      const grid = new THREE.GridHelper(GRID.size, GRID.divisions, 0x3355ff, 0x808080);
      grid.name = "TJS_GRID";
      scene.add(grid);
    }

    // --- OrbitControls ---
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.06;
    orbit.target.set(0, 0, 0);
    orbit.update();
    // Ogni movimento camera (incluso il damping in uscita) segnala il bisogno di render
    orbit.addEventListener('change', () => { if (state) state._renderDirty = 2; });

    // --- Reticle (per EyeLock) ---
    const reticleEl = tjsCreateReticle(bodyEl);

    // --- ctx per ControlsManager / EyeLock ---
    const controlsCtx = {
      THREE,
      camera,
      scene,
      renderer,
      raycaster: new THREE.Raycaster(),
      pickables: null,
      // mirino EyeLock: niente punti sulle parti tolte dal taglio né sui piani (state.pointHitFilter)
      hitFilter: (h) => !bodyEl[STATE_KEY]?.pointHitFilter || bodyEl[STATE_KEY].pointHitFilter(h),
      setReticle: (on) => {
        if (reticleEl) reticleEl.style.display = on ? "block" : "none";
      },
      onPick: (hit) => {
        if (!hit) {
          // Nessun hit standard (tipico con point cloud sparse in EyeLock):
          // delega al tool attivo il fallback closest-vertex-to-ray.
          const ray = controlsCtx.raycaster?.ray;
          if (ray) {
            if (state?.pickManager?.isActive())
              state.pickManager.tryPickFromRay(ray, [modelsRoot]);
            else if (state?.measureTool?.isActive())
              state.measureTool.tryFromRay(ray, [modelsRoot]);
          }
          return;
        }
        // Aggiorna lastHit e invia sul bus (payload a 3 livelli)
        const _mw  = tjsFindModelWrapper(hit.object, modelsRoot);
        const _mr  = _mw?.userData?.modelRow ?? null;
        const _tmp = new THREE.Vector3();
        const _mwPos = _mw ? (_mw.getWorldPosition(_tmp), { x: _tmp.x, y: _tmp.y, z: _tmp.z }) : null;
        const _hitData = { ..._tjsHitDetails(hit), modelWorldPos: _mwPos };
        if (state?.appContext) {
          const _sp = hit.object?.position;
          state.appContext.lastHit = {
            appObject:   { objId: object?.obj_id ?? null, objApp: object?.obj_app ?? null, objName: object?.obj_name ?? null },
            model:       _mr ? { modId: _mr.mod_id ?? null, modName: _mr.mod_name ?? null, position: _mwPos } : null,
            sceneObject: {
              name: hit.object?.name ?? null, type: hit.object?.type ?? null, uuid: hit.object?.uuid ?? null,
              position: _sp ? { x: _sp.x, y: _sp.y, z: _sp.z } : null,
              ..._tjsHitDetails(hit),
            },
          };
        }
        // Collimazione / Misura: registra il punto nel tool attivo
        state?.pickManager?.addPoint(hit);
        state?.measureTool?.addPoint(hit);
        tjsBusEmit(object, hit.object, modelsRoot, _hitData);
        state?.localEvents?.dispatchEvent(new CustomEvent('pick', { detail: state.appContext?.lastHit ?? null }));
      },
    };

    const controlsMgr = new ControlsManager(renderer.domElement, controlsCtx);
    const eye = new EyeLockControls(renderer.domElement);

    controlsMgr.register("orbit", {
      activate: () => {
        orbit.enabled = true;
      },
      deactivate: () => {
        orbit.enabled = false;
      },
      update: (dt) => orbit.update(dt),
    });
    controlsMgr.register("eyelock", eye);

    controlsMgr.start();
    controlsMgr.setMode("orbit");

    // --- Root per modelli ---
    const modelsRoot = new THREE.Group();
    modelsRoot.name = "TJS_MODELS_ROOT";
    scene.add(modelsRoot);
    controlsCtx.pickables = [modelsRoot];

    // --- Materiale clay (helper di base): agli oggetti caricati senza materiale e per la vista clay ---
    const clay = tjsCreateClay({ THREE, modelsRoot, markDirty: () => state?.markDirty?.(), signal });

    // --- Root per luci create (fratello di modelsRoot, escluso dall'albero oggetti) ---
    const lightsRoot = new THREE.Group();
    lightsRoot.name = "TJS_LIGHTS_ROOT";
    scene.add(lightsRoot);

    // --- Root per camere create (fratello di modelsRoot, escluso dall'albero oggetti) ---
    const cameraRoot = new THREE.Group();
    cameraRoot.name = "TJS_CAMERA_ROOT";
    scene.add(cameraRoot);

    // --- Contenitore pannelli lato destro (oggetti scena, luci, trasforma, collima, misura… in colonna) ---
    const rightContainer = document.createElement('div');
    rightContainer.className = 'tjs-rpanel';
    bodyEl.appendChild(rightContainer);

    // Dopo che una finestra della colonna si apre o si chiude da sola (X, Esc, gizmo spento):
    // bordo della colonna e pulsanti della toolbar allineati
    const toolbarRoot = headerEl ?? panel;
    const syncRightUI = () => {
      const st = bodyEl[STATE_KEY];
      if (!st) return;
      _syncRightContainer(rightContainer, st);
      tjsUpdateLayersButton(toolbarRoot, bodyEl);
      tjsUpdateLightMgrButton(toolbarRoot, bodyEl);
      tjsUpdateCameraMgrButton(toolbarRoot, bodyEl);
      tjsUpdateEnvMgrButton(toolbarRoot, bodyEl);
      tjsUpdateMaterialEditorButton(toolbarRoot, bodyEl);
      tjsUpdateClipButton(toolbarRoot, bodyEl);
      tjsUpdatePickToggleButton(toolbarRoot, bodyEl);
      tjsUpdateMeasureToggleButton(toolbarRoot, bodyEl);
      tjsUpdateTransformButtons(toolbarRoot, bodyEl);
      st.cutManager?.syncPlanes?.();
    };

    // Modalità piani: finestra Taglio aperta e taglio attivo → il clic in scena seleziona solo i
    // piani e il clic nel vuoto non deseleziona (TJS-cut-manager.mjs)
    const planesMode = (st) => !!(st?.cutManager?.isVisible() && st?.cutTool?.enabled);

    // Ogni finestra si mostra/nasconde con style.display sul proprio elemento: osservando i figli
    // diretti della colonna, la X di qualunque finestra (Luci, Camere, …) riallinea bordo e pulsanti
    const rightObserver = new MutationObserver((muts) => {
      if (muts.some(m => m.target === rightContainer || m.target.parentElement === rightContainer)) syncRightUI();
    });
    rightObserver.observe(rightContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    signal?.addEventListener('abort', () => rightObserver.disconnect(), { once: true });

    // --- Tools ---
    const transformTool = tjsCreateTransformTool({
      THREE,
      scene,
      camera,
      domEl: renderer.domElement,
      orbitControls: orbit,
      selectableRoot: modelsRoot,
      additionalPickRoots: [lightsRoot, cameraRoot],   // handle luci e camere sono clickabili
      cmdUI: cmdUI ?? null,
      containerEl: rightContainer,
      onUiChange: syncRightUI,
      // il raycast non conosce il clipping: si scartano le parti tolte; in modalità piani solo i piani
      hitFilter: (h) => {
        const st = bodyEl[STATE_KEY];
        const cut = st?.cutTool;
        if (!cut) return true;
        if (cut.isHitClipped(h)) return false;
        return planesMode(st) ? cut.isPlaneActor(h.object) : true;
      },
      keepSelectionOnEmpty: () => planesMode(bodyEl[STATE_KEY]),
      onTransformChange: () => {
        const st = bodyEl[STATE_KEY];
        st?.cutManager?.syncPlanes?.();
        // luci spostate o modello spostato: linee guida e ombre adattate seguono
        st?.lightManager?.onSceneTransformed?.();
        st?.envManager?.refitShadows?.();
      },
      gridStep,
      rotStepDeg: 15,
      scaleStep: 0.1,
      markDirty: () => state?.markDirty?.(),
      onSelectionChanged: (selection, info = {}) => {
        state?.materialEditor?.setSelection?.(selection);
        state?.markDirty?.();
        const obj3d = selection[0];
        if (!obj3d) return;
        const _mw  = tjsFindModelWrapper(obj3d, modelsRoot);
        const _mr  = _mw?.userData?.modelRow ?? null;
        const _tmp = new THREE.Vector3();
        const _mwPos = _mw ? (_mw.getWorldPosition(_tmp), { x: _tmp.x, y: _tmp.y, z: _tmp.z }) : null;
        // Dati del raycast (punto, normale, faccia, materiale, UV):
        // - selezione da click in Orbit → info.hit, l'intersezione del click (dal 2026-10-03;
        //   prima qui arrivavano sempre null);
        // - altrimenti, se onPick (mirino EyeLock) ha appena scritto lastHit per lo stesso
        //   oggetto, si ereditano i suoi;
        // - selezione da codice/albero, senza click → null.
        let _rc = _tjsHitDetails(null);
        if (info.hit) {
          _rc = _tjsHitDetails(info.hit);
        } else {
          const _prevSO = state.appContext?.lastHit?.sceneObject;
          if (_prevSO?.uuid != null && _prevSO.uuid === obj3d.uuid) {
            for (const k of Object.keys(_rc)) _rc[k] = _prevSO[k] ?? null;
          }
        }
        if (state?.appContext) {
          const _sp = obj3d?.position;
          state.appContext.lastHit = {
            appObject:   { objId: object?.obj_id ?? null, objApp: object?.obj_app ?? null, objName: object?.obj_name ?? null },
            model:       _mr ? { modId: _mr.mod_id ?? null, modName: _mr.mod_name ?? null, position: _mwPos } : null,
            sceneObject: {
              name: obj3d.name ?? null, type: obj3d.type ?? null, uuid: obj3d.uuid ?? null,
              position: _sp ? { x: _sp.x, y: _sp.y, z: _sp.z } : null,
              ..._rc,
            },
          };
        }
        tjsBusEmit(object, obj3d, modelsRoot, { ..._rc, modelWorldPos: _mwPos });
        state?.localEvents?.dispatchEvent(new CustomEvent('selectionChanged', { detail: state.appContext?.lastHit ?? null }));
      },
    });

    const cutTool = tjsCreateCutTool({
      THREE,
      scene,
      renderer,
      camera,
      domEl: renderer.domElement,
      cmdUI: null,                              // UI gestita da cutManager (right panel)
      transformTool,
      selectableRoot: modelsRoot,
      initialMode: "basic",
      markDirty: () => state?.markDirty?.(),   // closure lazy: state esiste quando viene chiamata
    });

    // --- Stato (creato PRIMA di observer/loop per evitare riferimenti prematuri) ---
    const state = {
      stopped: false,
      _renderDirty: 2,   // frame da renderizzare: >0 = render, 0 = idle
      // Collima, Misura e mirino EyeLock: si scartano parti tolte dal taglio e piani di taglio
      pointHitFilter: (h) => !(cutTool.isHitClipped(h) || cutTool.isPlaneActor(h?.object)),
      panel,
      headerEl,
      bodyEl,
      prevBodyStyle,
      object,            // record DB oggetto corrente (necessario a TJS-flow-runner)
      signal,            // AbortSignal del pannello (usato anche dalle estensioni)
      ext:               null,   // host delle estensioni (TJS-extensions.mjs), creato sotto
      _xrLoop:           false,  // true = ciclo di renderer.setAnimationLoop (WebXR)

      scene,
      camera,
      renderer,
      ctx: controlsCtx,  // riferimento condiviso: TJS-projection e TJS-mainviews lo aggiornano

      controlsMgr,
      orbitControls: orbit,
      eyeLockControls: eye,
      activeControls: "orbit",
      orbitDistance: null,

      reticleEl,
      transformTool,
      cutTool,
      modelsRoot,
      clay,                       // materiale clay del pannello (TJS-clay.mjs)

      resizeObserver: null,
      resizeRAF: 0,
      rafId: 0,

      // Flow embedded (flow_type='object' collegati a questo oggetto)
      appContext:         null,  // iniettato da tjsLoadFlows
      flowGraphs:         [],    // LGraph[] — uno per ogni flow collegato
      stats:              null,  // Stats.js (three/addons/libs/stats.module.js), lazy — vedi getRightMenu
      // EventTarget locale, indipendente dall'App Bus — sorgente per i nodi
      // flow TJS/Events/* (vedi TJS-flow-nodes.mjs), stesso principio di
      // model_PDF.mjs/model_MPS.mjs.
      localEvents:        new EventTarget(),

      // Punti collimati via raycast
      // Array SEMPRE mutato in-place (push/splice) — non sostituire con = []
      // così appContext.collimatedPoints punta sempre allo stesso oggetto.
      collimatedPoints:   [],
      pickManager:        null,  // iniettato dopo tjsLoadFlows
      measureTool:        null,  // strumento di misura distanza
      lightsRoot,                 // TJS_LIGHTS_ROOT (fratello di modelsRoot)
      cameraRoot,                 // TJS_CAMERA_ROOT (fratello di modelsRoot)
      rightContainer,             // div flex-colonna pannelli destra
      sceneTree:          null,  // pannello ad albero oggetti scena
      lightManager:       null,  // pannello gestione luci
      cameraManager:      null,  // pannello gestione camere
      envManager:         null,  // pannello impostazioni ambiente
      materialEditor:     null,  // pannello editor materiali PBR
      cutManager:         null,  // pannello gestione clipping (right-side)
      composer,
      renderPass,
      outputPass,
      aoPass:             null,   // GTAOPass (occlusione ambientale), solo quando accesa
      models,                    // righe DB modelli, utile a pickManager per mod_id
      modelWarnings:      [],    // correzioni automatiche sui modelli (TJS-model-check.mjs), menu "Avvisi modelli"
    };

    bodyEl[STATE_KEY] = state;
    ACTIVE_BODIES.add(bodyEl);

    // markDirty: segnala che il prossimo frame deve essere renderizzato.
    // Chiamato da orbit 'change', resize, sub-moduli con slider real-time.
    state.markDirty = () => { state._renderDirty = 2; };

    // Estensioni (walkthrough, audio, zone… installate dai nodi FLE di capacità):
    // si agganciano al ciclo, ai controlli e ai menu di questo pannello — vedi
    // TJS-extensions.mjs e _doc/module-tjs-threejs.md §5.16.
    state.ext = TJS_createExtensionHost({
      state, THREE, cmdUI: cmdUI ?? null,
      setControlsMode: (mode) => {
        setControlsMode(bodyEl, mode);
        tjsUpdateControlsToggleButton(headerEl ?? panel, bodyEl);
        tjsUpdateAtToggleButton(headerEl ?? panel, bodyEl);
      },
      setAnimationLoop: (on) => { state._xrLoop = !!on; state._applyLoop?.(); },
    });

    // console shortcut: window.__tjs = bodyEl.__TJS_RENDER_STATE__
    // → window.__tjs.cutTool.setStencilDebug(1)
    window.__tjs = state;

    // cleanup per istanza legato al signal del template
    attachAbortCleanup(signal, bodyEl);

    // --- ResizeObserver (FIX: non usa state prima che esista) ---
    let lastW = 0;
    let lastH = 0;

    const resizeObserver = new ResizeObserver(() => {
      if (state.resizeRAF) return;
      state.resizeRAF = requestAnimationFrame(() => {
        state.resizeRAF = 0;
        if (state.stopped) return;
        if (renderer.xr?.isPresenting) return;   // in VR le dimensioni le decide il visore

        const w = bodyEl.clientWidth || 1;
        const h = bodyEl.clientHeight || 1;
        if (w === lastW && h === lastH) return;
        lastW = w;
        lastH = h;

        const cam = state.camera;

        if (cam.isPerspectiveCamera) {
          cam.aspect = w / h;
          cam.updateProjectionMatrix();
        } else if (cam.isOrthographicCamera) {
          const aspect = w / h;
          const halfH = (cam.top - cam.bottom) / 2;
          cam.left = -halfH * aspect;
          cam.right = halfH * aspect;
          cam.updateProjectionMatrix();
        }

        renderer.setSize(w, h, false);
        state.composer?.setSize(w, h);   // ridimensiona anche il pass GTAO
        state.markDirty?.();
      });
    });

    resizeObserver.observe(bodyEl);
    state.resizeObserver = resizeObserver;

    // --- Toolbar icons sync (FIX: cerca in headerEl/panel, non in bodyEl) ---
    // Poiché i bottoni sono creati dal template nella toolbar dell’header.
    tjsUpdateProjectionToggleButton(headerEl ?? panel, bodyEl);
    tjsUpdateControlsToggleButton(headerEl ?? panel, bodyEl);
    tjsUpdateAtToggleButton(headerEl ?? panel, bodyEl);

    // --- Load models ---
    // (2026-10-03) I modelli "senza file" (nessun mod_abs_url, scelti con "Nessun
    // file" nella modale Modelli) non si caricano: la scena riceve i dati da un
    // flow. Restano comunque in state.models (mod_spec e lista per i nodi).
    const arr = (Array.isArray(models) ? models : []).filter(m => !!m?.mod_abs_url);
    if (arr.length) {
      cmdUI?.show({
        status: t("app.tjs.load.progress.@", { n: 0, total: arr.length }),
        hints: "",
      });

      let loadedCount = 0;

      const tasks = arr.map(async (row, idx) => {
        const label =
          row?.mod_name || row?.mod_id || row?.mod_abs_url || `#${idx + 1}`;

        try {
          const obj3d = await loadAnyModel(row, {
            onProgress: (loaded, total) => {
              // best-effort: non spammare troppo, ma aggiorna
              if (total > 0) {
                cmdUI?.update({
                  status: t("app.tjs.load.file", {
                    name: label,
                    pct: Math.round((loaded / total) * 100),
                    n: loadedCount,
                    total: arr.length,
                  }),
                });
              }
            },
          });

          // se nel frattempo è stato abortito: smonta subito ciò che hai creato
          if (signal?.aborted || state.stopped) {
            disposeObject3D(obj3d);
            return { ok: false, label, error: new Error("aborted") };
          }

          // normali mancanti & co.: corrette qui, con traccia (console, registro attività, menu)
          const warn = TJS_checkModel(obj3d, { modId: row.mod_id ?? null, modName: row.mod_name ?? "", url: row.mod_abs_url ?? "", app: "TJS" });
          if (warn) state.modelWarnings.push(warn);

          const g = new THREE.Group();
          g.name     = row.mod_name || `MODEL_${idx}`;
          g.userData = { modelRow: row };
          g.add(obj3d);
          applyModSpecTransform(g, row);
          applyModSpecStyle(g, row);
          modelsRoot.add(g);

          loadedCount += 1;
          cmdUI?.update({ status: t("app.tjs.load.progress.@", { n: loadedCount, total: arr.length }) });

          return { ok: true, label, obj: g };
        } catch (err) {
          loadedCount += 1;
          cmdUI?.update({ status: t("app.tjs.load.error_on", { name: label, n: loadedCount, total: arr.length }) });
          return { ok: false, label, error: err };
        }
      });

      const results = await Promise.all(tasks);
      const failed = results.filter((r) => !r.ok);

      if (failed.length) {
        console.warn("TJS: alcuni modelli non sono stati caricati:", failed);
      }

      // Fit camera
      try {
        fitCameraFallback(camera, orbit, modelsRoot, { fitOffset: 1.25 });
      } catch (e) {
        console.warn("TJS: fit camera fallito:", e);
      }
      state.markDirty?.();

      const nWarn = state.modelWarnings.length;
      cmdUI?.update({
        status: (failed.length
          ? t("app.tjs.load.done_errors", { n: failed.length })
          : t("app.tjs.load.done")) +
          (nWarn ? " " + t("app.tjs.load.corrected.@", { n: nWarn }) : ""),
      });
    } else {
      cmdUI?.show({ status: t("app.tjs.load.no_models.@"), hints: "" });
    }

    // --- Flow embedded ---
    // (2026-10-07) niente reazioni automatiche ai messaggi del bus (TJS-bus.mjs): le
    // reazioni a un altro pannello si costruiscono con un flow
    await tjsLoadFlows(state, signal);

    // --- Pick manager (punti collimati via raycast) ---
    state.pickManager = tjsCreatePickManager({
      state, models, bodyEl, containerEl: rightContainer,
      scene, camera, renderer, modelsRoot,
      cmdUI, onClose: syncRightUI, signal,
    });

    // --- Measure tool (distanza fra due punti) ---
    state.measureTool = tjsCreateMeasureTool({
      scene, camera, renderer, modelsRoot,
      getActiveControls: () => state.activeControls,
      getState: () => state,
      markDirty: state.markDirty,
      containerEl: rightContainer,
      cmdUI, onClose: syncRightUI, signal,
    });

    // --- Scene tree (pannello ad albero oggetti) ---
    state.sceneTree = tjsCreateSceneTree({
      THREE, modelsRoot, bodyEl, containerEl: rightContainer, signal,
      markDirty: state.markDirty,
      onSelect: (obj) => state.transformTool?.selectObject(obj),
    });

    // --- Light manager (pannello gestione luci) ---
    state.lightManager = tjsCreateLightManager({
      THREE,
      scene,
      lightsRoot,
      models: arr,
      bodyEl,
      containerEl: rightContainer,
      modelsRoot,
      transformTool,
      cmdUI: cmdUI ?? null,
      signal,
      markDirty: state.markDirty,
    });

    // --- Camera manager (pannello gestione camere) ---
    state.cameraManager = tjsCreateCameraManager({
      THREE,
      scene,
      cameraRoot,
      models: arr,
      bodyEl,
      containerEl: rightContainer,
      transformTool,
      getRenderCamera: () => state.camera,
      setRenderCamera: (cam) => {
        state.camera = cam;
        state.orbitControls.object = cam;
        state.orbitControls.update();
        state.ctx.camera = cam;
        if (state.renderPass) state.renderPass.camera = cam;
        _rebuildAOForCamera();
      },
      cmdUI: cmdUI ?? null,
      signal,
    });

    // --- Environment manager (pannello impostazioni ambiente) ---
    state.envManager = tjsCreateEnvManager({
      THREE,
      scene,
      renderer,
      models: arr,
      bodyEl,
      containerEl: rightContainer,
      markDirty: state.markDirty,
      modelsRoot,
      clay,
      getBaseLights: () => ({
        ambient: scene.getObjectByName("TJS_BASE_AMBIENT"),
        sun:     scene.getObjectByName("TJS_BASE_SUN"),
      }),
      enableAO:  (params) => _enableAO(params),
      disableAO: () => _disableAO(),
      updateAO:  (params) => _updateAO(params),
      getGrid: () => scene.getObjectByName('TJS_GRID') ?? null,
      setGrid: (opts) => {
        // Trova la griglia esistente
        const existing = scene.getObjectByName('TJS_GRID');

        // Visibilità: può essere cambiata senza ricreare
        if (opts.visible !== undefined && existing) {
          existing.visible = opts.visible;
        }

        // Se cambiano size/divisions/colori → ricrea la griglia
        const needRebuild = (
          opts.size !== undefined ||
          opts.divisions !== undefined ||
          opts.colorCenter !== undefined ||
          opts.colorGrid !== undefined
        );

        if (needRebuild) {
          const size        = opts.size        ?? GRID.size;
          const divisions   = opts.divisions   ?? GRID.divisions;
          const colorCenter = opts.colorCenter ?? 0x3355ff;
          const colorGrid   = opts.colorGrid   ?? 0x808080;
          const visible     = opts.visible     ?? (existing?.visible ?? true);

          if (existing) scene.remove(existing);

          const newGrid = new THREE.GridHelper(size, divisions, colorCenter, colorGrid);
          newGrid.name = 'TJS_GRID';
          newGrid.visible = visible;
          scene.add(newGrid);

          // Aggiorna costanti locali per coerenza
          GRID.size = size;
          GRID.divisions = divisions;
        }
      },
      cmdUI: cmdUI ?? null,
      signal,
    });

    // --- Material editor (pannello proprietà PBR materiale selezionato) ---
    state.materialEditor = tjsCreateMaterialEditor({
      THREE,
      bodyEl,
      containerEl: rightContainer,
      cmdUI: cmdUI ?? null,
      signal,
      markDirty: state.markDirty,
    });

    // --- Cut manager (pannello right-side per sezioni/clipping) ---
    state.cutManager = tjsCreateCutManager({
      cutTool,
      models,
      containerEl: rightContainer,
      transformTool,
      // vista di fronte alla sezione: dal lato tolto, inquadrando i target
      onViewPlane: (id) => {
        const v = cutTool.getPlaneView(id);
        if (v) tjsViewAlongDirection(state, v.center, v.radius, v.dir);
      },
      cmdUI:       cmdUI ?? null,
      signal,
      markDirty:   state.markDirty,
    });

    // --- Sync stato right container (nessun pannello aperto all'inizio → niente bordo) ---
    _syncRightContainer(rightContainer, state);

    // Ripristina punti eventualmente già salvati in mod_spec del primo modello
    try {
      const rawSpec = arr[0]?.mod_spec ?? null;
      const spec    = rawSpec
        ? (typeof rawSpec === 'string' ? JSON.parse(rawSpec) : rawSpec)
        : null;
      if (Array.isArray(spec?.collimatedPoints) && spec.collimatedPoints.length) {
        state.pickManager.loadPoints(spec.collimatedPoints);
      }
    } catch (e) {
      console.warn('[TJS] loadPoints da mod_spec:', e);
    }

    // --- Render loop (legato allo stato) ---
    // On-demand: renderizza solo quando _renderDirty > 0.
    // orbit 'change' → markDirty(); flow graph → markDirty() chiamato
    // direttamente dai nodi (_ctxDirty in TJS-flow-nodes.mjs) durante il loro
    // stesso runStep/onAction — non serve un flag intermedio da rileggere qui
    // dopo (rimosso _visualChanged 2026-09-19: era un secondo canale per lo
    // stesso segnale, ridondante con markDirty() e per giunta cieco su
    // qualunque LGraph non presente in questo stesso array — es. il grafo
    // dell'editor FLE in "Testa su panel", che non è mai un elemento di
    // state.flowGraphs).
    // Con 2 frame di sicurezza si garantisce il damping finale e il buffer swap.
    // GTAO è deterministico → dirty flag funziona uguale anche con l'occlusione attiva.
    // --- Occlusione ambientale (GTAO, 2026-10-18) ---
    // Parametri in unità di scena (raggio, spessore), non dipendono da near/far come il vecchio
    // SSAO. Durante il calcolo dell'occlusione si nascondono gli elementi di lavoro (maniglie di
    // luci e camere, gizmo, piani e riempimento del taglio) e il materiale delle normali riceve i
    // piani di taglio attivi, così le parti tolte non producono ombre sporche sulla sezione.
    function _aoExcluded() {
      return [
        lightsRoot, cameraRoot, state.transformTool?.helper,
        modelsRoot.getObjectByName("_helper"),
        scene.getObjectByName("TJS_CUT_STENCIL_ROOT"),
      ].filter(Boolean);
    }

    function _enableAO(params) {
      _disableAO();
      const w = bodyEl.clientWidth || 1, h = bodyEl.clientHeight || 1;
      const pass = new GTAOPass(scene, state.camera, w, h);
      const origRender = pass.render.bind(pass);
      pass.render = (...args) => {
        const hidden = _aoExcluded().filter(o => o.visible);
        hidden.forEach(o => { o.visible = false; });
        const planes = state.cutTool?.activeClipPlanes ?? null;
        if (pass.normalMaterial.clippingPlanes !== planes) {
          pass.normalMaterial.clippingPlanes = planes;
          pass.normalMaterial.needsUpdate = true;
        }
        try { origRender(...args); } finally { hidden.forEach(o => { o.visible = true; }); }
      };
      state.aoPass = pass;
      _updateAO(params);
      const idx = state.composer.passes.indexOf(state.outputPass);
      state.composer.insertPass(pass, idx >= 0 ? idx : state.composer.passes.length - 1);
      state.composer.setSize(w, h);
      state.markDirty?.();
    }

    function _disableAO() {
      if (!state.aoPass) return;
      state.composer.removePass(state.aoPass);
      state.aoPass.dispose?.();
      state.aoPass = null;
      state.markDirty?.();
    }

    function _updateAO(params = {}) {
      const pass = state.aoPass;
      if (!pass) return;
      const g = {};
      if (typeof params.radius    === 'number') g.radius    = params.radius;
      if (typeof params.thickness === 'number') g.thickness = params.thickness;
      if (typeof params.samples   === 'number') g.samples   = params.samples;
      pass.updateGtaoMaterial(g);
      if (typeof params.intensity === 'number') pass.blendIntensity = params.intensity;
      if (typeof params.debug     === 'boolean') pass.output = params.debug ? GTAOPass.OUTPUT.Denoise : GTAOPass.OUTPUT.Default;
      // l'occlusione si spegne fuori dalla box del modello (griglia, sfondo)
      if (params.box && !params.box.isEmpty()) {
        const b = params.box.clone();
        b.expandByScalar(b.getSize(new THREE.Vector3()).length() * 0.05);
        pass.setSceneClipBox(b);
      }
      state.markDirty?.();
    }

    // GTAOPass compila lo shader per il tipo di camera: cambiando camera (prospettiva/ortografica,
    // camere salvate) si ricrea il pass con gli stessi parametri
    function _rebuildAOForCamera() {
      if (!state.aoPass || state.aoPass.camera === state.camera) return;
      const p = state.envManager?.aoParams?.();
      if (p) _enableAO(p); else state.aoPass.camera = state.camera;
    }

    const timer = new THREE.Timer();   // THREE.Clock è deprecato dalla r183

    const tick = () => {
      if (state.stopped) return;

      timer.update();
      const dt = timer.getDelta();
      // Controls aggiornati sempre: il damping di OrbitControls richiede update()
      // continuo anche senza render. EyeLockControls.update() ritorna true solo
      // quando la camera si è effettivamente mossa → markDirty per render.
      // Per orbit il 'change' event fa già markDirty; la doppia chiamata è no-op.
      if (state.controlsMgr?.update(dt)) state.markDirty?.();

      // Estensioni: lavoro per frame (movimento in prima persona, zone, …)
      if (state.ext?.frame(dt, timer.getElapsed())) state.markDirty?.();
      // In WebXR si disegna ogni frame (il visore non tiene l'immagine precedente)
      if (state._xrLoop) state._renderDirty = Math.max(state._renderDirty, 1);

      // Tick manuale dei grafi LiteGraph (il setInterval interno è stato spento).
      // Un nodo che modifica la scena chiama markDirty() direttamente (via
      // _ctxDirty) durante questo stesso runStep — state._renderDirty risulta
      // già aggiornato quando il ciclo finisce, nessun controllo aggiuntivo qui.
      for (const g of state.flowGraphs) {
        try { g.runStep(1); } catch { /* noop */ }
      }

      // Skip render se niente è cambiato (vale anche con GTAO attivo).
      if (state._renderDirty <= 0) return;
      state._renderDirty--;

      state.cutTool?.beforeRender?.();

      // Sincronizza camera se cambiata dal cameraManager
      if (state.renderPass?.camera !== state.camera) {
        state.renderPass.camera = state.camera;
        _rebuildAOForCamera();
      }

      // Bypass EffectComposer quando non ci sono pass post-processing attivi:
      // risparmia il doppio render target + blit e usa il framebuffer diretto.
      // renderer.toneMapping e outputColorSpace garantiscono la stessa qualità visiva.
      // stats.js misura solo i frame realmente disegnati (render on-demand,
      // vedi sopra) — coerente col fatto che questo renderer NON ridisegna
      // ad ogni tick RAF: mostra quanto costa un render vero, non un FPS
      // fittizio legato al tick del browser.
      state.stats?.begin();
      if (state.aoPass && !renderer.xr?.isPresenting) {
        state.composer.render(dt);
      } else {
        renderer.render(scene, state.camera);
      }
      state.stats?.end();
    };

    // Due modi di far girare tick: requestAnimationFrame (normale) oppure
    // renderer.setAnimationLoop, obbligatorio in WebXR — lo chiede un'estensione
    // con api.setAnimationLoop(true).
    const rafLoop = () => {
      if (state.stopped) return;
      state.rafId = requestAnimationFrame(rafLoop);
      tick();
    };
    state._applyLoop = () => {
      if (state.stopped || !state._loopStarted) return;
      if (state._xrLoop) {
        if (state.rafId) cancelAnimationFrame(state.rafId);
        state.rafId = 0;
        renderer.setAnimationLoop(tick);
      } else {
        renderer.setAnimationLoop(null);
        if (!state.rafId) rafLoop();
      }
    };

    // Le estensioni installate dai flow (es. walkthrough) devono essere pronte prima
    // del primo frame: l'utente non deve vedere per un attimo la vista orbitale.
    await state.ext.whenReady();
    if (state.stopped) return;
    state._loopStarted = true;
    state._applyLoop();
  },

  getLeftMenu({ object, bodyEl }) {
    const st = bodyEl?.[STATE_KEY];
    // Voci statiche — commentate per lasciare il menu gestito interamente dai nodi
    // ReseArch/Menu/Command e ReseArch/Menu/Status del flow embedded (aggiunti da
    // template_XXX.mjs per tutte le App, app/shared/panel-flow.mjs).
    // Per riabilitare: decommentare le righe desiderate.
    // Esempio struttura voce azione:  { id: "my-cmd",    label: "Etichetta", onClick: () => { ... } }
    // Esempio struttura voce status:  { id: "my-status", label: "Etichetta", getValue: () => "valore live" }
    const staticItems = [
      // { id: "mode-orbit",   label: "Orbit",   onClick: () => setControlsMode(bodyEl, "orbit") },
      // { id: "mode-eyelock", label: "EyeLock", onClick: () => setControlsMode(bodyEl, "eyelock") },
    ];
    // Voci delle estensioni installate (TJS-extensions.mjs, side "left")
    const extItems = st?.ext?.menu('left') ?? [];
    const items = [
      ...staticItems,
      ...(extItems.length     ? [{ type: 'divider' }, ...extItems]     : []),
    ];
    return { title: getObjectDisplayName(object), items };
  },

  getRightMenu({ bodyEl }) {
    const st = bodyEl?.[STATE_KEY];
    // Voce statica: toggle statistiche di prestazione (stats.js), stesso
    // pattern di "Mostra info canvas" in model_FLE.mjs — libreria caricata
    // lazy al primo utilizzo (three/addons/libs/stats.module.js, già
    // servita dall'importmap Three.js di dashboard.php, nessuna nuova
    // dipendenza). Etichetta statica (non riflette lo stato ON/OFF corrente,
    // il menu non si ricostruisce ad ogni click — stessa limitazione nota
    // già presente in "Mostra info canvas").
    const staticItems = [
      {
        id: 'toggle-stats', label: t('app.tjs.menu.stats'),
        onClick: async () => {
          if (!st) return;
          if (st.stats) {
            st.stats.dom.remove();
            st.stats = null;
            return;
          }
          try {
            const { default: Stats } = await import('three/addons/libs/stats.module.js');
            const stats = new Stats();
            stats.dom.style.position = 'absolute';
            stats.dom.style.top      = '4px';
            stats.dom.style.left     = '4px';
            stats.dom.style.zIndex   = '30';
            bodyEl.appendChild(stats.dom);
            st.stats = stats;
          } catch (e) {
            console.warn('[TJS] stats.module.js non caricato:', e);
          }
        },
      },
      // { id: "models", label: "Oggetti", onClick: () => openModelsPanel() },
      {
        id: 'model-warnings', label: t('app.tjs.menu.model_warnings.@'),
        onClick: () => window.alert(TJS_formatModelWarnings(st?.modelWarnings ?? [])),
      },
    ];
    // I comandi dei nodi ReseArch/Menu/Command (menu "right") li aggiunge template_XXX.mjs
    const extItems = st?.ext?.menu('right') ?? [];
    const items = [
      ...staticItems,
      ...(extItems.length     ? [{ type: 'divider' }, ...extItems]     : []),
    ];
    return { title: "☰", items };
  },

  // FIX: prendiamo headerEl/panel dal ctx, così in futuro puoi fare cose più intelligenti.
  // Qui lo usiamo indirettamente perché i bottoni sono in toolbar (header), non nel body.
  getToolbar({ panel, headerEl, bodyEl }) {
    const root = headerEl ?? panel;

    return {
      items: [
        {
          type: "button",
          id: "btnProjToggle",
          iconClass: "bi bi-box",
          className: "icon-only",
          title: t("app.tjs.tb.axonometric"),
          attrs: { "aria-label": t("app.tjs.tb.axonometric") },
          onClick: () => {
            tjsToggleProjection(bodyEl, STATE_KEY);
            tjsUpdateProjectionToggleButton(root, bodyEl);
          },
        },

        {
          type: "dropdown",
          title: t("app.tjs.tb.views"),
          attrs: { "aria-label": t("app.tjs.tb.views") },
          iconClass: "bi bi-image",
          items: [
            // id e argomento di tjsSetMainView restano i codici interni; l'etichetta è tradotta
            { id: "Front", label: t("app.tjs.view.front"), onClick: () => tjsSetMainView(bodyEl, "Front") },
            { id: "Left", label: t("app.tjs.view.left"), onClick: () => tjsSetMainView(bodyEl, "Left") },
            { id: "Back", label: t("app.tjs.view.back"), onClick: () => tjsSetMainView(bodyEl, "Back") },
            { id: "Right", label: t("app.tjs.view.right"), onClick: () => tjsSetMainView(bodyEl, "Right") },
            { id: "Top", label: t("app.tjs.view.top"), onClick: () => tjsSetMainView(bodyEl, "Top") },
            { id: "Bottom", label: t("app.tjs.view.bottom"), onClick: () => tjsSetMainView(bodyEl, "Bottom") },
          ],
        },


        { type: "divider" },

        {
          type: "button",
          id: "btnCtrlToggle",
          iconClass: "bi bi-eye",
          className: "icon-only",
          title: "EyeLock",
          attrs: { "aria-label": "EyeLock" },
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st) return;

            // da EyeLock o da un controllo di un'estensione (es. walkthrough) si torna a Orbit
            const next = st.activeControls === "orbit" ? "eyelock" : "orbit";
            setControlsMode(bodyEl, next);

            tjsUpdateControlsToggleButton(root, bodyEl);
            tjsUpdateAtToggleButton(root, bodyEl);
          },
        },

        {
          type: "button",
          id: "btnAtToggle",
          iconClass: "bi bi-box-arrow-in-down-right",
          className: "icon-only",
          title: t("app.tjs.tb.target_at"),
          attrs: { "aria-label": t("app.tjs.tb.target_at") },
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st?.transformTool) return;

            if (st.activeControls === "orbit") {
              tjsTargetAtSelection(bodyEl, STATE_KEY);
            } else {
              tjsCameraAtSelection(bodyEl, STATE_KEY);
            }

            tjsUpdateAtToggleButton(root, bodyEl);
          },
        },


      { type: "divider" },
        {
          type: "button",
          id: "btnPickToggle",
          iconClass: "bi bi-geo-alt",
          className: "icon-only",
          title: t("app.tjs.tb.pick"),
          attrs: { "aria-label": t("app.tjs.tb.pick") },
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st?.pickManager) return;
            const next = !st.pickManager.isActive();
            // Mutua esclusione con il misuratore
            if (next && st.measureTool?.isActive()) {
              st.measureTool.setActive(false);
              tjsUpdateMeasureToggleButton(root, bodyEl);
            }
            st.pickManager.setActive(next);
            tjsUpdatePickToggleButton(root, bodyEl);
            _syncRightContainer(st.rightContainer, st);
          },
        },

        {
          type: "button",
          id: "btnMeasure",
          iconClass: "bi bi-rulers",
          className: "icon-only",
          title: t("app.tjs.tb.measure"),
          attrs: { "aria-label": t("app.tjs.tb.measure") },
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st?.measureTool) return;
            const next = !st.measureTool.isActive();
            // Mutua esclusione con la collimazione
            if (next && st.pickManager?.isActive()) {
              st.pickManager.setActive(false);
              tjsUpdatePickToggleButton(root, bodyEl);
            }
            st.measureTool.setActive(next);
            tjsUpdateMeasureToggleButton(root, bodyEl);
            _syncRightContainer(st.rightContainer, st);
          },
        },

      { type: "divider" },

      /*
      {
          type: "button",
          id: "btnOff",
          iconClass: "bi bi-lightbulb-off",
          className: "icon-only",
          title: "Off oggetti selezionati",
          onClick: () => tjsHideSelected(bodyEl, STATE_KEY),
        },
        {
          type: "button",
          id: "btnWireframe",
          iconClass: "bi bi-box-fill",
          className: "icon-only",
          title: "Wireframe selezione",
          onClick: () => tjsToggleWireframeSelected(bodyEl, STATE_KEY),
        },
        */
  
        {
          type: "button",
          id: "btnLayers",
          iconClass: "bi bi-layers",
          className: "icon-only",
          title: t("app.tjs.tree.title"),
          attrs: { "aria-label": t("app.tjs.tree.title") },
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st?.sceneTree) return;
            st.sceneTree.toggle();
            tjsUpdateLayersButton(root, bodyEl);
            _syncRightContainer(st.rightContainer, st);
          },
        },
        {
          type: "button",
          id: "btnLightMgr",
          iconClass: "bi bi-sun",
          className: "icon-only",
          title: t("app.tjs.tb.lights"),
          attrs: { "aria-label": t("app.tjs.tb.lights") },
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st?.lightManager) return;
            st.lightManager.toggle();
            tjsUpdateLightMgrButton(root, bodyEl);
            _syncRightContainer(st.rightContainer, st);
          },
        },
        {
          type: "button",
          id: "btnCameraMgr",
          iconClass: "bi bi-camera-video",
          className: "icon-only",
          title: t("app.tjs.tb.cameras"),
          attrs: { "aria-label": t("app.tjs.tb.cameras") },
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st?.cameraManager) return;
            st.cameraManager.toggle();
            tjsUpdateCameraMgrButton(root, bodyEl);
            _syncRightContainer(st.rightContainer, st);
          },
        },
        {
          type: "button",
          id: "btnEnvMgr",
          iconClass: "bi bi-sliders",
          className: "icon-only",
          title: t("app.tjs.tb.env"),
          attrs: { "aria-label": t("app.tjs.tb.env") },
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st?.envManager) return;
            st.envManager.toggle();
            tjsUpdateEnvMgrButton(root, bodyEl);
            _syncRightContainer(st.rightContainer, st);
          },
        },
        {
          type: "button",
          id: "btnMaterialEditor",
          iconClass: "bi bi-palette2",
          className: "icon-only",
          title: t("app.tjs.tb.material"),
          minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
          attrs: { "aria-label": t("app.tjs.tb.material") },
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st?.materialEditor) return;
            st.materialEditor.toggle();
            tjsUpdateMaterialEditorButton(root, bodyEl);
            _syncRightContainer(st.rightContainer, st);
          },
        },

      { type: "divider" },

        {
          type: "button",
          id: "btnMove",
          iconClass: "bi bi-arrows-move",
          className: "icon-only",
          title: t("app.tjs.tb.translate"),
          minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
          attrs: { "aria-label": t("app.tjs.tb.translate") },
          onClick: () => bodyEl?.[STATE_KEY]?.transformTool?.setMode?.("translate"),
        },
        {
          type: "button",
          id: "btnRotate",
          iconClass: "bi bi-arrow-clockwise",
          className: "icon-only",
          title: t("app.tjs.tb.rotate"),
          minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
          attrs: { "aria-label": t("app.tjs.tb.rotate") },
          onClick: () => bodyEl?.[STATE_KEY]?.transformTool?.setMode?.("rotate"),
        },
        {
          type: "button",
          id: "btnScale",
          iconClass: "bi bi-aspect-ratio",
          className: "icon-only",
          title: t("app.tjs.tb.scale"),
          minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
          attrs: { "aria-label": t("app.tjs.tb.scale") },
          onClick: () => bodyEl?.[STATE_KEY]?.transformTool?.setMode?.("scale"),
        },

      { type: "divider" },

        {
          type: "button",
          id: "btnClip",
          iconClass: "bi bi-scissors",
          className: "icon-only",
          title: t("app.tjs.tb.clip"),
          attrs: { "aria-label": t("app.tjs.tb.clip") },
          onClick: () => {
            const st = bodyEl?.[STATE_KEY];
            if (!st?.cutTool || !st?.cutManager) return;

            const cutTool = st.cutTool;
            const tt = st.transformTool;

            // i piani di taglio selezionati non contano come oggetti da tagliare
            const selection  = Array.isArray(tt?.selection)
              ? tt.selection.filter((o) => o && !cutTool.isPlaneActor(o))
              : [];
            const prevTargets = Array.isArray(cutTool?.targetRoots) ? cutTool.targetRoots : [];
            const hasPrev = prevTargets.length > 0;
            const hasSel  = selection.length > 0;

            // Nessun target e nessuna selezione → apri il pannello (mostrerà stato vuoto)
            // Nessun target e nessuna selezione → si tagliano tutti i modelli caricati
            if (!hasPrev && !hasSel) {
              const all = (st.modelsRoot?.children ?? []).filter((o) =>
                o?.isObject3D && o.name !== "_helper" && o.name !== "TJS_MULTI_PIVOT");
              if (all.length) cutTool.setTargets(all, { resetDefaults: true });
              st.cutManager.show();
              tjsUpdateClipButton(root, bodyEl);
              _syncRightContainer(st.rightContainer, st);
              return;
            }

            // Nessun target, selezione disponibile → imposta target + apri pannello
            if (!hasPrev && hasSel) {
              if (selection.length === 1) cutTool.setTarget(selection[0], { resetDefaults: true });
              else                        cutTool.setTargets(selection,   { resetDefaults: true });
              st.cutManager.show();
              tjsUpdateClipButton(root, bodyEl);
              _syncRightContainer(st.rightContainer, st);
              return;
            }

            // Target esistente, nessuna selezione → toggle pannello
            if (hasPrev && !hasSel) {
              st.cutManager.toggle();
              tjsUpdateClipButton(root, bodyEl);
              _syncRightContainer(st.rightContainer, st);
              return;
            }

            // Target esistente + nuova selezione → chiedi se cambiare target
            const ok = window.confirm(t("app.tjs.tb.clip_confirm"));
            if (ok) {
              cutTool.disable();
              if (selection.length === 1) cutTool.setTarget(selection[0], { resetDefaults: true });
              else                        cutTool.setTargets(selection,   { resetDefaults: true });
            }
            st.cutManager.show();
            tjsUpdateClipButton(root, bodyEl);
            _syncRightContainer(st.rightContainer, st);
          },
        },


        { type: "spacer", width: 6 },

        {
          type: "button",
          id: "btnErase",
          iconClass: "bi bi-eraser",
          className: "icon-only",
          title: t("app.tjs.tb.erase"),
          minLevel: 20,   // strumento in memoria: dal livello utente (_doc/arch-permessi.md §11.4)
          attrs: { "aria-label": t("app.tjs.tb.erase") },
          onClick: () => tjsEraseSelected(bodyEl, STATE_KEY),
        },
      ],
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

function attachAbortCleanup(signal, bodyEl) {
  if (!signal || typeof signal.addEventListener !== "function") return;
  signal.addEventListener(
    "abort",
    () => {
      destroyBodyInstance(bodyEl);
    },
    { once: true }
  );
}

function destroyBodyInstance(bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st) return;

  st.stopped = true;

  try {
    if (st.rafId) cancelAnimationFrame(st.rafId);
  } catch {}
  try { st.renderer?.setAnimationLoop?.(null); } catch {}

  // estensioni: per prime, mentre scena/controlli/renderer esistono ancora
  try { st.ext?.dispose?.(); } catch {}

  try {
    if (st.resizeRAF) cancelAnimationFrame(st.resizeRAF);
  } catch {}

  try {
    st.resizeObserver?.disconnect?.();
  } catch {}

  // flow graphs embedded
  try {
    for (const g of st.flowGraphs ?? []) { g.stop?.(); }
    st.flowGraphs = [];
  } catch {}

  // pick manager
  try { st.pickManager?.dispose?.(); } catch {}

  // measure tool
  try { st.measureTool?.dispose?.(); } catch {}

  // scene tree panel
  try { st.sceneTree?.dispose?.(); } catch {}

  // light manager panel
  try { st.lightManager?.dispose?.(); } catch {}

  // camera manager panel
  try { st.cameraManager?.dispose?.(); } catch {}

  // stats.js overlay (se attivato dal menu destro)
  try { st.stats?.dom?.remove(); } catch {}

  // env manager panel
  try { st.envManager?.dispose?.(); } catch {}

  // material editor panel
  try { st.materialEditor?.dispose?.(); } catch {}

  // cut manager panel
  try { st.cutManager?.dispose?.(); } catch {}

  // aoPass (GTAO)
  try { if (st.aoPass) { st.composer?.removePass?.(st.aoPass); st.aoPass.dispose?.(); } } catch {}

  // lights root (TJS_LIGHTS_ROOT)
  try {
    if (st.lightsRoot?.parent) st.lightsRoot.parent.remove(st.lightsRoot);
  } catch {}

  // camera root (TJS_CAMERA_ROOT)
  try {
    if (st.cameraRoot?.parent) st.cameraRoot.parent.remove(st.cameraRoot);
  } catch {}

  // right panel container
  try { st.rightContainer?.remove?.(); } catch {}

  // tools (se espongono destroy/dispose)
  try { st.cutTool?.destroy?.(); } catch {}
  try { st.cutTool?.dispose?.(); } catch {}
  try { st.transformTool?.destroy?.(); } catch {}
  try { st.transformTool?.dispose?.(); } catch {}

  // controls
  try { st.controlsMgr?.stop?.(); } catch {}
  try { st.orbitControls?.dispose?.(); } catch {}

  // scene objects
  try { disposeObject3D(st.modelsRoot); } catch {}
  try {
    // rimuovi root dalla scena
    if (st.modelsRoot?.parent) st.modelsRoot.parent.remove(st.modelsRoot);
  } catch {}

  // reticle DOM
  try { st.reticleEl?.remove?.(); } catch {}

  // renderer / canvas
  try {
    const canvas = st.renderer?.domElement;
    // rimuovi canvas dal DOM se ancora presente
    if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
  } catch {}

  try { st.composer?.dispose?.(); } catch {}
  try { st.renderer?.dispose?.(); } catch {}
  try { st.renderer?.forceContextLoss?.(); } catch {}

  // ripristino style bodyEl
  try {
    bodyEl.style.position = st.prevBodyStyle?.position ?? "";
    bodyEl.style.overflow = st.prevBodyStyle?.overflow ?? "";
  } catch {}

  try { delete bodyEl[STATE_KEY]; } catch {}
  ACTIVE_BODIES.delete(bodyEl);
}

/**
 * Applica la trasformazione definita in mod_spec.transform al gruppo wrapper del modello.
 *
 * Schema mod_spec.transform:
 *   position : [x, y, z]           — default [0,0,0]
 *   rotation : [rx, ry, rz]        — radianti, Euler XYZ  — default [0,0,0]
 *   scale    : [sx, sy, sz]        — default [1,1,1]
 *
 * Se mod_spec.transform è assente, il gruppo rimane con la trasformazione identità.
 */
function applyModSpecTransform(group, row) {
  const spec = row?.mod_spec;
  const raw  = typeof spec === 'string' ? (() => { try { return JSON.parse(spec); } catch { return null; } })() : spec;
  const tr   = raw?.transform;
  if (!tr) return;

  if (Array.isArray(tr.position) && tr.position.length === 3)
    group.position.set(...tr.position);

  if (Array.isArray(tr.rotation) && tr.rotation.length === 3)
    group.rotation.set(...tr.rotation);          // Euler XYZ in radianti

  if (Array.isArray(tr.scale) && tr.scale.length === 3)
    group.scale.set(...tr.scale);
}

/**
 * Override per-istanza di dimensione/forma punto e spessore linea, salvato
 * da TJS-material-editor.mjs in mod_spec.pointsLineStyle (Salva su modello).
 * Marca ogni oggetto toccato con `userData.__pointsLineStyleOverride = true`
 * — è il flag che TJS-env-manager.mjs::_applyPointsLines() controlla per non
 * sovrascrivere questo override con i default globali dell'Ambiente.
 */
function applyModSpecStyle(group, row) {
  const spec  = row?.mod_spec;
  const raw   = typeof spec === 'string' ? (() => { try { return JSON.parse(spec); } catch { return null; } })() : spec;
  const style = raw?.pointsLineStyle;
  if (!style) return;

  group.traverse((obj) => {
    if (obj.isPoints && obj.material) {
      if (typeof style.size            === 'number')  obj.material.size            = style.size;
      if (typeof style.sizeAttenuation === 'boolean') obj.material.sizeAttenuation = style.sizeAttenuation;
      if (style.shape) applyPointShape(obj.material, style.shape);
      obj.material.needsUpdate = true;
      obj.userData.__pointsLineStyleOverride = true;
    } else if (obj.isLine && obj.material) {
      if (typeof style.lineWidth === 'number' && 'linewidth' in obj.material) obj.material.linewidth = style.lineWidth;
      obj.material.needsUpdate = true;
      obj.userData.__pointsLineStyleOverride = true;
    }
  });
}

/** Utility: dispose sicuro di geometrie/materiali/texture */
function disposeObject3D(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose?.();

    if (obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of materials) {
        for (const k of [
          "map",
          "normalMap",
          "roughnessMap",
          "metalnessMap",
          "aoMap",
          "emissiveMap",
          "alphaMap",
        ]) {
          if (m?.[k]) m[k].dispose?.();
        }
        m?.dispose?.();
      }
    }
  });
}

function tjsCreateReticle(bodyEl) {
  const el = document.createElement("div");
  el.className = "tjs-reticle";
  el.style.position = "absolute";
  el.style.left = "50%";
  el.style.top = "50%";
  el.style.transform = "translate(-50%, -50%)";
  el.style.pointerEvents = "none";
  el.style.display = "none";
  el.style.width = "30px";
  el.style.height = "30px";

  const mk = (css) => {
    const s = document.createElement("div");
    s.style.position = "absolute";
    s.style.background = "white";
    s.style.boxShadow = "0 0 2px rgba(0,0,0,9)";
    Object.assign(s.style, css);
    el.appendChild(s);
  };

  const thickness = "2px";
  const arm = "10px";

  mk({ left: "50%", top: "0", width: thickness, height: arm, transform: "translateX(-50%)" });
  mk({ left: "50%", bottom: "0", width: thickness, height: arm, transform: "translateX(-50%)" });
  mk({ top: "50%", left: "0", height: thickness, width: arm, transform: "translateY(-50%)" });
  mk({ top: "50%", right: "0", height: thickness, width: arm, transform: "translateY(-50%)" });

  bodyEl.appendChild(el);
  return el;
}

function getObjectDisplayName(object) {
  if (!object) return t("app.tjs.object_fallback.@");
  return (
    object.obj_name ||
    object.obj_title ||
    object.name ||
    object.title ||
    (object.obj_id != null && object.obj_id !== ""
      ? t("app.tjs.object_id.@", { id: object.obj_id })
      : t("app.tjs.object_fallback.@"))
  );
}

function setControlsMode(bodyEl, mode) {
  const st = bodyEl?.[STATE_KEY];
  if (!st?.controlsMgr) return;

  if (mode === st.activeControls) return;

  if (st.activeControls === "orbit" && mode !== "orbit") {
    // ORBIT -> EYE / estensione: salva distanza orbitale
    const cam = st.camera;
    const orbit = st.orbitControls;
    st.orbitDistance = Math.max(0.001, cam.position.distanceTo(orbit.target));
  }

  if (mode === "orbit") {
    // EYE -> ORBIT: riallinea il target in base alla direzione corrente
    const cam = st.camera;
    const orbit = st.orbitControls;

    const dist = Math.max(0.001, st.orbitDistance ?? 10);
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);

    orbit.target.copy(cam.position).addScaledVector(fwd, dist);
    orbit.update();
  }

  st.controlsMgr.setMode(mode);
  st.activeControls = mode;
  st.markDirty?.();
}

// --- Toolbar button sync (ROOT = headerEl o panel) ---
// FIX: i bottoni sono nella toolbar dell’header, non nel bodyEl.

function tjsUpdateProjectionToggleButton(rootEl, bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st?.camera) return;

  const btn = rootEl?.querySelector?.("#btnProjToggle");
  if (!btn) return;

  const icon = btn.querySelector("i");
  if (!icon) return;

  const isOrtho = !!st.camera.isOrthographicCamera;

  // Mostra l’icona della modalità NON attiva
  icon.className = isOrtho ? "bi bi-gem rotate-90" : "bi bi-box";

  const nextTitle = isOrtho ? t("app.tjs.tb.perspective") : t("app.tjs.tb.axonometric");
  btn.title = nextTitle;
  btn.setAttribute("aria-label", nextTitle);
}

function tjsUpdateControlsToggleButton(rootEl, bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st) return;

  const btn = rootEl?.querySelector?.("#btnCtrlToggle");
  if (!btn) return;

  const icon = btn.querySelector("i");
  if (!icon) return;

  const isEye = st.activeControls !== "orbit";   // EyeLock o controllo di un'estensione

  icon.className = isEye ? "bi bi-compass" : "bi bi-eye";

  const nextTitle = isEye ? "Orbit" : "EyeLock";
  btn.title = nextTitle;
  btn.setAttribute("aria-label", nextTitle);
}

function tjsUpdateAtToggleButton(rootEl, bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  const btn = rootEl?.querySelector?.("#btnAtToggle");
  if (!st || !btn) return;

  const icon = btn.querySelector("i");
  if (!icon) return;

  const isEye = st.activeControls === "eyelock";

  icon.className = isEye
    ? "bi bi-box-arrow-in-up-right"
    : "bi bi-box-arrow-in-down-right";

  const title = isEye
    ? t("app.tjs.tb.camera_at")
    : t("app.tjs.tb.target_at");
  btn.title = title;
  btn.setAttribute("aria-label", title);
}

function tjsUpdatePickToggleButton(rootEl, bodyEl) {
  const st  = bodyEl?.[STATE_KEY];
  const btn = rootEl?.querySelector?.('#btnPickToggle');
  if (!st || !btn) return;

  const icon   = btn.querySelector('i');
  const active = st.pickManager?.isActive() ?? false;

  if (icon) icon.className = active ? 'bi bi-geo-alt-fill' : 'bi bi-geo-alt';

  btn.classList.toggle('active', active);
  btn.title = active ? t('app.tjs.tb.pick_on') : t('app.tjs.tb.pick_off');
  btn.setAttribute('aria-label', btn.title);
}

function tjsUpdateLayersButton(rootEl, bodyEl) {
  const st  = bodyEl?.[STATE_KEY];
  const btn = rootEl?.querySelector?.('#btnLayers');
  if (!st || !btn) return;

  const icon   = btn.querySelector('i');
  const active = st.sceneTree?.isVisible() ?? false;

  if (icon) icon.className = active ? 'bi bi-layers-fill' : 'bi bi-layers';
  btn.classList.toggle('active', active);
  btn.title = active ? t('app.tjs.tb.layers_close') : t('app.tjs.tree.title');
  btn.setAttribute('aria-label', btn.title);
}

function tjsUpdateLightMgrButton(rootEl, bodyEl) {
  const st  = bodyEl?.[STATE_KEY];
  const btn = rootEl?.querySelector?.('#btnLightMgr');
  if (!st || !btn) return;

  const icon   = btn.querySelector('i');
  const active = st.lightManager?.isVisible() ?? false;

  if (icon) icon.className = active ? 'bi bi-sun-fill' : 'bi bi-sun';
  btn.classList.toggle('active', active);
  btn.title = active ? t('app.tjs.tb.lights_close') : t('app.tjs.tb.lights');
  btn.setAttribute('aria-label', btn.title);
}

function tjsUpdateMeasureToggleButton(rootEl, bodyEl) {
  const st  = bodyEl?.[STATE_KEY];
  const btn = rootEl?.querySelector?.('#btnMeasure');
  if (!st || !btn) return;

  const icon   = btn.querySelector('i');
  const active = st.measureTool?.isActive() ?? false;

  if (icon) icon.className = active ? 'bi bi-rulers' : 'bi bi-rulers';

  btn.classList.toggle('active', active);
  btn.title = active
    ? t('app.tjs.tb.measure_on')
    : t('app.tjs.tb.measure');
  btn.setAttribute('aria-label', btn.title);
}

/** Sposta/Ruota/Scala: evidenziato il pulsante della modalità attiva mentre il gizmo è acceso. */
function tjsUpdateTransformButtons(rootEl, bodyEl) {
  const tt = bodyEl?.[STATE_KEY]?.transformTool;
  if (!tt) return;
  for (const [id, m] of [['#btnMove', 'translate'], ['#btnRotate', 'rotate'], ['#btnScale', 'scale']]) {
    const btn = rootEl?.querySelector?.(id);
    if (!btn) continue;
    const on = tt.gizmoEnabled && tt.mode === m;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    // Scala su un piano di taglio non ha senso (cambierebbe solo il riquadro disegnato)
    if (m === 'scale') btn.disabled = !!tt.attachedIsClipPlane;
  }
}

function tjsUpdateCameraMgrButton(rootEl, bodyEl) {
  const st  = bodyEl?.[STATE_KEY];
  const btn = rootEl?.querySelector?.('#btnCameraMgr');
  if (!st || !btn) return;

  const icon   = btn.querySelector('i');
  const active = st.cameraManager?.isVisible() ?? false;

  if (icon) icon.className = active ? 'bi bi-camera-video-fill' : 'bi bi-camera-video';
  btn.classList.toggle('active', active);
  btn.title = active ? t('app.tjs.tb.cameras_close') : t('app.tjs.tb.cameras');
  btn.setAttribute('aria-label', btn.title);
}

function tjsUpdateEnvMgrButton(rootEl, bodyEl) {
  const st  = bodyEl?.[STATE_KEY];
  const btn = rootEl?.querySelector?.('#btnEnvMgr');
  if (!st || !btn) return;

  const icon   = btn.querySelector('i');
  const active = st.envManager?.isVisible() ?? false;

  if (icon) icon.className = active ? 'bi bi-sliders2' : 'bi bi-sliders';
  btn.classList.toggle('active', active);
  btn.title = active ? t('app.tjs.tb.env_close') : t('app.tjs.tb.env');
  btn.setAttribute('aria-label', btn.title);
}

function tjsUpdateClipButton(rootEl, bodyEl) {
  const st  = bodyEl?.[STATE_KEY];
  const btn = rootEl?.querySelector?.('#btnClip');
  if (!st || !btn) return;

  const icon   = btn.querySelector('i');
  const active = st.cutManager?.isVisible() ?? false;
  const on     = st.cutTool?.enabled ?? false;

  if (icon) icon.className = (active || on) ? 'bi bi-scissors' : 'bi bi-scissors';
  btn.classList.toggle('active', active || on);
  btn.title = active ? t('app.tjs.tb.clip_close') : (on ? t('app.tjs.tb.clip_active') : t('app.tjs.tb.clip'));
  btn.setAttribute('aria-label', btn.title);
}

function tjsUpdateMaterialEditorButton(rootEl, bodyEl) {
  const st  = bodyEl?.[STATE_KEY];
  const btn = rootEl?.querySelector?.('#btnMaterialEditor');
  if (!st || !btn) return;

  const icon   = btn.querySelector('i');
  const active = st.materialEditor?.isVisible() ?? false;

  if (icon) icon.className = active ? 'bi bi-palette2' : 'bi bi-palette2';
  btn.classList.toggle('active', active);
  btn.title = active ? t('app.tjs.tb.material_close') : t('app.tjs.tb.material');
  btn.setAttribute('aria-label', btn.title);
}

/**
 * Sincronizza la classe .is-active sul rightContainer:
 * presente solo se almeno un pannello è visibile (mostra il bordo sinistro).
 */
function _syncRightContainer(containerEl, st) {
  if (!containerEl || !st) return;
  const anyVisible = (
    (st.sceneTree?.isVisible()       ?? false) ||
    (st.lightManager?.isVisible()    ?? false) ||
    (st.cameraManager?.isVisible()   ?? false) ||
    (st.envManager?.isVisible()      ?? false) ||
    (st.materialEditor?.isVisible()  ?? false) ||
    (st.cutManager?.isVisible()      ?? false) ||
    (st.transformTool?.panelVisible  ?? false) ||
    (st.pickManager?.isActive()      ?? false) ||
    (st.measureTool?.isActive()      ?? false)
  );
  containerEl.classList.toggle('is-active', anyVisible);
}

/** Utility: fit camera (fallback se non esiste helper globale) */
function fitCameraFallback(camera, controls, object3d, opts = {}) {
  const box = new THREE.Box3().setFromObject(object3d);
  if (box.isEmpty()) return;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxSize = Math.max(size.x, size.y, size.z);
  const fitOffset = opts.fitOffset ?? 1.25;

  const fov = camera.fov * (Math.PI / 180);
  const distance = (maxSize / (2 * Math.tan(fov / 2))) * fitOffset;

  const dir = new THREE.Vector3().subVectors(camera.position, controls?.target ?? center).normalize();
  camera.position.copy(center).addScaledVector(dir, distance);

  controls?.target?.copy(center);
  controls?.update?.();

  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
}

// Placeholder: nel tuo file era chiamata ma non definita
function openModelsPanel() {
  console.log("openModelsPanel(): TODO");
}
