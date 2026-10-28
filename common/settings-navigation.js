/* Small, reversible additions to the native Settings navigation. */
(() => {
 'use strict';
 const VERSION = '1.2.1';
 if (globalThis.__AGSettingsNavigation?.version === VERSION) return;
 globalThis.__AGSettingsNavigation?.destroy();
 const i18n = globalThis.__AGPAI18n;
 let projectStyles = globalThis.__AGPA_SETTINGS_PROJECT_STYLES__ || {projects:{}};
 delete globalThis.__AGPA_SETTINGS_PROJECT_STYLES__;
 const NS = 'http://www.w3.org/2000/svg';
 const paths = {
  General: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  App: 'M4 4h16v12H4zM8 20h8M12 16v4',
  Appearance: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.6 1.6 0 0 1 1-2.8h2a4 4 0 0 0 4-4C21 6 17 3 12 3ZM7 10h.01M10 6h.01M15 6h.01M18 10h.01',
  Notifications: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  Models: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  Conversations: 'M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z',
  Shortcuts: 'M3 5h18v14H3zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8',
  'Provide Feedback': 'M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5ZM12 7v6M9 10h6',
  folder: 'M3 6h7l2 3h9v11H3z',
  computer: 'm4 3 6.5 18 3.2-7.3L21 10.5Z',
  browser: 'M3 4h18v16H3zM3 9h18M6 6.5h.01M9 6.5h.01M12 6.5h.01',
  chevron: 'm9 5 7 7-7 7',
 };
 function icon(name) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [key, value] of Object.entries({width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', 'data-agpa-settings-icon': ''})) svg.setAttribute(key, value);
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', paths[name] || paths.folder); svg.append(p); return svg;
 }
 const pages = new Map(), navigations = new Map();
 const definitions = [['computer','Computer use','computer'],['browser','Browser use','browser']];
 let active = false, host, dialog, nativeFrame, projectButton, scheduled = false, stopped = false;
 let collapsed = false;
 try {collapsed = localStorage.getItem('agpa.settings.projectsCollapsed') === 'true';} catch {}
 const style = document.createElement('style'); style.id = 'agpa-settings-navigation-styles';
 style.textContent = `
  [data-agpa-settings-icon]{flex-shrink:0;opacity:.85;margin-right:3px}
  [data-testid^=settings-nav-item-]:not(.bg-sidebar-secondary)>[data-agpa-settings-icon]:not([data-project-style]){color:var(--secondary-foreground,#9d9d9d)}
  [data-agpa-native-settings-hidden]{display:none!important}
  .agpa-settings-page{position:absolute;inset:0;overflow:auto;background:var(--background,#111);z-index:2}
  .agpa-settings-page[hidden]{display:none}
  .agpa-settings-page-inner{max-width:672px;margin:auto;padding:24px;display:flex;flex-direction:column;gap:18px}
  .agpa-settings-page-title{display:flex;align-items:center;justify-content:space-between;gap:16px}
  .agpa-settings-page-title h2{font-size:20px;font-weight:500;margin:0;display:flex;align-items:center;gap:10px}
  .agpa-settings-close{border:0;background:none;color:inherit;font-size:22px;cursor:pointer;padding:0 5px}
  [data-agpa-plugin-nav]{color:var(--secondary-foreground,#9d9d9d)}
  [data-agpa-plugin-nav][aria-current=page]{background:var(--sidebar-secondary,#333);color:var(--foreground,#ccc)}
  [data-agpa-plugin-nav][aria-current=page]>span{color:var(--foreground,#ccc)}
  [data-agpa-plugin-nav]:hover>span,[data-agpa-projects-toggle]:hover{color:var(--foreground,#ccc)}
  [data-agpa-cu-active] [data-testid^=settings-nav-item-].bg-sidebar-secondary{background:transparent;color:var(--secondary-foreground,#aaa)}
  [data-agpa-cu-active] [data-testid^=settings-nav-item-].bg-sidebar-secondary>span{color:var(--secondary-foreground,#aaa)}
  [data-agpa-projects-heading]{display:none}
  [data-agpa-projects-toggle]{display:flex;align-items:center;gap:5px;width:100%;border:0;padding:0;background:none;color:var(--secondary-foreground,#9d9d9d);font:inherit;font-size:14px;line-height:20px;cursor:pointer;text-align:left}
  [data-agpa-projects-toggle] svg:last-child{margin-left:auto;transition:transform .15s}
  [data-agpa-projects-toggle][aria-expanded=true] svg:last-child{transform:rotate(90deg)}
  [data-agpa-projects-group][data-collapsed=true]{display:none!important}
 `;
 document.head.append(style);
 function setActive(value) {
  const key = value === true ? 'computer' : value;
  active = pages.get(key)?.isConnected ? key : false;
  for (const [id,page] of pages) page.hidden = active !== id;
  if (nativeFrame) nativeFrame.toggleAttribute('data-agpa-native-settings-hidden', !!active);
  dialog?.toggleAttribute('data-agpa-cu-active', !!active);
  for (const [id,nav] of navigations) nav.setAttribute('aria-current', active === id ? 'page' : 'false');
  window.dispatchEvent(new CustomEvent('agpa:settings-page', {detail: {computerUse: active === 'computer', page: active}}));
 }
 function apply() {
  if (stopped) return;
  const app = document.querySelector('[data-testid=settings-nav-item-App]');
  const nextDialog = app?.closest('[role=dialog]');
  if (!nextDialog) {if (active) setActive(false); return;}
  dialog = nextDialog;
  for (const button of dialog.querySelectorAll('[data-testid^=settings-nav-item-]')) {
   const key = button.dataset.testid.slice('settings-nav-item-'.length);
   if (key === 'Account') continue;
   if (paths[key]) {if (!button.querySelector('[data-agpa-settings-icon]')) button.prepend(icon(key));continue;}
   const project = globalThis.__AGProjectPresentation?.byName(button.querySelector(':scope > span:not([data-agpa-settings-icon])')?.textContent || key);
   const appearance = project && projectStyles.projects?.[project.id];
   const signature = JSON.stringify([project?.id, appearance]);
   const previous = button.querySelector('[data-agpa-settings-icon]');
   if (previous?.getAttribute('data-project-style') === signature) continue;
   const visual = document.createElement('span'); visual.setAttribute('data-agpa-settings-icon', '');visual.setAttribute('aria-hidden', 'true');visual.setAttribute('data-project-style', signature);
   Object.assign(visual.style, {display:'inline-flex',alignItems:'center',justifyContent:'center',width:'16px',height:'16px',fontSize:'16px',lineHeight:'1',color:appearance?.color || 'inherit'});
   if (appearance?.kind === 'emoji') visual.textContent = appearance.emoji;
   else visual.append(globalThis.__AGProjectPresentation?.svg(appearance?.icon || 'folder',16) || icon('folder'));
   previous ? previous.replaceWith(visual) : button.prepend(visual);
  }
  let anchor = app.parentElement;
  for (const [key,labelKey,iconKey] of definitions) {
   let navigation = navigations.get(key);
   if (!navigation?.isConnected) {
    const wrapper = document.createElement('div'); wrapper.className = app.parentElement.className; wrapper.dataset.agpaCuNavWrapper = '';
    navigation = document.createElement('button'); navigation.type = 'button'; navigation.className = app.className.replace('bg-sidebar-secondary', 'hover:bg-sidebar-muted'); navigation.dataset.agpaPluginNav = key;
    if(key === 'computer') navigation.dataset.agpaCuNav = '';
    const label = document.createElement('span'); label.className = 'text-sm transition-colors select-none truncate flex-1 text-secondary-foreground'; i18n.set(label,labelKey);
    i18n.set(navigation,labelKey,{},'title');navigation.append(icon(iconKey),label);navigation.addEventListener('click',()=>setActive(key));wrapper.append(navigation);anchor.after(wrapper);navigations.set(key,navigation);
   }
   anchor = navigation.parentElement;
  }
  const heading = [...dialog.querySelectorAll('h2')].find(h => h.closest('div.p-6'));
  const frame = heading?.closest('div.p-6')?.closest('div.flex.w-full.h-full.overflow-auto.min-h-0');
  if (frame && (host !== frame.parentElement || !pages.get('computer')?.isConnected)) {
   nativeFrame?.removeAttribute('data-agpa-native-settings-hidden');
   for(const page of pages.values())page.remove();pages.clear();nativeFrame=frame;host=frame.parentElement;
   for(const [key,labelKey,iconKey]of definitions){
    const page=document.createElement('div');page.className='agpa-settings-page';page.hidden=active!==key;page.dataset.agpaPluginPage=key;
    if(key==='computer')page.dataset.agpaComputerPage='';
    const inner=document.createElement('div');inner.className='agpa-settings-page-inner';const header=document.createElement('div');header.className='agpa-settings-page-title';const title=document.createElement('h2'),label=document.createElement('span');i18n.set(label,labelKey);title.append(icon(iconKey),label);header.append(title);inner.append(header);page.append(inner);host.append(page);pages.set(key,page);
   }
   if(active)nativeFrame.setAttribute('data-agpa-native-settings-hidden','');
  }
  // The project group is bounded by its native heading and next sibling list.
  const projectHeading = [...dialog.querySelectorAll('h2')].find(h => {
   const group = h.parentElement.nextElementSibling;
   return group && [...group.querySelectorAll('[data-testid^=settings-nav-item-]')].some(b => !paths[b.dataset.testid.slice('settings-nav-item-'.length)] && b.dataset.testid !== 'settings-nav-item-Account');
  });
  if (projectHeading) {
   const parent = projectHeading.parentElement, group = parent.nextElementSibling;
   projectHeading.setAttribute('data-agpa-projects-heading', ''); group.setAttribute('data-agpa-projects-group', ''); group.setAttribute('data-collapsed', String(collapsed));
   if (!projectButton?.isConnected || projectButton.parentElement !== parent) {
    projectButton?.remove(); projectButton = document.createElement('button'); projectButton.type = 'button'; projectButton.dataset.agpaProjectsToggle = '';
    const label = document.createElement('span'); i18n.set(label, 'Projects'); projectButton.append(icon('folder'), label, icon('chevron'));
    projectButton.addEventListener('click', () => {collapsed = !collapsed; try {localStorage.setItem('agpa.settings.projectsCollapsed', String(collapsed));} catch {} apply();}); parent.append(projectButton);
   }
   group.id ||= 'agpa-settings-project-list';projectButton.setAttribute('aria-controls', group.id);
   projectButton.setAttribute('aria-expanded', String(!collapsed));
  }
 }
 function schedule() {if (scheduled || stopped) return; scheduled = true; queueMicrotask(() => {scheduled = false; apply();});}
 function onClick(event) {if (event.target.closest('[data-testid^=settings-nav-item-]')) setActive(false);}
 document.addEventListener('click', onClick, true);
 const observer = new MutationObserver(schedule); observer.observe(document.body, {subtree: true, childList: true});
 globalThis.__AGSettingsNavigation = {version: VERSION, getPage: (key='computer') => pages.get(key)?.isConnected ? pages.get(key).firstElementChild : null, isOpen: (key='computer') => active === key,
  setProjectStyles(next) {projectStyles = next || {projects:{}};schedule();},
  open(key='computer') {apply(); setActive(key);}, icon,
  destroy() {setActive(false); stopped = true; observer.disconnect(); document.removeEventListener('click', onClick, true); for(const page of pages.values())page.remove();for(const navigation of navigations.values())navigation.parentElement?.remove(); projectButton?.remove(); for (const e of document.querySelectorAll('[data-agpa-settings-icon]')) e.remove(); for (const e of document.querySelectorAll('[data-agpa-projects-heading],[data-agpa-projects-group]')) {e.removeAttribute('data-agpa-projects-heading');e.removeAttribute('data-agpa-projects-group');e.removeAttribute('data-collapsed');} style.remove(); delete globalThis.__AGSettingsNavigation;}};
 schedule();
})();
