/* Layout extension for the existing Gemini guest; no session or native API bridge. */
(() => {
  'use strict';
  const VERSION='1.6.1';
  const i18n=globalThis.__AGPAI18n;
  const icon=globalThis.__AGPA_INLINE_ICON__;
  delete globalThis.__AGPA_INLINE_ICON__;
  if(globalThis.__AGGeminiInline?.version===VERSION)return;
  globalThis.__AGGeminiInline?.destroy();
  if(!icon||!globalThis.__AGGeminiSwitch)return;
  const WORLD=6731;
  const signal='agpa-return-antigravity:'+crypto.randomUUID();
  let destroyed=false,tracked=null,installed=false,busy=false,rerun=false;
  const unbind=[];
  const css=document.createElement('style');css.id='agpa-gemini-inline-styles';
  css.textContent=`
    .agpa-gemini-bar {display:none!important}
    .agpa-gemini-fallback {position:absolute;top:12px;right:16px;z-index:10}
    .agpa-gemini-fallback[hidden] {display:none!important}
  `;
  document.head.append(css);
  const fallback=document.createElement('button');
  fallback.type='button';fallback.className='agpa-app-switch agpa-gemini-fallback';
  i18n.set(fallback,'Return to Antigravity',{},'aria-label');i18n.set(fallback,'Return to Antigravity',{},'title');
  const image=document.createElement('img');image.src=icon;image.alt='';image.width=20;image.height=20;
  const label=document.createElement('span');label.textContent='Antigravity';fallback.append(image,label);
  function returnToApp(){document.querySelector('[data-agpa-return-antigravity]')?.click();}
  fallback.addEventListener('click',returnToApp);
  function installInGuest(settings){
    const VERSION='1.6.1';
    const old=globalThis.__agpaInlineReturn;
    if(old?.version===VERSION){old.configure(settings);return old.status();}
    old?.destroy();
    let current=settings,stopped=false,queued=false;
    const style=document.createElement('style');style.id='agpa-inline-return-styles';
    style.textContent=`
      #agpa-inline-return {display:inline-flex;align-items:center;justify-content:center;gap:6px;flex-shrink:0;height:32px;padding:0 12px;margin-inline-end:8px;border:1px solid transparent;border-radius:999px;background:var(--gem-sys-color--surface-container,#242424);color:var(--gem-sys-color--on-surface,#e9eef6);font:500 13px/1.2 'Google Sans',system-ui,sans-serif;cursor:pointer;white-space:nowrap;box-sizing:border-box}
      #agpa-inline-return:hover {filter:brightness(1.2);border-color:var(--gem-sys-color--outline-variant,#45474a)}
      #agpa-inline-return:focus-visible {outline:2px solid #8ab4f8;outline-offset:2px}
      #agpa-inline-return img {width:20px;height:20px;object-fit:contain;pointer-events:none}
      #agpa-inline-return[data-floating] {position:fixed;top:16px;right:16px;z-index:2147483000;margin:0}
      @media(max-width:500px){#agpa-inline-return{padding:0 9px;gap:4px}}
    `;
    document.head.append(style);
    const button=document.createElement('button');button.id='agpa-inline-return';button.type='button';
    button.setAttribute('aria-label',current.returnLabel);button.title=current.returnLabel;
    const image=document.createElement('img');image.src=current.icon;image.alt='';image.width=20;image.height=20;
    const label=document.createElement('span');label.textContent='Antigravity';button.append(image,label);
    const activate=e=>{e.preventDefault();e.stopPropagation();console.info(current.signal);};
    button.addEventListener('click',activate);
    function anchor(){
      const element=document.querySelector('temp-chat-button');
      if(element)return element;
      const b=[...document.querySelectorAll('button[aria-label]')].find(n=>/temporary chat|chat temporane/i.test(n.getAttribute('aria-label')||''));
      return b?.closest('gem-icon-button')||b;
    }
    function place(){
      if(stopped)return;
      const target=anchor();
      if(target?.parentElement){
        if(button.parentElement!==target.parentElement||button.nextElementSibling!==target)target.before(button);
        if(button.hasAttribute('data-floating'))button.removeAttribute('data-floating');
      }else{
        if(button.parentElement!==document.body)document.body.append(button);
        if(!button.hasAttribute('data-floating'))button.setAttribute('data-floating','');
      }
    }
    const observer=new MutationObserver(()=>{if(queued||stopped)return;queued=true;queueMicrotask(()=>{queued=false;place();});});
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label']});
    globalThis.__agpaInlineReturn={
      version:VERSION,
      configure(next){current=next;if(image.src!==next.icon)image.src=next.icon;if(button.getAttribute('aria-label')!==next.returnLabel)button.setAttribute('aria-label',next.returnLabel);if(button.title!==next.returnLabel)button.title=next.returnLabel;place();},
      status(){return{installed:button.isConnected,anchored:!button.hasAttribute('data-floating'),label:button.textContent};},
      destroy(){stopped=true;observer.disconnect();button.removeEventListener('click',activate);button.remove();style.remove();delete globalThis.__agpaInlineReturn;}
    };
    place();return globalThis.__agpaInlineReturn.status();
  }
  async function isolated(code){
    if(!tracked)return null;
    return globalThis.electronNative.executeJavaScriptInIsolatedWorld(tracked.getWebContentsId(),WORLD,code);
  }
  async function inject(){
    if(destroyed||!tracked)return;
    if(busy){rerun=true;return;}busy=true;
    try{
      const url=new URL(tracked.getURL());
      if(url.origin!=='https://gemini.google.com'){installed=false;fallback.hidden=false;return;}
      const result=await isolated(`(${installInGuest.toString()})(${JSON.stringify({icon,signal,returnLabel:i18n.t('Return to Antigravity')})})`);
      installed=!!result?.installed;fallback.hidden=installed;
    }catch{installed=false;fallback.hidden=false;}
    finally{busy=false;if(rerun&&!destroyed){rerun=false;queueMicrotask(inject);}}
  }
  function track(){
    if(destroyed)return;
    const dialog=document.querySelector('[data-agpa-gemini]');
    const guest=dialog?.querySelector('webview');
    if(!dialog||!guest)return;
    if(fallback.parentElement!==dialog)dialog.append(fallback);
    if(tracked===guest)return;
    for(const remove of unbind)remove();unbind.length=0;
    tracked=guest;installed=false;fallback.hidden=false;
    const listen=(type,fn)=>{guest.addEventListener(type,fn);unbind.push(()=>guest.removeEventListener(type,fn));};
    listen('dom-ready',inject);listen('did-navigate',inject);listen('did-navigate-in-page',inject);
    listen('console-message',event=>{if(event.message===signal)returnToApp();});
    inject();
  }
  const observer=new MutationObserver(track);observer.observe(document.body,{subtree:true,childList:true});
  const untranslate=i18n.subscribe(inject);
  const api=globalThis.__AGGeminiInline={
    version:VERSION,
    status(){return{version:VERSION,toolbarRemoved:!!css.isConnected,guestButtonInstalled:installed,guestTracked:!!tracked};},
    async destroy(){destroyed=true;untranslate();observer.disconnect();for(const remove of unbind)remove();try{await isolated('globalThis.__agpaInlineReturn?.destroy()');}catch{}fallback.removeEventListener('click',returnToApp);fallback.remove();css.remove();if(globalThis.__AGGeminiInline===api)delete globalThis.__AGGeminiInline;}
  };
  track();
})();
