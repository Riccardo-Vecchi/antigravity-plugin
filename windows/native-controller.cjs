'use strict';
// Executed once in the app's native Electron process, with the existing Tray as `this`.
// The inspector is closed after setup. Remote webpages receive no API or credentials.
function installNativeController(options){
 const load=process.mainModule.require.bind(process.mainModule);
 const fs=load('node:fs'),path=load('node:path');
 const {app,BrowserWindow,nativeImage}=load('electron');
 const tray=this&&typeof this.setImage==='function'?this:null;
 globalThis.__AGPAWindowsNativeIcons__?.destroy();
 const original=nativeImage.createFromPath(path.join(process.resourcesPath,'app.asar','icon.png'));
 const gemini=nativeImage.createFromPath(options.geminiPng);
 if(original.isEmpty()||gemini.isEmpty())throw Error('Application icons are unavailable.');
 let stopped=false,choice='antigravity',restore=false,inspectorClosed=false,lastError=null;
 function receipt(){
  const value={version:1,pid:process.pid,active:!stopped&&!lastError,choice,tray:!!tray&&!tray.isDestroyed(),nonce:options.nonce,inspectorPort:options.inspectorPort,updatedAt:Date.now(),inspectorClosed};
  const temp=options.statusFile+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,options.statusFile);}catch{try{fs.unlinkSync(temp);}catch{}}return value;
 }
 function setWindow(window){
  if(window.isDestroyed())return;
  window.setIcon(choice==='gemini'?gemini:original);
 }
 function apply(){
  if(stopped)return;
  try{
   if(fs.statSync(options.requestFile).size>2048)return;
   const data=JSON.parse(fs.readFileSync(options.requestFile,'utf8'));
   if(data.version!==1||!['antigravity','gemini'].includes(data.choice))return;
   choice=data.choice;restore=data.restore===true;
   for(const window of BrowserWindow.getAllWindows())setWindow(window);
   if(tray&&!tray.isDestroyed())tray.setImage(choice==='gemini'?gemini:original);
   lastError=null;receipt();if(restore)controller.destroy();
  }catch(error){if(error.code!=='ENOENT'){lastError='native-icon-update-failed';receipt();}}
 }
 const onWindow=(_,window)=>{try{setWindow(window);}catch{lastError='native-icon-update-failed';receipt();}};
 const heartbeat=setInterval(receipt,5000);heartbeat.unref();
 const controller=globalThis.__AGPAWindowsNativeIcons__={
  destroy(){stopped=true;clearInterval(heartbeat);fs.unwatchFile(options.requestFile,apply);app.removeListener('browser-window-created',onWindow);for(const window of BrowserWindow.getAllWindows()){if(!window.isDestroyed())window.setIcon(original);}if(tray&&!tray.isDestroyed())tray.setImage(original);receipt();delete globalThis.__AGPAWindowsNativeIcons__;},
  markInspectorClosed(){inspectorClosed=true;receipt();}
 };
 fs.watchFile(options.requestFile,{interval:400,persistent:false},apply);app.on('browser-window-created',onWindow);apply();return receipt();
}
module.exports={installNativeController};
