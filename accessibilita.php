<?php
// accessibilita.php — accessibilità della piattaforma (fase 7 di _doc/arch-i18n-a11y.md):
// rimando alla dichiarazione AgID, contenuti non accessibili, modulo di segnalazione
// (meccanismo di feedback obbligatorio, anche senza login) e procedura di attuazione.
// L'amministratore vede in fondo l'elenco delle segnalazioni (api/a11y_feedback.php).
// Raggiungibile dal footer di tutte le pagine (ui/foother.php, partials/a11y_footer.php).
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
require_once __DIR__ . '/api/i18n.php';
ra_i18n_set_research(null);
// File della singola installazione (escluso da git); senza, il modello vuoto
$a11yCfg   = require __DIR__ . (is_file(__DIR__ . '/cfg/cfg_accessibility.php') ? '/cfg/cfg_accessibility.php' : '/cfg/cfg_accessibility.example.php');
$pageTitle = t('a11y.page.title');
$isAdmin   = (($_SESSION['user']['user_type'] ?? '') === 'X');
$fromPage  = mb_substr((string)($_GET['from'] ?? ''), 0, 200);   // pagina da cui si arriva (precompila il modulo)
?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars(ra_lang()) ?>">
<head>
<?php require __DIR__ . '/partials/head.php'; ?>
</head>
<body class="bg-light">
<main id="main-content">
<div class="container py-4" style="max-width: 820px;">

    <?php require __DIR__ . '/partials/lang_switch.php'; ?>

    <p class="mb-2"><a href="<?= isset($_SESSION['user']) ? 'researches.php' : 'index.php' ?>"><?= te('a11y.page.back') ?></a></p>

    <h1 class="h3 mb-3"><?= te('a11y.page.title') ?></h1>
    <p><?= te('a11y.page.intro') ?></p>

    <section class="mb-4" aria-labelledby="a11yDeclTitle">
        <h2 class="h5" id="a11yDeclTitle"><?= te('a11y.decl.title') ?></h2>
        <?php if (!empty($a11yCfg['agid_declaration_url'])): ?>
            <p><a href="<?= htmlspecialchars($a11yCfg['agid_declaration_url']) ?>" rel="noopener"><?= te('a11y.decl.link') ?></a>
            <?php if (!empty($a11yCfg['agid_declaration_date'])): ?>
                <?= te('a11y.decl.updated', ['date' => $a11yCfg['agid_declaration_date']]) ?>
            <?php endif; ?></p>
        <?php else: ?>
            <p><?= te('a11y.decl.pending') ?></p>
        <?php endif; ?>
        <p><?= te('a11y.decl.status') ?></p>
    </section>

    <section class="mb-4" aria-labelledby="a11yNaTitle">
        <h2 class="h5" id="a11yNaTitle"><?= te('a11y.na.title') ?></h2>
        <ul>
            <li><?= te('a11y.na.flow_editor') ?></li>
            <li><?= te('a11y.na.canvas') ?></li>
            <li><?= te('a11y.na.panel_windows') ?></li>
        </ul>
    </section>

    <section class="mb-4" aria-labelledby="a11yFbTitle" id="feedback">
        <h2 class="h5" id="a11yFbTitle"><?= te('a11y.feedback.title') ?></h2>
        <p><?= te('a11y.feedback.intro') ?></p>

        <form id="a11yFeedbackForm" novalidate>
            <div class="mb-3">
                <label for="fbName" class="form-label"><?= te('a11y.feedback.name') ?></label>
                <input type="text" class="form-control" id="fbName" maxlength="100" autocomplete="name">
            </div>
            <div class="mb-3">
                <label for="fbEmail" class="form-label"><?= te('a11y.feedback.email') ?></label>
                <input type="email" class="form-control" id="fbEmail" maxlength="190" autocomplete="email" aria-describedby="fbEmailHelp">
                <div id="fbEmailHelp" class="form-text"><?= te('a11y.feedback.email_help') ?></div>
                <div id="fbEmailErr" class="invalid-feedback"></div>
            </div>
            <div class="mb-3">
                <label for="fbPage" class="form-label"><?= te('a11y.feedback.page') ?></label>
                <input type="text" class="form-control" id="fbPage" maxlength="500" value="<?= htmlspecialchars($fromPage) ?>">
            </div>
            <div class="mb-3">
                <label for="fbMessage" class="form-label"><?= te('a11y.feedback.message') ?> <span aria-hidden="true">*</span></label>
                <textarea class="form-control" id="fbMessage" rows="6" maxlength="5000" required aria-required="true" aria-describedby="fbMessageErr"></textarea>
                <div id="fbMessageErr" class="invalid-feedback"></div>
            </div>
            <!-- campo trappola per i programmi automatici: nascosto a persone e lettori di schermo -->
            <div class="visually-hidden" aria-hidden="true">
                <label for="fbWebsite">Website</label>
                <input type="text" id="fbWebsite" tabindex="-1" autocomplete="off">
            </div>
            <button type="submit" class="btn btn-primary" id="fbSubmit"><?= te('a11y.feedback.submit') ?></button>
            <div id="fbStatus" class="mt-3" role="status" aria-live="polite"></div>
        </form>
    </section>

    <section class="mb-4" aria-labelledby="a11yEnfTitle">
        <h2 class="h5" id="a11yEnfTitle"><?= te('a11y.enf.title') ?></h2>
        <p><?= te('a11y.enf.text') ?>
            <?php if (!empty($a11yCfg['enforcement_url'])): ?>
                <a href="<?= htmlspecialchars($a11yCfg['enforcement_url']) ?>" rel="noopener"><?= te('a11y.enf.link') ?></a>
            <?php endif; ?>
        </p>
    </section>

    <?php if ($isAdmin): ?>
    <section class="mb-4" aria-labelledby="a11yAdmTitle">
        <h2 class="h5" id="a11yAdmTitle"><?= te('a11y.admin.title') ?></h2>
        <div id="fbAdminList" aria-live="polite"><?= te('common.loading') ?></div>
    </section>
    <?php endif; ?>
