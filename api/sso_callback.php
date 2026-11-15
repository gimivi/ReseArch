<?php
// api/sso_callback.php — ritorno dal fornitore dopo l'accesso con un account esterno
// (_doc/arch-sso-ospiti.md §3). Indirizzo da registrare presso ogni fornitore.
//
//   mode=link  → collega l'identità al membro già entrato        → account.php?sso=linked
//   identità collegata a un membro → entra come quel membro       → researches.php
//   altrimenti                     → entra come OSPITE (non in users, riga in guest_access_log)
// Errori → index.php?sso_error=<codice> (messaggio dal catalogo auth.sso.err.<codice>).
declare(strict_types=1);
session_start();

require_once __DIR__ . '/sso_lib.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/session_user.php';
require_once __DIR__ . '/log_tool.php';
require_once __DIR__ . '/guest_log.php';

function sso_go(string $to): never {
    header('Cache-Control: no-store');
    header('Location: ' . $to);
    exit;
}
function sso_fail(string $code, string $back = '../index.php'): never {
    sso_go($back . (str_contains($back, '?') ? '&' : '?') . 'sso_error=' . rawurlencode($code));
}

$modeBefore = $_SESSION['sso']['mode'] ?? 'login';
try {
    $id = ra_sso_finish($_GET);
} catch (Throwable $e) {
    $code = in_array($e->getMessage(), ['state', 'denied', 'token'], true) ? $e->getMessage() : 'provider_error';
    if ($code === 'provider_error') error_log('sso_callback: ' . $e->getMessage());
    sso_fail($code, $modeBefore === 'link' ? '../account.php' : '../index.php');
}

try {
    // ── collegamento a un membro già entrato ──────────────────────────────────
    if ($id['mode'] === 'link') {
        $u = $_SESSION['user'] ?? null;
        if (!is_array($u) || empty($u['id']) || !empty($u['guest'])) sso_fail('state');
        if (isset($_SESSION['impersonator'])) sso_fail('impersonating', '../account.php');
        $st = $pdo->prepare("SELECT user_id FROM users_identities WHERE provider = ? AND subject = ?");
        $st->execute([$id['provider'], $id['subject']]);
        $owner = $st->fetchColumn();
        if ($owner !== false && (int)$owner !== (int)$u['id']) sso_fail('taken', '../account.php');
        $pdo->prepare("INSERT INTO users_identities (provider, subject, user_id, email, display_name)
                       VALUES (?, ?, ?, ?, ?)
                       ON DUPLICATE KEY UPDATE email = VALUES(email), display_name = VALUES(display_name)")
            ->execute([$id['provider'], $id['subject'], (int)$u['id'], $id['email'], mb_substr($id['name'], 0, 190)]);
        log_activity('auth:sso_link', 'user', (int)$u['id'], '', ['provider' => $id['provider']]);
        sso_go('../account.php?sso=linked');
    }

    // ── membro con l'account collegato ────────────────────────────────────────
    $st = $pdo->prepare("SELECT u.* FROM users_identities i JOIN users u ON u.id = i.user_id
                         WHERE i.provider = ? AND i.subject = ? LIMIT 1");
    $st->execute([$id['provider'], $id['subject']]);
    $user = $st->fetch(PDO::FETCH_ASSOC);
    if ($user) {
        if ((int)$user['is_verified'] !== 1) sso_fail('not_verified');
        ra_session_set_user($user, true);
        $pdo->prepare("UPDATE users_identities SET last_login_at = NOW() WHERE provider = ? AND subject = ?")
            ->execute([$id['provider'], $id['subject']]);
        session_heartbeat('login');
        log_activity('auth:login', 'user', (int)$user['id'], '', ['provider' => $id['provider']]);
        sso_go('../researches.php');
    }

    // ── ospite ───────────────────────────────────────────────────────────────
    if (!ra_sso_guests_enabled()) sso_fail('no_account');
    ra_session_set_user([
        'id'          => 0,
        'user_type'   => 'G',
        'guest'       => true,
        'first_name'  => $id['name'] !== '' ? $id['name'] : $id['subject'],
        'last_name'   => '',
        'user_name'   => '',
        'email'       => $id['email'],
        'is_verified' => 1,
        'provider'    => $id['provider'],
        'subject'     => $id['subject'],
    ], true);
    ra_guest_log('login');
    session_heartbeat('login');
    sso_go('../researches.php');
} catch (Throwable $e) {
    error_log('sso_callback: ' . $e->getMessage());
    sso_fail('provider_error');
}
