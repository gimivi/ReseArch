<?php
// api/update_profile.php

session_start();
ob_start();
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/i18n.php';          // messaggi ed email nella lingua dell'utente
require_once __DIR__ . '/mail_helper.php';   // ra_verification_email()

// SMTP config
$smtp = require __DIR__ . '/../cfg/cfg_SMTP.php';

// PHPMailer
require_once __DIR__ . '/../phpmailer/src/PHPMailer.php';
require_once __DIR__ . '/../phpmailer/src/SMTP.php';
require_once __DIR__ . '/../phpmailer/src/Exception.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

function send_json($statusCode, $success, $message, $extra = []) {
    http_response_code($statusCode);
    if (ob_get_length()) ob_clean();
    echo json_encode(array_merge([
        'success' => $success,
        'message' => $message
    ], $extra));
    exit;
}

function require_login() {
    if (!isset($_SESSION['user']) || !is_array($_SESSION['user']) || empty($_SESSION['user']['id'])) {
        send_json(401, false, t('errors.not_authenticated'));
    }
}

function send_verification_email($toEmail, $token, $smtp) {
    // URL base dell'installazione corrente (calcolato, non scritto nel codice)
    require_once __DIR__ . '/url_helper.php';
    $verifyLink = app_base_url() . '/verify_email.php?token=' . urlencode($token);

    // Oggetto e corpo nella lingua dell'utente (api/mail_helper.php)
    [$subject, $bodyHtml, $bodyText] = ra_verification_email($verifyLink, 'change');

    $mail = new PHPMailer(true);
    $mail->SMTPDebug  = 0;
    $mail->Debugoutput = 'error_log';

    $mail->isSMTP();
    $mail->Host       = $smtp['host'];
    $mail->SMTPAuth   = true;
    $mail->Username   = $smtp['user'];
    $mail->Password   = $smtp['pass'];
    $mail->SMTPSecure = $smtp['secure'] ?? PHPMailer::ENCRYPTION_SMTPS;
    $mail->Port       = (int)$smtp['port'];

    $mail->CharSet = 'UTF-8';
    $mail->isHTML(true);

    $mail->setFrom($smtp['from_email'] ?? $smtp['user'], $smtp['from_name'] ?? t('app.name'));
    $mail->addAddress($toEmail);

    $mail->Subject = $subject;
    $mail->Body    = $bodyHtml;
    $mail->AltBody = $bodyText;

    $mail->send();
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_json(405, false, t('errors.method_not_allowed'));
}

require_login();

$userId = (int)$_SESSION['user']['id'];

// Input (tutti opzionali)
$firstName = isset($_POST['first_name']) ? trim($_POST['first_name']) : null;
$lastName  = isset($_POST['last_name']) ? trim($_POST['last_name']) : null;
$userName  = isset($_POST['user_name']) ? trim($_POST['user_name']) : null;

$newEmail        = isset($_POST['new_email']) ? trim($_POST['new_email']) : '';
$confirmNewEmail = isset($_POST['confirm_new_email']) ? trim($_POST['confirm_new_email']) : '';

$currentPassword = isset($_POST['current_password']) ? $_POST['current_password'] : '';

$newPassword        = isset($_POST['new_password']) ? $_POST['new_password'] : '';
$confirmNewPassword = isset($_POST['confirm_new_password']) ? $_POST['confirm_new_password'] : '';

