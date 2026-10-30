#!/usr/bin/env node
'use strict';
// Optional real-DOM regression checks using the local Antigravity renderer.
// All interactions run inside an isolated, disposable frame with fake models.
const fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..');
async function verify(){
 const port=(await fs.readFile(path.join(require('../common/platform-paths.cjs').getPaths().profileDir,'DevToolsActivePort'),'utf8')).split('\n')[0];
 const targets=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());
 const target=targets.find(t=>t.type==='page'&&t.url.startsWith('https://127.0.0.1'));
 if(!target)throw Error('Open native Antigravity before running these checks.');
 const client=await require('../common/cdp-connection.cjs').connect(target.webSocketDebuggerUrl);
 const name='agpa-model-controls-'+Date.now();
 const evaluate=async(expression,contextId)=>{const result=await client.call('Runtime.evaluate',{expression,contextId,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.result?.description||result.exceptionDetails.text);return result.result.value;};
 try{
  await evaluate(`globalThis.__agpaFixtureFocus=document.activeElement;(()=>{const frame=document.createElement('iframe');frame.name=${JSON.stringify(name)};frame.id=${JSON.stringify(name)};frame.src='about:blank';frame.style.cssText='position:fixed;left:-10000px;top:0;width:800px;height:500px;border:0';document.body.append(frame);})()`);
  const tree=await client.call('Page.getFrameTree');
  const find=node=>node.frame.name===name?node.frame:(node.childFrames||[]).map(find).find(Boolean);
  const frame=find(tree.frameTree);if(!frame)throw Error('Fixture frame unavailable');
  const {executionContextId}=await client.call('Page.createIsolatedWorld',{frameId:frame.id,worldName:name});
  const fixture=require('../tests/fixtures/model-controls.cjs'),rules=require('../common/model-controls.cjs');
  const script=`(${fixture.setup.toString()})();globalThis.__AGPA_MODEL_CONTROLS__={selectionFor:${rules.selectionFor.toString()},optionsFor:${rules.optionsFor.toString()},layoutFor:${rules.layoutFor.toString()}};${await fs.readFile(path.join(root,'common/model-controls.js'),'utf8')};(${fixture.verify.toString()})();`;
  return await evaluate(script,executionContextId);
 }finally{
  await evaluate(`document.getElementById(${JSON.stringify(name)})?.remove();globalThis.__agpaFixtureFocus?.focus({preventScroll:true});delete globalThis.__agpaFixtureFocus;`).catch(()=>{});
  client.close();
 }
}
if(require.main===module)verify().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={verify};
