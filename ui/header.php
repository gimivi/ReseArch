<?php
//Recupero dati di configurazione
$cfg = require __DIR__ . '/../cfg/cfg_ini.php';
require_once __DIR__ . '/../api/i18n.php';
// Nomi dei ruoli: dai cataloghi (role.<codice>.@), non più da cfg/roles.php

// Conteggio utenti attivi (log_tool già incluso dalla pagina chiamante)
if (!function_exists('get_active_count')) {
    require_once __DIR__ . '/../api/log_tool.php';
}
$_monitor_active = get_active_count();

// showFlowReview: modale "Validazione flow" (2026-09-28, step 6 di
// _doc/arch-abilitazioni.md) — amministratore o permesso di profilo
// 'validate_flows'. Su tutte le pagine: la coda è trasversale alle ricerche.
$showFlowReview = false;
try {
    if (isset($pdo) && is_array($user ?? null)) {
        if (!function_exists('user_caps')) require_once __DIR__ . '/../api/app_catalog.php';
        $showFlowReview = user_has_perm(user_caps($pdo, $user), 'validate_flows');
    }
} catch (Throwable $e) {
    $showFlowReview = ($user['user_type'] ?? '') === 'X';   // tabelle dei profili non ancora create
}

// showRshCE Ricerca Creazione e modifica - solo prima della selezione di una ricerca.
$showRshCE =
    (
      (empty($research))  &&
      in_array($user['user_type'], ['X', 'P'], true)

    );

// showPlatformUsers Gestione utenti piattaforma (users.user_type) — solo
// amministratore (X), solo nella landing page (nessuna ricerca selezionata).
// Aggiunto 2026-09-16 — vedi ui/modal_platform_users.php, incluso da researches.php.
$showPlatformUsers =
    (
      empty($research) &&
      $user['user_type'] === 'X'
    );

// showRshCP Ricerca Creazione modifica permessi - solo su ricerca corrente
$showRshP =
    (
      (!empty($research))  && empty($workpackage) &&
      in_array($user['user_type'], ['X', 'P'], true) 

    );    


    // showWpCP Workpackage Creazione e assegnazione Permessi
$showWpCE =
    !empty($research) && empty($workpackage) &&
    (
        $user['user_type'] === 'X' ||
        in_array($research['res_perm'], ['P', 'W'], true)
    );

    // showWpCP Workpackage Creazione e assegnazione Permessi
$showWpP =
    !empty($research) && !empty($workpackage) &&
    (
        $user['user_type'] === 'X' ||
        in_array($research['res_perm'], ['P'], true) ||
        in_array($workpackage['wp_perm'], ['W'], true)
    );

    // Per i diriti di operare sui folder del WP li setto uguali a quelli di operare sui permessi.
    // lascio però una diversa variabile per possibili cambi di visione futuri
    $showF= $showWpP;

    // showUOML Upload Object Model Links -> appaiono solo nella dasboard definiti rsh e Wp
    $showUOML =
    !empty($research) && !empty($workpackage) &&
    (
        $user['user_type'] === 'X' ||
        in_array($research['res_perm'], ['P'], true) ||
        in_array($workpackage['wp_perm'], ['W', 'I'], true)
     );

    // showItemsEdit: Oggetti, Modelli e Collegamenti anche al collaboratore (C) del WP,
    // che modifica gli elementi a cui è associato (2026-10-10, _doc/arch-permessi.md §11.2).
    // Upload, Flow e Dashboard restano a $showUOML. Il server decide riga per riga.
    $showItemsEdit = $showUOML ||
        (!empty($research) && !empty($workpackage) && ($workpackage['wp_perm'] ?? null) === 'C');
    // showDashCfg: configurazioni della dashboard per chiunque abbia scelto ricerca e WP
    // (2026-10-13, _doc/arch-permessi.md §11.7.1): chi non le modifica le vede e le carica
    // secondo dshp_show; il server decide riga per riga cosa si modifica.
    $showDashCfg = !empty($research) && !empty($workpackage);


