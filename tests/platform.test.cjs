'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {getPaths}=require('../platform-paths.cjs');const {loopbackSocket}=require('../cdp-connection.cjs');
test('Linux profile and installation defaults remain unchanged',()=>{
 const p=getPaths({platform:'linux',env:{},home:'/home/test'});assert.equal(p.configDir,'/home/test/.config/antigravity-project-appearance');assert.equal(p.profileDir,'/home/test/.config/Antigravity');assert.equal(p.defaultExecutable,'/home/test/.local/opt/Antigravity.AppImage');
});
test('Windows uses the roaming profile and local installation, including Unicode and spaces',()=>{
 const p=getPaths({platform:'win32',home:'C:\\Users\\Example Name',env:{APPDATA:'D:\\Profiles\\例\\Roaming',LOCALAPPDATA:'D:\\Profiles\\例\\Local'}});
 assert.equal(p.configDir,'D:\\Profiles\\例\\Roaming\\antigravity-project-appearance');assert.equal(p.profileDir,'D:\\Profiles\\例\\Roaming\\Antigravity');assert.equal(p.defaultExecutable,'D:\\Profiles\\例\\Local\\Programs\\Antigravity\\Antigravity.exe');
 assert.equal(getPaths({platform:'win32',home:'C:\\Users\\Test',env:{AGPA_APP_PROFILE:'D:\\Custom Profile'}}).profileDir,'D:\\Custom Profile');assert.throws(()=>getPaths({platform:'darwin',env:{},home:'/tmp'}));
});
test('the native inspector accepts only an explicit local loopback websocket',()=>{
 assert.equal(loopbackSocket('ws://127.0.0.1:12345/inspector'),'ws://127.0.0.1:12345/inspector');
 for(const value of ['ws://0.0.0.0:12345/x','ws://example.com:12345/x','wss://127.0.0.1:12345/x','ws://user:pass@127.0.0.1:12345/x','ws://127.0.0.1:0/x'])assert.throws(()=>loopbackSocket(value));
});
