// model_HYS.mjs
// Renderer HySpace: museo virtuale in prima persona (Pointer Lock + WASD).
//
// Il player resta sempre nel volume 10×10×4 della stanza centrale: superata una
// soglia viene riportato sul lato opposto e le stanze vengono traslate di slot
// (7 slot: C centrale, F/L/B/R ai lati, U/D sopra/sotto), così lo spostamento
// non si percepisce. Le stanze lasciate alle spalle vengono distrutte, quelle
// nuove costruite nella direzione di marcia.
//
// FORMA e CONTENUTO sono separati:
// - forma  = modello 3D del catalogo `models[]` (scenografia): casuale, salvo la
//            stanza di avvio (Room_01) e U/D che hanno sempre la forma di C;
// - contenuto = esercitazione del grafo HySpace (api/HySpace_rest_api.php?id_ese=N):
//            vicini orizzontali da WT3DNode, verticali = esercitazione
//            precedente/successiva dello stesso allievo. Vicino assente → porta
//            (o scala) chiusa.
//
// Ingresso in una stanza → evento HYS_EVT_ROOM_ENTER sull'app-bus (broadcast),
// letto dalla finestra della piattaforma che mostra l'esercitazione.

import { THREE, loadAnyModel } from './TJS_sub_modules/TJS-loaders.mjs';
import { appBusEmit } from "./app-bus.mjs";
import { TJS_createGamepadInput, TJS_PAD } from "./TJS_sub_modules/TJS-gamepad.mjs";
import { TJS_createXR, TJS_isXRSupported, TJS_XR_BUTTON } from "./TJS_sub_modules/TJS-webxr.mjs";
import { TJS_createAudio } from "./TJS_sub_modules/TJS-audio.mjs";
import { TJS_createLookControls } from "./TJS_sub_modules/TJS-look-controls.mjs";
import { TJS_createTooltip } from "./TJS_sub_modules/TJS-tooltip.mjs";
import {
  TJS_walkPlanarMove,
  TJS_walkResolveWalls,
  TJS_walkGrounding,
  TJS_walkFallGuard,
  TJS_walkInvalidateSafePoint,
  TJS_hitWorldNormalY,
  TJS_createAutoWalk,
} from "./TJS_sub_modules/TJS-walk.mjs";
import { TJS_createTouchInput } from "./TJS_sub_modules/TJS-touch.mjs";
import { TJS_checkModel, TJS_formatModelWarnings } from "./TJS_sub_modules/TJS-model-check.mjs";
import { hysLoadFlows } from "./HYS_sub_modules/HYS-flow-runner.mjs";
import { t, te, formatDate } from "./shared/i18n.mjs";

import { HYS_rebuildColliders } from "./HYS_sub_modules/HYS_collisions.mjs";

import {
  HYS_checkThresholds,
  HYS_swapSlots,
  HYS_moveSlotContent,
} from "./HYS_sub_modules/HYS_navigation.mjs";

import { HYS_buildExpoPanelsForSlot, HYS_disposeExpoPanels } from "./HYS_sub_modules/HYS_panel.mjs";

import {
  HYS_createDoors,
  HYS_layoutDoors,
  HYS_setDoorState,
  HYS_updateDoors,
  HYS_shiftDoors,
  HYS_resetDoors,
  HYS_doorColliders,
  HYS_disposeDoors,
  HYS_createRoomFixtures,
  HYS_disposeObjectResources,
  HYS_acquireObjectResources,
  HYS_createExhibit,
  HYS_createTransformControls,
  HYS_PEDESTAL_STYLE,
  HYS_createColorCycles,
  HYS_createScreenVideo,
  HYS_applySharedGlass,
} from "./HYS_sub_modules/HYS_object.mjs";


/** Tipo evento app-bus emesso a ogni ingresso in una stanza. */
export const HYS_EVT_ROOM_ENTER = "hys:room:enter";

const HS_SLOTS = ["C", "L", "R", "F", "B", "U", "D"];
// Direzioni ASSOLUTE (assi del mondo, non dell'osservatore): F=-z, B=+z, L=-x, R=+x
const HS_NEIGHBOR_DIRS = ["F", "L", "B", "R", "U", "D"];

// Three.js globals


function getObjectDisplayName(object) {
  if (!object) return t("app.hys.object_fallback.@");
  return (
    object.obj_name ||
    object.obj_title ||
    object.name ||
    object.title ||
    (object.obj_id != null ? t("app.hys.object_fallback_id.@", { id: object.obj_id }) : t("app.hys.object_fallback.@"))
  );
}

// Testo protetto per HTML con i nomi dei tasti in grassetto: {space}, {esc}, {a}, {b}
// restano segnaposto nel catalogo e diventano <b>…</b> qui.
function hsTeKeys(key) {
  const keys = { space: `<b>${te("app.hys.key.space")}</b>`, esc: "<b>Esc</b>", a: "<b>A</b>", b: "<b>B</b>" };
  return te(key).replace(/\{(\w+)\}/g, (m, name) => keys[name] ?? m);
}

// Esercitazione di partenza del museo. Storicamente id_ese=1 (querystring del
// vecchio HS_Gate_01.aspx); obj_spec.hys.start_id_ese la sovrascrive se presente.
function hsStartEseId(object) {
  return Number(object?.obj_spec?.hys?.start_id_ese) || 1;
}


// ====================================================================
// ISTANZA PER PANNELLO
// ====================================================================
// Ogni pannello HySpace ha la propria istanza (stato, scena, renderer, controlli,
// caricamenti), conservata su bodyEl[HYS_STATE_KEY] come negli altri moduli: due
// HySpace aperti insieme non si interferiscono. Le funzioni sono quelle di sempre,
// racchiuse in hsCreateInstance(): __hs è lo stato di QUESTA istanza.

const HYS_STATE_KEY = "__HYS_STATE__";

// Istanza che riceve il gamepad (unico per il browser): l'ultima in cui si è entrati
let __hysActive = null;

function hsCreateInstance() {

const __hs = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  clock: null,
  rafId: null,
  resizeObs: null,
  abortCtrl: null,

  // movement
  keys: new Set(),
  velocity: { x: 0, z: 0 },
  speed: 3.0,     // m/s
  damping: 20.0,  // higher = more “stop”

  // player root (piedi). La camera è figlia del root a quota playerHeight.
  playerRoot: null,

  // 7-room system (slots)
  worldRoot: null,
  roomSlots: new Map(), // "C|L|R|F|B|U|D" -> { slot, group, url, modelRow, openUp, openDown, ese_id, exe }
  modelCatalog: [],
  modelCache: new Map(),

  // porte della stanza centrale (HYS_object.mjs): bloccate dove manca il vicino
  doors: new Map(),
  // spot + tasti scala della stanza centrale (HYS_object.mjs, GLB esterni)
  fixtures: null,
  pickRay: null,
  // modelli delle esercitazioni sulla pedana: url -> Promise<Object3D base clonabile>
  exhibitCache: new Map(),
  // tasti scala/ruota del modello nella stanza centrale
  exhibitControls: null,
  // cicli di colore delle fasce luminose (materiale "Fascia luminosa" dei modelli di stanza)
  colorCycles: HYS_createColorCycles(),
  // video sullo "Schermo" del soffitto (creato in hsInitThree)
  screenVideo: null,
  // tooltip 3D sugli oggetti puntati (tasti scala: esercitazione sopra/sotto)
  tooltip: null,
  mouseNdc: null,          // posizione del cursore libero, per il tooltip

  // gamepad (TJS-gamepad.mjs): convive con mouse e tastiera
  pad: null,
  padMove: { x: 0, y: 0 }, // levetta sinistra, sommata a WASD in TJS_walkPlanarMove
  padNav: false,           // navigazione da gamepad (senza cattura del mouse)
  padLookSpeed: { yaw: 2.2, pitch: 1.6 }, // rad/s a levetta destra piena

  // realtà virtuale (TJS-webxr.mjs): il carrello è playerRoot
  xr: null,
  // touch (TJS-touch.mjs): "stick" = levetta a sinistra + sguardo a destra (predefinita),
  // "tap" = tocca il pavimento per andare lì; in entrambe il tocco su una porta la attraversa
  touch: null,
  touchNav: false,
  touchMode: "stick",
  touchLookScale: 1,
  autoWalk: TJS_createAutoWalk(),   // cammino automatico (TJS-walk.mjs): tocca una porta / il pavimento
  _touchTip: null,         // tooltip da tocco prolungato { obj, info, until }
  modelWarnings: [],       // correzioni automatiche sui modelli (TJS-model-check.mjs), menu "Avvisi modelli"
  xrSnapDeg: 30,           // rotazione a scatti con la levetta destra

  // flow FLE dell'oggetto (HYS-flow-runner.mjs): eventi per i nodi, musica, oggetto
  localEvents: null,       // EventTarget: "roomEnter" per HYS/Events/Room Enter
  audio: null,             // TJS_createAudio(): musica di sottofondo (nodi HYS/Audio/*)
  roomModelHooks: new Set(), // fn(root) chiamate su ogni modello di stanza (nodi HYS/Material/*)
  object: null,

  // luci della stanza centrale: dissolvenza in entrata all'ingresso in una stanza
  roomLight: null,
  roomLightIntensity: 2,
  lightFade: { duration: 0.5, t: Infinity },
  container: null,

  // collisions / grounding
  // vista del VRML originale (Viewpoint1 + NavigationInfo di HS2013.wrl)
  playerHeight: 1.65,    // altezza occhi sopra il pavimento: avatarSize[1]
  fovDeg: 75,            // fieldOfView 1.309 rad, sulla dimensione più corta della vista
  startPos: [0, 0, 4.5], // piedi: spalle alla porta B, sguardo verso F (orientation 0 0 1 0)
  playerRadius: 0.35,    // raggio approssimato
  stepHeight: 0.35,      // quanto "sale" automaticamente (gradini)
  groundSnap: 0.15,      // quanto resta incollato al suolo
  gravity: 14.0,         // m/s^2 (solo se vuoi gravità vera)
  vY: 0,                 // velocità verticale
  onGround: false,

  // temporaneo per lo spostamento del frame (fisica della camminata: TJS-walk.mjs)
  _tmpV1: null,

  // collisions
  colliders: [],

  wireframe: false,

  // grafo delle esercitazioni
  startEseId: 1,
  // museo generato da una ricerca (api/hys_museum_tool.php): null = grafo curato WT3DNode
  museumId: null,
  museum: null,            // { mus_id, name, created_at, start_id_ese, n_nodes, … }
  curatedStartEseId: 1,    // ingresso del museo curato, per tornarci
  node: null,             // risposta API del nodo corrente { node, neighbors }
  nodeCache: new Map(),   // id_ese -> Promise<risposta API> (prefetch dei vicini)
  busCtx: { objId: null, panelId: null },
};

// Questa istanza diventa quella che riceve il gamepad
function hsClaimActive() { __hysActive = __hs; }
function hsIsActive() { return __hysActive === null || __hysActive === __hs; }

