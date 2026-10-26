'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const script=fs.readFileSync(path.join(__dirname,'../app-settings.js'),'utf8');
async function fixture({startupView='antigravity',guestCreated=false,visible=false,preserved=false}={}){
 let opens=0;const observers=[],events=[];
 const element=()=>({setAttribute(){},append(){},remove(){},textContent:''});
 const document={createElement:element,head:element(),body:element(),querySelectorAll:()=>[],querySelector:selector=>selector==='[data-agpa-open-gemini]'?{click(){opens++;visible=true;guestCreated=true}}:null};
 const context={__AGPAI18n:{attrs(){},subscribe(){return()=>{}},language:'en'},document,crypto,queueMicrotask,setTimeout,clearTimeout,MutationObserver:class{constructor(cb){this.cb=cb;observers.push(this)}observe(){}disconnect(){}},__AGPA_STARTUP_APPLIED__:preserved,__AGPA_APP_SETTINGS__:{version:2,taskbarIcon:'dynamic',startupView,autostart:false},__AGPA_APP_ICON_ASSETS__:{antigravity:'local-a',gemini:'local-g'},__AGGeminiSwitch:{status:()=>({visible,guestCreated})},__agpaAppSettings:raw=>events.push(JSON.parse(raw))};
 context.window={addEventListener(){},removeEventListener(){}};vm.createContext(context);vm.runInContext(script,context);await new Promise(setImmediate);
 return {context,events,opens:()=>opens,mutate:async()=>{for(const o of observers)o.cb();await new Promise(setImmediate)},setVisible:value=>{visible=value}};
}
test('fresh window opens Gemini once when selected as startup view',async()=>{
 const f=await fixture({startupView:'gemini'});assert.equal(f.opens(),1);assert.equal(f.events.at(-1).value,'gemini');await f.mutate();await f.mutate();assert.equal(f.opens(),1);f.context.__AGAppSettings.destroy();
});
test('fresh Antigravity startup does not create a Gemini guest',async()=>{
 const f=await fixture();assert.equal(f.opens(),0);assert.equal(f.events.at(-1).value,'antigravity');f.context.__AGAppSettings.destroy();
});
test('upgrading an existing guest preserves the current view',async()=>{
 const f=await fixture({startupView:'gemini',guestCreated:true,visible:false});assert.equal(f.opens(),0);assert.equal(f.events.at(-1).value,'antigravity');f.context.__AGAppSettings.destroy();
});
test('preserved windows do not reapply the startup choice on helper reload',async()=>{
 const f=await fixture({startupView:'gemini',preserved:true});assert.equal(f.opens(),0);f.context.__AGAppSettings.destroy();
});
test('changing startup preference affects only future windows',async()=>{
 const f=await fixture();f.context.__AGAppSettings.setState({version:2,taskbarIcon:'dynamic',startupView:'gemini',autostart:false});await f.mutate();assert.equal(f.opens(),0);f.context.__AGAppSettings.destroy();
});
test('view navigation reports changes once without rewriting preferences',async()=>{
 const f=await fixture();f.setVisible(true);await f.mutate();const count=f.events.length;await f.mutate();assert.equal(f.events.length,count);assert.equal(f.events.at(-1).action,'viewChanged');assert.equal(f.events.at(-1).value,'gemini');f.context.__AGAppSettings.destroy();
});
