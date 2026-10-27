'use strict';
const {spawn} = require('node:child_process');
// Protocol/capture diagnostics discard image output instead of returning pixels.
function probe(runtime, bridge, {desktop = false, onHandshake = () => {}} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime, [bridge], {env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    let buffer = '', finished = false;
    let toolCount = 0;
    const timer = setTimeout(() => finish(Error('protocolFailed')), desktop ? 18000 : 12000);
    function finish(error, result) { if (finished) return; finished = true; clearTimeout(timer); child.stdin.end(); child.kill(); error ? reject(error) : resolve(result); }
    function send(value) { child.stdin.write(JSON.stringify(value) + '\n'); }
    child.stdin.on('error', () => {}); child.stderr.resume();
    child.on('error', () => finish(Error('protocolFailed')));
    child.on('exit', () => { if (!finished) finish(Error('protocolFailed')); });
    child.stdout.on('data', data => {
      buffer += data.toString();
      if (buffer.length > 32 * 1024 * 1024) return finish(Error('protocolFailed'));
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { return finish(Error('protocolFailed')); }
        if (message.error) return finish(Error('protocolFailed'));
        if (message.id === 1) { send({jsonrpc: '2.0', method: 'notifications/initialized'}); send({jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}}); }
        if (message.id === 2) {
          const tools = message.result?.tools;
          if (!Array.isArray(tools) || !tools.some(t => t.name === 'get_window_state') || !tools.some(t => t.name === 'click')) return finish(Error('protocolFailed'));
          toolCount = tools.length;
          onHandshake({ok:true,toolCount,checkedAt:new Date().toISOString()});
          if (desktop) send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'get_desktop_state',arguments:{max_image_dimension:640}}});
          else finish(null, {ok: true, toolCount, checkedAt: new Date().toISOString()});
        }
        if (message.id === 3) {
          const capture = !message.result?.isError && message.result?.content?.some(item => item.type === 'image' && typeof item.data === 'string' && item.data.length > 0 && item.mimeType?.startsWith('image/'));
          // Screenshots remain in memory and are discarded; no pixel data is returned.
          finish(null, {ok:true,toolCount,checkedAt:new Date().toISOString(),desktop:{ok:!!capture}});
        }
      }
    });
    send({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'antigravity-plugin-check', version: require('./versions.cjs').suite}}});
  });
}
module.exports = {probe};
