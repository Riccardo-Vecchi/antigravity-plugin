/* Updates belong to the plugin, independently of Antigravity's updater. */
(() => {
  "use strict";
  const VERSION = "1.0.0";
  if (globalThis.__AGPluginUpdates?.version === VERSION) return;
  globalThis.__AGPluginUpdates?.destroy();
  const i = globalThis.__AGPAI18n,
    pending = new Map();
  let section,
    state = {},
    busy = false,
    stopped = false,
    queued = false;
  const errors = {
    network: "Could not reach GitHub. Check your connection and try again.",
    rateLimited: "GitHub temporarily limited update checks. Try again later.",
    invalidUpdate:
      "The update could not be verified. No installed files were changed.",
    installFailed:
      "The update failed. The previous files were restored when possible.",
    localChanges:
      "Local plugin files were changed. Automatic installation is paused.",
    busy: "Close project editors and finish Computer use setup before updating.",
    unsupported: "Automatic updates support Linux x86-64 and Windows x64.",
  };
  function node(tag, key, attrs = {}) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (key) i.set(e, key);
    return e;
  }
  function paint() {
    if (!section) return;
    i.set(section.querySelector("[data-pu-current]"), "Installed: {version}", {
      version: state.current || "…",
    });
    i.set(
      section.querySelector("[data-pu-latest]"),
      state.latest ? "Latest release: {version}" : "",
      { version: state.latest },
    );
    const summary = state.installing
      ? "Installing plugin update…"
      : state.checking || busy
        ? "Checking for plugin updates…"
        : state.error
          ? errors[state.error] || errors.installFailed
          : state.result?.phase === "error"
            ? errors[state.result.error] || errors.installFailed
            : state.paused === "preview"
              ? "Local preview: automatic installation is paused to preserve unpublished changes."
              : state.paused === "source"
                ? "Run the platform installer to enable automatic updates."
                : state.paused === "localChanges"
                  ? errors.localChanges
                  : state.available
                    ? "A plugin update is available."
                    : state.lastChecked
                      ? "Your plugin is up to date."
                      : "Updates have not been checked yet.";
    i.set(section.querySelector("[data-pu-summary]"), summary);
    i.set(
      section.querySelector("[data-pu-checked]"),
      state.lastChecked ? "Last checked: {time}" : "",
      {
        time: () =>
          new Intl.DateTimeFormat(i.language, {
            dateStyle: "short",
            timeStyle: "medium",
          }).format(new Date(state.lastChecked)),
      },
    );
    const input = section.querySelector("input");
    input.checked = state.automatic !== false;
    input.disabled = busy || state.installing;
    const check = section.querySelector("[data-pu-check]");
    check.disabled = busy || state.checking || state.installing;
    check
      .querySelector("span")
      .classList.toggle("agpa-pu-spin", !!(busy || state.checking || state.installing));
    const install = section.querySelector("[data-pu-install]");
    install.hidden = !state.available || !!state.paused;
    install.disabled = busy || state.installing;
    section.setAttribute("aria-busy", String(!!(busy || state.installing)));
  }
  function request(action, value = true) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID(),
        timer = setTimeout(() => {
          pending.delete(requestId);
          reject(Error("timeout"));
        }, 75000);
      pending.set(requestId, { resolve, reject, timer });
      try {
        globalThis.__agpaPluginUpdate(
          JSON.stringify({ requestId, action, value }),
        );
      } catch {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(Error("unavailable"));
      }
    });
  }
  async function act(action, value = true) {
    if (busy) return;
    busy = true;
    paint();
    try {
      state = await request(action, value);
    } catch {
      state = { ...state, error: "installFailed" };
    } finally {
      busy = false;
      paint();
    }
  }
  async function refresh() {
    if (busy || stopped) return;
    try {
      state = await request("status");
      paint();
    } catch {}
  }
  function mount() {
    if (stopped) return;
    const nav = document.querySelector("[data-testid=settings-nav-item-App]"),
      heading = [...document.querySelectorAll("[role=dialog] h2")].find(
        (h) => h.textContent.trim() === nav?.textContent.trim(),
      ),
      host = heading?.closest("div.p-6");
    if (!host) return;
    if (!section) {
      section = node("section", null, {
        "data-agpa-plugin-updates": "",
        class: "agpa-plugin-update-section",
      });
      const label = node("label", null, { class: "agpa-pu-toggle" }),
        input = node("input", null, { type: "checkbox" });
      input.addEventListener("change", () => act("automatic", input.checked));
      label.append(input, node("span", "Automatically install plugin updates"));
      const check = node("button", null, {
          type: "button",
          "data-pu-check": "",
        }),
        spin = node("span", null, { "aria-hidden": "true" });
      spin.textContent = "↻";
      check.append(spin, node("span", "Check for updates"));
      check.onclick = () => act("check");
      const install = node("button", "Install update", {
        type: "button",
        "data-pu-install": "",
      });
      install.onclick = () => act("install");
      const actions = node("div", null, { class: "agpa-pu-actions" });
      actions.append(check, install);
      section.append(
        node("h3", "Plugin updates"),
        node("p", null, { "data-pu-current": "" }),
        node("p", null, { "data-pu-latest": "" }),
        label,
        node(
          "p",
          "Checks every six hours. Updates preserve your settings and open pages.",
        ),
        actions,
        node("p", null, {
          "data-pu-summary": "",
          role: "status",
          "aria-live": "polite",
        }),
        node("p", null, { "data-pu-checked": "" }),
      );
      refresh();
    }
    if (section.parentElement !== host) host.append(section);
    paint();
  }
  const style = node("style");
  style.textContent =
    ".agpa-plugin-update-section{display:flex;flex-direction:column;gap:12px;border:1px solid var(--border,#353535);border-radius:12px;padding:15px;margin-top:18px;font-size:13px;color:var(--foreground,#eee)}.agpa-plugin-update-section h3{font-size:14px;font-weight:500;margin:0}.agpa-plugin-update-section p{font-size:12px;line-height:1.6;color:var(--muted-foreground,#aaa);margin:0}.agpa-pu-toggle,.agpa-pu-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.agpa-pu-actions button{display:flex;gap:6px;align-items:center;background:transparent;color:inherit;font:inherit;border:1px solid #444;border-radius:8px;padding:8px 12px;cursor:pointer}.agpa-pu-actions button[hidden]{display:none}.agpa-pu-actions button:disabled{opacity:.5;cursor:wait}.agpa-pu-spin{display:inline-block;animation:agpa-plugin-update-spin 1s linear infinite}@keyframes agpa-plugin-update-spin{to{transform:rotate(360deg)}}";
  document.head.append(style);
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      mount();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const interval = setInterval(() => {
    if (section?.getClientRects().length) refresh();
  }, 1500);
  const unsubscribe = i.subscribe(paint);
  globalThis.__AGPluginUpdates = {
    version: VERSION,
    onResult(id, ok, next) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      ok ? p.resolve(next) : p.reject(Error("failed"));
    },
    status: () => state,
    destroy() {
      stopped = true;
      observer.disconnect();
      clearInterval(interval);
      unsubscribe();
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error("closed"));
      }
      pending.clear();
      section?.remove();
      style.remove();
      delete globalThis.__AGPluginUpdates;
    },
  };
  mount();
})();
