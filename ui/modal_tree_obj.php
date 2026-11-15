<?php
// ui/modal_tree_obj.php
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalTreeObj" tabindex="-1" aria-labelledby="modalTreeObjLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="modalTreeObjLabel"><?= te('modal.tree_obj.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <div class="d-flex gap-2 align-items-center mb-2">
          <div class="small text-muted">
            <?= te('modal.tree_obj.wp_label.@') ?> <span id="treeObjWpLabel"></span>
          </div>
          <div class="ms-auto small text-muted" id="treeObjStatus" role="status" aria-live="polite"></div>
        </div>

        <div class="row g-3">
          <!-- Left: tree -->
          <div class="col-4 border-end">
            <div class="d-flex gap-2 align-items-center mb-2">
              <div class="small text-muted"><?= te('modal.tree_obj.tree_heading.@') ?></div>
              <button type="button" class="btn btn-outline-secondary btn-sm ms-auto" id="treeObjRefreshBtn"><?= te('common.refresh') ?></button>
            </div>

            <div id="treeObjContainer" class="small text-body"></div>


            <div class="small text-muted mt-2">
              <?= te('modal.tree_obj.tree_note.@') ?>
            </div>
          </div>

          <!-- Right: details -->
          <div class="col-8">
            <div class="d-flex align-items-center gap-2 mb-2">
              <div class="small text-muted" id="treeObjSelectedTitle"><?= te('modal.tree_obj.select_object.@') ?></div>
              <div class="ms-auto small text-muted" id="treeObjModelsCount"></div>
            </div>

            <div class="border rounded p-2 mb-2" style="min-height: 140px;">
              <div class="small text-muted mb-1"><?= te('modal.tree_obj.details_heading.@') ?></div>
              <div id="treeObjDetails" class="small text-body"></div>
            </div>




            <div class="border rounded p-2" style="min-height: 200px;">
            <div class="d-flex align-items-center mb-2">
                <div class="small text-muted"><?= te('modal.tree_obj.models_heading.@') ?></div>
                <button type="button" class="btn btn-primary btn-sm ms-auto" id="treeObjLoadBtn" disabled><?= te('modal.tree_obj.load') ?></button>
            </div>

            <div id="treeObjModelsArea"></div>
            </div>

            <div class="small text-muted mt-2 mb-2">
              <?= str_replace('{field}', '<code>mod_show</code>', te('modal.tree_obj.models_note.@')) ?>
            </div>

            <div class="border rounded p-2" style="min-height: 80px;">
              <div class="d-flex align-items-center mb-2">
                <div class="small text-muted"><?= te('modal.tree_obj.flows_heading') ?></div>
                <div class="ms-auto small text-muted" id="treeObjFlowsCount"></div>
              </div>

              <div id="treeObjFlowsArea"></div>
            </div>

            <div class="small text-muted mt-2">
              <?= te('modal.tree_obj.flows_note.@') ?>
            </div>
          </div>
        </div>

      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>
<!-- File JS esterno con caricamento files -->
<script type="module" src="ui/modal_tree_obj.js"></script>