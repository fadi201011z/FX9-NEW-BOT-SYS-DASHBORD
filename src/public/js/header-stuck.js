/* The header pill is transparent at the top of the page and takes its glass
   back once the page has moved a little, so the hero reads straight through it
   on arrival and the bar only frosts when there is content behind it to frost.

   Eight pixels is the threshold: enough that a sub-pixel scroll or a rubber-band
   overscroll on touch does not flicker the bar, small enough that the glass is
   there by the time anyone notices the page moved.

   No rAF throttling on purpose. The handler reads scrollY, which does not force
   layout, and writes one class — cheaper than the frame bookkeeping it would
   replace, and it keeps the bar in step with the scrollbar on every event. */
(function () {
  var header = document.getElementById('nxHeader');
  if (!header) return;

  var THRESHOLD = 8;

  function update() {
    var stuck = (window.pageYOffset || document.documentElement.scrollTop) > THRESHOLD;
    if (stuck !== header.classList.contains('is-stuck')) {
      header.classList.toggle('is-stuck', stuck);
    }
  }

  addEventListener('scroll', update, { passive: true });
  /* Landing on a deep link or restoring a scroll position starts mid-page. */
  update();
})();