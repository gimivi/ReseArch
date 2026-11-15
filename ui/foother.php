<?php
// Footer comune (researches.php, workpackages.php, dashboard.php). Testi da catalogo (lang/*.json).
if (!function_exists('te')) require_once __DIR__ . '/../api/i18n.php';
$page_ref = $page_ref ?? '';

switch ($page_ref) {
  case 'ricerca':
    $foother_msg = t('footer.hint.researches.@');
    break;
  case 'work_package':
    $foother_msg = t('footer.hint.workpackages.@');
    break;
  default:
    $foother_msg = '';
}
?>

<nav class="app-footer-left" aria-label="<?= te('footer.nav') ?>">
  <a href="researches.php" class="app-footer-home" title="<?= te('footer.home.@') ?>" aria-label="<?= te('footer.home.@') ?>">
    <i class="bi bi-house" aria-hidden="true"></i>
  </a>
  <?php if ($page_ref === 'dashboard'): ?>
  <a href="workpackages.php" class="app-footer-home ms-2" title="<?= te('footer.workpackages.@') ?>" aria-label="<?= te('footer.workpackages.@') ?>">
    <i class="bi bi-boxes" aria-hidden="true"></i>
  </a>
  <?php endif; ?>
</nav>

<div class="app-footer-center">
  <?= htmlspecialchars($foother_msg) ?>
  <?php if ($page_ref === 'dashboard'): ?>
  <!-- Config dashboard caricata (app/dashboard_cfg.mjs::_setCurrent), per tutti gli utenti -->
  <span id="dcfg-current" class="dcfg-current" title="<?= te('footer.dcfg_current') ?>" hidden>
    <i class="bi bi-layout-three-columns" aria-hidden="true"></i> <span id="dcfg-current-name"></span>
  </span>
  <?php endif; ?>
</div>

<?php if ($page_ref === 'dashboard' && (isset($showUOML) && $showUOML)): ?>
<div id="fle-indicator" class="fle-indicator" role="status" hidden>
  <span class="fle-ind-dot" aria-hidden="true"></span>
  <span id="fle-ind-name" class="fle-ind-name"></span>
  <button id="fle-ind-stop" class="fle-ind-stop" title="<?= te('footer.flows_stop_title') ?>"><span aria-hidden="true">&#9632;</span> <?= te('footer.flows_stop') ?></button>
</div>
<?php endif; ?>

<div class="app-footer-right">
  <a href="accessibilita.php?from=<?= urlencode($page_ref) ?>"><?= te('a11y.footer_link') ?></a> &middot;
  <a href="privacy.php"><?= te('privacy.footer_link') ?></a> &middot;
  &copy; <?php echo date('Y'); ?> <?= te('app.name') ?> &mdash;
  <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
</div>
