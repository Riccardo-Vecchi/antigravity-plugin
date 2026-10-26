'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../shortcuts.js'),'utf8');
function fixture(){
 let visible=false,clicks=0;const listeners=new Set();const context={window:{addEventListener:(event,fn)=>listeners.add(fn),removeEventListener:(event,fn)=>listeners.delete(fn)},document:{querySelector:()=>({click(){visible=!visible;clicks++}})},__AGGeminiSwitch:{status:()=>({visible})}};vm.createContext(context);vm.runInContext(script,context);
 return {context,listeners,clicks:()=>clicks,press(patch={}){let prevented=false;const event={code:'KeyG',ctrlKey:true,altKey:true,metaKey:false,shiftKey:false,repeat:false,isComposing:false,getModifierState:()=>false,preventDefault(){prevented=true},stopImmediatePropagation(){},...patch};for(const fn of listeners)fn(event);return prevented;}};
}
test('the window-local chord toggles both views and prevents the handled key',()=>{
 const f=fixture();assert.equal(f.press(),true);assert.equal(f.context.__AGGeminiSwitch.status().visible,true);assert.equal(f.press(),true);assert.equal(f.context.__AGGeminiSwitch.status().visible,false);
});
test('ordinary typing, repeats, composition and AltGr are not intercepted',()=>{
 const f=fixture();for(const patch of [{code:'KeyA'},{ctrlKey:false},{altKey:false},{metaKey:true},{shiftKey:true},{repeat:true},{isComposing:true},{getModifierState:()=>true}])assert.equal(f.press(patch),false);assert.equal(f.clicks(),0);
});
test('reapplying or loading the shortcut twice does not duplicate listeners, and teardown removes it',()=>{
 const f=fixture();f.context.__AGShortcuts.reapply();vm.runInContext(script,f.context);assert.equal(f.listeners.size,1);f.press();assert.equal(f.clicks(),1);f.context.__AGShortcuts.destroy();assert.equal(f.listeners.size,0);
});
