"use strict";
importScripts("policy.js");
const HOST = "com.antigravity_plugin.browser";
let port,
  identity,
  ready = false,
  connecting = false,
  retry,
  paused = false,
  scope = "tabs",
  scopeEpoch = 0;
const excluded = new Set();
const grants = new Map(),
  queues = new Map();
async function profile() {
  if (identity) return identity;
  const saved = await chrome.storage.local.get(["profileId", "profileLabel"]);
  identity = {
    id: saved.profileId || crypto.randomUUID(),
    label: saved.profileLabel || "Browser",
  };
  await chrome.storage.local.set({
    profileId: identity.id,
    profileLabel: identity.label,
  });
  return identity;
}
function post(message) {
  if (!ready)
    throw Error("Open Antigravity and enable Browser use in Settings.");
  port.postMessage(message);
}
async function tabInfo(id) {
  const tab = await chrome.tabs.get(id);
  if (tab.url) return tab;
  const target = (await chrome.debugger.getTargets()).find(
    (t) => t.tabId === id,
  );
  return { ...tab, url: target?.url, title: target?.title || tab.title };
}
async function announceTabs() {
  if (!ready) return;
  const tabs = [];
  for (const [id, g] of grants) {
    try {
      const tab = await tabInfo(id);
      const origin=AGPApolicy.origin(tab.url);
      if (origin !== g.origin) {
        if(scope !== "profile") {await revoke(id);continue;}
        g.origin=origin;g.snapshot=null;g.refs.clear();
      }
      tabs.push({ id, title: tab.title || "", url: tab.url });
    } catch {
      await revoke(id);
    }
  }
  try {
    post({ action: "tabs", value: tabs });
  } catch {}
}
async function revoke(id) {
  if (!grants.has(id)) return;
  grants.delete(id);
  try {
    await chrome.debugger.detach({ tabId: id });
  } catch {}
  chrome.action.setBadgeText({ tabId: id, text: "" }).catch(() => {});
}
async function revokeAll() {
  scope="tabs";scopeEpoch++;excluded.clear();
  for (const id of [...grants.keys()]) await revoke(id);
}
async function connect() {
  if (connecting || port) return;
  connecting = true;
  try {
    const p = chrome.runtime.connectNative(HOST);
    port = p;
    ready = false;
    p.onMessage.addListener((message) => {
      if (message.reply === "announce") {
        if (message.error) {
          ready = false;
          revokeAll();
          return;
        }
        ready = true;
        announceTabs();
        return;
      }
      if (message.action === "revoke" || message.action === "disconnected") {
        ready = false;
        if (message.action === "revoke") paused = true;
        revokeAll();
        return;
      }
      if (message.action === "execute" && message.id) {
        const args = message.value?.args || {},
          id = args.tab;
        const task = (queues.get(id) || Promise.resolve())
          .catch(() => {})
          .then(() => execute(message.value.tool, args));
        queues.set(id, task);
        task
          .then(
            (result) => {
              if (port === p) p.postMessage({ reply: message.id, result });
            },
            (e) => {
              if (port === p)
                p.postMessage({
                  reply: message.id,
                  error: e.message || "Browser action failed.",
                });
            },
          )
          .finally(() => {
            if (queues.get(id) === task) queues.delete(id);
          });
      }
    });
    p.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port !== p) return;
      port = null;
      ready = false;
      revokeAll();
      clearTimeout(retry);
      if (!paused) retry = setTimeout(connect, 15000);
    });
    p.postMessage({
      id: "announce",
      action: "announce",
      value: await profile(),
    });
  } catch {
    port = null;
  } finally {
    connecting = false;
  }
}
async function shareCurrent() {
  if (!ready)
    throw Error("Open Antigravity and enable Browser use in Settings.");
  const [selected] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!selected || selected.incognito)
    throw Error("Private browsing tabs are excluded.");
  const tab = await tabInfo(selected.id);
  const origin = AGPApolicy.origin(tab.url);
  if (grants.has(tab.id)) return;
  const grant={origin, snapshot:null, refs:new Map(),attached:false};
  grants.set(tab.id,grant);
  await attachGrant(tab.id,grant);
  await announceTabs();
}
async function attachGrant(id,g) {
  if(g.attached)return;
  try {
  await chrome.debugger.attach({tabId:id},"1.3");
  if(!ready||grants.get(id)!==g){await chrome.debugger.detach({tabId:id}).catch(()=>{});throw Error("Browser access was revoked.");}
  g.attached=true;
    await chrome.debugger.sendCommand({tabId:id},"Page.enable");
    await chrome.debugger.sendCommand({tabId:id},"Accessibility.enable");
    await chrome.action.setBadgeBackgroundColor({tabId:id,color:"#197446"});
    await chrome.action.setBadgeText({tabId:id,text:"ON"});
  } catch(e){await revoke(id);throw e;}
}
async function syncProfile() {
  if(scope!=="profile"||!ready)return;
  const epoch=scopeEpoch;
  const tabs=await chrome.tabs.query({});
  if(scope!=="profile"||!ready||epoch!==scopeEpoch)return;
  for(const tab of tabs){
    if(tab.incognito||excluded.has(tab.id))continue;
    let origin;
    try{origin=AGPApolicy.origin(tab.url);}catch{await revoke(tab.id);continue;}
    if(scope!=="profile"||!ready||epoch!==scopeEpoch)return;
    const g=grants.get(tab.id);
    if(!g)grants.set(tab.id,{origin,snapshot:null,refs:new Map(),attached:false});
    else if(g.origin!==origin){g.origin=origin;g.snapshot=null;g.refs.clear();}
  }
  await announceTabs();
}
async function setScope(next) {
  if(!["tabs","profile"].includes(next))throw Error("Invalid sharing mode.");
  if(!ready)throw Error("Open Antigravity and enable Browser use in Settings.");
  if(next==="profile"&&!await chrome.permissions.contains({permissions:["tabs"]}))throw Error("Allow access to all tabs in your browser first.");
  await revokeAll();
  scope=next;
  if(scope==="profile")await syncProfile();
  else await announceTabs();
}

