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
    header('Location: index.php');   // login.php non esiste
    exit;
}

// Se non è stata scelta una ricerca torniamo alla pagina ricerche
if (!isset($_SESSION['res_id'])) {
    header('Location: researches.php');
    exit;
}

//SE È  POST -----//
//--------------------------- Salvataggio Id work package ------------------------//
// Se l'utente ha confermato il work package
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['selected_wp_id'])) {
    $wpId = (int)$_POST['selected_wp_id'];
    if ($wpId > 0) {
        $_SESSION['wp_id'] = $wpId;
        // Log selezione work package
        require_once __DIR__ . '/api/db.php';
        require_once __DIR__ . '/api/log_tool.php';
        session_heartbeat('workpackages');
        log_activity('workpackage:select', 'workpackage', $wpId, '');
        header('Location: dashboard.php');
        exit;
    }
}


//SE NON È POST -------//
//--------------------------- Collegamento DB --------------------------------//
require_once __DIR__ . '/api/db.php';
require_once __DIR__ . '/api/log_tool.php';
session_heartbeat('workpackages');
log_activity('page:visit', 'page', null, 'workpackages');

//----------------- Recupero dati di Sessione --------------------------------//
$paths = $_SESSION['paths'];

$user   = $_SESSION['user'];
//Utente 
$user   = $_SESSION['user'];
$userId = (int)$user['id'];
//Ricerca  selezionata
$resId  = (int)$_SESSION['res_id'];

// RUOLI -------------------------------------------//
// Ruoli Work Package (future-proof: basta estendere questi array)
$WP_RESP_ROLES  = ['W'];   // Responsabile
$WP_MEMB_ROLES  = ['I'];   // Partecipanti

// Helper per creare placeholder IN (:p0,:p1,...) e mappa parametri
function buildInParams(array $values, string $prefix): array {
    $placeholders = [];
    $params = [];
    foreach (array_values($values) as $i => $v) {
        $ph = ':' . $prefix . $i;
        $placeholders[] = $ph;
        $params[$ph] = $v;
    }
    return [$placeholders, $params];
}

[$respPh, $respParams] = buildInParams($WP_RESP_ROLES, 'wpr');
[$membPh, $membParams] = buildInParams($WP_MEMB_ROLES, 'wpm');

// SELEZIONA DATI DELLA RICERCA SELEZIONATA --------------//
// Nota: manteniamo il comportamento "come prima": la ricerca deve essere accessibile all'utente.
$sql = "
SELECT
    r.*,
    ur.perm AS res_perm,
    f.folder_name AS res_folder_name,

    (
        SELECT GROUP_CONCAT(CONCAT(u.first_name,' ',u.last_name) ORDER BY u.last_name SEPARATOR ', ')
        FROM users_res_permissions urp
        JOIN users u ON u.id = urp.user_id
        WHERE urp.res_id = r.res_id
          AND urp.perm IN ('P')
    ) AS res_pi,

    (
        SELECT GROUP_CONCAT(CONCAT(u.first_name,' ',u.last_name) ORDER BY u.last_name SEPARATOR ', ')
        FROM users_res_permissions urp
        JOIN users u ON u.id = urp.user_id
        WHERE urp.res_id = r.res_id
          AND urp.perm IN ('W','I')
    ) AS res_investigator

FROM researches r
LEFT JOIN users_res_permissions ur
  ON ur.res_id = r.res_id
 AND ur.user_id = :user_id
LEFT JOIN folders f
  ON f.folder_id = r.res_folder_id
WHERE r.res_id = :res_id
LIMIT 1
";

$stmt = $pdo->prepare($sql);
$stmt->execute([
    ':res_id'  => $resId,
    ':user_id' => $userId,
]);
$research = $stmt->fetch(PDO::FETCH_ASSOC);

