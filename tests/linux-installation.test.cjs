'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {discover,parseDesktop,debuggingExec,appImageWithoutDebugging}=require('../linux/installation.cjs');
async function fixture(t){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-detect-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const env={XDG_DATA_DIRS:path.join(home,'system')},apps=path.join(home,'.local/share/applications');
 async function image(relative){const file=path.join(home,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.from([127,69,76,70,0,0,0,0,65,73,2]),{mode:0o755});return file;}
 async function desktop(name,exe,extra='',system=false){const file=path.join(system?path.join(env.XDG_DATA_DIRS,'applications'):apps,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,`[Desktop Entry]\nType=Application\nName=Antigravity\nExec="${exe}" --example %U\nIcon=custom-vendor-icon\n${extra}`);return file;}
 return {home,env,apps,image,desktop,find:()=>discover({home,env})};
}
const options={skip:process.platform==='win32'};
test('Linux discovery prefers a valid launcher over old downloads and preserves quoted arguments',options,async t=>{
 const f=await fixture(t),exe=await f.image('My Apps/Antigravity.AppImage');const launcher=await f.desktop('my-agent.desktop',exe);await f.image('Downloads/Antigravity-old.AppImage');
 const found=await f.find();assert.equal(found.executable,exe);assert.equal(found.desktopFile,launcher);assert.match(found.entry.Exec,/--example %U$/);assert.equal(found.entry.Icon,'custom-vendor-icon');
});
test('hidden tray identity aliases never replace the chosen user launcher during discovery',options,async t=>{
 const f=await fixture(t),exe=await f.image('Apps/Antigravity.AppImage');
 const launcher=await f.desktop('zzz-user.desktop',exe);
 await f.desktop('antigravity.desktop',exe,'NoDisplay=true\nX-Antigravity-Plugin-Window-Identity=true\n');
 assert.equal((await f.find()).desktopFile,launcher);
});
test('Linux discovery prepares a user override without writing to the system launcher',options,async t=>{
 const f=await fixture(t),exe=await f.image('vendor/Antigravity.AppImage');const source=await f.desktop('antigravity.desktop',exe,'',true),before=await fs.readFile(source,'utf8');
 const found=await f.find();assert.equal(found.desktopFile,path.join(f.apps,'antigravity.desktop'));assert.equal(found.generated,true);await assert.rejects(fs.stat(found.desktopFile),{code:'ENOENT'});assert.equal(await fs.readFile(source,'utf8'),before);
});
test('ambiguous installations require explicit selection instead of changing either launcher',options,async t=>{
 const f=await fixture(t),a=await f.image('Applications/Antigravity-a.AppImage'),b=await f.image('AppImages/Antigravity-b.AppImage');await f.desktop('a.desktop',a);const chosen=await f.desktop('b.desktop',b);
 await assert.rejects(f.find(),{code:'AGPA_AMBIGUOUS'});f.env.AGPA_APPIMAGE=b;assert.equal((await f.find()).desktopFile,chosen);
 f.env.AGPA_DESKTOP_FILE=path.join(f.apps,'a.desktop');await assert.rejects(f.find(),{code:'AGPA_INVALID_LAUNCHER'});
});
test('a unique image in the localized download folder gets a launcher proposal, without filesystem mutation',options,async t=>{
 const f=await fixture(t);await fs.mkdir(path.join(f.home,'.config'));await fs.writeFile(path.join(f.home,'.config/user-dirs.dirs'),'XDG_DOWNLOAD_DIR="$HOME/Scaricati"\n');const exe=await f.image('Scaricati/Antigravity.AppImage');
 const found=await f.find();assert.equal(found.executable,exe);assert.equal(found.generated,true);assert.equal(parseDesktop(found.text).executable,exe);await assert.rejects(fs.stat(found.desktopFile),{code:'ENOENT'});
});
test('discovery rejects renamed non-AppImages, conflicting launchers and hidden overrides',options,async t=>{
 assert.equal(parseDesktop('[Desktop Entry]\nType=Application\nExec=sh -c anything\n'),null);
 assert.equal(parseDesktop('[Desktop Entry]\nType=Application\nExec=/a.AppImage\nExec=/b.AppImage\n'),null);
 const f=await fixture(t),exe=await f.image('Applications/Antigravity.AppImage');await f.desktop('vendor.desktop',exe,'',true);await f.desktop('vendor.desktop',exe,'Hidden=true\n');
 const found=await f.find();assert.notEqual(found.desktopFile,path.join(f.apps,'vendor.desktop'));
 await fs.mkdir(f.apps,{recursive:true});await fs.writeFile(path.join(f.apps,'antigravity-appimage.desktop'),'unrelated file');await assert.rejects(f.find(),{code:'AGPA_CONFLICTING_LAUNCHER'});
 f.env.AGPA_APPIMAGE=exe;await fs.writeFile(exe,'not an AppImage');await assert.rejects(f.find(),{code:'AGPA_INVALID_APPIMAGE'});
});

