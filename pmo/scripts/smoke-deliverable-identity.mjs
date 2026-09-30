// 用法: node pmo/scripts/smoke-deliverable-identity.mjs
//
// 校验交付物身份契约：受控行（有正本）与计划投影行彻底分离。
//
// 背景：重构前 normalizeDeliverables() 用 `DLV-${counter++}` 给每个有 deliverable 文本的
// 任务发号，counter 无条件递增，导致影子编号与正本编号空间重叠（DLV-006/007 正本被静默丢弃、
// DLV-179 被 task 157 顶替）。本测试锁定新契约，防止该缺陷回归。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTasks } from '../gantt-react/src/utils/dateUtils.js';
import {
  parseDeliverableFrontmatter,
  validateDeliverableFrontmatter,
} from '../gantt-react/src/utils/deliverableFrontmatter.js';
import {
  buildDeliverableIndex,
  deliverableRowKey,
} from '../gantt-react/src/utils/deliverableIndex.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const deliverablesDir = path.join(repoRoot, 'pmo', 'deliverables');

const tasks = normalizeTasks(
  JSON.parse(fs.readFileSync(path.join(repoRoot, 'pmo', 'gantt-react', 'public', 'tasks.json'), 'utf8')),
);

// 模拟服务端 scanDeliverables 的返回：文件即契约，与任务数据无关。
const controlled = fs.readdirSync(deliverablesDir)
  .filter(name => /^DLV-\d{3}-.*\.md$/u.test(name))
  .sort()
  .map(name => {
    const raw = fs.readFileSync(path.join(deliverablesDir, name), 'utf8');
    const parsed = parseDeliverableFrontmatter(raw);
    validateDeliverableFrontmatter(parsed.frontmatter);
    return {
      fileName: name,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      mtime: 0,
    };
  });

const index = buildDeliverableIndex({ tasks, controlled });

// 1. 投影行不得占用 DLV 命名空间
const leaked = index.projections.filter(row => row.deliverableId);
assert.equal(
  leaked.length,
  0,
  `投影行不得带 deliverableId，违规 ${leaked.length} 条：${leaked.slice(0, 5).map(r => `${r.projectionKey}=${r.deliverableId}`).join(', ')}`,
);

// 2. 投影行键形如 task:<数字>，且标记为投影
for (const row of index.projections) {
  assert.equal(row.recordKind, 'projection');
  assert.match(row.projectionKey, /^task:\d+$/u, `投影行键非法: ${row.projectionKey}`);
  assert.equal(row.action, null, '投影行不可发布行动项');
}

// 3. 受控行恰好等于正本集合
assert.deepEqual(
  index.controlled.map(row => row.deliverableId).sort(),
  controlled.map(record => record.frontmatter.deliverableId).sort(),
  '受控行必须与正本文件一一对应',
);

// 4. 三份曾被吞掉/顶替的正本必须出现且名称正确
const byId = new Map(index.controlled.map(row => [row.deliverableId, row]));
assert.equal(byId.get('DLV-006')?.deliverableName, '信息化的第一步——制造信息', 'DLV-006 正本不得再被丢弃');
assert.equal(byId.get('DLV-006')?.canonicalFileName, 'DLV-006-首次周例会会议材料.md');
assert.equal(byId.get('DLV-007')?.deliverableName, '昌兴复材数字化底座项目任务权重激励方案', 'DLV-007 正本不得再被丢弃');
assert.equal(byId.get('DLV-007')?.canonicalFileName, 'DLV-007-信息化项目任务权重激励方案.md');
assert.equal(byId.get('DLV-179')?.deliverableName, 'AI辅助治理文档规范', 'DLV-179 不得再被内容无关的任务顶替');

// 5. 原占位者回到候选池
const occupied = index.projections.find(row => row.projectionKey === 'task:157');
assert.ok(occupied, 'task:157 应作为投影行存在');
assert.equal(occupied.candidateName, '主数据标准V1.0');
assert.equal(occupied.deliverableStatus, '未纳管');

// 6. 显式锚点绑定稳定
assert.equal(byId.get('DLV-901')?.taskId, 469);
assert.equal(byId.get('DLV-901')?.bindingSource, 'task-field');
assert.equal(byId.get('DLV-901')?.normalizedWbs, '1.2.1.2');

// 7. 行键唯一
const keys = index.allRows.map(deliverableRowKey);
assert.equal(new Set(keys).size, keys.length, '行键必须唯一');

// 8. 健康度可见
assert.ok(Array.isArray(index.issues));
assert.ok(index.health && typeof index.health.error === 'number');

console.log('✓ 交付物身份契约检查通过');
console.log(`  受控行 ${index.controlled.length} / 投影行 ${index.projections.length} / 合计 ${index.allRows.length}`);
console.log(`  议题 error:${index.health.error} warn:${index.health.warn} info:${index.health.info}`);
