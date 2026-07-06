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
  var currentData = null; // full-res data for the currently selected station
  var currentMeans = null; // per-series means for demeaning
  var demeanEnabled = false;
  var TARGET_POINTS = 5000;

  function nanMean(arr) {
    var sum = 0, cnt = 0;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] !== null && arr[i] !== undefined) { sum += arr[i]; cnt++; }
    }
    return cnt > 0 ? sum / cnt : 0;
  }

  // -----------------------------------------------------------------------
  // LTTB downsampling (Largest-Triangle-Three-Buckets)
  // Returns indices into the original array.
  // -----------------------------------------------------------------------

  function lttbIndices(y, target) {
    var n = y.length;
    if (target >= n || target < 3) {
      var all = new Array(n);
      for (var k = 0; k < n; k++) all[k] = k;
      return all;
    }
    var indices = [0];
    var bucketSize = (n - 2) / (target - 2);
    var prevIndex = 0;
    for (var i = 1; i < target - 1; i++) {
      var rangeStart = Math.floor((i - 1) * bucketSize) + 1;
      var rangeEnd = Math.min(Math.floor(i * bucketSize) + 1, n);
      var nextStart = Math.min(Math.floor((i + 0) * bucketSize) + 1, n - 1);
      var nextEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n);
      // Average of next bucket
      var avgX = 0, avgY = 0, cnt = 0;
      for (var j = nextStart; j < nextEnd; j++) {
        if (y[j] !== null) { avgX += j; avgY += y[j]; cnt++; }
      }
      if (cnt > 0) { avgX /= cnt; avgY /= cnt; }
      // Find point in current bucket with max triangle area
      var maxArea = -1, bestIdx = rangeStart;
      var pX = prevIndex, pY = y[prevIndex] || 0;
      for (var j = rangeStart; j < rangeEnd; j++) {
        if (y[j] === null) continue;
        var area = Math.abs((pX - avgX) * (y[j] - pY) - (pX - j) * (avgY - pY));
        if (area > maxArea) { maxArea = area; bestIdx = j; }
      }
      indices.push(bestIdx);
      prevIndex = bestIdx;
    }
    indices.push(n - 1);
    return indices;
  }

  function pickByIndices(arr, indices) {
    var out = new Array(indices.length);
    for (var i = 0; i < indices.length; i++) out[i] = arr[indices[i]];
    return out;
  }

  function applyOffset(arr, offset) {
    var out = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      out[i] = arr[i] !== null && arr[i] !== undefined ? arr[i] + offset : null;
    }
    return out;
  }

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

    var controls = document.getElementById('plot-controls');
    if (controls) controls.style.display = '';
  }

  // -----------------------------------------------------------------------
  // Time series loading and plotting
  // -----------------------------------------------------------------------

  // Parse a .bin timeseries file:
  //   [JSON header, null-terminated]
  //   [Int16 × n: adcirc]   (mm, -32768 = NaN)
  //   [Int16 × n: gesla]
  //   [Int16 × n: adcirc_nontidal]  (only if header.has_nontidal)
  //   [Int16 × n: gesla_nontidal]   (only if header.has_nontidal)
  function parseBin(buf) {
    var bytes = new Uint8Array(buf);
    // Find null terminator of JSON header
    var end = 0;
    while (end < bytes.length && bytes[end] !== 0) end++;
    var header = JSON.parse(new TextDecoder().decode(bytes.subarray(0, end)));
    var n = header.n;
    var offset = end + 1;

    function readInt16(off) {
      // buf.slice ensures the new ArrayBuffer is 2-byte aligned regardless
      // of where the header ended.
      var raw = new Int16Array(buf.slice(off, off + n * 2));
      var out = new Array(n);
      for (var i = 0; i < n; i++) {
        out[i] = raw[i] === -32768 ? null : raw[i] * 0.001;
      }
      return out;
    }

    header.adcirc = readInt16(offset);          offset += n * 2;
    header.gesla  = readInt16(offset);          offset += n * 2;
    if (header.has_nontidal) {
      header.adcirc_nontidal = readInt16(offset); offset += n * 2;
      header.gesla_nontidal  = readInt16(offset);
    }
    return header;
  }

  function loadTimeseries(stationId) {
    var panel = document.getElementById('timeseries-panel');
    var placeholder = panel.querySelector('.placeholder');
    var plotDiv = document.getElementById('timeseries-plot');

    if (placeholder) placeholder.style.display = 'none';
    plotDiv.innerHTML = '<p style="color:#6c757d;padding:1rem">Loading...</p>';

    fetch('data/timeseries/' + stationId + '.bin')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) { renderTimeseries(parseBin(buf), plotDiv); })
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

  function buildTracesForRange(data, startIdx, endIdx, target) {
    var n = endIdx - startIdx;
    var startMs = new Date(data.t0).getTime();
    var stepMs = data.dt_hours * 3600000;
    var hasNontidal = data.gesla_nontidal && data.adcirc_nontidal;

    // Pick the primary series for LTTB (prefer ADCIRC — always populated)
    var primary = data.adcirc.slice(startIdx, endIdx);
    var idx;
    if (n > target) {
      idx = lttbIndices(primary, target);
    } else {
      idx = new Array(n);
      for (var k = 0; k < n; k++) idx[k] = k;
    }

    // Build time axis only for selected indices
    var times = new Array(idx.length);
    for (var i = 0; i < idx.length; i++) {
      times[i] = new Date(startMs + (startIdx + idx[i]) * stepMs)
        .toISOString().slice(0, 19);
    }

    var geslaSlice = pickByIndices(data.gesla.slice(startIdx, endIdx), idx);
    var adcircSlice = pickByIndices(primary, idx);

    // Apply demeaning if enabled (subtract each series' full-record mean)
    if (demeanEnabled && currentMeans) {
      geslaSlice = applyOffset(geslaSlice, -currentMeans.gesla);
      adcircSlice = applyOffset(adcircSlice, -currentMeans.adcirc);
    }

    var traces = [
      {
        x: times, y: geslaSlice, type: 'scattergl', mode: 'lines',
        name: 'GESLA', line: { color: '#000000', width: 1 },
        connectgaps: false, xaxis: 'x', yaxis: 'y',
      },
      {
        x: times, y: adcircSlice, type: 'scattergl', mode: 'lines',
        name: 'ADCIRC', line: { color: '#1f77b4', width: 1 },
        connectgaps: false, xaxis: 'x', yaxis: 'y',
      },
    ];

    if (hasNontidal) {
      var gnt = pickByIndices(data.gesla_nontidal.slice(startIdx, endIdx), idx);
      var ant = pickByIndices(data.adcirc_nontidal.slice(startIdx, endIdx), idx);
      if (demeanEnabled && currentMeans) {
        gnt = applyOffset(gnt, -currentMeans.gesla_nontidal);
        ant = applyOffset(ant, -currentMeans.adcirc_nontidal);
      }
      traces.push({
        x: times, y: gnt, type: 'scattergl', mode: 'lines',
        name: 'GESLA nontidal', line: { color: '#000000', width: 1 },
        connectgaps: false, xaxis: 'x2', yaxis: 'y2',
      });
      traces.push({
        x: times, y: ant, type: 'scattergl', mode: 'lines',
        name: 'ADCIRC nontidal', line: { color: '#1f77b4', width: 1 },
        connectgaps: false, xaxis: 'x2', yaxis: 'y2',
      });
    } else {
      var residValues = new Array(idx.length);
      var hasResid = false;
      for (var i = 0; i < idx.length; i++) {
        if (adcircSlice[i] !== null && geslaSlice[i] !== null) {
          residValues[i] = adcircSlice[i] - geslaSlice[i];
          hasResid = true;
        } else {
          residValues[i] = null;
        }
      }
      if (hasResid) {
        traces.push({
          x: times, y: residValues, type: 'scattergl', mode: 'lines',
          name: 'Residual', line: { color: '#d62728', width: 1 },
          connectgaps: false, xaxis: 'x2', yaxis: 'y2',
        });
      }
    }

    return { traces: traces, hasNontidal: hasNontidal, hasResid: !hasNontidal };
  }

  function replot() {
    if (!currentData) return;
    var plotDiv = document.getElementById('timeseries-plot');
    renderTimeseries(currentData, plotDiv);
  }

  function renderTimeseries(data, plotDiv) {
    // Guard: if ADCIRC is nearly all NaN the node was permanently dry —
    // show a message rather than a blank plot.
    var nValid = 0;
    var nTotal = data.adcirc ? data.adcirc.length : 0;
    for (var i = 0; i < nTotal; i++) {
      if (data.adcirc[i] !== null) nValid++;
    }
    if (nValid < 100) {
      plotDiv.innerHTML =
        '<p style="color:#6c757d;padding:1rem">No model data at this location ' +
        '(node is outside the wet domain for most of the simulation). ' +
        '[debug: n=' + nTotal + ' valid=' + nValid + ' has_nontidal=' + data.has_nontidal + ']</p>';
      return;
    }

    plotDiv.innerHTML = '';
    currentData = data;

    currentMeans = {
      gesla: nanMean(data.gesla),
      adcirc: nanMean(data.adcirc),
      gesla_nontidal: data.gesla_nontidal ? nanMean(data.gesla_nontidal) : 0,
      adcirc_nontidal: data.adcirc_nontidal ? nanMean(data.adcirc_nontidal) : 0,
    };

    var result = buildTracesForRange(data, 0, data.n, TARGET_POINTS);

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
        title: demeanEnabled ? 'Sea level anomaly (m)' : 'Sea level (m)',
        domain: [0.35, 1],
      },
      xaxis2: {
        anchor: 'y2',
        title: 'Date',
      },
      yaxis2: {
        title: result.hasNontidal ? 'Nontidal sea level (m)' : 'Residual (m)',
        domain: [0, 0.28],
      },
      title: { text: title, font: { size: 14 } },
      annotations: annotations,
      legend: { orientation: 'h', y: 1.06 },
      margin: { l: 60, r: 20, t: 50, b: 40 },
      template: 'plotly_white',
      shapes: result.hasResid ? [{
        type: 'line',
        xref: 'paper', yref: 'y2',
        x0: 0, x1: 1, y0: 0, y1: 0,
        line: { color: 'gray', dash: 'dash', width: 1 },
      }] : [],
    };

    Plotly.newPlot(plotDiv, result.traces, layout, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    });

    // Refine resolution on zoom
    plotDiv.on('plotly_relayout', function (evt) {
      if (!currentData) return;
      var xMin = evt['xaxis.range[0]'] || evt['xaxis2.range[0]'];
      var xMax = evt['xaxis.range[1]'] || evt['xaxis2.range[1]'];
      if (!xMin || !xMax) return;

      var startMs = new Date(currentData.t0).getTime();
      var stepMs = currentData.dt_hours * 3600000;
      var i0 = Math.max(0, Math.floor((new Date(xMin).getTime() - startMs) / stepMs));
      var i1 = Math.min(currentData.n, Math.ceil((new Date(xMax).getTime() - startMs) / stepMs));
      if (i1 <= i0) return;

      var refined = buildTracesForRange(currentData, i0, i1, TARGET_POINTS);
      Plotly.react(plotDiv, refined.traces, plotDiv.layout, {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      });
    });
  }

  // -----------------------------------------------------------------------
  // Demean toggle
  // -----------------------------------------------------------------------

  var demeanBox = document.getElementById('demean-toggle');
  if (demeanBox) {
    demeanBox.addEventListener('change', function () {
      demeanEnabled = demeanBox.checked;
      replot();
    });
  }

})();
