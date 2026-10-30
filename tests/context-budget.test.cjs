'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const rules = require('../common/context-budget.cjs');
const script = fs.readFileSync(path.join(__dirname, '../common/context-budget.js'), 'utf8');

test('estimateTokens calculates text tokens and turn overhead accurately', () => {
  assert.equal(rules.estimateTokens(0, 0), 0);
  assert.equal(rules.estimateTokens(400, 1), 100 + 120);
  assert.equal(rules.estimateTokens(4000, 5), 1000 + 600);
});

test('budgetLevelFor categorizes tokens into healthy, moderate, elevated, and saturated', () => {
  assert.equal(rules.budgetLevelFor(5000).level, 'healthy');
  assert.equal(rules.budgetLevelFor(40000).level, 'moderate');
  assert.equal(rules.budgetLevelFor(100000).level, 'elevated');
  assert.equal(rules.budgetLevelFor(200000).level, 'saturated');
  assert.equal(rules.budgetLevelFor(200000).color, '#ff666a');
});

test('formatTokens formats token counts cleanly', () => {
  assert.equal(rules.formatTokens(450), '450');
  assert.equal(rules.formatTokens(1240), '~1k');
  assert.equal(rules.formatTokens(45200), '~45k');
  assert.equal(rules.formatTokens(185000), '~185k');
});

test('extractConversationStats extracts chars, turns, and budget from document', () => {
  rules.clearCache();
  const doc = {
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return { textContent: 'a'.repeat(40000) };
      }
      return null;
    },
    querySelectorAll: sel => {
      if (sel === '[data-testid=conversation-navigator-turn]') {
        return [{}, {}, {}];
      }
      return [];
    }
  };
  const stats = rules.extractConversationStats(doc);
  assert.equal(stats.chars, 40000);
  assert.equal(stats.turns, 3);
  assert.equal(stats.tokens, 10000 + 360);
  assert.equal(stats.budget.level, 'healthy');
  assert.equal(stats.formatted, '~10k');
});

test('extractConversationStats retains cumulative token knowledge when scrolling down virtualizes messages', () => {
  rules.clearCache();
  const convPath = '/c/test-virtualization';
  let mountedChars = 10000;
  const navTurns = 6;
  const doc = {
    location: { pathname: convPath },
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return { textContent: 'a'.repeat(mountedChars) };
      }
      return null;
    },
    querySelectorAll: sel => {
      if (sel === '[data-testid=conversation-navigator-turn]') {
        return new Array(navTurns).fill({});
      }
      return [];
    }
  };

  const initial = rules.extractConversationStats(doc);
  assert.equal(initial.chars, 10000);
  assert.equal(initial.turns, 6);

  // User scrolls up: older messages load into DOM
  mountedChars = 60000;
  const atTop = rules.extractConversationStats(doc);
  assert.equal(atTop.chars, 60000);
  assert.equal(atTop.turns, 6);

  // User scrolls back down: earlier messages unmount from DOM
  mountedChars = 10000;
  const backAtBottom = rules.extractConversationStats(doc);
  assert.equal(backAtBottom.chars, 60000, 'chars does not drop when earlier messages are virtualized out');
  assert.equal(backAtBottom.turns, 6);
  assert.equal(backAtBottom.tokens, atTop.tokens, 'tokens remain stable when scrolling back down');

  // Switching conversation resets context
  doc.location.pathname = '/c/another-conversation';
  mountedChars = 15000;
  const other = rules.extractConversationStats(doc);
  assert.equal(other.chars, 15000, 'different conversation uses its own independent measurement');
});

