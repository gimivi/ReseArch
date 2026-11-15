<?php
// api/hys_archive_tool.php — archivio delle esercitazioni di HySpace (erede di
// Ese_Archivio2.aspx / GestisciEsercitazioni.aspx, _doc/Ese; nodo HTM/HYS/Archivio Esercitazioni).
//
// GET  ?action=years                         → { ok, data: ["2023-24", …] }  (Esercitazione_Tipo.ese_aa)
// GET  ?action=types&aa=2023-24              → { ok, data: [{ ese_cod, ese_desc }] }
// GET  ?action=list&ese_cod=C&q=sedia&fields=titolo,chiavi&has_model=1
//        → { ok, data: { total, truncated, admin, items: [{ id_ese, author, title, abstract, cover_url,
//                                                          model_file, model_url, model_ext, hidden }] } }
//        ese_cod e/o q: almeno uno dei due. Ogni parola di q (AND) in almeno uno dei campi (OR).
//        Campi: titolo, chiavi, abstract, descrizione, cognome. Non amministratori: solo flag_show = 1.
//
// Solo amministratore:
// GET  ?action=files&id_ese=N                → { ok, data: { dirs: ["", "img", …], files: [{ path, size, mtime, url }] } }
//        File della cartella dell'esercitazione (anche nelle sottocartelle).
// POST ?action=upload&id_ese=N&dir=img&name=foto.jpg&overwrite=0     corpo = il file
//        Carica un file in una cartella ESISTENTE dell'esercitazione. File già presente e
//        overwrite=0 → 409 { exists: true } (il client chiede conferma e riprova con overwrite=1).
// POST ?action=save&id_ese=N&name=sedia.glb&overwrite=0&set_model=1  corpo = GLB
//        Salva il modello esportato dalla scena di un pannello TJS (nodo TJS/Model/Save Esercitazione):
//        name è relativo alla cartella dell'esercitazione (può stare in una sottocartella esistente),
//        estensione .glb. set_model=1 → il nome va in Esercitazione.modello_3d. Esistente e
//        overwrite=0 → 409 { exists: true }.
// POST { action:"delete", id_ese, confirm:"ELIMINA" }
//        Cancella i paragrafi, l'esercitazione e la sua cartella su disco (come la pagina .NET),
//        ma la cartella solo se nessun'altra esercitazione la usa.
//
// Query sempre parametrizzate (le pagine .NET concatenavano il testo nell'SQL).

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
if (session_status() === PHP_SESSION_NONE) session_start();

