const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const fixedConfigPath = path.join(repoRoot, 'scripts', 'infomat-services.config.json');
const localEnvPath = path.join(repoRoot, 'scripts', 'infomat-services.local.env');

const ROLE_WORKBENCH_P95_LIMIT_MS = Number(process.env.ROLE_WORKBENCH_P95_LIMIT_MS || 250);
const LOGIN_P95_LIMIT_MS = Number(process.env.LOGIN_P95_LIMIT_MS || 500);
const VIRTUAL_USERS = Number(process.env.MDM_PERF_USERS || 10);
const ROUNDS = Number(process.env.MDM_PERF_ROUNDS || 5);
const TIMEOUT_MS = Number(process.env.MDM_PERF_TIMEOUT_MS || 8000);

const READ_ENDPOINTS = [
  { key: 'org_me', method: 'GET', path: '/api/org/me' },
  { key: 'role_workbench_todo', method: 'GET', path: '/api/role-workbench?mode=todo' },
  { key: 'role_workbench_all', method: 'GET', path: '/api/role-workbench?mode=all' },
  { key: 'process_governance_sankey', method: 'GET', path: '/api/process-governance/sankey?cap_levels=L1,L2,L3' },
  { key: 'activity_heatmap', method: 'GET', path: '/api/activity/heatmap?scope=me&days=30' }
];

function readFixedConfig() {
  if (!fs.existsSync(fixedConfigPath)) {
    throw new Error(`Missing fixed service config: ${fixedConfigPath}`);
  }
  return JSON.parse(fs.readFileSync(fixedConfigPath, 'utf8'));
}

function parseLocalEnv(text) {
  const values = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const splitAt = trimmed.indexOf('=');
    if (splitAt <= 0) continue;
    values[trimmed.slice(0, splitAt).trim()] = trimmed.slice(splitAt + 1).trim();
  }
  return values;
}

function loadLocalEnv() {
  if (!fs.existsSync(localEnvPath)) return {};
  return parseLocalEnv(fs.readFileSync(localEnvPath, 'utf8'));
}

function requireFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('This performance script requires a Node.js runtime with global fetch.');
  }
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return Math.round(sorted[index]);
}

function average(values) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function statusBucket(status) {
  return status ? String(status) : 'network_error';
}

function firstSessionCookie(response) {
  const header = response.headers.get('set-cookie');
  if (!header) return '';
  return header.split(';')[0] || '';
}

function makeMetrics() {
  return {
    requests: 0,
    failures: 0,
    status_codes: {},
    durations: [],
    bytes: 0
  };
}

function record(metrics, result) {
  metrics.requests += 1;
  if (!result.ok) metrics.failures += 1;
  const bucket = statusBucket(result.status);
  metrics.status_codes[bucket] = (metrics.status_codes[bucket] || 0) + 1;
  if (Number.isFinite(result.durationMs)) metrics.durations.push(result.durationMs);
  metrics.bytes += result.bytes || 0;
}

function summarize(metrics) {
  const successes = metrics.requests - metrics.failures;
  return {
    requests: metrics.requests,
    failures: metrics.failures,
    availability_percent: metrics.requests ? Number(((successes / metrics.requests) * 100).toFixed(2)) : 0,
    status_codes: metrics.status_codes,
    latency_ms: {
      avg: average(metrics.durations),
      p50: percentile(metrics.durations, 0.5),
      p95: percentile(metrics.durations, 0.95),
      max: metrics.durations.length ? Math.round(Math.max(...metrics.durations)) : null
    },
    response_kb: Number((metrics.bytes / 1024).toFixed(2))
  };
}

