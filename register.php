<?php
// register.php — creazione di un account (era register.html; fase 1 di _doc/arch-i18n-a11y.md)
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
require_once __DIR__ . '/api/i18n.php';
ra_i18n_set_research(null);
$pageTitle = t('auth.register.page_title');
$req = '<span aria-hidden="true"> *</span>';   // segno visivo; il campo ha anche l'attributo required
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
            <h2 class="h6 text-center mb-3"><?= te('auth.register.page_title') ?></h2>

            <p class="small text-body-secondary"><?= te('common.required_note') ?></p>

            <form id="registerForm" novalidate>
                <div class="mb-3">
                    <label for="firstName" class="form-label"><?= te('user.first_name') ?></label>
                    <input type="text" class="form-control" id="firstName" name="first_name" autocomplete="given-name">
                </div>

                <div class="mb-3">
                    <label for="lastName" class="form-label"><?= te('user.last_name') ?></label>
                    <input type="text" class="form-control" id="lastName" name="last_name" autocomplete="family-name">
                </div>

                <div class="mb-3">
                    <label for="username" class="form-label"><?= te('user.username') ?></label>
                    <input type="text" class="form-control" id="username" name="user_name" autocomplete="username">
                </div>

                <div class="mb-3">
                    <label for="email" class="form-label"><?= te('user.email') ?><?= $req ?></label>
                    <input type="email" class="form-control" id="email" name="email" required autocomplete="email">
                </div>

                <div class="mb-3">
                    <label for="confirmEmail" class="form-label"><?= te('auth.register.confirm_email') ?><?= $req ?></label>
                    <input type="email" class="form-control" id="confirmEmail" name="confirm_email" required autocomplete="off">
                </div>

                <div class="mb-3">
                    <label for="password" class="form-label"><?= te('user.password') ?><?= $req ?></label>
                    <input type="password" class="form-control" id="password" name="password" required
                           minlength="8" autocomplete="new-password" aria-describedby="passwordHelp">
                    <div id="passwordHelp" class="form-text"><?= te('validation.password_help') ?></div>
                </div>

                <div class="mb-3">
                    <label for="confirmPassword" class="form-label"><?= te('auth.register.confirm_password') ?><?= $req ?></label>
                    <input type="password" class="form-control" id="confirmPassword" name="confirm_password" required
                           autocomplete="new-password">
                </div>

                <button type="submit" class="btn btn-primary w-100" id="registerBtn">
                    <?= te('auth.register.submit') ?>
                </button>

                <div class="text-center mt-3">
                    <a href="index.php"><?= te('auth.register.back_to_login') ?></a>
                </div>
            </form>

            <div id="message" class="alert d-none mt-3" role="alert"></div>

        </div>
    </div>
</div>
</main>
<?php require __DIR__ . '/partials/a11y_footer.php'; ?>

<!-- Conferma della registrazione: niente redirect a tempo, l'utente deve leggere il messaggio
     (email di verifica + cartella Spam) e cliccare per proseguire. -->
<div class="modal fade" id="registrationModal" tabindex="-1"
     aria-labelledby="registrationModalLabel" aria-describedby="registrationModalText" aria-hidden="true"
     data-bs-backdrop="static" data-bs-keyboard="false">
    <div class="modal-dialog modal-fullscreen-md-down modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title h5" id="registrationModalLabel"><?= te('auth.register.success_title') ?></h2>
            </div>
            <div class="modal-body">
                <p id="registrationModalText" class="mb-0"></p>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-primary" id="registrationModalOk"><?= te('auth.register.understood') ?></button>
            </div>
        </div>
    </div>
</div>

<script
    src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
    integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz"
    crossorigin="anonymous"
></script>

<script>
    const form = document.getElementById('registerForm');
    const messageDiv = document.getElementById('message');
    const registerBtn = document.getElementById('registerBtn');
    const registrationModal = new bootstrap.Modal(document.getElementById('registrationModal'));
    const registrationModalText = document.getElementById('registrationModalText');

    document.getElementById('registrationModalOk').addEventListener('click', () => {
        window.location.href = 'index.php';
    });

    function showMessage(type, text) {
        messageDiv.className = 'alert alert-' + type + ' mt-3';
        messageDiv.textContent = text;
    }

    /** Segna i campi non validi (aria-invalid + stile Bootstrap), mostra l'errore e porta il focus sul primo. */
    function fail(text, fieldIds) {
        for (const id of fieldIds) {
            const el = document.getElementById(id);
            el.classList.add('is-invalid');
            el.setAttribute('aria-invalid', 'true');
            el.setAttribute('aria-errormessage', 'message');
        }
        showMessage('danger', text);
        if (fieldIds.length) document.getElementById(fieldIds[0]).focus();
    }

    function resetErrors() {
        messageDiv.className = 'alert d-none mt-3';
        messageDiv.textContent = '';
        for (const el of form.querySelectorAll('.is-invalid')) {
            el.classList.remove('is-invalid');
            el.removeAttribute('aria-invalid');
            el.removeAttribute('aria-errormessage');
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        resetErrors();

        const val = (id) => document.getElementById(id).value;
        const empty = ['email', 'confirmEmail', 'password', 'confirmPassword'].filter(id => val(id).trim() === '');
        if (empty.length) return fail(t('validation.fill_required'), empty);
        if (!document.getElementById('email').checkValidity()) return fail(t('validation.email_invalid'), ['email']);
        if (val('email').trim() !== val('confirmEmail').trim()) return fail(t('validation.email_mismatch'), ['confirmEmail']);
        if (val('password').length < 8) return fail(t('validation.password_short'), ['password']);
        if (val('password') !== val('confirmPassword')) return fail(t('validation.password_mismatch'), ['confirmPassword']);

        registerBtn.disabled = true;
        registerBtn.textContent = t('auth.register.submitting');

        try {
            const response = await fetch('api/register.php', { method: 'POST', body: new FormData(form) });
            const text = (await response.text()).replace(/^﻿/, '');

            let data = null;
            try { data = JSON.parse(text); } catch { /* risposta non JSON */ }

            if (!data) {
                showMessage('danger', response.ok ? t('errors.invalid_response') : t('errors.server_status', { status: response.status }));
                return;
            }

            if (data.success) {
                registrationModalText.textContent = data.message || t('auth.register.success');
                registrationModal.show();
            } else {
                showMessage('danger', data.message || t('auth.register.failed'));
            }
        } catch (error) {
            console.error('[register]', error);
            showMessage('danger', t('errors.network'));
        } finally {
            registerBtn.disabled = false;
            registerBtn.textContent = t('auth.register.submit');
        }
    });
</script>

</body>
</html>
