<?php
// --------------------------------------------------------------------------- //
// --------------------------     PHP BACKEND      --------------------------- //
// --------------------------------------------------------------------------- //
// NB: il file DEVE iniziare con <?php (nessun output prima di session_start/header)
//Controllo di Sessione
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

//--------------------------- Controllo di processo ------------------------//

// Protezione: se non sei loggato torni al login
if (!isset($_SESSION['user'])) {
    header('Location: index.php');
    exit;
}

// Se non è stata scelta una ricerca torniamo alla landing
if (!isset($_SESSION['res_id'])) {
    header('Location: researches.php');   // landing.php non esiste più
    exit;
}

// Se non è stato scelto un work package torniamo alla workpackages
if (!isset($_SESSION['wp_id'])) {
    header('Location: workpackages.php');
    exit;
}

// Assegna il riferimento della pagina chiamante per Header e Foother
$page_ref="dashboard";

//----------------- Recupero dati di Sessione --------------------------------//
$paths = $_SESSION['paths'];

$user = $_SESSION['user'];
$userId = (int)$user['id'];

// FIX (2026-09-16): $user è la riga COMPLETA della tabella users, incluso
// password_hash — non va mai esposta tale e quale al client (json_encode($user)
// finiva nel sorgente HTML, leggibile da chiunque apra "Visualizza sorgente").
// $userSafe è il sottoinsieme minimo che il JS di questa pagina usa davvero.
$userSafe = ['id' => $user['id'] ?? null, 'user_type' => $user['user_type'] ?? null];

$research = $_SESSION['research'];
$wpId = (int)$_SESSION['wp_id'];



//--------------------------- Collegamento DB --------------------------------//
require_once __DIR__ . '/api/db.php';
require_once __DIR__ . '/api/log_tool.php';
require_once __DIR__ . '/api/app_catalog.php';
require_once __DIR__ . '/api/i18n.php';
require_once __DIR__ . '/api/ui_level.php';
session_heartbeat('dashboard');
log_activity('page:visit', 'page', null, 'dashboard');


/// Work Package
// Attenzione questa SQL attribusice il permesso di visualizzazione agli utenti che non hanno altre azione su WP
// Ciò avviene perchè altrimenti bisognerebbe creare numerosissimi ermessi per il materiale pubblico che chiunque dovrebbe poter visualizzare.
// Per tenere un WP non pubblico, sarà il caso di agire sul wp_show che se 0 dovrebbbe mostare il wp solo a chi lo sta costruendo

$sql = "
SELECT 
    wp.*,
    COALESCE(uwp.perm, 'V') AS wp_perm
FROM workpackages AS wp
LEFT JOIN users_wp_permissions AS uwp
    ON uwp.wp_id = wp.wp_id
   AND uwp.user_id = :user_id
WHERE wp.wp_id = :wp_id
LIMIT 1
";



$stmt = $pdo->prepare($sql);
$stmt->execute([
    'user_id' => $userId,
    'wp_id'   => $wpId,
]);

$workpackage = $stmt->fetch(PDO::FETCH_ASSOC);

// Visibilità (api/visibility.php, _doc/arch-permessi.md §11.5): il WP deve appartenere alla
// ricerca aperta ed essere visibile all'utente. Prima di questo controllo bastava un wp_id
// in sessione (POST di workpackages.php) per aprire qualunque WP.
require_once __DIR__ . '/api/visibility.php';
$wpPermReal = ($workpackage && $workpackage['wp_perm'] !== 'V') ? $workpackage['wp_perm'] : null;
if ($workpackage === false
    || (int)$workpackage['res_id'] !== (int)($research['res_id'] ?? 0)
    || !ra_can_see_wp($user, $research['res_perm'] ?? null, (int)$workpackage['wp_show'], $wpPermReal)) {
    unset($_SESSION['wp_id'], $_SESSION['workpackage']);
    header('Location: workpackages.php');
    exit;
}

