<?php
// api/db_maintenance_tool.php — manutenzione del database (solo amministratore).
// Finestra: ui/modal_db_maintenance.php (pagina delle ricerche, menu dell'amministratore).
//
//   GET  ?action=analyze               → per ogni controllo: righe trovate e alcuni id d'esempio
//   POST { action:"clean", keys:[...] } → esegue i controlli scelti (solo quelli con 'fix'),
//                                         in una transazione; restituisce le righe toccate
//
// Due gruppi di controlli:
//   orphans  — righe che puntano a qualcosa che non esiste più (le relazioni senza FOREIGN KEY
//              le mantiene l'applicazione: _doc/db-schema.md);
//   periodic — dati vecchi, con le soglie di cfg/cfg_maintenance.php (0 = disattivato).
// I controlli 'report' (entità principali senza contenitore: WP, oggetti, modelli, flow,
// cartelle) si segnalano soltanto: vanno valutati e cancellati a mano.
// L'ordine conta: prima si tolgono le righe "contenitore" (configurazioni senza WP), poi i
// collegamenti che puntavano a loro.
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
if (session_status() === PHP_SESSION_NONE) session_start();

require_once __DIR__ . '/i18n.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';

function dm_out(array $a, int $code = 200): never {
    http_response_code($code);
    echo json_encode($a, JSON_UNESCAPED_UNICODE);
    exit;
}
function dm_err(string $msg, int $code = 400): never { dm_out(['ok' => false, 'error' => $msg], $code); }

if (!is_array($_SESSION['user'] ?? null) || ($_SESSION['user']['user_type'] ?? '') !== 'X') {
    dm_err(t('errors.not_authorized'), 403);
}
if (!isset($pdo) || !($pdo instanceof PDO)) dm_err(t('errors.internal'), 500);

$CFG = require __DIR__ . '/../cfg/cfg_maintenance.php';
$days = fn(string $k): int => max(0, (int)($CFG[$k] ?? 0));

/**
 * Ogni controllo: group, ids (SELECT di una colonna "id" con le righe trovate), fix (SQL che
 * le toglie o le corregge; assente = solo segnalazione), param (soglia in giorni, se serve).
 * Le query sono costanti: nessun dato dell'utente entra nell'SQL (le soglie sono interi da cfg).
 */
