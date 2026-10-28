/* Local application appearance and startup preferences in native Settings. */
(() => {
 'use strict';
 const VERSION='1.1.0';
 const i18n=globalThis.__AGPAI18n;
 const initial=globalThis.__AGPA_APP_SETTINGS__||{version:2,taskbarIcon:'antigravity',startupView:'antigravity'};
 const icons=globalThis.__AGPA_APP_ICON_ASSETS__;
 let patch=globalThis.__AGPA_PATCH_STATUS__||{version:VERSION,state:'unchecked',checks:[]};delete globalThis.__AGPA_PATCH_STATUS__;
 delete globalThis.__AGPA_APP_SETTINGS__;delete globalThis.__AGPA_APP_ICON_ASSETS__;
 if(globalThis.__AGAppSettings?.version===VERSION){globalThis.__AGAppSettings.setState(initial);return;}
 globalThis.__AGAppSettings?.destroy();
 let state=initial,section=null,startupSection=null,patchSection=null,shortcutSection=null,scheduled=false,destroyed=false,busy=false,lastView=null;
 const pending=new Map();
 let shortcutDraft,recording=false;
 const shortcutRules=globalThis.__AGPAShortcutRules;
 function node(tag,attrs={},...children){const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs))if(k==='text')n.textContent=v;else n.setAttribute(k,v);for(const c of children)if(c)n.append(c);i18n.attrs(n,attrs);return n;}
 const styles=node('style',{id:'agpa-app-settings-styles',text:`
  .agpa-app-icon-section {display:flex;flex-direction:column;gap:12px;padding:15px;border:1px solid var(--border,#353535);border-radius:12px;color:var(--foreground,#eee)}
  .agpa-app-icon-section h3 {font-size:14px;font-weight:500;margin:0}
  .agpa-app-icon-description,.agpa-app-icon-status {font-size:12px;line-height:1.5;color:var(--muted-foreground,#aaa);margin:0}
  .agpa-app-icon-options {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.agpa-app-icon-options>.agpa-app-icon-option{min-width:0;width:100%;height:100%;justify-content:center}.agpa-app-icon-options>.agpa-app-icon-option>span:last-child{overflow-wrap:anywhere}@media(max-width:650px){.agpa-app-icon-options{grid-template-columns:1fr}}
  .agpa-app-icon-option {display:flex;align-items:center;gap:10px;min-width:145px;padding:10px 12px;border:1px solid var(--border,#444);border-radius:10px;background:transparent;color:inherit;font:14px system-ui,sans-serif;cursor:pointer}
  .agpa-app-icon-option[aria-checked=true] {border-color:#398bdb;background:var(--secondary,#292929);box-shadow:0 0 0 1px #398bdb}
  .agpa-app-icon-option:hover {background:var(--secondary,#292929)}
  .agpa-app-icon-option:focus-visible {outline:2px solid #398bdb;outline-offset:2px}
  .agpa-app-icon-option:disabled {opacity:.6;cursor:wait}
  .agpa-app-icon-option img {width:30px;height:30px;object-fit:contain}
  .agpa-dynamic-icons {display:flex;align-items:center;width:30px}
  .agpa-dynamic-icons img {width:20px;height:20px}
  .agpa-dynamic-icons img+img {margin-left:-7px;margin-top:12px}
  .agpa-autostart-row {display:flex;align-items:center;gap:10px;padding-top:14px;border-top:1px solid var(--border,#353535);font-size:13px;cursor:pointer}
  .agpa-autostart-row input {width:16px;height:16px;accent-color:#398bdb}
  .agpa-patch-actions {display:flex;flex-wrap:wrap;gap:10px}
  .agpa-patch-actions button {min-width:0;font-size:13px;padding:8px 12px}
  .agpa-patch-check {display:flex;justify-content:space-between;gap:12px;font-size:12px;padding:5px 0}
  .agpa-patch-summary[data-state=compatible] {color:#75c98b}
  .agpa-patch-summary[data-state=needsRepair],.agpa-patch-summary[data-state=incompatible] {color:#efbd6a}
  .agpa-shortcut-input {background:transparent;color:inherit;min-width:190px}
  .agpa-shortcut-key {align-self:flex-start;padding:6px 10px;border:1px solid var(--border,#444);border-radius:6px;font-size:13px}
 `});document.head.append(styles);
 function paint(){
  for(const b of section?.querySelectorAll('[data-agpa-app-icon]')||[]){b.setAttribute('aria-checked',String(b.getAttribute('data-agpa-app-icon')===state.taskbarIcon));b.disabled=busy;}
  for(const b of startupSection?.querySelectorAll('[data-agpa-startup-view]')||[]){b.setAttribute('aria-checked',String(b.getAttribute('data-agpa-startup-view')===state.startupView));b.disabled=busy;}
  const autostart=startupSection?.querySelector('[data-agpa-autostart]');if(autostart){autostart.checked=!!state.autostart;autostart.disabled=busy;}
  if(shortcutSection){
   const input=shortcutSection.querySelector('[data-agpa-shortcut-input]');
   input.value=recording?i18n.t('Press a shortcut…'):(shortcutDraft!==undefined?shortcutDraft:state.toggleShortcut===undefined?shortcutRules.defaultShortcut:state.toggleShortcut)||i18n.t('Disabled');
   for(const b of shortcutSection.querySelectorAll('button'))b.disabled=busy;
   shortcutSection.querySelector('[data-agpa-shortcut-save]').disabled=busy||recording||shortcutDraft===undefined;
  }
  const tray=section?.querySelector('[data-agpa-tray-status]');
  if(tray)i18n.set(tray,state.platform==='linux'&&!state.desktopIconAvailable?'AppImage or launcher not found. Check the plugin installation settings.':state.platform==='win32'&&!state.desktopIconAvailable?'Open Antigravity (customized) to enable window and tray icons.':state.trayAvailable?'The tray icon follows the same choice.':'Tray updates are available with supported GNOME/Zorin AppIndicator setups.');
  if(patchSection){
   for(const button of patchSection.querySelectorAll('button'))button.disabled=busy;
   for(const row of patchSection.querySelectorAll('[data-agpa-check]')){
    const result=patch.checks.find(c=>c.id===row.getAttribute('data-agpa-check'));
    i18n.set(row.lastElementChild,result?(result.ok?'Ready':'Needs attention'):'Not checked');
   }
  }
 }
 async function choose(action,value){
  if(busy)return;busy=true;paint();
  const diagnostic=['checkCompatibility','repairIntegration'].includes(action);
  const status=(diagnostic?patchSection:action==='setToggleShortcut'?shortcutSection:action==='setTaskbarIcon'?section:startupSection).querySelector(diagnostic?'[data-agpa-patch-operation]':'[role=status]');i18n.set(status,action==='checkCompatibility'?'Checking…':action==='repairIntegration'?'Reapplying…':'Applying…');
  const requestId=crypto.randomUUID();
  try{
   const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Could not apply the preference. Check the local integration service.'));},12000);pending.set(requestId,{resolve,reject,timer});try{globalThis.__agpaAppSettings(JSON.stringify({requestId,action,value}));}catch(e){clearTimeout(timer);pending.delete(requestId);reject(e);}});
   if(action==='setToggleShortcut'){shortcutDraft=undefined;recording=false;}
   i18n.set(status,action==='checkCompatibility'?(result?.state==='compatible'?'Compatibility check passed.':'Some checks need attention.'):action==='repairIntegration'?(result?.repaired?'Patch reapplied.':result?.reason==='editor'?'Close the project editor before reapplying the patch.':result?.reason==='session'?'The open Gemini session was preserved. Reopen the app to finish recovery.':'The native interface changed. Reapplying was skipped to preserve the current session.'):action==='setTaskbarIcon'&&state.platform==='win32'&&!state.desktopIconAvailable?'Saved. Native icons will apply when started from the customized launcher.':action==='setStartupView'?'Saved for the next window.':action==='setAutostart'?'Saved for your next desktop sign-in.':'Applied.');
  }catch(e){i18n.set(status,'Could not apply the preference. Check the local integration service.');}finally{busy=false;paint();}
 }
 function radioGroup(attribute,choices,label,action){
  const group=node('div',{class:'agpa-app-icon-options',role:'radiogroup','aria-label':label});
  for(const choice of choices){
   const title=choice==='last'?'Remember last view':choice==='dynamic'?'Dynamic':choice==='antigravity'?'Antigravity':'Gemini';
   const image=['dynamic','last'].includes(choice)?node('span',{class:'agpa-dynamic-icons','aria-hidden':'true'},node('img',{src:icons.antigravity,alt:''}),node('img',{src:icons.gemini,alt:''})):node('img',{src:icons[choice],alt:'',width:'30',height:'30'});
   const b=node('button',{type:'button',class:'agpa-app-icon-option',role:'radio',[attribute]:choice,'aria-label':title},image,node('span',{text:title}));
   b.addEventListener('click',()=>choose(action,choice));
   b.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const step=['ArrowLeft','ArrowUp'].includes(e.key)?-1:1;const next=choices[(choices.indexOf(choice)+step+choices.length)%choices.length];const other=group.querySelector(`[${attribute}="${next}"]`);other.focus();other.click();}});
   group.append(b);
  }
  return group;
 }
 function nativeSection(key){
  const nav=document.querySelector(`[data-testid="settings-nav-item-${key}"]`);
  const label=nav?.textContent.trim();if(!label)return null;
  const heading=[...document.querySelectorAll('[role=dialog] h2')].find(n=>n.textContent.trim()===label);
  return heading?.closest('div.p-6');
 }
 function apply(){
  if(destroyed)return;
  const appearance=nativeSection('Appearance'),application=nativeSection('App'),shortcuts=nativeSection('Shortcuts');
  if(appearance&&!section){
   section=node('section',{class:'agpa-app-icon-section','data-agpa-app-icon-setting':'','aria-labelledby':'agpa-app-icon-title'},
    node('h3',{id:'agpa-app-icon-title',text:'Application icon'}),
    node('p',{class:'agpa-app-icon-description',text:'Choose a fixed icon, or let Dynamic follow the view you are using.'}),
    radioGroup('data-agpa-app-icon',['antigravity','gemini','dynamic'],'Application icon','setTaskbarIcon'),
    node('p',{class:'agpa-app-icon-description','data-agpa-tray-status':''}),
    node('p',{class:'agpa-app-icon-status',role:'status','aria-live':'polite'}));
  }
  if(application&&!startupSection){
   startupSection=node('section',{class:'agpa-app-icon-section','data-agpa-startup-setting':'','aria-labelledby':'agpa-startup-title'},
    node('h3',{id:'agpa-startup-title',text:'Startup'}),
    node('h3',{text:'Start in'}),
    node('p',{class:'agpa-app-icon-description',text:'Choose the view opened when a new Antigravity window starts.'}),
    radioGroup('data-agpa-startup-view',['antigravity','gemini','last'],'Startup view','setStartupView'),
    node('p',{class:'agpa-app-icon-description',text:'Remember last view restores the last view used in any app window.'}),
    node('label',{class:'agpa-autostart-row'},node('input',{type:'checkbox','data-agpa-autostart':'','aria-label':'Launch at desktop sign-in'}),node('span',{text:'Launch at desktop sign-in'})),
    node('p',{class:'agpa-app-icon-description',text:state.platform==='win32'?'Start the app automatically when you sign in to Windows.':'Start the app automatically when you sign in to Linux.'}),
    node('p',{class:'agpa-app-icon-status',role:'status','aria-live':'polite'}));
   startupSection.querySelector('[data-agpa-autostart]').addEventListener('change',e=>choose('setAutostart',e.target.checked));
  }
  if(application&&!patchSection){
   const checks=node('div',{'data-agpa-patch-checks':''});
   for(const [id,label]of [['native','Native interface'],['projects','Project appearance'],['settings','Settings integration'],['gemini','Gemini switching'],['shortcut','Keyboard shortcut']])checks.append(node('div',{class:'agpa-patch-check','data-agpa-check':id},node('span',{text:label}),node('span',{text:'Not checked'})));
   const check=node('button',{type:'button',class:'agpa-app-icon-option','data-agpa-check-compatibility':'',text:'Check compatibility'});
   const repair=node('button',{type:'button',class:'agpa-app-icon-option','data-agpa-repair-integration':'',text:'Reapply patch'});
   check.addEventListener('click',()=>choose('checkCompatibility',true));repair.addEventListener('click',()=>choose('repairIntegration',true));
   patchSection=node('div',{'data-agpa-patch-setting':''},checks,
    node('div',{class:'agpa-patch-actions'},check,repair),node('p',{class:'agpa-app-icon-status',role:'status','aria-live':'polite','data-agpa-patch-operation':''}));
  }
  if(shortcuts&&!shortcutSection){
   const input=node('input',{type:'text',readonly:'',class:'agpa-shortcut-key agpa-shortcut-input','data-agpa-shortcut-input':'','aria-label':'Switch shortcut'});
   const change=node('button',{type:'button',class:'agpa-app-icon-option',text:'Change shortcut'});
   const save=node('button',{type:'button',class:'agpa-app-icon-option','data-agpa-shortcut-save':'',text:'Save shortcut'});
   const reset=node('button',{type:'button',class:'agpa-app-icon-option',text:'Reset shortcut'});
   const disable=node('button',{type:'button',class:'agpa-app-icon-option',text:'Disable shortcut'});
   change.addEventListener('click',()=>{recording=true;shortcutDraft=undefined;paint();input.focus();});
   input.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();recording=false;shortcutDraft=undefined;paint();return;}
    if(!recording)return;e.preventDefault();e.stopImmediatePropagation();
    const value=shortcutRules.fromEvent(e);if(value===undefined)return;
    shortcutDraft=value;recording=false;paint();
   });
   save.addEventListener('click',()=>choose('setToggleShortcut',shortcutDraft));
   reset.addEventListener('click',()=>choose('setToggleShortcut',shortcutRules.defaultShortcut));
   disable.addEventListener('click',()=>choose('setToggleShortcut',null));
   shortcutSection=node('section',{class:'agpa-app-icon-section','data-agpa-shortcut-setting':''},
    node('h3',{text:'Switch between Antigravity and Gemini'}),input,
    node('p',{class:'agpa-app-icon-description',text:'Use Ctrl+Alt or Ctrl+Shift with a letter or number. System shortcuts may take priority.'}),
    node('div',{class:'agpa-patch-actions'},change,save,reset,disable),
    node('p',{class:'agpa-app-icon-description',text:'Works while an Antigravity or Gemini window is focused.'}),
    node('p',{class:'agpa-app-icon-status',role:'status','aria-live':'polite'}));
  }

  if(shortcutSection&&shortcuts&&shortcutSection.parentElement!==shortcuts)shortcuts.children[0]?.after(shortcutSection);
  if(section&&appearance&&section.parentElement!==appearance)appearance.children[0]?.after(section);
  if(startupSection&&application&&startupSection.parentElement!==application)application.children[0]?.after(startupSection);
  const diagnosticHost=application?.querySelector('[data-pu-diagnostics]');
  if(patchSection&&diagnosticHost&&patchSection.parentElement!==diagnosticHost)diagnosticHost.append(patchSection);
  paint();
 }
 function startup(){
  if(globalThis.__AGPA_STARTUP_APPLIED__)return true;
  const api=globalThis.__AGGeminiSwitch;if(!api)return false;
  if(api.status().guestCreated){globalThis.__AGPA_STARTUP_APPLIED__=true;return true;}
  if((state.startupView==='last'?(state.lastView||'antigravity'):state.startupView)==='gemini'){
   const open=document.querySelector('[data-agpa-open-gemini]');if(!open)return false;
   globalThis.__AGPA_STARTUP_APPLIED__=true;open.click();
  }else globalThis.__AGPA_STARTUP_APPLIED__=true;
  return true;
 }
 function reportView(force=false){
  if(destroyed||!startup())return;
  const view=globalThis.__AGGeminiSwitch?.status().visible?'gemini':'antigravity';
  if(!force&&view===lastView)return;
  lastView=view;
  try{globalThis.__agpaAppSettings(JSON.stringify({requestId:crypto.randomUUID(),action:'viewChanged',value:view}));}catch{}
 }
 const schedule=()=>{if(destroyed||scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;if(destroyed)return;apply();reportView();});};
 const focus=()=>reportView(true);
 const observer=new MutationObserver(schedule);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 window.addEventListener('focus',focus);
 const untranslate=i18n.subscribe(paint);
 globalThis.__AGAppSettings={
  version:VERSION,
  setState(next){state=next;paint();schedule();},
  setPatchStatus(next){patch=next;paint();},
  reapply(){if(!styles.isConnected)document.head.append(styles);apply();},
  onSaved(id,ok,message,next,nextPatch){const p=pending.get(id);if(!p)return;clearTimeout(p.timer);pending.delete(id);if(ok){if(next)this.setState(next);if(nextPatch)this.setPatchStatus(nextPatch);p.resolve(nextPatch);}else p.reject(Error(message||'Could not apply the preference.'));},
  status(){return {version:VERSION,taskbarIcon:state.taskbarIcon,startupView:state.startupView,toggleShortcut:state.toggleShortcut,shortcutControlInstalled:!!shortcutSection?.isConnected,effectiveIcon:state.effectiveIcon,currentView:state.currentView,trayAvailable:state.trayAvailable,autostart:!!state.autostart,controlInstalled:!!section?.isConnected,startupControlInstalled:!!startupSection?.isConnected,language:i18n.language,patchState:patch.state,lastView:state.lastView,busy};},
  destroy(){destroyed=true;untranslate();observer.disconnect();window.removeEventListener('focus',focus);for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Application appearance service stopped.'));}pending.clear();section?.remove();startupSection?.remove();patchSection?.remove();shortcutSection?.remove();styles.remove();delete globalThis.__AGAppSettings;}
 };
 schedule();
})();
