/**
 * Regression check for the OCR reviewItem-evidence extraction wrapper.
 *
 * Usage: node scripts/test-ocr-source.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'artifacts', 'ocr', 'test-ocr-source');
const samplePdf = join(
  root,
  'docs',
  'norms',
  '项目管理部业务资料',
  '14.3-装配生产过程管理',
  'GLB140304-01-包装物制造及产品包装管理标准',
  '包装物制造及产品包装管理标准.pdf',
);

rmSync(outDir, { recursive: true, force: true });

const result = spawnSync(
  process.execPath,
  [
    join(root, 'scripts', 'ocr-source.mjs'),
    '--input',
    samplePdf,
    '--out',
    outDir,
    '--no-ocr',
  ],
  {
    cwd: root,
    encoding: 'utf8',
  },
);

assert.equal(result.status, 0, result.stderr || result.stdout);

const manifestPath = join(outDir, 'manifest.json');
const reviewPath = join(outDir, 'review-required.jsonl');
assert.equal(existsSync(manifestPath), true, 'manifest.json should be written');
assert.equal(existsSync(reviewPath), true, 'review-required.jsonl should be written');
assert.equal(existsSync(join(outDir, 'json')), true, 'json output directory should be written');
assert.equal(existsSync(join(outDir, 'markdown')), true, 'markdown output directory should be written');
assert.equal(existsSync(join(outDir, 'raw')), true, 'raw output directory should be written');
assert.equal(existsSync(join(outDir, 'images')), true, 'images output directory should be written');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.output_root.includes('artifacts/ocr/test-ocr-source'), true);
assert.equal(manifest.policy.ocr_is_final_evidence, false);
assert.equal(manifest.policy.can_generate_business_conclusions, false);
assert.equal(manifest.sources.length, 1);
assert.equal(manifest.sources[0].review_required, true);
assert.equal(manifest.sources[0].evidence_status, 'ocr_extracted_not_confirmed');

const reviewRecords = readFileSync(reviewPath, 'utf8')
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
assert.equal(reviewRecords.length >= 1, true);
assert.equal(reviewRecords[0].source_file.endsWith('包装物制造及产品包装管理标准.pdf'), true);
assert.equal(reviewRecords[0].artifact_type, 'image_or_scanned_pdf');
assert.equal(reviewRecords[0].review_required, true);
assert.equal(reviewRecords[0].evidence_status, 'ocr_extracted_not_confirmed');

const outputText = [
  readFileSync(manifestPath, 'utf8'),
  readFileSync(reviewPath, 'utf8'),
].join('\n');

for (const forbidden of ['DCM', 'BBM', 'A1', '审批类型', '输入来源部门', '输出目标部门']) {
  assert.equal(
    outputText.includes(forbidden),
    false,
    `OCR wrapper must not emit business-conclusion field: ${forbidden}`,
  );
}

console.log('OCR source wrapper regression checks passed');
