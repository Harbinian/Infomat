'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CREATE_STATEMENTS, REQUIRED_IDENTITY_COLUMNS } = require('../server/schema');
const { FIELD_TYPES, SCHEMA_VERSION, digestSchema, validateAnswers, validateFormSchema } = require('../server/validation');
const { aggregateStatistics, canonicalizeEntityAnswers, makeService, taskStatus } = require('../server/service');
const { buildWorkbook } = require('../server/export');
const { applyPastedGrid, convertPastedValue, parseClipboardGrid, validatePastedValue } = require('../public/respondent/detail-grid');

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

  const detailSchema = sampleSchema();
  detailSchema.sections.push({
    sectionKey: '66666666-6666-4666-8666-666666666666', title: '设备明细', description: '', kind: 'detail', minRows: 1, maxRows: 10,
    fields: [{ fieldKey: '77777777-7777-4777-8777-777777777777', type: 'short_text', label: '设备名称', required: true, options: [], validation: {} }]
  });
  const detailChecked = validateFormSchema(detailSchema, { publish: true });
  assert.deepEqual(detailChecked.errors, []);
  assert.equal(detailChecked.schema.sections[0].kind, 'main');
  assert.equal(detailChecked.schema.sections[1].kind, 'detail');
  const detailAnswers = {
    '22222222-2222-4222-8222-222222222222': '信息化项目',
    '33333333-3333-4333-8333-333333333333': '44444444-4444-4444-8444-444444444444',
    __detailRows: { '66666666-6666-4666-8666-666666666666': [{ rowKey: '88888888-8888-4888-8888-888888888888', values: { '77777777-7777-4777-8777-777777777777': '工作站' } }] }
  };
  assert.deepEqual(validateAnswers(detailChecked.schema, detailAnswers, { submit: true }).errors, []);
  const missingRows = structuredClone(detailAnswers);
  missingRows.__detailRows['66666666-6666-4666-8666-666666666666'] = [];
  assert.ok(validateAnswers(detailChecked.schema, missingRows, { submit: true }).errors.some(item => item.message.includes('至少需要 1 行')));
  detailSchema.sections[1].fields[0].type = 'attachment';
  assert.ok(validateFormSchema(detailSchema).errors.some(item => item.message === '附件字段只能放在主表中'));
}

