"use strict";
// Best-effort, read-only discovery of this extension only. Never reads cookies or tab data.
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const identity = require("./browser-identity.json");
const manifest = require("./browser-extension/manifest.json");
const PROFILE = /^(?:Default|Profile \d+)$/;
const ROOTS = {
  linux: {brave:"BraveSoftware/Brave-Browser",chrome:"google-chrome",edge:"microsoft-edge",vivaldi:"vivaldi",opera:"opera",chromium:"chromium"},
  win32: {brave:"BraveSoftware/Brave-Browser/User Data",chrome:"Google/Chrome/User Data",edge:"Microsoft/Edge/User Data",vivaldi:"Vivaldi/User Data",opera:"Opera Software/Opera Stable",chromium:"Chromium/User Data"},
};
function extensionId(key) {
  if (typeof key !== "string" || key.length > 4096) return null;
  try {return crypto.createHash("sha256").update(Buffer.from(key,"base64")).digest("hex").slice(0,32).replace(/[0-9a-f]/g,n=>String.fromCharCode(97+parseInt(n,16)));} catch {return null;}
}
function createProbe({platform=process.platform,home=os.homedir(),env=process.env,now=Date.now,ttl=10000}={}) {
  const cache=new Map();let snapshot={},targets={},last=-Infinity,pending;
  async function json(file) {
    const s=await fs.lstat(file);
    if(!s.isFile()||s.isSymbolicLink()||s.size>16*1024*1024)throw Error("unreadable");
    const old=cache.get(file);if(old?.mtime===s.mtimeMs&&old.size===s.size)return old.entry;
    const data=JSON.parse(await fs.readFile(file,"utf8")),raw=data.extensions?.settings?.[identity.extensionId];
    const entry=raw&&typeof raw==="object"?{path:raw.path,state:raw.state,disabled:raw.disable_reasons,removed:raw.external_uninstalled}:null;
    if(cache.size>=256)cache.delete(cache.keys().next().value);
    cache.set(file,{mtime:s.mtimeMs,size:s.size,entry});return entry;
  }
  async function profile(folder,base) {
    let entry=null,unknown=false;
    // Secure Preferences overrides Preferences when both contain this extension.
    for(const name of ["Preferences","Secure Preferences"])try{entry=(await json(path.join(folder,name)))||entry;}catch(e){if(e.code!=="ENOENT")unknown=true;}
    if(!entry||entry.removed)return {status:unknown?"unknown":"notFound"};
    if(typeof entry.path!=="string")return {status:"unknown"};
    const location=path.isAbsolute(entry.path)?entry.path:path.resolve(base,entry.path);
    let installed;
    try {
      const s=await fs.lstat(location),file=path.join(location,"manifest.json"),m=await fs.lstat(file);
      if(!s.isDirectory()||s.isSymbolicLink()||!m.isFile()||m.isSymbolicLink()||m.size>65536)throw Error("unreadable");
      installed=JSON.parse(await fs.readFile(file,"utf8"));
      if(extensionId(installed.key)!==identity.extensionId||installed.manifest_version!==3||typeof installed.version!=="string"||!/^\d+(?:\.\d+){0,3}$/.test(installed.version))return {status:"unknown"};
    } catch(e){return {status:e.code==="ENOENT"?"broken":"unknown"};}
    const reasons=entry.disabled;
    const disabled=entry.state===0||(Array.isArray(reasons)?reasons.length>0:typeof reasons==="number"&&reasons!==0);
    return {status:disabled?"disabled":installed.version!==manifest.version?"reload":"installed",version:installed.version};
  }
  async function scan(available) {
    const next={},locations={};
    for(const {id}of available){
      const relative=ROOTS[platform]?.[id];if(!relative){next[id]={status:"unknown",profiles:0};continue;}
      const base=platform==="win32"?(id==="opera"?env.APPDATA:env.LOCALAPPDATA):(env.XDG_CONFIG_HOME||path.join(home,".config"));
      if(!base){next[id]={status:"unknown",profiles:0};continue;}
      const root=path.join(base,...relative.split("/"));let folders,truncated;
      try {
        const s=await fs.lstat(root);if(!s.isDirectory()||s.isSymbolicLink())throw Error("unreadable");
        const children=await fs.readdir(root,{withFileTypes:true});
        const standard=children.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&PROFILE.test(e.name)).map(e=>e.name).sort();
        truncated=standard.length>30;folders=standard.slice(0,30);
        if(id==="opera")folders.unshift("");
      }catch(e){next[id]={status:e.code==="ENOENT"?"notFound":"unknown",profiles:0};continue;}
      const results=[];
      for(const folder of folders)results.push({...await profile(path.join(root,folder),path.join(root,folder)),folder});
      const best=["installed","reload","disabled","broken","unknown"].map(status=>results.find(r=>r.status===status)).find(Boolean);
      next[id]={status:best?.status||(truncated?"unknown":"notFound"),profiles:results.filter(r=>["installed","reload","disabled","broken"].includes(r.status)).length};
      if(best&&["installed","reload","disabled"].includes(best.status))locations[id]=best.folder;
    }
    targets=locations;snapshot=next;last=now();return next;
  }
  return {
    async inspect(available,{force=false}={}) {
      if(pending)return pending;
      if(!force&&now()-last<ttl&&available.every(b=>snapshot[b.id]))return structuredClone(snapshot);
      pending=scan(available);try{return structuredClone(await pending);}finally{pending=null;}
    },
    target(id){return targets[id]||null;},
  };
}
module.exports={createProbe,extensionId};
