/* ls-screens.js: the two editor engines, moved unchanged from the old pages: capture (camera walk with the sharp-frame Keeper, video frames, PLY/GLB import, uploads) and studio (the desktop 3D editor with undo, tools and versions). Components/Screen mounts them (UI.mountScreen in ls-kit.js). */
(function () {
  var esc = UI.esc;
  var FPS = 3, MAX_FRAMES = 360, LONG = 640, BATCH = 6;
  var QUALITY = [['fast', 'Fast', 'Quick preview, about a minute'], ['balanced', 'Balanced', 'Best for most rooms'], ['detailed', 'Detailed', 'Finer points, takes longer']];

  function rooms(sel) {
    return '<div class="cp-rooms">' + Object.keys(LS.ROOMS).map(function (k) {
      return '<label><input type="radio" name="room" value="' + k + '"' + (k === (sel || 'living') ? ' checked' : '') + '><span>' + esc(LS.ROOMS[k]) + '</span></label>';
    }).join('') + '</div>';
  }

  /* ---------------------------------------------------------- frame analysis */
  var small = document.createElement('canvas'); small.width = 96; small.height = 72;
  var sctx = small.getContext('2d', { willReadFrequently: true });
  function analyse(src) {
    sctx.drawImage(src, 0, 0, 96, 72);
    var d = sctx.getImageData(0, 0, 96, 72).data, g = new Float32Array(96 * 72);
    for (var i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    var sum = 0, sum2 = 0, n = 0;
    for (var y = 1; y < 71; y++) for (var x = 1; x < 95; x++) {
      var k = y * 96 + x, lap = 4 * g[k] - g[k - 1] - g[k + 1] - g[k - 96] - g[k + 96];
      sum += lap; sum2 += lap * lap; n++;
    }
    var mean = sum / n, bright = 0;
    for (var j = 0; j < g.length; j += 7) bright += g[j];
    return { sharp: sum2 / n - mean * mean, gray: g, bright: bright / (g.length / 7) };
  }
  function diff(a, b) {
    if (!a || !b) return 999;
    var s = 0; for (var i = 0; i < a.length; i += 3) s += Math.abs(a[i] - b[i]);
    return s / (a.length / 3);
  }
  function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b.length ? b[Math.floor(b.length / 2)] : 0; }

  /* A frame keeper: decides which frames to keep (sharp, and moved since the last one) */
  function Keeper() {
    this.frames = []; this.blurry = 0; this.still = 0; this.sharps = []; this.last = null; this.lastT = 0; this.w = 0; this.h = 0;
    this.canvas = document.createElement('canvas');
  }
  Keeper.prototype.offer = function (src, w, h, t) {
    var a = analyse(src), self = this;
    self.sharps.push(a.sharp); if (self.sharps.length > 15) self.sharps.shift();
    var level = median(self.sharps), ok = a.sharp >= Math.max(level * 0.45, 4);
    var verdict = { sharp: Math.min(1, a.sharp / Math.max(level * 1.4, 1)), dark: a.bright < 28 };
    if (!ok) { self.blurry++; verdict.skip = 'blur'; return verdict; }
    if (diff(a.gray, self.last) < 2.2 && t - self.lastT < 2000) { self.still++; verdict.skip = 'still'; return verdict; }
    var s = LONG / Math.max(w, h), cw = Math.round(w * s), ch = Math.round(h * s);
    self.canvas.width = cw; self.canvas.height = ch; self.w = cw; self.h = ch;
    self.canvas.getContext('2d').drawImage(src, 0, 0, cw, ch);
    self.frames.push(self.canvas.toDataURL('image/jpeg', 0.82));
    self.last = a.gray; self.lastT = t;
    verdict.kept = true;
    return verdict;
  };

  /* A moving test picture instead of the camera (?fakecam=1), for the automated tests */
  function fakeStream() {
    var c = document.createElement('canvas'); c.width = 640; c.height = 480;
    var x = c.getContext('2d'), t0 = performance.now();
    (function draw() {
      if (!c.isConnected && c._stop) return;
      var t = (performance.now() - t0) / 1000;
      x.fillStyle = '#efe6d8'; x.fillRect(0, 0, 640, 480);
      for (var i = 0; i < 26; i++) {
        var px = ((i * 97 + t * 120) % 900) - 130, py = (i * 53) % 420;
        x.fillStyle = ['#c2522b', '#4f7f6a', '#2a231e', '#d9a43c'][i % 4]; x.fillRect(px, py, 40 + (i % 5) * 18, 30 + (i % 3) * 22);
      }
      x.fillStyle = '#2a231e'; x.font = '28px monospace'; x.fillText('FAKE CAMERA ' + t.toFixed(1), 20, 40);
      c._raf = requestAnimationFrame(draw);
    })();
    var s = c.captureStream(15); s._canvas = c;
    return Promise.resolve(s);
  }

  /* ---------------------------------------------------------- the page */
  UI.page('capture', { title: 'New scan', nav: 'Scan', icon: 'camera', auth: 'user', order: 20 }, function (view, ctx) {
    var method = ['video', 'import'].indexOf(ctx.args[0]) >= 0 ? ctx.args[0] : 'camera';
    var opts = { title: '', room: 'living', quality: 'balanced', mesh: true };
    var stream = null, keeper = null, cleanup = [], wake = null, alive = true, info = {};

    function stop() {
      cleanup.forEach(function (f) { try { f(); } catch (e) {} }); cleanup = [];
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); if (stream._canvas) cancelAnimationFrame(stream._canvas._raf); stream = null; }
      if (wake) { wake.release().catch(function () {}); wake = null; }
      var cam = document.querySelector('.cp-cam'); if (cam) cam.remove();
      document.documentElement.classList.remove('ui-modal-open');
    }

    function setup() {
      var phone = matchMedia('(pointer: coarse)').matches;
      view.innerHTML = '<div class="ui-wrap cp-wrap"><h1 style="margin:0">Let\'s capture a room</h1>' +
        '<p class="muted" style="margin-top:6px">Walk around it slowly with your phone. The scan station turns your walk into 3D.</p>' +
        '<div class="cp-methods">' +
        '<button class="cp-method' + (method === 'camera' ? ' on' : '') + '" data-method="camera"><span class="cp-ic">' + UI.icon('camera') + '</span>' + (phone ? '<span class="ui-badge brand">Best</span>' : '') +
        '<b>Walk with the camera</b><span>A guided walk: we keep the sharp frames and tell you when to slow down.</span></button>' +
        '<button class="cp-method' + (method === 'video' ? ' on' : '') + '" data-method="video"><span class="cp-ic">' + UI.icon('video') + '</span><b>Upload a video</b><span>Already filmed the room? We take the frames from it.</span></button>' +
        '<button class="cp-method' + (method === 'import' ? ' on' : '') + '" data-method="import"><span class="cp-ic">' + UI.icon('upload') + '</span><b>Import a 3D file</b><span>A PLY or GLB from another scanning app.</span></button></div>' +
        (method === 'import' ? importForm() : walkForm(phone)) + '</div>';
      if (method === 'import') wireImport();
    }
    function walkForm(phone) {
      return '<form class="ui-card cp-form" data-setup>' +
        '<label class="ui-field"><span>Name the room</span><input type="text" name="title" maxlength="80" placeholder="e.g. Living room, before the move" value="' + esc(opts.title) + '"></label>' +
        '<label class="ui-field"><span>Quality</span><select name="quality">' + QUALITY.map(function (q) { return '<option value="' + q[0] + '"' + (q[0] === opts.quality ? ' selected' : '') + '>' + q[1] + ': ' + q[2] + '</option>'; }).join('') + '</select></label>' +
        '<div class="ui-field wide"><span>What kind of room?</span>' + rooms(opts.room) + '</div>' +
        '<label class="ui-check wide"><input type="checkbox" name="mesh"' + (opts.mesh ? ' checked' : '') + '> Build a solid surface too, not only points</label>' +
        (method === 'video' ? '<label class="cp-drop wide" data-videodrop>' + UI.icon('video') + '<b>Choose a video of the room</b><span>MP4 or MOV, up to 2 minutes is plenty</span><input type="file" accept="video/*" data-videofile></label>'
          : (!phone ? '<div class="ui-note wide cp-note">' + UI.icon('info') + '<div>The camera works best on a phone. On this computer you can still use a webcam, or <a href="#capture/video" data-go="capture/video">upload a video</a> you took with your phone.</div></div>' : '')) +
        '<div class="cp-go wide"><a class="ui-btn ghost" href="#home" data-go="home">Cancel</a>' +
        (method === 'camera' ? '<button class="ui-btn primary lg" type="submit">' + UI.icon('camera') + 'Open the camera</button>' : '') + '</div></form>';
    }

    /* ------------------------------------------------ camera */
    function readForm() {
      var f = view.querySelector('[data-setup]');
      if (!f) return;
      var v = UI.formData(f);
      opts.title = v.title || ''; opts.quality = v.quality || 'balanced'; opts.mesh = !!v.mesh; opts.room = v.room || 'living';
    }
    function openCamera() {
      readForm();
      var fake = /[?&]fakecam=1/.test(location.search) || window.LS_FAKE_CAMERA;
      var get = fake ? fakeStream() : (navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        : Promise.reject(new Error('This browser can\'t use the camera.')));
      return get.then(function (s) { stream = s; cameraScreen(); }, function (err) {
        var msg = /denied|not allowed|permission/i.test(err && (err.name + err.message)) ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.'
          : (err && err.message) || 'The camera didn\'t start.';
        UI.modal('<h2>No camera</h2><p class="muted">' + esc(msg) + '</p><div class="ui-row end"><a class="ui-btn" href="#capture/video" data-go="capture/video" data-close>Upload a video instead</a>' +
          '<button class="ui-btn primary" data-close>OK</button></div>');
      });
    }
    function cameraScreen() {
      keeper = new Keeper();
      var el = document.createElement('div');
      el.className = 'ui cp-cam';
      el.innerHTML = '<video playsinline muted autoplay></video>' +
        '<div class="top"><button class="x" data-camx aria-label="Close the camera">' + UI.icon('x') + '</button><span class="cp-chip" data-time>0:00</span><span class="cp-chip" data-count>' + UI.icon('image') + '0</span>' +
        '<span class="ui-spacer"></span><span class="cp-chip">' + esc(opts.title || LS.ROOMS[opts.room]) + '</span></div>' +
        '<div class="cp-mid"><div class="cp-frame" data-frame></div><div class="cp-msg" data-msg style="opacity:0"></div></div>' +
        '<div class="bot"><div class="cp-side"><div class="cp-ring" data-ring>' + ringSvg([]) + '<b data-cov>0%</b></div>coverage</div>' +
        '<button class="cp-rec" data-rec aria-label="Start recording"><i></i></button>' +
        '<div class="cp-side"><div class="cp-sharp"><i data-sharp style="width:0"></i></div><span data-sharplbl>sharpness</span></div></div>' +
        '<div class="cp-start" data-startbox><div><h2>Ready when you are</h2><ol>' +
        '<li>Stand in a corner, phone at chest height.</li><li>Press the red button and walk slowly along the walls.</li>' +
        '<li>Tilt up and down now and then to catch the floor and ceiling.</li><li>Finish where you started, then press stop.</li></ol>' +
        '<button class="ui-btn lg" data-begin>' + UI.icon('camera') + 'I\'m ready</button></div></div>';
      document.body.appendChild(el);
      document.documentElement.classList.add('ui-modal-open');
      var video = el.querySelector('video');
      video.srcObject = stream;
      video.play().catch(function () {});
      var rec = false, t0 = 0, tick = null, sectors = {}, gotHeading = false, lastMsg = 0, gyro = 0;
      function say(text, warn) {
        var m = el.querySelector('[data-msg]'); m.textContent = text; m.className = 'cp-msg' + (warn ? ' warn' : ''); m.style.opacity = 1;
        lastMsg = Date.now(); setTimeout(function () { if (Date.now() - lastMsg >= 1900) m.style.opacity = 0; }, 2000);
      }
      function onOrient(e) {
        var h = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.alpha != null ? 360 - e.alpha : null);
        if (h == null) return;
        gotHeading = true;
        if (rec) { sectors[Math.floor(((h % 360) + 360) % 360 / 15)] = 1; }
      }
      function onMotion(e) {
        var r = e.rotationRate; if (!r) return;
        gyro = Math.max(gyro * 0.8, Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0));
      }
      window.addEventListener('deviceorientation', onOrient); window.addEventListener('devicemotion', onMotion);
      cleanup.push(function () { window.removeEventListener('deviceorientation', onOrient); window.removeEventListener('devicemotion', onMotion); clearInterval(tick); });
      function coverage() {
        var n = Object.keys(sectors).length;
        return gotHeading ? n / 24 : Math.min(1, keeper.frames.length / 150);
      }
      function updateHud(v) {
        var s = Math.round((Date.now() - t0) / 1000);
        el.querySelector('[data-time]').textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
        el.querySelector('[data-count]').innerHTML = UI.icon('image') + keeper.frames.length;
        var cov = coverage();
        el.querySelector('[data-cov]').textContent = Math.round(cov * 100) + '%';
        el.querySelector('[data-ring]').firstChild.outerHTML = ringSvg(gotHeading ? Object.keys(sectors) : null, cov);
        if (v) {
          el.querySelector('[data-sharp]').style.width = Math.round(v.sharp * 100) + '%';
          if (v.kept) { var f = el.querySelector('[data-frame]'); f.classList.add('flash'); setTimeout(function () { f.classList.remove('flash'); }, 120); }
          if (gyro > 95) say('Slow down: turn more gently', true);
          else if (v.dark && Date.now() - lastMsg > 4000) say('It\'s dark here. More light gives a better scan.', true);
          else if (v.skip === 'blur' && Date.now() - lastMsg > 2500) say('Hold steady for a moment');
          else if (v.skip === 'still' && Date.now() - lastMsg > 5000) say('Keep walking slowly');
        }
      }
      function start() {
        el.querySelector('[data-startbox]').remove();
        var asks = [];
        if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) asks.push(DeviceOrientationEvent.requestPermission().catch(function () {}));
        if (window.DeviceMotionEvent && DeviceMotionEvent.requestPermission) asks.push(DeviceMotionEvent.requestPermission().catch(function () {}));
        Promise.all(asks).then(function () {});
        if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { wake = w; }, function () {});
      }
      function toggle() {
        var b = el.querySelector('[data-rec]');
        if (!rec) {
          rec = true; t0 = Date.now(); b.classList.add('on'); b.setAttribute('aria-label', 'Stop');
          el.querySelector('[data-time]').classList.add('rec');
          if (navigator.vibrate) navigator.vibrate(30);
          say('Walk slowly along the walls');
          tick = setInterval(function () {
            if (!video.videoWidth) return;
            var v = keeper.offer(video, video.videoWidth, video.videoHeight, Date.now());
            updateHud(v);
            if (keeper.frames.length >= MAX_FRAMES) { UI.toast('That\'s plenty of frames. Stopping here.'); finish(); }
          }, 1000 / FPS);
        } else finish();
      }
      function finish() {
        if (!rec) return;
        rec = false; clearInterval(tick);
        if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
        info = { seconds: Math.round((Date.now() - t0) / 1000), skipped: keeper.blurry + keeper.still, portrait: video.videoHeight > video.videoWidth,
                 width: keeper.w, height: keeper.h, motion: !!gyro, coverage: gotHeading ? coverage() : null };
        stop();
        review();
      }
      el.addEventListener('click', function (e) {
        if (e.target.closest('[data-begin]')) start();
        else if (e.target.closest('[data-rec]')) toggle();
        else if (e.target.closest('[data-camx]')) {
          if (keeper.frames.length > 5) { rec = false; clearInterval(tick); info = { seconds: Math.round((Date.now() - t0) / 1000), skipped: keeper.blurry + keeper.still, portrait: video.videoHeight > video.videoWidth, width: keeper.w, height: keeper.h }; stop(); review(); }
          else { stop(); setup(); }
        }
      });
      window.LS_CAPTURE = { toggle: toggle, keeper: keeper };  // for the automated tests
    }
    function ringSvg(list, cov) {
      var r = 26, c = 2 * Math.PI * r, out = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="' + r + '" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="7"/>';
      if (list) {
        list.forEach(function (k) { out += '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="#8dbfa6" stroke-width="7" stroke-dasharray="' + (c / 24 - 1).toFixed(2) + ' ' + c.toFixed(2) + '" stroke-dashoffset="' + (-c * k / 24).toFixed(2) + '"/>'; });
      } else if (cov) {
        out += '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="#8dbfa6" stroke-width="7" stroke-dasharray="' + (c * cov).toFixed(2) + ' ' + c.toFixed(2) + '"/>';
      }
      return out + '</svg>';
    }

    /* ------------------------------------------------ video file */
    function fromVideo(file) {
      readForm();
      keeper = new Keeper();
      var url = URL.createObjectURL(file), v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      view.querySelector('.cp-wrap').innerHTML = '<div class="ui-card ui-narrow" style="margin:30px auto"><h2>Reading the video…</h2><p class="muted" data-vmsg>Taking about three sharp frames per second.</p>' +
        '<div class="cp-up"><i data-vbar></i></div><p class="small muted" data-vcount>0 frames</p></div>';
      return new Promise(function (resolve, reject) {
        v.onloadedmetadata = function () {
          var dur = v.duration;
          if (!isFinite(dur) || dur <= 0) return reject(new Error('That video has no length we can read.'));
          var step = Math.max(1 / FPS, dur / MAX_FRAMES), t = 0.05;
          function next() {
            if (!alive) return;
            if (t >= dur || keeper.frames.length >= MAX_FRAMES) {
              info = { seconds: Math.round(dur), skipped: keeper.blurry + keeper.still, portrait: v.videoHeight > v.videoWidth, width: keeper.w, height: keeper.h, video: true };
              URL.revokeObjectURL(url); resolve(); return;
            }
            v.currentTime = t;
          }
          v.onseeked = function () {
            keeper.offer(v, v.videoWidth, v.videoHeight, t * 1000 + 3000);
            var bar = view.querySelector('[data-vbar]'), cnt = view.querySelector('[data-vcount]');
            if (bar) bar.style.width = Math.round(t / dur * 100) + '%';
            if (cnt) cnt.textContent = keeper.frames.length + ' frames kept · ' + (keeper.blurry + keeper.still) + ' skipped';
            t += step; next();
          };
          next();
        };
        v.onerror = function () { reject(new Error('This browser can\'t read that video. Try an MP4.')); };
      }).then(review, function (err) { UI.toast(err.message, 'error'); setup(); });
    }

    /* ------------------------------------------------ review + upload */
    function review() {
      var k = keeper, n = k.frames.length, enough = n >= 12;
      var show = [], every = Math.max(1, Math.ceil(n / 24));
      for (var i = 0; i < n; i += every) show.push(k.frames[i]);
      view.innerHTML = '<div class="ui-wrap cp-wrap"><h1 style="margin:0">' + (enough ? 'Nice walk!' : 'A bit short') + '</h1>' +
        '<p class="muted">' + (enough ? 'Check the frames, then send them to the scan station.' : 'A room needs at least 12 sharp frames. Try a slower, longer walk.') + '</p>' +
        '<div class="cp-sum"><div><b>' + n + '</b><span>sharp frames</span></div><div><b>' + (info.seconds || 0) + 's</b><span>' + (info.video ? 'video' : 'walk') + '</span></div>' +
        '<div><b>' + ((info.skipped) || 0) + '</b><span>skipped (blurry or still)</span></div></div>' +
        (info.coverage != null && info.coverage < 0.6 && enough ? '<div class="ui-note cp-note" style="margin-bottom:14px">' + UI.icon('info') + '<div>You faced about ' + Math.round(info.coverage * 100) + '% of the directions. Parts of the room may be missing; that\'s fine for a corner or a wall.</div></div>' : '') +
        (n ? '<div class="ui-card"><div class="cp-film">' + show.map(function (f) { return '<img alt="" src="' + f + '">'; }).join('') + '</div></div>' : '') +
        '<form class="ui-card cp-form" data-final style="margin-top:14px"><label class="ui-field"><span>Room name</span><input type="text" name="title" maxlength="80" value="' + esc(opts.title) + '" placeholder="' + esc(LS.ROOMS[opts.room]) + '"></label>' +
        '<label class="ui-field"><span>Quality</span><select name="quality">' + QUALITY.map(function (q) { return '<option value="' + q[0] + '"' + (q[0] === opts.quality ? ' selected' : '') + '>' + q[1] + '</option>'; }).join('') + '</select></label>' +
        '<div class="cp-go wide"><button type="button" class="ui-btn ghost" data-discard>' + UI.icon('trash') + 'Discard</button>' +
        '<button type="button" class="ui-btn" data-again>' + UI.icon('camera') + 'Scan again</button>' +
        (enough ? '<button class="ui-btn primary lg" type="submit">' + UI.icon('upload') + 'Send for 3D</button>' : '') + '</div>' +
        '<div class="wide" data-progress hidden><div class="cp-up"><i data-upbar></i></div><p class="small muted" data-uptext></p></div></form></div>';
    }
    function upload(form) {
      var v = UI.formData(form), k = keeper, n = k.frames.length, sent = 0, scan = null;
      opts.title = v.title; opts.quality = v.quality;
      form.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      form.querySelector('[data-progress]').hidden = false;
      var bar = form.querySelector('[data-upbar]'), txt = form.querySelector('[data-uptext]');
      function show(t) { bar.style.width = Math.round(sent / n * 100) + '%'; txt.textContent = t || ('Uploading frames: ' + sent + ' of ' + n); }
      function batch(start, tries) {
        var part = k.frames.slice(start, start + BATCH).map(function (f) { return f.split(',')[1]; });
        return UI.apiQuiet('add_frames', scan.id, start, part).then(function () {
          sent = Math.min(n, start + BATCH); show();
        }, function (err) {
          if (tries > 0 && !err.expected) { show('Connection hiccup, trying again…'); return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return batch(start, tries - 1); }); }
          throw err;
        });
      }
      show('Starting…');
      return UI.apiQuiet('create_scan', v.title || LS.ROOMS[opts.room], opts.room, method === 'video' ? 'video' : 'capture', { quality: opts.quality, mesh: opts.mesh }).then(function (r) {
        scan = r.scan;
        var chain = Promise.resolve();
        for (var s = 0; s < n; s += BATCH) (function (st) { chain = chain.then(function () { return batch(st, 3); }); })(s);
        return chain;
      }).then(function () {
        show('Sending it to the scan station…');
        return UI.apiQuiet('finish_capture', scan.id, info);
      }).then(function () {
        keeper = null;
        UI.toast('Sent! We\'ll turn it into 3D.', 'ok');
        UI.go('scan', scan.id);
      }, function (err) {
        txt.textContent = (err && err.message) || 'The upload stopped.';
        form.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
        UI.toast('The upload stopped. Check your connection and press Send again.', 'error');
        if (scan) UI.apiQuiet('delete_scan', scan.id).catch(function () {});
      });
    }

    /* ------------------------------------------------ import a 3D file */
    function importForm() {
      return '<div class="ui-card" data-importbox><label class="cp-drop" data-drop>' + UI.icon('upload') + '<b>Choose a 3D file</b>' +
        '<span>PLY (points or mesh) or GLB, up to 80 MB. From Polycam, Scaniverse, RealityScan, Meshroom, CloudCompare…</span>' +
        '<input type="file" accept=".ply,.glb,model/gltf-binary" data-importfile></label><div data-importprev></div></div>';
    }
    function wireImport() {
      var drop = view.querySelector('[data-drop]');
      ['dragenter', 'dragover'].forEach(function (k) { drop.addEventListener(k, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (k) { drop.addEventListener(k, function () { drop.classList.remove('over'); }); });
      drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); });
    }
    var imported = null, prevViewer = null;
    function importFile(file) {
      if (file.size > 80 * 1048576) { UI.toast('That file is over 80 MB. Simplify it first (e.g. in CloudCompare).', 'error'); return; }
      var box = view.querySelector('[data-importprev]');
      box.innerHTML = '<p class="muted" style="margin-top:14px">Reading ' + esc(file.name) + '…</p>';
      Promise.all([LS.loadThree(), file.arrayBuffer()]).then(function (r) {
        var buf = r[1], name = file.name.toLowerCase();
        return name.endsWith('.glb') ? parseGLB(buf) : { geom: LS.parsePLY(buf), yUp: false };
      }).then(function (res) {
        var g = res.geom, note = normalise(g, res.yUp);
        imported = { geom: g, name: file.name.replace(/\.[^.]+$/, ''), note: note };
        if (prevViewer) prevViewer.dispose();
        var faces = g.index ? g.index.count / 3 : 0;
        box.innerHTML = '<div class="cp-prev" data-prevview></div>' +
          '<p class="small muted">' + LS.fmtNum(g.attributes.position.count) + ' points' + (faces ? ', ' + LS.fmtNum(faces) + ' triangles' : '') + ' · ' + esc(note) + '</p>' +
          '<form class="cp-form" data-importform><label class="ui-field"><span>Room name</span><input type="text" name="title" maxlength="80" value="' + esc(imported.name) + '"></label>' +
          '<div class="ui-field"><span>Room type</span>' + rooms('other') + '</div>' +
          '<div class="cp-go wide"><button class="ui-btn primary lg" type="submit">' + UI.icon('upload') + 'Add to my rooms</button></div>' +
          '<div class="wide" data-progress hidden><div class="cp-up"><i data-upbar></i></div><p class="small muted" data-uptext></p></div></form>';
        prevViewer = new LS.Viewer(box.querySelector('[data-prevview]'), { background: getComputedStyle(document.documentElement).getPropertyValue('--c-stage').trim() || '#2a231e' });
        prevViewer.setModel(faces ? pointsOf(g) : g, faces ? g : null);
        if (faces) prevViewer.setDisplay('surface');
        prevViewer.fit();
      }).catch(function (e) { box.innerHTML = '<div class="ui-error" style="margin-top:14px">' + esc(e.message || 'Couldn\'t read that file.') + '</div>'; });
    }
    function pointsOf(g) {
      var p = new THREE.BufferGeometry();
      p.setAttribute('position', g.attributes.position.clone());
      if (g.attributes.color) p.setAttribute('color', g.attributes.color.clone());
      return p;
    }
    /* metres, Y up, floor at 0, centred. Returns a note about what was done. */
    function normalise(g, yUp) {
      g.computeBoundingBox();
      var b = g.boundingBox, s = b.getSize(new THREE.Vector3()), notes = [];
      var big = Math.max(s.x, s.y, s.z);
      if (big > 300) { g.scale(0.001, 0.001, 0.001); notes.push('millimetres converted to metres'); }
      else if (big > 40) { g.scale(0.01, 0.01, 0.01); notes.push('centimetres converted to metres'); }
      g.computeBoundingBox(); s = g.boundingBox.getSize(new THREE.Vector3());
      if (!yUp && s.z < s.y * 0.8 && s.z <= s.x) { g.rotateX(-Math.PI / 2); notes.push('Z-up turned to Y-up'); }
      g.computeBoundingBox();
      var c = g.boundingBox.getCenter(new THREE.Vector3());
      g.translate(-c.x, -g.boundingBox.min.y, -c.z);
      g.computeBoundingBox();
      return notes.length ? notes.join(', ') : 'levelled and centred';
    }
    function parseGLB(buf) {
      return new Promise(function (resolve, reject) {
        new THREE.GLTFLoader().parse(buf, '', function (gltf) {
          var pos = [], col = [], idx = [], base = 0, v = new THREE.Vector3(), canvasCache = new Map();
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse(function (o) {
            if (!(o.isMesh || o.isPoints) || !o.geometry || !o.geometry.attributes.position) return;
            var g = o.geometry, p = g.attributes.position, n = p.count, vc = g.attributes.color, uv = g.attributes.uv;
            var mat = Array.isArray(o.material) ? o.material[0] : o.material, mc = mat && mat.color ? mat.color : new THREE.Color(0.8, 0.78, 0.75);
            var tex = mat && mat.map && mat.map.image && uv ? texSampler(mat.map, canvasCache) : null;
            for (var i = 0; i < n; i++) {
              v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z);
              if (tex) { var c = tex(uv.getX(i), uv.getY(i)); col.push(c[0], c[1], c[2]); }
              else if (vc) col.push(vc.getX(i), vc.getY(i), vc.getZ(i));
              else col.push(mc.r, mc.g, mc.b);
            }
            if (o.isMesh) {
              if (g.index) for (var j = 0; j < g.index.count; j++) idx.push(g.index.getX(j) + base);
              else for (var k = 0; k < n; k++) idx.push(k + base);
            }
            base += n;
          });
          if (!pos.length) return reject(new Error('That GLB has no geometry.'));
          var out = new THREE.BufferGeometry();
          out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
          if (idx.length) out.setIndex(idx);
          resolve({ geom: out, yUp: true });
        }, function (e) { reject(new Error('Couldn\'t read that GLB: ' + (e && e.message || e))); });
      });
    }
    function texSampler(tex, cache) {
      var img = tex.image, key = tex.uuid;
      if (!cache.has(key)) {
        var c = document.createElement('canvas'), w = Math.min(img.width, 2048), h = Math.min(img.height, 2048);
        c.width = w; c.height = h; var x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
        cache.set(key, { w: w, h: h, d: x.getImageData(0, 0, w, h).data });
      }
      var t = cache.get(key), flip = tex.flipY;
      return function (u, v) {
        u = u - Math.floor(u); v = v - Math.floor(v); if (flip) v = 1 - v;
        var px = Math.min(t.w - 1, Math.floor(u * t.w)), py = Math.min(t.h - 1, Math.floor(v * t.h)), o = (py * t.w + px) * 4;
        return [Math.pow(t.d[o] / 255, 2.2), Math.pow(t.d[o + 1] / 255, 2.2), Math.pow(t.d[o + 2] / 255, 2.2)];
      };
    }
    function stats(g) {
      g.computeBoundingBox();
      var s = g.boundingBox.getSize(new THREE.Vector3());
      return { points: g.attributes.position.count, faces: g.index ? g.index.count / 3 : 0, size: [+s.x.toFixed(3), +s.z.toFixed(3), +s.y.toFixed(3)], area: +(s.x * s.z).toFixed(1) };
    }
    function importUpload(form) {
      var v = UI.formData(form), g = imported.geom, faces = !!g.index;
      var bar = form.querySelector('[data-upbar]'), txt = form.querySelector('[data-uptext]');
      form.querySelector('[data-progress]').hidden = false;
      form.querySelector('[type=submit]').disabled = true;
      var files = [['cloud', LS.writePLY(faces ? pointsOf(g) : g)]];
      if (faces) files.push(['mesh', LS.writePLY(g)]);
      var total = files.reduce(function (a, f) { return a + f[1].byteLength; }, 0), done = 0;
      LS.uploadFiles(files, function (n) { done += n; bar.style.width = Math.round(done / total * 100) + '%'; txt.textContent = 'Uploading ' + (done / 1048576).toFixed(1) + ' of ' + (total / 1048576).toFixed(1) + ' MB'; })
        .then(function (keys) {
          txt.textContent = 'Saving…';
          return UI.api('upload_finish', { title: v.title, room: v.room, cloud: keys.cloud, mesh: keys.mesh || null, stats: stats(g), note: 'Imported ' + imported.name, scale_source: 'import' });
        }).then(function (r) { UI.toast('Imported!', 'ok'); UI.go('scan', r.scan.id); },
          function (err) { txt.textContent = err.message; form.querySelector('[type=submit]').disabled = false; });
    }

    view.addEventListener('click', function (e) {
      var m = e.target.closest('[data-method]');
      if (m) { readForm(); method = m.getAttribute('data-method'); history.replaceState(null, '', '#capture' + (method === 'camera' ? '' : '/' + method)); setup(); return; }
      if (e.target.closest('[data-discard]')) {
        UI.confirm({ title: 'Discard this walk?', text: 'The frames are thrown away.', ok: 'Discard', danger: true }).then(function (y) { if (y) { keeper = null; setup(); } });
      }
      if (e.target.closest('[data-again]')) { keeper = null; method = 'camera'; setup(); openCamera(); }
    });
    view.addEventListener('change', function (e) {
      if (e.target.matches('[data-videofile]') && e.target.files[0]) fromVideo(e.target.files[0]);
      if (e.target.matches('[data-importfile]') && e.target.files[0]) importFile(e.target.files[0]);
    });
    view.addEventListener('submit', function (e) {
      e.preventDefault();
      if (e.target.matches('[data-setup]')) openCamera();
      else if (e.target.matches('[data-final]')) upload(e.target);
      else if (e.target.matches('[data-importform]')) importUpload(e.target);
    });
    setup();
    return { ready: Promise.resolve(), destroy: function () { alive = false; stop(); if (prevViewer) prevViewer.dispose(); window.LS_CAPTURE = null; } };
  });

  /* Upload PLY files in parts (Studio uses this too): files = [[kind, ArrayBuffer]] -> Promise of {kind: [key, parts]} */
  LS.uploadFiles = function (files, onBytes) {
    var PART = 700 * 1024, out = {};
    function b64(u8) {
      var s = '', CH = 0x8000;
      for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
      return btoa(s);
    }
    return files.reduce(function (chain, f) {
      return chain.then(function () {
        return UI.apiQuiet('upload_begin', f[0]).then(function (r) {
          var u8 = new Uint8Array(f[1]), parts = Math.ceil(u8.length / PART), c = Promise.resolve();
          for (var i = 0; i < parts; i++) (function (i) {
            c = c.then(function () {
              var piece = u8.subarray(i * PART, Math.min(u8.length, (i + 1) * PART));
              return UI.apiQuiet('upload_part', r.key, i, b64(piece)).then(function () { if (onBytes) onBytes(piece.length); });
            });
          })(i);
          return c.then(function () { out[f[0]] = [r.key, parts]; });
        });
      });
    }, Promise.resolve()).then(function () { return out; });
  };
})();

