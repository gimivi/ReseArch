<?php
// ui/modal_monitor.php
// Modale monitor: Utenti connessi + Log attività
// Inclusa da ui/header.php solo per utenti non-V/G
require_once __DIR__ . '/../api/i18n.php';
$_monitor_is_admin = (($user['user_type'] ?? '') === 'X');
?>

<!-- ================================================================== -->
<!-- MODALE MONITOR — Utenti connessi & Log attività                     -->
<!-- ================================================================== -->
<div class="modal fade" id="modalMonitor" tabindex="-1"
     aria-labelledby="modalMonitorLabel" aria-hidden="true">
  <div class="modal-dialog modal-fullscreen-md-down modal-xl modal-dialog-scrollable">
    <div class="modal-content" style="color:#212529;">

      <!-- HEADER -->
      <div class="modal-header">
        <h5 class="modal-title" id="modalMonitorLabel">
          <i class="bi bi-activity me-2" aria-hidden="true"></i><?= te('modal.monitor.title') ?>
        </h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= te('common.close') ?>"></button>
      </div>

      <!-- BODY -->
      <div class="modal-body">

        <!-- NAV TABS -->
        <ul class="nav nav-tabs mb-3" id="monitorTabs" role="tablist">
          <li class="nav-item" role="presentation">
            <button class="nav-link active" id="tab-connected-btn"
                    data-bs-toggle="tab" data-bs-target="#tab-connected"
                    type="button" role="tab" aria-controls="tab-connected">
              <i class="bi bi-people me-1" aria-hidden="true"></i><?= te('modal.monitor.tab.connected') ?>
            </button>
          </li>
          <?php if ($_monitor_is_admin): ?>
          <li class="nav-item" role="presentation">
            <button class="nav-link" id="tab-log-btn"
                    data-bs-toggle="tab" data-bs-target="#tab-log"
                    type="button" role="tab" aria-controls="tab-log">
              <i class="bi bi-journal-text me-1" aria-hidden="true"></i><?= te('modal.monitor.tab.log') ?>
            </button>
          </li>
          <?php endif; ?>
        </ul>

        <!-- TAB CONTENT -->
        <div class="tab-content" id="monitorTabContent">

          <!-- ── TAB 1: Utenti connessi ───────────────────────────────── -->
          <div class="tab-pane fade show active" id="tab-connected"
               role="tabpanel" aria-labelledby="tab-connected-btn">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <span id="monitorConnectedCount" class="text-muted small" role="status" aria-live="polite"></span>
              <?php if ($_monitor_is_admin): ?>
              <select id="monitorConnectedType" class="form-select form-select-sm w-auto ms-auto me-2"
                      aria-label="<?= te('modal.monitor.filter_user_type') ?>">
                <option value=""><?= te('modal.monitor.all_user_types') ?></option>
                <?php foreach (['X', 'P', 'I', 'U', 'C', 'V', 'G'] as $_ut): ?>
                  <option value="<?= $_ut ?>"><?= te('role.' . $_ut . '.@') ?></option>
                <?php endforeach; ?>
              </select>
              <?php endif; ?>
              <button type="button" class="btn btn-sm btn-outline-secondary"
                      id="btnRefreshConnected">
                <i class="bi bi-arrow-clockwise" aria-hidden="true"></i> <?= te('common.refresh') ?>
              </button>
            </div>
            <div id="monitorConnectedWrap">
              <p class="text-muted"><?= te('common.loading') ?></p>
            </div>
          </div>

          <!-- ── TAB 2: Log attività (solo X) ────────────────────────── -->
          <?php if ($_monitor_is_admin): ?>
          <div class="tab-pane fade" id="tab-log" role="tabpanel" aria-labelledby="tab-log-btn">

            <!-- Filtri -->
            <div class="row g-2 mb-3">
              <div class="col-sm-2">
                <input type="text" id="logFilterAction" class="form-control form-control-sm"
                       placeholder="<?= te('modal.monitor.filter_action') ?>" aria-label="<?= te('modal.monitor.filter_action') ?>">
              </div>
              <div class="col-sm-2">
                <select id="logFilterUserType" class="form-select form-select-sm" aria-label="<?= te('modal.monitor.filter_user_type') ?>">
                  <option value=""><?= te('modal.monitor.all_user_types') ?></option>
                  <?php foreach (['X', 'P', 'I', 'U', 'C', 'V', 'G'] as $_ut): ?>
                    <option value="<?= $_ut ?>"><?= te('role.' . $_ut . '.@') ?></option>
                  <?php endforeach; ?>
                </select>
              </div>
              <div class="col-sm-2">
                <select id="logFilterEntity" class="form-select form-select-sm" aria-label="<?= te('modal.monitor.filter_entity') ?>">
                  <option value=""><?= te('modal.monitor.all_entities') ?></option>
                  <option value="research">research</option>
                  <option value="workpackage">workpackage</option>
                  <option value="object">object</option>
                  <option value="model">model</option>
                  <option value="folder">folder</option>
                  <option value="file">file</option>
                  <option value="link">link</option>
                  <option value="page">page</option>
                </select>
              </div>
              <div class="col-sm-2">
                <input type="date" id="logFilterDateFrom" class="form-control form-control-sm"
                       title="<?= te('modal.monitor.date_from') ?>" aria-label="<?= te('modal.monitor.date_from') ?>">
              </div>
              <div class="col-sm-2">
                <input type="date" id="logFilterDateTo" class="form-control form-control-sm"
                       title="<?= te('modal.monitor.date_to') ?>" aria-label="<?= te('modal.monitor.date_to') ?>">
              </div>
              <div class="col-sm-2 d-flex gap-2">
                <button type="button" class="btn btn-sm btn-primary" id="btnApplyLogFilter">
                  <i class="bi bi-funnel" aria-hidden="true"></i> <?= te('common.apply') ?>
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="btnResetLogFilter">
                  <i class="bi bi-x-circle" aria-hidden="true"></i> <?= te('modal.monitor.filter_reset') ?>
                </button>
              </div>
            </div>

            <!-- Tabulator -->
            <div id="logTable"></div>
          </div>
          <?php endif; ?>

        </div><!-- /.tab-content -->
      </div><!-- /.modal-body -->

      <!-- FOOTER -->
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary"
                data-bs-dismiss="modal"><?= te('common.close') ?></button>
      </div>

    </div><!-- /.modal-content -->
  </div><!-- /.modal-dialog -->
