const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const PORT = 3237;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function seedFixture() {
  db.prepare("INSERT OR IGNORE INTO departments (name, code) VALUES ('项目管理部', 'PMO')").run();
  const dept = db.prepare("SELECT id FROM departments WHERE name='项目管理部'").get();
  db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('系统管理员', 'ADMIN001', dept.id, '系统管理员', 'admin', hashPassword('admin123'));
  db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('流程确认人', 'USER001', dept.id, '业务对接人', 'submitter', hashPassword('user123'));
  const snapshot = db.prepare(`
    INSERT INTO process_governance_snapshots (source_json_path, source_hash, stats_json, status, note)
    VALUES ('fixture/process-governance.json', 'issue-pool-batch', '{}', 'active', 'issue pool batch')
  `).run();
  const snapshotId = snapshot.lastInsertRowid;
  db.prepare(`
    INSERT INTO process_mapping_records (
      mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, l3_name,
      a1_code, behavior, source_file, status
    ) VALUES (
      'issue-pool-batch-record-001', 'a1', ?, ?, '项目管理部', '项目阶段划分与阶段评审',
      'XM-L3-03-A01', '设置阶段评审计划',
      'docs/norms/项目管理部部门-能力-流程-系统映射关系.md', 'active'
    )
  `).run(snapshotId, snapshotId);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const tick = async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.ok) return resolve();
      } catch (error) {
        if (Date.now() > deadline) return reject(error);
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

const csrfTokens = new Map();

async function request(routePath, options = {}, cookie = '') {
  const requestOptions = { ...options };
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const headers = {
    ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {})
  };
  if (cookie && !['GET', 'HEAD', 'OPTIONS'].includes(method) && routePath !== '/api/org/login') {
    const token = await csrfTokenFor(cookie);
    if (token) headers['X-CSRF-Token'] = token;
  }
  const res = await fetch(`${BASE_URL}${routePath}`, { ...requestOptions, headers });
  const body = await res.json();
  return { res, body };
}

async function csrfTokenFor(cookie) {
  if (csrfTokens.has(cookie)) return csrfTokens.get(cookie);
  const result = await request('/api/csrf-token', {}, cookie);
  if (result.res.status !== 200 || !result.body.csrfToken) return '';
  csrfTokens.set(cookie, result.body.csrfToken);
  return result.body.csrfToken;
}

async function main() {
  seedFixture();
  db.close();
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      SESSION_SECRET: 'process-governance-issue-pool-batch-test',
      MDM_DB_QUIET: '1',
      MDM_IDENTITY_READ_MODEL: '',
      PROCESS_GOVERNANCE_READ_MODEL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    await waitForServer();
    const normalLogin = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'USER001', password: 'user123' })
    });
    assert.strictEqual(normalLogin.res.status, 200);
    const normalCookie = normalLogin.res.headers.get('set-cookie').split(';')[0];
    const normalUserRes = await request('/api/process-governance/issue-pool/batches/generate', {
      method: 'POST',
      body: JSON.stringify({})
    }, normalCookie);
    assert.strictEqual(normalUserRes.res.status, 403);

    const adminLogin = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin123' })
    });
    assert.strictEqual(adminLogin.res.status, 200);
    const adminCookie = adminLogin.res.headers.get('set-cookie').split(';')[0];
    const adminRes = await request('/api/process-governance/issue-pool/batches/generate', {
      method: 'POST',
      body: JSON.stringify({})
    }, adminCookie);
    assert.strictEqual(adminRes.res.status, 200);
    assert.ok(adminRes.body.batch.batch_key);
    assert.strictEqual(adminRes.body.batch.status, 'ready');
    assert.ok(Number(adminRes.body.summary.issue_count) >= 1);

    console.log('Process governance issue pool batch test passed');
  } catch (error) {
    if (stderr) console.error(stderr);
    throw error;
  } finally {
    await stopServer(server);
    cleanupDb();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
