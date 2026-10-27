'use strict';
module.exports=require(process.platform==='win32'?'./desktop-windows.cjs':'./desktop-linux.cjs');
