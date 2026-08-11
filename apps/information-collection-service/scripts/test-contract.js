'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CREATE_STATEMENTS, REQUIRED_IDENTITY_COLUMNS } = require('../server/schema');
const { FIELD_TYPES, SCHEMA_VERSION, digestSchema, validateAnswers, validateFormSchema } = require('../server/validation');
const { aggregateStatistics, taskStatus } = require('../server/service');
const { buildWorkbook } = require('../server/export');

function sampleSchema() {
  return {
    schemaVersion: SCHEMA_VERSION,
    title: '项目基础信息',
    description: '测试表单',
    sections: [{
      sectionKey: '11111111-1111-4111-8111-111111111111',
      title: '基本信息',
      description: '',
      fields: [
        { fieldKey: '22222222-2222-4222-8222-222222222222', type: 'short_text', label: '项目名称', required: true, options: [], validation: { minLength: 2, maxLength: 100 } },
        { fieldKey: '33333333-3333-4333-8333-333333333333', type: 'single_choice', label: '状态', required: true, options: [
          { optionKey: '44444444-4444-4444-8444-444444444444', label: '进行中' },
          { optionKey: '55555555-5555-4555-8555-555555555555', label: '已完成' }
        ], validation: {} }
      ]
    }]
  };
}

function testValidation() {
  const checked = validateFormSchema(sampleSchema(), { publish: true });
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.schema.schemaVersion, SCHEMA_VERSION);
  assert.equal(FIELD_TYPES.has('attachment'), true);
  const draft = validateAnswers(checked.schema, {}, { submit: false });
  assert.deepEqual(draft.errors, []);
  const incomplete = validateAnswers(checked.schema, {}, { submit: true });
  assert.equal(incomplete.errors.length, 2);
  const answers = {
    '22222222-2222-4222-8222-222222222222': '信息化项目',
    '33333333-3333-4333-8333-333333333333': '44444444-4444-4444-8444-444444444444'
  };
  assert.deepEqual(validateAnswers(checked.schema, answers, { submit: true }).errors, []);
  assert.equal(digestSchema(checked.schema), digestSchema(JSON.parse(JSON.stringify(checked.schema))));
}

function testStatisticsAndStatus() {
  const schema = validateFormSchema(sampleSchema()).schema;
  const statistics = aggregateStatistics(schema, [{
    '22222222-2222-4222-8222-222222222222': 'A',
    '33333333-3333-4333-8333-333333333333': '44444444-4444-4444-8444-444444444444'
  }]);
  assert.equal(statistics[1].counts['进行中'], 1);
  assert.equal(taskStatus({ status: 'scheduled', open_at: new Date(Date.now() - 1000), due_at: null }), 'open');
  assert.equal(taskStatus({ status: 'open', open_at: new Date(Date.now() - 1000), due_at: new Date(Date.now() - 1) }), 'closed');
  assert.equal(taskStatus({ status: 'cancelled', open_at: new Date(), due_at: null }), 'cancelled');
}

function testSchemaBoundary() {
  const tableNames = CREATE_STATEMENTS.map(statement => statement.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i)[1]);
  assert.equal(tableNames.length, 11);
  assert.equal(new Set(tableNames).size, tableNames.length);
  assert.ok(tableNames.every(name => name.startsWith('collection_')));
  assert.deepEqual(Object.keys(REQUIRED_IDENTITY_COLUMNS).sort(), ['departments', 'person', 'user_accounts']);
  const combined = CREATE_STATEMENTS.join('\n');
  assert.ok(!/\bDELETE\s+FROM\b/i.test(combined));
  assert.ok(combined.includes('ON DELETE RESTRICT'));
}

function testStaticContracts() {
  const root = path.resolve(__dirname, '..');
  for (const relative of ['public/admin/index.html', 'public/admin/app.js', 'public/respondent/index.html', 'public/respondent/app.js']) {
    assert.ok(fs.existsSync(path.join(root, relative)), `${relative} must exist`);
  }
  const admin = fs.readFileSync(path.join(root, 'public/admin/index.html'), 'utf8');
  const respondent = fs.readFileSync(path.join(root, 'public/respondent/index.html'), 'utf8');
  assert.ok(admin.includes('字段列表'));
  assert.ok(admin.includes('上下移动'));
  assert.ok(respondent.includes('我的填报任务'));
  assert.ok(!/localStorage|sessionStorage/.test(fs.readFileSync(path.join(root, 'public/respondent/app.js'), 'utf8')));
  for (const relative of ['README.md', 'AGENTS.md', 'docs/PRD.md', 'docs/Tech-Spec.md', 'docs/API-Contract.md', 'docs/DB-Schema.md', 'docs/Permission-Matrix.md', 'docs/Deployment-Runbook.md']) {
    assert.ok(fs.existsSync(path.join(root, relative)), `${relative} must exist`);
  }
  const auth = fs.readFileSync(path.join(root, 'server/auth.js'), 'utf8');
  assert.ok(auth.includes('infomat_collection_admin_sid'));
  assert.ok(auth.includes('infomat_collection_respondent_sid'));
  assert.ok(auth.includes('session_auth_version'));
  const service = fs.readFileSync(path.join(root, 'server/service.js'), 'utf8');
  assert.ok(service.includes('canonicalizeEntityAnswers'));
  assert.ok(service.includes('REVISION_CONFLICT'));
  assert.ok(service.includes('task.auto_close'));
  const repoRoot = path.resolve(root, '..', '..');
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  for (const command of ['start:information-collection', 'smoke:information-collection', 'test:information-collection', 'migrate:information-collection:dry-run', 'migrate:information-collection:apply', 'check:information-collection-schema']) {
    assert.ok(rootPackage.scripts[command], `root command ${command} must exist`);
  }
  const fixedConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/information-collection.config.json'), 'utf8'));
  assert.equal(fixedConfig.admin.port, 4000);
  assert.equal(fixedConfig.respondent.port, 4001);
}

async function testWorkbook() {
  const schema = validateFormSchema(sampleSchema()).schema;
  const workbook = await buildWorkbook({
    task: { task_code: 'COL-T-TEST', name: '测试任务', form_name: '项目基础信息', owner_department_name: '工程技术部', open_at: new Date(), due_at: null },
    schema,
    rows: [{ person_id: 1, employee_no_snapshot: 'T001', person_name_snapshot: '测试人员', department_name_snapshot: '工程技术部', submission_status: 'submitted', answers_json: JSON.stringify({
      '22222222-2222-4222-8222-222222222222': '信息化项目',
      '33333333-3333-4333-8333-333333333333': '44444444-4444-4444-8444-444444444444'
    }), last_saved_at: new Date(), submitted_at: new Date() }],
    files: []
  });
  const buffer = await workbook.xlsx.writeBuffer();
  assert.ok(buffer.length > 1000);
  assert.equal(workbook.getWorksheet('答卷明细').rowCount, 2);
}

async function main() {
  testValidation();
  testStatisticsAndStatus();
  testSchemaBoundary();
  testStaticContracts();
  await testWorkbook();
  console.log('INFORMATION_COLLECTION_CONTRACT_PASS');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
