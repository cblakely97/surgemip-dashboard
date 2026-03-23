// SurgeMIP Dashboard — Progress chart
(function () {
  'use strict';

  var DONE_COLOR = '#2ca02c';
  var RUNNING_COLOR = '#ff7f0e';
  var QUEUED_COLOR = '#1f77b4';
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
      var runningYear = sc.running_year || null;
      var runningPct = sc.running_pct != null ? sc.running_pct : null;
      var isQueued = sc.queued || false;

      for (var j = 0; j < total; j++) {
        var year = sc.start_year + j;
        var done = !!completedSet[year];
        var isRunning = year === runningYear;
        var label = isCFS ? String(year) : String(j + 1);

        var color, hoverSuffix;
        if (done) {
          color = DONE_COLOR;
          hoverSuffix = ' (done)';
        } else if (isRunning) {
          color = RUNNING_COLOR;
          hoverSuffix = runningPct != null
            ? ' (running — ' + runningPct + '%)'
            : ' (running)';
        } else {
          color = TODO_COLOR;
          hoverSuffix = '';
        }

        traces.push({
          y: [sc.name],
          x: [1],
          type: 'bar',
          orientation: 'h',
          marker: { color: color,
                    line: { color: 'rgba(255,255,255,0.2)', width: 0.5 } },
          hovertext: label + hoverSuffix,
          hoverinfo: 'text',
          showlegend: false,
        });
      }

      // Summary annotation at right edge
      var done_count = sc.completed_years.length;
      var pct = total > 0 ? (done_count / total * 100).toFixed(0) : '0';
      var summaryText = done_count + '/' + total + ' (' + pct + '%)';

      // Add status badge
      if (sc.status === 'running') {
        var badge = runningYear ? ' · running ' + runningYear : ' · running';
        if (runningPct != null) badge += ' (' + runningPct + '%)';
        summaryText += '<br><span style="color:' + RUNNING_COLOR + '">' + badge + '</span>';
      } else if (sc.status === 'queued') {
        summaryText += '<br><span style="color:' + QUEUED_COLOR + '"> · queued</span>';
      }
      if (isQueued && sc.status === 'running') {
        summaryText += '<br><span style="color:' + QUEUED_COLOR + '"> · next queued</span>';
      }

      annotations.push({
        x: total + 0.5,
        y: sc.name,
        text: summaryText,
        showarrow: false,
        font: { size: 12, color: '#666' },
        xanchor: 'left',
        align: 'left',
      });
    });

    // Compute max bar width for x-axis range
    var maxYears = 0;
    ordered.forEach(function (sc) {
      var t = sc.end_year - sc.start_year + 1;
      if (t > maxYears) maxYears = t;
    });

    // Build tick labels for x-axis
    var tickvals = [];
    var ticktext = [];
    for (var k = 0; k < maxYears; k += 5) {
      tickvals.push(k + 0.5);
      ticktext.push(String(k + 1));
    }

    var layout = {
      barmode: 'stack',
      height: 60 + ordered.length * 80,
      margin: { l: 220, r: 160, t: 10, b: 40 },
      xaxis: {
        title: 'Simulation years',
        range: [0, maxYears + 8],
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

    // Render legend
    var legendEl = document.getElementById('progress-legend');
    if (legendEl) {
      legendEl.innerHTML =
        '<span style="display:inline-block;width:12px;height:12px;background:' + DONE_COLOR + ';margin-right:4px;vertical-align:middle"></span> Completed ' +
        '<span style="display:inline-block;width:12px;height:12px;background:' + RUNNING_COLOR + ';margin-right:4px;margin-left:16px;vertical-align:middle"></span> Running ' +
        '<span style="display:inline-block;width:12px;height:12px;background:' + QUEUED_COLOR + ';margin-right:4px;margin-left:16px;vertical-align:middle"></span> Queued ' +
        '<span style="display:inline-block;width:12px;height:12px;background:rgba(200,200,200,0.4);margin-right:4px;margin-left:16px;vertical-align:middle;border:1px solid #ccc"></span> Remaining';
    }
  }
})();
