#!/usr/bin/env node
/**
 * Retrieve review evidence chunks using local Ollama embeddings.
 *
 * Output is review-only. It must be source-verified before any mapping use.
 */
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const DEFAULT_CONFIG = path.resolve(SCRIPT_DIR, '../references/ollama-embedding-config.json');

function parseArgs(argv) {
  const args = {
    query: '',
    chunks: 'artifacts/evidence-index/latest/chunks.jsonl',
    vectors: 'artifacts/evidence-index/latest/vectors.jsonl',
    config: DEFAULT_CONFIG,
    out: 'artifacts/evidence-index/latest/review_evidence.jsonl',
    topK: 10,
    noFail: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--help' || key === '-h') { printHelp(); process.exit(0); }
    if (key === '--query') { args.query = value; i += 1; }
    else if (key === '--chunks') { args.chunks = value; i += 1; }
    else if (key === '--vectors') { args.vectors = value; i += 1; }
    else if (key === '--config') { args.config = value; i += 1; }
    else if (key === '--out') { args.out = value; i += 1; }
    else if (key === '--top-k') { args.topK = Number(value); i += 1; }
    else if (key === '--no-fail') args.noFail = true;
    else throw new Error(`Unknown argument: ${key}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node .agents/skills/process-evidence-mapping/scripts/evidence-retriever.mjs --query "绩效结果 综合打分表 核算结果" --top-k 8

Results are reviewItems only and default to allowed_downstream_use=review_only.`);
}

function classifyRelation(query, text, chunk) {
  const haystack = `${query} ${text}`;
  if (chunk.extraction_quality && chunk.extraction_quality !== 'clean') return 'extraction_quality_issue';
  if (/归档|保存|保管|留存/.test(text)) return 'archive_or_retention';
  if (/编制|校对|核对|审核|审批|批准|初审|复核|签批/.test(haystack)) return 'approval_chain_review';
  if (/通报|发布|下发|签收|提交|反馈|发放|传递|流转/.test(text)) return 'controlled_transfer_review';
  if (/负责|职责|配合|参与|主管部门|责任部门/.test(text)) return 'responsibility_or_participation';
  if (/依据|根据|来源|引用|参考/.test(text)) return 'reference_basis';
  if (/绩效结果|核算结果|综合打分表|评分表|得分表|对象|别名/.test(haystack)) return 'object_alias_review';
  return 'object_alias_review';
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function dot(a, b) {
  let value = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) value += a[i] * b[i];
  return value;
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

function cosine(a, b) {
  const denom = norm(a) * norm(b);
  return denom ? dot(a, b) / denom : 0;
}

async function embedQuery(config, query) {
  const url = new URL(config.embed_endpoint || '/api/embed', config.base_url).toString();
  const body = {
    model: config.model,
    input: query,
    truncate: config.truncate ?? true,
    keep_alive: config.keep_alive ?? '5m',
  };
  if (config.dimensions) body.dimensions = config.dimensions;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Ollama embed failed ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (!Array.isArray(data.embeddings) || !data.embeddings[0]) throw new Error('Ollama response missing query embedding');
  return data.embeddings[0];
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.query) throw new Error('Missing --query');
  if (!fs.existsSync(args.chunks)) throw new Error(`Chunks file not found: ${args.chunks}`);
  if (!fs.existsSync(args.vectors)) throw new Error(`Vectors file not found: ${args.vectors}`);
  const config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  const chunksById = new Map(readJsonl(args.chunks).map((chunk) => [chunk.chunk_id, chunk]));
  const vectors = readJsonl(args.vectors);

  let queryEmbedding;
  try {
    queryEmbedding = await embedQuery(config, args.query);
  } catch (error) {
    if (!args.noFail) throw error;
    console.error(error.message);
    return;
  }

  const results = vectors
    .map((record) => ({
      record,
      score: cosine(queryEmbedding, record.embedding),
      chunk: chunksById.get(record.chunk_id),
    }))
    .filter((item) => item.chunk)
    .sort((a, b) => b.score - a.score)
    .slice(0, args.topK)
    .map((item, index) => ({
      rank: index + 1,
      query: args.query,
      claim_type: 'review_evidence',
      claim_text: item.chunk.raw_text,
      supporting_chunk_ids: [item.record.chunk_id],
      source_file: item.chunk.source_file,
      source_anchor: item.chunk.clause || item.chunk.clause_title || item.chunk.table_id || item.chunk.form_name || '',
      retrieval_method: 'vector',
      retrieval_score: Number(item.score.toFixed(6)),
      relation_type: classifyRelation(args.query, item.chunk.raw_text, item.chunk),
      extraction_quality: item.chunk.extraction_quality || 'clean',
      evidence_status: 'pending_review',
      verification_status: item.chunk.verification_status || 'unverified',
      review_required: true,
      review_reason: 'Vector retrieval result; verify original source before mapping use.',
      allowed_downstream_use: 'review_only',
      raw_text: item.chunk.raw_text,
    }));

  ensureDir(args.out);
  fs.writeFileSync(args.out, `${results.map((result) => JSON.stringify(result)).join('\n')}${results.length ? '\n' : ''}`, 'utf8');
  console.error(`review_items=${results.length} out=${args.out}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

