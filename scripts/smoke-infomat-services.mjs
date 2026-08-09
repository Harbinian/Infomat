import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  INFOMAT_SERVICE_CONFIG,
  buildFixedServiceEnv,
  redactedFixedServiceEnv
} from './infomat-service-config.mjs';

const timeoutMs = Number(process.env.INFOMAT_SMOKE_TIMEOUT_MS || 8000);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logDir = path.join(os.tmpdir(), 'infomat-services');

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.items)) return value.items.length;
  if (Array.isArray(value?.rows)) return value.rows.length;
  if (Array.isArray(value?.data)) return value.data.length;
  if (Array.isArray(value?.tasks)) return value.tasks.length;
  return 0;
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { response, body, text };
  } finally {
    clearTimeout(timer);
  }
}

async function requireJson(url, options = {}) {
  const { response, body, text } = await request(url, options);
  assert.equal(response.ok, true, `${url} returned ${response.status}: ${text.slice(0, 240)}`);
  assert.notEqual(body, null, `${url} returned an empty response`);
  assert.notEqual(typeof body, 'string', `${url} did not return JSON`);
  return { response, body };
}

function extractCookie(response) {
  const raw = response.headers.get('set-cookie') || '';
  const cookie = raw.split(';')[0].trim();
  assert.ok(cookie, 'MDM login did not return a session cookie');
  return cookie;
}

