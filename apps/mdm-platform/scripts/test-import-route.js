const assert = require('assert');
const express = require('express');
const ExcelJS = require('exceljs');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const { setDataMapRepositoryFactory, resetDataMapRepositoryFactory } = require('../server/dataMapMysqlRepository');
const importRouter = require('../server/routes/import');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function workbookBlob(rows, headers = ['数据对象', '字段说明', '中文字段名', '英文字段名', '字段类型', '消费系统', '同步方式']) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('字段台账');
  sheet.addRow(headers);
  rows.forEach(row => sheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function makeFakeRepository() {
  const state = {
    contexts: [
      { id: 10, context_id: 10, mapping_id: 10, dept_id: 1, owner_user_id: 42, created_by: 42, title: '供应商字段上下文' }
    ],
    fields: [],
    batches: [],
    calls: []
  };
  return {
    state,
    async getContext(id) {
      state.calls.push(['getContext', Number(id)]);
      return state.contexts.find(context => context.id === Number(id)) || null;
    },
    async createField(payload, actorUserId) {
      state.calls.push(['createField', payload, actorUserId]);
      const field = {
        id: state.fields.length + 1,
        ...payload,
        context_id: Number(payload.context_id),
        mapping_id: Number(payload.context_id),
        submitted_by: actorUserId
      };
      state.fields.push(field);
      return field;
    },
    async recordImportBatch(payload) {
      state.calls.push(['recordImportBatch', payload]);
      state.batches.push(payload);
      return { id: state.batches.length };
    }
  };
}

async function upload(baseUrl, contextId, blob, userId) {
  const form = new FormData();
  form.append('context_id', String(contextId));
  if (blob) form.append('file', blob, 'field-ledger.xlsx');
  return fetch(`${baseUrl}/api/import/field-entries`, {
    method: 'POST',
    headers: userId ? { 'x-test-user-id': String(userId) } : {},
    body: form
  });
}

async function main() {
  const repo = makeFakeRepository();
  setDataMapRepositoryFactory(async () => repo);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      if (Number(userId) === 1) return { permSet: new Set(['admin:access']), fieldConstraints: {} };
      return { permSet: new Set(), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      if (Number(userId) === 42) return [{ code: legacyRole || 'submitter', name: '报送人' }];
      return [{ code: legacyRole || 'submitter', name: '报送人' }];
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const userId = Number(req.get('x-test-user-id') || 0);
    if (userId) {
      req.session = {
        userId,
        userRole: userId === 1 ? 'admin' : 'submitter',
        userName: userId === 1 ? '系统管理员' : '业务报送人',
        departmentId: userId === 99 ? 2 : 1
      };
    }
    next();
  });
  app.use('/api/import', importRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const protectedImport = await upload(baseUrl, 10, await workbookBlob([]), 0);
    assert.strictEqual(protectedImport.status, 401);

    const adminImport = await upload(baseUrl, 10, await workbookBlob([
      ['供应商', '供应商唯一编码', '供应商编码', 'supplier_code', '编码', 'ERP, SRM', '批量']
    ]), 1);
    const adminBody = await adminImport.json();
    assert.strictEqual(adminImport.status, 200, JSON.stringify(adminBody));
    assert.strictEqual(adminBody.imported, 1);
    assert.strictEqual(adminBody.context_id, 10);
    assert.strictEqual(repo.state.fields[0].field_name_cn, '供应商编码');
    assert.deepStrictEqual(repo.state.fields[0].consume_systems, ['ERP', 'SRM']);
    assert.strictEqual(repo.state.fields[0].submitted_by, 1);
    assert.strictEqual(repo.state.batches[0].row_count, 1);

    const submitterImport = await upload(baseUrl, 10, await workbookBlob([
      ['供应商', '供应商主数据说明', '供应商名称', 'supplier_name', '文本', 'ERP', '实时']
    ]), 42);
    const submitterBody = await submitterImport.json();
    assert.strictEqual(submitterImport.status, 200, JSON.stringify(submitterBody));
    assert.strictEqual(submitterBody.imported, 1);
    assert.strictEqual(repo.state.fields[1].submitted_by, 42);

    const otherDeptImport = await upload(baseUrl, 10, await workbookBlob([
      ['供应商', '无权导入', '供应商状态', 'supplier_status', '文本', 'ERP', '实时']
    ]), 99);
    assert.strictEqual(otherDeptImport.status, 403);

    const missingHeaderImport = await upload(baseUrl, 10, await workbookBlob([
      ['供应商', '缺表头']
    ], ['数据对象', '中文字段名']), 1);
    const missingHeaderBody = await missingHeaderImport.json();
    assert.strictEqual(missingHeaderImport.status, 400);
    assert.ok(missingHeaderBody.error.includes('缺少表头'));

    const noFile = await upload(baseUrl, 10, null, 1);
    const noFileBody = await noFile.json();
    assert.strictEqual(noFile.status, 400);
    assert.strictEqual(noFileBody.error, '缺少 Excel 文件');

    assert.ok(repo.state.calls.some(call => call[0] === 'createField'), 'import should create fields through Data Map repository');
    assert.ok(repo.state.calls.some(call => call[0] === 'recordImportBatch'), 'import should record a Data Map import batch');
    console.log('Import route integration test passed');
  } finally {
    await closeServer(server);
    resetDataMapRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
    if (previousIdentityReadModel === undefined) {
      delete process.env.MDM_IDENTITY_READ_MODEL;
    } else {
      process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
