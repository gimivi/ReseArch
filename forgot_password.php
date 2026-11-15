<?php
// forgot_password.php — richiesta del link di recupero della password (dal link "Password dimenticata?"
// di index.php). L'invio è in api/password_forgot.php; la nuova password si sceglie in reset_password.php.
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
require_once __DIR__ . '/api/i18n.php';
ra_i18n_set_research(null);
$pageTitle = t('auth.forgot.page_title');
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

            <h1 class="text-center mb-2">
                <img src="img/Logo_Research.svg" alt="<?= te('app.name') ?>" width="128" height="128" data-braille-haptics>
            </h1>
            <h2 class="h6 text-center mb-3"><?= te('auth.forgot.page_title') ?></h2>

            <p class="small"><?= te('auth.forgot.intro') ?></p>

            <form id="forgotForm" novalidate>
                <div class="mb-3">
                    <label for="email" class="form-label"><?= te('user.email') ?></label>
                    <input type="email" class="form-control" id="email" name="email" required autocomplete="email">
                </div>

                <button type="submit" class="btn btn-primary w-100" id="forgotBtn">
                    <?= te('auth.forgot.submit') ?>
                </button>

                <div class="text-center mt-3">
                    <a href="index.php"><?= te('auth.register.back_to_login') ?></a>
                </div>
            </form>

            <!-- role="alert": il messaggio viene letto subito dagli screen reader -->
            <div id="message" class="alert d-none mt-3" role="alert"></div>

            <p class="small text-body-secondary mt-3 mb-0"><?= te('auth.forgot.sso_note') ?></p>
        </div>
    </div>
</div>
</main>
<?php require __DIR__ . '/partials/a11y_footer.php'; ?>

<script>
    const form = document.getElementById('forgotForm');
    const emailEl = document.getElementById('email');
    const messageDiv = document.getElementById('message');
    const btn = document.getElementById('forgotBtn');

    function showMessage(type, text) {
        messageDiv.className = 'alert alert-' + type + ' mt-3';
        messageDiv.textContent = text;
    }
    function markInvalid(on) {
        emailEl.classList.toggle('is-invalid', on);
        if (on) { emailEl.setAttribute('aria-invalid', 'true'); emailEl.setAttribute('aria-errormessage', 'message'); emailEl.focus(); }
        else { emailEl.removeAttribute('aria-invalid'); emailEl.removeAttribute('aria-errormessage'); }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        markInvalid(false);
        messageDiv.className = 'alert d-none mt-3';
        if (emailEl.value.trim() === '') { markInvalid(true); return showMessage('danger', t('validation.fill_required')); }
        if (!emailEl.checkValidity())   { markInvalid(true); return showMessage('danger', t('validation.email_invalid')); }

        btn.disabled = true;
        btn.textContent = t('auth.forgot.submitting');
        try {
            const response = await fetch('api/password_forgot.php', { method: 'POST', body: new FormData(form) });
            const text = (await response.text()).replace(/^﻿/, '');
            let data = null;
            try { data = JSON.parse(text); } catch { /* risposta non JSON */ }
            if (!data) {
                showMessage('danger', response.ok ? t('errors.invalid_response') : t('errors.server_status', { status: response.status }));
                return;
            }
            if (data.success) {
                // stessa risposta per indirizzi registrati e no: il modulo si chiude, resta il messaggio
                form.hidden = true;
                showMessage('success', data.message);
            } else {
                showMessage('danger', data.message || t('errors.internal'));
            }
        } catch (error) {
            console.error('[forgot]', error);
            showMessage('danger', t('errors.network'));
        } finally {
            btn.disabled = false;
            btn.textContent = t('auth.forgot.submit');
        }
    });
</script>
</body>
</html>
