/* Guided desktop access in a dedicated native Settings page. */
(() => {
 'use strict';
 const VERSION = '1.5.1';
 if (globalThis.__AGComputerUse?.version === VERSION) return;
 globalThis.__AGComputerUse?.destroy();
 const i18n = globalThis.__AGPAI18n;
 const savedDraft = globalThis.__AGPA_CU_DRAFT__;
 delete globalThis.__AGPA_CU_DRAFT__;
 const pending = new Map();
 let section, toggle, state = {}, busy = false, draft = typeof savedDraft === 'string' ? savedDraft : savedDraft?.apps;
 let scopeDraft = savedDraft?.scope, scheduled = false, destroyed = false, refreshing = false;
 let checksSignature = '', autoQueued = false, pendingAction = null, actionEpoch = 0, stopRequested = false;
 const errors = {
  selectApps: 'Choose at least one application executable.', invalidApp: 'Use an existing absolute executable path for each application.',
  serverConflict: 'This MCP server name is already used. Resolve the conflict in native MCP settings.',
  invalidConfig: 'The MCP configuration could not be read. Fix it in native MCP settings first.',
  configChanged: 'The MCP configuration changed. Refresh and try again.',
  installFirst: 'Install Cua Driver first.', connectFirst: 'Enable computer use first.',
  protocolFailed: 'The driver did not complete the MCP check. Review desktop setup and reconnect.',
  desktopUnavailable: 'The desktop session could not be detected. Sign in to your desktop and select Refresh status.',
  operationFailed: 'Computer-use setup failed. Check the setup guide and try again.',
  skillConflict: 'The computer-use skill was edited locally. Resolve the conflict before connecting.',
  unownedDriver: 'The driver folder is not a verified plugin installation. It was left untouched.',
 };
 function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) if (key === 'text') element.textContent = value; else element.setAttribute(key, value);
  for (const child of children) element.append(child);
  i18n.attrs(element, attributes); return element;
 }
 function icon(path, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const attrs = {width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
   stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round',
   'stroke-linejoin': 'round', 'aria-hidden': 'true'};
  for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, value);
  const line = document.createElementNS(svg.namespaceURI, 'path');
  line.setAttribute('d', path);
  svg.append(line);
  return svg;
 }
 function scope() {return scopeDraft || state.scope || 'desktop';}
 function selectedApps() {return section.querySelector('textarea').value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);}
 function rows(checks, step, withUpdates = false) {
  return checks.map(check => {
   const active = step === check.id && (check.id !== 'driver' || !check.passed || state.operation === 'install');
   const marker = node('span', {class: active ? 'agpa-cu-spinner' : `agpa-cu-check-icon ${check.passed ? 'passed' : 'pending'}`, 'aria-hidden':'true', text:active ? '' : check.passed ? '✓' : '●'});
   const label = node('span', {class:'agpa-cu-check-label'}, node('span', {text:check.label}));
   if (check.id === 'driver' && state.installed) {
    label.append(node('span', {class:'agpa-cu-check-version',text:state.driverVersion}));
    if(withUpdates) {
     const button = node('button',{type:'button',class:'agpa-cu-update-button','data-cu-updates':'','aria-label':'Check for Cua Driver updates',title:'Check for Cua Driver updates'});
     const svg = icon('M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1', 14);
     if(state.updates?.checking)svg.classList.add('agpa-cu-rotating');button.append(svg);
     button.addEventListener('click',()=>{section.querySelector('[data-cu-update-dialog]').showModal();act('updates');});label.append(button);
    }
   }
   return node('li',{'data-cu-check-id':check.id,'data-passed':String(check.passed),'data-working':String(active)},marker,label,node('span',{class:'agpa-cu-check-state',text:active?'Working…':check.passed?'Passed':check.failed?'Failed':'Pending'}));
  });
 }
 function paintConnection({working, switchOn}, checks) {
  const status = section.querySelector('[data-cu-connection]');
  const hasCheck = (id) => checks.some(check => check.id === id && check.passed);
  const pending = !hasCheck('protocol') || !hasCheck('native');
  const captureFailed = checks.some(check => check.id === 'capture' && check.failed);
  const desktopUnavailable = state.enabled && !hasCheck('desktop');
  const loginRequired = state.needsHelper && state.helperInstalled &&
   ['signInRequired', 'unknown'].includes(state.helperState);
  const attention = state.error || desktopUnavailable || captureFailed;
  const connected = state.enabled && !pending && !attention;
  status.dataset.status = working ? 'working' : attention ? 'attention' : connected ? 'connected' : 'pending';
  i18n.set(status.lastElementChild, working ? 'Working…' : attention ? 'Needs attention' : connected ? 'Connected' : 'Pending');

  const notice = section.querySelector('[data-cu-operation]');
  const recovery = section.querySelector('[data-cu-open-checks]');
  let message = '';
  let action = null;
  if (pendingAction === 'disconnect' || (stopRequested && state.operation)) message = 'Disabling…';
  else if (!state.platform && !state.error) message = 'Loading…';
  else if (state.error) message = errors[state.error] || errors.operationFailed;
  else if (state.enabled && !working) {
   if (desktopUnavailable) {
    if (loginRequired) {
     message = 'Log out of Linux, then sign back in. Locking and unlocking the screen is not enough.';
     action = ['Refresh status', '[data-cu-status]'];
    } else if (state.needsHelper) {
     message = 'Desktop access needs activation';
     action = ['Repair desktop helper', '[data-cu-helper]'];
    } else {
     message = errors.desktopUnavailable;
     action = ['Refresh status', '[data-cu-status]'];
    }
   } else if (captureFailed) action = ['Test screen capture', '[data-cu-capture]'];
   else if (pending) action = ['Check connection', '[data-cu-check]'];
  }
  i18n.set(notice, message);
  notice.hidden = !message;
  recovery.hidden = !switchOn || !action;
  if (action) {
   const [label, target] = action;
   i18n.set(recovery, label);
   recovery.dataset.target = target;
  }
 }
 function paint() {
  if (!section || destroyed) return;
  const t = (selector, text, params) => i18n.set(section.querySelector(selector), text, params);
  const controls = globalThis.__AGPAComputerUseControlState(state, {busy, pendingAction, stopRequested});
  const {working, switchOn} = controls;
  const details = section.querySelector('.agpa-cu-advanced');
  section.querySelector('[data-cu-content]').hidden = !switchOn;
  if (!switchOn) {
   details.open = false;
   for (const dialog of section.querySelectorAll('[data-cu-update-dialog][open], [data-cu-confirm-removal][open]')) dialog.close();
  }
  toggle.setAttribute('aria-checked', String(switchOn));
  const disabling = pendingAction === 'disconnect' || (stopRequested && !!state.operation);
  toggle.setAttribute('aria-busy', String(disabling || !state.platform));
  i18n.set(toggle, switchOn ? 'Disconnect the agent and keep setup.' : 'Enable computer use with your saved access settings.', {}, 'title');
  t('[data-cu-scope-summary]', scope() === 'desktop'
   ? 'Antigravity can see and interact with your entire desktop.'
   : 'Limit desktop access to applications you choose.');
  t('[data-cu-removal]', state.removal?.skillRetained ? 'Computer use removed. Your locally edited skill was kept; rename or remove it before setting up again.' : 'Computer use removed. Select Enable computer use for a fresh setup.');
  section.querySelector('[data-cu-removal]').hidden = !state.removal;
  const checks = globalThis.__AGPAComputerUseChecks(state, globalThis.__AGNativeMcp?.status());
  paintConnection(controls, checks);
  const step = state.progress?.step || (refreshing ? 'native' : null);
  const checksKey = JSON.stringify([checks, i18n.language, state.driverVersion, step, state.updates?.checking, switchOn]);
  if (checksKey !== checksSignature) {
   checksSignature = checksKey;
   section.querySelector('[data-cu-checks]').replaceChildren(...rows(switchOn?checks:checks.filter(check=>check.id==='driver'),step,true));
   section.querySelector('[data-cu-progress-checks]').replaceChildren(...rows(checks,step));
  }
  const inProgress = working || refreshing;
  t('[data-cu-progress-title]',inProgress?'Setting up computer use':state.error?'Setup needs attention':!state.enabled?'Computer use is stopped':state.needsHelper?'Desktop access needs activation':'Computer use is enabled');
  t('[data-cu-progress-label]',state.error?(errors[state.error]||errors.operationFailed):state.progress?.label||(refreshing?'Connecting tools to Antigravity…':inProgress?'Preparing computer use…':state.needsHelper?'Log out of Linux, then sign back in. Locking and unlocking the screen is not enough.':'Start a new conversation to use your desktop tools.'));
  const indicator=section.querySelector('[data-cu-progress-indicator]');indicator.classList.toggle('agpa-cu-spinner',inProgress);
  const symbol=inProgress?'':state.error||state.needsHelper||!state.enabled?'●':'✓';if(indicator.textContent!==symbol)indicator.textContent=symbol;
  const download=state.progress?.download;
  section.querySelector('[data-cu-download]').hidden=!download?.received;
  t('[data-cu-download]',download?.total?'Downloaded {received} of {total} MB':'Downloaded {received} MB',{received:((download?.received||0)/1048576).toFixed(1),total:((download?.total||0)/1048576).toFixed(1)});
  t('[data-cu-progress-close]',inProgress?'Continue in background':'Done');
  section.querySelector('[data-cu-progress-stop]').hidden =
   !inProgress || (pendingAction !== 'setup' && state.operation !== 'setup');
  const update=state.updates;
  t('[data-cu-update-title]',!update||update.checking?'Checking Cua Driver updates…':update.error?'Could not check for updates':update.available?'Cua Driver {version} is available':'Cua Driver is up to date',{version:update?.version||'—'});
  t('[data-cu-update-description]',update?.error?'Check your connection and try again.':!update||update.checking?'Checking official Cua Driver releases…':'Reviewed version: {reviewed}. Latest upstream version: {latest}.',{reviewed:state.driverVersion||'—',latest:update?.version||'—'});
  section.querySelector('[data-cu-update-spinner]').hidden=!update?.checking;
  section.querySelector('[data-cu-update-preview]').hidden=!update?.prerelease;
  section.querySelector('[data-cu-release-link]').hidden=!update?.url;
  if(update?.url)section.querySelector('[data-cu-release-link]').href=update.url;
  for (const input of section.querySelectorAll('[name=agpa-cu-scope]')) {input.checked = input.value === scope();input.disabled = working;}
  section.querySelector('[data-cu-app-scope]').hidden = scope() !== 'apps';
  const textarea = section.querySelector('textarea');
  if (draft === undefined) textarea.value = (state.apps?.length ? state.apps : state.suggestedApps || []).join('\n');
  const select = section.querySelector('select'); const signature = JSON.stringify(state.availableApps || []);
  if (select.dataset.signature !== signature) {
   select.dataset.signature = signature; select.replaceChildren();
   for (const choice of state.availableApps || []) select.append(node('option', {value: choice.executable, text: choice.name}));
  }
  for (const button of section.querySelectorAll('button')) button.disabled = working;
  const changed=globalThis.__AGPAComputerUseAccessChanged(state,{scope:scope(),apps:selectedApps()});
  const apply=section.querySelector('[data-cu-connect]');
  apply.hidden = !state.enabled || !changed;
  apply.disabled = working || apply.hidden;
  apply.classList.toggle('agpa-cu-primary',!apply.disabled);
  section.querySelector('[data-cu-driver-upgrade]').hidden = !state.driverUpgrade;
  section.querySelector('[data-cu-check]').disabled ||= !state.enabled;
  section.querySelector('[data-cu-capture]').hidden = scope() !== 'desktop';
  section.querySelector('[data-cu-capture]').disabled ||= !state.enabled || !!state.needsHelper || state.scope !== 'desktop';
  section.querySelector('[data-cu-helper]').hidden = !state.needsHelper || !state.installed || ['signInRequired', 'unknown'].includes(state.helperState);
  section.querySelector('[data-cu-remove]').disabled ||= !state.installed && !state.registered && !state.skillReady;
  toggle.disabled = !state.platform || disabling || pendingAction==='uninstall' || state.operation==='uninstall';
  const updateButton=section.querySelector('[data-cu-updates]');if(updateButton)updateButton.disabled=working||!!update?.checking;
  section.querySelector('[data-cu-progress-close]').disabled=false;section.querySelector('[data-cu-update-close]').disabled=false;
  section.querySelector('[data-cu-progress-stop]').disabled=false;
 }
 async function request(action, value) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => {pending.delete(id);reject(Error('timeout'));}, 20000);
   pending.set(id, {resolve, reject, timer});
   try {globalThis.__agpaComputerUse(JSON.stringify({requestId: id, action, value}));}
   catch (error) {clearTimeout(timer);pending.delete(id);reject(error);}
  });
 }
 async function refreshNative() {
  if (refreshing || destroyed) return;
  refreshing = true;
  let timer;
  try {await Promise.race([globalThis.__AGNativeMcp?.refresh(), new Promise(resolve => {timer = setTimeout(resolve, 12000);})]);} catch { /* The checklist can still report whether Antigravity detects the server. */ }
  finally {clearTimeout(timer);refreshing = false;paint();maybeVerify();}
 }
 function receive(next) {
  const previousAction=state.operation;
  const completed = !!state.operation && !next.operation;
  if (completed && ['setup','connect'].includes(previousAction) && !next.error) {draft = undefined;scopeDraft = undefined;}
  state = next;if(!state.enabled&&!state.operation)stopRequested=false;paint();
  if (completed && ['setup','uninstall','connect','check'].includes(previousAction) && !state.error) refreshNative();
  maybeVerify();
 }
 function maybeVerify() {
  if(destroyed||autoQueued||busy||refreshing||!state.autoCapturePending||!globalThis.__AGSettingsNavigation?.isOpen())return;
  autoQueued=true;queueMicrotask(async()=>{try{if(!destroyed&&!busy)await act('verify');}finally{autoQueued=false;}});
 }
 async function act(action) {
  if (busy && action !== 'disconnect') return;
  const epoch=++actionEpoch;if(action==='disconnect')stopRequested=true;else if(action==='setup')stopRequested=false;pendingAction=action;busy = true;
  try {
   paint();
   if (action === 'install' || (action === 'setup' && !state.installed)) {section.querySelector('[data-cu-progress-dialog]').showModal();section.querySelector('[data-cu-progress-close]').focus();}
   const apps = selectedApps();
   const next = await request(action, ['setup', 'connect'].includes(action) ? {scope: scope(), apps} : true);
   if(epoch!==actionEpoch)return;
   receive(next);
   if (['connect', 'disconnect', 'refresh'].includes(action) && !state.error) void refreshNative();
   if (['setup', 'connect'].includes(action) && !state.error && !state.operation) {draft = undefined;scopeDraft = undefined;}
  } catch {if(epoch===actionEpoch)state = {...state, error: 'operationFailed'};}
  finally {if(epoch===actionEpoch){busy = false;pendingAction=null;paint();maybeVerify();}}
 }
 function build() {
  const scopes = node('fieldset', {class: 'agpa-cu-scopes'}, node('legend', {text: 'Access scope'}));
  const options = node('div', {class: 'agpa-cu-scope-options'});
  for (const [value, title, path] of [
   ['desktop', 'Entire desktop', 'M3 4h18v13H3zM8 21h8M12 17v4'],
   ['apps', 'Selected apps', 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
  ]) {
   const radio = node('input', {type: 'radio', name: 'agpa-cu-scope', value});
   radio.addEventListener('change', () => {scopeDraft = value;paint();});
   options.append(node('label', {class: 'agpa-cu-scope-option'}, radio, icon(path), node('span', {text: title})));
  }
  scopes.append(options);
  const textarea = node('textarea', {rows: '3', class: 'agpa-cu-apps', 'aria-label': 'Allowed application executables', placeholder: 'One absolute executable path per line'});
  if (draft !== undefined) textarea.value = draft;
  textarea.addEventListener('input', () => {draft = textarea.value;paint();});
  const select = node('select', {'aria-label': 'Detected applications', class: 'agpa-cu-apps'});
  const add = node('button', {type: 'button', class: 'agpa-app-icon-option', text: 'Add application'});
  add.addEventListener('click', () => {if (!select.value) return;const apps = new Set(selectedApps());apps.add(select.value);draft = textarea.value = [...apps].join('\n');paint();});
  const apps = node('div', {'data-cu-app-scope': '', class: 'agpa-cu-selected'}, node('div', {class: 'agpa-patch-actions'}, select, add), textarea);
  const enable = node('button', {type: 'button', class: 'agpa-app-icon-option agpa-cu-primary', 'data-cu-connect': '', text: 'Apply access changes'});
  enable.addEventListener('click', () => act('setup'));
  toggle=node('button',{type:'button',class:'agpa-cu-enable-switch',role:'switch','aria-label':'Computer use','aria-checked':'false','data-cu-toggle':''},
   node('span',{class:'agpa-cu-switch-track','aria-hidden':'true'},node('span',{class:'agpa-cu-switch-thumb'})));
  toggle.addEventListener('click', () => act(toggle.getAttribute('aria-checked') === 'true' ? 'disconnect' : 'setup'));
  const upgrade = node('button', {type:'button',class:'agpa-app-icon-option','data-cu-driver-upgrade':'',text:'Install update',hidden:''});
  upgrade.addEventListener('click', () => act('install'));
  const advancedActions = node('div', {class: 'agpa-patch-actions','data-cu-advanced-actions':''},upgrade);
  for (const [action, key, label] of [['setupHelper', 'helper', 'Repair desktop helper'], ['check', 'check', 'Check connection'], ['refresh', 'status', 'Refresh status'], ['capture', 'capture', 'Test screen capture']]) {
   const button = node('button', {type: 'button', class: 'agpa-app-icon-option', [`data-cu-${key}`]: '', text: label});
   button.addEventListener('click', () => act(action));advancedActions.append(button);
  }
  const remove = node('button', {type:'button',class:'agpa-app-icon-option agpa-cu-danger','data-cu-remove':'',text:'Remove computer use'});
  remove.addEventListener('click', () => {removal.showModal();cancel.focus();});
  const cancel = node('button', {type:'button',class:'agpa-app-icon-option',text:'Cancel'});
  cancel.addEventListener('click', () => removal.close());
  const confirm = node('button', {type:'button',class:'agpa-app-icon-option agpa-cu-danger','data-cu-remove-confirm':'',text:'Remove computer use'});
  confirm.addEventListener('click', () => {removal.close();act('uninstall');});
  const removal = node('dialog', {class:'agpa-cu-confirm','data-cu-confirm-removal':'','aria-labelledby':'agpa-cu-remove-title','aria-describedby':'agpa-cu-remove-description'},
   node('h3',{id:'agpa-cu-remove-title',text:'Remove computer use?'}),
   node('div',{id:'agpa-cu-remove-description'},
   node('p',{text:'Remove the plugin-managed driver, MCP entry, generated skill and setup preferences? You can then enable computer use again to reinstall.'}),
   node('p',{class:'agpa-cu-muted',text:'Other MCP servers, conversations and edited skills are kept. The shared GNOME helper and other Cua installations are kept.'})),
   node('div',{class:'agpa-patch-actions'}, cancel,confirm));
  const progressClose=node('button',{type:'button',class:'agpa-app-icon-option','data-cu-progress-close':'',text:'Continue in background'});
  const progressStop=node('button',{type:'button',class:'agpa-app-icon-option','data-cu-progress-stop':'',text:'Cancel setup'});
  const progressDialog=node('dialog',{class:'agpa-cu-confirm agpa-cu-progress','data-cu-progress-dialog':'','aria-labelledby':'agpa-cu-progress-title'},
   node('h3',{id:'agpa-cu-progress-title'},node('span',{'data-cu-progress-indicator':'','aria-hidden':'true'}),node('span',{'data-cu-progress-title':''})),
   node('p',{'data-cu-progress-label':'',role:'status','aria-live':'polite'}),
   node('p',{class:'agpa-cu-muted','data-cu-download':''}),
   node('ul',{class:'agpa-cu-checks','data-cu-progress-checks':'','aria-label':'Connection checks'}),
   node('div',{class:'agpa-patch-actions'},progressStop,progressClose));
  progressClose.addEventListener('click',()=>progressDialog.close());progressStop.addEventListener('click',()=>act('disconnect'));
  const updateClose=node('button',{type:'button',class:'agpa-app-icon-option','data-cu-update-close':'',text:'Done'});
  const updateDialog=node('dialog',{class:'agpa-cu-confirm','data-cu-update-dialog':'','aria-labelledby':'agpa-cu-update-title'},
   node('h3',{id:'agpa-cu-update-title'},node('span',{class:'agpa-cu-spinner','data-cu-update-spinner':'','aria-hidden':'true'}),node('span',{'data-cu-update-title':''})),
   node('p',{'data-cu-update-description':'',role:'status','aria-live':'polite'}),
   node('p',{class:'agpa-cu-muted','data-cu-update-preview':'',text:'This upstream release is marked as a prerelease.'}),
   node('p',{class:'agpa-cu-muted',text:'The plugin installs its reviewed driver version. New driver support arrives through plugin updates.'}),
   node('a',{'data-cu-release-link':'',target:'_blank',rel:'noopener noreferrer',text:'View official release notes'}),
   node('div',{class:'agpa-patch-actions'},updateClose));
  updateClose.addEventListener('click',()=>updateDialog.close());
  const summary = node('summary', {}, icon('m9 5 7 7-7 7', 14),
   node('span', {text: 'Connection details'}),
   node('span', {class:'agpa-cu-connection', 'data-cu-connection':'', role:'status'},
    node('span', {class:'agpa-cu-status-dot', 'aria-hidden':'true'}), node('span')));
  const details = node('details', {class: 'agpa-cu-advanced'}, summary,
   node('ul', {class:'agpa-cu-checks', 'data-cu-checks':'', 'aria-label':'Connection checks'}),
   advancedActions,
   node('div', {class: 'agpa-cu-maintenance'},
    node('a', {href: 'https://github.com/Riccardo-Vecchi/antigravity-plugin/blob/main/docs/COMPUTER_USE.md', target: '_blank', rel: 'noopener noreferrer', text: 'Computer-use setup guide'}), remove));
  const openChecks = node('button', {type:'button', class:'agpa-cu-text-action', 'data-cu-open-checks':'', hidden:''});
  openChecks.addEventListener('click', () => {
   details.open = true;
   const action = details.querySelector(openChecks.dataset.target);
   if (action && !action.hidden && !action.disabled) action.focus();
   else summary.focus();
  });
  section = node('section', {class: 'agpa-cu-panel', 'data-agpa-computer-use-setting': ''},
   node('p', {class: 'agpa-cu-summary', text: 'Let Antigravity use your desktop.'}),
   node('div', {class: 'agpa-cu-content', 'data-cu-content': '', hidden: ''},
    scopes, node('p', {class:'agpa-cu-muted', 'data-cu-scope-summary':''}), apps,
    node('div', {class: 'agpa-cu-controls'}, enable), details),
   node('p', {class: 'agpa-cu-operation', 'data-cu-operation': '', role: 'status', hidden:''}),
   openChecks,
   node('p', {class:'agpa-cu-muted', 'data-cu-removal':'', role:'status', hidden:''}),
   removal, progressDialog, updateDialog);
  pollStatus();
 }
 function apply() {
  if (destroyed) return;
  const parent = globalThis.__AGSettingsNavigation?.getPage();
  if (!parent) return;
  if (!section) build();
  const header = parent.querySelector('.agpa-settings-page-title');
  if (header && toggle.parentElement !== header) header.append(toggle);
  else if (!header && toggle.parentElement !== section) section.prepend(toggle);
  if (section.parentElement !== parent) parent.append(section);
  paint();
 }
 const style = node('style', {id: 'agpa-computer-use-styles', text: `
  .agpa-cu-panel,.agpa-cu-content{display:flex;flex-direction:column;gap:14px;color:var(--foreground,#eee)}
  [data-agpa-computer-page] .agpa-settings-page-inner{gap:8px}
  .agpa-cu-panel p{margin:0;line-height:1.55}
  .agpa-cu-summary,.agpa-cu-muted{color:var(--muted-foreground,#aaa);font-size:13px}
  .agpa-cu-summary{padding-bottom:12px}
  .agpa-cu-operation{font-size:13px;color:var(--foreground,#eee);border-left:2px solid #e5b35e;padding-left:10px}
  .agpa-cu-enable-switch{display:inline-flex;align-items:center;margin-inline-start:auto;padding:4px 0;border:0;background:none;cursor:pointer;flex-shrink:0}
  .agpa-cu-enable-switch:focus-visible,.agpa-cu-scope-option:has(input:focus-visible){outline:2px solid #398bdb;outline-offset:3px;border-radius:6px}
  .agpa-cu-enable-switch:disabled{opacity:.5;cursor:wait}
  .agpa-cu-switch-track{display:block;position:relative;width:36px;height:21px;background:#666;border-radius:20px}
  .agpa-cu-switch-thumb{position:absolute;top:3px;left:3px;width:15px;height:15px;border-radius:50%;background:white}
  .agpa-cu-enable-switch[aria-checked=true] .agpa-cu-switch-track{background:#398bdb}.agpa-cu-enable-switch[aria-checked=true] .agpa-cu-switch-thumb{left:18px}
  .agpa-cu-controls{display:flex}.agpa-cu-controls:not(:has(button:not([hidden]))){display:none}
  .agpa-cu-scopes{border:0;padding:0;margin:0;min-width:0}
  .agpa-cu-scopes legend{font-weight:500;margin-bottom:8px}
  .agpa-cu-scope-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--border,#353535);padding:1px;border-radius:9px}
  .agpa-cu-scope-option{position:relative;display:flex;justify-content:center;align-items:center;gap:8px;padding:9px 8px;background:var(--background,#111);cursor:pointer;text-align:center}
  .agpa-cu-scope-option:first-child{border-radius:8px 0 0 8px}.agpa-cu-scope-option:last-child{border-radius:0 8px 8px 0}
  .agpa-cu-scope-option:has(input:checked){background:color-mix(in srgb,#398bdb 18%,var(--background,#111));box-shadow:inset 0 0 0 1px #398bdb}
  .agpa-cu-scope-option:has(input:disabled){cursor:wait;opacity:.65}
  .agpa-cu-scope-option input{position:absolute;opacity:0;width:1px;height:1px}
  .agpa-cu-scope-option svg,.agpa-cu-advanced summary svg{flex-shrink:0}
  .agpa-cu-selected{display:flex;flex-direction:column;gap:10px}.agpa-cu-panel [hidden]{display:none!important}
  .agpa-cu-apps{box-sizing:border-box;width:100%;padding:10px;border:1px solid var(--border,#444);border-radius:8px;background:var(--background,#111);color:inherit;font:12px monospace;resize:vertical}
  .agpa-cu-primary{background:var(--foreground,#eee)!important;color:var(--background,#111)!important;font-weight:500}
  .agpa-cu-advanced{border-top:1px solid var(--border,#353535);margin-top:6px}
  .agpa-cu-advanced summary{display:flex;align-items:center;gap:8px;padding:12px 0;cursor:pointer;list-style:none}
  .agpa-cu-advanced summary::-webkit-details-marker{display:none}
  .agpa-cu-advanced[open] summary svg{transform:rotate(90deg)}
  .agpa-cu-connection,.agpa-cu-maintenance{display:flex;align-items:center;gap:8px}
  .agpa-cu-connection{margin-inline-start:auto;color:var(--muted-foreground,#aaa);font-size:12px}
  .agpa-cu-status-dot{width:7px;height:7px;flex:none;border-radius:50%;background:#aaa}
  .agpa-cu-connection[data-status=connected] .agpa-cu-status-dot{background:#55c98a}
  .agpa-cu-connection[data-status=attention] .agpa-cu-status-dot{background:#e5b35e}
  .agpa-cu-maintenance{justify-content:space-between;flex-wrap:wrap;margin-top:14px}
  .agpa-cu-text-action{align-self:flex-start;border:0;background:none;padding:0;color:var(--link,#7ab7f4);font:inherit;cursor:pointer}
  .agpa-cu-checks{padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
  .agpa-cu-checks li{display:flex;align-items:center;gap:10px;font-size:12px;line-height:1.5}
  .agpa-cu-check-icon{width:16px;text-align:center;flex-shrink:0}.agpa-cu-check-icon.passed{color:#55c98a;font-size:16px;font-weight:700}.agpa-cu-check-icon.pending{color:#e5ad4b;font-size:11px}
  .agpa-cu-check-state{margin-left:auto;color:var(--muted-foreground,#aaa);font-size:11px}
  .agpa-cu-check-label{flex:1;min-width:0}.agpa-cu-check-version{margin-left:8px;color:var(--muted-foreground,#aaa)}
  .agpa-cu-confirm{position:fixed;inset:50% auto auto 50%;transform:translate(-50%,-50%);margin:0;box-sizing:border-box;width:min(480px,calc(100vw - 48px));padding:24px;border:1px solid var(--border,#444);border-radius:14px;background:var(--background,#171717);color:var(--foreground,#eee);font-family:inherit;font-size:13px;line-height:1.6}
  .agpa-cu-confirm:not([open]){display:none}.agpa-cu-confirm[open]{display:flex;flex-direction:column;gap:18px}
  .agpa-cu-confirm::backdrop{background:#0009}.agpa-cu-confirm h3{margin:0;font-size:15px;font-weight:600}
  .agpa-cu-confirm p+p{margin-top:12px}.agpa-cu-confirm .agpa-patch-actions{justify-content:flex-end}
  .agpa-cu-danger{background:#b4232c!important;color:#fff!important;border-color:#c33c45!important}.agpa-cu-danger:hover:not(:disabled){background:#c12b35!important}.agpa-cu-danger:disabled{opacity:.45;cursor:not-allowed}
  .agpa-cu-spinner{display:inline-block;box-sizing:border-box;width:15px;height:15px;flex-shrink:0;border:2px solid #7776;border-top-color:currentColor;border-radius:50%;animation:agpa-cu-spin .85s linear infinite!important}
  .agpa-cu-rotating{animation:agpa-cu-spin .85s linear infinite!important}.agpa-cu-confirm h3{display:flex;align-items:center;gap:10px}
  .agpa-cu-progress{width:min(560px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto}
  .agpa-cu-update-button{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;margin-left:6px;padding:3px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer}.agpa-cu-update-button:hover{background:#8883}.agpa-cu-update-button:focus-visible{outline:2px solid #398bdb}
  .agpa-cu-confirm a{color:#7ab7f4}.agpa-cu-confirm ul{margin:0}
  @keyframes agpa-cu-spin{to{transform:rotate(360deg)}}
 `});
 document.head.append(style);
 function schedule() {if (scheduled || destroyed) return;scheduled = true;queueMicrotask(() => {scheduled = false;apply();});}
 const observer = new MutationObserver(schedule);observer.observe(document.body, {subtree: true, childList: true});
 let polling = false;
 async function pollStatus() {
  if (polling || busy || destroyed) return;
  const epoch = actionEpoch;
  polling = true;
  try {
   const next = await request('status', true);
   if (!destroyed && !busy && epoch === actionEpoch) receive(next);
  } catch {
   if (!destroyed && !state.platform && epoch === actionEpoch) {
    state = {...state, error: 'operationFailed'};
    paint();
   }
  } finally {polling = false;}
 }
 const interval = setInterval(() => {
  if (section?.isConnected && globalThis.__AGSettingsNavigation?.isOpen()) void pollStatus();
 }, 1500);
 function dismissRemoval(event) {
  const dialog = section?.querySelector('dialog[open]');
  if (event.key !== 'Escape' || !dialog?.open) return;
  // The native Settings focus trap handles Escape too; dismiss only this dialog.
  event.preventDefault();event.stopImmediatePropagation();dialog.close();
 }
 window.addEventListener('keydown', dismissRemoval, true);
 window.addEventListener('agpa:settings-page', schedule);
 const untranslate = i18n.subscribe(paint);
 globalThis.__AGComputerUse = {version: VERSION, status: () => ({...state, mounted: !!section?.isConnected}),
  onResult(id, ok, next) {const item = pending.get(id);if (!item) return;clearTimeout(item.timer);pending.delete(id);ok ? item.resolve(next) : item.reject(Error('operationFailed'));},
  destroy() {toggle?.remove();for(const dialog of section?.querySelectorAll('dialog[open]')||[])dialog.close();globalThis.__AGPA_CU_DRAFT__ = {apps: draft, scope: scopeDraft};destroyed = true;observer.disconnect();clearInterval(interval);window.removeEventListener('keydown', dismissRemoval, true);window.removeEventListener('agpa:settings-page', schedule);untranslate();for (const item of pending.values()) {clearTimeout(item.timer);item.reject(Error('stopped'));}pending.clear();section?.remove();style.remove();delete globalThis.__AGComputerUse;}};
 schedule();
})();
