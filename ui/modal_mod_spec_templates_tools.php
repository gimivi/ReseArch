<?php
// ui/modal_mod_spec_templates_tools.php
// CRUD della tabella mod_spec_templates (template del sub-modale "Spec (JSON)"
// dei Modelli) + esportazione SQL del seed. Step 1 di _doc/arch-abilitazioni.md.
//
// Riservato all'amministratore (X). La modale che lo usa
// (ui/modal_mod_spec_templates.php) è già visibile solo a X nel menu, ma
// l'endpoint verifica comunque da sé chi lo chiama (arch-permessi.md §4ter).
//
// GET  ?action=list    → { templates:[...tutti, anche inattivi], apps:[{cod,title}] }
// GET  ?action=export  → file SQL (install/04_ReseArch_Templates.sql aggiornato)
// POST {action:'save', tpl:{tpl_id?, app_cod, tpl_name, tpl_level, tpl_help, tpl_spec, tpl_sort, is_active}}
// POST {action:'delete', tpl_id}

declare(strict_types=1);

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

require_once __DIR__ . '/../api/i18n.php';
require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/log_tool.php';
require_once __DIR__ . '/../api/app_catalog.php';

function tt_ok($data = null): void {
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function tt_err(string $msg, int $code = 400): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

$_ttUser = $_SESSION['user'] ?? null;
if (!is_array($_ttUser) || empty($_ttUser['id'])) tt_err(t('errors.not_authenticated'), 401);
if ((string)($_ttUser['user_type'] ?? '') !== 'X') {
  tt_err(t('modal.platform_users.err.admin_only.@'), 403);
}

try {
  if (!isset($pdo) || !($pdo instanceof PDO)) tt_err(t('errors.internal'), 500);

  $method  = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  $catalog = app_catalog($pdo, user_caps($pdo, $_ttUser));

  // ------------------------------------------------------------ list
  if ($method === 'GET' && ($_GET['action'] ?? '') === 'list') {
    $rows = $pdo->query("SELECT tpl_id, app_cod, tpl_name, tpl_level, tpl_help, tpl_spec, tpl_sort, is_active, updated_at
                         FROM mod_spec_templates
                         ORDER BY app_cod ASC, tpl_sort ASC, tpl_name ASC")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
      $r['tpl_id']    = (int)$r['tpl_id'];
      $r['tpl_sort']  = (int)$r['tpl_sort'];
      $r['is_active'] = (int)$r['is_active'];
      // Riformattato per l'editor (MySQL restituisce il JSON compattato a modo suo)
      $r['tpl_spec']  = json_encode(json_decode((string)$r['tpl_spec']), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    unset($r);

    $apps = [['cod' => 'CUS', 'title' => t('modal.mod_spec_templates.app_custom')]];
    foreach ($catalog as $cod => $a) {
      $apps[] = ['cod' => $cod, 'title' => $a['status'] === 'hidden' ? t('modal.mod_spec_templates.app_hidden', ['title' => $a['title']]) : $a['title']];
    }
    tt_ok(['templates' => $rows, 'apps' => $apps]);
  }

  // ------------------------------------------------------------ export
  if ($method === 'GET' && ($_GET['action'] ?? '') === 'export') {
    $rows = $pdo->query("SELECT app_cod, tpl_name, tpl_level, tpl_help, tpl_spec, tpl_sort, is_active
                         FROM mod_spec_templates
                         ORDER BY app_cod ASC, tpl_sort ASC, tpl_name ASC")->fetchAll(PDO::FETCH_ASSOC);
    $values = [];
    foreach ($rows as $r) {
      $values[] = sprintf('(%s, %s, %s, %s, %s, %d, %d)',
        $pdo->quote((string)$r['app_cod']),
        $pdo->quote((string)$r['tpl_name']),
        $pdo->quote((string)$r['tpl_level']),
        $pdo->quote((string)$r['tpl_help']),
        $pdo->quote(json_encode(json_decode((string)$r['tpl_spec']), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)),
        (int)$r['tpl_sort'],
        (int)$r['is_active']);
    }
    $sql  = "-- =============================================================================\n";
    $sql .= "-- ReseArch - 04 - Template dei mod_spec (tabella mod_spec_templates)\n";
    $sql .= "-- =============================================================================\n";
    $sql .= "-- Esportato il " . date('Y-m-d H:i') . " dalla modale admin \"Template mod_spec\".\n";
    $sql .= "-- Sostituisce install/04_ReseArch_Templates.sql nel repository.\n";
    $sql .= "-- Eseguire dopo install/01_ReseArch_CreateDB.sql.\n";
    $sql .= "-- =============================================================================\n\n";
    if ($values) {
      $sql .= "INSERT INTO `mod_spec_templates`\n";
      $sql .= "  (`app_cod`, `tpl_name`, `tpl_level`, `tpl_help`, `tpl_spec`, `tpl_sort`, `is_active`) VALUES\n";
      $sql .= implode(",\n", $values) . ";\n";
    }
    header('Content-Type: application/sql; charset=utf-8');
    header('Content-Disposition: attachment; filename="seed_mod_spec_templates.sql"');
    echo $sql;
    exit;
  }

  if ($method !== 'POST') tt_err(t('errors.method_not_allowed'), 405);

  $raw = file_get_contents('php://input');
  $req = $raw ? json_decode($raw, true) : null;
  if (!is_array($req)) tt_err(t('errors.invalid_request'));
  $action = (string)($req['action'] ?? '');

  // ------------------------------------------------------------ save
  if ($action === 'save') {
    $t = $req['tpl'] ?? null;
    if (!is_array($t)) tt_err(t('errors.invalid_request'));

    $id    = (int)($t['tpl_id'] ?? 0);
    $app   = app_norm_cod($t['app_cod'] ?? '');
    $name  = trim((string)($t['tpl_name'] ?? ''));
    $level = (string)($t['tpl_level'] ?? 'base');
    $help  = (string)($t['tpl_help'] ?? '');
    $sort  = (int)($t['tpl_sort'] ?? 0);
    $act   = !empty($t['is_active']) ? 1 : 0;

    if ($app !== 'CUS' && !isset($catalog[$app])) tt_err(t('modal.mod_spec_templates.err.app_unknown', ['app' => $app]));
    if ($name === '' || mb_strlen($name) > 190) tt_err(t('modal.mod_spec_templates.err.name_invalid'));
    if (!in_array($level, ['base', 'advanced'], true)) tt_err(t('modal.mod_spec_templates.err.level_invalid'));

    // Lo spec deve essere un oggetto o array JSON valido: è il punto di partenza
    // incollato nell'editor dei modelli.
    $specRaw = $t['tpl_spec'] ?? '';
    $spec = is_string($specRaw) ? json_decode($specRaw) : json_decode(json_encode($specRaw));
    if (!is_object($spec) && !is_array($spec)) tt_err(t('modal.mod_spec_templates.spec_invalid'));
    $specJson = json_encode($spec, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $params = [
      ':app' => $app, ':name' => $name, ':level' => $level, ':help' => $help,
      ':spec' => $specJson, ':sort' => $sort, ':act' => $act,
    ];
    if ($id > 0) {
      $st = $pdo->prepare("UPDATE mod_spec_templates
                           SET app_cod=:app, tpl_name=:name, tpl_level=:level, tpl_help=:help,
                               tpl_spec=:spec, tpl_sort=:sort, is_active=:act
                           WHERE tpl_id=:id");
      $st->execute($params + [':id' => $id]);
      if ($st->rowCount() === 0) {
        $chk = $pdo->prepare("SELECT 1 FROM mod_spec_templates WHERE tpl_id=?");
        $chk->execute([$id]);
        if (!$chk->fetchColumn()) tt_err(t('modal.mod_spec_templates.err.not_found'), 404);
      }
      log_activity('template:edit', 'mod_spec_template', $id, $name);
    } else {
      $st = $pdo->prepare("INSERT INTO mod_spec_templates
                             (app_cod, tpl_name, tpl_level, tpl_help, tpl_spec, tpl_sort, is_active)
                           VALUES (:app, :name, :level, :help, :spec, :sort, :act)");
      $st->execute($params);
      $id = (int)$pdo->lastInsertId();
      log_activity('template:create', 'mod_spec_template', $id, $name);
    }
    tt_ok(['tpl_id' => $id]);
  }

  // ------------------------------------------------------------ delete
  if ($action === 'delete') {
    $id = (int)($req['tpl_id'] ?? 0);
    if ($id <= 0) tt_err(t('errors.invalid_request'));
    $st = $pdo->prepare("SELECT tpl_name FROM mod_spec_templates WHERE tpl_id=?");
    $st->execute([$id]);
    $name = $st->fetchColumn();
    if ($name === false) tt_err(t('modal.mod_spec_templates.err.not_found'), 404);
    $pdo->prepare("DELETE FROM mod_spec_templates WHERE tpl_id=?")->execute([$id]);
    log_activity('template:delete', 'mod_spec_template', $id, (string)$name);
    tt_ok(['tpl_id' => $id]);
  }

  tt_err(t('errors.invalid_request'));

} catch (Throwable $e) {
  tt_err(t('modal.mod_spec_templates.error', ['error' => $e->getMessage()]), 500);
}
