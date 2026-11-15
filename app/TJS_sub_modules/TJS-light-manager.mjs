// TJS-light-manager.mjs
// Pannello gestione luci della scena TJS.
//
// Luci PREESISTENTI (isPreExisting=true):
//   – trovate nella scena al momento dell'inizializzazione
//   – modificabili in memoria (colore, intensità, proprietà)
//   – non cancellabili, modifiche non salvabili (icona 🔒)
//
// Luci CREATE (isPreExisting=false):
//   – create dall'utente tramite pannello, CON handle 3D sotto lightsRoot
//     (TJS_LIGHTS_ROOT, separato da modelsRoot), selezionabili cliccandole
//     (additionalPickRoots) o via bottone → nel pannello
//   – oppure ADOTTATE (vedi adopt(), 2026-09-22) da un nodo FLE
//     TJS/Light/Set* (TJS-flow-nodes.mjs) — SENZA handle 3D (la luce vive
//     dove l'ha messa _resolveLightParent: TJS_LIGHTS_ROOT di default,
//     scena radice, o un percorso esplicito) ma comunque tracciate/visibili
//     nel pannello (visibilità, colore, dettagli, elimina)
//   – in entrambi i casi: associabili a un modello (mod_id), salvabili in
//     mod_spec.lights[] SOLO su azione esplicita (mai in automatico alla
//     creazione — vedi TJS/Light/Save)
//   – cancellabili
//
// Gli handle 3D (mesh visive, solo per le luci create dal pannello) sono
// visibili SOLO quando il pannello è aperto. Le luci stesse rimangono
// sempre attive (illuminano la scena) indipendentemente dal pannello.
//
// Il pannello viene montato nel containerEl condiviso (right-panel container).
//
// Dal 2026-10-18 (TJS-lighting-utils.mjs):
//   – luci nuove posizionate sopra un angolo del modello, Point/Spot con intensità fisica
//     ≈ distanza² (prima 1 candela a (0,5,0): quasi invisibili), Directional/Spot con il
//     bersaglio al centro del modello (prima sempre all'origine) e "Punta sulla selezione"
//   – ombre: accenderle accende proietta/riceve sui modelli se nessuno proietta; l'area
//     dell'ombra e i bias si adattano al modello ("Adatta al modello", automatico di default
//     anche quando si sposta la luce, shadowAutoFit nel mod_spec)
//   – linee guida della direzione (DirectionalLightHelper / SpotLightHelper) a finestra aperta
//   – la luce di base (TJS_BASE_AMBIENT / TJS_BASE_SUN) si regola nella finestra Ambiente e
//     non compare qui

import { t, te } from '../shared/i18n.mjs';
import { panelLevel } from '../shared/ui_level.mjs';
import { tjsModelsBox, tjsFitShadow, tjsEnsureShadowCasters, tjsDefaultLightPlacement } from './TJS-lighting-utils.mjs';

// label: getter tradotto (_doc/arch-i18n-a11y.md §2). È anche il nome predefinito di una luce
// nuova: una volta creata, il nome è un dato (salvato in mod_spec.lights[].name).
const LIGHT_DEFS = [
  { type: 'Ambient',     get label() { return t('app.tjs.light.type.ambient'); },     icon: 'bi-brightness-alt-high', color: '#ffff99' },
  { type: 'Hemisphere',  get label() { return t('app.tjs.light.type.hemisphere'); },  icon: 'bi-circle-half',         color: '#99ccff' },
  { type: 'Directional', get label() { return t('app.tjs.light.type.directional'); }, icon: 'bi-sun',                 color: '#ffffcc' },
  { type: 'Point',       get label() { return t('app.tjs.light.type.point'); },       icon: 'bi-circle-fill',         color: '#ffdd44' },
  { type: 'Spot',        get label() { return t('app.tjs.light.type.spot'); },        icon: 'bi-lightbulb-fill',      color: '#ff9944' },
];

// Livello di interazione (§5): i salvataggi in mod_spec solo da autore (30) in su
const _canSave = (el) => panelLevel(el) >= 30;   // livello del pannello (_doc/arch-permessi.md §11.4)

const HANDLE_COLORS = {
  Directional: 0xffffaa,
  Point:       0xffdd44,
  Spot:        0xff8822,
};

// ─────────────────────────────────────────────────────────────────────────────

