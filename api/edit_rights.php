<?php
// api/edit_rights.php
// Diritti di modifica e di collegamento di oggetti, modelli e flow
// (passo 4 di _doc/arch-permessi.md §11.9; regole nei §11.3, §11.4 e §11.6).
//
// Chi modifica un oggetto o un modello:
//   - X;
//   - P della ricerca che lo contiene;
//   - W del WP che lo contiene;
//   - chi compare in authors_objects / authors_models (auth_role A autore o C collaboratore).
// Chi crea oggetti e modelli in un WP: X, P della ricerca, W e I del WP (deciso 2026-10-10).
// Chi crea ne diventa autore (ra_add_author). I flow restano di un solo proprietario
// (flows.author_id, §8ter): qui servono solo per il collegamento.
//
// I diritti si leggono dal database (ra_edit_scope), non dalla sessione: valgono anche per
// gli elementi di altri WP e altre ricerche, che compaiono negli elenchi dei collegamenti.
// Lo share (chi collega) usa invece l'appartenenza nel contesto corrente (res_perm / wp_perm).

declare(strict_types=1);

require_once __DIR__ . '/visibility.php';

const RA_AUTHOR_TABLES = [
    'object' => ['authors_objects', 'obj_id'],
    'model'  => ['authors_models',  'mod_id'],
];

/**
 * Tutto ciò che serve per decidere cosa l'utente modifica, letto una volta per richiesta.
 * Chiavi: x (bool), p_res / w_wp / i_wp (id => true), object / model (id => true, autore o collaboratore).
 */
function ra_edit_scope(PDO $pdo, ?array $user): array {
    static $cache = [];
    $uid = (int)($user['id'] ?? 0);
    if (isset($cache[$uid])) return $cache[$uid];

    $scope = [
        'x' => ra_vis_user_type($user) === 'X',
        'p_res' => [], 'w_wp' => [], 'i_wp' => [],
        'object' => [], 'model' => [],
    ];
    if ($uid > 0) {
        $st = $pdo->prepare("SELECT res_id FROM users_res_permissions WHERE user_id = ? AND perm = 'P'");
        $st->execute([$uid]);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $id) $scope['p_res'][(int)$id] = true;

        $st = $pdo->prepare("SELECT wp_id, perm FROM users_wp_permissions WHERE user_id = ? AND perm IN ('W','I')");
        $st->execute([$uid]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $scope[$r['perm'] === 'W' ? 'w_wp' : 'i_wp'][(int)$r['wp_id']] = true;
        }

        foreach (RA_AUTHOR_TABLES as $kind => [$table, $col]) {
            $st = $pdo->prepare("SELECT $col FROM $table WHERE auth_id = ?");
            $st->execute([$uid]);
            foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $id) $scope[$kind][(int)$id] = true;
        }
    }
    return $cache[$uid] = $scope;
}

/** X, P della ricerca o W del WP: modificano tutti gli oggetti e i modelli del WP. */
function ra_scope_is_wp_editor(array $scope, int $wpId, int $resId): bool {
    return $scope['x'] || isset($scope['p_res'][$resId]) || isset($scope['w_wp'][$wpId]);
}

/** Può creare oggetti e modelli nel WP (ne diventa autore). */
function ra_scope_can_create(array $scope, int $wpId, int $resId): bool {
    return ra_scope_is_wp_editor($scope, $wpId, $resId) || isset($scope['i_wp'][$wpId]);
}

/** Può modificare (ed eliminare) l'oggetto o il modello $id, che sta nel WP $wpId della ricerca $resId. */
function ra_scope_can_edit(array $scope, string $kind, int $id, int $wpId, int $resId): bool {
    return ra_scope_is_wp_editor($scope, $wpId, $resId) || isset($scope[$kind][$id]);
}

// ─── Configurazioni della dashboard (§11.7.1, deciso 2026-10-13) ─────────────
// Vedere e caricare: dshp_show (api/visibility.php). Creare: come gli oggetti.
// Modificare: X, P, W e l'autore (dshp_usr), senza tabella di autori: uno solo.
// Predefinita del WP: solo X, P, W (ra_scope_is_wp_editor).

