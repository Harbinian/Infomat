const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const port = process.env.WEEKLY_ACTION_TEST_PORT || '3202';
const baseUrl = `http://127.0.0.1:${port}`;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(child) {
  const deadline = Date.now() + 8000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`service exited before health check, code=${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw lastError || new Error('service did not become healthy');
}

async function withService(env, fn) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: { ...process.env, WEEKLY_ACTION_PORT: port, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    await waitForHealth(child);
    await fn();
  } finally {
    child.kill();
    await delay(200);
  }
  assert.equal(stderr, '', `service wrote to stderr:\n${stderr}`);
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  assert.equal(response.ok, true, body.error || `request failed: ${response.status}`);
  return body;
}

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-action-service-'));
  try {
    await withService({ WEEKLY_ACTION_DATA_DIR: tmpDir }, async () => {
      const health = await request('/api/health');
      assert.equal(health.status, 'ok');
      assert.equal(health.port, Number(port));
      assert.equal(health.storage.mode, 'server_file');
      assert.equal(JSON.stringify(health).includes('完成本周会议纪要'), false, 'health must not expose action item content');

      const meta = await request('/api/meta?date=2026-07-02');
      assert.equal(meta.currentWeek.start, '2026-07-02', 'Wednesday before the meeting should be in the current Thursday cycle');
      const fridayMeta = await request('/api/meta?date=2026-07-03');
      assert.equal(fridayMeta.currentWeek.start, '2026-07-02', 'Friday should stay in the same meeting cycle');
      const nextMeta = await request('/api/meta?date=2026-07-09');
      assert.equal(nextMeta.currentWeek.start, '2026-07-09', 'next Thursday should start a new meeting cycle');
      assert.ok(meta.issueTypes.some(item => item.key === 'action' && item.label === '周会行动项'));

      const created = await request('/api/items', {
        method: 'POST',
        body: JSON.stringify({
          weekId: '2026-07-02',
          type: 'action',
          title: '完成本周会议纪要',
          owner: 'PMO',
          dueDate: '2026-07-08',
          source: '周会现场',
          related: 'W-A03',
          closeCriteria: '会议纪要发布并确认行动项责任人'
        })
      });
      assert.equal(created.item.weekId, '2026-07-02');
      assert.equal(created.item.status, 'open');
      assert.equal(created.item.ledgerName, '行动项台账');

      const listed = await request('/api/items?weekId=2026-07-02&status=active');
      assert.equal(listed.items.length, 1);
      assert.equal(listed.summary.active, 1);
      assert.equal(listed.summary.closed, 0);

      const updated = await request(`/api/items/${encodeURIComponent(created.item.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: 'closed',
          closeEvidence: '会议纪要已发布',
          title: '完成本周会议纪要'
        })
      });
      assert.equal(updated.item.status, 'closed');
      assert.equal(updated.item.closeEvidence, '会议纪要已发布');

      const activeAfterClose = await request('/api/items?weekId=2026-07-02&status=active');
      assert.equal(activeAfterClose.items.length, 0);
      const allAfterClose = await request('/api/items?weekId=2026-07-02&status=all');
      assert.equal(allAfterClose.summary.closed, 1);

      const persisted = JSON.parse(fs.readFileSync(path.join(tmpDir, 'weekly-action-ledger-v1.json'), 'utf8'));
      assert.equal(persisted.items.length, 1, 'items should be written to the service-side ledger file');
      assert.equal(persisted.items[0].title, '完成本周会议纪要');

      await request(`/api/items/${encodeURIComponent(created.item.id)}`, { method: 'DELETE' });
      const afterDelete = await request('/api/items?weekId=2026-07-02&status=all');
      assert.equal(afterDelete.items.length, 0);

      const page = await fetch(baseUrl);
      const html = await page.text();
      assert.equal(page.ok, true, 'home page should load');
      for (const text of ['PMO 周会行动项', '现场登记', '行动项台账', '登记事项', '关闭证据', '延期原因']) {
        assert.ok(html.includes(text), `page missing ${text}`);
      }
      assert.equal(html.includes('localStorage'), false, '3002 should not depend on browser-local ledger storage');
      assert.ok(html.includes('/api/items'), 'page should use the service API for persistence');
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('weekly action service contract checks passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
