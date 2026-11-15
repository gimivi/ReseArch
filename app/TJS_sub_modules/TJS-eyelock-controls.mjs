// TJS-eyelock-controls.mjs
import * as THREE from "three";
import { clamp, yawPitchFromCamera, applyYawPitchLookAt, applyFovZoom } from "./TJS-camera-utils.mjs";

/**
 * EyeLockControls
 * - camera ferma (non trasla)
 * - LMB drag: look (yaw/pitch)
 * - Alt+LMB drag: look fine + NO damping
 * - Wheel: zoom ottico via FOV
 * - Space: toggle mirino (ctx.setReticle(boolean))
 * - Shift+LMB click (mirino ON): pick dal centro (ctx.onPick(hit))
 */
export class EyeLockControls {
  constructor(domElement) {
    this.domElement = domElement;

    this.enabled = false;

    // Look state
    this.yaw = 0;
    this.pitch = 0;

    this.baseSensitivity = 0.002; // rad/px
    this.fineFactor = 0.2;        // Alt => più lento
    this.minPitch = -Math.PI / 2 + 0.01;
    this.maxPitch =  Math.PI / 2 - 0.01;

    // Damping (solo in modalità normale, non fine)
    this.enableDamping = true;
    this.dampingFactor = 0.12; // 0..1
    this._lookVelYaw = 0;      // “velocità” smorzata
    this._lookVelPitch = 0;

    // LookAt radius (solo per costruire target; non muove camera)
    this.lookRadius = 10;

    // Reticle / picking
    this.reticleEnabled = false;
    this.pickOnShiftClick = true;

    // FOV zoom
    this.minFov = 20;
    this.maxFov = 90;
    this.zoomSpeed = 0.05;
    this.fineZoomFactor = 0.25;

    // Arrow key fine look
    this.arrowStep = 0.003; // rad per keydown event (~0.17°)

    // Dragging tracking
    this._dragging = false;
    this._dragMoved = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._lastX = 0;
    this._lastY = 0;
    this._clickMoveThreshold = 3; // px: sotto è click, sopra è drag

    // Reuse objects
    this._ndcCenter = new THREE.Vector2(0, 0);

    // Segnala a update() che c'è stato un evento che richiede render
    // (wheel FOV, drag diretto, arrow key) — non passa per la velocity
    this._needsRender = false;
  }

  activate(ctx) {
    this.enabled = true;
    this.syncFromCamera(ctx.camera);
    ctx.setReticle?.(this.reticleEnabled);
  }


  deactivate(ctx) {
    this.enabled = false;
    this._dragging = false;
    this._dragMoved = false;
  }

  update(dt, ctx) {
    if (!this.enabled) return false;

    let moved = false;

    // Consuma il flag _needsRender (wheel FOV, drag diretto, arrow key)
    if (this._needsRender) {
      moved = true;
      this._needsRender = false;
    }

    // Applica damping se attivo e non stai in “fine” (fine gestito in handleEvent)
    if (this.enableDamping) {
      const k = clamp(this.dampingFactor, 0, 1);

      if (this._lookVelYaw !== 0 || this._lookVelPitch !== 0) {
        this.yaw   += this._lookVelYaw;
        this.pitch  = clamp(this.pitch + this._lookVelPitch, this.minPitch, this.maxPitch);

        this._lookVelYaw   *= (1 - k);
        this._lookVelPitch *= (1 - k);

        // azzera velocità trascurabile per fermare il damping
        if (Math.abs(this._lookVelYaw)   < 1e-5) this._lookVelYaw   = 0;
        if (Math.abs(this._lookVelPitch)  < 1e-5) this._lookVelPitch = 0;

        moved = true;
      }
    }

    // Applica orientamento solo se qualcosa è cambiato
    if (moved) {
      applyYawPitchLookAt(ctx.camera, this.yaw, this.pitch, this.lookRadius, this._tmp || (this._tmp = {}));
    }

    return moved;
  }

