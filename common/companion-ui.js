/* Browser choice and native consent; automation is provided by Chrome DevTools MCP. */
(() => {
  "use strict";
  const VERSION = "1.8.2";
  if (globalThis.__AGCompanion?.version === VERSION) return;
  globalThis.__AGCompanion?.destroy();
  const i18n = globalThis.__AGPAI18n,
    pending = new Map(),
    createPicker = globalThis.__AGPABrowserPicker,
    icons = globalThis.__AGPA_BROWSER_ICONS__;
  delete globalThis.__AGPABrowserPicker;
  delete globalThis.__AGPA_BROWSER_ICONS__;
  delete globalThis.__AGPABrowserSetupState;
  let state = { browser: {} },
    loaded = false,
    section,
    signature = "",
    busy = false,
    error = "",
    polling = false,
    destroyed = false;
  const messages = {
    permission:
      "Permission denied. Check access to the plugin configuration folder.",
    config:
      "The MCP configuration is invalid. Fix it in native Antigravity settings, then retry.",
    serverConflict:
      "The browser MCP name belongs to another installation. Resolve the conflict in native MCP settings.",
    engine: "Update Antigravity to use its bundled browser tools.",
  };
  function node(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") i18n.set(n, v);
      else n.setAttribute(k, v);
    }
    n.append(...children);
    return n;
  }
  function button(label, click, cls = "") {
    const b = node("button", {
      type: "button",
      class: "agpa-comp-button " + cls,
      text: label,
    });
    b.addEventListener("click", click);
    return b;
  }
  function request(action, value = true) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID(),
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error(i18n.t("The plugin did not respond. Try again.")));
        }, 65000);
      pending.set(id, { resolve, reject, timer });
      try {
        globalThis.__agpaCompanion(
          JSON.stringify({ requestId: id, action, value }),
        );
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(Error(i18n.t("The plugin is unavailable.")));
      }
    });
  }
  function accept(next) {
    const first = !loaded;
    state = next;
    loaded = true;
    if (first && next.browser?.enabled && next.browser?.registered)
      globalThis.__AGNativeMcp
        ?.refresh("antigravity-plugin-browser")
        .catch(() => {});
  }
  async function refresh() {
    if (polling || destroyed) return;
    polling = true;
    try {
      accept(await request("status"));
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
    const previousEngineVersion = state.browser.engineVersion;
    const focus = document.activeElement?.hasAttribute(
      "data-agpa-browser-toggle",
    );
    busy = true;
    error = "";
    render();
    try {
      accept(await request(action, value));
      if (
        ["setupBrowser", "disableBrowser", "selectBrowser"].includes(action) ||
        previousEngineVersion !== state.browser.engineVersion
      )
        await globalThis.__AGNativeMcp
          ?.refresh("antigravity-plugin-browser")
          .catch(() => {});
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      render();
      if (focus) section?.querySelector("[data-agpa-browser-toggle]")?.focus();
    }
  }
  function render() {
    if (destroyed) return;
    const host = globalThis.__AGSettingsNavigation?.getPage("browser");
    if (!host) return;
    if (!section?.isConnected) {
      section = node("section", {
        class: "agpa-comp-section",
        "data-agpa-browser-setting": "",
      });
      host.append(section);
      signature = "";
    }
    if (!globalThis.__AGSettingsNavigation.isOpen("browser")) return;
    const b = state.browser,
      key = JSON.stringify([b, busy, error, loaded, i18n.language]);
    if (signature === key) return;
    signature = key;
    const pickerWasOpen =
      section
        .querySelector("[data-agpa-browser-trigger]")
        ?.getAttribute("aria-expanded") === "true";
    // Polling never destroys an open keyboard/pointer menu.
    if (pickerWasOpen && !busy) {
      signature = "";
      return;
    }
    const toggle = button(
      busy ? "Saving…" : b.enabled ? "Enabled" : "Disabled",
      () => act(b.enabled ? "disableBrowser" : "setupBrowser"),
      "agpa-comp-enable-switch",
    );
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(!!b.enabled));
    toggle.setAttribute("aria-label", i18n.t("Browser use"));
    toggle.setAttribute("data-agpa-browser-toggle", "");
    toggle.append(
      node(
        "span",
        { class: "agpa-comp-switch-track", "aria-hidden": "true" },
        node("span", { class: "agpa-comp-switch-thumb" }),
      ),
    );
    const content = [
      node(
        "div",
        { class: "agpa-comp-enable-row", "data-agpa-browser-activation": "" },
        node("span", {
          class: "agpa-comp-enable-status",
          "data-on": String(!!b.enabled),
          text: b.enabled
            ? "Browser use is enabled"
            : "Browser use is disabled",
        }),
        toggle,
      ),
    ];
    if (loaded && b.enabled) {
      const available = b.available || [];
      if (available.length) {
        const picker = createPicker({
          items: available,
          value: b.selectedBrowser,
          icons,
          label: i18n.t("Your browser"),
          onChange: (id) => act("selectBrowser", id),
        });
        content.push(
          node(
            "div",
            { class: "agpa-comp-browser-choice" },
            node("span", { text: "Your browser" }),
            picker,
          ),
        );
      }
      if (!b.engineAvailable)
        content.push(
          node("p", {
            class: "agpa-comp-notice",
            text: "Update Antigravity to use its bundled browser tools.",
          }),
        );
      else if (!available.length)
        content.push(
          node("p", {
            class: "agpa-comp-notice",
            text: "Install a Chromium-based browser, then reopen these settings.",
          }),
        );
      else {
        const label = b.connected
          ? b.active === false
            ? "Ready when needed"
            : "Connected"
          : b.connecting
            ? "Connecting to your browser…"
            : "Browser permission";
        const description = b.connected
          ? b.active === false
            ? "Browser control has been released. Antigravity reconnects when you use a browser tool; your browser may ask you to approve again."
            : "Antigravity is connected. Control is released after the task or after one minute without browser operations."
          : b.connecting
            ? "Approve the connection prompts in all browser windows, profiles and installed web apps (PWAs). The first connection may take longer while existing tabs are prepared."
            : b.error === "browserPermission"
              ? "Could not finish connecting. Check the browser permission prompt, then try again."
              : "Open your browser’s remote-debugging page, turn on Allow remote debugging, and approve the browser’s connection prompt. This page updates automatically.";
        content.push(
          node(
            "div",
            {
              class: "agpa-comp-connection",
              role: "status",
              "data-agpa-browser-connection": b.connected
                ? "ready"
                : b.connecting
                  ? "connecting"
                  : "permission",
            },
            node("span", {
              "aria-hidden": "true",
              class: b.connected
                ? "passed"
                : b.connecting
                  ? "agpa-comp-spinner"
                  : "pending",
              text: b.connected ? "✓" : b.connecting ? "" : "●",
            }),
            node(
              "div",
              {},
              node("strong", { text: label }),
              node("p", { class: "agpa-comp-muted", text: description }),
            ),
          ),
        );
        if (!b.connected)
          content.push(
            button(
              b.connecting ? "Connecting…" : "Connect browser",
              () => act("connectBrowser"),
              "primary",
            ),
          );
        if (b.connected)
          content.push(
            node("p", {
              class: "agpa-comp-muted",
              text: "Ask Antigravity: Use my connected browser to compare two open pages and summarize their differences.",
            }),
          );
      }
    }
    if (!loaded)
      content.push(node("p", { class: "agpa-comp-muted", text: "Checking…" }));
    if (error)
      content.push(
        node(
          "p",
          {
            class: "agpa-comp-error",
            "data-agpa-comp-error": "",
            role: "alert",
          },
          document.createTextNode(error),
        ),
      );
    section.replaceChildren(...content);
    for (const n of section.querySelectorAll("button"))
      n.disabled =
        busy || !loaded || (b.connecting && n.classList.contains("primary"));
  }
  const style = node("style", { text: "" });
  style.textContent = `
 .agpa-comp-section{display:flex;flex-direction:column;gap:22px;font-size:13px;color:var(--foreground,#ddd)}.agpa-comp-section p{margin:0;line-height:1.65}.agpa-comp-muted{color:var(--secondary-foreground,#999)}.agpa-comp-button{font:inherit;color:inherit;border:1px solid var(--border,#383838);background:transparent;border-radius:8px;padding:8px 13px;cursor:pointer;align-self:flex-start}.agpa-comp-button.primary{color:#111;background:#eee;border-color:#eee}.agpa-comp-button:disabled{opacity:.5;cursor:default}.agpa-comp-button:focus-visible{outline:2px solid #3a9cff;outline-offset:2px}.agpa-comp-enable-row{display:flex;align-items:center;justify-content:space-between;gap:20px}.agpa-comp-enable-status{display:flex;align-items:center;gap:10px}.agpa-comp-enable-status:before{content:'';width:8px;height:8px;background:#777;border-radius:50%}.agpa-comp-enable-status[data-on=true]:before{background:#54ca92}.agpa-comp-enable-switch{display:flex;align-items:center;gap:12px;border:0;padding:0;align-self:auto}.agpa-comp-switch-track{display:block;width:34px;height:20px;background:#555;border-radius:12px;padding:3px;box-sizing:border-box}.agpa-comp-switch-thumb{display:block;width:14px;height:14px;border-radius:50%;background:white;transition:transform .15s}.agpa-comp-enable-switch[aria-checked=true] .agpa-comp-switch-track{background:#368cdb}.agpa-comp-enable-switch[aria-checked=true] .agpa-comp-switch-thumb{transform:translateX(14px)}.agpa-comp-browser-choice{display:flex;align-items:center;justify-content:space-between;gap:18px}.agpa-comp-connection{display:flex;align-items:flex-start;gap:12px}.agpa-comp-connection>span{margin-top:3px;flex-shrink:0}.agpa-comp-connection>div{display:grid;gap:8px}.agpa-comp-connection strong{font-weight:500}.passed{color:#54ca92}.pending{color:#e8b457}.agpa-comp-notice{border:1px solid var(--border,#333);border-radius:9px;padding:14px}.agpa-comp-error{color:#ff9696}.agpa-comp-spinner{width:12px;height:12px;border:2px solid #8884;border-top-color:#6eafff;border-radius:50%;animation:agpa-browser-spin .8s linear infinite}@keyframes agpa-browser-spin{to{transform:rotate(360deg)}}
 .agpa-browser-picker{margin-left:auto}.agpa-browser-trigger{display:flex;align-items:center;gap:10px;min-width:210px;text-align:left;background:var(--background,#171717)}.agpa-browser-arrow{margin-left:auto}.agpa-browser-icon{display:inline-block;width:20px;height:20px;object-fit:contain;flex-shrink:0;text-align:center;line-height:20px}.agpa-browser-popup{box-sizing:border-box;position:fixed;inset:auto;margin:0;padding:5px;overflow:auto;border:1px solid var(--border,#444);border-radius:9px;background:var(--background,#171717);color:var(--foreground,#ddd);font-family:inherit;font-size:13px;box-shadow:0 8px 24px #0006}.agpa-browser-option{display:flex;align-items:center;gap:10px;min-height:36px;padding:0 9px;border-radius:5px;cursor:pointer;font:inherit}.agpa-browser-option:hover,.agpa-browser-option[data-active]{background:var(--secondary,#303030)}.agpa-browser-check{margin-left:auto;font-size:12px}
 `;
  document.head.append(style);
  const unsubscribe = i18n.subscribe(render),
    onPage = () => {
      render();
      refresh();
    };
  window.addEventListener("agpa:settings-page", onPage);
  const timer = setInterval(() => {
    if (
      !busy &&
      !document.hidden &&
      globalThis.__AGSettingsNavigation?.isOpen("browser")
    )
      refresh();
  }, 2000);
  globalThis.__AGCompanion = {
    version: VERSION,
    receive(next) {
      accept(next);
      render();
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
              i18n.t(
                messages[next?.error] ||
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
      section?.remove();
      style.remove();
      window.removeEventListener("agpa:settings-page", onPage);
      delete globalThis.__AGCompanion;
    },
  };
  refresh();
})();
