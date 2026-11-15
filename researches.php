<?php
// --------------------------------------------------------------------------- //
// --------------------------     PHP BACKEND      --------------------------- //
// --------------------------------------------------------------------------- //
// NB: il file DEVE iniziare con <?php (nessun output prima di session_start/header)
// Controllo di Sessione
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
//--------------------------- Controllo di processo ------------------------//

// Protezione: se non sei loggato torni al login
if (!isset($_SESSION['user'])) {
    header('Location: index.php');
    exit;
}

//SE È  POST -----//
//--------------------------- Salvataggio Id Research ------------------------//
// Se l'utente ha confermato la ricerca scelta, salviamo il res_id in sessione
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['selected_res_id'])) {
    $resId = (int)$_POST['selected_res_id'];
    if ($resId > 0) {
        $_SESSION['res_id'] = $resId;
        // Log selezione ricerca
        require_once __DIR__ . '/api/db.php';
        require_once __DIR__ . '/api/log_tool.php';
        session_heartbeat('researches');
        log_activity('research:select', 'research', $resId, '');
        header('Location: workpackages.php');
        exit;
    }
}

//SE NON È POST -------//
//--------------------------- Configurazione  --------------------------------//
// Cartella dati //
$paths = require_once __DIR__ . '/cfg/cfg_ini.php';
$_SESSION['paths'] = $paths;

//--------------------------- Collegamento DB --------------------------------//
require_once __DIR__ . '/api/db.php';
require_once __DIR__ . '/api/log_tool.php';
session_heartbeat('researches');
log_activity('page:visit', 'page', null, 'researches');

//----------------- Recupero dati di Sessione --------------------------------//
//Utente
$user   = $_SESSION['user'];
$userId = (int)$user['id'];


// RUOLI -------------------------------------------//
// Ruoli Ricerca (future-proof: basta estendere questi array)
$PI_ROLES  = ['P'];
$INV_ROLES = ['W', 'I'];   // i collaboratori (C) hanno un elenco a parte: res_collaborators (§11.2)

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

[$piPlaceholders,  $piParams]  = buildInParams($PI_ROLES,  'pi');
[$invPlaceholders, $invParams] = buildInParams($INV_ROLES, 'inv');


// SELEZIONA TUTTE LE RICERCHE DI COMPETENZA DELL'UTENTE--------------//
// Carichiamo le ricerche visibili all'utente secondo la logica res_show/user_type/res_perm
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
          AND urp.perm IN (" . implode(',', $piPlaceholders) . ")
    ) AS res_pi,

    (
        SELECT GROUP_CONCAT(CONCAT(u.first_name,' ',u.last_name) ORDER BY u.last_name SEPARATOR ', ')
        FROM users_res_permissions urp
        JOIN users u ON u.id = urp.user_id
        WHERE urp.res_id = r.res_id
          AND urp.perm IN (" . implode(',', $invPlaceholders) . ")
    ) AS res_investigator,

    (
        SELECT GROUP_CONCAT(CONCAT(u.first_name,' ',u.last_name) ORDER BY u.last_name SEPARATOR '|')
        FROM users_res_permissions urp
        JOIN users u ON u.id = urp.user_id
        WHERE urp.res_id = r.res_id
          AND urp.perm = 'C'
    ) AS res_collaborators

FROM researches AS r
LEFT JOIN users_res_permissions AS ur
    ON ur.res_id = r.res_id
   AND ur.user_id = :user_id
LEFT JOIN folders AS f
    ON f.folder_id = r.res_folder_id

ORDER BY r.res_year DESC, r.res_title ASC
";

$params = array_merge(
    [':user_id' => $userId],
    $piParams,
    $invParams
);

$stmt = $pdo->prepare($sql);
$stmt->execute($params);

// Visibilità: scala unica 0-4 (api/visibility.php, _doc/arch-permessi.md §11.5)
require_once __DIR__ . '/api/visibility.php';
$researches = array_values(array_filter(
    $stmt->fetchAll(PDO::FETCH_ASSOC),
    fn(array $r): bool => ra_can_see_research($user, (int)$r['res_show'], $r['res_perm'] ?? null)
));

// Riferimento della pagina per il footer (messaggio di aiuto)
$page_ref = 'ricerca';
?>

