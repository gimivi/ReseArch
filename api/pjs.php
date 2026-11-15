<?php
// api/pjs.php — disegni PJS sovrapposti ai modelli OSD (tabella drawings_osd_pjs)
//
// Controlli (2026-10-10, passo 5 di _doc/arch-permessi.md §11.9). Prima bastava essere collegati:
// conoscendo un mod_id o un dwg_id si leggevano e si creavano disegni ovunque. Ora:
//   - serve il contesto ricerca/WP in sessione;
//   - il modello deve essere raggiungibile da quel WP (suo, o collegato a un suo oggetto) e visibile
//     (mod_show, api/visibility.php), come in ui/modal_tree_obj_tools.php;
//   - un disegno si vede secondo dwg_show sulla scala unica 0-5 (0 = autore, più X, P, W; 5 = ospiti);
//   - creare e duplicare: chi modifica il modello o un oggetto del WP a cui è collegato (livello 30
//     del pannello, api/edit_rights.php);
//   - salvare, rinominare, eliminare: solo l'autore del disegno (come prima), sempre nel contesto.
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
session_start();

require __DIR__ . '/db.php'; // fornisce $pdo
require_once __DIR__ . '/edit_rights.php';

// ---- helper -------------------------------------------------
function json_out($arr) { echo json_encode($arr, JSON_UNESCAPED_UNICODE); exit; }
function get_input(): array {
  $raw = file_get_contents('php://input');
  if ($raw) {
    $j = json_decode($raw, true);
    if (is_array($j)) return $j;
  }
  // fallback GET/POST
  return array_merge($_GET ?? [], $_POST ?? []);
}
function require_int($v, $name) {
  if (!isset($v) || !is_numeric($v)) json_out(['ok'=>false,'error'=>"Parametro $name mancante/non valido"]);
  return (int)$v;
}
function require_str($v, $name, $maxLen = 255) {
  if (!isset($v) || !is_string($v)) json_out(['ok'=>false,'error'=>"Parametro $name mancante/non valido"]);
  $s = trim($v);
  if ($maxLen > 0 && mb_strlen($s) > $maxLen) $s = mb_substr($s, 0, $maxLen);
  return $s;
}
function require_user_id(): int {
  // Caso A: session contiene direttamente il record user (come quello che passi alla dashboard)
  if (!empty($_SESSION['user']) && is_array($_SESSION['user']) && !empty($_SESSION['user']['id'])) {
    return (int)$_SESSION['user']['id'];
  }

  json_out(['ok'=>false,'error'=>'Non autenticato']);
}


$in = get_input();
$action = $in['action'] ?? '';
$userId = require_user_id();

// ---- contesto e permessi --------------------------------------
$user        = $_SESSION['user'];
$research    = $_SESSION['research'] ?? null;
$workpackage = $_SESSION['workpackage'] ?? null;
if (!is_array($research) || !is_array($workpackage)) json_out(['ok'=>false,'error'=>'Contesto ricerca/WP mancante']);
$resId   = (int)($research['res_id'] ?? 0);
$wpId    = (int)($workpackage['wp_id'] ?? 0);
$resPerm = $research['res_perm'] ?? null;
$wpPerm  = $workpackage['wp_perm'] ?? null;
if ($resId <= 0 || $wpId <= 0) json_out(['ok'=>false,'error'=>'Contesto ricerca/WP mancante']);
$editScope = ra_edit_scope($pdo, $user);

