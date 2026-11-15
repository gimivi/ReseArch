<?php
// api/mail_helper.php
// Helper condiviso per l'invio di email via SMTP (PHPMailer) — usato dall'azione
// "Invia email ai selezionati" di ui/modal_permits_tools.php (Users ricerca) e
// ui/modal_platform_users_tools.php (Users piattaforma). Solo funzioni, non un
// endpoint: va incluso con require_once da chi lo usa.
//
// Configurazione SMTP letta da cfg/cfg_SMTP.php (stesso file usato — ma non
// ancora collegato — dal commento TODO in api/register.php).

declare(strict_types=1);

require_once __DIR__ . '/../phpmailer/src/Exception.php';
require_once __DIR__ . '/../phpmailer/src/PHPMailer.php';
require_once __DIR__ . '/../phpmailer/src/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as PHPMailerException;

/**
 * Invia la stessa email (oggetto + corpo HTML) a più destinatari, uno per
 * volta (nessun destinatario vede gli altri in To/Cc), riusando la stessa
 * connessione SMTP per tutta la serie di invii.
 *
 * @param array<array{email:string,name?:string}> $recipients
 * @param string $subject
 * @param string $bodyHtml  Corpo in HTML — l'AltBody testuale è derivato automaticamente
 * @return array{sent:int, failed:array<array{email:string,error:string}>}
 */
function mail_send_bulk(array $recipients, string $subject, string $bodyHtml): array {
    $cfg = require __DIR__ . '/../cfg/cfg_SMTP.php';

    $sent = 0;
    $failed = [];
    $mail = new PHPMailer(true);

    try {
        $mail->isSMTP();
        $mail->Host          = $cfg['host'];
        $mail->SMTPAuth      = true;
        $mail->Username      = $cfg['user'];
        $mail->Password      = $cfg['pass'];
        $mail->SMTPSecure    = PHPMailer::ENCRYPTION_SMTPS;
        $mail->Port          = (int)$cfg['port'];
        $mail->CharSet       = 'UTF-8';
        $mail->isHTML(true);
        $mail->setFrom($cfg['user'], 'ReseArch');
        $mail->Subject       = $subject;
        $mail->Body          = $bodyHtml;
        $mail->AltBody       = trim(strip_tags(preg_replace('/<br\s*\/?>|<\/p>/i', "\n", $bodyHtml)));
        $mail->SMTPKeepAlive = true; // una sola connessione per tutti i destinatari

        foreach ($recipients as $r) {
            $email = trim((string)($r['email'] ?? ''));
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $failed[] = ['email' => $email, 'error' => 'Indirizzo email mancante o non valido.'];
                continue;
            }
            $mail->clearAddresses();
            $mail->addAddress($email, (string)($r['name'] ?? ''));
            try {
                $mail->send();
                $sent++;
            } catch (PHPMailerException $e) {
                $failed[] = ['email' => $email, 'error' => $mail->ErrorInfo];
            }
        }

        $mail->smtpClose();
    } catch (PHPMailerException $e) {
        // Errore di configurazione/connessione: nessun invio è potuto partire.
        error_log('mail_send_bulk SMTP error: ' . $e->getMessage());
        foreach ($recipients as $r) {
            $failed[] = ['email' => (string)($r['email'] ?? ''), 'error' => 'Errore di connessione SMTP.'];
        }
    }

    return ['sent' => $sent, 'failed' => $failed];
}

/**
 * Testi dell'email di verifica dell'indirizzo, nella lingua dell'interfaccia corrente
 * (_doc/arch-i18n-a11y.md §2.3). $kind: 'register' (nuovo account) | 'change' (cambio email).
 *
 * @return array{0:string,1:string,2:string} [oggetto, corpo HTML, corpo testo]
 */
function ra_verification_email(string $link, string $kind = 'register'): array {
    require_once __DIR__ . '/i18n.php';
    $app    = t('app.name');
    $greet  = t('email.greeting');
    $intro  = t($kind === 'change' ? 'email.verify.change_intro' : 'email.verify.register_intro', ['app' => $app]);
    $click  = t('email.verify.click');
    $ignore = t($kind === 'change' ? 'email.verify.ignore_change' : 'email.verify.ignore_register');
    $sign   = t('email.signature', ['app' => $app]);

    $subject = t('email.verify.subject', ['app' => $app]);
    $text    = "$greet\n$intro\n\n$click\n\n$link\n\n$ignore\n\n$sign";

    $e = static fn(string $s): string => nl2br(htmlspecialchars($s, ENT_QUOTES, 'UTF-8'));
    $l = htmlspecialchars($link, ENT_QUOTES, 'UTF-8');
    $html = '<p>' . $e($greet) . '<br>' . $e($intro) . '</p>'
          . '<p>' . $e($click) . '</p>'
          . '<p><a href="' . $l . '" target="_blank">' . $l . '</a></p>'
          . '<p>' . $e($ignore) . '</p>'
          . '<p>' . $e($sign) . '</p>';

    return [$subject, $html, $text];
}

/**
 * Testi dell'email di recupero della password (api/password_forgot.php), nella lingua
 * dell'interfaccia corrente. Il link vale 1 ora e si usa una sola volta.
 *
 * @return array{0:string,1:string,2:string} [oggetto, corpo HTML, corpo testo]
 */
function ra_password_reset_email(string $link): array {
    require_once __DIR__ . '/i18n.php';
    $app    = t('app.name');
    $greet  = t('email.greeting');
    $intro  = t('email.reset.intro', ['app' => $app]);
    $click  = t('email.reset.click');
    $ignore = t('email.reset.ignore');
    $sign   = t('email.signature', ['app' => $app]);

    $subject = t('email.reset.subject', ['app' => $app]);
    $text    = "$greet\n$intro\n\n$click\n\n$link\n\n$ignore\n\n$sign";

    $e = static fn(string $s): string => nl2br(htmlspecialchars($s, ENT_QUOTES, 'UTF-8'));
    $l = htmlspecialchars($link, ENT_QUOTES, 'UTF-8');
    $html = '<p>' . $e($greet) . '<br>' . $e($intro) . '</p>'
          . '<p>' . $e($click) . '</p>'
          . '<p><a href="' . $l . '" target="_blank">' . $l . '</a></p>'
          . '<p>' . $e($ignore) . '</p>'
          . '<p>' . $e($sign) . '</p>';

    return [$subject, $html, $text];
}

/**
 * Invia una singola email (HTML + testo) con la configurazione SMTP di cfg/cfg_SMTP.php.
 * Restituisce true se l'invio è riuscito; gli errori vanno nel log del server.
 */
function mail_send_one(string $to, string $subject, string $bodyHtml, string $bodyText): bool {
    require_once __DIR__ . '/i18n.php';
    $cfg  = require __DIR__ . '/../cfg/cfg_SMTP.php';
    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host       = $cfg['host'];
        $mail->SMTPAuth   = true;
        $mail->Username   = $cfg['user'];
        $mail->Password   = $cfg['pass'];
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
        $mail->Port       = (int)$cfg['port'];
        $mail->CharSet    = 'UTF-8';
        $mail->isHTML(true);
        $mail->setFrom($cfg['user'], t('app.name'));
        $mail->addAddress($to);
        $mail->Subject = $subject;
        $mail->Body    = $bodyHtml;
        $mail->AltBody = $bodyText;
        $mail->send();
        return true;
    } catch (PHPMailerException $e) {
        error_log('mail_send_one error: ' . $mail->ErrorInfo);
        return false;
    }
}
