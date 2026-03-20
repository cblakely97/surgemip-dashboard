// SurgeMIP Dashboard — Progress chart
(function () {
  'use strict';

  var DONE_COLOR = '#2ca02c';
  var TODO_COLOR = 'rgba(200,200,200,0.15)';

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
    var traces = [];
    var annotations = [];

    // Reverse so first scenario appears at top
    var ordered = scenarios.slice().reverse();

    // Each year is one stacked bar segment of width 1
    ordered.forEach(function (sc) {
      var total = sc.end_year - sc.start_year + 1;
      var completedSet = {};
      sc.completed_years.forEach(function (y) { completedSet[y] = true; });
      var isCFS = sc.id === 'cfs-reanalysis';

      for (var j = 0; j < total; j++) {
        var year = sc.start_year + j;
        var done = !!completedSet[year];
        var label = isCFS ? String(year) : String(j + 1);

        traces.push({
          y: [sc.name],
          x: [1],
          type: 'bar',
          orientation: 'h',
          marker: { color: done ? DONE_COLOR : TODO_COLOR,
                    line: { color: 'rgba(255,255,255,0.2)', width: 0.5 } },
          hovertext: label + (done ? ' (done)' : ''),
          hoverinfo: 'text',
          showlegend: false,
        });
      }

      // Summary annotation at right edge
      var done_count = sc.completed_years.length;
      var pct = total > 0 ? (done_count / total * 100).toFixed(0) : '0';
      annotations.push({
        x: total + 0.5,
        y: sc.name,
        text: done_count + '/' + total + ' (' + pct + '%)',
        showarrow: false,
        font: { size: 12, color: '#666' },
        xanchor: 'left',
      });
    });

    // Compute max bar width for x-axis range
    var maxYears = 0;
    ordered.forEach(function (sc) {
      var t = sc.end_year - sc.start_year + 1;
      if (t > maxYears) maxYears = t;
    });

    // Build tick labels for x-axis: show every 5th year for CFS,
    // but we use per-scenario segments so x-axis is just year count.
    // Use annotations on bars instead.
    var tickvals = [];
    var ticktext = [];
    for (var k = 0; k < maxYears; k += 5) {
      tickvals.push(k + 0.5);
      ticktext.push(String(k + 1));
    }

    var layout = {
      barmode: 'stack',
      height: 60 + ordered.length * 80,
      margin: { l: 220, r: 80, t: 10, b: 40 },
      xaxis: {
        title: 'Simulation years',
        range: [0, maxYears + 3],
        tickvals: tickvals,
        ticktext: ticktext,
        gridcolor: 'rgba(0,0,0,0.06)',
      },
      yaxis: {
        automargin: true,
      },
      annotations: annotations,
      plot_bgcolor: 'rgba(0,0,0,0)',
      paper_bgcolor: 'rgba(0,0,0,0)',
    };

    Plotly.newPlot('progress-chart', traces, layout, {
      displayModeBar: false,
      responsive: true,
    });

    document.getElementById('last-updated').textContent =
      'Last updated: ' + data.last_updated;
  }
})();
