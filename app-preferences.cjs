'use strict';
function validate(data){
 if(!data||![1,2].includes(data.version)||!['antigravity','gemini','dynamic'].includes(data.taskbarIcon))throw Error('Unsupported application icon preference.');
 const startupView=data.version===1?'antigravity':data.startupView;
 if(!['antigravity','gemini','last'].includes(startupView))throw Error('Unsupported startup view.');
 if(data.autostart!==undefined&&typeof data.autostart!=='boolean')throw Error('Invalid autostart preference.');
 return {version:2,taskbarIcon:data.taskbarIcon,startupView,autostart:data.autostart??false};
}
module.exports={validate};
