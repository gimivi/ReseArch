<?php
// api/fle_library_tool.php
// Nodi di libreria dei flow (step 8 di _doc/arch-abilitazioni.md §6).
// Client: app/FLE_sub_modules/FLE-library-nodes.mjs (registrazione dei nodi),
// ui/modal_fle_library.{php,js} (gestione, solo admin), ui/modal_flow_review.js
// (promozione di uno Script da un flow in revisione).
//
// GET  ?action=list        → catalogo completo, per chiunque sia autenticato:
//                             [{category, name, versions:[{version, desc, inputs, outputs, code, status}]}]
//                             Il codice arriva al browser per forza (è lì che gira):
//                             non è un segreto, è solo NON MODIFICABILE da chi lo usa.
// GET  ?action=admin_list  → come list, con id, autore, date (solo admin)
// POST {action:'save', category, name, desc, inputs, outputs, code}
//        → nuova versione (1 se il nodo non esiste). Solo admin.
// POST {action:'promote', flow_id, node_id, category, name, desc}
//        → nuova versione a partire da un nodo Script/Flexi di un flow. Solo admin.
// POST {action:'set_status', lib_id, status:'approved'|'retired'} → solo admin
//
// Scostamento dalla specifica (§6): le versioni le crea solo l'amministratore,
// quindi nascono già approvate — non c'è uno stato "in attesa" per le proposte
// di altri utenti. Si può aggiungere se servirà.

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';
require_once __DIR__ . '/flow_validation.php';
require_once __DIR__ . '/visibility.php';   // ra_session_user_ok, ra_is_guest (ospiti, id 0)

function fl_ok($data = null): void {
  echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
  exit;
}
function fl_err(string $msg, int $code = 400): void {
  http_response_code($code);
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

$user = $_SESSION['user'] ?? null;
if (!ra_session_user_ok($user)) fl_err('Utente non autenticato.', 401);   // ospiti: solo ?action=list
$userId  = (int)$user['id'];
$isAdmin = ($user['user_type'] ?? '') === 'X';

/** Categoria e nome: diventano parte del tipo LiteGraph, niente '/'. */
function fl_norm_label(string $v, string $what): string {
  $v = trim($v);
  if ($v === '' || mb_strlen($v) > 60 || !preg_match('/^[\p{L}\p{N} _.\-]+$/u', $v)) {
    fl_err("$what non valido: lettere, numeri, spazi, _ . - (max 60 caratteri).");
  }
  return $v;
}

/** Elenco porte CSV → nomi validi come variabili JS, senza duplicati. */
function fl_norm_ports(string $csv, string $what): string {
  $names = array_values(array_filter(array_map('trim', explode(',', $csv)), 'strlen'));
  foreach ($names as $n) {
    if (!preg_match('/^[A-Za-z_$][A-Za-z0-9_$]*$/', $n)) fl_err("$what: '$n' non è un nome valido (deve poter essere una variabile JS).");
  }
  if (count($names) !== count(array_unique($names))) fl_err("$what: nomi duplicati.");
  return implode(', ', $names);
}

function fl_catalog(PDO $pdo, bool $full): array {
  $rows = $pdo->query("
    SELECT l.lib_id, l.lib_category, l.lib_name, l.lib_version, l.lib_desc, l.lib_inputs, l.lib_outputs,
           l.lib_code, l.lib_status, l.created_at, u.first_name, u.last_name, u.user_name
    FROM   fle_library_nodes l
    LEFT JOIN users u ON u.id = l.approved_by
    ORDER  BY l.lib_category, l.lib_name, l.lib_version")->fetchAll(PDO::FETCH_ASSOC);
  $out = [];
  foreach ($rows as $r) {
    $key = $r['lib_category'] . '/' . $r['lib_name'];
    $out[$key] ??= ['category' => $r['lib_category'], 'name' => $r['lib_name'], 'versions' => []];
    $v = [
      'version' => (int)$r['lib_version'],
      'desc'    => (string)$r['lib_desc'],
      'inputs'  => (string)$r['lib_inputs'],
      'outputs' => (string)$r['lib_outputs'],
      'code'    => (string)$r['lib_code'],
      'status'  => (string)$r['lib_status'],
    ];
    if ($full) {
      $name = trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? ''));
      $v += ['lib_id' => (int)$r['lib_id'], 'created_at' => (string)$r['created_at'],
             'approved_by' => $name !== '' ? $name : (string)($r['user_name'] ?? '')];
    }
    $out[$key]['versions'][] = $v;
  }
  return array_values($out);
}

