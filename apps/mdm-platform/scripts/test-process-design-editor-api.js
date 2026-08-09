const assert = require('assert');
const express = require('express');
const processDesignEditorRouter = require('../server/routes/processDesignEditor');

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: 1, personId: 1 };
    next();
  });
  app.use('/api/process-design/editor', processDesignEditorRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const schema = await request(baseUrl, '/api/process-design/editor/schema');
    assert.strictEqual(schema.status, 200);
    assert.strictEqual(schema.body.properties.schema_version.const, 'process-governance-v3');

    const template = await request(baseUrl, '/api/process-design/editor/template?version=process-governance-v3');
    assert.strictEqual(template.status, 200);
    assert.strictEqual(template.body.schema_version, 'process-governance-v3');
    assert.strictEqual(template.body.data.schema_version, 'process-governance-v3');

    const valid = await request(baseUrl, '/api/process-design/editor/validate', {
      method: 'POST',
      body: JSON.stringify({ data: template.body.data })
    });
    assert.strictEqual(valid.status, 200);
    assert.strictEqual(valid.body.valid, true);

    const broken = JSON.parse(JSON.stringify(template.body.data));
    broken.behaviors.push({
      behavior_ref: 'behavior_1',
      node_type: 'action',
      behavior_name: '编制申请',
      behavior_description: '',
      current_actor_role: '',
      trigger: '',
      precondition: '',
      input_description: '',
      timing: null,
      completion_standard: '',
      output_description: '',
      input_data_refs: ['missing_data'],
      output_data_refs: [],
      work_role: null,
      countersign_all_required: false,
      countersign_target_departments: []
    });
    const invalid = await request(baseUrl, '/api/process-design/editor/validate', {
      method: 'POST',
      body: JSON.stringify({ data: broken })
    });
    assert.strictEqual(invalid.status, 200);
    assert.strictEqual(invalid.body.valid, false);
    assert.ok(invalid.body.errors.some(error => error.keyword === 'localReference'));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main()
  .then(() => console.log('Process design editor API tests passed'))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
