<?php
// api/log_view.php
// POST JSON { obj_id, obj_app, obj_name }
// Registra in activity_log l'apertura di un oggetto nel panel.

if (session_status() === PHP_SESSION_NONE) session_start();

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed']);
    exit;
}

if (!isset($_SESSION['user'])) {
    http_response_code(401);
    echo json_encode(['error' => 'not_authenticated']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_json']);
    exit;
}

$objId   = isset($body['obj_id'])   ? (int)$body['obj_id']        : null;
$objApp  = isset($body['obj_app'])  ? trim((string)$body['obj_app'])  : '';
$objName = isset($body['obj_name']) ? trim((string)$body['obj_name']) : '';

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';

log_activity(
    'object:view',
    'object',
    $objId > 0 ? $objId : null,
    $objName,
    $objApp !== '' ? ['app' => $objApp] : null
);

echo json_encode(['ok' => true]);