<!-- --------------------------------------------------------------------------- -->
<!-- -------------------------- Formattazione HTML   --------------------------- -->
<!-- --------------------------------------------------------------------------- -->
<!DOCTYPE html>
<html lang="<?php require_once __DIR__ . '/api/i18n.php'; ra_i18n_set_research(null); echo htmlspecialchars(ra_lang()); ?>">
<head>
    <meta charset="UTF-8">
    <title><?php require_once __DIR__ . '/api/i18n.php'; echo te('researches.page_title.@') . ' | ' . te('app.name'); ?></title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <?php require_once __DIR__ . '/api/i18n.php'; echo ra_i18n_head(); ?>

    <!-- Bootstrap CSS -->
    <link rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
          integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH"
          crossorigin="anonymous">

    <!-- Bootstrap Icons -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">

    <!-- CSS Tabulator -->
    <link rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist/css/tabulator.min.css"/>

    <!-- ReseArch CSS -->
    <link rel="stylesheet" href="css/ReseArch.css">

</head>
<body>

<!-- HEADER -->
<?php require __DIR__ . '/ui/header.php'; ?>

<!-- CENTRALE (contenuto principale: destinazione del link "Vai al contenuto") -->
<div class="landing-stage" id="main-content" role="main" tabindex="-1">
<h1 class="visually-hidden"><?= te('researches.page_title.@') ?></h1>
<div class="landing-wrapper">
    <?php if (empty($researches)): ?>
        <p><?= te('researches.none.@') ?></p>
    <?php else: ?>
        <form id="researchForm" method="post">
            <input type="hidden" name="selected_res_id" id="selected_res_id" value="">

            <!-- METÀ SUPERIORE: thumb + dots -->
            <div class="upper-half" id="upperHalf">
                <div class="thumb-row" id="thumbRow" role="group" aria-label="<?= te('researches.list.@') ?>"></div>
                <div class="dots-row" id="dotsRow" role="group" aria-label="<?= te('common.pages') ?>"></div>
            </div>

            <!-- RIGA 3: immagine grande + testo -->
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

                <!-- BOTTONI IN ALTO A DESTRA (solo X e P) -->
                <?php if (in_array($user['user_type'], ['X', 'P'], true)): ?>
                    <div class="detail-actions-top" id="detailActionsTop">
                        <!-- Ora il tasto edit apre SOLO la modale immagini -->
                        <button type="button" class="btn action-btn" title="<?= te('researches.edit_images.@') ?>" aria-label="<?= te('researches.edit_images.@') ?>" onclick="research_images_edit()">
                            <i class="bi bi-pencil-square" aria-hidden="true"></i>
                        </button>
                    </div>
                <?php endif; ?>

                <!-- BOTTONE IN BASSO A DESTRA (sempre presente) -->
                <div class="detail-actions-bottom">
                    <button type="submit" class="btn action-btn" title="<?= te('researches.open.@') ?>" aria-label="<?= te('researches.open.@') ?>">
                        <i class="bi bi-door-open" aria-hidden="true"></i>
                    </button>
                </div>

            </div>
        </form>
    <?php endif; ?>
</div><!-- /.landing-wrapper -->
</div><!-- /.landing-stage -->

<!-- FOOTER -->
<footer class="app-footer">
  <?php require __DIR__ . '/ui/foother.php'; ?>
</footer>

<!-- MODALS -->
<!-- Gestione tabella ricerche -->
<?php require __DIR__ . '/ui/modal_researches.php'; ?>
<!-- Gestione immagini ricerche -->
<?php require __DIR__ . '/ui/modal_research_images.php'; ?>
<?php require __DIR__ . '/ui/modal_collaborators.php'; ?>
<!-- Gestione utenti piattaforma (solo X, vedi ui/header.php $showPlatformUsers) -->
<?php require __DIR__ . '/ui/modal_platform_users.php'; ?>
<?php if (($user['user_type'] ?? '') === 'X') require __DIR__ . '/ui/modal_mod_spec_templates.php'; ?>
<?php if (($user['user_type'] ?? '') === 'X') require __DIR__ . '/ui/modal_capabilities.php'; ?>
<?php if (($user['user_type'] ?? '') === 'X') require __DIR__ . '/ui/modal_fle_library.php'; ?>
<?php if (($user['user_type'] ?? '') === 'X') require __DIR__ . '/ui/modal_db_maintenance.php'; ?>

