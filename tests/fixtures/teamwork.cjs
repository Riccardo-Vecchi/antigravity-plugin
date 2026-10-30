'use strict';
function setup() {
  const footer=document.querySelector('.fixture-footer'), root=document.createElement('div');root.className='surface-composer';footer.before(root);root.append(footer);
  const editor=document.createElement('div');editor.setAttribute('contenteditable','true');editor.setAttribute('role','combobox');editor.dataset.lexicalEditor='true';root.prepend(editor);
  let available=true,sends=0,nativeDefinitions=0;
  function chip(){const outer=document.createElement('span');outer.dataset.lexicalDecorator='true';outer.setAttribute('contenteditable','false');const inner=document.createElement('span');inner.dataset.uri='slashCommand:teamwork';inner.textContent='teamwork';outer.append(inner);return outer;}
  function addManual(){editor.prepend(chip(),document.createTextNode(' '));}
  function body(){editor.innerHTML='<p>Keep this draft <span data-lexical-decorator="true" contenteditable="false"><span data-uri="file:/fixture/report.md">report.md</span></span> and its attachment.</p><p>Second paragraph.</p>';}
  editor.addEventListener('paste',event=>{
    if(event.clipboardData.getData('text/plain')!=='/teamwork')return;event.preventDefault();const selected=window.getSelection(),range=selected.getRangeAt(0);range.deleteContents();const text=document.createTextNode('/teamwork');range.insertNode(text);range.setStartAfter(text);range.collapse(true);selected.removeAllRanges();selected.addRange(range);
    if(!available)return;const menu=document.createElement('div');menu.dataset.mentionMenu='';const option=document.createElement('div');option.setAttribute('role','option');const label=document.createElement('div');label.textContent='teamwork';option.append(label);menu.append(option);root.append(menu);
    label.onclick=()=>{if(text.isConnected&&text.textContent==='/teamwork'){const command=chip();command.dataset.nativeDefinition='current';text.replaceWith(command);command.after(document.createTextNode(' '));nativeDefinitions++;}menu.remove();};
  });
  editor.addEventListener('cut',event=>{event.preventDefault();window.getSelection().getRangeAt(0).deleteContents();root.querySelector('[data-mention-menu]')?.remove();});
  document.querySelector('#send').onclick=()=>sends++;
  body();Object.assign(fixture,{editor,addManual,body,setAvailable:value=>available=value,removeManual:()=>editor.querySelectorAll('[data-uri="slashCommand:teamwork"]').forEach(n=>n.closest('[data-lexical-decorator]').remove()),getSends:()=>sends,getDefinitions:()=>nativeDefinitions});
}
async function verify(){
  const originalMatchMedia=window.matchMedia;window.matchMedia=()=>({matches:false});
  const passed=[],sleep=(ms=65)=>new Promise(resolve=>setTimeout(resolve,ms)),ok=(value,label)=>{if(!value)throw Error(label);passed.push(label);};
  const button=()=>document.querySelector('.agpa-effort-trigger'),range=()=>document.querySelector('.agpa-effort-popup input'),tokens=()=>fixture.editor.querySelectorAll('[data-uri="slashCommand:teamwork"]').length;
  const open=async()=>{button().click();await sleep(100);ok(!!range(),'effort popup opens with task modes');};
  const choose=async index=>{range().value=String(index);range().dispatchEvent(new Event('input',{bubbles:true}));range().dispatchEvent(new Event('change',{bubbles:true}));await sleep(260);};
  await sleep();const original=fixture.editor.textContent;
  await open();ok(range().max==='3','Ultra is a distinct step immediately after native High');
  range().value='3';range().dispatchEvent(new Event('input',{bubbles:true}));ok(document.querySelector('.agpa-effort-popup').hasAttribute('data-ultra')&&range().style.getPropertyValue('--effort-color')==='#a464f6','Ultra preview turns the bar violet');ok(tokens()===0,'Ultra preview does not insert or submit a command');
  await choose(3);ok(tokens()===1&&fixture.getDefinitions()===1&&fixture.selected.effort==='high','Ultra commits High and the current native Teamwork command');ok(fixture.editor.textContent.endsWith(original)&&!!fixture.editor.querySelector('[data-uri="file:/fixture/report.md"]'),'Teamwork insertion preserves draft paragraphs and other rich tokens');ok(button().hasAttribute('data-teamwork'),'Ultra state is visible on the closed selector');ok(fixture.preferences.models['Gemini Fixture'].effort==='high','only native High is remembered as reasoning effort');
  await open();ok(range().value==='3','opening the slider reflects active Teamwork');await choose(3);ok(tokens()===1&&fixture.getDefinitions()===1,'reselecting Ultra never duplicates the command');
  await open();await choose(0);ok(tokens()===0&&fixture.selected.effort==='low','a native level removes Teamwork and selects the native effort');ok(fixture.editor.textContent.trim()===original&&!!fixture.editor.querySelector('[data-uri="file:/fixture/report.md"]'),'removing Teamwork preserves the rest of the rich draft');
  fixture.addManual();await sleep();ok(button().hasAttribute('data-teamwork')&&fixture.selected.effort==='low','manual Teamwork updates Ultra without overriding native effort');ok([...document.querySelectorAll('.agpa-teamwork-burst')].some(node=>node.getAnimations().some(animation=>animation.playState==='running')),'activation burst is a running animation');fixture.removeManual();await sleep();ok(!button().hasAttribute('data-teamwork'),'removing manual Teamwork immediately restores the native effort label');
  fixture.addManual();await sleep();fixture.select('Fixed (Thinking)');await sleep();ok(!!button()&&button().hasAttribute('data-teamwork'),'manual Teamwork is visible on fixed-effort models too');await open();await choose(0);ok(!button()&&tokens()===0&&fixture.selected.base==='Fixed (Thinking)','leaving Teamwork on a fixed model preserves native model selection');
  fixture.select('Gemini Fixture');await sleep(150);fixture.body();fixture.setAvailable(false);const before=fixture.editor.innerHTML;await open();await choose(3);await sleep(1150);ok(tokens()===0&&fixture.editor.innerHTML===before,'unavailable native Teamwork rolls back only its untouched prefix');ok(!!document.querySelector('[data-agpa-teamwork-error]')&&!button().hasAttribute('data-teamwork'),'failed activation reports the problem without claiming Ultra is active');fixture.setAvailable(true);
  const matchMedia=window.matchMedia;window.matchMedia=()=>({matches:true});document.querySelectorAll('.agpa-teamwork-burst').forEach(n=>n.remove());fixture.addManual();await sleep();ok(!document.querySelector('.agpa-teamwork-burst')&&button().hasAttribute('data-teamwork'),'reduced-motion preference preserves violet state without the burst');window.matchMedia=matchMedia;
  fixture.editor.replaceChildren();await sleep();ok(!button().hasAttribute('data-teamwork'),'a cleared or sent prompt does not carry Ultra into the next prompt');
  fixture.addManual();await sleep();__AGModelControls.destroy();ok(tokens()===1&&!document.querySelector('.agpa-effort-trigger'),'disabling the plugin leaves the native draft and command intact');ok(fixture.getSends()===0,'no preview, activation or deactivation sends a prompt');ok(document.querySelector('[data-testid=permissions-selector-trigger]').textContent==='Default','Teamwork never changes approval permissions');
  window.matchMedia=originalMatchMedia;return{checks:passed.length,passed};
}
module.exports={setup,verify};
