/* ls-cards.js: LS.ROOMS, LS.roomArt (the isometric room drawing on cards), LS.statusBadge/visBadge/card (used by the engine screens), moved from the old web/pages/_cards.html. */
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
