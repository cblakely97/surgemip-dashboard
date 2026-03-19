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
        markerLayer.addLayer(marker);
      });

      // Add legend
      addLegend();
    })
    .catch(function (err) {
      console.error('Failed to load stations.json:', err);
    });

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

  function renderTimeseries(data, plotDiv) {
    plotDiv.innerHTML = '';

    // Upper subplot: GESLA + ADCIRC
    var geslaTrace = {
      x: data.gesla.time,
      y: data.gesla.sea_level,
      type: 'scattergl',
      mode: 'lines',
      name: 'GESLA',
      line: { color: '#000000', width: 1 },
      xaxis: 'x',
      yaxis: 'y',
    };

    var adcircTrace = {
      x: data.adcirc.time,
      y: data.adcirc.zeta,
      type: 'scattergl',
      mode: 'lines',
      name: 'ADCIRC',
      line: { color: '#1f77b4', width: 1 },
      xaxis: 'x',
      yaxis: 'y',
    };

    // Lower subplot: residual (compute on aligned hourly data)
    var residTrace = computeResidualTrace(data);

    var traces = [geslaTrace, adcircTrace];
    if (residTrace) traces.push(residTrace);

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
        title: 'Residual (m)',
        domain: [0, 0.28],
      },
      title: { text: title, font: { size: 14 } },
      annotations: annotations,
      legend: { orientation: 'h', y: 1.06 },
      margin: { l: 60, r: 20, t: 50, b: 40 },
      template: 'plotly_white',
      shapes: residTrace ? [{
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

  function computeResidualTrace(data) {
    // Build a simple residual by matching timestamps
    if (!data.adcirc || !data.gesla) return null;
    if (!data.adcirc.time.length || !data.gesla.time.length) return null;

    // Build lookup from GESLA times (truncated to hour) to values
    var geslaMap = {};
    for (var i = 0; i < data.gesla.time.length; i++) {
      var t = data.gesla.time[i].substring(0, 13); // YYYY-MM-DDTHH
      // Average if multiple per hour (take last for simplicity)
      geslaMap[t] = data.gesla.sea_level[i];
    }

    var residTimes = [];
    var residValues = [];

    for (var j = 0; j < data.adcirc.time.length; j++) {
      var ta = data.adcirc.time[j].substring(0, 13);
      if (ta in geslaMap && data.adcirc.zeta[j] !== null) {
        residTimes.push(data.adcirc.time[j]);
        residValues.push(data.adcirc.zeta[j] - geslaMap[ta]);
      }
    }

    if (residTimes.length < 2) return null;

    return {
      x: residTimes,
      y: residValues,
      type: 'scattergl',
      mode: 'lines',
      name: 'Residual',
      line: { color: '#d62728', width: 1 },
      xaxis: 'x2',
      yaxis: 'y2',
    };
  }
})();
