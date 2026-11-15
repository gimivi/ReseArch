<?php
// api/activity_log_api.php
// GET → log attività paginato per Tabulator (solo user_type = X)
// Parametri query string:
//   page   (int, default 1)
//   size   (int, default 20, max 100)
//   sort   (JSON: [{"field":"created_at","dir":"desc"}])
//   filter_action     (string, opzionale)
//   filter_entity     (string, opzionale)
//   filter_date_from  (date Y-m-d, opzionale)
//   filter_date_to    (date Y-m-d, opzionale)
//   filter_user_type  (X|P|I|U|C|V|G, opzionale) — G: le righe del registro degli ospiti
//                     (guest_access_log, _doc/arch-sso-ospiti.md); vuoto: membri + ospiti insieme

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');

if (!isset($_SESSION['user'])) {
    http_response_code(401);
    echo json_encode(['error' => 'not_authenticated']);
    exit;
}

if (($_SESSION['user']['user_type'] ?? '') !== 'X') {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

require_once __DIR__ . '/db.php';

// ── Parametri paginazione ─────────────────────────────────────────────────────
$page = max(1, (int)($_GET['page'] ?? 1));
$size = max(1, min(100, (int)($_GET['size'] ?? 20)));
$offset = ($page - 1) * $size;

// ── Colonne ordinabili (whitelist) ────────────────────────────────────────────
$ALLOWED_SORT = [
    'created_at', 'action', 'entity_type', 'entity_name', 'user_name'
];

$orderBy = 'al.created_at DESC'; // default
$sortRaw = $_GET['sort'] ?? '';
if ($sortRaw !== '') {
    $sortArr = json_decode($sortRaw, true);
    if (is_array($sortArr) && !empty($sortArr)) {
        $s = $sortArr[0];
        $field = $s['field'] ?? '';
        $dir   = strtoupper($s['dir'] ?? 'DESC') === 'ASC' ? 'ASC' : 'DESC';
        if (in_array($field, $ALLOWED_SORT, true)) {
            $orderBy = "al.$field $dir";
        }
    }
}

// ── Filtri ────────────────────────────────────────────────────────────────────
$where  = [];
$params = [];

$filterAction = trim($_GET['filter_action'] ?? '');
if ($filterAction !== '') {
    $where[]  = 'al.action LIKE :f_action';
    $params[':f_action'] = '%' . $filterAction . '%';
}

$filterEntity = trim($_GET['filter_entity'] ?? '');
if ($filterEntity !== '') {
    $where[]  = 'al.entity_type = :f_entity';
    $params[':f_entity'] = $filterEntity;
}

$filterDateFrom = trim($_GET['filter_date_from'] ?? '');
if ($filterDateFrom !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $filterDateFrom)) {
    $where[]  = 'al.created_at >= :f_date_from';
    $params[':f_date_from'] = $filterDateFrom . ' 00:00:00';
}

$filterDateTo = trim($_GET['filter_date_to'] ?? '');
if ($filterDateTo !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $filterDateTo)) {
    $where[]  = 'al.created_at <= :f_date_to';
    $params[':f_date_to'] = $filterDateTo . ' 23:59:59';
}

$filterType = strtoupper(trim($_GET['filter_user_type'] ?? ''));
if (!in_array($filterType, ['', 'X', 'P', 'I', 'U', 'C', 'V', 'G'], true)) $filterType = '';
if ($filterType !== '') {
    $where[]  = 'al.user_type = :f_type';
    $params[':f_type'] = $filterType;
}

$whereSQL = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

// ── Sorgente: log dei membri + registro degli ospiti, con le stesse colonne ──
$srcMembers = "
    SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.entity_name, a.ip,
           u.user_name, u.first_name, u.last_name, u.user_type
    FROM activity_log a
    JOIN users u ON u.id = a.user_id";
$srcGuests = "
    SELECT g.ga_id AS id, g.created_at, CONCAT('guest:', g.event) AS action,
           CASE WHEN g.event IN ('research', 'workpackage', 'object') THEN g.event ELSE '' END AS entity_type,
           g.ref_id AS entity_id, '' AS entity_name, g.ip, '' AS user_name,
           g.display_name AS first_name, CONCAT('(', g.provider, ')') AS last_name, 'G' AS user_type
    FROM guest_access_log g";
$src = match ($filterType) {
    'G'     => "$srcGuests",
    ''      => "$srcMembers UNION ALL $srcGuests",
    default => $srcMembers,
};

// ── Conteggio totale ──────────────────────────────────────────────────────────
// Senza guest_access_log (migrazione non eseguita) o se l'unione non riesce, si ripiega sui soli membri
try {
    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM ($src) al $whereSQL");
    $countStmt->execute($params);
} catch (PDOException $e) {
    if ($src === $srcMembers) throw $e;
    error_log('activity_log_api: registro ospiti escluso: ' . $e->getMessage());
    $src = $srcMembers;
    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM ($src) al $whereSQL");
    $countStmt->execute($params);
}
$total    = (int)$countStmt->fetchColumn();
$lastPage = max(1, (int)ceil($total / $size));

// ── Dati pagina ───────────────────────────────────────────────────────────────
$dataSQL = "
    SELECT al.*
    FROM ($src) al
    $whereSQL
    ORDER BY $orderBy
    LIMIT :limit OFFSET :offset
";

$dataStmt = $pdo->prepare($dataSQL);
foreach ($params as $k => $v) {
    $dataStmt->bindValue($k, $v);
}
$dataStmt->bindValue(':limit',  $size,   PDO::PARAM_INT);
$dataStmt->bindValue(':offset', $offset, PDO::PARAM_INT);
$dataStmt->execute();
$rows = $dataStmt->fetchAll();

// ── Risposta Tabulator ────────────────────────────────────────────────────────
echo json_encode([
    'last_page' => $lastPage,
    'data'      => $rows,
]);
