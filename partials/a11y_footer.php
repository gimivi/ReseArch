<?php
/*
 * partials/a11y_footer.php — piede delle pagine pubbliche (senza header): link alla pagina
 * Accessibilità (dichiarazione e segnalazioni, obbligatoria dal footer per la PA) e all'informativa privacy.
 * Richiede api/i18n.php già incluso.
 */
?>
<footer class="text-center small py-3">
  <a href="accessibilita.php"><?= te('a11y.footer_link') ?></a> &middot;
  <a href="privacy.php"><?= te('privacy.footer_link') ?></a>
</footer>