function ha_out(array $a, int $code = 200): never {
  http_response_code($code);
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function ha_err(string $msg, int $code = 400, array $extra = []): never { ha_out(['ok' => false, 'error' => $msg] + $extra, $code); }

$user = $_SESSION['user'] ?? null;
require_once __DIR__ . '/visibility.php';   // ra_session_user_ok, ra_is_guest (ospiti, id 0)
if (!ra_session_user_ok($user)) ha_err('Sessione non valida.', 401);
if (ra_is_guest($user) && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') ha_err('Gli ospiti possono solo consultare.', 403);
$isAdmin = ($user['user_type'] ?? '') === 'X';

require_once __DIR__ . '/hys_common.php';

const HA_FIELDS = [
  'titolo'      => 'e.titolo_esercitazione',
  'chiavi'      => 'e.chiavi_esercitazione',
  'abstract'    => 'e.abstract_esercitazione',
  'descrizione' => 'e.descrizione_esercitazione',
  'cognome'     => 'a.cognome',
];
const HA_MAX_ITEMS = 500;
const HA_MAX_FILE  = 100 * 1024 * 1024;     // come requestLimits del Web.config
const HA_MAX_LIST  = 2000;                  // file elencati al massimo per cartella
// oltre a cfg_Upload.php::allowed_ext: immagini e buffer che le esercitazioni usano come texture
const HA_EXTRA_EXT = ['gif', 'bmp', 'webp', 'tif', 'tiff', 'bin', 'zip', 'mp4', 'doc', 'docx'];

/** Colonna di Esercitazione che punta al tipo (ese_cod nelle pagine .NET, cod_ese in HySpace). */
function ha_type_col(PDO $pdo): string {
  $cols = hys_columns($pdo, 'Esercitazione');
  if (in_array('ese_cod', $cols, true)) return 'e.ese_cod';
  if (in_array('cod_ese', $cols, true)) return 'e.cod_ese';
  ha_err('Nel database manca il codice del tipo di esercitazione (ese_cod / cod_ese).', 500);
}

/** Filtro di visibilità (flag_show) qualificato sulla tabella che lo contiene. */
function ha_show_col(PDO $pdo): ?string {
  if (in_array('flag_show', hys_columns($pdo, 'Esercitazione'), true)) return 'e.flag_show';
  if (in_array('flag_show', hys_columns($pdo, 'Allievi'), true)) return 'a.flag_show';
  return null;
}

function ha_ext(string $file): string {
  return strtolower(pathinfo($file, PATHINFO_EXTENSION));
}

/** Esercitazione con le cartelle dello studente. */
function ha_exercise(PDO $pdo, int $id): array {
  if ($id <= 0) ha_err('id_ese mancante.');
  $st = $pdo->prepare('SELECT e.*, a.nome, a.cognome, a.year_folder, a.main_folder
                       FROM Esercitazione e INNER JOIN Allievi a ON a.idu = e.idu WHERE e.id_ese = ? LIMIT 1');
  $st->execute([$id]);
  $e = $st->fetch();
  if (!$e) ha_err("Esercitazione $id non trovata.", 404);
  return $e;
}

/** Cartella reale dell'esercitazione (deve esistere). */
function ha_dir(array $e): string {
  $dir = hys_fs_dir($e);
  if ($dir === null) ha_err('Cartelle dell\'esercitazione non valide nel database.', 500);
  $real = realpath($dir);
  if ($real === false || !is_dir($real)) ha_err('Cartella dell\'esercitazione non trovata sul server.', 404);
  return $real;
}

/** Percorso relativo sicuro ("img/foto.jpg") → segmenti; vuoto ammesso solo se $allowEmpty. */
function ha_segments(string $rel, bool $allowEmpty = false): array {
  $parts = array_values(array_filter(explode('/', str_replace('\\', '/', trim($rel))), fn($p) => $p !== ''));
  if (!$parts && !$allowEmpty) ha_err('Nome del file mancante.');
  foreach ($parts as $p) {
    if ($p === '.' || $p === '..' || mb_strlen($p) > 120 || preg_match('#[:*?"<>|\x00-\x1f]#', $p)) ha_err("Nome non valido: $p");
  }
  return $parts;
}

/**
 * Scrive $data in $base/<segmenti> (la cartella che lo contiene deve esistere ed essere dentro $base).
 * Ritorna il percorso relativo con "/". 409 se esiste e !$overwrite.
 */
function ha_write(string $base, array $parts, string $data, bool $overwrite): string {
  $target = $base . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $parts);
  $dirReal = realpath(dirname($target));
  if ($dirReal === false || !is_dir($dirReal)
      || ($dirReal !== $base && strncasecmp($dirReal . DIRECTORY_SEPARATOR, $base . DIRECTORY_SEPARATOR, strlen($base) + 1) !== 0)) {
    ha_err('Cartella di destinazione non trovata dentro quella dell\'esercitazione.', 404);
  }
  $rel = implode('/', $parts);
  if (is_file($target) && !$overwrite) ha_err("Il file $rel esiste già.", 409, ['exists' => true, 'path' => $rel]);
  $tmp = $target . '.tmp-' . bin2hex(random_bytes(4));
  if (file_put_contents($tmp, $data) !== strlen($data)) { @unlink($tmp); ha_err('Scrittura non riuscita (permessi della cartella?).', 500); }
  if (is_file($target)) @unlink($target);
  if (!rename($tmp, $target)) { @unlink($tmp); ha_err('Salvataggio non riuscito.', 500); }
  return $rel;
}

function ha_body(): string {
  $data = (string)file_get_contents('php://input');
  if ($data === '') ha_err('File mancante o vuoto.');
  if (strlen($data) > HA_MAX_FILE) ha_err('File oltre il limite di 100 MB.', 413);
  return $data;
}

/** Cancellazione ricorsiva di una cartella (senza seguire i collegamenti). */
function ha_rmdir(string $dir): void {
  $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
                                      RecursiveIteratorIterator::CHILD_FIRST);
  foreach ($it as $f) {
    $p = $f->getPathname();
    if ($f->isDir() && !$f->isLink()) { if (!@rmdir($p)) throw new RuntimeException("cartella non cancellabile: $p"); }
    elseif (!@unlink($p)) throw new RuntimeException("file non cancellabile: $p");
  }
  if (!@rmdir($dir)) throw new RuntimeException("cartella non cancellabile: $dir");
}

try {
  $pdo = hys_pdo();
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  $action = (string)($_GET['action'] ?? '');

  if ($method === 'GET' && $action === 'years') {
    $rows = $pdo->query('SELECT DISTINCT ese_aa FROM Esercitazione_Tipo ORDER BY ese_aa DESC')->fetchAll(PDO::FETCH_COLUMN);
    ha_out(['ok' => true, 'data' => array_map('strval', $rows)]);
  }

  if ($method === 'GET' && $action === 'types') {
    $st = $pdo->prepare('SELECT ese_cod, ese_desc FROM Esercitazione_Tipo WHERE ese_aa = ? ORDER BY ese_ord');
    $st->execute([(string)($_GET['aa'] ?? '')]);
    ha_out(['ok' => true, 'data' => array_map(fn($r) => ['ese_cod' => (string)$r['ese_cod'], 'ese_desc' => (string)$r['ese_desc']], $st->fetchAll())]);
  }

  if ($method === 'GET' && $action === 'list') {
    $where = [];
    $par = [];
    $cod = trim((string)($_GET['ese_cod'] ?? ''));
    if ($cod !== '') { $where[] = ha_type_col($pdo) . ' = ?'; $par[] = $cod; }

    $fields = array_values(array_intersect(array_map('trim', explode(',', (string)($_GET['fields'] ?? 'titolo'))), array_keys(HA_FIELDS)));
    $cols = array_map(fn($f) => HA_FIELDS[$f], $fields ?: ['titolo']);
    $words = array_values(array_filter(preg_split('/\s+/u', trim((string)($_GET['q'] ?? ''))) ?: [], fn($w) => $w !== ''));
    foreach (array_slice($words, 0, 8) as $w) {
      $like = '%' . addcslashes($w, '%_\\') . '%';
      $where[] = '(' . implode(' OR ', array_map(fn($c) => "$c LIKE ?", $cols)) . ')';
      foreach ($cols as $_) $par[] = $like;
    }
    if (!$where) ha_err('Scegli un tipo di esercitazione oppure scrivi una parola da cercare.');

    if (!empty($_GET['has_model'])) $where[] = "COALESCE(e.modello_3d, '') <> ''";
    $show = ha_show_col($pdo);
    if (!$isAdmin && $show) $where[] = "$show = 1";

    $st = $pdo->prepare('
      SELECT e.id_ese, e.titolo_esercitazione, e.abstract_esercitazione, e.immagine, e.modello_3d, e.ese_folder,
             a.nome, a.cognome, a.year_folder, a.main_folder' . ($show ? ", $show AS flag_show" : '') . '
      FROM Esercitazione e INNER JOIN Allievi a ON a.idu = e.idu
      WHERE ' . implode(' AND ', $where) . '
      ORDER BY a.cognome, a.nome, e.id_ese
      LIMIT ' . (HA_MAX_ITEMS + 1));
    $st->execute($par);
    $rows = $st->fetchAll();
    $truncated = count($rows) > HA_MAX_ITEMS;
    $rows = array_slice($rows, 0, HA_MAX_ITEMS);
    $items = array_map(function ($r) use ($show) {
      $model = trim((string)($r['modello_3d'] ?? ''));
      return [
        'id_ese'     => (int)$r['id_ese'],
        'author'     => trim($r['cognome'] . ' ' . $r['nome']),
        'title'      => (string)$r['titolo_esercitazione'],
        'abstract'   => mb_substr(trim(strip_tags((string)$r['abstract_esercitazione'])), 0, 600),
        'cover_url'  => hys_url($r, (string)($r['immagine'] ?? '')),
        'model_file' => $model,
        'model_url'  => hys_url($r, $model),
        'model_ext'  => $model === '' ? '' : ha_ext($model),
        'hidden'     => $show ? (int)$r['flag_show'] !== 1 : false,
      ];
    }, $rows);
    ha_out(['ok' => true, 'data' => ['total' => count($items), 'truncated' => $truncated, 'items' => $items, 'admin' => $isAdmin]]);
  }

  // ── da qui: solo amministratore ─────────────────────────────────────────────
  if (!$isAdmin) ha_err('Operazione riservata all\'amministratore.', 403);

  if ($method === 'GET' && $action === 'files') {
    $e = ha_exercise($pdo, (int)($_GET['id_ese'] ?? 0));
    $base = ha_dir($e);
    $dirs = [''];
    $files = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS),
                                        RecursiveIteratorIterator::SELF_FIRST);
    foreach ($it as $f) {
      $rel = str_replace(DIRECTORY_SEPARATOR, '/', substr($f->getPathname(), strlen($base) + 1));
      if ($f->isDir()) { $dirs[] = $rel; continue; }
      if (str_contains($f->getFilename(), '.tmp-')) continue;
      if (count($files) >= HA_MAX_LIST) break;
      $files[] = ['path' => $rel, 'size' => $f->getSize(), 'mtime' => date('Y-m-d H:i', $f->getMTime()), 'url' => hys_url($e, $rel)];
    }
    sort($dirs, SORT_NATURAL | SORT_FLAG_CASE);
    usort($files, fn($a, $b) => strnatcasecmp($a['path'], $b['path']));
    ha_out(['ok' => true, 'data' => ['dirs' => $dirs, 'files' => $files, 'model_file' => (string)($e['modello_3d'] ?? '')]]);
  }

  if ($method !== 'POST') ha_err('Metodo o azione non riconosciuti.', 405);

  // ── upload di un file nella cartella dell'esercitazione ──────────────────────
  if ($action === 'upload') {
    $e = ha_exercise($pdo, (int)($_GET['id_ese'] ?? 0));
    $base = ha_dir($e);
    $name = ha_segments((string)($_GET['name'] ?? ''));
    if (count($name) !== 1) ha_err('Il nome del file non può contenere cartelle: scegli la cartella a parte.');
    $cfg = @include __DIR__ . '/../cfg/cfg_Upload.php';
    $allowed = array_merge(is_array($cfg) ? (array)($cfg['allowed_ext'] ?? []) : [], HA_EXTRA_EXT);
    // pagine HTML escluse: l'archivio non le usa e la cartella delle esercitazioni non è RA_Data
    $allowed = array_values(array_diff($allowed, is_array($cfg) ? (array)($cfg['sandbox_ext'] ?? []) : ['html', 'htm']));
    if (!in_array(ha_ext($name[0]), $allowed, true)) ha_err('Estensione non ammessa: .' . ha_ext($name[0]));
    $parts = array_merge(ha_segments((string)($_GET['dir'] ?? ''), true), $name);
    $rel = ha_write($base, $parts, ha_body(), !empty($_GET['overwrite']));
    ha_out(['ok' => true, 'data' => ['path' => $rel, 'url' => hys_url($e, $rel)]]);
  }

  // ── salvataggio del modello esportato dalla scena (GLB) ──────────────────────
  if ($action === 'save') {
    $id = (int)($_GET['id_ese'] ?? 0);
    $e = ha_exercise($pdo, $id);
    $base = ha_dir($e);
    $parts = ha_segments((string)($_GET['name'] ?? ''));
    if (ha_ext(end($parts)) !== 'glb') ha_err('Il modello si salva in formato .glb.');
    $glb = ha_body();
    if (substr($glb, 0, 4) !== 'glTF') ha_err('Il file ricevuto non è un GLB (intestazione glTF assente).');
    $rel = ha_write($base, $parts, $glb, !empty($_GET['overwrite']));
    $setModel = !isset($_GET['set_model']) || !empty($_GET['set_model']);
    if ($setModel) $pdo->prepare('UPDATE Esercitazione SET modello_3d = ? WHERE id_ese = ?')->execute([$rel, $id]);
    ha_out(['ok' => true, 'data' => ['id_ese' => $id, 'model_file' => $rel, 'model_url' => hys_url($e, $rel),
                                     'bytes' => strlen($glb), 'model_set' => $setModel]]);
  }

  // ── cancellazione (doppia conferma nel client, parola di conferma qui) ────────
  $body = json_decode((string)file_get_contents('php://input'), true);
  if (!is_array($body)) ha_err('JSON non valido.');
  if (($body['action'] ?? '') === 'delete') {
    $id = (int)($body['id_ese'] ?? 0);
    if (($body['confirm'] ?? '') !== 'ELIMINA') ha_err('Conferma mancante.');
    $e = ha_exercise($pdo, $id);

    // la cartella si cancella solo se nessun'altra esercitazione la usa
    $st = $pdo->prepare('SELECT COUNT(*) FROM Esercitazione e INNER JOIN Allievi a ON a.idu = e.idu
                         WHERE e.id_ese <> ? AND a.year_folder = ? AND a.main_folder = ? AND e.ese_folder = ?');
    $st->execute([$id, $e['year_folder'], $e['main_folder'], $e['ese_folder']]);
    $shared = (int)$st->fetchColumn() > 0;

    $pdo->beginTransaction();
    try {
      $pdo->prepare('DELETE FROM Paragrafo WHERE id_ese = ?')->execute([$id]);
      $pdo->prepare('DELETE FROM Esercitazione WHERE id_ese = ?')->execute([$id]);
      $pdo->commit();
    } catch (Throwable $t) {
      $pdo->rollBack();
      throw $t;
    }

    $folder = 'non trovata';
    $dir = hys_fs_dir($e);
    $base = realpath(rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\') . str_replace('/', DIRECTORY_SEPARATOR, rtrim(HYS_IMG_BASE, '/')));
    $real = $dir !== null ? realpath($dir) : false;
    if ($shared) {
      $folder = 'mantenuta (usata da altre esercitazioni)';
    } elseif ($real !== false && $base !== false && is_dir($real)
              && strncasecmp($real, $base . DIRECTORY_SEPARATOR, strlen($base) + 1) === 0
              && substr_count(substr($real, strlen($base) + 1), DIRECTORY_SEPARATOR) === 2) {   // anno/main/ese
      try { ha_rmdir($real); $folder = 'cancellata'; }
      catch (Throwable $t) { $folder = 'cancellazione incompleta: ' . $t->getMessage(); }
    }
    ha_out(['ok' => true, 'data' => ['id_ese' => $id, 'folder' => $folder]]);
  }

  ha_err('Azione POST non riconosciuta: upload, save, delete.');
} catch (Throwable $t) {
  error_log('[hys_archive_tool] ' . $t->getMessage());
  ha_err('Errore del server: ' . $t->getMessage(), 500);
}
