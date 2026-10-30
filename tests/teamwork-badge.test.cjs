'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const rules = require('../common/teamwork-badge.cjs');
const script = fs.readFileSync(path.join(__dirname, '../common/teamwork-badge.js'), 'utf8');

test('scanSubagents finds buttons and cards with subagent messages and indicators', () => {
  const root = {
    querySelectorAll: sel => {
      if (sel.includes('button')) {
        const b1 = {
          textContent: 'Message from Teamwork Coordinator (teamwork)',
          closest: () => ({
            querySelector: s => (s.includes('spinner') ? null : null)
          })
        };
        const b2 = {
          textContent: 'Message from Task Interviewer (teamwork_interviewer)',
          closest: () => ({
            querySelector: s => (s.includes('spinner') ? {} : null)
          })
        };
        return [b1, b2];
      }
      if (sel === 'span, div') {
        return [];
      }
      return [];
    }
  };

  const list = rules.scanSubagents(root);
  assert.equal(list.length, 2);
  assert.equal(list[0].role, 'Teamwork Coordinator');
  assert.equal(list[0].typeName, 'teamwork');
  assert.equal(list[0].isRunning, false);
  assert.equal(list[1].role, 'Task Interviewer');
  assert.equal(list[1].typeName, 'teamwork_interviewer');
  assert.equal(list[1].isRunning, true);
});

test('summaryFor aggregates total, active, and determines visibility', () => {
  const subagents = [
    { role: 'A', typeName: 'a', isRunning: false },
    { role: 'B', typeName: 'b', isRunning: true }
  ];
  const s1 = rules.summaryFor(subagents, false);
  assert.equal(s1.total, 2);
  assert.equal(s1.active, 1);
  assert.equal(s1.visible, true);

  const s2 = rules.summaryFor([], false);
  assert.equal(s2.visible, false);

  const s3 = rules.summaryFor([], true);
  assert.equal(s3.visible, true);
  assert.equal(s3.total, 0);
});

