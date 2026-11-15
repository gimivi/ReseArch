<?php
// api/hys_common.php — parti comuni delle API di HySpace (HySpace_rest_api.php,
// hys_museum_tool.php): connessione al database di HySpace e percorsi web dei file
// delle esercitazioni.

declare(strict_types=1);

// Cartella pubblica dei lavori degli allievi (era Session("AbsCliPath") in .NET)
const HYS_IMG_BASE = '/Public/Valenti_Allievi/';

// Percorso web di un file dell'esercitazione: ogni segmento codificato a parte.
// $e deve contenere year_folder, main_folder, ese_folder (Allievi + Esercitazione).
function hys_url(array $e, string $file): ?string {
  $file = trim($file);
  if ($file === '') return null;
  $parts = array_merge(
    [$e['year_folder'] ?? '', $e['main_folder'] ?? '', $e['ese_folder'] ?? ''],
    explode('/', str_replace('\\', '/', $file))
  );
  $parts = array_filter(array_map('strval', $parts), fn($p) => $p !== '');
  return HYS_IMG_BASE . implode('/', array_map('rawurlencode', $parts));
}

// Cartella su disco dell'esercitazione (DOCUMENT_ROOT + HYS_IMG_BASE + anno/main/ese):
// la cartella Public è nella radice del dominio, come RA_Data. null se i nomi delle
// cartelle non sono sicuri (niente "..", separatori o caratteri di controllo).
function hys_fs_dir(array $e): ?string {
  $segs = [];
  foreach (['year_folder', 'main_folder', 'ese_folder'] as $k) {
    $s = trim((string)($e[$k] ?? ''));
    if ($s === '' || $s === '.' || $s === '..' || preg_match('#[/\\\\:*?"<>|\x00-\x1f]#', $s)) return null;
    $segs[] = $s;
  }
  $root = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\');
  if ($root === '') return null;
  return $root . str_replace('/', DIRECTORY_SEPARATOR, rtrim(HYS_IMG_BASE, '/')) . DIRECTORY_SEPARATOR
       . implode(DIRECTORY_SEPARATOR, $segs);
}

// Nomi delle colonne di una tabella di HySpace (per le poche differenze fra versioni del DB)
function hys_columns(PDO $pdo, string $table): array {
  static $cache = [];
  if (!isset($cache[$table])) {
    $cache[$table] = array_column($pdo->query('SHOW COLUMNS FROM `' . str_replace('`', '', $table) . '`')->fetchAll(), 'Field');
  }
  return $cache[$table];
}

// Connessione PDO al database di HySpace (cfg_MYSQL.php → db_HySpace)
function hys_pdo(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $db = require __DIR__ . '/../cfg/cfg_MYSQL.php';
  $pdo = new PDO(
    sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $db['host'], (int)$db['port'], $db['db_HySpace'], $db['charset']),
    $db['user'], $db['pass'],
    [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES => false,
    ]
  );
  return $pdo;
}
