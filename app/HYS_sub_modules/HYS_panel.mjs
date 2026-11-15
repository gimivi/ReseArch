// HYS_sub_modules/HYS_panel.mjs
//
// Modulo: generazione pannelli espositivi ("Quadri") dentro una stanza/slot.
// - Prende i paragrafi della REST (immagini)
// - Applica il piano di distribuzione PPlan (quante immagini su ciascuna delle 8 zone)
// - Usa le specifiche geometriche del template, lette da mod_spec (zone: x,z,rotDeg,width)
//
// Dipendenze: THREE passato dall'esterno (tramite hs.THREE o parametro).

/** Piano di distribuzione pannelli: PPlan[totImages] -> 8 zone con 0|1|2|4. */
export const HYS_DEFAULT_PPLAN = [
  [4, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 1, 0, 1, 0, 0, 0],
  [1, 0, 1, 0, 1, 0, 1, 0],
  [1, 0, 1, 0, 1, 0, 1, 1],
  [1, 1, 1, 0, 1, 0, 1, 1],
  [1, 1, 1, 0, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 2, 1, 1, 1, 1, 1],
  [1, 1, 2, 1, 1, 2, 1, 1],
  [1, 1, 2, 2, 1, 2, 1, 1],
  [1, 1, 2, 2, 2, 2, 1, 1],
  [1, 1, 4, 2, 2, 1, 1, 1],
  [1, 1, 4, 2, 2, 2, 1, 1],
  [1, 2, 4, 2, 2, 2, 1, 1],
  [1, 1, 4, 2, 2, 4, 1, 1],
];

/**
 * Rimuove E libera (geometrie, materiali, texture) tutti i gruppi "Quadri"
 * sotto un nodo. I pannelli sono di proprietà esclusiva della stanza, a
 * differenza della geometria del modello (condivisa con la cache dei cloni).
 */
export function HYS_disposeExpoPanels(root) {
  if (!root) return;
  const olds = [];
  root.traverse((o) => { if (o.name === "Quadri") olds.push(o); });
  for (const q of olds) {
    q.parent?.remove(q);
    q.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { m?.map?.dispose?.(); m?.dispose?.(); }
    });
  }
}

/**
 * Carica una texture (Promise) con cache opzionale.
 * Ruolo:
 * - I pannelli sono asincroni: vogliamo poter "await" e sapere quando sono pronti
 * - Cache: evita di ricaricare la stessa immagine più volte
 */
export function HYS_loadTextureAsync(THREE, loader, url, textureCache) {
  if (textureCache?.has(url)) return Promise.resolve(textureCache.get(url));

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        // foto = colore sRGB: senza questo, con three r152+ appaiono sbiadite
        tex.colorSpace = THREE.SRGBColorSpace;
        textureCache?.set(url, tex);
        resolve(tex);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

/**
 * Dato count (1|2|4) restituisce righe/colonne per la griglia.
 * Ruolo:
 * - Incapsula la regola: 1->1x1, 2->2x1, 4->2x2
 */
export function HYS_gridForCount(count) {
  if (count === 2) return { cols: 2, rows: 1 };
  if (count === 4) return { cols: 2, rows: 2 };
  return { cols: 1, rows: 1 };
}

/**
 * Crea un gruppo-zona con N immagini impaginate a griglia.
 * Ruolo:
 * - Costruisce i PlaneGeometry per "cornice" e "immagine"
 * - Mantiene aspect ratio dell'immagine dentro la cella (fit)
 * - Centra la griglia in (0,0) così poi la zona può essere solo traslata/ruotata
 */
export async function HYS_buildZoneGroup({
  THREE,
  loader,
  textureCache,
  imageUrls,
  zoneWidth,
  zoneHeight,
  frameMargin = 0.20,
  pictureMargin = 0.40,
  frameMaterial = null,
}) {
  const group = new THREE.Group();

  const count = imageUrls.length;
  const { cols, rows } = HYS_gridForCount(count);

  const cellW = zoneWidth / cols;
  const cellH = zoneHeight / rows;

  const matFrame =
    frameMaterial ??
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.30 });

  // Carico tutte le texture della zona. Un'immagine mancante (404) viene
  // saltata: prima faceva fallire l'intera catena, e spariva OGNI pannello.
  const textures = [];
  for (const url of imageUrls) {
    try {
      textures.push(await HYS_loadTextureAsync(THREE, loader, url, textureCache));
    } catch {
      console.warn(`[HYS] immagine non caricata: ${url}`);
    }
  }

  // Creo mesh per ogni cella
  textures.forEach((texture, index) => {
    const img = texture.image;
    const aspect = (img?.width && img?.height) ? (img.width / img.height) : 1;

    // fit dell'immagine nella cella, mantenendo proporzioni
    let w, h;
    if (aspect >= 1) {
      w = cellW;
      h = cellW / aspect;
      if (h > cellH) { // se sfora in altezza, rifit
        h = cellH;
        w = cellH * aspect;
      }
    } else {
      h = cellH;
      w = cellH * aspect;
      if (w > cellW) { // se sfora in larghezza, rifit
        w = cellW;
        h = cellW / aspect;
      }
    }

    const frameGeo = new THREE.PlaneGeometry(Math.max(0.01, w - frameMargin), Math.max(0.01, h - frameMargin));
    const picGeo   = new THREE.PlaneGeometry(Math.max(0.01, w - pictureMargin), Math.max(0.01, h - pictureMargin));

    const picMat = new THREE.MeshBasicMaterial({ map: texture });

    const frame = new THREE.Mesh(frameGeo, matFrame);
    const pic   = new THREE.Mesh(picGeo, picMat);

    const col = index % cols;
    const row = Math.floor(index / cols);

    // centro griglia su (0,0)
    const x0 = (col + 0.5) * cellW - (zoneWidth / 2);
    const y0 = (zoneHeight / 2) - (row + 0.5) * cellH;

    frame.position.set(x0, y0, 0.05);
    pic.position.set(x0, y0, 0.06);

    group.add(frame);
    group.add(pic);
  });

  return group;
}

