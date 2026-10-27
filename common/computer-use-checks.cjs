'use strict';
// Each success names exactly what was verified; protocol success is not GUI success.
function connectionChecks(state, native = {}) {
  return [
    {id: 'driver', label: 'Cua Driver installed', passed: !!state.installed},
    {id: 'registration', label: 'Registered in Antigravity', passed: !!state.enabled && !!state.registered},
    {id: 'skill', label: 'Agent skill installed', passed: !!state.skillReady},
    {id: 'protocol', label: 'MCP tool handshake', passed: !!state.protocol?.ok},
    {id: 'native', label: 'Server detected by Antigravity', passed: !!state.enabled && !!native.detected},
    {id: 'desktop', label: state.helperState === 'notRequired' || state.platform === 'win32' || state.session === 'x11' ? 'Desktop helper not required' : 'GNOME desktop helper active', passed: !!state.platform && !state.needsHelper && ['wayland', 'x11', 'windows'].includes(state.session)},
    ...(state.scope === 'desktop' ? [{id: 'capture', label: 'Desktop screen capture tested', passed: !!state.protocol?.desktop?.ok}] : []),
  ];
}
module.exports = {connectionChecks};
function shouldAutoCapture(state) {
  return !!state.enabled && state.scope === 'desktop' && !state.needsHelper &&
    ['wayland','x11','windows'].includes(state.session) && !state.captureAttempted && !state.operation && !state.error;
}
module.exports.shouldAutoCapture = shouldAutoCapture;
// Compare access meaning, not textarea formatting or application ordering.
function accessChanged(current, selected) {
  if (current.scope !== selected.scope) return true;
  if (selected.scope !== 'apps') return false;
  const normalize = apps => [...new Set((apps || []).filter(app => typeof app === 'string').map(app => {
    const value=app.trim();return current.platform === 'win32' ? value.toLowerCase() : value;
  }).filter(Boolean))].sort();
  return JSON.stringify(normalize(current.apps)) !== JSON.stringify(normalize(selected.apps));
}
module.exports.accessChanged = accessChanged;
