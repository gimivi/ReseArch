<?php
// api/flow_validation.php
// Validazione dei flow che contengono nodi critici (step 5 di
// _doc/arch-abilitazioni.md §5). Solo funzioni: niente output, niente sessione.
//
// Regole (riassunto):
//   - un flow con nodi critici gira per gli altri utenti solo nella versione
//     PUBBLICATA (flows.flow_fle_published), e solo se quella versione ha una
//     validazione non revocata in flow_validations;
//   - l'autore riceve sempre la propria BOZZA (flows.flow_fle);
//   - la validazione riguarda l'INTERO grafo normalizzato (hash senza
//     posizioni/aspetto grafico), non il singolo codice: conta anche il
//     collegamento dei fili.
// Il controllo si fa lato server a ogni caricamento, ricalcolando l'hash dal
// contenuto: non si fida di flag salvati.

declare(strict_types=1);

/**
 * Tipi di nodo critici: eseguono codice arbitrario scritto nel grafo.
 * UNICA fonte di verità (il client può mostrare un badge, ma decide questo elenco).
 * Nuovi nodi critici installati dall'admin vanno aggiunti qui.
 */
const FV_CRITICAL_TYPES = [
  'Script/Flexi'                => 'code',   // property con il codice
  'ReseArch/Expression/Formula' => 'expr',
  'JSX/Script'                  => 'code',   // step 9: ex file .mjs dei modelli JSX
  'HTM/Script'                  => 'code',   // step 9: ex modalità "inject" di HTM
  'ReseArch/Context/Library'    => 'url',    // 2026-10-04: carica ed esegue una libreria da URL
  'ReseArch/Context/Service'    => 'url',    // 2026-10-04: connessione a un servizio esterno (Ollama…)
  'ReseArch/Context/Device'     => 'channel', // 2026-10-12: connessione a un dispositivo (ESP32, Arduino…)
];

/** Chiavi di un nodo che sono solo aspetto grafico: escluse dall'hash. */
const FV_VISUAL_NODE_KEYS = ['pos', 'size', 'flags', 'color', 'bgcolor', 'boxcolor', 'shape', 'order'];
/** Chiavi di un grafo che sono solo stato dell'editor: escluse dall'hash. */
const FV_VISUAL_GRAPH_KEYS = ['extra', 'groups', 'version', 'config'];

/** flow_fle (stringa JSON o array) → array PHP, o null. */
function fv_decode($fle): ?array {
  if (is_string($fle)) $fle = $fle === '' ? null : json_decode($fle, true);
  return is_array($fle) ? $fle : null;
}

/**
 * Nodi critici presenti ovunque nel flow (anche dentro i sottografi):
 * [['type', 'id', 'title', 'code'], ...].
 */
function fv_critical_nodes($fle): array {
  $data = fv_decode($fle);
  $out = [];
  if ($data !== null) fv_walk_nodes($data, $out);
  return $out;
}

function fv_walk_nodes(array $a, array &$out): void {
  if (isset($a['nodes']) && is_array($a['nodes'])) {
    foreach ($a['nodes'] as $n) {
      if (!is_array($n)) continue;
      $type = (string)($n['type'] ?? '');
      if (isset(FV_CRITICAL_TYPES[$type])) {
        $prop = FV_CRITICAL_TYPES[$type];
        $out[] = [
          'type'  => $type,
          'id'    => $n['id'] ?? null,
          'title' => (string)($n['title'] ?? ''),
          'code'  => (string)($n['properties'][$prop] ?? ''),
        ];
      }
    }
  }
  foreach ($a as $v) {
    if (is_array($v)) fv_walk_nodes($v, $out);
  }
}

/** Copia del grafo senza aspetto grafico, con chiavi ordinate: base dell'hash. */
function fv_normalize($v) {
  if (!is_array($v)) return $v;
  $isList = $v === [] || array_keys($v) === range(0, count($v) - 1);
  if ($isList) {
    return array_map('fv_normalize', $v);
  }
  $looksLikeNode = isset($v['type']) && array_key_exists('id', $v);
  $looksLikeGraph = isset($v['nodes']) && is_array($v['nodes']);
  $out = [];
  foreach ($v as $k => $x) {
    if ($looksLikeNode && in_array($k, FV_VISUAL_NODE_KEYS, true)) continue;
    if ($looksLikeGraph && in_array($k, FV_VISUAL_GRAPH_KEYS, true)) continue;
    $out[$k] = fv_normalize($x);
  }
  ksort($out, SORT_STRING);
  return $out;
}

