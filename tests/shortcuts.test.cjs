'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');const crypto=require('node:crypto');
const script=fs.readFileSync(path.join(__dirname,'../common/shortcuts.js'),'utf8');
const appSettingsScript=fs.readFileSync(path.join(__dirname,'../common/app-settings.js'),'utf8');
const catalogs=require('../common/locales.json');
function fixture(extra={}){
 let visible=false,clicks=0;const listeners=new Set();const context={__AGPAShortcutRules:require('../common/shortcut-config.cjs'),window:{addEventListener:(event,fn)=>listeners.add(fn),removeEventListener:(event,fn)=>listeners.delete(fn)},document:{querySelector:()=>({click(){visible=!visible;clicks++}})},__AGGeminiSwitch:{status:()=>({visible})},...extra};vm.createContext(context);vm.runInContext(script,context);
 return {context,listeners,clicks:()=>clicks,press(patch={}){let prevented=false;const event={code:'KeyG',ctrlKey:true,altKey:true,metaKey:false,shiftKey:false,repeat:false,isComposing:false,getModifierState:()=>false,preventDefault(){prevented=true},stopImmediatePropagation(){},...patch};for(const fn of listeners)fn(event);return prevented;}};
}
test('the window-local chord toggles both views and prevents the handled key',()=>{
 const f=fixture();assert.equal(f.press(),true);assert.equal(f.context.__AGGeminiSwitch.status().visible,true);assert.equal(f.press(),true);assert.equal(f.context.__AGGeminiSwitch.status().visible,false);
});
test('ordinary typing, repeats, composition and AltGr are not intercepted',()=>{
 const f=fixture();for(const patch of [{code:'KeyB'},{ctrlKey:false},{altKey:false},{metaKey:true},{shiftKey:true},{repeat:true},{isComposing:true},{getModifierState:()=>true}])assert.equal(f.press(patch),false);assert.equal(f.clicks(),0);
});
test('reapplying or loading the shortcut twice does not duplicate listeners, and teardown removes it',()=>{
 const f=fixture();f.context.__AGShortcuts.reapply();vm.runInContext(script,f.context);assert.equal(f.listeners.size,1);f.press();assert.equal(f.clicks(),1);f.context.__AGShortcuts.destroy();assert.equal(f.listeners.size,0);
});
test('custom shortcuts apply immediately, can be disabled, and leave the recorder alone',()=>{
 const f=fixture();f.context.__AGShortcuts.configure('Ctrl+Shift+K');
 assert.equal(f.press(),false);assert.equal(f.press({code:'KeyK',altKey:false,shiftKey:true}),true);
 assert.equal(f.press({code:'KeyK',altKey:false,shiftKey:true,target:{closest:()=>({})}}),false);
 f.context.__AGShortcuts.configure(null);assert.equal(f.press({code:'KeyK',altKey:false,shiftKey:true}),false);
 assert.throws(()=>f.context.__AGShortcuts.configure('G'));assert.equal(f.context.__AGShortcuts.status().shortcut,null);
});
test('shortcut rules are self-contained and reject unsafe typing or malformed modifier combinations',()=>{
 const {createShortcutRules}=require('../common/shortcut-config.cjs');const rules=vm.runInNewContext(`(${createShortcutRules.toString()})()`);
 assert.equal(rules.normalize('Shift+Ctrl+5'),'Ctrl+Shift+5');assert.equal(rules.normalize(null),null);
 for(const value of ['G','Alt+G','Ctrl+G','Ctrl+Ctrl+Alt+G','Meta+Ctrl+Alt+G','Ctrl+Alt+F1',{},'Ctrl+Alt+g'])assert.throws(()=>rules.normalize(value));
 assert.deepEqual({...rules.defaultModelShortcuts()},{argon:'A',neon:'N',hydrogen:'H',flash:'F',orchestrator:'O'});
 assert.deepEqual({...rules.defaultModelShortcuts('Ctrl+Alt+A')},{argon:null,neon:'N',hydrogen:'H',flash:'F',orchestrator:'O'});
 assert.equal(rules.letterFromEvent({code:'KeyM',ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,repeat:false,isComposing:false}),'M');
 assert.equal(rules.letterFromEvent({code:'KeyM',ctrlKey:true,altKey:true,metaKey:false,shiftKey:false,repeat:false,isComposing:false}),'M');
 assert.equal(rules.letterFromEvent({code:'KeyC',ctrlKey:true,altKey:false,metaKey:false,shiftKey:false,repeat:false,isComposing:false}),undefined);
 assert.equal(rules.findShortcutConflicts({argon:'N',neon:'N',hydrogen:'H',flash:'F',orchestrator:'O'},'Ctrl+Alt+G')[0].type,'duplicate');
 assert.equal(rules.findShortcutConflicts({argon:'G',neon:'N',hydrogen:'H',flash:'F',orchestrator:'O'},'Ctrl+Alt+G')[0].type,'toggle');
 const entries=[
  {name:'Gemini 2.5 Flash',disabled:false,hidden:false},
  {name:'Gemini 3.8 Flash',disabled:false,hidden:false},
  {name:'Orchestrator (Neon)',disabled:false,hidden:false},
  {name:'Gemini 4 Neon',disabled:false,hidden:false},
  {name:'Gemini 4 Argon',disabled:false,hidden:true},
  {name:'Gemini 4 Hydrogen',disabled:false,hidden:false},
  {name:'Disabled Hydrogen',disabled:true,hidden:false}
 ];
 assert.equal(rules.matchModelEntry(entries,'argon').name,'Gemini 4 Argon');
 assert.equal(rules.matchModelEntry(entries,'neon').name,'Gemini 4 Neon');
 assert.equal(rules.matchModelEntry(entries,'hydrogen').name,'Gemini 4 Hydrogen');
 assert.equal(rules.matchModelEntry(entries,'flash').name,'Gemini 3.8 Flash');
 assert.equal(rules.matchModelEntry(entries,'orchestrator').name,'Orchestrator (Neon)');
 assert.equal(rules.matchModelEntry([{name:'Gemini 4 Flash'}],'flash').name,'Gemini 4 Flash');
});
test('Ctrl+Alt+A/N/H/F/O switch models on the fly using keyword matching and honor custom letters',()=>{
 const selected=[];let panelOpen=false,visible=false;const listeners=new Set();
 const models=[
  {name:'Gemini 4 Argon',effort:true,other:true},
  {name:'Orchestrator (Neon)',effort:false},
  {name:'Gemini 4 Neon',effort:true},
  {name:'Gemini 4 Hydrogen',effort:true},
  {name:'Gemini 2.5 Flash',effort:false},
  {name:'Gemini 3.8 Flash',effort:false}
 ];
 const rows=models.map(m=>{
  const row={getAttribute:k=>k==='data-agpa-model-other'&&m.other?'true':null,hasAttribute:()=>false,click(){selected.push(m.name);panelOpen=false;}};
  const item={dataset:m.effort?{modelBase:m.name}:{modelLabel:m.name},textContent:m.name,closest:s=>s==='[role=menuitem]'?row:null};
  return item;
 });
 const panel={querySelectorAll:()=>rows};
 const trigger={disabled:false,isConnected:true,getAttribute:k=>k==='aria-expanded'?String(panelOpen):null,click(){panelOpen=!panelOpen;}};
 const context={
  __AGPAShortcutRules:require('../common/shortcut-config.cjs'),
  __AGGeminiSwitch:{status:()=>({visible})},
  window:{addEventListener:(e,fn)=>listeners.add(fn),removeEventListener:(e,fn)=>listeners.delete(fn)},
  document:{
   querySelector:sel=>sel==='[data-testid=model-selector-panel]'&&panelOpen?panel:null,
   querySelectorAll:sel=>sel==='[data-testid=model-selector-trigger]'?[trigger]:[]
  },
  setTimeout,clearTimeout
 };
 vm.createContext(context);vm.runInContext(script,context);
 const press=code=>{let prevented=false;const ev={code,ctrlKey:true,altKey:true,metaKey:false,shiftKey:false,repeat:false,isComposing:false,getModifierState:()=>false,preventDefault(){prevented=true;},stopImmediatePropagation(){}};for(const fn of listeners)fn(ev);return prevented;};
 for(const [code,expected] of [['KeyA','Gemini 4 Argon'],['KeyN','Gemini 4 Neon'],['KeyH','Gemini 4 Hydrogen'],['KeyF','Gemini 3.8 Flash'],['KeyO','Orchestrator (Neon)']])
  assert.equal(press(code),true)&&assert.equal(selected.at(-1),expected);
 assert.deepEqual(selected,['Gemini 4 Argon','Gemini 4 Neon','Gemini 4 Hydrogen','Gemini 3.8 Flash','Orchestrator (Neon)']);
 context.__AGShortcuts.configure('Ctrl+Alt+G',{argon:'Z',neon:'N',hydrogen:'H',flash:'F',orchestrator:'O'});
 assert.equal(press('KeyA'),false);
 assert.equal(press('KeyZ'),true);
 assert.equal(selected.at(-1),'Gemini 4 Argon');
 visible=true;
 assert.equal(press('KeyN'),false);
});
test('Shortcuts settings renders the model shortcuts box below Gemini and enforces conflict checks',async()=>{
 function makeNode(tag,attrs={}){
  const listeners=new Map(),children=[],attrMap=new Map(),dataset={};
  const node={
   tagName:tag.toUpperCase(),children,parentElement:null,disabled:false,hidden:false,value:'',textContent:'',
   dataset,style:{setProperty(){}},classList:{contains:()=>false},
   get isConnected(){let cur=this;while(cur){if(cur.tagName==='BODY'||cur.tagName==='HEAD')return true;cur=cur.parentElement;}return false;},
   get previousElementSibling(){if(!this.parentElement)return null;const i=this.parentElement.children.indexOf(this);return i>0?this.parentElement.children[i-1]:null;},
   setAttribute(k,v){attrMap.set(k,String(v));if(k==='hidden')this.hidden=true;if(k.startsWith('data-')){const key=k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());dataset[key]=String(v);}},
   getAttribute:k=>attrMap.has(k)?attrMap.get(k):null,
   hasAttribute:k=>attrMap.has(k)|| (k==='hidden'&&this.hidden),
   removeAttribute(k){attrMap.delete(k);if(k==='hidden')this.hidden=false;if(k.startsWith('data-')){const key=k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());delete dataset[key];}},
   toggleAttribute(k,force){const has=this.hasAttribute(k);const next=force===undefined?!has:!!force;if(next)this.setAttribute(k,'');else this.removeAttribute(k);return next;},
   append(...items){for(const item of items){const child=typeof item==='string'?makeNode('#text'):item;if(typeof item==='string')child.textContent=item;child.parentElement=this;children.push(child);}},
   after(...items){if(!this.parentElement)return;const idx=this.parentElement.children.indexOf(this);let offset=1;for(const item of items){item.parentElement=this.parentElement;this.parentElement.children.splice(idx+offset++,0,item);}},
   remove(){if(!this.parentElement)return;const i=this.parentElement.children.indexOf(this);if(i>=0)this.parentElement.children.splice(i,1);this.parentElement=null;},
   focus(){},
   addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
   dispatchEvent(ev){for(const fn of listeners.get(ev.type)||[])fn(ev);},
   click(){this.dispatchEvent({type:'click',preventDefault(){},stopPropagation(){}});},
   matches(sel){return sel.split(',').some(part=>{const chain=part.trim().split(/\s+/);const matchSingle=(el,s)=>{const cls=s.split('.').slice(1);const head=s.split('.')[0];const m=/^(?:([a-z0-9]+))?\[([^=\]]+)(?:=([^\]]+))?\]$/i.exec(head);if(m){if(m[1]&&el.tagName!==m[1].toUpperCase())return false;const val=el.getAttribute(m[2]);if(!(m[3]===undefined?val!==null:val===m[3].replace(/^"|"$/g,'')))return false;}else if(head&&head!=='*'&&el.tagName!==head.toUpperCase())return false;if(cls.length){const list=(el.getAttribute('class')||'').split(/\s+/);if(!cls.every(c=>list.includes(c)))return false;}return true;};if(!matchSingle(this,chain[chain.length-1]))return false;let cur=this.parentElement;for(let i=chain.length-2;i>=0;i--){while(cur&&!matchSingle(cur,chain[i]))cur=cur.parentElement;if(!cur)return false;cur=cur.parentElement;}return true;});},
   closest(sel){let cur=this;while(cur){if(cur.matches(sel))return cur;cur=cur.parentElement;}return null;},
   querySelectorAll(sel){const out=[];const visit=n=>{for(const c of n.children){if(c.matches(sel))out.push(c);visit(c);}};visit(this);return out;},
   querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
  };
  for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);
  return node;
 }
 const head=makeNode('head'),body=makeNode('body'),dialog=makeNode('div',{role:'dialog'}),shortcutsPane=makeNode('div',{class:'p-6'});
 const h2=makeNode('h2');h2.textContent='Shortcuts';
 const nativeRow=makeNode('div');const nativeKbd1=makeNode('kbd');nativeKbd1.textContent='Ctrl';const nativeKbd2=makeNode('kbd');nativeKbd2.textContent='Alt';const nativeKbd3=makeNode('kbd');nativeKbd3.textContent='W';nativeRow.append(nativeKbd1,nativeKbd2,nativeKbd3);
 const navItem=makeNode('button',{'data-testid':'settings-nav-item-Shortcuts'});navItem.textContent='Shortcuts';
 shortcutsPane.append(h2,nativeRow);dialog.append(shortcutsPane);body.append(navItem,dialog);
 const sent=[];
 const i18n={
  language:'en',
  t:(k,p={})=>k.replace(/\{(\w+)\}/g,(a,n)=>p[n]??a),
  set:(n,k,p={},a='text')=>{const v=i18n.t(k,p);if(a==='text')n.textContent=v;else n.setAttribute(a,v);},
  attrs:(n,v)=>{for(const a of ['text','title','aria-label'])if(v[a])i18n.set(n,v[a],{},a);},
  subscribe:()=>()=>{}
 };
 const context={
  __AGPAI18n:i18n,
  __AGPAShortcutRules:require('../common/shortcut-config.cjs'),
  __AGPA_APP_SETTINGS__:{version:2,taskbarIcon:'antigravity',startupView:'antigravity',autostart:false,toggleShortcut:'Ctrl+Alt+G',modelShortcuts:{argon:'A',neon:'N',hydrogen:'H',flash:'F',orchestrator:'O'}},
  __AGPA_APP_ICON_ASSETS__:{antigravity:'a',gemini:'g'},
  __AGPA_STARTUP_APPLIED__:true,
  __agpaAppSettings:raw=>{const msg=JSON.parse(raw);sent.push(msg);const cur=context.__AGAppSettings?.status?.()||{};queueMicrotask(()=>context.__AGAppSettings?.onSaved(msg.requestId,true,null,{...context.__AGPA_APP_SETTINGS__,...cur,modelShortcuts:msg.action==='setModelShortcuts'?msg.value:cur.modelShortcuts||context.__AGPA_APP_SETTINGS__.modelShortcuts}));},
  document:{head,body,createElement:t=>makeNode(t),querySelector:s=>body.querySelector(s)||head.querySelector(s),querySelectorAll:s=>body.querySelectorAll(s)},
  window:{addEventListener(){},removeEventListener(){}},
  MutationObserver:class{observe(){}disconnect(){}},
  crypto,queueMicrotask,setTimeout,clearTimeout
 };
 vm.createContext(context);vm.runInContext(appSettingsScript,context);
 await new Promise(setImmediate);
 const geminiBox=shortcutsPane.querySelector('[data-agpa-shortcut-setting]');
 const modelBox=shortcutsPane.querySelector('[data-agpa-model-shortcuts-setting]');
 assert.ok(geminiBox&&modelBox);
 assert.equal(geminiBox.nextElementSibling||shortcutsPane.children[shortcutsPane.children.indexOf(geminiBox)+1],modelBox);
 const argonInput=modelBox.querySelector('[data-agpa-model-shortcut-input=argon]');
 const saveBtn=modelBox.querySelector('[data-agpa-model-shortcuts-save]');
 const conflictEl=modelBox.querySelector('[data-agpa-conflict]');
 assert.equal(argonInput.value,'A');assert.equal(saveBtn.disabled,true);assert.equal(conflictEl.hidden,true);
 // Duplicate conflict with Neon (N)
 argonInput.dispatchEvent({type:'keydown',code:'KeyN',key:'n',ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,repeat:false,isComposing:false,preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(saveBtn.disabled,true);assert.equal(conflictEl.hidden,false);assert.match(conflictEl.textContent,/Ctrl\+Alt\+N/);
 assert.equal(modelBox.querySelector('[data-model-shortcut-id=argon]').hasAttribute('data-conflict'),true);
 assert.equal(modelBox.querySelector('[data-model-shortcut-id=neon]').hasAttribute('data-conflict'),true);
 // Conflict with Gemini toggle shortcut (G)
 argonInput.dispatchEvent({type:'keydown',code:'KeyG',key:'g',ctrlKey:true,altKey:true,metaKey:false,shiftKey:false,repeat:false,isComposing:false,preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(saveBtn.disabled,true);assert.match(conflictEl.textContent,/Ctrl\+Alt\+G/);
 // Native shortcut warning (W)
 argonInput.dispatchEvent({type:'keydown',code:'KeyW',key:'w',ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,repeat:false,isComposing:false,preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(saveBtn.disabled,false);assert.equal(conflictEl.dataset.severity,'warning');assert.match(conflictEl.textContent,/Ctrl\+Alt\+W/);
 // Valid unused letter (K) saves cleanly
 argonInput.dispatchEvent({type:'keydown',code:'KeyK',key:'k',ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,repeat:false,isComposing:false,preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(saveBtn.disabled,false);assert.equal(conflictEl.hidden,true);
 saveBtn.click();
 await new Promise(setImmediate);
 assert.equal(sent.at(-1).action,'setModelShortcuts');
 assert.deepEqual(sent.at(-1).value,{argon:'K',neon:'N',hydrogen:'H',flash:'F',orchestrator:'O'});
 // Reverse conflict check: editing Gemini toggle shortcut to Ctrl+Alt+K (used by Argon)
 geminiBox.querySelector('button').click();
 geminiBox.querySelector('[data-agpa-shortcut-input]').dispatchEvent({type:'keydown',code:'KeyK',key:'k',ctrlKey:true,altKey:true,metaKey:false,shiftKey:false,repeat:false,isComposing:false,preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(geminiBox.querySelector('[data-agpa-shortcut-save]').disabled,true);
 assert.match(geminiBox.querySelector('[data-agpa-conflict]').textContent,/Ctrl\+Alt\+K/);
 context.__AGAppSettings.destroy();
});
