'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const valid=view=>['antigravity','gemini'].includes(view);
function createSessionStore(file){
 let lastView='antigravity',saved=false;
 return {
  async read(){
   try{const stat=await fs.stat(file);if(stat.size>1024)throw Error('Invalid session state');const data=JSON.parse(await fs.readFile(file,'utf8'));if(data.version!==1||!valid(data.lastView))throw Error('Invalid session state');lastView=data.lastView;saved=true;}
   catch(error){if(!['ENOENT'].includes(error.code)&&!(error instanceof SyntaxError)&&error.message!=='Invalid session state')throw error;}
   return lastView;
  },
  async record(view){
   if(!valid(view))throw Error('Unknown view.');
   if(saved&&view===lastView)return lastView;
   await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
   const temp=file+'.'+process.pid+'.tmp';
   try{const handle=await fs.open(temp,'w',0o600);try{await handle.writeFile(JSON.stringify({version:1,lastView:view})+'\n');await handle.sync();}finally{await handle.close();}await fs.rename(temp,file);}
   catch(error){await fs.rm(temp,{force:true}).catch(()=>{});throw error;}
   lastView=view;saved=true;return lastView;
  }
 };
}
module.exports={createSessionStore};
