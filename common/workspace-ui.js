/* Branding, title and optional hover sidebar. Native documents stay mounted. */
(() => {
  "use strict";
  const VERSION = "1.0.0";
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
    openTimer,
    closeTimer,
    panel = null,
    nativeTitle = document.title;
  const listeners = [],
    marks = new Set(),
    pending = new Map();
  const style = document.createElement("style");
  style.id = "agpa-workspace-styles";
  style.textContent = `
 [data-agpa-brand]>svg{display:none!important}[data-agpa-brand]>img{width:24px;height:24px;object-fit:contain;pointer-events:none}
 [data-agpa-peek]{position:fixed!important;left:0!important;top:var(--agpa-peek-top)!important;height:var(--agpa-peek-height)!important;width:256px!important;visibility:visible!important;overflow:visible!important;z-index:90!important;box-shadow:12px 0 32px #0005;background:var(--sidebar,#171717);transition:none!important}
 [data-agpa-peek]>div{width:256px!important;visibility:visible!important}
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
  const toggle = () => document.querySelector("[data-testid=sidebar-toggle]");
  const currentPanel = () =>
    document
      .querySelector("[data-testid=settings-button]")
      ?.closest("[role=navigation]")?.parentElement?.parentElement;
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
  function hide() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    openTimer = null;
    closeTimer = null;
    panel?.removeAttribute("data-agpa-peek");
    peek = false;
  }
  function show() {
    if (
      stopped ||
      preferences.sidebarMode !== "hover" ||
      gemini() ||
      document.querySelector("dialog[open],[role=dialog]") ||
      toggle()?.getAttribute("aria-expanded") !== "false"
    )
      return;
    panel = currentPanel();
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    panel.style.setProperty("--agpa-peek-top", r.top + "px");
    panel.style.setProperty("--agpa-peek-height", r.height + "px");
    panel.setAttribute("data-agpa-peek", "");
    peek = true;
  }
  function move(e) {
    if (preferences.sidebarMode !== "hover" || gemini()) {
      hide();
      return;
    }
    const rail = document.querySelector("[data-agpa-rail]");
    const r = rail?.getBoundingClientRect();
    if (!r || !r.height) return;
    const inside =
      e.clientY >= r.top &&
      e.clientY <= r.bottom &&
      e.clientX <= (peek ? 256 : Math.max(14, r.right));
    if (inside) {
      clearTimeout(closeTimer);
      if (!peek && !openTimer)
        openTimer = setTimeout(() => {
          openTimer = null;
          show();
        }, 160);
    } else {
      clearTimeout(openTimer);
      openTimer = null;
      if (peek && !closeTimer)
        closeTimer = setTimeout(() => {
          closeTimer = null;
          if (
            panel?.contains(document.activeElement) ||
            document.querySelector("[role=menu][data-open]")
          )
            return;
          hide();
        }, 350);
    }
  }
  function paint() {
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
  async function choose(mode) {
    hide();
    try {
      await new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID(),
          timer = setTimeout(() => {
            pending.delete(requestId);
            reject(Error());
          }, 8000);
        pending.set(requestId, { resolve, reject, timer });
        globalThis.__agpaLibrary(
          JSON.stringify({ requestId, action: "sidebar", value: mode }),
        );
      });
    } catch {
      const s = section?.querySelector("[role=status]");
      if (s) i18n.set(s, "Could not save. Try again.");
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
    if (panel && panel !== currentPanel()) hide();
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
      }
      if (section.parentElement !== host) host.append(section);
      paint();
    }
  }
  function setPreferences(next) {
    preferences = next;
    hide();
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
    if (e.target.closest("[data-testid=sidebar-toggle]") && e.isTrusted)
      setTimeout(
        () =>
          choose(
            toggle()?.getAttribute("aria-expanded") === "true"
              ? "open"
              : "compact",
          ),
        80,
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
    }),
    destroy() {
      stopped = true;
      hide();
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
