// TJS-projection.mjs
import * as THREE from "three";

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function getAspectFromRenderer(renderer) {
  const size = new THREE.Vector2();
  renderer.getSize(size); // in CSS pixels
  return size.y > 0 ? (size.x / size.y) : 1;
}

/**
 * Ricava target + distanza coerenti con la vista corrente.
 * - In orbit: usa orbit.target
 * - In eyelock: ricostruisce target = camPos + forward * orbitDistance
 */
function getViewTargetAndDistance(state) {
  const cam = state.camera;
  const orbit = state.orbitControls;

  const out = {
    target: new THREE.Vector3(),
    distance: 10,
  };

  if (orbit?.target) {
    out.target.copy(orbit.target);
    out.distance = Math.max(0.001, cam.position.distanceTo(out.target));
    return out;
  }

  // Fallback (non dovrebbe servire se orbitControls esiste sempre)
  const fwd = new THREE.Vector3();
  cam.getWorldDirection(fwd);
  const d = Math.max(0.001, state.orbitDistance ?? 10);
  out.target.copy(cam.position).addScaledVector(fwd, d);
  out.distance = d;
  return out;
}

/**
 * Costruisce un'OrthographicCamera "equivalente" a una PerspectiveCamera
 * in modo che la scala al piano del target (distanza d) resti continua.
 */
function makeOrthoFromPerspective(pCam, aspect, d) {
  const fovRad = THREE.MathUtils.degToRad(pCam.fov);
  const h = 2 * d * Math.tan(fovRad / 2);
  const w = h * aspect;

  const oCam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, pCam.near, pCam.far);
  oCam.zoom = 1;
  oCam.updateProjectionMatrix();
  return oCam;
}

/**
 * Costruisce una PerspectiveCamera "equivalente" a un'OrthographicCamera
 * (stessa scala al piano del target a distanza d).
 */
function makePerspectiveFromOrtho(oCam, aspect, d) {
  const hEff = (oCam.top - oCam.bottom) / (oCam.zoom || 1);
  const fovRad = 2 * Math.atan((hEff / 2) / Math.max(0.001, d));
  let fovDeg = THREE.MathUtils.radToDeg(fovRad);

  // clamp per evitare casi estremi
  fovDeg = clamp(fovDeg, 10, 120);

  const pCam = new THREE.PerspectiveCamera(fovDeg, aspect, oCam.near, oCam.far);
  pCam.updateProjectionMatrix();
  return pCam;
}

/**
 * Applica posa (posizione/orientamento/up) da camA a camB.
 * Mantiene la stessa direzione di vista => continuità nell'immagine.
 */
function copyPose(camA, camB) {
  camB.position.copy(camA.position);
  camB.quaternion.copy(camA.quaternion);
  camB.up.copy(camA.up);
  camB.updateMatrixWorld(true);
}

/**
 * Switch di proiezione mantenendo continuità.
 *
 * Requisiti nello state:
 * - state.camera
 * - state.renderer
 * - state.orbitControls (sempre presente, anche se non attivo)
 * - state.ctx (consigliato) con ctx.camera usato dai tuoi controlli (EyeLock)
 * - state.eyeLockControls (opzionale) se vuoi riallineare yaw/pitch
 * - state.transformTool (opzionale) se dipende dalla camera
 *
 * Effetti:
 * - sostituisce state.camera con nuova camera
 * - aggiorna orbitControls.object
 * - aggiorna ctx.camera
 * - mantiene orbit.target invariato (o coerente se eri in EyeLock)
 */
export function tjsToggleProjection(bodyEl, STATE_KEY = "__TJS_RENDER_STATE__") {
  const state = bodyEl?.[STATE_KEY];
  if (!state?.camera || !state?.renderer) throw new Error("tjsToggleProjection: state/camera/renderer mancanti");

  const cam = state.camera;
  const aspect = getAspectFromRenderer(state.renderer);

  // target+distanza coerenti con vista corrente
  const { target, distance } = getViewTargetAndDistance(state);

  let newCam;
  const isPersp = cam.isPerspectiveCamera === true;
  const isOrtho = cam.isOrthographicCamera === true;

  if (isPersp) {
    newCam = makeOrthoFromPerspective(cam, aspect, distance);
  } else if (isOrtho) {
    newCam = makePerspectiveFromOrtho(cam, aspect, distance);
  } else {
    throw new Error("tjsToggleProjection: camera non supportata (né perspective né orthographic)");
  }

  // Mantieni posa identica (continuità)
  copyPose(cam, newCam);

  // Aggiorna aspect se perspective
  if (newCam.isPerspectiveCamera) {
    newCam.aspect = aspect;
    newCam.updateProjectionMatrix();
  }

  // Swap camera nello state
  state.camera = newCam;

  // Aggiorna orbitControls a puntare alla nuova camera
  if (state.orbitControls) {
    state.orbitControls.object = newCam;

    // Se eri in EyeLock e orbit.target non era “coerente” con la vista,
    // riallinealo usando la distanza (continuità) mantenendo la direzione attuale.
    // NB: in Orbit normale orbit.target già era corretto e non cambia nulla.
    const fwd = new THREE.Vector3();
    newCam.getWorldDirection(fwd);
    state.orbitControls.target.copy(newCam.position).addScaledVector(fwd, distance);

    state.orbitControls.update();
  }

  // Aggiorna ctx per manager/eyelock
  if (state.ctx) state.ctx.camera = newCam;

  // Se hai EyeLock e vuoi riallineare yaw/pitch dalla nuova camera:
  // (non è indispensabile ma aiuta se usi yaw/pitch interni)
  if (state.eyeLockControls?.activate && state.ctx) {
    // Non vogliamo ri-togglarlo: facciamo solo sync “soft” se c’è un metodo
    if (typeof state.eyeLockControls._syncFromCamera === "function") {
      state.eyeLockControls._syncFromCamera(newCam);
    }
  }

  // Se hai un TransformTool che dipende dalla camera, aggiorna se previsto:
  if (state.transformTool?.setCamera) {
    state.transformTool.setCamera(newCam);
  }

  state.markDirty?.();

  // ritorna utile per debug
  return { mode: isPersp ? "ortho" : "persp", camera: newCam, target, distance };
}

export function tjsSetProjection(bodyEl, mode, STATE_KEY = "__TJS_RENDER_STATE__") {
  const state = bodyEl?.[STATE_KEY];
  if (!state?.camera) return;

  const isPersp = state.camera.isPerspectiveCamera;
  const isOrtho = state.camera.isOrthographicCamera;

  if (mode === "persp" && isPersp) return;
  if (mode === "ortho" && isOrtho) return;

  return tjsToggleProjection(bodyEl, STATE_KEY);
}