/** Modifica, elimina, collega flow alla configurazione dell'autore $dshpUsr nel WP $wpId. */
function ra_dshp_can_edit(array $scope, int $dshpUsr, int $userId, int $wpId, int $resId): bool {
    return ra_scope_is_wp_editor($scope, $wpId, $resId) || ($userId > 0 && $dshpUsr === $userId);
}

/**
 * Scrive l'autore (o il collaboratore) di un oggetto o modello. Non fa nulla se c'è già.
 * $ord = posizione nell'elenco (auth_ord, 1 = primo); null = in coda (alla creazione: 1).
 */
function ra_add_author(PDO $pdo, string $kind, int $id, int $userId, string $role = 'A', ?int $ord = null): void {
    if ($id <= 0 || $userId <= 0) return;
    [$table, $col] = RA_AUTHOR_TABLES[$kind];
    if ($ord === null) {
        $st = $pdo->prepare("SELECT COALESCE(MAX(auth_ord), 0) + 1 FROM $table WHERE $col = ?");
        $st->execute([$id]);
        $ord = (int)$st->fetchColumn();
    }
    $pdo->prepare("INSERT IGNORE INTO $table ($col, auth_id, auth_role, auth_ord) VALUES (?, ?, ?, ?)")
        ->execute([$id, $userId, $role === 'C' ? 'C' : 'A', max(1, $ord)]);
}

/** Toglie autori e collaboratori di un elemento eliminato (tabelle senza chiavi esterne). */
function ra_remove_authors(PDO $pdo, string $kind, int $id): void {
    [$table, $col] = RA_AUTHOR_TABLES[$kind];
    $pdo->prepare("DELETE FROM $table WHERE $col = ?")->execute([$id]);
}

// ─── Share: collegamenti (§11.6) ─────────────────────────────────────────────
// Un collegamento si crea o si toglie solo se lo consentono sia l'oggetto (o la
// configurazione della dashboard) che lo riceve, sia il modello o flow collegato.

/**
 * L'oggetto accetta collegamenti dall'utente?
 *   chi lo modifica sempre; obj_share 1: anche i membri del WP; 2: anche i membri della ricerca.
 */
function ra_obj_accepts_link(bool $canEditObj, int $objShare, ?string $resPerm, ?string $wpPerm): bool {
    if ($canEditObj) return true;
    if ($objShare >= 1 && ($resPerm === 'P' || in_array($wpPerm, RA_WP_MEMBER_PERMS, true))) return true;
    if ($objShare >= 2 && in_array($resPerm, RA_RES_MEMBER_PERMS, true)) return true;
    return false;
}

/**
 * Il modello o flow si collega, da parte dell'utente, a un oggetto del WP corrente?
 *   $owner: l'utente lo modifica (modello) o ne è l'autore (flow), o è X: qualunque share;
 *   share 1: stesso WP, membri del WP; 2: stessa ricerca, membri della ricerca;
 *   3: qualunque ricerca, P e I della piattaforma.
 */
function ra_item_linkable(bool $owner, int $share, bool $sameWp, bool $sameRes,
                          ?array $user, ?string $resPerm, ?string $wpPerm): bool {
    if ($owner) return true;
    if ($sameWp && $share >= 1 && ($resPerm === 'P' || in_array($wpPerm, RA_WP_MEMBER_PERMS, true))) return true;
    if ($sameRes && $share >= 2 && in_array($resPerm, RA_RES_MEMBER_PERMS, true)) return true;
    if ($share >= 3 && in_array(ra_vis_user_type($user), RA_PLATFORM_RESEARCHERS, true)) return true;
    return false;
}

// ─── Autori e collaboratori: elenco e candidati (passo 7, §11.3) ─────────────

/**
 * Autori e collaboratori degli elementi di un WP, per gli elenchi delle modali.
 * @return array<int, array<int, array{user_id:int, name:string, role:string}>>  id elemento => righe
 */
