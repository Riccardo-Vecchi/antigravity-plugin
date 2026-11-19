/* Decorate native model/permission controls; never change their selection or policy. */
(()=>{
 'use strict';const VERSION='1.6.0';
 if(globalThis.__AGModelUI?.version===VERSION)return;
 globalThis.__AGModelUI?.destroy();
 const i=globalThis.__AGPAI18n,providerFor=globalThis.__AGPAProviderFor,permissionFor=globalThis.__AGPAPermissionFor,assets=globalThis.__AGPA_LAB_ICONS__;
 let preferences=globalThis.__AGPA_MODEL_PREFERENCES__||{version:1,models:{}};
 for(const key of ['__AGPAProviderFor','__AGPAPermissionFor','__AGPA_LAB_ICONS__','__AGPA_MODEL_PREFERENCES__'])delete globalThis[key];
 const pending=new Map(),originalOrders=new WeakMap(),seenPanels=new WeakSet();let stopped=false,scheduled=0,showHidden=false,known=[],dialog=null,saving=false,error='';
 function node(tag,attrs={},...children){const e=document.createElement(tag);e.dataset.agpaModelUi='';for(const[k,v]of Object.entries(attrs))if(k==='text')i.set(e,v);else e.setAttribute(k,v);for(const child of children)e.append(child);return e;}
 function setAttr(e,k,v){if(e.getAttribute(k)!==v)e.setAttribute(k,v);}
 function mark(element, name) {
  const provider = providerFor(name);
  const key = /^\s*Orchestrator\b/i.test(name) && assets.orchestrator ? 'orchestrator' : provider;
  const icons = key === 'orchestrator' && assets.google ? ['google', key] : assets[key] ? [key] : [];
  const current = [...element.querySelectorAll(':scope > [data-agpa-lab]')];
  if (current.length === icons.length && current.every((img, n) => img.dataset.agpaIcon === icons[n])) return;
  for (const img of current) img.remove();
  element.prepend(...icons.map(icon => {
   const image = node('img', {src:assets[icon], alt:'', width:'16', height:'16',
    'aria-hidden':'true', class:'agpa-lab-icon'});
   image.dataset.agpaLab = provider;
   image.dataset.agpaIcon = icon;
   if (icon === 'google' && key === 'orchestrator') image.title = 'Google';
   return image;
  }));
 }
 // The element identifies a Gemini 4 variant. Its use case comes from the DeepMind model cards.
 const geminiVariants = new Map([
  ['hydrogen', ['H', 'Fast everyday tasks']],
  ['argon', ['Ar', 'Complex engineering workflows']],
  ['neon', ['Ne', 'Deep reasoning with fast turnaround']],
  ['carbon', ['C', 'Long, demanding projects']],
 ]);
 function decorateVariant(element,name) {
  const match = /^Gemini 4 (Hydrogen|Argon|Neon|Carbon)(?:$|\s*\()/i.exec(name);
  const variant = match && geminiVariants.get(match[1].toLowerCase());
  const previous = element.querySelector(':scope > [data-agpa-element]');
  if (!variant) { previous?.remove(); return; }
  const [symbol,description] = variant;
  if (previous?.dataset.agpaElement !== symbol) {
   previous?.remove();
   const badge = node('span',{'data-agpa-element':symbol,'aria-hidden':'true',class:'agpa-model-element'});
   i.set(badge,description,{},'title');
   element.querySelector(':scope > [data-agpa-icon="google"]')?.after(badge);
  }
  return description;
 }
 // Quota groups can combine providers; decorate labels without replacing native data.
 function decorateQuota(root){
  for(const heading of root.querySelectorAll('[role=presentation],strong,span.truncate')){
   if(heading.querySelector(':scope > :not([data-agpa-quota-logos])'))continue;
   const label=heading.textContent.trim();
   const labs=/\b(?:Claude|Anthropic)\b/i.test(label)?['anthropic']:[];
   if(/\b(?:GPT|OpenAI)\b/i.test(label))labs.push('openai');
   if(!labs.length&&/^Gemini\b/i.test(label))labs.push('google');
   if(!labs.length)continue;
   const signature=labs.join(' ');let icons=heading.querySelector(':scope > [data-agpa-quota-logos]');
   if(icons?.dataset.agpaQuotaLogos===signature)continue;
   icons?.remove();icons=node('span',{'data-agpa-quota-logos':signature,'aria-hidden':'true',class:'agpa-quota-logos'});
   for(const lab of labs)if(assets[lab])icons.append(node('img',{src:assets[lab],alt:'',width:'16',height:'16',class:'agpa-lab-icon'}));
   heading.prepend(icons);setAttr(heading,'data-agpa-quota-heading','');
  }
 }
 const choice=name=>preferences.models[name]||{favorite:false,hidden:false};
 function modelGroup(name) {
  return choice(name).hidden ? 2 : choice(name).favorite ? 0 : 1;
 }
 function orderedNames(names) {
  const ranks = new Map((preferences.order || []).map((name,index) => [name,index]));
  return [...new Set(names)].sort((a,b) => modelGroup(a) - modelGroup(b) ||
   (ranks.get(a) ?? ranks.size) - (ranks.get(b) ?? ranks.size));
 }
 function requestPreference(name,field,value) {
  const requestId=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('timeout'));},12000);
   pending.set(requestId,{resolve,reject,timer});
   globalThis.__agpaModelPreferences(JSON.stringify({requestId,name,field,value}));
  });
 }
 async function save(name,field,value){
  if(saving)return false;saving=true;error='';schedule();paintDialog();
  try{preferences=await requestPreference(name,field,value);}
  catch{error='Could not save model preferences. Try again.';}
  finally{saving=false;schedule();paintDialog();}
  return !error;
 }
 function entries(panel){return [...panel.querySelectorAll('[data-testid=model-selector-item],[data-testid=model-selector-effort-group]')].map(e=>({row:e.closest('[role=menuitem]'),name:e.dataset.modelLabel||e.dataset.modelBase})).filter(e=>e.row&&e.name);}
 // Keep the native information target. Only its short novelty label expires.
 const announcementsByPanel = new WeakMap();
 const newLabel = /^(?:new|nuov[oa]|nouveau|neu|nuev[oa]|新着|新規|全新|新增)$/iu;
 function updateAnnouncements(panel,models) {
  let opening = announcementsByPanel.get(panel);
  if (!opening) {
   opening = { baseline: !preferences.seenAnnouncements, seen: new Set(preferences.seenAnnouncements), requested: new Set() };
   announcementsByPanel.set(panel,opening);
  }
  const acknowledge = [];
  for (const {row,name} of models) {
   const badge = [...row.querySelectorAll('.rounded-full')].find(el=>newLabel.test(el.textContent.trim()));
   const label = badge?.querySelector(':scope > span') || badge;
   // React may reuse a badge for a different notice or model.
   for (const previous of row.querySelectorAll('[data-agpa-seen-new]')) {
    if (previous !== label) previous.removeAttribute('data-agpa-seen-new');
   }
   if (!label) continue;
   label.toggleAttribute('data-agpa-seen-new',opening.baseline || opening.seen.has(name));
   if (opening.seen.has(name) || opening.requested.has(name) || (!opening.baseline && choice(name).hidden && !showHidden)) continue;
   opening.requested.add(name);
   acknowledge.push(name);
  }
  if (acknowledge.length || (opening.baseline && !opening.initialized)) {
   opening.initialized = true;
   requestPreference(null,'seenAnnouncements',acknowledge).then(next=>{
    preferences.seenAnnouncements = next.seenAnnouncements;
   }).catch(()=>{}); // Retry at the next opening if the preference store was unavailable.
  }
 }
 function permissionColors(){
  for(const e of document.querySelectorAll('[data-testid^="permissions-preset-option-"]')){const id=e.dataset.testid.slice('permissions-preset-option-'.length),mode=id==='request_review'?'review':['default','auto','turbo'].includes(id)?id:null;if(mode)setAttr(e,'data-agpa-permission',mode);}
  for(const e of document.querySelectorAll('[data-testid=permissions-selector-trigger]')){const mode=permissionFor(e.textContent);if(mode)setAttr(e,'data-agpa-permission',mode);else e.removeAttribute('data-agpa-permission');}
 }
 let usageButton=null,usageCloseTimer=null;
 let quotaPopup=null,quotaCache=null,quotaPending=null,quotaServiceOwner=null,quotaEpoch=0;
 // The host has no public renderer API for quota. Keep the React lookup here,
 // bounded and optional, so sidebar failure never interferes with the native menu.
 function quotaService(){
  const anchor=document.querySelector('[data-testid=settings-button]');
  if(!anchor)return null;
  const key=Object.keys(anchor).find(k=>k.startsWith('__reactFiber$'));
  const serviceFor=value=>{
   const service=value?.core?.cloudCodeService;
   return typeof service?.retrieveUserQuotaSummary==='function'?service:null;
  };
  for(let fiber=anchor[key],depth=0;fiber&&depth<180;fiber=fiber.return,depth++){
   const service=serviceFor(fiber.memoizedProps?.value);
   if(service)return service;
   let dependency=fiber.dependencies?.firstContext;
   for(let n=0;dependency&&n<32;n++,dependency=dependency.next){
    const service=serviceFor(dependency.memoizedValue);
    if(service)return service;
   }
  }
  return null;
 }
 function quotaReset(bucket){
  const value=bucket.resetTime;let milliseconds;
  if(value&&typeof value==='object'&&value.seconds!==undefined)milliseconds=Number(value.seconds)*1000+Number(value.nanos||0)/1e6;
  else if(typeof value==='string')milliseconds=Date.parse(value);
  if(!Number.isFinite(milliseconds))return bucket.description||'';
  const minutes=Math.max(1,Math.ceil((milliseconds-Date.now())/60000));
  return i.t('Resets in {time}',{time:minutes>=1440?`${Math.floor(minutes/1440)}d ${Math.floor(minutes%1440/60)}h`:minutes>=60?`${Math.floor(minutes/60)}h ${minutes%60}m`:`${minutes}m`});
 }
 function paintQuota(groups,loading=false,failed=false){
  if(!quotaPopup)return;
  quotaPopup.replaceChildren();
  const refresh=node('button',{type:'button',text:'↻','aria-label':'Refresh usage',class:'agpa-quota-refresh'});
  refresh.disabled=loading;refresh.onclick=()=>loadQuota(true);
  quotaPopup.append(node('header',{},node('span',{text:'Usage'}),refresh));
  if(!groups?.length){quotaPopup.append(node('p',{role:'status',text:loading?'Refreshing…':failed?'Could not load usage. Try Refresh.':'No quota information available.'}));positionUsage();return;}
  for(const group of groups){
   if(!Array.isArray(group.buckets)||!group.buckets.length)continue;
   const section=node('section',{});
   if(group.displayName)section.append(node('strong',{text:group.displayName}));
   for(const bucket of group.buckets){
    const row=node('div',{class:'agpa-quota-row'});
    const label=bucket.window==='weekly'?'Weekly limit':bucket.window==='daily'?'Daily limit':/^\d+[smhd]$/.test(bucket.window||'')?`${bucket.window} limit`:bucket.displayName||bucket.bucketId;
    const remaining=bucket.remaining?.case==='remainingFraction'?bucket.remaining.value:undefined;
    const known=typeof remaining==='number'&&Number.isFinite(remaining);
    const percent=known?Math.round(Math.max(0,Math.min(1,remaining))*100):null;
    const value=node('span',{class:'agpa-quota-value',text:known?i.t('{percent}% left',{percent}):'—'});
    if(known){const ring=node('span',{'aria-hidden':'true',class:'agpa-quota-ring'});ring.style.setProperty('--quota-left',`${percent}%`);ring.style.setProperty('--quota-color',percent<10?'#ed6a68':percent<30?'#d8a548':'#66a34f');value.append(ring);}
    row.append(node('span',{text:label}),value);
    const reset=quotaReset(bucket);if(reset)row.append(node('small',{text:reset}));
    if(bucket.disabled)row.setAttribute('aria-disabled','true');section.append(row);
   }
   quotaPopup.append(section);
  }
  decorateQuota(quotaPopup);
  if(failed)quotaPopup.append(node('p',{role:'status',text:'Could not load usage. Try Refresh.'}));
  positionUsage();
 }
 async function loadQuota(force=false){
  const epoch=quotaEpoch;
  let service;
  try{service=quotaService();}catch{paintQuota(null,false,true);return;}
  if(service!==quotaServiceOwner){quotaCache=null;quotaServiceOwner=service;quotaPending=null;}
  if(!service){paintQuota(null,false,true);return;}
  if(!force&&quotaCache&&Date.now()-quotaCache.time<5000){paintQuota(quotaCache.groups);return;}
  paintQuota(quotaCache?.groups,true);
  quotaPending ||= Promise.resolve().then(()=>service.retrieveUserQuotaSummary(undefined,true)).then(result=>{
   const groups=result?.response?.groups;if(!Array.isArray(groups))throw Error('unavailable');
   if(quotaServiceOwner===service)quotaCache={groups,time:Date.now()};return groups;
  }).finally(()=>{if(quotaServiceOwner===service)quotaPending=null;});
  try{const groups=await quotaPending;if(!stopped&&quotaPopup&&epoch===quotaEpoch)paintQuota(groups);}
  catch{if(!stopped&&quotaPopup&&epoch===quotaEpoch)paintQuota(quotaCache?.groups,false,true);}
 }
 function positionUsage(){
  if(!quotaPopup||!usageButton?.isConnected)return;
  const rect=usageButton.getBoundingClientRect();
  const width=quotaPopup.offsetWidth;
  const beside=rect.right+8;
  const left=beside+width+8<=innerWidth?beside:Math.max(8,Math.min(rect.left,innerWidth-width-8));
  quotaPopup.style.left=left+'px';
  quotaPopup.style.bottom=Math.max(8,Math.min(innerHeight-rect.bottom,innerHeight-quotaPopup.offsetHeight-8))+'px';
 }
 function closeUsage(){
  quotaEpoch++;quotaPopup?.remove();quotaPopup=null;
  clearTimeout(usageCloseTimer);usageCloseTimer=null;
  usageButton?.setAttribute('aria-expanded','false');usageButton=null;
 }
 function keepUsageOpen(){clearTimeout(usageCloseTimer);usageCloseTimer=null;}
 function leaveUsage(event){
  const target=event.relatedTarget;
  if(target instanceof Node&&(usageButton?.contains(target)||quotaPopup?.contains(target)))return;
  keepUsageOpen();usageCloseTimer=setTimeout(closeUsage,350);
 }
 function usageOutside(event){
  if(quotaPopup&&!quotaPopup.contains(event.target)&&!usageButton?.contains(event.target))closeUsage();
 }
 function openUsage(button,focus=false){
  keepUsageOpen();
  if(quotaPopup&&usageButton===button){if(focus)quotaPopup.focus();return;}
  if(quotaPopup)closeUsage();
  quotaEpoch++;usageButton=button;button.setAttribute('aria-expanded','true');
  quotaPopup=node('div',{class:'agpa-standalone-usage','data-agpa-usage-menu':'',role:'dialog','aria-label':i.t('Usage'),tabindex:'-1'});
  quotaPopup.addEventListener('pointerenter',keepUsageOpen);
  quotaPopup.addEventListener('pointerleave',leaveUsage);
  quotaPopup.addEventListener('focusout',leaveUsage);
  document.body.append(quotaPopup);
  loadQuota();positionUsage();
  if(focus)quotaPopup.focus();
 }
 function decorateUsage(){
  if(usageButton&&(!usageButton.isConnected||!usageButton.getClientRects().length))closeUsage();
  const settings=document.querySelector('[data-testid=settings-button]');
  if(settings){
   const label=settings.lastElementChild;
   let button=settings.parentElement.querySelector(':scope > [data-agpa-view-usage]');
   if(!button){
   button=node('button',{type:'button',class:settings.className,'data-agpa-view-usage':'','aria-haspopup':'dialog','aria-expanded':'false',title:i.t('View Usage')});
   button.innerHTML='<span class="shrink-0 flex items-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 19a10 10 0 1 1 16 0H4Z"/><path d="m12 14 5-6"/><circle cx="12" cy="14" r="1"/></svg></span>';
   button.append(node('span',{class:label?.tagName==='SPAN'?label.className:'truncate',text:'View Usage'}));
   button.onclick=event=>openUsage(button,event.detail===0);
   button.addEventListener('pointerenter',()=>openUsage(button));
   button.addEventListener('pointerleave',leaveUsage);
   settings.before(button);
   }
   if(button.className!==settings.className)button.className=settings.className;
   const labelClass=label?.tagName==='SPAN'?label.className:'truncate';
   if(button.lastElementChild.className!==labelClass)button.lastElementChild.className=labelClass;
  }
  for (const row of document.querySelectorAll('[data-testid=model-selector-panel] [role=menuitem][aria-haspopup=menu]')) {
   const quota = !!row.querySelector('path[d^="M479.04-325.92"]') || row.textContent.trim() === i.t('View Usage');
   row.toggleAttribute('data-agpa-picker-quota', quota);
  }
 }
 const automationPickers = '[data-testid=new-sidecar-model], [data-testid=sidecar-model-option]';
 function decorateAutomationModels() {
  for (const control of document.querySelectorAll(automationPickers)) {
   // Read the native label only. The other child is the chevron or checkmark.
   const label = control.querySelector(':scope > :not([data-agpa-model-ui]):not(svg)');
   mark(control, label?.textContent || control.textContent);
  }
 }
 function apply(){
  scheduled=0;if(stopped)return;
  permissionColors();decorateUsage();decorateAutomationModels();
  for (const trigger of document.querySelectorAll('[data-testid=model-selector-trigger]')) {
   const label = trigger.querySelector(':scope > span:not([data-agpa-model-ui])');
   // The native label contains the model as text and the current effort in a child span.
   if (!label) continue;
   const name = [...label.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim() || label.textContent.trim();
   mark(trigger,name);
   decorateVariant(trigger,name);
  }
  for(const panel of document.querySelectorAll('[data-testid=model-selector-panel]')){
   const models=entries(panel);if(!models.length)continue;known=models.map(({name})=>name);
   const displayOrder = orderedNames(known);
   if(!seenPanels.has(panel)){seenPanels.add(panel);showHidden=false;}
   updateAnnouncements(panel,models);
   const header=panel.querySelector('[data-testid=model-selector-header]');
   if(header&&!header.querySelector('[data-agpa-model-manage]')){
    const manage=node('button',{type:'button','data-agpa-model-manage':'',class:'agpa-model-manage',text:'Manage models'});
    manage.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();document.querySelector('[data-testid=model-selector-trigger][aria-expanded=true]')?.click();openDialog();});header.append(manage);
   }
   for(const {row,name}of models){
    mark(row,name);decorateVariant(row,name);const c=choice(name);setAttr(row,'data-agpa-model-key',name);setAttr(row,'data-agpa-model-other',String(c.hidden));setAttr(row,'data-agpa-model-hidden',String(c.hidden&&!showHidden));
    if(!originalOrders.has(row))originalOrders.set(row,row.style.order);
    const position = displayOrder.indexOf(name);
    const order = preferences.order?.length ? String(c.hidden ? position + 2 : position - displayOrder.length) : c.hidden?'2':c.favorite?'-1':originalOrders.get(row);if(row.style.order!==order)row.style.order=order;
    let star=row.querySelector(':scope > [data-agpa-model-favorite]');
    if(!star){star=node('button',{type:'button',tabindex:'-1','data-agpa-model-favorite':'',class:'agpa-model-star'});star.addEventListener('pointerdown',e=>e.stopPropagation());star.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();save(name,'favorite',!choice(name).favorite);});row.append(star);}
    let visibility=row.querySelector(':scope > [data-agpa-model-visibility]');
    if(!visibility){
     visibility=node('button',{type:'button',tabindex:'-1','data-agpa-model-visibility':'',class:'agpa-model-visibility'});
     visibility.addEventListener('pointerdown',e=>e.stopPropagation());
     visibility.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();save(name,'hidden',!choice(name).hidden);});row.append(visibility);
    }
    visibility.disabled=saving;
    const visibilityLabel=c.hidden?'Move {model} to main menu':'Move {model} to Other';
    i.set(visibility,visibilityLabel,{model:name},'aria-label');i.set(visibility,visibilityLabel,{model:name},'title');
    const visibilityIcon=c.hidden?'<path d="m9 6-4 4 4 4M5 10h9a5 5 0 0 1 0 10h-3"/>':'<path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c7 0 10 7 10 7a18 18 0 0 1-3 4M6.5 6.5A20 20 0 0 0 2 12s3 7 10 7a12 12 0 0 0 5.5-1.5"/>';
    if(visibility.dataset.other!==String(c.hidden)){visibility.dataset.other=String(c.hidden);visibility.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+visibilityIcon+'</svg>';}
    const symbol=c.favorite?'★':'☆';if(star.textContent!==symbol)star.textContent=symbol;
    star.disabled=saving;i.set(star,c.favorite?'Unpin model':'Pin model',{},'title');i.set(star,c.favorite?'Unpin model':'Pin model',{},'aria-label');setAttr(star,'aria-pressed',String(c.favorite));
   }
   let footer=panel.querySelector('[data-agpa-model-footer]');
   const count=models.filter(({name})=>choice(name).hidden).length;
   if(!footer){footer=node('button',{type:'button','data-agpa-model-footer':'',class:'agpa-model-show'});footer.onclick=e=>{e.preventDefault();e.stopPropagation();showHidden=!showHidden;schedule();};footer.style.order='1';models[0].row.parentElement.append(footer);}
   setAttr(footer.parentElement,'data-agpa-model-groups','');footer.hidden=!count;setAttr(footer,'aria-expanded',String(showHidden));i.set(footer,showHidden?'▾ Other ({count})':'▸ Other ({count})',{count});
   if(error){let status=panel.querySelector('[data-agpa-model-error]');if(!status){status=node('p',{'data-agpa-model-error':'',role:'status',class:'agpa-model-error'});panel.append(status);}i.set(status,error);}else panel.querySelector('[data-agpa-model-error]')?.remove();
   const focused=document.activeElement?.closest('[data-agpa-model-hidden=true]');if(focused&&panel.contains(focused))models.find(e=>e.row.getAttribute('data-agpa-model-hidden')!=='true')?.row.focus();
  }
 }
 function schedule(){if(!scheduled&&!stopped){scheduled=1;queueMicrotask(apply);}}
 function nameForShortcut(chord) {
  return Object.entries(preferences.models).find(([,model])=>model.shortcut===chord)?.[0];
 }
 let noticeTimer;
 function showUnavailable(name) {
  let notice=document.querySelector('[data-agpa-model-notice]');
  if(!notice){notice=node('div',{role:'status','data-agpa-model-notice':''});document.body.append(notice);}
  i.set(notice,'{model} is unavailable.',{model:name});
  clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.remove(),3500);
 }
 function shortcutSelect(name) {
  const select=node('select',{'data-agpa-model-shortcut':'','data-model-name':name});
  i.set(select,'Shortcut for {model}',{model:name},'aria-label');
  i.set(select,'Shortcut for {model}',{model:name},'title');
  select.append(node('option',{value:'',text:'Shortcut'}));
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
   const chord='Ctrl+Alt+'+letter;
   const option=node('option',{value:chord});
   option.textContent=chord;
   select.append(option);
  }
  select.onchange=()=>save(name,'shortcut',select.value || null);
  return select;
 }
 function openDialog(){
  if(!dialog){
   const close=node('button',{type:'button',text:'Done'});close.onclick=()=>dialog.close();
   dialog=node('dialog',{class:'agpa-model-dialog','aria-labelledby':'agpa-model-title'},node('h3',{id:'agpa-model-title',text:'Manage models'}),node('p',{text:'Use the arrows to reorder each group. Favorites appear first. Hidden models appear under Other.'}),node('div',{'data-agpa-model-list':''}),node('p',{'data-agpa-model-status':'',role:'status'}));
   const reset = node('button',{type:'button','data-agpa-reset-order':'',text:'Reset order'});
   reset.onclick = () => save(null, 'order', []);
   dialog.append(node('footer',{},reset,close));
   dialog.addEventListener('close',()=>document.querySelector('[data-testid=model-selector-trigger]')?.focus());document.body.append(dialog);
  }
  paintDialog();dialog.showModal();
 }
 function paintDialog(){
  if(!dialog)return;const container=dialog.querySelector('[data-agpa-model-list]');
  const names = orderedNames(known);
  // Keep bindings editable even when a model drops out of the account's catalog.
  const missing = Object.entries(preferences.models).filter(([name,model]) => model.shortcut && !names.includes(name));
  const signature = JSON.stringify([names.map(name => [name,modelGroup(name)]), missing.map(([name])=>name)]);

  if(container.dataset.models!==signature){
   const focused = document.activeElement;
   container.dataset.models=signature;container.replaceChildren();
   for(const [index,name] of names.entries()){
    const row = node('div',{class:'agpa-model-setting'});
    const label = node('span',{class:'agpa-setting-model'});
    const caption = node('span',{class:'agpa-model-caption'});
    const modelName = node('span');
    modelName.textContent = name;
    caption.append(modelName);label.append(caption);mark(label,name);
    const description = decorateVariant(label,name);
    if (description) caption.append(node('small',{text:description}));
    const moves = node('div',{class:'agpa-model-moves'});
    row.append(label,moves);
    caption.append(shortcutSelect(name));
    for (const [delta,title] of [[-1,'Move {model} up'],[1,'Move {model} down']]) {
     const adjacent = names[index + delta];
     const move = node('button',{type:'button','data-model-name':name,'data-move':String(delta)});
     i.set(move,title,{model:name},'aria-label');
     i.set(move,title,{model:name},'title');

     move.disabled = !adjacent || modelGroup(adjacent) !== modelGroup(name);
     move.onclick = () => {
      const next = names.slice();
      [next[index], next[index+delta]] = [adjacent,name];
      save(null,'order',next);
     };
     moves.append(move);
    }
    for(const [field,title]of [['favorite','Favorite'],['hidden','Hidden']]){const input=node('input',{type:'checkbox','data-model-name':name,'data-field':field});input.onchange=()=>save(name,field,input.checked);row.append(node('label',{'data-option':field},input,node('span',{text:title})));}container.append(row);
   }
   for (const [name] of missing) {
    const label=node('span');
    i.set(label,'{model} is unavailable.',{model:name});
    container.append(node('div',{class:'agpa-model-setting'},label,shortcutSelect(name)));
   }
   if (focused?.dataset.modelName) {
    const sameRow = [...container.querySelectorAll('[data-model-name]')].filter(el => el.dataset.modelName === focused.dataset.modelName);
    const target = sameRow.find(el => !el.disabled && el.dataset.move === focused.dataset.move && el.dataset.field === focused.dataset.field) || sameRow.find(el => !el.disabled);
    target?.focus();
   }
  }
  const reset = dialog.querySelector('[data-agpa-reset-order]');
  container.setAttribute('aria-busy',String(saving));
  reset.disabled = saving || !preferences.order?.length;
  for(const input of container.querySelectorAll('input')){input.checked=choice(input.dataset.modelName)[input.dataset.field];input.disabled=saving;}
  const assigned=new Map(Object.entries(preferences.models).filter(([,m])=>m.shortcut).map(([n,m])=>[m.shortcut,n]));
  const reserved=globalThis.__AGShortcuts?.status().shortcut;
  for(const select of container.querySelectorAll('[data-agpa-model-shortcut]')){
   const name=select.dataset.modelName;
   select.disabled=saving;select.value=choice(name).shortcut || '';
   for(const opt of select.options)opt.disabled=!!opt.value && (opt.value===reserved || (assigned.has(opt.value) && assigned.get(opt.value)!==name));
  }
  i.set(dialog.querySelector('[data-agpa-model-status]'),error||'');
 }
 let search='',lastSearch=0;
 function keyboard(event){
  if(quotaPopup&&event.key==='Escape'){const button=usageButton;closeUsage();if(event.target.closest?.('[data-agpa-usage-menu]'))button?.focus();event.stopImmediatePropagation();return;}
  if(event.target.closest?.('[data-agpa-effort-ui]'))return;
  if(event.target.closest?.('[data-agpa-model-shortcut]'))return;
  if(dialog?.open&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();dialog.close();return;}
  if(event.ctrlKey||event.altKey||event.metaKey)return;
  if(['Enter',' '].includes(event.key)&&event.target.matches?.('[data-agpa-model-manage],[data-agpa-model-footer]')){event.preventDefault();event.stopImmediatePropagation();event.target.click();return;}
  const panel=event.target.closest?.('[data-testid=model-selector-panel]')||(event.target.closest?.('[data-testid=model-selector-trigger][aria-expanded=true]')&&document.querySelector('[data-testid=model-selector-panel]'));
  if(!panel||event.target.closest('[data-agpa-model-favorite]'))return;
  const available = new Map(entries(panel).filter(({row}) => row.getAttribute('data-agpa-model-hidden') !== 'true' && row.getAttribute('aria-disabled') !== 'true').map(entry => [entry.name, entry]));
  const models = orderedNames(available.keys()).map(name => available.get(name));
  const extras=[...panel.querySelectorAll('[role=menuitem]')].filter(row=>!row.hasAttribute('data-agpa-model-key'));
  const actions=[panel.querySelector('[data-agpa-model-manage]'),...models.filter(m=>!choice(m.name).hidden).map(m=>m.row),panel.querySelector('[data-agpa-model-footer]'),...models.filter(m=>choice(m.name).hidden).map(m=>m.row),...extras].filter(e=>e?.getClientRects().length&&!e.hidden);
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
 [data-agpa-picker-quota],[data-agpa-seen-new]{display:none!important}
 [data-agpa-quota-heading]{display:flex!important;align-items:center;gap:7px}.agpa-quota-logos{display:inline-flex;align-items:center;gap:4px;flex-shrink:0}
 [data-agpa-model-groups]{display:flex;flex-direction:column}[data-agpa-model-other=true]{padding-left:16px!important}.agpa-model-visibility{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:24px;height:24px;border:0;background:none;color:var(--muted-foreground,#aaa);cursor:pointer;opacity:0}[data-agpa-model-key]:hover>.agpa-model-visibility,[data-agpa-model-key]:focus-within>.agpa-model-visibility,.agpa-model-visibility:focus-visible{opacity:1}.agpa-model-visibility:disabled{opacity:.35}.agpa-model-show{border-top:1px solid var(--border,#444)!important;margin-top:4px}.agpa-model-show:focus-visible,.agpa-model-visibility:focus-visible{outline:2px solid #398bdb;outline-offset:-2px}
 .agpa-model-dialog button:disabled{opacity:.32;cursor:default}
 .agpa-model-moves{display:flex;align-items:center;gap:4px}
 .agpa-model-moves button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:1px solid var(--border,#444);border-radius:50%;background:color-mix(in srgb,currentColor 6%,transparent);color:inherit;cursor:pointer}
 .agpa-model-moves button::before{content:"";width:7px;height:7px;border:solid currentColor;border-width:1.7px 1.7px 0 0;border-radius:1px;transform:translateY(2px) rotate(-45deg)}
 .agpa-model-moves [data-move="1"]::before{transform:translateY(-2px) rotate(135deg)}
 .agpa-model-moves button:hover:enabled{background:color-mix(in srgb,currentColor 15%,transparent)}
 .agpa-model-dialog :is(button,input):focus-visible{outline:2px solid var(--ring,#78aafa);outline-offset:2px}
 .agpa-model-element{--element-color:#78bfff;display:inline-grid;place-items:center;flex:none;box-sizing:border-box;width:21px;height:19px;border-radius:5px;color:color-mix(in srgb,var(--element-color) 67%,currentColor);background:color-mix(in srgb,var(--element-color) 13%,transparent);border:1px solid color-mix(in srgb,var(--element-color) 40%,transparent);font:600 11px/1 system-ui}
 .agpa-model-element::before{content:attr(data-agpa-element)}
 [data-agpa-element=Ar]{--element-color:#b796ee}[data-agpa-element=Ne]{--element-color:#50c5b4}[data-agpa-element=C]{--element-color:#e4ae64}
 .agpa-model-caption{min-width:0;display:grid;gap:2px;overflow-wrap:anywhere}
 [data-agpa-model-notice]{position:fixed;z-index:10000;bottom:76px;left:50%;transform:translateX(-50%);padding:8px 14px;background:var(--card,#27272a);color:var(--foreground,#eee);border:1px solid var(--border,#555);border-radius:10px;font:13px system-ui}
 [data-agpa-model-shortcut]{width:fit-content;max-width:100%;font:inherit;font-size:11px;color:inherit;background:var(--background,#171717);border:1px solid var(--border,#444);border-radius:5px;padding:1px 4px;cursor:pointer}
 .agpa-model-caption small{font-size:11px;color:var(--muted-foreground,#aaa)}
 .agpa-lab-icon{width:16px;height:16px;object-fit:contain;flex-shrink:0;display:inline-block;vertical-align:middle}.agpa-model-setting>span{display:flex;align-items:center;gap:9px;flex:1;min-width:0}
 [data-agpa-model-hidden=true]{display:none!important}.agpa-model-star{margin-left:auto;flex-shrink:0;width:24px;height:24px;border:0;background:none;color:var(--muted-foreground,#aaa);cursor:pointer;font-size:17px;opacity:0}.agpa-model-star[aria-pressed=true]{color:#e6b94b;opacity:1}[role=menuitem]:hover>.agpa-model-star,[role=menuitem]:focus>.agpa-model-star,.agpa-model-star:focus-visible{opacity:1}
 [data-testid=model-selector-header]{display:flex;align-items:center;justify-content:space-between;gap:18px}.agpa-model-manage,.agpa-model-show{font:inherit;border:0;background:transparent;color:var(--muted-foreground,#aaa);cursor:pointer;font-size:12px}.agpa-model-show{padding:8px;text-align:left}.agpa-model-show[hidden]{display:none}
 .agpa-model-dialog{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(640px,calc(100vw - 40px));max-height:calc(100vh - 50px);overflow:auto;border:1px solid var(--border,#444);border-radius:14px;padding:24px;background:var(--background,#171717);color:var(--foreground,#eee);font:13px/1.6 system-ui,sans-serif}.agpa-model-dialog::backdrop{background:#0009}.agpa-model-dialog h3{margin:0;font-size:18px}.agpa-model-dialog p{color:var(--muted-foreground,#aaa)}
 .agpa-model-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
 .agpa-model-dialog footer button{font:inherit;padding:5px 14px;border:1px solid var(--border,#444);border-radius:9px;background:transparent;color:inherit;cursor:pointer}
 .agpa-model-dialog footer button:last-child{background:var(--foreground,#eee);color:var(--background,#171717)}
 .agpa-model-setting{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border,#333)}
 .agpa-model-setting label{--option-accent:#deab45;display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--border,#444);border-radius:9px;cursor:pointer;font-size:12px}
 .agpa-model-setting [data-option=hidden]{--option-accent:#9d91e2}
 .agpa-model-setting label:has(:checked){border-color:color-mix(in srgb,var(--option-accent) 48%,transparent);background:color-mix(in srgb,var(--option-accent) 12%,transparent)}
 .agpa-model-setting input{appearance:none;display:grid;place-items:center;flex:none;width:15px;height:15px;margin:0;border-radius:5px;border:1.5px solid var(--muted-foreground,#aaa);background:transparent;cursor:pointer}
 .agpa-model-setting input:checked{border-color:var(--option-accent);background:var(--option-accent)}
 .agpa-model-setting input:checked::before{content:"";width:4px;height:7px;border:solid #211d27;border-width:0 2px 2px 0;transform:translateY(-1px) rotate(45deg)}
 .agpa-model-setting label:has(:disabled){opacity:.55;cursor:default}
 @media(forced-colors:active){.agpa-model-setting input{appearance:auto}.agpa-model-setting input::before{display:none}}
 .agpa-model-error{font-size:12px;color:#ff8888}
 [data-agpa-permission=review]{--agpa-permission:#70aaff}[data-agpa-permission=default]{--agpa-permission:#55bd8a}[data-agpa-permission=auto]{--agpa-permission:#d6a246}[data-agpa-permission=turbo]{--agpa-permission:#ee6f78}
 [data-testid=permissions-selector-trigger][data-agpa-permission]{color:color-mix(in srgb,var(--foreground,#eee) 18%,var(--agpa-permission))!important;background:color-mix(in srgb,var(--agpa-permission) 12%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--agpa-permission) 23%,transparent)}
 [data-testid^=permissions-preset-option-][data-agpa-permission]>[data-icon],[data-testid^=permissions-preset-option-][data-agpa-permission]>span.flex.min-w-0>span:first-child{color:color-mix(in srgb,var(--foreground,#eee) 18%,var(--agpa-permission))!important}

 .agpa-standalone-usage{box-sizing:border-box;position:fixed;z-index:10000;width:320px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:10px;border:1px solid var(--border,#36373c);border-radius:13px;background:var(--background,#17181c);color:var(--foreground,#eee);font:12px/1.5 system-ui;box-shadow:0 12px 30px #0005}.agpa-standalone-usage header{display:flex;align-items:center;justify-content:space-between;color:var(--muted-foreground,#aaa);padding:0 2px 4px}.agpa-quota-refresh{border:0;background:transparent;color:inherit;cursor:pointer;font:18px system-ui}.agpa-quota-refresh:disabled{opacity:.4}.agpa-standalone-usage section+section{margin-top:10px}.agpa-standalone-usage strong{display:block;font-weight:500;padding:2px}.agpa-quota-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:1px 12px;padding:4px 2px;color:var(--muted-foreground,#aaa)}.agpa-quota-row small{grid-column:1/-1;text-align:right;font-size:11px}.agpa-quota-value{display:flex;align-items:center;gap:6px}.agpa-quota-ring{width:14px;height:14px;display:inline-block;border-radius:50%;background:conic-gradient(var(--quota-color) var(--quota-left),#62636b var(--quota-left));mask:radial-gradient(circle,transparent 48%,#000 52%)}.agpa-quota-row[aria-disabled=true]{opacity:.5}
 @media(max-width:600px){.agpa-model-setting{grid-template-columns:auto auto 1fr;gap:6px}.agpa-setting-model{grid-column:1/-1}.agpa-model-setting label{justify-self:start}}
 `});document.head.append(style);
 const watched=automationPickers+', [data-testid=settings-button],[role=menu][data-nested],[data-testid=model-selector-trigger],[data-testid=model-selector-panel],[data-testid^=permissions-]';
 const observer=new MutationObserver(records=>{
  if(records.some(r=>{const target=r.target.nodeType===1?r.target:r.target.parentElement;if(target?.closest('[data-agpa-model-ui]'))return false;const nodes=[...r.addedNodes,...r.removedNodes];if(nodes.length&&nodes.every(n=>n.nodeType===1&&n.hasAttribute('data-agpa-model-ui')))return false;return target?.closest(watched)||nodes.some(n=>n.nodeType===1&&(n.matches(watched)||n.querySelector(watched)));}))schedule();
 });observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});
 document.addEventListener('pointerdown',usageOutside,true);
 window.addEventListener('resize',positionUsage);
 window.addEventListener('keydown',keyboard,true);const unsubscribe=i.subscribe(()=>{schedule();paintDialog();});
 globalThis.__AGModelUI={version:VERSION,openUsage,leaveUsage,entries,nameForShortcut,showUnavailable,setEffort:(name,value)=>save(name,'effort',value),setPreferences(next){preferences=next;schedule();paintDialog();},status:()=>({known:[...known],preferences,saving,error}),onResult(id,ok,next){const p=pending.get(id);if(!p)return;clearTimeout(p.timer);pending.delete(id);ok?p.resolve(next):p.reject(Error('save'));},destroy(){stopped=true;clearTimeout(noticeTimer);document.removeEventListener('pointerdown',usageOutside,true);window.removeEventListener('resize',positionUsage);closeUsage();observer.disconnect();unsubscribe();window.removeEventListener('keydown',keyboard,true);for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('closed'));}pending.clear();dialog?.close();dialog?.remove();style.remove();for(const attr of ['data-agpa-picker-quota','data-agpa-seen-new'])for(const e of document.querySelectorAll('['+attr+']'))e.removeAttribute(attr);for(const e of document.querySelectorAll('[data-agpa-model-key]')){e.style.order=originalOrders.get(e)||'';e.removeAttribute('data-agpa-model-key');e.removeAttribute('data-agpa-model-hidden');e.removeAttribute('data-agpa-model-other');}for(const e of document.querySelectorAll('[data-agpa-quota-heading]'))e.removeAttribute('data-agpa-quota-heading');for(const e of document.querySelectorAll('[data-agpa-model-groups]'))e.removeAttribute('data-agpa-model-groups');for(const e of document.querySelectorAll('[data-agpa-permission]'))e.removeAttribute('data-agpa-permission');for(const e of document.querySelectorAll('[data-agpa-model-ui]'))e.remove();delete globalThis.__AGModelUI;}};
 schedule();
})();
