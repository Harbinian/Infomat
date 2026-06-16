#!/usr/bin/env node
/**
 * Import one artifacts/process-candidates run into the MDM MySQL candidate review tables.
 *
 * Usage:
 *   node scripts/import-process-candidate-review-mysql.js --candidate-run artifacts/process-candidates/<run-id>
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const {
  loadCandidateRunBundle,
  makeProcessCandidateReviewRepository
} = require('../server/processCandidateReviewRepository');

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--candidate-run') {
      const value = argv[++index];
      args.candidateRun = path.resolve(REPO_ROOT, value || '');
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/import-process-candidate-review-mysql.js --candidate-run artifacts/process-candidates/<run-id>');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assert.ok(args.candidateRun, 'Missing --candidate-run');
  assert.equal(fs.existsSync(args.candidateRun), true, `Candidate run not found: ${args.candidateRun}`);
  assert.equal(
    fs.existsSync(path.join(args.candidateRun, 'mapping_diff_items.json')),
    true,
    `Candidate run is missing mapping_diff_items.json: ${args.candidateRun}`
  );

  const config = mysqlConfigFromEnv();
  const pool = mysql.createPool(config);
  try {
    const bundle = loadCandidateRunBundle(args.candidateRun);
    const repo = makeProcessCandidateReviewRepository(pool);
    await repo.initSchema();
    await repo.upsertBundle(bundle);
    console.log(`process_candidate_review_imported=${bundle.run.run_id} candidates=${bundle.items.length} mysql=${JSON.stringify(redactMysqlConfig(config))}`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
