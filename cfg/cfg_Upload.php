<?php
// /CFG/CFG_upload.php

return [

  // Limite massimo per singolo file
  'max_bytes' => 256 * 1024 * 1024, // 256 MB

  // Estensioni consentite (minuscolo, SENZA punto)
  // FIX (2026-09-17): 'drc' e 'wrl'/'vrml' mancavano pur essendo formati già
  // supportati da TJS-loaders.mjs (loadDRC, loadVRML) — un file in questi
  // formati non poteva essere caricato tramite questa modale (diverso dal
  // controllo analogo, disattivato, in ui/modal_models_tools.php). Aggiunta
  // anche 'ply' per il nuovo loader nativo di comodo (loadPLY) e 'jpeg' per
  // coerenza con 'jpg' (loadPSH accetta entrambe le estensioni).
  'allowed_ext' => [
    '3dm',
    'obj',
    'mtl',
    'gltf',
    'glb',
    'ifc',
    'txt',
    'pdf',
    'jpg',
    'jpeg',
    'png',
    'csv',
    'json',
    'svg',
    'drc',
    'ply',
    'wrl',
    'vrml',
    'wrz',     // VRML compresso (gzip), letto da loadVRML (2026-09-26)
    // (2026-09-23) musica di sottofondo di HySpace: file nelle cartelle del WP,
    // referenziati con percorsi relativi dai nodi HYS/Audio/* dei flow dell'oggetto
    'mp3',
    // (2026-10-07) fogli di stile dei modelli (mod_spec.css, prima APP: TML) e i loro font.
    // Il CSS non esegue codice; i moduli lo ripuliscono e lo confinano al pannello
    // (app/shared/model-css.mjs).
    'css',
    'woff2',
    // (2026-10-07) pagine HTML (HTM): ammesse SOLO se RA_Data è protetta, vedi 'sandbox_ext'
    'html',
    'htm',
    // (2026-10-13) estensioni richieste dalle APP ma finora rifiutate (guide install/help/):
    'xml',     // OSD: ImageProperties.xml delle immagini Zoomify — documento: vedi 'sandbox_ext'
    'mp4',     // VID
    'webm',    // VID
    'frag',    // IFC: modelli That Open Fragments
    // OWL: formati RDF (owl/rdf sono RDF/XML, documenti: vedi 'sandbox_ext')
    'owl', 'rdf', 'ttl', 'nt', 'n3', 'trig', 'jsonld',
    // (2026-11-04) OLY (cartografia): vettoriali e raster georiferiti. KML e GPX sono XML: RA_Data li
    // serve come application/octet-stream (mai aperti come documento), quindi non stanno in 'sandbox_ext'.
    'geojson', 'kml', 'gpx', 'tif', 'tiff', 'webp',
  ],

  // (2026-10-07) Estensioni che, aperte come documento, possono eseguire script sulla stessa
  // origine della piattaforma. Si caricano solo se RA_Data/.htaccess o RA_Data/web.config
  // contiene 'sandbox_marker' (file modello in install/RA_Data/: intestazione
  // Content-Security-Policy "sandbox"). Il controllo è in ui/modal_uploads_tools.php.
  // .svg non è qui perché serve a TJS da sempre: la stessa intestazione lo protegge.
  // (2026-10-13) anche xml/owl/rdf: aperti come documento possono contenere XHTML con script.
  'sandbox_ext'    => ['html', 'htm', 'xml', 'owl', 'rdf'],
  'sandbox_marker' => 'ReseArch-RA_Data-sandbox',

  // Sovrascrittura file duplicati
  'overwrite' => true,

  // Regex per segmenti di path relativi (cartelle)
  'safe_path_segment' => '/^[A-Za-z0-9_\-\.]+$/',

];
