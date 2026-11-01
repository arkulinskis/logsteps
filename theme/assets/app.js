/* core.js: the shared front-end engine (window.UI). Same in every app made from APP_MAKER/template;
   app-specific things live in web/app.js (brand, nav, footer) and web/pages/*.html (the pages).

   Pages:   UI.page(name, {title, nav, icon, auth, order, chrome}, mount)
              auth: null (anyone) | 'guest' (signed-out only) | 'user' | 'admin'
              nav: label for the header / phone tab bar (omit to keep it out of the menus)
              mount(view, ctx) draws into `view`; ctx = {args, me, go, api}. Return a Promise (the page
              is "ready" when it resolves) or {ready, destroy}. URLs are #name/arg1/arg2.
   Server:  UI.api(fn, ...args) -> Promise of the server function's return value. A reply of
              {ok: false, error} rejects with that message (shown as a toast unless you .catch it).
            UI.apiQuiet(fn, ...args) is the same without Anvil's loading spinner.
   Auth:    UI.auth('login'|'signup'|'reset'|'logout', {...}) -> Promise of {ok, me, message}
   Helpers: UI.esc, UI.icon, UI.toast, UI.modal, UI.confirm, UI.busy, UI.formData, UI.fmtDate, UI.ago,
            UI.store, UI.setTheme, UI.feedback, UI.go, UI.refresh
   Tests:   window.UI_READY is true when the current page has finished loading. */
