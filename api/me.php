<?php
// api/me.php
session_start();
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/i18n.php';

function send_json($statusCode, $success, $message, $extra = []) {
    http_response_code($statusCode);
    echo json_encode(array_merge([
        'success' => $success,
        'message' => $message
    ], $extra));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    send_json(405, false, t('errors.method_not_allowed'));
}

if (!isset($_SESSION['user']) || !is_array($_SESSION['user'])) {
    send_json(401, false, t('errors.not_authenticated'));
}

// Copia “sicura” (non mandare password_hash al client)
$user = $_SESSION['user'];
unset($user['password_hash']);

send_json(200, true, 'OK', ['user' => $user]);
