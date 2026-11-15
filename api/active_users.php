<?php
// api/active_users.php
// GET → lista utenti attivi, contenuto dipende dal ruolo:
//   X   → first_name, last_name, user_name, email, current_page, last_activity
//   altri (non V/G) → user_name, current_page, last_activity
//   V, G → 403

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');

if (!isset($_SESSION['user'])) {
    http_response_code(401);
    echo json_encode(['error' => 'not_authenticated']);
    exit;
}

$userType = $_SESSION['user']['user_type'] ?? '';

// V e G non hanno accesso alla lista
if (in_array($userType, ['V', 'G'], true)) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';

$users = get_active_users();

// Filtra i campi in base al ruolo
if ($userType === 'X') {
    // Amministratore: dati completi
    $result = array_map(function ($row) {
        return [
            'first_name'    => $row['first_name'],
            'last_name'     => $row['last_name'],
            'user_name'     => $row['user_name'],
            'guest'         => (int)$row['user_id'] === 0,
            'email'         => '', // popolato sotto via JOIN già presente in get_active_users
            'current_page'  => $row['current_page'],
            'last_activity' => $row['last_activity'],
            'user_type'     => $row['user_type'],
        ];
    }, $users);

    // get_active_users() non restituisce email: la aggiungiamo con una query dedicata
    if (!empty($result)) {
        $ids = array_unique(array_column($users, 'user_id'));
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare(
            "SELECT id, email FROM users WHERE id IN ($placeholders)"
        );
        $stmt->execute($ids);
        $emails = [];
        foreach ($stmt->fetchAll() as $row) {
            $emails[$row['id']] = $row['email'];
        }
        foreach ($users as $i => $row) {
            $result[$i]['email'] = $emails[$row['user_id']] ?? '';
        }
    }
} else {
    // Altri ruoli: solo username + pagina + ora
    // (gli ospiti compaiono senza nome: per gli altri utenti resta solo "Ospite")
    $result = array_map(function ($row) {
        return [
            'user_name'     => $row['user_name'],
            'guest'         => (int)$row['user_id'] === 0,
            'current_page'  => $row['current_page'],
            'last_activity' => $row['last_activity'],
        ];
    }, $users);
}

echo json_encode(['users' => $result, 'user_type' => $userType]);
