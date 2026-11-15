<?php
//Controllo di Sessione
declare(strict_types=1);

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}


require_once __DIR__ . '/../api/i18n.php';
require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/folders_tools.php';
require_once __DIR__ . '/../api/edit_rights.php';
require_once __DIR__ . '/../api/log_tool.php';


// Verifica PDO
if (!isset($pdo) || !($pdo instanceof PDO)) {
  folders_json_err(t('modal.sub_folders.err.db_unavailable'), 500);
}

// Assumo che questi array globali esistano già nel tuo contesto applicativo.
// Se non sono disponibili in questo endpoint, includi qui il file che li prepara.
// global $research, $workpackage;



$research = $_SESSION['research'];
$workpackage = $_SESSION['workpackage'];

if (!is_array($research ?? null) || !is_array($workpackage ?? null)) {
    folders_json_err(t('modal.sub_folders.err.no_context.@'), 500);    
    //folders_json_err('Contesto ricerca/workpackage non disponibile.', 500);
    //folders_json_err('Contesto ricerca/workpackage non disponibile.', 500);
}

$user = folders_current_user();

// Permessi: admin user_type=X; PI res_perm=P; WPL wp_perm=W
//
// FIX (2026-09-16): $_SESSION['research']/$_SESSION['workpackage'] portano il
// permesso nella chiave 'perm' (vedi workpackages.php riga ~122 e dashboard.php
// riga ~80: la query SQL alias sempre "AS perm", mai "AS res_perm"/"AS wp_perm").
// Questa funzione controllava le chiavi res_perm/wp_perm, che non sono mai
// popolate — isset() era sempre false, quindi $isPI/$isWPL risultavano sempre
// false e SOLO l'amministratore (user_type='X') riusciva a superare il
// controllo. Un PI/WPL riusciva a creare la cartella del workpackage tramite
// ui/modal_workpackages_tools.php (che già leggeva 'perm' con un fallback
// corretto, riga ~89: res_perm ?? perm) ma falliva su QUALSIASI sottocartella
// tramite questo file. Stesso fallback applicato qui, per compatibilità con
// entrambe le chiavi possibili.
function wp_subfolders_can_manage(array $user, array $research, array $workpackage): bool {
  $isAdmin = isset($user['user_type']) && $user['user_type'] === 'X';
  $resPerm = $research['res_perm'] ?? $research['perm'] ?? null;
  $wpPerm  = $workpackage['wp_perm'] ?? $workpackage['perm'] ?? null;
  $isPI    = $resPerm === 'P';
  $isWPL   = $wpPerm === 'W';
  return $isAdmin || $isPI || $isWPL;
}

// Elenco delle sottocartelle (GET list) anche a chi crea modelli e carica file
// (I del WP, 2026-10-10, passo 4 di _doc/arch-permessi.md §11.9): serve al selettore
// dei file. Creare, rinominare ed eliminare sottocartelle resta a X, P e W.
$canManageSubfolders = wp_subfolders_can_manage($user, $research, $workpackage);
$canListSubfolders = $canManageSubfolders || ra_scope_can_create(
  ra_edit_scope($pdo, $user), (int)($workpackage['wp_id'] ?? 0), (int)($research['res_id'] ?? 0)
);
if (!$canListSubfolders) {
  folders_json_err(t('errors.not_authorized'), 403);
}

$res_folder_id = (int)($research['res_folder_id'] ?? 0);
$wp_folder_id  = (int)($workpackage['wp_folder_id'] ?? 0);

if ($res_folder_id <= 0 || $wp_folder_id <= 0) {
  folders_json_err(t('modal.sub_folders.err.missing_folder_ids'), 500);
}

