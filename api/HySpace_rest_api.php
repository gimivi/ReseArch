<?php
// HySpace_rest_api.php — un NODO del museo virtuale HySpace (model_HYS.mjs).
//
//   GET ?id_ese=N[&museum=M]
//   → { success, node: {...esercitazione, paragraphs[]}, neighbors: { F, L, B, R, D, U }, museum? }
//
// museum=M (2026-09-26): usa il grafo di un museo GENERATO da una ricerca
// (WT3DMuseumNode, api/hys_museum_tool.php) al posto del grafo curato WT3DNode;
// salite/discese secondo WT3DMuseum.mus_vertical ('student' = come sotto, 'none' = nessuna).
//
// Logica ripresa da WT3DData_Search.aspx.vb (versione VRML, _doc/Old_HS/):
// - vicini ORIZZONTALI dal grafo curato WT3DNode (riga con MMain = id_ese):
//   F = MFront, L = MLeft, B = MBack, R = MRight;
// - vicini VERTICALI dal percorso dello stesso allievo, nell'ordine di
//   WT3DNode_Search_old.aspx.vb: Esercitazione.cod_ese, poi id_ordine (2026-09-25):
//   D = esercitazione precedente, U = successiva.
// Il nodo centrale porta anche i testi della scheda (descrizione, abstract, chiavi)
// e i paragrafi in ordine di Paragrafo.id_ordine, con immagine e miniatura
// (icona_paragrafo) — usati dalla scheda HTML dell'esercitazione (WT3DNode_ViewEse).
// Un vicino assente/non visibile è null → il client tiene chiusa la porta/scala.
// Un'esercitazione senza riga in WT3DNode (raggiungibile solo in verticale) è
// comunque un nodo valido: ha solo i vicini orizzontali a null.
//
// Differenze volute rispetto all'originale: nessun limite di 5 esercitazioni per
// allievo nel calcolo di su/giù; filtro flag_show anche su su/giù; percorsi
// immagine calcolati qui (il client non conosce più la cartella base).

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

if (session_status() === PHP_SESSION_NONE) session_start();

