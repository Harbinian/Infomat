#!/usr/bin/env node
/**
 * Import docs/company-sankey-data.json into the MDM MySQL process governance read model.
 *
 * Usage:
 *   node scripts/import-process-governance-mysql.js --snapshot docs/company-sankey-data.json
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
    snapshot: path.join(REPO_ROOT, 'docs', 'company-sankey-data.json'),
    a1Sources: [],
    qualityFindings: null,
    note: 'Imported from process governance Sankey snapshot'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--snapshot') {
      args.snapshot = path.resolve(REPO_ROOT, argv[++index] || '');
    } else if (arg.startsWith('--snapshot=')) {
      args.snapshot = path.resolve(REPO_ROOT, arg.slice('--snapshot='.length));
    } else if (arg === '--a1-source') {
      args.a1Sources.push(path.resolve(REPO_ROOT, argv[++index] || ''));
    } else if (arg.startsWith('--a1-source=')) {
      args.a1Sources.push(path.resolve(REPO_ROOT, arg.slice('--a1-source='.length)));
    } else if (arg === '--quality-findings') {
      args.qualityFindings = path.resolve(REPO_ROOT, argv[++index] || '');
    } else if (arg.startsWith('--quality-findings=')) {
      args.qualityFindings = path.resolve(REPO_ROOT, arg.slice('--quality-findings='.length));
    } else if (arg === '--note') {
      args.note = argv[++index] || '';
    } else if (arg.startsWith('--note=')) {
      args.note = arg.slice('--note='.length);
    } else if (arg === '--imported-by') {
      args.importedBy = Number(argv[++index] || 0) || null;
    } else if (arg.startsWith('--imported-by=')) {
      args.importedBy = Number(arg.slice('--imported-by='.length)) || null;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/import-process-governance-mysql.js --snapshot docs/company-sankey-data.json [--a1-source docs/norms/...md] [--quality-findings findings.json] [--note "..."] [--imported-by 1]');
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
  console.error(error);
  process.exit(1);
});
