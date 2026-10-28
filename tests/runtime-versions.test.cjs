"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const versions=require("../common/versions.cjs");
test("renderer versions match the daemon's injection guards",()=>{
  const scripts={appearance:"renderer.js",geminiSwitch:"gemini-switch.js",inline:"gemini-inline.js",
    settings:"app-settings.js",i18n:"i18n.js",shortcuts:"shortcuts.js",computerUse:"computer-use-settings.js",
    settingsNavigation:"settings-navigation.js",headerPlacement:"header-placement.js",
    companion:"companion-ui.js",updates:"plugin-update-settings.js"};
  for(const [key,file]of Object.entries(scripts)){
    const code=fs.readFileSync(path.join(__dirname,"../common",file),"utf8");
    assert.equal(code.match(/const VERSION\s*=\s*(['"])([^'"]+)\1/)?.[2],versions[key],file);
  }
});
