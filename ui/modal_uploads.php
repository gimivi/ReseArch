<?php
// modal_uploads.php
// Modale "Caricamento file": a sinistra le subfolder del workpackage; a destra
// il contenuto della cartella corrente (sottocartelle navigabili, file con
// dimensione e data — 2026-10-03) e, sotto, la zona di caricamento. I file
// vanno nella cartella che si sta guardando. Endpoint: ui/modal_uploads_tools.php
// (POST upload, GET ?action=list_dir). Testi con colore esplicito: vedi memoria
// bootstrap-modal-white-on-white.
// Testi da catalogo (chiavi modal.uploads.*): _doc/arch-i18n-a11y.md §2.
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalUpload" tabindex="-1" aria-labelledby="modalUploadLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <div class="modal-header">
        <h5 class="modal-title" id="modalUploadLabel"><?= te('modal.uploads.title') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="row">

          <!-- COLONNA SINISTRA: SUBFOLDER -->
          <div class="col-md-3 border-end">
            <h6 class="mb-2"><?= te('modal.uploads.folders.@') ?></h6>
            <div id="uploadFolderList" class="list-group small">
              <!-- popolata via JS -->
            </div>
          </div>

          <!-- COLONNA DESTRA: CONTENUTO + CARICAMENTO -->
          <div class="col-md-9">
            <div class="d-flex align-items-center gap-2 mb-2">
              <button type="button" class="btn btn-sm btn-outline-secondary" id="uploadBtnRoot" title="<?= te('modal.uploads.root.@') ?>" aria-label="<?= te('modal.uploads.root.@') ?>" disabled>
                <i class="bi bi-house" aria-hidden="true"></i>
              </button>
              <button type="button" class="btn btn-sm btn-outline-secondary" id="uploadBtnUp" title="<?= te('modal.uploads.up.@') ?>" aria-label="<?= te('modal.uploads.up.@') ?>" disabled>
                <i class="bi bi-arrow-up" aria-hidden="true"></i>
              </button>
              <span class="small fw-semibold text-truncate" id="uploadBreadcrumb" aria-live="polite"><?= te('modal.uploads.pick_folder.@') ?></span>
              <button type="button" class="btn btn-sm btn-outline-secondary ms-auto" id="uploadBtnRefresh" title="<?= te('common.refresh') ?>" aria-label="<?= te('common.refresh') ?>" disabled>
                <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
              </button>
            </div>

            <div class="border rounded mb-3" style="max-height: 40vh; overflow-y: auto;">
              <table class="table table-sm table-hover align-middle small mb-0" style="color:#212529;">
                <thead class="table-light" style="position: sticky; top: 0;">
                  <tr>
                    <th scope="col"><?= te('common.name') ?></th>
                    <th scope="col" class="text-end" style="width: 110px;"><?= te('modal.uploads.col.size') ?></th>
                    <th scope="col" style="width: 160px;" id="uploadDateHeader"><?= te('common.date') ?></th>
                    <!-- cancellazione dei file: solo amministratore (can_delete da list_dir, 2026-10-21) -->
                    <th scope="col" class="d-none" style="width: 44px;" id="uploadActionsHeader"><span class="visually-hidden"><?= te('modal.uploads.col.actions') ?></span></th>
                  </tr>
                </thead>
                <tbody id="uploadListing">
                  <tr><td colspan="4" class="text-muted"><?= te('modal.uploads.no_folder.@') ?></td></tr>
                </tbody>
              </table>
            </div>

            <div id="uploadDropzone"
                 class="card text-center border border-2 p-3 mb-3"
                 style="border-style:dashed !important; cursor:pointer;">
              <div class="text-muted">
                <?= te('modal.uploads.drop_hint.@') ?>
                <strong id="uploadTargetLabel">—</strong>
              </div>
              <div class="d-flex justify-content-center gap-2 mt-2">
                <button type="button" class="btn btn-sm btn-outline-primary" id="btnSelectFiles">
                  <?= te('modal.uploads.select_files') ?>
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="btnSelectFolder">
                  <?= te('modal.uploads.select_folder.@') ?>
                </button>
              </div>

              <input type="file" id="fileInput" multiple hidden aria-label="<?= te('modal.uploads.select_files') ?>">
              <input type="file" id="folderInput" webkitdirectory multiple hidden aria-label="<?= te('modal.uploads.select_folder.@') ?>">
            </div>

            <!-- CODA FILE -->
            <ul id="uploadQueue" class="list-group small"></ul>
          </div>

        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
        <button type="button" class="btn btn-primary" id="btnStartUpload" disabled>
          <?= te('modal.uploads.start') ?>
        </button>
      </div>

    </div>
  </div>
</div>
<!-- File JS esterno con caricamento files -->
<script type="module" src="ui/modal_uploads.js"></script>
