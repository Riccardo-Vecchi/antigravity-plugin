/* Local application appearance and startup preferences in native Settings. */
(() => {
 'use strict';
 const VERSION='1.5.0';
 const initial=globalThis.__AGPA_APP_SETTINGS__||{version:2,taskbarIcon:'antigravity',startupView:'antigravity'};
 const icons=globalThis.__AGPA_APP_ICON_ASSETS__;
 delete globalThis.__AGPA_APP_SETTINGS__;delete globalThis.__AGPA_APP_ICON_ASSETS__;
 if(globalThis.__AGAppSettings?.version===VERSION){globalThis.__AGAppSettings.setState(initial);return;}
 globalThis.__AGAppSettings?.destroy();
 let state=initial,section=null,scheduled=false,destroyed=false,busy=false,lastView=null;
 const pending=new Map();
 function node(tag,attrs={},...children){const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs))if(k==='text')n.textContent=v;else n.setAttribute(k,v);for(const c of children)if(c)n.append(c);return n;}
 const styles=node('style',{id:'agpa-app-settings-styles',text:`
  .agpa-app-icon-section {display:flex;flex-direction:column;gap:12px;padding:15px;border:1px solid var(--border,#353535);border-radius:12px;color:var(--foreground,#eee)}
  .agpa-app-icon-section h3 {font-size:14px;font-weight:500;margin:0}
  .agpa-app-icon-description,.agpa-app-icon-status {font-size:12px;line-height:1.5;color:var(--muted-foreground,#aaa);margin:0}
  .agpa-app-icon-options {display:flex;gap:10px;flex-wrap:wrap}
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
  .agpa-startup-heading {padding-top:12px;margin-top:2px!important;border-top:1px solid var(--border,#353535)}
 `});document.head.append(styles);
 function paint(){
  if(!section)return;
  for(const b of section.querySelectorAll('[data-agpa-app-icon]')){b.setAttribute('aria-checked',String(b.getAttribute('data-agpa-app-icon')===state.taskbarIcon));b.disabled=busy;}
  for(const b of section.querySelectorAll('[data-agpa-startup-view]')){b.setAttribute('aria-checked',String(b.getAttribute('data-agpa-startup-view')===state.startupView));b.disabled=busy;}
  const autostart=section.querySelector('[data-agpa-autostart]');if(autostart){autostart.checked=!!state.autostart;autostart.disabled=busy;}
  const tray=section.querySelector('[data-agpa-tray-status]');
  if(tray)tray.textContent=state.trayAvailable?'The tray icon follows the same choice.':'Tray updates are available with supported GNOME/Zorin AppIndicator setups.';
 }
 async function choose(action,value){
  if(busy)return;busy=true;paint();
  const status=section.querySelector('[role=status]');status.textContent='Applying…';
  const requestId=crypto.randomUUID();
  try{
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Could not apply the preference. Check the local appearance service.'));},12000);pending.set(requestId,{resolve,reject,timer});try{globalThis.__agpaAppSettings(JSON.stringify({requestId,action,value}));}catch(e){clearTimeout(timer);pending.delete(requestId);reject(e);}});
   status.textContent=action==='setStartupView'?'Saved for the next window.':action==='setAutostart'?'Saved for your next desktop sign-in.':'Applied.';
  }catch(e){status.textContent=e.message;}finally{busy=false;paint();}
 }
 function radioGroup(attribute,choices,label,action){
  const group=node('div',{class:'agpa-app-icon-options',role:'radiogroup','aria-label':label});
  for(const choice of choices){
   const title=choice==='dynamic'?'Dynamic':choice==='antigravity'?'Antigravity':'Gemini';
   const image=choice==='dynamic'?node('span',{class:'agpa-dynamic-icons','aria-hidden':'true'},node('img',{src:icons.antigravity,alt:''}),node('img',{src:icons.gemini,alt:''})):node('img',{src:icons[choice],alt:'',width:'30',height:'30'});
   const b=node('button',{type:'button',class:'agpa-app-icon-option',role:'radio',[attribute]:choice,'aria-label':title},image,node('span',{text:title}));
   b.addEventListener('click',()=>choose(action,choice));
   b.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const step=['ArrowLeft','ArrowUp'].includes(e.key)?-1:1;const next=choices[(choices.indexOf(choice)+step+choices.length)%choices.length];const other=group.querySelector(`[${attribute}="${next}"]`);other.focus();other.click();}});
   group.append(b);
  }
  return group;
 }
 function apply(){
  if(destroyed)return;
  const heading=[...document.querySelectorAll('[role=dialog][aria-label=Settings] h2')].find(n=>n.textContent==='Appearance');
  const container=heading?.closest('div.p-6');if(!container)return;
  if(!section){
   section=node('section',{class:'agpa-app-icon-section','data-agpa-app-icon-setting':'','aria-labelledby':'agpa-app-icon-title'},
    node('h3',{id:'agpa-app-icon-title',text:'Application icon'}),
    node('p',{class:'agpa-app-icon-description',text:'Choose a fixed icon, or let Dynamic follow the view you are using.'}),
    radioGroup('data-agpa-app-icon',['antigravity','gemini','dynamic'],'Application icon','setTaskbarIcon'),
    node('p',{class:'agpa-app-icon-description','data-agpa-tray-status':''}),
    node('h3',{class:'agpa-startup-heading',text:'Start in'}),
    node('p',{class:'agpa-app-icon-description',text:'Choose the view opened when a new Antigravity window starts.'}),
    radioGroup('data-agpa-startup-view',['antigravity','gemini'],'Startup view','setStartupView'),
    node('label',{class:'agpa-autostart-row'},node('input',{type:'checkbox','data-agpa-autostart':'','aria-label':'Launch at desktop sign-in'}),node('span',{text:'Launch at desktop sign-in'})),
    node('p',{class:'agpa-app-icon-description',text:'Start the app automatically when you sign in to Linux.'}),
    node('p',{class:'agpa-app-icon-status',role:'status','aria-live':'polite'}));
   section.querySelector('[data-agpa-autostart]').addEventListener('change',e=>choose('setAutostart',e.target.checked));paint();
  }
  if(section.parentElement!==container)container.children[0]?.after(section);
 }
 function startup(){
  if(globalThis.__AGPA_STARTUP_APPLIED__)return true;
  const api=globalThis.__AGGeminiSwitch;if(!api)return false;
  if(api.status().guestCreated){globalThis.__AGPA_STARTUP_APPLIED__=true;return true;}
  if(state.startupView==='gemini'){
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
 globalThis.__AGAppSettings={
  version:VERSION,
  setState(next){state=next;paint();schedule();},
  onSaved(id,ok,message,next){const p=pending.get(id);if(!p)return;clearTimeout(p.timer);pending.delete(id);if(ok){this.setState(next);p.resolve();}else p.reject(Error(message||'Could not apply the preference.'));},
  status(){return {version:VERSION,taskbarIcon:state.taskbarIcon,startupView:state.startupView,effectiveIcon:state.effectiveIcon,currentView:state.currentView,trayAvailable:state.trayAvailable,autostart:!!state.autostart,controlInstalled:!!section?.isConnected,busy};},
  destroy(){destroyed=true;observer.disconnect();window.removeEventListener('focus',focus);for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Application appearance service stopped.'));}pending.clear();section?.remove();styles.remove();delete globalThis.__AGAppSettings;}
 };
 schedule();
})();
