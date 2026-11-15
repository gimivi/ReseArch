<?php
// ui/modal_objects_tools.php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

require_once __DIR__ . '/../api/i18n.php';   // messaggi nella lingua della richiesta
require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/log_tool.php';
require_once __DIR__ . '/../api/app_catalog.php';
require_once __DIR__ . '/../api/edit_rights.php';

function respond(array $arr): void {
  echo json_encode($arr, JSON_UNESCAPED_UNICODE);
  exit;
}

function fail(string $msg, int $httpCode = 400): void {
  http_response_code($httpCode);
  respond(['ok' => false, 'error' => $msg]);
}

function read_json_body(): array {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}

function norm_str($v): string {
  return trim((string)($v ?? ''));
}

function norm_app($v): string {
  $s = strtoupper(trim((string)($v ?? '')));
  return substr($s, 0, 3);
}

function norm_show($v): int {
  $n = (int)($v ?? 1);
  return in_array($n, [0, 1, 2, 3, 4, 5], true) ? $n : 1;   // 5 = ospiti
}

// obj_share (§11.6 di _doc/arch-permessi.md): chi collega modelli e flow all'oggetto.
// 0 solo chi lo modifica · 1 anche i membri del WP · 2 anche i membri della ricerca.
function norm_share($v): int {
  $n = (int)($v ?? 1);
  return in_array($n, [0, 1, 2], true) ? $n : 1;
}

function require_name($name, string $context = ''): void {
  if (trim((string)$name) === '') {
    $msg = t('modal.objects.err.name_required');
    if ($context !== '') $msg .= " ($context)";
    fail($msg);
  }
}

function require_typeA($v, string $context = ''): void {
  if (trim((string)$v) === '') {
    $msg = t('modal.objects.err.type_a_required');
    if ($context !== '') $msg .= " ($context)";
    fail($msg);
  }
}

/**
 * Valida obj_app contro il catalogo. $currentApp = valore già salvato
 * sull'oggetto (solo per gli update): se obj_app NON cambia, lo si accetta
 * anche se l'APP non è più creabile per l'utente, così si possono ancora
 * modificare nome/descrizione/show di un oggetto esistente. Scelta
 * provvisoria: la regola definitiva è un punto aperto (§11 del documento).
 * Un obj_app che non esiste nel catalogo viene sempre rifiutato.
 */
function require_app($v, array $catalog, string $context = '', ?string $currentApp = null): void {
  $sfx = $context !== '' ? " ($context)" : '';
  if (trim((string)$v) === '') fail(t('modal.objects.err.app_required') . $sfx);
  if (!isset($catalog[$v])) fail(t('modal.objects.err.app_unknown', ['app' => $v]) . $sfx);
  if ($currentApp !== null && $currentApp === $v) return;
  if (!$catalog[$v]['creatable']) fail(t('modal.objects.err.app_not_enabled', ['app' => $v]) . $sfx, 403);
}

function current_obj_app(PDO $pdo, int $obj_id, int $wp_id): ?string {
  $st = $pdo->prepare("SELECT obj_app FROM objects WHERE obj_id = :obj_id AND wp_id = :wp_id");
  $st->execute([':obj_id' => $obj_id, ':wp_id' => $wp_id]);
  $v = $st->fetchColumn();
  if ($v === false) fail(t('modal.objects.err.not_in_wp.@', ['id' => $obj_id]), 404);
  return norm_app($v);
}

