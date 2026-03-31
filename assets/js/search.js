/**
 * Client-side search and filter engine for suspended tickets.
 */
var TicketSearch = (function () {
  'use strict';

  /**
   * Filter tickets based on text query and filter criteria.
   * @param {Array} tickets - Full ticket array
   * @param {Object} criteria
   * @param {string} criteria.query - Free text search
   * @param {string} criteria.causeId - Filter by cause_id (empty = all)
   * @param {string} criteria.sort - Sort order: 'newest', 'oldest', 'subject'
   * @returns {Array} Filtered and sorted tickets
   */
  function filterTickets(tickets, criteria) {
    criteria = criteria || {};
    var query = (criteria.query || '').toLowerCase().trim();
    var causeId = criteria.causeId || '';
    var sort = criteria.sort || 'newest';

    var result = tickets;

    // Text search across subject, author, content, cause
    if (query) {
      var terms = query.split(/\s+/);
      result = result.filter(function (ticket) {
        var searchable = _getSearchableText(ticket);
        return terms.every(function (term) {
          return searchable.indexOf(term) !== -1;
        });
      });
    }

    // Cause filter
    if (causeId) {
      var causeIdNum = Number(causeId);
      result = result.filter(function (ticket) {
        return ticket.cause_id === causeIdNum;
      });
    }

    // Sort
    result = _sortTickets(result, sort);

    return result;
  }

  /**
   * Build a searchable text blob from a ticket.
   */
  function _getSearchableText(ticket) {
    var parts = [
      ticket.subject || '',
      ticket.cause || '',
      ticket.content || '',
      ticket.recipient || ''
    ];

    if (ticket.author) {
      parts.push(ticket.author.email || '');
      parts.push(ticket.author.name || '');
    }

    return parts.join(' ').toLowerCase();
  }

  /**
   * Sort tickets by the given criteria.
   */
  function _sortTickets(tickets, sort) {
    var sorted = tickets.slice(); // Don't mutate original

    switch (sort) {
      case 'oldest':
        sorted.sort(function (a, b) {
          return (a.created_at || '').localeCompare(b.created_at || '');
        });
        break;
      case 'subject':
        sorted.sort(function (a, b) {
          return (a.subject || '').localeCompare(b.subject || '');
        });
        break;
      case 'newest':
      default:
        sorted.sort(function (a, b) {
          return (b.created_at || '').localeCompare(a.created_at || '');
        });
        break;
    }

    return sorted;
  }

  /**
   * Extract unique causes from a ticket array.
   * Returns array of {id, name, count}.
   */
  function extractCauses(tickets) {
    var causeMap = {};

    tickets.forEach(function (ticket) {
      var id = ticket.cause_id || 0;
      var name = ticket.cause || 'Unknown';

      if (!causeMap[id]) {
        causeMap[id] = { id: id, name: name, count: 0 };
      }
      causeMap[id].count++;
    });

    var causes = Object.keys(causeMap).map(function (key) {
      return causeMap[key];
    });

    // Sort by count descending
    causes.sort(function (a, b) {
      return b.count - a.count;
    });

    return causes;
  }

  /**
   * Find repeat offenders — authors with multiple suspended tickets.
   * Returns array of {email, name, count, tickets}.
   */
  function findRepeatOffenders(tickets, minCount) {
    minCount = minCount || 3;
    var authorMap = {};

    tickets.forEach(function (ticket) {
      if (!ticket.author) return;
      var key = ticket.author.email || ticket.author.name || 'unknown';

      if (!authorMap[key]) {
        authorMap[key] = {
          email: ticket.author.email || '',
          name: ticket.author.name || key,
          count: 0,
          tickets: []
        };
      }
      authorMap[key].count++;
      authorMap[key].tickets.push(ticket.id);
    });

    var offenders = Object.keys(authorMap)
      .map(function (key) { return authorMap[key]; })
      .filter(function (a) { return a.count >= minCount; });

    offenders.sort(function (a, b) { return b.count - a.count; });

    return offenders;
  }

  /**
   * Create a debounced function.
   * @param {Function} fn
   * @param {number} delay - Milliseconds
   * @returns {Function}
   */
  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var args = arguments;
      var context = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay);
    };
  }

  return {
    filterTickets: filterTickets,
    extractCauses: extractCauses,
    findRepeatOffenders: findRepeatOffenders,
    debounce: debounce
  };
})();
