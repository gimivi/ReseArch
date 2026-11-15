// OWL-parser.mjs
// Parse RDF/OWL text → rdflib Store
// Richiede window.$rdf (rdflib.min.js caricato globalmente in dashboard.php)
// Formati supportati: Turtle, RDF/XML, N-Triples, N3, TriG, JSON-LD

export const RDF  = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
export const OWL  = 'http://www.w3.org/2002/07/owl#';
export const XSD  = 'http://www.w3.org/2001/XMLSchema#';

// Mappa formato logico → MIME type atteso da rdflib.$rdf.parse()
const FORMAT_MIME = {
  'turtle':      'text/turtle',
  'rdf-xml':     'application/rdf+xml',
  'n-triples':   'application/n-triples',
  'n3':          'text/n3',
  'trig':        'application/trig',
  'json-ld':     'application/ld+json',
};

/**
 * Parse RDF text → rdflib Store
 * @param {string} text
 * @param {string} format   chiave in FORMAT_MIME
 * @param {string} [baseUri]
 * @returns {object}  rdflib Store
 */
export function parseRdf(text, format = 'turtle', baseUri = 'http://owl.base/') {
  if (!window.$rdf) throw new Error('[OWL-parser] rdflib.js non caricato (window.$rdf mancante)');
  const store    = window.$rdf.graph();
  const mimeType = FORMAT_MIME[format] ?? 'text/turtle';
  window.$rdf.parse(text, store, baseUri, mimeType);
  return store;
}

/**
 * Fetch file RDF da URL e parsalo — usa l'URL come base URI
 * @param {string} url
 * @param {string} format
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>}  rdflib Store
 */
export async function fetchAndParseRdf(url, format = 'turtle', signal) {
  const res = await fetch(url, { signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`[OWL-parser] HTTP ${res.status} — ${url}`);
  const text = await res.text();
  // rdflib richiede URI assoluto come base; mod_abs_url può essere relativo
  const absoluteUrl = new URL(url, window.location.href).href;
  return parseRdf(text, format, absoluteUrl);
}

/**
 * Rileva il formato dall'estensione del file.
 * .owl e .rdf vengono trattati come RDF/XML (serializzazione più comune).
 * @param {string} urlOrFilename
 * @returns {string}  chiave formato
 */
export function detectFormat(urlOrFilename) {
  const s = (urlOrFilename ?? '').toLowerCase().split('?')[0]; // ignora query string
  if (s.endsWith('.ttl'))                         return 'turtle';
  if (s.endsWith('.nt'))                          return 'n-triples';
  if (s.endsWith('.n3'))                          return 'n3';
  if (s.endsWith('.trig'))                        return 'trig';
  if (s.endsWith('.jsonld') || s.endsWith('.json-ld')) return 'json-ld';
  if (s.endsWith('.owl') || s.endsWith('.rdf'))   return 'rdf-xml';
  return 'turtle'; // default
}