</div>
</main>
<?php require __DIR__ . '/partials/a11y_footer.php'; ?>

<script>
(function () {
    const form   = document.getElementById('a11yFeedbackForm');
    const status = document.getElementById('fbStatus');
    const btn    = document.getElementById('fbSubmit');
    const fields = { email: 'fbEmail', message: 'fbMessage' };

    function clearErrors() {
        for (const id of Object.values(fields)) {
            const el = document.getElementById(id);
            el.classList.remove('is-invalid');
            el.removeAttribute('aria-invalid');
            document.getElementById(id + 'Err').textContent = '';
        }
    }
    function showErrors(errs) {
        let first = null;
        for (const [k, msg] of Object.entries(errs || {})) {
            const id = fields[k];
            if (!id) continue;
            const el = document.getElementById(id);
            el.classList.add('is-invalid');
            el.setAttribute('aria-invalid', 'true');
            el.setAttribute('aria-errormessage', id + 'Err');
            document.getElementById(id + 'Err').textContent = msg;
            first = first || el;
        }
        first?.focus();
    }

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        clearErrors();
        const message = document.getElementById('fbMessage').value.trim();
        if (!message) { showErrors({ message: t('a11y.feedback.err.message_required') }); return; }
        btn.disabled = true;
        status.className = 'mt-3';
        status.textContent = t('common.saving');
        try {
            const r = await fetch('api/a11y_feedback.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: document.getElementById('fbName').value,
                    email: document.getElementById('fbEmail').value,
                    page: document.getElementById('fbPage').value,
                    message,
                    website: document.getElementById('fbWebsite').value,
                }),
            });
            const j = await r.json().catch(() => null);
            if (!j) throw new Error(t('errors.server_status', { status: r.status }));
            if (!j.ok) { showErrors(j.fields); throw new Error(j.error); }
            form.reset();
            status.className = 'mt-3 alert alert-success';
            status.textContent = t('a11y.feedback.sent');
        } catch (e) {
            status.className = 'mt-3 alert alert-danger';
            status.textContent = e.message || String(e);
        } finally {
            btn.disabled = false;
        }
    });

    // Elenco delle segnalazioni (solo amministratore)
    const adm = document.getElementById('fbAdminList');
    if (!adm) return;
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
    async function loadList() {
        try {
            const r = await fetch('api/a11y_feedback.php?action=list', { credentials: 'same-origin' });
            const j = await r.json();
            if (!j.ok) throw new Error(j.error);
            if (!j.data.length) { adm.textContent = t('a11y.admin.empty'); return; }
            adm.innerHTML = `<div class="table-responsive"><table class="table table-sm align-top">
                <caption class="visually-hidden">${te('a11y.admin.title')}</caption>
                <thead><tr><th scope="col">#</th><th scope="col">${te('a11y.admin.col.date')}</th><th scope="col">${te('a11y.admin.col.from')}</th>
                <th scope="col">${te('a11y.feedback.message')}</th><th scope="col">${te('a11y.admin.col.status')}</th></tr></thead><tbody>
                ${j.data.map(f => `<tr>
                    <td>${esc(f.fb_id)}</td>
                    <td>${esc(String(f.fb_created_at).slice(0, 16))}</td>
                    <td>${esc(f.fb_name || '—')}<br><span class="small">${esc(f.fb_email)}</span><br><span class="small text-secondary">${esc(f.fb_page)}</span></td>
                    <td style="white-space:pre-wrap">${esc(f.fb_message)}</td>
                    <td><button type="button" class="btn btn-sm ${f.fb_status === 'done' ? 'btn-outline-secondary' : 'btn-outline-primary'}" data-id="${esc(f.fb_id)}" data-status="${f.fb_status === 'done' ? 'new' : 'done'}">
                        ${f.fb_status === 'done' ? te('a11y.admin.reopen') : te('a11y.admin.mark_done')}</button></td>
                </tr>`).join('')}</tbody></table></div>`;
        } catch (e) {
            adm.textContent = e.message || String(e);
        }
    }
    adm.addEventListener('click', async (ev) => {
        const b = ev.target.closest('button[data-id]');
        if (!b) return;
        await fetch('api/a11y_feedback.php', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set_status', fb_id: Number(b.dataset.id), status: b.dataset.status }),
        });
        loadList();
    });
    loadList();
})();
</script>
</body>
</html>
