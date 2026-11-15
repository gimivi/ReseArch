<?php
// api/heartbeat.php
// Endpoint POST: aggiorna last_activity della sessione corrente.
// Risponde con { active_count: N }
// Chiamato da js/monitor.js ogni 60 secondi.

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

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

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';

$page = isset($_POST['page']) ? trim($_POST['page']) : '';
session_heartbeat($page);

echo json_encode(['active_count' => get_active_count()]);
