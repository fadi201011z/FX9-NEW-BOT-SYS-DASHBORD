/* ── theme ───────────────────────────────────────────────────────────────────
   The site is dark-only. There is no toggle and no second palette to switch to:
   the root <html> already carries data-theme="dark" in the layout, and the
   [data-theme="light"] rules that used to back the switch are gone with it.

   What is left is the one thing a stale browser still needs. The old toggle
   wrote its choice to localStorage under "krs-theme", so a visitor who picked
   light once would keep that key. This pins it back to dark on every load, so
   nothing that reads the key can land on a theme the site no longer ships. */
document.documentElement.setAttribute('data-theme', 'dark');
try {
  localStorage.setItem('krs-theme', 'dark');
} catch (_) {
  /* storage disabled — the attribute above is already the whole effect */
}
