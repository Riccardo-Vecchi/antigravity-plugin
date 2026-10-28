'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const {validate}=require('../common/app-preferences.cjs');
function createController({paths=require('../common/platform-paths.cjs').getPaths(),runProgram=run,base=__dirname,pidAlive=pid=>process.kill(pid,0)}={}){
const session=require('../common/session-state.cjs').createSessionStore(path.join(paths.configDir,'session.json'));
const preferences=path.join(paths.configDir,'app.json');
const requestFile=path.join(paths.configDir,'windows-icon-request.json');
const statusFile=path.join(paths.configDir,'windows-native-status.json');
let state={version:2,taskbarIcon:'antigravity',startupView:'antigravity',autostart:false,toggleShortcut:'Ctrl+Alt+G'};
let currentView='antigravity',lastView='antigravity',effectiveIcon=null,nativeAvailable=false,trayAvailable=false,paused=false;
async function atomic(file,value){
 await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';
 try{await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await fs.rename(temp,file);}
 catch(error){await fs.rm(temp,{force:true}).catch(()=>{});throw error;}
}
async function json(file,max=8192){const stat=await fs.stat(file);if(stat.size>max)throw Error('Invalid local state.');return JSON.parse(await fs.readFile(file,'utf8'));}
function desired(){return state.taskbarIcon==='dynamic'?currentView:state.taskbarIcon;}
function getState(){return {...state,platform:'win32',lastView,currentView,startupTarget:state.startupView==='last'?lastView:state.startupView,effectiveIcon:effectiveIcon||desired(),desktopIconAvailable:nativeAvailable,trayAvailable};}
async function readNative(){
 try{const status=await json(statusFile);if(status.version!==1||!Number.isSafeInteger(status.pid)||status.pid<1||!Number.isFinite(status.updatedAt)||Math.abs(Date.now()-status.updatedAt)>15000)throw Error('Invalid native state.');pidAlive(status.pid);nativeAvailable=status.active===true&&status.inspectorClosed===true;trayAvailable=nativeAvailable&&status.tray===true;return status;}
 catch{nativeAvailable=false;trayAvailable=false;return null;}
}
async function renderIcon(){
 const choice=paused?'antigravity':desired();
 if(effectiveIcon!==choice){await atomic(requestFile,{version:1,choice});effectiveIcon=choice;}
 await readNative();return getState();
}
async function autostart(action){
 const result=await runProgram('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(base,'autostart.ps1'),'-Action',action],{windowsHide:true,timeout:12000});
 return JSON.parse(result.stdout.trim());
}
async function save(patch){
 const before=state,next=validate({...state,...patch});
 if(patch.autostart!==undefined)await autostart(next.autostart?'Enable':'Disable');
 try{await atomic(preferences,next);}catch(error){if(patch.autostart!==undefined)await autostart(before.autostart?'Enable':'Disable').catch(()=>{});throw error;}
 state=next;return renderIcon();
}
async function initialize({suspended=false}={}){
 paused=suspended;
 try{state=validate(await json(preferences,4096));}catch(error){if(error.code!=='ENOENT')throw error;}
 lastView=await session.read();currentView=state.startupView==='last'?lastView:state.startupView;
 state.autostart=!!(await autostart('Read')).enabled;
 return renderIcon();
}
async function apply(choice){if(!['antigravity','gemini','dynamic'].includes(choice))throw Error('Invalid icon choice.');return save({taskbarIcon:choice});}
async function setStartupView(view){if(!['antigravity','gemini','last'].includes(view))throw Error('Invalid startup view.');return save({startupView:view});}
async function setToggleShortcut(value){return save({toggleShortcut:require('../common/shortcut-config.cjs').normalize(value)});}
async function setAutostart(value){if(typeof value!=='boolean')throw Error('Invalid autostart value.');return save({autostart:value});}
async function setView(view){if(!['antigravity','gemini'].includes(view))throw Error('Unknown view.');lastView=await session.record(view);currentView=view;return renderIcon();}
async function ensureTray(){await readNative();return getState();}
async function pause(){paused=true;return renderIcon();}
async function resume(){paused=false;return renderIcon();}
async function restoreIntegration(){await initialize();await apply('antigravity');await setAutostart(false);await atomic(requestFile,{version:1,choice:'antigravity',restore:true});return getState();}
return {pause,resume,initialize,apply,setStartupView,setAutostart,setToggleShortcut,setView,ensureTray,getState,validate,restoreIntegration};
}
module.exports={...createController(),createController};
