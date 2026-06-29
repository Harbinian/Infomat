#!/usr/bin/env node
/**
 * Import a process-input-baseline-review run into MySQL for browser review.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createMysqlPoolFromEnv,
  loadReviewRunBundle,
  makeInputBaselineReviewRepository,
} from './input-baseline-review-core.mjs';

const root = resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--review-run') {
      args.reviewRun = resolve(root, argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/import-input-baseline-review-mysql.mjs --review-run artifacts/process-input-baseline-review/<run-id>');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
assert.ok(args.reviewRun, 'Missing --review-run');
assert.equal(existsSync(args.reviewRun), true, `Review run not found: ${args.reviewRun}`);

const bundle = loadReviewRunBundle(args.reviewRun);
const pool = await createMysqlPoolFromEnv();
try {
  const repo = makeInputBaselineReviewRepository(pool);
  await repo.initSchema();
  await repo.upsertBundle(bundle);
  console.log(`input_baseline_review_run_imported=${bundle.run.run_id} review_items=${bundle.items.length}`);
} finally {
  await pool.end();
}