export function tjsCreateLightManager({
  THREE,
  scene,
  lightsRoot,    // THREE.Group "TJS_LIGHTS_ROOT" (fratello di modelsRoot)
  models,
  bodyEl,
  containerEl,   // div flex-colonna condiviso con sceneTree (right-panel)
  modelsRoot = null,   // TJS_MODELS_ROOT: box del modello per posizioni, bersagli e ombre
  transformTool,
  cmdUI,
  signal,
  markDirty = () => {},
}) {
  const mountTarget = containerEl ?? bodyEl;

  let panelEl    = null;
  let visible    = false;
  let handleScale = 1.0;   // fattore di scala visuale degli handle

  /** @type {Array<{id,name,type,isPreExisting,modelId,light,handle,helperMesh}>} */
  const lights = [];

  // Geometrie handle (lazy, condivise)
  const _geoCache = {};

  // ── Geometrie handle ────────────────────────────────────────────────────────

  function _handleGeo(type) {
    if (!_geoCache[type]) {
      if (type === 'Point') {
        _geoCache[type] = new THREE.IcosahedronGeometry(0.22, 1);
      } else if (type === 'Spot') {
        _geoCache[type] = new THREE.ConeGeometry(0.15, 0.45, 8);
      } else {
        _geoCache[type] = new THREE.OctahedronGeometry(0.22);
      }
    }
    return _geoCache[type];
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function _init() {
    // 1. Luci preesistenti già nella scena
    scene.traverse(obj => {
      if (!obj.isLight) return;
      if (obj.name?.startsWith('TJS_BASE_')) return;   // luce di base: finestra Ambiente
      if (lights.some(n => n.light === obj)) return;
      lights.push({
        id:            obj.uuid,
        name:          obj.name || (_defFor(obj)?.label ?? t('app.tjs.light.default_name')),
        type:          _detectType(obj),
        isPreExisting: true,
        modelId:       null,
        light:         obj,
        handle:        null,
        helperMesh:    null,
      });
    });

    // 2. Ricarica luci salvate in mod_spec di ogni modello
    const modArr = Array.isArray(models) ? models : [];
    for (const row of modArr) {
      const spec = _parseSpec(row?.mod_spec);
      if (!Array.isArray(spec?.lights)) continue;
      for (const ld of spec.lights) _recreateFromSpec(ld, row.mod_id);
    }
  }

  function _parseSpec(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function _detectType(light) {
    if (light.isAmbientLight)     return 'Ambient';
    if (light.isHemisphereLight)  return 'Hemisphere';
    if (light.isDirectionalLight) return 'Directional';
    if (light.isPointLight)       return 'Point';
    if (light.isSpotLight)        return 'Spot';
    return 'Unknown';
  }

  function _defFor(light) {
    return LIGHT_DEFS.find(d => d.type === _detectType(light)) ?? null;
  }

  // ── Creazione luci ──────────────────────────────────────────────────────────

  function _buildLight(type) {
    switch (type) {
      case 'Ambient':     return new THREE.AmbientLight(0xffffff, 1.0);
      case 'Hemisphere':  return new THREE.HemisphereLight(0x87ceeb, 0x8b4513, 1.0);
      case 'Directional': { const l = new THREE.DirectionalLight(0xffffff, 1.0); l.castShadow = false; return l; }
      case 'Point':       return new THREE.PointLight(0xffffff, 1.0, 0, 2);
      case 'Spot':        { const l = new THREE.SpotLight(0xffffff, 1.0, 0, Math.PI / 4, 0.1); l.castShadow = false; return l; }
      default: throw new Error(`[TJS-light-manager] tipo non supportato: ${type}`);
    }
  }

  function _buildHandle(light, type) {
    if (type === 'Ambient' || type === 'Hemisphere') return null;

    const geo  = _handleGeo(type);
    const mat  = new THREE.MeshBasicMaterial({
      color:       HANDLE_COLORS[type] ?? 0xffffff,
      depthTest:   false,
      transparent: true,
      opacity:     0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 999;
    mesh.name        = `TJS_LIGHT_MESH_${light.uuid}`;
    mesh.visible     = false;            // visibile SOLO con pannello aperto
    mesh.scale.setScalar(handleScale);

    const group = new THREE.Group();
    group.name  = `TJS_LIGHT_HANDLE_${light.uuid}`;
    group.userData.__tjs_selectable__ = true;
    group.userData.__tjs_light__      = true;

    group.add(light);   // luce figlia → si sposta con l'handle
    group.add(mesh);

    if ((type === 'Directional' || type === 'Spot') && light.target) {
      scene.add(light.target);
    }

    return { group, helperMesh: mesh };
  }

  function _genId() {
    return 'lgt_' + Math.random().toString(36).slice(2, 10);
  }

  // API: aggiunge una luce creata dall'utente
  function addLight(type, modelId, pos = null) {
    const light = _buildLight(type);
    const id    = _genId();
    light.name  = `TJS_LGT_${id}`;

    // posizione, bersaglio e intensità sulla box dei modelli (TJS-lighting-utils)
    const place        = tjsDefaultLightPlacement(type, _box());
    const defaultPos   = pos ?? place.position;
    if (place.intensity != null) light.intensity = place.intensity;
    const handleResult = _buildHandle(light, type);
    if (light.target) light.target.position.copy(place.target);

    let handle = null, helperMesh = null;
    if (handleResult) {
      ({ group: handle, helperMesh } = handleResult);
      handle.position.set(defaultPos.x, defaultPos.y, defaultPos.z);
      // handle visibile se pannello aperto
      helperMesh.visible = visible;
      lightsRoot.add(handle);
    } else {
      scene.add(light);
    }

    const node = { id, name: LIGHT_DEFS.find(d => d.type === type)?.label ?? type,
      type, isPreExisting: false, modelId: modelId ?? null, light, handle, helperMesh, shadowAutoFit: true };
    lights.push(node);
    _attachGuide(node);
    _renderPanel();
    markDirty();
    return node;
  }

  function _recreateFromSpec(ld, modelId) {
    if (!ld?.type || !ld?.id) return;
    if (lights.some(n => n.id === ld.id)) return;

    const light = _buildLight(ld.type);
    light.name  = `TJS_LGT_${ld.id}`;

    if (ld.color)    light.color?.set(ld.color);
    if (typeof ld.intensity  === 'number') light.intensity  = ld.intensity;
    if (ld.type === 'Hemisphere' && ld.groundColor) light.groundColor?.set(ld.groundColor);
    if (typeof ld.distance   === 'number') light.distance   = ld.distance;
    if (typeof ld.decay      === 'number') light.decay      = ld.decay;
    if (typeof ld.angle      === 'number') light.angle      = ld.angle;
    if (typeof ld.penumbra   === 'number') light.penumbra   = ld.penumbra;
    if (typeof ld.castShadow === 'boolean') light.castShadow = ld.castShadow;
    if (typeof ld.shadowMapSize    === 'number') light.shadow.mapSize.setScalar(ld.shadowMapSize);
    if (typeof ld.shadowBias       === 'number') light.shadow.bias       = ld.shadowBias;
    if (typeof ld.shadowNormalBias === 'number') light.shadow.normalBias = ld.shadowNormalBias;
    if (typeof ld.shadowRadius     === 'number') light.shadow.radius     = ld.shadowRadius;
    if (typeof ld.shadowIntensity  === 'number' && 'intensity' in light.shadow) light.shadow.intensity = ld.shadowIntensity;
    if (ld.shadowFrustum) {
      const sf = ld.shadowFrustum;
      if (typeof sf.near   === 'number') light.shadow.camera.near   = sf.near;
      if (typeof sf.far    === 'number') light.shadow.camera.far    = sf.far;
      if (typeof sf.left   === 'number') light.shadow.camera.left   = sf.left;
      if (typeof sf.right  === 'number') light.shadow.camera.right  = sf.right;
      if (typeof sf.top    === 'number') light.shadow.camera.top    = sf.top;
      if (typeof sf.bottom === 'number') light.shadow.camera.bottom = sf.bottom;
      light.shadow.camera.updateProjectionMatrix();
    }

    const pos          = ld.position ?? { x: 0, y: 5, z: 0 };
    const handleResult = _buildHandle(light, ld.type);

    let handle = null, helperMesh = null;
    if (handleResult) {
      ({ group: handle, helperMesh } = handleResult);
      handle.position.set(pos.x, pos.y, pos.z);
      helperMesh.visible = false;   // nascosto finché il pannello non viene aperto
      lightsRoot.add(handle);
    } else {
      scene.add(light);
    }
    if (light.target) {
      const tg = ld.target ?? tjsDefaultLightPlacement(ld.type, _box()).target;
      light.target.position.set(tg.x, tg.y, tg.z);
    }

    const node = { id: ld.id, name: ld.name ?? (LIGHT_DEFS.find(d => d.type === ld.type)?.label ?? ld.type),
      type: ld.type, isPreExisting: false, modelId: modelId ?? null, light, handle, helperMesh,
      shadowAutoFit: ld.shadowAutoFit !== false };
    lights.push(node);
    _attachGuide(node);
    // luce salvata con l'ombra: oggetti che proiettano (se nessuno lo fa) e area adattata
    if (light.castShadow) {
      if (modelsRoot) tjsEnsureShadowCasters(modelsRoot);
      if (node.shadowAutoFit) { light.updateMatrixWorld(true); tjsFitShadow(light, _box()); }
    }
  }

  // ── Box del modello, ombre adattate, linee guida (2026-10-18) ───────────────

  function _box() {
    return modelsRoot ? tjsModelsBox(modelsRoot) : new THREE.Box3();
  }

  function _fitNode(node) {
    if (!node?.light?.castShadow) return false;
    const done = tjsFitShadow(node.light, _box());
    if (done) markDirty();
    return done;
  }

  // Linea guida della direzione (Directional/Spot con handle): visibile solo a finestra aperta
  function _attachGuide(node) {
    if (!node.handle || !node.light.target) return;
    node.guide = node.type === 'Spot'
      ? new THREE.SpotLightHelper(node.light, HANDLE_COLORS.Spot)
      : new THREE.DirectionalLightHelper(node.light, 0.5 * handleScale, HANDLE_COLORS.Directional);
    node.guide.name = `TJS_LIGHT_GUIDE_${node.id}`;
    node.guide.visible = visible;
    scene.add(node.guide);
    node.light.updateMatrixWorld(true);
    node.guide.update();
  }

  function _disposeGuide(node) {
    if (!node.guide) return;
    node.guide.removeFromParent();
    node.guide.dispose?.();
    node.guide = null;
  }

  /** Bersaglio di Directional/Spot sul centro della selezione (o del modello) + ombra riadattata. */
  function pointAtSelection(id) {
    const node = lights.find(n => n.id === id);
    if (!node?.light?.target) return;
    const sel = (transformTool?.selection ?? []).filter(o => o && o !== node.handle);
    const box = new THREE.Box3();
    for (const o of sel) box.expandByObject(o);
    const c = (box.isEmpty() ? _box() : box).getCenter(new THREE.Vector3());
    node.light.target.position.copy(c);
    node.light.target.updateMatrixWorld(true);
    if (node.shadowAutoFit !== false) _fitNode(node);
    node.guide?.update();
    markDirty();
  }

  /**
   * Da chiamare quando qualcosa si è mosso (gizmo, valori): linee guida aggiornate e,
   * per le luci con adattamento automatico, area dell'ombra ricalcolata.
   */
  function onSceneTransformed() {
    let box = null;
    for (const node of lights) {
      node.light.updateMatrixWorld(true);
      node.guide?.update();
      if (node.light.castShadow && node.shadowAutoFit !== false && node.light.shadow) {
        box ??= _box();
        tjsFitShadow(node.light, box);
      }
    }
  }

  // API: rimuove una luce creata
  function removeLight(id) {
    const idx = lights.findIndex(n => n.id === id);
    if (idx < 0) return;
    const node = lights[idx];
    if (node.isPreExisting) return;
    _disposeGuide(node);

    if (node.handle) {
      lightsRoot.remove(node.handle);
      node.helperMesh?.material?.dispose?.();
      if (node.light.target) scene.remove(node.light.target);
    } else {
      // removeFromParent() invece di scene.remove(): una luce adottata
      // (vedi adopt()) può vivere sotto TJS_LIGHTS_ROOT o un percorso
      // qualunque scelto dal nodo FLE che l'ha creata, non necessariamente
      // figlia diretta di 'scene' — scene.remove() su un nipote è un no-op
      // silenzioso.
      node.light.removeFromParent?.();
      if (node.light.target) node.light.target.removeFromParent?.();
    }
    lights.splice(idx, 1);
    _renderPanel();
  }

  // API: adotta nel tracking del pannello una luce creata altrove (nodi FLE
  // TJS/Light/Set* — vedi TJS-flow-nodes.mjs, _resolveLightParent/
  // _findOrCreateLight). Rende la luce visibile/gestibile interattivamente
  // (visibilità, colore, dettagli, elimina) SENZA implicare alcun
  // salvataggio in mod_spec — quello resta un'azione esplicita
  // (saveLight/saveAllLights, o il nodo FLE dedicato TJS/Light/Save).
  // Idempotente: ri-adottare la stessa luce aggiorna solo modelId.
  // Una luce già tracciata come preesistente (bloccata) resta tale: adopt()
  // non ne modifica mai isPreExisting.
  function adopt(light, modelId = null) {
    if (!light?.isLight) return null;
    let node = lights.find(n => n.light === light);
    if (node) {
      if (modelId != null) node.modelId = modelId;
      return node;
    }
    node = {
      id: light.uuid, name: light.name || (_defFor(light)?.label ?? t('app.tjs.light.default_name')),
      type: _detectType(light), isPreExisting: false, modelId: modelId ?? null,
      light, handle: null, helperMesh: null,
    };
    lights.push(node);
    _renderPanel();
    return node;
  }

  // ── Visibilità handle (legata all'apertura pannello) ────────────────────────

  function _setHandlesVisible(vis) {
    for (const node of lights) {
      if (node.helperMesh) node.helperMesh.visible = vis;
      if (node.guide) { node.guide.visible = vis; if (vis) node.guide.update(); }
    }
    markDirty();
  }

  // ── Fattore di scala handle ─────────────────────────────────────────────────

  function _applyHandleScale(val) {
    handleScale = Math.max(0.1, val);
    for (const node of lights) {
      if (node.helperMesh) node.helperMesh.scale.setScalar(handleScale);
    }
  }

  // ── Salvataggio ─────────────────────────────────────────────────────────────

  function _nodeToSpec(node) {
    const l   = node.light;
    const out = {
      id: node.id, name: node.name, type: node.type,
      color:     '#' + (l.color?.getHexString() ?? 'ffffff'),
      intensity: l.intensity ?? 1,
    };
    if (node.type === 'Hemisphere') out.groundColor = '#' + (l.groundColor?.getHexString() ?? '8b4513');
    if (node.handle) {
      const wp = new THREE.Vector3();
      node.handle.getWorldPosition(wp);
      out.position = { x: wp.x, y: wp.y, z: wp.z };
    }
    if (node.type === 'Point' || node.type === 'Spot') {
      out.distance = l.distance ?? 0;
      out.decay    = l.decay    ?? 2;
    }
    if (node.type === 'Spot') {
      out.angle    = l.angle    ?? Math.PI / 4;
      out.penumbra = l.penumbra ?? 0.1;
    }
    if (node.type === 'Directional' || node.type === 'Spot') {
      if (l.target) {
        const tp = l.target.getWorldPosition(new THREE.Vector3());
        out.target = { x: tp.x, y: tp.y, z: tp.z };
      }
      out.shadowAutoFit = node.shadowAutoFit !== false;
      out.castShadow = l.castShadow ?? false;
      if (l.castShadow) {
        out.shadowMapSize  = l.shadow.mapSize.width;
        out.shadowBias     = l.shadow.bias;
        out.shadowNormalBias = l.shadow.normalBias;
        out.shadowRadius   = l.shadow.radius;
        if ('intensity' in l.shadow) out.shadowIntensity = l.shadow.intensity;
        if (node.type === 'Directional') {
          out.shadowFrustum = {
            near:   l.shadow.camera.near,
            far:    l.shadow.camera.far,
            left:   l.shadow.camera.left,
            right:  l.shadow.camera.right,
            top:    l.shadow.camera.top,
            bottom: l.shadow.camera.bottom,
          };
        }
      }
    }
    return out;
  }

  async function saveLight(id) {
    const node = lights.find(n => n.id === id);
    if (!node || node.isPreExisting) return;
    await _saveForModel(node.modelId);
  }

  async function saveAllLights() {
    const mids = [...new Set(lights.filter(n => !n.isPreExisting && n.modelId != null).map(n => String(n.modelId)))];
    for (const mid of mids) await _saveForModel(mid);
  }

  async function _saveForModel(modelId) {
    if (modelId == null) { cmdUI?.update?.({ status: t('app.tjs.no_model.@') }); return; }
    const modArr = Array.isArray(models) ? models : [];
    const row    = modArr.find(r => String(r.mod_id) === String(modelId));
    if (!row) { cmdUI?.update?.({ status: t('app.tjs.model_not_found_id.@', { id: modelId }) }); return; }

    const spec   = { ...(_parseSpec(row.mod_spec) ?? {}) };
    spec.lights  = lights.filter(n => !n.isPreExisting && String(n.modelId) === String(modelId)).map(_nodeToSpec);

    try {
      cmdUI?.update?.({ status: t('app.tjs.light.saving') });
      const res  = await fetch('api/mod_spec_tool.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'save', mod_id: row.mod_id, mod_spec: spec }),
      });
      const data = await res.json();
      if (data.ok) { row.mod_spec = spec; cmdUI?.update?.({ status: t('app.tjs.light.saved') }); }
      else          cmdUI?.update?.({ status: t('app.tjs.error_detail', { error: data.error }) });
    } catch {
      cmdUI?.update?.({ status: t('errors.network') });
    }
  }

  // ── Costruzione pannello ────────────────────────────────────────────────────

  function _buildPanel() {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:relative',
      'flex:1',
      'min-height:200px',
      'overflow:hidden',
      'width:100%',
      'background:rgba(14,14,22,0.95)',
      'display:flex', 'flex-direction:column',
      'font-family:system-ui,sans-serif',
      'font-size:12px', 'color:#dde',
      'pointer-events:auto',
    ].join(';');

    // Header
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:5px 8px;border-bottom:1px solid #2a2a3e;background:rgba(0,0,0,0.25);flex-shrink:0';

    const title = document.createElement('span');
    title.style.cssText = 'font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em';
    title.textContent = t('app.tjs.light.title');
    hdr.appendChild(title);

    const hdrBtns = document.createElement('div');
    hdrBtns.style.cssText = 'display:flex;gap:2px';
    if (_canSave(mountTarget)) hdrBtns.appendChild(_mkBtn('bi-cloud-upload', t('app.tjs.light.save_all'), () => saveAllLights()));
    hdrBtns.appendChild(_mkBtn('bi-x-lg',         t('common.close'),            () => hide()));
    hdr.appendChild(hdrBtns);
    el.appendChild(hdr);

    // Barra aggiunta + scala
    const addBar = document.createElement('div');
    addBar.style.cssText = 'padding:5px 8px;border-bottom:1px solid #2a2a3e;flex-shrink:0';

    const addLbl = document.createElement('div');
    addLbl.style.cssText = 'font-size:10px;color:#667;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em';
    addLbl.textContent = t('app.tjs.light.add');
    addBar.appendChild(addLbl);

    const addBtns = document.createElement('div');
    addBtns.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px';
    for (const def of LIGHT_DEFS) {
      const btn = document.createElement('button');
      btn.innerHTML = `<i class="bi ${def.icon}" style="color:${def.color}" aria-hidden="true"></i><span style="font-size:10px;margin-left:3px;color:#99a">${te('app.tjs.light.type.' + def.type.toLowerCase())}</span>`;
      btn.style.cssText = 'background:#1e1e32;border:1px solid #2e2e4a;border-radius:3px;color:#aaa;cursor:pointer;padding:3px 6px;display:flex;align-items:center;white-space:nowrap';
      btn.onmouseenter = () => { btn.style.background = '#282840'; };
      btn.onmouseleave = () => { btn.style.background = '#1e1e32'; };
      btn.onclick = () => _promptAddLight(def.type);
      addBtns.appendChild(btn);
    }
    addBar.appendChild(addBtns);

    // Scala handle
    const scaleRow = document.createElement('div');
    scaleRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px';
    const scaleLbl = document.createElement('label');
    scaleLbl.style.cssText = 'color:#667;flex-shrink:0;font-size:10px;text-transform:uppercase;letter-spacing:.04em';
    scaleLbl.textContent = t('app.tjs.handle_scale');
    scaleLbl.htmlFor = 'tjsLgtScale_' + Math.random().toString(36).slice(2, 8);
    const scaleSlider = document.createElement('input');
    scaleSlider.type  = 'range';
    scaleSlider.min   = '0.1';
    scaleSlider.max   = '5';
    scaleSlider.step  = '0.05';
    scaleSlider.value = String(handleScale);
    scaleSlider.style.cssText = 'flex:1;cursor:pointer;accent-color:#4af';
    scaleSlider.id    = scaleLbl.htmlFor;
    const scaleVal = document.createElement('span');
    scaleVal.style.cssText = 'min-width:28px;text-align:right;color:#99a;font-size:11px';
    scaleVal.textContent = handleScale.toFixed(2);
    scaleSlider.oninput = () => {
      const v = parseFloat(scaleSlider.value);
      _applyHandleScale(v);
      scaleVal.textContent = handleScale.toFixed(2);
    };
    scaleRow.appendChild(scaleLbl);
    scaleRow.appendChild(scaleSlider);
    scaleRow.appendChild(scaleVal);
    addBar.appendChild(scaleRow);

    el.appendChild(addBar);

    // Lista
    const listEl = document.createElement('div');
    listEl.style.cssText = 'overflow-y:auto;flex:1;padding:4px 0';
    el._listEl = listEl;
    el.appendChild(listEl);

    return el;
  }

  // ── Dialogo selezione modello ────────────────────────────────────────────────

  function _promptAddLight(type) {
    const modArr = Array.isArray(models) ? models : [];
    if (modArr.length <= 1) { addLight(type, modArr[0]?.mod_id ?? null); return; }
    _openModelPickerDlg(type);
  }

  function _openModelPickerDlg(type) {
    _closeAllDlgs();
    const def    = LIGHT_DEFS.find(d => d.type === type);
    const modArr = Array.isArray(models) ? models : [];

    const dlg = _dlgBase('tjs-lgt-picker');
    dlg.innerHTML = `
      <div style="margin-bottom:10px;font-weight:600;font-size:13px">
        <i class="bi ${def.icon}" style="color:${def.color};margin-right:6px" aria-hidden="true"></i>${te('app.tjs.light.type.' + def.type.toLowerCase())}
      </div>
      <label for="_lgtModSel" style="display:block;margin-bottom:6px;color:#889;font-size:11px">${te('app.tjs.associate_model.@')}</label>
      <select id="_lgtModSel" style="${_selStyle()}">
        ${modArr.map(r => `<option value="${r.mod_id}">${r.mod_name ?? te('app.tjs.model_fallback.@', { id: r.mod_id })}</option>`).join('')}
      </select>
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:12px">
        <button id="_lgtPickOk"     style="${_btnStyle('#2244aa')}">${te('common.create')}</button>
        <button id="_lgtPickCancel" style="${_btnStyle('#333','#bbb')}">${te('common.cancel')}</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#_lgtPickOk').onclick = () => {
      const mid = parseInt(dlg.querySelector('#_lgtModSel').value);
      dlg.remove(); addLight(type, mid);
    };
    dlg.querySelector('#_lgtPickCancel').onclick = () => dlg.remove();
    if (signal) signal.addEventListener('abort', () => dlg.remove(), { once: true });
  }

  // ── Rendering lista ─────────────────────────────────────────────────────────

  function _renderPanel() {
    if (!panelEl) return;
    const listEl = panelEl._listEl;
    listEl.innerHTML = '';

    const pre = lights.filter(n =>  n.isPreExisting);
    const usr = lights.filter(n => !n.isPreExisting);

    if (pre.length) { listEl.appendChild(_sectionHdr(t('app.tjs.section.preexisting'), true));  pre.forEach(n => listEl.appendChild(_makeRow(n))); }
    if (usr.length) { listEl.appendChild(_sectionHdr(t('app.tjs.section.created'), false)); usr.forEach(n => listEl.appendChild(_makeRow(n))); }

    if (!lights.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:16px 8px;text-align:center;color:#445;font-size:11px';
      empty.textContent   = t('app.tjs.light.empty');
      listEl.appendChild(empty);
    }
  }

  function _sectionHdr(label, locked) {
    const el = document.createElement('div');
    el.style.cssText = 'padding:5px 8px 3px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#445;display:flex;align-items:center;gap:4px;border-bottom:1px solid #1a1a2a;margin-bottom:2px';
    el.innerHTML = locked ? `<i class="bi bi-lock" style="font-size:9px" aria-hidden="true"></i> ${label}` : `<i class="bi bi-pencil" style="font-size:9px" aria-hidden="true"></i> ${label}`;
    return el;
  }

  function _makeRow(node) {
    const wrap = document.createElement('div');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;padding:3px 8px;gap:3px;cursor:default;user-select:none;min-height:24px';
    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.04)'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });

    // Icona tipo
    const def     = LIGHT_DEFS.find(d => d.type === node.type);
    const typeIco = document.createElement('span');
    typeIco.innerHTML = `<i class="bi ${def?.icon ?? 'bi-lightbulb'}" style="color:${def?.color ?? '#fff'};font-size:13px"></i>`;
    typeIco.style.cssText = 'flex-shrink:0;width:16px;text-align:center';
    row.appendChild(typeIco);

    // Nome
    if (node.isPreExisting) {
      const nm = document.createElement('span');
      nm.textContent = node.name;
      nm.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#889;font-size:11px';
      row.appendChild(nm);
    } else {
      const nm = document.createElement('input');
      nm.type  = 'text';
      nm.value = node.name;
      nm.setAttribute('aria-label', t('common.name'));
      nm.style.cssText = 'flex:1;background:transparent;border:none;border-bottom:1px solid #2a2a44;color:#dde;font-size:12px;padding:1px 2px;outline:none;min-width:0';
      nm.onchange = () => { node.name = nm.value.trim() || node.name; };
      nm.onfocus  = () => { nm.style.borderBottomColor = '#44f'; };
      nm.onblur   = () => { nm.style.borderBottomColor = '#2a2a44'; };
      row.appendChild(nm);
    }

    // Lock o badge modello
    if (node.isPreExisting) {
      const lk = document.createElement('span');
      lk.innerHTML = '<i class="bi bi-lock" style="font-size:10px;color:#445"></i>';
      lk.title     = t('app.tjs.light.locked_hint');
      lk.style.cssText = 'flex-shrink:0';
      row.appendChild(lk);
    } else {
      _appendModelBadge(row, node);
    }

    // Visibilità luce (non dell'handle)
    const btnVis = document.createElement('button');
    _smBtn(btnVis);
    btnVis.innerHTML = node.light.visible
      ? '<i class="bi bi-lightbulb-fill" style="color:#ffd700"></i>'
      : '<i class="bi bi-lightbulb-off"  style="color:#444"></i>';
    btnVis.title = t('app.tjs.light.toggle');
    btnVis.onclick = () => {
      node.light.visible = !node.light.visible;
      // Il gruppo intero: se spegni la luce, nascondi anche l'handle
      if (node.handle) node.handle.visible = node.light.visible;
      _renderPanel();
    };
    row.appendChild(btnVis);

    // Colore
    const hex = '#' + (node.light.color?.getHexString() ?? 'ffffff');
    const btnClr = document.createElement('button');
    btnClr.title = t('app.tjs.light.color');
    btnClr.style.cssText = `width:13px;height:13px;background:${hex};border:1px solid #555;border-radius:2px;cursor:pointer;padding:0;flex-shrink:0`;
    btnClr.onclick = () => _openColorDlg(node, btnClr);
    row.appendChild(btnClr);

    // Dettagli espandibili
    const btnDet = document.createElement('button');
    _smBtn(btnDet);
    btnDet.innerHTML = '<i class="bi bi-sliders"></i>';
    btnDet.title     = t('app.tjs.properties');
    btnDet.onclick   = () => {
      const det = wrap.querySelector('.tjs-lgt-det');
      if (det) det.remove(); else wrap.appendChild(_makeDetails(node, wrap));
    };
    row.appendChild(btnDet);

    // Seleziona handle (solo user-created con handle 3D)
    if (!node.isPreExisting && node.handle && transformTool) {
      const btnSel = document.createElement('button');
      _smBtn(btnSel);
      btnSel.innerHTML = '<i class="bi bi-cursor"></i>';
      btnSel.title     = t('app.tjs.light.select_handle');
      btnSel.onclick   = () => {
        transformTool.selectObject(node.handle);
        if (!transformTool.gizmoEnabled) transformTool.enableGizmo(true);
      };
      row.appendChild(btnSel);
    }

    // Delete / Save (solo user-created)
    if (!node.isPreExisting) {
      const btnDel = document.createElement('button');
      _smBtn(btnDel);
      btnDel.innerHTML = '<i class="bi bi-trash3" style="color:#f65"></i>';
      btnDel.title     = t('app.tjs.light.delete');
      btnDel.onclick   = () => { if (confirm(t('app.tjs.confirm_delete_named', { name: node.name }))) removeLight(node.id); };
      row.appendChild(btnDel);

      if (_canSave(mountTarget)) {
        const btnSave = document.createElement('button');
        _smBtn(btnSave);
        btnSave.innerHTML = '<i class="bi bi-floppy" style="color:#6af"></i>';
        btnSave.title     = t('app.tjs.light.save_model.@');
        btnSave.onclick   = () => saveLight(node.id);
        row.appendChild(btnSave);
      }
    }

    // Accessibilità: nome accessibile = title per i pulsanti a sola icona
    row.querySelectorAll('button[title]').forEach(b => { if (!b.hasAttribute('aria-label')) b.setAttribute('aria-label', b.title); });
    row.querySelectorAll('i.bi').forEach(i => i.setAttribute('aria-hidden', 'true'));

    wrap.appendChild(row);
    return wrap;
  }

  function _appendModelBadge(row, node) {
    const modArr = Array.isArray(models) ? models : [];
    if (!modArr.length) return;
    const modRow  = modArr.find(r => String(r.mod_id) === String(node.modelId));
    const rawName = modRow?.mod_name ?? (node.modelId ? `M${node.modelId}` : '?');
    const label   = rawName.length > 9 ? rawName.slice(0, 9) + '…' : rawName;

    const badge = document.createElement('button');
    badge.textContent = label;
    badge.title       = t('app.tjs.model_badge.@', { name: rawName });
    badge.style.cssText = 'background:#1e2840;border:1px solid #2a3860;border-radius:3px;color:#7af;cursor:pointer;padding:1px 5px;font-size:10px;flex-shrink:0;max-width:75px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    badge.onclick = () => _openModelChangeDlg(node);
    row.appendChild(badge);
  }

  function _makeDetails(node, wrap) {
    const det = document.createElement('div');
    det.className = 'tjs-lgt-det';
    det.style.cssText = 'padding:6px 8px 8px 30px;background:rgba(0,0,0,0.22);border-bottom:1px solid #1a1a2a';

    const addRow = (label, ctrl) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:11px';
      const field = ctrl.matches?.('input,select') ? ctrl : ctrl.querySelector?.('input,select');
      if (field && !field.hasAttribute('aria-label')) field.setAttribute('aria-label', label);
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'min-width:82px;color:#667;flex-shrink:0';
      r.appendChild(lbl); r.appendChild(ctrl); det.appendChild(r);
    };

    const addSep = () => {
      const s = document.createElement('div');
      s.style.cssText = 'border-top:1px solid #1e1e30;margin:6px 0 5px';
      det.appendChild(s);
    };

    addRow(t('app.tjs.light.intensity'), _numInput(node.light.intensity, 0.1, v => { node.light.intensity = v; }));
    if (node.type === 'Hemisphere') {
      addRow(t('app.tjs.light.ground_color'), _colorInput('#' + (node.light.groundColor?.getHexString() ?? '8b4513'), v => node.light.groundColor?.set(v)));
    }
    if (node.type === 'Point' || node.type === 'Spot') {
      addRow(t('app.tjs.light.distance'), _numInput(node.light.distance ?? 0, 1,   v => { node.light.distance = v; }));
      addRow('Decay',    _numInput(node.light.decay    ?? 2, 0.1, v => { node.light.decay    = v; }));
    }
    if (node.type === 'Spot') {
      addRow(t('app.tjs.light.angle'), _numInput(node.light.angle    ?? 0.5, 0.01, v => { node.light.angle    = v; }));
      addRow('Penumbra',     _numInput(node.light.penumbra ?? 0.1, 0.01, v => { node.light.penumbra = v; }));
    }
    if (node.type === 'Directional' || node.type === 'Spot') {
      if (node.light.target && !node.isPreExisting) {
        const btnAim = _textBtn('bi-crosshair', t('app.tjs.light.point_at'), () => pointAtSelection(node.id));
        btnAim.title = t('app.tjs.light.point_at_tip');
        addRow(t('app.tjs.light.target'), btnAim);
      }
      addSep();
      addRow('Cast shadow', _checkbox(node.light.castShadow, v => {
        node.light.castShadow = v;
        if (v) {
          // ombre visibili al primo clic: proietta/riceve sui modelli se nessuno proietta,
          // area dell'ombra e bias sul modello
          const n = modelsRoot ? tjsEnsureShadowCasters(modelsRoot) : 0;
          if (n) cmdUI?.update?.({ status: t('app.tjs.light.casters_on', { n }) });
          if (node.shadowAutoFit !== false) _fitNode(node);
        }
        // Ricostruisce il pannello dettagli per mostrare/nascondere le opzioni shadow
        if (wrap) { det.remove(); wrap.appendChild(_makeDetails(node, wrap)); }
      }));

      if (node.light.castShadow) {
        const sh = node.light.shadow;

        addRow(t('app.tjs.light.shadow_autofit'), _checkbox(node.shadowAutoFit !== false, v => {
          node.shadowAutoFit = v;
          if (v) _fitNode(node);
        }));
        const btnFit = _textBtn('bi-bounding-box', t('app.tjs.light.shadow_fit'), () => {
          _fitNode(node);
          if (wrap) { det.remove(); wrap.appendChild(_makeDetails(node, wrap)); }
        });
        btnFit.title = t('app.tjs.light.shadow_fit_tip');
        addRow('', btnFit);

        // Intensità (densità) ombra — r0.174+
        if ('intensity' in sh) {
          addRow(t('app.tjs.light.shadow_intensity'), _rangeInput(sh.intensity ?? 1, 0, 1, 0.01, v => { sh.intensity = v; }));
        }

        addRow('Blur PCF (radius)', _numInput(sh.radius ?? 1, 0.5, v => { sh.radius = Math.max(0, v); }));
        addRow(t('app.tjs.light.shadow_map'), _shadowSizeSelect(sh));
        addRow('Bias',              _numInput(sh.bias,       0.0001, v => { sh.bias       = v; }));
        addRow('Normal Bias',       _numInput(sh.normalBias, 0.001,  v => { sh.normalBias = v; }));

        addSep();
        if (node.type === 'Directional') {
          addRow('Frustum ±X', _numInput(sh.camera.right, 1, v => {
            sh.camera.left = -Math.abs(v); sh.camera.right = Math.abs(v);
            sh.camera.updateProjectionMatrix();
          }));
          addRow('Frustum ±Y', _numInput(sh.camera.top, 1, v => {
            sh.camera.bottom = -Math.abs(v); sh.camera.top = Math.abs(v);
            sh.camera.updateProjectionMatrix();
          }));
        }
        addRow('Near', _numInput(sh.camera.near, 0.1, v => { sh.camera.near = v; sh.camera.updateProjectionMatrix(); }));
        addRow('Far',  _numInput(sh.camera.far,  10,  v => { sh.camera.far  = v; sh.camera.updateProjectionMatrix(); }));
      }
    }
    return det;
  }

  function _shadowSizeSelect(shadow) {
    const sizes   = [512, 1024, 2048, 4096, 8192];
    const current = shadow.mapSize.width;
    const sel = document.createElement('select');
    sel.style.cssText = 'background:#111;color:#dde;border:1px solid #333;border-radius:3px;padding:2px 4px;font-size:11px';
    for (const s of sizes) {
      const o = document.createElement('option');
      o.value = String(s); o.textContent = `${s}px`;
      if (s === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      const v = parseInt(sel.value);
      shadow.mapSize.setScalar(v);
      // Invalida la shadow map in modo che Three.js la rigeneri
      if (shadow.map) { shadow.map.dispose(); shadow.map = null; }
    };
    return sel;
  }

  // ── Dialoghi ────────────────────────────────────────────────────────────────

  function _openColorDlg(node, anchor) {
    _closeAllDlgs();
    const origHex = '#' + (node.light.color?.getHexString() ?? 'ffffff');
    const dlg     = _dlgBase('tjs-lgt-color-dlg');
    const rect    = anchor.getBoundingClientRect();
    dlg.style.left      = `${Math.min(rect.left - 190, window.innerWidth - 210)}px`;
    dlg.style.top       = `${Math.max(4, Math.min(rect.top, window.innerHeight - 130))}px`;
    dlg.style.transform = '';

    dlg.innerHTML = `
      <div style="margin-bottom:8px;font-weight:600">${te('app.tjs.light.color')}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <label for="_lgtClr" style="color:#889">${te('common.color')}</label>
        <input type="color" id="_lgtClr" value="${origHex}" style="width:44px;height:24px;border:1px solid #444;padding:1px;background:#111;border-radius:3px;cursor:pointer">
      </div>
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button id="_lgtClrOk" style="${_btnStyle('#2244aa')}">${te('common.ok')}</button>
        <button id="_lgtClrKo" style="${_btnStyle('#333','#bbb')}">${te('common.cancel')}</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#_lgtClr').oninput = e => node.light.color?.set(e.target.value);
    dlg.querySelector('#_lgtClrOk').onclick = () => { _renderPanel(); dlg.remove(); };
    dlg.querySelector('#_lgtClrKo').onclick = () => { node.light.color?.set(origHex); dlg.remove(); };
    const outside = e => {
      if (!dlg.contains(e.target) && e.target !== anchor) { node.light.color?.set(origHex); dlg.remove(); document.removeEventListener('mousedown', outside); }
    };
    setTimeout(() => document.addEventListener('mousedown', outside), 80);
    if (signal) signal.addEventListener('abort', () => dlg.remove(), { once: true });
  }

  function _openModelChangeDlg(node) {
    _closeAllDlgs();
    const modArr = Array.isArray(models) ? models : [];
    if (!modArr.length) return;
    const dlg = _dlgBase('tjs-lgt-modchg');
    dlg.innerHTML = `
      <div style="margin-bottom:10px;font-weight:600;font-size:13px">${te('app.tjs.associate_model_title.@')}</div>
      <label for="_lgtModChgSel" style="display:block;margin-bottom:6px;color:#889;font-size:11px">${te('app.tjs.light.save_model_for.@')}</label>
      <select id="_lgtModChgSel" style="${_selStyle()}">
        ${modArr.map(r => `<option value="${r.mod_id}" ${String(r.mod_id) === String(node.modelId) ? 'selected' : ''}>${r.mod_name ?? te('app.tjs.model_fallback.@', { id: r.mod_id })}</option>`).join('')}
      </select>
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:12px">
        <button id="_modChgOk" style="${_btnStyle('#2244aa')}">${te('common.ok')}</button>
        <button id="_modChgKo" style="${_btnStyle('#333','#bbb')}">${te('common.cancel')}</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#_modChgOk').onclick = () => {
      node.modelId = parseInt(dlg.querySelector('#_lgtModChgSel').value);
      dlg.remove(); _renderPanel();
    };
    dlg.querySelector('#_modChgKo').onclick = () => dlg.remove();
    if (signal) signal.addEventListener('abort', () => dlg.remove(), { once: true });
  }

  // ── Utilities UI ────────────────────────────────────────────────────────────

  function _mkBtn(icon, title, onclick) {
    const b = document.createElement('button');
    b.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
    b.title   = title;
    b.setAttribute('aria-label', title);
    b.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;padding:2px 4px;font-size:13px';
    b.onclick = onclick;
    return b;
  }

  function _textBtn(icon, label, onclick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tjs-rpanel-addbar-btn';
    b.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i><span></span>`;
    b.querySelector('span').textContent = label;   // label già tradotta
    b.onclick = onclick;
    return b;
  }

  function _smBtn(btn) {
    btn.style.cssText = 'background:none;border:none;cursor:pointer;padding:1px 3px;font-size:12px;color:inherit;line-height:1;flex-shrink:0';
  }

  function _numInput(val, step, onChange) {
    const inp = document.createElement('input');
    inp.type  = 'number';
    inp.step  = String(step > 0 ? step : 0.1);
    inp.value = String(Math.round(val * 1000) / 1000);
    inp.style.cssText = 'width:68px;background:#111;color:#dde;border:1px solid #333;border-radius:3px;padding:2px 4px;font-size:11px';
    inp.onchange = () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) { onChange(v); markDirty(); } };
    return inp;
  }

  function _colorInput(hex, onChange) {
    const inp = document.createElement('input');
    inp.type  = 'color';
    inp.value = hex;
    inp.style.cssText = 'width:38px;height:20px;border:1px solid #444;padding:1px;background:#111;border-radius:2px;cursor:pointer';
    inp.oninput = () => { onChange(inp.value); markDirty(); };
    return inp;
  }

  function _rangeInput(val, min, max, step, onChange) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex:1';
    const r = document.createElement('input');
    r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step);
    r.value = String(val);
    r.style.cssText = 'flex:1;cursor:pointer;accent-color:#4af';
    const n = document.createElement('span');
    n.style.cssText = 'min-width:28px;text-align:right;color:#99a;font-size:11px';
    n.textContent = String(Math.round(val * 100) / 100);
    r.oninput = () => {
      const v = parseFloat(r.value);
      n.textContent = String(Math.round(v * 100) / 100);
      if (Number.isFinite(v)) { onChange(v); markDirty(); }
    };
    wrap.appendChild(r); wrap.appendChild(n);
    return wrap;
  }

  function _checkbox(checked, onChange) {
    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = !!checked;
    cb.style.cssText = 'cursor:pointer;accent-color:#4af';
    cb.onchange = () => { onChange(cb.checked); markDirty(); };
    return cb;
  }

  function _dlgBase(cls) {
    const d = document.createElement('div');
    d.className = cls;
    d.setAttribute('role', 'dialog');
    d.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'background:#1a1a2e', 'border:1px solid #3a3a5e',
      'border-radius:8px', 'padding:14px', 'z-index:9999',
      'min-width:230px',
      'font-family:system-ui,sans-serif', 'font-size:12px', 'color:#dde',
      'box-shadow:0 8px 32px rgba(0,0,0,.8)',
    ].join(';');
    return d;
  }

  function _btnStyle(bg, color = '#fff') {
    return `background:${bg};color:${color};border:none;border-radius:4px;padding:4px 14px;cursor:pointer;font-size:12px`;
  }
  function _selStyle() {
    return 'width:100%;background:#111;color:#dde;border:1px solid #444;border-radius:4px;padding:4px;font-size:12px;margin-bottom:2px';
  }

  function _closeAllDlgs() {
    document.querySelectorAll('.tjs-lgt-picker,.tjs-lgt-color-dlg,.tjs-lgt-modchg').forEach(e => e.remove());
  }

  // ── API pubblica ─────────────────────────────────────────────────────────────

  function show() {
    if (!panelEl) {
      panelEl = _buildPanel();
      mountTarget.appendChild(panelEl);
    }
    _setHandlesVisible(true);
    _renderPanel();
    panelEl.style.display = 'flex';
    visible = true;
  }

  function hide() {
    _setHandlesVisible(false);
    if (panelEl) panelEl.style.display = 'none';
    visible = false;
    _closeAllDlgs();
  }

  function toggle() {
    if (visible) hide(); else show();
  }

  function dispose() {
    _setHandlesVisible(false);
    for (const node of lights) _disposeGuide(node);
    _closeAllDlgs();
    panelEl?.remove();
    panelEl = null;
    visible = false;
    Object.values(_geoCache).forEach(g => g?.dispose?.());
  }

  if (signal) signal.addEventListener('abort', dispose, { once: true });

  _init();

  return { show, hide, toggle, dispose, isVisible: () => visible, addLight, removeLight, saveLight, saveAllLights, adopt,
           pointAtSelection, onSceneTransformed };
}
