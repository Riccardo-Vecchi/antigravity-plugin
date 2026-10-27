'use strict';
const path=require('node:path');
const crypto=require('node:crypto');
const {connect}=require('./cdp-connection.cjs');
const {installNativeController}=require('./windows-native-controller.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function trayObject(client){
 const fn=await client.call('Runtime.evaluate',{expression:`(()=>{const load=process.mainModule.require.bind(process.mainModule);if(!load('electron').app.isReady())return null;return load(load('node:path').join(process.resourcesPath,'app.asar','dist','tray.js')).updateTrayAgentCount;})()`,returnByValue:false});
 if(fn.exceptionDetails||fn.result?.type!=='function')return null;
 const properties=await client.call('Runtime.getProperties',{objectId:fn.result.objectId,ownProperties:false});
 const scopes=properties.internalProperties?.find(p=>p.name==='[[Scopes]]')?.value?.objectId;if(!scopes)return null;
 const list=await client.call('Runtime.getProperties',{objectId:scopes,ownProperties:true});
 for(const scope of list.result.filter(p=>p.value?.description?.startsWith('Closure'))){
  const variables=await client.call('Runtime.getProperties',{objectId:scope.value.objectId,ownProperties:true});
  const tray=variables.result.find(p=>p.name==='tray')?.value;if(tray?.objectId&&tray.subtype!=='null')return tray.objectId;
 }
 return null;
}
async function attachNative(endpoint,paths){
 const client=await connect(endpoint);
 try{
  // Safety timeout also runs if the companion exits before its normal cleanup.
  await client.call('Runtime.evaluate',{expression:`globalThis.__AGPAInspectorTimer__=setTimeout(()=>process.mainModule.require('node:inspector').close(),90000);globalThis.__AGPAInspectorTimer__.unref();true`,returnByValue:true});
  let tray=null;
  for(let attempt=0;attempt<120&&!tray;attempt++){tray=await trayObject(client);if(!tray)await pause(250);}
  if(!tray)throw Error('The native Antigravity tray is not available.');
  const options={requestFile:path.join(paths.configDir,'windows-icon-request.json'),statusFile:path.join(paths.configDir,'windows-native-status.json'),geminiPng:path.join(__dirname,'icons','gemini-512.png'),nonce:crypto.randomUUID(),inspectorPort:Number(new URL(endpoint).port)};
  const result=await client.call('Runtime.callFunctionOn',{objectId:tray,functionDeclaration:installNativeController.toString(),arguments:[{value:options}],returnByValue:true});
  if(result.exceptionDetails)throw Error('Could not attach the native icon controller.');
  return result.result.value;
 }finally{
  await client.call('Runtime.evaluate',{expression:`clearTimeout(globalThis.__AGPAInspectorTimer__);setTimeout(()=>{process.mainModule.require('node:inspector').close();globalThis.__AGPAWindowsNativeIcons__?.markInspectorClosed();},100).unref();true`,returnByValue:true}).catch(()=>{});
  client.close();
 }
}
module.exports={attachNative};
