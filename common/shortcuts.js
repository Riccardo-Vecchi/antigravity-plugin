/* Window-local, configurable shortcut; no global OS registration. */
(() => {
 'use strict';
 const VERSION='1.0.0';
 const rules=globalThis.__AGPAShortcutRules;
 const initial=globalThis.__AGPA_TOGGLE_SHORTCUT__;
 if(globalThis.__AGShortcuts?.version===VERSION){globalThis.__AGShortcuts.configure(initial);return;}
 globalThis.__AGShortcuts?.destroy();
 let stopped=false,shortcut=rules.normalize(initial===undefined?rules.defaultShortcut:initial);
 function keydown(event){
  if(stopped||event.target?.closest?.('[data-agpa-shortcut-setting]')||!rules.matches(event,shortcut))return;
  const visible=globalThis.__AGGeminiSwitch?.status().visible;
  const button=document.querySelector(visible?'[data-agpa-return-antigravity]':'[data-agpa-open-gemini]');
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();button.click();
 }
 function reapply(){if(stopped)return;window.removeEventListener('keydown',keydown,true);window.addEventListener('keydown',keydown,true);}
 globalThis.__AGShortcuts={version:VERSION,configure(value){shortcut=rules.normalize(value===undefined?rules.defaultShortcut:value);},status:()=>({installed:!stopped,shortcut}),reapply,destroy(){stopped=true;window.removeEventListener('keydown',keydown,true);delete globalThis.__AGShortcuts;}};
 reapply();
})();
