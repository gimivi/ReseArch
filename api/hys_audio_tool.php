<?php
// api/hys_audio_tool.php — risoluzione dei file audio per i nodi HYS/Audio/* dei flow.
//
//   GET ?action=resolve&flow_id=N&path=REL      (flow salvato: caso normale)
//   GET ?action=resolve&obj_id=N&path=REL       (senza flow: test dall'editor FLE)
//   → { ok, data: { base, files: [ { url, name, rel } ] } }
//
// Cartella di partenza = cartella del WORKPACKAGE del flow (flows.flow_wp), oppure
// dell'oggetto (objects.wp_id) quando si passa obj_id:
//   RA_Data/{cartella ricerca}/{cartella WP}/…  (stesso schema di resolve_model_web_url)
// REL è relativo a quella cartella:
//   - un file audio          "Musica/brano1.mp3"  → quel file
//   - una cartella           "Musica/" o "Musica" → tutti i file audio contenuti,
//                                                    sottocartelle comprese (ordinati per nome)
//   - vuoto                                        → la cartella del WP stessa
//
// Sicurezza: solo percorsi relativi, nessun ".." né percorso assoluto; il risultato
// deve restare dentro la cartella del WP (controllo su disco con realpath).
// Accesso: il flow deve appartenere al WP di sessione oppure essere collegato a un
// oggetto di quel WP (object_flows_connections).

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) session_start();

require_once __DIR__ . '/db.php'; // fornisce $pdo

