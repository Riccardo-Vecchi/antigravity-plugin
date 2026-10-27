'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('../common/desktop-icon.cjs');
test('legacy fixed icon migrates without enabling autostart or changing startup view',()=>{
 assert.deepEqual(validate({version:1,taskbarIcon:'gemini'}),{version:2,taskbarIcon:'gemini',startupView:'antigravity',autostart:false,toggleShortcut:'Ctrl+Alt+G'});
});
test('icon mode and startup view are independent preferences',()=>{
 assert.deepEqual(validate({version:2,taskbarIcon:'dynamic',startupView:'gemini',autostart:true}),{version:2,taskbarIcon:'dynamic',startupView:'gemini',autostart:true,toggleShortcut:'Ctrl+Alt+G'});
 assert.equal(validate({version:2,taskbarIcon:'antigravity',startupView:'gemini'}).startupView,'gemini');
});
test('unknown values and non-boolean autostart are rejected',()=>{
 for(const patch of [{version:9},{taskbarIcon:'other'},{startupView:'other'},{autostart:'true'}])
  assert.throws(()=>validate({version:2,taskbarIcon:'dynamic',startupView:'gemini',autostart:false,...patch}));
});

test('remember-last startup remains independent from icon and autostart preferences',()=>{
 assert.deepEqual(validate({version:2,taskbarIcon:'gemini',startupView:'last',autostart:false}),{version:2,taskbarIcon:'gemini',startupView:'last',autostart:false,toggleShortcut:'Ctrl+Alt+G'});
});
