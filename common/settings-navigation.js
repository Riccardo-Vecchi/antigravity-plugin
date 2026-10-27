/* Small, reversible additions to the native Settings navigation. */
(() => {
 'use strict';
 const VERSION = '1.0.0';
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
  computer: 'M3 4h18v13H3zM8 21h8M12 17v4m-4-10 4 3-3 4',
  chevron: 'm9 5 7 7-7 7',
 };
 function icon(name) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [key, value] of Object.entries({width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', 'data-agpa-settings-icon': ''})) svg.setAttribute(key, value);
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', paths[name] || paths.folder); svg.append(p); return svg;
 }
 let active = false, page, host, dialog, nativeFrame, navigation, projectButton, scheduled = false, stopped = false;
 let collapsed = false;
 try {collapsed = localStorage.getItem('agpa.settings.projectsCollapsed') === 'true';} catch {}
 const style = document.createElement('style'); style.id = 'agpa-settings-navigation-styles';
 style.textContent = `
  [data-agpa-settings-icon]{flex-shrink:0;opacity:.85;margin-right:3px}
  [data-agpa-native-settings-hidden]{display:none!important}
  .agpa-settings-page{position:absolute;inset:0;overflow:auto;background:var(--background,#111);z-index:2}
  .agpa-settings-page[hidden]{display:none}
  .agpa-settings-page-inner{max-width:672px;margin:auto;padding:24px;display:flex;flex-direction:column;gap:18px}
  .agpa-settings-page-title{display:flex;align-items:center;justify-content:space-between;gap:16px}
  .agpa-settings-page-title h2{font-size:20px;font-weight:500;margin:0;display:flex;align-items:center;gap:10px}
  .agpa-settings-close{border:0;background:none;color:inherit;font-size:22px;cursor:pointer;padding:0 5px}
  [data-agpa-cu-nav][aria-current=page]{background:var(--sidebar-secondary,#333);color:var(--foreground,#eee)}
  [data-agpa-cu-active] [data-testid^=settings-nav-item-].bg-sidebar-secondary{background:transparent;color:var(--secondary-foreground,#aaa)}
  [data-agpa-cu-active] [data-testid^=settings-nav-item-].bg-sidebar-secondary>span{color:var(--secondary-foreground,#aaa)}
  [data-agpa-projects-heading]{display:none}
  [data-agpa-projects-toggle]{display:flex;align-items:center;gap:5px;width:100%;border:0;padding:0;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left}
  [data-agpa-projects-toggle] svg:last-child{margin-left:auto;transition:transform .15s}
  [data-agpa-projects-toggle][aria-expanded=true] svg:last-child{transform:rotate(90deg)}
  [data-agpa-projects-group][data-collapsed=true]{display:none!important}
 `;
 document.head.append(style);
 function setActive(value) {
  active = !!value && !!page?.isConnected;
  if (page) page.hidden = !active;
  if (nativeFrame) nativeFrame.toggleAttribute('data-agpa-native-settings-hidden', active);
  dialog?.toggleAttribute('data-agpa-cu-active', active);
  if (navigation) navigation.setAttribute('aria-current', active ? 'page' : 'false');
  window.dispatchEvent(new CustomEvent('agpa:settings-page', {detail: {computerUse: active}}));
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
  if (!navigation?.isConnected) {
   const wrapper = document.createElement('div'); wrapper.className = app.parentElement.className; wrapper.dataset.agpaCuNavWrapper = '';
   navigation = document.createElement('button'); navigation.type = 'button'; navigation.className = app.className.replace('bg-sidebar-secondary', 'hover:bg-sidebar-muted'); navigation.dataset.agpaCuNav = '';
   const label = document.createElement('span'); label.className = 'text-sm truncate flex-1'; i18n.set(label, 'Computer use');
   i18n.set(navigation, 'Computer use', {}, 'title');
   navigation.append(icon('computer'), label); navigation.addEventListener('click', () => setActive(true)); wrapper.append(navigation);
   app.parentElement.after(wrapper);
  }
  const heading = [...dialog.querySelectorAll('h2')].find(h => h.closest('div.p-6'));
  const frame = heading?.closest('div.p-6')?.closest('div.flex.w-full.h-full.overflow-auto.min-h-0');
  if (frame && (!page?.isConnected || host !== frame.parentElement)) {
   if (nativeFrame) nativeFrame.removeAttribute('data-agpa-native-settings-hidden');
   page?.remove(); nativeFrame = frame; host = frame.parentElement;
   page = document.createElement('div'); page.className = 'agpa-settings-page'; page.hidden = !active; page.dataset.agpaComputerPage = '';
   const inner = document.createElement('div'); inner.className = 'agpa-settings-page-inner';
   const header = document.createElement('div'); header.className = 'agpa-settings-page-title';
   const title = document.createElement('h2'); const label = document.createElement('span'); i18n.set(label, 'Computer use'); title.append(icon('computer'), label);
   header.append(title); inner.append(header); page.append(inner); host.append(page);
   if (active) nativeFrame.setAttribute('data-agpa-native-settings-hidden', '');
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
 globalThis.__AGSettingsNavigation = {version: VERSION, getPage: () => page?.isConnected ? page.firstElementChild : null, isOpen: () => active,
  setProjectStyles(next) {projectStyles = next || {projects:{}};schedule();},
  open() {apply(); setActive(true);}, icon,
  destroy() {setActive(false); stopped = true; observer.disconnect(); document.removeEventListener('click', onClick, true); page?.remove(); navigation?.parentElement?.remove(); projectButton?.remove(); for (const e of document.querySelectorAll('[data-agpa-settings-icon]')) e.remove(); for (const e of document.querySelectorAll('[data-agpa-projects-heading],[data-agpa-projects-group]')) {e.removeAttribute('data-agpa-projects-heading');e.removeAttribute('data-agpa-projects-group');e.removeAttribute('data-collapsed');} style.remove(); delete globalThis.__AGSettingsNavigation;}};
 schedule();
})();
