/* Optional browser connections. No access from the Gemini guest. */
(() => {
  "use strict";
  const VERSION = "1.2.0";
  if (globalThis.__AGCompanion?.version === VERSION) return;
  globalThis.__AGCompanion?.destroy();
  const i18n = globalThis.__AGPAI18n,
    pending = new Map();
  let browserSignature = "";
  let state = {browser: {connections: []}}, destroyed = false, busy = false,
      error = "", polling = false, browserSection;
  const errorMessages = {
    permission:
      "Permission denied. Check access to the plugin and browser configuration folders.",
    space: "Not enough disk space to save the configuration.",
    config:
      "The MCP configuration is invalid. Fix it in native Antigravity settings, then retry.",
    serverConflict:
      "The browser MCP name belongs to another installation. Resolve the conflict in native MCP settings.",
    hostConflict:
      "A browser host registration already exists for another installation. Review it before continuing.",
    configChanged:
      "The configuration changed during setup. Refresh and try again.",
  };
  const t = (key, values) => i18n.t(key, values);
  function node(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") i18n.set(e, v);
      else e.setAttribute(k, v);
    }
    for (const c of children) e.append(c);
    return e;
  }
  function text(value, className) {
    const e = document.createElement("span");
    e.textContent = value;
    if (className) e.className = className;
    return e;
  }
  function button(label, fn, className = "") {
    const e = node("button", {
      type: "button",
      class: "agpa-comp-button " + className,
      text: label,
    });
    e.addEventListener("click", fn);
    return e;
  }
  function request(action, value = true) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID(),
        timer = setTimeout(() => {
          pending.delete(requestId);
          reject(Error(t("The plugin did not respond. Try again.")));
        }, 20000);
      pending.set(requestId, { resolve, reject, timer });
      try {
        globalThis.__agpaCompanion(
          JSON.stringify({ requestId, action, value }),
        );
      } catch {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(Error(t("The plugin is unavailable.")));
      }
    });
  }
  async function refresh() {
    if (polling || destroyed) return;
    polling = true;
    try {
      accept(await request("status"));
      error = "";
      render();
    } catch (e) {
      error = e.message;
      render();
    } finally {
      polling = false;
    }
  }
  async function act(action, value = true) {
    if (busy) return;
    busy = true;
    error = "";
    render();
    try {
      accept(await request(action, value));
      if (["setupBrowser", "disableBrowser"].includes(action))
        globalThis.__AGNativeMcp
          ?.refresh("antigravity-plugin-browser")
          .catch(() => {});
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      render();
    }
  }
  function accept(next) {state = next;}
  function heading(label, body) {
    return node(
      "div",
      { class: "agpa-comp-heading" },
      node("h3", { text: label }),
      node("p", { text: body }),
    );
  }
  function check(label, passed) {
    return node(
      "li",
      { class: "agpa-comp-check" },
      text(passed ? "✓" : "●", passed ? "passed" : "pending"),
      node("span", { text: label }),
      node("span", {
        class: "agpa-comp-muted",
        text: passed ? "Passed" : "Pending",
      }),
    );
  }
  function renderBrowser() {
    const host = globalThis.__AGSettingsNavigation?.getPage("browser");
    if (!host) return;
    if (!browserSection?.isConnected) {
      browserSection = node("section", {
        "data-agpa-browser-setting": "",
        class: "agpa-comp-section",
      });
      host.append(browserSection);
    }
    if (!globalThis.__AGSettingsNavigation.isOpen("browser")) return;
    const signature = JSON.stringify([
      state.browser,
      busy,
      error,
      i18n.language,
      globalThis.__AGNativeMcp?.status("antigravity-plugin-browser").detected,
    ]);
    if (browserSection.childElementCount && browserSignature === signature)
      return;
    browserSignature = signature;
    const b = state.browser,
      content = [];
    content.push(
      heading(
        "Use your existing browsers",
        "Share tabs from Chrome, Brave, Edge or any Chromium-based browser. Your existing logins stay in the browser.",
      ),
    );
    const actions = node("div", { class: "agpa-comp-actions" });
    actions.append(
      button(
        b.enabled ? "Repair browser connection" : "Set up browser use",
        () => act("setupBrowser"),
        b.enabled ? "" : "primary",
      ),
    );
    if (b.enabled)
      actions.append(
        button("Disable browser access", () => act("disableBrowser"), "danger"),
      );
    actions.append(button("Refresh status", refresh));
    content.push(actions);
    const guide = node(
      "details",
      { class: "agpa-comp-guide" },
      node("summary", { text: "Browser setup guide" }),
    );
    guide.open = !b.connections.length;
    const steps = node("ol", { class: "agpa-comp-steps" });
    for (const key of [
      "Set up the local connection using the button above.",
      "Open your browser’s Extensions page and enable Developer mode.",
      "Choose Load unpacked and select the extension folder below.",
      "Open the extension and choose Selected tabs or All tabs in this profile.",
    ])
      steps.append(node("li", { text: key }));
    guide.append(steps);
    const path = node("input", {
      type: "text",
      readonly: "",
      "aria-label": "Extension folder",
    });
    path.value = b.extensionPath || "";
    const copy = button("Copy folder path", async () => {
      try {
        await navigator.clipboard.writeText(path.value);
        i18n.set(copy, "Copied");
      } catch {
        path.focus();
        path.select();
      }
    });
    guide.append(node("div", { class: "agpa-comp-path" }, path, copy));
    content.push(guide);
    content.push(
      node("p", {
        class: "agpa-comp-muted",
        text: "Shared tabs stay available until you stop sharing, change site, close the browser or disable access. Browser and desktop access are independent.",
      }),
    );
    const checks = node("ul", { class: "agpa-comp-checks" });
    checks.append(
      check("Browser access enabled", b.enabled),
      check("Registered in Antigravity", b.registered),
      check(
        "Server detected by Antigravity",
        globalThis.__AGNativeMcp?.status("antigravity-plugin-browser").detected,
      ),
      check("Browser profile connected", b.connections.length > 0),
      check(
        "At least one tab shared",
        b.connections.some((c) => c.tabs > 0),
      ),
    );
    content.push(checks);
    if (b.connections.length) {
      content.push(node("h3", { text: "Connected profiles" }));
      for (const c of b.connections) {
        const row = node(
          "div",
          { class: "agpa-comp-profile" },
          text(c.label),
          text(t("{count} shared tabs", { count: c.tabs }), "agpa-comp-muted"),
          button("Disconnect", () => act("disconnectProfile", c.id)),
        );
        content.push(row);
      }
    }
    content.push(
      node("p", {
        class: "agpa-comp-muted",
        text: "Available to the native Antigravity agent. The embedded Gemini website does not receive these tools.",
      }),
    );
    if (b.enabled && !b.connections.length)
      content.push(
        node("p", {
          class: "agpa-comp-notice",
          text: "The extension must be loaded in each browser profile you want to connect. Managed browser policies may prevent loading it.",
        }),
      );
    const focused =
      document.activeElement === browserSection.querySelector("input");
    const previousGuide = browserSection.querySelector("details");
    if (previousGuide) guide.open = previousGuide.open;
    browserSection.replaceChildren(...content);
    if (focused) browserSection.querySelector("input")?.focus();
  }
  function render() {
    if (destroyed) return;
    renderBrowser();
    for (const section of [browserSection])
      if (section?.isConnected) {
        section
          .querySelectorAll("[data-agpa-comp-error]")
          .forEach((e) => e.remove());
        if (error)
          section.append(
            node(
              "p",
              { "data-agpa-comp-error": "", class: "agpa-comp-error" },
              text(error),
            ),
          );
        for (const b of section.querySelectorAll(
          "button,select,input[type=checkbox]",
        ))
          b.disabled = busy;
        section.setAttribute("aria-busy", String(busy));
      }
  }
  const style = node("style", { id: "agpa-companion-styles" });
  style.textContent = `
 .agpa-comp-section{display:flex;flex-direction:column;gap:16px;font-size:13px;color:var(--foreground,#ddd)}.agpa-comp-section h3{font-size:14px;font-weight:500;margin:0}.agpa-comp-section p{margin:0;line-height:1.6}.agpa-comp-heading{display:grid;gap:9px}.agpa-comp-heading p,.agpa-comp-muted{color:var(--secondary-foreground,#999)}.agpa-comp-button,.agpa-comp-section select{font:inherit;color:inherit;border:1px solid #383838;background:transparent;border-radius:8px;padding:7px 11px;cursor:pointer}.agpa-comp-button.primary{color:#111;background:#eee;border-color:#eee}.agpa-comp-button.danger{color:#ff9696;border-color:#6b3434}.agpa-comp-button:disabled,.agpa-comp-section select:disabled{opacity:.45;cursor:default}.agpa-comp-button:focus-visible,.agpa-comp-section select:focus-visible{outline:2px solid #3a9cff;outline-offset:2px}.agpa-comp-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.agpa-comp-actions label{display:flex;align-items:center;gap:8px}.agpa-comp-guide{display:grid}.agpa-comp-guide summary{cursor:pointer;padding:5px 0 10px}.agpa-comp-guide[open]>.agpa-comp-path{margin-top:12px}.agpa-comp-steps{margin:0;padding-left:20px;line-height:1.7;list-style:decimal}.agpa-comp-path{display:flex;gap:8px}.agpa-comp-path input{font:12px monospace;min-width:0;flex:1;color:inherit;border:1px solid #363636;border-radius:7px;background:#191919;padding:8px}.agpa-comp-checks{list-style:none;margin:0;padding:0;border:1px solid #292929;border-radius:10px;padding:8px 13px}.agpa-comp-check{display:flex;gap:12px;padding:8px 0}.agpa-comp-check>:last-child{margin-left:auto;font-size:11px}.agpa-comp-section .passed{color:#45cb90}.agpa-comp-section .pending{color:#e8b457}.agpa-comp-profile{display:flex;align-items:center;gap:10px;border:1px solid #303030;border-radius:8px;padding:10px}.agpa-comp-profile button{margin-left:auto}.agpa-comp-notice{border:1px solid #303030;border-radius:9px;padding:12px;line-height:1.6;display:grid;gap:6px}.agpa-comp-error{color:#ff9696}`;
  document.head.append(style);
  function onPage() {
    render();
    refresh();
  }
  window.addEventListener("agpa:settings-page", onPage);
  const unsubscribe = i18n.subscribe(render);
  const timer = setInterval(() => {
    if (!busy) refresh();
  }, 2000);
  globalThis.__AGCompanion = {
    version: VERSION,
    receive(next) {
      if (next && typeof next === "object") {
        accept(next);
        render();
      }
    },
    onResult(id, ok, next) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      ok
        ? p.resolve(next)
        : p.reject(
            Error(
              t(
                errorMessages[next?.error] ||
                  "The request failed. Check the connection and try again.",
              ),
            ),
          );
    },
    status: () => state,
    destroy() {
      destroyed = true;
      clearInterval(timer);
      unsubscribe();
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error("Disconnected."));
      }
      pending.clear();
      browserSection?.remove();
      style.remove();
      window.removeEventListener("agpa:settings-page", onPage);
      delete globalThis.__AGCompanion;
    },
  };
  refresh();
})();
