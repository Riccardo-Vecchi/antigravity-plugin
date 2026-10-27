'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createManager}=require('../common/computer-use.cjs');
const {VERSION,checkForUpdates,downloadVerified}=require('../common/computer-use-release.cjs');
const {shouldAutoCapture}=require('../common/computer-use-checks.cjs');
async function fixture(t,{ready=true,probe}={}) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-cu-progress-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let active=ready;
 const adapter={executable:'cua-driver',environment:async()=>({session:'wayland',needsHelper:!active,helperInstalled:true,helperState:active?'active':'signInRequired'}),defaultApps:async()=>[]};
 const manager=createManager({home:root,configDir:path.join(root,'plugin'),adapter,probe});
 await fs.mkdir(manager.paths.driverDirectory,{recursive:true});
 await fs.writeFile(manager.paths.driver,'#!'+process.execPath+'\nconsole.log('+JSON.stringify('cua-driver '+VERSION)+');\n',{mode:0o700});
 await fs.writeFile(path.join(manager.paths.driverDirectory,'receipt.json'),JSON.stringify({version:VERSION}));
 return {manager,activate(){active=true;}};
}
async function settled(manager) {
 for(let i=0;i<100;i++){const s=await manager.status();if(!s.operation)return s;await new Promise(r=>setTimeout(r,10));}throw Error('Operation did not finish');
}
test('automatic capture runs only for enabled, ready desktop sessions and not in a retry loop',()=>{
 const state={enabled:true,scope:'desktop',session:'wayland',needsHelper:false,captureAttempted:false};
 assert.equal(shouldAutoCapture(state),true);
 for(const change of [{scope:'apps'},{needsHelper:true},{captureAttempted:true},{operation:'setup'},{error:'protocolFailed'},{session:'unknown'},{enabled:false}])assert.equal(shouldAutoCapture({...state,...change}),false);
});
test('setup reports real handshake/capture progress and automatically tests a ready desktop once',async t=>{
 let enter,finish;const started=new Promise(r=>enter=r);const pending=new Promise(r=>finish=r);let calls=0;
 const {manager}=await fixture(t,{probe:async(runtime,bridge,options)=>{calls++;options.onHandshake({ok:true,toolCount:17});enter(options);return pending;}});
 await manager.perform('setup',{scope:'desktop',apps:[]});
 const options=await started;assert.equal(options.desktop,true);
 const running=await manager.status();assert.equal(running.operation,'setup');assert.equal(running.progress.step,'capture');assert.equal(running.protocol.ok,true);assert.equal(running.captureAttempted,true);
 finish({ok:true,toolCount:17,desktop:{ok:true}});
 const done=await settled(manager);assert.equal(done.enabled,true);assert.equal(done.progress,null);assert.equal(done.protocol.desktop.ok,true);
 await manager.perform('verify',true);assert.equal(calls,1);
});
test('activation after login triggers one automatic test; capture failure requires an explicit retry',async t=>{
 const modes=[];
 const {manager,activate}=await fixture(t,{ready:false,probe:async(runtime,bridge,options)=>{modes.push(options.desktop);options.onHandshake({ok:true,toolCount:17});return {ok:true,toolCount:17,...(options.desktop?{desktop:{ok:false}}:{})};}});
 await manager.perform('setup',{scope:'desktop',apps:[]});let s=await settled(manager);
 assert.deepEqual(modes,[false]);assert.equal(s.autoCapturePending,false);
 activate();s=await manager.perform('refresh');assert.equal(s.autoCapturePending,true);
 await manager.perform('verify');s=await settled(manager);assert.deepEqual(modes,[false,true]);assert.equal(s.captureAttempted,true);assert.equal(s.autoCapturePending,false);assert.equal(s.protocol.desktop.ok,false);
 await manager.perform('verify');assert.equal(modes.length,2);
 await manager.perform('capture');await settled(manager);assert.equal(modes.length,3);
});
test('Selected apps setup never takes an automatic full-desktop screenshot',async t=>{
 const modes=[];const {manager}=await fixture(t,{probe:async(runtime,bridge,options)=>{modes.push(options.desktop);return {ok:true,toolCount:14};}});
 await manager.perform('setup',{scope:'apps',apps:[manager.paths.driver]});const s=await settled(manager);
 assert.equal(s.autoCapturePending,false);assert.deepEqual(modes,[false]);
});
test('stopping during capture cannot later report a successful obsolete connection',async t=>{
 let enter,finish;const started=new Promise(r=>enter=r);const pending=new Promise(r=>finish=r);
 const {manager}=await fixture(t,{probe:async()=>{enter();return pending;}});
 await manager.perform('setup',{scope:'desktop',apps:[]});await started;
 await manager.perform('disconnect');finish({ok:true,desktop:{ok:true}});const s=await settled(manager);
 assert.equal(s.enabled,false);assert.equal(s.protocol,null);assert.equal(s.error,null);
});
test('download progress reports actual received bytes before a checksum failure',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-cu-bytes-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const events=[];
 await assert.rejects(()=>downloadVerified(path.join(root,'download'),'linux','x64',async()=>new Response('sample',{headers:{'content-length':'6'}}),undefined,event=>events.push(event)),/checksum/);
 assert.ok(events.some(e=>e.phase==='download'&&e.received===6&&e.total===6));assert.equal(events.at(-1).phase,'verify');
});
test('update checks filter other Cua products/nightlies/drafts and compare numeric regular versions',async()=>{
 const items=[{tag_name:'nightly-cua-driver-rs-v99.0.0'},{tag_name:'cua-spaces-v88.0.0'},{tag_name:'cua-driver-rs-v99.0.0',draft:true},{tag_name:'cua-driver-rs-v0.9.0'},{tag_name:'cua-driver-rs-v0.38.0',prerelease:true},{tag_name:'cua-driver-rs-v0.37.0'}];
 const result=await checkForUpdates(async(url,options)=>{assert.match(url,/^https:\/\/api.github.com\/repos\/trycua\/cua\/releases\?/);assert.ok(options.signal);return new Response(JSON.stringify(items));});
 assert.equal(result.version,'0.38.0');assert.equal(result.available,true);assert.equal(result.prerelease,true);assert.equal(result.reviewedVersion,VERSION);assert.equal(result.url,'https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.38.0');
 const current=await checkForUpdates(async()=>new Response(JSON.stringify([{tag_name:'cua-driver-rs-v'+VERSION}])));assert.equal(current.available,false);
});
test('unavailable release discovery is an error, never a false up-to-date result',async()=>{
 await assert.rejects(()=>checkForUpdates(async()=>new Response('rate limit',{status:403})),/updateCheckFailed/);
 await assert.rejects(()=>checkForUpdates(async()=>new Response('[]')),/updateCheckFailed/);
});
