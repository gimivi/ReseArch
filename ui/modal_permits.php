<?php
// modal_permits.php
require_once __DIR__ . '/../api/i18n.php';
?>

<!-- MODALE PERMESSI RICERCA -->
<div class="modal fade" id="modalResPermits" tabindex="-1" aria-labelledby="modalResPermitsLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="modalResPermitsLabel"><?= te('modal.permits.res.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="d-flex align-items-center mb-2">
          <small class="text-muted">
            <?= te('modal.permits.res.hint.@') ?>
          </small>
          <small class="text-muted ms-auto">
            <?= te('modal.permits.res.label.@') ?> <span id="resPermitsResLabel"></span>
          </small>
        </div>

        <!-- Azioni bulk sui selezionati — bottone visibile solo all'amministratore (X) -->
        <div class="d-none gap-2 align-items-center mb-2" id="resPermitsBulkBar">
          <button type="button" class="btn btn-outline-primary btn-sm" id="btnResPermitsEmail" disabled>
            <i class="bi bi-envelope" aria-hidden="true"></i> <?= te('modal.permits.email.send_selected') ?>
          </button>
        </div>

        <!-- Pannello compose email, nascosto finché non si preme il bottone sopra -->
        <div id="resPermitsEmailCompose" class="border rounded p-2 mb-2" style="display:none;">
          <div class="mb-2">
            <label class="form-label small mb-1" for="resPermitsEmailSubject"><?= te('modal.permits.email.subject') ?></label>
            <input type="text" class="form-control form-control-sm" id="resPermitsEmailSubject">
          </div>
          <div class="mb-2">
            <label class="form-label small mb-1" for="resPermitsEmailBody"><?= te('modal.permits.email.message') ?></label>
            <textarea class="form-control form-control-sm" id="resPermitsEmailBody" rows="5"></textarea>
          </div>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-primary btn-sm" id="btnResPermitsEmailSend"><?= te('modal.permits.email.send') ?></button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="btnResPermitsEmailCancel"><?= te('common.cancel') ?></button>
          </div>
          <div class="small mt-2" id="resPermitsEmailStatus" role="status" aria-live="polite"></div>
        </div>

        <div id="resPermitsTable"></div>

        <div class="mt-2">
          <small class="text-muted" id="resPermitsStatus" role="status" aria-live="polite"></small>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline-secondary" id="btnResPermitsCancel" disabled><?= te('common.cancel') ?></button>
        <button class="btn btn-primary" id="btnResPermitsSave" disabled><?= te('common.save') ?></button>
        <button class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>


<!-- MODALE PERMESSI WORKPACKAGE -->
<div class="modal fade" id="modalWpPermits" tabindex="-1" aria-labelledby="modalWpPermitsLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="modalWpPermitsLabel"><?= te('modal.permits.wp.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="d-flex align-items-center mb-2">
          <small class="text-muted">
            <?= te('modal.permits.wp.hint.@') ?>
          </small>
          <small class="text-muted ms-auto">
            <?= te('modal.permits.wp.label.@') ?> <span id="wpPermitsWpLabel"></span>
          </small>
        </div>

        <div id="wpPermitsTable"></div>

        <div class="mt-2">
          <small class="text-muted" id="wpPermitsStatus" role="status" aria-live="polite"></small>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline-secondary" id="btnWpPermitsCancel" disabled><?= te('common.cancel') ?></button>
        <button class="btn btn-primary" id="btnWpPermitsSave" disabled><?= te('common.save') ?></button>
        <button class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>
<script type="module" src="./ui/modal_permits.js"></script>