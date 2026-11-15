<?php
// modal_platform_users_tools.php
// Gestione di users.user_type (ruolo GLOBALE di piattaforma: V/U/I/P — X escluso,
// resta assegnabile solo modificando la tabella users direttamente) e invio
// email bulk agli utenti selezionati.
//
// Riservato interamente all'amministratore (X): la modale che lo consuma
// (ui/modal_platform_users.php) è già visibile solo a X nel menu (vedi
// ui/header.php, $showPlatformUsers) — ma questo endpoint verifica comunque
// da sé chi lo chiama, non fidandosi della sola visibilità del menu (stesso
// principio già applicato correggendo ui/modal_permits_tools.php e
// ui/modal_researches_tools.php — vedi _doc/arch-permessi.md §4ter/§6).

declare(strict_types=1);

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../api/i18n.php';
require_once __DIR__ . '/../api/db.php';

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
function valid_platform_role(string $r): bool { return in_array($r, ['V', 'U', 'I', 'P'], true); }

$_ppUser = $_SESSION['user'] ?? null;
if (!is_array($_ppUser) || empty($_ppUser['id'])) json_err(t('errors.not_authenticated'), 401);
if ((string)($_ppUser['user_type'] ?? '') !== 'X') {
  json_err(t('modal.platform_users.err.admin_only.@'), 403);
}
$_ppUserId = (int)$_ppUser['id'];

try {
  if (!isset($pdo) || !($pdo instanceof PDO)) json_err(t('errors.internal'), 500);

  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  $action = $_GET['action'] ?? null;

  // ------------------------------------------------------------
  // GET: lista di tutti gli utenti verificati della piattaforma
  // ------------------------------------------------------------
  if ($method === 'GET' && $action === 'list_users') {
    $sql = "
      SELECT id AS user_id, last_name, first_name, user_name, email, user_type
      FROM users
      WHERE is_verified = 1
      ORDER BY last_name ASC, first_name ASC
    ";
    $st = $pdo->query($sql);
    json_ok($st->fetchAll(PDO::FETCH_ASSOC));
  }

  $body = ($method === 'POST') ? read_json_body() : [];
  $actionPost = $body['action'] ?? null;

  // ------------------------------------------------------------
  // POST: salva ruolo piattaforma (V/U/I/P) per uno o più utenti
  // ------------------------------------------------------------
  if ($method === 'POST' && $actionPost === 'save_user_types') {
    $changes = $body['changes'] ?? null;
    if (!is_array($changes)) json_err(t('errors.invalid_request'));

    $upd = $pdo->prepare("UPDATE users SET user_type = ? WHERE id = ?");
    $updated = 0;
    $skippedSelf = false;

    foreach ($changes as $ch) {
      $user_id = (int)($ch['user_id'] ?? 0);
      $now = (string)($ch['now'] ?? '');
      if ($user_id <= 0) continue;
      if (!valid_platform_role($now)) json_err(t('modal.platform_users.err.invalid_role', ['role' => $now]));

      // Un amministratore non può modificare il proprio ruolo da questa
      // modale (evita l'auto-declassamento accidentale — vedi anche l'unico
      // modo per assegnare X, sempre escluso da valid_platform_role: rimane
      // una modifica diretta sul DB).
      if ($user_id === $_ppUserId) { $skippedSelf = true; continue; }

      $upd->execute([$now, $user_id]);
      $updated++;
    }

    json_ok(['updated' => $updated, 'skipped_self' => $skippedSelf]);
  }

  // ------------------------------------------------------------
  // POST: invio email bulk agli utenti selezionati
  // ------------------------------------------------------------
  if ($method === 'POST' && $actionPost === 'send_email') {
    $userIds   = $body['user_ids'] ?? null;
    $subject   = trim((string)($body['subject'] ?? ''));
    $bodyPlain = (string)($body['body'] ?? '');

    if (!is_array($userIds) || !count($userIds)) json_err(t('modal.platform_users.no_recipients'));
    if ($subject === '') json_err(t('modal.platform_users.err.subject_missing'));
    if (trim($bodyPlain) === '') json_err(t('modal.platform_users.err.body_missing'));

    $userIds = array_values(array_unique(array_map('intval', $userIds)));
    $placeholders = implode(',', array_fill(0, count($userIds), '?'));
    $st = $pdo->prepare("SELECT id, first_name, last_name, email FROM users WHERE id IN ($placeholders) AND email <> ''");
    $st->execute($userIds);
    $recipients = array_map(static fn(array $r): array => [
      'email' => $r['email'],
      'name'  => trim($r['first_name'] . ' ' . $r['last_name']),
    ], $st->fetchAll(PDO::FETCH_ASSOC));

    if (!count($recipients)) json_err(t('modal.platform_users.err.no_valid_recipients'));

    require_once __DIR__ . '/../api/mail_helper.php';
    $bodyHtml = nl2br(htmlspecialchars($bodyPlain, ENT_QUOTES, 'UTF-8'));
    $result = mail_send_bulk($recipients, $subject, $bodyHtml);

    json_ok($result);
  }

  json_err(t('errors.invalid_request'), 400);

} catch (Throwable $e) {
  json_err(t('modal.platform_users.err.server', ['error' => $e->getMessage()]), 500);
}
