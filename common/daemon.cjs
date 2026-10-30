#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const BASE = __dirname;
const { connect } = require("./cdp-connection.cjs");
const diagnostic = require("./diagnostics.cjs").createDiagnostics();
const legacyBootstrap =
  path.resolve(BASE, "..") ===
  require("./platform-paths.cjs").getLegacyPaths().installDir;
if (legacyBootstrap) process.env.AGPA_LEGACY_RUNTIME = "1";
const { iconPath } = require("./icon-path.cjs");
const platformPaths = require("./platform-paths.cjs").getPaths();
const CONFIG_DIR = platformPaths.configDir;
const CONFIG_PATH = path.join(CONFIG_DIR, "projects.json");
const PORT_PATH = path.join(platformPaths.profileDir, "DevToolsActivePort");
const RENDERER = fs.readFileSync(path.join(BASE, "renderer.js"), "utf8");
const HEADER_PLACEMENT = fs.readFileSync(
  path.join(BASE, "header-placement.js"),
  "utf8",
);
const SWITCH = fs.readFileSync(path.join(BASE, "gemini-switch.js"), "utf8");
const shortcutRules = require("./shortcut-config.cjs");
const SHORTCUTS = fs.readFileSync(path.join(BASE, "shortcuts.js"), "utf8");
const SWITCH_CSS = fs.readFileSync(
  path.join(BASE, "gemini-switch.css"),
  "utf8",
);
const compatibility = require("./compatibility.cjs");
const INLINE = fs.readFileSync(path.join(BASE, "gemini-inline.js"), "utf8");
const GEMINI_ORIGIN = fs.readFileSync(
  path.join(BASE, "gemini-origin.js"),
  "utf8",
);
const { classifyGuestURL } = require("./gemini-origin.cjs");
const UPDATE_SETTINGS = fs.readFileSync(
  path.join(BASE, "plugin-update-settings.js"),
  "utf8",
);
let pluginUpdate;
const APP_SETTINGS = fs.readFileSync(
  path.join(BASE, "app-settings.js"),
  "utf8",
);
const MODEL_UI = fs.readFileSync(path.join(BASE, "model-ui.js"), "utf8");
const MODEL_CONTROLS = fs.readFileSync(
  path.join(BASE, "model-controls.js"),
  "utf8",
);
const modelControlRules = require("./model-controls.cjs");
const { createTeamworkBridge } = require("./teamwork.cjs");
const LIBRARY_UI = fs.readFileSync(path.join(BASE, "library-ui.js"), "utf8");
const WORKSPACE_UI = fs.readFileSync(
  path.join(BASE, "workspace-ui.js"),
  "utf8",
);
const loadViewerBundle =
  require("./viewer-bundle.cjs").createViewerBundleLoader(
    path.join(BASE, "..", "assets", "viewers", "viewers.js"),
  );
const libraryRules = require("./library.cjs");
const library = libraryRules.createLibrary();
const workspacePreferences = require("./workspace-preferences.cjs").createStore(
  path.join(CONFIG_DIR, "workspace.json"),
);
const modelRules = require("./model-preferences.cjs");
const modelPreferences = modelRules.createStore(
  path.join(CONFIG_DIR, "models.json"),
);
const LAB_ICONS = Object.fromEntries(
  ["anthropic", "google", "openai"].map((id) => [
    id,
    "data:image/png;base64," +
      fs
        .readFileSync(path.join(BASE, "..", "assets", "labs", id + ".png"))
        .toString("base64"),
  ]),
);
const COMPANION_UI = fs.readFileSync(
  path.join(BASE, "companion-ui.js"),
  "utf8",
);
const { createBrowserPicker } = require("./browser-picker.cjs");
const {
  primaryLayout,
  createHoverIntent,
  startSidebarMotion,
} = require("./sidebar-layout.cjs");
const BROWSER_ICONS = Object.fromEntries(
  require("./browser-setup.cjs").BROWSERS.map(({ id }) => [
    id,
    "data:image/png;base64," +
      fs
        .readFileSync(path.join(BASE, "..", "assets", "browsers", id + ".png"))
        .toString("base64"),
  ]),
);
let companion;
let companionBroadcast;
const COMPUTER_USE_SETTINGS = fs.readFileSync(
  path.join(BASE, "computer-use-settings.js"),
  "utf8",
);
const NATIVE_MCP = fs.readFileSync(path.join(BASE, "native-mcp.js"), "utf8");
const SETTINGS_NAVIGATION = fs.readFileSync(
  path.join(BASE, "settings-navigation.js"),
  "utf8",
);
const PROJECT_PRESENTATION = fs.readFileSync(
  path.join(BASE, "project-presentation.js"),
  "utf8",
);
const computerUse = require("./computer-use.cjs").createManager();
const pluginControl = require("./plugin-control.cjs").createControl({
  file: path.join(CONFIG_DIR, "plugin.json"),
  disableAccess: async () => {
    const state = await computerUse.perform("disconnect", true);
    if (state.enabled) throw Error("Desktop access could not be disconnected.");
    await companion?.perform("disableBrowser", true);
  },
  pausePresentation: () => desktopIcon.pause(),
  resumePresentation: () => desktopIcon.resume(),
  onChange: async (enabled) => {
    if (enabled) pluginUpdate?.start();
    else pluginUpdate?.close();
    for (const c of clients.values()) {
      c.featureState = undefined;
      await c.ensure().catch(() => {});
    }
  },
});

const {
  connectionChecks,
  accessChanged,
  controlState,
} = require("./computer-use-checks.cjs");
const I18N = fs.readFileSync(path.join(BASE, "i18n.js"), "utf8");
const TRANSLATIONS = JSON.parse(
  fs.readFileSync(path.join(BASE, "locales.json"), "utf8"),
);
const WINDOW_CHROME = fs.readFileSync(
  path.join(BASE, "window-chrome.css"),
  "utf8",
);
const desktopIcon = require("./desktop-icon.cjs");
const SWITCH_ASSETS = JSON.parse(
  fs.readFileSync(path.join(BASE, "switch-assets.json"), "utf8"),
);
const BRAND_ICON =
  "data:image/svg+xml;base64," +
  Buffer.from(
    fs
      .readFileSync(
        path.join(BASE, "..", "assets", "logos", "antigravity.svg"),
        "utf8",
      )
      .replace('viewBox="0 0 136 136"', 'viewBox="20 24 96 88"')
      .replace('width="120" height="120"', 'width="24" height="24"'),
    "utf8",
  ).toString("base64");
