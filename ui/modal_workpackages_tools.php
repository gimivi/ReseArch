<?php
// ui/modal_workpackages_tools.php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/folders_tools.php';   // avvia anche la sessione
require_once __DIR__ . '/../api/i18n.php';

function wp_json_ok($data = null): void {
  echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
  exit;
}
function wp_json_err(string $msg, int $code = 400): void {
  http_response_code($code);
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

function wp_read_json_body(): array {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}

function wp_require_session_user(): array {
  if (session_status() === PHP_SESSION_NONE) @session_start();
  if (!isset($_SESSION['user']) || !is_array($_SESSION['user'])) wp_json_err(t('errors.not_authenticated'), 401);
  return $_SESSION['user'];
}

function wp_res_base_path(string $BASE_FS, string $res_folder_name): string {
  folders_assert_safe_segment($res_folder_name);
  return rtrim($BASE_FS, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $res_folder_name;
}

function wp_wp_path(string $BASE_FS, string $res_folder_name, string $wp_folder_name): string {
  folders_assert_safe_segment($res_folder_name);
  folders_assert_safe_segment($wp_folder_name);
  return rtrim($BASE_FS, DIRECTORY_SEPARATOR)
       . DIRECTORY_SEPARATOR . $res_folder_name
       . DIRECTORY_SEPARATOR . $wp_folder_name;
}

function wp_dir_is_empty(string $path): bool {
  if (!is_dir($path)) return true;
  $it = @scandir($path);
  if ($it === false) wp_json_err(t('modal.workpackages.error.dir_read.@'));
  foreach ($it as $e) {
    if ($e === '.' || $e === '..') continue;
    return false;
  }
  return true;
}
function wp_dir_create(string $path): void {
  if (is_dir($path)) wp_json_err(t('modal.workpackages.error.dir_exists_fs.@'));
  if (!@mkdir($path, 0775, true)) wp_json_err(t('modal.workpackages.error.dir_create.@'));
}
function wp_dir_rename(string $oldPath, string $newPath): void {
  if (!is_dir($oldPath)) wp_json_err(t('modal.workpackages.error.dir_rename_missing.@'));
  if (is_dir($newPath)) wp_json_err(t('modal.workpackages.error.dir_rename_exists.@'));
  if (!@rename($oldPath, $newPath)) wp_json_err(t('modal.workpackages.error.dir_rename.@'));
}
function wp_dir_remove(string $path): void {
  if (!is_dir($path)) return;
  if (!@rmdir($path)) wp_json_err(t('modal.workpackages.error.dir_remove.@'));
}

try {
  /** @var PDO $pdo */
  if (!isset($pdo) || !($pdo instanceof PDO)) wp_json_err(t('modal.workpackages.error.db_unavailable'), 500);

  $user = wp_require_session_user();
  $userId = (int)($user['id'] ?? $user['user_id'] ?? 0);
  $userType = (string)($user['user_type'] ?? '');

  if ($userId <= 0) wp_json_err(t('modal.workpackages.error.session_invalid'), 401);

  if (!isset($_SESSION['res_id'])) wp_json_err(t('modal.workpackages.error.no_research.@'), 400);
  $resId = (int)$_SESSION['res_id'];

  // Ricavo res_perm, res_folder_name e res_folder_id dalla sessione research se presente, altrimenti query
  $resPerm = '';
  $resFolderName = '';
  $resFolderId = 0;

  if (isset($_SESSION['research']) && is_array($_SESSION['research'])) {
    $resPerm = (string)($_SESSION['research']['res_perm'] ?? $_SESSION['research']['perm'] ?? '');
    $resFolderName = (string)($_SESSION['research']['res_folder_name'] ?? '');
    $resFolderId = (int)($_SESSION['research']['res_folder_id'] ?? 0);
  }

  if ($resFolderName === '' || $resFolderId <= 0) {
    $st = $pdo->prepare("
      SELECT r.res_folder_id, f.folder_name
      FROM researches r
      LEFT JOIN folders f ON f.folder_id = r.res_folder_id
      WHERE r.res_id = ?
      LIMIT 1
    ");
    $st->execute([$resId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    $resFolderId = (int)($row['res_folder_id'] ?? 0);
    $resFolderName = (string)($row['folder_name'] ?? '');
  }

  if ($resPerm === '' && $userType !== 'X') {
    $st = $pdo->prepare("SELECT perm FROM users_res_permissions WHERE res_id=? AND user_id=? LIMIT 1");
    $st->execute([$resId, $userId]);
    $resPerm = (string)($st->fetchColumn() ?: '');
  }

  if ($resFolderName === '' || $resFolderId <= 0) wp_json_err(t('modal.workpackages.error.res_folder.@'), 500);

  $BASE_FS = folders_get_base_fs();
  $resBasePath = wp_res_base_path($BASE_FS, $resFolderName);

  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  $actionGet = $_GET['action'] ?? '';

  // ---------------- LIST ----------------
  if ($method === 'GET' && $actionGet === 'list') {
    $canSeeAll = ($userType === 'X' || $resPerm === 'P');

    if ($canSeeAll) {
      $sql = "
        SELECT
          w.*,
          uw.perm AS wp_perm,
          f.folder_name AS wp_folder_name
        FROM workpackages w
        LEFT JOIN users_wp_permissions uw
          ON uw.wp_id = w.wp_id AND uw.user_id = :uid
        LEFT JOIN folders f
          ON f.folder_id = w.wp_folder_id
        WHERE w.res_id = :rid
        ORDER BY w.wp_ord ASC, w.wp_title ASC
      ";
      $st = $pdo->prepare($sql);
      $st->execute([':uid' => $userId, ':rid' => $resId]);
      wp_json_ok($st->fetchAll(PDO::FETCH_ASSOC));
    } else {
      $sql = "
        SELECT
          w.*,
          uw.perm AS wp_perm,
          f.folder_name AS wp_folder_name
        FROM workpackages w
        JOIN users_wp_permissions uw
          ON uw.wp_id = w.wp_id
         AND uw.user_id = :uid
         AND uw.perm = 'W'
        LEFT JOIN folders f
          ON f.folder_id = w.wp_folder_id
        WHERE w.res_id = :rid
        ORDER BY w.wp_ord ASC, w.wp_title ASC
      ";
      $st = $pdo->prepare($sql);
      $st->execute([':uid' => $userId, ':rid' => $resId]);
      wp_json_ok($st->fetchAll(PDO::FETCH_ASSOC));
    }
  }

  // ---------------- POST ROUTER ----------------
  $body = ($method === 'POST') ? wp_read_json_body() : [];
  $action = (string)($body['action'] ?? '');
  if ($method !== 'POST' || $action === '') wp_json_err(t('errors.invalid_request'), 400);

  $canEditAll = ($userType === 'X' || $resPerm === 'P');

  //Questo Flag lo hai aggiunto tu perchè il WP Leader poteva editare e cancellare WP ma non crearli. Vedi inserimento del Flag in Create
  // Solo che tutte le policy di accesso andrebbero riviste nel loro insieme.
  $isWpLeader = ($resPerm === 'W');

  $requireWpLeader = function(int $wpId) use ($pdo, $userId, $canEditAll): void {
    if ($canEditAll) return;
    $st = $pdo->prepare("SELECT 1 FROM users_wp_permissions WHERE user_id=? AND wp_id=? AND perm='W' LIMIT 1");
    $st->execute([$userId, $wpId]);
    if (!$st->fetchColumn()) wp_json_err(t('modal.workpackages.error.need_wpl.@'), 403);
  };

  // ---------------- CREATE ----------------
  if ($action === 'create') {
    //if (!$canEditAll ) wp_json_err('Permesso negato: solo Admin o PI possono creare WP.', 403);
    if (!$canEditAll && !$isWpLeader) wp_json_err(t('modal.workpackages.error.create_denied.@'), 403);

    $wp_title    = (string)($body['wp_title'] ?? '');
    $wp_subtitle = (string)($body['wp_subtitle'] ?? '');
    $wp_abstract = (string)($body['wp_abstract'] ?? '');
    $wp_caption  = (string)($body['wp_caption'] ?? '');
    $wp_ord      = (int)($body['wp_ord'] ?? 0);
    $wp_show     = max(0, min(5, (int)($body['wp_show'] ?? 1)));  // scala 0-5 (5 = ospiti)
    $wp_share    = (int)($body['wp_share'] ?? 0);

    $wp_folder_name_raw = (string)($body['wp_folder_name'] ?? '');
    $wp_folder_name = folders_normalize_name($wp_folder_name_raw, 30);

    // Unicità tra i figli della folder della research
    $st = $pdo->prepare("SELECT 1 FROM folders WHERE folder_parent_id=? AND folder_name=? LIMIT 1");
    $st->execute([$resFolderId, $wp_folder_name]);
    if ($st->fetchColumn()) wp_json_err(t('modal.workpackages.error.folder_exists_db.@'));

    $wpPath = wp_wp_path($BASE_FS, $resFolderName, $wp_folder_name);
    if (is_dir($wpPath)) wp_json_err(t('modal.workpackages.error.dir_exists_server.@'));

    $pdo->beginTransaction();
    try {
      // folder_parent_id = res_folder_id
      $st = $pdo->prepare("
        INSERT INTO folders (folder_name, folder_description, creator_id, folder_parent_id)
        VALUES (?, ?, ?, ?)
      ");
      $st->execute([$wp_folder_name, '', $userId, $resFolderId]);
      $folder_id = (int)$pdo->lastInsertId();

      if (!is_dir($resBasePath)) {
        if (!@mkdir($resBasePath, 0775, true)) wp_json_err(t('modal.workpackages.error.res_dir_create.@'));
      }
      wp_dir_create($wpPath);

      $st = $pdo->prepare("
        INSERT INTO workpackages
          (res_id, wp_folder_id, wp_title, wp_subtitle, wp_abstract, wp_caption, wp_ord, wp_show, wp_share)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ");
      $st->execute([$resId, $folder_id, $wp_title, $wp_subtitle, $wp_abstract, $wp_caption, $wp_ord, $wp_show, $wp_share]);
      $wp_id = (int)$pdo->lastInsertId();

      $st = $pdo->prepare("INSERT INTO users_wp_permissions (user_id, wp_id, perm) VALUES (?, ?, 'W')");
      $st->execute([$userId, $wp_id]);

      $pdo->commit();

      $st = $pdo->prepare("
        SELECT w.*, 'W' AS wp_perm, f.folder_name AS wp_folder_name
        FROM workpackages w
        LEFT JOIN folders f ON f.folder_id = w.wp_folder_id
        WHERE w.wp_id = ?
        LIMIT 1
      ");
      $st->execute([$wp_id]);
      $row = $st->fetch(PDO::FETCH_ASSOC);
      wp_json_ok($row ?: ['wp_id' => $wp_id]);
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      wp_json_err(t('modal.workpackages.error.create_failed.@', ['msg' => $e->getMessage()]), 500);
    }
  }

  // ---------------- UPDATE ----------------
  if ($action === 'update') {
    $wp_id = (int)($body['wp_id'] ?? 0);
    if ($wp_id <= 0) wp_json_err(t('modal.workpackages.error.missing_wp_id'));

    $requireWpLeader($wp_id);

    $st = $pdo->prepare("
      SELECT w.wp_id, w.res_id, w.wp_folder_id, f.folder_name
      FROM workpackages w
      LEFT JOIN folders f ON f.folder_id = w.wp_folder_id
      WHERE w.wp_id = ?
      LIMIT 1
    ");
    $st->execute([$wp_id]);
    $cur = $st->fetch(PDO::FETCH_ASSOC);
    if (!$cur) wp_json_err(t('modal.workpackages.error.wp_not_found.@'));
    if ((int)$cur['res_id'] !== $resId) wp_json_err(t('modal.workpackages.error.wp_other_research.@'), 403);

    $old_folder_name = (string)($cur['folder_name'] ?? '');
    $folder_id = (int)($cur['wp_folder_id'] ?? 0);

    $wp_title    = (string)($body['wp_title'] ?? '');
    $wp_subtitle = (string)($body['wp_subtitle'] ?? '');
    $wp_abstract = (string)($body['wp_abstract'] ?? '');
    $wp_caption  = (string)($body['wp_caption'] ?? '');
    $wp_ord      = (int)($body['wp_ord'] ?? 0);
    $wp_show     = max(0, min(5, (int)($body['wp_show'] ?? 1)));  // scala 0-5 (5 = ospiti)
    $wp_share    = (int)($body['wp_share'] ?? 0);

    $new_folder_raw = (string)($body['wp_folder_name'] ?? $old_folder_name);
    $new_folder_name = folders_normalize_name($new_folder_raw, 30);

    if ($new_folder_name !== $old_folder_name) {
      $st = $pdo->prepare("
        SELECT 1 FROM folders
        WHERE folder_parent_id=? AND folder_name=? AND folder_id<>?
        LIMIT 1
      ");
      $st->execute([$resFolderId, $new_folder_name, $folder_id]);
      if ($st->fetchColumn()) wp_json_err(t('modal.workpackages.error.folder_exists_db.@'));

      $newPath = wp_wp_path($BASE_FS, $resFolderName, $new_folder_name);
      if (is_dir($newPath)) wp_json_err(t('modal.workpackages.error.dir_exists_server.@'));
    }

    $pdo->beginTransaction();
    try {
      $st = $pdo->prepare("
        UPDATE workpackages
        SET wp_title=?, wp_subtitle=?, wp_abstract=?, wp_caption=?, wp_ord=?, wp_show=?, wp_share=?
        WHERE wp_id=?
      ");
      $st->execute([$wp_title, $wp_subtitle, $wp_abstract, $wp_caption, $wp_ord, $wp_show, $wp_share, $wp_id]);

      if ($new_folder_name !== $old_folder_name) {
        $oldPath = wp_wp_path($BASE_FS, $resFolderName, $old_folder_name);
        $newPath = wp_wp_path($BASE_FS, $resFolderName, $new_folder_name);
        wp_dir_rename($oldPath, $newPath);

        $st = $pdo->prepare("UPDATE folders SET folder_name=? WHERE folder_id=?");
        $st->execute([$new_folder_name, $folder_id]);
      }

      $pdo->commit();
      wp_json_ok(['wp_id' => $wp_id]);
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      wp_json_err(t('modal.workpackages.error.update_failed.@', ['msg' => $e->getMessage()]), 500);
    }
  }

  // ---------------- DELETE ----------------
  if ($action === 'delete') {
    $wp_id = (int)($body['wp_id'] ?? 0);
    if ($wp_id <= 0) wp_json_err(t('modal.workpackages.error.missing_wp_id'));

    $requireWpLeader($wp_id);

    $st = $pdo->prepare("
      SELECT w.wp_id, w.res_id, w.wp_folder_id, f.folder_name
      FROM workpackages w
      LEFT JOIN folders f ON f.folder_id = w.wp_folder_id
      WHERE w.wp_id = ?
      LIMIT 1
    ");
    $st->execute([$wp_id]);
    $cur = $st->fetch(PDO::FETCH_ASSOC);
    if (!$cur) wp_json_err(t('modal.workpackages.error.wp_not_found.@'));
    if ((int)$cur['res_id'] !== $resId) wp_json_err(t('modal.workpackages.error.wp_other_research.@'), 403);

    $folder_id = (int)($cur['wp_folder_id'] ?? 0);
    $folder_name = (string)($cur['folder_name'] ?? '');
    if ($folder_id <= 0 || $folder_name === '') wp_json_err(t('modal.workpackages.error.wp_folder_invalid.@'));

    // NEW: blocco se esistono subfolder figlie nel DB
    $st = $pdo->prepare("SELECT 1 FROM folders WHERE folder_parent_id=? LIMIT 1");
    $st->execute([$folder_id]);
    if ($st->fetchColumn()) {
      wp_json_err(t('modal.workpackages.error.delete_has_subfolders.@'));
    }

    $st = $pdo->prepare("SELECT COUNT(*) FROM objects WHERE wp_id=?");
    $st->execute([$wp_id]);
    $objCount = (int)$st->fetchColumn();

    $st = $pdo->prepare("SELECT COUNT(*) FROM models WHERE wp_id=?");
    $st->execute([$wp_id]);
    $modCount = (int)$st->fetchColumn();

    if ($objCount > 0 && $modCount > 0) {
      wp_json_err(t('modal.workpackages.error.delete_linked_both.@', ['objects' => $objCount, 'models' => $modCount]));
    } elseif ($objCount > 0) {
      wp_json_err(t('modal.workpackages.error.delete_linked_objects.@', ['objects' => $objCount]));
    } elseif ($modCount > 0) {
      wp_json_err(t('modal.workpackages.error.delete_linked_models.@', ['models' => $modCount]));
    }

    // I flow sono contenuti come oggetti e modelli: vanno eliminati (o spostati) prima
    $st = $pdo->prepare("SELECT COUNT(*) FROM flows WHERE flow_wp=?");
    $st->execute([$wp_id]);
    $flowCount = (int)$st->fetchColumn();
    if ($flowCount > 0) {
      wp_json_err(t('modal.workpackages.error.delete_linked_flows.@', ['flows' => $flowCount]));
    }

    $wpPath = wp_wp_path($BASE_FS, $resFolderName, $folder_name);
    if (!wp_dir_is_empty($wpPath)) {
      wp_json_err(t('modal.workpackages.error.delete_dir_not_empty.@'));
    }

    wp_dir_remove($wpPath);

    $pdo->beginTransaction();
    try {
      $st = $pdo->prepare("DELETE FROM users_wp_permissions WHERE wp_id=?");
      $st->execute([$wp_id]);

      // Configurazioni della dashboard, loro collegamenti ai flow ed eventi del WP
      // (nessuna FOREIGN KEY: altrimenti restano orfani, vedi api/db_maintenance_tool.php)
      $pdo->prepare("DELETE c FROM object_flows_connections c JOIN wp_dashboard_configs d ON d.dshp_id = c.target_id
                     WHERE c.flow_type = 'dashboard' AND d.dshp_wp = ?")->execute([$wp_id]);
      $pdo->prepare("DELETE FROM wp_dashboard_configs WHERE dshp_wp=?")->execute([$wp_id]);
      $pdo->prepare("DELETE FROM events WHERE wp_id=?")->execute([$wp_id]);

      $st = $pdo->prepare("DELETE FROM workpackages WHERE wp_id=?");
      $st->execute([$wp_id]);

      $st = $pdo->prepare("DELETE FROM folders WHERE folder_id=?");
      $st->execute([$folder_id]);

      $pdo->commit();
      wp_json_ok(['wp_id' => $wp_id]);
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      wp_json_err(t('modal.workpackages.error.delete_failed.@', ['msg' => $e->getMessage()]), 500);
    }
  }

  wp_json_err(t('errors.invalid_request'), 400);

} catch (Throwable $e) {
  wp_json_err(t('modal.workpackages.error.server', ['msg' => $e->getMessage()]), 500);
}
