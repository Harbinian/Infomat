#!/usr/bin/env node

/**
 * Read-only contract test for the HR work-role truth, generated snapshot, and
 * document-structured-output-v2 work_role_bindings extension.
 *
 * Temporary fixture output is written only to the operating-system temp
 * directory. No repository truth source or generated snapshot is modified.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRoleData,
  computeSourceHash,
  parseRoster,
  parseWorkRoleSource,
} from './build-work-role-data.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = resolve(REPO_ROOT, 'docs/contracts/document-structured-output.schema.json');
const SCHEMA_DOC_PATH = resolve(REPO_ROOT, 'docs/contracts/document-structured-output-schema.md');
const WORK_ROLE_SOURCE_PATH = resolve(REPO_ROOT, 'docs/organization/工作角色目录与岗位映射.md');
const ORGANIZATION_README_PATH = resolve(REPO_ROOT, 'docs/organization/README.md');
const ROSTER_PATH = resolve(REPO_ROOT, 'docs/organization/花名册.md');
const SNAPSHOT_PATH = resolve(REPO_ROOT, 'docs/work-role-data.json');
const SCRIPTS_README_PATH = resolve(REPO_ROOT, 'scripts/README.md');
const PACKAGE_PATH = resolve(REPO_ROOT, 'package.json');

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const schemaDoc = readFileSync(SCHEMA_DOC_PATH, 'utf8');
const workRoleSource = readFileSync(WORK_ROLE_SOURCE_PATH, 'utf8');
const rosterSource = readFileSync(ROSTER_PATH, 'utf8');
const organizationReadme = readFileSync(ORGANIZATION_README_PATH, 'utf8');
const scriptsReadme = readFileSync(SCRIPTS_README_PATH, 'utf8');
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

function findConditional(definition, predicate) {
  return definition.allOf.find(rule => rule.if && predicate(rule.if.properties || {}));
}

function validateBindingCollection(bindings, { projection = false } = {}) {
  const refs = new Set();
  const confirmedOwners = new Set();
  for (const binding of bindings) {
    if (refs.has(binding.binding_ref)) throw new Error(`duplicate binding_ref: ${binding.binding_ref}`);
    refs.add(binding.binding_ref);

    if (binding.step_ref === null && binding.participation_type !== 'owner') {
      throw new Error('L3 binding must use owner');
    }
    if (binding.step_ref !== null && binding.participation_type === 'owner') {
      throw new Error('A1 binding must not use owner');
    }
    if (binding.status === 'confirmed') {
      if (!/^WR-[0-9]{4}$/.test(String(binding.work_role_code || ''))) {
        throw new Error('confirmed binding needs formal work_role_code');
      }
      if (!String(binding.confirmation_basis || '').trim()) throw new Error('confirmed binding needs confirmation_basis');
      if (!Array.isArray(binding.evidence_refs) || binding.evidence_refs.length === 0) {
        throw new Error('confirmed binding needs evidence_refs');
      }
    }
    if (!String(binding.source_position_name || '').trim() && !/^WR-[0-9]{4}$/.test(String(binding.work_role_code || ''))) {
      throw new Error('binding needs source_position_name or formal work_role_code');
    }
    if (projection && binding.status !== 'confirmed') throw new Error('projection accepts confirmed bindings only');

    if (binding.status === 'confirmed' && binding.step_ref === null) {
      const processKey = String(binding.process_ref);
      if (confirmedOwners.has(processKey)) throw new Error(`multiple confirmed owners for process_ref: ${processKey}`);
      confirmedOwners.add(processKey);
    }
  }
}

assert.equal(schema.properties.schema_version.const, 'document-structured-output-v2');
assert.ok(!schema.required.includes('work_role_bindings'), 'v2 work_role_bindings must remain optional');
assert.equal(schema.properties.work_role_bindings.items.$ref, '#/$defs/workRoleBinding');
assert.deepEqual(schema.properties.work_role_bindings.default, []);

const bindingDef = schema.$defs.workRoleBinding;
assert.ok(bindingDef, 'schema must define workRoleBinding');
assert.equal(bindingDef.additionalProperties, false);
assert.deepEqual(bindingDef.required, [
  'binding_ref',
  'process_ref',
  'step_ref',
  'participant_department',
  'source_role_text',
  'work_role_code',
  'participation_type',
  'status',
  'evidence_refs',
  'confirmation_basis',
]);
assert.equal(bindingDef.properties.participant_department.$ref, '#/$defs/department');
assert.equal(bindingDef.properties.source_role_text.type, 'string');
assert.equal(bindingDef.properties.source_role_text.minLength, 1);
assert.equal(bindingDef.properties.source_position_name.$ref, '#/$defs/nullableString');
assert.equal(bindingDef.properties.work_role_code.anyOf[0].pattern, '^WR-[0-9]{4}$');
assert.equal(bindingDef.properties.work_role_code.anyOf[1].type, 'null');
assert.deepEqual(bindingDef.properties.participation_type.enum, [
  'owner',
  'initiator',
  'executor',
  'reviewer',
  'approver',
  'collaborator',
  'provider',
  'receiver',
]);
assert.deepEqual(bindingDef.properties.status.enum, ['proposed', 'confirmed']);

const l3Rule = findConditional(bindingDef, properties => properties.step_ref?.type === 'null');
assert.equal(l3Rule.then.properties.participation_type.const, 'owner');
const a1Rule = findConditional(bindingDef, properties => properties.step_ref?.not?.type === 'null');
assert.equal(a1Rule.then.properties.participation_type.not.const, 'owner');
const confirmedRule = findConditional(bindingDef, properties => properties.status?.const === 'confirmed');
assert.equal(confirmedRule.then.properties.work_role_code.pattern, '^WR-[0-9]{4}$');
assert.equal(confirmedRule.then.properties.confirmation_basis.type, 'string');
assert.equal(confirmedRule.then.properties.confirmation_basis.minLength, 1);
assert.equal(confirmedRule.then.properties.evidence_refs.minItems, 1);

const projection = schema.$defs.structureBlockProjection;
assert.ok(!projection.required.includes('work_role_bindings'), 'projection work_role_bindings must remain optional');
assert.equal(projection.properties.work_role_bindings.items.$ref, '#/$defs/confirmedWorkRoleBinding');
assert.equal(schema.$defs.confirmedWorkRoleBinding.allOf[1].properties.status.const, 'confirmed');
assert.equal(schema.$defs.evidence.properties.source_excerpt.$ref, '#/$defs/nullableString');
assert.ok(schema.$defs.evidenceObjectType.enum.includes('work_role_binding'));
assert.ok(schema.$defs.pendingIssue.properties.target_block.enum.includes('work_role_bindings'));

const confirmedOwner = {
  binding_ref: 'BIND-L3',
  process_ref: 'PROC-1',
  step_ref: null,
  participant_department: { department_name: '行政人事部' },
  source_role_text: '流程负责人',
  work_role_code: 'WR-0001',
  participation_type: 'owner',
  status: 'confirmed',
  evidence_refs: ['EV-1'],
  confirmation_basis: 'fixture confirmation',
};
const proposedExecutor = {
  ...confirmedOwner,
  binding_ref: 'BIND-A1',
  step_ref: 'STEP-1',
  participation_type: 'executor',
  status: 'proposed',
  evidence_refs: ['EV-2'],
  confirmation_basis: null,
};
const proposedPositionExecutor = {
  ...proposedExecutor,
  binding_ref: 'BIND-A1-POSITION',
  source_position_name: '会计员',
  work_role_code: null,
};
validateBindingCollection([confirmedOwner, proposedExecutor, proposedPositionExecutor]);
assert.throws(() => validateBindingCollection([confirmedOwner, { ...confirmedOwner }]), /duplicate binding_ref/);
assert.throws(
  () => validateBindingCollection([confirmedOwner, { ...confirmedOwner, binding_ref: 'BIND-L3-2' }]),
  /multiple confirmed owners/,
);
assert.throws(() => validateBindingCollection([{ ...confirmedOwner, participation_type: 'executor' }]), /L3 binding/);
assert.throws(() => validateBindingCollection([{ ...proposedExecutor, participation_type: 'owner' }]), /A1 binding/);
assert.throws(() => validateBindingCollection([{ ...confirmedOwner, evidence_refs: [] }]), /needs evidence_refs/);
assert.throws(() => validateBindingCollection([{ ...proposedPositionExecutor, status: 'confirmed' }]), /formal work_role_code/);
assert.throws(() => validateBindingCollection([{ ...proposedPositionExecutor, source_position_name: null }]), /source_position_name or formal work_role_code/);
assert.throws(() => validateBindingCollection([proposedExecutor], { projection: true }), /confirmed bindings only/);

const parsedCanonical = parseWorkRoleSource(workRoleSource, parseRoster(rosterSource));
assert.deepEqual(parsedCanonical.workRoles, [], 'formal HR work-role directory must start empty');
assert.deepEqual(parsedCanonical.workRolePositionMappings, [], 'formal position mappings must start empty');
assert.deepEqual(parsedCanonical.workRoleAliases, [], 'formal role aliases must start empty');

assert.deepEqual(Object.keys(snapshot), [
  'schemaVersion',
  'generatedAt',
  'sourceHash',
  'workRoles',
  'workRolePositionMappings',
  'workRoleAliases',
]);
assert.equal(snapshot.schemaVersion, 'work-role-data-v1');
assert.ok(!Number.isNaN(Date.parse(snapshot.generatedAt)), 'snapshot generatedAt must be ISO-compatible');
assert.match(snapshot.sourceHash, /^[a-f0-9]{64}$/);
assert.equal(snapshot.sourceHash, computeSourceHash(workRoleSource, rosterSource));
assert.deepEqual(snapshot.workRoles, []);
assert.deepEqual(snapshot.workRolePositionMappings, []);
assert.deepEqual(snapshot.workRoleAliases, []);

assert.equal(packageJson.scripts['build:work-role-data'], 'node scripts/build-work-role-data.mjs');
assert.equal(packageJson.scripts['test:work-role-contract'], 'node scripts/test-work-role-contract.mjs');
for (const content of [schemaDoc, organizationReadme, scriptsReadme]) {
  assert.ok(content.includes('work-role'), 'documentation must include the work-role commands or snapshot path');
}

const fixtureRoot = mkdtempSync(join(tmpdir(), 'infomat-work-role-contract-'));
try {
  const fixtureRosterPath = join(fixtureRoot, 'roster.md');
  const fixtureSourcePath = join(fixtureRoot, 'work-roles.md');
  const fixtureOutputPath = join(fixtureRoot, 'snapshot.json');
  const fixtureRoster = [
    '# Roster',
    '',
    '| 姓名 | 部门 | 职务 |',
    '|---|---|---|',
    '| 测试人员 | 测试部门 | 测试岗位 |',
    '',
  ].join('\n');
  const fixtureSource = [
    '# Work roles',
    '',
    '## 正式工作角色目录',
    '',
    '| 工作角色编码 | 工作角色名称 | 定义 | status | 生效开始日期 | 生效结束日期 | 制定依据 |',
    '|---|---|---|---|---|---|---|',
    '| WR-0001 | 测试工作角色 | 测试定义 | active | 2026-07-16 | | 测试制定依据 |',
    '',
    '## 工作角色与岗位映射',
    '',
    '| 工作角色编码 | 部门 | 岗位 | status | 生效开始日期 | 生效结束日期 | 确认依据 |',
    '|---|---|---|---|---|---|---|',
    '| WR-0001 | 测试部门 | 测试岗位 | active | 2026-07-16 | | 测试岗位确认依据 |',
    '',
    '## 原文角色别名',
    '',
    '| 原文角色文本 | 工作角色编码 | 适用部门 | status | 确认依据 |',
    '|---|---|---|---|---|',
    '| 经办人员 | WR-0001 | 测试部门 | active | 测试别名确认依据 |',
    '',
  ].join('\n');
  writeFileSync(fixtureRosterPath, fixtureRoster, 'utf8');
  writeFileSync(fixtureSourcePath, fixtureSource, 'utf8');
  const built = buildWorkRoleData({
    sourcePath: fixtureSourcePath,
    rosterPath: fixtureRosterPath,
    outputPath: fixtureOutputPath,
    generatedAt: '2026-07-16T00:00:00.000Z',
  });
  assert.deepEqual(built.workRoles, [
    {
      work_role_code: 'WR-0001',
      work_role_name: '测试工作角色',
      definition: '测试定义',
      status: 'active',
      effective_from: '2026-07-16',
      effective_to: null,
      basis: '测试制定依据',
    },
  ]);
  assert.deepEqual(built.workRolePositionMappings, [
    {
      work_role_code: 'WR-0001',
      department_name: '测试部门',
      position_name: '测试岗位',
      status: 'active',
      effective_from: '2026-07-16',
      effective_to: null,
      confirmation_basis: '测试岗位确认依据',
    },
  ]);
  assert.deepEqual(built.workRoleAliases, [
    {
      source_role_text: '经办人员',
      work_role_code: 'WR-0001',
      department_name: '测试部门',
      status: 'active',
      confirmation_basis: '测试别名确认依据',
    },
  ]);

  const manyToManyRoster = fixtureRoster.replace(
    '| 测试人员 | 测试部门 | 测试岗位 |',
    '| 测试人员 | 测试部门 | 测试岗位 |\n| 测试人员2 | 测试部门 | 测试岗位2 |',
  );
  const manyToManySource = fixtureSource
    .replace(
      '| WR-0001 | 测试工作角色 | 测试定义 | active | 2026-07-16 | | 测试制定依据 |',
      '| WR-0001 | 测试工作角色 | 测试定义 | active | 2026-07-16 | | 测试制定依据 |\n| WR-0002 | 测试复核角色 | 复核定义 | active | 2026-07-16 | | 复核制定依据 |',
    )
    .replace(
      '| WR-0001 | 测试部门 | 测试岗位 | active | 2026-07-16 | | 测试岗位确认依据 |',
      '| WR-0001 | 测试部门 | 测试岗位 | active | 2026-07-16 | | 测试岗位确认依据 |\n| WR-0001 | 测试部门 | 测试岗位2 | active | 2026-07-16 | | 第二岗位确认依据 |\n| WR-0002 | 测试部门 | 测试岗位 | active | 2026-07-16 | | 复核角色岗位确认依据 |',
    );
  const manyToMany = parseWorkRoleSource(manyToManySource, parseRoster(manyToManyRoster));
  assert.equal(manyToMany.workRoles.length, 2, 'formal role directory should accept sequential role codes');
  assert.equal(manyToMany.workRolePositionMappings.filter(item => item.work_role_code === 'WR-0001').length, 2, 'one work role should map to multiple roster positions');
  assert.equal(manyToMany.workRolePositionMappings.filter(item => item.position_name === '测试岗位').length, 2, 'one roster position should map to multiple work roles');

  assert.throws(
    () => parseWorkRoleSource(fixtureSource.replaceAll('active', 'inactive'), parseRoster(fixtureRoster)),
    /status must be draft, active, or retired/,
  );
  assert.throws(
    () => parseWorkRoleSource(fixtureSource.replaceAll('WR-0001', 'ROLE-1'), parseRoster(fixtureRoster)),
    /must use WR-0001 format/,
  );
  assert.throws(
    () => parseWorkRoleSource(fixtureSource.replaceAll('WR-0001', 'WR-0002'), parseRoster(fixtureRoster)),
    /must be sequential; expected WR-0001/,
  );
  assert.throws(
    () => parseWorkRoleSource(fixtureSource.replace('active | 2026-07-16', 'retired | 2026-07-16'), parseRoster(fixtureRoster)),
    /retired record requires 生效结束日期/,
  );
  const unmatchedDraft = parseWorkRoleSource(
    fixtureSource.replace('测试岗位 | active | 2026-07-16', '不存在岗位 | draft | 2026-07-16'),
    parseRoster(fixtureRoster),
  );
  assert.equal(unmatchedDraft.workRolePositionMappings[0].status, 'draft');
  assert.equal(unmatchedDraft.workRolePositionMappings[0].position_name, '不存在岗位');

  const sentinel = '{"keep":"existing snapshot"}\n';
  writeFileSync(fixtureOutputPath, sentinel, 'utf8');
  const invalidSource = fixtureSource.replace('测试岗位 | active', '不存在岗位 | active');
  writeFileSync(fixtureSourcePath, invalidSource, 'utf8');
  assert.throws(
    () =>
      buildWorkRoleData({
        sourcePath: fixtureSourcePath,
        rosterPath: fixtureRosterPath,
        outputPath: fixtureOutputPath,
      }),
    /roster has no exact position/,
  );
  assert.equal(readFileSync(fixtureOutputPath, 'utf8'), sentinel, 'failed generation must not overwrite existing output');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('Work-role contract test passed');
