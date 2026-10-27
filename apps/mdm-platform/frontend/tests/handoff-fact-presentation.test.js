import test from 'node:test';
import assert from 'node:assert/strict';
import {factDepartmentName, factTypeName} from '../src/handoffFactPresentation.js';

test('fact department resolves exact references without borrowing a question, another department or a numeric identifier', () => {
  const fact = {target_department_id: '9007199254740993', question_text: '合成乙部应如何答复？'};
  const before = structuredClone(fact);
  assert.equal(factDepartmentName(fact), '部门名称未记录');
  assert.equal(factDepartmentName(fact, {user: {departmentId: '9007199254740992', departmentName: '合成乙部'}}), '部门名称未记录');
  assert.equal(factDepartmentName(fact, {user: {departmentId: '9007199254740993', departmentName: '合成甲部'}}), '合成甲部');
  assert.equal(factDepartmentName(fact, {departments: [{id: '9007199254740993', name: '合成甲部'}]}), '合成甲部');
  assert.equal(factDepartmentName({...fact, target_department_name: '已记录的合成部门'}), '已记录的合成部门');
  assert.equal(factDepartmentName({question_text: '合成甲部'}), '部门名称未记录');
  assert.deepEqual(fact, before);
});

test('fact type translates known machine values, preserves readable history and conceals unrecognized transport values', () => {
  assert.equal(factTypeName('business_meaning'), '业务含义');
  assert.equal(factTypeName('source_evidence'), '来源依据');
  assert.equal(factTypeName('历史填写的业务问题'), '历史填写的业务问题');
  assert.equal(factTypeName('unknown_legacy_code'), '事实类型待核对');
  assert.equal(factTypeName('核对 /api/private'), '事实类型待核对');
  assert.equal(factTypeName(null), '事实类型未记录');
});
