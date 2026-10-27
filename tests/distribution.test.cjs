'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = require('../common/distribution.json');
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
      assert.ok((!file.startsWith(`${other}/`) || file === `${other}/README.md`), `wrong platform: ${file}`);
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
test('source and installed payloads resolve the same icons while preserving deployed file identities', async t => {
  const fsp=require('node:fs/promises'),os=require('node:os');
  const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'agpa-payload-'));t.after(()=>fsp.rm(directory,{recursive:true,force:true}));
  const targets=new Set();
  for(const source of [...manifest.common,...manifest.linux]){
    const mapping=Object.entries(manifest.mappings).find(([prefix])=>source.startsWith(prefix));
    const target=mapping?mapping[1]+source.slice(mapping[0].length):source;
    assert.ok(!path.posix.isAbsolute(target)&&!target.split('/').includes('..')&&!targets.has(target));targets.add(target);
    const file=path.join(directory,target);await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.copyFile(path.join(root,source),file);
  }
  const deployed=require(path.join(directory,'common/icon-path.cjs'));
  assert.equal(deployed.iconPath('current.png'),path.join(directory,'icons/current.png'));
  assert.ok(fs.existsSync(deployed.iconPath('gemini-512.png')));
  assert.equal(require('../common/icon-path.cjs').iconPath('gemini-512.png'),path.join(root,'assets/icons/gemini-512.png'));
});
