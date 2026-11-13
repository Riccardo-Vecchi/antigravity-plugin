'use strict';
function setup() {
  const footer=document.querySelector('.fixture-footer'), root=document.createElement('div');root.className='surface-composer';footer.before(root);root.append(footer);
  const editor=document.createElement('div');editor.setAttribute('contenteditable','true');editor.setAttribute('role','combobox');editor.dataset.lexicalEditor='true';root.prepend(editor);
  let available=true,sends=0,nativeDefinitions=0;
  function chip(mode="swarm"){const outer=document.createElement('span');outer.dataset.lexicalDecorator='true';outer.setAttribute('contenteditable','false');const inner=document.createElement('span');inner.dataset.uri='slashCommand:'+mode;inner.textContent=mode;outer.append(inner);return outer;}
  function addManual(){editor.prepend(chip(),document.createTextNode(' '));}
  function body(){editor.innerHTML='<p>Keep this draft <span data-lexical-decorator="true" contenteditable="false"><span data-uri="file:/fixture/report.md">report.md</span></span> and its attachment.</p><p>Second paragraph.</p>';}
  editor.addEventListener('paste',event=>{
    const command=event.clipboardData.getData('text/plain');if(!['/swarm','/boost','/teamwork'].includes(command))return;const mode=command.slice(1);event.preventDefault();const selected=window.getSelection(),range=selected.getRangeAt(0);range.deleteContents();const text=document.createTextNode(command);range.insertNode(text);range.setStartAfter(text);range.collapse(true);selected.removeAllRanges();selected.addRange(range);
    if(!available)return;const menu=document.createElement('div');menu.dataset.mentionMenu='';const option=document.createElement('div');option.setAttribute('role','option');const label=document.createElement('div');label.textContent=mode;option.append(label);menu.append(option);root.append(menu);
    label.onclick=()=>{if(text.isConnected&&text.textContent===command){const token=chip(mode);token.dataset.nativeDefinition='current';text.replaceWith(token);token.after(document.createTextNode(' '));nativeDefinitions++;}menu.remove();};
  });
  editor.addEventListener('cut',event=>{event.preventDefault();window.getSelection().getRangeAt(0).deleteContents();root.querySelector('[data-mention-menu]')?.remove();});
  document.querySelector('#send').onclick=()=>sends++;
  body();Object.assign(fixture,{editor,addManual,body,setAvailable:value=>available=value,removeManual:()=>editor.querySelectorAll('[data-uri="slashCommand:swarm"]').forEach(n=>n.closest('[data-lexical-decorator]').remove()),getSends:()=>sends,getDefinitions:()=>nativeDefinitions});
}
async function verify() {
  const passed = [];
  const sleep = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
  const ok = (value, label) => { if (!value) throw Error(label); passed.push(label); };
  const button = () => document.querySelector('[data-agpa-swarm-trigger]');
  const effort = () => document.querySelector('.agpa-effort-trigger');
  const pressed = () => button().getAttribute('aria-pressed') === 'true';
  const tokens = () => fixture.editor.querySelectorAll('[data-uri="slashCommand:swarm"]').length;
  const toggle = async (ms = 260) => { button().click(); await sleep(ms); };
  await sleep();
  const original = fixture.editor.textContent;
  const startingEffort = fixture.selected.effort;
  await toggle();
  ok(pressed() && tokens() === 1, 'button adds the native Swarm chip');
  ok(fixture.getDefinitions() === 1, 'Swarm comes from the native picker');
  ok(fixture.selected.effort === startingEffort, 'Swarm does not overwrite effort');
  ok(fixture.editor.textContent.endsWith(original) && fixture.editor.querySelector('[data-uri="file:/fixture/report.md"]'), 'draft and attachment survive');
  effort().click();
  await sleep(160);
  const range = document.querySelector('.agpa-effort-popup input');
  ok(range.max === '2', 'slider ends at the last native option');
  range.value = startingEffort === 'low' ? '2' : '0';
  range.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(260);
  ok(fixture.selected.effort !== startingEffort && pressed(), 'effort selection preserves Swarm');
  await toggle();
  ok(!pressed() && tokens() === 0 && fixture.editor.textContent.trim() === original, 'second click removes only Swarm');
  fixture.addManual();
  await sleep();
  ok(pressed(), 'manual chip activation is reflected');
  fixture.select('Fixed (Thinking)');
  await sleep();
  ok(!effort() && pressed(), 'independent button works on fixed-effort models');
  await toggle();
  ok(!pressed() && tokens() === 0 && fixture.selected.base === 'Fixed (Thinking)', 'deactivation preserves a fixed model');
  fixture.body();
  fixture.setAvailable(false);
  const before = fixture.editor.innerHTML;
  await toggle(4300);
  ok(!pressed() && fixture.editor.innerHTML === before, 'unavailable native Swarm restores the draft');
  ok(document.querySelector('.agpa-swarm-error'), 'failure explains the state');
  fixture.setAvailable(true);
  fixture.addManual();
  await sleep();
  fixture.editor.replaceChildren();
  await sleep();
  ok(!pressed(), 'a fresh draft does not inherit Swarm');
  fixture.addManual();
  await sleep();
  __AGModelControls.destroy();
  ok(tokens() === 1 && !button(), 'destroy preserves the native chip');
  ok(fixture.getSends() === 0, 'controls never submit a prompt');
  return { checks: passed.length };
}
module.exports={setup,verify};