// ospiti: registro degli accessi (solo quando cambia il WP, non a ogni ricarica)
if (!empty($user['guest']) && (int)($_SESSION['workpackage']['wp_id'] ?? 0) !== (int)$workpackage['wp_id']) {
    require_once __DIR__ . '/api/guest_log.php';
    ra_guest_log('workpackage', (int)$workpackage['wp_id']);
}

/// Salviamo il workpackage in sessione
$_SESSION['workpackage'] = $workpackage;

// $showUOML serve già qui (classe sul <body>, prima che ui/header.php lo
// ricalcoli identico più sotto) per gestire lato CSS la visibilità del
// pulsante pannello "Flow embedded" — stessa formula di ui/header.php.
$showUOML =
    !empty($research) && !empty($workpackage) &&
    (
        $user['user_type'] === 'X' ||
        in_array($research['res_perm'], ['P'], true) ||
        in_array($workpackage['wp_perm'], ['W', 'I'], true)
    );


//<!-- MODALE OGGETTI RICERCA  -->
// Io credo tu debba inserire questa riga e toglere tutta cià che segue
//require_once __DIR__ . '/api/objects_tree.php'; 


// Carico i modelli dal DB (tabella objects)
$modelsGrouped = [];

try {
    $sql = "SELECT *
            FROM objects
            WHERE wp_id = :wp_id
            ORDER BY obj_type_A ASC, obj_type_B ASC, obj_name ASC";
                        
    $stmt = $pdo->prepare($sql);
    $stmt->execute(['wp_id' => $workpackage['wp_id']]);
    $objects = $stmt->fetchAll(PDO::FETCH_ASSOC);


    foreach ($objects as $row) {
    $typeA = $row['obj_type_A'] ?? 'Altro';
    $typeB = trim($row['obj_type_B'] ?? ''); // '' = nessun livello B
    $name  = $row['obj_name'] ?? '';

    if ($name === '') {
        continue;
    }

    if (!isset($modelsGrouped[$typeA])) {
        $modelsGrouped[$typeA] = [];
    }
    if (!isset($modelsGrouped[$typeA][$typeB])) {
        $modelsGrouped[$typeA][$typeB] = [];
    }

    $modelsGrouped[$typeA][$typeB][$name] = [
        'id'          => (int)($row['obj_id'] ?? 0),   // <-
        'description' => $row['obj_description'] ?? '',
        'app'         => $row['obj_app'] ?? '',
    ];
}

} catch (Exception $e) {
    $modelsGrouped = [];
        echo '<pre>';
        echo htmlspecialchars($e->getMessage());
        echo '</pre>';
}
?>