async function timedFetch(baseUrl, requestPath, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const response = await fetch(new URL(requestPath, baseUrl), {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      durationMs: performance.now() - started,
      bytes: Buffer.byteLength(text || '', 'utf8'),
      response,
      text
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: performance.now() - started,
      bytes: 0,
      error: error && error.name || 'request_error'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function login(baseUrl, employeeNo, passwordValue) {
  return await timedFetch(baseUrl, '/api/org/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_no: employeeNo, password: passwordValue })
  });
}

async function loginUser(baseUrl, employeeNo, passwordValue, metrics) {
  const result = await login(baseUrl, employeeNo, passwordValue);
  const sessionHeader = result.response ? firstSessionCookie(result.response) : '';
  record(metrics, { ...result, ok: result.ok && Boolean(sessionHeader) });
  return result.ok && sessionHeader ? sessionHeader : null;
}

async function getJson(baseUrl, endpoint, sessionHeader) {
  return await timedFetch(baseUrl, endpoint.path, {
    method: endpoint.method,
    headers: { Cookie: sessionHeader }
  });
}

async function warmup(baseUrl, employeeNo, passwordValue) {
  const loginResult = await login(baseUrl, employeeNo, passwordValue);
  if (!loginResult.ok || !loginResult.response) return;
  const sessionHeader = firstSessionCookie(loginResult.response);
  if (!sessionHeader) return;
  for (const endpoint of READ_ENDPOINTS) {
    await getJson(baseUrl, endpoint, sessionHeader);
  }
}

function buildThresholdChecks(endpointMetrics) {
  const failures = [];
  const loginP95 = endpointMetrics.login.latency_ms.p95;
  const todoP95 = endpointMetrics.role_workbench_todo.latency_ms.p95;
  const allP95 = endpointMetrics.role_workbench_all.latency_ms.p95;

  if (loginP95 === null || loginP95 > LOGIN_P95_LIMIT_MS) {
    failures.push(`login p95 ${loginP95}ms exceeds ${LOGIN_P95_LIMIT_MS}ms`);
  }
  if (todoP95 === null || todoP95 > ROLE_WORKBENCH_P95_LIMIT_MS) {
    failures.push(`role workbench todo p95 ${todoP95}ms exceeds ${ROLE_WORKBENCH_P95_LIMIT_MS}ms`);
  }
  if (allP95 === null || allP95 > ROLE_WORKBENCH_P95_LIMIT_MS) {
    failures.push(`role workbench all p95 ${allP95}ms exceeds ${ROLE_WORKBENCH_P95_LIMIT_MS}ms`);
  }

  for (const [key, metrics] of Object.entries(endpointMetrics)) {
    if (metrics.failures > 0 || metrics.availability_percent < 100) {
      failures.push(`${key} availability ${metrics.availability_percent}% with ${metrics.failures} failures`);
    }
  }

  return {
    passed: failures.length === 0,
    failures
  };
}

async function main() {
  requireFetch();
  const fixedConfig = readFixedConfig();
  const localEnv = loadLocalEnv();
  const baseUrl = process.env.INFOMAT_MDM_URL || `http://${fixedConfig.mdm.host}:${fixedConfig.mdm.port}`;
  const employeeNo = process.env.MDM_ADMIN_EMPLOYEE_NO || fixedConfig.admin.employeeNo;
  const passwordValue = process.env.MDM_ADMIN_PASSWORD || localEnv.MDM_ADMIN_PASSWORD;

  if (!passwordValue) {
    throw new Error('Missing MDM_ADMIN_PASSWORD in environment or scripts/infomat-services.local.env.');
  }

  await warmup(baseUrl, employeeNo, passwordValue);

  const metricStores = {
    login: makeMetrics()
  };
  for (const endpoint of READ_ENDPOINTS) metricStores[endpoint.key] = makeMetrics();

  const sessions = await Promise.all(
    Array.from({ length: VIRTUAL_USERS }, () => loginUser(baseUrl, employeeNo, passwordValue, metricStores.login))
  );
  const activeSessions = sessions.filter(Boolean);

  await Promise.all(activeSessions.map(async sessionHeader => {
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const endpoint of READ_ENDPOINTS) {
        const result = await getJson(baseUrl, endpoint, sessionHeader);
        record(metricStores[endpoint.key], result);
      }
    }
  }));

  const endpointMetrics = Object.fromEntries(
    Object.entries(metricStores).map(([key, metrics]) => [key, summarize(metrics)])
  );
  const overallStore = makeMetrics();
  for (const metrics of Object.values(metricStores)) {
    overallStore.requests += metrics.requests;
    overallStore.failures += metrics.failures;
    overallStore.bytes += metrics.bytes;
    overallStore.durations.push(...metrics.durations);
    for (const [status, count] of Object.entries(metrics.status_codes)) {
      overallStore.status_codes[status] = (overallStore.status_codes[status] || 0) + count;
    }
  }

  const checks = buildThresholdChecks(endpointMetrics);
  const report = {
    scenario: {
      target: 'local MDM 10-user concurrency',
      base_url: baseUrl,
      virtual_users: VIRTUAL_USERS,
      rounds: ROUNDS,
      timeout_ms: TIMEOUT_MS,
      warmup: true,
      thresholds: {
        LOGIN_P95_LIMIT_MS,
        ROLE_WORKBENCH_P95_LIMIT_MS
      }
    },
    overall: summarize(overallStore),
    endpoint_metrics: endpointMetrics,
    checks
  };

  console.log(JSON.stringify(report, null, 2));
  if (!checks.passed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
