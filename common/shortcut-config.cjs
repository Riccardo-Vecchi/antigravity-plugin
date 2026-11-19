'use strict';
// Serialized into the local page and Gemini's isolated world: no Node dependency.
function createShortcutRules() {
  const defaultShortcut = 'Ctrl+Alt+G';
  const modelShortcutPrefix = 'Ctrl+Alt';
  const modelDefinitions = [
    { id: 'argon', label: 'Argon', defaultLetter: 'A', keywords: ['argon'], exclude: ['orchestrator'] },
    { id: 'neon', label: 'Neon', defaultLetter: 'N', keywords: ['neon'], exclude: ['orchestrator'] },
    { id: 'hydrogen', label: 'Hydrogen', defaultLetter: 'H', keywords: ['hydrogen'], exclude: ['orchestrator'] },
    { id: 'flash', label: '3.8 Flash', defaultLetter: 'F', keywords: ['flash'], preferred: ['3.8'], exclude: ['orchestrator'] },
    { id: 'orchestrator', label: 'Orchestrator (Neon)', defaultLetter: 'O', keywords: ['orchestrator'], preferred: ['neon'], exclude: [] },
  ];
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
  function normalizeModelLetter(value) {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 40) throw Error('Invalid model shortcut letter.');
    const trimmed = value.trim();
    if (/^[a-zA-Z]$/.test(trimmed)) return trimmed.toUpperCase();
    const match = /^Ctrl\+Alt\+([A-Z])$/.exec(trimmed);
    if (match) return match[1];
    throw Error('Invalid model shortcut letter.');
  }
  function modelChord(letter) {
    const normalized = normalizeModelLetter(letter);
    return normalized ? `${modelShortcutPrefix}+${normalized}` : null;
  }
  function defaultModelShortcuts(toggleShortcut) {
    const normalizedToggle = toggleShortcut === undefined ? defaultShortcut : normalize(toggleShortcut);
    const toggleLetter = normalizedToggle && normalizedToggle.startsWith(`${modelShortcutPrefix}+`)
      ? normalizedToggle.slice(modelShortcutPrefix.length + 1)
      : null;
    const out = {};
    for (const def of modelDefinitions) out[def.id] = def.defaultLetter === toggleLetter ? null : def.defaultLetter;
    return out;
  }
  function findShortcutConflicts(modelShortcuts, toggleShortcut = defaultShortcut) {
    const normalizedToggle = toggleShortcut === undefined ? defaultShortcut : normalize(toggleShortcut);
    const byLetter = new Map();
    for (const def of modelDefinitions) {
      const letter = normalizeModelLetter(modelShortcuts?.[def.id] ?? null);
      if (!letter) continue;
      const list = byLetter.get(letter) || [];
      list.push(def);
      byLetter.set(letter, list);
    }
    const conflicts = [];
    for (const [letter, defs] of byLetter) {
      const chord = `${modelShortcutPrefix}+${letter}`;
      if (defs.length > 1) conflicts.push({ type: 'duplicate', chord, letter, ids: defs.map(d => d.id), labels: defs.map(d => d.label) });
      if (normalizedToggle && chord === normalizedToggle) conflicts.push({ type: 'toggle', chord, letter, ids: defs.map(d => d.id), labels: defs.map(d => d.label) });
    }
    return conflicts;
  }
  function normalizeModelShortcuts(input, toggleShortcut = defaultShortcut) {
    if (input === undefined) return defaultModelShortcuts(toggleShortcut);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid model shortcuts.');
    const allowed = new Set(modelDefinitions.map(d => d.id));
    for (const key of Object.keys(input)) if (!allowed.has(key)) throw Error('Invalid model shortcuts.');
    const out = {};
    for (const def of modelDefinitions) {
      const raw = Object.hasOwn(input, def.id) ? input[def.id] : def.defaultLetter;
      out[def.id] = normalizeModelLetter(raw);
    }
    const conflicts = findShortcutConflicts(out, toggleShortcut);
    if (conflicts.length) {
      const first = conflicts[0];
      throw Error(first.type === 'toggle'
        ? `Shortcut conflict: ${first.chord} is already used by Switch between Antigravity and Gemini.`
        : `Shortcut conflict: ${first.chord} is assigned to multiple models (${first.labels.join(', ')}).`);
    }
    return out;
  }
  function hasWord(text, token) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(text);
  }
  function matchModelEntry(entries, slotId) {
    const def = modelDefinitions.find(d => d.id === slotId);
    if (!def || !Array.isArray(entries)) return null;
    const candidates = entries.filter(e => e && !e.disabled && typeof e.name === 'string' && e.name.trim() &&
      def.keywords.every(k => hasWord(e.name, k)) &&
      def.exclude.every(k => !hasWord(e.name, k)));
    if (!candidates.length) return null;
    const preferred = def.preferred?.length
      ? candidates.filter(e => def.preferred.every(k => hasWord(e.name, k)))
      : [];
    const pool = preferred.length ? preferred : candidates;
    return pool.find(e => !e.hidden) || pool[0];
  }
  function fromEvent(event) {
    if (event.repeat || event.isComposing || event.metaKey || event.getModifierState?.('AltGraph')) return undefined;
    const match = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code || '');
    if (!match) return undefined;
    try { return normalize([event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', match[1] || match[2]].filter(Boolean).join('+')); }
    catch { return undefined; }
  }
  function letterFromEvent(event) {
    if (event.repeat || event.isComposing || event.metaKey || event.getModifierState?.('AltGraph')) return undefined;
    const plain = !event.ctrlKey && !event.altKey;
    const ctrlAlt = !!event.ctrlKey && !!event.altKey && !event.shiftKey;
    if (!plain && !ctrlAlt) return undefined;
    const codeMatch = /^Key([A-Z])$/.exec(event.code || '');
    if (codeMatch) return codeMatch[1];
    if (!event.code && typeof event.key === 'string' && /^[a-zA-Z]$/.test(event.key)) return event.key.toUpperCase();
    return undefined;
  }
  function matches(event, shortcut) { return shortcut !== null && fromEvent(event) === shortcut; }
  return {
    version: 2,
    defaultShortcut,
    modelShortcutPrefix,
    modelDefinitions,
    defaultModelShortcuts,
    normalize,
    normalizeModelLetter,
    modelChord,
    findShortcutConflicts,
    normalizeModelShortcuts,
    matchModelEntry,
    fromEvent,
    letterFromEvent,
    matches,
  };
}
module.exports = {createShortcutRules, ...createShortcutRules()};
