#!/usr/bin/env node
/**
 * Build local Ollama embeddings for evidence chunks.
 *
 * This writes retrieval artifacts only. Vectors must not be treated as source evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const DEFAULT_CONFIG = path.resolve(SCRIPT_DIR, '../references/ollama-embedding-config.json');

function parseArgs(argv) {
  const args = {
    chunks: 'artifacts/evidence-index/latest/chunks.jsonl',
    config: DEFAULT_CONFIG,
    out: 'artifacts/evidence-index/latest/embedding_manifest.json',
    vectors: 'artifacts/evidence-index/latest/vectors.jsonl',
    batchSize: 8,
    limit: 0,
    dryRun: false,
    noFail: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--help' || key === '-h') { printHelp(); process.exit(0); }
    if (key === '--chunks') { args.chunks = value; i += 1; }
    else if (key === '--config') { args.config = value; i += 1; }
    else if (key === '--out') { args.out = value; i += 1; }
    else if (key === '--vectors') { args.vectors = value; i += 1; }
    else if (key === '--batch-size') { args.batchSize = Number(value); i += 1; }
    else if (key === '--limit') { args.limit = Number(value); i += 1; }
    else if (key === '--dry-run') args.dryRun = true;
    else if (key === '--no-fail') args.noFail = true;
    else throw new Error(`Unknown argument: ${key}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node .agents/skills/process-evidence-mapping/scripts/build-embedding-manifest.mjs --chunks artifacts/evidence-index/<run-id>/chunks.jsonl

Defaults to Ollama qwen3-embedding:latest using .agents/skills/process-evidence-mapping/references/ollama-embedding-config.json.
Use --dry-run to validate inputs without calling Ollama.`);
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
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

async function embedBatch(config, inputs) {
  const url = new URL(config.embed_endpoint || '/api/embed', config.base_url).toString();
  const body = {
    model: config.model,
    input: inputs,
    truncate: config.truncate ?? true,
    keep_alive: config.keep_alive ?? '5m',
  };
  if (config.dimensions) body.dimensions = config.dimensions;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama embed failed ${response.status}: ${text}`);
  }
  const data = await response.json();
  if (!Array.isArray(data.embeddings)) throw new Error('Ollama response missing embeddings array');
  return data.embeddings;
}

function writeManifest(args, config, extra) {
  const endpointPath = config.embed_endpoint || '/api/embed';
  ensureDir(args.out);
  fs.writeFileSync(args.out, JSON.stringify({
    created_at: new Date().toISOString(),
    provider: config.provider,
    base_url: config.base_url,
    endpoint: endpointPath,
    endpoint_url: new URL(endpointPath, config.base_url).toString(),
    model: config.model,
    dimensions: config.dimensions || null,
    chunking_rule: config.chunking_rule || null,
    chunks_file: args.chunks,
    vectors_file: args.vectors,
    role: config.role || 'candidate_evidence_retrieval_only',
    ...extra,
  }, null, 2), 'utf8');
}

async function main() {
  const args = parseArgs(process.argv);
  const config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  if (!fs.existsSync(args.chunks)) throw new Error(`Chunks file not found: ${args.chunks}`);
  let chunks = readJsonl(args.chunks);
  if (args.limit > 0) chunks = chunks.slice(0, args.limit);

  const sourceHash = sha1(chunks.map((chunk) => `${chunk.chunk_id}:${chunk.chunk_hash}`).join('\n'));
  if (args.dryRun) {
    writeManifest(args, config, {
      status: 'dry_run',
      chunks_total: chunks.length,
      embedded_total: 0,
      source_hash: sourceHash,
    });
    console.error(`dry_run chunks=${chunks.length}`);
    return;
  }

  ensureDir(args.vectors);
  const vectorStream = fs.createWriteStream(args.vectors, { encoding: 'utf8' });
  let embeddedTotal = 0;
  try {
    for (let start = 0; start < chunks.length; start += args.batchSize) {
      const batch = chunks.slice(start, start + args.batchSize);
      const inputs = batch.map((chunk) => [chunk.normalized_text, chunk.normalized_candidate].filter(Boolean).join('\n') || chunk.raw_text || '');
      const embeddings = await embedBatch(config, inputs);
      if (embeddings.length !== batch.length) throw new Error(`Embedding count mismatch: got ${embeddings.length}, expected ${batch.length}`);
      embeddings.forEach((embedding, index) => {
        const chunk = batch[index];
        vectorStream.write(JSON.stringify({
          chunk_id: chunk.chunk_id,
          source_file: chunk.source_file,
          chunk_hash: chunk.chunk_hash,
          embedding,
          embedding_model: config.model,
          embedding_dimensions: embedding.length,
          evidence_status: 'candidate',
          verification_status: 'unverified',
          review_required: true,
          allowed_downstream_use: 'review_only',
        }) + '\n');
      });
      embeddedTotal += batch.length;
      console.error(`embedded=${embeddedTotal}/${chunks.length}`);
    }
    vectorStream.end();
    writeManifest(args, config, {
      status: 'embedded',
      chunks_total: chunks.length,
      embedded_total: embeddedTotal,
      source_hash: sourceHash,
    });
  } catch (error) {
    vectorStream.end();
    writeManifest(args, config, {
      status: 'failed',
      chunks_total: chunks.length,
      embedded_total: embeddedTotal,
      source_hash: sourceHash,
      failure_reason: error.message,
    });
    if (!args.noFail) throw error;
    console.error(error.message);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
