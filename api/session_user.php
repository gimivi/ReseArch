<?php
// api/session_user.php — come si mette un utente nella sessione (un punto solo).
//
//   ra_session_set_user($row, $newLogin)
//     - toglie password_hash dalla riga: in sessione non serve e non deve stare;
//     - con $newLogin = true rigenera l'identificativo di sessione (session_regenerate_id): dopo un
//       accesso o un cambio d'identità il vecchio identificativo, se qualcuno lo conosceva o l'aveva
//       fissato prima dell'accesso (session fixation), non vale più.
// Usato da api/login.php, api/update_profile.php, api/impersonate_tool.php e dall'accesso con
// account esterni (_doc/arch-sso-ospiti.md).
declare(strict_types=1);

if (!function_exists('ra_session_set_user')) {
    function ra_session_set_user(array $user, bool $newLogin): void {
        unset($user['password_hash']);
        if ($newLogin && session_status() === PHP_SESSION_ACTIVE) session_regenerate_id(true);
        $_SESSION['user'] = $user;
    }
}
