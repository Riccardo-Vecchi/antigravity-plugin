/* Host-owned identity outside the guest. Remote pages cannot hide this strip.
 * Navigation remains available for Google and enterprise/federated sign-in.
 * This controller adopts existing guests, preserving their sessions and drafts.
 */
(() => {
  "use strict";
  const VERSION = "1.0.0";
  if (globalThis.__AGGeminiOrigin?.version === VERSION) return;
  globalThis.__AGGeminiOrigin?.destroy();
  const classify = globalThis.__AGPAClassifyGuestURL;
  delete globalThis.__AGPAClassifyGuestURL;
  const i18n = globalThis.__AGPAI18n;
  let guest = null,
    dialog = null,
    removers = [],
    stopped = false;
  let identity = classify(null);
  const strip = document.createElement("div");
  strip.className = "agpa-guest-identity";
  strip.setAttribute("role", "status");
  strip.setAttribute("data-agpa-guest-identity", "");
  const label = document.createElement("strong"),
    origin = document.createElement("span"),
    back = document.createElement("button"),
    native = document.createElement("button");
  origin.className = "agpa-guest-origin";
  back.type = "button";
  native.type = "button";
  native.textContent = "Antigravity";
  strip.append(label, origin, back, native);
  const style = document.createElement("style");
  style.textContent = `
    .agpa-guest-identity{display:flex;align-items:center;flex-wrap:wrap;gap:12px;flex:none;min-height:44px;padding:7px 14px;box-sizing:border-box;border-bottom:1px solid var(--border,#444);background:var(--background,#171717);color:var(--foreground,#eee);font:12px system-ui,sans-serif;-webkit-app-region:no-drag}
    .agpa-gemini:has(>.agpa-guest-identity:not([hidden]))>.agpa-gemini-fallback{display:none!important}
    .agpa-guest-identity[hidden]{display:none!important}.agpa-guest-identity strong{flex:none;font-weight:500}.agpa-guest-origin{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr;unicode-bidi:isolate}
    .agpa-guest-identity button{flex:none;border:1px solid var(--border,#444);border-radius:8px;background:transparent;color:inherit;padding:6px 10px;font:inherit;cursor:pointer}.agpa-guest-identity button:focus-visible{outline:2px solid #398bdb;outline-offset:2px}`;
  document.head.append(style);
  function paint() {
    strip.hidden = identity.trusted;
    label.textContent = i18n.t(identity.label);
    origin.textContent = identity.origin || i18n.t("Origin unavailable");
    origin.title = identity.origin;
    back.textContent = i18n.t("Return to Gemini");
    native.setAttribute("aria-label", i18n.t("Return to Antigravity"));
    const name = `${i18n.t(identity.label)}${identity.origin ? ` — ${identity.origin}` : ""}`;
    guest?.setAttribute("aria-label", name);
    dialog?.setAttribute("aria-label", name);
    // Consumers use this same identity for the native window and menu title.
    document.dispatchEvent(new Event("agpa:guest-identity"));
  }
  function read() {
    if (!guest) return;
    let url;
    try {
      url = guest.getURL();
    } catch {
      /* Guest may not be attached yet. */
    }
    identity = classify(url);
    paint();
  }
  function detach() {
    for (const remove of removers) remove();
    removers = [];
    guest = null;
    dialog = null;
    strip.remove();
    identity = classify(null);
  }
  function adopt() {
    if (stopped) return;
    const next = document.querySelector("[data-agpa-gemini] webview");
    if (next === guest) return;
    detach();
    if (!next) {
      paint();
      return;
    }
    guest = next;
    dialog = next.closest("[data-agpa-gemini]");
    // Flex sibling, never an overlay: the page has no pixels behind the strip.
    dialog.insertBefore(strip, guest);
    const on = (name, fn) => {
      next.addEventListener(name, fn);
      removers.push(() => next.removeEventListener(name, fn));
    };
    on("did-start-navigation", (event) => {
      if (event.isMainFrame !== true) return;
      // Show prospective destinations immediately; hide only after a committed
      // main-frame navigation confirms the actual Gemini origin.
      identity = classify(event.url);
      if (identity.trusted) identity = classify(null);
      paint();
    });
    for (const name of [
      "did-navigate",
      "did-navigate-in-page",
      "did-redirect-navigation",
    ])
      on(name, (event) => {
        if (event.isMainFrame !== false) read();
      });
    for (const name of ["dom-ready", "did-stop-loading", "did-fail-load"])
      on(name, read);
    on("render-process-gone", () => {
      identity = classify(null);
      paint();
    });
    read();
  }
  back.addEventListener("click", () => {
    if (guest?.isConnected) guest.src = "https://gemini.google.com/";
  });
  native.addEventListener("click", () => {
    document.querySelector("[data-agpa-return-antigravity]")?.click();
  });
  const observer = new MutationObserver(adopt);
  observer.observe(document.body, { subtree: true, childList: true });
  const unsubscribe = i18n.subscribe(paint);
  globalThis.__AGGeminiOrigin = {
    version: VERSION,
    status: () => ({
      ...identity,
      title: identity.trusted
        ? "Google Gemini"
        : `${i18n.t(identity.label)}${identity.origin ? ` — ${identity.origin}` : ""}`,
    }),
    destroy() {
      stopped = true;
      observer.disconnect();
      unsubscribe();
      detach();
      style.remove();
      delete globalThis.__AGGeminiOrigin;
    },
  };
  adopt();
})();