(function () {
  var esc = UI.esc;
  var TOOLS = [
    ['nav', 'hand', 'Look around (V)', 'v'], ['box', 'box', 'Box select (B)', 'b'], ['lasso', 'lasso', 'Lasso select (L)', 'l'], ['sep'],
    ['level', 'level', 'Level the floor (F)', 'f'], ['scale', 'ruler', 'Set the real size (C)', 'c'], ['turn', 'rotate', 'Turn and move (R)', 'r'], ['sep'],
    ['clean', 'wand', 'Clean up (N)', 'n'], ['color', 'palette', 'Colours (K)', 'k'], ['pins', 'pinplus', 'Pins (P)', 'p']
  ];
  var SWATCHES = ['#f2efe9', '#2a231e', '#c2522b', '#4f7f6a', '#d9a43c', '#7fa7c9', '#9aa3ab'];
  var hand = '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6.5 7-2.6 0-4.3-1.3-5.6-3.4L3.4 15a1.5 1.5 0 0 1 2.4-1.8L8 15.5"/>';
  if (!UI.ICONS.hand) UI.ICONS.hand = hand;

  UI.page('studio', { title: 'Studio', auth: 'user' }, function (view, ctx) {
    var id = ctx.args[0], scan = null, V = null, alive = true, tool = 'nav', dirty = false, scaleSource = 'estimated';
    var undo = [], redo = [], log = [], annotations = [], path = [], picks = [], drag = null, colorBase = null, turnDeg = 0;
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:70vh"></div></div>';

    /* -------------------------------------------- geometry helpers (each layer: {geom, obj}) */
    function layers() { return V ? Object.keys(V.layers).map(function (k) { return [k, V.layers[k]]; }) : []; }
    function snapshot(label) {
      var snap = { label: label, layers: {}, ann: JSON.parse(JSON.stringify(annotations)), path: JSON.parse(JSON.stringify(path)), scale: scaleSource };
      layers().forEach(function (l) {
        var g = l[1].geom;
        snap.layers[l[0]] = { pos: g.attributes.position.array.slice(), photo: g.userData.photo.slice(), index: g.index ? g.index.array.slice() : null };
      });
      return snap;
    }
    function restore(snap) {
      Object.keys(snap.layers).forEach(function (k) {
        var s = snap.layers[k];
        setArrays(V.layers[k].geom, s.pos, s.photo, s.index);
      });
      annotations = snap.ann; path = snap.path; scaleSource = snap.scale;
      afterChange();
    }
    function commit(label, fn) {
      var before = snapshot(label);
      var r = fn();
      if (r === false) return;
      undo.push(before); if (undo.length > 12) undo.shift();
      redo = [];
      log.push({ label: label, icon: currentIcon() });
      log = log.slice(-40);
      dirty = true;
      afterChange();
    }
    function currentIcon() { var t = TOOLS.filter(function (x) { return x[0] === tool; })[0]; return t ? t[1] : 'edit'; }
    function setArrays(g, pos, photo, index) {
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(photo), 3));
      g.userData.photo = photo;
      if (index) g.setIndex(new THREE.BufferAttribute(index, 1)); else if (g.index) g.setIndex(null);
      if (g.attributes.normal) g.deleteAttribute('normal');
      if (index) g.computeVertexNormals();
      g.computeBoundingBox(); g.computeBoundingSphere();
    }
    function afterChange() {
      clearSel(true);
      V.measureBounds();
      V.setColor(V.state.color);
      V.setPins(annotations);
      V.setPath(path);
      V.setCut(V.state.cut);
      V.needs = true;
      drawSide();
    }
    /* keep = Uint8Array(n): 1 keeps the vertex. Faces that lose a corner go too. */
    function keepVertices(g, keep) {
      var n = g.attributes.position.count, pos = g.attributes.position.array, ph = g.userData.photo, map = new Int32Array(n), m = 0;
      for (var i = 0; i < n; i++) map[i] = keep[i] ? m++ : -1;
      var np = new Float32Array(m * 3), nc = new Float32Array(m * 3);
      for (var j = 0; j < n; j++) if (map[j] >= 0) {
        var o = map[j] * 3; np[o] = pos[j * 3]; np[o + 1] = pos[j * 3 + 1]; np[o + 2] = pos[j * 3 + 2];
        nc[o] = ph[j * 3]; nc[o + 1] = ph[j * 3 + 1]; nc[o + 2] = ph[j * 3 + 2];
      }
      var idx = null;
      if (g.index) {
        var ia = g.index.array, out = [];
        for (var f = 0; f < ia.length; f += 3) {
          var a = map[ia[f]], b = map[ia[f + 1]], c = map[ia[f + 2]];
          if (a >= 0 && b >= 0 && c >= 0) out.push(a, b, c);
        }
        idx = new Uint32Array(out);
      }
      setArrays(g, np, nc, idx);
    }
    function transformAll(m) {
      layers().forEach(function (l) {
        var g = l[1].geom; g.applyMatrix4(m);
        if (g.index) g.computeVertexNormals();
        g.computeBoundingBox(); g.computeBoundingSphere();
      });
      var v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
      annotations.forEach(function (a) { v.set(a.p[0], a.p[1], a.p[2]).applyMatrix4(m); a.p = [r4(v.x), r4(v.y), r4(v.z)]; });
      path.forEach(function (e) {
        v.set(e[0], e[1], e[2]).applyMatrix4(m); var d = new THREE.Vector3(e[3], e[4], e[5]).applyMatrix3(nm).normalize();
        e[0] = r4(v.x); e[1] = r4(v.y); e[2] = r4(v.z); e[3] = r4(d.x); e[4] = r4(d.y); e[5] = r4(d.z);
      });
    }
    function r4(x) { return Math.round(x * 10000) / 10000; }

    /* -------------------------------------------- selection */
    function selCount() {
      var n = 0, s = V.selection && V.selection[V.state.display];
      if (s) for (var i = 0; i < s.length; i++) n += s[i];
      return n;
    }
    function anySel() { return V && V.selection && Object.keys(V.selection).some(function (k) { var s = V.selection[k]; for (var i = 0; i < s.length; i++) if (s[i]) return true; return false; }); }
    function clearSel(silent) {
      if (!V) return;
      V.selection = null;
      if (!silent) { V.setColor(V.state.color); drawSide(); }
    }
    /* test(x, y) on screen pixels; mode: 'set' | 'add' | 'sub' */
    function selectScreen(test, mode) {
      var cam = V.active, w = V.el.clientWidth, h = V.el.clientHeight;
      var M = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), e = M.elements, clipY = V.clip.constant;
      V.selection = V.selection || {};
      layers().forEach(function (l) {
        var g = l[1].geom, p = g.attributes.position.array, n = g.attributes.position.count;
        var sel = V.selection[l[0]] && V.selection[l[0]].length === n ? V.selection[l[0]] : new Uint8Array(n);
        if (mode === 'set') sel.fill(0);
        for (var i = 0; i < n; i++) {
          var x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
          if (y > clipY) continue;
          var cw = e[3] * x + e[7] * y + e[11] * z + e[15];
          if (cw <= 0) continue;
          var sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw + 1) / 2 * w, sy = (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw) / 2 * h;
          if (test(sx, sy)) sel[i] = mode === 'sub' ? 0 : 1;
        }
        V.selection[l[0]] = sel;
      });
      V.setColor(V.state.color);
      drawSide();
    }
    function selectHeight(lo, hi) {
      V.selection = {};
      layers().forEach(function (l) {
        var g = l[1].geom, p = g.attributes.position.array, n = g.attributes.position.count, sel = new Uint8Array(n);
        for (var i = 0; i < n; i++) { var y = p[i * 3 + 1]; if (y >= lo && y <= hi) sel[i] = 1; }
        V.selection[l[0]] = sel;
      });
      V.setColor(V.state.color); drawSide();
    }
    function invertSel() {
      if (!V.selection) V.selection = {};
      layers().forEach(function (l) {
        var n = l[1].geom.attributes.position.count, s = V.selection[l[0]] || new Uint8Array(n);
        for (var i = 0; i < n; i++) s[i] = s[i] ? 0 : 1;
        V.selection[l[0]] = s;
      });
      V.setColor(V.state.color); drawSide();
    }
    function deleteSel(keepOnly) {
      if (!anySel()) { UI.toast('Select something first.', 'error'); return; }
      var count = selCount();
      commit(keepOnly ? 'Kept only the selection' : 'Deleted ' + LS.fmtNum(count) + ' points', function () {
        var sel = V.selection;
        layers().forEach(function (l) {
          var s = sel[l[0]], n = l[1].geom.attributes.position.count, keep = new Uint8Array(n);
          for (var i = 0; i < n; i++) keep[i] = s ? (keepOnly ? s[i] : (s[i] ? 0 : 1)) : (keepOnly ? 0 : 1);
          keepVertices(l[1].geom, keep);
        });
      });
    }
    /* strays: points with few neighbours (a grid count over the 27 cells around each point) */
    function findStrays(strength) {
      var l = V.layers.points || V.layers.surface, g = l.geom, p = g.attributes.position.array, n = g.attributes.position.count;
      var cell = V.spacing * (3.2 - strength * 0.12), key = function (x, y, z) { return x + ',' + y + ',' + z; }, grid = new Map(), ix = new Int32Array(n * 3);
      for (var i = 0; i < n; i++) {
        var a = Math.floor(p[i * 3] / cell), b = Math.floor(p[i * 3 + 1] / cell), c = Math.floor(p[i * 3 + 2] / cell);
        ix[i * 3] = a; ix[i * 3 + 1] = b; ix[i * 3 + 2] = c;
        var k = key(a, b, c); grid.set(k, (grid.get(k) || 0) + 1);
      }
      var sel = new Uint8Array(n), found = 0, need = 2 + strength;
      for (var j = 0; j < n; j++) {
        var s = 0, a2 = ix[j * 3], b2 = ix[j * 3 + 1], c2 = ix[j * 3 + 2];
        for (var dx = -1; dx <= 1 && s < need; dx++) for (var dy = -1; dy <= 1 && s < need; dy++) for (var dz = -1; dz <= 1 && s < need; dz++) s += grid.get(key(a2 + dx, b2 + dy, c2 + dz)) || 0;
        if (s < need) { sel[j] = 1; found++; }
      }
      V.selection = {}; V.selection[V.layers.points ? 'points' : 'surface'] = sel;
      V.setColor(V.state.color); drawSide();
      UI.toast(found ? 'Found ' + LS.fmtNum(found) + ' stray points (in yellow). Press Delete to remove them.' : 'No stray points found. Try a higher strength.', found ? null : 'ok');
    }
    function thinOut(cm) {
      var l = V.layers.points;
      if (!l) { UI.toast('Thinning works on points.', 'error'); return; }
      var size = cm / 100, g = l.geom, p = g.attributes.position.array, ph = g.userData.photo, n = g.attributes.position.count, seen = new Map();
      var before = n;
      commit('Thinned to ' + cm + ' cm spacing', function () {
        var keep = new Uint8Array(n);
        for (var i = 0; i < n; i++) {
          var k = Math.floor(p[i * 3] / size) + ',' + Math.floor(p[i * 3 + 1] / size) + ',' + Math.floor(p[i * 3 + 2] / size);
          if (!seen.has(k)) { seen.set(k, 1); keep[i] = 1; }
        }
        keepVertices(g, keep);
        void ph;
      });
      UI.toast(LS.fmtNum(before) + ' → ' + LS.fmtNum(V.layers.points.geom.attributes.position.count) + ' points', 'ok');
    }

    /* -------------------------------------------- colours */
    function colorStart() {
      colorBase = {};
      layers().forEach(function (l) { colorBase[l[0]] = l[1].geom.userData.photo.slice(); });
    }
    function colorPreview(o) {
      if (!colorBase) colorStart();
      var b = o.bright / 100, c = 1 + o.contrast / 100, s = 1 + o.sat / 100, w = o.warm / 100;
      layers().forEach(function (l) {
        var src = colorBase[l[0]], dst = l[1].geom.userData.photo, sel = V.selection && V.selection[l[0]], n = src.length / 3;
        for (var i = 0; i < n; i++) {
          var r = src[i * 3], g = src[i * 3 + 1], bl = src[i * 3 + 2];
          if (!sel || sel[i]) {
            var L = 0.3 * r + 0.59 * g + 0.11 * bl;
            r = L + (r - L) * s; g = L + (g - L) * s; bl = L + (bl - L) * s;
            r = (r - 0.5) * c + 0.5 + b; g = (g - 0.5) * c + 0.5 + b; bl = (bl - 0.5) * c + 0.5 + b;
            r += w * 0.12; bl -= w * 0.12; g += w * 0.03;
          }
          dst[i * 3] = Math.max(0, Math.min(1, r)); dst[i * 3 + 1] = Math.max(0, Math.min(1, g)); dst[i * 3 + 2] = Math.max(0, Math.min(1, bl));
        }
      });
      var keepSel = V.selection; V.setColor('photo'); V.selection = keepSel;
    }
    function colorApply(o) {
      if (!colorBase) return;
      var preview = {}; layers().forEach(function (l) { preview[l[0]] = l[1].geom.userData.photo.slice(); l[1].geom.userData.photo.set(colorBase[l[0]]); });
      colorBase = null;
      commit('Adjusted colours', function () { layers().forEach(function (l) { l[1].geom.userData.photo.set(preview[l[0]]); }); });
    }
    function colorCancel() {
      if (!colorBase) return;
      layers().forEach(function (l) { l[1].geom.userData.photo.set(colorBase[l[0]]); });
      colorBase = null; V.setColor(V.state.color);
    }
    function paint(hex, amount) {
      if (!anySel()) { UI.toast('Select what to paint first.', 'error'); return; }
      var col = new THREE.Color(hex).convertSRGBToLinear();
      commit('Painted the selection', function () {
        layers().forEach(function (l) {
          var s = V.selection[l[0]], ph = l[1].geom.userData.photo;
          if (!s) return;
          for (var i = 0; i < s.length; i++) if (s[i]) {
            ph[i * 3] += (col.r - ph[i * 3]) * amount; ph[i * 3 + 1] += (col.g - ph[i * 3 + 1]) * amount; ph[i * 3 + 2] += (col.b - ph[i * 3 + 2]) * amount;
          }
        });
      });
    }

    /* -------------------------------------------- level, scale, turn */
    function levelFrom(a, b, c) {
      var n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      if (!isFinite(n.x) || n.length() < 0.5) { UI.toast('Those points are in a line. Pick three spread out on the floor.', 'error'); return; }
      if (n.y < 0) n.negate();
      commit('Levelled the floor', function () {
        var q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 1, 0));
        var m = new THREE.Matrix4().makeRotationFromQuaternion(q);
        var a2 = a.clone().applyMatrix4(m);
        m.premultiply(new THREE.Matrix4().makeTranslation(0, -a2.y, 0));
        transformAll(m);
      });
      UI.toast('Floor levelled', 'ok');
    }
    function scaleFrom(a, b) {
      var d = a.distanceTo(b);
      var m = UI.modal('<h2>How long is that, really?</h2><p class="muted">The two points are ' + LS.fmtLen(d) + ' apart in the scan now. Type the real length (measure it with a tape, or use a known size: a door is usually 2.0 to 2.1 m high, A4 paper is 29.7 cm).</p>' +
        '<form class="ui-stack" data-scaleform><div class="ui-row"><input type="number" name="len" step="any" min="0.01" required style="max-width:160px" value="' + (d < 1 ? (d * 100).toFixed(1) : d.toFixed(3)) + '">' +
        '<select name="unit" style="max-width:120px"><option value="m"' + (d >= 1 ? ' selected' : '') + '>metres</option><option value="cm"' + (d < 1 ? ' selected' : '') + '>cm</option></select></div>' +
        '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">Set the size</button></div></form>');
      m.el.querySelector('[data-scaleform]').addEventListener('submit', function (e) {
        e.preventDefault();
        var v = UI.formData(e.target), real = parseFloat(v.len) * (v.unit === 'cm' ? 0.01 : 1);
        if (!(real > 0) || !(d > 0)) return;
        var k = real / d;
        if (k > 50 || k < 0.02) { UI.toast('That would change the size by more than 50 times. Check the length.', 'error'); return; }
        m.close();
        commit('Set the real size (×' + k.toFixed(3) + ')', function () { transformAll(new THREE.Matrix4().makeScale(k, k, k)); scaleSource = 'calibrated'; });
        V.clearMeasures();
        UI.toast('Sizes are now calibrated', 'ok');
      });
    }
    function turnApply(deg) {
      if (!deg) return;
      V.group.rotation.y = 0;
      commit('Turned ' + deg + '°', function () { transformAll(new THREE.Matrix4().makeRotationY(deg * Math.PI / 180)); });
      turnDeg = 0;
    }
    function recentre() {
      commit('Recentred', function () {
        V.measureBounds();
        var c = V.box.getCenter(new THREE.Vector3());
        transformAll(new THREE.Matrix4().makeTranslation(-c.x, -V.box.min.y, -c.z));
      });
      V.fit();
    }

    /* -------------------------------------------- pins */
    function addPin(p) {
      var m = UI.modal('<h2>New pin</h2><form class="ui-stack" data-pinform><label class="ui-field"><span>Label</span><input type="text" name="label" maxlength="60" required placeholder="e.g. Socket, 30 cm up"></label>' +
        '<label class="ui-field"><span>Note <em>(optional)</em></span><input type="text" name="note" maxlength="300"></label>' +
        '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">Add</button></div></form>');
      m.el.querySelector('[data-pinform]').addEventListener('submit', function (e) {
        e.preventDefault(); var v = UI.formData(e.target); m.close();
        commit('Added pin "' + v.label + '"', function () { annotations.push({ p: [r4(p.x), r4(p.y), r4(p.z)], label: v.label, note: v.note, color: 'brand' }); });
      });
    }

    /* -------------------------------------------- the layout */
    function drawShell() {
      var small = window.innerWidth < 980;
      view.innerHTML = '<div class="st">' +
        '<div class="st-top"><button class="ui-btn ghost sm" data-back>' + UI.icon('back') + '<span>Back</span></button>' +
        '<h1>' + esc(scan.title) + '</h1><span class="dirty" data-dirty hidden>unsaved</span><span class="ui-spacer"></span>' +
        '<button class="ui-btn sm icon" data-undo title="Undo (Ctrl+Z)" aria-label="Undo">' + UI.icon('undo') + '</button>' +
        '<button class="ui-btn sm icon" data-redo title="Redo (Ctrl+Shift+Z)" aria-label="Redo">' + UI.icon('redo') + '</button>' +
        '<button class="ui-btn sm icon" data-keys title="Keyboard shortcuts" aria-label="Keyboard shortcuts">?</button>' +
        '<button class="ui-btn sm" data-export>' + UI.icon('download') + '<span>Export</span></button>' +
        '<button class="ui-btn primary sm" data-save>' + UI.icon('save') + 'Save version</button></div>' +
        '<nav class="st-rail" aria-label="Tools">' + TOOLS.map(function (t) {
          return t[0] === 'sep' ? '<hr>' : '<button data-tool="' + t[0] + '" data-tip="' + esc(t[2]) + '" aria-label="' + esc(t[2]) + '" class="' + (tool === t[0] ? 'on' : '') + '">' + UI.icon(t[1]) + '</button>';
        }).join('') + '</nav>' +
        '<div class="st-stage" data-stage><div data-view style="position:absolute;inset:0"></div><div class="st-sel" data-selsvg></div><div class="st-hud" data-hud></div></div>' +
        '<aside class="st-panel" data-panel></aside></div>';
      if (small) UI.toast('Studio is made for a computer with a mouse. It works here too, a bit squeezed.');
    }
    function stats() {
      var out = { points: 0, faces: 0 };
      if (V.layers.points) out.points = V.layers.points.geom.attributes.position.count;
      else if (V.layers.surface) out.points = V.layers.surface.geom.attributes.position.count;
      if (V.layers.surface && V.layers.surface.geom.index) out.faces = V.layers.surface.geom.index.count / 3;
      var s = V.box.getSize(new THREE.Vector3());
      out.size = [+s.x.toFixed(3), +s.z.toFixed(3), +s.y.toFixed(3)];
      out.area = +(s.x * s.z).toFixed(1);
      return out;
    }
    function drawSide() {
      if (!V) return;
      var p = view.querySelector('[data-panel]'), st = stats(), sc = selCount(), hasMesh = !!V.layers.surface, hasPts = !!V.layers.points;
      view.querySelector('[data-dirty]').hidden = !dirty;
      view.querySelector('[data-undo]').disabled = !undo.length;
      view.querySelector('[data-redo]').disabled = !redo.length;
      view.querySelector('[data-hud]').innerHTML = '<span>' + LS.fmtNum(st.points) + ' pts</span>' + (st.faces ? '<span>' + LS.fmtNum(st.faces) + ' tris</span>' : '') +
        '<span>' + st.size[0].toFixed(2) + ' × ' + st.size[1].toFixed(2) + ' × ' + st.size[2].toFixed(2) + ' m</span>' + (sc ? '<span class="sel">' + LS.fmtNum(sc) + ' selected</span>' : '');
      var sel = '<div class="st-sec"><h3>' + UI.icon('box') + 'Selection</h3>' +
        (sc ? '<p><b>' + LS.fmtNum(sc) + '</b> ' + (V.state.display === 'surface' ? 'vertices' : 'points') + ' selected (yellow).</p>' : '<p>Drag with Box or Lasso to select. Shift adds, Alt takes away.</p>') +
        '<div class="ui-row"><button class="ui-btn sm danger" data-del' + (sc ? '' : ' disabled') + '>' + UI.icon('trash') + 'Delete</button>' +
        '<button class="ui-btn sm" data-keep' + (sc ? '' : ' disabled') + ' title="Delete everything else">' + UI.icon('crop') + 'Keep only</button>' +
        '<button class="ui-btn sm" data-invert>' + UI.icon('invert') + 'Invert</button>' + (sc ? '<button class="ui-btn sm ghost" data-clear>Clear</button>' : '') + '</div>' +
        '<div style="margin-top:10px"><label class="rng"><span>Height from</span><input type="range" min="0" max="' + V.height.toFixed(2) + '" step="0.01" value="' + (V.height * 0.85).toFixed(2) + '" data-hlo><output data-hlov>' + (V.height * 0.85).toFixed(2) + '</output></label>' +
        '<label class="rng"><span>to</span><input type="range" min="0" max="' + (V.height + 0.2).toFixed(2) + '" step="0.01" value="' + (V.height + 0.2).toFixed(2) + '" data-hhi><output data-hhiv>' + (V.height + 0.2).toFixed(2) + '</output></label>' +
        '<button class="ui-btn sm" data-hsel>' + UI.icon('layers') + 'Select this height band</button></div></div>';
      var body = '';
      if (tool === 'nav' || tool === 'box' || tool === 'lasso') {
        body = sel;
      } else if (tool === 'level') {
        body = '<div class="st-sec"><h3>' + UI.icon('level') + 'Level the floor</h3><p>Click three points on the floor, spread apart. The room turns so the floor is flat, at height 0.</p>' +
          '<p><b>' + picks.length + ' of 3</b> picked.</p>' + (picks.length ? '<button class="ui-btn sm ghost" data-resetpicks>Start again</button>' : '') + '</div>';
      } else if (tool === 'scale') {
        body = '<div class="st-sec"><h3>' + UI.icon('ruler') + 'Set the real size</h3><p>Click both ends of something you know the length of: a door, a table, a tiled wall. Then type its real length.</p>' +
          '<p><b>' + picks.length + ' of 2</b> picked.</p><p class="small">Now: ' + (scaleSource === 'calibrated' ? 'calibrated' : scaleSource === 'import' ? 'from the imported file' : 'estimated from the phone\'s height') + '.</p></div>';
      } else if (tool === 'turn') {
        body = '<div class="st-sec"><h3>' + UI.icon('rotate') + 'Turn</h3><p>Line the walls up with the grid, so plans and measurements read nicely.</p>' +
          '<label class="rng"><span>Angle</span><input type="range" min="-180" max="180" step="0.5" value="' + turnDeg + '" data-turn><output data-turnv>' + turnDeg + '°</output></label>' +
          '<div class="ui-row"><button class="ui-btn sm" data-turn90="-90">−90°</button><button class="ui-btn sm" data-turn90="90">+90°</button><button class="ui-btn sm primary" data-turnapply>Apply</button></div></div>' +
          '<div class="st-sec"><h3>' + UI.icon('move') + 'Recentre</h3><p>Put the room in the middle of the grid, with the lowest point on the floor.</p><button class="ui-btn sm" data-recentre>' + UI.icon('target') + 'Recentre</button></div>';
      } else if (tool === 'clean') {
        body = '<div class="st-sec"><h3>' + UI.icon('wand') + 'Stray points</h3><p>Finds lonely points floating in the air (reflections, people walking by) and selects them.</p>' +
          '<label class="rng"><span>Strength</span><input type="range" min="1" max="10" value="4" data-strength><output data-strengthv>4</output></label>' +
          '<button class="ui-btn sm" data-strays>' + UI.icon('search') + 'Find strays</button></div>' +
          (hasPts ? '<div class="st-sec"><h3>' + UI.icon('grid') + 'Thin out</h3><p>Fewer points load faster on phones. Keeps one point per little cube.</p>' +
            '<label class="rng"><span>Spacing</span><input type="range" min="0.5" max="6" step="0.5" value="1.5" data-voxel><output data-voxelv>1.5 cm</output></label>' +
            '<button class="ui-btn sm" data-thin>' + UI.icon('grid') + 'Thin out</button></div>' : '') + sel;
      } else if (tool === 'color') {
        body = '<div class="st-sec"><h3>' + UI.icon('sun') + 'Colours</h3><p>' + (sc ? 'Changes the selected points only.' : 'Changes the whole room. Select first to change a part.') + '</p>' +
          [['bright', 'Brightness', -40, 40], ['contrast', 'Contrast', -50, 60], ['sat', 'Saturation', -100, 80], ['warm', 'Warmth', -60, 60]].map(function (r) {
            return '<label class="rng"><span>' + r[1] + '</span><input type="range" min="' + r[2] + '" max="' + r[3] + '" value="0" data-cadj="' + r[0] + '"><output>0</output></label>';
          }).join('') + '<div class="ui-row"><button class="ui-btn sm ghost" data-ccancel>Reset</button><button class="ui-btn sm primary" data-capply>Apply</button></div></div>' +
          '<div class="st-sec"><h3>' + UI.icon('brush') + 'Paint the selection</h3><div class="st-swatch">' + SWATCHES.map(function (c) { return '<button style="background:' + c + '" data-swatch="' + c + '" aria-label="' + c + '"></button>'; }).join('') +
          '<input type="color" value="#c2522b" data-pickcolor aria-label="Any colour"></div>' +
          '<label class="rng"><span>Strength</span><input type="range" min="10" max="100" value="60" data-pamount><output>60%</output></label>' +
          '<button class="ui-btn sm" data-paint' + (sc ? '' : ' disabled') + '>' + UI.icon('brush') + 'Paint</button></div>' + sel;
      } else if (tool === 'pins') {
        body = '<div class="st-sec"><h3>' + UI.icon('pinplus') + 'Pins</h3><p>Click the room to add a pin. Pins move with the room when you turn or resize it.</p>' +
          (annotations.length ? annotations.map(function (a, i) {
            return '<div class="sc-pin" style="margin-bottom:6px"><span class="dot ' + esc(a.color) + '"></span><div class="grow"><b>' + esc(a.label) + '</b></div><button class="ui-btn ghost icon sm" data-rmpin="' + i + '" aria-label="Remove pin">' + UI.icon('trash') + '</button></div>';
          }).join('') : '<p class="small">No pins yet.</p>') + '</div>';
      }
      p.innerHTML = '<div class="st-sec st-small" style="display:' + (window.innerWidth < 980 ? 'block' : 'none') + '"><p style="margin:0">' + UI.icon('info') + ' Studio works best on a computer: right-drag turns the view, scroll zooms.</p></div>' +
        '<div class="st-sec"><h3>' + UI.icon('eye') + 'View</h3><div class="ui-row">' +
        (hasMesh && hasPts ? '<div class="ui-seg"><button data-disp="points" class="' + (V.state.display === 'points' ? 'on' : '') + '">Points</button><button data-disp="surface" class="' + (V.state.display === 'surface' ? 'on' : '') + '">Surface</button></div>' : '') +
        '<div class="ui-seg"><button data-col="photo" class="' + (V.state.color === 'photo' ? 'on' : '') + '">Photo</button><button data-col="height" class="' + (V.state.color === 'height' ? 'on' : '') + '">Height</button></div></div>' +
        '<label class="ui-check" style="margin-top:8px;font-size:.88rem"><input type="checkbox" data-cut' + (V.state.cut ? ' checked' : '') + '> Hide the ceiling</label>' +
        (hasPts ? '<label class="rng" style="margin-top:6px"><span>Point size</span><input type="range" min="0.4" max="3" step="0.1" value="' + V.state.size + '" data-psize><output></output></label>' : '') + '</div>' +
        body +
        '<div class="st-sec"><h3>' + UI.icon('cube') + 'This room</h3><dl class="st-kv"><dt>Points</dt><dd>' + LS.fmtNum(st.points) + '</dd>' + (st.faces ? '<dt>Triangles</dt><dd>' + LS.fmtNum(st.faces) + '</dd>' : '') +
        '<dt>Size</dt><dd>' + st.size[0].toFixed(2) + ' × ' + st.size[1].toFixed(2) + ' × ' + st.size[2].toFixed(2) + ' m</dd><dt>Scale</dt><dd>' + esc(scaleSource) + '</dd><dt>Pins</dt><dd>' + annotations.length + '</dd></dl></div>' +
        '<div class="st-sec"><h3>' + UI.icon('history') + 'History</h3>' + (log.length ? '<ul class="st-hist">' + log.slice().reverse().map(function (h, i) {
          return '<li class="' + (i < redo.length ? 'undone' : '') + '">' + UI.icon(h.icon) + esc(h.label) + '</li>';
        }).join('') + '</ul>' : '<p style="margin:0">Nothing changed yet. Your edits show here, and Undo steps back.</p>') + '</div>';
    }
    function setTool(t) {
      if (tool === 'color' && t !== 'color') colorCancel();
      if (tool === 'turn' && t !== 'turn' && turnDeg) { V.group.rotation.y = 0; turnDeg = 0; V.needs = true; }
      tool = t; picks = [];
      V.clearMeasures();
      view.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tool') === t); });
      var selecting = t === 'box' || t === 'lasso';
      V.controls.mouseButtons = { LEFT: selecting ? null : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: selecting ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN };
      V.renderer.domElement.style.cursor = selecting || t === 'level' || t === 'scale' || t === 'pins' ? 'crosshair' : '';
      var hints = { box: 'Drag a box to select. Shift adds, Alt takes away. Right-drag turns the view.', lasso: 'Draw around what to select. Right-drag turns the view.',
        level: 'Click 3 points on the floor.', scale: 'Click both ends of something you know the length of.', pins: 'Click where the pin goes.' };
      if (hints[t]) V.hint(hints[t], 4500);
      drawSide();
    }

    /* -------------------------------------------- pointer: selection drawing + picks */
    function wireStage() {
      var c = V.renderer.domElement, svg = view.querySelector('[data-selsvg]');
      function local(e) { var r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
      c.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 || (tool !== 'box' && tool !== 'lasso')) return;
        var p = local(e);
        drag = { tool: tool, pts: [p], mode: e.shiftKey ? 'add' : e.altKey ? 'sub' : 'set' };
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var p = local(e);
        if (drag.tool === 'box') drag.pts[1] = p; else drag.pts.push(p);
        svg.innerHTML = '<svg>' + (drag.tool === 'box' && drag.pts[1]
          ? '<rect x="' + Math.min(drag.pts[0][0], p[0]) + '" y="' + Math.min(drag.pts[0][1], p[1]) + '" width="' + Math.abs(p[0] - drag.pts[0][0]) + '" height="' + Math.abs(p[1] - drag.pts[0][1]) + '" fill="rgba(217,164,60,.12)" stroke="#d9a43c" stroke-width="1.5" stroke-dasharray="5 4"/>'
          : '<polygon points="' + drag.pts.map(function (q) { return q.join(','); }).join(' ') + '" fill="rgba(217,164,60,.12)" stroke="#d9a43c" stroke-width="1.5" stroke-dasharray="5 4"/>') + '</svg>';
      });
      c.addEventListener('pointerup', function () {
        if (!drag) return;
        var d = drag; drag = null; svg.innerHTML = '';
        if (d.tool === 'box') {
          if (!d.pts[1]) return;
          var x0 = Math.min(d.pts[0][0], d.pts[1][0]), x1 = Math.max(d.pts[0][0], d.pts[1][0]), y0 = Math.min(d.pts[0][1], d.pts[1][1]), y1 = Math.max(d.pts[0][1], d.pts[1][1]);
          if (x1 - x0 < 3 || y1 - y0 < 3) { if (d.mode === 'set') clearSel(); return; }
          selectScreen(function (x, y) { return x >= x0 && x <= x1 && y >= y0 && y <= y1; }, d.mode);
        } else {
          if (d.pts.length < 4) return;
          var w = c.clientWidth, h = c.clientHeight, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          var cx = cv.getContext('2d'); cx.beginPath(); d.pts.forEach(function (q, i) { i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1]); }); cx.closePath(); cx.fill();
          var data = cx.getImageData(0, 0, w, h).data;
          selectScreen(function (x, y) { x |= 0; y |= 0; return x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0; }, d.mode);
        }
      });
      V.onPick = function (p) {
        if (tool === 'level' || tool === 'scale') {
          if (!p) { V.hint('Click right on the room.', 1600); return false; }
          picks.push(p); V._marker(p);
          if (tool === 'level' && picks.length === 3) { var a = picks; picks = []; V.clearMeasures(); levelFrom(a[0], a[1], a[2]); }
          else if (tool === 'scale' && picks.length === 2) { var b = picks; picks = []; V.addMeasure(b[0], b[1]); scaleFrom(b[0], b[1]); }
          drawSide();
          return false;
        }
        if (tool === 'pins') { if (p) addPin(p); else V.hint('Click right on the room.', 1600); return false; }
        return true;
      };
    }

    /* -------------------------------------------- save + export */
    function save() {
      var note = '';
      var m = UI.modal('<h2>Save a new version</h2><p class="muted">The current version stays in the room\'s Versions, so you can always go back.</p>' +
        '<form class="ui-stack" data-saveform><label class="ui-field"><span>What did you change?</span><input type="text" name="note" maxlength="120" value="' + esc(log.length ? log[log.length - 1].label : 'Edited in Studio') + '"></label>' +
        '<div data-progress hidden><div class="cp-up"><i data-upbar></i></div><p class="small muted" data-uptext></p></div>' +
        '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">' + UI.icon('save') + 'Save</button></div></form>');
      var f = m.el.querySelector('[data-saveform]');
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        note = UI.formData(f).note;
        f.querySelector('[type=submit]').disabled = true; f.querySelector('[data-progress]').hidden = false;
        var bar = f.querySelector('[data-upbar]'), txt = f.querySelector('[data-uptext]');
        clearSel(true); V.setColor(V.state.color);
        var files = [];
        if (V.layers.points) files.push(['cloud', LS.writePLY(V.layers.points.geom)]);
        if (V.layers.surface) files.push(['mesh', LS.writePLY(V.layers.surface.geom)]);
        if (!V.layers.points && V.layers.surface) {
          var pg = new THREE.BufferGeometry(); pg.setAttribute('position', V.layers.surface.geom.attributes.position); pg.setAttribute('color', V.layers.surface.geom.attributes.color);
          files.unshift(['cloud', LS.writePLY(pg)]);
        }
        var total = files.reduce(function (a, x) { return a + x[1].byteLength; }, 0), done = 0;
        LS.uploadFiles(files, function (n) { done += n; bar.style.width = Math.round(done / total * 100) + '%'; txt.textContent = 'Uploading ' + (done / 1048576).toFixed(1) + ' of ' + (total / 1048576).toFixed(1) + ' MB'; })
          .then(function (keys) {
            txt.textContent = 'Saving…';
            return UI.api('upload_finish', { scan_id: scan.id, cloud: keys.cloud, mesh: keys.mesh || null, note: note, stats: stats(), annotations: annotations, path: path, scale_source: scaleSource });
          }).then(function (r) {
            m.close(); dirty = false; scan = r.scan; drawSide();
            UI.toast('Saved as version ' + r.scan.model.n, 'ok');
            try { UI.apiQuiet('set_thumb', scan.id, V.snapshot(640, 480, true)).catch(function () {}); } catch (err) {}
          }, function (err) { txt.textContent = err.message; f.querySelector('[type=submit]').disabled = false; });
      });
    }
    function exportFile() {
      var name = (scan.title || 'room').replace(/[^\w\- ]+/g, '').trim() || 'room';
      var m = UI.modal('<h2>Export</h2><p class="muted">Download the room as it is now, with your edits.</p><div class="ui-stack">' +
        (V.layers.points ? '<button class="ui-btn block" data-ex="cloud">' + UI.icon('download') + 'Points (.ply)</button>' : '') +
        (V.layers.surface ? '<button class="ui-btn block" data-ex="mesh">' + UI.icon('download') + 'Surface (.ply)</button>' : '') +
        '<button class="ui-btn block" data-ex="glb">' + UI.icon('download') + 'Everything (.glb, for Blender, SketchUp, game engines)</button></div>');
      m.el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-ex]'); if (!b) return;
        var k = b.getAttribute('data-ex');
        clearSel(true); V.setColor(V.state.color);
        if (k === 'glb') {
          new THREE.GLTFExporter().parse(V.group, function (buf) { dl(new Blob([buf], { type: 'model/gltf-binary' }), name + '.glb'); m.close(); }, function (er) { UI.toast(String(er), 'error'); }, { binary: true });
        } else {
          dl(new Blob([LS.writePLY(V.layers[k === 'cloud' ? 'points' : 'surface'].geom)]), name + (k === 'mesh' ? '-surface' : '') + '.ply'); m.close();
        }
      });
    }
    function dl(blob, n) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = n; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); UI.toast('Downloaded ' + n, 'ok'); }

    function doUndo() { if (!undo.length) return; var s = undo.pop(); redo.push(snapshot(s.label)); restore(s); dirty = true; drawSide(); }
    function doRedo() { if (!redo.length) return; var s = redo.pop(); undo.push(snapshot(s.label)); restore(s); dirty = true; drawSide(); }

    /* -------------------------------------------- events */
    view.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-tool]'))) setTool(t.getAttribute('data-tool'));
      else if (e.target.closest('[data-back]')) {
        if (!dirty) { UI.go('scan', scan.id); return; }
        UI.confirm({ title: 'Leave without saving?', text: 'Your changes since the last save are lost.', ok: 'Leave', danger: true }).then(function (y) { if (y) { dirty = false; UI.go('scan', scan.id); } });
      }
      else if (e.target.closest('[data-undo]')) doUndo();
      else if (e.target.closest('[data-redo]')) doRedo();
      else if (e.target.closest('[data-save]')) save();
      else if (e.target.closest('[data-export]')) exportFile();
      else if (e.target.closest('[data-keys]')) keysHelp();
      else if (e.target.closest('[data-del]')) deleteSel(false);
      else if (e.target.closest('[data-keep]')) deleteSel(true);
      else if (e.target.closest('[data-invert]')) invertSel();
      else if (e.target.closest('[data-clear]')) clearSel();
      else if (e.target.closest('[data-hsel]')) selectHeight(+view.querySelector('[data-hlo]').value, +view.querySelector('[data-hhi]').value);
      else if (e.target.closest('[data-resetpicks]')) { picks = []; V.clearMeasures(); drawSide(); }
      else if ((t = e.target.closest('[data-turn90]'))) { turnDeg = 0; turnApply(+t.getAttribute('data-turn90')); }
      else if (e.target.closest('[data-turnapply]')) turnApply(turnDeg);
      else if (e.target.closest('[data-recentre]')) recentre();
      else if (e.target.closest('[data-strays]')) findStrays(+view.querySelector('[data-strength]').value);
      else if (e.target.closest('[data-thin]')) thinOut(+view.querySelector('[data-voxel]').value);
      else if (e.target.closest('[data-capply]')) colorApply();
      else if (e.target.closest('[data-ccancel]')) { colorCancel(); drawSide(); }
      else if ((t = e.target.closest('[data-swatch]'))) { var pc = view.querySelector('[data-pickcolor]'); if (pc) pc.value = t.getAttribute('data-swatch'); }
      else if (e.target.closest('[data-paint]')) paint(view.querySelector('[data-pickcolor]').value, +view.querySelector('[data-pamount]').value / 100);
      else if ((t = e.target.closest('[data-rmpin]'))) { var i = +t.getAttribute('data-rmpin'); commit('Removed a pin', function () { annotations.splice(i, 1); }); }
      else if ((t = e.target.closest('[data-disp]'))) { V.setDisplay(t.getAttribute('data-disp')); drawSide(); }
      else if ((t = e.target.closest('[data-col]'))) { V.setColor(t.getAttribute('data-col')); drawSide(); }
    });
    view.addEventListener('input', function (e) {
      var t = e.target, out = t.parentNode && t.parentNode.querySelector('output');
      if (t.matches('[data-turn]')) { turnDeg = +t.value; V.group.rotation.y = turnDeg * Math.PI / 180; V.needs = true; if (out) out.textContent = turnDeg + '°'; }
      else if (t.matches('[data-cadj]')) {
        if (out) out.textContent = t.value;
        var o = {}; view.querySelectorAll('[data-cadj]').forEach(function (r) { o[r.getAttribute('data-cadj')] = +r.value; });
        colorPreview(o);
      }
      else if (t.matches('[data-psize]')) V.setPointSize(+t.value);
      else if (t.matches('[data-voxel]')) { if (out) out.textContent = t.value + ' cm'; }
      else if (t.matches('[data-pamount]')) { if (out) out.textContent = t.value + '%'; }
      else if (out) out.textContent = t.value;
    });
    view.addEventListener('change', function (e) { if (e.target.matches('[data-cut]')) V.setCut(e.target.checked); });
    function keysHelp() {
      UI.modal('<h2>Keyboard shortcuts</h2><div class="st-keys">' + [['V', 'Look around'], ['B', 'Box select'], ['L', 'Lasso'], ['F', 'Level the floor'], ['C', 'Set the real size'],
        ['R', 'Turn and move'], ['N', 'Clean up'], ['K', 'Colours'], ['P', 'Pins'], ['Delete', 'Delete the selection'], ['Enter', 'Keep only the selection'], ['I', 'Invert the selection'],
        ['Esc', 'Clear the selection'], ['Ctrl Z', 'Undo'], ['Ctrl Shift Z', 'Redo'], ['Ctrl S', 'Save a version'], ['Shift drag', 'Add to the selection'], ['Alt drag', 'Take away'],
        ['Right drag', 'Turn the view while selecting']].map(function (k) { return '<kbd>' + k[0] + '</kbd><span>' + k[1] + '</span>'; }).join('') + '</div>');
    }
    function onKey(e) {
      if (!V || /input|textarea|select/i.test(e.target.tagName) || document.querySelector('.ui-modal-wrap')) return;
      var k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); save(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSel(false); return; }
      if (k === 'enter') { deleteSel(true); return; }
      if (k === 'escape') { clearSel(); return; }
      if (k === 'i') { invertSel(); return; }
      var t = TOOLS.filter(function (x) { return x[3] === k; })[0];
      if (t) setTool(t[0]);
    }
    function onUnload(e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } }
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);

    function load() {
      return UI.api('get_scan', id).then(function (r) {
        if (r.redirect) { UI.toast('You can only edit your own rooms. Copy it to your rooms first.', 'error'); location.hash = r.redirect; return; }
        scan = r.scan;
        if (scan.status !== 'ready' || !scan.can_edit) { UI.toast('This room isn\'t ready to edit yet.', 'error'); UI.go('scan', scan.id); return; }
        annotations = JSON.parse(JSON.stringify(scan.annotations || []));
        path = JSON.parse(JSON.stringify(scan.path || []));
        scaleSource = scan.scale_source || 'estimated';
        drawShell();
        return LS.open(view.querySelector('[data-view]'), scan, {}).then(function (v) {
          if (!alive) { v.dispose(); return; }
          V = v;
          window.LS_STUDIO = { viewer: V, commit: commit, selectHeight: selectHeight, deleteSel: deleteSel, setTool: setTool, undo: doUndo, stats: stats };
          V.setShowPath(false);
          wireStage();
          setTool('nav');
          drawSide();
        });
      });
    }
    return {
      ready: load(),
      destroy: function () {
        alive = false; window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload);
        if (V) V.dispose(); window.LS_STUDIO = null;
      }
    };
  });
})();
