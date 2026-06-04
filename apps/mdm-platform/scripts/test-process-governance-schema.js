const assert = require('assert');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');

function tableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map(row => row.name);
}

try {
  [
    'process_governance_snapshots',
    'process_governance_nodes',
    'process_governance_edges',
    'process_a1_items',
    'process_cross_dept_interactions',
    'process_interaction_chains',
  ].forEach(tableName => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    assert.ok(row, `${tableName} should exist`);
  });

  assert.ok(tableColumns('process_governance_snapshots').includes('source_hash'));
  assert.ok(tableColumns('process_governance_nodes').includes('node_type'));
  assert.ok(tableColumns('process_governance_edges').includes('edge_type'));
  assert.ok(tableColumns('process_a1_items').includes('a1_code'));
  assert.ok(tableColumns('process_cross_dept_interactions').includes('confirm_status'));
  assert.ok(tableColumns('process_interaction_chains').includes('breaks_json'));
  assert.ok(tableColumns('field_entries').includes('process_governance_node_key'));
  assert.ok(tableColumns('field_entries').includes('process_governance_a1_code'));

  console.log('Process governance schema test passed');
} finally {
  db.close();
  cleanupDb();
}
