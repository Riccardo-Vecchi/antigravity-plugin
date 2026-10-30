'use strict';
// Runs in an isolated, temporary renderer frame; no account or native settings.
function setup() {
  document.head.innerHTML = '<style>body{margin:20px;background:#181818;color:#ddd;font:12px system-ui} .fixture-footer{display:flex;align-items:center;width:700px;gap:4px}.fixture-left{display:flex;flex:1}.fixture-right{display:flex;gap:4px}button{height:28px;border:0;color:inherit;background:#303030;border-radius:20px;padding:0 8px} [role=menu]{position:absolute;top:60px;background:#222;padding:5px} [role=menuitem],[role=menuitemradio]{padding:5px} .fixture-tail{display:flex;gap:4px}</style>';
  document.body.innerHTML = '<div class="@container/input-footer fixture-footer"><div class="fixture-left"><button id="add">Add</button><div id="model-holder"><button data-testid="model-selector-trigger" aria-expanded="false"></button></div></div><div class="fixture-right"><button data-testid="permissions-selector-trigger">Default</button><div class="fixture-tail"><button id="mic">Mic</button><button id="send">Send</button></div></div></div><button id="outside">Outside</button>';
  const trigger = document.querySelector('[data-testid=model-selector-trigger]');
  const models = [
    {base:'Gemini Fixture',levels:[['low','Low'],['medium','Medium'],['high','High']]},
    {base:'Fixed (Thinking)'},
    {base:'Context Fixture',levels:[['low','Low'],['high','High']],context:true},
    {base:'Future Fixture',levels:[['minimal','Minimal'],['custom_deep','Deep']]},
    {base:'Disabled Fixture',levels:[['low','Low'],['high','High']],disabled:true}
  ];
  let selected = {base:'Gemini Fixture',effort:'high'}, menu, changes = 0;
  const preferences = {version:1,models:{}};
  globalThis.__AGModelUI = {status:()=>({preferences}),setEffort:async(base,value)=>{preferences.models[base]={favorite:false,hidden:false,effort:value};return true;}};
  globalThis.__AGPAI18n = {t:(key,values={})=>key.replace(/\{(\w+)\}/g,(_,name)=>values[name]||''),subscribe:()=>()=>{}};
  function render() {
    const model = models.find(m=>m.base===selected.base), label = document.createElement('span');label.textContent=model.base;
    if(model.levels){const suffix=document.createElement('span');suffix.textContent=' '+model.levels.find(([value])=>value===selected.effort)[1];label.append(suffix);}
    trigger.replaceChildren(label);
  }
  function close() {menu?.remove();menu=null;trigger.setAttribute('aria-expanded','false');}
  function choose(model,value) {if(model.disabled)return;selected={base:model.base,effort:value};changes++;render();close();}
  function open() {
    close();trigger.setAttribute('aria-expanded','true');menu=document.createElement('div');menu.setAttribute('role','menu');menu.setAttribute('data-open','');
    const panel=document.createElement('div');panel.dataset.testid='model-selector-panel';menu.append(panel);document.body.append(menu);
    for(const [index,model] of models.entries()){
      const row=document.createElement('div');row.setAttribute('role','menuitem');row.tabIndex=-1;row.id='fixture-model-'+index;
      if(model.disabled)row.setAttribute('aria-disabled','true');
      const label=document.createElement('span');label.textContent=model.base;row.append(label);panel.append(row);
      if(!model.levels){label.dataset.testid='model-selector-item';row.onclick=()=>choose(model);continue;}
      label.dataset.testid='model-selector-effort-group';label.dataset.modelBase=model.base;row.setAttribute('aria-haspopup','menu');
      row.onclick=()=>choose(model,model.levels[1][0]);
      row.onkeydown=event=>{if(event.key!=='ArrowRight')return;event.preventDefault();
        panel.querySelector('[data-nested]')?.remove();const sub=document.createElement('div');sub.setAttribute('role','menu');sub.setAttribute('data-nested','');sub.setAttribute('aria-labelledby',row.id);panel.append(sub);
        for(const [value,text] of model.levels){const choice=document.createElement('div');choice.setAttribute('role',model.context?'menuitem':'menuitemradio');choice.setAttribute('aria-checked',String(selected.base===model.base&&selected.effort===value));if(model.context)choice.setAttribute('aria-haspopup','menu');
          const name=document.createElement('span');name.dataset.testid='model-selector-effort-option';name.dataset.effort=value;name.textContent=text;choice.append(name);choice.onclick=()=>choose(model,value);sub.append(choice);}
      };
    }
  }
  trigger.onclick=()=>menu?close():open();
  document.addEventListener('pointerdown',event=>{if(menu&&!menu.contains(event.target)&&event.target!==trigger&&!event.target.closest('.agpa-effort-trigger'))close();});
  render();
  globalThis.fixture = {trigger,preferences,get selected(){return selected},get changes(){return changes},close,
    external(base,effort){selected={base,effort};render();},
    select(base){if(!menu)open();const row=[...menu.querySelectorAll('[role=menuitem]')].find(row=>row.textContent===base);if(!row)throw Error('Missing model '+base);row.click();}};
}
async function verify() {
  const checks=[], sleep=()=>new Promise(resolve=>setTimeout(resolve,50));
  const ok=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  const button=()=>document.querySelector('.agpa-effort-trigger'), range=()=>document.querySelector('.agpa-effort-popup input');
  const open=async()=>{button().click();await sleep();await sleep();ok(!!range(),'effort popup opens');};
  const choose=async index=>{range().value=String(index);range().dispatchEvent(new Event('input',{bubbles:true}));range().dispatchEvent(new Event('change',{bubbles:true}));await sleep();};
  await sleep();
  const model=fixture.trigger,permission=document.querySelector('[data-testid=permissions-selector-trigger]');
  ok(permission.getBoundingClientRect().left<model.getBoundingClientRect().left&&model.getBoundingClientRect().right<=button().getBoundingClientRect().left,'permissions left; model and effort right');
  await open();range().value='0';range().dispatchEvent(new Event('input',{bubbles:true}));ok(fixture.selected.effort==='high','drag preview does not change the native model');
  await choose(0);ok(fixture.selected.effort==='low'&&fixture.preferences.models['Gemini Fixture'].effort==='low','pointer commit selects a native level and remembers it');
  await open();const input=range();input.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));input.value='2';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));ok(fixture.selected.effort==='low','keyboard preview waits for key release');input.dispatchEvent(new KeyboardEvent('keyup',{key:'End',bubbles:true}));await sleep();ok(fixture.selected.effort==='high','keyboard commit selects the native level');
  await open();range().value='0';range().dispatchEvent(new Event('input',{bubbles:true}));range().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep();ok(!range()&&fixture.selected.effort==='high'&&!document.documentElement.hasAttribute('data-agpa-effort-bridge'),'Escape cancels preview and restores native menus');
  fixture.select('Fixed (Thinking)');await sleep();ok(!button(),'fixed Thinking models have no invented effort control');
  const count=fixture.changes;fixture.select('Gemini Fixture');await sleep();await sleep();ok(fixture.selected.effort==='high'&&fixture.changes===count+1,'returning to a model selects its remembered effort once');
  fixture.select('Fixed (Thinking)');await sleep();fixture.preferences.models['Gemini Fixture'].effort='removed_level';fixture.select('Gemini Fixture');await sleep();await sleep();ok(fixture.selected.effort==='medium'&&!!button(),'missing saved levels fall back to native selection without removing the valid effort control');
  await open();document.querySelector('#outside').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await sleep();ok(!range()&&!document.documentElement.hasAttribute('data-agpa-effort-bridge'),'outside dismissal cleans up the custom popup');
  permission.focus();permission.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));ok(document.activeElement===model,'Tab follows the visual toolbar order');
  model.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));ok(document.activeElement===button(),'Tab reaches effort after model');
  document.querySelector('.fixture-footer').style.width='320px';await sleep();const footer=document.querySelector('.fixture-footer').getBoundingClientRect();ok([permission,model,button()].every(node=>{const rect=node.getBoundingClientRect();return rect.left>=footer.left&&rect.right<=footer.right+1}),'narrow toolbar wraps without horizontal overflow');
  document.querySelector('.fixture-footer').style.width='700px';
  await open();fixture.external('Fixed (Thinking)');await sleep();const old=range();if(old){old.value='0';old.dispatchEvent(new Event('change',{bubbles:true}));}await sleep();ok(fixture.selected.base==='Fixed (Thinking)','a stale popup cannot overwrite an externally changed model');fixture.close();
  fixture.select('Context Fixture');await sleep();button().click();await sleep();await sleep();ok(!range()&&!button()&&!!document.querySelector('[data-testid=model-selector-effort-option]'),'context-window menus retain their complete native UI');fixture.close();
  fixture.select('Future Fixture');await sleep();await open();ok(range().max==='1','future native effort sets are read without hard-coded labels');await choose(0);ok(fixture.selected.effort==='minimal','future native efforts commit correctly');
  __AGModelControls.destroy();ok(!button()&&!document.querySelector('[data-agpa-composer-footer]')&&!document.querySelector('[data-agpa-effort-suffix]'),'disabling the module restores native controls and layout');
  ok(permission.textContent==='Default','model and effort interactions never alter approval permissions');
  return {checks:checks.length,passed:checks};
}
module.exports={setup,verify};
