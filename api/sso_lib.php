<?php
// api/sso_lib.php — accesso con account esterni (ORCID, Google, GitHub): fornitori, scambio del
// codice, lettura dell'identità. Usato da api/sso_start.php e api/sso_callback.php.
// Progetto: _doc/arch-sso-ospiti.md. Configurazione: cfg/cfg_sso.php (modello cfg_sso.example.php).
//
// Flusso OAuth 2 "authorization code" (con PKCE dove il fornitore lo accetta). Il token arriva
// DIRETTAMENTE dal fornitore su HTTPS (curl con verifica del certificato), quindi per l'id_token di
// Google basta la validazione TLS al posto della firma (OpenID Connect Core §3.1.3.7); si controllano
// comunque aud, iss, exp e nonce.
declare(strict_types=1);

require_once __DIR__ . '/url_helper.php';

const RA_SSO_PROVIDERS = [
    'orcid' => [
        'label' => 'ORCID',
        'auth'  => 'https://orcid.org/oauth/authorize',
        'token' => 'https://orcid.org/oauth/token',
        'scope' => '/authenticate',
        'pkce'  => false,
    ],
    'google' => [
        'label' => 'Google',
        'auth'  => 'https://accounts.google.com/o/oauth2/v2/auth',
        'token' => 'https://oauth2.googleapis.com/token',
        'scope' => 'openid email profile',
        'pkce'  => true,
    ],
    'github' => [
        'label' => 'GitHub',
        'auth'  => 'https://github.com/login/oauth/authorize',
        'token' => 'https://github.com/login/oauth/access_token',
        'scope' => 'read:user user:email',
        'pkce'  => true,
    ],
];

/**
 * Icona del fornitore per i pulsanti di accesso (SVG in linea, decorativa: aria-hidden).
 * Marchi nei colori ufficiali, come chiedono le linee guida: "G" di Google a quattro colori,
 * iD di ORCID verde, Octocat di GitHub nel colore del testo (currentColor).
 */
function ra_sso_icon(string $provider, int $size = 20): string {
    $a = 'width="' . $size . '" height="' . $size . '" aria-hidden="true" focusable="false"';
    switch ($provider) {
        case 'google':
            return '<svg ' . $a . ' viewBox="0 0 48 48">'
                . '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
                . '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
                . '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
                . '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
                . '</svg>';
        case 'orcid':
            return '<svg ' . $a . ' viewBox="0 0 256 256">'
                . '<circle cx="128" cy="128" r="128" fill="#A6CE39"/>'
                . '<path fill="#fff" d="M86.3 186.2H70.9V79.1h15.4v107.1z"/>'
                . '<path fill="#fff" d="M108.9 79.1h41.6c39.6 0 57 28.3 57 53.6 0 27.5-21.5 53.6-56.8 53.6h-41.8V79.1zm15.4 93.3h24.5c34.9 0 42.9-26.5 42.9-39.7 0-21.5-13.7-39.7-43.7-39.7h-23.7v79.4z"/>'
                . '<path fill="#fff" d="M88.7 56.8c0 5.5-4.5 10.1-10.1 10.1s-10.1-4.6-10.1-10.1c0-5.6 4.5-10.1 10.1-10.1s10.1 4.6 10.1 10.1z"/>'
                . '</svg>';
        case 'github':
            return '<svg ' . $a . ' viewBox="0 0 16 16"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
    }
    return '';
}

/** Configurazione (vuota se cfg/cfg_sso.php manca). */
function ra_sso_cfg(): array {
    static $cfg = null;
    if ($cfg === null) {
        $f = __DIR__ . '/../cfg/cfg_sso.php';
        $cfg = is_file($f) ? (require $f) : [];
        if (!is_array($cfg)) $cfg = [];
    }
    return $cfg;
}

/** Fornitori attivi (con client_id configurato), nell'ordine: chiave => etichetta. */
function ra_sso_enabled(): array {
    $out = [];
    $p = ra_sso_cfg()['providers'] ?? [];
    foreach (RA_SSO_PROVIDERS as $k => $def) {
        if (!empty($p[$k]['client_id']) && !empty($p[$k]['client_secret'])) $out[$k] = $def['label'];
    }
    return $out;
}

function ra_sso_guests_enabled(): bool {
    return (bool)(ra_sso_cfg()['guests_enabled'] ?? true);
}

/** Endpoint del fornitore (ORCID in sandbox se richiesto). */
function ra_sso_endpoint(string $provider, string $which): string {
    $url = RA_SSO_PROVIDERS[$provider][$which];
    if ($provider === 'orcid' && !empty(ra_sso_cfg()['providers']['orcid']['sandbox'])) {
        $url = str_replace('https://orcid.org/', 'https://sandbox.orcid.org/', $url);
    }
    return $url;
}

/** Indirizzo di ritorno di questa installazione (da registrare presso i fornitori). */
function ra_sso_redirect_uri(): string {
    return app_base_url() . '/api/sso_callback.php';
}

