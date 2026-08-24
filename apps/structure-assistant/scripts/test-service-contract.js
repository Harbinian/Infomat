'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { app: structuredOutputApp } = require('../../structured-output-service/server');
const { hashPassword } = require('../lib/auth');
const { AppError } = require('../lib/errors');
const { createApiKeyStore, keyFingerprint, normalizeApiKey } = require('../lib/api-key-store');
const { repositoryState } = require('../lib/repository');
const { createStructuredToolClient } = require('../lib/structured-tool');
const { applyRestrictedPatch } = require('../lib/json-patch');
const { createDeepSeekClient } = require('../lib/deepseek');
const { createAssistantRuntime, createGatewayHandler, createDshGatewayHandler } = require('../server');

const appRoot = path.join(__dirname, '..');
const repoRoot = path.join(appRoot, '..', '..');
const frontendPath = path.join(appRoot, 'public', 'index.html');
const frontendScriptPath = path.join(appRoot, 'public', 'app.js');
const configPath = path.join(appRoot, 'config', 'pilot.config.json');

async function listen(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}

async function rawStatus(baseUrl, route, headers = {}) {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: route,
      method: 'GET',
      headers
    }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
}

function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || '';
  const cookie = raw.split(';')[0];
  assert.ok(cookie, 'login must return a cookie');
  return cookie;
}

async function readJson(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  return { response, body, text };
}

async function login(baseUrl, username, password) {
  const result = await readJson(await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  }));
  assert.equal(result.response.status, 200, result.text);
  return {
    cookie: cookieFrom(result.response),
    csrf: result.body.user.csrfToken,
    user: result.body.user
  };
}

