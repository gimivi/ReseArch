<?php
// modal_platform_users.php
// Modale "Utenti della piattaforma": gestisce users.user_type (ruolo globale
// V/U/I/P — X escluso, resta assegnabile solo a mano sul DB) + invio email
// bulk agli utenti selezionati. Stessa struttura di "Users ricerca"
// (ui/modal_permits.php, #modalResPermits).
//
// Visibile solo all'amministratore (X), solo quando nessuna ricerca è ancora
// selezionata (landing page) — vedi ui/header.php $showPlatformUsers.
// Inclusa da researches.php.
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalPlatformUsers" tabindex="-1" aria-labelledby="modalPlatformUsersLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <div class="modal-header">
        <h5 class="modal-title" id="modalPlatformUsersLabel"><?= te('modal.platform_users.title') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="d-flex align-items-center mb-2">
          <small class="text-muted">
            <?= te('modal.platform_users.intro.@') ?>
          </small>
        </div>

        <div class="d-none gap-2 align-items-center mb-2" id="platformUsersBulkBar">
          <button type="button" class="btn btn-outline-primary btn-sm" id="btnPlatformUsersEmail" disabled>
            <i class="bi bi-envelope" aria-hidden="true"></i> <?= te('modal.platform_users.email_selected') ?>
          </button>
        </div>

        <div id="platformUsersEmailCompose" class="border rounded p-2 mb-2" style="display:none;">
          <div class="mb-2">
            <label class="form-label small mb-1" for="platformUsersEmailSubject"><?= te('modal.platform_users.email_subject') ?></label>
            <input type="text" class="form-control form-control-sm" id="platformUsersEmailSubject">
          </div>
          <div class="mb-2">
            <label class="form-label small mb-1" for="platformUsersEmailBody"><?= te('modal.platform_users.email_body') ?></label>
            <textarea class="form-control form-control-sm" id="platformUsersEmailBody" rows="5"></textarea>
          </div>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-primary btn-sm" id="btnPlatformUsersEmailSend"><?= te('modal.platform_users.email_send') ?></button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="btnPlatformUsersEmailCancel"><?= te('common.cancel') ?></button>
          </div>
          <div class="small mt-2" id="platformUsersEmailStatus" role="status" aria-live="polite"></div>
        </div>

        <div id="platformUsersTable"></div>

        <div class="mt-2">
          <small class="text-muted" id="platformUsersStatus" role="status" aria-live="polite"></small>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline-secondary" id="btnPlatformUsersCancel" disabled><?= te('common.cancel') ?></button>
        <button class="btn btn-primary" id="btnPlatformUsersSave" disabled><?= te('common.save') ?></button>
        <button class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>
<script type="module" src="./ui/modal_platform_users.js"></script>
