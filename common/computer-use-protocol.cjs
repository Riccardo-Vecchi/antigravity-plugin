'use strict';
const {spawn} = require('node:child_process');
// An actual initialize/tools/list exchange, without observing apps or taking images.
function probe(runtime, bridge) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, [bridge], {env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    let buffer = '', finished = false;
    const timer = setTimeout(() => finish(Error('protocolFailed')), 12000);
    function finish(error, result) { if (finished) return; finished = true; clearTimeout(timer); child.stdin.end(); child.kill(); error ? reject(error) : resolve(result); }
    function send(value) { child.stdin.write(JSON.stringify(value) + '\n'); }
    child.stdin.on('error', () => {}); child.stderr.resume();
    child.on('error', () => finish(Error('protocolFailed')));
    child.on('exit', () => { if (!finished) finish(Error('protocolFailed')); });
    child.stdout.on('data', data => {
      buffer += data.toString();
      if (buffer.length > 2 * 1024 * 1024) return finish(Error('protocolFailed'));
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { return finish(Error('protocolFailed')); }
        if (message.error) return finish(Error('protocolFailed'));
        if (message.id === 1) { send({jsonrpc: '2.0', method: 'notifications/initialized'}); send({jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}}); }
        if (message.id === 2) {
          const tools = message.result?.tools;
          if (!Array.isArray(tools) || !tools.some(t => t.name === 'get_window_state') || !tools.some(t => t.name === 'click')) return finish(Error('protocolFailed'));
          finish(null, {ok: true, toolCount: tools.length, checkedAt: new Date().toISOString()});
        }
      }
    });
    send({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'antigravity-plugin-check', version: '1.1.0'}}});
  });
}
module.exports = {probe};