async function authedJson(baseUrl, route, auth, options = {}) {
  const headers = {
    Cookie: auth.cookie,
    Accept: 'application/json',
    ...(options.headers || {})
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = auth.csrf;
  }
  return readJson(await fetch(`${baseUrl}${route}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  }));
}

function createTestConfig(structuredToolBaseUrl, runtimeDir) {
  const fixed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const passwordHash = hashPassword('Pilot-Test-Password-2026');
  return {
    appRoot,
    repoRoot,
    configPath,
    assistant: {
      host: '127.0.0.1',
      port: 0,
      gatewayPort: 3004,
      structuredToolBaseUrl
    },
    security: {
      ...fixed.security,
      allowHttp: true,
      allowDirty: true,
      sessionSecret: 'test-session-secret-with-sufficient-length',
      tlsCertPath: '',
      tlsKeyPath: ''
    },
    deepseek: fixed.deepseek,
    accounts: fixed.accounts.map(account => ({
      ...account,
      passwordHash
    })),
    runtime: {
      dir: runtimeDir,
      usageLogPath: path.join(runtimeDir, 'usage-metadata.jsonl'),
      maintenancePath: path.join(runtimeDir, 'maintenance.json')
    }
  };
}

function createFakeModelClient() {
  const calls = [];
  const balanceCalls = [];
  let invalidFillOnce = false;
  return {
    calls,
    balanceCalls,
    setInvalidFillOnce() {
      invalidFillOnce = true;
    },
    async completion(options) {
      calls.push({
        apiKey: options.apiKey,
        model: options.model,
        thinking: options.thinking,
        reasoningEffort: options.reasoningEffort,
        messages: options.messages
      });
      if (options.apiKey === 'revoked-api-key') {
        throw new AppError(502, 'MODEL_AUTH_FAILED', '当前账号的DeepSeek接口密钥不可用。');
      }
      const isReview = options.thinking === true;
      if (!isReview && invalidFillOnce) {
        invalidFillOnce = false;
        return {
          content: '',
          finishReason: 'stop',
          usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
          transportAttempts: 1
        };
      }
      if (isReview) {
        const userContent = options.messages.findLast(item => item.role === 'user')?.content || '';
        const invalidDocument = /\"keyword\": \"required\"/.test(userContent);
        return {
          content: JSON.stringify({
            summary: invalidDocument ? '发现硬性结构错误。' : '发现一项字段归位建议。',
            hard_error_fixes: invalidDocument ? [{
              error_index: 0,
              title: '补回流程对象',
              explanation: 'process是根级必需对象。',
              patch: [{
                op: 'add',
                path: '/process',
                value: {
                  process_ref: 'process_repaired',
                  process_name: '',
                  owning_department: '',
                  purpose: '',
                  scope: '',
                  capability_domain: null,
                  business_capability: null,
                  classification_status: 'unclassified'
                }
              }]
            }] : [],
            suggestions: invalidDocument ? [] : [{
              category: 'field_placement',
              path: '/process/scope',
              title: '核对适用范围字段',
              explanation: '该项只检查文字是否放在适用范围字段。',
              patch: [{ op: 'replace', path: '/process/scope', value: '公司内部试点范围' }]
            }]
          }),
          finishReason: 'stop',
          usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
          transportAttempts: 1
        };
      }
      return {
        content: JSON.stringify({
          assistant_message: '已按当前结构写入流程名称，请继续确认适用范围。',
          questions: [
            { path: '/process/scope', question: '这条流程适用于哪些事项？' },
            { path: '/forms', question: '这条流程使用哪些表单或记录？' }
          ],
          patch: [{ op: 'replace', path: '/process/process_name', value: '费用申请流程' }],
          field_statuses: [{
            path: '/process/process_name',
            status: 'confirmed',
            note: '用户已明确'
          }]
        }),
        finishReason: 'stop',
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        transportAttempts: 1
      };
    },
    async balance(apiKey) {
      balanceCalls.push(apiKey);
      if (apiKey === 'invalid-api-key') {
        throw new AppError(502, 'MODEL_AUTH_FAILED', '当前账号的DeepSeek接口密钥不可用。');
      }
      if (apiKey === 'balance-network-error-api-key') {
        throw new AppError(502, 'BALANCE_UNAVAILABLE', 'DeepSeek余额暂时无法查询。');
      }
      if (apiKey === 'insufficient-balance-api-key') {
        throw new AppError(402, 'MODEL_BALANCE_INSUFFICIENT', '当前DeepSeek账号余额不足。');
      }
      const totalBalance = apiKey === 'low-balance-api-key' ? 10 : 199;
      return {
        isAvailable: true,
        currency: 'CNY',
        totalBalance,
        toppedUpBalance: totalBalance,
        grantedBalance: 0
      };
    }
  };
}

function createFakeDshRuntimeManager() {
  let running = false;
  let starts = 0;
  let stops = 0;
  let target = null;
  return {
    get starts() {
      return starts;
    },
    get stops() {
      return stops;
    },
    setTarget(nextTarget) {
      target = nextTarget;
    },
    publicStatus(payload) {
      return {
        status: running ? 'running' : 'stopped',
        dsh_version: '0.1.0-rc.6',
        workspace_count: 0,
        expires_at: new Date(payload.exp * 1000).toISOString()
      };
    },
    async start(payload) {
      starts += 1;
      running = true;
      return this.publicStatus(payload);
    },
    async stop(payload) {
      stops += 1;
      running = false;
      return this.publicStatus(payload);
    },
    accountStatuses(accounts) {
      return accounts.map(account => ({
        account_id: account.id,
        display_name: account.displayName,
        active_dsh_runtimes: running ? 1 : 0
      }));
    },
    getRuntimeTarget() {
      return running ? target : null;
    }
  };
}

function testApiKeyStore() {
  let current = Date.parse('2026-08-15T00:00:00.000Z');
  const store = createApiKeyStore({
    now: () => current,
    setTimeout: () => ({ unref() {} }),
    clearTimeout() {}
  });
  const payload = {
    sub: 'dingshuo',
    nonce: 'session-one',
    exp: Math.floor((current + 60_000) / 1000)
  };
  const entry = store.bind(payload, '  test-api-key  ');
  assert.equal(entry.apiKey, 'test-api-key');
  assert.equal(entry.fingerprint, keyFingerprint('test-api-key'));
  assert.equal(store.publicStatus(payload).configured, true);
  assert.equal(store.accountStatuses([{ id: 'dingshuo', displayName: '丁硕' }])[0].active_key_sessions, 1);
  current += 61_000;
  assert.equal(store.get(payload), null, 'expired session key must be removed');
  assert.equal(store.accountStatuses([{ id: 'dingshuo', displayName: '丁硕' }])[0].active_key_sessions, 0);
  assert.equal(createApiKeyStore().accountStatuses([{ id: 'dingshuo', displayName: '丁硕' }])[0].key_configured, false);
  assert.equal(normalizeApiKey(' value '), 'value');
  assert.throws(() => normalizeApiKey(''), error => error.code === 'API_KEY_INVALID_INPUT');
  assert.throws(() => normalizeApiKey(`test\nkey`), error => error.code === 'API_KEY_INVALID_INPUT');
  assert.throws(() => normalizeApiKey('x'.repeat(513)), error => error.code === 'API_KEY_INVALID_INPUT');
}

async function testAssistantApi() {
  const structuredServer = await listen(structuredOutputApp);
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structure-assistant-test-'));
  const repoState = repositoryState(repoRoot);
  const fakeModel = createFakeModelClient();
  const config = createTestConfig(structuredServer.baseUrl, runtimeDir);
  const structuredTool = createStructuredToolClient({
    baseUrl: structuredServer.baseUrl,
    appCommit: repoState.commit
  });
  const fakeDshRuntimeManager = createFakeDshRuntimeManager();
  const runtime = createAssistantRuntime({
    config,
    repoState,
    appCommit: repoState.commit,
    modelClient: fakeModel,
    structuredTool,
    dshRuntimeManager: fakeDshRuntimeManager
  });
  const assistantServer = await listen(runtime.app);
  try {
    const diagramRenderer = await fetch(`${assistantServer.baseUrl}/assets/3001/process-diagram.js`);
    assert.equal(diagramRenderer.status, 200);
    assert.match(await diagramRenderer.text(), /root\.ProcessDiagram = api/);
    const cytoscapeAsset = await fetch(`${assistantServer.baseUrl}/assets/3001/cytoscape.min.js`);
    assert.equal(cytoscapeAsset.status, 200);
    assert.ok((await cytoscapeAsset.text()).length > 100000);

    const unauthenticated = await fetch(`${assistantServer.baseUrl}/api/context`);
    assert.equal(unauthenticated.status, 401);
    const noSession = await fetch(`${assistantServer.baseUrl}/api/auth/me`);
    assert.equal(noSession.status, 200);
    assert.deepEqual(await noSession.json(), { authenticated: false });

    const auth = await login(
      assistantServer.baseUrl,
      'zhangguangyi',
      'Pilot-Test-Password-2026'
    );
    assert.equal(auth.user.displayName, '张广懿');
    assert.equal(auth.user.role, 'admin');

    const contextResult = await authedJson(assistantServer.baseUrl, '/api/context', auth);
    assert.equal(contextResult.response.status, 200);
    assert.equal(contextResult.response.headers.get('cache-control'), 'no-store');
    assert.equal(contextResult.body.app_commit, repoState.commit);
    assert.equal(contextResult.body.schema_version, 'process-governance-v5');
    assert.match(contextResult.body.schema_digest, /^[a-f0-9]{64}$/);
    assert.equal(contextResult.body.entry_mode, 'dsh');
    assert.equal(contextResult.body.dsh_version, '0.1.0-rc.6');
    assert.equal(contextResult.body.dsh_available, true);
    assert.equal(Object.prototype.hasOwnProperty.call(contextResult.body, 'apiKey'), false);

    const dshStatus = await authedJson(assistantServer.baseUrl, '/api/dsh/runtime', auth);
    assert.equal(dshStatus.response.status, 200);
    assert.deepEqual(Object.keys(dshStatus.body).sort(), [
      'dsh_version',
      'expires_at',
      'status',
      'workspace_count'
    ]);
    assert.equal(dshStatus.body.status, 'stopped');
    assert.equal(dshStatus.body.dsh_version, '0.1.0-rc.6');
    assert.equal(dshStatus.body.workspace_count, 0);
    const missingDshCsrf = await readJson(await fetch(`${assistantServer.baseUrl}/api/dsh/runtime`, {
      method: 'POST',
      headers: { Cookie: auth.cookie }
    }));
    assert.equal(missingDshCsrf.response.status, 403);
    const startedDsh = await authedJson(assistantServer.baseUrl, '/api/dsh/runtime', auth, {
      method: 'POST',
      body: {}
    });
    assert.equal(startedDsh.response.status, 200);
    assert.equal(startedDsh.body.status, 'running');
    assert.equal(startedDsh.body.entry_url, 'http://127.0.0.1:3004/');
    assert.equal(fakeDshRuntimeManager.starts, 1);
    const stoppedDsh = await authedJson(assistantServer.baseUrl, '/api/dsh/runtime', auth, {
      method: 'DELETE',
      body: {}
    });
    assert.equal(stoppedDsh.response.status, 200);
    assert.equal(stoppedDsh.body.status, 'stopped');
    assert.equal(fakeDshRuntimeManager.stops, 1);

    const pilotUserAuth = await login(
      assistantServer.baseUrl,
      'dingshuo',
      'Pilot-Test-Password-2026'
    );
    const forbiddenEntryMode = await authedJson(
      assistantServer.baseUrl,
      '/api/admin/entry-mode',
      pilotUserAuth,
      { method: 'PUT', body: { mode: 'classic', reason: '测试切换' } }
    );
    assert.equal(forbiddenEntryMode.response.status, 403);
    const missingEntryReason = await authedJson(assistantServer.baseUrl, '/api/admin/entry-mode', auth, {
      method: 'PUT',
      body: { mode: 'classic', reason: '' }
    });
    assert.equal(missingEntryReason.response.status, 400);
    assert.equal(missingEntryReason.body.code, 'ENTRY_MODE_REASON_REQUIRED');
    const classicEntryMode = await authedJson(assistantServer.baseUrl, '/api/admin/entry-mode', auth, {
      method: 'PUT',
      body: { mode: 'classic', reason: 'DSH兼容门禁演练' }
    });
    assert.equal(classicEntryMode.response.status, 200);
    assert.equal(classicEntryMode.body.entry_mode.mode, 'classic');
    const blockedDshStart = await authedJson(assistantServer.baseUrl, '/api/dsh/runtime', auth, {
      method: 'POST',
      body: {}
    });
    assert.equal(blockedDshStart.response.status, 409);
    assert.equal(blockedDshStart.body.code, 'ENTRY_MODE_CLASSIC');
    const dshEntryMode = await authedJson(assistantServer.baseUrl, '/api/admin/entry-mode', auth, {
      method: 'PUT',
      body: { mode: 'dsh', reason: 'DSH兼容门禁通过' }
    });
    assert.equal(dshEntryMode.response.status, 200);
    assert.equal(dshEntryMode.body.entry_mode.mode, 'dsh');
    const expected = {
      app_commit: contextResult.body.app_commit,
      schema_digest: contextResult.body.schema_digest
    };

    const templateResult = await authedJson(assistantServer.baseUrl, '/api/template', auth);
    assert.equal(templateResult.response.status, 200);
    assert.equal(templateResult.body.data.schema_version, 'process-governance-v5');
    const draft = templateResult.body.data;

    const missingConsent = await authedJson(assistantServer.baseUrl, '/api/source/paste', auth, {
      method: 'POST',
      body: { text: '申请人提交材料。', authorized: false, deidentified: true }
    });
    assert.equal(missingConsent.response.status, 400);
    assert.equal(missingConsent.body.code, 'SOURCE_CONFIRMATION_REQUIRED');

    const pasted = await authedJson(assistantServer.baseUrl, '/api/source/paste', auth, {
      method: 'POST',
      body: { text: '申请人提交材料。', authorized: true, deidentified: true }
    });
    assert.equal(pasted.response.status, 200);
    assert.equal(pasted.body.material.readable_text, '申请人提交材料。');

    const wrongVersionCallCount = fakeModel.calls.length;
    const wrongVersion = await authedJson(assistantServer.baseUrl, '/api/fill/turn', auth, {
      method: 'POST',
      body: {
        expected_version: { ...expected, schema_digest: '0'.repeat(64) },
        document: draft,
        source_materials: [pasted.body.material],
        messages: [],
        user_message: '流程名称是费用申请流程。'
      }
    });
    assert.equal(wrongVersion.response.status, 409);
    assert.equal(wrongVersion.body.code, 'VERSION_CHANGED');
    assert.equal(fakeModel.calls.length, wrongVersionCallCount, 'version mismatch must block before model call');

    const missingTurnConsentCallCount = fakeModel.calls.length;
    const missingTurnConsent = await authedJson(assistantServer.baseUrl, '/api/fill/turn', auth, {
      method: 'POST',
      body: {
        expected_version: expected,
        document: draft,
        source_materials: [pasted.body.material],
        messages: [],
        user_message: '流程名称是费用申请流程。'
      }
    });
    assert.equal(missingTurnConsent.response.status, 400);
    assert.equal(missingTurnConsent.body.code, 'SOURCE_CONFIRMATION_REQUIRED');
    assert.equal(
      fakeModel.calls.length,
      missingTurnConsentCallCount,
      'source confirmation must be checked before the model call'
    );

    const initialKeyStatus = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth);
    assert.deepEqual(initialKeyStatus.body, {
      configured: false,
      fingerprint: null,
      configured_at: null,
      expires_at: null
    });
    const missingKeyCallCount = fakeModel.calls.length;
    const missingKeyBalanceCallCount = fakeModel.balanceCalls.length;
    const missingKey = await authedJson(assistantServer.baseUrl, '/api/fill/turn', auth, {
      method: 'POST',
      body: {
        expected_version: expected,
        document: draft,
        source_materials: [],
        source_authorized: true,
        source_deidentified: true,
        messages: [],
        user_message: '流程名称是费用申请流程。'
      }
    });
    assert.equal(missingKey.response.status, 428);
    assert.equal(missingKey.body.code, 'API_KEY_REQUIRED');
    assert.equal(fakeModel.calls.length, missingKeyCallCount, 'missing key must block before model call');
    const missingReviewKey = await authedJson(assistantServer.baseUrl, '/api/review/run', auth, {
      method: 'POST',
      body: { expected_version: expected, document: draft }
    });
    assert.equal(missingReviewKey.response.status, 428);
    assert.equal(missingReviewKey.body.code, 'API_KEY_REQUIRED');
    const missingBalanceKey = await authedJson(assistantServer.baseUrl, '/api/account/balance', auth);
    assert.equal(missingBalanceKey.response.status, 428);
    assert.equal(missingBalanceKey.body.code, 'API_KEY_REQUIRED');
    assert.equal(fakeModel.calls.length, missingKeyCallCount, 'missing key must block every model completion');
    assert.equal(
      fakeModel.balanceCalls.length,
      missingKeyBalanceCallCount,
      'missing key must block before the DeepSeek balance request'
    );

    const invalidKeyInput = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: '   ' }
    });
    assert.equal(invalidKeyInput.response.status, 400);
    assert.equal(invalidKeyInput.body.code, 'API_KEY_INVALID_INPUT');
    const nonStringKeyInput = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: { value: 'not-a-string' } }
    });
    assert.equal(nonStringKeyInput.response.status, 400);
    assert.equal(nonStringKeyInput.body.code, 'API_KEY_INVALID_INPUT');
    const controlCharacterKeyInput = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: 'key\u0000value' }
    });
    assert.equal(controlCharacterKeyInput.response.status, 400);
    assert.equal(controlCharacterKeyInput.body.code, 'API_KEY_INVALID_INPUT');
    const tooLongKeyInput = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: 'k'.repeat(513) }
    });
    assert.equal(tooLongKeyInput.response.status, 400);
    assert.equal(tooLongKeyInput.body.code, 'API_KEY_INVALID_INPUT');
    const invalidKey = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: 'invalid-api-key' }
    });
    assert.equal(invalidKey.response.status, 400);
    assert.equal(invalidKey.body.code, 'API_KEY_VERIFICATION_FAILED');
    const balanceNetworkFailure = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: 'balance-network-error-api-key' }
    });
    assert.equal(balanceNetworkFailure.response.status, 502);
    assert.equal(balanceNetworkFailure.body.code, 'BALANCE_UNAVAILABLE');
    assert.deepEqual(
      (await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth)).body,
      { configured: false, fingerprint: null, configured_at: null, expires_at: null }
    );

    const insufficientBalanceKey = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: 'insufficient-balance-api-key' }
    });
    assert.equal(insufficientBalanceKey.response.status, 200, insufficientBalanceKey.text);
    assert.equal(insufficientBalanceKey.body.configured, true);
    assert.equal(insufficientBalanceKey.body.balance.insufficient, true);
    assert.equal(insufficientBalanceKey.body.balance.warning, true);
    assert.equal(insufficientBalanceKey.text.includes('insufficient-balance-api-key'), false);

    const lowBalanceKey = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: 'low-balance-api-key' }
    });
    assert.equal(lowBalanceKey.response.status, 200, lowBalanceKey.text);
    assert.equal(lowBalanceKey.body.balance.warning, true);
    assert.equal(lowBalanceKey.body.balance.totalBalance, 10);
    assert.match(lowBalanceKey.body.fingerprint, /^SHA-256: [a-f0-9]{12}$/);
    assert.equal(lowBalanceKey.text.includes('low-balance-api-key'), false);

    const configuredKey = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: 'test-api-key-1' }
    });
    assert.equal(configuredKey.response.status, 200, configuredKey.text);
    assert.equal(configuredKey.body.configured, true);
    assert.equal(configuredKey.body.balance.warning, false);
    assert.equal(configuredKey.text.includes('test-api-key-1'), false);
    assert.equal(configuredKey.response.headers.get('set-cookie'), null, 'key binding must not write a cookie');
    const configuredKeyStatus = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth);
    assert.equal(configuredKeyStatus.body.fingerprint, configuredKey.body.fingerprint);
    assert.match(configuredKeyStatus.body.configured_at, /^2026-|^20\d{2}-/);
    assert.match(configuredKeyStatus.body.expires_at, /^2026-|^20\d{2}-/);
    const retainedFingerprint = configuredKeyStatus.body.fingerprint;
    const rejectedReplacement = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: 'invalid-api-key' }
    });
    assert.equal(rejectedReplacement.response.status, 400);
    assert.equal(rejectedReplacement.body.code, 'API_KEY_VERIFICATION_FAILED');
    assert.equal(
      (await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth)).body.fingerprint,
      retainedFingerprint,
      'a failed replacement must preserve the previously verified session key'
    );

    const secondAuth = await login(
      assistantServer.baseUrl,
      'zhangguangyi',
      'Pilot-Test-Password-2026'
    );
    assert.deepEqual(
      (await authedJson(assistantServer.baseUrl, '/api/account/api-key', secondAuth)).body,
      { configured: false, fingerprint: null, configured_at: null, expires_at: null },
      'separate login sessions must not share keys'
    );

    fakeModel.setInvalidFillOnce();
    const fill = await authedJson(assistantServer.baseUrl, '/api/fill/turn', auth, {
      method: 'POST',
      body: {
        expected_version: expected,
        document: draft,
        source_materials: [],
        source_authorized: true,
        source_deidentified: true,
        messages: [],
        field_statuses: [{
          path: '/forms',
          status: 'not_applicable',
          note: '用户已明确当前没有表单或记录'
        }],
        user_message: '流程名称是费用申请流程。'
      }
    });
    assert.equal(fill.response.status, 200, fill.text);
    assert.equal(fill.body.document.process.process_name, '费用申请流程');
    assert.equal(fill.body.validation.valid, true);
    assert.equal(fill.body.questions.length, 1, 'fill dialogue must return only one main question');
    assert.equal(fill.body.questions[0].path, '/process/scope');
    assert.equal(fill.body.usage.total_tokens, 60, 'empty JSON response must be repaired once');
    const fillCalls = fakeModel.calls.filter(call => call.model === 'deepseek-v4-pro' && call.thinking === false);
    assert.equal(fillCalls.length, 2);
    assert.equal(fillCalls.every(call => call.apiKey === 'test-api-key-1'), true);
    assert.equal(fillCalls.every(call => call.thinking === false), true);
    const fillSystem = fillCalls[0].messages.find(call => call.role === 'system')?.content || '';
    const fillUser = fillCalls[0].messages.find(call => call.role === 'user')?.content || '';
    assert.match(fillSystem, /每轮questions只能提出一个主问题/);
    assert.match(fillSystem, /所有表单、台账和记录都要逐项确认/);
    assert.match(fillSystem, /数据来源和数据去向/);
    assert.match(fillUser, /当前结构校验错误/);
    assert.match(fillUser, /此前字段确认状态/);
    assert.match(fillUser, /not_applicable/);

    const review = await authedJson(assistantServer.baseUrl, '/api/review/run', auth, {
      method: 'POST',
      body: {
        expected_version: expected,
        document: fill.body.document
      }
    });
    assert.equal(review.response.status, 200, review.text);
    assert.equal(review.body.issues.length, 1);
    assert.equal(review.body.issues[0].severity, 'suggestion');
    assert.equal(
      fakeModel.calls.findLast(call => call.model === 'deepseek-v4-pro' && call.thinking === true).thinking,
      true
    );
    assert.equal(
      fakeModel.calls.findLast(call => call.model === 'deepseek-v4-pro' && call.thinking === true).reasoningEffort,
      'high'
    );

    const keepWithoutReason = await authedJson(assistantServer.baseUrl, '/api/review/apply', auth, {
      method: 'POST',
      body: {
        expected_version: expected,
        document: fill.body.document,
        issue: review.body.issues[0],
        action: 'keep',
        reason: ''
      }
    });
    assert.equal(keepWithoutReason.response.status, 400);
    assert.equal(keepWithoutReason.body.code, 'KEEP_REASON_REQUIRED');

    const keep = await authedJson(assistantServer.baseUrl, '/api/review/apply', auth, {
      method: 'POST',
      body: {
        expected_version: expected,
        document: fill.body.document,
        issue: review.body.issues[0],
        action: 'keep',
        reason: '当前文字已经由填报人员确认放在该字段。'
      }
    });
    assert.equal(keep.response.status, 200);
    assert.equal(keep.body.disposition.action, 'keep');

    const invalid = JSON.parse(JSON.stringify(fill.body.document));
    delete invalid.process;
    const invalidReview = await authedJson(assistantServer.baseUrl, '/api/review/run', auth, {
      method: 'POST',
      body: {
        expected_version: expected,
        document: invalid
      }
    });
    assert.equal(invalidReview.response.status, 200, invalidReview.text);
    const hardIssue = invalidReview.body.issues.find(issue => issue.severity === 'hard_error');
    assert.ok(hardIssue);
    const rejectHard = await authedJson(assistantServer.baseUrl, '/api/review/apply', auth, {
      method: 'POST',
      body: {
        expected_version: expected,
        document: invalid,
        issue: hardIssue,
        action: 'keep',
        reason: '不修改'
      }
    });
    assert.equal(rejectHard.response.status, 400);
    assert.equal(rejectHard.body.code, 'HARD_ERROR_MUST_BE_FIXED');
    const fixHard = await authedJson(assistantServer.baseUrl, '/api/review/apply', auth, {
      method: 'POST',
      body: {
        expected_version: expected,
        document: invalid,
        issue: hardIssue,
        action: 'apply',
        reason: ''
      }
    });
    assert.equal(fixHard.response.status, 200, fixHard.text);
    assert.equal(fixHard.body.validation.valid, true);

    const maintenanceOn = await authedJson(assistantServer.baseUrl, '/api/admin/maintenance', auth, {
      method: 'POST',
      body: {
        enabled: true,
        message: '正在发布试点版本'
      }
    });
    assert.equal(maintenanceOn.body.maintenance_mode.enabled, true);
    const beforeMaintenanceCallCount = fakeModel.calls.length;
    const blocked = await authedJson(assistantServer.baseUrl, '/api/fill/turn', auth, {
      method: 'POST',
      body: {
        expected_version: expected,
        document: fill.body.document,
        source_materials: [],
        messages: [],
        user_message: '继续'
      }
    });
    assert.equal(blocked.response.status, 503);
    assert.equal(blocked.body.code, 'MAINTENANCE_MODE');
    assert.equal(fakeModel.calls.length, beforeMaintenanceCallCount);
    const maintenanceOff = await authedJson(assistantServer.baseUrl, '/api/admin/maintenance', auth, {
      method: 'POST',
      body: { enabled: false, message: '' }
    });
    assert.equal(maintenanceOff.body.maintenance_mode.enabled, false);

    const balance = await authedJson(assistantServer.baseUrl, '/api/account/balance', auth);
    assert.equal(balance.response.status, 200);
    assert.equal(balance.body.totalBalance, 199);

    const adminBalanceCallCount = fakeModel.balanceCalls.length;
    const admin = await authedJson(assistantServer.baseUrl, '/api/admin/status', auth);
    assert.equal(admin.response.status, 200, admin.text);
    assert.equal(admin.body.account_key_statuses.length, 5);
    assert.equal(
      admin.body.account_key_statuses.find(item => item.account_id === 'zgy').active_key_sessions,
      1
    );
    assert.equal(
      admin.body.account_key_statuses.every(item => (
        !Object.hasOwn(item, 'fingerprint')
        && !Object.hasOwn(item, 'totalBalance')
        && !Object.hasOwn(item, 'balance')
      )),
      true
    );
    assert.ok(admin.body.usage.requestCount >= 3);
    assert.equal(
      fakeModel.balanceCalls.length,
      adminBalanceCallCount,
      'administrator status must not query account balances'
    );

    const revokedBinding = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: 'revoked-api-key' }
    });
    assert.equal(revokedBinding.response.status, 200);
    const revokedCall = await authedJson(assistantServer.baseUrl, '/api/fill/turn', auth, {
      method: 'POST',
      body: {
        expected_version: expected,
        document: fill.body.document,
        source_materials: [],
        source_authorized: true,
        source_deidentified: true,
        messages: [],
        user_message: '继续核对适用范围。'
      }
    });
    assert.equal(revokedCall.response.status, 502);
    assert.equal(revokedCall.body.code, 'MODEL_AUTH_FAILED');
    assert.deepEqual(
      (await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth)).body,
      { configured: false, fingerprint: null, configured_at: null, expires_at: null },
      'upstream authentication failure must clear the session key'
    );

    await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: 'test-api-key-1' }
    });
    const cleared = await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'DELETE',
      body: {}
    });
    assert.deepEqual(cleared.body, {
      configured: false,
      fingerprint: null,
      configured_at: null,
      expires_at: null
    });
    const afterClearCallCount = fakeModel.calls.length;
    const afterClear = await authedJson(assistantServer.baseUrl, '/api/review/run', auth, {
      method: 'POST',
      body: { expected_version: expected, document: fill.body.document }
    });
    assert.equal(afterClear.response.status, 428);
    assert.equal(afterClear.body.code, 'API_KEY_REQUIRED');
    assert.equal(fakeModel.calls.length, afterClearCallCount);

    await authedJson(assistantServer.baseUrl, '/api/account/api-key', auth, {
      method: 'PUT',
      body: { api_key: 'test-api-key-1' }
    });

    const usageText = fs.readFileSync(config.runtime.usageLogPath, 'utf8');
    assert.equal(usageText.includes('申请人提交材料'), false);
    assert.equal(usageText.includes('费用申请流程'), false);
    assert.equal(usageText.includes('test-api-key'), false);
    for (const line of usageText.trim().split(/\r?\n/)) {
      const record = JSON.parse(line);
      assert.deepEqual(
        Object.keys(record).filter(key => ![
          'timestamp',
          'request_id',
          'user_id',
          'operation',
          'model',
          'prompt_tokens',
          'completion_tokens',
          'total_tokens',
          'schema_version',
          'schema_digest',
          'validation_valid',
          'error_code',
          'attempt_count'
        ].includes(key)),
        []
      );
    }

    const gatewayServer = await listen(createGatewayHandler({
      auth: runtime.auth,
      targetBaseUrl: structuredServer.baseUrl
    }));
    try {
      const gatewayUnauth = await fetch(`${gatewayServer.baseUrl}/`);
      assert.equal(gatewayUnauth.status, 401);
      const gatewayAuth = await fetch(`${gatewayServer.baseUrl}/api/schema`, {
        headers: { Cookie: auth.cookie }
      });
      assert.equal(gatewayAuth.status, 200);
      assert.equal(gatewayAuth.headers.get('cache-control'), 'no-store');
      const gatewaySchema = await gatewayAuth.json();
      assert.equal(gatewaySchema.properties.schema_version.const, 'process-governance-v7');
    } finally {
      await close(gatewayServer.server);
    }

    const fakeDshServer = await listen((req, res) => {
      assert.equal(req.headers['x-infomat-dsh-runtime'], 'fake-runtime-token');
      if (req.url === '/') {
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Set-Cookie': 'must_not_reach_browser=1'
        });
        res.end('isolated DSH runtime');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    fakeDshRuntimeManager.setTarget({
      port: Number(new URL(fakeDshServer.baseUrl).port),
      runtimeToken: 'fake-runtime-token'
    });
    const gatewaySessionPayload = runtime.auth.authenticateRequest({ headers: { cookie: auth.cookie } }).payload;
    await fakeDshRuntimeManager.start(gatewaySessionPayload);
    let dshGatewayHandler = null;
    const dshGateway = await listen((request, response) => dshGatewayHandler(request, response));
    dshGatewayHandler = createDshGatewayHandler({
      auth: runtime.auth,
      dshRuntimeManager: fakeDshRuntimeManager,
      assistantBaseUrl: assistantServer.baseUrl,
      structuredToolBaseUrl: structuredServer.baseUrl,
      trustedHosts: [new URL(dshGateway.baseUrl).host],
      allowHttp: true
    });
    const untrustedGatewayPort = Number(new URL(dshGateway.baseUrl).port) + 1;
    try {
      assert.equal((await fetch(`${dshGateway.baseUrl}/`)).status, 401);
      assert.equal(await rawStatus(dshGateway.baseUrl, '/', {
        Cookie: auth.cookie,
        Host: 'forged.example'
      }), 403);
      assert.equal(await rawStatus(dshGateway.baseUrl, '/', {
        Cookie: auth.cookie,
        Host: `127.0.0.1:${untrustedGatewayPort}`
      }), 403, 'the public gateway port is part of the trusted authority');
      assert.equal((await fetch(`${dshGateway.baseUrl}/`, {
        headers: { Cookie: auth.cookie, Origin: 'http://forged.example' }
      })).status, 403);
      const dshRoot = await fetch(`${dshGateway.baseUrl}/`, {
        headers: { Cookie: auth.cookie, 'X-Infomat-DSH-Runtime': 'attacker-value' }
      });
      assert.equal(dshRoot.status, 200);
      assert.equal(await dshRoot.text(), 'isolated DSH runtime');
      assert.equal(dshRoot.headers.get('set-cookie'), null);
      const mdmContext = await fetch(`${dshGateway.baseUrl}/mdm-api/context`, {
        headers: { Cookie: auth.cookie }
      });
      assert.equal(mdmContext.status, 200);
      assert.equal((await mdmContext.json()).schema_version, 'process-governance-v5');
      const structuredSchema = await fetch(`${dshGateway.baseUrl}/structured-tool/api/schema`, {
        headers: { Cookie: auth.cookie }
      });
      assert.equal(structuredSchema.status, 200);
      assert.equal((await structuredSchema.json()).properties.schema_version.const, 'process-governance-v7');

      await fakeDshRuntimeManager.stop(gatewaySessionPayload);
      const stoppedRuntime = await fetch(`${dshGateway.baseUrl}/`, {
        headers: { Cookie: auth.cookie }
      });
      assert.equal(stoppedRuntime.status, 409);
      assert.equal((await stoppedRuntime.json()).code, 'DSH_RUNTIME_REQUIRED');
      const stoppedModelCall = await fetch(`${dshGateway.baseUrl}/mdm-api/fill/turn`, {
        method: 'POST',
        headers: { Cookie: auth.cookie, 'Content-Type': 'application/json' },
        body: '{}'
      });
      assert.equal(stoppedModelCall.status, 409);
      assert.equal((await stoppedModelCall.json()).code, 'DSH_RUNTIME_REQUIRED');
    } finally {
      await close(dshGateway.server);
      await close(fakeDshServer.server);
    }

    const logout = await authedJson(assistantServer.baseUrl, '/api/auth/logout', auth, {
      method: 'POST',
      body: {}
    });
    assert.equal(logout.response.status, 200);
    assert.equal(
      runtime.apiKeyStore.accountStatuses(config.accounts).find(item => item.account_id === 'zgy').active_key_sessions,
      0,
      'logout must clear the session key'
    );
  } finally {
    await close(assistantServer.server);
    await close(structuredServer.server);
  }
}

function testRestrictedPatch() {
  const document = {
    schema_version: 'process-governance-v5',
    export_meta: {},
    process: { process_name: '' },
    reference_materials: [],
    behaviors: [],
    flow_relations: [],
    data_objects: [],
    internal_process_calls: [],
    forms: [],
    terms: []
  };
  const changed = applyRestrictedPatch(document, [{
    op: 'replace',
    path: '/process/process_name',
    value: '测试流程'
  }]);
  assert.equal(changed.process.process_name, '测试流程');
  assert.equal(document.process.process_name, '', 'patch must not mutate the caller document');
  assert.throws(
    () => applyRestrictedPatch(document, [{ op: 'add', path: '/unknown', value: 1 }]),
    /不允许修改字段路径/
  );
  assert.throws(
    () => applyRestrictedPatch(document, [{ op: 'add', path: '/cross_department_handoffs', value: [] }]),
    /不允许修改字段路径/
  );
  assert.throws(
    () => applyRestrictedPatch(document, [{ op: 'add', path: '/process/__proto__/polluted', value: true }]),
    /不允许修改字段路径/
  );
  assert.equal({}.polluted, undefined);
}

async function testDeepSeekTransportPolicy() {
  let calls = 0;
  const responseBody = {
    choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
  const client = createDeepSeekClient({
    baseUrl: 'https://example.invalid',
    timeoutMs: 1000,
    retryDelayMs: 1,
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  const result = await client.completion({
    apiKey: 'test',
    model: 'deepseek-v4-pro',
    messages: [{ role: 'user', content: 'json' }],
    thinking: false,
    maxTokens: 100,
    requestId: 'retry-test'
  });
  assert.equal(calls, 2);
  assert.equal(result.transportAttempts, 2);

  let timeoutCalls = 0;
  const timeoutClient = createDeepSeekClient({
    baseUrl: 'https://example.invalid',
    timeoutMs: 5,
    retryDelayMs: 1,
    fetchFn: (_url, options) => new Promise((_resolve, reject) => {
      timeoutCalls += 1;
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })
  });
  await assert.rejects(
    timeoutClient.completion({
      apiKey: 'test',
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'json' }],
      thinking: false,
      maxTokens: 100,
      requestId: 'timeout-test'
    }),
    error => error.code === 'MODEL_TIMEOUT_UNCERTAIN'
  );
  assert.equal(timeoutCalls, 1, 'uncertain timeout must not be retried');
}

function testFrontendContract() {
  const html = fs.readFileSync(frontendPath, 'utf8');
  const script = fs.readFileSync(frontendScriptPath, 'utf8');
  assert.ok(html.includes('<title>MDM-AI助手</title>'));
  assert.ok(html.includes('<h1>MDM-AI助手</h1>'));
  assert.ok(html.includes('不用先准备完整材料'));
  assert.ok(html.includes('结构化输出预览'));
  assert.ok(html.includes('补充材料（可选）'));
  assert.ok(html.includes('继续编辑已有3001格式JSON'));
  assert.ok(html.includes('部分完成JSON'));
  assert.equal(html.includes('继续已有内容'), false);
  assert.ok(html.includes('逐条确认预审问题处理方式'));
  assert.ok(html.includes('3001输出与流程图预览'));
  assert.ok(html.includes('下载预审后的3001格式JSON'));
  assert.ok(html.includes('/assets/3001/process-diagram.js'));
  assert.ok(html.includes('下载未经独立预审的JSON'));
  assert.ok(html.includes('AI不判断流程内容是否正确'));
  assert.ok(html.includes('用户电脑不需要安装、复制或更新Infomat仓库'));
  assert.ok(html.includes('本工具不是完全本地化模型'));
  assert.ok(html.includes('五账号试点'));
  assert.ok(html.includes('id="apiKeyInput"'));
  assert.ok(html.includes('type="password"'));
  assert.ok(html.includes('autocomplete="off"'));
  assert.ok(html.includes('只显示不可逆指纹'));
  assert.ok(html.includes('五个账号Key会话状态'));
  assert.ok(script.includes("window.setInterval"));
  assert.ok(script.includes("VERSION_CHANGED"));
  assert.ok(script.includes("expected_version: expectedVersion()"));
  assert.ok(script.includes("source_authorized: consent.authorized"));
  assert.ok(script.includes("field_statuses: [...state.fieldStatuses.values()]"));
  assert.ok(script.includes("MAX_IMPORTED_JSON_BYTES"));
  assert.ok(script.includes("我会一次问清一个问题"));
  assert.ok(script.includes("function conversationPayload(messages)"));
  assert.ok(script.includes("本轮主问题："));
  assert.ok(script.includes("function renderStructuredPreview()"));
  assert.ok(script.includes("function renderReviewDocumentPreview()"));
  assert.ok(script.includes("window.ProcessDiagram.mount"));
  assert.ok(script.includes("reviewRunCompleted"));
  assert.ok(script.includes("&& state.reviewRunCompleted"));
  assert.ok(script.includes("window.addEventListener('beforeunload'"));
  assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie/.test(script), false);
  assert.equal(/DEEPSEEK_API_KEY/.test(script), false);
  assert.ok(script.includes("method: 'PUT'"));
  assert.ok(script.includes("method: 'DELETE'"));
  assert.ok(script.includes("status.fingerprint"));
  assert.ok(script.includes("API_KEY_REQUIRED"));
  assert.equal(/<script(?! src)/.test(html), false, 'CSP-safe frontend must not use inline scripts');
  assert.equal(/<style/.test(html), false, 'CSP-safe frontend must not use inline styles');
}

async function main() {
  testRestrictedPatch();
  testApiKeyStore();
  await testDeepSeekTransportPolicy();
  testFrontendContract();
  await testAssistantApi();
  console.log('structure-assistant structure rules tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