function dm_checks(callable $days): array {
    $c = [];

    // ── Orfani: configurazioni e collegamenti ──────────────────────────────
    $c['dshp_no_wp'] = ['group' => 'orphans',
        'ids' => "SELECT d.dshp_id AS id FROM wp_dashboard_configs d LEFT JOIN workpackages w ON w.wp_id = d.dshp_wp WHERE w.wp_id IS NULL",
        'fix' => "DELETE d FROM wp_dashboard_configs d LEFT JOIN workpackages w ON w.wp_id = d.dshp_wp WHERE w.wp_id IS NULL"];
    $c['wp_default_dshp'] = ['group' => 'orphans',
        'ids' => "SELECT w.wp_id AS id FROM workpackages w LEFT JOIN wp_dashboard_configs d ON d.dshp_id = w.wp_default_dshp_id WHERE w.wp_default_dshp_id IS NOT NULL AND (d.dshp_id IS NULL OR d.dshp_wp <> w.wp_id)",
        'fix' => "UPDATE workpackages w LEFT JOIN wp_dashboard_configs d ON d.dshp_id = w.wp_default_dshp_id SET w.wp_default_dshp_id = NULL WHERE w.wp_default_dshp_id IS NOT NULL AND (d.dshp_id IS NULL OR d.dshp_wp <> w.wp_id)"];
    $c['omc'] = ['group' => 'orphans',
        'ids' => "SELECT c.id FROM object_models_connections c LEFT JOIN objects o ON o.obj_id = c.obj_id LEFT JOIN models m ON m.mod_id = c.mod_id WHERE o.obj_id IS NULL OR m.mod_id IS NULL",
        'fix' => "DELETE c FROM object_models_connections c LEFT JOIN objects o ON o.obj_id = c.obj_id LEFT JOIN models m ON m.mod_id = c.mod_id WHERE o.obj_id IS NULL OR m.mod_id IS NULL"];
    $c['ofc_object'] = ['group' => 'orphans',
        'ids' => "SELECT c.id FROM object_flows_connections c LEFT JOIN objects o ON o.obj_id = c.target_id WHERE c.flow_type = 'object' AND o.obj_id IS NULL",
        'fix' => "DELETE c FROM object_flows_connections c LEFT JOIN objects o ON o.obj_id = c.target_id WHERE c.flow_type = 'object' AND o.obj_id IS NULL"];
    $c['ofc_dashboard'] = ['group' => 'orphans',
        'ids' => "SELECT c.id FROM object_flows_connections c LEFT JOIN wp_dashboard_configs d ON d.dshp_id = c.target_id WHERE c.flow_type = 'dashboard' AND d.dshp_id IS NULL",
        'fix' => "DELETE c FROM object_flows_connections c LEFT JOIN wp_dashboard_configs d ON d.dshp_id = c.target_id WHERE c.flow_type = 'dashboard' AND d.dshp_id IS NULL"];

    // ── Orfani: autori ─────────────────────────────────────────────────────
    $c['authors_objects'] = ['group' => 'orphans',
        'ids' => "SELECT CONCAT(a.obj_id, ':', a.auth_id) AS id FROM authors_objects a LEFT JOIN objects o ON o.obj_id = a.obj_id LEFT JOIN users u ON u.id = a.auth_id WHERE o.obj_id IS NULL OR u.id IS NULL",
        'fix' => "DELETE a FROM authors_objects a LEFT JOIN objects o ON o.obj_id = a.obj_id LEFT JOIN users u ON u.id = a.auth_id WHERE o.obj_id IS NULL OR u.id IS NULL"];
    $c['authors_models'] = ['group' => 'orphans',
        'ids' => "SELECT CONCAT(a.mod_id, ':', a.auth_id) AS id FROM authors_models a LEFT JOIN models m ON m.mod_id = a.mod_id LEFT JOIN users u ON u.id = a.auth_id WHERE m.mod_id IS NULL OR u.id IS NULL",
        'fix' => "DELETE a FROM authors_models a LEFT JOIN models m ON m.mod_id = a.mod_id LEFT JOIN users u ON u.id = a.auth_id WHERE m.mod_id IS NULL OR u.id IS NULL"];
    $c['authors_flows'] = ['group' => 'orphans',
        'ids' => "SELECT CONCAT(a.flow_id, ':', a.auth_id) AS id FROM authors_flows a LEFT JOIN flows f ON f.flow_id = a.flow_id LEFT JOIN users u ON u.id = a.auth_id WHERE f.flow_id IS NULL OR u.id IS NULL",
        'fix' => "DELETE a FROM authors_flows a LEFT JOIN flows f ON f.flow_id = a.flow_id LEFT JOIN users u ON u.id = a.auth_id WHERE f.flow_id IS NULL OR u.id IS NULL"];

    // ── Orfani: permessi ───────────────────────────────────────────────────
    $c['perm_res'] = ['group' => 'orphans',
        'ids' => "SELECT CONCAT(p.res_id, ':', p.user_id) AS id FROM users_res_permissions p LEFT JOIN researches r ON r.res_id = p.res_id LEFT JOIN users u ON u.id = p.user_id WHERE r.res_id IS NULL OR u.id IS NULL",
        'fix' => "DELETE p FROM users_res_permissions p LEFT JOIN researches r ON r.res_id = p.res_id LEFT JOIN users u ON u.id = p.user_id WHERE r.res_id IS NULL OR u.id IS NULL"];
    $c['perm_wp'] = ['group' => 'orphans',
        'ids' => "SELECT CONCAT(p.wp_id, ':', p.user_id) AS id FROM users_wp_permissions p LEFT JOIN workpackages w ON w.wp_id = p.wp_id LEFT JOIN users u ON u.id = p.user_id WHERE w.wp_id IS NULL OR u.id IS NULL",
        'fix' => "DELETE p FROM users_wp_permissions p LEFT JOIN workpackages w ON w.wp_id = p.wp_id LEFT JOIN users u ON u.id = p.user_id WHERE w.wp_id IS NULL OR u.id IS NULL"];
    // ruolo in un WP senza ruolo nella ricerca del WP (tolto dalla ricerca prima del 2026-10-11)
    $c['perm_wp_no_res'] = ['group' => 'orphans',
        'ids' => "SELECT CONCAT(p.wp_id, ':', p.user_id) AS id FROM users_wp_permissions p JOIN workpackages w ON w.wp_id = p.wp_id LEFT JOIN users_res_permissions r ON r.res_id = w.res_id AND r.user_id = p.user_id WHERE r.user_id IS NULL",
        'fix' => "DELETE p FROM users_wp_permissions p JOIN workpackages w ON w.wp_id = p.wp_id LEFT JOIN users_res_permissions r ON r.res_id = w.res_id AND r.user_id = p.user_id WHERE r.user_id IS NULL"];
    $c['perm_res_res'] = ['group' => 'orphans',
        'ids' => "SELECT CONCAT(p.res_requester, ':', p.res_granter) AS id FROM res_res_permissions p LEFT JOIN researches a ON a.res_id = p.res_requester LEFT JOIN researches b ON b.res_id = p.res_granter WHERE a.res_id IS NULL OR b.res_id IS NULL",
        'fix' => "DELETE p FROM res_res_permissions p LEFT JOIN researches a ON a.res_id = p.res_requester LEFT JOIN researches b ON b.res_id = p.res_granter WHERE a.res_id IS NULL OR b.res_id IS NULL"];

    // ── Orfani: dati dei moduli e di sistema ───────────────────────────────
    $c['drawings_no_model'] = ['group' => 'orphans',
        'ids' => "SELECT d.dwg_id AS id FROM drawings_osd_pjs d LEFT JOIN models m ON m.mod_id = d.mod_id WHERE m.mod_id IS NULL",
        'fix' => "DELETE d FROM drawings_osd_pjs d LEFT JOIN models m ON m.mod_id = d.mod_id WHERE m.mod_id IS NULL"];
    $c['highlights_no_model'] = ['group' => 'orphans',
        'ids' => "SELECT h.hl_id AS id FROM pdf_highlights h LEFT JOIN models m ON m.mod_id = h.mod_id WHERE m.mod_id IS NULL",
        'fix' => "DELETE h FROM pdf_highlights h LEFT JOIN models m ON m.mod_id = h.mod_id WHERE m.mod_id IS NULL"];
    $c['events_no_wp'] = ['group' => 'orphans',
        'ids' => "SELECT e.id FROM events e LEFT JOIN workpackages w ON w.wp_id = e.wp_id WHERE w.wp_id IS NULL",
        'fix' => "DELETE e FROM events e LEFT JOIN workpackages w ON w.wp_id = e.wp_id WHERE w.wp_id IS NULL"];
    $c['tokens_no_user'] = ['group' => 'orphans',
        'ids' => "SELECT t.id FROM email_verification_tokens t LEFT JOIN users u ON u.id = t.user_id WHERE u.id IS NULL",
        'fix' => "DELETE t FROM email_verification_tokens t LEFT JOIN users u ON u.id = t.user_id WHERE u.id IS NULL"];
    $c['sessions_no_user'] = ['group' => 'orphans',
        // user_id 0 = ospite (non è in users, _doc/arch-sso-ospiti.md): non è un orfano
        'ids' => "SELECT s.session_id AS id FROM users_sessions s LEFT JOIN users u ON u.id = s.user_id WHERE u.id IS NULL AND s.user_id <> 0",
        'fix' => "DELETE s FROM users_sessions s LEFT JOIN users u ON u.id = s.user_id WHERE u.id IS NULL AND s.user_id <> 0"];

    // ── Solo segnalazione: entità principali senza contenitore ─────────────
    // help: query da usare a mano in phpMyAdmin (finestra di aiuto della modale): 'view' per
    // vedere le righe, 'fix' per correggerle. <ID>, <RES_ID>, <USER_ID> vanno sostituiti a mano.
    $c['wp_no_research'] = ['group' => 'report',
        'ids' => "SELECT w.wp_id AS id FROM workpackages w LEFT JOIN researches r ON r.res_id = w.res_id WHERE r.res_id IS NULL",
        'help' => [
            'view' => "SELECT w.wp_id, w.res_id, w.wp_title, w.wp_folder_id,\n  (SELECT COUNT(*) FROM objects o WHERE o.wp_id = w.wp_id) AS oggetti,\n  (SELECT COUNT(*) FROM models m WHERE m.wp_id = w.wp_id) AS modelli,\n  (SELECT COUNT(*) FROM flows f WHERE f.flow_wp = w.wp_id) AS flow\nFROM workpackages w LEFT JOIN researches r ON r.res_id = w.res_id\nWHERE r.res_id IS NULL;",
            'fix'  => "-- A) riassegnare il WP a una ricerca esistente\nUPDATE workpackages SET res_id = <RES_ID> WHERE wp_id = <ID>;\n\n-- B) eliminarlo (prima i suoi contenuti)\nDELETE FROM objects WHERE wp_id = <ID>;\nDELETE FROM models  WHERE wp_id = <ID>;\nDELETE FROM flows   WHERE flow_wp = <ID>;\nDELETE FROM workpackages WHERE wp_id = <ID>;",
        ]];
    $c['objects_no_wp'] = ['group' => 'report',
        'ids' => "SELECT o.obj_id AS id FROM objects o LEFT JOIN workpackages w ON w.wp_id = o.wp_id WHERE w.wp_id IS NULL",
        'help' => [
            'view' => "SELECT o.obj_id, o.wp_id, o.obj_name, o.obj_app\nFROM objects o LEFT JOIN workpackages w ON w.wp_id = o.wp_id\nWHERE w.wp_id IS NULL;",
            'fix'  => "-- tutti insieme\nDELETE o FROM objects o LEFT JOIN workpackages w ON w.wp_id = o.wp_id\nWHERE w.wp_id IS NULL;\n\n-- oppure uno alla volta\nDELETE FROM objects WHERE obj_id = <ID>;",
        ]];
    $c['models_no_wp'] = ['group' => 'report',
        'ids' => "SELECT m.mod_id AS id FROM models m LEFT JOIN workpackages w ON w.wp_id = m.wp_id WHERE w.wp_id IS NULL",
        'help' => [
            'view' => "SELECT m.mod_id, m.wp_id, m.mod_name, m.mod_folder_id, m.mod_filename\nFROM models m LEFT JOIN workpackages w ON w.wp_id = m.wp_id\nWHERE w.wp_id IS NULL;",
            'fix'  => "-- tutti insieme\nDELETE m FROM models m LEFT JOIN workpackages w ON w.wp_id = m.wp_id\nWHERE w.wp_id IS NULL;\n\n-- oppure spostarne uno in un WP esistente (i file restano nella cartella vecchia)\nUPDATE models SET wp_id = <WP_ID> WHERE mod_id = <ID>;",
        ]];
    $c['flows_no_wp'] = ['group' => 'report',
        'ids' => "SELECT f.flow_id AS id FROM flows f LEFT JOIN workpackages w ON w.wp_id = f.flow_wp WHERE w.wp_id IS NULL",
        'help' => [
            'view' => "SELECT f.flow_id, f.flow_wp, f.flow_type, f.flow_name, f.author_id\nFROM flows f LEFT JOIN workpackages w ON w.wp_id = f.flow_wp\nWHERE w.wp_id IS NULL;",
            'fix'  => "-- eliminare (validazioni e collegamenti si tolgono da soli: FOREIGN KEY)\nDELETE FROM flows WHERE flow_id = <ID>;\n\n-- oppure spostarlo in un WP esistente\nUPDATE flows SET flow_wp = <WP_ID> WHERE flow_id = <ID>;",
        ]];
    $c['folders_unused'] = ['group' => 'report',
        // cartelle di primo e secondo livello che nessuna ricerca o WP usa (le sottocartelle dei WP sono normali)
        'ids' => "SELECT f.folder_id AS id FROM folders f
                  LEFT JOIN folders p ON p.folder_id = f.folder_parent_id
                  WHERE (f.folder_parent_id IS NULL AND NOT EXISTS (SELECT 1 FROM researches r WHERE r.res_folder_id = f.folder_id))
                     OR (p.folder_parent_id IS NULL AND f.folder_parent_id IS NOT NULL
                         AND NOT EXISTS (SELECT 1 FROM workpackages w WHERE w.wp_folder_id = f.folder_id))",
        'help' => [
            'view' => "-- la cartella, la sua cartella madre e le sue sottocartelle\nSELECT f.folder_id, f.folder_name, f.folder_parent_id, p.folder_name AS cartella_madre\nFROM folders f LEFT JOIN folders p ON p.folder_id = f.folder_parent_id\nWHERE f.folder_id = <ID> OR f.folder_parent_id = <ID>;",
            'fix'  => "-- prima le sottocartelle (se ce ne sono), poi la cartella\nDELETE FROM folders WHERE folder_parent_id = <ID>;\nDELETE FROM folders WHERE folder_id = <ID>;",
        ]];
    $c['objects_no_author'] = ['group' => 'report',
        'ids' => "SELECT o.obj_id AS id FROM objects o WHERE NOT EXISTS (SELECT 1 FROM authors_objects a WHERE a.obj_id = o.obj_id AND a.auth_role = 'A')",
        'help' => [
            'view' => "SELECT o.obj_id, o.wp_id, o.obj_name\nFROM objects o\nWHERE NOT EXISTS (SELECT 1 FROM authors_objects a WHERE a.obj_id = o.obj_id AND a.auth_role = 'A');",
            'fix'  => "-- un autore per un oggetto (USER_ID: users.id, per esempio l'amministratore)\nINSERT IGNORE INTO authors_objects (obj_id, auth_id, auth_role, auth_ord)\nVALUES (<ID>, <USER_ID>, 'A', 1);",
        ]];
    $c['models_no_author'] = ['group' => 'report',
        'ids' => "SELECT m.mod_id AS id FROM models m WHERE NOT EXISTS (SELECT 1 FROM authors_models a WHERE a.mod_id = m.mod_id AND a.auth_role = 'A')",
        'help' => [
            'view' => "SELECT m.mod_id, m.wp_id, m.mod_name\nFROM models m\nWHERE NOT EXISTS (SELECT 1 FROM authors_models a WHERE a.mod_id = m.mod_id AND a.auth_role = 'A');",
            'fix'  => "-- un autore per un modello (USER_ID: users.id, per esempio l'amministratore)\nINSERT IGNORE INTO authors_models (mod_id, auth_id, auth_role, auth_ord)\nVALUES (<ID>, <USER_ID>, 'A', 1);",
        ]];

    // ── Pulizia periodica (soglie in cfg/cfg_maintenance.php) ──────────────
    if (($n = $days('email_tokens_days')) > 0) $c['old_tokens'] = ['group' => 'periodic', 'param' => $n,
        'ids' => "SELECT id FROM email_verification_tokens WHERE (used_at IS NOT NULL AND used_at < NOW() - INTERVAL $n DAY) OR expires_at < NOW() - INTERVAL $n DAY",
        'fix' => "DELETE FROM email_verification_tokens WHERE (used_at IS NOT NULL AND used_at < NOW() - INTERVAL $n DAY) OR expires_at < NOW() - INTERVAL $n DAY"];
    if (($n = $days('sessions_days')) > 0) $c['old_sessions'] = ['group' => 'periodic', 'param' => $n,
        'ids' => "SELECT session_id AS id FROM users_sessions WHERE last_activity < NOW() - INTERVAL $n DAY",
        'fix' => "DELETE FROM users_sessions WHERE last_activity < NOW() - INTERVAL $n DAY"];
    if (($n = $days('csp_reports_days')) > 0) $c['old_csp'] = ['group' => 'periodic', 'param' => $n,
        'ids' => "SELECT csp_id AS id FROM csp_reports WHERE last_seen < NOW() - INTERVAL $n DAY",
        'fix' => "DELETE FROM csp_reports WHERE last_seen < NOW() - INTERVAL $n DAY"];
    if (($n = $days('deleted_drawings_days')) > 0) $c['old_deleted_drawings'] = ['group' => 'periodic', 'param' => $n,
        'ids' => "SELECT dwg_id AS id FROM drawings_osd_pjs WHERE dwg_delete = 1 AND dwg_time_last < NOW() - INTERVAL $n DAY",
        'fix' => "DELETE FROM drawings_osd_pjs WHERE dwg_delete = 1 AND dwg_time_last < NOW() - INTERVAL $n DAY"];
    if (($n = $days('activity_log_days')) > 0) $c['old_activity_log'] = ['group' => 'periodic', 'param' => $n,
        'ids' => "SELECT id FROM activity_log WHERE created_at < NOW() - INTERVAL $n DAY",
        'fix' => "DELETE FROM activity_log WHERE created_at < NOW() - INTERVAL $n DAY"];
    if (($n = $days('events_days')) > 0) $c['old_events'] = ['group' => 'periodic', 'param' => $n,
        'ids' => "SELECT id FROM events WHERE created_at < NOW() - INTERVAL $n DAY",
        'fix' => "DELETE FROM events WHERE created_at < NOW() - INTERVAL $n DAY"];
    if (($n = $days('a11y_feedback_days')) > 0) $c['old_a11y_feedback'] = ['group' => 'periodic', 'param' => $n,
        'ids' => "SELECT fb_id AS id FROM a11y_feedback WHERE fb_status = 'done' AND fb_created_at < NOW() - INTERVAL $n DAY",
        'fix' => "DELETE FROM a11y_feedback WHERE fb_status = 'done' AND fb_created_at < NOW() - INTERVAL $n DAY"];
    if (($n = $days('guest_log_days')) > 0) $c['old_guest_log'] = ['group' => 'periodic', 'param' => $n,
        'ids' => "SELECT ga_id AS id FROM guest_access_log WHERE created_at < NOW() - INTERVAL $n DAY",
        'fix' => "DELETE FROM guest_access_log WHERE created_at < NOW() - INTERVAL $n DAY"];

    return $c;
}

