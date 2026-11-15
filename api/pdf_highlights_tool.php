<?php
// api/pdf_highlights_tool.php
// CRUD per pdf_highlights + lettura pdf_highlights_type.
//
// GET  ?action=types                           → tutti i tipi (hlt_*)
// GET  ?action=context                         → { user_id, can_edit_all }
// GET  ?action=load&mod_id=N                  → highlights del modello (join type + autore)
// GET  ?action=search&mod_id=N&q=testo        → fulltext search nel modello
// POST { action:'save',   mod_id, hlt_id, hl_* } → inserisce annotazione
// POST { action:'update', hl_id, mod_id, hlt_id, hl_label, hl_note, hl_tags } → aggiorna
// POST { action:'delete', hl_id, mod_id }        → cancella annotazione
//
// Sicurezza: autenticazione sessione + wp_id check tramite models.
// Scrittura/cancellazione: chi modifica il modello (api/edit_rights.php).

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) session_start();

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/log_tool.php';
require_once __DIR__ . '/edit_rights.php';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hl_ok(mixed $data = null): never {
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

function hl_err(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function hl_body(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

// ── Auth ──────────────────────────────────────────────────────────────────────

$user = $_SESSION['user'] ?? null;
if (!ra_session_user_ok($user)) hl_err('Non autenticato.', 401);
if (ra_is_guest($user) && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') hl_err('Gli ospiti possono solo consultare.', 403);
$userId = (int)$user['id'];

$workpackage = $_SESSION['workpackage'] ?? null;
if (!is_array($workpackage)) hl_err('Contesto workpackage mancante.', 500);
$wp_id = (int)($workpackage['wp_id'] ?? 0);
if ($wp_id <= 0) hl_err('wp_id non disponibile.', 500);

// FIX (2026-09-16): stesso bug di ui/modal_sub_folders_tools.php — la sessione
// porta il permesso nella chiave 'perm', non 'res_perm'/'wp_perm'. Senza
// fallback, isPI/isWPL erano sempre false: solo l'amministratore poteva
// creare/modificare/cancellare annotazioni PDF. Vedi lì per i dettagli.
$research  = $_SESSION['research'] ?? [];
$isAdmin   = ($user['user_type'] ?? '') === 'X';
$isPI      = ($research['res_perm'] ?? $research['perm'] ?? '') === 'P';
$res_id    = (int)($research['res_id'] ?? 0);
// Scrittura (2026-10-10, passo 4 di _doc/arch-permessi.md §11.9): chi modifica il
// modello PDF — X, P della ricerca, W del WP, autori e collaboratori (api/edit_rights.php).
// Le annotazioni degli altri restano modificabili solo da X e P (can_edit_all).

if (!isset($pdo) || !($pdo instanceof PDO)) hl_err('DB non disponibile.', 500);

// ── Helper: verifica che mod_id appartenga al wp corrente ────────────────────

function hl_check_mod(PDO $pdo, int $mod_id, int $wp_id): bool {
    $st = $pdo->prepare("SELECT 1 FROM models WHERE mod_id = ? AND wp_id = ? LIMIT 1");
    $st->execute([$mod_id, $wp_id]);
    return (bool)$st->fetchColumn();
}

// ── Router ────────────────────────────────────────────────────────────────────

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {

    // ── GET ───────────────────────────────────────────────────────────────────

    if ($method === 'GET') {
        $action = $_GET['action'] ?? '';

        // ── types: tutti i tipi (ordinati) ──────────────────────────────────
        if ($action === 'types') {
            $st = $pdo->query("SELECT * FROM pdf_highlights_type ORDER BY hlt_order, hlt_id");
            hl_ok($st->fetchAll(PDO::FETCH_ASSOC));
        }

        // ── context: info utente corrente ────────────────────────────────────
        if ($action === 'context') {
            hl_ok([
                'user_id'      => $userId,
                'can_edit_all' => $isAdmin || $isPI,
            ]);
        }

        // ── load: highlights del modello ─────────────────────────────────────
        if ($action === 'load') {
            $mod_id = filter_input(INPUT_GET, 'mod_id', FILTER_VALIDATE_INT);
            if (!$mod_id || $mod_id <= 0) hl_err('mod_id non valido.', 400);
            if (!hl_check_mod($pdo, $mod_id, $wp_id)) hl_err('Modello non trovato.', 404);

            $st = $pdo->prepare("
                SELECT h.*,
                       t.hlt_title, t.hlt_color, t.hlt_is_view,
                       COALESCE(NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),''), u.user_name, '?')
                           AS hl_author
                FROM   pdf_highlights h
                JOIN   pdf_highlights_type t ON t.hlt_id  = h.hlt_id
                LEFT JOIN users            u ON u.id      = h.hl_user_id
                WHERE  h.mod_id = ?
                ORDER  BY h.hl_page, h.hl_created_at
            ");
            $st->execute([$mod_id]);
            $rows = $st->fetchAll(PDO::FETCH_ASSOC);

            // Decodifica JSON fields
            foreach ($rows as &$row) {
                if (isset($row['hl_rects']) && is_string($row['hl_rects'])) {
                    $row['hl_rects'] = json_decode($row['hl_rects'], true);
                }
                // Converti tipi numerici
                foreach (['hl_id','mod_id','hlt_id','hl_page','hl_rotation','hl_spread','hl_user_id',
                          'hlt_is_view'] as $k) {
                    if (isset($row[$k])) $row[$k] = (int)$row[$k];
                }
                foreach (['hl_scale','hl_scroll_top','hl_scroll_left',
                          'hl_marker_x','hl_marker_y'] as $k) {
                    if (isset($row[$k])) $row[$k] = $row[$k] !== null ? (float)$row[$k] : null;
                }
            }
            unset($row);
            hl_ok($rows);
        }

        // ── search: fulltext nel modello ─────────────────────────────────────
        if ($action === 'search') {
            $mod_id = filter_input(INPUT_GET, 'mod_id', FILTER_VALIDATE_INT);
            $q      = trim((string)($_GET['q'] ?? ''));
            if (!$mod_id || $mod_id <= 0) hl_err('mod_id non valido.', 400);
            if ($q === '') hl_err('Parametro q mancante.', 400);
            if (!hl_check_mod($pdo, $mod_id, $wp_id)) hl_err('Modello non trovato.', 404);

            $st = $pdo->prepare("
                SELECT h.*, t.hlt_title, t.hlt_color, t.hlt_is_view,
                       MATCH(h.hl_text, h.hl_label, h.hl_note, h.hl_tags) AGAINST (? IN BOOLEAN MODE) AS score
                FROM   pdf_highlights h
                JOIN   pdf_highlights_type t ON t.hlt_id = h.hlt_id
                WHERE  h.mod_id = ?
                  AND  MATCH(h.hl_text, h.hl_label, h.hl_note, h.hl_tags) AGAINST (? IN BOOLEAN MODE)
                ORDER  BY score DESC, h.hl_page
                LIMIT  50
            ");
            $st->execute([$q, $mod_id, $q]);
            $rows = $st->fetchAll(PDO::FETCH_ASSOC);
            foreach ($rows as &$row) {
                if (isset($row['hl_rects']) && is_string($row['hl_rects'])) {
                    $row['hl_rects'] = json_decode($row['hl_rects'], true);
                }
            }
            unset($row);
            hl_ok($rows);
        }

        hl_err('Azione GET non riconosciuta.', 400);
    }

    // ── POST ──────────────────────────────────────────────────────────────────

    if ($method === 'POST') {
        $body   = hl_body();
        $action = (string)($body['action'] ?? '');
        if (!ra_scope_can_edit(ra_edit_scope($pdo, $user), 'model', (int)($body['mod_id'] ?? 0), $wp_id, $res_id)) {
            hl_err('Permesso negato.', 403);
        }

        // ── save: inserisce nuova annotazione ────────────────────────────────
        if ($action === 'save') {
            $mod_id = (int)($body['mod_id'] ?? 0);
            $hlt_id = (int)($body['hlt_id'] ?? 0);
            if ($mod_id <= 0) hl_err('mod_id mancante.', 400);
            if ($hlt_id <= 0) hl_err('hlt_id mancante.', 400);
            if (!hl_check_mod($pdo, $mod_id, $wp_id)) hl_err('Modello non trovato.', 404);

            // Verifica tipo esistente
            $st = $pdo->prepare("SELECT 1 FROM pdf_highlights_type WHERE hlt_id = ? LIMIT 1");
            $st->execute([$hlt_id]);
            if (!$st->fetchColumn()) hl_err('hlt_id non valido.', 400);

            $rects = isset($body['hl_rects']) ? json_encode($body['hl_rects']) : null;

            $st = $pdo->prepare("
                INSERT INTO pdf_highlights
                    (mod_id, hlt_id, hl_text, hl_label, hl_note, hl_tags,
                     hl_page, hl_scale, hl_rotation, hl_spread,
                     hl_scroll_top, hl_scroll_left,
                     hl_rects, hl_marker_x, hl_marker_y, hl_user_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS JSON),?,?,?)
            ");
            $st->execute([
                $mod_id,
                $hlt_id,
                $body['hl_text']        ?? null,
                $body['hl_label']       ?? null,
                $body['hl_note']        ?? null,
                $body['hl_tags']        ?? null,
                (int)($body['hl_page']        ?? 1),
                (float)($body['hl_scale']     ?? 1.0),
                (int)($body['hl_rotation']    ?? 0),
                (int)($body['hl_spread']      ?? 0),
                (float)($body['hl_scroll_top']  ?? 0),
                (float)($body['hl_scroll_left'] ?? 0),
                $rects,
                isset($body['hl_marker_x']) ? (float)$body['hl_marker_x'] : null,
                isset($body['hl_marker_y']) ? (float)$body['hl_marker_y'] : null,
                $userId,
            ]);

            $newId = (int)$pdo->lastInsertId();
            log_activity('pdf_highlight:save', 'model', $mod_id, '', ['hl_id' => $newId]);

            // Ritorna il record completo con join tipo + autore
            $st = $pdo->prepare("
                SELECT h.*,
                       t.hlt_title, t.hlt_color, t.hlt_is_view,
                       COALESCE(NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),''), u.user_name, '?')
                           AS hl_author
                FROM   pdf_highlights h
                JOIN   pdf_highlights_type t ON t.hlt_id = h.hlt_id
                LEFT JOIN users            u ON u.id     = h.hl_user_id
                WHERE  h.hl_id = ?
            ");
            $st->execute([$newId]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if ($row && is_string($row['hl_rects'])) {
                $row['hl_rects'] = json_decode($row['hl_rects'], true);
            }
            hl_ok($row ?: ['hl_id' => $newId]);
        }

        // ── update: modifica etichetta / nota / tipo ─────────────────────────
        if ($action === 'update') {
            $hl_id  = (int)($body['hl_id']  ?? 0);
            $mod_id = (int)($body['mod_id'] ?? 0);
            $hlt_id = isset($body['hlt_id']) ? (int)$body['hlt_id'] : null;
            if ($hl_id <= 0 || $mod_id <= 0) hl_err('hl_id / mod_id mancante.', 400);
            if (!hl_check_mod($pdo, $mod_id, $wp_id)) hl_err('Modello non trovato.', 404);

            // Solo autore o admin/PI
            $st = $pdo->prepare("SELECT hl_user_id FROM pdf_highlights WHERE hl_id = ? AND mod_id = ?");
            $st->execute([$hl_id, $mod_id]);
            $rec = $st->fetch(PDO::FETCH_ASSOC);
            if (!$rec) hl_err('Annotazione non trovata.', 404);
            if (!$isAdmin && !$isPI && (int)$rec['hl_user_id'] !== $userId)
                hl_err('Permesso negato.', 403);

            $st = $pdo->prepare("
                UPDATE pdf_highlights
                SET    hlt_id    = COALESCE(?, hlt_id),
                       hl_label  = ?,
                       hl_note   = ?,
                       hl_tags   = ?
                WHERE  hl_id = ? AND mod_id = ?
            ");
            $st->execute([
                $hlt_id,
                $body['hl_label'] ?? null,
                $body['hl_note']  ?? null,
                $body['hl_tags']  ?? null,
                $hl_id, $mod_id,
            ]);
            log_activity('pdf_highlight:update', 'model', $mod_id, '', ['hl_id' => $hl_id]);

            // Ritorna record aggiornato con join tipo + autore
            $st = $pdo->prepare("
                SELECT h.*,
                       t.hlt_title, t.hlt_color, t.hlt_is_view,
                       COALESCE(NULLIF(TRIM(CONCAT(u.first_name,' ',u.last_name)),''), u.user_name, '?')
                           AS hl_author
                FROM   pdf_highlights h
                JOIN   pdf_highlights_type t ON t.hlt_id = h.hlt_id
                LEFT JOIN users            u ON u.id     = h.hl_user_id
                WHERE  h.hl_id = ?
            ");
            $st->execute([$hl_id]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if ($row && is_string($row['hl_rects'])) {
                $row['hl_rects'] = json_decode($row['hl_rects'], true);
            }
            hl_ok($row ?: ['hl_id' => $hl_id]);
        }

        // ── delete: cancella annotazione ─────────────────────────────────────
        if ($action === 'delete') {
            $hl_id  = (int)($body['hl_id']  ?? 0);
            $mod_id = (int)($body['mod_id'] ?? 0);
            if ($hl_id <= 0 || $mod_id <= 0) hl_err('hl_id / mod_id mancante.', 400);
            if (!hl_check_mod($pdo, $mod_id, $wp_id)) hl_err('Modello non trovato.', 404);

            // Ammesso: admin o proprietario del record
            $st = $pdo->prepare("SELECT hl_user_id FROM pdf_highlights WHERE hl_id = ? AND mod_id = ?");
            $st->execute([$hl_id, $mod_id]);
            $rec = $st->fetch(PDO::FETCH_ASSOC);
            if (!$rec) hl_err('Annotazione non trovata.', 404);
            if (!$isAdmin && !$isPI && (int)$rec['hl_user_id'] !== $userId) hl_err('Permesso negato.', 403);

            $st = $pdo->prepare("DELETE FROM pdf_highlights WHERE hl_id = ? AND mod_id = ?");
            $st->execute([$hl_id, $mod_id]);
            log_activity('pdf_highlight:delete', 'model', $mod_id, '', ['hl_id' => $hl_id]);
            hl_ok(['deleted' => $hl_id]);
        }

        hl_err('Azione POST non riconosciuta.', 400);
    }

    hl_err('Metodo HTTP non supportato.', 405);

} catch (Throwable $e) {
    hl_err('Errore server: ' . $e->getMessage(), 500);
}
