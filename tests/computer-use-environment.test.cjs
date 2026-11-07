'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {desktopEnvironment,environment}=require('../linux/computer-use.cjs');
const {connectionChecks}=require('../common/computer-use-checks.cjs');
test('boot-started service recovers only desktop variables from its user manager',async()=>{
 const env={XDG_RUNTIME_DIR:'/run/user/1000'};
 const resolved=await desktopEnvironment(env,async()=>({stdout:'DISPLAY=:0\nWAYLAND_DISPLAY=wayland-0\nXDG_CURRENT_DESKTOP=zorin:GNOME\nXDG_SESSION_TYPE=wayland\nSECRET=private\nPATH=/untrusted\nCUA_DRIVER_PERMISSION_MODE=unsafe\n'}));
 assert.equal(resolved.WAYLAND_DISPLAY,'wayland-0');assert.equal(resolved.XDG_CURRENT_DESKTOP,'zorin:GNOME');
 assert.equal(resolved.SECRET,undefined);assert.equal(resolved.PATH,undefined);assert.equal(resolved.CUA_DRIVER_PERMISSION_MODE,undefined);assert.equal(env.WAYLAND_DISPLAY,undefined);
});
test('desktop resolution preserves explicit displays and rejects shell syntax',async()=>{
 const resolved=await desktopEnvironment({DISPLAY:':2'},async()=>({stdout:'DISPLAY=:0\nWAYLAND_DISPLAY=$(touch /tmp/test)\nXDG_CURRENT_DESKTOP=GNOME\nXDG_SESSION_TYPE=wayland\n'}));
 assert.equal(resolved.DISPLAY,':2');assert.equal(resolved.WAYLAND_DISPLAY,undefined);
 assert.deepEqual(await desktopEnvironment({},async()=>{throw Error('no systemd');}),{});
});
test('recovered Wayland session verifies GNOME helper and reaches the driver environment',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-desktop-env-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const extension=path.join(root,'gnome-shell/extensions/winrects@cua');await fs.mkdir(extension,{recursive:true});
 for(const file of ['metadata.json','extension.js'])await fs.writeFile(path.join(extension,file),'fixture');
 const result=await environment({XDG_DATA_HOME:root},async(file)=>({stdout:file.endsWith('systemctl')?'DISPLAY=:0\nWAYLAND_DISPLAY=wayland-0\nXDG_CURRENT_DESKTOP=zorin:GNOME\nXDG_SESSION_TYPE=wayland\n':'State: ACTIVE'}));
 assert.equal(result.session,'wayland');assert.equal(result.helperState,'active');assert.equal(result.needsHelper,false);
 assert.equal(result.environment.WAYLAND_DISPLAY,'wayland-0');assert.equal(result.environment.CUA_DRIVER_RS_ENABLE_WAYLAND,'1');
 const checks=connectionChecks({...result,scope:'desktop',protocol:{desktop:{ok:true}}});assert.equal(checks.find(c=>c.id==='desktop').passed,true);assert.equal(checks.find(c=>c.id==='capture').passed,true);
});
test('unknown desktop is not reported as helper not required',()=>{
 const check=connectionChecks({platform:'linux',session:'unknown',helperState:'notRequired',needsHelper:false}).find(c=>c.id==='desktop');
 assert.equal(check.label,'Desktop session unavailable');assert.equal(check.passed,false);
});
