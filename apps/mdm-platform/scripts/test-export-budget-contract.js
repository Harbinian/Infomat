// R09 export budget: bounded rows, bounded concurrency, a departure that stops the work, and an
// error after the download started that can no longer be written as JSON.
// Real HTTP middleware with an injected Data Map repository; no database.
const assert = require('assert');
const express = require('express');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
process.env = isolatedEnvironment({
  NODE_ENV: 'test', MDM_IDENTITY_READ_MODEL: 'mysql', MDM_SESSION_STORE: 'memory',
  MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', MYSQL_USER: 'synthetic', MYSQL_PASSWORD: 'synthetic-only',
  MYSQL_DATABASE: 'unreachable_test', MDM_EXPORT_MAX_ROWS: '12', MDM_EXPORT_MAX_CONCURRENCY: '1'
});
require('./testHelpers/blockRealMysql');

const auth = require('../server/auth');
const { setDataMapRepositoryFactory, resetDataMapRepositoryFactory } = require('../server/dataMapMysqlRepository');
const exportRouter = require('../server/routes/export');
const { activeExportCount } = require('../server/exportBudget');

const identity = {
  async getUserEffectivePermissions() { return { permSet: new Set(['governance:read-global']), fieldConstraints: {} }; },
  async validateSession() { return { valid: true, user: { personId: 42, current_department_id: 91, person_name: '合成调用者' } }; }
};
auth.setIdentityRepositoryFactory(() => identity);

function listen(app) {
  return new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
}
const closeServer = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

// The stub mirrors the repository's real contract, including the additive second argument.
function exportRepository(state) {
  return {
    state,
    async exportFieldLedger(scope, options = {}) {
      state.calls.push({ scope, options: { hasSignal: Boolean(options.signal), maxRows: options.maxRows ?? null } });
      if (state.behaviour === 'abort') {
        await new Promise(resolve => setTimeout(resolve, 20));
        if (options.signal && options.signal.aborted) throw Object.assign(new Error('导出已取消'), { code: 'EXPORT_ABORTED', statusCode: 499 });
      }
      const rows = Math.min(state.rowCount, options.maxRows ?? state.rowCount);
      if (state.rowCount > (options.maxRows ?? Infinity)) {
        throw Object.assign(new Error('导出规模超过上限'), { code: 'EXPORT_LIMIT_EXCEEDED', statusCode: 413 });
      }
      return { fields: Array.from({ length: rows }, (_, i) => ({ field_name_cn: `字段${i}`, note: '说明' })), identities: [] };
    }
  };
}

function appWith(repo) {
  setDataMapRepositoryFactory(async () => repo);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { personId: 42, userId: 42, accountId: 142, authVersion: 1, departmentId: 91 };
    next();
  });
  app.use('/api/export', exportRouter);
  return app;
}

async function main() {
  const state = { calls: [], rowCount: 3, behaviour: 'normal' };
  const repo = exportRepository(state);
  const server = await listen(appWith(repo));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // 1. The ordinary export is unchanged: same headers, same two sheets.
    const ok = await fetch(`${base}/api/export/excel`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-disposition'), 'attachment; filename=mdm-data-map-field-ledger.xlsx');
    assert.equal(ok.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const bytes = Buffer.from(await ok.arrayBuffer());
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['字段台账', '黄金源矩阵']);
    assert.equal(state.calls[0].options.maxRows, 12, 'the configured row budget reaches the repository');

    // 2. Over the budget is a capacity answer, and no download header is sent for it.
    state.rowCount = 40;
    const tooBig = await fetch(`${base}/api/export/excel`);
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.headers.get('content-disposition'), null);
    assert.equal((await tooBig.json()).code, 'EXPORT_LIMIT_EXCEEDED');

    // 3. A client that leaves is not allowed to keep the export running in the background, and
    //    the server must survive the interrupted stream rather than crashing on a second send.
    state.rowCount = 3;
    state.behaviour = 'abort';
    const abandoned = new AbortController();
    const leaving = fetch(`${base}/api/export/excel`, { signal: abandoned.signal }).catch(error => ({ aborted: true, name: error.name }));
    await new Promise(resolve => setTimeout(resolve, 5));
    abandoned.abort();
    await leaving;
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(activeExportCount(), 0, 'a departed client releases its slot');
    state.behaviour = 'normal';
    const afterAbandon = await fetch(`${base}/api/export/excel`);
    assert.equal(afterAbandon.status, 200, 'the route still works after an interrupted download');
    await afterAbandon.arrayBuffer();

    // 4. Concurrency is bounded, and a refused export is told to come back instead of queueing.
    state.behaviour = 'abort';
    const first = fetch(`${base}/api/export/excel`).then(async response => ({ status: response.status, text: await response.text().catch(() => '') }));
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = await fetch(`${base}/api/export/excel`);
    assert.equal(second.status, 503, 'the second concurrent export is refused rather than queued');
    assert.equal((await second.json()).code, 'EXPORT_BUSY');
    const firstResult = await first;
    assert.ok([200, 499].includes(firstResult.status), `the first export finished: ${firstResult.status}`);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(activeExportCount(), 0, 'every slot came back');

    console.log('R09 export budget contract passed: bounded rows, bounded concurrency, no double send');
  } finally {
    await closeServer(server);
    resetDataMapRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
