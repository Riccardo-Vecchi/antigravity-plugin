'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const {probe,assess,recoveryDecision}=require('../common/compatibility.cjs');
function fixture(missing=[],extra=[],expected={},originVersion){
 const selectors=['[data-testid=sidebar-toggle]','[data-testid=settings-button]','[data-testid=titlebar-more-actions]','[data-testid=settings-nav-item-App]','[data-testid=settings-nav-item-Appearance]','[data-testid=settings-nav-item-Shortcuts]','#agpa-styles','#agpa-app-settings-styles','[data-agpa-app-icon-setting]','[data-agpa-startup-setting]','[data-agpa-patch-setting]','[data-agpa-open-gemini]','#agpa-gemini-styles','#agpa-gemini-inline-styles','#agpa-window-chrome-styles'];
 const present=new Set([...selectors.filter(selector=>!missing.includes(selector)),...extra]),version='1.7.0';const context={document:{querySelector:selector=>present.has(selector)?{}:null},location:{origin:'https://127.0.0.1:1234'},electronNative:{executeJavaScriptInIsolatedWorld(){}},__AGProjectAppearance:{version,status:()=>({editorOpen:false})},__AGPAI18n:{version},__AGAppSettings:{version},__AGGeminiSwitch:{},__AGGeminiOrigin:originVersion?{version:originVersion}:undefined,__AGGeminiInline:{version},__AGShortcuts:{version,status:()=>({installed:true})}};context.top=context;vm.createContext(context);return vm.runInContext(`(${probe.toString()})('${version}',${JSON.stringify(expected)})`,context);
}
test('native hooks and applied controls produce a compatible result',()=>{
 const data=fixture();assert.equal(assess(data,'1.7.0').state,'compatible');assert.equal(recoveryDecision(data).allowed,true);
});
test('missing integration assets are repairable; missing native hooks are incompatible',()=>{
 const repairable=fixture(['#agpa-styles']);assert.equal(assess(repairable,'1.7.0').state,'needsRepair');assert.equal(recoveryDecision(repairable).allowed,true);
 const incompatible=fixture(['[data-testid=titlebar-more-actions]']);assert.equal(assess(incompatible,'1.7.0').state,'incompatible');assert.deepEqual(recoveryDecision(incompatible),{allowed:false,reason:'native'});
});
test('recovery protects an open project editor or a guest without its original controller',()=>{
 const data=fixture();assert.deepEqual(recoveryDecision({...data,editorOpen:true}),{allowed:false,reason:'editor'});assert.deepEqual(recoveryDecision(data,true),{allowed:false,reason:'session'});
});

test('Antigravity 2.28 toolbar is compatible when the old more-actions hook is absent',()=>{const data=fixture(['[data-testid=titlebar-more-actions]'],['[data-testid=pane-titlebar-toolbar]']);assert.equal(assess(data,'1.7.0').state,'compatible');assert.equal(recoveryDecision(data).allowed,true);});
test('Gemini compatibility requires the origin controller when the runtime expects it',()=>{
 assert.equal(fixture([],[],{geminiOrigin:'1.0.0'}).added.gemini,false);
 assert.equal(fixture([],[],{geminiOrigin:'1.0.0'},'0.9.0').added.gemini,false);
 assert.equal(fixture([],[],{geminiOrigin:'1.0.0'},'1.0.0').added.gemini,true);
});

test('removed technical readiness card is not a compatibility requirement',()=>{
 const data=fixture(['[data-agpa-patch-setting]']);
 assert.equal(data.added.settings,true);
 assert.equal(assess(data,'1.7.0').state,'compatible');
});
