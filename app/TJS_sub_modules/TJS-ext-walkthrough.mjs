// TJS_sub_modules/TJS-ext-walkthrough.mjs
//
// Estensione "walkthrough": visita in prima persona di un pannello TJS (camminata con
// collisioni e gradini, vista col mouse catturato, tastiera WASD/frecce, gamepad, mirino
// e pick al centro della vista). Installata dal nodo TJS/Setup/Walkthrough; usa i moduli
// generici estratti da HySpace (TJS-look-controls, TJS-walk, TJS-gamepad).
//
// Registra il controller "walk" nel ControlsManager del pannello: entrare/uscire dalla
// prima persona = passare da/verso Orbit (voce del menu oggetto, bottone Orbit/EyeLock
// della toolbar, nodo). Il lavoro per frame sta in update() del controller, dentro il
// ciclo di TJS; da fermi non si fanno raycast.
//
// Visore (WebXR, TJS-webxr.mjs): voce di menu "Entra in VR (visore)" se il browser ne
// offre uno. In VR la camera viaggia su un "carrello" (dolly) posato sui piedi: levetta
// sinistra = cammina (stessa fisica, riferita alla testa proiettata sul pavimento),
// destra = rotazione a scatti, grilletto = pick lungo il raggio del controller, B/Y tenuto
// 1,5 s = esci dal visore. Uscendo si resta in prima persona dov'era la testa.
//
// Touch (tablet, TJS-touch.mjs), attivo solo in prima persona: modalità "stick" = levetta
// a sinistra + trascina a destra per guardare, tocco = pick nel punto; modalità "tap" =
// trascina per guardare, tocco sul pavimento = cammina fin lì (TJS_createAutoWalk), tocco
// su altro = pick. Tocco prolungato = pick nel punto in entrambe.

import { TJS_createLookControls } from "./TJS-look-controls.mjs";
import {
  TJS_createWalkState, TJS_walkPlanarMove, TJS_walkResolveWalls, TJS_walkGrounding,
  TJS_walkFallGuard, TJS_walkInvalidateSafePoint, TJS_collectVisibleMeshesByName, TJS_isActuallyVisible,
  TJS_createAutoWalk, TJS_hitWorldNormalY,
} from "./TJS-walk.mjs";
import { TJS_createTouchInput } from "./TJS-touch.mjs";
import { TJS_createGamepadInput, TJS_PAD } from "./TJS-gamepad.mjs";
import { TJS_createXR, TJS_isXRSupported, TJS_XR_BUTTON } from "./TJS-webxr.mjs";
import { t } from "../shared/i18n.mjs";

export const TJS_WALKTHROUGH_DEFAULTS = {
  height: 1.65,        // m, occhi sopra i piedi
  speed: 1.8,          // m/s a regime
  radius: 0.35,        // m, ingombro del corpo contro i muri
  stepHeight: 0.35,    // m, gradino superabile
  gravity: true,       // false = si resta alla quota di partenza (niente appoggio a terra)
  collisions: true,    // false = si attraversano i muri
  colliders: "",       // nomi di nodi separati da virgola; vuoto = tutte le mesh visibili dei modelli
  start: null,         // [x, y, z] dei piedi; null = sotto la camera attuale
  yawDeg: null,        // direzione dello sguardo alla partenza (0 = verso −Z); null = quella attuale
  fovDeg: 0,           // 0 = lascia il campo visivo della camera
  autoStart: true,     // parte subito in prima persona
  vr: true,            // voce "Entra in VR (visore)" se il browser offre WebXR
  snapDeg: 30,         // rotazione a scatti in VR (levetta destra), gradi
  touchMode: "stick",  // touch: "stick" (levetta + sguardo) | "tap" (tocca il pavimento per andare)
  touchLook: 1,        // touch: sensibilità dello sguardo (1 = il punto sotto il dito lo segue)
};

