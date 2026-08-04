import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const localEnvPath = path.join(scriptDir, 'structure-pilot.local.env');

function parseLocalEnv(text) {
  const result = {};
  for (const sourceLine of String(text || '').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const splitAt = line.indexOf('=');
    if (splitAt <= 0) continue;
    const key = line.slice(0, splitAt).trim();
    let value = line.slice(splitAt + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const localEnv = fs.existsSync(localEnvPath)
  ? parseLocalEnv(fs.readFileSync(localEnvPath, 'utf8'))
  : {};
const env = { ...localEnv, ...process.env };
const baseUrl = String(env.STRUCTURE_ASSISTANT_SMOKE_BASE_URL || '').replace(/\/+$/, '');
const username = env.STRUCTURE_ASSISTANT_SMOKE_USERNAME || 'zhangguangyi';
const password = env.STRUCTURE_ASSISTANT_SMOKE_PASSWORD || '';
assert.ok(baseUrl.startsWith('https://'), 'STRUCTURE_ASSISTANT_SMOKE_BASE_URL must be an HTTPS URL.');
assert.ok(password, 'STRUCTURE_ASSISTANT_SMOKE_PASSWORD is required.');

const ca = env.STRUCTURE_ASSISTANT_SMOKE_CA_PATH
  ? fs.readFileSync(path.resolve(env.STRUCTURE_ASSISTANT_SMOKE_CA_PATH))
  : undefined;
const agent = new https.Agent({
  ca,
  rejectUnauthorized: true
});

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = options.body == null ? null : JSON.stringify(options.body);
    const req = https.request(target, {
      method: options.method || 'GET',
      agent,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(options.headers || {})
      }
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        text += chunk;
      });
      response.on('end', () => {
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        resolve({ response, body: parsed, text });
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error(`Timeout: ${url}`)));
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function cookieFrom(response) {
  const raw = response.headers['set-cookie']?.[0] || '';
  const cookie = raw.split(';')[0];
  assert.ok(cookie, 'Login did not return an authentication cookie.');
  return cookie;
}

async function requireOk(url, options) {
  const result = await request(url, options);
  assert.ok(
    result.response.statusCode >= 200 && result.response.statusCode < 300,
    `${url} returned ${result.response.statusCode}: ${result.text.slice(0, 300)}`
  );
  return result;
}

const login = await requireOk(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  body: { username, password }
});
assert.equal(login.body.user.role, 'admin', 'Release smoke must use the Zhang Guangyi administrator account.');
const cookie = cookieFrom(login.response);
const csrf = login.body.user.csrfToken;
const authHeaders = { Cookie: cookie };

const context = await requireOk(`${baseUrl}/api/context`, { headers: authHeaders });
assert.equal(context.body.schema_version, 'process-governance-v1');
assert.match(context.body.schema_digest, /^[a-f0-9]{64}$/);
assert.match(context.body.app_commit, /^[a-f0-9]{40}$/);
assert.equal(context.body.maintenance_mode.enabled, false);

const template = await requireOk(`${baseUrl}/api/template`, { headers: authHeaders });
assert.equal(template.body.schema_digest, context.body.schema_digest);
assert.equal(template.body.app_commit, context.body.app_commit);
assert.equal(template.body.data.schema_version, 'process-governance-v1');

const validation = await requireOk(`${baseUrl}/api/document/validate`, {
  method: 'POST',
  headers: { ...authHeaders, 'X-CSRF-Token': csrf },
  body: {
    expected_version: {
      app_commit: context.body.app_commit,
      schema_digest: context.body.schema_digest
    },
    document: template.body.data
  }
});
assert.equal(validation.body.valid, true);

const balance = await requireOk(`${baseUrl}/api/account/balance`, { headers: authHeaders });
assert.equal(typeof balance.body.isAvailable, 'boolean');

const adminStatus = await requireOk(`${baseUrl}/api/admin/status`, { headers: authHeaders });
assert.equal(adminStatus.body.balances.length, 4);
assert.equal(adminStatus.body.balances.every(item => item.keyConfigured), true);
assert.equal(adminStatus.body.balances.every(item => !item.error), true);

const gatewaySchemaUrl = new URL('/api/schema', context.body.structured_tool_url).toString();
const gatewaySchema = await requireOk(gatewaySchemaUrl, { headers: authHeaders });
assert.equal(gatewaySchema.body.properties.schema_version.const, 'process-governance-v1');

const repositoryCommit = (
  await import('node:child_process')
).execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true
}).trim();
assert.equal(context.body.app_commit, repositoryCommit);

console.log(JSON.stringify({
  ok: true,
  user: login.body.user.displayName,
  appCommit: context.body.app_commit,
  schemaVersion: context.body.schema_version,
  schemaDigest: context.body.schema_digest,
  balanceAvailable: balance.body.isAvailable,
  configuredAccountCount: adminStatus.body.balances.length,
  lowBalanceAccounts: adminStatus.body.balances
    .filter(item => item.warning)
    .map(item => item.displayName),
  structuredToolGateway: context.body.structured_tool_url
}, null, 2));
console.log('structure pilot smoke passed');
