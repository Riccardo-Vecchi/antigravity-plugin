"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {createProbe,extensionId}=require("../common/browser-installation.cjs"),identity=require("../common/browser-identity.json"),manifest=require("../common/browser-extension/manifest.json"),{setupState}=require("../common/browser-setup.cjs");
async function fixture(t,platform="linux",browser="brave") {
 const home=await fs.mkdtemp(path.join(os.tmpdir(),"agpa-extension-probe-"));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const env={XDG_CONFIG_HOME:path.join(home,"xdg"),LOCALAPPDATA:path.join(home,"local"),APPDATA:path.join(home,"roaming")};
 const base=platform==="linux"?path.join(env.XDG_CONFIG_HOME,"BraveSoftware/Brave-Browser"):browser==="opera"?path.join(env.APPDATA,"Opera Software/Opera Stable"):path.join(env.LOCALAPPDATA,"BraveSoftware/Brave-Browser/User Data");
 const folder=browser==="opera"?base:path.join(base,"Profile 2"),extension=path.join(home,"extension");await fs.mkdir(folder,{recursive:true});await fs.mkdir(extension);
 await fs.writeFile(path.join(extension,"manifest.json"),JSON.stringify(manifest));
 const preferences=path.join(folder,"Preferences");
 async function write(entry={},secure=false){await fs.writeFile(secure?path.join(folder,"Secure Preferences"):preferences,JSON.stringify({extensions:{settings:{[identity.extensionId]:{path:extension,disable_reasons:[],...entry},aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:{private:"NEVER RETURN OTHER EXTENSIONS"}}},privateAccount:"NEVER RETURN ACCOUNT DETAILS"}));}
 await write();let now=0;
 const probe=createProbe({platform,home,env,now:()=>now});
 return {home,base,folder,extension,preferences,write,probe,available:[{id:browser,label:"Browser"}],advance:()=>now+=10000,browser};
}
test("installed, disabled, outdated and broken are distinguished without returning profile/account data",async t=>{
 const f=await fixture(t);let data=await f.probe.inspect(f.available);
 assert.deepEqual(data.brave,{status:"installed",profiles:1});assert.equal(f.probe.target("brave"),"Profile 2");
 assert.ok(!JSON.stringify(data).includes(f.home));assert.ok(!JSON.stringify(data).includes("NEVER RETURN"));
 await f.write({disable_reasons:[1024]});assert.equal((await f.probe.inspect(f.available)).brave.status,"installed");
 assert.equal((await f.probe.inspect(f.available,{force:true})).brave.status,"disabled");
 await f.write();await fs.writeFile(path.join(f.extension,"manifest.json"),JSON.stringify({...manifest,version:"0.0.1"}));
 f.advance();assert.equal((await f.probe.inspect(f.available)).brave.status,"reload");
 await fs.rm(f.extension,{recursive:true});f.advance();assert.equal((await f.probe.inspect(f.available)).brave.status,"broken");
});
test("protected preferences take priority, other extension IDs and removed records are ignored",async t=>{
 const f=await fixture(t);await f.write({state:0},true);
 assert.equal((await f.probe.inspect(f.available)).brave.status,"disabled");
 await f.write({external_uninstalled:true},true);assert.equal((await f.probe.inspect(f.available,{force:true})).brave.status,"notFound");
 await fs.rm(path.join(f.folder,"Secure Preferences"));await fs.writeFile(f.preferences,JSON.stringify({extensions:{settings:{aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:{path:f.extension}}}}));
 assert.equal((await f.probe.inspect(f.available,{force:true})).brave.status,"notFound");
});
test("missing or unreadable metadata stays distinct from a verified installation; copied branding cannot impersonate the fixed key",async t=>{
 const f=await fixture(t);await fs.writeFile(f.preferences,"{broken");
 assert.equal((await f.probe.inspect(f.available)).brave.status,"unknown");
 await f.write();await fs.writeFile(path.join(f.extension,"manifest.json"),JSON.stringify({...manifest,key:"different"}));
 assert.equal((await f.probe.inspect(f.available,{force:true})).brave.status,"unknown");
 assert.equal(extensionId(manifest.key),identity.extensionId);
});
test("standard Windows profile locations and Opera's direct profile are supported without exposing names",async t=>{
 for(const browser of ["brave","opera"]){const f=await fixture(t,"win32",browser);assert.deepEqual((await f.probe.inspect(f.available))[browser],{status:"installed",profiles:1});assert.equal(f.probe.target(browser),browser==="opera"?null:"Profile 2");}
});
test("symlinked metadata is not followed",{skip:process.platform==="win32"},async t=>{
 const f=await fixture(t),outside=path.join(f.home,"outside.json");await fs.rename(f.preferences,outside);await fs.symlink(outside,f.preferences);
 assert.equal((await f.probe.inspect(f.available)).brave.status,"unknown");
});
test("only the selected browser's installation changes the setup step; a live connection remains the ready signal",()=>{
 const base={enabled:true,registered:true,connections:[],installations:{brave:{status:"installed"},chrome:{status:"notFound"}}};
 assert.equal(setupState(base,"brave"),"reconnect");assert.equal(setupState(base,"chrome"),"install");
 assert.equal(setupState({...base,installations:{brave:{status:"disabled"}}},"brave"),"reconnect");
 assert.equal(setupState({...base,installations:{brave:{status:"reload"}}},"brave"),"install");
 assert.equal(setupState({...base,connections:[{tabs:0}]},"brave"),"share");
 assert.equal(setupState({...base,connections:[{tabs:1}]},"brave"),"ready");
 assert.equal(setupState({...base,enabled:false},"brave"),"prepare");
});