<!DOCTYPE html>
<html lang="<?= htmlspecialchars(ra_lang()) ?>">
<head>
    <meta charset="UTF-8" />
    <title><?= te('dashboard.page_title') ?> | <?= te('app.name') ?></title>

    <meta name="viewport" content="width=device-width, initial-scale=1">

    <!-- Lingue dell'interfaccia: window.RA_I18N + window.t / window.te (_doc/arch-i18n-a11y.md §2) -->
    <?= ra_i18n_head() ?>

    <!-- CSS Bootstrap 5 -->
    <link
        href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
        rel="stylesheet"
        integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH"
        crossorigin="anonymous"
    >
   <!-- Bootstrap Icons (opzionale ma comodo) -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">

    <!-- CSS Tabulator  -->
     <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist/css/tabulator.min.css"
    />

    <!-- CSS ReseArch  -->
    <link rel="stylesheet" href="css/ReseArch.css">

    <!-- LiteGraph.js CSS -->
    <!-- LiteGraph: copia locale modificata (fork leggero 0.7.18, lib/litegraph — _doc/arch-litegraph.md) -->
    <link rel="stylesheet" href="lib/litegraph/litegraph.css?v=0.7.18-research.7">

    <!-- Three.JS  -->
    <script type="importmap">
        {
        "imports": {
            "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
            "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/",
            "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.webgpu.js",
            "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.tsl.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/webgpu/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.webgpu.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/tsl/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.tsl.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/controls/TransformControls.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/controls/TransformControls.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/lines/Line2.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/lines/Line2.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/lines/LineGeometry.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/lines/LineGeometry.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/lines/LineMaterial.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/lines/LineMaterial.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/lines/LineSegments2.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/lines/LineSegments2.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/lines/LineSegmentsGeometry.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/lines/LineSegmentsGeometry.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/loaders/FontLoader.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/loaders/FontLoader.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/loaders/GLTFLoader.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/loaders/GLTFLoader.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/loaders/TTFLoader.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/loaders/TTFLoader.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/EffectComposer.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/EffectComposer.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/GTAOPass.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/GTAOPass.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/OutputPass.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/OutputPass.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/Pass.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/Pass.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/SMAAPass.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/SMAAPass.js",
            "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/renderers/CSS2DRenderer.js/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/renderers/CSS2DRenderer.js",
            "https://cdn.jsdelivr.net/npm/three@0.183.2/+esm": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
            "https://cdn.jsdelivr.net/npm/web-ifc@0.0.78/+esm": "https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/+esm" }
         }
    </script>
    <!-- rdflib.js — parser multi-formato RDF/OWL -->
    <script src="https://cdn.jsdelivr.net/npm/rdflib@2/dist/rdflib.min.js"></script>


    <!-- Dagre + Cytoscape + plugin layout gerarchico -->
    <script src="https://cdn.jsdelivr.net/npm/dagre@0.8/dist/dagre.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/cytoscape@3/dist/cytoscape.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/cytoscape-dagre@2/cytoscape-dagre.min.js"></script>

</head>
<body class="page-dashboard<?php echo $showUOML ? ' show-uoml' : ''; ?>">

<!-- HEADER ----------------- -->
<?php require __DIR__ . '/ui/header.php'; ?>

<!-- CONTENUTO CENTRALE (destinazione del link "Vai al contenuto") -->
<main id="main-content" tabindex="-1">
    <h1 class="visually-hidden"><?= te('dashboard.page_title') ?></h1>
    <!-- nessun bordo / margine a sinistra o destra -->
    <div class="dashboard-main">
        <div class="panel-wrapper">
            <div id="panelRoot"></div>
        </div>
    </div>
</main>

<!-- FOOTER -->
<footer class="app-footer">
  <?php require __DIR__ . '/ui/foother.php'; ?>
</footer>

<!-- MODALE OGGETTI SELEZIONE  -->
<?php require_once __DIR__ . '/ui/modal_tree_obj.php'; ?>

<!-- MODALE FLOW EMBEDDED — picker per-pannello (Scenario 3) -->
<?php if ($showUOML): ?>
<?php require_once __DIR__ . '/ui/modal_flow_embedded.php'; ?>
<?php endif; ?>

<!-- MODALE OGGETTI DEFINIZIONE  -->
<?php require_once __DIR__ . '/ui/modal_objects.php'; ?>

<!-- MODALE GESTIONE FOLDERS   -->
<?php require_once __DIR__ . '/ui/modal_sub_folders.php'; ?>

<!-- MODALE GESTIONE UPLOADS   -->
<?php require_once __DIR__ . '/ui/modal_uploads.php'; ?>

<!-- MODALE GESTIONE MODELLI   -->
<?php require_once __DIR__ . '/ui/modal_models.php'; ?>

<!-- MODALE AUTORI E COLLABORATORI di oggetti e modelli (passo 7 di arch-permessi §11.9) -->
<?php require_once __DIR__ . '/ui/modal_item_authors.php'; ?>

<!-- MODALE GESTIONE FLOW EMBEDDED (catalogo) -->
<?php require_once __DIR__ . '/ui/modal_flows.php'; ?>

<!-- MODALE GESTIONE MODELLI   -->
<?php require_once __DIR__ . '/ui/modal_objmod_links.php'; ?>

