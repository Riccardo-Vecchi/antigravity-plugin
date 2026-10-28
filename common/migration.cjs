'use strict';
// Move only the plugin's own roots. Never relocate Antigravity accounts or conversations.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {getCanonicalPaths,getLegacyPaths}=require('./platform-paths.cjs');
const {execFile,spawn}=require('node:child_process'),{promisify}=require('node:util');
const {atomic:mcpAtomic}=require('./computer-use.cjs');
const run=promisify(execFile),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function stat(p){try{return await fs.lstat(p);}catch(e){if(e.code!=='ENOENT')throw e;return null;}}
async function plain(p){const s=await stat(p);if(!s)return null;if(!s.isFile()||s.isSymbolicLink())throw Error('Unsafe migration file: '+path.basename(p));return fs.readFile(p);}
async function write(p,data,mode=0o600){await fs.mkdir(path.dirname(p),{recursive:true,mode:0o700});const tmp=p+'.migration-'+crypto.randomUUID();try{await fs.writeFile(tmp,data,{flag:'wx',mode});await fs.rename(tmp,p);}finally{await fs.rm(tmp,{force:true});}}
async function inventory(root,{hashFiles=true}={}){
 const result=[];const s=await stat(root);if(!s)return result;if(!s.isDirectory()||s.isSymbolicLink())throw Error('Migration root must be a real directory.');
 async function visit(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,e.name),s=await fs.lstat(file),name=path.relative(root,file);
  if(s.isDirectory()){await visit(file);continue;}
  if(s.isSocket()&&name===path.join('companion','bridge.sock'))continue;
  if(!s.isFile()||s.isSymbolicLink())throw Error('Unsupported file in migration: '+name);
  result.push({name,hash:hashFiles?hash(await fs.readFile(file)):null,mode:s.mode&0o777});
 }}await visit(root);return result;
}
function remap(value,old,next){
 for(const key of ['installDir','configDir']){
  if(old.platform==='win32'){const pattern=old[key].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');value=value.replace(new RegExp(pattern,'gi'),()=>next[key]);}
  else value=value.split(old[key]).join(next[key]);
 }return value;
}
function remapValue(value,old,next){if(typeof value==='string')return remap(value,old,next);if(Array.isArray(value))return value.map(v=>remapValue(v,old,next));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remapValue(v,old,next)]));return value;}

