/* Local project appearance. No conversation, project metadata, or tool mutations. */
(() => {
  'use strict';
  const VERSION = '1.7.0';
  const i18n=globalThis.__AGPAI18n;
  const initial = globalThis.__AGPA_CONFIG__ || { projects: {} };
  delete globalThis.__AGPA_CONFIG__;
  if (globalThis.__AGProjectAppearance?.version === VERSION) {
    globalThis.__AGProjectAppearance.setConfig(initial);
    return;
  }
  globalThis.__AGProjectAppearance?.destroy();
  document.querySelectorAll('[data-agpa-editor]').forEach(x=>x.remove());
  const {paths,svg,projectFrom} = globalThis.__AGProjectPresentation;
  const aliases = {folder:'cartella progetto',terminal:'terminale console',code:'codice programmazione',monitor:'computer pc schermo',server:'homelab rete',chip:'hardware processore',settings:'impostazioni ingranaggio',wrench:'manutenzione chiave',briefcase:'lavoro ufficio',book:'libro lettura',notebook:'appunti',graduation:'studio scuola',pencil:'matita scrittura',music:'musica',film:'cinema video',atom:'scienza',palette:'arte design',stethoscope:'salute medico',puzzle:'giochi',leaf:'foglia natura',shopping:'acquisti spesa',chart:'grafico finanza',money:'soldi euro budget',dumbbell:'palestra sport',scales:'legge giustizia',globe:'mondo internet',plane:'viaggio aereo',heart:'cuore salute',paw:'animali',flask:'esperimenti laboratorio',brain:'cervello ai',flower:'fiore',home:'casa',camera:'foto',phone:'telefono',shield:'sicurezza',rocket:'razzo startup',gamepad:'videogiochi',coffee:'caffe',bicycle:'bici',lightbulb:'idee',flag:'bandiera',tree:'albero',mail:'posta email',star:'preferiti stella'};
  const colors = ['#ebebeb','#ff666a','#ff914d','#ffd647','#41c878','#329bff','#b17afb','#ff83c2'];
  const emojis = ['📁','💻','🛠️','⚙️','🧪','🔬','🧠','🤖','💼','📚','🎓','✏️','🎨','🎵','🎬','🎮','🌱','🌍','✈️','🏠','💰','📊','⚖️','🏋️','❤️','🩺','🐾','☕','📷','📱','🛡️','🚀','💡','⭐','🍀','🧩','🗂️','🏦','📝','🎯'];
  let config = initial;
  let scheduled = false;
  let destroyed = false;
  let editor = null,editorTranslate=null;
  const pending = new Map();
  const menuHandlers = new Map();
  const knownProjects = new Map();
  let rail = null;
  let railSignature = '';
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    if(!attrs['data-agpa-project']&&attrs.class!=='agpa-project-name')i18n.attrs(node,attrs);
    return node;
  }
  const style = el('style', {id:'agpa-styles', text:`
    [data-agpa-styled] {position:relative!important}
    [data-agpa-styled] > div > svg:first-child {visibility:hidden!important}
    .agpa-project-icon {position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;font-size:17px;line-height:1}
    [data-agpa-inline-native] {display:none!important}
    .agpa-inline-icon {width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;pointer-events:none;font-size:16px;line-height:1}
    .agpa-rail {box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:5px;width:52px;min-width:52px;height:100%;padding:48px 6px 8px;background:var(--sidebar,#171717);color:var(--muted-foreground,#aaa);flex-shrink:0;z-index:20}
    .agpa-rail[hidden] {display:none!important}
    .agpa-rail-button {box-sizing:border-box;width:36px;height:36px;min-height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:transparent;border:0;border-radius:10px;color:inherit;cursor:pointer;font-size:19px;position:relative}
    .agpa-rail-button:hover,.agpa-rail-button[aria-current=page] {background:var(--sidebar-secondary,#303030);color:var(--foreground,#eee)}
    .agpa-rail-button[aria-current=page]::before {content:'';position:absolute;left:1px;width:2px;height:17px;border-radius:3px;background:currentColor}
    .agpa-rail-button > svg {width:20px;height:20px}
    .agpa-rail-button:focus-visible {outline:2px solid #398bdb;outline-offset:1px}
    .agpa-rail-divider {width:25px;height:1px;min-height:1px;background:var(--border,#383838);margin:7px 0}
    .agpa-rail-projects {display:flex;flex-direction:column;align-items:center;gap:5px;overflow-y:auto;overflow-x:hidden;min-height:0;width:100%;scrollbar-width:none;flex:1}
    [data-agpa-menu-edit]:hover,[data-agpa-menu-edit]:focus {background:var(--secondary,#404040);color:var(--foreground,#eee)}
    .agpa-dialog {box-sizing:border-box;width:min(530px,calc(100vw - 40px));max-height:calc(100vh - 48px);overflow:visible;margin:auto;border:1px solid var(--border,#444);border-radius:20px;padding:22px;background:var(--card,#2b2b2b);color:var(--foreground,#eee);font:14px/1.4 system-ui,sans-serif;box-shadow:0 24px 80px #0006}
    .agpa-dialog::backdrop {background:rgba(0,0,0,.38)}
    .agpa-dialog * {box-sizing:border-box}
    .agpa-dialog [hidden] {display:none!important}
    .agpa-heading {display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
    .agpa-heading h2 {font-size:20px;font-weight:600;line-height:1.4;margin:0}
    .agpa-dialog button {font:inherit;cursor:pointer;color:inherit;border:0}
    .agpa-close {background:transparent;font-size:20px!important;border-radius:7px;padding:2px 7px;opacity:.65}
    .agpa-close:hover {background:var(--secondary,#444);opacity:1}
    .agpa-project-row {display:flex;align-items:center;min-height:42px;border:1px solid var(--border,#444);border-radius:11px;overflow:hidden}
    .agpa-picker-trigger {width:42px;min-width:42px;align-self:stretch;display:flex;align-items:center;justify-content:center;background:var(--secondary,#383838);border-right:1px solid var(--border,#444)!important}
    .agpa-picker-trigger:hover {filter:brightness(1.12)}
    .agpa-project-name {padding:9px 13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .agpa-panel {margin-top:14px;padding:12px;border-radius:14px;background:var(--background,#252525);border:1px solid var(--border,#444)}
    .agpa-toolbar {display:flex;align-items:center;gap:5px;margin-bottom:10px}
    .agpa-tab,.agpa-clear {padding:4px 10px;border-radius:20px;background:transparent;font-size:12px!important;color:var(--muted-foreground,#aaa)!important}
    .agpa-tab[aria-selected=true] {background:var(--secondary,#444);color:var(--foreground,#eee)!important}
    .agpa-clear {margin-left:auto;background:var(--secondary,#444)}
    .agpa-search,.agpa-hex,.agpa-emoji-input {font:inherit;color:var(--foreground,#eee);background:var(--card,#303030);border:1px solid var(--border,#555);border-radius:7px;outline:none}
    .agpa-search {display:block;width:100%;height:32px;padding:5px 9px;margin-bottom:12px}
    .agpa-search:focus,.agpa-hex:focus,.agpa-emoji-input:focus {border-color:#398bdb;box-shadow:0 0 0 1px #398bdb}
    .agpa-colors {display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:6px 0 13px;padding:2px}
    .agpa-swatch {width:24px;height:24px;min-width:24px;border-radius:50%;padding:0;background:var(--agpa-swatch)!important;box-shadow:0 0 0 3px transparent}
    .agpa-swatch[aria-pressed=true] {box-shadow:0 0 0 3px var(--card,#444),0 0 0 5px var(--agpa-swatch)}
    .agpa-grid {display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:5px;max-height:218px;overflow:auto;padding:3px}
    .agpa-icon-choice {display:flex;align-items:center;justify-content:center;min-height:33px;border-radius:8px;background:transparent;font-size:21px!important}
    .agpa-icon-choice:hover,.agpa-icon-choice[aria-pressed=true] {background:var(--secondary,#444);outline:1px solid var(--border,#555)}
    .agpa-custom {display:flex;align-items:center;gap:8px;margin:13px 0 0;font-size:12px;color:var(--muted-foreground,#aaa)}
    .agpa-custom input[type=color] {width:28px;height:25px;padding:0;border:0;background:none;cursor:pointer}
    .agpa-hex {width:83px;padding:4px 7px;font-size:12px;text-transform:uppercase}
    .agpa-emoji-input {width:100%;padding:6px 9px;margin-bottom:9px}
    .agpa-empty {grid-column:1/-1;padding:20px;text-align:center;color:var(--muted-foreground,#aaa)}
    .agpa-footer {display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:20px}
    .agpa-cancel {padding:7px 13px;border-radius:9px;background:transparent;color:var(--muted-foreground,#aaa)!important}
    .agpa-save {min-width:70px;padding:7px 17px;border-radius:9px;background:var(--foreground,#eee);color:var(--background,#222)!important;font-weight:600!important}
    .agpa-save:disabled {opacity:.45;cursor:wait}
    .agpa-status {font-size:12px;min-height:17px;margin:12px 0 -5px;color:var(--muted-foreground,#aaa)}
    .agpa-status[data-error] {color:#ff777c}
    .agpa-dialog button:focus-visible {outline:2px solid #398bdb;outline-offset:2px}
    @media(max-width:500px){.agpa-colors{gap:10px}.agpa-dialog{padding:16px}.agpa-grid{grid-template-columns:repeat(6,minmax(0,1fr))}}
  `});
  document.getElementById('agpa-styles')?.remove();
  document.head.append(style);
  function applyHeaders() {
    for (const header of document.querySelectorAll('[data-testid="project-header"]')) {
      const project = projectFrom(header);
      if (!project) continue;
      knownProjects.set(project.id,{id:project.id,name:project.name});
      const holder = header.querySelector('div[class~="w-6"][class~="h-6"]');
      if (!holder) continue;
      const value = config.projects?.[project.id];
      if (!value) {
        holder.removeAttribute('data-agpa-styled');
        holder.querySelector(':scope > .agpa-project-icon')?.remove();
        continue;
      }
      const signature = JSON.stringify(value);
      let icon = holder.querySelector(':scope > .agpa-project-icon');
      if (holder.getAttribute('data-agpa-styled') === signature && icon) continue;
      if (!icon) { icon = el('span',{class:'agpa-project-icon','aria-hidden':'true'}); holder.append(icon); }
      icon.replaceChildren(value.kind === 'emoji' ? document.createTextNode(value.emoji) : svg(value.icon,17));
      icon.style.color = value.color || 'var(--muted-foreground,#aaa)';
      holder.setAttribute('data-agpa-styled',signature);
    }
  }
  // Keep React-owned SVGs in place so native selection, checks, and rerenders work.
  function inlineIcon(container,project) {
    const native=container.querySelector(':scope > [data-project-icon]');
    let icon=container.querySelector(':scope > .agpa-inline-icon');
    if(!native){icon?.remove();return;}
    const value=project&&config.projects?.[project.id];
    if(!value){native.removeAttribute('data-agpa-inline-native');icon?.remove();return;}
    const signature=project.id+JSON.stringify(value);
    if(icon?.getAttribute('data-agpa-inline')===signature&&native.hasAttribute('data-agpa-inline-native'))return;
    if(!icon){icon=el('span',{class:'agpa-inline-icon','aria-hidden':'true'});container.insertBefore(icon,native);}
    icon.replaceChildren(value.kind==='emoji'?document.createTextNode(value.emoji):svg(value.icon,16));
    icon.style.color=value.color||'var(--muted-foreground,#aaa)';
    icon.setAttribute('data-agpa-inline',signature);
    native.setAttribute('data-agpa-inline-native','');
  }
  function projectNamed(name) {
    const matches=[...knownProjects.values()].filter(p=>p.name===name);
    // Selector rows expose a name, not an ID. Refuse ambiguous duplicate labels.
    return matches.length===1?matches[0]:null;
  }
  function applySelectors() {
    for(const item of document.querySelectorAll('[data-testid="project-selector-item"]'))
      inlineIcon(item,projectNamed(item.getAttribute('data-project-name')));
    for(const trigger of document.querySelectorAll('[data-testid="project-selector-trigger"]')) {
      const name=trigger.querySelector(':scope > span.truncate')?.textContent;
      inlineIcon(trigger,projectNamed(name));
    }
  }
  function nativeSidebar(){return document.querySelector('[data-testid="settings-button"]')?.closest('[role="navigation"]');}
  function nativeControl(selector) {return nativeSidebar()?.querySelector(selector);}
  function railButton(label,selector,fallback='folder') {
    const source=nativeControl(selector);
    if(!source)return null;
    const button=el('button',{type:'button',class:'agpa-rail-button','aria-label':label,title:label,'data-agpa-native':selector});
    button.append(source.querySelector('svg')?.cloneNode(true)||svg(fallback,19));
    button.addEventListener('click',()=>nativeControl(selector)?.click());
    return button;
  }
  function applyRail() {
    const toggle=document.querySelector('[data-testid="sidebar-toggle"]');
    const sidebar=nativeSidebar();
    const panel=sidebar?.parentElement?.parentElement;
    if(!toggle||!panel?.parentElement){rail?.remove();rail=null;railSignature='';return;}
    if(!rail?.isConnected){rail=el('nav',{class:'agpa-rail','aria-label':'Compact sidebar','data-agpa-rail':''});panel.before(rail);railSignature='';}
    const collapsed=toggle.getAttribute('aria-expanded')==='false';
    if(rail.hidden===collapsed)rail.hidden=!collapsed;
    if(!collapsed)return;
    const projects=[...sidebar.querySelectorAll('[data-testid="project-header"]')].map(projectFrom).filter(Boolean);
    const signature=JSON.stringify([i18n.language,projects.map(p=>[p.id,p.name,config.projects?.[p.id]])]);
    if(signature!==railSignature){
      railSignature=signature;
      const focused=document.activeElement?.getAttribute('data-agpa-project');
      rail.replaceChildren();
      for(const [label,selector,fallback]of [
        ['New Conversation','[data-testid="new-conversation-button"]','pencil'],
        ['Conversation History','[data-testid="history-button"]','book'],
        ['Automations','[data-testid="automations-button"]','settings'],
        ['Customizations','a[href="/customizations"]','briefcase']
      ])rail.append(railButton(label,selector,fallback)||document.createTextNode(''));
      rail.append(el('div',{class:'agpa-rail-divider',role:'separator'}));
      const list=el('div',{class:'agpa-rail-projects','aria-label':'Projects'});
      for(const project of projects){
        const value=config.projects?.[project.id];
        const button=el('button',{type:'button',class:'agpa-rail-button','aria-label':project.name,title:project.name,'data-agpa-project':project.id});
        button.append(value?.kind==='emoji'?document.createTextNode(value.emoji):svg(value?.icon||'folder',20));
        if(value?.color)button.style.color=value.color;
        button.addEventListener('click',()=>{
          const current=[...document.querySelectorAll('[data-testid="project-header"]')].map(projectFrom).find(p=>p?.id===project.id);
          current?.link.click();
        });
        list.append(button);
      }
      rail.append(list,railButton('Settings','[data-testid="settings-button"]','settings')||document.createTextNode(''));
      if(focused)rail.querySelector(`[data-agpa-project="${focused}"]`)?.focus();
    }
    const selected=document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
    const active=new URL(location.href).searchParams.get('section')||selected?.closest('[data-sidebar-section-id]')?.getAttribute('data-sidebar-section-id');
    for(const button of rail.querySelectorAll('[data-agpa-project]')){
      const current=button.getAttribute('data-agpa-project')===active;
      if(current&&button.getAttribute('aria-current')!=='page')button.setAttribute('aria-current','page');
      else if(!current&&button.hasAttribute('aria-current'))button.removeAttribute('aria-current');
    }
  }
  function menuProject(menu) {
    for (const id of (menu.getAttribute('aria-labelledby')||'').split(/\s+/)) {
      const trigger = document.getElementById(id);
      if (trigger?.matches('button[aria-haspopup="menu"]')) {
        const result = projectFrom(trigger); if (result) return result;
      }
    }
    return null;
  }
  function applyMenus() {
    for(const [menu,handler]of menuHandlers)if(!menu.isConnected){menu.removeEventListener('keydown',handler,true);menuHandlers.delete(menu);}
    for (const menu of document.querySelectorAll('[role="menu"][data-open]')) {
      if (!menu.querySelector('[data-testid="group-header-settings-item"]')) continue;
      const project = menuProject(menu);
      if (!project || menu.querySelector('[data-agpa-menu-edit]')) continue;
      const reference = menu.querySelector('[data-testid="group-header-settings-item"]');
      const item = el('button',{type:'button',role:'menuitem',tabindex:'-1',class:reference.className,'data-agpa-menu-edit':project.id},svg('settings',16),el('span',{class:'truncate',text:'Edit'}));
      item.addEventListener('pointerdown',e=>e.stopPropagation());
      item.addEventListener('click',e=>{
        e.preventDefault();e.stopPropagation();
        project.trigger?.click();
        queueMicrotask(()=>openEditor(project));
      });
      item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopImmediatePropagation();item.click();}},true);
      menu.prepend(item);
      const keyHandler = e => {
        if (e.target.closest('[role="menu"]') !== menu || !['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return;
        const options = Array.from(menu.querySelectorAll(':scope > [role="menuitem"]')).filter(x=>!x.hasAttribute('data-disabled')&&x.getClientRects().length);
        if(!options.length)return;
        let index=options.indexOf(document.activeElement);
        if(e.key==='Home')index=0;else if(e.key==='End')index=options.length-1;else index=(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;
        e.preventDefault();e.stopImmediatePropagation();options[index].focus();
      };
      const previousHandler=menuHandlers.get(menu);if(previousHandler)menu.removeEventListener('keydown',previousHandler,true);
      menu.addEventListener('keydown',keyHandler,true);menuHandlers.set(menu,keyHandler);
    }
  }
  function schedule() {
    if (scheduled||destroyed) return;
    scheduled=true;
    queueMicrotask(()=>{scheduled=false;if(destroyed)return;applyHeaders();applySelectors();applyMenus();applyRail();});
  }
  function persist(id,value) {
    return new Promise((resolve,reject)=>{
      const requestId=crypto.randomUUID();
      const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Could not save. Check that the appearance service is running.'));},6000);
      pending.set(requestId,{resolve,reject,timer});
      try { globalThis.__agpaPersist(JSON.stringify({requestId,projectId:id,style:value})); }
      catch { clearTimeout(timer);pending.delete(requestId);reject(Error('The appearance service is unavailable. Try again.')); }
    });
  }
  function openEditor(project) {
    if(editor){editor.focus();return;}
    let draft={kind:'icon',icon:'folder',emoji:'📁',color:null,...(config.projects?.[project.id]||{})};
    let reset=false,tab=draft.kind==='emoji'?'emoji':'icon',query='';
    const dialog=el('dialog',{class:'agpa-dialog','aria-labelledby':'agpa-dialog-title','data-agpa-editor':project.id});editor=dialog;
    const close=el('button',{type:'button',class:'agpa-close','aria-label':'Close',text:'×'});
    const preview=el('button',{type:'button',class:'agpa-picker-trigger','aria-label':'Choose project icon and color','aria-expanded':'true'});
    const panel=el('div',{class:'agpa-panel'});
    const emojiTab=el('button',{type:'button',class:'agpa-tab',role:'tab',text:'Emoji'});
    const iconTab=el('button',{type:'button',class:'agpa-tab',role:'tab',text:'Icons'});
    const clear=el('button',{type:'button',class:'agpa-clear',text:'Clear',title:'Reset icon and color'});
    const search=el('input',{type:'search',class:'agpa-search',placeholder:'Search icons','aria-label':'Search icons',autocomplete:'off'});
    const colorRow=el('div',{class:'agpa-colors','aria-label':'Project color'});
    const grid=el('div',{class:'agpa-grid','aria-label':'Project icons'});
    const emojiInput=el('input',{type:'text',class:'agpa-emoji-input',placeholder:'Enter your own emoji','aria-label':'Custom emoji',maxlength:'16',autocomplete:'off'});
    const custom=el('input',{type:'color','aria-label':'Custom color'});
    const hex=el('input',{type:'text',class:'agpa-hex','aria-label':'Hex color',maxlength:'7',placeholder:'#41C878'});
    const status=el('div',{class:'agpa-status',role:'status','aria-live':'polite'});
    const cancel=el('button',{type:'button',class:'agpa-cancel',text:'Cancel'});
    const save=el('button',{type:'button',class:'agpa-save',text:'Save'});
    dialog.append(el('div',{class:'agpa-heading'},el('h2',{id:'agpa-dialog-title',text:'Edit project'}),close),el('div',{class:'agpa-project-row'},preview,el('span',{class:'agpa-project-name',text:project.name,title:project.name})),panel,status,el('div',{class:'agpa-footer'},cancel,save));
    panel.append(el('div',{class:'agpa-toolbar',role:'tablist','aria-label':'Icon type'},emojiTab,iconTab,clear),search,colorRow,emojiInput,grid,el('div',{class:'agpa-custom'},el('span',{text:'Custom color'}),custom,hex));
    const swatches=colors.map(color=>{
      const b=el('button',{type:'button',class:'agpa-swatch','aria-label':`Color ${color}`});i18n.set(b,'Color {color}',{color},'aria-label');b.style.setProperty('--agpa-swatch',color);
      b.addEventListener('click',()=>setColor(color));colorRow.append(b);return [b,color];
    });
    function setColor(color){draft.color=color;reset=false;paint();}
    function paint(){
      const color=draft.color||'var(--muted-foreground,#aaa)';
      preview.replaceChildren(draft.kind==='emoji'?document.createTextNode(draft.emoji):svg(draft.icon,19));preview.style.color=color;
      emojiTab.setAttribute('aria-selected',String(tab==='emoji'));iconTab.setAttribute('aria-selected',String(tab==='icon'));
      for(const [button,c]of swatches)button.setAttribute('aria-pressed',String(c===draft.color));
      custom.value=draft.color||'#41c878';if(document.activeElement!==hex)hex.value=draft.color||'';
      emojiInput.hidden=tab!=='emoji';search.hidden=tab!=='icon';
      grid.style.color=color;grid.replaceChildren();
      if(tab==='icon'){
        const names=Object.keys(paths).filter(n=>`${n} ${i18n.iconName(n)} ${aliases[n]||''}`.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').includes(query.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu,'')));
        for(const name of names){const b=el('button',{type:'button',class:'agpa-icon-choice','aria-label':`Icon ${name}`,title:name,'aria-pressed':String(draft.kind==='icon'&&draft.icon===name)},svg(name,21));i18n.set(b,'Icon {name}',{name:()=>i18n.iconName(name)},'aria-label');i18n.set(b,'{name}',{name:()=>i18n.iconName(name)},'title');b.addEventListener('click',()=>{draft.kind='icon';draft.icon=name;reset=false;paint();});grid.append(b);}
        if(!names.length)grid.append(el('div',{class:'agpa-empty',text:'No icons found'}));
      }else{
        for(const emoji of emojis){const b=el('button',{type:'button',class:'agpa-icon-choice','aria-label':`Emoji ${emoji}`,'aria-pressed':String(draft.kind==='emoji'&&draft.emoji===emoji),text:emoji});i18n.set(b,'Emoji {emoji}',{emoji},'aria-label');b.addEventListener('click',()=>{draft.kind='emoji';draft.emoji=emoji;emojiInput.value=emoji;reset=false;paint();});grid.append(b);}
      }
    }
    function cleanupDialog(){const current=editor===dialog;dialog.remove();if(current){editor=null;editorTranslate=null;project.trigger?.focus();}}
    function finish(){dialog.close();cleanupDialog();}
    function dismiss(){if(save.disabled)return;finish();}
    close.addEventListener('click',dismiss);cancel.addEventListener('click',dismiss);
    dialog.addEventListener('cancel',e=>{e.preventDefault();if(!save.disabled)finish();});
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dismiss();}});
    dialog.addEventListener('close',cleanupDialog);
    preview.addEventListener('click',()=>{panel.hidden=!panel.hidden;preview.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)(tab==='icon'?search:emojiInput).focus();});
    iconTab.addEventListener('click',()=>{tab='icon';paint();search.focus();});emojiTab.addEventListener('click',()=>{tab='emoji';paint();emojiInput.focus();});
    clear.addEventListener('click',()=>{draft={kind:'icon',icon:'folder',emoji:'📁',color:null};reset=true;query='';search.value='';emojiInput.value='';paint();});
    search.addEventListener('input',()=>{query=search.value;paint();});
    custom.addEventListener('input',()=>setColor(custom.value));
    hex.addEventListener('input',()=>{if(/^#[\da-f]{6}$/i.test(hex.value)){hex.setAttribute('aria-invalid','false');setColor(hex.value.toLowerCase());}else hex.setAttribute('aria-invalid',String(hex.value!==''));});
    hex.addEventListener('blur',()=>{hex.value=draft.color||'';hex.removeAttribute('aria-invalid');});
    emojiInput.addEventListener('input',()=>{const value=emojiInput.value.trim();if(value&&!/[\u0000-\u001f\u007f]/.test(value)){draft.kind='emoji';draft.emoji=value;reset=false;paint();}});
    save.addEventListener('click',async()=>{
      if(hex.getAttribute('aria-invalid')==='true'){hex.focus();i18n.set(status,'Enter a color such as #41C878.');status.setAttribute('data-error','');return;}
      save.disabled=true;i18n.set(save,'Saving…');i18n.set(status,'');status.removeAttribute('data-error');
      try{await persist(project.id,reset?null:draft);finish();}catch(error){i18n.set(status,'Could not save. Check that the appearance service is running.');status.setAttribute('data-error','');save.disabled=false;i18n.set(save,'Save');}
    });
    editorTranslate=paint;document.body.append(dialog);paint();dialog.showModal();search.focus();
  }
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-open','data-project-label','data-project-name','aria-labelledby','aria-expanded','data-selected']});
  const routeTimer=setInterval(schedule,1000);
  const untranslate=i18n.subscribe(()=>{schedule();editorTranslate?.();});
  globalThis.__AGProjectAppearance={
    version:VERSION,
    reapply(){if(!style.isConnected)document.head.append(style);schedule();},
    setConfig(next){config=next||{projects:{}};schedule();},
    onPersisted(requestId,ok,message,next){
      const request=pending.get(requestId);if(!request)return;
      clearTimeout(request.timer);pending.delete(requestId);
      if(ok){this.setConfig(next);request.resolve();}else request.reject(Error(message||'Could not save.'));
    },
    status(){return{version:VERSION,projectsFound:document.querySelectorAll('[data-testid="project-header"]').length,configuredProjects:Object.keys(config.projects||{}).length,editorOpen:!!editor,compactSidebar:!!rail&&!rail.hidden};},
    destroy(){destroyed=true;untranslate();observer.disconnect();clearInterval(routeTimer);rail?.remove();rail=null;for(const [menu,handler]of menuHandlers)menu.removeEventListener('keydown',handler,true);menuHandlers.clear();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Appearance service stopped.'));}pending.clear();editor?.close();editor?.remove();editor=null;document.querySelectorAll('[data-agpa-menu-edit],.agpa-project-icon,.agpa-inline-icon').forEach(x=>x.remove());document.querySelectorAll('[data-agpa-styled]').forEach(x=>x.removeAttribute('data-agpa-styled'));document.querySelectorAll('[data-agpa-inline-native]').forEach(x=>x.removeAttribute('data-agpa-inline-native'));style.remove();delete globalThis.__AGProjectAppearance;}
  };
  schedule();
})();
