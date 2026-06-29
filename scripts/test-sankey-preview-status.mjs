#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const NORMS = resolve(ROOT, 'docs', 'norms');

function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const files = readdirSync(NORMS)
  .filter((name) => name.endsWith('部门能力流程系统桑基图.html'))
  .map((name) => resolve(NORMS, name));

assert.ok(files.length >= 9, 'expected department Sankey pages to exist');

const before = new Map(files.map((file) => [file, fileHash(file)]));
const result = spawnSync(
  process.execPath,
  [resolve(ROOT, 'scripts', 'mark-sankey-preview-status.mjs')],
  { cwd: ROOT, encoding: 'utf8' },
);

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(
  result.stdout,
  /deprecated|no formal pages modified|不再批量修改正式部门桑基图/,
  'status marker should now be a safe no-op instead of mutating docs/norms',
);

for (const file of files) {
  assert.equal(fileHash(file), before.get(file), `${file} should not be modified by preview status marker`);
  const html = readFileSync(file, 'utf8');
  for (const marker of ['模型预览', '输入基线问题预览', '未经过映射复核', '待确认条目']) {
    assert.equal(html.includes(marker), false, `${file} must not contain reviewItem preview marker: ${marker}`);
  }
}
