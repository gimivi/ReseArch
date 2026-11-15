import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { Rhino3dmLoader } from 'three/addons/loaders/3DMLoader.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { VRMLLoader } from 'three/addons/loaders/VRMLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { tjsSetPanoramaDepth } from './TJS-pano-depth.mjs';
import { tjsMarkNoMaterial } from './TJS-clay.mjs';

// Mesh senza materiale nel file (2026-10-21): segnate qui con tjsMarkNoMaterial, ricevono il
// materiale clay del pannello quando entrano sotto TJS_MODELS_ROOT (TJS-clay.mjs). Le mesh con
// colori per vertice hanno già un aspetto: non si segnano.
const _hasColors = (o) => !!o.geometry?.getAttribute?.('color');

// Rinominata da "dracoDecoderPath" (2026-09-17): quel nome era anche il nome
// del parametro di loadGLTF()/loadDRC() — dentro quelle funzioni lo shadowing
// nascondeva SEMPRE questa costante, rendendo un eventuale fallback su di
// essa impossibile da scrivere per errore di refuso. Un nome diverso rende
// l'intenzione esplicita: DEFAULT_DRACO_DECODER_PATH è quello che
// loadAnyModel() passa sempre come dracoDecoderPath ai loader.
const DEFAULT_DRACO_DECODER_PATH = 'https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/libs/draco/';


function getExt(url) {
  const clean = String(url || '').split('?')[0].split('#')[0];
  const i = clean.lastIndexOf('.');
  return i >= 0 ? clean.slice(i + 1).toLowerCase() : '';
}
function stripFilename(url) {
  const clean = String(url || '').split('?')[0].split('#')[0];
  const i = clean.lastIndexOf('/');
  return i >= 0 ? clean.slice(0, i + 1) : '';
}
function filenameOnly(url) {
  const clean = String(url || '').split('?')[0].split('#')[0];
  const i = clean.lastIndexOf('/');
  return i >= 0 ? clean.slice(i + 1) : clean;
}
function wrapProgress(onProgress) {
  return (xhr) => {
    if (!onProgress) return;
    const loaded = xhr?.loaded ?? 0;
    const total = xhr?.total ?? 0;
    onProgress(loaded, total);
  };
}

export async function loadGLTF({ url, modelRow, dracoDecoderPath, onProgress }) {
  const loader = new GLTFLoader();

  let draco = null;
  if (dracoDecoderPath) {
    draco = new DRACOLoader();
    draco.setDecoderPath(dracoDecoderPath);
    loader.setDRACOLoader(draco);
  }

  const gltf = await loader.loadAsync(url, wrapProgress(onProgress));
  draco?.dispose(); // rilascia WebAssembly decoder dopo il caricamento
  const root = gltf.scene || gltf.scenes?.[0] || new THREE.Group();
  // primitive senza "material" nel JSON: GLTFLoader mette un MeshStandardMaterial metallico (scuro)
  const json = gltf.parser?.json, assoc = gltf.parser?.associations;
  root.traverse((o) => {
    if (!o.isMesh || _hasColors(o)) return;
    const a = assoc?.get(o);
    const prim = (a && a.primitives !== undefined) ? json?.meshes?.[a.meshes]?.primitives?.[a.primitives] : null;
    if (prim && prim.material === undefined) tjsMarkNoMaterial(o);
  });
  return root;
}

export async function loadOBJ({ url, baseUrl, modelRow, onProgress }) {
  const objFile = filenameOnly(url);
  const dir = baseUrl || stripFilename(url);
  const mtlFile = objFile.replace(/\.obj$/i, '.mtl');

  let materials = null;
  try {
    const mtlLoader = new MTLLoader();
    mtlLoader.setPath(dir);
    materials = await mtlLoader.loadAsync(mtlFile, wrapProgress(onProgress));
    materials.preload();
  } catch (_) {
    materials = null;
  }

  const objLoader = new OBJLoader();
  objLoader.setPath(dir);
  if (materials) objLoader.setMaterials(materials);

  const root = await objLoader.loadAsync(objFile, wrapProgress(onProgress));
  if (!materials) root.traverse((o) => { if (o.isMesh && !_hasColors(o)) tjsMarkNoMaterial(o); });   // senza .mtl
  return root;
}

