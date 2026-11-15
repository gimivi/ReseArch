<?php
// api/register.php

// Nessun output prima di questi header!
header('Content-Type: application/json; charset=utf-8');

// Connessione DB (usa il tuo db.php che espone $pdo)
require_once __DIR__ . '/db.php';

// Lingua della richiesta (cookie ra_lang / browser): messaggi ed email di verifica in quella lingua
require_once __DIR__ . '/i18n.php';
require_once __DIR__ . '/mail_helper.php';

// Lettura dati di configurazione SMTP
$smtp = require __DIR__ . '/../cfg/cfg_SMTP.php';


// PHPMailer (dal percorso: /phpmailer/src, relativo alla root del sito)
require_once __DIR__ . '/../phpmailer/src/PHPMailer.php';
require_once __DIR__ . '/../phpmailer/src/SMTP.php';
require_once __DIR__ . '/../phpmailer/src/Exception.php';

use PHPMailer\PHPMailer\PHPMailer;
// FIX (2026-09-16): alias — senza, "Exception" nudo nel resto del file
// intendeva PHPMailer\PHPMailer\Exception, e il catch generico più sotto
// (pensato per PDOException/errori DB, che ATTR_ERRMODE=EXCEPTION rende
// reali — vedi api/db.php) non catturava nulla che non fosse un errore di
// PHPMailer: un errore DB in quel blocco sarebbe uscito come fatal error
// invece della risposta JSON prevista. Vedi api/mail_helper.php per lo
// stesso alias applicato fin dall'inizio.
use PHPMailer\PHPMailer\Exception as PHPMailerException;

// Helper per rispondere in JSON
function send_json($success, $message, $extra = []) {
    $response = array_merge([
        'success' => $success,
        'message' => $message
    ], $extra);

    echo json_encode($response);
    exit;
}

// Permettiamo solo POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    send_json(false, t('errors.method_not_allowed'));
}

// Leggi campi dal form
$firstName       = isset($_POST['first_name']) ? trim($_POST['first_name']) : '';
$lastName        = isset($_POST['last_name']) ? trim($_POST['last_name']) : '';
$userName        = isset($_POST['user_name']) ? trim($_POST['user_name']) : '';
$email           = isset($_POST['email']) ? trim($_POST['email']) : '';
$confirmEmail    = isset($_POST['confirm_email']) ? trim($_POST['confirm_email']) : '';
$password        = isset($_POST['password']) ? $_POST['password'] : '';
$confirmPassword = isset($_POST['confirm_password']) ? $_POST['confirm_password'] : '';

// Validazioni base lato server
if ($email === '' || $confirmEmail === '' || $password === '' || $confirmPassword === '') {
    send_json(false, t('validation.fill_required'));
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    send_json(false, t('validation.email_invalid'));
}

if ($email !== $confirmEmail) {
    send_json(false, t('validation.email_mismatch'));
}

if ($password !== $confirmPassword) {
    send_json(false, t('validation.password_mismatch'));
}

if (strlen($password) < 8) {
    send_json(false, t('validation.password_short'));
}

try {
    // 1) Verifica che l'email non esista già
    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
    $stmt->execute([':email' => $email]);
    if ($stmt->fetch()) {
        send_json(false, t('auth.register.email_exists'));
    }

    // 2) Hash password
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);

    // 3) Inserisci utente non verificato
    $pdo->beginTransaction();

    $stmtInsert = $pdo->prepare('
        INSERT INTO users (first_name, last_name, user_name, email, password_hash, is_verified, created_at)
        VALUES (:first_name, :last_name, :user_name, :email, :password_hash, 0, NOW())
    ');
    $stmtInsert->execute([
        ':first_name'    => $firstName !== '' ? $firstName : null,
        ':last_name'     => $lastName !== '' ? $lastName : null,
        ':user_name'     => $userName !== '' ? $userName : null,
        ':email'         => $email,
        ':password_hash' => $passwordHash
    ]);


    $userId = (int)$pdo->lastInsertId();

    // 4) Genera token di verifica (64 caratteri hex)
    $token = bin2hex(random_bytes(32));
    $expiresAt = (new DateTime('+24 hours'))->format('Y-m-d H:i:s');

    $stmtToken = $pdo->prepare('
        INSERT INTO email_verification_tokens (user_id, token, expires_at)
        VALUES (:user_id, :token, :expires_at)
    ');
    $stmtToken->execute([
        ':user_id'    => $userId,
        ':token'      => $token,
        ':expires_at' => $expiresAt
    ]);

    $pdo->commit();

    // 5) Invio email di verifica via SMTP (PHPMailer)

    // URL base dell'installazione corrente (calcolato, non scritto nel codice)
    require_once __DIR__ . '/url_helper.php';
    $verifyLink = app_base_url() . '/verify_email.php?token=' . urlencode($token);

    // Oggetto e corpo nella lingua della richiesta (api/mail_helper.php)
    [$subject, $bodyHtml, $bodyText] = ra_verification_email($verifyLink, 'register');

    $mail = new PHPMailer(true);

try {
    $mail->SMTPDebug  = 0; // >0 per il debug; 'Debugoutput' non aveva effetto restando a 0

    // FIX (2026-09-16): $smtp era caricato (riga 11) ma mai usato — le
    // credenziali erano riscritte una seconda volta qui sotto, a mano.
    // Ora l'unica fonte è cfg/cfg_SMTP.php.
    $mail->isSMTP();
    $mail->Host       = $smtp['host'];
    $mail->SMTPAuth   = true;
    $mail->Username   = $smtp['user'];
    $mail->Password   = $smtp['pass'];
    $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
    $mail->Port       = (int)$smtp['port'];

    // IMPORTANTE:
    $mail->CharSet = 'UTF-8';
    $mail->isHTML(true);           // <- qui diciamo esplicitamente che la mail principale è HTML

    $mail->setFrom($smtp['user'], t('app.name'));
    $mail->addAddress($email);

    $mail->Subject = $subject;
    $mail->Body    = $bodyHtml;    // HTML
    $mail->AltBody = $bodyText;    // testo semplice di fallback

    $mail->send();
    send_json(true, t('auth.register.success'));


    } catch (PHPMailerException $eMail) {
        // Registrazione OK ma email non inviata
        error_log('PHPMailer error: ' . $mail->ErrorInfo);

        // A livello UX può essere utile informare comunque che deve contattare supporto
        send_json(true, t('auth.register.success_no_mail'));
    }

} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('Registration error: ' . $e->getMessage());
    send_json(false, t('errors.internal'));
}
