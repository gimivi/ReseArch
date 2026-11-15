// HYS_sub_modules/HYS_object.mjs
//
// Oggetti HySpace della stanza centrale, definiti via codice (non dai modelli
// delle stanze). Ricostruiti dai file della versione VRML (_doc/Old_HS/Wrl/):
//
//   Porte             SD01_Door.wrl + CristalloGrigio (EP00_Materiali.wrl)   → geometria in codice
//   Tasti scala       Tasto_UP.wrl                                            → HYS_Tasto_UP.glb (esterno)
//   Spot              Spot.wrl + SpotLight di HS2013.wrl                      → HYS_Spot.glb (esterno)
//   Box pedana        BOX.wrl (materiale) + logica GMVInLine                  → in codice (HYS_createExhibit)
//   Tasti scala/ruota AM_Scala_B/M.wrl, AM_Ruota_B/M.wrl                      → in codice
//
// Direzioni ASSOLUTE (assi del mondo, non dell'osservatore): F=-z, B=+z, L=-x, R=+x.

import { THREE } from "../TJS_sub_modules/TJS-loaders.mjs";
import { t } from "../shared/i18n.mjs";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const SPOT_GLB = new URL("./HYS_Spot.glb", import.meta.url).href;
const TASTO_UP_GLB = new URL("./HYS_Tasto_UP.glb", import.meta.url).href;
// texture di riflesso originale delle porte (CristalloGrigio + TextureCoordGen
// CAMERASPACEREFLECTIONVECTOR); se manca si usa l'environment RoomEnvironment
const DOOR_REFLECTION_JPG = new URL("./HYS_FakeReflection.jpg", import.meta.url).href;


// ═════════════════════════════════════════════════════════════════════════════
// STILI (tutto ciò che si vede/muove sta qui)
// ═════════════════════════════════════════════════════════════════════════════

/** Porte scorrevoli (SlidingDoors del VRML). */
export const HYS_DOOR_STYLE = {
  // Geometria di SD01_Door.wrl (metri, spazio locale porta; +z guarda il centro stanza).
  // Anta principale: trapezio col lato interno obliquo; la gemella è la stessa
  // ruotata di 180° attorno a z e arretrata di 0.3 (le due scorrono su piani sfalsati).
  leafShape: [[0.204164, 0.2], [1, 0.2], [1, 3.65], [-0.404164, 3.65]],
  // Piani delle ante a 5 cm dalla soglia (z = 0 locale = ±5 m), simmetrici:
  // principale 0,05–0,10 verso la stanza, gemella 0,05–0,10 oltre la soglia
  // (nel VRML erano 0,20–0,25 e −0,10…−0,05, con twinDz −0,30).
  leafZ: [0.05, 0.10],        // spessore anta principale
  twinDz: -0.15,              // arretramento della gemella
  refWidth: 2.0,              // luce del varco del modello originale
  refHeight: 3.65,
  // Dimensioni reali: mod_spec.hys.door { width, height, distance } della stanza centrale le sovrascrive
  width: 2.0,
  height: 3.65,
  distance: 5.0,

  // movimento (PositionInterpolator del VRML: ±2 m in ctime=2 s)
  slide: 2.0,                 // corsa di ciascuna anta, in unità del modello (scala con width)
  openTime: 2.0,
  sensorSize: 3.0,            // ProximitySensor size 3 3 3, center 0 1.7 0
  sensorCenterY: 1.7,

  // materiale CristalloGrigio: diffuse .5 .5 .8, specular 1 1 1, shininess .2, transparency .8
  glassColor: 0x8080cc,
  glassOpacity: 0.2,          // opacità 0,2 (trasparenza 80%)
  glassRoughness: 0.08,
  glassEnvIntensity: 1.2,
  lockedColor: 0x50505a,      // porta bloccata (nessun vicino): vetro più scuro e opaco
  lockedOpacity: 0.2,         // anche le porte bloccate (si distinguono per il colore)
  // riflesso: "matcap" = HYS_FakeReflection.jpg letta in base alla direzione di vista,
  // come TextureCoordGen CAMERASPACEREFLECTIONVECTOR del VRML (configurazione originale);
  // "env" = vetro fisico con environment RoomEnvironment
  reflection: "matcap",
  matcapOpacity: 0.2,         // stessa opacità anche con il riflesso originale (matcap)

  // scritte — Text di SlidingDoors (HS2013.wrl): Transform { translation 0 2.2 .21
  // rotation 0 0 1 -1.4 }, FontStyle { family ARIAL, style PLAIN, justify MIDDLE,
  // size 0.15 (titolo) / 0.2 (autore) }, bianco, una riga. La rotazione di -1.4 rad
  // porta la riga lungo il lato obliquo dell'anta (10° dalla verticale), letta
  // dall'alto in basso; la gemella (ruotata di 180°) legge dal basso in alto.
  labelColor: "#ffffff",
  labelColorLocked: "#b8bac2",
  labelFont: "Arial, Helvetica, sans-serif",
  labelWeight: "normal",
  labelPxPerM: 512,           // risoluzione della texture delle scritte
  label: {                    // ancoraggio (centro della linea di base), spazio locale porta
    // z: dentro lo spessore del vetro (leafZ[0] + 0,01; la gemella + twinDz)
    title:  { x: 0, y: 2.20,        z: 0.06,        rot: -1.4,           size: 0.10, maxLength: 3.2 },
    author: { x: 0, y: 3.65 - 2.20, z: 0.06 - 0.15, rot: -1.4 + Math.PI, size: 0.15, maxLength: 3.2 },
  },
  lockedTitle: null,          // null = testo dell'interfaccia (app.hys.door.locked)
  lockedAuthor: "—",
};