/** Inserisce una nuova versione (numero = massimo + 1). */
function fl_insert_version(PDO $pdo, string $cat, string $name, string $desc, string $inputs, string $outputs,
                           string $code, int $userId, ?int $sourceFlow): int {
  if (trim($code) === '') fl_err('Il codice è vuoto.');
  $pdo->beginTransaction();
  $st = $pdo->prepare("SELECT COALESCE(MAX(lib_version), 0) FROM fle_library_nodes
                       WHERE lib_category = ? AND lib_name = ? FOR UPDATE");
  $st->execute([$cat, $name]);
  $version = (int)$st->fetchColumn() + 1;
  $pdo->prepare("INSERT INTO fle_library_nodes
                   (lib_category, lib_name, lib_version, lib_desc, lib_inputs, lib_outputs, lib_code,
                    lib_status, source_flow_id, approved_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)")
      ->execute([$cat, $name, $version, $desc, $inputs, $outputs, $code, $sourceFlow, $userId]);
  $pdo->commit();
  return $version;
}

try {
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

  if ($method === 'GET' && ($_GET['action'] ?? '') === 'list') fl_ok(fl_catalog($pdo, false));

  if (!$isAdmin) fl_err("Riservato all'amministratore.", 403);

  if ($method === 'GET' && ($_GET['action'] ?? '') === 'admin_list') fl_ok(fl_catalog($pdo, true));

  if ($method !== 'POST') fl_err('Metodo o azione non supportati.', 405);
  $raw = file_get_contents('php://input');
  $req = $raw ? json_decode($raw, true) : null;
  if (!is_array($req)) fl_err('Body JSON non valido.');
  $action = (string)($req['action'] ?? '');

  // ------------------------------------------------------------ save
  if ($action === 'save') {
    $cat  = fl_norm_label((string)($req['category'] ?? ''), 'Categoria');
    $name = fl_norm_label((string)($req['name'] ?? ''), 'Nome');
    $v = fl_insert_version($pdo, $cat, $name, trim((string)($req['desc'] ?? '')),
      fl_norm_ports((string)($req['inputs'] ?? ''), 'Ingressi'),
      fl_norm_ports((string)($req['outputs'] ?? ''), 'Uscite'),
      (string)($req['code'] ?? ''), $userId, null);
    log_activity('library:save', 'fle_library', null, "$cat/$name v$v");
    fl_ok(['category' => $cat, 'name' => $name, 'version' => $v]);
  }

  // ------------------------------------------------------------ promote
  if ($action === 'promote') {
    $flowId = (int)($req['flow_id'] ?? 0);
    $nodeId = $req['node_id'] ?? null;
    $st = $pdo->prepare("SELECT flow_fle FROM flows WHERE flow_id = ? LIMIT 1");
    $st->execute([$flowId]);
    $raw = $st->fetchColumn();
    if ($raw === false) fl_err("Flow #$flowId non trovato.", 404);

    $found = null;
    $walk = function ($a) use (&$walk, &$found, $nodeId) {
      if (!is_array($a) || $found) return;
      if (isset($a['nodes']) && is_array($a['nodes'])) {
        foreach ($a['nodes'] as $n) {
          if (is_array($n) && ($n['id'] ?? null) == $nodeId && ($n['type'] ?? '') === 'Script/Flexi') { $found = $n; return; }
        }
      }
      foreach ($a as $v) $walk($v);
    };
    $walk(fv_decode($raw));
    if (!$found) fl_err("Nodo Script #$nodeId non trovato nel flow #$flowId.", 404);

    $cat  = fl_norm_label((string)($req['category'] ?? ''), 'Categoria');
    $name = fl_norm_label((string)($req['name'] ?? ''), 'Nome');
    $p = $found['properties'] ?? [];
    $v = fl_insert_version($pdo, $cat, $name, trim((string)($req['desc'] ?? '')),
      fl_norm_ports((string)($p['inputs_def'] ?? ''), 'Ingressi'),
      fl_norm_ports((string)($p['outputs_def'] ?? ''), 'Uscite'),
      (string)($p['code'] ?? ''), $userId, $flowId);
    log_activity('library:promote', 'fle_library', null, "$cat/$name v$v", ['flow_id' => $flowId, 'node_id' => $nodeId]);
    fl_ok(['category' => $cat, 'name' => $name, 'version' => $v]);
  }

  // ------------------------------------------------------------ set_status
  if ($action === 'set_status') {
    $libId  = (int)($req['lib_id'] ?? 0);
    $status = (string)($req['status'] ?? '');
    if (!in_array($status, ['approved', 'retired'], true)) fl_err('Stato non valido.');
    $st = $pdo->prepare("UPDATE fle_library_nodes SET lib_status = ? WHERE lib_id = ?");
    $st->execute([$status, $libId]);
    if ($st->rowCount() === 0) {
      $chk = $pdo->prepare("SELECT 1 FROM fle_library_nodes WHERE lib_id = ?");
      $chk->execute([$libId]);
      if (!$chk->fetchColumn()) fl_err('Versione non trovata.', 404);
    }
    log_activity('library:status', 'fle_library', $libId, $status);
    fl_ok(['lib_id' => $libId, 'status' => $status]);
  }

  fl_err('Azione non supportata: ' . $action);

} catch (Throwable $e) {
  if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
  fl_err('Errore: ' . $e->getMessage(), 500);
}
