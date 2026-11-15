<?php
// modal_objmod_links_tools.php (UPDATED: new tables + scope rules)
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

require_once __DIR__ . '/../api/i18n.php';   // messaggi nella lingua della richiesta
require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/folders_tools.php';
require_once __DIR__ . '/../api/log_tool.php';
require_once __DIR__ . '/../api/edit_rights.php';

function json_ok($data = null): void {
  echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
  exit;
}
function json_err(string $msg, int $code = 400): void {
  http_response_code($code);
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}
function read_json_body(): array {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}

// ---- DB ----
if (!isset($pdo) || !($pdo instanceof PDO)) {
  json_err(t('modal.objmod_links.err.db_unavailable'), 500);
}

// ---- Session context ----
$research = $_SESSION['research'] ?? null;
$workpackage = $_SESSION['workpackage'] ?? null;
if (!is_array($research) || !is_array($workpackage)) {
  json_err(t('modal.objmod_links.err.no_context.@'), 500);
}

$user = folders_current_user();
$resPerm = $research['res_perm'] ?? $research['perm'] ?? null;
$wpPerm  = $workpackage['wp_perm'] ?? $workpackage['perm'] ?? null;

$res_id = (int)($research['res_id'] ?? 0);
$wp_id  = (int)($workpackage['wp_id'] ?? 0);

if ($res_id <= 0 || $wp_id <= 0) {
  json_err(t('modal.objmod_links.err.no_session_ids'), 500);
}

// ── Doppio share (2026-10-10, passo 4 di _doc/arch-permessi.md §11.6) ─────────
// Un collegamento si crea o si toglie solo se lo consentono sia il bersaglio
// (oggetto: obj_share; configurazione della dashboard: chi la modifica, X/P/W e l'autore)
// sia il modello o flow collegato (mod_share / flow_share). Regole in api/edit_rights.php.
// Gli elenchi mostrano ciò che l'utente può collegare, più ciò che è già collegato
// (in sola lettura se non può toglierlo); ogni riga porta can_link.
$userId       = (int)($user['id'] ?? 0);
$editScope    = ra_edit_scope($pdo, $user);
$IS_WP_EDITOR = ra_scope_is_wp_editor($editScope, $wp_id, $res_id);

/** L'oggetto del WP corrente accetta collegamenti dall'utente? */
function links_obj_accepts(int $obj_id, int $obj_share): bool {
  global $editScope, $wp_id, $res_id, $resPerm, $wpPerm;
  $canEdit = ra_scope_can_edit($editScope, 'object', $obj_id, $wp_id, $res_id);
  return ra_obj_accepts_link($canEdit, $obj_share, $resPerm, $wpPerm);
}

/** obj_share dell'oggetto, che deve appartenere al WP corrente (altrimenti 403). */
function links_obj_share(PDO $pdo, int $obj_id, int $wp_id): int {
  $st = $pdo->prepare("SELECT obj_share FROM objects WHERE obj_id = ? AND wp_id = ? LIMIT 1");
  $st->execute([$obj_id, $wp_id]);
  $v = $st->fetchColumn();
  if ($v === false) json_err(t('modal.objmod_links.err.object_not_in_wp.@'), 403);
  return (int)$v;
}

/** Riga di modello con mod_id, wp_id, res_id, mod_share: l'utente lo collega? */
function links_model_linkable(array $m): bool {
  global $editScope, $user, $wp_id, $res_id, $resPerm, $wpPerm;
  $mWp = (int)$m['wp_id']; $mRes = (int)$m['res_id'];
  $owner = ra_scope_can_edit($editScope, 'model', (int)$m['mod_id'], $mWp, $mRes);
  return ra_item_linkable($owner, (int)$m['mod_share'], $mWp === $wp_id, $mRes === $res_id, $user, $resPerm, $wpPerm);
}

