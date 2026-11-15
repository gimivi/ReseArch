<?php
// modal_objects.php
require_once __DIR__ . '/../api/i18n.php';
$resId = (int)($research['res_id'] ?? 0);
$wpId  = (int)($workpackage['wp_id'] ?? 0);
?>

<div class="modal fade" id="objectsEditModal" tabindex="-1" aria-labelledby="objectsModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content bg-body text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="objectsModalLabel"><?= te('modal.objects.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div id="objects-table" style="height: 60vh;"></div>

        <div class="mt-2">
          <small class="text-muted" id="objStatus" role="status" aria-live="polite"></small>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" id="objBtnCancel" disabled><?= te('common.cancel') ?></button>
        <button type="button" class="btn btn-primary" id="objBtnSave" disabled><?= te('common.save') ?></button>
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>

<script>
  window.CURRENT_RES_ID = <?= (int)$resId ?>;
  window.CURRENT_WP_ID  = <?= (int)$wpId ?>;
</script>

<script type="module" src="ui/modal_objects.js"></script>