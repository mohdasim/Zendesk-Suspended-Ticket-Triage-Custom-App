/**
 * IndexedDB caching layer for suspended tickets.
 * Database: SuspendedTicketsTriageDB
 * Stores: tickets, actionLog, meta
 */
var TicketCache = (function () {
  'use strict';

  var DB_NAME = 'SuspendedTicketsTriageDB';
  var DB_VERSION = 1;
  var STORES = {
    TICKETS: 'tickets',
    ACTION_LOG: 'actionLog',
    META: 'meta'
  };
  var LOG_TTL_DAYS = 30;

  var _db = null;

  /**
   * Open (or create) the IndexedDB database.
   * Returns a Promise that resolves with the db instance.
   */
  function openDB() {
    if (_db) return Promise.resolve(_db);

    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        var db = event.target.result;

        // Tickets store – keyed by ticket id
        if (!db.objectStoreNames.contains(STORES.TICKETS)) {
          var ticketStore = db.createObjectStore(STORES.TICKETS, { keyPath: 'id' });
          ticketStore.createIndex('cause_id', 'cause_id', { unique: false });
          ticketStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // Action log store – auto-increment key
        if (!db.objectStoreNames.contains(STORES.ACTION_LOG)) {
          var logStore = db.createObjectStore(STORES.ACTION_LOG, {
            keyPath: 'logId',
            autoIncrement: true
          });
          logStore.createIndex('action', 'action', { unique: false });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
          logStore.createIndex('ticketId', 'ticketId', { unique: false });
        }

        // Meta store – key-value pairs
        if (!db.objectStoreNames.contains(STORES.META)) {
          db.createObjectStore(STORES.META, { keyPath: 'key' });
        }
      };

      request.onsuccess = function (event) {
        _db = event.target.result;
        resolve(_db);
      };

      request.onerror = function (event) {
        reject(new Error('IndexedDB open failed: ' + event.target.error));
      };
    });
  }

  /** Helper: run a transaction and return a promise */
  function _tx(storeName, mode, callback) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, mode);
        var store = tx.objectStore(storeName);
        var result = callback(store, tx);

        tx.oncomplete = function () {
          resolve(result._value !== undefined ? result._value : undefined);
        };
        tx.onerror = function (event) {
          reject(new Error('Transaction failed: ' + event.target.error));
        };
      });
    });
  }

  // ── Tickets ──────────────────────────────────────────────

  /** Get all cached tickets */
  function getAllTickets() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES.TICKETS, 'readonly');
        var store = tx.objectStore(STORES.TICKETS);
        var request = store.getAll();

        request.onsuccess = function () {
          resolve(request.result || []);
        };
        request.onerror = function () {
          reject(new Error('Failed to get tickets'));
        };
      });
    });
  }

  /** Get ticket count without loading all data */
  function getTicketCount() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES.TICKETS, 'readonly');
        var store = tx.objectStore(STORES.TICKETS);
        var request = store.count();

        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function () {
          reject(new Error('Failed to count tickets'));
        };
      });
    });
  }

  /** Upsert (insert or update) an array of tickets */
  function upsertTickets(tickets) {
    if (!tickets || tickets.length === 0) return Promise.resolve();

    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES.TICKETS, 'readwrite');
        var store = tx.objectStore(STORES.TICKETS);

        tickets.forEach(function (ticket) {
          store.put(ticket);
        });

        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function (event) {
          reject(new Error('Upsert failed: ' + event.target.error));
        };
      });
    });
  }

  /** Remove tickets by an array of IDs */
  function removeTickets(ids) {
    if (!ids || ids.length === 0) return Promise.resolve();

    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES.TICKETS, 'readwrite');
        var store = tx.objectStore(STORES.TICKETS);

        ids.forEach(function (id) {
          store.delete(id);
        });

        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function (event) {
          reject(new Error('Remove failed: ' + event.target.error));
        };
      });
    });
  }

  /** Clear all cached tickets (used during full refresh) */
  function clearTickets() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES.TICKETS, 'readwrite');
        var store = tx.objectStore(STORES.TICKETS);
        var request = store.clear();

        request.onsuccess = function () {
          resolve();
        };
        request.onerror = function () {
          reject(new Error('Failed to clear tickets'));
        };
      });
    });
  }

  // ── Meta ─────────────────────────────────────────────────

  /** Get a meta value by key */
  function getMeta(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES.META, 'readonly');
        var store = tx.objectStore(STORES.META);
        var request = store.get(key);

        request.onsuccess = function () {
          resolve(request.result ? request.result.value : null);
        };
        request.onerror = function () {
          reject(new Error('Failed to get meta: ' + key));
        };
      });
    });
  }

  /** Set a meta value */
  function setMeta(key, value) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES.META, 'readwrite');
        var store = tx.objectStore(STORES.META);
        store.put({ key: key, value: value });

        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(new Error('Failed to set meta: ' + key));
        };
      });
    });
  }

  /** Delete a meta key */
  function deleteMeta(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES.META, 'readwrite');
        var store = tx.objectStore(STORES.META);
        store.delete(key);

        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(new Error('Failed to delete meta: ' + key));
        };
      });
    });
  }

  // ── Action Log ───────────────────────────────────────────

  /** Log a recover/delete action */
  function logAction(action, tickets) {
    if (!tickets || tickets.length === 0) return Promise.resolve();

    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES.ACTION_LOG, 'readwrite');
        var store = tx.objectStore(STORES.ACTION_LOG);
        var now = new Date().toISOString();

        tickets.forEach(function (ticket) {
          store.put({
            action: action,
            ticketId: ticket.id,
            subject: ticket.subject || '(no subject)',
            author: ticket.author ? ticket.author.email || ticket.author.name : 'unknown',
            cause: ticket.cause || 'unknown',
            timestamp: now
          });
        });

        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function (event) {
          reject(new Error('Log action failed: ' + event.target.error));
        };
      });
    });
  }

  /** Get recent action logs (within N days, default 30) */
  function getRecentLogs(days) {
    days = days || LOG_TTL_DAYS;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var cutoffISO = cutoff.toISOString();

    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES.ACTION_LOG, 'readonly');
        var store = tx.objectStore(STORES.ACTION_LOG);
        var request = store.getAll();

        request.onsuccess = function () {
          var logs = (request.result || []).filter(function (log) {
            return log.timestamp >= cutoffISO;
          });
          // Sort newest first
          logs.sort(function (a, b) {
            return b.timestamp.localeCompare(a.timestamp);
          });
          resolve(logs);
        };
        request.onerror = function () {
          reject(new Error('Failed to get logs'));
        };
      });
    });
  }

  /** Purge logs older than 30 days */
  function clearExpiredLogs() {
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - LOG_TTL_DAYS);
    var cutoffISO = cutoff.toISOString();

    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORES.ACTION_LOG, 'readwrite');
        var store = tx.objectStore(STORES.ACTION_LOG);
        var request = store.openCursor();

        request.onsuccess = function (event) {
          var cursor = event.target.result;
          if (cursor) {
            if (cursor.value.timestamp < cutoffISO) {
              cursor.delete();
            }
            cursor.continue();
          }
        };

        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(new Error('Failed to clear expired logs'));
        };
      });
    });
  }

  // ── Public API ───────────────────────────────────────────

  return {
    openDB: openDB,
    getAllTickets: getAllTickets,
    getTicketCount: getTicketCount,
    upsertTickets: upsertTickets,
    removeTickets: removeTickets,
    clearTickets: clearTickets,
    getMeta: getMeta,
    setMeta: setMeta,
    deleteMeta: deleteMeta,
    logAction: logAction,
    getRecentLogs: getRecentLogs,
    clearExpiredLogs: clearExpiredLogs
  };
})();
