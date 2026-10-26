/* Translation applies only to this integration's controls, never user content. */
(() => {
 'use strict';
 const VERSION='1.6.0';
 const catalogs=globalThis.__AGPA_TRANSLATIONS__;
 delete globalThis.__AGPA_TRANSLATIONS__;
 if(globalThis.__AGPAI18n?.version===VERSION)return;
 globalThis.__AGPAI18n?.destroy();
 const bindings=new Set(),nodes=new WeakMap(),listeners=new Set();
 let stopped=false,queued=false;
 function normalize(value){const base=String(value||'en').trim().replace(/_/g,'-').toLowerCase().split('-')[0];return Object.hasOwn(catalogs,base)?base:'en';}
 function detect(){return normalize(document.documentElement.getAttribute('lang')||navigator.language||'en');}
 let language=detect();
 function t(key,params={}){
  const template=catalogs[language]?.strings[key]??catalogs.en.strings[key]??key;
  return template.replace(/\{(\w+)\}/g,(all,name)=>{const value=params[name];return value===undefined?all:String(typeof value==='function'?value():value);});
 }
 function write(entry){
  const node=entry.node.deref();if(!node){bindings.delete(entry);return;}
  const value=t(entry.key,entry.params);entry.last=value;
  if(entry.attr==='text'){if(node.textContent!==value)node.textContent=value;}
  else if(node.getAttribute(entry.attr)!==value)node.setAttribute(entry.attr,value);
 }
 function set(node,key,params={},attr='text'){
  let fields=nodes.get(node);if(!fields){fields=new Map();nodes.set(node,fields);}
  let entry=fields.get(attr);
  if(!entry){entry={node:new WeakRef(node),attr};fields.set(attr,entry);bindings.add(entry);}
  Object.assign(entry,{key,params});write(entry);return node;
 }
 function attrs(node,values){
  for(const attr of ['text','title','aria-label','placeholder'])if(Object.hasOwn(catalogs.en.strings,values[attr]))set(node,values[attr],{},attr);
  return node;
 }
 function adoptGemini(){
  // Also localize an already-mounted guest without recreating its controller.
  for(const node of document.querySelectorAll('[data-agpa-open-gemini],[data-agpa-return-antigravity],.agpa-gemini-tool,[data-agpa-gemini],[data-agpa-gemini] webview,.agpa-gemini-state')){
   const attributes=node.classList.contains('agpa-gemini-state')?['text']:['aria-label','title'];
   for(const attr of attributes){
    const current=attr==='text'?node.textContent:node.getAttribute(attr);
    const entry=nodes.get(node)?.get(attr);if(current===null||current===entry?.last)continue;
    if(Object.hasOwn(catalogs.en.strings,current)||current==='')set(node,current,{},attr);
    else if(attr==='text'){
     const match=/^Could not load Gemini \((-?\d+)\)\. Try Reload or open in browser\.$/.exec(current);
     if(match)set(node,'Could not load Gemini ({code}). Try Reload or open in browser.',{code:match[1]});
    }
   }
  }
 }
 function refresh(){
  if(stopped)return;const next=detect();
  if(next!==language){language=next;for(const entry of bindings)write(entry);for(const fn of listeners)fn(language);}
  adoptGemini();
 }
 const schedule=()=>{if(stopped||queued)return;queued=true;queueMicrotask(()=>{queued=false;refresh();});};
 const localeObserver=new MutationObserver(schedule);localeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 const controlsObserver=new MutationObserver(schedule);controlsObserver.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','title']});
 window.addEventListener('languagechange',schedule);
 globalThis.__AGPAI18n={version:VERSION,t,set,attrs,adoptGemini,normalize,
  get language(){return language;},
  iconName(id){return catalogs[language]?.icons[id]??catalogs.en.icons[id]??id;},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  destroy(){stopped=true;localeObserver.disconnect();controlsObserver.disconnect();window.removeEventListener('languagechange',schedule);bindings.clear();listeners.clear();delete globalThis.__AGPAI18n;}
 };
 adoptGemini();
})();