/** Oggetti fissi della stanza centrale: spot e tasti scala (posizioni dal VRML). */
export const HYS_FIXTURE_STYLE = {
  spot: {
    position: [0, 3, 2.3],    // SpotTransf
    scale: 0.3,               // SpotInLineT
    tiltX: -0.9,              // orientamento della camera d'ombra: punta sulla pedana
    color: 0xffd9bf,          // MyShadows2: color 1 0.848624 0.75 (luce calda)
    // Attenuazione come nel VRML (attenuation 1 0 0 = nessun calo con la distanza entro
    // radius): decay 0. Con decay 0 l'intensità non è più in candele "fisiche": 2.3 dà
    // al centro della pedana la stessa luce che dava 25 con decay 2 (25 / 3.3² ≈ 2.3).
    intensity: 2.3,
    decay: 0,
    distance: 10,             // radius 10
    angle: 0.6,               // cono allargato (VRML cutOffAngle 0.4): l'ombra cade dietro il modello
    beamWidth: 0.3,           // piena luce fino a 0.3 rad → penumbra = 1 - beamWidth/angle
    bodyColor: 0xcccccc,      // Material di default VRML (diffuse 0.8)
    shadow: {                 // MyShadows2 usava una depth map 512×512
      enabled: true,
      mapSize: 2048,
      near: 0.5,
      far: 8,
      bias: -0.0004,
      normalBias: 0.02,       // evita le "strisce" sulle ombre autoportate
      radius: 3,              // morbidezza (PCFShadowMap, morbido dalla r186)
    },
  },
  stairButtons: {
    // sulla parete frontale (F), origine sul filo destro della porta (x = 1) e a 25 cm
    // dal filo della soglia (z = -5 + 0.25), rivolti verso la stanza.
    // Nel VRML erano a (-4.7; 1.51/1.49; -1), 30 cm dalla parete sinistra.
    up:   { position: [1.0, 1.51, -4.75] },
    down: { position: [1.0, 1.49, -4.75] },  // Tasto_DW non pervenuto: Tasto_UP ruotato di 180°
    rotY: 0,
    scale: 1.5,
    colorEnabled: 0xd8d8d8,
    colorOpen: 0x4fc36b,      // scala/foro aperti
    colorDisabled: 0x55565c,  // nessuna esercitazione in quella direzione
  },
};

/** Pedana (BOX.wrl) e tasti scala/ruota (AM_*.wrl) — per il modello sulla pedana. */
export const HYS_PEDESTAL_STYLE = {
  box: {                      // myMaterial di BOX.wrl (texture basic001/woodbump non pervenute)
    color: 0x9c9600,          // diffuse .61 .59 0
    emissive: 0x171400,       // emissive .09 .08 0
    roughness: 0.75,
    metalness: 0.1,
  },
  controls: {
    scale: 0.2,               // Tasto_ILScale/ILRot: scale .2 .1 .2
    scaleY: 0.1,
    colorM: 0x5e5e5e,         // AM_*_M: diffuse .37 .37 .37
    colorB: 0x990000,         // AM_*_B: diffuse .6 0 0
    // posizioni per forma di stanza (TScalaT / TRotT del VRML, indice = Room_01…06)
    scaleButtons: [[-.2, .4, 2.35], [-.2, .4, 2.45], [-.2, .4, 2.30], [0, .4, 2.15], [-.2, .4, 2.35], [-.7, .4, 2.05]],
    rotButtons:   [[ .2, .4, 2.35], [ .2, .4, 2.45], [ .2, .4, 2.30], [0, .4, 2.45], [ .2, .4, 2.35], [-.7, .4, 2.30]],
    rotStep: 0.314,           // RotInline: ±0.314 rad
    scaleStep: [0.8, 1.2],    // ScalaInline: ×0.8 / ×1.2
  },
  anim: {
    duration: 10,             // s per un tratto di 360° (TS_Rot cycleInterval 10)
    ramp: 2,                  // s di accelerazione alla partenza e di frenata all'arrivo
  },
};

/**
 * Cicli di colore sull'emissione (ColorInterpolator + TimeSensor loop dei materiali
 * di EP00_Materiali.wrl). match = NOME DEL MATERIALE nel GLB della stanza (maiuscole
 * e separatore spazio/underscore indifferenti). Colori in sRGB come nel VRML,
 * interpolazione lineare fra le chiavi come il ColorInterpolator.
 */
export const HYS_COLOR_CYCLES = [
  { // FasciaLuceNeonVariabile: 40 s, toni pastello
    match: /^fascia[ _]luminosa/i,
    period: 40,
    keys:   [0, 0.33, 0.66, 1],
    values: [[.7, .7, .8], [.8, .7, .7], [.7, .8, .7], [.7, .7, .8]],
  },
];

/**
 * Registro dei materiali animati. register(root) li cerca in un modello di stanza
 * (i cloni condividono i materiali: ogni materiale è registrato una volta sola);
 * update(timeSec) aggiorna le emissioni, in fase per tutte le stanze.
 */
export function HYS_createColorCycles(cycles = HYS_COLOR_CYCLES) {
  const entries = new Map(); // material -> cycle
  const add = (m, c) => { if (m?.emissive && !entries.has(m)) entries.set(m, c); };

  function register(root) {
    root?.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        const c = cycles.find((cy) => cy.match.test(m?.name ?? ""));
        if (c) add(m, c);
      }
    });
  }

  function update(time) {
    for (const [m, c] of entries) {
      const f = (time % c.period) / c.period;
      let i = 0;
      while (i < c.keys.length - 2 && f > c.keys[i + 1]) i++;
      const k = (f - c.keys[i]) / ((c.keys[i + 1] - c.keys[i]) || 1);
      const a = c.values[i], b = c.values[i + 1];
      m.emissive.setRGB(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, THREE.SRGBColorSpace);
    }
  }

  return { register, update, clear: () => entries.clear(), get count() { return entries.size; } };
}

