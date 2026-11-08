/* ls-kit.js: the small window.UI helpers Logsteps' JavaScript engines (ls-viewer.js, ls-cards.js, ls-screens.js) were
   written against, now that the app itself is Python Forms. Loaded after app-kit.js (UI.esc, UI.store, UI.icon, UI.ICONS,
   light/dark) and before the engines.

   Server:   UI.api(fn, ...args) / UI.apiQuiet go through window.LS_BRIDGE, a Python function set by client_code/ls.py
             (anvil.server.call there). A reply {ok: false, error} rejects with err.expected = true; errors nobody catches
             become a toast.
   Host:     LS.host = Python functions (client_code/ls.py): toast, confirm, go. UI.toast / UI.confirm use them, so the
             engines show the same notifications and dialogs as the Forms.
   Screens:  UI.page(name, opts, mount) keeps an engine screen in UI.pages; Components/Screen mounts it with
             UI.mountScreen (capture and studio in ls-screens.js).
   Views:    LS.mountView(viewEl, barEl, scan, opts, hooks) = the 3D view + its control bar for a page (Components/Viewer).
   Also:     UI.me, UI.go, UI.busy, UI.formData, UI.ago, UI.fmtDate, UI.initials, UI.modal (plain dialog for engine-only
             prompts) and [data-go] links inside engine markup. */
