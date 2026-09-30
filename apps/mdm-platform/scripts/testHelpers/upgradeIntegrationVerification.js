// P24 continuous synthetic chain. Called only by the owned MySQL fixture.
// --p24 --p17 uses one imported object/field, actual worker and closure scenario.
// Writes evidence to the caller's new artifacts directory; no external materials.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const uuid = () => crypto.randomUUID();

exports.upload = async (fixture, document) => {
  const login = await fetch(fixture.baseURL + '/api/org/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginName: 'SYNTHETIC_lead', password: fixture.loginPassword }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const csrf = await (await fetch(fixture.baseURL + '/api/csrf-token', { headers: { Cookie: cookie } })).json();
  const body = new FormData(); body.append('file', new Blob([JSON.stringify(document)], { type: 'application/json' }), 'p24-synthetic.json'); body.append('request_id', uuid());
  const result = await fetch(fixture.baseURL + '/api/v7-mappings/uploads', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf.csrfToken }, body });
  assert.equal(result.status, 200); return result.json();
};

exports.prepare = async ({ pool, fixture, expect, check, save, output }) => {
  let pw;
  try { pw = require('playwright'); } catch { pw = require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); }
  const bytes = await require('./masterDataTemplateFixture').fixture().bytes();
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  let imported, obj, field, fact;
  try {
    const page = await browser.newPage({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    await check('P24 Edge imports one synthetic workbook through real preview and explicit confirmation', async () => {
      await page.goto(fixture.baseURL + '/app/template-import');
      await page.locator('#login-name').fill('SYNTHETIC_contact');
      await page.locator('#login-password').fill(fixture.loginPassword);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.getByLabel('选择主数据模板文件').setInputFiles({ name: 'p24-synthetic.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
      await page.getByRole('button', { name: '检查文件与关联', exact: true }).click();
      const receipt = page.waitForResponse(r => r.url().endsWith('/api/master-data-template/confirm') && r.request().method() === 'POST');
      await page.getByRole('button', { name: '明确确认导入', exact: true }).click();
      const response = await receipt; assert.equal(response.status(), 200); imported = await response.json();
      await page.getByRole('heading', { name: '导入完成，待核实', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => visualViewport.scale), 1);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(output, 'p24-import-desktop.png'), fullPage: true });
      save('p24-import.json', imported);
    });
    const defs = '/api/data-map-definitions';
    const current = async (type, id) => (await expect('contact', defs + '/detail/' + type + '/' + id, 'GET')).current;
    obj = await current('object', imported.mappings.find(m => m.record_type === 'object').entity_id);
    field = await current('field', imported.mappings.find(m => m.record_type === 'field').entity_id);
    await check('P24 imported stable field is revised and its fixed fact is answered and checked over HTTP', async () => {
      const original = field;
      field = await expect('contact', defs + '/save', 'POST', { request_id: uuid(), entity_type: 'field', entity_id: field.entity_id, expected_revision: field.revision_no, object_id: obj.entity_id, object_version_id: obj.version_id, definition: { business_meaning: 'P24合成订单编号，来源仅用于隔离验证' } });
      assert.equal(field.entity_id, original.entity_id); assert.notEqual(field.version_id, original.version_id);
      { const connection = await pool.getConnection(); try { await require('../../server/dataMapFactMigration').applyFacts(connection); } finally { connection.release(); } }
      fact = await expect('lead', '/api/data-map-facts', 'POST', { request_id: uuid(), subject_version_id: field.version_id, object_version_id: obj.version_id, focus: ['business_meaning'], question: '请核对该编号含义并定位合成依据', target_department_id: '91', target_person_id: '83' });
      const act = async (action, who, body = {}) => { fact = await expect(who, '/api/data-map-facts/' + fact.fact_id + '/' + action, 'POST', { request_id: uuid(), expected_revision: fact.revision_no, ...body }); };
      await act('send', 'lead');
      await act('answer', 'contact', { answer: '合成订单编号', evidence_refs: ['P24合成模板 主数据清单 J53'], needs_more_info: false, missing_reason: '' });
      await act('check', 'lead', { reason: '已核对合成事实，未作正式认定', evidence_refs: ['P24合成模板 主数据清单 J53'] });
      assert.equal(fact.status, 'checked');
      assert.equal((await current('field', field.entity_id)).definition.governance, null);
      save('p24-fact.json', await expect('lead', '/api/data-map-facts/' + fact.fact_id, 'GET'));
      save('p24-fixed-definitions.json', { original, obj, field });
    });
    return { obj, field, fact, batch_id: imported.batch_id };
  } finally { await browser.close(); }
};

exports.analyze = async ({ repo, lead, pool, handoff, check, save, integrated, source, mapping, fieldMap, expect }) => {
  { const connection = await pool.getConnection(); try { await require('../../server/analysisQueueMigration').applyAnalysisQueue(connection); } finally { connection.release(); } }
  const rules = require('../../server/handoffAnalysisRules');
  const run = await expect('lead', '/api/analysis/runs', 'POST', { request_id: uuid(), inputs: [{ input_key: 'handoff', kind: 'handoff', ref_id: handoff.handoff_version_id }], check_scope: { description: 'P24同一导入对象的设计交接自动检查', check_ids: rules.CHECKS }, parser_versions: { [rules.PARSER]: rules.VERSION }, rule_version: rules.VERSION, steps: [{ step_key: 'check', input_keys: ['handoff'], check_ids: rules.CHECKS, parser_key: rules.PARSER }], ai_metadata: null, rerun_of_run_id: null });
  const cfg = pool.pool.config.connectionConfig, logs = [];
  const worker = fork(path.resolve(__dirname, '../analysis-worker.js'), ['start', '--target', `${cfg.host}:${cfg.port}/${cfg.database}`], { env: require('./isolatedProcess').isolatedEnvironment({ MYSQL_HOST: cfg.host, MYSQL_PORT: String(cfg.port), MYSQL_USER: cfg.user, MYSQL_PASSWORD: cfg.password, MYSQL_DATABASE: cfg.database }), silent: true, windowsHide: true, execArgv: [] });
  worker.stdout.on('data', b => { for (const line of String(b).trim().split('\n')) { try { logs.push(JSON.parse(line)); } catch {} } });
  let historical;
  try {
    await check('P24 actual worker checks the mapped imported object and supplies the finding for office closure', async () => {
      const until = Date.now() + 45000;
      while (Date.now() < until) { historical = await repo.getAnalysisRun(lead, run.run_id); if (['succeeded', 'partial', 'failed'].includes(historical.status)) break; await new Promise(r => setTimeout(r, 100)); }
      assert(['succeeded', 'partial'].includes(historical.status));
      const attempt = historical.attempts.find(a => a.findings.some(f => a.evidence.some(e => f.evidence_keys.includes(e.evidence_key) && e.locator_kind === 'json_pointer')));
      assert(attempt, 'actual rule finding with source location is required');
      const finding = attempt.findings.find(f => attempt.evidence.some(e => f.evidence_keys.includes(e.evidence_key) && e.locator_kind === 'json_pointer'));
      // Put the selected actual finding first for the existing P17 scenario contract.
      historical = { ...historical, attempts: [{ ...attempt, findings: [finding, ...attempt.findings.filter(f => f !== finding)] }, ...historical.attempts.filter(a => a !== attempt)] };
      save('p24-chain.json', { batch_id: integrated.batch_id, object_id: integrated.obj.entity_id, object_version_id: integrated.obj.version_id, field_id: integrated.field.entity_id, field_version_id: integrated.field.version_id, fact_id: integrated.fact.fact_id, source_id: source.source_id, mapping, fieldMap, handoff, run_id: run.run_id, finding_id: finding.finding_id, real_worker: true, synthetic_only: true });
      save('p24-worker-result.json', historical);
    });
    return { run, historical };
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) { const stopped = once(worker, 'exit'); worker.send('stop'); const timer = setTimeout(() => worker.kill('SIGKILL'), 10000); await stopped; clearTimeout(timer); }
    save('p24-worker-cleanup.json', { stopped: worker.exitCode !== null || worker.signalCode !== null, logs });
  }
};
