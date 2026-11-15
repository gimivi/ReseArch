<?php
/*
 * partials/login_bg.php — sfondo generativo delle pagine pubbliche di accesso
 * (index.php, register.php, forgot_password.php, reset_password.php, verify_email.php).
 * Va incluso subito dopo <body class="bg-light">. Richiede api/i18n.php già incluso.
 *
 *  - lo script iniziale passa il body da bg-light a ra-login-bg (fondo #444, piede scuro: css/ReseArch.css);
 *    senza JavaScript resta il grigio chiaro di bg-light;
 *  - window.raLoginTexture(): riserva se lo sfondo non parte (niente WebGL, CDN irraggiungibile),
 *    una texture classica a caso fra img/texture/LoginPage/1-4.jpg (512x512, a piastrelle);
 *  - livello del pattern (il generatore si sceglie con data-generator, vedi js/login-bg/login-bg.mjs);
 *  - icone nel piede, a destra: scarica il modello (un triangolo, OBJ) e articolo sulla logica di generazione;
 *    restano nascoste finché il generatore non è partito; href e tooltip dell'articolo vengono dal generatore;
 *  - importmap di Three.js (stessa versione della dashboard) e moduli;
 *  - lente e vibrazione sul braille del logo: js/logo-braille.mjs, per le immagini con data-braille-haptics.
 */
?>
<script>
    document.body.classList.remove('bg-light');
    document.body.classList.add('ra-login-bg');
    window.raLoginTexture = function () {
        ['raLoginBg', 'raBgTools'].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); });
        var b = document.body;
        b.classList.remove('ra-login-bg');
        b.classList.add('bg-light');
        var n = 1 + Math.floor(Math.random() * 4);
        b.style.backgroundImage  = "url('img/texture/LoginPage/" + n + ".jpg')";
        b.style.backgroundRepeat = 'repeat';
        b.style.backgroundSize   = '512px 512px';
    };
</script>
<div id="raLoginBg" class="ra-login-bg-layer" data-generator="triangoli" aria-hidden="true"><canvas></canvas></div>
<div id="raBgTools" class="ra-bg-tools" hidden>
    <button type="button" id="raBgDownload" class="ra-bg-tool"
            aria-label="<?= te('auth.login.bg_download') ?>" title="<?= te('auth.login.bg_download') ?>">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z"/></svg>
    </button>
    <a id="raBgPaper" class="ra-bg-tool" href="#" target="_blank" rel="noopener"
       aria-label="<?= te('auth.login.bg_paper') ?>">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M5 10.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5"/><path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-1h1v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v1H1V2a2 2 0 0 1 2-2"/><path d="M1 5v-.5a.5.5 0 0 1 1 0V5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0V8h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0v.5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1z"/></svg>
    </a>
</div>
<script type="importmap">
{ "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"
} }
</script>
<script type="module" src="js/login-bg/login-bg.mjs" onerror="raLoginTexture()"></script>
<script type="module" src="js/logo-braille.mjs"></script>
