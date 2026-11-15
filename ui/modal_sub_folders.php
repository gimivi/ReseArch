<?php
// modal_sub_folders.php
// Solo layout: Tabulator è già disponibile globalmente.
// Assumo Bootstrap 5 (se usi BS4 cambia data-bs-* -> data-*).
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalSubFolders" tabindex="-1" aria-labelledby="modalSubFoldersLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="modalSubFoldersLabel"><?= te('modal.sub_folders.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="d-flex gap-2 align-items-center mb-2">
          <button type="button" class="btn btn-primary btn-sm" id="btnSubFolderAdd">
            <?= te('modal.sub_folders.add.@') ?>
          </button>

          <div class="small text-muted ms-auto">
            <?= te('modal.sub_folders.current_wp.@') ?> <span id="subFoldersWpLabel"></span>
          </div>
        </div>

        <div id="subFoldersTable"></div>

        <div class="alert alert-info mt-3 mb-0 small">
          <?= te('modal.sub_folders.rules_name') ?>
          <br>
          <?= te('modal.sub_folders.rules_delete.@') ?>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>
<!-- File JS esterno con gestione creazione e modifica folders -->
<script type="module" src="ui/modal_sub_folders.js"></script>