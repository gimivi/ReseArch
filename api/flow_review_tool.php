<?php
// api/flow_review_tool.php
// Revisione e validazione dei flow con nodi critici (step 6 di
// _doc/arch-abilitazioni.md §5.4-§5.5). Usato dalla modale "Validazione flow"
// (ui/modal_flow_review.{php,js}).
//
// Chi può validare:
//   - l'amministratore (X): tutti i flow;
//   - chi ha il permesso di profilo 'validate_flows': solo i flow delle
//     ricerche in cui ha un ruolo (P/W/I), e MAI i propri.
// La revisione non esegue nulla: mostra il codice dei nodi critici, il confronto
// con la versione pubblicata e i collegamenti di ogni nodo critico.
//
// GET  ?action=queue[&include_approved=1] → { items: flow in attesa (e validati), can_bulk }
// GET  ?action=detail&flow_id=N      → dettaglio per la revisione (+ hash della bozza)
// GET  ?action=history&flow_id=N     → validazioni registrate per il flow
// POST {action:'validate', items:[{flow_id, hash}], note}
//        hash = quello visto nella revisione: se la bozza è cambiata nel
//        frattempo, la validazione di quel flow viene rifiutata.
// POST {action:'revoke', val_id}     → solo amministratore

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';
require_once __DIR__ . '/app_catalog.php';
require_once __DIR__ . '/flow_validation.php';

