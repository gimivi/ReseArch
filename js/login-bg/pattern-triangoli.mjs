// js/login-bg/pattern-triangoli.mjs — generatore di sfondo "pattern a triangoli" per la pagina di accesso.
//
// Costruzione (messa a punto in _dev/pattern-triangoli.html, che resta lo strumento per provare i parametri):
//   triangolo rettangolo con i lati divisi in 9, 11 o 13 parti; i tratti 2°, 4°, … sono le "bocche";
//   ogni fascia unisce due bocche di lati diversi con due curve annidate, perpendicolari ai lati in pianta,
//   spaziali in alzato (5 punti di controllo, stessa pendenza ai due estremi, quote raccordate con le gemelle);
//   le sezioni di testa sono B-spline piane a 5 punti di grado 1, 2 o 3 (monogrado o misto), dalla base alla base;
//   il solido è lo sweep
//   a due binari fra le due sezioni, specchiato sotto il piano orizzontale.
//   Copia ruotata di 180° → rettangolo; ripetizione specchiata 6×6 centrata sull'origine, a quota 0,5
//   sopra una griglia a terra. Camera inclinata di 60° che inquadra solo il pattern, anche durante
//   l'animazione (traslazione laterale armonica in ciclo).
//
// Interfaccia comune dei generatori (vedi js/login-bg/login-bg.mjs):
//   export const meta = { id, title, paper: { url, citation } }
//   export function create(canvas, options) → { seed, exportOBJ(), destroy() }
//
// Coordinate: qui Z è in alto e il pattern sta sul piano XY (in Three.js di solito è Y in alto);
// l'OBJ esportato è riportato a Y in alto, in metri (un rettangolo del pattern è largo 1 m).

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

export const meta = {
  id: 'triangoli',
  title: 'Pattern a triangoli',
  paper: {
    url: 'https://series.francoangeli.it/index.php/oa/catalog/view/1016/880/5870',
    citation: '‘Modelli procedurali per l’ideazione, il controllo e la generazione della forma libera negli apparati decorativi’\n'
      + 'Jessica Romor, Graziano Mario Valenti\n'
      + 'DOI: https://doi.org/10.3280/oa-1016-c455',
  },
};

// Parametri (gli stessi valori predefiniti della pagina di prova)
const DEFAULTS = {
  ratio: 0.6, divs: [9, 11, 13], tension: 0.4,
  hmin: 0.03, hmax: 0.09, slope: 0.15, bump: 0, bulge: 0.5,
  degMode: 'rnd',   // grado delle sezioni: 'rnd' (monogrado o misto a caso), 'mono', 'mixed', '1', '2', '3'
  repeat: 'mirror', grid: 6,
  pz: 0.5, tilt: 60, fov: 60, amp: 0.01, cycle: 6,
  lightAz: 135, lightEl: 30,
  colors: { bg: 0x444444, solid: 0xeceef1, gridMajor: 0x822433, gridMinor: 0x8b8b8b },
  gridStep: 1, gridSub: 4, gridMajorPx: 2, gridHalf: 30,
};

