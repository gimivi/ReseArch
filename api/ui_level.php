<?php
// api/ui_level.php
// Livello di interazione con l'interfaccia (_doc/arch-i18n-a11y.md §5, _doc/arch-permessi.md §11.4).
//
// Un numero, non un sì/no, per poter aggiungere livelli intermedi senza rinumerare.
// Dove andrà salvato (es. un livello forzato per utente o per oggetto) sarà TINYINT UNSIGNED.
// Serve SOLO a decidere quali strumenti mostrare: i controlli veri restano lato server.

const RA_LEVEL_PUBLIC     = 0;    // senza login (non usato: tutte le pagine richiedono il login)
const RA_LEVEL_GUEST      = 5;    // G: ospite entrato con un account esterno, solo consultazione (_doc/arch-sso-ospiti.md)
const RA_LEVEL_VIEWER     = 10;   // V: consultazione
const RA_LEVEL_USER       = 20;   // U: consulta, usa gli strumenti che lavorano in memoria, legge i flow
const RA_LEVEL_RESEARCHER = 25;   // membri della ricerca su elementi non propri; P e I di altre ricerche
const RA_LEVEL_AUTHOR     = 30;   // modifica quell'elemento: W del WP, autore o collaboratore
const RA_LEVEL_MANAGER    = 40;   // P della ricerca
const RA_LEVEL_ADMIN      = 50;   // X

/**
 * Livello di BASE per utente, ricerca e work package correnti: vale per la pagina e per tutto
 * ciò che non è un singolo oggetto (window.RA_CTX.level). Il livello di un pannello parte da qui
 * e sale a 30 se l'utente può modificare l'oggetto aperto (ra_ui_level_item).
 *
 * @param array|null $user        riga users (sessione)
 * @param array|null $research    ricerca con 'res_perm'
 * @param array|null $workpackage WP con 'wp_perm'
 */
function ra_ui_level(?array $user, ?array $research = null, ?array $workpackage = null): int {
    if (empty($user)) return RA_LEVEL_PUBLIC;
    $userType = (string)($user['user_type'] ?? '');
    if ($userType === 'X') return RA_LEVEL_ADMIN;
    if ($userType === 'G' || !empty($user['guest'])) return RA_LEVEL_GUEST;   // nessun permesso su ricerche e WP

    $resPerm = $research['res_perm']   ?? null;
    $wpPerm  = $workpackage['wp_perm'] ?? null;

    if ($resPerm === 'P') return RA_LEVEL_MANAGER;
    if (!empty($workpackage) && $wpPerm === 'W') return RA_LEVEL_AUTHOR;   // W modifica tutto il WP
    if (in_array($resPerm, ['W', 'I', 'C'], true)) return RA_LEVEL_RESEARCHER;
    if (in_array($userType, ['P', 'I'], true)) return RA_LEVEL_RESEARCHER;
    if ($userType === 'U') return RA_LEVEL_USER;
    return RA_LEVEL_VIEWER;
}

/** Livello per un singolo elemento: almeno 30 se l'utente lo può modificare (api/edit_rights.php). */
function ra_ui_level_item(int $baseLevel, bool $canEdit): int {
    return $canEdit ? max($baseLevel, RA_LEVEL_AUTHOR) : $baseLevel;
}
