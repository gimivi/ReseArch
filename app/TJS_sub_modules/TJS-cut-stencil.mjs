// TJS_sub_modules/TJS-cut-stencil.mjs
// Stencil-based capping strategy.
// Uses ctx.THREE only (avoid mixed imports / multi-instance THREE).
//
// Algorithm (standard geometric parity):
//   Write groups use depthTest:false → every fragment is processed regardless of the depth
//   buffer. Pure face-winding parity on the CLIPPED mesh determines stencil value:
//     BackSide:  ALL ops = IncrementWrap  (Fail / ZFail / ZPass)
//     FrontSide: ALL ops = DecrementWrap  (Fail / ZFail / ZPass)
//
//   For any ray through the scene:
//     External pixel    → equal front/back intersections → net 0 ✓
//     Cross-section     → clipping removes front faces; unpaired back faces → net ≠ 0 ✓
//     Outside mesh      → no fragments → 0 ✓
//
//   Using depthTest:true on write groups was wrong: other objects in the depth buffer can
//   change whether fragments pass/fail the depth test, corrupting parity counts and causing
//   the cap to bleed beyond the true cross-section boundary.
//
//   Cap plane: depthTest:true + polygonOffset + depthWrite:false.
//   - depthTest:true   → correct hidden-surface removal: geometry in front of the cut plane
//                        properly occludes the fill.
//   - polygonOffset    → biases cap depth toward the camera to win over near-coplanar clipped
//                        back-face depth values at the cut boundary (avoids Z-fighting).
//   - depthWrite:false → cap does not corrupt the depth buffer; correct because the fill
//                        has no 3D "thickness" and subsequent geometry should not be affected.
//   - capSolid (option "Sezione opaca", 2026-10-19): depthWrite:true and opacity 1. Transparent
//                        models are drawn AFTER the opaque cap: with depthWrite:false their faces
//                        behind the cut plane blended over the fill (section looked transparent).
//                        The depth is written only where the stencil lets the cap through, so
//                        only the section hides what lies behind it.
//   The stencil (NotEqual 0) gates the cap so the depth test is only reached at cross-section
//   pixels; with write groups using pure geometric parity, stencil≠0 only at the true section.
//   stencilRef:0 + NotEqualStencilFunc → renders only where stencil ≠ 0.
//   ALL 3 stencil ops = ReplaceStencilOp → resets stencil to 0 after cap renders.
//   onAfterRender on each cap calls clearStencil() for the next plane's write pass.
//   beforeRender() clears stencil at frame start.
//
// renderOrder strategy:
//   stencil write group for plane i → (i+1)*10
//   cap mesh for plane i           → (i+1)*10 + 5
//   This guarantees write-before-read within each plane's pass.
//
// ─────────────────────────────────────────────────────────────────────────────
// DEBUG MODE  (set via strategy.setDebug(step))
//
//   null / 0  → normal operation
//
//   1  "check-stencil-buffer"
//      Logs to console: renderer stencil bits, localClippingEnabled, target mesh count.
//      No visual change. Check the console after switching to stencil mode.
//
//   2  "cap-always"
//      Cap renders unconditionally (AlwaysStencilFunc, no depth test).
//      → If a red plane appears at the correct cut position: cap geometry/placement is OK.
//      → If nothing appears or it's in the wrong place: fix cap position first.
//
//   3  "show-write-groups"
//      Stencil write groups become visible: back faces = blue, front faces = green.
//      → Verify the write groups are correctly aligned with the target mesh.
//
//   4  "cap-depth-only"
//      Cap renders without stencil test but WITH depth test.
//      → Should show only the pixels where the cap plane is in front of
//        any previous geometry (i.e., the cut cross-section area, if depth is correct).
//
// ─────────────────────────────────────────────────────────────────────────────

function createPlaneStencilGroup(THREE, geometry, plane, debugViz) {
  const AlwaysStencilFunc      = THREE.AlwaysStencilFunc      ?? 519;
  const IncrementWrapStencilOp = THREE.IncrementWrapStencilOp ?? 34055;
  const DecrementWrapStencilOp = THREE.DecrementWrapStencilOp ?? 34056;

  const group = new THREE.Group();

  const baseMat = new THREE.MeshBasicMaterial({
    depthWrite: false,
    depthTest: false,   // pure geometric parity — ignore depth buffer entirely
    colorWrite: !!debugViz,
    stencilWrite: !debugViz,
    stencilFunc: AlwaysStencilFunc,
  });

  const matBack = baseMat.clone();
  matBack.side = THREE.BackSide;
  matBack.clippingPlanes = [plane];
  if (debugViz) {
    matBack.color = new THREE.Color(0x0000ff); // blue = back faces
    matBack.transparent = true;
    matBack.opacity = 0.5;
  } else {
    // All three ops identical: depthTest is off so ZFail never fires, but set consistently.
    matBack.stencilFail  = IncrementWrapStencilOp;
    matBack.stencilZFail = IncrementWrapStencilOp;
    matBack.stencilZPass = IncrementWrapStencilOp;
  }
  group.add(new THREE.Mesh(geometry, matBack));

  const matFront = baseMat.clone();
  matFront.side = THREE.FrontSide;
  matFront.clippingPlanes = [plane];
  if (debugViz) {
    matFront.color = new THREE.Color(0x00ff00); // green = front faces
    matFront.transparent = true;
    matFront.opacity = 0.5;
  } else {
    // All three ops identical.
    matFront.stencilFail  = DecrementWrapStencilOp;
    matFront.stencilZFail = DecrementWrapStencilOp;
    matFront.stencilZPass = DecrementWrapStencilOp;
  }
  group.add(new THREE.Mesh(geometry, matFront));

  return group;
}

