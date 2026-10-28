'use strict';
const BROWSERS=Object.freeze([
 {id:'brave',label:'Brave',url:'brave://extensions',linux:['brave-browser','brave'],windows:['BraveSoftware/Brave-Browser/Application/brave.exe']},
 {id:'chrome',label:'Chrome',url:'chrome://extensions',linux:['google-chrome-stable','google-chrome'],windows:['Google/Chrome/Application/chrome.exe']},
 {id:'edge',label:'Edge',url:'edge://extensions',linux:['microsoft-edge-stable','microsoft-edge'],windows:['Microsoft/Edge/Application/msedge.exe']},
 {id:'vivaldi',label:'Vivaldi',url:'vivaldi://extensions',linux:['vivaldi-stable','vivaldi'],windows:['Vivaldi/Application/vivaldi.exe']},
 {id:'opera',label:'Opera',url:'opera://extensions',linux:['opera'],windows:['Programs/Opera/opera.exe','Opera/opera.exe']},
 {id:'chromium',label:'Chromium',url:'chrome://extensions',linux:['chromium','chromium-browser'],windows:['Chromium/Application/chrome.exe']},
]);
function setupState(browser){
 const prepared=browser.enabled&&browser.registered,connected=browser.connections?.length>0,shared=browser.connections?.some(c=>c.tabs>0);
 return !prepared?'prepare':!connected?'install':!shared?'share':'ready';
}
module.exports={BROWSERS,setupState};
