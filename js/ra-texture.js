// js/ra-texture.js — piastrelle di sfondo "a filigrana": motivi architettonici (islamici, romanici)
// scolpiti in rilievo, bianco e grigio, ripetibili senza giunte. Script classico, nessuna libreria.
//
//   const c = raTexture.generate({ seed: 123, family: 'auto' });   // HTMLCanvasElement
//   el.style.backgroundImage = `url(${c.toDataURL()})`;
//   raTexture.applyBackground(document.body, { seed: Date.now() });
//   raTexture.seedFrom('research-42')                              // seme fisso da un testo
//
// Come funziona (prova: _dev/texture-preview.html):
//  1. il motivo si disegna su due mappe: i NASTRI (cordoni in rilievo) e il TIPO dei campi fra i
//     nastri (piramide in rilievo, piramide incavata, fondo piano). Il reticolo è periodico e la
//     piastrella ne contiene un numero intero di periodi: si ripete senza giunte;
//  2. con la trasformata della distanza (ciclica) si ricavano le altezze: profilo arrotondato dei
//     nastri (mezzo cilindro, eventualmente con scanalatura) e sfaccettature dei campi, che crescono
//     o calano con la distanza dal nastro (in un poligono: una piramide con gli spigoli al centro);
//  3. luce: diffusa, ombre portate lungo il raggio di luce e incavi più scuri (occlusione);
//     tutto ciclico. Colori: zone piane quasi bianche, ombre fino a #b3b3b3 (30% di nero).
// Una piastrella da 300-400 px richiede poche decine di millisecondi: niente immagini su disco.
(function () {
    "use strict";

    // ── numeri casuali riproducibili ─────────────────────────────────────────
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    /** Seme intero da un testo qualsiasi (es. "res-12"): stesso testo, stessa piastrella. */
    function seedFrom(text) {
        let h = 2166136261 >>> 0;
        for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
        return h >>> 0;
    }

    const TAU = Math.PI * 2;
    const SQRT3 = Math.sqrt(3);

    // Tipi dei campi (mappa "kind"): valori di grigio letti poi dal canale rosso
    const KIND = { SUNKEN: 0, FLAT: 128, RAISED: 255 };
    const kindStyle = (k) => `rgb(${k},${k},${k})`;

    // ── strumenti di disegno ──────────────────────────────────────────────────
    function poly(ctx, pts) {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
    }
    function star(cx, cy, n, R, r, rot) {
        const pts = [];
        for (let k = 0; k < 2 * n; k++) {
            const ang = rot + k * Math.PI / n;
            const rad = k % 2 ? r : R;
            pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
        }
        return pts;
    }
    /** Contesto di disegno di una famiglia: nastri (S) e tipi dei campi (K). */
    function painter(S, K, P) {
        return {
            /** Nastro in rilievo lungo il percorso. */
            strap(pathFn, width = P.strap) {
                S.lineJoin = "round"; S.lineCap = "round";
                pathFn(S); S.strokeStyle = "#fff"; S.lineWidth = width; S.stroke();
            },
            /** Campo: piramide in rilievo (RAISED), incavata (SUNKEN) o fondo piano (FLAT). */
            field(kind, pathFn) { pathFn(K); K.fillStyle = kindStyle(kind); K.fill(); },
        };
    }

    // ── famiglie di motivi ────────────────────────────────────────────────────
    // params(rnd) → parametri; tile(P) → {w,h}; draw(g, P, w, h) con g = painter(...).
    // Le coordinate dei reticoli sono frazioni esatte di w e h: la piastrella è periodica.
    const pickKind = (rnd) => [KIND.RAISED, KIND.SUNKEN, KIND.RAISED, KIND.FLAT][Math.floor(rnd() * 4)];

    const FAMILIES = {
        // Stella a 8 punte con nastri (khatam), reticolo quadrato
        khatam: {
            label: "Islamico — stella a 8 punte",
            params: (rnd) => ({ n: 1 + Math.floor(rnd() * 2), a: 120 + rnd() * 70, R: 0.36 + rnd() * 0.08,
                                inner: 0.62 + rnd() * 0.12, strap: 9 + rnd() * 6, center: rnd() < 0.6,
                                bg: pickKind(rnd), fill: pickKind(rnd) }),
            tile: (P) => { const w = Math.round(P.a * P.n); return { w, h: w }; },
            draw(g, P, w, h) {
                const a = w / P.n, R = P.R * a, r = R * P.inner, d = R * Math.SQRT1_2;
                for (let i = -1; i <= P.n; i++) for (let j = -1; j <= P.n; j++) {
                    const cx = i * a, cy = j * a, pts = star(cx, cy, 8, R, r, 0);
                    g.field(P.fill, (c) => poly(c, pts));
                    g.strap((c) => poly(c, pts));
                    g.strap((c) => {
                        c.beginPath();
                        c.moveTo(cx + R, cy); c.lineTo(cx + a - R, cy);
                        c.moveTo(cx, cy + R); c.lineTo(cx, cy + a - R);
                        c.moveTo(cx + d, cy + d); c.lineTo(cx + a - d, cy + a - d);
                        c.moveTo(cx + a - d, cy + d); c.lineTo(cx + d, cy + a - d);
                    });
                    if (P.center) {
                        const s = a * 0.13, mx = cx + a / 2, my = cy + a / 2;
                        const q = [[mx, my - s], [mx + s, my], [mx, my + s], [mx - s, my]];
                        g.field(KIND.RAISED, (c) => poly(c, q));
                        g.strap((c) => poly(c, q), P.strap * 0.6);
                    }
                }
            },
        },

        // Stelle a 6 / 12 punte su reticolo esagonale (girih)
        girih: {
            label: "Islamico — stelle esagonali",
            params: (rnd) => ({ n: 1 + Math.floor(rnd() * 2), a: 120 + rnd() * 60, R: 0.40 + rnd() * 0.06,
                                points: rnd() < 0.65 ? 6 : 12, inner: 0.55 + rnd() * 0.15,
                                strap: 8 + rnd() * 5, hexes: rnd() < 0.7, bg: pickKind(rnd), fill: pickKind(rnd) }),
            tile: (P) => ({ w: Math.round(P.a * P.n), h: Math.round(P.a * SQRT3 * P.n) }),
            draw(g, P, w, h) {
                const ax = w / P.n, ay = h / (2 * P.n), sy = (ay * 2 / SQRT3) / ax;   // sy ≈ 1: correzione d'arrotondamento
                const R = P.R * ax, r = R * P.inner;
                for (let j = -1; j <= 2 * P.n; j++) for (let i = -1; i <= P.n; i++) {
                    const cx = i * ax + (j % 2 ? ax / 2 : 0), cy = j * ay;
                    const pts = P.points === 6 ? star(cx, cy, 6, R, r * 0.9, 0) : star(cx, cy, 12, R, r, 0);
                    g.field(P.fill, (c) => poly(c, pts));
                    g.strap((c) => poly(c, pts));
                    g.strap((c) => {
                        c.beginPath();
                        for (let k = 0; k < 6; k++) {
                            const ang = k * Math.PI / 3, ux = Math.cos(ang), uy = Math.sin(ang) * sy;
                            const L = Math.hypot(ux, uy);
                            c.moveTo(cx + ux / L * R, cy + uy / L * R);
                            c.lineTo(cx + ux * ax / 2, cy + uy * ax / 2);
                        }
                    });
                    if (P.hexes) for (const ang of [Math.PI / 6, Math.PI * 7 / 6]) {
                        const hx = cx + (ax / SQRT3) * Math.cos(ang), hy = cy + (ax / SQRT3) * Math.sin(ang) * sy;
                        const hex = star(hx, hy, 3, ax * 0.13, ax * 0.13, Math.PI / 6);
                        g.field(KIND.RAISED, (c) => poly(c, hex));
                        g.strap((c) => poly(c, hex), P.strap * 0.6);
                    }
                }
            },
        },

        // Archetti ciechi intrecciati, a file sovrapposte (romanico)
        arcade: {
            label: "Romanico — archetti intrecciati",
            params: (rnd) => ({ n: 3 + Math.floor(rnd() * 2), s: 56 + rnd() * 30, rows: 2 + Math.floor(rnd() * 2),
                                interlace: rnd() < 0.75, strap: 7 + rnd() * 4, rowK: 1.1 + rnd() * 0.3,
                                bg: KIND.FLAT, fill: rnd() < 0.5 ? KIND.SUNKEN : KIND.RAISED }),
            tile: (P) => { const w = Math.round(P.s * P.n); return { w, h: Math.round(P.s * P.rowK * P.rows) }; },
            draw(g, P, w, h) {
                const s = w / P.n, hr = h / P.rows, rad = s / 2;
                for (let j = -1; j <= P.rows; j++) {
                    const top = j * hr, ys = top + hr * 0.52, base = top + hr * 0.94;
                    for (let k = -1; k <= P.n; k++) {
                        const x0 = k * s;
                        g.field(P.fill, (c) => { c.beginPath(); c.arc(x0 + rad, ys, rad, Math.PI, TAU); c.lineTo(x0 + s, base); c.lineTo(x0, base); c.closePath(); });
                        g.strap((c) => { c.beginPath(); c.arc(x0 + rad, ys, rad, Math.PI, TAU); });
                        if (P.interlace) g.strap((c) => { c.beginPath(); c.arc(x0 + s, ys, rad, Math.PI, TAU); });
                        g.strap((c) => { c.beginPath(); c.moveTo(x0, ys); c.lineTo(x0, base); });
                        if (P.interlace) g.strap((c) => { c.beginPath(); c.moveTo(x0 + rad, ys); c.lineTo(x0 + rad, base); }, P.strap * 0.8);
                    }
                    g.strap((c) => { c.beginPath(); c.moveTo(-s, base); c.lineTo(w + s, base); }, P.strap * 1.3);
                }
            },
        },

        // Rosoni e quadrilobi su reticolo quadrato, oppure "fiore della vita" su reticolo esagonale
        rosette: {
            label: "Romanico — rosoni e quadrilobi",
            params: (rnd) => ({ n: 1 + Math.floor(rnd() * 2), a: 110 + rnd() * 70, kind: rnd() < 0.55 ? "quatrefoil" : "flower",
                                strap: 7 + rnd() * 5, ring: 0.42 + rnd() * 0.06, bg: pickKind(rnd), fill: pickKind(rnd) }),
            tile: (P) => P.kind === "flower"
                ? { w: Math.round(P.a * P.n), h: Math.round(P.a * SQRT3 * P.n) }
                : { w: Math.round(P.a * P.n), h: Math.round(P.a * P.n) },
            draw(g, P, w, h) {
                if (P.kind === "flower") {
                    // cerchi di raggio uguale al passo: petali a 6 dalle intersezioni (sfaccettati: coni)
                    const ax = w / P.n, ay = h / (2 * P.n), ry = ay * 2 / SQRT3;
                    for (let j = -2; j <= 2 * P.n + 1; j++) for (let i = -2; i <= P.n + 1; i++) {
                        const cx = i * ax + (j % 2 ? ax / 2 : 0), cy = j * ay;
                        g.strap((c) => { c.beginPath(); c.ellipse(cx, cy, ax, ry, 0, 0, TAU); });
                    }
                    return;
                }
                const a = w / P.n, R = P.ring * a, rho = R / 2;
                for (let i = -1; i <= P.n; i++) for (let j = -1; j <= P.n; j++) {
                    const cx = i * a, cy = j * a;
                    g.field(P.fill, (c) => { c.beginPath(); c.arc(cx, cy, R, 0, TAU); });
                    g.strap((c) => { c.beginPath(); c.arc(cx, cy, R, 0, TAU); });
                    for (let k = 0; k < 4; k++) {
                        const ang = k * Math.PI / 2;
                        g.strap((c) => { c.beginPath(); c.arc(cx + rho * Math.cos(ang), cy + rho * Math.sin(ang), rho, 0, TAU); }, P.strap * 0.75);
                    }
                    const d = a * 0.11, mx = cx + a / 2, my = cy + a / 2;
                    const q = [[mx, my - d], [mx + d, my], [mx, my + d], [mx - d, my]];
                    g.field(KIND.RAISED, (c) => poly(c, q));
                    g.strap((c) => poly(c, q), P.strap * 0.6);
                }
            },
        },

        // Losanghe e scacchiera (cosmatesco)
        cosmati: {
            label: "Romanico — cosmatesco",
            params: (rnd) => ({ n: 2 + Math.floor(rnd() * 2), a: 64 + rnd() * 40, kind: rnd() < 0.5 ? "lozenge" : "checker",
                                strap: 6 + rnd() * 4, inner: rnd() < 0.6, bg: KIND.FLAT }),
            tile: (P) => { const w = Math.round(P.a * P.n * 2); return { w, h: w }; },
            draw(g, P, w, h) {
                const a = w / (P.n * 2);   // 2n celle per lato: la scacchiera alterna con periodo pari
                for (let i = -1; i <= 2 * P.n; i++) for (let j = -1; j <= 2 * P.n; j++) {
                    const x = i * a, y = j * a, cx = x + a / 2, cy = y + a / 2;
                    const odd = ((i + j) % 2 + 2) % 2 === 1;
                    if (P.kind === "checker") {
                        g.field(odd ? KIND.RAISED : KIND.SUNKEN, (c) => { c.beginPath(); c.rect(x, y, a, a); });
                        g.strap((c) => { c.beginPath(); c.rect(x, y, a, a); });
                        if (P.inner && !odd) {
                            const q = [[cx, y + a * 0.22], [x + a * 0.78, cy], [cx, y + a * 0.78], [x + a * 0.22, cy]];
                            g.field(KIND.RAISED, (c) => poly(c, q));
                            g.strap((c) => poly(c, q), P.strap * 0.6);
                        }
                    } else {
                        const L = [[cx, y], [x + a, cy], [cx, y + a], [x, cy]];
                        g.field(odd ? KIND.RAISED : KIND.SUNKEN, (c) => poly(c, L));
                        g.strap((c) => poly(c, L));
                        if (P.inner) g.strap((c) => { c.beginPath(); c.arc(cx, cy, a * 0.17, 0, TAU); }, P.strap * 0.6);
                    }
                }
            },
        },
    };

    // ── trasformata della distanza euclidea (Felzenszwalb-Huttenlocher) ──────
    const INF = 1e20;
    function edt1d(f, n, d, v, z) {
        let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
        for (let q = 1; q < n; q++) {
            let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
            k++; v[k] = q; z[k] = s; z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
    }
    /** Distanza (px) di ogni punto dal più vicino punto "feature"; ciclica con un bordo di pad px. */
    function distanceCyclic(isFeature, w, h, pad) {
        const W = w + 2 * pad, H = h + 2 * pad;
        const g = new Float64Array(W * H);
        for (let y = 0; y < H; y++) {
            const sy = ((y - pad) % h + h) % h;
            for (let x = 0; x < W; x++) {
                const sx = ((x - pad) % w + w) % w;
                g[y * W + x] = isFeature[sy * w + sx] ? 0 : INF;
            }
        }
        const n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n),
              v = new Int32Array(n), z = new Float64Array(n + 1);
        for (let x = 0; x < W; x++) {
            for (let y = 0; y < H; y++) f[y] = g[y * W + x];
            edt1d(f, H, d, v, z);
            for (let y = 0; y < H; y++) g[y * W + x] = d[y];
        }
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) f[x] = g[y * W + x];
            edt1d(f, W, d, v, z);
            for (let x = 0; x < W; x++) g[y * W + x] = d[x];
        }
        const out = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(g[(y + pad) * W + x + pad]);
        return out;
    }

    /** Sfocatura ciclica (box blur separabile, due passate). */
    function blurWrap(src, w, h, r) {
        if (r < 1) return src.slice();
        let cur = src.slice();
        const tmp = new Float32Array(w * h), norm = 1 / (2 * r + 1);
        for (let pass = 0; pass < 2; pass++) {
            for (let y = 0; y < h; y++) {
                let acc = 0;
                for (let p = -r; p <= r; p++) acc += cur[y * w + ((p % w) + w) % w];
                for (let x = 0; x < w; x++) {
                    tmp[y * w + x] = acc * norm;
                    acc += cur[y * w + (x + r + 1) % w] - cur[y * w + ((x - r) % w + w) % w];
                }
            }
            for (let x = 0; x < w; x++) {
                let acc = 0;
                for (let p = -r; p <= r; p++) acc += tmp[(((p % h) + h) % h) * w + x];
                for (let y = 0; y < h; y++) {
                    cur[y * w + x] = acc * norm;
                    acc += tmp[((y + r + 1) % h) * w + x] - tmp[(((y - r) % h + h) % h) * w + x];
                }
            }
        }
        return cur;
    }

    /**
     * Genera una piastrella. opts: seed (numero o testo), family ('auto' o chiave di FAMILIES),
     * scale (dimensioni, default 1), light (direzione della luce in gradi), elevation (altezza della
     * luce in gradi, bassa = ombre lunghe), depth (moltiplica le altezze), darkest (grigio più scuro,
     * default 179 = 30% di nero), intensity (0-1: quanto il rilievo si stacca dal bianco).
     * Restituisce un <canvas> con .raInfo = { family, label, seed, params, w, h, ms }.
     */
    function generate(opts = {}) {
        const t0 = performance.now();
        const seed = typeof opts.seed === "number" ? opts.seed >>> 0 : seedFrom(opts.seed ?? Math.random());
        const rnd = mulberry32(seed);
        const keys = Object.keys(FAMILIES);
        const famKey = FAMILIES[opts.family] ? opts.family : keys[Math.floor(rnd() * keys.length)];
        const fam = FAMILIES[famKey];
        const P = fam.params(rnd);
        const scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
        for (const k of ["a", "s", "strap"]) if (P[k]) P[k] *= scale;
        const { w, h } = fam.tile(P);
        const N = w * h;

        // 1. nastri e tipi dei campi
        const mk = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
        const sc = mk(), kc = mk();
        const S = sc.getContext("2d", { willReadFrequently: true }), K = kc.getContext("2d", { willReadFrequently: true });
        S.fillStyle = "#000"; S.fillRect(0, 0, w, h);
        K.fillStyle = kindStyle(P.bg ?? KIND.RAISED); K.fillRect(0, 0, w, h);
        fam.draw(painter(S, K, P), P, w, h);
        const sd = S.getImageData(0, 0, w, h).data, kd = K.getImageData(0, 0, w, h).data;
        const isStrap = new Uint8Array(N), notStrap = new Uint8Array(N);
        for (let i = 0; i < N; i++) { const on = sd[i * 4] > 127; isStrap[i] = on ? 1 : 0; notStrap[i] = on ? 0 : 1; }

        // 2. altezze (px): profilo dei nastri e sfaccettature dei campi
        const half = P.strap / 2;
        const pad = Math.ceil(Math.max(P.strap, (P.a || P.s || 100) * 0.6));
        const dIn  = distanceCyclic(notStrap, w, h, Math.ceil(half) + 2);   // dentro il nastro: distanza dal bordo
        const dOut = distanceCyclic(isStrap, w, h, pad);                    // nei campi: distanza dal nastro
        const depth = opts.depth ?? (0.9 + rnd() * 0.4);
        const strapH = P.strap * 0.75 * depth;                 // altezza del cordone
        const slope  = (0.35 + rnd() * 0.3) * depth;            // pendenza delle sfaccettature
        const cap    = strapH * 0.9;                            // le piramidi restano sotto i cordoni
        const recess = -strapH * 0.35;                          // fondo piano incavato
        const Hm = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            if (isStrap[i]) {
                const p = Math.min(1, dIn[i] / half);           // 0 bordo → 1 centro
                Hm[i] = strapH * Math.sqrt(Math.max(0, 1 - (1 - p) * (1 - p)));
            } else {
                const k = kd[i * 4], f = Math.min(dOut[i] * slope, cap);
                Hm[i] = k > 191 ? f : (k < 64 ? -f : recess);
            }
        }

        // la maschera dei nastri è a pixel netti: una sfumatura minima toglie la seghettatura dei bordi
        {
            const sm = blurWrap(Hm, w, h, 1);
            Hm.set(sm);
        }

        // 3. luce: diffusa + ombre portate + occlusione
        const az = (opts.light ?? (215 + rnd() * 40)) * Math.PI / 180;     // da sinistra-alto
        const el = (opts.elevation ?? 38) * Math.PI / 180;
        const Lx = Math.cos(az) * Math.cos(el), Ly = Math.sin(az) * Math.cos(el), Lz = Math.sin(el);
        // ombre: si risale il raggio verso la luce; se il rilievo lo supera, il punto è in ombra
        const tanEl = Math.tan(el), stepX = Math.cos(az), stepY = Math.sin(az);
        const maxSteps = Math.ceil((strapH - Math.min(recess, -cap)) / tanEl) + 2;
        // campionamento bilineare ciclico (a pixel interi le ombre verrebbero a righe)
        const sample = (x, y) => {
            const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy;
            const x0 = ((fx % w) + w) % w, y0 = ((fy % h) + h) % h, x1 = (x0 + 1) % w, y1 = (y0 + 1) % h;
            const a = Hm[y0 * w + x0], b = Hm[y0 * w + x1], c = Hm[y1 * w + x0], e = Hm[y1 * w + x1];
            return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
        };
        const AOb = blurWrap(Hm, w, h, Math.max(2, Math.round(P.strap * 0.9)));
        const intensity = opts.intensity ?? (0.7 + rnd() * 0.25);
        const darkest = opts.darkest ?? 179;
        const amb = 0.42, dif = 0.58, flat = amb + dif * Lz;    // valore di una superficie piana illuminata
        const out = mk(), ox = out.getContext("2d"), img = ox.createImageData(w, h), d = img.data;
        for (let y = 0; y < h; y++) {
            const ym = ((y - 1 + h) % h) * w, yp = ((y + 1) % h) * w, yr = y * w;
            for (let x = 0; x < w; x++) {
                const i = yr + x, xm = (x - 1 + w) % w, xp = (x + 1) % w;
                const dx = (Hm[yr + xp] - Hm[yr + xm]) / 2, dy = (Hm[yp + x] - Hm[ym + x]) / 2;
                const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
                const ndl = Math.max(0, (-dx * Lx - dy * Ly + Lz) * inv);
                // ombra portata (morbida: quanto il rilievo supera il raggio)
                let sh = 1;
                const h0 = Hm[i];
                for (let t = 1.5; t <= maxSteps; t += 0.75) {
                    const over = sample(x + stepX * t, y + stepY * t) - (h0 + t * tanEl);
                    if (over > 0) { sh = Math.min(sh, Math.max(0, 1 - over / 3)); if (sh === 0) break; }
                }
                const occ = Math.max(0, Math.min(1, (AOb[i] - h0) / (strapH * 0.8)));   // incavi più scuri
                const I = (amb * (1 - 0.6 * occ) + dif * ndl * (0.35 + 0.65 * sh)) / flat;
                // superficie piana ≈ 0.92 (quasi bianco): così le parti in luce possono schiarire
                let v = Math.min(1, 0.92 * I + 0.04);
                v = 1 - (1 - v) * intensity;
                const gv = Math.round(Math.max(darkest, Math.min(255, darkest + (255 - darkest) * ((v - 0.35) / 0.65))));
                const o = i * 4;
                d[o] = d[o + 1] = d[o + 2] = gv; d[o + 3] = 255;
            }
        }
        ox.putImageData(img, 0, 0);
        out.raInfo = { family: famKey, label: fam.label, seed, params: P, w, h, ms: Math.round(performance.now() - t0) };
        return out;
    }

    /** Sfondo ripetuto su un elemento (default body). Restituisce raInfo. */
    function applyBackground(el, opts = {}) {
        const c = generate(opts);
        const target = el || document.body;
        target.style.backgroundImage = `url(${c.toDataURL("image/png")})`;
        target.style.backgroundRepeat = "repeat";
        target.style.backgroundSize = `${c.width}px ${c.height}px`;
        return c.raInfo;
    }

    window.raTexture = { generate, applyBackground, seedFrom, FAMILIES };
})();