async function hsRenderBody({ panel, bodyEl, object, models, signal }) {

    // Layout base del body
    bodyEl.innerHTML = `
      <div style="position:relative; width:100%; height:100%; min-height:420px;">
        <div data-hys="hs3d" style="position:absolute; inset:0;"></div>

        <!-- mirino: visibile in navigazione, click = azione sull'oggetto al centro (tasti scala) -->
        <div data-hys="hsCross"
             style="position:absolute; left:50%; top:50%; width:14px; height:14px; margin:-7px 0 0 -7px;
                    display:none; pointer-events:none;
                    background:
                      linear-gradient(#fff,#fff) center/2px 100% no-repeat,
                      linear-gradient(#fff,#fff) center/100% 2px no-repeat;
                    opacity:.75; mix-blend-mode:difference;"></div>

        <!-- cursore libero: vista ferma, il mouse usa i tasti -->
        <div data-hys="hsHint"
             style="position:absolute; left:50%; bottom:14px; transform:translateX(-50%); display:none;
                    pointer-events:none; background:rgba(0,0,0,.6); color:#fff; font:13px/1.3 system-ui;
                    padding:6px 12px; border-radius:6px; white-space:nowrap;">
          ${hsTeKeys("app.hys.hint.free_cursor")}
        </div>

        <!-- avvisi temporanei (es. esito dell'ingresso in VR) -->
        <div data-hys="hsNotice" role="status" aria-live="polite"
             style="position:absolute; left:50%; top:14px; transform:translateX(-50%); display:none; z-index:5;
                    pointer-events:none; background:rgba(160,40,40,.92); color:#fff; font:13px/1.35 system-ui;
                    padding:8px 14px; border-radius:6px; max-width:90%; text-align:center;"></div>

        <div data-hys="hsOverlay"
             style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
                    background:rgba(0,0,0,.45); color:#fff; font:14px/1.4 system-ui; cursor:pointer;
                    user-select:none; padding:20px; text-align:center;">
          <div style="max-width:520px;">
            <div style="font-size:18px; font-weight:700; margin-bottom:8px;">HySpace Navigation</div>
            <div style="opacity:.95">
              ${te("app.hys.overlay.click")}<br/>
              ${te("app.hys.overlay.wasd")}<br/>
              ${hsTeKeys("app.hys.overlay.free_cursor")}<br/>
              ${hsTeKeys("app.hys.overlay.gamepad")}
            </div>
            <button data-hys="hsVR" type="button"
                    style="display:none; margin-top:14px; padding:8px 18px; border:0; border-radius:6px;
                           background:#4f8cff; color:#fff; font:600 14px system-ui; cursor:pointer;">
              ${te("app.hys.overlay.enter_vr")}
            </button>
            <div style="display:none">
            </div>
          </div>
        </div>
      </div>
    `;

    const container = bodyEl.querySelector('[data-hys="hs3d"]');
    const overlay = bodyEl.querySelector('[data-hys="hsOverlay"]');

    // registrato PRIMA degli await: se il pannello si chiude durante il
    // caricamento, l'abort arriva comunque
    signal?.addEventListener?.("abort", () => hsDestroyThree(), { once: true });

    __hs.startEseId = hsStartEseId(object);
    __hs.busCtx = { objId: object?.obj_id ?? null, panelId: panel?.id ?? null };

    hsSetModelCatalog(models);

    try {
      await hsInitThree(container); // aspetta che gli slot abbiano forma (modelRow)
    } catch (e) {
      console.error(e);
    }
    if (signal?.aborted) { hsDestroyThree(); return; }

    // fetch dei nodi (abortable); hsInitThree → hsDestroyThree lo azzera, va creato dopo
    __hs.abortCtrl = new AbortController();
    __hs.object = object;
    __hs.localEvents = new EventTarget();
    __hs.audio?.dispose();          // mai due motori audio per lo stesso pannello
    __hs.audio = TJS_createAudio();

    // flow FLE collegati all'oggetto: prima della prima stanza, così la configurazione
    // (HYS/Settings/Start, HYS/Audio/*) e HYS/Events/Room Enter sono già attivi
    try { await hysLoadFlows(hsFlowApi(), object, signal, bodyEl); }
    catch (e) { console.warn("[HYS] flow dell'oggetto:", e); }
    if (signal?.aborted) return;

    hsGoToNode(__hs.startEseId).catch((e) => console.error("[HYS] nodo di avvio:", e));
    // da console: __hysDiag() — diagnostica della vista dell'ultimo pannello HySpace aperto
    window.__hysDiag = () => hsDebugView("da console", { show: true });

    // Visore: pulsante "Entra in VR" solo se il browser supporta WebXR immersivo
    const vrBtn = bodyEl.querySelector('[data-hys="hsVR"]');
    TJS_isXRSupported().then((ok) => { if (vrBtn) vrBtn.style.display = ok ? "inline-block" : "none"; });
    vrBtn?.addEventListener("click", (e) => { e.stopPropagation(); hsEnterXR(); });

    // Tablet: il tocco sulla schermata d'ingresso avvia la navigazione touch (niente
    // cattura del mouse, che sui tablet non esiste); il "click" che segue va ignorato
    overlay.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      e.preventDefault();
      __hs._overlayTouch = true;
      hsStartTouchNav();
    });

    // PointerLock
    overlay.addEventListener("click", () => {
      if (__hs._overlayTouch) { __hs._overlayTouch = false; return; }
      __hs.controls?.lock();
      __hs.screenVideo?.play(); // gesto dell'utente: sblocca il video se il browser l'aveva fermato
      __hs.audio?.unlock();     // …e la musica di sottofondo
    });

    // click: in navigazione agisce sull'oggetto al centro dello schermo (mirino);
    // a cursore libero sull'oggetto sotto il puntatore, e un clic a vuoto riprende la navigazione
    const canvas = __hs.renderer?.domElement;
    canvas?.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      __hs.audio?.unlock();
      if (hsNavActive()) { hsPickAt(0, 0); return; }
      if (!__hs.hasEntered) return;
      if (!hsPickAt(...hsEventNdc(e, canvas))) __hs.controls?.lock();
    });
    canvas?.addEventListener("mousemove", (e) => {
      if (hsNavActive() || !__hs.hasEntered) return;
      __hs.mouseNdc = hsEventNdc(e, canvas);
      canvas.style.cursor = hsPickTarget(...__hs.mouseNdc) ? "pointer" : "default";
    });
    canvas?.addEventListener("mouseleave", () => { __hs.mouseNdc = null; });

    // Blocca eventi tastiera sul bodyEl
    bodyEl.tabIndex = 0;
    bodyEl.focus();

    bodyEl.addEventListener("keydown", (e) => {
      if (e.code === "Space") {                    // cursore libero ↔ navigazione
        e.preventDefault();
        if (e.repeat) return;
        if (__hs.controls?.isLocked) __hs.controls.unlock();
        else if (__hs.padNav) hsSetPadNav(false);
        else if (__hs.hasEntered) __hs.controls?.lock();
        return;
      }
      __hs.keys.add(e.code);
    });
    bodyEl.addEventListener("keyup", (e) => __hs.keys.delete(e.code));

    // Resize observer
    __hs.resizeObs?.disconnect();
    __hs.resizeObs = new ResizeObserver(() => hsResize(container));
    __hs.resizeObs.observe(container);
}

function hsGetRightMenu() {
    return {
      title: "☰",
      items: [
        {
          id: "enter-nav",
          label: t("app.hys.menu.enter_nav"),
          onClick: () => __hs.controls?.lock(),
        },
        {
          id: "exit-nav",
          label: t("app.hys.menu.exit_nav"),
          onClick: () => __hs.controls?.unlock(),
        },
        { type: "divider" },

        {
          id: "reset-pos",
          label: t("app.hys.menu.reset_pos"),
          onClick: () => hsResetPosition(),
        },
        {
          id: "toggle-wire",
          label: t("app.hys.menu.wireframe"),
          onClick: () => hsToggleWireframe(),
        },
        {
          id: "enter-vr",
          label: t("app.hys.menu.enter_vr"),
          onClick: () => hsEnterXR(),
        },
        {
          id: "toggle-music",
          label: t("app.hys.menu.music"),
          onClick: () => hsToggleMusic(),
        },
        {
          id: "toggle-shadows",
          label: t("app.hys.menu.shadows"),
          onClick: () => hsToggleShadows(),
        },
        {
          id: "reload-data",
          label: t("app.hys.menu.reload"),
          onClick: () => hsReloadContents(),
        },
        {
          id: "touch-mode",
          label: t("app.hys.menu.touch_mode"),
          onClick: () => hsSetTouch({ mode: __hs.touchMode === "tap" ? "stick" : "tap" }, { announce: true }),
        },
        {
          id: "fullscreen",
          label: t("app.hys.menu.fullscreen"),
          onClick: () => hsToggleFullscreen(),
        },
        {
          id: "curated-museum",
          label: t("app.hys.menu.curated"),
          onClick: () => (__hs.museumId ? hsSetMuseum(null) : hsNotice(t("app.hys.notice.already_curated"), 3000, { info: true })),
        },
        {
          id: "model-warnings",
          label: t("app.hys.menu.model_warnings.@"),
          onClick: () => hsNotice(TJS_formatModelWarnings(__hs.modelWarnings), 20000, { info: true }),
        },
        {
          id: "diag-view",
          label: t("app.hys.menu.diag"),
          onClick: () => hsDebugView("menu", { show: true }),
        },

        { type: "divider" },
        {
          id: "toggle-up",
          label: t("app.hys.menu.vert_up"),
          onClick: () => hsToggleUp(),
        },
        {
          id: "toggle-down",
          label: t("app.hys.menu.vert_down"),
          onClick: () => hsToggleDown(),
        },
        {
          id: "close-vertical",
          label: t("app.hys.menu.vert_close"),
          onClick: () => hsCloseVertical(),
        },
      ],
    };
}


// ====================================================================
// FUNZIONI DI SUPPORTO
// ====================================================================

function hsControlsObject() {
  // In questa architettura, il "player" è playerRoot (piedi).
  // La camera è figlia del root e viene ruotata da TJS_createLookControls.
  if (__hs.playerRoot) return __hs.playerRoot;
  return __hs.camera || null;
}


// --- CATALOGO MODELLI (dal parametro models)
// Solo le forme di stanza: un modello dell'oggetto con mod_spec.hys.role diverso da
// "room" (es. "attachment": oggetto esterno pilotato da un grafo FLE) non è una stanza.
function hsSetModelCatalog(models) {
  const arr = Array.isArray(models) ? models : [];
  __hs.modelCatalog = arr.filter(m => {
    const u = (m?.mod_abs_url ?? m?.url ?? "");
    const role = m?.mod_spec?.hys?.role ?? "room";
    return typeof u === "string" && u.length > 0 && role === "room";
  });
}


// --- SLOT OFFSETS (7 stanze)
function hsSlotOffset(slot) {
  switch (slot) {
    case "C": return new THREE.Vector3(0, 0, 0);
    case "L": return new THREE.Vector3(-10, 0, 0);
    case "R": return new THREE.Vector3(10, 0, 0);
    case "F": return new THREE.Vector3(0, 0, -10);
    case "B": return new THREE.Vector3(0, 0, 10);
    case "U": return new THREE.Vector3(0, 4, 0);
    case "D": return new THREE.Vector3(0, -4, 0);
    default:  return new THREE.Vector3(0, 0, 0);
  }
}

function hsInitRoomSlots() {
  for (const slotObj of __hs.roomSlots.values()) {
    __hs.worldRoot?.remove(slotObj.group);
    hsClearGroup(slotObj.group);
  }
  __hs.roomSlots.clear();

  for (const s of HS_SLOTS) {
    const g = new THREE.Group();
    g.name = `ROOM_${s}`;
    g.position.copy(hsSlotOffset(s));
    __hs.worldRoot.add(g);

    __hs.roomSlots.set(s, {
      slot: s,
      group: g,
      url: null,
      modelRow: null,
      // stato persistente del “passaggio verticale” (per quella stanza)
      openUp: false,   // soffitto Aperto + scale nella stanza
      openDown: false, // pavimento Aperto nella stanza
      // contenuto: esercitazione esposta (null = stanza vuota)
      ese_id: null,
      exe: null,
    });
  }
}


// carica 1 volta e poi clone
async function hsGetModelInstance(modelRow) {
  const url = modelRow?.mod_abs_url || modelRow?.url || "";
  if (!url) throw new Error("ModelRow senza mod_abs_url/url");

  if (__hs.modelCache.has(url)) {
    const base = __hs.modelCache.get(url);
    return base.clone(true);
  }

  const loaded = await loadAnyModel(modelRow);
  const root = loaded?.scene ?? loaded?.root ?? loaded;
  if (!root) throw new Error(`Impossibile caricare modello: ${url}`);
  hsCheckModel(root, { modId: modelRow?.mod_id ?? null, modName: modelRow?.mod_name ?? "", url });

  __hs.modelCache.set(url, root);
  return root.clone(true);
}

// Svuota un gruppo-slot. I cloni del modello condividono geometrie/materiali
// con __hs.modelCache (clone(true) non li duplica) → NON vanno disposti.
// I pannelli "Quadri" (figli della radice del modello) invece sì.
function hsClearGroup(group) {
  for (const ch of group.children.slice()) {
    group.remove(ch);
    HYS_disposeExpoPanels(ch);
  }
}

// Svuota uno slot (contenuto + metadata): la stanza "esce" dal sistema.
function hsDiscardSlot(slotKey) {
  const s = __hs.roomSlots.get(slotKey);
  if (!s) return;
  hsClearGroup(s.group);
  s.modelRow = null;
  s.url = null;
  s.openUp = false;
  s.openDown = false;
  s.ese_id = null;
  s.exe = null;
}

// Nuova forma per lo slot: la stanza rinasce vuota (senza esercitazione).
async function hsAssignModelToSlot(slotKey, modelRow) {
  const slot = __hs.roomSlots.get(slotKey);
  if (!slot) return;

  hsClearGroup(slot.group);
  const instance = await hsGetModelInstance(modelRow);
  instance.position.set(0, 0, 0);
  instance.rotation.set(0, 0, 0);
  instance.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  __hs.colorCycles.register(instance);
  __hs.screenVideo?.apply(instance);
  HYS_applySharedGlass(instance); // materiale "CristalloGrigio" (es. scale) = vetro delle porte
  hsRunRoomModelHooks(instance);  // modifiche ai materiali chieste dai flow (es. HYS/Material/Baked GI)
  slot.group.add(instance);
  hsMarkShadows();

  slot.modelRow = modelRow;
  slot.url = modelRow?.mod_abs_url ?? modelRow?.url ?? null;
  slot.ese_id = null;
  slot.exe = null;
}

function hsPickRandomModel(excludeUrlSet) {
  const list = __hs.modelCatalog;
  if (!list.length) return null;

  const tries = Math.min(30, list.length * 2);
  for (let i = 0; i < tries; i++) {
    const row = list[(Math.random() * list.length) | 0];
    const url = row?.mod_abs_url ?? row?.url;
    if (url && !excludeUrlSet.has(url)) return row;
  }
  return list[(Math.random() * list.length) | 0] ?? null;
}

