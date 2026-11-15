// model_OWL.mjs
// Viewer OWL (Web Ontology Language) per ReseArch
// Visualizza ontologie RDF/OWL con Cytoscape.js
//
// Librerie globali richieste in dashboard.php (nell'ordine):
//   1. https://cdn.jsdelivr.net/npm/rdflib@2/dist/rdflib.min.js
//   2. https://cdn.jsdelivr.net/npm/dagre@0.8/dist/dagre.min.js
//   3. https://cdn.jsdelivr.net/npm/cytoscape@3/dist/cytoscape.min.js
//   4. https://cdn.jsdelivr.net/npm/cytoscape-dagre@2/cytoscape-dagre.min.js
//
// Il file OWL viene letto da models[0].mod_abs_url (come tutti gli altri moduli).
//
// Schema mod_spec atteso:
// {
//   format: "turtle" | "n-triples" | "n3" | "trig",   // opzionale, auto-rilevato dall'estensione
//   layout: "dagre" | "cose" | "circle" | "breadthfirst",
//   filter: { showClasses: true, showIndividuals: true, showProperties: true }
// }

import { fetchAndParseRdf, detectFormat } from './OWL_sub_modules/OWL-parser.mjs';
import { buildCytoscapeElements }                   from './OWL_sub_modules/OWL-graph-builder.mjs';
import {
  cytoscapeCreate,
  cytoscapeLayout,
  cytoscapeFit,
  cytoscapeHighlight,
  cytoscapeToggleType,
  cytoscapeExportPng,
  cytoscapeDestroy,
} from './OWL_sub_modules/OWL-cytoscape-manager.mjs';

import { t, te } from './shared/i18n.mjs';

const STATE_KEY = '__OWL_STATE__';

// ── Helpers ───────────────────────────────────────────────────────────────────

function destroyBodyInstance(bodyEl) {
  const st = bodyEl?.[STATE_KEY];
  if (!st) return;
  st.stopped = true;
  try { st.resizeObserver?.disconnect(); } catch { /* noop */ }
  try { cytoscapeDestroy(st.cy); }         catch { /* noop */ }
  try { delete bodyEl[STATE_KEY]; }        catch { /* noop */ }
}

function getModSpec(models) {
  const mod = models?.[0];
  if (!mod?.mod_spec) return {};
  try {
    return typeof mod.mod_spec === 'string' ? JSON.parse(mod.mod_spec) : mod.mod_spec;
  } catch { return {}; }
}

