/**
 * Smart Auto-Triage Rules engine.
 * Manages rule CRUD and ticket evaluation.
 */
var TriageRules = (function () {
  'use strict';

  /**
   * Generate a simple unique ID.
   * @returns {string}
   */
  function generateId() {
    return 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  }

  /**
   * Get all rules from IndexedDB.
   * @returns {Promise<Array>}
   */
  function getAllRules() {
    return TicketCache.getAllRules();
  }

  /**
   * Save (insert or update) a rule.
   * @param {Object} rule
   * @returns {Promise}
   */
  function saveRule(rule) {
    if (!rule.id) rule.id = generateId();
    if (!rule.createdAt) rule.createdAt = new Date().toISOString();
    return TicketCache.putRule(rule);
  }

  /**
   * Delete a rule by ID.
   * @param {string} id
   * @returns {Promise}
   */
  function deleteRule(id) {
    return TicketCache.deleteRule(id);
  }

  /**
   * Toggle a rule's enabled state.
   * @param {Object} rule
   * @returns {Promise}
   */
  function toggleRule(rule) {
    rule.enabled = !rule.enabled;
    return TicketCache.putRule(rule);
  }

  /**
   * Evaluate a single ticket against a set of rules.
   * Returns the first matching rule's recommendation or null.
   * @param {Object} ticket
   * @param {Array} rules - Enabled rules only
   * @returns {Object|null} { ruleId, ruleName, action }
   */
  function evaluateTicket(ticket, rules) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!rule.enabled) continue;
      if (!rule.conditions || rule.conditions.length === 0) continue;

      var allMatch = true;
      for (var j = 0; j < rule.conditions.length; j++) {
        if (!_checkCondition(ticket, rule.conditions[j])) {
          allMatch = false;
          break;
        }
      }

      if (allMatch) {
        return { ruleId: rule.id, ruleName: rule.name, action: rule.action };
      }
    }
    return null;
  }

  /**
   * Evaluate all tickets against rules. Sets ticket._recommendation.
   * @param {Array} tickets
   * @param {Array} rules
   * @returns {{ recover: Array<number>, delete: Array<number> }}
   */
  function evaluateAll(tickets, rules) {
    var enabledRules = rules.filter(function (r) { return r.enabled; });
    var results = { recover: [], delete: [] };

    tickets.forEach(function (ticket) {
      var rec = evaluateTicket(ticket, enabledRules);
      ticket._recommendation = rec;
      if (rec) {
        results[rec.action].push(ticket.id);
      }
    });

    return results;
  }

  /**
   * Check a single condition against a ticket.
   * @param {Object} ticket
   * @param {Object} condition - { field, operator, value }
   * @returns {boolean}
   */
  function _checkCondition(ticket, condition) {
    var field = condition.field;
    var op = condition.operator;
    var value = (condition.value || '').toLowerCase();
    var ticketValue;

    switch (field) {
      case 'domain':
        ticketValue = TicketSearch.extractDomain(
          ticket.author ? ticket.author.email : ''
        );
        break;
      case 'cause':
        ticketValue = (ticket.cause || '').toLowerCase();
        break;
      case 'subject':
        ticketValue = (ticket.subject || '').toLowerCase();
        break;
      case 'age_days':
        var created = new Date(ticket.created_at);
        var now = new Date();
        ticketValue = Math.floor((now.getTime() - created.getTime()) / 86400000);
        return _compareNumeric(ticketValue, op, Number(condition.value));
      default:
        return false;
    }

    // String operations
    switch (op) {
      case 'contains':
        return ticketValue.indexOf(value) !== -1;
      case 'equals':
        return ticketValue === value;
      case 'matches':
        try {
          return new RegExp(condition.value, 'i').test(ticketValue);
        } catch (e) {
          return false;
        }
      default:
        return false;
    }
  }

  /**
   * Compare a numeric value with an operator.
   */
  function _compareNumeric(actual, op, expected) {
    switch (op) {
      case '>': return actual > expected;
      case '<': return actual < expected;
      case '=': return actual === expected;
      case '>=': return actual >= expected;
      case '<=': return actual <= expected;
      default: return false;
    }
  }

  return {
    generateId: generateId,
    getAllRules: getAllRules,
    saveRule: saveRule,
    deleteRule: deleteRule,
    toggleRule: toggleRule,
    evaluateTicket: evaluateTicket,
    evaluateAll: evaluateAll
  };
})();
