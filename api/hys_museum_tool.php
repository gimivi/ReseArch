<?php
// api/hys_museum_tool.php — ricerca delle esercitazioni e musei generati di HySpace
// (erede di WT3DNode_Search.aspx, _doc/Old_HS/HTML; nodo HTM/HYS/Ricerca Musei).
//
// GET  ?action=search&fields=chiavi,titolo&q=sedia&page=1&size=20
//        → { ok, data: { total, page, size, items: [{ id_ese, title, author, abstract, cover_url }] } }
//        Ogni parola di q deve comparire (AND) in almeno uno dei campi scelti (OR).
//        Campi: chiavi, abstract, descrizione, titolo, cognome. Solo flag_show = 1.
// POST { action:"generate", fields, q, name?, vertical?: "student"|"none" }
//        → museo nuovo dai risultati: { ok, data: { mus_id, created_at, start_id_ese, n_nodes, name } }
// GET  ?action=list                       → i miei musei (dal più recente)
// GET  ?action=info&mus_id=M              → { mus_id, name, created_at, start_id_ese, n_nodes, vertical, query }
// POST { action:"rename", mus_id, name }  → proprietario o amministratore ("" = torna temporaneo)
// POST { action:"delete", mus_id }        → proprietario o amministratore
//
// Il grafo (corretto rispetto a "Build"): risultati in ordine di id_ese; ognuno riempie
// le sue porte libere F, L, B, R con i risultati successivi non ancora usati, e il
// collegamento di ritorno è sempre reciproco (F↔B, L↔R). È un albero in ampiezza:
// ogni stanza è raggiungibile e l'ultimo risultato non viene più escluso.
// Musei senza nome = temporanei: cancellati dopo 7 giorni (alla generazione successiva).
// Query sempre parametrizzate (la pagina .NET concatenava il testo nell'SQL).

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
if (session_status() === PHP_SESSION_NONE) session_start();

