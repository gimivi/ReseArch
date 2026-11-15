<?php
// ui/modal_workpackage_images_tools.php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/folders_tools.php';

function j_ok($data=null){ echo json_encode(['success'=>true,'data'=>$data], JSON_UNESCAPED_UNICODE); exit; }
function j_err($msg,$code=400){ http_response_code($code); echo json_encode(['success'=>false,'error'=>$msg], JSON_UNESCAPED_UNICODE); exit; }

const MAX_BYTES = 5242880; // 5MB

if (session_status() === PHP_SESSION_NONE) session_start();
require_once __DIR__ . '/../api/i18n.php';
if (!isset($_SESSION['user'])) j_err(t('errors.not_authenticated'), 401);

$paths = $_SESSION['paths'];
$user = $_SESSION['user'];
$userId = (int)($user['id'] ?? $user['user_id'] ?? 0);
if ($userId <= 0) j_err(t('modal.workpackage_images.error.session_invalid'), 401);
$isAdmin = ($user['user_type'] ?? '') === 'X';

// Ricerca e cartelle del WP richiesto, sempre dal database e dal WP stesso. (Fino al 2026-10-11
// la cartella della ricerca veniva dalla sessione, cioè dall'ultima ricerca aperta, anche in
// un'altra scheda: si potevano vedere e salvare le immagini di un WP omonimo di un'altra ricerca.)
// @return array{res_id:int, res_folder:string, wp_folder:string}|null
function get_wp_folders(PDO $pdo, int $wpId): ?array {
  $st = $pdo->prepare("
    SELECT wp.res_id, fr.folder_name AS res_folder, fw.folder_name AS wp_folder
    FROM workpackages wp
    JOIN researches r ON r.res_id = wp.res_id
    LEFT JOIN folders fr ON fr.folder_id = r.res_folder_id
    LEFT JOIN folders fw ON fw.folder_id = wp.wp_folder_id
    WHERE wp.wp_id = ?
    LIMIT 1
  ");
  $st->execute([$wpId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return $r ? ['res_id' => (int)$r['res_id'], 'res_folder' => (string)$r['res_folder'], 'wp_folder' => (string)$r['wp_folder']] : null;
}

// Salvare le immagini di un WP: amministratore, responsabile scientifico (P) o responsabile di WP (W)
// della ricerca — gli stessi che vedono la voce nel menu (ui/header.php, $showWpCE).
function require_wp_images_edit(PDO $pdo, int $resId, int $userId, bool $isAdmin): void {
  if ($isAdmin) return;
  $st = $pdo->prepare("SELECT 1 FROM users_res_permissions WHERE res_id=? AND user_id=? AND perm IN ('P','W') LIMIT 1");
  $st->execute([$resId, $userId]);
  if (!$st->fetchColumn()) j_err(t('modal.permits.err.need_pi_or_wpl.@'), 403);
}

function public_base_for(string $resFolder, string $wpFolder): string {
  global $paths;
  return $paths['data_path'] .'/' . rawurlencode($resFolder) . '/' . rawurlencode($wpFolder) . '/';
}

function renameExisting(string $path, string $prefix): void {
  if (!file_exists($path)) return;
  $stamp = date('ymd-Hi'); // AAMMGG-hhmm
  $dir = dirname($path);
  $new = $dir . DIRECTORY_SEPARATOR . $prefix . '_' . $stamp . '.jpg';
  @rename($path, $new);
}

$action = $_GET['action'] ?? '';

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'get') {
  $wpId = (int)($_GET['wp_id'] ?? 0);
  if ($wpId <= 0) j_err(t('modal.workpackage_images.error.missing_wp_id'));

  $wf = get_wp_folders($pdo, $wpId);
  if ($wf === null || $wf['wp_folder'] === '') j_err(t('modal.workpackage_images.error.wp_not_found.@'), 404);
  if ($wf['res_folder'] === '') j_err(t('modal.workpackage_images.error.res_folder.@'), 500);
  $resFolder = $wf['res_folder'];
  $wpFolder  = $wf['wp_folder'];

  $BASE_FS = folders_get_base_fs();
  folders_assert_safe_segment($resFolder);
  folders_assert_safe_segment($wpFolder);

  $dir = rtrim($BASE_FS, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $resFolder . DIRECTORY_SEPARATOR . $wpFolder;

  $det = $dir . DIRECTORY_SEPARATOR . 'wp_det.jpg';
  $ico = $dir . DIRECTORY_SEPARATOR . 'wp_ico.jpg';

  $baseUrl = public_base_for($resFolder, $wpFolder);
  $cb = date('YmdHis');

  j_ok([
    'detUrl' => file_exists($det) ? ($baseUrl . 'wp_det.jpg?cb=' . $cb) : null,
    'icoUrl' => file_exists($ico) ? ($baseUrl . 'wp_ico.jpg?cb=' . $cb) : null,
  ]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'save') {
  $wpId = (int)($_POST['wp_id'] ?? 0);
  if ($wpId <= 0) j_err(t('modal.workpackage_images.error.missing_wp_id'));

  $wf = get_wp_folders($pdo, $wpId);
  if ($wf === null || $wf['wp_folder'] === '') j_err(t('modal.workpackage_images.error.wp_not_found.@'), 404);
  if ($wf['res_folder'] === '') j_err(t('modal.workpackage_images.error.res_folder.@'), 500);
  require_wp_images_edit($pdo, $wf['res_id'], $userId, $isAdmin);
  $resFolder = $wf['res_folder'];
  $wpFolder  = $wf['wp_folder'];

  $BASE_FS = folders_get_base_fs();
  folders_assert_safe_segment($resFolder);
  folders_assert_safe_segment($wpFolder);

  $dir = rtrim($BASE_FS, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $resFolder . DIRECTORY_SEPARATOR . $wpFolder;
  if (!is_dir($dir)) j_err(t('modal.workpackage_images.error.wp_dir_missing.@'), 500);

  $hasDet = isset($_FILES['det']) && $_FILES['det']['error'] === UPLOAD_ERR_OK;
  $hasIco = isset($_FILES['ico']) && $_FILES['ico']['error'] === UPLOAD_ERR_OK;
  if (!$hasDet && !$hasIco) j_err(t('modal.workpackage_images.error.no_file'));

  if ($hasDet && (int)$_FILES['det']['size'] > MAX_BYTES) j_err(t('modal.workpackage_images.error.too_big', ['name' => 'DET', 'mb' => 5]));
  if ($hasIco && (int)$_FILES['ico']['size'] > MAX_BYTES) j_err(t('modal.workpackage_images.error.too_big', ['name' => 'ICO', 'mb' => 5]));

  if ($hasDet) {
    $tmp = $_FILES['det']['tmp_name'];
    $dst = $dir . DIRECTORY_SEPARATOR . 'wp_det.jpg';
    $info = @getimagesize($tmp);
    if ($info === false) j_err(t('modal.workpackage_images.error.not_image', ['name' => 'DET']));

    renameExisting($dst, 'det');
    if (!@move_uploaded_file($tmp, $dst)) j_err(t('modal.workpackage_images.error.save_file', ['file' => 'wp_det.jpg']), 500);
  }

  if ($hasIco) {
    $tmp = $_FILES['ico']['tmp_name'];
    $dst = $dir . DIRECTORY_SEPARATOR . 'wp_ico.jpg';
    $info = @getimagesize($tmp);
    if ($info === false) j_err(t('modal.workpackage_images.error.not_image', ['name' => 'ICO']));

    renameExisting($dst, 'ico');
    if (!@move_uploaded_file($tmp, $dst)) j_err(t('modal.workpackage_images.error.save_file', ['file' => 'wp_ico.jpg']), 500);
  }

  j_ok(['saved'=>true]);
}

j_err(t('errors.invalid_request'), 400);
