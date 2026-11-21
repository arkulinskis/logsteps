/* ls-plan.js: the floor plan sheet (Pages/Plan, #plan/<token>).
   LS.planSheet(el, scanJson, opts) loads the room's points and draws one landscape sheet on a canvas:
     - walls from a horizontal slice of the points (default 1.0 to 1.9 m above the floor), lower furniture in light grey;
     - straightened: the wall direction is found by trying 0-90 degrees and keeping the turn with the smallest box
       (angle(); turn(deg) nudges it, 90 swaps the sheet's sides);
     - W and D dimension lines, saved measurements, numbered pins + legend, furniture boxes (dashed);
     - a title block: name, room type, date, floor area, scale bar, where the scale comes from, a QR code of the share link.
   Everything is on the one canvas, so Download PNG and Print give the same picture. Lengths follow LS.units (ls-viewer.js)
   and the room's size fix (scan.scale_k). Returns a handle {ready, setCut, turn, angle, wd, png, redraw, dispose};
   window.LS_PLAN = the last handle (tests). */
(function () {
  'use strict';
  var LS = window.LS = window.LS || {};
  var W = 2400, H = 1697, M = 36, TB = 600;          /* sheet size (landscape, 1:sqrt 2), frame margin, title block width */
  var INK = '#2a231e', PAPER = '#f5efe6', GRIDC = 'rgba(42,35,30,0.07)', BRAND = '#c2522b', SAGE = '#4f7f6a', GOLD = '#b8862b', MUTED = '#6e6258';
  var PIN = { brand: BRAND, accent: SAGE, gold: GOLD, ink: INK };
  var qrP = null;

  function loadQR() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (qrP) return qrP;
    qrP = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = '_/theme/qrcode.js?v=1.4.4';
      s.onload = function () { resolve(window.qrcode || null); };
      s.onerror = function () { qrP = null; resolve(null); };   /* no QR: the link is printed as text */
      document.head.appendChild(s);
    });
    return qrP;
  }
  function pct(arr, n, q) {   /* q-th percentile of the first n values (copies) */
    if (!n) return 0;
    var c = Float32Array.from(arr.subarray ? arr.subarray(0, n) : arr.slice(0, n));
    c.sort();
    return c[Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))))];
  }

  LS.planSheet = function (el, scanJson, opts) {
    var scan = typeof scanJson === 'string' ? JSON.parse(scanJson) : scanJson;
    opts = opts || {};
    var k = +scan.scale_k || 1;
    var st = { cut: 1.0, auto: 0, extra: 0, dead: false, qr: null };
    var X, Y, Z, n = 0, floorY = 0, bins = null;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H; canvas.className = 'pl-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Floor plan of ' + (scan.title || 'the room'));
    var load = document.createElement('div');
    load.className = 'pl-load';
    load.innerHTML = '<div class="pl-load-bar"><i></i></div><small>Loading the room…</small>';
    el.appendChild(load);
    var bar = load.querySelector('i'), small = load.querySelector('small');

    var h = {};
    window.LS_PLAN = h;
    h.angle = function () { return Math.round((st.auto + st.extra) * 10) / 10; };
    h.wd = function () { return bins ? [bins.w * k, bins.d * k] : null; };
    h.png = function () { return canvas.toDataURL('image/png'); };
    h.canvas = canvas;
    h.redraw = function () { if (bins) draw(); };
    h.setCut = function (m) { st.cut = Math.max(0.3, Math.min(2.2, +m || 1)); if (n) { bin(); draw(); } };
    h.turn = function (deg) { st.extra = ((st.extra + (+deg || 0)) % 360 + 360) % 360; if (st.extra > 180) st.extra -= 360; if (n) { bin(); draw(); } };
    h.dispose = function () { st.dead = true; if (canvas.parentNode) canvas.remove(); if (load.parentNode) load.remove(); if (window.LS_PLAN === h) window.LS_PLAN = null; };

    var url = scan.model && scan.model.cloud;
    h.ready = (url ? LS.loadModel(url, function (got, total) {
      bar.style.width = total ? Math.round(got / total * 100) + '%' : Math.min(92, 8 + got / 30000) + '%';
    }) : Promise.reject(new Error('This room has no 3D points to draw.'))).then(function (g) {
      if (st.dead) return false;
      small.textContent = 'Drawing the floor plan…';
      prepare(g);
      return Promise.all([loadQR(), document.fonts && document.fonts.ready ? document.fonts.ready.catch(function () {}) : null]);
    }).then(function (res) {
      if (st.dead || res === false) return false;
      st.qr = res[0];
      bin();
      draw();
      load.remove();
      el.appendChild(canvas);
      return true;
    }).catch(function (e) {
      console.warn('plan:', e);
      h.error = (e && e.message) || 'Couldn\'t draw the floor plan.';
      load.innerHTML = '<p class="pl-error">' + UI.esc(h.error) + '</p><small>Try reloading the page.</small>';
      return false;
    });

    /* ------------------------------------------------ the points (at most 400k), the floor, the wall direction */
    function prepare(g) {
      var pos = g.attributes.position.array, total = g.attributes.position.count;
      var step = total > 400000 ? Math.ceil(total / 400000) : 1;
      n = Math.ceil(total / step);
      X = new Float32Array(n); Y = new Float32Array(n); Z = new Float32Array(n);
      for (var i = 0, j = 0; i < total && j < n; i += step, j++) { X[j] = pos[i * 3]; Y[j] = pos[i * 3 + 1]; Z[j] = pos[i * 3 + 2]; }
      var ys = new Float32Array(Math.min(n, 20000)), ys_step = Math.max(1, Math.floor(n / ys.length));
      for (var s = 0; s < ys.length; s++) ys[s] = Y[s * ys_step];
      floorY = pct(ys, ys.length, 0.02);
      st.auto = findAngle();
    }
    function band() { return [floorY + st.cut / k, floorY + (st.cut + 0.9) / k]; }
    function wallSample(max) {
      var b = band(), idx = [];
      for (var i = 0; i < n; i++) if (Y[i] >= b[0] && Y[i] <= b[1]) idx.push(i);
      if (idx.length < 200) { idx = []; for (var j = 0; j < n; j++) idx.push(j); }   /* a slice with no walls: use everything */
      var stride = Math.max(1, Math.floor(idx.length / max)), out = [];
      for (var q = 0; q < idx.length; q += stride) out.push(idx[q]);
      return out;
    }
    function boxArea(idx, deg) {
      var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), m = idx.length, U = new Float32Array(m), V = new Float32Array(m);
      for (var i = 0; i < m; i++) { var x = X[idx[i]], z = Z[idx[i]]; U[i] = x * c + z * s; V[i] = -x * s + z * c; }
      U.sort(); V.sort();
      var lo = Math.floor(m * 0.02), hi = Math.floor(m * 0.98);
      return (U[hi] - U[lo]) * (V[hi] - V[lo]);
    }
    /* the turn (in -45..45 degrees) that gives the wall slice the smallest box: walls then run along the sheet */
    function findAngle() {
      var idx = wallSample(20000), best = 0, bestA = Infinity, d;
      for (d = 0; d < 90; d += 2) { var a = boxArea(idx, d); if (a < bestA) { bestA = a; best = d; } }
      var coarse = best;
      for (d = coarse - 2; d <= coarse + 2; d += 0.25) { var a2 = boxArea(idx, d); if (a2 < bestA) { bestA = a2; best = d; } }
      best = ((best % 90) + 90) % 90;
      return best > 45 ? best - 90 : best;
    }

    /* ------------------------------------------------ grids in sheet coordinates (u along the sheet, v down it) */
    function bin() {
      var a = (st.auto + st.extra) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), b = band();
      var U = new Float32Array(n), V = new Float32Array(n), wu = [], wv = [];
      for (var i = 0; i < n; i++) {
        U[i] = X[i] * c + Z[i] * s; V[i] = -X[i] * s + Z[i] * c;
        if (Y[i] >= b[0] && Y[i] <= b[1]) { wu.push(U[i]); wv.push(V[i]); }
      }
      if (wu.length < 200) { wu = Array.prototype.slice.call(U); wv = Array.prototype.slice.call(V); }
      var u0 = pct(wu, wu.length, 0.01), u1 = pct(wu, wu.length, 0.99), v0 = pct(wv, wv.length, 0.01), v1 = pct(wv, wv.length, 0.99);
      var padU = (u1 - u0) * 0.06 + 0.15 / k, padV = (v1 - v0) * 0.06 + 0.15 / k;
      var eu0 = u0 - padU, eu1 = u1 + padU, ev0 = v0 - padV, ev1 = v1 + padV;
      var cellReal = Math.max(0.01, Math.max(eu1 - eu0, ev1 - ev0) * k / 1600), cell = cellReal / k;
      var gw = Math.max(1, Math.ceil((eu1 - eu0) / cell)), gh = Math.max(1, Math.ceil((ev1 - ev0) / cell));
      var walls = new Float32Array(gw * gh), furn = new Float32Array(gw * gh);
      var fcell = 0.1 / k, fw = Math.ceil((eu1 - eu0) / fcell), fh = Math.ceil((ev1 - ev0) / fcell), floor = new Uint8Array(fw * fh);
      var fLo = floorY - 0.05 / k;
      for (var j = 0; j < n; j++) {
        var u = U[j], v = V[j], y = Y[j];
        if (u < eu0 || u >= eu1 || v < ev0 || v >= ev1) continue;
        var gi = Math.floor((v - ev0) / cell) * gw + Math.floor((u - eu0) / cell);
        if (y >= b[0] && y <= b[1]) walls[gi]++;
        else if (y > floorY + 0.1 / k && y < b[0]) furn[gi]++;
        if (y >= fLo && y < b[0]) floor[Math.floor((v - ev0) / fcell) * fw + Math.floor((u - eu0) / fcell)] = 1;
      }
      /* floor area: 10 cm cells that see the floor (or furniture standing on it), small holes closed */
      var closed = close(floor, fw, fh), cells = 0;
      for (var q = 0; q < closed.length; q++) {
        if (!closed[q]) continue;
        var cu = eu0 + ((q % fw) + 0.5) * fcell, cv = ev0 + (Math.floor(q / fw) + 0.5) * fcell;
        if (cu >= u0 && cu <= u1 && cv >= v0 && cv <= v1) cells++;
      }
      bins = { c: c, s: s, eu0: eu0, eu1: eu1, ev0: ev0, ev1: ev1, u0: u0, u1: u1, v0: v0, v1: v1, w: u1 - u0, d: v1 - v0,
               cell: cell, gw: gw, gh: gh, walls: walls, furn: furn, area: cells * 0.01 };
    }
    function close(g, w, hgt) {   /* dilate then erode once (3 x 3) */
      var d = new Uint8Array(g.length), e = new Uint8Array(g.length), x, y, i, j, any, all;
      for (y = 0; y < hgt; y++) for (x = 0; x < w; x++) {
        any = 0;
        for (j = -1; j <= 1 && !any; j++) for (i = -1; i <= 1; i++) { var xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < w && yy < hgt && g[yy * w + xx]) { any = 1; break; } }
        d[y * w + x] = any;
      }
      for (y = 0; y < hgt; y++) for (x = 0; x < w; x++) {
        all = 1;
        for (j = -1; j <= 1 && all; j++) for (i = -1; i <= 1; i++) { var x2 = x + i, y2 = y + j; if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= hgt || !d[y2 * w + x2]) { all = 0; break; } }
        e[y * w + x] = all || g[y * w + x];
      }
      return e;
    }

    /* ------------------------------------------------ drawing */
    function font(weight, px, fam) { return weight + ' ' + px + 'px ' + (fam === 'mono' ? '"JetBrains Mono", ui-monospace, monospace' : fam === 'serif' ? 'Fraunces, Georgia, serif' : '"Work Sans", system-ui, sans-serif'); }
    function wrap(x, text, maxW) {
      var words = String(text || '').split(/\s+/), lines = [], line = '';
      words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
      if (line) lines.push(line);
      return lines;
    }
    function dim(x, x1, y1, x2, y2, text, color) {   /* an architect's dimension line: ticks at both ends, the length on it */
      var ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
      x.save();
      x.strokeStyle = color; x.fillStyle = color; x.lineWidth = 3;
      x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke();
      [[x1, y1], [x2, y2]].forEach(function (p) {
        x.beginPath();
        x.moveTo(p[0] + Math.cos(ang + Math.PI / 4) * 14, p[1] + Math.sin(ang + Math.PI / 4) * 14);
        x.lineTo(p[0] - Math.cos(ang + Math.PI / 4) * 14, p[1] - Math.sin(ang + Math.PI / 4) * 14);
        x.stroke();
      });
      x.translate((x1 + x2) / 2, (y1 + y2) / 2);
      var r = ang; if (r > Math.PI / 2 || r < -Math.PI / 2) r += Math.PI;
      x.rotate(r);
      x.font = font(600, 30, 'mono');
      var tw = x.measureText(text).width;
      if (tw + 24 > len) x.translate(0, -26);   /* short line: the label sits above it */
      x.fillStyle = PAPER; x.fillRect(-tw / 2 - 10, -21, tw + 20, 40);
      x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(text, 0, 0);
      x.restore();
    }
    function draw() {
      var x = canvas.getContext('2d'), B = bins;
      x.setTransform(1, 0, 0, 1, 0, 0);
      /* paper + drafting grid */
      x.fillStyle = PAPER; x.fillRect(0, 0, W, H);
      x.strokeStyle = GRIDC; x.lineWidth = 1;
      for (var gx = M; gx < W - M; gx += 40) { x.beginPath(); x.moveTo(gx + 0.5, M); x.lineTo(gx + 0.5, H - M); x.stroke(); }
      for (var gy = M; gy < H - M; gy += 40) { x.beginPath(); x.moveTo(M, gy + 0.5); x.lineTo(W - M, gy + 0.5); x.stroke(); }
      x.strokeStyle = INK; x.lineWidth = 4; x.strokeRect(M, M, W - 2 * M, H - 2 * M);
      var tbx = W - M - TB;
      x.lineWidth = 3; x.beginPath(); x.moveTo(tbx, M); x.lineTo(tbx, H - M); x.stroke();

      /* the plan area and its scale (px per unit in the file) */
      var px0 = M + 150, py0 = M + 150, pw = tbx - 70 - px0, ph = H - M - 80 - py0;
      var sx = pw / (B.eu1 - B.eu0), sy = ph / (B.ev1 - B.ev0), sc = Math.min(sx, sy);
      var ox = px0 + (pw - (B.eu1 - B.eu0) * sc) / 2, oy = py0 + (ph - (B.ev1 - B.ev0) * sc) / 2;
      function P(u, v) { return [ox + (u - B.eu0) * sc, oy + (v - B.ev0) * sc]; }
      function UV(px, pz) { return [px * B.c + pz * B.s, -px * B.s + pz * B.c]; }

      /* furniture (light) and walls (ink) from the point grids */
      var img = document.createElement('canvas'); img.width = B.gw; img.height = B.gh;
      var ix = img.getContext('2d'), id = ix.createImageData(B.gw, B.gh), dd = id.data;
      var wn = norm(B.walls), fn = norm(B.furn);
      for (var i = 0; i < B.walls.length; i++) {
        var aw = Math.min(1, B.walls[i] / wn), af = Math.min(1, B.furn[i] / fn) * 0.5, o = i * 4;
        if (aw > 0.04) { dd[o] = 42; dd[o + 1] = 35; dd[o + 2] = 30; dd[o + 3] = Math.round(255 * Math.min(1, 0.35 + aw)); }
        else if (af > 0.03) { dd[o] = 150; dd[o + 1] = 138; dd[o + 2] = 126; dd[o + 3] = Math.round(255 * Math.min(0.6, 0.15 + af)); }
      }
      ix.putImageData(id, 0, 0);
      x.save();
      x.imageSmoothingEnabled = true;
      var tl = P(B.eu0, B.ev0);
      x.drawImage(img, tl[0], tl[1], B.gw * B.cell * sc, B.gh * B.cell * sc);
      x.restore();

      /* overall W and D */
      var a = P(B.u0, B.v0), b = P(B.u1, B.v1);
      x.strokeStyle = 'rgba(42,35,30,0.35)'; x.lineWidth = 2; x.setLineDash([8, 8]);
      x.beginPath(); x.moveTo(a[0], a[1] - 18); x.lineTo(a[0], M + 96); x.moveTo(b[0], a[1] - 18); x.lineTo(b[0], M + 96);
      x.moveTo(a[0] - 18, a[1]); x.lineTo(M + 96, a[1]); x.moveTo(a[0] - 18, b[1]); x.lineTo(M + 96, b[1]); x.stroke();
      x.setLineDash([]);
      dim(x, a[0], M + 106, b[0], M + 106, LS.fmtLen(B.w * k), INK);
      dim(x, M + 106, a[1], M + 106, b[1], LS.fmtLen(B.d * k), INK);

      /* furniture boxes (dashed) */
      (scan.fits || []).forEach(function (f) {
        var r = (f.a || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), hw = f.w / k / 2, hd = f.d / k / 2;
        var pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(function (q) {
          var wx = f.x + c * q[0] + s * q[1], wz = f.z - s * q[0] + c * q[1], uv = UV(wx, wz);
          return P(uv[0], uv[1]);
        });
        x.save();
        x.strokeStyle = SAGE; x.lineWidth = 3; x.setLineDash([14, 9]); x.fillStyle = 'rgba(79,127,106,0.10)';
        x.beginPath(); pts.forEach(function (p, j) { if (j) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); }); x.closePath(); x.fill(); x.stroke();
        x.setLineDash([]);
        var cuv = UV(f.x, f.z), cp = P(cuv[0], cuv[1]);
        x.fillStyle = SAGE; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.font = font(600, 26, 'sans'); x.fillText(f.label || 'Box', cp[0], cp[1] - 15);
        x.font = font(500, 22, 'mono'); x.fillText(LS.fmtBox(f.w, f.d), cp[0], cp[1] + 16);
        x.restore();
      });

      /* saved measurements */
      (scan.measures || []).forEach(function (m) {
        var p1 = UV(m.a[0], m.a[2]), p2 = UV(m.b[0], m.b[2]), q1 = P(p1[0], p1[1]), q2 = P(p2[0], p2[1]);
        var len = Math.hypot(m.a[0] - m.b[0], m.a[1] - m.b[1], m.a[2] - m.b[2]) * k;
        var text = (m.label ? m.label + ' · ' : '') + LS.fmtLen(len);
        if (Math.hypot(q2[0] - q1[0], q2[1] - q1[1]) < 30) {   /* a mostly vertical line (a height): a marker with its label */
          x.save(); x.fillStyle = BRAND; x.beginPath(); x.arc(q1[0], q1[1], 9, 0, Math.PI * 2); x.fill();
          x.font = font(600, 26, 'mono'); x.textBaseline = 'middle'; x.fillText(text + ' (height)', q1[0] + 16, q1[1]); x.restore();
        } else dim(x, q1[0], q1[1], q2[0], q2[1], text, BRAND);
      });

      /* pins: numbered dots */
      (scan.annotations || []).forEach(function (p, j) {
        var uv = UV(p.p[0], p.p[2]), q = P(uv[0], uv[1]);
        x.save();
        x.fillStyle = PIN[p.color] || BRAND; x.strokeStyle = PAPER; x.lineWidth = 4;
        x.beginPath(); x.arc(q[0], q[1], 22, 0, Math.PI * 2); x.fill(); x.stroke();
        x.fillStyle = '#fff'; x.font = font(700, 24, 'sans'); x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(String(j + 1), q[0], q[1] + 1);
        x.restore();
      });

      titleBlock(x, tbx, sc);
    }
    function norm(g) {   /* the 90th percentile of the filled cells: walls look solid whatever the point density */
      var vals = [];
      for (var i = 0; i < g.length; i += Math.max(1, Math.floor(g.length / 60000))) if (g[i] > 0) vals.push(g[i]);
      if (!vals.length) return 1;
      vals.sort(function (p, q) { return p - q; });
      return Math.max(1, vals[Math.floor(vals.length * 0.9)]);
    }
    function titleBlock(x, tbx, sc) {
      var X0 = tbx + 40, maxW = TB - 80, y = M + 70, B = bins;
      x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      x.fillStyle = INK; x.font = font(600, 52, 'serif');
      wrap(x, scan.title || 'Room', maxW).slice(0, 3).forEach(function (line) { x.fillText(line, X0, y); y += 60; });
      x.fillStyle = MUTED; x.font = font(500, 26, 'sans');
      var when = scan.created ? new Date(scan.created).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      x.fillText([scan.room_label || '', when].filter(Boolean).join(' · '), X0, y); y += 30;
      if (scan.author) { x.fillText('Scanned by ' + scan.author, X0, y); y += 30; }
      y += 26;
      /* key numbers */
      var rows = [['Floor area', LS.fmtArea(B.area * k * k)], ['Width × depth', LS.fmtLen(B.w * k) + ' × ' + LS.fmtLen(B.d * k)]];
      if (scan.size && scan.size[2]) rows.push(['Ceiling', LS.fmtLen(scan.size[2])]);
      rows.forEach(function (r) {
        x.fillStyle = MUTED; x.font = font(500, 24, 'sans'); x.fillText(r[0], X0, y);
        x.fillStyle = INK; x.font = font(600, 30, 'mono'); x.textAlign = 'right'; x.fillText(r[1], X0 + maxW, y); x.textAlign = 'left';
        y += 46;
      });
      /* scale bar */
      y += 10;
      var pxPerM = sc / k, ft = LS.units === 'ft';
      var steps = ft ? [1, 2, 5, 10, 20, 50].map(function (f) { return f * 0.3048; }) : [0.5, 1, 2, 5, 10, 20];
      var nice = steps.filter(function (s) { return s * pxPerM <= maxW * 0.8; }).pop() || steps[0], len = nice * pxPerM;
      x.fillStyle = INK; x.strokeStyle = INK; x.lineWidth = 3;
      for (var seg = 0; seg < 4; seg++) {
        var sx0 = X0 + seg * len / 4;
        if (seg % 2 === 0) x.fillRect(sx0, y, len / 4, 14); else x.strokeRect(sx0, y, len / 4, 14);
      }
      x.font = font(500, 22, 'mono'); x.fillText('0', X0 - 4, y + 44); x.textAlign = 'right'; x.fillText(LS.fmtLen(nice), X0 + len + 6, y + 44); x.textAlign = 'left';
      y += 84;
      /* where the scale comes from */
      var ref = scan.scale_ref || {}, src = scan.scale_source;
      var note = src === 'phone' ? 'Scale corrected on a phone from “' + (ref.label || 'a length') + '”' + (ref.real ? ' (' + LS.fmtLen(ref.real) + ')' : '') + '.'
        : src === 'height' ? 'Scale from the phone height given at capture (about ' + LS.fmtLen(ref.real || 1.4) + ').'
        : src === 'calibrated' ? 'Scale calibrated in Studio against a known length.'
        : src === 'import' ? 'Scale from the imported 3D file.'
        : src === 'demo' ? 'Sample room: sizes are exact.'
        : 'Scale estimated from the phone height (1.40 m assumed). Check key sizes with a tape.';
      x.fillStyle = MUTED; x.font = font(500, 22, 'sans');
      wrap(x, note + ' Walls cut at ' + LS.fmtLen(st.cut) + ' to ' + LS.fmtLen(st.cut + 0.9) + '. Sizes ≈.', maxW).forEach(function (line) { x.fillText(line, X0, y); y += 30; });
      y += 18;
      /* pin legend */
      var pins = scan.annotations || [], qrTop = H - M - 300;
      if (pins.length) {
        x.fillStyle = INK; x.font = font(600, 26, 'sans'); x.fillText('Pins', X0, y); y += 40;
        for (var j = 0; j < pins.length && y < qrTop - 20; j++) {
          var p = pins[j];
          x.fillStyle = PIN[p.color] || BRAND; x.beginPath(); x.arc(X0 + 15, y - 9, 15, 0, Math.PI * 2); x.fill();
          x.fillStyle = '#fff'; x.font = font(700, 18, 'sans'); x.textAlign = 'center'; x.fillText(String(j + 1), X0 + 15, y - 3); x.textAlign = 'left';
          x.fillStyle = INK; x.font = font(500, 23, 'sans');
          var line = p.label + (p.note ? ': ' + p.note : '');
          var lines = wrap(x, line, maxW - 44).slice(0, 2);
          lines.forEach(function (l, li) { x.fillText(l, X0 + 44, y + li * 28); });
          y += 28 * lines.length + 12;
        }
        if (j < pins.length) { x.fillStyle = MUTED; x.fillText('+ ' + (pins.length - j) + ' more on the 3D room', X0 + 44, y); }
      }
      /* QR code + short link (shared rooms only) */
      var link = opts.link || '';
      if (link && st.qr) {
        try {
          var q = st.qr(0, 'M'); q.addData(link); q.make();
          var cnt = q.getModuleCount(), size = 200, cellPx = Math.floor(size / cnt), qs = cellPx * cnt, qx = X0, qy = H - M - 40 - qs - 60;
          x.fillStyle = '#fff'; x.fillRect(qx - 12, qy - 12, qs + 24, qs + 24);
          x.fillStyle = INK;
          for (var r = 0; r < cnt; r++) for (var c = 0; c < cnt; c++) if (q.isDark(r, c)) x.fillRect(qx + c * cellPx, qy + r * cellPx, cellPx, cellPx);
          x.font = font(600, 24, 'sans'); x.fillText('Walk through it in 3D', qx + qs + 30, qy + 40);
          x.fillStyle = MUTED; x.font = font(500, 20, 'mono');
          wrap(x, link.replace(/^https?:\/\//, ''), maxW - qs - 30).slice(0, 4).forEach(function (l, li) { x.fillText(l, qx + qs + 30, qy + 80 + li * 26); });
        } catch (e) { console.warn('qr', e); }
      } else if (link) {
        x.fillStyle = INK; x.font = font(600, 24, 'sans'); x.fillText('Walk through it in 3D:', X0, H - M - 130);
        x.fillStyle = MUTED; x.font = font(500, 20, 'mono'); wrap(x, link.replace(/^https?:\/\//, ''), maxW).slice(0, 3).forEach(function (l, li) { x.fillText(l, X0, H - M - 98 + li * 26); });
      }
      x.fillStyle = MUTED; x.font = font(500, 20, 'sans');
      x.fillText('Made with Logsteps · logsteps.com', X0, H - M - 24);
    }
    return h;
  };
})();