export async function loadSVG({ url, baseUrl, modelRow, onProgress }) {
  const file = filenameOnly(url);
  const dir = baseUrl || stripFilename(url);

  const loader = new SVGLoader();
  loader.setPath(dir);

  const data = await loader.loadAsync(file, wrapProgress(onProgress));
  const group = new THREE.Group();

  data.paths.forEach((p) => {
    const fill = p.userData?.style?.fill;
    if (fill && fill !== 'none') {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(fill),
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const shapes = p.toShapes();   // SVGLoader.createShapes() deprecato dalla r185
      shapes.forEach((s) => {
        const geom = new THREE.ShapeGeometry(s);
        group.add(new THREE.Mesh(geom, mat));
      });
    }
  });

  group.scale.set(0.01, -0.01, 0.01);
  return group;
}

/**
 * VRML97: .wrl / .vrml in chiaro oppure compressi con gzip (.wrz, ma anche molti .wrl
 * esportati "compressi" hanno l'estensione normale): si riconosce dai primi due byte
 * (1f 8b), non dall'estensione. Decompressione nativa del browser (DecompressionStream).
 * Texture (ImageTexture) risolte rispetto alla cartella del file.
 */
export async function loadVRML({ url, baseUrl, modelRow, onProgress, signal }) {
  const dir = baseUrl || stripFilename(url);
  const res = await fetch(url, { credentials: 'same-origin', signal });
  if (!res.ok) throw new Error(`VRML: HTTP ${res.status} (${url})`);
  let buf = await res.arrayBuffer();
  onProgress?.(buf.byteLength, buf.byteLength);
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('VRML compresso (gzip): browser senza DecompressionStream');
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const text = new TextDecoder('utf-8').decode(buf);
  const root = new VRMLLoader().parse(text, dir);
  // forma senza Appearance: VRMLLoader la fa nera e non illuminata (Loader.DEFAULT_MATERIAL_NAME)
  root.traverse((o) => {
    if (o.isMesh && !_hasColors(o) && [].concat(o.material ?? []).every(m => m?.name === THREE.Loader.DEFAULT_MATERIAL_NAME)) {
      tjsMarkNoMaterial(o);
    }
  });
  return root;
}

/**
 * Un BufferGeometry "grezzo" (da DRACOLoader o PLYLoader) può rappresentare
 * una point cloud (nessun index) o una mesh vera (con index/triangoli) — la
 * differenza si legge solo da geom.index, non dal formato del file. Fattorizzato
 * da loadDRC/loadPLY per non duplicare la stessa scelta Mesh/Points due volte
 * (prima di questo refactor loadDRC assumeva SEMPRE point cloud, anche per una
 * geometria indicizzata, che non avrebbe mai reso come mesh solida).
 */
/**
 * Texture a maschera (cerchio pieno bianco) usata per simulare punti "tondi"
 * con PointsMaterial — in WebGL un THREE.Points è sempre un quadrato nativo
 * (gl_PointCoord), la forma tonda non è una proprietà del materiale ma va
 * ottenuta mascherando i pixel esterni al cerchio via `map` + `alphaTest`
 * (vedi applyPointShape sotto). Generata una sola volta e condivisa da tutti
 * i materiali Points dell'app (env-manager, material-editor, applyModSpecStyle).
 */
let _roundDotTexture = null;
export function getRoundDotTexture() {
  if (_roundDotTexture) return _roundDotTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  _roundDotTexture = new THREE.CanvasTexture(canvas);
  return _roundDotTexture;
}

/**
 * Applica la forma 'square' (default nativo, nessuna maschera) o 'round'
 * (maschera circolare via alphaTest) a un PointsMaterial. `material.userData
 * .__pointShape` tiene traccia della scelta esplicita, perché non esiste una
 * vera property "shape" da poter rileggere dal materiale (a differenza di
 * size/sizeAttenuation) — senza questo flag un pannello UI non saprebbe se
 * mostrare "Tondo" o "Quadrato" per un materiale già configurato.
 */
export function applyPointShape(material, shape) {
  if (!material) return;
  if (shape === 'round') {
    material.map = getRoundDotTexture();
    material.alphaTest = 0.5;
  } else {
    material.map = null;
    material.alphaTest = 0;
  }
  material.userData.__pointShape = shape;
  material.needsUpdate = true;
}

function geometryToObject3D(geom) {
  if (geom.index) {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: geom.hasAttribute('color'),
      side: THREE.DoubleSide,
    });
    if (!geom.hasAttribute('normal')) geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, mat);
    if (!geom.hasAttribute('color')) tjsMarkNoMaterial(mesh);
    return mesh;
  }

  const mat = new THREE.PointsMaterial({ vertexColors: geom.hasAttribute('color'), size: 0.02, sizeAttenuation: true });
  return new THREE.Points(geom, mat);
}

