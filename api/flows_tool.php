<?php
// api/flows_tool.php
// CRUD per flows + object_flows_connections — sostituisce wp_flows_tool.php
// (flow_type='dashboard') e la lettura/scrittura di models.mod_fle
// (flow_type='object') con un'unica tabella + associazione N:N.
// Vedi sql/migration_flows.sql e _doc/module-fle-architettura.md §9.
//
// Actions GET:
//   ?action=list&flow_type=dashboard|object   → catalogo flow del WP corrente (senza flow_fle),
//                                                con link_count (oggetti o Dashboard Config
//                                                collegati) — ui/modal_flows.js (elenco unico).
//                                                flow_type opzionale, default 'dashboard'.
//   ?action=load&flow_id=N                → singolo flow con flow_fle completo
//   ?action=list_for_object&obj_id=N      → flow object collegati a un oggetto (con flow_fle)
//   ?action=list_for_dashboard&dshp_id=N  → flow dashboard collegati a una Dashboard Config
//                                            (con flow_fle) — runtime ed editor, vedi
//                                            _doc/arch-flow-dashboard.md (2026-10-04)
//   ?action=load_shared&flow_id=N&scope=wp|res|global[&flow_type=object|dashboard]
//                                          → flow_fle di un flow object di UN ALTRO
//                                            oggetto/WP, usato come sorgente da copiare
//                                            (ui/modal_flow_embedded.js, opzione "nuovo da
//                                            esistente condiviso"). Accesso verificato via
//                                            soglia flow_share (stesso schema di
//                                            ui/modal_objmod_links_tools.php::list_flows_for_object),
//                                            NON per appartenenza al WP corrente.
//
// Actions POST (JSON body):
//   { action:"create", flow_type?, flow_name, flow_description?, flow_show?, flow_share?, flow_fle?, dshp_id? }
//     → flow_type opzionale, default 'dashboard'. Se 'object': crea un flow SENZA alcuna
//       connessione (orfano finché non lo si collega da ui/modal_objmod_links.js "Links").
//       Se 'dashboard' con dshp_id: lo collega subito a quella Dashboard Config.
//   { action:"create_for_object", obj_id, flow_name?, flow_fle? }                                         → object
//   { action:"batch", flow_type, inserts:[...], updates:[...], deletes:[flow_id,...] }
//     → usata da ui/modal_flows.js (solo flow_type='object' oggi) — stesso pattern di
//       ui/modal_objects_tools.php?action=batch, transazionale, nessuna connessione toccata.
//   { action:"duplicate",     flow_id }   → la copia nasce sempre scollegata (anche i flow dashboard, dal 2026-10-04)
//   { action:"update",        flow_id, flow_name?, flow_description?, flow_fle?, flow_show?, flow_share?, flow_role?, flow_edit? }
//     (il campo dshp_id della vecchia modale dashboard è stato tolto il 2026-10-04:
//      i legami flow ↔ Dashboard Config passano dalla modale Link)
//   { action:"delete",        flow_id, force? }   → force: conferma se collegato a oggetti
//   { action:"set_author",    flow_id, author_id } → solo admin
//   batch.updates[] accetta anche flow_role e (solo admin) author_id; batch.force_delete
//   (set_active/set_inactive e flows.is_active rimossi il 2026-10-04: i flow dashboard
//    girano quando è caricata una Dashboard Config a cui sono collegati, e la Config
//    predefinita del WP sostituisce il "flow attivo" — _doc/arch-flow-dashboard.md)
//
// Permessi:
//   Lettura  → chiunque abbia accesso al WP di sessione (dashboard) o all'oggetto (object)
//   Scrittura → W (WPL), P (PI), X (admin) — stesso criterio di wp_flows_tool.php/mod_spec_tool.php
//   Modifica di un flow esistente (contenuto, nome, descrizione, show, share, ruolo, eliminazione):
//     SOLO l'autore (author_id) o l'admin — regola unica, _doc/arch-permessi.md §8ter.
//     Restano regole del WP: creare, collegare/scollegare (Links) a oggetti e Dashboard Config.
//   Eliminazione: vietata se il flow è usato da oggetti di altri WP (admin: force);
//     conferma (force) se collegato a oggetti del WP.
//   Ruolo (flow_role): 'config' = sempre caricato all'apertura dell'oggetto, per primo;
//     'behavior' = escludibile dal dialogo di apertura.
//
// Validazione dei nodi critici (2026-09-28, _doc/arch-abilitazioni.md §5):
//   flow_fle = BOZZA dell'autore; flow_fle_published = versione per gli altri.
//   load / list_for_object / load_shared restituiscono all'autore la bozza, a
//   tutti gli altri (admin compreso) la versione pubblicata, e solo se validata
//   quando contiene nodi critici (api/flow_validation.php::fv_version_for).
//   Ogni scrittura di flow_fle passa da fv_after_save(), che decide se la bozza
//   diventa subito pubblicata o resta in attesa di validazione.
//   La validazione vera e propria sta in api/flow_review_tool.php.
//
// flow_edit (2026-09-28, step 7, arch-abilitazioni.md §5.6): 0 = chi non è
//   l'autore (né admin) non può aprire il sorgente nell'editor
//   (load&for=edit) né copiarlo (duplicate, load_shared). Resta collegabile ed
//   eseguibile secondo flow_share. NON rende il codice segreto: per essere
//   eseguito il grafo arriva comunque al browser (load senza for=edit).

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';
require_once __DIR__ . '/flow_validation.php';
require_once __DIR__ . '/visibility.php';   // ra_session_user_ok, ra_is_guest (ospiti, id 0)

