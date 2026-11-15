<?php
// modal_capabilities.php
// Modale admin "Abilitazioni" (step 2 di _doc/arch-abilitazioni.md), due schede:
//   - Profili: profili di abilitazione, con abilitazioni e utenti assegnati;
//   - APP: accesso / stato / ordine delle APP (tabella `app`).
// Visibile solo all'amministratore (X), nella landing page — stessa regola di
// "Users Piattaforma" (ui/header.php, $showPlatformUsers). Inclusa da researches.php.
// Testi con colore esplicito: vedi memoria bootstrap-modal-white-on-white.
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalCapabilities" tabindex="-1" aria-labelledby="modalCapabilitiesLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <div class="modal-header">
        <h5 class="modal-title" id="modalCapabilitiesLabel"><?= te('modal.capabilities.title') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <ul class="nav nav-tabs mb-3" role="tablist">
          <li class="nav-item" role="presentation">
            <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#capTabProfiles" type="button" role="tab" aria-controls="capTabProfiles"><?= te('modal.capabilities.tab.profiles') ?></button>
          </li>
          <li class="nav-item" role="presentation">
            <button class="nav-link" data-bs-toggle="tab" data-bs-target="#capTabApps" type="button" role="tab" aria-controls="capTabApps"><?= te('modal.capabilities.tab.apps') ?></button>
          </li>
          <li class="nav-item" role="presentation">
            <button class="nav-link" data-bs-toggle="tab" data-bs-target="#capTabCsp" type="button" role="tab" aria-controls="capTabCsp" id="capTabCspBtn">CSP</button>
          </li>
        </ul>

        <div class="tab-content">

          <!-- ============================== PROFILI -->
          <div class="tab-pane fade show active" id="capTabProfiles" role="tabpanel">
            <div class="row g-3">
              <div class="col-md-3">
                <button type="button" class="btn btn-outline-primary btn-sm w-100 mb-2" id="btnCapNewProfile">
                  <i class="bi bi-plus-lg" aria-hidden="true"></i> <?= te('modal.capabilities.new_profile') ?>
                </button>
                <div id="capProfileList" class="list-group small"></div>
                <p class="small text-muted mt-2 mb-0">
                  <?= te('modal.capabilities.profiles_help.@') ?>
                </p>
              </div>

              <div class="col-md-9">
                <div id="capProfileEmpty" class="text-muted small"><?= te('modal.capabilities.select_profile') ?></div>

                <form id="capProfileForm" class="d-none" autocomplete="off">
                  <div class="row g-2 mb-2">
                    <div class="col-md-4">
                      <label class="form-label small mb-1" for="capProfileName"><?= te('common.name') ?></label>
                      <input type="text" id="capProfileName" class="form-control form-control-sm" maxlength="100">
                    </div>
                    <div class="col-md-8">
                      <label class="form-label small mb-1" for="capProfileDesc"><?= te('common.description') ?></label>
                      <input type="text" id="capProfileDesc" class="form-control form-control-sm" maxlength="255">
                    </div>
                  </div>
                  <div class="form-check mb-3">
                    <input class="form-check-input" type="checkbox" id="capProfileDefault">
                    <label class="form-check-label small" for="capProfileDefault">
                      <?= te('modal.capabilities.default_all') ?>
                    </label>
                  </div>

                  <div class="row g-3">
                    <div class="col-md-6">
                      <h6 class="small fw-bold mb-1"><?= te('modal.capabilities.tab.apps') ?></h6>
                      <p class="small text-muted mb-1">
                        <?= te('modal.capabilities.apps_grant_help.@') ?>
                      </p>
                      <div id="capGrantApps" class="border rounded p-2 small" style="max-height: 220px; overflow-y: auto;"></div>

                      <h6 class="small fw-bold mt-3 mb-1"><?= te('modal.capabilities.section.templates') ?></h6>
                      <div class="form-check small">
                        <input class="form-check-input" type="checkbox" id="capGrantTplAdvanced">
                        <label class="form-check-label" for="capGrantTplAdvanced"><?= te('modal.capabilities.tpl_advanced') ?></label>
                      </div>

                      <h6 class="small fw-bold mt-3 mb-1"><?= te('modal.capabilities.section.perms') ?></h6>
                      <div id="capGrantPerms" class="small"></div>
                    </div>

                    <div class="col-md-6" id="capMembersBox">
                      <h6 class="small fw-bold mb-1"><?= te('modal.capabilities.members') ?> <span class="text-muted fw-normal" id="capMembersCount"></span></h6>
                      <input type="search" id="capMembersSearch" class="form-control form-control-sm mb-1" placeholder="<?= te('modal.capabilities.members_search') ?>" aria-label="<?= te('modal.capabilities.members_search') ?>">
                      <div class="form-check small mb-1">
                        <input class="form-check-input" type="checkbox" id="capMembersOnlySel">
                        <label class="form-check-label" for="capMembersOnlySel"><?= te('modal.capabilities.members_only_sel') ?></label>
                      </div>
                      <div id="capMembers" class="border rounded p-2 small" style="max-height: 300px; overflow-y: auto;"></div>
                    </div>
                  </div>

                  <div class="d-flex gap-2 mt-3">
                    <button type="button" class="btn btn-primary btn-sm" id="btnCapSaveProfile"><?= te('modal.capabilities.save_profile') ?></button>
                    <button type="button" class="btn btn-outline-danger btn-sm ms-auto" id="btnCapDeleteProfile"><?= te('modal.capabilities.delete_profile') ?></button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <!-- ============================== APP -->
          <div class="tab-pane fade" id="capTabApps" role="tabpanel">
            <p class="small text-muted mb-2">
              <strong><?= te('modal.capabilities.col.access') ?></strong>: <?= te('modal.capabilities.apps_help.access.@') ?>
              <strong><?= te('common.status') ?></strong> <?= te('modal.capabilities.apps_help.hidden.@') ?>
              <?= te('modal.capabilities.apps_help.rule') ?>
            </p>
            <table class="table table-sm align-middle small" style="color:#212529;">
              <thead>
                <tr><th scope="col" style="width:70px;"><?= te('modal.capabilities.col.code') ?></th><th scope="col"><?= te('modal.capabilities.col.app') ?></th><th scope="col" style="width:200px;"><?= te('modal.capabilities.col.access') ?></th><th scope="col" style="width:150px;"><?= te('common.status') ?></th><th scope="col" style="width:100px;"><?= te('common.order') ?></th></tr>
              </thead>
              <tbody id="capAppsBody"></tbody>
            </table>
            <button type="button" class="btn btn-primary btn-sm" id="btnCapSaveApps" disabled><?= te('modal.capabilities.save_apps') ?></button>
          </div>

          <!-- ============================== CSP -->
          <div class="tab-pane fade" id="capTabCsp" role="tabpanel">
            <p class="small text-muted mb-2">
              <?= str_replace('{mode}', '<strong>Report-Only</strong>', te('modal.capabilities.csp_help')) ?>
            </p>
            <div class="d-flex gap-2 mb-2">
              <button type="button" class="btn btn-outline-secondary btn-sm" id="btnCapCspReload"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> <?= te('common.refresh') ?></button>
              <button type="button" class="btn btn-outline-danger btn-sm ms-auto" id="btnCapCspClear"><?= te('modal.capabilities.csp_clear') ?></button>
            </div>
            <div style="max-height: 55vh; overflow-y: auto;">
              <table class="table table-sm align-middle small" style="color:#212529;">
                <thead>
                  <tr><th scope="col"><?= te('modal.capabilities.csp_col.directive') ?></th><th scope="col"><?= te('modal.capabilities.csp_col.blocked') ?></th><th scope="col"><?= te('modal.capabilities.csp_col.page') ?></th><th scope="col" class="text-end"><?= te('modal.capabilities.csp_col.hits') ?></th><th scope="col"><?= te('modal.capabilities.csp_col.last') ?></th></tr>
                </thead>
                <tbody id="capCspBody"></tbody>
              </table>
            </div>
          </div>

        </div>

        <div class="mt-2"><small class="text-muted" id="capStatus" role="status" aria-live="polite"></small></div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div>
  </div>
</div>
<script type="module" src="./ui/modal_capabilities.js"></script>
