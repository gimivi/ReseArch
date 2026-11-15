<?php
// api/map_proxy.php
// Passaggio dal server per i servizi WMS del catalogo dell'App OLY (lib/map-services.json) che il
// browser non può usare da solo (2026-11-04, _doc/module-oly-openlayers.md §13):
//   - servizi solo http (Geoportale Nazionale): una pagina https non può caricarli;
//   - servizi senza CORS (Catasto AdE): le immagini si vedono ma la mappa non si esporta in PNG e
//     le informazioni sugli elementi (GetFeatureInfo) non si leggono.
//
//   GET ?svc=<id>&SERVICE=WMS&REQUEST=GetMap|GetLegendGraphic&…   → l'immagine (png, jpeg, gif, webp)
//   GET ?svc=<id>&SERVICE=WMS&REQUEST=GetFeatureInfo&…            → JSON { ok:true, data:{ layers:[ { name, features:[ {k:v} ] } ] } }
//
// Sicurezza:
//   - NON è un proxy aperto: l'indirizzo viene solo dal catalogo (servizio "enabled" con "proxy": true,
//     type "wms"); il browser manda soltanto l'id e i parametri WMS, filtrati per nome e per valore;
//     i layer richiesti devono essere fra quelli del catalogo (o fra "query_layers");
//   - solo utenti in sessione (anche gli ospiti: il catalogo è fisso); sessione chiusa subito, così le
//     richieste in parallelo di una mappa non si mettono in coda;
//   - redirect non seguiti; al massimo PROXY_MAX byte in PROXY_TIMEOUT s;
//   - al browser passano solo immagini (niente SVG) o JSON costruito qui: l'HTML del servizio
//     (GetFeatureInfo dell'AdE) viene letto dal server e mai inoltrato.

if (session_status() === PHP_SESSION_NONE) session_start();
require_once __DIR__ . '/visibility.php';   // ra_session_user_ok

const PROXY_MAX     = 15 * 1024 * 1024;
const PROXY_TIMEOUT = 30;
const PROXY_MAX_PX  = 4096;
const CATALOG_FILE  = __DIR__ . '/../lib/map-services.json';

function mp_err(string $msg, int $code = 400): never {
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
    }
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!ra_session_user_ok($_SESSION['user'] ?? null)) mp_err('Not authenticated.', 401);
session_write_close();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') mp_err('Method not allowed.', 405);
if (!function_exists('curl_init')) mp_err('PHP curl extension not available on the server.', 500);

// ── servizio dal catalogo ──────────────────────────────────────────────────
$id = (string)($_GET['svc'] ?? '');
if (!preg_match('/^[a-z0-9][a-z0-9_-]{0,63}$/i', $id)) mp_err('Missing or invalid svc.');
$catalog = json_decode((string)@file_get_contents(CATALOG_FILE), true);
if (!is_array($catalog['services'] ?? null)) mp_err('Service catalog not readable.', 500);
$svc = null;
foreach ($catalog['services'] as $s) if (($s['id'] ?? null) === $id) { $svc = $s; break; }
if (!$svc) mp_err('Service not in the catalog.', 404);
if (($svc['enabled'] ?? true) === false) mp_err('Service disabled in the catalog.', 403);
if (empty($svc['proxy']) || ($svc['type'] ?? '') !== 'wms') mp_err('Service not available through the server.', 403);
$base = (string)($svc['url'] ?? '');
$bp = parse_url($base);
if (!$bp || !in_array(strtolower($bp['scheme'] ?? ''), ['http', 'https'], true) || empty($bp['host'])) mp_err('Invalid service address in the catalog.', 500);

// ── parametri WMS ammessi (nomi senza distinzione di maiuscole) ─────────────
$in = [];
foreach ($_GET as $k => $v) if (is_string($v)) $in[strtoupper((string)$k)] = $v;

