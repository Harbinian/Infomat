#!/usr/bin/env node
/**
 * Extract source evidence into traceable retrieval chunks.
 *
 * This creates review-only chunks. It never updates DCM/BBM/Sankey truth.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const PY_HELPER = path.join(SCRIPT_DIR, 'evidence_extractor.py');

function parseArgs(argv) {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join('artifacts', 'evidence-index', runId);
  const args = {
    input: '',
    out: path.join(base, 'chunks.jsonl'),
    sourceIndex: '',
    warnings: '',
    tempDir: '',
    python: process.env.PYTHON || 'python',
    includeExt: '',
    excludeExt: '',
    deferExt: '',
    deferReason: 'Deferred by --defer-ext for a separate extraction batch.',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--help' || key === '-h') { printHelp(); process.exit(0); }
    if (key === '--input') { args.input = value; i += 1; }
    else if (key === '--out') { args.out = value; i += 1; }
    else if (key === '--source-index') { args.sourceIndex = value; i += 1; }
    else if (key === '--warnings') { args.warnings = value; i += 1; }
    else if (key === '--temp-dir') { args.tempDir = value; i += 1; }
    else if (key === '--python') { args.python = value; i += 1; }
    else if (key === '--include-ext') { args.includeExt = value; i += 1; }
    else if (key === '--exclude-ext') { args.excludeExt = value; i += 1; }
    else if (key === '--defer-ext') { args.deferExt = value; i += 1; }
    else if (key === '--defer-reason') { args.deferReason = value; i += 1; }
    else throw new Error(`Unknown argument: ${key}`);
  }
  if (!args.input) throw new Error('Missing --input');
  if (!args.sourceIndex) args.sourceIndex = path.join(path.dirname(args.out), 'source_index.jsonl');
  if (!args.warnings) args.warnings = path.join(path.dirname(args.out), 'chunking_warnings.md');
  if (!args.tempDir) args.tempDir = path.join(path.dirname(args.out), '_tmp_conversions');
  return args;
}

function printHelp() {
  console.log(`Usage:
  node .agents/skills/process-evidence-mapping/scripts/extract-evidence-chunks.mjs --input <file-or-dir> --out artifacts/evidence-index/<run-id>/chunks.jsonl

Supported inputs: .docx, .doc, .xlsx, .xls, .md, .txt, .html, .pdf, .vsd/.vsdx.
Use --defer-ext .vsd,.vsdx to keep Visio files in the source index without invoking Visio.
Use --defer-reason to record why deferred files are not extracted in this run.
Outputs are candidate retrieval artifacts only; raw_text is never corrected.`);
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.input)) throw new Error(`Input does not exist: ${args.input}`);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  const pyArgs = [
    PY_HELPER,
    '--input', args.input,
    '--out', args.out,
    '--source-index', args.sourceIndex,
    '--warnings', args.warnings,
    '--temp-dir', args.tempDir,
  ];
  if (args.includeExt) pyArgs.push('--include-ext', args.includeExt);
  if (args.excludeExt) pyArgs.push('--exclude-ext', args.excludeExt);
  if (args.deferExt) pyArgs.push('--defer-ext', args.deferExt);
  if (args.deferReason) pyArgs.push('--defer-reason', args.deferReason);

  const result = spawnSync(args.python, pyArgs, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1' },
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`extractor failed with exit code ${result.status}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
