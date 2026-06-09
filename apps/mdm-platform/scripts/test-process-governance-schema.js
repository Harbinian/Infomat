const assert = require('assert');
const Database = require('better-sqlite3');
const { testDbPath, cleanupDb } = require('./testHelpers/isolatedDb');

const legacyDb = new Database(testDbPath);
legacyDb.pragma('foreign_keys = OFF');
legacyDb.exec(`
CREATE TABLE process_governance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_json_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  generated_at TEXT,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  imported_by INTEGER REFERENCES users(id),
  stats_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  note TEXT
);

CREATE TABLE process_interaction_chains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  chain_key TEXT NOT NULL,
  source_dept TEXT,
  target_dept TEXT,
  steps_json TEXT NOT NULL,
  breaks_json TEXT,
  source_report TEXT,
  UNIQUE(snapshot_id, chain_key)
);

CREATE TABLE process_cross_dept_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES process_governance_snapshots(id) ON DELETE CASCADE,
  source_dept TEXT,
  target_dept TEXT,
  a1_code TEXT,
  refs INTEGER DEFAULT 0,
  risk_level TEXT CHECK(risk_level IN ('high','medium','low')),
  confirm_status TEXT NOT NULL DEFAULT 'pending' CHECK(confirm_status IN ('confirmed','pending','needs_review','not_mapped')),
  description TEXT,
  source_report TEXT
);

INSERT INTO process_governance_snapshots (source_json_path, source_hash, stats_json)
VALUES ('legacy.json', 'legacy-hash', '{}');
INSERT INTO process_interaction_chains (snapshot_id, chain_key, steps_json, breaks_json, source_report)
VALUES (1, 'legacy-chain', '[]', '["break"]', 'legacy-report.md');
INSERT INTO process_cross_dept_interactions (snapshot_id, source_dept, target_dept, risk_level)
VALUES (1, 'Dept A', 'Dept B', NULL);
`);
legacyDb.close();

const db = require('../server/db');

function tableInfo(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function tableColumns(tableName) {
  return tableInfo(tableName).map(row => row.name);
}

function columnInfo(tableName, columnName) {
  return tableInfo(tableName).find(row => row.name === columnName);
}

try {
  [
    'process_governance_snapshots',
    'process_governance_nodes',
    'process_governance_edges',
    'process_a1_items',
    'process_cross_dept_interactions',
    'process_interaction_chains',
    'process_governance_quality_findings',
  ].forEach(tableName => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    assert.ok(row, `${tableName} should exist`);
  });

  assert.ok(tableColumns('process_governance_snapshots').includes('source_hash'));
  assert.ok(tableColumns('process_governance_nodes').includes('node_type'));
  assert.ok(tableColumns('process_governance_edges').includes('edge_type'));
  assert.ok(tableColumns('process_a1_items').includes('a1_code'));
  assert.ok(tableColumns('process_cross_dept_interactions').includes('confirm_status'));
  assert.strictEqual(columnInfo('process_cross_dept_interactions', 'risk_level').notnull, 1);
  assert.ok(tableColumns('process_interaction_chains').includes('breaks_json'));
  assert.ok(tableColumns('process_interaction_chains').includes('name'));
  assert.ok(tableColumns('process_interaction_chains').includes('status'));
  assert.ok(tableColumns('process_governance_quality_findings').includes('finding_key'));
  assert.ok(tableColumns('process_governance_quality_findings').includes('dept_name'));
  assert.ok(!tableColumns('process_interaction_chains').includes('chain_key'));
  assert.ok(!tableColumns('process_interaction_chains').includes('steps_json'));
  assert.ok(tableColumns('field_entries').includes('process_governance_node_key'));
  assert.ok(tableColumns('field_entries').includes('process_governance_a1_code'));

  const migratedChain = db.prepare('SELECT name, status, breaks_json, source_report FROM process_interaction_chains WHERE id=1').get();
  assert.deepStrictEqual(migratedChain, {
    name: 'legacy-chain',
    status: 'partial',
    breaks_json: '["break"]',
    source_report: 'legacy-report.md',
  });

  const migratedInteraction = db.prepare('SELECT risk_level FROM process_cross_dept_interactions WHERE id=1').get();
  assert.strictEqual(migratedInteraction.risk_level, 'low');

  assert.throws(() => {
    db.prepare(`
      INSERT INTO process_cross_dept_interactions (snapshot_id, source_dept, target_dept, risk_level)
      VALUES (1, 'Dept A', 'Dept B', 'critical')
    `).run();
  });

  assert.throws(() => {
    db.prepare(`
      INSERT INTO process_interaction_chains (snapshot_id, name, status)
      VALUES (1, 'invalid chain', 'unknown')
    `).run();
  });

  assert.throws(() => {
    db.prepare(`
      INSERT INTO process_governance_quality_findings
        (snapshot_id, severity, area, source_file, message, finding_key)
      VALUES (1, 'CRITICAL', 'ORG', 'docs/organization/组织架构和部门职责.md', 'invalid severity', 'bad-severity')
    `).run();
  });

  console.log('Process governance schema test passed');
} finally {
  db.close();
  cleanupDb();
}
