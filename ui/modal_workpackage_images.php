<?php
// ui/modal_workpackage_images.php
require_once __DIR__ . '/../api/i18n.php';
?>
<div class="modal fade" id="modalWorkpackageImages" tabindex="-1" aria-labelledby="modalWorkpackageImagesTitle" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content text-body">

      <div class="modal-header">
        <h5 class="modal-title" id="modalWorkpackageImagesTitle"><?= te('modal.workpackage_images.title.@') ?></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <div class="modal-body">

        <div class="row g-3">
          <!-- DET 3:1 -->
          <div class="col-12">
            <div class="d-flex align-items-center justify-content-between mb-1">
              <div class="ra-label">
                <strong>wp_det.jpg</strong> — 3:1 — output 1200×400
                <span class="text-muted ms-2"><?= te('modal.workpackage_images.crop_help') ?></span>
              </div>
              <div class="d-flex gap-1">
                <input type="file" id="fileWpDet" accept="image/*" class="d-none">
                <button class="btn btn-outline-primary ra-icon-btn" type="button" id="btnSelectWpDet" title="<?= te('modal.workpackage_images.select_image_det') ?>" aria-label="<?= te('modal.workpackage_images.select_image_det') ?>">
                  <i class="bi bi-upload" aria-hidden="true"></i>
                </button>
                <button class="btn btn-outline-secondary ra-icon-btn" type="button" id="btnResetWpDet" title="<?= te('modal.workpackage_images.reset_view_det') ?>" aria-label="<?= te('modal.workpackage_images.reset_view_det') ?>">
                  <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div class="ra-dropzone ra-31" id="dzWpDet">
              <canvas id="cvWpDet" role="img" aria-label="<?= te('modal.workpackage_images.preview_det') ?>"></canvas>
              <div class="ra-hint" id="hintWpDet"><?= te('modal.workpackage_images.drop_hint') ?></div>
            </div>
          </div>

          <!-- ICO 1:1 -->
          <div class="col-12 col-lg-6">
            <div class="d-flex align-items-center justify-content-between mb-1">
              <div class="ra-label">
                <strong>wp_ico.jpg</strong> — 1:1 — output 400×400
                <span class="text-muted ms-2"><?= te('modal.workpackage_images.crop_help') ?></span>
              </div>
              <div class="d-flex gap-1">
                <input type="file" id="fileWpIco" accept="image/*" class="d-none">
                <button class="btn btn-outline-primary ra-icon-btn" type="button" id="btnSelectWpIco" title="<?= te('modal.workpackage_images.select_image_ico') ?>" aria-label="<?= te('modal.workpackage_images.select_image_ico') ?>">
                  <i class="bi bi-upload" aria-hidden="true"></i>
                </button>
                <button class="btn btn-outline-secondary ra-icon-btn" type="button" id="btnResetWpIco" title="<?= te('modal.workpackage_images.reset_view_ico') ?>" aria-label="<?= te('modal.workpackage_images.reset_view_ico') ?>">
                  <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div class="ra-dropzone ra-11" id="dzWpIco">
              <canvas id="cvWpIco" role="img" aria-label="<?= te('modal.workpackage_images.preview_ico') ?>"></canvas>
              <div class="ra-hint" id="hintWpIco"><?= te('modal.workpackage_images.drop_hint') ?></div>
            </div>
          </div>

          <div class="col-12 col-lg-6">
            <div class="alert alert-light border">
              <div class="mb-2"><strong><?= te('common.notes') ?></strong></div>
              <ul class="mb-0">
                <li><?= te('modal.workpackage_images.note.sizes') ?></li>
                <li><?= te('modal.workpackage_images.note.low_res') ?></li>
                <li><?= te('modal.workpackage_images.note.rename') ?></li>
                <li><?= te('modal.workpackage_images.note.limit') ?></li>
              </ul>
            </div>

            <div class="d-flex gap-2">
              <button type="button" class="btn btn-primary" id="btnSaveWpImages">
                <i class="bi bi-save" aria-hidden="true"></i> <?= te('common.save') ?>
              </button>
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
            </div>

            <div class="mt-3 d-none alert" id="wpImgMsg" role="status" aria-live="polite"></div>
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
    color: #555; font-size: 0.82rem;   /* #777 su #f2f2f2 non raggiungeva 4.5:1 */
    pointer-events: none;
    padding: 8px; text-align: center;
  }
  .ra-31  { aspect-ratio: 3 / 1; max-height: 400px; max-width: 1200px; }
  .ra-11  { aspect-ratio: 1 / 1; max-height: 400px; max-width: 400px; }
  .ra-label { font-size: 0.8rem; }
  .ra-icon-btn {
    width: 48px; height: 48px;
    padding: 0; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .ra-icon-btn i { font-size: 1.1rem; }
</style>

<script src="./ui/modal_workpackage_images.js"></script>
