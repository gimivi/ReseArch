<?php
// ui/modal_item_authors_tools.php
// Autori (A) e collaboratori (C) di un oggetto o modello del WP corrente
// (authors_objects / authors_models, _doc/arch-permessi.md §11.3; passo 7 del §11.9).
//
//   GET  ?action=get&kind=object|model&id=N
//        → { authors:[{user_id,name,role}], candidates:[{user_id,name,role}], can_manage }
//   POST { action:"save", kind, id, authors:[{user_id, role}] }
//        → sostituisce l'elenco; { authors:[...] }
//
// Gestiscono l'elenco X, P della ricerca, W del WP e gli autori (A) dell'elemento.
// Autori fra P della ricerca, W e I del WP; collaboratori fra i C del WP. Chi è già
// nell'elenco con quel ruolo può restarci anche se non è più fra i candidati (es. gli
// elementi assegnati all'amministratore dalla migrazione). Serve almeno un autore.
// L'ordine di "authors" diventa auth_ord (1 = primo, mostrato come "creatore et al.").
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

require_once __DIR__ . '/../api/i18n.php';
require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/log_tool.php';
require_once __DIR__ . '/../api/edit_rights.php';

function ia_ok(array $data): never {
  echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
  exit;
}
function ia_err(string $msg, int $code = 400): never {
  http_response_code($code);
  echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

$user        = $_SESSION['user'] ?? null;
$research    = $_SESSION['research'] ?? null;
$workpackage = $_SESSION['workpackage'] ?? null;
if (!is_array($user) || empty($user['id'])) ia_err(t('errors.not_authenticated'), 401);
if (!is_array($research) || !is_array($workpackage)) ia_err(t('modal.item_authors.err.no_context.@'), 400);
if (!isset($pdo) || !($pdo instanceof PDO)) ia_err(t('errors.internal'), 500);

$userId = (int)$user['id'];
$resId  = (int)($research['res_id'] ?? 0);
$wpId   = (int)($workpackage['wp_id'] ?? 0);
if ($resId <= 0 || $wpId <= 0) ia_err(t('modal.item_authors.err.no_context.@'), 400);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body   = $method === 'POST' ? (json_decode((string)file_get_contents('php://input'), true) ?: []) : [];
$kind   = (string)($method === 'POST' ? ($body['kind'] ?? '') : ($_GET['kind'] ?? ''));
$id     = (int)($method === 'POST' ? ($body['id'] ?? 0) : ($_GET['id'] ?? 0));
if (!isset(RA_AUTHOR_TABLES[$kind]) || $id <= 0) ia_err(t('errors.invalid_request'), 400);

// L'elemento deve appartenere al WP corrente
$itemTable = $kind === 'object' ? 'objects' : 'models';
$col       = RA_AUTHOR_TABLES[$kind][1];
$st = $pdo->prepare("SELECT 1 FROM $itemTable WHERE $col = ? AND wp_id = ? LIMIT 1");
$st->execute([$id, $wpId]);
if (!$st->fetchColumn()) ia_err(t('modal.item_authors.err.not_in_wp.@'), 404);

$scope     = ra_edit_scope($pdo, $user);
$canManage = ra_can_manage_authors($pdo, $scope, $kind, $id, $wpId, $resId, $userId);

/** Elenco corrente degli autori dell'elemento. */
function ia_current(PDO $pdo, string $kind, int $id, int $wpId): array {
  return ra_authors_by_item($pdo, $kind, $wpId)[$id] ?? [];
}

try {
  if ($method === 'GET' && ($_GET['action'] ?? '') === 'get') {
    ia_ok([
      'authors'    => ia_current($pdo, $kind, $id, $wpId),
      'candidates' => array_values(ra_author_candidates($pdo, $wpId, $resId)),
      'can_manage' => $canManage,
    ]);
  }

  if ($method === 'POST' && ($body['action'] ?? '') === 'save') {
    if (!$canManage) ia_err(t('errors.not_authorized'), 403);

    $list = $body['authors'] ?? null;
    if (!is_array($list)) ia_err(t('errors.invalid_request'), 400);

    $candidates = ra_author_candidates($pdo, $wpId, $resId);
    $current = [];
    foreach (ia_current($pdo, $kind, $id, $wpId) as $a) $current[$a['user_id']] = $a['role'];

    $new = [];
    foreach ($list as $a) {
      $uid  = (int)($a['user_id'] ?? 0);
      $role = (($a['role'] ?? '') === 'C') ? 'C' : 'A';
      if ($uid <= 0 || isset($new[$uid])) continue;
      $allowed = (isset($candidates[$uid]) && $candidates[$uid]['role'] === $role)
              || (($current[$uid] ?? null) === $role);
      if (!$allowed) ia_err(t('modal.item_authors.err.not_candidate', ['id' => $uid]), 400);
      $new[$uid] = $role;
    }
    if (!in_array('A', $new, true)) ia_err(t('modal.item_authors.err.need_author'), 400);

    [$table] = RA_AUTHOR_TABLES[$kind];
    $pdo->beginTransaction();
    try {
      $pdo->prepare("DELETE FROM $table WHERE $col = ?")->execute([$id]);
      $ord = 0;   // posizione = ordine dell'elenco ricevuto (auth_ord, 1 = primo)
      foreach ($new as $uid => $role) ra_add_author($pdo, $kind, $id, $uid, $role, ++$ord);
      $pdo->commit();
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      throw $e;
    }

    log_activity($kind . ':authors', $kind, $id, '', ['authors' => $new]);
    ia_ok(['authors' => ia_current($pdo, $kind, $id, $wpId)]);
  }

  ia_err(t('errors.invalid_request'), 400);
} catch (Throwable $e) {
  ia_err(t('modal.item_authors.err.server', ['msg' => $e->getMessage()]), 500);
}
