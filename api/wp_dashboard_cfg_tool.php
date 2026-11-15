<?php
// api/wp_dashboard_cfg_tool.php
// CRUD per la tabella wp_dashboard_configs.
//
// Actions GET:
//   ?action=list              → elenco config del WP corrente (senza dshp_ico),
//                               con is_default e flow_count (flow dashboard collegati)
//   ?action=load&dshp_id=N   → singolo record con dshp_cfg + dshp_ico (data URL base64)
//   ?action=get_default      → { dshp_id | null } Config predefinita del WP
//   ?action=rights           → { can_create, can_set_default, max_show } nel WP corrente
//   ?action=list_shared&scope=res|global → configurazioni di ALTRI WP copiabili qui (dshp_share)
//
// Actions POST (JSON body):
//   { action:"create",      dshp_name, dshp_description?, dshp_cfg, dshp_ico? }
//   { action:"update",      dshp_id, dshp_name?, dshp_description?, dshp_cfg?, dshp_ico? }
//   { action:"duplicate",   dshp_id }   → la copia NON eredita i flow collegati né la predefinita
//   { action:"import",      dshp_id }   → copia nel WP corrente una configurazione di un altro WP
//   { action:"delete",      dshp_id }   → elimina anche i legami ai flow e azzera la predefinita
//   { action:"set_default", dshp_id | null }
//
// Config predefinita (workpackages.wp_default_dshp_id) e legami flow↔Config
// (object_flows_connections, flow_type='dashboard'): dal 2026-10-04, vedi
// _doc/arch-flow-dashboard.md.
//
// Permessi:
//   Lettura  → chi vede la configurazione secondo dshp_show (scala unica 0-5, api/visibility.php;
//              0 = autore della configurazione più X, P, W). Anche la predefinita (get_default)
//              si restituisce solo a chi la vede.
//   Creare e copiare → X, P della ricerca, W e I del WP (come gli oggetti)
//   Modificare, eliminare → X, P, W e l'autore (dshp_usr) — api/edit_rights.php
//   Predefinita del WP → X, P, W
//   Copia: dshp_share della sorgente (0-3, scala di flow_share) — _doc/arch-permessi.md §11.7.1
//
// Visibilità (2026-10-10, passo 6 di _doc/arch-permessi.md §11.9, regole del §11.7):
//   - dshp_show non può superare né res_show né wp_show (rifiutato al salvataggio);
//   - oggetti, modelli e flow collegati devono avere show >= dshp_show: al salvataggio si
//     restituisce data.warnings con l'elenco di quelli che non lo rispettano (solo avviso).

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';
require_once __DIR__ . '/visibility.php';
require_once __DIR__ . '/edit_rights.php';

// --- Helpers ----------------------------------------------------------------

