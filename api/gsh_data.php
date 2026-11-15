<?php
// api/gsh_data.php
// Recupera dati da un foglio Google Sheets pubblico per model_GSH.mjs.
//
// POST { action:'fetch', mod_id }
//
// Sicurezza:
//   - Autenticazione sessione obbligatoria
//   - Verifica che mod_id appartenga al workpackage corrente
//   - spreadsheetId e gid vengono SOLO dal mod_spec del DB (mai dal client)
//   - spreadsheetId validato con regex → previene SSRF
//   - Il foglio deve essere condiviso con "Chiunque abbia il link può visualizzare"
//
// mod_spec richiesto:
//   spreadsheetId  — ID del foglio (dalla URL di Google Sheets)
//   gid            — GID della scheda (0 = prima scheda, default 0)
//   hasHeaders     — true (default): prima riga = intestazioni
//   limit          — max righe (default 1000)

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) session_start();

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(mixed $data = null): never {
    echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['success' => false, 'message' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';
require_once __DIR__ . '/visibility.php';   // ra_session_user_ok, ra_is_guest (ospiti, id 0)

$user = $_SESSION['user'] ?? null;
if (!ra_session_user_ok($user)) fail('Non autenticato.', 401);   // solo lettura: aperta agli ospiti

$workpackage = $_SESSION['workpackage'] ?? null;
if (!is_array($workpackage)) fail('Contesto workpackage mancante.', 500);
$wp_id = (int)($workpackage['wp_id'] ?? 0);
if ($wp_id <= 0) fail('wp_id non disponibile.', 500);

// ── Body ──────────────────────────────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Metodo non supportato.', 405);

$raw = file_get_contents('php://input');
$req = json_decode($raw, true);
if (!is_array($req)) fail('Body JSON non valido.', 400);

$action = (string)($req['action'] ?? '');
if ($action !== 'fetch') fail('Azione non supportata.', 400);

// ── Verifica mod_id appartiene al wp corrente ─────────────────────────────────

$mod_id = isset($req['mod_id']) ? (int)$req['mod_id'] : 0;
if ($mod_id <= 0) fail('mod_id mancante.', 400);

$st = $pdo->prepare("
    SELECT mod_spec FROM models
    WHERE  mod_id = ? AND wp_id = ?
    LIMIT  1
");
$st->execute([$mod_id, $wp_id]);
$modelRow = $st->fetch(PDO::FETCH_ASSOC);
if (!$modelRow) fail('Modello non trovato o accesso negato.', 403);

// ── Legge mod_spec dal DB ─────────────────────────────────────────────────────

$modSpec = [];
if (!empty($modelRow['mod_spec'])) {
    $modSpec = is_string($modelRow['mod_spec'])
        ? (json_decode($modelRow['mod_spec'], true) ?: [])
        : (array)$modelRow['mod_spec'];
}

$sheetId = (string)($modSpec['spreadsheetId'] ?? '');
if ($sheetId === '') fail('mod_spec.spreadsheetId non configurato.', 500);

// Validazione SSRF: solo ID Google Sheets validi (alfanumerici, trattini, underscore, 20-80 car.)
if (!preg_match('/^[\w\-]{20,80}$/', $sheetId))
    fail('spreadsheetId non valido.', 400);

// GID: solo cifre
$gid        = preg_replace('/[^0-9]/', '', (string)($modSpec['gid'] ?? '0')) ?: '0';
$hasHeaders = (bool)($modSpec['hasHeaders'] ?? true);
$limit      = max(1, min((int)($modSpec['limit'] ?? 1000), 10000));

// ── Costruisce URL CSV Google Sheets ─────────────────────────────────────────

$csvUrl = "https://docs.google.com/spreadsheets/d/{$sheetId}/export"
        . "?format=csv&gid={$gid}";

// ── Fetch con cURL ────────────────────────────────────────────────────────────

if (!function_exists('curl_init')) fail('cURL non disponibile sul server.', 500);

$ch = curl_init($csvUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_TIMEOUT        => 20,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_USERAGENT      => 'ReseArch-GSH/1.0',
    CURLOPT_HTTPHEADER     => ['Accept: text/csv, text/plain, */*'],
]);

// Certificati CA: alcuni hosting (es. Windows condivisi) non hanno il bundle configurato in PHP e cURL
// rifiuta il certificato di Google (errore 60). cfg/cacert.pem = bundle ufficiale di curl.se
// (https://curl.se/ca/cacert.pem, da aggiornare ogni tanto). La verifica SSL resta attiva.
$caBundle = realpath(__DIR__ . '/../cfg/cacert.pem');
$caUsed   = $caBundle !== false && is_readable($caBundle);
if ($caUsed) curl_setopt($ch, CURLOPT_CAINFO, $caBundle);

$csv      = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
$curlNo   = curl_errno($ch);
curl_close($ch);

if ($csv === false || $curlErr) {
    // dettaglio solo nel log: errore cURL (60 = certificato, 6 = DNS, 7/28 = connessione) e bundle CA
    $caInfo = $caUsed ? 'cfg/cacert.pem usato' : 'cfg/cacert.pem non trovato';
    error_log("[gsh_data.php] cURL error $curlNo: $curlErr ($caInfo)");
    fail('Impossibile contattare Google Sheets.', 502);
}

if ($httpCode !== 200) {
    fail("Google Sheets ha risposto con HTTP $httpCode.", 502);
}

// Rileva redirect verso pagina di login (foglio privato)
if (
    stripos($csv, '<!DOCTYPE html') !== false ||
    stripos($csv, '<html')          !== false
) {
    fail(
        'Il foglio non è accessibile pubblicamente. ' .
        'Condividilo con "Chiunque abbia il link può visualizzare".',
        403
    );
}

// ── Parse CSV ─────────────────────────────────────────────────────────────────

$stream = fopen('php://temp', 'r+');
fwrite($stream, $csv);
rewind($stream);

$headers = null;
$rows    = [];
$rowNum  = 0;

while (($line = fgetcsv($stream)) !== false) {
    if ($hasHeaders && $headers === null) {
        // Prima riga → intestazioni; rimuove BOM se presente
        $line[0] = ltrim($line[0], "\xEF\xBB\xBF");
        $headers = $line;
        continue;
    }

    if ($headers !== null) {
        // Assicura che la riga abbia lo stesso numero di colonne
        $padded = array_pad($line, count($headers), '');
        $rows[] = array_combine($headers, $padded);
    } else {
        // hasHeaders = false → usa col_1, col_2, ...
        $rows[] = array_combine(
            array_map(fn($i) => 'col_' . ($i + 1), array_keys($line)),
            $line
        );
    }

    if (++$rowNum >= $limit) break;
}

fclose($stream);

log_activity('gsh:fetch', 'model', $mod_id, $sheetId, ['rows' => count($rows), 'gid' => $gid]);

ok([
    'rows'    => $rows,
    'meta'    => [
        'sheetId' => $sheetId,
        'gid'     => $gid,
        'total'   => count($rows),
    ],
]);
