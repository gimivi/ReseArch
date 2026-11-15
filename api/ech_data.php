<?php
// api/ech_data.php
// Esegue query MySQL per i grafici ECharts (model_ECH.mjs).
//
// Accesso consentito SOLO agli utenti con user_type = 'X' (amministratori).
// La query viene da mod_spec.dataSource.sql — controllata dall'admin.
//
// POST { sql: "SELECT ...", params: [] }
// → { ok: true, rows: [...], fields: [...], count: N }

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

require_once __DIR__ . '/db.php'; // fornisce $pdo
require_once __DIR__ . '/visibility.php';   // ra_session_user_ok, ra_is_guest (ospiti, id 0)

// --- Helpers ----------------------------------------------------------------

function ech_ok(mixed $data): never {
    echo json_encode(['ok' => true, ...$data], JSON_UNESCAPED_UNICODE);
    exit;
}

function ech_err(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function ech_body(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

// --- Auth: solo admin (user_type = 'X') -------------------------------------

$user = $_SESSION['user'] ?? null;
if (!ra_session_user_ok($user)) {
    ech_err('Non autenticato.', 401);   // ospite: 403 sotto, come ogni non amministratore
}
if (($user['user_type'] ?? '') !== 'X') {
    ech_err('Accesso negato. Le query MySQL per i grafici richiedono un account amministratore.', 403);
}

// --- Contesto WP (per log/tracciabilità futura) ----------------------------

$workpackage = $_SESSION['workpackage'] ?? null;
$wp_id = (int)($workpackage['wp_id'] ?? 0);

// --- DB check ---------------------------------------------------------------

if (!isset($pdo) || !($pdo instanceof PDO)) {
    ech_err('Connessione DB non disponibile.', 500);
}

// --- Solo POST --------------------------------------------------------------

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    ech_err('Metodo non supportato. Usare POST.', 405);
}

$body = ech_body();

// --- Validazione SQL --------------------------------------------------------

$sql = trim((string)($body['sql'] ?? ''));
if ($sql === '') {
    ech_err('Parametro "sql" mancante.', 400);
}

// Accetta solo SELECT (dopo stripping di commenti inline semplici)
$sqlFirstWord = strtoupper(preg_replace('/\s+/', ' ', preg_replace('/--[^\n]*/', '', $sql)));
if (!str_starts_with(ltrim($sqlFirstWord), 'SELECT')) {
    ech_err('Solo query SELECT sono consentite.', 400);
}

// Params per prepared statement (opzionali, devono essere scalari)
$params = $body['params'] ?? [];
if (!is_array($params)) $params = [];
foreach ($params as $p) {
    if (!is_scalar($p) && $p !== null) {
        ech_err('I parametri devono essere scalari.', 400);
    }
}

// --- Esecuzione -------------------------------------------------------------

try {
    $st = $pdo->prepare($sql);
    $st->execute($params);

    $rows   = $st->fetchAll(PDO::FETCH_ASSOC);
    $fields = $rows ? array_keys($rows[0]) : [];

    ech_ok([
        'rows'   => $rows,
        'fields' => $fields,
        'count'  => count($rows),
    ]);

} catch (PDOException $e) {
    // Non esponiamo dettagli tecnici al client (solo all'admin ma log server-side)
    error_log('[ech_data] PDOException: ' . $e->getMessage());
    ech_err('Errore nell\'esecuzione della query: ' . $e->getMessage(), 500);

} catch (Throwable $e) {
    error_log('[ech_data] Error: ' . $e->getMessage());
    ech_err('Errore server.', 500);
}
