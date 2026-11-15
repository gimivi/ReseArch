<?php
// =============================================================================
// api/log_tool.php
// Helper centralizzato per logging attività e gestione sessioni utente attive.
//
// Funzioni pubbliche:
//   log_activity($action, $entityType, $entityId, $entityName, $detail)
//   session_heartbeat($page)
//   session_close()
//   get_active_count()
//   get_active_users()
//
// Dipendenze: richiede che $pdo (PDO) sia già disponibile nello scope chiamante,
// oppure viene incluso api/db.php se $pdo non è definito.
// Richiede che la sessione PHP sia già avviata (session_start()).
// =============================================================================

// Timeout sessione in minuti: utente considerato offline dopo questo periodo
define('SESSION_TIMEOUT_MINUTES', 10);

// Garantisce connessione PDO disponibile
if (!isset($pdo)) {
    require_once __DIR__ . '/db.php';
}

// -----------------------------------------------------------------------------
// _log_get_ip()
// Restituisce l'IP del client, tenendo conto di proxy comuni.
// -----------------------------------------------------------------------------
function _log_get_ip(): string {
    foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_CLIENT_IP', 'REMOTE_ADDR'] as $key) {
        if (!empty($_SERVER[$key])) {
            // X-Forwarded-For può contenere una lista: prendiamo il primo
            $ip = trim(explode(',', $_SERVER[$key])[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }
    }
    return '';
}

// -----------------------------------------------------------------------------
// log_activity()
// Inserisce una riga in activity_log.
//
// @param string      $action      Codice azione es. 'auth:login', 'object:create'
// @param string      $entityType  Tipo entità es. 'research', 'object', 'model'
// @param int|null    $entityId    ID della risorsa coinvolta (null se non applicabile)
// @param string      $entityName  Nome leggibile della risorsa
// @param array|null  $detail      Dati extra (serializzati come JSON)
// -----------------------------------------------------------------------------
function log_activity(
    string $action,
    string $entityType = '',
    ?int   $entityId   = null,
    string $entityName = '',
    ?array $detail     = null
): void {
    global $pdo;

    if (!isset($_SESSION['user'])) {
        return; // nessuna sessione attiva, non logghiamo
    }
    if (!empty($_SESSION['user']['guest'])) {
        return; // gli ospiti non sono in users: i loro accessi vanno in guest_access_log (api/guest_log.php)
    }

    $userId = (int)$_SESSION['user']['id'];
    $ip     = _log_get_ip();
    $json   = $detail !== null ? json_encode($detail, JSON_UNESCAPED_UNICODE) : null;

    try {
        $stmt = $pdo->prepare("
            INSERT INTO activity_log
                (user_id, action, entity_type, entity_id, entity_name, detail, ip, created_at)
            VALUES
                (:user_id, :action, :entity_type, :entity_id, :entity_name, :detail, :ip, NOW())
        ");
        $stmt->execute([
            ':user_id'     => $userId,
            ':action'      => $action,
            ':entity_type' => $entityType,
            ':entity_id'   => $entityId,
            ':entity_name' => $entityName,
            ':detail'      => $json,
            ':ip'          => $ip,
        ]);
    } catch (Exception $e) {
        error_log('log_activity error: ' . $e->getMessage());
    }
}

// -----------------------------------------------------------------------------
// log_activity_user()
// Come log_activity(), ma per un utente indicato esplicitamente: serve dove non c'è
// ancora una sessione (es. recupero della password, api/password_forgot.php e
// api/password_reset.php).
// -----------------------------------------------------------------------------
function log_activity_user(int $userId, string $action, ?array $detail = null): void {
    global $pdo;
    try {
        $pdo->prepare("
            INSERT INTO activity_log
                (user_id, action, entity_type, entity_id, entity_name, detail, ip, created_at)
            VALUES
                (:user_id, :action, 'user', :entity_id, '', :detail, :ip, NOW())
        ")->execute([
            ':user_id'   => $userId,
            ':action'    => $action,
            ':entity_id' => $userId,
            ':detail'    => $detail !== null ? json_encode($detail, JSON_UNESCAPED_UNICODE) : null,
            ':ip'        => _log_get_ip(),
        ]);
    } catch (Exception $e) {
        error_log('log_activity_user error: ' . $e->getMessage());
    }
}

// -----------------------------------------------------------------------------
// session_heartbeat()
// Crea o aggiorna la riga in users_sessions per la sessione corrente.
// Va chiamato a ogni richiesta autenticata (pagine PHP e heartbeat JS).
//
// @param string $page  Etichetta pagina corrente es. 'researches', 'dashboard'
// -----------------------------------------------------------------------------
function session_heartbeat(string $page = ''): void {
    global $pdo;

    if (!isset($_SESSION['user'])) {
        return;
    }

    $sessionId = session_id();
    $userId    = (int)$_SESSION['user']['id'];
    $ip        = _log_get_ip();
    $params    = [':sid' => $sessionId, ':uid' => $userId, ':ip' => $ip, ':page' => $page];

    // Ospite (user_id 0, non in users): nome e fornitore nella sessione, per il monitor
    // (colonna guest_label, sql/migration_sso_guests_monitor.sql)
    if (!empty($_SESSION['user']['guest'])) {
        $u = $_SESSION['user'];
        $params[':glabel'] = mb_substr(trim(($u['first_name'] ?? '') . ' (' . ($u['provider'] ?? '') . ')'), 0, 190);
        try {
            $pdo->prepare("
                INSERT INTO users_sessions
                    (session_id, user_id, last_activity, ip, current_page, guest_label, created_at)
                VALUES
                    (:sid, :uid, NOW(), :ip, :page, :glabel, NOW())
                ON DUPLICATE KEY UPDATE
                    last_activity = NOW(),
                    ip            = VALUES(ip),
                    current_page  = VALUES(current_page),
                    guest_label   = VALUES(guest_label)
            ")->execute($params);
            return;
        } catch (Exception $e) {
            unset($params[':glabel']);   // colonna non ancora creata: sessione senza nome
        }
    }

    try {
        $stmt = $pdo->prepare("
            INSERT INTO users_sessions
                (session_id, user_id, last_activity, ip, current_page, created_at)
            VALUES
                (:sid, :uid, NOW(), :ip, :page, NOW())
            ON DUPLICATE KEY UPDATE
                last_activity = NOW(),
                ip            = VALUES(ip),
                current_page  = VALUES(current_page)
        ");
        $stmt->execute($params);
    } catch (Exception $e) {
        error_log('session_heartbeat error: ' . $e->getMessage());
    }
}

// -----------------------------------------------------------------------------
// session_close()
// Rimuove la riga dalla tabella users_sessions al logout.
// -----------------------------------------------------------------------------
function session_close(): void {
    global $pdo;

    $sessionId = session_id();
    if (!$sessionId) {
        return;
    }

    try {
        $stmt = $pdo->prepare("
            DELETE FROM users_sessions WHERE session_id = :sid
        ");
        $stmt->execute([':sid' => $sessionId]);
    } catch (Exception $e) {
        error_log('session_close error: ' . $e->getMessage());
    }
}

// -----------------------------------------------------------------------------
// get_active_count()
// Restituisce il numero di sessioni attive negli ultimi SESSION_TIMEOUT_MINUTES.
// -----------------------------------------------------------------------------
function get_active_count(): int {
    global $pdo;

    try {
        $stmt = $pdo->prepare("
            SELECT COUNT(*) AS cnt
            FROM users_sessions
            WHERE last_activity >= NOW() - INTERVAL :mins MINUTE
        ");
        $stmt->execute([':mins' => SESSION_TIMEOUT_MINUTES]);
        $row = $stmt->fetch();
        return (int)($row['cnt'] ?? 0);
    } catch (Exception $e) {
        error_log('get_active_count error: ' . $e->getMessage());
        return 0;
    }
}

// -----------------------------------------------------------------------------
// get_active_users()
// Restituisce l'elenco degli utenti attivi con dati utente aggregati.
// Usata dall'endpoint api/active_users.php (solo admin).
// -----------------------------------------------------------------------------
function get_active_users(): array {
    global $pdo;

    // Membri (JOIN su users) e ospiti (user_id 0, nome in guest_label; _doc/arch-sso-ospiti.md).
    // Senza la colonna guest_label (migrazione non eseguita) si ripiega sui soli membri.
    $sqlMembers = "
            SELECT s.session_id, s.user_id, s.last_activity, s.ip, s.current_page, s.created_at,
                   u.first_name, u.last_name, u.user_name, u.user_type
            FROM users_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.last_activity >= NOW() - INTERVAL :mins MINUTE";
    $sqlGuests = "
            SELECT s.session_id, s.user_id, s.last_activity, s.ip, s.current_page, s.created_at,
                   s.guest_label AS first_name, '' AS last_name, '' AS user_name, 'G' AS user_type
            FROM users_sessions s
            WHERE s.user_id = 0 AND s.last_activity >= NOW() - INTERVAL :mins2 MINUTE";
    try {
        $stmt = $pdo->prepare("$sqlMembers UNION ALL $sqlGuests ORDER BY last_activity DESC");
        $stmt->execute([':mins' => SESSION_TIMEOUT_MINUTES, ':mins2' => SESSION_TIMEOUT_MINUTES]);
        return $stmt->fetchAll();
    } catch (Exception $e) {
        try {
            $stmt = $pdo->prepare("$sqlMembers ORDER BY s.last_activity DESC");
            $stmt->execute([':mins' => SESSION_TIMEOUT_MINUTES]);
            return $stmt->fetchAll();
        } catch (Exception $e2) {
            error_log('get_active_users error: ' . $e2->getMessage());
            return [];
        }
    }
}