function db_get_folder(PDO $pdo, int $folder_id): ?array {
  $st = $pdo->prepare("SELECT folder_id, folder_name, folder_description, creator_id, folder_parent_id
                       FROM folders WHERE folder_id = ?");
  $st->execute([$folder_id]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

function db_has_children(PDO $pdo, int $folder_id): bool {
  $st = $pdo->prepare("SELECT 1 FROM folders WHERE folder_parent_id = ? LIMIT 1");
  $st->execute([$folder_id]);
  return (bool)$st->fetchColumn();
}

function db_list_children(PDO $pdo, int $parent_id): array {
  $st = $pdo->prepare("SELECT folder_id, folder_name, folder_description, creator_id, folder_parent_id
                       FROM folders
                       WHERE folder_parent_id = ?
                       ORDER BY folder_name");
  $st->execute([$parent_id]);
  return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

function db_get_folder_name(PDO $pdo, int $folder_id): string {
  $row = db_get_folder($pdo, $folder_id);
  if (!$row) folders_json_err(t('modal.sub_folders.err.folder_not_found.@', ['id' => $folder_id]), 404);
  return (string)$row['folder_name'];
}

// Recupero folder_name di research e wp (se già presenti negli array, li uso; altrimenti DB)
$res_folder_name = (string)($research['res_folder_name'] ?? '');
$wp_folder_name  = (string)($workpackage['wp_folder_name'] ?? '');

if ($res_folder_name === '') $res_folder_name = db_get_folder_name($pdo, $res_folder_id);
if ($wp_folder_name === '')  $wp_folder_name  = db_get_folder_name($pdo, $wp_folder_id);

// Coerenza gerarchia: la folder del WP deve avere parent = folder della research
$wp_folder_row = db_get_folder($pdo, $wp_folder_id);
if (!$wp_folder_row) folders_json_err(t('modal.sub_folders.err.wp_folder_not_found.@'), 404);

if ((int)($wp_folder_row['folder_parent_id'] ?? 0) !== $res_folder_id) {
  folders_json_err(t('modal.sub_folders.err.bad_hierarchy.@'), 409);
}

// Root FS
$BASE = folders_get_base_fs();

// ROUTING CORRETTO
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  $action = $_GET['action'] ?? '';
  if ($action === 'list') {
    $items = db_list_children($pdo, $wp_folder_id);
    folders_json_ok(['items' => $items]);
  }
  folders_json_err(t('modal.sub_folders.err.invalid_action', ['method' => 'GET']), 400);
}

// POST: action nel JSON body
if (!$canManageSubfolders) folders_json_err(t('errors.not_authorized'), 403);
$data = folders_read_json_body();
$action = (string)($data['action'] ?? '');

switch ($action) {

  case 'create': {
    $name = folders_normalize_name((string)($data['folder_name'] ?? ''));
    $desc = trim((string)($data['folder_description'] ?? ''));

    $creator = folders_current_user_id();

    // Path assoluto: BASE / research / wp / sub
    $abs = folders_abs_path_segments($BASE, $res_folder_name, $wp_folder_name, $name);

    // DB insert (folder_parent_id = wp_folder_id)
    try {
      $st = $pdo->prepare("INSERT INTO folders (folder_name, folder_description, creator_id, folder_parent_id)
                           VALUES (?, ?, ?, ?)");
      $st->execute([$name, $desc, $creator, $wp_folder_id]);
      $new_id = (int)$pdo->lastInsertId();
    } catch (PDOException $e) {
      if ((string)$e->getCode() === '23000') {
        folders_json_err(t('modal.sub_folders.err.duplicate.@'), 409);
      }
      folders_json_err(t('modal.sub_folders.err.db_create.@'), 500);
    }

    // FS create; se fallisce -> compensazione: elimina record DB
    folders_fs_create_abs($abs);

    $row = db_get_folder($pdo, $new_id);
    log_activity('folder:create', 'folder', $new_id, $name);
    folders_json_ok(['item' => $row]);
    break;
  }

  case 'update': {
    $folder_id = (int)($data['folder_id'] ?? 0);
    if ($folder_id <= 0) folders_json_err(t('modal.sub_folders.err.missing_param', ['name' => 'folder_id']), 400);

    $row = db_get_folder($pdo, $folder_id);
    if (!$row) folders_json_err(t('modal.sub_folders.err.not_found.@'), 404);

    if ((int)($row['folder_parent_id'] ?? 0) !== $wp_folder_id) {
      folders_json_err(t('modal.sub_folders.err.wrong_wp.@'), 403);
    }

    $old_name = (string)$row['folder_name'];
    $new_name = folders_normalize_name((string)($data['folder_name'] ?? $old_name));
    $new_desc = trim((string)($data['folder_description'] ?? (string)$row['folder_description']));

    $old_abs = folders_abs_path_segments($BASE, $res_folder_name, $wp_folder_name, $old_name);
    $new_abs = folders_abs_path_segments($BASE, $res_folder_name, $wp_folder_name, $new_name);

    try {
      $st = $pdo->prepare("UPDATE folders SET folder_name = ?, folder_description = ? WHERE folder_id = ?");
      $st->execute([$new_name, $new_desc, $folder_id]);
    } catch (PDOException $e) {
      if ((string)$e->getCode() === '23000') {
        folders_json_err(t('modal.sub_folders.err.duplicate.@'), 409);
      }
      folders_json_err(t('modal.sub_folders.err.db_update.@'), 500);
    }

    if ($new_name !== $old_name) {
      if (!is_dir($old_abs)) {
        $pdo->prepare("UPDATE folders SET folder_name = ? WHERE folder_id = ?")->execute([$old_name, $folder_id]);
        folders_json_err(t('modal.sub_folders.err.dir_not_found'), 500);
      }
      folders_fs_rename_abs($old_abs, $new_abs);
    }

    $updated = db_get_folder($pdo, $folder_id);
    log_activity('folder:edit', 'folder', $folder_id, $new_name);
    folders_json_ok(['item' => $updated]);
    break;
  }

  case 'delete': {
    $folder_id = (int)($data['folder_id'] ?? 0);
    if ($folder_id <= 0) folders_json_err(t('modal.sub_folders.err.missing_param', ['name' => 'folder_id']), 400);

    $row = db_get_folder($pdo, $folder_id);
    if (!$row) folders_json_err(t('modal.sub_folders.err.not_found.@'), 404);

    if ((int)($row['folder_parent_id'] ?? 0) !== $wp_folder_id) {
      folders_json_err(t('modal.sub_folders.err.wrong_wp.@'), 403);
    }

    if (db_has_children($pdo, $folder_id)) {
      folders_json_err(t('modal.sub_folders.err.has_children.@'), 409);
    }

    $name = (string)$row['folder_name'];
    $abs  = folders_abs_path_segments($BASE, $res_folder_name, $wp_folder_name, $name);

    if (!folders_fs_is_empty_abs($abs)) {
      folders_json_err(t('modal.sub_folders.err.not_empty.@'), 409);
    }

    folders_fs_remove_dir_abs($abs);

    $st = $pdo->prepare("DELETE FROM folders WHERE folder_id = ?");
    $st->execute([$folder_id]);

    log_activity('folder:delete', 'folder', $folder_id, $name);
    folders_json_ok(['deleted' => $folder_id]);
    break;
  }

  default:
    folders_json_err(t('modal.sub_folders.err.invalid_action', ['method' => 'POST']), 400);
}
