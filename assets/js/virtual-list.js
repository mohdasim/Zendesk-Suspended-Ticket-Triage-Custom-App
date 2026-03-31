/**
 * Virtual scrolling list for rendering large numbers of tickets
 * without freezing the UI. Only renders visible items + buffer.
 */
var VirtualList = (function () {
  'use strict';

  var ITEM_HEIGHT = 72; // Estimated height per ticket row in px
  var BUFFER_COUNT = 10; // Extra items rendered above/below viewport

  /**
   * Create a virtual list instance.
   * @param {Object} config
   * @param {HTMLElement} config.container - The scroll container element
   * @param {HTMLElement} config.spacer - Element to set total height
   * @param {HTMLElement} config.itemsContainer - Element to hold rendered items
   * @param {Function} config.renderItem - Function(item, index) => HTML string
   * @param {Function} config.onSelectionChange - Called when selection changes
   */
  function create(config) {
    var items = [];
    var selectedIds = new Set();
    var scrollRAF = null;
    var lastScrollTop = -1;

    var container = config.container;
    var spacer = config.spacer;
    var itemsContainer = config.itemsContainer;
    var renderItem = config.renderItem;
    var onSelectionChange = config.onSelectionChange;

    // Scroll listener with requestAnimationFrame throttle
    container.addEventListener('scroll', function () {
      if (scrollRAF) return;
      scrollRAF = requestAnimationFrame(function () {
        scrollRAF = null;
        _renderVisible();
      });
    });

    // Delegate click events on items
    itemsContainer.addEventListener('click', function (e) {
      var checkbox = e.target.closest('.vl-checkbox');
      if (checkbox) {
        var id = Number(checkbox.dataset.id);
        if (selectedIds.has(id)) {
          selectedIds.delete(id);
        } else {
          selectedIds.add(id);
        }
        _updateCheckbox(checkbox, selectedIds.has(id));
        if (onSelectionChange) onSelectionChange(getSelectedIds());
        return;
      }

      var previewBtn = e.target.closest('.vl-preview-btn');
      if (previewBtn) {
        var ticketId = Number(previewBtn.dataset.id);
        var ticket = items.find(function (t) { return t.id === ticketId; });
        if (ticket && config.onPreview) {
          config.onPreview(ticket);
        }
        return;
      }
    });

    function _updateCheckbox(checkbox, checked) {
      var input = checkbox.querySelector('input');
      if (input) input.checked = checked;
    }

    /**
     * Set the full data array and re-render.
     */
    function setItems(newItems) {
      items = newItems || [];
      selectedIds.clear();
      spacer.style.height = (items.length * ITEM_HEIGHT) + 'px';
      _renderVisible();
      if (onSelectionChange) onSelectionChange([]);
    }

    /**
     * Render only the items visible in the viewport.
     */
    function _renderVisible() {
      var scrollTop = container.scrollTop;
      if (scrollTop === lastScrollTop && itemsContainer.children.length > 0) return;
      lastScrollTop = scrollTop;

      var containerHeight = container.clientHeight;
      var startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_COUNT);
      var endIndex = Math.min(items.length, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + BUFFER_COUNT);

      var html = '';
      for (var i = startIndex; i < endIndex; i++) {
        var item = items[i];
        var isSelected = selectedIds.has(item.id);
        var top = i * ITEM_HEIGHT;
        html += '<div class="vl-item" style="position:absolute;top:' + top + 'px;left:0;right:0;height:' + ITEM_HEIGHT + 'px;">';
        html += renderItem(item, i, isSelected);
        html += '</div>';
      }

      itemsContainer.innerHTML = html;
    }

    /**
     * Select or deselect all currently loaded items.
     */
    function selectAll(select) {
      if (select) {
        items.forEach(function (item) {
          selectedIds.add(item.id);
        });
      } else {
        selectedIds.clear();
      }
      _renderVisible();
      if (onSelectionChange) onSelectionChange(getSelectedIds());
    }

    /**
     * Get array of selected IDs.
     */
    function getSelectedIds() {
      return Array.from(selectedIds);
    }

    /**
     * Get selected ticket objects.
     */
    function getSelectedItems() {
      return items.filter(function (item) {
        return selectedIds.has(item.id);
      });
    }

    /**
     * Get total item count.
     */
    function getItemCount() {
      return items.length;
    }

    /**
     * Scroll to top.
     */
    function scrollToTop() {
      container.scrollTop = 0;
      _renderVisible();
    }

    /**
     * Refresh rendering (e.g., after container resize).
     */
    function refresh() {
      lastScrollTop = -1;
      _renderVisible();
    }

    /**
     * Navigate items with keyboard.
     * @param {string} direction - 'up' or 'down'
     */
    function navigate(direction) {
      var scrollDelta = direction === 'down' ? ITEM_HEIGHT : -ITEM_HEIGHT;
      container.scrollTop = Math.max(0, container.scrollTop + scrollDelta);
    }

    return {
      setItems: setItems,
      selectAll: selectAll,
      getSelectedIds: getSelectedIds,
      getSelectedItems: getSelectedItems,
      getItemCount: getItemCount,
      scrollToTop: scrollToTop,
      refresh: refresh,
      navigate: navigate
    };
  }

  return {
    create: create,
    ITEM_HEIGHT: ITEM_HEIGHT
  };
})();
