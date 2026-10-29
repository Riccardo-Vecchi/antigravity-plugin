"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {setupState}=require("../common/browser-setup.cjs"),script=fs.readFileSync(path.join(__dirname,"../common/companion-ui.js"),"utf8");
async function fixture(t,enabled=false) {
 let document,state={browser:{enabled,registered:enabled,connections:enabled?[{id:"fixture",label:"Test browser",tabs:2,scope:"tabs"}]:[],available:[{id:"brave",label:"Brave"}],defaultBrowser:"brave",installations:{brave:{status:"installed"}},extensionPath:"/test/extension",platform:"linux"}},fail=false;
 class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.attrs={};this.events={};this.value="";}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==="class")this.className=String(v);}
  getAttribute(k){return this.attrs[k]??null;}hasAttribute(k){return k in this.attrs;}
  get textContent(){return (this.text||"")+this.children.map(c=>c.textContent).join("");}
  set textContent(v){this.text=String(v);this.children=[];}
  append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}
  prepend(n){n.parentElement=this;this.children.unshift(n);}
  replaceChildren(...nodes){for(const n of this.children)n.parentElement=null;this.children=[];this.text="";this.append(...nodes);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}
  addEventListener(k,f){this.events[k]=f;}
  focus(){document.activeElement=this;}
  matches(s){if(s.includes(":popover-open"))return false;const tag=s.match(/^[\w-]+/);if(tag&&tag[0]!==this.tagName)return false;for(const c of s.matchAll(/\.([\w-]+)/g))if(!(this.className||"").split(" ").includes(c[1]))return false;for(const a of s.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g))if(!this.hasAttribute(a[1])||(a[2]!==undefined&&this.getAttribute(a[1])!==a[2]))return false;return true;}
  querySelectorAll(s){const out=[];for(const c of this.children){if(s.split(",").some(x=>c.matches(x.trim())))out.push(c);out.push(...c.querySelectorAll(s));}return out;}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  get isConnected(){return !!this.connected||!!this.parentElement?.isConnected;}
 }
 const host=new Element("main");host.connected=true;
 document={createElement:tag=>new Element(tag),activeElement:null,head:new Element("head"),hidden:false};
 const requests=[],context={document,crypto,queueMicrotask,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},window:{addEventListener(){},removeEventListener(){}},navigator:{clipboard:{writeText:async()=>{}}},localStorage:{getItem:()=>"brave",setItem(){}},__AGPAI18n:{language:"en",t:(key,p={})=>key.replace(/\{(\w+)\}/g,(_,k)=>p[k]??""),set(n,key,p={},attr){const value=key.replace(/\{(\w+)\}/g,(_,k)=>p[k]??"");attr?n.setAttribute(attr,value):n.textContent=value;},subscribe:()=>()=>{}},__AGSettingsNavigation:{getPage:()=>host,isOpen:()=>true},__AGNativeMcp:{status:()=>({detected:true}),refresh:async()=>true},__AGPABrowserSetupState:setupState,__AGPA_BROWSER_ICONS__:{},__AGPABrowserPicker:()=>new Element("div")};
 context.__agpaCompanion=raw=>{const p=JSON.parse(raw);requests.push(p.action);queueMicrotask(()=>{if(fail&&p.action!=="status"){context.__AGCompanion.onResult(p.requestId,false,{error:"operation"});return;}if(p.action==="setupBrowser")state.browser={...state.browser,enabled:true,registered:true,connections:[]};if(p.action==="disableBrowser")state.browser={...state.browser,enabled:false,registered:false,connections:[]};context.__AGCompanion.onResult(p.requestId,true,structuredClone(state));});};
 vm.createContext(context);vm.runInContext(script,context);t.after(()=>context.__AGCompanion.destroy());await new Promise(setImmediate);
 return {host,requests,context,toggle:()=>host.querySelector("[data-agpa-browser-toggle]"),fail:()=>fail=true};
}
test("disabled Browser use exposes only activation; enabling prepares setup without restoring shared tabs",async t=>{
 const f=await fixture(t);assert.equal(f.toggle().getAttribute("aria-checked"),"false");
 assert.equal(f.host.querySelectorAll("button").length,1);assert.equal(f.host.querySelectorAll(".agpa-comp-progress,.agpa-comp-advanced,[data-agpa-browser-refresh]").length,0);
 f.toggle().focus();await f.toggle().events.click();
 assert.equal(f.requests.at(-1),"setupBrowser");assert.equal(f.toggle().getAttribute("aria-checked"),"true");
 assert.equal(f.host.querySelector("[data-agpa-browser-extensions]").textContent,"Open Brave Extensions");
 assert.ok(f.host.querySelector("[data-agpa-browser-refresh]"));assert.equal(f.context.__AGCompanion.status().browser.connections.length,0);
});
test("disabling removes setup, profiles, diagnostics and refresh actions; the extension page uses the selected browser",async t=>{
 const f=await fixture(t,true);await f.host.querySelector("[data-agpa-browser-extensions]").events.click();assert.equal(f.requests.at(-1),"openExtensions");
 f.toggle().focus();await f.toggle().events.click();
 assert.equal(f.requests.at(-1),"disableBrowser");assert.equal(f.toggle().getAttribute("aria-checked"),"false");assert.equal(f.host.querySelectorAll("button").length,1);
 assert.equal(f.host.querySelectorAll(".agpa-comp-progress,.agpa-comp-profile,.agpa-comp-advanced,[data-agpa-browser-refresh],[data-agpa-browser-extensions]").length,0);
});
test("failed activation keeps the switch off and shows an actionable error without exposing disabled settings",async t=>{
 const f=await fixture(t);f.fail();await f.toggle().events.click();assert.equal(f.toggle().getAttribute("aria-checked"),"false");assert.ok(f.host.querySelector("[data-agpa-comp-error]"));assert.equal(f.host.querySelectorAll("button").length,1);
});
