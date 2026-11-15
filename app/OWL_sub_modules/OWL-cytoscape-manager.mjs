// OWL-cytoscape-manager.mjs
// Gestisce l'istanza Cytoscape: creazione, layout, interazioni, export
// Richiede window.cytoscape (+ window.cytoscapeDagre se si usa layout 'dagre')

// ── Stylesheet ────────────────────────────────────────────────────────────────

const STYLESHEET = [
  // Classi — ellisse blu
  {
    selector: 'node[nodeType = "class"]',
    style: {
      shape: 'ellipse',
      'background-color': '#3A7BD5',
      label: 'data(label)',
      color: '#fff',
      'font-size': 11,
      'font-weight': 'bold',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': 90,
      'width': 'label',
      'height': 'label',
      padding: 10,
    },
  },
  // Object Properties — diamante arancio
  {
    selector: 'node[nodeType = "objectProperty"]',
    style: {
      shape: 'diamond',
      'background-color': '#E8972A',
      label: 'data(label)',
      color: '#fff',
      'font-size': 10,
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'width': 'label',
      'height': 'label',
      padding: 8,
    },
  },
  // Datatype Properties — rettangolo viola
  {
    selector: 'node[nodeType = "datatypeProperty"]',
    style: {
      shape: 'round-rectangle',
      'background-color': '#8E44AD',
      label: 'data(label)',
      color: '#fff',
      'font-size': 10,
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'width': 'label',
      'height': 'label',
      padding: 7,
    },
  },
  // Individui — rettangolo verde
  {
    selector: 'node[nodeType = "individual"]',
    style: {
      shape: 'rectangle',
      'background-color': '#27AE60',
      label: 'data(label)',
      color: '#fff',
      'font-size': 10,
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'width': 'label',
      'height': 'label',
      padding: 7,
    },
  },
  // Archi subClassOf — freccia piena blu
  {
    selector: 'edge[edgeType = "subClassOf"]',
    style: {
      width: 2,
      'line-color': '#3A7BD5',
      'target-arrow-color': '#3A7BD5',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      opacity: 0.8,
    },
  },
  // Archi domain — tratteggio arancio
  {
    selector: 'edge[edgeType = "domain"]',
    style: {
      width: 1.5,
      'line-color': '#E8972A',
      'target-arrow-color': '#E8972A',
      'target-arrow-shape': 'arrow',
      'line-style': 'dashed',
      'curve-style': 'bezier',
      opacity: 0.7,
    },
  },
  // Archi range — tratteggio viola
  {
    selector: 'edge[edgeType = "range"]',
    style: {
      width: 1.5,
      'line-color': '#8E44AD',
      'target-arrow-color': '#8E44AD',
      'target-arrow-shape': 'arrow',
      'line-style': 'dashed',
      'curve-style': 'bezier',
      opacity: 0.7,
    },
  },
  // Archi type individuo→classe — puntinato verde
  {
    selector: 'edge[edgeType = "type"]',
    style: {
      width: 1,
      'line-color': '#27AE60',
      'target-arrow-color': '#27AE60',
      'target-arrow-shape': 'arrow',
      'line-style': 'dotted',
      'curve-style': 'bezier',
      opacity: 0.6,
    },
  },
  // Selezione
  { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#FFD700' } },
  // Highlight / fade per esplorazione
  { selector: '.owl-highlight', style: { 'border-width': 3, 'border-color': '#FF4444', 'border-opacity': 1 } },
  { selector: '.owl-faded',     style: { opacity: 0.15 } },
];

// ── Layout configs ────────────────────────────────────────────────────────────

const LAYOUTS = {
  dagre: {
    name: 'dagre',
    rankDir: 'TB',
    nodeSep: 50,
    rankSep: 90,
    animate: true,
    animationDuration: 450,
  },
  cose: {
    name: 'cose',
    idealEdgeLength: 110,
    nodeOverlap: 20,
    fit: true,
    padding: 30,
    randomize: false,
    nodeRepulsion: 450000,
    edgeElasticity: 100,
    gravity: 80,
    numIter: 1000,
    animate: true,
    animationDuration: 500,
  },
  circle: {
    name: 'circle',
    fit: true,
    padding: 30,
    animate: true,
    animationDuration: 400,
  },
  breadthfirst: {
    name: 'breadthfirst',
    directed: true,
    fit: true,
    padding: 30,
    animate: true,
    animationDuration: 400,
  },
};

// ── API pubblica ──────────────────────────────────────────────────────────────

/**
 * Crea l'istanza Cytoscape e registra il plugin dagre se disponibile.
 * @param {HTMLElement} container
 * @param {object[]} elements  array flat di { data } nodes + edges
 * @returns {cytoscape.Core}
 */
export function cytoscapeCreate(container, elements) {
  if (!window.cytoscape) throw new Error('[OWL-cytoscape] cytoscape non caricato');

  // Registra dagre una sola volta
  if (window.cytoscapeDagre) {
    try { window.cytoscape.use(window.cytoscapeDagre); } catch { /* già registrato */ }
  }

  return window.cytoscape({
    container,
    elements,
    style: STYLESHEET,
    layout: { name: 'preset' },
    minZoom: 0.05,
    maxZoom: 6,
    wheelSensitivity: 1.0,
  });
}

/**
 * Applica layout.
 * @param {cytoscape.Core} cy
 * @param {string} layoutName
 */
export function cytoscapeLayout(cy, layoutName = 'dagre') {
  const cfg = LAYOUTS[layoutName] ?? LAYOUTS.cose;
  // Fallback se dagre non è registrato
  const name = cfg.name === 'dagre' && !window.cytoscapeDagre ? 'breadthfirst' : cfg.name;
  cy.layout({ ...cfg, name }).run();
}

/** Adatta la vista ai nodi visibili. */
export function cytoscapeFit(cy) {
  cy.fit(undefined, 30);
}

/**
 * Evidenzia un nodo e i suoi vicini diretti; sfuma il resto.
 * Passa nodeId=null per resettare.
 */
export function cytoscapeHighlight(cy, nodeId) {
  cy.elements().removeClass('owl-highlight owl-faded');
  if (!nodeId) return;
  const node = cy.getElementById(nodeId);
  if (!node.length) return;
  const neighborhood = node.closedNeighborhood();
  cy.elements().not(neighborhood).addClass('owl-faded');
  node.addClass('owl-highlight');
}

/**
 * Toggle visibilità per tipo di nodo.
 * @param {cytoscape.Core} cy
 * @param {string} nodeType  'class' | 'objectProperty' | 'datatypeProperty' | 'individual'
 * @param {boolean} visible
 */
export function cytoscapeToggleType(cy, nodeType, visible) {
  const sel = Array.isArray(nodeType)
    ? nodeType.map(t => `[nodeType = "${t}"]`).join(', ')
    : `[nodeType = "${nodeType}"]`;
  const els = cy.elements(sel);
  if (visible) els.show(); else els.hide();
}

/**
 * Esporta grafo come PNG in base64.
 * @param {cytoscape.Core} cy
 * @returns {string}  data URL
 */
export function cytoscapeExportPng(cy, scale = 2) {
  return cy.png({ scale, full: true, bg: '#ffffff' });
}

/** Distrugge l'istanza Cytoscape in modo sicuro. */
export function cytoscapeDestroy(cy) {
  if (cy && !cy.destroyed()) cy.destroy();
}