function ra_sso_b64url(string $bin): string {
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

/** Richiesta HTTPS al fornitore; restituisce il JSON decodificato o lancia un'eccezione. */
function ra_sso_http(string $url, ?array $post = null, array $headers = []): array {
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_HTTPHEADER     => array_merge(['Accept: application/json', 'User-Agent: ReseArch'], $headers),
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ];
    // Su alcuni server (Windows/IIS) PHP non ha i certificati radice: bundle ufficiale di curl.se
    $ca = realpath(__DIR__ . '/../cfg/cacert.pem');
    if ($ca) $opts[CURLOPT_CAINFO] = $ca;
    if ($post !== null) {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = http_build_query($post);
    }
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($body === false) throw new RuntimeException('connessione al fornitore non riuscita: ' . $err);
    $j = json_decode((string)$body, true);
    if ($code >= 400 || !is_array($j)) {
        $msg = is_array($j) ? ($j['error_description'] ?? $j['error'] ?? $j['message'] ?? '') : '';
        throw new RuntimeException("risposta del fornitore non valida (HTTP $code) $msg");
    }
    return $j;
}

/**
 * URL a cui mandare il browser per l'accesso; salva in sessione state, nonce e verificatore PKCE.
 * $mode: 'login' (membro o ospite) | 'link' (collegare l'account al membro già entrato).
 */
function ra_sso_begin(string $provider, string $mode): string {
    $def = RA_SSO_PROVIDERS[$provider];
    $cfg = ra_sso_cfg()['providers'][$provider];
    $state = bin2hex(random_bytes(16));
    $nonce = bin2hex(random_bytes(16));
    $verifier = ra_sso_b64url(random_bytes(32));
    $_SESSION['sso'] = ['provider' => $provider, 'state' => $state, 'nonce' => $nonce,
                        'verifier' => $verifier, 'mode' => $mode, 't' => time()];
    $q = [
        'client_id'     => $cfg['client_id'],
        'redirect_uri'  => ra_sso_redirect_uri(),
        'response_type' => 'code',
        'scope'         => $def['scope'],
        'state'         => $state,
    ];
    if ($def['pkce']) {
        $q['code_challenge'] = ra_sso_b64url(hash('sha256', $verifier, true));
        $q['code_challenge_method'] = 'S256';
    }
    if ($provider === 'google') { $q['nonce'] = $nonce; $q['prompt'] = 'select_account'; }
    return ra_sso_endpoint($provider, 'auth') . '?' . http_build_query($q);
}

/**
 * Ritorno dal fornitore: verifica state, scambia il codice, legge l'identità.
 * @return array{provider:string, subject:string, name:string, email:string, mode:string}
 */
function ra_sso_finish(array $get): array {
    $st = $_SESSION['sso'] ?? null;
    unset($_SESSION['sso']);                         // una volta sola
    if (!is_array($st)) throw new RuntimeException('state');
    if (!empty($get['error'])) throw new RuntimeException('denied');
    if (!hash_equals($st['state'], (string)($get['state'] ?? '')) || time() - (int)$st['t'] > 600) {
        throw new RuntimeException('state');
    }
    $code = (string)($get['code'] ?? '');
    if ($code === '') throw new RuntimeException('state');

    $provider = $st['provider'];
    $def = RA_SSO_PROVIDERS[$provider];
    $cfg = ra_sso_cfg()['providers'][$provider];
    $post = [
        'grant_type'    => 'authorization_code',
        'code'          => $code,
        'redirect_uri'  => ra_sso_redirect_uri(),
        'client_id'     => $cfg['client_id'],
        'client_secret' => $cfg['client_secret'],
    ];
    if ($def['pkce']) $post['code_verifier'] = $st['verifier'];
    $tok = ra_sso_http(ra_sso_endpoint($provider, 'token'), $post);

    $id = ['provider' => $provider, 'subject' => '', 'name' => '', 'email' => '', 'mode' => $st['mode']];

    if ($provider === 'orcid') {
        // la risposta del token contiene già l'ORCID iD e il nome; l'email di solito no
        $id['subject'] = (string)($tok['orcid'] ?? '');
        $id['name']    = trim((string)($tok['name'] ?? ''));
    } elseif ($provider === 'google') {
        $parts = explode('.', (string)($tok['id_token'] ?? ''));
        if (count($parts) !== 3) throw new RuntimeException('token');
        $claims = json_decode((string)base64_decode(strtr($parts[1], '-_', '+/')), true);
        if (!is_array($claims)) throw new RuntimeException('token');
        $iss = (string)($claims['iss'] ?? '');
        if (($claims['aud'] ?? '') !== $cfg['client_id'] || !in_array($iss, ['accounts.google.com', 'https://accounts.google.com'], true)
            || (int)($claims['exp'] ?? 0) < time() || !hash_equals($st['nonce'], (string)($claims['nonce'] ?? ''))) {
            throw new RuntimeException('token');
        }
        $id['subject'] = (string)($claims['sub'] ?? '');
        $id['name']    = trim((string)($claims['name'] ?? ''));
        if (!empty($claims['email_verified'])) $id['email'] = (string)($claims['email'] ?? '');
    } else { // github
        $auth = ['Authorization: Bearer ' . (string)($tok['access_token'] ?? '')];
        $u = ra_sso_http('https://api.github.com/user', null, $auth);
        $id['subject'] = isset($u['id']) ? (string)$u['id'] : '';
        $id['name']    = trim((string)($u['name'] ?? '')) ?: (string)($u['login'] ?? '');
        try {
            foreach (ra_sso_http('https://api.github.com/user/emails', null, $auth) as $e) {
                if (!empty($e['verified']) && !empty($e['primary'])) { $id['email'] = (string)$e['email']; break; }
            }
        } catch (Throwable $e) { /* email facoltativa */ }
    }
    if ($id['subject'] === '') throw new RuntimeException('token');
    return $id;
}