$checks = dm_checks($days);

/** Conta le righe di un controllo e ne restituisce fino a 10 id d'esempio. */
function dm_count(PDO $pdo, array $chk): array {
    $n = (int)$pdo->query("SELECT COUNT(*) FROM (" . $chk['ids'] . ") t")->fetchColumn();
    $sample = $n ? $pdo->query("SELECT id FROM (" . $chk['ids'] . ") t LIMIT 10")->fetchAll(PDO::FETCH_COLUMN) : [];
    return ['count' => $n, 'sample' => array_map('strval', $sample)];
}

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET' && ($_GET['action'] ?? '') === 'analyze') {
        $out = [];
        foreach ($checks as $key => $chk) {
            try {
                $r = dm_count($pdo, $chk);
            } catch (PDOException $e) {
                // tabella assente in questa installazione (es. modulo mai migrato): si segnala e si va avanti
                $r = ['count' => null, 'sample' => [], 'error' => $e->getMessage()];
            }
            $out[] = ['key' => $key, 'group' => $chk['group'], 'param' => $chk['param'] ?? null,
                      'fixable' => isset($chk['fix']), 'help' => $chk['help'] ?? null] + $r;
        }
        dm_out(['ok' => true, 'data' => $out]);
    }

    if ($method === 'POST') {
        $in = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($in) || ($in['action'] ?? '') !== 'clean' || !is_array($in['keys'] ?? null)) {
            dm_err(t('errors.invalid_request'));
        }
        $keys = array_values(array_intersect(array_keys($checks), array_map('strval', $in['keys'])));   // ordine dei controlli
        $done = [];
        $pdo->beginTransaction();
        try {
            foreach ($keys as $key) {
                if (!isset($checks[$key]['fix'])) continue;
                $done[$key] = $pdo->exec($checks[$key]['fix']);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        log_activity('db:maintenance', 'database', null, '', ['cleaned' => $done]);
        dm_out(['ok' => true, 'data' => $done]);
    }

    dm_err(t('errors.invalid_request'));
} catch (Throwable $e) {
    error_log('db_maintenance: ' . $e->getMessage());
    dm_err(t('errors.server_status', ['status' => 500]) . ' ' . $e->getMessage(), 500);
}