/**
 * Video proiettato sullo schermo del soffitto (Schermo_Soffitto del VRML:
 * MovieTexture "BodyStor2001.mpeg" in loop). Convertito in HYS_Schermo.mp4
 * (H.264, muto: i browser avviano da soli solo i video senza audio).
 * Il file NON è nel repository (contenuto proprio di HySpace): senza, lo schermo resta nero.
 * Lo schermo è la mesh con nome d'oggetto o di materiale "Schermo".
 */
export const HYS_SCREEN_STYLE = {
  url: new URL("./HYS_Schermo.mp4", import.meta.url).href,
  match: /^schermo/i,
  emissive: 1.0,              // lo schermo "si illumina" del proprio video
};

export function HYS_createScreenVideo(style = HYS_SCREEN_STYLE) {
  const video = document.createElement("video");
  video.src = style.url;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;

  const done = new WeakSet(); // materiali/geometrie già adattati (i cloni li condividono)

  // UV planari sull'ingombro, se la mesh non ne ha (il video va comunque steso)
  function ensureUV(geo) {
    if (done.has(geo) || geo.getAttribute("uv")) return;
    done.add(geo);
    geo.computeBoundingBox();
    const b = geo.boundingBox, size = b.getSize(new THREE.Vector3());
    const ax = ["x", "y", "z"].sort((p, q) => size[q] - size[p]); // i due assi più estesi
    const pos = geo.getAttribute("position"), uv = new Float32Array(pos.count * 2);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      uv[i * 2] = (v[ax[0]] - b.min[ax[0]]) / (size[ax[0]] || 1);
      uv[i * 2 + 1] = (v[ax[1]] - b.min[ax[1]]) / (size[ax[1]] || 1);
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  }

  function apply(root) {
    let found = 0;
    root?.traverse((o) => {
      if (!o.isMesh) return;
      const mats = [].concat(o.material);
      if (!style.match.test(o.name ?? "") && !mats.some((m) => style.match.test(m?.name ?? ""))) return;
      ensureUV(o.geometry);
      for (const m of mats) {
        if (done.has(m)) continue;
        done.add(m);
        m.map = tex;
        if (m.emissive) { m.emissive.setRGB(1, 1, 1); m.emissiveMap = tex; m.emissiveIntensity = style.emissive; }
        m.needsUpdate = true;
      }
      found++;
    });
    if (found) play();
    return found;
  }

  function play() { video.play().catch(() => { /* serve un gesto dell'utente: riprova al click */ }); }

  function dispose() {
    video.pause();
    video.removeAttribute("src");
    video.load();
    tex.dispose();
  }

  return { apply, play, dispose, video };
}


export const HYS_DOOR_DIRS = ["F", "L", "B", "R"];

const DOOR_PLACEMENT = {
  F: { ux: 0,  uz: -1, rotY: 0 },
  B: { ux: 0,  uz: 1,  rotY: Math.PI },
  L: { ux: -1, uz: 0,  rotY: Math.PI / 2 },
  R: { ux: 1,  uz: 0,  rotY: -Math.PI / 2 },
};

const OPPOSITE = { F: "B", B: "F", L: "R", R: "L" };


// ═════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT MAP (riflesso del vetro, al posto della vecchia basic035.jpg)
// ═════════════════════════════════════════════════════════════════════════════

// Una environment map per renderer: ogni pannello HySpace ha il proprio renderer
// (contesto WebGL), e una render target non si condivide fra contesti.
const _envByRenderer = new Map(); // renderer -> WebGLRenderTarget

function hsEnvMap(renderer) {
  if (!renderer) return null;
  let rt = _envByRenderer.get(renderer);
  if (!rt) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    rt = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    _envByRenderer.set(renderer, rt);
  }
  return rt.texture;
}

// Le risorse condivise fra i pannelli (vetro CristalloGrigio) vivono finché c'è
// almeno un pannello HySpace aperto: acquire all'avvio, dispose alla chiusura.
let _users = 0;

export function HYS_acquireObjectResources() {
  _users++;
}

export function HYS_disposeObjectResources(renderer = null) {
  if (renderer) {
    _envByRenderer.get(renderer)?.dispose();
    _envByRenderer.delete(renderer);
  }
  _users = Math.max(0, _users - 1);
  if (_users > 0) return;
  _sharedGlass?.matcap?.dispose();
  _sharedGlass?.dispose();
  _sharedGlass = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vetro condiviso per i modelli di stanza: un materiale chiamato "CristalloGrigio"
// (es. le scale modellate in Blender) diventa identico al vetro delle porte.
// ─────────────────────────────────────────────────────────────────────────────
export const HYS_GLASS_MATCH = /^cristallo[ _]?grigio/i;
let _sharedGlass = null;

export function HYS_sharedGlassMaterial(style = HYS_DOOR_STYLE) {
  if (_sharedGlass) return _sharedGlass;
  _sharedGlass = new THREE.MeshMatcapMaterial({
    color: style.glassColor, transparent: true, opacity: style.matcapOpacity,
    depthWrite: false, side: THREE.DoubleSide,
  });
  _sharedGlass.name = "CristalloGrigio (HySpace)";
  new THREE.TextureLoader().load(DOOR_REFLECTION_JPG, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    if (!_sharedGlass) { tex.dispose(); return; }
    _sharedGlass.matcap = tex;
    _sharedGlass.needsUpdate = true;
  });
  return _sharedGlass;
}