/**
 * Funzione principale: genera i pannelli di una stanza e li aggancia a slotGroup
 * (la radice del modello della stanza, così i pannelli viaggiano con lei).
 * - Usa PPlan per decidere quante immagini per zona
 * - Usa roomSpec.zones[i] per posizionare/ruotare ogni zona
 * - imageUrls: URL già risolti dal server (api/HySpace_rest_api.php)
 * - isStillValid(): richiamata a fine costruzione (le texture arrivano in modo
 *   asincrono): se nel frattempo la stanza ha cambiato esercitazione o è stata
 *   distrutta, i pannelli costruiti vengono liberati invece che agganciati.
 * La pulizia dei pannelli precedenti spetta al caller (HYS_disposeExpoPanels).
 *
 * roomSpec atteso (dal mod_spec del template):
 * {
 *   expo: {
 *     zones: [
 *       { x, z, rotDeg, width },
 *       ... 8 elementi ...
 *     ],
 *     panelsY: 1.65,     // opzionale (default)
 *     panelHeight: 3.0  // opzionale (default)
 *   }
 * }
 */
export async function HYS_buildExpoPanelsForSlot({
  THREE,
  slotGroup,
  roomSpec,
  imageUrls,
  PPlan = HYS_DEFAULT_PPLAN,
  maxImages = 16,
  isStillValid = null,
}) {
  if (!THREE || !slotGroup || !roomSpec?.expo?.zones?.length || !imageUrls?.length) return;

  // 1) immagini
  const allImages = imageUrls;
  const tot = Math.min(allImages.length, maxImages);
  if (tot <= 0) return;

  // 2) prendi la distribuzione 8-zone
  const plan = PPlan[tot];
  if (!Array.isArray(plan) || plan.length !== 8) return;

  // 3) setup loader + cache
  const loader = new THREE.TextureLoader();
  const textureCache = new Map(); // puoi anche passarla dall'esterno se vuoi cache globale

  // 4) gruppo contenitore
  const root = new THREE.Group();
  root.name = "Quadri";

  const panelsY = Number(roomSpec.expo.panelsY ?? 1.65);
  const panelH = Number(roomSpec.expo.panelHeight ?? 3.0);

  // indice progressivo sulle immagini
  let idx = 0;

  // 5) costruzione 8 zone
  for (let i = 0; i < 8; i++) {
    const count = plan[i] | 0;
    if (count <= 0) continue;

    const zone = roomSpec.expo.zones[i];
    if (!zone) continue;

    const urls = allImages.slice(idx, idx + count);
    idx += count;
    if (!urls.length) continue;

    const zoneWidth = Number(zone.width ?? 3.0);

    const panelMargin = Number(roomSpec.expo.panelMargin ?? 0.20);
    const frameMargin = panelMargin;        // es. 0.20
    const pictureMargin = panelMargin * 2;  // es. 0.40

    const zoneGroup = await HYS_buildZoneGroup({
      THREE,
      loader,
      textureCache,
      imageUrls: urls,
      zoneWidth,
      zoneHeight: panelH,
      frameMargin,
      pictureMargin,
    });

    // posizionamento/rotazione della zona
    zoneGroup.rotation.y = (Number(zone.rotDeg ?? 0) * Math.PI) / 180;
    zoneGroup.position.set(Number(zone.x ?? 0), panelsY, Number(zone.z ?? 0));

    root.add(zoneGroup);
  }

  // 6) attach alla stanza, solo se contiene ancora la stessa esercitazione
  if (isStillValid && !isStillValid()) {
    const tmp = new THREE.Group();
    tmp.add(root);
    HYS_disposeExpoPanels(tmp);
    return;
  }
  slotGroup.add(root);
}
