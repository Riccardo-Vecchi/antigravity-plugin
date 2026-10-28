'use strict';
const $=id=>document.getElementById(id),t=(key,values)=>chrome.i18n.getMessage(key,values)||key;
for(const e of document.querySelectorAll('[data-i18n]'))e.textContent=t(e.dataset.i18n);
$('name').setAttribute('aria-label',t('profileName'));
let busy=false,latest={},dirty=false,signature='',requestedScope=null;
async function request(action,extra={}){const result=await chrome.runtime.sendMessage({action,...extra});if(!result?.ok)throw Error(result?.error||'Extension unavailable.');return result.result;}
function controls(){
 const locked=busy||requestedScope!==null;
 for(const b of document.querySelectorAll('button,input[type=radio]'))b.disabled=locked;
 for(const radio of document.querySelectorAll('[name=scope]')){radio.checked=radio.value===(requestedScope||latest.scope||'tabs');radio.disabled=locked||!latest.ready;}
 $('share').hidden=latest.scope==='profile';$('share').textContent=t(latest.current?.shared?'stopTab':'shareTab');$('share').disabled=locked||!latest.ready||!latest.current;
 $('tabHint').hidden=latest.scope==='profile'||!!latest.current;
 $('save').disabled=locked||!dirty||!$('name').value.trim();
 $('stop').hidden=!latest.shared?.length&&latest.scope!=='profile';
 document.body.setAttribute('aria-busy',String(locked));
}
function render(state){
 latest=state;$('status').textContent=t(state.ready?'connected':'notConnected');$('status').dataset.ready=String(!!state.ready);
 $('disconnected').hidden=!!state.ready;$('access').hidden=!state.ready;
 if(!dirty)$('name').value=state.profile?.label||'';
 $('shared').hidden=!state.shared?.length;$('sharedCount').textContent=t('sharedTabs',[String(state.shared?.length||0)]);
 const next=JSON.stringify(state.shared);
 if(signature!==next){signature=next;$('tabs').replaceChildren();for(const tab of state.shared||[]){const row=document.createElement('li'),label=document.createElement('span'),stop=document.createElement('button');label.textContent=tab.title||t('tabNumber',[String(tab.id)]);label.title=label.textContent;stop.textContent=t('stop');stop.onclick=()=>act('revoke',{tab:tab.id});row.append(label,stop);$('tabs').append(row);}}
 controls();
}
const errorKeys={'Open Antigravity and enable Browser use in Settings.':'connectHelp','Open a regular web page to share it.':'openPage','Private browsing tabs are excluded.':'privateExcluded','Choose a profile name.':'chooseName','Allow access to all tabs in your browser first.':'allowTabs'};
async function act(action,extra){
 if(busy)return;busy=true;$('error').textContent='';controls();
 try{const result=await request(action,extra);if(action==='label')dirty=false;render(result);}
 catch(e){$('error').textContent=errorKeys[e.message]?t(errorKeys[e.message]):t('operationError');try{render(await request('status'));}catch{}}
 finally{busy=false;controls();}
}
$('share').onclick=()=>latest.current?.shared?act('revoke',{tab:latest.current.id}):act('share');
for(const radio of document.querySelectorAll('[name=scope]'))radio.onchange=async()=>{
 if(!radio.checked||busy||requestedScope!==null)return;
 requestedScope=radio.value;controls();
 try{
  if(radio.value==='profile'&&!await chrome.permissions.request({permissions:['tabs']})){$('error').textContent=t('allowTabs');return;}
  await act('scope',{scope:radio.value});
 }catch{$('error').textContent=t('allowTabs');}
 finally{requestedScope=null;controls();}
};
$('connect').onclick=()=>act('connect');$('stop').onclick=()=>act('revokeAll');$('save').onclick=()=>act('label',{label:$('name').value});
$('name').oninput=()=>{dirty=$('name').value!==(latest.profile?.label||'');controls();};
setInterval(()=>{if(!busy)request('status').then(render).catch(()=>{});},1500);
request('status').then(render).catch(()=>{$('error').textContent=t('operationError');});
