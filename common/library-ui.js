/* Artifact library layered over the native pane, preserving its conversation. */
(() => {
  "use strict";
  const VERSION = "1.0.1";
  globalThis.__AGLibrary?.destroy();
  const i18n = globalThis.__AGPAI18n;
  const createPicker = globalThis.__AGPA_LIBRARY_PICKER__;
  delete globalThis.__AGPA_LIBRARY_PICKER__;
  let bundle = globalThis.__AGPA_VIEWER_BUNDLE__;
  delete globalThis.__AGPA_VIEWER_BUNDLE__;
  let stopped = false,
    queued = false,
    button = null,
    panel = null,
    viewer = null,
    items = [],
    filter = "all",
    query = "",
    limit = 60,
    loading = false,
    requestGeneration = 0,
    previewGeneration = 0,
    opener = null,
    grid,
    empty,
    count,
    search,
    filterControl,
    observedPanel = null,
    observedRail = null,
    notice,
    thumbs = 0,
    thumbnailQueue = [],
    viewerCleanup = [];
  const pending = new Map(),
    listeners = [],
    objectURLs = new Set();
  const iconPaths = {
    library: "M4 4h5v16H4zM11 4h4v16h-4zM17 5l3-1 4 15-3 1z",
    images: "M3 3h18v18H3zM3 16l5-5 5 5 3-3 5 5M9 7h.01",
    documents: "M6 3h8l4 4v14H6zM13 3v5h5M9 12h6M9 16h6",
    spreadsheets: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
    presentations: "M3 3h18v14H3zM12 17v5M8 22l4-5 4 5",
    models: "M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10",
    interactive: "M3 3h18v18H3zM3 8h18M8 12l-3 3 3 3M16 12l3 3-3 3",
    pdf: "M6 3h8l4 4v14H6zM9 16h6M9 12h6",
    media: "M4 3h16v18H4zM10 9l6 3-6 3z",
    star: "m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z",
    close: "M6 6l12 12M6 18L18 6",
    refresh: "M21 4v6h-6M20 10a8 8 0 1 0 0 6",
    arrow: "M15 4l-8 8 8 8",
    folder: "M3 5h7l2 2h9v14H3z",
  };
  function icon(name, size = 20) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [k, v] of Object.entries({
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.6",
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
      "aria-hidden": "true",
    }))
      s.setAttribute(k, v);
    const p = document.createElementNS(s.namespaceURI, "path");
    p.setAttribute("d", iconPaths[name] || iconPaths.documents);
    s.append(p);
    return s;
  }
  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c) n.append(c);
    i18n.attrs(n, attrs);
    return n;
  }
  const on = (n, e, f, o) => {
    n.addEventListener(e, f, o);
    listeners.push(() => n.removeEventListener(e, f, o));
  };
  const styles = el("style", {
    id: "agpa-library-styles",
    text: `
 .agpa-library{position:fixed;inset:80px 0 0 256px;z-index:35;display:flex;flex-direction:column;background:var(--background,#111);color:var(--foreground,#eee);font:13px/1.5 system-ui,sans-serif;min-width:0}.agpa-library[hidden]{display:none!important}
 .agpa-library *{box-sizing:border-box}.agpa-library button,.agpa-library select,.agpa-library input{font:inherit}.agpa-library button{cursor:pointer}.agpa-library button:disabled{opacity:.5;cursor:wait}.agpa-library button:focus-visible,.agpa-library input:focus-visible,.agpa-library select:focus-visible{outline:2px solid #398bdb;outline-offset:2px}
 .agpa-library-header{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:22px 28px 12px}.agpa-library-header h1{font-size:23px;font-weight:500;margin:0;flex:1}.agpa-library-tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.agpa-library-tools input{width:210px;max-width:40vw;background:var(--secondary,#242424);color:inherit;border:1px solid var(--border,#393939);border-radius:20px;padding:7px 12px}.agpa-library button.agpa-lib-tool,.agpa-library select{border:1px solid var(--border,#3c3c3c);border-radius:8px;color:inherit;background:transparent;padding:7px 10px}.agpa-library .agpa-lib-icon{display:flex;align-items:center;justify-content:center;padding:7px!important;border:0!important}.agpa-lib-icon:hover,.agpa-library .agpa-lib-tool:hover{background:var(--secondary,#282828)}
 .agpa-library .agpa-browser-picker{margin-left:0}.agpa-library .agpa-browser-trigger{display:flex;align-items:center;gap:9px;min-width:170px;border:1px solid var(--border,#393939);border-radius:9px;padding:6px 10px;background:var(--background,#171717);color:var(--foreground,#ddd);text-align:left;cursor:pointer}.agpa-library .agpa-browser-icon{width:16px;height:16px;object-fit:contain;flex-shrink:0}.agpa-library .agpa-browser-arrow{margin-left:auto}.agpa-library .agpa-browser-popup{box-sizing:border-box;position:fixed;inset:auto;margin:0;padding:5px;overflow:auto;border:1px solid var(--border,#444);border-radius:10px;background:var(--background,#171717);color:var(--foreground,#ddd);font:13px/1.5 system-ui,sans-serif;box-shadow:0 10px 30px #0007}.agpa-library .agpa-browser-option{display:flex;align-items:center;gap:10px;min-height:36px;padding:0 10px;border-radius:6px;cursor:pointer}.agpa-library .agpa-browser-option:hover,.agpa-library .agpa-browser-option[data-active]{background:var(--secondary,#303030);color:var(--foreground,#eee)}.agpa-library .agpa-browser-check{margin-left:auto}.agpa-library .agpa-browser-trigger:focus-visible{outline:2px solid #398bdb;outline-offset:2px}
 .agpa-library-filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:0 28px 16px}.agpa-library-filters button{border:0;border-radius:20px;padding:6px 13px;color:var(--muted-foreground,#aaa);background:transparent}.agpa-library-filters button[aria-pressed=true]{color:var(--foreground,#eee);background:var(--secondary,#292929)}.agpa-library-count{margin-left:auto;color:var(--muted-foreground,#999);font-size:12px}
 .agpa-library-scroll{overflow:auto;flex:1;min-height:0;padding:4px 28px 25px}.agpa-library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:18px}.agpa-library-card{position:relative;min-width:0;border:1px solid var(--border,#303030);border-radius:13px;overflow:hidden;background:var(--card,#1c1c1c)}.agpa-library-open{width:100%;text-align:left;border:0;color:inherit;background:transparent;padding:0;display:flex;flex-direction:column;height:100%}.agpa-library-thumbnail{height:145px;background:var(--secondary,#202226);display:flex;align-items:center;justify-content:center;color:var(--muted-foreground,#a6b4c9);overflow:hidden;width:100%}.agpa-library-thumbnail>svg{width:44px;height:44px;opacity:.85}.agpa-library-thumbnail img{width:100%;height:100%;object-fit:contain}.agpa-library-caption{padding:11px 12px;min-width:0;width:100%}.agpa-library-caption strong{font-weight:500;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.agpa-library-caption small{color:var(--muted-foreground,#999);display:block;margin-top:4px}.agpa-library-favorite{position:absolute;right:7px;top:7px;border:0;border-radius:50%;width:29px;height:29px;display:flex;align-items:center;justify-content:center;color:#bbb;background:#171717d9}.agpa-library-favorite[aria-pressed=true]{color:#ffd35b}.agpa-library-favorite[aria-pressed=true] svg{fill:#ffd35b}
 .agpa-library-empty{padding:60px 20px;text-align:center;color:var(--muted-foreground,#aaa)}.agpa-library-empty h2{color:var(--foreground,#eee);font-size:17px;font-weight:500}.agpa-library-notice{margin:0 28px 12px;color:var(--muted-foreground,#aaa);font-size:12px}.agpa-library-notice:empty{display:none}.agpa-library-more{display:block;margin:20px auto 0}.agpa-library-preview{position:absolute;inset:0;background:var(--background,#111);display:flex;flex-direction:column;z-index:2}.agpa-library-preview header{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--border,#333)}.agpa-library-preview header strong{font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.agpa-library-preview iframe{width:100%;flex:1;border:0;background:#17191d}.agpa-library-preview-status{padding:12px 22px;color:var(--muted-foreground,#aaa)}.agpa-lib-spinner{display:inline-block;width:15px;height:15px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:agpa-library-spin .8s linear infinite;margin-right:8px;vertical-align:middle}@keyframes agpa-library-spin{to{transform:rotate(360deg)}}
 @media(max-width:600px){.agpa-library-header{padding:14px}.agpa-library-filters{padding:0 14px 12px}.agpa-library-scroll{padding:4px 14px 20px}.agpa-library-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}}
 `,
  });
  document.head.append(styles);
  function request(action, value) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID(),
        timer = setTimeout(() => {
          pending.delete(requestId);
          reject(Error("unavailable"));
        }, 20000);
      pending.set(requestId, { resolve, reject, timer });
      try {
        globalThis.__agpaLibrary(JSON.stringify({ requestId, action, value }));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(e);
      }
    });
  }
  function bounds() {
    if (!panel || panel.hidden) return;
    const { brand, panel: sidebar } = globalThis.__AGPAPrimaryLayout(document),
      rail = document.querySelector("[data-agpa-rail]");
    const top = Math.max(
      brand?.parentElement?.getBoundingClientRect().bottom || 0,
      document
        .querySelector("[data-testid=pane-titlebar-toolbar]")
        ?.parentElement?.getBoundingClientRect().bottom || 75,
    );
    const railRight = rail?.getBoundingClientRect().right || 0;
    const left = sidebar?.hasAttribute("data-agpa-hover-pane")
      ? railRight
      : Math.max(sidebar?.getBoundingClientRect().right || 0, railRight);
    panel.style.top = top + "px";
    panel.style.left = document.body.hasAttribute("data-agpa-layout-ready")
      ? "var(--agpa-navigation-width)"
      : left + "px";
  }
  function closePreview() {
    previewGeneration++;
    for (const f of viewerCleanup) f();
    viewerCleanup = [];
    viewer?.remove();
    viewer = null;
    for (const u of objectURLs) URL.revokeObjectURL(u);
    objectURLs.clear();
  }
  function close() {
    requestGeneration++;
    thumbnailQueue = [];
    filterControl?.close();
    if (panel) panel.hidden = true;
    closePreview();
    button?.removeAttribute("aria-current");
    if (opener?.isConnected) opener.focus();
  }
  function labels() {
    const t = (k) => i18n.t(k);
    return {
      failed: t(
        "Preview unavailable. Open the original file with its desktop app.",
      ),
      tooLarge: t("This file is too large for the built-in preview."),
      unsupported: t("This format opens in its desktop app."),
      externalModel: t(
        "This model needs external textures or buffers. Use a self-contained GLB for the built-in preview.",
      ),
      spreadsheet: t(
        "Read-only preview of saved cell values. Up to 1,000 rows and 100 columns per sheet; formulas are not recalculated.",
      ),
      slides: t(
        "Slide content preview. Original layouts, charts and animations may differ.",
      ),
      slide: t("Slide"),
      previous: t("Previous page"),
      next: t("Next page"),
      limited: t("Preview limited to the first 1,000 rows."),
    };
  }
  async function preview(item) {
    closePreview();
    const generation = previewGeneration;
    let selected = "";
    const discuss = el("button", {
      type: "button",
      class: "agpa-lib-tool",
      text: "Discuss selection",
      disabled: "",
    });
    discuss.onclick = () => {
      const editor = document.querySelector(
        "[contenteditable=true][role=combobox]",
      );
      if (!editor || !selected) return;
      const before = editor.textContent;
      editor.focus();
      const selection = window.getSelection();
      selection.selectAllChildren(editor);
      selection.collapseToEnd();
      const data = new DataTransfer();
      data.setData(
        "text/plain",
        `${before ? "\n\n" : ""}File: ${item.path}\n\n${selected}\n\n`,
      );
      editor.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
      queueMicrotask(() => {
        if (editor.textContent !== before) {
          close();
          editor.focus();
        } else {
          if (!status.isConnected) viewer.append(status);
          i18n.set(
            status,
            "Copy the selected passage and paste it into the chat.",
          );
        }
      });
    };
    const back = el(
      "button",
      {
        type: "button",
        class: "agpa-lib-tool agpa-lib-icon",
        "aria-label": "Back to Library",
      },
      icon("arrow"),
    );
    const reveal = el("button", {
      type: "button",
      class: "agpa-lib-tool",
      text: "Show in folder",
    });
    reveal.onclick = () =>
      globalThis.electronNative?.revealInFilePicker(item.path);
    const conversation = el("button", {
      type: "button",
      class: "agpa-lib-tool",
      text: "Open conversation",
    });
    conversation.hidden = !item.conversationId;
    conversation.onclick = () => {
      const link = el("a", { href: "/c/" + item.conversationId });
      document.body.append(link);
      link.click();
      link.remove();
      close();
    };
    const status = el(
      "div",
      { class: "agpa-library-preview-status", role: "status" },
      el("span", { class: "agpa-lib-spinner", "aria-hidden": "true" }),
      el("span", { text: "Loading preview…" }),
    );
    const remove = el("button", {
      type: "button",
      class: "agpa-lib-tool",
      text: "Remove from Library",
    });
    remove.hidden = item.source !== "added";
    remove.onclick = async () => {
      remove.disabled = true;
      try {
        const result = await request("remove", item.id);
        items = result.items;
        closePreview();
        paint();
      } catch {
        remove.disabled = false;
      }
    };
    viewer = el(
      "section",
      { class: "agpa-library-preview", "aria-label": "Artifact preview" },
      el(
        "header",
        {},
        back,
        el("strong", { text: item.name }),
        discuss,
        conversation,
        reveal,
        remove,
      ),
      status,
    );
    panel.append(viewer);
    back.onclick = closePreview;
    try {
      const payload = await request("preview", item.id);
      if (generation !== previewGeneration || !viewer) return;
      const frame = el("iframe", {
        sandbox: "allow-scripts",
        "aria-label": item.name,
        referrerpolicy: "no-referrer",
      });
      viewer.append(frame);
      if (["html", "htm"].includes(item.extension)) {
        const content = new TextDecoder().decode(
          Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0)),
        );
        const policy =
          "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
        const load = (policy) => {
          frame.srcdoc =
            `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">` +
            content;
        };
        load(policy);
        i18n.set(
          status,
          "Interactive preview runs locally. External resources are blocked.",
        );
        if (/https?:\/\//i.test(content)) {
          const online = el("button", {
            type: "button",
            class: "agpa-lib-tool",
            text: "Allow online resources",
          });
          viewer.querySelector("header").insertBefore(online, reveal);
          online.onclick = () => {
            load(
              "default-src 'none'; script-src https: 'unsafe-inline' 'unsafe-eval' data: blob:; style-src https: 'unsafe-inline'; img-src https: data: blob:; font-src https: data:; connect-src https: data: blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
            );
            online.remove();
            i18n.set(status, "Online resources enabled for this preview.");
          };
        }
        return;
      }
      const nonce = crypto.randomUUID().replaceAll("-", ""),
        channel = new MessageChannel();
      const timeout = setTimeout(() => {
        if (generation === previewGeneration && status.isConnected)
          i18n.set(
            status,
            "Preview unavailable. Open the original file with its desktop app.",
          );
      }, 20000);
      viewerCleanup.push(() => {
        clearTimeout(timeout);
        channel.port1.close();
        channel.port2.close();
      });
      frame.addEventListener(
        "load",
        () => {
          if (generation !== previewGeneration) {
            channel.port1.close();
            channel.port2.close();
            return;
          }
          frame.contentWindow.postMessage(
            { kind: "agpa-preview", payload, labels: labels() },
            "*",
            [channel.port2],
          );
        },
        { once: true },
      );
      channel.port1.onmessage = (event) => {
        if (generation !== previewGeneration) {
          channel.port1.close();
          return;
        }
        if (typeof event.data.selection === "string") {
          selected = event.data.selection.slice(0, 12000);
          discuss.disabled = !selected.trim();
          return;
        }
        clearTimeout(timeout);
        if (status.isConnected) {
          if (event.data.ok) status.remove();
          else
            i18n.set(
              status,
              "Preview unavailable. Open the original file with its desktop app.",
            );
        }
      };
      const csp = `default-src 'none'; script-src 'nonce-${nonce}' blob: data: 'wasm-unsafe-eval'; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; frame-src blob:; object-src blob:; connect-src data: blob:; base-uri 'none'; form-action 'none'`;
      frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;height:100%;background:#17191d;color:#e6e6e6;font:14px/1.6 system-ui}#preview{min-height:100%;box-sizing:border-box;padding:22px}#preview.model{padding:0;height:100%;min-height:0;overflow:hidden}.model canvas{display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.image{display:block;max-width:100%;max-height:90vh;object-fit:contain;margin:auto}.pdf{width:100%;height:calc(100vh - 50px);border:0}video{max-width:100%;max-height:85vh}table{border-collapse:collapse;background:#fff;color:#222;font:13px system-ui}td,th{border:1px solid #ddd;padding:5px 9px;max-width:400px;white-space:pre-wrap;overflow-wrap:anywhere;min-width:65px}.sheet-wrap{overflow:auto;max-height:80vh}.tabs{display:flex;gap:8px;margin-bottom:12px}.tabs button{background:#292b30;color:inherit;border:1px solid #555;padding:6px 12px;border-radius:7px;cursor:pointer}.tabs button[aria-pressed=true]{border-color:#67acff}.note{font-size:12px;color:#adb4c0}.slide{background:#fff;color:#222;padding:28px;margin:20px auto;border-radius:4px;max-width:1000px}.slide img{max-width:100%;max-height:400px}.docx-wrapper{background:transparent!important;padding:0!important}.markdown{max-width:1000px;margin:auto}.markdown h1,.markdown h2{line-height:1.3}.markdown code{background:#292d36;padding:2px 5px;border-radius:4px}.markdown img{max-width:100%}section.docx{box-shadow:none!important;margin:0 auto 24px!important;max-width:100%}a{color:inherit;pointer-events:none}</style></head><body><main id="preview"></main><script nonce="${nonce}">${bundle.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
    } catch (e) {
      if (generation === previewGeneration && status.isConnected)
        i18n.set(
          status,
          e.message === "tooLarge"
            ? "This file is too large for the built-in preview."
            : "Preview unavailable. Open the original file with its desktop app.",
        );
    }
  }
  const size = (n) =>
    n < 1024
      ? n + " B"
      : n < 1048576
        ? (n / 1024).toFixed(0) + " KB"
        : (n / 1048576).toFixed(1) + " MB";
  function thumbnail(item, holder, generation) {
    if (
      item.category !== "images" ||
      item.extension === "svg" ||
      item.size > 512 * 1024
    )
      return;
    thumbnailQueue.push({ item, holder, generation });
    pumpThumbnails();
  }
  function pumpThumbnails() {
    while (thumbs < 4 && thumbnailQueue.length) {
      const { item, holder, generation } = thumbnailQueue.shift();
      if (stopped || panel?.hidden || generation !== requestGeneration)
        continue;
      thumbs++;
      request("thumbnail", item.id)
        .then((data) => {
          if (
            generation !== requestGeneration ||
            !holder.isConnected ||
            panel?.hidden
          )
            return;
          const mime = item.extension === "jpg" ? "jpeg" : item.extension;
          holder.replaceChildren(
            el("img", {
              src: `data:image/${mime};base64,${data.data}`,
              alt: "",
              loading: "lazy",
            }),
          );
        })
        .catch(() => {})
        .finally(() => {
          thumbs--;
          pumpThumbnails();
        });
    }
  }
  function paint() {
    if (!panel || panel.hidden) return;
    requestGeneration++;
    thumbnailQueue = [];
    const generation = requestGeneration;
    const filtered = items.filter(
      (i) =>
        (filter === "all" ||
          (filter === "favorites" && i.favorite) ||
          filter === i.category) &&
        (!query ||
          [i.name, i.summary].some((v) =>
            v?.toLocaleLowerCase().includes(query),
          )),
    );
    grid.replaceChildren();
    count.textContent = String(filtered.length);
    empty.hidden = filtered.length > 0 || loading;
    const fragment = document.createDocumentFragment();
    for (const item of filtered.slice(0, limit)) {
      const holder = el(
        "div",
        { class: "agpa-library-thumbnail" },
        icon(item.category),
      );
      const open = el(
        "button",
        { type: "button", class: "agpa-library-open", title: item.name },
        holder,
        el(
          "div",
          { class: "agpa-library-caption" },
          el("strong", { text: item.name }),
          el("small", {
            text:
              item.extension.toUpperCase() +
              " · " +
              size(item.size) +
              " · " +
              new Date(item.modified).toLocaleDateString(i18n.language),
          }),
        ),
      );
      open.onclick = () => preview(item);
      const favorite = el(
        "button",
        {
          type: "button",
          class: "agpa-library-favorite",
          "aria-pressed": String(item.favorite),
          "aria-label": "Favorite",
        },
        icon("star", 16),
      );
      favorite.onclick = async () => {
        favorite.disabled = true;
        try {
          const data = await request("favorite", {
            id: item.id,
            value: !item.favorite,
          });
          items = data.items;
          paint();
          (
            grid.querySelector(
              `[data-agpa-library-id="${item.id}"] .agpa-library-favorite`,
            ) || search
          ).focus();
        } catch {
          favorite.disabled = false;
        }
      };
      fragment.append(
        el(
          "article",
          { class: "agpa-library-card", "data-agpa-library-id": item.id },
          open,
          favorite,
        ),
      );
      thumbnail(item, holder, generation);
    }
    grid.append(fragment);
    panel.querySelector("[data-agpa-library-more]").hidden =
      filtered.length <= limit;
    for (const b of panel.querySelectorAll("[data-agpa-library-filter]"))
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.agpaLibraryFilter === filter),
      );
    filterControl.setValue(
      ["all", "favorites"].includes(filter) ? "all" : filter,
    );
  }
  async function refresh(force = false) {
    if (loading) return;
    loading = true;
    const refreshButton = panel.querySelector("[data-agpa-library-refresh]");
    refreshButton.disabled = true;
    i18n.set(notice, "Finding artifacts…");
    try {
      const data = await request(force ? "refresh" : "list", true);
      items = data.items;
      i18n.set(
        notice,
        data.truncated
          ? "Some older or very large conversations could not be indexed. Add missing files with Add files."
          : data.unavailable
            ? "No local Antigravity artifact folder was found. You can still add files."
            : "",
      );
    } catch {
      i18n.set(notice, "Could not load Library. Try Refresh.");
    } finally {
      loading = false;
      refreshButton.disabled = false;
      paint();
    }
  }
  const fileTypes = [
    ["all", "All file types"],
    ["images", "Images"],
    ["documents", "Documents"],
    ["spreadsheets", "Spreadsheets"],
    ["presentations", "Presentations"],
    ["pdf", "PDFs"],
    ["models", "3D models"],
    ["interactive", "Interactive"],
    ["media", "Audio and video"],
  ];
  function makeFilter() {
    const icons = Object.fromEntries(
      fileTypes.map(([id]) => [
        id,
        "data:image/svg+xml," +
          encodeURIComponent(
            icon(id === "all" ? "library" : id, 16)
              .outerHTML.replace(
                "<svg",
                '<svg xmlns="http://www.w3.org/2000/svg"',
              )
              .replace('stroke="currentColor"', 'stroke="#aaa"'),
          ),
      ]),
    );
    return createPicker({
      items: fileTypes.map(([id, key]) => ({ id, label: i18n.t(key) })),
      value: ["all", "favorites"].includes(filter) ? "all" : filter,
      icons,
      label: i18n.t("File type"),
      onChange: (value) => {
        filter = value;
        limit = 60;
        paint();
      },
    });
  }
  const resizeObserver = new ResizeObserver(bounds);
  function observeLayout() {
    const next = globalThis.__AGPAPrimaryLayout(document).panel,
      rail = document.querySelector("[data-agpa-rail]");
    if (next !== observedPanel) {
      if (observedPanel) resizeObserver.unobserve(observedPanel);
      observedPanel = next;
      if (next) resizeObserver.observe(next);
    }
    if (rail !== observedRail) {
      if (observedRail) resizeObserver.unobserve(observedRail);
      observedRail = rail;
      if (rail) resizeObserver.observe(rail);
    }
  }
  function create() {
    search = el("input", {
      type: "search",
      placeholder: "Search Library",
      "aria-label": "Search Library",
    });
    search.oninput = () => {
      query = search.value.toLocaleLowerCase().trim();
      limit = 60;
      paint();
    };
    const add = el("button", {
        type: "button",
        class: "agpa-lib-tool",
        text: "Add files",
      }),
      input = el("input", {
        type: "file",
        multiple: "",
        hidden: "",
        accept:
          ".png,.jpg,.jpeg,.webp,.gif,.avif,.bmp,.svg,.docx,.odt,.rtf,.md,.txt,.tex,.xlsx,.ods,.csv,.tsv,.pptx,.odp,.pdf,.glb,.gltf,.stl,.obj,.ply,.html,.htm,.mp4,.webm,.mp3,.wav,.ogg,.m4a",
      });
    add.onclick = () => input.click();
    input.onchange = async () => {
      try {
        const paths = await Promise.all(
          [...input.files].map((f) =>
            globalThis.electronNative?.getPathForFile(f),
          ),
        );
        const data = await request("add", paths);
        items = data.items;
        paint();
      } catch {
        i18n.set(
          notice,
          "Could not add these files. Choose supported local files.",
        );
      } finally {
        input.value = "";
      }
    };
    const refreshButton = el(
      "button",
      {
        type: "button",
        class: "agpa-lib-tool agpa-lib-icon",
        "aria-label": "Refresh Library",
        "data-agpa-library-refresh": "",
      },
      icon("refresh"),
    );
    refreshButton.onclick = () => refresh(true);
    const dismiss = el(
      "button",
      {
        type: "button",
        class: "agpa-lib-tool agpa-lib-icon",
        "aria-label": "Close Library",
      },
      icon("close"),
    );
    dismiss.onclick = close;
    const filters = el("div", { class: "agpa-library-filters" });
    for (const [value, key] of [
      ["all", "All"],
      ["favorites", "Favorites"],
    ]) {
      const b = el("button", {
        type: "button",
        "data-agpa-library-filter": value,
        text: key,
      });
      b.onclick = () => {
        filter = value;
        limit = 60;
        paint();
      };
      filters.append(b);
    }
    filterControl = makeFilter();
    count = el("span", { class: "agpa-library-count" });
    filters.append(filterControl, count);
    grid = el("div", { class: "agpa-library-grid" });
    empty = el(
      "div",
      { class: "agpa-library-empty" },
      icon("library", 40),
      el("h2", { text: "Your creations, together" }),
      el("p", {
        text: "Artifacts saved by Antigravity appear here. Add other files whenever you need them.",
      }),
    );
    notice = el("p", {
      class: "agpa-library-notice",
      role: "status",
      "aria-live": "polite",
    });
    const more = el("button", {
      type: "button",
      class: "agpa-lib-tool agpa-library-more",
      "data-agpa-library-more": "",
      text: "Show more",
      hidden: "",
    });
    more.onclick = () => {
      limit += 60;
      paint();
    };
    panel = el(
      "section",
      {
        class: "agpa-library",
        "data-agpa-library": "",
        "aria-label": "Library",
        hidden: "",
      },
      el(
        "header",
        { class: "agpa-library-header" },
        el("h1", { text: "Library" }),
        el(
          "div",
          { class: "agpa-library-tools" },
          search,
          add,
          input,
          refreshButton,
          dismiss,
        ),
      ),
      filters,
      notice,
      el("div", { class: "agpa-library-scroll" }, grid, empty, more),
    );
    document.body.append(panel);
  }
  function open() {
    opener = document.activeElement;
    if (!panel) create();
    panel.hidden = false;
    button?.setAttribute("aria-current", "page");
    bounds();
    paint();
    refresh();
    search.focus();
  }
  function apply() {
    if (stopped) return;
    observeLayout();
    const source = document.querySelector("[data-testid=automations-button]");
    if (source) {
      if (!button) {
        button = el(
          "button",
          {
            type: "button",
            class: source.className,
            "data-testid": "agpa-library-button",
          },
          el(
            "span",
            { class: "shrink-0 flex items-center" },
            icon("library", 16),
          ),
          el("span", { class: "truncate text-sm", text: "Library" }),
        );
        button.onclick = open;
      }
      if (source.nextElementSibling !== button) source.after(button);
    }
    bounds();
  }
  const schedule = () => {
    if (queued || stopped) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      apply();
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-expanded"],
  });
  on(window, "resize", bounds);
  on(
    document,
    "click",
    (e) => {
      if (!panel || panel.hidden) return;
      const n = e.target.closest(
        "a,[data-testid=automations-button],[data-testid=history-button]",
      );
      if (n && !panel.contains(n) && !n.closest("[data-agpa-rail]")) close();
    },
    true,
  );
  on(
    document,
    "keydown",
    (e) => {
      if (
        e.key === "Escape" &&
        panel &&
        !panel.hidden &&
        !document.querySelector("dialog[open],[role=dialog]")
      ) {
        const popup = panel.querySelector("[popover]:popover-open");
        if (popup) {
          e.preventDefault();
          e.stopPropagation();
          filterControl.close();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        viewer ? closePreview() : close();
      }
    },
    true,
  );
  const unsubscribe = i18n.subscribe(() => {
    if (filterControl) {
      filterControl.close();
      const next = makeFilter();
      filterControl.replaceWith(next);
      filterControl = next;
    }
    if (panel && !panel.hidden) paint();
  });
  globalThis.__AGLibrary = {
    version: VERSION,
    open,
    close,
    onResult(id, ok, result) {
      const p = pending.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(id);
      ok ? p.resolve(result) : p.reject(Error(result?.error || "unavailable"));
    },
    status: () => ({
      visible: !!panel && !panel.hidden,
      count: items.length,
      preview: !!viewer,
    }),
    destroy() {
      stopped = true;
      requestGeneration++;
      observer.disconnect();
      resizeObserver.disconnect();
      filterControl?.close();
      unsubscribe();
      for (const fn of listeners) fn();
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error("unavailable"));
      }
      pending.clear();
      closePreview();
      button?.remove();
      panel?.remove();
      styles.remove();
      bundle = null;
      delete globalThis.__AGLibrary;
    },
  };
  apply();
})();
