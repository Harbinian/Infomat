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
    'process_governance_quality_cases',
    'process_governance_quality_case_events',
    'process_mapping_records',
    'process_mapping_todos',
    'process_mapping_todo_events',
    'process_source_files',
    'process_mdm_requirement_items',
    'process_evidence_refs',
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
  assert.ok(tableColumns('process_governance_quality_findings').includes('case_id'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('finding_key'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('latest_snapshot_id'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('latest_finding_id'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('status'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('owner_user_id'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('owner_dept_id'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('priority'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('due_date'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('closed_by'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('closed_at'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('closure_note'));
  assert.ok(tableColumns('process_governance_quality_cases').includes('reopened_count'));
  assert.ok(tableColumns('process_governance_quality_case_events').includes('case_id'));
  assert.ok(tableColumns('process_governance_quality_case_events').includes('event_type'));
  assert.ok(tableColumns('process_governance_quality_case_events').includes('actor_user_id'));
  assert.ok(tableColumns('process_governance_quality_case_events').includes('note'));
  assert.ok(tableColumns('process_governance_quality_case_events').includes('payload_json'));
  assert.ok(tableColumns('process_mapping_records').includes('mapping_key'));
  assert.ok(tableColumns('process_mapping_records').includes('record_type'));
  assert.ok(tableColumns('process_mapping_records').includes('latest_snapshot_id'));
  assert.ok(tableColumns('process_mapping_records').includes('parent_record_id'));
  assert.ok(tableColumns('process_mapping_records').includes('dept_name'));
  assert.ok(tableColumns('process_mapping_records').includes('l2_name'));
  assert.ok(tableColumns('process_mapping_records').includes('l3_name'));
  assert.ok(tableColumns('process_mapping_records').includes('a1_code'));
  assert.ok(tableColumns('process_mapping_records').includes('status'));
  assert.ok(tableColumns('process_mapping_todos').includes('todo_key'));
  assert.ok(tableColumns('process_mapping_todos').includes('mapping_record_id'));
  assert.ok(tableColumns('process_mapping_todos').includes('todo_type'));
  assert.ok(tableColumns('process_mapping_todos').includes('status'));
  assert.ok(tableColumns('process_mapping_todos').includes('owner_user_id'));
  assert.ok(tableColumns('process_mapping_todos').includes('owner_dept_id'));
  assert.ok(tableColumns('process_mapping_todos').includes('target_dept_name'));
  assert.ok(tableColumns('process_mapping_todos').includes('reopened_count'));
  assert.ok(tableColumns('process_mapping_todo_events').includes('todo_id'));
  assert.ok(tableColumns('process_mapping_todo_events').includes('event_type'));
  assert.ok(tableColumns('process_mapping_todo_events').includes('payload_json'));
  assert.ok(tableColumns('process_source_files').includes('snapshot_id'));
  assert.ok(tableColumns('process_source_files').includes('file_path'));
  assert.ok(tableColumns('process_source_files').includes('dept_name'));
  assert.ok(tableColumns('process_source_files').includes('asset_type'));
  assert.ok(tableColumns('process_source_files').includes('file_no'));
  assert.ok(tableColumns('process_source_files').includes('revision'));
  assert.ok(tableColumns('process_source_files').includes('size_bytes'));
  assert.ok(tableColumns('process_source_files').includes('mtime'));
  assert.ok(tableColumns('process_source_files').includes('sha256'));
  assert.ok(tableColumns('process_source_files').includes('process_status'));
  assert.ok(tableColumns('process_source_files').includes('process_reason'));
  assert.ok(tableColumns('process_mdm_requirement_items').includes('snapshot_id'));
  assert.ok(tableColumns('process_mdm_requirement_items').includes('dept_name'));
  assert.ok(tableColumns('process_mdm_requirement_items').includes('master_data_object'));
  assert.ok(tableColumns('process_mdm_requirement_items').includes('source_l2'));
  assert.ok(tableColumns('process_mdm_requirement_items').includes('key_fields'));
  assert.ok(tableColumns('process_mdm_requirement_items').includes('responsible_dept'));
  assert.ok(tableColumns('process_mdm_requirement_items').includes('system_boundary'));
  assert.ok(tableColumns('process_mdm_requirement_items').includes('governance_requirement'));
  assert.ok(tableColumns('process_mdm_requirement_items').includes('source_file'));
  assert.ok(tableColumns('process_evidence_refs').includes('snapshot_id'));
  assert.ok(tableColumns('process_evidence_refs').includes('ref_type'));
  assert.ok(tableColumns('process_evidence_refs').includes('dept_name'));
  assert.ok(tableColumns('process_evidence_refs').includes('l3_name'));
  assert.ok(tableColumns('process_evidence_refs').includes('a1_code'));
  assert.ok(tableColumns('process_evidence_refs').includes('master_data_object'));
  assert.ok(tableColumns('process_evidence_refs').includes('evidence_type'));
  assert.ok(tableColumns('process_evidence_refs').includes('source_file'));
  assert.ok(tableColumns('process_evidence_refs').includes('citation'));
  assert.ok(tableColumns('process_evidence_refs').includes('note'));
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

  assert.throws(() => {
    db.prepare(`
      INSERT INTO process_governance_quality_cases
        (finding_key, first_snapshot_id, latest_snapshot_id, severity, area, source_file, message, status)
      VALUES ('bad-status', 1, 1, 'BLOCK', 'ORG', 'docs/organization/组织架构和部门职责.md', 'invalid status', 'done')
    `).run();
  });

  assert.throws(() => {
    db.prepare(`
      INSERT INTO process_mapping_records
        (mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, l3_name, status)
      VALUES ('bad-record-type', 'field', 1, 1, '经营发展部', '销售订单评审和执行管理', 'active')
    `).run();
  });

  assert.throws(() => {
    db.prepare(`
      INSERT INTO process_mapping_todos
        (todo_key, todo_type, first_snapshot_id, latest_snapshot_id, dept_name, message, status)
      VALUES ('bad-todo-status', 'verification', 1, 1, '经营发展部', 'invalid status', 'done')
    `).run();
  });

  assert.throws(() => {
    db.prepare(`
      INSERT INTO process_source_files
        (snapshot_id, file_path, process_status)
      VALUES (1, 'docs/norms/bad.docx', '处理中')
    `).run();
  });

  assert.throws(() => {
    db.prepare(`
      INSERT INTO process_evidence_refs
        (snapshot_id, ref_key, ref_type, source_file)
      VALUES (1, 'bad-ref-type', 'FIELD', 'docs/norms/source.md')
    `).run();
  });

  console.log('Process governance schema test passed');
} finally {
  db.close();
  cleanupDb();
}
