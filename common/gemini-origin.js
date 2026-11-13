/* Host-owned identity outside the guest. Remote pages cannot hide this strip.
 * Navigation remains available for Google and enterprise/federated sign-in.
 * This controller adopts existing guests, preserving their sessions and drafts.
 */
(() => {
  "use strict";
  const VERSION = "1.1.2";
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
  const editMenu = document.createElement("div");
  editMenu.className = "agpa-guest-edit-menu";
  editMenu.setAttribute("popover", "manual");
  editMenu.setAttribute("role", "menu");
  const style = document.createElement("style");
  style.textContent = `
    .agpa-guest-identity{display:flex;align-items:center;flex-wrap:wrap;gap:12px;flex:none;min-height:44px;padding:7px 14px;box-sizing:border-box;border-bottom:1px solid var(--border,#444);background:var(--background,#171717);color:var(--foreground,#eee);font:12px system-ui,sans-serif;-webkit-app-region:no-drag}
    .agpa-gemini:has(>.agpa-guest-identity:not([hidden]))>.agpa-gemini-fallback{display:none!important}
    .agpa-guest-identity[hidden]{display:none!important}.agpa-guest-identity strong{flex:none;font-weight:500}.agpa-guest-origin{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr;unicode-bidi:isolate}
    .agpa-guest-identity button{flex:none;border:1px solid var(--border,#444);border-radius:8px;background:transparent;color:inherit;padding:6px 10px;font:inherit;cursor:pointer}.agpa-guest-identity button:focus-visible{outline:2px solid #398bdb;outline-offset:2px}`;
  style.textContent += `
    .agpa-guest-edit-menu{position:fixed;inset:auto;margin:0;min-width:145px;padding:4px;box-sizing:border-box;border:1px solid var(--border,#444);border-radius:9px;background:var(--popover,#232323);color:var(--popover-foreground,#eee);font:inherit;box-shadow:0 6px 24px #0005}
    .agpa-guest-edit-menu button{display:flex;align-items:center;gap:9px;width:100%;padding:6px 12px;border:0;border-radius:5px;text-align:start;background:none;color:inherit;font:inherit}
    .agpa-guest-edit-menu svg{width:15px;height:15px;flex:none;opacity:.8}
    .agpa-guest-edit-menu button:is(:hover,:focus-visible){background:var(--accent,#383838);outline:none}`;
  document.head.append(style);
  function closeEditMenu(restoreFocus = false) {
    if (!editMenu.matches(":popover-open")) return;
    editMenu.hidePopover();
    if (restoreFocus && dialog?.open) guest?.focus();
  }
  const editIcons = {
    cut: "M6 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M6 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M8 8l12 12M8 16 20 4",
    copy: "M8 8h12v12H8zM16 5V4H4v12h1",
    paste: "M8 5H5v15h14V5h-3M8 3h8v4H8zM8 11h8m-8 4h6",
    selectAll: "M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4m4-7h8m-8 3h8m-8 3h8",
  };
  function openEditMenu(event) {
    if (!dialog?.open || !event.params) return;
    const { editFlags = {}, isEditable, x, y } = event.params;
    const commands = [
      ["Cut", "cut", isEditable && editFlags.canCut],
      ["Copy", "copy", editFlags.canCopy],
      ["Paste", "paste", isEditable],
      ["Select all", "selectAll", editFlags.canSelectAll],
    ];
    closeEditMenu();
    editMenu.replaceChildren();
    for (const [label, command, enabled] of commands) {
      if (!enabled || typeof guest[command] !== "function") continue;
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      const icon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      for (const [key, value] of Object.entries({
        viewBox: "0 0 24 24",
        "aria-hidden": "true",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.65",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }))
        icon.setAttribute(key, value);
      const path = document.createElementNS(icon.namespaceURI, "path");
      path.setAttribute("d", editIcons[command]);
      icon.append(path);
      item.append(icon, i18n.t(label));
      item.onclick = () => {
        if (!dialog?.open || !guest?.isConnected) return;
        closeEditMenu(true);
        guest[command]();
      };
      editMenu.append(item);
    }
    if (!editMenu.childElementCount) return;
    editMenu.showPopover();
    const bounds = guest.getBoundingClientRect();
    editMenu.style.left = `${Math.max(0, Math.min(bounds.left + (x || 0), innerWidth - editMenu.offsetWidth))}px`;
    editMenu.style.top = `${Math.max(0, Math.min(bounds.top + (y || 0), innerHeight - editMenu.offsetHeight))}px`;
    editMenu.firstElementChild.focus({ preventScroll: true });
  }
  editMenu.addEventListener("keydown", (event) => {
    const items = [...editMenu.children];
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape" || event.key === "Tab") closeEditMenu(true);
    else if (event.key === "ArrowDown")
      items[(index + 1) % items.length].focus();
    else if (event.key === "ArrowUp")
      items[(index - 1 + items.length) % items.length].focus();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  const dismissOutside = (event) => {
    if (!editMenu.contains(event.target)) closeEditMenu();
  };
  document.addEventListener("pointerdown", dismissOutside, true);
  const forwardEditShortcut = (event) => {
    if (
      !dialog?.open ||
      document.activeElement !== guest ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.shiftKey ||
      event.ctrlKey === event.metaKey
    )
      return;
    const method = { x: "cut", c: "copy", v: "paste", a: "selectAll" }[
      event.key.toLowerCase()
    ];
    if (!method || typeof guest[method] !== "function") return;
    event.preventDefault();
    event.stopPropagation();
    guest[method]();
  };
  document.addEventListener("keydown", forwardEditShortcut, true);
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
    closeEditMenu();
    editMenu.remove();
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
    dialog.append(editMenu);
    const close = () => closeEditMenu();
    dialog.addEventListener("close", close);
    const owner = dialog;
    removers.push(() => owner.removeEventListener("close", close));
    const on = (name, fn) => {
      next.addEventListener(name, fn);
      removers.push(() => next.removeEventListener(name, fn));
    };
    on("context-menu", openEditMenu);
    on("focus", close);
    on("did-start-navigation", (event) => {
      if (event.isMainFrame !== true) return;
      // Show prospective destinations immediately; hide only after a committed
      // main-frame navigation confirms the actual Gemini origin.
      closeEditMenu();
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
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", forwardEditShortcut, true);
      unsubscribe();
      detach();
      style.remove();
      delete globalThis.__AGGeminiOrigin;
    },
  };
  adopt();
})();
