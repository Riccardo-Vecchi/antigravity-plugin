/* Window-local, configurable shortcuts; no global OS registration. */
(() => {
 'use strict';
 const VERSION='1.1.0';
 const rules=globalThis.__AGPAShortcutRules;
 const initial=globalThis.__AGPA_TOGGLE_SHORTCUT__;
 const initialModels=globalThis.__AGPA_MODEL_SHORTCUTS__;
 if(globalThis.__AGShortcuts?.version===VERSION){globalThis.__AGShortcuts.configure(initial,initialModels);return;}
 globalThis.__AGShortcuts?.destroy();
 let stopped=false,switching=0,shortcut=rules.normalize(initial===undefined?rules.defaultShortcut:initial),modelShortcuts=rules.normalizeModelShortcuts(initialModels,shortcut);
 const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
 function readEntries(panel){
  if(!panel||typeof panel.querySelectorAll!=='function')return [];
  return [...panel.querySelectorAll('[data-testid=model-selector-item],[data-testid=model-selector-effort-group]')].map(el=>{
   const row=el.closest?.('[role=menuitem]')||el.parentElement;
   const name=(el.dataset?.modelLabel||el.dataset?.modelBase||el.textContent||'').trim();
   const disabled=!row||row.getAttribute?.('aria-disabled')==='true'||row.hasAttribute?.('data-disabled');
   const hidden=row?.getAttribute?.('data-agpa-model-other')==='true'||row?.getAttribute?.('data-agpa-model-hidden')==='true';
   return {row,name,disabled,hidden};
  }).filter(e=>e.row&&e.name);
 }
 async function selectModel(trigger,slotId){
  const token=++switching;
  let openedHere=false;
  let panel=document.querySelector?.('[data-testid=model-selector-panel]');
  let entries=readEntries(panel);
  if(!entries.length){
   openedHere=true;
   trigger.click();
   panel=document.querySelector?.('[data-testid=model-selector-panel]');
   entries=readEntries(panel);
   if(!entries.length){
    const deadline=Date.now()+1500;
    while(!stopped&&token===switching&&trigger.isConnected!==false&&Date.now()<deadline){
     await tick();
     if(stopped||token!==switching)return;
     panel=document.querySelector?.('[data-testid=model-selector-panel]');
     entries=readEntries(panel);
     if(entries.length)break;
    }
   }
  }
  if(stopped||token!==switching)return;
  const match=rules.matchModelEntry(entries,slotId);
  if(match){match.row.click();return;}
  if(openedHere&&trigger.getAttribute?.('aria-expanded')==='true')trigger.click();
 }
 function findTrigger(){
  if(globalThis.__AGGeminiSwitch?.status().visible)return null;
  if(document.querySelector?.('[role=dialog],dialog[open]'))return null;
  const triggers=typeof document.querySelectorAll==='function'?[...document.querySelectorAll('[data-testid=model-selector-trigger]')]:[document.querySelector?.('[data-testid=model-selector-trigger]')].filter(Boolean);
  return triggers.find(el=>!el.disabled&&(typeof el.getClientRects!=='function'||el.getClientRects().length>0))||null;
 }
 function keydown(event){
  if(stopped||event.target?.closest?.('[data-agpa-shortcut-setting],[data-agpa-model-shortcuts-setting]'))return;
  if(rules.matches(event,shortcut)){
   const visible=globalThis.__AGGeminiSwitch?.status().visible;
   const button=document.querySelector(visible?'[data-agpa-return-antigravity]':'[data-agpa-open-gemini]');
   if(!button)return;
   event.preventDefault();event.stopImmediatePropagation();button.click();return;
  }
  const chord=rules.fromEvent(event);
  if(!chord)return;
  const slot=rules.modelDefinitions.find(def=>rules.modelChord(modelShortcuts[def.id])===chord);
  if(!slot)return;
  const trigger=findTrigger();
  if(!trigger)return;
  event.preventDefault();event.stopImmediatePropagation();
  void selectModel(trigger,slot.id);
 }
 function reapply(){if(stopped)return;window.removeEventListener('keydown',keydown,true);window.addEventListener('keydown',keydown,true);}
 globalThis.__AGShortcuts={
  version:VERSION,
  configure(value,models){
   const nextShortcut=value===undefined?shortcut:rules.normalize(value);
   const nextModels=models===undefined?modelShortcuts:rules.normalizeModelShortcuts(models,nextShortcut);
   shortcut=nextShortcut;modelShortcuts=nextModels;
  },
  status:()=>({installed:!stopped,shortcut,modelShortcuts:{...modelShortcuts}}),
  reapply,
  destroy(){stopped=true;switching++;window.removeEventListener('keydown',keydown,true);delete globalThis.__AGShortcuts;}
 };
 reapply();
})();