function hys_out(int $code, array $body): void {
  http_response_code($code);
  echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

if (empty($_SESSION['user'])) {
  hys_out(401, ['success' => false, 'message' => 'Sessione non valida.']);
}

$idEse = filter_input(INPUT_GET, 'id_ese', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if (!$idEse) {
  hys_out(400, ['success' => false, 'message' => 'Parametro id_ese mancante o non valido.']);
}

// connessione al database di HySpace e percorsi dei file (hys_pdo, hys_url)
require_once __DIR__ . '/hys_common.php';

$museumId = filter_input(INPUT_GET, 'museum', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) ?: null;

try {
  $pdo = hys_pdo();

  // museo generato (facoltativo)
  $museum = null;
  if ($museumId) {
    $st = $pdo->prepare('SELECT mus_id, mus_name, created_at, mus_vertical, start_id_ese, n_nodes FROM WT3DMuseum WHERE mus_id = ? LIMIT 1');
    $st->execute([$museumId]);
    $museum = $st->fetch() ?: null;
    if (!$museum) hys_out(404, ['success' => false, 'message' => 'Museo non trovato (forse era temporaneo ed è scaduto).']);
  }

  // 1) vicini orizzontali: grafo del museo generato, o grafo curato
  if ($museum) {
    $st = $pdo->prepare('SELECT MFront, MLeft, MBack, MRight FROM WT3DMuseumNode WHERE mus_id = ? AND MMain = ? LIMIT 1');
    $st->execute([$museumId, $idEse]);
  } else {
    $st = $pdo->prepare('SELECT MFront, MLeft, MBack, MRight FROM WT3DNode WHERE MMain = ? LIMIT 1');
    $st->execute([$idEse]);
  }
  $wt = $st->fetch() ?: [];
  $ids = [
    'F' => (int)($wt['MFront'] ?? 0),
    'L' => (int)($wt['MLeft']  ?? 0),
    'B' => (int)($wt['MBack']  ?? 0),
    'R' => (int)($wt['MRight'] ?? 0),
    'D' => 0,
    'U' => 0,
  ];

  // 2) dati delle esercitazioni (solo visibili). flag_show non qualificato come
  //    nella query originale .NET, che non indicava a quale tabella appartiene.
  //    e.* così i campi opzionali (es. flag_anim) arrivano solo se esistono.
  $exeSql = '
    SELECT e.*, a.nome, a.cognome, a.year_folder, a.main_folder
    FROM Allievi a
    INNER JOIN Esercitazione e ON a.idu = e.idu
    WHERE flag_show = 1 AND e.id_ese IN (%s)';

  $fetchExe = function (array $idList) use ($pdo, $exeSql): array {
    $idList = array_values(array_unique(array_filter($idList)));
    if (!$idList) return [];
    $st = $pdo->prepare(sprintf($exeSql, implode(',', array_fill(0, count($idList), '?'))));
    $st->execute($idList);
    $out = [];
    foreach ($st->fetchAll() as $r) $out[(int)$r['id_ese']] = $r;
    return $out;
  };

  $center = $fetchExe([$idEse])[$idEse] ?? null;
  if (!$center) {
    hys_out(404, ['success' => false, 'message' => 'Esercitazione non trovata o non visibile.']);
  }

  // 3) vicini verticali: percorso dello stesso allievo (nessuno se il museo generato li esclude)
  if (($museum['mus_vertical'] ?? 'student') === 'student') {
  $st = $pdo->prepare('
    SELECT e.id_ese
    FROM Allievi a
    INNER JOIN Esercitazione e ON a.idu = e.idu
    WHERE e.idu = ? AND flag_show = 1
    ORDER BY e.cod_ese, e.id_ordine, e.id_ese');
  $st->execute([(int)$center['idu']]);
  $seq = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
  $pos = array_search($idEse, $seq, true);
  if ($pos !== false) {
    $ids['D'] = $seq[$pos - 1] ?? 0;
    $ids['U'] = $seq[$pos + 1] ?? 0;
  }
  }

  $exes = $fetchExe(array_values($ids));
  $exes[$idEse] = $center;

  // 4) paragrafi (immagini per tutti i 7 nodi: i pannelli si costruiscono ovunque)
  $allIds = array_keys($exes);
  $st = $pdo->prepare(sprintf('
    SELECT id_ese, id_par, id_ordine, titolo_paragrafo, corpo_paragrafo, immagine_paragrafo,
           icona_paragrafo, didascalia_immagine
    FROM Paragrafo
    WHERE flag_show = 1 AND id_ese IN (%s)
    ORDER BY id_ese, id_ordine, id_par', implode(',', array_fill(0, count($allIds), '?'))));
  $st->execute($allIds);
  $pars = [];
  foreach ($st->fetchAll() as $p) $pars[(int)$p['id_ese']][] = $p;

  $shape = function (int $id, bool $withParagraphs = false) use ($exes, $pars): ?array {
    $e = $exes[$id] ?? null;
    if (!$e) return null;

    $images = [];
    foreach ($pars[$id] ?? [] as $p) {
      $u = hys_url($e, (string)$p['immagine_paragrafo']);
      if ($u !== null && count($images) < 16) $images[] = $u;
    }

    $out = [
      'id_ese'    => $id,
      'idu'       => (int)$e['idu'],
      'title'     => (string)$e['titolo_esercitazione'],
      'author'    => trim($e['nome'] . ' ' . $e['cognome']),
      'model_url' => hys_url($e, (string)($e['modello_3d'] ?? '')),
      'cover_url' => hys_url($e, (string)($e['immagine'] ?? '')),
      // animazione del modello all'ingresso nella stanza (Esercitazione.flag_anim):
      // 0 nessuna, 1 giro orizzontale, 2 giro verticale, 3 / 4 = 1 / 2 in loop
      'anim'      => (int)($e['flag_anim'] ?? 0),
      'images'    => $images,
    ];

    if ($withParagraphs) {
      // testi della scheda (WT3DNode_ViewEse): la vecchia pagina leggeva anche
      // abstract e chiavi senza mostrarli; ora arrivano, la scheda li usa
      $out['descrizione'] = (string)($e['descrizione_esercitazione'] ?? '');
      $out['abstract']    = (string)($e['abstract_esercitazione'] ?? '');
      $out['chiavi']      = (string)($e['chiavi_esercitazione'] ?? '');
      $out['paragraphs'] = array_map(fn($p) => [
        'id_par'     => (int)$p['id_par'],
        'ordine'     => (int)($p['id_ordine'] ?? 0),
        'titolo'     => (string)$p['titolo_paragrafo'],
        'corpo'      => (string)$p['corpo_paragrafo'],
        'immagine'   => hys_url($e, (string)$p['immagine_paragrafo']),
        // miniatura; se manca, la scheda usa l'immagine grande
        'icona'      => hys_url($e, (string)($p['icona_paragrafo'] ?? '')),
        'didascalia' => (string)$p['didascalia_immagine'],
      ], $pars[$id] ?? []);
    }
    return $out;
  };

  $neighbors = [];
  foreach ($ids as $dir => $nid) $neighbors[$dir] = $nid ? $shape($nid) : null;

  hys_out(200, [
    'success'   => true,
    'node'      => $shape($idEse, true),
    'neighbors' => $neighbors,
    'museum'    => $museum ? [
      'mus_id'       => (int)$museum['mus_id'],
      'name'         => $museum['mus_name'],
      'created_at'   => $museum['created_at'],
      'vertical'     => $museum['mus_vertical'],
      'start_id_ese' => (int)$museum['start_id_ese'],
      'n_nodes'      => (int)$museum['n_nodes'],
    ] : null,
  ]);

} catch (Throwable $e) {
  error_log('[HySpace_rest_api] ' . $e->getMessage());
  hys_out(500, ['success' => false, 'message' => 'Errore server.']);
}
