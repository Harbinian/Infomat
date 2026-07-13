import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-action-personnel-'));
const outputPath = path.join(tmpDir, 'personnel-snapshot.json');
const mappingForTestPath = path.join(tmpDir, 'personnel-role-mapping.md');

const scriptPath = path.join(repoRoot, 'scripts', 'generate-weekly-action-personnel-snapshot.mjs');
const mappingPath = path.join(repoRoot, 'docs', 'organization', '信息化项目人员角色映射.md');
const rosterPath = path.join(repoRoot, 'docs', 'organization', '花名册.md');

try {
  const pendingRosterFixture = [
    '',
    '## 测试夹具：花名册待补人员',
    '',
    '| 工号 | 姓名 | 花名册部门 | 花名册职务 | 项目组织 | 项目角色 | 任命状态 | 来源材料 | 来源位置 | 来源可信度 | 人员匹配状态 | 是否待确认 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    '| 待花名册确认 | 测试待补人员 | 待花名册确认 | 待花名册确认 | 信息化项目管理工作室 | 待补责任人 | 待确认 | contract fixture | personnel snapshot contract test | 待确认：需补花名册或正式任命 | 花名册待补 | 是：花名册待补 |'
  ].join('\n');
  fs.writeFileSync(mappingForTestPath, `${fs.readFileSync(mappingPath, 'utf8')}\n${pendingRosterFixture}\n`, 'utf8');

  execFileSync(process.execPath, [
    scriptPath,
    '--mapping', mappingForTestPath,
    '--roster', rosterPath,
    '--out', outputPath,
    '--generated-by', 'contract-test'
  ], { stdio: 'pipe' });

  const snapshot = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

  assert.equal(snapshot.schemaVersion, 1);
  assert.ok(snapshot.snapshotId.startsWith('PERSONNEL-'));
  assert.equal(snapshot.generatedBy, 'contract-test');
  assert.ok(snapshot.sourceHash.length >= 16);
  assert.ok(snapshot.rowCount > 0);
  assert.ok(Array.isArray(snapshot.people));
  assert.ok(Array.isArray(snapshot.personRoles));
  assert.ok(snapshot.personRoles.some(role => role.name === '刘春含'));
  const pendingRosterRole = snapshot.personRoles.find(role => role.name === '测试待补人员');
  assert.ok(pendingRosterRole);
  assert.equal(pendingRosterRole.personnelMatchStatus, '花名册待补');
  assert.ok(pendingRosterRole.usageRestrictions.some(restriction => restriction.includes('不能作为默认主业务责任人')));
  assert.ok(snapshot.warnings.some(warning => warning.code === 'ROSTER_PENDING'));

  const duplicateKeys = snapshot.personRoles
    .map(role => role.personRoleKey)
    .filter((key, index, all) => all.indexOf(key) !== index);
  assert.deepEqual(duplicateKeys, []);

  const liuChunhan = snapshot.personRoles.find(role => role.name === '刘春含' && role.projectOrganization === '信息化项目管理工作室');
  assert.equal(liuChunhan.rosterDepartment, '经营发展部');
  assert.equal(liuChunhan.rosterPosition, '规划员');

  console.log('weekly action personnel snapshot checks passed');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