const APP_ICON_ASSETS = {
  antigravity:
    "data:image/png;base64," +
    fs.readFileSync(iconPath("antigravity.png")).toString("base64"),
  gemini: SWITCH_ASSETS.gemini,
};
const versions = require("./versions.cjs");
const VERSION = versions.suite;
const SIDEBAR_LAYOUT_VERSION =
  versions.sidebarLayout +
  ":" +
  require("node:crypto")
    .createHash("sha256")
    .update(fs.readFileSync(path.join(BASE, "sidebar-layout.cjs")))
    .digest("hex")
    .slice(0, 16);
const I18N_VERSION = versions.i18n;
const APP_SETTINGS_VERSION = versions.settings;
const APPEARANCE_VERSION = versions.appearance;
const SWITCH_VERSION = versions.geminiSwitch;
const INLINE_VERSION = versions.inline;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ICONS = new Set(
  "folder terminal code monitor server chip cloud robot settings wrench briefcase book notebook graduation pencil pen music film atom palette stethoscope puzzle leaf shopping chart money dumbbell scales globe plane heart paw flask brain flower home camera phone shield rocket gamepad coffee bicycle lightbulb flag tree mail star".split(
    " ",
  ),
);
let config = { version: 1, projects: {} };
let stopping = false,
  polling = false,
  writeChain = Promise.resolve(),
  lastState = "",
  configMtime = 0;
