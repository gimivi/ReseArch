<?php
// modal_flow_review.php
// Modale "Validazione flow" (step 6 di _doc/arch-abilitazioni.md §5.5): coda
// dei flow con nodi critici in attesa, revisione del codice (senza eseguirlo),
// validazione singola o in blocco (solo admin), storico e revoca (solo admin).
// Inclusa da ui/header.php quando $showFlowReview (admin o permesso di profilo
// 'validate_flows'). Endpoint: api/flow_review_tool.php.
// Testi con colore esplicito: vedi memoria bootstrap-modal-white-on-white.
// Testi: lang/*.json, chiavi modal.flow_review.* (_doc/arch-i18n-a11y.md §2).
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalFlowReview" tabindex="-1" aria-labelledby="modalFlowReviewLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <div class="modal-header">
        <h5 class="modal-title" id="modalFlowReviewLabel"><?= te('modal.flow_review.title') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <p class="small text-muted mb-2">
          <?= te('modal.flow_review.intro_1') ?>
          <strong><?= te('modal.flow_review.intro_2') ?></strong>
          <?= te('modal.flow_review.intro_3.@') ?>
        </p>

        <div class="row g-3">
          <div class="col-md-4">
            <div class="d-flex gap-2 mb-2 align-items-center">
              <strong class="small" id="frQueueTitle"><?= te('modal.flow_review.pending_title') ?></strong>
              <span class="badge bg-secondary" id="frQueueCount">0</span>
              <button type="button" class="btn btn-outline-secondary btn-sm ms-auto" id="btnFrReload" title="<?= te('common.refresh') ?>" aria-label="<?= te('common.refresh') ?>">
                <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
              </button>
            </div>
            <div class="form-check small mb-1">
              <input class="form-check-input" type="checkbox" id="frIncludeApproved">
              <label class="form-check-label" for="frIncludeApproved"><?= te('modal.flow_review.include_approved') ?></label>
            </div>
            <div id="frQueue" class="list-group small" style="max-height: 60vh; overflow-y: auto;" role="group" aria-labelledby="frQueueTitle"></div>
            <div id="frBulkBox" class="mt-2 d-none">
              <button type="button" class="btn btn-outline-primary btn-sm w-100" id="btnFrBulk" disabled>
                <?= te('modal.flow_review.bulk_validate') ?> (<span id="frBulkCount">0</span>)
              </button>
              <p class="small text-muted mt-1 mb-0">
                <?= te('modal.flow_review.bulk_help') ?>
              </p>
            </div>
          </div>

          <div class="col-md-8">
            <div id="frEmpty" class="text-muted small"><?= te('modal.flow_review.empty') ?></div>
            <div id="frDetail" class="d-none">
              <h6 class="mb-1" id="frTitle"></h6>
              <div class="small text-muted mb-2" id="frMeta"></div>
              <div id="frCritical"></div>
              <div id="frRemoved" class="mt-2"></div>

              <div class="mt-3">
                <label class="form-label small mb-1" for="frNote"><?= te('modal.flow_review.note_label') ?></label>
                <input type="text" id="frNote" class="form-control form-control-sm" maxlength="500">
              </div>
              <div class="d-flex gap-2 mt-2">
                <button type="button" class="btn btn-success btn-sm" id="btnFrValidate"><?= te('modal.flow_review.validate') ?></button>
                <button type="button" class="btn btn-outline-secondary btn-sm ms-auto" id="btnFrHistory"><?= te('modal.flow_review.history') ?></button>
              </div>
              <div id="frHistory" class="mt-2 d-none"></div>
            </div>
          </div>
        </div>

        <div class="mt-2"><small class="text-muted" id="frStatus" role="status" aria-live="polite"></small></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>
<script type="module" src="./ui/modal_flow_review.js"></script>
