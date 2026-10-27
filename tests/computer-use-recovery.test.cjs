'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createManager, SERVER, read} = require('../common/computer-use.cjs');
const {VERSION, ASSETS} = require('../common/computer-use-release.cjs');
const {connectionChecks} = require('../common/computer-use-checks.cjs');
const {helperStatus} = require('../linux/computer-use.cjs');
async function fixture(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'agpa-cu-reset-'));
 t.after(() => fs.rm(root,{recursive:true,force:true}));
 const adapter = {executable:'cua-driver',environment:async()=>({session:'wayland',needsHelper:true,helperInstalled:true,helperState:'signInRequired'}),defaultApps:async()=>[]};
 const manager = createManager({home:root,configDir:path.join(root,'plugin'),adapter});
 await fs.mkdir(manager.paths.driverDirectory,{recursive:true});
 await fs.writeFile(manager.paths.driver,'fixture driver');
 await fs.writeFile(path.join(manager.paths.driverDirectory,'receipt.json'),JSON.stringify({version:VERSION,sha256:ASSETS[`linux-${process.arch}`][1]}));
 return {root, manager};
}
async function finish(manager,action) {
 let state=await manager.perform(action,true);
 while(state.operation) {await new Promise(resolve=>setTimeout(resolve,20));state=await manager.status();}
 return state;
}
test('GNOME states distinguish installed files from an extension loaded by Shell',()=>{
 assert.equal(helperStatus(false,'State: ACTIVE'),'missing');
 assert.equal(helperStatus(true,'  State: ACTIVE'),'active');
 assert.equal(helperStatus(true,'State: ENABLED'),'active');
 assert.equal(helperStatus(true,'State: DISABLED'),'disabled');
 assert.equal(helperStatus(true,'State: ERROR'),'error');
 assert.equal(helperStatus(true,'State: OUT OF DATE'),'error');
 assert.equal(helperStatus(true,'',"Extension “winrects@cua” doesn't exist"),'signInRequired');
 assert.equal(helperStatus(true,'','timeout'),'unknown');
});
test('protocol success never turns pending desktop or capture checks green',()=>{
 assert.ok(connectionChecks({}).every(c=>!c.passed));
 const status={platform:'linux',session:'wayland',scope:'desktop',installed:true,enabled:true,registered:true,skillReady:true,helperState:'signInRequired',needsHelper:true,protocol:{ok:true}};
 const checks=Object.fromEntries(connectionChecks(status,{detected:true}).map(c=>[c.id,c.passed]));
 assert.deepEqual(checks,{driver:true,registration:true,skill:true,protocol:true,native:true,desktop:false,capture:false});
 status.needsHelper=false;status.helperState='active';status.protocol.desktop={ok:true};
 assert.ok(connectionChecks(status,{detected:true}).every(c=>c.passed));
 assert.equal(connectionChecks({...status,enabled:false},{detected:true}).find(c=>c.id==='native').passed,false);
 assert.ok(!connectionChecks({...status,scope:'apps'}).some(c=>c.id==='capture'));
 assert.equal(connectionChecks({platform:'win32',session:'windows',needsHelper:false}).find(c=>c.id==='desktop').passed,true);
});
test('reset removes only managed files and allows a fresh install, keeping shared and unrelated components',async t=>{
 const {root,manager}=await fixture(t);
 const other={mcpServers:{unrelated:{command:'original'}},setting:{keep:true}};
 await fs.mkdir(path.dirname(manager.paths.mcpFile),{recursive:true});
 await fs.writeFile(manager.paths.mcpFile,JSON.stringify(other));
 assert.equal((await manager.perform('connect',{scope:'desktop',apps:[]})).error,null);
 const shared=path.join(root,'.local/share/gnome-shell/extensions/winrects@cua/extension.js');
 await fs.mkdir(path.dirname(shared),{recursive:true});await fs.writeFile(shared,'shared');
 const unowned=path.join(manager.paths.directory,'other-installation');await fs.writeFile(unowned,'keep');
 const status=await finish(manager,'uninstall');
 assert.equal(status.error,null);assert.equal(status.installed,false);assert.equal(status.enabled,false);
 assert.deepEqual(status.removal,{skillRetained:false,sharedHelperKept:true});
 assert.deepEqual(JSON.parse(await read(manager.paths.mcpFile)),other);
 for(const file of [manager.paths.driverDirectory,manager.paths.stateFile,manager.paths.policyFile,manager.paths.skillFile])await assert.rejects(fs.lstat(file),{code:'ENOENT'});
 assert.equal(await fs.readFile(shared,'utf8'),'shared');assert.equal(await fs.readFile(unowned,'utf8'),'keep');
 assert.equal(status.scope,'desktop');assert.equal(status.skillReady,false);
});
test('reset keeps a locally edited skill and reports it clearly',async t=>{
 const {manager}=await fixture(t);await manager.perform('connect',{scope:'desktop',apps:[]});
 await fs.appendFile(manager.paths.skillFile,'\nUser edit');const skill=await read(manager.paths.skillFile);
 assert.equal((await manager.status()).skillReady,false);
 const status=await finish(manager,'uninstall');
 assert.equal(status.error,null);assert.equal(status.removal.skillRetained,true);assert.equal(await read(manager.paths.skillFile),skill);
});
test('reset refuses unowned driver folders, missing receipts and directory symlinks',async t=>{
 const {root,manager}=await fixture(t);await manager.perform('connect',{scope:'desktop',apps:[]});
 await fs.rm(path.join(manager.paths.driverDirectory,'receipt.json'));
 assert.ok((await finish(manager,'uninstall')).error);assert.equal(await read(manager.paths.driver),'fixture driver');
 assert.ok(JSON.parse(await read(manager.paths.mcpFile)).mcpServers[SERVER]);
 await fs.rm(manager.paths.driverDirectory,{recursive:true});
 const target=path.join(root,'external');await fs.mkdir(target);await fs.writeFile(path.join(target,'keep'),'untouched');
 await fs.symlink(target,manager.paths.driverDirectory);
 assert.equal((await finish(manager,'uninstall')).error,'unownedDriver');
 assert.equal(await read(path.join(target,'keep')),'untouched');
});
test('screen diagnostic discards image data and normal checks never request capture',async t=>{
 const {root}=await fixture(t);const fake=path.join(root,'fake-mcp.cjs');
 await fs.writeFile(fake,`const readline=require('node:readline');let capture=false;readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id)return;let result={};if(m.id===2)result={tools:[{name:'get_window_state'},{name:'click'},{name:'get_desktop_state'}]};if(m.id===3){capture=true;result={content:[{type:'image',data:'private-pixels',mimeType:'image/png'}]};}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
 const {probe}=require('../common/computer-use-protocol.cjs');
 const protocol=await probe(process.execPath,fake);assert.equal(protocol.ok,true);assert.equal(protocol.desktop,undefined);
 const captured=await probe(process.execPath,fake,{desktop:true});assert.equal(captured.desktop.ok,true);assert.ok(!JSON.stringify(captured).includes('private-pixels'));
});