export async function loadDRC({ url, modelRow, dracoDecoderPath, onProgress }) {
  const loader = new DRACOLoader();
  loader.setDecoderPath(dracoDecoderPath || DEFAULT_DRACO_DECODER_PATH);   // WASM: predefinito (setDecoderConfig deprecato dalla r185)

  // FIX (2026-09-17): DRACOLoader (three.js) richiede SEMPRE l'attributo
  // color come Float32Array (this.defaultAttributeTypes.color, hardcoded
  // nel costruttore — verificato leggendo il sorgente reale del loader),
  // indipendentemente dal tipo con cui il file .drc lo ha effettivamente
  // codificato. Un file con color codificato UINT8 (confermato via
  // ispezione Python/DracoPy del file: attribute_type=COLOR,
  // data_type=UINT8, range [0,255] valido) decodificato chiedendo
  // esplicitamente float32 produceva numeri enormi e senza senso (es.
  // 233711.65625 invece di un canale 0-255) — punti tutti bianchi per
  // clamping GPU. DRACOLoader gestisce già correttamente gli attributi
  // non-Float32Array (vedi il suo `attribute.normalized = (array
  // instanceof Float32Array) === false`, che attiva la normalizzazione
  // GPU standard per interi), quindi richiedere qui il tipo REALE del file
  // invece del default è la via prevista, non un workaround. Se un giorno
  // si incontra un .drc con color codificato a 16 bit servirà
  // 'Uint16Array' invece di 'Uint8Array' — non c'è modo di auto-rilevarlo
  // da qui senza leggere l'header del file.
  loader.defaultAttributeTypes.color = 'Uint8Array';

  // FIX (2026-09-18): trovato un secondo bug in DRACOLoader, sempre legato al
  // colore, sempre confermato leggendo il sorgente reale (three@0.182.0).
  // In _createGeometry(), per l'attributo "color", il loader esegue in
  // quest'ordine: 1) _assignVertexColorSpace(attribute, vertexColorSpace)
  // — converte i valori sRGB→working-space leggendo/scrivendo l'attributo
  // con Color.fromBufferAttribute()/attribute.setXYZ(); 2) SOLO DOPO imposta
  // `attribute.normalized = (array instanceof Float32Array) === false`.
  // BufferAttribute.getX/setXYZ (verificato nel sorgente) applicano lo
  // scaling per un intero SOLO se `this.normalized` è già true in quel
  // momento. Per il default Float32Array l'ordine non conta (i float non
  // vengono mai scalati). Ma per il nostro color forzato a Uint8Array (fix
  // di ieri), la conversione sRGB gira mentre normalized è ANCORA false:
  // legge i byte grezzi 0-255 come se fossero già in [0,1], ci applica la
  // curva sRGB→lineare (numeri risultanti assurdi, fuori scala), e riscrive
  // il risultato altrettanto fuori scala di nuovo senza scaling — troncato
  // nel byte. Risultato osservato: punti colorati, ma con colori sbagliati
  // rispetto all'originale (mai più bianchi, quindi il fix di ieri restava
  // valido, ma incompleto).
  //
  // Fix: chiediamo a decodeDracoFile() di NON applicare la sua conversione,
  // passando NoColorSpace invece del SRGBColorSpace hardcoded in parse()
  // (fa scattare l'early-return `if (inputColorSpace !== SRGBColorSpace)
  // return;` dentro _assignVertexColorSpace) — sostituendo temporaneamente
  // loader.parse, l'unico modo per passare un vertexColorSpace diverso
  // restando su loadAsync() (che gestisce fetch/progress per noi). Poi
  // rifacciamo NOI STESSI la stessa identica conversione qui sotto, ma ad
  // attribute.normalized già correttamente impostato — stesso identico
  // codice di _assignVertexColorSpace, semplicemente eseguito nell'ordine
  // giusto.
  loader.parse = (buffer, onLoad, onError) => {
    loader.decodeDracoFile(buffer, onLoad, null, null, THREE.NoColorSpace, onError).catch(onError);
  };

  const geom = await loader.loadAsync(url, wrapProgress(onProgress));
  loader.dispose(); // rilascia WebAssembly decoder dopo il caricamento, come loadGLTF

  if (geom.hasAttribute('color')) {
    const colorAttr = geom.getAttribute('color');
    const _color = new THREE.Color();
    for (let i = 0; i < colorAttr.count; i++) {
      _color.fromBufferAttribute(colorAttr, i);
      THREE.ColorManagement.colorSpaceToWorking(_color, THREE.SRGBColorSpace);
      colorAttr.setXYZ(i, _color.r, _color.g, _color.b);
    }
    colorAttr.needsUpdate = true;
  }

  // DIAGNOSTICA (2026-09-17): DRACOLoader decodifica SOLO gli attributi che
  // riconosce per tipo semantico Draco (POSITION/NORMAL/COLOR/TEX_COORD) —
  // se un file .drc porta il colore come attributo GENERIC (comune con
  // alcuni encoder/tool esterni, es. CLI draco_encoder senza i flag giusti,
  // o export da software che non tagga il colore come COLOR "vero"),
  // DRACOLoader lo ignora silenziosamente: nessun errore, nessun attributo
  // "color" nella geometria risultante → punti tutti bianchi (colore di
  // default di THREE.PointsMaterial). Questo log dice subito quale caso è:
  // se "color" non compare nella lista, il problema è nel file .drc (a
  // monte, nell'encoder usato), non nel loader qui.
  const attrNames = Object.keys(geom.attributes || {});
  console.log(`[loadDRC] Attributi decodificati: ${attrNames.join(', ') || '(nessuno)'}`);
  if (geom.hasAttribute('position')) {
    const p = geom.getAttribute('position');
    console.log(`[loadDRC] position: itemSize=${p.itemSize}, count=${p.count}, primi valori=`, Array.from(p.array.slice(0, 9)));
  }
  if (geom.hasAttribute('color')) {
    const c = geom.getAttribute('color');
    console.log(`[loadDRC] color: itemSize=${c.itemSize}, count=${c.count}, normalized=${c.normalized}, primi valori=`, Array.from(c.array.slice(0, 9)));

    // Il range "valido" dipende dal tipo dell'array e dal flag normalized:
    // - Float32Array (normalized=false): valori attesi in [0,1].
    // - Int/Uint*Array con normalized=true (il nostro caso da oggi, color
    //   forzato a Uint8Array sopra): valori attesi nel range del tipo
    //   intero (0-255 per Uint8Array) — la normalizzazione a [0,1] la fa
    //   la GPU in fase di render, NON il buffer JS qui.
    // Fuori da questi range indica che l'attributo "color" del file non
    // contiene dati colore validi per il tipo dichiarato (es. un altro
    // campo del dataset finito per errore nello slot COLOR in fase di
    // codifica, o un mismatch di versione della libreria Draco fra
    // encoder e decoder). Non è correggibile qui in lettura.
    const isFloat = c.array instanceof Float32Array;
    const maxOk = isFloat ? 1.0001 : (c.normalized ? 255 : (2 ** (c.array.BYTES_PER_ELEMENT * 8)) - 1);
    let outOfRange = false;
    for (let i = 0; i < c.array.length; i++) if (c.array[i] > maxOk || c.array[i] < 0) { outOfRange = true; break; }
    if (outOfRange) {
      console.warn(`[loadDRC] ATTENZIONE: i valori dell'attributo "color" escono dal range valido [0,${maxOk}] per il tipo ${c.array.constructor.name} — non sembrano un colore RGB valido. Il file .drc andrebbe verificato/ri-codificato a monte, oppure può trattarsi di un mismatch di versione della libreria Draco fra chi ha codificato il file e questo decoder (three@0.182.0).`);
    }
  } else {
    console.warn('[loadDRC] Nessun attributo "color" decodificato — il file .drc probabilmente non porta il colore come attributo Draco COLOR (es. encoder che lo scrive come GENERIC, o file senza colore). I punti useranno il colore di default (bianco).');
  }

  return geometryToObject3D(geom);
}

