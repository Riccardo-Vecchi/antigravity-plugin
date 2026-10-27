'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const catalogs=require('../common/locales.json');
const script=fs.readFileSync(path.join(__dirname,'../common/i18n.js'),'utf8');
function element(){const attributes=new Map();return {textContent:'',value:'unsaved input',getAttribute:key=>attributes.get(key)??null,setAttribute:(key,value)=>attributes.set(key,value)};}
async function fixture(lang='en',browser='de-DE'){
 const html=element();if(lang!==null)html.setAttribute('lang',lang);
 const callbacks=[];
 const context={__AGPA_TRANSLATIONS__:catalogs,document:{documentElement:html,body:element(),querySelectorAll:()=>[]},navigator:{language:browser},queueMicrotask,WeakRef,MutationObserver:class{constructor(fn){callbacks.push(fn)}observe(){}disconnect(){}},window:{addEventListener(){},removeEventListener(){}}};
 vm.createContext(context);vm.runInContext(script,context);
 return {api:context.__AGPAI18n,async language(value){html.setAttribute('lang',value);callbacks[0]();await new Promise(setImmediate)}};
}
test('every supported language has all interface strings, icon names and matching placeholders',()=>{
 assert.deepEqual(Object.keys(catalogs).sort(),['de','en','es','fr','it','ja','zh']);
 for(const [language,catalog]of Object.entries(catalogs)){
  assert.deepEqual(Object.keys(catalog.strings).sort(),Object.keys(catalogs.en.strings).sort(),language);
  assert.deepEqual(Object.keys(catalog.icons).sort(),Object.keys(catalogs.en.icons).sort(),language);
  for(const [key,value]of Object.entries(catalog.strings)){
   assert.ok(value.trim(),`${language}: ${key}`);
   assert.deepEqual(value.match(/\{\w+\}/g)?.sort()||[],key.match(/\{\w+\}/g)?.sort()||[],`${language}: ${key}`);
  }
 }
});
test('app language takes priority over browser language, and unsupported languages fall back to English',async()=>{
 const f=await fixture('it-IT','de-DE');assert.equal(f.api.t('Save'),'Salva');
 await f.language('fr_CA');assert.equal(f.api.t('Save'),'Enregistrer');
 await f.language('zh-Hans-CN');assert.equal(f.api.t('Save'),'保存');
 await f.language('ja-JP');assert.equal(f.api.t('Save'),'保存');
 await f.language('pt-BR');assert.equal(f.api.t('Save'),'Save');
 assert.equal((await fixture(null,'es-ES')).api.t('Save'),'Guardar');
});
test('a language change updates open controls and attributes without replacing inputs or losing their draft',async()=>{
 const f=await fixture();const heading=element(),search=element(),status=element();
 f.api.set(heading,'Edit project');f.api.attrs(search,{placeholder:'Search icons','aria-label':'Search icons'});
 f.api.set(status,'Could not load Gemini ({code}). Try Reload or open in browser.',{code:-105});
 await f.language('it');assert.equal(heading.textContent,'Modifica progetto');assert.equal(search.getAttribute('placeholder'),'Cerca icone');assert.equal(search.value,'unsaved input');assert.match(status.textContent,/\(-105\)/);
 await f.language('de');assert.equal(heading.textContent,'Projekt bearbeiten');assert.equal(search.getAttribute('aria-label'),'Symbole suchen');
});
test('icon tooltips and search names follow the language and retain stable identifiers',async()=>{
 const f=await fixture('en');const icon=element();
 f.api.set(icon,'Icon {name}',{name:()=>f.api.iconName('folder')},'aria-label');
 await f.language('fr');assert.equal(icon.getAttribute('aria-label'),'Icône Dossier');assert.equal(f.api.iconName('folder'),'Dossier');
 await f.language('ja');assert.equal(f.api.iconName('folder'),'フォルダー');
});
test('refreshing catalogs after a helper update keeps the live translator and input state',async()=>{
 const f=await fixture('it'),button=element();f.api.set(button,'Save');
 const next=JSON.parse(JSON.stringify(catalogs));next.it.strings.Save='Salva aggiornato';f.api.setCatalogs(next);
 assert.equal(button.textContent,'Salva aggiornato');assert.equal(button.value,'unsaved input');await f.language('de');assert.equal(button.textContent,'Speichern');
});
