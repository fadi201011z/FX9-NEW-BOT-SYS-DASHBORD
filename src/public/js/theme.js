document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('krs-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
});

/* The two lines below are the reason this file still exists. The dashboard has
   no control of its own any more, but it still has to honour a theme picked on
   the page that does, and that is all these do -- read the key, put it on the
   root. There is no icon to update: the toggle in the bar was the only thing
   carrying #themeIcon, and home.ejs's theme button is text next to a fixed
   palette glyph, so nothing here had a second end to attach to. */
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

