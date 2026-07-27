#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = process.cwd();
const RUN_DIR = path.join(REPO, 'artifacts', 'evidence-index', 'test-internet-only-office');
const SOURCE_DIR = path.join(RUN_DIR, 'source');
const SOURCE = path.join(SOURCE_DIR, 'internet-only-office-process.md');
const DEFERRED_SOURCE = path.join(SOURCE_DIR, 'internet-only-office-flow.vsd');
const CHUNKS = path.join(RUN_DIR, 'chunks.jsonl');
const VECTORS = path.join(RUN_DIR, 'vectors.jsonl');
const MANIFEST = path.join(RUN_DIR, 'embedding_manifest.json');
const CANDIDATES = path.join(RUN_DIR, 'review_evidence.jsonl');
const REPORT = path.join(RUN_DIR, 'review_evidence_report.md');
const DEFERRED_CHUNKS = path.join(RUN_DIR, 'deferred_visio_chunks.jsonl');
const DEFERRED_SOURCES = path.join(RUN_DIR, 'deferred_visio_sources.jsonl');

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
fs.mkdirSync(SOURCE_DIR, { recursive: true });
fs.writeFileSync(SOURCE, [
  '# 互联网专用办公区需求收集与使用管理流程',
  '',
  '## 1 目的',
  '',
  '规范各部门外网使用需求的收集、审核、登记和使用记录管理。',
  '',
  '## 2 范围',
  '',
  '适用于全公司各部门提出互联网访问需求并在专用办公区使用设备。',
  '',
  '## 5 工作程序',
  '',
  '5.1 经营发展部需求管理员发布需求收集通知和填报模板。',
  '',
  '5.2 各部门需求填报人提交访问目的、使用人员、网站范围、使用频次和预计期限。',
  '',
  '5.3 经营发展部需求管理员汇总申请，识别重复需求和资料缺项。',
  '',
  '5.4 信息安全审核人核对访问范围和数据带入带出限制，部门负责人批准需求。',
  '',
  '5.5 办公区管理员登记已批准人员并安排仅连接互联网的办公电脑。',
  '',
  '5.6 使用人员到场登记，按批准范围使用设备，结束后填写使用记录。',
  '',
  '互联网 访问申请表',
  '',
  '## 6 记录',
  '',
  '| 记录名称 | 形成环节 | 责任角色 | 保存要求 |',
  '| --- | --- | --- | --- |',
  '| 外网使用需求清单 | 需求汇总 | 经营发展部需求管理员 | 按公司档案要求保存 |',
  '| 互联网专用办公区使用记录 | 现场使用 | 办公区管理员 | 按月归档 |',
  '',
].join('\n'), 'utf8');
fs.writeFileSync(DEFERRED_SOURCE, Buffer.from('deferred regression fixture', 'utf8'));

runNode([
  '.agents/skills/process-evidence-mapping/scripts/extract-evidence-chunks.mjs',
  '--input', SOURCE,
  '--out', CHUNKS,
]);

const chunks = readJsonl(CHUNKS);
assert.ok(chunks.length >= 10, `expected at least 10 chunks, got ${chunks.length}`);

runNode([
  '.agents/skills/process-evidence-mapping/scripts/extract-evidence-chunks.mjs',
  '--input', DEFERRED_SOURCE,
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

const partialTitle = chunks.find((chunk) => chunk.raw_text === '互联网 访问申请表');
assert.ok(partialTitle, 'expected a deliberately spaced form title');
assert.equal(partialTitle.extraction_quality, 'partial');
assert.match(partialTitle.normalized_review_text, /互联网访问申请表/);

const aggregationStep = chunks.find((chunk) => chunk.raw_text.includes('经营发展部需求管理员汇总申请'));
assert.ok(aggregationStep, 'expected the demand aggregation step');
assert.equal(aggregationStep.extraction_quality, 'clean');
assert.equal(aggregationStep.verification_status, 'unverified');
assert.equal(aggregationStep.allowed_downstream_use, 'review_only');

runNode([
  '.agents/skills/process-evidence-mapping/scripts/build-embedding-manifest.mjs',
  '--chunks', CHUNKS,
  '--vectors', VECTORS,
  '--out', MANIFEST,
  '--batch-size', '8',
]);

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
assert.equal(manifest.status, 'embedded');
assert.equal(manifest.embedded_total, chunks.length);
assert.match(manifest.vectors_file, /artifacts[\\/]evidence-index/);

runNode([
  '.agents/skills/process-evidence-mapping/scripts/evidence-retriever.mjs',
  '--chunks', CHUNKS,
  '--vectors', VECTORS,
  '--query', '外网使用需求 申请表 提交 汇总 信息安全审核 批准 使用登记 归档',
  '--top-k', String(chunks.length),
  '--out', CANDIDATES,
]);

const reviewItems = readJsonl(CANDIDATES);
assert.ok(reviewItems.some((item) => item.raw_text.includes('各部门需求填报人提交')), 'expected department submission evidence');
assert.ok(reviewItems.some((item) => item.raw_text.includes('信息安全审核人核对')), 'expected security review evidence');
assert.ok(reviewItems.every((item) => item.evidence_status === 'pending_review'), 'review items must stay pending_review');
assert.ok(reviewItems.every((item) => item.verification_status === 'unverified'), 'review items must stay unverified');
assert.ok(reviewItems.every((item) => item.allowed_downstream_use === 'review_only'), 'review items must be review-only');
assert.ok(reviewItems.some((item) => item.relation_type === 'approval_chain_review'), 'expected approval_chain_review classification');

runNode([
  '.agents/skills/process-evidence-mapping/scripts/build-review-evidence-report.mjs',
  '--review-items', CANDIDATES,
  '--out', REPORT,
  '--title', '互联网专用办公区流程待确认证据回归报告',
]);

const report = fs.readFileSync(REPORT, 'utf8');
assert.match(report, /相似度仅用于排序，不是证据强度/);
assert.match(report, /allowed_downstream_use=review_only/);
assert.doesNotMatch(report, /确认输出目标部门/);

console.log('vector pipeline regression passed');
