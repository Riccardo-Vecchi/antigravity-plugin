/* Window-local shortcut; no global OS registration or remote native bridge. */
(() => {
 'use strict';
 const VERSION='1.7.0';
 if(globalThis.__AGShortcuts?.version===VERSION)return;
 globalThis.__AGShortcuts?.destroy();
 let stopped=false;
 function matches(event){return event.code==='KeyG'&&event.ctrlKey&&event.altKey&&!event.metaKey&&!event.shiftKey&&!event.repeat&&!event.isComposing&&!event.getModifierState?.('AltGraph');}
 function keydown(event){
  if(stopped||!matches(event))return;
  const visible=globalThis.__AGGeminiSwitch?.status().visible;
  const button=document.querySelector(visible?'[data-agpa-return-antigravity]':'[data-agpa-open-gemini]');
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();button.click();
 }
 function reapply(){if(stopped)return;window.removeEventListener('keydown',keydown,true);window.addEventListener('keydown',keydown,true);}
 globalThis.__AGShortcuts={version:VERSION,status:()=>({installed:!stopped,shortcut:'Ctrl+Alt+G'}),reapply,destroy(){stopped=true;window.removeEventListener('keydown',keydown,true);delete globalThis.__AGShortcuts;}};
 reapply();
})();
