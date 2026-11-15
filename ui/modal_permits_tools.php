<?php
// modal_permits_tools.php
declare(strict_types=1);

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');

// --------------------------- DB --------------------------------
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

// Ruoli assegnabili (_doc/arch-permessi.md §11.2):
// - ricerca: utente I della piattaforma → W, I o C; utente U → solo C (collaboratore)
// - WP: chi è W o I sulla ricerca → I o C; chi è C sulla ricerca → solo C
function valid_res_perm(string $p, string $userType = 'I'): bool {
  if ($p === '') return true;
  return $userType === 'U' ? $p === 'C' : in_array($p, ['W', 'I', 'C'], true);
}
function valid_wp_perm(string $p, string $resPerm = 'I'): bool {
  if ($p === '') return true;
  return $resPerm === 'C' ? $p === 'C' : in_array($p, ['I', 'C'], true);
}

// FIX (2026-09-16): questo endpoint non verificava affatto chi lo chiamasse —
// né autenticazione né permesso — quindi chiunque poteva leggere/scrivere i
// permessi di QUALSIASI research/workpackage specificando l'id a piacere
// (escalation di privilegi). Vedi _doc/arch-permessi.md §6/§10.
$_permUser = $_SESSION['user'] ?? null;
if (!is_array($_permUser) || empty($_permUser['id'])) {
  json_err(t('errors.not_authenticated'), 401);
}
$_permUserId   = (int)$_permUser['id'];
$_permIsAdmin  = ((string)($_permUser['user_type'] ?? '')) === 'X';

// Richiede che l'utente corrente sia admin o PI (perm='P') della research
// indicata — stesso standard usato ovunque nell'app per gestire una research.
function require_res_pi(PDO $pdo, int $resId, int $userId, bool $isAdmin): void {
  if ($isAdmin) return;
  $st = $pdo->prepare("SELECT 1 FROM users_res_permissions WHERE res_id=? AND user_id=? AND perm='P' LIMIT 1");
  $st->execute([$resId, $userId]);
  if (!$st->fetchColumn()) json_err(t('modal.permits.err.need_pi.@'), 403);
}

// Richiede che l'utente corrente possa gestire i permessi di un workpackage:
// admin, PI della research, o WPL — che è un permesso 'W' sulla RESEARCH, non
// sul singolo WP (vedi _doc/arch-permessi.md §4bis).
function require_wp_manage(PDO $pdo, int $resId, int $userId, bool $isAdmin): void {
  if ($isAdmin) return;
  $st = $pdo->prepare("SELECT 1 FROM users_res_permissions WHERE res_id=? AND user_id=? AND perm IN ('P','W') LIMIT 1");
  $st->execute([$resId, $userId]);
  if (!$st->fetchColumn()) json_err(t('modal.permits.err.need_pi_or_wpl.@'), 403);
}