// Stanza di avvio del museo (storicamente la "01", quadrata).
// Priorità: flag esplicito mod_spec.hys.start → nome "Room_01" → mod_id più basso.
function hsFindStartModel() {
  const list = __hs.modelCatalog;
  if (!list.length) return null;

  const flagged = list.find((m) => m?.mod_spec?.hys?.start === true);
  if (flagged) return flagged;

  const re = /room[\s_-]*0*1(?!\d)/i;
  const named = list.find((m) => re.test(m?.mod_name ?? "") || re.test(m?.mod_filename ?? ""));
  if (named) return named;

  return list.reduce((a, b) => (Number(b.mod_id) < Number(a.mod_id) ? b : a));
}

async function hsRandomizeAllSlots() {
  const used = new Set();
  // U/D non si estraggono: sono sempre cloni di C (vedi hsSyncUpDownToCenter)
  const slots = ["C", "L", "R", "F", "B"];

  for (const s of slots) {
    const row = (s === "C" ? hsFindStartModel() : null) ?? hsPickRandomModel(used);
    if (!row) continue;

    const url = row.mod_abs_url ?? row.url;
    if (url) used.add(url);

    await hsAssignModelToSlot(s, row);

    // una stanza appena generata nasce chiusa
    const slotObj = __hs.roomSlots.get(s);
    if (slotObj) {
      slotObj.openUp = false;
      slotObj.openDown = false;
    }
  }
}

// Costruisce in background le forme delle stanze indicate (casuali, diverse da
// quelle in `keep`). Nascono chiuse e vuote: il contenuto arriva da hsApplyNode.
async function hsBuildRandomRooms(slotKeys, keep) {
  const used = new Set();
  for (const k of keep) {
    const u = __hs.roomSlots.get(k)?.url;
    if (u) used.add(u);
  }

  for (const s of slotKeys) {
    const row = hsPickRandomModel(used);
    if (!row) continue;
    const u = row.mod_abs_url ?? row.url;
    if (u) used.add(u);

    await hsAssignModelToSlot(s, row);
    const slot = __hs.roomSlots.get(s);
    if (slot) { slot.openUp = false; slot.openDown = false; }
    hsApplyRoomLocalOpenState(s); // subito, per non mostrare Aperto+Chiuso insieme
  }
}


// ====================================================================
// GRAFO DELLE ESERCITAZIONI (contenuti)
// ====================================================================

// Nodo dal server, con cache della Promise: i vicini vengono prefetchati mentre
// si visita la stanza, così all'ingresso il nodo è di norma già disponibile.
function hsFetchNode(id) {
  const idEse = Number(id);
  if (!idEse) return Promise.resolve(null);
  const mus = __hs.museumId;
  const key = `${mus ?? 0}:${idEse}`;   // lo stesso id_ese ha vicini diversi in musei diversi

  if (!__hs.nodeCache.has(key)) {
    const p = fetch(`api/HySpace_rest_api.php?id_ese=${idEse}${mus ? `&museum=${mus}` : ""}`, { signal: __hs.abortCtrl?.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.success) throw new Error(j?.message || `HTTP ${r.status}`);
        return j;
      })
      .catch((e) => { __hs.nodeCache.delete(key); throw e; });
    __hs.nodeCache.set(key, p);
  }
  return __hs.nodeCache.get(key);
}

function hsPrefetchNeighbors(data) {
  for (const k of HS_NEIGHBOR_DIRS) {
    const id = data?.neighbors?.[k]?.id_ese;
    if (id) hsFetchNode(id).catch(() => {});
  }
}

// Mette l'esercitazione `exe` nello slot (null = stanza vuota). Se lo slot la
// espone già non fa nulla: le stanze traslate conservano i propri pannelli.
// I pannelli sono figli della radice del modello, così viaggiano con la stanza.
function hsSetSlotContent(slotKey, exe, force = false) {
  const slot = __hs.roomSlots.get(slotKey);
  if (!slot) return;

  const id = exe?.id_ese ?? null;
  const root = slot.group.children[0] ?? null;
  if (!force && slot.ese_id === id && (root?.userData.hysEse ?? null) === id) return;

  slot.ese_id = id;
  slot.exe = exe ?? null;
  if (!root) return;

  HYS_disposeExpoPanels(root);
  hsDisposeExhibit(root);
  root.userData.hysEse = id;
  if (!id) return;

  const spec = slot.modelRow?.mod_spec;
  const isStillValid = () => !!root.parent && root.userData.hysEse === id;

  // pannelli con le immagini
  if (exe.images?.length && spec?.expo?.zones?.length) {
    HYS_buildExpoPanelsForSlot({
      THREE,
      slotGroup: root,
      roomSpec: spec,
      imageUrls: exe.images,
      isStillValid,
    }).catch((e) => console.error(`[HYS] pannelli slot ${slotKey}:`, e));
  }

  // modello dell'esercitazione sulla pedana (mount: mod_spec.hys.pedestal della forma)
  if (exe.model_url) hsBuildExhibit(root, exe, spec, isStillValid);
}


// ====================================================================
// MODELLO DELL'ESERCITAZIONE SULLA PEDANA
// ====================================================================

// Caricato una volta per URL e clonato (i vicini lo prefetchano già con il nodo:
// viene richiesto appena il nodo arriva, in background)
function hsLoadExhibitModel(url) {
  if (!__hs.exhibitCache.has(url)) {
    const p = loadAnyModel({ mod_abs_url: url })
      .then((loaded) => {
        let obj = loaded?.scene ?? loaded;
        if (!obj?.isObject3D) throw new Error("formato non riconosciuto");
        if (obj.isScene) {                 // VRMLLoader restituisce una Scene: la riduco a Group
          const g = new THREE.Group();
          g.add(...obj.children);
          obj = g;
        }
        hsCheckModel(obj, { url });
        return obj;
      })
      .catch((e) => { __hs.exhibitCache.delete(url); throw e; });
    __hs.exhibitCache.set(url, p);
  }
  return __hs.exhibitCache.get(url).then((base) => base.clone(true));
}

function hsBuildExhibit(root, exe, spec, isStillValid) {
  const ped = spec?.hys?.pedestal ?? {};
  const mount = [Number(ped.x ?? 0), Number(ped.y ?? 0.4), Number(ped.z ?? 0)]; // TransfInLine: 0 0.4 0

  hsLoadExhibitModel(exe.model_url)
    .then((model) => {
      if (!isStillValid()) return;         // la stanza ha cambiato esercitazione nel frattempo
      if (exe.anim === undefined) console.warn("[HYS] il nodo non ha 'anim': api/HySpace_rest_api.php sul server è una versione precedente");
      console.info(`[HYS] modello sulla pedana: id_ese=${exe.id_ese} anim=${exe.anim ?? "—"} (${exe.model_url})`);
      const ex = HYS_createExhibit({ model, mount, anim: exe.anim });
      ex.applyScale(0);
      root.add(ex.root);
      if (root.parent === __hs.roomSlots.get("C")?.group) ex.play(); // arrivato a stanza già visitata
      hsUpdateExhibitControls();
      hsMarkShadows();
    })
    .catch((e) => console.warn(`[HYS] modello esercitazione ${exe.id_ese} (${exe.model_url}):`, e?.message ?? e));
}

function hsDisposeExhibit(root) {
  const old = root.children.filter((c) => c.name === "Esposto");
  for (const o of old) o.userData.exhibit?.dispose();
}

// Esposto di uno slot (o null)
function hsSlotExhibit(slotKey) {
  const root = __hs.roomSlots.get(slotKey)?.group.children[0];
  return root?.children.find((c) => c.name === "Esposto")?.userData.exhibit ?? null;
}

function hsCenterExhibit() {
  return hsSlotExhibit("C");
}

// Ingresso in una stanza: parte l'animazione del suo modello, le altre si fermano
function hsUpdateExhibitAnimations() {
  for (const k of HS_SLOTS) {
    const ex = hsSlotExhibit(k);
    if (!ex) continue;
    if (k === "C") ex.play(); else ex.pause();
  }
}

// La shadow map va ricalcolata al prossimo frame
function hsMarkShadows() {
  if (__hs.renderer) __hs.renderer.shadowMap.needsUpdate = true;
}

function hsToggleShadows() {
  const f = __hs.fixtures;
  if (!f) return;
  f.setShadows(!f.shadowsOn);
  hsMarkShadows();
  if (f.shadowsOn) hsShadowReport();
}

// Diagnostica: chi proietta e chi riceve l'ombra nella stanza centrale, con che materiali.
// Un MeshBasicMaterial (unlit) non mostra ombre; un emissive forte le copre.
function hsShadowReport() {
  const describe = (m) => {
    const e = m.emissive ? m.emissive.r + m.emissive.g + m.emissive.b : 0;
    return `${m.type}${m.emissiveMap ? "+emissiveMap" : ""}${e > 0.3 ? ` emissive=${e.toFixed(2)}` : ""}`;
  };
  const tally = (root, pred) => {
    const out = {};
    root?.traverse((o) => {
      if (!o.isMesh || !pred(o)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        const k = describe(m);
        out[k] = (out[k] ?? 0) + 1;
      }
    });
    return out;
  };
  const room = __hs.roomSlots.get("C")?.group.children[0];
  const pedane = [];
  room?.traverse((o) => { if (o.name === "Pedane") pedane.push(o); });
  const ex = room?.children.find((c) => c.name === "Esposto");
  let lights = [];
  __hs.scene?.traverse((o) => { if (o.isLight) lights.push(`${o.type} i=${o.intensity}${o.castShadow ? " castShadow" : ""}`); });

  console.group("[HYS] ombre — stanza centrale");
  console.log("luci:", lights);
  console.log("modello sulla pedana (proietta):", ex ? tally(ex, (o) => o.castShadow) : "nessuno");
  console.log("nodi 'Pedane' trovati:", pedane.length, pedane.length ? tally({ traverse: (fn) => pedane.forEach((p) => p.traverse(fn)) }, (o) => o.receiveShadow) : "");
  console.log("stanza (riceve), materiali:", tally(room, (o) => o.receiveShadow && !ex?.getObjectById(o.id)));

  // misure: pedana, modello, spot
  const f3 = (v) => v.toArray().map((n) => n.toFixed(2)).join("; ");
  const bb = (o) => { const b = new THREE.Box3().setFromObject(o); return `min(${f3(b.min)}) max(${f3(b.max)})`; };
  __hs.scene?.updateMatrixWorld(true);
  for (const pd of pedane) {
    const mats = [];
    pd.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) mats.push(`"${m.name}" ${m.type} side=${m.side} opacity=${m.opacity}${m.transparent ? " transparent" : ""}${m.transmission ? ` transmission=${m.transmission}` : ""}`); });
    console.log("pedana: ingombro", bb(pd), "materiali", mats);
  }
  if (ex) console.log("modello: ingombro", bb(ex), "appoggio y =", ex.getWorldPosition(new THREE.Vector3()).y.toFixed(2));
  const spot = []; __hs.scene?.traverse((o) => { if (o.isSpotLight) spot.push(o); });
  for (const l of spot) {
    const pos = l.getWorldPosition(new THREE.Vector3());
    const tgt = l.target.getWorldPosition(new THREE.Vector3());
    const dir = tgt.clone().sub(pos).normalize();
    console.log("spot: posizione", f3(pos), "direzione", f3(dir), "angolo", l.angle, "shadow map", l.shadow.map ? `${l.shadow.map.width}px` : "non ancora creata");
  }

  // nomi dei materiali emissivi della stanza (per le animazioni di colore)
  const emissive = new Set();
  room?.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.3) emissive.add(`"${m.name}"`); });
  console.log("materiali emissivi della stanza:", [...emissive]);
  console.log("materiali con ciclo di colore registrati:", __hs.colorCycles.count);
  console.groupEnd();
}

// Indice della forma di stanza (Room_01…06 → 0…5) per le posizioni del VRML
function hsRoomShapeIndex(modelRow) {
  const m = /room[\s_-]*0*(\d+)/i.exec(`${modelRow?.mod_name ?? ""} ${modelRow?.mod_filename ?? ""}`);
  const i = m ? Number(m[1]) - 1 : 0;
  return i >= 0 && i < HYS_PEDESTAL_STYLE.controls.scaleButtons.length ? i : 0;
}

function hsInitExhibitControls() {
  const onValue = ({ kind, action, value }) => {
    const ex = hsCenterExhibit();
    if (!ex) return;
    if (kind === "rotate" && action === "base") ex.resetOrTurn(); // rosso: reset se ruotato, altrimenti un giro
    else if (kind === "rotate") ex.applyRotation(value);
    else if (!ex.applyScale(value)) console.info("[HYS] Raggiunto ingrandimento massimo");
    hsMarkShadows();
  };
  __hs.exhibitControls = {
    scale: HYS_createTransformControls("scale", onValue),
    rotate: HYS_createTransformControls("rotate", onValue),
  };
  for (const c of Object.values(__hs.exhibitControls)) {
    c.root.visible = false;
    __hs.worldRoot.add(c.root);
  }
}

