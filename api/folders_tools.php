<?php
// api/folders_tools.php
declare(strict_types=1);

//Controllo di Sessione
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
require_once __DIR__ . '/i18n.php';   // messaggi nella lingua dell'utente

/**
 * Utility centralizzate per gestione folders (validazione nome + filesystem).
 * Pensato per cartelle sotto: <DOC_ROOT>/GitHub/researches/<folder_name>
 */

function folders_json_ok($data = null): void {
  echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
  exit;
}

function folders_json_err(string $msg, int $code = 400): void {
  http_response_code($code);
  echo json_encode(['success' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

function folders_read_json_body(): array {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}

function folders_current_user(): array {
  if (session_status() === PHP_SESSION_NONE) @session_start();
  if (!isset($_SESSION['user']) || !is_array($_SESSION['user'])) {
    folders_json_err(t('errors.not_authenticated'), 401);
  }
  return $_SESSION['user'];
}

function folders_current_user_id(): int {
  $u = folders_current_user();
  if (isset($u['id'])) return (int)$u['id'];
  if (isset($u['user_id'])) return (int)$u['user_id'];
  folders_json_err(t('account.session_invalid'), 401);
}

/**
 * Normalizza/valida folder_name:
 * - NO spazi
 * - solo [A-Za-z0-9_]
 * - max 30
 * - prima lettera maiuscola se è [a-z]
 */
function folders_normalize_name(string $name, int $maxLen = 30): string {
  $name = trim($name);

  if ($name === '') {
    folders_json_err(t('folders.err.name_required.@'));
  }
  if (preg_match('/\s/', $name)) {
    folders_json_err(t('folders.err.name_spaces.@'));
  }
  $re = '/^[A-Za-z0-9_]{1,' . (int)$maxLen . '}$/';
  if (!preg_match($re, $name)) {
    folders_json_err(t('folders.err.name_invalid.@', ['max' => $maxLen]));
  }

  $first = substr($name, 0, 1);
  if (preg_match('/[a-z]/', $first)) {
    $name = strtoupper($first) . substr($name, 1);
  }
  return $name;
}



/** Base FS: <DOC_ROOT>/GitHub/researches */
function folders_get_base_fs(): string {

    $paths = $_SESSION['paths'];
    $base = rtrim($_SERVER['DOCUMENT_ROOT'], DIRECTORY_SEPARATOR).$paths['data_path']; // ADATTA se la tua struttura è diversa

    //  $base = rtrim($_SERVER['DOCUMENT_ROOT'], DIRECTORY_SEPARATOR)
    //        . DIRECTORY_SEPARATOR . 'GitHub'
    //        . DIRECTORY_SEPARATOR . 'researches';

    return realpath($base) ?: $base;
}

/** Protezione traversal: folder_name è già safe, ma manteniamo il check */
function folders_assert_safe_segment(string $seg): void {
  if ($seg === '' || preg_match('#[\\\\/]|^\.+$#', $seg)) {
    folders_json_err(t('folders.err.bad_segment'));
  }
}

function folders_abs_path(string $BASE_FS, string $folder_name): string {
  folders_assert_safe_segment($folder_name);
  return rtrim($BASE_FS, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $folder_name;
}

function folders_fs_exists(string $BASE_FS, string $folder_name): bool {
  $p = folders_abs_path($BASE_FS, $folder_name);
  return is_dir($p);
}

/** true se cartella esiste e non contiene file/sottocartelle (eccetto . e ..) */
function folders_fs_is_empty(string $BASE_FS, string $folder_name): bool {
  $p = folders_abs_path($BASE_FS, $folder_name);
  if (!is_dir($p)) return true; // trattiamo "non esiste" come vuota per i check

  $it = @scandir($p);
  if ($it === false) folders_json_err(t('folders.err.read.@'));
  foreach ($it as $e) {
    if ($e === '.' || $e === '..') continue;
    return false;
  }
  return true;
}

function folders_fs_create(string $BASE_FS, string $folder_name): void {
  $p = folders_abs_path($BASE_FS, $folder_name);
  if (is_dir($p)) folders_json_err(t('folders.err.exists.@'));
  if (!is_dir($BASE_FS)) {
    if (!@mkdir($BASE_FS, 0775, true)) {
      $err = error_get_last();
      folders_json_err(t('folders.err.mkdir_base') . (!empty($err['message']) ? ' (' . $err['message'] . ')' : ''), 500);
    }
  }
  if (!@mkdir($p, 0775, true)) {
    $err = error_get_last();
    folders_json_err(t('folders.err.mkdir.@') . (!empty($err['message']) ? ' (' . $err['message'] . ')' : ''), 500);
  }
}

function folders_fs_rename(string $BASE_FS, string $old_name, string $new_name): void {
  $old = folders_abs_path($BASE_FS, $old_name);
  $new = folders_abs_path($BASE_FS, $new_name);

  if (!is_dir($old)) folders_json_err(t('folders.err.rename_missing.@'));
  if (is_dir($new)) folders_json_err(t('folders.err.rename_exists.@'));
  if (!@rename($old, $new)) {
    $err = error_get_last();
    folders_json_err(t('folders.err.rename.@') . (!empty($err['message']) ? ' (' . $err['message'] . ')' : ''), 500);
  }
}

function folders_fs_remove_dir(string $BASE_FS, string $folder_name): void {
  $p = folders_abs_path($BASE_FS, $folder_name);
  if (!is_dir($p)) return;
  if (!@rmdir($p)) {
    $err = error_get_last();
    folders_json_err(t('folders.err.delete.@') . (!empty($err['message']) ? ' (' . $err['message'] . ')' : ''), 500);
  }
}

/**
 * Compensazioni "best effort" (NON escono dallo script sul fallimento).
 * Usate solo per annullare un'operazione FS già eseguita quando il passo
 * DB abbinato (nella stessa richiesta) fallisce — mai per il flusso normale.
 */
function folders_fs_compensate_remove(string $BASE_FS, string $folder_name): bool {
  $p = folders_abs_path($BASE_FS, $folder_name);
  if (!is_dir($p)) return true;
  $it = @scandir($p);
  if ($it === false || count($it) > 2) return false; // non vuota o illeggibile: non tocco nulla
  return (bool)@rmdir($p);
}

function folders_fs_compensate_rename(string $BASE_FS, string $from_name, string $to_name): bool {
  $from = folders_abs_path($BASE_FS, $from_name);
  $to   = folders_abs_path($BASE_FS, $to_name);
  if (!is_dir($from) || is_dir($to)) return false;
  return (bool)@rename($from, $to);
}

function folders_fs_compensate_create(string $BASE_FS, string $folder_name): bool {
  $p = folders_abs_path($BASE_FS, $folder_name);
  if (is_dir($p)) return true;
  return (bool)@mkdir($p, 0775, true);
}

/* ==========================================================
 * ESTENSIONI (Opzione B): path multi-segmento + operazioni su path assoluti
 * ========================================================== */

/** Join sicuro di segmenti: valida ogni segmento (no / \ ..) */
function folders_join_path(string ...$segments): string {
  $out = '';
  foreach ($segments as $seg) {
    if ($seg === '') continue;
    folders_assert_safe_segment($seg);
    $out = ($out === '') ? $seg : ($out . DIRECTORY_SEPARATOR . $seg);
  }
  return $out;
}

/** Crea un path assoluto sotto BASE: BASE / seg1 / seg2 / ... */
function folders_abs_path_segments(string $BASE_FS, string ...$segments): string {
  $BASE_FS = rtrim($BASE_FS, DIRECTORY_SEPARATOR);
  $rel = folders_join_path(...$segments);
  return $rel === '' ? $BASE_FS : ($BASE_FS . DIRECTORY_SEPARATOR . $rel);
}

/** true se dir assoluta è vuota (o non esiste) */
function folders_fs_is_empty_abs(string $absDir): bool {
  if (!is_dir($absDir)) return true;
  $it = @scandir($absDir);
  if ($it === false) folders_json_err(t('folders.err.read.@'));
  foreach ($it as $e) {
    if ($e === '.' || $e === '..') continue;
    return false;
  }
  return true;
}

/** mkdir -p su path assoluto; errore se già esiste */
function folders_fs_create_abs(string $absDir): void {
  if (is_dir($absDir)) folders_json_err(t('folders.err.exists.@'));
  $parent = dirname($absDir);
  if (!is_dir($parent)) {
    if (!@mkdir($parent, 0775, true)) folders_json_err(t('folders.err.mkdir_base'));
  }
  if (!@mkdir($absDir, 0775, true)) folders_json_err(t('folders.err.mkdir.@'));
}

/** rename su path assoluto */
function folders_fs_rename_abs(string $oldAbsDir, string $newAbsDir): void {
  if (!is_dir($oldAbsDir)) folders_json_err(t('folders.err.rename_missing.@'));
  if (is_dir($newAbsDir)) folders_json_err(t('folders.err.rename_exists.@'));
  if (!@rename($oldAbsDir, $newAbsDir)) folders_json_err(t('folders.err.rename.@'));
}

/** rmdir su path assoluto (non ricorsivo) */
function folders_fs_remove_dir_abs(string $absDir): void {
  if (!is_dir($absDir)) return;
  if (!@rmdir($absDir)) folders_json_err(t('folders.err.delete.@'));
}
