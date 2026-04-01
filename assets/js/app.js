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
  var $confirmModal, $modalTitle, $modalMessage, $modalCancel, $modalConfirm, $modalDeleteInput, $modalDeleteConfirm;
  var $notification, $notificationText;
  var $ticketPreview, $previewSubject, $previewMeta, $previewContent;
  var $previewRecover, $previewDelete, $previewClose;
  var $exportCsvBtn, $exportLogBtn;
  var $logList;
  var $repeatOffendersSection, $repeatOffendersList;
  var $topDomainsSection, $topDomainsList, $domainChartSection;
  var _domainFilter = '';
  var $presetContainer, $presetSaveRow, $presetNameInput, $savePresetBtn, $cancelPresetBtn;
  var $rulesList, $ruleEditor, $ruleEditorTitle, $ruleNameInputR, $ruleConditions;
  var $addConditionBtn, $cancelRuleBtn, $saveRuleBtn, $newRuleBtn, $applyRecommendationsBtn;
  var _triageRules = [];
  var _editingRuleId = null;
  var _filterPresets = [];
  var _activePresetId = '';

  var BUILT_IN_PRESETS = [
    { id: '__all_spam', name: 'All Spam', builtin: true, criteria: { query: 'spam', causeId: '', sort: 'newest', dateFrom: '', dateTo: '', urgencyLevel: '' } },
    { id: '__today', name: "Today's Tickets", builtin: true, criteria: { query: '', causeId: '', sort: 'newest', dateFrom: '__TODAY__', dateTo: '__TODAY__', urgencyLevel: '' } },
    { id: '__this_week', name: 'This Week', builtin: true, criteria: { query: '', causeId: '', sort: 'newest', dateFrom: '__WEEK_START__', dateTo: '__TODAY__', urgencyLevel: '' } },
    { id: '__high_urgency', name: 'High Urgency', builtin: true, criteria: { query: '', causeId: '', sort: 'urgency', dateFrom: '', dateTo: '', urgencyLevel: 'critical' } }
  ];
  var $dateFrom, $dateTo, $dateClear;
  var $dashDateFrom, $dashDateTo, $dashDateClear;
  var $urgencyFilter, $urgencySummary;
  var $urgencyCritical, $urgencyUrgent, $urgencyWarning, $urgencySafe;

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
    $modalDeleteInput = document.getElementById('modalDeleteInput');
    $modalDeleteConfirm = document.getElementById('modalDeleteConfirm');
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
    $rulesList = document.getElementById('rulesList');
    $ruleEditor = document.getElementById('ruleEditor');
    $ruleEditorTitle = document.getElementById('ruleEditorTitle');
    $ruleNameInputR = document.getElementById('ruleNameInput');
    $ruleConditions = document.getElementById('ruleConditions');
    $addConditionBtn = document.getElementById('addConditionBtn');
    $cancelRuleBtn = document.getElementById('cancelRuleBtn');
    $saveRuleBtn = document.getElementById('saveRuleBtn');
    $newRuleBtn = document.getElementById('newRuleBtn');
    $applyRecommendationsBtn = document.getElementById('applyRecommendationsBtn');
    $presetContainer = document.getElementById('presetContainer');
    $presetSaveRow = document.getElementById('presetSaveRow');
    $presetNameInput = document.getElementById('presetNameInput');
    $savePresetBtn = document.getElementById('savePresetBtn');
    $cancelPresetBtn = document.getElementById('cancelPresetBtn');
    $topDomainsSection = document.getElementById('topDomainsSection');
    $topDomainsList = document.getElementById('topDomainsList');
    $domainChartSection = document.getElementById('domainChartSection');
    $dateFrom = document.getElementById('dateFrom');
    $dateTo = document.getElementById('dateTo');
    $dateClear = document.getElementById('dateClear');
    $dashDateFrom = document.getElementById('dashDateFrom');
    $dashDateTo = document.getElementById('dashDateTo');
    $dashDateClear = document.getElementById('dashDateClear');
    $urgencyFilter = document.getElementById('urgencyFilter');
    $urgencySummary = document.getElementById('urgencySummary');
    $urgencyCritical = document.getElementById('urgencyCritical');
    $urgencyUrgent = document.getElementById('urgencyUrgent');
    $urgencyWarning = document.getElementById('urgencyWarning');
    $urgencySafe = document.getElementById('urgencySafe');
  }

  function _initZAF() {
    client = ZAFClient.init();

    client.on('app.registered', function () {
      _bindEvents();
      _initVirtualList();
      _loadPresets();
      _loadTriageRules();
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
    $urgencyFilter.addEventListener('change', _applyFilters);

    // Date range (tickets)
    $dateFrom.addEventListener('change', _applyFilters);
    $dateTo.addEventListener('change', _applyFilters);
    $dateClear.addEventListener('click', function () {
      $dateFrom.value = '';
      $dateTo.value = '';
      _applyFilters();
    });

    // Rules
    $newRuleBtn.addEventListener('click', function () { _openRuleEditor(null); });
    $addConditionBtn.addEventListener('click', function () { _addConditionRow(); });
    $cancelRuleBtn.addEventListener('click', function () {
      $ruleEditor.style.display = 'none';
      _editingRuleId = null;
    });
    $saveRuleBtn.addEventListener('click', _saveRuleFromEditor);
    $rulesList.addEventListener('click', function (e) {
      var editBtn = e.target.closest('.app-rule-item__edit');
      var deleteBtn = e.target.closest('.app-rule-item__delete');
      var toggleBtn = e.target.closest('.app-rule-item__toggle');
      var ruleId = e.target.closest('[data-rule-id]');
      if (!ruleId) return;
      var id = ruleId.dataset.ruleId;

      if (deleteBtn) {
        _deleteTriageRule(id);
      } else if (editBtn) {
        var rule = _triageRules.find(function (r) { return r.id === id; });
        if (rule) _openRuleEditor(rule);
      } else if (toggleBtn) {
        var toggleRule = _triageRules.find(function (r) { return r.id === id; });
        if (toggleRule) {
          TriageRules.toggleRule(toggleRule).then(function () {
            _evaluateAndRenderRules();
          });
        }
      }
    });
    $applyRecommendationsBtn.addEventListener('click', _applyRecommendations);

    // Presets
    $presetContainer.addEventListener('click', function (e) {
      var btn = e.target.closest('.app-preset-btn');
      if (!btn) return;

      var deleteBtn = e.target.closest('.app-preset-btn__delete');
      if (deleteBtn) {
        _deletePreset(btn.dataset.presetId);
        return;
      }

      if (btn.dataset.presetId === '__save_new') {
        $presetSaveRow.style.display = 'flex';
        $presetNameInput.focus();
        return;
      }

      _applyPreset(btn.dataset.presetId);
    });
    $savePresetBtn.addEventListener('click', function () {
      var name = $presetNameInput.value.trim();
      if (name) _saveCurrentAsPreset(name);
    });
    $cancelPresetBtn.addEventListener('click', function () {
      $presetSaveRow.style.display = 'none';
      $presetNameInput.value = '';
    });

    // Domain click (dashboard → tickets)
    $topDomainsList.addEventListener('click', function (e) {
      var item = e.target.closest('.app-domain-item');
      if (item && item.dataset.domain) {
        _domainFilter = item.dataset.domain;
        _switchTab('tickets');
        $searchInput.value = '@' + item.dataset.domain;
        _applyFilters();
      }
    });

    // Date range (dashboard)
    $dashDateFrom.addEventListener('change', function () { _updateDashboard(); });
    $dashDateTo.addEventListener('change', function () { _updateDashboard(); });
    $dashDateClear.addEventListener('click', function () {
      $dashDateFrom.value = '';
      $dashDateTo.value = '';
      _updateDashboard();
    });

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
      if (id) _startUndoCountdown('recover', [id]);
      _closePreview();
    });
    $previewDelete.addEventListener('click', function () {
      var id = Number($previewDelete.dataset.id);
      if (id) _startUndoCountdown('delete', [id]);
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
        TicketSearch.enrichWithUrgency(allTickets);
        _evaluateRulesOnTickets();
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

        TicketSearch.enrichWithUrgency(allTickets);
        _evaluateRulesOnTickets();
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
      sort: $sortFilter.value,
      dateFrom: $dateFrom ? $dateFrom.value : '',
      dateTo: $dateTo ? $dateTo.value : ''
    });

    // Urgency filter
    var urgencyLevel = $urgencyFilter ? $urgencyFilter.value : '';
    if (urgencyLevel) {
      filteredTickets = filteredTickets.filter(function (t) {
        return t._urgency && t._urgency.level === urgencyLevel;
      });
    }

    // Domain filter (set by clicking domain in dashboard)
    if (_domainFilter) {
      filteredTickets = filteredTickets.filter(function (t) {
        var email = t.author ? t.author.email : '';
        return TicketSearch.extractDomain(email) === _domainFilter;
      });
      // Clear domain filter after applying (one-shot via search)
      _domainFilter = '';
    }

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
          _renderUrgencyBadge(ticket) +
          _renderRecommendationBadge(ticket) +
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
    // Filter by dashboard date range if set
    var dashTickets = allTickets;
    var dashFrom = $dashDateFrom ? $dashDateFrom.value : '';
    var dashTo = $dashDateTo ? $dashDateTo.value : '';
    if (dashFrom || dashTo) {
      dashTickets = allTickets.filter(function (t) {
        var d = t.created_at || '';
        if (dashFrom && d < dashFrom) return false;
        if (dashTo && d > dashTo + 'T23:59:59.999Z') return false;
        return true;
      });
    }

    var total = dashTickets.length;
    var spamN = 0, autoN = 0, otherN = 0;

    dashTickets.forEach(function (t) {
      var cause = (t.cause || '').toLowerCase();
      if (cause.indexOf('spam') !== -1) spamN++;
      else if (cause.indexOf('auto') !== -1) autoN++;
      else otherN++;
    });

    $totalCount.textContent = total;
    $spamCount.textContent = spamN;
    $autoCount.textContent = autoN;
    $otherCount.textContent = otherN;

    // Urgency summary
    _updateUrgencySummary();

    // Render charts
    if (typeof Chart !== 'undefined') {
      TicketCharts.renderTrendChart('trendChart', dashTickets);
      TicketCharts.renderCauseChart('causeChart', dashTickets);
      TicketCharts.renderDomainChart('domainChart', dashTickets);
    }

    // Top domains
    _updateTopDomains(dashTickets);

    // Repeat offenders
    _updateRepeatOffenders();
  }

  // ── Auto-Triage Rules ──────────────────────────────────────

  function _loadTriageRules() {
    return TriageRules.getAllRules().then(function (rules) {
      _triageRules = rules;
    }).catch(function () {
      _triageRules = [];
    });
  }

  function _evaluateRulesOnTickets() {
    if (_triageRules.length === 0) {
      $applyRecommendationsBtn.style.display = 'none';
      return;
    }
    var results = TriageRules.evaluateAll(allTickets, _triageRules);
    var totalRecs = results.recover.length + results.delete.length;
    if (totalRecs > 0) {
      $applyRecommendationsBtn.style.display = 'inline-block';
      $applyRecommendationsBtn.textContent = 'Apply Rules (' + totalRecs + ')';
    } else {
      $applyRecommendationsBtn.style.display = 'none';
    }
  }

  function _evaluateAndRenderRules() {
    _evaluateRulesOnTickets();
    _applyFilters();
    _renderRulesTab();
  }

  function _renderRulesTab() {
    if (_triageRules.length === 0) {
      $rulesList.innerHTML = '<div class="app-empty"><p>No rules configured yet. Click "New Rule" to create one.</p></div>';
      return;
    }

    var html = '';
    _triageRules.forEach(function (rule) {
      var condSummary = (rule.conditions || []).map(function (c) {
        return c.field + ' ' + c.operator + ' "' + c.value + '"';
      }).join(' AND ');

      html += '<div class="app-rule-item" data-rule-id="' + rule.id + '">' +
        '<div class="app-rule-item__info">' +
          '<div class="app-rule-item__name">' + _escapeHtml(rule.name) + '</div>' +
          '<div class="app-rule-item__conditions">' + _escapeHtml(condSummary || 'No conditions') + '</div>' +
        '</div>' +
        '<span class="recommend-badge recommend-badge--' + rule.action + '">' + _capitalize(rule.action) + '</span>' +
        '<label class="app-rule-item__toggle" title="' + (rule.enabled ? 'Enabled' : 'Disabled') + '">' +
          '<input type="checkbox"' + (rule.enabled ? ' checked' : '') + '> ' +
          (rule.enabled ? 'On' : 'Off') +
        '</label>' +
        '<button class="c-btn c-btn--basic c-btn--sm app-rule-item__edit" title="Edit">Edit</button>' +
        '<button class="c-btn c-btn--basic c-btn--sm app-rule-item__delete" title="Delete">&times;</button>' +
      '</div>';
    });
    $rulesList.innerHTML = html;
  }

  function _openRuleEditor(rule) {
    _editingRuleId = rule ? rule.id : null;
    $ruleEditorTitle.textContent = rule ? 'Edit Rule' : 'New Rule';
    $ruleNameInputR.value = rule ? rule.name : '';

    // Set action radio
    var actionValue = rule ? rule.action : 'delete';
    var radios = document.querySelectorAll('input[name="ruleAction"]');
    radios.forEach(function (r) { r.checked = r.value === actionValue; });

    // Render conditions
    $ruleConditions.innerHTML = '';
    if (rule && rule.conditions) {
      rule.conditions.forEach(function (c) {
        _addConditionRow(c);
      });
    } else {
      _addConditionRow();
    }

    $ruleEditor.style.display = 'block';
  }

  function _addConditionRow(condition) {
    condition = condition || { field: 'domain', operator: 'contains', value: '' };

    var row = document.createElement('div');
    row.className = 'app-rule-condition u-mt-xs';

    var fieldSelect = '<select class="c-txt__input c-txt__input--select c-txt__input--sm app-rule-condition__field">' +
      '<option value="domain"' + (condition.field === 'domain' ? ' selected' : '') + '>Domain</option>' +
      '<option value="cause"' + (condition.field === 'cause' ? ' selected' : '') + '>Cause</option>' +
      '<option value="subject"' + (condition.field === 'subject' ? ' selected' : '') + '>Subject</option>' +
      '<option value="age_days"' + (condition.field === 'age_days' ? ' selected' : '') + '>Age (days)</option>' +
    '</select>';

    var isNumeric = condition.field === 'age_days';
    var opOptions;
    if (isNumeric) {
      opOptions = '<option value=">"' + (condition.operator === '>' ? ' selected' : '') + '>&gt;</option>' +
        '<option value="<"' + (condition.operator === '<' ? ' selected' : '') + '>&lt;</option>' +
        '<option value="="' + (condition.operator === '=' ? ' selected' : '') + '>=</option>' +
        '<option value=">="' + (condition.operator === '>=' ? ' selected' : '') + '>&gt;=</option>' +
        '<option value="<="' + (condition.operator === '<=' ? ' selected' : '') + '>&lt;=</option>';
    } else {
      opOptions = '<option value="contains"' + (condition.operator === 'contains' ? ' selected' : '') + '>contains</option>' +
        '<option value="equals"' + (condition.operator === 'equals' ? ' selected' : '') + '>equals</option>' +
        '<option value="matches"' + (condition.operator === 'matches' ? ' selected' : '') + '>matches (regex)</option>';
    }

    var opSelect = '<select class="c-txt__input c-txt__input--select c-txt__input--sm app-rule-condition__op">' + opOptions + '</select>';
    var valueInput = '<input class="c-txt__input c-txt__input--sm app-rule-condition__value" type="text" value="' + _escapeHtml(condition.value) + '" placeholder="Value">';
    var removeBtn = '<button class="c-btn c-btn--basic c-btn--sm app-rule-condition__remove" type="button">&times;</button>';

    row.innerHTML = fieldSelect + opSelect + valueInput + removeBtn;

    // Update operators when field changes
    var fieldEl = row.querySelector('.app-rule-condition__field');
    var opEl = row.querySelector('.app-rule-condition__op');
    fieldEl.addEventListener('change', function () {
      var isNum = fieldEl.value === 'age_days';
      if (isNum) {
        opEl.innerHTML = '<option value=">">&gt;</option><option value="<">&lt;</option><option value="=">=</option><option value=">=">&gt;=</option><option value="<=">&lt;=</option>';
      } else {
        opEl.innerHTML = '<option value="contains">contains</option><option value="equals">equals</option><option value="matches">matches (regex)</option>';
      }
    });

    // Remove button
    row.querySelector('.app-rule-condition__remove').addEventListener('click', function () {
      row.remove();
    });

    $ruleConditions.appendChild(row);
  }

  function _saveRuleFromEditor() {
    var name = $ruleNameInputR.value.trim();
    if (!name) {
      _showNotification('Please enter a rule name.', 'error');
      return;
    }

    // Gather conditions
    var conditionRows = $ruleConditions.querySelectorAll('.app-rule-condition');
    var conditions = [];
    conditionRows.forEach(function (row) {
      var field = row.querySelector('.app-rule-condition__field').value;
      var op = row.querySelector('.app-rule-condition__op').value;
      var value = row.querySelector('.app-rule-condition__value').value.trim();
      if (value) {
        conditions.push({ field: field, operator: op, value: value });
      }
    });

    if (conditions.length === 0) {
      _showNotification('Please add at least one condition with a value.', 'error');
      return;
    }

    // Get action
    var actionRadio = document.querySelector('input[name="ruleAction"]:checked');
    var action = actionRadio ? actionRadio.value : 'delete';

    var rule = {
      id: _editingRuleId || TriageRules.generateId(),
      name: name,
      conditions: conditions,
      action: action,
      enabled: true,
      createdAt: new Date().toISOString()
    };

    TriageRules.saveRule(rule).then(function () {
      return _loadTriageRules();
    }).then(function () {
      $ruleEditor.style.display = 'none';
      _editingRuleId = null;
      _evaluateAndRenderRules();
      _showNotification('Rule "' + name + '" saved.', 'success');
    }).catch(function (err) {
      console.error('Save rule error:', err);
      _showNotification('Failed to save rule.', 'error');
    });
  }

  function _deleteTriageRule(id) {
    TriageRules.deleteRule(id).then(function () {
      return _loadTriageRules();
    }).then(function () {
      _evaluateAndRenderRules();
      _showNotification('Rule deleted.', 'success');
    }).catch(function (err) {
      console.error('Delete rule error:', err);
      _showNotification('Failed to delete rule.', 'error');
    });
  }

  function _applyRecommendations() {
    var recoverIds = [];
    var deleteIds = [];

    allTickets.forEach(function (t) {
      if (t._recommendation) {
        if (t._recommendation.action === 'recover') recoverIds.push(t.id);
        else if (t._recommendation.action === 'delete') deleteIds.push(t.id);
      }
    });

    if (recoverIds.length === 0 && deleteIds.length === 0) {
      _showNotification('No recommendations to apply.', 'info');
      return;
    }

    var msg = '';
    if (recoverIds.length > 0) msg += 'Recover ' + recoverIds.length;
    if (deleteIds.length > 0) msg += (msg ? ', ' : '') + 'Delete ' + deleteIds.length;

    $modalTitle.textContent = 'Apply Recommendations';
    $modalMessage.textContent = msg + ' ticket' + ((recoverIds.length + deleteIds.length) > 1 ? 's' : '') + ' based on auto-triage rules?';
    $modalConfirm.textContent = 'Apply';
    $modalConfirm.className = 'c-btn c-btn--primary c-btn--sm';
    $modalDeleteInput.style.display = 'none';
    $modalConfirm.disabled = false;

    $modalConfirm.onclick = function () {
      _closeModal();
      // Execute recoveries first, then deletions
      if (recoverIds.length > 0) _startUndoCountdown('recover', recoverIds);
      // Queue deletions after a delay if there are also recoveries
      if (deleteIds.length > 0) {
        if (recoverIds.length > 0) {
          // Wait for recovery undo to resolve before starting delete
          setTimeout(function () {
            _startUndoCountdown('delete', deleteIds);
          }, (UNDO_COUNTDOWN_SECONDS + 1) * 1000);
        } else {
          _startUndoCountdown('delete', deleteIds);
        }
      }
    };

    $confirmModal.style.display = 'flex';
  }

  // ── Filter Presets ──────────────────────────────────────────

  function _resolvePresetDates(criteria) {
    var resolved = {};
    for (var key in criteria) {
      resolved[key] = criteria[key];
    }
    var today = new Date();
    var todayStr = today.toISOString().split('T')[0];

    if (resolved.dateFrom === '__TODAY__') resolved.dateFrom = todayStr;
    if (resolved.dateTo === '__TODAY__') resolved.dateTo = todayStr;
    if (resolved.dateFrom === '__WEEK_START__') {
      var day = today.getDay();
      var diff = day === 0 ? 6 : day - 1; // Monday as week start
      var monday = new Date(today);
      monday.setDate(today.getDate() - diff);
      resolved.dateFrom = monday.toISOString().split('T')[0];
    }
    return resolved;
  }

  function _applyPreset(presetId) {
    // Find preset in built-in or custom
    var preset = null;
    BUILT_IN_PRESETS.forEach(function (p) { if (p.id === presetId) preset = p; });
    if (!preset) {
      _filterPresets.forEach(function (p) { if (p.id === presetId) preset = p; });
    }
    if (!preset) return;

    _activePresetId = presetId;
    var c = _resolvePresetDates(preset.criteria);

    $searchInput.value = c.query || '';
    $causeFilter.value = c.causeId || '';
    $sortFilter.value = c.sort || 'newest';
    $dateFrom.value = c.dateFrom || '';
    $dateTo.value = c.dateTo || '';
    $urgencyFilter.value = c.urgencyLevel || '';

    _applyFilters();
    _renderPresets();
  }

  function _saveCurrentAsPreset(name) {
    var preset = {
      id: 'custom_' + Date.now(),
      name: name,
      builtin: false,
      criteria: {
        query: $searchInput.value,
        causeId: $causeFilter.value,
        sort: $sortFilter.value,
        dateFrom: $dateFrom.value,
        dateTo: $dateTo.value,
        urgencyLevel: $urgencyFilter.value
      }
    };
    _filterPresets.push(preset);
    TicketCache.setMeta('filterPresets', _filterPresets);
    $presetSaveRow.style.display = 'none';
    $presetNameInput.value = '';
    _activePresetId = preset.id;
    _renderPresets();
    _showNotification('Preset "' + name + '" saved.', 'success');
  }

  function _deletePreset(presetId) {
    _filterPresets = _filterPresets.filter(function (p) { return p.id !== presetId; });
    TicketCache.setMeta('filterPresets', _filterPresets);
    if (_activePresetId === presetId) _activePresetId = '';
    _renderPresets();
  }

  function _loadPresets() {
    return TicketCache.getMeta('filterPresets').then(function (presets) {
      _filterPresets = presets || [];
      _renderPresets();
    }).catch(function () {
      _filterPresets = [];
      _renderPresets();
    });
  }

  function _renderPresets() {
    var html = '';
    var allPresets = BUILT_IN_PRESETS.concat(_filterPresets);

    allPresets.forEach(function (p) {
      var activeClass = _activePresetId === p.id ? ' app-preset-btn--active' : '';
      var builtinClass = p.builtin ? ' app-preset-btn--builtin' : '';
      html += '<button class="app-preset-btn' + activeClass + builtinClass + '" data-preset-id="' + p.id + '">';
      html += _escapeHtml(p.name);
      if (!p.builtin) {
        html += '<span class="app-preset-btn__delete" title="Delete preset">&times;</span>';
      }
      html += '</button>';
    });

    // Add "Save Current" button
    html += '<button class="app-preset-btn app-preset-btn--save" data-preset-id="__save_new">+ Save Current</button>';

    $presetContainer.innerHTML = html;
  }

  function _updateTopDomains(tickets) {
    var domains = TicketSearch.extractDomains(tickets).slice(0, 10);

    if (domains.length === 0) {
      $topDomainsSection.style.display = 'none';
      $domainChartSection.style.display = 'none';
      return;
    }

    $topDomainsSection.style.display = 'block';
    $domainChartSection.style.display = 'block';

    var html = '';
    domains.forEach(function (d) {
      html += '<div class="app-domain-item" data-domain="' + _escapeHtml(d.domain) + '">' +
        '<span class="app-domain-item__name">' + _escapeHtml(d.domain) + '</span>' +
        '<span class="app-domain-item__count">' + d.count + '</span>' +
      '</div>';
    });
    $topDomainsList.innerHTML = html;
  }

  function _updateUrgencySummary() {
    var counts = { critical: 0, urgent: 0, warning: 0, safe: 0 };
    allTickets.forEach(function (t) {
      if (t._urgency) counts[t._urgency.level]++;
    });

    var hasUrgent = counts.critical > 0 || counts.urgent > 0 || counts.warning > 0;
    $urgencySummary.style.display = allTickets.length > 0 ? 'grid' : 'none';
    $urgencyCritical.textContent = counts.critical;
    $urgencyUrgent.textContent = counts.urgent;
    $urgencyWarning.textContent = counts.warning;
    $urgencySafe.textContent = counts.safe;
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
  var UNDO_COUNTDOWN_SECONDS = 10;
  var _undoTimerId = null;
  var _undoIntervalId = null;
  var _undoCountdown = 0;
  var _pendingExecution = null; // { action, ids, ticketObjects }

  function _confirmBulkAction(action) {
    var ids = virtualList.getSelectedIds();
    if (ids.length === 0) return;

    var actionLabel = action === 'recover' ? 'Recover' : 'Delete';
    var requiresDeleteConfirm = action === 'delete' && ids.length > 50;

    $modalTitle.textContent = actionLabel + ' Tickets';
    $modalMessage.textContent = 'Are you sure you want to ' + action + ' ' + ids.length + ' suspended ticket' + (ids.length > 1 ? 's' : '') + '?';
    $modalConfirm.textContent = actionLabel;
    $modalConfirm.className = 'c-btn c-btn--sm' + (action === 'delete' ? ' c-btn--danger' : ' c-btn--primary');

    // Show/hide "type DELETE" input for large deletions
    if (requiresDeleteConfirm) {
      $modalDeleteInput.style.display = 'block';
      $modalDeleteConfirm.value = '';
      $modalConfirm.disabled = true;

      $modalDeleteConfirm.oninput = function () {
        $modalConfirm.disabled = $modalDeleteConfirm.value !== 'DELETE';
      };
    } else {
      $modalDeleteInput.style.display = 'none';
      $modalConfirm.disabled = false;
    }

    _pendingAction = { action: action, ids: ids };

    $modalConfirm.onclick = function () {
      _closeModal();
      if (_pendingAction) {
        _startUndoCountdown(_pendingAction.action, _pendingAction.ids);
        _pendingAction = null;
      }
    };

    $confirmModal.style.display = 'flex';
  }

  function _closeModal() {
    $confirmModal.style.display = 'none';
    $modalDeleteInput.style.display = 'none';
    $modalDeleteConfirm.oninput = null;
    _pendingAction = null;
  }

  function _startUndoCountdown(action, ids) {
    var ticketObjects = allTickets.filter(function (t) {
      return ids.indexOf(t.id) !== -1;
    });

    _pendingExecution = { action: action, ids: ids, ticketObjects: ticketObjects };

    // Optimistic removal from UI
    allTickets = allTickets.filter(function (t) {
      return ids.indexOf(t.id) === -1;
    });
    _applyFilters();
    _updateDashboard();

    // Show undo toast
    _undoCountdown = UNDO_COUNTDOWN_SECONDS;
    _showUndoToast(action, ids.length);

    _undoIntervalId = setInterval(function () {
      _undoCountdown--;
      _updateUndoToast();
      if (_undoCountdown <= 0) {
        _executeConfirmedAction();
      }
    }, 1000);
  }

  function _showUndoToast(action, count) {
    var label = action === 'recover' ? 'Recovering' : 'Deleting';
    $notificationText.innerHTML = label + ' ' + count + ' ticket' + (count > 1 ? 's' : '') + '... <strong>' + _undoCountdown + 's</strong>';
    $notification.className = 'app-notification app-notification--undo';
    $notification.style.display = 'block';

    // Add undo button if not present
    var undoBtn = $notification.querySelector('#undoBtn');
    if (!undoBtn) {
      undoBtn = document.createElement('button');
      undoBtn.id = 'undoBtn';
      undoBtn.className = 'c-btn c-btn--basic c-btn--sm app-undo-btn';
      undoBtn.textContent = 'Undo';
      undoBtn.addEventListener('click', _cancelUndo);
      $notification.appendChild(undoBtn);
    }
  }

  function _updateUndoToast() {
    if (!_pendingExecution) return;
    var label = _pendingExecution.action === 'recover' ? 'Recovering' : 'Deleting';
    var count = _pendingExecution.ids.length;
    $notificationText.innerHTML = label + ' ' + count + ' ticket' + (count > 1 ? 's' : '') + '... <strong>' + _undoCountdown + 's</strong>';
  }

  function _cancelUndo() {
    clearInterval(_undoIntervalId);
    _undoIntervalId = null;

    if (_pendingExecution) {
      // Restore tickets
      allTickets = allTickets.concat(_pendingExecution.ticketObjects);
      TicketSearch.enrichWithUrgency(allTickets);
      _pendingExecution = null;
    }

    _hideUndoToast();
    _applyFilters();
    _updateDashboard();
    _showNotification('Action cancelled.', 'info');
  }

  function _hideUndoToast() {
    $notification.style.display = 'none';
    var undoBtn = $notification.querySelector('#undoBtn');
    if (undoBtn) undoBtn.remove();
  }

  function _executeConfirmedAction() {
    clearInterval(_undoIntervalId);
    _undoIntervalId = null;
    _hideUndoToast();

    if (!_pendingExecution) return;

    var action = _pendingExecution.action;
    var ids = _pendingExecution.ids;
    var ticketObjects = _pendingExecution.ticketObjects;
    _pendingExecution = null;

    _showNotification('Processing ' + ids.length + ' ticket' + (ids.length > 1 ? 's' : '') + '...', 'info');

    var apiCall = action === 'recover'
      ? TicketAPI.recoverTickets(client, ids)
      : TicketAPI.deleteTickets(client, ids);

    apiCall.then(function (result) {
      var successCount = result.recovered || result.deleted || 0;
      var failedCount = result.failed ? result.failed.length : 0;

      var successIds = ids.filter(function (id) {
        return !result.failed || result.failed.indexOf(id) === -1;
      });

      // Re-add failed tickets back to allTickets
      if (failedCount > 0) {
        var failedTickets = ticketObjects.filter(function (t) {
          return result.failed && result.failed.indexOf(t.id) !== -1;
        });
        allTickets = allTickets.concat(failedTickets);
        TicketSearch.enrichWithUrgency(allTickets);
      }

      return Promise.all([
        TicketCache.removeTickets(successIds),
        action === 'recover'
          ? ActionLogger.logRecovery(ticketObjects.filter(function (t) { return successIds.indexOf(t.id) !== -1; }))
          : ActionLogger.logDeletion(ticketObjects.filter(function (t) { return successIds.indexOf(t.id) !== -1; }))
      ]).then(function () {
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
      // Restore tickets on error
      allTickets = allTickets.concat(ticketObjects);
      TicketSearch.enrichWithUrgency(allTickets);
      _applyFilters();
      _updateDashboard();
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

    // Render rules when switching to rules tab
    if (tabName === 'rules') {
      _renderRulesTab();
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

  function _renderRecommendationBadge(ticket) {
    if (!ticket._recommendation) return '';
    var action = ticket._recommendation.action;
    var label = action === 'recover' ? 'Auto: Recover' : 'Auto: Delete';
    return '<span class="recommend-badge recommend-badge--' + action + '">' + label + '</span>';
  }

  function _renderUrgencyBadge(ticket) {
    if (!ticket._urgency) return '';
    var u = ticket._urgency;
    var label = u.daysRemaining < 1 ? 'Expiring!' : Math.floor(u.daysRemaining) + 'd left';
    return '<span class="urgency-badge urgency-badge--' + u.level + '">' + label + '</span>';
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