$request = $in['REQUEST'] ?? '';
$requests = ['GETMAP' => 'GetMap', 'GETLEGENDGRAPHIC' => 'GetLegendGraphic', 'GETFEATUREINFO' => 'GetFeatureInfo'];
if (!isset($requests[strtoupper($request)])) mp_err('REQUEST must be GetMap, GetLegendGraphic or GetFeatureInfo.');
$request = $requests[strtoupper($request)];
if ($request === 'GetFeatureInfo' && empty($svc['info'])) mp_err('Feature info not enabled for this service.', 403);

$csv = fn(string $s) => array_values(array_filter(array_map('trim', explode(',', $s)), fn($x) => $x !== ''));
$allowedLayers = $csv((string)($svc['layers'] ?? ''));
$queryLayers   = $csv((string)($svc['query_layers'] ?? '')) ?: $allowedLayers;
$checkLayers = function (string $value, array $allowed) use ($csv): string {
    $list = $csv($value);
    if (!$list) mp_err('Missing layers.');
    foreach ($list as $l) if (!in_array($l, $allowed, true)) mp_err('Layer not allowed: ' . $l, 403);
    return implode(',', $list);
};
$num = '/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/';

$out = ['SERVICE' => 'WMS', 'REQUEST' => $request, 'VERSION' => (string)($svc['version'] ?? '1.3.0')];
$rules = [
    'FORMAT'        => '#^image/(png|jpeg|gif|webp)(; ?mode=\w+)?$#i',
    'TRANSPARENT'   => '/^(true|false)$/i',
    'STYLES'        => '/^[\w.,:-]*$/',
    'STYLE'         => '/^[\w.:-]*$/',
    'CRS'           => '/^EPSG:\d{4,6}$/i',
    'SRS'           => '/^EPSG:\d{4,6}$/i',
    'BBOX'          => '/^-?[\d.eE+-]+(,-?[\d.eE+-]+){3}$/',
    'WIDTH'         => '/^\d{1,5}$/',
    'HEIGHT'        => '/^\d{1,5}$/',
    'I' => '/^\d{1,5}$/', 'J' => '/^\d{1,5}$/', 'X' => '/^\d{1,5}$/', 'Y' => '/^\d{1,5}$/',
    'FEATURE_COUNT' => '/^\d{1,2}$/',
    'SCALE'         => $num,
    'DPI'           => '/^\d{1,4}$/',
    'SLD_VERSION'   => '/^[\d.]{1,8}$/',
    'EXCEPTIONS'    => '#^[\w./-]{1,64}$#',
];
foreach ($rules as $k => $re) {
    if (!isset($in[$k]) || $in[$k] === '') continue;
    if (!preg_match($re, $in[$k])) mp_err("Invalid parameter $k.");
    $out[$k] = $in[$k];
}
foreach (['WIDTH', 'HEIGHT'] as $k) if (isset($out[$k]) && ((int)$out[$k] < 1 || (int)$out[$k] > PROXY_MAX_PX)) mp_err("$k out of range.");
if (isset($out['BBOX'])) foreach (explode(',', $out['BBOX']) as $n) if (!preg_match($num, $n)) mp_err('Invalid parameter BBOX.');

