'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createShortcutRules}=require('../common/shortcut-config.cjs');
test('the existing Gemini return button changes shortcuts without replacing its guest or duplicating listeners',()=>{
 const listeners=new Set(),resizeListeners=new Set(),signals=[];
 function element(){const attrs=new Map();return {parentElement:null,children:[],style:{},get isConnected(){return !!this.parentElement;},append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}},setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k),hasAttribute:k=>attrs.has(k),removeAttribute:k=>attrs.delete(k),addEventListener(){},removeEventListener(){},remove(){this.parentElement=null;}};}
 const head=element(),body=element(),anchor=element();anchor.parentElement=body;anchor.before=node=>{node.parentElement=body;node.nextElementSibling=anchor;};
 const context={document:{head,body,createElement:element,querySelector:()=>anchor,querySelectorAll:()=>[]},window:{addEventListener:(type,fn)=>(type==='resize'?resizeListeners:listeners).add(fn),removeEventListener:(type,fn)=>(type==='resize'?resizeListeners:listeners).delete(fn)},console:{info:value=>signals.push(value)},queueMicrotask,MutationObserver:class{observe(){}disconnect(){}}};vm.createContext(context);
 const source=fs.readFileSync(require.resolve('../common/gemini-inline.js'),'utf8');const start=source.indexOf('function installInGuest('),end=source.indexOf('\n  async function isolated',start);
 vm.runInContext(`globalThis.install=${source.slice(start,end)};globalThis.rules=${createShortcutRules.toString()}`,context);
 const settings={icon:'test-image',signal:'test-return-signal',returnLabel:'Return',toggleShortcut:'Ctrl+Shift+K'};context.install(settings,context.rules);
 const press=patch=>{let prevented=false;const event={code:'KeyG',ctrlKey:true,altKey:true,shiftKey:false,metaKey:false,repeat:false,isComposing:false,getModifierState:()=>false,preventDefault(){prevented=true},stopImmediatePropagation(){},...patch};for(const handler of listeners)handler(event);return prevented;};
 assert.equal(press({}),false);assert.equal(press({code:'KeyK',altKey:false,shiftKey:true}),true);assert.deepEqual(signals,['test-return-signal']);const count=head.children.length;
 context.install({...settings,toggleShortcut:null},context.rules);assert.equal(listeners.size,1);assert.equal(head.children.length,count);assert.equal(press({code:'KeyK',altKey:false,shiftKey:true}),false);
 context.__agpaInlineReturn.destroy();assert.equal(listeners.size,0);assert.equal(resizeListeners.size,0);
});
