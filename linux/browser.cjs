"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { save, privateRead } = require("../common/companion-core.cjs");
const identity = require("../common/browser-identity.json");
const browsers = [
  ["Chrome", "google-chrome"],
  ["Chrome Beta", "google-chrome-beta"],
  ["Chromium", "chromium"],
  ["Chrome for Testing", "google-chrome-for-testing"],
  ["Brave", "BraveSoftware/Brave-Browser"],
  ["Edge", "microsoft-edge"],
  ["Vivaldi", "vivaldi"],
  ["Opera", "opera"],
];
async function install({
  home,
  configDir,
  runtime,
  hostScript,
  availableBrowsers=[],
  configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
}) {
  const base = configHome,
    directory = path.join(configDir, "companion");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const wrapper = path.join(directory, "browser-host.sh");
  const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
  await fs.writeFile(
    wrapper,
    "#!/bin/sh\nunset NODE_OPTIONS\nexport ELECTRON_RUN_AS_NODE=1\nexec " +
      quote(runtime) +
      " " +
      quote(hostScript) +
      ' "$@"\n',
    { mode: 0o700 },
  );
  await fs.chmod(wrapper, 0o700);
  const installed = [];
  for (const [name, folder] of browsers) {
    const profile = path.join(base, folder);
    const exists = await fs
      .stat(profile)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!exists && !availableBrowsers.some(b=>b.label===name)) continue;
    const file = path.join(
        profile,
        "NativeMessagingHosts",
        identity.host + ".json",
      ),
      previous = await privateRead(file);
    if (previous) {
      let old;
      try {
        old = JSON.parse(previous);
      } catch {
        throw Error("A browser host manifest needs manual review.");
      }
      if (old.name !== identity.host || old.path !== wrapper)
        throw Error(
          "A browser host manifest already belongs to another installation.",
        );
    }
    await save(file, {
      name: identity.host,
      description: "Antigravity Plugin browser bridge",
      path: wrapper,
      type: "stdio",
      allowed_origins: ["chrome-extension://" + identity.extensionId + "/"],
    });
    installed.push(name);
  }
  return installed;
}
module.exports = { install, browsers };

const {BROWSERS}=require('../common/browser-setup.cjs');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
async function detect({env=process.env}={}){
 const found=[];
 for(const b of BROWSERS){let executable;
  for(const name of b.linux){for(const folder of (env.PATH||'').split(path.delimiter).filter(Boolean)){const file=path.join(folder,name);try{await fs.access(file,require('node:fs').constants.X_OK);if((await fs.stat(file)).isFile()){executable=file;break;}}catch{}}if(executable)break;}
  if(executable)found.push({id:b.id,label:b.label,executable,url:b.url});
 }
 let preferred='';try{preferred=(await promisify(execFile)('xdg-settings',['get','default-web-browser'],{env,timeout:1500})).stdout.toLowerCase();}catch{}
 const defaultBrowser=found.find(b=>preferred.includes(b.id))?.id||found[0]?.id||'other';
 return {available:found.map(({id,label})=>({id,label})),defaultBrowser};
}
async function openExtensions(id,{env=process.env,profileDirectory=null,details=false}={}){
 const spec=BROWSERS.find(b=>b.id===id);if(!spec)throw Error('Unsupported browser.');
 if(profileDirectory!==null&&!/^(?:Default|Profile \d+)$/.test(profileDirectory))throw Error('Invalid browser profile.');
 const args=[...(profileDirectory?['--profile-directory='+profileDirectory]:[]),spec.url+(details?'?id='+identity.extensionId:'')];
 for(const name of spec.linux)for(const folder of (env.PATH||'').split(path.delimiter).filter(Boolean)){
  const executable=path.join(folder,name);try{await fs.access(executable,require('node:fs').constants.X_OK);}catch{continue;}
  const clean={...env};delete clean.ELECTRON_RUN_AS_NODE;delete clean.NODE_OPTIONS;
  const child=spawn(executable,args,{env:clean,detached:true,stdio:'ignore'});await new Promise((r,j)=>{child.once('spawn',r);child.once('error',j);});child.unref();return true;
 }
 throw Error('Browser executable not found.');
}
module.exports.detect=detect;module.exports.openExtensions=openExtensions;
