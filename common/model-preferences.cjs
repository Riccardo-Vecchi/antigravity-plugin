'use strict';
const fs=require('node:fs/promises');
const {atomic}=require('./computer-use.cjs');
function validName(value){return typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);}
function validEffort(value){return typeof value==='string'&&/^[a-z][a-z0-9_-]{0,31}$/.test(value);}
function validateOrder(order) {
 if (!Array.isArray(order) || order.length > 500 || !order.every(validName) || new Set(order).size !== order.length) {
  throw Error('Invalid model order.');
 }
 return order;
}
function validate(data){
 if(data?.version!==1||!data.models||typeof data.models!=='object'||Array.isArray(data.models)||Object.keys(data.models).length>500)throw Error('Invalid model preferences.');
 const models={}, usedShortcuts=new Set();
 for(const [name,value]of Object.entries(data.models)){
  if(!validName(name)||!value||typeof value!=='object'||typeof value.favorite!=='boolean'||typeof value.hidden!=='boolean')throw Error('Invalid model preference.');
  if(value.effort!==undefined&&!validEffort(value.effort))throw Error('Invalid model effort.');
  if(value.shortcut!==undefined){
   if(typeof value.shortcut!=='string'||!/^Ctrl\+Alt\+[A-Z]$/.test(value.shortcut)||usedShortcuts.has(value.shortcut))throw Error('Invalid or duplicate model shortcut.');
   usedShortcuts.add(value.shortcut);
  }
  if(value.favorite||value.hidden||value.effort||value.shortcut)models[name]={favorite:value.favorite,hidden:value.hidden,...(value.effort?{effort:value.effort}:{}),...(value.shortcut?{shortcut:value.shortcut}:{})};
 }
 const order = validateOrder(data.order === undefined ? [] : data.order);
 const result = {version:1,models};
 if (order.length) result.order = order;
 if (data.seenAnnouncements !== undefined) result.seenAnnouncements = validateOrder(data.seenAnnouncements);
 return result;
}
function providerFor(name){if(/^\s*(?:Claude|Anthropic)\b/i.test(name))return 'anthropic';if(/^\s*(?:Gemini|Google|Orchestrator)\b/i.test(name))return 'google';if(/^\s*(?:GPT|OpenAI|o[134](?:\b|-))/i.test(name))return 'openai';return null;}
function permissionFor(name){
 const key=String(name).trim().toLowerCase();
 if(/^(request review|richiedi revisione|revisione richiesta|prüfung anfordern|solicitar revisión|demander une révision|请求审核|レビューを要求)$/.test(key))return 'review';
 if(/^(default|predefinito|standard|predeterminado|par défaut|默认|デフォルト)$/.test(key))return 'default';
 if(/^(auto|automatico|automatisch|automático|automatique|自动|自動)(\b|\s|\(|$)/i.test(key))return 'auto';
 return /^(turbo|极速|ターボ)$/.test(key)?'turbo':null;
}
function createStore(file){
 let current={version:1,models:{}};
 async function read(){let text;try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>200000)throw Error('Invalid model preferences file.');text=await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;text='';}return {text,data:text?validate(JSON.parse(text)):{version:1,models:{}}};}
 return {
  current:()=>current,
  async load(){current=(await read()).data;return current;},
  async update({name,field,value}){
   const previous = await read();
   const next = {...previous.data, models:{...previous.data.models}};
   if (field === 'seenAnnouncements') {
    validateOrder(value);
    next.seenAnnouncements = [...new Set([...(next.seenAnnouncements || []), ...value])].slice(-500);
   } else if (field === 'order') {
    validateOrder(value);
    const visible = new Set(value);
    let index = 0;
    // Refill visible slots in order, preserving the positions of temporarily absent models.
    const merged = (next.order || []).map(name => visible.has(name) ? value[index++] : name);
    next.order = value.length ? [...merged, ...value.slice(index)] : [];
   } else {
    if(!validName(name)||!['favorite','hidden','effort','shortcut'].includes(field))throw Error('Invalid model change.');
    if(field==='effort'&&!validEffort(value))throw Error('Invalid model effort.');
    if((field==='favorite'||field==='hidden')&&typeof value!=='boolean')throw Error('Invalid model change.');
    const choice={favorite:false,hidden:false,...next.models[name],[field]:value};
    if(field==='shortcut'){
     if(value===null)delete choice.shortcut;
     else if(typeof value!=='string'||!/^Ctrl\+Alt\+[A-Z]$/.test(value))throw Error('Invalid model shortcut.');
    }
    if(choice.favorite||choice.hidden||choice.effort||choice.shortcut)next.models[name]=choice;else delete next.models[name];
   }
   const normalized = validate(next);
   const text = JSON.stringify(normalized,null,2)+'\n';
   if (Buffer.byteLength(text) > 200000) throw Error('Model preferences file is too large.');
   await atomic(file,text,previous.text);
   current=normalized;
   return current;
  },
 };
}
module.exports={validate,providerFor,permissionFor,createStore};