function fr_ok($data = null): void {
  echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
  exit;
}
function fr_err(string $msg, int $code = 400): void {
  http_response_code($code);
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

$user = $_SESSION['user'] ?? null;
if (!is_array($user) || empty($user['id'])) fr_err('Utente non autenticato.', 401);
$userId  = (int)$user['id'];
$caps    = user_caps($pdo, $user);
$isAdmin = $caps['is_admin'];
if (!user_has_perm($caps, 'validate_flows')) {
  fr_err('Permesso negato: serve il permesso di validare i flow (profilo) o il ruolo di amministratore.', 403);
}

/** Il flow (riga completa) può essere revisionato da questo utente? */
function fr_can_review(PDO $pdo, array $row, int $userId, bool $isAdmin): bool {
  if ($isAdmin) return true;
  if ((int)($row['author_id'] ?? 0) === $userId) return false;       // mai i propri
  return fv_user_has_role_in_research($pdo, $userId, (int)$row['flow_wp']);
}

function fr_load_flow(PDO $pdo, int $flowId): array {
  $st = $pdo->prepare("SELECT * FROM flows WHERE flow_id = ? LIMIT 1");
  $st->execute([$flowId]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  if (!$row) fr_err("Flow #$flowId non trovato.", 404);
  return $row;
}

/** Tutti i (sotto)grafi del flow: [['nodes' => [...], 'links' => [...]], ...]. */
function fr_graphs(?array $data): array {
  $out = [];
  $walk = function ($a) use (&$walk, &$out) {
    if (!is_array($a)) return;
    if (isset($a['nodes']) && is_array($a['nodes'])) {
      $out[] = ['nodes' => $a['nodes'], 'links' => is_array($a['links'] ?? null) ? $a['links'] : []];
    }
    foreach ($a as $v) if (is_array($v)) $walk($v);
  };
  $walk($data);
  return $out;
}

/**
 * Nodi critici con i loro collegamenti in ingresso/uscita (a quale nodo, quale
 * porta): serve a capire cosa riceve e dove finisce il risultato del codice.
 */
function fr_critical_with_links(?array $data): array {
  $out = [];
  foreach (fr_graphs($data) as $g) {
    $byId = [];
    foreach ($g['nodes'] as $n) if (is_array($n) && isset($n['id'])) $byId[$n['id']] = $n;
    $label = function ($id) use ($byId) {
      $n = $byId[$id] ?? null;
      if (!$n) return "#$id";
      $t = (string)($n['title'] ?? '');
      return ($t !== '' ? $t : (string)($n['type'] ?? '?')) . " #$id";
    };
    foreach ($g['nodes'] as $n) {
      if (!is_array($n) || !isset(FV_CRITICAL_TYPES[$n['type'] ?? ''])) continue;
      $prop = FV_CRITICAL_TYPES[$n['type']];
      $in = []; $outL = [];
      foreach ($g['links'] as $l) {
        // formato LiteGraph: [id, origin_id, origin_slot, target_id, target_slot, type]
        if (!is_array($l) || !isset($l[0], $l[1], $l[3])) continue;
        [$lid, $oId, $oSlot, $tId, $tSlot] = $l;
        if ($tId === $n['id']) $in[]   = $label($oId) . " (uscita $oSlot) → ingresso $tSlot";
        if ($oId === $n['id']) $outL[] = "uscita $oSlot → " . $label($tId) . " (ingresso $tSlot)";
      }
      $out[] = [
        'id'      => $n['id'],
        'type'    => $n['type'],
        'title'   => (string)($n['title'] ?? ''),
        'code'    => (string)($n['properties'][$prop] ?? ''),
        'inputs'  => $in,
        'outputs' => $outL,
      ];
    }
  }
  return $out;
}

try {
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

  // ------------------------------------------------------------ queue
  if ($method === 'GET' && ($_GET['action'] ?? '') === 'queue') {
    // include_approved=1: anche i flow già validati (per rileggerli o revocarli)
    $states = !empty($_GET['include_approved']) ? "('pending','approved')" : "('pending')";
    $rows = $pdo->query("
      SELECT f.flow_id, f.flow_name, f.flow_type, f.flow_role, f.flow_review, f.flow_wp, f.author_id, f.updated_at,
             (f.flow_fle_published IS NOT NULL) AS has_published,
             w.wp_title, r.res_title,
             u.first_name, u.last_name, u.user_name
      FROM   flows f
      JOIN   workpackages w ON w.wp_id = f.flow_wp
      JOIN   researches  r ON r.res_id = w.res_id
      LEFT JOIN users    u ON u.id = f.author_id
      WHERE  f.flow_review IN $states
      ORDER  BY (f.flow_review = 'pending') DESC, f.updated_at ASC")->fetchAll(PDO::FETCH_ASSOC);
    $out = [];
    foreach ($rows as $r) {
      if (!fr_can_review($pdo, $r, $userId, $isAdmin)) continue;
      $name = trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? ''));
      $out[] = [
        'flow_id'       => (int)$r['flow_id'],
        'flow_name'     => (string)$r['flow_name'],
        'flow_type'     => (string)$r['flow_type'],
        'flow_role'     => (string)$r['flow_role'],
        'flow_review'   => (string)$r['flow_review'],
        'wp_title'      => (string)$r['wp_title'],
        'res_title'     => (string)$r['res_title'],
        'author_name'   => $name !== '' ? $name : (string)($r['user_name'] ?? ''),
        'author_is_me'  => (int)$r['author_id'] === $userId,
        'has_published' => (bool)$r['has_published'],
        'updated_at'    => (string)$r['updated_at'],
      ];
    }
    fr_ok(['items' => $out, 'can_bulk' => $isAdmin]);
  }

  // ------------------------------------------------------------ detail
  if ($method === 'GET' && ($_GET['action'] ?? '') === 'detail') {
    $flowId = (int)($_GET['flow_id'] ?? 0);
    $row = fr_load_flow($pdo, $flowId);
    if (!fr_can_review($pdo, $row, $userId, $isAdmin)) fr_err('Non puoi revisionare questo flow.', 403);

    $draft = fv_decode($row['flow_fle']);
    $pub   = fv_decode($row['flow_fle_published']);
    $draftCrit = fr_critical_with_links($draft);
    $pubCrit   = [];
    foreach (fr_critical_with_links($pub) as $c) $pubCrit[(string)$c['id']] = $c;

    // Stato di ogni nodo critico rispetto alla versione pubblicata
    foreach ($draftCrit as &$c) {
      $old = $pubCrit[(string)$c['id']] ?? null;
      if (!$old) { $c['status'] = 'nuovo'; $c['published_code'] = null; }
      else {
        $c['status'] = ($old['code'] === $c['code'] && $old['type'] === $c['type']) ? 'invariato' : 'modificato';
        $c['published_code'] = $old['code'];
        unset($pubCrit[(string)$c['id']]);
      }
    }
    unset($c);

    $countNodes = fn($d) => array_sum(array_map(fn($g) => count($g['nodes']), fr_graphs($d)));
    fr_ok([
      'flow_id'        => (int)$row['flow_id'],
      'flow_name'      => (string)$row['flow_name'],
      'flow_review'    => (string)$row['flow_review'],
      'hash'           => fv_hash($draft),
      'nodes_draft'    => $countNodes($draft),
      'nodes_published'=> $pub === null ? null : $countNodes($pub),
      'critical'       => $draftCrit,
      'removed'        => array_values($pubCrit),   // nodi critici pubblicati non più presenti nella bozza
    ]);
  }

  // ------------------------------------------------------------ history
  if ($method === 'GET' && ($_GET['action'] ?? '') === 'history') {
    $flowId = (int)($_GET['flow_id'] ?? 0);
    $row = fr_load_flow($pdo, $flowId);
    if (!fr_can_review($pdo, $row, $userId, $isAdmin)) fr_err('Non puoi revisionare questo flow.', 403);
    $st = $pdo->prepare("
      SELECT v.val_id, v.flow_hash, v.validated_at, v.note, v.revoked_at,
             u.first_name, u.last_name, u.user_name
      FROM   flow_validations v
      LEFT JOIN users u ON u.id = v.validated_by
      WHERE  v.flow_id = ?
      ORDER  BY v.validated_at DESC");
    $st->execute([$flowId]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $v) {
      $name = trim(($v['first_name'] ?? '') . ' ' . ($v['last_name'] ?? ''));
      $out[] = [
        'val_id'       => (int)$v['val_id'],
        'hash'         => (string)$v['flow_hash'],
        'validated_at' => (string)$v['validated_at'],
        'validated_by' => $name !== '' ? $name : (string)($v['user_name'] ?? ''),
        'note'         => (string)$v['note'],
        'revoked_at'   => $v['revoked_at'],
        'is_published' => $v['flow_hash'] === $row['flow_hash_published'],
      ];
    }
    fr_ok(['can_revoke' => $isAdmin, 'validations' => $out]);
  }

  if ($method !== 'POST') fr_err('Metodo o azione non supportati.', 405);

  $raw = file_get_contents('php://input');
  $req = $raw ? json_decode($raw, true) : null;
  if (!is_array($req)) fr_err('Body JSON non valido.');
  $action = (string)($req['action'] ?? '');

  // ------------------------------------------------------------ validate
  if ($action === 'validate') {
    $items = $req['items'] ?? null;
    if (!is_array($items) || !$items) fr_err('Nessun flow da validare.');
    if (count($items) > 1 && !$isAdmin) fr_err('La validazione in blocco è riservata all\'amministratore.', 403);
    $note = trim((string)($req['note'] ?? ''));

    $done = []; $failed = [];
    foreach ($items as $it) {
      $flowId = (int)($it['flow_id'] ?? 0);
      $seen   = (string)($it['hash'] ?? '');
      // Riga bloccata fino al commit: la bozza non può cambiare tra il
      // confronto dell'hash e la pubblicazione.
      $pdo->beginTransaction();
      try {
        $st = $pdo->prepare("SELECT * FROM flows WHERE flow_id = ? LIMIT 1 FOR UPDATE");
        $st->execute([$flowId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $error = null;
        if (!$row) $error = 'non trovato';
        elseif (!fr_can_review($pdo, $row, $userId, $isAdmin)) $error = 'non autorizzato';
        else {
          $hash = fv_hash(fv_decode($row['flow_fle']));
          if ($hash === null) $error = 'flow vuoto';
          elseif (!hash_equals($hash, $seen)) $error = 'la bozza è cambiata dopo la revisione: riaprila';
        }
        if ($error !== null) {
          $pdo->rollBack();
          $failed[] = ['flow_id' => $flowId, 'error' => $error];
          continue;
        }
        $valId = fv_record_validation($pdo, $flowId, $hash, (string)$row['flow_fle'], $userId, $note);
        $pdo->prepare("UPDATE flows SET flow_fle_published = flow_fle, flow_hash_published = ?, flow_review = 'approved'
                       WHERE flow_id = ?")->execute([$hash, $flowId]);
        $pdo->commit();
      } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
      }
      log_activity('flow:validate', 'flow', $flowId, (string)$row['flow_name'], ['val_id' => $valId, 'hash' => $hash]);
      $done[] = $flowId;
    }
    fr_ok(['validated' => $done, 'failed' => $failed]);
  }

  // ------------------------------------------------------------ revoke
  if ($action === 'revoke') {
    if (!$isAdmin) fr_err('Solo l\'amministratore può revocare una validazione.', 403);
    $valId = (int)($req['val_id'] ?? 0);
    $st = $pdo->prepare("SELECT v.flow_id, v.flow_hash, f.flow_hash_published, f.flow_name
                         FROM flow_validations v JOIN flows f ON f.flow_id = v.flow_id
                         WHERE v.val_id = ? AND v.revoked_at IS NULL LIMIT 1");
    $st->execute([$valId]);
    $v = $st->fetch(PDO::FETCH_ASSOC);
    if (!$v) fr_err('Validazione non trovata o già revocata.', 404);

    $pdo->beginTransaction();
    $pdo->prepare("UPDATE flow_validations SET revoked_at = NOW(), revoked_by = ? WHERE val_id = ?")
        ->execute([$userId, $valId]);
    // Se era la versione pubblicata, il flow torna in attesa: da subito il server
    // smette di servirla agli altri utenti (fv_version_for ricontrolla a ogni caricamento).
    if ($v['flow_hash'] === $v['flow_hash_published']) {
      $pdo->prepare("UPDATE flows SET flow_review = 'pending' WHERE flow_id = ?")->execute([(int)$v['flow_id']]);
    }
    $pdo->commit();
    log_activity('flow:revoke', 'flow', (int)$v['flow_id'], (string)$v['flow_name'], ['val_id' => $valId]);
    fr_ok(['val_id' => $valId]);
  }

  fr_err('Azione non supportata: ' . $action);

} catch (Throwable $e) {
  if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
  fr_err('Errore: ' . $e->getMessage(), 500);
}
