#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = process.cwd();
const RUN_DIR = path.join(REPO, 'artifacts', 'evidence-index', 'test-gltx-jy-05');
const CHUNKS = path.join(RUN_DIR, 'chunks.jsonl');
const VECTORS = path.join(RUN_DIR, 'vectors.jsonl');
const MANIFEST = path.join(RUN_DIR, 'embedding_manifest.json');
const CANDIDATES = path.join(RUN_DIR, 'review_evidence.jsonl');
const REPORT = path.join(RUN_DIR, 'review_evidence_report.md');
const DEFERRED_CHUNKS = path.join(RUN_DIR, 'deferred_visio_chunks.jsonl');
const DEFERRED_SOURCES = path.join(RUN_DIR, 'deferred_visio_sources.jsonl');
const SOURCE = path.join(
  REPO,
  'docs',
  'norms',
  '经营发展部业务资料',
  '管理体系程序文件',
  'GLTX-JY-05-D公司月度绩效考核方案.docx',
);

function findFirstExt(root, ext) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFirstExt(fullPath, ext);
      if (found) return found;
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
      return fullPath;
    }
  }
  return '';
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runNode(args) {
  execFileSync(process.execPath, args, {
    cwd: REPO,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

fs.rmSync(RUN_DIR, { recursive: true, force: true });
fs.mkdirSync(RUN_DIR, { recursive: true });

runNode([
  '.agents/skills/process-evidence-mapping/scripts/extract-evidence-chunks.mjs',
  '--input', SOURCE,
  '--out', CHUNKS,
]);

const chunks = readJsonl(CHUNKS);
assert.ok(chunks.length > 300, `expected >300 chunks, got ${chunks.length}`);

const visioSource = findFirstExt(path.join(REPO, 'docs', 'norms'), '.vsd');
assert.ok(visioSource, 'expected at least one Visio source for defer regression');
runNode([
  '.agents/skills/process-evidence-mapping/scripts/extract-evidence-chunks.mjs',
  '--input', visioSource,
  '--out', DEFERRED_CHUNKS,
  '--source-index', DEFERRED_SOURCES,
  '--defer-ext', '.vsd,.vsdx',
]);
const deferredChunks = readJsonl(DEFERRED_CHUNKS);
const deferredSources = readJsonl(DEFERRED_SOURCES);
assert.equal(deferredChunks.length, 0, 'deferred Visio file should not produce chunks');
assert.equal(deferredSources.length, 1, 'deferred Visio file should remain in source index');
assert.equal(deferredSources[0].extraction_status, 'deferred');
assert.equal(deferredSources[0].included_status, 'deferred');

const partialTitle = chunks.find((chunk) => chunk.raw_text === '公司 月综合打分表');
assert.ok(partialTitle, 'expected raw partial title chunk 公司 月综合打分表');
assert.equal(partialTitle.extraction_quality, 'partial');
assert.equal(partialTitle.raw_text, '公司 月综合打分表');
assert.match(partialTitle.normalized_review_text, /公司__月综合打分表/);
assert.match(partialTitle.normalized_review_text, /公司月度综合打分表待确认/);

const section543 = chunks.find((chunk) => chunk.raw_text.includes('5.4.3公司月度综合打分表由经营发展部部长编制'));
assert.ok(section543, 'expected §5.4.3 object-chain chunk');
assert.equal(section543.extraction_quality, 'clean');
assert.equal(section543.verification_status, 'unverified');
assert.equal(section543.allowed_downstream_use, 'review_only');

runNode([
  '.agents/skills/process-evidence-mapping/scripts/build-embedding-manifest.mjs',
  '--chunks', CHUNKS,
  '--vectors', VECTORS,
  '--out', MANIFEST,
  '--batch-size', '16',
]);

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
assert.equal(manifest.status, 'embedded');
assert.equal(manifest.embedded_total, chunks.length);
assert.match(manifest.vectors_file, /artifacts[\\/]evidence-index/);

runNode([
  '.agents/skills/process-evidence-mapping/scripts/evidence-retriever.mjs',
  '--chunks', CHUNKS,
  '--vectors', VECTORS,
  '--query', '公司月度综合打分表 编制 财务核对 分管领导审核 总经理批准 签批栏',
  '--top-k', '10',
  '--out', CANDIDATES,
]);

const reviewItems = readJsonl(CANDIDATES);
assert.ok(reviewItems.some((item) => item.raw_text.includes('5.4.3公司月度综合打分表由经营发展部部长编制')), 'expected §5.4.3 in reviewItems');
assert.ok(reviewItems.some((item) => item.raw_text.includes('编制：') && item.raw_text.includes('财务核对')), 'expected table 26 signature row in reviewItems');
assert.ok(reviewItems.every((item) => item.evidence_status === 'needs_review'), 'review items must stay needs_review');
assert.ok(reviewItems.every((item) => item.verification_status === 'unverified'), 'review items must stay unverified');
assert.ok(reviewItems.every((item) => item.allowed_downstream_use === 'review_only'), 'review items must be review-only');
assert.ok(reviewItems.some((item) => item.relation_type === 'approval_chain_review'), 'expected approval_chain_review classification');

runNode([
  '.agents/skills/process-evidence-mapping/scripts/build-review-evidence-report.mjs',
  '--review-items', CANDIDATES,
  '--out', REPORT,
  '--title', 'GLTX-JY-05待确认证据回归报告',
]);

const report = fs.readFileSync(REPORT, 'utf8');
assert.match(report, /相似度仅用于排序，不是证据强度/);
assert.match(report, /allowed_downstream_use=review_only/);
assert.doesNotMatch(report, /确认输出目标部门/);

console.log('vector pipeline regression passed');
