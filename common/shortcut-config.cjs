'use strict';
// Serialized into the local page and Gemini's isolated world: no Node dependency.
function createShortcutRules() {
  const defaultShortcut = 'Ctrl+Alt+G';
  function normalize(value) {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > 40) throw Error('Invalid shortcut.');
    const parts = value.split('+'), key = parts.pop();
    const modifiers = new Set(parts);
    if (!/^[A-Z0-9]$/.test(key || '') || modifiers.size !== parts.length ||
        parts.some(p => !['Ctrl', 'Alt', 'Shift'].includes(p)) ||
        !modifiers.has('Ctrl') || !(modifiers.has('Alt') || modifiers.has('Shift'))) throw Error('Invalid shortcut.');
    return ['Ctrl', 'Alt', 'Shift'].filter(p => modifiers.has(p)).concat(key).join('+');
  }
  function fromEvent(event) {
    if (event.repeat || event.isComposing || event.metaKey || event.getModifierState?.('AltGraph')) return undefined;
    const match = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code || '');
    if (!match) return undefined;
    try { return normalize([event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', match[1] || match[2]].filter(Boolean).join('+')); }
    catch { return undefined; }
  }
  function matches(event, shortcut) { return shortcut !== null && fromEvent(event) === shortcut; }
  return {version: 1, defaultShortcut, normalize, fromEvent, matches};
}
module.exports = {createShortcutRules, ...createShortcutRules()};
