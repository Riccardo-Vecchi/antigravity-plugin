"use strict";
const crypto = require("node:crypto");
const { connect } = require("./cdp-connection.cjs");
function externalURL(value) {
  if (typeof value !== "string" || value.length > 16384) return null;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.origin === "https://gemini.google.com"
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
const WORLD = 6732;
const PROOF_KEY = "__AGPA_LINK_OWNER_PROOF__";
// Popup observation does not enable popups or add native bindings to remote
// pages. A private-world challenge proves ownership via the app's scoped API;
// URL/title matches and numeric webContents IDs alone are never trusted.
function createGeminiLinks({
  nativeCall,
  endpoint,
  openExternal,
  report = () => {},
  connection = connect,
  fetchTargets,
}) {
  const base = new URL(endpoint);
  let active = null,
    stopped = false,
    syncing = false;
  function close() {
    active?.client.close();
    active = null;
  }
  async function isolated(guestId, code) {
    const expression = `(async()=>{const guest=document.querySelector('[data-agpa-gemini] webview');if(!guest||guest.getWebContentsId()!==${JSON.stringify(guestId)})return false;await globalThis.electronNative.executeJavaScriptInIsolatedWorld(${JSON.stringify(guestId)},${WORLD},${JSON.stringify(code)});return true})()`;
    const result = await nativeCall("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return !result.exceptionDetails && result.result?.value === true;
  }
  async function sync() {
    if (stopped || syncing) return;
    syncing = true;
    let guestId,
      proofSet = false;
    try {
      const result = await nativeCall("Runtime.evaluate", {
        expression:
          "(()=>{try{return document.querySelector('[data-agpa-gemini] webview')?.getWebContentsId()||null}catch{return null}})()",
        returnByValue: true,
      });
      guestId = result.result?.value;
      if (!Number.isSafeInteger(guestId) || guestId <= 0) {
        close();
        return;
      }
      if (active?.guestId === guestId) return;
      close();
      const proof = crypto.randomBytes(24).toString("hex");
      proofSet = await isolated(
        guestId,
        `globalThis.${PROOF_KEY}=${JSON.stringify(proof)};true`,
      );
      if (!proofSet || stopped) return;
      const targets = fetchTargets
        ? await fetchTargets()
        : await fetch(`http://127.0.0.1:${base.port}/json/list`, {
            signal: AbortSignal.timeout(2000),
          }).then((response) => response.json());
      for (const target of targets.slice(0, 64)) {
        if (stopped) return;
        if (!["webview", "iframe"].includes(target.type)) continue;
        let socket;
        try {
          socket = new URL(target.webSocketDebuggerUrl);
        } catch {
          continue;
        }
        if (
          socket.protocol !== "ws:" ||
          socket.hostname !== "127.0.0.1" ||
          socket.port !== base.port ||
          socket.username ||
          socket.password
        )
          continue;
        let accepted = false,
          client;
        const contexts = new Set();
        client = await connection(socket.href, {
          onEvent: (message) => {
            if (
              message.method === "Runtime.executionContextCreated" &&
              message.params?.context?.auxData?.isDefault === false
            )
              contexts.add(message.params.context.id);
            if (
              !accepted ||
              stopped ||
              active?.client !== client ||
              message.method !== "Page.windowOpen" ||
              message.params?.userGesture !== true
            )
              return;
            const url = externalURL(message.params.url);
            if (url)
              Promise.resolve()
                .then(() => {
                  if (!stopped && active?.client === client)
                    return openExternal(url);
                })
                .catch(report);
          },
          onClose: () => {
            if (active?.client === client) active = null;
          },
        });
        try {
          await client.call("Runtime.enable");
          let owned = false;
          for (const contextId of [...contexts].slice(0, 64)) {
            const check = await client.call("Runtime.evaluate", {
              expression: `globalThis.${PROOF_KEY}||null`,
              contextId,
              returnByValue: true,
            });
            if (check.result?.value === proof) {
              owned = true;
              break;
            }
          }
          await client.call("Runtime.disable");
          if (!owned || stopped) {
            client.close();
            continue;
          }
          active = { guestId, client };
          await client.call("Page.enable");
          accepted = true;
          return;
        } catch (error) {
          client.close();
          if (active?.client === client) active = null;
          report(error);
        }
      }
    } catch (error) {
      report(error);
    } finally {
      if (proofSet)
        await isolated(guestId, `delete globalThis.${PROOF_KEY}`).catch(
          () => {},
        );
      syncing = false;
    }
  }
  return {
    sync,
    close,
    destroy() {
      stopped = true;
      close();
    },
    status: () => ({ attached: !!active }),
  };
}
module.exports = { createGeminiLinks, externalURL };
