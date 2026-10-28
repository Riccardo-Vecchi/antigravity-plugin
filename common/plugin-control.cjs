'use strict';
const fs=require('node:fs/promises');
const {atomic}=require('./computer-use.cjs');
function createControl({file,disableAccess,pausePresentation,resumePresentation,onChange=async()=>{}}){
 let state={version:1,enabled:true},busy=false;
 async function load(){try{const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>1024)throw Error('Invalid plugin control file.');const data=JSON.parse(await fs.readFile(file,'utf8'));if(data.version!==1||typeof data.enabled!=='boolean')throw Error('Invalid plugin control state.');state={version:1,enabled:data.enabled};}catch(e){if(e.code!=='ENOENT')throw e;}return state;}
 return {load,get enabled(){return state.enabled;},get busy(){return busy;},async setEnabled(enabled){
  if(typeof enabled!=='boolean')throw Error('Invalid plugin state.');
  if(enabled===state.enabled)return state;
  // Access is revoked before the persistent off state is acknowledged. Resuming
  // never grants desktop or browser access automatically.
  if(busy)throw Error('Plugin state is changing.');busy=true;
  try{
   if(!enabled){await disableAccess();await pausePresentation();}else await resumePresentation();
   await atomic(file,JSON.stringify({version:1,enabled})+'\n');state={version:1,enabled};
  }catch(error){await (state.enabled?resumePresentation():pausePresentation()).catch(()=>{});throw error;}
  finally{busy=false;}
  await onChange(enabled);return state;
 }};
}
module.exports={createControl};