function parseSankeyData(html) {
  const match = String(html || '').match(/<script[^>]+id=["']sankey-data["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'PMO procedure dashboard is missing #sankey-data');
  return JSON.parse(match[1].trim());
}

function addCheck(summary, name, details) {
  summary.checks.push({ name, ok: true, ...details });
}

function parsePort(baseUrl, fallback) {
  try {
    return Number(new URL(baseUrl).port || fallback);
  } catch {
    return fallback;
  }
}

function testTcp(host, port, waitMs = 1200) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const done = value => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(waitMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForTcp(host, port, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    if (await testTcp(host, port, 1000)) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} did not start listening on ${host}:${port}`);
}

function startFixedMysqlContainer(summary) {
  const container = INFOMAT_SERVICE_CONFIG.mysql.dockerContainer;
  const inspect = spawnSync('docker', ['inspect', container], { encoding: 'utf8' });
  if (inspect.status !== 0) {
    throw new Error(`Fixed MySQL container "${container}" was not found. Create or restore it before starting Infomat services.`);
  }
  const started = spawnSync('docker', ['start', container], { encoding: 'utf8' });
  if (started.status !== 0) {
    throw new Error(`Fixed MySQL container "${container}" did not start: ${(started.stderr || started.stdout || '').trim()}`);
  }
  addCheck(summary, 'MySQL container startup', { container, status: 'started' });
}

function startDetached(command, args, cwd, env, logPrefix) {
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, `${logPrefix}.out.log`), 'a');
  const err = fs.openSync(path.join(logDir, `${logPrefix}.err.log`), 'a');
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true
  });
  child.unref();
  return child.pid;
}

async function ensureServices(summary, fixedEnv, mdmBaseUrl, pmoBaseUrl) {
  const mysqlHost = fixedEnv.MYSQL_HOST;
  const mysqlPort = Number(fixedEnv.MYSQL_PORT);
  const mdmPort = parsePort(mdmBaseUrl, 3000);
  const pmoPort = parsePort(pmoBaseUrl, 5173);
  const pmoBindHost = INFOMAT_SERVICE_CONFIG.pmo.bindHost || INFOMAT_SERVICE_CONFIG.pmo.host || '127.0.0.1';
  const mdmDir = path.join(repoRoot, 'apps', 'mdm-platform');
  const pmoDir = path.join(repoRoot, 'pmo', 'gantt-react');

  if (!(await testTcp(mysqlHost, mysqlPort))) {
    startFixedMysqlContainer(summary);
    await waitForTcp(mysqlHost, mysqlPort, 'MySQL');
  }
  addCheck(summary, 'MySQL port', { host: mysqlHost, port: mysqlPort });

  if (await testTcp('127.0.0.1', mdmPort)) {
    addCheck(summary, 'MDM service startup', { status: 'already listening', port: mdmPort });
  } else {
    const pid = startDetached('npm.cmd', ['start'], mdmDir, fixedEnv, 'mdm-platform');
    await waitForTcp('127.0.0.1', mdmPort, 'MDM');
    addCheck(summary, 'MDM service startup', { status: 'started', port: mdmPort, pid, logs: logDir });
  }

  if (await testTcp('127.0.0.1', pmoPort)) {
    addCheck(summary, 'PMO service startup', { status: 'already listening', port: pmoPort });
  } else {
    const pid = startDetached('npm.cmd', ['run', 'dev', '--', '--host', pmoBindHost, '--port', String(pmoPort), '--strictPort'], pmoDir, {}, 'pmo-gantt');
    await waitForTcp('127.0.0.1', pmoPort, 'PMO');
    addCheck(summary, 'PMO service startup', { status: 'started', bindHost: pmoBindHost, port: pmoPort, pid, logs: logDir });
  }
}

async function checkPmo(summary, pmoBaseUrl) {
  const root = await request(`${pmoBaseUrl}/`);
  assert.equal(root.response.ok, true, `PMO root returned ${root.response.status}`);
  addCheck(summary, 'PMO root page', { status: root.response.status });

  const tasks = await requireJson(`${pmoBaseUrl}/tasks.json`);
  const taskCount = countRows(tasks.body);
  assert.ok(taskCount > 0, 'PMO tasks.json has no tasks');
  addCheck(summary, 'PMO tasks data', { count: taskCount });

  const manifest = await requireJson(`${pmoBaseUrl}/pmo-source-manifest.json`);
  addCheck(summary, 'PMO source manifest', { count: countRows(manifest.body) || Object.keys(manifest.body || {}).length });

  const dashboard = await request(`${pmoBaseUrl}/procedure-management/dashboard.html`);
  assert.equal(dashboard.response.ok, true, `PMO procedure dashboard returned ${dashboard.response.status}`);
  const sankey = parseSankeyData(dashboard.text);
  const nodes = countRows(sankey.nodes || []);
  const links = countRows(sankey.links || []);
  assert.ok(nodes > 0, 'PMO procedure dashboard has no Sankey nodes');
  assert.ok(links > 0, 'PMO procedure dashboard has no Sankey links');
  addCheck(summary, 'PMO procedure dashboard data', { nodes, links });
}

async function checkMdm(summary, fixedEnv, mdmBaseUrl) {
  const adminEmployeeNo = fixedEnv.MDM_ADMIN_EMPLOYEE_NO;
  const adminPassword = fixedEnv.MDM_ADMIN_PASSWORD;
  assert.ok(adminEmployeeNo, 'Missing MDM_ADMIN_EMPLOYEE_NO for login smoke');
  assert.ok(adminPassword, 'Missing MDM_ADMIN_PASSWORD for login smoke');

  const health = await requireJson(`${mdmBaseUrl}/api/health`);
  assert.equal(health.body.status, 'ok', 'MDM health endpoint did not return ok');
  assert.equal(health.body.identityModel, 'person', 'MDM health identity model is not person');
  assert.equal(
    health.body.governanceModelVersion,
    'rbac-raci-v3-2026-07-31',
    'MDM health governance model version is stale'
  );
  addCheck(summary, 'MDM health', {
    status: health.body.status,
    identityModel: health.body.identityModel,
    governanceModelVersion: health.body.governanceModelVersion
  });

  const login = await requireJson(`${mdmBaseUrl}/api/org/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_no: adminEmployeeNo, password: adminPassword })
  });
  assert.ok(Number(login.body.personId || login.body.id || 0) > 0, 'MDM admin login did not resolve to a person identity');
  const cookie = extractCookie(login.response);
  addCheck(summary, 'MDM admin login', {
    employee_no: adminEmployeeNo,
    personId: login.body.personId || login.body.id || null,
    user: login.body.name || null,
    governanceModelVersion: login.body.governanceModelVersion || null
  });

  const authedHeaders = { Cookie: cookie };
  const me = await requireJson(`${mdmBaseUrl}/api/org/me`, { headers: authedHeaders });
  assert.equal(me.body.id > 0, true, 'MDM /api/org/me did not return a valid user');
  const permissions = new Set(me.body.permissions || []);
  for (const permission of [
    'identity:read',
    'identity:manage-account',
    'identity:assign-role',
    'identity:read-audit',
    'governance:read-global'
  ]) {
    assert.ok(permissions.has(permission), `MDM /api/org/me admin user lacks ${permission}`);
  }
  for (const forbidden of [
    '*:*',
    'admin:access',
    'governance:draft-department',
    'governance:review-department',
    'governance:record-department-decision',
    'governance:publish'
  ]) {
    assert.equal(permissions.has(forbidden), false, `MDM admin must not have ${forbidden}`);
  }
  assert.deepEqual(me.body.roleCodes, ['admin'], 'MDM administrator should only retain the fixed admin role after migration');
  assert.ok((me.body.dataScopes || []).includes('global'), 'MDM administrator lacks global read scope');
  assert.equal(
    me.body.governanceModelVersion,
    'rbac-raci-v3-2026-07-31',
    'MDM /api/org/me governance model version is stale'
  );
  addCheck(summary, 'MDM current user', {
    displayName: me.body.name || null,
    roles: me.body.roleCodes || [],
    permissions: Array.from(permissions).sort(),
    dataScopes: me.body.dataScopes || [],
    governanceModelVersion: me.body.governanceModelVersion
  });

  const departments = await requireJson(`${mdmBaseUrl}/api/org/departments`, { headers: authedHeaders });
  const departmentCount = countRows(departments.body);
  assert.ok(departmentCount > 0, 'MDM departments are empty');
  addCheck(summary, 'MDM departments', { count: departmentCount });

  const accounts = await requireJson(`${mdmBaseUrl}/api/org/accounts`, { headers: authedHeaders });
  const accountCount = countRows(accounts.body);
  assert.ok(accountCount > 0, 'MDM accounts are empty');
  addCheck(summary, 'MDM accounts', { count: accountCount });

  const rbacModel = await requireJson(`${mdmBaseUrl}/api/rbac/model`, { headers: authedHeaders });
  assert.equal(rbacModel.body.modelVersion, 'rbac-raci-v3-2026-07-31');
  assert.equal(countRows(rbacModel.body.roles), 7, 'MDM fixed role count is not 7');
  assert.equal(countRows(rbacModel.body.permissions), 19, 'MDM fixed permission count is not 19');
  assert.equal(countRows(rbacModel.body.activities), 11, 'MDM RACI activity count is not 11');
  addCheck(summary, 'MDM fixed RBAC/RACI model', {
    modelVersion: rbacModel.body.modelVersion,
    roles: countRows(rbacModel.body.roles),
    permissions: countRows(rbacModel.body.permissions),
    activities: countRows(rbacModel.body.activities)
  });

  const csrf = await requireJson(`${mdmBaseUrl}/api/csrf-token`, { headers: authedHeaders });
  const deniedBusinessWrite = await request(`${mdmBaseUrl}/api/governance/decision-records`, {
    method: 'POST',
    headers: {
      ...authedHeaders,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.body.csrfToken
    },
    body: JSON.stringify({
      departmentId: me.body.departmentId,
      subjectDomain: 'process',
      subjectType: 'smoke',
      subjectId: 'admin-read-only-check',
      subjectVersion: '1',
      decision: 'approved',
      decisionBasis: 'smoke'
    })
  });
  assert.equal(
    deniedBusinessWrite.response.status,
    403,
    `MDM administrator business write should return 403: ${deniedBusinessWrite.text}`
  );
  addCheck(summary, 'MDM administrator business-write boundary', { status: 403 });

  const workbench = await requireJson(`${mdmBaseUrl}/api/role-workbench?mode=todo`, { headers: authedHeaders });
  addCheck(summary, 'MDM role workbench', {
    roles: countRows(workbench.body.roles || []),
    todos: countRows(workbench.body.todos || [])
  });

  const processDrafts = await requireJson(
    `${mdmBaseUrl}/api/process-design/drafts?limit=100`,
    { headers: authedHeaders }
  );
  const processHandoffs = await requireJson(
    `${mdmBaseUrl}/api/process-design/cross-dept-handoffs?limit=200`,
    { headers: authedHeaders }
  );
  const handoffConflicts = await requireJson(
    `${mdmBaseUrl}/api/process-design/handoff-conflicts?limit=200`,
    { headers: authedHeaders }
  );
  addCheck(summary, 'MDM unified process governance queues', {
    drafts: countRows(processDrafts.body.items || []),
    handoffs: countRows(processHandoffs.body.items || []),
    conflicts: countRows(handoffConflicts.body.items || [])
  });

  const editorPage = await request(`${mdmBaseUrl}/process-governance-editor/index.html`);
  assert.equal(editorPage.response.ok, true, `MDM process editor page returned ${editorPage.response.status}`);
  assert.ok(editorPage.text.includes('单流程治理编制工作台'), 'MDM process editor page is not the 3001-style workbench');
  assert.ok(editorPage.text.includes('跨职能流程图预览'), 'MDM process editor is missing the cross-functional diagram');
  assert.ok(editorPage.text.includes('结构化学习评分'), 'MDM process editor is missing the structure score');
  const editorSchema = await requireJson(`${mdmBaseUrl}/api/process-design/editor/schema`, { headers: authedHeaders });
  assert.equal(
    editorSchema.body.properties?.schema_version?.const,
    'process-governance-v3',
    'MDM process editor schema version is stale'
  );
  const editorTemplate = await requireJson(
    `${mdmBaseUrl}/api/process-design/editor/template?version=process-governance-v3`,
    { headers: authedHeaders }
  );
  const editorValidation = await requireJson(`${mdmBaseUrl}/api/process-design/editor/validate`, {
    method: 'POST',
    headers: {
      ...authedHeaders,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.body.csrfToken
    },
    body: JSON.stringify({ data: editorTemplate.body.data })
  });
  assert.equal(editorValidation.body.valid, true, 'MDM process editor empty template failed technical validation');
  addCheck(summary, 'MDM 3001-style process editor', {
    page: editorPage.response.status,
    schemaVersion: editorTemplate.body.schema_version,
    technicalValidation: editorValidation.body.valid
  });

  const currentProcess = await requireJson(`${mdmBaseUrl}/api/process-governance/current`, { headers: authedHeaders });
  addCheck(summary, 'MDM process governance current', {
    snapshot_id: currentProcess.body.snapshot?.id || currentProcess.body.id || null,
    status: currentProcess.body.snapshot?.status || currentProcess.body.status || null
  });

  const sankey = await requireJson(`${mdmBaseUrl}/api/process-governance/sankey?cap_levels=L1,L2,L3`, { headers: authedHeaders });
  const sankeyNodes = countRows(sankey.body.nodes || []);
  const sankeyLinks = countRows(sankey.body.links || []);
  assert.ok(sankeyNodes > 0, 'MDM process governance Sankey has no nodes');
  assert.ok(sankeyLinks > 0, 'MDM process governance Sankey has no links');
  addCheck(summary, 'MDM process governance data', { nodes: sankeyNodes, links: sankeyLinks });

  const issueQueues = await requireJson(`${mdmBaseUrl}/api/process-governance/issue-pool/queues`, { headers: authedHeaders });
  const issueQueueCount = countRows(issueQueues.body.queues || []);
  const issueQueueTotal = (issueQueues.body.queues || []).reduce((sum, queue) => sum + Number(queue.count || 0), 0);
  assert.ok(issueQueueCount > 0, 'MDM process governance issue pool returned no queues');
  assert.ok(issueQueueTotal > 0, 'MDM process governance issue pool has no visible issues');
  addCheck(summary, 'MDM process governance issue pool queues', {
    departmentName: issueQueues.body.departmentName || null,
    queues: issueQueueCount,
    total: issueQueueTotal
  });

  const dataMapContexts = await requireJson(`${mdmBaseUrl}/api/data-map/contexts`, { headers: authedHeaders });
  addCheck(summary, 'MDM data map contexts', { count: countRows(dataMapContexts.body) });

  const terminologyTypes = await requireJson(`${mdmBaseUrl}/api/terminology/types`, { headers: authedHeaders });
  addCheck(summary, 'MDM terminology types', { count: countRows(terminologyTypes.body) });
}

async function main() {
  const fixedEnv = buildFixedServiceEnv(process.env, repoRoot);
  const mdmBaseUrl = trimSlash(fixedEnv.INFOMAT_MDM_URL);
  const pmoBaseUrl = trimSlash(fixedEnv.INFOMAT_PMO_URL);
  const shouldStart = process.argv.includes('--start');
  const summary = {
    ok: true,
    mdmBaseUrl,
    pmoBaseUrl,
    fixedConfig: redactedFixedServiceEnv(fixedEnv),
    readModels: redactedFixedServiceEnv(fixedEnv).readModels,
    checks: []
  };

  try {
    if (shouldStart) {
      await ensureServices(summary, fixedEnv, mdmBaseUrl, pmoBaseUrl);
    }
    await checkPmo(summary, pmoBaseUrl);
    await checkMdm(summary, fixedEnv, mdmBaseUrl);
    console.log(JSON.stringify(summary, null, 2));
    console.log('Infomat service smoke passed');
  } catch (error) {
    summary.ok = false;
    summary.error = error.message || String(error);
    console.error(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
  }
}

main();
