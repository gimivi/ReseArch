<?php
// =============================================================================
// api/password_reset.php — nuova password da un link di recupero (reset_password.php)
// =============================================================================
// POST token, password, confirm_password. Il link deve esistere (si cerca per impronta SHA-256),
// non essere scaduto né già usato, e l'account deve avere una password (gli account senza password
// entrano solo con ORCID, Google o GitHub e sono esclusi).
// Dopo il cambio: il link e tutti gli altri link aperti dello stesso utente non valgono più;
// l'account risulta verificato (aprire il link dimostra che l'email è sua).
// Tabella: password_reset_tokens (sql/migration_password_reset.sql).
// =============================================================================

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/i18n.php';

function prr_json(int $status, bool $success, string $message): void {
    http_response_code($status);
    echo json_encode(['success' => $success, 'message' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') prr_json(405, false, t('errors.method_not_allowed'));

$token    = (string)($_POST['token'] ?? '');
$password = (string)($_POST['password'] ?? '');
$confirm  = (string)($_POST['confirm_password'] ?? '');

if (!preg_match('/^[0-9a-f]{64}$/', $token)) prr_json(400, false, t('auth.reset.invalid'));
if ($password === '' || $confirm === '')     prr_json(400, false, t('validation.fill_required'));
if (strlen($password) < 8)                   prr_json(400, false, t('validation.password_short'));
if ($password !== $confirm)                  prr_json(400, false, t('validation.password_mismatch'));

try {
    $pdo->beginTransaction();
    $stmt = $pdo->prepare("SELECT t.prt_id, t.user_id, t.used_at, (t.expires_at <= NOW()) AS expired, u.password_hash
                           FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
                           WHERE t.token_hash = :hash LIMIT 1 FOR UPDATE");
    $stmt->execute([':hash' => hash('sha256', $token)]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row || $row['used_at'] !== null || empty($row['password_hash'])) {
        $pdo->rollBack();
        prr_json(400, false, t('auth.reset.invalid'));
    }
    if ((int)$row['expired'] === 1) {
        $pdo->rollBack();
        prr_json(400, false, t('auth.reset.expired'));
    }

    $uid = (int)$row['user_id'];
    $pdo->prepare("UPDATE users SET password_hash = :ph, is_verified = 1 WHERE id = :uid")
        ->execute([':ph' => password_hash($password, PASSWORD_DEFAULT), ':uid' => $uid]);
    // questo link e gli altri ancora aperti dello stesso utente non valgono più
    $pdo->prepare("UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = :uid AND used_at IS NULL")
        ->execute([':uid' => $uid]);
    $pdo->commit();

    require_once __DIR__ . '/log_tool.php';
    log_activity_user($uid, 'auth:password_reset');
    prr_json(200, true, t('auth.reset.success'));
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('password_reset error: ' . $e->getMessage());
    prr_json(500, false, t('errors.internal'));
}
