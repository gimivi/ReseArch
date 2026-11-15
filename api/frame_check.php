<?php
// api/frame_check.php
// Dice se una pagina web si lascia mostrare in un iframe di un altro sito (2026-10-21).
// Usato dal nodo Web/URL/Frame Check (app/FLE_sub_modules/FLE-web-nodes.mjs): dal browser le
// intestazioni di un altro sito non sono leggibili (CORS), dal server sì.
//
//   GET ?url=https://…  →  { ok:true, data:{ url, final_url, frameable, reason, status, content_type, cached } }
//
// Regole:
//   X-Frame-Options DENY / SAMEORIGIN (o ALLOW-FROM, superato)      → non incorporabile
//   Content-Security-Policy frame-ancestors senza * né questo sito → non incorporabile
//   Content-Type application/pdf → non incorporabile ("pdf"): i browser non mostrano i PDF in un
//     iframe sandbox (gli iframe dei siti esterni lo sono sempre)
//   Risposta HTTP >= 400 → non incorporabile (meglio una nuova scheda, che funziona sempre)
//
// Sicurezza (la pagina fa richieste a indirizzi scritti dagli utenti):
//   - solo utenti in sessione; solo http/https, porte 80/443, niente credenziali nell'indirizzo;
//   - l'host deve risolversi SOLO in indirizzi pubblici (niente 127.x, 10.x, 192.168.x, 169.254.x,
//     ::1, fc00::/7…): così non si possono sondare i server della rete interna;
//   - la connessione usa l'IP appena controllato (CURLOPT_RESOLVE), contro il "DNS rebinding";
//   - redirect seguiti a mano (al massimo 4), ognuno ricontrollato;
//   - corpo della risposta non scaricato (si interrompe dopo le intestazioni), 6 s al massimo;
//   - risultato in cache 24 h per indirizzo (file nella cartella temporanea del server).

header('Content-Type: application/json; charset=utf-8');
if (session_status() === PHP_SESSION_NONE) session_start();
require_once __DIR__ . '/visibility.php';   // ra_session_user_ok
require_once __DIR__ . '/url_helper.php';   // app_base_url

function fc_ok(array $data): never {
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fc_err(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!ra_session_user_ok($_SESSION['user'] ?? null)) fc_err('Not authenticated.', 401);
session_write_close();   // niente blocco della sessione durante la richiesta esterna
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') fc_err('Method not allowed.', 405);
if (!function_exists('curl_init')) fc_err('PHP curl extension not available on the server.', 500);

$url = trim((string)($_GET['url'] ?? ''));
if ($url === '' || strlen($url) > 2048) fc_err('Missing or too long url.');

// ── Cache ──────────────────────────────────────────────────────────────────────
const FC_TTL = 86400;
$cacheDir = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'ra_frame_check';
$cacheFile = $cacheDir . DIRECTORY_SEPARATOR . hash('sha256', $url) . '.json';
if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < FC_TTL) {
    $c = json_decode((string)@file_get_contents($cacheFile), true);
    if (is_array($c)) { $c['cached'] = true; fc_ok($c); }
}

// ── Controlli sull'indirizzo ───────────────────────────────────────────────────

/** Indirizzi IP pubblici dell'host, oppure null se uno solo non è pubblico (o l'host non esiste). */
function fc_public_ips(string $host): ?array {
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
        // IPv6 locali non coperti dai flag di PHP (fc00::/7 unique local, fe80::/10 link local)
        if (str_contains($ip, ':') && preg_match('/^(f[cd]|fe[89ab])/i', $ip)) return null;
    }
    return array_values(array_unique($ips));
}

/** [scheme, host, port] dell'indirizzo, oppure messaggio d'errore. */
function fc_parse(string $u): array|string {
    $p = parse_url($u);
    if (!$p || empty($p['scheme']) || empty($p['host'])) return 'invalid address';
    $scheme = strtolower($p['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') return 'only http(s) addresses';
    if (isset($p['user']) || isset($p['pass'])) return 'credentials in the address are not allowed';
    $port = (int)($p['port'] ?? ($scheme === 'https' ? 443 : 80));
    if ($port !== 80 && $port !== 443) return 'only ports 80 and 443';
    return [$scheme, strtolower($p['host']), $port];
}

/** Indirizzo assoluto di un redirect (Location può essere relativo). */
function fc_resolve(string $base, string $loc): string {
    if (preg_match('#^https?://#i', $loc)) return $loc;
    $b = parse_url($base);
    $origin = $b['scheme'] . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
    if (str_starts_with($loc, '//')) return $b['scheme'] . ':' . $loc;
    if (str_starts_with($loc, '/')) return $origin . $loc;
    $dir = preg_replace('#/[^/]*$#', '/', $b['path'] ?? '/');
    return $origin . $dir . $loc;
}

/** Una richiesta: intestazioni (nomi in minuscolo, valori multipli in array) e stato. */
function fc_fetch(string $u, string $host, int $port, string $ip): array {
    $headers = [];
    $ch = curl_init($u);
    $ipForResolve = str_contains($ip, ':') ? "[$ip]" : $ip;
    curl_setopt_array($ch, [
        CURLOPT_RESOLVE        => ["$host:$port:$ipForResolve"],
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT        => 6,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; ReseArch frame check)',
        CURLOPT_HTTPHEADER     => ['Accept: text/html,application/xhtml+xml,*/*;q=0.8'],
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$headers) {
            $len = strlen($line);
            $pos = strpos($line, ':');
            if ($pos !== false) {
                $name = strtolower(trim(substr($line, 0, $pos)));
                $headers[$name][] = trim(substr($line, $pos + 1));
            }
            return $len;
        },
        // il corpo non serve: ci si ferma al primo blocco (curl risponde "write error", previsto)
        CURLOPT_WRITEFUNCTION  => fn($ch, $data) => 0,
    ]);
    curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $errno = curl_errno($ch);
    $error = curl_error($ch);
    curl_close($ch);
    if ($status === 0) return ['error' => $error ?: "connection error $errno"];
    return ['status' => $status, 'headers' => $headers];
}

