'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = require('../distribution.json');
for (const platform of ['linux', 'windows']) {
  test(`${platform} distribution contains its runtime and resolves relative imports`, () => {
    assert.equal(manifest.version, 1);
    const files = [...manifest.common, ...manifest[platform]];
    const included = new Set(files);
    assert.equal(included.size, files.length, 'duplicate distribution entry');
    assert.ok(included.has(`common/daemon.cjs`));
    assert.ok(included.has(`${platform}/desktop.cjs`));
    const other = platform === 'linux' ? 'windows' : 'linux';
    for (const file of files) {
      assert.ok(!path.posix.isAbsolute(file) && !file.includes('\\') && !file.split('/').some(p => !p || p === '.' || p === '..'), file);
      assert.ok(!file.startsWith(`${other}/`), `wrong platform: ${file}`);
      assert.ok(fs.lstatSync(path.join(root, file)).isFile(), `missing file: ${file}`);
      if (!file.endsWith('.cjs')) continue;
      const code = fs.readFileSync(path.join(root, file), 'utf8');
      for (const [, reference] of code.matchAll(/['"](\.\.?\/[^'"]+\.(?:cjs|js|json))['"]/g)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), reference));
        if (file === 'common/desktop-icon.cjs' && target.startsWith(`${other}/`)) continue;
        assert.ok(included.has(target), `${file} requires undistributed ${target}`);
      }
    }
  });
}
