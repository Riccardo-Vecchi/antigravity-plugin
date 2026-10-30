'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createTeamworkBridge}=require('../common/teamwork.cjs');
function fixture({count=0,disabled=false}={}){
 const events=[],editor={isConnected:true,getAttribute:()=>disabled?'true':null,querySelector:()=>count?{}:null,querySelectorAll:()=>Array.from({length:count}),dispatchEvent:e=>events.push(e)},root={querySelector:()=>editor},trigger={closest:()=>root};
 const bridge=createTeamworkBridge();return {bridge,trigger,editor,events};
}
test('already-active Teamwork is idempotent and never duplicates or submits a command',async()=>{
 const f=fixture({count:1});assert.equal(f.bridge.active(f.trigger),true);assert.equal(await f.bridge.set(f.trigger,true),true);assert.deepEqual(f.events,[]);
});
test('already-disabled Teamwork leaves an existing editor and draft untouched',async()=>{
 const f=fixture();assert.equal(await f.bridge.set(f.trigger,false),true);assert.deepEqual(f.events,[]);
});
test('missing or disabled native editors are rejected rather than fabricating a command',async()=>{
 const f=fixture({disabled:true});assert.equal(await f.bridge.set(f.trigger,true),false);assert.equal(await f.bridge.set({closest:()=>null},true),false);assert.deepEqual(f.events,[]);
});
test('destroying the bridge preserves native Teamwork and refuses further mutations',async()=>{
 const f=fixture({count:1});f.bridge.destroy();assert.equal(f.bridge.active(f.trigger),true);assert.equal(await f.bridge.set(f.trigger,false),false);assert.deepEqual(f.events,[]);
});
test('too many duplicate tokens fail safely without editing the prompt',async()=>{
 const f=fixture({count:33});assert.equal(await f.bridge.set(f.trigger,false),false);assert.deepEqual(f.events,[]);assert.equal(f.bridge.busy,false);
});
test('the serialized bridge is self-contained for both native renderer platforms',()=>{
 const factory=vm.runInNewContext('('+createTeamworkBridge.toString()+')',{setTimeout});const bridge=factory();assert.equal(bridge.active(null),false);bridge.destroy();
});
