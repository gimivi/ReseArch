<?php
// ui/modal_item_authors.php
// Autori (A) e collaboratori (C) di un oggetto o modello: aperta dalla colonna "Autori" delle
// modali Oggetti e Modelli (window.raOpenItemAuthors, ui/modal_item_authors.js).
// Server: ui/modal_item_authors_tools.php. Passo 7 di _doc/arch-permessi.md §11.9.
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalItemAuthors" tabindex="-1" aria-labelledby="modalItemAuthorsTitle" aria-hidden="true">
  <div class="modal-dialog modal-dialog-scrollable modal-fullscreen-sm-down">
    <div class="modal-content bg-body text-body">
      <div class="modal-header">
        <h2 class="modal-title fs-5" id="modalItemAuthorsTitle"></h2>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>
      <div class="modal-body">
        <p class="small text-secondary"><?= te('modal.item_authors.help.@') ?></p>

        <ul class="list-group mb-3" id="itemAuthorsList" aria-labelledby="modalItemAuthorsTitle"></ul>

        <div class="d-flex gap-2 align-items-end" id="itemAuthorsAddRow">
          <div class="flex-grow-1">
            <label for="itemAuthorsCandidate" class="form-label small mb-1"><?= te('modal.item_authors.add_label') ?></label>
            <select class="form-select form-select-sm" id="itemAuthorsCandidate"></select>
          </div>
          <button type="button" class="btn btn-sm btn-outline-primary" id="itemAuthorsAddBtn"><?= te('common.add') ?></button>
        </div>

        <div class="mt-2">
          <small class="text-secondary" id="itemAuthorsStatus" role="status" aria-live="polite"></small>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
        <button type="button" class="btn btn-primary" id="itemAuthorsSaveBtn" disabled><?= te('common.save') ?></button>
      </div>
    </div>
  </div>
</div>
<script type="module" src="ui/modal_item_authors.js"></script>
