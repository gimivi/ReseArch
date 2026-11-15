<?php
// api/app_catalog.php
// Abilitazioni dell'utente (profili, step 2) + catalogo APP dalla tabella `app`
// con la regola "l'utente può creare oggetti di questa APP?". Un solo punto
// di verità, usato da ui/modal_objects_tools.php (whitelist obj_app),
// api/cfg_mod_spec.php (filtro template), dashboard.php (globale userCaps) e
// dalle modali admin. Vedi _doc/arch-abilitazioni.md §3-§4.
//
// Solo funzioni: nessun output, nessun controllo di sessione (li fa chi include).
//
// Le abilitazioni si ricalcolano ad ogni richiesta (una query su indice):
// una modifica dei profili fatta dall'admin vale subito, senza dover
// rifare il login — scelta rispetto alla "cache in sessione" ipotizzata
// nella specifica, che non si sarebbe aggiornata per gli utenti già collegati.

declare(strict_types=1);

/** Codice APP normalizzato: maiuscolo, 3 caratteri. */
function app_norm_cod($v): string {
  return substr(strtoupper(trim((string)($v ?? ''))), 0, 3);
}

/** Permessi funzionali assegnabili con kind='perm' (ref => etichetta). */
function cap_perm_labels(): array {
  return [
    'validate_flows' => 'Può validare i flow con nodi critici (nelle ricerche in cui ha un ruolo)',
  ];
}

/**
 * Abilitazioni dell'utente = unione dei suoi profili + dei profili is_default.
 * Ritorna ['is_admin' => bool, 'apps' => [cod => true],
 *          'template_levels' => [level => true], 'perms' => [ref => true]].
 * L'amministratore (X) ha tutto: i set restano vuoti, conta 'is_admin'.
 */
function user_caps(PDO $pdo, ?array $user): array {
  $caps = ['is_admin' => false, 'apps' => [], 'template_levels' => [], 'perms' => []];
  if (!$user) return $caps;
  $caps['is_admin'] = ($user['user_type'] ?? '') === 'X';
  if ($caps['is_admin']) return $caps;

  $uid = (int)($user['id'] ?? $user['user_id'] ?? 0);
  $st = $pdo->prepare("SELECT DISTINCT g.kind, g.ref
                       FROM cap_grants g
                       JOIN cap_profiles p ON p.profile_id = g.profile_id
                       LEFT JOIN users_cap_profiles u
                              ON u.profile_id = p.profile_id AND u.user_id = :uid
                       WHERE p.is_default = 1 OR u.user_id IS NOT NULL");
  $st->execute([':uid' => $uid]);
  foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $g) {
    $ref = (string)$g['ref'];
    switch ($g['kind']) {
      case 'app':            $caps['apps'][app_norm_cod($ref)] = true; break;
      case 'template_level': $caps['template_levels'][$ref] = true; break;
      case 'perm':           $caps['perms'][$ref] = true; break;
    }
  }
  return $caps;
}

/** L'utente ha il permesso funzionale $ref? (admin: sempre) */
function user_has_perm(array $caps, string $ref): bool {
  return $caps['is_admin'] || !empty($caps['perms'][$ref]);
}

/** L'utente vede i template di livello $level? ('base': sempre) */
function user_sees_template_level(array $caps, string $level): bool {
  return $level === 'base' || $caps['is_admin'] || !empty($caps['template_levels'][$level]);
}

/**
 * Ritorna [app_cod => ['title', 'access', 'status', 'sort', 'creatable']],
 * ordinato per app_sort e titolo. 'creatable' = l'utente può creare oggetti:
 *   - status 'hidden' → mai (gli oggetti esistenti si aprono comunque);
 *   - access 'all'    → sì;
 *   - access 'granted'→ se l'APP è in uno dei suoi profili (o è admin);
 *   - access 'admin'  → solo user_type X.
 */
function app_catalog(PDO $pdo, array $caps): array {
  $rows = $pdo->query("SELECT app_cod, app_title, app_access, app_status, app_sort
                       FROM app
                       ORDER BY app_sort ASC, app_title ASC")->fetchAll(PDO::FETCH_ASSOC);
  $out = [];
  foreach ($rows as $a) {
    $cod = app_norm_cod($a['app_cod'] ?? '');
    if ($cod === '') continue;
    $access = (string)($a['app_access'] ?? 'all');
    $status = (string)($a['app_status'] ?? 'active');
    $allowed = $caps['is_admin']
      || $access === 'all'
      || ($access === 'granted' && !empty($caps['apps'][$cod]));
    $out[$cod] = [
      'title'     => (string)($a['app_title'] ?? $cod),
      'access'    => $access,
      'status'    => $status,
      'sort'      => (int)($a['app_sort'] ?? 0),
      'creatable' => $status !== 'hidden' && $allowed,
    ];
  }
  return $out;
}

/**
 * Forma compatta per il client (globale JS userCaps in dashboard.php).
 * Solo interfaccia: i controlli veri restano lato server.
 */
function user_caps_for_client(PDO $pdo, array $caps): array {
  $apps = [];
  foreach (app_catalog($pdo, $caps) as $cod => $a) {
    if ($a['creatable']) $apps[] = $cod;
  }
  return [
    'is_admin'        => $caps['is_admin'],
    'apps'            => $apps,
    'template_levels' => $caps['is_admin'] ? ['base', 'advanced'] : array_merge(['base'], array_keys($caps['template_levels'])),
    'perms'           => $caps['is_admin'] ? array_keys(cap_perm_labels()) : array_keys($caps['perms']),
  ];
}