const DAMPING = 20;                         // come HySpace: arresto rapido
const PAD_LOOK = { yaw: 2.2, pitch: 1.6 };  // rad/s a levetta destra piena
const XR_EXIT_HOLD = 1.5;                   // s di B/Y tenuto per uscire dal visore
const WALK_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export default async function createWalkthrough(api, options = {}) {
  const { THREE } = api;
  let opts = { ...TJS_WALKTHROUGH_DEFAULTS, ...clean(options) };

  const walker = TJS_createWalkState();
  const body = new THREE.Object3D();      // piedi del visitatore (non in scena)
  const move = new THREE.Vector3();
  const lastCamPos = new THREE.Vector3();
  const lastCamQuat = new THREE.Quaternion();
  const pad = TJS_createGamepadInput();

  let active = false;
  let placed = false;                     // posizione iniziale già applicata
  let look = null, lookCam = null;
  let savedFov = null;
  let hovered = false;
  let controllerCtx = null;               // ctx del ControlsManager (onPick, setReticle)
  let touch = null;                       // TJS_createTouchInput, solo in prima persona
  const autoWalk = TJS_createAutoWalk();
  const floorRay = new THREE.Raycaster();

  const dom = () => api.renderer.domElement;
  const onEnterEl = () => { hovered = true; };
  const onLeaveEl = () => { hovered = false; };
  dom().addEventListener("pointerenter", onEnterEl);
  dom().addEventListener("pointerleave", onLeaveEl);

  applyOptions();

  function clean(o) {
    const out = {};
    for (const [k, v] of Object.entries(o ?? {})) if (v !== undefined && v !== null && v !== "") out[k] = v;
    if (o && "start" in o) out.start = parseVec(o.start);
    if (o && "yawDeg" in o) out.yawDeg = o.yawDeg ?? null;
    return out;
  }

  function parseVec(v) {
    if (Array.isArray(v)) return v.length >= 3 && v.every(Number.isFinite) ? v.slice(0, 3) : null;
    if (v && typeof v === "object" && Number.isFinite(v.x)) return [v.x, v.y ?? 0, v.z ?? 0];
    if (typeof v === "string" && v.trim()) {
      const n = v.split(/[\s,;]+/).map(Number);
      return n.length >= 3 && n.slice(0, 3).every(Number.isFinite) ? n.slice(0, 3) : null;
    }
    return null;
  }

  function applyOptions() {
    walker.playerHeight = Number(opts.height) || TJS_WALKTHROUGH_DEFAULTS.height;
    walker.playerRadius = Number(opts.radius) || TJS_WALKTHROUGH_DEFAULTS.radius;
    walker.stepHeight = Number(opts.stepHeight) || TJS_WALKTHROUGH_DEFAULTS.stepHeight;
    walker.damping = DAMPING;
    // a regime v = speed·12/damping → speed interno dalla velocità voluta in m/s
    walker.speed = (Number(opts.speed) || TJS_WALKTHROUGH_DEFAULTS.speed) * DAMPING / 12;
    rebuildColliders();
  }

  /** Collider: mesh visibili dei nodi indicati, o di tutti i modelli. Nuovo array ogni volta. */
  function rebuildColliders() {
    if (!opts.collisions && !opts.gravity) { walker.colliders = []; return; }
    const root = api.modelsRoot;
    const names = String(opts.colliders ?? "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    if (names.length) {
      walker.colliders = TJS_collectVisibleMeshesByName(root, names, []);
    } else {
      const out = [];
      root?.traverse((o) => { if (o.isMesh && TJS_isActuallyVisible(o, root)) out.push(o); });
      walker.colliders = out;
    }
  }

  function place() {
    const cam = api.camera;
    const start = opts.start;
    if (start) body.position.set(start[0], start[1], start[2]);
    else body.position.set(cam.position.x, cam.position.y - walker.playerHeight, cam.position.z);
    if (Number.isFinite(Number(opts.yawDeg)) && opts.yawDeg !== null) {
      cam.quaternion.setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(Number(opts.yawDeg)), 0, "YXZ"));
    } else {
      // sguardo attuale, senza rollio
      const e = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ");
      cam.quaternion.setFromEuler(new THREE.Euler(e.x, e.y, 0, "YXZ"));
    }
    walker.velocity.set(0, 0, 0);
    walker.vY = 0;
    walker.onGround = false;
    TJS_walkInvalidateSafePoint(walker);
    placed = true;
    syncCamera();
  }

  function syncCamera() {
    const cam = api.camera;
    cam.position.set(body.position.x, body.position.y + walker.playerHeight, body.position.z);
    cam.updateMatrixWorld();
  }

  function ensureLook() {
    if (look && lookCam === api.camera) return;
    look?.dispose();
    lookCam = api.camera;
    look = TJS_createLookControls(lookCam, dom());
  }

  function hint(text) { try { api.cmdUI?.update?.({ hints: text }); } catch {} }

  // ─── Touch ────────────────────────────────────────────────────────────────
  const TOUCH_HELP = {
    stick: t("app.tjs.walk.touch_help_stick"),
    tap:   t("app.tjs.walk.touch_help_tap"),
  };

  function startTouch() {
    if (touch) return;
    try {
      touch = TJS_createTouchInput(dom(), {
        mode: opts.touchMode,
        onStart: () => hint(TOUCH_HELP[touch?.mode] ?? TOUCH_HELP.stick),
        onLook: touchLook,
        onTap: touchTap,
        onLongPress: (x, y) => pickAt(x, y),
      });
    } catch (e) {
      // il touch non deve mai impedire la camminata con mouse, tastiera, gamepad o visore
      console.warn("[TJS walkthrough] touch non disponibile:", e);
      touch = null;
    }
  }
  function stopTouch() { touch?.dispose(); touch = null; autoWalk.stop(); }

  // trascinare "afferra il mondo" (come Street View)
  function touchLook(dx, dy) {
    const cam = api.camera, el = dom();
    if (!cam?.isPerspectiveCamera) return;
    ensureLook();
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect);
    const k = (hfov / Math.max(1, el.clientWidth)) * (Number(opts.touchLook) || 1);
    look?.rotateBy(dx * k, dy * k);
    api.markDirty();
  }

  function pickAt(x, y) {
    const hit = api.raycast(x, y);
    if (hit) controllerCtx?.onPick?.(hit);
  }

  function touchTap(x, y) {
    autoWalk.stop();
    if (touch?.mode === "tap") {
      const p = floorAt(x, y);
      if (p) { autoWalk.start([p]); return; }
    }
    pickAt(x, y);
  }

  // punto di pavimento toccato: superficie camminabile dei collider (o dei modelli)
  function floorAt(x, y) {
    const targets = walker.colliders.length ? walker.colliders : [api.modelsRoot];
    floorRay.setFromCamera(new THREE.Vector2(x, y), api.camera);
    floorRay.far = 60;
    const hit = floorRay.intersectObjects(targets, !walker.colliders.length)[0];
    return hit && TJS_hitWorldNormalY(hit) > 0.6 ? hit.point.clone() : null;
  }

  function setTouchMode(mode) {
    opts.touchMode = mode === "tap" ? "tap" : "stick";
    touch?.setMode(opts.touchMode);
    autoWalk.stop();
  }

  /** Un passo di fisica sul corpo (piedi): movimento nella direzione di `lookObj`, muri, appoggio, cadute. */
  function stepPhysics(dt, lookObj) {
    TJS_walkPlanarMove(walker, lookObj, dt, move);
    if (move.lengthSq() > 1e-10) {
      body.position.add(move);
      if (opts.collisions) TJS_walkResolveWalls(walker, body);
    } else if (!walker.keys.size && !walker.padMove?.x && !walker.padMove?.y) {
      walker.velocity.x = walker.velocity.z = 0;    // fermo davvero: niente raggi contro i muri
    }
    if (opts.gravity) {
      TJS_walkGrounding(walker, body, dt);
      if (TJS_walkFallGuard(walker, body, dt, { fallback: opts.start ?? null })) {
        hint(t("app.tjs.walk.fall_reset"));
      }
    }
  }

  // ─── WebXR ────────────────────────────────────────────────────────────────
  let xr = null, dolly = null, camSaved = null;
  let snapHeld = false, exitT = 0, lastYaw = 0;
  const xrRay = new THREE.Raycaster();
  const head = new THREE.Vector3();
  const headOff = new THREE.Vector3();
  const headLook = { quaternion: new THREE.Quaternion() };
  const tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");

  function ensureXR() {
    if (xr) return xr;
    dolly = new THREE.Group();
    dolly.name = "TJS_XR_DOLLY";
    api.scene.add(dolly);
    xr = TJS_createXR({ renderer: api.renderer, dolly, onStart: onXRStart, onEnd: onXREnd });
    return xr;
  }

  /** Dal clic sul menu (gesto dell'utente, richiesto dal browser): niente await prima di enter(). */
  function enterXR() {
    if (xr?.presenting) return;
    if (!api.camera?.isPerspectiveCamera) { hint(t("app.tjs.xr.need_perspective")); return; }
    if (api.activeControls !== "walk") api.setControls("walk");
    api.setAnimationLoop(true);          // in XR il ciclo lo detta il visore
    ensureXR().enter().catch(async (e) => {
      api.setAnimationLoop(false);
      let why = e?.message ?? String(e);
      if (!navigator.xr) why = t("app.tjs.xr.no_webxr");
      else if (!(await TJS_isXRSupported())) why = t("app.tjs.xr.no_headset");
      hint(t("app.tjs.xr.enter_failed", { reason: why }));
      console.warn("[TJS walkthrough] VR:", e);
    });
  }

  function onXRStart() {
    const cam = api.camera;
    look?.unlock();
    walker.keys.clear();
    walker.velocity.set(0, 0, 0);
    camSaved = { parent: cam.parent, fov: cam.fov, aspect: cam.aspect, zoom: cam.zoom };
    // carrello sui piedi, orientato come lo sguardo; la camera diventa figlia del
    // carrello e il visore ne decide posa e altezza (riferimento "local-floor")
    tmpEuler.setFromQuaternion(cam.quaternion, "YXZ");
    lastYaw = tmpEuler.y;
    dolly.position.copy(body.position);
    dolly.rotation.set(0, lastYaw, 0);
    cam.parent?.remove(cam);
    dolly.add(cam);
    cam.position.set(0, 0, 0);
    cam.quaternion.identity();
    controllerCtx?.setReticle?.(false);
    api.markDirty();
  }

  /** Riporta la camera fuori dal carrello, dove era la testa (idempotente). */
  function restoreCamera() {
    if (!camSaved) return;
    const cam = api.camera;
    cam.getWorldPosition(head);
    dolly.remove(cam);
    camSaved.parent?.add(cam);
    body.position.set(head.x, dolly.position.y, head.z);
    cam.quaternion.setFromEuler(tmpEuler.set(0, lastYaw, 0, "YXZ"));
    // il visore ha riscritto campo visivo e proiezione della camera
    if (cam.isPerspectiveCamera) { cam.fov = camSaved.fov; cam.aspect = camSaved.aspect; cam.zoom = camSaved.zoom ?? 1; }
    cam.updateProjectionMatrix();
    camSaved = null;
    walker.padMove = null;
    walker.velocity.set(0, 0, 0);
    syncCamera();
  }

  function onXREnd() {
    restoreCamera();
    api.setAnimationLoop(false);
    if (active) controllerCtx?.setReticle?.(true);
    api.markDirty();
  }

  /** Rotazione a scatti del carrello attorno alla verticale della testa. */
  function snapTurn(sign) {
    const angle = sign * THREE.MathUtils.degToRad(Number(opts.snapDeg) || 30);
    api.camera.getWorldPosition(head);
    const o = dolly.position.clone().sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    dolly.position.set(head.x + o.x, dolly.position.y, head.z + o.z);
    dolly.rotation.y += angle;
  }

  function updateXR(dt) {
    const st = xr.poll();
    walker.padMove = st.left?.stick ?? null;

    const rx = st.right?.stick.x ?? 0;
    if (Math.abs(rx) > 0.7 && !snapHeld) { snapTurn(rx > 0 ? -1 : 1); snapHeld = true; }
    else if (Math.abs(rx) < 0.3) snapHeld = false;

    const exitHeld = st.right?.held.has(TJS_XR_BUTTON.B) || st.left?.held.has(TJS_XR_BUTTON.B);
    exitT = exitHeld ? exitT + dt : 0;
    if (exitT > XR_EXIT_HOLD) { exitT = 0; xr.exit(); return true; }

    // corpo = testa proiettata sul pavimento: chi indossa il visore può anche spostarsi
    // fisicamente dentro il carrello; la fisica muove il corpo, il carrello lo segue
    const cam = api.camera;
    cam.getWorldPosition(head);
    headOff.set(head.x - dolly.position.x, 0, head.z - dolly.position.z);
    body.position.set(head.x, dolly.position.y, head.z);
    cam.getWorldQuaternion(headLook.quaternion);
    stepPhysics(dt, headLook);
    dolly.position.set(body.position.x - headOff.x, body.position.y, body.position.z - headOff.z);

    // grilletto = pick lungo il raggio (raycast solo alla pressione: modelli pesanti)
    for (const hand of ["right", "left"]) {
      const h = st[hand];
      if (!h?.pressed.has(TJS_XR_BUTTON.TRIGGER)) continue;
      xrRay.setFromXRController(h.controller);
      const hit = xrRay.intersectObject(api.modelsRoot, true)[0] ?? null;
      xr.setRayLength(h.controller, hit ? hit.distance : null);
      if (hit) controllerCtx?.onPick?.(hit);
    }

    tmpEuler.setFromQuaternion(headLook.quaternion, "YXZ");
    lastYaw = tmpEuler.y;
    return true;
  }

  // ─── controller "walk" per il ControlsManager ─────────────────────────────
  const controller = {
    activate(ctx) {
      controllerCtx = ctx;
      active = true;
      ensureLook();
      rebuildColliders();
      if (!placed) place(); else syncCamera();
      const cam = api.camera;
      if (opts.fovDeg > 0 && cam.isPerspectiveCamera) {
        savedFov = cam.fov;
        cam.fov = Number(opts.fovDeg);
        cam.updateProjectionMatrix();
      }
      // i clic servono a guardare e al pick al centro: niente selezione/gizmo (che a fine
      // trascinamento riaccenderebbe anche l'orbita)
      api.transformTool?.setEnabled?.(false);
      ctx?.setReticle?.(true);
      startTouch();
      hint(t("app.tjs.walk.first_person_help"));
      api.markDirty();
    },
    deactivate(ctx) {
      if (xr?.presenting) { xr.exit(); restoreCamera(); api.setAnimationLoop(false); }
      active = false;
      look?.unlock();
      walker.keys.clear();
      walker.velocity.set(0, 0, 0);
      ctx?.setReticle?.(false);
      stopTouch();
      api.transformTool?.setEnabled?.(true);
      const cam = api.camera;
      if (savedFov != null && cam.isPerspectiveCamera) { cam.fov = savedFov; cam.updateProjectionMatrix(); }
      savedFov = null;
      hint("");
      api.markDirty();
    },
    handleEvent(e, ctx) {
      if (!active) return;
      if (e.pointerType === "touch") return;   // il touch lo gestisce TJS-touch.mjs
      const et = e.type;
      if (et === "pointerdown" && e.button === 0) {
        if (!look?.isLocked) { look?.lock(); return; }
        const hit = api.raycast(0, 0);
        if (hit) ctx?.onPick?.(hit);
        return;
      }
      if (et === "keydown" || et === "keyup") {
        const tag = e.target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
        if (!WALK_KEYS.has(e.code)) return;
        if (et === "keyup") { walker.keys.delete(e.code); return; }
        if (!look?.isLocked && !hovered) return;   // tasti solo per il pannello "in uso"
        walker.keys.add(e.code);
        if (e.code.startsWith("Arrow")) e.preventDefault();
      }
    },
    update(dt) {
      if (!active) return false;
      dt = Math.min(dt, 0.05);
      if (xr?.presenting && camSaved) return updateXR(dt);
      const cam = api.camera;
      if (lookCam !== cam) ensureLook();

      // gamepad: levetta sinistra = cammina, destra = guarda, A = pick, B = libera il cursore
      const p = pad.poll();
      walker.padMove = p.connected ? p.move : null;
      if (p.connected) {
        if (p.look.x || p.look.y) look?.rotateBy(-p.look.x * PAD_LOOK.yaw * dt, -p.look.y * PAD_LOOK.pitch * dt);
        if (p.pressed.has(TJS_PAD.A)) { const hit = api.raycast(0, 0); if (hit) controllerCtx?.onPick?.(hit); }
        if (p.pressed.has(TJS_PAD.B)) look?.unlock();
      }

      // touch: la levetta ha la precedenza, altrimenti il cammino automatico
      if (touch?.stickActive) {
        autoWalk.stop();
        walker.padMove = { x: touch.move.x, y: touch.move.y };
      } else if (autoWalk.active) {
        const yaw = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ").y;
        const { move: m, status } = autoWalk.step(dt, body.position, yaw);
        if (m) walker.padMove = { x: m.x, y: m.y };
        if (status === "stuck") hint(t("app.tjs.walk.path_stuck"));
      }

      stepPhysics(dt, cam);
      syncCamera();

      const changed = !lastCamPos.equals(cam.position) || !lastCamQuat.equals(cam.quaternion);
      lastCamPos.copy(cam.position);
      lastCamQuat.copy(cam.quaternion);
      return changed;
    },
  };

  api.registerControls("walk", controller);

  api.addMenuItem({
    side: "left",
    label: () => (active ? t("app.tjs.walk.menu_exit") : t("app.tjs.walk.menu_enter")),
    onClick: () => api.setControls(active ? "orbit" : "walk"),
  });

  api.addMenuItem({
    side: "left",
    label: () => (opts.touchMode === "tap" ? t("app.tjs.walk.menu_touch_stick") : t("app.tjs.walk.menu_touch_tap")),
    onClick: () => { setTouchMode(opts.touchMode === "tap" ? "stick" : "tap"); hint(TOUCH_HELP[opts.touchMode]); },
  });

  // voce "visore" solo dove c'è davvero (Quest Browser, emulatore WebXR…)
  if (opts.vr !== false && await TJS_isXRSupported()) {
    api.addMenuItem({ side: "left", label: () => t("app.tjs.xr.menu_enter"), onClick: enterXR });
  }

  if (opts.autoStart) api.setControls("walk");

  return {
    get active() { return active; },
    /** Posizione dei piedi [x, y, z]. */
    get position() { return body.position.toArray(); },
    get feet() { return body.position; },
    enter() { api.setControls("walk"); },
    exit() { if (active) api.setControls("orbit"); },
    /** Riporta alla partenza (proprietà start, o sotto la camera attuale). */
    reset() { autoWalk.stop(); placed = false; if (active) place(); api.markDirty(); },
    /** Sposta i piedi in [x, y, z] (sguardo invariato). */
    teleport(pos) {
      const v = parseVec(pos);
      if (!v) return;
      autoWalk.stop();
      body.position.set(v[0], v[1], v[2]);
      walker.vY = 0;
      TJS_walkInvalidateSafePoint(walker);
      placed = true;
      if (active) syncCamera();
      api.markDirty();
    },
    rebuildColliders,
    enterXR,
    get presenting() { return !!xr?.presenting; },
    configure(o) {
      const had = opts.start;
      opts = { ...opts, ...clean(o) };
      applyOptions();
      if (String(had) !== String(opts.start)) placed = false;
      if (active && !placed) place();
      if (touch && touch.mode !== opts.touchMode) setTouchMode(opts.touchMode);
    },
    dispose() {
      try { if (xr?.presenting) restoreCamera(); } catch {}
      try { xr?.dispose(); } catch {}
      if (dolly) api.scene.remove(dolly);
      try { look?.dispose(); } catch {}
      stopTouch();
      pad.dispose();
      dom().removeEventListener("pointerenter", onEnterEl);
      dom().removeEventListener("pointerleave", onLeaveEl);
    },
  };
}
