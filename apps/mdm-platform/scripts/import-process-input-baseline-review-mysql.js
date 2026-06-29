#!/usr/bin/env node
/**
 * Import one artifacts/process-input-baseline-review run into the MDM MySQL input baseline review tables.
 *
 * Usage:
 *   node scripts/import-process-input-baseline-review-mysql.js --review-run artifacts/process-input-baseline-review/<run-id>
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const {
  loadReviewRunBundle,
  makeProcessInputBaselineReviewRepository
} = require('../server/processInputBaselineReviewRepository');

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--review-run') {
      const value = argv[++index];
      args.reviewRun = path.resolve(REPO_ROOT, value || '');
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/import-process-input-baseline-review-mysql.js --review-run artifacts/process-input-baseline-review/<run-id>');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assert.ok(args.reviewRun, 'Missing --review-run');
  assert.equal(fs.existsSync(args.reviewRun), true, `Review run not found: ${args.reviewRun}`);
  assert.equal(
    fs.existsSync(path.join(args.reviewRun, 'mapping_diff_items.json')),
    true,
    `Review run is missing mapping_diff_items.json: ${args.reviewRun}`
  );

  const config = mysqlConfigFromEnv();
  const pool = mysql.createPool(config);
  try {
    const bundle = loadReviewRunBundle(args.reviewRun);
    const repo = makeProcessInputBaselineReviewRepository(pool);
    await repo.initSchema();
    await repo.upsertBundle(bundle);
    console.log(`process_input_baseline_review_imported=${bundle.run.run_id} review_items=${bundle.items.length} mysql=${JSON.stringify(redactMysqlConfig(config))}`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