(function () {
  'use strict';
  if (window.UI && window.UI.__v) return;
  var UI = window.UI = { __v: 1, pages: {}, me: null, config: { name: 'App', key: 'app', home: 'home', landing: 'landing' } };
  window.UI_READY = false;

  UI.configure = function (cfg) { Object.keys(cfg).forEach(function (k) { UI.config[k] = cfg[k]; }); };

  /* ------------------------------------------------------------------ small helpers */
  UI.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  UI.plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
  UI.initials = function (name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  };
  UI.fmtDate = function (iso, opts) {
    if (!iso) return '';
    var d = iso.length <= 10 ? new Date(iso + 'T12:00:00') : new Date(iso);
    return d.toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short', year: 'numeric' });
  };
  UI.fmtDateTime = function (iso) {
    return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
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
  UI.store = {
    get: function (k, dflt) { try { var v = localStorage.getItem(UI.config.key + '.' + k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
    set: function (k, v) { try { localStorage.setItem(UI.config.key + '.' + k, JSON.stringify(v)); } catch (e) {} }
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
  /* Disable a button while a Promise runs; returns the Promise. */
  UI.busy = function (btn, promise) {
    if (!btn) return promise;
    btn.disabled = true; btn.classList.add('is-busy');
    var done = function () { btn.disabled = false; btn.classList.remove('is-busy'); };
    promise.then(done, done);
    return promise;
  };

  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.7c2.2.6 3.5 2.4 3.5 5.3"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8V5M9 5.5 7.5 4M15 5.5 16.5 4M7 13H3M21 13h-4M7.5 18l-3 2M16.5 18l3 2M7.5 9.5l-3-2M16.5 9.5l3-2"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'
  };
  UI.ICONS = ICONS;
  UI.icon = function (name, cls) {
    return '<svg class="ui-ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.sparkle) + '</svg>';
  };

  /* ------------------------------------------------------------------ toasts, modals */
  UI.toast = function (msg, kind) {
    var box = document.querySelector('.ui-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'ui ui-toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'ui-toast' + (kind ? ' ' + kind : '');
    t.innerHTML = (kind === 'error' ? UI.icon('info') : kind === 'ok' ? UI.icon('check') : '') + '<span>' + UI.esc(msg) + '</span>';
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, kind === 'error' ? 6500 : 3200);
  };
  UI.modal = function (html, opts) {
    opts = opts || {};
    var prev = document.activeElement;
    var wrap = document.createElement('div');
    wrap.className = 'ui ui-modal-wrap';
    wrap.innerHTML = '<div class="ui-modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<button class="ui-btn ghost icon ui-modal-x" data-close aria-label="Close">' + UI.icon('x') + '</button>' + html + '</div>';
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
    var first = wrap.querySelector('input, textarea, select');
    setTimeout(function () { (first || wrap.querySelector('.ui-modal')).focus && (first || wrap.querySelector('.ui-modal')).focus(); }, 30);
    return { el: wrap.querySelector('.ui-modal'), close: close };
  };
  UI.confirm = function (o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    return new Promise(function (resolve) {
      var answered = false;
      var m = UI.modal('<h2>' + UI.esc(o.title || 'Are you sure?') + '</h2>' + (o.text ? '<p class="muted">' + UI.esc(o.text) + '</p>' : '') +
        '<div class="ui-row end" style="margin-top:20px"><button class="ui-btn ghost" data-close>' + UI.esc(o.cancel || 'Cancel') + '</button>' +
        '<button class="ui-btn ' + (o.danger ? 'danger solid' : 'primary') + '" data-ok>' + UI.esc(o.ok || 'OK') + '</button></div>',
      { onclose: function () { if (!answered) resolve(false); } });
      m.el.querySelector('[data-ok]').onclick = function () { answered = true; m.close(); resolve(true); };
    });
  };

  /* ------------------------------------------------------------------ theme */
  UI.theme = function () { return UI.store.get('theme', 'auto'); };
  UI.applyTheme = function (t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var dark = t === 'dark' || (t !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('ui-dark', !!dark);
  };
  UI.setTheme = function (t) { UI.store.set('theme', t); UI.applyTheme(t); };
  UI.applyTheme(UI.theme());
  if (window.matchMedia) {
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { UI.applyTheme(UI.theme()); }); } catch (e) {}
  }

  /* ------------------------------------------------------------------ server bridge */
  var bridge = null;
  function send(kind, payload) {
    if (!bridge) return Promise.reject(new Error('The app is still starting.'));
    var out;
    try { out = bridge(kind, JSON.stringify(payload || {})); } catch (e) { return Promise.reject(e); }
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
  function apiCall(quiet, fn, args) {
    return send('call', { fn: fn, args: args, quiet: quiet }).then(function (res) {
      if (res && typeof res === 'object' && res.ok === false) {
        var err = new Error(res.error || 'That didn\'t work.'); err.uiApi = true; err.expected = true; err.result = res;
        throw err;
      }
      return res;
    });
  }
  UI.api = function (fn) { return apiCall(false, fn, Array.prototype.slice.call(arguments, 1)); };
  UI.apiQuiet = function (fn) { return apiCall(true, fn, Array.prototype.slice.call(arguments, 1)); };
  /* Errors nobody caught become a toast, so a failed action is never silent. */
  window.addEventListener('unhandledrejection', function (e) {
    if (e.reason && e.reason.uiApi) { e.preventDefault(); UI.toast(e.reason.message, 'error'); }
  });

  /* Sign in / up / out. On success it navigates: to where the visitor was heading (UI.after) or home
     after signing in, to the landing page after signing out. */
  UI.auth = function (kind, payload) {
    return send(kind, payload || {}).then(function (r) {
      if (r && r.ok === false) { var err = new Error(r.error); err.uiApi = true; err.expected = true; throw err; }
      if (r && 'me' in r && (r.me || kind === 'logout')) {
        UI.me = r.me || null;
        var target = r.me ? (UI.after || '#' + UI.config.home) : '#' + UI.config.landing;
        UI.after = null;
        if (location.hash === target) route(); else location.hash = target;
      }
      return r;
    });
  };
  /* Update the signed-in user's details (e.g. a new name) and redraw the header, without reloading the page. */
  UI.setMe = function (me) {
    UI.me = me || null;
    if (shellRoot) renderChrome(current.name);
  };

  /* ------------------------------------------------------------------ pages and routing */
  UI.page = function (name, opts, mount) {
    if (typeof opts === 'function') { mount = opts; opts = {}; }
    opts.name = name; opts.mount = mount;
    UI.pages[name] = opts;
  };
  UI.allowed = function (p) {
    if (!p) return false;
    if (p.auth === 'user') return !!UI.me;
    if (p.auth === 'admin') return !!(UI.me && UI.me.is_admin);
    if (p.auth === 'guest') return !UI.me;
    return true;
  };
  UI.navPages = function () {
    return Object.keys(UI.pages).map(function (k) { return UI.pages[k]; })
      .filter(function (p) { return p.nav && UI.allowed(p) && (!p.when || p.when()); })
      .sort(function (a, b) { return (a.order || 50) - (b.order || 50); });
  };
  UI.parseHash = function () {
    var h = (location.hash || '').replace(/^#!?\/?/, '');
    var parts = h.split('?')[0].split('/').filter(function (x) { return x !== ''; }).map(decodeURIComponent);
    return { name: parts[0] || '', args: parts.slice(1) };
  };
  UI.hashFor = function (name) {
    var args = Array.prototype.slice.call(arguments, 1).filter(function (a) { return a != null && a !== ''; });
    return '#' + [name].concat(args.map(encodeURIComponent)).join('/');
  };
  UI.go = function (name) {
    var h = UI.hashFor.apply(null, arguments);
    if (location.hash === h) route(); else location.hash = h;
  };
  UI.refresh = function () { route(); };
  UI.after = null;  // where to go after signing in

  var shellRoot = null, view = null, current = { name: null, destroy: null }, routeSeq = 0;

  function defaultPage() { return UI.me ? UI.config.home : UI.config.landing; }

  function route() {
    var r = UI.parseHash(), name = r.name || defaultPage(), p = UI.pages[name];
    if (!p) { name = defaultPage(); p = UI.pages[name]; r.args = []; }
    if (p.auth === 'guest' && UI.me) { p = UI.pages[UI.config.home]; name = UI.config.home; r.args = []; }
    if ((p.auth === 'user' || p.auth === 'admin') && !UI.me) {
      UI.after = location.hash && location.hash !== '#' ? location.hash : null;
      p = UI.pages.auth; name = 'auth'; r.args = [];
    }
    if (p.auth === 'admin' && !(UI.me && UI.me.is_admin)) {
      UI.toast('That page is for admins only.', 'error');
      p = UI.pages[UI.config.home]; name = UI.config.home; r.args = [];
    }
    var seq = ++routeSeq;
    window.UI_READY = false;
    if (current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
    current = { name: name, args: r.args, destroy: null };
    if (shellRoot) {
      shellRoot.className = 'ui ui-shell page-' + name + (UI.me ? ' signed-in' : ' signed-out') + (p.chrome === false ? ' no-chrome' : '');
      renderChrome(name);
    }
    // A fresh element for every page, so listeners a page adds to `view` never pile up.
    var fresh = view.cloneNode(false);
    view.parentNode.replaceChild(fresh, view);
    view = fresh;
    window.scrollTo(0, 0);
    document.title = (p.title ? (typeof p.title === 'function' ? p.title(r.args) : p.title) + ' · ' : '') + UI.config.name;
    var ctx = { name: name, args: r.args, me: UI.me, go: UI.go, api: UI.api, page: p };
    var out;
    try { out = p.mount(view, ctx); } catch (e) { console.error(e); out = Promise.reject(e); }
    var ready = out && typeof out.then === 'function' ? out : (out && out.ready) || Promise.resolve();
    if (out && out.destroy) current.destroy = out.destroy;
    Promise.resolve(ready).then(function () { if (seq === routeSeq) window.UI_READY = true; },
      function (e) {
        if (seq !== routeSeq) return;
        console.error(e);
        if (!view.innerHTML) view.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('info') +
          '<h3>This page didn\'t load</h3><p class="muted">' + UI.esc(e && e.message || 'Something went wrong.') + '</p>' +
          '<button class="ui-btn" onclick="UI.refresh()">Try again</button></div></div>';
        window.UI_READY = true;
      });
  }
  UI.current = function () { return current; };

  /* The shell's parts come from web/app.js: UI.shell = {header(me, active), footer(me), tabbar(me, active)} */
  function renderChrome(active) {
    var S = UI.shell || {};
    var hd = shellRoot.querySelector('[data-ui-header]'), ft = shellRoot.querySelector('[data-ui-footer]'), tb = shellRoot.querySelector('[data-ui-tabbar]');
    if (hd) hd.innerHTML = S.header ? S.header(UI.me, active) : '';
    if (ft) ft.innerHTML = S.footer ? S.footer(UI.me, active) : '';
    if (tb) tb.innerHTML = S.tabbar ? S.tabbar(UI.me, active) : '';
  }
  UI.renderChrome = function () { if (shellRoot) renderChrome(current.name); };

  /* Called by client_code/Main.py (and by the local harness) once the page is up. */
  UI.start = function (node, bridgeFn, bootJson) {
    bridge = bridgeFn;
    var boot = typeof bootJson === 'string' ? JSON.parse(bootJson || '{}') : (bootJson || {});
    UI.me = boot.me || null;
    var host = node && node.matches && node.matches('[data-ui-app]') ? node : (node && node.querySelector('[data-ui-app]')) || node || document.body;
    host.innerHTML = '<div class="ui ui-shell">' +
      '<header class="ui-header" data-ui-header></header>' +
      '<main class="ui-main" data-ui-view></main>' +
      '<footer class="ui-footer" data-ui-footer></footer>' +
      '<nav class="ui-tabbar" data-ui-tabbar aria-label="Main"></nav></div>';
    shellRoot = host.firstChild;
    view = host.querySelector('[data-ui-view]');
    if (UI.shell && UI.shell.wire) UI.shell.wire(shellRoot);
    window.addEventListener('hashchange', route);
    route();
  };

  /* ------------------------------------------------------------------ feedback (footer + menu)
     All feedback goes to Prepsto. The widget tag in head.html (data-prepsto="CODE") slides its panel in;
     any [data-feedback] or [data-prepsto-open] element opens it. If the widget hasn't loaded, the panel opens in a new tab.
     There is no in-app feedback form any more: Admin -> Feedback only lists older messages (and app requests). */
  UI.feedback = function () {
    if (window.Prepsto && window.Prepsto.open) { window.Prepsto.open(); return; }
    var tag = document.querySelector('script[data-prepsto]');
    var code = tag && tag.getAttribute('data-prepsto');
    if (code && code.indexOf('__') !== 0) window.open('https://prepsto.com/#f/' + encodeURIComponent(code), '_blank', 'noopener');
    else UI.toast('Feedback is not set up yet.', 'error');
  };

  /* Shared clicks: [data-go="page/arg"], [data-feedback], [data-theme-set] anywhere in the app. */
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-go],[data-feedback],[data-theme-set]');
    if (!el) return;
    if (el.hasAttribute('data-go')) { e.preventDefault(); UI.go.apply(null, el.getAttribute('data-go').split('/')); }
    else if (el.hasAttribute('data-feedback')) { e.preventDefault(); UI.feedback(el.getAttribute('data-feedback') || null); }
    else if (el.hasAttribute('data-theme-set')) { e.preventDefault(); UI.setTheme(el.getAttribute('data-theme-set')); if (UI.shell && UI.shell.onTheme) UI.shell.onTheme(); }
  });
})();


/* app.js: this app's identity and frame: name, header, footer, phone tab bar.
   Pages live in web/pages/*.html. The engine (window.UI) is web/core.js. */
(function () {
  'use strict';
  UI.configure({
    name: 'Logsteps',
    key: 'logsteps',          // prefix for this app's browser storage
    tagline: 'Walk a room. Keep it in 3D.',   // footer line
    home: 'home',                // first page after signing in
    landing: 'landing'           // first page for visitors who aren't signed in
  });

  var esc = UI.esc;

  /* Logsteps icons (added to the shared set in core.js; 24px, stroke) */
  var I = UI.ICONS;
  I.cube = '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>';
  I.walk = '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 3 3v3M8.5 12.5 11 8l3 2.5 3 .5M11 8l1 5"/>';
  I.plan = '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M3.5 12H11V3.5M14 12h6.5M11 16v4.5"/>';
  I.play = '<path d="M7 4.5v15l12.5-7.5z"/>';
  I.pause = '<path d="M8 5v14M16 5v14"/>';
  I.ruler = '<path d="M3 15.5 15.5 3 21 8.5 8.5 21z"/><path d="M7 11.5l2 2M10 8.5l1.5 1.5M13 5.5l2 2M5.5 14l1.5 1.5"/>';
  I.expand = '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>';
  I.download = '<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M4 20h16"/>';
  I.upload = '<path d="M12 20V9M7 13.5l5-5 5 5"/><path d="M4 4h16"/>';
  I.link = '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4L11.5 6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.5-1.4"/>';
  I.video = '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10.5 5-3v9l-5-3"/>';
  I.crop = '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/>';
  I.lasso = '<path d="M7 16.5C4.5 15.3 3 13.4 3 11c0-4 4-7 9-7s9 3 9 7-4 7-9 7c-1 0-2-.1-2.8-.3"/><circle cx="7.5" cy="18" r="2"/><path d="M7 20c-.3 1-1 1.5-2 1.5"/>';
  I.box = '<path d="M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4"/>';
  I.wand = '<path d="M4 20 15 9M14 4v3M20 10h-3M18.5 5.5l-2 2M10.5 5.5l1.5 1.5M18.5 13.5 17 12"/>';
  I.palette = '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.4-1.3-1.6-1.3-2.8 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.2" r="1.2"/>';
  I.undo = '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>';
  I.redo = '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>';
  I.save = '<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M7 21v-7h10v7"/>';
  I.level = '<path d="M3 17h18"/><path d="M6 17 12 7l6 10"/><circle cx="12" cy="7" r="1.5"/>';
  I.rotate = '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>';
  I.scissors = '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5 20 18M8 15.5 20 6"/>';
  I.layers = '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>';
  I.history = '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>';
  I.cpu = '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/><rect x="9.5" y="9.5" width="5" height="5"/>';
  I.key = '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14.5 8.5l2 2"/>';
  I.terminal = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>';
  I.target = '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>';
  I.eye = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  I.scan = '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>';
  I.steps = '<ellipse cx="8" cy="15" rx="2.6" ry="4" transform="rotate(-12 8 15)"/><ellipse cx="16" cy="8" rx="2.6" ry="4" transform="rotate(12 16 8)"/>';
  I.move = '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>';
  I.brush = '<path d="M18.5 3.5 9 13l2 2 9.5-9.5a1.4 1.4 0 0 0-2-2z"/><path d="M8.5 14c-2 0-3.5 1.5-3.5 3.5 0 1-.7 2-2 2.5 1.2.6 2.5 1 4 1 2.8 0 4.5-2 4.5-4.5"/>';
  I.invert = '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>';
  I.pinplus = '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><path d="M12 6v6M9 9h6"/>';

  function brand() {
    return '<a class="ui-brand" href="#" data-go="' + (UI.me ? UI.config.home : UI.config.landing) + '" aria-label="' + esc(UI.config.name) + ' home">' +
      '<img src="_/theme/icon.svg" alt="" width="32" height="32"><span>' + esc(UI.config.name) + '</span></a>';
  }

  function themeSwitch() {
    var t = UI.theme();
    return '<div class="ui-seg" role="group" aria-label="Appearance">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
      return '<button type="button" data-theme-set="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function userMenu(me) {
    return '<div class="ui-menu" data-menu hidden>' +
      '<div class="ui-menu-head"><strong>' + esc(me.name) + '</strong><span class="muted small">' + esc(me.email) + '</span></div>' +
      '<a href="#profile" data-go="profile">' + UI.icon('user') + 'Your profile</a>' +
      (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
      '<div class="ui-menu-block"><span class="small muted">Appearance</span>' + themeSwitch() + '</div>' +
      '<button type="button" data-feedback>' + UI.icon('chat') + 'Submit feedback</button>' +
      '<button type="button" data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms</button>' +
      '<button type="button" data-signout>' + UI.icon('logout') + 'Sign out</button></div>';
  }

  UI.shell = {
    header: function (me, active) {
      var nav = UI.navPages();
      return '<div class="ui-header-in">' + brand() +
        (me ? '<nav class="ui-nav" aria-label="Main">' + nav.map(function (p) {
          return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
        }).join('') + '</nav>' : '') +
        '<div class="ui-header-right">' +
        (me ? '<button type="button" class="ui-avatar-btn" data-menu-toggle aria-label="Your account" aria-haspopup="true">' + esc(UI.initials(me.name)) + '</button>' + userMenu(me)
          : (active === 'auth' ? '' : '<a class="ui-btn ghost" href="#auth" data-go="auth">Sign in</a><a class="ui-btn primary" href="#auth/signup" data-go="auth/signup">Get started</a>')) +
        '</div></div>';
    },
    footer: function (me) {
      return '<div class="ui-footer-in"><div class="ui-footer-brand">' + brand() + '<p class="muted small">' + esc(UI.config.tagline) + '</p></div>' +
        '<div class="ui-footer-links">' +
        '<a href="#landing" data-go="landing">About</a>' +
        '<a href="https://prepsto.com/#f/s39d3vn" target="_blank" rel="noopener" data-prepsto-open>Submit feedback</a>' +
        '<button type="button" data-lk-open="overview">Privacy &amp; Terms</button>' +
        '</div><p class="ui-footer-legal small muted">© ' + new Date().getFullYear() + ' ' + esc(UI.config.name) + '</p></div>';
    },
    tabbar: function (me, active) {
      var nav = UI.navPages();
      if (!me || nav.length < 2) return '';
      return nav.slice(0, 4).map(function (p) {
        return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
      }).join('') + '<a href="#profile" class="' + (active === 'profile' ? 'on' : '') + '">' + UI.icon('user') + '<span>You</span></a>';
    },
    wire: function (root) {
      root.addEventListener('click', function (e) {
        var t = e.target.closest('[data-menu-toggle]');
        var menu = root.querySelector('[data-menu]');
        if (t && menu) { menu.hidden = !menu.hidden; t.setAttribute('aria-expanded', String(!menu.hidden)); return; }
        if (e.target.closest('[data-signout]')) { UI.auth('logout').then(function () { UI.toast('Signed out. See you soon!'); }); }
        if (menu && !menu.hidden && !e.target.closest('[data-menu] .ui-seg')) menu.hidden = true;
      });
      document.addEventListener('keydown', function (e) {
        var menu = root.querySelector('[data-menu]');
        if (e.key === 'Escape' && menu) menu.hidden = true;
      });
    },
    onTheme: function () {  // redraw the menu's Auto/Light/Dark buttons and keep the menu open
      var menu = document.querySelector('[data-menu]'), open = menu && !menu.hidden;
      UI.renderChrome();
      if (open) document.querySelector('[data-menu]').hidden = false;
    }
  };
})();


/* ===== _cards.html ===== */
(function () {
  'use strict';
  var LS = window.LS = window.LS || {};
  var esc = function (s) { return UI.esc(s); };
  /* the room types (same keys as ROOMS in server_code/common.py) */
  LS.ROOMS = { living: 'Living room', kitchen: 'Kitchen', bedroom: 'Bedroom', office: 'Office', bathroom: 'Bathroom', hallway: 'Hallway',
               studio: 'Studio', shop: 'Shop or café', outdoor: 'Outdoors', other: 'Other' };

  /* A small isometric room, slightly different per seed (furniture moves around) */
  LS.roomArt = function (seed) {
    var h = 0; String(seed || 'x').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    var r = function (n) { h = (h * 1103515245 + 12345) >>> 0; return (h % 1000) / 1000 * n; };
    var bx = 60 + r(30), by = 92 + r(10), w = 34 + r(16);
    return '<svg viewBox="0 0 200 150" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M100 18 30 52v54l70 34 70-34V52z" opacity=".25"/>' +
      '<path d="M100 18v62M30 52l70 28 70-28" opacity=".55"/>' +
      '<path d="M30 106l70-26 70 26" opacity=".35" stroke-dasharray="3 4"/>' +
      '<path d="M' + bx + ' ' + by + 'l' + w + ' -12l18 8l-' + w + ' 12z" fill="currentColor" fill-opacity=".12"/>' +
      '<path d="M' + bx + ' ' + by + 'v8l18 8v-8M' + (bx + 18) + ' ' + (by + 8) + 'l' + w + ' -12v-8" opacity=".8"/>' +
      '<path d="M128 40v22l16-7V33z" fill="currentColor" fill-opacity=".1"/>' +
      '<circle cx="' + (138 + r(10)) + '" cy="' + (88 + r(8)) + '" r="7" fill="currentColor" fill-opacity=".14"/>' +
      '<path d="M22 118l78 30 78-30" stroke="#c2522b" stroke-width="1.2" opacity=".7"/>' +
      '<path d="M22 114v8M178 114v8" stroke="#c2522b" stroke-width="1.2" opacity=".7"/></svg>';
  };

  LS.statusBadge = function (s) {
    switch (s.status) {
      case 'capturing': return '<span class="ui-badge warn">' + UI.icon('upload') + 'Upload unfinished</span>';
      case 'queued': return '<span class="ui-badge">' + UI.icon('clock') + 'In the queue</span>';
      case 'processing': return '<span class="ui-badge brand">' + UI.icon('cpu') + 'Processing</span>';
      case 'failed': return '<span class="ui-badge bad">' + UI.icon('info') + 'Didn\'t work</span>';
      default: return '';
    }
  };
  LS.visBadge = function (v) {
    if (v === 'public') return '<span class="ui-badge accent" title="Public: in Explore">' + UI.icon('globe') + 'Public</span>';
    if (v === 'link') return '<span class="ui-badge" title="Anyone with the link">' + UI.icon('link') + 'Link</span>';
    return '<span class="ui-badge" title="Only you">' + UI.icon('lock') + 'Private</span>';
  };

  LS.card = function (s, o) {
    o = o || {};
    var pic = s.thumb || s.cover, isCover = !s.thumb && !!s.cover;
    var pending = s.status === 'queued' || s.status === 'processing' || s.status === 'capturing';
    var href = o.href || ('scan/' + s.id);
    var thumb = '<div class="ls-thumb' + (isCover ? ' cover' : '') + '">' +
      '<div class="art">' + LS.roomArt(s.id) + '</div>' + (pic ? '<img loading="lazy" alt="" src="' + esc(pic) + '" onerror="this.remove()">' : '') +
      '<div class="ls-tl">' + LS.statusBadge(s) + (s.source === 'sample' ? '<span class="ui-badge">' + UI.icon('sparkle') + 'Sample</span>' : '') + '</div>' +
      (!o.explore ? '<div class="ls-tr">' + LS.visBadge(s.visibility) + '</div>' : '') +
      (pending ? '<div class="ls-prog" data-prog><small>' + esc(s.stage || (s.status === 'queued' ? 'Waiting for the scan station' : 'Working…')) + '</small>' +
        '<div class="track' + (s.status === 'queued' || !s.progress ? ' wait' : '') + '"><i style="width:' + Math.round((s.progress || 0) * 100) + '%"></i></div></div>'
        : (s.size && s.status === 'ready' ? '<div class="ls-dim"><i></i><span>' + s.size[0].toFixed(1) + ' m</span><i></i></div>' : '')) +
      '</div>';
    var meta = o.explore
      ? '<span>' + esc(s.author) + '</span><span>·</span><span>' + esc(s.room_label) + '</span>'
      : '<span>' + esc(s.room_label) + '</span><span>·</span><span>' + esc(UI.ago(s.updated)) + '</span>';
    var stats = s.status === 'ready'
      ? (s.points ? '<span>' + UI.icon('grid') + LS.fmtNum(s.points) + ' pts</span>' : '') +
        (s.area ? '<span>≈ ' + s.area + ' m²</span>' : '') + (s.has_mesh ? '<span>' + UI.icon('layers') + 'surface</span>' : '') +
        (o.explore ? '<span class="heart' + (s.hearted ? ' on' : '') + '">' + UI.icon('heart') + s.hearts + '</span><span>' + UI.icon('eye') + s.views + '</span>' : '')
      : s.status === 'failed' ? '<span>Open it to try again</span>' : (s.frames ? '<span>' + UI.icon('image') + s.frames + ' frames</span>' : '');
    return '<a class="ls-card" href="#' + esc(href) + '" data-go="' + esc(href) + '" data-card="' + esc(s.id) + '">' + thumb +
      '<div class="ls-card-body"><h3>' + esc(s.title) + '</h3><p class="meta">' + meta + '</p>' +
      '<p class="stats">' + stats + '</p></div></a>';
  };

  if (!LS.fmtNum) LS.fmtNum = function (n) { return (n || 0).toLocaleString(); };
})();

/* ===== _viewer.html ===== */
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

  LS.fmtLen = function (m) {
    if (m == null || isNaN(m)) return '';
    var a = Math.abs(m);
    return a < 1 ? Math.round(m * 100) + ' cm' : (Math.round(m * 100) / 100).toFixed(2) + ' m';
  };
  LS.fmtNum = function (n) { return (n || 0).toLocaleString(); };
  LS.fmtSize = function (s) { return s && s.length === 3 ? s[0].toFixed(1) + ' × ' + s[1].toFixed(1) + ' × ' + s[2].toFixed(1) + ' m' : ''; };

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
      V.keys[e.key.toLowerCase()] = true; V.keys.shift = e.shiftKey;
      if (V.state.mode === 'walk' && /^(arrow|w$|a$|s$|d$)/.test(e.key.toLowerCase())) e.preventDefault();
    };
    V._ku = function (e) { V.keys[e.key.toLowerCase()] = false; V.keys.shift = e.shiftKey; };
    window.addEventListener('keydown', V._kd); window.addEventListener('keyup', V._ku);
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
    var label = document.createElement('div'); label.className = 'ls-measure'; label.textContent = LS.fmtLen(a.distanceTo(b));
    this.overlay.appendChild(label);
    this.measures.push({ a: a, b: b, line: line, label: label, mid: a.clone().add(b).multiplyScalar(0.5) });
    if (this.onMeasure) this.onMeasure(a.distanceTo(b));
    this.needs = true;
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
    V.measures.forEach(function (m) {
      v.copy(m.mid).project(cam);
      var hide = v.z > 1;
      m.label.style.display = hide ? 'none' : '';
      m.label.style.transform = 'translate(' + ((v.x + 1) / 2 * w) + 'px,' + ((1 - v.y) / 2 * h) + 'px) translate(-50%,-50%)';
    });
    if (V.scaleEl && V.state.mode === 'plan') {
      var unitsPerPx = (V.ortho.right - V.ortho.left) / V.ortho.zoom / w;
      var nice = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20].filter(function (x) { return x / unitsPerPx < 140; }).pop() || 0.1;
      V.scaleEl.innerHTML = '<i style="width:' + Math.round(nice / unitsPerPx) + 'px"></i>' + LS.fmtLen(nice);
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
      '<span class="grow"></span>' +
      '<div class="ls-more"><button class="ui-btn sm" data-more aria-haspopup="true" title="Display settings">' + ic('sliders') + '<span class="lbl">Display</span></button></div>' +
      '<button class="ui-btn sm icon" data-shot title="Save a picture">' + ic('image') + '</button>' +
      '<button class="ui-btn sm icon" data-full title="Full screen">' + ic('expand') + '</button>' +
      '</div><div data-replaybox></div>';
    var bar = host.querySelector('.ls-bar'), rbox = host.querySelector('[data-replaybox]'), pip = null;

    function setOn(sel, on) { var b = host.querySelector(sel); if (b) b.classList.toggle('on', on); }
    function pop() {
      var old = host.querySelector('.ls-pop'); if (old) { old.remove(); return; }
      var p = document.createElement('div'); p.className = 'ls-pop';
      p.innerHTML = (hasMesh ? '<label>Show<div class="ui-seg"><button data-disp="points">Points</button><button data-disp="surface">Surface</button></div></label>' : '') +
        '<label>Colours<div class="ui-seg"><button data-col="photo">Photo</button><button data-col="height">Height</button><button data-col="clay">Clay</button></div></label>' +
        '<label>Point size<input type="range" min="0.4" max="3" step="0.1" value="' + v.state.size + '" data-size></label>' +
        '<label class="ui-check" style="display:flex;color:var(--c-ink)"><input type="checkbox" data-cut' + (v.state.cut ? ' checked' : '') + '> Dollhouse (hide the ceiling)</label>' +
        (hasPath ? '<label class="ui-check" style="display:flex;color:var(--c-ink)"><input type="checkbox" data-path' + (v.showPath ? ' checked' : '') + '> Show the walk path</label>' : '') +
        ((scan.annotations || []).length ? '<label class="ui-check" style="display:flex;color:var(--c-ink)"><input type="checkbox" data-pins' + (v.pinsHidden ? '' : ' checked') + '> Show pins</label>' : '');
      host.querySelector('.ls-more').appendChild(p);
      mark();
      p.addEventListener('click', function (e) {
        var d = e.target.closest('[data-disp]'), c = e.target.closest('[data-col]');
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
        if (!on) v.clearMeasures();
        return;
      }
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
    return { endReplay: endReplay };
  };
})();

/* ===== admin.html ===== */
(function () {
  var esc = UI.esc;
  var TABS = [['overview', 'Overview', 'grid'], ['scans', 'Scans', 'cube'], ['station', 'Scan station', 'cpu'], ['feedback', 'Feedback', 'inbox'],
              ['users', 'Users', 'users'], ['demo', 'Demo data', 'database']];

  UI.page('admin', { title: 'Admin', auth: 'admin' }, function (view, ctx) {
    var tab = TABS.some(function (t) { return t[0] === ctx.args[0]; }) ? ctx.args[0] : 'overview';
    var fbFilter = 'new';
    view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><h1>Admin</h1><p class="muted">Only admins see this page.</p></div></div>' +
      '<nav class="ui-tabs">' + TABS.map(function (t) {
        return '<a href="#admin/' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + UI.icon(t[2]) + t[1] + '</a>';
      }).join('') + '</nav><div data-body><div class="ui-skel"></div></div></div>';
    var body = view.querySelector('[data-body]');

    function overview() {
      return UI.api('admin_overview').then(function (d) {
        var stat = function (n, label, go) { return '<a class="ui-card ui-stat" href="#admin/' + go + '" style="text-decoration:none;color:inherit"><b>' + n + '</b><span>' + label + '</span></a>'; };
        body.innerHTML = '<div class="ad-stats">' + stat(d.users, 'people signed up', 'users') + stat(d.scans, 'scans (not demo)', 'scans') +
          stat(d.public, 'public scans', 'scans') + stat(d.queue, 'in the queue', 'station') + stat(d.failed, 'failed', 'station') +
          stat(d.feedback_new, 'new feedback', 'feedback') + '</div>' +
          '<div class="ui-card" style="margin-top:16px"><span class="ad-dot' + (d.station.online ? ' on' : '') + '"></span><b>Scan station ' + (d.station.online ? 'online' : 'offline') + '</b>' +
          (d.station.name ? ' <span class="muted">· ' + esc(d.station.name) + (d.station.gpu ? ', ' + esc(d.station.gpu) : '') + '</span>' : '') +
          (d.station.online ? '' : ' <a href="#admin/station" style="margin-left:8px">Set it up</a>') + '</div>' +
          '<p class="muted small" style="margin-top:18px">Demo data is <b>' + esc(d.demo.state) + '</b> (' + d.demo.counts.users + ' demo people). Manage it in the Demo data tab.</p>';
      });
    }

    function feedback() {
      return UI.api('list_feedback', null).then(function (d) {
        var items = d.items.filter(function (i) { return fbFilter === 'all' || i.status === fbFilter; });
        body.innerHTML = '<div class="ui-row" style="margin-bottom:16px"><div class="ui-seg">' + [['new', 'New'], ['read', 'Read'], ['done', 'Done'], ['all', 'All']].map(function (f) {
          var n = f[0] === 'all' ? d.items.length : d.counts[f[0]];
          return '<button data-filter="' + f[0] + '" class="' + (fbFilter === f[0] ? 'on' : '') + '">' + f[1] + ' (' + n + ')</button>';
        }).join('') + '</div></div>' +
          (items.length ? '<div class="ad-fb">' + items.map(function (i) {
            var c = i.context || {};
            return '<div class="ui-item" data-id="' + esc(i.id) + '"><div class="meta"><span class="ui-badge ' + (i.kind === 'bug' ? 'bad' : i.kind === 'idea' ? 'brand' : '') + '">' + esc(i.kind_label) + '</span>' +
              '<b>' + esc(i.name) + '</b>' + (i.email ? '<a href="mailto:' + esc(i.email) + '">' + esc(i.email) + '</a>' : '') + '<span>' + esc(UI.fmtDateTime(i.created)) + '</span></div>' +
              '<p class="msg">' + esc(i.message) + '</p>' +
              '<div class="ctx">' + esc([c.page, c.screen, c.theme, c.browser].filter(Boolean).join(' · ')) + '</div>' +
              '<textarea data-note placeholder="Private note (only admins see it)">' + esc(i.note) + '</textarea>' +
              '<div class="ui-row" style="margin-top:10px">' + ['new', 'read', 'done'].map(function (s) {
                return '<button class="ui-btn sm' + (i.status === s ? ' primary' : '') + '" data-status="' + s + '">' + s[0].toUpperCase() + s.slice(1) + '</button>';
              }).join('') + '<span class="ui-spacer"></span><button class="ui-btn sm danger" data-del-fb>' + UI.icon('trash') + 'Delete</button></div></div>';
          }).join('') + '</div>'
            : '<div class="ui-empty">' + UI.icon('inbox') + '<h3>No ' + (fbFilter === 'all' ? '' : fbFilter + ' ') + 'messages</h3><p>New feedback goes to Prepsto (prepsto.com). Older messages and requests from the app show up here.</p></div>');
      });
    }

    function users(query) {
      return UI.api('list_users', query || null).then(function (d) {
        body.innerHTML = '<form class="ui-row" data-search style="margin-bottom:14px"><input type="search" name="q" placeholder="Search by name or email" value="' + esc(query || '') + '" style="max-width:360px">' +
          '<button class="ui-btn" type="submit">' + UI.icon('search') + 'Search</button><span class="muted small">' + UI.plural(d.total, 'person', 'people') + '</span></form>' +
          '<table class="ad-users"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Admin</th><th>Active</th></tr></thead><tbody>' +
          d.users.map(function (u) {
            return '<tr data-id="' + esc(u.id) + '"><td><b>' + esc(u.name) + '</b></td><td class="email">' + esc(u.email) + '</td><td class="joined muted">' + esc(UI.fmtDate(u.joined)) + '</td>' +
              '<td><label class="ui-check"><input type="checkbox" data-admin' + (u.is_admin ? ' checked' : '') + '> Admin</label></td>' +
              '<td><label class="ui-check"><input type="checkbox" data-enabled' + (u.enabled ? ' checked' : '') + '> Active</label></td></tr>';
          }).join('') + '</tbody></table>';
      });
    }

    function demo() {
      return UI.api('admin_overview').then(function (d) {
        var c = d.demo.counts;
        body.innerHTML = '<div class="ui-card ui-narrow" style="margin:0"><h3>Demo data</h3>' +
          '<p class="muted">Example people and content, so the app never looks empty for the first visitors. Demo rows are flagged, so removing them never touches real data. Once removed, it stays removed until you load it again.</p>' +
          '<p>Status: <b>' + esc(d.demo.state) + '</b> · ' + Object.keys(c).map(function (k) { return c[k] + ' ' + esc(k); }).join(', ') + '</p>' +
          '<div class="ui-row"><button class="ui-btn primary" data-demo="load">' + UI.icon('refresh') + (d.demo.state === 'loaded' ? 'Reload demo data' : 'Load demo data') + '</button>' +
          '<button class="ui-btn danger" data-demo="remove">' + UI.icon('trash') + 'Remove demo data</button></div></div>';
      });
    }

    var scanQ = '', scanWhich = 'all';
    function scans() {
      return UI.api('admin_scans', scanQ || null, scanWhich).then(function (d) {
        body.innerHTML = '<form class="ui-row" data-scansearch style="margin-bottom:14px"><input type="search" name="q" placeholder="Search by title, name or email" value="' + esc(scanQ) + '" style="max-width:320px">' +
          '<button class="ui-btn" type="submit">' + UI.icon('search') + '</button><div class="ui-seg">' + [['all', 'All'], ['public', 'Public'], ['shared', 'Shared'], ['failed', 'Failed']].map(function (w) {
            return '<button type="button" data-which="' + w[0] + '" class="' + (scanWhich === w[0] ? 'on' : '') + '">' + w[1] + '</button>';
          }).join('') + '</div><span class="muted small">' + UI.plural(d.total, 'scan') + '</span></form>' +
          (d.scans.length ? '<div class="ui-list ad-scans">' + d.scans.map(function (s) {
            var pic = s.thumb || s.cover;
            return '<div class="ui-item" data-id="' + esc(s.id) + '">' + (pic ? '<img src="' + esc(pic) + '" alt="">' : '<span class="ph"></span>') +
              '<div class="grow"><h3>' + esc(s.title) + (s.demo ? ' <span class="ui-badge">Demo</span>' : '') + ' ' + LS.statusBadge(s) + '</h3>' +
              '<p class="small muted">' + esc(s.author) + (s.owner_email ? ' · ' + esc(s.owner_email) : '') + ' · ' + esc(s.room_label) + ' · ' + esc(UI.ago(s.updated)) +
              (s.points ? ' · ' + LS.fmtNum(s.points) + ' pts' : '') + (s.error ? ' · <span style="color:var(--c-bad)">' + esc(s.error) + '</span>' : '') + '</p></div>' +
              '<select data-adminvis aria-label="Visibility">' + [['private', 'Private'], ['link', 'Link'], ['public', 'Public']].map(function (v) {
                return '<option value="' + v[0] + '"' + (s.visibility === v[0] ? ' selected' : '') + '>' + v[1] + '</option>';
              }).join('') + '</select>' +
              (s.status === 'ready' && s.visibility !== 'private' ? '<a class="ui-btn sm" href="#s/' + esc(s.token) + '" data-go="s/' + esc(s.token) + '" aria-label="Open">' + UI.icon('eye') + '</a>' : '') +
              '<button class="ui-btn sm danger" data-adel aria-label="Delete">' + UI.icon('trash') + '</button></div>';
          }).join('') + '</div>' : '<div class="ui-empty">' + UI.icon('cube') + '<h3>No scans</h3></div>');
      });
    }
    function station() {
      return UI.api('station_info').then(function (d) {
        var st = d.station, app = location.origin + location.pathname.replace(/\/$/, '');
        body.innerHTML = '<div class="ad-st"><div class="ui-stack">' +
          '<div class="ui-card"><h3><span class="ad-dot' + (st.online ? ' on' : '') + '"></span>' + (st.online ? 'Online' : 'Offline') + '</h3>' +
          '<p class="muted" style="margin:0">' + (st.seen ? 'Last heard from ' + esc(UI.ago(st.seen)) + (st.name ? ': <b>' + esc(st.name) + '</b>' : '') + (st.gpu ? ' (' + esc(st.gpu) + ')' : '') + '.' : 'No station has connected yet.') +
          ' ' + UI.plural(st.queue, 'scan') + ' waiting, ' + st.busy + ' processing.' + (d.avg_ms ? ' Recent scans took ' + Math.round(d.avg_ms / 1000) + ' s on average.' : '') + '</p></div>' +
          '<div class="ui-card"><h3>' + UI.icon('cube') + ' Queue and problems</h3>' + (d.jobs.length ? '<div class="ui-list ad-jobs">' + d.jobs.map(function (j) {
            return '<div class="ui-item" data-job="' + esc(j.id) + '"><div class="grow"><h3>' + esc(j.title) + ' ' + LS.statusBadge(j) + '</h3><p class="small muted">' + esc(j.owner) + ' · ' + j.frames + ' frames · ' + esc(UI.ago(j.updated)) +
              (j.stage ? ' · ' + esc(j.stage) : '') + (j.error ? ' · <span style="color:var(--c-bad)">' + esc(j.error) + '</span>' : '') + '</p>' +
              (j.status === 'processing' ? '<div class="bar"><i style="width:' + Math.round(j.progress * 100) + '%"></i></div>' : '') + '</div>' +
              (j.status === 'failed' ? '<button class="ui-btn sm" data-requeue>' + UI.icon('refresh') + 'Retry</button>' : '<button class="ui-btn sm" data-cancel>Stop</button>') + '</div>';
          }).join('') + '</div>' : '<p class="muted" style="margin:0">Nothing waiting. All caught up.</p>') + '</div></div>' +
          '<div class="ui-stack"><div class="ui-card"><h3>' + UI.icon('key') + ' Station key</h3>' +
          '<p class="muted">The scan station signs in with this key. ' + (d.has_key ? 'Current key: <span class="mono">' + esc(d.key_hint) + '</span>, made ' + esc(UI.ago(d.key_made)) + '. Making a new one stops the old one.' : 'There is no key yet.') + '</p>' +
          '<div data-newkey></div><button class="ui-btn primary" data-makekey>' + UI.icon('key') + (d.has_key ? 'Make a new key' : 'Make a station key') + '</button></div>' +
          '<div class="ui-card"><h3>' + UI.icon('terminal') + ' Set up the station</h3><ol class="ad-steps">' +
          '<li>On a computer with an NVIDIA GPU, install Python 3.10, PyTorch with CUDA, <a href="https://github.com/Robbyant/lingbot-map" target="_blank" rel="noopener">lingbot-map</a> and (for surfaces) Open3D:' +
          '<div class="ad-code">conda create -n logsteps python=3.10 -y\nconda activate logsteps\npip install torch --index-url https://download.pytorch.org/whl/cu128\ngit clone https://github.com/Robbyant/lingbot-map\npip install -e ./lingbot-map open3d</div></li>' +
          '<li><a href="_/theme/logsteps_station.txt" download="logsteps_station.py">Download logsteps_station.py</a> (also in the repo\'s <span class="mono">station/</span> folder, with a README).</li>' +
          '<li>Run it with the key:<div class="ad-code">python logsteps_station.py --app ' + esc(app) + ' --key lsk_…</div>Test the connection without a GPU by adding <span class="mono">--fake --once</span>.</li></ol></div></div></div>';
      });
    }
    var DRAW = { overview: overview, scans: scans, station: station, feedback: feedback, users: users, demo: demo };

    view.addEventListener('click', function (e) {
      var f = e.target.closest('[data-filter]');
      if (f) { fbFilter = f.getAttribute('data-filter'); feedback(); return; }
      var st = e.target.closest('[data-status]');
      if (st) {
        var card = st.closest('[data-id]');
        UI.api('set_feedback_status', card.getAttribute('data-id'), st.getAttribute('data-status'), card.querySelector('[data-note]').value).then(function () { UI.toast('Saved', 'ok'); feedback(); });
        return;
      }
      var del = e.target.closest('[data-del-fb]');
      if (del) {
        UI.confirm({ title: 'Delete this message?', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('delete_feedback', del.closest('[data-id]').getAttribute('data-id')).then(feedback);
        });
        return;
      }
      var wh = e.target.closest('[data-which]');
      if (wh) { scanWhich = wh.getAttribute('data-which'); scans(); return; }
      var ad = e.target.closest('[data-adel]');
      if (ad) {
        UI.confirm({ title: 'Delete this scan?', text: 'It is deleted for its owner too, with its versions and footage.', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('admin_delete_scan', ad.closest('[data-id]').getAttribute('data-id')).then(function () { UI.toast('Deleted'); scans(); });
        });
        return;
      }
      if (e.target.closest('[data-makekey]')) {
        UI.confirm({ title: 'Make a new station key?', text: 'Any station using the old key stops until you give it the new one.', ok: 'Make key' }).then(function (yes) {
          if (!yes) return;
          UI.api('station_new_key').then(function (r) {
            station().then(function () {
              var box = view.querySelector('[data-newkey]');
              box.innerHTML = '<p class="small" style="margin:0 0 6px"><b>Copy it now:</b> it won\'t be shown again.</p><div class="ad-key">' + esc(r.key) + '</div>' +
                '<button class="ui-btn sm" data-copykey style="margin:8px 0 14px">' + UI.icon('copy') + 'Copy</button>';
              box.querySelector('[data-copykey]').onclick = function () { if (navigator.clipboard) navigator.clipboard.writeText(r.key).then(function () { UI.toast('Key copied', 'ok'); }); };
            });
          });
        });
        return;
      }
      var rq = e.target.closest('[data-requeue]'), cn = e.target.closest('[data-cancel]');
      if (rq || cn) {
        var jid = (rq || cn).closest('[data-job]').getAttribute('data-job');
        UI.api(rq ? 'station_requeue' : 'station_cancel', jid).then(function () { UI.toast(rq ? 'Back in the queue' : 'Stopped', 'ok'); station(); });
        return;
      }
      var dm = e.target.closest('[data-demo]');
      if (dm) {
        var load = dm.getAttribute('data-demo') === 'load';
        UI.confirm({ title: load ? 'Load the demo data?' : 'Remove the demo data?', text: load ? 'Demo people and content are added (any old demo rows are replaced).' : 'Every demo row is deleted. Real data stays.', ok: load ? 'Load' : 'Remove', danger: !load })
          .then(function (yes) { if (yes) UI.busy(dm, UI.api(load ? 'demo_load' : 'demo_remove')).then(function () { UI.toast('Done', 'ok'); demo(); }); });
      }
    });
    view.addEventListener('change', function (e) {
      if (e.target.matches('[data-adminvis]')) {
        var sid = e.target.closest('[data-id]').getAttribute('data-id');
        UI.api('admin_set_visibility', sid, e.target.value).then(function () { UI.toast('Saved', 'ok'); });
        return;
      }
      var row = e.target.closest('tr[data-id]');
      if (!row) return;
      var id = row.getAttribute('data-id'), box = e.target;
      var fn = box.hasAttribute('data-admin') ? 'set_admin' : box.hasAttribute('data-enabled') ? 'set_enabled' : null;
      if (fn) UI.api(fn, id, box.checked).then(function () { UI.toast('Saved', 'ok'); }, function (err) { box.checked = !box.checked; UI.toast(err.message, 'error'); });
    });
    view.addEventListener('submit', function (e) {
      if (e.target.matches('[data-search]')) { e.preventDefault(); users(UI.formData(e.target).q); }
      if (e.target.matches('[data-scansearch]')) { e.preventDefault(); scanQ = UI.formData(e.target).q || ''; scans(); }
    });
    return DRAW[tab]();
  });
})();

/* ===== auth.html ===== */
(function () {
  var esc = UI.esc;
  function pw(name, auto) {
    return '<div class="au-pw"><input type="password" name="' + name + '" autocomplete="' + auto + '" required minlength="8">' +
      '<button type="button" data-show>Show</button></div>';
  }
  UI.page('auth', { title: 'Sign in', auth: 'guest' }, function (view, ctx) {
    var mode = ['signup', 'reset'].indexOf(ctx.args[0]) >= 0 ? ctx.args[0] : 'login';
    function draw(msg, isErr) {
      var heading = { login: 'Welcome back', signup: 'Create your account', reset: 'Reset your password' }[mode];
      var sub = { login: 'Sign in to continue to ' + esc(UI.config.name) + '.', signup: 'It\'s free and takes a few seconds.',
        reset: 'We\'ll email you a link to choose a new password.' }[mode];
      view.innerHTML = '<div class="au-wrap"><div class="ui-card au-card">' +
        '<h1>' + heading + '</h1><p class="muted">' + sub + '</p>' +
        (mode !== 'reset' ? '<div class="ui-seg" role="tablist"><button type="button" data-mode="login" class="' + (mode === 'login' ? 'on' : '') + '">Sign in</button>' +
          '<button type="button" data-mode="signup" class="' + (mode === 'signup' ? 'on' : '') + '">Create account</button></div>' : '<div style="height:14px"></div>') +
        '<form class="ui-stack" data-form="' + mode + '" novalidate>' +
        (mode === 'signup' ? '<label class="ui-field"><span>Your name</span><input type="text" name="name" autocomplete="name" required maxlength="60"></label>' : '') +
        '<label class="ui-field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>' +
        (mode === 'login' ? '<label class="ui-field"><span>Password</span>' + pw('password', 'current-password') + '</label>' : '') +
        (mode === 'signup' ? '<label class="ui-field"><span>Password <em>(at least 8 characters)</em></span>' + pw('password', 'new-password') + '</label>' +
          (window.LegalKit ? '<div>' + LegalKit.consentField() + '</div>' : '') : '') +
        '<div data-msg role="alert"' + (msg ? ' class="' + (isErr ? 'ui-error' : 'ui-note') + '">' + esc(msg) : ' hidden>') + '</div>' +
        '<button class="ui-btn primary block" type="submit">' + { login: 'Sign in', signup: 'Create account', reset: 'Send the link' }[mode] + '</button></form>' +
        '<div class="au-links">' + (mode === 'login' ? '<a data-mode="reset">Forgot your password?</a>' : '<a data-mode="login">' + UI.icon('back') + ' Back to sign in</a>') +
        '<a href="#landing" data-go="landing">About ' + esc(UI.config.name) + '</a></div></div></div>';
      var first = view.querySelector('input');
      if (first && !msg) first.focus();
    }
    view.addEventListener('click', function (e) {
      var m = e.target.closest('[data-mode]');
      if (m) { e.preventDefault(); mode = m.getAttribute('data-mode'); history.replaceState(null, '', '#auth' + (mode === 'login' ? '' : '/' + mode)); draw(); return; }
      var s = e.target.closest('[data-show]');
      if (s) { var i = s.parentNode.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; s.textContent = i.type === 'password' ? 'Show' : 'Hide'; }
    });
    view.addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target, v = UI.formData(form);
      var problem = !/^\S+@\S+\.\S+$/.test(v.email || '') ? 'Please enter a valid email address.'
        : mode !== 'reset' && (v.password || '').length < (mode === 'signup' ? 8 : 1) ? (mode === 'signup' ? 'Please choose a password of at least 8 characters.' : 'Please enter your password.')
        : mode === 'signup' && (v.name || '').trim().length < 2 ? 'Please tell us your name.' : null;
      if (problem) { say(problem, true); return; }
      if (mode === 'signup' && window.LegalKit && !LegalKit.consentChecked(form)) return;  // the kit shows its own message
      UI.busy(form.querySelector('[type=submit]'), UI.auth(mode, v)).then(function (r) {
        if (mode === 'reset' || (r && !r.me)) { mode = 'login'; draw(r && r.message, false); restore({ email: v.email }); }
        else UI.toast(mode === 'signup' ? 'Welcome to ' + UI.config.name + '!' : 'Welcome back!', 'ok');
      }, function (err) { say(err.message, true); });
    });
    function say(msg, isErr) {
      var box = view.querySelector('[data-msg]');
      box.className = isErr ? 'ui-error' : 'ui-note'; box.textContent = msg; box.hidden = false;
    }
    function restore(v) {
      ['name', 'email'].forEach(function (k) { var i = view.querySelector('[name=' + k + ']'); if (i && v[k]) i.value = v[k]; });
    }
    draw();
  });
})();

