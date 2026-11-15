<?php
// modal_mod_spec_templates.php
// Modale "Template mod_spec": gestione della tabella mod_spec_templates
// (template proposti nel sub-modale "Spec (JSON)" dei Modelli) + esportazione
// del seed SQL. Step 1 di _doc/arch-abilitazioni.md.
//
// Visibile solo all'amministratore (X), nella landing page — stessa regola di
// "Users Piattaforma" (ui/header.php, $showPlatformUsers). Inclusa da researches.php.
// Testi con colore esplicito: dentro i modali di questa app il testo senza
// colore eredita il bianco del body (vedi memoria bootstrap-modal-white-on-white).
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalModSpecTemplates" tabindex="-1" aria-labelledby="modalModSpecTemplatesLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <div class="modal-header">
        <h5 class="modal-title" id="modalModSpecTemplatesLabel"><?= te('modal.mod_spec_templates.title') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="row g-3">

          <!-- Elenco -->
          <div class="col-md-4">
            <div class="d-flex gap-2 mb-2">
              <select id="mstFilterApp" class="form-select form-select-sm" aria-label="<?= te('modal.mod_spec_templates.filter_app') ?>">
                <option value=""><?= te('modal.mod_spec_templates.all_apps') ?></option>
              </select>
              <button type="button" class="btn btn-outline-primary btn-sm text-nowrap" id="btnMstNew" title="<?= te('modal.mod_spec_templates.new_tpl') ?>">
                <i class="bi bi-plus-lg" aria-hidden="true"></i> <?= te('common.new') ?>
              </button>
            </div>
            <input type="search" id="mstSearch" class="form-control form-control-sm mb-2" placeholder="<?= te('modal.mod_spec_templates.search_name') ?>" aria-label="<?= te('modal.mod_spec_templates.search_name') ?>">
            <div id="mstList" class="list-group small" style="max-height: 60vh; overflow-y: auto;"></div>
          </div>

          <!-- Dettaglio -->
          <div class="col-md-8">
            <div id="mstEmpty" class="text-muted small"><?= te('modal.mod_spec_templates.select_tpl') ?></div>

            <form id="mstForm" class="d-none" autocomplete="off">
              <div class="row g-2 mb-2">
                <div class="col-md-4">
                  <label class="form-label small mb-1" for="mstApp"><?= te('modal.mod_spec_templates.field.app') ?></label>
                  <select id="mstApp" class="form-select form-select-sm"></select>
                </div>
                <div class="col-md-8">
                  <label class="form-label small mb-1" for="mstName"><?= te('common.name') ?></label>
                  <input type="text" id="mstName" class="form-control form-control-sm" maxlength="190">
                </div>
              </div>
              <div class="row g-2 mb-2 align-items-end">
                <div class="col-md-4">
                  <label class="form-label small mb-1" for="mstLevel"><?= te('modal.mod_spec_templates.field.level') ?></label>
                  <select id="mstLevel" class="form-select form-select-sm">
                    <option value="base"><?= te('modal.mod_spec_templates.level.base') ?></option>
                    <option value="advanced"><?= te('modal.mod_spec_templates.level.advanced') ?></option>
                  </select>
                </div>
                <div class="col-md-3">
                  <label class="form-label small mb-1" for="mstSort"><?= te('common.order') ?></label>
                  <input type="number" id="mstSort" class="form-control form-control-sm" step="10">
                </div>
                <div class="col-md-5">
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="mstActive">
                    <label class="form-check-label small" for="mstActive"><?= te('modal.mod_spec_templates.field.active') ?></label>
                  </div>
                </div>
              </div>
              <div class="mb-2">
                <label class="form-label small mb-1" for="mstHelp"><?= te('modal.mod_spec_templates.field.help') ?></label>
                <textarea id="mstHelp" class="form-control form-control-sm" rows="7"></textarea>
              </div>
              <div class="mb-2">
                <label class="form-label small mb-1" for="mstSpec"><?= te('modal.mod_spec_templates.field.spec') ?></label>
                <textarea id="mstSpec" class="form-control form-control-sm" rows="10"
                          style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;"></textarea>
              </div>
              <div class="d-flex gap-2 align-items-center">
                <button type="button" class="btn btn-primary btn-sm" id="btnMstSave"><?= te('common.save') ?></button>
                <button type="button" class="btn btn-outline-secondary btn-sm" id="btnMstDuplicate"><?= te('common.duplicate') ?></button>
                <button type="button" class="btn btn-outline-danger btn-sm ms-auto" id="btnMstDelete"><?= te('common.delete') ?></button>
              </div>
            </form>
          </div>
        </div>

        <div class="mt-2"><small class="text-muted" id="mstStatus" role="status" aria-live="polite"></small></div>
      </div>

      <div class="modal-footer">
        <a class="btn btn-outline-secondary me-auto" id="btnMstExport"
           href="ui/modal_mod_spec_templates_tools.php?action=export"
           title="<?= te('modal.mod_spec_templates.export_title') ?>">
          <i class="bi bi-download" aria-hidden="true"></i> <?= te('modal.mod_spec_templates.export') ?>
        </a>
        <button class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>
<script type="module" src="./ui/modal_mod_spec_templates.js"></script>