<!-- MODALE GESTIONE PERMESSI   -->
<?php require_once __DIR__ . '/ui/modal_permits.php'; ?>

<!-- MODALE CONFIGURAZIONI DASHBOARD — per tutti dal 2026-10-13 (sola lettura per chi non
     modifica, _doc/arch-permessi.md §11.7.1); stessa condizione di $showDashCfg in ui/header.php -->
<?php if (!empty($research) && !empty($workpackage)): ?>
<?php require_once __DIR__ . '/ui/modal_dashboard_cfg.php'; ?>
<?php endif; ?>

<!--  ---------------------------------------------------------------------------------------->
<!--  ------------------------------Librerie Javascript -------------------------------------->
<!--  ---------------------------------------------------------------------------------------->

<!-- Bootstrap JS -->
<script
    src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
    integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz"
    crossorigin="anonymous"
></script>
<!-- Chiudendo una modale, il focus non deve restare su un elemento al suo interno (es. il pulsante
     "Applica"): Bootstrap la nasconde con aria-hidden e il browser segnala "Blocked aria-hidden…".
     Regola unica per tutte le modali (2026-10-04). -->
<script>
    document.addEventListener('hide.bs.modal', (e) => {
        const a = document.activeElement;
        if (a && e.target.contains(a)) a.blur();
    });
</script>

<!-- Google Maps: chiave in cfg/cfg_google.php (escluso da git, modello cfg_google.example.php) -->
<?php
$ra_google = @include __DIR__ . '/cfg/cfg_google.php';
$ra_maps_key = is_array($ra_google) ? (string)($ra_google['maps_api_key'] ?? '') : '';
$ra_maps_ver = is_array($ra_google) ? (string)($ra_google['maps_version'] ?? 'weekly') : 'weekly';
if ($ra_maps_key !== ''): ?>
<script>
    (g => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement("script")); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a) })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)) })
        ({
            key: <?= json_encode($ra_maps_key) ?>,
            v: <?= json_encode($ra_maps_ver) ?>,
        });
</script>
<?php endif; ?>


<!--Tabulator  --> 
<script src="https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist/js/tabulator.min.js"></script>
<!-- Aiuti di accessibilità comuni (fuoco delle finestre, testi di Tabulator, righe da tastiera) -->
<script src="js/ra-a11y.js"></script>

<!--OpenseaDragon  -->
<script type="text/javascript" src="https://cdn.jsdelivr.net/npm/openseadragon@6.0.0/build/openseadragon/openseadragon.min.js"></script>


<!--Paper.JS  --> 
<script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/paper.js/0.12.17/paper-full.min.js"></script>
<script type="text/javascript" src="/_dev/lib/openseadragon-overlay/openseadragon-paperjs-overlay.js"></script>

<!--ECharts  -->
<script src="https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js"></script>

<!--PDF.js (espone window.pdfjsLib) -->
<script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"></script>

<!--LiteGraph.js (espone window.LiteGraph, window.LGraph, window.LGraphCanvas) -->
<!-- ?v= = versione del fork (lib/litegraph/README.md): ad ogni nuova patch va aggiornata, così il browser
     scarica subito il file nuovo anche se la regola di cache per lib/ mancasse -->
<script src="lib/litegraph/litegraph.js?v=0.7.18-research.16"></script>