const clients = new Map();
let viewRevision = 0;
function log(event, error) {
  diagnostic(error ? "warn" : "info", event, error);
}
function validStyle(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid appearance.");
  if (!["icon", "emoji"].includes(value.kind))
    throw Error("Invalid icon type.");
  if (!ICONS.has(value.icon)) throw Error("Unknown icon.");
  if (
    typeof value.emoji !== "string" ||
    !value.emoji.trim() ||
    Array.from(value.emoji).length > 16 ||
    /[\u0000-\u001f\u007f]/.test(value.emoji)
  )
    throw Error("Invalid emoji.");
  if (
    value.color !== null &&
    (typeof value.color !== "string" || !/^#[\da-f]{6}$/i.test(value.color))
  )
    throw Error("Invalid color.");
  return {
    kind: value.kind,
    icon: value.icon,
    emoji: value.emoji,
    color: value.color?.toLowerCase() || null,
  };
}
function validateConfig(data) {
  if (
    data?.version !== 1 ||
    !data.projects ||
    typeof data.projects !== "object" ||
    Array.isArray(data.projects)
  )
    throw Error("Unsupported appearance configuration.");
  const next = { version: 1, projects: {} };
  if (Object.keys(data.projects).length > 10000)
    throw Error("Too many project styles.");
  for (const [id, value] of Object.entries(data.projects)) {
    if (!UUID.test(id))
      throw Error("Invalid project identifier in configuration.");
    const style = validStyle(value);
    if (style) next.projects[id] = style;
  }
  return next;
}
async function readConfig() {
  try {
    const stat = await fsp.stat(CONFIG_PATH);
    if (stat.size > 2_000_000) throw Error("Configuration is too large.");
    const next = validateConfig(
      JSON.parse(await fsp.readFile(CONFIG_PATH, "utf8")),
    );
    configMtime = stat.mtimeMs;
    return next;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, projects: {} };
    throw error;
  }
}
async function commit(projectId, style) {
  if (!UUID.test(projectId)) throw Error("Invalid project identifier.");
  const next = { version: 1, projects: { ...config.projects } };
  if (style === null) delete next.projects[projectId];
  else next.projects[projectId] = validStyle(style);
  await fsp.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = path.join(CONFIG_DIR, `.projects-${process.pid}.tmp`);
  try {
    const file = await fsp.open(tmp, "w", 0o600);
    try {
      await file.writeFile(JSON.stringify(next, null, 2) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    await fsp.rename(tmp, CONFIG_PATH);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  config = next;
  configMtime = (await fsp.stat(CONFIG_PATH)).mtimeMs;
  for (const client of clients.values()) client.updateConfig().catch(() => {});
  log("appearance.saved");
  return next;
}
class Client {
  constructor(target, key) {
    this.target = target;
    this.key = key;
    this.contexts = new Map();
    this.busy = false;
    this.initialized = false;
    this.connection = null;
    this.catalogUpdated = false;
    this.healthSignature = null;
    this.patchStatus = { version: VERSION, state: "unchecked", checks: [] };
  }
  async open() {
    this.connection = await connect(this.target.webSocketDebuggerUrl, {
      connectTimeout: 2500,
      requestTimeout: 4000,
      onEvent: (m) => {
        if (m.method === "Runtime.executionContextCreated")
          this.contexts.set(m.params.context.id, m.params.context);
        if (m.method === "Runtime.executionContextDestroyed")
          this.contexts.delete(m.params.executionContextId);
        if (m.method === "Runtime.executionContextsCleared")
          this.contexts.clear();
        if (
          m.method === "Runtime.bindingCalled" &&
          m.params.name === "__agpaModelPreferences"
        )
          this.onModels(m.params).catch(() => log("models.rejected"));
        if (
          m.method === "Runtime.bindingCalled" &&
          m.params.name === "__agpaLibrary"
        )
          this.onLibrary(m.params).catch(() => log("library.rejected"));
        if (
          m.method === "Runtime.bindingCalled" &&
          m.params.name === "__agpaPersist"
        )
          this.onBinding(m.params).catch((e) => log("appearance.rejected", e));
        if (
          m.method === "Runtime.bindingCalled" &&
          m.params.name === "__agpaPluginUpdate"
        )
          this.onPluginUpdate(m.params).catch(() => log("updates.rejected"));
        if (
          m.method === "Runtime.bindingCalled" &&
          m.params.name === "__agpaAppSettings"
        )
          this.onAppSettings(m.params).catch((e) =>
            log("preferences.rejected", e),
          );
        if (
          m.method === "Runtime.bindingCalled" &&
          m.params.name === "__agpaCompanion"
        )
          this.onCompanion(m.params).catch(() => log("companion.rejected"));
        if (
          m.method === "Runtime.bindingCalled" &&
          m.params.name === "__agpaComputerUse"
        )
          this.onComputerUse(m.params).catch(() =>
            log("computer_use.rejected"),
          );
      },
      onClose: () => {
        this.contexts.clear();
        if (clients.get(this.key) === this) clients.delete(this.key);
      },
      onListenerError: (error) =>
        diagnostic("warn", "cdp.listener_failed", error),
    });
    await this.call("Page.enable");
    this.frameId = (await this.call("Page.getFrameTree")).frameTree.frame.id;
    await this.call("Runtime.enable");
    await this.call("Runtime.addBinding", { name: "__agpaPersist" });
    await this.call("Runtime.addBinding", { name: "__agpaModelPreferences" });
    await this.call("Runtime.addBinding", { name: "__agpaLibrary" });
    await this.call("Runtime.addBinding", { name: "__agpaAppSettings" });
    await this.call("Runtime.addBinding", { name: "__agpaPluginUpdate" });
    await this.call("Runtime.addBinding", { name: "__agpaComputerUse" });
    await this.call("Runtime.addBinding", { name: "__agpaCompanion" });
    await this.ensure();
    if (pluginControl.enabled) {
      await desktopIcon.ensureTray();
      await desktopIcon.setView(
        await this.evaluate(
          'globalThis.__AGGeminiSwitch?.status().visible?"gemini":"antigravity"',
        ),
      );
      // A tray-created window has no launcher startup notification. Refresh its
      // desktop identity even when the selected icon did not change.
      if (desktopIcon.windowOpened)
        await desktopIcon
          .windowOpened()
          .catch((e) => log("window.icon_failed", e));
      await this.updateAppState();
    }
  }
  call(method, params = {}) {
    if (!this.connection) return Promise.reject(Error("Disconnected."));
    return this.connection.call(method, params);
  }
  async evaluate(expression, contextId) {
    const r = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      ...(contextId ? { contextId } : {}),
    });
    if (r.exceptionDetails)
      throw Error(r.result?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
  async ensure() {
    if (this.busy) return;
    this.busy = true;
    try {
      const state = await this.evaluate(
        `JSON.stringify({origin:location.origin,top:globalThis.top===globalThis,version:globalThis.__AGProjectAppearance?.version})`,
      );
      const data = JSON.parse(state || "{}");
      if (!data.top || !/^https:\/\/127\.0\.0\.1:\d+$/.test(data.origin))
        return;
      this.origin = data.origin;

      if (
        (await this.evaluate("globalThis.__AGPAShortcutRules?.version")) !== 1
      )
        await this.evaluate(
          `globalThis.__AGPACreateShortcutRules=${shortcutRules.createShortcutRules.toString()};globalThis.__AGPAShortcutRules=globalThis.__AGPACreateShortcutRules();`,
        );
      await this.evaluate(
        `globalThis.__AGPA_TOGGLE_SHORTCUT__=${JSON.stringify(desktopIcon.getState().toggleShortcut)};`,
      );
      if (
        (await this.evaluate("globalThis.__AGPAI18n?.version")) !== I18N_VERSION
      ) {
        await this.evaluate(
          `globalThis.__AGPA_TRANSLATIONS__=${JSON.stringify(TRANSLATIONS)};\n${I18N}`,
        );
        this.catalogUpdated = true;
      } else if (!this.catalogUpdated) {
        await this.evaluate(
          `globalThis.__AGPAI18n.setCatalogs(${JSON.stringify(TRANSLATIONS)})`,
        );
        this.catalogUpdated = true;
      }
      if (
        (await this.evaluate("globalThis.__AGPluginUpdates?.version")) !==
        versions.updates
      )
        await this.evaluate(UPDATE_SETTINGS);
      if (pluginControl.busy) return;
      library.setEnabled(
        pluginControl.enabled && workspacePreferences.current().libraryEnabled,
      );
      if (!pluginControl.enabled) {
        if (this.featureState !== false) {
          await this.pauseFeatures();
          this.featureState = false;
        }
        return;
      }
      if (this.featureState === false || this.featureState === undefined)
        await this.evaluate(
          `document.body.removeAttribute('data-agpa-plugin-disabled')`,
        );
      this.featureState = true;
      if (
        (await this.evaluate("globalThis.__AGPASidebarLayoutVersion")) !==
        SIDEBAR_LAYOUT_VERSION
      )
        await this.evaluate(
          `globalThis.__AGPASidebarLayoutVersion=${JSON.stringify(SIDEBAR_LAYOUT_VERSION)};globalThis.__AGPAPrimaryLayout=${primaryLayout.toString()};globalThis.__AGPAStartSidebarMotion=${startSidebarMotion.toString()};globalThis.__AGPACreateHoverIntent=${createHoverIntent.toString()};`,
        );
      if (!(await this.evaluate("!!globalThis.__AGProjectPresentation")))
        await this.evaluate(PROJECT_PRESENTATION);
      if (data.version !== APPEARANCE_VERSION) {
        await this.evaluate(
          `globalThis.__AGPA_CONFIG__=${JSON.stringify(config)};\n${RENDERER}`,
        );
        this.initialized = true;
        log("appearance.applied");
      } else if (!this.initialized) {
        this.initialized = true;
        await this.updateConfig();
      }
      if (
        (await this.evaluate("globalThis.__AGGeminiSwitch?.version")) !==
        SWITCH_VERSION
      ) {
        await this.evaluate(
          `globalThis.__AGPA_SWITCH_ASSETS__=${JSON.stringify(SWITCH_ASSETS)};globalThis.__AGPA_GEMINI_CSS__=${JSON.stringify(SWITCH_CSS)};\n${SWITCH}`,
        );
        log("gemini.applied");
      }
      if (
        (await this.evaluate("globalThis.__AGHeaderPlacement?.version")) !==
        versions.headerPlacement
      )
        await this.evaluate(HEADER_PLACEMENT);
      await this.evaluate(
        `(()=>{if(document.getElementById('agpa-gemini-styles'))return;const style=document.createElement('style');style.id='agpa-gemini-styles';style.textContent=${JSON.stringify(SWITCH_CSS)};document.head.append(style);})()`,
      );
      if (
        (await this.evaluate("globalThis.__AGGeminiInline?.version")) !==
        INLINE_VERSION
      ) {
        await this.evaluate("globalThis.__AGGeminiInline?.destroy()");
        await this.evaluate(
          `globalThis.__AGPA_INLINE_ICON__=${JSON.stringify(SWITCH_ASSETS.antigravity)};\n${INLINE}`,
        );
        log("gemini.inline_applied");
      }
      if (
        (await this.evaluate("globalThis.__AGGeminiOrigin?.version")) !==
        versions.geminiOrigin
      )
        await this.evaluate(
          `globalThis.__AGPAClassifyGuestURL=${classifyGuestURL.toString()};\n${GEMINI_ORIGIN}`,
        );
      if (
        (await this.evaluate("globalThis.__AGAppSettings?.version")) !==
        APP_SETTINGS_VERSION
      ) {
        await this.evaluate(
          `globalThis.__AGPA_APP_SETTINGS__=${JSON.stringify(desktopIcon.getState())};globalThis.__AGPA_PATCH_STATUS__=${JSON.stringify(this.patchStatus)};globalThis.__AGPA_APP_ICON_ASSETS__=${JSON.stringify(APP_ICON_ASSETS)};\n${APP_SETTINGS}`,
        );
        log("window.icon_applied");
      }

      if (
        (await this.evaluate("globalThis.__AGShortcuts?.version")) !==
        versions.shortcuts
      )
        await this.evaluate(SHORTCUTS);
      if (!(await this.evaluate("!!globalThis.__AGNativeMcp")))
        await this.evaluate(NATIVE_MCP);
      if (
        (await this.evaluate("globalThis.__AGSettingsNavigation?.version")) !==
        versions.settingsNavigation
      )
        await this.evaluate(
          `globalThis.__AGPA_SETTINGS_PROJECT_STYLES__=${JSON.stringify(config)};\n${SETTINGS_NAVIGATION}`,
        );
      if (
        (await this.evaluate("globalThis.__AGComputerUse?.version")) !==
        versions.computerUse
      )
        await this.evaluate(
          `globalThis.__AGPAComputerUseChecks=${connectionChecks.toString()};globalThis.__AGPAComputerUseAccessChanged=${accessChanged.toString()};globalThis.__AGPAComputerUseControlState=${controlState.toString()};\n${COMPUTER_USE_SETTINGS}`,
        );
      if (
        (await this.evaluate("globalThis.__AGModelUI?.version")) !==
        versions.models
      )
        await this.evaluate(
          `globalThis.__AGPAProviderFor=${modelRules.providerFor.toString()};globalThis.__AGPAPermissionFor=${modelRules.permissionFor.toString()};globalThis.__AGPA_LAB_ICONS__=${JSON.stringify(LAB_ICONS)};globalThis.__AGPA_MODEL_PREFERENCES__=${JSON.stringify(modelPreferences.current())};\n${MODEL_UI}`,
        );
      if (
        (await this.evaluate("globalThis.__AGModelControls?.version")) !==
        versions.modelControls
      )
        await this.evaluate(
          `globalThis.__AGPA_TEAMWORK_FACTORY__=${createTeamworkBridge.toString()};globalThis.__AGPA_MODEL_CONTROLS__={selectionFor:${modelControlRules.selectionFor.toString()},optionsFor:${modelControlRules.optionsFor.toString()},layoutFor:${modelControlRules.layoutFor.toString()}};\n${MODEL_CONTROLS}`,
        );
      if (
        (await this.evaluate("globalThis.__AGCompanion?.version")) !==
        versions.companion
      )
        await this.evaluate(
          `globalThis.__AGPABrowserSetupState=${require("./browser-setup.cjs").setupState.toString()};globalThis.__AGPABrowserPicker=${createBrowserPicker.toString()};globalThis.__AGPA_BROWSER_ICONS__=${JSON.stringify(BROWSER_ICONS)};\n${COMPANION_UI}`,
        );
      if (
        (await this.evaluate("globalThis.__AGWorkspace?.version")) !==
        versions.workspace
      )
        await this.evaluate(
          `globalThis.__AGPA_BRAND_ICON__=${JSON.stringify(BRAND_ICON)};globalThis.__AGPA_WORKSPACE__=${JSON.stringify(workspacePreferences.current())};\n${WORKSPACE_UI}`,
        );
      if (
        (await this.evaluate("globalThis.__AGLibrary?.version")) !==
        versions.library
      )
        await this.evaluate(
          `globalThis.__AGPA_LIBRARY_ENABLED__=${JSON.stringify(workspacePreferences.current().libraryEnabled)};globalThis.__AGPA_FILTER_LIBRARY__=${libraryRules.filterItems.toString()};globalThis.__AGPA_LIBRARY_PICKER__=${createBrowserPicker.toString()};\n${LIBRARY_UI}`,
        );
      await this.evaluate(
        `(()=>{let style=document.getElementById('agpa-window-chrome-styles');if(style?.getAttribute('data-version')===${JSON.stringify(VERSION)})return;if(!style){style=document.createElement('style');style.id='agpa-window-chrome-styles';document.head.append(style);}style.textContent=${JSON.stringify(WINDOW_CHROME)};style.setAttribute('data-version',${JSON.stringify(VERSION)});})()`,
      );
      const signature = await this.evaluate(
        `JSON.stringify(['[data-testid=settings-button]','[data-testid=sidebar-toggle]','[data-testid=titlebar-more-actions]','[data-testid=pane-titlebar-toolbar]','[data-testid=settings-nav-item-App]','#agpa-styles','#agpa-app-settings-styles'].map(selector=>!!document.querySelector(selector)))`,
      );
      if (signature !== this.healthSignature) {
        this.healthSignature = signature;
        await this.checkCompatibility();
      }
    } finally {
      this.busy = false;
    }
  }
  async pauseFeatures() {
    await this.evaluate(`(async()=>{
   globalThis.__AGPA_STARTUP_APPLIED__=true;
   document.body.setAttribute('data-agpa-plugin-disabled','');
   document.querySelector('[data-agpa-gemini][open]')?.close();
   globalThis.__AGHeaderPlacement?.destroy();
   globalThis.__AGLibrary?.destroy();globalThis.__AGWorkspace?.destroy();
   globalThis.__AGCompanion?.destroy();globalThis.__AGModelControls?.destroy();globalThis.__AGModelUI?.destroy();globalThis.__AGComputerUse?.destroy();
   globalThis.__AGSettingsNavigation?.destroy();globalThis.__AGNativeMcp?.destroy();globalThis.__AGAppSettings?.destroy();globalThis.__AGShortcuts?.destroy();
   await globalThis.__AGGeminiInline?.destroy();
   globalThis.__AGProjectAppearance?.destroy();globalThis.__AGProjectPresentation?.destroy();
   document.getElementById('agpa-window-chrome-styles')?.remove();
  })()`);
  }
  async updateConfig() {
    if (this.initialized)
      await this.evaluate(
        `globalThis.__AGProjectAppearance?.setConfig(${JSON.stringify(config)});globalThis.__AGSettingsNavigation?.setProjectStyles(${JSON.stringify(config)})`,
      );
  }
  async updateAppState() {
    const state = desktopIcon.getState();
    await this.evaluate(
      `globalThis.__AGAppSettings?.setState(${JSON.stringify(state)});globalThis.__AGShortcuts?.configure(${JSON.stringify(state.toggleShortcut)});globalThis.__AGGeminiInline?.setShortcut(${JSON.stringify(state.toggleShortcut)})`,
    );
  }
  async checkCompatibility(extra = {}) {
    const data = await this.evaluate(
      `(${compatibility.probe.toString()})(${JSON.stringify(VERSION)},${JSON.stringify(versions)})`,
    );
    this.patchStatus = { ...compatibility.assess(data, VERSION), ...extra };
    await this.evaluate(
      `globalThis.__AGAppSettings?.setPatchStatus(${JSON.stringify(this.patchStatus)})`,
    );
    return data;
  }
  async repairIntegration() {
    const data = await this.checkCompatibility();
    const sessionUnsafe = await this.evaluate(
      '!!document.querySelector("[data-agpa-gemini] webview")&&!globalThis.__AGGeminiSwitch',
    );
    const decision = compatibility.recoveryDecision(data, sessionUnsafe);
    if (!decision.allowed) {
      await this.checkCompatibility({
        repaired: false,
        reason: decision.reason,
      });
      return desktopIcon.getState();
    }
    await this.ensure();
    await this.evaluate(`(async()=>{
   globalThis.__AGProjectAppearance?.reapply();globalThis.__AGAppSettings?.reapply();globalThis.__AGShortcuts?.reapply();
   if(!document.getElementById('agpa-gemini-styles')){const style=document.createElement('style');style.id='agpa-gemini-styles';style.textContent=${JSON.stringify(SWITCH_CSS)};document.head.append(style);}
   await globalThis.__AGGeminiInline?.reapply();await new Promise(resolve=>setTimeout(resolve,40));
  })()`);
    await this.checkCompatibility();
    this.patchStatus.repaired = this.patchStatus.state === "compatible";
    await this.evaluate(
      `globalThis.__AGAppSettings?.setPatchStatus(${JSON.stringify(this.patchStatus)})`,
    );
    return desktopIcon.getState();
  }
  async onAppSettings(params) {
    if (!pluginControl.enabled || pluginControl.busy) return;
    const context = this.contexts.get(params.executionContextId);
    if (
      !context?.auxData?.isDefault ||
      context.auxData.frameId !== this.frameId ||
      context.origin !== this.origin
    )
      return;
    let payload;
    try {
      if (params.payload.length > 1024) throw Error("Request too large.");
      payload = JSON.parse(params.payload);
      if (!UUID.test(payload.requestId))
        throw Error("Invalid preference request.");
      const actions = {
        setTaskbarIcon: ["antigravity", "gemini", "dynamic"],
        setStartupView: ["antigravity", "gemini", "last"],
        checkCompatibility: [true],
        repairIntegration: [true],
        setAutostart: [true, false],
        viewChanged: ["antigravity", "gemini"],
      };
      if (payload.action === "setToggleShortcut")
        payload.value = shortcutRules.normalize(payload.value);
      else if (!actions[payload.action]?.includes(payload.value))
        throw Error("Invalid application preference.");
      const revision = payload.action === "viewChanged" ? ++viewRevision : null;
      const job = writeChain.then(async () => {
        if (revision !== null && revision !== viewRevision)
          return desktopIcon.getState();
        if (payload.action === "checkCompatibility") {
          await this.checkCompatibility();
          return desktopIcon.getState();
        }
        if (payload.action === "repairIntegration")
          return this.repairIntegration();
        if (payload.action === "setToggleShortcut")
          return desktopIcon.setToggleShortcut(payload.value);
        if (payload.action === "setTaskbarIcon")
          return desktopIcon.apply(payload.value);
        if (payload.action === "setStartupView")
          return desktopIcon.setStartupView(payload.value);
        if (payload.action === "setAutostart")
          return desktopIcon.setAutostart(payload.value);
        return desktopIcon.setView(payload.value);
      });
      writeChain = job.catch(() => {});
      const next = await job;
      for (const c of clients.values())
        await c.updateAppState().catch(() => {});
      await this.evaluate(
        `globalThis.__AGAppSettings?.onSaved(${JSON.stringify(payload.requestId)},true,null,${JSON.stringify(next)},${JSON.stringify(this.patchStatus)})`,
        params.executionContextId,
      );
      if (payload.action !== "viewChanged") log("preferences.saved");
    } catch (error) {
      if (UUID.test(payload?.requestId || ""))
        await this.evaluate(
          `globalThis.__AGAppSettings?.onSaved(${JSON.stringify(payload.requestId)},false,${JSON.stringify(error.message)})`,
          params.executionContextId,
        ).catch(() => {});
      else throw error;
    }
  }
  async onModels(params) {
    if (!pluginControl.enabled || pluginControl.busy) return;
    const context = this.contexts.get(params.executionContextId);
    if (
      !context?.auxData?.isDefault ||
      context.auxData.frameId !== this.frameId ||
      context.origin !== this.origin
    )
      return;
    let payload;
    try {
      if (params.payload.length > 2048)
        throw Error("Invalid model preference.");
      payload = JSON.parse(params.payload);
      if (!UUID.test(payload.requestId)) throw Error("Invalid request.");
      const job = writeChain.then(() => modelPreferences.update(payload));
      writeChain = job.catch(() => {});
      const next = await job;
      for (const c of clients.values())
        c.evaluate(
          `globalThis.__AGModelUI?.setPreferences(${JSON.stringify(next)})`,
        ).catch(() => {});
      await this.evaluate(
        `globalThis.__AGModelUI?.onResult(${JSON.stringify(payload.requestId)},true,${JSON.stringify(next)})`,
        params.executionContextId,
      );
    } catch {
      if (UUID.test(payload?.requestId || ""))
        await this.evaluate(
          `globalThis.__AGModelUI?.onResult(${JSON.stringify(payload.requestId)},false)`,
          params.executionContextId,
        ).catch(() => {});
    }
  }
  async onLibrary(params) {
    if (!pluginControl.enabled || pluginControl.busy) return;
    const context = this.contexts.get(params.executionContextId);
    if (
      !context?.auxData?.isDefault ||
      context.auxData.frameId !== this.frameId ||
      context.origin !== this.origin
    )
      return;
    let payload;
    try {
      if (params.payload.length > 32768) throw Error("unavailable");
      payload = JSON.parse(params.payload);
      if (
        !UUID.test(payload.requestId) ||
        ![
          "list",
          "refresh",
          "preview",
          "thumbnail",
          "favorite",
          "add",
          "remove",
          "sidebar",
          "libraryEnabled",
          "viewerBundle",
        ].includes(payload.action)
      )
        throw Error("unavailable");
      let result;
      if (["sidebar", "libraryEnabled"].includes(payload.action)) {
        const job = writeChain.then(() =>
          payload.action === "sidebar"
            ? workspacePreferences.update(payload.value)
            : workspacePreferences.updateLibrary(payload.value),
        );
        writeChain = job.catch(() => {});
        result = await job;
        library.setEnabled(result.libraryEnabled);
        for (const c of clients.values())
          await c
            .evaluate(
              `globalThis.__AGWorkspace?.setPreferences(${JSON.stringify(result)});globalThis.__AGLibrary?.setEnabled(${JSON.stringify(result.libraryEnabled)})`,
            )
            .catch(() => {});
      } else if (!workspacePreferences.current().libraryEnabled)
        throw Error("unavailable");
      else if (payload.action === "list" || payload.action === "refresh") {
        if (payload.value !== true) throw Error("unavailable");
        result = await library.list(payload.action === "refresh");
      } else if (payload.action === "viewerBundle") {
        if (payload.value !== true) throw Error("unavailable");
        result = await loadViewerBundle();
      } else if (payload.action === "preview" || payload.action === "thumbnail")
        result = await library.preview(payload.value, {
          thumbnail: payload.action === "thumbnail",
        });
      else if (["favorite", "add", "remove"].includes(payload.action)) {
        const job = writeChain.then(() =>
          payload.action === "favorite"
            ? library.favorite(payload.value?.id, payload.value?.value)
            : payload.action === "remove"
              ? library.remove(payload.value)
              : library.add(payload.value),
        );
        writeChain = job.catch(() => {});
        result = await job;
      }
      await this.evaluate(
        `globalThis.${["sidebar", "libraryEnabled"].includes(payload.action) ? "__AGWorkspace" : "__AGLibrary"}?.onResult(${JSON.stringify(payload.requestId)},true,${JSON.stringify(result)})`,
        params.executionContextId,
      );
    } catch (error) {
      if (UUID.test(payload?.requestId || ""))
        await this.evaluate(
          `globalThis.${["sidebar", "libraryEnabled"].includes(payload.action) ? "__AGWorkspace" : "__AGLibrary"}?.onResult(${JSON.stringify(payload.requestId)},false,{error:${JSON.stringify(["tooLarge", "unsupported"].includes(error.message) ? error.message : "unavailable")}})`,
          params.executionContextId,
        ).catch(() => {});
    }
  }
  async onCompanion(params) {
    if (!pluginControl.enabled || pluginControl.busy) return;
    const context = this.contexts.get(params.executionContextId);
    if (
      !context?.auxData?.isDefault ||
      context.auxData.frameId !== this.frameId ||
      context.origin !== this.origin ||
      !companion
    )
      return;
    let payload;
    try {
      if (params.payload.length > 2048) throw Error("Request too large.");
      payload = JSON.parse(params.payload);
      if (
        !UUID.test(payload.requestId) ||
        ![
          "status",
          "setupBrowser",
          "disableBrowser",
          "disconnectProfile",
          "openExtensions",
          "openExtensionDetails",
          "inspectBrowser",
        ].includes(payload.action)
      )
        throw Error("Invalid companion request.");
      if (payload.action === "disconnectProfile") {
        if (!UUID.test(payload.value)) throw Error("Invalid connection.");
      } else if (
        ["openExtensions", "openExtensionDetails", "inspectBrowser"].includes(
          payload.action,
        )
      ) {
        if (
          !require("./browser-setup.cjs").BROWSERS.some(
            (b) => b.id === payload.value,
          )
        )
          throw Error("Invalid browser.");
      } else if (payload.value !== true) throw Error("Invalid value.");
      const result = await companion.perform(payload.action, payload.value);
      await this.evaluate(
        `globalThis.__AGCompanion?.onResult(${JSON.stringify(payload.requestId)},true,${JSON.stringify(result)})`,
        params.executionContextId,
      );
    } catch (error) {
      if (UUID.test(payload?.requestId || ""))
        await this.evaluate(
          `globalThis.__AGCompanion?.onResult(${JSON.stringify(payload.requestId)},false,{error:${JSON.stringify(require("./companion.cjs").publicError(error))}})`,
          params.executionContextId,
        ).catch(() => {});
    }
  }
  async onPluginUpdate(params) {
    const context = this.contexts.get(params.executionContextId);
    if (
      !context?.auxData?.isDefault ||
      context.auxData.frameId !== this.frameId ||
      context.origin !== this.origin ||
      !pluginUpdate
    )
      return;
    let payload;
    try {
      if (params.payload.length > 1024) throw Error("Invalid update request.");
      payload = JSON.parse(params.payload);
      if (
        !UUID.test(payload.requestId) ||
        !["status", "check", "automatic", "install", "enabled"].includes(
          payload.action,
        ) ||
        (["automatic", "enabled"].includes(payload.action)
          ? typeof payload.value !== "boolean"
          : payload.value !== true)
      )
        throw Error("Invalid update request.");
      if (payload.action === "enabled") {
        const job = writeChain.then(() =>
          pluginControl.setEnabled(payload.value),
        );
        writeChain = job.catch(() => {});
        await job;
      }
      const result = {
        ...(await pluginUpdate.perform(
          payload.action === "enabled" ? "status" : payload.action,
          payload.action === "enabled" ? true : payload.value,
        )),
        pluginEnabled: pluginControl.enabled,
      };
      await this.evaluate(
        `globalThis.__AGPluginUpdates?.onResult(${JSON.stringify(payload.requestId)},true,${JSON.stringify(result)})`,
        params.executionContextId,
      );
    } catch {
      if (UUID.test(payload?.requestId || ""))
        await this.evaluate(
          `globalThis.__AGPluginUpdates?.onResult(${JSON.stringify(payload.requestId)},false)`,
          params.executionContextId,
        ).catch(() => {});
    }
  }
  async onComputerUse(params) {
    if (!pluginControl.enabled || pluginControl.busy) return;
    const context = this.contexts.get(params.executionContextId);
    if (
      !context?.auxData?.isDefault ||
      context.auxData.frameId !== this.frameId ||
      context.origin !== this.origin
    )
      return;
    let payload;
    try {
      if (params.payload.length > 90000) throw Error("Request too large.");
      payload = JSON.parse(params.payload);
      if (
        !UUID.test(payload.requestId) ||
        ![
          "status",
          "refresh",
          "setup",
          "install",
          "connect",
          "disconnect",
          "check",
          "capture",
          "verify",
          "updates",
          "uninstall",
          "setupHelper",
        ].includes(payload.action)
      )
        throw Error("Invalid request.");
      if (["connect", "setup"].includes(payload.action)) {
        const apps = Array.isArray(payload.value)
          ? payload.value
          : payload.value?.apps;
        if (
          !Array.isArray(payload.value) &&
          !["desktop", "apps"].includes(payload.value?.scope)
        )
          throw Error("Invalid scope.");
        if (
          !Array.isArray(apps) ||
          apps.length > 20 ||
          apps.some((v) => typeof v !== "string" || v.length > 4096)
        )
          throw Error("Invalid applications.");
      } else if (payload.value !== true) throw Error("Invalid request value.");
      const result =
        payload.action === "status"
          ? await computerUse.status()
          : await computerUse.perform(payload.action, payload.value);
      await this.evaluate(
        `globalThis.__AGComputerUse?.onResult(${JSON.stringify(payload.requestId)},true,${JSON.stringify(result)})`,
        params.executionContextId,
      );
    } catch {
      if (UUID.test(payload?.requestId || ""))
        await this.evaluate(
          `globalThis.__AGComputerUse?.onResult(${JSON.stringify(payload.requestId)},false)`,
          params.executionContextId,
        ).catch(() => {});
    }
  }
  async onBinding(params) {
    if (!pluginControl.enabled || pluginControl.busy) return;
    const context = this.contexts.get(params.executionContextId);
    if (
      !context?.auxData?.isDefault ||
      context.auxData.frameId !== this.frameId ||
      context.origin !== this.origin
    )
      return;
    let payload;
    try {
      if (params.payload.length > 4096) throw Error("Request too large.");
      payload = JSON.parse(params.payload);
      if (!UUID.test(payload.requestId) || !UUID.test(payload.projectId))
        throw Error("Invalid save request.");
      const style = validStyle(payload.style);
      const job = writeChain.then(() => commit(payload.projectId, style));
      writeChain = job.catch(() => {});
      const next = await job;
      await this.evaluate(
        `globalThis.__AGProjectAppearance?.onPersisted(${JSON.stringify(payload.requestId)},true,null,${JSON.stringify(next)})`,
        params.executionContextId,
      );
    } catch (error) {
      if (UUID.test(payload?.requestId || ""))
        await this.evaluate(
          `globalThis.__AGProjectAppearance?.onPersisted(${JSON.stringify(payload.requestId)},false,${JSON.stringify(error.message)})`,
          params.executionContextId,
        ).catch(() => {});
      else throw error;
    }
  }
  async destroy() {
    try {
      await this.evaluate(
        '(async()=>{document.getElementById("agpa-window-chrome-styles")?.remove();globalThis.__AGLibrary?.destroy();globalThis.__AGWorkspace?.destroy();globalThis.__AGModelControls?.destroy();globalThis.__AGModelUI?.destroy();globalThis.__AGCompanion?.destroy();globalThis.__AGPluginUpdates?.destroy();globalThis.__AGComputerUse?.destroy();globalThis.__AGSettingsNavigation?.destroy();globalThis.__AGNativeMcp?.destroy();globalThis.__AGAppSettings?.destroy();globalThis.__AGShortcuts?.destroy();await globalThis.__AGGeminiInline?.destroy();globalThis.__AGHeaderPlacement?.destroy();globalThis.__AGGeminiSwitch?.destroy();if(!globalThis.__AGGeminiSwitch)globalThis.__AGGeminiOrigin?.destroy();if(!globalThis.__AGGeminiSwitch)document.getElementById("agpa-gemini-styles")?.remove();globalThis.__AGProjectAppearance?.destroy();globalThis.__AGProjectPresentation?.destroy();globalThis.__AGPAI18n?.destroy();})()',
      );
    } catch {}
    this.connection?.close();
  }
}
async function companionState() {
  return companion.snapshot();
}
async function discover() {
  const contents = await fsp.readFile(PORT_PATH, "utf8");
  const port = contents.split("\n")[0];
  if (!/^\d{2,5}$/.test(port) || Number(port) > 65535)
    throw Error("Invalid debugging port.");
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw Error("Antigravity debugging endpoint unavailable.");
  const data = await res.json();
  return data
    .filter((t) => {
      if (
        t.type !== "page" ||
        !/^https:\/\/127\.0\.0\.1:\d+\//.test(t.url || "")
      )
        return false;
      try {
        const u = new URL(t.webSocketDebuggerUrl);
        return (
          u.protocol === "ws:" && u.hostname === "127.0.0.1" && u.port === port
        );
      } catch {
        return false;
      }
    })
    .map((t) => ({ ...t, key: `${port}:${t.id}` }));
}
async function poll() {
  if (stopping || polling) return;
  polling = true;
  try {
    const stat = await fsp
      .stat(CONFIG_PATH)
      .catch((e) => (e.code === "ENOENT" ? null : Promise.reject(e)));
    if (stat && stat.mtimeMs !== configMtime) {
      config = await readConfig();
      for (const c of clients.values()) await c.updateConfig().catch(() => {});
    }
    if (pluginControl.enabled && platformPaths.platform === "win32") {
      const before = desktopIcon.getState();
      const after = await desktopIcon.ensureTray();
      if (
        before.desktopIconAvailable !== after.desktopIconAvailable ||
        before.trayAvailable !== after.trayAvailable
      )
        for (const c of clients.values())
          await c.updateAppState().catch(() => {});
    }
    const targets = await discover();
    for (const target of targets) {
      let c = clients.get(target.key);
      if (!c) {
        c = new Client(target, target.key);
        clients.set(target.key, c);
        try {
          await c.open();
        } catch (e) {
          c.connection?.close();
          clients.delete(target.key);
          throw e;
        }
      } else await c.ensure();
    }
    const keys = new Set(targets.map((t) => t.key));
    for (const [key, c] of clients)
      if (!keys.has(key)) {
        c.connection?.close();
        clients.delete(key);
      }
    const state = targets.length ? "active" : "waiting";
    if (state !== lastState) {
      lastState = state;
      log(state === "active" ? "service.active" : "service.waiting");
    }
  } catch (error) {
    const state =
      ["ENOENT", "ECONNREFUSED"].includes(error.code) ||
      /fetch failed|aborted|timed out/i.test(error.message)
        ? "waiting"
        : error.message;
    if (state !== lastState) {
      lastState = state;
      diagnostic(
        state === "waiting" ? "info" : "warn",
        state === "waiting" ? "service.waiting" : "service.poll_failed",
        error,
      );
    }
  } finally {
    polling = false;
  }
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  pluginUpdate?.close();
  clearTimeout(companionBroadcast);
  await companion?.close();
  await writeChain;
  await Promise.allSettled([...clients.values()].map((c) => c.destroy()));
  process.exit(0);
}
let interval;
(async () => {
  if (typeof WebSocket !== "function")
    throw Error("Node.js 22 or newer is required.");
  config = await readConfig();
  await modelPreferences.load().catch((e) => log("models.load_failed", e));
  await workspacePreferences.load();
  await pluginControl.load();
  library.setEnabled(
    pluginControl.enabled && workspacePreferences.current().libraryEnabled,
  );
  await desktopIcon.initialize({ suspended: !pluginControl.enabled });
  if (process.argv.includes("--check-config")) {
    console.log(
      JSON.stringify({
        version: VERSION,
        configPath: CONFIG_PATH,
        configuredProjects: Object.keys(config.projects).length,
      }),
    );
    return;
  }
  companion = await require("./companion.cjs").createCompanion({
    onChange: () => {
      if (companionBroadcast) return;
      companionBroadcast = setTimeout(async () => {
        companionBroadcast = null;
        if (stopping) return;
        try {
          const next = await companionState();
          for (const c of clients.values())
            if (c.origin)
              c.evaluate(
                `globalThis.__AGCompanion?.receive(${JSON.stringify(next)})`,
              ).catch(() => {});
        } catch {}
      }, 40);
    },
  });
  pluginUpdate = require("./plugin-update.cjs").createUpdater({
    canApply: async (manual) => {
      if (
        !pluginControl.enabled ||
        pluginControl.busy ||
        (await computerUse.status()).operation
      )
        return false;
      for (const c of clients.values()) {
        const selector =
          "[data-agpa-editor],.agpa-overlay,dialog[open],[data-agpa-library]:not([hidden])" +
          (manual ? "" : ",[data-testid=settings-nav-item-App]");
        if (
          await c
            .evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)
            .catch(() => true)
        )
          return false;
      }
      return true;
    },
  });
  await pluginUpdate.initialize();
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  log("service.started");
  await poll();
  await pluginUpdate.ready();
  if (pluginControl.enabled) pluginUpdate.start();
  interval = setInterval(poll, 1500);
  if (legacyBootstrap)
    require("./migration.cjs")
      .defer()
      .catch((e) => log("migration.pending", e));
})().catch((error) => {
  diagnostic("error", "service.start_failed", error);
  process.exitCode = 1;
});