/* ===== capture.html ===== */
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
      view.innerHTML = '<div class="ui-wrap cp-wrap"><div class="eyebrow">New scan</div><h1 style="margin:0">Let\'s capture a room</h1>' +
        '<p class="muted" style="margin-top:6px">Walk around it slowly with your phone. The scan station turns your walk into 3D.</p>' +
        '<div class="cp-methods">' +
        '<button class="cp-method' + (method === 'camera' ? ' on' : '') + '" data-method="camera"><span class="ic">' + UI.icon('camera') + '</span>' + (phone ? '<span class="ui-badge brand">Best</span>' : '') +
        '<b>Walk with the camera</b><span>A guided walk: we keep the sharp frames and tell you when to slow down.</span></button>' +
        '<button class="cp-method' + (method === 'video' ? ' on' : '') + '" data-method="video"><span class="ic">' + UI.icon('video') + '</span><b>Upload a video</b><span>Already filmed the room? We take the frames from it.</span></button>' +
        '<button class="cp-method' + (method === 'import' ? ' on' : '') + '" data-method="import"><span class="ic">' + UI.icon('upload') + '</span><b>Import a 3D file</b><span>A PLY or GLB from another scanning app.</span></button></div>' +
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
      view.innerHTML = '<div class="ui-wrap cp-wrap"><div class="eyebrow">Review</div><h1 style="margin:0">' + (enough ? 'Nice walk!' : 'A bit short') + '</h1>' +
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

