/* Same-window Gemini guest. The native Antigravity page stays mounted. */
(() => {
  "use strict";
  const VERSION = "1.2.0";
  const i18n = globalThis.__AGPAI18n;
  const icons = globalThis.__AGPA_SWITCH_ASSETS__;
  const css = globalThis.__AGPA_GEMINI_CSS__;
  delete globalThis.__AGPA_GEMINI_CSS__;
  delete globalThis.__AGPA_SWITCH_ASSETS__;
  if (globalThis.__AGGeminiSwitch?.version === VERSION) return;
  globalThis.__AGGeminiSwitch?.destroy();
  if (!icons?.gemini || !icons?.antigravity) return;
  const GEMINI = "https://gemini.google.com/";
  const PARTITION = "persist:agpa-gemini";
  let destroyed = false,
    button = null,
    dialog = null,
    guest = null,
    ready = false,
    opener = null,
    lastURL = GEMINI,
    lastError = null;
  let statusText = null,
    originText = null,
    back = null,
    forward = null,
    reload = null;
  const listeners = [];
  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c) n.append(c);
    i18n.attrs(n, attrs);
    return n;
  }
  function icon(name) {
    return el("img", {
      src: icons[name],
      alt: "",
      width: "20",
      height: "20",
      draggable: "false",
    });
  }
  function listen(node, event, fn) {
    node.addEventListener(event, fn);
    listeners.push(() => node.removeEventListener(event, fn));
  }
  const styles = el("style", { id: "agpa-gemini-styles", text: css });
  document.head.append(styles);
  function applyButton() {
    if (destroyed) return;
    const anchor = document.querySelector(
      '[data-testid="titlebar-more-actions"]',
    );
    const toolbar = document.querySelector(
      '[data-testid="pane-titlebar-toolbar"]',
    );
    if (!anchor && !toolbar) return;
    if (!button) {
      button = el(
        "button",
        {
          type: "button",
          class: "agpa-app-switch",
          "data-agpa-open-gemini": "",
          "aria-label": "Open Gemini in this window",
          title: "Gemini",
        },
        icon("gemini"),
        el("span", { text: "Gemini" }),
      );
      listen(button, "click", open);
    }
    if (anchor) {
      if (button.parentElement !== anchor.parentElement) anchor.before(button);
    } else {
      const host =
        toolbar.querySelector(":scope > .flex.items-center.gap-1") || toolbar;
      if (button.parentElement !== host) host.append(button);
    }
  }
  function update() {
    if (!guest || !ready) return;
    try {
      lastURL = guest.getURL() || GEMINI;
      const u = new URL(lastURL);
      originText.textContent = ["https:", "http:"].includes(u.protocol)
        ? u.origin
        : i18n.t("Origin unavailable");
      originText.title = u.origin;
      back.disabled = !guest.canGoBack();
      forward.disabled = !guest.canGoForward();
    } catch {}
  }
  function hide() {
    if (!dialog?.open) return;
    dialog.close();
    // Do not remove the guest: its page, draft, and session survive switching.
    if (opener?.isConnected) opener.focus();
    else button?.focus();
  }
  function create() {
    dialog = el("dialog", {
      class: "agpa-gemini",
      "aria-label": "Gemini web",
      "data-agpa-gemini": "",
    });
    const bar = el("div", { class: "agpa-gemini-bar" });
    back = el("button", {
      type: "button",
      class: "agpa-gemini-tool",
      "aria-label": "Back",
      title: "Back",
      text: "‹",
      disabled: "",
    });
    forward = el("button", {
      type: "button",
      class: "agpa-gemini-tool",
      "aria-label": "Forward",
      title: "Forward",
      text: "›",
      disabled: "",
    });
    reload = el("button", {
      type: "button",
      class: "agpa-gemini-tool",
      "aria-label": "Reload Gemini",
      title: "Reload",
      text: "↻",
    });
    originText = el("span", {
      class: "agpa-gemini-origin",
      text: "gemini.google.com",
    });
    statusText = el("span", {
      class: "agpa-gemini-state",
      role: "status",
      "aria-live": "polite",
      text: "Loading…",
    });
    const external = el("button", {
      type: "button",
      class: "agpa-gemini-tool",
      "aria-label": "Open Gemini in external browser",
      title: "Open Gemini in browser",
      text: "↗",
    });
    const returnButton = el(
      "button",
      {
        type: "button",
        class: "agpa-app-switch",
        "data-agpa-return-antigravity": "",
        "aria-label": "Return to Antigravity",
        title: "Return to Antigravity",
      },
      icon("antigravity"),
      el("span", { text: "Antigravity" }),
    );
    bar.append(
      back,
      forward,
      reload,
      originText,
      statusText,
      external,
      returnButton,
    );
    guest = el("webview", {
      partition: PARTITION,
      webpreferences:
        "nodeIntegration=no,contextIsolation=yes,sandbox=yes,webSecurity=yes,allowRunningInsecureContent=no",
      "aria-label": "Google Gemini website",
    });
    // No preload, Node integration, popups, browser profile import, or page injection.
    listen(guest, "dom-ready", () => {
      ready = true;
      lastError = null;
      update();
    });
    listen(guest, "did-start-loading", () => {
      i18n.set(statusText, "Loading…");
    });
    listen(guest, "did-stop-loading", () => {
      if (!lastError) i18n.set(statusText, "");
      update();
    });
    listen(guest, "did-navigate", update);
    listen(guest, "did-navigate-in-page", update);
    listen(guest, "did-fail-load", (event) => {
      if (!event.isMainFrame || event.errorCode === -3) return;
      lastError = `Could not load Gemini (${event.errorCode}). Try Reload or open in browser.`;
      i18n.set(
        statusText,
        "Could not load Gemini ({code}). Try Reload or open in browser.",
        { code: event.errorCode },
      );
    });
    listen(guest, "render-process-gone", () => {
      ready = false;
      i18n.set(
        statusText,
        "Gemini stopped. Return to Antigravity and reopen Gemini.",
      );
      guest.remove();
      guest = null;
    });
    // Guest will-navigate is informational: preventDefault cannot cancel it.
    // The separate host-owned identity controller labels every foreign origin.
    listen(back, "click", () => {
      if (ready && guest?.canGoBack()) guest.goBack();
    });
    listen(forward, "click", () => {
      if (ready && guest?.canGoForward()) guest.goForward();
    });
    listen(reload, "click", () => {
      if (guest) {
        lastError = null;
        guest.reload();
      }
    });
    listen(external, "click", () =>
      globalThis.electronNative?.openExternal(GEMINI),
    );
    listen(returnButton, "click", hide);
    listen(dialog, "cancel", (e) => {
      e.preventDefault();
      hide();
    });
    dialog.append(bar, guest);
    document.body.append(dialog);
    guest.src = GEMINI;
  }
  function open() {
    if (destroyed) return;
    opener = document.activeElement;
    if (!dialog || !guest) {
      dialog?.remove();
      create();
    }
    if (!dialog.open) dialog.showModal();
    update();
  }
  const observer = new MutationObserver(applyButton);
  observer.observe(document.body, { subtree: true, childList: true });
  globalThis.__AGGeminiSwitch = {
    version: VERSION,
    status() {
      return {
        version: VERSION,
        buttonInstalled: !!button?.isConnected,
        visible: !!dialog?.open,
        guestCreated: !!guest,
        ready,
        origin: (() => {
          try {
            return new URL(lastURL).origin;
          } catch {
            return null;
          }
        })(),
        partition: PARTITION,
        error: lastError,
      };
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      for (const remove of listeners) remove();
      hide();
      dialog?.remove();
      button?.remove();
      styles.remove();
      delete globalThis.__AGGeminiSwitch;
    },
  };
  applyButton();
})();