/**
 * Loader "di comodo" per file .ply non compressi (point cloud o mesh) —
 * PLY non applica alcuna compressione geometrica/entropica, a differenza di
 * .drc (Draco): file più pesanti sul server/rete, ma nessun passaggio di
 * conversione richiesto prima del caricamento. Il tool di conversione
 * PLY→Draco via browser è stato tentato e poi rimosso (vedi memoria di
 * progetto) — per ora la conversione va fatta con strumenti esterni.
 */
export async function loadPLY({ url, modelRow, onProgress }) {
  const loader = new PLYLoader();
  const geom = await loader.loadAsync(url, wrapProgress(onProgress));
  float64AttributesToFloat32(geom);
  return geometryToObject3D(geom);
}

/**
 * Dalla r185 PLYLoader legge le proprietà `double` come Float64BufferAttribute, che WebGL non
 * accetta ("Unsupported buffer data format"). Fino alla r182 il loader le convertiva da solo
 * a 32 bit: si fa qui la stessa conversione, così i PLY dei rilievi in doppia precisione si
 * aprono come prima (con la stessa precisione di prima).
 */
function float64AttributesToFloat32(geom) {
  for (const [name, attr] of Object.entries(geom.attributes)) {
    if (!(attr.array instanceof Float64Array)) continue;
    geom.setAttribute(name, new THREE.Float32BufferAttribute(attr.array, attr.itemSize, attr.normalized));
  }
  return geom;
}