function ra_authors_by_item(PDO $pdo, string $kind, int $wpId): array {
    [$table, $col] = RA_AUTHOR_TABLES[$kind];
    $itemTable = $kind === 'object' ? 'objects' : 'models';
    $st = $pdo->prepare("
        SELECT a.$col AS item_id, a.auth_id, a.auth_role,
               TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS name
        FROM   $table a
        JOIN   $itemTable i ON i.$col = a.$col
        LEFT JOIN users u   ON u.id = a.auth_id
        WHERE  i.wp_id = ?
        ORDER  BY a.auth_ord, a.auth_role, u.last_name, u.first_name");   // auth_ord: ordine scelto (1 = primo)
    $st->execute([$wpId]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[(int)$r['item_id']][] = [
            'user_id' => (int)$r['auth_id'],
            'name'    => $r['name'] !== '' ? $r['name'] : ('#' . $r['auth_id']),
            'role'    => $r['auth_role'] === 'C' ? 'C' : 'A',
        ];
    }
    return $out;
}

/**
 * Chi si può indicare come autore (A) o collaboratore (C) di un elemento del WP:
 * autori = P della ricerca, W e I del WP; collaboratori = C del WP.
 * @return array<int, array{user_id:int, name:string, role:string}>  user_id => candidato
 */
function ra_author_candidates(PDO $pdo, int $wpId, int $resId): array {
    $st = $pdo->prepare("
        SELECT u.id AS user_id, TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS name,
               CASE WHEN p.perm = 'C' THEN 'C' ELSE 'A' END AS role
        FROM   users_wp_permissions p JOIN users u ON u.id = p.user_id
        WHERE  p.wp_id = ? AND p.perm IN ('W','I','C')
        UNION
        SELECT u.id, TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))), 'A'
        FROM   users_res_permissions r JOIN users u ON u.id = r.user_id
        WHERE  r.res_id = ? AND r.perm = 'P'
        ORDER  BY name");
    $st->execute([$wpId, $resId]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $id = (int)$r['user_id'];
        // P della ricerca che è anche C nel WP: prevale A
        if (isset($out[$id]) && $out[$id]['role'] === 'A') continue;
        $out[$id] = ['user_id' => $id, 'name' => $r['name'] !== '' ? $r['name'] : ('#' . $id), 'role' => $r['role']];
    }
    return $out;
}

/** Gestisce autori e collaboratori dell'elemento: X, P della ricerca, W del WP o un suo autore (A). */
function ra_can_manage_authors(PDO $pdo, array $scope, string $kind, int $id, int $wpId, int $resId, int $userId): bool {
    if (ra_scope_is_wp_editor($scope, $wpId, $resId)) return true;
    [$table, $col] = RA_AUTHOR_TABLES[$kind];
    $st = $pdo->prepare("SELECT 1 FROM $table WHERE $col = ? AND auth_id = ? AND auth_role = 'A' LIMIT 1");
    $st->execute([$id, $userId]);
    return (bool)$st->fetchColumn();
}

/**
 * Autori e collaboratori di elementi qualsiasi (anche di altri WP, es. modelli collegati).
 * @param int[] $ids
 * @return array<int, array<int, array{user_id:int, name:string, role:string}>>  id elemento => righe nell'ordine di auth_ord
 */
function ra_authors_of(PDO $pdo, string $kind, array $ids): array {
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids), fn($i) => $i > 0)));
    if (!$ids) return [];
    [$table, $col] = RA_AUTHOR_TABLES[$kind];
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("
        SELECT a.$col AS item_id, a.auth_id, a.auth_role,
               TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS name
        FROM   $table a
        LEFT JOIN users u ON u.id = a.auth_id
        WHERE  a.$col IN ($ph)
        ORDER  BY a.auth_ord, a.auth_role, u.last_name, u.first_name");   // auth_ord: ordine scelto (1 = primo)
    $st->execute($ids);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[(int)$r['item_id']][] = [
            'user_id' => (int)$r['auth_id'],
            'name'    => $r['name'] !== '' ? $r['name'] : ('#' . $r['auth_id']),
            'role'    => $r['auth_role'] === 'C' ? 'C' : 'A',
        ];
    }
    return $out;
}
