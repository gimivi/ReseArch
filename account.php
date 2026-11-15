<?php
// account.php — impostazioni dell'account (era account.html; fase 1 di _doc/arch-i18n-a11y.md)
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
// Senza login non c'è nulla da mostrare
if (!isset($_SESSION['user']) || !is_array($_SESSION['user'])) {
    header('Location: index.php');
    exit;
}
// Gli ospiti (account esterno, non in users: _doc/arch-sso-ospiti.md) non hanno un account da modificare
if (!empty($_SESSION['user']['guest'])) {
    header('Location: researches.php');
    exit;
}
require_once __DIR__ . '/api/i18n.php';
ra_i18n_set_research(null);
$pageTitle = t('account.page_title');

// Account esterni collegati (passo 3 di _doc/arch-sso-ospiti.md): elenco, Collega, Scollega
require_once __DIR__ . '/api/db.php';
require_once __DIR__ . '/api/sso_lib.php';
$ssoEnabled = ra_sso_enabled();
$ssoLinked = [];
try {
    $st = $pdo->prepare("SELECT provider, email, display_name, linked_at, last_login_at
                         FROM users_identities WHERE user_id = ? ORDER BY provider");
    $st->execute([(int)$_SESSION['user']['id']]);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $ssoLinked[$r['provider']] = $r;
} catch (Throwable $e) {
    // tabella non ancora creata (sql/migration_sso_guests.sql): la sezione resta vuota
}
$ssoImpersonating = isset($_SESSION['impersonator']);
$ssoMsg = ($_GET['sso'] ?? '') === 'linked' ? 'linked' : '';
$ssoErr = preg_replace('/[^a-z_]/', '', (string)($_GET['sso_error'] ?? ''));
$ssoErrKey = in_array($ssoErr, ['taken', 'impersonating'], true) ? "account.sso.err.$ssoErr"
           : (in_array($ssoErr, ['provider', 'state', 'denied', 'token', 'provider_error'], true) ? "auth.sso.err.$ssoErr" : '');
?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars(ra_lang()) ?>">
<head>
<?php require __DIR__ . '/partials/head.php'; ?>
</head>
<body class="bg-light">

<main class="flex-grow-1 d-flex">
<div class="container d-flex align-items-center justify-content-center py-4">
  <div class="card shadow-sm position-relative" style="max-width: 520px; width: 100%;">
    <div class="card-body">

      <?php $raLangFloat = true; require __DIR__ . '/partials/lang_switch.php'; ?>

      <h1 class="text-center mb-2">
        <img src="img/Logo_Research.svg" alt="<?= te('app.name') ?>" width="128" height="128">
      </h1>
      <h2 class="h6 text-center mb-3"><?= te('account.page_title') ?></h2>

      <form id="accountForm" novalidate>

        <div class="mb-3">
          <label class="form-label" for="firstName"><?= te('user.first_name') ?></label>
          <input class="form-control" id="firstName" name="first_name" autocomplete="given-name">
        </div>

        <div class="mb-3">
          <label class="form-label" for="lastName"><?= te('user.last_name') ?></label>
          <input class="form-control" id="lastName" name="last_name" autocomplete="family-name">
        </div>

        <div class="mb-3">
          <label class="form-label" for="userName"><?= te('user.username') ?></label>
          <input class="form-control" id="userName" name="user_name" autocomplete="username">
        </div>

        <fieldset class="border-top pt-3 mt-4">
          <legend class="h6"><?= te('account.change_email') ?></legend>

          <div class="mb-3">
            <label class="form-label" for="newEmail"><?= te('account.new_email') ?></label>
            <input type="email" class="form-control" id="newEmail" name="new_email" autocomplete="email"
                   aria-describedby="emailWarning">
          </div>

          <div class="mb-3">
            <label class="form-label" for="confirmNewEmail"><?= te('account.confirm_new_email') ?></label>
            <input type="email" class="form-control" id="confirmNewEmail" name="confirm_new_email" autocomplete="off">
          </div>

          <div class="alert alert-warning py-2" id="emailWarning">
            <?= te('account.email_warning') ?>
          </div>
        </fieldset>

        <fieldset class="border-top pt-3 mt-4">
          <legend class="h6"><?= te('account.change_password') ?></legend>

          <div class="mb-3">
            <label class="form-label" for="newPassword"><?= te('account.new_password') ?></label>
            <input type="password" class="form-control" id="newPassword" name="new_password" autocomplete="new-password"
                   minlength="8" aria-describedby="newPasswordHelp">
            <div id="newPasswordHelp" class="form-text"><?= te('validation.password_help') ?></div>
          </div>

          <div class="mb-3">
            <label class="form-label" for="confirmNewPassword"><?= te('account.confirm_new_password') ?></label>
            <input type="password" class="form-control" id="confirmNewPassword" name="confirm_new_password" autocomplete="new-password">
          </div>
        </fieldset>

        <fieldset class="border-top pt-3 mt-4">
          <legend class="h6"><?= te('account.confirm_changes') ?></legend>
          <div class="mb-3">
            <label class="form-label" for="currentPassword"><?= te('account.current_password') ?></label>
            <input type="password" class="form-control" id="currentPassword" name="current_password"
                   autocomplete="current-password" aria-describedby="currentPasswordHelp">
            <div id="currentPasswordHelp" class="form-text"><?= te('account.current_password_help') ?></div>
          </div>
        </fieldset>

        <button type="submit" class="btn btn-primary w-100" id="saveBtn">
          <?= te('account.submit') ?>
        </button>

        <div class="text-center mt-3">
          <a href="researches.php"><?= te('common.back') ?></a>
        </div>
      </form>

      <div id="message" class="alert d-none mt-3" role="alert"></div>

      <?php if ($ssoEnabled || $ssoLinked): ?>
      <!-- Account esterni collegati: entrare anche con ORCID / Google / GitHub (_doc/arch-sso-ospiti.md §3.2) -->
      <section class="border-top pt-3 mt-4" aria-labelledby="ssoTitle">
        <h2 class="h6" id="ssoTitle"><?= te('account.sso.title') ?></h2>
        <p class="small text-secondary"><?= te('account.sso.intro') ?></p>

        <?php if ($ssoMsg): ?><div class="alert alert-success py-2" role="status"><?= te('account.sso.linked') ?></div><?php endif; ?>
        <?php if ($ssoErrKey): ?><div class="alert alert-danger py-2" role="alert"><?= te($ssoErrKey) ?></div><?php endif; ?>
        <?php if ($ssoImpersonating): ?><div class="alert alert-warning py-2" role="note"><?= te('account.sso.err.impersonating') ?></div><?php endif; ?>

        <ul class="list-group mb-2" id="ssoList">
          <?php foreach (RA_SSO_PROVIDERS as $pKey => $pDef):
                $lnk = $ssoLinked[$pKey] ?? null;
                if (!$lnk && !isset($ssoEnabled[$pKey])) continue; ?>
            <li class="list-group-item d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold" style="min-width: 5.5rem;"><?= htmlspecialchars($pDef['label']) ?></span>
              <?php if ($lnk): ?>
                <span class="small flex-grow-1">
                  <?= te('account.sso.linked_as', ['name' => $lnk['display_name'] ?: ($lnk['email'] ?: '—')]) ?>
                  <?php if (!empty($lnk['last_login_at'])): ?><br><span class="text-secondary"><?= te('account.sso.last_login', ['date' => substr((string)$lnk['last_login_at'], 0, 16)]) ?></span><?php endif; ?>
                </span>
                <?php if (!$ssoImpersonating): ?>
                  <button type="button" class="btn btn-sm btn-outline-danger sso-unlink" data-provider="<?= htmlspecialchars($pKey) ?>"
                          data-label="<?= htmlspecialchars($pDef['label']) ?>"><?= te('account.sso.unlink') ?></button>
                <?php endif; ?>
              <?php else: ?>
                <span class="small text-secondary flex-grow-1"><?= te('account.sso.not_linked') ?></span>
                <?php if (!$ssoImpersonating): ?>
                  <a class="btn btn-sm btn-outline-primary" href="api/sso_start.php?provider=<?= htmlspecialchars($pKey) ?>&amp;mode=link"><?= te('account.sso.link', ['provider' => $pDef['label']]) ?></a>
                <?php endif; ?>
              <?php endif; ?>
            </li>
          <?php endforeach; ?>
        </ul>
        <div id="ssoStatus" class="small" role="status" aria-live="polite"></div>
      </section>
      <?php endif; ?>

    </div>
  </div>
</div>
</main>
<?php require __DIR__ . '/partials/a11y_footer.php'; ?>

<script>
  // Scollega un account esterno (api/sso_identities.php), poi ricarica la pagina
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('.sso-unlink');
    if (!b) return;
    if (!confirm(t('account.sso.confirm_unlink', { provider: b.dataset.label }))) return;
    const st = document.getElementById('ssoStatus');
    b.disabled = true;
    try {
      const r = await fetch('api/sso_identities.php', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink', provider: b.dataset.provider }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || t('errors.server_status', { status: r.status }));
      location.replace('account.php');
    } catch (e) {
      st.className = 'small text-danger';
      st.textContent = e.message || String(e);
      b.disabled = false;
    }
  });

  const form = document.getElementById('accountForm');
  const msg  = document.getElementById('message');
  const btn  = document.getElementById('saveBtn');
  const $    = (id) => document.getElementById(id);

  function showMessage(type, text) {
    msg.className = 'alert alert-' + type + ' mt-3';
    msg.textContent = text;
  }

  function fail(text, fieldIds) {
    for (const id of fieldIds) {
      $(id).classList.add('is-invalid');
      $(id).setAttribute('aria-invalid', 'true');
      $(id).setAttribute('aria-errormessage', 'message');
    }
    showMessage('danger', text);
    if (fieldIds.length) $(fieldIds[0]).focus();
  }

  function resetErrors() {
    msg.className = 'alert d-none mt-3';
    msg.textContent = '';
    for (const el of form.querySelectorAll('.is-invalid')) {
      el.classList.remove('is-invalid');
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-errormessage');
    }
  }

  async function postJson(url, options) {
    const r = await fetch(url, options);
    const text = (await r.text()).replace(/^﻿/, '');
    let data = null;
    try { data = JSON.parse(text); } catch { /* risposta non JSON */ }
    return { r, data };
  }

  async function loadMe() {
    try {
      const { data } = await postJson('api/me.php', { method: 'GET' });
      if (!data || !data.success) throw new Error(data?.message || 'me');
      const u = data.user || {};
      $('firstName').value = u.first_name || '';
      $('lastName').value  = u.last_name  || '';
      $('userName').value  = u.user_name  || '';
    } catch (e) {
      showMessage('danger', t('account.session_invalid'));
      setTimeout(() => location.href = 'index.php', 1500);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    resetErrors();

    const newEmail = $('newEmail').value.trim();
    const cEmail   = $('confirmNewEmail').value.trim();
    if (newEmail || cEmail) {
      if (!newEmail || !cEmail) return fail(t('account.fill_both_emails'), [newEmail ? 'confirmNewEmail' : 'newEmail']);
      if (!$('newEmail').checkValidity()) return fail(t('validation.email_invalid'), ['newEmail']);
      if (newEmail !== cEmail) return fail(t('validation.email_mismatch'), ['confirmNewEmail']);
    }

    const np = $('newPassword').value;
    const cp = $('confirmNewPassword').value;
    if (np || cp) {
      if (!np || !cp) return fail(t('account.fill_both_passwords'), [np ? 'confirmNewPassword' : 'newPassword']);
      if (np.length < 8) return fail(t('validation.password_short'), ['newPassword']);
      if (np !== cp) return fail(t('validation.password_mismatch'), ['confirmNewPassword']);
    }

    if ((newEmail || np) && !$('currentPassword').value) {
      return fail(t('account.need_current_password'), ['currentPassword']);
    }

    btn.disabled = true;
    btn.textContent = t('common.saving');

    try {
      const { r, data } = await postJson('api/update_profile.php', { method: 'POST', body: new FormData(form) });
      if (!data) {
        showMessage('danger', r.ok ? t('errors.invalid_response') : t('errors.server_status', { status: r.status }));
        return;
      }

      if (data.success) {
        showMessage('success', data.message || t('account.saved'));

        // Email cambiata: l'API chiude la sessione, si torna all'accesso
        if (data.email_changed) {
          setTimeout(() => location.href = 'index.php', 2500);
          return;
        }

        // Pulisce i campi sensibili
        for (const id of ['currentPassword', 'newPassword', 'confirmNewPassword', 'newEmail', 'confirmNewEmail']) $(id).value = '';
      } else {
        showMessage('danger', data.message || t('account.update_failed'));
      }
    } catch (err) {
      console.error('[account]', err);
      showMessage('danger', t('errors.network'));
    } finally {
      btn.disabled = false;
      btn.textContent = t('account.submit');
    }
  });

  loadMe();
</script>

</body>
</html>
