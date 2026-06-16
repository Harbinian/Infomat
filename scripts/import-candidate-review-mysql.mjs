#!/usr/bin/env node
/**
 * Import a process-candidates run into MySQL for browser review.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createMysqlPoolFromEnv,
  loadCandidateRunBundle,
  makeCandidateReviewRepository,
} from './candidate-review-core.mjs';

const root = resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--candidate-run') {
      args.candidateRun = resolve(root, argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/import-candidate-review-mysql.mjs --candidate-run artifacts/process-candidates/<run-id>');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
assert.ok(args.candidateRun, 'Missing --candidate-run');
assert.equal(existsSync(args.candidateRun), true, `Candidate run not found: ${args.candidateRun}`);

const bundle = loadCandidateRunBundle(args.candidateRun);
const pool = await createMysqlPoolFromEnv();
try {
  const repo = makeCandidateReviewRepository(pool);
  await repo.initSchema();
  await repo.upsertBundle(bundle);
  console.log(`candidate_review_run_imported=${bundle.run.run_id} candidates=${bundle.items.length}`);
} finally {
  await pool.end();
}
