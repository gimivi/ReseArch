// TJS-env-manager.mjs
// Pannello impostazioni ambiente scena TJS.
//
// Gestisce:
//   – Griglia: visibile, dimensione, divisioni, colori
//   – Atmosfera (mutualmente esclusiva):
//       none | color | fog | fogExp2 | sky | skybox
//
// Il salvataggio avviene in mod_spec.environment del modello scelto.
// Le sezioni si disattivano automaticamente quando ne viene scelta un'altra
// (es. attivare "fog" rimuove skybox e viceversa).
//
// Punti e Linee: qui si impostano solo i DEFAULT globali (dimensione/forma
// punto, spessore linea) applicati a ogni THREE.Points/THREE.Line della
// scena che non abbia già un override esplicito salvato per-modello (vedi
// applyModSpecStyle in model_TJS.mjs e TJS-material-editor.mjs) — il marker
// `userData.__pointsLineStyleOverride`, impostato da quell'override, dice a
// _applyPointsLines() di saltare l'oggetto e non sovrascriverlo.
//
// Illuminazione di base (2026-10-18, mod_spec.environment.baseLight): luce ambiente e "sole"
// (TJS_BASE_AMBIENT / TJS_BASE_SUN creati da model_TJS) regolati qui, con il sole su
// azimut/elevazione intorno al modello e la sua ombra adattata al modello; ambiente neutro
// (RoomEnvironment) per i materiali PBR quando non c'è una mappa IBL; pavimento per le ombre.
// Occlusione ambientale: GTAO (al posto del vecchio SSAO, i cui parametri dipendevano da
// near/far della camera); raggio e spessore in unità di scena, iniziali sulla misura del modello.
//
// Clay (2026-10-21, mod_spec.environment.clay): vista clay e parametri del materiale clay del
// pannello (TJS-clay.mjs), che vale anche per gli oggetti caricati senza materiale.

import { applyPointShape } from './TJS-loaders.mjs';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { tjsModelsBox, tjsFitShadow, tjsEnsureShadowCasters, tjsPlaceSun,
         tjsCreateShadowGround, tjsUpdateShadowGround } from './TJS-lighting-utils.mjs';
import { t } from '../shared/i18n.mjs';
import { panelLevel } from '../shared/ui_level.mjs';

// Livello di interazione (§5): il salvataggio in mod_spec solo da autore (30) in su
const _canSave = (el) => panelLevel(el) >= 30;   // livello del pannello (_doc/arch-permessi.md §11.4)

const TONE_MAPPING = {
  None:       0,
  Linear:     1,
  Reinhard:   2,
  Cineon:     3,
  ACESFilmic: 4,
  AgX:        6,
  Neutral:    7,
};

// PCFSoft (2) è stato rimosso dalla r186: PCF ora è morbido e usa shadow.radius.
// I valori "PCFSoft" salvati nei mod_spec si leggono come "PCF" (vedi _applyFromSpec).
const SHADOW_TYPE = {
  Basic:   0,
  PCF:     1,
  VSM:     3,
};

const ATMO_TYPES = [
  { type: 'none',    get label() { return t('app.tjs.env.atmo.none'); },    icon: 'bi-x-circle'    },
  { type: 'color',   get label() { return t('app.tjs.env.atmo.color'); },   icon: 'bi-palette'     },
  { type: 'fog',     get label() { return t('app.tjs.env.atmo.fog'); },     icon: 'bi-cloud-haze'  },
  { type: 'fogExp2', get label() { return t('app.tjs.env.atmo.fog_exp2'); }, icon: 'bi-cloud-fog2'  },
  { type: 'sky',     get label() { return t('app.tjs.env.atmo.sky'); },     icon: 'bi-cloud-sun'   },
  { type: 'skybox',  get label() { return t('app.tjs.env.atmo.skybox'); },  icon: 'bi-image'       },
];

// ─────────────────────────────────────────────────────────────────────────────

