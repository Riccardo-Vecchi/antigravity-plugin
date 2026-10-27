'use strict';

// Reviewed stable upstream release. Updates require changing the pinned hashes.
// No installer scripts, model packages or deprecated cua-agent dependencies run.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const VERSION = '0.37.0';
const ASSETS = Object.freeze({
  'linux-x64': ['linux-x86_64-binary.tar.gz', 'c7ac376b10da7c207e510b2d90b88a9588bec9852a237962c273fe81b9cd5623'],
  'linux-arm64': ['linux-arm64-binary.tar.gz', '879e8040a4ce24caeee34b2e4ac6119be01661082202919db1bcc1ab0b97e4c8'],
  'win32-x64': ['windows-x86_64-binary.zip', '40481b55073f1225b0010235b30217bd640ef1f323e982aec0a5f6131d3e4a99'],
});

async function downloadVerified(destination, platform, arch, fetcher = fetch, signal, onProgress = () => {}) {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) throw Error('Unsupported computer-use platform.');
  const name = `cua-driver-rs-${VERSION}-${asset[0]}`;
  const response = await fetcher(`https://github.com/trycua/cua/releases/download/cua-driver-rs-v${VERSION}/${name}`, {signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)});
  if (!response.ok || !response.body) throw Error('Driver download failed.');
  const file = await fs.open(destination, 'wx', 0o600);
  const hash = crypto.createHash('sha256');
  let size = 0;
  const length = Number(response.headers?.get('content-length'));
  const total = Number.isSafeInteger(length) && length > 0 ? length : null;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 90 * 1024 * 1024) throw Error('Driver download is too large.');
      hash.update(chunk);
      await file.writeFile(chunk);
      onProgress({phase:'download',received:size,total});
    }
    await file.sync();
  } finally { await file.close(); }
  onProgress({phase:'verify',received:size,total});
  if (hash.digest('hex') !== asset[1]) throw Error('Driver checksum verification failed.');
  return {version: VERSION, sha256: asset[1], name};
}

async function install(directory, adapter, {platform = process.platform, arch = process.arch, fetcher, signal, onProgress = () => {}} = {}) {
  await fs.mkdir(path.dirname(directory), {recursive: true, mode: 0o700});
  const temporary = await fs.mkdtemp(path.join(path.dirname(directory), '.driver-install-'));
  try {
    const archive = path.join(temporary, platform === 'win32' ? 'release.zip' : 'release.tar.gz');
    onProgress({phase:'download',received:0,total:null});
    const receipt = await downloadVerified(archive, platform, arch, fetcher, signal, onProgress);
    const payload = path.join(temporary, 'payload');
    await fs.mkdir(payload, {mode: 0o700});
    onProgress({phase:'extract'});await adapter.extract(archive, payload);
    await fs.writeFile(path.join(payload, 'receipt.json'), JSON.stringify(receipt) + '\n', {mode: 0o600});
    // Never replace a driver underneath running MCP sessions.
    await fs.rename(payload, directory);
    return receipt;
  } finally { await fs.rm(temporary, {recursive: true, force: true}); }
}
function releaseVersion(tag) {
  const match = /^cua-driver-rs-v(\d{1,6}\.\d{1,6}\.\d{1,6})$/.exec(tag || '');
  return match?.[1];
}
function compareVersions(a,b) {
  const left=a.split('.').map(Number),right=b.split('.').map(Number);
  for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]-right[i];
  return 0;
}
async function checkForUpdates(fetcher = fetch) {
  const signal = AbortSignal.timeout(15000);
  let latest;
  // Cua is a monorepo: /releases/latest can point at Spaces or a nightly.
  // Numeric Driver tags are regular releases, even when GitHub flags them preview.
  for(let page=1;page<=3;page++) {
    const response=await fetcher(`https://api.github.com/repos/trycua/cua/releases?per_page=100&page=${page}`,{signal,headers:{Accept:'application/vnd.github+json','User-Agent':'Antigravity-Plugin'}});
    if(!response.ok)throw Error('updateCheckFailed');
    const text=await response.text();if(text.length>12*1024*1024)throw Error('updateCheckFailed');
    const releases=JSON.parse(text);if(!Array.isArray(releases))throw Error('updateCheckFailed');
    for(const item of releases) {
      const version=releaseVersion(item.tag_name);
      if(!item.draft && version && (!latest || compareVersions(version,latest.version)>0))latest={version,prerelease:!!item.prerelease};
    }
    if(releases.length<100)break;
  }
  if(!latest)throw Error('updateCheckFailed');
  return {...latest,reviewedVersion:VERSION,available:compareVersions(latest.version,VERSION)>0,
    url:`https://github.com/trycua/cua/releases/tag/cua-driver-rs-v${latest.version}`,checkedAt:new Date().toISOString()};
}
module.exports = {VERSION, ASSETS, downloadVerified, install, releaseVersion, compareVersions, checkForUpdates};
