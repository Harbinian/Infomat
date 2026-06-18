const assert = require('assert');
const express = require('express');
const ExcelJS = require('exceljs');

process.env.MDM_DB_QUIET = '1';

const { setDataMapRepositoryFactory, resetDataMapRepositoryFactory } = require('../server/dataMapMysqlRepository');
const exportRouter = require('../server/routes/export');

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

function makeFakeRepository() {
  const state = { calls: [] };
  return {
    state,
    async exportFieldLedger() {
      state.calls.push(['exportFieldLedger']);
      const field = {
        id: 1,
        context_id: 10,
        mapping_id: 10,
        context_title: '客户主数据维护',
        dept_name: '信息化部',
        object_name_cn: '客户',
        data_object: '客户',
        field_name_cn: '客户编码',
        field_name_en: 'customer_code',
        field_type: '文本',
        process_governance_node_key: '客户主数据维护',
        process_governance_a1_code: 'KH-L3-01-A1-001',
        consume_systems: JSON.stringify(['CRM', 'ERP']),
        sync_mode: '实时',
        note: '客户唯一编码',
        system_name: 'MDM平台',
        identity: {
          authoritative_system_name: 'MDM平台',
          maintain_dept_name: '信息化部',
          confirmed: 1,
          confirmed_by: '数据负责人',
          confirmed_at: '2026-06-18 10:00:00'
        }
      };
      return {
        fields: [field],
        identities: [{
          ...field,
          candidate_systems: JSON.stringify(['MDM平台', 'CRM']),
          authoritative_system_name: 'MDM平台',
          maintain_dept_name: '信息化部',
          confirmed: 1,
          confirmed_by: '数据负责人',
          confirmed_at: '2026-06-18 10:00:00'
        }]
      };
    }
  };
}

async function main() {
  const repo = makeFakeRepository();
  setDataMapRepositoryFactory(async () => repo);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.get('x-test-user-id')) {
      req.session = {
        userId: Number(req.get('x-test-user-id')),
        userRole: 'admin',
        userName: '系统管理员',
        departmentId: 1
      };
    }
    next();
  });
  app.use('/api/export', exportRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const protectedExport = await fetch(`${baseUrl}/api/export/excel`);
    assert.strictEqual(protectedExport.status, 401);

    const exportResponse = await fetch(`${baseUrl}/api/export/excel`, {
      headers: { 'x-test-user-id': '1' }
    });
    assert.strictEqual(exportResponse.status, 200);
    assert.ok(exportResponse.headers.get('content-type').includes('spreadsheetml.sheet'));
    assert.ok(exportResponse.headers.get('content-disposition').includes('mdm-data-map-field-ledger.xlsx'));

    const buffer = Buffer.from(await exportResponse.arrayBuffer());
    assert.ok(buffer.length > 0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const ledger = workbook.getWorksheet('字段台账');
    const matrix = workbook.getWorksheet('黄金源矩阵');
    const termConflicts = workbook.getWorksheet('术语冲突台账');
    assert.ok(ledger);
    assert.ok(matrix);
    assert.ok(!termConflicts, 'Data Map field-domain export should not include legacy term-conflict sheet');

    assert.strictEqual(ledger.getRow(1).getCell(1).value, '数据地图上下文');
    assert.strictEqual(ledger.getRow(2).getCell(1).value, '客户主数据维护');
    assert.strictEqual(ledger.getRow(2).getCell(2).value, '信息化部');
    assert.strictEqual(ledger.getRow(2).getCell(4).value, '客户编码');
    assert.strictEqual(ledger.getRow(2).getCell(7).value, 'MDM平台');
    assert.strictEqual(ledger.getRow(2).getCell(9).value, '客户主数据维护');
    assert.strictEqual(ledger.getRow(2).getCell(10).value, 'KH-L3-01-A1-001');
    assert.strictEqual(ledger.getRow(2).getCell(11).value, 'CRM, ERP');

    assert.strictEqual(matrix.getRow(2).getCell(4).value, 'MDM平台, CRM');
    assert.strictEqual(matrix.getRow(2).getCell(5).value, 'MDM平台');
    assert.strictEqual(matrix.getRow(2).getCell(7).value, '是');
    assert.strictEqual(matrix.getRow(2).getCell(8).value, '数据负责人');

    assert.ok(repo.state.calls.some(call => call[0] === 'exportFieldLedger'), 'export should read Data Map repository');
    console.log('Export route integration test passed');
  } finally {
    await closeServer(server);
    resetDataMapRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