// --- Helpers ----------------------------------------------------------------

function ft_ok(mixed $data = null): never {
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

function ft_err(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function ft_body(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

function ft_norm_show(mixed $v): int {
    $n = (int)($v ?? 1);
    return in_array($n, [0, 1, 2, 3, 4, 5], true) ? $n : 1;   // 5 = ospiti
}

function ft_norm_share(mixed $v): int {
    $n = (int)($v ?? 1);
    return in_array($n, [0, 1, 2, 3], true) ? $n : 1;
}

function ft_decode_json_col(mixed $v): mixed {
    if (is_string($v) && $v !== '') return json_decode($v, true) ?? null;
    return $v;
}

// --- Auth -------------------------------------------------------------------

$user = $_SESSION['user'] ?? null;
if (!ra_session_user_ok($user)) {
    ft_err('Non autenticato.', 401);
}
if (ra_is_guest($user) && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') ft_err('Gli ospiti possono solo consultare.', 403);
$userId = (int)$user['id'];

$workpackage = $_SESSION['workpackage'] ?? null;
if (!is_array($workpackage)) {
    ft_err('Contesto workpackage non disponibile in sessione.', 500);
}
$wpId = (int)($workpackage['wp_id'] ?? 0);
if ($wpId <= 0) ft_err('wp_id non disponibile in sessione.', 500);

// NOTA (2026-09-16): $_SESSION['research']/['workpackage'] portano il permesso
// nelle chiavi 'res_perm'/'wp_perm' (rinominate da 'perm' — vedi arch-permessi.md
// §5/§10 per la storia e il bug che ha preceduto questa rinomina).
$research  = $_SESSION['research'] ?? [];
$isAdmin   = ($user['user_type'] ?? '') === 'X';
$isPI      = ($research['res_perm']    ?? '') === 'P';
$isWPL     = ($workpackage['wp_perm'] ?? '') === 'W';
$CAN_WRITE = ($isAdmin || $isPI || $isWPL);

if (!isset($pdo) || !($pdo instanceof PDO)) {
    ft_err('Connessione DB non disponibile.', 500);
}

/** Verifica che obj_id appartenga al wp_id di sessione (stesso criterio di mod_spec_tool.php su mod_id). */
function ft_assert_object_in_wp(PDO $pdo, int $objId, int $wpId): void {
    $st = $pdo->prepare("SELECT 1 FROM objects WHERE obj_id = ? AND wp_id = ? LIMIT 1");
    $st->execute([$objId, $wpId]);
    if (!$st->fetchColumn()) ft_err('Oggetto non trovato o non appartenente al WP corrente.', 404);
}

/** Verifica che dshp_id (Dashboard Config) appartenga al wp_id di sessione. */
function ft_assert_dshp_in_wp(PDO $pdo, int $dshpId, int $wpId): void {
    $st = $pdo->prepare("SELECT 1 FROM wp_dashboard_configs WHERE dshp_id = ? AND dshp_wp = ? LIMIT 1");
    $st->execute([$dshpId, $wpId]);
    if (!$st->fetchColumn()) ft_err('Configurazione dashboard non trovata o non appartenente al WP corrente.', 404);
}

/** Verifica che flow_id appartenga al wp_id di sessione (via flow_wp). */
function ft_assert_flow_in_wp(PDO $pdo, int $flowId, int $wpId): array {
    $st = $pdo->prepare("SELECT * FROM flows WHERE flow_id = ? AND flow_wp = ? LIMIT 1");
    $st->execute([$flowId, $wpId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) ft_err('Flow non trovato.', 404);
    return $row;
}

// --- Regola unica di scrittura dei flow (arch-permessi.md §8ter, 2026-09-23) --
// Contenuto, nome, descrizione, visibilità, condivisione, ruolo ed eliminazione
// di QUALSIASI flow: solo il suo autore (flows.author_id) o l'amministratore.
// Collegare/scollegare un flow a un oggetto o a una Dashboard Config resta regola
// del WP (W/P/X).

/** Ruoli ammessi: 'behavior' (comportamento, escludibile all'apertura) | 'config' (sempre caricato). */
function ft_norm_role(mixed $v): string {
    return ((string)$v === 'config') ? 'config' : 'behavior';
}

function ft_can_edit(array $row, int $userId, bool $isAdmin): bool {
    return $isAdmin || ((int)($row['author_id'] ?? 0) === $userId && $userId > 0);
}

function ft_assert_can_edit(array $row, int $userId, bool $isAdmin): void {
    if (!ft_can_edit($row, $userId, $isAdmin)) {
        ft_err('Solo l\'autore del flow o l\'amministratore possono modificarlo (flow #' . (int)$row['flow_id'] .
               '). Puoi usarlo, oppure salvarne una copia tua.', 403);
    }
}

/** Il sorgente del flow si può aprire/copiare? (flow_edit=0 → solo autore e admin) */
function ft_assert_source_open(array $row, int $userId, bool $isAdmin): void {
    if ((int)($row['flow_edit'] ?? 1) === 1 || ft_can_edit($row, $userId, $isAdmin)) return;
    ft_err('L\'autore non consente di aprire o copiare il sorgente di questo flow (flow #' . (int)$row['flow_id'] .
           '). Puoi comunque collegarlo ed eseguirlo.', 403);
}

/** Nome leggibile di un utente (per la colonna Autore). */
function ft_user_label(?string $first, ?string $last, ?string $uname): string {
    $n = trim(((string)$first) . ' ' . ((string)$last));
    return $n !== '' ? $n : (string)($uname ?? '');
}

/**
 * Collegamenti del flow a oggetti: totale e quanti sono di un ALTRO workpackage
 * (flow condiviso usato altrove). Guardia sull'eliminazione.
 */
function ft_object_links(PDO $pdo, int $flowId, int $flowWp): array {
    $st = $pdo->prepare("
        SELECT COUNT(*) AS total, COALESCE(SUM(o.wp_id <> ?), 0) AS other_wp
        FROM   object_flows_connections ofc
        JOIN   objects o ON o.obj_id = ofc.target_id
        WHERE  ofc.flow_id = ? AND ofc.flow_type = 'object'
    ");
    $st->execute([$flowWp, $flowId]);
    $r = $st->fetch(PDO::FETCH_ASSOC) ?: [];
    return ['total' => (int)($r['total'] ?? 0), 'other_wp' => (int)($r['other_wp'] ?? 0)];
}

/**
 * Eliminazione: collegato a oggetti di altri WP → vietato (solo l'amministratore,
 * con force); collegato a oggetti del proprio WP → serve la conferma (force), il
 * client la chiede mostrando quanti oggetti lo perderebbero.
 */
function ft_assert_can_delete(PDO $pdo, array $row, bool $isAdmin, bool $force): void {
    $links = ft_object_links($pdo, (int)$row['flow_id'], (int)$row['flow_wp']);
    if ($links['other_wp'] > 0 && !($isAdmin && $force)) {
        http_response_code(409);
        echo json_encode(['ok' => false, 'error' =>
            'Il flow #' . (int)$row['flow_id'] . ' è usato da ' . $links['other_wp'] .
            ' oggetti di altri workpackage: non si può eliminare (solo l\'amministratore può forzare).',
            'links' => $links, 'blocked' => true], JSON_UNESCAPED_UNICODE);
        exit;
    }
    if ($links['total'] > 0 && !$force) {
        http_response_code(409);
        echo json_encode(['ok' => false, 'error' =>
            'Il flow #' . (int)$row['flow_id'] . ' è collegato a ' . $links['total'] .
            ' oggetti: conferma l\'eliminazione.', 'links' => $links, 'confirm' => true], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

/** Riassegnazione dell'autore (solo amministratore): utente esistente. */
function ft_set_author(PDO $pdo, int $flowId, int $newAuthorId): string {
    $st = $pdo->prepare("SELECT id, first_name, last_name, user_name FROM users WHERE id = ? LIMIT 1");
    $st->execute([$newAuthorId]);
    $u = $st->fetch(PDO::FETCH_ASSOC);
    if (!$u) ft_err('Utente non trovato (author_id ' . $newAuthorId . ').', 404);
    $pdo->prepare("UPDATE flows SET author_id = ? WHERE flow_id = ?")->execute([$newAuthorId, $flowId]);
    return ft_user_label($u['first_name'], $u['last_name'], $u['user_name']);
}

/** Aggiunge author_name e can_edit alle righe di un elenco (con author_first/last/uname dalla JOIN). */
function ft_decorate_rows(array $rows, int $userId, bool $isAdmin): array {
    foreach ($rows as &$r) {
        $r['author_name'] = ft_user_label($r['author_first'] ?? null, $r['author_last'] ?? null, $r['author_uname'] ?? null);
        unset($r['author_first'], $r['author_last'], $r['author_uname']);
        $r['can_edit'] = ft_can_edit($r, $userId, $isAdmin);
    }
    return $rows;
}

// --- Router -----------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {

    // =========================================================================
    // GET
    // =========================================================================
    if ($method === 'GET') {
        $action = $_GET['action'] ?? '';

        // ---- list (dashboard | object) -----------------------------------------
        if ($action === 'list') {
            $flowType = ($_GET['flow_type'] ?? 'dashboard') === 'object' ? 'object' : 'dashboard';

            if ($flowType === 'object') {
                // Catalogo flow embedded (ui/modal_flows.js) — link_count al posto
                // di dshp_id: un flow object può avere più connessioni (N:N), un
                // singolo dshp_id non avrebbe senso qui.
                $st = $pdo->prepare("
                    SELECT f.flow_id, f.flow_name, f.flow_description, f.flow_role, f.flow_review, f.flow_edit,
                           f.flow_show, f.flow_share, f.created_at, f.updated_at, f.author_id,
                           u.first_name AS author_first, u.last_name AS author_last, u.user_name AS author_uname,
                           (SELECT COUNT(*) FROM object_flows_connections ofc2
                             WHERE ofc2.flow_id = f.flow_id AND ofc2.flow_type = 'object') AS link_count
                    FROM   flows f
                    LEFT JOIN users u ON u.id = f.author_id
                    WHERE  f.flow_wp = ? AND f.flow_type = 'object'
                    ORDER  BY f.updated_at DESC
                ");
                $st->execute([$wpId]);
                ft_ok(ft_decorate_rows($st->fetchAll(PDO::FETCH_ASSOC), $userId, $isAdmin));
            }

            // (2026-10-04) Un flow dashboard può essere collegato a più Dashboard
            // Config (_doc/arch-flow-dashboard.md): link_count = quante.
            $st = $pdo->prepare("
                SELECT f.flow_id, f.flow_name, f.flow_description, f.flow_role, f.flow_review, f.flow_edit,
                       f.flow_show, f.flow_share, f.created_at, f.updated_at, f.author_id,
                       u.first_name AS author_first, u.last_name AS author_last, u.user_name AS author_uname,
                       (SELECT COUNT(*) FROM object_flows_connections ofc2
                         WHERE ofc2.flow_id = f.flow_id AND ofc2.flow_type = 'dashboard') AS link_count
                FROM   flows f
                LEFT JOIN users u ON u.id = f.author_id
                WHERE  f.flow_wp = ? AND f.flow_type = 'dashboard'
                ORDER  BY f.updated_at DESC
            ");
            $st->execute([$wpId]);
            ft_ok(ft_decorate_rows($st->fetchAll(PDO::FETCH_ASSOC), $userId, $isAdmin));
        }

        // ---- list_authors (solo admin) -------------------------------------
        // Candidati per la riassegnazione dell'autore: utenti con un permesso sul
        // WP di sessione, più gli amministratori.
        if ($action === 'list_authors') {
            if (!$isAdmin) ft_err('Solo l\'amministratore può riassegnare l\'autore di un flow.', 403);
            $st = $pdo->prepare("
                SELECT DISTINCT u.id, u.first_name, u.last_name, u.user_name
                FROM   users u
                LEFT JOIN users_wp_permissions p ON p.user_id = u.id AND p.wp_id = ?
                WHERE  p.user_id IS NOT NULL OR u.user_type = 'X'
                ORDER  BY u.last_name, u.first_name, u.user_name
            ");
            $st->execute([$wpId]);
            $out = [];
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $u) {
                $out[] = ['id' => (int)$u['id'], 'name' => ft_user_label($u['first_name'], $u['last_name'], $u['user_name'])];
            }
            ft_ok($out);
        }

        // ---- load ---------------------------------------------------------
        if ($action === 'load') {
            $flowId = filter_input(INPUT_GET, 'flow_id', FILTER_VALIDATE_INT);
            if (!$flowId || $flowId <= 0) ft_err('flow_id mancante o non valido.', 400);

            $row = ft_assert_flow_in_wp($pdo, $flowId, $wpId);
            // for=edit: apertura nell'editor → rispetta flow_edit. Senza: esecuzione (runtime).
            if (($_GET['for'] ?? '') === 'edit') ft_assert_source_open($row, $userId, $isAdmin);
            // Bozza all'autore, versione pubblicata (e validata) a tutti gli altri
            $ver = fv_version_for($pdo, $row, $userId);
            $row['flow_fle']       = $ver['fle'];
            $row['flow_version']   = $ver['version'];
            $row['flow_unavailable_reason'] = $ver['reason'];
            unset($row['flow_fle_published'], $row['flow_hash_published']);
            $row['can_edit'] = ft_can_edit($row, $userId, $isAdmin);
            $st = $pdo->prepare("SELECT first_name, last_name, user_name FROM users WHERE id = ? LIMIT 1");
            $st->execute([(int)($row['author_id'] ?? 0)]);
            $au = $st->fetch(PDO::FETCH_ASSOC) ?: [];
            $row['author_name'] = ft_user_label($au['first_name'] ?? null, $au['last_name'] ?? null, $au['user_name'] ?? null);

            // Connessioni (dashboard_cfg per i flow dashboard, oggetti per gli object)
            $st = $pdo->prepare("SELECT flow_type, target_id FROM object_flows_connections WHERE flow_id = ?");
            $st->execute([$flowId]);
            $row['targets'] = $st->fetchAll(PDO::FETCH_ASSOC);

            ft_ok($row);
        }

        // ---- list_for_object ------------------------------------------------
        // Usata dai flow-runner Contesto 3 (TJS/OSD/MPS) al posto di models[].mod_fle.
        if ($action === 'list_for_object') {
            $objId = filter_input(INPUT_GET, 'obj_id', FILTER_VALIDATE_INT);
            if (!$objId || $objId <= 0) ft_err('obj_id mancante o non valido.', 400);
            ft_assert_object_in_wp($pdo, $objId, $wpId);

            // Flow di configurazione per primi: impostano l'oggetto prima che quelli
            // di comportamento reagiscano (vedi FLE-api.mjs::filterSelectedFlows).
            $st = $pdo->prepare("
                SELECT f.flow_id, f.flow_name, f.flow_description, f.flow_fle, f.flow_fle_published,
                       f.flow_show, f.flow_role, f.flow_review, f.author_id
                FROM   object_flows_connections ofc
                JOIN   flows f ON f.flow_id = ofc.flow_id
                WHERE  ofc.flow_type = 'object' AND ofc.target_id = ?
                ORDER  BY (f.flow_role = 'config') DESC, f.flow_name ASC
            ");
            $st->execute([$objId]);
            // Flow senza una versione eseguibile per questo utente (in attesa di
            // validazione, o validazione revocata): esclusi — il runner non li vede.
            $out = [];
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $ver = fv_version_for($pdo, $r, $userId);
                if ($ver['fle'] === null) continue;
                $r['flow_fle']     = $ver['fle'];
                $r['flow_version'] = $ver['version'];
                unset($r['flow_fle_published']);
                $out[] = $r;
            }
            ft_ok($out);
        }

        // ---- list_for_dashboard ---------------------------------------------
        // (2026-10-04, _doc/arch-flow-dashboard.md §5) Flow dashboard collegati a
        // una Dashboard Config: usata dal runtime (esegue i flow della Config
        // caricata) e dal selettore dell'editor in pannello. Come list_for_object:
        // config per primi; flow_fle = bozza all'autore, versione pubblicata e
        // validata agli altri. A differenza di list_for_object i flow SENZA versione
        // eseguibile restano nell'elenco con flow_fle = null e il motivo in
        // flow_unavailable_reason: il selettore li mostra, il runtime li salta.
        if ($action === 'list_for_dashboard') {
            $dshpId = filter_input(INPUT_GET, 'dshp_id', FILTER_VALIDATE_INT);
            if (!$dshpId || $dshpId <= 0) ft_err('dshp_id mancante o non valido.', 400);
            ft_assert_dshp_in_wp($pdo, $dshpId, $wpId);

            $st = $pdo->prepare("
                SELECT f.flow_id, f.flow_wp, f.flow_name, f.flow_description, f.flow_fle, f.flow_fle_published,
                       f.flow_show, f.flow_role, f.flow_review, f.flow_edit, f.author_id
                FROM   object_flows_connections ofc
                JOIN   flows f ON f.flow_id = ofc.flow_id
                WHERE  ofc.flow_type = 'dashboard' AND ofc.target_id = ?
                ORDER  BY (f.flow_role = 'config') DESC, f.flow_name ASC
            ");
            $st->execute([$dshpId]);
            $out = [];
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $ver = fv_version_for($pdo, $r, $userId);
                $r['can_edit']     = ft_can_edit($r, $userId, $isAdmin);
                $r['flow_version'] = $ver['version'];
                $r['flow_unavailable_reason'] = $ver['reason'];
                $r['flow_fle']     = $ver['fle'];
                unset($r['flow_fle_published']);
                $out[] = $r;
            }
            ft_ok($out);
        }

        // ---- load_shared ----------------------------------------------------
        // Sorgente per "crea nuovo flow embedded copiato da un flow condiviso
        // esistente" (ui/modal_flow_embedded.js). A differenza di "load" (scope
        // rigido: solo il WP di sessione), qui il criterio di accesso è la
        // soglia flow_share — stessa logica/soglie di
        // ui/modal_objmod_links_tools.php::list_flows_for_object, verificata
        // qui lato server (mai fidarsi dello scope dichiarato dal client).
        if ($action === 'load_shared') {
            $flowId = filter_input(INPUT_GET, 'flow_id', FILTER_VALIDATE_INT);
            $scope  = (string)($_GET['scope'] ?? 'wp');
            if (!$flowId || $flowId <= 0) ft_err('flow_id mancante o non valido.', 400);
            // (2026-10-04) anche flow dashboard come sorgente (_doc/arch-flow-dashboard.md §3.5)
            $srcType = ($_GET['flow_type'] ?? 'object') === 'dashboard' ? 'dashboard' : 'object';

            if ($scope === 'wp') {
                $st = $pdo->prepare("
                    SELECT * FROM flows
                    WHERE flow_id = ? AND flow_type = ? AND flow_wp = ? AND flow_share >= 1
                    LIMIT 1
                ");
                $st->execute([$flowId, $srcType, $wpId]);

            } elseif ($scope === 'res') {
                $resId = (int)($research['res_id'] ?? 0);
                if ($resId <= 0) ft_err('res_id non disponibile in sessione.', 500);
                $st = $pdo->prepare("
                    SELECT f.* FROM flows f
                    INNER JOIN workpackages wpf ON wpf.wp_id = f.flow_wp
                    WHERE f.flow_id = ? AND f.flow_type = ? AND wpf.res_id = ? AND f.flow_share >= 2
                    LIMIT 1
                ");
                $st->execute([$flowId, $srcType, $resId]);

            } elseif ($scope === 'global') {
                $st = $pdo->prepare("
                    SELECT * FROM flows
                    WHERE flow_id = ? AND flow_type = ? AND flow_share >= 3
                    LIMIT 1
                ");
                $st->execute([$flowId, $srcType]);

            } else {
                ft_err('Scope non valido.', 400);
            }

            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (!$row) ft_err('Flow non trovato o non condiviso a sufficienza per questo scope.', 403);
            ft_assert_source_open($row, $userId, $isAdmin);
            // Si copia la versione pubblicata (o la propria bozza, se si è l'autore)
            $ver = fv_version_for($pdo, $row, $userId);
            if ($ver['fle'] === null) ft_err($ver['reason'], 409);
            $row['flow_fle'] = $ver['fle'];
            unset($row['flow_fle_published'], $row['flow_hash_published']);
            ft_ok($row);
        }

        ft_err('Azione GET non riconosciuta. Usare: list, list_authors, load, list_for_object, list_for_dashboard, load_shared.', 400);
    }

    // =========================================================================
    // POST
    // =========================================================================
    if ($method === 'POST') {
        if (!$CAN_WRITE) ft_err('Permesso negato. Richiesto ruolo WPL, PI o Admin.', 403);

        $body   = ft_body();
        $action = (string)($body['action'] ?? '');

        // ---- create (dashboard | bare object, senza connessione) --------------
        if ($action === 'create') {
            $flowType = ($body['flow_type'] ?? 'dashboard') === 'object' ? 'object' : 'dashboard';
            $name = trim((string)($body['flow_name'] ?? 'Nuovo flusso'));
            if ($name === '') $name = 'Nuovo flusso';
            $desc  = trim((string)($body['flow_description'] ?? ''));
            $show  = ft_norm_show($body['flow_show']  ?? 1);
            $share = ft_norm_share($body['flow_share'] ?? 1);
            $fle   = array_key_exists('flow_fle', $body) ? $body['flow_fle'] : null;
            if ($fle !== null && !is_array($fle)) ft_err('flow_fle deve essere un oggetto JSON o null.', 400);

            // Connessione: per 'object' il flow nasce volutamente orfano (si collega
            // da ui/modal_objmod_links.js, o si usa create_for_object). Per
            // 'dashboard' (2026-10-04, _doc/arch-flow-dashboard.md §3.4) dshp_id
            // opzionale = "nuovo" dall'editor in pannello con una Config caricata.
            $dshpId = ($flowType === 'dashboard' && isset($body['dshp_id']) && is_numeric($body['dshp_id']))
                ? (int)$body['dshp_id'] : 0;
            if ($dshpId > 0) ft_assert_dshp_in_wp($pdo, $dshpId, $wpId);

            $review = null;
            $pdo->beginTransaction();
            try {
                $st = $pdo->prepare("
                    INSERT INTO flows (flow_wp, flow_type, flow_name, flow_description, flow_fle, flow_show, flow_share, author_id)
                    VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)
                ");
                $st->execute([
                    $wpId, $flowType, $name, $desc,
                    $fle !== null ? json_encode($fle, JSON_UNESCAPED_UNICODE) : null,
                    $show, $share, $userId,
                ]);
                $newId = (int)$pdo->lastInsertId();

                if ($dshpId > 0) {
                    $pdo->prepare("INSERT INTO object_flows_connections (flow_id, flow_type, target_id) VALUES (?, 'dashboard', ?)")
                        ->execute([$newId, $dshpId]);
                }
                if ($fle !== null) $review = fv_after_save($pdo, $newId, $isAdmin, $userId);
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }

            log_activity('flow:create', 'flow', $newId, $name);
            ft_ok(['flow_id' => $newId, 'flow_name' => $name, 'flow_review' => $review]);
        }

        // ---- create_for_object (object) --------------------------------------
        if ($action === 'create_for_object') {
            $objId = isset($body['obj_id']) && is_numeric($body['obj_id']) ? (int)$body['obj_id'] : 0;
            if ($objId <= 0) ft_err('obj_id mancante o non valido.', 400);
            ft_assert_object_in_wp($pdo, $objId, $wpId);

            $name = trim((string)($body['flow_name'] ?? 'Nuovo flow embedded'));
            if ($name === '') $name = 'Nuovo flow embedded';
            $fle  = array_key_exists('flow_fle', $body) ? $body['flow_fle'] : null;
            if ($fle !== null && !is_array($fle)) ft_err('flow_fle deve essere un oggetto JSON o null.', 400);

            $pdo->beginTransaction();
            try {
                $st = $pdo->prepare("
                    INSERT INTO flows (flow_wp, flow_type, flow_name, flow_fle, author_id)
                    VALUES (?, 'object', ?, CAST(? AS JSON), ?)
                ");
                $st->execute([$wpId, $name, $fle !== null ? json_encode($fle, JSON_UNESCAPED_UNICODE) : null, $userId]);
                $newId = (int)$pdo->lastInsertId();

                $st = $pdo->prepare("
                    INSERT INTO object_flows_connections (flow_id, flow_type, target_id)
                    VALUES (?, 'object', ?)
                ");
                $st->execute([$newId, $objId]);

                $review = fv_after_save($pdo, $newId, $isAdmin, $userId);
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }

            log_activity('flow:create', 'flow', $newId, $name);
            ft_ok(['flow_id' => $newId, 'flow_name' => $name, 'flow_review' => $review]);
        }

        // ---- batch (catalogo flow embedded, ui/modal_flows.js) -----------------
        // Stesso pattern transazionale di ui/modal_objects_tools.php?action=batch.
        // Solo metadati (flow_name/flow_description/flow_show/flow_share) — mai
        // flow_fle né object_flows_connections: il contenuto si edita dal
        // pannello FLE, i collegamenti da ui/modal_objmod_links.js ("Links").
        // Gli insert nascono senza alcuna connessione (flow orfano).
        if ($action === 'batch') {
            $flowType = ($body['flow_type'] ?? 'object') === 'dashboard' ? 'dashboard' : 'object';
            $inserts  = $body['inserts'] ?? [];
            $updates  = $body['updates'] ?? [];
            $deletes  = $body['deletes'] ?? [];

            if (!is_array($inserts) || !is_array($updates) || !is_array($deletes)) {
                ft_err('Formato batch non valido.', 400);
            }

            $pdo->beginTransaction();
            $logEntries = [];
            try {
                if (count($inserts) > 0) {
                    $stIns = $pdo->prepare("
                        INSERT INTO flows (flow_wp, flow_type, flow_name, flow_description, flow_show, flow_share, flow_edit, author_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ");
                    foreach ($inserts as $i => $d) {
                        if (!is_array($d)) ft_err("Insert #$i non valido.", 400);
                        $name = trim((string)($d['flow_name'] ?? ''));
                        if ($name === '') ft_err("flow_name obbligatorio (insert #$i).", 400);

                        $stIns->execute([
                            $wpId, $flowType, $name,
                            trim((string)($d['flow_description'] ?? '')),
                            ft_norm_show($d['flow_show']   ?? 1),
                            ft_norm_share($d['flow_share'] ?? 1),
                            empty($d['flow_edit']) && array_key_exists('flow_edit', $d) ? 0 : 1,
                            $userId,
                        ]);
                        $newId = (int)$pdo->lastInsertId();
                        $logEntries[] = ['flow:create', 'flow', $newId, $name];
                    }
                }

                if (count($updates) > 0) {
                    $stUpd = $pdo->prepare("
                        UPDATE flows SET flow_name = ?, flow_description = ?, flow_show = ?, flow_share = ?, flow_role = ?, flow_edit = ?
                        WHERE flow_id = ? AND flow_wp = ? AND flow_type = ?
                    ");
                    foreach ($updates as $i => $d) {
                        if (!is_array($d)) ft_err("Update #$i non valido.", 400);
                        $flowId = (int)($d['flow_id'] ?? 0);
                        if ($flowId <= 0) ft_err("flow_id non valido (update #$i).", 400);
                        $name = trim((string)($d['flow_name'] ?? ''));
                        if ($name === '') ft_err("flow_name obbligatorio (update #$i).", 400);

                        $cur = ft_assert_flow_in_wp($pdo, $flowId, $wpId);
                        ft_assert_can_edit($cur, $userId, $isAdmin);

                        $stUpd->execute([
                            $name,
                            trim((string)($d['flow_description'] ?? '')),
                            ft_norm_show($d['flow_show']   ?? 1),
                            ft_norm_share($d['flow_share'] ?? 1),
                            ft_norm_role($d['flow_role'] ?? ($cur['flow_role'] ?? 'behavior')),
                            array_key_exists('flow_edit', $d) ? (empty($d['flow_edit']) ? 0 : 1) : (int)($cur['flow_edit'] ?? 1),
                            $flowId, $wpId, $flowType,
                        ]);
                        $logEntries[] = ['flow:edit', 'flow', $flowId, $name];

                        // Riassegnazione dell'autore: solo l'amministratore
                        if ($isAdmin && isset($d['author_id']) && (int)$d['author_id'] > 0
                            && (int)$d['author_id'] !== (int)($cur['author_id'] ?? 0)) {
                            $label = ft_set_author($pdo, $flowId, (int)$d['author_id']);
                            $logEntries[] = ['flow:author', 'flow', $flowId, $label];
                        }
                    }
                }

                if (count($deletes) > 0) {
                    // object_flows_connections si ripulisce da sola (FK ON DELETE CASCADE).
                    // force_delete: il client ha già chiesto conferma mostrando i collegamenti.
                    $forceDel = !empty($body['force_delete']);
                    $stDel = $pdo->prepare("
                        DELETE FROM flows WHERE flow_id = ? AND flow_wp = ? AND flow_type = ?
                    ");
                    foreach ($deletes as $i => $id) {
                        $flowId = (int)$id;
                        if ($flowId <= 0) ft_err("flow_id non valido (delete #$i).", 400);
                        $cur = ft_assert_flow_in_wp($pdo, $flowId, $wpId);
                        ft_assert_can_edit($cur, $userId, $isAdmin);
                        ft_assert_can_delete($pdo, $cur, $isAdmin, $forceDel);
                        $stDel->execute([$flowId, $wpId, $flowType]);
                        $pdo->prepare("DELETE FROM authors_flows WHERE flow_id = ?")->execute([$flowId]);   // nessuna FK
                        $logEntries[] = ['flow:delete', 'flow', $flowId, ''];
                    }
                }

                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }

            foreach ($logEntries as $e) {
                log_activity($e[0], $e[1], $e[2], $e[3]);
            }
            ft_ok(null);
        }

        // ---- duplicate --------------------------------------------------------
        if ($action === 'duplicate') {
            $flowId = isset($body['flow_id']) && is_numeric($body['flow_id']) ? (int)$body['flow_id'] : 0;
            if ($flowId <= 0) ft_err('flow_id mancante o non valido.', 400);

            $src = ft_assert_flow_in_wp($pdo, $flowId, $wpId);
            ft_assert_source_open($src, $userId, $isAdmin);
            $newName = $src['flow_name'] . ' (copia)';

            // Si copia ciò che l'utente può vedere: la propria bozza se è
            // l'autore, altrimenti la versione pubblicata e validata — mai la
            // bozza non validata di un altro (arch-abilitazioni.md §5).
            $srcVer = fv_version_for($pdo, $src, $userId);
            if ($srcVer['fle'] === null && $src['flow_fle'] !== null) ft_err($srcVer['reason'], 409);
            $srcJson = $srcVer['fle'] !== null ? json_encode($srcVer['fle'], JSON_UNESCAPED_UNICODE) : null;

            $pdo->beginTransaction();
            try {
                $st = $pdo->prepare("
                    INSERT INTO flows
                        (flow_wp, flow_type, flow_name, flow_description, flow_fle, flow_show, flow_share, author_id)
                    VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)
                ");
                $st->execute([
                    $wpId, $src['flow_type'], $newName, $src['flow_description'],
                    $srcJson, (int)$src['flow_show'], (int)$src['flow_share'], $userId,
                ]);
                $newId = (int)$pdo->lastInsertId();
                // La copia è un flow nuovo: la validazione dell'originale non vale
                // per lei (salvo autore amministratore).
                fv_after_save($pdo, $newId, $isAdmin, $userId);

                // Connessioni: nessuna. La copia nasce scollegata e con ruolo
                // "comportamento" (default della colonna): altrimenti girerebbe
                // accanto all'originale sugli stessi oggetti / nella stessa Config —
                // si collega dalla modale Link. Fino al 2026-10-04 la copia di un
                // flow dashboard ereditava il legame alla Config (_doc/arch-flow-dashboard.md §3.5).

                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }

            log_activity('flow:duplicate', 'flow', $newId, $newName);
            ft_ok(['flow_id' => $newId, 'flow_name' => $newName]);
        }

        // ---- update -----------------------------------------------------------
        if ($action === 'update') {
            $flowId = isset($body['flow_id']) && is_numeric($body['flow_id']) ? (int)$body['flow_id'] : 0;
            if ($flowId <= 0) ft_err('flow_id mancante o non valido.', 400);

            $existing = ft_assert_flow_in_wp($pdo, $flowId, $wpId);

            // Qualsiasi campo del flow → autore o admin (i collegamenti passano dalla modale Link).
            ft_assert_can_edit($existing, $userId, $isAdmin);

            $sets   = [];
            $params = [];

            if (array_key_exists('flow_name', $body)) {
                $name = trim((string)$body['flow_name']);
                if ($name !== '') { $sets[] = 'flow_name = ?'; $params[] = $name; }
            }
            if (array_key_exists('flow_description', $body)) {
                $sets[] = 'flow_description = ?'; $params[] = trim((string)$body['flow_description']);
            }
            if (array_key_exists('flow_fle', $body)) {
                $sets[]   = 'flow_fle = CAST(? AS JSON)';
                $params[] = $body['flow_fle'] !== null ? json_encode($body['flow_fle'], JSON_UNESCAPED_UNICODE) : 'null';
            }
            if (array_key_exists('flow_show', $body)) {
                $sets[] = 'flow_show = ?'; $params[] = ft_norm_show($body['flow_show']);
            }
            if (array_key_exists('flow_share', $body)) {
                $sets[] = 'flow_share = ?'; $params[] = ft_norm_share($body['flow_share']);
            }
            if (array_key_exists('flow_role', $body)) {
                $sets[] = 'flow_role = ?'; $params[] = ft_norm_role($body['flow_role']);
            }
            if (array_key_exists('flow_edit', $body)) {
                $sets[] = 'flow_edit = ?'; $params[] = empty($body['flow_edit']) ? 0 : 1;
            }

            $review = null;
            if (!empty($sets)) {
                $params[] = $flowId;
                $pdo->beginTransaction();
                try {
                    $pdo->prepare("UPDATE flows SET " . implode(', ', $sets) . " WHERE flow_id = ?")->execute($params);
                    // Nuovo contenuto: resta bozza finché non è validato (se ha nodi
                    // critici). Chi salva è l'autore o l'admin (ft_assert_can_edit):
                    // il salvataggio di un amministratore vale come validazione.
                    if (array_key_exists('flow_fle', $body)) {
                        $review = fv_after_save($pdo, $flowId, $isAdmin, $userId);
                    }
                    $pdo->commit();
                } catch (Throwable $e) {
                    if ($pdo->inTransaction()) $pdo->rollBack();
                    throw $e;
                }
            }

            if (empty($sets)) ft_err('Nessun campo da aggiornare.', 400);

            $logName = array_key_exists('flow_name', $body) ? trim((string)$body['flow_name']) : '';
            log_activity('flow:edit', 'flow', $flowId, $logName);
            ft_ok(['flow_id' => $flowId, 'saved_at' => date('Y-m-d H:i:s'), 'flow_review' => $review]);
        }

        // ---- delete -------------------------------------------------------
        if ($action === 'delete') {
            $flowId = isset($body['flow_id']) && is_numeric($body['flow_id']) ? (int)$body['flow_id'] : 0;
            if ($flowId <= 0) ft_err('flow_id mancante o non valido.', 400);

            $row = ft_assert_flow_in_wp($pdo, $flowId, $wpId);
            ft_assert_can_edit($row, $userId, $isAdmin);
            ft_assert_can_delete($pdo, $row, $isAdmin, !empty($body['force']));

            // object_flows_connections si ripulisce da sola (FK ON DELETE CASCADE); authors_flows no
            $pdo->prepare("DELETE FROM flows WHERE flow_id = ?")->execute([$flowId]);
            $pdo->prepare("DELETE FROM authors_flows WHERE flow_id = ?")->execute([$flowId]);

            log_activity('flow:delete', 'flow', $flowId, '');
            ft_ok(['flow_id' => $flowId]);
        }

        // ---- set_author (solo admin) ----------------------------------------
        // Riassegnazione dell'autore (es. chi lascia il progetto): l'autore è chi
        // può modificare il flow (regola unica, §8ter).
        if ($action === 'set_author') {
            if (!$isAdmin) ft_err('Solo l\'amministratore può riassegnare l\'autore di un flow.', 403);
            $flowId   = isset($body['flow_id'])   && is_numeric($body['flow_id'])   ? (int)$body['flow_id']   : 0;
            $authorId = isset($body['author_id']) && is_numeric($body['author_id']) ? (int)$body['author_id'] : 0;
            if ($flowId <= 0 || $authorId <= 0) ft_err('flow_id o author_id mancante o non valido.', 400);
            ft_assert_flow_in_wp($pdo, $flowId, $wpId);
            $label = ft_set_author($pdo, $flowId, $authorId);
            log_activity('flow:author', 'flow', $flowId, $label);
            ft_ok(['flow_id' => $flowId, 'author_id' => $authorId, 'author_name' => $label]);
        }

        ft_err('Azione POST non riconosciuta.', 400);
    }

    ft_err('Metodo HTTP non supportato.', 405);

} catch (Throwable $e) {
    ft_err('Errore server: ' . $e->getMessage(), 500);
}