export function tjsCreateEnvManager({
  THREE,
  scene,
  renderer,
  models,
  bodyEl,
  containerEl,
  getGrid,
  setGrid,
  modelsRoot = null,      // box del modello: sole, ombre, pavimento, raggio GTAO
  getBaseLights = null,   // () => ({ ambient, sun }) — luci di base create da model_TJS
  clay = null,            // materiale clay del pannello (TJS-clay.mjs)
  enableAO,
  disableAO,
  updateAO,
  cmdUI,
  signal,
  markDirty = () => {},
}) {
  const mountTarget = containerEl ?? bodyEl;

  let panelEl = null;
  let visible = false;

  // Stato attuale dell'ambiente (tenuto in sync con la scena)
  const state = {
    // Griglia
    gridVisible:    true,
    gridSize:       100,
    gridDivisions:  20,
    gridColorCenter: '#3355ff',
    gridColorGrid:   '#808080',
    // Atmosfera
    atmoType:       'none',
    bgColor:        '#101018',
    fogColor:       '#cccccc',
    fogNear:        10,
    fogFar:         100,
    fogDensity:     0.01,
    skyTop:         '#0a0a3a',
    skyBottom:      '#e8f4f8',
    skyboxUrl:      '',
    // Filtro selezione per tipo (true = selezionabile)
    selFilterMesh:   true,
    selFilterLine:   true,
    selFilterPoints: true,
    selFilterGroup:  true,
    // Punti e linee — default globali (vedi nota in testa al file)
    pointSize:            0.02,   // stesso default hardcoded finora in TJS-loaders.mjs::geometryToObject3D
    pointSizeAttenuation: true,
    pointShape:           'square',
    lineWidth:            1,
    // Rendering
    toneMapping:    'ACESFilmic',
    exposure:       1.0,
    shadowEnabled:  true,
    shadowType:     'PCF',
    // Occlusione ambientale (GTAO). aoRadius/aoThickness null = calcolati sulla misura del modello
    aoEnabled:      false,
    aoIntensity:    1.0,
    aoRadius:       null,
    aoThickness:    null,
    aoSamples:      16,
    aoDebug:        false,
    // Illuminazione di base (valori iniziali = luci fisse di prima: ambiente 0.6, sole 0.8 da (10,12,8))
    ambientIntensity: 0.6,
    sunEnabled:     true,
    sunIntensity:   0.8,
    sunColor:       '#ffffff',
    sunAzimuth:     51,
    sunElevation:   43,
    sunShadow:      false,
    shadowGround:   false,
    roomEnv:        false,
    envIntensity:   1.0,
    _roomEnvMap:    null,
    _ground:        null,
    // IBL (Image Based Lighting — environment map per riflessioni PBR)
    iblUrl:         '',
    iblAsBackground: false,
    // Associazione salvataggio
    modelId:        null,
    // Texture non salvate
    _skyboxTex:     null,
    _skyTex:        null,
    _iblEnvMap:     null,
  };

  // ── Init ────────────────────────────────────────────────────────────────────

  function _init() {
    // Sceglie il primo modello come default per il salvataggio
    const modArr = Array.isArray(models) ? models : [];
    if (modArr.length) state.modelId = modArr[0].mod_id;

    // Carica da mod_spec del primo modello (oppure auto-rileva dalla scena)
    for (const row of modArr) {
      const spec = _parseSpec(row?.mod_spec);
      if (!spec?.environment) continue;
      _applyFromSpec(spec.environment);
      state.modelId = row.mod_id;
      break;
    }

    // Se non trovato in mod_spec, rileva stato corrente dalla scena
    _syncFromScene();
    // Luce di base sempre applicata: posiziona il sole sul modello anche senza environment salvato
    _applyBaseLighting();
    // Inizializza filtro selezione sulla scena
    _applySelFilter();
  }

  function _parseSpec(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function _applyFromSpec(env) {
    if (!env) return;
    const g = env.grid ?? {};
    if (typeof g.visible   === 'boolean') state.gridVisible    = g.visible;
    if (typeof g.size      === 'number')  state.gridSize       = g.size;
    if (typeof g.divisions === 'number')  state.gridDivisions  = g.divisions;
    if (g.colorCenter) state.gridColorCenter = g.colorCenter;
    if (g.colorGrid)   state.gridColorGrid   = g.colorGrid;

    const a = env.atmosphere ?? {};
    if (a.type)        state.atmoType    = a.type;
    if (a.bgColor)     state.bgColor     = a.bgColor;
    if (a.fogColor)    state.fogColor    = a.fogColor;
    if (typeof a.fogNear    === 'number') state.fogNear    = a.fogNear;
    if (typeof a.fogFar     === 'number') state.fogFar     = a.fogFar;
    if (typeof a.fogDensity === 'number') state.fogDensity = a.fogDensity;
    if (a.skyTop)      state.skyTop      = a.skyTop;
    if (a.skyBottom)   state.skyBottom   = a.skyBottom;
    if (a.skyboxUrl)   state.skyboxUrl   = a.skyboxUrl;

    const sf = env.selFilter ?? {};
    if (typeof sf.Mesh   === 'boolean') state.selFilterMesh   = sf.Mesh;
    if (typeof sf.Line   === 'boolean') state.selFilterLine   = sf.Line;
    if (typeof sf.Points === 'boolean') state.selFilterPoints = sf.Points;
    if (typeof sf.Group  === 'boolean') state.selFilterGroup  = sf.Group;

    const pl = env.pointsLines ?? {};
    if (typeof pl.pointSize            === 'number')  state.pointSize            = pl.pointSize;
    if (typeof pl.pointSizeAttenuation === 'boolean') state.pointSizeAttenuation = pl.pointSizeAttenuation;
    if (pl.pointShape)                                state.pointShape           = pl.pointShape;
    if (typeof pl.lineWidth            === 'number')  state.lineWidth            = pl.lineWidth;

    const rn = env.rendering ?? {};
    if (rn.toneMapping)                        state.toneMapping    = rn.toneMapping;
    if (typeof rn.exposure === 'number')       state.exposure       = rn.exposure;
    if (typeof rn.shadowEnabled === 'boolean') state.shadowEnabled  = rn.shadowEnabled;
    if (rn.shadowType)                         state.shadowType     = rn.shadowType === 'PCFSoft' ? 'PCF' : rn.shadowType;
    if (typeof rn.aoEnabled   === 'boolean') state.aoEnabled   = rn.aoEnabled;
    if (typeof rn.aoIntensity === 'number')  state.aoIntensity = rn.aoIntensity;
    if (typeof rn.aoRadius    === 'number')  state.aoRadius    = rn.aoRadius;
    if (typeof rn.aoThickness === 'number')  state.aoThickness = rn.aoThickness;
    if (typeof rn.aoSamples   === 'number')  state.aoSamples   = rn.aoSamples;
    if (typeof rn.aoDebug     === 'boolean') state.aoDebug     = rn.aoDebug;
    if (rn.iblUrl)                             state.iblUrl         = rn.iblUrl;
    if (typeof rn.iblAsBackground === 'boolean') state.iblAsBackground = rn.iblAsBackground;
    if (state.iblUrl) _loadIBL(state.iblUrl);

    const bl = env.baseLight ?? {};
    if (typeof bl.ambientIntensity === 'number')  state.ambientIntensity = bl.ambientIntensity;
    if (typeof bl.sunEnabled       === 'boolean') state.sunEnabled       = bl.sunEnabled;
    if (typeof bl.sunIntensity     === 'number')  state.sunIntensity     = bl.sunIntensity;
    if (bl.sunColor)                              state.sunColor         = bl.sunColor;
    if (typeof bl.sunAzimuth       === 'number')  state.sunAzimuth       = bl.sunAzimuth;
    if (typeof bl.sunElevation     === 'number')  state.sunElevation     = bl.sunElevation;
    if (typeof bl.sunShadow        === 'boolean') state.sunShadow        = bl.sunShadow;
    if (typeof bl.shadowGround     === 'boolean') state.shadowGround     = bl.shadowGround;
    if (typeof bl.roomEnv          === 'boolean') state.roomEnv          = bl.roomEnv;
    if (typeof bl.envIntensity     === 'number')  state.envIntensity     = bl.envIntensity;

    if (env.clay) clay?.fromSpec(env.clay);

    // Applica alla scena
    _applyGrid();
    _applyAtmosphere();
    _applySelFilter();
    _applyRendering();
    _applyPointsLines();
  }

  function _syncFromScene() {
    // Rilevamento griglia
    const grid = getGrid?.();
    if (grid) {
      state.gridVisible = grid.visible;
    }
    _applyPointsLines();
    // Rilevamento background
    if (scene.background instanceof THREE.Color) {
      state.bgColor  = '#' + scene.background.getHexString();
      if (state.atmoType === 'none') state.atmoType = 'color';
    }
    // Rilevamento fog
    if (scene.fog instanceof THREE.FogExp2) {
      state.atmoType   = 'fogExp2';
      state.fogDensity = scene.fog.density;
      state.fogColor   = '#' + scene.fog.color.getHexString();
    } else if (scene.fog instanceof THREE.Fog) {
      state.atmoType = 'fog';
      state.fogNear  = scene.fog.near;
      state.fogFar   = scene.fog.far;
      state.fogColor = '#' + scene.fog.color.getHexString();
    }
  }

  // ── Applicazione ambiente ────────────────────────────────────────────────────

  function _applyGrid() {
    setGrid?.({
      visible:   state.gridVisible,
      size:      state.gridSize,
      divisions: state.gridDivisions,
      colorCenter: state.gridColorCenter,
      colorGrid:   state.gridColorGrid,
    });
  }

  function _applyAtmosphere() {
    // Pulisci texture sky precedente
    if (state._skyboxTex && scene.background === state._skyboxTex) {
      state._skyboxTex.dispose?.();
      state._skyboxTex = null;
    }
    if (state._skyTex && scene.background === state._skyTex) {
      state._skyTex.dispose?.();
      state._skyTex = null;
    }

    // Rimuovi fog
    scene.fog = null;

    switch (state.atmoType) {
      case 'color':
        scene.background = new THREE.Color(state.bgColor);
        break;

      case 'fog':
        scene.background = new THREE.Color(state.fogColor);
        scene.fog        = new THREE.Fog(state.fogColor, state.fogNear, state.fogFar);
        break;

      case 'fogExp2':
        scene.background = new THREE.Color(state.fogColor);
        scene.fog        = new THREE.FogExp2(state.fogColor, state.fogDensity);
        break;

      case 'sky':
        scene.background = _buildSkyTexture(state.skyTop, state.skyBottom);
        break;

      case 'skybox':
        if (state.skyboxUrl) _loadSkybox(state.skyboxUrl);
        break;

      case 'none':
      default:
        scene.background = new THREE.Color(0x101018);
        break;
    }
  }

  function _buildSkyTexture(topHex, bottomHex) {
    const canvas = document.createElement('canvas');
    canvas.width  = 2;
    canvas.height = 512;
    const ctx  = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0,   topHex);
    grad.addColorStop(1,   bottomHex);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 512);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    state._skyTex = tex;
    return tex;
  }

  function _loadSkybox(url) {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      tex => {
        tex.mapping       = THREE.EquirectangularReflectionMapping;
        state._skyboxTex  = tex;
        scene.background  = tex;
      },
      undefined,
      err => { cmdUI?.update?.({ status: t('app.tjs.env.skybox_error', { error: err.message ?? err }) }); }
    );
  }

  // ── IBL (Image Based Lighting) ───────────────────────────────────────────────

  function _loadIBL(url) {
    if (!renderer || !url) return;
    cmdUI?.update?.({ status: t('app.tjs.env.ibl_loading') });
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        const pmrem  = new THREE.PMREMGenerator(renderer);
        const envMap = pmrem.fromEquirectangular(texture).texture;
        pmrem.dispose();
        texture.dispose();
        // Disponi la precedente
        if (state._iblEnvMap) state._iblEnvMap.dispose();
        state._iblEnvMap  = envMap;
        scene.environment = envMap;   // la mappa IBL prevale sull'ambiente neutro
        if (state.iblAsBackground) scene.background = envMap;
        cmdUI?.update?.({ status: t('app.tjs.env.ibl_loaded') });
        markDirty();
      },
      undefined,
      (err) => { cmdUI?.update?.({ status: t('app.tjs.env.ibl_error', { error: err?.message ?? err }) }); }
    );
  }

  function _removeIBL() {
    if (state._iblEnvMap) { state._iblEnvMap.dispose(); state._iblEnvMap = null; }
    scene.environment = state.roomEnv ? _roomEnvMap() : null;
    // Se era usata come sfondo, ripristina il colore default
    if (state.iblAsBackground) scene.background = new THREE.Color(0x101018);
    state.iblUrl         = '';
    state.iblAsBackground = false;
    markDirty();
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  function _box() {
    return modelsRoot ? tjsModelsBox(modelsRoot) : new THREE.Box3();
  }

  // Raggio e spessore GTAO iniziali sulla misura del modello (3% e 6% della diagonale)
  function _aoParams() {
    const diag = Math.max(1e-3, _box().getSize(new THREE.Vector3()).length() || 1);
    if (state.aoRadius == null)    state.aoRadius    = Number((diag * 0.03).toPrecision(2));
    if (state.aoThickness == null) state.aoThickness = Number((diag * 0.06).toPrecision(2));
    return {
      radius:    state.aoRadius,
      thickness: state.aoThickness,
      intensity: state.aoIntensity,
      samples:   state.aoSamples,
      debug:     state.aoDebug,
      box:       _box(),
    };
  }

  function _applyRendering() {
    if (!renderer) return;
    renderer.toneMapping         = TONE_MAPPING[state.toneMapping] ?? 4;
    renderer.toneMappingExposure = state.exposure;
    renderer.shadowMap.enabled   = state.shadowEnabled;
    renderer.shadowMap.type      = SHADOW_TYPE[state.shadowType] ?? 1;
    renderer.shadowMap.needsUpdate = true;
    if (state.aoEnabled) enableAO?.(_aoParams());
    else                 disableAO?.();
    _applyBaseLighting();
    markDirty();
  }

  // ── Illuminazione di base ───────────────────────────────────────────────────

  function _roomEnvMap() {
    if (!state._roomEnvMap && renderer) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      state._roomEnvMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    return state._roomEnvMap;
  }

  function _applyBaseLighting() {
    const { ambient, sun } = getBaseLights?.() ?? {};
    const box = _box();
    if (ambient) ambient.intensity = state.ambientIntensity;
    if (sun) {
      sun.visible   = state.sunEnabled;
      sun.intensity = state.sunIntensity;
      sun.color.set(state.sunColor);
      tjsPlaceSun(sun, box, state.sunAzimuth, state.sunElevation);
      sun.castShadow = state.sunEnabled && state.sunShadow;
      if (sun.castShadow) {
        // anche alla riapertura di un modello salvato con l'ombra: senza oggetti che proiettano
        // l'ombra non si vedrebbe
        if (modelsRoot) tjsEnsureShadowCasters(modelsRoot);
        tjsFitShadow(sun, box);
      }
    }
    // ambiente neutro solo se non c'è una mappa IBL caricata
    if (!state._iblEnvMap) scene.environment = state.roomEnv ? _roomEnvMap() : null;
    scene.environmentIntensity = state.envIntensity;
    // pavimento per le ombre
    if (state.shadowGround) {
      if (!state._ground) { state._ground = tjsCreateShadowGround(); scene.add(state._ground); }
      state._ground.visible = true;
      tjsUpdateShadowGround(state._ground, box);
    } else if (state._ground) {
      state._ground.visible = false;
    }
    markDirty();
  }

  /** Il modello o una luce si sono mossi: ombra del sole e pavimento riadattati. */
  function refitShadows() {
    const { sun } = getBaseLights?.() ?? {};
    const box = _box();
    if (sun?.castShadow) tjsFitShadow(sun, box);
    if (state.shadowGround && state._ground) tjsUpdateShadowGround(state._ground, box);
  }

  // ── Punti e linee (default globali) ─────────────────────────────────────────

  function _applyPointsLines() {
    scene.traverse((obj) => {
      if (obj.userData?.__pointsLineStyleOverride) return;   // override per-modello: non toccare
      if (obj.isPoints && obj.material) {
        obj.material.size            = state.pointSize;
        obj.material.sizeAttenuation = state.pointSizeAttenuation;
        applyPointShape(obj.material, state.pointShape);
      } else if (obj.isLine && obj.material && 'linewidth' in obj.material) {
        obj.material.linewidth = state.lineWidth;
        obj.material.needsUpdate = true;
      }
    });
    markDirty();
  }

  // ── Filtro selezione ────────────────────────────────────────────────────────

  function _applySelFilter() {
    const blocked = new Set();
    if (!state.selFilterMesh)   blocked.add('Mesh');
    if (!state.selFilterLine)   blocked.add('Line');
    if (!state.selFilterPoints) blocked.add('Points');
    if (!state.selFilterGroup)  blocked.add('Group');
    scene.userData.__tjs_selFilter__ = { blocked };
  }

  // ── Salvataggio ─────────────────────────────────────────────────────────────

  function _buildEnvSpec() {
    return {
      grid: {
        visible:     state.gridVisible,
        size:        state.gridSize,
        divisions:   state.gridDivisions,
        colorCenter: state.gridColorCenter,
        colorGrid:   state.gridColorGrid,
      },
      atmosphere: {
        type:       state.atmoType,
        bgColor:    state.bgColor,
        fogColor:   state.fogColor,
        fogNear:    state.fogNear,
        fogFar:     state.fogFar,
        fogDensity: state.fogDensity,
        skyTop:     state.skyTop,
        skyBottom:  state.skyBottom,
        skyboxUrl:  state.skyboxUrl,
      },
      selFilter: {
        Mesh:   state.selFilterMesh,
        Line:   state.selFilterLine,
        Points: state.selFilterPoints,
        Group:  state.selFilterGroup,
      },
      pointsLines: {
        pointSize:            state.pointSize,
        pointSizeAttenuation: state.pointSizeAttenuation,
        pointShape:           state.pointShape,
        lineWidth:            state.lineWidth,
      },
      rendering: {
        toneMapping:    state.toneMapping,
        exposure:       state.exposure,
        shadowEnabled:  state.shadowEnabled,
        shadowType:     state.shadowType,
        aoEnabled:      state.aoEnabled,
        aoIntensity:    state.aoIntensity,
        aoRadius:       state.aoRadius,
        aoThickness:    state.aoThickness,
        aoSamples:      state.aoSamples,
        aoDebug:        state.aoDebug,
        iblUrl:         state.iblUrl,
        iblAsBackground: state.iblAsBackground,
      },
      baseLight: {
        ambientIntensity: state.ambientIntensity,
        sunEnabled:       state.sunEnabled,
        sunIntensity:     state.sunIntensity,
        sunColor:         state.sunColor,
        sunAzimuth:       state.sunAzimuth,
        sunElevation:     state.sunElevation,
        sunShadow:        state.sunShadow,
        shadowGround:     state.shadowGround,
        roomEnv:          state.roomEnv,
        envIntensity:     state.envIntensity,
      },
      ...(clay ? { clay: clay.toSpec() } : {}),
    };
  }

  async function save() {
    if (state.modelId == null) { cmdUI?.update?.({ status: t('app.tjs.env.select_model.@') }); return; }
    const modArr = Array.isArray(models) ? models : [];
    const row    = modArr.find(r => String(r.mod_id) === String(state.modelId));
    if (!row)    { cmdUI?.update?.({ status: t('app.tjs.model_not_found.@') }); return; }

    const spec             = { ...(_parseSpec(row.mod_spec) ?? {}) };
    spec.environment       = _buildEnvSpec();

    try {
      cmdUI?.update?.({ status: t('app.tjs.env.saving') });
      const res  = await fetch('api/mod_spec_tool.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', mod_id: row.mod_id, mod_spec: spec }),
      });
      const data = await res.json();
      if (data.ok) { row.mod_spec = spec; cmdUI?.update?.({ status: t('app.tjs.env.saved') }); }
      else          cmdUI?.update?.({ status: t('app.tjs.error_detail', { error: data.error }) });
    } catch { cmdUI?.update?.({ status: t('errors.network') }); }
  }

  // ── Costruzione pannello ────────────────────────────────────────────────────

  function _buildPanel() {
    const el = document.createElement('div');
    el.className = 'tjs-rpanel-item';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'tjs-rpanel-hdr';
    const title = document.createElement('span');
    title.className = 'tjs-rpanel-hdr-title';
    title.textContent = t('app.tjs.env.title');
    hdr.appendChild(title);
    const hdrBtns = document.createElement('div');
    hdrBtns.className = 'tjs-rpanel-hdr-btns';
    if (_canSave(mountTarget)) hdrBtns.appendChild(_hdrBtn('bi-floppy',  t('app.tjs.env.save_settings'), () => save()));
    hdrBtns.appendChild(_hdrBtn('bi-x-lg',    t('common.close'),            () => hide()));
    hdr.appendChild(hdrBtns);
    el.appendChild(hdr);

    // Scrollable area
    const scroll = document.createElement('div');
    scroll.style.cssText = 'overflow-y:auto;flex:1';
    el._scroll = scroll;
    el.appendChild(scroll);

    _rebuildContent(scroll);
    return el;
  }

  function _rebuildContent(scroll) {
    scroll.innerHTML = '';

    // ── Griglia ──────────────────────────────────────────────────────────────
    const gridGroup = _group(t('app.tjs.env.grid'), 'bi-grid-3x3');
    scroll.appendChild(gridGroup);

    _addFieldRow(gridGroup, t('app.tjs.env.visible'), _checkbox(state.gridVisible, v => {
      state.gridVisible = v; _applyGrid();
    }));

    _addFieldRow(gridGroup, t('app.tjs.env.size'), _numInput(state.gridSize, 10, v => {
      state.gridSize = v; _applyGrid();
    }));

    _addFieldRow(gridGroup, t('app.tjs.env.divisions'), _numInput(state.gridDivisions, 1, v => {
      state.gridDivisions = Math.max(1, Math.round(v)); _applyGrid();
    }));

    _addFieldRow(gridGroup, t('app.tjs.env.axes_color'), _colorInput(state.gridColorCenter, v => {
      state.gridColorCenter = v; _applyGrid();
    }));

    _addFieldRow(gridGroup, t('app.tjs.env.grid_color'), _colorInput(state.gridColorGrid, v => {
      state.gridColorGrid = v; _applyGrid();
    }));

    // ── Atmosfera ─────────────────────────────────────────────────────────────
    const atmoGroup = _group(t('app.tjs.env.atmosphere'), 'bi-cloud-sun');
    scroll.appendChild(atmoGroup);

    // Tipo atmosfera (radio-like via select)
    const atmoSel = document.createElement('select');
    atmoSel.className = 'tjs-rpanel-select';
    atmoSel.style.cssText = 'width:100%;margin-bottom:8px';
    atmoSel.setAttribute('aria-label', t('app.tjs.env.atmosphere'));
    for (const at of ATMO_TYPES) {
      const opt = document.createElement('option');
      opt.value = at.type;
      opt.textContent = at.label;
      if (at.type === state.atmoType) opt.selected = true;
      atmoSel.appendChild(opt);
    }
    atmoSel.onchange = () => {
      state.atmoType = atmoSel.value;
      _applyAtmosphere();
      _rebuildContent(scroll);   // ricostruisce il pannello per mostrare i campi corretti
    };
    atmoGroup.appendChild(atmoSel);

    // Campi specifici per tipo
    const atmo = state.atmoType;

    if (atmo === 'color') {
      _addFieldRow(atmoGroup, t('app.tjs.env.bg_color'), _colorInput(state.bgColor, v => {
        state.bgColor = v; scene.background = new THREE.Color(v);
      }));
    }

    if (atmo === 'fog' || atmo === 'fogExp2') {
      _addFieldRow(atmoGroup, t('app.tjs.env.fog_color'), _colorInput(state.fogColor, v => {
        state.fogColor = v; _applyAtmosphere();
      }));
    }

    if (atmo === 'fog') {
      _addFieldRow(atmoGroup, 'Near', _numInput(state.fogNear, 1, v => {
        state.fogNear = v; if (scene.fog) { scene.fog.near = v; }
      }));
      _addFieldRow(atmoGroup, 'Far', _numInput(state.fogFar, 10, v => {
        state.fogFar = v; if (scene.fog) { scene.fog.far = v; }
      }));
    }

    if (atmo === 'fogExp2') {
      _addFieldRow(atmoGroup, t('app.tjs.env.density'), _numInput(state.fogDensity, 0.001, v => {
        state.fogDensity = v; if (scene.fog) { scene.fog.density = v; }
      }));
    }

    if (atmo === 'sky') {
      _addFieldRow(atmoGroup, t('app.tjs.env.sky_color'), _colorInput(state.skyTop, v => {
        state.skyTop = v; _applyAtmosphere();
      }));
      _addFieldRow(atmoGroup, t('app.tjs.env.horizon'), _colorInput(state.skyBottom, v => {
        state.skyBottom = v; _applyAtmosphere();
      }));
    }

    if (atmo === 'skybox') {
      _addFieldRow(atmoGroup, 'URL', _textInput(state.skyboxUrl, v => {
        state.skyboxUrl = v;
      }));
      const btnLoad = document.createElement('button');
      btnLoad.className = 'tjs-rpanel-addbar-btn';
      btnLoad.style.cssText = 'margin-top:4px;width:100%;justify-content:center';
      btnLoad.innerHTML = '<i class="bi bi-cloud-download" style="margin-right:4px" aria-hidden="true"></i>';
      btnLoad.appendChild(document.createTextNode(t('app.tjs.env.load_skybox')));
      btnLoad.onclick = () => { if (state.skyboxUrl) _loadSkybox(state.skyboxUrl); };
      atmoGroup.appendChild(btnLoad);
    }

    // ── Illuminazione di base ─────────────────────────────────────────────────
    const baseGroup = _group(t('app.tjs.env.base_light'), 'bi-brightness-high');
    scroll.appendChild(baseGroup);

    _addFieldRow(baseGroup, t('app.tjs.env.ambient_intensity'), _numInput(state.ambientIntensity, 0.05, v => {
      state.ambientIntensity = Math.max(0, v); _applyBaseLighting();
    }));
    _addFieldRow(baseGroup, t('app.tjs.env.sun'), _checkbox(state.sunEnabled, v => {
      state.sunEnabled = v; _applyBaseLighting(); _rebuildContent(scroll);
    }));
    if (state.sunEnabled) {
      _addFieldRow(baseGroup, t('app.tjs.env.sun_intensity'), _numInput(state.sunIntensity, 0.05, v => {
        state.sunIntensity = Math.max(0, v); _applyBaseLighting();
      }));
      _addFieldRow(baseGroup, t('app.tjs.env.sun_color'), _colorInput(state.sunColor, v => {
        state.sunColor = v; _applyBaseLighting();
      }));
      _addFieldRow(baseGroup, t('app.tjs.env.sun_azimuth'), _rangeNum(state.sunAzimuth, 0, 360, 1, v => {
        state.sunAzimuth = v; _applyBaseLighting();
      }));
      _addFieldRow(baseGroup, t('app.tjs.env.sun_elevation'), _rangeNum(state.sunElevation, -10, 90, 1, v => {
        state.sunElevation = v; _applyBaseLighting();
      }));
      _addFieldRow(baseGroup, t('app.tjs.env.sun_shadow'), _checkbox(state.sunShadow, v => {
        state.sunShadow = v;
        if (v && modelsRoot) {
          const n = tjsEnsureShadowCasters(modelsRoot);
          if (n) cmdUI?.update?.({ status: t('app.tjs.light.casters_on', { n }) });
        }
        _applyBaseLighting();
      }));
    }
    _addFieldRow(baseGroup, t('app.tjs.env.shadow_ground'), _checkbox(state.shadowGround, v => {
      state.shadowGround = v; _applyBaseLighting();
    }));
    _addFieldRow(baseGroup, t('app.tjs.env.room_env'), _checkbox(state.roomEnv, v => {
      state.roomEnv = v; _applyBaseLighting(); _rebuildContent(scroll);
    }));
    if (state.roomEnv || state._iblEnvMap) {
      _addFieldRow(baseGroup, t('app.tjs.env.env_intensity'), _numInput(state.envIntensity, 0.05, v => {
        state.envIntensity = Math.max(0, v); _applyBaseLighting();
      }));
    }
    const baseNote = document.createElement('div');
    baseNote.style.cssText = 'font-size:10px;color:#99a;margin:4px 2px 2px';
    baseNote.textContent = t('app.tjs.env.base_light_note');
    baseGroup.appendChild(baseNote);

    // ── Clay ──────────────────────────────────────────────────────────────────
    if (clay) {
      const cp = clay.getParams();
      const clayGroup = _group(t('app.tjs.env.clay'), 'bi-circle-half');
      scroll.appendChild(clayGroup);
      _addFieldRow(clayGroup, t('app.tjs.env.clay_on'), _checkbox(cp.enabled, v => { clay.setEnabled(v); }));
      _addFieldRow(clayGroup, t('app.tjs.env.clay_transparent'), _checkbox(cp.includeTransparent, v => { clay.setIncludeTransparent(v); }));
      _addFieldRow(clayGroup, t('app.tjs.env.clay_color'), _colorInput(cp.color, v => { clay.setParams({ color: v }); }));
      _addFieldRow(clayGroup, t('app.tjs.env.clay_roughness'), _rangeNum(cp.roughness, 0, 1, 0.05, v => { clay.setParams({ roughness: v }); }));
      _addFieldRow(clayGroup, t('app.tjs.env.clay_clearcoat'), _rangeNum(cp.clearcoat, 0, 1, 0.05, v => { clay.setParams({ clearcoat: v }); }));
      _addFieldRow(clayGroup, t('app.tjs.env.clay_clearcoat_roughness'), _rangeNum(cp.clearcoatRoughness, 0, 1, 0.05, v => { clay.setParams({ clearcoatRoughness: v }); }));
      _addFieldRow(clayGroup, t('app.tjs.env.clay_env'), _numInput(cp.envIntensity, 0.05, v => { clay.setParams({ envIntensity: Math.max(0, v) }); }));
      const clayNote = document.createElement('div');
      clayNote.style.cssText = 'font-size:10px;color:#99a;margin:4px 2px 2px';
      clayNote.textContent = t('app.tjs.env.clay_note');
      clayGroup.appendChild(clayNote);
    }

    // ── Rendering ─────────────────────────────────────────────────────────────
    const renderGroup = _group('Rendering', 'bi-display');
    scroll.appendChild(renderGroup);

    _addFieldRow(renderGroup, 'Tone Mapping', _selectInput(Object.keys(TONE_MAPPING), state.toneMapping, v => {
      state.toneMapping = v;
      if (renderer) { renderer.toneMapping = TONE_MAPPING[v] ?? 4; }
    }));

    _addFieldRow(renderGroup, 'Exposure', _numInput(state.exposure, 0.05, v => {
      state.exposure = Math.max(0, v);
      if (renderer) renderer.toneMappingExposure = state.exposure;
    }));

    _addFieldRow(renderGroup, t('app.tjs.env.shadows'), _checkbox(state.shadowEnabled, v => {
      state.shadowEnabled = v;
      if (renderer) { renderer.shadowMap.enabled = v; renderer.shadowMap.needsUpdate = true; }
    }));

    _addFieldRow(renderGroup, t('app.tjs.env.shadow_type'), _selectInput(Object.keys(SHADOW_TYPE), state.shadowType, v => {
      state.shadowType = v;
      if (renderer) { renderer.shadowMap.type = SHADOW_TYPE[v] ?? 1; renderer.shadowMap.needsUpdate = true; }
    }));

    const aoNote = document.createElement('div');
    aoNote.style.cssText = 'font-size:10px;color:#99a;margin:4px 2px 2px';
    aoNote.textContent = t('app.tjs.env.ao_note');
    renderGroup.appendChild(aoNote);

    _addFieldRow(renderGroup, t('app.tjs.env.ao'), _checkbox(state.aoEnabled, v => {
      state.aoEnabled = v;
      if (v) enableAO?.(_aoParams());
      else   disableAO?.();
      _rebuildContent(scroll);   // mostra/nasconde parametri (raggio/spessore iniziali calcolati ora)
    }));

    if (state.aoEnabled) {
      _addFieldRow(renderGroup, t('app.tjs.env.ao_only'), _checkbox(state.aoDebug, v => {
        state.aoDebug = v; updateAO?.({ debug: v });
      }));
      _addFieldRow(renderGroup, t('app.tjs.env.ao_intensity'), _rangeNum(state.aoIntensity, 0, 1, 0.05, v => {
        state.aoIntensity = v; updateAO?.({ intensity: v });
      }));
      _addFieldRow(renderGroup, t('app.tjs.env.ao_radius'), _numInput(state.aoRadius, Number((state.aoRadius / 10).toPrecision(1)) || 0.01, v => {
        state.aoRadius = Math.max(1e-4, v); updateAO?.({ radius: state.aoRadius });
      }));
      _addFieldRow(renderGroup, t('app.tjs.env.ao_thickness'), _numInput(state.aoThickness, Number((state.aoThickness / 10).toPrecision(1)) || 0.01, v => {
        state.aoThickness = Math.max(1e-4, v); updateAO?.({ thickness: state.aoThickness });
      }));
      _addFieldRow(renderGroup, t('app.tjs.env.samples'), _selectInput(['8', '16', '32'], String(state.aoSamples), v => {
        state.aoSamples = parseInt(v, 10); updateAO?.({ samples: state.aoSamples });
      }));
      const btnAuto = document.createElement('button');
      btnAuto.className = 'tjs-rpanel-addbar-btn';
      btnAuto.style.cssText = 'width:100%;justify-content:center;margin-top:2px';
      btnAuto.innerHTML = '<i class="bi bi-bounding-box" style="margin-right:4px" aria-hidden="true"></i>';
      btnAuto.appendChild(document.createTextNode(t('app.tjs.env.ao_auto')));
      btnAuto.onclick = () => {
        state.aoRadius = null; state.aoThickness = null;
        enableAO?.(_aoParams());
        _rebuildContent(scroll);
      };
      renderGroup.appendChild(btnAuto);
    }

    // ── IBL ───────────────────────────────────────────────────────────────────
    const iblGroup = _group(t('app.tjs.env.ibl_group'), 'bi-stars');
    scroll.appendChild(iblGroup);

    const iblNote = document.createElement('div');
    iblNote.style.cssText = 'font-size:10px;color:#667;margin-bottom:6px;padding:0 2px';
    iblNote.textContent = t('app.tjs.env.ibl_note');
    iblGroup.appendChild(iblNote);

    _addFieldRow(iblGroup, 'URL', _textInput(state.iblUrl, v => { state.iblUrl = v; }));

    _addFieldRow(iblGroup, t('app.tjs.env.use_as_bg'), _checkbox(state.iblAsBackground, v => {
      state.iblAsBackground = v;
      if (state._iblEnvMap) {
        scene.background = v ? state._iblEnvMap : new THREE.Color(0x101018);
      }
    }));

    const iblBtns = document.createElement('div');
    iblBtns.style.cssText = 'display:flex;gap:6px;margin-top:4px';
    const btnLoadIbl = document.createElement('button');
    btnLoadIbl.className = 'tjs-rpanel-addbar-btn';
    btnLoadIbl.style.cssText = 'flex:1;justify-content:center';
    btnLoadIbl.innerHTML = '<i class="bi bi-cloud-download" style="margin-right:4px" aria-hidden="true"></i>';
    btnLoadIbl.appendChild(document.createTextNode(t('app.tjs.env.load')));
    btnLoadIbl.onclick = () => { if (state.iblUrl) _loadIBL(state.iblUrl); };
    const btnRemoveIbl = document.createElement('button');
    btnRemoveIbl.className = 'tjs-rpanel-addbar-btn';
    btnRemoveIbl.style.cssText = 'flex:1;justify-content:center';
    btnRemoveIbl.innerHTML = '<i class="bi bi-x-circle" style="margin-right:4px;color:#f66" aria-hidden="true"></i>';
    btnRemoveIbl.appendChild(document.createTextNode(t('common.remove')));
    btnRemoveIbl.onclick = () => { _removeIBL(); _rebuildContent(scroll); };
    iblBtns.appendChild(btnLoadIbl);
    iblBtns.appendChild(btnRemoveIbl);
    iblGroup.appendChild(iblBtns);

    // ── Filtro selezione ─────────────────────────────────────────────────────
    const selGroup = _group(t('app.tjs.env.sel_filter'), 'bi-cursor');
    scroll.appendChild(selGroup);

    const selTypes = [
      { key: 'selFilterMesh',   label: 'Mesh' },
      { key: 'selFilterLine',   label: t('app.tjs.env.lines') },
      { key: 'selFilterPoints', label: t('app.tjs.env.points') },
      { key: 'selFilterGroup',  label: t('app.tjs.env.groups') },
    ];
    for (const { key, label } of selTypes) {
      _addFieldRow(selGroup, label, _checkbox(state[key], v => {
        state[key] = v;
        _applySelFilter();
      }));
    }

    // ── Punti e linee (default globali) ──────────────────────────────────────
    const plGroup = _group(t('app.tjs.env.points_lines'), 'bi-braces-asterisk');
    scroll.appendChild(plGroup);

    const plNote = document.createElement('div');
    plNote.style.cssText = 'font-size:10px;color:#667;margin-bottom:6px;padding:0 2px';
    plNote.textContent = t('app.tjs.env.points_lines_note.@');
    plGroup.appendChild(plNote);

    _addFieldRow(plGroup, t('app.tjs.env.point_size'), _numInput(state.pointSize, 0.001, v => {
      state.pointSize = Math.max(0.0001, v); _applyPointsLines();
    }));

    _addFieldRow(plGroup, t('app.tjs.attenuation'), _checkbox(state.pointSizeAttenuation, v => {
      state.pointSizeAttenuation = v; _applyPointsLines();
    }));

    const shapeSel = document.createElement('select');
    shapeSel.className = 'tjs-rpanel-select';
    const shapeOpts = [{ v: 'square', label: t('app.tjs.shape.square') }, { v: 'round', label: t('app.tjs.shape.round') }];
    for (const o of shapeOpts) {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.label;
      if (o.v === state.pointShape) opt.selected = true;
      shapeSel.appendChild(opt);
    }
    shapeSel.onchange = () => { state.pointShape = shapeSel.value; _applyPointsLines(); };
    _addFieldRow(plGroup, t('app.tjs.env.point_shape'), shapeSel);

    _addFieldRow(plGroup, t('app.tjs.env.line_width'), _numInput(state.lineWidth, 0.5, v => {
      state.lineWidth = Math.max(0.1, v); _applyPointsLines();
    }));

    const lineNote = document.createElement('div');
    lineNote.style.cssText = 'font-size:10px;color:#667;padding:0 2px 4px';
    lineNote.textContent = t('app.tjs.env.line_note');
    plGroup.appendChild(lineNote);

    // ── Modello e salvataggio (solo da autore in su, §5) ─────────────────────
    if (!_canSave(mountTarget)) return;
    const saveGroup = _group(t('app.tjs.env.save_group'), 'bi-floppy');
    scroll.appendChild(saveGroup);

    const modArr = Array.isArray(models) ? models : [];
    if (modArr.length > 1) {
      const modSel = document.createElement('select');
      modSel.className = 'tjs-rpanel-select';
      modSel.style.cssText = 'width:100%;margin-bottom:8px';
      for (const row of modArr) {
        const opt = document.createElement('option');
        opt.value = row.mod_id;
        opt.textContent = row.mod_name ?? t('app.tjs.model_fallback.@', { id: row.mod_id });
        if (String(row.mod_id) === String(state.modelId)) opt.selected = true;
        modSel.appendChild(opt);
      }
      modSel.onchange = () => { state.modelId = parseInt(modSel.value); };
      _addFieldRow(saveGroup, t('app.tjs.env.model.@'), modSel);
    } else if (modArr.length === 1) {
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:11px;color:#889';
      lbl.textContent = modArr[0].mod_name ?? t('app.tjs.model_fallback.@', { id: modArr[0].mod_id });
      _addFieldRow(saveGroup, t('app.tjs.env.model.@'), lbl);
    }

    const btnSave = document.createElement('button');
    btnSave.className = 'tjs-rpanel-addbar-btn';
    btnSave.style.cssText = 'width:100%;justify-content:center';
    btnSave.innerHTML = '<i class="bi bi-floppy" style="margin-right:4px;color:#6af" aria-hidden="true"></i>';
    btnSave.appendChild(document.createTextNode(t('app.tjs.env.save_env')));
    btnSave.onclick = () => save();
    saveGroup.appendChild(btnSave);
  }

  // ── Helpers UI ───────────────────────────────────────────────────────────────

  function _group(label, icon) {
    const g = document.createElement('div');
    g.className = 'tjs-rpanel-group';
    const ttl = document.createElement('div');
    ttl.className = 'tjs-rpanel-group-title';
    ttl.innerHTML = `<i class="bi ${icon}" style="margin-right:4px" aria-hidden="true"></i>`;
    ttl.appendChild(document.createTextNode(label));
    g.appendChild(ttl);
    return g;
  }

  function _addFieldRow(container, label, ctrl) {
    const row = document.createElement('div');
    row.className = 'tjs-rpanel-field-row';
    const lbl = document.createElement('span');
    lbl.className   = 'tjs-rpanel-field-lbl';
    lbl.textContent = label;
    row.appendChild(lbl);
    // Accessibilità: l'etichetta è uno <span>, il nome del campo passa da aria-label
    if (ctrl instanceof HTMLElement && ctrl.matches('input,select') && !ctrl.hasAttribute('aria-label')) ctrl.setAttribute('aria-label', label);
    // controlli composti (cursore + valore): stesso nome su ogni campo
    if (ctrl instanceof HTMLElement && !ctrl.matches('input,select')) {
      ctrl.querySelectorAll('input,select').forEach(f => { if (!f.hasAttribute('aria-label')) f.setAttribute('aria-label', label); });
    }
    if (ctrl instanceof HTMLElement) row.appendChild(ctrl);
    container.appendChild(row);
  }

  function _hdrBtn(icon, title, onclick) {
    const b = document.createElement('button');
    b.className = 'tjs-rpanel-hdr-btn';
    b.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
    b.title   = title;
    b.setAttribute('aria-label', title);
    b.onclick = onclick;
    return b;
  }

  function _numInput(val, step, onChange) {
    const inp = document.createElement('input');
    inp.type  = 'number';
    inp.className = 'tjs-rpanel-num-input';
    inp.step  = String(step);
    inp.value = String(Math.round(val * 10000) / 10000);
    inp.onchange = () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) onChange(v); };
    return inp;
  }

  // Cursore + valore numerico sincronizzati (azimut, elevazione, intensità AO)
  function _rangeNum(val, min, max, step, onChange) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;min-width:0';
    const rng = document.createElement('input');
    rng.type = 'range'; rng.min = String(min); rng.max = String(max); rng.step = String(step);
    rng.value = String(val);
    rng.style.cssText = 'flex:1;min-width:0;cursor:pointer;accent-color:#4af';
    const num = _numInput(val, step, v => {
      const c = Math.min(max, Math.max(min, v));
      rng.value = String(c); onChange(c);
    });
    num.style.width = '56px';
    rng.oninput = () => { const v = parseFloat(rng.value); num.value = String(v); onChange(v); };
    wrap.appendChild(rng);
    wrap.appendChild(num);
    return wrap;
  }

  function _colorInput(hex, onChange) {
    const inp = document.createElement('input');
    inp.type  = 'color';
    inp.className = 'tjs-rpanel-color-input';
    inp.value = hex;
    inp.oninput = () => onChange(inp.value);
    return inp;
  }

  function _textInput(val, onChange) {
    const inp = document.createElement('input');
    inp.type  = 'text';
    inp.className = 'tjs-rpanel-num-input';
    inp.style.width = '100%';
    inp.value = val;
    inp.placeholder = t('app.tjs.env.url_placeholder');
    inp.onchange = () => onChange(inp.value.trim());
    return inp;
  }

  function _checkbox(checked, onChange) {
    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.className = 'tjs-rpanel-checkbox';
    cb.checked = !!checked;
    cb.onchange = () => onChange(cb.checked);
    return cb;
  }

  function _selectInput(options, current, onChange) {
    const sel = document.createElement('select');
    sel.className = 'tjs-rpanel-select';
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => onChange(sel.value);
    return sel;
  }

  // ── API pubblica ─────────────────────────────────────────────────────────────

  function show() {
    if (!panelEl) { panelEl = _buildPanel(); mountTarget.appendChild(panelEl); }
    panelEl.style.display = 'flex';
    visible = true;
  }

  function hide() {
    if (panelEl) panelEl.style.display = 'none';
    visible = false;
  }

  function toggle() { if (visible) hide(); else show(); }

  function dispose() {
    state._skyboxTex?.dispose?.();
    state._skyTex?.dispose?.();
    state._iblEnvMap?.dispose?.();
    state._roomEnvMap?.dispose?.();
    if (state._ground) {
      state._ground.removeFromParent();
      state._ground.geometry.dispose();
      state._ground.material.dispose();
      state._ground = null;
    }
    panelEl?.remove();
    panelEl = null;
    visible = false;
  }

  if (signal) signal.addEventListener('abort', dispose, { once: true });
  _init();

  return { show, hide, toggle, dispose, isVisible: () => visible, save, refitShadows,
           /** parametri GTAO correnti (model_TJS ricrea il pass se cambia la camera) */
           aoParams: () => (state.aoEnabled ? _aoParams() : null) };
}
