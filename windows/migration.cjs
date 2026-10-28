'use strict';
const VERSION=require('../common/versions.cjs').suite;
const fs=require('node:fs/promises'),path=require('node:path'),{execFile,spawn}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
async function integrationScript(old,next,env,undo=false){
 let script=path.join(next.installDir,'windows/migrate.ps1');
 if(!await fs.stat(script).catch(()=>null))script=path.join(__dirname,'migrate.ps1');
 await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-OldInstall',old.installDir,'-NewInstall',next.installDir,'-OldConfig',old.configDir,'-NewConfig',next.configDir,...(undo?['-Undo']:[])],{env,windowsHide:true,timeout:15000});
}
async function rewrite({old,next,env}){await integrationScript(old,next,env);}

function lifecycle({old,next,env}){
 const clean={...env,ELECTRON_RUN_AS_NODE:'1'};delete clean.AGPA_LEGACY_RUNTIME;
 const oldEnv={...clean,AGPA_LEGACY_RUNTIME:'1'};
 const launch=async(root,option,environment=clean)=>{let script=path.join(root,'windows/launcher.cjs');if(!await fs.stat(script).catch(()=>null))script=path.join(__dirname,'launcher.cjs');return run(process.execPath,[script,option],{env:environment,windowsHide:true,timeout:15000});};
 let startedAt=0;
 return async action=>{
  if(action==='preserve'){let script=path.join(old.installDir,'common/prepare-reload.cjs');if(!await fs.stat(script).catch(()=>null))script=path.join(__dirname,'../common/prepare-reload.cjs');return run(process.execPath,[script],{env:oldEnv,windowsHide:true,timeout:12000});}
  if(action==='stop'){
   let runtime;try{runtime=JSON.parse(await fs.readFile(path.join(old.configDir,'updates/runtime.json'),'utf8'));}catch{}
   await launch(old.installDir,'--stop',oldEnv);
   if(Number.isInteger(runtime?.pid)&&runtime.pid>0){for(let n=0;n<60;n++){let alive=true;try{process.kill(runtime.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}if(!alive)break;if(n===59)throw Error('The old helper is still stopping. Retry migration shortly.');await new Promise(r=>setTimeout(r,100));}}
   // An older native icon watcher retains absolute paths in the running app.
   // Stop that owned watcher through its existing restore request; never restart the app.
   const status=path.join(old.configDir,'windows-native-status.json');let native;try{native=JSON.parse(await fs.readFile(status,'utf8'));}catch{}
   if(native?.active===true){
    const request=path.join(old.configDir,'windows-icon-request.json'),temp=request+'.migration.tmp';await fs.writeFile(temp,JSON.stringify({version:1,choice:'antigravity',restore:true}),{mode:0o600});await fs.rename(temp,request);
    for(let n=0;n<40;n++){let current;try{current=JSON.parse(await fs.readFile(status,'utf8'));}catch{}if(current?.active===false)break;if(n===39)throw Error('The native icon watcher did not stop. Existing folders were retained.');await new Promise(r=>setTimeout(r,100));}
   }
  }
  if(action==='stopNew')return launch(next.installDir,'--stop');
  if(action==='finalize')return fs.rm(path.join(next.configDir,'migration-windows-integrations.json'),{force:true});
  if(action==='rollback')await integrationScript(old,next,clean,true);
  if(action==='start'||action==='rollback'){
   const root=action==='start'?next.installDir:old.installDir,environment=action==='start'?clean:oldEnv;startedAt=Date.now();
   const c=spawn(process.execPath,[path.join(root,'windows/launcher.cjs'),'--watch'],{env:environment,detached:true,stdio:'ignore',windowsHide:true});await new Promise((r,j)=>{c.once('spawn',r);c.once('error',j);});c.unref();
  }
  if(action==='health'){for(let i=0;i<60;i++){try{const h=JSON.parse(await fs.readFile(path.join(next.configDir,'updates/runtime.json'),'utf8'));if(h.ready&&h.at>=startedAt&&h.version===VERSION)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Migrated Windows helper did not become ready.');}
  if(action==='restore'){const root=await fs.stat(next.installDir).then(()=>next.installDir).catch(()=>old.installDir);return run(process.execPath,[path.join(root,'common/prepare-reload.cjs'),'--restore'],{env:clean,windowsHide:true,timeout:12000});}
 };
}
module.exports={rewrite,lifecycle};
