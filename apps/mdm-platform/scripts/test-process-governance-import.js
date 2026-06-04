const assert = require('assert');
const path = require('path');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { importProcessGovernanceSnapshot } = require('./lib/processGovernanceImport');

const fixtureDir = path.join(__dirname, 'fixtures');
const sourceJsonPath = path.join(fixtureDir, 'process-governance-snapshot.json');
const a1MarkdownPath = path.join(fixtureDir, 'process-governance-a1.md');

try {
  const snapshotId = importProcessGovernanceSnapshot({
    db,
    sourceJsonPath,
    a1MarkdownPaths: [a1MarkdownPath],
    importedBy: null,
    note: 'test import'
  });

  const snapshot = db.prepare('SELECT * FROM process_governance_snapshots WHERE id=?').get(snapshotId);
  assert.strictEqual(snapshot.status, 'active');
  assert.ok(snapshot.source_hash.length >= 32);
  assert.strictEqual(JSON.parse(snapshot.stats_json).mappings, 1);

  const nodeCounts = db.prepare(`
    SELECT node_type, COUNT(*) AS count
    FROM process_governance_nodes
    WHERE snapshot_id=?
    GROUP BY node_type
  `).all(snapshotId).reduce((acc, row) => {
    acc[row.node_type] = row.count;
    return acc;
  }, {});
  assert.deepStrictEqual(nodeCounts, {
    root: 1,
    domain: 1,
    department: 1,
    l2: 1,
    l3: 1,
    a1: 1,
    system: 2
  });

  const a1 = db.prepare('SELECT * FROM process_a1_items WHERE snapshot_id=? AND a1_code=?').get(snapshotId, 'JY-L3-01-A1-001');
  assert.strictEqual(a1.dept_name, '经营发展部');
  assert.strictEqual(a1.output_target_dept, '工程技术部');
  assert.strictEqual(a1.suggested_systems, 'OA,ERP');

  const risk = db.prepare('SELECT * FROM process_cross_dept_interactions WHERE snapshot_id=?').get(snapshotId);
  assert.strictEqual(risk.risk_level, 'high');
  assert.strictEqual(risk.confirm_status, 'not_mapped');

  const chain = db.prepare('SELECT * FROM process_interaction_chains WHERE snapshot_id=?').get(snapshotId);
  assert.strictEqual(chain.name, '订单评审链');
  assert.strictEqual(chain.status, 'partial');
  assert.deepStrictEqual(JSON.parse(chain.breaks_json), ['工程技术部: 技术条款评审节点待补全']);

  const secondSnapshotId = importProcessGovernanceSnapshot({
    db,
    sourceJsonPath,
    a1MarkdownPaths: [a1MarkdownPath]
  });
  assert.notStrictEqual(secondSnapshotId, snapshotId);
  assert.strictEqual(db.prepare('SELECT status FROM process_governance_snapshots WHERE id=?').get(snapshotId).status, 'archived');
  assert.strictEqual(db.prepare('SELECT status FROM process_governance_snapshots WHERE id=?').get(secondSnapshotId).status, 'active');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM process_governance_snapshots WHERE status='active'").get().count, 1);

  console.log('Process governance import test passed');
} finally {
  db.close();
  cleanupDb();
}
