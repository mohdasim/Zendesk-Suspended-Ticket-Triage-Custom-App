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

    // Date range filter
    if (criteria.dateFrom) {
      result = result.filter(function (ticket) {
        return (ticket.created_at || '') >= criteria.dateFrom;
      });
    }
    if (criteria.dateTo) {
      var toEnd = criteria.dateTo + 'T23:59:59.999Z';
      result = result.filter(function (ticket) {
        return (ticket.created_at || '') <= toEnd;
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
      case 'urgency':
        sorted.sort(function (a, b) {
          var aD = a._urgency ? a._urgency.daysRemaining : 14;
          var bD = b._urgency ? b._urgency.daysRemaining : 14;
          return aD - bD;
        });
        break;
      case 'domain':
        sorted.sort(function (a, b) {
          var aD = extractDomain(a.author ? a.author.email : '');
          var bD = extractDomain(b.author ? b.author.email : '');
          return aD.localeCompare(bD);
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
   * Extract domain from an email address.
   * @param {string} email
   * @returns {string} Lowercase domain or 'unknown'
   */
  function extractDomain(email) {
    if (!email || email.indexOf('@') === -1) return 'unknown';
    return email.split('@')[1].toLowerCase();
  }

  /**
   * Group tickets by sender domain.
   * @param {Array} tickets
   * @returns {Array} [{domain, count, tickets}] sorted by count desc
   */
  function extractDomains(tickets) {
    var domainMap = {};

    tickets.forEach(function (ticket) {
      var email = ticket.author ? ticket.author.email : '';
      var domain = extractDomain(email);

      if (!domainMap[domain]) {
        domainMap[domain] = { domain: domain, count: 0, tickets: [] };
      }
      domainMap[domain].count++;
      domainMap[domain].tickets.push(ticket.id);
    });

    var domains = Object.keys(domainMap).map(function (key) {
      return domainMap[key];
    });

    domains.sort(function (a, b) { return b.count - a.count; });
    return domains;
  }

  /**
   * Compute urgency for a single ticket based on 14-day auto-deletion.
   * @param {Object} ticket
   * @returns {{daysRemaining: number, level: string}}
   */
  function computeUrgency(ticket) {
    var EXPIRY_DAYS = 14;
    var created = new Date(ticket.created_at);
    var now = new Date();
    var ageMs = now.getTime() - created.getTime();
    var ageDays = ageMs / 86400000;
    var daysRemaining = Math.max(0, Math.round((EXPIRY_DAYS - ageDays) * 10) / 10);
    var level;

    if (daysRemaining < 1) {
      level = 'critical';
    } else if (daysRemaining <= 3) {
      level = 'urgent';
    } else if (daysRemaining <= 7) {
      level = 'warning';
    } else {
      level = 'safe';
    }

    return { daysRemaining: daysRemaining, level: level };
  }

  /**
   * Enrich tickets with urgency data (mutates for performance).
   * @param {Array} tickets
   * @returns {Array} Same array with _urgency set on each ticket
   */
  function enrichWithUrgency(tickets) {
    tickets.forEach(function (ticket) {
      if (ticket.created_at) {
        ticket._urgency = computeUrgency(ticket);
      } else {
        ticket._urgency = { daysRemaining: 14, level: 'safe' };
      }
    });
    return tickets;
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
    extractDomain: extractDomain,
    extractDomains: extractDomains,
    findRepeatOffenders: findRepeatOffenders,
    computeUrgency: computeUrgency,
    enrichWithUrgency: enrichWithUrgency,
    debounce: debounce
  };
})();