// Tasti visibili solo se la stanza centrale ha un modello; posizione per forma di stanza
function hsUpdateExhibitControls() {
  const ctl = __hs.exhibitControls;
  if (!ctl) return;
  const i = hsRoomShapeIndex(__hs.roomSlots.get("C")?.modelRow);
  const has = !!hsCenterExhibit();
  ctl.scale.root.position.fromArray(HYS_PEDESTAL_STYLE.controls.scaleButtons[i]);
  ctl.rotate.root.position.fromArray(HYS_PEDESTAL_STYLE.controls.rotButtons[i]);
  ctl.scale.root.visible = has;
  ctl.rotate.root.visible = has;
}

// Applica un nodo: contenuti delle 7 stanze, porte, colliders, evento bus, prefetch.
// `dir` = direzione da cui si è entrati (null all'avvio/reset/ricarica).
function hsApplyNode(data, dir, force = false) {
  if (!data?.node) return;
  __hs.node = data;

  hsSetSlotContent("C", data.node, force);
  for (const k of HS_NEIGHBOR_DIRS) hsSetSlotContent(k, data.neighbors?.[k] ?? null, force);

  hsUpdateDoors();
  hsUpdateExhibitControls();
  hsUpdateExhibitAnimations();
  hsRebuildAllColliders();
  hsMarkShadows();
  hsEmitRoomEnter(data, dir);
  hsPrefetchNeighbors(data);
}

async function hsGoToNode(id, { force = false } = {}) {
  const data = await hsFetchNode(id);
  hsApplyNode(data, null, force);
}

function hsEmitRoomEnter(data, dir) {
  const n = data.node;
  const neighbors = {};
  for (const k of HS_NEIGHBOR_DIRS) neighbors[k] = data.neighbors?.[k]?.id_ese ?? null;

  const payload = {
    objId: __hs.busCtx.objId,
    id_ese: n.id_ese,
    idu: n.idu,
    title: n.title,
    author: n.author,
    from: dir ?? null,   // "F"|"L"|"B"|"R"|"U"|"D" oppure null (avvio/reset)
    neighbors,           // id_ese dei 6 vicini (null = porta/scala chiusa)
    mus_id: __hs.museumId ?? null,   // museo generato in cui ci si trova (null = curato)
  };
  appBusEmit(HYS_EVT_ROOM_ENTER, payload, { broadcast: true, sourceApp: "HYS", sourcePanelId: __hs.busCtx.panelId });
  // stesso evento per i grafi FLE dell'oggetto (HYS/Events/Room Enter)
  __hs.localEvents?.dispatchEvent(new CustomEvent("roomEnter", { detail: payload }));
}

// ====================================================================
// INTERFACCIA PER I FLOW FLE (HYS-flow-runner.mjs → graph._appContext)
// ====================================================================
// Le sole cose che i nodi HYS/* possono usare di questa istanza.
function hsFlowApi() {
  return {
    localEvents: __hs.localEvents,
    audio: __hs.audio,
    getNode: () => __hs.node,
    setStartEseId: (id) => { const v = Number(id); if (v > 0) __hs.startEseId = v; },
    notice: (text) => hsNotice(text),
    resolveMedia: (paths, ref) => hsResolveMedia(paths, ref),
    onRoomModel: (fn) => hsOnRoomModel(fn),
    setTouch: (opts) => hsSetTouch(opts),
    setMuseum: (m) => hsSetMuseum(m),
    goTo: (id) => hsGoTo(id),
    getMuseum: () => __hs.museum,
  };
}