/* ===== explore.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('explore', { title: 'Explore', nav: 'Explore', icon: 'globe', order: 30 }, function (view, ctx) {
    var opts = { room: null, sort: 'new', q: '' }, first = true;
    view.innerHTML = '<div class="ui-wrap"><div class="ex-head"><div><div class="eyebrow">Explore</div><h1>Rooms people shared</h1>' +
      '<p>Walk into kitchens, studios and living rooms scanned with Logsteps. Copy one to your rooms to try the Studio on it.</p></div>' +
      '<form class="ex-search" data-search><input type="search" name="q" placeholder="Search rooms or people" aria-label="Search"><button class="ui-btn" type="submit">' + UI.icon('search') + '</button></form></div>' +
      '<div class="ex-rooms" data-rooms></div><div class="ex-sort"><span class="muted small" data-count></span><div class="ui-seg" role="group" aria-label="Sort">' +
      [['new', 'Newest'], ['loved', 'Most loved'], ['viewed', 'Most viewed']].map(function (s) { return '<button data-sort="' + s[0] + '" class="' + (s[0] === 'new' ? 'on' : '') + '">' + s[1] + '</button>'; }).join('') +
      '</div></div><div data-list><div class="ls-grid"><div class="ui-skel" style="height:280px"></div><div class="ui-skel" style="height:280px"></div><div class="ui-skel" style="height:280px"></div></div></div></div>';
    function load() {
      return UI.api('list_explore', opts).then(function (d) {
        var rooms = view.querySelector('[data-rooms]'), total = 0;
        Object.keys(d.counts).forEach(function (k) { total += d.counts[k]; });
        rooms.innerHTML = '<button data-room="" class="' + (!opts.room ? 'on' : '') + '">All <small>' + total + '</small></button>' +
          Object.keys(d.rooms).filter(function (k) { return d.counts[k]; }).map(function (k) {
            return '<button data-room="' + k + '" class="' + (opts.room === k ? 'on' : '') + '">' + esc(d.rooms[k]) + ' <small>' + d.counts[k] + '</small></button>';
          }).join('');
        view.querySelector('[data-count]').textContent = UI.plural(d.total, 'room') + (opts.q ? ' for "' + opts.q + '"' : '');
        view.querySelector('[data-list]').innerHTML = d.scans.length ? '<div class="ls-grid">' + d.scans.map(function (s) {
          return LS.card(s, { explore: true, href: 's/' + s.token });
        }).join('') + '</div>' : '<div class="ui-empty">' + UI.icon('globe') + '<h3>No public rooms ' + (opts.q || opts.room ? 'match' : 'yet') + '</h3>' +
          '<p>' + (ctx.me ? 'Make one of yours public to be the first.' : 'Be the first: scan a room and share it.') + '</p></div>';
        first = false;
      });
    }
    view.addEventListener('click', function (e) {
      var r = e.target.closest('[data-room]'), s = e.target.closest('[data-sort]');
      if (r) { opts.room = r.getAttribute('data-room') || null; load(); }
      if (s) { opts.sort = s.getAttribute('data-sort'); view.querySelectorAll('[data-sort]').forEach(function (b) { b.classList.toggle('on', b === s); }); load(); }
    });
    view.addEventListener('submit', function (e) {
      if (!e.target.matches('[data-search]')) return;
      e.preventDefault(); opts.q = UI.formData(e.target).q.trim(); load();
    });
    return load();
  });
})();

/* ===== home.html ===== */
(function () {
  var esc = UI.esc;
  var FILTERS = [['all', 'All'], ['ready', 'Ready'], ['pending', 'On its way'], ['shared', 'Shared']];

  UI.page('home', { title: 'Your rooms', nav: 'Rooms', icon: 'cube', auth: 'user', order: 10 }, function (view, ctx) {
    var data = null, filter = UI.store.get('lib.filter', 'all'), timer = null, alive = true;
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:60px;margin-bottom:20px"></div><div class="ls-grid">' +
      '<div class="ui-skel" style="height:260px"></div><div class="ui-skel" style="height:260px"></div><div class="ui-skel" style="height:260px"></div></div></div>';

    function pending(s) { return s.status === 'queued' || s.status === 'processing'; }
    function visible() {
      return data.scans.filter(function (s) {
        if (filter === 'ready') return s.status === 'ready';
        if (filter === 'pending') return s.status !== 'ready';
        if (filter === 'shared') return s.visibility !== 'private';
        return true;
      });
    }
    function stationChip(st) {
      return '<span class="lb-station' + (st.online ? ' on' : '') + '" data-station><i></i>' +
        (st.online ? 'Scan station online' + (st.queue ? ' · ' + UI.plural(st.queue, 'scan') + ' waiting' : '')
          : 'Scan station offline' + (st.queue ? ' · ' + st.queue + ' waiting' : '')) + '</span>';
    }
    function draw() {
      var t = data.totals, first = esc(ctx.me.name.split(' ')[0]);
      var list = visible();
      view.innerHTML = '<div class="ui-wrap">' +
        '<div class="lb-head"><div><div class="eyebrow">Your rooms</div><h1>' + (t.scans ? 'Hello, ' + first : 'Welcome, ' + first) + '</h1>' +
        '<p>' + (t.scans ? UI.plural(t.scans, 'room') + ' scanned so far. Walk another one?' : 'Scan your first room: walk around it slowly with your phone.') + '</p></div>' +
        '<div class="lb-actions"><a class="ui-btn" href="#capture/import" data-go="capture/import">' + UI.icon('upload') + 'Import</a>' +
        '<a class="ui-btn primary" href="#capture" data-go="capture">' + UI.icon('camera') + 'New scan</a></div></div>' +
        '<div class="lb-stats">' +
        '<div class="lb-stat"><b>' + t.scans + '</b><span>rooms</span></div><div class="lb-stat"><b>' + t.ready + '</b><span>ready in 3D</span></div>' +
        '<div class="lb-stat"><b>' + (t.points > 999999 ? (t.points / 1e6).toFixed(1) + 'M' : t.points > 999 ? Math.round(t.points / 1000) + 'k' : t.points) + '</b><span>points captured</span></div>' +
        '<div class="lb-stat"><b>' + t.shared + '</b><span>shared</span></div></div>' +
        '<div class="lb-bar"><div class="ui-seg" role="group" aria-label="Show">' + FILTERS.map(function (f) {
          return '<button data-filter="' + f[0] + '" class="' + (filter === f[0] ? 'on' : '') + '">' + f[1] + '</button>';
        }).join('') + '</div>' + stationChip(data.station) + '</div>' +
        (list.length ? '<div class="ls-grid">' + list.map(function (s) { return LS.card(s); }).join('') +
          (filter === 'all' ? '<a class="lb-new" href="#capture" data-go="capture"><div>' + UI.icon('scan') + '<b>Scan a room</b><span class="small">About a minute of slow walking</span></div></a>' : '') + '</div>'
          : '<div class="ui-empty">' + UI.icon('cube') + '<h3>' + (filter === 'all' ? 'No rooms yet' : 'Nothing here') + '</h3><p>' +
            (filter === 'shared' ? 'Open a ready room and choose who can see it.' : filter === 'pending' ? 'Every scan is ready.' : 'Scan a room with your phone, or import a model.') +
            '</p><a class="ui-btn primary" href="#capture" data-go="capture">' + UI.icon('camera') + 'New scan</a></div>') +
        '<details class="ui-card lb-tips"' + (t.scans <= 2 ? ' open' : '') + '><summary>' + UI.icon('bulb') + 'Four tips for a great scan</summary><div class="lb-tip-grid">' +
        [['1', 'Light it up', 'Open the curtains and switch the lights on. Dark corners come out patchy.'],
         ['2', 'Walk, don\'t spin', 'Walk slowly along the walls about a metre away. Turning on the spot gives the model nothing to measure.'],
         ['3', 'Sweep up and down', 'Tilt the phone to catch the floor and ceiling edges as you go.'],
         ['4', 'Close the loop', 'Finish where you started. It helps everything line up.']].map(function (x) {
          return '<div class="lb-tip"><span class="n">' + x[0] + '</span><b>' + x[1] + '</b><p>' + x[2] + '</p></div>';
        }).join('') + '</div></details></div>';
    }
    function schedule() {
      clearTimeout(timer);
      if (!alive || !data) return;
      var ids = data.scans.filter(pending).map(function (s) { return s.id; });
      if (!ids.length) return;
      timer = setTimeout(function () {
        UI.apiQuiet('poll_scans', ids).then(function (r) {
          if (!alive) return;
          var changed = false;
          data.scans.forEach(function (s) {
            var u = r.scans[s.id];
            if (!u) return;
            if (u.status === 'ready' && s.status !== 'ready') { UI.toast('"' + s.title + '" is ready in 3D!', 'ok'); changed = 'reload'; }
            else if (u.status !== s.status || u.stage !== s.stage || u.progress !== s.progress) { Object.assign(s, u); changed = changed || true; }
          });
          data.station = r.station;
          if (changed === 'reload') return load();
          if (changed) draw(); else { var c = view.querySelector('[data-station]'); if (c) c.outerHTML = stationChip(r.station); }
          schedule();
        }, function () { schedule(); });
      }, 5000);
    }
    function load() {
      return UI.api('get_library').then(function (d) {
        data = d; draw(); schedule();
        if (d.sample_added) UI.toast('We added a sample room so you can try everything. Delete it whenever you like.');
      });
    }
    view.addEventListener('click', function (e) {
      var f = e.target.closest('[data-filter]');
      if (f) { filter = f.getAttribute('data-filter'); UI.store.set('lib.filter', filter); draw(); }
    });
    return { ready: load(), destroy: function () { alive = false; clearTimeout(timer); } };
  });
})();

