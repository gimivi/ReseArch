<?php
// api/sso_identities.php — account esterni collegati al membro che ha la sessione
// (passo 3 di _doc/arch-sso-ospiti.md). Il collegamento passa da api/sso_start.php?mode=link.
//
//   POST { action: "unlink", provider }  → scollega quel fornitore
//
// Non per gli ospiti, né durante "Accedi come" (si toccherebbero gli account di un altro).
// Non si scollega l'ultimo account esterno di un utente senza password: non potrebbe più entrare.
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
session_start();

require_once __DIR__ . '/i18n.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';
require_once __DIR__ . '/sso_lib.php';

function si_out(array $a, int $code = 200): never { http_response_code($code); echo json_encode($a, JSON_UNESCAPED_UNICODE); exit; }
function si_err(string $msg, int $code = 400): never { si_out(['ok' => false, 'error' => $msg], $code); }

$u = $_SESSION['user'] ?? null;
if (!is_array($u) || empty($u['id']) || !empty($u['guest'])) si_err(t('errors.not_authenticated'), 401);
if (isset($_SESSION['impersonator'])) si_err(t('account.sso.err.impersonating'), 403);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') si_err(t('errors.method_not_allowed'), 405);

$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in) || ($in['action'] ?? '') !== 'unlink') si_err(t('errors.invalid_request'));
$provider = (string)($in['provider'] ?? '');
if (!isset(RA_SSO_PROVIDERS[$provider])) si_err(t('errors.invalid_request'));
$userId = (int)$u['id'];

try {
    // ultimo modo di entrare? (utente senza password e con un solo account esterno)
    $st = $pdo->prepare("SELECT password_hash FROM users WHERE id = ?");
    $st->execute([$userId]);
    $hasPassword = trim((string)($st->fetchColumn() ?: '')) !== '';
    $st = $pdo->prepare("SELECT COUNT(*) FROM users_identities WHERE user_id = ?");
    $st->execute([$userId]);
    if (!$hasPassword && (int)$st->fetchColumn() <= 1) si_err(t('account.sso.err.last_login'), 409);

    $st = $pdo->prepare("DELETE FROM users_identities WHERE user_id = ? AND provider = ?");
    $st->execute([$userId, $provider]);
    if ($st->rowCount() > 0) log_activity('auth:sso_unlink', 'user', $userId, '', ['provider' => $provider]);
    si_out(['ok' => true]);
} catch (Throwable $e) {
    error_log('sso_identities: ' . $e->getMessage());
    si_err(t('errors.internal'), 500);
}
