document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('krs-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
});

/* The two lines below are the reason this file still exists. The dashboard has
   no control of its own any more, but it still has to honour a theme picked on
   the page that does, and that is all these do -- read the key, put it on the
   root. Nothing here updates the button on home.ejs: that one now carries a sun
   and a moon and lets a [data-theme] rule in its own stylesheet pick which of the
   two is on screen, so the attribute this writes is the whole of the wiring. */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('krs-theme', next);

  fetch('/api/user/settings/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { theme: next } }),
  }).catch(() => {});
}

