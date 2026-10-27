'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const {iconPath}=require('../common/icon-path.cjs');
const DIRECTORY=path.join(os.homedir(),'.config','antigravity-project-appearance');
const PREFERENCES=path.join(DIRECTORY,'app.json');
const session=require('../common/session-state.cjs').createSessionStore(path.join(DIRECTORY,'session.json'));
let lastView='antigravity';
const discovery=require('./installation.cjs');
let installation=null,DESKTOP=null,EXECUTABLE=null;
async function resolveInstallation(){installation=await discovery.discover();DESKTOP=installation.desktopFile;EXECUTABLE=installation.executable;return installation;}
const GEMINI_ICON=iconPath('gemini-512.png');
const LEGACY_ICON=iconPath('gemini.png');
const CURRENT_ICON=iconPath('current.png');
const ORIGINALS=path.join(DIRECTORY,'icon-originals');
const SIZES=[16,24,32,48,64,128,256,512];
const AUTOSTART=path.join(os.homedir(),'.config','autostart','antigravity-linux-customizations.desktop');
const ICON_ROOT=path.join(os.homedir(),'.local','share','icons','hicolor');
let state={version:2,taskbarIcon:'antigravity',startupView:'antigravity',autostart:false,toggleShortcut:'Ctrl+Alt+G'};
let currentView='antigravity',effectiveIcon=null,trayAvailable=false;
const {validate}=require('../common/app-preferences.cjs');

