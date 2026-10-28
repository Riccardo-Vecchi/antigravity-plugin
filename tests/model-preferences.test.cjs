'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createStore,validate,providerFor,permissionFor}=require('../common/model-preferences.cjs');
test('model preferences persist independently without selecting or removing native models',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-models-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'config/models.json'),store=createStore(file);await store.load();
 await store.update({name:'Claude Sonnet 4.6 (Thinking)',field:'favorite',value:true});await store.update({name:'Gemini 4 Argon',field:'hidden',value:true});
 const reopened=createStore(file);assert.deepEqual(await reopened.load(),{version:1,models:{'Claude Sonnet 4.6 (Thinking)':{favorite:true,hidden:false},'Gemini 4 Argon':{favorite:false,hidden:true}}});
 await reopened.update({name:'Gemini 4 Argon',field:'hidden',value:false});assert.equal(reopened.current().models['Gemini 4 Argon'],undefined);
 if(process.platform!=='win32')assert.equal((await fs.stat(file)).mode&0o777,0o600);
});
test('malformed preferences and unsupported writes are rejected without replacing user data',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-model-bad-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'models.json');await fs.writeFile(file,'not json');const store=createStore(file);
 await assert.rejects(store.update({name:'Claude',field:'favorite',value:true}));assert.equal(await fs.readFile(file,'utf8'),'not json');
 for(const patch of [{name:'__proto__',field:'hidden',value:true},{name:'Claude',field:'selected',value:true},{name:'Claude',field:'hidden',value:'true'}])await assert.rejects(store.update(patch));
 assert.throws(()=>validate({version:1,models:{Claude:{favorite:true}}}));
});
test('provider identification is specific and unknown labs do not inherit a misleading logo',()=>{
 for(const label of ['Claude Sonnet','Anthropic Claude'])assert.equal(providerFor(label),'anthropic');
 for(const label of ['Gemini 3.8 Flash','Google Gemini'])assert.equal(providerFor(label),'google');
 for(const label of ['GPT-OSS 120B','GPT-5','o3-mini','OpenAI model'])assert.equal(providerFor(label),'openai');
 assert.equal(providerFor('Custom local model'),null);
});
test('permission colors classify labels without altering permission data',()=>{
 assert.equal(permissionFor('Request Review'),'review');assert.equal(permissionFor('Default'),'default');assert.equal(permissionFor('Auto (Preview)'),'auto');assert.equal(permissionFor('Turbo'),'turbo');assert.equal(permissionFor('Unknown'),null);
});
