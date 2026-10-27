'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createController}=require('../windows/desktop.cjs');
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-win-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let enabled=false;const actions=[];
 const paths={configDir:dir};const make=()=>createController({paths,pidAlive:pid=>{if(pid!==123)throw Error('Stale process');},runProgram:async(exe,args)=>{assert.equal(exe,'powershell.exe');const action=args.at(-1);actions.push(action);if(action==='Enable')enabled=true;if(action==='Disable')enabled=false;return {stdout:JSON.stringify({enabled})};}});
 return {dir,make,actions};
}
test('Windows remembers startup and the latest view independently of native icon availability',async t=>{
 const f=await fixture(t),c=f.make();await c.initialize();await c.apply('gemini');await c.setStartupView('last');await c.setView('gemini');await c.setAutostart(true);
 const next=f.make();await next.initialize();assert.equal(next.getState().startupTarget,'gemini');assert.equal(next.getState().taskbarIcon,'gemini');assert.equal(next.getState().autostart,true);assert.equal(next.getState().desktopIconAvailable,false);
 const request=JSON.parse(await fs.readFile(path.join(f.dir,'windows-icon-request.json'),'utf8'));assert.deepEqual(request,{version:1,choice:'gemini'});
});
test('native capabilities require a live app and confirmation that its inspector closed',async t=>{
 const f=await fixture(t),c=f.make();await c.initialize();const file=path.join(f.dir,'windows-native-status.json');
 await fs.writeFile(file,JSON.stringify({version:1,updatedAt:Date.now(),pid:123,active:true,tray:true,inspectorClosed:false}));await c.ensureTray();assert.equal(c.getState().desktopIconAvailable,false);
 await fs.writeFile(file,JSON.stringify({version:1,updatedAt:Date.now(),pid:123,active:true,tray:true,inspectorClosed:true}));await c.ensureTray();assert.equal(c.getState().desktopIconAvailable,true);assert.equal(c.getState().trayAvailable,true);
 await fs.writeFile(file,JSON.stringify({version:1,updatedAt:Date.now()-60000,pid:123,active:true,tray:true,inspectorClosed:true}));await c.ensureTray();assert.equal(c.getState().desktopIconAvailable,false);
 await fs.writeFile(file,JSON.stringify({version:1,updatedAt:Date.now(),pid:999,active:true,tray:true,inspectorClosed:true}));await c.ensureTray();assert.equal(c.getState().desktopIconAvailable,false);
});
test('failed Windows preference writes roll back only the owned autostart change',async t=>{
 const f=await fixture(t),c=f.make();await c.initialize();await fs.mkdir(path.join(f.dir,'app.json'));await assert.rejects(c.setAutostart(true));assert.deepEqual(f.actions,['Read','Enable','Disable']);assert.equal(c.getState().autostart,false);
});
test('fixed and dynamic icon modes produce different requests while rejecting unknown values',async t=>{
 const f=await fixture(t),c=f.make();await c.initialize();await c.apply('dynamic');await c.setView('gemini');assert.equal(c.getState().effectiveIcon,'gemini');await c.setView('antigravity');assert.equal(c.getState().effectiveIcon,'antigravity');await assert.rejects(c.apply('other'));await assert.rejects(c.setAutostart('yes'));
});
test('custom and disabled shortcuts survive a fresh preference store',async t=>{
 const f=await fixture(t),c=f.make();await c.initialize();await c.setToggleShortcut('Ctrl+Shift+K');const next=f.make();await next.initialize();assert.equal(next.getState().toggleShortcut,'Ctrl+Shift+K');
 await next.setToggleShortcut(null);const disabled=f.make();await disabled.initialize();assert.equal(disabled.getState().toggleShortcut,null);await assert.rejects(disabled.setToggleShortcut('K'));
});
