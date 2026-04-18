(function () {
  "use strict";

  // ---------- Storage ----------
  var LOCATION_KEY = "garden_location_v1";
  var WALKS_KEY = "garden_walks_v1";

  function getGarden() {
    try { return JSON.parse(localStorage.getItem(LOCATION_KEY)); } catch (e) { return null; }
  }
  function saveGarden(loc) { localStorage.setItem(LOCATION_KEY, JSON.stringify(loc)); }
  function getWalks() {
    try { return JSON.parse(localStorage.getItem(WALKS_KEY)) || []; } catch (e) { return []; }
  }
  function addWalk(w) {
    var walks = getWalks();
    if (walks.some(function (x) { return x.date === w.date; })) return;
    walks.push(w);
    walks.sort(function (a, b) { return a.date.localeCompare(b.date); });
    localStorage.setItem(WALKS_KEY, JSON.stringify(walks));
  }

  function todayKey(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var toRad = function (x) { return (x * Math.PI) / 180; };
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function computeStats(walks) {
    var set = {};
    walks.forEach(function (w) { set[w.date] = true; });
    var now = new Date();
    var today = todayKey(now);

    // current streak
    var cur = 0;
    var cursor = new Date(now);
    if (!set[today]) cursor.setDate(cursor.getDate() - 1);
    while (set[todayKey(cursor)]) { cur++; cursor.setDate(cursor.getDate() - 1); }

    // longest streak
    var sorted = Object.keys(set).sort();
    var longest = 0, run = 0, prev = null;
    sorted.forEach(function (d) {
      var c = new Date(d);
      if (prev) {
        var diff = Math.round((c - prev) / 86400000);
        run = diff === 1 ? run + 1 : 1;
      } else run = 1;
      if (run > longest) longest = run;
      prev = c;
    });

    var ym = today.slice(0, 7);
    var thisMonth = walks.filter(function (w) { return w.date.indexOf(ym) === 0; }).length;

    var consistency = 0;
    if (sorted.length > 0) {
      var first = new Date(sorted[0]);
      var days = Math.max(1, Math.round((now - first) / 86400000) + 1);
      consistency = Math.round((walks.length / days) * 100);
    }

    var last14 = [];
    for (var i = 13; i >= 0; i--) {
      var d = new Date(now); d.setDate(d.getDate() - i);
      last14.push({ date: todayKey(d), done: !!set[todayKey(d)], dayObj: new Date(d) });
    }

    return { current: cur, longest: longest, total: walks.length, month: thisMonth, consistency: consistency, last14: last14 };
  }

  // ---------- UI helpers ----------
  function $(id) { return document.getElementById(id); }
  var toastTimer = null;
  function toast(msg, isError) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add("hidden"); }, 3500);
  }

  // ---------- Setup screen + map ----------
  var setupMap = null;
  var setupMarker = null;
  var pendingCoords = null;

  function initSetupMap() {
    var existing = getGarden();
    pendingCoords = existing ? { lat: existing.lat, lng: existing.lng } : null;
    var center = pendingCoords ? [pendingCoords.lat, pendingCoords.lng] : [20, 0];
    var zoom = pendingCoords ? 18 : 2;

    if (setupMap) { setupMap.remove(); setupMap = null; setupMarker = null; }

    setupMap = L.map("setup-map").setView(center, zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19
    }).addTo(setupMap);

    if (pendingCoords) {
      setupMarker = L.marker([pendingCoords.lat, pendingCoords.lng]).addTo(setupMap);
    }

    setupMap.on("click", function (e) {
      pendingCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (setupMarker) setupMarker.setLatLng(e.latlng);
      else setupMarker = L.marker(e.latlng).addTo(setupMap);
      updateCoordsDisplay();
    });

    // Tolerance + existing values
    var tol = existing ? existing.toleranceMeters : 5;
    $("tolerance").value = tol;
    $("tolerance-value").textContent = tol + " m";

    updateCoordsDisplay();
    setTimeout(function () { setupMap.invalidateSize(); }, 50);
  }

  function updateCoordsDisplay() {
    var el = $("coords-display");
    if (pendingCoords) {
      el.textContent = "📍 " + pendingCoords.lat.toFixed(6) + ", " + pendingCoords.lng.toFixed(6);
    } else {
      el.textContent = "";
    }
  }

  function showSetup(allowCancel) {
    $("setup-screen").classList.remove("hidden");
    $("app-screen").classList.add("hidden");
    $("setup-cancel-btn").classList.toggle("hidden", !allowCancel);
    initSetupMap();
  }

  function showApp() {
    $("setup-screen").classList.add("hidden");
    $("app-screen").classList.remove("hidden");
    if (setupMap) { setupMap.remove(); setupMap = null; setupMarker = null; }
    render();
  }

  // ---------- Setup events ----------
  $("use-current-btn").addEventListener("click", function () {
    if (!navigator.geolocation) { toast("Location not available on this device", true); return; }
    var btn = this; var orig = btn.textContent;
    btn.disabled = true; btn.textContent = "Getting location…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      pendingCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (setupMap) {
        setupMap.setView([pendingCoords.lat, pendingCoords.lng], 18);
        if (setupMarker) setupMarker.setLatLng([pendingCoords.lat, pendingCoords.lng]);
        else setupMarker = L.marker([pendingCoords.lat, pendingCoords.lng]).addTo(setupMap);
      }
      updateCoordsDisplay();
      btn.disabled = false; btn.textContent = orig;
      toast("Location captured 🌿");
    }, function (err) {
      btn.disabled = false; btn.textContent = orig;
      toast("Couldn't get location: " + err.message, true);
    }, { enableHighAccuracy: true, timeout: 15000 });
  });

  $("link-btn").addEventListener("click", function () {
    var v = $("link-input").value;
    var m = v.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
    if (m) {
      pendingCoords = { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
      if (setupMap) {
        setupMap.setView([pendingCoords.lat, pendingCoords.lng], 18);
        if (setupMarker) setupMarker.setLatLng([pendingCoords.lat, pendingCoords.lng]);
        else setupMarker = L.marker([pendingCoords.lat, pendingCoords.lng]).addTo(setupMap);
      }
      updateCoordsDisplay();
      toast("Coordinates set from link");
    } else {
      toast("Couldn't find coordinates in that text", true);
    }
  });

  $("tolerance").addEventListener("input", function () {
    $("tolerance-value").textContent = this.value + " m";
  });

  $("setup-save-btn").addEventListener("click", function () {
    if (!pendingCoords) { toast("Please set a garden location first", true); return; }
    saveGarden({
      lat: pendingCoords.lat,
      lng: pendingCoords.lng,
      toleranceMeters: parseInt($("tolerance").value, 10)
    });
    toast("Garden location saved!");
    showApp();
  });

  $("setup-cancel-btn").addEventListener("click", function () { showApp(); });

  // ---------- App rendering ----------
  var calMonth, calYear;

  function render() {
    var walks = getWalks();
    var stats = computeStats(walks);

    $("stat-current").innerHTML = stats.current + '<span class="suffix">d</span>';
    $("stat-longest").innerHTML = stats.longest + '<span class="suffix">d</span>';
    $("stat-total").textContent = stats.total;
    $("stat-month").textContent = stats.month;
    $("stat-consistency").innerHTML = stats.consistency + '<span class="suffix">%</span>';

    // Last 14
    var l14 = $("last14");
    l14.innerHTML = "";
    var labels = ["S", "M", "T", "W", "T", "F", "S"];
    stats.last14.forEach(function (d, i) {
      var col = document.createElement("div"); col.className = "day";
      var bar = document.createElement("div");
      bar.className = "bar" + (d.done ? " done" : "") + (i === 13 ? " today" : "");
      bar.title = d.dayObj.toDateString() + (d.done ? " — walked" : " — no walk");
      var label = document.createElement("span");
      label.className = "label";
      label.textContent = labels[d.dayObj.getDay()];
      col.appendChild(bar); col.appendChild(label);
      l14.appendChild(col);
    });

    // Today's walk button state
    var walkedToday = walks.some(function (w) { return w.date === todayKey(); });
    var section = $("mark-section");
    if (walkedToday) {
      section.classList.add("done");
      section.innerHTML =
        '<div class="done-icon">✓</div>' +
        '<p style="font-size:18px;font-weight:600;">Walk logged for today!</p>' +
        '<p class="muted small">Wonderful — see you tomorrow 🌿</p>';
    } else {
      section.classList.remove("done");
      section.innerHTML =
        '<p class="muted small mb-2">Ready when you are</p>' +
        '<button id="mark-btn" class="btn btn-primary btn-xl"><span id="mark-btn-text">👣 Mark today\'s walk</span></button>' +
        '<p class="muted small mt-2">We\'ll verify you\'re in the garden via GPS</p>' +
        '<div id="celebration" class="celebration hidden"><span class="leaf l1">🌿</span><span class="leaf l2">🍃</span><span class="leaf l3">🌱</span></div>';
      $("mark-btn").addEventListener("click", markWalk);
    }

    // Calendar
    renderCalendar();
  }

  function renderCalendar() {
    var walks = getWalks();
    var walkMap = {};
    walks.forEach(function (w) { walkMap[w.date] = w; });

    var first = new Date(calYear, calMonth, 1);
    var startWeekday = first.getDay();
    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var todayStr = todayKey();
    var monthName = new Date(calYear, calMonth).toLocaleString(undefined, { month: "long", year: "numeric" });
    $("month-label").textContent = monthName;

    var grid = $("calendar-grid");
    grid.innerHTML = "";
    for (var i = 0; i < startWeekday; i++) {
      var e = document.createElement("div"); e.className = "cal-cell empty"; grid.appendChild(e);
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var key = calYear + "-" + String(calMonth + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      var btn = document.createElement("button");
      var walked = !!walkMap[key];
      btn.className = "cal-cell" + (walked ? " walked" : "") + (key === todayStr ? " today" : "");
      btn.innerHTML = d + (walked ? '<span class="check">✓</span>' : "");
      if (walked) {
        (function (k) {
          btn.addEventListener("click", function () { showDayDetail(k, walkMap[k]); });
        })(key);
      }
      grid.appendChild(btn);
    }
    $("day-detail").classList.add("hidden");
  }

  function showDayDetail(key, rec) {
    var dt = new Date(rec.timestamp);
    var dateStr = new Date(key).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    var timeStr = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    var det = $("day-detail");
    det.innerHTML = "<strong>🌿 Walked on " + dateStr + "</strong>" +
                    '<span class="muted small">Logged at ' + timeStr + " • " + Math.round(rec.distanceFromGarden) + "m from garden</span>";
    det.classList.remove("hidden");
  }

  // ---------- Mark walk ----------
  function markWalk() {
    var garden = getGarden();
    if (!garden) { toast("Please set the garden location first", true); return; }
    if (!navigator.geolocation) { toast("This device doesn't support GPS", true); return; }
    var btn = $("mark-btn");
    btn.disabled = true;
    $("mark-btn-text").textContent = "Checking GPS…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      var d = distanceMeters(pos.coords.latitude, pos.coords.longitude, garden.lat, garden.lng);
      if (d <= garden.toleranceMeters) {
        addWalk({ date: todayKey(), timestamp: Date.now(), distanceFromGarden: d });
        toast("Walk logged! 🌿✨");
        var c = $("celebration");
        if (c) c.classList.remove("hidden");
        setTimeout(render, 1800);
      } else {
        btn.disabled = false;
        $("mark-btn-text").textContent = "👣 Mark today's walk";
        toast("You're " + Math.round(d) + "m away — head into the garden and try again 🌿", true);
      }
    }, function (err) {
      btn.disabled = false;
      $("mark-btn-text").textContent = "👣 Mark today's walk";
      if (err.code === err.PERMISSION_DENIED) toast("Please enable location to log your walk", true);
      else toast("Couldn't get location: " + err.message, true);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  // ---------- Calendar nav, settings, export ----------
  $("prev-month").addEventListener("click", function () {
    if (calMonth === 0) { calMonth = 11; calYear--; } else calMonth--;
    renderCalendar();
  });
  $("next-month").addEventListener("click", function () {
    if (calMonth === 11) { calMonth = 0; calYear++; } else calMonth++;
    renderCalendar();
  });

  $("settings-btn").addEventListener("click", function () { showSetup(true); });

  $("export-btn").addEventListener("click", function () {
    var data = { location: getGarden(), walks: getWalks(), exportedAt: new Date().toISOString() };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "garden-walks-" + todayKey() + ".json"; a.click();
    URL.revokeObjectURL(url);
    toast("Data exported");
  });

  // ---------- Boot ----------
  var now = new Date();
  calMonth = now.getMonth();
  calYear = now.getFullYear();

  if (getGarden()) showApp();
  else showSetup(false);
})();
