'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {installNativeController}=require('../windows-native-controller.cjs');
async function fixture(t){
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'agpa-native-'));t.after(()=>fsp.rm(dir,{recursive:true,force:true}));let callback=null;const events=new Map(),images=[],details=[];
 const window={isDestroyed:()=>false,setIcon:image=>images.push(image.id),setAppDetails:value=>details.push(value)};const tray={isDestroyed:()=>false,setImage:image=>images.push('tray:'+image.id)};
 const requestFile=path.join(dir,'request.json'),statusFile=path.join(dir,'status.json');fs.writeFileSync(requestFile,JSON.stringify({version:1,choice:'antigravity'}));
 const fakeFs={...fs,watchFile:(file,options,fn)=>{assert.equal(file,requestFile);assert.equal(options.persistent,false);callback=fn;},unwatchFile:()=>{callback=null;}};
 const electron={app:{on:(name,fn)=>events.set(name,fn),removeListener:name=>events.delete(name)},BrowserWindow:{getAllWindows:()=>[window]},nativeImage:{createFromPath:id=>({id,isEmpty:()=>false})}};
 const context={setInterval:()=>({unref(){}}),clearInterval(){},process:{pid:123,execPath:'C:\\Programs\\Antigravity.exe',resourcesPath:'/vendor/resources',mainModule:{require:name=>name==='electron'?electron:name==='node:fs'?fakeFs:require(name)}},tray,options:{requestFile,statusFile,geminiPng:'/icons/gemini.png',geminiIco:'C:\\icons\\gemini.ico',nonce:'test-nonce'}};
 vm.createContext(context);vm.runInContext(`(${installNativeController.toString()}).call(tray,options)`,context);
 return {context,events,images,details,status:()=>JSON.parse(fs.readFileSync(statusFile,'utf8')),request:value=>{fs.writeFileSync(requestFile,typeof value==='string'?value:JSON.stringify(value));callback?.();},watching:()=>!!callback};
}
test('native icon updates retain the existing tray and report inspector closure across changes',async t=>{
 const f=await fixture(t);assert.equal(f.status().inspectorClosed,false);f.context.__AGPAWindowsNativeIcons__.markInspectorClosed();f.request({version:1,choice:'gemini'});assert.equal(f.status().choice,'gemini');assert.equal(f.status().inspectorClosed,true);assert.ok(f.images.includes('tray:/icons/gemini.png'));assert.equal(f.details.length,0);assert.equal(f.events.size,1);
});
test('native watcher ignores arbitrary paths, oversized and unsupported requests',async t=>{
 const f=await fixture(t),before=f.images.length;f.request({version:1,choice:'../../unknown.exe'});f.request('x'.repeat(2049));assert.equal(f.images.length,before);assert.equal(f.status().choice,'antigravity');
});
test('restore stops only this controller and restores the official application and tray images',async t=>{
 const f=await fixture(t);f.request({version:1,choice:'gemini'});f.request({version:1,choice:'antigravity',restore:true});assert.equal(f.watching(),false);assert.equal(f.events.size,0);assert.equal(f.status().active,false);assert.match(f.images.at(-1),/tray:.*app\.asar[/\\]icon\.png$/);assert.equal(f.context.__AGPAWindowsNativeIcons__,undefined);
});
