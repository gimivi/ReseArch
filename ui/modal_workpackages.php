<?php
// ui/modal_workpackages.php
// Richiede che nella pagina chiamante esistano: $user e $research (come in workpackages.php)
require_once __DIR__ . '/../api/i18n.php';
?>
<!-- MODAL: WorkPackages -->
<div class="modal fade" id="modalWorkpackages" tabindex="-1" aria-labelledby="modalWorkpackagesTitle" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="modalWorkpackagesTitle"><?= te('modal.workpackages.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">

        <div class="d-flex gap-2 align-items-center mb-2">
          <button type="button" class="btn btn-sm btn-primary" id="btnWpAdd">
            <i class="bi bi-plus-square" aria-hidden="true"></i> <?= te('modal.workpackages.new.@') ?>
          </button>

          <button type="button" class="btn btn-sm btn-danger" id="btnWpDelete" disabled>
            <i class="bi bi-trash" aria-hidden="true"></i> <?= te('common.delete') ?>
          </button>

          <div class="ms-auto small text-muted">
            <?= te('modal.workpackages.help') ?>
          </div>
        </div>

        <div id="workpackagesTable" data-ra-rows="activate"></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>

<!-- MODAL: Editor testo lungo -->
<div class="modal fade" id="modalWpLongTextEditor" tabindex="-1" aria-labelledby="wpLongTextTitle" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-scrollable">
    <div class="modal-content text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="wpLongTextTitle"><?= te('modal.workpackages.long.title') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <textarea id="wpLongTextValue" class="form-control" rows="12" style="white-space:pre-wrap;" aria-labelledby="wpLongTextTitle" aria-describedby="wpLongTextHint"></textarea>
        <div class="form-text mt-2" id="wpLongTextHint"></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.cancel') ?></button>
        <button type="button" class="btn btn-primary" id="btnWpLongTextSave"><?= te('common.save') ?></button>
      </div>

    </div>
  </div>
</div>

<!-- MODAL: Nuovo WP -->
<div class="modal fade" id="modalWpCreate" tabindex="-1" aria-labelledby="modalWpCreateTitle" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-scrollable">
    <div class="modal-content text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="modalWpCreateTitle"><?= te('modal.workpackages.create.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="row g-2">
          <div class="col-md-6">
            <label class="form-label" for="newWpFolderName"><?= te('modal.workpackages.field.folder.@') ?></label>
            <input class="form-control" id="newWpFolderName" placeholder="<?= te('modal.workpackages.field.folder_placeholder') ?>" />
          </div>

          <div class="col-md-3">
            <label class="form-label" for="newWpOrd"><?= te('modal.workpackages.field.order') ?></label>
            <input class="form-control" id="newWpOrd" type="number" min="0" step="1" value="0" />
          </div>

          <div class="col-md-3">
            <label class="form-label" for="newWpShow"><?= te('modal.workpackages.field.show') ?></label>
            <select class="form-select" id="newWpShow">
              <option value="0"><?= te('visibility.author.@') ?></option>
              <option value="1" selected><?= te('visibility.workgroup') ?></option>
              <option value="2"><?= te('visibility.research.@') ?></option>
              <option value="3"><?= te('visibility.dissemination') ?></option>
              <option value="4"><?= te('visibility.public') ?></option>
              <option value="5"><?= te('visibility.guests') ?></option>
            </select>
          </div>

          <div class="col-md-9">
            <label class="form-label" for="newWpTitle"><?= te('common.title') ?></label>
            <input class="form-control" id="newWpTitle" />
          </div>

          <div class="col-12">
            <label class="form-label" for="newWpSubtitle"><?= te('modal.workpackages.field.subtitle') ?></label>
            <textarea class="form-control" id="newWpSubtitle" rows="2"></textarea>
          </div>

          <div class="col-12">
            <label class="form-label" for="newWpAbstract"><?= te('modal.workpackages.field.abstract') ?></label>
            <textarea class="form-control" id="newWpAbstract" rows="4"></textarea>
          </div>

          <div class="col-12">
            <label class="form-label" for="newWpCaption"><?= te('modal.workpackages.field.caption') ?></label>
            <textarea class="form-control" id="newWpCaption" rows="3"></textarea>
          </div>
        </div>

        <div class="alert alert-danger mt-3 d-none" id="newWpError" role="alert"></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.cancel') ?></button>
        <button type="button" class="btn btn-primary" id="btnCreateWp"><?= te('common.create') ?></button>
      </div>

    </div>
  </div>
</div>

<script>
  // FIX (2026-09-16): mai esporre $user per intero — porta anche password_hash.
  window.user = window.user || <?php echo json_encode(
      ['id' => $user['id'] ?? null, 'user_type' => $user['user_type'] ?? null],
      JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
  ); ?>;
  window.research = window.research || <?php echo json_encode($research ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
</script>

<script src="./ui/modal_workpackages.js"></script>
