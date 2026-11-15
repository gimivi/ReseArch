// jsx-template.mjs
// Template base per script JSXGraph in ReseArch.
//
// ISTRUZIONI PER L'ADMIN
// ──────────────────────
// 1. Copia questo file e rinominalo (es. mio-grafico.mjs)
// 2. Modifica la funzione setup() per definire il tuo grafico
// 3. Carica il file sul server e inserisci il percorso assoluto
//    nel campo mod_abs_url del record modello (tabella models)
// 4. Configura mod_spec con le opzioni del board e i tuoi parametri
//
// PARAMETRI RICEVUTI
// ──────────────────
//   board  : JXG.Board — board già inizializzato da model_JSX.mjs
//            NON chiamare JXG.JSXGraph.initBoard() qui dentro
//   JXG    : namespace JSXGraph (JXG.Math, JXG.Color, JXG.Coords, ecc.)
//   params : oggetto da mod_spec.params — personalizzazioni senza toccare il file
//
// ESEMPIO mod_spec
// ────────────────
// {
//   "boundingbox": [-8, 8, 8, -8],
//   "axis": true,
//   "grid": false,
//   "keepaspectratio": true,
//   "params": {
//     "titolo": "Il mio grafico",
//     "colore": "#e05020"
//   }
// }

export default async function setup(board, JXG, params) {

  // ── Esempio 1: punti e retta passante ──────────────────────────────────────

  const A = board.create('point', [-3, 1], {
    name: 'A',
    size: 5,
    color: '#2060c0',
  });

  const B = board.create('point', [4, -2], {
    name: 'B',
    size: 5,
    color: '#2060c0',
  });

  board.create('line', [A, B], {
    strokeColor: '#2060c0',
    strokeWidth: 2,
  });

  // ── Esempio 2: cerchio trascinabile ───────────────────────────────────────

  const C = board.create('point', [0, 0], {
    name: 'C',
    size: 4,
    color: '#c03030',
    fixed: false,
  });

  const R = board.create('point', [2, 0], {
    name: '',
    size: 3,
    color: '#c03030',
    withLabel: false,
  });

  board.create('circle', [C, R], {
    strokeColor: '#c03030',
    strokeWidth: 2,
    fillColor: '#c03030',
    fillOpacity: 0.08,
  });

  // ── Esempio 3: funzione (usa params per personalizzare) ───────────────────

  const colore = params.colore ?? '#20a060';

  board.create('functiongraph', [
    x => Math.sin(x),   // funzione
    -6, 6,              // dominio
  ], {
    strokeColor: colore,
    strokeWidth: 2.5,
  });

  // ── Esempio 4: testo con parametro ────────────────────────────────────────

  if (params.titolo) {
    board.create('text', [-5.5, 5.5, params.titolo], {
      fontSize: 14,
      color: 'rgba(255,255,255,0.7)',
      anchorX: 'left',
    });
  }
}
