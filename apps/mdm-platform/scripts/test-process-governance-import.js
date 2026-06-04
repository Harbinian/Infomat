const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { importProcessGovernanceSnapshot, parseA1Markdown } = require('./lib/processGovernanceImport');

const fixtureDir = path.join(__dirname, 'fixtures');
const sourceJsonPath = path.join(fixtureDir, 'process-governance-snapshot.json');
const a1MarkdownPath = path.join(fixtureDir, 'process-governance-a1.md');
const extraA1MarkdownPath = path.join(fixtureDir, 'process-governance-a1-extra.tmp.md');

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
  assert.strictEqual(JSON.parse(snapshot.stats_json).a1Imported, 1);

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
  assert.strictEqual(JSON.parse(a1.suggested_systems).join(','), 'OA,ERP');

  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM process_a1_items WHERE snapshot_id=?').get(snapshotId).count, 1);

  const mixedMarkdown = `# 复材车间部门-能力-流程-系统映射关系

## 业务行为（A1）映射（BBM增补）

### FC-L3-03 关键件横向跟踪

| 业务行为（A1）编号 | 业务行为（A1） | 执行角色 | 审批类型 | 输入来源部门 | 输出目标部门 | 应用系统（S1） | 核验提醒 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FC-L3-03-A01 | 识别关键件并建立跟踪记录 | 生产计划员 | 无审批 | 项目管理部 | 质量管理部 | MES、ERP | 核对关键件清单 |

#### 跨部门交易子表

| 来源部门 | 目标部门 | 交互事项 |
| --- | --- | --- |
| 复材车间 | 质量管理部 | 关键件检验 |

##### 业务流程（L3）-0101 销售订单评审和执行管理

| A1编号 | 业务行为 | 执行角色 | 审批类型 | 输入来源部门 | 输出目标部门 | 应用系统 | 核验提醒 |
|---|---|---|---|---|---|---|---|
| JY-L3-01-A1-001 | 接收订单并组织评审 | 合同管理员 | 审批 | 项目管理部 | 工程技术部 | OA / ERP | 核对技术条款输入 |

#### 表单台账子表

| 表单名称 | 责任角色 |
| --- | --- |
| 订单评审表 | 合同管理员 |
`;
  const parsedMixed = parseA1Markdown(mixedMarkdown, path.join(fixtureDir, '复材车间部门-能力-流程-系统映射关系.md'));
  assert.strictEqual(parsedMixed.length, 2);
  assert.deepStrictEqual(parsedMixed.map(row => row.l3_name), ['关键件横向跟踪', '销售订单评审和执行管理']);
  assert.deepStrictEqual(parsedMixed[0].suggested_systems, ['MES', 'ERP']);
  assert.deepStrictEqual(parsedMixed[1].suggested_systems, ['OA', 'ERP']);

  const risk = db.prepare('SELECT * FROM process_cross_dept_interactions WHERE snapshot_id=?').get(snapshotId);
  assert.strictEqual(risk.risk_level, 'high');
  assert.strictEqual(risk.confirm_status, 'not_mapped');

  const chain = db.prepare('SELECT * FROM process_interaction_chains WHERE snapshot_id=?').get(snapshotId);
  assert.strictEqual(chain.name, '订单评审链');
  assert.strictEqual(chain.status, 'partial');
  assert.deepStrictEqual(JSON.parse(chain.breaks_json), ['工程技术部: 技术条款评审节点待补全']);

  fs.writeFileSync(extraA1MarkdownPath, `# 经营发展部部门-能力-流程-系统映射关系

## 业务行为（A1）映射

##### 业务流程（L3）-001 销售订单评审和执行管理

| A1编号 | 业务行为 | 执行角色 | 审批类型 | 输入来源部门 | 输出目标部门 | 应用系统 | 核验提醒 |
|---|---|---|---|---|---|---|---|
| JY-L3-01-A1-001 | 接收订单并组织评审 | 合同管理员 | 审批 | 项目管理部 | 工程技术部 | OA / ERP | 核对技术条款输入 |
| JY-L3-01-A1-002 | 汇总评审意见并反馈 | 合同管理员 | 审批 | 工程技术部 | 项目管理部 | OA | 核对反馈闭环 |
`);
  const extraSnapshotId = importProcessGovernanceSnapshot({
    db,
    sourceJsonPath,
    a1MarkdownPaths: [extraA1MarkdownPath],
    note: 'extra A1 import'
  });
  const extraSnapshot = db.prepare('SELECT * FROM process_governance_snapshots WHERE id=?').get(extraSnapshotId);
  assert.strictEqual(JSON.parse(extraSnapshot.stats_json).a1, 1);
  assert.strictEqual(JSON.parse(extraSnapshot.stats_json).a1Imported, 2);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM process_a1_items WHERE snapshot_id=?').get(extraSnapshotId).count, 2);

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
  if (fs.existsSync(extraA1MarkdownPath)) fs.unlinkSync(extraA1MarkdownPath);
  cleanupDb();
}
