/**
 * 校验 company-sankey-data.json 中 sourceManifest 的文件指纹仍匹配磁盘。
 *
 * 用法: node scripts/check-source-manifest-hashes.mjs
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const companyDataPath = resolve(root, 'docs', 'company-sankey-data.json');

function readJson(path) {
  assert.ok(existsSync(path), `missing ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

const TEXT_SOURCE_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.txt', '.yaml', '.yml']);

function normalizedSourceBuffer(path) {
  const bytes = readFileSync(path);
  if (!TEXT_SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) return bytes;
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function normalizedSourceSize(path) {
  return normalizedSourceBuffer(path).length;
}

function sha256File(path) {
  return createHash('sha256').update(normalizedSourceBuffer(path)).digest('hex');
}

const companyData = readJson(companyDataPath);
const files = companyData.sourceManifest?.files || [];

assert.ok(Array.isArray(files), 'sourceManifest.files must be an array');
assert.ok(files.length > 0, 'sourceManifest.files must not be empty');

for (const file of files) {
  assert.ok(file.path, 'sourceManifest file must include path');
  assert.ok(file.sha256, `${file.path} must include sha256`);
  assert.equal(typeof file.size, 'number', `${file.path} must include numeric size`);

  const fullPath = resolve(root, file.path);
  assert.ok(existsSync(fullPath), `${file.path} must exist`);
  assert.equal(normalizedSourceSize(fullPath), file.size, `${file.path} normalized size must match sourceManifest`);
  assert.equal(sha256File(fullPath), file.sha256, `${file.path} sha256 must match sourceManifest`);
}

console.log(`Source manifest hash check passed: ${files.length} files`);
