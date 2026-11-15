<?php
// ui/modal_uploads_tools.php (NUOVA VERSIONE per folder_parent_id)
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

require_once __DIR__ . '/../api/i18n.php';   // messaggi nella lingua della richiesta (chiavi modal.uploads.err.*)
require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/folders_tools.php';
require_once __DIR__ . '/../api/log_tool.php';
require_once __DIR__ . '/../api/edit_rights.php';
$CFG = require __DIR__ . '/../cfg/cfg_Upload.php';

function json_ok($data = null): void {
  echo json_encode(['success'=>true, 'data'=>$data], JSON_UNESCAPED_UNICODE);
  exit;
}
function json_err(string $m, int $code = 400): void {
  http_response_code($code);
  echo json_encode(['success'=>false, 'error'=>$m], JSON_UNESCAPED_UNICODE);
  exit;
}

// --- check DB ---
if (!isset($pdo) || !($pdo instanceof PDO)) {
  json_err(t('modal.uploads.err.db_unavailable'), 500);
}

// --- check session context ---
$research = $_SESSION['research'] ?? null;
$workpackage = $_SESSION['workpackage'] ?? null;

if (!is_array($research) || !is_array($workpackage)) {
  json_err(t('modal.uploads.err.no_context.@'), 500);
}

$user = folders_current_user();

// Permessi: chi crea modelli nel WP — X, P della ricerca, W e I del WP
// (2026-10-10, passo 4 di _doc/arch-permessi.md §11.9; prima solo X, P, W).
// I permessi si leggono dal database (api/edit_rights.php), non dalla sessione.
if (!ra_scope_can_create(ra_edit_scope($pdo, $user), (int)($workpackage['wp_id'] ?? 0), (int)($research['res_id'] ?? 0))) {
  json_err(t('errors.not_authorized'), 403);
}

$res_folder_id = (int)($research['res_folder_id'] ?? 0);
$wp_folder_id  = (int)($workpackage['wp_folder_id'] ?? 0);

if ($res_folder_id <= 0 || $wp_folder_id <= 0) {
  json_err(t('modal.uploads.err.no_folders'), 500);
}

