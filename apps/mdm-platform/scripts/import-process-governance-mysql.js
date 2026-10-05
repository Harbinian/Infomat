#!/usr/bin/env node
/**
 * Import an explicitly selected historical snapshot into the MySQL display read model.
 * Writes the selected MySQL target; never supplies current business authority.
 *
 * Usage:
 *   node scripts/import-process-governance-mysql.js --snapshot <authorized-snapshot.json>
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const { makeProcessGovernanceMysqlRepository } = require('../server/processGovernanceMysqlRepository');
const { importProcessGovernanceMysqlSnapshot } = require('./lib/processGovernanceMysqlImport');

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');

function parseArgs(argv) {
  const args = {
    snapshot: null,
    a1Sources: [],
    qualityFindings: null,
    note: 'Imported from process governance Sankey snapshot'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--snapshot') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('Missing --snapshot value');
      args.snapshot = path.resolve(REPO_ROOT, value);
    } else if (arg.startsWith('--snapshot=')) {
      const value = arg.slice('--snapshot='.length);
      if (!value.trim()) throw new Error('Missing --snapshot value');
      args.snapshot = path.resolve(REPO_ROOT, value);
    } else if (arg === '--a1-source') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('Missing --a1-source value');
      args.a1Sources.push(path.resolve(REPO_ROOT, value));
    } else if (arg.startsWith('--a1-source=')) {
      const value = arg.slice('--a1-source='.length);
      if (!value.trim()) throw new Error('Missing --a1-source value');
      args.a1Sources.push(path.resolve(REPO_ROOT, value));
    } else if (arg === '--quality-findings') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('Missing --quality-findings value');
      args.qualityFindings = path.resolve(REPO_ROOT, value);
    } else if (arg.startsWith('--quality-findings=')) {
      const value = arg.slice('--quality-findings='.length);
      if (!value.trim()) throw new Error('Missing --quality-findings value');
      args.qualityFindings = path.resolve(REPO_ROOT, value);
    } else if (arg === '--note') {
      args.note = argv[++index] || '';
    } else if (arg.startsWith('--note=')) {
      args.note = arg.slice('--note='.length);
    } else if (arg === '--imported-by') {
      args.importedBy = Number(argv[++index] || 0) || null;
    } else if (arg.startsWith('--imported-by=')) {
      args.importedBy = Number(arg.slice('--imported-by='.length)) || null;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Historical display read-model maintenance only. Writes the explicitly configured MySQL target.\nUsage: node scripts/import-process-governance-mysql.js --snapshot <authorized-snapshot.json> [--a1-source <authorized-historical.md>] [--quality-findings findings.json] [--note "..."] [--imported-by 1]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function loadQualityFindings(filePath) {
  if (!filePath) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed.findings) ? parsed.findings : [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assert.ok(args.snapshot, 'Missing --snapshot');
  assert.ok(fs.existsSync(args.snapshot) && fs.statSync(args.snapshot).isFile(), 'Snapshot file is missing');
  for (const inputPath of [...args.a1Sources, ...(args.qualityFindings ? [args.qualityFindings] : [])]) {
    assert.ok(fs.existsSync(inputPath) && fs.statSync(inputPath).isFile(), 'Historical input file is missing');
  }
  for (const key of ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']) {
    if (!String(process.env[key] || '').trim()) throw new Error(`MYSQL_CONFIG_REQUIRED: ${key}`);
  }
  const configuredPort = Number(process.env.MYSQL_PORT);
  assert.ok(Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535, 'MYSQL_PORT must be a valid port');

  const config = mysqlConfigFromEnv();
  const pool = mysql.createPool(config);
  try {
    const repository = makeProcessGovernanceMysqlRepository(pool);
    const result = await importProcessGovernanceMysqlSnapshot({
      repository,
      sourceJsonPath: args.snapshot,
      a1MarkdownPaths: args.a1Sources,
      qualityFindings: loadQualityFindings(args.qualityFindings),
      importedBy: args.importedBy,
      note: args.note
    });
    console.log(`process_governance_mysql_imported_snapshot=${result.snapshot_id} nodes=${result.bundle.nodes.length} links=${result.bundle.links.length} mysql=${JSON.stringify(redactMysqlConfig(config))}`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
