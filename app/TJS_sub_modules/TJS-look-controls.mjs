// TJS_sub_modules/TJS-look-controls.mjs
//
// Vista in prima persona con Pointer Lock, robusta (nata in HySpace, ora generica).

import { THREE } from "./TJS-loaders.mjs";

/**
 * Controllo della vista in prima persona con Pointer Lock (sostituisce
 * PointerLockControls di three.js, che applica ogni evento del mouse così com'è).
 * Robusto ai problemi che su alcune postazioni rendevano la vista "storta":
 * - il primo evento dopo la cattura del mouse porta spesso uno spostamento enorme
 *   (bug noto di Chrome/Windows): gli eventi dei primi `settleMs` sono ignorati;
 * - desktop remoto / driver che mandano salti: scartati gli eventi oltre `maxDelta`;
 * - accelerazione del sistema operativo: si chiede il movimento grezzo
 *   (`unadjustedMovement`), con ripiego sulla richiesta normale;
 * - la camera resta dritta: rollio sempre 0, inclinazione limitata a ±`maxPitch`.
 * Interfaccia (usata da model_HYS e dalla modalità prima persona): isLocked, lock(), unlock(),
 * addEventListener("lock" | "unlock"), dispose().
 */
export function TJS_createLookControls(camera, domElement, {
  sensitivity = 0.002,   // rad per pixel
  maxDelta = 250,        // px per evento oltre i quali l'evento è un salto anomalo
  settleMs = 120,        // ms ignorati subito dopo la cattura
  maxPitch = Math.PI / 2 - 0.02,
} = {}) {
  const doc = domElement.ownerDocument;
  const events = new EventTarget();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  let locked = false;
  let lockedAt = 0;

  function onMouseMove(e) {
    if (!locked) return;
    if (performance.now() - lockedAt < settleMs) return;
    const mx = e.movementX || 0;
    const my = e.movementY || 0;
    if (Math.abs(mx) > maxDelta || Math.abs(my) > maxDelta) return;

    euler.setFromQuaternion(camera.quaternion, "YXZ");
    euler.y -= mx * sensitivity;
    euler.x = Math.max(-maxPitch, Math.min(maxPitch, euler.x - my * sensitivity));
    euler.z = 0;
    camera.quaternion.setFromEuler(euler);
  }

  // rotazione a comando (levetta destra del gamepad), stessi limiti del mouse
  function rotateBy(dYaw, dPitch) {
    euler.setFromQuaternion(camera.quaternion, "YXZ");
    euler.y += dYaw;
    euler.x = Math.max(-maxPitch, Math.min(maxPitch, euler.x + dPitch));
    euler.z = 0;
    camera.quaternion.setFromEuler(euler);
  }

  function onLockChange() {
    const now = doc.pointerLockElement === domElement;
    if (now === locked) return;
    locked = now;
    if (now) lockedAt = performance.now();
    events.dispatchEvent(new Event(now ? "lock" : "unlock"));
  }

  function onLockError() {
    // es. subito dopo un Esc Chrome rifiuta per ~1 s una nuova cattura: basta ripetere il clic
    console.warn("[TJS] cattura del mouse rifiutata dal browser: riprova tra un istante");
  }

  function lock() {
    // Chrome/Edge: Promise, rifiutata se unadjustedMovement non è supportato → richiesta normale.
    // Firefox/Safari: nessuna Promise, l'opzione viene ignorata e la richiesta procede.
    try {
      const p = domElement.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === "function") p.catch(() => domElement.requestPointerLock());
    } catch {
      domElement.requestPointerLock();
    }
  }

  function unlock() {
    if (doc.pointerLockElement === domElement) doc.exitPointerLock();
  }

  doc.addEventListener("mousemove", onMouseMove);
  doc.addEventListener("pointerlockchange", onLockChange);
  doc.addEventListener("pointerlockerror", onLockError);

  function dispose() {
    unlock();
    doc.removeEventListener("mousemove", onMouseMove);
    doc.removeEventListener("pointerlockchange", onLockChange);
    doc.removeEventListener("pointerlockerror", onLockError);
  }

  return {
    get isLocked() { return locked; },
    lock,
    unlock,
    rotateBy,
    dispose,
    addEventListener: (type, fn) => events.addEventListener(type, fn),
    removeEventListener: (type, fn) => events.removeEventListener(type, fn),
  };
}