// --- helper DB ---
function db_get_folder(PDO $pdo, int $folder_id): ?array {
  $st = $pdo->prepare("SELECT folder_id, folder_name, folder_parent_id FROM folders WHERE folder_id = ?");
  $st->execute([$folder_id]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

/**
 * Percorso su disco della subfolder $folder_id del workpackage corrente
 * (BASE / ricerca / workpackage / subfolder), con tutti i controlli di
 * gerarchia e di sicurezza dei segmenti. Usata sia dall'upload sia da list_dir.
 */
/**
 * true se RA_Data ha la protezione per i documenti (intestazione CSP sandbox): il file
 * RA_Data/.htaccess o RA_Data/web.config contiene il marcatore di cfg_Upload.php.
 * Modelli dei file: install/RA_Data/. Il marcatore non prova che il server applichi
 * davvero l'intestazione (va verificato una volta nel browser, vedi i commenti dei file).
 */
function upl_data_sandbox_ready(string $marker): bool {
  if ($marker === '') return false;
  $base = rtrim(folders_get_base_fs(), '/\\');
  foreach (['.htaccess', 'web.config'] as $name) {
    $p = $base . DIRECTORY_SEPARATOR . $name;
    if (is_file($p) && strpos((string)@file_get_contents($p), $marker) !== false) return true;
  }
  return false;
}

function upl_subfolder_base(PDO $pdo, int $folder_id, int $wp_folder_id, int $res_folder_id): array {
  $sub = db_get_folder($pdo, $folder_id);
  if (!$sub) json_err(t('modal.uploads.err.folder_invalid.@'), 400);
  // SOLO subfolder: parent deve essere wp_folder_id corrente
  if ((int)($sub['folder_parent_id'] ?? 0) !== $wp_folder_id) {
    json_err(t('modal.uploads.err.not_wp_subfolder.@'), 403);
  }
  $wp = db_get_folder($pdo, $wp_folder_id);
  if (!$wp) json_err(t('modal.uploads.err.wp_folder_not_found.@'), 500);
  if ((int)($wp['folder_parent_id'] ?? 0) !== $res_folder_id) {
    json_err(t('modal.uploads.err.bad_hierarchy.@'), 409);
  }
  $res = db_get_folder($pdo, $res_folder_id);
  if (!$res) json_err(t('modal.uploads.err.res_folder_not_found.@'), 500);
  foreach ([$res['folder_name'], $wp['folder_name'], $sub['folder_name']] as $seg) {
    folders_assert_safe_segment((string)$seg);
  }
  $base = rtrim(folders_get_base_fs(), DIRECTORY_SEPARATOR)
    . DIRECTORY_SEPARATOR . $res['folder_name']
    . DIRECTORY_SEPARATOR . $wp['folder_name']
    . DIRECTORY_SEPARATOR . $sub['folder_name'];
  return ['path' => $base, 'name' => (string)$sub['folder_name']];
}

/** Percorso relativo dentro la subfolder: solo segmenti sicuri, niente '..'. Ritorna [rel con '/', segmenti]. */
function upl_safe_rel(string $rel, string $segmentRe): array {
  $parts = [];
  foreach (explode('/', str_replace(chr(92), '/', trim($rel))) as $p) {
    if ($p === '' || $p === '.') continue;
    if ($p === '..') json_err(t('modal.uploads.err.path_dotdot'), 400);
    if (!preg_match($segmentRe, $p)) json_err(t('modal.uploads.err.path_segment', ['seg' => $p]), 400);
    folders_assert_safe_segment($p);
    $parts[] = $p;
  }
  return [implode('/', $parts), $parts];
}

// ---------------------------------------------------------------------------
// GET ?action=list_dir&folder_id=N&path=sotto/cartella  (2026-10-03)
// Contenuto di una cartella della subfolder: sottocartelle (con numero di
// elementi) e file (dimensione, data). La data è quella di CREAZIONE dove il
// sistema la fornisce (Windows/IIS: filectime); su Linux/Apache PHP non ha la
// data di creazione (filectime lì è l'ultima modifica dei metadati), quindi si
// usa l'ultima modifica del contenuto (filemtime) e date_kind lo dichiara.
// ---------------------------------------------------------------------------
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET' && ($_GET['action'] ?? '') === 'list_dir') {
  $folder_id = (int)($_GET['folder_id'] ?? 0);
  if ($folder_id <= 0) json_err(t('modal.uploads.err.folder_id_missing'), 400);
  $base = upl_subfolder_base($pdo, $folder_id, $wp_folder_id, $res_folder_id);
  [$cwd, $parts] = upl_safe_rel((string)($_GET['path'] ?? ''), $CFG['safe_path_segment']);
  $abs = $base['path'] . ($parts ? DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $parts) : '');

  $isWindows = PHP_OS_FAMILY === 'Windows';
  $dateOf = fn(string $p) => (int)($isWindows ? @filectime($p) : @filemtime($p));

  $dirs = []; $files = [];
  if (is_dir($abs)) {
    foreach (@scandir($abs) ?: [] as $it) {
      if ($it === '.' || $it === '..' || str_starts_with($it, '.')) continue;
      $p = $abs . DIRECTORY_SEPARATOR . $it;
      if (is_dir($p)) {
        $n = 0;
        foreach (@scandir($p) ?: [] as $x) { if ($x !== '.' && $x !== '..' && !str_starts_with($x, '.')) $n++; }
        $dirs[] = ['name' => $it, 'items' => $n, 'date' => $dateOf($p)];
      } elseif (is_file($p)) {
        $files[] = ['name' => $it, 'size' => (int)@filesize($p), 'date' => $dateOf($p)];
      }
    }
  }
  usort($dirs,  fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
  usort($files, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));

  json_ok([
    'root_name'  => $base['name'],
    'cwd'        => $cwd,
    'exists'     => is_dir($abs),
    'date_kind'  => $isWindows ? 'creazione' : 'modifica',
    'dirs'       => $dirs,
    'files'      => $files,
    'can_delete' => upl_is_admin($user),
  ]);
}

