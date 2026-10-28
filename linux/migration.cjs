'use strict';
const VERSION=require('../common/versions.cjs').suite;
const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),browsers=require('./browser.cjs').browsers,identity=require('../common/browser-identity.json');
const service='antigravity-plugin.service',legacyService='antigravity-project-appearance.service';
async function optional(file){try{return await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;return null;}}
async function rewrite({old,next,home,env,change,remap,plain}){
 const configHome=env.XDG_CONFIG_HOME||path.join(home,'.config');
 for(const [,folder]of browsers){const file=path.join(configHome,folder,'NativeMessagingHosts',identity.host+'.json'),data=await plain(file);if(!data)continue;const entry=JSON.parse(data.toString().trim());if(entry.name===identity.host&&entry.path===path.join(old.configDir,'companion/browser-host.sh')){entry.path=path.join(next.configDir,'companion/browser-host.sh');await change(file,JSON.stringify(entry)+'\n');}}
 const unitDir=path.join(home,'.config/systemd/user'),oldUnit=path.join(unitDir,legacyService),unit=await plain(oldUnit);
 if(unit){if(!unit.toString().includes(path.join(old.installDir,'common/daemon.cjs')))throw Error('Legacy service belongs to another program.');const existing=await plain(path.join(unitDir,service));if(existing&&!existing.toString().includes(path.join(next.installDir,'common/daemon.cjs')))throw Error('Canonical service belongs to another program.');await change(path.join(unitDir,service),remap(unit.toString(),old,next));}
 const drop=path.join(unitDir,legacyService+'.d');
 try{for(const file of await fs.readdir(drop)){const bytes=await plain(path.join(drop,file));if(bytes)await change(path.join(unitDir,service+'.d',file),remap(bytes.toString(),old,next));}}catch(e){if(e.code!=='ENOENT')throw e;}
 const apps=path.join(home,'.local/share/applications');
 try{for(const file of await fs.readdir(apps)){if(!file.endsWith('.desktop'))continue;const full=path.join(apps,file);if((await fs.lstat(full)).isSymbolicLink())continue;const bytes=await plain(full);if(!bytes)continue;const text=bytes.toString();const lines=text.split('\n').map(line=>/^(Icon|Exec|TryExec)=/.test(line)?remap(line,old,next):line);if(lines.join('\n')!==text)await change(full,lines.join('\n'));}}catch(e){if(e.code!=='ENOENT')throw e;}
 const auto=path.join(home,'.config/autostart/antigravity-linux-customizations.desktop'),text=await optional(auto);
 if(text?.includes('X-Antigravity-Local-Integration=true'))await change(path.join(home,'.config/autostart/antigravity-plugin.desktop'),remap(text,old,next));
}
function lifecycle({old,next,home,env}){
 const clean={...env};delete clean.AGPA_LEGACY_RUNTIME;
 const ctl=(...args)=>run('systemctl',['--user',...args],{env:clean,timeout:15000});
 const node=(file,...args)=>run(process.execPath,[file,...args],{env:clean,timeout:12000});
 let startedAt=0;
 return async action=>{
  if(action==='preserve'){const source=await optional(path.join(old.installDir,'common/prepare-reload.cjs'))?path.join(old.installDir,'common/prepare-reload.cjs'):path.join(__dirname,'../common/prepare-reload.cjs');return node(source);}
  if(action==='stop')return ctl('stop',legacyService).catch(e=>{if(!/not loaded|does not exist/.test(e.stderr||''))throw e;});
  if(action==='start'){startedAt=Date.now();await ctl('daemon-reload');await ctl('enable',service);return ctl('restart',service);}
  if(action==='stopNew')return ctl('stop',service);
  if(action==='rollback'){await ctl('disable',service).catch(()=>{});await ctl('daemon-reload');await ctl('enable',legacyService);return ctl('restart',legacyService);}
  if(action==='restore'){const root=await optional(path.join(next.installDir,'common/prepare-reload.cjs'))?next.installDir:old.installDir;return node(path.join(root,'common/prepare-reload.cjs'),'--restore');}
  if(action==='health'){
   for(let i=0;i<60;i++){try{const h=JSON.parse(await fs.readFile(path.join(next.configDir,'updates/runtime.json'),'utf8'));if(h.ready&&h.at>=startedAt&&h.version===VERSION)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Migrated helper did not become ready.');
  }
  if(action==='finalize'){
   const dir=path.join(home,'.config/systemd/user'),oldUnit=path.join(dir,legacyService),text=await optional(oldUnit);
   if(text?.includes(path.join(old.installDir,'common/daemon.cjs'))){await ctl('disable',legacyService).catch(()=>{});await fs.unlink(oldUnit);const drop=path.join(dir,legacyService+'.d');try{for(const file of await fs.readdir(drop)){const f=path.join(drop,file);if((await fs.lstat(f)).isFile())await fs.unlink(f);}await fs.rmdir(drop);}catch(e){if(!['ENOENT','ENOTEMPTY'].includes(e.code))throw e;}await ctl('daemon-reload');}
   const auto=path.join(home,'.config/autostart/antigravity-linux-customizations.desktop'),textAuto=await optional(auto);if(textAuto?.includes('X-Antigravity-Local-Integration=true'))await fs.unlink(auto);
  }
 };
}
module.exports={rewrite,lifecycle};