/** Sostituisce nel modello di stanza i materiali "CristalloGrigio" con il vetro delle porte. */
export function HYS_applySharedGlass(root) {
  let n = 0;
  root?.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => (HYS_GLASS_MATCH.test(m?.name ?? "") ? (n++, HYS_sharedGlassMaterial()) : m));
    } else if (HYS_GLASS_MATCH.test(o.material?.name ?? "")) {
      o.material = HYS_sharedGlassMaterial();
      n++;
    }
  });
  return n;
}


// ═════════════════════════════════════════════════════════════════════════════
// PORTE
// ═════════════════════════════════════════════════════════════════════════════

function hsLeafGeometry(style, twin) {
  const pts = style.leafShape.map(([x, y]) =>
    twin ? new THREE.Vector2(-x, style.refHeight - y) : new THREE.Vector2(x, y));
  const shape = new THREE.Shape(pts);
  const [z0, z1] = style.leafZ;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
  geo.translate(0, 0, z0 + (twin ? style.twinDz : 0));
  return geo;
}

/**
 * Crea le 4 porte (chiuse e bloccate) come figli di `parent`.
 * @param {{ parent: THREE.Object3D, renderer?: THREE.WebGLRenderer, style?: object }} opts
 * @returns {Map<string, object>} dir -> door
 */
export function HYS_createDoors({ parent, renderer = null, style = HYS_DOOR_STYLE }) {
  const doors = new Map();
  const geoMain = hsLeafGeometry(style, false);
  const geoTwin = hsLeafGeometry(style, true);
  const labelGeo = new THREE.PlaneGeometry(1, 1);
  const envMap = hsEnvMap(renderer);

  for (const dir of HYS_DOOR_DIRS) {
    const group = new THREE.Group();
    group.name = `HYS_Door_${dir}`;
    parent.add(group);

    const mk = (twin, labelCfg, side) => {
      const mat = new THREE.MeshPhysicalMaterial({
        color: style.lockedColor,
        transparent: true,
        opacity: style.lockedOpacity,
        roughness: style.glassRoughness,
        metalness: 0,
        envMap,
        envMapIntensity: style.glassEnvIntensity,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const leaf = new THREE.Mesh(twin ? geoTwin : geoMain, mat);
      leaf.name = `HYS_DoorLeaf_${dir}_${side}`;
      leaf.renderOrder = 1;

      // scritta: una riga lungo il lato obliquo. labelRoot = Transform del VRML
      // (ancoraggio + rotazione); il piano è la fascia del testo sopra la linea di base
      const band = hsLabelBand(labelCfg);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(labelCfg.maxLength * style.labelPxPerM);
      canvas.height = Math.round(band.height * style.labelPxPerM);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const label = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      label.name = `HYS_DoorLabel_${dir}_${side}`;
      label.renderOrder = 2;
      label.position.set(0, band.centerY, 0);
      label.scale.set(labelCfg.maxLength, band.height, 1);
      const labelRoot = new THREE.Group();
      labelRoot.position.set(labelCfg.x, labelCfg.y, labelCfg.z); // dentro il vetro, come nel VRML
      labelRoot.rotation.z = labelCfg.rot;
      labelRoot.add(label);

      // pivot = parte che scorre (anta + sua scritta)
      const pivot = new THREE.Group();
      pivot.add(leaf, labelRoot);
      group.add(pivot);
      return { pivot, leaf, label, canvas, tex, cfg: labelCfg };
    };

    doors.set(dir, {
      dir,
      group,
      main: mk(false, style.label.title, "main"),    // titolo
      twin: mk(true, style.label.author, "twin"),    // autore
      fraction: 0,      // 0 chiusa … 1 aperta
      enabled: false,   // false = bloccata (nessun vicino)
      title: "",
      author: "",
      labelKey: null,
      dimsKey: null,
      style,
      _tmp: new THREE.Vector3(),
    });
  }

  // riflesso originale: le ante passano a una matcap con HYS_FakeReflection.jpg
  if (style.reflection === "matcap") {
    new THREE.TextureLoader().load(DOOR_REFLECTION_JPG, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      doors._reflectionTex = tex;
      for (const door of doors.values()) {
        for (const p of [door.main, door.twin]) {
          const old = p.leaf.material;
          p.leaf.material = new THREE.MeshMatcapMaterial({
            matcap: tex, color: old.color.clone(), transparent: true,
            opacity: old.opacity, depthWrite: false, side: THREE.DoubleSide,
          });
          old.dispose();
        }
        door.labelKey = null;
        HYS_setDoorState(door, door.enabled ? { title: door.title, author: door.author } : null);
      }
    }, undefined, () => console.warn("[HYS] HYS_FakeReflection.jpg non trovata: vetri con environment"));
  }
  return doors;
}

/**
 * Posiziona e dimensiona le porte. `cfg` = mod_spec.hys.door della stanza
 * centrale (opzionale). La geometria di riferimento viene scalata.
 */
export function HYS_layoutDoors(doors, cfg = {}) {
  for (const door of doors.values()) {
    const s = door.style;
    const w = Number(cfg.width ?? s.width);
    const h = Number(cfg.height ?? s.height);
    const d = Number(cfg.distance ?? s.distance);
    const key = `${w}|${h}|${d}`;
    if (door.dimsKey === key) continue;
    door.dimsKey = key;

    const pl = DOOR_PLACEMENT[door.dir];
    door.group.position.set(pl.ux * d, 0, pl.uz * d);
    door.group.rotation.set(0, pl.rotY, 0);
    door.group.scale.set(w / s.refWidth, h / s.refHeight, 1);
    door.group.updateMatrixWorld(true);
    hsApplyFraction(door);
  }
}

export function HYS_disposeDoors(doors) {
  const geos = new Set();
  for (const door of doors.values()) {
    for (const p of [door.main, door.twin]) {
      geos.add(p.leaf.geometry);
      geos.add(p.label.geometry);
      p.leaf.material.dispose();
      p.label.material.dispose();
      p.tex.dispose();
    }
    door.group.parent?.remove(door.group);
  }
  for (const g of geos) g.dispose();
  doors._reflectionTex?.dispose();
  doors.clear();
}

/**
 * Imposta la porta secondo il vicino in quella direzione.
 * @param {object} door
 * @param {object|null} exe - esercitazione vicina ({ title, author }) o null
 */
export function HYS_setDoorState(door, exe) {
  const s = door.style;
  door.enabled = !!exe;
  door.title = exe ? (exe.title ?? "") : (s.lockedTitle ?? t("app.hys.door.locked"));
  door.author = exe ? (exe.author ?? "") : s.lockedAuthor;

  const glassOpacity = door.main.leaf.material.isMeshMatcapMaterial ? s.matcapOpacity : s.glassOpacity;
  for (const p of [door.main, door.twin]) {
    p.leaf.material.color.setHex(door.enabled ? s.glassColor : s.lockedColor);
    p.leaf.material.opacity = door.enabled ? glassOpacity : s.lockedOpacity;
  }

  const key = `${door.enabled}|${door.title}|${door.author}`;
  if (door.labelKey === key) return;
  door.labelKey = key;
  const color = door.enabled ? s.labelColor : s.labelColorLocked;
  hsDrawLabel(door.main.canvas, door.title, door.main.cfg, s, color);
  hsDrawLabel(door.twin.canvas, door.author, door.twin.cfg, s, color);
  door.main.tex.needsUpdate = true;
  door.twin.tex.needsUpdate = true;
}

// Fascia occupata dal testo rispetto alla linea di base (in metri): dal fondo delle
// discendenti (-0.25 size) alla cima delle maiuscole/accenti (+1.05 size)
function hsLabelBand(cfg) {
  const bottom = -0.25 * cfg.size, top = 1.05 * cfg.size;
  return { height: top - bottom, centerY: (top + bottom) / 2, baseFromTop: top };
}

// Una riga, centrata sull'ancoraggio (justify MIDDLE), corpo = size del VRML;
// ridotta solo se più lunga di maxLength.
function hsDrawLabel(canvas, text, cfg, style, color) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  text = String(text ?? "").trim();
  if (!text) return;

  const band = hsLabelBand(cfg);
  let px = cfg.size * style.labelPxPerM;
  ctx.font = `${style.labelWeight} ${px}px ${style.labelFont}`;
  const w = ctx.measureText(text).width;
  if (w > W * 0.98) {
    px *= (W * 0.98) / w;
    ctx.font = `${style.labelWeight} ${px}px ${style.labelFont}`;
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, W / 2, band.baseFromTop * style.labelPxPerM);
}

