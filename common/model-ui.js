/* Decorate native model/permission controls; never change their selection or policy. */
(()=>{
 'use strict';const VERSION='1.1.6';
 globalThis.__AGContextBudget?.destroy();
 document.querySelectorAll('[data-agpa-context-budget],[data-agpa-context-ui],#agpa-context-budget-styles').forEach(e=>e.remove());
 delete globalThis.__AGPA_CONTEXT_BUDGET__;
 if(globalThis.__AGModelUI?.version===VERSION)return;
 globalThis.__AGModelUI?.destroy();
 const i=globalThis.__AGPAI18n,providerFor=globalThis.__AGPAProviderFor,permissionFor=globalThis.__AGPAPermissionFor,assets=globalThis.__AGPA_LAB_ICONS__;
 let preferences=globalThis.__AGPA_MODEL_PREFERENCES__||{version:1,models:{}};
 for(const key of ['__AGPAProviderFor','__AGPAPermissionFor','__AGPA_LAB_ICONS__','__AGPA_MODEL_PREFERENCES__'])delete globalThis[key];
 const pending=new Map(),originalOrders=new WeakMap();let stopped=false,scheduled=0,showHidden=false,known=[],dialog=null,saving=false,error='';
 function node(tag,attrs={},...children){const e=document.createElement(tag);e.dataset.agpaModelUi='';for(const[k,v]of Object.entries(attrs))if(k==='text')i.set(e,v);else e.setAttribute(k,v);for(const child of children)e.append(child);return e;}
 function setAttr(e,k,v){if(e.getAttribute(k)!==v)e.setAttribute(k,v);}
 function mark(e,name){const provider=providerFor(name);let image=e.querySelector(':scope > [data-agpa-lab]');if(!provider){image?.remove();return;}if(image?.dataset.agpaLab===provider)return;image?.remove();image=node('img',{src:assets[provider],alt:'',width:'16',height:'16','aria-hidden':'true',class:'agpa-lab-icon'});image.dataset.agpaLab=provider;e.prepend(image);}
 const choice=name=>preferences.models[name]||{favorite:false,hidden:false};
 async function save(name,field,value){
  if(saving)return false;saving=true;error='';schedule();paintDialog();
  const requestId=crypto.randomUUID();
  try{preferences=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('timeout'));},12000);pending.set(requestId,{resolve,reject,timer});globalThis.__agpaModelPreferences(JSON.stringify({requestId,name,field,value}));});}
  catch{error='Could not save model preferences. Try again.';}
  finally{saving=false;schedule();paintDialog();}
  return !error;
 }
 function entries(panel){return [...panel.querySelectorAll('[data-testid=model-selector-item],[data-testid=model-selector-effort-group]')].map(e=>({row:e.closest('[role=menuitem]'),name:e.dataset.modelLabel||e.dataset.modelBase})).filter(e=>e.row&&e.name);}
 function permissionColors(){
  for(const e of document.querySelectorAll('[data-testid^="permissions-preset-option-"]')){const id=e.dataset.testid.slice('permissions-preset-option-'.length),mode=id==='request_review'?'review':['default','auto','turbo'].includes(id)?id:null;if(mode)setAttr(e,'data-agpa-permission',mode);}
  for(const e of document.querySelectorAll('[data-testid=permissions-selector-trigger]')){const mode=permissionFor(e.textContent);if(mode)setAttr(e,'data-agpa-permission',mode);else e.removeAttribute('data-agpa-permission');}
 }
 let usageOpening=false,usageButton=null,usageTimer=null,usageCloseTimer=null;
 function usageRow(panel){return [...panel.querySelectorAll('[role=menuitem][aria-haspopup=menu]')].find(e=>e.querySelector('path[d^="M479.04-325.92"]')||e.textContent.trim()==='View Usage');}
 function closeUsage(){clearTimeout(usageCloseTimer);usageCloseTimer=null;document.body.removeAttribute('data-agpa-usage-open');usageButton?.setAttribute('aria-expanded','false');}
 function nativeModelClick(event){if(!document.body.hasAttribute('data-agpa-usage-open')&&event.target.closest?.('[data-testid=model-selector-trigger]'))for(const root of document.querySelectorAll('[data-agpa-usage-only]'))root.removeAttribute('data-agpa-usage-only');}
 function usagePointer(event){
  if(!document.body.hasAttribute('data-agpa-usage-open'))return;
  const target=event.type==='pointerout'?event.relatedTarget:event.target;
  if(target instanceof Node&&(usageButton?.contains(target)||document.querySelector('[data-agpa-usage-menu]')?.contains(target))){clearTimeout(usageCloseTimer);usageCloseTimer=null;return;}
  if(usageCloseTimer!==null)return;
  usageCloseTimer=setTimeout(()=>{usageCloseTimer=null;if(stopped||!document.body.hasAttribute('data-agpa-usage-open'))return;clearTimeout(usageTimer);usageOpening=false;if(document.querySelector('[data-testid=model-selector-trigger]')?.getAttribute('aria-expanded')==='true')document.querySelector('[data-testid=model-selector-trigger]').click();closeUsage();},350);
 }
 function openUsage(button){
    clearTimeout(usageCloseTimer);usageCloseTimer=null;
    if(usageOpening||document.body.hasAttribute('data-agpa-usage-open'))return;
    const trigger=document.querySelector('[data-testid=model-selector-trigger]');if(!trigger)return;
    usageOpening=true;usageButton=button;button.setAttribute('aria-expanded','true');document.body.setAttribute('data-agpa-usage-open','');
    const rect=button.getBoundingClientRect();document.body.style.setProperty('--agpa-usage-left',Math.min(rect.right+8,Math.max(8,innerWidth-336))+'px');document.body.style.setProperty('--agpa-usage-bottom',Math.max(8,innerHeight-rect.bottom)+'px');
    if(trigger.getAttribute('aria-expanded')!=='true')trigger.click();
    let attempts=0;
    const open=()=>{if(stopped)return;const panel=document.querySelector('[data-testid=model-selector-panel]'),row=panel&&usageRow(panel);if(row){row.click();usageOpening=false;schedule();}else if(++attempts<15)usageTimer=setTimeout(open,30);else{usageOpening=false;closeUsage();}};open();
 }
 function decorateUsage(){
  const settings=document.querySelector('[data-testid=settings-button]');
  if(settings&&!settings.parentElement.querySelector('[data-agpa-view-usage]')){
   const button=node('button',{type:'button',class:settings.className,'data-agpa-view-usage':'','aria-haspopup':'menu','aria-expanded':'false',title:'View Usage'});
   button.innerHTML='<span class="shrink-0 flex items-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 19a10 10 0 1 1 16 0H4Z"/><path d="m12 14 5-6"/><circle cx="12" cy="14" r="1"/></svg></span>';
   button.append(node('span',{class:'truncate text-sm',text:'View Usage'}));
   button.onclick=()=>{if(document.body.hasAttribute('data-agpa-usage-open')){document.querySelector('[data-testid=model-selector-trigger]')?.click();closeUsage();}else openUsage(button);};
   button.addEventListener('pointerenter',()=>openUsage(button));
   settings.before(button);
  }
  for(const panel of document.querySelectorAll('[data-testid=model-selector-panel]')){
   const row=usageRow(panel);if(!row)continue;setAttr(row,'data-agpa-native-usage','');
   const separator=row.parentElement.previousElementSibling;if(separator?.getAttribute('role')==='separator')setAttr(separator,'data-agpa-usage-separator','');
   const root=panel.closest('[role=menu]');if(root){setAttr(root,'data-agpa-usage-root','');if(document.body.hasAttribute('data-agpa-usage-open'))setAttr(root,'data-agpa-usage-only','');setAttr(root.parentElement,'data-agpa-usage-anchor','');}
   const submenu=row.parentElement.querySelector('[role=menu][data-nested]');if(submenu){setAttr(submenu,'data-agpa-usage-menu','');setAttr(submenu.parentElement,'data-agpa-usage-positioner','');}
  }
  if(!usageOpening&&!document.querySelector('[data-testid=model-selector-panel]'))closeUsage();
 }
 function apply(){
  scheduled=0;if(stopped)return;
  permissionColors();decorateUsage();
  for(const trigger of document.querySelectorAll('[data-testid=model-selector-trigger]'))mark(trigger,trigger.querySelector('span:not([data-agpa-model-ui])')?.textContent||'');
  for(const panel of document.querySelectorAll('[data-testid=model-selector-panel]')){
   const models=entries(panel);if(!models.length)continue;known=models.map(({name})=>name);
   const header=panel.querySelector('[data-testid=model-selector-header]');
   if(header&&!header.querySelector('[data-agpa-model-manage]')){
    const manage=node('button',{type:'button','data-agpa-model-manage':'',class:'agpa-model-manage',text:'Manage models'});
    manage.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();document.querySelector('[data-testid=model-selector-trigger][aria-expanded=true]')?.click();openDialog();});header.append(manage);
   }
   for(const {row,name}of models){
    mark(row,name);const c=choice(name);setAttr(row,'data-agpa-model-key',name);setAttr(row,'data-agpa-model-hidden',String(c.hidden&&!showHidden));
    if(!originalOrders.has(row))originalOrders.set(row,row.style.order);const order=c.favorite?'-1':originalOrders.get(row);if(row.style.order!==order)row.style.order=order;
    let star=row.querySelector(':scope > [data-agpa-model-favorite]');
    if(!star){star=node('button',{type:'button',tabindex:'-1','data-agpa-model-favorite':'',class:'agpa-model-star'});star.addEventListener('pointerdown',e=>e.stopPropagation());star.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();save(name,'favorite',!choice(name).favorite);});row.append(star);}
    const symbol=c.favorite?'★':'☆';if(star.textContent!==symbol)star.textContent=symbol;
    star.disabled=saving;i.set(star,c.favorite?'Unpin model':'Pin model',{},'title');i.set(star,c.favorite?'Unpin model':'Pin model',{},'aria-label');setAttr(star,'aria-pressed',String(c.favorite));
   }
   let footer=panel.querySelector('[data-agpa-model-footer]');
   const count=models.filter(({name})=>choice(name).hidden).length;
   if(!footer){footer=node('button',{type:'button','data-agpa-model-footer':'',class:'agpa-model-show'});footer.onclick=e=>{e.preventDefault();e.stopPropagation();showHidden=!showHidden;schedule();};panel.append(footer);}
   footer.hidden=!count;i.set(footer,showHidden?'Hide hidden models':'Show hidden models ({count})',{count});
   if(error){let status=panel.querySelector('[data-agpa-model-error]');if(!status){status=node('p',{'data-agpa-model-error':'',role:'status',class:'agpa-model-error'});panel.append(status);}i.set(status,error);}else panel.querySelector('[data-agpa-model-error]')?.remove();
   const focused=document.activeElement?.closest('[data-agpa-model-hidden=true]');if(focused&&panel.contains(focused))models.find(e=>e.row.getAttribute('data-agpa-model-hidden')!=='true')?.row.focus();
  }
 }
 function schedule(){if(!scheduled&&!stopped){scheduled=1;queueMicrotask(apply);}}
 function openDialog(){
  if(!dialog){
   const close=node('button',{type:'button',text:'Done'});close.onclick=()=>dialog.close();
   dialog=node('dialog',{class:'agpa-model-dialog','aria-labelledby':'agpa-model-title'},node('h3',{id:'agpa-model-title',text:'Manage models'}),node('p',{text:'Pin favorites to the top. Hidden models stay available through Show hidden models. Your selected model is unchanged.'}),node('div',{'data-agpa-model-list':''}),node('p',{'data-agpa-model-status':'',role:'status'}),close);
   dialog.addEventListener('close',()=>document.querySelector('[data-testid=model-selector-trigger]')?.focus());document.body.append(dialog);
  }
  paintDialog();dialog.showModal();
 }
 function paintDialog(){
  if(!dialog)return;const container=dialog.querySelector('[data-agpa-model-list]');
  if(container.dataset.models!==JSON.stringify(known)){
   container.dataset.models=JSON.stringify(known);container.replaceChildren();
   for(const name of known){const row=node('div',{class:'agpa-model-setting'}),label=node('span');label.textContent=name;mark(label,name);row.append(label);
    for(const [field,title]of [['favorite','Favorite'],['hidden','Hidden']]){const input=node('input',{type:'checkbox','data-model-name':name,'data-field':field});input.onchange=()=>save(name,field,input.checked);row.append(node('label',{},input,node('span',{text:title})));}container.append(row);
   }
  }
  for(const input of container.querySelectorAll('input')){input.checked=choice(input.dataset.modelName)[input.dataset.field];input.disabled=saving;}
  i.set(dialog.querySelector('[data-agpa-model-status]'),error||'');
 }
 let search='',lastSearch=0;
 function keyboard(event){
  if(event.target.closest?.('[data-agpa-effort-ui]'))return;
  if(dialog?.open&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();dialog.close();return;}
  if(event.ctrlKey||event.altKey||event.metaKey)return;
  if(['Enter',' '].includes(event.key)&&event.target.matches?.('[data-agpa-model-manage],[data-agpa-model-footer]')){event.preventDefault();event.stopImmediatePropagation();event.target.click();return;}
  const panel=event.target.closest?.('[data-testid=model-selector-panel]')||(event.target.closest?.('[data-testid=model-selector-trigger][aria-expanded=true]')&&document.querySelector('[data-testid=model-selector-panel]'));
  if(!panel||event.target.closest('[data-agpa-model-favorite]'))return;
  const models=entries(panel).filter(({row})=>row.getAttribute('data-agpa-model-hidden')!=='true'&&row.getAttribute('aria-disabled')!=='true').sort((a,b)=>Number(choice(b.name).favorite)-Number(choice(a.name).favorite));
  const extras=[...panel.querySelectorAll('[role=menuitem]')].filter(row=>!row.hasAttribute('data-agpa-model-key'));
  const actions=[panel.querySelector('[data-agpa-model-manage]'),...models.map(m=>m.row),panel.querySelector('[data-agpa-model-footer]'),...extras].filter(e=>e?.getClientRects().length&&!e.hidden);
  const target=event.target.closest('[role=menuitem],[data-agpa-model-manage],[data-agpa-model-footer]'),index=actions.indexOf(target);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&actions.length){
   event.preventDefault();event.stopImmediatePropagation();const next=event.key==='Home'||(index<0&&event.key==='ArrowDown')?0:event.key==='End'||index<0?actions.length-1:(index+(event.key==='ArrowDown'?1:-1)+actions.length)%actions.length;actions[next].focus();
  }else if(event.key.length===1&&/\S/.test(event.key)&&models.length){
   const now=Date.now(),key=event.key.toLowerCase();search=now-lastSearch>600||search===key?key:search+key;lastSearch=now;
   const from=Math.max(0,models.findIndex(m=>m.row===target)+1),ordered=[...models.slice(from),...models.slice(0,from)],match=ordered.find(m=>m.name.toLowerCase().startsWith(search));
   if(match){event.preventDefault();event.stopImmediatePropagation();match.row.focus();}
  }
 }
 const style=node('style',{text:`
 .agpa-lab-icon{width:16px;height:16px;object-fit:contain;flex-shrink:0;display:inline-block;vertical-align:middle}.agpa-model-setting>span{display:flex;align-items:center;gap:9px;flex:1;min-width:0}
 [data-agpa-model-hidden=true]{display:none!important}.agpa-model-star{margin-left:auto;flex-shrink:0;width:24px;height:24px;border:0;background:none;color:var(--muted-foreground,#aaa);cursor:pointer;font-size:17px;opacity:0}.agpa-model-star[aria-pressed=true]{color:#e6b94b;opacity:1}[role=menuitem]:hover>.agpa-model-star,[role=menuitem]:focus>.agpa-model-star,.agpa-model-star:focus-visible{opacity:1}
 [data-testid=model-selector-header]{display:flex;align-items:center;justify-content:space-between;gap:18px}.agpa-model-manage,.agpa-model-show{font:inherit;border:0;background:transparent;color:var(--muted-foreground,#aaa);cursor:pointer;font-size:12px}.agpa-model-show{padding:8px;text-align:left}.agpa-model-show[hidden]{display:none}
 .agpa-model-dialog{width:min(640px,calc(100vw - 40px));max-height:calc(100vh - 50px);overflow:auto;border:1px solid var(--border,#444);border-radius:14px;padding:24px;background:var(--background,#171717);color:var(--foreground,#eee);font:13px/1.6 system-ui,sans-serif}.agpa-model-dialog::backdrop{background:#0009}.agpa-model-dialog h3{margin:0;font-size:18px}.agpa-model-dialog p{color:var(--muted-foreground,#aaa)}.agpa-model-dialog>button{float:right;padding:7px 16px;border-radius:7px;border:1px solid var(--border,#444);background:transparent;color:inherit;cursor:pointer}.agpa-model-setting{display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--border,#333)}.agpa-model-setting label{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer}.agpa-model-error{font-size:12px;color:#ff8888}.agpa-model-dialog input{accent-color:#398bdb}
 [data-agpa-permission=review]{--agpa-permission:#70aaff}[data-agpa-permission=default]{--agpa-permission:#55bd8a}[data-agpa-permission=auto]{--agpa-permission:#d6a246}[data-agpa-permission=turbo]{--agpa-permission:#ee6f78}
 [data-testid=permissions-selector-trigger][data-agpa-permission]{color:color-mix(in srgb,var(--foreground,#eee) 18%,var(--agpa-permission))!important;background:color-mix(in srgb,var(--agpa-permission) 12%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--agpa-permission) 23%,transparent)}
 [data-testid^=permissions-preset-option-][data-agpa-permission]>[data-icon],[data-testid^=permissions-preset-option-][data-agpa-permission]>span.flex.min-w-0>span:first-child{color:color-mix(in srgb,var(--foreground,#eee) 18%,var(--agpa-permission))!important}
 body:not([data-agpa-usage-open]) [data-agpa-native-usage],body:not([data-agpa-usage-open]) [data-agpa-usage-separator]{display:none!important}
 body[data-agpa-usage-open] [data-agpa-usage-anchor]{position:fixed!important;left:0!important;top:0!important;transform:none!important}
 /* A transformed native menu makes its fixed submenu relative to that menu
    until the enter transition ends. Keep Usage in the viewport from first paint. */
 [data-agpa-usage-only],[data-agpa-usage-only] [role=menu][data-nested]{transform:none!important;translate:none!important;scale:none!important;rotate:none!important;animation:none!important;transition:none!important;will-change:auto!important}
 [data-agpa-usage-only]{visibility:hidden!important;pointer-events:none!important}
 body[data-agpa-usage-open] [data-agpa-usage-menu]{visibility:visible!important;pointer-events:auto!important}
 body[data-agpa-usage-open] [data-agpa-usage-positioner]{position:fixed!important;left:var(--agpa-usage-left)!important;bottom:var(--agpa-usage-bottom)!important;top:auto!important;transform:none!important;max-height:calc(100vh - 16px)}
 @media(max-width:600px){.agpa-model-setting{flex-wrap:wrap}.agpa-model-setting>span{flex-basis:100%}}
 `});document.head.append(style);
 const watched='[data-testid=settings-button],[data-agpa-usage-root],[data-testid=model-selector-trigger],[data-testid=model-selector-panel],[data-testid^=permissions-]';
 const observer=new MutationObserver(records=>{
  if(records.some(r=>{const target=r.target.nodeType===1?r.target:r.target.parentElement;if(target?.closest('[data-agpa-model-ui]'))return false;const nodes=[...r.addedNodes,...r.removedNodes];if(nodes.length&&nodes.every(n=>n.nodeType===1&&n.hasAttribute('data-agpa-model-ui')))return false;return target?.closest(watched)||nodes.some(n=>n.nodeType===1&&(n.matches(watched)||n.querySelector(watched)));}))schedule();
 });observer.observe(document.body,{subtree:true,childList:true,characterData:true});
 document.addEventListener('click',nativeModelClick,true);document.addEventListener('pointerover',usagePointer,true);document.addEventListener('pointerout',usagePointer,true);
 window.addEventListener('keydown',keyboard,true);const unsubscribe=i.subscribe(()=>{schedule();paintDialog();});
 globalThis.__AGModelUI={version:VERSION,openUsage,setEffort:(name,value)=>save(name,'effort',value),setPreferences(next){preferences=next;schedule();paintDialog();},status:()=>({known:[...known],preferences,saving,error}),onResult(id,ok,next){const p=pending.get(id);if(!p)return;clearTimeout(p.timer);pending.delete(id);ok?p.resolve(next):p.reject(Error('save'));},destroy(){stopped=true;document.removeEventListener('click',nativeModelClick,true);document.removeEventListener('pointerover',usagePointer,true);document.removeEventListener('pointerout',usagePointer,true);clearTimeout(usageTimer);closeUsage();for(const e of document.querySelectorAll('[data-agpa-native-usage],[data-agpa-usage-separator],[data-agpa-usage-root],[data-agpa-usage-menu],[data-agpa-usage-positioner],[data-agpa-usage-anchor],[data-agpa-usage-only]'))for(const attr of ['data-agpa-native-usage','data-agpa-usage-separator','data-agpa-usage-root','data-agpa-usage-menu','data-agpa-usage-positioner','data-agpa-usage-anchor','data-agpa-usage-only'])e.removeAttribute(attr);document.body.style.removeProperty('--agpa-usage-left');document.body.style.removeProperty('--agpa-usage-bottom');observer.disconnect();unsubscribe();window.removeEventListener('keydown',keyboard,true);for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('closed'));}pending.clear();dialog?.close();dialog?.remove();style.remove();for(const e of document.querySelectorAll('[data-agpa-model-key]')){e.style.order=originalOrders.get(e)||'';e.removeAttribute('data-agpa-model-key');e.removeAttribute('data-agpa-model-hidden');}for(const e of document.querySelectorAll('[data-agpa-permission]'))e.removeAttribute('data-agpa-permission');for(const e of document.querySelectorAll('[data-agpa-model-ui]'))e.remove();delete globalThis.__AGModelUI;}};
 schedule();
})();
