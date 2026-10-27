#!/usr/bin/env node
'use strict';
const manager = require('./computer-use.cjs').createManager();
const action = process.argv[2] || 'status';
if (!['status', 'install', 'disconnect', 'check'].includes(action)) {
  console.error('Usage: computer-use-cli.cjs [status|install|disconnect|check]'); process.exitCode = 1;
} else (async () => {
  let result = action === 'status' ? await manager.status() : await manager.perform(action, true);
  while (result.operation) {await new Promise(resolve => setTimeout(resolve, 500)); result = await manager.status();}
  // The command prints configuration metadata, never screenshots or app contents.
  console.log(JSON.stringify(result, null, 2));
  if (result.error) process.exitCode = 1;
})().catch(() => {console.error('Computer-use configuration unavailable.'); process.exitCode = 1;});