// ---------- caso riproducibile ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
function shuffle(rnd, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// ---------- geometria piana ----------
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
function segX(p1, p2, p3, p4) {
  const d1 = cross(p4.x - p3.x, p4.y - p3.y, p1.x - p3.x, p1.y - p3.y);
  const d2 = cross(p4.x - p3.x, p4.y - p3.y, p2.x - p3.x, p2.y - p3.y);
  const d3 = cross(p2.x - p1.x, p2.y - p1.y, p3.x - p1.x, p3.y - p1.y);
  const d4 = cross(p2.x - p1.x, p2.y - p1.y, p4.x - p1.x, p4.y - p1.y);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
function polyX(A, B) {
  for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++)
    if (segX(A[i], A[i + 1], B[j], B[j + 1])) return true;
  return false;
}
// Bézier di grado qualsiasi (pesi unitari)
function bezier(c, N) {
  const deg = c.length - 1, out = [];
  const binom = [1]; for (let i = 1; i <= deg; i++) binom[i] = binom[i - 1] * (deg - i + 1) / i;
  for (let k = 0; k <= N; k++) {
    const t = k / N, u = 1 - t;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i <= deg; i++) {
      const b = binom[i] * Math.pow(t, i) * Math.pow(u, deg - i);
      x += b * c[i].x; y += b * c[i].y; z += b * (c[i].z ?? 0);
    }
    out.push({ x, y, z });
  }
  return out;
}
// B-spline di grado 1, 2 o 3 su 5 punti di controllo, nodi uniformi agli estremi (clamped).
// Grado 1: spezzata, con gli spigoli a w = ¼, ½, ¾ (i punti di controllo interni).
const KNOTS = {
  1: [0, 0, 0.25, 0.5, 0.75, 1, 1],
  2: [0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1],
  3: [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
};
function bspline(cp, w, p = 3) {
  const K = KNOTS[p], n = cp.length;
  if (w >= 1) return { ...cp[n - 1] };
  let k = p; while (k < n - 1 && w >= K[k + 1]) k++;   // intervallo: K[k] ≤ w < K[k+1]
  const d = []; for (let r = 0; r <= p; r++) d[r] = { ...cp[k - p + r] };
  for (let r = 1; r <= p; r++) for (let jj = p; jj >= r; jj--) {
    const i = jj + k - p, al = (w - K[i]) / (K[i + p + 1 - r] - K[i]);
    for (const key in d[jj]) d[jj][key] = d[jj - 1][key] * (1 - al) + d[jj][key] * al;
  }
  return d[p];
}

// ---------- costruzione del triangolo ----------
// Triangolo antiorario: A=(0,0) angolo retto, B=(W,0), C=(0,H). Lati AB, BC (ipotenusa), CA.
const SIDES = [[0, 1], [1, 2], [2, 0]];

function partition(rnd, n, symmetric) {
  const w = Array.from({ length: n }, () => 0.35 + rnd());
  if (symmetric) for (let k = 0; k < n / 2; k++) w[n - 1 - k] = w[k];
  const tot = w.reduce((a, b) => a + b, 0), ts = [];
  let acc = 0;
  for (let k = 0; k < n - 1; k++) { acc += w[k]; ts.push(acc / tot); }
  return ts;
}
function reachInside(P, V, ownSide) {
  let best = Infinity;
  SIDES.forEach(([i, j], s) => {
    if (s === ownSide) return;
    const A = V[i], B = V[j], ex = B.x - A.x, ey = B.y - A.y;
    const den = cross(P.nx, P.ny, ex, ey);
    if (Math.abs(den) < 1e-12) return;
    const t = cross(A.x - P.x, A.y - P.y, ex, ey) / den;
    const u = cross(A.x - P.x, A.y - P.y, P.nx, P.ny) / den;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  });
  return best;
}
function randomSection(rnd, p, deg) {
  const a = p.bulge, j = () => 2 * rnd() - 1, lo = 0.15;
  const r = [j(), j(), j(), j(), j(), j()];
  const clamp01 = x => Math.min(1, Math.max(0, x));
  const u1 = clamp01(0.12 + 0.12 * a * r[0]), u2 = clamp01(0.5 + 0.25 * a * r[1]), u3 = clamp01(0.88 + 0.12 * a * r[2]);
  const z1 = Math.max(lo, 1 + 0.6 * a * r[3]), z2 = Math.max(lo, 1 + a * r[4]), z3 = Math.max(lo, 1 + 0.6 * a * r[5]);
  const s = [{ u: 0, z: 0 }, { u: u1, z: z1 }, { u: Math.min(Math.max(u2, u1), u3), z: z2 }, { u: u3, z: z3 }, { u: 1, z: 0 }];
  s.deg = deg;
  return s;
}

function buildTriangle(p, rnd) {
  const W = 1, H = p.ratio;
  const V = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: 0, y: H }];

  // bocche per lato (n-1)/2: totale pari e lato più ricco non oltre la somma degli altri due
  const ok = d => { const m = d.map(n => (n - 1) / 2), t = m[0] + m[1] + m[2]; return t % 2 === 0 && Math.max(...m) <= t - Math.max(...m); };
  let divs;
  do { divs = [0, 1, 2].map(() => pick(rnd, p.divs)); } while (!ok(divs));

  const mouths = [], bySide = [[], [], []];
  SIDES.forEach(([i, j], s) => {
    const ts = partition(rnd, divs[s], s === 1); // ipotenusa simmetrica: la copia ruotata ritrova i suoi punti
    const A = V[i], B = V[j], O = V[3 - i - j];
    let nx = -(B.y - A.y), ny = B.x - A.x;
    const len = Math.hypot(nx, ny); nx /= len; ny /= len;
    if (nx * (O.x - A.x) + ny * (O.y - A.y) < 0) { nx = -nx; ny = -ny; }
    const pts = ts.map(t => {
      const q = { side: s, x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, nx, ny };
      q.reach = reachInside(q, V, s);
      return q;
    });
    for (let k = 0; k < pts.length; k += 2) {
      const m = { side: s, k: k / 2, p: [pts[k], pts[k + 1]] };
      mouths.push(m); bySide[s].push(m);
    }
  });

  // accoppiamento delle bocche: mai sullo stesso lato, ognuna una volta sola
  const pools = [0, 1, 2].map(s => shuffle(rnd, bySide[s].slice()));
  const feasible = c => { const m = Math.max(...c); return m <= c[0] + c[1] + c[2] - m; };
  const bands = [];
  for (;;) {
    const c = pools.map(g => g.length);
    const cand = [[0, 1], [0, 2], [1, 2]].filter(([a, b]) => {
      if (!c[a] || !c[b]) return false;
      const d = c.slice(); d[a]--; d[b]--; return feasible(d);
    });
    if (!cand.length) break;
    const [a, b] = pick(rnd, cand);
    bands.push({ m1: pools[a].pop(), m2: pools[b].pop() });
  }
  shuffle(rnd, bands);

  // curve in pianta: esterna a1 → b2, interna a2 → b1 (annidate), perpendicolari ai lati, dentro il triangolo
  const ctrl = (a, b, tension) => {
    const d = tension * Math.hypot(b.x - a.x, b.y - a.y);
    const da = Math.min(d, 0.9 * a.reach), db = Math.min(d, 0.9 * b.reach);
    return [a, { x: a.x + a.nx * da, y: a.y + a.ny * da }, { x: b.x + b.nx * db, y: b.y + b.ny * db }, b];
  };
  for (const band of bands) {
    const [a1, a2] = band.m1.p, [b1, b2] = band.m2.p;
    let f = 1, c1, c2;
    for (let it = 0; it < 16; it++, f *= 0.8) {
      c1 = ctrl(a1, b2, p.tension * f);
      c2 = ctrl(a2, b1, p.tension * f);
      if (!segX(c1[0], c1[1], c1[2], c1[3]) && !segX(c2[0], c2[1], c2[2], c2[3]) && !polyX(bezier(c1, 40), bezier(c2, 40))) break;
    }
    band.c1 = c1; band.c2 = c2;
  }

  // quote e pendenze alle bocche, raccordate con la bocca gemella oltre il lato
  // (con la ripetizione specchiata, sui cateti la gemella è la bocca stessa → pendenza nulla)
  const twin = m => (m.side === 1 || p.repeat === 'trans') ? bySide[m.side][bySide[m.side].length - 1 - m.k] : m;
  const other = new Map();
  for (const b of bands) { other.set(b.m1, b.m2); other.set(b.m2, b.m1); }
  const quota = new Map();
  for (const m of mouths) if (!quota.has(m)) {
    const h = p.hmin + (p.hmax - p.hmin) * rnd();
    quota.set(m, h); quota.set(twin(m), h);
  }
  const floor = Math.max(0.002, p.hmin * 0.25);
  const sign = new Map(), sigma = new Map();
  for (const start of mouths) {
    if (sign.has(start)) continue;
    const comp = []; let zero = false;
    sign.set(start, 1); const queue = [start];
    while (queue.length) {
      const m = queue.shift(); comp.push(m);
      for (const n of [twin(m), other.get(m)]) {
        if (!n) continue;
        if (n === m) { zero = true; continue; }
        if (!sign.has(n)) { sign.set(n, -sign.get(m)); queue.push(n); }
        else if (sign.get(n) === sign.get(m)) zero = true;
      }
    }
    const s0 = rnd() < 0.5 ? 1 : -1;
    let mag = zero ? 0 : p.slope * rnd();
    for (const b of bands) {
      if (!comp.includes(b.m1)) continue;
      const kSign = s0 * sign.get(b.m2), H1 = quota.get(b.m1), H2 = quota.get(b.m2);
      for (const c of [b.c1, b.c2]) {
        const da = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), db = Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y);
        if (kSign < 0 && da > 0) mag = Math.min(mag, (H1 - floor) / da);
        if (kSign > 0 && db > 0) mag = Math.min(mag, (H2 - floor) / db);
      }
    }
    mag = Math.max(0, mag);
    for (const m of comp) sigma.set(m, s0 * sign.get(m) * mag);
  }

  // binari spaziali: 5 punti di controllo (la cubica in pianta elevata al quarto grado)
  const lift = (c, z0, z3, k) => {
    const da = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), db = Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y);
    const z1 = z0 + k * da, z2 = z3 - k * db;
    const mix = (a, b, wa) => ({ x: a.x * wa + b.x * (1 - wa), y: a.y * wa + b.y * (1 - wa) });
    return [
      { x: c[0].x, y: c[0].y, z: z0 },
      { ...mix(c[0], c[1], 0.25), z: (z0 + 3 * z1) / 4 },
      { ...mix(c[1], c[2], 0.5), z: (z1 + z2) / 2 },
      { ...mix(c[2], c[3], 0.75), z: (3 * z2 + z3) / 4 },
      { x: c[3].x, y: c[3].y, z: z3 },
    ];
  };
  for (const b of bands) {
    const k = sigma.get(b.m2), H1 = quota.get(b.m1), H2 = quota.get(b.m2);
    let bump = p.bump * (2 * rnd() - 1);
    b.q1 = lift(b.c1, H1, H2, k); b.q2 = lift(b.c2, H1, H2, k);
    bump = Math.max(bump, floor - Math.min(b.q1[2].z, b.q2[2].z));
    b.q1[2].z += bump; b.q2[2].z += bump;
  }

  // sezioni alle bocche (la bocca gemella ha la stessa sezione letta al contrario, grado compreso).
  // Grado: "mono" = un grado a caso per tutto il pattern, "mixed" = un grado a caso per bocca,
  // "rnd" = sceglie fra i due; oppure 1, 2, 3 fisso.
  let mode = p.degMode, fixedDeg = null;
  if (mode === 'rnd') mode = rnd() < 0.5 ? 'mono' : 'mixed';
  if (mode === 'mono') fixedDeg = 1 + Math.floor(rnd() * 3);
  else if (mode !== 'mixed') fixedDeg = +mode;
  const degOf = () => fixedDeg ?? 1 + Math.floor(rnd() * 3);
  const reverse = s => Object.assign(s.map(q => ({ u: 1 - q.u, z: q.z })).reverse(), { deg: s.deg });
  const secs = new Map();
  for (const m of mouths) if (!secs.has(m)) {
    const s = randomSection(rnd, p, degOf());
    secs.set(m, s);
    const tw = twin(m);
    if (tw !== m) secs.set(tw, reverse(s));
  }
  for (const b of bands) { b.s1 = secs.get(b.m1); b.s2 = reverse(secs.get(b.m2)); }

  return { W, H, bands };
}

