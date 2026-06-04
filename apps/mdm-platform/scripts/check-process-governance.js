const fs = require('fs');
const path = require('path');
const assert = require('assert');
const db = require('../server/db');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const sourceJsonPath = process.argv[2] || path.join(repoRoot, 'docs', 'company-sankey-data.json');

try {
  const source = JSON.parse(fs.readFileSync(sourceJsonPath, 'utf8'));
  const snapshot = db.prepare(`
    SELECT *
    FROM process_governance_snapshots
    WHERE status='active'
    ORDER BY imported_at DESC, id DESC
    LIMIT 1
  `).get();
  assert.ok(snapshot, 'expected latest active process governance snapshot');

  const stats = JSON.parse(snapshot.stats_json || '{}');
  assert.strictEqual(stats.mappings, source.stats && source.stats.mappings);
  assert.strictEqual(stats.a1, source.stats && source.stats.a1);
  assert.strictEqual(stats.crossDept && stats.crossDept.totalChecked, source.crossDept && source.crossDept.stats && source.crossDept.stats.totalChecked);
  assert.strictEqual(stats.crossDept && stats.crossDept.pendingConfirm, source.crossDept && source.crossDept.stats && source.crossDept.stats.pendingConfirm);
  assert.strictEqual(stats.crossDept && stats.crossDept.highRisk, source.crossDept && source.crossDept.stats && source.crossDept.stats.highRisk);

  const a1Count = db.prepare('SELECT COUNT(*) AS count FROM process_a1_items WHERE snapshot_id=?').get(snapshot.id);
  assert.strictEqual(a1Count.count, source.stats && source.stats.a1);

  const invalidRisk = db.prepare(`
    SELECT COUNT(*) AS count
    FROM process_cross_dept_interactions
    WHERE snapshot_id=? AND risk_level NOT IN ('high','medium','low')
  `).get(snapshot.id);
  assert.strictEqual(invalidRisk.count, 0);

  console.log('Process governance snapshot check passed');
} finally {
  db.close();
}
