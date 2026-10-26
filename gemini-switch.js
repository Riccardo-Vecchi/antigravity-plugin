/* Same-window Gemini guest. The native Antigravity page stays mounted. */
(() => {
  'use strict';
  const VERSION='1.2.0';
  const icons=globalThis.__AGPA_SWITCH_ASSETS__;
  delete globalThis.__AGPA_SWITCH_ASSETS__;
  if(globalThis.__AGGeminiSwitch?.version===VERSION)return;
  globalThis.__AGGeminiSwitch?.destroy();
  if(!icons?.gemini||!icons?.antigravity)return;
  const GEMINI='https://gemini.google.com/';
  const PARTITION='persist:agpa-gemini';
  let destroyed=false,button=null,dialog=null,guest=null,ready=false,opener=null,lastURL=GEMINI,lastError=null;
  let statusText=null,originText=null,back=null,forward=null,reload=null;
  const listeners=[];
  function el(tag,attrs={},...children){
    const n=document.createElement(tag);
    for(const [k,v]of Object.entries(attrs)){if(k==='text')n.textContent=v;else n.setAttribute(k,v);}
    for(const c of children)if(c)n.append(c);
    return n;
  }
  function icon(name){return el('img',{src:icons[name],alt:'',width:'20',height:'20',draggable:'false'});}
  function listen(node,event,fn){node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));}
  const styles=el('style',{id:'agpa-gemini-styles',text:`
    .agpa-app-switch {display:inline-flex;align-items:center;justify-content:center;gap:6px;flex-shrink:0;height:30px;padding:0 11px;border:1px solid transparent;border-radius:999px;background:var(--secondary,#202020);color:var(--foreground,#eee);font:500 13px system-ui,sans-serif;cursor:pointer;-webkit-app-region:no-drag;white-space:nowrap}
    .agpa-app-switch:hover {filter:brightness(1.2);border-color:var(--border,#444)}
    .agpa-app-switch img {width:20px;height:20px;object-fit:contain;flex-shrink:0}
    .agpa-app-switch:focus-visible,.agpa-gemini-tool:focus-visible {outline:2px solid #398bdb;outline-offset:2px}
    .agpa-gemini {position:fixed;box-sizing:border-box;inset:35px 0 0;width:100vw;height:calc(100vh - 35px);max-width:none;max-height:none;margin:0;padding:0;border:0;background:var(--background,#111);color:var(--foreground,#eee);overflow:hidden;outline:none;font:13px system-ui,sans-serif}
    .agpa-gemini[open] {display:flex;flex-direction:column}
    .agpa-gemini:not([open]) {display:none!important}
    .agpa-gemini::backdrop {background:transparent}
    .agpa-gemini-bar {height:44px;min-height:44px;display:flex;align-items:center;gap:7px;padding:0 12px;border-bottom:1px solid var(--border,#303030);background:var(--background,#111)}
    .agpa-gemini-origin {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted-foreground,#aaa);margin-left:5px;font-size:12px}
    .agpa-gemini-state {flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted-foreground,#aaa);font-size:12px;text-align:right;margin-right:8px}
    .agpa-gemini-tool {width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;font:18px system-ui,sans-serif}
    .agpa-gemini-tool:hover {background:var(--secondary,#333)}
    .agpa-gemini-tool:disabled {opacity:.35;cursor:default}
    .agpa-gemini webview {display:flex;flex:1;min-height:0;width:100%;background:#111}
    @media(max-width:650px){.agpa-gemini-state{display:none}.agpa-gemini-origin{flex:1}.agpa-gemini-bar{padding:0 8px;gap:4px}}
  `});
  document.head.append(styles);
  function applyButton(){
    if(destroyed)return;
    const anchor=document.querySelector('[data-testid="titlebar-more-actions"]');
    if(!anchor)return;
    if(!button){
      button=el('button',{type:'button',class:'agpa-app-switch','data-agpa-open-gemini':'','aria-label':'Open Gemini in this window',title:'Gemini'},icon('gemini'),el('span',{text:'Gemini'}));
      listen(button,'click',open);
    }
    if(button.parentElement!==anchor.parentElement)anchor.before(button);
  }
  function update(){
    if(!guest||!ready)return;
    try{
      lastURL=guest.getURL()||GEMINI;
      const u=new URL(lastURL);
      originText.textContent=u.protocol==='https:'?u.hostname:'Gemini';
      originText.title=u.origin;
      back.disabled=!guest.canGoBack();forward.disabled=!guest.canGoForward();
    }catch{}
  }
  function hide(){
    if(!dialog?.open)return;
    dialog.close();
    // Do not remove the guest: its page, draft, and session survive switching.
    if(opener?.isConnected)opener.focus();else button?.focus();
  }
  function create(){
    dialog=el('dialog',{class:'agpa-gemini','aria-label':'Gemini web','data-agpa-gemini':''});
    const bar=el('div',{class:'agpa-gemini-bar'});
    back=el('button',{type:'button',class:'agpa-gemini-tool','aria-label':'Back',title:'Back',text:'‹',disabled:''});
    forward=el('button',{type:'button',class:'agpa-gemini-tool','aria-label':'Forward',title:'Forward',text:'›',disabled:''});
    reload=el('button',{type:'button',class:'agpa-gemini-tool','aria-label':'Reload Gemini',title:'Reload',text:'↻'});
    originText=el('span',{class:'agpa-gemini-origin',text:'gemini.google.com'});
    statusText=el('span',{class:'agpa-gemini-state',role:'status','aria-live':'polite',text:'Loading…'});
    const external=el('button',{type:'button',class:'agpa-gemini-tool','aria-label':'Open Gemini in external browser',title:'Open Gemini in browser',text:'↗'});
    const returnButton=el('button',{type:'button',class:'agpa-app-switch','data-agpa-return-antigravity':'','aria-label':'Return to Antigravity',title:'Return to Antigravity'},icon('antigravity'),el('span',{text:'Antigravity'}));
    bar.append(back,forward,reload,originText,statusText,external,returnButton);
    guest=el('webview',{partition:PARTITION,webpreferences:'nodeIntegration=no,contextIsolation=yes,sandbox=yes,webSecurity=yes,allowRunningInsecureContent=no','aria-label':'Google Gemini website'});
    // No preload, Node integration, popups, browser profile import, or page injection.
    listen(guest,'dom-ready',()=>{ready=true;lastError=null;update();});
    listen(guest,'did-start-loading',()=>{statusText.textContent='Loading…';});
    listen(guest,'did-stop-loading',()=>{statusText.textContent=lastError||'';update();});
    listen(guest,'did-navigate',update);listen(guest,'did-navigate-in-page',update);
    listen(guest,'did-fail-load',event=>{
      if(!event.isMainFrame||event.errorCode===-3)return;
      lastError=`Could not load Gemini (${event.errorCode}). Try Reload or open in browser.`;
      statusText.textContent=lastError;
    });
    listen(guest,'render-process-gone',()=>{ready=false;statusText.textContent='Gemini stopped. Return to Antigravity and reopen Gemini.';guest.remove();guest=null;});
    for(const event of ['will-navigate','will-redirect'])listen(guest,event,e=>{
      try{if(new URL(e.url).protocol!=='https:')e.preventDefault();}catch{e.preventDefault();}
    });
    listen(back,'click',()=>{if(ready&&guest?.canGoBack())guest.goBack();});
    listen(forward,'click',()=>{if(ready&&guest?.canGoForward())guest.goForward();});
    listen(reload,'click',()=>{if(guest){lastError=null;guest.reload();}});
    listen(external,'click',()=>globalThis.electronNative?.openExternal(GEMINI));
    listen(returnButton,'click',hide);
    listen(dialog,'cancel',e=>{e.preventDefault();hide();});
    dialog.append(bar,guest);document.body.append(dialog);
    guest.src=GEMINI;
  }
  function open(){
    if(destroyed)return;
    opener=document.activeElement;
    if(!dialog||!guest){dialog?.remove();create();}
    if(!dialog.open)dialog.showModal();
    update();
  }
  const observer=new MutationObserver(applyButton);
  observer.observe(document.body,{subtree:true,childList:true});
  globalThis.__AGGeminiSwitch={
    version:VERSION,
    status(){return{version:VERSION,buttonInstalled:!!button?.isConnected,visible:!!dialog?.open,guestCreated:!!guest,ready,origin:(()=>{try{return new URL(lastURL).origin;}catch{return null;}})(),partition:PARTITION,error:lastError};},
    destroy(){destroyed=true;observer.disconnect();for(const remove of listeners)remove();hide();dialog?.remove();button?.remove();styles.remove();delete globalThis.__AGGeminiSwitch;}
  };
  applyButton();
})();
