// SurgeMIP Dashboard — Progress chart
(function () {
  'use strict';

  var STATUS_COLORS = {
    complete: '#2ca02c',
    running: '#1f77b4',
    pending: '#adb5bd',
  };

  var FALLBACK_DATA = {
    last_updated: 'unavailable (serve via HTTP for live data)',
    scenarios: [
      { id: 'cfs-reanalysis', name: 'CFS/CFSv2 Reanalysis',
        start_year: 1979, end_year: 2024, completed_years: [], status: 'pending' },
      { id: 'hadgem-present', name: 'HadGEM3-GC31-HM Present',
        start_year: 1979, end_year: 2014, completed_years: [], status: 'pending' },
      { id: 'hadgem-future', name: 'HadGEM3-GC31-HM Future',
        start_year: 2015, end_year: 2050, completed_years: [], status: 'pending' },
    ],
  };

  fetch('data/progress.json')
    .then(function (r) { return r.json(); })
    .then(render)
    .catch(function () { render(FALLBACK_DATA); });

  function render(data) {
    var scenarios = data.scenarios;

    // Build horizontal bar chart — one bar per scenario
    var labels = [];
    var fractions = [];
    var colors = [];
    var hoverTexts = [];

    // Reverse so first scenario appears at top
    for (var i = scenarios.length - 1; i >= 0; i--) {
      var sc = scenarios[i];
      var total = sc.end_year - sc.start_year + 1;
      var done = sc.completed_years.length;
      var pct = total > 0 ? done / total : 0;

      labels.push(sc.name);
      fractions.push(pct);
      colors.push(STATUS_COLORS[sc.status] || STATUS_COLORS.pending);

      var yearRange = sc.start_year + '–' + sc.end_year;
      hoverTexts.push(
        sc.name + '<br>' +
        done + ' / ' + total + ' years (' + (pct * 100).toFixed(1) + '%)<br>' +
        yearRange + '<br>Status: ' + sc.status
      );
    }

    // Background bars (full width = 100%)
    var bgTrace = {
      y: labels,
      x: labels.map(function () { return 1; }),
      type: 'bar',
      orientation: 'h',
      marker: { color: 'rgba(0,0,0,0.04)' },
      hoverinfo: 'skip',
      showlegend: false,
    };

    // Progress bars
    var fgTrace = {
      y: labels,
      x: fractions,
      type: 'bar',
      orientation: 'h',
      marker: { color: colors },
      text: fractions.map(function (f) {
        return (f * 100).toFixed(1) + '%';
      }),
      textposition: 'auto',
      textfont: { color: '#fff', size: 13 },
      hovertext: hoverTexts,
      hoverinfo: 'text',
      showlegend: false,
    };

    var layout = {
      barmode: 'overlay',
      height: 40 + scenarios.length * 60,
      margin: { l: 220, r: 30, t: 10, b: 30 },
      xaxis: {
        range: [0, 1],
        tickformat: '.0%',
        dtick: 0.25,
        gridcolor: 'rgba(0,0,0,0.08)',
      },
      yaxis: {
        automargin: true,
      },
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
    };

    Plotly.newPlot('progress-chart', [bgTrace, fgTrace], layout, {
      displayModeBar: false,
      responsive: true,
    });

    document.getElementById('last-updated').textContent =
      'Last updated: ' + data.last_updated;
  }
})();
