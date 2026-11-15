<?php
// api/i18n.php
// Lingue dell'interfaccia (_doc/arch-i18n-a11y.md §2).
//
// Cataloghi in lang/: <lingua>.json (es. it.json, en.json) e, per i vocabolari dei
// profili, <lingua>@<profilo>.json con le sole frasi che cambiano (§2.6).
// Ordine di ricerca di una chiave: lingua@profilo → lingua → it@profilo → it → la chiave stessa.
//
/*
 * Uso nelle pagine (in un commento a blocco: dentro un commento // la sequenza di chiusura
 * del PHP chiuderebbe davvero il codice):
 *   require_once __DIR__ . '/api/i18n.php';
 *   nel tag html:  lang = echo ra_lang()
 *   nel <head>:    echo ra_i18n_head()
 *   nell'HTML:     echo te('common.save')   (testo già protetto per HTML)
 */
//
// La lingua: users.user_lang → cookie ra_lang → Accept-Language del browser → it.
// Il profilo: res_profile della ricerca in sessione → 'default_profile' di cfg_ini → research.

const RA_I18N_SOURCE_LANG = 'it';
const RA_I18N_COOKIE      = 'ra_lang';

/** Cartella dei cataloghi. */
function ra_i18n_dir(): string {
    return dirname(__DIR__) . '/lang';
}

/** Lingue disponibili: [codice => nome nella propria lingua], lette dai file lang/xx.json. */
function ra_langs(): array {
    static $langs = null;
    if ($langs !== null) return $langs;
    $langs = [];
    foreach (glob(ra_i18n_dir() . '/*.json') ?: [] as $file) {
        $code = basename($file, '.json');
        if (!preg_match('/^[a-z]{2,3}(-[A-Z]{2})?$/', $code)) continue;   // esclude i file @profilo
        $dict = ra_i18n_read($code);
        $langs[$code] = $dict['lang.name'] ?? $code;
    }
    ksort($langs);
    return $langs;
}

/** Nome breve di una lingua nella propria lingua (lang.short del suo catalogo: Ita, Eng). */
function ra_lang_short(string $code): string {
    $dict = ra_i18n_read($code);
    return $dict['lang.short'] ?? mb_substr($dict['lang.name'] ?? $code, 0, 3);
}

/** true se il codice corrisponde a un catalogo presente. */
function ra_lang_valid(?string $code): bool {
    return is_string($code) && $code !== '' && isset(ra_langs()[$code]);
}

/** Lingua dell'interfaccia per la richiesta corrente. */
function ra_lang(): string {
    static $lang = null;
    if ($lang !== null) return $lang;

    $candidates = [];
    if (isset($_SESSION['user']['user_lang'])) $candidates[] = $_SESSION['user']['user_lang'];
    if (isset($_COOKIE[RA_I18N_COOKIE]))        $candidates[] = $_COOKIE[RA_I18N_COOKIE];
    foreach (explode(',', $_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '') as $part) {
        $tag = trim(explode(';', $part)[0]);
        if ($tag === '' || $tag === '*') continue;
        [$base, $region] = array_pad(explode('-', $tag, 2), 2, '');
        $base = strtolower($base);
        if ($region !== '') $candidates[] = $base . '-' . strtoupper($region);   // es. pt-BR
        $candidates[] = $base;
    }
    foreach ($candidates as $c) {
        if (ra_lang_valid($c)) return $lang = $c;
    }
    return $lang = RA_I18N_SOURCE_LANG;
}

/**
 * Ricerca di riferimento per il profilo. Predefinita: $_SESSION['research'].
 * Le pagine fuori da una ricerca (es. researches.php, dove in sessione può restare l'ultima
 * ricerca aperta) chiamano ra_i18n_set_research(null) prima di ra_i18n_head().
 */
function ra_i18n_set_research(?array $research = null, bool $set = true): ?array {
    static $override = false, $value = null;
    if ($set) { $override = true; $value = $research; }
    return $override ? $value : ($_SESSION['research'] ?? null);
}

/** Profilo del vocabolario (§2.6): quello della ricerca aperta, altrimenti quello dell'installazione. */
function ra_profile(): string {
    $research = ra_i18n_set_research(null, false);
    $p = is_array($research) ? ($research['res_profile'] ?? null) : null;
    if (!is_string($p) || $p === '') {
        static $cfgProfile = null;
        if ($cfgProfile === null) {
            $cfg = @include dirname(__DIR__) . '/cfg/cfg_ini.php';
            $cfgProfile = (is_array($cfg) && !empty($cfg['default_profile'])) ? (string)$cfg['default_profile'] : 'research';
        }
        $p = $cfgProfile;
    }
    return preg_match('/^[a-z0-9_-]{1,32}$/', $p) ? $p : 'research';
}

/** Legge un catalogo (file assente o non valido = array vuoto). */
function ra_i18n_read(string $name): array {
    static $cache = [];
    if (isset($cache[$name])) return $cache[$name];
    $file = ra_i18n_dir() . '/' . $name . '.json';
    $data = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    return $cache[$name] = is_array($data) ? $data : [];
}

/** Dizionario completo per lingua e profilo correnti, già unito secondo l'ordine di ricerca. */
function ra_i18n_dict(): array {
    static $dict = null;
    if ($dict !== null) return $dict;
    $lang    = ra_lang();
    $profile = ra_profile();
    $dict = ra_i18n_read(RA_I18N_SOURCE_LANG);
    $dict = array_merge($dict, ra_i18n_read(RA_I18N_SOURCE_LANG . '@' . $profile));
    if ($lang !== RA_I18N_SOURCE_LANG) {
        $dict = array_merge($dict, ra_i18n_read($lang), ra_i18n_read($lang . '@' . $profile));
    }
    return $dict;
}

/**
 * Testo per una chiave. $params sostituisce i segnaposto {nome}.
 * Plurali: se esiste 'chiave.one' / 'chiave.other' e $params['n'] è un numero, sceglie la forma
 * (regola semplice n == 1, valida per italiano e inglese; il client usa Intl.PluralRules).
 */
function t(string $key, array $params = []): string {
    $dict = ra_i18n_dict();
    $text = $dict[$key] ?? null;
    if ($text === null && isset($params['n']) && is_numeric($params['n'])) {
        $form = ((float)$params['n'] == 1) ? 'one' : 'other';
        $text = $dict[$key . '.' . $form] ?? $dict[$key . '.other'] ?? null;
    }
    if ($text === null) return $key;
    foreach ($params as $k => $v) {
        $text = str_replace('{' . $k . '}', (string)$v, $text);
    }
    return $text;
}

/** Come t(), protetto per HTML (testo e attributi). */
function te(string $key, array $params = []): string {
    return htmlspecialchars(t($key, $params), ENT_QUOTES, 'UTF-8');
}

/**
 * Blocco da mettere nel <head>: dati per il client (window.RA_I18N) + js/i18n.js,
 * che definisce window.t / window.te prima di qualunque altro script della pagina.
 */
function ra_i18n_head(string $baseUrl = ''): string {
    $data = [
        'lang'    => ra_lang(),
        'profile' => ra_profile(),
        'langs'   => ra_langs(),
        'dict'    => ra_i18n_dict(),
    ];
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP);
    $src  = htmlspecialchars($baseUrl . 'js/i18n.js', ENT_QUOTES, 'UTF-8');
    return "<script>window.RA_I18N = {$json};</script>\n    <script src=\"{$src}\"></script>\n";
}
