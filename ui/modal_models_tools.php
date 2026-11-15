<?php
// modal_models_tools.php (UPDATED per nuova struttura tabella models)
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

require_once __DIR__ . '/../api/i18n.php';   // messaggi nella lingua della richiesta (chiavi modal.models.err.*)
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
  // Se hai già reso cached folders_read_json_body(), puoi usare quella.
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}

// --- DB ---
if (!isset($pdo) || !($pdo instanceof PDO)) json_err(t('modal.models.err.db_unavailable'), 500);

// --- Session context ---
$research = $_SESSION['research'] ?? null;
$workpackage = $_SESSION['workpackage'] ?? null;
if (!is_array($research) || !is_array($workpackage)) {
  json_err(t('modal.models.err.no_context.@'), 500);
}

$user = folders_current_user();

// Permessi per singolo modello (2026-10-10, passo 4 di _doc/arch-permessi.md §11.9):
// creano X, P della ricerca, W e I del WP (e diventano autori); modificano ed
// eliminano X, P, W e gli autori o collaboratori del modello (api/edit_rights.php).
$isAdmin = isset($user['user_type']) && $user['user_type'] === 'X';
$res_id  = (int)($research['res_id'] ?? 0);
$wp_id   = (int)($workpackage['wp_id'] ?? 0);
if ($wp_id <= 0) json_err(t('modal.models.err.no_wp_id'), 500);

$userId     = (int)($user['id'] ?? 0);
$editScope  = ra_edit_scope($pdo, $user);
$CAN_CREATE = ra_scope_can_create($editScope, $wp_id, $res_id);
$canEditMod = fn(int $id): bool => ra_scope_can_edit($editScope, 'model', $id, $wp_id, $res_id);

// FIX (2026-09-17): la modalità "inject" di model_HTM.mjs esegue markup/script
// nel pieno contesto della pagina (nessun sandbox) — la documentazione dice
// da sempre che deve restare riservata all'amministratore, ma nessun file
// lo applicava mai: chiunque potesse editare mod_spec (X/P/W) poteva salvare
// mode:"inject" o srcdoc (auto-rilevato come inject se mode è assente, vedi
// model_HTM.mjs::_resolveMode). Non è possibile filtrare per obj_app qui:
// questa modale gestisce i modelli a livello di WP, non di singolo oggetto
// (il collegamento mod↔obj è un'associazione a parte, modal_objmod_links_tools.php)
// — quindi il controllo guarda direttamente la FORMA del mod_spec, indipendentemente
// da quale oggetto lo userà. Stesso identico controllo in api/mod_spec_tool.php.
//
// AGGIORNAMENTO (2026-09-17, nodi HTM/DOM/*): mode:"flow" NON riattiva
// <script> (l'esecuzione passa dai flow embedded), ma uno srcdoc statico può
// comunque nascondere onclick=/onerror=/href="javascript:" — vettori non
// filtrati anche senza <script> — quindi resta riservato a X SOLO quando
// porta uno srcdoc non vuoto. Un documento "flow" senza srcdoc (interfaccia
// costruita interamente dai nodi HTM/DOM/* del flow) resta libero per P/WPL,
// che è l'intero scopo della nuova modalità.
function mod_spec_inject_needs_admin(array $spec): bool {
  $mode   = $spec['mode'] ?? null;
  $srcdoc = $spec['srcdoc'] ?? null;
  $hasSrcdoc = is_string($srcdoc) && trim($srcdoc) !== '';
  if ($mode === 'inject') return true;
  if ($mode === null && $hasSrcdoc) return true; // auto-rilevato come inject
  if ($mode === 'flow' && $hasSrcdoc) return true;
  return false;
}

$res_folder_id = (int)($research['res_folder_id'] ?? 0);
$wp_folder_id  = (int)($workpackage['wp_folder_id'] ?? 0);
if ($res_folder_id <= 0 || $wp_folder_id <= 0) json_err(t('modal.models.err.no_folders'), 500);

