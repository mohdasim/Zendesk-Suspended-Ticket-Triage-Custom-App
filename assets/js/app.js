/**
 * Suspended Tickets Triage Center — Main Application Controller
 *
 * Orchestrates:
 * - ZAF client initialization
 * - Cache-first data loading with background refresh
 * - UI rendering (tabs, lists, charts)
 * - Bulk actions (recover, delete)
 * - Keyboard shortcuts
 * - Auto-refresh polling
 */
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────

  var AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
  var NOTIFICATION_DURATION = 4000;

  // ── State ────────────────────────────────────────────────

  var client = null;
  var allTickets = [];       // Full ticket array from cache/API
  var filteredTickets = [];  // After search/filter applied
  var virtualList = null;
  var fetchController = null;
  var autoRefreshTimer = null;
  var isFirstLoad = true;
  var currentTab = 'dashboard';

  // ── DOM References ───────────────────────────────────────

  var $syncText, $refreshBtn, $searchInput, $progressContainer, $progressFill, $progressText;
  var $causeFilter, $sortFilter, $selectAll, $selectedCount, $recoverBtn, $deleteBtn;
  var $ticketListContainer, $ticketListSpacer, $ticketListItems, $emptyState, $emptyText;
  var $totalCount, $spamCount, $autoCount, $otherCount;
  var $confirmModal, $modalTitle, $modalMessage, $modalCancel, $modalConfirm;
  var $notification, $notificationText;
  var $ticketPreview, $previewSubject, $previewMeta, $previewContent;
  var $previewRecover, $previewDelete, $previewClose;
  var $exportCsvBtn, $exportLogBtn;
  var $logList;
  var $repeatOffendersSection, $repeatOffendersList;

  // ── Initialize ───────────────────────────────────────────

  function init() {
    _cacheDOMRefs();
    _initZAF();
  }

  function _cacheDOMRefs() {
    $syncText = document.getElementById('syncText');
    $refreshBtn = document.getElementById('refreshBtn');
    $searchInput = document.getElementById('searchInput');
    $progressContainer = document.getElementById('progressContainer');
    $progressFill = document.getElementById('progressFill');
    $progressText = document.getElementById('progressText');
    $causeFilter = document.getElementById('causeFilter');
    $sortFilter = document.getElementById('sortFilter');
    $selectAll = document.getElementById('selectAll');
    $selectedCount = document.getElementById('selectedCount');
    $recoverBtn = document.getElementById('recoverBtn');
    $deleteBtn = document.getElementById('deleteBtn');
    $ticketListContainer = document.getElementById('ticketListContainer');
    $ticketListSpacer = document.getElementById('ticketListSpacer');
    $ticketListItems = document.getElementById('ticketListItems');
    $emptyState = document.getElementById('emptyState');
    $emptyText = document.getElementById('emptyText');
    $totalCount = document.getElementById('totalCount');
    $spamCount = document.getElementById('spamCount');
    $autoCount = document.getElementById('autoCount');
    $otherCount = document.getElementById('otherCount');
    $confirmModal = document.getElementById('confirmModal');
    $modalTitle = document.getElementById('modalTitle');
    $modalMessage = document.getElementById('modalMessage');
    $modalCancel = document.getElementById('modalCancel');
    $modalConfirm = document.getElementById('modalConfirm');
    $notification = document.getElementById('notification');
    $notificationText = document.getElementById('notificationText');
    $ticketPreview = document.getElementById('ticketPreview');
    $previewSubject = document.getElementById('previewSubject');
    $previewMeta = document.getElementById('previewMeta');
    $previewContent = document.getElementById('previewContent');
    $previewRecover = document.getElementById('previewRecover');
    $previewDelete = document.getElementById('previewDelete');
    $previewClose = document.getElementById('previewClose');
    $exportCsvBtn = document.getElementById('exportCsvBtn');
    $exportLogBtn = document.getElementById('exportLogBtn');
    $logList = document.getElementById('logList');
    $repeatOffendersSection = document.getElementById('repeatOffendersSection');
    $repeatOffendersList = document.getElementById('repeatOffendersList');
  }

  function _initZAF() {
    client = ZAFClient.init();

    client.on('app.registered', function () {
      _bindEvents();
      _initVirtualList();
      _loadData();
      _startAutoRefresh();
      _cleanupExpiredLogs();
    });
  }

  // ── Event Binding ────────────────────────────────────────

  function _bindEvents() {
    // Tab switching
    document.querySelectorAll('.app-tabs__tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        _switchTab(tab.dataset.tab);
      });
    });

    // Search (debounced)
    var debouncedSearch = TicketSearch.debounce(function () {
      _applyFilters();
    }, 250);
    $searchInput.addEventListener('input', debouncedSearch);

    // Filters
    $causeFilter.addEventListener('change', _applyFilters);
    $sortFilter.addEventListener('change', _applyFilters);

    // Select all
    $selectAll.addEventListener('change', function () {
      virtualList.selectAll($selectAll.checked);
    });

    // Bulk actions
    $recoverBtn.addEventListener('click', function () {
      _confirmBulkAction('recover');
    });
    $deleteBtn.addEventListener('click', function () {
      _confirmBulkAction('delete');
    });

    // Refresh
    $refreshBtn.addEventListener('click', function () {
      _refreshData(true);
    });

    // CSV export
    $exportCsvBtn.addEventListener('click', function () {
      ActionLogger.exportTicketsAsCSV(filteredTickets);
    });

    // Log export
    $exportLogBtn.addEventListener('click', function () {
      ActionLogger.getRecentLogs().then(function (logs) {
        ActionLogger.downloadCSV(logs);
      });
    });

    // Preview drawer
    $previewClose.addEventListener('click', _closePreview);
    $previewRecover.addEventListener('click', function () {
      var id = Number($previewRecover.dataset.id);
      if (id) _executeBulkAction('recover', [id]);
      _closePreview();
    });
    $previewDelete.addEventListener('click', function () {
      var id = Number($previewDelete.dataset.id);
      if (id) _executeBulkAction('delete', [id]);
      _closePreview();
    });

    // Modal cancel
    $modalCancel.addEventListener('click', _closeModal);

    // Keyboard shortcuts
    document.addEventListener('keydown', _handleKeyboard);
  }

  // ── Virtual List Init ────────────────────────────────────

  function _initVirtualList() {
    virtualList = VirtualList.create({
      container: $ticketListContainer,
      spacer: $ticketListSpacer,
      itemsContainer: $ticketListItems,
      renderItem: _renderTicketRow,
      onSelectionChange: _onSelectionChange,
      onPreview: _openPreview
    });
  }

  // ── Data Loading (Cache-First) ───────────────────────────

  function _loadData() {
    // Step 1: Load from cache immediately
    TicketCache.getAllTickets().then(function (cached) {
      if (cached && cached.length > 0) {
        isFirstLoad = false;
        allTickets = cached;
        _applyFilters();
        _updateDashboard();
        _setSyncStatus('Showing cached data...');
      }

      // Step 2: Check for resumable state
      return TicketCache.getMeta('lastPage');
    }).then(function (lastPage) {
      var startPage = 1;
      if (lastPage && isFirstLoad) {
        startPage = lastPage;
      }

      // Step 3: Fetch fresh data from API
      _refreshData(false, startPage);
    }).catch(function (err) {
      console.error('Cache load error:', err);
      _refreshData(false);
    });
  }

  function _refreshData(isManual, startPage) {
    if (fetchController) {
      fetchController.abort();
    }

    startPage = startPage || 1;

    if (isManual) {
      // Full refresh: clear resumable state
      TicketCache.deleteMeta('lastPage');
      startPage = 1;
    }

    $refreshBtn.classList.add('app-header__refresh--spinning');

    if (isFirstLoad) {
      $progressContainer.style.display = 'block';
      $progressFill.style.width = '0%';
      $progressText.textContent = 'Fetching suspended tickets...';
    } else {
      _setSyncStatus('Syncing...');
    }

    var freshTickets = [];
    var receivedTotal = 0;

    fetchController = TicketAPI.fetchAllSuspendedTickets(client, {
      startPage: startPage,
      onPage: function (tickets, pageNum, totalEstimate) {
        freshTickets = freshTickets.concat(tickets);
        receivedTotal = totalEstimate;

        // Save resumable state
        TicketCache.setMeta('lastPage', pageNum + 1);

        // Cache incrementally
        TicketCache.upsertTickets(tickets);

        // Update progress bar on first load
        if (isFirstLoad && totalEstimate > 0) {
          var pct = Math.min(100, Math.round((freshTickets.length / totalEstimate) * 100));
          $progressFill.style.width = pct + '%';
          $progressText.textContent = 'Loaded ' + freshTickets.length + ' of ~' + totalEstimate + ' tickets...';
        }
      },
      onComplete: function (total) {
        fetchController = null;
        $refreshBtn.classList.remove('app-header__refresh--spinning');
        $progressContainer.style.display = 'none';
        isFirstLoad = false;

        // Reconcile: remove tickets no longer in API response
        if (startPage === 1 && freshTickets.length > 0) {
          var freshIds = new Set(freshTickets.map(function (t) { return t.id; }));
          var staleIds = allTickets
            .filter(function (t) { return !freshIds.has(t.id); })
            .map(function (t) { return t.id; });
          if (staleIds.length > 0) {
            TicketCache.removeTickets(staleIds);
          }
          allTickets = freshTickets;
        } else if (freshTickets.length > 0) {
          // Merge with existing
          var existingMap = {};
          allTickets.forEach(function (t) { existingMap[t.id] = t; });
          freshTickets.forEach(function (t) { existingMap[t.id] = t; });
          allTickets = Object.keys(existingMap).map(function (id) { return existingMap[id]; });
        }

        // Clear resumable state on complete
        TicketCache.deleteMeta('lastPage');
        TicketCache.setMeta('lastFetchedAt', new Date().toISOString());

        _applyFilters();
        _updateDashboard();
        _setSyncStatus('Synced just now');
      },
      onError: function (err, page) {
        fetchController = null;
        $refreshBtn.classList.remove('app-header__refresh--spinning');
        $progressContainer.style.display = 'none';

        console.error('Fetch error at page ' + page + ':', err);

        // Save page for resume
        TicketCache.setMeta('lastPage', page);

        if (allTickets.length > 0) {
          _setSyncStatus('Sync failed (showing cached)');
          _showNotification('Failed to sync. Showing cached data.', 'error');
        } else {
          _setSyncStatus('Error loading tickets');
          _showNotification('Failed to load suspended tickets. Please try again.', 'error');
        }
      }
    });
  }

  // ── Filtering & Rendering ────────────────────────────────

  function _applyFilters() {
    filteredTickets = TicketSearch.filterTickets(allTickets, {
      query: $searchInput.value,
      causeId: $causeFilter.value,
      sort: $sortFilter.value
    });

    virtualList.setItems(filteredTickets);
    _updateTicketListVisibility();
    _updateCauseFilterOptions();
  }

  function _updateTicketListVisibility() {
    if (filteredTickets.length === 0) {
      $ticketListContainer.style.display = 'none';
      $emptyState.style.display = 'block';
      $emptyText.textContent = allTickets.length === 0
        ? 'No suspended tickets found.'
        : 'No tickets match your search.';
    } else {
      $ticketListContainer.style.display = 'block';
      $emptyState.style.display = 'none';
    }
  }

  function _updateCauseFilterOptions() {
    var causes = TicketSearch.extractCauses(allTickets);
    var currentValue = $causeFilter.value;

    // Rebuild options
    var html = '<option value="">All Causes (' + allTickets.length + ')</option>';
    causes.forEach(function (cause) {
      html += '<option value="' + cause.id + '">' + _escapeHtml(cause.name) + ' (' + cause.count + ')</option>';
    });

    $causeFilter.innerHTML = html;
    $causeFilter.value = currentValue;
  }

  /**
   * Render a single ticket row for the virtual list.
   */
  function _renderTicketRow(ticket, index, isSelected) {
    var causeClass = _getCauseClass(ticket.cause);
    var author = ticket.author
      ? (ticket.author.email || ticket.author.name || 'Unknown')
      : 'Unknown';
    var date = _formatDate(ticket.created_at);
    var selectedClass = isSelected ? ' vl-ticket--selected' : '';

    return '<div class="vl-ticket' + selectedClass + '">' +
      '<label class="c-chk vl-checkbox" data-id="' + ticket.id + '">' +
        '<input class="c-chk__input" type="checkbox"' + (isSelected ? ' checked' : '') + '>' +
        '<span class="c-chk__label"></span>' +
      '</label>' +
      '<div class="vl-ticket__body">' +
        '<div class="vl-ticket__subject">' + _escapeHtml(ticket.subject || '(no subject)') + '</div>' +
        '<div class="vl-ticket__meta">' +
          '<span class="cause-tag cause-tag--' + causeClass + '">' + _escapeHtml(ticket.cause || 'Unknown') + '</span>' +
          '<span class="vl-ticket__author">' + _escapeHtml(author) + '</span>' +
          '<span class="vl-ticket__date">' + date + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="vl-ticket__actions">' +
        '<button class="vl-preview-btn" data-id="' + ticket.id + '">Preview</button>' +
      '</div>' +
    '</div>';
  }

  // ── Dashboard ────────────────────────────────────────────

  function _updateDashboard() {
    var total = allTickets.length;
    var spamN = 0, autoN = 0, otherN = 0;

    allTickets.forEach(function (t) {
      var cause = (t.cause || '').toLowerCase();
      if (cause.indexOf('spam') !== -1) spamN++;
      else if (cause.indexOf('auto') !== -1) autoN++;
      else otherN++;
    });

    $totalCount.textContent = total;
    $spamCount.textContent = spamN;
    $autoCount.textContent = autoN;
    $otherCount.textContent = otherN;

    // Render charts
    if (typeof Chart !== 'undefined') {
      TicketCharts.renderTrendChart('trendChart', allTickets);
      TicketCharts.renderCauseChart('causeChart', allTickets);
    }

    // Repeat offenders
    _updateRepeatOffenders();
  }

  function _updateRepeatOffenders() {
    var offenders = TicketSearch.findRepeatOffenders(allTickets, 3);

    if (offenders.length === 0) {
      $repeatOffendersSection.style.display = 'none';
      return;
    }

    $repeatOffendersSection.style.display = 'block';
    var html = '';
    offenders.slice(0, 10).forEach(function (o) {
      html += '<div class="app-offender">' +
        '<span class="app-offender__email">' + _escapeHtml(o.email || o.name) + '</span>' +
        '<span class="app-offender__count">' + o.count + '</span>' +
      '</div>';
    });
    $repeatOffendersList.innerHTML = html;
  }

  // ── Selection Handling ───────────────────────────────────

  function _onSelectionChange(selectedIds) {
    var count = selectedIds.length;
    $selectedCount.style.display = count > 0 ? 'inline' : 'none';
    $selectedCount.textContent = count + ' selected';
    $recoverBtn.disabled = count === 0;
    $deleteBtn.disabled = count === 0;
    $selectAll.checked = count > 0 && count === filteredTickets.length;
  }

  // ── Bulk Actions ─────────────────────────────────────────

  var _pendingAction = null;

  function _confirmBulkAction(action) {
    var ids = virtualList.getSelectedIds();
    if (ids.length === 0) return;

    var actionLabel = action === 'recover' ? 'Recover' : 'Delete';
    $modalTitle.textContent = actionLabel + ' Tickets';
    $modalMessage.textContent = 'Are you sure you want to ' + action + ' ' + ids.length + ' suspended ticket' + (ids.length > 1 ? 's' : '') + '?';
    $modalConfirm.textContent = actionLabel;
    $modalConfirm.className = 'c-btn c-btn--sm' + (action === 'delete' ? ' c-btn--danger' : ' c-btn--primary');

    _pendingAction = { action: action, ids: ids };

    $modalConfirm.onclick = function () {
      _closeModal();
      if (_pendingAction) {
        _executeBulkAction(_pendingAction.action, _pendingAction.ids);
        _pendingAction = null;
      }
    };

    $confirmModal.style.display = 'flex';
  }

  function _closeModal() {
    $confirmModal.style.display = 'none';
    _pendingAction = null;
  }

  function _executeBulkAction(action, ids) {
    var ticketObjects = allTickets.filter(function (t) {
      return ids.indexOf(t.id) !== -1;
    });

    var apiCall = action === 'recover'
      ? TicketAPI.recoverTickets(client, ids)
      : TicketAPI.deleteTickets(client, ids);

    _showNotification('Processing ' + ids.length + ' ticket' + (ids.length > 1 ? 's' : '') + '...', 'info');

    apiCall.then(function (result) {
      var successCount = result.recovered || result.deleted || 0;
      var failedCount = result.failed ? result.failed.length : 0;

      // Remove successful tickets from cache
      var successIds = ids.filter(function (id) {
        return !result.failed || result.failed.indexOf(id) === -1;
      });

      return Promise.all([
        TicketCache.removeTickets(successIds),
        action === 'recover'
          ? ActionLogger.logRecovery(ticketObjects.filter(function (t) { return successIds.indexOf(t.id) !== -1; }))
          : ActionLogger.logDeletion(ticketObjects.filter(function (t) { return successIds.indexOf(t.id) !== -1; }))
      ]).then(function () {
        // Update in-memory state
        allTickets = allTickets.filter(function (t) {
          return successIds.indexOf(t.id) === -1;
        });

        _applyFilters();
        _updateDashboard();

        var label = action === 'recover' ? 'Recovered' : 'Deleted';
        if (failedCount > 0) {
          _showNotification(label + ' ' + successCount + ' tickets. ' + failedCount + ' failed.', 'error');
        } else {
          _showNotification(label + ' ' + successCount + ' ticket' + (successCount > 1 ? 's' : '') + ' successfully.', 'success');
        }
      });
    }).catch(function (err) {
      console.error('Bulk action error:', err);
      _showNotification('Failed to ' + action + ' tickets. Please try again.', 'error');
    });
  }

  // ── Tab Switching ────────────────────────────────────────

  function _switchTab(tabName) {
    currentTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.app-tabs__tab').forEach(function (tab) {
      tab.classList.toggle('app-tabs__tab--active', tab.dataset.tab === tabName);
    });

    // Show/hide tab content
    document.querySelectorAll('.app-tab-content').forEach(function (content) {
      content.style.display = 'none';
    });
    var target = document.getElementById('tab-' + tabName);
    if (target) target.style.display = 'block';

    // Load log data when switching to log tab
    if (tabName === 'log') {
      _renderActionLog();
    }

    // Refresh virtual list when switching to tickets tab
    if (tabName === 'tickets') {
      virtualList.refresh();
    }
  }

  // ── Action Log ───────────────────────────────────────────

  function _renderActionLog() {
    ActionLogger.getRecentLogs().then(function (logs) {
      if (logs.length === 0) {
        $logList.innerHTML = '<div class="app-empty"><p>No actions recorded yet.</p></div>';
        return;
      }

      var html = '';
      logs.forEach(function (log) {
        var iconClass = log.action === 'recovered' ? 'app-log-entry__icon--recovered' : 'app-log-entry__icon--deleted';
        var iconSymbol = log.action === 'recovered' ? '&#10003;' : '&#10005;';
        var timeAgo = _timeAgo(log.timestamp);

        html += '<div class="app-log-entry">' +
          '<div class="app-log-entry__icon ' + iconClass + '">' + iconSymbol + '</div>' +
          '<div class="app-log-entry__body">' +
            '<div class="app-log-entry__action">' + _capitalize(log.action) + '</div>' +
            '<div class="app-log-entry__subject">' + _escapeHtml(log.subject) + '</div>' +
            '<div class="app-log-entry__time">' + _escapeHtml(log.author) + ' &middot; ' + timeAgo + '</div>' +
          '</div>' +
        '</div>';
      });

      $logList.innerHTML = html;
    });
  }

  // ── Preview Drawer ───────────────────────────────────────

  function _openPreview(ticket) {
    $previewSubject.textContent = ticket.subject || '(no subject)';
    $previewMeta.innerHTML =
      '<p><strong>Author:</strong> ' + _escapeHtml(ticket.author ? (ticket.author.email || ticket.author.name) : 'Unknown') + '</p>' +
      '<p><strong>Cause:</strong> ' + _escapeHtml(ticket.cause || 'Unknown') + '</p>' +
      '<p><strong>Recipient:</strong> ' + _escapeHtml(ticket.recipient || 'N/A') + '</p>' +
      '<p><strong>Date:</strong> ' + _formatDate(ticket.created_at) + '</p>';
    $previewContent.textContent = ticket.content || '(no content)';
    $previewRecover.dataset.id = ticket.id;
    $previewDelete.dataset.id = ticket.id;
    $ticketPreview.style.display = 'flex';
  }

  function _closePreview() {
    $ticketPreview.style.display = 'none';
  }

  // ── Keyboard Shortcuts ───────────────────────────────────

  function _handleKeyboard(e) {
    // Don't handle shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    switch (e.key) {
      case 'a':
        if (currentTab === 'tickets') {
          e.preventDefault();
          $selectAll.checked = !$selectAll.checked;
          virtualList.selectAll($selectAll.checked);
        }
        break;
      case 'r':
        if (currentTab === 'tickets' && !$recoverBtn.disabled) {
          e.preventDefault();
          _confirmBulkAction('recover');
        }
        break;
      case 'd':
        if (currentTab === 'tickets' && !$deleteBtn.disabled) {
          e.preventDefault();
          _confirmBulkAction('delete');
        }
        break;
      case 'j':
        if (currentTab === 'tickets') {
          e.preventDefault();
          virtualList.navigate('down');
        }
        break;
      case 'k':
        if (currentTab === 'tickets') {
          e.preventDefault();
          virtualList.navigate('up');
        }
        break;
      case '/':
        e.preventDefault();
        $searchInput.focus();
        break;
      case 'Escape':
        _closeModal();
        _closePreview();
        $searchInput.blur();
        break;
    }
  }

  // ── Auto Refresh ─────────────────────────────────────────

  function _startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(function () {
      _refreshData(false);
    }, AUTO_REFRESH_INTERVAL);
  }

  // ── Notifications ────────────────────────────────────────

  function _showNotification(message, type) {
    type = type || 'info';
    $notificationText.textContent = message;
    $notification.className = 'app-notification app-notification--' + type;
    $notification.style.display = 'block';

    setTimeout(function () {
      $notification.style.display = 'none';
    }, NOTIFICATION_DURATION);
  }

  // ── Helpers ──────────────────────────────────────────────

  function _setSyncStatus(text) {
    $syncText.textContent = text;
  }

  function _getCauseClass(cause) {
    var lower = (cause || '').toLowerCase();
    if (lower.indexOf('spam') !== -1) return 'spam';
    if (lower.indexOf('auto') !== -1) return 'automated';
    if (lower.indexOf('format') !== -1) return 'formatting';
    return 'other';
  }

  function _formatDate(isoString) {
    if (!isoString) return '';
    try {
      var date = new Date(isoString);
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
    } catch (e) {
      return isoString;
    }
  }

  function _timeAgo(isoString) {
    if (!isoString) return '';
    var now = new Date();
    var then = new Date(isoString);
    var diff = Math.floor((now - then) / 1000);

    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function _capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  function _escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  function _cleanupExpiredLogs() {
    ActionLogger.cleanup().catch(function (err) {
      console.error('Log cleanup error:', err);
    });
  }

  // ── Boot ─────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
