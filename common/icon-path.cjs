'use strict';
const fs=require('node:fs'),path=require('node:path');
function iconPath(name){
 if(!/^[a-z0-9-]+\.(png|ico)$/.test(name))throw Error('Invalid icon filename.');
 const root=path.dirname(__dirname),source=path.join(root,'assets','icons');
 return path.join(fs.existsSync(source)?source:path.join(root,'icons'),name);
}
module.exports={iconPath};
