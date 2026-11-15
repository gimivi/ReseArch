<?php
// privacy.php — informativa sul trattamento dei dati personali (passo 4 di _doc/arch-sso-ospiti.md).
// Pubblica, senza login; raggiungibile dal footer di tutte le pagine e dalla pagina di accesso.
// Titolare e contatti da cfg/cfg_privacy.php; tempi di conservazione da cfg/cfg_maintenance.php.
// Il testo è un modello: va rivisto con il Responsabile della protezione dei dati dell'ente.
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
require_once __DIR__ . '/api/i18n.php';
require_once __DIR__ . '/api/sso_lib.php';
ra_i18n_set_research(null);
// File della singola installazione (escluso da git); senza, il modello vuoto
$pvCfg   = require __DIR__ . (is_file(__DIR__ . '/cfg/cfg_privacy.php') ? '/cfg/cfg_privacy.php' : '/cfg/cfg_privacy.example.php');
$mtCfg   = require __DIR__ . '/cfg/cfg_maintenance.php';
$pageTitle = t('privacy.page.title');
$daysLog   = (int)($mtCfg['activity_log_days'] ?? 0);
$daysGuest = (int)($mtCfg['guest_log_days'] ?? 0);
$ssoNames  = implode(', ', ra_sso_enabled());
$keep = fn(int $d): string => $d > 0 ? t('privacy.keep.days', ['n' => $d]) : t('privacy.keep.forever');
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

    <h1 class="h3 mb-3"><?= te('privacy.page.title') ?></h1>
    <?php if (empty($pvCfg['controller'])): ?>
        <div class="alert alert-warning" role="note"><?= te('privacy.pending') ?></div>
    <?php endif; ?>
    <p><?= te('privacy.intro') ?></p>

    <section class="mb-4" aria-labelledby="pvCtrl">
        <h2 class="h5" id="pvCtrl"><?= te('privacy.controller.title') ?></h2>
        <p class="mb-1"><?= htmlspecialchars($pvCfg['controller'] ?: '—') ?>
            <?php if (!empty($pvCfg['controller_email'])): ?>
                · <a href="mailto:<?= htmlspecialchars($pvCfg['controller_email']) ?>"><?= htmlspecialchars($pvCfg['controller_email']) ?></a>
            <?php endif; ?></p>
        <?php if (!empty($pvCfg['contact_name']) || !empty($pvCfg['contact_email'])): ?>
            <p class="mb-1"><?= te('privacy.controller.contact') ?>:
                <?= htmlspecialchars(trim(($pvCfg['contact_name'] ?? '') . (!empty($pvCfg['contact_role']) ? ' (' . $pvCfg['contact_role'] . ')' : ''))) ?>
                <?php if (!empty($pvCfg['contact_email'])): ?>
                    · <a href="mailto:<?= htmlspecialchars($pvCfg['contact_email']) ?>"><?= htmlspecialchars($pvCfg['contact_email']) ?></a>
                <?php endif; ?></p>
        <?php endif; ?>
        <?php if (!empty($pvCfg['dpo_email'])): ?>
            <p><?= te('privacy.controller.dpo') ?>: <a href="mailto:<?= htmlspecialchars($pvCfg['dpo_email']) ?>"><?= htmlspecialchars($pvCfg['dpo_email']) ?></a></p>
        <?php endif; ?>
    </section>

    <section class="mb-4" aria-labelledby="pvData">
        <h2 class="h5" id="pvData"><?= te('privacy.data.title') ?></h2>
        <h3 class="h6"><?= te('privacy.members.title') ?></h3>
        <ul>
            <li><?= te('privacy.members.account') ?></li>
            <li><?= te('privacy.members.log', ['keep' => $keep($daysLog)]) ?></li>
            <li><?= te('privacy.members.sessions') ?></li>
            <li><?= te('privacy.members.linked') ?></li>
        </ul>
        <h3 class="h6"><?= te('privacy.guests.title') ?></h3>
        <ul>
            <li><?= te('privacy.guests.data') ?></li>
            <li><?= te('privacy.guests.keep', ['keep' => $keep($daysGuest)]) ?></li>
            <li><?= te('privacy.guests.not_stored') ?></li>
        </ul>
    </section>

    <section class="mb-4" aria-labelledby="pvSso">
        <h2 class="h5" id="pvSso"><?= te('privacy.sso.title') ?></h2>
        <p><?= te('privacy.sso.text', ['providers' => $ssoNames !== '' ? $ssoNames : '—']) ?></p>
    </section>

    <section class="mb-4" aria-labelledby="pvPurpose">
        <h2 class="h5" id="pvPurpose"><?= te('privacy.purpose.title') ?></h2>
        <p><?= te('privacy.purpose.text') ?></p>
    </section>

    <section class="mb-4" aria-labelledby="pvCookie">
        <h2 class="h5" id="pvCookie"><?= te('privacy.cookies.title') ?></h2>
        <p><?= te('privacy.cookies.text') ?></p>
    </section>

    <section class="mb-4" aria-labelledby="pvRights">
        <h2 class="h5" id="pvRights"><?= te('privacy.rights.title') ?></h2>
        <p><?= te('privacy.rights.text') ?>
            <a href="https://www.garanteprivacy.it" rel="noopener">garanteprivacy.it</a>.</p>
    </section>

    <?php if (!empty($pvCfg['updated'])): ?>
        <p class="small text-secondary"><?= te('privacy.updated', ['date' => $pvCfg['updated']]) ?></p>
    <?php endif; ?>
</div>
</main>
<?php require __DIR__ . '/partials/a11y_footer.php'; ?>
</body>
</html>