// ─── Musei generati (api/hys_museum_tool.php) ────────────────────────────────
// m: null/0 = torna al museo curato; numero = mus_id; oggetto { mus_id, start_id_ese?, name?, … }
// (es. l'uscita "museum" del nodo HTM/HYS/Ricerca Musei, arrivata via bus). Si entra
// nella stanza d'ingresso del museo; lo stato è del pannello (due pannelli HySpace
// possono mostrare musei diversi).
async function hsSetMuseum(m) {
  const musId = m && typeof m === "object" ? Number(m.mus_id) || 0 : Number(m) || 0;
  if (!musId) {
    if (!__hs.museumId) return;
    __hs.museumId = null;
    __hs.museum = null;
    __hs.startEseId = __hs.curatedStartEseId;
    __hs.nodeCache.clear();
    await hsGoToNode(__hs.startEseId, { force: true });
    hsNotice(t("app.hys.notice.curated"), 4000, { info: true });
    return;
  }
  let info = m && typeof m === "object" ? m : null;
  if (!Number(info?.start_id_ese)) {
    const r = await fetch(`api/hys_museum_tool.php?action=info&mus_id=${musId}`, { credentials: "same-origin", signal: __hs.abortCtrl?.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) { hsNotice(t("app.hys.notice.museum_error", { id: musId, error: j?.error ?? "HTTP " + r.status })); return; }
    info = j.data;
  }
  if (!__hs.museumId) __hs.curatedStartEseId = __hs.startEseId;
  __hs.museumId = musId;
  __hs.museum = info;
  __hs.startEseId = Number(info.start_id_ese);
  __hs.nodeCache.clear();
  await hsGoToNode(__hs.startEseId, { force: true });
  const n = Number(info.n_nodes) || 0;
  const created = new Date(String(info.created_at ?? "").replace(" ", "T"));
  const date = isNaN(created) ? "?" : formatDate(created, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
  const msg = info.name
    ? t("app.hys.notice.museum_named", { name: info.name, n })
    : t("app.hys.notice.museum_dated", { date, n });
  hsNotice(msg, 6000, { info: true });
}

// Vai direttamente a un'esercitazione (id_ese o oggetto con id_ese), nel museo corrente
async function hsGoTo(v) {
  const id = Number(v && typeof v === "object" ? (v.id_ese ?? v.value) : v);   // { value } = numero passato da App Bus Emitter
  if (!(id > 0)) return;
  try { await hsGoToNode(id, { force: true }); }
  catch (e) { hsNotice(t("app.hys.notice.exercise_error", { id, error: e?.message ?? e })); }
}

// Modelli di stanza per i flow: fn(root) subito su quelli già in scena e poi su ogni
// stanza caricata. I cloni condividono i materiali con il modello in cache, quindi una
// modifica a un materiale vale per tutte le copie. Ritorna la funzione per staccarsi.
function hsOnRoomModel(fn) {
  __hs.roomModelHooks.add(fn);
  for (const k of HS_SLOTS) {
    const root = __hs.roomSlots.get(k)?.group?.children?.[0];
    if (root) { try { fn(root); } catch (e) { console.error("[HYS] onRoomModel:", e); } }
  }
  return () => __hs.roomModelHooks.delete(fn);
}

function hsRunRoomModelHooks(root) {
  for (const fn of __hs.roomModelHooks) {
    try { fn(root); } catch (e) { console.error("[HYS] onRoomModel:", e); }
  }
}

// Percorsi audio → URL. Relativi = cartella del WP del flow (o dell'oggetto, in test
// dall'editor), risolti da api/hys_audio_tool.php; assoluti (https://, //, /…) invariati.
async function hsResolveMedia(paths, { flowId = null, objId = null } = {}) {
  const items = (Array.isArray(paths) ? paths : String(paths ?? "").split(/[\n;,]+/))
    .map((x) => String(x).trim()).filter(Boolean);
  const out = [];
  for (const item of items) {
    if (/^(https?:)?\/\//i.test(item) || item.startsWith("/")) { out.push(item); continue; }
    const ref = flowId ? `flow_id=${flowId}` : (objId ? `obj_id=${objId}` : null);
    if (!ref) { hsNotice(t("app.hys.notice.audio_no_ref.@", { item })); continue; }
    try {
      const r = await fetch(`api/hys_audio_tool.php?action=resolve&${ref}&path=${encodeURIComponent(item)}`,
                            { signal: __hs.abortCtrl?.signal });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { hsNotice(t("app.hys.notice.audio_error", { item, error: j?.error ?? "HTTP " + r.status })); continue; }
      out.push(...(j.data?.files ?? []).map((f) => f.url));
    } catch (e) {
      if (e?.name !== "AbortError") hsNotice(t("app.hys.notice.audio_error", { item, error: e?.message ?? e }));
    }
  }
  return out;
}

function hsToggleMusic() {
  const a = __hs.audio;
  if (!a) return;
  if (!a.status().mode) { hsNotice(t("app.hys.notice.no_music.@")); return; }
  a.setEnabled(!a.on);   // "on" = acceso e non ceduto: una musica ceduta a un altro pannello riparte
}

function hsReloadContents() {
  if (__hs.__transitioning) return;
  const id = __hs.node?.node?.id_ese ?? __hs.startEseId;
  __hs.nodeCache.clear();
  hsGoToNode(id, { force: true }).catch((e) => console.error("[HYS] ricarica:", e));
}


// ====================================================================
// PORTE (stanza centrale)
// ====================================================================

// Una porta scorrevole per lato di C (geometria, scritte, movimento in
// HYS_object.mjs). Si apre avvicinandosi solo se in quella direzione c'è un
// vicino; porta il titolo e l'autore dell'esercitazione della stanza oltre.
// Dimensioni: HYS_DOOR_STYLE, sovrascrivibili da mod_spec.hys.door della stanza centrale.
function hsInitDoors() {
  __hs.doors = HYS_createDoors({ parent: __hs.worldRoot, renderer: __hs.renderer });
}

function hsUpdateDoors() {
  HYS_layoutDoors(__hs.doors, __hs.roomSlots.get("C")?.modelRow?.mod_spec?.hys?.door ?? {});
  const n = __hs.node?.neighbors;
  for (const [k, door] of __hs.doors) HYS_setDoorState(door, n?.[k] ?? null);
  hsUpdateStairButtons();
}

// Spot + tasti scala (GLB esterni): caricati in background, non bloccano l'avvio
function hsInitFixtures() {
  const worldRoot = __hs.worldRoot;
  HYS_createRoomFixtures({
    parent: worldRoot,
    onStairUp: () => hsToggleUp(),
    onStairDown: () => hsToggleDown(),
  }).then((f) => {
    if (__hs.worldRoot !== worldRoot) { f.dispose(); return; } // pannello chiuso nel frattempo
    __hs.fixtures = f;
    const lf = __hs.lightFade;
    if (lf.t < lf.duration) { const x = lf.t / lf.duration; f.setLightLevel(x * x * (3 - 2 * x)); }
    hsUpdateStairButtons();
    hsMarkShadows();
  }).catch((e) => console.warn("[HYS] oggetti stanza:", e));
}

// Tasti scala: attivi solo se esiste l'esercitazione sopra/sotto, verdi se aperti
function hsUpdateStairButtons() {
  const c = __hs.roomSlots.get("C");
  __hs.fixtures?.setStairs({
    upExe: __hs.node?.neighbors?.U ?? null,
    downExe: __hs.node?.neighbors?.D ?? null,
    upOpen: !!c?.openUp,
    downOpen: !!c?.openDown,
  });
}

// Oggetto interattivo (userData.hysAction) colpito da un raggio in coordinate
// schermo normalizzate (0, 0 = centro, cioè il mirino)
function hsPickTarget(nx, ny) {
  if (!__hs.camera) return null;
  return hsRaycast((r) => r.setFromCamera(new THREE.Vector2(nx, ny), __hs.camera))?.object ?? null;
}

// Stesso raycast lungo il raggio di un controller XR (restituisce anche la distanza)
function hsPickHit(controller) {
  return hsRaycast((r) => r.setFromXRController(controller));
}

function hsRaycast(setup) {
  const targets = [...(__hs.fixtures?.interactive ?? [])];
  for (const c of Object.values(__hs.exhibitControls ?? {})) if (c.root.visible) targets.push(...c.interactive);
  if (!targets.length) return null;
  __hs.pickRay ??= new THREE.Raycaster();
  setup(__hs.pickRay);
  __hs.pickRay.far = 6;
  // il raycast di three.js non guarda la visibilità: escludo gli oggetti nascosti
  const shown = (o) => { for (let c = o; c; c = c.parent) if (!c.visible) return false; return true; };
  return __hs.pickRay.intersectObjects(targets.filter(shown), false)[0] ?? null;
}

// Navigazione attiva: mouse catturato o gamepad in uso
function hsNavActive() {
  return !!__hs.controls?.isLocked || __hs.padNav || __hs.touchNav || !!__hs.xr?.presenting;
}

// Tooltip 3D sull'oggetto puntato: mirino in navigazione, cursore a vista ferma
function hsUpdateHover() {
  if (!__hs.tooltip) return;
  if (__hs.xr?.presenting) { if (!__hs._xrTipShown) __hs.tooltip.hide(); return; } // in VR lo gestisce hsUpdateXR
  const tt = __hs._touchTip;                     // tocco prolungato: tooltip per qualche secondo
  if (tt && performance.now() < tt.until) { __hs.tooltip.show(tt.obj, tt.info); return; }
  __hs._touchTip = null;
  const ndc = hsNavActive() ? [0, 0] : (__hs.hasEntered ? __hs.mouseNdc : null);
  const obj = ndc ? hsPickTarget(...ndc) : null;
  const info = obj?.userData.hysTooltip?.() ?? null;
  if (info) __hs.tooltip.show(obj, info); else __hs.tooltip.hide();
}

// ====================================================================
// REALTÀ VIRTUALE (WebXR)
// ====================================================================

// Posizione del "corpo" per movimento, collisioni, soglie e porte. In VR chi indossa
// il visore può spostarsi fisicamente dentro il carrello (playerRoot): conta la testa
// (proiettata sul pavimento), non l'origine del carrello. Su desktop coincidono.
function hsBody() {
  const pr = __hs.playerRoot;
  const b = (__hs._body ??= { position: new THREE.Vector3(), off: new THREE.Vector3() });
  b.off.set(0, 0, 0);
  if (__hs.xr?.presenting && __hs.camera) {
    const head = __hs.camera.getWorldPosition(__hs._tmpHead ??= new THREE.Vector3());
    b.off.set(head.x - pr.position.x, 0, head.z - pr.position.z);
  }
  b.position.copy(pr.position).add(b.off);
  return b;
}

// Riporta sul carrello lo spostamento calcolato sul corpo
function hsBodyCommit(b) {
  __hs.playerRoot.position.copy(b.position).sub(b.off);
}

// ─── Controllo dei modelli caricati (TJS-model-check.mjs) ─────────────────────
// Correzioni automatiche (oggi: normali mancanti → ombre ricevute) con traccia: console,
// registro attività (per i modelli del database) e un avviso a schermo raggruppato, una
// volta per sessione; elenco completo dal menu "Avvisi modelli".
function hsCheckModel(root, info) {
  const w = TJS_checkModel(root, { ...info, app: "HYS" });
  if (!w || __hs.modelWarnings.includes(w)) return;
  __hs.modelWarnings.push(w);
  clearTimeout(__hs._mwTimer);
  __hs._mwTimer = setTimeout(() => {
    if (__hs._mwShown) return;
    __hs._mwShown = true;
    const n = __hs.modelWarnings.length;
    hsNotice(t("app.hys.notice.normals_fixed.@", { n }), 9000, { info: true });
  }, 1500);
}

// ─── TOUCH (tablet, telefoni) — TJS-touch.mjs ───────────────────────────────────
// "stick": metà sinistra = levetta (stesso canale della levetta del gamepad, padMove),
// metà destra = trascina per guardare. "tap": trascina ovunque per guardare, tocco sul
// pavimento = cammina fin lì. In entrambe: tocco su un oggetto = la sua azione (tasti
// scala, scala/ruota del modello), tocco su una porta aperta = la attraversa, tocco
// prolungato = tooltip. Il cammino automatico usa la stessa fisica (collisioni, scale)
// e si ferma se qualcosa lo blocca.

const HS_TOUCH_HELP = {
  stick: "app.hys.touch.help_stick.@",   // chiavi del catalogo: il testo si legge con t()
  tap:   "app.hys.touch.help_tap.@",
};

function hsStartTouchNav() {
  if (__hs.touchNav) return;
  hsClaimActive();
  __hs.touchNav = true;
  __hs.hasEntered = true;
  __hs.screenVideo?.play();   // il tocco è un gesto dell'utente: sblocca video e musica
  __hs.audio?.unlock();
  const root = __hs.container?.parentElement;
  for (const id of ["hsOverlay", "hsHint"]) {
    const el = root?.querySelector(`[data-hys="${id}"]`);
    if (el) el.style.display = "none";
  }
  hsNotice(t(HS_TOUCH_HELP[__hs.touchMode] ?? HS_TOUCH_HELP.stick), 8000, { info: true });
}

/** Modalità touch e sensibilità dello sguardo (nodo HYS/Settings/Touch, voce di menu). */
function hsSetTouch({ mode, lookScale } = {}, { announce = false } = {}) {
  if (mode === "stick" || mode === "tap") {
    __hs.touchMode = mode;
    __hs.touch?.setMode(mode);
    __hs.autoWalk.stop();
  }
  if (Number.isFinite(Number(lookScale)) && Number(lookScale) > 0) __hs.touchLookScale = Number(lookScale);
  if (announce) hsNotice(t(HS_TOUCH_HELP[__hs.touchMode]), 6000, { info: true });
}

// Trascinamento: "afferra il mondo" (come Street View) — il punto sotto il dito lo segue
function hsTouchLook(dx, dy) {
  const cam = __hs.camera, el = __hs.renderer?.domElement;
  if (!cam || !el) return;
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect);
  const k = (hfov / Math.max(1, el.clientWidth)) * __hs.touchLookScale;
  __hs.controls?.rotateBy(dx * k, dy * k);
}

function hsTouchTap(x, y) {
  hsStartTouchNav();
  __hs.autoWalk.stop();
  const obj = hsPickTarget(x, y);
  if (obj) { obj.userData.hysAction?.(); return; }
  const dir = hsDoorAt(x, y);
  if (dir) { hsWalkThroughDoor(dir); return; }
  if (__hs.touchMode === "tap") {
    const p = hsFloorAt(x, y);
    if (p) hsStartAutoWalk([p]);
  }
}

function hsTouchLongPress(x, y) {
  const obj = hsPickTarget(x, y);
  const info = obj?.userData.hysTooltip?.();
  if (info) __hs._touchTip = { obj, info, until: performance.now() + 3500 };
}

// Porta toccata (non nascosta da un muro): direzione F/L/B/R o null
function hsDoorAt(x, y) {
  if (!__hs.doors || !__hs.camera) return null;
  const leaves = new Map();
  for (const [dir, d] of __hs.doors) { leaves.set(d.main.leaf, dir); leaves.set(d.twin.leaf, dir); }
  __hs.pickRay ??= new THREE.Raycaster();
  __hs.pickRay.setFromCamera(new THREE.Vector2(x, y), __hs.camera);
  __hs.pickRay.far = 30;
  const hit = __hs.pickRay.intersectObjects([...leaves.keys(), ...(__hs.colliders ?? [])], false)[0];
  return hit ? (leaves.get(hit.object) ?? null) : null;
}

// Punto di pavimento toccato (superficie camminabile), o null
function hsFloorAt(x, y) {
  if (!__hs.camera || !__hs.colliders?.length) return null;
  __hs.pickRay ??= new THREE.Raycaster();
  __hs.pickRay.setFromCamera(new THREE.Vector2(x, y), __hs.camera);
  __hs.pickRay.far = 30;
  const hit = __hs.pickRay.intersectObjects(__hs.colliders, false)[0];
  return hit && TJS_hitWorldNormalY(hit) > 0.6 ? hit.point.clone() : null;
}

const HS_DOOR_AXIS = { F: [0, -1], B: [0, 1], L: [-1, 0], R: [1, 0] };

function hsWalkThroughDoor(dir) {
  if (!__hs.node?.neighbors?.[dir]) {
    hsNotice(t("app.hys.notice.door_closed"), 3500, { info: true });
    return;
  }
  const [ux, uz] = HS_DOOR_AXIS[dir];
  const y = hsBody().position.y;
  // davanti alla porta, poi 1,5 m dentro la stanza vicina (la soglia è a 5 m dal centro)
  hsStartAutoWalk([new THREE.Vector3(ux * 3.6, y, uz * 3.6), new THREE.Vector3(ux * 6.5, y, uz * 6.5)]);
}

// Cammino automatico lungo pts; se il primo tratto passa sulla pedana al centro della
// stanza la aggira con una tappa laterale
function hsStartAutoWalk(pts) {
  const b = hsBody().position;
  const a = new THREE.Vector2(b.x, b.z), t = new THREE.Vector2(pts[0].x, pts[0].z);
  const seg = t.clone().sub(a), len = seg.length();
  if (len > 0.5) {
    const u = seg.clone().divideScalar(len);
    const along = THREE.MathUtils.clamp(-a.dot(u), 0, len);          // punto del tratto più vicino al centro
    const near = a.clone().add(u.clone().multiplyScalar(along));
    if (near.length() < 1.7) {
      let perp = new THREE.Vector2(-u.y, u.x);
      if (perp.dot(a) < 0) perp.negate();                              // dal lato in cui già mi trovo
      const w = perp.multiplyScalar(2.3);
      pts = [new THREE.Vector3(w.x, b.y, w.y), ...pts];
    }
  }
  __hs.autoWalk.start(pts);
}

function hsUpdateTouch(dt) {
  const tch = __hs.touch;
  if (!tch || !__hs.touchNav || !hsIsActive()) return;
  if (tch.stickActive) {                                 // la levetta ha la precedenza
    __hs.autoWalk.stop();
    __hs.padMove.x = tch.move.x;
    __hs.padMove.y = tch.move.y;
    return;
  }
  if (!__hs.autoWalk.active) return;
  const e = new THREE.Euler().setFromQuaternion(__hs.camera.getWorldQuaternion(new THREE.Quaternion()), "YXZ");
  const { move, status } = __hs.autoWalk.step(dt, hsBody().position, e.y);
  if (move) { __hs.padMove.x = move.x; __hs.padMove.y = move.y; return; }
  if (status === "arrived" || status === "stuck") __hs.padMove.x = __hs.padMove.y = 0;
  if (status === "stuck") hsNotice(t("app.hys.notice.path_blocked"), 2500, { info: true });
}

function hsToggleFullscreen() {
  const d = document;
  const el = __hs.container?.parentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    (d.exitFullscreen ?? d.webkitExitFullscreen)?.call(d);
    return;
  }
  const req = el?.requestFullscreen ?? el?.webkitRequestFullscreen;
  if (!req) { hsNotice(t("app.hys.notice.fullscreen_unavailable"), 4000, { info: true }); return; }
  Promise.resolve(req.call(el)).catch((e) => hsNotice(t("app.hys.notice.fullscreen_failed", { error: e?.message ?? e }), 4000));
}

// ─── Diagnostica della vista (camera storta su alcuni PC/tablet, 2026-09-24) ─────
// Stampa in console (gruppo "[HYS diag] …") tutto ciò che decide l'orientamento
// della vista: camera (locale e mondo, yaw/pitch/roll, "alto" della camera, target),
// catena dei genitori (carrello, scena), matrici di proiezione e di vista, canvas,
// WebXR, cattura del mouse e soprattutto i GAMEPAD visti dal browser: un dispositivo
// con un asse fermo a un valore ≠ 0 farebbe ruotare la vista di continuo.
// show = true: riepilogo anche a schermo (tablet, dove la console non è a portata).
function hsDebugView(tag, { show = false } = {}) {
  const cam = __hs.camera;
  if (!cam) return null;
  const r = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
  const deg = (v) => r(THREE.MathUtils.radToDeg(v), 1);
  const v3 = (v) => [r(v.x), r(v.y), r(v.z)];
  const mat = (m) => [0, 1, 2, 3].map((row) => [0, 1, 2, 3].map((col) => r(m.elements[col * 4 + row], 4)));

  cam.updateMatrixWorld(true);
  const wp = cam.getWorldPosition(new THREE.Vector3());
  const wq = cam.getWorldQuaternion(new THREE.Quaternion());
  const e = new THREE.Euler().setFromQuaternion(wq, "YXZ");
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(wq);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(wq);
  const le = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ");

  const parents = [];
  for (let o = cam.parent; o; o = o.parent) {
    parents.push({ nome: o.name || o.type, pos: v3(o.position),
                   rot_deg: [deg(o.rotation.x), deg(o.rotation.y), deg(o.rotation.z)], scala: v3(o.scale) });
  }

  const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean).map((g) => ({
    indice: g.index, id: g.id, mapping: g.mapping || "(non standard)",
    assi: g.axes.map((a) => r(a, 2)),
    tasti_premuti: g.buttons.map((b, i) => (b.pressed || b.value > 0.5 ? i : null)).filter((i) => i !== null),
  }));

  const size = __hs.renderer?.getDrawingBufferSize(new THREE.Vector2());
  const shown = __hs.renderer?.domElement.getBoundingClientRect?.();
  const box = __hs.renderer?.domElement.parentElement?.getBoundingClientRect?.();
  const info = {
    tag,
    camera: {
      pos_locale: v3(cam.position),
      rot_locale_deg: { yaw: deg(le.y), pitch: deg(le.x), roll: deg(le.z) },
      pos_mondo: v3(wp),
      rot_mondo_deg: { yaw: deg(e.y), pitch: deg(e.x), roll: deg(e.z) },
      alto_camera_mondo: v3(up),          // dritta = [0, 1, 0] a sguardo orizzontale
      avanti: v3(fwd),
      target_1m: v3(wp.clone().add(fwd)),
      up_vettore: v3(cam.up),
      fov: r(cam.fov, 2), aspect: r(cam.aspect, 4), near: cam.near, far: cam.far, zoom: cam.zoom,
    },
    genitori: parents,
    canvas: {
      css: [__hs.renderer?.domElement.clientWidth, __hs.renderer?.domElement.clientHeight],
      // devono coincidere: se il canvas mostrato è più grande del pannello se ne vede solo un angolo
      canvas_mostrato: shown ? [r(shown.width, 1), r(shown.height, 1)] : null,
      pannello: box ? [r(box.width, 1), r(box.height, 1)] : null,
      aspect_pannello: box && box.height ? r(box.width / box.height, 4) : null,
      buffer: size ? [size.x, size.y] : null,
      devicePixelRatio: window.devicePixelRatio,
      orientamento_schermo: screen.orientation?.type ?? "?",
    },
    input: {
      mouse_catturato: !!__hs.controls?.isLocked,
      nav_gamepad: !!__hs.padNav,
      padMove: __hs.padMove ? [r(__hs.padMove.x, 2), r(__hs.padMove.y, 2)] : null,
      gamepad: pads,
    },
    webxr: { navigator_xr: !!navigator.xr, xr_enabled: !!__hs.renderer?.xr?.enabled, in_vr: !!__hs.renderer?.xr?.isPresenting },
    userAgent: navigator.userAgent,
  };

  console.groupCollapsed(`[HYS diag] ${tag} — yaw ${info.camera.rot_mondo_deg.yaw}° pitch ${info.camera.rot_mondo_deg.pitch}° roll ${info.camera.rot_mondo_deg.roll}° · gamepad: ${pads.length}`);
  console.log("camera", info.camera);
  console.log("genitori (dal più vicino)", parents);
  console.log("matrice di proiezione");
  console.table(mat(cam.projectionMatrix));
  console.log("matrice di vista (matrixWorldInverse)");
  console.table(mat(cam.matrixWorldInverse));
  console.log("canvas", info.canvas, "| webxr", info.webxr);
  console.log("input", info.input);
  for (const p of pads) console.log(`gamepad #${p.indice} "${p.id}" (${p.mapping}) assi`, p.assi, "tasti", p.tasti_premuti);
  console.log("userAgent", info.userAgent);
  console.groupEnd();

  if (show) {
    const c = info.camera;
    const lines = [
      `Diagnostica vista (${tag})`,
      `camera yaw ${c.rot_mondo_deg.yaw}° · pitch ${c.rot_mondo_deg.pitch}° · roll ${c.rot_mondo_deg.roll}°`,
      `alto camera ${c.alto_camera_mondo.join(", ")} · fov ${c.fov} · aspect ${c.aspect}`,
      `canvas mostrato ${info.canvas.canvas_mostrato?.join("×")} · pannello ${info.canvas.pannello?.join("×")} · devicePixelRatio ${info.canvas.devicePixelRatio}`,
      `genitori: ${parents.map((p) => `${p.nome} rot ${p.rot_deg.join("/")}`).join(" · ")}`,
      `mouse catturato ${info.input.mouse_catturato} · nav gamepad ${info.input.nav_gamepad}`,
      pads.length ? pads.map((p) => `gamepad "${p.id}" assi ${p.assi.join(" ")}`).join("\n") : "nessun gamepad",
    ];
    hsNotice(lines.join("\n"), 25000);
  }
  return info;
}

