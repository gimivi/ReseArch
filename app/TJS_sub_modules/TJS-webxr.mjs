// TJS_sub_modules/TJS-webxr.mjs
//
// Realtà virtuale immersiva (WebXR) per le app 3D della piattaforma: sessione
// "immersive-vr" con altezza dal pavimento del visore, controller con raggio e
// modello 3D, lettura di levette e tasti. Nessuna logica di navigazione: l'app
// decide cosa fare degli ingressi (come TJS-gamepad.mjs).
//
// Requisiti: pagina in HTTPS, browser con WebXR (es. Meta Quest Browser), enter()
// chiamato da un gesto dell'utente (click). Il renderer deve disegnare con
// renderer.setAnimationLoop() (in XR requestAnimationFrame non viene chiamato).
//
// Controller, mappatura "xr-standard" (inputSource.gamepad):
//   assi 2/3 = levetta (x, y; y positivo = verso di sé) · assi 0/1 = touchpad
//   tasti 0 grilletto · 1 impugnatura · 2 touchpad · 3 pressione levetta · 4 A/X · 5 B/Y
// I controller con touchpad al posto della levetta (HTC Vive "wand") usano gli
// assi 0/1: poll() li legge come levetta quando la levetta non c'è.

import { THREE } from "./TJS-loaders.mjs";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";

export const TJS_XR_BUTTON = { TRIGGER: 0, SQUEEZE: 1, TOUCHPAD: 2, STICK: 3, A: 4, B: 5 };

/** true se il browser può aprire una sessione VR immersiva. */
export async function TJS_isXRSupported(mode = "immersive-vr") {
  try { return !!(await navigator.xr?.isSessionSupported(mode)); }
  catch { return false; }
}

/**
 * @param {{
 *   renderer: THREE.WebGLRenderer,
 *   dolly: THREE.Object3D,          // "carrello" che porta camera e controller (si muove con la navigazione)
 *   onStart?: Function, onEnd?: Function,
 *   rayLength?: number, deadzone?: number, foveation?: number,
 * }} opts
 */
export function TJS_createXR({ renderer, dolly, onStart = null, onEnd = null,
                               rayLength = 5, deadzone = 0.15, foveation = 1 }) {
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");   // altezza reale di chi indossa il visore
  renderer.xr.setFoveation?.(foveation);              // meno pixel ai bordi: più fotogrammi al secondo

  const modelFactory = new XRControllerModelFactory();
  const controllers = [];                             // { index, ray, grip, line, source, prev }

  for (let i = 0; i < 2; i++) {
    const ray = renderer.xr.getController(i);         // spazio del raggio di puntamento
    const grip = renderer.xr.getControllerGrip(i);    // spazio dell'impugnatura (modello 3D)
    grip.add(modelFactory.createControllerModel(grip));

    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x9fd7ff, transparent: true, opacity: 0.8 }));
    line.name = "TJS_XR_ray";
    line.scale.z = rayLength;
    ray.add(line);

    const c = { index: i, ray, grip, line, source: null, prev: new Set() };
    ray.addEventListener("connected", (e) => { c.source = e.data; line.visible = e.data.targetRayMode === "tracked-pointer"; });
    ray.addEventListener("disconnected", () => { c.source = null; c.prev = new Set(); });

    dolly.add(ray, grip);
    controllers.push(c);
  }

  let session = null;
  const onSessionEnd = () => { session = null; onEnd?.(); };
  renderer.xr.addEventListener("sessionend", onSessionEnd);

  async function enter() {
    if (session) return;
    if (!navigator.xr) throw new Error("WebXR non disponibile in questo browser");
    session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
    });
    await renderer.xr.setSession(session);
    onStart?.();
  }

  function exit() { session?.end(); }

  function stick(x, y) {
    const m = Math.hypot(x, y);
    if (m < deadzone) return { x: 0, y: 0 };
    const k = Math.min(1, (m - deadzone) / (1 - deadzone)) / m;
    return { x: x * k, y: y * k };
  }

  /**
   * Stato dei controller, da chiamare a ogni frame.
   * @returns {{ left: object|null, right: object|null }} per mano:
   *   { controller, stick: {x,y}, pressed: Set, held: Set }
   */
  function poll() {
    const out = { left: null, right: null };
    for (const c of controllers) {
      const gp = c.source?.gamepad;
      if (!gp) continue;
      const held = new Set();
      gp.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) held.add(i); });
      const pressed = new Set([...held].filter((i) => !c.prev.has(i)));
      c.prev = held;
      const hand = c.source.handedness === "left" ? "left" : "right";
      // levetta (assi 2/3) se presente, altrimenti touchpad (assi 0/1, es. HTC Vive)
      const hasStick = gp.axes.length >= 4;
      const ax = hasStick ? gp.axes[2] : (gp.axes[0] ?? 0);
      const ay = hasStick ? gp.axes[3] : (gp.axes[1] ?? 0);
      out[hand] = { controller: c.ray, stick: stick(ax ?? 0, ay ?? 0), pressed, held };
    }
    return out;
  }

  /** Lunghezza visibile del raggio di un controller (es. fino all'oggetto colpito). */
  function setRayLength(controller, length) {
    const c = controllers.find((k) => k.ray === controller);
    if (c) c.line.scale.z = length ?? rayLength;
  }

  function dispose() {
    exit();
    renderer.xr.removeEventListener("sessionend", onSessionEnd);
    for (const c of controllers) {
      dolly.remove(c.ray, c.grip);
      c.line.geometry.dispose();
      c.line.material.dispose();
    }
    renderer.xr.enabled = false;
  }

  return {
    enter, exit, poll, setRayLength, dispose,
    get presenting() { return renderer.xr.isPresenting; },
    get controllers() { return controllers.map((c) => c.ray); },
  };
}