function hm_out(array $a, int $code = 200): never {
  http_response_code($code);
  echo json_encode($a, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function hm_err(string $msg, int $code = 400): never { hm_out(['ok' => false, 'error' => $msg], $code); }

$user = $_SESSION['user'] ?? null;
require_once __DIR__ . '/visibility.php';   // ra_session_user_ok, ra_is_guest (ospiti, id 0)
if (!ra_session_user_ok($user)) hm_err('Sessione non valida.', 401);
if (ra_is_guest($user) && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') hm_err('Gli ospiti possono solo consultare.', 403);
$userId  = (int)$user['id'];
$isAdmin = ($user['user_type'] ?? '') === 'X';

// Musei (generare, elencare i propri, rinominare, eliminare): dal livello 20, come nell'interfaccia
// (_doc/arch-i18n-a11y.md §5). La ricerca e la consultazione di un museo restano a tutti.
require_once __DIR__ . '/ui_level.php';
$canMuseums = ra_ui_level($user, $_SESSION['research'] ?? null, $_SESSION['workpackage'] ?? null) >= RA_LEVEL_USER;

require_once __DIR__ . '/hys_common.php';

const HM_FIELDS = [
  'chiavi'      => 'e.chiavi_esercitazione',
  'abstract'    => 'e.abstract_esercitazione',
  'descrizione' => 'e.descrizione_esercitazione',
  'titolo'      => 'e.titolo_esercitazione',
  'cognome'     => 'a.cognome',
];
const HM_MAX_ROOMS = 500;       // un museo generato non supera queste stanze
const HM_TEMP_DAYS = 7;

/** WHERE parametrizzato: ogni parola (AND) in almeno uno dei campi (OR). */
function hm_where(array $fields, string $q): array {
  $cols = [];
  foreach ($fields as $f) if (isset(HM_FIELDS[$f])) $cols[] = HM_FIELDS[$f];
  if (!$cols) $cols = [HM_FIELDS['chiavi']];
  $words = array_values(array_filter(preg_split('/\s+/u', trim($q)) ?: [], fn($w) => $w !== ''));
  $sql = ['flag_show = 1'];
  $par = [];
  foreach (array_slice($words, 0, 8) as $w) {
    $like = '%' . addcslashes($w, '%_\\') . '%';
    $sql[] = '(' . implode(' OR ', array_map(fn($c) => "$c LIKE ?", $cols)) . ')';
    foreach ($cols as $_) $par[] = $like;
  }
  return [implode(' AND ', $sql), $par, count($words)];
}

function hm_fields_param(mixed $v): array {
  $list = is_array($v) ? $v : explode(',', (string)$v);
  return array_values(array_intersect(array_map('trim', $list), array_keys(HM_FIELDS)));
}

function hm_museum(PDO $pdo, int $musId): array {
  $st = $pdo->prepare('SELECT * FROM WT3DMuseum WHERE mus_id = ? LIMIT 1');
  $st->execute([$musId]);
  $m = $st->fetch();
  if (!$m) hm_err('Museo non trovato (forse era temporaneo ed è scaduto).', 404);
  return $m;
}

function hm_shape_museum(array $m): array {
  return [
    'mus_id'       => (int)$m['mus_id'],
    'name'         => $m['mus_name'],
    'created_at'   => $m['created_at'],
    'start_id_ese' => (int)$m['start_id_ese'],
    'n_nodes'      => (int)$m['n_nodes'],
    'vertical'     => $m['mus_vertical'],
    'query'        => is_string($m['mus_query']) ? json_decode($m['mus_query'], true) : $m['mus_query'],
    'mine'         => null,
  ];
}

/** Grafo del museo: albero in ampiezza con collegamenti reciproci. */
function hm_build_graph(array $ids): array {
  $dirs = ['F', 'L', 'B', 'R'];
  $opp  = ['F' => 'B', 'B' => 'F', 'L' => 'R', 'R' => 'L'];
  $g = [];
  foreach ($ids as $id) $g[$id] = ['F' => null, 'L' => null, 'B' => null, 'R' => null];
  $next = 1;
  $n = count($ids);
  for ($r = 0; $r < $n && $next < $n; $r++) {
    foreach ($dirs as $d) {
      if ($next >= $n) break;
      if ($g[$ids[$r]][$d] !== null) continue;
      $child = $ids[$next++];
      $g[$ids[$r]][$d] = $child;
      $g[$child][$opp[$d]] = $ids[$r];
    }
  }
  return $g;
}

try {
  $pdo = hys_pdo();
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

  if ($method === 'GET') {
    $action = (string)($_GET['action'] ?? '');

    if ($action === 'search') {
      $fields = hm_fields_param($_GET['fields'] ?? 'chiavi');
      [$where, $par, $nWords] = hm_where($fields, (string)($_GET['q'] ?? ''));
      if ($nWords === 0) hm_err('Scrivi almeno una parola da cercare.');
      $size = max(1, min(50, (int)($_GET['size'] ?? 20)));
      $page = max(1, (int)($_GET['page'] ?? 1));
      $from = 'FROM Allievi a INNER JOIN Esercitazione e ON a.idu = e.idu WHERE ' . $where;

      $st = $pdo->prepare("SELECT COUNT(*) $from");
      $st->execute($par);
      $total = (int)$st->fetchColumn();

      $st = $pdo->prepare("
        SELECT e.id_ese, e.titolo_esercitazione, e.abstract_esercitazione, e.immagine, e.ese_folder,
               a.nome, a.cognome, a.year_folder, a.main_folder
        $from ORDER BY e.id_ese LIMIT ? OFFSET ?");
      foreach ($par as $i => $v) $st->bindValue($i + 1, $v);
      $st->bindValue(count($par) + 1, $size, PDO::PARAM_INT);
      $st->bindValue(count($par) + 2, ($page - 1) * $size, PDO::PARAM_INT);
      $st->execute();
      $items = array_map(fn($r) => [
        'id_ese'    => (int)$r['id_ese'],
        'title'     => (string)$r['titolo_esercitazione'],
        'author'    => trim($r['nome'] . ' ' . $r['cognome']),
        'abstract'  => mb_substr(trim(strip_tags((string)$r['abstract_esercitazione'])), 0, 600),
        'cover_url' => hys_url($r, (string)($r['immagine'] ?? '')),
      ], $st->fetchAll());
      hm_out(['ok' => true, 'data' => ['total' => $total, 'page' => $page, 'size' => $size, 'items' => $items]]);
    }

    if ($action === 'list') {
      if (!$canMuseums) hm_err('Permesso negato.', 403);
      $st = $pdo->prepare('SELECT * FROM WT3DMuseum WHERE user_id = ? ORDER BY created_at DESC LIMIT 50');
      $st->execute([$userId]);
      hm_out(['ok' => true, 'data' => array_map(function ($m) { $x = hm_shape_museum($m); $x['mine'] = true; return $x; }, $st->fetchAll())]);
    }

    if ($action === 'info') {
      $musId = (int)($_GET['mus_id'] ?? 0);
      if ($musId <= 0) hm_err('mus_id mancante.');
      $m = hm_museum($pdo, $musId);
      $x = hm_shape_museum($m);
      $x['mine'] = (int)$m['user_id'] === $userId;
      hm_out(['ok' => true, 'data' => $x]);
    }

    hm_err('Azione GET non riconosciuta: search, list, info.');
  }

  if ($method === 'POST') {
    $body = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($body)) hm_err('JSON non valido.');
    $action = (string)($body['action'] ?? '');
    if (in_array($action, ['generate', 'rename', 'delete'], true) && !$canMuseums) hm_err('Permesso negato.', 403);

    if ($action === 'generate') {
      $fields = hm_fields_param($body['fields'] ?? ['chiavi']);
      $q = trim((string)($body['q'] ?? ''));
      [$where, $par, $nWords] = hm_where($fields, $q);
      if ($nWords === 0) hm_err('Scrivi almeno una parola: il museo si genera dai risultati della ricerca.');
      $st = $pdo->prepare("SELECT e.id_ese FROM Allievi a INNER JOIN Esercitazione e ON a.idu = e.idu
                           WHERE $where ORDER BY e.id_ese LIMIT " . HM_MAX_ROOMS);
      $st->execute($par);
      $ids = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
      if (!$ids) hm_err('Nessuna esercitazione corrisponde alla ricerca: niente da esporre.', 404);

      $name = trim((string)($body['name'] ?? ''));
      $name = $name === '' ? null : mb_substr($name, 0, 190);
      $vertical = ($body['vertical'] ?? 'student') === 'none' ? 'none' : 'student';
      $graph = hm_build_graph($ids);

      $pdo->beginTransaction();
      try {
        // pulizia dei musei temporanei scaduti (di tutti gli utenti)
        $pdo->exec('DELETE FROM WT3DMuseum WHERE mus_name IS NULL AND created_at < NOW(3) - INTERVAL ' . HM_TEMP_DAYS . ' DAY');

        $st = $pdo->prepare('INSERT INTO WT3DMuseum (created_at, user_id, mus_name, mus_query, mus_vertical, start_id_ese, n_nodes)
                             VALUES (NOW(3), ?, ?, ?, ?, ?, ?)');
        $st->execute([$userId, $name, json_encode(['fields' => $fields, 'q' => $q], JSON_UNESCAPED_UNICODE),
                      $vertical, $ids[0], count($ids)]);
        $musId = (int)$pdo->lastInsertId();

        $ins = $pdo->prepare('INSERT INTO WT3DMuseumNode (mus_id, MMain, MFront, MLeft, MBack, MRight) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($graph as $id => $nb) $ins->execute([$musId, $id, $nb['F'], $nb['L'], $nb['B'], $nb['R']]);
        $pdo->commit();
      } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
      }
      $m = hm_museum($pdo, $musId);
      $x = hm_shape_museum($m);
      $x['mine'] = true;
      $x['truncated'] = count($ids) >= HM_MAX_ROOMS;
      hm_out(['ok' => true, 'data' => $x]);
    }

    if ($action === 'rename' || $action === 'delete') {
      $musId = (int)($body['mus_id'] ?? 0);
      if ($musId <= 0) hm_err('mus_id mancante.');
      $m = hm_museum($pdo, $musId);
      if (!$isAdmin && (int)$m['user_id'] !== $userId) hm_err('Solo chi ha generato il museo (o l\'amministratore) può modificarlo.', 403);
      if ($action === 'delete') {
        $pdo->prepare('DELETE FROM WT3DMuseum WHERE mus_id = ?')->execute([$musId]);
        hm_out(['ok' => true, 'data' => ['mus_id' => $musId]]);
      }
      $name = trim((string)($body['name'] ?? ''));
      $pdo->prepare('UPDATE WT3DMuseum SET mus_name = ? WHERE mus_id = ?')
          ->execute([$name === '' ? null : mb_substr($name, 0, 190), $musId]);
      $x = hm_shape_museum(hm_museum($pdo, $musId));
      $x['mine'] = (int)$m['user_id'] === $userId;
      hm_out(['ok' => true, 'data' => $x]);
    }

    hm_err('Azione POST non riconosciuta: generate, rename, delete.');
  }

  hm_err('Metodo non supportato.', 405);
} catch (Throwable $e) {
  error_log('[hys_museum_tool] ' . $e->getMessage());
  hm_err('Errore server.', 500);
}