// ---------- solido di una fascia ----------
function grid(rows) {
  const R = rows.length, C = rows[0].length, pos = new Float32Array(R * C * 3), idx = [];
  rows.forEach((row, i) => row.forEach((q, j) => pos.set([q.x, q.y, q.z], (i * C + j) * 3)));
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++) {
    const a = i * C + j, b = a + 1, c = a + C, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const mirrorZ = r => r.map(q => ({ x: q.x, y: q.y, z: -q.z }));
// sweep a due binari fra la sezione di inizio e quella di fine (fusione smoothstep dei punti delle due curve:
// funziona anche fra gradi diversi). M multiplo di 4: le colonne 6, 12, 18 cadono sugli spigoli del grado 1.
function bandRows(b, N = 48, M = 24) {
  const R1 = bezier(b.q1, N), R2 = bezier(b.q2, N), rows = [];
  const S1 = [], S2 = [];
  for (let j = 0; j <= M; j++) { S1.push(bspline(b.s1, j / M, b.s1.deg)); S2.push(bspline(b.s2, j / M, b.s2.deg)); }
  for (let i = 0; i <= N; i++) {
    const t = i / N, s = t * t * (3 - 2 * t);
    const A = R1[i], B = R2[i], row = [];
    for (let j = 0; j <= M; j++) {
      const u = S1[j].u + (S2[j].u - S1[j].u) * s, z = S1[j].z + (S2[j].z - S1[j].z) * s;
      const hr = A.z + (B.z - A.z) * u;
      row.push({ x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u, z: hr * z });
    }
    rows.push(row);
  }
  rows.creases = (b.s1.deg === 1 || b.s2.deg === 1) ? [M / 4, M / 2, 3 * M / 4] : [];
  return rows;
}
// superficie divisa lungo le colonne degli spigoli: ogni pezzo ha le sue normali, così lo spigolo resta vivo
function creasedGrids(rows, creases) {
  const M = rows[0].length - 1, cuts = [0, ...creases, M], out = [];
  for (let k = 0; k < cuts.length - 1; k++) out.push(grid(rows.map(r => r.slice(cuts[k], cuts[k + 1] + 1))));
  return out;
}
function bandGeometry(rows) {
  const N = rows.length - 1, cr = rows.creases || [];
  const parts = [...creasedGrids(rows, cr), ...creasedGrids(rows.map(mirrorZ), cr),
    grid([rows[0], mirrorZ(rows[0])]), grid([rows[N], mirrorZ(rows[N])])];
  const g = mergeGeometries(parts);
  parts.forEach(x => x.dispose());
  return g;
}

// ---------- scena ----------
export function create(canvas, options = {}) {
  const p = { ...DEFAULTS, ...options, colors: { ...DEFAULTS.colors, ...(options.colors || {}) } };
  const seed = options.seed ?? (1 + Math.floor(Math.random() * 999999));
  const reduceMotion = options.reduceMotion ?? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(p.colors.bg, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(p.fov, 1, 0.01, 100);
  camera.up.set(0, 0, 1);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xe5e7eb, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0015;
  sun.shadow.normalBias = 0.004;
  scene.add(sun, sun.target);

  const disposables = [];
  const keep = x => (disposables.push(x), x);

  // --- triangolo e rettangolo (originale + copia ruotata di 180° attorno al centro dell'ipotenusa) ---
  const T = buildTriangle(p, mulberry32(seed));
  const { W, H } = T;
  const solidMat = keep(new THREE.MeshStandardMaterial({ color: p.colors.solid, roughness: 0.9, side: THREE.DoubleSide }));
  const triMeshes = T.bands.map((b, i) => {
    const m = new THREE.Mesh(keep(bandGeometry(bandRows(b))), solidMat);
    m.name = `fascia_${i + 1}`;
    return m;
  });
  const rotCopy = new THREE.Matrix4().makeRotationZ(Math.PI).setPosition(W, H, 0);

  // --- ripetizione n×n specchiata, centrata sull'origine, a quota pz ---
  const n = p.grid, placements = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const m = new THREE.Matrix4();
    if (p.repeat === 'mirror') {
      const fx = i % 2 !== 0, fy = j % 2 !== 0;
      m.makeScale(fx ? -1 : 1, fy ? -1 : 1, 1).setPosition(fx ? (i + 1) * W : i * W, fy ? (j + 1) * H : j * H, 0);
    } else m.makeTranslation(i * W, j * H, 0);
    placements.push(new THREE.Matrix4().makeTranslation(-n * W / 2, -n * H / 2, p.pz).multiply(m));
  }
  const extent = { x0: -n * W / 2, x1: n * W / 2, y0: -n * H / 2, y1: n * H / 2 };
  // Copie come InstancedMesh; le tessere ribaltate una volta sola (determinante negativo) usano la geometria
  // con le facce girate, perché l'illuminazione resti giusta.
  for (const mesh of triMeshes) {
    for (const local of [new THREE.Matrix4(), rotCopy]) {
      const groups = [placements.filter(m => m.determinant() > 0), placements.filter(m => m.determinant() < 0)];
      groups.forEach((list, flip) => {
        if (!list.length) return;
        let g = mesh.geometry;
        if (flip) {
          g = keep(g.clone());
          const idx = g.index.array;
          for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
        }
        const inst = new THREE.InstancedMesh(g, solidMat, list.length);
        list.forEach((m, q) => inst.setMatrixAt(q, new THREE.Matrix4().multiplyMatrices(m, local)));
        inst.castShadow = inst.receiveShadow = true;
        inst.computeBoundingSphere();
        scene.add(inst);
        disposables.push(inst);
      });
    }
  }

  // --- griglia a terra (quota 0): principali a 2 px (LineSegments2), secondarie a 1 px ---
  // ogni linea in tratti di 1 m: i segmenti lunghi che passano dietro la camera vengono ritagliati male
  const lineMats = [];
  {
    const S = p.gridHalf, sub = p.gridSub, minorStep = p.gridStep / sub, maj = [], min = [];
    const k0 = Math.floor(S / minorStep);
    for (let k = -k0; k <= k0; k++) {
      const v = k * minorStep, arr = k % sub === 0 ? maj : min;
      for (let a = -S; a < S; a++) arr.push(v, a, 0, v, a + 1, 0, a, v, 0, a + 1, v, 0);
    }
    if (min.length) {
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(min, 3));
      scene.add(new THREE.LineSegments(g, keep(new THREE.LineBasicMaterial({ color: p.colors.gridMinor }))));
    }
    if (maj.length) {
      const g = keep(new LineSegmentsGeometry()); g.setPositions(maj);
      const m = keep(new LineMaterial({ color: p.colors.gridMajor, linewidth: p.gridMajorPx, worldUnits: false }));
      lineMats.push(m);
      scene.add(new LineSegments2(g, m));
    }
  }

  // --- luce ---
  {
    const r = Math.max(extent.x1 - extent.x0, extent.y1 - extent.y0);
    const az = THREE.MathUtils.degToRad(p.lightAz), el = THREE.MathUtils.degToRad(p.lightEl);
    sun.position.set(Math.cos(az) * Math.cos(el) * r * 2, Math.sin(az) * Math.cos(el) * r * 2, p.pz + Math.sin(el) * r * 2);
    sun.target.position.set(0, 0, p.pz);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -r * 0.8; sc.right = sc.top = r * 0.8; sc.near = 0.01; sc.far = r * 5;
    sc.updateProjectionMatrix();
  }

  // --- inquadratura: dal lato +Y, inclinata verso il basso; quota e posizione tali che il campo visivo,
  //     sul piano del pattern, resti dentro il pattern anche con lo spostamento dell'animazione (±A) ---
  const forward = new THREE.Vector3();
  const base = new THREE.Vector3();
  const right = new THREE.Vector3(-1, 0, 0);
  function frame() {
    const th = THREE.MathUtils.degToRad(p.tilt), c = Math.cos(th), s = Math.sin(th);
    const tV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tH = tV * camera.aspect;
    const f = { x: 0, y: -c, z: -s }, r = { x: -1, y: 0, z: 0 }, u = { x: 0, y: -s, z: c };
    const xs = [], ys = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const d = { x: f.x + sx * tH * r.x + sy * tV * u.x, y: f.y + sx * tH * r.y + sy * tV * u.y, z: f.z + sx * tH * r.z + sy * tV * u.z };
      if (d.z >= -1e-6) continue;
      const t = -1 / d.z; xs.push(t * d.x); ys.push(t * d.y);
    }
    const Wp = extent.x1 - extent.x0, Dp = extent.y1 - extent.y0, A = p.amp * Wp;
    let h = 2, yc = extent.y1;
    if (xs.length === 4) {
      const halfX = Math.max(...xs.map(Math.abs)), spanY = Math.max(...ys) - Math.min(...ys);
      h = 0.98 * Math.min(Dp / spanY, Math.max(0, Wp / 2 - A) / halfX);
      yc = -h * (Math.max(...ys) + Math.min(...ys)) / 2;
    }
    base.set(0, yc, p.pz + h);
    forward.set(f.x, f.y, f.z);
    camera.position.copy(base);
    camera.lookAt(base.clone().add(forward));
  }

  // --- animazione: x = −A·sin(2πt/T), con l'ampiezza che cresce nel primo mezzo ciclo (partenza morbida) ---
  const smooth01 = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  let raf = 0, t0 = 0, running = false;
  function render() { renderer.render(scene, camera); }
  function step(now) {
    if (!t0) t0 = now;
    const t = (now - t0) / 1000, T = p.cycle, A = p.amp * (extent.x1 - extent.x0);
    const off = -A * smooth01(t / (T / 2)) * Math.sin(2 * Math.PI * t / T);
    camera.position.copy(base).addScaledVector(right, off);
    render();
    raf = requestAnimationFrame(step);
  }

  function resize() {
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (!w || !hgt) return;
    renderer.setSize(w, hgt, false);
    const pr = renderer.getPixelRatio();
    lineMats.forEach(m => m.resolution.set(w * pr, hgt * pr));
    camera.aspect = w / hgt; camera.updateProjectionMatrix();
    frame();
    if (!running) render();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  if (!reduceMotion) { running = true; raf = requestAnimationFrame(step); }

  // --- modello di un triangolo in OBJ (Y in alto, metri) ---
  function exportOBJ() {
    const g = new THREE.Group();
    g.rotation.x = -Math.PI / 2; // Z in alto → Y in alto
    triMeshes.forEach(m => g.add(m.clone()));
    g.updateMatrixWorld(true);
    const head = `# ${meta.title} — un triangolo del pattern (seme ${seed})\n`
      + `# Y in alto, unità: metri. ${meta.paper.url}\n`;
    // 5 decimali (1/100 di mm): il file si dimezza circa
    const obj = new OBJExporter().parse(g).replace(/-?\d+\.\d{6,}(e-?\d+)?/g, x => (+x).toFixed(5));
    return head + obj;
  }

  function destroy() {
    cancelAnimationFrame(raf); running = false;
    ro.disconnect();
    disposables.forEach(x => x.dispose?.());
    renderer.dispose();
  }

  return { seed, exportOBJ, destroy };
}
