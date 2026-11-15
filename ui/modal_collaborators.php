<?php
// ui/modal_collaborators.php
// Elenco dei collaboratori (ruolo C) della ricerca o del work package selezionato, aperto dal
// pulsante "Collaboratori (N)" nella sintesi sull'immagine di dettaglio (researches.php,
// workpackages.php). Passo 7 di _doc/arch-permessi.md §11.9. Solo lettura: i nomi arrivano già
// con i dati della pagina (stesse persone visibili a chi vede la ricerca o il WP).
//
// Uso: window.raOpenCollaborators(titolo, ['Nome Cognome', ...], pulsanteDaRifocalizzare)
?>
<div class="modal fade" id="modalCollaborators" tabindex="-1" aria-labelledby="modalCollaboratorsTitle" aria-hidden="true">
  <div class="modal-dialog modal-dialog-scrollable modal-fullscreen-sm-down">
    <div class="modal-content bg-body text-body">
      <div class="modal-header">
        <h2 class="modal-title fs-5" id="modalCollaboratorsTitle"></h2>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>
      <div class="modal-body">
        <ul class="list-unstyled mb-0" id="modalCollaboratorsList"></ul>
        <p class="text-secondary mb-0" id="modalCollaboratorsEmpty" hidden><?= te('modal.collaborators.empty') ?></p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>
    </div>
  </div>
</div>
<script>
window.raOpenCollaborators = function (title, names, returnFocusEl) {
    const modalEl = document.getElementById('modalCollaborators');
    if (!modalEl || !window.bootstrap) return;
    document.getElementById('modalCollaboratorsTitle').textContent = title || '';
    const list = document.getElementById('modalCollaboratorsList');
    list.replaceChildren();
    (names || []).forEach(function (n) {
        const li = document.createElement('li');
        li.className = 'py-1 border-bottom';
        li.textContent = n;
        list.appendChild(li);
    });
    document.getElementById('modalCollaboratorsEmpty').hidden = (names || []).length > 0;
    if (returnFocusEl) {
        modalEl.addEventListener('hidden.bs.modal', function () { returnFocusEl.focus(); }, { once: true });
    }
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
};
</script>
