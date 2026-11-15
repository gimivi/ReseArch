// OWL-graph-builder.mjs
// Converte rdflib Store → elementi Cytoscape { nodes[], edges[] }
// Estrae: classi, gerarchia subClassOf, ObjectProperty (domain/range),
//         DatatypeProperty, individui (NamedIndividual) con rdf:type
// Richiede window.$rdf (rdflib.js)

import { RDF, RDFS, OWL } from './OWL-parser.mjs';

const TYPE       = RDF  + 'type';
const LABEL      = RDFS + 'label';
const COMMENT    = RDFS + 'comment';
const SUB_CLASS  = RDFS + 'subClassOf';
const DOMAIN     = RDFS + 'domain';
const RANGE      = RDFS + 'range';

const OWL_CLASS    = OWL + 'Class';
const OWL_OBJ_PROP = OWL + 'ObjectProperty';
const OWL_DAT_PROP = OWL + 'DatatypeProperty';
const OWL_INDIV    = OWL + 'NamedIndividual';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Scorciatoia: crea NamedNode rdflib da URI stringa
function sym(uri) { return window.$rdf.sym(uri); }

function localName(uri) {
  if (!uri) return '';
  const hash  = uri.lastIndexOf('#');
  const slash = uri.lastIndexOf('/');
  return uri.slice(Math.max(hash, slash) + 1) || uri;
}

// rdflib: store.each(subject, predicate, null) → array di oggetti
function getLabel(store, subjectUri) {
  const labels = store.each(sym(subjectUri), sym(LABEL), null, null);
  if (!labels.length) return localName(subjectUri);
  const en = labels.find(l => l.language === 'en');
  return (en ?? labels[0]).value;
}

function getComment(store, subjectUri) {
  const comments = store.each(sym(subjectUri), sym(COMMENT), null, null);
  return comments.length ? comments[0].value : '';
}

// Blank node: termType === 'BlankNode' (rdflib RDF.js data model)
function isBlank(term) {
  if (!term) return true;
  if (typeof term === 'string') return term.startsWith('_:');
  return term.termType === 'BlankNode';
}

// ── Builder principale ────────────────────────────────────────────────────────

/**
 * @param {object} store   rdflib Store
 * @param {{ showClasses?:boolean, showIndividuals?:boolean, showProperties?:boolean }} [filter]
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildCytoscapeElements(store, filter = {}) {
  const {
    showClasses     = true,
    showIndividuals = true,
    showProperties  = true,
  } = filter;

  const nodes   = new Map();  // uri → data
  const edges   = [];
  const edgeSet = new Set();  // dedup

  function addNode(uri, nodeType) {
    if (nodes.has(uri)) return;
    nodes.set(uri, {
      id:      uri,
      label:   getLabel(store, uri),
      comment: getComment(store, uri),
      nodeType,
    });
  }

  function addEdge(source, target, edgeType) {
    if (isBlank(source) || isBlank(target)) return;
    const key = `${edgeType}|${source}|${target}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ data: { id: key, source, target, edgeType } });
  }

  // rdflib: store.statementsMatching(s, p, o) → array di Statement {subject, predicate, object}
  // rdflib: store.each(s, p, null)            → array di oggetti corrispondenti

  // ── Classi ──
  if (showClasses) {
    for (const st of store.statementsMatching(null, sym(TYPE), sym(OWL_CLASS))) {
      if (isBlank(st.subject)) continue;
      addNode(st.subject.value, 'class');
    }
    for (const st of store.statementsMatching(null, sym(SUB_CLASS), null)) {
      if (isBlank(st.subject) || isBlank(st.object)) continue;
      const sub = st.subject.value;
      const sup = st.object.value;
      addNode(sub, 'class');
      addNode(sup, 'class');
      addEdge(sub, sup, 'subClassOf');
    }
  }

  // ── Object Properties ──
  if (showProperties) {
    for (const st of store.statementsMatching(null, sym(TYPE), sym(OWL_OBJ_PROP))) {
      if (isBlank(st.subject)) continue;
      const prop = st.subject.value;
      addNode(prop, 'objectProperty');
      for (const d of store.each(sym(prop), sym(DOMAIN), null, null)) {
        if (isBlank(d)) continue;
        if (showClasses) addNode(d.value, 'class');
        addEdge(d.value, prop, 'domain');
      }
      for (const r of store.each(sym(prop), sym(RANGE), null, null)) {
        if (isBlank(r)) continue;
        if (showClasses) addNode(r.value, 'class');
        addEdge(prop, r.value, 'range');
      }
    }

    // DatatypeProperty
    for (const st of store.statementsMatching(null, sym(TYPE), sym(OWL_DAT_PROP))) {
      if (isBlank(st.subject)) continue;
      const prop = st.subject.value;
      addNode(prop, 'datatypeProperty');
      for (const d of store.each(sym(prop), sym(DOMAIN), null, null)) {
        if (isBlank(d)) continue;
        if (showClasses) addNode(d.value, 'class');
        addEdge(d.value, prop, 'domain');
      }
    }
  }

  // ── Individui ──
  if (showIndividuals) {
    for (const st of store.statementsMatching(null, sym(TYPE), sym(OWL_INDIV))) {
      if (isBlank(st.subject)) continue;
      const ind = st.subject.value;
      addNode(ind, 'individual');
      // archi rdf:type verso le classi dichiarate
      for (const cls of store.each(sym(ind), sym(TYPE), null, null)) {
        if (isBlank(cls) || cls.value === OWL_INDIV) continue;
        if (showClasses && !nodes.has(cls.value)) addNode(cls.value, 'class');
        if (nodes.has(cls.value)) addEdge(ind, cls.value, 'type');
      }
    }
  }

  return {
    nodes: [...nodes.values()].map(d => ({ data: d })),
    edges,
  };
}