?>


<!-- Link per saltare al contenuto (WCAG 2.4.1): primo elemento raggiungibile col Tab -->
<a href="#main-content" class="visually-hidden-focusable ra-skip-link"><?= te('a11y.skip_to_content') ?></a>

<header class="app-header d-flex align-items-center px-2">
  <!-- 2) Quadrato vuoto trasparente (sempre vuoto) -->
  <div class="slot-square flex-shrink-0 d-none d-sm-block">
  </div>

  <!-- 3) Spazio immagine 1 (max 4x altezza) — senza ricerca scelta: logo della piattaforma -->
  <?php if (!empty($research) && is_array($research)): ?>
  <div class="img-slot flex-shrink-0 d-none d-lg-flex">
      <img src="<?= htmlspecialchars($cfg['data_path'] ?? '') ?>/<?= htmlspecialchars($research['res_folder_name'] ?? '') ?>/logo_ricerca.png" alt="<?= te('header.logo_research.@') ?>" class="slot-img">
  </div>
  <?php else: ?>
  <div class="flex-shrink-0 d-flex align-items-center">
      <img src="img/Logo_Research_white.svg" alt="<?= te('app.name') ?>" width="48" height="48">
  </div>
  <?php endif; ?>

  <!-- 4) Titolo e sottotitolo ricerca  - Testo (max 5x altezza, fino a 3 righe) -->
  <div class="text-slot mx-2">
    <?php if (!empty($research) && is_array($research)): ?>
      <?php $_resLang = $research['res_lang'] ?? ''; // lingua dei contenuti (§3): lang solo se diversa dall'interfaccia ?>
      <div class="text-3lines"<?= ($_resLang !== '' && $_resLang !== ra_lang()) ? ' lang="' . htmlspecialchars($_resLang) . '"' : '' ?>>
        <span class="research-main"><?= htmlspecialchars($research['res_title'] ?? '') ?></span><br/>
        <span class="research-sub"><?= htmlspecialchars($research['res_subtitle'] ?? '') ?></span>
      </div>
    <?php endif; ?>
  </div>

  <!-- 6) Spazio immagine 2 (max 4x altezza) -->
  <div class="img-slot flex-shrink-0 d-none d-md-flex">
     <?php if (!empty($research) && is_array($research)): ?>
      <img src="<?= htmlspecialchars($cfg['data_path'] ?? '') ?>/<?= htmlspecialchars($research['res_folder_name'] ?? '') ?>/logo_partner.png" alt="<?= te('header.logo_partners') ?>" class="slot-img">
    <?php endif; ?>
  </div>

  <!-- 7) Div finale allineato a destra -->
  <div class="ms-auto right-slot d-flex align-items-center gap-2">

    <!-- Badge impersonazione (2026-09-16) — dentro l'header esistente
         (60px, overflow:hidden), non un elemento a parte: così
         HEADER_H/FOOTER_H (researches.php/workpackages.php, css/ReseArch.css)
         restano validi senza doverli ricalcolare per la sua presenza. -->
    <?php if (isset($_SESSION['impersonator']) && is_array($_SESSION['impersonator'])): ?>
      <?php $_impName = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) ?: ($user['email'] ?? ''); ?>
      <div class="d-flex align-items-center gap-1 px-2 rounded flex-shrink-0"
           style="background:#7c2d12;color:#fff;font-size:.78rem;height:32px;"
           role="status"
           title="<?= te('header.impersonating', ['name' => $_impName]) ?>">
        <i class="bi bi-incognito" aria-hidden="true"></i>
        <span class="visually-hidden"><?= te('header.impersonating', ['name' => $_impName]) ?></span>
        <span class="d-none d-md-inline" aria-hidden="true"><?= htmlspecialchars(($user['first_name'] ?? '') ?: ($user['email'] ?? '')) ?></span>
        <button type="button" id="btnImpersonateStop" class="btn btn-sm btn-light py-0 px-1 ms-1"
                title="<?= te('header.impersonate_stop') ?>" aria-label="<?= te('header.impersonate_stop') ?>">
          <i class="bi bi-box-arrow-left" aria-hidden="true"></i>
        </button>
      </div>
      <script src="./ui/impersonate_banner.js"></script>
    <?php endif; ?>

    <!-- Utenti connessi -->
    <?php
    $_monitor_no_modal = in_array($user['user_type'] ?? '', ['V', 'G'], true);
    $_monitor_label    = te('header.users_online', ['n' => (int)$_monitor_active]);
    $_monitor_icon     = $_monitor_active > 1
        ? '<span class="fw-bold" aria-hidden="true">' . (int)$_monitor_active . '</span><i class="bi bi-people" style="font-size:1.2rem;" aria-hidden="true"></i>'
        : '<i class="bi bi-person" style="font-size:1.2rem;" aria-hidden="true"></i>';
    ?>
    <?php if ($_monitor_no_modal): ?>
      <!-- V/G: solo icona, nessuna azione -->
      <span class="d-flex align-items-center gap-1 text-white-50 px-2" role="img"
            title="<?= $_monitor_label ?>" aria-label="<?= $_monitor_label ?>">
        <?= $_monitor_icon ?>
      </span>
    <?php else: ?>
      <!-- Altri: apre modale monitor -->
      <button type="button"
              id="btnMonitor"
              class="btn btn-link text-white d-flex align-items-center gap-1 text-decoration-none"
              data-bs-toggle="modal"
              data-bs-target="#modalMonitor"
              title="<?= $_monitor_label ?>" aria-label="<?= $_monitor_label ?>">
        <?= $_monitor_icon ?>
      </button>
    <?php endif; ?>

       <button
          class="btn btn-outline-light d-flex align-items-center"
          type="button"
          id="userMenuButton"
          data-bs-toggle="dropdown"
          aria-expanded="false"
        >
          <?php // ospite (account esterno, _doc/arch-sso-ospiti.md): non ha user_name, si mostra il nome dato dal fornitore ?>
          <span class="me-2"><?= htmlspecialchars(!empty($user['guest']) ? ($user['first_name'] ?? '') : ($user['user_name'] ?? '')) ?></span>
          <span class="visually-hidden"><?= te('header.user_menu') ?></span>
          <span style="font-size: 1.3rem; line-height: 1;" aria-hidden="true">☰</span>
        </button>


        <!-- VOCI DDW  -->
        <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="userMenuButton">

        <!-- ROLES (nomi da catalogo: role.<codice>.@, variabili per profilo) -->
            <li class="dropdown-header" title="<?= te('header.roles.tooltip') ?>"><?= te('header.roles.title') ?>:</li>
            <li class="dropdown-item-text small"><?= te('header.roles.platform') ?>: <?= te('role.' . ($user['user_type'] ?? '') . '.@') ?></li>
          <?php if (!empty($user['guest'])): ?>
            <li class="dropdown-item-text small text-wrap" style="max-width: 18rem;"><?= te('header.guest.via', ['provider' => ucfirst((string)($user['provider'] ?? ''))]) ?></li>
          <?php endif; ?>
          <?php if (!empty($research) && is_array($research) && !empty($research['res_perm'])): ?>
            <li class="dropdown-item-text small"><?= te('header.roles.research.@') ?>: <?= te('role.' . $research['res_perm'] . '.@') ?></li>
          <?php endif; ?>
          <?php if (!empty($workpackage) && is_array($workpackage) && !empty($workpackage['wp_perm'])): ?>
            <li class="dropdown-item-text small"><?= te('header.roles.workpackage.@') ?>: <?= te('role.' . $workpackage['wp_perm'] . '.@') ?></li>
          <?php endif; ?>
          <li><hr class="dropdown-divider"></li>

        <!-- GESTIONE RICERCHE E WORK PACKAGE   EDITING e PERMESSI-->
        <?php if ($showRshCE || $showWpCE): ?>
          <li class="dropdown-header" title="<?= te('header.manage.tooltip') ?>"><?= te('header.manage.title') ?>:</li>
        <?php endif; ?>

        <?php if ($showRshCE): ?>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalResearches"><?= te('header.menu.researches.@') ?></a></li>
        <?php endif; ?>

        <?php if ($showWpCE): ?>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalWorkpackages"><?= te('header.menu.workpackages.@') ?></a></li>
        <?php endif; ?>

        <?php if ($showRshCE || $showWpCE): ?>
           <li><hr class="dropdown-divider"></li>
        <?php endif; ?>

        <!-- GESTIONE FOLDERS, UPOLOADS, OGGETTI, MODELLI, LINKS -->
        <?php if ($showF): ?>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalSubFolders"><i class="bi bi-folder2 me-1" aria-hidden="true"></i><?= te('header.menu.folders') ?></a></li>
        <?php endif; ?>

        <?php if ($showUOML): ?>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalUpload"><i class="bi bi-upload me-1" aria-hidden="true"></i><?= te('header.menu.uploads') ?></a></li>
        <?php endif; ?>
        <?php if ($showItemsEdit): ?>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#objectsEditModal"><i class="bi bi-box2 me-1" aria-hidden="true"></i><?= te('header.menu.objects.@') ?></a></li>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalModels"><i class="bi bi-files me-1" aria-hidden="true"></i><?= te('header.menu.models.@') ?></a></li>
        <?php endif; ?>
        <?php if ($showUOML): ?>
          <!-- Flows — elenco unico dei flow del WP (oggetto + dashboard, filtro per tipo).
               La vecchia voce "Dashboard Flow" (modalFlowList) è stata eliminata il
               2026-10-04, vedi _doc/arch-flow-dashboard.md -->
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalFlows"><i class="bi bi-diagram-3 me-1" aria-hidden="true"></i><?= te('header.menu.flows') ?></a></li>
        <?php endif; ?>
        <?php if ($showItemsEdit): ?>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalObjModLinks"><i class="bi bi-link-45deg me-1" aria-hidden="true"></i><?= te('header.menu.links') ?></a></li>
        <?php endif; ?>
        <?php if ($showDashCfg): ?>
          <!-- Dashboard — configurazioni dashboard: layout pannelli, predefinita, flow collegati -->
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalDashboardCfg"><i class="bi bi-layout-three-columns me-1" aria-hidden="true"></i><?= te('header.menu.dashboard') ?></a></li>
        <?php endif; ?>

        <?php if ($showF || $showItemsEdit || $showDashCfg): ?>
          <li><hr class="dropdown-divider"></li>
        <?php endif; ?>

      <!-- GESTIONE PERMESSI RICERCHE E WORK PACKAGE-->
        <?php if ($showRshP || $showWpP || $showPlatformUsers || $showFlowReview): ?>
          <li class="dropdown-header" title="<?= te('header.manage.tooltip') ?>"><?= te('header.permissions.title') ?>:</li>
        <?php endif; ?>

        <?php if ($showRshP): ?>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalResPermits"><?= te('header.menu.users_research.@') ?></a></li>
        <?php endif; ?>

        <?php if ($showWpP): ?>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalWpPermits"><?= te('header.menu.users_workpackage.@') ?></a></li>
        <?php endif; ?>

        <?php if ($showPlatformUsers): ?>
          <!-- Users Piattaforma (2026-09-16), Template mod_spec (step 1), Abilitazioni (step 2),
               Libreria nodi (step 8) di _doc/arch-abilitazioni.md: solo amministratore, landing -->
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalPlatformUsers"><?= te('header.menu.users_platform') ?></a></li>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalModSpecTemplates"><?= te('header.menu.mod_spec_templates') ?></a></li>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalCapabilities"><?= te('header.menu.capabilities') ?></a></li>
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalFleLibrary"><?= te('header.menu.node_library') ?></a></li>
          <!-- Manutenzione database: orfani e pulizia periodica (ui/modal_db_maintenance.php) -->
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalDbMaintenance"><?= te('header.menu.db_maintenance') ?></a></li>
        <?php endif; ?>

        <?php if ($showFlowReview): ?>
          <!-- Validazione flow con nodi critici (2026-09-28, step 6) -->
          <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#modalFlowReview"><?= te('header.menu.flow_review') ?></a></li>
        <?php endif; ?>

        <?php if ($showRshP || $showWpP || $showPlatformUsers || $showFlowReview): ?>
           <li><hr class="dropdown-divider"></li>
        <?php endif; ?>

        <!-- LINGUA DELL'INTERFACCIA (_doc/arch-i18n-a11y.md §2.3) — solo se c'è più di un catalogo -->
        <?php $_langs = ra_langs(); if (count($_langs) > 1): ?>
            <li class="dropdown-header" title="<?= te('header.lang.change') ?>"><?= te('header.lang.title') ?>:</li>
          <?php foreach ($_langs as $_code => $_name): $_isCur = ($_code === ra_lang()); ?>
            <li>
              <button type="button" class="dropdown-item d-flex align-items-center gap-2 ra-lang-option"
                      data-lang="<?= htmlspecialchars($_code) ?>" lang="<?= htmlspecialchars($_code) ?>"
                      <?= $_isCur ? 'aria-current="true"' : '' ?>>
                <i class="bi<?= $_isCur ? ' bi-check2' : '' ?>" aria-hidden="true" style="width:1em"></i>
                <?= htmlspecialchars($_name) ?>
                <?php if ($_isCur): ?><span class="visually-hidden">(<?= te('header.lang.current') ?>)</span><?php endif; ?>
              </button>
            </li>
          <?php endforeach; ?>
            <li><hr class="dropdown-divider"></li>
        <?php endif; ?>

        <!-- USER COMMAND  -->
            <li class="dropdown-header"><?= te('header.user.title') ?>:</li>
          <?php if (empty($user['guest'])): ?>
            <li><a class="dropdown-item" href="account.php"><?= te('header.menu.profile') ?></a></li>
          <?php else: ?>
            <li><a class="dropdown-item" href="register.php"><?= te('header.guest.register') ?></a></li>
          <?php endif; ?>
            <li><a class="dropdown-item text-danger" href="logout.php"><?= te('header.menu.logout') ?></a></li>
       </ul>