test('Linux launch debugging preserves arguments and an explicit user port',()=>{
 const exec='"/My Apps/Antigravity.AppImage" --example %U';
 const updated=debuggingExec(exec);
 assert.equal(updated,exec+' --remote-debugging-address=127.0.0.1 --remote-debugging-port=0');
 assert.equal(parseDesktop('[Desktop Entry]\nType=Application\nExec='+updated+'\n').executable,'/My Apps/Antigravity.AppImage');
 assert.equal(debuggingExec(updated),updated);
 assert.equal(debuggingExec(exec+' --remote-debugging-port=9137'),exec+' --remote-debugging-port=9137');
});
test('debug opt-in restores the original launcher command and respects later user edits',options,async t=>{
 const vm=require('node:vm'),{createRequire}=require('node:module');
 const f=await fixture(t),exe=await f.image('Apps/Antigravity.AppImage');
 const launcher=await f.desktop('antigravity.desktop',exe);
 const before=await fs.readFile(launcher,'utf8');
 const module={exports:{}},localRequire=createRequire(path.resolve('linux/desktop.cjs'));
 const customRequire=name=>{
  if(name==='node:os')return {...os,homedir:()=>f.home};
  if(name==='../common/platform-paths.cjs')return {getPaths:()=>({configDir:path.join(f.home,'.config/antigravity-plugin')})};
  if(name==='./installation.cjs')return {...localRequire(name),discover:f.find};
  return localRequire(name);
 };
 const code=await fs.readFile('linux/desktop.cjs','utf8');
 vm.runInNewContext(code+'\nmodule.exports.testDesktopWithIcon=desktopWithIcon;',{require:customRequire,module,console,__dirname:path.resolve('linux'),process});
 const change=await module.exports.testDesktopWithIcon('antigravity');
 assert.match(change.after,/--remote-debugging-port=0/);
 await fs.writeFile(launcher,change.after);
 const repeated=await module.exports.testDesktopWithIcon('antigravity');
 assert.equal(repeated.after,change.after);
 const restored=await module.exports.testDesktopWithIcon('restore');
 assert.equal(restored.after,before);
 await fs.writeFile(launcher,change.after.replace(' --example ',' --user-change '));
 const userEdited=await module.exports.testDesktopWithIcon('restore');
 assert.match(userEdited.after,/--user-change/);
 assert.match(userEdited.after,/--remote-debugging-port=0/);
});

test('Linux identifies only a running AppImage profile without the debugging flag', options, async t => {
  const {home} = await fixture(t);
  const proc = path.join(home, 'proc');
  const processDir = path.join(proc, '123');
  const lock = path.join(home, 'SingletonLock');
  const executable = '/tmp/.mount_AntigrTest/antigravity';
  const detect = () => appImageWithoutDebugging(home, proc);

  await fs.mkdir(processDir, {recursive:true});
  await fs.symlink(executable, path.join(processDir, 'exe'));
  const cmdline = path.join(processDir, 'cmdline');
  await fs.writeFile(cmdline, executable + '\0');
  assert.equal(await detect(), null);

  await fs.symlink(os.hostname() + '-123', lock);
  assert.equal(await detect(), '123');
  await fs.writeFile(cmdline, executable + '\0--remote-debugging-port=0\0');
  assert.equal(await detect(), null);
  await fs.writeFile(cmdline, executable + '\0--type=renderer\0');
  assert.equal(await detect(), null);
  await fs.writeFile(cmdline, [executable, '--remote-debugging-port', '9123', ''].join('\0'));
  assert.equal(await detect(), null);
  await fs.unlink(lock);
  await fs.symlink('other-' + os.hostname() + '-123', lock);
  await fs.writeFile(cmdline, executable + '\0');
  assert.equal(await detect(), null);
});
