const assert = require('node:assert/strict');

const Migration = require('../public/process-governance-migration.js');
const { app } = require('../server');
const { createProcessVersionFixture } = require('./process-version-fixtures');

async function validate(baseUrl, data) {
  const response = await fetch(`${baseUrl}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function run() {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    for (const version of [
      'process-governance-v1',
      'process-governance-v2',
      'process-governance-v3',
      'process-governance-v4',
      'process-governance-v5',
      'process-governance-v6'
    ]) {
      const source = createProcessVersionFixture(version);
      const sourceSnapshot = JSON.parse(JSON.stringify(source));
      const sourceValidation = await validate(baseUrl, source);
      assert.equal(sourceValidation.valid, true, `${version} source: ${JSON.stringify(sourceValidation.errors)}`);

      const first = Migration.migrateDocument(source)[0];
      const second = Migration.migrateDocument(source)[0];
      assert.deepEqual(source, sourceSnapshot, `${version} migration must not modify its source object`);
      assert.deepEqual(first, second, `${version} migration must be deterministic`);
      assert.equal(first.schema_version, 'process-governance-v7');
      const targetValidation = await validate(baseUrl, first);
      assert.equal(targetValidation.valid, true, `${version} target: ${JSON.stringify(targetValidation.errors)}`);
      assert.deepEqual(
        Migration.migrateDocument(JSON.parse(JSON.stringify(first)))[0],
        first,
        `${version} migrated v7 download must re-import without changing content`
      );
    }

    assert.throws(
      () => createProcessVersionFixture('process-governance-v999'),
      /不支持的测试夹具版本/
    );
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  console.log('structured-output-service version fixture tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