try {
    // 1) Ricarica utente dal DB (per avere password_hash aggiornata)
    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    $dbUser = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$dbUser) {
        send_json(404, false, t('account.user_not_found'));
    }

    // 2) Costruisci aggiornamento “profilo base”
    $fields = [];
    $params = [':id' => $userId];

    if ($firstName !== null) { $fields[] = 'first_name = :first_name'; $params[':first_name'] = ($firstName === '' ? null : $firstName); }
    if ($lastName  !== null) { $fields[] = 'last_name  = :last_name';  $params[':last_name']  = ($lastName === '' ? null : $lastName); }
    if ($userName  !== null) { $fields[] = 'user_name  = :user_name';  $params[':user_name']  = ($userName === '' ? null : $userName); }

    // Flags: cosa stiamo cambiando?
    $wantsEmailChange = ($newEmail !== '' || $confirmNewEmail !== '');
    $wantsPassChange  = ($newPassword !== '' || $confirmNewPassword !== '');

    // Se cambia email o password => serve current_password
    if (($wantsEmailChange || $wantsPassChange) && $currentPassword === '') {
        send_json(400, false, t('account.need_current_password'));
    }

    if (($wantsEmailChange || $wantsPassChange) && !password_verify($currentPassword, $dbUser['password_hash'])) {
        send_json(401, false, t('account.wrong_current_password'));
    }

    $pdo->beginTransaction();

    // 3) Cambio password
    if ($wantsPassChange) {
        if ($newPassword === '' || $confirmNewPassword === '') {
            throw new Exception(t('account.fill_both_passwords'));
        }
        if ($newPassword !== $confirmNewPassword) {
            throw new Exception(t('validation.password_mismatch'));
        }
        if (strlen($newPassword) < 8) {
            throw new Exception(t('validation.password_short'));
        }

        // Evita riuso stessa password
        if (password_verify($newPassword, $dbUser['password_hash'])) {
            throw new Exception(t('account.password_same'));
        }

        $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
        $fields[] = 'password_hash = :password_hash';
        $params[':password_hash'] = $newHash;
    }

    // 4) Cambio email (con nuova verifica)
    $didEmailChange = false;
    $emailToken = null;

    if ($wantsEmailChange) {
        if ($newEmail === '' || $confirmNewEmail === '') {
            throw new Exception(t('account.fill_both_emails'));
        }
        if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
            throw new Exception(t('validation.email_invalid'));
        }
        if ($newEmail !== $confirmNewEmail) {
            throw new Exception(t('validation.email_mismatch'));
        }

        // Se è uguale a quella attuale, non fare nulla
        if (strcasecmp($newEmail, $dbUser['email']) !== 0) {
            // Verifica che non sia già usata da un altro account
            $stmtChk = $pdo->prepare('SELECT id FROM users WHERE email = :email AND id <> :id LIMIT 1');
            $stmtChk->execute([':email' => $newEmail, ':id' => $userId]);
            if ($stmtChk->fetch()) {
                throw new Exception(t('account.email_in_use'));
            }

            $fields[] = 'email = :email';
            $params[':email'] = $newEmail;

            // Forza nuova verifica
            $fields[] = 'is_verified = 0';

            // Nuovo token
            $emailToken = bin2hex(random_bytes(32));
            $expiresAt = (new DateTime('+24 hours'))->format('Y-m-d H:i:s');

            $stmtToken = $pdo->prepare('
                INSERT INTO email_verification_tokens (user_id, token, expires_at)
                VALUES (:user_id, :token, :expires_at)
            ');
            $stmtToken->execute([
                ':user_id'    => $userId,
                ':token'      => $emailToken,
                ':expires_at' => $expiresAt
            ]);

            $didEmailChange = true;
        }
    }

    // 5) Applica update (se ci sono campi)
    if (!empty($fields)) {
        $sql = 'UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = :id';
        $stmtUp = $pdo->prepare($sql);
        $stmtUp->execute($params);
    }

    $pdo->commit();

    // 6) Se email cambiata: invia mail di verifica e forza logout
    if ($didEmailChange && $emailToken) {
        try {
            send_verification_email($newEmail, $emailToken, $smtp);
        } catch (Exception $mailEx) {
            // L’update è già commit: informiamo ma non rollback
            error_log('Email change verification mail error: ' . $mailEx->getMessage());
            // (continuiamo)
        }

        // Logout: sessione non più valida finché non verifica e rifà login
        $_SESSION = [];
        if (ini_get("session.use_cookies")) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $params["path"], $params["domain"],
                $params["secure"], $params["httponly"]
            );
        }
        session_destroy();

        send_json(200, true, t('account.email_changed'), [
            'email_changed' => true
        ]);
    }

    // 7) Aggiorna anche la sessione (se restiamo loggati)
    $stmt2 = $pdo->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
    $stmt2->execute([':id' => $userId]);
    $fresh = $stmt2->fetch(PDO::FETCH_ASSOC);
    if ($fresh) {
        require_once __DIR__ . '/session_user.php';
        ra_session_set_user($fresh, false);   // senza password_hash
    }

    send_json(200, true, t('account.saved'));

} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('Update profile DB error: ' . $e->getMessage());
    send_json(500, false, t('errors.internal'));
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('Update profile error: ' . $e->getMessage());
    send_json(400, false, $e->getMessage());
}
