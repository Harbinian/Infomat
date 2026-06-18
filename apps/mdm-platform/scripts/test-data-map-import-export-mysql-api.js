const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const ExcelJS = require('exceljs');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const { setDataMapRepositoryFactory, resetDataMapRepositoryFactory } = require('../server/dataMapMysqlRepository');
const importRouter = require('../server/routes/import');
const exportRouter = require('../server/routes/export');
const qualityRouter = require('../server/routes/quality');

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

async function workbookBlob() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('字段台账');
  sheet.addRow(['数据对象', '字段说明', '中文字段名', '英文字段名', '字段类型', '消费系统', '同步方式']);
  sheet.addRow(['客户', '客户展示名称', '客户名称', 'customer_name', '文本', 'CRM, ERP', '实时']);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function makeFakeDataMapRepository() {
  const state = {
    contexts: [{ id: 10, mapping_id: 10, context_id: 10, dept_id: 9, dept_name: '经营发展部', owner_user_id: 42, created_by: 42, title: '客户字段上下文', status: 'active' }],
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
        context_id: Number(payload.context_id || payload.mapping_id),
        mapping_id: Number(payload.context_id || payload.mapping_id),
        process_name: '客户主数据维护',
        system_name: 'CRM',
        data_object: payload.data_object,
        field_name_cn: payload.field_name_cn,
        field_name_en: payload.field_name_en,
        field_type: payload.field_type,
        authoritative_system: 'CRM',
        maintain_dept: '经营发展部',
        process_governance_node_key: payload.process_governance_node_key || '',
        process_governance_a1_code: payload.process_governance_a1_code || '',
        consume_systems: JSON.stringify(payload.consume_systems || []),
        sync_mode: payload.sync_mode,
        note: payload.note,
        confirmed: 1,
        confirmed_by_name: '字段 owner',
        confirmed_at: '2026-06-18 10:00:00'
      };
      state.fields.push(field);
      return field;
    },
    async recordImportBatch(payload) {
      state.calls.push(['recordImportBatch', payload]);
      state.batches.push(payload);
      return { id: state.batches.length };
    },
    async exportFieldLedger() {
      state.calls.push(['exportFieldLedger']);
      return {
        fields: state.fields,
        identities: state.fields
      };
    },
    async fieldIdentityProgress() {
      state.calls.push(['fieldIdentityProgress']);
      return {
        overall: { total: state.fields.length, confirmed: state.fields.filter(field => field.confirmed).length, pct: state.fields.length ? 100 : 0 },
        by_domain: [{ domain: '客户', total: state.fields.length, confirmed: state.fields.length, pct: state.fields.length ? 100 : 0 }]
      };
    }
  };
}

async function main() {
  for (const routeFile of ['import.js', 'export.js', 'quality.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../server/routes', routeFile), 'utf8');
    assert.ok(!source.includes("require('../db')") || routeFile === 'quality.js', `${routeFile} should not import SQLite db for field-domain endpoints`);
    assert.ok(!source.includes('field_entries'), `${routeFile} must not query SQLite field_entries`);
    assert.ok(!source.includes('field_identities'), `${routeFile} must not query SQLite field_identities`);
  }

  const repo = makeFakeDataMapRepository();
  setDataMapRepositoryFactory(async () => repo);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['admin:access']), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      return [{ code: legacyRole, name: '基础角色' }, { code: 'admin', name: '管理员' }].filter(role => role.code);
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'admin',
      userName: '数据地图管理员',
      departmentId: 9
    };
    next();
  });
  app.use('/api/import', importRouter);
  app.use('/api/export', exportRouter);
  app.use('/api/quality', qualityRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const form = new FormData();
    form.append('mapping_id', '10');
    form.append('file', await workbookBlob(), 'fields.xlsx');

    const importRes = await fetch(`${baseUrl}/api/import/field-entries`, { method: 'POST', body: form });
    const importBody = await importRes.json();
    assert.strictEqual(importRes.status, 200, JSON.stringify(importBody));
    assert.strictEqual(importBody.imported, 1);
    assert.strictEqual(repo.state.fields[0].field_name_cn, '客户名称');
    assert.strictEqual(repo.state.batches[0].context_id, 10);

    const qualityRes = await fetch(`${baseUrl}/api/quality/field-identities/progress`);
    const qualityBody = await qualityRes.json();
    assert.strictEqual(qualityRes.status, 200, JSON.stringify(qualityBody));
    assert.strictEqual(qualityBody.overall.pct, 100);

    const exportRes = await fetch(`${baseUrl}/api/export/excel`);
    assert.strictEqual(exportRes.status, 200);
    const exportBuffer = Buffer.from(await exportRes.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportBuffer);
    const ledger = workbook.getWorksheet('字段台账');
    assert.ok(ledger, 'export should include 字段台账 sheet');
    assert.strictEqual(ledger.getRow(2).getCell(4).value, '客户名称');
    const matrix = workbook.getWorksheet('黄金源矩阵');
    assert.ok(matrix, 'export should include 黄金源矩阵 sheet');
    assert.strictEqual(matrix.getRow(2).getCell(5).value, 'CRM');

    assert.ok(repo.state.calls.some(call => call[0] === 'exportFieldLedger'), 'export should read Data Map repository');
    console.log('Data Map import/export MySQL API test passed');
  } finally {
    await closeServer(server);
    resetDataMapRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
});
