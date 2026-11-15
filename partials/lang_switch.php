<?php
/*
 * partials/lang_switch.php — scelta della lingua per le pagine pubbliche (senza header).
 * Compare solo se in lang/ c'è più di un catalogo; mostra solo le lingue diverse da quella
 * corrente, in forma breve (lang.short: Ita, Eng), con il nome intero come nome accessibile.
 * Il clic salva la scelta (js/i18n.js, api/set_lang.php) e ricarica la pagina.
 * Richiede api/i18n.php già incluso.
 * $raLangFloat = true prima dell'include: in alto a destra della scheda (che deve avere
 * position-relative), fuori dal flusso, così il logo sale fino in cima.
 */
$_langs = ra_langs();
$_float = !empty($raLangFloat);
if (count($_langs) > 1):
?>
<nav class="ra-lang-switch d-flex justify-content-end flex-wrap gap-1 <?= $_float ? 'position-absolute top-0 end-0 m-1' : 'mb-2' ?>" aria-label="<?= te('header.lang.title') ?>">
  <?php foreach ($_langs as $_code => $_name): if ($_code === ra_lang()) continue; ?>
    <button type="button"
            class="btn btn-link px-2 ra-lang-option"
            data-lang="<?= htmlspecialchars($_code) ?>" lang="<?= htmlspecialchars($_code) ?>"
            aria-label="<?= htmlspecialchars($_name) ?>" title="<?= htmlspecialchars($_name) ?>"
            style="min-height: var(--ra-touch-min);">
      <?= htmlspecialchars(ra_lang_short($_code)) ?>
    </button>
  <?php endforeach; ?>
</nav>
<script>
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ra-lang-option');
    if (!btn || btn.getAttribute('aria-current') === 'true') return;
    window.raI18n?.setLang(btn.dataset.lang);
  });
</script>
<?php endif; ?>