test('context budget component attaches pill, reflects levels and allows inserting /compact', async () => {
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
        return { left: 100, right: 300, top: 200, bottom: 224, width: 200, height: 24 };
      },
      offsetHeight: 100,
      focus() {}
    };
  }

  function matches(node, selector) {
    if (!node || !node.tagName) return false;
    if (selector === '[data-agpa-context-budget]') return node.hasAttribute('data-agpa-context-budget');
    if (selector === '[data-agpa-context-ui]') return node.hasAttribute('data-agpa-context-ui');
    if (selector === '.agpa-context-pill') return node.classList.contains('agpa-context-pill');
    if (selector === '.agpa-context-popup') return node.classList.contains('agpa-context-popup');
    if (selector === '.agpa-context-close') return node.classList.contains('agpa-context-close');
    if (selector === '.agpa-context-compact-btn') return node.classList.contains('agpa-context-compact-btn');
    if (selector === '.surface-composer') return node.classList.contains('surface-composer');
    if (selector === '[data-testid=autoscroll-viewport]') return node.getAttribute('data-testid') === 'autoscroll-viewport';
    if (selector === '[data-testid=conversation-navigator-turn]') return node.getAttribute('data-testid') === 'conversation-navigator-turn';
    if (selector.includes('input-footer')) return node.className.includes('input-footer');
    if (selector.includes('role=combobox')) return node.getAttribute('role') === 'combobox';
    return false;
  }

  const html = makeNode('html');
  const head = makeNode('head');
  const body = makeNode('body');
  html.append(head, body);

  const composer = makeNode('div');
  composer.className = 'surface-composer';
  const editor = makeNode('div');
  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('role', 'combobox');
  composer.append(editor);

  let pastedData = '';
  editor.addEventListener('paste', e => {
    pastedData = e.clipboardData?.getData('text/plain') || '';
    editor.textContent = pastedData;
  });

  const footer = makeNode('div');
  footer.className = '@container/input-footer fixture-footer';
  composer.append(footer);

  const viewport = makeNode('div');
  viewport.setAttribute('data-testid', 'autoscroll-viewport');
  viewport.textContent = 'Conversation text '.repeat(1000); // ~18000 chars

  body.append(viewport, composer);

  // Add 10 turns
  for (let i = 0; i < 10; i++) {
    const turn = makeNode('div');
    turn.setAttribute('data-testid', 'conversation-navigator-turn');
    body.append(turn);
  }

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
    DataTransfer: class {
      constructor() { this.data = new Map(); }
      setData(k, v) { this.data.set(k, v); }
      getData(k) { return this.data.get(k) || ''; }
    },
    ClipboardEvent: class {
      constructor(type, init) {
        this.type = type;
        this.clipboardData = init?.clipboardData;
      }
    },
    __AGPA_CONTEXT_BUDGET__: rules,
    __AGPAI18n: { t: (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, n) => v[n] || '') }
  };

  vm.createContext(context);
  vm.runInContext(script, context);

  const pill = footer.querySelector('[data-agpa-context-budget]');
  assert.ok(pill, 'context budget pill attached to footer');
  assert.ok(pill.textContent.includes('k'), 'pill shows estimated k tokens');

  // Click pill to open popover
  pill.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  const popup = body.querySelector('.agpa-context-popup');
  assert.ok(popup, 'popover opens on pill click');
  popup.querySelector('.agpa-context-close').dispatchEvent({ type: 'click' });
  assert.equal(body.querySelector('.agpa-context-popup'), null, 'close button dismisses popup');

  // Saturated test
  viewport.textContent = 'Large conversation '.repeat(40000); // 760,000 chars
  context.__AGContextBudget.refresh();

  assert.equal(pill.getAttribute('data-level'), 'saturated');
  assert.ok(pill.textContent.includes('/compact'), 'saturated pill mentions /compact');

  // Click pill to open popover and click /compact button
  pill.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  const compactBtn = body.querySelector('.agpa-context-compact-btn');
  assert.ok(compactBtn, 'insert /compact button appears when saturated');

  compactBtn.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  assert.equal(pastedData, '/compact ', 'insert /compact inserts command into composer editor');

  // Clean destruction
  context.__AGContextBudget.destroy();
  assert.equal(footer.querySelector('[data-agpa-context-budget]'), null, 'destroy removes pill');
  assert.equal(context.__AGContextBudget, undefined, 'destroy deletes global instance');
});
