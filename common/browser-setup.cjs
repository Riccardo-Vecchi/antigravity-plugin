"use strict";
const BROWSERS = Object.freeze([
  {
    id: "brave",
    label: "Brave",
    debugUrl: "brave://inspect/#remote-debugging",
    profiles: {
      linux: "BraveSoftware/Brave-Browser",
      win32: "BraveSoftware/Brave-Browser/User Data",
    },
    linux: ["brave-browser", "brave"],
    windows: ["BraveSoftware/Brave-Browser/Application/brave.exe"],
  },
  {
    id: "chrome",
    label: "Chrome",
    debugUrl: "chrome://inspect/#remote-debugging",
    profiles: { linux: "google-chrome", win32: "Google/Chrome/User Data" },
    linux: ["google-chrome-stable", "google-chrome"],
    windows: ["Google/Chrome/Application/chrome.exe"],
  },
  {
    id: "edge",
    label: "Edge",
    debugUrl: "edge://inspect",
    profiles: { linux: "microsoft-edge", win32: "Microsoft/Edge/User Data" },
    linux: ["microsoft-edge-stable", "microsoft-edge"],
    windows: ["Microsoft/Edge/Application/msedge.exe"],
  },
  {
    id: "vivaldi",
    label: "Vivaldi",
    debugUrl: "vivaldi://inspect/#remote-debugging",
    profiles: { linux: "vivaldi", win32: "Vivaldi/User Data" },
    linux: ["vivaldi-stable", "vivaldi"],
    windows: ["Vivaldi/Application/vivaldi.exe"],
  },
  {
    id: "opera",
    label: "Opera",
    debugUrl: "opera://inspect/#remote-debugging",
    profiles: { linux: "opera", win32: "Opera Software/Opera Stable" },
    linux: ["opera"],
    windows: ["Programs/Opera/opera.exe", "Opera/opera.exe"],
  },
  {
    id: "chromium",
    label: "Chromium",
    debugUrl: "chrome://inspect/#remote-debugging",
    profiles: { linux: "chromium", win32: "Chromium/User Data" },
    linux: ["chromium", "chromium-browser"],
    windows: ["Chromium/Application/chrome.exe"],
  },
]);
module.exports = { BROWSERS };
