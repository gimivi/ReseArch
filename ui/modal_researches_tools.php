<?php
// ui/modal_researches_tools.php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/folders_tools.php';   // avvia anche la sessione
require_once __DIR__ . '/../api/i18n.php';            // messaggi nella lingua della richiesta

try {
  /** @var PDO $pdo */
  if (!isset($pdo) || !($pdo instanceof PDO)) {
    folders_json_err(t('modal.researches.err.db_unavailable'), 500);
  }

  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  $action = $_GET['action'] ?? null;

  // ---------------- LIST (GET) ----------------
  if ($method === 'GET' && $action === 'list') {
    $user = folders_current_user();
    $userId = (int)($user['id'] ?? $user['user_id'] ?? 0);
    $userType = (string)($user['user_type'] ?? '');

    if ($userId <= 0) folders_json_err(t('account.session_invalid'), 401);

    // Admin X: tutte. Altri: solo perm P.
    if ($userType === 'X') {
      $sql = "
        SELECT
          r.*,
          ur.perm AS res_perm,
          f.folder_name AS res_folder_name
        FROM researches r
        LEFT JOIN folders f ON f.folder_id = r.res_folder_id
        LEFT JOIN users_res_permissions ur
          ON ur.res_id = r.res_id
         AND ur.user_id = :uid
        ORDER BY r.res_title ASC
      ";
      $st = $pdo->prepare($sql);
      $st->execute([':uid' => $userId]);
      folders_json_ok($st->fetchAll(PDO::FETCH_ASSOC));
    } else {
      $sql = "
        SELECT
          r.*,
          ur.perm AS res_perm,
          f.folder_name AS res_folder_name
        FROM researches r
        JOIN users_res_permissions ur
          ON ur.res_id = r.res_id
         AND ur.user_id = :uid
         AND ur.perm = 'P'
        LEFT JOIN folders f ON f.folder_id = r.res_folder_id
        ORDER BY r.res_title ASC
      ";
      $st = $pdo->prepare($sql);
      $st->execute([':uid' => $userId]);
      folders_json_ok($st->fetchAll(PDO::FETCH_ASSOC));
    }
  }

  // ---------------- POST ROUTER ----------------
  $body = ($method === 'POST') ? folders_read_json_body() : [];
  $actionPost = $body['action'] ?? null;

  if ($method !== 'POST' || !$actionPost) {
    folders_json_err(t('errors.invalid_request'), 400);
  }

  $user = folders_current_user();
  $userId = (int)($user['id'] ?? $user['user_id'] ?? 0);
  $userType = (string)($user['user_type'] ?? '');

  if ($userId <= 0) folders_json_err(t('account.session_invalid'), 401);

  // Helper: check perm P su una ricerca (se non admin)
  $requirePi = function(int $resId) use ($pdo, $userType, $userId): void {
    if ($userType === 'X') return;
    $st = $pdo->prepare("SELECT 1 FROM users_res_permissions WHERE res_id=? AND user_id=? AND perm='P' LIMIT 1");
    $st->execute([$resId, $userId]);
    if (!$st->fetchColumn()) folders_json_err(t('modal.researches.err.need_pi.@'), 403);
  };

  // ---------------- CREATE ----------------
  if ($actionPost === 'create') {
    // FIX (2026-09-16): mancava il controllo lato server — il menu (ui/header.php,
    // $showRshCE) nasconde già "Crea research" a chi non è X/P, ma questo endpoint
    // era raggiungibile direttamente da chiunque fosse autenticato, che diventava
    // così PI (perm='P') della nuova research. Stesso controllo del menu, qui
    // applicato davvero.
    if (!in_array($userType, ['X', 'P'], true)) {
      folders_json_err(t('modal.researches.err.create_forbidden.@'), 403);
    }

    $res_title    = (string)($body['res_title'] ?? '');
    $res_subtitle = (string)($body['res_subtitle'] ?? '');
    $res_year     = (string)($body['res_year'] ?? '');
    if ($res_year !== '' && (!ctype_digit($res_year) || (int)$res_year < 1900 || (int)$res_year > 2200)) {
      folders_json_err(t('modal.researches.err.year_invalid'));
    }
    $res_abstract = (string)($body['res_abstract'] ?? '');
    $res_caption  = (string)($body['res_caption'] ?? '');
    $res_show     = max(0, min(5, (int)($body['res_show'] ?? 2)));  // scala 0-5 (5 = ospiti)

    $folder_name_raw = (string)($body['res_folder_name'] ?? '');
    $folder_name = folders_normalize_name($folder_name_raw, 30);

    $BASE_FS = folders_get_base_fs();

    // (mantengo check globale per evitare collisioni sul filesystem root)
    $st = $pdo->prepare("SELECT 1 FROM folders WHERE folder_name=? LIMIT 1");
    $st->execute([$folder_name]);
    if ($st->fetchColumn()) folders_json_err(t('modal.researches.err.folder_exists_db.@'));

    if (folders_fs_exists($BASE_FS, $folder_name)) {
      folders_json_err(t('modal.researches.err.folder_exists_fs.@'));
    }

    // FS prima del DB: se fallisce qui, folders_fs_create termina la
    // richiesta subito (nessuna riga DB è ancora stata scritta).
    folders_fs_create($BASE_FS, $folder_name);

    $pdo->beginTransaction();
    try {
      // Folder ricerca = root sotto BASE_FS => folder_parent_id NULL
      $st = $pdo->prepare("
        INSERT INTO folders (folder_name, folder_description, creator_id, folder_parent_id)
        VALUES (?, ?, ?, NULL)
      ");
      $st->execute([$folder_name, '', $userId]);
      $folder_id = (int)$pdo->lastInsertId();

      $st = $pdo->prepare("
        INSERT INTO researches
          (res_folder_id, res_title, res_subtitle, res_year, res_abstract, res_caption, res_show)
        VALUES
          (?, ?, ?, ?, ?, ?, ?)
      ");
      $st->execute([$folder_id, $res_title, $res_subtitle, $res_year, $res_abstract, $res_caption, $res_show]);
      $res_id = (int)$pdo->lastInsertId();

      $st = $pdo->prepare("INSERT INTO users_res_permissions (user_id, res_id, perm) VALUES (?, ?, 'P')");
      $st->execute([$userId, $res_id]);

      $pdo->commit();

      $st = $pdo->prepare("
        SELECT r.*, 'P' AS res_perm, f.folder_name AS res_folder_name
        FROM researches r
        LEFT JOIN folders f ON f.folder_id = r.res_folder_id
        WHERE r.res_id = ?
        LIMIT 1
      ");
      $st->execute([$res_id]);
      $row = $st->fetch(PDO::FETCH_ASSOC);
      folders_json_ok($row ?: ['res_id' => $res_id]);
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();

      // Compensazione: la cartella FS era già stata creata, ma il DB non è
      // andato a buon fine — la rimuoviamo per non lasciare orfani sul disco.
      $undone = folders_fs_compensate_remove($BASE_FS, $folder_name);
      $msg = $undone
        ? t('modal.researches.err.create_undone.@', ['error' => $e->getMessage()])
        : t('modal.researches.err.create_not_undone.@', ['error' => $e->getMessage()]);
      folders_json_err($msg, 500);
    }
  }

  // ---------------- UPDATE ----------------
  if ($actionPost === 'update') {
    $res_id = (int)($body['res_id'] ?? 0);
    if ($res_id <= 0) folders_json_err(t('modal.researches.err.res_id_missing'));

    $requirePi($res_id);

    $st = $pdo->prepare("
      SELECT r.res_id, r.res_folder_id, f.folder_name
      FROM researches r
      LEFT JOIN folders f ON f.folder_id = r.res_folder_id
      WHERE r.res_id=?
      LIMIT 1
    ");
    $st->execute([$res_id]);
    $cur = $st->fetch(PDO::FETCH_ASSOC);
    if (!$cur) folders_json_err(t('modal.researches.err.not_found.@'));

    $folder_id = (int)($cur['res_folder_id'] ?? 0);
    $old_folder_name = (string)($cur['folder_name'] ?? '');

    $res_title    = (string)($body['res_title'] ?? '');
    $res_subtitle = (string)($body['res_subtitle'] ?? '');
    $res_year     = (string)($body['res_year'] ?? '');
    if ($res_year !== '' && (!ctype_digit($res_year) || (int)$res_year < 1900 || (int)$res_year > 2200)) {
      folders_json_err(t('modal.researches.err.year_invalid'));
    }
    $res_abstract = (string)($body['res_abstract'] ?? '');
    $res_caption  = (string)($body['res_caption'] ?? '');
    $res_show     = max(0, min(5, (int)($body['res_show'] ?? 2)));  // scala 0-5 (5 = ospiti)

    $new_folder_name_raw = (string)($body['res_folder_name'] ?? $old_folder_name);
    $new_folder_name = folders_normalize_name($new_folder_name_raw, 30);

    $BASE_FS = folders_get_base_fs();

    if ($new_folder_name !== $old_folder_name) {
      $st = $pdo->prepare("SELECT 1 FROM folders WHERE folder_name=? AND folder_id<>? LIMIT 1");
      $st->execute([$new_folder_name, $folder_id]);
      if ($st->fetchColumn()) folders_json_err(t('modal.researches.err.folder_exists_db.@'));

      if (folders_fs_exists($BASE_FS, $new_folder_name)) {
        folders_json_err(t('modal.researches.err.folder_exists_fs.@'));
      }
    }

    // FS prima del DB: se fallisce qui, folders_fs_rename termina la
    // richiesta subito (il DB non è ancora stato toccato).
    $renamed = false;
    if ($new_folder_name !== $old_folder_name) {
      folders_fs_rename($BASE_FS, $old_folder_name, $new_folder_name);
      $renamed = true;
    }

    $pdo->beginTransaction();
    try {
      $st = $pdo->prepare("
        UPDATE researches
        SET res_title=?, res_subtitle=?, res_year=?, res_abstract=?, res_caption=?, res_show=?
        WHERE res_id=?
      ");
      $st->execute([$res_title, $res_subtitle, $res_year, $res_abstract, $res_caption, $res_show, $res_id]);

      if ($new_folder_name !== $old_folder_name) {
        $st = $pdo->prepare("UPDATE folders SET folder_name=? WHERE folder_id=?");
        $st->execute([$new_folder_name, $folder_id]);
      }

      $pdo->commit();
      folders_json_ok(['res_id' => $res_id]);
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();

      $msg = t('modal.researches.err.update', ['error' => $e->getMessage()]);
      if ($renamed) {
        // Compensazione: la cartella era già stata rinominata sul FS, ma il
        // DB non è andato a buon fine — riportiamo il nome originale.
        $undone = folders_fs_compensate_rename($BASE_FS, $new_folder_name, $old_folder_name);
        $msg = $undone
          ? t('modal.researches.err.update_undone.@', ['error' => $e->getMessage()])
          : t('modal.researches.err.update_not_undone.@', ['error' => $e->getMessage(), 'folder' => $new_folder_name]);
      }
      folders_json_err($msg, 500);
    }
  }

  // ---------------- DELETE ----------------
  if ($actionPost === 'delete') {
    $res_id = (int)($body['res_id'] ?? 0);
    if ($res_id <= 0) folders_json_err(t('modal.researches.err.res_id_missing'));

    $requirePi($res_id);

    $st = $pdo->prepare("SELECT COUNT(*) FROM workpackages WHERE res_id=?");
    $st->execute([$res_id]);
    if ((int)$st->fetchColumn() > 0) {
      folders_json_err(t('modal.researches.err.has_workpackages.@'));
    }

    $st = $pdo->prepare("
      SELECT r.res_folder_id, f.folder_name
      FROM researches r
      LEFT JOIN folders f ON f.folder_id = r.res_folder_id
      WHERE r.res_id=?
      LIMIT 1
    ");
    $st->execute([$res_id]);
    $cur = $st->fetch(PDO::FETCH_ASSOC);
    if (!$cur) folders_json_err(t('modal.researches.err.not_found.@'));

    $folder_id = (int)($cur['res_folder_id'] ?? 0);
    $folder_name = (string)($cur['folder_name'] ?? '');
    if ($folder_id <= 0 || $folder_name === '') folders_json_err(t('modal.researches.err.folder_invalid_linked.@'));

    $BASE_FS = folders_get_base_fs();

    if (!folders_fs_is_empty($BASE_FS, $folder_name)) {
      folders_json_err(t('modal.researches.err.folder_not_empty.@'));
    }

    // FS prima del DB: la cartella è già stata verificata vuota sopra, quindi
    // la rimozione è sicura e reversibile (ricreabile vuota se il DB fallisce).
    // Se fallisce qui, folders_fs_remove_dir termina subito la richiesta
    // (il DB non è ancora stato toccato).
    folders_fs_remove_dir($BASE_FS, $folder_name);

    $pdo->beginTransaction();
    try {
      $st = $pdo->prepare("DELETE FROM users_res_permissions WHERE res_id=?");
      $st->execute([$res_id]);

      $st = $pdo->prepare("DELETE FROM res_res_permissions WHERE res_requester=? OR res_granter=?");
      $st->execute([$res_id, $res_id]);

      // eventi legati alla ricerca (nessuna FOREIGN KEY)
      $pdo->prepare("DELETE FROM events WHERE res_id=?")->execute([$res_id]);

      $st = $pdo->prepare("DELETE FROM researches WHERE res_id=?");
      $st->execute([$res_id]);

      $st = $pdo->prepare("DELETE FROM folders WHERE folder_id=?");
      $st->execute([$folder_id]);

      $pdo->commit();
      folders_json_ok(['res_id' => $res_id]);
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();

      // Compensazione: la cartella FS era già stata rimossa, ma il DB non è
      // andato a buon fine — la ricreiamo (vuota) per non perdere il riferimento.
      $undone = folders_fs_compensate_create($BASE_FS, $folder_name);
      $msg = $undone
        ? t('modal.researches.err.delete_undone.@', ['error' => $e->getMessage()])
        : t('modal.researches.err.delete_not_undone.@', ['error' => $e->getMessage()]);
      folders_json_err($msg, 500);
    }
  }

  folders_json_err(t('errors.invalid_request'), 400);

} catch (Throwable $e) {
  folders_json_err(t('modal.researches.err.server', ['error' => $e->getMessage()]), 500);
}
