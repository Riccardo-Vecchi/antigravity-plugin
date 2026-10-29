/* Updates belong to the plugin, independently of Antigravity's updater. */
(() => {
  "use strict";
  const VERSION = "1.2.1";
  if (globalThis.__AGPluginUpdates?.version === VERSION) return;
  globalThis.__AGPluginUpdates?.destroy();
  const i = globalThis.__AGPAI18n,
    pending = new Map();
  let section,
    state = {},
    busy = false,
    stopped = false,
    queued = false, currentAction = null, disableDialog;
  const nativeLabels = new WeakMap();
  const errors = {controlFailed:"Could not change plugin state. Try again.",
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
    const summary = busy && currentAction === "enabled" ? "Applying…" : state.installing
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
    section.querySelector("[data-pu-latest]").hidden = !state.available;
    const input = section.querySelector("[data-pu-automatic]");
    input.checked = state.automatic !== false;
    input.disabled = busy || state.installing || state.pluginEnabled === false;
    const check = section.querySelector("[data-pu-check]");
    check.disabled = busy || state.checking || state.installing;
    check
      .querySelector("span")
      .classList.toggle("agpa-pu-spin", !!((busy && currentAction!=="enabled") || state.checking || state.installing));
    const install = section.querySelector("[data-pu-install]");
    install.hidden = !state.available || !!state.paused || state.pluginEnabled === false;
    install.disabled = busy || state.installing;
    const enabled=section.querySelector('[data-pu-enabled]');enabled.checked=state.pluginEnabled!==false;enabled.disabled=busy||state.installing;
    i.set(section.querySelector('[data-pu-enabled-description]'),state.pluginEnabled===false?'Plugin disabled. Enable it here to restore customizations. Desktop and browser access must be enabled separately.':'Pause all customizations without uninstalling. Your settings and sessions are kept.');
    section.querySelector('.agpa-pu-details').hidden=state.pluginEnabled===false;
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
    busy = true;currentAction=action;
    paint();
    try {
      state = await request(action, value);
    } catch {
      state = { ...state, error: action==="enabled"?"controlFailed":"installFailed" };
    } finally {
      busy = false;currentAction=null;
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
  async function openAndCheck(){
    if(!document.querySelector('[data-testid=settings-nav-item-App]'))document.querySelector('[data-testid=settings-button]')?.click();
    for(let n=0;n<30;n++){const nav=document.querySelector('[data-testid=settings-nav-item-App]');if(nav){nav.click();break;}await new Promise(r=>setTimeout(r,100));}
    for(let n=0;n<30;n++){mount();if(section?.isConnected){section.scrollIntoView({block:'center',behavior:'instant'});await act('check');return;}await new Promise(r=>setTimeout(r,100));}
  }
  function updateMenu(){
    const owner=[...document.querySelectorAll('[data-testid=title-menu-bar-item]')].find(e=>e.textContent.trim()==='Antigravity');
    const container=owner?.parentElement,options=[...container?.querySelectorAll('[data-testid=title-menu-bar-option]:not([data-pu-menu])')||[]];
    const official=options.find(e=>!e.hasAttribute('tabindex')&&!e.classList.contains('pointer-events-none'));
    if(!official)return;
    const label=official.querySelector('span');if(!label)return;
    if(!nativeLabels.has(label)){nativeLabels.set(label,label.textContent);label.setAttribute('data-pu-native-update','');}
    i.set(label,'Check Antigravity Updates');
    if(container.querySelector('[data-pu-menu]'))return;
    const button=node('button',null,{type:'button',class:official.className,'data-testid':'title-menu-bar-option','data-pu-menu':''});
    button.append(node('span','Check Plugin Updates'));
    button.onclick=()=>{owner.click();openAndCheck();};
    const row=document.createElement('div');row.append(button);official.parentElement.parentElement.append(row);
  }
  function escape(event){if(event.key==='Escape'&&disableDialog?.open){event.preventDefault();event.stopImmediatePropagation();disableDialog.close();paint();}}
  window.addEventListener('keydown',escape,true);
  function mount() {
    if (stopped) return;
    updateMenu();
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
        input = node("input", null, { type: "checkbox", "data-pu-automatic":"" });
      input.addEventListener("change", () => act("automatic", input.checked));
      label.append(input, node("span", "Automatically install plugin updates"));
      const check = node("button", null, {
          type: "button",
          "data-pu-check": "",
        }),
        spin = node("span", null, { "aria-hidden": "true" });
      spin.textContent = "↻";
      check.append(spin, node("span", "Check Plugin Updates"));
      check.onclick = () => act("check");
      const install = node("button", "Install update", {
        type: "button",
        "data-pu-install": "",
      });
      install.onclick = () => act("install");
      const actions = node("div", null, { class: "agpa-pu-actions" });
      actions.append(check, install);
      const diagnostics=node("details",null,{class:"agpa-pu-details"});
      diagnostics.append(node("summary","Plugin customizations"),node("div",null,{"data-pu-diagnostics":""}));
      const enabled=node('input',null,{type:'checkbox','data-pu-enabled':''});
      const cancel=node('button','Cancel',{type:'button'}),confirm=node('button','Disable plugin',{type:'button',class:'agpa-pu-danger','data-pu-disable-confirm':''});
      cancel.onclick=()=>{disableDialog.close();paint();};confirm.onclick=()=>{disableDialog.close();act('enabled',false);};
      disableDialog=node('dialog',null,{class:'agpa-pu-confirm','aria-labelledby':'agpa-pu-disable-title'});
      disableDialog.append(node('h3','Disable plugin?',{id:'agpa-pu-disable-title'}),node('p','Customizations will be paused and Computer use and Browser use disconnected. Settings and Gemini sessions are kept. Enable the plugin again here; enable tool access separately.'),node('div',null,{class:'agpa-pu-actions'}));
      disableDialog.lastElementChild.append(cancel,confirm);
      disableDialog.addEventListener('cancel',()=>queueMicrotask(paint));
      enabled.onchange=()=>{if(enabled.checked)act('enabled',true);else{paint();disableDialog.showModal();cancel.focus();}};
      const control=node('div',null,{class:'agpa-pu-control'}),controlLabel=node('label',null,{class:'agpa-pu-toggle'});
      controlLabel.append(enabled,node('span','Enable plugin'));control.append(controlLabel,node('p',null,{'data-pu-enabled-description':''}));
      section.append(
        node("h3", "Plugin updates"),control,disableDialog,
        node("p", null, { "data-pu-current": "" }),
        node("p", null, { "data-pu-latest": "" }),
        label,
        node(
          "p",
          "Checks every 24 hours. Updates preserve your settings and open pages.",
        ),
        actions,
        node("p", null, {
          "data-pu-summary": "",
          role: "status",
          "aria-live": "polite",
        }),
        node("p", null, { "data-pu-checked": "" }),
        diagnostics,
      );
      refresh();
    }
    // Native Application keeps its version/about block last. Place the plugin below it.
    if (section.parentElement !== host) host.append(section);
    paint();
  }
  const style = node("style");
  style.textContent =
    ".agpa-plugin-update-section{display:flex;flex-direction:column;gap:12px;border:1px solid var(--border,#353535);border-radius:12px;padding:15px;margin-top:18px;font-size:13px;color:var(--foreground,#eee)}.agpa-pu-details{border-top:1px solid var(--border,#353535);padding-top:12px}.agpa-pu-details summary{cursor:pointer;font-size:13px}.agpa-pu-details[open]>div{padding-top:10px}.agpa-pu-details .agpa-patch-actions{margin-top:12px}.agpa-plugin-update-section h3{font-size:14px;font-weight:500;margin:0}.agpa-plugin-update-section p{font-size:12px;line-height:1.6;color:var(--muted-foreground,#aaa);margin:0}.agpa-pu-toggle,.agpa-pu-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.agpa-pu-actions button{display:flex;gap:6px;align-items:center;background:transparent;color:inherit;font:inherit;border:1px solid #444;border-radius:8px;padding:8px 12px;cursor:pointer}.agpa-pu-actions button[hidden]{display:none}.agpa-pu-actions button:disabled{opacity:.5;cursor:wait}.agpa-pu-spin{display:inline-block;animation:agpa-plugin-update-spin 1s linear infinite}@keyframes agpa-plugin-update-spin{to{transform:rotate(360deg)}}";
  style.textContent+='body[data-agpa-plugin-disabled] [data-agpa-open-gemini]{display:none!important}.agpa-pu-control{display:grid;gap:8px;border-bottom:1px solid var(--border,#353535);padding-bottom:14px}.agpa-pu-control label{cursor:pointer}.agpa-pu-toggle input{accent-color:#398bdb}.agpa-pu-confirm{width:min(460px,calc(100vw - 40px));padding:24px;border-radius:14px;border:1px solid var(--border,#444);background:var(--background,#171717);color:var(--foreground,#eee);font:13px/1.6 system-ui,sans-serif}.agpa-pu-confirm h3{font-size:17px;margin:0}.agpa-pu-confirm::backdrop{background:#0009}.agpa-pu-confirm .agpa-pu-actions{justify-content:flex-end;margin-top:20px}.agpa-pu-danger{background:#b4232c!important;color:white!important}.agpa-pu-details[hidden]{display:none}';
  document.head.append(style);
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false, currentAction = null, disableDialog;
  const nativeLabels = new WeakMap();
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
    status: () => state, openAndCheck,
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
      disableDialog?.close();window.removeEventListener('keydown',escape,true);
      for(const label of document.querySelectorAll('[data-pu-native-update]')){label.textContent=nativeLabels.get(label)||label.textContent;label.removeAttribute('data-pu-native-update');}
      for(const button of document.querySelectorAll('[data-pu-menu]'))button.parentElement.remove();
      section?.remove();
      style.remove();
      delete globalThis.__AGPluginUpdates;
    },
  };
  mount();
})();
