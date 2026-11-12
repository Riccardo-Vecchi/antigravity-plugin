"use strict";

// Use the native slash picker so each command carries its current definition.
function createSwarmBridge() {
  const command = "/swarm";
  const selector =
    '[data-uri="slashCommand:swarm"],[data-uri="slashCommand:/swarm"]';
  const sleep = () => new Promise((resolve) => setTimeout(resolve, 30));
  let working = false,
    stopped = false;
  const editorFor = (trigger) =>
    trigger
      ?.closest(".surface-composer")
      ?.querySelector("[contenteditable=true][role=combobox]") || null;
  const active = (trigger) => !!editorFor(trigger)?.querySelector(selector);
  function select(range) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  async function cut(editor, range, valid) {
    editor.focus({ preventScroll: true });
    select(range);
    await sleep();
    if (!valid()) return false;
    const selection = window.getSelection();
    if (selection.rangeCount !== 1 || selection.isCollapsed) return false;
    const current = selection.getRangeAt(0);
    if (
      current.compareBoundaryPoints(Range.START_TO_START, range) ||
      current.compareBoundaryPoints(Range.END_TO_END, range)
    )
      return false;
    editor.dispatchEvent(
      new ClipboardEvent("cut", {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      }),
    );
    await sleep();
    return valid();
  }
  async function insert(editor, valid) {
    const before = editor.textContent;
    editor.focus({ preventScroll: true });
    await sleep();
    if (!valid() || editor.textContent !== before) return false;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    select(range);
    await sleep();
    if (!valid() || editor.textContent !== before) return false;
    const selected = window.getSelection();
    if (
      selected.rangeCount !== 1 ||
      !selected.isCollapsed ||
      selected.getRangeAt(0).compareBoundaryPoints(Range.START_TO_START, range)
    )
      return false;
    const data = new DataTransfer();
    data.setData("text/plain", command);
    editor.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
    const deadline = Date.now() + 4000;
    while (valid() && Date.now() < deadline) {
      const root = editor.closest(".surface-composer");
      const option = [
        ...root.querySelectorAll("[data-mention-menu] [role=option]"),
      ].find(
        (node) =>
          node.innerText
            .split("\n")[0]
            .trim()
            .replace(/^\//, "")
            .toLowerCase() === "swarm",
      );
      if (option) {
        if (option.closest("[aria-disabled=true],[data-disabled]")) break;
        (option.firstElementChild || option).click();
        await sleep();
        if (valid() && editor.querySelector(selector)) {
          editor.focus({ preventScroll: true });
          return true;
        }
        break;
      }
      await sleep();
    }
    // Cut only our unchanged prefix. Other draft text and native chips stay intact.
    if (valid() && editor.textContent === command + before) {
      const node = document
        .createTreeWalker(editor, NodeFilter.SHOW_TEXT)
        .nextNode();
      if (node?.textContent.startsWith(command)) {
        const prefix = document.createRange();
        prefix.setStart(node, 0);
        prefix.setEnd(node, command.length);
        await cut(editor, prefix, valid);
      }
    }
    return false;
  }
  async function set(trigger, enabled) {
    if (working || stopped) return false;
    const editor = editorFor(trigger);
    if (!editor || editor.getAttribute("aria-disabled") === "true")
      return false;
    const existing = [...editor.querySelectorAll(selector)];
    if (enabled && existing.length) return true;
    if (existing.length > 32) return false;
    const valid = () =>
      !stopped && editor.isConnected && editorFor(trigger) === editor;
    const chips = existing.map((node) =>
      node.closest("[data-lexical-decorator],[contenteditable=false]"),
    );
    if (chips.some((chip) => !chip || !editor.contains(chip))) return false;
    working = true;
    try {
      if (enabled) return await insert(editor, valid);
      for (const chip of chips) {
        if (!valid() || !editor.contains(chip)) return false;
        const range = document.createRange();
        range.selectNode(chip);
        if (!(await cut(editor, range, valid)) || editor.contains(chip))
          return false;
      }
      return !active(trigger);
    } finally {
      working = false;
    }
  }
  return {
    editorFor,
    active,
    set,
    get busy() {
      return working;
    },
    destroy() {
      stopped = true;
    },
  };
}
module.exports = { createSwarmBridge };
