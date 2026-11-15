<?php
// modal_db_maintenance.php
// Modale admin "Manutenzione database": cerca record orfani e dati vecchi, li mostra (Analizza,
// nessuna modifica) e toglie quelli scelti (Pulisci, in una transazione, con voce nel log).
// Visibile solo all'amministratore, nella landing page (ui/header.php, $showPlatformUsers).
// Inclusa da researches.php. Endpoint: api/db_maintenance_tool.php; soglie in cfg/cfg_maintenance.php.
// Prima di pulire: backup del database (phpMyAdmin → Esporta).
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalDbMaintenance" tabindex="-1" aria-labelledby="modalDbMaintenanceLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content bg-body text-body">

      <div class="modal-header">
        <h2 class="modal-title fs-5" id="modalDbMaintenanceLabel"><?= te('modal.db_maint.title') ?></h2>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">
        <p class="small mb-2"><?= te('modal.db_maint.intro') ?></p>
        <div class="alert alert-warning small py-2" role="note"><?= te('modal.db_maint.backup') ?></div>

        <div id="dbmTables"></div>
        <div id="dbmStatus" class="mt-2 small" role="status" aria-live="polite"></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-outline-primary" id="dbmAnalyze"><?= te('modal.db_maint.analyze') ?></button>
        <button type="button" class="btn btn-danger" id="dbmClean" disabled><?= te('modal.db_maint.clean') ?></button>
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>
    </div>
  </div>
</div>

<!-- Istruzioni per un controllo "da verificare a mano": significato, query per vedere le righe,
     passi e query per correggere. Si apre al posto della finestra principale (che torna alla chiusura). -->
<div class="modal fade" id="modalDbMaintHelp" tabindex="-1" aria-labelledby="modalDbMaintHelpLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-lg modal-dialog-scrollable">
    <div class="modal-content bg-body text-body">
      <div class="modal-header">
        <h2 class="modal-title fs-5" id="modalDbMaintHelpLabel"></h2>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>
      <div class="modal-body" id="dbmHelpBody"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('modal.db_maint.help.back') ?></button>
      </div>
    </div>
  </div>
</div>
<script type="module" src="ui/modal_db_maintenance.js"></script>