if ($request === 'GetMap') {
    $out['LAYERS'] = $checkLayers((string)($in['LAYERS'] ?? ''), $allowedLayers);
    foreach (['BBOX', 'WIDTH', 'HEIGHT'] as $k) if (!isset($out[$k])) mp_err("Missing $k.");
    $out['FORMAT'] = $out['FORMAT'] ?? (string)($svc['format'] ?? 'image/png');
    $out['STYLES'] = $out['STYLES'] ?? '';
} elseif ($request === 'GetLegendGraphic') {
    $out['LAYER'] = $checkLayers((string)($in['LAYER'] ?? ''), $allowedLayers);
    if (str_contains($out['LAYER'], ',')) mp_err('One layer per legend.');
    $out['FORMAT'] = $out['FORMAT'] ?? 'image/png';
} else {
    $out['QUERY_LAYERS'] = $checkLayers((string)($in['QUERY_LAYERS'] ?? ''), $queryLayers);
    // LAYERS = QUERY_LAYERS: MapServer (AdE) rifiuta i layer interrogati che non sono anche in LAYERS
    $out['LAYERS'] = $out['QUERY_LAYERS'];
    foreach (['BBOX', 'WIDTH', 'HEIGHT'] as $k) if (!isset($out[$k])) mp_err("Missing $k.");
    // il formato lo decide il catalogo (il server lo converte in JSON)
    $out['INFO_FORMAT'] = (string)($svc['info_format'] ?? 'text/plain');
    $out['FEATURE_COUNT'] = $out['FEATURE_COUNT'] ?? '5';
    $out['STYLES'] = $out['STYLES'] ?? '';
    unset($out['FORMAT'], $out['TRANSPARENT']);
}

// i parametri fissi dell'indirizzo del catalogo (es. map=… del Geoportale) restano quelli
parse_str((string)($bp['query'] ?? ''), $fixed);
$fixedUpper = array_change_key_case($fixed, CASE_UPPER);
foreach ($out as $k => $_) if (array_key_exists($k, $fixedUpper)) unset($out[$k]);
$url = preg_replace('/\?.*$/', '', $base) . '?' . http_build_query(array_merge($fixed, $out), '', '&', PHP_QUERY_RFC3986);

// ── richiesta ──────────────────────────────────────────────────────────────
$headers = [];
$status = 0;
$body = '';
$tooBig = false;
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT        => PROXY_TIMEOUT,
    CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; ReseArch map viewer)',
    CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$headers, &$status) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) { $status = (int)$m[1]; $headers = []; }
        $pos = strpos($line, ':');
        if ($pos !== false) $headers[strtolower(trim(substr($line, 0, $pos)))] = trim(substr($line, $pos + 1));
        return strlen($line);
    },
    CURLOPT_WRITEFUNCTION  => function ($ch, $data) use (&$body, &$tooBig) {
        if (strlen($body) + strlen($data) > PROXY_MAX) { $tooBig = true; return 0; }
        $body .= $data;
        return strlen($data);
    },
]);
curl_exec($ch);
$err = curl_errno($ch) ? curl_error($ch) : '';
curl_close($ch);

if ($tooBig) mp_err('Response too big.', 413);
if ($status === 0) mp_err($err !== '' ? "Service not reachable: $err" : 'Service not reachable.', 502);
if ($status !== 200) mp_err("Service answered HTTP $status.", 502);
$ctype = strtolower(trim(explode(';', $headers['content-type'] ?? '')[0]));

// ── immagini ───────────────────────────────────────────────────────────────
if ($request !== 'GetFeatureInfo') {
    if (!in_array($ctype, ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], true)) {
        // di solito un'eccezione WMS in XML: se ne passa solo il testo
        $msg = trim(preg_replace('/\s+/', ' ', strip_tags($body)));
        mp_err('Service error: ' . mb_substr($msg !== '' ? $msg : ($ctype ?: 'unknown type'), 0, 300), 502);
    }
    header('Content-Type: ' . $ctype);
    header('Content-Length: ' . strlen($body));
    header('Cache-Control: private, max-age=86400');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; sandbox");
    echo $body;
    exit;
}

