<?php
// ui/modal_research_images_tools.php
declare(strict_types=1);
ob_start(); // cattura qualsiasi output spuorio (warnings, notices)

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../api/db.php';
require_once __DIR__ . '/../api/folders_tools.php';

function j_ok($data = null): void {
  ob_end_clean();
  echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function j_err(string $msg, int $code = 400): void {
  ob_end_clean();
  http_response_code($code);
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

const MAX_BYTES = 5242880; // 5MB

if (session_status() === PHP_SESSION_NONE) session_start();
require_once __DIR__ . '/../api/i18n.php';   // messaggi nella lingua della richiesta
if (!isset($_SESSION['user'])) j_err(t('errors.not_authenticated'), 401);

$paths  = $_SESSION['paths'];
$user   = $_SESSION['user'];
$userId = (int)($user['id'] ?? $user['user_id'] ?? 0);
if ($userId <= 0) j_err(t('account.session_invalid'), 401);
$isAdmin = (($user['user_type'] ?? '') === 'X');

$action = $_GET['action'] ?? '';

// ── Helpers ──────────────────────────────────────────────────────────────────

// FIX (2026-09-17): questo endpoint non aveva ALCUN controllo di permesso
// oltre "sei loggato" — qualunque utente autenticato poteva sovrascrivere le
// immagini di QUALSIASI ricerca passando un res_id a piacere. Stesso pattern
// già usato altrove (ui/modal_permits_tools.php::require_res_pi) — verifica
// diretta su users_res_permissions per il res_id richiesto, non sulla
// sessione (che potrebbe riferirsi a una ricerca diversa da quella passata
// nella request). Applicato solo alla scrittura (save); la lettura (get)
// resta aperta a chiunque sia autenticato, come già per le altre viste.
function require_res_pi_img(PDO $pdo, int $resId, int $userId, bool $isAdmin): void {
  if ($isAdmin) return;
  $st = $pdo->prepare("SELECT 1 FROM users_res_permissions WHERE res_id=? AND user_id=? AND perm='P' LIMIT 1");
  $st->execute([$resId, $userId]);
  if (!$st->fetchColumn()) j_err(t('modal.researches.err.need_pi.@'), 403);
}

// Cartella della ricerca richiesta, sempre dal database. (Fino al 2026-10-11 si prendeva prima
// quella della ricerca in sessione, cioè l'ULTIMA APERTA: dalla pagina delle ricerche, modificando
// le immagini di un'altra ricerca, si vedevano e si salvavano quelle della ricerca aperta prima.)
function get_res_folder_name(PDO $pdo, int $resId): string {
  $st = $pdo->prepare("
    SELECT f.folder_name
    FROM researches r
    LEFT JOIN folders f ON f.folder_id = r.res_folder_id
    WHERE r.res_id = ?
    LIMIT 1
  ");
  $st->execute([$resId]);
  return (string)($st->fetchColumn() ?: '');
}

function public_base_for_res(string $resFolder): string {
  global $paths;
  return $paths['data_path'] . '/' . rawurlencode($resFolder) . '/';
}

function renameExisting(string $path, string $prefix, string $ext = 'jpg'): void {
  if (!file_exists($path)) return;
  $stamp = date('ymd-Hi');
  $dir   = dirname($path);
  @rename($path, $dir . DIRECTORY_SEPARATOR . $prefix . '_' . $stamp . '.' . $ext);
}

// ── GET: carica URL immagini esistenti ───────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'get') {
  $resId = (int)($_GET['res_id'] ?? 0);
  if ($resId <= 0) j_err(t('modal.researches.err.res_id_missing'));

  $resFolder = get_res_folder_name($pdo, $resId);
  if ($resFolder === '') j_err(t('modal.research_images.err.no_folder.@'), 404);

  $BASE_FS = folders_get_base_fs();
  folders_assert_safe_segment($resFolder);
  $dir = rtrim($BASE_FS, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $resFolder;

  $det   = $dir . DIRECTORY_SEPARATOR . 'research_det.jpg';
  $ico   = $dir . DIRECTORY_SEPARATOR . 'research_ico.jpg';
  $logoR = $dir . DIRECTORY_SEPARATOR . 'logo_ricerca.png';
  $logoP = $dir . DIRECTORY_SEPARATOR . 'logo_partner.png';

  $baseUrl = public_base_for_res($resFolder);
  $cb = date('YmdHis');

  $stColor = $pdo->prepare("SELECT res_color FROM researches WHERE res_id = ? LIMIT 1");
  $stColor->execute([$resId]);
  $resColor = (string)($stColor->fetchColumn() ?: '#555555');

  j_ok([
    'detUrl'   => file_exists($det)   ? ($baseUrl . 'research_det.jpg?cb=' . $cb) : null,
    'icoUrl'   => file_exists($ico)   ? ($baseUrl . 'research_ico.jpg?cb='  . $cb) : null,
    'logoRUrl' => file_exists($logoR) ? ($baseUrl . 'logo_ricerca.png?cb='  . $cb) : null,
    'logoPUrl' => file_exists($logoP) ? ($baseUrl . 'logo_partner.png?cb='  . $cb) : null,
    'resColor' => $resColor,
  ]);
}

// ── POST: salva immagini ─────────────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'save') {
  $resId = (int)($_POST['res_id'] ?? 0);
  if ($resId <= 0) j_err(t('modal.researches.err.res_id_missing'));
  require_res_pi_img($pdo, $resId, $userId, $isAdmin);

  $resFolder = get_res_folder_name($pdo, $resId);
  if ($resFolder === '') j_err(t('modal.research_images.err.no_folder.@'), 404);

  $BASE_FS = folders_get_base_fs();
  folders_assert_safe_segment($resFolder);
  $dir = rtrim($BASE_FS, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $resFolder;

  if (!is_dir($dir)) j_err(t('modal.research_images.err.folder_missing.@'), 500);

  $hasDet   = isset($_FILES['det'])    && $_FILES['det']['error']    === UPLOAD_ERR_OK;
  $hasIco   = isset($_FILES['ico'])    && $_FILES['ico']['error']    === UPLOAD_ERR_OK;
  $hasLogoR = isset($_FILES['logo_r']) && $_FILES['logo_r']['error'] === UPLOAD_ERR_OK;
  $hasLogoP = isset($_FILES['logo_p']) && $_FILES['logo_p']['error'] === UPLOAD_ERR_OK;

  // res_color: opzionale, validato come #RRGGBB — se presente e valido viene
  // salvato anche da solo (nessun file allegato), per questo il controllo
  // "nessun file ricevuto" sotto lo esclude esplicitamente.
  $rawColor = trim((string)($_POST['res_color'] ?? ''));
  $hasColor = $rawColor !== '';
  if ($hasColor && !preg_match('/^#[0-9a-fA-F]{6}$/', $rawColor)) {
    j_err(t('modal.research_images.err.color_invalid'));
  }

  if (!$hasDet && !$hasIco && !$hasLogoR && !$hasLogoP && !$hasColor) j_err(t('modal.research_images.err.no_files'));

  if ($hasDet   && (int)$_FILES['det']['size']    > MAX_BYTES) j_err(t('modal.research_images.err.too_large', ['name' => 'DET']));
  if ($hasIco   && (int)$_FILES['ico']['size']    > MAX_BYTES) j_err(t('modal.research_images.err.too_large', ['name' => 'ICO']));
  if ($hasLogoR && (int)$_FILES['logo_r']['size'] > MAX_BYTES) j_err(t('modal.research_images.err.too_large', ['name' => 'LOGO_R']));
  if ($hasLogoP && (int)$_FILES['logo_p']['size'] > MAX_BYTES) j_err(t('modal.research_images.err.too_large', ['name' => 'LOGO_P']));

  if ($hasDet) {
    $tmp = $_FILES['det']['tmp_name'];
    $dst = $dir . DIRECTORY_SEPARATOR . 'research_det.jpg';
    if (@getimagesize($tmp) === false) j_err(t('modal.research_images.err.not_image', ['name' => 'DET']));
    renameExisting($dst, 'det');
    if (!@move_uploaded_file($tmp, $dst)) j_err(t('modal.research_images.err.save_file', ['file' => 'research_det.jpg']), 500);
  }

  if ($hasIco) {
    $tmp = $_FILES['ico']['tmp_name'];
    $dst = $dir . DIRECTORY_SEPARATOR . 'research_ico.jpg';
    if (@getimagesize($tmp) === false) j_err(t('modal.research_images.err.not_image', ['name' => 'ICO']));
    renameExisting($dst, 'ico');
    if (!@move_uploaded_file($tmp, $dst)) j_err(t('modal.research_images.err.save_file', ['file' => 'research_ico.jpg']), 500);
  }

  if ($hasLogoR) {
    $tmp = $_FILES['logo_r']['tmp_name'];
    $dst = $dir . DIRECTORY_SEPARATOR . 'logo_ricerca.png';
    if (@getimagesize($tmp) === false) j_err(t('modal.research_images.err.not_image', ['name' => 'LOGO_R']));
    renameExisting($dst, 'logo_r', 'png');
    if (!@move_uploaded_file($tmp, $dst)) j_err(t('modal.research_images.err.save_file', ['file' => 'logo_ricerca.png']), 500);
  }

  if ($hasLogoP) {
    $tmp = $_FILES['logo_p']['tmp_name'];
    $dst = $dir . DIRECTORY_SEPARATOR . 'logo_partner.png';
    if (@getimagesize($tmp) === false) j_err(t('modal.research_images.err.not_image', ['name' => 'LOGO_P']));
    renameExisting($dst, 'logo_p', 'png');
    if (!@move_uploaded_file($tmp, $dst)) j_err(t('modal.research_images.err.save_file', ['file' => 'logo_partner.png']), 500);
  }

  if ($hasColor) {
    $stUpd = $pdo->prepare("UPDATE researches SET res_color = ? WHERE res_id = ?");
    $stUpd->execute([$rawColor, $resId]);
  }

  j_ok(['saved' => true]);
}

j_err(t('errors.invalid_request'), 400);