/** frame-ancestors permette a $self (origine di questo sito) di incorporare la pagina? */
function fc_ancestors_allow(string $value, string $self, string $target): bool {
    $sources = preg_split('/\s+/', trim($value));
    $selfP = parse_url($self);
    foreach ($sources as $src) {
        $s = strtolower(trim($src, " ;"));
        if ($s === '' ) continue;
        if ($s === "'none'") return false;
        if ($s === '*') return true;
        if ($s === "'self'") { if (parse_url($target, PHP_URL_HOST) === ($selfP['host'] ?? '')) return true; continue; }
        if (in_array($s, ['https:', 'http:'], true)) { if (($selfP['scheme'] ?? '') . ':' === $s) return true; continue; }
        // host, eventualmente con schema e *. iniziale
        $h = preg_replace('#^[a-z]+://#', '', $s);
        $h = preg_replace('#[:/].*$#', '', $h);
        $me = strtolower($selfP['host'] ?? '');
        if ($h === $me) return true;
        if (str_starts_with($h, '*.') && str_ends_with($me, substr($h, 1))) return true;
    }
    return false;
}

// ── Richiesta con redirect controllati ─────────────────────────────────────────
$self = app_base_url();
$current = $url;
$res = null;
for ($hop = 0; $hop <= 4; $hop++) {
    $p = fc_parse($current);
    if (is_string($p)) fc_err($p);
    [$scheme, $host, $port] = $p;
    $ips = fc_public_ips($host);
    if (!$ips) fc_err('The address does not point to a public server.', 400);
    $res = fc_fetch($current, $host, $port, $ips[0]);
    if (isset($res['error'])) {
        fc_ok(['url' => $url, 'final_url' => $current, 'frameable' => false, 'reason' => 'check failed: ' . $res['error'],
               'status' => 0, 'content_type' => '', 'cached' => false]);   // errore di rete: non in cache
    }
    $loc = $res['headers']['location'][0] ?? null;
    if ($res['status'] >= 300 && $res['status'] < 400 && $loc) { $current = fc_resolve($current, $loc); continue; }
    break;
}
if ($res['status'] >= 300 && $res['status'] < 400) fc_err('Too many redirects.');

// ── Valutazione ────────────────────────────────────────────────────────────────
$h = $res['headers'];
$status = $res['status'];
$ctype = strtolower(trim(explode(';', $h['content-type'][0] ?? '')[0]));
$frameable = true;
$reason = 'allowed';
if ($status >= 400) {
    $frameable = false; $reason = "HTTP $status";
} elseif ($ctype === 'application/pdf') {
    $frameable = false; $reason = 'pdf';
} else {
    foreach ($h['x-frame-options'] ?? [] as $xfo) {
        $v = strtoupper(trim($xfo));
        $sameSite = parse_url($current, PHP_URL_HOST) === parse_url($self, PHP_URL_HOST);
        if ($v === 'DENY' || str_starts_with($v, 'ALLOW-FROM') || ($v === 'SAMEORIGIN' && !$sameSite)) {
            $frameable = false; $reason = "X-Frame-Options: $v"; break;
        }
    }
    if ($frameable) {
        foreach ($h['content-security-policy'] ?? [] as $csp) {
            foreach (explode(';', $csp) as $dir) {
                $dir = trim($dir);
                if (stripos($dir, 'frame-ancestors') === 0 &&
                    !fc_ancestors_allow(substr($dir, strlen('frame-ancestors')), $self, $current)) {
                    $frameable = false; $reason = 'CSP frame-ancestors'; break 2;
                }
            }
        }
    }
}

$data = ['url' => $url, 'final_url' => $current, 'frameable' => $frameable, 'reason' => $reason,
         'status' => $status, 'content_type' => $ctype, 'cached' => false];
if (!is_dir($cacheDir)) @mkdir($cacheDir, 0700, true);
@file_put_contents($cacheFile, json_encode($data, JSON_UNESCAPED_SLASHES), LOCK_EX);
fc_ok($data);
