<?php
// ui/modal_research_images.php
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalResearchImages" tabindex="-1" aria-hidden="true" aria-labelledby="modalResearchImagesTitle">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content bg-body text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="modalResearchImagesTitle"><?= te('modal.research_images.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">

        <div class="row g-3">
          <!-- DET 3:1 -->
          <div class="col-12">
            <div class="d-flex align-items-center justify-content-between mb-1">
              <div class="ra-label">
                <strong>research_det.jpg</strong> — 3:1 — output 1200×400
                <span class="text-muted ms-2"><?= te('modal.research_images.gesture_hint') ?></span>
              </div>
              <div class="d-flex gap-1">
                <input type="file" id="fileDet" accept="image/*" class="d-none">
                <button class="btn btn-outline-primary ra-icon-btn" type="button" id="btnSelectDet" title="<?= te('modal.research_images.select_image', ['file' => 'research_det.jpg']) ?>" aria-label="<?= te('modal.research_images.select_image', ['file' => 'research_det.jpg']) ?>">
                  <i class="bi bi-upload" aria-hidden="true"></i>
                </button>
                <button class="btn btn-outline-secondary ra-icon-btn" type="button" id="btnResetDet" title="<?= te('modal.research_images.reset_view', ['file' => 'research_det.jpg']) ?>" aria-label="<?= te('modal.research_images.reset_view', ['file' => 'research_det.jpg']) ?>">
                  <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div class="ra-dropzone ra-31" id="dzDet">
              <canvas id="cvDet"></canvas>
              <div class="ra-hint" id="hintDet"><?= te('modal.research_images.drop_hint') ?></div>
            </div>
          </div>

          <!-- Sotto DET: due colonne — sinistra ICO, destra i due loghi impilati -->
          <div class="col-12 col-lg-6">
            <div class="d-flex align-items-center justify-content-between mb-1">
              <div class="ra-label">
                <strong>research_ico.jpg</strong> — 1:1 — output 400×400
                <span class="text-muted ms-2"><?= te('modal.research_images.gesture_hint') ?></span>
              </div>
              <div class="d-flex gap-1">
                <input type="file" id="fileIco" accept="image/*" class="d-none">
                <button class="btn btn-outline-primary ra-icon-btn" type="button" id="btnSelectIco" title="<?= te('modal.research_images.select_image', ['file' => 'research_ico.jpg']) ?>" aria-label="<?= te('modal.research_images.select_image', ['file' => 'research_ico.jpg']) ?>">
                  <i class="bi bi-upload" aria-hidden="true"></i>
                </button>
                <button class="btn btn-outline-secondary ra-icon-btn" type="button" id="btnResetIco" title="<?= te('modal.research_images.reset_view', ['file' => 'research_ico.jpg']) ?>" aria-label="<?= te('modal.research_images.reset_view', ['file' => 'research_ico.jpg']) ?>">
                  <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div class="ra-dropzone ra-11" id="dzIco">
              <canvas id="cvIco"></canvas>
              <div class="ra-hint" id="hintIco"><?= te('modal.research_images.drop_hint') ?></div>
            </div>
          </div>

          <div class="col-12 col-lg-6">
            <div class="row g-3">
              <!-- LOGO RICERCA 4:1 -->
              <div class="col-12">
                <div class="d-flex align-items-center justify-content-between mb-1">
                  <div class="ra-label">
                    <strong>logo_ricerca.png</strong> — 4:1 — output 240×60
                    <span class="text-muted ms-2"><?= te('modal.research_images.gesture_hint') ?></span>
                  </div>
                  <div class="d-flex gap-1">
                    <input type="file" id="fileLogoR" accept="image/*" class="d-none">
                    <button class="btn btn-outline-primary ra-icon-btn" type="button" id="btnSelectLogoR" title="<?= te('modal.research_images.select_image', ['file' => 'logo_ricerca.png']) ?>" aria-label="<?= te('modal.research_images.select_image', ['file' => 'logo_ricerca.png']) ?>">
                      <i class="bi bi-upload" aria-hidden="true"></i>
                    </button>
                    <button class="btn btn-outline-secondary ra-icon-btn" type="button" id="btnResetLogoR" title="<?= te('modal.research_images.reset_view', ['file' => 'logo_ricerca.png']) ?>" aria-label="<?= te('modal.research_images.reset_view', ['file' => 'logo_ricerca.png']) ?>">
                      <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
                <div class="ra-dropzone ra-logo" id="dzLogoR">
                  <canvas id="cvLogoR"></canvas>
                  <div class="ra-hint" id="hintLogoR"><?= te('modal.research_images.drop_hint') ?></div>
                </div>
              </div>

              <!-- LOGO PARTNER 4:1 -->
              <div class="col-12">
                <div class="d-flex align-items-center justify-content-between mb-1">
                  <div class="ra-label">
                    <strong>logo_partner.png</strong> — 4:1 — output 240×60
                    <span class="text-muted ms-2"><?= te('modal.research_images.gesture_hint') ?></span>
                  </div>
                  <div class="d-flex gap-1">
                    <input type="file" id="fileLogoP" accept="image/*" class="d-none">
                    <button class="btn btn-outline-primary ra-icon-btn" type="button" id="btnSelectLogoP" title="<?= te('modal.research_images.select_image', ['file' => 'logo_partner.png']) ?>" aria-label="<?= te('modal.research_images.select_image', ['file' => 'logo_partner.png']) ?>">
                      <i class="bi bi-upload" aria-hidden="true"></i>
                    </button>
                    <button class="btn btn-outline-secondary ra-icon-btn" type="button" id="btnResetLogoP" title="<?= te('modal.research_images.reset_view', ['file' => 'logo_partner.png']) ?>" aria-label="<?= te('modal.research_images.reset_view', ['file' => 'logo_partner.png']) ?>">
                      <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
                <div class="ra-dropzone ra-logo" id="dzLogoP">
                  <canvas id="cvLogoP"></canvas>
                  <div class="ra-hint" id="hintLogoP"><?= te('modal.research_images.drop_hint') ?></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Colore ricerca (res_color) -->
          <div class="col-12 col-lg-4">
            <div class="border rounded p-3 h-100">
              <label class="mb-2 d-block" for="resColorPicker"><strong><?= te('modal.research_images.color.@') ?></strong> <span class="text-muted">(res_color)</span></label>
              <div class="d-flex align-items-center gap-2">
                <input type="color" class="form-control form-control-color" id="resColorPicker" value="#555555" title="<?= te('modal.research_images.pick_color') ?>" aria-describedby="resColorHelp">
                <input type="text" class="form-control" id="resColorHex" maxlength="7" placeholder="#RRGGBB" style="max-width:110px;" aria-label="<?= te('modal.research_images.color_hex') ?>" aria-describedby="resColorHelp">
              </div>
              <div class="form-text" id="resColorHelp"><?= te('modal.research_images.color_help.@') ?></div>
            </div>
          </div>

          <!-- Preview info / notes -->
          <div class="col-12 col-lg-8">
            <div class="alert alert-light border mb-3">
              <div class="mb-2"><strong><?= te('common.notes') ?></strong></div>
              <ul class="mb-0">
                <li><?= te('modal.research_images.note.crop') ?></li>
                <li><?= te('modal.research_images.note.low_res') ?></li>
                <li><?= te('modal.research_images.note.backup') ?></li>
              </ul>
            </div>
          </div>

          <div class="col-12">
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-primary" id="btnSaveResearchImages">
                <i class="bi bi-save" aria-hidden="true"></i> <?= te('common.save') ?>
              </button>
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
            </div>

            <div class="mt-3 d-none alert" id="imgMsg" role="status" aria-live="polite"></div>
          </div>
        </div>

      </div>

    </div>
  </div>
</div>

<style>
  .ra-dropzone {
    position: relative;
    width: 100%;
    border: 2px dashed #bbb;
    border-radius: 12px;
    background: #fafafa;
    overflow: hidden;
    user-select: none;
  }
  .ra-dropzone.dragover { border-color: #0d6efd; background: #f3f7ff; }
  .ra-dropzone canvas  { width: 100%; height: 100%; display: block; }
  .ra-hint {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #595959; font-size: 0.82rem;   /* contrasto >= 4.5:1 su #fafafa */
    pointer-events: none;
    padding: 8px; text-align: center;
  }
  /* Aspect-ratio containers */
  .ra-31   { aspect-ratio: 3 / 1; max-height: 400px; max-width: 1200px; }
  .ra-11   { aspect-ratio: 1 / 1; max-height: 400px; max-width: 400px; }
  .ra-logo { width: 240px; height: 60px; }   /* logo 4:1 dimensioni fisse */
  /* Etichette */
  .ra-label { font-size: 0.8rem; }
  /* Pulsanti icona 48×48 */
  .ra-icon-btn {
    width: 48px; height: 48px;
    padding: 0; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .ra-icon-btn i { font-size: 1.1rem; }
</style>

<script src="./ui/modal_research_images.js"></script>
