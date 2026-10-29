/* Branding, title and optional hover sidebar. Native documents stay mounted. */
(() => {
  "use strict";
  const VERSION = "1.1.0";
  globalThis.__AGWorkspace?.destroy();
  const i18n = globalThis.__AGPAI18n,
    icon = globalThis.__AGPA_BRAND_ICON__,
    initial = globalThis.__AGPA_WORKSPACE__;
  delete globalThis.__AGPA_BRAND_ICON__;
  delete globalThis.__AGPA_WORKSPACE__;
  let preferences = initial || { sidebarMode: null },
    stopped = false,
    queued = false,
    section = null,
    peek = false,
    panel = null,
    menuTitle = null,
    lastExpanded = null,
    nativeTitle = document.title;
  const listeners = [],
    marks = new Set(),
    pending = new Map();
  const style = document.createElement("style");
  style.id = "agpa-workspace-styles";
  style.textContent = `
 [data-agpa-brand]>svg{display:none!important}[data-agpa-brand]>img{width:24px;height:24px;object-fit:contain;pointer-events:none}
 @property --agpa-navigation-width{syntax:'<length>';inherits:true;initial-value:52px}
 @property --agpa-rail-width{syntax:'<length>';inherits:true;initial-value:52px}
 body[data-agpa-layout-ready]{transition:--agpa-navigation-width 240ms cubic-bezier(.22,1,.36,1),--agpa-rail-width 240ms cubic-bezier(.22,1,.36,1)}
 body[data-agpa-layout-ready] [data-agpa-sidebar-panel]:not([data-agpa-hover-pane]){width:calc(var(--agpa-navigation-width) - var(--agpa-rail-width))!important;transition:visibility 0s linear 240ms!important}
 body[data-agpa-layout-ready] .agpa-rail{width:var(--agpa-rail-width)!important;transition:opacity 160ms ease,visibility 0s linear 160ms!important}
 [data-agpa-sidebar-panel][data-agpa-hover-pane]{position:absolute!important;left:0!important;top:0!important;height:100%!important;width:var(--agpa-expanded-width,256px)!important;visibility:hidden!important;overflow:hidden!important;z-index:60!important;box-shadow:12px 0 32px #0005;background:var(--sidebar,#171717);transform:translateX(-100%);opacity:0;pointer-events:none;will-change:transform;transition:transform 240ms cubic-bezier(.22,1,.36,1),opacity 140ms ease,visibility 0s linear 240ms!important}
 [data-agpa-sidebar-panel][data-agpa-hover-pane][data-agpa-peek]{transform:translateX(0);opacity:1;visibility:visible!important;pointer-events:auto;transition:transform 240ms cubic-bezier(.22,1,.36,1),opacity 140ms ease,visibility 0s!important}
 .agpa-sidebar-setting{margin-top:18px;padding:16px;border:1px solid var(--border,#353535);border-radius:12px;color:var(--foreground,#eee)}
 .agpa-sidebar-setting h3{font-size:14px;font-weight:500;margin:0 0 8px}.agpa-sidebar-setting p{font-size:12px;color:var(--muted-foreground,#aaa);margin:0 0 12px}
 .agpa-sidebar-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.agpa-sidebar-choices button{font:inherit;font-size:13px;padding:10px 8px;border:1px solid var(--border,#444);border-radius:9px;color:inherit;background:transparent;cursor:pointer}.agpa-sidebar-choices button[aria-checked=true]{border-color:#398bdb;background:var(--secondary,#292929)}.agpa-sidebar-choices button:focus-visible{outline:2px solid #398bdb;outline-offset:2px}
 `;
  document.head.append(style);
  const on = (n, e, f, o) => {
    n.addEventListener(e, f, o);
    listeners.push(() => n.removeEventListener(e, f, o));
  };
  const text = (tag, key) => {
    const n = document.createElement(tag);
    i18n.set(n, key);
    return n;
  };
  const toggle = () => globalThis.__AGPAPrimaryLayout(document).toggle;
  const currentPanel = () => globalThis.__AGPAPrimaryLayout(document).panel;
  const gemini = () => !!document.querySelector("[data-agpa-gemini][open]");
  function title() {
    if (gemini()) {
      if (document.title !== "Google Gemini") {
        nativeTitle = document.title;
        document.title = "Google Gemini";
      }
    } else if (document.title === "Google Gemini")
      document.title = nativeTitle || "Antigravity";
    else nativeTitle = document.title;
  }
  function commitMotion() {
    queueMicrotask(() => {
      if (!stopped)
        globalThis.__AGPAStartSidebarMotion(
          [document.body, panel, document.querySelector("[data-agpa-rail]")],
          document.timeline,
        );
    });
  }
  function removePeek() {
    if (panel?.hasAttribute("data-agpa-peek")) {
      panel.removeAttribute("data-agpa-peek");
      commitMotion();
    }
    peek = false;
  }
  const intent = globalThis.__AGPACreateHoverIntent({
    open: show,
    close: removePeek,
    canClose: () =>
      !document.querySelector(
        "[role=menu][data-open], [popover]:popover-open",
      ) &&
      !panel?.querySelector(
        "input:focus, textarea:focus, [contenteditable=true]:focus",
      ),
  });
  function hide() {
    intent.hide();
  }
  function show() {
    if (
      stopped ||
      preferences.sidebarMode !== "hover" ||
      gemini() ||
      document.querySelector("dialog[open],[role=dialog]") ||
      toggle()?.getAttribute("aria-expanded") !== "false"
    )
      return false;
    panel = currentPanel();
    if (!panel?.hasAttribute("data-agpa-hover-pane")) return false;
    panel.setAttribute("data-agpa-peek", "");
    commitMotion();
    peek = true;
    return true;
  }
  function move(event) {
    if (preferences.sidebarMode !== "hover" || gemini()) {
      hide();
      return;
    }
    const rail = document.querySelector("[data-agpa-rail]"),
      rect = rail?.getBoundingClientRect();
    if (!rect || !rect.height) return;
    const width = peek
      ? panel?.getBoundingClientRect().right || 256
      : Math.max(14, rect.right);
    if (
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom &&
      event.clientX <= width
    )
      intent.enter();
    else intent.leave();
  }
  function preparePanel() {
    const next = toggle() ? currentPanel() : null;
    if (next !== panel) {
      hide();
      if (panel) {
        panel.removeAttribute("data-agpa-sidebar-panel");
        panel.removeAttribute("data-agpa-hover-pane");
        panel.style.removeProperty("--agpa-expanded-width");
      }
      panel = next;
    }
    if (!panel) return;
    panel.setAttribute("data-agpa-sidebar-panel", "");
    const hover = preferences.sidebarMode === "hover";
    if (panel.hasAttribute("data-agpa-hover-pane") !== hover) {
      hide();
      panel.toggleAttribute("data-agpa-hover-pane", hover);
    }
    if (hover) {
      const width =
        panel.firstElementChild?.getBoundingClientRect().width || 256;
      const value = Math.min(456, Math.max(256, width)) + "px";
      if (panel.style.getPropertyValue("--agpa-expanded-width") !== value)
        panel.style.setProperty("--agpa-expanded-width", value);
    }
  }
  function paint() {
    const enabled = section?.querySelector("[data-agpa-library-enabled]");
    if (enabled) enabled.checked = preferences.libraryEnabled !== false;
    const mode =
      preferences.sidebarMode ||
      (toggle()?.getAttribute("aria-expanded") === "false"
        ? "compact"
        : "open");
    for (const b of section?.querySelectorAll("[data-agpa-sidebar-mode]") || [])
      b.setAttribute(
        "aria-checked",
        String(b.dataset.agpaSidebarMode === mode),
      );
  }
  async function choose(mode, action = "sidebar") {
    if (action === "sidebar") hide();
    const control = section?.querySelector("[data-agpa-library-enabled]");
    if (control && action === "libraryEnabled") control.disabled = true;
    try {
      await new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID(),
          timer = setTimeout(() => {
            pending.delete(requestId);
            reject(Error());
          }, 8000);
        pending.set(requestId, { resolve, reject, timer });
        globalThis.__agpaLibrary(
          JSON.stringify({ requestId, action, value: mode }),
        );
      });
    } catch {
      const s = section?.querySelector("[role=status]");
      if (s) i18n.set(s, "Could not save. Try again.");
      paint();
    } finally {
      if (control) control.disabled = false;
    }
  }
  function apply() {
    if (stopped) return;
    title();
    if (gemini()) hide();
    const brand = document.querySelector(
      "[data-testid=app-icon-new-conversation-button]",
    );
    if (brand && !brand.querySelector("[data-agpa-brand-image]")) {
      brand.setAttribute("data-agpa-brand", "");
      marks.add(brand);
      const image = document.createElement("img");
      image.src = icon;
      image.alt = "";
      image.draggable = false;
      image.dataset.agpaBrandImage = "";
      brand.append(image);
    }
    preparePanel();
    const expanded = toggle()?.getAttribute("aria-expanded");
    if (panel && typeof expanded === "string") {
      const width =
        panel.firstElementChild?.getBoundingClientRect().width || 256;
      const navigation =
          expanded === "true"
            ? Math.max(256, Math.min(456, width)) + "px"
            : "52px",
        rail = expanded === "true" ? "0px" : "52px";
      const changed =
        document.body.style.getPropertyValue("--agpa-navigation-width") !==
          navigation ||
        document.body.style.getPropertyValue("--agpa-rail-width") !== rail;
      if (changed) {
        document.body.style.setProperty("--agpa-navigation-width", navigation);
        document.body.style.setProperty("--agpa-rail-width", rail);
      }
      if (!document.body.hasAttribute("data-agpa-layout-ready")) {
        panel.getBoundingClientRect();
        document.body.setAttribute("data-agpa-layout-ready", "");
      }
      if (changed || expanded !== lastExpanded) {
        lastExpanded = expanded;
        commitMotion();
      }
    }
    const bar = document.querySelector("[data-testid=title-menu-bar]");
    if (bar) {
      if (!menuTitle) {
        menuTitle = text("span", "Google Gemini");
        menuTitle.setAttribute("data-agpa-gemini-menu-title", "");
      }
      if (menuTitle.parentElement !== bar) bar.append(menuTitle);
    }
    const nav = document.querySelector(
        "[data-testid=settings-nav-item-Appearance]",
      ),
      label = nav?.textContent.trim();
    const host = [...document.querySelectorAll("[role=dialog] h2")]
      .find((n) => n.textContent.trim() === label)
      ?.closest("div.p-6");
    if (host) {
      if (!section) {
        section = document.createElement("section");
        section.className = "agpa-sidebar-setting";
        section.dataset.agpaSidebarSetting = "";
        const group = document.createElement("div");
        group.className = "agpa-sidebar-choices";
        group.setAttribute("role", "radiogroup");
        i18n.set(group, "Sidebar", {}, "aria-label");
        for (const [mode, key] of [
          ["open", "Expanded"],
          ["compact", "Compact"],
          ["hover", "Expand on hover"],
        ]) {
          const b = text("button", key);
          b.type = "button";
          b.dataset.agpaSidebarMode = mode;
          b.setAttribute("role", "radio");
          on(b, "click", () => choose(mode));
          on(b, "keydown", (event) => {
            const modes = ["open", "compact", "hover"];
            if (
              ![
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
              ].includes(event.key)
            )
              return;
            event.preventDefault();
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? 2
                  : (modes.indexOf(mode) +
                      (["ArrowLeft", "ArrowUp"].includes(event.key) ? 2 : 1)) %
                    3;
            const other = group.querySelector(
              `[data-agpa-sidebar-mode="${modes[index]}"]`,
            );
            other.focus();
            other.click();
          });
          group.append(b);
        }
        section.append(
          text("h3", "Sidebar"),
          text(
            "p",
            "Keep it expanded, show only icons, or reveal it when the pointer reaches the left edge.",
          ),
          group,
          text("p", ""),
        );
        section.lastChild.setAttribute("role", "status");
        const label = document.createElement("label");
        label.style.cssText =
          "display:flex;gap:9px;align-items:center;margin-top:14px;font-size:13px;cursor:pointer";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("data-agpa-library-enabled", "");
        input.style.accentColor = "#398bdb";
        on(input, "change", () =>
          choose(input.checked, "libraryEnabled"),
        );
        label.append(input, text("span", "Enable Library"));
        const libraryHeading = text("h3", "Library");
        libraryHeading.style.cssText = "margin-top:20px;border-top:1px solid var(--border,#353535);padding-top:16px";
        section.insertBefore(libraryHeading, section.lastChild);
        label.style.marginTop = "8px";
        section.insertBefore(label, section.lastChild);
        section.insertBefore(text("p", "Show generated files and uploads. Disabling keeps your favorites and added files."), section.lastChild);
      }
      if (section.parentElement !== host) host.append(section);
      paint();
    }
  }
  function setPreferences(next) {
    preferences = next;
    hide();
    preparePanel();
    const t = toggle(),
      wanted = next.sidebarMode === "open";
    if (
      t &&
      next.sidebarMode !== null &&
      (t.getAttribute("aria-expanded") === "true") !== wanted
    )
      t.click();
    paint();
  }
  const schedule = () => {
    if (stopped || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      apply();
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["open", "aria-expanded"],
  });
  const titleObserver = new MutationObserver(title);
  titleObserver.observe(document.head, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  on(document, "pointermove", move, { passive: true });
  on(window, "blur", hide);
  on(window, "resize", hide);
  on(document, "keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  on(document, "pointerdown", (e) => {
    if (peek && !panel?.contains(e.target) && !e.target.closest("[role=menu]"))
      hide();
  });
  on(document, "click", (e) => {
    if (
      e.target.closest("[data-testid=sidebar-toggle]") === toggle() &&
      e.isTrusted
    )
      queueMicrotask(() =>
        choose(
          toggle()?.getAttribute("aria-expanded") === "true"
            ? "open"
            : "compact",
        ),
      );
  });
  const unsub = i18n.subscribe(paint);
  globalThis.__AGWorkspace = {
    version: VERSION,
    setPreferences,
    onResult(id, ok, next) {
      const p = pending.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(id);
      if (ok) {
        setPreferences(next);
        p.resolve();
      } else p.reject(Error());
    },
    status: () => ({
      sidebarMode: preferences.sidebarMode,
      peek,
      title: document.title,
      libraryEnabled: preferences.libraryEnabled !== false,
    }),
    destroy() {
      stopped = true;
      intent.destroy();
      document.body.removeAttribute("data-agpa-layout-ready");
      document.body.style.removeProperty("--agpa-navigation-width");
      document.body.style.removeProperty("--agpa-rail-width");
      panel?.removeAttribute("data-agpa-sidebar-panel");
      panel?.removeAttribute("data-agpa-hover-pane");
      panel?.style.removeProperty("--agpa-expanded-width");
      menuTitle?.remove();
      unsub();
      observer.disconnect();
      titleObserver.disconnect();
      for (const f of listeners) f();
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error());
      }
      pending.clear();
      for (const n of marks) {
        n.removeAttribute("data-agpa-brand");
        n.querySelector("[data-agpa-brand-image]")?.remove();
      }
      if (document.title === "Google Gemini") document.title = nativeTitle;
      section?.remove();
      style.remove();
      delete globalThis.__AGWorkspace;
    },
  };
  apply();
  setPreferences(preferences);
})();
