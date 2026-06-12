#!/usr/bin/env node
/**
 * Run the review-only process candidate workflow.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ensureDir,
  makeCandidateItem,
  parseArgs,
  readJson,
  readJsonl,
  requireArg,
  sha1File,
  writeJson,
  writeJsonl,
} from './candidate-utils.mjs';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const EMBEDDING_CONFIG = path.join(REPO_ROOT, '.agents', 'skills', 'process-evidence-mapping', 'references', 'ollama-embedding-config.json');
const VISUAL_EXTS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff']);

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
    role: config.role || 'candidate_evidence_retrieval_only',
    source_hash: sha1File(chunksPath),
    similarity_policy: 'similarity is candidate ranking only, not evidence strength',
    default_evidence_status: 'candidate',
    allowed_downstream_use: 'review_only',
  });
  writeJsonl(vectorsPath, []);
}

function aggregateRetrieval({ chunksPath, vectorsPath, candidateEvidencePath, manifest }) {
  if (manifest.status !== 'embedded') {
    writeJsonl(candidateEvidencePath, []);
    return;
  }

  const queries = [
    '工时调整 情况说明 车间主任 定额员 经营发展部长 审核',
    '行政人事部 工资总额 明细费用 发至 财务部门',
    '盈亏处理 审批权限 审核批准 责任者赔偿',
    '废品损失 退回复材车间 生产成本 红字冲回',
    '相关报表 财务部 存档 保存年限30年',
  ];

  const all = [];
  queries.forEach((query, index) => {
    const tempOut = path.join(path.dirname(candidateEvidencePath), `_candidate_query_${index + 1}.jsonl`);
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
  writeJsonl(candidateEvidencePath, all);
}

function appendOcrReviewItems({ outDir, mappingItemsPath, department }) {
  const items = readJson(mappingItemsPath);
  const reviewPath = path.join(outDir, 'ocr', 'review-required.jsonl');
  if (fs.existsSync(reviewPath)) {
    for (const record of readJsonl(reviewPath)) {
      items.push(makeCandidateItem({
        department,
        sourceFile: record.source_file || '',
        sourceAnchor: record.page_id || record.block_id || '',
        candidateType: 'OCR待复核',
        content: `OCR待复核：${record.source_file || ''} ${record.review_reason || record.reason || '需要回到原图/PDF核验'}`,
        mappingLocation: 'OCR候选未进入正式映射',
        suggestedAction: '回到原PDF/图片位置核验；不得只看OCR文本入库。',
        owner: '资料责任人/流程治理负责人',
      }));
    }
  }

  const needsOcrChunks = readJsonl(path.join(outDir, 'chunks.jsonl')).filter((chunk) => chunk.extraction_quality === 'needs_ocr');
  for (const chunk of needsOcrChunks) {
    items.push(makeCandidateItem({
      department,
      sourceFile: chunk.source_file || '',
      sourceAnchor: chunk.clause || chunk.table_id || chunk.chunk_id || '',
      candidateType: 'OCR待复核',
      content: `OCR待复核：${chunk.source_file || ''} ${chunk.raw_text || '低可读页面/视觉证据'}`,
      mappingLocation: '低可读chunk未进入正式映射',
      suggestedAction: '补OCR或人工读取原图后再判断是否进入候选映射。',
      owner: '资料责任人/流程治理负责人',
    }));
  }

  writeJson(mappingItemsPath, items);
}

function main() {
  const args = parseArgs(process.argv, {
    out: path.join('artifacts', 'process-candidates', new Date().toISOString().replace(/[:.]/g, '-')),
    todo: path.join('docs', 'norms', '流程治理', '候选映射待办.md'),
  });
  requireArg(args, 'input');
  requireArg(args, 'department');
  requireArg(args, 'mapping');

  const inputPath = repoResolve(args.input);
  const outDir = repoResolve(args.out);
  const todoPath = repoResolve(args.todo);
  const mappingPath = repoResolve(args.mapping);
  ensureDir(outDir);

  const sourceManifestPath = path.join(outDir, 'source_manifest.jsonl');
  const chunksPath = path.join(outDir, 'chunks.jsonl');
  const warningsPath = path.join(outDir, 'chunking_warnings.md');
  const embeddingManifestPath = path.join(outDir, 'embedding_manifest.json');
  const vectorsPath = path.join(outDir, 'vectors.jsonl');
  const candidateEvidencePath = path.join(outDir, 'candidate_evidence.jsonl');
  const documentCandidatePath = path.join(outDir, 'document_candidate.json');
  const roleCandidatesPath = path.join(outDir, 'role_candidates.json');
  const objectChainsPath = path.join(outDir, 'object_chains.json');
  const diffReportPath = path.join(outDir, 'mapping_diff_report.md');
  const mappingItemsPath = path.join(outDir, 'mapping_diff_items.json');

  if (VISUAL_EXTS.has(path.extname(inputPath).toLowerCase()) && !args.noOcr) {
    runNode([
      'scripts/ocr-source.mjs',
      '--input', inputPath,
      '--out', path.join(outDir, 'ocr'),
    ], { noFail: true });
  }

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/extract-evidence-chunks.mjs',
    '--input', inputPath,
    '--out', chunksPath,
    '--source-index', sourceManifestPath,
    '--warnings', warningsPath,
  ], { inherit: false });

  if (args.noEmbedding) {
    writeSkippedEmbeddingManifest({
      chunksPath,
      vectorsPath,
      manifestPath: embeddingManifestPath,
      reason: 'Workflow invoked with --no-embedding.',
    });
    writeJsonl(candidateEvidencePath, []);
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
      candidateEvidencePath,
      manifest: readJson(embeddingManifestPath),
    });
  }

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/extract-process-candidates.mjs',
    '--chunks', chunksPath,
    '--department', args.department,
    '--candidate-evidence', candidateEvidencePath,
    '--out', documentCandidatePath,
  ]);

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/extract-role-candidates.mjs',
    '--chunks', chunksPath,
    '--department', args.department,
    '--out', roleCandidatesPath,
  ]);

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/build-object-chains.mjs',
    '--chunks', chunksPath,
    '--roles', roleCandidatesPath,
    '--out', objectChainsPath,
  ]);

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/diff-candidates-with-mapping.mjs',
    '--document', documentCandidatePath,
    '--roles', roleCandidatesPath,
    '--objects', objectChainsPath,
    '--mapping', mappingPath,
    '--embedding-manifest', embeddingManifestPath,
    '--out', diffReportPath,
    '--items', mappingItemsPath,
  ]);

  appendOcrReviewItems({
    outDir,
    mappingItemsPath,
    department: args.department,
  });

  runNode([
    '.agents/skills/process-evidence-mapping/scripts/update-candidate-todo-md.mjs',
    '--candidates', mappingItemsPath,
    '--mapping', mappingPath,
    '--todo', todoPath,
  ]);

  console.error(`candidate_workflow_out=${outDir}`);
  console.error(`candidate_todo=${todoPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