function desiredIcon(){return state.taskbarIcon==='dynamic'?currentView:state.taskbarIcon;}
function getState(){return {...state,platform:'linux',desktopIconAvailable:!!installation,lastView,startupTarget:state.startupView==='last'?lastView:state.startupView,currentView,effectiveIcon:effectiveIcon||desiredIcon(),trayAvailable};}
async function syncTray(choice){
 try{const result=await run('/usr/bin/python3',[path.join(__dirname,'sync-tray-icon.py'),choice],{timeout:8000});const data=JSON.parse(result.stdout);trayAvailable=!!data.available;return data;}
 catch{trayAvailable=false;return {available:false,changed:false};}
}
async function atomic(file,text,mode){
 const tmp=file+'.agpa-'+process.pid+'.tmp';
 try{const f=await fs.open(tmp,'w',mode);try{await f.chmod(mode);await f.writeFile(text);await f.sync();}finally{await f.close();}await fs.rename(tmp,file);}
 catch(error){await fs.rm(tmp,{force:true}).catch(()=>{});throw error;}
}
async function desktopWithIcon(choice){
 await resolveInstallation();
 const stat=await fs.lstat(DESKTOP).catch(e=>{if(e.code==='ENOENT')return {mode:0o644,isFile:()=>true};throw e;});if(!stat.isFile())throw Error('The Antigravity launcher is not a regular file.');
 const before=await fs.readFile(DESKTOP,'utf8').catch(e=>{if(e.code==='ENOENT')return installation.text;throw e;});
 const lines=before.split('\n');let inside=false,start=-1,end=lines.length,exec=null,iconLine=-1;
 for(let i=0;i<lines.length;i++){
  if(/^\[.*\]$/.test(lines[i])){if(inside){end=i;break;}inside=lines[i]==='[Desktop Entry]';if(inside)start=i;}
  else if(inside){if(lines[i].startsWith('Exec='))exec=lines[i].slice(5);if(lines[i].startsWith('Icon='))iconLine=i;}
 }
 if(start<0||await fs.realpath(discovery.parseDesktop(before)?.executable||'')!==await fs.realpath(EXECUTABLE))throw Error('The Antigravity launcher changed. Check its configuration before changing the icon.');
 const backupFile=path.join(DIRECTORY,'launcher-original-icons.json');
 let backup={version:1,entries:{}};
 try{const info=await fs.stat(backupFile);if(info.size>131072)throw Error('Invalid launcher icon backup.');backup=JSON.parse(await fs.readFile(backupFile,'utf8'));if(backup.version!==1||!backup.entries||typeof backup.entries!=='object')throw Error('Invalid launcher icon backup.');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!Object.hasOwn(backup.entries,DESKTOP)){
  const old=iconLine>=0?lines[iconLine].slice(5):null;backup.entries[DESKTOP]=[CURRENT_ICON,LEGACY_ICON].includes(old)?'antigravity':old;
  await fs.mkdir(DIRECTORY,{recursive:true,mode:0o700});await atomic(backupFile,JSON.stringify(backup)+'\n',0o600);
 }
 const value=choice==='restore'?backup.entries[DESKTOP]:CURRENT_ICON;
 if(value!==null&&(typeof value!=='string'||value.length>8192||/[\r\n\0]/.test(value)))throw Error('Invalid launcher icon backup.');
 if(choice==='gemini')await fs.access(GEMINI_ICON);
 if(value===null){if(iconLine>=0)lines.splice(iconLine,1);}else if(iconLine>=0)lines[iconLine]='Icon='+value;else lines.splice(end,0,'Icon='+value);
 await fs.mkdir(path.dirname(DESKTOP),{recursive:true,mode:0o755});
 return {before,after:lines.join('\n'),mode:stat.mode&0o777};
}
async function themeIcons(choice){
 await fs.mkdir(ORIGINALS,{recursive:true,mode:0o700});
 const assetOriginals=path.join(DIRECTORY,'asset-originals');await fs.mkdir(assetOriginals,{recursive:true,mode:0o700});
 try{await fs.copyFile(LEGACY_ICON,path.join(assetOriginals,'legacy-gemini.png'),require('node:fs').constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
 const replacements=[];
 for(const size of SIZES){
  const file=path.join(ICON_ROOT,`${size}x${size}`,'apps','antigravity.png');
  const stat=await fs.lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!stat)continue;if(!stat.isFile())throw Error('The local Antigravity icon changed.');
  const original=path.join(ORIGINALS,`${size}.png`);
  try{await fs.copyFile(file,original,require('node:fs').constants.COPYFILE_EXCL);await fs.chmod(original,0o600);}catch(e){if(e.code!=='EEXIST')throw e;}
  replacements.push({file,mode:stat.mode&0o777,bytes:await fs.readFile(choice==='gemini'?iconPath(`gemini-${size}.png`):original)});
 }
 // Stable file identity for new Shell.App instances, plus compatibility with
 // the absolute Gemini path already cached by windows from the first version.
 const current=await fs.readFile(choice==='gemini'?GEMINI_ICON:iconPath('antigravity.png'));
 replacements.push({file:CURRENT_ICON,mode:0o600,bytes:current},{file:LEGACY_ICON,mode:0o600,bytes:current});
 const changed=[];
 const restore=async item=>{if(item.before===null)await fs.rm(item.file,{force:true});else await atomic(item.file,item.before,item.mode);};
 try{for(const item of replacements){const before=await fs.readFile(item.file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!before?.equals(item.bytes)){await atomic(item.file,item.bytes,item.mode);changed.push({...item,before});}}}
 catch(error){for(const item of changed.reverse())await restore(item).catch(()=>{});throw error;}
 return async()=>{for(const item of changed)await restore(item);};
}
async function refresh({live=true}={}){
 // Gio also watches desktop entry changes; this updates the local app catalog.
 await run('/usr/bin/update-desktop-database',[path.dirname(DESKTOP)],{timeout:5000}).catch(()=>{});
 if(await fs.stat(ICON_ROOT).catch(()=>null))await run('/usr/bin/gtk-update-icon-cache',['--ignore-theme-index','--force',ICON_ROOT],{timeout:5000});
 await run('/usr/bin/python3',[path.join(__dirname,'refresh-icon-theme.py'),...(live?[]:['--recover-only'])],{timeout:5000});
}
async function renderIcon({live=true,force=false}={}){
 const choice=desiredIcon();
 if(!installation)return getState();
 if(!force&&effectiveIcon===choice)return getState();
 const desktop=await desktopWithIcon(choice);
 const undoIcons=await themeIcons(choice);
 try{if(desktop.after!==desktop.before)await atomic(DESKTOP,desktop.after,desktop.mode);}
 catch(error){await undoIcons().catch(()=>{});throw error;}
 await syncTray(choice);
 await refresh({live});effectiveIcon=choice;
 return getState();
}
async function readAutostart(){
 try{const text=await fs.readFile(AUTOSTART,'utf8');return text.includes('X-Antigravity-Local-Integration=true')&&!/^Hidden=true$/m.test(text)&&!/^X-GNOME-Autostart-enabled=false$/m.test(text);}
 catch(e){if(e.code==='ENOENT')return false;throw e;}
}
async function syncAutostart(enabled){
 let existing=null;try{const stat=await fs.lstat(AUTOSTART);if(!stat.isFile())throw Error('Autostart entry is not a regular file.');existing=await fs.readFile(AUTOSTART,'utf8');if(!existing.includes('X-Antigravity-Local-Integration=true'))throw Error('An unrelated autostart entry already exists.');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!enabled){if(existing!==null)await fs.rm(AUTOSTART);return;}
 await resolveInstallation();
 await fs.access(EXECUTABLE);
 await fs.mkdir(path.dirname(AUTOSTART),{recursive:true,mode:0o700});
 const executable=installation.entry.Exec;
 const text=['[Desktop Entry]','Type=Application','Name=Antigravity','Comment=Launch Antigravity at desktop sign-in','Exec='+executable,'TryExec='+EXECUTABLE,'Icon='+CURRENT_ICON,'Terminal=false','StartupNotify=false','X-GNOME-Autostart-enabled=true','X-Antigravity-Local-Integration=true',''].join('\n');
 await atomic(AUTOSTART,text,0o644);
}
async function savePreferences(patch){
 const previous=state,next=validate({...state,...patch});
 if(patch.autostart!==undefined)await syncAutostart(next.autostart);
 await fs.mkdir(DIRECTORY,{recursive:true,mode:0o700});
 try{await atomic(PREFERENCES,JSON.stringify(next,null,2)+'\n',0o600);}catch(error){if(patch.autostart!==undefined)await syncAutostart(previous.autostart).catch(()=>{});throw error;}
 state=next;
 try{return await renderIcon();}
 catch(error){state=previous;if(patch.autostart!==undefined)await syncAutostart(previous.autostart).catch(()=>{});await atomic(PREFERENCES,JSON.stringify(previous,null,2)+'\n',0o600).catch(()=>{});throw error;}
}
async function apply(choice){
 if(!['antigravity','gemini','dynamic'].includes(choice))throw Error('Choose Antigravity, Gemini, or Dynamic.');
 await resolveInstallation();return savePreferences({taskbarIcon:choice});
}
async function setStartupView(view){
 if(!['antigravity','gemini','last'].includes(view))throw Error('Choose Antigravity, Gemini, or the last view.');
 return savePreferences({startupView:view});
}
async function setToggleShortcut(value){return savePreferences({toggleShortcut:require('../common/shortcut-config.cjs').normalize(value)});}
async function setAutostart(enabled){if(typeof enabled!=='boolean')throw Error('Invalid autostart value.');return savePreferences({autostart:enabled});}
async function setView(view){
 if(!['antigravity','gemini'].includes(view))throw Error('Unknown view.');
 currentView=view;lastView=await session.record(view);return renderIcon();
}
async function ensureTray(){await syncTray(effectiveIcon||desiredIcon());return getState();}
async function initialize(){
 let saved=false;
 try{const stat=await fs.stat(PREFERENCES);if(stat.size>4096)throw Error('Application preferences are too large.');state=validate(JSON.parse(await fs.readFile(PREFERENCES,'utf8')));saved=true;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 state.autostart=await readAutostart();
 lastView=await session.read();
 currentView=state.startupView==='last'?lastView:state.startupView;
 try{await resolveInstallation();}catch(error){installation=null;console.warn(error.message);}
 if(saved&&installation)await renderIcon({live:false,force:true});
 return getState();
}
async function restoreIntegration(){
 await initialize();await apply('antigravity');await setAutostart(false);
 const d=await desktopWithIcon('restore');if(d.after!==d.before)await atomic(DESKTOP,d.after,d.mode);
 await run('/usr/bin/python3',[path.join(__dirname,'sync-tray-icon.py'),'--restore'],{timeout:8000});
 await refresh();return getState();
}
module.exports={initialize,apply,setStartupView,setAutostart,setToggleShortcut,setView,ensureTray,getState,validate,restoreIntegration};