// ---------------------------------------------------------------------------
// Cancellazione di un file, solo amministratore (2026-10-21). Solo file, mai cartelle.
//   GET  ?action=file_usage&folder_id=N&path=sotto/cartella/file.ext → modelli che lo usano
//   POST action=delete_file, folder_id, path                          → cancella il file
// I modelli puntano al file con mod_folder_id + mod_filename (relativo alla subfolder):
// la conferma li elenca, la cancellazione non li tocca (restano con il file mancante).
// ---------------------------------------------------------------------------
function upl_is_admin(array $user): bool {
  return (string)($user['user_type'] ?? '') === 'X';
}

/** File dentro la subfolder: [percorso su disco, percorso relativo con '/']. Rifiuta cartelle e file nascosti. */
function upl_target_file(PDO $pdo, int $folder_id, string $path, array $CFG, int $wp_folder_id, int $res_folder_id): array {
  if ($folder_id <= 0) json_err(t('modal.uploads.err.folder_id_missing'), 400);
  $base = upl_subfolder_base($pdo, $folder_id, $wp_folder_id, $res_folder_id);
  [$rel, $parts] = upl_safe_rel($path, $CFG['safe_path_segment']);
  if (!$parts || str_starts_with((string)end($parts), '.')) json_err(t('modal.uploads.err.not_a_file'), 400);
  $abs = $base['path'] . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $parts);
  if (!is_file($abs)) json_err(t('modal.uploads.err.not_a_file'), 404);
  return [$abs, $rel];
}

/** Modelli che puntano al file (mod_filename confrontato dopo la stessa normalizzazione dei percorsi). */
function upl_models_using(PDO $pdo, int $folder_id, string $rel): array {
  $st = $pdo->prepare("SELECT mod_id, mod_name, mod_filename FROM models WHERE mod_folder_id = ?");
  $st->execute([$folder_id]);
  $out = [];
  foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $m) {
    $fn = trim(str_replace(chr(92), '/', (string)$m['mod_filename']), '/');
    if (strcasecmp($fn, $rel) === 0) $out[] = ['mod_id' => (int)$m['mod_id'], 'mod_name' => (string)$m['mod_name']];
  }
  return $out;
}

$_action = (string)($_GET['action'] ?? $_POST['action'] ?? '');

if ($_action === 'file_usage' || $_action === 'delete_file') {
  if (!upl_is_admin($user)) json_err(t('modal.uploads.err.admin_only.@'), 403);
  $folder_id = (int)($_GET['folder_id'] ?? $_POST['folder_id'] ?? 0);
  $path      = (string)($_GET['path'] ?? $_POST['path'] ?? '');

  if ($_action === 'file_usage') {
    [, $rel] = upl_target_file($pdo, $folder_id, $path, $CFG, $wp_folder_id, $res_folder_id);
    json_ok(['path' => $rel, 'models' => upl_models_using($pdo, $folder_id, $rel)]);
  }

  if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') json_err(t('modal.uploads.err.post_required'), 405);
  [$abs, $rel] = upl_target_file($pdo, $folder_id, $path, $CFG, $wp_folder_id, $res_folder_id);
  $models = upl_models_using($pdo, $folder_id, $rel);
  $size = (int)@filesize($abs);
  if (!@unlink($abs)) json_err(t('modal.uploads.err.delete_failed'), 500);

  log_activity('file:delete', 'file', $folder_id, $rel, [
    'size'   => $size,
    'models' => array_column($models, 'mod_id'),
  ]);
  json_ok(['deleted' => $rel, 'models' => $models]);
}

// --- upload file existence ---
if (!isset($_FILES['file'])) json_err(t('modal.uploads.err.file_missing'));
$f = $_FILES['file'];