try {
  /** @var PDO $pdo */
  if (!isset($pdo) || !($pdo instanceof PDO)) json_err(t('modal.permits.err.db_unavailable'), 500);

  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  $action = $_GET['action'] ?? null;

  // ------------------------------------------------------------
  // GET: lista utenti per permessi ricerca
  // utenti verificati di tipo I (ricercatori) e U (utenti, solo come collaboratori)
  // users_res_permissions: PK (user_id,res_id)
  // ------------------------------------------------------------
  if ($method === 'GET' && $action === 'list_res_users') {
    $res_id = (int)($_GET['res_id'] ?? 0);
    if ($res_id <= 0) json_err(t('modal.permits.err.missing_param', ['name' => 'res_id']));
    require_res_pi($pdo, $res_id, $_permUserId, $_permIsAdmin);

    $sql = "
      SELECT
        u.id AS user_id,
        u.last_name,
        u.first_name,
        u.user_name,
        u.email,
        u.user_type,
        COALESCE(urp.perm, '') AS perm
      FROM users u
      LEFT JOIN users_res_permissions urp
        ON urp.user_id = u.id AND urp.res_id = ?
      WHERE u.user_type IN ('I','U') AND u.is_verified = 1
      ORDER BY u.last_name ASC, u.first_name ASC
    ";
    $st = $pdo->prepare($sql);
    $st->execute([$res_id]);
    json_ok($st->fetchAll(PDO::FETCH_ASSOC));
  }

  // ------------------------------------------------------------
  // GET: lista utenti per permessi WP
  // vincolo: utenti verificati (I o U) con perm ricerca W, I o C sulla research corrente;
  // mostra perm WP da users_wp_permissions e il perm di ricerca (decide i ruoli ammessi)
  // ------------------------------------------------------------
  if ($method === 'GET' && $action === 'list_wp_users') {
    $res_id = (int)($_GET['res_id'] ?? 0);
    $wp_id  = (int)($_GET['wp_id'] ?? 0);
    if ($res_id <= 0 || $wp_id <= 0) json_err(t('modal.permits.err.missing_params', ['names' => 'res_id/wp_id']));
    require_wp_manage($pdo, $res_id, $_permUserId, $_permIsAdmin);

    $sql = "
      SELECT
        u.id AS user_id,
        u.last_name,
        u.first_name,
        urp.perm AS res_perm,
        COALESCE(uwp.perm, '') AS perm
      FROM users u
      INNER JOIN users_res_permissions urp
        ON urp.user_id = u.id
       AND urp.res_id = ?
       AND urp.perm IN ('I','W','C')
      LEFT JOIN users_wp_permissions uwp
        ON uwp.user_id = u.id AND uwp.wp_id = ?
      WHERE u.user_type IN ('I','U') AND u.is_verified = 1
      ORDER BY u.last_name ASC, u.first_name ASC
    ";
    $st = $pdo->prepare($sql);
    $st->execute([$res_id, $wp_id]);
    json_ok($st->fetchAll(PDO::FETCH_ASSOC));
  }

  // ------------------------------------------------------------
  // POST
  // ------------------------------------------------------------
  if ($method === 'POST') {
    $body = read_json_body();
    $actionPost = $body['action'] ?? null;

    // SAVE RES PERMS
    if ($actionPost === 'save_res_perms') {
      $res_id = (int)($body['res_id'] ?? 0);
      $changes = $body['changes'] ?? null;
      if ($res_id <= 0) json_err(t('modal.permits.err.missing_param', ['name' => 'res_id']));
      if (!is_array($changes)) json_err(t('modal.permits.err.invalid_param', ['name' => 'changes']));
      require_res_pi($pdo, $res_id, $_permUserId, $_permIsAdmin);

      $pdo->beginTransaction();
      try {
        // upsert (MySQL): INSERT ... ON DUPLICATE KEY UPDATE perm=VALUES(perm)
        $ins = $pdo->prepare("
          INSERT INTO users_res_permissions (user_id, res_id, perm)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE perm = VALUES(perm)
        ");
        $del = $pdo->prepare("DELETE FROM users_res_permissions WHERE user_id=? AND res_id=?");
        // Tolto dalla ricerca → tolto anche da tutti i suoi WP (prima restava nei WP, invisibile
        // nella lista dei permessi del WP, che mostra solo i membri della ricerca, e non più eliminabile)
        $delWp = $pdo->prepare("
          DELETE uwp FROM users_wp_permissions uwp
          JOIN workpackages wp ON wp.wp_id = uwp.wp_id
          WHERE uwp.user_id = ? AND wp.res_id = ?
        ");
        $typ = $pdo->prepare("SELECT user_type FROM users WHERE id=? AND is_verified=1");
        $toCollab = $pdo->prepare("
          UPDATE users_wp_permissions uwp
          JOIN workpackages wp ON wp.wp_id = uwp.wp_id
          SET uwp.perm = 'C'
          WHERE uwp.user_id = ? AND wp.res_id = ? AND uwp.perm = 'I'
        ");

        foreach ($changes as $ch) {
          $user_id = (int)($ch['user_id'] ?? 0);
          $now = (string)($ch['now'] ?? '');
          if ($user_id <= 0) continue;

          if ($now === '') {
            $del->execute([$user_id, $res_id]);
            $delWp->execute([$user_id, $res_id]);
            continue;
          }
          $typ->execute([$user_id]);
          $userType = (string)$typ->fetchColumn();
          if (!in_array($userType, ['I', 'U'], true) || !valid_res_perm($now, $userType)) {
            json_err(t('modal.permits.err.invalid_res_perm.@', ['perm' => $now]));
          }
          $ins->execute([$user_id, $res_id, $now]); // 'W', 'I' o 'C'
          // Collaboratore sulla ricerca → collaboratore anche nei WP dove era I
          if ($now === 'C') $toCollab->execute([$user_id, $res_id]);
        }

        $pdo->commit();
        json_ok(['updated' => count($changes)]);
      } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        json_err(t('modal.permits.err.save_res.@', ['error' => $e->getMessage()]), 500);
      }
    }

    // SAVE WP PERMS
    if ($actionPost === 'save_wp_perms') {
      $res_id = (int)($body['res_id'] ?? 0);
      $wp_id  = (int)($body['wp_id'] ?? 0);
      $changes = $body['changes'] ?? null;
      if ($res_id <= 0 || $wp_id <= 0) json_err(t('modal.permits.err.missing_params', ['names' => 'res_id/wp_id']));
      if (!is_array($changes)) json_err(t('modal.permits.err.invalid_param', ['name' => 'changes']));
      require_wp_manage($pdo, $res_id, $_permUserId, $_permIsAdmin);

      $pdo->beginTransaction();
      try {
        $ins = $pdo->prepare("
          INSERT INTO users_wp_permissions (user_id, wp_id, perm)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE perm = VALUES(perm)
        ");
        $del = $pdo->prepare("DELETE FROM users_wp_permissions WHERE user_id=? AND wp_id=?");

        // Enforcement: l’utente deve essere eleggibile (perm ricerca I, W o C sul res_id)
        $chk = $pdo->prepare("
          SELECT perm
          FROM users_res_permissions
          WHERE user_id = ? AND res_id = ? AND perm IN ('I','W','C')
          LIMIT 1
        ");

        foreach ($changes as $ch) {
          $user_id = (int)($ch['user_id'] ?? 0);
          $now = (string)($ch['now'] ?? '');
          if ($user_id <= 0) continue;

          $chk->execute([$user_id, $res_id]);
          $resPermOf = (string)$chk->fetchColumn();
          if ($resPermOf === '') {
            // utente non abilitato dalla ricerca corrente
            continue;
          }
          if (!valid_wp_perm($now, $resPermOf)) json_err(t('modal.permits.err.invalid_wp_perm.@', ['perm' => $now]));

          if ($now === '') {
            $del->execute([$user_id, $wp_id]);
          } else {
            $ins->execute([$user_id, $wp_id, $now]); // 'I' o 'C'
          }
        }

        $pdo->commit();
        json_ok(['updated' => count($changes)]);
      } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        json_err(t('modal.permits.err.save_wp.@', ['error' => $e->getMessage()]), 500);
      }
    }

    // SEND EMAIL — riservato all'amministratore (X), anche se il resto della
    // modale (gestione ruoli) è normalmente accessibile anche a PI/WPL.
    if ($actionPost === 'send_email') {
      if (!$_permIsAdmin) json_err(t('modal.permits.err.email_admin_only.@'), 403);

      $userIds    = $body['user_ids'] ?? null;
      $subject    = trim((string)($body['subject'] ?? ''));
      $bodyPlain  = (string)($body['body'] ?? '');

      if (!is_array($userIds) || !count($userIds)) json_err(t('modal.permits.email.no_recipients'));
      if ($subject === '') json_err(t('modal.permits.email.subject_missing'));
      if (trim($bodyPlain) === '') json_err(t('modal.permits.email.body_missing'));

      $userIds = array_values(array_unique(array_map('intval', $userIds)));
      $placeholders = implode(',', array_fill(0, count($userIds), '?'));
      $st = $pdo->prepare("SELECT id, first_name, last_name, email FROM users WHERE id IN ($placeholders) AND email <> ''");
      $st->execute($userIds);
      $recipients = array_map(static fn(array $r): array => [
        'email' => $r['email'],
        'name'  => trim($r['first_name'] . ' ' . $r['last_name']),
      ], $st->fetchAll(PDO::FETCH_ASSOC));

      if (!count($recipients)) json_err(t('modal.permits.email.no_valid_recipients'));

      require_once __DIR__ . '/../api/mail_helper.php';
      $bodyHtml = nl2br(htmlspecialchars($bodyPlain, ENT_QUOTES, 'UTF-8'));
      $result = mail_send_bulk($recipients, $subject, $bodyHtml);

      json_ok($result);
    }

    json_err(t('modal.permits.err.invalid_post_action'), 400);
  }

  json_err(t('modal.permits.err.invalid_action'), 400);

} catch (Throwable $e) {
  json_err(t('modal.permits.err.server', ['error' => $e->getMessage()]), 500);
}
