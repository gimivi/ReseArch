<?php
// api/grid.php
// API dati tabellari per model_MYS: legge / scrive su un DB MySQL esterno.
//
// POST { action, mod_id, ... }
//
// action='list'   → { fields?, where?, orderBy?, limit?, offset? }
// action='insert' → { data: {col:val, ...} }
// action='update' → { pk, data: {col:val, ...} }
// action='delete' → { pk }
//
// Sicurezza:
//   - Autenticazione sessione obbligatoria
//   - Verifica che mod_id appartenga al workpackage corrente (main DB)
//   - La tabella viene letta SOLO dal mod_spec del DB, mai dal client
//   - Colonne e campi validati contro cfg/grid_schema.php (whitelist server-side)
//   - Il database della tabella è 'db_data' di cfg_MYSQL.php, oppure la chiave "db" della
//     sua voce in cfg/grid_schema.php
//   - INSERT/UPDATE/DELETE richiedono writable:true nello schema
//   - PDO prepared statements su tutti i parametri variabili

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) session_start();

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(mixed $data = null): never {
    echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['success' => false, 'message' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function isAllowed(string $col, array $allowed): bool {
    return in_array('*', $allowed, true) || in_array($col, $allowed, true);
}

// Valida un array assoc {campo:valore} e ritorna ([cols], [vals]) per SET / VALUES.
// Lancia fail() se un campo non è nella whitelist.
function validateWriteFields(array $data, array $allowedCols, string $pkField): array {
    $cols = [];
    $vals = [];
    foreach ($data as $col => $val) {
        $col = (string)$col;
        if ($col === '' || $col === $pkField || str_starts_with($col, '_')) continue;
        if (!isAllowed($col, $allowedCols)) fail("Colonna non consentita: $col", 403);
        $cols[] = $col;
        $vals[] = ($val === '' || $val === null) ? null : $val;
    }
    return [$cols, $vals];
}

// ── Auth — main ReseArch DB ───────────────────────────────────────────────────

require_once __DIR__ . '/db.php';         // → $pdo  (main ReseArch DB)
require_once __DIR__ . '/log_tool.php';
require_once __DIR__ . '/visibility.php';   // ra_session_user_ok, ra_is_guest (ospiti, id 0)

$user = $_SESSION['user'] ?? null;
if (!ra_session_user_ok($user)) fail('Non autenticato.', 401);
$userId = (int)$user['id'];

$workpackage = $_SESSION['workpackage'] ?? null;
if (!is_array($workpackage)) fail('Contesto workpackage mancante.', 500);
$wp_id = (int)($workpackage['wp_id'] ?? 0);
if ($wp_id <= 0) fail('wp_id non disponibile.', 500);

// ── Body ──────────────────────────────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Metodo HTTP non supportato.', 405);

$raw = file_get_contents('php://input');
$req = json_decode($raw, true);
if (!is_array($req)) fail('Body JSON non valido.', 400);

$action = (string)($req['action'] ?? '');
if (ra_is_guest($user) && $action !== 'list') fail('Gli ospiti possono solo consultare.', 403);
if (!in_array($action, ['list', 'insert', 'update', 'delete'], true))
    fail('Azione non supportata.', 400);

// ── Verifica mod_id appartiene al wp corrente ─────────────────────────────────

$mod_id = isset($req['mod_id']) ? (int)$req['mod_id'] : 0;
if ($mod_id <= 0) fail('mod_id mancante.', 400);

$st = $pdo->prepare("
    SELECT mod_spec
    FROM   models
    WHERE  mod_id = ? AND wp_id = ?
    LIMIT  1
");
$st->execute([$mod_id, $wp_id]);
$modelRow = $st->fetch(PDO::FETCH_ASSOC);
if (!$modelRow) fail('Modello non trovato o accesso negato.', 403);

// ── Legge mod_spec dal DB (fonte autorevole) ──────────────────────────────────

$modSpec = [];
if (!empty($modelRow['mod_spec'])) {
    $modSpec = is_string($modelRow['mod_spec'])
        ? (json_decode($modelRow['mod_spec'], true) ?: [])
        : (array)$modelRow['mod_spec'];
}

$table = (string)($modSpec['table'] ?? '');
if ($table === '') fail('mod_spec.table non configurato nel modello.', 500);

// ── Whitelist schema ──────────────────────────────────────────────────────────

// Elenco delle tabelle di questa installazione: cfg/grid_schema.php (escluso da git,
// modello cfg/grid_schema.example.php). Senza il file nessuna tabella è leggibile.
$schemaFile = __DIR__ . '/../cfg/grid_schema.php';
$schema = is_file($schemaFile) ? require $schemaFile : [];
if (!is_array($schema)) $schema = [];
if (!isset($schema[$table])) fail("Tabella '$table' non presente nella whitelist.", 403);

$tblCfg        = $schema[$table];
$allowedCols   = $tblCfg['columns']    ?? ['*'];
$allowedFilter = $tblCfg['filterable'] ?? ['*'];
$allowedSort   = $tblCfg['sortable']   ?? ['*'];
$pkField       = (string)($tblCfg['id']       ?? 'id');
$writable      = (bool)($tblCfg['writable']   ?? false);

// Database della tabella (facoltativo): la voce può indicare "db" => "nome" quando la
// tabella non sta in 'db_data' di cfg_MYSQL.php. Il nome viene solo dalla configurazione
// del server, mai dal client; l'utente MySQL deve avere i privilegi anche su quel database.
$tblDb = (string)($tblCfg['db'] ?? '');
if ($tblDb !== '' && !preg_match('/^[A-Za-z0-9_]{1,64}$/', $tblDb)) {
    error_log("[grid.php] nome di database non valido per la tabella '$table' in cfg/grid_schema.php");
    fail('Configurazione della tabella non valida.', 500);
}
$tableSql = $tblDb !== '' ? "`$tblDb`.`$table`" : "`$table`";

// ── Connessione al DB esterno (dati) ──────────────────────────────────────────

$pdoMain = $pdo;
require __DIR__ . '/db_MYS_obj.php';   // → $pdo  (DB esterno)
$pdoData = $pdo;
$pdo     = $pdoMain;                   // ripristina main DB

// ─────────────────────────────────────────────────────────────────────────────

try {

    // ── SELECT list ───────────────────────────────────────────────────────────

    if ($action === 'list') {

        // Campi da selezionare
        $specFields = $modSpec['fields'] ?? ['*'];
        $reqFields  = is_array($req['fields'] ?? null) ? $req['fields'] : $specFields;

        $selectSql = '*';
        if (!(count($reqFields) === 1 && $reqFields[0] === '*')) {
            $clean = [];
            foreach ($reqFields as $c) {
                if (!is_string($c) || $c === '') continue;
                if (!isAllowed($c, $allowedCols)) fail("Colonna non consentita: $c", 403);
                $clean[] = "`$c`";
            }
            if (!$clean) fail('Nessuna colonna valida.', 400);
            $selectSql = implode(', ', $clean);
        }

        $sql    = "SELECT $selectSql FROM $tableSql";
        $params = [];

        // WHERE: unisce clausole fisse (mod_spec) + opzionali (client)
        $specWhere   = is_array($modSpec['where']   ?? null) ? $modSpec['where']   : [];
        $clientWhere = is_array($req['where']        ?? null) ? $req['where']        : [];
        $allWhere    = array_merge($specWhere, $clientWhere);

        $clauses = [];
        foreach ($allWhere as $i => $w) {
            if (!is_array($w)) continue;
            $f   = (string)($w['field'] ?? '');
            $op  = strtolower(trim((string)($w['op'] ?? '=')));
            $val = $w['value'] ?? null;
            if ($f === '') continue;
            if (!isAllowed($f, $allowedFilter)) fail("Filtro non consentito su: $f", 403);
            if (!in_array($op, ['=', 'like', '!=', '<', '<=', '>', '>='], true))
                fail("Operatore non supportato: $op", 400);
            $p          = ":w$i";
            $opSql      = strtoupper($op === 'like' ? 'LIKE' : $op);
            $clauses[]  = "`$f` $opSql $p";
            $params[$p] = $val;
        }
        if ($clauses) $sql .= ' WHERE ' . implode(' AND ', $clauses);

        // ORDER BY: mod_spec + client
        $specOrder   = is_array($modSpec['orderBy'] ?? null) ? $modSpec['orderBy'] : [];
        $clientOrder = is_array($req['orderBy']     ?? null) ? $req['orderBy']     : [];
        $allOrder    = array_merge($specOrder, $clientOrder);

        $orderParts = [];
        foreach ($allOrder as $o) {
            if (!is_array($o)) continue;
            $f   = (string)($o['field'] ?? '');
            $dir = strtolower((string)($o['dir'] ?? 'asc'));
            if ($f === '') continue;
            if (!isAllowed($f, $allowedSort)) fail("Ordinamento non consentito su: $f", 403);
            if (!in_array($dir, ['asc', 'desc'], true)) $dir = 'asc';
            $orderParts[] = "`$f` " . strtoupper($dir);
        }
        if ($orderParts) $sql .= ' ORDER BY ' . implode(', ', $orderParts);

        // LIMIT / OFFSET
        $maxLimit = (int)($tblCfg['maxLimit'] ?? 5000);
        $defLimit = (int)($modSpec['limit']   ?? 500);
        $limit    = isset($req['limit'])  ? (int)$req['limit']  : $defLimit;
        $offset   = isset($req['offset']) ? (int)$req['offset'] : 0;
        $limit    = max(1, min($limit, $maxLimit));
        $offset   = max(0, $offset);
        $sql .= " LIMIT $limit OFFSET $offset";

        $stmt = $pdoData->prepare($sql);
        foreach ($params as $k => $v) $stmt->bindValue($k, $v);
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        log_activity('grid:list', 'model', $mod_id, $table, ['rows' => count($rows)]);
        ok([
            'rows'     => $rows,
            'pkField'  => $pkField,
            'writable' => $writable,
        ]);
    }

    // ── INSERT ────────────────────────────────────────────────────────────────

    if ($action === 'insert') {
        if (!$writable) fail("Tabella '$table' non modificabile.", 403);
        $data = is_array($req['data'] ?? null) ? $req['data'] : [];
        if (!$data) fail('Nessun dato da inserire.', 400);

        [$cols, $vals] = validateWriteFields($data, $allowedCols, $pkField);
        if (!$cols) fail('Nessuna colonna valida.', 400);

        $colsSql  = implode(', ', array_map(fn($c) => "`$c`", $cols));
        $phSql    = implode(', ', array_fill(0, count($cols), '?'));
        $stmt     = $pdoData->prepare("INSERT INTO $tableSql ($colsSql) VALUES ($phSql)");
        $stmt->execute($vals);

        $insertId = (int)$pdoData->lastInsertId();
        log_activity('grid:insert', 'model', $mod_id, $table, ['insertId' => $insertId]);
        ok(['insertId' => $insertId]);
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────

    if ($action === 'update') {
        if (!$writable) fail("Tabella '$table' non modificabile.", 403);
        $pk   = $req['pk'] ?? null;
        $data = is_array($req['data'] ?? null) ? $req['data'] : [];
        if ($pk === null) fail('pk mancante.', 400);
        if (!$data) fail('Nessun dato da aggiornare.', 400);

        [$cols, $vals] = validateWriteFields($data, $allowedCols, $pkField);
        if (!$cols) fail('Nessuna colonna valida.', 400);

        $setSql   = implode(', ', array_map(fn($c) => "`$c` = ?", $cols));
        $vals[]   = $pk;    // parametro finale per WHERE
        $stmt     = $pdoData->prepare("UPDATE $tableSql SET $setSql WHERE `$pkField` = ?");
        $stmt->execute($vals);

        log_activity('grid:update', 'model', $mod_id, $table, ['pk' => $pk]);
        ok(['affected' => $stmt->rowCount()]);
    }

    // ── DELETE ────────────────────────────────────────────────────────────────

    if ($action === 'delete') {
        if (!$writable) fail("Tabella '$table' non modificabile.", 403);
        $pk = $req['pk'] ?? null;
        if ($pk === null) fail('pk mancante.', 400);

        $stmt = $pdoData->prepare("DELETE FROM $tableSql WHERE `$pkField` = ?");
        $stmt->execute([$pk]);

        log_activity('grid:delete', 'model', $mod_id, $table, ['pk' => $pk]);
        ok(['affected' => $stmt->rowCount()]);
    }

} catch (Throwable $e) {
    error_log('[grid.php] ' . $e->getMessage());
    fail('Errore server.', 500);
}
