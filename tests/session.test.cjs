'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {createSessionStore}=require('../common/session-state.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-session-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return path.join(dir,'state','session.json');}
test('last view survives a fresh store and stores no conversation or account data',async t=>{
 const file=await fixture(t),store=createSessionStore(file);assert.equal(await store.read(),'antigravity');await store.record('gemini');
 assert.equal(await createSessionStore(file).read(),'gemini');assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{version:1,lastView:'gemini'});if(process.platform!=='win32')assert.equal((await fs.stat(file)).mode&0o777,0o600);
});
test('focus reports of the same view do not rewrite state; invalid values leave it intact',async t=>{
 const file=await fixture(t),store=createSessionStore(file);await store.record('gemini');const before=await fs.stat(file);await store.record('gemini');assert.equal((await fs.stat(file)).ino,before.ino);
 await assert.rejects(store.record('other'));assert.equal(await createSessionStore(file).read(),'gemini');await store.record('antigravity');assert.equal(await createSessionStore(file).read(),'antigravity');
});
test('invalid session state falls back safely without changing the file during read',async t=>{
 const file=await fixture(t);await fs.mkdir(path.dirname(file),{recursive:true});
 for(const text of ['broken JSON',JSON.stringify({version:1,lastView:'other'}),'x'.repeat(1025)]){await fs.writeFile(file,text);assert.equal(await createSessionStore(file).read(),'antigravity');assert.equal(await fs.readFile(file,'utf8'),text);}
 const store=createSessionStore(file);await store.read();await store.record('gemini');assert.equal(await createSessionStore(file).read(),'gemini');
});