/**
 * Da chiamare a ogni frame: una porta abilitata si apre quando il player entra
 * nel sensore di prossimità e si richiude quando esce.
 */
export function HYS_updateDoors(doors, playerPos, dt) {
  for (const door of doors.values()) {
    if (!door.dimsKey) continue;
    const s = door.style;

    // sensore in metri reali: posizione del player relativa al centro porta
    const g = door.group;
    const dx = playerPos.x - g.position.x;
    const dz = playerPos.z - g.position.z;
    const half = s.sensorSize / 2;
    // il ProximitySensor VRML misura il punto di vista: piedi + ~1.7 m
    const near = Math.abs(dx) < half && Math.abs(dz) < half &&
                 Math.abs(playerPos.y + 1.7 - s.sensorCenterY) < half;

    const target = (door.enabled && near) ? 1 : 0;
    if (door.fraction === target) continue;

    const step = dt / Math.max(0.01, s.openTime);
    door.fraction = target > door.fraction
      ? Math.min(1, door.fraction + step)
      : Math.max(0, door.fraction - step);
    hsApplyFraction(door);
  }
}

function hsApplyFraction(door) {
  const e = door.fraction * door.fraction * (3 - 2 * door.fraction); // smoothstep
  const slide = door.style.slide * e;
  door.main.pivot.position.x = slide;    // Apri_pos0: 0 → +2
  door.twin.pivot.position.x = -slide;   // Apri_pos2: 0 → -2
}

/**
 * Dopo una transizione orizzontale verso `dir`: la porta attraversata è ora
 * sul lato opposto della nuova centrale → ne eredita l'apertura. Le altre chiuse.
 */
export function HYS_shiftDoors(doors, dir) {
  const crossed = doors.get(dir)?.fraction ?? 0;
  for (const door of doors.values()) door.fraction = 0;
  const behind = doors.get(OPPOSITE[dir]);
  if (behind) behind.fraction = crossed;
  for (const door of doors.values()) hsApplyFraction(door);
}

/** Tutte chiuse di colpo (transizione verticale / reset). */
export function HYS_resetDoors(doors) {
  for (const door of doors.values()) { door.fraction = 0; hsApplyFraction(door); }
}

/** Mesh delle ante da usare come colliders (si muovono: il varco si libera da solo). */
export function HYS_doorColliders(doors) {
  const out = [];
  for (const door of doors.values()) out.push(door.main.leaf, door.twin.leaf);
  return out;
}


// ═════════════════════════════════════════════════════════════════════════════
// OGGETTI FISSI DELLA STANZA CENTRALE: spot + tasti scala (GLB esterni)
// ═════════════════════════════════════════════════════════════════════════════

const _glbCache = new Map(); // url -> Promise<Object3D>

