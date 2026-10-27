'use strict';
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const paths=require('./platform-paths.cjs').getPaths();
const {attachNative}=require('./windows-native-attach.cjs');
const pipe='\\\\.\\pipe\\agpa-'+crypto.createHash('sha256').update(paths.configDir.toLowerCase()).digest('hex').slice(0,24);
let daemon=null,launching=null,server=null;
async function installation(){
 const file=path.join(paths.configDir,'installation.json');const stat=await fsp.stat(file);if(stat.size>4096)throw Error('Invalid installation record.');
 const data=JSON.parse(await fsp.readFile(file,'utf8'));
 if(data.version!==1||!path.isAbsolute(data.appExe)||path.basename(data.appExe).toLowerCase()!=='antigravity.exe')throw Error('Invalid application executable.');
 await fsp.access(data.appExe);return data;
}
function log(message){fs.appendFileSync(path.join(paths.configDir,'launcher.log'),new Date().toISOString()+' '+message+'\n');}
async function appRunning(){
 try{const value=(await fsp.readFile(path.join(paths.profileDir,'DevToolsActivePort'),'utf8')).split('\n')[0];if(!/^\d{2,5}$/.test(value)||Number(value)>65535)return false;const targets=await fetch('http://127.0.0.1:'+value+'/json/list',{signal:AbortSignal.timeout(1200)}).then(r=>r.json());return targets.some(t=>t.type==='page'&&/^https:\/\/127\.0\.0\.1:\d+\//.test(t.url||''));}catch{return false;}
}
function cleanEnvironment(){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;delete env.NODE_INSPECT_RESUME_ON_START;return env;}
async function launch(){
 if(launching)return launching;
 launching=(async()=>{
  const data=await installation();
  if(await appRunning()){spawn(data.appExe,[],{env:cleanEnvironment(),detached:true,stdio:'ignore',windowsHide:false}).unref();log('Focused existing Antigravity; no process was restarted.');return;}
  const args=data.nativeIconsSupported===false?[]:['--inspect=127.0.0.1:0'];
  const child=spawn(data.appExe,args,{env:cleanEnvironment(),stdio:['ignore','ignore','pipe'],detached:true,windowsHide:false});
  child.unref();child.stderr.unref();
  let attached=false,buffer='';
  child.on('error',error=>log('Application launch failed: '+error.code));
  child.stderr.on('data',async chunk=>{
   buffer=(buffer+chunk.toString()).slice(-12000);const match=buffer.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);
   if(!match||attached)return;attached=true;
   try{await attachNative(match[1],paths);log('Native icon controller attached; inspector cleanup scheduled.');}catch(error){log('Native icon setup unavailable: '+error.message);}
  });
  child.stderr.on('error',()=>{});
  await new Promise(resolve=>{child.once('spawn',resolve);child.once('error',resolve);});
 })().finally(()=>{launching=null;});
 return launching;
}
async function startDaemon(){
 const data=await installation();const output=fs.openSync(path.join(paths.configDir,'helper.log'),'a');
 daemon=spawn(data.appExe,[path.join(__dirname,'daemon.cjs')],{cwd:__dirname,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore',output,output],windowsHide:true});fs.closeSync(output);
 daemon.on('exit',()=>{daemon=null;if(server)setTimeout(()=>startDaemon().catch(e=>log(e.message)),3000).unref();});
}
function send(command){return new Promise((resolve,reject)=>{const socket=net.connect(pipe);socket.once('connect',()=>socket.end(command));socket.once('error',reject);socket.once('close',resolve);});}
async function main(){
 if(process.platform!=='win32')throw Error('This launcher is for Windows.');
 const command=process.argv.includes('--stop')?'stop':process.argv.includes('--launch')?'launch':'watch';
 try{await send(command);return;}catch(error){if(!['ENOENT','ECONNREFUSED'].includes(error.code))throw error;}
 if(command==='stop')return;
 await fsp.mkdir(paths.configDir,{recursive:true});
 server=net.createServer(socket=>{let data='';socket.on('data',chunk=>{data+=chunk.toString();if(data.length>32)socket.destroy();});socket.on('end',()=>{if(data==='launch')launch().catch(e=>log(e.message));if(data==='stop'){server.close();server=null;daemon?.kill();}});});
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve);});}
 catch(error){server=null;if(error.code!=='EADDRINUSE')throw error;await send(command);return;}
 await startDaemon();if(command==='launch')await launch();
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
