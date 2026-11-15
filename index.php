<?php
// index.php — pagina di accesso (era index.html; fase 1 di _doc/arch-i18n-a11y.md)
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
require_once __DIR__ . '/api/i18n.php';
ra_i18n_set_research(null);   // fuori da una ricerca: profilo dell'installazione
$pageTitle = t('auth.login.page_title');
// Accesso con account esterni (_doc/arch-sso-ospiti.md): solo i fornitori configurati in cfg/cfg_sso.php
require_once __DIR__ . '/api/sso_lib.php';
$ssoProviders = ra_sso_enabled();
$ssoError = preg_replace('/[^a-z_]/', '', (string)($_GET['sso_error'] ?? ''));
$ssoErrors = ['provider', 'state', 'denied', 'token', 'provider_error', 'not_verified', 'no_account', 'taken'];
?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars(ra_lang()) ?>">
<head>
<?php require __DIR__ . '/partials/head.php'; ?>
</head>
<body class="bg-light">
<?php require __DIR__ . '/partials/login_bg.php'; // sfondo generativo, icone, lente braille ?>

<main class="flex-grow-1 d-flex">
<div class="container d-flex align-items-center justify-content-center py-4">
    <div class="card shadow-sm position-relative" style="max-width: 400px; width: 100%;">
        <div class="card-body">

            <?php $raLangFloat = true; require __DIR__ . '/partials/lang_switch.php'; ?>

            <!-- Logo + nome della piattaforma (il logo è decorativo: il nome è già nel titolo) -->
            <h1 class="text-center mb-2">
                <img src="img/Logo_Research.svg" alt="<?= te('app.name') ?>" width="128" height="128" data-braille-haptics>
            </h1>
            <h2 class="h6 text-center mb-3"><?= te('auth.login.page_title') ?></h2>

            <form id="loginForm">
                <div class="mb-3">
                    <label for="username" class="form-label"><?= te('auth.login.username') ?></label>
                    <input type="text" class="form-control" id="username" name="username"
                           required autocomplete="username">
                </div>

                <div class="mb-3">
                    <label for="password" class="form-label"><?= te('user.password') ?></label>
                    <input type="password" class="form-control" id="password" name="password"
                           required autocomplete="current-password">
                    <div class="text-end mt-1">
                        <a href="forgot_password.php" class="small"><?= te('auth.forgot.link') ?></a>
                    </div>
                </div>

                <button type="submit" class="btn btn-primary w-100" id="loginBtn">
                    <?= te('auth.login.submit') ?>
                </button>

                <div class="text-center mt-3">
                    <a href="register.php" id="createAccountLink"><?= te('auth.login.create_account') ?></a>
                </div>
            </form>

            <?php if ($ssoProviders): ?>
            <!-- Accesso con account esterni: membri con l'account collegato, oppure ospiti -->
            <div class="mt-4 pt-3 border-top" role="group" aria-labelledby="ssoTitle">
                <p class="small fw-semibold mb-2" id="ssoTitle"><?= te('auth.sso.title') ?></p>
                <!-- in riga, marchio + nome; nome accessibile completo ("Accedi con Google") -->
                <div class="d-flex flex-wrap gap-2">
                    <?php foreach ($ssoProviders as $pKey => $pLabel): ?>
                        <a class="btn btn-outline-secondary flex-fill d-inline-flex align-items-center justify-content-center gap-2 px-2"
                           href="api/sso_start.php?provider=<?= htmlspecialchars($pKey) ?>"
                           aria-label="<?= te('auth.sso.with', ['provider' => $pLabel]) ?>"
                           title="<?= te('auth.sso.with', ['provider' => $pLabel]) ?>"
                           style="min-height: var(--ra-touch-min); min-width: 6.5rem;">
                            <?= ra_sso_icon($pKey) ?><span><?= htmlspecialchars($pLabel) ?></span>
                        </a>
                    <?php endforeach; ?>
                </div>
                <?php if (ra_sso_guests_enabled()): ?>
                    <p class="small text-secondary mt-2 mb-0"><?= te('auth.sso.guest_note') ?>
                        <a href="privacy.php"><?= te('auth.sso.privacy_link') ?></a></p>
                <?php endif; ?>
            </div>
            <?php endif; ?>

            <?php if ($ssoError !== '' && in_array($ssoError, $ssoErrors, true)): ?>
                <div class="alert alert-danger mt-3" role="alert"><?= te('auth.sso.err.' . $ssoError) ?></div>
            <?php endif; ?>

            <!-- Messaggi: role="alert" li fa leggere subito dagli screen reader -->
            <div id="message" class="alert d-none mt-3" role="alert"></div>

        </div>
    </div>
</div>
</main>
<?php require __DIR__ . '/partials/a11y_footer.php'; ?>

<script>
    const form = document.getElementById('loginForm');
    const messageDiv = document.getElementById('message');
    const loginBtn = document.getElementById('loginBtn');

    function showMessage(type, text) {
        messageDiv.className = 'alert alert-' + type + ' mt-3';
        messageDiv.textContent = text;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        loginBtn.disabled = true;
        loginBtn.textContent = t('auth.login.submitting');
        messageDiv.className = 'alert d-none mt-3';
        messageDiv.textContent = '';

        try {
            const response = await fetch('api/login.php', { method: 'POST', body: new FormData(form) });
            const text = (await response.text()).replace(/^﻿/, '');   // toglie un eventuale BOM

            let data = null;
            try { data = JSON.parse(text); } catch { /* risposta non JSON */ }

            if (!data) {
                showMessage('danger', response.ok ? t('errors.invalid_response') : t('errors.server_status', { status: response.status }));
                return;
            }

            if (data.success) {
                showMessage('success', data.message || t('auth.login.success'));
                setTimeout(() => { window.location.href = 'researches.php'; }, 1200);
            } else {
                showMessage('danger', data.message || t('auth.login.bad_credentials'));
                document.getElementById('password').focus();
            }
        } catch (error) {
            console.error('[login]', error);
            showMessage('danger', t('errors.network'));
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = t('auth.login.submit');
        }
    });
</script>

</body>
</html>
