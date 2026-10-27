'use strict';
function loopbackSocket(value){
 const url=new URL(value);
 if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||!url.port||Number(url.port)<1||Number(url.port)>65535||url.username||url.password)throw Error('Invalid local inspector endpoint.');
 return url.href;
}
async function connect(value){
 const socket=new WebSocket(loopbackSocket(value));
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(Error('Local inspector timed out.'));},5000);socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=()=>{clearTimeout(timer);reject(Error('Local inspector unavailable.'));};});
 let id=0;const pending=new Map();
 const rejectAll=()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Local inspector disconnected.'));}pending.clear();};
 socket.onclose=rejectAll;
 socket.onmessage=event=>{let data;try{data=JSON.parse(event.data);}catch{return;}const request=pending.get(data.id);if(!request)return;pending.delete(data.id);clearTimeout(request.timer);data.error?request.reject(Error(data.error.message)):request.resolve(data.result);};
 return {call(method,params={}){return new Promise((resolve,reject)=>{const requestId=++id;const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Local inspector request timed out.'));},6000);pending.set(requestId,{resolve,reject,timer});socket.send(JSON.stringify({id:requestId,method,params}));});},close(){rejectAll();socket.close();}};
}
module.exports={loopbackSocket,connect};
