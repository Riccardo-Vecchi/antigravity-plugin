"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {createBrowserPicker}=require("../common/browser-picker.cjs");
const {BROWSERS}=require("../common/browser-setup.cjs");

function fixture() {
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.attributes=new Map();this.events={};this.style={};this.dataset={};this.open=false;}
    setAttribute(k,v){this.attributes.set(k,String(v));}
    getAttribute(k){return this.attributes.get(k);}
    removeAttribute(k){this.attributes.delete(k);}
    toggleAttribute(k,v){v?this.setAttribute(k,""):this.removeAttribute(k);}
    append(...children){this.children.push(...children);}
    addEventListener(k,fn){this.events[k]=fn;}
    matches(){return this.open;}
    showPopover(){this.open=true;this.events.toggle?.({newState:"open"});}
    hidePopover(){this.open=false;this.events.toggle?.({newState:"closed"});}
    getBoundingClientRect(){return {left:400,top:100,bottom:140,width:210};}
    scrollIntoView(){}
    focus(){this.focused=true;}
  }
  const changes=[],items=[{id:"brave",label:"Brave"},{id:"chrome",label:"Chrome"},{id:"other",label:"Other Chromium browser"}];
  const fn=vm.runInNewContext("("+createBrowserPicker.toString()+")",{document:{createElement:tag=>new Element(tag)},crypto:{randomUUID:()=>"fixture"},window:{innerWidth:1000,innerHeight:700}});
  const root=fn({items,value:"brave",icons:{brave:"data:image/png;base64,brave",chrome:"data:image/png;base64,chrome"},label:"Your browser",onChange:value=>changes.push(value)});
  const [trigger,list]=root.children;
  function key(key){const event={key,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};trigger.events.keydown(event);return event;}
  return {trigger,list,changes,key};
}
test("official icons accompany the selected browser and each detected option; other browsers get a neutral symbol",()=>{
  const f=fixture();
  assert.equal(f.trigger.children[0].tagName,"img");
  assert.equal(f.trigger.children[0].src,"data:image/png;base64,brave");
  assert.deepEqual(f.list.children.map(row=>row.children[0].tagName),["img","img","span"]);
  f.trigger.disabled=true;f.list.children[1].events.click();assert.deepEqual(f.changes,[]);
  f.trigger.disabled=false;f.list.children[1].events.click();assert.deepEqual(f.changes,["chrome"]);assert.equal(f.trigger.focused,true);
});
test("keyboard navigation commits only on selection, closes on Escape/Tab and keeps focus on the combobox",()=>{
  const f=fixture();f.key("ArrowDown");assert.equal(f.list.open,true);
  f.key("ArrowDown");assert.deepEqual(f.changes,[]);assert.match(f.trigger.getAttribute("aria-activedescendant"),/-1$/);
  f.key("Enter");assert.deepEqual(f.changes,["chrome"]);assert.equal(f.list.open,false);assert.equal(f.trigger.getAttribute("aria-expanded"),"false");
  f.key("End");assert.match(f.trigger.getAttribute("aria-activedescendant"),/-2$/);
  const escape=f.key("Escape");assert.equal(escape.prevented,true);assert.equal(escape.stopped,true);assert.equal(f.list.open,false);
  f.key("Home");assert.match(f.trigger.getAttribute("aria-activedescendant"),/-0$/);
  const tab=f.key("Tab");assert.equal(tab.prevented,undefined);assert.equal(f.list.open,false);
});
test("typing locates a browser without changing the selection; native outside dismissal clears expansion",()=>{
  const f=fixture();f.key("c");assert.match(f.trigger.getAttribute("aria-activedescendant"),/-1$/);
  assert.deepEqual(f.changes,[]);f.list.hidePopover();assert.equal(f.trigger.getAttribute("aria-expanded"),"false");
  assert.equal(f.trigger.getAttribute("aria-activedescendant"),undefined);
});
test("every detected browser has a bundled PNG in both platform payloads",()=>{
  const distribution=require("../common/distribution.json");
  for(const {id}of BROWSERS){
    const source="assets/browsers/"+id+".png";
    assert.ok(distribution.common.includes(source),source);
    const bytes=fs.readFileSync(path.join(__dirname,"..",source));
    assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.ok(bytes.readUInt32BE(16)>=40 && bytes.readUInt32BE(20)>=40);
  }
});
