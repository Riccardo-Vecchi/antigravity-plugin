"use strict";
const BROWSERS = Object.freeze([
  {
    id: "brave",
    label: "Brave",
    debugUrl: "brave://inspect/#remote-debugging",
    profiles: {
      linux: "BraveSoftware/Brave-Browser",
      win32: "BraveSoftware/Brave-Browser/User Data",
      darwin: "BraveSoftware/Brave-Browser",
    },
    linux: ["brave-browser", "brave"],
    windows: ["BraveSoftware/Brave-Browser/Application/brave.exe"],
    macos: {
      app: "Brave Browser.app",
      bin: "Contents/MacOS/Brave Browser",
      bundleId: "com.brave.browser",
    },
  },
  {
    id: "chrome",
    label: "Chrome",
    debugUrl: "chrome://inspect/#remote-debugging",
    profiles: {
      linux: "google-chrome",
      win32: "Google/Chrome/User Data",
      darwin: "Google/Chrome",
    },
    linux: ["google-chrome-stable", "google-chrome"],
    windows: ["Google/Chrome/Application/chrome.exe"],
    macos: {
      app: "Google Chrome.app",
      bin: "Contents/MacOS/Google Chrome",
      bundleId: "com.google.chrome",
    },
  },
  {
    id: "edge",
    label: "Edge",
    debugUrl: "edge://inspect",
    profiles: {
      linux: "microsoft-edge",
      win32: "Microsoft/Edge/User Data",
      darwin: "Microsoft Edge",
    },
    linux: ["microsoft-edge-stable", "microsoft-edge"],
    windows: ["Microsoft/Edge/Application/msedge.exe"],
    macos: {
      app: "Microsoft Edge.app",
      bin: "Contents/MacOS/Microsoft Edge",
      bundleId: "com.microsoft.edgemac",
    },
  },
  {
    id: "vivaldi",
    label: "Vivaldi",
    debugUrl: "vivaldi://inspect/#remote-debugging",
    profiles: {
      linux: "vivaldi",
      win32: "Vivaldi/User Data",
      darwin: "Vivaldi",
    },
    linux: ["vivaldi-stable", "vivaldi"],
    windows: ["Vivaldi/Application/vivaldi.exe"],
    macos: {
      app: "Vivaldi.app",
      bin: "Contents/MacOS/Vivaldi",
      bundleId: "com.vivaldi.vivaldi",
    },
  },
  {
    id: "opera",
    label: "Opera",
    debugUrl: "opera://inspect/#remote-debugging",
    profiles: {
      linux: "opera",
      win32: "Opera Software/Opera Stable",
      darwin: "com.operasoftware.Opera",
    },
    linux: ["opera"],
    windows: ["Programs/Opera/opera.exe", "Opera/opera.exe"],
    macos: {
      app: "Opera.app",
      bin: "Contents/MacOS/Opera",
      bundleId: "com.operasoftware.opera",
    },
  },
  {
    id: "chromium",
    label: "Chromium",
    debugUrl: "chrome://inspect/#remote-debugging",
    profiles: {
      linux: "chromium",
      win32: "Chromium/User Data",
      darwin: "Chromium",
    },
    linux: ["chromium", "chromium-browser"],
    windows: ["Chromium/Application/chrome.exe"],
    macos: {
      app: "Chromium.app",
      bin: "Contents/MacOS/Chromium",
      bundleId: "org.chromium.chromium",
    },
  },
]);
module.exports = { BROWSERS };