function testDetailGridPaste() {
  assert.deepEqual(parseClipboardGrid('设备A\t3\r\n"设备\nB"\t4\r\n'), [['设备A', '3'], ['设备\nB', '4']]);
  assert.deepEqual(convertPastedValue({ type: 'date' }, '2026/8/11'), { value: '2026-08-11' });
  assert.deepEqual(convertPastedValue({ type: 'boolean' }, '否'), { value: false });
  assert.equal(convertPastedValue({ type: 'integer' }, '3.5').error, '需要填写整数');
  assert.equal(validatePastedValue({ type: 'decimal', validation: { max: 10 } }, 11), '数值不能大于 10');
  const section = {
    sectionKey: 'detail', maxRows: 3,
    fields: [
      { fieldKey: 'name', type: 'short_text', label: '设备名称' },
      { fieldKey: 'quantity', type: 'integer', label: '数量' }
    ]
  };
  const applied = applyPastedGrid({ section, rows: [], startRow: 0, startColumn: 0, matrix: parseClipboardGrid('设备A\t3\n设备B\t4'), directory: {}, createRowKey: (() => { let value = 0; return () => `row-${++value}`; })() });
  assert.equal(applied.errors, undefined);
  assert.equal(applied.rows.length, 2);
  assert.deepEqual(applied.rows[1].values, { name: '设备B', quantity: 4 });
  const invalid = applyPastedGrid({ section, rows: applied.rows, startRow: 0, startColumn: 1, matrix: [['3', '越界']], directory: {}, createRowKey: () => 'unused' });
  assert.ok(invalid.errors[0].message.includes('右侧只剩 1 列'));
  assert.deepEqual(applied.rows[0].values, { name: '设备A', quantity: 3 });
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
  for (const relative of ['public/admin/index.html', 'public/admin/app.js', 'public/admin/preview.css', 'public/admin/details.css', 'public/respondent/index.html', 'public/respondent/app.js', 'public/respondent/detail-grid.js', 'public/respondent/details.css']) {
    assert.ok(fs.existsSync(path.join(root, relative)), `${relative} must exist`);
  }
  const admin = fs.readFileSync(path.join(root, 'public/admin/index.html'), 'utf8');
  const adminScript = fs.readFileSync(path.join(root, 'public/admin/app.js'), 'utf8');
  const respondent = fs.readFileSync(path.join(root, 'public/respondent/index.html'), 'utf8');
  assert.ok(admin.includes('字段列表'));
  assert.ok(admin.includes('上下移动'));
  assert.ok(respondent.includes('我的填报任务'));
  assert.ok(respondent.includes('detail-grid.js'));
  assert.ok(adminScript.includes('const createFormElement = event.currentTarget'));
  assert.ok(!adminScript.includes('event.currentTarget.reset()'));
  assert.ok(adminScript.includes('formDirty: false'));
  assert.ok(adminScript.includes('发布前至少新增一个分区和一个字段'));
  assert.ok(adminScript.includes('if (state.formDirty) await saveDraft()'));
  assert.ok(adminScript.includes('submitButton.disabled = true'));
  assert.ok(adminScript.includes('function openPreview()'));
  assert.ok(adminScript.includes('function archiveActiveForm()'));
  assert.ok(adminScript.includes('function deleteActiveForm()'));
  assert.ok(admin.includes('预览表单'));
  assert.ok(admin.includes('归档表单'));
  assert.ok(admin.includes('删除表单'));
  assert.ok(admin.includes('新增主表分区'));
  assert.ok(admin.includes('新增明细表'));
  assert.ok(adminScript.includes("addSection('detail')"));
  const respondentScript = fs.readFileSync(path.join(root, 'public/respondent/app.js'), 'utf8');
  assert.ok(respondentScript.includes('function changeDetailRows(button)'));
  assert.ok(respondentScript.includes('function handleDetailPaste(event)'));
  assert.ok(respondentScript.includes('撤销上次粘贴'));
  assert.ok(respondentScript.includes('function handleRevisionConflict(taskId)'));
  assert.ok(respondentScript.includes('function useServerVersion()'));
  assert.ok(respondentScript.includes('async function keepLocalVersion()'));
  assert.ok(respondentScript.includes('请先处理当前答卷的版本冲突'));
  assert.ok(respondentScript.includes('__detailRows'));
  assert.ok(respondentScript.includes('while (state.saveQueued)'));
  assert.ok(!/localStorage|sessionStorage/.test(fs.readFileSync(path.join(root, 'public/respondent/app.js'), 'utf8')));
  for (const relative of ['README.md', 'AGENTS.md', 'docs/PRD.md', 'docs/Tech-Spec.md', 'docs/API-Contract.md', 'docs/DB-Schema.md', 'docs/Permission-Matrix.md', 'docs/Deployment-Runbook.md']) {
    assert.ok(fs.existsSync(path.join(root, relative)), `${relative} must exist`);
  }
  const auth = fs.readFileSync(path.join(root, 'server/auth.js'), 'utf8');
  assert.ok(auth.includes('infomat_collection_admin_sid'));
  assert.ok(auth.includes('infomat_collection_respondent_sid'));
  assert.ok(auth.includes('session_auth_version'));
  const appSource = fs.readFileSync(path.join(root, 'server/app.js'), 'utf8');
  assert.ok(appSource.includes("app.get('/api/v1/auth/session'"));
  assert.ok(appSource.includes("app.post('/api/v1/admin/forms/:formId/archive'"));
  assert.ok(appSource.includes("app.delete('/api/v1/admin/forms/:formId'"));
  assert.ok(adminScript.includes("api('/api/v1/auth/session')"));
  assert.ok(!adminScript.includes("api('/api/v1/auth/me').then"));
  const service = fs.readFileSync(path.join(root, 'server/service.js'), 'utf8');
  assert.ok(service.includes('canonicalizeEntityAnswers'));
  assert.ok(service.includes('REVISION_CONFLICT'));
  assert.ok(service.includes("actionCode: 'form.archive'"));
  assert.ok(service.includes("actionCode: 'form.delete'"));
  assert.ok(service.includes("'FORM_HAS_HISTORY'"));
  assert.ok(service.includes("f.status<>'archived'"));
  assert.ok(service.includes('已归档表单不能发布新任务'));
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

  const schemaWithDetail = sampleSchema();
  schemaWithDetail.sections.push({
    sectionKey: '66666666-6666-4666-8666-666666666666', title: '设备明细', kind: 'detail', minRows: 0, maxRows: 10,
    fields: [{ fieldKey: '77777777-7777-4777-8777-777777777777', type: 'integer', label: '数量', required: false, options: [], validation: {} }]
  });
  const detailWorkbook = await buildWorkbook({
    task: { task_code: 'COL-T-DETAIL', name: '明细测试', form_name: '项目基础信息', owner_department_name: '工程技术部', open_at: new Date(), due_at: null },
    schema: validateFormSchema(schemaWithDetail).schema,
    rows: [{ person_id: 1, employee_no_snapshot: 'T001', person_name_snapshot: '测试人员', department_name_snapshot: '工程技术部', submission_status: 'submitted', answers_json: JSON.stringify({
      __detailRows: { '66666666-6666-4666-8666-666666666666': [{ rowKey: '88888888-8888-4888-8888-888888888888', values: { '77777777-7777-4777-8777-777777777777': 3 } }] }
    }), last_saved_at: new Date(), submitted_at: new Date() }],
    files: []
  });
  const detailSheet = detailWorkbook.worksheets.find(sheet => sheet.name.startsWith('明细1-设备明细'));
  assert.ok(detailSheet);
  assert.equal(detailSheet.rowCount, 2);
  assert.equal(detailSheet.getRow(2).getCell('F').value, 3);
}