/** Il modello è raggiungibile dal WP corrente (suo o collegato a un suo oggetto) e visibile? */
function pjs_model_accessible(int $modId): bool {
  global $pdo, $user, $userId, $wpId, $resPerm, $wpPerm, $editScope;
  $st = $pdo->prepare("
    SELECT m.mod_show
    FROM models m
    WHERE m.mod_id = :mod
      AND (m.wp_id = :wp OR EXISTS (
            SELECT 1 FROM object_models_connections c
            JOIN objects o ON o.obj_id = c.obj_id
            WHERE c.mod_id = m.mod_id AND o.wp_id = :wp2))
    LIMIT 1");
  $st->execute([':mod'=>$modId, ':wp'=>$wpId, ':wp2'=>$wpId]);
  $show = $st->fetchColumn();
  if ($show === false) return false;
  $isAuthor = isset($editScope['model'][$modId]);
  return ra_can_see_item($user, (int)$show, $resPerm, $wpPerm, $isAuthor);
}

/** Può creare disegni sul modello: lo modifica, o modifica un oggetto del WP a cui è collegato. */
function pjs_can_create(int $modId): bool {
  global $pdo, $wpId, $resId, $editScope;
  $st = $pdo->prepare("SELECT wp_id FROM models WHERE mod_id = ?");
  $st->execute([$modId]);
  $mWp = (int)($st->fetchColumn() ?: 0);
  if ($mWp > 0) {
    $st = $pdo->prepare("SELECT res_id FROM workpackages WHERE wp_id = ?");
    $st->execute([$mWp]);
    if (ra_scope_can_edit($editScope, 'model', $modId, $mWp, (int)($st->fetchColumn() ?: 0))) return true;
  }
  $st = $pdo->prepare("
    SELECT o.obj_id FROM object_models_connections c
    JOIN objects o ON o.obj_id = c.obj_id
    WHERE c.mod_id = ? AND o.wp_id = ?");
  $st->execute([$modId, $wpId]);
  foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $objId) {
    if (ra_scope_can_edit($editScope, 'object', (int)$objId, $wpId, $resId)) return true;
  }
  return false;
}

/** Il disegno (riga con dwg_show e dwg_author_id) è visibile all'utente? */
function pjs_drawing_visible(array $d): bool {
  global $user, $userId, $resPerm, $wpPerm;
  return ra_can_see_item($user, (int)$d['dwg_show'], $resPerm, $wpPerm, (int)$d['dwg_author_id'] === $userId);
}

/** Riga del disegno non eliminato, il cui modello è accessibile dal contesto; altrimenti esce. */
function pjs_require_drawing(int $dwgId): array {
  global $pdo;
  $st = $pdo->prepare("SELECT * FROM drawings_osd_pjs WHERE dwg_id = :id AND COALESCE(dwg_delete,0) = 0 LIMIT 1");
  $st->execute([':id'=>$dwgId]);
  $d = $st->fetch(PDO::FETCH_ASSOC);
  if (!$d || !pjs_model_accessible((int)$d['mod_id'])) json_out(['ok'=>false,'error'=>'Disegno non trovato']);
  return $d;
}

function pjs_show($v): int  { $n = (int)$v; return ($n >= 0 && $n <= 5) ? $n : 1; }   // 5 = ospiti
function pjs_share($v): int { $n = (int)$v; return ($n >= 0 && $n <= 3) ? $n : 1; }

try {
  if ($action === 'list') {
    $modId = require_int($in['mod_id'] ?? null, 'mod_id');
    if (!pjs_model_accessible($modId)) json_out(['ok'=>false,'error'=>'Modello non disponibile']);

    $sql = "
      SELECT
        d.dwg_id, d.mod_id, d.dwg_name, d.dwg_description, d.dwg_version,
        d.dwg_author_id, d.dwg_time_first, d.dwg_time_last,
        d.dwg_show, d.dwg_share,
        u.first_name AS author_first_name,
        u.last_name  AS author_last_name
      FROM drawings_osd_pjs d
      JOIN users u ON u.id = d.dwg_author_id
      WHERE d.mod_id = :mod_id
        AND COALESCE(d.dwg_delete,0) = 0
      ORDER BY d.dwg_time_last DESC, d.dwg_id DESC
    ";
    $st = $pdo->prepare($sql);
    $st->execute([':mod_id' => $modId]);
    // visibilità per disegno sulla scala unica 0-4 (prima: dwg_show > 0 per tutti, autore compreso)
    $rows = array_values(array_filter($st->fetchAll(PDO::FETCH_ASSOC), 'pjs_drawing_visible'));

    json_out(['ok'=>true, 'current_user_id'=>$userId, 'can_create'=>pjs_can_create($modId), 'data'=>$rows]);
  }

  if ($action === 'load') {
    $dwgId = require_int($in['dwg_id'] ?? null, 'dwg_id');
    $d = pjs_require_drawing($dwgId);
    if (!pjs_drawing_visible($d)) json_out(['ok'=>false,'error'=>'Disegno non trovato']);

    $sql = "
      SELECT
        d.*,
        u.first_name AS author_first_name,
        u.last_name  AS author_last_name
      FROM drawings_osd_pjs d
      JOIN users u ON u.id = d.dwg_author_id
      WHERE d.dwg_id = :dwg_id
        AND COALESCE(d.dwg_delete,0) = 0
      LIMIT 1
    ";
    $st = $pdo->prepare($sql);
    $st->execute([':dwg_id' => $dwgId]);
    $row = $st->fetch();
    if (!$row) json_out(['ok'=>false,'error'=>'Disegno non trovato']);

    // dwg_sce_json è tipo JSON: PDO lo ritorna come stringa; decodifichiamo
    if (isset($row['dwg_sce_json']) && is_string($row['dwg_sce_json'])) {
      $row['dwg_sce_json'] = json_decode($row['dwg_sce_json'], true);
    }

    json_out(['ok'=>true, 'current_user_id'=>$userId, 'data'=>$row]);
  }

  if ($action === 'new') {
    $modId = require_int($in['mod_id'] ?? null, 'mod_id');
    if (!pjs_model_accessible($modId) || !pjs_can_create($modId)) json_out(['ok'=>false,'error'=>'Non autorizzato']);
    $name = require_str($in['dwg_name'] ?? 'Nuovo disegno', 'dwg_name', 50);
    $desc = require_str($in['dwg_description'] ?? '', 'dwg_description', 255);
    $ver  = require_str($in['dwg_version'] ?? 'v1', 'dwg_version', 30);

    $show  = pjs_show($in['dwg_show'] ?? 1);
    $share = pjs_share($in['dwg_share'] ?? 1);

    if (!isset($in['dwg_sce_json']) || !is_array($in['dwg_sce_json'])) {
      json_out(['ok'=>false,'error'=>'dwg_sce_json mancante/non valido']);
    }
    $jsonStr = json_encode($in['dwg_sce_json'], JSON_UNESCAPED_UNICODE);

    $sql = "
      INSERT INTO drawings_osd_pjs
      (mod_id, dwg_name, dwg_description, dwg_version, dwg_author_id,
       dwg_time_first, dwg_time_last, dwg_sce_json, dwg_show, dwg_share, dwg_delete)
      VALUES
      (:mod_id, :name, :descr, :ver, :author,
       NOW(), NOW(), CAST(:j AS JSON), :show, :share, 0)
    ";
    $st = $pdo->prepare($sql);
    $st->execute([
      ':mod_id'=>$modId, ':name'=>$name, ':descr'=>$desc, ':ver'=>$ver,
      ':author'=>$userId, ':j'=>$jsonStr, ':show'=>$show, ':share'=>$share
    ]);
    $newId = (int)$pdo->lastInsertId();

    json_out(['ok'=>true, 'current_user_id'=>$userId, 'data'=>['dwg_id'=>$newId]]);
  }

  if ($action === 'save') {
    $dwgId = require_int($in['dwg_id'] ?? null, 'dwg_id');

    // ownership check (nel contesto corrente)
    $own = pjs_require_drawing($dwgId);
    if ((int)$own['dwg_author_id'] !== $userId) json_out(['ok'=>false,'error'=>'Non autorizzato (non owner)']);

    $name = require_str($in['dwg_name'] ?? '', 'dwg_name', 50);
    $desc = require_str($in['dwg_description'] ?? '', 'dwg_description', 255);
    $ver  = require_str($in['dwg_version'] ?? 'v1', 'dwg_version', 30);
    $show  = pjs_show($in['dwg_show'] ?? 1);
    $share = pjs_share($in['dwg_share'] ?? 1);

    if (!isset($in['dwg_sce_json']) || !is_array($in['dwg_sce_json'])) {
      json_out(['ok'=>false,'error'=>'dwg_sce_json mancante/non valido']);
    }
    $jsonStr = json_encode($in['dwg_sce_json'], JSON_UNESCAPED_UNICODE);

    $sql = "
      UPDATE drawings_osd_pjs
      SET dwg_name=:name,
          dwg_description=:descr,
          dwg_version=:ver,
          dwg_time_last=NOW(),
          dwg_sce_json=CAST(:j AS JSON),
          dwg_show=:show,
          dwg_share=:share
      WHERE dwg_id=:id
        AND dwg_author_id=:author
        AND COALESCE(dwg_delete,0)=0
    ";
    $st = $pdo->prepare($sql);
    $st->execute([
      ':name'=>$name, ':descr'=>$desc, ':ver'=>$ver, ':j'=>$jsonStr,
      ':show'=>$show, ':share'=>$share,
      ':id'=>$dwgId, ':author'=>$userId
    ]);

    json_out(['ok'=>true, 'current_user_id'=>$userId, 'data'=>['dwg_time_last'=>date('Y-m-d H:i:s')]]);
  }

  if ($action === 'delete') {
    $dwgId = require_int($in['dwg_id'] ?? null, 'dwg_id');
    $own = pjs_require_drawing($dwgId);
    if ((int)$own['dwg_author_id'] !== $userId) json_out(['ok'=>false,'error'=>'Non autorizzato (non owner)']);

    $sql = "
      UPDATE drawings_osd_pjs
      SET dwg_delete=1, dwg_time_last=NOW()
      WHERE dwg_id=:id AND dwg_author_id=:author
    ";
    $st = $pdo->prepare($sql);
    $st->execute([':id'=>$dwgId, ':author'=>$userId]);

    json_out(['ok'=>true, 'current_user_id'=>$userId]);
  }

  if ($action === 'updateMeta') {
    // Tabulator inline edit: aggiorna name/descr/version/show/share (NO JSON)
    $dwgId = require_int($in['dwg_id'] ?? null, 'dwg_id');

    // owner required (nel contesto corrente)
    $own = pjs_require_drawing($dwgId);
    if ((int)$own['dwg_author_id'] !== $userId) json_out(['ok'=>false,'error'=>'Non autorizzato (non owner)']);

    $fields = [];
    $params = [':id'=>$dwgId, ':author'=>$userId];

    if (isset($in['dwg_name']))        { $fields[]="dwg_name=:name";  $params[':name']=require_str($in['dwg_name'],'dwg_name',50); }
    if (isset($in['dwg_description'])) { $fields[]="dwg_description=:descr"; $params[':descr']=require_str($in['dwg_description'],'dwg_description',255); }
    if (isset($in['dwg_version']))     { $fields[]="dwg_version=:ver"; $params[':ver']=require_str($in['dwg_version'],'dwg_version',30); }
    if (isset($in['dwg_show']))        { $fields[]="dwg_show=:show"; $params[':show']=pjs_show($in['dwg_show']); }
    if (isset($in['dwg_share']))       { $fields[]="dwg_share=:share"; $params[':share']=pjs_share($in['dwg_share']); }

    if (!$fields) json_out(['ok'=>false,'error'=>'Nessun campo da aggiornare']);

    $sql = "UPDATE drawings_osd_pjs SET ".implode(',',$fields).", dwg_time_last=NOW()
            WHERE dwg_id=:id AND dwg_author_id=:author AND COALESCE(dwg_delete,0)=0";
    $st = $pdo->prepare($sql);
    $st->execute($params);

    json_out(['ok'=>true, 'current_user_id'=>$userId]);
  }

  if ($action === 'duplicate') {
    $srcId = require_int($in['dwg_id'] ?? null, 'dwg_id');
    $name = require_str($in['dwg_name'] ?? 'Copia', 'dwg_name', 50);
    $desc = require_str($in['dwg_description'] ?? '', 'dwg_description', 255);

    $src = pjs_require_drawing($srcId);
    if (!pjs_drawing_visible($src)) json_out(['ok'=>false,'error'=>'Sorgente non trovata']);
    if (!pjs_can_create((int)$src['mod_id'])) json_out(['ok'=>false,'error'=>'Non autorizzato']);

    $jsonStr = $src['dwg_sce_json']; // string JSON
    if (!is_string($jsonStr)) $jsonStr = json_encode($src['dwg_sce_json'], JSON_UNESCAPED_UNICODE);

    $sql = "
      INSERT INTO drawings_osd_pjs
      (mod_id, dwg_name, dwg_description, dwg_version, dwg_author_id,
       dwg_time_first, dwg_time_last, dwg_sce_json, dwg_show, dwg_share, dwg_delete)
      VALUES
      (:mod_id, :name, :descr, 'v1', :author,
       NOW(), NOW(), CAST(:j AS JSON), 1, 1, 0)
    ";
    $st = $pdo->prepare($sql);
    $st->execute([
      ':mod_id'=>(int)$src['mod_id'],
      ':name'=>$name,
      ':descr'=>$desc,
      ':author'=>$userId,
      ':j'=>$jsonStr
    ]);
    $newId = (int)$pdo->lastInsertId();
    json_out(['ok'=>true,'current_user_id'=>$userId,'data'=>['dwg_id'=>$newId]]);
  }

  json_out(['ok'=>false,'error'=>'action non riconosciuta']);
}
catch (Throwable $e) {
  http_response_code(500);
  json_out(['ok'=>false,'error'=>'Errore server']);
}
