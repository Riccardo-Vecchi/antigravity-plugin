'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const policy=require('../common/browser-extension/policy.js');
const event=()=>({listeners:[],addListener(f){this.listeners.push(f);},emit(...args){for(const f of this.listeners)f(...args);}});
async function fixture(){
 const tabs=new Map([[1,{id:1,url:'https://one.test/',title:'One'}],[2,{id:2,url:'https://two.test/',title:'Two'}],[3,{id:3,url:'chrome://settings',title:'Internal'}],[4,{id:4,url:'https://private.test/',incognito:true}]]),sent=[],attached=new Set();
 let allowed=false;
 const port={postMessage:m=>sent.push(m),onMessage:event(),onDisconnect:event()};
 const chrome={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,connectNative:()=>port,onMessage:event(),onStartup:event(),onInstalled:event()},storage:{local:{get:async()=>({profileId:crypto.randomUUID(),profileLabel:'Test'}),set:async()=>{}}},action:{setBadgeBackgroundColor:async()=>{},setBadgeText:async()=>{}},permissions:{contains:async()=>allowed,onRemoved:event()},tabs:{get:async id=>{if(!tabs.has(id))throw Error('Closed');return tabs.get(id);},query:async q=>q.active?[tabs.get(1)]:[...tabs.values()],onCreated:event(),onUpdated:event(),onRemoved:event()},debugger:{getTargets:async()=>[],attach:async target=>attached.add(target.tabId),detach:async target=>attached.delete(target.tabId),sendCommand:async(target,method)=>method==='Accessibility.getFullAXTree'?{nodes:[]}: {},onEvent:event(),onDetach:event()}};
 const context={chrome,crypto,AGPApolicy:policy,importScripts(){},setTimeout:()=>0,clearTimeout(){},URL,console};vm.createContext(context);vm.runInContext(await fs.readFile(path.join(__dirname,'../common/browser-extension/worker.js'),'utf8'),context);
 await new Promise(setImmediate);port.onMessage.emit({reply:'announce',result:true});await new Promise(setImmediate);
 return {tabs,sent,attached,chrome,run:expression=>vm.runInContext(expression,context),allow:()=>{allowed=true;},state:()=>vm.runInContext('uiState()',context),tick:()=>new Promise(setImmediate),disconnect:()=>port.onDisconnect.emit()};
}
test('selected-tab access stays origin-bound and never shares other open tabs',async()=>{
 const f=await fixture();await f.run('shareCurrent()');assert.deepEqual([...f.attached],[1]);assert.equal((await f.state()).shared.length,1);
 f.tabs.set(1,{id:1,url:'https://elsewhere.test/'});
 await assert.rejects(f.run('execute("browser_snapshot",{tab:1})'),/site changed/);
 assert.equal((await f.state()).shared.length,0);
});
test('whole-profile sharing requires permission, excludes private/internal pages and attaches lazily',async()=>{
 const f=await fixture();await assert.rejects(f.run('setScope("profile")'),/Allow access/);f.allow();await f.run('setScope("profile")');
 assert.deepEqual(Array.from((await f.state()).shared,t=>t.id),[1,2]);assert.equal(f.attached.size,0);
 await f.run('execute("browser_snapshot",{tab:2})');assert.deepEqual([...f.attached],[2]);
 f.tabs.set(5,{id:5,url:'https://new.test/',title:'New'});f.chrome.tabs.onCreated.emit(f.tabs.get(5));await f.tick();await f.tick();assert.equal((await f.state()).shared.length,3);
 f.tabs.set(2,{id:2,url:'https://different.test/'});await f.run('execute("browser_snapshot",{tab:2})');assert.equal((await f.state()).scope,'profile');
 await f.run('execute("browser_navigate",{tab:2,url:"https://third.test/"})');
});
test('whole-profile per-tab exclusions survive navigation, and stop/disconnect cannot silently reactivate sharing',async()=>{
 const f=await fixture();f.allow();await f.run('setScope("profile")');
 const sender={id:'test',url:'chrome-extension://test/popup.html'};
 await new Promise(resolve=>f.chrome.runtime.onMessage.listeners[0]({action:'revoke',tab:2},sender,resolve));
 f.tabs.set(2,{id:2,url:'https://another.test/'});f.chrome.tabs.onUpdated.emit(2,{url:'https://another.test/'});await f.tick();await f.tick();assert.deepEqual(Array.from((await f.state()).shared,t=>t.id),[1]);
 await f.run('revokeAll()');await f.run('syncProfile()');assert.equal((await f.state()).scope,'tabs');assert.equal((await f.state()).shared.length,0);
 await f.run('setScope("profile")');f.disconnect();await f.tick();assert.equal((await f.state()).scope,'tabs');assert.equal((await f.state()).shared.length,0);
});
test('browser cancellation and optional permission removal revoke whole-profile sharing',async()=>{
 const f=await fixture();f.allow();await f.run('setScope("profile")');await f.run('execute("browser_snapshot",{tab:1})');
 f.chrome.debugger.onDetach.emit({tabId:1},'canceled_by_user');await f.tick();await f.tick();assert.equal((await f.state()).scope,'tabs');assert.equal((await f.state()).shared.length,0);
 await f.run('setScope("profile")');f.chrome.permissions.onRemoved.emit({permissions:['tabs']});await f.tick();await f.tick();assert.equal((await f.state()).shared.length,0);
});
test('branded deployment updates its own extension and preserves an unrelated folder',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-extension-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const {deploy}=require('../common/browser-extension.cjs'),directory=path.join(root,'antigravity-plugin','browser-extension');await deploy(directory);
 const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json')));assert.equal(manifest.name,'Antigravity Browser');
 await fs.writeFile(path.join(directory,'popup.css'),'old');await deploy(directory);assert.equal(await fs.readFile(path.join(directory,'popup.css'),'utf8'),await fs.readFile(path.join(__dirname,'../common/browser-extension/popup.css'),'utf8'));
 await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({key:'foreign'}));await assert.rejects(deploy(directory),/another installation/);assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'manifest.json'))),{key:'foreign'});
});
test('setup advances only when native registration, extension and shared tabs are actually ready',()=>{
 const {setupState}=require('../common/browser-setup.cjs');
 const base={enabled:false,registered:false,connections:[]};assert.equal(setupState(base),'prepare');
 assert.equal(setupState({...base,enabled:true,registered:true}),'install');
 assert.equal(setupState({...base,enabled:true,registered:true,connections:[{tabs:0}]}),'share');
 assert.equal(setupState({...base,enabled:true,registered:true,connections:[{tabs:2}]}),'ready');
 assert.equal(setupState({...base,connections:[{tabs:2}]}),'prepare');
});
test('all extension interface messages and substitutions are translated in each supported browser language',()=>{
 const en=require('../common/browser-extension/_locales/en/messages.json');
 for(const lang of ['it','de','es','fr','zh_CN','ja']){const locale=require('../common/browser-extension/_locales/'+lang+'/messages.json');assert.deepEqual(Object.keys(locale).sort(),Object.keys(en).sort());for(const [key,m]of Object.entries(locale)){assert.ok(m.message.trim());assert.deepEqual(Object.keys(m.placeholders||{}),Object.keys(en[key].placeholders||{}));}}
});
test('opening browser setup allows only known browser IDs and a fixed Extensions URL',async t=>{
 if(process.platform!=='linux')return t.skip();
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-open-browser-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const executable=path.join(root,'brave-browser'),output=path.join(root,'opened');
 await fs.writeFile(executable,'#!/bin/sh\nprintf "%s" "$1" > "$HOME/opened"\n',{mode:0o700});
 const adapter=require('../linux/browser.cjs');await assert.rejects(adapter.openExtensions('arbitrary',{env:{HOME:root,PATH:root}}),/Unsupported/);
 await assert.rejects(adapter.openExtensions('brave',{env:{HOME:root,PATH:root},profileDirectory:'../../other'}),/Invalid/);
 await adapter.openExtensions('brave',{env:{HOME:root,PATH:root}});
 let value;for(let n=0;n<30;n++){value=await fs.readFile(output,'utf8').catch(()=>null);if(value)break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(value,'brave://extensions');
});
test('missing legacy scope metadata does not block a connected extension or shared tabs',()=>{
 const {setupState}=require('../common/browser-setup.cjs');assert.equal(setupState({enabled:true,registered:true,connections:[{tabs:0}],needsReload:true}),'share');assert.equal(setupState({enabled:true,registered:true,connections:[{tabs:4}],needsReload:true}),'ready');
});
test('installed-extension recovery opens only its fixed details URL in a validated existing profile',async t=>{
 if(process.platform!=='linux')return t.skip();
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-profile-browser-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'brave-browser'),'#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/args"\n',{mode:0o700});
 await require('../linux/browser.cjs').openExtensions('brave',{env:{HOME:root,PATH:root},profileDirectory:'Profile 2',details:true});
 let args;for(let n=0;n<30;n++){args=await fs.readFile(path.join(root,'args'),'utf8').catch(()=>null);if(args)break;await new Promise(r=>setTimeout(r,10));}
 assert.deepEqual(args.trim().split('\n'),['--profile-directory=Profile 2','brave://extensions?id='+require('../common/browser-identity.json').extensionId]);
});