/** Riga di flow con flow_wp, res_id, flow_share, author_id: l'utente lo collega? (flow: solo autore e X, §8ter) */
function links_flow_linkable(array $f): bool {
  global $editScope, $userId, $user, $wp_id, $res_id, $resPerm, $wpPerm;
  $owner = $editScope['x'] || ($userId > 0 && (int)($f['author_id'] ?? 0) === $userId);
  return ra_item_linkable($owner, (int)$f['flow_share'], (int)$f['flow_wp'] === $wp_id, (int)$f['res_id'] === $res_id, $user, $resPerm, $wpPerm);
}

/**
 * Filtra le righe di un elenco: restano quelle collegabili e quelle già collegate;
 * can_link = il bersaglio accetta E la riga è collegabile.
 */
function links_filter_rows(array $rows, bool $targetAccepts, callable $linkable): array {
  $out = [];
  foreach ($rows as $r) {
    $ok = $linkable($r);
    if (!$ok && empty($r['linked'])) continue;
    $r['can_link'] = $targetAccepts && $ok;
    unset($r['author_id']);
    $out[] = $r;
  }
  return $out;
}

/** Flow di tipo $type candidati per il bersaglio $target_id, nell'ambito $scope (wp|res|global). */
function links_list_flows(PDO $pdo, string $type, int $target_id, string $scope): array {
  global $wp_id, $res_id;
  $sql = "
    SELECT
      f.flow_id,
      f.flow_wp,
      wpf.res_id,
      f.flow_name,
      f.flow_description,
      f.flow_share,
      f.author_id,
      f.updated_at,
      CASE WHEN c.id IS NULL THEN 0 ELSE 1 END AS linked
    FROM flows f
    INNER JOIN workpackages wpf ON wpf.wp_id = f.flow_wp
    LEFT JOIN object_flows_connections c
      ON c.flow_id = f.flow_id AND c.flow_type = ? AND c.target_id = ?
    WHERE f.flow_type = ?
  ";
  $params = [$type, $target_id, $type];

  // Ambiti: dove sta il flow. Chi lo collega lo decide links_flow_linkable().
  if ($scope === 'wp') {
    $sql .= " AND f.flow_wp = ? ";
    $params[] = $wp_id;
  } elseif ($scope === 'res') {
    $sql .= " AND wpf.res_id = ? ";
    $params[] = $res_id;
  } elseif ($scope === 'global') {
    $sql .= " AND f.flow_share >= 3 ";
  } else {
    json_err(t('modal.objmod_links.err.invalid_scope'), 400);
  }

  $sql .= " ORDER BY f.flow_id DESC ";
  $st = $pdo->prepare($sql);
  $st->execute($params);
  return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

/** Flow $flow_id di tipo $type con i campi per links_flow_linkable(); null se non esiste. */
function links_load_flow(PDO $pdo, int $flow_id, string $type): ?array {
  $st = $pdo->prepare("
    SELECT f.flow_id, f.flow_wp, wpf.res_id, f.flow_share, f.author_id
    FROM   flows f
    JOIN   workpackages wpf ON wpf.wp_id = f.flow_wp
    WHERE  f.flow_id = ? AND f.flow_type = ?
    LIMIT 1");
  $st->execute([$flow_id, $type]);
  return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}

/** Modello $mod_id con i campi per links_model_linkable(); null se non esiste. */
function links_load_model(PDO $pdo, int $mod_id): ?array {
  $st = $pdo->prepare("
    SELECT m.mod_id, m.wp_id, wpm.res_id, m.mod_share
    FROM   models m
    JOIN   workpackages wpm ON wpm.wp_id = m.wp_id
    WHERE  m.mod_id = ?
    LIMIT 1");
  $st->execute([$mod_id]);
  return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}

/**
 * Controlla, prima di scrivere, che ogni id aggiunto o tolto sia collegabile dall'utente.
 * Un elemento che non esiste più si può solo togliere (collegamento orfano).
 */
function links_assert_linkable(array $added, array $removed, callable $load, callable $linkable, string $errKey): void {
  foreach ([[$added, true], [$removed, false]] as [$ids, $mustExist]) {
    foreach ($ids as $id) {
      if ($id <= 0) continue;
      $row = $load($id);
      if ($row === null) {
        if ($mustExist) json_err(t($errKey, ['id' => $id]), 403);
        continue;
      }
      if (!$linkable($row)) json_err(t($errKey, ['id' => $id]), 403);
    }
  }
}

$action = $_GET['action'] ?? null;
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// -------- GET list_objects (solo WP corrente) --------
if ($method === 'GET' && $action === 'list_objects') {
  $st = $pdo->prepare("
    SELECT obj_id, wp_id, obj_name, obj_description, obj_type_A, obj_type_B, obj_app, obj_show, obj_share
    FROM objects
    WHERE wp_id = ?
    ORDER BY obj_id DESC
  ");
  $st->execute([$wp_id]);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
  foreach ($rows as &$r) {
    $r['can_link'] = links_obj_accepts((int)$r['obj_id'], (int)$r['obj_share']);
  }
  unset($r);
  json_ok($rows);
}

// -------- GET list_models (scope + linked per obj_id) --------
if ($method === 'GET' && $action === 'list_models') {
  $scope = (string)($_GET['scope'] ?? 'wp'); // wp|res|global
  $obj_id = (int)($_GET['obj_id'] ?? 0);
  if ($obj_id <= 0) json_err(t('modal.objmod_links.err.missing_param', ['param' => 'obj_id']), 400);

  $objAccepts = links_obj_accepts($obj_id, links_obj_share($pdo, $obj_id, $wp_id));

  // NB: folder_name = nome della SUBFOLDER root (mod_folder_id)
  // mod_filename può contenere path relativo (con /) nel tuo nuovo sistema
  $sql = "
    SELECT
      m.mod_id,
      m.wp_id,
      wpm.res_id,
      m.mod_folder_id,
      m.mod_name,
      m.mod_description,
      m.mod_filename,
      m.mod_share,
      f.folder_name,
      CASE WHEN c.id IS NULL THEN 0 ELSE 1 END AS linked
    FROM models m
    INNER JOIN workpackages wpm ON wpm.wp_id = m.wp_id
    LEFT JOIN folders f ON f.folder_id = m.mod_folder_id
    LEFT JOIN object_models_connections c
      ON c.mod_id = m.mod_id AND c.obj_id = ?
  ";

  $params = [$obj_id];

  // Ambiti: dove sta il modello. Chi lo collega lo decide links_model_linkable().
  if ($scope === 'wp') {
    $sql .= " WHERE m.wp_id = ? ";
    $params[] = $wp_id;
  } elseif ($scope === 'res') {
    $sql .= " WHERE wpm.res_id = ? ";
    $params[] = $res_id;
  } elseif ($scope === 'global') {
    $sql .= " WHERE m.mod_share >= 3 ";
  } else {
    json_err(t('modal.objmod_links.err.invalid_scope'), 400);
  }

  $sql .= " ORDER BY m.mod_id DESC ";

  $st = $pdo->prepare($sql);
  $st->execute($params);
  json_ok(links_filter_rows($st->fetchAll(PDO::FETCH_ASSOC) ?: [], $objAccepts, 'links_model_linkable'));
}

// -------- GET list_flows_for_object (scope + linked per obj_id) --------
// Mirror di list_models, ma su flows/object_flows_connections
// (flow_type='object', flow_share al posto di mod_share).
if ($method === 'GET' && $action === 'list_flows_for_object') {
  $scope = (string)($_GET['scope'] ?? 'wp'); // wp|res|global
  $obj_id = (int)($_GET['obj_id'] ?? 0);
  if ($obj_id <= 0) json_err(t('modal.objmod_links.err.missing_param', ['param' => 'obj_id']), 400);

  $objAccepts = links_obj_accepts($obj_id, links_obj_share($pdo, $obj_id, $wp_id));
  json_ok(links_filter_rows(links_list_flows($pdo, 'object', $obj_id, $scope), $objAccepts, 'links_flow_linkable'));
}

// ===== Bersaglio "Dashboard" (2026-10-04, _doc/arch-flow-dashboard.md §7) =====
// Stesso schema del bersaglio "Oggetti": sopra le Dashboard Config del WP, sotto i
// flow dashboard, collegati in object_flows_connections (flow_type='dashboard',
// target_id = dshp_id). Stessi ambiti e soglie flow_share dei flow dell'oggetto.

/** dshp_id deve appartenere al WP corrente. Ritorna l'autore (dshp_usr). */
function links_assert_dshp_in_wp(PDO $pdo, int $dshp_id, int $wp_id): int {
  $st = $pdo->prepare("SELECT dshp_usr FROM wp_dashboard_configs WHERE dshp_id = ? AND dshp_wp = ? LIMIT 1");
  $st->execute([$dshp_id, $wp_id]);
  $usr = $st->fetchColumn();
  if ($usr === false) json_err(t('modal.objmod_links.err.dashboard_not_in_wp.@'), 403);
  return (int)$usr;
}

// -------- GET list_dashboard_configs (solo WP corrente) --------
if ($method === 'GET' && $action === 'list_dashboard_configs') {
  $st = $pdo->prepare("
    SELECT c.dshp_id, c.dshp_name, c.dshp_description, c.dshp_usr, c.updated_at,
           (w.wp_default_dshp_id = c.dshp_id) AS is_default,
           (SELECT COUNT(*) FROM object_flows_connections ofc
             WHERE ofc.flow_type = 'dashboard' AND ofc.target_id = c.dshp_id) AS flow_count
    FROM wp_dashboard_configs c
    JOIN workpackages w ON w.wp_id = c.dshp_wp
    WHERE c.dshp_wp = ?
    ORDER BY c.dshp_name ASC
  ");
  $st->execute([$wp_id]);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
  foreach ($rows as &$r) {
    $r['is_default'] = (bool)$r['is_default'];
    $r['flow_count'] = (int)$r['flow_count'];
    // Chi modifica la configurazione: X, P, W e l'autore (§11.7.1, api/edit_rights.php)
    $r['can_link'] = ra_dshp_can_edit($editScope, (int)$r['dshp_usr'], $userId, $wp_id, $res_id);
  }
  json_ok($rows);
}

// -------- GET list_flows_for_dashboard (scope + linked per dshp_id) --------
// Mirror di list_flows_for_object con flow_type='dashboard'.
if ($method === 'GET' && $action === 'list_flows_for_dashboard') {
  $scope = (string)($_GET['scope'] ?? 'wp'); // wp|res|global
  $dshp_id = (int)($_GET['dshp_id'] ?? 0);
  if ($dshp_id <= 0) json_err(t('modal.objmod_links.err.missing_param', ['param' => 'dshp_id']), 400);
  $dshp_usr = links_assert_dshp_in_wp($pdo, $dshp_id, $wp_id);
  $canEditDshp = ra_dshp_can_edit($editScope, $dshp_usr, $userId, $wp_id, $res_id);
  json_ok(links_filter_rows(links_list_flows($pdo, 'dashboard', $dshp_id, $scope), $canEditDshp, 'links_flow_linkable'));
}

// -------- POST save_links / save_flow_links / save_dashboard_flow_links --------
if ($method === 'POST') {
  $body = read_json_body();
  $actionPost = (string)($body['action'] ?? '');

  if ($actionPost === 'save_links') {

    $obj_id = (int)($body['obj_id'] ?? 0);
    $added = $body['added'] ?? [];
    $removed = $body['removed'] ?? [];

    if ($obj_id <= 0) json_err(t('modal.objmod_links.err.missing_id', ['field' => 'obj_id']), 400);
    if (!is_array($added) || !is_array($removed)) json_err(t('modal.objmod_links.err.invalid_added_removed'), 400);

    // obj_id deve appartenere al WP corrente e accettare collegamenti dall'utente (obj_share)
    if (!links_obj_accepts($obj_id, links_obj_share($pdo, $obj_id, $wp_id))) json_err(t('errors.not_authorized'), 403);

    // Normalizza arrays
    $added = array_values(array_unique(array_map('intval', $added)));
    $removed = array_values(array_unique(array_map('intval', $removed)));

    // Doppio share lato modello (mai fidarsi del client), prima di scrivere
    links_assert_linkable($added, $removed, fn($id) => links_load_model($pdo, $id),
                          'links_model_linkable', 'modal.objmod_links.err.model_not_shared');

    $pdo->beginTransaction();
    try {
      // INSERT (idempotente grazie a UNIQUE(obj_id,mod_id))
      if (count($added)) {
        $stIns = $pdo->prepare("INSERT INTO object_models_connections (obj_id, mod_id) VALUES (?, ?)");
        foreach ($added as $mid) {
          if ($mid <= 0) continue;

          try {
            $stIns->execute([$obj_id, $mid]);
          } catch (PDOException $e) {
            // duplicate -> ignora
            if ((string)$e->getCode() !== '23000') throw $e;
          }
        }
      }

      // DELETE
      if (count($removed)) {
        $stDel = $pdo->prepare("DELETE FROM object_models_connections WHERE obj_id = ? AND mod_id = ?");
        foreach ($removed as $mid) {
          if ($mid <= 0) continue;
          $stDel->execute([$obj_id, $mid]);
        }
      }

      $pdo->commit();

      // Log dopo il commit
      foreach ($added as $mid) {
        if ($mid > 0) {
          log_activity('link:create', 'link', null, '', ['obj_id' => $obj_id, 'mod_id' => $mid]);
        }
      }
      foreach ($removed as $mid) {
        if ($mid > 0) {
          log_activity('link:delete', 'link', null, '', ['obj_id' => $obj_id, 'mod_id' => $mid]);
        }
      }

      json_ok(['obj_id' => $obj_id]);

    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      json_err(t('modal.objmod_links.err.save_failed', ['error' => $e->getMessage()]), 500);
    }
  }

  if ($actionPost === 'save_flow_links') {
    $obj_id = (int)($body['obj_id'] ?? 0);
    $added = $body['added'] ?? [];
    $removed = $body['removed'] ?? [];

    if ($obj_id <= 0) json_err(t('modal.objmod_links.err.missing_id', ['field' => 'obj_id']), 400);
    if (!is_array($added) || !is_array($removed)) json_err(t('modal.objmod_links.err.invalid_added_removed'), 400);

    // obj_id deve appartenere al WP corrente e accettare collegamenti dall'utente (obj_share)
    if (!links_obj_accepts($obj_id, links_obj_share($pdo, $obj_id, $wp_id))) json_err(t('errors.not_authorized'), 403);

    $added = array_values(array_unique(array_map('intval', $added)));
    $removed = array_values(array_unique(array_map('intval', $removed)));

    // FIX (2026-09-28, audit security-flow-script-execution.md §2.5): conoscendo l'id
    // si poteva collegare un flow di un altro WP scavalcando flow_share. Ora doppio
    // share (2026-10-10): stesse regole degli elenchi, controllate prima di scrivere.
    links_assert_linkable($added, $removed, fn($id) => links_load_flow($pdo, $id, 'object'),
                          'links_flow_linkable', 'modal.objmod_links.err.flow_not_shared');

    $pdo->beginTransaction();
    try {
      // INSERT (idempotente grazie a UNIQUE(flow_id,target_id))
      if (count($added)) {
        $stIns = $pdo->prepare("INSERT INTO object_flows_connections (flow_id, flow_type, target_id) VALUES (?, 'object', ?)");
        foreach ($added as $fid) {
          if ($fid <= 0) continue;

          try {
            $stIns->execute([$fid, $obj_id]);
          } catch (PDOException $e) {
            // duplicate -> ignora
            if ((string)$e->getCode() !== '23000') throw $e;
          }
        }
      }

      // DELETE
      if (count($removed)) {
        $stDel = $pdo->prepare("DELETE FROM object_flows_connections WHERE flow_id = ? AND flow_type = 'object' AND target_id = ?");
        foreach ($removed as $fid) {
          if ($fid <= 0) continue;
          $stDel->execute([$fid, $obj_id]);
        }
      }

      $pdo->commit();

      foreach ($added as $fid) {
        if ($fid > 0) {
          log_activity('link:create', 'flow_link', null, '', ['obj_id' => $obj_id, 'flow_id' => $fid]);
        }
      }
      foreach ($removed as $fid) {
        if ($fid > 0) {
          log_activity('link:delete', 'flow_link', null, '', ['obj_id' => $obj_id, 'flow_id' => $fid]);
        }
      }

      json_ok(['obj_id' => $obj_id]);

    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      json_err(t('modal.objmod_links.err.save_failed', ['error' => $e->getMessage()]), 500);
    }
  }

  // Mirror di save_flow_links con bersaglio Dashboard Config (dshp_id).
  if ($actionPost === 'save_dashboard_flow_links') {
    $dshp_id = (int)($body['dshp_id'] ?? 0);
    $added = $body['added'] ?? [];
    $removed = $body['removed'] ?? [];

    if ($dshp_id <= 0) json_err(t('modal.objmod_links.err.missing_id', ['field' => 'dshp_id']), 400);
    if (!is_array($added) || !is_array($removed)) json_err(t('modal.objmod_links.err.invalid_added_removed'), 400);
    $dshp_usr = links_assert_dshp_in_wp($pdo, $dshp_id, $wp_id);
    if (!ra_dshp_can_edit($editScope, $dshp_usr, $userId, $wp_id, $res_id)) json_err(t('errors.not_authorized'), 403);

    $added = array_values(array_unique(array_map('intval', $added)));
    $removed = array_values(array_unique(array_map('intval', $removed)));

    // Stesse regole di list_flows_for_dashboard (mai fidarsi del client).
    links_assert_linkable($added, $removed, fn($id) => links_load_flow($pdo, $id, 'dashboard'),
                          'links_flow_linkable', 'modal.objmod_links.err.flow_not_shared');

    $pdo->beginTransaction();
    try {
      if (count($added)) {
        $stIns = $pdo->prepare("INSERT INTO object_flows_connections (flow_id, flow_type, target_id) VALUES (?, 'dashboard', ?)");
        foreach ($added as $fid) {
          if ($fid <= 0) continue;
          try {
            $stIns->execute([$fid, $dshp_id]);
          } catch (PDOException $e) {
            // duplicate -> ignora (UNIQUE(flow_id,target_id))
            if ((string)$e->getCode() !== '23000') throw $e;
          }
        }
      }

      if (count($removed)) {
        $stDel = $pdo->prepare("DELETE FROM object_flows_connections WHERE flow_id = ? AND flow_type = 'dashboard' AND target_id = ?");
        foreach ($removed as $fid) {
          if ($fid <= 0) continue;
          $stDel->execute([$fid, $dshp_id]);
        }
      }

      $pdo->commit();

      foreach ($added as $fid) {
        if ($fid > 0) log_activity('link:create', 'flow_link', null, '', ['dshp_id' => $dshp_id, 'flow_id' => $fid]);
      }
      foreach ($removed as $fid) {
        if ($fid > 0) log_activity('link:delete', 'flow_link', null, '', ['dshp_id' => $dshp_id, 'flow_id' => $fid]);
      }

      json_ok(['dshp_id' => $dshp_id]);

    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      json_err(t('modal.objmod_links.err.save_failed', ['error' => $e->getMessage()]), 500);
    }
  }

  json_err(t('modal.objmod_links.err.invalid_action'), 400);
}

json_err(t('modal.objmod_links.err.invalid_action'), 400);