function hsLoadGLB(url) {
  if (!_glbCache.has(url)) {
    const p = new GLTFLoader().loadAsync(url)
      .then((g) => g.scene)
      .catch((e) => { _glbCache.delete(url); throw e; });
    _glbCache.set(url, p);
  }
  return _glbCache.get(url).then((root) => root.clone(true));
}

// I GLB convertiti hanno materiali propri: li rimpiazzo per poterli colorare
function hsRecolor(root, material) {
  root.traverse((o) => { if (o.isMesh) o.material = material; });
}

/**
 * Carica spot e tasti scala nella stanza centrale.
 * @param {{ parent: THREE.Object3D, onStairUp: Function, onStairDown: Function, style?: object }} opts
 * @returns {Promise<{ root, interactive: THREE.Mesh[], setStairs: Function, dispose: Function }>}
 */
export async function HYS_createRoomFixtures({ parent, onStairUp, onStairDown, style = HYS_FIXTURE_STYLE }) {
  const root = new THREE.Group();
  root.name = "HYS_Fixtures";
  parent.add(root);

  const owned = [];     // materiali creati qui, da liberare
  const interactive = [];

  // ── Spot (lampada + luce, inclinati insieme verso la pedana) ─────────────
  const sp = style.spot;
  const spotGroup = new THREE.Group();
  spotGroup.name = "HYS_Spot";
  spotGroup.position.fromArray(sp.position);
  spotGroup.rotation.x = sp.tiltX;
  root.add(spotGroup);

  const light = new THREE.SpotLight(sp.color, sp.intensity, sp.distance, sp.angle,
    Math.max(0, Math.min(1, 1 - sp.beamWidth / sp.angle)), sp.decay ?? 2);
  light.position.set(0, 0, 0);
  const sh = sp.shadow ?? {};
  light.castShadow = !!sh.enabled;
  light.shadow.mapSize.set(sh.mapSize ?? 1024, sh.mapSize ?? 1024);
  light.shadow.camera.near = sh.near ?? 0.5;
  light.shadow.camera.far = sh.far ?? 10;
  light.shadow.bias = sh.bias ?? 0;
  light.shadow.normalBias = sh.normalBias ?? 0;
  light.shadow.radius = sh.radius ?? 1;
  light.target.position.set(0, 0, -1);  // direction 0 0 -1
  spotGroup.add(light, light.target);

  try {
    const lamp = await hsLoadGLB(SPOT_GLB);
    const mat = new THREE.MeshStandardMaterial({ color: sp.bodyColor, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
    owned.push(mat);
    hsRecolor(lamp, mat);
    lamp.scale.setScalar(sp.scale);
    spotGroup.add(lamp);
  } catch (e) {
    console.warn("[HYS] Spot.glb non caricato:", e);
  }

  // ── Tasti scala ──────────────────────────────────────────────────────────
  const sb = style.stairButtons;
  const buttons = {};
  try {
    const base = await hsLoadGLB(TASTO_UP_GLB);
    for (const [key, cfg, action] of [["up", sb.up, onStairUp], ["down", sb.down, onStairDown]]) {
      const btn = key === "up" ? base : base.clone(true);
      const mat = new THREE.MeshStandardMaterial({ color: sb.colorDisabled, roughness: 0.4, side: THREE.DoubleSide });
      owned.push(mat);
      hsRecolor(btn, mat);

      const holder = new THREE.Group();
      holder.name = `HYS_StairButton_${key}`;
      holder.position.fromArray(cfg.position);
      holder.rotation.set(0, sb.rotY, key === "down" ? Math.PI : 0); // giù = su capovolto
      holder.scale.setScalar(sb.scale);
      holder.add(btn);
      root.add(holder);

      btn.traverse((o) => {
        if (!o.isMesh) return;
        o.userData.hysAction = () => { if (buttons[key].enabled) action?.(); };
        // tooltip 3D: esercitazione del piano sopra / sotto
        o.userData.hysTooltip = () => buttons[key].exe
          ? { title: buttons[key].exe.title, author: buttons[key].exe.author,
              hint: key === "up" ? "▲ piano superiore" : "▼ piano inferiore" }
          : null;
        interactive.push(o);
      });
      holder.visible = false; // compaiono solo se c'è un'esercitazione sopra / sotto
      buttons[key] = { holder, mat, enabled: false, exe: null };
    }
  } catch (e) {
    console.warn("[HYS] Tasto_UP.glb non caricato:", e);
  }

  /** Tasti presenti solo se esiste l'esercitazione sopra/sotto (upExe/downExe), verdi se aperti. */
  function setStairs({ upExe, downExe, upOpen, downOpen }) {
    const apply = (b, exe, open) => {
      if (!b) return;
      b.exe = exe ?? null;
      b.enabled = !!exe;
      b.holder.visible = !!exe;
      b.mat.color.setHex(open ? sb.colorOpen : sb.colorEnabled);
    };
    apply(buttons.up, upExe, upOpen);
    apply(buttons.down, downExe, downOpen);
  }

  function dispose() {
    root.parent?.remove(root);
    for (const m of owned) m.dispose();
    light.shadow?.map?.dispose?.();
    light.dispose?.();
  }

  /** Ombre dello spot ON/OFF (voce di menu, come "Depth Shadow Shader" del VRML). */
  function setShadows(on) { light.castShadow = !!on; }

  /** Livello della luce 0…1 rispetto all'intensità di stile (dissolvenza all'ingresso). */
  function setLightLevel(k) { light.intensity = sp.intensity * k; }

  return { root, interactive, setStairs, setShadows, setLightLevel, get shadowsOn() { return light.castShadow; }, dispose };
}


// ═════════════════════════════════════════════════════════════════════════════
// MODELLO SULLA PEDANA: box, esposto, tasti scala/ruota
// ═════════════════════════════════════════════════════════════════════════════

/** Box-pedana (BOX.wrl): cubo unitario, scalato da HYS_createExhibit. */
export function HYS_createPedestalBox(style = HYS_PEDESTAL_STYLE.box) {
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: style.color, emissive: style.emissive, roughness: style.roughness, metalness: style.metalness })
  );
  box.name = "HYS_PedestalBox";
  box.visible = false;
  return box;
}

