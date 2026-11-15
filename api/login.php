<?php
// api/login.php

session_start();
ob_start(); // buffer per eliminare eventuali output indesiderati
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/i18n.php';   // messaggi nella lingua della richiesta

// Funzione helper per rispondere in JSON e uscire puliti
function send_json($statusCode, $success, $message, $extra = []) {
    http_response_code($statusCode);
    if (ob_get_length()) {
        ob_clean();
    }
    $response = array_merge([
        'success' => $success,
        'message' => $message
    ], $extra);

    echo json_encode($response);
    exit;
}

// 1) Permettiamo solo POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_json(405, false, t('errors.method_not_allowed'));
}

// 2) Leggiamo i parametri dalla form (campo "username" che può contenere email)
$usernameOrEmail = isset($_POST['username']) ? trim($_POST['username']) : '';
$password        = isset($_POST['password']) ? $_POST['password'] : '';

if ($usernameOrEmail === '' || $password === '') {
    send_json(400, false, t('auth.login.fill_all'));
}

// 3) Connessione al DB
require_once __DIR__ . '/db.php';

try {
    /**
     * NUOVO SCHEMA:
     *  - Tabella: users
     *  - Login per ora solo via email (il campo "username" del form può contenere un indirizzo email)
     *
     * Se in futuro aggiungi una colonna `username` alla tabella, potrai fare una WHERE del tipo:
     *   WHERE email = :id OR username = :id
     */

    /*
    
    $sql = "
        SELECT *
        FROM users
        WHERE email = :identifier OR user_name = :identifier
        LIMIT 1
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->bindValue(':identifier', $usernameOrEmail, PDO::PARAM_STR);
    $stmt->execute();
    
    */

    $sql = "
        SELECT *
        FROM users
        WHERE email = :id_email OR user_name = :id_user
        LIMIT 1
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->bindValue(':id_email', $usernameOrEmail, PDO::PARAM_STR);
    $stmt->bindValue(':id_user',  $usernameOrEmail, PDO::PARAM_STR);
    $stmt->execute();








    $user = $stmt->fetch();

    // 4) Utente non trovato
    if (!$user) {
        // Messaggio generico per non dare troppe info
        send_json(401, false, t('auth.login.bad_credentials'));
    }

    // 5) Controllo password hash (assente = utente che entra solo con un account esterno)
    if (empty($user['password_hash']) || !password_verify($password, $user['password_hash'])) {
        send_json(401, false, t('auth.login.bad_credentials'));
    }

    // 6) Controllo verifica email
    if ((int)$user['is_verified'] !== 1) {
        send_json(403, false, t('auth.login.not_verified'));
    }

    // 7) Login OK → salviamo in sessione
    $displayName = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? ''));
    if ($displayName === '') {
        $displayName = $user['email'];
    }

    //$_SESSION['user_id']   = $user['id'];
    //$_SESSION['user_name'] = $displayName;
    // Se in futuro aggiungi ruoli, puoi aggiungere $_SESSION['usertype']
    // Sessione nuova (session fixation) e niente password_hash in sessione: api/session_user.php
    require_once __DIR__ . '/session_user.php';
    ra_session_set_user($user, true);

    // Log login e apertura sessione attiva
    require_once __DIR__ . '/log_tool.php';
    session_heartbeat('login');
    log_activity('auth:login');

    send_json(200, true, t('auth.login.success'), [
        'username' => $displayName
    ]);

} 

catch (Exception $e) {
    // In produzione puoi loggare l’errore e non inviare il dettaglio al client
    error_log('Login error: ' . $e->getMessage());
    send_json(500, false, t('errors.internal'));
}
 