// Avviso temporaneo nel pannello (oltre che in console)
function hsNotice(text, ms = 6000, { info = false } = {}) {
  if (info) console.info("[HYS]", text); else console.warn("[HYS]", text);
  const el = __hs.container?.parentElement?.querySelector('[data-hys="hsNotice"]');
  if (!el) return;
  el.textContent = text;
  el.style.background = info ? "rgba(20,40,70,.92)" : "rgba(160,40,40,.92)";
  el.style.whiteSpace = "pre-line";
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = "none"; }, ms);
}

// La richiesta parte subito (serve il gesto dell'utente); se fallisce spiego il perché
async function hsEnterXR() {
  __hs.audio?.unlock(); // il click su "Entra in VR" è un gesto: sblocca la musica
  if (!__hs.xr) { hsNotice(t("app.hys.notice.vr_not_ready")); return; }
  try {
    await __hs.xr.enter();
  } catch (e) {
    let why = e?.message ?? String(e);
    if (!navigator.xr) why = t("app.hys.notice.vr_no_webxr");
    else if (!(await TJS_isXRSupported())) why = t("app.hys.notice.vr_no_headset");
    hsNotice(t("app.hys.notice.vr_failed", { why }));
  }
}

function hsOnXRStart() {
  hsClaimActive();
  __hs.controls?.unlock();
  __hs.padNav = false;
  __hs.hasEntered = true;
  __hs.keys.clear();
  __hs.velocity.x = __hs.velocity.z = 0;
  __hs.screenVideo?.play();
  const root = __hs.container?.parentElement;
  for (const id of ['[data-hys="hsOverlay"]', '[data-hys="hsHint"]', '[data-hys="hsCross"]']) {
    const el = root?.querySelector(id);
    if (el) el.style.display = "none";
  }
}

// Uscita dal visore: il corpo resta dov'era la testa, lo sguardo mantiene la direzione
function hsOnXREnd() {
  const pr = __hs.playerRoot;
  if (!pr || !__hs.camera) return;
  pr.position.add(__hs._body?.off ?? new THREE.Vector3());
  pr.rotation.set(0, 0, 0);
  __hs.camera.position.set(0, __hs.playerHeight, 0);
  __hs.camera.rotation.set(0, __hs._xrLastYaw ?? 0, 0, "YXZ");
  __hs.padMove.x = __hs.padMove.y = 0;
  __hs.tooltip?.hide();
  const hint = __hs.container?.parentElement?.querySelector('[data-hys="hsHint"]');
  if (hint) hint.style.display = "block";
  if (__hs.container) hsResize(__hs.container);
}

// Rotazione a scatti del carrello attorno alla verticale della testa
function hsSnapTurn(sign) {
  const pr = __hs.playerRoot;
  const angle = sign * THREE.MathUtils.degToRad(__hs.xrSnapDeg);
  const head = __hs.camera.getWorldPosition(new THREE.Vector3());
  const off = pr.position.clone().sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  pr.position.set(head.x + off.x, pr.position.y, head.z + off.z);
  pr.rotation.y += angle;
}

// Controller, a ogni frame: levetta sinistra = cammina, destra = rotazione a scatti,
// raggio = tooltip, grilletto = azione (tasti scala, scala/ruota del modello)
function hsUpdateXR(dt = 0) {
  const xr = __hs.xr;
  __hs._xrDt = dt;
  __hs._xrTipShown = false;
  if (!xr?.presenting) return;
  const st = xr.poll();

  const mv = st.left?.stick ?? { x: 0, y: 0 };
  __hs.padMove.x = mv.x;
  __hs.padMove.y = mv.y;

  const rx = st.right?.stick.x ?? 0;
  if (Math.abs(rx) > 0.7 && !__hs._snapHeld) { hsSnapTurn(rx > 0 ? -1 : 1); __hs._snapHeld = true; }
  else if (Math.abs(rx) < 0.3) __hs._snapHeld = false;

  // uscita dal visore dall'app: B (destro) o Y (sinistro) tenuto premuto 1,5 s
  const exitHeld = st.right?.held.has(TJS_XR_BUTTON.B) || st.left?.held.has(TJS_XR_BUTTON.B);
  __hs._xrExitT = exitHeld ? (__hs._xrExitT ?? 0) + (__hs._xrDt ?? 0) : 0;
  if (__hs._xrExitT > 1.5) { __hs._xrExitT = 0; xr.exit(); return; }

  for (const hand of ["right", "left"]) {
    const h = st[hand];
    if (!h) continue;
    const hit = hsPickHit(h.controller);
    xr.setRayLength(h.controller, hit ? hit.distance : null);
    const info = hit?.object.userData.hysTooltip?.();
    if (info && !__hs._xrTipShown) { __hs.tooltip?.show(hit.object, info); __hs._xrTipShown = true; }
    if (h.pressed.has(TJS_XR_BUTTON.TRIGGER)) hit?.object.userData.hysAction?.();
  }

  // direzione dello sguardo, per restituirla all'uscita dal visore
  const e = new THREE.Euler().setFromQuaternion(__hs.camera.getWorldQuaternion(new THREE.Quaternion()), "YXZ");
  __hs._xrLastYaw = e.y;
}

// Navigazione da gamepad on/off (senza cattura del mouse)
function hsSetPadNav(on) {
  const root = __hs.renderer?.domElement.parentElement?.parentElement;
  const overlay = root?.querySelector('[data-hys="hsOverlay"]');
  const cross = root?.querySelector('[data-hys="hsCross"]');
  const hint = root?.querySelector('[data-hys="hsHint"]');
  __hs.padNav = !!on;
  if (on) {
    hsClaimActive();
    __hs.hasEntered = true;
    __hs.screenVideo?.play();
    __hs.audio?.unlock();
    if (overlay) overlay.style.display = "none";
    if (hint) hint.style.display = "none";
    if (cross) cross.style.display = "block";
  } else {
    __hs.padMove.x = __hs.padMove.y = 0;
    __hs.keys.clear();
    if (cross && !__hs.controls?.isLocked) cross.style.display = "none";
    if (hint && __hs.hasEntered && !__hs.controls?.isLocked) hint.style.display = "block";
  }
}

// Gamepad, a ogni frame: levette → movimento e vista, A = azione del mirino, B = pausa
function hsUpdateGamepad(dt) {
  const st = __hs.pad?.poll();
  if (!st?.connected || !hsIsActive()) { __hs.padMove.x = __hs.padMove.y = 0; return; }

  const sticks = st.move.x || st.move.y || st.look.x || st.look.y;
  if (!hsNavActive()) {
    __hs.padMove.x = __hs.padMove.y = 0;
    if (sticks || st.pressed.has(TJS_PAD.A)) hsSetPadNav(true); // entra / riprende (A qui non agisce)
    return;
  }

  __hs.padMove.x = st.move.x;
  __hs.padMove.y = st.move.y;
  if (st.look.x || st.look.y) {
    __hs.controls?.rotateBy(-st.look.x * __hs.padLookSpeed.yaw * dt, -st.look.y * __hs.padLookSpeed.pitch * dt);
  }
  if (st.pressed.has(TJS_PAD.A)) hsPickAt(0, 0);
  if (st.pressed.has(TJS_PAD.B)) {
    if (__hs.controls?.isLocked) __hs.controls.unlock(); else hsSetPadNav(false);
  }
}

// Attiva l'oggetto colpito; true se c'era qualcosa da attivare
function hsPickAt(nx, ny) {
  const obj = hsPickTarget(nx, ny);
  obj?.userData.hysAction?.();
  return !!obj;
}

function hsEventNdc(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1];
}

// Le ante sono sempre colliders: chiuse bloccano, aperte sono scorse dentro il muro
function hsRebuildAllColliders() {
  HYS_rebuildColliders(__hs, HS_NAMES);
  __hs.colliders.push(...HYS_doorColliders(__hs.doors));
}


