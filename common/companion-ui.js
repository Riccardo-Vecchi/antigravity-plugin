/* Optional browser connections. No access from the Gemini guest. */
(() => {
  "use strict";
  const VERSION = "1.6.0";
  if (globalThis.__AGCompanion?.version === VERSION) return;
  globalThis.__AGCompanion?.destroy();
  const i18n = globalThis.__AGPAI18n,
    pending = new Map();
  const phaseFor=globalThis.__AGPABrowserSetupState;
  delete globalThis.__AGPABrowserSetupState;
  const createBrowserPicker=globalThis.__AGPABrowserPicker, browserIcons=globalThis.__AGPA_BROWSER_ICONS__;
  delete globalThis.__AGPABrowserPicker;delete globalThis.__AGPA_BROWSER_ICONS__;
  let browserSignature = "",selectedBrowser="",notice="",loaded=false;
  try{selectedBrowser=localStorage.getItem("agpa.browser.setupTarget")||"";}catch{}
  let state = {browser: {connections: []}}, destroyed = false, busy = false,
      error = "", polling = false, browserSection, pendingAction = null;
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
    const restoreToggleFocus=document.activeElement?.hasAttribute("data-agpa-browser-toggle");
    busy = true;
    pendingAction = action;
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
      pendingAction = null;
      render();
      if(restoreToggleFocus)browserSection?.querySelector("[data-agpa-browser-toggle]")?.focus();
    }
  }
  function accept(next) {state = next;loaded=true;}
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
  async function copyFolder(open=false){
    const b=state.browser;let copied=false;
    try{await navigator.clipboard.writeText(b.extensionPath);copied=true;notice=t("Folder path copied. In {browser}, choose Developer mode → Load unpacked. In the folder-selection window, press {shortcut}, paste with Ctrl+V, then select the folder.",{browser:(b.available||[]).find(x=>x.id===selectedBrowser)?.label||t("Your browser"),shortcut:b.platform==="win32"?"Alt+D":"Ctrl+L"});}
    catch{notice=t("Copy Extension folder below. In the browser, choose Load unpacked and paste the path into the folder-selection window’s location bar.");}
    if(open&&selectedBrowser!=="other")await act("openExtensions",selectedBrowser);
    render();if(!copied){const help=browserSection?.querySelector(".agpa-comp-advanced");if(help){help.open=true;const input=help.querySelector("input");input?.focus();input?.select();}}
  }
  function renderBrowser() {
    const host=globalThis.__AGSettingsNavigation?.getPage("browser");if(!host)return;
    if(!browserSection?.isConnected){browserSection=node("section",{"data-agpa-browser-setting":"",class:"agpa-comp-section"});host.append(browserSection);}
    if(!globalThis.__AGSettingsNavigation.isOpen("browser"))return;
    if(!loaded){browserSection.replaceChildren(heading("Browser setup","Checking…"));return;}
    const b=state.browser,available=b.available||[];
    if(!selectedBrowser||(!available.some(v=>v.id===selectedBrowser)&&selectedBrowser!=="other"))selectedBrowser=b.defaultBrowser||available[0]?.id||"other";
    const found=b.installations?.[selectedBrowser],recovery=b.connections.length||!b.enabled||!b.registered?null:found,needsReload=recovery?.status==="reload";
    const phase=phaseFor(b,selectedBrowser),stage={prepare:0,install:1,reconnect:2,share:2,ready:3}[phase];
    const signature=JSON.stringify([b,busy,pendingAction,error,notice,selectedBrowser,i18n.language,globalThis.__AGNativeMcp?.status("antigravity-plugin-browser").detected]);
    if(browserSection.childElementCount&&browserSignature===signature)return;browserSignature=signature;
    const toggle=button(pendingAction==="setupBrowser"?"Enabling…":pendingAction==="disableBrowser"?"Disabling…":b.enabled?"Enabled":"Disabled",()=>act(b.enabled?"disableBrowser":"setupBrowser"),"agpa-comp-enable-switch");
    toggle.setAttribute("role","switch");toggle.setAttribute("aria-label",t("Browser use"));toggle.setAttribute("aria-checked",String(!!b.enabled||pendingAction==="setupBrowser"));toggle.setAttribute("data-agpa-browser-toggle","");
    i18n.set(toggle,b.enabled?"Disable Browser use and stop sharing. Keep the extension installed.":"Enable Browser use. Choose what to share in the extension.",{},"title");
    toggle.append(node("span",{class:"agpa-comp-switch-track","aria-hidden":"true"},node("span",{class:"agpa-comp-switch-thumb"})));
    const activation=node("div",{class:"agpa-comp-enable-row","data-agpa-browser-activation":""},node("span",{class:"agpa-comp-enable-status","data-on":String(!!b.enabled),text:pendingAction==="setupBrowser"?"Preparing Browser use…":pendingAction==="disableBrowser"?"Disabling Browser use…":b.enabled?"Browser use is enabled":"Browser use is disabled"}),toggle);
    const content=[activation];
    if(!b.enabled){browserSection.replaceChildren(...content);return;}
    function extensionsButton(copy=false,primary=false){
      if(selectedBrowser==="other")return button("Copy extension folder",()=>copyFolder(),primary?"primary":"");
      const name=available.find(v=>v.id===selectedBrowser)?.label||t("Your browser");
      const control=button("Open Extensions page",()=>copy?copyFolder(true):act("openExtensions",selectedBrowser),primary?"primary":"");
      i18n.set(control,"Open {browser} Extensions",{browser:name});control.setAttribute("data-agpa-browser-extensions","");return control;
    }
    const steps=node("ol",{class:"agpa-comp-progress","aria-label":"Browser setup"});
    for(const [index,key]of ["Connect","Add extension","Share tabs"].entries()){
      const li=node("li",{"data-state":stage>index?"done":stage===index?"current":"pending"},text(stage>index?"✓":String(index+1)),node("span",{text:key}));
      if(stage===index)li.setAttribute("aria-current","step");steps.append(li);
    }
    content.push(steps);
    const hero=node("div",{class:"agpa-comp-hero","data-ready":String(phase==="ready")});
    const titles={reconnect:"Browser extension already installed",prepare:"Connect your browser",install:"Add browser extension",share:"Choose what to share",ready:"Ready for your next task"};
    const descriptions={reconnect:"In your browser, click Extensions (puzzle icon) → Antigravity Browser → Reconnect. You do not need to install it again.",prepare:"Let the Antigravity agent use the pages you choose, with your existing browser logins.",install:"The extension is named Antigravity Browser in your browser. It connects your browser to Antigravity Plugin.",share:"In your browser, click the puzzle icon, then Antigravity Browser.",ready:"Ask the Antigravity agent to work with your shared tabs."};
    hero.append(node("h3",{text:needsReload?"Update browser extension":recovery?.status==="broken"?"Repair browser extension":titles[phase]}),node("p",{text:needsReload?"Open the browser’s Extensions page and turn on Developer mode (top right). Find Antigravity Browser and click the Reload icon (↻) on its card.":recovery?.status==="broken"?"The installed entry points to a missing folder. Load the current extension folder once to repair it.":recovery?.status==="disabled"?"Antigravity Browser is installed but disabled. Open its details and switch it on, then use the extension’s Reconnect button.":descriptions[phase]}));content.push(hero);
    const actions=node("div",{class:"agpa-comp-actions"});
    if(b.enabled){
      const picker=createBrowserPicker({items:[...available,{id:"other",label:t("Other Chromium browser")}],value:selectedBrowser,icons:browserIcons,label:t("Your browser"),onChange(value){
        selectedBrowser=value;notice="";try{localStorage.setItem("agpa.browser.setupTarget",selectedBrowser);}catch{}render();
      }});
      content.push(node("div",{class:"agpa-comp-browser-choice"},node("span",{text:"Your browser"}),picker));
    }
    if(phase==="prepare"){
      actions.append(button(busy?"Connecting…":"Connect browser",()=>act("setupBrowser"),"primary"));content.push(actions);
      content.push(node("p",{class:"agpa-comp-muted",text:"Nothing is shared until you choose it in the extension."}));
    }else if(phase==="install"){
      if(needsReload){
        actions.append(extensionsButton(false,true));
      }else{
        content.push(node("ol",{class:"agpa-comp-steps"},node("li",{text:"On the browser’s Extensions page, look for Antigravity Browser first. If it is missing, turn on Developer mode."}),node("li",{text:"Choose Load unpacked. In the folder-selection window, paste the copied path into the address/location bar, then select the folder."})));
        actions.append(extensionsButton(true,true));
      }
      content.push(actions);
      if(notice)content.push(node("p",{class:"agpa-comp-notice",role:"status"},text(notice)));
    }else if(phase==="reconnect"){
      actions.append(extensionsButton(false,true));
      content.push(actions,node("p",{class:"agpa-comp-muted",text:"Detected in a standard browser profile. The button opens that profile; nothing is shared until you choose it in the extension."}));
    }else if(phase==="share"){

      content.push(node("div",{class:"agpa-comp-access"},heading("Selected tabs","Open a web page, click the extension and choose Share this tab."),heading("All tabs in this profile","Includes current and new web tabs until you stop sharing or disconnect.")));
      content.push(node("p",{class:"agpa-comp-muted",text:"Private tabs, browser settings and password fields are excluded."}));

    }else{
      const example="Compare two of my shared pages and summarize their differences.";
      content.push(node("div",{class:"agpa-comp-example"},node("strong",{text:"Try asking Antigravity"}),node("p",{text:example}),button("Copy example",async()=>{try{await navigator.clipboard.writeText(t(example));notice=t("Copied");render();}catch{}})));
      if(notice)content.push(node("p",{class:"agpa-comp-muted",role:"status"},text(notice)));
    }
    const refreshStatus=button("Refresh status",()=>selectedBrowser!=="other"?act("inspectBrowser",selectedBrowser):refresh());
    refreshStatus.setAttribute("data-agpa-browser-refresh", "");
    const refreshIcon=node("span",{"aria-hidden":"true"},text("↻"));refreshStatus.prepend(refreshIcon);
    if(selectedBrowser!=="other"&&!actions.querySelector("[data-agpa-browser-extensions]"))actions.append(extensionsButton());
    actions.append(refreshStatus);
    if(!content.includes(actions))content.push(actions);
    if(b.connections.length){
      content.push(node("h3",{text:"Connected browsers"}));
      for(const c of b.connections){
        const profile=node("div",{class:"agpa-comp-profile"},text("✓","passed"),node("div",{},text(c.label),text(t("{count} shared tabs",{count:c.tabs}),"agpa-comp-muted"),node("span",{class:"agpa-comp-muted",text:c.scope==="profile"?"All tabs in this profile":c.scope==="tabs"?"Selected tabs":"Access is managed in the extension."})));
        const menu=node("details",{class:"agpa-comp-profile-menu"},node("summary",{text:"Manage"}),button("Disconnect",()=>act("disconnectProfile",c.id),"danger"));profile.append(menu);content.push(profile);
      }
    }
    const advanced=node("details",{class:"agpa-comp-advanced"},node("summary",{text:"Connection details and help"}));
    if(phase==="install"||phase==="reconnect"){
      advanced.append(node("h3",{text:"Extension missing or moved?"}),node("p",{text:"Choose Load unpacked and select this folder. Remove an old broken entry if necessary."}));
      const path=node("input",{type:"text",readonly:"","aria-label":"Extension folder"});path.value=b.extensionPath||"";
      advanced.append(node("div",{class:"agpa-comp-path"},path,button("Copy extension folder",()=>copyFolder())));
    }

    if(b.enabled){
      advanced.append(node("h3",{text:"Reload the browser extension"}),
        node("p",{text:"Antigravity Browser is the browser extension included with Antigravity Plugin. Reload is on its card on the browser’s Extensions page, not in its popup."}),
        node("p",{text:"Turn on Developer mode (top right) to show the Reload icon (↻). Reloading the extension stops tab sharing; choose your tabs again afterwards."}));
      advanced.append(node("p",{text:"Use the Open Extensions button above. It opens the selected browser’s Extensions page directly; Reload is on the extension card there."}));
    }
    const checks=node("ul",{class:"agpa-comp-checks"});
    for(const [key,value]of [["Browser access enabled",b.enabled],["Registered in Antigravity",b.registered],["Server detected by Antigravity",globalThis.__AGNativeMcp?.status("antigravity-plugin-browser").detected],["Browser profile connected",b.connections.length>0],["At least one tab shared",b.connections.some(c=>c.tabs>0)]])checks.append(check(key,value));
    advanced.append(checks,node("p",{class:"agpa-comp-muted",text:"If the agent cannot see the tools, start a new conversation."}),node("a",{href:"https://github.com/Riccardo-Vecchi/antigravity-plugin/blob/main/docs/BROWSER_USE.md",target:"_blank",rel:"noopener noreferrer",text:"Browser-use setup guide"}));
    if(found?.status==="unknown")advanced.append(node("p",{class:"agpa-comp-muted",text:"Installation could not be checked. Look for Antigravity Browser on the browser’s Extensions page before installing it."}));
    const tools=node("div",{class:"agpa-comp-actions"});
    if(b.enabled)tools.append(button("Repair browser connection",()=>act("setupBrowser")));advanced.append(tools);content.push(advanced);
    const focus=document.activeElement,wasPath=focus===browserSection.querySelector("input"),wasPicker=focus===browserSection.querySelector("[data-agpa-browser-trigger]"),pickerOpen=browserSection.querySelector("[data-agpa-browser-trigger]")?.getAttribute("aria-expanded")==="true";
    const expanded=browserSection.querySelector('.agpa-comp-advanced')?.open;if(expanded)advanced.open=true;
    browserSection.replaceChildren(...content);if(wasPath)browserSection.querySelector("input")?.focus();if(wasPicker){const trigger=browserSection.querySelector("[data-agpa-browser-trigger]");trigger?.focus();if(pickerOpen)trigger?.click();}
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
        if(busy)for(const popup of section.querySelectorAll(".agpa-browser-popup:popover-open"))popup.hidePopover();
        section.setAttribute("aria-busy", String(busy));
      }
  }
  const style = node("style", { id: "agpa-companion-styles" });
  style.textContent = `
 .agpa-comp-enable-row{display:flex;align-items:center;gap:14px;padding:4px 0 12px}.agpa-comp-enable-status{display:flex;align-items:center;gap:10px;font-size:14px}.agpa-comp-enable-status:before{content:'';width:8px;height:8px;flex-shrink:0;background:#777;border-radius:50%}.agpa-comp-enable-status[data-on=true]:before{background:#55c98a}
 .agpa-comp-button.agpa-comp-enable-switch{display:inline-flex;align-items:center;gap:8px;margin-left:auto;padding:5px 0 5px 10px;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;white-space:nowrap;flex-shrink:0}.agpa-comp-enable-switch:focus-visible{outline:2px solid #398bdb;outline-offset:4px;border-radius:6px}.agpa-comp-enable-switch:disabled{opacity:.5;cursor:wait}.agpa-comp-switch-track{display:block;position:relative;width:34px;height:20px;background:#666;border-radius:20px}.agpa-comp-switch-thumb{display:block;position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:white}.agpa-comp-enable-switch[aria-checked=true] .agpa-comp-switch-track{background:#398bdb}.agpa-comp-enable-switch[aria-checked=true] .agpa-comp-switch-thumb{left:17px}
 .agpa-comp-section{display:flex;flex-direction:column;gap:16px;font-size:13px;color:var(--foreground,#ddd)}.agpa-comp-section h3{font-size:14px;font-weight:500;margin:0}.agpa-comp-section p{margin:0;line-height:1.6}.agpa-comp-heading{display:grid;gap:9px}.agpa-comp-heading p,.agpa-comp-muted{color:var(--secondary-foreground,#999)}.agpa-comp-button,.agpa-comp-section select{font:inherit;color:inherit;border:1px solid #383838;background:transparent;border-radius:8px;padding:7px 11px;cursor:pointer}.agpa-comp-button.primary{color:#111;background:#eee;border-color:#eee}.agpa-comp-button.danger{color:#ff9696;border-color:#6b3434}.agpa-comp-button:disabled,.agpa-comp-section select:disabled{opacity:.45;cursor:default}.agpa-comp-button:focus-visible,.agpa-comp-section select:focus-visible{outline:2px solid #3a9cff;outline-offset:2px}.agpa-comp-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.agpa-comp-actions [data-agpa-browser-refresh]{display:inline-flex;align-items:center;gap:7px}.agpa-comp-actions [data-agpa-browser-refresh]>span[aria-hidden]{font-size:17px;line-height:1}.agpa-comp-actions label{display:flex;align-items:center;gap:8px}.agpa-comp-guide{display:grid}.agpa-comp-guide summary{cursor:pointer;padding:5px 0 10px}.agpa-comp-guide[open]>.agpa-comp-path{margin-top:12px}.agpa-comp-steps{margin:0;padding-left:20px;line-height:1.7;list-style:decimal}.agpa-comp-path{display:flex;gap:8px}.agpa-comp-path input{font:12px monospace;min-width:0;flex:1;color:inherit;border:1px solid #363636;border-radius:7px;background:#191919;padding:8px}.agpa-comp-checks{list-style:none;margin:0;padding:0;border:1px solid #292929;border-radius:10px;padding:8px 13px}.agpa-comp-check{display:flex;gap:12px;padding:8px 0}.agpa-comp-check>:last-child{margin-left:auto;font-size:11px}.agpa-comp-section .passed{color:#45cb90}.agpa-comp-section .pending{color:#e8b457}.agpa-comp-profile{display:flex;align-items:center;gap:10px;border:1px solid #303030;border-radius:8px;padding:10px}.agpa-comp-profile>div{display:grid;gap:5px;flex:1}.agpa-comp-profile>div>span{display:block}.agpa-comp-profile-menu{margin-left:auto}.agpa-comp-profile-menu summary{cursor:pointer;font-size:12px}.agpa-comp-notice{border:1px solid #303030;border-radius:9px;padding:12px;line-height:1.6;display:grid;gap:6px}.agpa-comp-error{color:#ff9696}`;
  style.textContent+=`
 .agpa-comp-progress{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.agpa-comp-progress li{display:flex;gap:7px;align-items:center;color:var(--secondary-foreground,#999);font-size:12px}.agpa-comp-progress li>span:first-child{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border:1px solid #444;border-radius:50%;flex-shrink:0}.agpa-comp-progress [data-state=done]{color:#59ca94}.agpa-comp-progress [data-state=current]{color:var(--foreground,#ddd)}.agpa-comp-progress [data-state=current]>span:first-child{border-color:#6eafff;background:#6eafff18}.agpa-comp-hero{display:grid;gap:8px;padding-top:8px}.agpa-comp-hero h3{font-size:17px}.agpa-comp-hero[data-ready=true] h3{color:#59ca94}.agpa-comp-hero p{color:var(--secondary-foreground,#999)}.agpa-comp-browser-choice{display:flex;align-items:center;gap:18px}.agpa-browser-picker{margin-left:auto}.agpa-browser-trigger{display:flex;align-items:center;gap:10px;min-width:210px;text-align:left;background:var(--background,#171717)}.agpa-browser-arrow{margin-left:auto}.agpa-browser-icon{display:inline-block;width:20px;height:20px;object-fit:contain;flex-shrink:0;text-align:center;line-height:20px}.agpa-browser-popup{box-sizing:border-box;position:fixed;inset:auto;margin:0;padding:5px;overflow:auto;border:1px solid var(--border,#444);border-radius:9px;background:var(--background,#171717);color:var(--foreground,#ddd);font-family:inherit;font-size:13px;box-shadow:0 8px 24px #0006}.agpa-browser-option{display:flex;align-items:center;gap:10px;min-height:36px;padding:0 9px;border-radius:5px;cursor:pointer;font:inherit}.agpa-browser-option:hover,.agpa-browser-option[data-active]{background:var(--secondary,#303030)}.agpa-browser-check{margin-left:auto;font-size:12px}.agpa-browser-trigger:focus-visible{outline:2px solid #3a9cff;outline-offset:2px}.agpa-comp-access{display:grid;grid-template-columns:1fr 1fr;gap:12px}.agpa-comp-access>div,.agpa-comp-example{border:1px solid var(--border,#333);border-radius:10px;padding:16px;display:grid;gap:10px}.agpa-comp-example button{justify-self:start}.agpa-comp-help,.agpa-comp-advanced{font-size:12px}.agpa-comp-help summary,.agpa-comp-advanced summary{cursor:pointer;color:var(--secondary-foreground,#999)}.agpa-comp-help[open]>p{margin-top:12px}.agpa-comp-advanced{border-top:1px solid var(--border,#333);padding-top:16px}.agpa-comp-advanced[open]>*:not(summary){margin-top:14px}@media(max-width:600px){.agpa-comp-access{grid-template-columns:1fr}.agpa-comp-progress li{flex-direction:column;text-align:center}}
 `;
  document.head.append(style);
  function onPage() {
    render();
    refresh();
  }
  window.addEventListener("agpa:settings-page", onPage);
  const unsubscribe = i18n.subscribe(render);
  const timer = setInterval(() => {
    if (!busy && !document.hidden && globalThis.__AGSettingsNavigation?.isOpen("browser")) refresh();
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
