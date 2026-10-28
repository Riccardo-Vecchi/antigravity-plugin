'use strict';
const path=require('node:path'),os=require('node:os');
const NAME='antigravity-plugin',LEGACY='antigravity-project-appearance';
function locations({platform=process.platform,env=process.env,home=os.homedir()}={},name=NAME){
 if(platform==='win32'){
  const p=path.win32,roaming=env.APPDATA||p.join(home,'AppData','Roaming'),local=env.LOCALAPPDATA||p.join(home,'AppData','Local');
  return {platform,configDir:p.join(roaming,name),profileDir:env.AGPA_APP_PROFILE||p.join(roaming,'Antigravity'),installDir:p.join(local,name),extensionDir:p.join(local,NAME,'browser-extension'),defaultExecutable:env.AGPA_APP_EXE||p.join(local,'Programs','Antigravity','Antigravity.exe')};
 }
 if(platform!=='linux')throw Error('This integration supports Linux and Windows.');
 return {platform,configDir:path.join(home,'.config',name),profileDir:env.AGPA_APP_PROFILE||path.join(home,'.config','Antigravity'),installDir:path.join(home,'.local','share',name),extensionDir:path.join(home,'.local','share',NAME,'browser-extension'),defaultExecutable:env.AGPA_APPIMAGE||path.join(home,'.local','opt','Antigravity.AppImage')};
}
function getPaths(options={}){return locations(options,(options.env||process.env).AGPA_LEGACY_RUNTIME==='1'?LEGACY:NAME);}
function getCanonicalPaths(options={}){return locations(options,NAME);}
function getLegacyPaths(options={}){return locations(options,LEGACY);}
module.exports={getPaths,getCanonicalPaths,getLegacyPaths,NAME,LEGACY};