// ----------------------------------------------------
// INIT THREE
// ----------------------------------------------------
async function hsInitThree(container) {
  hsDestroyThree();

  __hs.scene = new THREE.Scene();
  __hs.scene.background = new THREE.Color(0x101018);

  __hs.camera = new THREE.PerspectiveCamera(__hs.fovDeg, 1, 0.1, 2000);

  // playerRoot è la posizione dei piedi (world). La camera è figlia del root
  // a quota playerHeight (occhi). Così collisioni/grounding/soglie verticali
  // lavorano sempre sui piedi, indipendentemente da come ruota la camera.
  __hs.playerRoot = new THREE.Object3D();
  __hs.playerRoot.name = "PLAYER_ROOT";
  __hs.playerRoot.position.fromArray(__hs.startPos);
  __hs.scene.add(__hs.playerRoot);

  // Camera a quota occhi (locale rispetto ai piedi)
  __hs.camera.position.set(0, __hs.playerHeight, 0);
  __hs.playerRoot.add(__hs.camera);

  __hs.renderer = new THREE.WebGLRenderer({ antialias: true });
  __hs.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  HYS_acquireObjectResources();
  __hs._resAcquired = true;
  // ombre dello spot: la scena è statica, la shadow map si ricalcola solo quando
  // qualcosa cambia (hsMarkShadows) — stanze, modello, animazione, tasti
  __hs.renderer.shadowMap.enabled = true;
  __hs.renderer.shadowMap.type = THREE.PCFShadowMap;   // dalla r186 PCF è morbido (PCFSoft rimosso)
  __hs.renderer.shadowMap.autoUpdate = false;
  // Dimensione CSS del canvas = il riquadro del pannello. hsResize usa setSize(w, h, false),
  // che imposta solo i pixel interni (w·h × devicePixelRatio) e NON lo stile: senza queste
  // righe, con devicePixelRatio > 1 (Windows al 125–150%, tablet, telefoni) il canvas
  // veniva mostrato 1,25–2 volte più grande del pannello e se ne vedeva solo l'angolo in
  // alto a sinistra → vista "storta", centro spostato (2026-09-24).
  const cvs = __hs.renderer.domElement;
  cvs.style.width = "100%";
  cvs.style.height = "100%";
  cvs.style.display = "block";
  container.appendChild(cvs);

  // vista in prima persona robusta ai salti del mouse (HYS_navigation.mjs)
  __hs.controls = TJS_createLookControls(__hs.camera, __hs.renderer.domElement);

  // Overlay "Click per entrare" solo al primo ingresso; poi, quando il mouse viene
  // rilasciato (Spazio, Esc), cursore libero a vista ferma con un breve messaggio.
  const overlay = container.parentElement?.querySelector('[data-hys="hsOverlay"]');
  const cross = container.parentElement?.querySelector('[data-hys="hsCross"]');
  const hint = container.parentElement?.querySelector('[data-hys="hsHint"]');
  const canvasEl = __hs.renderer.domElement;
  __hs.controls.addEventListener("lock", () => {
    hsClaimActive();
    __hs.hasEntered = true;
    if (overlay) overlay.style.display = "none";
    if (hint) hint.style.display = "none";
    if (cross) cross.style.display = "block";
  });
  __hs.controls.addEventListener("unlock", () => {
    __hs.keys.clear();                           // niente tasti "incastrati" al rientro
    __hs.padNav = false;                         // Esc/Spazio: pausa anche per il gamepad
    if (cross) cross.style.display = "none";
    if (__hs.hasEntered) {
      if (hint) hint.style.display = "block";
      canvasEl.style.cursor = "default";
    } else if (overlay) {
      overlay.style.display = "flex";
    }
  });

  __hs.worldRoot = new THREE.Group();
  __hs.scene.add(__hs.worldRoot);

  // luce semplice (PointLight “torcia”)
  const light = new THREE.PointLight(0xffffff, __hs.roomLightIntensity);
  light.position.set(0, 2, 0);
  light.distance = 30;
  __hs.scene.add(light);
  __hs.roomLight = light;
  hsStartLightFade(); // anche il primo ingresso si accende in dissolvenza

  // grid riferimento
  const grid = new THREE.GridHelper(40, 40, 0x2a2a36, 0x1f1f28);
  grid.position.y = 0.001;
  __hs.scene.add(grid);

  __hs.clock = new THREE.Timer();   // THREE.Clock è deprecato dalla r183 (il nome del campo resta)

  __hs._tmpV1 ??= new THREE.Vector3();

  hsInitRoomSlots();
  hsInitDoors();
  hsInitFixtures();
  __hs.screenVideo = HYS_createScreenVideo();
  __hs.tooltip = TJS_createTooltip({ parent: __hs.scene });
  __hs.pad = TJS_createGamepadInput();
  __hs.touch = TJS_createTouchInput(__hs.renderer.domElement, {
    mode: __hs.touchMode,
    onStart: () => hsStartTouchNav(),
    onTap: (x, y) => hsTouchTap(x, y),
    onLongPress: (x, y) => hsTouchLongPress(x, y),
    onLook: (dx, dy) => hsTouchLook(dx, dy),
  });
  __hs.xr = TJS_createXR({
    renderer: __hs.renderer,
    dolly: __hs.playerRoot,
    onStart: hsOnXRStart,
    onEnd: hsOnXREnd,
  });
  hsInitExhibitControls();
  await hsRandomizeAllSlots();

  // U/D devono essere dello stesso tipo della stanza centrale (C)
  await hsSyncUpDownToCenter();

  // inizializza visibilità coerente + porte (chiuse finché non arriva il nodo) + colliders
  hsUpdateDoors();
  await hsApplyVerticalState();

  hsResize(container);
  __hs.container = container;
  // setAnimationLoop al posto di requestAnimationFrame: in VR è il visore a dettare i tempi
  __hs.renderer.setAnimationLoop(hsLoop);
}


// ----------------------------------------------------
// MOVIMENTO / LOOP
// ----------------------------------------------------
function hsResize(container) {
  if (!__hs.renderer || !__hs.camera) return;
  if (__hs.renderer.xr?.isPresenting) return; // dimensioni decise dal visore
  const w = Math.max(1, container.clientWidth);
  const h = Math.max(1, container.clientHeight);
  __hs.camera.aspect = w / h;
  // VRML: fieldOfView vale per la dimensione più corta; three.js usa sempre la verticale
  const half = THREE.MathUtils.degToRad(__hs.fovDeg) / 2;
  __hs.camera.fov = w >= h
    ? __hs.fovDeg
    : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / __hs.camera.aspect));
  __hs.camera.updateProjectionMatrix();
  __hs.renderer.setSize(w, h, false);
}

function hsLoop() {
  if (!__hs.renderer || !__hs.scene || !__hs.camera || !__hs.clock) return;

  __hs.clock.update();
  const dt = Math.min(__hs.clock.getDelta(), 0.05);

  hsUpdateGamepad(dt);
  hsUpdateXR(dt);
  hsUpdateTouch(dt);
  if (hsNavActive()) {
    const body = hsBody();
    hsUpdateMovement(dt, body);
    hsBodyCommit(body);
    hsFallGuard(dt);
    hsCheckThresholdAndTransition(hsBody());
  }
  hsUpdateHover();

  if (__hs.playerRoot) HYS_updateDoors(__hs.doors, hsBody().position, dt);
  hsUpdateLightFade(dt);
  if (hsCenterExhibit()?.update(dt)) hsMarkShadows();
  __hs.colorCycles.update(__hs.clock.getElapsed());

  __hs.renderer.render(__hs.scene, __hs.camera);
}

function hsUpdateMovement(dt, player = hsBody()) {
  // Aggiornamento "player" per frame:
  // 1) calcolo delta orizzontale (WASD) nello spazio world usando la rotazione camera
  // 2) applico lo spostamento ai piedi (playerRoot.position)
  // 3) risolvo compenetrazioni laterali contro i colliders (muri/porte/oggetti)
  // 4) aggiorno quota Y (piedi) con grounding su pavimenti/scale/pedane
  if (!player || !__hs.camera) return;

  // delta di movimento sul piano XZ (la Y la decide il grounding), nella direzione
  // dello sguardo in coordinate mondo (in VR il carrello può essere ruotato)
  const look = (__hs._lookRot ??= { quaternion: new THREE.Quaternion() });
  __hs.camera.getWorldQuaternion(look.quaternion);
  const deltaXZ = TJS_walkPlanarMove(__hs, look, dt, __hs._tmpV1);

  if (deltaXZ && deltaXZ.lengthSq() > 0) {
    player.position.add(deltaXZ);

    // collisioni laterali (non verticali)
    TJS_walkResolveWalls(__hs, player);
  }

  // grounding (verticale)
  TJS_walkGrounding(__hs, player, dt);
}

// Dissolvenza delle luci della stanza centrale (spot + luce della stanza): quando si
// entra in una stanza le luci si "spostano" su quella nuova e salgono da 0 al pieno
// in lightFade.duration secondi, con curva smoothstep. Non serve ricalcolare le ombre.
function hsStartLightFade() {
  __hs.lightFade.t = 0;
  hsApplyLightLevel(0);
}

function hsApplyLightLevel(k) {
  if (__hs.roomLight) __hs.roomLight.intensity = __hs.roomLightIntensity * k;
  __hs.fixtures?.setLightLevel(k);
}

function hsUpdateLightFade(dt) {
  const f = __hs.lightFade;
  if (f.t >= f.duration) return;
  f.t = Math.min(f.duration, f.t + dt);
  const x = f.t / f.duration;
  hsApplyLightLevel(x * x * (3 - 2 * x));
}

// Rete di sicurezza (TJS-walk): una falla nel modello di una stanza non deve far
// precipitare all'infinito; dopo 4 s di caduta o sotto y = −8 si torna all'ultimo appoggio.
function hsFallGuard(dt) {
  const b = hsBody();
  if (!TJS_walkFallGuard(__hs, b, dt, { fallback: __hs.startPos })) return;
  __hs.autoWalk.stop();
  hsBodyCommit(b);
  hsNotice(t("app.hys.notice.fell.@"));
}

// Le coordinate dell'ultimo punto sicuro valgono solo nella stanza in cui è stato preso
function hsInvalidateSafePoint() { TJS_walkInvalidateSafePoint(__hs); }

// ----------------------------------------------------
// TRANSITIONS (trigger a soglia)
// ----------------------------------------------------
function hsCheckThresholdAndTransition(body = hsBody()) {
  if (!__hs.playerRoot) return;

  HYS_checkThresholds(
    __hs,                 // stato globale
    body,                 // posizione del corpo (in VR: la testa sul pavimento)
    hsEnterDirection,     // callback orizzontale
    hsEnterVertical       // callback verticale
  );
}


async function hsEnterDirection(dir) {
  if (__hs.__transitioning) return;
  hsInvalidateSafePoint();

  const oppSlot = ({ F: "B", B: "F", L: "R", R: "L" })[dir];
  if (!oppSlot) return;

  // porta chiusa: nessun vicino in quella direzione (la porta fisica lo impedisce già)
  const next = __hs.node?.neighbors?.[dir];
  if (!next) return;

  const slotC   = __hs.roomSlots.get("C");
  const slotDir = __hs.roomSlots.get(dir);
  if (!slotC?.modelRow || !slotDir?.modelRow) return; // stanza davanti non ancora pronta

  __hs.__transitioning = true;

  try {
    // 1) TRASLAZIONE — sincrona, nello stesso frame del riposizionamento del
    //    player: le due stanze che restano (quella in cui entro e quella che
    //    lascio) vengono SPOSTATE di slot con tutto il contenuto (modello +
    //    pannelli), non ricaricate. Così la traslazione non si percepisce.
    hsDiscardSlot(oppSlot);                   // la più lontana alle spalle: distrutta
    HYS_moveSlotContent(__hs, "C", oppSlot);  // quella che lascio → alle spalle
    HYS_moveSlotContent(__hs, dir, "C");      // quella in cui entro → centrale

    const p = __hs.playerRoot?.position;
    if (p) {
      const stepH = 10;
      if (dir === "F") p.z += stepH;
      if (dir === "B") p.z -= stepH;
      if (dir === "L") p.x += stepH;
      if (dir === "R") p.x -= stepH;
      for (const q of __hs.autoWalk.points) {         // cammino automatico: stessa traslazione
        if (dir === "F") q.z += stepH;
        if (dir === "B") q.z -= stepH;
        if (dir === "L") q.x += stepH;
        if (dir === "R") q.x -= stepH;
      }
    }

    // stanze che non hanno più senso nella nuova posizione: distrutte subito
    const toRebuild = (dir === "F" || dir === "B") ? [dir, "L", "R"] : [dir, "F", "B"];
    for (const s of toRebuild) hsDiscardSlot(s);

    // la porta attraversata è ora alle spalle: ne conserva l'apertura
    HYS_shiftDoors(__hs.doors, dir);
    hsStartLightFade();

    // nodo della stanza in cui entro (di norma già in cache grazie al prefetch);
    // finché non arriva, porte bloccate tranne quella da cui vengo (la stanza
    // che ho lasciato esiste di sicuro, e il player è proprio sulla sua soglia)
    const nodeP = hsFetchNode(next.id_ese);
    const prev = __hs.node?.node ?? null;
    __hs.node = { node: null, neighbors: { [oppSlot]: prev } };
    hsUpdateDoors();

    // U/D = cloni della nuova C (dalla cache: si risolve in microtask, prima
    // del prossimo frame) + visibilità e colliders coerenti
    await hsSyncUpDownToCenter();
    await hsApplyVerticalState();

    // 2) COSTRUZIONE delle stanze nuove davanti/ai lati, in parallelo al nodo
    const buildP = hsBuildRandomRooms(toRebuild, ["C", oppSlot]);

    const data = await nodeP.catch((e) => { console.error("[HYS] nodo:", e); return null; });
    if (data) { __hs.node = data; hsUpdateDoors(); hsRebuildAllColliders(); }

    await buildP;
    await hsApplyVerticalState();
    hsApplyNode(data, dir);
  } catch (e) {
    console.error("[HYS] transizione orizzontale:", e);
  } finally {
    __hs.__transitioning = false;
  }
}


// ----------------------------------------------------
// MENU / UTILITY
// ----------------------------------------------------
function hsResetPosition() {
  if (__hs.__transitioning) return;
  __hs.autoWalk.stop();
  const obj = hsControlsObject();
  if (!obj) return;

  __hs.playerRoot?.position.fromArray(__hs.startPos);
  __hs.playerRoot?.rotation.set(0, 0, 0);
  __hs.camera?.rotation.set(0, 0, 0); // sguardo verso F, come all'avvio

  // camera resta figlia a quota playerHeight
  if (__hs.camera) __hs.camera.position.y = __hs.playerHeight;
  __hs.velocity.x = 0;
  __hs.velocity.z = 0;

  if (__hs.worldRoot) __hs.worldRoot.position.set(0, 0, 0);

  __hs.__transitioning = true;
  __hs.node = null;
  HYS_resetDoors(__hs.doors);
  hsStartLightFade();
  hsUpdateDoors();
  (async () => {
    await hsRandomizeAllSlots();
    await hsSyncUpDownToCenter();
    await hsApplyVerticalState();
    await hsGoToNode(__hs.startEseId); // si riparte dall'ingresso del museo
  })()
    .catch((e) => console.error("[HYS] reset:", e))
    .finally(() => { __hs.__transitioning = false; });
}