try {
  if (!isset($pdo) || !($pdo instanceof PDO)) {
    fail(t('modal.objects.err.db_unavailable'), 500);
  }

  $req = read_json_body();

  $action = (string)($req['action'] ?? '');
  // FIX sicurezza (2026-09-28): sessione obbligatoria, workpackage preso dalla
  // SESSIONE (il body deve coincidere).
  // Scrittura per singolo oggetto (2026-10-10, passo 4 di _doc/arch-permessi.md §11.9):
  // creano X, P della ricerca, W e I del WP (e diventano autori); modificano ed
  // eliminano X, P, W e gli autori o collaboratori dell'oggetto (api/edit_rights.php).
  $user        = $_SESSION['user'] ?? null;
  $research    = $_SESSION['research'] ?? null;
  $workpackage = $_SESSION['workpackage'] ?? null;
  if (!is_array($user)) fail(t('errors.not_authenticated'), 401);
  if (!is_array($research) || !is_array($workpackage)) {
    fail(t('modal.objects.err.no_context.@'), 400);
  }

  $res_id = (int)($research['res_id'] ?? 0);
  $wp_id  = (int)($workpackage['wp_id'] ?? 0);
  if ($res_id <= 0 || $wp_id <= 0) fail(t('modal.objects.err.no_session_ids'));

  $reqRes = (int)($req['res_id'] ?? 0);
  $reqWp  = (int)($req['wp_id'] ?? 0);
  if (($reqRes > 0 && $reqRes !== $res_id) || ($reqWp > 0 && $reqWp !== $wp_id)) {
    fail(t('modal.objects.err.context_mismatch.@'), 403);
  }

  $userId     = (int)($user['id'] ?? 0);
  $editScope  = ra_edit_scope($pdo, $user);
  $CAN_CREATE = ra_scope_can_create($editScope, $wp_id, $res_id);
  $canEditObj = fn(int $id): bool => ra_scope_can_edit($editScope, 'object', $id, $wp_id, $res_id);

  $appCatalog = app_catalog($pdo, user_caps($pdo, $user));

  // ---------------------------- READ ----------------------------
  if ($action === 'read') {
    // 'apps'       = solo le APP che l'utente può scegliere (editor della colonna App);
    // 'app_titles' = TUTTE le APP, per mostrare il titolo anche sugli oggetti
    //                esistenti di un'APP non più selezionabile.
    $apps = [];
    $appTitles = [];
    foreach ($appCatalog as $cod => $a) {
      $appTitles[$cod] = $a['title'];
      if (!$a['creatable']) continue;
      $apps[] = [
        'value' => $cod,
        'label' => $a['title'] . ($a['status'] === 'beta' ? ' (beta)' : ''),
      ];
    }

    $sql = "SELECT obj_id, obj_name, obj_description, obj_type_A, obj_type_B, obj_app, obj_show, obj_share
            FROM objects
            WHERE wp_id = :wp_id
            ORDER BY obj_id ASC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([':wp_id' => $wp_id]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $authorsBy = ra_authors_by_item($pdo, 'object', $wp_id);   // colonna "Autori" (passo 7)

    foreach ($rows as &$r) {
      $r['obj_id'] = (int)$r['obj_id'];
      $r['obj_show'] = norm_show($r['obj_show'] ?? 1);
      $r['obj_share'] = norm_share($r['obj_share'] ?? 1);
      $r['obj_app'] = norm_app($r['obj_app'] ?? '');
      $r['can_edit'] = $canEditObj($r['obj_id']);
      $r['authors']  = $authorsBy[$r['obj_id']] ?? [];
    }
    unset($r);

    respond([
      'ok'   => true,
      'data'       => $rows,
      'apps'       => $apps,
      'app_titles' => $appTitles,
      'can_create' => $CAN_CREATE,
    ]);
  }

  // ---------------------------- BATCH ----------------------------
  if ($action === 'batch') {
    $inserts = $req['inserts'] ?? [];
    $updates = $req['updates'] ?? [];
    $deletes = $req['deletes'] ?? [];

    if (!is_array($inserts) || !is_array($updates) || !is_array($deletes)) {
      fail(t('modal.objects.err.invalid_batch'));
    }

    $pdo->beginTransaction();
    $logEntries = []; // raccoglie voci da loggare dopo il commit

    if (count($inserts) > 0) {
      if (!$CAN_CREATE) fail(t('errors.not_authorized'), 403);
      $sqlIns = "INSERT INTO objects
        (wp_id, obj_name, obj_description, obj_type_A, obj_type_B, obj_app, obj_show, obj_share)
        VALUES
        (:wp_id, :obj_name, :obj_description, :obj_type_A, :obj_type_B, :obj_app, :obj_show, :obj_share)";
      $stmtIns = $pdo->prepare($sqlIns);

      foreach ($inserts as $i => $d) {
        if (!is_array($d)) fail(t('modal.objects.err.invalid_item', ['op' => 'Insert', 'i' => $i]));

        $obj_name = norm_str($d['obj_name'] ?? '');
        require_name($obj_name, "insert #$i");

        $obj_type_A = norm_str($d['obj_type_A'] ?? '');
        $obj_app    = norm_app($d['obj_app'] ?? '');

        require_typeA($obj_type_A, "insert #$i");
        require_app($obj_app, $appCatalog, "insert #$i");

        $stmtIns->execute([
          ':wp_id'           => $wp_id,
          ':obj_name'        => $obj_name,
          ':obj_description' => norm_str($d['obj_description'] ?? ''),
          ':obj_type_A'      => $obj_type_A,
          ':obj_type_B'      => norm_str($d['obj_type_B'] ?? ''),
          ':obj_app'         => $obj_app,
          ':obj_show'        => norm_show($d['obj_show'] ?? 1),
          ':obj_share'       => norm_share($d['obj_share'] ?? 1),
        ]);
        $newId = (int)$pdo->lastInsertId();
        ra_add_author($pdo, 'object', $newId, $userId);
        $logEntries[] = ['object:create', 'object', $newId, $obj_name];
      }
    }

    if (count($updates) > 0) {
      $sqlUpd = "UPDATE objects SET
          obj_name = :obj_name,
          obj_description = :obj_description,
          obj_type_A = :obj_type_A,
          obj_type_B = :obj_type_B,
          obj_app = :obj_app,
          obj_show = :obj_show,
          obj_share = :obj_share
        WHERE obj_id = :obj_id AND wp_id = :wp_id";
      $stmtUpd = $pdo->prepare($sqlUpd);

      foreach ($updates as $i => $d) {
        if (!is_array($d)) fail(t('modal.objects.err.invalid_item', ['op' => 'Update', 'i' => $i]));

        $obj_id = (int)($d['obj_id'] ?? 0);
        if ($obj_id <= 0) fail(t('modal.objects.err.invalid_id') . " (update #$i)");
        if (!$canEditObj($obj_id)) fail(t('errors.item_not_editable', ['id' => $obj_id]), 403);

        $obj_name = norm_str($d['obj_name'] ?? '');
        require_name($obj_name, "update #$i");

        $obj_type_A = norm_str($d['obj_type_A'] ?? '');
        $obj_app    = norm_app($d['obj_app'] ?? '');

        require_typeA($obj_type_A, "update #$i");
        require_app($obj_app, $appCatalog, "update #$i", current_obj_app($pdo, $obj_id, $wp_id));

        $stmtUpd->execute([
          ':obj_name'        => $obj_name,
          ':obj_description' => norm_str($d['obj_description'] ?? ''),
          ':obj_type_A'      => $obj_type_A,
          ':obj_type_B'      => norm_str($d['obj_type_B'] ?? ''),
          ':obj_app'         => $obj_app,
          ':obj_show'        => norm_show($d['obj_show'] ?? 1),
          ':obj_share'       => norm_share($d['obj_share'] ?? 1),
          ':obj_id'          => $obj_id,
          ':wp_id'           => $wp_id,
        ]);
        $logEntries[] = ['object:edit', 'object', $obj_id, $obj_name];
      }
    }

    if (count($deletes) > 0) {
      $sqlDel = "DELETE FROM objects
                 WHERE obj_id = :obj_id AND wp_id = :wp_id";
      $stmtDel = $pdo->prepare($sqlDel);

      foreach ($deletes as $i => $id) {
        $obj_id = (int)$id;
        if ($obj_id <= 0) fail(t('modal.objects.err.invalid_id') . " (delete #$i)");
        if (!$canEditObj($obj_id)) fail(t('errors.item_not_editable', ['id' => $obj_id]), 403);

        $stmtDel->execute([
          ':obj_id' => $obj_id,
          ':wp_id'  => $wp_id,
        ]);
        if ($stmtDel->rowCount() > 0) {
          // Nessuna FOREIGN KEY: autori e collegamenti dell'oggetto vanno tolti qui
          // (altrimenti restano orfani, vedi api/db_maintenance_tool.php)
          ra_remove_authors($pdo, 'object', $obj_id);
          $pdo->prepare("DELETE FROM object_models_connections WHERE obj_id = ?")->execute([$obj_id]);
          $pdo->prepare("DELETE FROM object_flows_connections WHERE flow_type = 'object' AND target_id = ?")->execute([$obj_id]);
        }
        $logEntries[] = ['object:delete', 'object', $obj_id, ''];
      }
    }

    $pdo->commit();
    foreach ($logEntries as $e) {
      log_activity($e[0], $e[1], $e[2], $e[3]);
    }
    respond(['ok' => true]);
  }

  fail(t('modal.objects.err.unsupported_action', ['action' => $action]));

} catch (Throwable $e) {
  if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
    $pdo->rollBack();
  }
  fail($e->getMessage(), 500);
}