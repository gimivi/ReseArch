<?php
// modal_objmod_links.php
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalObjModLinks" tabindex="-1" aria-labelledby="modalObjModLinksLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content bg-body text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="modalObjModLinksLabel"><?= te('modal.objmod_links.title.objects_models.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <!--
        Links: unico modale per collegare/scollegare sia Models che Flows
        (flow_type='object') a un oggetto. Il toggle Models/Flows sotto
        sceglie quale catalogo mostrare nel tabulator; lo scope
        Workpackage/Ricerca/Globali a destra resta invariato per entrambi.
      -->


      <!--
        Bersaglio (2026-10-04, _doc/arch-flow-dashboard.md §7): in cima si sceglie
        A COSA si aggancia — Oggetti (predefinito) o Dashboard (le Dashboard Config
        del WP) —; sotto CHE COSA si aggancia (Models/Flows per gli oggetti, solo
        flow dashboard per le Config).
      -->
      <div class="modal-body">

        <div class="d-flex align-items-center gap-2 mb-3">
          <span class="small text-muted" id="objmodTargetCaption"><?= te('modal.objmod_links.link_to') ?></span>
          <div class="btn-group btn-group-sm" role="group" aria-labelledby="objmodTargetCaption">
            <input type="radio" class="btn-check" name="objmodTarget" id="objmodTargetObjects" autocomplete="off" checked>
            <label class="btn btn-outline-secondary" for="objmodTargetObjects"><i class="bi bi-box2 me-1" aria-hidden="true"></i><?= te('modal.objmod_links.target.objects.@') ?></label>

            <input type="radio" class="btn-check" name="objmodTarget" id="objmodTargetDash" autocomplete="off">
            <label class="btn btn-outline-secondary" for="objmodTargetDash"><i class="bi bi-layout-three-columns me-1" aria-hidden="true"></i><?= te('modal.objmod_links.target.dashboard') ?></label>
          </div>
        </div>

        <!-- BERSAGLIO (SOPRA): oggetti o Dashboard Config -->
        <div class="mb-3">
          <div class="d-flex align-items-center mb-2">
            <div class="small text-muted" id="objmodTargetLabel"><?= te('modal.objmod_links.target_label.objects.@') ?></div>
            <div class="ms-auto small text-muted"><?= te('modal.objmod_links.wp_label.@') ?> <span id="objmodWpLabel"></span></div>
          </div>

          <div id="objTable" aria-labelledby="objmodTargetLabel" data-ra-rows="activate"></div>
        </div>

        <hr class="my-3">

        <!-- MODELLI / FLOWS (SOTTO) -->
        <div>
          <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
            <div class="small text-muted" id="objmodAvailableLabel"><?= te('modal.objmod_links.available.models.@') ?></div>

            <div class="btn-group btn-group-sm" role="group" aria-label="<?= te('modal.objmod_links.kind_group') ?>" id="objmodKindGroup">
              <input type="radio" class="btn-check" name="objmodKind" id="objmodKindModels" autocomplete="off" checked>
              <label class="btn btn-outline-primary" for="objmodKindModels" id="objmodKindModelsLabel"><?= te('modal.objmod_links.kind.models.@') ?></label>

              <input type="radio" class="btn-check" name="objmodKind" id="objmodKindFlows" autocomplete="off">
              <label class="btn btn-outline-primary" for="objmodKindFlows"><?= te('modal.objmod_links.kind.flows') ?></label>
            </div>

            <div class="btn-group btn-group-sm ms-auto" role="group" aria-label="<?= te('modal.objmod_links.scope_group') ?>">
              <input type="radio" class="btn-check" name="objmodScope" id="objmodScopeWp" autocomplete="off" checked>
              <label class="btn btn-outline-primary" for="objmodScopeWp"><?= te('modal.objmod_links.scope.wp.@') ?></label>

              <input type="radio" class="btn-check" name="objmodScope" id="objmodScopeRes" autocomplete="off">
              <label class="btn btn-outline-primary" for="objmodScopeRes"><?= te('modal.objmod_links.scope.res.@') ?></label>

              <input type="radio" class="btn-check" name="objmodScope" id="objmodScopeGlobal" autocomplete="off">
              <label class="btn btn-outline-primary" for="objmodScopeGlobal"><?= te('modal.objmod_links.scope.global') ?></label>
            </div>
          </div>

          <div class="d-flex align-items-center mb-2">
            <div class="small text-muted" id="objmodSelectedObjHint" role="status" aria-live="polite">
              <?= te('modal.objmod_links.hint.objects.@') ?>
            </div>
            <div class="ms-auto small" id="objmodCounter" style="display:none;" role="status" aria-live="polite"></div>
          </div>

          <div id="modTable" aria-labelledby="objmodAvailableLabel"></div>

          <div class="alert alert-info mt-3 mb-0 small" id="objmodHelpAlert">
            <?= te('modal.objmod_links.help.models.@') ?>
          </div>
        </div>

      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="btnObjModCancel" data-bs-dismiss="modal"><?= te('common.cancel') ?></button>
        <button type="button" class="btn btn-primary" id="btnObjModSave" disabled><?= te('common.save') ?></button>
      </div>

    </div>
  </div>
</div>

<!-- File JS esterno con caricamento files -->
<script type="module" src="ui/modal_objmod_links.js"></script>