async function safeDestination(root,file){
 const chain=[root];let current=root;
 for(const part of path.relative(root,path.dirname(file)).split(path.sep).filter(Boolean)){current=path.join(current,part);chain.push(current);}
 for(const dir of chain){const s=await stat(dir);if(s&&(!s.isDirectory()||s.isSymbolicLink()))throw Error('Unsafe migration destination.');}
}
async function moveTrees(old,next,{changes=[],moves=[]}={}){
 const plans=[];
 for(const key of ['installDir','configDir']){
  const files=await inventory(old[key]);
  for(const item of files){const from=path.join(old[key],item.name),to=path.join(next[key],item.name);await safeDestination(next[key],to);const dest=await stat(to);
   if(dest&&(!dest.isFile()||dest.isSymbolicLink()||hash(await fs.readFile(to))!==item.hash))throw Error('Conflicting destination file: '+item.name);
   plans.push({...item,from,to,duplicate:!!dest});
  }
 }
 for(const p of plans){await fs.mkdir(path.dirname(p.to),{recursive:true,mode:0o700});
  if(hash(await fs.readFile(p.from))!==p.hash)throw Error('Plugin files changed during migration.');
  if(!p.duplicate){await fs.rename(p.from,p.to);moves.push(p);}
  else {await fs.unlink(p.from);moves.push(p);}
  if(hash(await fs.readFile(p.to))!==p.hash)throw Error('Migration verification failed.');
 }
 return {plans,moves,changes};
}
async function rollback({moves,changes}){
 for(const c of [...changes].reverse()){
  const current=await plain(c.file);if(current!==null&&!current.equals(c.after))throw Error('A migrated integration changed; manual recovery is required.');
  if(c.before===null)await fs.rm(c.file,{force:true});else await write(c.file,c.before,c.mode);
 }
 for(const p of [...moves].reverse()){
  await fs.mkdir(path.dirname(p.from),{recursive:true,mode:0o700});
  const current=await plain(p.to);if(!current)throw Error('Migrated data is missing; manual recovery is required.');
  if(p.duplicate)await fs.copyFile(p.to,p.from);else await fs.rename(p.to,p.from);
 }
}
async function trim(root){const s=await stat(root);if(!s)return;if(!s.isDirectory()||s.isSymbolicLink())throw Error('Unsafe cleanup root.');for(const e of await fs.readdir(root,{withFileTypes:true})){const file=path.join(root,e.name);if(e.isDirectory())await trim(file);else if((await fs.lstat(file)).isSocket()&&e.name==='bridge.sock')await fs.unlink(file);}await fs.rmdir(root).catch(e=>{if(!['ENOENT','ENOTEMPTY','EBUSY','EPERM'].includes(e.code))throw e;});}
// Emptiness checks need file metadata, not repeated hashes of the Cua binary.
async function cleanupEmptyLegacy(old){
 const inventories=await Promise.all([old.installDir,old.configDir].map(root=>inventory(root,{hashFiles:false})));
 if(inventories.some(files=>files.length))return false;
 await trim(old.installDir);await trim(old.configDir);return true;
}
async function rewrite(old,next,tx,{home=os.homedir(),platform=process.platform,env=process.env}={}){
 async function change(file,text){const before=await plain(file),after=Buffer.from(text);if(before?.equals(after))return;const mode=(await stat(file))?.mode&0o777||0o600;if(file===path.join(home,'.gemini/config/mcp_config.json'))await mcpAtomic(file,text,before?.toString()||'');else await write(file,after,mode);tx.changes.push({file,before,after,mode});}
 // Only generated path-bearing files. Preserve project IDs, driver receipts, logs and user choices byte-for-byte.
 for(const relative of ['companion/browser-host.sh','companion/browser-host.cmd','companion/browser-host.json','windows-icon-request.json','windows-native-status.json']){
  const file=path.join(next.configDir,relative),bytes=await plain(file);if(bytes){if(relative.endsWith('.json')){const data=JSON.parse(bytes.toString().trim()),mapped=remapValue(data,old,next);if(JSON.stringify(data)!==JSON.stringify(mapped))await change(file,JSON.stringify(mapped,null,2)+'\n');}else await change(file,remap(bytes.toString(),old,next));}
 }
 const mcp=path.join(home,'.gemini/config/mcp_config.json'),bytes=await plain(mcp);
 if(bytes){const data=JSON.parse(bytes.toString().trim());if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid native MCP configuration.');let modified=false;
  for(const [name,script]of [['antigravity-plugin-computer-use','computer-use-bridge.cjs'],['antigravity-plugin-browser','browser-mcp.cjs']]){
   const entry=data.mcpServers?.[name];if(entry&&Array.isArray(entry.args)&&entry.args.length===1&&typeof entry.args[0]==='string'&&(platform==='win32'?entry.args[0].toLowerCase()===path.join(old.installDir,'common',script).toLowerCase():entry.args[0]===path.join(old.installDir,'common',script))) {entry.args[0]=path.join(next.installDir,'common',script);modified=true;}
  }
  if(modified)await change(mcp,JSON.stringify(data,null,2)+'\n');
 }
 const adapter=require(platform==='win32'?'../windows/migration.cjs':'../linux/migration.cjs');
 await adapter.rewrite({old,next,home,env,change,remap,plain});
 return change;
}
async function pauseDesktop(old,next){
 const paused=new Map();
 for(const root of [old.configDir,next.configDir]){const file=path.join(root,'computer-use/state.json'),bytes=await plain(file);if(!bytes)continue;const state=JSON.parse(bytes.toString().trim());if(state.enabled===true){paused.set(file,bytes);await write(file,JSON.stringify({...state,enabled:false})+'\n');}}
 return paused;
}
async function resumeDesktop(paused,old,next,success){
 if(success){const original=paused.get(path.join(old.configDir,'computer-use/state.json'));if(original)await write(path.join(next.configDir,'computer-use/state.json'),original);}
 else for(const [file,bytes]of paused)await write(file,bytes);
}
async function migrateUnlocked({home=os.homedir(),platform=process.platform,env=process.env,lifecycle,prepareOnly=false}={}){
 const options={home,platform,env},old=getLegacyPaths(options),next=getCanonicalPaths(options);
 if(await cleanupEmptyLegacy(old))return {migrated:false,...next};
 // Preflight both trees before stopping the helper or changing any data.
 for(const key of ['installDir','configDir'])for(const item of await inventory(old[key])){await safeDestination(next[key],path.join(next[key],item.name));const dest=await stat(path.join(next[key],item.name));if(dest&&(!dest.isFile()||dest.isSymbolicLink()||hash(await fs.readFile(path.join(next[key],item.name)))!==item.hash))throw Error('Conflicting migration destination: '+item.name);}
 const tx={moves:[],changes:[]};let stopped=false,pausedDesktop=new Map();
 const adapter=require(platform==='win32'?'../windows/migration.cjs':'../linux/migration.cjs');
 lifecycle ||= adapter.lifecycle({old,next,home,env});
 if(adapter.preflight)await adapter.preflight({old,next,home,env});
 try{
  await lifecycle('preserve');stopped=true;await lifecycle('stop');
  if(platform==='win32'){pausedDesktop=await pauseDesktop(old,next);if(pausedDesktop.size)await lifecycle('quiesce');}
  // All source files are hashed again after the old helper has stopped writing.
  const moved=await moveTrees(old,next,tx);await rewrite(old,next,tx,options);await resumeDesktop(pausedDesktop,old,next,true);
  if(!prepareOnly){await lifecycle('start');await lifecycle('health');}
  await trim(old.installDir);await trim(old.configDir);
  const result={schema:1,migrated:true,at:Date.now(),verifiedFiles:moved.plans.length};
  await write(path.join(next.configDir,'migration.json'),JSON.stringify(result)+'\n');
  if(!prepareOnly){await lifecycle('finalize');await lifecycle('restore');}return {...result,...next};
 }catch(error){
  if(stopped){await lifecycle('stopNew').catch(()=>{});if(platform==='win32'&&pausedDesktop.size){await pauseDesktop(old,next);await lifecycle('quiesce');}await rollback(tx);await resumeDesktop(pausedDesktop,old,next,false);await lifecycle('rollback').catch(()=>{});await lifecycle('restore').catch(()=>{});}
  throw error;
 }
}
async function migrate(options={}){
 const old=getLegacyPaths(options),next=getCanonicalPaths(options);
 if(await cleanupEmptyLegacy(old))return {migrated:false,...next};
 const root=await stat(next.configDir);if(root&&(!root.isDirectory()||root.isSymbolicLink()))throw Error('Unsafe migration destination.');
 await fs.mkdir(next.configDir,{recursive:true,mode:0o700});
 const lock=path.join(next.configDir,'migration.lock');let handle;
 try{try{handle=await fs.open(lock,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;const record=JSON.parse((await plain(lock)).toString());if(!Number.isInteger(record.pid)||record.pid<=0)throw Error('An earlier migration needs manual review.');let alive=true;try{process.kill(record.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}if(alive)throw Error('Another migration is already running.');await fs.unlink(lock);handle=await fs.open(lock,'wx',0o600);}
 await handle.writeFile(JSON.stringify({pid:process.pid,at:Date.now()}));return await migrateUnlocked(options);}
 finally{if(handle){await handle.close();await fs.rm(lock,{force:true});}}
}
async function defer(){
 const env={...process.env};delete env.AGPA_LEGACY_RUNTIME;
 if(process.platform==='linux')await run('systemd-run',['--user','--unit=antigravity-plugin-migration','--collect','--quiet','--property=Type=exec',...['AGPA_APP_PROFILE','AGPA_APPIMAGE','AGPA_DESKTOP_FILE'].filter(k=>env[k]).map(k=>'--setenv='+k+'='+env[k]),process.execPath,path.join(__dirname,'migration.cjs'),'--deferred'],{env,timeout:10000});
 else {const c=spawn(process.execPath,[path.join(__dirname,'migration.cjs'),'--deferred'],{env:{...env,ELECTRON_RUN_AS_NODE:'1'},detached:true,stdio:'ignore',windowsHide:true,cwd:os.tmpdir()});await new Promise((r,j)=>{c.once('spawn',r);c.once('error',j);});c.unref();}
}
async function waitForUpdater({old=getLegacyPaths(),pause=ms=>new Promise(r=>setTimeout(r,ms)),attempts=120}={}){const dir=path.join(old.configDir,'updates');for(let n=0;n<attempts;n++){
 const locked=await stat(path.join(dir,'install.lock'));let running=false;
 try{const r=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8'));running=['preparing','installing','restarting'].includes(r.phase)&&Date.now()-r.at<120000;}catch{}
 if(!locked&&!running){await pause(1200);return;}
 await pause(1000);
 }throw Error('Finish the active plugin update before migrating.');}
if(require.main===module)(async()=>{delete process.env.AGPA_LEGACY_RUNTIME;if(process.argv.includes('--finish')){const old=getLegacyPaths(),next=getCanonicalPaths();const adapter=require(process.platform==='win32'?'../windows/migration.cjs':'../linux/migration.cjs');const lifecycle=adapter.lifecycle({old,next,home:os.homedir(),env:process.env});await lifecycle('health');await lifecycle('finalize');await lifecycle('restore');return;}if(process.argv.includes('--deferred'))await waitForUpdater();const result=await migrate({prepareOnly:process.argv.includes('--prepare')});console.log(JSON.stringify(result));})().catch(e=>{console.error('Plugin migration stopped safely: '+e.message);process.exitCode=1;});
module.exports={migrate,inventory,moveTrees,rollback,remap,remapValue,rewrite,pauseDesktop,resumeDesktop,trim,defer,waitForUpdater};