<!-- PaSSAGGIO DATI pHp-> js -->
<script>
// Dati modelli dal server (user, research, workpackage)
const data_path = <?php echo json_encode($paths['data_path'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;

const user = <?php echo json_encode($userSafe, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP); ?>;
const research = <?php echo json_encode($research, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP); ?>;
const workpackage = <?php echo json_encode($workpackage, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP); ?>;
// Abilitazioni dell'utente (profili, _doc/arch-abilitazioni.md §4): solo per
// l'interfaccia, i controlli veri sono lato server.
const userCaps = <?php echo json_encode(user_caps_for_client($pdo, user_caps($pdo, $user)), JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP); ?>;
// Dati modelli dal server (raggruppati per obj_type -> obj_name)

const objects_levami = <?php echo json_encode($modelsGrouped, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP); ?>;
// Contesto dell'interfaccia (_doc/arch-i18n-a11y.md §5): level = livello di interazione (0-50),
// usato da app/template_XXX.mjs per nascondere gli strumenti con minLevel più alto. Solo interfaccia.
window.RA_CTX = <?php echo json_encode([
    'level'   => ra_ui_level($user, $research, $workpackage ?: null),
    'lang'    => ra_lang(),
    'profile' => ra_profile(),
    'resLang' => $research['res_lang'] ?? ra_lang(),
], JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP); ?>;
</script>


<!-- ---------------------------------------------------------------------------------------------------------------- -->
<!-- ---------------------------------------- Gestione Finestre Modali  --------------------------------------------- -->
<!-- ---------------------------------------------------------------------------------------------------------------- -->


<!-- Monitor: heartbeat sessione + icona utenti connessi -->
<script src="js/monitor.js"></script>

<!-- File JS esterno con gestione visualizazione oggetti -->
<script src="app/model_renderers.js"></script>


<!-- Collega l'evento click del menù all'apertura della modale inserisi oggetti -->
<script>
(function () {
  "use strict";

  const modalEl = document.getElementById('modalTreeObj');
  if (!modalEl) return;

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  // Event delegation: vale anche per voci aggiunte dopo (pannelli divisi, ecc.)
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.panel-models'); // voce "Oggetti"
    if (!btn) return;

    ev.preventDefault();

    // PANEL chiamante
    const panel = btn.closest('.panel');

    //rende disponibile il container principlae (pannello finestra) al JS della modale
    window.__TREEOBJ_CALLER_PANEL__ = panel;

    modal.show();
  });
})();
</script>

<?php if ($showUOML): ?>
<!-- Collega l'evento click del pulsante pannello "Flow embedded" alla modale picker -->
<script>
(function () {
  "use strict";

  const modalEl = document.getElementById('modalFlowEmbedded');
  if (!modalEl) return;

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.panel-flow-embedded'); // voce "Flow embedded"
    if (!btn) return;

    ev.preventDefault();

    const panel = btn.closest('.panel');
    window.__FLOWEMB_CALLER_PANEL__ = panel;

    modal.show();
  });
})();
</script>
<?php endif; ?>



<!-- File JS esterno con gestione permessi -->
<!-- <script type="module" src="ui/modal_permits.js"></script> -->

<!-- ---------------------------------------------------------------------------------------------------------------- -->
<!-- ---------------------------------------- Gestione Pannelli finestra -------------------------------------------- -->
<!-- ---------------------------------------------------------------------------------------------------------------- -->
<script type="module">
    import { initDashboardWindows } from "./ui/dashboard_windows.mjs";
    initDashboardWindows(document.getElementById("panelRoot"));
</script>

<?php if ($showUOML): ?>
<script type="module">
    import { initFlowToolbar } from "./app/FLE_sub_modules/FLE-toolbar.mjs";
    initFlowToolbar();
</script>
<?php endif; ?>

<!-- Modale configurazioni: per tutti (no-op se la modale non è nella pagina) -->
<script type="module">
    import { initDashboardCfg } from "./app/dashboard_cfg.mjs";
    initDashboardCfg();
</script>

<!-- Flow Runtime: esegue in background i flow dashboard della Config caricata (tutti gli utenti WP) -->
<script type="module">
    import { initFlowRuntime } from "./app/FLE_sub_modules/FLE-runtime.mjs";
    initFlowRuntime();
</script>

<!-- Config dashboard predefinita del WP: caricata all'apertura per tutti gli utenti
     (dopo il runtime, che ascolta 'dcfg:loaded') — _doc/arch-flow-dashboard.md §3.2 -->
<script type="module">
    import { loadDefaultConfig } from "./app/dashboard_cfg.mjs";
    loadDefaultConfig();
</script>

</body>
</html>
