<?php
/*
 * api/visibility.php — chi VEDE ricerche, work package, oggetti, modelli e flow.
 * Scala unica 0-5 di _doc/arch-permessi.md §11.5 (2026-10-10; 5 Ospiti dal 2026-10-11):
 *
 *   0 Autore            ricerca: P · WP: P, W del WP · oggetto/modello: P, W del WP, autori · flow: autore
 *   1 Gruppo di lavoro  ricerca: + W della ricerca · WP/oggetto/modello/flow: + membri del WP (W, I, C)
 *   2 Ricerca           + tutti i membri della ricerca (P, W, I, C)
 *   3 Divulgazione      + P e I della piattaforma
 *   4 Pubblico          tutti gli utenti con login
 *   5 Ospiti            + gli ospiti entrati con un account esterno (ORCID, Google, GitHub: tipo G,
 *                       non in users). L'ospite vede SOLO ciò che ha show 5 (_doc/arch-sso-ospiti.md)
 *
 * L'amministratore (X) vede sempre tutto. Vedere non è modificare: la scrittura resta nei *_tools.php.
 * $resPerm / $wpPerm sono i permessi dell'utente su QUELLA ricerca / QUEL WP (null se non ne ha).
 */

if (!defined('RA_RES_MEMBER_PERMS')) {
    define('RA_RES_MEMBER_PERMS', ['P', 'W', 'I', 'C']);  // membri della ricerca
    define('RA_WP_MEMBER_PERMS',  ['W', 'I', 'C']);       // membri del WP
    define('RA_PLATFORM_RESEARCHERS', ['P', 'I']);        // ricercatori della piattaforma
    define('RA_SHOW_GUESTS', 5);                          // valore di show aperto agli ospiti
}

/**
 * Utente in sessione valido per le API di LETTURA: registrato (id > 0) oppure ospite
 * (id 0, tipo G, flag guest: _doc/arch-sso-ospiti.md). Le API che scrivono escludono
 * gli ospiti a parte. Mai 401 a un ospite: il server può rispondere con la richiesta di
 * credenziali del browser (riquadro grigio), bug 2026-10-13.
 */
function ra_session_user_ok($user): bool {
    if (!is_array($user)) return false;
    if ((int)($user['id'] ?? 0) > 0) return true;
    return !empty($user['guest']) && ra_vis_user_type($user) === 'G';
}

/** Ospite (accesso con account esterno, non in users): vede solo show >= 5. */
function ra_is_guest(?array $user): bool {
    return ra_vis_user_type($user) === 'G' || !empty($user['guest']);
}

function ra_vis_user_type(?array $user): string {
    return (string)($user['user_type'] ?? '');
}

/** Ricerca: $resShow = researches.res_show. */
function ra_can_see_research(?array $user, int $resShow, ?string $resPerm): bool {
    $ut = ra_vis_user_type($user);
    if ($ut === 'X') return true;
    if ($ut === '') return false;
    if (ra_is_guest($user)) return $resShow >= RA_SHOW_GUESTS;
    switch ($resShow) {
        case 0:  return $resPerm === 'P';
        case 1:  return in_array($resPerm, ['P', 'W'], true);
        case 2:  return in_array($resPerm, RA_RES_MEMBER_PERMS, true);
        case 3:  return in_array($resPerm, RA_RES_MEMBER_PERMS, true) || in_array($ut, RA_PLATFORM_RESEARCHERS, true);
        case 4:
        case 5:  return true;
        default: return false;
    }
}

/** Work package: il P della ricerca vede sempre tutti i WP della sua ricerca. */
function ra_can_see_wp(?array $user, ?string $resPerm, int $wpShow, ?string $wpPerm): bool {
    $ut = ra_vis_user_type($user);
    if ($ut === 'X' || $resPerm === 'P') return true;
    if ($ut === '') return false;
    if (ra_is_guest($user)) return $wpShow >= RA_SHOW_GUESTS;
    switch ($wpShow) {
        case 0:  return $wpPerm === 'W';
        case 1:  return in_array($wpPerm, RA_WP_MEMBER_PERMS, true);
        case 2:  return in_array($resPerm, RA_RES_MEMBER_PERMS, true);
        case 3:  return in_array($resPerm, RA_RES_MEMBER_PERMS, true) || in_array($ut, RA_PLATFORM_RESEARCHERS, true);
        case 4:
        case 5:  return true;
        default: return false;
    }
}

/**
 * Oggetto, modello o flow ($show = obj_show / mod_show / flow_show).
 * $isAuthor: autore o collaboratore (authors_objects / authors_models), per i flow flows.author_id.
 * $isFlow: per i flow il livello 0 è solo dell'autore (niente P e W, §8ter).
 */
function ra_can_see_item(?array $user, int $show, ?string $resPerm, ?string $wpPerm, bool $isAuthor, bool $isFlow = false): bool {
    $ut = ra_vis_user_type($user);
    if ($ut === 'X') return true;
    if ($ut === '') return false;
    if (ra_is_guest($user)) return $show >= RA_SHOW_GUESTS;
    if ($isAuthor) return true;
    $manager = !$isFlow && ($resPerm === 'P' || $wpPerm === 'W');
    switch ($show) {
        case 0:  return $manager;
        case 1:  return $resPerm === 'P' || in_array($wpPerm, RA_WP_MEMBER_PERMS, true);
        case 2:  return in_array($resPerm, RA_RES_MEMBER_PERMS, true);
        case 3:  return in_array($resPerm, RA_RES_MEMBER_PERMS, true) || in_array($ut, RA_PLATFORM_RESEARCHERS, true);
        case 4:
        case 5:  return true;
        default: return false;
    }
}
