<?php
// =============================================================================
// api/password_forgot.php — richiesta del link di recupero della password (forgot_password.php)
// =============================================================================
// POST email → risposta SEMPRE uguale ("se l'indirizzo è registrato riceverai un'email"), che
// l'indirizzo esista o no: la pagina non deve rivelare quali email sono registrate.
// Se l'account esiste e ha una password (gli account senza password entrano solo con ORCID,
// Google o GitHub e sono esclusi), si crea un link valido 1 ora e si invia per email.
// Limiti: al massimo 3 link all'ora per account e 10 all'ora per indirizzo IP; oltre, la risposta
// resta la stessa ma non parte nulla.
// L'email parte DOPO aver chiuso la risposta (dove il server lo permette), così il tempo di
// risposta non cambia fra indirizzi registrati e no.
// Tabella: password_reset_tokens (sql/migration_password_reset.sql).
// =============================================================================

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/i18n.php';
require_once __DIR__ . '/mail_helper.php';
require_once __DIR__ . '/url_helper.php';

const PRT_TTL_MINUTES  = 60;
const PRT_MAX_PER_USER = 3;
const PRT_MAX_PER_IP   = 10;

function prt_json(int $status, bool $success, string $message): void {
    http_response_code($status);
    echo json_encode(['success' => $success, 'message' => $message]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    prt_json(405, false, t('errors.method_not_allowed'));
    exit;
}

$email = trim((string)($_POST['email'] ?? ''));
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    prt_json(400, false, t('validation.email_invalid'));
    exit;
}

// IP del client (stessa logica del registro attività)
$ip = '';
foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_CLIENT_IP', 'REMOTE_ADDR'] as $key) {
    if (!empty($_SERVER[$key])) {
        $cand = trim(explode(',', $_SERVER[$key])[0]);
        if (filter_var($cand, FILTER_VALIDATE_IP)) { $ip = $cand; break; }
    }
}

$sendTo = null;   // [userId, email, link] se c'è da inviare
try {
    $stmt = $pdo->prepare("SELECT id, email FROM users
                           WHERE email = :email AND password_hash IS NOT NULL AND password_hash <> ''
                           LIMIT 1");
    $stmt->execute([':email' => $email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($user) {
        $q = $pdo->prepare("SELECT
              (SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = :uid AND created_at > NOW() - INTERVAL 1 HOUR) AS per_user,
              (SELECT COUNT(*) FROM password_reset_tokens WHERE request_ip = :ip AND created_at > NOW() - INTERVAL 1 HOUR) AS per_ip");
        $q->execute([':uid' => (int)$user['id'], ':ip' => $ip]);
        $c = $q->fetch(PDO::FETCH_ASSOC);

        if ((int)$c['per_user'] < PRT_MAX_PER_USER && (int)$c['per_ip'] < PRT_MAX_PER_IP) {
            $token = bin2hex(random_bytes(32));
            $pdo->prepare("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, request_ip)
                           VALUES (:uid, :hash, NOW() + INTERVAL " . PRT_TTL_MINUTES . " MINUTE, :ip)")
                ->execute([':uid' => (int)$user['id'], ':hash' => hash('sha256', $token), ':ip' => $ip]);
            $sendTo = [(int)$user['id'], (string)$user['email'], app_base_url() . '/reset_password.php?token=' . $token];
        } else {
            error_log('password_forgot: limite di richieste raggiunto (utente ' . (int)$user['id'] . ', ip ' . $ip . ')');
        }
    }
} catch (Throwable $e) {
    error_log('password_forgot error: ' . $e->getMessage());
    prt_json(500, false, t('errors.internal'));
    exit;
}

// Risposta uguale per tutti, poi (se serve) l'invio
prt_json(200, true, t('auth.forgot.sent'));
if ($sendTo) {
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    [$uid, $to, $link] = $sendTo;
    [$subject, $html, $text] = ra_password_reset_email($link);
    if (!mail_send_one($to, $subject, $html, $text)) {
        error_log('password_forgot: email non inviata a utente ' . $uid);
    }
    require_once __DIR__ . '/log_tool.php';
    log_activity_user($uid, 'auth:password_reset_request');
}