async function testDeleteDraftBoundary() {
  function fixture(versionCount) {
    const calls = [];
    const connection = {
      beginTransaction: async () => { calls.push('begin'); },
      commit: async () => { calls.push('commit'); },
      rollback: async () => { calls.push('rollback'); },
      release: () => { calls.push('release'); },
      execute: async sql => {
        calls.push(sql);
        if (sql.startsWith('SELECT form_id FROM collection_forms')) return [[{ form_id: 'form-1' }], []];
        if (sql.includes('FROM collection_forms f')) return [[{
          form_id: 'form-1', form_code: 'COL-F-TEST', name: '测试设计稿', owner_department_id: 1, status: 'draft'
        }], []];
        if (sql.includes('SELECT COUNT(*) FROM collection_form_versions')) return [[{ version_count: versionCount, task_count: 0 }], []];
        if (sql.startsWith('DELETE FROM collection_forms')) return [{ affectedRows: 1 }, []];
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    };
    const auditEvents = [];
    const service = makeService({
      pool: { getConnection: async () => connection },
      audit: async (req, event, executor) => { auditEvents.push(event); assert.equal(executor, connection); }
    });
    return { calls, auditEvents, service };
  }

  const identity = { personId: 1, grants: [{ roleCode: 'collection_admin', scopeType: 'global' }] };
  const deletable = fixture(0);
  assert.deepEqual(await deletable.service.deleteForm(identity, 'form-1', {}), { formId: 'form-1', status: 'deleted' });
  assert.ok(deletable.calls.some(sql => String(sql).startsWith('DELETE FROM collection_forms')));
  assert.equal(deletable.auditEvents[0].actionCode, 'form.delete');
  assert.ok(deletable.calls.indexOf('commit') > deletable.calls.findIndex(sql => String(sql).startsWith('DELETE FROM collection_forms')));

  const published = fixture(1);
  await assert.rejects(() => published.service.deleteForm(identity, 'form-1', {}), error => error.code === 'FORM_HAS_HISTORY');
  assert.ok(!published.calls.some(sql => String(sql).startsWith('DELETE FROM collection_forms')));
  assert.ok(published.calls.includes('rollback'));
}

async function testDetailEntitySnapshots() {
  const schema = validateFormSchema({
    title: '人员设备表', sections: [
      { sectionKey: '11111111-1111-4111-8111-111111111111', title: '主表', kind: 'main', fields: [{ fieldKey: '22222222-2222-4222-8222-222222222222', type: 'person', label: '负责人' }] },
      { sectionKey: '33333333-3333-4333-8333-333333333333', title: '设备明细', kind: 'detail', fields: [{ fieldKey: '44444444-4444-4444-8444-444444444444', type: 'department', label: '使用部门' }] }
    ]
  }).schema;
  const answers = {
    '22222222-2222-4222-8222-222222222222': { personId: 7, personName: '旧名称' },
    __detailRows: { '33333333-3333-4333-8333-333333333333': [{ rowKey: '55555555-5555-4555-8555-555555555555', values: { '44444444-4444-4444-8444-444444444444': { departmentId: 9, departmentName: '旧部门' } } }] }
  };
  const connection = { execute: async sql => {
    if (sql.includes('FROM person')) return [[{ person_id: 7, employee_no: 'T007', person_name: '当前姓名' }], []];
    if (sql.includes('FROM departments')) return [[{ id: 9, name: '当前部门' }], []];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await canonicalizeEntityAnswers(connection, schema, answers);
  assert.deepEqual(result['22222222-2222-4222-8222-222222222222'], { personId: 7, employeeNo: 'T007', personName: '当前姓名' });
  assert.deepEqual(result.__detailRows['33333333-3333-4333-8333-333333333333'][0].values['44444444-4444-4444-8444-444444444444'], { departmentId: 9, departmentName: '当前部门' });
}

async function main() {
  testValidation();
  testDetailGridPaste();
  testStatisticsAndStatus();
  testSchemaBoundary();
  testStaticContracts();
  await testDeleteDraftBoundary();
  await testDetailEntitySnapshots();
  await testWorkbook();
  console.log('INFORMATION_COLLECTION_CONTRACT_PASS');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
