/* Optional browser connections. No access from the Gemini guest. */
(() => {
  "use strict";
  const VERSION = "1.3.0";
  if (globalThis.__AGCompanion?.version === VERSION) return;
  globalThis.__AGCompanion?.destroy();
  const i18n = globalThis.__AGPAI18n,
    pending = new Map();
  const phaseFor=globalThis.__AGPABrowserSetupState;
  delete globalThis.__AGPABrowserSetupState;
  let browserSignature = "",selectedBrowser="",notice="",loaded=false;
  try{selectedBrowser=localStorage.getItem("agpa.browser.setupTarget")||"";}catch{}
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
    const b=state.browser;
    try{await navigator.clipboard.writeText(b.extensionPath);notice=t("Folder copied. Paste it in the folder picker.");}
    catch{notice=t("Copy the folder path below into the folder picker.");}
    if(open&&selectedBrowser!=="other")await act("openExtensions",selectedBrowser);
    render();
  }
  function renderBrowser() {
    const host=globalThis.__AGSettingsNavigation?.getPage("browser");if(!host)return;
    if(!browserSection?.isConnected){browserSection=node("section",{"data-agpa-browser-setting":"",class:"agpa-comp-section"});host.append(browserSection);}
    if(!globalThis.__AGSettingsNavigation.isOpen("browser"))return;
    if(!loaded){browserSection.replaceChildren(heading("Browser setup","Checking…"));return;}
    const b=state.browser,available=b.available||[];
    if(!selectedBrowser||(!available.some(v=>v.id===selectedBrowser)&&selectedBrowser!=="other"))selectedBrowser=b.defaultBrowser||available[0]?.id||"other";
    const phase=phaseFor(b),stage=["prepare","install","share","ready"].indexOf(phase);
    const signature=JSON.stringify([b,busy,error,notice,selectedBrowser,i18n.language,globalThis.__AGNativeMcp?.status("antigravity-plugin-browser").detected]);
    if(browserSection.childElementCount&&browserSignature===signature)return;browserSignature=signature;
    const content=[],steps=node("ol",{class:"agpa-comp-progress","aria-label":"Browser setup"});
    for(const [index,key]of ["Connect","Add extension","Share tabs"].entries()){
      const li=node("li",{"data-state":stage>index?"done":stage===index?"current":"pending"},text(stage>index?"✓":String(index+1)),node("span",{text:key}));
      if(stage===index)li.setAttribute("aria-current","step");steps.append(li);
    }
    content.push(steps);
    const hero=node("div",{class:"agpa-comp-hero","data-ready":String(phase==="ready")});
    const titles={prepare:"Connect your browser",install:"Add Antigravity Browser",share:"Choose what to share",ready:"Ready for your next task"};
    const descriptions={prepare:"Use the tabs and logins already open in your browser.",install:"A one-time browser step. Your tabs and logins stay open.",share:"Open Antigravity Browser from your browser toolbar and choose your access.",ready:"Ask the Antigravity agent to work with your shared tabs."};
    hero.append(node("h3",{text:titles[phase]}),node("p",{text:descriptions[phase]}));content.push(hero);
    const actions=node("div",{class:"agpa-comp-actions"});
    if(phase==="prepare"||phase==="install"){
      const picker=node("select",{"aria-label":"Your browser"});
      for(const item of [...available,{id:"other",label:t("Other Chromium browser")}]){const option=document.createElement("option");option.value=item.id;option.textContent=item.label;option.selected=item.id===selectedBrowser;picker.append(option);}
      picker.onchange=()=>{selectedBrowser=picker.value;notice="";try{localStorage.setItem("agpa.browser.setupTarget",selectedBrowser);}catch{}render();};
      content.push(node("label",{class:"agpa-comp-browser-choice"},node("span",{text:"Your browser"}),picker));
    }
    if(phase==="prepare"){
      actions.append(button(busy?"Connecting…":"Connect browser",()=>act("setupBrowser"),"primary"));content.push(actions);
      content.push(node("p",{class:"agpa-comp-muted",text:"Nothing is shared until you choose it in the extension."}));
    }else if(phase==="install"){
      const instructions=node("ol",{class:"agpa-comp-steps"},node("li",{text:"Turn on Developer mode on the browser’s Extensions page."}),node("li",{text:"Choose Load unpacked, then paste the copied folder path."}));
      content.push(instructions);
      actions.append(button(selectedBrowser==="other"?"Copy extension folder":"Copy folder and open Extensions",()=>copyFolder(true),"primary"));content.push(actions);
      const path=node("input",{type:"text",readonly:"","aria-label":"Extension folder"});path.value=b.extensionPath||"";content.push(node("div",{class:"agpa-comp-path"},path,button("Copy",()=>copyFolder())));
      if(notice)content.push(node("p",{class:"agpa-comp-notice",role:"status"},text(notice)));
      const installed=node("details",{class:"agpa-comp-help"},node("summary",{text:"Already installed or moved from an older version?"}),node("p",{text:"Open Antigravity Browser and choose Reconnect. If the browser reports a missing extension folder, remove that old entry and load the folder shown above."}));content.push(installed);
      content.push(node("p",{class:"agpa-comp-muted",text:"This page continues automatically when the extension connects."}));
    }else if(phase==="share"){
      content.push(node("div",{class:"agpa-comp-access"},heading("Selected tabs","Open a web page, click the extension and choose Share this tab."),heading("All tabs in this profile","Includes current and new web tabs until you stop sharing or disconnect.")));
      content.push(node("p",{class:"agpa-comp-muted",text:"Private tabs, browser settings and password fields are excluded."}));
      content.push(node("p",{class:"agpa-comp-notice",text:"Tip: pin Antigravity Browser using the puzzle icon in your browser toolbar."}));
    }else{
      const example="Compare two of my shared pages and summarize their differences.";
      content.push(node("div",{class:"agpa-comp-example"},node("strong",{text:"Try asking Antigravity"}),node("p",{text:example}),button("Copy example",async()=>{try{await navigator.clipboard.writeText(t(example));notice=t("Copied");render();}catch{}})));
      if(notice)content.push(node("p",{class:"agpa-comp-muted",role:"status"},text(notice)));
    }
    if(b.connections.length){
      content.push(node("h3",{text:"Connected browsers"}));
      for(const c of b.connections){
        const profile=node("div",{class:"agpa-comp-profile"},text("✓","passed"),node("div",{},text(c.label),text(t("{count} shared tabs",{count:c.tabs}),"agpa-comp-muted"),node("span",{class:"agpa-comp-muted",text:c.scope==="profile"?"All tabs in this profile":c.scope==="tabs"?"Selected tabs":"Access is managed in the extension."})));
        const menu=node("details",{class:"agpa-comp-profile-menu"},node("summary",{text:"Manage"}),button("Disconnect",()=>act("disconnectProfile",c.id),"danger"));profile.append(menu);content.push(profile);
      }
    }
    const advanced=node("details",{class:"agpa-comp-advanced"},node("summary",{text:"Connection details and help"}));
    const checks=node("ul",{class:"agpa-comp-checks"});
    for(const [key,value]of [["Browser access enabled",b.enabled],["Registered in Antigravity",b.registered],["Server detected by Antigravity",globalThis.__AGNativeMcp?.status("antigravity-plugin-browser").detected],["Browser profile connected",b.connections.length>0],["At least one tab shared",b.connections.some(c=>c.tabs>0)]])checks.append(check(key,value));
    advanced.append(checks,node("p",{class:"agpa-comp-muted",text:"Available to the native Antigravity agent. The embedded Gemini website does not receive these tools."}),node("p",{class:"agpa-comp-muted",text:"If the agent cannot see the tools, start a new conversation."}));
    const tools=node("div",{class:"agpa-comp-actions"},button("Refresh status",refresh));
    if(b.enabled)tools.append(button("Repair browser connection",()=>act("setupBrowser")),button("Turn off Browser use",()=>act("disableBrowser"),"danger"));advanced.append(tools);content.push(advanced);
    const focus=document.activeElement,wasPath=focus===browserSection.querySelector("input"),wasPicker=focus===browserSection.querySelector("select");
    const expanded=browserSection.querySelector('.agpa-comp-advanced')?.open;if(expanded)advanced.open=true;
    browserSection.replaceChildren(...content);if(wasPath)browserSection.querySelector("input")?.focus();if(wasPicker)browserSection.querySelector("select")?.focus();
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
 .agpa-comp-section{display:flex;flex-direction:column;gap:16px;font-size:13px;color:var(--foreground,#ddd)}.agpa-comp-section h3{font-size:14px;font-weight:500;margin:0}.agpa-comp-section p{margin:0;line-height:1.6}.agpa-comp-heading{display:grid;gap:9px}.agpa-comp-heading p,.agpa-comp-muted{color:var(--secondary-foreground,#999)}.agpa-comp-button,.agpa-comp-section select{font:inherit;color:inherit;border:1px solid #383838;background:transparent;border-radius:8px;padding:7px 11px;cursor:pointer}.agpa-comp-button.primary{color:#111;background:#eee;border-color:#eee}.agpa-comp-button.danger{color:#ff9696;border-color:#6b3434}.agpa-comp-button:disabled,.agpa-comp-section select:disabled{opacity:.45;cursor:default}.agpa-comp-button:focus-visible,.agpa-comp-section select:focus-visible{outline:2px solid #3a9cff;outline-offset:2px}.agpa-comp-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.agpa-comp-actions label{display:flex;align-items:center;gap:8px}.agpa-comp-guide{display:grid}.agpa-comp-guide summary{cursor:pointer;padding:5px 0 10px}.agpa-comp-guide[open]>.agpa-comp-path{margin-top:12px}.agpa-comp-steps{margin:0;padding-left:20px;line-height:1.7;list-style:decimal}.agpa-comp-path{display:flex;gap:8px}.agpa-comp-path input{font:12px monospace;min-width:0;flex:1;color:inherit;border:1px solid #363636;border-radius:7px;background:#191919;padding:8px}.agpa-comp-checks{list-style:none;margin:0;padding:0;border:1px solid #292929;border-radius:10px;padding:8px 13px}.agpa-comp-check{display:flex;gap:12px;padding:8px 0}.agpa-comp-check>:last-child{margin-left:auto;font-size:11px}.agpa-comp-section .passed{color:#45cb90}.agpa-comp-section .pending{color:#e8b457}.agpa-comp-profile{display:flex;align-items:center;gap:10px;border:1px solid #303030;border-radius:8px;padding:10px}.agpa-comp-profile>div{display:grid;gap:5px;flex:1}.agpa-comp-profile>div>span{display:block}.agpa-comp-profile-menu{margin-left:auto}.agpa-comp-profile-menu summary{cursor:pointer;font-size:12px}.agpa-comp-notice{border:1px solid #303030;border-radius:9px;padding:12px;line-height:1.6;display:grid;gap:6px}.agpa-comp-error{color:#ff9696}`;
  style.textContent+=`
 .agpa-comp-progress{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.agpa-comp-progress li{display:flex;gap:7px;align-items:center;color:var(--secondary-foreground,#999);font-size:12px}.agpa-comp-progress li>span:first-child{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border:1px solid #444;border-radius:50%;flex-shrink:0}.agpa-comp-progress [data-state=done]{color:#59ca94}.agpa-comp-progress [data-state=current]{color:var(--foreground,#ddd)}.agpa-comp-progress [data-state=current]>span:first-child{border-color:#6eafff;background:#6eafff18}.agpa-comp-hero{display:grid;gap:8px;padding-top:8px}.agpa-comp-hero h3{font-size:17px}.agpa-comp-hero[data-ready=true] h3{color:#59ca94}.agpa-comp-hero p{color:var(--secondary-foreground,#999)}.agpa-comp-browser-choice{display:flex;align-items:center;gap:18px}.agpa-comp-browser-choice select{margin-left:auto;min-width:170px;background:var(--background,#171717)}.agpa-comp-access{display:grid;grid-template-columns:1fr 1fr;gap:12px}.agpa-comp-access>div,.agpa-comp-example{border:1px solid var(--border,#333);border-radius:10px;padding:16px;display:grid;gap:10px}.agpa-comp-example button{justify-self:start}.agpa-comp-help,.agpa-comp-advanced{font-size:12px}.agpa-comp-help summary,.agpa-comp-advanced summary{cursor:pointer;color:var(--secondary-foreground,#999)}.agpa-comp-help[open]>p{margin-top:12px}.agpa-comp-advanced{border-top:1px solid var(--border,#333);padding-top:16px}.agpa-comp-advanced[open]>*:not(summary){margin-top:14px}@media(max-width:600px){.agpa-comp-access{grid-template-columns:1fr}.agpa-comp-progress li{flex-direction:column;text-align:center}}
 `;
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
