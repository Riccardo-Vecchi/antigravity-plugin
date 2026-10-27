'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process');
const {attachNative}=require('../windows/native-attach.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('native attachment discovers an existing closure tray and closes the real inspector',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-attach-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const resource=path.join(dir,'resources'),trayDir=path.join(resource,'app.asar','dist');await fs.mkdir(trayDir,{recursive:true});
 await fs.writeFile(path.join(trayDir,'tray.js'),`let tray={isDestroyed:()=>false,setImage(){}};exports.updateTrayAgentCount=()=>tray;`);
 const fixture=path.join(dir,'main.cjs');
 await fs.writeFile(fixture,`const Module=require('node:module'),events=new(require('node:events'))();const original=Module._load;Module._load=function(name,...args){if(name==='electron')return {app:Object.assign(events,{isReady:()=>true}),BrowserWindow:{getAllWindows:()=>[]},nativeImage:{createFromPath:()=>({isEmpty:()=>false})}};return original.call(this,name,...args);};process.resourcesPath=${JSON.stringify(resource)};require(${JSON.stringify(path.join(trayDir,'tray.js'))});setInterval(()=>{},1000);`);
 await fs.writeFile(path.join(dir,'windows-icon-request.json'),JSON.stringify({version:1,choice:'gemini'}));
 const child=spawn(process.execPath,['--inspect=127.0.0.1:0',fixture],{stdio:['ignore','ignore','pipe']});t.after(()=>child.kill());
 const endpoint=await new Promise((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(Error('Fixture inspector did not start')),5000);child.stderr.on('data',chunk=>{data+=chunk;const match=data.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.once('error',reject);});
 const attached=await attachNative(endpoint,{configDir:dir});assert.equal(attached.active,true);assert.equal(attached.tray,true);assert.equal(attached.choice,'gemini');
 let receipt;for(let i=0;i<40;i++){receipt=JSON.parse(await fs.readFile(path.join(dir,'windows-native-status.json'),'utf8'));if(receipt.inspectorClosed)break;await pause(50);}
 assert.equal(receipt.inspectorClosed,true);
 const closed=await new Promise(resolve=>{const socket=net.connect(Number(new URL(endpoint).port),'127.0.0.1');socket.on('connect',()=>{socket.destroy();resolve(false);});socket.on('error',()=>resolve(true));});assert.equal(closed,true);
});
