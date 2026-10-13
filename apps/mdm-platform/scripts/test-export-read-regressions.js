// Exercise the actual repository read budget and projection with synthetic SQL results.
const test = require('node:test');
const assert = require('node:assert/strict');
require('./testHelpers/blockRealMysql');
const { makeDataMapMysqlRepository } = require('../server/dataMapMysqlRepository');
const context = { id: 10, dept_id: 91, title: 'synthetic-context' };
function repository(probe = [{ id: 1 }]) {
  const calls = [];
  const repo = makeDataMapMysqlRepository({ async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT f.id FROM')) return [probe];
    if (sql.startsWith('SELECT c.* FROM')) return [[context]];
    throw new Error('UNEXPECTED_QUERY');
  } });
  repo.getFieldsByContext = async () => [{ id: 1, field_name_cn: 'synthetic-field', note: 'field-note' }];
  repo.getFieldIdentity = async () => ({ id: 99, authoritative_system_name: 'synthetic-system', authoritative_system: 'synthetic-system', maintain_dept_id: 91, confirmed: 1, note: 'identity-note' });
  return { repo, calls };
}

test('overflow is rejected before reading field payloads and identities', async () => {
  const { repo, calls } = repository([{ id: 1 }, { id: 2 }, { id: 3 }]);
  await assert.rejects(repo.exportFieldLedger({ departmentId: 91 }, { maxRows: 2 }), { code: 'EXPORT_LIMIT_EXCEEDED' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /LIMIT 3$/);
  assert.deepEqual(calls[0].params, [91]);
});

test('exact department IDs reach SQL and field/identity projections keep their own values', async () => {
  const { repo, calls } = repository();
  const data = await repo.exportFieldLedger({ departmentId: '9007199254740993' }, { maxRows: 2 });
  assert.deepEqual(calls[0].params, ['9007199254740993']);
  assert.equal(data.fields[0].id, 1);
  assert.equal(data.fields[0].note, 'field-note');
  assert.equal(data.fields[0].identity.id, 99);
  assert.equal(data.fields[0].authoritative_system_name, 'synthetic-system');
  assert.equal(data.fields[0].maintain_dept_id, 91);
});

test('departure during the final context cancels further identity reads and prevents a response', async () => {
  const { repo } = repository();
  const controller = new AbortController();
  let identityReads = 0;
  repo.getFieldsByContext = async () => [{ id: 1 }, { id: 2 }];
  repo.getFieldIdentity = async () => { identityReads++; controller.abort(Object.assign(new Error('cancelled'), { code: 'EXPORT_ABORTED' })); return null; };
  await assert.rejects(repo.exportFieldLedger({}, { maxRows: 2, signal: controller.signal }), { code: 'EXPORT_ABORTED' });
  assert.equal(identityReads, 1);
});

test('context rows are bounded before link and identity payloads are fetched', async () => {
  let queries = 0;
  const repo = makeDataMapMysqlRepository({ async execute(sql) { queries++; assert.match(sql, /LIMIT 2$/); return [[{ id: 1 }, { id: 2 }]]; } });
  await assert.rejects(repo.getFieldsByContext(10, { maxRows: 1 }), { code: 'EXPORT_LIMIT_EXCEEDED' });
  assert.equal(queries, 1);
});