export function loadPSH({ url, modelRow, onProgress }) {
    return new Promise((resolve, reject) => {
        const spec      = modelRow?.mod_spec;
        const raw       = typeof spec === 'string' ? (() => { try { return JSON.parse(spec); } catch { return null; } })() : spec;
        const raggio    = raw?.raggio    || 10;
        const meridiani = raw?.meridiani || 60;
        const paralleli = raw?.paralleli || 40;

        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(
            url,
            (texture) => {
                const geometry = new THREE.SphereGeometry(raggio, meridiani, paralleli);
                // (2026-10-17) Specchio sul solo asse X: facce e immagine rivolte verso l'interno, la
                // panoramica vista dal centro non è rovesciata (come l'esempio Three.js e model_PSG.mjs).
                // Prima era scale(-1, 1, -1): due segni meno = rotazione di 180° attorno a Y, nessuno
                // specchio — dall'interno l'immagine si vedeva dal rovescio, specchiata rispetto allo
                // spazio ricostruito dalla stessa foto (es. MoGe). Gli allineamenti calcolati prima con
                // TJS/Align/SphereToCloud vanno rifatti.
                geometry.scale(-1, 1, 1);
                texture.colorSpace = THREE.SRGBColorSpace;

                const panoMat = new THREE.MeshBasicMaterial({
                    name: 'panoMat',
                    map: texture,
                    transparent: true,
                    opacity: 1.0,
                    side: THREE.DoubleSide,
                });

                const mesh = new THREE.Mesh(geometry, panoMat);
                // Sfera panoramica: Collima/Misura non agganciano ai vertici e, con una mappa delle
                // distanze associata, danno punti 3D (TJS-pano-depth.mjs). mod_spec.panoDepth =
                // { url, scale } associa un EXR già all'apertura (si carica in background).
                mesh.userData.__tjs_panorama__ = true;
                if (raw?.panoDepth?.url) {
                    tjsSetPanoramaDepth(mesh, raw.panoDepth)
                        .catch((e) => console.warn('[loadPSH] mappa delle distanze:', e?.message ?? e));
                }
                resolve(mesh);
            },
            onProgress,
            (err) => reject(err),
        );
    });
}


/**
 * modelRow deve includere:
 *  - mod_abs_url
 *  - base_url
 */
export async function loadAnyModel(modelRow, hooks = {}) {
  const url = modelRow?.mod_abs_url || '';
  const baseUrl = modelRow?.base_url || '';
  const ext = getExt(url);

  const onProgress = hooks.onProgress;

  if (ext === 'gltf' || ext === 'glb') return loadGLTF({ url, modelRow, dracoDecoderPath: DEFAULT_DRACO_DECODER_PATH, onProgress });
  if (ext === 'obj') return loadOBJ({ url, baseUrl, modelRow, onProgress });
  if (ext === 'svg') return loadSVG({ url, baseUrl, modelRow, onProgress });
  if (ext === 'wrl' || ext === 'vrml' || ext === 'wrz') return loadVRML({ url, baseUrl, modelRow, onProgress, signal: hooks.signal });
  if (ext === 'drc') return loadDRC({ url, modelRow, dracoDecoderPath: DEFAULT_DRACO_DECODER_PATH, onProgress });
  if (ext === 'ply') return loadPLY({ url, modelRow, onProgress });
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return loadPSH({ url, modelRow, onProgress }); //Pano Spher HyRes
  throw new Error(`Formato non supportato: .${ext} (${url})`);
}

export { THREE };
