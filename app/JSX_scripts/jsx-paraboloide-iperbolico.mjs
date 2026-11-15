// jsx-paraboloide-iperbolico.mjs
// Paraboloide iperbolico  z = x² − y²  con piano tangente e curve di sezione.
//
// Elementi visualizzati:
//   • Superficie     z = x² − y²  (sella, colore blu)
//   • Punto P        draggabile sul piano XY, proiettato sulla superficie
//   • Piano tangente in P              (colore arancio, semitrasparente)
//   • Sezione y = y₀ → z = t² − y₀²  parabola concava verso l'alto  (verde)
//   • Sezione x = x₀ → z = x₀² − t²  parabola concava verso il basso (giallo)
//
// ── mod_spec consigliato ─────────────────────────────────────────────────────
// {
//   "boundingbox"   : [-5, 5, 5, -5],
//   "axis"          : false,
//   "grid"          : false,
//   "showNavigation": false,
//   "boardOptions"  : { "pan": {"enabled": false}, "zoom": {"enabled": false} },
//   "params": {
//     "box"        : [-2.5, 2.5],
//     "boxZ"       : [-7, 7],
//     "colorSup"   : "#3070d0",
//     "colorTan"   : "#e05820",
//     "colorSezX"  : "#22c060",
//     "colorSezY"  : "#d0b800",
//     "tangentExt" : 1.4
//   }
// }
//
// NOTA: pan e zoom del board 2D devono essere disabilitati (boardOptions)
//       per non interferire con la rotazione della vista 3D.

export default async function setup(board, JXG, params) {

  // ── Parametri (con valori di default) ──────────────────────────────────────
  const box     = params.box      ?? [-2.5, 2.5];
  const boxZ    = params.boxZ     ?? [-7,   7  ];
  const colSup  = params.colorSup ?? '#3070d0';
  const colTan  = params.colorTan ?? '#e05820';
  const colSezX = params.colorSezX ?? '#22c060';
  const colSezY = params.colorSezY ?? '#d0b800';
  const tanExt  = params.tangentExt ?? 1.4;

  // ── Paraboloide iperbolico z = x² − y² ─────────────────────────────────────
  const F   = (x, y) =>  x * x - y * y;
  const Fdx = (x, y) =>  2 * x;            // ∂z/∂x
  const Fdy = (x, y) => -2 * y;            // ∂z/∂y

  // ── Vista 3D ────────────────────────────────────────────────────────────────
  const view = board.create('view3d', [
    [-4, -3],          // angolo inferiore-sinistro in coord. board 2D
    [8,  8 ],          // [larghezza, altezza] in unità board
    [box, box, boxZ]   // [rangeX, rangeY, rangeZ]
  ], {
    projection   : 'central',
    xPlaneRear   : { visible: false },
    yPlaneRear   : { visible: false },
    zPlaneRear   : { visible: false },
  });

  // ── Superficie ──────────────────────────────────────────────────────────────
  view.create('functiongraph3d', [F, box, box], {
    strokeWidth : 0.6,
    strokeColor : colSup,
    stepsU      : 50,
    stepsV      : 50,
  });

  // ── Punto sul piano XY (il punto che l'utente trascina) ─────────────────────
  const Pxy = view.create('point3d', [0.8, 0.6, boxZ[0]], {
    withLabel    : false,
    fillColor    : '#cccccc',
    strokeColor  : '#ffffff',
    size         : 6,
    showInfobox  : false,
  });

  // ── Punto P proiettato sulla superficie ─────────────────────────────────────
  const P = view.create('point3d', [
    () => [Pxy.X(), Pxy.Y(), F(Pxy.X(), Pxy.Y())]
  ], {
    name         : 'P',
    withLabel    : true,
    fixed        : true,
    fillColor    : '#ffffff',
    strokeColor  : '#aaaaaa',
    size         : 5,
    showInfobox  : false,
    label        : { color: '#dddddd', offset: [6, 6] },
  });

  // Linea tratteggiata P → Pxy (proiezione verticale)
  view.create('line3d', [P, Pxy], {
    dash        : 2,
    strokeColor : '#888888',
    strokeWidth : 1,
  });

  // ── Piano tangente ──────────────────────────────────────────────────────────
  // Vettori tangenti alla superficie in P(x₀, y₀):
  //   v₁ = (1, 0, ∂F/∂x)   →  direzione x con pendenza
  //   v₂ = (0, 1, ∂F/∂y)   →  direzione y con pendenza
  const v1 = [() => 1, () => 0, () => Fdx(P.X(), P.Y())];
  const v2 = [() => 0, () => 1, () => Fdy(P.X(), P.Y())];

  view.create('plane3d', [
    P, v1, v2,
    [-tanExt, tanExt],
    [-tanExt, tanExt]
  ], {
    fillColor   : colTan,
    fillOpacity : 0.45,
    strokeColor : colTan,
    strokeWidth : 0.6,
  });

  // ── Sezione con il piano y = y₀ ─────────────────────────────────────────────
  // z = t² − y₀²  →  parabola concava verso l'alto nel piano y = y₀
  view.create('curve3d', [
    t  => t,
    () => Pxy.Y(),
    t  => t * t - Pxy.Y() * Pxy.Y(),
    box
  ], {
    strokeColor : colSezX,
    strokeWidth : 3,
  });

  // ── Sezione con il piano x = x₀ ─────────────────────────────────────────────
  // z = x₀² − t²  →  parabola concava verso il basso nel piano x = x₀
  view.create('curve3d', [
    () => Pxy.X(),
    t  => t,
    t  => Pxy.X() * Pxy.X() - t * t,
    box
  ], {
    strokeColor : colSezY,
    strokeWidth : 3,
  });

  // ── Titolo 2D ───────────────────────────────────────────────────────────────
  board.create('text', [0, 4.7, 'z = x\u00b2 \u2212 y\u00b2  \u2014  paraboloide iperbolico'], {
    fontSize   : 13,
    color      : '#cccccc',
    anchorX    : 'middle',
    fixed      : true,
    highlight  : false,
  });

  // ── Legenda ─────────────────────────────────────────────────────────────────
  const LEG_X = -4.8;
  const entries = [
    [colSup,  'superficie'],
    [colTan,  'piano tangente'],
    [colSezX, 'sezione y = y\u2080 (parabola \u2191)'],
    [colSezY, 'sezione x = x\u2080 (parabola \u2193)'],
  ];
  entries.forEach(([col, lbl], i) => {
    board.create('text', [LEG_X, -3.7 - i * 0.45, lbl], {
      fontSize  : 11,
      color     : col,
      fixed     : true,
      highlight : false,
    });
  });
}
