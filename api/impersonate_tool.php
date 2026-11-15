<?php
// api/impersonate_tool.php
// "Accedi come" — impersonazione utente per l'amministratore (X), sul
// modello del "Log In As User" di OJS. Vedi _doc/arch-permessi.md.
//
// POST { action:'start', user_id }  → solo X, target non X, nessuna
//                                      impersonazione già attiva
// POST { action:'stop' }            → richiede un'impersonazione attiva
//
// Meccanismo: $_SESSION['impersonator'] conserva la riga utente
// dell'amministratore REALE mentre $_SESSION['user'] diventa quella
// dell'utente impersonato — 'stop' inverte l'operazione. research/
// workpackage/res_id/wp_id vengono sempre azzerati al cambio identità: sono
// permessi specifici per utente, non ha senso mantenere la selezione
// precedente (l'utente riparte dalla landing page, researches.php).
//
// Ogni avvio/fine è loggato in activity_log (log_activity(), api/log_tool.php)
// con l'amministratore REALE come autore (user_id) e l'utente target in
// entity_id/entity_name — mai il contrario.

declare(strict_types=1);

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';

function json_ok($data = null): void {
  echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
  exit;
}
function json_err(string $msg, int $code = 400): void {
  http_response_code($code);
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}
function read_json_body(): array {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}
function impersonate_display_name(array $u): string {
  $name = trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? ''));
  return $name !== '' ? $name : (string)($u['email'] ?? '');
}
// research/workpackage sono permessi specifici dell'utente: azzerare la
// selezione al cambio identità evita di navigare con permessi di qualcun
// altro attribuiti alla persona sbagliata.
function reset_scope_session(): void {
  unset($_SESSION['research'], $_SESSION['workpackage'], $_SESSION['res_id'], $_SESSION['wp_id']);
}

$currentUser = $_SESSION['user'] ?? null;
if (!is_array($currentUser) || empty($currentUser['id'])) {
  json_err('Utente non autenticato.', 401);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_err('Metodo non consentito.', 405);
}

$body = read_json_body();
$action = $body['action'] ?? null;

try {
  if (!isset($pdo) || !($pdo instanceof PDO)) json_err('Connessione DB non disponibile.', 500);

  // ------------------------------------------------------------
  // START — avvia l'impersonazione
  // ------------------------------------------------------------
  if ($action === 'start') {
    if (isset($_SESSION['impersonator'])) {
      json_err('Stai già impersonando un utente: esci prima da questa modalità.', 409);
    }
    if ((string)($currentUser['user_type'] ?? '') !== 'X') {
      json_err("Permesso negato: riservato all'amministratore.", 403);
    }

    $targetId = (int)($body['user_id'] ?? 0);
    if ($targetId <= 0) json_err('user_id mancante.');
    if ($targetId === (int)$currentUser['id']) json_err('Non puoi impersonare te stesso.');

    $st = $pdo->prepare('SELECT * FROM users WHERE id = ? AND is_verified = 1 LIMIT 1');
    $st->execute([$targetId]);
    $target = $st->fetch(PDO::FETCH_ASSOC);
    if (!$target) json_err('Utente non trovato o non verificato.', 404);

    // Un amministratore non impersona un altro amministratore.
    if ((string)($target['user_type'] ?? '') === 'X') {
      json_err('Non è possibile impersonare un altro amministratore.', 403);
    }

    // Loggato PRIMA dello scambio di sessione: log_activity() usa
    // $_SESSION['user']['id'] come autore, che a questo punto è ancora
    // l'amministratore reale — esattamente l'autore che vogliamo registrare.
    log_activity('auth:impersonate_start', 'user', $targetId, impersonate_display_name($target));

    require_once __DIR__ . '/session_user.php';
    ra_session_set_user($target, true);           // cambio d'identità: nuova sessione, niente password_hash
    $_SESSION['impersonator'] = $currentUser;     // riga completa, per poter tornare indietro
    reset_scope_session();

    json_ok(['redirect' => 'researches.php']);
  }

  // ------------------------------------------------------------
  // STOP — termina l'impersonazione, torna all'amministratore reale
  // ------------------------------------------------------------
  if ($action === 'stop') {
    $impersonator = $_SESSION['impersonator'] ?? null;
    if (!is_array($impersonator) || empty($impersonator['id'])) {
      json_err('Nessuna impersonazione attiva.', 409);
    }

    $impersonatedId   = (int)($currentUser['id'] ?? 0);
    $impersonatedName = impersonate_display_name($currentUser);

    require_once __DIR__ . '/session_user.php';
    ra_session_set_user($impersonator, true);
    unset($_SESSION['impersonator']);
    reset_scope_session();

    // Loggato DOPO il ripristino: ora $_SESSION['user']['id'] è di nuovo
    // l'amministratore, autore corretto anche per l'evento di uscita.
    log_activity('auth:impersonate_stop', 'user', $impersonatedId, $impersonatedName);

    json_ok(['redirect' => 'researches.php']);
  }

  json_err('Azione non valida.', 400);

} catch (Throwable $e) {
  json_err('Errore server: ' . $e->getMessage(), 500);
}
