<?php
// =============================================================================
// api/url_helper.php
// URL base dell'applicazione, per i link assoluti inviati via email
// (verifica email in register.php e update_profile.php).
//
// Priorità:
//   1) 'base_url' in cfg/cfg_ini.php, se valorizzato (es. server dietro proxy
//      o raggiunto con un indirizzo diverso da quello pubblico)
//   2) ricavato dalla richiesta corrente: schema + host + cartella dell'app
//      (così ogni installazione manda link a se stessa)
// =============================================================================

function app_base_url(): string {
    $cfg = require __DIR__ . '/../cfg/cfg_ini.php';
    if (!empty($cfg['base_url'])) {
        return rtrim($cfg['base_url'], '/');
    }

    // Schema (anche dietro reverse proxy / terminazione SSL)
    $https = (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off')
          || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
          || (($_SERVER['SERVER_PORT'] ?? '') === '443');
    $scheme = $https ? 'https' : 'http';

    // Host (con eventuale porta). L'header Host arriva dal client: si accetta
    // solo se ha la forma di un nome host, altrimenti si usa SERVER_NAME.
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if (!preg_match('/^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/', $host)) {
        $host = $_SERVER['SERVER_NAME'] ?? 'localhost';
    }

    // Cartella dell'app: gli script che chiamano questa funzione stanno in api/,
    // quindi la radice dell'app è due livelli sopra lo script
    // (/GitHub/api/register.php → /GitHub ; /api/register.php → "")
    $path = str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/')));
    $path = rtrim($path, '/');

    return $scheme . '://' . $host . $path;
}