function dc_ok(mixed $data = null): never {
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

function dc_err(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function dc_body(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

// Limiti allineati a wp_dashboard_configs.dshp_name VARCHAR(30) / dshp_description VARCHAR(255)
// (sql/migration_dashboard_cfg.sql) — validati qui in difesa, oltre al client.
const DC_NAME_MAX = 30;
const DC_DESC_MAX = 255;

function dc_check_len(string $val, int $max, string $label): void {
    if (mb_strlen($val) > $max) {
        dc_err("$label troppo lungo/a: massimo $max caratteri (attuale " . mb_strlen($val) . ").");
    }
}

function dc_ico_decode(?string $dataUrl): ?string {
    if ($dataUrl === null || $dataUrl === '') return null;
    // Rimuove il prefisso data:image/...;base64,
    $b64 = (string)preg_replace('/^data:[^;]+;base64,/', '', $dataUrl);
    $bin = base64_decode($b64, true);
    return ($bin !== false && strlen($bin) > 0) ? $bin : null;
}

/** Config predefinita del WP (workpackages.wp_default_dshp_id), null se assente. */
function dc_default_dshp(PDO $pdo, int $wpId): ?int {
    $st = $pdo->prepare("SELECT wp_default_dshp_id FROM workpackages WHERE wp_id = ? LIMIT 1");
    $st->execute([$wpId]);
    $v = $st->fetchColumn();
    return ($v === false || $v === null) ? null : (int)$v;
}

// --- Auth -------------------------------------------------------------------

$user = $_SESSION['user'] ?? null;
if (!ra_session_user_ok($user)) {
    dc_err('Non autenticato.', 401);
}
if (ra_is_guest($user) && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') dc_err('Gli ospiti possono solo consultare.', 403);
$userId = (int)$user['id'];

// --- Contesto WP ------------------------------------------------------------

$workpackage = $_SESSION['workpackage'] ?? null;
if (!is_array($workpackage)) {
    dc_err('Contesto workpackage non disponibile in sessione.', 500);
}
$wpId = (int)($workpackage['wp_id'] ?? 0);
if ($wpId <= 0) dc_err('wp_id non disponibile in sessione.', 500);

// --- Permessi ---------------------------------------------------------------

// NOTA (2026-09-16): sessione rinominata 'perm' → 'res_perm'/'wp_perm' — vedi
// _doc/arch-permessi.md §5/§10.
$research  = $_SESSION['research'] ?? [];
$resId     = (int)($research['res_id'] ?? 0);
$resPerm   = $research['res_perm']   ?? null;
$wpPerm    = $workpackage['wp_perm'] ?? null;
// Diritti di scrittura (§11.7.1): calcolati dopo il controllo della connessione, più sotto
$editScope  = null;
$CAN_CREATE = false;   // X, P, W, I: creare e copiare
$CAN_MANAGE = false;   // X, P, W: tutte le configurazioni del WP, predefinita

/** L'utente modifica (ed elimina) la configurazione $row (serve dshp_usr)? */
function dc_can_edit(array $row): bool {
    global $editScope, $userId, $wpId, $resId;
    return ra_dshp_can_edit($editScope, (int)($row['dshp_usr'] ?? 0), $userId, $wpId, $resId);
}

/**
 * L'utente copia $row (dshp_usr, dshp_share, dshp_wp, res_id) nel WP corrente?
 * Chi la modifica (nel suo WP) sempre; altrimenti secondo dshp_share (ra_item_linkable).
 */
function dc_can_copy(array $row): bool {
    global $editScope, $user, $userId, $wpId, $resId, $resPerm, $wpPerm, $CAN_CREATE;
    if (!$CAN_CREATE) return false;
    $srcWp  = (int)($row['dshp_wp'] ?? 0);
    $srcRes = (int)($row['res_id'] ?? 0);
    $owner  = ra_dshp_can_edit($editScope, (int)($row['dshp_usr'] ?? 0), $userId, $srcWp, $srcRes);
    return ra_item_linkable($owner, (int)($row['dshp_share'] ?? 1), $srcWp === $wpId, $srcRes === $resId,
                            $user, $resPerm, $wpPerm);
}

/** dshp_share dal body: intero 0-3. */
function dc_parse_share($v): int {
    if (!is_numeric($v)) dc_err('dshp_share non valido.');
    $n = (int)$v;
    if ($n < 0 || $n > 3) dc_err('dshp_share non valido.');
    return $n;
}

/** Inserisce la copia di $src nel WP corrente (autore: chi copia, share 1). Ritorna [id, nome]. */
function dc_insert_copy(PDO $pdo, array $src): array {
    global $wpId, $userId;
    $newName = mb_substr((string)$src['dshp_name'], 0, 27) . ' (2)';
    $st = $pdo->prepare("
        INSERT INTO wp_dashboard_configs
            (dshp_name, dshp_description, dshp_wp, dshp_usr, dshp_show, dshp_share, dshp_cfg, dshp_ico)
        VALUES (?, ?, ?, ?, ?, 1, CAST(? AS JSON), ?)
    ");
    $st->execute([
        $newName, $src['dshp_description'],
        $wpId, $userId,
        min((int)$src['dshp_show'], dc_max_show($pdo, $wpId)),
        $src['dshp_cfg'] ?? '{}',
        $src['dshp_ico'],
    ]);
    return [(int)$pdo->lastInsertId(), $newName];
}

/** La configurazione (riga con dshp_show e dshp_usr) è visibile all'utente? */
function dc_visible(array $row): bool {
    global $user, $userId, $resPerm, $wpPerm;
    return ra_can_see_item($user, (int)($row['dshp_show'] ?? 1), $resPerm, $wpPerm, (int)($row['dshp_usr'] ?? 0) === $userId);
}

/** Massimo dshp_show ammesso: il più restrittivo fra res_show e wp_show del WP corrente. */
function dc_max_show(PDO $pdo, int $wpId): int {
    $st = $pdo->prepare("SELECT r.res_show, w.wp_show FROM workpackages w JOIN researches r ON r.res_id = w.res_id WHERE w.wp_id = ?");
    $st->execute([$wpId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) return 0;
    return max(0, min(5, (int)$r['res_show'], (int)$r['wp_show']));
}

/** dshp_show dal body: intero 0-5 e non oltre il massimo, altrimenti errore. */
function dc_parse_show($v, int $max): int {
    if (!is_numeric($v)) dc_err('dshp_show non valido.');
    $n = (int)$v;
    if ($n < 0 || $n > 5) dc_err('dshp_show non valido.');
    if ($n > $max) dc_err("La visibilità non può superare quella della ricerca e del work package (massimo $max).");
    return $n;
}

/**
 * Contenuti della configurazione con show più basso di $show (regola 2 del §11.7):
 * oggetti dei pannelli, i loro modelli (quelli scelti, o tutti i collegati), i flow
 * dell'oggetto e i flow dashboard collegati alla configurazione.
 * @return array<int, array{type:string,id:int,name:string,show:int}>
 */
function dc_low_show_items(PDO $pdo, $cfg, int $dshpId, int $show): array {
    $leaves = [];
    $walk = function ($n) use (&$walk, &$leaves) {
        if (!is_array($n)) return;
        if (($n['type'] ?? '') === 'leaf') { $leaves[] = $n['savedState'] ?? []; return; }
        $walk($n['a'] ?? null);
        $walk($n['b'] ?? null);
    };
    $walk(is_array($cfg) ? ($cfg['bsp'] ?? null) : null);

    $out = [];
    $seen = [];
    $add = function (string $type, array $r, string $idK, string $nameK, string $showK) use (&$out, &$seen, $show) {
        $id = (int)$r[$idK];
        if (isset($seen["$type:$id"]) || (int)$r[$showK] >= $show) return;
        $seen["$type:$id"] = true;
        $out[] = ['type' => $type, 'id' => $id, 'name' => (string)$r[$nameK], 'show' => (int)$r[$showK]];
    };
    $stObj = $pdo->prepare("SELECT obj_id, obj_name, obj_show FROM objects WHERE obj_id = ?");
    $stMod = $pdo->prepare("SELECT m.mod_id, m.mod_name, m.mod_show FROM object_models_connections c JOIN models m ON m.mod_id = c.mod_id WHERE c.obj_id = ?");
    $stFlo = $pdo->prepare("SELECT f.flow_id, f.flow_name, f.flow_show FROM object_flows_connections c JOIN flows f ON f.flow_id = c.flow_id WHERE c.flow_type = 'object' AND c.target_id = ?");
    foreach ($leaves as $st) {
        $objId = (int)($st['objectId'] ?? 0);
        if ($objId <= 0) continue;
        $stObj->execute([$objId]);
        if ($o = $stObj->fetch(PDO::FETCH_ASSOC)) $add('object', $o, 'obj_id', 'obj_name', 'obj_show');
        $sel = is_array($st['selectedModelIds'] ?? null) ? array_map('intval', $st['selectedModelIds']) : [];
        $stMod->execute([$objId]);
        foreach ($stMod->fetchAll(PDO::FETCH_ASSOC) as $m) {
            if ($sel && !in_array((int)$m['mod_id'], $sel, true)) continue;
            $add('model', $m, 'mod_id', 'mod_name', 'mod_show');
        }
        $stFlo->execute([$objId]);
        foreach ($stFlo->fetchAll(PDO::FETCH_ASSOC) as $f) $add('flow', $f, 'flow_id', 'flow_name', 'flow_show');
    }
    if ($dshpId > 0) {
        $st = $pdo->prepare("SELECT f.flow_id, f.flow_name, f.flow_show FROM object_flows_connections c JOIN flows f ON f.flow_id = c.flow_id WHERE c.flow_type = 'dashboard' AND c.target_id = ?");
        $st->execute([$dshpId]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $f) $add('flow', $f, 'flow_id', 'flow_name', 'flow_show');
    }
    return $out;
}

/** Avvisi della regola 2 per la configurazione salvata $dshpId. */
function dc_warnings(PDO $pdo, int $dshpId): array {
    $st = $pdo->prepare("SELECT dshp_cfg, dshp_show FROM wp_dashboard_configs WHERE dshp_id = ?");
    $st->execute([$dshpId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) return [];
    $cfg = is_string($r['dshp_cfg']) ? json_decode($r['dshp_cfg'], true) : $r['dshp_cfg'];
    return dc_low_show_items($pdo, $cfg, $dshpId, (int)$r['dshp_show']);
}

// --- DB ---------------------------------------------------------------------

if (!isset($pdo) || !($pdo instanceof PDO)) {
    dc_err('Connessione DB non disponibile.', 500);
}

$editScope  = ra_edit_scope($pdo, $user);
$CAN_CREATE = ra_scope_can_create($editScope, $wpId, $resId);
$CAN_MANAGE = ra_scope_is_wp_editor($editScope, $wpId, $resId);

// --- Router -----------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {

    // =========================================================================
    // GET
    // =========================================================================
    if ($method === 'GET') {
        $action = $_GET['action'] ?? '';

        // ---- list -----------------------------------------------------------
        if ($action === 'list') {
            $st = $pdo->prepare("
                SELECT c.dshp_id, c.dshp_name, c.dshp_description, c.dshp_wp, c.dshp_usr,
                       c.dshp_show, c.dshp_share, w.res_id,
                       (c.dshp_ico IS NOT NULL) AS has_ico,
                       (w.wp_default_dshp_id = c.dshp_id) AS is_default,
                       (SELECT COUNT(*) FROM object_flows_connections ofc
                         WHERE ofc.flow_type = 'dashboard' AND ofc.target_id = c.dshp_id) AS flow_count,
                       c.created_at, c.updated_at
                FROM   wp_dashboard_configs c
                JOIN   workpackages w ON w.wp_id = c.dshp_wp
                WHERE  c.dshp_wp = ?
                ORDER  BY c.updated_at DESC
            ");
            $st->execute([$wpId]);
            $rows = array_values(array_filter($st->fetchAll(PDO::FETCH_ASSOC), 'dc_visible'));
            $maxShow = dc_max_show($pdo, $wpId);
            foreach ($rows as &$r) {
                $r['has_ico']    = (bool)$r['has_ico'];
                $r['is_default'] = (bool)$r['is_default'];
                $r['flow_count'] = (int)$r['flow_count'];
                $r['dshp_show']  = (int)$r['dshp_show'];
                $r['dshp_share'] = (int)$r['dshp_share'];
                $r['max_show']   = $maxShow;   // massimo ammesso per dshp_show (regola 1 del §11.7)
                $r['can_edit']   = dc_can_edit($r);    // §11.7.1: X, P, W e l'autore
                $r['can_copy']   = dc_can_copy($r);
                unset($r['dshp_wp'], $r['res_id']);
            }
            unset($r);
            dc_ok($rows);
        }

        // ---- rights ---------------------------------------------------------
        // Cosa può fare l'utente nel WP corrente (pulsanti della modale, anche a elenco vuoto)
        if ($action === 'rights') {
            dc_ok([
                'can_create'      => $CAN_CREATE,
                'can_set_default' => $CAN_MANAGE,
                'max_show'        => dc_max_show($pdo, $wpId),
            ]);
        }

        // ---- list_shared ----------------------------------------------------
        // Configurazioni di ALTRI WP che l'utente può copiare qui (§11.7.1):
        // scope=res → WP della stessa ricerca; scope=global → qualunque ricerca.
        if ($action === 'list_shared') {
            if (!$CAN_CREATE) dc_ok([]);
            $scope = ($_GET['scope'] ?? 'res') === 'global' ? 'global' : 'res';
            $sql = "
                SELECT c.dshp_id, c.dshp_name, c.dshp_description, c.dshp_wp, c.dshp_usr,
                       c.dshp_show, c.dshp_share, c.updated_at,
                       w.res_id, w.wp_title, r.res_title
                FROM   wp_dashboard_configs c
                JOIN   workpackages w ON w.wp_id  = c.dshp_wp
                JOIN   researches   r ON r.res_id = w.res_id
                WHERE  c.dshp_wp <> ?" . ($scope === 'res' ? " AND w.res_id = ?" : "") . "
                ORDER  BY r.res_title, w.wp_title, c.dshp_name
                LIMIT  500
            ";
            $st = $pdo->prepare($sql);
            $st->execute($scope === 'res' ? [$wpId, $resId] : [$wpId]);
            $rows = [];
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
                if (!dc_can_copy($r)) continue;
                $rows[] = [
                    'dshp_id'          => (int)$r['dshp_id'],
                    'dshp_name'        => $r['dshp_name'],
                    'dshp_description' => $r['dshp_description'],
                    'dshp_share'       => (int)$r['dshp_share'],
                    'wp_title'         => $r['wp_title'],
                    'res_title'        => $r['res_title'],
                    'updated_at'       => $r['updated_at'],
                ];
            }
            dc_ok($rows);
        }

        // ---- get_default ----------------------------------------------------
        if ($action === 'get_default') {
            // Solo a chi la vede (regola 4 del §11.7)
            $def = dc_default_dshp($pdo, $wpId);
            if ($def !== null) {
                $st = $pdo->prepare("SELECT dshp_show, dshp_usr FROM wp_dashboard_configs WHERE dshp_id = ? AND dshp_wp = ?");
                $st->execute([$def, $wpId]);
                $r = $st->fetch(PDO::FETCH_ASSOC);
                if (!$r || !dc_visible($r)) $def = null;
            }
            dc_ok(['dshp_id' => $def]);
        }

        // ---- load -----------------------------------------------------------
        if ($action === 'load') {
            $dshpId = filter_input(INPUT_GET, 'dshp_id', FILTER_VALIDATE_INT);
            if (!$dshpId || $dshpId <= 0) dc_err('dshp_id mancante o non valido.', 400);

            $st = $pdo->prepare("
                SELECT dshp_id, dshp_name, dshp_description, dshp_wp, dshp_usr, dshp_show,
                       dshp_cfg, dshp_ico, created_at, updated_at
                FROM   wp_dashboard_configs
                WHERE  dshp_id = ? AND dshp_wp = ?
                LIMIT  1
            ");
            $st->execute([$dshpId, $wpId]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (!$row || !dc_visible($row)) dc_err('Config non trovata.', 404);

            // Decodifica JSON
            if (is_string($row['dshp_cfg']) && $row['dshp_cfg'] !== '') {
                $row['dshp_cfg'] = json_decode($row['dshp_cfg'], true) ?? null;
            }
            // Thumbnail: converti BLOB → data URL base64
            if ($row['dshp_ico'] !== null) {
                $row['dshp_ico'] = 'data:image/png;base64,' . base64_encode($row['dshp_ico']);
            }
            dc_ok($row);
        }

        dc_err('Azione GET non riconosciuta. Usare: list, load, get_default, rights, list_shared.', 400);
    }

    // =========================================================================
    // POST
    // =========================================================================
    if ($method === 'POST') {
        $body   = dc_body();
        $action = (string)($body['action'] ?? '');

        // ---- create ---------------------------------------------------------
        if ($action === 'create') {
            if (!$CAN_CREATE) dc_err('Permesso negato: creano le configurazioni X, P, W e I.', 403);
            $name = trim((string)($body['dshp_name'] ?? ''));
            if ($name === '') dc_err('dshp_name è obbligatorio.');
            dc_check_len($name, DC_NAME_MAX, 'Nome');
            $desc = trim((string)($body['dshp_description'] ?? ''));
            dc_check_len($desc, DC_DESC_MAX, 'Descrizione');
            $cfg  = $body['dshp_cfg'] ?? new stdClass();
            $cfgJ = json_encode($cfg, JSON_UNESCAPED_UNICODE);
            $ico  = isset($body['dshp_ico']) ? dc_ico_decode((string)$body['dshp_ico']) : null;
            $maxShow = dc_max_show($pdo, $wpId);
            $show  = array_key_exists('dshp_show', $body) ? dc_parse_show($body['dshp_show'], $maxShow) : min(1, $maxShow);
            $share = array_key_exists('dshp_share', $body) ? dc_parse_share($body['dshp_share']) : 1;

            $st = $pdo->prepare("
                INSERT INTO wp_dashboard_configs
                    (dshp_name, dshp_description, dshp_wp, dshp_usr, dshp_show, dshp_share, dshp_cfg, dshp_ico)
                VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)
            ");
            $st->execute([$name, $desc, $wpId, $userId, $show, $share, $cfgJ, $ico]);
            $newId = (int)$pdo->lastInsertId();

            log_activity('dshp:create', 'dashboard_cfg', $newId, $name);
            dc_ok(['dshp_id' => $newId, 'dshp_name' => $name, 'dshp_show' => $show, 'warnings' => dc_warnings($pdo, $newId)]);
        }

        // ---- update ---------------------------------------------------------
        if ($action === 'update') {
            $dshpId = isset($body['dshp_id']) && is_numeric($body['dshp_id'])
                ? (int)$body['dshp_id'] : 0;
            if ($dshpId <= 0) dc_err('dshp_id mancante o non valido.');

            $st = $pdo->prepare("SELECT dshp_id, dshp_usr FROM wp_dashboard_configs WHERE dshp_id = ? AND dshp_wp = ? LIMIT 1");
            $st->execute([$dshpId, $wpId]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (!$row) dc_err('Config non trovata.', 404);
            if (!dc_can_edit($row)) dc_err('Permesso negato: modificano la configurazione X, P, W e il suo autore.', 403);

            $sets = []; $params = [];

            if (array_key_exists('dshp_name', $body)) {
                $n = trim((string)$body['dshp_name']);
                if ($n !== '') {
                    dc_check_len($n, DC_NAME_MAX, 'Nome');
                    $sets[] = 'dshp_name = ?'; $params[] = $n;
                }
            }
            if (array_key_exists('dshp_description', $body)) {
                $d = trim((string)$body['dshp_description']);
                dc_check_len($d, DC_DESC_MAX, 'Descrizione');
                $sets[]   = 'dshp_description = ?';
                $params[] = $d;
            }
            if (array_key_exists('dshp_cfg', $body)) {
                $sets[]   = 'dshp_cfg = CAST(? AS JSON)';
                $params[] = json_encode($body['dshp_cfg'], JSON_UNESCAPED_UNICODE);
            }
            if (array_key_exists('dshp_ico', $body)) {
                $sets[]   = 'dshp_ico = ?';
                $params[] = dc_ico_decode((string)($body['dshp_ico'] ?? ''));
            }
            if (array_key_exists('dshp_show', $body)) {
                $sets[]   = 'dshp_show = ?';
                $params[] = dc_parse_show($body['dshp_show'], dc_max_show($pdo, $wpId));
            }
            if (array_key_exists('dshp_share', $body)) {
                $sets[]   = 'dshp_share = ?';
                $params[] = dc_parse_share($body['dshp_share']);
            }
            if (empty($sets)) dc_err('Nessun campo da aggiornare.');

            $params[] = $dshpId;
            $params[] = $wpId;
            $pdo->prepare("UPDATE wp_dashboard_configs SET " . implode(', ', $sets) .
                          " WHERE dshp_id = ? AND dshp_wp = ?")->execute($params);

            log_activity('dshp:edit', 'dashboard_cfg', $dshpId, (string)($body['dshp_name'] ?? ''));
            // Avvisi solo quando cambiano layout o visibilità
            $warn = (array_key_exists('dshp_cfg', $body) || array_key_exists('dshp_show', $body)) ? dc_warnings($pdo, $dshpId) : [];
            dc_ok(['dshp_id' => $dshpId, 'saved_at' => date('Y-m-d H:i:s'), 'warnings' => $warn]);
        }

        // ---- duplicate ------------------------------------------------------
        if ($action === 'duplicate') {
            $dshpId = isset($body['dshp_id']) && is_numeric($body['dshp_id'])
                ? (int)$body['dshp_id'] : 0;
            if ($dshpId <= 0) dc_err('dshp_id mancante o non valido.');

            $st = $pdo->prepare("
                SELECT c.dshp_name, c.dshp_description, c.dshp_show, c.dshp_share, c.dshp_wp, c.dshp_usr,
                       c.dshp_cfg, c.dshp_ico, w.res_id
                FROM   wp_dashboard_configs c JOIN workpackages w ON w.wp_id = c.dshp_wp
                WHERE  c.dshp_id = ? AND c.dshp_wp = ? LIMIT 1
            ");
            $st->execute([$dshpId, $wpId]);
            $src = $st->fetch(PDO::FETCH_ASSOC);
            if (!$src || !dc_visible($src)) dc_err('Config sorgente non trovata.', 404);
            if (!dc_can_copy($src)) dc_err('Permesso negato: la configurazione non si può copiare (condivisione 0) o non puoi creare configurazioni in questo WP.', 403);

            [$newId, $newName] = dc_insert_copy($pdo, $src);
            log_activity('dshp:duplicate', 'dashboard_cfg', $newId, $newName);
            dc_ok(['dshp_id' => $newId, 'dshp_name' => $newName, 'warnings' => dc_warnings($pdo, $newId)]);
        }

        // ---- import ---------------------------------------------------------
        // Copia nel WP corrente una configurazione di un ALTRO WP (§11.7.1), con le stesse
        // regole di list_shared. I pannelli restano riferiti agli oggetti d'origine: l'avviso
        // della regola 2 elenca quelli meno visibili della copia.
        if ($action === 'import') {
            $dshpId = isset($body['dshp_id']) && is_numeric($body['dshp_id'])
                ? (int)$body['dshp_id'] : 0;
            if ($dshpId <= 0) dc_err('dshp_id mancante o non valido.');

            $st = $pdo->prepare("
                SELECT c.dshp_name, c.dshp_description, c.dshp_show, c.dshp_share, c.dshp_wp, c.dshp_usr,
                       c.dshp_cfg, c.dshp_ico, w.res_id
                FROM   wp_dashboard_configs c JOIN workpackages w ON w.wp_id = c.dshp_wp
                WHERE  c.dshp_id = ? LIMIT 1
            ");
            $st->execute([$dshpId]);
            $src = $st->fetch(PDO::FETCH_ASSOC);
            if (!$src || !dc_can_copy($src)) dc_err('Config non trovata o non copiabile in questo WP.', 404);

            [$newId, $newName] = dc_insert_copy($pdo, $src);
            log_activity('dshp:import', 'dashboard_cfg', $newId, $newName);
            dc_ok(['dshp_id' => $newId, 'dshp_name' => $newName, 'warnings' => dc_warnings($pdo, $newId)]);
        }

        // ---- delete ---------------------------------------------------------
        if ($action === 'delete') {
            $dshpId = isset($body['dshp_id']) && is_numeric($body['dshp_id'])
                ? (int)$body['dshp_id'] : 0;
            if ($dshpId <= 0) dc_err('dshp_id mancante o non valido.');

            $st = $pdo->prepare("SELECT dshp_id, dshp_usr FROM wp_dashboard_configs WHERE dshp_id = ? AND dshp_wp = ? LIMIT 1");
            $st->execute([$dshpId, $wpId]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (!$row) dc_err('Config non trovata.', 404);
            if (!dc_can_edit($row)) dc_err('Permesso negato: eliminano la configurazione X, P, W e il suo autore.', 403);

            // Legami ai flow e predefinita: riferimenti polimorfici/logici, nessuna
            // FK che li ripulisca da sola (_doc/arch-flow-dashboard.md §4).
            $pdo->beginTransaction();
            try {
                $pdo->prepare("DELETE FROM object_flows_connections WHERE flow_type = 'dashboard' AND target_id = ?")
                    ->execute([$dshpId]);
                $pdo->prepare("UPDATE workpackages SET wp_default_dshp_id = NULL WHERE wp_id = ? AND wp_default_dshp_id = ?")
                    ->execute([$wpId, $dshpId]);
                $pdo->prepare("DELETE FROM wp_dashboard_configs WHERE dshp_id = ? AND dshp_wp = ?")->execute([$dshpId, $wpId]);
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }

            log_activity('dshp:delete', 'dashboard_cfg', $dshpId, '');
            dc_ok(['dshp_id' => $dshpId]);
        }

        // ---- set_default ----------------------------------------------------
        // Config predefinita del WP: caricata all'apertura della dashboard, i suoi
        // flow girano per tutti gli utenti del WP. null = nessuna.
        if ($action === 'set_default') {
            if (!$CAN_MANAGE) dc_err('Permesso negato: la predefinita la scelgono X, P e W.', 403);
            $dshpId = (isset($body['dshp_id']) && is_numeric($body['dshp_id'])) ? (int)$body['dshp_id'] : null;
            if ($dshpId !== null) {
                if ($dshpId <= 0) dc_err('dshp_id non valido.');
                $st = $pdo->prepare("SELECT dshp_name FROM wp_dashboard_configs WHERE dshp_id = ? AND dshp_wp = ? LIMIT 1");
                $st->execute([$dshpId, $wpId]);
                if ($st->fetchColumn() === false) dc_err('Config non trovata.', 404);
            }
            $pdo->prepare("UPDATE workpackages SET wp_default_dshp_id = ? WHERE wp_id = ?")->execute([$dshpId, $wpId]);

            log_activity('dshp:default', 'dashboard_cfg', $dshpId, '');
            dc_ok(['dshp_id' => $dshpId]);
        }

        dc_err('Azione POST non riconosciuta.', 400);
    }

    dc_err('Metodo HTTP non supportato.', 405);

} catch (Throwable $e) {
    dc_err('Errore server: ' . $e->getMessage(), 500);
}
