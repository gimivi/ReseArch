<?php
// api/a11y_feedback.php — segnalazioni sull'accessibilità (fase 7 di _doc/arch-i18n-a11y.md).
//
//   POST { name, email, page, message, website }   → salva e invia per email; anche senza login
//        "website" è un campo trappola nascosto: se è pieno la richiesta è di un programma automatico.
//   GET  ?action=list                              → ultime 200 segnalazioni (solo amministratore)
//   POST { action:"set_status", fb_id, status }    → 'new' | 'done' (solo amministratore)
//
// Limite: una segnalazione al minuto per sessione. Non si salva l'indirizzo IP.
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
if (session_status() === PHP_SESSION_NONE) session_start();

require_once __DIR__ . '/i18n.php';
require_once __DIR__ . '/db.php';

function fb_out(array $a, int $code = 200): never {
    http_response_code($code);
    echo json_encode($a, JSON_UNESCAPED_UNICODE);
    exit;
}
function fb_err(string $msg, int $code = 400): never { fb_out(['ok' => false, 'error' => $msg], $code); }

if (!isset($pdo) || !($pdo instanceof PDO)) fb_err(t('errors.internal'), 500);

$user    = is_array($_SESSION['user'] ?? null) ? $_SESSION['user'] : null;
$isAdmin = ($user['user_type'] ?? '') === 'X';
$method  = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($method === 'GET') {
        if (($_GET['action'] ?? '') !== 'list') fb_err(t('errors.invalid_request'));
        if (!$isAdmin) fb_err(t('errors.not_authorized'), 403);
        $rows = $pdo->query("SELECT fb_id, fb_created_at, fb_user_id, fb_name, fb_email, fb_page, fb_message, fb_lang, fb_status
                             FROM a11y_feedback ORDER BY fb_created_at DESC LIMIT 200")->fetchAll(PDO::FETCH_ASSOC);
        fb_out(['ok' => true, 'data' => $rows]);
    }

    if ($method !== 'POST') fb_err(t('errors.method_not_allowed'), 405);
    $in = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($in)) fb_err(t('errors.invalid_request'));

    if (($in['action'] ?? '') === 'set_status') {
        if (!$isAdmin) fb_err(t('errors.not_authorized'), 403);
        $status = ($in['status'] ?? '') === 'done' ? 'done' : 'new';
        $pdo->prepare("UPDATE a11y_feedback SET fb_status = ? WHERE fb_id = ?")->execute([$status, (int)($in['fb_id'] ?? 0)]);
        fb_out(['ok' => true]);
    }

    // ---- nuova segnalazione ----
    if (trim((string)($in['website'] ?? '')) !== '') fb_out(['ok' => true]);   // trappola: si finge l'invio

    $last = (int)($_SESSION['a11y_fb_last'] ?? 0);
    if (time() - $last < 60) fb_err(t('a11y.feedback.err.too_soon'), 429);

    $cut = fn($v, int $n) => mb_substr(trim((string)$v), 0, $n);
    $name    = $cut($in['name'] ?? '', 100);
    $email   = $cut($in['email'] ?? '', 190);
    $page    = $cut($in['page'] ?? '', 500);
    $message = $cut($in['message'] ?? '', 5000);

    $errors = [];
    if ($message === '') $errors['message'] = t('a11y.feedback.err.message_required');
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) $errors['email'] = t('a11y.feedback.err.email_invalid');
    if ($errors) fb_out(['ok' => false, 'error' => t('a11y.feedback.err.fix_fields'), 'fields' => $errors], 400);

    $pdo->prepare("INSERT INTO a11y_feedback (fb_user_id, fb_name, fb_email, fb_page, fb_message, fb_lang)
                   VALUES (?, ?, ?, ?, ?, ?)")
        ->execute([$user ? (int)$user['id'] : null, $name, $email, $page, $message, ra_lang()]);
    $id = (int)$pdo->lastInsertId();
    $_SESSION['a11y_fb_last'] = time();

    // Email: all'indirizzo configurato, altrimenti agli amministratori. Un errore di invio non
    // annulla la segnalazione, che resta nel database.
    try {
        require_once __DIR__ . '/mail_helper.php';
        $cfgFile = __DIR__ . '/../cfg/cfg_accessibility.php';
        $cfg = require (is_file($cfgFile) ? $cfgFile : __DIR__ . '/../cfg/cfg_accessibility.example.php');
        $to = [];
        if (!empty($cfg['feedback_email'])) {
            $to[] = ['email' => (string)$cfg['feedback_email']];
        } else {
            foreach ($pdo->query("SELECT email, CONCAT(first_name,' ',last_name) AS name FROM users WHERE user_type = 'X'")->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $to[] = ['email' => (string)$r['email'], 'name' => (string)$r['name']];
            }
        }
        $h = fn($v) => nl2br(htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'));
        $body = '<p><b>Segnalazione sull\'accessibilità #' . $id . '</b></p>'
              . '<p>Nome: ' . $h($name ?: '—') . '<br>Email: ' . $h($email ?: '—')
              . '<br>Pagina o funzione: ' . $h($page ?: '—')
              . '<br>Utente collegato: ' . ($user ? '#' . (int)$user['id'] : 'no') . '</p>'
              . '<p>' . $h($message) . '</p>';
        if ($to) mail_send_bulk($to, 'ReseArch — segnalazione accessibilità #' . $id, $body);
    } catch (Throwable $e) {
        error_log('a11y_feedback mail: ' . $e->getMessage());
    }

    fb_out(['ok' => true, 'data' => ['fb_id' => $id]]);
} catch (Throwable $e) {
    error_log('a11y_feedback: ' . $e->getMessage());
    fb_err(t('errors.internal'), 500);
}