(function () {
  'use strict';
  var UI = window.UI = window.UI || {};
  var LS = window.LS = window.LS || {};
  UI.pages = UI.pages || {};
  UI.me = UI.me || null;
  LS.host = LS.host || {};

  UI.page = function (name, opts, mount) {
    if (typeof opts === 'function') { mount = opts; opts = {}; }
    opts.name = name; opts.mount = mount;
    UI.pages[name] = opts;
  };
  /* Mount an engine screen into el. Returns {ready: Promise, destroy()}; UI_READY turns true when it has loaded. */
  UI.mountScreen = function (name, el, args) {
    var p = UI.pages[name];
    if (!p) throw new Error('No screen called ' + name);
    var out;
    try { out = p.mount(el, { name: name, args: args || [], me: UI.me, go: UI.go, api: UI.api, page: p }); }
    catch (e) { console.error(e); out = Promise.reject(e); }
    var ready = out && typeof out.then === 'function' ? out : (out && out.ready) || Promise.resolve();
    ready = Promise.resolve(ready).then(function (v) { window.UI_READY = true; return v; }, function (e) {
      window.UI_READY = true;
      console.error(e);
      if (!el.innerHTML) el.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('info') + '<h3>This page didn\'t load</h3><p class="muted">' +
        UI.esc(e && e.message || 'Something went wrong.') + '</p></div></div>';
    });
    return { ready: ready, destroy: (out && out.destroy) || function () {} };
  };

  UI.initials = UI.initials || function (name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  };
  UI.fmtDate = function (iso, opts) {
    if (!iso) return '';
    var d = iso.length <= 10 ? new Date(iso + 'T12:00:00') : new Date(iso);
    return d.toLocaleDateString([], opts || { day: 'numeric', month: 'short', year: 'numeric' });
  };
  UI.ago = function (iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    var steps = [[60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']], n = s / 60;
    for (var i = 0; i < steps.length; i++) {
      if (n < steps[i][0]) { n = Math.floor(n); return UI.plural(n, steps[i][1]) + ' ago'; }
      n = n / steps[i][0];
    }
    return '';
  };
  UI.formData = function (form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    return out;
  };
  UI.busy = function (btn, promise) {
    if (!btn) return promise;
    btn.disabled = true; btn.classList.add('is-busy');
    var done = function () { btn.disabled = false; btn.classList.remove('is-busy'); };
    promise.then(done, done);
    return promise;
  };
  UI.hashFor = function (name) {
    var args = Array.prototype.slice.call(arguments, 1).filter(function (a) { return a != null && a !== ''; });
    return '#' + [name].concat(args.map(encodeURIComponent)).join('/');
  };
  UI.go = function () {
    var h = UI.hashFor.apply(null, arguments);
    if (location.hash === h && LS.host.go) LS.host.go(h); else location.hash = h;
  };

  /* ------------------------------------------------------------------ toasts and dialogs */
  UI.toast = function (msg, kind) {
    if (LS.host.toast) { try { LS.host.toast(String(msg), kind || ''); return; } catch (e) { /* fall through */ } }
    console.log('[toast]', msg);
  };
  UI.confirm = function (o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    if (LS.host.confirm) return Promise.resolve(LS.host.confirm(JSON.stringify(o))).then(function (v) { return !!v; });
    return Promise.resolve(window.confirm(o.title || 'Are you sure?'));
  };
  /* A plain dialog for the editors' own small prompts (Studio's calibrate, keys help; Capture's "No camera"). */
  UI.modal = function (html, opts) {
    opts = opts || {};
    var prev = document.activeElement, wrap = document.createElement('div');
    wrap.className = 'ui ui-modal-wrap';
    wrap.innerHTML = '<div class="ui-modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" tabindex="-1">' +
      '<button type="button" class="ui-btn ghost icon ui-modal-x" data-close aria-label="Close">' + UI.icon('x') + '</button>' + html + '</div>';
    document.body.appendChild(wrap);
    document.documentElement.classList.add('ui-modal-open');
    function key(e) { if (e.key === 'Escape') close(); }
    function close() {
      if (!wrap.parentNode) return;
      wrap.remove(); document.removeEventListener('keydown', key);
      if (!document.querySelector('.ui-modal-wrap')) document.documentElement.classList.remove('ui-modal-open');
      if (opts.onclose) opts.onclose();
      if (prev && prev.focus) prev.focus();
    }
    document.addEventListener('keydown', key);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    var first = wrap.querySelector('input, textarea, select') || wrap.querySelector('.ui-modal');
    setTimeout(function () { if (first.focus) first.focus(); }, 30);
    return { el: wrap.querySelector('.ui-modal'), close: close };
  };

  /* ------------------------------------------------------------------ the server, through Python */
  function send(kind, payload) {
    if (!window.LS_BRIDGE) return Promise.reject(new Error('The app is still starting.'));
    var out;
    try { out = window.LS_BRIDGE(kind, JSON.stringify(payload || {})); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(out).then(function (r) {
      r = typeof r === 'string' ? JSON.parse(r) : (r || {});
      if (r.error) {
        var err = new Error(r.error); err.uiApi = true; err.denied = !!r.denied;
        if (r.detail) console.error(kind, payload && payload.fn, r.detail);
        if (r.reload) setTimeout(function () { location.reload(); }, 2500);
        throw err;
      }
      return r.result;
    });
  }
  function expected(res) {
    if (res && typeof res === 'object' && res.ok === false) {
      var err = new Error(res.error || 'That didn\'t work.'); err.uiApi = true; err.expected = true; err.result = res;
      throw err;
    }
    return res;
  }
  UI.api = function (fn) { return send('call', { fn: fn, args: Array.prototype.slice.call(arguments, 1), quiet: false }).then(expected); };
  UI.apiQuiet = function (fn) { return send('call', { fn: fn, args: Array.prototype.slice.call(arguments, 1), quiet: true }).then(expected); };
  window.addEventListener('unhandledrejection', function (e) {
    if (e.reason && e.reason.uiApi) { e.preventDefault(); UI.toast(e.reason.message, 'error'); }
  });

  /* [data-go="page/arg"] inside engine markup (Capture's and Studio's back links and "upload a video instead") */
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-go]');
    if (!el) return;
    e.preventDefault();
    UI.go.apply(null, el.getAttribute('data-go').split('/'));
  });

  /* ------------------------------------------------------------------ the 3D view on a page (Components/Viewer)
     LS.mountView(viewEl, barEl, scanJson, optsJson, hooks) loads the room into viewEl (LS.open) and draws the standard
     control bar into barEl (LS.controls). Returns a handle at once; the model loads in the background.
     opts: {autoRotate}. hooks (Python functions): ready(), pick(pointJson or ''). */
  LS.mountView = function (viewEl, barEl, scanJson, optsJson, hooks) {
    var scan = typeof scanJson === 'string' ? JSON.parse(scanJson) : scanJson;
    var opts = optsJson ? JSON.parse(optsJson) : {};
    hooks = hooks || {};
    var h = { v: null, dead: false, picking: false };
    h.dispose = function () { h.dead = true; if (h.v) { try { h.v.dispose(); } catch (e) { console.error(e); } } h.v = null; };
    h.ready = function () { return !!h.v; };
    LS.open(viewEl, scan, {}).then(function (v) {
      if (h.dead) { v.dispose(); return; }
      h.v = v;
      if (opts.autoRotate) {
        v.controls.autoRotate = true; v.controls.autoRotateSpeed = 0.7;
        v.controls.addEventListener('start', function () { v.controls.autoRotate = false; });
      }
      LS.controls(barEl, v, scan, {});
      v.onPick = function (p) {
        if (!h.picking) return true;
        h.picking = false; v.renderer.domElement.style.cursor = '';
        if (hooks.pick) hooks.pick(p ? JSON.stringify([p.x, p.y, p.z]) : '');
        return false;
      };
      if (hooks.ready) hooks.ready();
    }).catch(function (e) { console.warn('3D view:', e && e.message); });
    /* the next tap on the room places a pin (hooks.pick gets the point) */
    h.pick = function (hint) {
      if (!h.v) return false;
      h.picking = true; h.v.renderer.domElement.style.cursor = 'crosshair'; h.v.hint(hint || 'Tap the spot for your pin.');
      return true;
    };
    h.setPins = function (json) { if (h.v) h.v.setPins(JSON.parse(json || '[]')); };
    h.thumb = function () { return h.v ? h.v.snapshot(640, 480, true) : ''; };
    /* downloads: kind = cloud | mesh (the PLY files) | glb (made in the browser from what the view shows) */
    h.download = function (kind) {
      var name = (scan.title || 'room').replace(/[^\w\- ]+/g, '').trim() || 'room';
      function save(blob, file) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        UI.toast('Downloaded ' + file, 'ok');
      }
      if (kind === 'glb') {
        if (!h.v) { UI.toast('The room is still loading.', 'error'); return; }
        new THREE.GLTFExporter().parse(h.v.group, function (buf) {
          save(new Blob([buf], { type: 'model/gltf-binary' }), name + '.glb');
        }, function (err) { UI.toast('Couldn\'t make the 3D file: ' + err, 'error'); }, { binary: true, onlyVisible: false });
        return;
      }
      var url = (scan.model || {})[kind];
      if (!url) return;
      LS.fetchBuffer(url).then(function (buf) { save(new Blob([buf], { type: 'application/octet-stream' }), name + (kind === 'mesh' ? '-surface' : '') + '.ply'); });
    };
    return h;
  };

  /* Copy text to the clipboard (falls back to selecting a field). Resolves true when it worked. */
  LS.copy = function (text) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    return Promise.resolve(false);
  };
  /* The phone's share sheet, when there is one. Resolves true if it opened. */
  LS.canShare = function () { return !!navigator.share; };
  LS.share = function (title, text, url) {
    if (!navigator.share) return Promise.resolve(false);
    return navigator.share({ title: title, text: text || undefined, url: url }).then(function () { return true; }, function () { return false; });
  };
})();