function hsToggleWireframe() {
  __hs.wireframe = !__hs.wireframe;

  for (const slotObj of __hs.roomSlots.values()) {
    slotObj.group.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m.wireframe = __hs.wireframe;
          m.needsUpdate = true;
        }
      }
    });
  }
}

function hsDestroyThree() {
  __hs.renderer?.setAnimationLoop(null);
  __hs.xr?.dispose();
  __hs.xr = null;
  __hs.container = null;

  __hs.abortCtrl?.abort();
  __hs.abortCtrl = null;
  __hs.nodeCache.clear();
  __hs.node = null;

  __hs.resizeObs?.disconnect?.();
  __hs.resizeObs = null;

  if (__hs.worldRoot) {
    for (const slotObj of __hs.roomSlots.values()) {
      __hs.worldRoot.remove(slotObj.group);
      hsClearGroup(slotObj.group);
    }
  }
  __hs.roomSlots.clear();

  HYS_disposeDoors(__hs.doors);
  __hs.fixtures?.dispose();
  __hs.fixtures = null;
  for (const c of Object.values(__hs.exhibitControls ?? {})) c.dispose();
  __hs.exhibitControls = null;
  __hs.exhibitCache.clear();
  __hs.colorCycles.clear();
  __hs.roomModelHooks.clear();
  __hs.screenVideo?.dispose();
  __hs.screenVideo = null;
  __hs.tooltip?.dispose();
  __hs.tooltip = null;
  __hs.audio?.dispose();
  __hs.audio = null;
  __hs.localEvents = null;
  __hs.pad?.dispose();
  __hs.pad = null;
  __hs.touch?.dispose();
  __hs.touch = null;
  __hs.padNav = false;
  __hs.padMove.x = __hs.padMove.y = 0;
  __hs.mouseNdc = null;
  __hs.roomLight = null;
  if (__hs._resAcquired) {                     // rilascia solo ciò che questa istanza ha preso
    HYS_disposeObjectResources(__hs.renderer);
    __hs._resAcquired = false;
  }
  if (__hysActive === __hs) __hysActive = null;

  __hs.worldRoot = null;

  if (__hs.renderer) {
    __hs.renderer.dispose?.();
    const canvas = __hs.renderer.domElement;
    canvas?.parentElement?.removeChild(canvas);
  }

  __hs.renderer = null;
  if (__hs.scene && __hs.playerRoot) { __hs.scene.remove(__hs.playerRoot); }
  __hs.playerRoot = null;

  __hs.scene = null;
  __hs.camera = null;
  __hs.controls?.dispose();
  __hs.controls = null;
  __hs.hasEntered = false;
  __hs.clock = null;

  __hs.keys.clear();
  __hs.velocity.x = 0;
  __hs.velocity.z = 0;
  __hs.__transitioning = false;
}


// ====================================================================
// VERTICALE (stato persistente per stanza: openUp/openDown)
// ====================================================================

const HS_NAMES = {
  Pav_Chiuso: "Pav_Chiuso",
  Pav_Aperto: "Pav_Aperto",
  Sof_Chiuso: "Sof_Chiuso",
  Sof_Aperto: "Sof_Aperto",
  Scale: "Scale",
  Pareti: "Pareti",
  Pedane: "Pedane",
};

function hsTraverseSlot(slot, fn) {
  const s = __hs.roomSlots.get(slot);
  if (!s?.group) return;
  s.group.traverse(fn);
}

function hsSetVisibleByName(slot, name, visible) {
  hsTraverseSlot(slot, (o) => {
    if (o?.name === name) o.visible = !!visible;
  });
}

function hsSetClosedDefault(slot) {
  // CHIUSO: mostra chiusi, nasconde aperti + scale
  hsSetVisibleByName(slot, HS_NAMES.Pav_Chiuso, true);
  hsSetVisibleByName(slot, HS_NAMES.Sof_Chiuso, true);

  hsSetVisibleByName(slot, HS_NAMES.Pav_Aperto, false);
  hsSetVisibleByName(slot, HS_NAMES.Sof_Aperto, false);
  hsSetVisibleByName(slot, HS_NAMES.Scale, false);
}

// Applica lo stato openUp/openDown “interno” di una stanza qualsiasi (C/L/R/F/B)
function hsApplyRoomLocalOpenState(slot) {
  const s = __hs.roomSlots.get(slot);
  if (!s) return;

  // base chiusa
  hsSetClosedDefault(slot);

  // openUp: soffitto Aperto + scale nella stanza
  if (s.openUp) {
    hsSetVisibleByName(slot, HS_NAMES.Sof_Chiuso, false);
    hsSetVisibleByName(slot, HS_NAMES.Sof_Aperto, true);
    hsSetVisibleByName(slot, HS_NAMES.Scale, true);
  }

  // openDown: pavimento Aperto nella stanza
  if (s.openDown) {
    hsSetVisibleByName(slot, HS_NAMES.Pav_Chiuso, false);
    hsSetVisibleByName(slot, HS_NAMES.Pav_Aperto, true);
  }
}

// U/D devono essere sempre dello stesso tipo (modello) della centrale.
// Qui facciamo SOLO la sostituzione della forma se serve: la visibilità la
// decide hsApplyVerticalState(), il contenuto hsApplyNode().
async function hsSyncUpDownToCenter() {
  const c = __hs.roomSlots.get("C");
  if (!c?.modelRow) return;

  const cUrl = c.modelRow.mod_abs_url ?? c.modelRow.url;
  for (const k of ["U", "D"]) {
    const s = __hs.roomSlots.get(k);
    if (s && s.url !== cUrl) await hsAssignModelToSlot(k, c.modelRow);
  }
}

// Master: applica tutto (rendering + coerenza U/D + colliders)
async function hsApplyVerticalState() {
  // 1) applica stato locale alle 5 stanze “vere” (C + laterali)
  for (const k of ["C", "L", "R", "F", "B"]) {
    hsApplyRoomLocalOpenState(k);
  }

  // 2) U e D: per default chiuse…
  hsSetClosedDefault("U");
  hsSetClosedDefault("D");

  // 3) …ma coerenti con la CENTRALE (solo visibilità, NON modelli)
  const c = __hs.roomSlots.get("C");
  if (c) {
    if (c.openUp) {
      hsSetVisibleByName("U", HS_NAMES.Pav_Chiuso, false);
      hsSetVisibleByName("U", HS_NAMES.Pav_Aperto, true);
    }

    if (c.openDown) {
      hsSetVisibleByName("D", HS_NAMES.Sof_Chiuso, false);
      hsSetVisibleByName("D", HS_NAMES.Sof_Aperto, true);
      hsSetVisibleByName("D", HS_NAMES.Scale, true);
    }
  }

  // 4) colliders coerenti (stanze + porte chiuse) + stato dei tasti scala
  hsRebuildAllColliders();
  hsUpdateStairButtons();
  hsUpdateExhibitControls();
  hsMarkShadows();
}


// Menu actions: svincolate (posso aprire su, giù o entrambe), ma si apre solo
// verso un'esercitazione che esiste (precedente/successiva dello stesso allievo)
async function hsToggleUp() {
  const c = __hs.roomSlots.get("C");
  const u = __hs.roomSlots.get("U");
  if (!c || !u) return;

  if (!c.openUp && !__hs.node?.neighbors?.U) {
    console.info("[HYS] nessuna esercitazione successiva dell'allievo: la scala resta chiusa");
    return;
  }
  c.openUp = !c.openUp;
  u.openDown = c.openUp; // legame: se C apre su, U apre giù (foro nel pavimento di U)

  await hsApplyVerticalState();
}

async function hsToggleDown() {
  const c = __hs.roomSlots.get("C");
  const d = __hs.roomSlots.get("D");
  if (!c || !d) return;

  if (!c.openDown && !__hs.node?.neighbors?.D) {
    console.info("[HYS] nessuna esercitazione precedente dell'allievo: il pavimento resta chiuso");
    return;
  }
  c.openDown = !c.openDown;
  d.openUp = c.openDown; // legame: se C apre giù, D apre su (foro nel soffitto + scale di D)

  await hsApplyVerticalState();
}

async function hsCloseVertical() {
  const c = __hs.roomSlots.get("C");
  const u = __hs.roomSlots.get("U");
  const d = __hs.roomSlots.get("D");
  if (!c || !u || !d) return;

  c.openUp = false;
  c.openDown = false;
  u.openDown = false;
  d.openUp = false;

  await hsApplyVerticalState();
}


async function hsEnterVertical(dirUD) {
  if (__hs.__transitioning) return;
  hsInvalidateSafePoint();
  __hs.autoWalk.stop();

  const next = __hs.node?.neighbors?.[dirUD];
  if (!next) return; // nessun piano oltre (la scala/il foro non dovrebbero essere aperti)

  const obj = hsControlsObject();
  if (!obj) return;

  __hs.__transitioning = true;

  try {
    if (dirUD === "U") {
      // 3-way swap: (C <- U), (D <- C old), (U <- D old) + poi rigeneri U
      HYS_swapSlots(__hs, "C", "U"); // ora C = vecchia U
      HYS_swapSlots(__hs, "D", "U"); // ora D = vecchia C, U = vecchia D
      obj.position.y -= 4;           // ricentro player nel nuovo livello
    } else {
      // scendo: C <-> D, poi U <-> D
      HYS_swapSlots(__hs, "C", "D");
      HYS_swapSlots(__hs, "U", "D");
      obj.position.y += 4;
    }

    const nodeP = hsFetchNode(next.id_ese);
    __hs.node = null;
    HYS_resetDoors(__hs.doors); // nuovo piano: porte tutte chiuse
    hsStartLightFade();
    hsUpdateDoors();

    // rigenera le laterali e il nuovo piano oltre — dentro il guard, così
    // nessun'altra transizione può partire finché non ha finito
    await hsRebuildAfterVertical(dirUD);

    const data = await nodeP.catch((e) => { console.error("[HYS] nodo:", e); return null; });
    hsApplyNode(data, dirUD);
  } catch (e) {
    console.error("[HYS] transizione verticale:", e);
  } finally {
    __hs.__transitioning = false;
  }
}

async function hsRebuildAfterVertical(movedDir /* "U" | "D" */) {
  const slotC = __hs.roomSlots.get("C");
  if (!slotC?.modelRow) return;

  // La stanza "opposta" resta quella già swappata:
  // - se sono SALITO, D è la vecchia C; se sono SCESO, U è la vecchia C
  const oppositeKey = (movedDir === "U") ? "D" : "U";

  // 1) rigenera le 4 laterali
  await hsBuildRandomRooms(["L", "R", "F", "B"], ["C", oppositeKey]);

  // 2) il nuovo piano oltre (U se salito, D se sceso): stessa forma di C, chiuso
  const newNeighborKey = movedDir;
  const newNeighbor = __hs.roomSlots.get(newNeighborKey);
  if (newNeighbor) {
    await hsAssignModelToSlot(newNeighborKey, slotC.modelRow);
    newNeighbor.openUp = false;
    newNeighbor.openDown = false;
  }

  // 3) applica visibilità coerente (C+laterali) e coerenza U/D + colliders
  await hsApplyVerticalState();
}


return {
  renderBody: hsRenderBody, getRightMenu: hsGetRightMenu, destroy: hsDestroyThree, state: __hs,
  flowApi: () => hsFlowApi(),          // per model_FLE::_injectTestContext
  get object() { return __hs.object; },
};
} // fine hsCreateInstance


// ====================================================================
// PLUGIN (contratto template_XXX.mjs): delega all'istanza del pannello
// ====================================================================
export default {
  async renderBody(ctx) {
    const { bodyEl, signal } = ctx;
    bodyEl[HYS_STATE_KEY]?.destroy();            // pannello riusato: via la vecchia istanza
    const inst = hsCreateInstance();
    bodyEl[HYS_STATE_KEY] = inst;
    signal?.addEventListener?.("abort", () => {
      if (bodyEl[HYS_STATE_KEY] === inst) delete bodyEl[HYS_STATE_KEY];
    }, { once: true });
    return inst.renderBody(ctx);
  },

  getLeftMenu({ object }) {
    return {
      title: getObjectDisplayName(object),
      items: [],
    };
  },

  getRightMenu({ bodyEl } = {}) {
    return bodyEl?.[HYS_STATE_KEY]?.getRightMenu() ?? { title: "☰", items: [] };
  },

  destroy() {
    // il framework aborta signal (template_XXX.mjs) → hsDestroyThree() dell'istanza
  },
};