test('teamwork-badge component attaches badge to toolbar and handles popover interaction', async () => {
  class FakeClassList {
    constructor() { this.classes = new Set(); }
    add(c) { this.classes.add(c); }
    remove(c) { this.classes.delete(c); }
    contains(c) { return this.classes.has(c); }
  }

  function makeNode(tag) {
    const attrs = new Map();
    const children = [];
    const listeners = new Map();
    const classList = new FakeClassList();
    let textContent = '';
    const style = {
      properties: new Map(),
      setProperty(k, v) { this.properties.set(k, v); },
      getPropertyValue(k) { return this.properties.get(k) || ''; }
    };

    return {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      classList,
      style,
      isConnected: true,
      children,
      get className() { return [...classList.classes].join(' '); },
      set className(v) { classList.classes = new Set(v.split(/\s+/).filter(Boolean)); },
      get textContent() { return textContent || children.map(c => c.textContent).join(''); },
      set textContent(v) { textContent = v; },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      append(...nodes) {
        for (const n of nodes) {
          if (!n) continue;
          n.parentElement = this;
          children.push(n);
        }
      },
      replaceChildren(...nodes) {
        for (const c of children) c.parentElement = null;
        children.length = 0;
        this.append(...nodes);
      },
      remove() {
        if (this.parentElement) {
          const idx = this.parentElement.children.indexOf(this);
          if (idx >= 0) this.parentElement.children.splice(idx, 1);
          this.parentElement = null;
        }
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const list = listeners.get(type) || [];
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      },
      dispatchEvent(event) {
        const list = listeners.get(event.type) || [];
        for (const fn of list) fn(event);
        return true;
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        const results = [];
        const parts = selector.split(',').map(s => s.trim());
        function walk(node) {
          for (const child of node.children || []) {
            if (parts.some(s => matches(child, s))) results.push(child);
            walk(child);
          }
        }
        walk(this);
        return results;
      },
      closest(selector) {
        let cur = this;
        while (cur) {
          if (matches(cur, selector)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      getBoundingClientRect() {
        return { left: 400, right: 480, top: 10, bottom: 38, width: 80, height: 28 };
      },
      scrollIntoView() {
        this.scrolled = true;
      }
    };
  }

  function matches(node, selector) {
    if (!node || !node.tagName) return false;
    const tag = node.tagName.toLowerCase();
    if (tag === selector.toLowerCase()) return true;
    if (selector === '[data-testid="pane-titlebar-toolbar"]') return node.getAttribute('data-testid') === 'pane-titlebar-toolbar';
    if (selector === '[data-testid=model-selector-trigger]') return node.getAttribute('data-testid') === 'model-selector-trigger';
    if (selector === '[data-agpa-teamwork-badge]') return node.hasAttribute('data-agpa-teamwork-badge');
    if (selector === '[data-agpa-team-ui]') return node.hasAttribute('data-agpa-team-ui');
    if (selector === '.agpa-teamwork-badge') return node.classList.contains('agpa-teamwork-badge');
    if (selector === '.agpa-team-popover') return node.classList.contains('agpa-team-popover');
    if (selector === '.agpa-team-close') return node.classList.contains('agpa-team-close');
    if (selector === '.agpa-team-item') return node.classList.contains('agpa-team-item');
    if (selector.includes('flex items-center gap-1')) return node.className.includes('flex items-center gap-1');
    return false;
  }

  const html = makeNode('html');
  const head = makeNode('head');
  const body = makeNode('body');
  html.append(head, body);

  const toolbar = makeNode('div');
  toolbar.setAttribute('data-testid', 'pane-titlebar-toolbar');
  const cluster = makeNode('div');
  cluster.className = 'flex items-center gap-1';
  toolbar.append(cluster);
  body.append(toolbar);

  // Subagent message in conversation
  const subagentBtn = makeNode('button');
  subagentBtn.textContent = 'Message from Teamwork Coordinator (teamwork)';
  body.append(subagentBtn);

  const document = {
    head,
    body,
    documentElement: html,
    createElement: tag => makeNode(tag),
    querySelector: sel => body.querySelector(sel) || head.querySelector(sel),
    querySelectorAll: sel => [...body.querySelectorAll(sel), ...head.querySelectorAll(sel)],
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const context = {
    document,
    window: {
      innerWidth: 1024,
      innerHeight: 768,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; }
      observe() {}
      disconnect() {}
    },
    queueMicrotask: fn => fn(),
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 10)),
    clearTimeout: t => clearTimeout(t),
    __AGPA_TEAMWORK_BADGE__: rules,
    __AGPAI18n: { t: (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, n) => v[n] || '') }
  };

  vm.createContext(context);
  vm.runInContext(script, context);

  const badge = toolbar.querySelector('[data-agpa-teamwork-badge]');
  assert.ok(badge, 'teamwork badge attached to toolbar cluster');
  assert.ok(badge.textContent.includes('1 subagent'), 'badge reflects single completed subagent');

  // Click badge to open popover
  badge.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  const popover = body.querySelector('.agpa-team-popover');
  assert.ok(popover, 'popover opens on badge click');

  const items = popover.querySelectorAll('.agpa-team-item');
  assert.equal(items.length, 1, 'popover lists the subagent');

  // Click subagent item to scroll
  items[0].dispatchEvent({ type: 'click' });
  assert.equal(subagentBtn.scrolled, true, 'clicking item scrolls to subagent element');
  assert.equal(body.querySelector('.agpa-team-popover'), null, 'clicking item dismisses popover');

  // Clean destruction
  context.__AGTeamworkBadge.destroy();
  assert.equal(toolbar.querySelector('[data-agpa-teamwork-badge]'), null, 'destroy removes badge');
  assert.equal(context.__AGTeamworkBadge, undefined, 'destroy deletes global instance');
});
