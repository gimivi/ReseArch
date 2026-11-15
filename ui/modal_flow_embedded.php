<?php
// ui/modal_flow_embedded.php
// Incluso da dashboard.php. Visibile solo a ruoli con $showUOML (vedi
// ui/header.php e la classe body.show-uoml in css/ReseArch.css che nasconde
// il pulsante pannello "Flow embedded" agli altri ruoli).
//
// Picker aperto dal pulsante header di ogni pannello ("Flow embedded",
// .panel-flow-embedded — vedi ui/dashboard_windows.mjs): permette di
// scegliere, fra gli oggetti attualmente caricati negli altri pannelli della
// dashboard, il contesto a cui embeddare un flow LiteGraph — aprendone uno
// già esistente o creandone uno nuovo — e apre model_FLE.mjs nel pannello
// chiamante in modalità "Flow embedded" (object.__embeddedTarget).
// Testi: lang/*.json, chiavi modal.flow_embedded.* (_doc/arch-i18n-a11y.md §2).
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalFlowEmbedded" tabindex="-1" aria-labelledby="modalFlowEmbeddedLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <div class="modal-header">
        <h5 class="modal-title" id="modalFlowEmbeddedLabel">
          <i class="bi bi-diagram-2 me-1" aria-hidden="true"></i><?= te('modal.flow_embedded.title') ?>
        </h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="small text-muted mb-2">
          <?= te('modal.flow_embedded.intro.@') ?>
        </div>

        <div class="row g-3">
          <!-- Left: Dashboard Config caricata + oggetti aperti in dashboard -->
          <div class="col-5 border-end">
            <div class="small text-muted mb-2" id="flowEmbPanelsTitle"><?= te('modal.flow_embedded.targets.@') ?></div>
            <div id="flowEmbPanelsArea" class="small text-body" role="group" aria-labelledby="flowEmbPanelsTitle"></div>
          </div>

          <!-- Right: flow embedded dell'oggetto selezionato -->
          <div class="col-7">
            <div class="small text-muted mb-2" id="flowEmbTargetTitle"><?= te('modal.flow_embedded.select_target.@') ?></div>
            <div id="flowEmbFlowsArea" class="small text-body" role="group" aria-labelledby="flowEmbTargetTitle"></div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <div class="small text-muted me-auto" id="flowEmbStatus" role="status" aria-live="polite"></div>
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.cancel') ?></button>
        <button type="button" class="btn btn-primary" id="flowEmbConfirmBtn" disabled><?= te('common.open') ?></button>
      </div>

    </div>
  </div>
</div>
<!-- File JS esterno -->
<script type="module" src="ui/modal_flow_embedded.js"></script>
