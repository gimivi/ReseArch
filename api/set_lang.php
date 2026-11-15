<?php
// api/set_lang.php
// Salva la lingua dell'interfaccia scelta dall'utente (_doc/arch-i18n-a11y.md §2.3).
// POST lang=<codice>. Sempre: cookie ra_lang (vale anche senza login).
// Con login: anche users.user_lang e la copia in sessione. Durante un'impersonazione
// ("Accedi come") la scelta vale solo per la sessione: il profilo dell'utente non si tocca.

session_start();
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/i18n.php';

function send_json($statusCode, $success, $message, $extra = []) {
    http_response_code($statusCode);
    echo json_encode(array_merge(['success' => $success, 'message' => $message], $extra));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_json(405, false, 'Metodo non consentito. Usa POST.');
}

$lang = isset($_POST['lang']) ? trim((string)$_POST['lang']) : '';
if (!ra_lang_valid($lang)) {
    send_json(400, false, 'Lingua non disponibile.');
}

// Cookie per un anno, sul percorso dell'applicazione (la cartella sopra api/)
$path = rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/'))), '/') . '/';
setcookie(RA_I18N_COOKIE, $lang, [
    'expires'  => time() + 365 * 24 * 3600,
    'path'     => $path,
    'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'httponly' => true,
    'samesite' => 'Lax',
]);

if (isset($_SESSION['user']) && is_array($_SESSION['user']) && !empty($_SESSION['user']['id'])) {
    $_SESSION['user']['user_lang'] = $lang;
    if (!isset($_SESSION['impersonator'])) {
        try {
            require_once __DIR__ . '/db.php';
            $st = $pdo->prepare('UPDATE users SET user_lang = :lang WHERE id = :id');
            $st->execute([':lang' => $lang, ':id' => (int)$_SESSION['user']['id']]);
        } catch (Throwable $e) {
            // Colonna non ancora creata (migrazione sql/migration_i18n_phase0.sql): resta cookie + sessione
            error_log('set_lang: ' . $e->getMessage());
        }
    }
}

send_json(200, true, 'OK', ['lang' => $lang]);