// Visibilità: scala unica 0-4 (api/visibility.php, _doc/arch-permessi.md §11.5).
// Chi non è membro apre la ricerca se res_show glielo consente (res_perm resta null).
require_once __DIR__ . '/api/visibility.php';
if ($research !== false && !ra_can_see_research($user, (int)$research['res_show'], $research['res_perm'] ?? null)) {
    $research = false;
}

// Salviamo la ricerca in Sessione
if ($research !== false) {
    // ospiti: registro degli accessi (solo quando cambia la ricerca, non a ogni ricarica)
    if (!empty($user['guest']) && (int)($_SESSION['research']['res_id'] ?? 0) !== (int)$research['res_id']) {
        require_once __DIR__ . '/api/guest_log.php';
        ra_guest_log('research', (int)$research['res_id']);
    }
    $_SESSION['research'] = $research;
} else {
    // Se la ricerca non è accessibile, torniamo alla pagina ricerche
    header('Location: researches.php');
    exit;
}

//--------------------------- Lista WorkPackages della ricerca selezionata ---------------------------//

// La ricerca è già visibile (controllo sopra). Ogni WP ha il proprio wp_show,
// valutato per riga con ra_can_see_wp() (scala 0-4, _doc/arch-permessi.md §11.5).
$resPerm = $research['res_perm'] ?? null;      // perm su research (P/W/I/C), null se non membro

{
    // LEFT JOIN su users_wp_permissions: i WP visibili anche a chi non ne è membro
    $sql = "
    SELECT
        wp.*,
        uwp.perm AS wp_perm,
        fwp.folder_name AS wp_folder_name,

        (
            SELECT GROUP_CONCAT(CONCAT(u.first_name,' ',u.last_name) ORDER BY u.last_name SEPARATOR ', ')
            FROM users_wp_permissions uwp2
            JOIN users u ON u.id = uwp2.user_id
            WHERE uwp2.wp_id = wp.wp_id
              AND uwp2.perm IN ('W')
        ) AS wp_responsabile,

        (
            SELECT GROUP_CONCAT(CONCAT(u.first_name,' ',u.last_name) ORDER BY u.last_name SEPARATOR ', ')
            FROM users_wp_permissions uwp2
            JOIN users u ON u.id = uwp2.user_id
            WHERE uwp2.wp_id = wp.wp_id
              AND uwp2.perm IN ('I')
        ) AS wp_membri,

        (
            SELECT GROUP_CONCAT(CONCAT(u.first_name,' ',u.last_name) ORDER BY u.last_name SEPARATOR '|')
            FROM users_wp_permissions uwp2
            JOIN users u ON u.id = uwp2.user_id
            WHERE uwp2.wp_id = wp.wp_id
              AND uwp2.perm = 'C'
        ) AS wp_collaborators

    FROM workpackages wp
    LEFT JOIN users_wp_permissions uwp
      ON uwp.wp_id = wp.wp_id
     AND uwp.user_id = :user_id
    LEFT JOIN folders fwp
      ON fwp.folder_id = wp.wp_folder_id
    WHERE wp.res_id = :res_id
    ";

    $params = [
        ':user_id' => $userId,
        ':res_id'  => $resId,
    ];

    $sql .= " ORDER BY wp.wp_ord, wp.wp_title ASC ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $workpackages = array_values(array_filter(
        $stmt->fetchAll(PDO::FETCH_ASSOC),
        fn(array $wp): bool => ra_can_see_wp($user, $resPerm, (int)$wp['wp_show'], $wp['wp_perm'] ?? null)
    ));
}

$page_ref = 'work_package';
?>