/* ===== landing.html ===== */
(function () {
  var COPY = {
    eyebrow: '3D room scanning from your phone',
    title: 'Walk the room.<br><em>Keep it in 3D.</em>',
    lead: 'Walk slowly around any room with your phone. Logsteps turns the walk into a 3D model you can step back into, measure, pin notes on, share with a link, and edit on your computer.',
    cta: 'Scan your first room',
    proof: ['Free', 'Any phone with a camera', 'Your rooms stay private unless you share them'],
    stepsTitle: 'From a short walk to a room you can revisit',
    stepsLead: 'No special hardware, no tripod, no app to install. A minute or two of walking is enough for most rooms.',
    steps: [['Walk', 'Open Logsteps on your phone and walk slowly along the walls. It keeps the sharp frames and tells you when to slow down.'],
            ['We rebuild it', 'Our scan station runs lingbot-map, a 3D foundation model, on your frames, then levels the floor and cleans up the result.'],
            ['Step back in', 'Orbit it like a dollhouse, walk through at eye height, see the floor plan, replay your walk, measure anything.']],
    whoTitle: 'Made for people who live in rooms',
    who: [['home', 'Moving or renovating', 'Know if the sofa fits before you carry it up three floors. Keep the "before" for the "after".'],
          ['brush', 'Interior designers', 'Get a client\'s room without the site visit. Pin ideas on the walls and share one link.'],
          ['key', 'Hosts and landlords', 'Let guests and tenants look around properly, and keep a record of how a place was handed over.'],
          ['cube', 'Makers and 3D artists', 'Download PLY or GLB for Blender, SketchUp or a game engine. Clean it up in Studio first.']],
    featuresTitle: 'Everything you need for a room',
    features: [['play', 'Replay your walk', 'The camera flies the path your phone took, with the real footage in a picture-in-picture.'],
               ['ruler', 'Measure anything', 'Tap two points to get the distance. Calibrate with a door or a table for exact sizes.'],
               ['plan', 'Floor plan view', 'A true top-down view with a scale bar, to sketch layouts and check clearances.'],
               ['pin', 'Pins and notes', 'Mark the socket, the crack, the sofa you\'re keeping. Pins travel with the room.'],
               ['link', 'Share with a link', 'Private by default. Share one room with a link, or make it public in Explore.'],
               ['brush', 'Studio on your computer', 'Crop, clean stray points, level the floor, recolour and resize. Every save is a version.']],
    faq: [['Is it free?', 'Yes. Scanning, viewing, sharing and Studio are free.'],
          ['Which phones work?', 'Any recent phone with a camera and a modern browser (Safari, Chrome, Firefox). No app to install. You can also upload a video you already filmed, or import a PLY or GLB from another scanning app.'],
          ['How accurate are the measurements?', 'Logsteps estimates the scale from how high you held your phone, which is usually within a few percent. For exact numbers, calibrate in Studio: click both ends of something you know (a door, a table) and type its real length.'],
          ['How long does a scan take?', 'Usually one to a few minutes once the scan station picks it up. If many people are scanning at once, yours waits in a queue and the app shows where it is.'],
          ['Who can see my rooms?', 'Only you, until you choose otherwise. A room can be private, shared with a link (anyone who has it can look), or public in Explore. You can change your mind or make a new link at any time. Privacy & Terms has the details.'],
          ['What happens to my footage?', 'The frames are kept with the room so you can replay them and process the room again. You can delete the footage of any room and keep the 3D model.'],
          ['What powers it?', 'The 3D reconstruction is lingbot-map by Robbyant (open source, Apache-2.0), a streaming 3D reconstruction model, running on our own GPU scan station.']],
    bandTitle: 'Got a room nearby?',
    bandLead: 'You probably do. It takes about a minute to scan it.'
  };

  /* the "before": what the phone filmed. Six frames of the same room as you walk past it (nested SVGs crop each frame). */
  function walkArt() {
    var frame = function (x, y, dx, n) {
      return '<svg x="' + x + '" y="' + y + '" width="200" height="126" viewBox="' + dx + ' 0 200 126">' +
        '<rect x="-200" y="0" width="700" height="126" fill="#d9d2c4"/><path d="M-200 86 L500 86 L500 126 L-200 126 Z" fill="#a98f6d"/>' +
        '<rect x="150" y="18" width="70" height="46" fill="#cfe3f0" stroke="#fff" stroke-width="3"/><rect x="20" y="24" width="40" height="30" fill="#e7a35f" opacity=".7"/>' +
        '<rect x="40" y="62" width="110" height="34" rx="6" fill="#c2522b"/><rect x="34" y="54" width="122" height="14" rx="6" fill="#d36a43"/>' +
        '<rect x="180" y="90" width="60" height="10" rx="3" fill="#3a3a3a"/>' +
        '</svg><rect x="' + x + '" y="' + y + '" width="200" height="126" fill="none" stroke="#2a2a2a" stroke-width="2"/>' +
        '<text x="' + (x + 8) + '" y="' + (y + 118) + '" font-family="JetBrains Mono, monospace" font-size="11" fill="#fff" opacity=".85">#' + n + '</text>';
    };
    var shots = [[90, 80, -40, 12], [310, 80, -10, 48], [530, 80, 20, 91], [90, 226, 50, 133], [310, 226, 80, 176], [530, 226, 110, 214]];
    return '<svg viewBox="0 0 1080 430" preserveAspectRatio="xMinYMid slice" aria-hidden="true">' +
      shots.map(function (s) { return frame(s[0], s[1], s[2], s[3]); }).join('') +
      '<circle class="rec" cx="104" cy="50" r="7" fill="#e5484d"/><text x="118" y="55" font-family="JetBrains Mono, monospace" font-size="14" fill="#fff">REC 01:42 · 318 frames</text>' +
      '<path d="M100 396 C260 380 420 404 600 386" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-dasharray="4 8" fill="none"/>' +
      [140, 220, 300, 380, 460, 540].map(function (x, i) { return '<ellipse cx="' + x + '" cy="' + (392 + (i % 2 ? -8 : 4)) + '" rx="7" ry="4" fill="#fff" opacity=".5"/>'; }).join('') +
      '</svg>';
  }

  function heroArt() {
    /* an isometric room (two walls + floor), a sofa, a window, footsteps, the phone with its scan beam, and the 3D dots it captures */
    var dots = '';
    var pts = [[150, 120], [176, 108], [205, 96], [232, 86], [150, 150], [176, 140], [205, 128], [232, 118], [262, 84], [300, 98], [332, 112], [362, 126], [300, 128],
               [332, 142], [362, 158], [262, 116], [176, 172], [205, 160], [150, 182], [300, 162], [332, 176]];
    pts.forEach(function (p, i) { dots += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (i % 3 ? 2.6 : 3.4) + '"/>'; });
    return '<div class="lp-ba" data-ba><div class="side lp-walk">' + walkArt() + '</div><div class="side lp-art" aria-hidden="true">' +
      '<svg viewBox="0 0 520 430" fill="none" stroke-linejoin="round" stroke-linecap="round">' +
      '<path class="wall-l" d="M262 40 70 132v170l192-94z"/>' +
      '<path class="wall-r" d="M262 40l192 92v170L262 208z"/>' +
      '<path class="floor" d="M70 302l192-94 192 94-192 96z"/>' +
      '<path class="ink" stroke-width="2" d="M262 40v168M70 132 262 40l192 92M70 302l192 96 192-96M70 132v170M454 132v170"/>' +
      '<path class="soft" stroke-width="1.2" stroke-dasharray="4 5" d="M70 302l192-94 192 94"/>' +
      /* window on the right wall */
      '<path class="fsurf ink" stroke-width="1.6" d="M318 98l70 34v62l-70-34z"/><path class="soft" stroke-width="1.2" d="M353 115v62M318 129l70 34"/>' +
      /* picture on the left wall */
      '<path class="ink" stroke-width="1.6" d="M150 128l44-21v34l-44 21z" fill="none"/><path class="faccent" opacity=".35" d="M154 137l36-17v24l-36 17z"/>' +
      /* sofa */
      '<path class="fbrand" opacity=".85" d="M128 296l70-34 40 20-70 34z"/><path class="fbrand" d="M128 296v-30l70-34v30z"/><path class="fbrand" opacity=".7" d="M168 316v-14l70-34v14z"/>' +
      '<path class="ink" stroke-width="1.4" d="M128 266l70-34 40 20v30l-70 34-40-20z"/>' +
      /* rug + table */
      '<path class="faccent" opacity=".3" d="M210 318l60-30 64 32-60 30z"/><path class="fink" opacity=".75" d="M246 312l34-17 26 13-34 17z"/>' +
      /* footsteps */
      '<g class="steps"><ellipse cx="300" cy="352" rx="7" ry="4" transform="rotate(-26 300 352)"/><ellipse cx="320" cy="340" rx="7" ry="4" transform="rotate(-26 320 340)"/>' +
      '<ellipse cx="338" cy="352" rx="7" ry="4" transform="rotate(-26 338 352)"/><ellipse cx="358" cy="338" rx="7" ry="4" transform="rotate(-26 358 338)"/></g>' +
      /* scan beam + dots */
      '<path class="beam" d="M382 238 240 70 170 190z"/>' +
      '<g class="dots">' + dots + '</g>' +
      /* the phone */
      '<g transform="rotate(-14 392 250)"><rect x="370" y="210" width="44" height="80" rx="9" class="fink"/><rect x="374" y="218" width="36" height="62" rx="4" class="fsurf"/>' +
      '<circle cx="392" cy="249" r="9" class="brand" stroke-width="2.4"/><circle cx="392" cy="249" r="3" class="fbrand"/></g>' +
      /* dimension line */
      '<path class="brand" stroke-width="1.4" d="M60 318l192 94M56 312l8 12M248 406l8 12"/>' +
      '<text x="140" y="384" class="ftext" font-family="JetBrains Mono, monospace" font-size="13" transform="rotate(26 140 384)">4.80 m</text>' +
      '</svg>' +
      '<div class="lp-tag t1">' + UI.icon('ruler') + '<span>Sofa to window</span><b>2.14 m</b></div>' +
      '<div class="lp-tag t2">' + UI.icon('cube') + '<b>184,302</b><span>points</span></div></div>' +
      '<span class="lbl l" aria-hidden="true">Your walk</span><span class="lbl r" aria-hidden="true">Your room, in 3D</span>' +
      '<input type="range" min="0" max="100" value="46" aria-label="Drag to compare the phone walk with the 3D room"><span class="handle"></span></div>';
  }

  function stepPic(i) {
    var pics = [
      '<svg viewBox="0 0 120 84" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="46" y="10" width="28" height="52" rx="6"/><circle cx="60" cy="34" r="6" stroke="#c2522b"/><path d="M14 74c14-6 26-6 40-2s28 4 52-4" stroke-dasharray="3 5"/><path d="M24 68l4 2M40 70l4 1M70 72l4-1M88 69l4-2" stroke="#c2522b"/></svg>',
      '<svg viewBox="0 0 120 84" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="38" y="16" width="44" height="44" rx="6"/><rect x="50" y="28" width="20" height="20" rx="2"/><path d="M48 10v6M60 10v6M72 10v6M48 60v6M60 60v6M72 60v6M32 26h6M32 38h6M32 50h6M82 26h6M82 38h6M82 50h6"/><path d="M96 30c6 4 6 20 0 24" stroke="#4f7f6a"/><path d="M24 30c-6 4-6 20 0 24" stroke="#4f7f6a"/></svg>',
      '<svg viewBox="0 0 120 84" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M60 8 24 26v34l36 18 36-18V26z"/><path d="M24 26l36 18 36-18M60 44v34" opacity=".5"/><path d="M38 52l14 7" stroke="#c2522b" stroke-width="2.4" stroke-linecap="round"/><circle cx="76" cy="38" r="3" fill="#c2522b" stroke="none"/></svg>'];
    return pics[i];
  }

  UI.page('landing', { title: 'Welcome' }, function (view, ctx) {
    var me = ctx.me, C = COPY, esc = UI.esc;
    var primary = me ? '<a class="ui-btn primary lg" href="#capture" data-go="capture">' + UI.icon('camera') + 'Scan a room</a><a class="ui-btn lg" href="#home" data-go="home">Your rooms</a>'
      : '<a class="ui-btn primary lg" href="#auth/signup" data-go="auth/signup">' + esc(C.cta) + ' ' + UI.icon('arrow') + '</a>' +
        '<a class="ui-btn lg" href="#explore" data-go="explore">' + UI.icon('globe') + 'Explore rooms</a>';
    view.innerHTML =
      '<section class="lp-hero"><div class="ui-wrap"><div class="lp-pitch">' +
        '<div class="eyebrow">' + esc(C.eyebrow) + '</div><h1>' + C.title + '</h1><p class="lp-lead">' + esc(C.lead) + '</p>' +
        '<div class="lp-cta">' + primary + '</div>' +
        '<div class="lp-proof">' + C.proof.map(function (p) { return '<span>' + UI.icon('check') + esc(p) + '</span>'; }).join('') + '</div>' +
      '</div>' + heroArt() + '</div></section>' +
      '<section class="lp-section" id="how"><div class="ui-wrap"><div class="lp-head"><div class="eyebrow">How it works</div><h2>' + esc(C.stepsTitle) + '</h2><p>' + esc(C.stepsLead) + '</p></div>' +
        '<div class="lp-steps">' + C.steps.map(function (s, i) {
          return '<div class="ui-card lp-step"><div class="pic">' + stepPic(i) + '</div><span class="num">STEP 0' + (i + 1) + '</span><h3>' + esc(s[0]) + '</h3><p class="muted" style="margin:0">' + esc(s[1]) + '</p></div>';
        }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><div class="eyebrow">Explore</div><h2>Walk into rooms people shared</h2><p>Real-time 3D in your browser. Drag to look around, then try Walk and Replay.</p></div>' +
        '<div data-rooms><div class="ls-grid"><div class="ui-skel" style="height:280px"></div><div class="ui-skel" style="height:280px"></div><div class="ui-skel" style="height:280px"></div></div></div>' +
        '<div class="lp-rooms-foot"><a class="ui-btn" href="#explore" data-go="explore">' + UI.icon('globe') + 'See all public rooms</a></div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><h2>' + esc(C.whoTitle) + '</h2></div><div class="lp-who">' + C.who.map(function (w) {
        return '<div class="ui-card">' + UI.icon(w[0]) + '<h3>' + esc(w[1]) + '</h3><p>' + esc(w[2]) + '</p></div>';
      }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><h2>' + esc(C.featuresTitle) + '</h2></div>' +
        '<div class="ui-grid">' + C.features.map(function (f) { return '<div class="ui-card lp-feature">' + UI.icon(f[0]) + '<h3>' + esc(f[1]) + '</h3><p>' + esc(f[2]) + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><h2>Questions</h2></div><div class="lp-faq">' +
        C.faq.map(function (q) { return '<details><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-band"><div><h2>' + esc(C.bandTitle) + '</h2><p>' + esc(C.bandLead) + '</p></div>' +
        (me ? '<a class="ui-btn lg" href="#capture" data-go="capture">' + UI.icon('camera') + 'Scan a room</a>' : '<a class="ui-btn lg" href="#auth/signup" data-go="auth/signup">' + esc(C.cta) + '</a>') +
      '</div><p class="lp-credit">3D reconstruction by <a href="https://github.com/Robbyant/lingbot-map" target="_blank" rel="noopener">lingbot-map</a> (Robbyant, Apache-2.0). 3D viewer by three.js.</p></div></section>';
    var ba = view.querySelector('[data-ba]');
    if (ba) ba.querySelector('input').addEventListener('input', function (e) { ba.style.setProperty('--x', e.target.value + '%'); });
    return UI.api('list_explore', { sort: 'loved' }).then(function (d) {
      var box = view.querySelector('[data-rooms]');
      box.innerHTML = d.scans.length ? '<div class="ls-grid">' + d.scans.slice(0, 3).map(function (s) { return LS.card(s, { explore: true, href: 's/' + s.token }); }).join('') + '</div>'
        : '<div class="ui-empty">' + UI.icon('globe') + '<h3>Be the first to share a room</h3></div>';
    }, function () { var box = view.querySelector('[data-rooms]'); if (box) box.innerHTML = ''; });
  });
})();

/* ===== profile.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('profile', { title: 'Your profile', auth: 'user' }, function (view, ctx) {
    var me = ctx.me;
    view.innerHTML = '<div class="ui-wrap ui-narrow"><div class="pf-head"><span class="ui-avatar">' + esc(UI.initials(me.name)) + '</span>' +
      '<div><h1>' + esc(me.name) + '</h1><div class="muted">' + esc(me.email) + (me.joined ? ' · member since ' + esc(UI.fmtDate(me.joined, { month: 'long', year: 'numeric' })) : '') + '</div></div></div>' +
      '<div class="pf-grid"><form class="ui-card ui-stack" data-name><h3>Your name</h3><label class="ui-field"><span>Shown to other people</span>' +
      '<input type="text" name="name" value="' + esc(me.name) + '" maxlength="60" required></label><button class="ui-btn primary" type="submit">Save</button></form>' +
      '<div class="ui-card ui-stack"><h3>Appearance</h3><p class="muted small">Follow your device, or pick one.</p><div data-theme-box></div>' +
      '<h3 style="margin-top:22px">Password</h3><p class="muted small">We\'ll email you a link to choose a new one.</p>' +
      '<button class="ui-btn" data-reset>' + UI.icon('mail') + 'Email me a reset link</button></div></div>' +
      '<div class="ui-card" style="margin-top:16px"><div class="pf-links">' +
      (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
      '<button data-feedback>' + UI.icon('chat') + 'Submit feedback</button>' +
      '<button data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms, and your data</button>' +
      '<button data-signout-here>' + UI.icon('logout') + 'Sign out</button></div></div></div>';
    function themeBox() {
      var t = UI.theme();
      view.querySelector('[data-theme-box]').innerHTML = '<div class="ui-seg">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
        return '<button type="button" data-theme-pick="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    }
    themeBox();
    view.addEventListener('click', function (e) {
      var t = e.target.closest('[data-theme-pick]');
      if (t) { UI.setTheme(t.getAttribute('data-theme-pick')); themeBox(); UI.renderChrome(); return; }
      if (e.target.closest('[data-reset]')) {
        UI.busy(e.target.closest('[data-reset]'), UI.auth('reset', { email: me.email })).then(function (r) { UI.toast(r.message, 'ok'); });
      }
      if (e.target.closest('[data-signout-here]')) UI.auth('logout');
    });
    view.querySelector('[data-name]').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = UI.formData(e.target);
      UI.busy(e.target.querySelector('[type=submit]'), UI.api('update_profile', v.name)).then(function (r) {
        UI.setMe(r.me); ctx.me = r.me; UI.toast('Saved', 'ok');
        view.querySelector('.pf-head h1').textContent = r.me.name;
      });
    });
  });
})();

/* ===== scan.html ===== */
(function () {
  var esc = UI.esc;
  var SOURCE = { station: ['cpu', 'Scan station'], studio: ['edit', 'Studio'], import: ['upload', 'Imported'], remix: ['copy', 'Copied'], sample: ['sparkle', 'Sample'], demo: ['sparkle', 'Demo'] };
  var COLORS = [['brand', 'Terracotta'], ['accent', 'Sage'], ['gold', 'Gold'], ['ink', 'Ink']];

  UI.page('scan', { title: 'Room', auth: 'user' }, function (view, ctx) {
    var id = ctx.args[0], scan = null, viewer = null, timer = null, alive = true, addingPin = false;
    view.innerHTML = '<div class="ui-wrap sc-wrap"><div class="ui-skel" style="height:56vh"></div></div>';

    function shareUrl() { return location.origin + location.pathname + '#s/' + scan.token; }
    function wait() {
      var s = scan, cap = s.capture || {};
      var stepNow = s.status === 'queued' ? 1 : s.progress < 0.6 ? 2 : s.progress < 0.9 ? 3 : 4;
      var steps = [['upload', 'Frames uploaded'], ['clock', 'In the queue' + (s.queue_position ? ' (number ' + s.queue_position + ')' : '')],
                   ['cpu', 'Reconstructing with lingbot-map'], ['layers', 'Cleaning up and building the surface'], ['cube', 'Ready to explore']];
      var st = s.station || {};
      var failed = s.status === 'failed', stuck = s.status === 'capturing';
      view.innerHTML = '<div class="ui-wrap sc-wrap">' + topbar() + '<div class="sc-wait">' +
        '<div class="sc-hero">' + (s.cover ? '<img src="' + esc(s.cover) + '" alt="">' : '<div class="art">' + LS.roomArt(s.id) + '</div>') +
        (!failed && !stuck ? '<div class="sc-scanline"></div>' : '') + '</div>' +
        '<div class="ui-card"><div class="eyebrow">' + esc(s.room_label) + '</div><h1 style="font-size:1.8rem;margin:0">' + esc(s.title) + '</h1>' +
        (failed ? '<p class="sc-stage" style="color:var(--c-bad)">This scan didn\'t work</p><p class="muted">' + esc(s.error || 'The scan station couldn\'t line the frames up.') + '</p>' +
          (s.frames ? '<p class="small muted">Try again with a different quality, or scan the room again in better light.</p><div class="ui-row" style="margin-top:12px">' +
            '<select data-quality style="max-width:180px"><option value="fast">Fast</option><option value="balanced" selected>Balanced</option><option value="detailed">Detailed</option></select>' +
            '<button class="ui-btn primary" data-retry>' + UI.icon('refresh') + 'Try again</button></div>' : '')
        : stuck ? '<p class="sc-stage">The upload didn\'t finish</p><p class="muted">The app was closed before all the frames arrived. Scan the room again; this one can be deleted.</p>' +
          '<a class="ui-btn primary" href="#capture" data-go="capture">' + UI.icon('camera') + 'Scan again</a>'
        : '<p class="sc-stage" data-stage>' + esc(s.stage || 'Waiting for the scan station') + '</p>' +
          '<div class="sc-bar"><i data-bar style="width:' + Math.max(3, Math.round((s.progress || 0) * 100)) + '%"></i></div>' +
          '<p class="small muted" data-station>' + (st.online ? UI.icon('check') + ' The scan station is online' + (st.gpu ? ' (' + esc(st.gpu) + ')' : '') + '.'
            : 'The scan station is offline right now. Your scan waits safely in the queue and starts as soon as it\'s back.') + '</p>' +
          '<ul class="sc-steps">' + steps.map(function (x, i) {
            return '<li class="' + (i < stepNow ? 'done' : i === stepNow ? 'now' : '') + '">' + UI.icon(i < stepNow ? 'check' : x[0]) + esc(x[1]) + '</li>';
          }).join('') + '</ul><p class="small muted" style="margin-top:12px">You can close this page; the room appears in your library when it\'s ready.</p>') +
        '<dl class="sc-kv" style="margin-top:16px"><dt>Frames</dt><dd>' + (s.frames || 0) + '</dd>' + (cap.seconds ? '<dt>Walk</dt><dd>' + cap.seconds + ' s</dd>' : '') +
        '<dt>Quality</dt><dd>' + esc((s.settings && s.settings.quality) || 'balanced') + '</dd></dl>' +
        (s.frames_url && s.frames ? '<div class="sc-strip">' + strip(s) + '</div>' : '') +
        '<div class="ui-row" style="margin-top:16px"><button class="ui-btn sm danger" data-delete>' + UI.icon('trash') + 'Delete</button></div></div></div></div>';
    }
    function strip(s) {
      var n = Math.min(6, s.frames), out = '';
      for (var i = 0; i < n; i++) out += '<img loading="lazy" alt="" onerror="this.style.visibility=\'hidden\'" src="' + esc(s.frames_url + '&i=' + Math.floor(i * (s.frames - 1) / Math.max(1, n - 1))) + '">';
      return out;
    }
    function topbar() {
      return '<div class="sc-top"><a class="ui-btn ghost sm" href="#home" data-go="home">' + UI.icon('back') + 'Your rooms</a><span class="ui-spacer"></span>' +
        (scan.status === 'ready' ? LS.visBadge(scan.visibility) : LS.statusBadge(scan)) + '</div>';
    }

    function ready() {
      var s = scan, st = s.model.stats || {};
      var size = s.size || st.size;
      view.innerHTML = '<div class="ui-wrap sc-wrap">' + topbar() + '<div class="sc-grid"><div>' +
        '<div class="sc-sticky"><div class="sc-view" data-view></div><div data-controls></div></div></div>' +
        '<aside class="sc-side">' +
        '<div class="sc-title" data-titlebox>' + titleHtml() + '</div>' +
        '<div class="ui-card sc-card"><h3>' + UI.icon('ruler') + 'Measurements</h3>' +
        (size ? '<div class="sc-dims"><div><b>' + size[0].toFixed(2) + '</b><span>wide · m</span></div><div><b>' + size[1].toFixed(2) + '</b><span>deep · m</span></div>' +
          '<div><b>' + size[2].toFixed(2) + '</b><span>high · m</span></div></div>' : '') +
        '<dl class="sc-kv">' + (s.area ? '<dt>Floor</dt><dd>≈ ' + s.area + ' m²</dd>' : '') + '<dt>Points</dt><dd>' + LS.fmtNum(st.points || s.points) + '</dd>' +
        ((st.faces || s.faces) ? '<dt>Surface</dt><dd>' + LS.fmtNum(st.faces || s.faces) + ' triangles</dd>' : '') +
        (s.process_ms ? '<dt>Processed in</dt><dd>' + Math.round(s.process_ms / 1000) + ' s</dd>' : '') + '</dl>' +
        '<p class="small muted" style="margin:10px 0 0">' + (s.scale_source === 'calibrated' ? UI.icon('check') + ' Calibrated in Studio: measurements are exact to the reference you gave.'
          : s.scale_source === 'import' ? 'Sizes come from the imported file.' : 'Sizes are estimated from how high your phone was held. For exact measurements, calibrate in Studio.') + '</p></div>' +
        '<div class="ui-card sc-card"><h3>' + UI.icon('pin') + 'Pins</h3><div class="sc-pins" data-pins></div>' +
        (s.can_edit ? '<button class="ui-btn sm" data-addpin>' + UI.icon('pinplus') + 'Add a pin</button>' : '') + '</div>' +
        (s.can_edit ? shareCard() : '') +
        '<div class="ui-card sc-card"><h3>' + UI.icon('edit') + 'Edit and download</h3>' +
        '<a class="ui-btn primary block" href="#studio/' + esc(s.id) + '" data-go="studio/' + esc(s.id) + '" style="margin-bottom:10px">' + UI.icon('brush') + 'Open in Studio</a>' +
        '<p class="small muted" style="margin:-2px 0 12px">Crop, clean, level the floor, calibrate the size and recolour, on a computer.</p>' +
        '<div class="sc-dl"><button class="ui-btn sm" data-dl="cloud">' + UI.icon('download') + 'Points (.ply)</button>' +
        (s.model.mesh ? '<button class="ui-btn sm" data-dl="mesh">' + UI.icon('download') + 'Surface (.ply)</button>' : '') +
        '<button class="ui-btn sm" data-dl="glb">' + UI.icon('download') + '3D file (.glb)</button></div></div>' +
        (s.can_edit ? '<div class="ui-card sc-card sc-notes"><h3>' + UI.icon('chat') + 'Notes</h3><textarea data-notes maxlength="2000" placeholder="Paint colours, what to buy, ideas…">' + esc(s.notes) + '</textarea></div>' : '') +
        (s.versions ? versionsCard() : '') +
        (s.can_edit ? '<div class="ui-card sc-card"><h3>' + UI.icon('image') + 'Footage</h3>' +
          (s.frames ? '<p class="small muted">' + s.frames + ' frames are kept for the replay picture-in-picture and to process the room again.</p>' +
            '<div class="ui-row"><button class="ui-btn sm" data-reprocess>' + UI.icon('refresh') + 'Process again</button><button class="ui-btn sm danger" data-delfootage>' + UI.icon('trash') + 'Delete footage</button></div>'
            : '<p class="small muted" style="margin:0">No footage kept for this room.</p>') + '</div>' +
          '<button class="ui-btn danger block" data-delete>' + UI.icon('trash') + 'Delete this room</button>' : '') +
        '</aside></div></div>';
      drawPins();
      LS.open(view.querySelector('[data-view]'), s, { onPin: null }).then(function (v) {
        if (!alive) { v.dispose(); return; }
        viewer = v;
        LS.controls(view.querySelector('[data-controls]'), v, s, {});
        v.onPick = function (p) {
          if (!addingPin) return true;
          addingPin = false; v.renderer.domElement.style.cursor = '';
          if (!p) { UI.toast('Tap right on the room to place a pin.', 'error'); return false; }
          pinDialog({ p: [p.x, p.y, p.z], label: '', note: '', color: 'brand' }, -1);
          return false;
        };
        if (s.can_edit && !s.thumb && s.status === 'ready') {
          setTimeout(function () {
            if (!alive || !viewer) return;
            try { UI.apiQuiet('set_thumb', s.id, viewer.snapshot(640, 480, true)).catch(function () {}); } catch (e) {}
          }, 700);
        }
      }).catch(function () {});
    }
    function titleHtml() {
      var s = scan;
      return '<div class="eyebrow">' + esc(s.room_label) + '</div><div class="row"><h1 style="flex:1">' + esc(s.title) + '</h1>' +
        (s.can_edit ? '<button class="ui-btn ghost icon sm" data-rename aria-label="Rename">' + UI.icon('edit') + '</button>' : '') + '</div>' +
        '<div class="meta"><span>Scanned ' + esc(UI.fmtDate(s.created)) + '</span>' + (s.frames ? '<span>· ' + s.frames + ' frames</span>' : '') +
        (s.source === 'sample' ? '<span>· sample</span>' : '') + (s.views ? '<span>· ' + UI.plural(s.views, 'view') + '</span>' : '') +
        (s.hearts ? '<span>· ' + s.hearts + ' ♥</span>' : '') + '</div>';
    }
    function shareCard() {
      var s = scan, v = s.visibility;
      return '<div class="ui-card sc-card sc-share" data-sharebox><h3>' + UI.icon('link') + 'Share</h3>' +
        '<div class="ui-seg" role="group" aria-label="Who can see it">' + [['private', 'lock', 'Private'], ['link', 'link', 'Link'], ['public', 'globe', 'Public']].map(function (o) {
          return '<button data-vis="' + o[0] + '" class="' + (v === o[0] ? 'on' : '') + '">' + UI.icon(o[1]) + o[2] + '</button>';
        }).join('') + '</div>' +
        (v === 'private' ? '<p class="small muted" style="margin:0">Only you can see this room. Choose Link to share it with someone, or Public to show it in Explore too.</p>'
          : '<div class="sc-link"><input type="text" readonly value="' + esc(shareUrl()) + '" data-linkfield aria-label="Share link">' +
            '<button class="ui-btn sm primary" data-copy>' + UI.icon('copy') + 'Copy</button></div>' +
            '<div class="ui-row" style="margin-top:8px">' + (navigator.share ? '<button class="ui-btn sm" data-nshare>' + UI.icon('external') + 'Send</button>' : '') +
            '<a class="ui-btn sm" href="#s/' + esc(s.token) + '" data-go="s/' + esc(s.token) + '">' + UI.icon('eye') + 'See it as others do</a>' +
            '<button class="ui-btn sm ghost" data-newlink title="The old link stops working">' + UI.icon('refresh') + 'New link</button></div>' +
            '<p class="small muted" style="margin:8px 0 0">' + (v === 'public' ? 'Anyone with the link can open it, and it shows in Explore.' : 'Anyone with the link can open it, even without an account.') + '</p>') + '</div>';
    }
    function versionsCard() {
      return '<div class="ui-card sc-card"><h3>' + UI.icon('history') + 'Versions</h3><div class="sc-vers">' + scan.versions.map(function (x) {
        var src = SOURCE[x.source] || ['cube', x.source];
        return '<div class="sc-ver' + (x.current ? ' cur' : '') + '"><span class="n">v' + x.n + '</span><div><p>' + esc(x.note || src[1]) + '</p>' +
          '<small>' + esc(src[1]) + ' · ' + esc(UI.ago(x.created)) + (x.stats && x.stats.points ? ' · ' + LS.fmtNum(x.stats.points) + ' pts' : '') + '</small></div>' +
          (x.current ? '<span class="ui-badge good">In use</span>' : scan.can_edit ? '<div class="ui-row" style="gap:2px"><button class="ui-btn sm" data-usever="' + x.n + '">Use</button>' +
            '<button class="ui-btn sm ghost icon" data-delver="' + x.n + '" aria-label="Delete version ' + x.n + '">' + UI.icon('trash') + '</button></div>' : '') + '</div>';
      }).join('') + '</div></div>';
    }
    function drawPins() {
      var box = view.querySelector('[data-pins]');
      if (!box) return;
      var list = scan.annotations || [];
      box.innerHTML = list.length ? list.map(function (a, i) {
        return '<div class="sc-pin"><span class="dot ' + esc(a.color) + '"></span><div class="grow"><b>' + esc(a.label) + '</b>' + (a.note ? '<small>' + esc(a.note) + '</small>' : '') + '</div>' +
          (scan.can_edit ? '<button class="ui-btn ghost icon sm" data-editpin="' + i + '" aria-label="Edit pin">' + UI.icon('edit') + '</button>' : '') + '</div>';
      }).join('') : '<p class="small muted" style="margin:0">' + (scan.can_edit ? 'Pin notes to things in the room: furniture to keep, a crack to fix, where the socket is.' : 'No pins yet.') + '</p>';
      if (viewer) viewer.setPins(list);
    }
    function savePins(list) {
      return UI.api('save_annotations', scan.id, list).then(function (r) { scan.annotations = r.annotations; drawPins(); });
    }
    function pinDialog(a, idx) {
      var m = UI.modal('<h2>' + (idx < 0 ? 'New pin' : 'Edit pin') + '</h2><form class="ui-stack" data-pinform>' +
        '<label class="ui-field"><span>Label</span><input type="text" name="label" maxlength="60" required value="' + esc(a.label) + '" placeholder="e.g. Sofa, keep"></label>' +
        '<label class="ui-field"><span>Note <em>(optional)</em></span><textarea name="note" maxlength="300" rows="3">' + esc(a.note || '') + '</textarea></label>' +
        '<div class="ui-choices">' + COLORS.map(function (c) {
          return '<label class="ui-choice"><input type="radio" name="color" value="' + c[0] + '"' + ((a.color || 'brand') === c[0] ? ' checked' : '') + '><span><span class="sc-pin" style="border:0;padding:0"><span class="dot ' + c[0] + '"></span></span>' + c[1] + '</span></label>';
        }).join('') + '</div>' +
        '<div class="ui-row end">' + (idx >= 0 ? '<button type="button" class="ui-btn danger" data-rmpin>' + UI.icon('trash') + 'Remove</button><span class="ui-spacer"></span>' : '') +
        '<button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">Save</button></div></form>');
      var f = m.el.querySelector('[data-pinform]');
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = UI.formData(f), list = (scan.annotations || []).slice();
        var item = { p: a.p, label: v.label, note: v.note, color: v.color };
        if (idx < 0) list.push(item); else list[idx] = item;
        UI.busy(f.querySelector('[type=submit]'), savePins(list)).then(function () { m.close(); UI.toast('Pin saved', 'ok'); });
      });
      var rm = m.el.querySelector('[data-rmpin]');
      if (rm) rm.addEventListener('click', function () {
        var list = (scan.annotations || []).slice(); list.splice(idx, 1);
        savePins(list).then(function () { m.close(); });
      });
    }
    function download(kind) {
      var name = (scan.title || 'room').replace(/[^\w\- ]+/g, '').trim() || 'room';
      if (kind === 'glb') {
        if (!viewer) return;
        var obj = viewer.group;
        new THREE.GLTFExporter().parse(obj, function (buf) {
          save(new Blob([buf], { type: 'model/gltf-binary' }), name + '.glb');
        }, function (err) { UI.toast('Couldn\'t make the 3D file: ' + err, 'error'); }, { binary: true, onlyVisible: false });
        return;
      }
      var url = scan.model[kind];
      if (!url) return;
      LS.fetchBuffer(url).then(function (buf) { save(new Blob([buf], { type: 'application/octet-stream' }), name + (kind === 'mesh' ? '-surface' : '') + '.ply'); });
    }
    function save(blob, name) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      UI.toast('Downloaded ' + name, 'ok');
    }
    function apply(r) { scan = r.scan; }
    function redrawSide(sel, html) { var el = view.querySelector(sel); if (el) el.outerHTML = html; }

    view.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-vis]'))) {
        UI.api('update_scan', scan.id, { visibility: t.getAttribute('data-vis') }).then(function (r) {
          apply(r); redrawSide('[data-sharebox]', shareCard());
          var tb = view.querySelector('.sc-top'); if (tb) tb.outerHTML = topbar();
          UI.toast(scan.visibility === 'private' ? 'Only you can see it now' : scan.visibility === 'link' ? 'Anyone with the link can see it' : 'It\'s public, and in Explore', 'ok');
        });
      } else if (e.target.closest('[data-copy]')) {
        var f = view.querySelector('[data-linkfield]');
        (navigator.clipboard ? navigator.clipboard.writeText(f.value) : Promise.reject()).then(function () { UI.toast('Link copied', 'ok'); },
          function () { f.select(); document.execCommand('copy'); UI.toast('Link copied', 'ok'); });
      } else if (e.target.closest('[data-nshare]')) {
        navigator.share({ title: scan.title, text: 'A room I scanned in 3D with Logsteps', url: shareUrl() }).catch(function () {});
      } else if (e.target.closest('[data-newlink]')) {
        UI.confirm({ title: 'Make a new link?', text: 'The current link stops working. People who had it can\'t open the room any more.', ok: 'New link' }).then(function (y) {
          if (y) UI.api('reset_link', scan.id).then(function (r) { apply(r); redrawSide('[data-sharebox]', shareCard()); UI.toast('New link made', 'ok'); });
        });
      } else if (e.target.closest('[data-rename]')) {
        var box = view.querySelector('[data-titlebox]');
        box.innerHTML = '<form class="ui-stack" data-renameform><input type="text" name="title" maxlength="80" value="' + esc(scan.title) + '">' +
          '<select name="room">' + Object.keys(ROOMS).map(function (k) { return '<option value="' + k + '"' + (scan.room === k ? ' selected' : '') + '>' + esc(ROOMS[k]) + '</option>'; }).join('') + '</select>' +
          '<div class="ui-row"><button class="ui-btn primary sm" type="submit">Save</button><button class="ui-btn ghost sm" type="button" data-cancelrename>Cancel</button></div></form>';
        box.querySelector('input').focus();
      } else if (e.target.closest('[data-cancelrename]')) {
        view.querySelector('[data-titlebox]').innerHTML = titleHtml();
      } else if (e.target.closest('[data-addpin]')) {
        if (!viewer) return;
        addingPin = true; viewer.renderer.domElement.style.cursor = 'crosshair'; viewer.hint('Tap the spot for your pin.');
        if (window.innerWidth < 980) view.querySelector('[data-view]').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if ((t = e.target.closest('[data-editpin]'))) {
        var i = +t.getAttribute('data-editpin'); pinDialog(scan.annotations[i], i);
      } else if ((t = e.target.closest('[data-dl]'))) {
        download(t.getAttribute('data-dl'));
      } else if ((t = e.target.closest('[data-usever]'))) {
        UI.api('set_current_version', scan.id, +t.getAttribute('data-usever')).then(function (r) { if (viewer) viewer.dispose(); viewer = null; apply(r); ready(); UI.toast('Switched version', 'ok'); });
      } else if ((t = e.target.closest('[data-delver]'))) {
        var n = +t.getAttribute('data-delver');
        UI.confirm({ title: 'Delete version ' + n + '?', text: 'This version\'s 3D files are deleted for good.', ok: 'Delete', danger: true }).then(function (y) {
          if (y) UI.api('delete_version', scan.id, n).then(function (r) { apply(r); redrawSide('.sc-vers', '<div class="sc-vers"></div>'); ready(); });
        });
      } else if (e.target.closest('[data-delfootage]')) {
        UI.confirm({ title: 'Delete the footage?', text: 'The 3D room stays. You lose the replay pictures and can\'t process this room again.', ok: 'Delete footage', danger: true }).then(function (y) {
          if (y) UI.api('delete_footage', scan.id).then(function (r) { if (viewer) viewer.dispose(); viewer = null; apply(r); ready(); UI.toast('Footage deleted', 'ok'); });
        });
      } else if (e.target.closest('[data-reprocess]')) {
        var m = UI.modal('<h2>Process this room again?</h2><p class="muted">The scan station rebuilds it from the footage. The current version stays in Versions.</p>' +
          '<form class="ui-stack" data-reform><div class="ui-choices">' + [['fast', 'Fast'], ['balanced', 'Balanced'], ['detailed', 'Detailed']].map(function (q) {
            return '<label class="ui-choice"><input type="radio" name="quality" value="' + q[0] + '"' + (q[0] === 'detailed' ? ' checked' : '') + '><span>' + q[1] + '</span></label>';
          }).join('') + '</div><label class="ui-check"><input type="checkbox" name="mesh" checked> Build a surface too</label>' +
          '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">' + UI.icon('refresh') + 'Process again</button></div></form>');
        m.el.querySelector('[data-reform]').addEventListener('submit', function (ev) {
          ev.preventDefault(); var v = UI.formData(ev.target);
          UI.api('reprocess', scan.id, { quality: v.quality, mesh: v.mesh }).then(function (r) { m.close(); if (viewer) viewer.dispose(); viewer = null; apply(r); render(); });
        });
      } else if (e.target.closest('[data-retry]')) {
        UI.api('reprocess', scan.id, { quality: view.querySelector('[data-quality]').value }).then(function (r) { apply(r); render(); });
      } else if (e.target.closest('[data-delete]')) {
        UI.confirm({ title: 'Delete "' + scan.title + '"?', text: 'The room, its versions, footage and share link are deleted for good.', ok: 'Delete', danger: true }).then(function (y) {
          if (y) UI.api('delete_scan', scan.id).then(function () { UI.toast('Deleted'); UI.go('home'); });
        });
      }
    });
    view.addEventListener('submit', function (e) {
      if (!e.target.matches('[data-renameform]')) return;
      e.preventDefault();
      var v = UI.formData(e.target);
      UI.api('update_scan', scan.id, { title: v.title, room: v.room }).then(function (r) {
        apply(r); view.querySelector('[data-titlebox]').innerHTML = titleHtml(); UI.toast('Saved', 'ok');
      });
    });
    view.addEventListener('focusout', function (e) {
      if (!e.target.matches('[data-notes]') || e.target.value === scan.notes) return;
      var val = e.target.value;
      UI.apiQuiet('update_scan', scan.id, { notes: val }).then(function (r) { scan.notes = r.scan.notes; UI.toast('Notes saved', 'ok'); });
    });

    var ROOMS = LS.ROOMS;
    function poll() {
      clearTimeout(timer);
      if (!alive || !scan || (scan.status !== 'queued' && scan.status !== 'processing')) return;
      timer = setTimeout(function () {
        UI.apiQuiet('poll_scans', [scan.id]).then(function (r) {
          var u = r.scans[scan.id];
          if (!alive || !u) return;
          if (u.status !== scan.status) { return load(); }
          scan.stage = u.stage; scan.progress = u.progress; scan.station = r.station;
          var stg = view.querySelector('[data-stage]'), bar = view.querySelector('[data-bar]');
          if (stg) stg.textContent = u.stage || 'Waiting for the scan station';
          if (bar) bar.style.width = Math.max(3, Math.round(u.progress * 100)) + '%';
          poll();
        }, poll);
      }, 4000);
    }
    function render() { if (scan.status === 'ready') ready(); else { wait(); poll(); } }
    function load() {
      return UI.api('get_scan', id).then(function (r) {
        if (r.redirect) { location.hash = r.redirect; return; }
        var was = scan && scan.status;
        scan = r.scan;
        if (was && was !== 'ready' && scan.status === 'ready') UI.toast('Your room is ready in 3D!', 'ok');
        render();
      });
    }
    return { ready: load(), destroy: function () { alive = false; clearTimeout(timer); if (viewer) viewer.dispose(); } };
  });
})();

