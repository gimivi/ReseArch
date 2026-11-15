<?php
// api/remote_file.php
// Passa al browser un PDF di un altro sito che non ne permette la lettura da altri siti (CORS),
// per mostrarlo nell'App PDF (nodo PDF/Document/OpenUrl, via auto/server) — 2026-10-21.
//
//   GET ?url=https://…/file.pdf  →  il PDF (Content-Type: application/pdf), oppure { ok:false, error } in JSON
//
// Sicurezza (la pagina scarica indirizzi scritti dagli utenti):
//   - solo utenti in sessione (non gli ospiti); solo http/https, porte 80/443, niente credenziali;
//   - l'host deve risolversi SOLO in indirizzi pubblici (stessa regola di frame_check.php) e la
//     connessione usa l'IP controllato (CURLOPT_RESOLVE); redirect seguiti a mano e ricontrollati;
//   - passa solo i PDF (Content-Type application/pdf, oppure application/octet-stream che inizia
//     con %PDF), al massimo FILE_MAX byte, in 60 s; niente intestazioni del sito originale.

if (session_status() === PHP_SESSION_NONE) session_start();
require_once __DIR__ . '/visibility.php';   // ra_session_user_ok, ra_is_guest

const FILE_MAX = 60 * 1024 * 1024;

function rf_err(string $msg, int $code = 400): never {
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

$user = $_SESSION['user'] ?? null;
if (!ra_session_user_ok($user)) rf_err('Not authenticated.', 401);
if (ra_is_guest($user)) rf_err('Not available to guests.', 403);
session_write_close();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') rf_err('Method not allowed.', 405);
if (!function_exists('curl_init')) rf_err('PHP curl extension not available on the server.', 500);

$url = trim((string)($_GET['url'] ?? ''));
if ($url === '' || strlen($url) > 2048) rf_err('Missing or too long url.');

/** Indirizzi IP pubblici dell'host, oppure null se uno solo non è pubblico (o l'host non esiste). */
function rf_public_ips(string $host): ?array {
    $host = trim($host, '[]');
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        $ips = [$host];
    } else {
        $ips = [];
        $v4 = @gethostbynamel($host);
        if (is_array($v4)) $ips = $v4;
        $v6 = @dns_get_record($host, DNS_AAAA);
        if (is_array($v6)) foreach ($v6 as $r) if (!empty($r['ipv6'])) $ips[] = $r['ipv6'];
    }
    if (!$ips) return null;
    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return null;
        if (str_contains($ip, ':') && preg_match('/^(f[cd]|fe[89ab])/i', $ip)) return null;
    }
    return array_values(array_unique($ips));
}

function rf_resolve(string $base, string $loc): string {
    if (preg_match('#^https?://#i', $loc)) return $loc;
    $b = parse_url($base);
    $origin = $b['scheme'] . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
    if (str_starts_with($loc, '//')) return $b['scheme'] . ':' . $loc;
    if (str_starts_with($loc, '/')) return $origin . $loc;
    return $origin . preg_replace('#/[^/]*$#', '/', $b['path'] ?? '/') . $loc;
}

$current = $url;
for ($hop = 0; $hop <= 4; $hop++) {
    $p = parse_url($current);
    if (!$p || empty($p['scheme']) || empty($p['host'])) rf_err('Invalid address.');
    $scheme = strtolower($p['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') rf_err('Only http(s) addresses.');
    if (isset($p['user']) || isset($p['pass'])) rf_err('Credentials in the address are not allowed.');
    $host = strtolower($p['host']);
    $port = (int)($p['port'] ?? ($scheme === 'https' ? 443 : 80));
    if ($port !== 80 && $port !== 443) rf_err('Only ports 80 and 443.');
    $ips = rf_public_ips($host);
    if (!$ips) rf_err('The address does not point to a public server.');
    $ip = str_contains($ips[0], ':') ? '[' . $ips[0] . ']' : $ips[0];

    $headers = [];
    $status = 0;
    $started = false;   // intestazioni già inviate al browser
    $sent = 0;
    $refused = null;    // motivo per cui il corpo non va passato
    $ch = curl_init($current);
    curl_setopt_array($ch, [
        CURLOPT_RESOLVE        => ["$host:$port:$ip"],
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; ReseArch PDF viewer)',
        CURLOPT_HTTPHEADER     => ['Accept: application/pdf,*/*;q=0.5'],
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$headers, &$status) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) { $status = (int)$m[1]; $headers = []; }
            $pos = strpos($line, ':');
            if ($pos !== false) $headers[strtolower(trim(substr($line, 0, $pos)))] = trim(substr($line, $pos + 1));
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION  => function ($ch, $data) use (&$headers, &$status, &$started, &$sent, &$refused) {
            if ($status >= 300 && $status < 400) return strlen($data);   // corpo del redirect: ignorato
            if (!$started) {
                if ($status !== 200) { $refused = "HTTP $status"; return 0; }
                $ctype = strtolower(trim(explode(';', $headers['content-type'] ?? '')[0]));
                $isPdf = $ctype === 'application/pdf' || (in_array($ctype, ['application/octet-stream', 'binary/octet-stream', ''], true) && str_starts_with($data, '%PDF'));
                if (!$isPdf) { $refused = 'not a PDF (' . ($ctype ?: 'unknown type') . ')'; return 0; }
                $len = (int)($headers['content-length'] ?? 0);
                if ($len > FILE_MAX) { $refused = 'file too big'; return 0; }
                header('Content-Type: application/pdf');
                header('Content-Disposition: inline');
                header('Cache-Control: private, max-age=3600');
                header('X-Content-Type-Options: nosniff');
                if ($len > 0) header('Content-Length: ' . $len);
                $started = true;
            }
            $sent += strlen($data);
            if ($sent > FILE_MAX) { $refused = 'file too big'; return 0; }
            echo $data;
            flush();
            return strlen($data);
        },
    ]);
    curl_exec($ch);
    $err = curl_errno($ch) ? curl_error($ch) : '';
    curl_close($ch);

    if ($started) exit;   // PDF passato (un errore a metà si vede come file troncato in PDF.js)
    if ($status >= 300 && $status < 400 && !empty($headers['location'])) { $current = rf_resolve($current, $headers['location']); continue; }
    if ($refused) rf_err($refused, $refused === 'file too big' ? 413 : (str_starts_with($refused, 'HTTP ') ? 502 : 415));
    rf_err($err !== '' ? "Download failed: $err" : "HTTP $status", 502);
}
rf_err('Too many redirects.');
