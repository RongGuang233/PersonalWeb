/* Runs before first paint: a stored dark choice must never flash the light theme.
   A non-deferred head script is the only CSP-safe way to do this (`script-src 'self'`
   forbids the usual inline snippet). */
(() => {
  'use strict';
  let stored = null;
  try { stored = localStorage.getItem('appearance'); } catch {}
  const followsSystem = stored !== 'dark' && stored !== 'light';
  const dark = followsSystem
    ? Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    : stored === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (followsSystem) document.documentElement.dataset.themeSource = 'system';
})();
