<?php
// ui/modal_tree_obj_tools.php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

require_once __DIR__ . '/../api/i18n.php';
require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/folders_tools.php';
require_once __DIR__ . '/../api/visibility.php';
require_once __DIR__ . '/../api/edit_rights.php';
require_once __DIR__ . '/../api/ui_level.php';

function json_ok($data = null): void {
  echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
  exit;
}
function json_err(string $msg, int $code = 400): void {
  http_response_code($code);
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

// ----- Context from SESSION -----
$paths = $_SESSION['paths'] ?? null;
$user = $_SESSION['user'] ?? null;
$research = $_SESSION['research'] ?? null;
$workpackage = $_SESSION['workpackage'] ?? null;

/* Debug
echo "<script>
console.log('SESSION research', " . json_encode($research) . ");
console.log('SESSION workpackage', " . json_encode($workpackage) . ");
</script>";
*/




if (!is_array($user) || !is_array($research) || !is_array($workpackage)) {
  json_err(t('modal.tree_obj.err.no_context.@'), 500);
}

$user_id = (int)($user['id'] ?? 0);
$user_type = (string)($user['user_type'] ?? '');

$res_perm = (string)($research['res_perm'] ?? '');
$wp_perm  = (string)($workpackage['wp_perm'] ?? '');

$wp_id = (int)($workpackage['wp_id'] ?? 0);
if ($wp_id <= 0) json_err(t('modal.tree_obj.err.missing_param', ['name' => 'wp_id']), 500);

$isAdmin = ($user_type === 'X');

// Web base per mod_abs_url (come richiesto)
function folders_get_base_web(): string {
global $paths;
return $paths['data_path'];
}

// Visibilità di oggetti, modelli e flow: scala unica 0-5 in api/visibility.php
// (_doc/arch-permessi.md §11.5). $isFlow: al livello 0 un flow lo vede solo l'autore.
function is_visible_by_show(
  int $show,
  bool $isAdmin,
  int $user_id,
  string $user_type,
  string $wp_perm,
  string $res_perm,
  bool $isAuthor,
  bool $isFlow = false
): bool {
  if ($isAdmin) return true;
  return ra_can_see_item(['user_type' => $user_type], $show, $res_perm, $wp_perm, $isAuthor, $isFlow);
}

// Safe join for web path
function join_web_path(string ...$segs): string {
  $parts = [];
  foreach ($segs as $s) {
    $s = trim($s);
    if ($s === '') continue;
    $s = str_replace('\\', '/', $s);
    $s = ltrim($s, '/');
    $parts[] = $s;
  }
  return '/' . implode('/', $parts);
}

// sanitize relative path for mod_filename (allow /, forbid ..)
function sanitize_rel_path(string $path): string {
  $path = trim(str_replace('\\', '/', $path));
  $path = ltrim($path, '/');
  if ($path === '' || $path === '.') return '';

  $parts = explode('/', $path);
  $safe = [];
  foreach ($parts as $p) {
    if ($p === '' || $p === '.') continue;
    if ($p === '..') json_err(t('modal.tree_obj.err.path_invalid'), 400);
    // segment rule (simple)
    if (!preg_match('/^[A-Za-z0-9_\-\.]+$/', $p)) json_err(t('modal.tree_obj.err.path_segment', ['segment' => $p]), 400);
    // reuse your safety (also blocks traversal)
    folders_assert_safe_segment($p);
    $safe[] = $p;
  }
  return implode('/', $safe);
}

// DB check
if (!isset($pdo) || !($pdo instanceof PDO)) {
  json_err(t('modal.tree_obj.err.db_unavailable'), 500);
}

// ---- Helpers: authors checks ----
function is_object_author(PDO $pdo, int $obj_id, int $user_id): bool {
  $st = $pdo->prepare("SELECT 1 FROM authors_objects WHERE obj_id=? AND auth_id=? LIMIT 1");
  $st->execute([$obj_id, $user_id]);
  return (bool)$st->fetchColumn();
}
function is_model_author(PDO $pdo, int $mod_id, int $user_id): bool {
  $st = $pdo->prepare("SELECT 1 FROM authors_models WHERE mod_id=? AND auth_id=? LIMIT 1");
  $st->execute([$mod_id, $user_id]);
  return (bool)$st->fetchColumn();
}

// ---- Livello di interazione per pannello (_doc/arch-permessi.md §11.4) ----
// Ogni oggetto porta ui_level: il livello di base dell'utente, 30 se può modificare l'oggetto.
// Ogni modello porta can_edit. Il template (app/template_XXX.mjs) usa ui_level per il pannello.
$res_id    = (int)($research['res_id'] ?? 0);
$baseLevel = ra_ui_level($user, $research, $workpackage);
$editScope = ra_edit_scope($pdo, $user);

function obj_ui_level(int $obj_id): int {
  global $baseLevel, $editScope, $wp_id, $res_id;
  return ra_ui_level_item($baseLevel, ra_scope_can_edit($editScope, 'object', $obj_id, $wp_id, $res_id));
}

/** Ricerca del WP che contiene un modello (i modelli collegati possono venire da altri WP). */
function wp_res_id(PDO $pdo, int $wpId): int {
  static $cache = [];
  if (!isset($cache[$wpId])) {
    $st = $pdo->prepare("SELECT res_id FROM workpackages WHERE wp_id = ?");
    $st->execute([$wpId]);
    $cache[$wpId] = (int)($st->fetchColumn() ?: 0);
  }
  return $cache[$wpId];
}

// ---- Helpers: resolve model web URL ----
// models.wp_id -> workpackages -> researches -> folders(folder_name) and subfolder folder_name
function resolve_model_web_url(PDO $pdo, int $model_wp_id, int $mod_folder_id, string $mod_filename): array {
  $mod_filename = sanitize_rel_path($mod_filename);

  // workpackage info for the wp that OWNS the model file
  $st = $pdo->prepare("SELECT wp_id, res_id, wp_folder_id FROM workpackages WHERE wp_id=?");
  $st->execute([$model_wp_id]);
  $wpRow = $st->fetch(PDO::FETCH_ASSOC);
  if (!$wpRow) return ['url' => null, 'res_folder_name' => null, 'wp_folder_name' => null, 'subfolder_name' => null];

  $res_id = (int)$wpRow['res_id'];
  $wp_folder_id = (int)$wpRow['wp_folder_id'];
  if ($res_id <= 0 || $wp_folder_id <= 0) return ['url' => null, 'res_folder_name' => null, 'wp_folder_name' => null, 'subfolder_name' => null];

  $st = $pdo->prepare("SELECT res_id, res_folder_id FROM researches WHERE res_id=?");
  $st->execute([$res_id]);
  $resRow = $st->fetch(PDO::FETCH_ASSOC);
  if (!$resRow) return ['url' => null, 'res_folder_name' => null, 'wp_folder_name' => null, 'subfolder_name' => null];

  $res_folder_id = (int)$resRow['res_folder_id'];
  if ($res_folder_id <= 0) return ['url' => null, 'res_folder_name' => null, 'wp_folder_name' => null, 'subfolder_name' => null];

  // names from folders
  $st = $pdo->prepare("SELECT folder_id, folder_name FROM folders WHERE folder_id=?");
  $st->execute([$res_folder_id]);
  $resFolder = $st->fetch(PDO::FETCH_ASSOC);

  $st = $pdo->prepare("SELECT folder_id, folder_name FROM folders WHERE folder_id=?");
  $st->execute([$wp_folder_id]);
  $wpFolder = $st->fetch(PDO::FETCH_ASSOC);

  $st = $pdo->prepare("SELECT folder_id, folder_name, folder_parent_id FROM folders WHERE folder_id=?");
  $st->execute([$mod_folder_id]);
  $subFolder = $st->fetch(PDO::FETCH_ASSOC);

  if (!$resFolder || !$wpFolder || !$subFolder) {
    return ['url' => null, 'res_folder_name' => null, 'wp_folder_name' => null, 'subfolder_name' => null];
  }

  $res_folder_name = (string)$resFolder['folder_name'];
  $wp_folder_name  = (string)$wpFolder['folder_name'];
  $subfolder_name  = (string)$subFolder['folder_name'];

  // (optional) enforce hierarchy: subfolder must be child of wp_folder_id
  if ((int)($subFolder['folder_parent_id'] ?? 0) !== $wp_folder_id) {
    // non blocco hard: ma evito url incoerente
    return ['url' => null, 'res_folder_name' => $res_folder_name, 'wp_folder_name' => $wp_folder_name, 'subfolder_name' => $subfolder_name];
  }

  foreach ([$res_folder_name, $wp_folder_name, $subfolder_name] as $seg) {
    folders_assert_safe_segment($seg);
  }

  $base = folders_get_base_web(); // /GitHub/researches
  $url = join_web_path($base, $res_folder_name, $wp_folder_name, $subfolder_name, $mod_filename);

  return [
    'url' => $url,
    'res_folder_name' => $res_folder_name,
    'wp_folder_name' => $wp_folder_name,
    'subfolder_name' => $subfolder_name
  ];
}

// ---- ROUTER ----
$action = (string)($_GET['action'] ?? '');

// Oggetti visibili del WP con un dato obj_type_A e il file del loro primo modello visibile
// (mod_id più basso). Per il nodo ReseArch/Object/Index (2026-10-17): la chiave stabile fra
// installazioni è il nome del file, non l'obj_id. Parametro: type_a.
if ($action === 'index_by_type') {
  $type_a = trim((string)($_GET['type_a'] ?? ''));
  if ($type_a === '') json_err(t('modal.tree_obj.err.missing_param', ['name' => 'type_a']), 400);

  $st = $pdo->prepare("
    SELECT o.obj_id, o.obj_name, o.obj_show, m.mod_id, m.mod_show, m.mod_filename
    FROM objects o
    INNER JOIN object_models_connections c ON c.obj_id = o.obj_id
    INNER JOIN models m ON m.mod_id = c.mod_id
    WHERE o.wp_id = ? AND o.obj_type_A = ?
    ORDER BY o.obj_id, m.mod_id
  ");
  $st->execute([$wp_id, $type_a]);

  $out = [];       // obj_id => riga
  $objOk = [];     // obj_id => visibile?
  foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) {
    $obj_id = (int)$r['obj_id'];
    if (isset($out[$obj_id])) continue;
    if (!isset($objOk[$obj_id])) {
      $isAuthor = $isAdmin ? true : is_object_author($pdo, $obj_id, $user_id);
      $objOk[$obj_id] = is_visible_by_show((int)$r['obj_show'], $isAdmin, $user_id, $user_type, $wp_perm, $res_perm, $isAuthor);
    }
    if (!$objOk[$obj_id]) continue;
    $mod_id = (int)$r['mod_id'];
    $modAuthor = $isAdmin ? true : is_model_author($pdo, $mod_id, $user_id);
    if (!is_visible_by_show((int)$r['mod_show'], $isAdmin, $user_id, $user_type, $wp_perm, $res_perm, $modAuthor)) continue;
    $out[$obj_id] = [
      'obj_id'       => $obj_id,
      'obj_name'     => (string)$r['obj_name'],
      'mod_filename' => (string)$r['mod_filename'],
    ];
  }
  json_ok(array_values($out));
}


if ($action === 'tree') {
  // Objects of current WP (filter visibility server-side)
  $st = $pdo->prepare("
    SELECT obj_id, wp_id, obj_name, obj_description, obj_type_A, obj_type_B, obj_app, obj_show
    FROM objects
    WHERE wp_id=?
    ORDER BY obj_type_A, obj_type_B, obj_name
  ");
  $st->execute([$wp_id]);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
  // Autori e collaboratori, mostrati nel dettaglio dell'oggetto ("creatore et al.")
  $authorsBy = ra_authors_of($pdo, 'object', array_column($rows, 'obj_id'));

  // filter and group
  $groups = []; // typeA => typeB => objects[]
  foreach ($rows as $r) {
    $obj_id = (int)$r['obj_id'];
    $show = (int)($r['obj_show'] ?? 4);

    $isAuthor = $isAdmin ? true : is_object_author($pdo, $obj_id, $user_id);
    if (!is_visible_by_show($show, $isAdmin, $user_id, $user_type, $wp_perm, $res_perm, $isAuthor)) {
      continue;
    }

    $typeA = (string)($r['obj_type_A'] ?? '');
    $typeB = (string)($r['obj_type_B'] ?? '');

    if (!isset($groups[$typeA])) $groups[$typeA] = [];
    if (!isset($groups[$typeA][$typeB])) $groups[$typeA][$typeB] = [];

    $groups[$typeA][$typeB][] = [
      'obj_id' => $obj_id,
      'obj_name' => (string)$r['obj_name'],
      'obj_description' => (string)($r['obj_description'] ?? ''),
      'obj_type_A' => $typeA,
      'obj_type_B' => $typeB,
      'obj_app' => (string)($r['obj_app'] ?? ''),
      'ui_level' => obj_ui_level($obj_id),
      'authors' => $authorsBy[$obj_id] ?? [],
      // placeholder icon key (for future mapping)
      'icon' => 'document'
    ];
  }

  // normalize for JS
  $out = ['groups' => []];
  foreach ($groups as $typeA => $byB) {
    $gA = ['typeA' => $typeA, 'groupsB' => []];
    foreach ($byB as $typeB => $objs) {
      $gA['groupsB'][] = ['typeB' => $typeB, 'objects' => $objs];
    }
    $out['groups'][] = $gA;
  }

  json_ok($out);
}

if ($action === 'models_by_obj') {
  $obj_id = (int)($_GET['obj_id'] ?? 0);
  if ($obj_id <= 0) json_err(t('modal.tree_obj.err.missing_param', ['name' => 'obj_id']), 400);

  // object must belong to current WP
  $st = $pdo->prepare("SELECT obj_id, obj_name, obj_description, obj_type_A, obj_type_B, obj_app, obj_show FROM objects WHERE obj_id=? AND wp_id=?");
  $st->execute([$obj_id, $wp_id]);
  $obj = $st->fetch(PDO::FETCH_ASSOC);
  if (!$obj) json_err(t('modal.tree_obj.err.object_wrong_wp.@'), 403);

  // check object visibility too (avoid leaking through direct call)
  $obj_show = (int)($obj['obj_show'] ?? 4);
  $objAuthor = $isAdmin ? true : is_object_author($pdo, $obj_id, $user_id);
  if (!is_visible_by_show($obj_show, $isAdmin, $user_id, $user_type, $wp_perm, $res_perm, $objAuthor)) {
    json_err(t('modal.tree_obj.err.object_not_visible.@'), 403);
  }
  // ospiti: registro degli oggetti aperti (api/guest_log.php; per gli altri utenti non fa nulla)
  require_once __DIR__ . '/../api/guest_log.php';
  ra_guest_log('object', $obj_id);

  // models linked to object
  $st = $pdo->prepare("
    SELECT
      m.*,
      f.folder_name AS subfolder_name
    FROM object_models_connections c
    INNER JOIN models m ON m.mod_id = c.mod_id
    LEFT JOIN folders f ON f.folder_id = m.mod_folder_id
    WHERE c.obj_id = ?
    ORDER BY m.mod_id DESC
  ");
  $st->execute([$obj_id]);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
  $modAuthorsBy = ra_authors_of($pdo, 'model', array_column($rows, 'mod_id'));

  $models = [];
  foreach ($rows as $r) {
    $mod_id = (int)$r['mod_id'];
    $mod_show = (int)($r['mod_show'] ?? 4);

    $isAuthor = $isAdmin ? true : is_model_author($pdo, $mod_id, $user_id);
    if (!is_visible_by_show($mod_show, $isAdmin, $user_id, $user_type, $wp_perm, $res_perm, $isAuthor)) {
      continue;
    }

    $model_wp_id = (int)($r['wp_id'] ?? 0);
    $mod_folder_id = (int)($r['mod_folder_id'] ?? 0);
    $mod_filename = (string)($r['mod_filename'] ?? '');

    $resolved = resolve_model_web_url($pdo, $model_wp_id, $mod_folder_id, $mod_filename);

    $models[] = [
      'mod_id' => $mod_id,
      'wp_id' => $model_wp_id,
      'mod_folder_id' => $mod_folder_id,
      'mod_name' => (string)($r['mod_name'] ?? ''),
      'mod_description' => (string)($r['mod_description'] ?? ''),
      'mod_spec' => !empty($r['mod_spec']) ? json_decode($r['mod_spec'], true) : null,
      'mod_filename' => sanitize_rel_path($mod_filename),
      'subfolder_name' => (string)($r['subfolder_name'] ?? ''),
      'mod_abs_url' => $resolved['url'],
      'can_edit' => ra_scope_can_edit($editScope, 'model', $mod_id, $model_wp_id, wp_res_id($pdo, $model_wp_id)),
      'authors' => $modAuthorsBy[$mod_id] ?? [],
    ];
  }

  // flow embedded collegati all'oggetto (flow_type='object') — vedi
  // api/flows_tool.php e sql/migration_flows.sql. Stesso filtro di
  // visibilità di modelli/oggetti (flow_show), autore da flows.author_id
  // direttamente (niente tabella authors_flows collegata per ora).
  $st = $pdo->prepare("
    SELECT f.flow_id, f.flow_name, f.flow_description, f.flow_show, f.flow_role, f.author_id, f.updated_at
    FROM object_flows_connections ofc
    INNER JOIN flows f ON f.flow_id = ofc.flow_id
    WHERE ofc.flow_type = 'object' AND ofc.target_id = ?
    ORDER BY (f.flow_role = 'config') DESC, f.flow_name ASC
  ");
  $st->execute([$obj_id]);
  $flowRows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

  $flows = [];
  foreach ($flowRows as $r) {
    $flow_show = (int)($r['flow_show'] ?? 4);
    $isAuthor  = $isAdmin ? true : ((int)($r['author_id'] ?? 0) === $user_id && $user_id > 0);
    if (!is_visible_by_show($flow_show, $isAdmin, $user_id, $user_type, $wp_perm, $res_perm, $isAuthor, true)) {
      continue;
    }
    $flows[] = [
      'flow_id'          => (int)$r['flow_id'],
      'flow_name'        => (string)$r['flow_name'],
      'flow_description' => (string)($r['flow_description'] ?? ''),
      // 'config' = sempre caricato (casella bloccata nel dialogo), 'behavior' = escludibile
      'flow_role'        => (string)($r['flow_role'] ?? 'behavior'),
      'updated_at'       => (string)($r['updated_at'] ?? ''),
    ];
  }

  json_ok([
    'object' => [
      'obj_id' => (int)$obj['obj_id'],
      'obj_name' => (string)$obj['obj_name'],
      'obj_description' => (string)($obj['obj_description'] ?? ''),
      'obj_type_A' => (string)($obj['obj_type_A'] ?? ''),
      'obj_type_B' => (string)($obj['obj_type_B'] ?? ''),
      'obj_app' => (string)($obj['obj_app'] ?? ''),
      'ui_level' => obj_ui_level((int)$obj['obj_id']),
      'authors' => ra_authors_of($pdo, 'object', [(int)$obj['obj_id']])[(int)$obj['obj_id']] ?? [],
    ],
    'models' => $models,
    'flows'  => $flows,
  ]);
}

json_err(t('modal.tree_obj.err.invalid_action'), 400);
