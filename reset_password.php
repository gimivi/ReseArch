<?php
// reset_password.php — scelta della nuova password dal link ricevuto per email (api/password_forgot.php).
// Il link si controlla qui per mostrare subito se è scaduto o già usato; il salvataggio, con un nuovo
// controllo, è in api/password_reset.php. Nel database c'è solo l'impronta SHA-256 del codice.
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
require_once __DIR__ . '/api/db.php';
require_once __DIR__ . '/api/i18n.php';
ra_i18n_set_research(null);
$pageTitle = t('auth.reset.page_title');

$token = (string)($_GET['token'] ?? '');
$state = 'invalid';   // 'ok' | 'invalid' | 'expired' | 'error'
if (preg_match('/^[0-9a-f]{64}$/', $token)) {
    try {
        $stmt = $pdo->prepare("SELECT t.used_at, (t.expires_at <= NOW()) AS expired, u.password_hash
                               FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
                               WHERE t.token_hash = :hash LIMIT 1");
        $stmt->execute([':hash' => hash('sha256', $token)]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row && $row['used_at'] === null && !empty($row['password_hash'])) {
            $state = ((int)$row['expired'] === 1) ? 'expired' : 'ok';
        }
    } catch (Throwable $e) {
        error_log('reset_password check error: ' . $e->getMessage());
        $state = 'error';
    }
}
$req = '<span aria-hidden="true"> *</span>';
?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars(ra_lang()) ?>">
<head>
<?php require __DIR__ . '/partials/head.php'; ?>
<!-- il link contiene il codice di recupero: non va passato ad altri siti -->
<meta name="referrer" content="no-referrer">
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
            <h2 class="h6 text-center mb-3"><?= te('auth.reset.page_title') ?></h2>

            <?php if ($state === 'ok'): ?>
            <p class="small"><?= te('auth.reset.intro') ?></p>
            <form id="resetForm" novalidate>
                <input type="hidden" name="token" value="<?= htmlspecialchars($token) ?>">
                <div class="mb-3">
                    <label for="password" class="form-label"><?= te('account.new_password') ?><?= $req ?></label>
                    <input type="password" class="form-control" id="password" name="password" required
                           minlength="8" autocomplete="new-password" aria-describedby="passwordHelp">
                    <div id="passwordHelp" class="form-text"><?= te('validation.password_help') ?></div>
                </div>
                <div class="mb-3">
                    <label for="confirmPassword" class="form-label"><?= te('account.confirm_new_password') ?><?= $req ?></label>
                    <input type="password" class="form-control" id="confirmPassword" name="confirm_password" required
                           autocomplete="new-password">
                </div>
                <button type="submit" class="btn btn-primary w-100" id="resetBtn"><?= te('auth.reset.submit') ?></button>
            </form>
            <div id="message" class="alert d-none mt-3" role="alert"></div>
            <div class="text-center mt-3" id="goLogin" hidden>
                <a href="index.php" class="btn btn-primary"><?= te('verify.go_login') ?></a>
            </div>
            <?php else: ?>
            <p class="mb-3" role="status">
                <?= te($state === 'expired' ? 'auth.reset.expired' : ($state === 'error' ? 'errors.internal' : 'auth.reset.invalid')) ?>
            </p>
            <div class="d-flex flex-wrap gap-2 justify-content-center">
                <a href="forgot_password.php" class="btn btn-primary"><?= te('auth.reset.new_link') ?></a>
                <a href="index.php" class="btn btn-outline-secondary"><?= te('auth.register.back_to_login') ?></a>
            </div>
            <?php endif; ?>
        </div>
    </div>
</div>
</main>
<?php require __DIR__ . '/partials/a11y_footer.php'; ?>

<?php if ($state === 'ok'): ?>
<script>
    const form = document.getElementById('resetForm');
    const messageDiv = document.getElementById('message');
    const btn = document.getElementById('resetBtn');

    function showMessage(type, text) {
        messageDiv.className = 'alert alert-' + type + ' mt-3';
        messageDiv.textContent = text;
    }
    function fail(text, ids) {
        for (const id of ids) {
            const el = document.getElementById(id);
            el.classList.add('is-invalid');
            el.setAttribute('aria-invalid', 'true');
            el.setAttribute('aria-errormessage', 'message');
        }
        showMessage('danger', text);
        if (ids.length) document.getElementById(ids[0]).focus();
    }
    function resetErrors() {
        messageDiv.className = 'alert d-none mt-3';
        for (const el of form.querySelectorAll('.is-invalid')) {
            el.classList.remove('is-invalid');
            el.removeAttribute('aria-invalid');
            el.removeAttribute('aria-errormessage');
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        resetErrors();
        const pw = document.getElementById('password').value, cp = document.getElementById('confirmPassword').value;
        if (!pw || !cp) return fail(t('validation.fill_required'), [pw ? 'confirmPassword' : 'password']);
        if (pw.length < 8) return fail(t('validation.password_short'), ['password']);
        if (pw !== cp) return fail(t('validation.password_mismatch'), ['confirmPassword']);

        btn.disabled = true;
        btn.textContent = t('auth.reset.submitting');
        try {
            const response = await fetch('api/password_reset.php', { method: 'POST', body: new FormData(form) });
            const text = (await response.text()).replace(/^﻿/, '');
            let data = null;
            try { data = JSON.parse(text); } catch { /* risposta non JSON */ }
            if (!data) {
                showMessage('danger', response.ok ? t('errors.invalid_response') : t('errors.server_status', { status: response.status }));
                return;
            }
            if (data.success) {
                form.hidden = true;
                showMessage('success', data.message);
                document.getElementById('goLogin').hidden = false;
            } else {
                showMessage('danger', data.message || t('errors.internal'));
            }
        } catch (error) {
            console.error('[reset]', error);
            showMessage('danger', t('errors.network'));
        } finally {
            btn.disabled = false;
            btn.textContent = t('auth.reset.submit');
        }
    });
</script>
<?php endif; ?>
</body>
</html>
