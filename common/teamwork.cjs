'use strict';

// Use the same native slash-command picker and rich-text paste/cut handlers as
// the user. Never manufacture a command payload or touch the clipboard itself.
function createTeamworkBridge() {
  const selector = '[data-uri="slashCommand:teamwork"],[data-uri="slashCommand:/teamwork"]';
  const sleep = () => new Promise(resolve => setTimeout(resolve, 30));
  let generation = 0, working = false, stopped = false;
  const editorFor = trigger => trigger?.closest('.surface-composer')?.querySelector('[contenteditable=true][role=combobox]') || null;
  const active = trigger => !!editorFor(trigger)?.querySelector(selector);
  function selection(range) {
    const current = window.getSelection();
    current.removeAllRanges(); current.addRange(range);
  }
  async function cut(editor, range, valid) {
    editor.focus({preventScroll: true});
    selection(range);
    await sleep();
    if (!valid() || !editor.isConnected) return false;
    const current = window.getSelection();
    if (current.rangeCount !== 1 || current.isCollapsed || current.getRangeAt(0).startContainer !== range.startContainer ||
        current.getRangeAt(0).startOffset !== range.startOffset || current.getRangeAt(0).endContainer !== range.endContainer ||
        current.getRangeAt(0).endOffset !== range.endOffset) return false;
    editor.dispatchEvent(new ClipboardEvent('cut', {bubbles: true, cancelable: true, clipboardData: new DataTransfer()}));
    await sleep();
    return valid();
  }
  async function rollback(editor, before, valid) {
    // Roll back only our untouched literal prefix, never a changed user draft.
    if (!valid() || editor.textContent !== '/teamwork' + before) return;
    const node = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT).nextNode();
    if (!node?.textContent.startsWith('/teamwork')) return;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 9);
    await cut(editor, range, valid);
  }
  async function set(trigger, enabled) {
    if (working || stopped) return false;
    const editor = editorFor(trigger);
    if (!editor || editor.getAttribute('aria-disabled') === 'true') return false;
    if (active(trigger) === enabled) return true;
    const token = ++generation, valid = () => !stopped && generation === token && editor.isConnected && editorFor(trigger) === editor;
    working = true;
    try {
      if (!enabled) {
        const count = editor.querySelectorAll(selector).length;
        if (count > 32) return false;
        for (let n = 0; n < count; n++) {
          const chip = editor.querySelector(selector)?.closest('[data-lexical-decorator],[contenteditable=false]');
          if (!chip || !editor.contains(chip)) return false;
          const previous = editor.querySelectorAll(selector).length;
          const range = document.createRange(); range.selectNode(chip);
          if (!await cut(editor, range, valid) || editor.querySelectorAll(selector).length >= previous) return false;
        }
        return !active(trigger);
      }
      const before = editor.textContent;
      editor.focus({preventScroll: true});
      await sleep();
      if (!valid() || editor.textContent !== before) return false;
      const range = document.createRange(); range.selectNodeContents(editor); range.collapse(true); selection(range);
      // Let Lexical receive the native selectionchange before dispatching paste.
      await sleep();
      if (!valid() || editor.textContent !== before) return false;
      const data = new DataTransfer(); data.setData('text/plain', '/teamwork');
      editor.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: data}));
      const deadline = Date.now() + 1200;
      while (valid() && Date.now() < deadline) {
        const root = editor.closest('.surface-composer');
        const option = [...root.querySelectorAll('[data-mention-menu] [role=option]')].find(node =>
          node.innerText.split('\n')[0].trim().replace(/^\//, '') === 'teamwork' && node.getAttribute('aria-disabled') !== 'true');
        if (option) {
          // The native picker fills in its current command definition, including
          // model-facing text. A bare hand-made mention would omit that payload.
          (option.firstElementChild || option).click();
          await sleep();
          if (valid() && active(trigger)) { editor.focus({preventScroll: true}); return true; }
          break;
        }
        await sleep();
      }
      await rollback(editor, before, valid);
      return false;
    } finally { working = false; }
  }
  return {editorFor, active, set, get busy() { return working; }, destroy() { stopped = true; generation++; }};
}
module.exports = {createTeamworkBridge};
