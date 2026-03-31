/**
 * Zendesk API wrapper for suspended tickets.
 * All calls go through the ZAF client.request() method.
 */
var TicketAPI = (function () {
  'use strict';

  var PAGE_SIZE = 100; // Max per Zendesk API
  var MAX_BATCH_SIZE = 100; // Max IDs per bulk operation
  var RATE_LIMIT_RETRY_MS = [1000, 2000, 4000]; // Backoff for 429s

  /**
   * Fetch a single page of suspended tickets.
   * @param {Object} client - ZAF client instance
   * @param {number} page - Page number (1-based)
   * @returns {Promise<{tickets: Array, nextPage: string|null, count: number}>}
   */
  function fetchPage(client, page) {
    var url = '/api/v2/suspended_tickets.json?page=' + page + '&per_page=' + PAGE_SIZE + '&sort_by=created_at&sort_order=desc';

    return _requestWithRetry(client, {
      url: url,
      type: 'GET',
      dataType: 'json'
    }).then(function (response) {
      return {
        tickets: response.suspended_tickets || [],
        nextPage: response.next_page || null,
        count: response.count || 0
      };
    });
  }

  /**
   * Fetch all suspended tickets with pagination.
   * Calls onPage callback after each page for progress tracking and caching.
   * Supports resuming from a specific page.
   *
   * @param {Object} client - ZAF client
   * @param {Object} options
   * @param {number} options.startPage - Page to resume from (default 1)
   * @param {Function} options.onPage - Called with (tickets, pageNum, totalEstimate)
   * @param {Function} options.onComplete - Called when all pages fetched
   * @param {Function} options.onError - Called on unrecoverable error
   * @returns {Object} Controller with abort() method
   */
  function fetchAllSuspendedTickets(client, options) {
    options = options || {};
    var currentPage = options.startPage || 1;
    var aborted = false;
    var totalEstimate = 0;

    function fetchNext() {
      if (aborted) return;

      fetchPage(client, currentPage)
        .then(function (result) {
          if (aborted) return;

          if (currentPage === 1 || totalEstimate === 0) {
            totalEstimate = result.count;
          }

          if (options.onPage) {
            options.onPage(result.tickets, currentPage, totalEstimate);
          }

          if (result.nextPage && result.tickets.length > 0) {
            currentPage++;
            // Small delay to avoid hammering the API
            setTimeout(fetchNext, 200);
          } else {
            if (options.onComplete) {
              options.onComplete(totalEstimate);
            }
          }
        })
        .catch(function (err) {
          if (aborted) return;
          if (options.onError) {
            options.onError(err, currentPage);
          }
        });
    }

    fetchNext();

    return {
      abort: function () {
        aborted = true;
      }
    };
  }

  /**
   * Recover (unsuspend) tickets by IDs.
   * Automatically batches if more than MAX_BATCH_SIZE.
   * @param {Object} client - ZAF client
   * @param {Array<number>} ids - Ticket IDs to recover
   * @param {Function} onBatch - Optional callback(completedCount, totalCount)
   * @returns {Promise<{recovered: number, failed: Array}>}
   */
  function recoverTickets(client, ids, onBatch) {
    return _batchOperation(client, ids, 'recover', onBatch);
  }

  /**
   * Delete suspended tickets by IDs.
   * @param {Object} client - ZAF client
   * @param {Array<number>} ids - Ticket IDs to delete
   * @param {Function} onBatch - Optional callback(completedCount, totalCount)
   * @returns {Promise<{deleted: number, failed: Array}>}
   */
  function deleteTickets(client, ids, onBatch) {
    return _batchOperation(client, ids, 'delete', onBatch);
  }

  /**
   * Internal: batch operation (recover or delete).
   */
  function _batchOperation(client, ids, action, onBatch) {
    var batches = [];
    for (var i = 0; i < ids.length; i += MAX_BATCH_SIZE) {
      batches.push(ids.slice(i, i + MAX_BATCH_SIZE));
    }

    var completed = 0;
    var failed = [];
    var total = ids.length;

    return batches.reduce(function (chain, batch) {
      return chain.then(function () {
        var url, method;

        if (action === 'recover') {
          url = '/api/v2/suspended_tickets/recover_many.json?ids=' + batch.join(',');
          method = 'PUT';
        } else {
          url = '/api/v2/suspended_tickets/destroy_many.json?ids=' + batch.join(',');
          method = 'DELETE';
        }

        return _requestWithRetry(client, {
          url: url,
          type: method,
          dataType: 'json'
        }).then(function () {
          completed += batch.length;
          if (onBatch) onBatch(completed, total);
        }).catch(function (err) {
          failed = failed.concat(batch);
          completed += batch.length;
          if (onBatch) onBatch(completed, total);
          console.error('Batch ' + action + ' failed for IDs:', batch, err);
        });
      });
    }, Promise.resolve()).then(function () {
      var result = { failed: failed };
      result[action === 'recover' ? 'recovered' : 'deleted'] = total - failed.length;
      return result;
    });
  }

  /**
   * Internal: Make a request with retry on 429 (rate limit).
   */
  function _requestWithRetry(client, options, retryIndex) {
    retryIndex = retryIndex || 0;

    return client.request(options).catch(function (err) {
      // Check for rate limit (429)
      var status = err && err.status;
      if (status === 429 && retryIndex < RATE_LIMIT_RETRY_MS.length) {
        var delay = RATE_LIMIT_RETRY_MS[retryIndex];
        return new Promise(function (resolve) {
          setTimeout(resolve, delay);
        }).then(function () {
          return _requestWithRetry(client, options, retryIndex + 1);
        });
      }
      throw err;
    });
  }

  // ── Public API ───────────────────────────────────────────

  return {
    fetchPage: fetchPage,
    fetchAllSuspendedTickets: fetchAllSuspendedTickets,
    recoverTickets: recoverTickets,
    deleteTickets: deleteTickets
  };
})();
