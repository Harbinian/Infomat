#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const { inspectProcessV7M0Baseline } = require('../server/processV7M0Baseline');
const { loadFixedMysqlEnvironment } = require('./lib/fixed-mysql-environment');

function outputPath(args) {
  const argument = args.find(value => value.startsWith('--output='));
  return argument ? path.resolve(process.cwd(), argument.slice('--output='.length)) : null;
}

function restoreEvidence(args) {
  const argument = args.find(value => value.startsWith('--restore-evidence='));
  if (!argument) return null;
  const evidencePath = path.resolve(process.cwd(), argument.slice('--restore-evidence='.length));
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  if (
    evidence.status !== 'verified' ||
    !evidence.backup || !/^[a-f0-9]{64}$/.test(String(evidence.backup.sha256 || '')) ||
    !evidence.restore || evidence.restore.inventory_matches_source !== true ||
    evidence.restore.formal_process_matches_source !== true ||
    evidence.restore.container_removed_after_verification !== true
  ) {
    throw Object.assign(new Error('备份恢复证据未通过固定字段核验'), { code: 'M0_RESTORE_EVIDENCE_INVALID' });
  }
  return { ...evidence, evidence_path: evidencePath };
}

async function main() {
  const args = process.argv.slice(2);
  const config = mysqlConfigFromEnv(loadFixedMysqlEnvironment());
  const pool = mysql.createPool(config);
  try {
    const report = await inspectProcessV7M0Baseline(pool, {
      backupRestoreEvidence: restoreEvidence(args) || undefined
    });
    report.target.connection = redactMysqlConfig(config);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    const destination = outputPath(args);
    if (destination) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, serialized, 'utf8');
    }
    process.stdout.write(serialized);
    if (report.gate.status !== 'passed') process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    error: error.message || String(error),
    code: error.code || 'M0_INSPECTION_FAILED'
  }, null, 2)}\n`);
  process.exitCode = 1;
});
