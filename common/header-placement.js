/* Keep the existing Gemini controller and guest alive across native toolbar changes. */
(()=>{
 'use strict';const VERSION='1.0.0';if(globalThis.__AGHeaderPlacement?.version===VERSION)return;globalThis.__AGHeaderPlacement?.destroy();
 let owner,button,stopped=false,queued=false;
 function apply(){if(stopped)return;const current=globalThis.__AGGeminiSwitch;if(current!==owner){owner=current;button=null;}if(!owner)return;
  button=document.querySelector('[data-agpa-open-gemini]')||button;if(!button)return;
  const legacy=document.querySelector('[data-testid="titlebar-more-actions"]');
  if(legacy){if(button.parentElement!==legacy.parentElement)legacy.before(button);return;}
  const toolbar=document.querySelector('[data-testid="pane-titlebar-toolbar"]');if(!toolbar)return;
  const host=toolbar.querySelector(':scope > .flex.items-center.gap-1')||toolbar;
  if(button.parentElement!==host)host.append(button);
 }
 const observer=new MutationObserver(()=>{if(queued||stopped)return;queued=true;queueMicrotask(()=>{queued=false;apply();});});observer.observe(document.body,{childList:true,subtree:true});
 globalThis.__AGHeaderPlacement={version:VERSION,reapply:apply,destroy(){stopped=true;observer.disconnect();button=null;owner=null;delete globalThis.__AGHeaderPlacement;}};apply();
})();
