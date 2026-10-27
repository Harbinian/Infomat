import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { qualityEntryNotice, roleSubjectName } from '../src/rolePresentation.js';

const require = createRequire(import.meta.url);
const { getAccessModel } = require('../../server/roleDefinitions.js');

test('every recorded responsibility subject has a business name without changing role or participant records', () => {
  const model = getAccessModel(), before = structuredClone(model);
  const subjects = new Set(model.activities.flatMap(activity =>
    ['responsible', 'accountable', 'consulted', 'informed'].flatMap(key => activity[key] || [])));
  for (const subject of subjects) {
    const name = roleSubjectName(subject, model.roles);
    assert.notEqual(name, '参与主体名称未记录', subject);
    assert.match(name, /[\u4e00-\u9fff]/, subject);
    assert.ok(!name.includes(subject), subject);
  }
  assert.equal(roleSubjectName('account_holder', model.roles), '账号本人');
  assert.equal(roleSubjectName('department_final_responsible_person', model.roles), '本部门最终负责人');
  assert.notEqual(roleSubjectName('origin_department_final_responsible_person', model.roles),
    roleSubjectName('counterparty_department_final_responsible_person', model.roles));
  assert.deepEqual(model, before);
});

test('an unknown participant remains an explicit gap without exposing the supplied identifier or guessing a person', () => {
  for (const subject of ['SYNTHETIC_INTERNAL_SUBJECT_900', 'toString', '__proto__', '', null]) {
    assert.equal(roleSubjectName(subject), '参与主体名称未记录');
  }
});

test('quality entry promises the available statistics read while keeping the audit role goal and permission boundary', () => {
  const role = getAccessModel().roles.find(item => item.code === 'data_quality_auditor');
  assert.equal(role.goal, '识别数据完整性、准确性和一致性问题，并跟踪整改证据。');
  assert.deepEqual(role.permissions, ['governance:read-global', 'governance:quality-audit']);
  assert.equal(role.firstEntry.target, '#/quality');
  assert.match(role.firstEntry.label, /字段治理统计/);
  assert.match(role.workflow[0], /查阅字段治理统计/);
  assert.match(role.sample, /刷新字段统计/);
  assert.match(role.sample, /本页尚未提供审计发现登记、整改要求记录或整改复核办理/);
  assert.match(role.doneCriteria, /不能据此认定审计已完成/);
  assert.match(qualityEntryNotice, /只供查阅/);
  assert.match(qualityEntryNotice, /刷新统计不表示已完成审计/);
});
