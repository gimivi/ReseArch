<?php
// api/sso_start.php?provider=orcid|google|github[&mode=link]
// Avvia l'accesso con un account esterno: manda il browser al fornitore (_doc/arch-sso-ospiti.md §3.1).
// mode=link: collega l'account esterno al membro già entrato con la password (da account.php).
declare(strict_types=1);
session_start();

require_once __DIR__ . '/sso_lib.php';

$provider = (string)($_GET['provider'] ?? '');
$mode     = ($_GET['mode'] ?? '') === 'link' ? 'link' : 'login';

if (!isset(ra_sso_enabled()[$provider])) {
    header('Location: ../index.php?sso_error=provider');
    exit;
}
if ($mode === 'link') {
    $u = $_SESSION['user'] ?? null;
    if (!is_array($u) || empty($u['id']) || !empty($u['guest'])) {
        header('Location: ../index.php');
        exit;
    }
    // durante "Accedi come" si collegherebbe il proprio account esterno all'utente impersonato
    if (isset($_SESSION['impersonator'])) {
        header('Location: ../account.php?sso_error=impersonating');
        exit;
    }
}

header('Cache-Control: no-store');
header('Location: ' . ra_sso_begin($provider, $mode));
exit;
