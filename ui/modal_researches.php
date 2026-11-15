<?php
// ui/modal_researches.php
// Richiede che nella pagina chiamante esistano: $user (array sessione utente corrente)
require_once __DIR__ . '/../api/i18n.php';
?>
<!-- MODAL: Researches -->
<div class="modal fade" id="modalResearches" tabindex="-1" aria-hidden="true" aria-labelledby="modalResearchesTitle">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content bg-body text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="modalResearchesTitle"><?= te('modal.researches.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">

        <div class="d-flex gap-2 align-items-center mb-2">
          <button type="button" class="btn btn-sm btn-primary" id="btnResearchAdd">
            <i class="bi bi-plus-square" aria-hidden="true"></i> <?= te('modal.researches.new.@') ?>
          </button>

          <button type="button" class="btn btn-sm btn-danger" id="btnResearchDelete" disabled>
            <i class="bi bi-trash" aria-hidden="true"></i> <?= te('common.delete') ?>
          </button>

          <div class="ms-auto small text-muted">
            <?= te('modal.researches.edit_hint') ?>
          </div>
        </div>

        <div id="researchesTable" data-ra-rows="activate"></div>

      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>

<!-- MODAL: Editor testo lungo (popup) -->
<div class="modal fade" id="modalLongTextEditor" tabindex="-1" aria-hidden="true" aria-labelledby="longTextTitle">
  <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-scrollable">
    <div class="modal-content bg-body text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="longTextTitle"><?= te('modal.researches.long.edit_text') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <textarea id="longTextValue" class="form-control" rows="12" style="white-space:pre-wrap;" aria-labelledby="longTextTitle" aria-describedby="longTextHint"></textarea>
        <div class="form-text mt-2" id="longTextHint"></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.cancel') ?></button>
        <button type="button" class="btn btn-primary" id="btnLongTextSave"><?= te('common.save') ?></button>
      </div>

    </div>
  </div>
</div>

<!-- MODAL: Nuova ricerca -->
<div class="modal fade" id="modalResearchCreate" tabindex="-1" aria-hidden="true" aria-labelledby="modalResearchCreateTitle">
  <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-scrollable">
    <div class="modal-content bg-body text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="modalResearchCreateTitle"><?= te('modal.researches.new.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="row g-2">
          <div class="col-md-6">
            <label class="form-label" for="newResFolderName"><?= te('modal.researches.field.folder_name.@') ?></label>
            <input class="form-control" id="newResFolderName" placeholder="<?= te('modal.researches.field.folder_placeholder.@') ?>" aria-describedby="newResFolderHelp" />
            <div class="form-text" id="newResFolderHelp"><?= te('modal.researches.field.folder_help') ?></div>
          </div>

          <div class="col-md-6">
            <label class="form-label" for="newResShow"><?= te('common.visibility') ?></label>
            <select class="form-select" id="newResShow">
              <option value="0"><?= te('modal.researches.show.private') ?></option>
              <option value="1"><?= te('modal.researches.show.workgroup') ?></option>
              <option value="2" selected><?= te('visibility.research.@') ?></option>
              <option value="3"><?= te('modal.researches.show.dissemination') ?></option>
              <option value="4"><?= te('modal.researches.show.public') ?></option>
              <option value="5"><?= te('modal.researches.show.guests') ?></option>
            </select>
          </div>

          <div class="col-md-8">
            <label class="form-label" for="newResTitle"><?= te('common.title') ?></label>
            <input class="form-control" id="newResTitle" />
          </div>

          <div class="col-md-4">
            <label class="form-label" for="newResYear"><?= te('modal.researches.col.year') ?></label>
            <input class="form-control" id="newResYear" placeholder="2026" />
          </div>

          <div class="col-12">
            <label class="form-label" for="newResSubtitle"><?= te('modal.researches.field.subtitle_long') ?></label>
            <textarea class="form-control" id="newResSubtitle" rows="2"></textarea>
          </div>

          <div class="col-12">
            <label class="form-label" for="newResAbstract"><?= te('modal.researches.field.abstract_long') ?></label>
            <textarea class="form-control" id="newResAbstract" rows="4"></textarea>
          </div>

          <div class="col-12">
            <label class="form-label" for="newResCaption"><?= te('modal.researches.field.caption_long') ?></label>
            <textarea class="form-control" id="newResCaption" rows="3"></textarea>
          </div>
        </div>

        <div class="alert alert-danger mt-3 d-none" id="newResError" role="alert"></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.cancel') ?></button>
        <button type="button" class="btn btn-primary" id="btnCreateResearch"><?= te('common.create') ?></button>
      </div>

    </div>
  </div>
</div>

<script>
  // Dati utente correnti disponibili anche lato JS (coerente con altri file)
  // FIX (2026-09-16): mai esporre $user per intero — porta anche password_hash.
  // Solo il sottoinsieme che il JS usa davvero (vedi dashboard.php $userSafe).
  window.user = window.user || <?php echo json_encode(
      ['id' => $user['id'] ?? null, 'user_type' => $user['user_type'] ?? null],
      JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
  ); ?>;
</script>

<script src="./ui/modal_researches.js"></script>
