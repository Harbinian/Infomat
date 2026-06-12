#!/usr/bin/env node
/**
 * Build traceable evidence chunks for retrieval.
 *
 * This script creates candidate retrieval units only. It does not decide DCM/BBM facts.
 *
 * Inputs:
 *   --root docs/norms
 * Outputs:
 *   --out build/evidence/evidence_chunks.jsonl
 *   --source-index build/evidence/source_index.jsonl
 *   --warnings build/evidence/chunking_warnings.md
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.json', '.html', '.htm']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'artifacts', 'test-results']);

function parseArgs(argv) {
  const args = {
    root: 'docs/norms',
    out: 'artifacts/evidence-index/latest/chunks.jsonl',
    sourceIndex: 'artifacts/evidence-index/latest/source_index.jsonl',
    warnings: 'artifacts/evidence-index/latest/chunking_warnings.md',
    maxChars: 1600,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--help' || key === '-h') {
      printHelp();
      process.exit(0);
    }
    if (key === '--root') { args.root = value; i += 1; }
    else if (key === '--out') { args.out = value; i += 1; }
    else if (key === '--source-index') { args.sourceIndex = value; i += 1; }
    else if (key === '--warnings') { args.warnings = value; i += 1; }
    else if (key === '--max-chars') { args.maxChars = Number(value); i += 1; }
    else throw new Error(`Unknown argument: ${key}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node .agents/skills/process-evidence-mapping/scripts/source-chunker.mjs --root docs/norms --out artifacts/evidence-index/<run-id>/chunks.jsonl

Supported text inputs: .md, .txt, .csv, .json, .html, .htm.
Binary Office/PDF/VSD files should first be converted/extracted; unsupported files are recorded in warnings.`);
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function toRepoPath(filePath) {
  return path.relative(process.cwd(), filePath).replaceAll(path.sep, '/');
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name);
    }
  }
}

function normalizeText(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clauseFromHeading(heading) {
  const match = heading.match(/(?:§\s*)?(\d+(?:\.\d+){0,5})/);
  return match ? match[1] : '';
}

function chunkText({ text, source, maxChars }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks = [];
  let sectionTitle = '';
  let buffer = [];
  let paragraphId = 0;
  let tableId = 0;
  let rowId = 0;

  function flushBuffer() {
    const raw = buffer.join('\n').trim();
    if (!raw) return;
    paragraphId += 1;
    chunks.push({
      ...source,
      paragraph_id: String(paragraphId),
      clause: clauseFromHeading(sectionTitle),
      clause_title: sectionTitle,
      raw_text: raw,
      normalized_text: normalizeText(raw),
      normalized_candidate: '',
      artifact_type: 'body',
      extraction_method: 'text',
      extraction_quality: 'clean',
      verification_status: 'unverified',
      allowed_downstream_use: 'review_only',
    });
    buffer = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      flushBuffer();
      sectionTitle = trimmed.replace(/^#{1,6}\s+/, '').trim();
      continue;
    }
    if (/^\|.*\|$/.test(trimmed)) {
      flushBuffer();
      if (rowId === 0) tableId += 1;
      rowId += 1;
      if (!/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) {
        chunks.push({
          ...source,
          table_id: `T${tableId}`,
          row_id: String(rowId),
          clause: clauseFromHeading(sectionTitle),
          clause_title: sectionTitle,
          raw_text: trimmed,
          normalized_text: normalizeText(trimmed),
          normalized_candidate: '',
          artifact_type: 'table',
          extraction_method: 'text',
          extraction_quality: 'clean',
          verification_status: 'unverified',
          allowed_downstream_use: 'review_only',
        });
      }
      continue;
    }
    if (!trimmed) {
      flushBuffer();
      rowId = 0;
      continue;
    }
    buffer.push(line);
    if (buffer.join('\n').length >= maxChars) flushBuffer();
  }
  flushBuffer();
  return chunks;
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.root);
  if (!fs.existsSync(root)) throw new Error(`Root does not exist: ${root}`);

  const chunkLines = [];
  const sourceLines = [];
  const warnings = [];
  let chunkCount = 0;
  let sourceCount = 0;
  let unsupportedCount = 0;

  for (const file of walk(root)) {
    const ext = path.extname(file).toLowerCase();
    const rel = toRepoPath(file);
    const stat = fs.statSync(file);
    const sourceFileId = sha1(rel).slice(0, 16);
    const sourceBase = {
      source_file_id: sourceFileId,
      source_file: rel,
      source_file_name: path.basename(file),
      leaf_dir: toRepoPath(path.dirname(file)),
      file_ext: ext || '(none)',
      file_size: stat.size,
      modified_time: stat.mtime.toISOString(),
      extraction_status: TEXT_EXTENSIONS.has(ext) ? 'text_read' : 'unsupported',
      included_status: 'candidate',
      included_reason: 'Chunked for retrieval review only; inclusion still requires source verification.',
    };

    if (!TEXT_EXTENSIONS.has(ext)) {
      unsupportedCount += 1;
      warnings.push(`- unsupported: \`${rel}\``);
      sourceLines.push(JSON.stringify(sourceBase));
      continue;
    }

    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      warnings.push(`- failed: \`${rel}\` - ${error.message}`);
      sourceLines.push(JSON.stringify({ ...sourceBase, extraction_status: 'failed', failure_reason: error.message }));
      continue;
    }

    const contentHash = sha1(text);
    sourceCount += 1;
    sourceLines.push(JSON.stringify({ ...sourceBase, extraction_status: 'chunked', content_hash: contentHash }));
    const source = {
      source_file_id: sourceFileId,
      source_file: rel,
      source_file_name: path.basename(file),
      leaf_dir: toRepoPath(path.dirname(file)),
      doc_no: '',
      version: '',
      source_company: '',
      source_org_name: '',
      retrieval_method: 'chunking',
      evidence_status: 'candidate',
      review_required: true,
      review_reason: 'Retrieval chunk only; verify original source before using in mapping.',
      content_hash: contentHash,
    };

    for (const chunk of chunkText({ text, source, maxChars: args.maxChars })) {
      if (!chunk.normalized_text) continue;
      chunkCount += 1;
      const chunkHash = sha1(chunk.raw_text);
      chunkLines.push(JSON.stringify({
        chunk_id: `${sourceFileId}-${String(chunkCount).padStart(6, '0')}`,
        ...chunk,
        chunk_hash: chunkHash,
      }));
    }
  }

  ensureDir(args.out);
  ensureDir(args.sourceIndex);
  ensureDir(args.warnings);
  fs.writeFileSync(args.out, `${chunkLines.join('\n')}${chunkLines.length ? '\n' : ''}`, 'utf8');
  fs.writeFileSync(args.sourceIndex, `${sourceLines.join('\n')}${sourceLines.length ? '\n' : ''}`, 'utf8');
  fs.writeFileSync(args.warnings, [
    '# Chunking Warnings',
    '',
    `- text sources chunked: ${sourceCount}`,
    `- chunks: ${chunkCount}`,
    `- unsupported files: ${unsupportedCount}`,
    '',
    ...warnings,
    '',
  ].join('\n'), 'utf8');

  console.error(`chunks=${chunkCount} text_sources=${sourceCount} unsupported=${unsupportedCount}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