  handleEvent(e, ctx) {
    if (!this.enabled) return;

    // Evita selezioni testo / drag immagini
    if (e.type === "dragstart") {
      e.preventDefault();
      return;
    }

    if (e.type === "keydown") {
      if (e.code === "Space") {
        // toggle mirino (DOM only, no Three.js render needed)
        this.reticleEnabled = !this.reticleEnabled;
        ctx.setReticle?.(this.reticleEnabled);
        e.preventDefault();
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight" ||
                 e.code === "ArrowUp"   || e.code === "ArrowDown") {
        const step = this.arrowStep;
        if (e.code === "ArrowRight") this.yaw   -= step;
        if (e.code === "ArrowLeft")  this.yaw   += step;
        if (e.code === "ArrowUp")    this.pitch  = clamp(this.pitch + step, this.minPitch, this.maxPitch);
        if (e.code === "ArrowDown")  this.pitch  = clamp(this.pitch - step, this.minPitch, this.maxPitch);
        this._lookVelYaw   = 0;
        this._lookVelPitch = 0;
        this._needsRender  = true;
        e.preventDefault();
      }
      return;
    }

    if (e.type === "wheel") {
      // zoom FOV (camera ferma)
      const fineMode = !!e.altKey;
      const changed = applyFovZoom(ctx.camera, e.deltaY, {
        zoomSpeed: this.zoomSpeed,
        minFov: this.minFov,
        maxFov: this.maxFov,
        fineFactor: this.fineZoomFactor,
        fineMode,
      });

      if (changed) { this._needsRender = true; e.preventDefault(); }
      return;
    }

    if (e.type === "pointerdown") {
      if (e.button !== 0) return; // solo LMB

      this._dragging = true;
      this._dragMoved = false;
      this._dragStartX = this._lastX = e.clientX;
      this._dragStartY = this._lastY = e.clientY;

      // cattura il puntatore per continuare a ricevere move
      this.domElement?.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }

    if (e.type === "pointermove") {
      if (!this._dragging) return;

      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;

      const distFromStart = Math.max(
        Math.abs(e.clientX - this._dragStartX),
        Math.abs(e.clientY - this._dragStartY),
      );
      if (distFromStart >= this._clickMoveThreshold) this._dragMoved = true;

      const fineMode = !!e.altKey;
      const sens = this.baseSensitivity * (fineMode ? this.fineFactor : 1);

      // Aggiornamento look:
      // - fineMode: applica subito yaw/pitch (NO damping)
      // - normal: accumula su “velocità” smorzata (se damping attivo) o applica subito se damping off
      const dyaw = -dx * sens;
      const dpitch = -dy * sens;

      if (fineMode) {
        // niente damping in fine: aggiornamento diretto → serve render immediato
        this.yaw += dyaw;
        this.pitch = clamp(this.pitch + dpitch, this.minPitch, this.maxPitch);
        this._lookVelYaw   = 0;
        this._lookVelPitch = 0;
        this._needsRender  = true;
      } else if (this.enableDamping) {
        // accumula “velocità” (poi update() smorza e restituisce true)
        this._lookVelYaw   += dyaw;
        this._lookVelPitch += dpitch;
      } else {
        // damping off: aggiornamento diretto → serve render immediato
        this.yaw += dyaw;
        this.pitch = clamp(this.pitch + dpitch, this.minPitch, this.maxPitch);
        this._needsRender = true;
      }

      e.preventDefault();
      return;
    }

    if (e.type === "pointerup" || e.type === "pointercancel") {
      if (e.button !== 0) return;

      // rilascio capture
      try { this.domElement?.releasePointerCapture?.(e.pointerId); } catch {}

      const wasDragging = this._dragging;
      const moved = this._dragMoved;

      this._dragging = false;
      this._dragMoved = false;

      // Click “vero” = non ha mosso (sotto soglia)
      const isClick = wasDragging && !moved;

      if (isClick && this.reticleEnabled && this.pickOnShiftClick && e.shiftKey) {
        const hit = this._pickCenter(ctx);
        ctx.onPick?.(hit);
        e.preventDefault();
      }

      return;
    }
  }

  _pickCenter(ctx) {
    const raycaster = ctx.raycaster || (ctx.raycaster = new THREE.Raycaster());
    // Threshold generoso per point cloud — non influisce su Mesh/Line.
    // Necessario perché il threshold default di Three.js (0.1) è spesso
    // troppo piccolo rispetto alla spaziatura dei punti in world-space.
    raycaster.params.Points.threshold = 0.5;
    raycaster.setFromCamera(this._ndcCenter, ctx.camera);

    const objs = ctx.pickables || ctx.scene?.children || [];
    // ctx.hitFilter (opzionale): scarta intersezioni non valide (es. parti tolte dal taglio)
    const hits = raycaster.intersectObjects(objs, true).filter((h) => !ctx.hitFilter || ctx.hitFilter(h));
    if (!hits.length) return null;

    // Three.js ordina gli hit di THREE.Points per distanza dalla CAMERA,
    // non per distanza perpendicolare dalla retta del raggio.
    // Conseguenza: con threshold=0.5 un punto "laterale" ma più vicino alla
    // camera viene preferito rispetto al punto effettivamente sotto il mirino.
    // Fix: tra tutti i Points hit, scegliamo quello con distanza minima
    // dalla RETTA del raggio (ray.distanceSqToPoint sul vertice reale).
    // Gli hit Mesh/Line non hanno questo problema e usano hits[0] direttamente.
    let h = hits[0];
    if (h.object?.isPoints) {
      const ray = raycaster.ray;
      let bestDistSq = Infinity;
      for (const hit of hits) {
        if (!hit.object?.isPoints) break;   // fine dei Points hit (Mesh/Line dopo)
        const positions = hit.object.geometry?.attributes?.position;
        if (!positions || hit.index == null) continue;
        const v = new THREE.Vector3().fromBufferAttribute(positions, hit.index);
        v.applyMatrix4(hit.object.matrixWorld);
        const dSq = ray.distanceSqToPoint(v);
        if (dSq < bestDistSq) { bestDistSq = dSq; h = hit; }
      }
    }

    return {
      point:    h.point.clone(),
      object:   h.object,
      distance: h.distance,
      face:     h.face  || null,
      faceIndex: h.faceIndex ?? null,   // indice del triangolo colpito (Mesh)
      uv:       h.uv  ?? null,          // coordinate di mappa (Mesh con attributo uv)
      uv1:      h.uv1 ?? null,          // secondo canale UV, se presente
      index:    h.index ?? null,   // indice vertice (necessario per _correctHitPoint)
    };
  }

  /** Riallinea yaw/pitch alla camera corrente, senza side-effect UI */
  syncFromCamera(camera) {
    if (!camera) return;
    const yp = yawPitchFromCamera(camera);
    this.yaw = yp.yaw;
    this.pitch = clamp(yp.pitch, this.minPitch, this.maxPitch);
    this._lookVelYaw = 0;
    this._lookVelPitch = 0;
  }

}