// --- helpers folders ---
function db_get_folder(PDO $pdo, int $folder_id): ?array {
  $st = $pdo->prepare("SELECT folder_id, folder_name, folder_parent_id FROM folders WHERE folder_id=?");
  $st->execute([$folder_id]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return $r ?: null;
}

function get_folder_name(PDO $pdo, int $folder_id): string {
  $r = db_get_folder($pdo, $folder_id);
  if (!$r) json_err(t('modal.models.err.folder_not_found.@', ['id' => $folder_id]), 404);
  return (string)$r['folder_name'];
}

function assert_subfolder_of_wp(PDO $pdo, int $subfolder_id, int $wp_folder_id): array {
  $sub = db_get_folder($pdo, $subfolder_id);
  if (!$sub) json_err(t('modal.models.err.subfolder_not_found.@'), 404);
  if ((int)($sub['folder_parent_id'] ?? 0) !== $wp_folder_id) {
    json_err(t('modal.models.err.not_wp_subfolder.@'), 403);
  }
  return $sub;
}

function resolve_subfolder_abs_path(PDO $pdo, string $BASE_FS, int $res_folder_id, int $wp_folder_id, int $subfolder_id): array {
  $res_name = get_folder_name($pdo, $res_folder_id);
  $wp_name  = get_folder_name($pdo, $wp_folder_id);
  $sub = assert_subfolder_of_wp($pdo, $subfolder_id, $wp_folder_id);
  $sub_name = (string)$sub['folder_name'];

  foreach ([$res_name, $wp_name, $sub_name] as $seg) {
    folders_assert_safe_segment($seg);
  }

  $abs = rtrim($BASE_FS, DIRECTORY_SEPARATOR)
       . DIRECTORY_SEPARATOR . $res_name
       . DIRECTORY_SEPARATOR . $wp_name
       . DIRECTORY_SEPARATOR . $sub_name;

  return ['abs' => $abs, 'sub_name' => $sub_name];
}

function sanitize_rel_path(string $path): string {
  $path = trim(str_replace('\\', '/', $path));
  if ($path === '' || $path === '.') return '';
  if (str_starts_with($path, '/')) $path = ltrim($path, '/');

  $parts = explode('/', $path);
  $safe = [];
  foreach ($parts as $p) {
    if ($p === '' || $p === '.') continue;
    if ($p === '..') json_err(t('modal.models.err.path_dotdot'), 400);
    if (!preg_match('/^[A-Za-z0-9_\-\.]+$/', $p)) json_err(t('modal.models.err.path_segment', ['seg' => $p]), 400);
    folders_assert_safe_segment($p);
    $safe[] = $p;
  }
  return implode('/', $safe);
}

function file_exists_in_subfolder(PDO $pdo, string $BASE_FS, int $res_folder_id, int $wp_folder_id, int $subfolder_id, string $relFile): bool {
  if ($subfolder_id <= 0) return false;

  $relFile = sanitize_rel_path($relFile);
  if ($relFile === '') return false;

  $r = resolve_subfolder_abs_path($pdo, $BASE_FS, $res_folder_id, $wp_folder_id, $subfolder_id);
  $absRoot = $r['abs'];

  $full = rtrim($absRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relFile);
  return is_file($full);
}

/**
 * (2026-10-03) Modello "senza file": cartella 0 e nome file vuoto, scelto con
 * "Nessun file (dati dal flow)" nel selettore. L'APP parte senza caricare dati
 * da file (li riceve per esempio da un flow); il mod_spec resta letto e la
 * configura. Altrimenti cartella e file devono essere entrambi validi.
 */
function model_check_file(PDO $pdo, int $folder_id, string $filename, int $wp_folder_id, string $ctx = ''): void {
  if ($folder_id <= 0 && $filename === '') return;   // nessun file
  if ($folder_id <= 0) json_err(t('modal.models.err.folder_id_missing', ['ctx' => $ctx]), 400);
  assert_subfolder_of_wp($pdo, $folder_id, $wp_folder_id);
  if ($filename === '') json_err(t('modal.models.err.filename_missing', ['ctx' => $ctx]), 400);
}

/** 1 = file assente su disco; 0 = presente, oppure modello senza file. */
function model_missing_flag(PDO $pdo, string $BASE_FS, int $res_folder_id, int $wp_folder_id, int $subfolder_id, string $fn): int {
  if ($subfolder_id <= 0 && $fn === '') return 0;
  return file_exists_in_subfolder($pdo, $BASE_FS, $res_folder_id, $wp_folder_id, $subfolder_id, $fn) ? 0 : 1;
}

// --- Router ---
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? null;
$BASE_FS = folders_get_base_fs();

try {
  // ---------------- GET: list_models ----------------
  if ($method === 'GET' && $action === 'list_models') {
    // Nuova tabella: niente res_id
    $st = $pdo->prepare("SELECT * FROM models WHERE wp_id=? ORDER BY mod_id DESC");
    $st->execute([$wp_id]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $authorsBy = ra_authors_by_item($pdo, 'model', $wp_id);   // colonna "Autori" (passo 7)

    foreach ($rows as &$r) {
      $subfolder_id = (int)($r['mod_folder_id'] ?? 0);
      $fn = (string)($r['mod_filename'] ?? '');

      $r['is_missing'] = model_missing_flag($pdo, $BASE_FS, $res_folder_id, $wp_folder_id, $subfolder_id, $fn);

      // Compatibilità JS: se il client usa ancora folder_id, lo forniamo
      $r['folder_id'] = $subfolder_id;
      $r['can_edit'] = $canEditMod((int)$r['mod_id']);
      $r['authors']  = $authorsBy[(int)$r['mod_id']] ?? [];
    }

    json_ok($rows);
  }

  // ---------------- POST actions ----------------
  if ($method !== 'POST') json_err(t('errors.invalid_request'), 400);

  $body = read_json_body();
  $actionPost = (string)($body['action'] ?? '');

  // list_dir: navigazione sotto subfolder
  if ($actionPost === 'list_dir') {
    // accetta folder_id (legacy) o mod_folder_id
    $folder_id = (int)($body['folder_id'] ?? ($body['mod_folder_id'] ?? 0));
    if ($folder_id <= 0) json_err(t('modal.models.err.folder_id_missing', ['ctx' => '']), 400);

    $path = sanitize_rel_path((string)($body['path'] ?? ''));

    $root = resolve_subfolder_abs_path($pdo, $BASE_FS, $res_folder_id, $wp_folder_id, $folder_id);
    $absRoot = $root['abs'];
    $rootName = $root['sub_name'];

    $abs = $absRoot;
    if ($path !== '') {
      $abs = rtrim($absRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $path);
    }

    $dirs = [];
    $files = [];

    if (is_dir($abs)) {
      $items = @scandir($abs);
      if (is_array($items)) {
        foreach ($items as $it) {
          if ($it === '.' || $it === '..') continue;
          if (str_starts_with($it, '.')) continue;

          $p = $abs . DIRECTORY_SEPARATOR . $it;

          if (is_dir($p)) {
            $dirs[] = $it;
            continue;
          }
          if (is_file($p)) {
            // filtro estensioni (DISABILITATO per ora)
            /*
            $ext = strtolower(pathinfo($it, PATHINFO_EXTENSION));
            $allowed = ['obj','gltf','glb','wrl','vrml','drc','ply','png','jpg','jpeg','pdf'];
            if ($ext === '' || !in_array($ext, $allowed, true)) continue;
            */
            $files[] = $it;
          }
        }
      }
    }

    sort($dirs, SORT_NATURAL | SORT_FLAG_CASE);
    sort($files, SORT_NATURAL | SORT_FLAG_CASE);

    json_ok([
      'root_name' => $rootName,
      'cwd' => $path,
      'dirs' => $dirs,
      'files' => $files,
    ]);
  }

  // batch: inserts/updates/deletes in un'unica transazione (pattern UX
  // Object/Flows — righe temporanee lato client, un solo Salva)
  if ($actionPost === 'batch') {

    $inserts = $body['inserts'] ?? [];
    $updates = $body['updates'] ?? [];
    $deletes = $body['deletes'] ?? [];
    if (!is_array($inserts) || !is_array($updates) || !is_array($deletes)) {
      json_err(t('modal.models.err.batch_invalid'), 400);
    }

    if (count($inserts) > 0 && !$CAN_CREATE) json_err(t('errors.not_authorized'), 403);

    $pdo->beginTransaction();
    try {
      $logEntries = [];

      foreach ($inserts as $row) {
        $mod_name = trim((string)($row['mod_name'] ?? ''));
        if ($mod_name === '') json_err(t('modal.models.err.name_required', ['ctx' => ' (insert)']), 400);

        $mod_description = (string)($row['mod_description'] ?? '');

        $mod_folder_id = (int)($row['folder_id'] ?? ($row['mod_folder_id'] ?? 0));   // folder_id: il campo che la modale modifica
        $mod_filename = sanitize_rel_path((string)($row['mod_filename'] ?? ''));
        model_check_file($pdo, $mod_folder_id, $mod_filename, $wp_folder_id, ' (insert)');

        $mod_spec = $row['mod_spec'] ?? ['type' => 'custom'];
        if (is_string($mod_spec)) {
          $decoded = json_decode($mod_spec, true);
          if (!is_array($decoded) && $decoded !== null) json_err(t('modal.models.err.spec_invalid_json'), 400);
          $mod_spec = $decoded ?? ['type' => 'custom'];
        }
        if (!is_array($mod_spec)) json_err(t('modal.models.err.spec_not_object'), 400);
        if (mod_spec_inject_needs_admin($mod_spec) && !$isAdmin) {
          json_err(t('modal.models.err.inject_admin_only.@'), 403);
        }

        $mod_show  = (int)($row['mod_show'] ?? 1);
        $mod_share = (int)($row['mod_share'] ?? 1);
        if (!in_array($mod_show, [0, 1, 2, 3, 4, 5], true)) json_err(t('modal.models.err.show_invalid'), 400);
        if (!in_array($mod_share, [0, 1, 2, 3], true)) json_err(t('modal.models.err.share_invalid'), 400);

        $st = $pdo->prepare("
          INSERT INTO models (wp_id, mod_folder_id, mod_name, mod_description, mod_filename, mod_spec, mod_show, mod_share)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $st->execute([
          $wp_id, $mod_folder_id, $mod_name, $mod_description, $mod_filename,
          json_encode($mod_spec, JSON_UNESCAPED_UNICODE), $mod_show, $mod_share
        ]);

        $newId = (int)$pdo->lastInsertId();
        ra_add_author($pdo, 'model', $newId, $userId);
        $logEntries[] = ['model:create', $newId, $mod_name];
      }

      foreach ($updates as $row) {
        $mod_id = (int)($row['mod_id'] ?? 0);
        if ($mod_id <= 0) json_err(t('modal.models.err.id_missing', ['ctx' => ' (update)']), 400);
        if (!$canEditMod($mod_id)) json_err(t('errors.item_not_editable', ['id' => $mod_id]), 403);

        $st = $pdo->prepare("SELECT mod_id FROM models WHERE mod_id=? AND wp_id=?");
        $st->execute([$mod_id, $wp_id]);
        if (!$st->fetch(PDO::FETCH_ASSOC)) json_err(t('modal.models.err.model_not_found_id.@', ['id' => $mod_id]), 404);

        $mod_name = trim((string)($row['mod_name'] ?? ''));
        if ($mod_name === '') json_err(t('modal.models.err.name_required', ['ctx' => ' (update)']), 400);

        $mod_description = (string)($row['mod_description'] ?? '');

        $mod_folder_id = (int)($row['folder_id'] ?? ($row['mod_folder_id'] ?? 0));   // folder_id: il campo che la modale modifica
        $mod_filename = sanitize_rel_path((string)($row['mod_filename'] ?? ''));
        model_check_file($pdo, $mod_folder_id, $mod_filename, $wp_folder_id, ' (update)');

        $mod_spec = $row['mod_spec'] ?? ['type' => 'custom'];
        if (is_string($mod_spec)) {
          $decoded = json_decode($mod_spec, true);
          if (!is_array($decoded) && $decoded !== null) json_err(t('modal.models.err.spec_invalid_json'), 400);
          $mod_spec = $decoded ?? ['type' => 'custom'];
        }
        if (!is_array($mod_spec)) json_err(t('modal.models.err.spec_not_object'), 400);
        if (mod_spec_inject_needs_admin($mod_spec) && !$isAdmin) {
          json_err(t('modal.models.err.inject_admin_only.@'), 403);
        }

        $mod_show  = (int)($row['mod_show'] ?? 1);
        $mod_share = (int)($row['mod_share'] ?? 1);
        if (!in_array($mod_show, [0, 1, 2, 3, 4, 5], true)) json_err(t('modal.models.err.show_invalid'), 400);
        if (!in_array($mod_share, [0, 1, 2, 3], true)) json_err(t('modal.models.err.share_invalid'), 400);

        $st = $pdo->prepare("
          UPDATE models
          SET mod_folder_id=?, mod_name=?, mod_description=?, mod_filename=?, mod_spec=?, mod_show=?, mod_share=?
          WHERE mod_id=? AND wp_id=?
        ");
        $st->execute([
          $mod_folder_id, $mod_name, $mod_description, $mod_filename,
          json_encode($mod_spec, JSON_UNESCAPED_UNICODE), $mod_show, $mod_share,
          $mod_id, $wp_id
        ]);

        $logEntries[] = ['model:edit', $mod_id, $mod_name];
      }

      foreach ($deletes as $mod_id) {
        $mod_id = (int)$mod_id;
        if ($mod_id <= 0) continue;

        $st = $pdo->prepare("SELECT mod_id FROM models WHERE mod_id=? AND wp_id=?");
        $st->execute([$mod_id, $wp_id]);
        if (!$st->fetch(PDO::FETCH_ASSOC)) continue;
        if (!$canEditMod($mod_id)) json_err(t('errors.item_not_editable', ['id' => $mod_id]), 403);

        // object_models_connections e' MyISAM senza FK: nessun cascade,
        // va ripulita a mano prima di eliminare il modello.
        $pdo->prepare("DELETE FROM object_models_connections WHERE mod_id=?")->execute([$mod_id]);
        $pdo->prepare("DELETE FROM models WHERE mod_id=? AND wp_id=?")->execute([$mod_id, $wp_id]);
        ra_remove_authors($pdo, 'model', $mod_id);
        // dati dei moduli legati al modello (nessuna FOREIGN KEY)
        $pdo->prepare("DELETE FROM drawings_osd_pjs WHERE mod_id=?")->execute([$mod_id]);
        $pdo->prepare("DELETE FROM pdf_highlights WHERE mod_id=?")->execute([$mod_id]);

        $logEntries[] = ['model:delete', $mod_id, null];
      }

      $pdo->commit();

      foreach ($logEntries as [$evt, $id, $name]) {
        log_activity($evt, 'model', $id, $name);
      }

      json_ok(null);
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      throw $e;
    }
  }

  json_err(t('errors.invalid_request'), 400);

} catch (Throwable $e) {
  json_err(t('modal.models.err.server', ['msg' => $e->getMessage()]), 500);
}