<!-- --------------------------------------------------------------------------- -->
<!-- --------------------------   Javascript FRONTEND      ---------------------- -->
<!-- --------------------------------------------------------------------------- -->

<!-- CARICAMENTO LIBRERIE JS -->
<!-- Bootstrap JS -->
<script
    src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
    integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz"
    crossorigin="anonymous"
></script>

<!-- Tabulator -->
<script src="https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist/js/tabulator.min.js"></script>
<!-- Aiuti di accessibilità comuni (fuoco delle finestre, testi di Tabulator, righe da tastiera) -->
<script src="js/ra-a11y.js"></script>


<!-- SCRIPT JS DI PAGINA -->
<script>
    // Dati PHP -> JS (scope globale)
    const researches = <?php echo json_encode($researches, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
    const data_path = <?php echo json_encode($paths['data_path'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
    const userType  = <?php echo json_encode($user['user_type']); ?>;
    const userId    = <?php echo json_encode((int)($user['id'] ?? 0)); ?>; // usato da modal_platform_users.js (impersonazione)

    let currentPage   = 0;
    let selectedIndex = 0;

    // ─── Costanti layout ───────────────────────────────────────────────────────
    const HEADER_H       = 60;   // altezza .app-header (px)
    const FOOTER_H       = 30;   // altezza footer fisso (px)
    const MARGIN         = 30;   // distanza minima form ↔ header/footer (px)
    const DETAIL_RATIO   = 3;    // larghezza : altezza della detail image
    const MAX_DETAIL_H   = 400;  // H massimo → immagine a 1:1 (1200×400)
    const MIN_THUMB      = 64;   // lato minimo di un thumb (px)
    const MAX_THUMB      = 400;  // lato massimo di un thumb → 1:1
    const THUMB_TEXT_MIN = 256;  // soglia sotto cui nascondere il titolo

    // Valori correnti aggiornati da applyLayout()
    let _thumbCount = 1;
    let _thumbSize  = 200;
    let _showText   = true;

    function getPageSize()   { return _thumbCount; }
    function getPagesCount() { return Math.ceil(researches.length / _thumbCount); }

    // ─── Motore di layout ──────────────────────────────────────────────────────
    // H  = altezza immagine di dettaglio
    // formW = 3H  (rapporto 3:1)
    // formH = 2H  (upper-half H + detail-half H)
    // upper-half: 3/4 → thumbs,  1/4 → dots
    // thumb_size = clamp(MIN_THUMB, 0.75·H, MAX_THUMB)
    // thumb_count = floor(3H / thumb_size)
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

        // H è limitato dalla disponibilità in larghezza (3H ≤ availW)
        // e in altezza (2H ≤ availH), e dal massimo 1:1
        const H = Math.min(MAX_DETAIL_H, availW / DETAIL_RATIO, availH / 2);

        const formW      = DETAIL_RATIO * H;
        const formH      = 2 * H;
        const thumbAreaH = 0.75 * H;   // tre quarti dell'upper-half
        const dotsAreaH  = 0.25 * H;   // un quarto dell'upper-half
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

    // ─── Helpers ───────────────────────────────────────────────────────────────
    function imgSrc(folderName, fileName) {
        const base = folderName ? String(folderName).replace(/\/?$/, '/') : '';
        return data_path + '/' + base + fileName;
    }

    function research_images_edit() {
        const el = document.getElementById("modalResearchImages");
        if (!el) { console.warn('[researches] modale immagini non trovata'); return; }
        bootstrap.Modal.getOrCreateInstance(el).show();
    }

    // ─── Placeholder "nessuna immagine" ──────────────────────────────────────
    // FIX (2026-09-17): il fallback su onerror puntava a img/research_ico.jpg
    // / img/research_det.jpg — due foto stock (crash test auto) rimaste da
    // test/demo, mai sostituite con un placeholder neutro. Una ricerca appena
    // creata, senza ancora un'immagine propria, mostrava quindi una foto reale
    // e specifica — facile scambiarla per l'immagine di un'altra ricerca.
    // SVG inline generico (nessun file esterno da mantenere in sync), con
    // classe .img-placeholder che forza object-fit:contain (vedi
    // css/ReseArch.css) così l'icona non viene ritagliata sui contenitori
    // 3:1 (dettaglio) — con "cover" ne sarebbe rimasto visibile solo il
    // centro. La classe va rimossa PRIMA di ogni nuovo assegnamento di src
    // (gli <img> sono riusati fra una ricerca e l'altra), altrimenti
    // resterebbe appiccicata anche quando la ricerca successiva ha
    // un'immagine vera e propria.
    // (2026-10-13) Il segnaposto è il logo ReseArch grigio in alto a sinistra, alto un terzo
    // dell'immagine: lo disegna il CSS (.img-placeholder, css/ReseArch.css) come sfondo;
    // qui basta un pixel trasparente al posto del file mancante.
    const PLACEHOLDER_IMG_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    // ─── Render ────────────────────────────────────────────────────────────────
    function renderThumbnails() {
        const ps       = _thumbCount;
        const thumbRow = document.getElementById('thumbRow');
        thumbRow.innerHTML = '';

        const start = currentPage * ps;
        const end   = Math.min(start + ps, researches.length);

        for (let i = start; i < end; i++) {
            const r    = researches[i];
            const name = r.res_title || t('researches.untitled.@', { id: r.res_id });
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
            img.src     = imgSrc(r.res_folder_name, 'research_ico.jpg');

            const title = document.createElement('div');
            title.className   = 'thumb-title';
            title.textContent = name;
            title.setAttribute('aria-hidden', 'true');

            item.appendChild(img);
            if (_showText) item.appendChild(title);

            if (i === selectedIndex) item.classList.add('selected');

            item.addEventListener('click', function () {
                selectedIndex = parseInt(this.dataset.index, 10);
                updateSelection();
            });

            thumbRow.appendChild(item);
        }
    }

    function renderDots() {
        const ps      = _thumbCount;
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
                const start = currentPage * ps;
                if (selectedIndex < start || selectedIndex >= start + ps) {
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
        if (!researches.length) return;
        const r = researches[selectedIndex];

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
        detailImage.src     = imgSrc(r.res_folder_name, 'research_det.jpg');

        document.getElementById('detailTitle').textContent    = r.res_title    || '';
        document.getElementById('detailSubtitle').textContent = r.res_subtitle || '';
        document.getElementById('detailResp').textContent     = r.res_pi
            ? t('people.responsible', { names: r.res_pi }) : '';
        document.getElementById('detailOther').textContent    = r.res_investigator
            ? t('people.participants', { names: r.res_investigator }) : '';
        renderCollaborators(r.res_collaborators, t('modal.collaborators.title_research.@', { name: r.res_title || '' }));
    }

    function updateSelection() {
        currentPage = Math.floor(selectedIndex / _thumbCount);

        renderThumbnails();
        renderDots();
        renderDetail();

        window.currentResearch = researches[selectedIndex];
        document.getElementById('selected_res_id').value = researches[selectedIndex].res_id;

        const actionsTop = document.getElementById('detailActionsTop');
        if (actionsTop) {
            const r = researches[selectedIndex];
            actionsTop.style.display = (userType === 'X' || r.res_perm === 'P') ? '' : 'none';
        }
        // Chi vede il tasto di modifica non vede la scritta "immagine da definire"
        document.getElementById('detailWrapper')?.classList.toggle('can-edit-img',
            !!actionsTop && actionsTop.style.display !== 'none');
    }


    // Tastiera (WCAG 2.1.1): frecce sinistra/destra sulle miniature, Home/Fine per prima/ultima
    document.getElementById('thumbRow')?.addEventListener('keydown', function (ev) {
        const total = researches.length;
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

    // Punto 12: spinner sul pulsante "apri ricerca" al submit
    const researchForm = document.getElementById('researchForm');
    if (researchForm) {
        const submitBtn = researchForm.querySelector('button[type="submit"]');
        const submitBtnOriginalHTML = submitBtn ? submitBtn.innerHTML : null;

        researchForm.addEventListener('submit', function () {
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

    if (researches.length > 0) {
        applyLayout();      // calcola _thumbCount, _thumbSize, dimensiona il form
        selectedIndex = 0;
        currentPage   = 0;
        updateSelection();
    }
</script>
</body>
</html>
