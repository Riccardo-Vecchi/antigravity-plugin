"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const identity=require("../linux/window-identity.cjs");
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"agpa-identity-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const desktopFile=path.join(root,"my-launcher.desktop"),icon=path.join(root,"current.png");
  await fs.writeFile(desktopFile,'[Desktop Entry]\nType=Application\nName=My Antigravity\nExec="/Apps/Antigravity.AppImage" --example %U\nIcon=old\n');
  return {desktopFile,icon,file:path.join(root,"antigravity.desktop")};
}
test("tray windows get a stable hidden app identity without changing the user's launcher",async t=>{
  const f=await fixture(t),before=await fs.readFile(f.desktopFile,"utf8");
  assert.equal((await identity.sync(f)).changed,true);
  const data=await fs.readFile(f.file,"utf8");
  assert.match(data,/NoDisplay=true/);assert.match(data,/StartupWMClass=antigravity/);
  assert.match(data,/Exec="\/Apps\/Antigravity.AppImage" --example %U/);
  assert.equal(await fs.readFile(f.desktopFile,"utf8"),before);
  assert.equal((await identity.sync(f)).changed,false);
  await identity.remove(f.desktopFile);await assert.rejects(fs.stat(f.file),{code:"ENOENT"});
});
test("foreign desktop identities and symlinks are preserved, including on removal",async t=>{
  const f=await fixture(t);await fs.writeFile(f.file,"foreign entry");
  assert.equal((await identity.sync(f)).conflict,true);await identity.remove(f.desktopFile);
  assert.equal(await fs.readFile(f.file,"utf8"),"foreign entry");
  await fs.unlink(f.file);await fs.symlink(f.desktopFile,f.file);
  assert.equal((await identity.sync(f)).conflict,true);await identity.remove(f.desktopFile);
  assert.equal((await fs.lstat(f.file)).isSymbolicLink(),true);
});
