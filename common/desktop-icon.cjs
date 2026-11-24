'use strict';
module.exports=require(process.platform==='win32'?'../windows/desktop.cjs':process.platform==='darwin'?'../macos/desktop.cjs':'../linux/desktop.cjs');
