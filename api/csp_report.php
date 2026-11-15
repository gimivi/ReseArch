<?php
// api/csp_report.php
// Riceve le segnalazioni della Content-Security-Policy (header
// Content-Security-Policy-Report-Only, direttiva report-uri — vedi Web.config
// e .htaccess) e le aggrega nella tabella csp_reports. Step 4 di
// _doc/arch-abilitazioni.md: serve a scoprire quali domini l'app usa davvero
// prima di attivare la CSP in modalità bloccante.
//
// Endpoint PUBBLICO per necessità: i browser inviano le segnalazioni senza
// garanzia di cookie di sessione. Difese contro l'abuso:
//   - corpo max 16 KB, solo POST;
//   - aggregazione per (direttiva, origine, pagina): ripetere la stessa
//     segnalazione incrementa un contatore, non aggiunge righe;
//   - tetto di CSP_MAX_ROWS righe distinte: oltre, le NUOVE combinazioni
//     vengono ignorate (quelle esistenti continuano a contare).
// Nessuna risposta utile al chiamante: sempre 204.

declare(strict_types=1);

const CSP_MAX_BODY = 16384;
const CSP_MAX_ROWS = 2000;

function csp_done(int $code = 204): void {
  http_response_code($code);
  exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') csp_done(405);

$raw = file_get_contents('php://input', false, null, 0, CSP_MAX_BODY + 1);
if ($raw === false || $raw === '' || strlen($raw) > CSP_MAX_BODY) csp_done();

$j = json_decode($raw, true);
if (!is_array($j)) csp_done();

// Formato report-uri: {"csp-report": {...}}. Formato Reporting API (report-to):
// [{"type":"csp-violation","body":{...}}] — gestito anche questo per il futuro.
$reports = [];
if (isset($j['csp-report']) && is_array($j['csp-report'])) {
  $r = $j['csp-report'];
  $reports[] = [
    'directive' => $r['effective-directive'] ?? $r['violated-directive'] ?? '',
    'blocked'   => $r['blocked-uri'] ?? '',
    'page'      => $r['document-uri'] ?? '',
    'sample'    => $r['script-sample'] ?? '',
  ];
} elseif (isset($j[0])) {  // lista (array_is_list è solo PHP 8.1+, requisito minimo 8.0)
  foreach (array_slice($j, 0, 20) as $item) {
    $b = is_array($item) ? ($item['body'] ?? null) : null;
    if (!is_array($b)) continue;
    $reports[] = [
      'directive' => $b['effectiveDirective'] ?? '',
      'blocked'   => $b['blockedURL'] ?? '',
      'page'      => $b['documentURL'] ?? '',
      'sample'    => $b['sample'] ?? '',
    ];
  }
}
if (!$reports) csp_done();

/** 'https://host:porta/percorso?x' → 'https://host:porta'; parole chiave CSP invariate. */
function csp_origin(string $u): string {
  $u = trim($u);
  if ($u === '' || !str_contains($u, '://')) return substr($u !== '' ? $u : 'inline', 0, 255);
  $p = parse_url($u);
  if (!$p || empty($p['scheme']) || empty($p['host'])) return substr($u, 0, 255);
  return substr($p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : ''), 0, 255);
}

/** Solo il nome della pagina (es. 'dashboard.php'), senza host né query. */
function csp_page(string $u): string {
  $path = parse_url($u, PHP_URL_PATH) ?: '';
  return substr(basename($path) ?: '/', 0, 190);
}

require_once __DIR__ . '/db.php';

try {
  $count = (int)$pdo->query("SELECT COUNT(*) FROM csp_reports")->fetchColumn();

  $upd = $pdo->prepare("UPDATE csp_reports SET hits = hits + 1, last_seen = NOW()
                        WHERE directive = :d AND blocked = :b AND page = :p");
  $ins = $pdo->prepare("INSERT IGNORE INTO csp_reports (directive, blocked, page, sample)
                        VALUES (:d, :b, :p, :s)");

  foreach ($reports as $r) {
    $d = substr(preg_replace('/[^a-z-]/', '', strtolower((string)$r['directive'])), 0, 64);
    if ($d === '') continue;
    $b = csp_origin((string)$r['blocked']);
    $p = csp_page((string)$r['page']);

    $upd->execute([':d' => $d, ':b' => $b, ':p' => $p]);
    if ($upd->rowCount() > 0 || $count >= CSP_MAX_ROWS) continue;

    $sample = (string)$r['blocked'];
    if (!empty($r['sample'])) $sample .= ' | ' . (string)$r['sample'];
    $ins->execute([':d' => $d, ':b' => $b, ':p' => $p, ':s' => mb_substr($sample, 0, 1000)]);
    $count++;
  }
} catch (Throwable $e) {
  csp_done(500);
}

csp_done();
