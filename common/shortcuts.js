/* Window-local, configurable shortcuts; no global OS registration. */
(() => {
 'use strict';
 const VERSION='1.1.0';
 const rules=globalThis.__AGPAShortcutRules;
 const initial=globalThis.__AGPA_TOGGLE_SHORTCUT__;
 if(globalThis.__AGShortcuts?.version===VERSION){globalThis.__AGShortcuts.configure(initial);return;}
 globalThis.__AGShortcuts?.destroy();
 let stopped=false,switching=0,shortcut=rules.normalize(initial===undefined?rules.defaultShortcut:initial);
 const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
 function findTrigger(){
  if(globalThis.__AGGeminiSwitch?.status().visible)return null;
  if([...document.querySelectorAll('dialog[open],[role=dialog]')].some(el=>el.getClientRects().length))return null;
  return [...document.querySelectorAll('[data-testid=model-selector-trigger]')].find(el=>!el.disabled && el.getClientRects().length);
 }
 async function selectModel(trigger,name){
  const token=++switching;
  const modelUI=globalThis.__AGModelUI;
  const panel=()=>document.querySelector('[data-testid=model-selector-panel]');
  const openedHere=!panel();
  if(openedHere)trigger.click();
  // The host can mount the menu asynchronously. Stop on dismissal or a newer shortcut.
  const deadline=Date.now()+1500;
  let entries=[];
  while(!stopped && switching===token && trigger.isConnected){
   const menu=panel();
   entries=menu ? modelUI.entries(menu) : [];
   if(entries.length || Date.now()>=deadline)break;
   await tick();
   if(trigger.getAttribute('aria-expanded')!=='true')return;
  }
  if(stopped || switching!==token || !trigger.isConnected || findTrigger()!==trigger)return;
  const entry=entries.find(item=>item.name===name);
  if(entry && !entry.row.matches('[aria-disabled=true],[data-disabled],:disabled')){
   entry.row.click();
   return;
  }
  if(openedHere && trigger.getAttribute('aria-expanded')==='true')trigger.click();
  modelUI.showUnavailable(name);
 }
 function keydown(event){
  if(event.key==='Escape')switching++;
  if(stopped||event.target?.closest?.('[data-agpa-shortcut-setting],[data-agpa-model-shortcut]'))return;
  if(rules.matches(event,shortcut)){
   const visible=globalThis.__AGGeminiSwitch?.status().visible;
   const button=document.querySelector(visible?'[data-agpa-return-antigravity]':'[data-agpa-open-gemini]');
   if(!button)return;
   event.preventDefault();event.stopImmediatePropagation();button.click();return;
  }
  const chord=rules.fromEvent(event);
  if(!chord)return;
  const name=globalThis.__AGModelUI?.nameForShortcut(chord);
  if(!name)return;
  const trigger=findTrigger();
  if(!trigger)return;
  event.preventDefault();event.stopImmediatePropagation();
  void selectModel(trigger,name);
 }
 function reapply(){if(stopped)return;window.removeEventListener('keydown',keydown,true);window.addEventListener('keydown',keydown,true);}
 globalThis.__AGShortcuts={
  version:VERSION,
  configure(value){shortcut=rules.normalize(value===undefined?rules.defaultShortcut:value);},
  status:()=>({installed:!stopped,shortcut}),
  reapply,
  destroy(){stopped=true;switching++;window.removeEventListener('keydown',keydown,true);delete globalThis.__AGShortcuts;}
 };
 reapply();
})();
