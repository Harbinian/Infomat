// Read-only HTTP and local asset checks for an explicitly selected loopback candidate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DOMAIN_MODULE_FILES } from '../frontend/bridge.mjs';

const origin = new URL(process.argv[2] || '');
assert.equal(origin.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Use an explicit loopback candidate');
assert.ok(origin.port && !['80', '3000', '3001'].includes(origin.port), 'Formal ports are forbidden');
assert.equal(origin.pathname, '/');
assert.ok(!origin.search && !origin.username && !origin.password);
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(appRoot, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const artifacts = [];
async function response(route) {
  const result = await fetch(new URL(route, origin), { signal: AbortSignal.timeout(10000), cache: 'no-store' });
  assert.equal(result.status, 200, `${route} must be served`);
  return result;
}
async function matchAsset(route, localFile) {
  const bytes = Buffer.from(await (await response(route)).arrayBuffer());
  const local = await fs.readFile(localFile);
  assert.equal(sha(bytes), sha(local), `${route} differs from this worktree`);
  artifacts.push({ url: route, file: path.relative(repoRoot, localFile).replaceAll('\\', '/'), byteLength: bytes.length, sha256: sha(bytes) });
  return bytes;
}
const health = await (await response('/api/health')).json();
assert.equal(health.status, 'ok');
assert.equal(health.release_status, 'candidate');
assert.equal(health.schema_version, 'process-governance-v8');
assert.equal(health.port, Number(origin.port));
const schemaResponse = await response('/api/schema');
const schemaFile = path.join(repoRoot, 'docs/contracts/process-governance-v8.schema.json');
const schemaBytes = await fs.readFile(schemaFile);
assert.equal(schemaResponse.headers.get('x-infomat-schema-digest'), health.schema_digest);
assert.equal(sha(schemaBytes), health.schema_digest);
assert.deepEqual(await schemaResponse.json(), JSON.parse(schemaBytes));
const index = (await matchAsset('/workbench/', path.join(appRoot, 'public/workbench/index.html'))).toString('utf8');
assert.ok(index.includes('<div id="root">'));
const resources = [...index.matchAll(/(?:src|href)="([^\"]+)"/g)].map(match => match[1]);
assert.ok(resources.some(url => url.endsWith('.js')) && resources.some(url => url.endsWith('.css')));
for (const url of resources) {
  assert.match(url, /^\/workbench\/assets\/[a-zA-Z0-9._-]+\.(?:js|css)$/);
  await matchAsset(url, path.join(appRoot, 'public', url.slice(1)));
}
for (const { file } of DOMAIN_MODULE_FILES) await matchAsset('/' + file, path.join(appRoot, 'public', file));
await matchAsset('/vendor/cytoscape.min.js', path.join(appRoot, 'node_modules/cytoscape/dist/cytoscape.min.js'));
await matchAsset('/', path.join(appRoot, 'public/index.html'));
const sourceFiles = (await fs.readdir(path.join(appRoot, 'frontend'))).filter(name => /\.(?:jsx|mjs|css|html)$/.test(name));
const sourceManifest = [];
for (const file of [...sourceFiles.map(name => 'frontend/' + name), 'package.json', 'package-lock.json']) {
  const bytes = await fs.readFile(path.join(appRoot, file));
  sourceManifest.push({ file: 'apps/structured-output-service/' + file, byteLength: bytes.length, sha256: sha(bytes) });
}
const report = { passed: true, verifiedAt: new Date().toISOString(), origin: origin.origin, node: process.version, health, schemaDigest: health.schema_digest, artifacts, sourceManifest };
if (process.argv[3]) {
  const destination = path.resolve(process.argv[3]);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(report, null, 2) + '\n', 'utf8');
}
console.log(JSON.stringify({ passed: true, origin: report.origin, schema: health.schema_version, schemaDigest: report.schemaDigest, assetCount: artifacts.length, sourceFileCount: sourceManifest.length }));
