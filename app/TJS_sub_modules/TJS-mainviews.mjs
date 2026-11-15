// TJS-mainviews.mjs
import * as THREE from "three";

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function getAspect(renderer) {
  const v = new THREE.Vector2();
  renderer.getSize(v);
  return v.y > 0 ? (v.x / v.y) : 1;
}

function computeSceneBounds(root) {
  const box = new THREE.Box3().setFromObject(root);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);

  // fallback se scena vuota o dimensione ~0
  if (!Number.isFinite(sphere.radius) || sphere.radius < 1e-6) {
    sphere.center.set(0, 0, 0);
    sphere.radius = 1;
  }
  return { box, sphere };
}

/**
 * Direzioni canoniche (world) + up consigliato per non avere rotazioni "strane".
 * Convenzione:
 * - Front: camera da +Z guarda verso -Z (verso il centro)
 * - Back:  camera da -Z guarda verso +Z
 * - Right: camera da +X guarda verso -X
 * - Left:  camera da -X guarda verso +X
 * - Top:   camera da +Y guarda verso -Y
 * - Bottom:camera da -Y guarda verso +Y
 */
function getViewAxes(viewName) {
  const v = String(viewName || "").toLowerCase().trim();

  // dir = direzione dal target verso la camera (cioè dove metto la camera rispetto al centro)
  // up = asse "alto schermo"
  switch (v) {
    case "front":  return { dir: new THREE.Vector3(0, 0,  1), up: new THREE.Vector3(0, 1, 0) };
    case "back":   return { dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) };
    case "right":  return { dir: new THREE.Vector3( 1, 0, 0), up: new THREE.Vector3(0, 1, 0) };
    case "left":   return { dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) };
    case "top":    return { dir: new THREE.Vector3(0,  1, 0), up: new THREE.Vector3(0, 0, -1) }; // up = -Z per “nord” stabile
    case "bottom": return { dir: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0,  1) };
    default:       return { dir: new THREE.Vector3(0, 0,  1), up: new THREE.Vector3(0, 1, 0) };
  }
}

/**
 * Imposta una vista principale assoluta (Front/Left/Back/Right/Top/Bottom),
 * indipendente da camera/target correnti.
 *
 * Preserva:
 * - tipo camera corrente (perspective vs orthographic)
 * - modalità interazione corrente (orbit vs eyelock)
 *
 * Richiede nello state (bodyEl[STATE_KEY]):
 * - camera
 * - renderer
 * - orbitControls
 * - modelsRoot (o un root equivalente che contiene tutti gli oggetti)
 * - ctx (opzionale ma consigliato: { camera, ... })
 * - eyeLockControls (opzionale: per riallineare yaw/pitch se attivo)
 * - activeControls ("orbit"|"eyelock")
 */
export function tjsSetMainView(bodyEl, viewName, {
  STATE_KEY = "__TJS_RENDER_STATE__",
  fitOffset = 1.25,
  padding = 0.0,
  minNear = 0.01,
} = {}) {
  const st = bodyEl?.[STATE_KEY];
  if (!st?.camera || !st?.renderer || !st?.orbitControls) {
    throw new Error("tjsSetMainView: state/camera/renderer/orbitControls mancanti");
  }

  const root = st.modelsRoot || st.pickables?.[0] || null;
  if (!root) throw new Error("tjsSetMainView: modelsRoot/pickables mancanti");

  const { sphere } = computeSceneBounds(root);
  const center = sphere.center.clone();
  const radius = Math.max(1e-6, sphere.radius + (padding || 0));

  const { dir, up } = getViewAxes(viewName);
  _frameView(st, center, radius, dir.normalize(), up, { fitOffset, minNear });
  return { view: viewName, center, radius };
}

/**
 * Inquadra una sfera (center, radius) guardando lungo -dir (la camera sta in center + dir·d).
 * Usata per la vista di fronte a un piano di taglio (2026-10-18). up: asse Y del mondo,
 * oppure -Z quando dir è quasi verticale (come la vista Top).
 */
export function tjsViewAlongDirection(st, center, radius, dir, { fitOffset = 1.25, minNear = 0.01 } = {}) {
  if (!st?.camera || !st?.renderer || !st?.orbitControls) return null;
  const d = dir.clone().normalize();
  const up = Math.abs(d.y) > 0.95 ? new THREE.Vector3(0, 0, d.y > 0 ? -1 : 1) : new THREE.Vector3(0, 1, 0);
  _frameView(st, center.clone(), Math.max(1e-6, radius), d, up, { fitOffset, minNear });
  return { center, radius };
}

function _frameView(st, center, radius, dir, up, { fitOffset, minNear }) {
  const aspect = getAspect(st.renderer);
  const cam = st.camera;
  cam.up.copy(up);

  if (cam.isPerspectiveCamera) {
    const fovRad = THREE.MathUtils.degToRad(cam.fov);
    const tanV = Math.tan(fovRad / 2);
    const tanH = tanV * aspect;

    const r = radius * fitOffset;
    const dV = r / Math.max(1e-6, tanV);
    const dH = r / Math.max(1e-6, tanH);
    const dist = Math.max(dV, dH);

    cam.position.copy(center).addScaledVector(dir, dist);

    cam.near = Math.max(minNear, dist - r * 2);
    cam.far  = Math.max(cam.near + 1, dist + r * 4);

    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.lookAt(center);

    st.orbitControls.target.copy(center);
    st.orbitControls.update();
    st.orbitDistance = dist;

  } else if (cam.isOrthographicCamera) {
    const r = radius * fitOffset;

    const halfH = r;
    const halfW = r * aspect;

    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;

    cam.zoom = 1;
    cam.updateProjectionMatrix();

    const dist = r * 2.5;
    cam.position.copy(center).addScaledVector(dir, dist);

    cam.near = Math.max(minNear, dist - r * 6);
    cam.far  = Math.max(cam.near + 1, dist + r * 6);
    cam.updateProjectionMatrix();

    cam.lookAt(center);

    st.orbitControls.target.copy(center);
    st.orbitControls.update();
    st.orbitDistance = dist;

  } else {
    throw new Error("tjsSetMainView/tjsViewAlongDirection: tipo camera non supportato");
  }

  // Mantieni coerenti i riferimenti (manager/eyelock)
  if (st.ctx) st.ctx.camera = st.camera;

  // ✅ UNA SOLA VOLTA, qui: vale per entrambe le proiezioni
  if (st.activeControls === "eyelock") {
    st.eyeLockControls?.syncFromCamera?.(st.camera);
  }

  st.markDirty?.();
}
