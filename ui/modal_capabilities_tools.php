<?php
// ui/modal_capabilities_tools.php
// Modale admin "Abilitazioni" (step 2 di _doc/arch-abilitazioni.md):
//   - profili di abilitazione: nome, descrizione, "vale per tutti", abilitazioni
//     (APP, livello template avanzato, permessi funzionali) e utenti assegnati;
//   - tabella `app`: accesso, stato, ordine (colonne dello step 0).
//
// Riservato all'amministratore (X): la voce di menu è visibile solo a X, ma
// l'endpoint verifica comunque da sé chi lo chiama (arch-permessi.md §4ter).
//
// GET  ?action=list  → { profiles, apps, users, perms }
// POST {action:'save_profile', profile:{profile_id?, profile_name, profile_desc, is_default, grants:[{kind,ref}], members:[user_id]}}
// POST {action:'delete_profile', profile_id}
// POST {action:'save_apps', apps:[{app_cod, app_access, app_status, app_sort}]}
// GET  ?action=csp_list → segnalazioni CSP aggregate (step 4)
// POST {action:'csp_clear'} → svuota la tabella csp_reports

declare(strict_types=1);

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../api/i18n.php';
require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/log_tool.php';
require_once __DIR__ . '/../api/app_catalog.php';

function ct_ok($data = null): void {
  echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
  exit;
}
function ct_err(string $msg, int $code = 400): void {
  http_response_code($code);
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

$_ctUser = $_SESSION['user'] ?? null;
if (!is_array($_ctUser) || empty($_ctUser['id'])) ct_err(t('errors.not_authenticated'), 401);
if ((string)($_ctUser['user_type'] ?? '') !== 'X') {
  ct_err(t('modal.platform_users.err.admin_only.@'), 403);
}

const CT_ACCESS = ['all', 'granted', 'admin'];
const CT_STATUS = ['active', 'beta', 'hidden'];
const CT_TEMPLATE_LEVELS = ['advanced'];

try {
  if (!isset($pdo) || !($pdo instanceof PDO)) ct_err(t('errors.internal'), 500);
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

  // ------------------------------------------------------------ list
  if ($method === 'GET' && ($_GET['action'] ?? '') === 'list') {
    $profiles = $pdo->query("SELECT profile_id, profile_name, profile_desc, is_default
                             FROM cap_profiles
                             ORDER BY is_default DESC, profile_name ASC")->fetchAll(PDO::FETCH_ASSOC);
    $byId = [];
    foreach ($profiles as $p) {
      $byId[(int)$p['profile_id']] = [
        'profile_id'   => (int)$p['profile_id'],
        'profile_name' => (string)$p['profile_name'],
        'profile_desc' => (string)$p['profile_desc'],
        'is_default'   => (int)$p['is_default'],
        'grants'       => [],
        'members'      => [],
      ];
    }
    foreach ($pdo->query("SELECT profile_id, kind, ref FROM cap_grants")->fetchAll(PDO::FETCH_ASSOC) as $g) {
      $id = (int)$g['profile_id'];
      if (isset($byId[$id])) $byId[$id]['grants'][] = ['kind' => $g['kind'], 'ref' => $g['ref']];
    }
    foreach ($pdo->query("SELECT profile_id, user_id FROM users_cap_profiles")->fetchAll(PDO::FETCH_ASSOC) as $m) {
      $id = (int)$m['profile_id'];
      if (isset($byId[$id])) $byId[$id]['members'][] = (int)$m['user_id'];
    }

    $apps = $pdo->query("SELECT app_cod, app_title, app_access, app_status, app_sort
                         FROM app
                         ORDER BY app_sort ASC, app_title ASC")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($apps as &$a) {
      $a['app_cod'] = app_norm_cod($a['app_cod']);
      $a['app_sort'] = (int)$a['app_sort'];
    }
    unset($a);

    $users = $pdo->query("SELECT id AS user_id, last_name, first_name, email, user_type
                          FROM users
                          WHERE is_verified = 1
                          ORDER BY last_name ASC, first_name ASC")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($users as &$u) $u['user_id'] = (int)$u['user_id'];
    unset($u);

    // Etichette dei permessi nella lingua dell'interfaccia; un permesso nuovo senza chiave
    // mostra l'etichetta italiana di cap_perm_labels().
    $permKeys = ['validate_flows' => 'modal.capabilities.perm.validate_flows.@'];
    $perms = [];
    foreach (cap_perm_labels() as $ref => $label) {
      $perms[] = ['ref' => $ref, 'label' => isset($permKeys[$ref]) ? t($permKeys[$ref]) : $label];
    }

    ct_ok(['profiles' => array_values($byId), 'apps' => $apps, 'users' => $users, 'perms' => $perms]);
  }

  // ------------------------------------------------------------ csp_list
  if ($method === 'GET' && ($_GET['action'] ?? '') === 'csp_list') {
    $rows = $pdo->query("SELECT directive, blocked, page, hits, sample, first_seen, last_seen
                         FROM csp_reports
                         ORDER BY directive ASC, hits DESC
                         LIMIT 2000")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) $r['hits'] = (int)$r['hits'];
    unset($r);
    ct_ok($rows);
  }

  if ($method !== 'POST') ct_err(t('errors.method_not_allowed'), 405);

  $raw = file_get_contents('php://input');
  $req = $raw ? json_decode($raw, true) : null;
  if (!is_array($req)) ct_err(t('errors.invalid_request'));
  $action = (string)($req['action'] ?? '');

  // ------------------------------------------------------------ save_profile
  if ($action === 'save_profile') {
    $p = $req['profile'] ?? null;
    if (!is_array($p)) ct_err(t('errors.invalid_request'));

    $id   = (int)($p['profile_id'] ?? 0);
    $name = trim((string)($p['profile_name'] ?? ''));
    $desc = trim((string)($p['profile_desc'] ?? ''));
    $def  = !empty($p['is_default']) ? 1 : 0;
    if ($name === '' || mb_strlen($name) > 100) ct_err(t('modal.capabilities.err.name_invalid'));
    if (mb_strlen($desc) > 255) ct_err(t('modal.capabilities.err.desc_too_long'));

    // Abilitazioni: solo valori noti (APP esistenti, livelli e permessi elencati).
    $appCodes = array_map('app_norm_cod', $pdo->query("SELECT app_cod FROM app")->fetchAll(PDO::FETCH_COLUMN));
    $grants = [];
    foreach ((array)($p['grants'] ?? []) as $g) {
      $kind = (string)($g['kind'] ?? '');
      $ref  = (string)($g['ref'] ?? '');
      if ($kind === 'app') {
        $ref = app_norm_cod($ref);
        if (!in_array($ref, $appCodes, true)) ct_err(t('modal.capabilities.err.app_unknown', ['app' => $ref]));
      } elseif ($kind === 'template_level') {
        if (!in_array($ref, CT_TEMPLATE_LEVELS, true)) ct_err(t('modal.capabilities.err.tpl_level_invalid', ['level' => $ref]));
      } elseif ($kind === 'perm') {
        if (!array_key_exists($ref, cap_perm_labels())) ct_err(t('modal.capabilities.err.perm_invalid', ['perm' => $ref]));
      } else {
        ct_err(t('modal.capabilities.err.kind_invalid', ['kind' => $kind]));
      }
      $grants["$kind|$ref"] = [$kind, $ref];
    }

    // Utenti: solo id esistenti. Con "vale per tutti" l'elenco è superfluo e
    // viene svuotato, per non lasciare assegnazioni che non si vedono.
    $members = [];
    if (!$def) {
      $ids = array_values(array_unique(array_filter(array_map('intval', (array)($p['members'] ?? [])))));
      if ($ids) {
        $in = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT id FROM users WHERE id IN ($in)");
        $st->execute($ids);
        $members = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
      }
    }

    $pdo->beginTransaction();
    try {
      if ($id > 0) {
        $st = $pdo->prepare("UPDATE cap_profiles SET profile_name=?, profile_desc=?, is_default=? WHERE profile_id=?");
        $st->execute([$name, $desc, $def, $id]);
        $chk = $pdo->prepare("SELECT 1 FROM cap_profiles WHERE profile_id=?");
        $chk->execute([$id]);
        if (!$chk->fetchColumn()) { $pdo->rollBack(); ct_err(t('modal.capabilities.err.profile_not_found'), 404); }
        $pdo->prepare("DELETE FROM cap_grants WHERE profile_id=?")->execute([$id]);
        $pdo->prepare("DELETE FROM users_cap_profiles WHERE profile_id=?")->execute([$id]);
      } else {
        $st = $pdo->prepare("INSERT INTO cap_profiles (profile_name, profile_desc, is_default) VALUES (?, ?, ?)");
        $st->execute([$name, $desc, $def]);
        $id = (int)$pdo->lastInsertId();
      }
      $stG = $pdo->prepare("INSERT INTO cap_grants (profile_id, kind, ref) VALUES (?, ?, ?)");
      foreach ($grants as [$kind, $ref]) $stG->execute([$id, $kind, $ref]);
      $stM = $pdo->prepare("INSERT INTO users_cap_profiles (user_id, profile_id) VALUES (?, ?)");
      foreach ($members as $uid) $stM->execute([$uid, $id]);
      $pdo->commit();
    } catch (PDOException $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      if ($e->getCode() === '23000') ct_err(t('modal.capabilities.err.profile_exists', ['name' => $name]));
      throw $e;
    }

    log_activity('profile:save', 'cap_profile', $id, $name, [
      'grants' => array_values(array_map(fn($g) => "$g[0]:$g[1]", $grants)),
      'members' => count($members),
      'is_default' => $def,
    ]);
    ct_ok(['profile_id' => $id]);
  }

  // ------------------------------------------------------------ delete_profile
  if ($action === 'delete_profile') {
    $id = (int)($req['profile_id'] ?? 0);
    if ($id <= 0) ct_err(t('errors.invalid_request'));
    $st = $pdo->prepare("SELECT profile_name FROM cap_profiles WHERE profile_id=?");
    $st->execute([$id]);
    $name = $st->fetchColumn();
    if ($name === false) ct_err(t('modal.capabilities.err.profile_not_found'), 404);
    // cap_grants e users_cap_profiles si cancellano in cascata (FK)
    $pdo->prepare("DELETE FROM cap_profiles WHERE profile_id=?")->execute([$id]);
    log_activity('profile:delete', 'cap_profile', $id, (string)$name);
    ct_ok(['profile_id' => $id]);
  }

  // ------------------------------------------------------------ save_apps
  if ($action === 'save_apps') {
    $list = $req['apps'] ?? null;
    if (!is_array($list)) ct_err(t('errors.invalid_request'));
    $st = $pdo->prepare("UPDATE app SET app_access=?, app_status=?, app_sort=? WHERE app_cod=?");
    $pdo->beginTransaction();
    foreach ($list as $a) {
      $cod    = app_norm_cod($a['app_cod'] ?? '');
      $access = (string)($a['app_access'] ?? '');
      $status = (string)($a['app_status'] ?? '');
      if ($cod === '') continue;
      if (!in_array($access, CT_ACCESS, true)) { $pdo->rollBack(); ct_err(t('modal.capabilities.err.access_invalid', ['app' => $cod])); }
      if (!in_array($status, CT_STATUS, true)) { $pdo->rollBack(); ct_err(t('modal.capabilities.err.status_invalid', ['app' => $cod])); }
      $st->execute([$access, $status, (int)($a['app_sort'] ?? 0), $cod]);
    }
    $pdo->commit();
    log_activity('app:config', 'app', null, '', ['count' => count($list)]);
    ct_ok(true);
  }

  // ------------------------------------------------------------ csp_clear
  if ($action === 'csp_clear') {
    $n = (int)$pdo->exec("DELETE FROM csp_reports");
    log_activity('csp:clear', 'csp_reports', null, '', ['rows' => $n]);
    ct_ok(['deleted' => $n]);
  }

  ct_err(t('errors.invalid_request'));

} catch (Throwable $e) {
  if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
  ct_err(t('modal.capabilities.error', ['error' => $e->getMessage()]), 500);
}
