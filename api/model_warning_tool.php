<?php
// api/model_warning_tool.php
// Traccia permanente delle correzioni automatiche fatte sui modelli al caricamento
// (app/TJS_sub_modules/TJS-model-check.mjs): scrive nel registro attività
// (activity_log, action "model:warning") così che l'amministratore ritrovi i modelli
// da ottimizzare a mano dal visualizzatore dei log.
//
// POST JSON { mod_id, kind, app?, url?, detail? }
//   kind ammessi: missing_normals
// Anti-ripetizione: lo stesso kind per lo stesso modello si registra al massimo una volta
// ogni 24 ore (tutti gli utenti insieme).
// Permessi: qualunque utente autenticato (è una segnalazione, non una modifica); il modello
// deve esistere.

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function mw_out(array $a, int $code = 200): never {
    http_response_code($code);
    echo json_encode($a, JSON_UNESCAPED_UNICODE);
    exit;
}

require_once __DIR__ . '/visibility.php';
if (!ra_session_user_ok($_SESSION['user'] ?? null)) mw_out(['ok' => false, 'error' => 'Non autenticato.'], 401);
// Ospiti: nessuna traccia nel registro (non sono utenti), ma nessun errore al client
if (ra_is_guest($_SESSION['user'])) mw_out(['ok' => true, 'skipped' => 'guest']);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') mw_out(['ok' => false, 'error' => 'Usare POST.'], 405);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';

$KINDS = ['missing_normals'];

$body  = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($body)) mw_out(['ok' => false, 'error' => 'JSON non valido.'], 400);

$modId = isset($body['mod_id']) && is_numeric($body['mod_id']) ? (int)$body['mod_id'] : 0;
$kind  = (string)($body['kind'] ?? '');
if ($modId <= 0) mw_out(['ok' => false, 'error' => 'mod_id mancante.'], 400);
if (!in_array($kind, $KINDS, true)) mw_out(['ok' => false, 'error' => 'kind non ammesso.'], 400);

try {
    $st = $pdo->prepare("SELECT mod_name FROM models WHERE mod_id = ? LIMIT 1");
    $st->execute([$modId]);
    $modName = $st->fetchColumn();
    if ($modName === false) mw_out(['ok' => false, 'error' => 'Modello non trovato.'], 404);

    // già registrato nelle ultime 24 ore?
    $st = $pdo->prepare("
        SELECT 1 FROM activity_log
        WHERE action = 'model:warning' AND entity_type = 'model' AND entity_id = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(detail, '$.kind')) = ?
          AND created_at > NOW() - INTERVAL 1 DAY
        LIMIT 1
    ");
    $st->execute([$modId, $kind]);
    if ($st->fetchColumn()) mw_out(['ok' => true, 'logged' => false, 'reason' => 'già registrato nelle ultime 24 ore']);

    // dettaglio limitato (niente payload arbitrari nel registro)
    $d = is_array($body['detail'] ?? null) ? $body['detail'] : [];
    $names = array_slice(array_map(fn($n) => mb_substr((string)$n, 0, 80), is_array($d['names'] ?? null) ? $d['names'] : []), 0, 30);
    $detail = [
        'kind'   => $kind,
        'app'    => mb_substr((string)($body['app'] ?? ''), 0, 10),
        'url'    => mb_substr((string)($body['url'] ?? ''), 0, 300),
        'meshes' => (int)($d['meshes'] ?? 0),
        'names'  => $names,
        'nota'   => 'correzione automatica al caricamento: normali calcolate; riesportare il modello con le normali',
    ];
    log_activity('model:warning', 'model', $modId, (string)$modName, $detail);
    mw_out(['ok' => true, 'logged' => true]);
} catch (Throwable $e) {
    mw_out(['ok' => false, 'error' => 'Errore server: ' . $e->getMessage()], 500);
}
