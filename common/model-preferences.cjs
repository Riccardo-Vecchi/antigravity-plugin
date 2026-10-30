'use strict';
const fs=require('node:fs/promises');
const {atomic}=require('./computer-use.cjs');
function validName(value){return typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value);}
function validEffort(value){return typeof value==='string'&&/^[a-z][a-z0-9_-]{0,31}$/.test(value);}
function validate(data){
 if(data?.version!==1||!data.models||typeof data.models!=='object'||Array.isArray(data.models)||Object.keys(data.models).length>500)throw Error('Invalid model preferences.');
 const models={};
 for(const [name,value]of Object.entries(data.models)){
  if(!validName(name)||!value||typeof value!=='object'||typeof value.favorite!=='boolean'||typeof value.hidden!=='boolean')throw Error('Invalid model preference.');
  if(value.effort!==undefined&&!validEffort(value.effort))throw Error('Invalid model effort.');
  if(value.favorite||value.hidden||value.effort)models[name]={favorite:value.favorite,hidden:value.hidden,...(value.effort?{effort:value.effort}:{})};
 }
 return {version:1,models};
}
function providerFor(name){if(/^\s*(?:Claude|Anthropic)\b/i.test(name))return 'anthropic';if(/^\s*(?:Gemini|Google)\b/i.test(name))return 'google';if(/^\s*(?:GPT|OpenAI|o[134](?:\b|-))/i.test(name))return 'openai';return null;}
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
   if(!validName(name)||!['favorite','hidden','effort'].includes(field)||(field==='effort'?!validEffort(value):typeof value!=='boolean'))throw Error('Invalid model change.');
   const previous=await read(),next={version:1,models:{...previous.data.models}};
   const choice={favorite:false,hidden:false,...next.models[name],[field]:value};
   if(choice.favorite||choice.hidden||choice.effort)next.models[name]=choice;else delete next.models[name];
   const normalized=validate(next);await atomic(file,JSON.stringify(normalized,null,2)+'\n',previous.text);current=normalized;return current;
  },
 };
}
module.exports={validate,providerFor,permissionFor,createStore};
