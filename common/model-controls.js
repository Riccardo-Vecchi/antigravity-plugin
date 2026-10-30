/* Separate model/effort controls, delegating selection to native menu items. */
(() => {
  'use strict';
  const VERSION = '1.0.0';
  if (globalThis.__AGModelControls?.version === VERSION) return;
  globalThis.__AGModelControls?.destroy();
  const rules = globalThis.__AGPA_MODEL_CONTROLS__;
  delete globalThis.__AGPA_MODEL_CONTROLS__;
  const i18n = globalThis.__AGPAI18n;
  const controls = new Map(), unsupported = new Set();
  let session = null, stopped = false, scheduled = false, bypass = false;
  const attributes = ['data-agpa-composer-footer', 'data-agpa-footer-flat', 'data-agpa-footer-model', 'data-agpa-footer-permission', 'data-agpa-footer-tail', 'data-agpa-effort-suffix'];
  const mark = (node, attribute) => { if (!node.hasAttribute(attribute)) node.setAttribute(attribute, ''); };
  const t = (key, values) => i18n.t(key, values);
  function element(tag, attributes = {}, text) {
    const node = document.createElement(tag);
    node.setAttribute('data-agpa-effort-ui', '');
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const saved = base => globalThis.__AGModelUI?.status().preferences.models[base]?.effort;
  async function remember(base, value) {
    if (saved(base) !== value) await globalThis.__AGModelUI?.setEffort(base, value);
  }
  const tick = () => new Promise(resolve => setTimeout(resolve, 20));
  async function until(read, current) {
    const deadline = Date.now() + 1200;
    while (!stopped && session === current && Date.now() < deadline) {
      const result = read();
      if (result) return result;
      await tick();
    }
    throw Error('Native model menu unavailable');
  }
  function close({native = true, focus = false} = {}) {
    const current = session;
    session = null;
    document.documentElement.removeAttribute('data-agpa-effort-bridge');
    if (!current) return;
    try { current.popup?.hidePopover(); } catch { /* Native menu was already removed. */ }
    current.popup?.remove();
    current.button?.setAttribute('aria-expanded', 'false');
    if (native && current.trigger.isConnected && current.trigger.getAttribute('aria-expanded') === 'true') current.trigger.click();
    if (focus) queueMicrotask(() => current.button?.isConnected && current.button.focus());
  }
  function fallback(current, unsupportedMenu = true) {
    if (session !== current) return;
    close({native: false});
    // A new/unsupported native menu keeps working instead of accepting a fake level.
    if (unsupportedMenu) unsupported.add(current.base);
    schedule();
    if (current.preferred && current.group?.isConnected) {
      bypass = true;
      try { current.group.click(); } finally { bypass = false; }
    } else current.group?.focus();
  }
  async function commit(current, index) {
    if (session !== current || current.committing) return;
    const option = current.options[index];
    if (!option?.row.isConnected || !current.trigger.isConnected) { close(); return; }
    const before = rules.selectionFor(current.trigger);
    if (before?.base !== current.origin.base || before.effortLabel !== current.origin.effortLabel) { close(); return; }
    if (current.base === before.base && option.label === before.effortLabel) { close({focus: true}); return; }
    current.committing = true;
    if (current.range) current.range.disabled = true;
    option.row.click();
    try {
      await until(() => {
        const selected = rules.selectionFor(current.trigger);
        return selected?.base === current.base && selected.effortLabel === option.label;
      }, current);
      close({focus: !current.preferred});
      await remember(current.base, option.value);
    } finally {
      if (session === current) close({focus: !current.preferred});
      schedule();
    }
  }
  function position(current) {
    if (!current.popup || !current.button.isConnected) return;
    const anchor = current.button.getBoundingClientRect(), popup = current.popup.getBoundingClientRect();
    current.popup.style.left = Math.max(8, Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 8)) + 'px';
    current.popup.style.top = Math.max(8, anchor.top - popup.height - 8) + 'px';
    if (anchor.top < popup.height + 16) current.popup.style.top = Math.min(anchor.bottom + 8, window.innerHeight - popup.height - 8) + 'px';
  }
  function paintValue(current, index) {
    const option = current.options[index];
    current.value.textContent = option.label;
    current.range.setAttribute('aria-valuetext', option.label);
    current.range.style.setProperty('--effort-fill', (index / (current.options.length - 1) * 100) + '%');
    for (const [n, dot] of [...current.dots.children].entries()) dot.toggleAttribute('data-active', n <= index);
  }
  function showSlider(current) {
    const popup = element('div', {popover: 'manual', role: 'dialog', 'aria-label': t('Reasoning effort'), class: 'agpa-effort-popup'});
    const heading = element('div', {class: 'agpa-effort-heading'});
    const labels = element('div', {class: 'agpa-effort-labels'});
    current.value = element('strong');
    labels.append(current.value, element('span', {class: 'agpa-effort-model'}, current.base));
    const dismiss = element('button', {type: 'button', class: 'agpa-effort-close', 'aria-label': t('Close')}, '×');
    dismiss.addEventListener('click', () => close({focus: true}));
    heading.append(labels, dismiss);
    const track = element('div', {class: 'agpa-effort-track'});
    current.range = element('input', {type: 'range', min: '0', max: String(current.options.length - 1), step: '1', 'aria-label': t('Reasoning effort')});
    current.dots = element('div', {class: 'agpa-effort-dots', 'aria-hidden': 'true'});
    for (const option of current.options) current.dots.append(element('span', {title: option.label}));
    track.append(current.range, current.dots);
    const extremes = element('div', {class: 'agpa-effort-extremes', 'aria-hidden': 'true'});
    extremes.append(element('span', {}, current.options[0].label), element('span', {}, current.options.at(-1).label));
    popup.append(heading, track, extremes);
    current.popup = popup;
    // Keeping this a DOM descendant of the native submenu preserves its focus /
    // outside-dismiss behavior. The top layer paints it above the cloaked menus.
    current.menu.append(popup);
    const index = Math.max(0, current.options.findIndex(option => option.selected || option.label === current.origin.effortLabel));
    current.range.value = String(index);
    paintValue(current, index);
    current.range.addEventListener('input', () => paintValue(current, Number(current.range.value)));
    current.range.addEventListener('change', () => { if (!current.keyboardEditing) commit(current, Number(current.range.value)).catch(() => close()); });
    popup.showPopover();
    position(current);
    current.range.focus({preventScroll: true});
    current.button.setAttribute('aria-expanded', 'true');
  }
  async function open(trigger, button, preferred, group) {
    close();
    const origin = rules.selectionFor(trigger);
    if (!origin || !trigger.isConnected) return;
    const current = {trigger, button, origin, base: group?.querySelector('[data-testid=model-selector-effort-group]')?.dataset.modelBase || origin.base, preferred, group};
    session = current;
    document.documentElement.setAttribute('data-agpa-effort-bridge', '');
    try {
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
      current.group = await until(() => {
        const panel = document.querySelector('[data-testid=model-selector-panel]');
        return [...(panel?.querySelectorAll('[data-testid=model-selector-effort-group]') || [])]
          .find(node => node.dataset.modelBase === current.base)?.closest('[role=menuitem]');
      }, current);
      if (current.group.getAttribute('aria-disabled') === 'true' || current.group.hasAttribute('data-disabled')) { fallback(current); return; }
      current.group.focus({preventScroll: true});
      for (const type of ['keydown', 'keyup']) current.group.dispatchEvent(new KeyboardEvent(type, {key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true}));
      current.menu = await until(() => [...document.querySelectorAll('[role=menu]')].find(menu => menu.getAttribute('aria-labelledby') === current.group.id), current);
      current.options = rules.optionsFor(current.menu);
      if (!current.options.length) { fallback(current); return; }
      if (preferred) {
        const index = current.options.findIndex(option => option.value === preferred);
        if (index < 0) { fallback(current, false); return; }
        await commit(current, index);
      } else showSlider(current);
    } catch {
      fallback(current);
    }
  }
  function apply() {
    scheduled = false;
    if (stopped) return;
    if (session && !session.committing) {
      const selected = rules.selectionFor(session.trigger);
      if (!session.trigger.isConnected || (session.popup && (!session.menu.isConnected || session.trigger.getAttribute('aria-expanded') !== 'true' || selected?.base !== session.origin.base || selected.effortLabel !== session.origin.effortLabel))) close({native: false});
    }
    for (const [trigger, button] of controls) {
      const selection = trigger.isConnected && rules.selectionFor(trigger);
      if (!selection?.effortLabel || unsupported.has(selection.base)) {
        button.remove(); controls.delete(trigger);
        trigger.querySelector('[data-agpa-effort-suffix]')?.removeAttribute('data-agpa-effort-suffix');
      }
    }
    for (const trigger of document.querySelectorAll('[data-testid=model-selector-trigger]')) {
      const selection = rules.selectionFor(trigger);
      const permission = (() => {
        let root = trigger.parentElement;
        while (root && !root.classList.contains('@container/input-footer')) root = root.parentElement;
        return root?.querySelector('[data-testid=permissions-selector-trigger]');
      })();
      const layout = rules.layoutFor(trigger, permission);
      if (layout) {
        mark(layout.footer, 'data-agpa-composer-footer');
        for (const node of layout.flatten) mark(node, 'data-agpa-footer-flat');
        for (const node of layout.tail) mark(node, 'data-agpa-footer-tail');
        mark(trigger, 'data-agpa-footer-model');
        mark(permission, 'data-agpa-footer-permission');
      }
      if (!selection?.effortLabel || unsupported.has(selection.base)) continue;
      let button = controls.get(trigger);
      if (!button) {
        button = element('button', {type: 'button', class: 'agpa-effort-trigger', 'aria-haspopup': 'dialog', 'aria-expanded': 'false'});
        button.addEventListener('pointerdown', event => event.preventDefault());
        button.addEventListener('click', event => {event.preventDefault(); event.stopPropagation(); session?.trigger === trigger ? close({focus: true}) : open(trigger, button);});
        trigger.after(button);
        controls.set(trigger, button);
      }
      if (button.textContent !== selection.effortLabel + ' ⌄') button.textContent = selection.effortLabel + ' ⌄';
      button.setAttribute('aria-label', t('Reasoning effort: {effort}', {effort: selection.effortLabel}));
      button.title = t('Reasoning effort');
      button.disabled = trigger.disabled;
      mark(selection.suffix, 'data-agpa-effort-suffix');
    }
  }
  function schedule() { if (!scheduled && !stopped) { scheduled = true; queueMicrotask(apply); } }
  function click(event) {
    if (bypass || session || event.target.closest?.('[data-agpa-model-ui],[data-agpa-effort-ui]')) return;
    const option = event.target.closest?.('[data-testid=model-selector-effort-option]') || event.target.closest?.('[role=menuitemradio]')?.querySelector('[data-testid=model-selector-effort-option]');
    if (option) {
      const menu = option.closest('[role=menu]'), group = document.getElementById(menu?.getAttribute('aria-labelledby'));
      const base = group?.querySelector('[data-testid=model-selector-effort-group]')?.dataset.modelBase;
      if (base && !option.closest('[aria-disabled=true],[data-disabled]')) setTimeout(() => {
        const trigger = [...document.querySelectorAll('[data-testid=model-selector-trigger]')].find(node => rules.selectionFor(node)?.base === base);
        if (rules.selectionFor(trigger)?.effortLabel === option.textContent.trim()) remember(base, option.dataset.effort).catch(() => {});
      }, 80);
      return;
    }
    const group = event.target.closest?.('[role=menuitem][aria-haspopup=menu]');
    const base = group?.querySelector('[data-testid=model-selector-effort-group]')?.dataset.modelBase, preferred = base && saved(base);
    if (!preferred || unsupported.has(base) || group.getAttribute('aria-disabled') === 'true' || group.hasAttribute('data-disabled')) return;
    const trigger = document.querySelector('[data-testid=model-selector-trigger][aria-expanded=true]');
    if (!trigger) return;
    event.preventDefault(); event.stopImmediatePropagation();
    open(trigger, controls.get(trigger), preferred, group);
  }
  function keyboard(event) {
    const current = session;
    if (current?.popup && event.target.closest?.('[data-agpa-effort-ui]')) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close({focus: true}); return; }
      if (event.target === current.range && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        current.keyboardEditing = true; event.stopImmediatePropagation(); return;
      }
      if (event.key === 'Tab') {
        event.preventDefault(); event.stopImmediatePropagation();
        (event.target === current.range ? current.popup.querySelector('button') : current.range).focus(); return;
      }
    }
    // CSS ordering does not change DOM Tab order. Match the visible toolbar order.
    if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
    const footer = event.target.closest?.('[data-agpa-composer-footer]');
    if (!footer || document.querySelector('[role=menu][data-open]')) return;
    const buttons = [...footer.querySelectorAll('button:not(:disabled)')].filter(node => node.tabIndex >= 0 && node.getClientRects().length)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const index = buttons.indexOf(event.target), next = index + (event.shiftKey ? -1 : 1);
    if (index >= 0 && next >= 0 && next < buttons.length) { event.preventDefault(); event.stopImmediatePropagation(); buttons[next].focus(); }
  }
  function keyup(event) {
    if (session?.keyboardEditing && event.target === session.range) {
      session.keyboardEditing = false; event.stopImmediatePropagation();
      commit(session, Number(session.range.value)).catch(() => close());
    }
  }
  const style = element('style');
  style.textContent = `
  [data-agpa-composer-footer]{gap:4px!important;flex-wrap:wrap}
  [data-agpa-footer-flat]{display:contents!important}
  [data-agpa-footer-model]{order:20;margin-inline-start:auto;max-width:min(52%,320px)!important}
  [data-agpa-footer-permission]{order:1}
  [data-agpa-footer-tail]{order:40}
  [data-agpa-effort-suffix]{display:none!important}
  .agpa-effort-trigger{order:21;height:28px;flex-shrink:0;border:0;border-radius:999px;background:transparent;color:var(--secondary-foreground,#aaa);font:inherit;font-size:12px;padding:0 8px;cursor:pointer;white-space:nowrap}
  .agpa-effort-trigger:hover,.agpa-effort-trigger[aria-expanded=true]{background:var(--secondary,#303030);color:var(--foreground,#eee)}
  .agpa-effort-trigger:focus-visible{outline:2px solid #398bdb;outline-offset:2px}.agpa-effort-trigger:disabled{opacity:.5;cursor:default}
  :root[data-agpa-effort-bridge] [role=menu]{opacity:0!important;pointer-events:none!important}
  .agpa-effort-popup{position:fixed;inset:auto;margin:0;width:252px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:12px;border:1px solid var(--border,#444);border-radius:16px;background:var(--card,#252525);color:var(--foreground,#eee);font:12px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px #0005;pointer-events:auto!important;opacity:1!important}
  .agpa-effort-popup::backdrop{background:transparent}
  .agpa-effort-heading{display:grid;grid-template-columns:22px minmax(0,1fr) 22px;align-items:center;gap:6px;margin-bottom:9px}.agpa-effort-labels{grid-column:2;min-width:0;text-align:center;display:grid;gap:1px}.agpa-effort-labels strong{font-size:13px;font-weight:500;color:#6ba9ff}.agpa-effort-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--secondary-foreground,#aaa);font-size:11px}.agpa-effort-close{grid-column:3;border:0;background:transparent;color:var(--secondary-foreground,#aaa);font:18px/1 system-ui;cursor:pointer;padding:3px;border-radius:4px}.agpa-effort-close:focus-visible{outline:2px solid #398bdb}
  .agpa-effort-track{position:relative;height:28px;display:flex;align-items:center}.agpa-effort-track input{appearance:none;width:100%;height:24px;margin:0;border:0;border-radius:999px;background:linear-gradient(to right,#347df1 0 var(--effort-fill),#454545 var(--effort-fill) 100%);cursor:pointer;position:relative;z-index:1;outline:none}.agpa-effort-track input::-webkit-slider-thumb{appearance:none;width:25px;height:25px;border-radius:50%;background:#fff;border:1px solid #ddd;box-shadow:0 1px 3px #0003}.agpa-effort-track input:focus-visible{outline:2px solid #90baff;outline-offset:3px}.agpa-effort-track input:disabled{cursor:wait}
  .agpa-effort-dots{position:absolute;inset:0 12px;display:flex;align-items:center;justify-content:space-between;pointer-events:none;z-index:2}.agpa-effort-dots span{width:4px;height:4px;border-radius:50%;background:#858585}.agpa-effort-dots span[data-active]{background:#9cbeff}.agpa-effort-extremes{display:flex;justify-content:space-between;color:var(--secondary-foreground,#aaa);font-size:10px;margin-top:4px}
  `;
  document.head.append(style);
  const observer = new MutationObserver(records => {
    if (records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target?.closest('[data-agpa-effort-ui]')) return false;
      const nodes = [...record.addedNodes, ...record.removedNodes];
      if (nodes.length && nodes.every(node => node.nodeType === 1 && node.hasAttribute('data-agpa-effort-ui'))) return false;
      return target?.closest('[data-testid=model-selector-trigger],[data-testid=model-selector-panel],[role=menu]') || nodes.some(node => node.nodeType === 1 && (node.matches('[data-testid=model-selector-trigger],[data-testid=permissions-selector-trigger],[role=menu]') || node.querySelector('[data-testid=model-selector-trigger],[data-testid=permissions-selector-trigger]')));
    })) schedule();
  });
  observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-label', 'disabled']});
  document.addEventListener('click', click, true);
  window.addEventListener('keydown', keyboard, true);
  window.addEventListener('keyup', keyup, true);
  const reposition = () => session && position(session);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  const unsubscribe = i18n.subscribe(schedule);
  globalThis.__AGModelControls = {
    version: VERSION,
    status: () => ({controls: controls.size, open: !!session?.popup, unsupported: [...unsupported]}),
    destroy() {
      stopped = true; close(); observer.disconnect(); unsubscribe();
      document.removeEventListener('click', click, true);
      window.removeEventListener('keydown', keyboard, true); window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true);
      for (const button of controls.values()) button.remove(); controls.clear(); style.remove();
      for (const attribute of attributes) for (const node of document.querySelectorAll('[' + attribute + ']')) node.removeAttribute(attribute);
      delete globalThis.__AGModelControls;
    }
  };
  schedule();
})();
