<?php
// ui/modal_flows.php
// Elenco unico dei flow del WP — flow dell'oggetto (flow_type='object') e flow
// dashboard (flow_type='dashboard'), con un filtro per tipo (2026-10-04,
// _doc/arch-flow-dashboard.md §6; prima i flow dashboard avevano una modale a
// parte, "Dashboard Flow", eliminata). Stessa UX di ui/modal_objects.php (righe
// temporanee, duplica/elimina per riga, un solo Salva/Annulla a batch).
// Il contenuto del grafo si modifica dal pannello Flow Editor — qui solo
// metadati (nome, descrizione, visibilità); i collegamenti dalla modale Link.
// Testi: lang/*.json, chiavi modal.flows.* (_doc/arch-i18n-a11y.md §2).
require_once __DIR__ . '/../api/i18n.php';
$wpId = (int)($workpackage['wp_id'] ?? 0);
?>

<div class="modal fade" id="modalFlows" tabindex="-1" aria-labelledby="modalFlowsLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <div class="modal-header">
        <h5 class="modal-title" id="modalFlowsLabel"><?= te('modal.flows.title') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="d-flex align-items-center gap-2 mb-2">
          <span class="small text-muted" aria-hidden="true"><?= te('modal.flows.type_filter_label') ?></span>
          <div class="btn-group btn-group-sm" role="group" aria-label="<?= te('modal.flows.type_filter') ?>">
            <input type="radio" class="btn-check" name="flowsTypeFilter" id="flowsTypeAll" value="all" autocomplete="off" checked>
            <label class="btn btn-outline-secondary" for="flowsTypeAll"><?= te('common.all') ?></label>

            <input type="radio" class="btn-check" name="flowsTypeFilter" id="flowsTypeObject" value="object" autocomplete="off">
            <label class="btn btn-outline-secondary" for="flowsTypeObject"><i class="bi bi-box2 me-1" aria-hidden="true"></i><?= te('modal.flows.type.object.@') ?></label>

            <input type="radio" class="btn-check" name="flowsTypeFilter" id="flowsTypeDashboard" value="dashboard" autocomplete="off">
            <label class="btn btn-outline-secondary" for="flowsTypeDashboard"><i class="bi bi-layout-three-columns me-1" aria-hidden="true"></i><?= te('modal.flows.type.dashboard') ?></label>
          </div>
        </div>

        <div id="flows-table" style="height: 60vh;"></div>

        <div class="mt-2">
          <small class="text-muted" id="flowsStatus" role="status" aria-live="polite"></small>
        </div>

        <div class="alert alert-info mt-3 mb-0 small">
          <div><strong><?= te('modal.flows.note_label') ?></strong> <?= te('modal.flows.note.@') ?></div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" id="flowsBtnCancel" disabled><?= te('common.cancel') ?></button>
        <button type="button" class="btn btn-primary" id="flowsBtnSave" disabled><?= te('common.save') ?></button>
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>

<script>
  window.CURRENT_WP_ID_FLOWS = <?= (int)$wpId ?>;
</script>

<script type="module" src="ui/modal_flows.js"></script>
