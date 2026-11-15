<?php
// ui/modal_dashboard_cfg.php
// Modale gestione configurazioni pannelli dashboard (wp_dashboard_configs).
// Incluso da dashboard.php per chiunque abbia scelto ricerca e WP (2026-10-13,
// _doc/arch-permessi.md §11.7.1): chi non modifica la usa per caricare le configurazioni;
// i pulsanti si mostrano secondo i diritti che manda il server (app/dashboard_cfg.mjs).
// Testi: lang/*.json, chiavi modal.dashboard_cfg.* (_doc/arch-i18n-a11y.md §2).
// La logica (e i suoi testi) sta in app/dashboard_cfg.mjs.
require_once __DIR__ . '/../api/i18n.php';
?>

<div class="modal fade" id="modalDashboardCfg"
     tabindex="-1" aria-labelledby="dcfg-modal-title" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl dcfg-dialog">
    <div class="modal-content dcfg-content">

      <!-- ── Header ── -->
      <div class="modal-header dcfg-header">
        <span class="dcfg-title" id="dcfg-modal-title">
          <i class="bi bi-layout-three-columns me-1" aria-hidden="true"></i><?= te('modal.dashboard_cfg.title') ?>
        </span>
        <button type="button"
                class="btn-close btn-close-white ms-auto"
                data-bs-dismiss="modal"
                aria-label="<?= te('common.close') ?>"></button>
      </div>

      <!-- ── Toolbar ── -->
      <div class="dcfg-toolbar" role="group" aria-label="<?= te('modal.dashboard_cfg.toolbar') ?>">
        <button type="button" id="dcfg-btn-new"   class="btn btn-sm btn-outline-secondary" title="<?= te('modal.dashboard_cfg.save_current_hint') ?>">
          <i class="bi bi-plus-lg" aria-hidden="true"></i> <?= te('modal.dashboard_cfg.save_current') ?>
        </button>
        <button type="button" id="dcfg-btn-import" class="btn btn-sm btn-outline-secondary" title="<?= te('modal.dashboard_cfg.import_hint') ?>"
                aria-expanded="false" aria-controls="dcfg-import" hidden>
          <i class="bi bi-box-arrow-in-down" aria-hidden="true"></i> <?= te('modal.dashboard_cfg.import') ?>
        </button>
        <button type="button" id="dcfg-btn-overwrite" class="btn btn-sm btn-outline-warning" title="<?= te('modal.dashboard_cfg.overwrite_hint') ?>" disabled>
          <i class="bi bi-arrow-repeat" aria-hidden="true"></i> <?= te('modal.dashboard_cfg.overwrite') ?>
        </button>
        <button type="button" id="dcfg-btn-dup"   class="btn btn-sm btn-outline-secondary" title="<?= te('modal.dashboard_cfg.duplicate_hint') ?>" disabled>
          <i class="bi bi-copy" aria-hidden="true"></i> <?= te('common.duplicate') ?>
        </button>
        <button type="button" id="dcfg-btn-del"   class="btn btn-sm btn-outline-danger"    title="<?= te('modal.dashboard_cfg.delete_hint') ?>" disabled>
          <i class="bi bi-trash3" aria-hidden="true"></i> <?= te('common.delete') ?>
        </button>
        <div class="dcfg-sep" aria-hidden="true"></div>
        <button type="button" id="dcfg-btn-thumb" class="btn btn-sm btn-outline-secondary" title="<?= te('modal.dashboard_cfg.thumb_hint') ?>" disabled>
          <i class="bi bi-image" aria-hidden="true"></i> <?= te('modal.dashboard_cfg.thumb') ?>
        </button>
        <div class="dcfg-sep" aria-hidden="true"></div>
        <!-- Flow dashboard collegati alla configurazione (modale Link, bersaglio Dashboard) -->
        <button type="button" id="dcfg-btn-link"  class="btn btn-sm btn-outline-info"      title="<?= te('modal.dashboard_cfg.link_hint') ?>" disabled>
          <i class="bi bi-diagram-3" aria-hidden="true"></i> <?= te('modal.dashboard_cfg.link') ?>
        </button>
        <div class="dcfg-sep" aria-hidden="true"></div>
        <button type="button" id="dcfg-btn-apply" class="btn btn-sm btn-outline-success"   title="<?= te('modal.dashboard_cfg.apply_hint') ?>" disabled>
          <i class="bi bi-layout-wtf" aria-hidden="true"></i> <?= te('common.apply') ?>
        </button>
        <!-- Nessuna riga selezionata: Applica, Duplica e Sovrascrivi agiscono sulla riga scelta -->
        <span id="dcfg-select-hint" class="dcfg-readonly-note" hidden><?= te('app.dcfg.select_row') ?></span>
        <!-- Chi non crea né modifica configurazioni: solo scelta e caricamento -->
        <span id="dcfg-readonly-note" class="dcfg-readonly-note" hidden><?= te('modal.dashboard_cfg.readonly_note') ?></span>
      </div>

      <!-- ── Importa da un altro WP (dshp_share) ── -->
      <div id="dcfg-import" class="dcfg-import" hidden>
        <div class="dcfg-import-head">
          <label for="dcfg-import-scope" class="dcfg-import-label"><?= te('modal.dashboard_cfg.import_scope') ?></label>
          <select id="dcfg-import-scope" class="form-select form-select-sm dcfg-import-scope">
            <option value="res"><?= te('modal.dashboard_cfg.import_scope_res') ?></option>
            <option value="global"><?= te('modal.dashboard_cfg.import_scope_global') ?></option>
          </select>
        </div>
        <div id="dcfg-import-list" class="dcfg-import-list" aria-live="polite"></div>
      </div>

      <!-- ── Tabulator ── -->
      <div id="dcfg-table" class="dcfg-table" data-ra-rows="activate"></div>

      <!-- ── Preview thumbnail ── -->
      <div id="dcfg-preview" class="dcfg-preview" hidden>
        <img id="dcfg-preview-img" src="" alt="<?= te('modal.dashboard_cfg.preview_alt') ?>" class="dcfg-preview-img">
        <div id="dcfg-preview-desc" class="dcfg-preview-desc"></div>
      </div>

    </div><!-- /.modal-content -->
  </div><!-- /.modal-dialog -->
