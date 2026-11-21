/* ls-viewer.js: the 3D engine (window.LS: loadThree, loadModel, Viewer, controls, writePLY), moved unchanged from the old web/pages/_viewer.html. Pages reach it through client_code/ls.py and Components/Viewer. */
(function () {
  'use strict';
  var LS = window.LS = window.LS || {};
  var threeP = null;

  LS.loadThree = function () {
    if (window.THREE && window.LS_THREE_READY) return Promise.resolve(window.THREE);
    if (threeP) return threeP;
    threeP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '_/theme/three-r147.js?v=147a';
      s.onload = function () { window.THREE ? resolve(window.THREE) : reject(new Error('3D engine failed to start')); };
      s.onerror = function () { threeP = null; reject(new Error('Couldn\'t load the 3D engine. Check your connection.')); };
      document.head.appendChild(s);
    });
    return threeP;
  };

  LS.webgl = function () {
    try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); }
    catch (e) { return false; }
  };

  /* Download with progress -> ArrayBuffer */
  LS.fetchBuffer = function (url, onProg) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 403 ? 'This link has expired. Reload the page.' : 'Couldn\'t download the 3D model (' + r.status + ').');
      var total = +r.headers.get('Content-Length') || 0;
      if (!r.body || !r.body.getReader || !onProg) return r.arrayBuffer();
      var reader = r.body.getReader(), chunks = [], got = 0;
      return (function pump() {
        return reader.read().then(function (x) {
          if (x.done) {
            var out = new Uint8Array(got), o = 0;
            chunks.forEach(function (c) { out.set(c, o); o += c.length; });
            return out.buffer;
          }
          chunks.push(x.value); got += x.value.length; onProg(got, total);
          return pump();
        });
      })();
    });
  };

  LS.parsePLY = function (buf) {
    var g = new THREE.PLYLoader().parse(buf);
    if (!g.attributes.position || !g.attributes.position.count) throw new Error('That file has no 3D points.');
    return g;
  };

  LS.loadModel = function (url, onProg) {
    return LS.loadThree().then(function () { return LS.fetchBuffer(url, onProg); }).then(LS.parsePLY);
  };

  /* Lengths in the chosen units: 'm' (metric) or 'ft' (feet and inches), remembered per browser. Every length the app
     shows goes through these (the Python pages too, via client_code/ls.py). */
  LS.units = (function () { try { return localStorage.getItem('ls.units') === 'ft' ? 'ft' : 'm'; } catch (e) { return 'm'; } })();
  LS._unitWatchers = [];
  LS.setUnits = function (u) {
    LS.units = u === 'ft' ? 'ft' : 'm';
    try { localStorage.setItem('ls.units', LS.units); } catch (e) { /* private window */ }
    LS._unitWatchers.slice().forEach(function (fn) { try { fn(LS.units); } catch (e) { console.error(e); } });
  };
  LS.onUnits = function (fn) {
    LS._unitWatchers.push(fn);
    return function () { LS._unitWatchers = LS._unitWatchers.filter(function (f) { return f !== fn; }); };
  };
  /* 2.032 -> 6′ 8″, 0.29 -> 11½″ (to the nearest half inch) */
  LS.ftIn = function (m) {
    var halves = Math.round(Math.abs(m) / 0.0254 * 2), inches = halves / 2, ft = Math.floor(inches / 12), rest = inches - ft * 12;
    var whole = Math.floor(rest), half = rest - whole >= 0.5 ? '½' : '', sign = m < 0 ? '−' : '';
    var inText = (whole ? String(whole) : '') + half;
    if (!ft) return sign + (inText || '0') + '″';
    return sign + ft + '′' + (inText ? ' ' + inText + '″' : '');
  };
  LS.fmtLen = function (m, units) {
    if (m == null || isNaN(m)) return '';
    if ((units || LS.units) === 'ft') return LS.ftIn(m);
    var a = Math.abs(m);
    return a < 1 ? Math.round(m * 100) + ' cm' : (Math.round(m * 100) / 100).toFixed(2) + ' m';
  };
  /* a room size number: '4.80' (metres, the unit is shown beside it) or '15′ 9″' */
  LS.fmtDim = function (m) { return m == null || isNaN(m) ? '' : LS.units === 'ft' ? LS.ftIn(m) : (+m).toFixed(2); };
  LS.fmtArea = function (a) {
    if (a == null || isNaN(a)) return '';
    return LS.units === 'ft' ? '≈ ' + Math.round(a * 10.7639).toLocaleString() + ' ft²' : '≈ ' + (Math.round(a * 10) / 10) + ' m²';
  };
  /* furniture: '220 × 95 × 85 cm' or '7′ 2½″ × 3′ 1½″ × 2′ 9½″' */
  LS.fmtBox = function (w, d, h) {
    var dims = [w, d, h].filter(function (x) { return x != null; });
    if (LS.units === 'ft') return dims.map(LS.ftIn).join(' × ');
    return dims.map(function (x) { return Math.round(x * 100); }).join(' × ') + ' cm';
  };
  LS.fmtNum = function (n) { return (n || 0).toLocaleString(); };
  LS.fmtSize = function (s) {
    if (!s || s.length !== 3) return '';
    return LS.units === 'ft' ? s.map(LS.ftIn).join(' × ') : s[0].toFixed(1) + ' × ' + s[1].toFixed(1) + ' × ' + s[2].toFixed(1) + ' m';
  };

  /* colours live in linear space in three.js (PLYLoader converts); files store sRGB bytes */
  var SRGB = new Uint8Array(4097);
  for (var si = 0; si <= 4096; si++) { var lv = si / 4096; SRGB[si] = Math.round(255 * (lv < 0.0031308 ? lv * 12.92 : 1.055 * Math.pow(lv, 1 / 2.4) - 0.055)); }
  function toSRGB(v) { return SRGB[Math.max(0, Math.min(4096, Math.round(v * 4096)))]; }
  /* binary PLY from a geometry (points, plus faces when it has an index) */
  LS.writePLY = function (geom) {
    var pos = geom.attributes.position, col = geom.attributes.color, n = pos.count, idx = geom.index;
    var faces = idx ? idx.count / 3 : 0;
    var head = 'ply\nformat binary_little_endian 1.0\ncomment Logsteps\nelement vertex ' + n +
      '\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n' +
      (faces ? 'element face ' + faces + '\nproperty list uchar int vertex_indices\n' : '') + 'end_header\n';
    var hb = new TextEncoder().encode(head);
    var size = hb.length + n * 15 + faces * 13;
    var buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
    u8.set(hb, 0);
    var o = hb.length, p = pos.array, c = col ? col.array : null;
    for (var i = 0; i < n; i++) {
      dv.setFloat32(o, p[i * 3], true); dv.setFloat32(o + 4, p[i * 3 + 1], true); dv.setFloat32(o + 8, p[i * 3 + 2], true);
      if (c) { u8[o + 12] = toSRGB(c[i * 3]); u8[o + 13] = toSRGB(c[i * 3 + 1]); u8[o + 14] = toSRGB(c[i * 3 + 2]); }
      else { u8[o + 12] = 200; u8[o + 13] = 190; u8[o + 14] = 178; }
      o += 15;
    }
    if (faces) {
      var ia = idx.array;
      for (var f = 0; f < faces; f++) {
        u8[o] = 3; dv.setInt32(o + 1, ia[f * 3], true); dv.setInt32(o + 5, ia[f * 3 + 1], true); dv.setInt32(o + 9, ia[f * 3 + 2], true);
        o += 13;
      }
    }
    return buf;
  };

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function dotTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.beginPath(); x.arc(32, 32, 30, 0, Math.PI * 2); x.fill();
    var t = new THREE.CanvasTexture(c); return t;
  }
  var RAMP = [[0.31, 0.50, 0.42], [0.92, 0.85, 0.74], [0.76, 0.32, 0.17]];  // sage -> paper -> terracotta
  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    var a = t < 0.5 ? RAMP[0] : RAMP[1], b = t < 0.5 ? RAMP[1] : RAMP[2], k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  /* ================================================================== the viewer */
  function Viewer(el, opts) {
    var V = this, T = THREE;
    opts = opts || {};
    V.el = el; V.opts = opts;
    el.classList.add('ls-view');
    V.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    V.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    V.renderer.localClippingEnabled = true;
    V.renderer.outputEncoding = T.sRGBEncoding;  // PLYLoader gives linear colours
    el.appendChild(V.renderer.domElement);
    V.overlay = document.createElement('div'); V.overlay.className = 'ls-overlay'; el.appendChild(V.overlay);
    V.scene = new T.Scene();
    V.bg = new T.Color(opts.background || '#211b17');
    V.scene.background = V.bg;
    V.camera = new T.PerspectiveCamera(55, 1, 0.02, 400);
    V.ortho = new T.OrthographicCamera(-5, 5, 5, -5, 0.01, 400);
    V.active = V.camera;
    V.controls = new T.OrbitControls(V.camera, V.renderer.domElement);
    V.controls.enableDamping = true; V.controls.dampingFactor = 0.09; V.controls.screenSpacePanning = true;
    V.controls.maxPolarAngle = Math.PI * 0.9;
    V.orthoControls = new T.OrbitControls(V.ortho, V.renderer.domElement);
    V.orthoControls.enableRotate = false; V.orthoControls.screenSpacePanning = true; V.orthoControls.enabled = false;
    V.orthoControls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.PAN };
    V.orthoControls.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_PAN };
    V.scene.add(new T.HemisphereLight(0xfff4e6, 0x3a3029, 0.95));
    var sun = new T.DirectionalLight(0xffffff, 0.55); sun.position.set(3, 6, 2); V.scene.add(sun);
    V.clip = new T.Plane(new T.Vector3(0, -1, 0), 100);
    V.group = new T.Group(); V.scene.add(V.group);
    V.helpers = new T.Group(); V.scene.add(V.helpers);
    V.dot = dotTexture();
    V.state = { mode: 'orbit', display: 'points', color: 'photo', cut: opts.cut !== false, size: 1, measuring: false };
    V.pins = []; V.measures = []; V.pending = null;
    V.k = 1;               /* size fix: real length = length in the file x k ("It's really..." on the scan page) */
    V.saved = [];          /* saved measurements (yellow lines with a label) */
    V.fits = []; V.sel = null; V._drag = null;   /* "Will it fit?" furniture boxes */
    V.fitGroup = new T.Group(); V.scene.add(V.fitGroup);
    V._unsubUnits = LS.onUnits(function () { V._relabel(); });
    V.keys = {}; V.walk = { yaw: 0, pitch: 0, move: [0, 0] };
    V.replay = null;
    V.clock = new T.Clock();
    V.alive = true;
    V._resize = function () { V.resize(); };
    V.ro = window.ResizeObserver ? new ResizeObserver(V._resize) : null;
    if (V.ro) V.ro.observe(el); else window.addEventListener('resize', V._resize);
    V._bind();
    V.resize();
    V._loop();
  }
  LS.Viewer = Viewer;

  Viewer.prototype.resize = function () {
    var w = this.el.clientWidth || 300, h = this.el.clientHeight || 200;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this._orthoFrame();
    this.needs = true;
  };

  Viewer.prototype._orthoFrame = function () {
    var w = this.el.clientWidth || 300, h = this.el.clientHeight || 200, half = (this.span || 6) * 0.62;
    var a = w / h;
    this.ortho.left = -half * Math.max(a, 1); this.ortho.right = half * Math.max(a, 1);
    this.ortho.top = half / Math.min(a, 1); this.ortho.bottom = -half / Math.min(a, 1);
    this.ortho.updateProjectionMatrix();
  };

  /* geometries: {points: BufferGeometry, surface: BufferGeometry (with index) or null} */
  Viewer.prototype.setModel = function (points, surface) {
    var V = this, T = THREE;
    V.group.clear();
    V.layers = {};
    [['points', points], ['surface', surface]].forEach(function (pair) {
      var g = pair[1];
      if (!g) return;
      if (!g.attributes.color) {
        var n = g.attributes.position.count, c = new Float32Array(n * 3);
        for (var i = 0; i < n * 3; i++) c[i] = 0.78;
        g.setAttribute('color', new T.BufferAttribute(c, 3));
      }
      g.userData.photo = g.attributes.color.array.slice();
      g.computeBoundingBox();
      var obj;
      if (pair[0] === 'surface' && g.index) {
        if (!g.attributes.normal) g.computeVertexNormals();
        obj = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, clippingPlanes: [V.clip] }));
      } else {
        obj = new T.Points(g, new T.PointsMaterial({ size: 0.02, vertexColors: true, map: V.dot, alphaTest: 0.5, transparent: false,
          sizeAttenuation: true, clippingPlanes: [V.clip] }));
      }
      obj.userData.layer = pair[0];
      V.layers[pair[0]] = { geom: g, obj: obj };
      V.group.add(obj);
    });
    V._floorY = null;
    if (!V.layers.points && V.layers.surface) V.state.display = 'surface';
    if (V.layers.points && !V.layers.surface && V.state.display === 'surface') V.state.display = 'points';
    V.measureBounds();
    V.setDisplay(V.state.display);
    V.setColor(V.state.color);
    V.setCut(V.state.cut);
    V.needs = true;
  };

  Viewer.prototype.measureBounds = function () {
    var T = THREE, box = new T.Box3();
    var self = this;
    Object.keys(this.layers || {}).forEach(function (k) { self.layers[k].geom.computeBoundingBox(); box.union(self.layers[k].geom.boundingBox); });
    if (box.isEmpty()) box.set(new T.Vector3(-1, 0, -1), new T.Vector3(1, 2, 1));
    this.box = box;
    var size = box.getSize(new T.Vector3());
    this.span = Math.max(size.x, size.z, 1);
    this.height = Math.max(size.y, 0.5);
    var pl = this.layers && this.layers.points;
    if (pl) {
      var n = pl.geom.attributes.position.count;
      var area = 2 * (size.x * size.z + size.x * size.y + size.z * size.y);
      this.spacing = Math.max(0.003, Math.min(0.08, Math.sqrt(area / Math.max(n, 1))));
    } else this.spacing = 0.02;
    this.setPointSize(this.state.size);
    this._orthoFrame();
    this._grid();
  };

  Viewer.prototype._grid = function () {
    var T = THREE;
    if (this.grid) this.helpers.remove(this.grid);
    var s = Math.ceil(this.span * 1.6 + 2);
    this.grid = new T.GridHelper(s, s * 2, 0xc2522b, 0x6e6258);
    this.grid.material.transparent = true; this.grid.material.opacity = 0.16; this.grid.material.depthWrite = false;
    var c = this.box.getCenter(new T.Vector3());
    this.grid.position.set(c.x, this.box.min.y - 0.004, c.z);
    this.helpers.add(this.grid);
  };

  Viewer.prototype.setPointSize = function (k) {
    this.state.size = k;
    var l = this.layers && this.layers.points;
    var close = this.state.mode === 'walk' || !!this.replay;  // first person: points are near, keep them small
    if (l && this.state.mode === 'plan') {  // orthographic: point sizes are in pixels, so follow the zoom
      var ppm = (this.el.clientHeight || 400) * this.ortho.zoom / (this.ortho.top - this.ortho.bottom);
      l.obj.material.sizeAttenuation = false; l.obj.material.size = Math.max(1.5, this.spacing * 2.2 * k * ppm);
      l.obj.material.needsUpdate = true;
    } else if (l) { l.obj.material.sizeAttenuation = true; l.obj.material.size = this.spacing * (close ? 1.7 : 2.8) * k; l.obj.material.needsUpdate = true; }
    this.needs = true;
  };

  Viewer.prototype.setDisplay = function (d) {
    var V = this;
    if (d === 'surface' && !(V.layers && V.layers.surface)) d = 'points';
    V.state.display = d;
    Object.keys(V.layers || {}).forEach(function (k) { V.layers[k].obj.visible = k === d; });
    V.needs = true;
  };

  Viewer.prototype.setColor = function (mode) {
    var V = this;
    V.state.color = mode;
    Object.keys(V.layers || {}).forEach(function (k) {
      var g = V.layers[k].geom, col = g.attributes.color, pos = g.attributes.position.array, n = g.attributes.position.count, a = col.array;
      var src = g.userData.photo;
      if (mode === 'photo') a.set(src);
      else {
        var y0 = V.box.min.y, h = V.height;
        for (var i = 0; i < n; i++) {
          var t = (pos[i * 3 + 1] - y0) / h;
          if (mode === 'height') { var c = ramp(t); a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
          else { var l = 0.55 + 0.4 * (0.3 * src[i * 3] + 0.59 * src[i * 3 + 1] + 0.11 * src[i * 3 + 2]); a[i * 3] = l * 0.95; a[i * 3 + 1] = l * 0.9; a[i * 3 + 2] = l * 0.84; }
        }
      }
      if (V.selection && V.selection[k]) V._paintSelection(k);
      col.needsUpdate = true;
    });
    V.needs = true;
  };

  /* Studio uses this to show a selection on top of the colour mode */
  Viewer.prototype._paintSelection = function (k) {
    var sel = this.selection[k], a = this.layers[k].geom.attributes.color.array;
    for (var i = 0; i < sel.length; i++) if (sel[i]) { a[i * 3] = 1; a[i * 3 + 1] = 0.82; a[i * 3 + 2] = 0.2; }
  };

  Viewer.prototype.setCut = function (on, at) {
    this.state.cut = !!on;
    if (at != null) this.cutAt = at;
    var y = this.box ? this.box.min.y + (this.cutAt != null ? this.cutAt : this.height * 0.78) : 100;
    this.clip.constant = on && this.state.mode !== 'walk' ? y : 1e6;
    this.needs = true;
  };

  /* --------------------------------------------------- camera framing + modes */
  Viewer.prototype.fit = function (view) {
    var T = THREE, b = this.box, c = b.getCenter(new T.Vector3()), s = this.span;
    var asp = this.camera.aspect || 1;
    if (asp < 1.25) s = s * Math.pow(1.25 / asp, 0.85);  // tall, narrow views (phones): step back
    view = view || 'corner';
    var target = new T.Vector3(c.x, b.min.y + this.height * 0.3, c.z);
    var pos = view === 'top' ? new T.Vector3(c.x, b.min.y + s * 1.6, c.z + 0.01)
      : new T.Vector3(c.x + s * 0.58, b.min.y + this.height + s * 0.95, c.z + s * 0.74);
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.camera.near = Math.max(0.01, s / 600); this.camera.far = s * 40; this.camera.updateProjectionMatrix();
    this.controls.update();
    this.ortho.position.set(c.x, b.max.y + 5, c.z); this.ortho.up.set(0, 0, -1); this.ortho.lookAt(c.x, 0, c.z);
    this.orthoControls.target.set(c.x, 0, c.z); this.ortho.zoom = 1; this.ortho.updateProjectionMatrix();
    this.needs = true;
  };

  Viewer.prototype.setMode = function (mode) {
    var V = this, T = THREE;
    if (V.replay && V.replay.playing && mode !== 'orbit') V.stopReplay();
    V.state.mode = mode;
    V.controls.enabled = mode === 'orbit';
    V.orthoControls.enabled = mode === 'plan';
    V.active = mode === 'plan' ? V.ortho : V.camera;
    V._joy(mode === 'walk' && matchMedia('(pointer: coarse)').matches);
    V._scale(mode === 'plan');
    if (mode === 'walk') {
      var start = V.opts.path && V.opts.path.length ? V.opts.path[0] : null, c = V.box.getCenter(new T.Vector3());
      var p = start ? new T.Vector3(start[0], start[1], start[2]) : new T.Vector3(c.x, V.box.min.y + 1.55, c.z);
      V.camera.position.copy(p);
      var dir = start ? new T.Vector3(start[3], 0, start[5]) : new T.Vector3(0, 0, -1);
      V.walk.yaw = Math.atan2(-dir.x, -dir.z); V.walk.pitch = -0.08;
      V.camera.near = 0.02; V.camera.updateProjectionMatrix();
      V._applyLook();
      V.hint(matchMedia('(pointer: coarse)').matches ? 'Drag to look around. Use the stick to walk.' : 'Drag to look. W A S D or the arrow keys to walk. Shift to hurry.');
    } else if (mode === 'orbit') {
      V.fit();
    } else if (mode === 'plan') {
      V.fit('top');
      V.hint('Floor plan, from above. Drag to move, scroll or pinch to zoom.');
    }
    V.setCut(V.state.cut);
    V.setPointSize(V.state.size);
    V.needs = true;
  };

  Viewer.prototype._applyLook = function () {
    var e = new THREE.Euler(this.walk.pitch, this.walk.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(e);
    this.needs = true;
  };

  Viewer.prototype.hint = function (text, ms) {
    var V = this;
    if (V._hintEl) V._hintEl.remove();
    if (!text) return;
    var h = document.createElement('div'); h.className = 'ls-hint'; h.textContent = text;
    V.el.appendChild(h); V._hintEl = h;
    clearTimeout(V._hintT);
    V._hintT = setTimeout(function () { if (h.parentNode) h.remove(); }, ms || 3800);
  };

  Viewer.prototype._joy = function (on) {
    var V = this;
    if (V.joyEl) { V.joyEl.remove(); V.joyEl = null; }
    if (!on) return;
    var j = document.createElement('div'); j.className = 'ls-joy'; j.innerHTML = '<i></i>';
    V.el.appendChild(j); V.joyEl = j;
    var knob = j.firstChild, id = null;
    function move(e) {
      var r = j.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      var m = Math.min(1, Math.hypot(dx, dy) / 44), a = Math.atan2(dy, dx);
      knob.style.transform = 'translate(' + Math.cos(a) * m * 34 + 'px,' + Math.sin(a) * m * 34 + 'px)';
      V.walk.move = [Math.cos(a) * m, Math.sin(a) * m];
    }
    j.addEventListener('pointerdown', function (e) { id = e.pointerId; j.setPointerCapture(id); move(e); e.stopPropagation(); });
    j.addEventListener('pointermove', function (e) { if (e.pointerId === id) move(e); });
    function up() { id = null; knob.style.transform = ''; V.walk.move = [0, 0]; }
    j.addEventListener('pointerup', up); j.addEventListener('pointercancel', up);
  };

  Viewer.prototype._scale = function (on) {
    var V = this;
    if (V.scaleEl) { V.scaleEl.remove(); V.scaleEl = null; }
    if (V.compassEl) { V.compassEl.remove(); V.compassEl = null; }
    if (!on) return;
    V.scaleEl = document.createElement('div'); V.scaleEl.className = 'ls-scalebar'; V.el.appendChild(V.scaleEl);
    V.compassEl = document.createElement('div'); V.compassEl.className = 'ls-compass'; V.compassEl.textContent = 'N'; V.el.appendChild(V.compassEl);
  };

  /* --------------------------------------------------- input */
  Viewer.prototype._bind = function () {
    var V = this, c = V.renderer.domElement, down = null, last = null;
    c.tabIndex = 0;
    c.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY, t: Date.now() }; last = down;
      if (V.state.mode === 'walk') { c.setPointerCapture(e.pointerId); }
    });
    c.addEventListener('pointermove', function (e) {
      if (V.state.mode === 'walk' && down && last) {
        V.walk.yaw -= (e.clientX - last.x) * 0.0042; V.walk.pitch -= (e.clientY - last.y) * 0.0042;
        V.walk.pitch = Math.max(-1.45, Math.min(1.45, V.walk.pitch));
        V._applyLook();
      }
      last = { x: e.clientX, y: e.clientY };
      if (V.onHover) V.onHover(e);
    });
    c.addEventListener('pointerup', function (e) {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && Date.now() - down.t < 500) V._click(e);
      down = null;
    });
    c.addEventListener('pointercancel', function () { down = null; });
    V._kd = function (e) {
      if (/input|textarea|select/i.test((e.target && e.target.tagName) || '')) return;
      V.keys[(e.key || '').toLowerCase()] = true; V.keys.shift = e.shiftKey;
      if (V.state.mode === 'walk' && /^(arrow|w$|a$|s$|d$)/.test((e.key || '').toLowerCase())) e.preventDefault();
    };
    V._ku = function (e) { V.keys[(e.key || '').toLowerCase()] = false; V.keys.shift = e.shiftKey; };
    window.addEventListener('keydown', V._kd); window.addEventListener('keyup', V._ku);
    /* furniture boxes: a press on a box drags it along the floor (Orbit and Plan); the room view doesn't turn meanwhile */
    V.el.addEventListener('pointerdown', function (e) {
      if (!V.fits.length || e.target !== c || V.state.mode === 'walk' || V.replay || V.state.measuring) return;
      var f = V._hitFit(e.clientX, e.clientY);
      if (!f) return;
      e.stopPropagation(); e.preventDefault();
      V.selectFit(f);
      var p = V._floorPoint(e.clientX, e.clientY);
      if (!p) return;
      V._drag = { f: f, id: e.pointerId, dx: f.group.position.x - p.x, dz: f.group.position.z - p.z, t: 0, moved: false };
      try { V.el.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
    }, true);
    V.el.addEventListener('pointermove', function (e) {
      var d = V._drag;
      if (!d || e.pointerId !== d.id) return;
      e.stopPropagation();
      var p = V._floorPoint(e.clientX, e.clientY);
      if (!p) return;
      var b = V.box, pad = 1;
      d.f.group.position.x = Math.max(b.min.x - pad, Math.min(b.max.x + pad, p.x + d.dx));
      d.f.group.position.z = Math.max(b.min.z - pad, Math.min(b.max.z + pad, p.z + d.dz));
      d.moved = true; V.needs = true;
      var now = performance.now();
      if (now - d.t > 125) { d.t = now; V.checkFit(d.f); V._fitChanged(d.f, false); }   /* about 8 times a second */
    }, true);
    function endDrag(e) {
      var d = V._drag;
      if (!d || e.pointerId !== d.id) return;
      e.stopPropagation();
      V._drag = null;
      try { V.el.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      V.checkFit(d.f); V._fitChanged(d.f, d.moved);
    }
    V.el.addEventListener('pointerup', endDrag, true);
    V.el.addEventListener('pointercancel', endDrag, true);
    V.controls.addEventListener('change', function () { V.needs = true; });
    V.orthoControls.addEventListener('change', function () { if (V._lastZoom !== V.ortho.zoom) { V._lastZoom = V.ortho.zoom; V.setPointSize(V.state.size); } V.needs = true; });
  };

  Viewer.prototype.pick = function (clientX, clientY) {
    var T = THREE, r = this.renderer.domElement.getBoundingClientRect();
    var ndc = new T.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    var rc = new T.Raycaster();
    rc.params.Points.threshold = Math.max(this.spacing * 1.6, 0.012);
    rc.setFromCamera(ndc, this.active);
    var vis = this.group.children.filter(function (o) { return o.visible; });
    var hits = rc.intersectObjects(vis, false);
    var clipY = this.clip.constant;
    for (var i = 0; i < hits.length; i++) if (hits[i].point.y <= clipY + 1e-6) return hits[i].point.clone();
    return null;
  };

  Viewer.prototype._click = function (e) {
    var V = this;
    if (V.onPick) { var p0 = V.pick(e.clientX, e.clientY); if (V.onPick(p0, e) === false) return; }
    if (!V.state.measuring) return;
    var p = V.pick(e.clientX, e.clientY);
    if (!p) { V.hint('Tap right on the room to place a point.', 2000); return; }
    V._marker(p);
    if (!V.pending) { V.pending = p; V.hint('Now the second point.', 2500); return; }
    V.addMeasure(V.pending, p);
    V.pending = null;
  };

  Viewer.prototype._marker = function (p) {
    var T = THREE, m = new T.Mesh(new T.SphereGeometry(Math.max(this.span * 0.006, 0.018), 12, 8), new T.MeshBasicMaterial({ color: 0xf4d35e, depthTest: false }));
    m.renderOrder = 10; m.position.copy(p); this.helpers.add(m); this.markers = (this.markers || []).concat(m); this.needs = true;
  };

  Viewer.prototype.addMeasure = function (a, b) {
    var T = THREE;
    var g = new T.BufferGeometry().setFromPoints([a, b]);
    var line = new T.Line(g, new T.LineBasicMaterial({ color: 0xf4d35e, depthTest: false }));
    line.renderOrder = 9; this.helpers.add(line);
    var label = document.createElement('div'); label.className = 'ls-measure'; label.textContent = LS.fmtLen(a.distanceTo(b) * this.k);
    this.overlay.appendChild(label);
    this.measures.push({ a: a, b: b, line: line, label: label, mid: a.clone().add(b).multiplyScalar(0.5) });
    if (this.onMeasure) this.onMeasure(a, b, a.distanceTo(b));
    this.needs = true;
  };

  /* Saved measurements: [{a: [x,y,z], b: [x,y,z], label}] in the file's coordinates */
  Viewer.prototype.setMeasures = function (list) {
    var V = this, T = THREE;
    V.saved.forEach(function (m) { V.helpers.remove(m.line); m.ends.forEach(function (e) { V.helpers.remove(e); }); m.label.remove(); });
    V.saved = (list || []).map(function (s) {
      var a = new T.Vector3(s.a[0], s.a[1], s.a[2]), b = new T.Vector3(s.b[0], s.b[1], s.b[2]);
      var line = new T.Line(new T.BufferGeometry().setFromPoints([a, b]), new T.LineBasicMaterial({ color: 0xf4d35e, depthTest: false }));
      line.renderOrder = 9; V.helpers.add(line);
      var r = Math.max(V.span * 0.004, 0.012), ends = [a, b].map(function (p) {
        var e = new T.Mesh(new T.SphereGeometry(r, 10, 6), new T.MeshBasicMaterial({ color: 0xf4d35e, depthTest: false }));
        e.renderOrder = 10; e.position.copy(p); V.helpers.add(e); return e;
      });
      var label = document.createElement('div'); label.className = 'ls-measure saved';
      V.overlay.appendChild(label);
      return { a: a, b: b, line: line, ends: ends, label: label, name: s.label || '', mid: a.clone().add(b).multiplyScalar(0.5) };
    });
    V._relabel();
  };

  /* the size fix: every length shown = length in the file x k (the file itself never changes) */
  Viewer.prototype.setScale = function (k) {
    var V = this;
    V.k = k > 0 ? k : 1;
    V.fits.forEach(function (f) { V._sizeFit(f); V.checkFit(f); });
    if (V.sel) V._drawGaps(V.sel);
    V._relabel();
  };

  Viewer.prototype._relabel = function () {
    var V = this;
    V.measures.forEach(function (m) { m.label.textContent = LS.fmtLen(m.a.distanceTo(m.b) * V.k); });
    V.saved.forEach(function (m) {
      var len = LS.fmtLen(m.a.distanceTo(m.b) * V.k);
      m.label.textContent = m.name ? m.name + ' · ' + len : len;
    });
    V.fits.forEach(function (f) { V._fitLabel(f); });
    if (V.sel) V._drawGaps(V.sel);
    if (V.onRelabel) V.onRelabel();
    V.needs = true;
  };

  Viewer.prototype.clearMeasures = function () {
    var V = this;
    V.measures.forEach(function (m) { V.helpers.remove(m.line); m.label.remove(); });
    (V.markers || []).forEach(function (m) { V.helpers.remove(m); });
    V.measures = []; V.markers = []; V.pending = null; V.needs = true;
  };

  Viewer.prototype.setMeasuring = function (on) {
    this.state.measuring = !!on; this.pending = null;
    this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
    if (on) this.hint('Measure: tap two points in the room.');
  };

  /* --------------------------------------------------- "Will it fit?" furniture boxes
     spec: {label, w, d, h} in real metres, plus x, z (on the floor, file coordinates), a (turn in degrees) and kept.
     A box is drawn at its real size / k, so a 2 m sofa stays 2 m when the size fix changes. checkFit counts the points
     inside the box (shrunk by 2 cm, ignoring the floor) and finds the nearest point beyond each side. */
  var FIT_OK = 0x4f7f6a, FIT_BAD = 0xc2522b;
  function rayFrom(V, cx, cy) {
    var T = THREE, r = V.renderer.domElement.getBoundingClientRect(), rc = new T.Raycaster();
    rc.setFromCamera(new T.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), V.active);
    return rc;
  }
  function push3(arr, v) {
    if (arr.length < 3) { arr.push(v); arr.sort(function (a, b) { return a - b; }); }
    else if (v < arr[2]) { arr[2] = v; arr.sort(function (a, b) { return a - b; }); }
  }
  Viewer.prototype.floorY = function () {
    if (this._floorY != null) return this._floorY;
    var l = this.layers && (this.layers.points || this.layers.surface);
    if (!l) return 0;
    var p = l.geom.attributes.position.array, n = l.geom.attributes.position.count, step = Math.max(1, Math.floor(n / 20000)), ys = [];
    for (var i = 0; i < n; i += step) ys.push(p[i * 3 + 1]);
    ys.sort(function (a, b) { return a - b; });
    this._floorY = ys.length ? ys[Math.floor(ys.length * 0.02)] : 0;
    return this._floorY;
  };
  Viewer.prototype._floorPoint = function (cx, cy) {
    var T = THREE;
    return rayFrom(this, cx, cy).ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -this.floorY()), new T.Vector3());
  };
  Viewer.prototype._hitFit = function (cx, cy) {
    var hits = rayFrom(this, cx, cy).intersectObjects(this.fits.map(function (f) { return f.mesh; }), false);
    if (!hits.length) return null;
    var m = hits[0].object;
    return this.fits.filter(function (f) { return f.mesh === m; })[0] || null;
  };
  Viewer.prototype.addFit = function (spec, opts) {
    var V = this, T = THREE;
    opts = opts || {};
    var unit = new T.BoxGeometry(1, 1, 1);
    unit.translate(0, 0.5, 0);  /* sits on the floor */
    var mesh = new T.Mesh(unit, new T.MeshBasicMaterial({ color: FIT_OK, transparent: true, opacity: 0.26, depthWrite: false, side: T.DoubleSide }));
    var edges = new T.LineSegments(new T.EdgesGeometry(unit), new T.LineBasicMaterial({ color: FIT_OK }));
    mesh.renderOrder = 6; edges.renderOrder = 7;
    var group = new T.Group(); group.add(mesh); group.add(edges);
    var x = spec.x, z = spec.z;
    if (x == null || z == null) {  /* a new box: on the floor in the middle of the view, else the middle of the room */
      var r = V.renderer.domElement.getBoundingClientRect(), c = V.box.getCenter(new T.Vector3());
      var p = V._floorPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!p || p.x < V.box.min.x || p.x > V.box.max.x || p.z < V.box.min.z || p.z > V.box.max.z) p = c;
      x = p.x; z = p.z;
    }
    group.position.set(x, V.floorY(), z);
    group.rotation.y = (spec.a || 0) * Math.PI / 180;
    V.fitGroup.add(group);
    var label = document.createElement('div');
    V.overlay.appendChild(label);
    var f = { spec: { label: String(spec.label || 'Box').slice(0, 40), w: +spec.w, d: +spec.d, h: +spec.h }, group: group, mesh: mesh,
              edges: edges, label: label, kept: !!spec.kept, clear: true, gaps: {}, gapLines: null, gapLabels: [] };
    label.addEventListener('click', function (e) { e.stopPropagation(); V.selectFit(f); });
    V.fits.push(f);
    V._sizeFit(f);
    V.checkFit(f);
    if (opts.select !== false) V.selectFit(f);
    V.needs = true;
    return f;
  };
  Viewer.prototype._sizeFit = function (f) {
    var k = this.k;
    [f.mesh, f.edges].forEach(function (o) { o.scale.set(f.spec.w / k, f.spec.h / k, f.spec.d / k); });
    this.needs = true;
  };
  Viewer.prototype._fitLabel = function (f) {
    f.label.className = 'ls-fit ' + (f.clear ? 'ok' : 'bad') + (f === this.sel ? ' sel' : '');
    f.label.innerHTML = '<b>' + UI.esc(f.spec.label) + '</b><span>' + UI.esc(LS.fmtBox(f.spec.w, f.spec.d)) + '</span>';
  };
  Viewer.prototype.checkFit = function (f) {
    var V = this, l = V.layers && (V.layers.points || V.layers.surface);
    if (!l) return;
    var k = V.k, hw = f.spec.w / k / 2, hd = f.spec.d / k / 2, y0 = V.floorY(), lo = y0 + 0.04 / k, hi = y0 + f.spec.h / k;
    var m = 0.02 / k, reach = 4 / k, th = f.group.rotation.y, c = Math.cos(th), s = Math.sin(th);
    var cx = f.group.position.x, cz = f.group.position.z;
    var p = l.geom.attributes.position.array, n = l.geom.attributes.position.count, step = n > 300000 ? Math.ceil(n / 300000) : 1;
    var inside = 0, seen = 0, best = { '+x': [], '-x': [], '+z': [], '-z': [] };
    for (var i = 0; i < n; i += step) {
      seen++;
      var y = p[i * 3 + 1];
      if (y < lo || y > hi) continue;
      var dx = p[i * 3] - cx, dz = p[i * 3 + 2] - cz, lx = dx * c - dz * s, lz = dx * s + dz * c, ax = Math.abs(lx), az = Math.abs(lz);
      if (ax < hw - m && az < hd - m) { inside++; continue; }
      if (az < hd - m && ax < hw + reach) push3(best[lx > 0 ? '+x' : '-x'], ax - hw);
      else if (ax < hw - m && az < hd + reach) push3(best[lz > 0 ? '+z' : '-z'], az - hd);
    }
    f.inside = inside;
    f.clear = inside < Math.max(12, seen * 0.0004);  /* a few stray points don't count; a wall or a table does */
    f.gaps = {};
    Object.keys(best).forEach(function (key) { var a = best[key]; if (a.length >= 3) f.gaps[key] = Math.max(0, a[2]); });
    var col = f.clear ? FIT_OK : FIT_BAD;
    f.mesh.material.color.setHex(col); f.edges.material.color.setHex(col);
    V._fitLabel(f);
    if (V.sel === f) V._drawGaps(f);
    V.needs = true;
  };
  Viewer.prototype._drawGaps = function (f) {
    var V = this, T = THREE;
    V.fits.forEach(function (o) {
      if (o.gapLines) { o.group.remove(o.gapLines); o.gapLines.geometry.dispose(); o.gapLines = null; }
      o.gapLabels.forEach(function (g) { g.el.remove(); }); o.gapLabels = [];
    });
    if (!f) return;
    var k = V.k, hw = f.spec.w / k / 2, hd = f.spec.d / k / 2, y = 0.02 / k, pts = [];
    [['+x', 1, 0, hw], ['-x', -1, 0, hw], ['+z', 0, 1, hd], ['-z', 0, -1, hd]].forEach(function (sd) {
      var g = f.gaps[sd[0]];
      if (g == null) return;
      var a = new T.Vector3(sd[1] * sd[3], y, sd[2] * sd[3]), b = new T.Vector3(sd[1] * (sd[3] + g), y, sd[2] * (sd[3] + g));
      if (g * k >= 0.01) pts.push(a, b);
      var el = document.createElement('div');
      el.className = 'ls-gap' + (g * k < 0.01 ? ' zero' : '');
      el.textContent = g * k < 0.01 ? 'touching' : LS.fmtLen(g * k);
      V.overlay.appendChild(el);
      f.gapLabels.push({ el: el, p: a.clone().add(b).multiplyScalar(0.5) });
    });
    if (pts.length) {
      f.gapLines = new T.LineSegments(new T.BufferGeometry().setFromPoints(pts),
        new T.LineDashedMaterial({ color: 0xf4d35e, dashSize: 0.05 / k, gapSize: 0.035 / k, depthTest: false }));
      f.gapLines.computeLineDistances(); f.gapLines.renderOrder = 8;
      f.group.add(f.gapLines);
    }
    V.needs = true;
  };
  Viewer.prototype.selectFit = function (f) {
    var V = this;
    V.sel = f || null;
    V.fits.forEach(function (o) { V._fitLabel(o); });
    V._drawGaps(V.sel);
    if (V.onFitSelect) V.onFitSelect(V.sel);
  };
  Viewer.prototype.rotateFit = function (f, deg) {
    f.group.rotation.y = ((f.group.rotation.y + deg * Math.PI / 180) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    this.checkFit(f);
    this._fitChanged(f, true);
  };
  Viewer.prototype.removeFit = function (f) {
    var V = this;
    V.fitGroup.remove(f.group);
    f.label.remove(); f.gapLabels.forEach(function (g) { g.el.remove(); });
    V.fits = V.fits.filter(function (o) { return o !== f; });
    if (V.sel === f) V.selectFit(null);
    V.needs = true;
  };
  Viewer.prototype._fitChanged = function (f, final) { if (this.onFitChange) this.onFitChange(f, final); };
  Viewer.prototype.fitSpec = function (f) {
    var deg = Math.round(f.group.rotation.y * 180 / Math.PI * 10) / 10;
    return { label: f.spec.label, w: f.spec.w, d: f.spec.d, h: f.spec.h, x: Math.round(f.group.position.x * 10000) / 10000,
             z: Math.round(f.group.position.z * 10000) / 10000, a: ((deg % 360) + 360) % 360, kept: f.kept, clear: f.clear };
  };
  Viewer.prototype.getFits = function (keptOnly) {
    var V = this;
    return V.fits.filter(function (f) { return !keptOnly || f.kept; }).map(function (f) { return V.fitSpec(f); });
  };
  Viewer.prototype.setFits = function (list) {
    var V = this;
    V.fits.slice().forEach(function (f) { V.removeFit(f); });
    (list || []).forEach(function (s) { V.addFit(Object.assign({}, s, { kept: true }), { select: false }); });
  };

  /* --------------------------------------------------- pins (annotations) */
  Viewer.prototype.setPins = function (list, onClick) {
    var V = this;
    V.pins.forEach(function (p) { p.el.remove(); });
    V.pins = (list || []).map(function (a, i) {
      var el = document.createElement('div');
      el.className = 'ls-pin ' + (a.color || 'brand');
      el.innerHTML = '<b>' + UI.esc(a.label) + (a.note ? '<small>' + UI.esc(a.note) + '</small>' : '') + '</b><i></i>';
      el.addEventListener('click', function (e) { e.stopPropagation(); el.classList.toggle('open'); if (onClick) onClick(i, a); });
      V.overlay.appendChild(el);
      return { el: el, p: new THREE.Vector3(a.p[0], a.p[1], a.p[2]) };
    });
    V.needs = true;
  };
  Viewer.prototype.showPins = function (on) { this.pinsHidden = !on; this.needs = true; };

  Viewer.prototype._place = function () {
    var V = this, w = V.el.clientWidth, h = V.el.clientHeight, cam = V.active, v = new THREE.Vector3();
    var clipY = V.clip.constant;
    V.pins.forEach(function (p) {
      v.copy(p.p).project(cam);
      var hide = V.pinsHidden || v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1 || p.p.y > clipY;
      p.el.style.display = hide ? 'none' : '';
      if (!hide) p.el.style.transform = 'translate(' + ((v.x + 1) / 2 * w) + 'px,' + ((1 - v.y) / 2 * h) + 'px) translate(-50%,-100%)';
    });
    function at(el, p, hideOff) {
      v.copy(p).project(cam);
      var hide = v.z > 1 || (hideOff && (Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2));
      el.style.display = hide ? 'none' : '';
      if (!hide) el.style.transform = 'translate(' + ((v.x + 1) / 2 * w) + 'px,' + ((1 - v.y) / 2 * h) + 'px) translate(-50%,-50%)';
    }
    V.measures.forEach(function (m) { at(m.label, m.mid); });
    V.saved.forEach(function (m) { at(m.label, m.mid); });
    var top = new THREE.Vector3();
    V.fits.forEach(function (f) {
      f.group.updateMatrixWorld();
      top.set(0, f.mesh.scale.y + 0.05, 0); f.group.localToWorld(top);
      at(f.label, top, true);
      f.gapLabels.forEach(function (g) { at(g.el, f.group.localToWorld(g.p.clone()), true); });
    });
    if (V.scaleEl && V.state.mode === 'plan') {
      var realPerPx = (V.ortho.right - V.ortho.left) / V.ortho.zoom / w * V.k, ft = LS.units === 'ft';
      var steps = ft ? [0.5, 1, 2, 5, 10, 20, 50].map(function (x) { return x * 0.3048; }) : [0.1, 0.25, 0.5, 1, 2, 5, 10, 20];
      var nice = steps.filter(function (x) { return x / realPerPx < 140; }).pop() || steps[0];
      V.scaleEl.innerHTML = '<i style="width:' + Math.round(nice / realPerPx) + 'px"></i>' + LS.fmtLen(nice);
    }
  };

  /* --------------------------------------------------- replay the capture walk */
  Viewer.prototype.setPath = function (path) {
    var V = this, T = THREE;
    V.opts.path = path || [];
    if (V.pathLine) { V.helpers.remove(V.pathLine); V.pathLine = null; }
    if (!path || path.length < 2) return;
    var pts = path.map(function (e) { return new T.Vector3(e[0], e[1], e[2]); });
    V.curve = new T.CatmullRomCurve3(pts, false, 'centripetal');
    var g = new T.BufferGeometry().setFromPoints(V.curve.getPoints(Math.min(600, pts.length * 4)));
    V.pathLine = new T.Line(g, new T.LineDashedMaterial({ color: 0xe07a52, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.9 }));
    V.pathLine.computeLineDistances();
    V.pathLine.visible = !!V.showPath;
    V.helpers.add(V.pathLine);
    var len = 0; for (var i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    V.pathLength = len;
    V.needs = true;
  };
  Viewer.prototype.setShowPath = function (on) { this.showPath = on; if (this.pathLine) this.pathLine.visible = on; this.needs = true; };

  Viewer.prototype.startReplay = function (onTick) {
    var V = this, path = V.opts.path;
    if (!path || path.length < 2) return false;
    if (V.state.mode !== 'orbit') { V.state.mode = 'orbit'; V.active = V.camera; V.orthoControls.enabled = false; V._joy(false); V._scale(false); }
    V.controls.enabled = false;
    V.replay = { t: V.replay && V.replay.t < 0.999 ? V.replay.t : 0, playing: true, speed: 1, onTick: onTick,
                 duration: Math.max(12, Math.min(90, (V.pathLength || 5) / 0.45)) };
    V.camera.near = 0.02; V.camera.updateProjectionMatrix();
    V.setCut(V.state.cut);
    V.clip.constant = 1e6;
    V.setPointSize(V.state.size);
    return true;
  };
  Viewer.prototype.pauseReplay = function () { if (this.replay) this.replay.playing = false; };
  Viewer.prototype.resumeReplay = function () { if (this.replay) this.replay.playing = true; };
  Viewer.prototype.seekReplay = function (t) { if (this.replay) { this.replay.t = Math.max(0, Math.min(1, t)); this._replayPose(); } };
  Viewer.prototype.stopReplay = function () {
    if (!this.replay) return;
    this.replay = null; this.controls.enabled = this.state.mode === 'orbit';
    this.setPointSize(this.state.size);
    if (this.state.mode === 'orbit') this.fit();
    this.setCut(this.state.cut);
  };
  Viewer.prototype._replayPose = function () {
    var V = this, T = THREE, r = V.replay, path = V.opts.path;
    var t = r.t, p = V.curve.getPoint(t);
    var fi = t * (path.length - 1), i = Math.floor(fi), k = fi - i, a = path[i], b = path[Math.min(i + 1, path.length - 1)];
    var d = new T.Vector3(a[3] + (b[3] - a[3]) * k, a[4] + (b[4] - a[4]) * k, a[5] + (b[5] - a[5]) * k).normalize();
    V.camera.position.copy(p);
    V.camera.up.set(0, 1, 0);
    V.camera.lookAt(p.clone().add(d));
    V.needs = true;
    if (r.onTick) r.onTick(t, (k < 0.5 ? a : b)[6]);
  };

  /* --------------------------------------------------- render loop */
  Viewer.prototype._loop = function () {
    var V = this;
    if (!V.alive) return;
    requestAnimationFrame(function () { V._loop(); });
    var dt = Math.min(V.clock.getDelta(), 0.1);
    if (V.state.mode === 'orbit' && !V.replay) V.controls.update();
    if (V.state.mode === 'plan') V.orthoControls.update();
    if (V.state.mode === 'walk') {
      var k = V.keys, f = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0), s = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
      if (V.walk.move[0] || V.walk.move[1]) { f = -V.walk.move[1]; s = V.walk.move[0]; }
      if (k.q) { V.walk.yaw += dt * 1.6; V._applyLook(); }
      if (k.e) { V.walk.yaw -= dt * 1.6; V._applyLook(); }
      if (f || s) {
        var sp = (k.shift ? 2.6 : 1.25) * dt, yaw = V.walk.yaw;
        V.camera.position.x += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * sp;
        V.camera.position.z += (-Math.cos(yaw) * f - Math.sin(yaw) * s) * sp;
        V.needs = true;
      }
    }
    if (V.replay && V.replay.playing && V.curve) {
      V.replay.t += dt * V.replay.speed / V.replay.duration;
      if (V.replay.t >= 1) { V.replay.t = 1; V.replay.playing = false; if (V.replay.onTick) V.replay.onTick(1, null, true); }
      V._replayPose();
    }
    if (V.needs || (V.controls.enabled && V.controls.enableDamping)) {
      V.renderer.render(V.scene, V.active);
      V._place();
      V.needs = false;
    }
  };

  Viewer.prototype.render = function () { this.renderer.render(this.scene, this.active); this._place(); };

  /* A picture of the current view (or the standard 3/4 view for thumbnails) */
  Viewer.prototype.snapshot = function (w, h, standard, type) {
    var V = this, T = THREE;
    var oldSize = V.renderer.getSize(new T.Vector2()), oldPR = V.renderer.getPixelRatio();
    var saved = standard ? { pos: V.camera.position.clone(), q: V.camera.quaternion.clone(), tgt: V.controls.target.clone(), mode: V.state.mode, cut: V.state.cut } : null;
    if (standard) {
      V.active = V.camera; V.state.mode = 'orbit';
      V.fit(); V.clip.constant = V.box.min.y + V.height * 0.6;
      V.grid.visible = false; if (V.pathLine) V.pathLine.visible = false;
    }
    V.renderer.setPixelRatio(1); V.renderer.setSize(w, h, false);
    V.camera.aspect = w / h; V.camera.updateProjectionMatrix();
    V.renderer.render(V.scene, V.active);
    var url = V.renderer.domElement.toDataURL(type || 'image/jpeg', 0.84);
    V.renderer.setPixelRatio(oldPR); V.renderer.setSize(oldSize.x, oldSize.y, false);
    if (standard) {
      V.grid.visible = true; if (V.pathLine) V.pathLine.visible = !!V.showPath;
      V.state.mode = saved.mode; V.camera.position.copy(saved.pos); V.camera.quaternion.copy(saved.q); V.controls.target.copy(saved.tgt);
      V.active = saved.mode === 'plan' ? V.ortho : V.camera;
      V.setCut(saved.cut);
    }
    V.resize();
    return url;
  };

  Viewer.prototype.dispose = function () {
    var V = this;
    V.alive = false;
    if (V._unsubUnits) V._unsubUnits();
    V.fits.forEach(function (f) { f.label.remove(); f.gapLabels.forEach(function (g) { g.el.remove(); }); });
    window.removeEventListener('keydown', V._kd); window.removeEventListener('keyup', V._ku);
    if (V.ro) V.ro.disconnect(); else window.removeEventListener('resize', V._resize);
    V.controls.dispose(); V.orthoControls.dispose();
    V.scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    V.renderer.dispose();
    try { V.renderer.forceContextLoss(); } catch (e) {}
  };

  /* Loading screen inside a view element */
  LS.loading = function (el, text) {
    var box = document.createElement('div'); box.className = 'ls-load';
    box.innerHTML = '<div><img class="ls-load-ic" src="_/theme/icon.svg" alt=""><div class="bar"><i></i></div><small>' + UI.esc(text || 'Loading the room') + '</small></div>';
    el.appendChild(box);
    var bar = box.querySelector('.bar i'), small = box.querySelector('small');
    return {
      progress: function (got, total) {
        bar.style.width = total ? Math.round(got / total * 100) + '%' : Math.min(92, 8 + got / 30000) + '%';
        small.textContent = (got / 1048576).toFixed(1) + ' MB' + (total ? ' of ' + (total / 1048576).toFixed(1) + ' MB' : '');
      },
      text: function (t) { small.textContent = t; },
      error: function (msg) { box.innerHTML = '<div><p style="margin:0 0 6px;font-weight:600">' + UI.esc(msg) + '</p><small>' + UI.esc('Try reloading the page.') + '</small></div>'; },
      done: function () { box.remove(); }
    };
  };

  /* Open a scan's model in a view element: loads three.js + the PLY files, returns the viewer. */
  LS.open = function (el, scan, opts) {
    opts = opts || {};
    if (!LS.webgl()) {
      el.classList.add('ls-view');
      LS.loading(el).error('This browser can\'t show 3D (WebGL is off).');
      return Promise.reject(new Error('no webgl'));
    }
    var load = LS.loading(el, 'Loading the room');
    var m = scan.model || {};
    return LS.loadThree().then(function () {
      var jobs = [m.cloud ? LS.fetchBuffer(m.cloud, load.progress).then(LS.parsePLY) : Promise.resolve(null)];
      jobs.push(m.mesh && opts.mesh !== false ? LS.fetchBuffer(m.mesh).then(LS.parsePLY).catch(function () { return null; }) : Promise.resolve(null));
      return Promise.all(jobs);
    }).then(function (g) {
      var v = new LS.Viewer(el, { path: scan.path, background: cssVar('--c-stage', '#2a231e') });
      v.setModel(g[0], g[1]);
      v.setPath(scan.path || []);
      if (scan.annotations) v.setPins(scan.annotations, opts.onPin);
      if (opts.extras !== false) {   /* Studio passes extras: false (it bakes the fix into the points) */
        v.setScale(scan.scale_k || 1);
        v.setMeasures(scan.measures || []);
        v.setFits(scan.fits || []);
      }
      v.fit();
      load.done();
      return v;
    }, function (e) { load.error(e.message || 'Couldn\'t load this room.'); throw e; });
  };

  /* ================================================================== the standard control bar */
  LS.controls = function (host, v, scan, opts) {
    opts = opts || {};
    var esc = UI.esc, ic = UI.icon, hasPath = (scan.path || []).length > 1, hasMesh = !!(v.layers && v.layers.surface);
    host.innerHTML = '<div class="ls-bar">' +
      '<div class="ui-seg" role="group" aria-label="View">' +
      '<button data-mode="orbit" class="on" title="Orbit around the room">' + ic('cube') + '<span class="lbl">Orbit</span></button>' +
      '<button data-mode="walk" title="Walk through at eye height">' + ic('walk') + '<span class="lbl">Walk</span></button>' +
      '<button data-mode="plan" title="Floor plan from above">' + ic('plan') + '<span class="lbl">Plan</span></button></div>' +
      (hasPath ? '<button class="ui-btn sm" data-replay title="Replay the walk the phone took">' + ic('play') + '<span class="lbl">Replay</span></button>' : '') +
      '<button class="ui-btn sm" data-measure title="Measure a distance">' + ic('ruler') + '<span class="lbl">Measure</span></button>' +
      (opts.onFit ? '<button class="ui-btn sm" data-fit title="Will it fit? Try a furniture box">' + ic('box') + '<span class="lbl">Fit</span></button>' : '') +
      '<span class="grow"></span>' +
      '<div class="ls-more"><button class="ui-btn sm" data-more aria-haspopup="true" title="Display settings">' + ic('sliders') + '<span class="lbl">Display</span></button></div>' +
      '<button class="ui-btn sm icon" data-shot title="Save a picture">' + ic('image') + '</button>' +
      '<button class="ui-btn sm icon" data-full title="Full screen">' + ic('expand') + '</button>' +
      '</div><div data-replaybox></div><div data-mbox></div><div data-fitbox></div>';
    var bar = host.querySelector('.ls-bar'), rbox = host.querySelector('[data-replaybox]'), pip = null;
    var mbox = host.querySelector('[data-mbox]'), fbox = host.querySelector('[data-fitbox]'), last = null, saveT = null;

    /* ---- the measure bar: "2.14 m · Save · It's really…" after two taps */
    function mlen() { return last ? LS.fmtLen(last.raw * v.k) : ''; }
    function measureBar() {
      if (!last) { mbox.innerHTML = ''; return; }
      mbox.innerHTML = '<div class="ls-mbar" role="status"><span class="ls-mlen" data-mlen>' + esc(mlen()) + '</span><span class="grow"></span>' +
        (opts.onMeasured ? '<button class="ui-btn sm" data-msave>' + ic('save') + 'Save</button>' +
          '<button class="ui-btn sm" data-mfix title="Tell us the real length: every size follows">' + ic('ruler') + 'It\'s really…</button>' : '') +
        '<button class="ui-btn sm icon ghost" data-mx aria-label="Clear the measurement">' + ic('x') + '</button></div>';
    }
    function clearMeasureBar() { last = null; mbox.innerHTML = ''; }
    v.onMeasure = function (a, b, raw) { last = { a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], raw: raw }; measureBar(); };
    v.onRelabel = function () {
      var el = mbox.querySelector('[data-mlen]'); if (el) el.textContent = mlen();
      if (v.sel) drawFitBar(v.sel);
    };
    mbox.addEventListener('click', function (e) {
      if (e.target.closest('[data-mx]')) { v.clearMeasures(); clearMeasureBar(); return; }
      if (e.target.closest('[data-mcancel]')) { measureBar(); return; }
      if (e.target.closest('[data-mfix]') && last) { opts.onMeasured('fix', JSON.stringify(last)); return; }
      if (e.target.closest('[data-msave]') && last) {
        mbox.innerHTML = '<form class="ls-mbar" data-mform><span class="ls-mlen" data-mlen>' + esc(mlen()) + '</span>' +
          '<input type="text" maxlength="60" placeholder="What is it? e.g. Sofa wall" aria-label="Name this measurement">' +
          '<button class="ui-btn sm primary" type="submit">' + ic('check') + 'Keep</button>' +
          '<button type="button" class="ui-btn sm ghost" data-mcancel>Cancel</button></form>';
        var inp = mbox.querySelector('input');
        setTimeout(function () { inp.focus(); }, 30);
      }
    });
    mbox.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!last) return;
      var inp = mbox.querySelector('input');
      var m = { a: last.a, b: last.b, label: ((inp && inp.value) || '').trim().slice(0, 60) };
      v.clearMeasures(); clearMeasureBar();
      opts.onMeasured('save', JSON.stringify(m));
    });

    /* ---- the fit bar: the chosen furniture box (turn, keep, remove) */
    function saveFits() {
      if (!opts.onFits) return;
      clearTimeout(saveT);
      saveT = setTimeout(function () { opts.onFits(JSON.stringify(v.getFits(true))); }, 400);
    }
    function drawFitBar(f) {
      if (!f) { fbox.innerHTML = ''; return; }
      fbox.innerHTML = '<div class="ls-fbar ' + (f.clear ? 'ok' : 'bad') + '" role="status">' +
        '<span class="ls-fstate">' + (f.clear ? ic('check') + 'Fits here' : ic('info') + 'Touches something') + '</span>' +
        '<span class="ls-fname"><b>' + esc(f.spec.label) + '</b> <span>' + esc(LS.fmtBox(f.spec.w, f.spec.d, f.spec.h)) + '</span></span>' +
        '<span class="grow"></span>' +
        '<button class="ui-btn sm icon" data-frot="-15" aria-label="Turn 15° to the left" title="Turn 15° to the left"><span class="ls-flip">' + ic('rotate') + '</span></button>' +
        '<button class="ui-btn sm icon" data-frot="15" aria-label="Turn 15° to the right" title="Turn 15° to the right">' + ic('rotate') + '</button>' +
        (f.kept ? '<span class="ls-fkept">' + ic('check') + 'Kept</span>'
          : opts.onFits ? '<button class="ui-btn sm primary" data-fkeep>' + ic('check') + 'Keep it</button>'
          : '<span class="ls-fhint">' + esc(opts.keepHint || 'Copy to my rooms to keep it') + '</span>') +
        '<button class="ui-btn sm icon ghost" data-fdel aria-label="Remove this box" title="Remove this box">' + ic('trash') + '</button>' +
        '<button class="ui-btn sm ghost" data-fdone>Done</button></div>';
    }
    v.onFitSelect = drawFitBar;
    v.onFitChange = function (f, final) { if (f === v.sel) drawFitBar(f); if (final && f.kept) saveFits(); };
    fbox.addEventListener('click', function (e) {
      var f = v.sel;
      if (!f) return;
      var rot = e.target.closest('[data-frot]');
      if (rot) { v.rotateFit(f, +rot.getAttribute('data-frot')); return; }
      if (e.target.closest('[data-fkeep]')) { f.kept = true; drawFitBar(f); saveFits(); UI.toast('Kept. It shows on the share link and the floor plan.', 'ok'); return; }
      if (e.target.closest('[data-fdel]')) { var was = f.kept; v.removeFit(f); if (was) saveFits(); return; }
      if (e.target.closest('[data-fdone]')) v.selectFit(null);
    });

    function setOn(sel, on) { var b = host.querySelector(sel); if (b) b.classList.toggle('on', on); }
    function pop() {
      var old = host.querySelector('.ls-pop'); if (old) { old.remove(); return; }
      var p = document.createElement('div'); p.className = 'ls-pop';
      p.innerHTML = '<label>Units<div class="ui-seg" role="group" aria-label="Units"><button data-units="m">m</button><button data-units="ft">ft·in</button></div></label>' +
        (hasMesh ? '<label>Show<div class="ui-seg"><button data-disp="points">Points</button><button data-disp="surface">Surface</button></div></label>' : '') +
        '<label>Colours<div class="ui-seg"><button data-col="photo">Photo</button><button data-col="height">Height</button><button data-col="clay">Clay</button></div></label>' +
        '<label>Point size<input type="range" min="0.4" max="3" step="0.1" value="' + v.state.size + '" data-size></label>' +
        '<label class="ui-check" style="display:flex;color:var(--c-ink)"><input type="checkbox" data-cut' + (v.state.cut ? ' checked' : '') + '> Dollhouse (hide the ceiling)</label>' +
        (hasPath ? '<label class="ui-check" style="display:flex;color:var(--c-ink)"><input type="checkbox" data-path' + (v.showPath ? ' checked' : '') + '> Show the walk path</label>' : '') +
        ((scan.annotations || []).length ? '<label class="ui-check" style="display:flex;color:var(--c-ink)"><input type="checkbox" data-pins' + (v.pinsHidden ? '' : ' checked') + '> Show pins</label>' : '');
      host.querySelector('.ls-more').appendChild(p);
      mark();
      p.addEventListener('click', function (e) {
        var d = e.target.closest('[data-disp]'), c = e.target.closest('[data-col]'), un = e.target.closest('[data-units]');
        if (un) { LS.setUnits(un.getAttribute('data-units')); mark(); }
        if (d) { v.setDisplay(d.getAttribute('data-disp')); mark(); }
        if (c) { v.setColor(c.getAttribute('data-col')); mark(); }
      });
      p.addEventListener('input', function (e) { if (e.target.matches('[data-size]')) v.setPointSize(+e.target.value); });
      p.addEventListener('change', function (e) {
        if (e.target.matches('[data-cut]')) v.setCut(e.target.checked);
        if (e.target.matches('[data-path]')) v.setShowPath(e.target.checked);
        if (e.target.matches('[data-pins]')) v.showPins(e.target.checked);
      });
      function mark() {
        p.querySelectorAll('[data-disp]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-disp') === v.state.display); });
        p.querySelectorAll('[data-col]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-col') === v.state.color); });
        p.querySelectorAll('[data-units]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-units') === LS.units); });
      }
    }
    function endReplay() {
      v.stopReplay(); rbox.innerHTML = ''; setOn('[data-replay]', false);
      if (pip) { pip.remove(); pip = null; }
    }
    function replay() {
      if (v.replay) { endReplay(); return; }
      host.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === 'orbit'); });
      v.setMeasuring(false); setOn('[data-measure]', false);
      setOn('[data-replay]', true);
      rbox.innerHTML = '<div class="ls-replay"><button class="ui-btn sm icon" data-rp>' + ic('pause') + '</button>' +
        '<input type="range" min="0" max="1000" value="0" data-rt aria-label="Replay position"><span class="mono" data-rl>0:00</span>' +
        '<div class="ui-seg"><button data-sp="0.5">½×</button><button data-sp="1" class="on">1×</button><button data-sp="2">2×</button></div>' +
        '<button class="ui-btn sm icon ghost" data-rx aria-label="Stop the replay">' + ic('x') + '</button></div>';
      if (scan.frames_url && opts.pip !== false) {
        pip = document.createElement('div'); pip.className = 'ls-pip'; pip.innerHTML = '<img alt=""><span></span>'; v.el.appendChild(pip);
      }
      var rt = rbox.querySelector('[data-rt]'), rl = rbox.querySelector('[data-rl]'), lastFrame = -1;
      v.startReplay(function (t, frame, ended) {
        rt.value = Math.round(t * 1000);
        var s = Math.round(t * v.replay.duration); rl.textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
        if (pip && frame != null && frame !== lastFrame) {
          lastFrame = frame; var img = pip.querySelector('img'); img.src = scan.frames_url + '&i=' + frame;
          pip.querySelector('span').textContent = 'frame ' + (frame + 1);
        }
        if (ended) rbox.querySelector('[data-rp]').innerHTML = ic('play');
      });
      rbox.addEventListener('click', function (e) {
        if (e.target.closest('[data-rx]')) { endReplay(); return; }
        var sp = e.target.closest('[data-sp]');
        if (sp) { v.replay.speed = +sp.getAttribute('data-sp'); rbox.querySelectorAll('[data-sp]').forEach(function (b) { b.classList.toggle('on', b === sp); }); }
        if (e.target.closest('[data-rp]')) {
          if (v.replay.playing) { v.pauseReplay(); e.target.closest('[data-rp]').innerHTML = ic('play'); }
          else { if (v.replay.t >= 1) v.replay.t = 0; v.resumeReplay(); e.target.closest('[data-rp]').innerHTML = ic('pause'); }
        }
      });
      rt.addEventListener('input', function () { v.pauseReplay(); rbox.querySelector('[data-rp]').innerHTML = ic('play'); v.seekReplay(rt.value / 1000); });
    }
    bar.addEventListener('click', function (e) {
      var m = e.target.closest('[data-mode]');
      if (m) {
        if (v.replay) endReplay();
        host.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b === m); });
        v.setMode(m.getAttribute('data-mode'));
        return;
      }
      if (e.target.closest('[data-replay]')) { replay(); return; }
      if (e.target.closest('[data-measure]')) {
        var on = !v.state.measuring; v.setMeasuring(on); setOn('[data-measure]', on);
        if (!on) { v.clearMeasures(); clearMeasureBar(); }
        return;
      }
      if (e.target.closest('[data-fit]')) { if (v.state.measuring) { v.setMeasuring(false); setOn('[data-measure]', false); } opts.onFit(); return; }
      if (e.target.closest('[data-more]')) { pop(); return; }
      if (e.target.closest('[data-shot]')) {
        var a = document.createElement('a'); a.href = v.snapshot(1600, 1000, false); a.download = (scan.title || 'room').replace(/[^\w\- ]+/g, '') + '.jpg'; a.click();
        UI.toast('Picture saved', 'ok');
        return;
      }
      if (e.target.closest('[data-full]')) {
        var el = v.el;
        if (document.fullscreenElement) { document.exitFullscreen(); return; }
        if (el.classList.contains('full')) { el.classList.remove('full'); v.resize(); return; }
        if (el.requestFullscreen) el.requestFullscreen().catch(function () { el.classList.add('full'); v.resize(); });
        else { el.classList.add('full'); v.resize(); }
      }
    });
    document.addEventListener('click', function close(e) {
      if (!host.isConnected) { document.removeEventListener('click', close); return; }
      var p = host.querySelector('.ls-pop');
      if (p && !e.target.closest('.ls-more')) p.remove();
    });
    if (opts.autoReplay && hasPath) setTimeout(replay, 300);
    return { endReplay: endReplay, drawFitBar: drawFitBar, measuring: function (on) { v.setMeasuring(on); setOn('[data-measure]', on); if (!on) { v.clearMeasures(); clearMeasureBar(); } } };
  };
})();
