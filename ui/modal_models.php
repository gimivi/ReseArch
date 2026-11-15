<?php
// modal_models.php (UPDATED)
// Testi da catalogo (lang/*.json, chiavi modal.models.*): _doc/arch-i18n-a11y.md §2.
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalModels" tabindex="-1" aria-labelledby="modalModelsLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <div class="modal-header">
        <h5 class="modal-title" id="modalModelsLabel"><?= te('modal.models.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="d-flex gap-2 align-items-center mb-2">
          <div class="small text-muted">
            <?= te('modal.models.wp.@') ?> <span id="modelsWpLabel"></span>
          </div>
          <div class="ms-auto small text-muted" id="modelsStatus" role="status" aria-live="polite"></div>
        </div>

        <div id="modelsTable"></div>

        <div class="alert alert-info mt-3 mb-0 small">
          <div><strong><?= te('modal.models.note_label') ?></strong> <?= te('modal.models.note_file.@') ?></div>
          <div><strong><?= te('modal.models.perm_label') ?></strong> <?= te('modal.models.perm_text.@') ?></div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" id="modelsBtnCancel" disabled><?= te('common.cancel') ?></button>
        <button type="button" class="btn btn-primary" id="modelsBtnSave" disabled><?= te('common.save') ?></button>
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>

<!-- Sub-modale: File Picker -->
<div class="modal fade" id="modalModelFilePicker" tabindex="-1" aria-labelledby="modalModelFilePickerLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <div class="modal-header">
        <h5 class="modal-title" id="modalModelFilePickerLabel"><?= te('modal.models.fp.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="row g-3">

          <div class="col-4 border-end">
            <div class="small text-muted mb-1"><?= te('modal.models.fp.subfolders.@') ?></div>
            <div id="modelFpFolders" class="list-group small"></div>
          </div>

          <div class="col-8">
            <div class="d-flex align-items-center gap-2 mb-1">
              <div class="small text-muted"><?= te('modal.models.fp.browser') ?></div>
              <button type="button" class="btn btn-outline-secondary btn-sm ms-auto" id="modelFpUpBtn"><span aria-hidden="true">⬆️</span> <?= te('modal.models.fp.up') ?></button>
              <button type="button" class="btn btn-outline-secondary btn-sm" id="modelFpRootBtn"><?= te('modal.models.fp.root') ?></button>
            </div>

            <div class="small text-muted mb-2" id="modelFpBreadcrumb"></div>

            <div class="row g-2">
              <div class="col-6">
                <div class="small text-muted mb-1"><?= te('modal.models.fp.dirs.@') ?></div>
                <div id="modelFpDirs" class="list-group small"></div>
              </div>
              <div class="col-6">
                <div class="small text-muted mb-1"><?= te('modal.models.fp.files') ?></div>
                <div id="modelFpFiles" class="list-group small"></div>
              </div>
            </div>

            <div class="small text-muted mt-2" id="modelFpHint" role="status" aria-live="polite"></div>
          </div>

        </div>
      </div>

      <div class="modal-footer">
        <!-- (2026-10-03) Modello senza file: l'APP parte senza caricare dati da file
             (li riceve per esempio da un flow); il mod_spec resta letto e configura l'APP. -->
        <button type="button" class="btn btn-outline-primary btn-sm me-auto" id="modelFpNoneBtn"
                title="<?= te('modal.models.fp.none_title') ?>">
          <?= te('modal.models.fp.none') ?>
        </button>
        <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal"><?= te('common.cancel') ?></button>
      </div>

    </div>
  </div>
</div>

<!-- Sub-modale: Spec Editor -->
<div class="modal fade" id="modalModelSpec" tabindex="-1" aria-labelledby="modalModelSpecLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <div class="modal-header">
        <h5 class="modal-title" id="modalModelSpecLabel"><?= te('modal.models.spec.title') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="d-flex gap-2 align-items-center mb-2">
          <label class="small text-muted" for="modelSpecTemplate"><?= te('modal.models.spec.template_label') ?></label>
          <select id="modelSpecTemplate" class="form-select form-select-sm" style="max-width: 280px;"></select>
          <div class="form-check form-check-inline small mb-0" title="<?= te('modal.models.spec.show_advanced_title') ?>">
            <input class="form-check-input" type="checkbox" id="modelSpecShowAdvanced">
            <label class="form-check-label" for="modelSpecShowAdvanced" style="color:#212529;"><?= te('modal.models.spec.show_advanced') ?></label>
          </div>

          <button type="button" class="btn btn-outline-secondary btn-sm" id="btnSpecValidate"><?= te('modal.models.spec.validate') ?></button>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="btnSpecFormat"><?= te('modal.models.spec.format') ?></button>

          <div class="ms-auto small" id="modelSpecStatus" role="status" aria-live="polite"></div>
        </div>

        <div id="modelSpecHelp"
             class="small mb-2"
             style="white-space: pre-wrap; max-height: 220px; overflow-y: auto;
                    color: #212529; border: 1px solid rgba(0,0,0,0.15); border-radius: 4px;
                    padding: 8px 10px; background: #f8f9fa;"><?= te('modal.models.spec.help_default') ?></div>

        <textarea id="modelSpecText"
                  class="form-control"
                  rows="14"
                  aria-label="<?= te('modal.models.spec.text_label') ?>"
                  aria-describedby="modelSpecTextHint modelSpecStatus"
                  style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;"></textarea>

        <div class="small text-muted mt-2" id="modelSpecTextHint">
          <?= te('modal.models.spec.must_be_valid') ?>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal"><?= te('common.cancel') ?></button>
        <button type="button" class="btn btn-primary btn-sm" id="btnSpecSave"><?= te('modal.models.spec.save') ?></button>
      </div>

    </div>
  </div>
</div>
<!-- File JS esterno con caricamento files -->
<script type="module" src="ui/modal_models.js"></script>