/** Hash SHA-256 del flow normalizzato (null se il flow è vuoto). */
function fv_hash($fle): ?string {
  $data = fv_decode($fle);
  if ($data === null) return null;
  // Flow dashboard: {graph, topics_snapshot}. Lo snapshot dei topic è ricalcolato
  // dall'editor a ogni salvataggio (dato derivato): non deve invalidare nulla.
  unset($data['topics_snapshot']);
  return hash('sha256', json_encode(fv_normalize($data), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

/** Esiste una validazione NON revocata di questo contenuto per questo flow? */
function fv_is_validated(PDO $pdo, int $flowId, ?string $hash): bool {
  if ($hash === null) return false;
  $st = $pdo->prepare("SELECT 1 FROM flow_validations
                       WHERE flow_id = ? AND flow_hash = ? AND revoked_at IS NULL LIMIT 1");
  $st->execute([$flowId, $hash]);
  return (bool)$st->fetchColumn();
}

/**
 * Registra una validazione (idempotente: se esiste già una validazione valida
 * dello stesso contenuto non ne aggiunge un'altra). Ritorna l'id.
 */
function fv_record_validation(PDO $pdo, int $flowId, string $hash, $fle, int $validatorId, string $note): int {
  $st = $pdo->prepare("SELECT val_id FROM flow_validations
                       WHERE flow_id = ? AND flow_hash = ? AND revoked_at IS NULL LIMIT 1");
  $st->execute([$flowId, $hash]);
  $existing = $st->fetchColumn();
  if ($existing) return (int)$existing;
  $json = is_string($fle) ? $fle : json_encode($fle, JSON_UNESCAPED_UNICODE);
  $pdo->prepare("INSERT INTO flow_validations (flow_id, flow_hash, flow_fle, validated_by, note)
                 VALUES (?, ?, CAST(? AS JSON), ?, ?)")
      ->execute([$flowId, $hash, $json, $validatorId, mb_substr($note, 0, 500)]);
  return (int)$pdo->lastInsertId();
}

/**
 * Dopo un salvataggio della bozza: decide se la bozza diventa anche la
 * versione pubblicata. Aggiorna flow_fle_published / flow_hash_published /
 * flow_review. Ritorna lo stato: 'none' | 'approved' | 'pending'.
 *
 *   - nessun nodo critico              → pubblicata subito ('none');
 *   - chi salva è amministratore       → validata e pubblicata in automatico;
 *   - contenuto già validato per questo flow (es. spostati solo nodi)
 *                                       → pubblicata ('approved');
 *   - altrimenti                        → 'pending': la versione pubblicata
 *     resta quella precedente (o nessuna), finché qualcuno non la valida.
 *
 * La bozza si RILEGGE dal DB (con blocco di riga): l'hash va calcolato sullo
 * stesso JSON che fv_version_for() rileggerà al caricamento, non su quello
 * inviato dal browser — MySQL può riscrivere numeri e ordine delle chiavi, e
 * due hash diversi dello stesso flow lo renderebbero "non validato".
 * Da chiamare dentro una transazione, dopo aver scritto flows.flow_fle.
 */
function fv_after_save(PDO $pdo, int $flowId, bool $saverIsAdmin, int $userId): string {
  $st = $pdo->prepare("SELECT flow_fle FROM flows WHERE flow_id = ? FOR UPDATE");
  $st->execute([$flowId]);
  $raw  = $st->fetchColumn();
  $data = fv_decode($raw === false ? null : $raw);

  if (!fv_critical_nodes($data)) {
    $pdo->prepare("UPDATE flows SET flow_fle_published = flow_fle, flow_hash_published = NULL, flow_review = 'none'
                   WHERE flow_id = ?")->execute([$flowId]);
    return 'none';
  }

  $hash = fv_hash($data);
  if ($saverIsAdmin) {
    fv_record_validation($pdo, $flowId, $hash, (string)$raw, $userId, 'Automatica: salvato da un amministratore');
  }
  if ($saverIsAdmin || fv_is_validated($pdo, $flowId, $hash)) {
    $pdo->prepare("UPDATE flows SET flow_fle_published = flow_fle, flow_hash_published = ?, flow_review = 'approved'
                   WHERE flow_id = ?")->execute([$hash, $flowId]);
    return 'approved';
  }

  $pdo->prepare("UPDATE flows SET flow_review = 'pending' WHERE flow_id = ?")->execute([$flowId]);
  return 'pending';
}

/**
 * Quale versione del flow può ricevere $userId?
 * Ritorna ['fle' => array|null, 'version' => 'draft'|'published'|'none', 'reason' => string].
 *   - autore → la bozza;
 *   - altri (amministratore compreso) → la versione pubblicata, se non contiene
 *     nodi critici oppure se il suo contenuto ha una validazione non revocata;
 *     altrimenti nulla.
 */
function fv_version_for(PDO $pdo, array $row, int $userId): array {
  if ($userId > 0 && (int)($row['author_id'] ?? 0) === $userId) {
    return ['fle' => fv_decode($row['flow_fle'] ?? null), 'version' => 'draft', 'reason' => ''];
  }
  $pub = fv_decode($row['flow_fle_published'] ?? null);
  if ($pub === null) {
    return ['fle' => null, 'version' => 'none', 'reason' => 'Flow in attesa di validazione: non ancora eseguibile per gli altri utenti.'];
  }
  if (fv_critical_nodes($pub) && !fv_is_validated($pdo, (int)$row['flow_id'], fv_hash($pub))) {
    return ['fle' => null, 'version' => 'none', 'reason' => 'Validazione del flow revocata o mancante: non eseguibile per gli altri utenti.'];
  }
  return ['fle' => $pub, 'version' => 'published', 'reason' => ''];
}

/** L'utente ha un ruolo (qualunque) nella ricerca del workpackage $wpId? */
function fv_user_has_role_in_research(PDO $pdo, int $userId, int $wpId): bool {
  $st = $pdo->prepare("
    SELECT 1
    FROM   workpackages w
    WHERE  w.wp_id = :wp AND (
             EXISTS (SELECT 1 FROM users_res_permissions r
                     WHERE r.user_id = :u1 AND r.res_id = w.res_id AND r.perm IN ('P','W','I'))
          OR EXISTS (SELECT 1 FROM users_wp_permissions p
                     JOIN workpackages w2 ON w2.wp_id = p.wp_id
                     WHERE p.user_id = :u2 AND w2.res_id = w.res_id AND p.perm IN ('W','I'))
           )
    LIMIT 1");
  $st->execute([':wp' => $wpId, ':u1' => $userId, ':u2' => $userId]);
  return (bool)$st->fetchColumn();
}
