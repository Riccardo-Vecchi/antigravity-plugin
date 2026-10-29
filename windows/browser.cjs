"use strict";
// Per-user native messaging registration. No policy injection or administrator rights.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const { save } = require("../common/companion-core.cjs");
const identity = require("../common/browser-identity.json");
const keys = [
  "Google\\Chrome",
  "Chromium",
  "Microsoft\\Edge",
  "BraveSoftware\\Brave-Browser",
  "Vivaldi",
  "Opera Software",
];
async function install({ configDir, runtime, hostScript,availableBrowsers=[] }) {
  const directory = path.join(configDir, "companion");
  await fs.mkdir(directory, { recursive: true });
  if ([runtime, hostScript].some((s) => /[\r\n%"!]/.test(s)))
    throw Error("Unsupported native host path.");
  const wrapper = path.join(directory, "browser-host.cmd"),
    manifest = path.join(directory, "browser-host.json");
  await fs.writeFile(
    wrapper,
    '@echo off\r\nset "NODE_OPTIONS="\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"' +
      runtime +
      '" "' +
      hostScript +
      '" %*\r\n',
  );
  await save(manifest, {
    name: identity.host,
    description: "Antigravity Plugin browser bridge",
    path: wrapper,
    type: "stdio",
    allowed_origins: ["chrome-extension://" + identity.extensionId + "/"],
  });
  const installed=[];
  const browserIds=["chrome","chromium","edge","brave","vivaldi","opera"];
  for (const [index,key] of keys.entries()) {
    const registry =
      "HKCU\\Software\\" + key + "\\NativeMessagingHosts\\" + identity.host;
    const old = await run("reg.exe", ["query", registry, "/ve"], {
      windowsHide: true,
    })
      .then((r) => r.stdout)
      .catch(() => null);
    if (
      old &&
      old
        .match(/REG_SZ\s+([^\r\n]+)/)?.[1]
        .trim()
        .toLowerCase() !== manifest.toLowerCase()
    )
      throw Error("Native host registration belongs to another installation.");
    if(!old&&!availableBrowsers.some(b=>b.id===browserIds[index]))continue;
    await run(
      "reg.exe",
      ["add", registry, "/ve", "/t", "REG_SZ", "/d", manifest, "/f"],
      { windowsHide: true },
    );
    installed.push(browserIds[index]);
  }
  return installed;
}
module.exports = { install };

const {BROWSERS}=require('../common/browser-setup.cjs'),{spawn}=require('node:child_process');
async function executableFor(spec,env){for(const root of [env.LOCALAPPDATA,env.ProgramFiles,env['ProgramFiles(x86)']].filter(Boolean))for(const file of spec.windows){const exe=path.join(root,...file.split('/'));try{if((await fs.stat(exe)).isFile())return exe;}catch{}}return null;}
async function detect({env=process.env}={}){const available=[];for(const b of BROWSERS)if(await executableFor(b,env))available.push({id:b.id,label:b.label});let preferred='';try{preferred=(await run('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice','/v','ProgId'],{env,windowsHide:true,timeout:1500})).stdout.toLowerCase();}catch{}return {available,defaultBrowser:available.find(b=>preferred.includes(b.id))?.id||available[0]?.id||'other'};}
async function openExtensions(id,{env=process.env,profileDirectory=null,details=false}={}){const spec=BROWSERS.find(b=>b.id===id);if(!spec)throw Error('Unsupported browser.');if(profileDirectory!==null&&!/^(?:Default|Profile \d+)$/.test(profileDirectory))throw Error('Invalid browser profile.');const args=[...(profileDirectory?['--profile-directory='+profileDirectory]:[]),spec.url+(details?'?id='+identity.extensionId:'')];const exe=await executableFor(spec,env);if(!exe)throw Error('Browser executable not found.');const clean={...env};delete clean.ELECTRON_RUN_AS_NODE;delete clean.NODE_OPTIONS;const c=spawn(exe,args,{env:clean,detached:true,stdio:'ignore',windowsHide:false});await new Promise((r,j)=>{c.once('spawn',r);c.once('error',j);});c.unref();return true;}
module.exports.detect=detect;module.exports.openExtensions=openExtensions;