<!-- --------------------------------------------------------------------------- -->
<!-- -------------------------- Formattazione HTML   --------------------------- -->
<!-- --------------------------------------------------------------------------- -->
<!DOCTYPE html>
<html lang="<?php require_once __DIR__ . '/api/i18n.php'; echo htmlspecialchars(ra_lang()); ?>">
<head>
    <meta charset="UTF-8">
    <title><?php require_once __DIR__ . '/api/i18n.php'; echo te('workpackages.page_title.@') . ' | ' . te('app.name'); ?></title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <?php require_once __DIR__ . '/api/i18n.php'; echo ra_i18n_head(); ?>

    <!-- Bootstrap CSS (opzionale ma comodo) -->
    <link rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
          integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH"
          crossorigin="anonymous">

    <!-- Bootstrap Icons (opzionale ma comodo) -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">


    <!-- CSS Tabulator  -->
     <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist/css/tabulator.min.css"
    />

    <!-- ReseArch CSS  -->
    <link rel="stylesheet" href="css/ReseArch.css">
</head>
<body>

<!-- HEADER ----------------- -->
<?php require __DIR__ . '/ui/header.php'; ?>

<!-- CENTRALE (contenuto principale: destinazione del link "Vai al contenuto") -->
<div class="landing-stage" id="main-content" role="main" tabindex="-1">
<h1 class="visually-hidden"><?= te('workpackages.page_title.@') ?></h1>
<div class="landing-wrapper">
    <?php if (empty($workpackages)): ?>
        <p><?= te('workpackages.none.@') ?></p>

        <?php if (
            $user['user_type'] === 'X' ||
            (!empty($research) && in_array($research['res_perm'] ?? null, ['P', 'W'], true))
        ): ?>
            <!-- a chi può creare WP (stessa regola di $showWpCE in ui/header.php): rimando al menu principale -->
            <p><?= te('workpackages.none_create_hint.@', ['menu' => t('header.menu.workpackages.@')]) ?></p>
        <?php endif; ?>

    <?php else: ?>
        <form id="wpForm" method="post">
            <input type="hidden" name="selected_wp_id" id="selected_wp_id" value="">

            <!-- METÀ SUPERIORE: thumb + dots -->
            <div class="upper-half" id="upperHalf">
                <div class="thumb-row" id="thumbRow" role="group" aria-label="<?= te('workpackages.list.@') ?>"></div>
                <div class="dots-row" id="dotsRow" role="group" aria-label="<?= te('common.pages') ?>"></div>
            </div>

            <!-- RIGA 3: immagine grande -->
            <div class="detail-wrapper" id="detailWrapper">
                <img id="detailImage" alt="">
                <div class="detail-overlay" aria-live="polite" aria-atomic="true">
                    <div class="detail-title" id="detailTitle"></div>
                    <div class="detail-subtitle" id="detailSubtitle"></div>
                    <div class="detail-resp" id="detailResp"></div>
                    <div class="detail-other" id="detailOther"></div>
                    <!-- Collaboratori (C): elenco in ui/modal_collaborators.php (passo 7 di arch-permessi §11.9) -->
                    <div class="detail-collab" id="detailCollab" hidden>
                        <span id="detailCollabText"></span>
                        <button type="button" class="detail-collab-btn" id="detailCollabBtn" hidden></button>
                    </div>
                </div>

                <!-- Immagine di dettaglio mancante, per chi non ha il tasto di modifica (css: .detail-missing-note) -->
                <div class="detail-missing-note" id="detailMissingNote"><?= te('landing.image_missing.l1') ?><br><?= te('landing.image_missing.l2') ?></div>

                <!-- BOTTONI IN ALTO A DESTRA (solo in edit) -->

            <?php if (
                    !empty($research) && empty($workpackage) &&
                    (
                        $user['user_type'] === 'X' ||
                        in_array($research['res_perm'], ['P', 'W'], true)
                    )
                ): ?>
                <div class="detail-actions-top" id="detailActionsTop" >
                    <button type="button" class="btn action-btn" title="<?= te('workpackages.edit.@') ?>" aria-label="<?= te('workpackages.edit.@') ?>" onclick="workpackage_images_edit()">
                        <i class="bi bi-pencil-square" aria-hidden="true"></i>
                    </button>
                </div>
            <?php endif; ?>

            <!-- BOTTONE IN BASSO A DESTRA (sempre presente) -->
                <div class="detail-actions-bottom">
                    <button type="submit" class="btn action-btn" title="<?= te('workpackages.open.@') ?>" aria-label="<?= te('workpackages.open.@') ?>">
                        <i class="bi bi-door-open" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
        </form>
    <?php endif; ?>