</div><!-- /#modalDashboardCfg -->


<style>
/* ─── Dialog & content ─────────────────────────────────────── */
.dcfg-dialog  { max-width: min(95vw, 1100px); }
.dcfg-content {
  height:         85vh;
  display:        flex;
  flex-direction: column;
  background:     #111827;
  color:          #e5e7eb;
  border:         1px solid #374151;
  border-radius:  6px;
  overflow:       hidden;
}

/* ─── Header ────────────────────────────────────────────────── */
.dcfg-header {
  background:    #1f2937;
  border-bottom: 1px solid #374151;
  padding:       0.35rem 0.75rem;
  flex-shrink:   0;
  min-height:    44px;
}
.dcfg-title {
  font-size:   0.9rem;
  color:       #e5e7eb;
  font-weight: 500;
}

/* ─── Toolbar ───────────────────────────────────────────────── */
.dcfg-toolbar {
  display:       flex;
  align-items:   center;
  gap:           6px;
  padding:       8px 12px;
  background:    #1a2232;
  flex-shrink:   0;
  border-bottom: 1px solid #1e293b;
}
.dcfg-sep {
  width: 1px; height: 22px;
  background: #374151;
  margin: 0 4px;
}

/* ─── Tabulator ─────────────────────────────────────────────── */
.dcfg-table {
  flex:       1;
  overflow:   auto;
  min-height: 0;
}
#dcfg-table .tabulator               { background: #111827; color: #e5e7eb; border: none; }
#dcfg-table .tabulator-header        { background: #1f2937; color: #9ca3af; border-bottom: 1px solid #374151; }
#dcfg-table .tabulator-col           { background: #1f2937; border-right: 1px solid #374151; }
#dcfg-table .tabulator-col-title     { color: #9ca3af; font-size: 0.75rem; }
#dcfg-table .tabulator-row           { background: #111827; border-bottom: 1px solid #1e293b; cursor: pointer; }
#dcfg-table .tabulator-row:hover     { background: #1f2937; }
#dcfg-table .tabulator-row-even      { background: #0f172a; }
#dcfg-table .tabulator-cell          { color: #d1d5db; font-size: 0.8rem; border-right: 1px solid #1e293b; padding: 5px 8px; }
#dcfg-table .tabulator-footer        { background: #1f2937; color: #9ca3af; border-top: 1px solid #374151; }  /* 6.1:1 (era #6b7280, 3:1) */
/* Config caricata nella dashboard (app/dashboard_cfg.mjs::rowFormatter) */
#dcfg-table .tabulator-row.dcfg-row-current   { box-shadow: inset 3px 0 0 #60a5fa; }
#dcfg-table .tabulator-row.dcfg-row-sel       { background: rgba(16,185,129,0.2) !important; }
#dcfg-table .tabulator-row.dcfg-row-sel:hover { background: rgba(16,185,129,0.3) !important; }

/* ─── Nota sola lettura e importazione ──────────────────────── */
.dcfg-readonly-note { margin-left: auto; font-size: 0.78rem; color: #9ca3af; }
.dcfg-import {
  flex-shrink:   0;
  max-height:    35vh;
  overflow:      auto;
  padding:       8px 12px;
  background:    #0f172a;
  border-bottom: 1px solid #1e293b;
}
.dcfg-import-head  { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.dcfg-import-label { font-size: 0.8rem; color: #d1d5db; }
.dcfg-import-scope { width: auto; }
.dcfg-import-empty { font-size: 0.8rem; color: #9ca3af; margin: 0; }
.dcfg-import-table { width: 100%; font-size: 0.8rem; color: #d1d5db; border-collapse: collapse; }
.dcfg-import-table th { color: #9ca3af; font-weight: 500; text-align: left; border-bottom: 1px solid #374151; padding: 4px 6px; }
.dcfg-import-table td { border-bottom: 1px solid #1e293b; padding: 4px 6px; vertical-align: middle; }

/* ─── Preview thumbnail ─────────────────────────────────────── */
.dcfg-preview {
  flex-shrink:   0;
  display:       flex;
  align-items:   center;
  gap:           12px;
  padding:       8px 12px;
  background:    #0f172a;
  border-top:    1px solid #1e293b;
}
.dcfg-preview-img {
  height:        80px;
  width:         auto;
  border:        1px solid #374151;
  border-radius: 4px;
  flex-shrink:   0;
}
.dcfg-preview-desc {
  font-size:  0.8rem;
  color:      #9ca3af;
  min-width:  0;
}
</style>
