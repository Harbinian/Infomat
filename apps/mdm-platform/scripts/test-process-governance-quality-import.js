const assert = require('assert');
const path = require('path');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { importProcessGovernanceSnapshot } = require('./lib/processGovernanceImport');

const fixtureDir = path.join(__dirname, 'fixtures');
const sourceJsonPath = path.join(fixtureDir, 'process-governance-snapshot.json');
const a1MarkdownPath = path.join(fixtureDir, 'process-governance-a1.md');

const qualityFindings = [
  {
    severity: 'BLOCK',
    area: 'ORG',
    file: 'docs/organization/组织架构和部门职责.md',
    line: 1,
    message: '组织真源文件必须统一为当前实际文件名',
    suggestion: '规则文件引用 docs/organization/组织架构和部门职责.md。'
  },
  {
    severity: 'WARN',
    area: 'BBM',
    file: 'docs/norms/经营发展部部门-能力-流程-系统映射关系.md',
    line: 42,
    message: 'A1 行需要补充核验提醒',
    suggestion: '回到经营发展部映射文档补充核验提醒。'
  }
];

try {
  const snapshotId = importProcessGovernanceSnapshot({
    db,
    sourceJsonPath,
    a1MarkdownPaths: [a1MarkdownPath],
    qualityFindings: [...qualityFindings, qualityFindings[1]],
    note: 'quality import test'
  });

  const rows = db.prepare(`
    SELECT severity, area, source_file, source_line, message, suggestion, dept_name, finding_key
    FROM process_governance_quality_findings
    WHERE snapshot_id=?
    ORDER BY severity, area
  `).all(snapshotId);

  assert.strictEqual(rows.length, 2, 'duplicate quality findings should be ignored within one snapshot');
  assert.deepStrictEqual(rows.map(row => row.severity).sort(), ['BLOCK', 'WARN']);
  assert.strictEqual(rows.find(row => row.area === 'BBM').dept_name, '经营发展部');
  assert.strictEqual(rows.find(row => row.area === 'ORG').dept_name, null);
  assert.ok(rows.every(row => row.finding_key && row.finding_key.length >= 16), 'finding keys should be stable hashes');

  const secondSnapshotId = importProcessGovernanceSnapshot({
    db,
    sourceJsonPath,
    a1MarkdownPaths: [a1MarkdownPath],
    qualityFindings: [qualityFindings[1]],
    note: 'second quality import test'
  });

  assert.notStrictEqual(secondSnapshotId, snapshotId);
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM process_governance_quality_findings WHERE snapshot_id=?').get(snapshotId).count,
    2,
    'archived snapshots should keep their own imported findings'
  );
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM process_governance_quality_findings WHERE snapshot_id=?').get(secondSnapshotId).count,
    1,
    'each active snapshot should receive its own quality findings'
  );

  console.log('Process governance quality import test passed');
} finally {
  db.close();
  cleanupDb();
}