// 1) errori upload PHP
if (!isset($f['error']) || $f['error'] !== UPLOAD_ERR_OK) {
  $map = [
    UPLOAD_ERR_INI_SIZE   => t('modal.uploads.err.php_ini_size'),
    UPLOAD_ERR_FORM_SIZE  => t('modal.uploads.err.php_form_size'),
    UPLOAD_ERR_PARTIAL    => t('modal.uploads.err.php_partial'),
    UPLOAD_ERR_NO_FILE    => t('modal.uploads.err.php_no_file'),
    UPLOAD_ERR_NO_TMP_DIR => t('modal.uploads.err.php_no_tmp_dir'),
    UPLOAD_ERR_CANT_WRITE => t('modal.uploads.err.php_cant_write'),
    UPLOAD_ERR_EXTENSION  => t('modal.uploads.err.php_extension'),
  ];
  $msg = $map[$f['error']] ?? t('modal.uploads.err.php_other', ['code' => $f['error'] ?? '']);
  json_err($msg, 400);
}

// 2) size applicativo
if ((int)$f['size'] > (int)$CFG['max_bytes']) {
  json_err(t('modal.uploads.err.too_large'), 400);
}

// 3) estensione
$ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
if ($ext === '' || !in_array($ext, $CFG['allowed_ext'], true)) {
  json_err(t('modal.uploads.err.ext_not_allowed', ['ext' => $ext]), 400);
}
// 3b) pagine HTML: solo con RA_Data protetta (cfg_Upload.php 'sandbox_ext')
if (in_array($ext, (array)($CFG['sandbox_ext'] ?? []), true)
    && !upl_data_sandbox_ready((string)($CFG['sandbox_marker'] ?? ''))) {
  json_err(t('modal.uploads.err.sandbox_required.@', ['ext' => $ext]), 400);
}

// 4) input (FormData)
$folder_id = (int)($_POST['folder_id'] ?? 0);
$rel = trim((string)($_POST['relativePath'] ?? ''));

if ($folder_id <= 0) json_err(t('modal.uploads.err.folder_id_missing'), 400);

// 5) Cartella di destinazione: BASE / ricerca / workpackage / subfolder (controlli in upl_subfolder_base)
$basePath = upl_subfolder_base($pdo, $folder_id, $wp_folder_id, $res_folder_id)['path'];

// 6) Sanitizzazione relativePath (solo sottocartelle)
$subDir = '';
if ($rel !== '' && strpos($rel, '/') !== false) {
  $dir = dirname(str_replace('\\','/',$rel));
  if ($dir !== '.' && $dir !== '') {
    $parts = explode('/', $dir);
    foreach ($parts as $p) {
      if ($p === '' || $p === '.') continue;
      if ($p === '..') json_err(t('modal.uploads.err.path_dotdot'), 400);
      if (!preg_match($CFG['safe_path_segment'], $p)) json_err(t('modal.uploads.err.path_segment', ['seg' => $p]), 400);
      // ulteriore check “segment safe” per coerenza
      folders_assert_safe_segment($p);
      $subDir .= DIRECTORY_SEPARATOR . $p;
    }
  }
}

$targetDir = $basePath . $subDir;

// 7) Crea directory target
if (!is_dir($targetDir)) {
  if (!@mkdir($targetDir, 0775, true)) {
    json_err(t('modal.uploads.err.mkdir_failed'), 500);
  }
}

// 8) Scrittura file (sovrascrittura consentita se CFG['overwrite'])
$dest = $targetDir . DIRECTORY_SEPARATOR . basename((string)$f['name']);

if (file_exists($dest) && empty($CFG['overwrite'])) {
  json_err(t('modal.uploads.err.exists'), 400);
}
if (file_exists($dest) && !@unlink($dest)) {
  // non blocco: provo comunque move_uploaded_file
}

if (!@move_uploaded_file($f['tmp_name'], $dest)) {
  json_err(t('modal.uploads.err.move_failed'), 500);
}

log_activity('file:upload', 'file', $folder_id, basename((string)$f['name']), [
  'size' => (int)$f['size'],
  'ext'  => $ext,
]);

json_ok([
  // percorso RELATIVO alla subfolder (prima: percorso assoluto su disco, che non va mostrato al browser)
  'saved_to' => ltrim(str_replace(DIRECTORY_SEPARATOR, '/', $subDir), '/') . ($subDir !== '' ? '/' : '') . basename((string)$f['name']),
  'size' => (int)$f['size'],
  'ext' => $ext,
  'folder_id' => $folder_id,
]);
