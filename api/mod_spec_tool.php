<?php
// api/mod_spec_tool.php
// Lettura e scrittura dedicata del campo mod_spec (JSON) della tabella models.
// Usato da moduli che salvano il proprio stato strutturato in mod_spec
// (es. TJS camera/luci/ambiente/punti, ECH, PDF viste, DBJ).
//
// Actions:
//   GET  ?action=load&mod_id=N  → ritorna mod_spec del modello
//   POST { action:"save", mod_id:N, mod_spec:{...} } → aggiorna mod_spec
//
// Sicurezza: verifica che il mod_id appartenga al wp_id di sessione.
// Scrittura: richiede perm W (WPL), P (PI) o X (admin).

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

require_once __DIR__ . '/db.php'; // fornisce $pdo
require_once __DIR__ . '/log_tool.php';
require_once __DIR__ . '/edit_rights.php';

// --- Helpers ----------------------------------------------------------------

function mst_ok(mixed $data = null): never {
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

function mst_err(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function mst_read_body(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

// FIX (2026-09-17): stesso controllo, stessa motivazione, di
// ui/modal_models_tools.php::mod_spec_inject_needs_admin() — la modalità
// "inject" di model_HTM.mjs esegue markup/script senza sandbox, e va
// riservata all'amministratore. Duplicato qui perché questo file è un
// secondo, indipendente punto di scrittura di mod_spec. Include anche
// mode:"flow" con srcdoc non vuoto (nodi HTM/DOM/*, vedi la stessa funzione
// in ui/modal_models_tools.php per i dettagli) — un "flow" senza srcdoc
// (interfaccia costruita solo dai nodi) resta libero per P/WPL.
function mst_inject_needs_admin(array $spec): bool {
    $mode      = $spec['mode'] ?? null;
    $srcdoc    = $spec['srcdoc'] ?? null;
    $hasSrcdoc = is_string($srcdoc) && trim($srcdoc) !== '';
    if ($mode === 'inject') return true;
    if ($mode === null && $hasSrcdoc) return true;
    if ($mode === 'flow' && $hasSrcdoc) return true;
    return false;
}

// --- Auth -------------------------------------------------------------------

$user = $_SESSION['user'] ?? null;
if (!ra_session_user_ok($user)) {
    mst_err('Non autenticato.', 401);
}
if (ra_is_guest($user) && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') mst_err('Gli ospiti possono solo consultare.', 403);
$userId = (int)$user['id'];

// --- Contesto sessione -------------------------------------------------------

$workpackage = $_SESSION['workpackage'] ?? null;
if (!is_array($workpackage)) {
    mst_err('Contesto workpackage non disponibile in sessione.', 500);
}
$wp_id = (int)($workpackage['wp_id'] ?? 0);
if ($wp_id <= 0) mst_err('wp_id non disponibile in sessione.', 500);

// --- Permessi ----------------------------------------------------------------
// Lettura: chiunque ha accesso al WP (controllo solo wp_id in WHERE).
// Scrittura (2026-10-10, passo 4 di _doc/arch-permessi.md §11.9): chi modifica
// QUEL modello — X, P della ricerca, W del WP, autori e collaboratori (api/edit_rights.php).
$research = $_SESSION['research'] ?? [];
$isAdmin  = isset($user['user_type']) && $user['user_type'] === 'X';
$res_id   = (int)($research['res_id'] ?? 0);

// --- DB check ---------------------------------------------------------------

if (!isset($pdo) || !($pdo instanceof PDO)) {
    mst_err('Connessione DB non disponibile.', 500);
}

// --- Router -----------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {

    // ---- GET ?action=load&mod_id=N ----------------------------------------
    if ($method === 'GET') {
        $action = $_GET['action'] ?? '';
        if ($action !== 'load') mst_err('Azione GET non riconosciuta. Usare: load', 400);

        $mod_id = filter_input(INPUT_GET, 'mod_id', FILTER_VALIDATE_INT);
        if (!$mod_id || $mod_id <= 0) mst_err('mod_id mancante o non valido.', 400);

        // (2026-10-04) Rimossa la colonna models.mod_fle: i flow stanno nella
        // tabella flows (api/flows_tool.php), vedi sql/Eseguiti/migration_flows.sql.
        $st = $pdo->prepare("
            SELECT mod_id, mod_spec
            FROM models
            WHERE mod_id = ? AND wp_id = ?
            LIMIT 1
        ");
        $st->execute([$mod_id, $wp_id]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row) mst_err('Modello non trovato.', 404);

        // mod_spec è JSON: PDO lo torna come stringa, decodifichiamo.
        $spec = $row['mod_spec'];
        if (is_string($spec) && $spec !== '') {
            $spec = json_decode($spec, true) ?? null;
        }

        mst_ok(['mod_id' => (int)$row['mod_id'], 'mod_spec' => $spec]);
    }

    // ---- POST { action:"save", mod_id:N, mod_spec:{...} } -----------------
    if ($method === 'POST') {
        $body   = mst_read_body();
        $action = (string)($body['action'] ?? '');

        if ($action !== 'save') mst_err('Azione POST non riconosciuta. Usare: save', 400);

        // mod_id
        $mod_id = isset($body['mod_id']) && is_numeric($body['mod_id'])
            ? (int)$body['mod_id']
            : 0;
        if ($mod_id <= 0) mst_err('mod_id mancante o non valido.', 400);
        if (!ra_scope_can_edit(ra_edit_scope($pdo, $user), 'model', $mod_id, $wp_id, $res_id)) {
            mst_err('Permesso negato: modificano il modello X, P, W e i suoi autori.', 403);
        }

        if (!array_key_exists('mod_spec', $body)) mst_err('mod_spec mancante nel body.', 400);

        $spec = $body['mod_spec'];
        if (!is_array($spec) && $spec !== null) {
            mst_err('mod_spec deve essere un oggetto JSON o null.', 400);
        }
        if (is_array($spec) && mst_inject_needs_admin($spec) && !$isAdmin) {
            mst_err('La modalità "inject" (HTML con script eseguiti senza sandbox) è riservata all\'amministratore.', 403);
        }

        // Verifica appartenenza al WP corrente
        $st = $pdo->prepare("SELECT mod_id FROM models WHERE mod_id = ? AND wp_id = ? LIMIT 1");
        $st->execute([$mod_id, $wp_id]);
        if (!$st->fetch()) mst_err('Modello non trovato o non appartenente al WP corrente.', 404);

        $st = $pdo->prepare("UPDATE models SET mod_spec = CAST(? AS JSON) WHERE mod_id = ? AND wp_id = ?");
        $st->execute([
            ($spec !== null) ? json_encode($spec, JSON_UNESCAPED_UNICODE) : 'null',
            $mod_id,
            $wp_id,
        ]);

        log_activity('model:edit', 'model', $mod_id, '', ['mod_spec_saved' => true]);
        mst_ok(['mod_id' => $mod_id, 'saved_at' => date('Y-m-d H:i:s')]);
    }

    mst_err('Metodo HTTP non supportato.', 405);

} catch (Throwable $e) {
    http_response_code(500);
    mst_err('Errore server.', 500);
}
