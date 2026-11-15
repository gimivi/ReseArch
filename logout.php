<?php
// logout.php
session_start();

// Log del logout e chiusura sessione attiva (prima di distruggere $_SESSION)
require_once __DIR__ . '/api/db.php';
require_once __DIR__ . '/api/log_tool.php';
require_once __DIR__ . '/api/guest_log.php';
log_activity('auth:logout');      // non registra nulla per gli ospiti…
ra_guest_log('logout');           // …che hanno il loro registro
session_close();

// svuota array sessione
$_SESSION = [];

// elimina cookie di sessione (se usato)
if (ini_get("session.use_cookies")) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000,
        $params["path"], $params["domain"],
        $params["secure"], $params["httponly"]
    );
}

session_destroy();

// evita cache pagine protette
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

header('Location: index.php');
exit;