</div>
</header>

<script>
  // Scelta della lingua dal menu utente: salva e ricarica (js/i18n.js → api/set_lang.php)
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ra-lang-option');
    if (!btn || btn.getAttribute('aria-current') === 'true') return;
    window.raI18n?.setLang(btn.dataset.lang);
  });
</script>

<?php if (!$_monitor_no_modal): ?>
<?php require_once __DIR__ . '/modal_monitor.php'; ?>
<?php endif; ?>
<?php if ($showFlowReview): ?>
<?php require_once __DIR__ . '/modal_flow_review.php'; ?>
<?php endif; ?>

<style>
  /* 1) altezza e colore da variabile JS */
  .app-header{
    height:60px;
    overflow:hidden;
    /* fallback */
    background:<?= htmlspecialchars($research['res_color'] ?? '') ?>;
  }

  /* 2) quadrato vuoto */
  .slot-square{
    width:60px;
    height:60px;
  }

  /* 3/6) slot immagine: alto 90, largo max 360 (4x90), taglio */
  .img-slot{
    height:60px;
    width:360px;        /* 4 * 90 */
    overflow:hidden;
  }
  .slot-img{
    height:100%;
    
    object-fit:cover;   /* taglia se troppo grande/lunga */
    display:block;
  }

  /* 4) testo: max 450px (5x90) e max 3 righe */
  .text-slot{
    max-width:450px;    /* 5 * 90 */
    min-width:0;        /* importante per ellissi in flex */
  }
  .text-3lines{
    display:-webkit-box;
    -webkit-line-clamp:3;
    -webkit-box-orient:vertical;
    overflow:hidden;
    line-height:1.2;
  }
</style>