async function execute(tool, args) {
  const id = args.tab,
    g = grants.get(id);
  if (!g || !ready) throw Error("Share this tab using the extension first.");
  const current = await tabInfo(id);
  if (current.incognito) throw Error("Private browsing tabs are excluded.");
  const origin=AGPApolicy.origin(current.url);
  if (origin !== g.origin && scope === "profile") {g.origin=origin;g.snapshot=null;g.refs.clear();}
  if (origin !== g.origin) {
    await revoke(id);
    await announceTabs();
    throw Error("The site changed. Share the tab again.");
  }
  await attachGrant(id,g);
  async function command(method, params = {}) {
    if (!ready || grants.get(id) !== g)
      throw Error("Browser access was revoked.");
    return chrome.debugger.sendCommand({ tabId: id }, method, params);
  }
  if (tool === "browser_snapshot") {
    const { nodes } = await command("Accessibility.getFullAXTree");
    const snapshot = crypto.randomUUID(),
      refs = new Map(),
      rows = [];
    let characters = 0;
    for (const node of nodes) {
      if (node.ignored) continue;
      const role = String(node.role?.value || ""),
        name = String(node.name?.value || "").slice(0, 500);
      const protectedField = node.properties?.some(
        (p) => p.name === "protected" && p.value?.value === true,
      );
      const value = protectedField
        ? "[protected]"
        : String(node.value?.value ?? "").slice(0, 500);
      if (
        !name &&
        !value &&
        !/button|link|textbox|combobox|checkbox|radio/.test(role)
      )
        continue;
      const ref = "e" + (rows.length + 1);
      if (node.backendDOMNodeId) refs.set(ref, node.backendDOMNodeId);
      const row = { ref, role, name, ...(value ? { value } : {}) };
      characters += JSON.stringify(row).length;
      if (characters > 100000 || rows.length >= 1200) break;
      rows.push(row);
    }
    if (grants.get(id) !== g) throw Error("Access changed.");
    g.snapshot = snapshot;
    g.refs = refs;
    return {
      snapshot,
      url: current.url,
      elements: rows,
      truncated: rows.length >= 1200 || characters > 100000,
    };
  }
  if (["browser_click", "browser_type"].includes(tool)) {
    if (args.snapshot !== g.snapshot || !g.refs.has(args.ref))
      throw Error("Take a new snapshot before using this element.");
    const backendNodeId = g.refs.get(args.ref);
    if (tool === "browser_type") {
      const { node } = await command("DOM.describeNode", { backendNodeId });
      AGPApolicy.editable(node);
      await command("DOM.focus", { backendNodeId });
      if (args.clear !== false) {
        await command("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "a",
          code: "KeyA",
          modifiers: 2,
          windowsVirtualKeyCode: 65,
        });
        await command("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "a",
          code: "KeyA",
          modifiers: 2,
          windowsVirtualKeyCode: 65,
        });
      }
      await command("Input.insertText", { text: args.text });
      return { typed: true };
    }
    await command("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const { model } = await command("DOM.getBoxModel", { backendNodeId });
    const q = model.content,
      x = (q[0] + q[2] + q[4] + q[6]) / 4,
      y = (q[1] + q[3] + q[5] + q[7]) / 4;
    const metrics = await command("Page.getLayoutMetrics");
    const v = metrics.cssVisualViewport;
    if (x < 0 || y < 0 || x > v.clientWidth || y > v.clientHeight)
      throw Error(
        "Element is outside the viewport. Scroll and take a new snapshot.",
      );
    await command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    return { clicked: true };
  }
  if (tool === "browser_press_key") {
    const codes = {
      Enter: 13,
      Tab: 9,
      Escape: 27,
      ArrowDown: 40,
      ArrowUp: 38,
      ArrowLeft: 37,
      ArrowRight: 39,
      Backspace: 8,
      Space: 32,
    };
    if (!Object.hasOwn(codes, args.key)) throw Error("Unsupported key.");
    if (!["Tab", "Escape"].includes(args.key)) {
      const { root } = await command("DOM.getDocument", { depth: 0 });
      const focused = await command("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: ":focus",
      });
      if (focused.nodeId) {
        const { node } = await command("DOM.describeNode", {
          nodeId: focused.nodeId,
        });
        const attributes = node.attributes || [];
        const typeIndex = attributes.indexOf("type");
        const autocompleteIndex = attributes.indexOf("autocomplete");
        if (
          node.nodeName === "INPUT" &&
          ((typeIndex >= 0 &&
            attributes[typeIndex + 1]?.toLowerCase() === "password") ||
            (autocompleteIndex >= 0 &&
              /password|one-time-code/i.test(
                attributes[autocompleteIndex + 1] || "",
              )))
        )
          throw Error(
            "This field is excluded. Enter passwords directly in your browser.",
          );
      }
    }
    const key = args.key === "Space" ? " " : args.key;
    const base = {
      key,
      code: args.key,
      windowsVirtualKeyCode: codes[args.key],
    };
    await command("Input.dispatchKeyEvent", {
      type: "keyDown",
      ...base,
      ...(args.key === "Enter"
        ? { text: "\r" }
        : args.key === "Space"
          ? { text: " " }
          : {}),
    });
    await command("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    return { pressed: args.key };
  }
  if (tool === "browser_scroll") {
    await command("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 100,
      y: 100,
      deltaX: args.x || 0,
      deltaY: args.y,
    });
    return { scrolled: true };
  }
  if (tool === "browser_navigate") {
    if (AGPApolicy.origin(args.url) !== g.origin && scope !== "profile")
      throw Error("Open and share a tab on the new site first.");
    g.snapshot = null;
    g.refs.clear();
    await command("Page.navigate", { url: args.url });
    return { navigating: true };
  }
  if (tool === "browser_screenshot") {
    const m = await command("Page.getLayoutMetrics"),
      v = m.cssVisualViewport;
    const result = await command("Page.captureScreenshot", {
      format: "jpeg",
      quality: 65,
      captureBeyondViewport: false,
      clip: {
        x: v.pageX,
        y: v.pageY,
        width: v.clientWidth,
        height: v.clientHeight,
        scale: Math.min(1, 1280 / v.clientWidth, 900 / v.clientHeight),
      },
    });
    if (result.data.length > 6 * 1024 * 1024)
      throw Error("Screenshot too large.");
    return { image: result.data };
  }
  throw Error("Unsupported browser tool.");
}
async function uiState() {
  const shared = [];
  for (const id of grants.keys()) {
    try {
      const tab = await tabInfo(id);
      shared.push({ id, title: tab.title || "" });
    } catch {}
  }
  const [selected] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  let current = null;
  if (selected && !selected.incognito) {
    try {
      const tab = await tabInfo(selected.id);
      AGPApolicy.origin(tab.url);
      current = {
        id: tab.id,
        title: tab.title || "",
        shared: grants.has(tab.id),
      };
    } catch {}
  }
  return { ready, profile: await profile(), shared, current, scope };
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("popup.html")
  )
    return;
  const job = (async () => {
    if (m.action === "status") return uiState();
    if (m.action === "connect") {
      paused = false;
      await connect();
      return uiState();
    }
    if (m.action === "scope") await setScope(m.scope);
    else if (m.action === "share") await shareCurrent();
    else if (m.action === "revoke") {
      if(scope==="profile")excluded.add(m.tab);
      await revoke(m.tab);
      await announceTabs();
    } else if (m.action === "revokeAll") {
      await revokeAll();
      await announceTabs();
    } else if (m.action === "label") {
      const label = String(m.label || "")
        .trim()
        .slice(0, 60);
      if (!label || /[\x00-\x1f]/.test(label))
        throw Error("Choose a profile name.");
      if (label === (await profile()).label) return uiState();
      await chrome.storage.local.set({ profileLabel: label });
      identity = { ...(await profile()), label };
      if (port && ready) post({ action: "rename", value: label });
    } else if (m.action !== "status" && m.action !== "connect")
      throw Error("Unknown extension action.");
    return uiState();
  })();
  job.then(
    (result) => respond({ ok: true, result }),
    (e) => respond({ ok: false, error: e.message }),
  );
  return true;
});
chrome.debugger.onDetach.addListener((source,reason) => {
  if(reason==="canceled_by_user"){revokeAll().then(announceTabs);return;}
  if(scope==="profile"&&grants.get(source.tabId)?.attached)excluded.add(source.tabId);
  if (grants.has(source.tabId)) {
    grants.delete(source.tabId);
    chrome.action
      .setBadgeText({ tabId: source.tabId, text: "" })
      .catch(() => {});
    announceTabs();
  }
});
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== "Page.frameNavigated" || params.frame.parentId) return;
  const g = grants.get(source.tabId);
  if (!g) return;
  g.snapshot = null;
  g.refs.clear();
  try {
    const origin=AGPApolicy.origin(params.frame.url);
    if(scope==="profile"){g.origin=origin;announceTabs();}
    else if (origin !== g.origin)
      revoke(source.tabId).then(announceTabs);
    else announceTabs();
  } catch {
    revoke(source.tabId).then(announceTabs);
  }
});
chrome.tabs.onCreated.addListener(() => {syncProfile().catch(()=>{});});
chrome.tabs.onUpdated.addListener((id,change) => {if(change.url||change.status==="complete")syncProfile().catch(()=>{});});
chrome.permissions.onRemoved.addListener(p => {if(p.permissions?.includes("tabs")&&scope==="profile")revokeAll().then(announceTabs);});
chrome.tabs.onRemoved.addListener((id) => {
  excluded.delete(id);
  if (grants.delete(id)) announceTabs();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
