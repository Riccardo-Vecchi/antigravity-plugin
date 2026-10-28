'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {discover,parseDesktop}=require('../linux/installation.cjs');
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
