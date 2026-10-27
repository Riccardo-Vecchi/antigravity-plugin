/* Keep existing native/guest documents mounted during a helper upgrade. */
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const restore=process.argv.includes('--restore');
const expression=restore?`(()=>{const entries=globalThis.__AGPA_RELOAD_HANDOFF__||[];for(const entry of entries){if(entry.api.destroy===entry.wrapper)entry.api.destroy=entry.original;}delete globalThis.__AGPA_RELOAD_HANDOFF__;return true})()`:`(()=>{if(globalThis.__AGPA_RELOAD_HANDOFF__)return true;globalThis.__AGPA_STARTUP_APPLIED__=true;const entries=[];for(const key of ['__AGGeminiInline','__AGGeminiSwitch','__AGPAI18n']){const api=globalThis[key];if(!api)continue;const original=api.destroy;const wrapper=function(){api.destroy=original;};entries.push({api,original,wrapper});api.destroy=wrapper;}globalThis.__AGPA_RELOAD_HANDOFF__=entries;return true})()`;
(async()=>{
 let port;try{port=(await fs.readFile(path.join(require('./platform-paths.cjs').getPaths().profileDir,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch(e){if(e.code==='ENOENT')return;throw e;}
 if(!/^\d{2,5}$/.test(port)||Number(port)>65535)throw Error('Invalid local debugging port');
 let targets;try{targets=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2500)}).then(r=>r.json());}catch(e){if(e.cause?.code==='ECONNREFUSED')return;throw e;}
 let count=0;
 for(const t of targets){
  if(t.type!=='page'||!/^https:\/\/127\.0\.0\.1:\d+\//.test(t.url||''))continue;
  const u=new URL(t.webSocketDebuggerUrl);if(u.protocol!=='ws:'||u.hostname!=='127.0.0.1'||u.port!==port)continue;
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  try{
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Window connection timed out')),3000);ws.onopen=()=>{clearTimeout(timer);resolve()};ws.onerror=()=>{clearTimeout(timer);reject(Error('Window unavailable'))};});
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Could not prepare window reload')),3500);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1){clearTimeout(timer);if(m.error||m.result?.exceptionDetails)reject(Error('Could not preserve the open window'));else resolve();}};ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});
   count++;
  }finally{ws.close();}
 }
 if(count)console.log(restore?'Restored window lifecycle hooks.':'Preserved open Antigravity and Gemini views.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
