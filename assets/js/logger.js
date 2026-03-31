/**
 * Action audit logger – wraps TicketCache log operations
 * and provides CSV export functionality.
 */
var ActionLogger = (function () {
  'use strict';

  /**
   * Log a recovery action.
   * @param {Array} tickets - Array of ticket objects that were recovered
   */
  function logRecovery(tickets) {
    return TicketCache.logAction('recovered', tickets);
  }

  /**
   * Log a deletion action.
   * @param {Array} tickets - Array of ticket objects that were deleted
   */
  function logDeletion(tickets) {
    return TicketCache.logAction('deleted', tickets);
  }

  /**
   * Get recent logs (last 30 days by default).
   * @param {number} days - Number of days to look back
   * @returns {Promise<Array>}
   */
  function getRecentLogs(days) {
    return TicketCache.getRecentLogs(days);
  }

  /**
   * Export logs as a CSV string.
   * @param {Array} logs - Array of log objects
   * @returns {string} CSV content
   */
  function exportAsCSV(logs) {
    var headers = ['Timestamp', 'Action', 'Ticket ID', 'Subject', 'Author', 'Cause'];
    var rows = [headers.join(',')];

    logs.forEach(function (log) {
      rows.push([
        '"' + (log.timestamp || '') + '"',
        '"' + (log.action || '') + '"',
        log.ticketId || '',
        '"' + _escapeCSV(log.subject || '') + '"',
        '"' + _escapeCSV(log.author || '') + '"',
        '"' + _escapeCSV(log.cause || '') + '"'
      ].join(','));
    });

    return rows.join('\n');
  }

  /**
   * Trigger a CSV download in the browser.
   * @param {Array} logs - Array of log objects
   * @param {string} filename - Download filename
   */
  function downloadCSV(logs, filename) {
    filename = filename || 'suspended-tickets-log.csv';
    var csv = exportAsCSV(logs);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Export current ticket list as CSV.
   * @param {Array} tickets - Array of ticket objects
   * @param {string} filename
   */
  function exportTicketsAsCSV(tickets, filename) {
    filename = filename || 'suspended-tickets.csv';
    var headers = ['ID', 'Subject', 'Author', 'Cause', 'Created At', 'Recipient'];
    var rows = [headers.join(',')];

    tickets.forEach(function (t) {
      rows.push([
        t.id || '',
        '"' + _escapeCSV(t.subject || '') + '"',
        '"' + _escapeCSV(t.author ? (t.author.email || t.author.name || '') : '') + '"',
        '"' + _escapeCSV(t.cause || '') + '"',
        '"' + (t.created_at || '') + '"',
        '"' + _escapeCSV(t.recipient || '') + '"'
      ].join(','));
    });

    var csv = rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /** Escape double quotes for CSV */
  function _escapeCSV(str) {
    return String(str).replace(/"/g, '""');
  }

  /**
   * Clean up expired logs (older than 30 days).
   */
  function cleanup() {
    return TicketCache.clearExpiredLogs();
  }

  return {
    logRecovery: logRecovery,
    logDeletion: logDeletion,
    getRecentLogs: getRecentLogs,
    exportAsCSV: exportAsCSV,
    downloadCSV: downloadCSV,
    exportTicketsAsCSV: exportTicketsAsCSV,
    cleanup: cleanup
  };
})();
