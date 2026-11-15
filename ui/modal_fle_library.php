<?php
// modal_fle_library.php
// Modale admin "Libreria nodi" (step 8 di _doc/arch-abilitazioni.md §6): nodi di
// libreria dei flow — codice validato, porte fisse, non modificabile da chi li usa.
// Ogni salvataggio crea una NUOVA versione: i flow restano sulla versione con cui
// sono stati costruiti finché l'autore non aggiorna il nodo (tasto destro).
// Visibile solo all'amministratore, nella landing page (ui/header.php,
// $showPlatformUsers). Inclusa da researches.php. Endpoint: api/fle_library_tool.php.
// Testi: lang/*.json, chiavi modal.fle_library.* (_doc/arch-i18n-a11y.md §2).
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalFleLibrary" tabindex="-1" aria-labelledby="modalFleLibraryLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <div class="modal-header">
        <h5 class="modal-title" id="modalFleLibraryLabel"><?= te('modal.fle_library.title') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <p class="small text-muted mb-2">
          <?= te('modal.fle_library.intro') ?>
        </p>
        <div class="row g-3">
          <div class="col-md-4">
            <button type="button" class="btn btn-outline-primary btn-sm w-100 mb-2" id="btnFlNew">
              <i class="bi bi-plus-lg" aria-hidden="true"></i> <?= te('modal.fle_library.new_node') ?>
            </button>
            <div id="flList" class="list-group small" style="max-height: 60vh; overflow-y: auto;" role="group" aria-label="<?= te('modal.fle_library.list') ?>"></div>
          </div>
          <div class="col-md-8">
            <div id="flEmpty" class="text-muted small"><?= te('modal.fle_library.empty') ?></div>
            <form id="flForm" class="d-none" autocomplete="off">
              <div class="row g-2 mb-2">
                <div class="col-md-5">
                  <label class="form-label small mb-1" for="flCategory"><?= te('modal.fle_library.category') ?></label>
                  <input type="text" id="flCategory" class="form-control form-control-sm" maxlength="60" aria-describedby="flFixedNote">
                </div>
                <div class="col-md-7">
                  <label class="form-label small mb-1" for="flName"><?= te('common.name') ?></label>
                  <input type="text" id="flName" class="form-control form-control-sm" maxlength="60" aria-describedby="flFixedNote">
                </div>
              </div>
              <div class="small text-muted mb-2" id="flFixedNote"></div>
              <div class="mb-2">
                <label class="form-label small mb-1" for="flDesc"><?= te('modal.fle_library.desc_label') ?></label>
                <textarea id="flDesc" class="form-control form-control-sm" rows="3"></textarea>
              </div>
              <div class="row g-2 mb-2">
                <div class="col-md-6">
                  <label class="form-label small mb-1" for="flInputs"><?= te('modal.fle_library.inputs_label') ?></label>
                  <input type="text" id="flInputs" class="form-control form-control-sm" placeholder="<?= te('modal.fle_library.inputs_placeholder') ?>">
                </div>
                <div class="col-md-6">
                  <label class="form-label small mb-1" for="flOutputs"><?= te('modal.fle_library.outputs_label') ?></label>
                  <input type="text" id="flOutputs" class="form-control form-control-sm" placeholder="<?= te('modal.fle_library.outputs_placeholder') ?>">
                </div>
              </div>
              <div class="mb-2">
                <?php /* {vars} nel testo diventa il nome della variabile in <code> (identificatore, non tradotto) */ ?>
                <label class="form-label small mb-1" for="flCode"><?= str_replace('{vars}', '<code>vars</code>', te('modal.fle_library.code_label')) ?></label>
                <textarea id="flCode" class="form-control form-control-sm" rows="12" spellcheck="false"
                          style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;"></textarea>
              </div>
              <button type="button" class="btn btn-primary btn-sm" id="btnFlSave"><?= te('modal.fle_library.save_version') ?></button>

              <h6 class="small fw-bold mt-3 mb-1" id="flVersionsTitle"><?= te('modal.fle_library.versions') ?></h6>
              <ul id="flVersions" class="list-group small" aria-labelledby="flVersionsTitle"></ul>
            </form>
          </div>
        </div>
        <div class="mt-2"><small class="text-muted" id="flStatus" role="status" aria-live="polite"></small></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>
<script type="module" src="./ui/modal_fle_library.js"></script>