function getState(bodyEl) {
  return bodyEl?.[STATE_KEY] ?? null;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function createTooltip(parent) {
  const div = document.createElement('div');
  div.style.cssText = [
    'position:absolute', 'background:rgba(0,0,0,.78)', 'color:#fff',
    'font-size:11px', 'padding:5px 9px', 'border-radius:4px',
    'pointer-events:none', 'white-space:pre-wrap', 'display:none',
    'z-index:100', 'max-width:240px', 'line-height:1.4',
  ].join(';');
  parent.appendChild(div);
  return div;
}

function showTooltip(tooltip, text, ev) {
  tooltip.textContent = text;
  tooltip.style.display = 'block';
  moveTooltip(tooltip, ev);
}

function moveTooltip(tooltip, ev) {
  const rect = tooltip.parentElement.getBoundingClientRect();
  tooltip.style.left = (ev.clientX - rect.left + 14) + 'px';
  tooltip.style.top  = (ev.clientY - rect.top  + 14) + 'px';
}

function hideTooltip(tooltip) {
  tooltip.style.display = 'none';
}

// ── renderBody ────────────────────────────────────────────────────────────────

async function renderBody({ bodyEl, object, models, cmdUI, signal }) {
  if (!window.cytoscape) {
    cmdUI.show({ status: `<span class="text-danger">${te('app.owl.err.no_cytoscape')}</span>` });
    return;
  }
  if (!window.$rdf) {
    cmdUI.show({ status: `<span class="text-danger">${te('app.owl.err.no_rdflib')}</span>` });
    return;
  }

  const arr = Array.isArray(models) ? models : [];
  if (!arr.length || !arr[0]?.mod_abs_url) {
    cmdUI.show({ status: `<span class="text-warning">${te('app.owl.no_file')}</span>` });
    return;
  }

  destroyBodyInstance(bodyEl);
  signal.addEventListener('abort', () => destroyBodyInstance(bodyEl), { once: true });

  const m       = arr[0];
  const modSpec = getModSpec(models);
  const fileUrl = m.mod_abs_url;
  const format  = modSpec.format ?? detectFormat(fileUrl);
  const layout  = modSpec.layout ?? 'dagre';
  const filter  = { showClasses: true, showIndividuals: true, showProperties: true, ...(modSpec.filter ?? {}) };

  bodyEl.style.position = 'relative';
  bodyEl.style.overflow = 'hidden';
  bodyEl.innerHTML = '<div style="width:100%;height:100%;"></div>';
  const cyContainer = bodyEl.firstElementChild;

  const state = { cy: null, resizeObserver: null, stopped: false, layout, filter, store: null };
  bodyEl[STATE_KEY] = state;

  cmdUI.show({ status: te('app.owl.status.loading') });

  // ── Fetch + parse ──
  let store;
  try {
    store = await fetchAndParseRdf(fileUrl, format, signal);
  } catch (err) {
    if (signal.aborted) return;
    cmdUI.show({ status: `<span class="text-danger">${te('app.owl.err.parse', { msg: err.message })}</span>` });
    return;
  }

  if (signal.aborted) return;
  state.store = store;

  // ── Build elements ──
  const { nodes, edges } = buildCytoscapeElements(store, filter);
  if (!nodes.length) {
    cmdUI.show({ status: `<span class="text-warning">${te('app.owl.no_elements')}</span>` });
    return;
  }

  // ── Cytoscape ──
  const cy = cytoscapeCreate(cyContainer, [...nodes, ...edges]);
  state.cy = cy;

  // Tooltip su hover
  const tooltip = createTooltip(bodyEl);
  cy.on('mouseover', 'node', ev => {
    const d = ev.target.data();
    const txt = d.comment ? `${d.label}\n${d.comment}` : d.label;
    showTooltip(tooltip, txt, ev.originalEvent);
  });
  cy.on('mouseout',  'node', ()  => hideTooltip(tooltip));
  cy.on('mousemove', 'node', ev  => moveTooltip(tooltip, ev.originalEvent));

  // Click → highlight neighborhood
  cy.on('tap', 'node', ev => cytoscapeHighlight(cy, ev.target.id()));
  cy.on('tap', ev => { if (ev.target === cy) cytoscapeHighlight(cy, null); });

  const ro = new ResizeObserver(() => { if (!state.stopped) cy.resize(); });
  ro.observe(bodyEl);
  state.resizeObserver = ro;

  // Defer layout al frame successivo: garantisce che il container abbia dimensioni reali.
  // Senza questo, Cytoscape si inizializza con altezza 0 e gli archi non vengono disegnati.
  requestAnimationFrame(() => {
    if (state.stopped) return;
    cy.resize();
    cytoscapeLayout(cy, layout);
  });

  const nClasses     = nodes.filter(n => n.data.nodeType === 'class').length;
  const nIndividuals = nodes.filter(n => n.data.nodeType === 'individual').length;
  const nProperties  = nodes.filter(n => n.data.nodeType.endsWith('Property')).length;
  const counts = [
    nClasses     > 0 ? te('app.owl.count.classes',     { n: nClasses })     : null,
    nIndividuals > 0 ? te('app.owl.count.individuals', { n: nIndividuals }) : null,
    nProperties  > 0 ? te('app.owl.count.properties',  { n: nProperties })  : null,
  ].filter(Boolean).join(' · ');

  cmdUI.show({ status: counts || te('app.owl.count.nodes_edges', { nodes: nodes.length, edges: edges.length }) });
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function getToolbar({ bodyEl }) {
  return {
    items: [
      // Layout — 4 pulsanti diretti (evita problemi Bootstrap dropdown nei panel)
      { type: 'button', iconClass: 'bi bi-diagram-3',   label: 'Dagre',  title: t('app.owl.tb.layout_dagre'), onClick: () => _setLayout(bodyEl, 'dagre') },
      { type: 'button', iconClass: 'bi bi-arrows-move', label: 'CoSE',   title: t('app.owl.tb.layout_cose'), onClick: () => _setLayout(bodyEl, 'cose') },
      { type: 'button', iconClass: 'bi bi-circle',      label: 'Circle', title: t('app.owl.tb.layout_circle'),onClick: () => _setLayout(bodyEl, 'circle') },
      { type: 'button', iconClass: 'bi bi-list-nested', label: 'BFS',    title: t('app.owl.tb.layout_bfs'), onClick: () => _setLayout(bodyEl, 'breadthfirst') },
      { type: 'divider' },
      // Fit / Export
      {
        type: 'button',
        iconClass: 'bi bi-fullscreen',
        title: t('app.owl.tb.fit'),
        attrs: { 'aria-label': t('app.owl.tb.fit') },
        onClick: () => { const st = getState(bodyEl); if (st?.cy) cytoscapeFit(st.cy); },
      },
      {
        type: 'button',
        iconClass: 'bi bi-download',
        title: t('app.owl.tb.export_png'),
        attrs: { 'aria-label': t('app.owl.tb.export_png') },
        onClick: () => _exportPng(bodyEl),
      },
      { type: 'divider' },
      // Filtri visibilità
      {
        type: 'button',
        iconClass: 'bi bi-circle-fill',
        title: t('app.owl.tb.toggle_classes'),
        attrs: { 'aria-label': t('app.owl.tb.toggle_classes') },
        onClick: () => _toggleFilter(bodyEl, 'showClasses', ['class']),
      },
      {
        type: 'button',
        iconClass: 'bi bi-diamond-fill',
        title: t('app.owl.tb.toggle_properties'),
        attrs: { 'aria-label': t('app.owl.tb.toggle_properties') },
        onClick: () => _toggleFilter(bodyEl, 'showProperties', ['objectProperty', 'datatypeProperty']),
      },
      {
        type: 'button',
        iconClass: 'bi bi-square-fill',
        title: t('app.owl.tb.toggle_individuals'),
        attrs: { 'aria-label': t('app.owl.tb.toggle_individuals') },
        onClick: () => _toggleFilter(bodyEl, 'showIndividuals', ['individual']),
      },
      { type: 'divider' },
      // Reset highlight
      {
        type: 'button',
        iconClass: 'bi bi-eye',
        title: t('app.owl.tb.show_all'),
        attrs: { 'aria-label': t('app.owl.tb.show_all') },
        onClick: () => { const st = getState(bodyEl); if (st?.cy) cytoscapeHighlight(st.cy, null); },
      },
    ],
  };
}

// ── Toolbar actions ───────────────────────────────────────────────────────────

function _setLayout(bodyEl, layoutName) {
  const st = getState(bodyEl);
  if (!st?.cy) return;
  st.layout = layoutName;
  cytoscapeLayout(st.cy, layoutName);
}

function _exportPng(bodyEl) {
  const st = getState(bodyEl);
  if (!st?.cy) return;
  const dataUrl = cytoscapeExportPng(st.cy);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = t('app.owl.export_filename');
  a.click();
}

function _toggleFilter(bodyEl, filterKey, nodeTypes) {
  const st = getState(bodyEl);
  if (!st?.cy) return;
  const current = st.filter[filterKey] ?? true;
  st.filter[filterKey] = !current;
  cytoscapeToggleType(st.cy, nodeTypes, st.filter[filterKey]);
}

// ── getRightMenu (legenda) ────────────────────────────────────────────────────

function getRightMenu() {
  return {
    title: t('app.owl.legend.title'),
    items: [
      { label: t('app.owl.legend.class'),       disabled: true },
      { label: t('app.owl.legend.object_prop'), disabled: true },
      { label: t('app.owl.legend.data_prop'),   disabled: true },
      { label: t('app.owl.legend.individual'),  disabled: true },
      { type: 'divider' },
      { label: '─ subClassOf',  disabled: true },
      { label: t('app.owl.legend.domain_range'), disabled: true },
      { label: t('app.owl.legend.type'),         disabled: true },
    ],
  };
}

// ── Plugin export ─────────────────────────────────────────────────────────────

export default {
  renderBody,
  getToolbar,
  getRightMenu,
  destroy() {},
};
