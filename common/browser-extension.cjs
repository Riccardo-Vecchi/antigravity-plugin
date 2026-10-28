"use strict";
// Publish a stable, branded unpacked-extension location without relocating legacy settings/services.
const fs=require("node:fs/promises"),path=require("node:path"),crypto=require("node:crypto");
async function deploy(directory) {
  const source=path.join(__dirname,"browser-extension"), manifest=JSON.parse(await fs.readFile(path.join(source,"manifest.json")));
  await fs.mkdir(path.dirname(directory),{recursive:true,mode:0o700});
  const stat=await fs.lstat(directory).catch(e=>{if(e.code!=="ENOENT")throw e;});
  if(stat && (!stat.isDirectory()||stat.isSymbolicLink()))throw Error("Unsafe extension folder.");
  if(stat && (await fs.readdir(directory)).length){
    const old=await fs.lstat(path.join(directory,"manifest.json"));
    if(!old.isFile()||old.isSymbolicLink())throw Error("Unsafe extension manifest.");
    const current=JSON.parse(await fs.readFile(path.join(directory,"manifest.json")));
    if(current.key!==manifest.key)throw Error("Extension folder belongs to another installation.");
  }
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const prefix="common/browser-extension/";
  const files=require("./distribution.json").common.filter(f=>f.startsWith(prefix)).map(f=>f.slice(prefix.length));
  // Write the manifest last so it never advertises assets that are not deployed yet.
  files.sort((a,b)=>(a==="manifest.json")-(b==="manifest.json"));
  for(const file of files){
    const target=path.join(directory,file),data=await fs.readFile(path.join(source,file));
    await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    const existing=await fs.lstat(target).catch(e=>{if(e.code!=="ENOENT")throw e;});
    if(existing && (!existing.isFile()||existing.isSymbolicLink()))throw Error("Unsafe extension file.");
    if(existing && (await fs.readFile(target)).equals(data))continue;
    const temp=target+"."+crypto.randomUUID()+".tmp";
    try{await fs.writeFile(temp,data,{flag:"wx",mode:0o600});await fs.rename(temp,target);}finally{await fs.rm(temp,{force:true});}
  }
  return directory;
}
module.exports={deploy};
