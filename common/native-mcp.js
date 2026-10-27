/* Optional adapter to Antigravity's existing MCP state provider, never a general RPC bridge. */
(() => {
 'use strict';
 const SERVER = 'antigravity-plugin-computer-use';
 function provider() {
  const anchors = [document.querySelector('[data-testid=settings-nav-item-App]'),
   document.querySelector('[data-testid=settings-button]'),
   ...document.querySelectorAll('h1,h2')].filter(Boolean).slice(0, 8);
  for (const element of anchors) {
   const key = Object.keys(element).find(k => k.startsWith('__reactFiber$'));
   if (!key) continue;
   for (let fiber = element[key], depth = 0; fiber && depth < 180; fiber = fiber.return, depth++) {
    const value = fiber.memoizedProps?.value;
    // Recognized native provider contract. Interface changes disable this route.
    if (value && Array.isArray(value.states) && typeof value.isInitialized === 'boolean' && typeof value.refresh === 'function') return value;
   }
  }
  return null;
 }
 globalThis.__AGNativeMcp = {
  async refresh() {const current = provider(); if (!current) return false; await current.refresh(false, SERVER); return true;},
  status() {const current = provider(); const own = current?.states.find(s => s.spec?.serverName === SERVER); return {available: !!current, detected: !!own};},
  destroy() {delete globalThis.__AGNativeMcp;},
 };
})();