/**
 * Modello di un'esercitazione esposto sulla pedana (GMVInLine del VRML).
 * `model` resta nella sua origine (i modelli degli allievi erano pensati per
 * la pedana); `mount` è il punto della pedana nello spazio della stanza.
 *
 * Regola di changeScale: un modello più piccolo di 1 m in tutte le dimensioni
 * sta su una box (lato = diagonale di pianta + 0.1) con il centro a quota 1 m;
 * fino a 4×3×4 m poggia direttamente sulla pedana; oltre il cambio di scala è
 * rifiutato. Differenza voluta: un modello già troppo grande al caricamento
 * viene ridotto uniformemente per starci (nel VRML restava fuori scala).
 *
 * Animazione (Esercitazione.flag_anim, parte all'ingresso nella stanza), sempre
 * attorno all'asse verticale passante per l'origine (0, 0) del modello, come
 * OI_Rot su TR_GMVIL nel VRML (anche i tasti di rotazione usano lo stesso asse):
 *   0 nessuna
 *   1 un giro di 360° in style.anim.duration (10 s, come TS_Rot di GMVInLine)
 *   2 andata 360° + ritorno 360°, 10 s ciascuno
 *   3 rotazione continua (1 giro ogni 10 s)
 *   4 andata e ritorno in loop
 * Profilo di velocità a trapezio: accelera per style.anim.ramp (2 s) alla partenza
 * e rallenta negli ultimi 2 s di ogni tratto; nel 3 accelera solo alla partenza.
 *
 * @returns {{ root, applyScale(v), applyRotation(v), resetOrTurn(), play(), pause(), update(dt), dispose() }}
 *   resetOrTurn: tasto rosso della rotazione — se il modello è ruotato (tasti o animazione)
 *   torna all'orientamento di partenza, altrimenti fa un giro (come flag_anim 1)
 *   applyScale: 0 = scala iniziale, altrimenti fattore (0.8 / 1.2) → false se rifiutato
 *   applyRotation: 0 = rotazione iniziale, altrimenti incremento in rad
 *   update(dt): da chiamare a ogni frame; true se il modello si è mosso
 */
export function HYS_createExhibit({ model, mount = [0, 0.4, 0], anim = 0, style = HYS_PEDESTAL_STYLE }) {
  const root = new THREE.Group();
  root.name = "Esposto";
  root.position.fromArray(mount);

  const box = HYS_createPedestalBox(style.box);
  const holder = new THREE.Group();   // scala, quota sulla pedana, rotazione dei tasti
  holder.name = "Esposto_Modello";
  const spin = new THREE.Group();     // animazione, perno sull'origine del modello
  spin.name = "Esposto_Animazione";
  holder.add(spin);
  spin.add(model);
  root.add(box, holder);

  // ingombro a scala 1, senza rotazione
  const base = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const LIMIT = { x: 4, y: 3, z: 4 };
  let scale = 1;

  function place(s) {
    const x = base.x * s, y = base.y * s, z = base.z * s;
    if (x < 1 && y < 1 && z < 1) {
      const lbox = Math.hypot(x, z) + 0.1;
      const hbox = 1 - y / 2;
      box.scale.set(lbox, hbox, lbox);
      box.position.set(0, hbox / 2, 0);
      box.visible = true;
      holder.position.y = hbox;
    } else if (x < LIMIT.x && y < LIMIT.y && z < LIMIT.z) {
      box.visible = false;
      holder.position.y = 0;
    } else {
      return false;
    }
    holder.scale.setScalar(s);
    scale = s;
    return true;
  }

  function applyScale(v) {
    if (v === 0) {
      if (place(1)) return true;
      const k = 0.98 * Math.min(LIMIT.x / (base.x || 1), LIMIT.y / (base.y || 1), LIMIT.z / (base.z || 1));
      return place(k);
    }
    return place(scale * v);
  }

  function applyRotation(v) {
    holder.rotation.y = v === 0 ? 0 : holder.rotation.y + v;
  }

  // ── animazione ──
  const mode = [1, 2, 3, 4].includes(Number(anim)) ? Number(anim) : 0;
  const T = style.anim?.duration ?? 10;                       // durata di un tratto (360°)
  const A = Math.min(style.anim?.ramp ?? 2, T / 2);           // accelerazione / frenata
  const TURN = 2 * Math.PI;
  let playing = false;
  let tm = 0;        // tempo dall'avvio
  let offset = 0;    // angolo di partenza (rotazione continua ripresa dopo una pausa)
  let override = 0;  // giro singolo richiesto dal tasto rosso, al posto di flag_anim
  const current = () => override || mode;

  // frazione 0…1 di un tratto al tempo τ, profilo a trapezio (area totale = 1)
  const vmax = 1 / (T - A);
  function trapezoid(tau) {
    if (tau <= 0) return 0;
    if (tau >= T) return 1;
    if (tau < A) return 0.5 * (vmax / A) * tau * tau;
    if (tau <= T - A) return 0.5 * vmax * A + vmax * (tau - A);
    const r = T - tau;
    return 1 - 0.5 * (vmax / A) * r * r;
  }

  // rotazione continua: accelera per A secondi fino a 1 giro ogni T, poi costante
  function continuous(tau) {
    const v = 1 / T;
    return tau < A ? 0.5 * (v / A) * tau * tau : 0.5 * v * A + v * (tau - A);
  }

  // angolo al tempo t; null = animazione finita
  function angleAt(tau) {
    switch (current()) {
      case 1: return tau >= T ? null : TURN * trapezoid(tau);
      case 2: return tau >= 2 * T ? null
                   : tau < T ? TURN * trapezoid(tau) : TURN * (1 - trapezoid(tau - T));
      case 3: return offset + TURN * continuous(tau);
      case 4: { const c = tau % (2 * T);
                return c < T ? TURN * trapezoid(c) : TURN * (1 - trapezoid(c - T)); }
      default: return null;
    }
  }

  function play() {
    override = 0;
    if (!mode) return;
    if (mode === 3) { offset = spin.rotation.y; tm = 0; }  // riparte (accelerando) da dov'era
    else if (mode !== 4) tm = 0;                           // 1 e 2 ripartono da capo a ogni ingresso
    playing = true;
  }

  // fuori dalla stanza centrale: i loop si fermano dove sono, 1 e 2 tornano a riposo
  function pause() {
    playing = false;
    if (override || mode === 1 || mode === 2) { tm = 0; spin.rotation.set(0, 0, 0); }
    override = 0;
  }

  function resetOrTurn() {
    const rotated = playing ||
      Math.abs(holder.rotation.y) > 1e-4 ||
      Math.abs(Math.sin(spin.rotation.y)) > 1e-4 || Math.cos(spin.rotation.y) < 0;
    if (rotated) {
      playing = false;
      override = 0;
      tm = 0;
      offset = 0;
      holder.rotation.y = 0;
      spin.rotation.set(0, 0, 0);
      return "reset";
    }
    override = 1;
    tm = 0;
    playing = true;
    return "turn";
  }

  function update(dt) {
    if (!playing) return false;
    tm += dt;
    const a = angleAt(tm);
    if (a === null) {
      playing = false;
      override = 0;
      tm = 0;
      spin.rotation.set(0, 0, 0);
      return true;
    }
    spin.rotation.set(0, a % TURN, 0);
    return true;
  }

  function dispose() {
    root.parent?.remove(root);
    box.geometry.dispose();
    box.material.dispose();
    // la geometria del modello è condivisa con la cache dei cloni: non si libera qui
  }

  // ombre (spot della stanza centrale): il modello proietta e riceve (ombre autoportate)
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  box.castShadow = true;
  box.receiveShadow = true;

  const ex = { root, applyScale, applyRotation, resetOrTurn, play, pause, update, dispose };
  root.userData.exhibit = ex;
  return ex;
}

