'use strict';
const fs=require('node:fs'),path=require('node:path'),catalogs=require('../common/locales.json');
const messages={connected:'Connected to Antigravity',notConnected:'Not connected',connectHelp:'Open Antigravity → Settings → Browser use to connect.',reconnect:'Reconnect',sharingTitle:'Share with Antigravity',selectedTabs:'Selected tabs',selectedHelp:'Only the tabs you choose.',allTabs:'All tabs in this profile',profileHelp:'Includes current and new web tabs until you stop sharing or disconnect.',shareTab:'Share this tab',stopTab:'Stop sharing this tab',openPage:'Open a web page, then click this extension to share it.',stopAll:'Stop sharing all tabs',privacy:'Private tabs, browser settings and password fields are excluded.',profileSettings:'Profile settings',profileName:'Profile name',save:'Save',sharedTabs:'{count} shared tabs',tabNumber:'Tab {id}',stop:'Stop',privateExcluded:'Private browsing tabs are excluded.',chooseName:'Choose a profile name.',allowTabs:'Allow access to all tabs in your browser first.',operationError:'Could not connect. Open Antigravity and try again.'};
for(const [folder,lang]of Object.entries({en:'en',it:'it',de:'de',es:'es',fr:'fr',zh_CN:'zh',ja:'ja'})){
 const file=path.join(__dirname,'../common/browser-extension/_locales',folder,'messages.json'),data=JSON.parse(fs.readFileSync(file));
 for(const [key,text]of Object.entries(messages)){
  const value=catalogs[lang].strings[text];if(!value)throw Error('Missing extension translation: '+lang+': '+text);
  const names=[];const message=value.replace(/\{(\w+)\}/g,(_,name)=>{names.push(name);return '$'+name.toUpperCase()+'$';});
  data[key]={message,...(names.length?{placeholders:Object.fromEntries(names.map((name,i)=>[name.toUpperCase(),{content:'$'+(i+1)}]))}:{})};
 }
 fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
}
