/* ═══════════════════════════════════════════════════════════════════════════
   Kratos Dashboard — shell behaviour

   Four jobs, all of them things main.js and theme.js do not know about:

     1. give the bar its scrolled state once the page has moved;
     2. keep the shell's aria-expanded flags honest as the rail and the two
        menus are opened and closed;
     3. hide the notification badge when the count is zero;
     4. own the one tooltip both rails use.

   Everything here is an observer or a passive scroll listener rather than a
   patched function. main.js owns toggleSidebar / toggleUserMenu / toggleNotif
   and websocket.js owns the badge's textContent; wrapping any of those would
   mean two files disagreeing about what the shell's state is. Watching the
   class and the text instead keeps a single writer and costs one observer on
   a handful of elements.

   No rAF throttling on the scroll handler: reading scrollY does not force
   layout and it writes one class, which is cheaper than the frame bookkeeping
   it would replace. Same reasoning as js/header-stuck.js on the public pages.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 1. The bar's two states ──────────────────────────────────────────────
     Transparent until the page has moved 8px, then a faint fill, a blur and a
     shadow. Eight rather than zero because a sub-pixel scroll or a rubber-band
     overscroll on touch would otherwise flicker the whole bar. The hairline
     under the bar is not part of this -- it is always there, because it is the
     frame's dividing line and not a scroll state. */

  var navbar = document.getElementById('navbar');
  if (navbar) {
    var THRESHOLD = 8;

    var syncPill = function () {
      var moved = (window.pageYOffset || document.documentElement.scrollTop) > THRESHOLD;
      navbar.classList.toggle('is-stuck', moved);
    };

    addEventListener('scroll', syncPill, { passive: true });
    /* Landing on a deep link or restoring a scroll position starts mid-page. */
    syncPill();
  }

  /* ── 2. aria-expanded, from the classes the toggles already write ──────────
     The rail reports itself through .open on narrow screens, the menus through
     .show. attributeFilter keeps this from waking on the style writes that
     follow every class change. */

  var wires = [
    { target: 'sidebar', control: 'sidebarToggle', className: 'open', narrowOnly: true },
    { target: 'userMenu', control: '.user-btn', className: 'show' },
    { target: 'notifMenu', control: '.notif-btn', className: 'show' }
  ];

  wires.forEach(function (wire) {
    var node = document.getElementById(wire.target);
    var control = wire.control.charAt(0) === '.' ? document.querySelector(wire.control) : document.getElementById(wire.control);
    if (!node || !control) return;

    var sync = function () {
      /* The rail is a permanent feature above 768px and a drawer below it, so
         "is it open" is only a question worth asking on a narrow screen.
         Reporting false on desktop would announce a permanently available
         toggle as permanently collapsed. */
      var open = node.classList.contains(wire.className) && (!wire.narrowOnly || window.innerWidth <= 768);
      control.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    new MutationObserver(sync).observe(node, { attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', sync, { passive: true });
    sync();
  });

  /* ── 3. A zero count is not news ───────────────────────────────────────────
     main.js and websocket.js both write the badge's textContent directly. A red
     "0" on every page load reads as an error rather than as a count, so the
     badge is hidden at zero and shown from one. */

  var badge = document.getElementById('notifBadge');
  if (badge) {
    var syncBadge = function () {
      var count = parseInt(badge.textContent, 10);
      badge.dataset.empty = (!count || count < 1) ? '1' : '0';
    };

    new MutationObserver(syncBadge).observe(badge, { childList: true, characterData: true, subtree: true });
    syncBadge();
  }

  /* ── 4. One tooltip, for both rails ───────────────────────────────────────
     Both rails scroll, and a scroll container clips sideways -- one axis being
     auto makes the other auto, never visible. That is not a footnote: a tooltip
     drawn inside .sidebar-nav or .guild-rail-scroll is cut off at the rail's
     own edge, so the label of whatever you are pointing at never appears at
     all. The collapsed rail's tooltips were drawn as pseudo-elements inside the
     nav scroller for exactly that reason and were invisible for exactly that
     reason; they also pushed themselves toward the window edge rather than the
     page, because inline-start in an RTL document is the side the rail already
     occupies. Both faults are gone here rather than patched, because a fixed
     element on <body> is outside every clip in the shell.

     One element for both rails, positioned from a measured rectangle. Fixed
     rather than absolute so no ancestor's overflow can reach it; one element
     rather than one per row because a row has no tooltip until the pointer is on
     it, and fourteen hidden tooltips would all need the same six declarations.

     The text comes from data-tip, then from aria-label. The second is not a
     convenience: a navigation row carries its name in a child that is hidden
     while the rail is collapsed, so aria-label is what it needs for a screen
     reader anyway. Where a row means one thing to the eye and another to its
     name -- a server the bot is not in -- data-tip wins, and it is the reason
     both attributes exist rather than one. */

  var TIP_ROWS = '.nav-link, .sidebar-collapse-btn, .sidebar-logout, .guild-rail-item';
  var railTip = document.createElement('div');
  railTip.className = 'rail-tip';
  railTip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(railTip);

  var tipOwner = null;

  var hideTip = function () {
    if (!tipOwner) return;
    tipOwner = null;
    railTip.classList.remove('is-on');
  };

  var showTip = function (el) {
    /* A navigation row says its own name out loud while the rail is expanded,
       so a tip there would be the label twice. The collapse handle is exempt: it
       says the same thing on both sides of the state it controls, and neither
       state prints it on the button. */
    var side = document.getElementById('sidebar');
    if (el.closest('#sidebar') && !(side && side.classList.contains('collapsed'))
        && !el.classList.contains('sidebar-collapse-btn')) return hideTip();

    var text = el.getAttribute('data-tip') || el.getAttribute('aria-label') || '';
    if (!text) return hideTip();
    if (el === tipOwner) return;

    railTip.textContent = text;
    railTip.classList.add('is-on');
    tipOwner = el;

    /* Measured with the text in and is-on applied: opacity and transform are not
       layout, so the width read back is this string's width and not the previous
       one's.

       The gap is measured from the RAIL's edge and not the row's. It reads like
       the same number either way, and on the navigation rail it is -- a row fills
       its rail. On the server rail it is not: the row is 44px in a 72px column, so
       it sits 14.5px in from the rail's edge and a 12px gap measured from the row
       leaves the label overlapping the gutter, over the rail's own hairline and
       the "you are here" bar. Anchored to the rail, the label always starts just
       outside the frame. The row still supplies the vertical centre, which is the
       one thing the rail cannot know. */
    var r = el.getBoundingClientRect();
    var rail = el.closest('.guild-rail, .sidebar');
    var anchor = rail ? rail.getBoundingClientRect() : r;
    railTip.style.left = Math.round(anchor.left - 12 - railTip.offsetWidth) + 'px';
    railTip.style.top = Math.round(r.top + r.height / 2) + 'px';
  };

  var tipFrom = function (e) {
    return e.target && e.target.closest ? e.target.closest(TIP_ROWS) : null;
  };

  document.addEventListener('pointerover', function (e) { showTip(tipFrom(e)); });
  document.addEventListener('focusin', function (e) {
    var el = tipFrom(e);
    if (el) showTip(el); else hideTip();
  });
  document.addEventListener('focusout', hideTip);
  /* A press that navigates should not leave a label pointing at nothing, and a
     rail that scrolls under a stationary tip would leave it pointing at the wrong
     row. Capture on scroll so the rails' own scrollers count too. */
  document.addEventListener('pointerdown', hideTip, true);
  addEventListener('scroll', hideTip, { passive: true, capture: true });
  addEventListener('resize', hideTip, { passive: true });
  addEventListener('blur', hideTip);
})();
