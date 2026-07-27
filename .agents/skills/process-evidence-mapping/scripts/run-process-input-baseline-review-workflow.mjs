#!/usr/bin/env node
/**
 * Run the review-only process input baseline review workflow.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ensureDir,
  parseArgs,
  readJson,
  readJsonl,
  requireArg,
  sha1File,
  writeJson,
  writeJsonl,
} from './review-item-utils.mjs';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const EMBEDDING_CONFIG = path.join(REPO_ROOT, '.agents', 'skills', 'process-evidence-mapping', 'references', 'ollama-embedding-config.json');
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.gif', '.webp']);

function repoResolve(value) {
  return path.resolve(REPO_ROOT, value);
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.noFail) {
    throw new Error(`${args[0]} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function writeSkippedEmbeddingManifest({ chunksPath, vectorsPath, manifestPath, reason }) {
  const config = readJson(EMBEDDING_CONFIG);
  writeJson(manifestPath, {
    created_at: new Date().toISOString(),
    status: 'skipped',
    skip_reason: reason,
    provider: config.provider,
    endpoint: new URL(config.embed_endpoint || '/api/embed', config.base_url).toString(),
    base_url: config.base_url,
    model: config.model,
    dimensions: config.dimensions,
    chunking_rule: config.chunking_rule,
    chunks_file: chunksPath,
    vectors_file: vectorsPath,
    role: config.role || 'review_evidence_retrieval_only',
    source_hash: sha1File(chunksPath),
    similarity_policy: 'similarity is review ranking only, not evidence strength',
    default_evidence_status: 'pending_review',
    allowed_downstream_use: 'review_only',
  });
  writeJsonl(vectorsPath, []);
}

function aggregateRetrieval({ chunksPath, vectorsPath, reviewEvidencePath, manifest, department }) {
  if (manifest.status !== 'embedded') {
    writeJsonl(reviewEvidencePath, []);
    return;
  }

  const queries = [
    `${department} 业务流程 起点 终点 输入 输出`,
    '编制 提交 审核 批准 发布 交付物',
    '跨部门 提交 移交 接收 反馈 承接标准',
    '表单 台账 字段 记录 签批栏',
    '归档 保存 留存 完成标准 验收',
  ];

  const all = [];
  queries.forEach((query, index) => {
    const tempOut = path.join(path.dirname(reviewEvidencePath), `_review_query_${index + 1}.jsonl`);
    runNode([
      '.agents/skills/process-evidence-mapping/scripts/evidence-retriever.mjs',
      '--chunks', chunksPath,
      '--vectors', vectorsPath,
      '--query', query,
      '--top-k', '8',
      '--out', tempOut,
      '--no-fail',
    ], { noFail: true });
    all.push(...readJsonl(tempOut));
  });
  writeJsonl(reviewEvidencePath, all);
}

function assertReadableSources(sourceManifestPath) {
  const sources = readJsonl(sourceManifestPath);
  if (!sources.length) {
    throw new Error('没有发现可直接读取的受支持源文件。请提供文本型制度、表单、台账或可提取文本的 PDF。');
  }
  const blocked = sources.filter((source) => ['blocked_unreadable', 'failed'].includes(source.extraction_status));
  if (!blocked.length) return;
  const labels = blocked.map((source) => source.source_file).filter(Boolean).slice(0, 8);
  throw new Error(`存在不可直接读取的来源，工作流已阻断：${labels.join('；')}。请由资料责任人提供可读取原件或经人工确认的文字版。`);
}

function assertArtifactPath(targetPath, label) {
  const artifactsRoot = path.resolve(REPO_ROOT, 'artifacts');
  const resolved = path.resolve(targetPath);
  const relative = path.relative(artifactsRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay under artifacts/: ${resolved}`);
  }
}

function main() {
  const args = parseArgs(process.argv, {
    out: path.join('artifacts', 'process-input-baseline-review', new Date().toISOString().replace(/[:.]/g, '-')),
  });
  requireArg(args, 'input');
  requireArg(args, 'department');
  requireArg(args, 'mapping');

  const inputPath = repoResolve(args.input);
  const outDir = repoResolve(args.out);
  const todoPath = repoResolve(args.todo || path.join(args.out, 'pending-issues.md'));
  const mappingPath = repoResolve(args.mapping);
  assertArtifactPath(outDir, 'workflow output');
  assertArtifactPath(todoPath, 'pending issue markdown');
  ensureDir(outDir);
  if (IMAGE_EXTS.has(path.extname(inputPath).toLowerCase())) {
    throw new Error('图片来源不进入本技能。请提供可直接读取的源文件或经资料责任人确认的文字版。');
  }

  const sourceManifestPath = path.join(outDir, 'source_manifest.jsonl');
  const chunksPath = path.join(outDir, 'chunks.jsonl');
  const warningsPath = path.join(outDir, 'chunking_warnings.md');
  const embeddingManifestPath = path.join(outDir, 'embedding_manifest.json');
  const vectorsPath = path.join(outDir, 'vectors.jsonl');
  const reviewEvidencePath = path.join(outDir, 'review_evidence.jsonl');
  const documentReviewItemPath = path.join(outDir, 'document_review_items.json');
  const roleReviewItemsPath = path.join(outDir, 'role_review_items.json');
  const objectChainsPath = path.join(outDir, 'object_chains.json');
  const diffReportPath = path.join(outDir, 'mapping_diff_report.md');
  const mappingItemsPath = path.join(outDir, 'mapping_diff_items.json');
  const structuredOutputPath = path.join(outDir, 'document-structured-output-v2.json');

  const chunkArgs = [
    '.agents/skills/process-evidence-mapping/scripts/extract-evidence-chunks.mjs',
    '--input', inputPath,
    '--out', chunksPath,
    '--source-index', sourceManifestPath,
    '--warnings', warningsPath,
  ];
  if (args.includeExt) chunkArgs.push('--include-ext', args.includeExt);
  if (args.excludeExt) chunkArgs.push('--exclude-ext', args.excludeExt);
  if (args.deferExt) chunkArgs.push('--defer-ext', args.deferExt);
  if (args.deferReason) chunkArgs.push('--defer-reason', args.deferReason);
  runNode(chunkArgs, { inherit: false });
  assertReadableSources(sourceManifestPath);

  if (args.noEmbedding) {
    writeSkippedEmbeddingManifest({
      chunksPath,
      vectorsPath,
      manifestPath: embeddingManifestPath,
      reason: 'Workflow invoked with --no-embedding.',
    });
    writeJsonl(reviewEvidencePath, []);
  } else {
    runNode([
      '.agents/skills/process-evidence-mapping/scripts/build-embedding-manifest.mjs',
      '--chunks', chunksPath,
      '--vectors', vectorsPath,
      '--out', embeddingManifestPath,
      '--no-fail',
    ], { noFail: true });
    aggregateRetrieval({
      chunksPath,
      vectorsPath,
      reviewEvidencePath,
      manifest: readJson(embeddingManifestPath),
      department: args.department,
    });
  }

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/extract-process-review-items.mjs',
    '--chunks', chunksPath,
    '--department', args.department,
    '--review-evidence', reviewEvidencePath,
    '--out', documentReviewItemPath,
  ]);

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/extract-role-review-items.mjs',
    '--chunks', chunksPath,
    '--department', args.department,
    '--out', roleReviewItemsPath,
  ]);

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/build-object-chains.mjs',
    '--chunks', chunksPath,
    '--roles', roleReviewItemsPath,
    '--out', objectChainsPath,
  ]);

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/diff-review-items-with-mapping.mjs',
    '--document', documentReviewItemPath,
    '--roles', roleReviewItemsPath,
    '--objects', objectChainsPath,
    '--mapping', mappingPath,
    '--embedding-manifest', embeddingManifestPath,
    '--out', diffReportPath,
    '--items', mappingItemsPath,
  ]);

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/compile-document-structured-output-v2.mjs',
    '--document', documentReviewItemPath,
    '--roles', roleReviewItemsPath,
    '--objects', objectChainsPath,
    '--issues', mappingItemsPath,
    '--chunks', chunksPath,
    '--department', args.department,
    '--out', structuredOutputPath,
  ]);

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/validate-document-structured-output-v2.mjs',
    '--input', structuredOutputPath,
  ]);

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/update-input-baseline-review-todo-md.mjs',
    '--review-items', structuredOutputPath,
    '--mapping', mappingPath,
    '--todo', todoPath,
  ]);

  console.error(`input_baseline_review_workflow_out=${outDir}`);
  console.error(`input_baseline_review_todo=${todoPath}`);
  console.error(`document_structured_output_v2=${structuredOutputPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
