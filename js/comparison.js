// SurgeMIP Dashboard — Station comparison (Leaflet map + Plotly time series)
(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // Map setup
  // -----------------------------------------------------------------------

  var map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(map);

  var selectedMarker = null;
  var markerLayer = L.layerGroup().addTo(map);
  var allStations = [];   // populated after fetch
  var markerById = {};    // station_id → marker

  // -----------------------------------------------------------------------
  // Color by correlation
  // -----------------------------------------------------------------------

  function corrColor(corr) {
    if (corr === null || corr === undefined || isNaN(corr)) return '#999999';
    if (corr >= 0.9) return '#2ca02c';
    if (corr >= 0.7) return '#ff7f0e';
    return '#d62728';
  }

  function corrLabel(corr) {
    if (corr === null || corr === undefined || isNaN(corr)) return 'N/A';
    return corr.toFixed(3);
  }

  // -----------------------------------------------------------------------
  // Load stations and populate map
  // -----------------------------------------------------------------------

  fetch('data/stations.json')
    .then(function (r) { return r.json(); })
    .then(function (stations) {
      stations.forEach(function (stn) {
        var corr = stn.metrics ? stn.metrics.correlation : null;
        var color = corrColor(corr);

        var marker = L.circleMarker([stn.latitude, stn.longitude], {
          radius: 5,
          color: color,
          fillColor: color,
          fillOpacity: 0.8,
          weight: 1,
        });

        // Build popup content
        var popupHtml = '<b>' + stn.site_name + '</b>';
        if (stn.country) popupHtml += ' (' + stn.country + ')';
        popupHtml += '<br>';
        if (stn.metrics) {
          popupHtml +=
            '<div class="metric-row"><span>Correlation:</span> <span>' +
            corrLabel(corr) + '</span></div>' +
            '<div class="metric-row"><span>RMSE:</span> <span>' +
            stn.metrics.rmse_m.toFixed(3) + ' m</span></div>' +
            '<div class="metric-row"><span>Bias:</span> <span>' +
            stn.metrics.bias_m.toFixed(3) + ' m</span></div>';
          if (stn.metrics.n_hours) {
            popupHtml +=
              '<div class="metric-row"><span>Overlap:</span> <span>' +
              stn.metrics.n_hours.toLocaleString() + ' hrs</span></div>';
          }
        }

        marker.bindPopup(popupHtml);

        marker.on('click', function () {
          selectStation(stn.station_id, marker);
        });

        marker.stationId = stn.station_id;
        markerById[stn.station_id] = marker;
        markerLayer.addLayer(marker);
      });

      allStations = stations;
      addSearchControl();
      addLegend();
    })
    .catch(function (err) {
      console.error('Failed to load stations.json:', err);
    });

  // -----------------------------------------------------------------------
  // Search control
  // -----------------------------------------------------------------------

  function addSearchControl() {
    var search = L.control({ position: 'topright' });
    search.onAdd = function () {
      var wrap = L.DomUtil.create('div', 'station-search');
      wrap.innerHTML =
        '<input type="text" id="station-search-input" placeholder="Search stations...">' +
        '<ul id="station-search-results"></ul>';
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      return wrap;
    };
    search.addTo(map);

    var input = document.getElementById('station-search-input');
    var resultsList = document.getElementById('station-search-results');

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      resultsList.innerHTML = '';
      if (q.length < 2) return;

      var matches = allStations.filter(function (s) {
        return s.site_name.toLowerCase().indexOf(q) !== -1 ||
          (s.country && s.country.toLowerCase().indexOf(q) !== -1) ||
          s.station_id.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 12);

      matches.forEach(function (s) {
        var li = document.createElement('li');
        li.textContent = s.site_name + (s.country ? ' (' + s.country + ')' : '');
        li.addEventListener('click', function () {
          resultsList.innerHTML = '';
          input.value = s.site_name;
          var marker = markerById[s.station_id];
          if (marker) {
            map.flyTo([s.latitude, s.longitude], 8, { duration: 0.8 });
            marker.openPopup();
            selectStation(s.station_id, marker);
          }
        });
        resultsList.appendChild(li);
      });
    });

    // Close results on outside click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.station-search')) {
        resultsList.innerHTML = '';
      }
    });
  }

  // -----------------------------------------------------------------------
  // Legend
  // -----------------------------------------------------------------------

  function addLegend() {
    var legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
      var div = L.DomUtil.create('div', 'legend');
      div.innerHTML =
        '<b>Correlation</b>' +
        '<br><i style="background:#2ca02c"></i> &ge; 0.9' +
        '<br><i style="background:#ff7f0e"></i> 0.7 &ndash; 0.9' +
        '<br><i style="background:#d62728"></i> &lt; 0.7' +
        '<br><i style="background:#999999"></i> N/A';
      return div;
    };
    legend.addTo(map);
  }

  // -----------------------------------------------------------------------
  // Station selection
  // -----------------------------------------------------------------------

  function selectStation(stationId, marker) {
    // Reset previous selection
    if (selectedMarker) {
      selectedMarker.setStyle({ weight: 1, radius: 5 });
    }

    // Highlight selected
    marker.setStyle({ weight: 3, radius: 8 });
    selectedMarker = marker;

    loadTimeseries(stationId);
  }

  // -----------------------------------------------------------------------
  // Time series loading and plotting
  // -----------------------------------------------------------------------

  function loadTimeseries(stationId) {
    var panel = document.getElementById('timeseries-panel');
    var placeholder = panel.querySelector('.placeholder');
    var plotDiv = document.getElementById('timeseries-plot');

    if (placeholder) placeholder.style.display = 'none';
    plotDiv.innerHTML = '<p style="color:#6c757d;padding:1rem">Loading...</p>';

    fetch('data/timeseries/' + stationId + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { renderTimeseries(data, plotDiv); })
      .catch(function (err) {
        plotDiv.innerHTML =
          '<p style="color:#d62728;padding:1rem">Failed to load time series: ' +
          err.message + '</p>';
      });
  }

  // -----------------------------------------------------------------------
  // Reconstruct timestamps from compact t0/dt_hours/n format
  // -----------------------------------------------------------------------

  function buildTimeAxis(t0, dtHours, n) {
    var times = new Array(n);
    var startMs = new Date(t0).getTime();
    var stepMs = dtHours * 3600000;
    for (var i = 0; i < n; i++) {
      times[i] = new Date(startMs + i * stepMs).toISOString().slice(0, 19);
    }
    return times;
  }

  function renderTimeseries(data, plotDiv) {
    plotDiv.innerHTML = '';

    // Reconstruct shared time axis from compact format
    var times = buildTimeAxis(data.t0, data.dt_hours, data.n);

    // Upper subplot: GESLA + ADCIRC (nulls create gaps in the lines)
    var geslaTrace = {
      x: times,
      y: data.gesla,
      type: 'scattergl',
      mode: 'lines',
      name: 'GESLA',
      line: { color: '#000000', width: 1 },
      connectgaps: false,
      xaxis: 'x',
      yaxis: 'y',
    };

    var adcircTrace = {
      x: times,
      y: data.adcirc,
      type: 'scattergl',
      mode: 'lines',
      name: 'ADCIRC',
      line: { color: '#1f77b4', width: 1 },
      connectgaps: false,
      xaxis: 'x',
      yaxis: 'y',
    };

    // Lower subplot: nontidal residuals if available, else raw residual
    var traces = [geslaTrace, adcircTrace];
    var hasNontidal = data.gesla_nontidal && data.adcirc_nontidal;
    var lowerTraces = [];

    if (hasNontidal) {
      lowerTraces.push({
        x: times,
        y: data.gesla_nontidal,
        type: 'scattergl',
        mode: 'lines',
        name: 'GESLA nontidal',
        line: { color: '#000000', width: 1 },
        connectgaps: false,
        xaxis: 'x2',
        yaxis: 'y2',
      });
      lowerTraces.push({
        x: times,
        y: data.adcirc_nontidal,
        type: 'scattergl',
        mode: 'lines',
        name: 'ADCIRC nontidal',
        line: { color: '#1f77b4', width: 1 },
        connectgaps: false,
        xaxis: 'x2',
        yaxis: 'y2',
      });
    } else {
      var residTrace = computeResidualTrace(times, data.adcirc, data.gesla);
      if (residTrace) lowerTraces.push(residTrace);
    }

    traces = traces.concat(lowerTraces);

    // Metrics annotation
    var annotations = [];
    if (data.metrics) {
      var m = data.metrics;
      var metricsText =
        'Bias: ' + m.bias_m.toFixed(3) + ' m | ' +
        'RMSE: ' + m.rmse_m.toFixed(3) + ' m | ' +
        'r: ' + m.correlation.toFixed(3);
      if (m.n_hours) metricsText += ' | N: ' + m.n_hours.toLocaleString() + ' hrs';

      annotations.push({
        text: metricsText,
        xref: 'paper', yref: 'y domain',
        x: 0.01, y: 0.98,
        showarrow: false,
        font: { size: 12 },
        bgcolor: 'rgba(255,255,255,0.85)',
        borderpad: 4,
      });
    }

    var title = data.site_name;
    if (data.country) title += ' (' + data.country + ')';

    var layout = {
      grid: { rows: 2, columns: 1, subplots: [['xy'], ['xy2']] },
      xaxis: { anchor: 'y', matches: 'x2' },
      yaxis: {
        title: 'Sea level (m)',
        domain: [0.35, 1],
      },
      xaxis2: {
        anchor: 'y2',
        title: 'Date',
      },
      yaxis2: {
        title: hasNontidal ? 'Nontidal sea level (m)' : 'Residual (m)',
        domain: [0, 0.28],
      },
      title: { text: title, font: { size: 14 } },
      annotations: annotations,
      legend: { orientation: 'h', y: 1.06 },
      margin: { l: 60, r: 20, t: 50, b: 40 },
      template: 'plotly_white',
      shapes: (!hasNontidal && lowerTraces.length) ? [{
        type: 'line',
        xref: 'paper', yref: 'y2',
        x0: 0, x1: 1, y0: 0, y1: 0,
        line: { color: 'gray', dash: 'dash', width: 1 },
      }] : [],
    };

    Plotly.newPlot(plotDiv, traces, layout, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    });
  }

  function computeResidualTrace(times, adcirc, gesla) {
    // Arrays are already aligned — compute element-wise residual
    if (!adcirc || !gesla || !times.length) return null;

    var residValues = new Array(times.length);
    var hasData = false;
    for (var i = 0; i < times.length; i++) {
      if (adcirc[i] !== null && gesla[i] !== null) {
        residValues[i] = adcirc[i] - gesla[i];
        hasData = true;
      } else {
        residValues[i] = null;
      }
    }

    if (!hasData) return null;

    return {
      x: times,
      y: residValues,
      type: 'scattergl',
      mode: 'lines',
      name: 'Residual',
      line: { color: '#d62728', width: 1 },
      connectgaps: false,
      xaxis: 'x2',
      yaxis: 'y2',
    };
  }
})();