export function createStencilStrategy({ capColor = 0xE74C3C, capOpacity = 1.0, capSolid = false, planeSize = 10000 } = {}) {
  const state = {
    root: null,
    capMeshes: [],
    stencilGroups: [],
    capColorHex: capColor,
    capOpacity: Math.max(0, Math.min(1, capOpacity)),
    capSolid: !!capSolid,
    planeSize,
    debugStep: 0,    // 0=normal, 1=log, 2=cap-always, 3=show-write, 4=cap-depth-only
  };

  // Opacità effettiva del cap: con "Sezione opaca" sempre 1.
  function capAlpha() { return state.capSolid ? 1 : state.capOpacity; }

  // Applica opacità / scrittura della profondità a un materiale di cap.
  function applyCapLook(mat) {
    const op = capAlpha();
    mat.opacity     = op;
    mat.transparent = op < 1;
    mat.depthWrite  = state.capSolid;
    mat.needsUpdate = true;
  }

  function disposeMesh(mesh) {
    if (!mesh) return;
    if (mesh.geometry && mesh.geometry.dispose) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.());
    else mat?.dispose?.();
  }

  function clearAll(scene) {
    if (state.root && scene) scene.remove(state.root);
    state.root = null;

    // dispose stencil write materials (geometry belongs to target mesh — do NOT dispose it)
    for (const g of state.stencilGroups) {
      g.traverse?.((o) => {
        if (o?.isMesh) {
          const mat = o.material;
          if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.());
          else mat?.dispose?.();
        }
      });
    }
    state.stencilGroups = [];

    for (const cap of state.capMeshes) disposeMesh(cap);
    state.capMeshes = [];
  }

  return {
    name: "stencil",

    // ── DEBUG CONTROL ──────────────────────────────────────────────
    setDebug(step, ctx) {
      const prev = state.debugStep;
      state.debugStep = Number(step) || 0;

      // Step 1: log stencil-buffer info
      if (state.debugStep === 1 && ctx) {
        const { renderer, targetMeshes, activePlanes } = ctx;
        const gl = renderer?.getContext?.();
        const stencilBits = gl ? gl.getParameter(gl.STENCIL_BITS) : "N/A";
        console.group("[TJS-stencil] DEBUG step 1 — environment check");
        console.log("stencil bits in GL context:", stencilBits,
          stencilBits > 0 ? "✅ stencil buffer exists" : "❌ NO stencil buffer!");
        console.log("renderer.localClippingEnabled:", renderer?.localClippingEnabled);
        console.log("targetMeshes count:", targetMeshes?.length);
        console.log("activePlanes count:", activePlanes?.length);
        activePlanes?.forEach((p, i) => {
          console.log(`  plane[${i}] normal:`, p.normal, "constant:", p.constant);
        });
        console.groupEnd();
      }

      if (prev !== state.debugStep) {
        console.log(`[TJS-stencil] debug step → ${state.debugStep}`);
      }
    },

    apply(ctx) {
      const { THREE, scene, targetMeshes, activePlanes, planeWorldPos, planeWorldQuat, renderer } = ctx;
      clearAll(scene);

      if (!activePlanes?.length || !targetMeshes?.length) return;

      // Step 1: log-only (no visual change)
      if (state.debugStep === 1) {
        this.setDebug(1, ctx);
      }

      const dbg    = state.debugStep;
      const showWriteGroups = (dbg === 3);
      const capAlways       = (dbg === 2);
      const capDepthOnly    = (dbg === 4);

      const AlwaysStencilFunc  = THREE.AlwaysStencilFunc  ?? 519;
      const ReplaceStencilOp   = THREE.ReplaceStencilOp   ?? 7681;
      const NotEqualStencilFunc = THREE.NotEqualStencilFunc ?? 517;

      const root = new THREE.Group();
      root.name = "TJS_CUT_STENCIL_ROOT";
      state.root = root;

      activePlanes.forEach((plane, i) => {
        const groupRenderOrder = (i + 1) * 10;
        const capRenderOrder   = (i + 1) * 10 + 5;

        // --- stencil write pass ---
        for (const m of targetMeshes) {
          if (!m?.geometry) continue;

          const g = createPlaneStencilGroup(THREE, m.geometry, plane, showWriteGroups);
          g.name = `TJS_STENCIL_GROUP_${i}`;

          // Use matrixWorld so nested meshes align correctly (g is direct child of root → scene)
          m.updateWorldMatrix(true, false);
          g.matrixAutoUpdate = false;
          g.matrix.copy(m.matrixWorld);
          g.updateMatrixWorld(true);

          // Apply renderOrder to each write mesh
          g.traverse((o) => { if (o.isMesh) o.renderOrder = groupRenderOrder; });

          state.stencilGroups.push(g);
          root.add(g);
        }

        // --- cap pass ---
        const capGeo = new THREE.PlaneGeometry(state.planeSize, state.planeSize);
        const capMat = new THREE.MeshBasicMaterial({
          color:       state.capColorHex,
          side:        THREE.DoubleSide,
        });
        applyCapLook(capMat);

        if (capAlways) {
          // Debug 2: render cap unconditionally — verify cap position/orientation
          capMat.depthTest    = false;
          capMat.stencilWrite = false;
        } else if (capDepthOnly) {
          // Debug 4: cap uses depth test but no stencil test
          capMat.depthTest    = true;
          capMat.stencilWrite = false;
          capMat.stencilFunc  = AlwaysStencilFunc;
        } else {
          // Normal: depthTest:true for correct hidden-surface removal (geometry in front of
          // the cut plane occludes the fill as expected). polygonOffset biases the cap slightly
          // toward the camera to avoid Z-fighting against near-coplanar clipped back-face
          // fragments at the cut boundary. depthWrite:false so the cap does not affect the
          // depth buffer for subsequent passes.
          capMat.depthTest            = true;
          capMat.polygonOffset        = true;
          capMat.polygonOffsetFactor  = -1;
          capMat.polygonOffsetUnits   = -4;
          capMat.stencilWrite = true;
          capMat.stencilRef   = 0;
          capMat.stencilFunc  = NotEqualStencilFunc;
          capMat.stencilFail  = ReplaceStencilOp;
          capMat.stencilZFail = ReplaceStencilOp;
          capMat.stencilZPass = ReplaceStencilOp;
        }

        // Clip cap by all planes EXCEPT its own:
        // the cap sits exactly on plane[i], so clipping by plane[i] itself causes
        // floating-point indetermination at the boundary → flickering.
        capMat.clippingPlanes = activePlanes.filter((_, j) => j !== i);

        const capMesh = new THREE.Mesh(capGeo, capMat);
        capMesh.name = `TJS_CAP_${i}`;
        capMesh.position.copy(planeWorldPos[i]);
        capMesh.quaternion.copy(planeWorldQuat[i]);
        capMesh.renderOrder = capRenderOrder;

        // Clear stencil AFTER cap renders so the next plane's write pass starts clean
        if (!capAlways && !capDepthOnly) {
          capMesh.onAfterRender = function(r) {
            try { r.clearStencil?.(); } catch {}
          };
        }

        state.capMeshes.push(capMesh);
        root.add(capMesh);
      });

      scene.add(root);
    },

    clear(ctx) {
      clearAll(ctx.scene);
    },

    beforeRender(renderer) {
      // Clear stencil at frame start (before plane 0's write pass)
      try { renderer.clearStencil?.(); } catch {}
    },

    // Riposiziona i cap sui piani attivi (stesso ordine di apply): chiamata a ogni frame,
    // così il riempimento segue il piano mentre lo si trascina (prima restava dov'era creato).
    syncCaps(planeWorldPos, planeWorldQuat) {
      state.capMeshes.forEach((cap, i) => {
        if (!cap || !planeWorldPos?.[i] || !planeWorldQuat?.[i]) return;
        cap.position.copy(planeWorldPos[i]);
        cap.quaternion.copy(planeWorldQuat[i]);
      });
    },

    setCapColor(hex) {
      state.capColorHex = hex;
      for (const cap of state.capMeshes) {
        const mat = cap?.material;
        if (!mat) continue;
        if (mat.color?.set) mat.color.set(hex);
        mat.needsUpdate = true;
      }
    },

    setCapOpacity(v) {
      state.capOpacity = Math.max(0, Math.min(1, Number(v) || 0));
      for (const cap of state.capMeshes) if (cap?.material) applyCapLook(cap.material);
    },

    // "Sezione opaca": il riempimento resta pieno anche sui materiali trasparenti.
    setCapSolid(on) {
      state.capSolid = !!on;
      for (const cap of state.capMeshes) if (cap?.material) applyCapLook(cap.material);
    },

    setPlaneSize(sz) {
      const v = Number(sz);
      if (Number.isFinite(v) && v > 0) state.planeSize = v;
    },
  };
}
