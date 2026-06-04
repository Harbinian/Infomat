const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';

const db = require('../server/db');
const { hashPassword } = require('../server/auth');
const { importProcessGovernanceSnapshot } = require('./lib/processGovernanceImport');

const PORT = 3226;
const BASE_URL = `http://127.0.0.1:${PORT}`;

db.prepare(`
  INSERT INTO users (name, employee_no, post, role, password_hash)
  VALUES (?, ?, ?, ?, ?)
`).run('系统管理员', 'ADMIN001', '系统管理员', 'admin', hashPassword('admin123'));

importProcessGovernanceSnapshot({
  db,
  sourceJsonPath: path.join(__dirname, 'fixtures', 'process-governance-snapshot.json'),
  a1MarkdownPaths: [path.join(__dirname, 'fixtures', 'process-governance-a1.md')],
  importedBy: null,
  note: 'api fixture'
});

db.close();

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

async function request(routePath, options = {}, cookie = '') {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {})
  };
  const res = await fetch(`${BASE_URL}${routePath}`, { ...options, headers });
  const body = await res.json();
  return { res, body };
}

async function main() {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      SESSION_SECRET: 'process-governance-api-test',
      MDM_DB_QUIET: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  server.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer();

    const unauthorized = await request('/api/process-governance/current');
    assert.strictEqual(unauthorized.res.status, 401);

    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin123' })
    });
    assert.strictEqual(login.res.status, 200);
    const cookie = login.res.headers.get('set-cookie').split(';')[0];

    const current = await request('/api/process-governance/current', {}, cookie);
    assert.strictEqual(current.res.status, 200);
    assert.strictEqual(current.body.stats.mappings, 1);

    const snapshots = await request('/api/process-governance/snapshots', {}, cookie);
    assert.strictEqual(snapshots.res.status, 200);
    assert.strictEqual(snapshots.body.length, 1);

    const sankey = await request('/api/process-governance/sankey', {}, cookie);
    assert.strictEqual(sankey.res.status, 200);
    assert.strictEqual(sankey.body.stats.mappings, 1);
    assert.strictEqual(sankey.body.systems.join(','), 'ERP,OA');
    assert.strictEqual(sankey.body.crossDept.stats.highRisk, 1);
    assert.ok(sankey.body.nodes.some(node => node.name === '经营发展部'));

    const a1 = await request('/api/process-governance/a1?dept=经营发展部', {}, cookie);
    assert.strictEqual(a1.res.status, 200);
    assert.strictEqual(a1.body.items[0].a1_code, 'JY-L3-01-A1-001');
    assert.deepStrictEqual(a1.body.items[0].suggested_systems, ['OA', 'ERP']);

    const filteredA1 = await request('/api/process-governance/a1?system=ERP', {}, cookie);
    assert.strictEqual(filteredA1.res.status, 200);
    assert.strictEqual(filteredA1.body.items.length, 1);

    const risks = await request('/api/process-governance/cross-dept?risk=high', {}, cookie);
    assert.strictEqual(risks.res.status, 200);
    assert.strictEqual(risks.body.items[0].target_dept, '工程技术部');

    const chains = await request('/api/process-governance/chains', {}, cookie);
    assert.strictEqual(chains.res.status, 200);
    assert.deepStrictEqual(chains.body.items[0].breaks, ['工程技术部: 技术条款评审节点待补全']);

    console.log('Process governance API test passed');
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
  process.exit(1);
});
