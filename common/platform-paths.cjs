'use strict';
const path=require('node:path');
const os=require('node:os');
function getPaths({platform=process.platform,env=process.env,home=os.homedir()}={}){
 if(platform==='win32'){
  const p=path.win32,roaming=env.APPDATA||p.join(home,'AppData','Roaming'),local=env.LOCALAPPDATA||p.join(home,'AppData','Local');
  return {platform,configDir:p.join(roaming,'antigravity-project-appearance'),profileDir:env.AGPA_APP_PROFILE||p.join(roaming,'Antigravity'),installDir:p.join(local,'antigravity-project-appearance'),defaultExecutable:env.AGPA_APP_EXE||p.join(local,'Programs','Antigravity','Antigravity.exe')};
 }
 if(platform!=='linux')throw Error('This integration supports Linux and Windows.');
 const p=path.posix;
 return {platform,configDir:p.join(home,'.config','antigravity-project-appearance'),profileDir:env.AGPA_APP_PROFILE||p.join(home,'.config','Antigravity'),installDir:p.join(home,'.local','share','antigravity-project-appearance'),defaultExecutable:env.AGPA_APPIMAGE||p.join(home,'.local','opt','Antigravity.AppImage')};
}
module.exports={getPaths};