function ha_ok(mixed $data): never {
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function ha_err(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

// Estensioni restituite (il caricamento oggi ammette solo mp3; le altre se copiate a mano)
const HA_AUDIO_EXT = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav'];
const HA_MAX_FILES = 500;
const HA_MAX_DEPTH = 4;

// --- Auth -------------------------------------------------------------------

$user = $_SESSION['user'] ?? null;
require_once __DIR__ . '/visibility.php';   // ra_session_user_ok, ra_is_guest (ospiti, id 0)
if (!ra_session_user_ok($user)) ha_err('Non autenticato.', 401);   // solo lettura: aperta agli ospiti

$wpSession = (int)($_SESSION['workpackage']['wp_id'] ?? 0);
if ($wpSession <= 0) ha_err('wp_id non disponibile in sessione.', 500);

$paths = $_SESSION['paths'] ?? null;
$dataPath = is_array($paths) ? (string)($paths['data_path'] ?? '') : '';
if ($dataPath === '') ha_err('Configurazione percorsi non disponibile in sessione.', 500);

if (!isset($pdo) || !($pdo instanceof PDO)) ha_err('Connessione DB non disponibile.', 500);

// --- Input ------------------------------------------------------------------

$action = (string)($_GET['action'] ?? '');
if ($action !== 'resolve') ha_err('Azione non riconosciuta. Usare: resolve');

$flowId = filter_input(INPUT_GET, 'flow_id', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$objId  = filter_input(INPUT_GET, 'obj_id',  FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if (!$flowId && !$objId) ha_err('flow_id o obj_id mancante o non valido.');

$rel = str_replace('\\', '/', trim((string)($_GET['path'] ?? '')));
if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $rel) || str_starts_with($rel, '//')) {
    ha_err('Solo percorsi relativi alla cartella del WP (gli URL assoluti si usano direttamente).');
}
$segments = array_values(array_filter(explode('/', $rel), fn($s) => $s !== '' && $s !== '.'));
foreach ($segments as $seg) {
    if ($seg === '..') ha_err('Percorso non consentito ("..").');
    if (preg_match('/[\x00-\x1F<>:"|?*]/', $seg)) ha_err('Carattere non consentito nel percorso.');
}

try {
    // --- WP di riferimento e permesso ----------------------------------------
    if ($flowId) {
        $st = $pdo->prepare("SELECT flow_id, flow_wp FROM flows WHERE flow_id = ? LIMIT 1");
        $st->execute([$flowId]);
        $flow = $st->fetch(PDO::FETCH_ASSOC);
        if (!$flow) ha_err('Flow non trovato.', 404);

        $allowed = ((int)$flow['flow_wp'] === $wpSession);
        if (!$allowed) {
            $st = $pdo->prepare("
                SELECT 1
                FROM object_flows_connections ofc
                JOIN objects o ON o.obj_id = ofc.target_id
                WHERE ofc.flow_id = ? AND ofc.flow_type = 'object' AND o.wp_id = ?
                LIMIT 1");
            $st->execute([$flowId, $wpSession]);
            $allowed = (bool)$st->fetchColumn();
        }
        if (!$allowed) ha_err('Flow non accessibile dal workpackage corrente.', 403);
        $refWp = (int)$flow['flow_wp'];
    } else {
        $st = $pdo->prepare("SELECT wp_id FROM objects WHERE obj_id = ? AND wp_id = ? LIMIT 1");
        $st->execute([$objId, $wpSession]);
        $refWp = (int)($st->fetchColumn() ?: 0);
        if ($refWp <= 0) ha_err('Oggetto non trovato nel workpackage corrente.', 404);
    }

    // --- Cartella del WP del flow -------------------------------------------
    $st = $pdo->prepare("
        SELECT fr.folder_name AS res_folder, fw.folder_name AS wp_folder
        FROM workpackages w
        JOIN researches r  ON r.res_id = w.res_id
        JOIN folders fr    ON fr.folder_id = r.res_folder_id
        JOIN folders fw    ON fw.folder_id = w.wp_folder_id
        WHERE w.wp_id = ?
        LIMIT 1");
    $st->execute([$refWp]);
    $f = $st->fetch(PDO::FETCH_ASSOC);
    if (!$f) ha_err('Cartella del workpackage non trovata.', 404);

    $webBase = rtrim($dataPath, '/') . '/' . rawurlencode((string)$f['res_folder']) . '/' . rawurlencode((string)$f['wp_folder']);
    $fsBase  = rtrim((string)$_SERVER['DOCUMENT_ROOT'], '/\\') . str_replace('/', DIRECTORY_SEPARATOR,
                 rtrim($dataPath, '/') . '/' . $f['res_folder'] . '/' . $f['wp_folder']);
    $fsBaseReal = realpath($fsBase);
    if ($fsBaseReal === false || !is_dir($fsBaseReal)) ha_err('Cartella del workpackage non presente su disco.', 404);

    // --- Risoluzione ----------------------------------------------------------
    $target = $fsBaseReal . (count($segments) ? DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $segments) : '');
    $targetReal = realpath($target);
    if ($targetReal === false) ha_err('Percorso non trovato: ' . implode('/', $segments), 404);
    if ($targetReal !== $fsBaseReal && !str_starts_with($targetReal, $fsBaseReal . DIRECTORY_SEPARATOR)) {
        ha_err('Percorso fuori dalla cartella del workpackage.', 403);
    }

    $isAudio = fn(string $p) => in_array(strtolower(pathinfo($p, PATHINFO_EXTENSION)), HA_AUDIO_EXT, true);
    $toItem = function (string $absPath) use ($fsBaseReal, $webBase): array {
        $relPath = str_replace(DIRECTORY_SEPARATOR, '/', substr($absPath, strlen($fsBaseReal) + 1));
        $url = $webBase . '/' . implode('/', array_map('rawurlencode', explode('/', $relPath)));
        return ['url' => $url, 'name' => basename($absPath), 'rel' => $relPath];
    };

    $files = [];
    if (is_file($targetReal)) {
        if (!$isAudio($targetReal)) ha_err('Il file indicato non è un file audio supportato.');
        $files[] = $toItem($targetReal);
    } else {
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($targetReal, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        $it->setMaxDepth(HA_MAX_DEPTH);
        foreach ($it as $file) {
            /** @var SplFileInfo $file */
            if (!$file->isFile() || !$isAudio($file->getFilename())) continue;
            $real = realpath($file->getPathname());
            if ($real === false || !str_starts_with($real, $fsBaseReal . DIRECTORY_SEPARATOR)) continue;
            $files[] = $toItem($real);
            if (count($files) >= HA_MAX_FILES) break;
        }
        usort($files, fn($a, $b) => strnatcasecmp($a['rel'], $b['rel']));
    }

    ha_ok(['base' => $webBase, 'files' => $files]);

} catch (Throwable $e) {
    error_log('[hys_audio_tool] ' . $e->getMessage());
    ha_err('Errore server.', 500);
}
