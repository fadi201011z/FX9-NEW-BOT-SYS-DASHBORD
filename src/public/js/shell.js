/* ═══════════════════════════════════════════════════════════════════════════
   Kratos Dashboard — shell behaviour

   Three jobs, all of them things main.js and theme.js do not know about:

     1. give the bar its scrolled state once the page has moved;
     2. keep the shell's aria-expanded flags honest as the rail and the two
        menus are opened and closed;
     3. hide the notification badge when the count is zero.

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
})();
