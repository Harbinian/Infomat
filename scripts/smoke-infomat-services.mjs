import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_MDM_URL = 'http://127.0.0.1:3000';
const DEFAULT_PMO_URL = 'http://127.0.0.1:5173';
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

async function ensureServices(summary, mdmBaseUrl, pmoBaseUrl) {
  const mysqlHost = process.env.MYSQL_HOST || '127.0.0.1';
  const mysqlPort = Number(process.env.MYSQL_PORT || 3307);
  const mdmPort = parsePort(mdmBaseUrl, 3000);
  const pmoPort = parsePort(pmoBaseUrl, 5173);
  const mdmDir = path.join(repoRoot, 'apps', 'mdm-platform');
  const pmoDir = path.join(repoRoot, 'pmo', 'gantt-react');

  assert.equal(await testTcp(mysqlHost, mysqlPort), true, `MySQL is not listening on ${mysqlHost}:${mysqlPort}`);
  addCheck(summary, 'MySQL port', { host: mysqlHost, port: mysqlPort });

  if (await testTcp('127.0.0.1', mdmPort)) {
    addCheck(summary, 'MDM service startup', { status: 'already listening', port: mdmPort });
  } else {
    const pid = startDetached('npm.cmd', ['start'], mdmDir, {
      PORT: String(mdmPort),
      MYSQL_HOST: mysqlHost,
      MYSQL_PORT: String(mysqlPort),
      ALLOW_INSECURE_SESSION_SECRET: '1'
    }, 'mdm-platform');
    await waitForTcp('127.0.0.1', mdmPort, 'MDM');
    addCheck(summary, 'MDM service startup', { status: 'started', port: mdmPort, pid, logs: logDir });
  }

  if (await testTcp('127.0.0.1', pmoPort)) {
    addCheck(summary, 'PMO service startup', { status: 'already listening', port: pmoPort });
  } else {
    const pid = startDetached('npm.cmd', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(pmoPort), '--strictPort'], pmoDir, {}, 'pmo-gantt');
    await waitForTcp('127.0.0.1', pmoPort, 'PMO');
    addCheck(summary, 'PMO service startup', { status: 'started', port: pmoPort, pid, logs: logDir });
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

async function checkMdm(summary, mdmBaseUrl) {
  const adminEmployeeNo = process.env.MDM_ADMIN_EMPLOYEE_NO;
  const adminPassword = process.env.MDM_ADMIN_PASSWORD;
  assert.ok(adminEmployeeNo, 'Missing MDM_ADMIN_EMPLOYEE_NO for login smoke');
  assert.ok(adminPassword, 'Missing MDM_ADMIN_PASSWORD for login smoke');

  const health = await requireJson(`${mdmBaseUrl}/api/health`);
  assert.equal(health.body.status, 'ok', 'MDM health endpoint did not return ok');
  addCheck(summary, 'MDM health', { status: health.body.status });

  const login = await requireJson(`${mdmBaseUrl}/api/org/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_no: adminEmployeeNo, password: adminPassword })
  });
  const cookie = extractCookie(login.response);
  addCheck(summary, 'MDM admin login', {
    employee_no: adminEmployeeNo,
    user: login.body.name || null,
    role: login.body.role || null
  });

  const authedHeaders = { Cookie: cookie };
  const me = await requireJson(`${mdmBaseUrl}/api/org/me`, { headers: authedHeaders });
  assert.equal(me.body.id > 0, true, 'MDM /api/org/me did not return a valid user');
  addCheck(summary, 'MDM current user', {
    displayName: me.body.name || null,
    role: me.body.role || null,
    roles: me.body.roleCodes || []
  });

  const departments = await requireJson(`${mdmBaseUrl}/api/org/departments`, { headers: authedHeaders });
  const departmentCount = countRows(departments.body);
  assert.ok(departmentCount > 0, 'MDM departments are empty');
  addCheck(summary, 'MDM departments', { count: departmentCount });

  const users = await requireJson(`${mdmBaseUrl}/api/org/users`, { headers: authedHeaders });
  const userCount = countRows(users.body);
  assert.ok(userCount > 0, 'MDM users are empty');
  addCheck(summary, 'MDM users', { count: userCount });

  const roles = await requireJson(`${mdmBaseUrl}/api/roles`, { headers: authedHeaders });
  const roleCount = countRows(roles.body);
  assert.ok(roleCount > 0, 'MDM roles are empty');
  addCheck(summary, 'MDM roles', { count: roleCount });

  const workbench = await requireJson(`${mdmBaseUrl}/api/role-workbench?mode=todo`, { headers: authedHeaders });
  addCheck(summary, 'MDM role workbench', {
    roles: countRows(workbench.body.roles || []),
    todos: countRows(workbench.body.todos || [])
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

  const dataMapContexts = await requireJson(`${mdmBaseUrl}/api/data-map/contexts`, { headers: authedHeaders });
  addCheck(summary, 'MDM data map contexts', { count: countRows(dataMapContexts.body) });

  const terminologyTypes = await requireJson(`${mdmBaseUrl}/api/terminology/types`, { headers: authedHeaders });
  addCheck(summary, 'MDM terminology types', { count: countRows(terminologyTypes.body) });
}

async function main() {
  const mdmBaseUrl = trimSlash(process.env.INFOMAT_MDM_URL || DEFAULT_MDM_URL);
  const pmoBaseUrl = trimSlash(process.env.INFOMAT_PMO_URL || DEFAULT_PMO_URL);
  const shouldStart = process.argv.includes('--start');
  const summary = {
    ok: true,
    mdmBaseUrl,
    pmoBaseUrl,
    readModels: {
      identity: process.env.MDM_IDENTITY_READ_MODEL || 'sqlite',
      processGovernance: process.env.PROCESS_GOVERNANCE_READ_MODEL || 'sqlite'
    },
    checks: []
  };

  try {
    if (shouldStart) {
      await ensureServices(summary, mdmBaseUrl, pmoBaseUrl);
    }
    await checkPmo(summary, pmoBaseUrl);
    await checkMdm(summary, mdmBaseUrl);
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
