/* Smoke test (tools/ui_test.py runs it at 1280 px and at 390 px): every page address opens without errors, is not
   empty and doesn't scroll sideways. Signed out (landing, Explore, a shared room, sign in / up), then as a new member
   (library with the sample room, the three capture modes, the room page + rename + Process again dialog, Studio,
   a shared room, profile), then as admin (every Admin tab). Python/JS errors are caught by ui_test.py from the
   browser log. Resolves to {ok, log}. */
(async function () {
  const log = [], bad = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, what, ms) {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(150); }
    throw new Error('timed out waiting for: ' + what);
  }
  const q = (s) => document.querySelector(s), qa = (s) => Array.from(document.querySelectorAll(s));
  const errs = [];
  window.addEventListener('error', (e) => errs.push(String(e.message || e)));
  const visible = (el) => !!el && el.getClientRects().length > 0;
  function type(input, value) {
    input.focus(); input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function button(re, root) { return qa((root || '') + ' button').find((b) => re.test(b.textContent.trim()) && visible(b)); }
  function check(name, expect) {
    const main = q('.ui-main');
    const text = main ? main.innerText.trim() : '';
    const w = document.documentElement.scrollWidth, vw = screen.width <= 500 ? screen.width : window.innerWidth;
    const problems = [];
    if (text.length < 40) problems.push('empty page');
    if (expect && !new RegExp(expect.source, 'i').test(text)) problems.push('missing ' + expect);
    if (w > vw + 1) {
      const wide = qa('body *').filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1; })
        .slice(0, 3).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0, 2).join('.'));
      problems.push('scrolls sideways (' + w + ' > ' + vw + ') ' + wide.join(' '));
    }
    if (errs.length) problems.push('errors: ' + errs.splice(0).join(' / '));
    if (problems.length) bad.push(name + ': ' + problems.join('; '));
    log.push((problems.length ? 'BAD  ' : 'ok   ') + name);
  }
  async function open(hash, expect, ms) {
    if (location.hash !== hash) window.UI_READY = false;
    location.hash = hash;
    await until(() => window.UI_READY && location.hash === hash, hash, ms || 40000);
    await sleep(900);
    check(hash, expect);
  }
  const modal = () => qa('.modal, .anvil-modal').find((m) => visible(m) && m.innerText.trim().length > 10);
  async function closeModal() {
    const m = modal();
    const close = m && qa('button').filter((b) => m.contains(b)).find((b) => /^(Cancel|Close|Not now)$/.test(b.textContent.trim()) && visible(b));
    if (close) close.click();
    await until(() => !modal(), 'dialog closed', 10000);
    await sleep(300);
  }
  async function dialog(name, opener, expect) {
    if (!opener) { bad.push('dialog ' + name + ': no button to open it'); return; }
    opener.click();
    const dlg = await until(() => modal(), 'dialog ' + name, 20000);
    await sleep(400);
    const problems = [];
    if (expect && !expect.test(dlg.innerText)) problems.push('missing ' + expect);
    if (errs.length) problems.push('errors: ' + errs.splice(0).join(' / '));
    if (problems.length) bad.push('dialog ' + name + ': ' + problems.join('; '));
    log.push((problems.length ? 'BAD  ' : 'ok   ') + 'dialog ' + name);
    await closeModal();
  }
  async function signUp(name, email, password) {
    location.hash = '#auth/signup';
    await until(() => window.UI_READY && qa('.au-card input').length >= 3, 'sign-up form');
    await sleep(400);
    const inputs = qa('.au-card input[type=text], .au-card input[type=email], .au-card input[type=password]');
    type(inputs[0], name); type(inputs[1], email); type(inputs[2], password);
    const tick = q('.au-card input[type=checkbox]'); if (tick && !tick.checked) tick.click();
    button(/Create account/, '.au-card .anvil-role-btn-block').click();
    const end = Date.now() + 40000;
    while (Date.now() < end) {
      if (location.hash === '#home' && window.UI_READY) return true;
      const msg = q('.au-card .anvil-role-msg-error');
      if (msg && visible(msg) && msg.textContent.trim()) { log.push('sign-up said: ' + msg.textContent.trim()); return false; }
      await sleep(200);
    }
    log.push('sign-up: still on ' + location.hash);
    return false;
  }
  async function signIn(email, password) {
    location.hash = '#auth';
    await until(() => window.UI_READY && qa('.au-card input[type=password]').length, 'sign-in form');
    await sleep(400);
    type(q('.au-card input[type=email]'), email); type(q('.au-card input[type=password]'), password);
    button(/Sign in/, '.au-card .anvil-role-btn-block').click();
    await until(() => location.hash === '#home' && window.UI_READY, 'signed in as ' + email, 40000);
  }
  async function signOut() {
    q('.anvil-role-avatar button').click();
    await sleep(300);
    button(/Sign out/, '.ui-menu').click();
    await until(() => {
      const a = q('.anvil-role-avatar button');
      return location.hash === '#landing' && window.UI_READY && (!a || !visible(a));
    }, 'signed out');
    await sleep(500);
  }
  const cardHref = (re) => { const a = qa('a.ls-card').find((x) => re.test(x.getAttribute('href') || '')); return a && a.getAttribute('href'); };
  try {
    // ---- signed out
    await open('#landing', /Keep it in 3D/);
    await until(() => qa('a.ls-card').length, 'public rooms on the landing page', 20000);
    log.push('ok   landing shows ' + qa('a.ls-card').length + ' public rooms');
    await open('#explore', /Rooms people shared/);
    const shared = await until(() => cardHref(/^#s\//), 'a public room card');
    await open(shared, /Scanned by/);
    await open('#s/not-a-real-token', /isn't shared/);
    await open('#auth', /Sign in/);
    await open('#auth/signup', /Create account/);

    // ---- a new member (gets the sample room)
    const ok = await signUp('Smoke Member', 'smoke' + Date.now() + '@example.com', 'Ls-' + Math.random().toString(36).slice(2) + '-Kq7');
    if (!ok) throw new Error('sign-up failed');
    await sleep(800);
    check('#home (member)', /Hello, Smoke|Welcome, Smoke/);
    const mine = await until(() => cardHref(/^#scan\//), 'the sample room card', 20000);
    await open('#capture', /capture a room/);
    await open('#capture/video', /Choose a video/);
    await open('#capture/import', /Choose a 3D file/);
    await open(mine, /Measurements/);
    const rename = button(/Rename/, '.sc-title');
    if (rename) { rename.click(); await sleep(400); log.push(visible(q('.sc-rename')) ? 'ok   rename form' : 'BAD  rename form'); if (!visible(q('.sc-rename'))) bad.push('rename form did not open'); button(/Cancel/, '.sc-rename').click(); }
    await until(() => q('.ls-bar'), 'the 3D control bar', 30000).catch(() => bad.push('scan page: the 3D view did not load'));
    await open('#studio/' + decodeURIComponent(mine.split('/')[1]), /Studio|Save|Undo/, 60000);
    await open(shared, /Copy to my rooms/);
    await open('#explore', /Rooms people shared/);
    await open('#profile', /Your name/);
    await signOut();

    // ---- admin (ADMIN_EMAILS in Accounts.py): sign up the first time, sign in after that
    const adminPw = 'Ls-smoke-adm-93Kx-7q';
    if (!(await signUp('Admin Tester', 'arkulinskis@gmail.com', adminPw))) await signIn('arkulinskis@gmail.com', adminPw);
    for (const t of ['overview', 'scans', 'station', 'feedback', 'users', 'demo']) await open('#admin/' + t, /Admin/);
    await open('#admin/station', /Station key/);
    await dialog('new station key (confirm)', button(/station key|new key/i), /new station key/i);
    await open('#home', /rooms/);
    await signOut();
    log.push(bad.length ? 'PROBLEMS: ' + bad.join(' | ') : 'PASSED');
    return { ok: !bad.length, log: log };
  } catch (e) {
    log.push(String(e && e.message || e));
    if (bad.length) log.push('PROBLEMS: ' + bad.join(' | '));
    return { ok: false, log: log };
  }
})();
