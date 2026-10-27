/* Guided desktop access in a dedicated native Settings page. */
(() => {
 'use strict';
 const VERSION = '1.2.0';
 if (globalThis.__AGComputerUse?.version === VERSION) return;
 globalThis.__AGComputerUse?.destroy();
 const i18n = globalThis.__AGPAI18n;
 const savedDraft = globalThis.__AGPA_CU_DRAFT__;
 delete globalThis.__AGPA_CU_DRAFT__;
 const pending = new Map();
 let section, state = {}, busy = false, draft = typeof savedDraft === 'string' ? savedDraft : savedDraft?.apps;
 let scopeDraft = savedDraft?.scope, nativeRefresh = null, scheduled = false, destroyed = false, refreshing = false;
 const errors = {
  selectApps: 'Choose at least one application executable.', invalidApp: 'Use an existing absolute executable path for each application.',
  serverConflict: 'This MCP server name is already used. Resolve the conflict in native MCP settings.',
  invalidConfig: 'The MCP configuration could not be read. Fix it in native MCP settings first.',
  configChanged: 'The MCP configuration changed. Refresh and try again.',
  installFirst: 'Install Cua Driver first.', connectFirst: 'Enable computer use first.',
  protocolFailed: 'The driver did not complete the MCP check. Review desktop setup and reconnect.',
  operationFailed: 'Computer-use setup failed. Check the setup guide and try again.',
  skillConflict: 'The computer-use skill was edited locally. Resolve the conflict before connecting.',
 };
 function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) if (key === 'text') element.textContent = value; else element.setAttribute(key, value);
  for (const child of children) element.append(child);
  i18n.attrs(element, attributes); return element;
 }
 function scope() {return scopeDraft || state.scope || 'desktop';}
 function paint() {
  if (!section) return;
  const t = (selector, text, params) => i18n.set(section.querySelector(selector), text, params);
  const working = busy || !!state.operation;
  t('[data-cu-connection]', state.operation ? 'Preparing computer use…' : state.enabled ? state.needsHelper ? 'One last step: activate desktop access' : 'Computer use is enabled' : 'Your agent, across your desktop');
  t('[data-cu-summary]', state.enabled ? 'Describe the result you want in Antigravity. The agent can see and operate the desktop within your chosen access.' : 'Let Antigravity work across your apps: explore, click, type and verify the result.');
  t('[data-cu-driver]', state.installed ? 'Cua Driver {version} installed' : 'The setup installs the current reviewed Cua Driver for you.', {version: state.driverVersion || '—'});
  t('[data-cu-platform]', state.needsHelper ? state.helperInstalled ? 'GNOME helper installed. Sign out and back in when convenient to activate it.' : 'The setup will install the GNOME desktop helper. A new sign-in is required to activate it.' : state.session === 'wayland' ? 'Wayland: some apps require foreground input or additional desktop permission.' : state.experimental ? 'Windows support is experimental. Keep the target app visible in your desktop session.' : 'Desktop permissions may be requested when you first use an application.');
  t('[data-cu-protocol]', state.protocol?.ok ? 'MCP handshake passed. Desktop actions still need verification.' : 'MCP connection has not been checked.');
  t('[data-cu-operation]', state.error ? (errors[state.error] || errors.operationFailed) : working ? 'Working…' : state.enabled ? nativeRefresh ? 'Connected to the native Antigravity agent. Start a new conversation to use the tools.' : 'Start a new agent conversation after connecting. If tools are missing, refresh native MCP settings.' : 'Choose access and enable computer use. Existing Antigravity approvals remain in effect.');
  t('[data-cu-connect]', working ? 'Preparing computer use…' : state.enabled ? 'Apply access changes' : 'Enable computer use');
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
  section.querySelector('[data-cu-disconnect]').disabled = !state.enabled && !state.registered && !state.operation;
  section.querySelector('[data-cu-check]').disabled ||= !state.enabled;
  section.querySelector('[data-cu-helper]').hidden = !state.needsHelper || !state.installed || state.helperInstalled;
  section.dataset.state = state.error ? 'error' : state.enabled ? state.needsHelper ? 'attention' : 'enabled' : 'off';
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
  if (refreshing) return;
  refreshing = true;
  try {nativeRefresh = await globalThis.__AGNativeMcp?.refresh() || false;} catch {nativeRefresh = false;}
  finally {refreshing = false;paint();}
 }
 function receive(next) {
  const completed = !!state.operation && !next.operation;
  if (completed && !next.error) {draft = undefined;scopeDraft = undefined;}
  state = next; paint();
  if (completed && state.enabled && !state.error) refreshNative();
 }
 async function act(action) {
  if (busy && action !== 'disconnect') return;
  busy = true;paint();
  try {
   const apps = section.querySelector('textarea').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
   const next = await request(action, ['setup', 'connect'].includes(action) ? {scope: scope(), apps} : true);
   receive(next);
   if (['connect', 'disconnect', 'check'].includes(action) && !state.error) await refreshNative();
   if (['setup', 'connect'].includes(action) && !state.error && !state.operation) {draft = undefined;scopeDraft = undefined;}
  } catch {state = {...state, error: 'operationFailed'};}
  finally {busy = false;paint();}
 }
 function build() {
  const scopes = node('fieldset', {class: 'agpa-cu-scopes'}, node('legend', {text: 'Where can the agent work?'}));
  for (const [value, title, description] of [
   ['desktop', 'Entire desktop', 'Move naturally between applications and use the whole desktop.'],
   ['apps', 'Selected apps', 'Limit desktop access to applications you choose.'],
  ]) {
   const radio = node('input', {type: 'radio', name: 'agpa-cu-scope', value});
   radio.addEventListener('change', () => {scopeDraft = value;paint();});
   scopes.append(node('label', {class: 'agpa-cu-scope-card'}, radio, node('span', {}, node('strong', {text: title}), node('span', {class: 'agpa-cu-muted', text: description}))));
  }
  const textarea = node('textarea', {rows: '3', class: 'agpa-cu-apps', 'aria-label': 'Allowed application executables', placeholder: 'One absolute executable path per line'});
  if (draft !== undefined) textarea.value = draft;
  textarea.addEventListener('input', () => {draft = textarea.value;});
  const select = node('select', {'aria-label': 'Detected applications', class: 'agpa-cu-apps'});
  const add = node('button', {type: 'button', class: 'agpa-app-icon-option', text: 'Add application'});
  add.addEventListener('click', () => {if (!select.value) return;const apps = new Set(textarea.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean));apps.add(select.value);draft = textarea.value = [...apps].join('\n');});
  const apps = node('div', {'data-cu-app-scope': '', class: 'agpa-cu-selected'}, node('div', {class: 'agpa-patch-actions'}, select, add), textarea);
  const enable = node('button', {type: 'button', class: 'agpa-app-icon-option agpa-cu-primary', 'data-cu-connect': '', text: 'Enable computer use'});
  enable.addEventListener('click', () => act('setup'));
  const stop = node('button', {type: 'button', class: 'agpa-app-icon-option', 'data-cu-disconnect': '', text: 'Stop and disconnect'});
  stop.addEventListener('click', () => act('disconnect'));
  const advancedActions = node('div', {class: 'agpa-patch-actions'});
  for (const [action, key, label] of [['setupHelper', 'helper', 'Set up GNOME helper'], ['check', 'check', 'Check connection'], ['status', 'status', 'Refresh status']]) {
   const button = node('button', {type: 'button', class: 'agpa-app-icon-option', [`data-cu-${key}`]: '', text: label});
   button.addEventListener('click', () => act(action));advancedActions.append(button);
  }
  const examples = node('div', {class: 'agpa-cu-examples'}, node('strong', {text: 'Try asking Antigravity'}),
   node('p', {text: 'Open Calculator, calculate 6 × 7 and verify the result.'}),
   node('p', {text: 'Check the interface of my app and reproduce the issue visually.'}));
  section = node('section', {class: 'agpa-cu-panel', 'data-agpa-computer-use-setting': ''},
   node('div', {class: 'agpa-cu-hero'}, node('span', {class: 'agpa-cu-status-dot', 'aria-hidden': 'true'}), node('h3', {'data-cu-connection': '', role: 'status'})),
   node('p', {class: 'agpa-cu-summary', 'data-cu-summary': ''}), scopes, apps,
   node('p', {class: 'agpa-cu-muted', text: 'Entire desktop access includes visible screen content. The agent still follows your task and Antigravity approval settings.'}),
   node('div', {class: 'agpa-patch-actions'}, enable, stop),
   node('p', {class: 'agpa-cu-notice', 'data-cu-platform': ''}),
   node('p', {class: 'agpa-app-icon-status', 'data-cu-operation': '', role: 'status', 'aria-live': 'polite'}), examples,
   node('details', {class: 'agpa-cu-advanced'}, node('summary', {text: 'Connection details'}),
    node('p', {class: 'agpa-cu-muted', 'data-cu-driver': ''}), node('p', {class: 'agpa-cu-muted', 'data-cu-protocol': ''}), advancedActions,
    node('p', {class: 'agpa-cu-muted', text: 'Available to the native Antigravity agent. The embedded Gemini website does not receive these tools.'}),
    node('a', {href: 'https://github.com/Riccardo-Vecchi/antigravity-plugin/blob/main/docs/COMPUTER_USE.md', target: '_blank', rel: 'noopener noreferrer', text: 'Computer-use setup guide'})));
  request('status', true).then(receive).catch(() => {});
 }
 function apply() {
  if (destroyed) return;
  const parent = globalThis.__AGSettingsNavigation?.getPage();
  if (!parent) return;
  if (!section) build();
  if (section.parentElement !== parent) parent.append(section);
  paint();
 }
 const style = node('style', {id: 'agpa-computer-use-styles', text: `
  .agpa-cu-panel{display:flex;flex-direction:column;gap:18px;color:var(--foreground,#eee);font-size:13px}
  .agpa-cu-panel p{margin:0;line-height:1.55}.agpa-cu-hero{display:flex;align-items:center;gap:10px;margin-top:4px}
  .agpa-cu-hero h3{font-size:18px;font-weight:500;margin:0}.agpa-cu-status-dot{width:9px;height:9px;background:#888;border-radius:50%}
  .agpa-cu-panel[data-state=enabled] .agpa-cu-status-dot{background:#55c98a}.agpa-cu-panel[data-state=attention] .agpa-cu-status-dot{background:#e5b35e}
  .agpa-cu-panel[data-state=error] .agpa-cu-status-dot{background:#e66d6d}.agpa-cu-summary{color:var(--muted-foreground,#aaa);font-size:14px}
  .agpa-cu-scopes{border:0;padding:0;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .agpa-cu-scopes legend{font-weight:500;margin-bottom:12px}.agpa-cu-scope-card{display:flex;align-items:flex-start;gap:10px;padding:16px;border:1px solid var(--border,#353535);border-radius:12px;cursor:pointer}
  .agpa-cu-scope-card:has(input:checked){border-color:#398bdb;background:color-mix(in srgb,#398bdb 8%,transparent)}
  .agpa-cu-scope-card input{margin-top:3px;accent-color:#398bdb}.agpa-cu-scope-card strong{display:block;font-size:14px;margin-bottom:5px}
  .agpa-cu-muted{display:block;color:var(--muted-foreground,#aaa);font-size:12px;line-height:1.5}
  .agpa-cu-selected{display:flex;flex-direction:column;gap:10px}.agpa-cu-panel [hidden]{display:none!important}
  .agpa-cu-apps{box-sizing:border-box;width:100%;padding:10px;border:1px solid var(--border,#444);border-radius:8px;background:var(--background,#111);color:inherit;font:12px monospace;resize:vertical}
  .agpa-cu-primary{background:var(--foreground,#eee)!important;color:var(--background,#111)!important;font-weight:500}
  .agpa-cu-notice{padding:12px;border:1px solid var(--border,#353535);border-radius:10px;color:var(--muted-foreground,#aaa)}
  .agpa-cu-examples{padding:16px;border-radius:12px;background:var(--secondary,#1d1d1d);display:flex;flex-direction:column;gap:8px}
  .agpa-cu-examples p{color:var(--muted-foreground,#aaa)}.agpa-cu-advanced{border-top:1px solid var(--border,#353535);padding-top:16px}
  .agpa-cu-advanced summary{cursor:pointer;color:var(--muted-foreground,#aaa)}.agpa-cu-advanced>*:not(summary){margin-top:12px}
  @media(max-width:700px){.agpa-cu-scopes{grid-template-columns:1fr}}
 `});
 document.head.append(style);
 function schedule() {if (scheduled || destroyed) return;scheduled = true;queueMicrotask(() => {scheduled = false;apply();});}
 const observer = new MutationObserver(schedule);observer.observe(document.body, {subtree: true, childList: true});
 const interval = setInterval(() => {if (!section?.isConnected || !globalThis.__AGSettingsNavigation?.isOpen() || busy) return;request('status', true).then(receive).catch(() => {});}, 1500);
 window.addEventListener('agpa:settings-page', schedule);
 const untranslate = i18n.subscribe(paint);
 globalThis.__AGComputerUse = {version: VERSION, status: () => ({...state, mounted: !!section?.isConnected}),
  onResult(id, ok, next) {const item = pending.get(id);if (!item) return;clearTimeout(item.timer);pending.delete(id);ok ? item.resolve(next) : item.reject(Error('operationFailed'));},
  destroy() {globalThis.__AGPA_CU_DRAFT__ = {apps: section?.querySelector('textarea')?.value ?? draft, scope: scopeDraft};destroyed = true;observer.disconnect();clearInterval(interval);window.removeEventListener('agpa:settings-page', schedule);untranslate();for (const item of pending.values()) {clearTimeout(item.timer);item.reject(Error('stopped'));}pending.clear();section?.remove();style.remove();delete globalThis.__AGComputerUse;}};
 schedule();
})();