</div><!-- /.landing-wrapper -->
</div><!-- /.landing-stage -->

<!-- FOOTER ----------------- -->
<footer class="app-footer">
  <?php require __DIR__ . '/ui/foother.php'; ?>
</footer>

<!-- MODALS ----------------- -->
<!-- Gestione tabella work packages -->
<?php require __DIR__ . '/ui/modal_workpackages.php'; ?>
<!-- Gestione immagini work packages -->
<?php require __DIR__ . '/ui/modal_workpackage_images.php'; ?>
<?php require __DIR__ . '/ui/modal_collaborators.php'; ?>

<!-- MODALE GESTIONE PERMESSI   -->
<?php require_once __DIR__ . '/ui/modal_permits.php'; ?>

<!-- --------------------------------------------------------------------------- -->
<!-- -----------------------   Javascript FRONTEND      ----------------------- -->
<!-- --------------------------------------------------------------------------- -->

<!-- CARICAMENTO LIBRERIE JS -->
<!-- Bootstrap JS -->
<script
    src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
    integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz"
    crossorigin="anonymous"
></script>

<!--Tabulator  --> 
<script src="https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist/js/tabulator.min.js"></script>
<!-- Aiuti di accessibilità comuni (fuoco delle finestre, testi di Tabulator, righe da tastiera) -->
<script src="js/ra-a11y.js"></script>