</div><!-- /#modalMonitor -->


<!-- ================================================================== -->
<!-- JS modale monitor                                                    -->
<!-- ================================================================== -->
<script>
(function () {
  'use strict';

  const IS_ADMIN   = <?= $_monitor_is_admin ? 'true' : 'false' ?>;
  const t  = (typeof window.t  === 'function') ? window.t  : (k) => k;
  const te = (typeof window.te === 'function') ? window.te : (k) => k;
  const modalEl    = document.getElementById('modalMonitor');
  if (!modalEl) return;

  // ── Utenti connessi ──────────────────────────────────────────────────
  let lastConnected = null;
  function renderConnected(data) {
    lastConnected = data;
    const wrap  = document.getElementById('monitorConnectedWrap');
    const count = document.getElementById('monitorConnectedCount');
    // filtro rapido per tipo di utente (solo amministratore; G = ospiti)
    const type  = document.getElementById('monitorConnectedType')?.value || '';
    const users = (data.users || []).filter(u => !type || u.user_type === type);

    count.textContent = users.length
      ? t('modal.monitor.connected_count', { n: users.length })
      : t('modal.monitor.none_connected');

    if (!users.length) {
      wrap.innerHTML = `<p class="text-muted">${te('modal.monitor.none_connected')}</p>`;
      return;
    }

    const isAdmin = (data.user_type === 'X');

    let thead, rows;
    if (isAdmin) {
      thead = `<tr>
        <th scope="col">${te('user.first_name')}</th><th scope="col">${te('user.last_name')}</th><th scope="col">${te('user.username')}</th>
        <th scope="col">${te('user.email')}</th><th scope="col">${te('common.type')}</th><th scope="col">${te('modal.monitor.col.page')}</th><th scope="col">${te('modal.monitor.col.last_activity')}</th>
      </tr>`;
      rows = users.map(u => `<tr>
        <td>${esc(u.first_name)}</td>
        <td>${esc(u.last_name)}</td>
        <td>${esc(u.user_name)}</td>
        <td>${esc(u.email)}</td>
        <td>${u.guest ? `<span class="badge text-bg-warning">${te('role.G.@')}</span>` : esc(t('role.' + u.user_type + '.@'))}</td>
        <td><span class="badge bg-secondary">${esc(u.current_page)}</span></td>
        <td><small class="text-muted">${esc(u.last_activity)}</small></td>
      </tr>`).join('');
    } else {
      thead = `<tr>
        <th scope="col">${te('user.username')}</th><th scope="col">${te('modal.monitor.col.page')}</th><th scope="col">${te('modal.monitor.col.last_activity')}</th>
      </tr>`;
      rows = users.map(u => `<tr>
        <td>${u.guest ? `<em>${te('role.G.@')}</em>` : esc(u.user_name)}</td>
        <td><span class="badge bg-secondary">${esc(u.current_page)}</span></td>
        <td><small class="text-muted">${esc(u.last_activity)}</small></td>
      </tr>`).join('');
    }

    wrap.innerHTML = `
      <table class="table table-sm table-hover table-bordered mb-0">
        <thead class="table-light">${thead}</thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  async function loadConnected() {
    const wrap = document.getElementById('monitorConnectedWrap');
    wrap.innerHTML = `<p class="text-muted">${te('common.loading')}</p>`;
    try {
      const res  = await fetch('api/active_users.php');
      const data = await res.json();
      if (res.ok) {
        renderConnected(data);
      } else {
        wrap.innerHTML = `<p class="text-danger" role="alert">${te('modal.monitor.error', { error: data.error || t('errors.server_status', { status: res.status }) })}</p>`;
      }
    } catch (e) {
      wrap.innerHTML = `<p class="text-danger" role="alert">${te('errors.network')}</p>`;
    }
  }

  // Carica alla prima apertura e al click su "Aggiorna"
  modalEl.addEventListener('show.bs.modal', loadConnected);
  document.getElementById('btnRefreshConnected')
    ?.addEventListener('click', loadConnected);
  document.getElementById('monitorConnectedType')
    ?.addEventListener('change', () => { if (lastConnected) renderConnected(lastConnected); });


  // ── Log attività (solo X) ─────────────────────────────────────────────
  if (!IS_ADMIN) return;

  let logTable = null;

  function buildLogUrl() {
    const action    = document.getElementById('logFilterAction')?.value.trim()    || '';
    const userType  = document.getElementById('logFilterUserType')?.value         || '';
    const entity    = document.getElementById('logFilterEntity')?.value           || '';
    const dateFrom  = document.getElementById('logFilterDateFrom')?.value         || '';
    const dateTo    = document.getElementById('logFilterDateTo')?.value           || '';
    const params    = new URLSearchParams();
    if (action)   params.set('filter_action',    action);
    if (userType) params.set('filter_user_type', userType);
    if (entity)   params.set('filter_entity',    entity);
    if (dateFrom) params.set('filter_date_from', dateFrom);
    if (dateTo)   params.set('filter_date_to',   dateTo);
    return 'api/activity_log_api.php' + (params.toString() ? '?' + params : '');
  }

  function initLogTable() {
    if (logTable) return; // già inizializzato

    logTable = new Tabulator('#logTable', {
      ajaxURL:        buildLogUrl(),
      ajaxResponse:   function (_url, _params, response) { return response; },
      pagination:     true,
      paginationMode: 'remote',
      paginationSize: 20,
      paginationSizeSelector: [10, 20, 50, 100],
      sortMode:       'remote',
      layout:         'fitColumns',
      placeholder:    t('modal.monitor.no_logs'),
      columns: [
        {
          title: t('modal.monitor.col.datetime'), field: 'created_at', width: 155, sorter: 'string',
          formatter: function (cell) {
            return `<small>${esc(cell.getValue())}</small>`;
          }
        },
        {
          title: t('modal.monitor.col.user'), field: 'user_name', width: 130,
          formatter: function (cell) {
            const d    = cell.getRow().getData();
            const full = [d.first_name, d.last_name].filter(Boolean).join(' ');
            // ospite: niente nome utente, nome e fornitore dal registro degli ospiti
            if (d.user_type === 'G') return `<span class="badge text-bg-warning me-1">${te('role.G.@')}</span>${esc(full)}`;
            return full
              ? `<span title="${esc(full)}">${esc(cell.getValue())}</span>`
              : esc(cell.getValue());
          }
        },
        {
          title: t('modal.monitor.col.action'), field: 'action', width: 150,
          formatter: function (cell) {
            const v = cell.getValue() || '';
            const [cat, op] = v.split(':');
            const colors = {
              auth: 'primary', page: 'secondary', object: 'success',
              model: 'info', folder: 'warning', file: 'warning',
              link: 'dark', research: 'success', workpackage: 'info', guest: 'warning'
            };
            const bg = colors[cat] || 'secondary';
            return `<span class="badge bg-${bg}">${esc(v)}</span>`;
          }
        },
        { title: t('common.type'),            field: 'entity_type', width: 100 },
        { title: t('modal.monitor.col.entity'), field: 'entity_name', minWidth: 120 },
        { title: 'IP',           field: 'ip',          width: 130,
          formatter: function (cell) {
            return `<small class="text-muted">${esc(cell.getValue())}</small>`;
          }
        },
      ],
    });
  }

  // Inizializza Tabulator quando si clicca il tab log
  document.getElementById('tab-log-btn')
    ?.addEventListener('shown.bs.tab', initLogTable);

  // Applica filtri → ricarica tabella
  document.getElementById('btnApplyLogFilter')?.addEventListener('click', function () {
    if (!logTable) { initLogTable(); return; }
    logTable.setData(buildLogUrl());
  });

  // Reset filtri
  document.getElementById('btnResetLogFilter')?.addEventListener('click', function () {
    ['logFilterAction','logFilterUserType','logFilterEntity','logFilterDateFrom','logFilterDateTo']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if (logTable) logTable.setData('api/activity_log_api.php');
  });

  // ── Helper XSS ────────────────────────────────────────────────────────
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();
</script>