function hsPlate(shape, depth) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2); // piastra orizzontale, spessore verso +y
  return g;
}

// AM_*_M (grigio): scala = angolo triangolare 1×1; ruota = semicorona r 0.35–0.5 con freccia
function hsControlShapeM(kind) {
  if (kind === "scale") {
    return new THREE.Shape([new THREE.Vector2(-0.5, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(-0.5, 0.5)]);
  }
  const s = new THREE.Shape();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 1.75;
  s.absarc(0, 0, 0.5, a0, a1, false);
  s.absarc(0, 0, 0.35, a1, a0, true);
  const hs = new THREE.Shape([                       // punta di freccia all'estremo a1
    new THREE.Vector2(Math.cos(a1) * 0.28, Math.sin(a1) * 0.28),
    new THREE.Vector2(Math.cos(a1) * 0.57, Math.sin(a1) * 0.57),
    new THREE.Vector2(Math.cos(a1 + 0.35) * 0.425, Math.sin(a1 + 0.35) * 0.425),
  ]);
  return [s, hs];
}

/**
 * Terna di tasti meno/base/più (Tasto_ILScale / Tasto_ILRot). onValue riceve
 * { kind, action: "minus"|"base"|"plus", value } con i valori del VRML.
 * @returns {{ root: THREE.Group, interactive: THREE.Mesh[], dispose: Function }}
 */
export function HYS_createTransformControls(kind /* "scale" | "rotate" */, onValue, style = HYS_PEDESTAL_STYLE.controls) {
  const root = new THREE.Group();
  root.name = `HYS_Controls_${kind}`;
  root.scale.set(style.scale, style.scaleY, style.scale);

  const matM = new THREE.MeshStandardMaterial({ color: style.colorM, roughness: 0.4, metalness: 0.3 });
  const matB = new THREE.MeshStandardMaterial({ color: style.colorB, roughness: 0.4, metalness: 0.2 });
  const geoM = hsPlate(hsControlShapeM(kind), 0.08);
  const geoB = new THREE.BoxGeometry(0.3, 0.1, 0.3).translate(0, 0.05, 0);

  const value = {
    scale:  { minus: style.scaleStep[0], base: 0, plus: style.scaleStep[1] },
    rotate: { minus: -style.rotStep,     base: 0, plus: style.rotStep },
  }[kind];

  const interactive = [];
  const add = (geo, mat, action, rotY, sy) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = rotY;
    m.scale.y = sy;
    m.userData.hysAction = () => onValue?.({ kind, action, value: value[action] });
    root.add(m);
    interactive.push(m);
  };
  add(geoM, matM, "minus", 0, 1);        // urlM
  add(geoB, matB, "base", Math.PI, 3);   // urlB: rotation 0 1 0 3.14 scale 1 3 1
  add(geoM, matM, "plus", Math.PI, 2);   // urlP: rotation 0 1 0 3.14 scale 1 2 1

  function dispose() {
    root.parent?.remove(root);
    geoM.dispose(); geoB.dispose(); matM.dispose(); matB.dispose();
  }
  return { root, interactive, dispose };
}
