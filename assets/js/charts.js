/**
 * Chart rendering for suspended ticket analytics.
 * Uses Chart.js (loaded via CDN in iframe.html).
 */
var TicketCharts = (function () {
  'use strict';

  var _trendChart = null;
  var _causeChart = null;
  var _domainChart = null;

  // Color palette for cause categories
  var CAUSE_COLORS = {
    spam: { bg: 'rgba(204, 51, 64, 0.8)', border: '#CC3340' },
    automated: { bg: 'rgba(48, 115, 209, 0.8)', border: '#3073D1' },
    formatting: { bg: 'rgba(237, 150, 28, 0.8)', border: '#ED961C' },
    default: { bg: 'rgba(135, 147, 158, 0.8)', border: '#87939E' }
  };

  var PALETTE = [
    '#CC3340', '#3073D1', '#ED961C', '#038153', '#6A27B8',
    '#D93F4C', '#1F73B7', '#C72A1C', '#5293C7', '#87939E'
  ];

  /**
   * Get color for a cause string.
   */
  function _getCauseColor(cause) {
    var lower = (cause || '').toLowerCase();
    if (lower.indexOf('spam') !== -1) return CAUSE_COLORS.spam;
    if (lower.indexOf('automat') !== -1 || lower.indexOf('auto') !== -1) return CAUSE_COLORS.automated;
    if (lower.indexOf('format') !== -1) return CAUSE_COLORS.formatting;
    return CAUSE_COLORS.default;
  }

  /**
   * Render the 30-day suspension trend chart.
   * @param {string} canvasId - Canvas element ID
   * @param {Array} tickets - All ticket objects
   */
  function renderTrendChart(canvasId, tickets) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    // Build daily counts for last 30 days
    var days = 30;
    var dailyCounts = {};
    var now = new Date();

    for (var d = days - 1; d >= 0; d--) {
      var date = new Date(now);
      date.setDate(date.getDate() - d);
      var key = date.toISOString().split('T')[0];
      dailyCounts[key] = 0;
    }

    tickets.forEach(function (ticket) {
      if (!ticket.created_at) return;
      var dateKey = ticket.created_at.split('T')[0];
      if (dailyCounts.hasOwnProperty(dateKey)) {
        dailyCounts[dateKey]++;
      }
    });

    var labels = Object.keys(dailyCounts);
    var data = labels.map(function (key) { return dailyCounts[key]; });

    // Format labels as short dates (e.g., "Mar 15")
    var shortLabels = labels.map(function (dateStr) {
      var parts = dateStr.split('-');
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10);
    });

    if (_trendChart) {
      _trendChart.destroy();
    }

    _trendChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: shortLabels,
        datasets: [{
          label: 'Suspended Tickets',
          data: data,
          backgroundColor: 'rgba(48, 115, 209, 0.6)',
          borderColor: '#3073D1',
          borderWidth: 1,
          borderRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) {
                return labels[items[0].dataIndex];
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxRotation: 45,
              font: { size: 9 },
              maxTicksLimit: 10
            }
          },
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1,
              font: { size: 10 }
            }
          }
        }
      }
    });
  }

  /**
   * Render the cause breakdown doughnut chart.
   * @param {string} canvasId - Canvas element ID
   * @param {Array} tickets - All ticket objects
   */
  function renderCauseChart(canvasId, tickets) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    var causes = TicketSearch.extractCauses(tickets);
    var labels = causes.map(function (c) { return c.name; });
    var data = causes.map(function (c) { return c.count; });
    var bgColors = causes.map(function (c, i) {
      return PALETTE[i % PALETTE.length];
    });

    if (_causeChart) {
      _causeChart.destroy();
    }

    _causeChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: bgColors,
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              padding: 8,
              font: { size: 11 }
            }
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                var total = context.dataset.data.reduce(function (s, v) { return s + v; }, 0);
                var pct = total > 0 ? Math.round(context.raw / total * 100) : 0;
                return context.label + ': ' + context.raw + ' (' + pct + '%)';
              }
            }
          }
        },
        cutout: '55%'
      }
    });
  }

  /**
   * Render horizontal bar chart of top 10 sender domains.
   * @param {string} canvasId - Canvas element ID
   * @param {Array} tickets - All ticket objects
   */
  function renderDomainChart(canvasId, tickets) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    var domains = TicketSearch.extractDomains(tickets).slice(0, 10);
    var labels = domains.map(function (d) { return d.domain; });
    var data = domains.map(function (d) { return d.count; });
    var bgColors = domains.map(function (d, i) {
      return PALETTE[i % PALETTE.length];
    });

    if (_domainChart) {
      _domainChart.destroy();
    }

    _domainChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Tickets',
          data: data,
          backgroundColor: bgColors,
          borderWidth: 0,
          borderRadius: 2
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (context) {
                return context.raw + ' ticket' + (context.raw !== 1 ? 's' : '');
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 10 } },
            grid: { display: false }
          },
          y: {
            ticks: { font: { size: 10 } },
            grid: { display: false }
          }
        }
      }
    });
  }

  /**
   * Destroy all chart instances (cleanup).
   */
  function destroy() {
    if (_trendChart) { _trendChart.destroy(); _trendChart = null; }
    if (_causeChart) { _causeChart.destroy(); _causeChart = null; }
    if (_domainChart) { _domainChart.destroy(); _domainChart = null; }
  }

  return {
    renderTrendChart: renderTrendChart,
    renderCauseChart: renderCauseChart,
    renderDomainChart: renderDomainChart,
    destroy: destroy
  };
})();