// ── GetFeatureInfo → JSON ─────────────────────────────────────────────────
/** Tabelle HTML (MapServer/AdE): <th colspan> = titolo del layer; righe <th>chiave</th><td>valore</td>. */
function mp_parse_html(string $html): array {
    $layers = [];
    if (!class_exists('DOMDocument')) return $layers;
    $doc = new DOMDocument();
    $prev = libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
    libxml_clear_errors();
    libxml_use_internal_errors($prev);
    foreach ($doc->getElementsByTagName('table') as $table) {
        $name = '';
        $feature = [];
        $features = [];
        foreach ($table->getElementsByTagName('tr') as $tr) {
            $ths = $tr->getElementsByTagName('th');
            $tds = $tr->getElementsByTagName('td');
            if ($ths->length === 1 && $tds->length === 0) {          // titolo
                if ($feature) { $features[] = $feature; $feature = []; }
                $name = trim(preg_replace('/\s+/', ' ', $ths->item(0)->textContent));
            } elseif ($ths->length === 1 && $tds->length >= 1) {     // chiave / valore
                $k = trim(preg_replace('/\s+/', ' ', $ths->item(0)->textContent));
                if ($k !== '' && array_key_exists($k, $feature)) { $features[] = $feature; $feature = []; }
                if ($k !== '') $feature[$k] = trim(preg_replace('/\s+/', ' ', $tds->item(0)->textContent));
            } elseif ($ths->length > 1 && $tds->length === 0) {      // intestazione di una tabella a colonne
                $cols = [];
                foreach ($ths as $th) $cols[] = trim($th->textContent);
                $table->setAttribute('data-cols', json_encode($cols));
            } elseif ($tds->length > 1 && $table->hasAttribute('data-cols')) {
                $cols = json_decode($table->getAttribute('data-cols'), true) ?: [];
                $row = [];
                foreach ($tds as $i => $td) $row[$cols[$i] ?? ('col' . ($i + 1))] = trim(preg_replace('/\s+/', ' ', $td->textContent));
                $features[] = $row;
            }
        }
        if ($feature) $features[] = $feature;
        if ($features) $layers[] = ['name' => $name, 'features' => array_slice($features, 0, 20)];
    }
    return $layers;
}

/** Testo semplice di MapServer: "Layer 'nome'", "Feature n:", "  chiave = 'valore'". */
function mp_parse_plain(string $text): array {
    $layers = [];
    $cur = null;
    $feature = null;
    foreach (preg_split('/\r?\n/', $text) as $line) {
        if (preg_match("/^Layer '(.+)'/", $line, $m)) {
            if ($cur !== null) { if ($feature) $cur['features'][] = $feature; $layers[] = $cur; }
            $cur = ['name' => $m[1], 'features' => []];
            $feature = null;
        } elseif (preg_match('/^\s*Feature \d+:/', $line)) {
            if ($cur === null) $cur = ['name' => '', 'features' => []];
            if ($feature) $cur['features'][] = $feature;
            $feature = [];
        } elseif ($feature !== null && preg_match("/^\s+([^=]+?)\s*=\s*'?(.*?)'?\s*$/", $line, $m)) {
            $feature[$m[1]] = $m[2];
        }
    }
    if ($cur !== null) { if ($feature) $cur['features'][] = $feature; $layers[] = $cur; }
    return array_values(array_filter($layers, fn($l) => count($l['features']) > 0));
}

// testo non UTF-8 (es. ISO-8859-1): convertito, altrimenti json_encode fallirebbe
if (!mb_check_encoding($body, 'UTF-8')) $body = mb_convert_encoding($body, 'UTF-8', 'ISO-8859-1');
$layers = [];
if (str_contains($ctype, 'html')) $layers = mp_parse_html($body);
elseif ($ctype === 'text/plain') $layers = mp_parse_plain($body);
elseif ($ctype === 'application/json' || $ctype === 'application/geo+json') {
    $j = json_decode($body, true);
    $feats = [];
    foreach (($j['features'] ?? []) as $f) if (is_array($f['properties'] ?? null)) $feats[] = $f['properties'];
    if ($feats) $layers[] = ['name' => '', 'features' => array_slice($feats, 0, 20)];
} else {
    mp_err('Feature info format not supported: ' . ($ctype ?: 'unknown'), 502);
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=300');
header('X-Content-Type-Options: nosniff');
echo json_encode(['ok' => true, 'data' => ['layers' => $layers]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