/* ===== share.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('s', { title: 'Shared room' }, function (view, ctx) {
    var token = ctx.args[0], scan = null, viewer = null, alive = true;
    view.innerHTML = '<div class="ui-wrap sh-wrap"><div class="ui-skel" style="height:64vh"></div></div>';

    function heartBtn() {
      return '<button class="ui-btn sh-heart' + (scan.hearted ? ' on' : '') + '" data-heart aria-pressed="' + !!scan.hearted + '">' + UI.icon('heart') + '<span>' + scan.hearts + '</span></button>';
    }
    function draw() {
      var s = scan, st = s.model.stats || {}, size = s.size || st.size;
      view.innerHTML = '<div class="ui-wrap sh-wrap">' +
        '<div class="sh-head"><div><div class="eyebrow">' + esc(s.room_label) + ' · shared room</div><h1>' + esc(s.title) + '</h1>' +
        '<div class="sh-by"><span class="ui-avatar">' + esc(UI.initials(s.author)) + '</span><span>Scanned by <b>' + esc(s.author) + '</b></span><span>·</span><span>' + esc(UI.fmtDate(s.created)) + '</span>' +
        '<span>·</span><span>' + UI.plural(s.views, 'view') + '</span></div></div>' +
        '<div class="sh-actions">' + heartBtn() +
        (s.owner_view ? '<a class="ui-btn" href="#scan/' + esc(s.id) + '" data-go="scan/' + esc(s.id) + '">' + UI.icon('edit') + 'Manage</a>'
          : '<button class="ui-btn" data-remix>' + UI.icon('copy') + 'Copy to my rooms</button>') +
        '<button class="ui-btn primary" data-sharelink>' + UI.icon('link') + 'Share</button></div></div>' +
        '<div class="sh-view" data-view></div><div data-controls></div>' +
        '<div class="sh-info"><div class="ui-card sc-card"><h3>' + UI.icon('chat') + 'About this room</h3>' +
        (s.notes ? '<p class="sh-notes">' + esc(s.notes) + '</p>' : '<p class="muted" style="margin:0">No notes.</p>') +
        ((s.annotations || []).length ? '<h3 style="margin-top:18px">' + UI.icon('pin') + 'Pins</h3><div class="sh-pins">' + s.annotations.map(function (a) {
          return '<div class="sc-pin"><span class="dot ' + esc(a.color) + '"></span><div class="grow"><b>' + esc(a.label) + '</b>' + (a.note ? '<small>' + esc(a.note) + '</small>' : '') + '</div></div>';
        }).join('') + '</div>' : '') + '</div>' +
        '<div class="ui-card sc-card"><h3>' + UI.icon('ruler') + 'Size</h3>' +
        (size ? '<div class="sc-dims"><div><b>' + size[0].toFixed(2) + '</b><span>wide · m</span></div><div><b>' + size[1].toFixed(2) + '</b><span>deep · m</span></div>' +
          '<div><b>' + size[2].toFixed(2) + '</b><span>high · m</span></div></div>' : '') +
        '<dl class="sc-kv">' + (s.area ? '<dt>Floor</dt><dd>≈ ' + s.area + ' m²</dd>' : '') + '<dt>Points</dt><dd>' + LS.fmtNum(st.points || s.points) + '</dd></dl>' +
        '<p class="small muted" style="margin:10px 0 0">Use Measure under the view to check any distance yourself.</p></div></div>' +
        (!ctx.me ? '<div class="sh-cta"><img src="_/theme/icon.svg" alt=""><div><h3>Scan your own rooms</h3><p>Walk around a room with your phone. Get a 3D model you can replay, measure and share like this one.</p></div>' +
          '<a class="ui-btn lg" href="#auth/signup" data-go="auth/signup">Try Logsteps, free</a></div>' : '') + '</div>';
      LS.open(view.querySelector('[data-view]'), s).then(function (v) {
        if (!alive) { v.dispose(); return; }
        viewer = v;
        v.controls.autoRotate = true; v.controls.autoRotateSpeed = 0.7;
        v.controls.addEventListener('start', function () { v.controls.autoRotate = false; });
        LS.controls(view.querySelector('[data-controls]'), v, s, {});
      }).catch(function () {});
    }
    view.addEventListener('click', function (e) {
      if (e.target.closest('[data-heart]')) {
        if (!ctx.me) { UI.after = location.hash; UI.toast('Sign in to keep the rooms you love.'); UI.go('auth', 'signup'); return; }
        UI.api('toggle_heart', token).then(function (r) {
          scan.hearted = r.hearted; scan.hearts = r.hearts;
          var b = view.querySelector('[data-heart]'); b.outerHTML = heartBtn();
          if (r.hearted) view.querySelector('[data-heart]').classList.add('pop');
        });
      } else if (e.target.closest('[data-remix]')) {
        if (!ctx.me) { UI.after = location.hash; UI.toast('Make a free account to keep a copy.'); UI.go('auth', 'signup'); return; }
        UI.busy(e.target.closest('[data-remix]'), UI.api('remix', token)).then(function (r) {
          UI.toast('Copied to your rooms. Open it in Studio to make it yours.', 'ok'); UI.go('scan', r.scan_id);
        });
      } else if (e.target.closest('[data-sharelink]')) {
        var url = location.href;
        if (navigator.share) { navigator.share({ title: scan.title, url: url }).catch(function () {}); return; }
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { UI.toast('Link copied', 'ok'); }, function () { UI.toast(url); });
      }
    });
    function load() {
      return UI.api('get_shared', token).then(function (r) { scan = r.scan; document.title = scan.title + ' · ' + UI.config.name; draw(); }, function (err) {
        view.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('lock') + '<h3>This room isn\'t shared</h3><p>' + esc(err.message) + '</p>' +
          '<a class="ui-btn primary" href="#explore" data-go="explore">' + UI.icon('globe') + 'Explore public rooms</a></div></div>';
      });
    }
    return { ready: load(), destroy: function () { alive = false; if (viewer) viewer.dispose(); } };
  });
})();

/* ===== studio.html ===== */
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
      var k = e.key.toLowerCase();
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