<!-- SCRIPT JS DI PAGINA -->
<script>
    // Dati PHP -> JS
    const data_path    = <?php echo json_encode($paths['data_path'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
    const workpackages = <?php echo json_encode($workpackages, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
    const research     = <?php echo json_encode($research, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
    const userType     = <?php echo json_encode($user['user_type']); ?>;

    // Necessario per modal_workpackage_images.js (oggetto singolo, non array)
    window.research = research;

    let currentPage   = 0;
    let selectedIndex = 0;

    // ─── Costanti layout (identiche a researches.php) ──────────────────────────
    const HEADER_H       = 60;
    const FOOTER_H       = 30;
    const MARGIN         = 30;
    const DETAIL_RATIO   = 3;
    const MAX_DETAIL_H   = 400;
    const MIN_THUMB      = 64;
    const MAX_THUMB      = 400;
    const THUMB_TEXT_MIN = 256;

    let _thumbCount = 1;
    let _thumbSize  = 200;
    let _showText   = true;

    function getPageSize()   { return _thumbCount; }
    function getPagesCount() { return Math.ceil(workpackages.length / _thumbCount); }

    // ─── Motore di layout ──────────────────────────────────────────────────────
    // Telefono (< 768px, fase 6 di _doc/arch-i18n-a11y.md §7): niente proporzioni fisse 3:2.
    // Tre miniature per riga, immagine di dettaglio 3:1 a tutta larghezza e testo SOTTO
    // l'immagine (CSS); la pagina scorre in verticale invece di restringersi.
    const PHONE_MAX_W = 767.98;
    const PHONE_GAP   = 16;    // margine laterale sul telefono (px)

    function calcPhoneLayout() {
        const availW    = window.innerWidth - 2 * PHONE_GAP;
        const thumbSize = Math.min(MAX_THUMB, Math.max(MIN_THUMB, Math.floor((availW - 16) / 3)));
        return {
            phone:      true,
            H:          Math.round(availW / DETAIL_RATIO),
            formW:      Math.round(availW),
            formH:      null,
            thumbAreaH: thumbSize + 8,
            dotsAreaH:  44,
            thumbSize,
            thumbCount: Math.max(1, Math.floor(availW / (thumbSize + 8))),
            showText:   false,
        };
    }

    function calcLayout() {
        if (window.innerWidth <= PHONE_MAX_W) return calcPhoneLayout();
        const availW = window.innerWidth  - 2 * MARGIN;
        const availH = window.innerHeight - HEADER_H - FOOTER_H - 2 * MARGIN;

        const H = Math.min(MAX_DETAIL_H, availW / DETAIL_RATIO, availH / 2);

        const formW      = DETAIL_RATIO * H;
        const formH      = 2 * H;
        const thumbAreaH = 0.75 * H;
        const dotsAreaH  = 0.25 * H;
        const thumbSize  = Math.min(MAX_THUMB, Math.max(MIN_THUMB, thumbAreaH));
        const thumbCount = Math.max(1, Math.floor(formW / thumbSize));
        const showText   = thumbSize >= THUMB_TEXT_MIN;

        return {
            H:          Math.round(H),
            formW:      Math.round(formW),
            formH:      Math.round(formH),
            thumbAreaH: Math.round(thumbAreaH),
            dotsAreaH:  Math.round(dotsAreaH),
            thumbSize:  Math.round(thumbSize),
            thumbCount,
            showText,
        };
    }

    function applyLayout() {
        const L = calcLayout();

        _thumbCount = L.thumbCount;
        _thumbSize  = L.thumbSize;
        _showText   = L.showText;

        const wrapper = document.querySelector('.landing-wrapper');
        if (wrapper) {
            wrapper.style.width  = L.formW + 'px';
            wrapper.style.height = L.formH ? L.formH + 'px' : '';   // telefono: altezza libera
        }

        const upperHalf = document.getElementById('upperHalf');
        if (upperHalf) upperHalf.style.height = (L.phone ? L.thumbAreaH + L.dotsAreaH : L.H) + 'px';

        const thumbRow = document.getElementById('thumbRow');
        if (thumbRow) thumbRow.style.height = L.thumbAreaH + 'px';

        const dotsRow = document.getElementById('dotsRow');
        if (dotsRow) dotsRow.style.height = L.dotsAreaH + 'px';

        document.documentElement.style.setProperty('--thumb-size', L.thumbSize + 'px');

        const detailWrapper = document.getElementById('detailWrapper');
        if (detailWrapper) detailWrapper.style.height = L.phone ? '' : L.H + 'px';
        // Telefono: altezza della sola immagine (il testo va sotto, CSS .landing-phone)
        document.documentElement.style.setProperty('--detail-img-h', L.H + 'px');
        document.body.classList.toggle('landing-phone', !!L.phone);
    }

    // ─── Helper URL immagine WP ────────────────────────────────────────────────
    function wpImgSrc(wp, fileName) {
        const resBase = research.res_folder_name ? String(research.res_folder_name).replace(/\/?$/, '/') : '';
        const wpBase  = wp.wp_folder_name        ? String(wp.wp_folder_name).replace(/\/?$/, '/')        : '';
        return data_path + '/' + resBase + wpBase + fileName;
    }

    function workpackage_images_edit() {
        const el = document.getElementById("modalWorkpackageImages");
        if (!el) { console.warn('[workpackages] modale immagini non trovata'); return; }
        bootstrap.Modal.getOrCreateInstance(el).show();
    }

    // ─── Placeholder "nessuna immagine" ──────────────────────────────────────
    // FIX (2026-09-17): stesso bug/fix di researches.php — il fallback su
    // onerror puntava a img/wp_ico.jpg / img/wp_det.jpg, file che qui non
    // esistono nemmeno (icona "immagine rotta" del browser). SVG inline
    // generico invece di un file esterno — vedi researches.php per i dettagli.
    // (2026-10-13) Il segnaposto è il logo ReseArch grigio in alto a sinistra, alto un terzo
    // dell'immagine: lo disegna il CSS (.img-placeholder, css/ReseArch.css) come sfondo;
    // qui basta un pixel trasparente al posto del file mancante.
    const PLACEHOLDER_IMG_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    // ─── Render ────────────────────────────────────────────────────────────────
    function renderThumbnails() {
        const thumbRow = document.getElementById('thumbRow');
        thumbRow.innerHTML = '';

        const start = currentPage * _thumbCount;
        const end   = Math.min(start + _thumbCount, workpackages.length);

        for (let i = start; i < end; i++) {
            const wp   = workpackages[i];
            const name = wp.wp_title || t('workpackages.untitled.@', { id: wp.wp_id });
            const item = document.createElement('button');
            item.type          = 'button';
            item.className     = 'thumb-item';
            item.dataset.index = i;
            item.setAttribute('aria-label', name);
            item.setAttribute('aria-pressed', i === selectedIndex ? 'true' : 'false');

            const img = document.createElement('img');
            img.alt     = '';
            img.onerror = function () { this.onerror = null; this.classList.add('img-placeholder'); this.src = PLACEHOLDER_IMG_SRC; };
            img.classList.remove('img-placeholder');
            img.src     = wpImgSrc(wp, 'wp_ico.jpg');

            item.appendChild(img);

            if (_showText) {
                const title = document.createElement('div');
                title.className   = 'thumb-title';
                title.textContent = name;
                title.setAttribute('aria-hidden', 'true');
                item.appendChild(title);
            }

            if (i === selectedIndex) item.classList.add('selected');

            item.addEventListener('click', function () {
                selectedIndex = parseInt(this.dataset.index, 10);
                updateSelection();
            });

            thumbRow.appendChild(item);
        }
    }

    function renderDots() {
        const dotsRow = document.getElementById('dotsRow');
        dotsRow.innerHTML = '';
        const pages = getPagesCount();

        for (let p = 0; p < pages; p++) {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'dot';
            dot.setAttribute('aria-label', t('common.page_of', { n: p + 1, total: pages }));
            if (p === currentPage) { dot.classList.add('active'); dot.setAttribute('aria-current', 'true'); }
            dot.dataset.page = p;

            dot.addEventListener('click', function () {
                currentPage = parseInt(this.dataset.page, 10);
                const start = currentPage * _thumbCount;
                if (selectedIndex < start || selectedIndex >= start + _thumbCount) {
                    selectedIndex = start;
                }
                updateSelection();
            });

            dotsRow.appendChild(dot);
        }
    }

    // Collaboratori (C): fino a COLLAB_INLINE_MAX nomi per esteso nella sintesi, oltre solo il
    // pulsante "Collaboratori (N)" che apre ui/modal_collaborators.php.
    // I nomi arrivano separati da | (GROUP_CONCAT della query della pagina).
    const COLLAB_INLINE_MAX = 5;
    function renderCollaborators(joined, title) {
        const box  = document.getElementById('detailCollab');
        const text = document.getElementById('detailCollabText');
        const btn  = document.getElementById('detailCollabBtn');
        if (!box || !text || !btn) return;
        const names  = joined ? String(joined).split('|').filter(Boolean) : [];
        const inline = names.length <= COLLAB_INLINE_MAX;
        box.hidden  = names.length === 0;
        text.hidden = !inline;
        btn.hidden  = inline;
        text.textContent = inline && names.length ? t('people.collaborators_list', { names: names.join(', ') }) : '';
        btn.textContent  = t('people.collaborators', { n: names.length });
        btn.onclick = () => window.raOpenCollaborators?.(title, names, btn);
    }

    function renderDetail() {
        if (!workpackages.length) return;
        const wp = workpackages[selectedIndex];

        const detailImage = document.getElementById('detailImage');
        detailImage.alt     = '';
        // Immagine di dettaglio mancante: .detail-missing fa lampeggiare il tasto di modifica
        // (chi può modificare) o mostra "immagine da definire" (gli altri) — css/ReseArch.css
        const detailWrapper = document.getElementById('detailWrapper');
        detailImage.onerror = function () {
            this.onerror = null; this.classList.add('img-placeholder'); this.src = PLACEHOLDER_IMG_SRC;
            detailWrapper?.classList.add('detail-missing');
        };
        detailImage.classList.remove('img-placeholder');
        detailWrapper?.classList.remove('detail-missing');
        detailImage.src     = wpImgSrc(wp, 'wp_det.jpg');

        document.getElementById('detailTitle').textContent    = wp.wp_title    || '';
        document.getElementById('detailSubtitle').textContent = wp.wp_subtitle || '';
        document.getElementById('detailResp').textContent     = wp.wp_responsabile
            ? t('people.responsible', { names: wp.wp_responsabile }) : '';
        document.getElementById('detailOther').textContent    = wp.wp_membri
            ? t('people.participants', { names: wp.wp_membri }) : '';
        renderCollaborators(wp.wp_collaborators, t('modal.collaborators.title_wp.@', { name: wp.wp_title || '' }));
    }

    function updateSelection() {
        currentPage = Math.floor(selectedIndex / _thumbCount);

        renderThumbnails();
        renderDots();
        renderDetail();

        // Espone il WP selezionato alla modale immagini (unico punto di verità)
        window.currentWorkpackage = workpackages[selectedIndex];
        document.getElementById('selected_wp_id').value = workpackages[selectedIndex].wp_id;

        // Punto 13: mostra il pulsante Modifica solo se l'utente ha diritti sul WP selezionato
        const actionsTop = document.getElementById('detailActionsTop');
        if (actionsTop) {
            const wp      = workpackages[selectedIndex];
            const canEdit = userType === 'X' || research.res_perm === 'P' || wp.wp_perm === 'W';
            actionsTop.style.display = canEdit ? '' : 'none';
        }
        // Chi vede il tasto di modifica non vede la scritta "immagine da definire"
        document.getElementById('detailWrapper')?.classList.toggle('can-edit-img',
            !!actionsTop && actionsTop.style.display !== 'none');
    }


    // Tastiera (WCAG 2.1.1): frecce sinistra/destra sulle miniature, Home/Fine per prima/ultima
    document.getElementById('thumbRow')?.addEventListener('keydown', function (ev) {
        const total = workpackages.length;
        let next = selectedIndex;
        if (ev.key === 'ArrowRight') next = Math.min(total - 1, selectedIndex + 1);
        else if (ev.key === 'ArrowLeft') next = Math.max(0, selectedIndex - 1);
        else if (ev.key === 'Home') next = 0;
        else if (ev.key === 'End') next = total - 1;
        else return;
        ev.preventDefault();
        if (next === selectedIndex) return;
        selectedIndex = next;
        updateSelection();
        document.querySelector('#thumbRow .thumb-item[data-index="' + next + '"]')?.focus();
    });
    // Ricalcola layout e ri-renderizza al resize della finestra
    window.addEventListener('resize', function () {
        applyLayout();
        currentPage = Math.floor(selectedIndex / _thumbCount);
        renderThumbnails();
        renderDots();
    });

    // Punto 12: spinner sul pulsante "apri work package" al submit
    const wpForm = document.getElementById('wpForm');
    if (wpForm) {
        const submitBtn = wpForm.querySelector('button[type="submit"]');
        const submitBtnOriginalHTML = submitBtn ? submitBtn.innerHTML : null;

        wpForm.addEventListener('submit', function () {
            if (!submitBtn) return;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
        });

        // Ripristina il pulsante se l'utente torna indietro con il browser (bfcache)
        window.addEventListener('pageshow', function (e) {
            if (e.persisted && submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = submitBtnOriginalHTML;
            }
        });
    }

    if (workpackages.length > 0) {
        applyLayout();      // calcola _thumbCount, _thumbSize, dimensiona il form
        selectedIndex = 0;
        currentPage   = 0;
        updateSelection();
    }
</script>
</body>
</html>
