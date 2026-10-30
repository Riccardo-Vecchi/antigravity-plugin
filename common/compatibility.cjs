'use strict';
// This function is serialized into the native local page. It reads only UI hooks.
function probe(version,expected={}){
 const exists=selector=>!!document.querySelector(selector);
 const local=globalThis.top===globalThis&&/^https:\/\/127\.0\.0\.1:\d+$/.test(location.origin);
 const settingsOpen=exists('[role=dialog][aria-label=Settings]')||exists('[data-testid=settings-nav-item-App]');
 const native={
  interface:local&&exists('[data-testid=sidebar-toggle]')&&exists('[data-testid=settings-button]')&&(exists('[data-testid=titlebar-more-actions]')||exists('[data-testid=pane-titlebar-toolbar]')),
  settings:!settingsOpen||(exists('[data-testid=settings-nav-item-App]')&&exists('[data-testid=settings-nav-item-Appearance]')&&exists('[data-testid=settings-nav-item-Shortcuts]')),
  guest:typeof globalThis.electronNative?.executeJavaScriptInIsolatedWorld==='function'
 };
 const added={
  projects:globalThis.__AGProjectAppearance?.version===(expected.appearance||version)&&exists('#agpa-styles'),
  settings:globalThis.__AGAppSettings?.version===(expected.settings||version)&&globalThis.__AGPAI18n?.version===(expected.i18n||version)&&exists('#agpa-app-settings-styles')&&(!settingsOpen||(exists('[data-agpa-app-icon-setting]')&&exists('[data-agpa-startup-setting]'))),
  gemini:(!expected.geminiOrigin||globalThis.__AGGeminiOrigin?.version===expected.geminiOrigin)&&(!expected.headerPlacement||globalThis.__AGHeaderPlacement?.version===expected.headerPlacement)&&!!globalThis.__AGGeminiSwitch&&exists('[data-agpa-open-gemini]')&&exists('#agpa-gemini-styles')&&globalThis.__AGGeminiInline?.version===(expected.inline||version)&&exists('#agpa-gemini-inline-styles')&&exists('#agpa-window-chrome-styles'),
  shortcut:globalThis.__AGShortcuts?.version===(expected.shortcuts||version)&&!!globalThis.__AGShortcuts?.status().installed
 };
 return {native,added,editorOpen:!!globalThis.__AGProjectAppearance?.status().editorOpen};
}
function assess(data,version){
 const nativeCompatible=Object.values(data.native).every(value=>value===true);
 const checks=[
  {id:'native',label:'Native interface',ok:nativeCompatible},
  {id:'projects',label:'Project appearance',ok:data.added.projects===true},
  {id:'settings',label:'Settings integration',ok:data.added.settings===true},
  {id:'gemini',label:'Gemini switching',ok:data.added.gemini===true},
  {id:'shortcut',label:'Keyboard shortcut',ok:data.added.shortcut===true}
 ];
 return {version,checkedAt:new Date().toISOString(),state:!nativeCompatible?'incompatible':checks.every(check=>check.ok)?'compatible':'needsRepair',checks};
}
function recoveryDecision(data,sessionUnsafe=false){
 if(Object.values(data.native).some(value=>value!==true))return {allowed:false,reason:'native'};
 if(data.editorOpen)return {allowed:false,reason:'editor'};
 if(sessionUnsafe)return {allowed:false,reason:'session'};
 return {allowed:true};
}
module.exports={probe,assess,recoveryDecision};
