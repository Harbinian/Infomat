'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { loadRuntimeConfig } = require('./lib/config');
const { AppError, asAppError } = require('./lib/errors');
const { createAuth } = require('./lib/auth');
const { repositoryState, assertDeployableRepository } = require('./lib/repository');
const { createMaintenanceStore } = require('./lib/maintenance');
const { createUsageLog } = require('./lib/usage-log');
const { createStructuredToolClient, assertExpectedVersion } = require('./lib/structured-tool');
const { applyRestrictedPatch } = require('./lib/json-patch');
const { createDeepSeekClient } = require('./lib/deepseek');
const {
  normalizePriorFieldStatuses,
  runFillTurn,
  runIndependentReview
} = require('./lib/model-workflows');
const {
  extractReadableSource,
  sourceFromPaste,
  normalizeSourceMaterials,
  normalizeConversation,
  assertDocument
} = require('./lib/source');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseTrue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function assertSourceConfirmation(body) {
  if (!parseTrue(body?.source_authorized ?? body?.authorized)
    || !parseTrue(body?.source_deidentified ?? body?.deidentified)) {
    throw new AppError(
      400,
      'SOURCE_CONFIRMATION_REQUIRED',
      '请先确认输入内容已经授权并完成脱敏。'
    );
  }
}

function requestId(value) {
  const supplied = String(value || '').trim();
  if (/^[A-Za-z0-9._:-]{1,120}$/.test(supplied)) return supplied;
  return `request_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function expectedVersion(body) {
  return body?.expected_version || {
    app_commit: body?.app_commit,
    schema_digest: body?.schema_digest
  };
}

function gatewayUrl(req, config) {
  const protocol = config.security.allowHttp ? 'http' : 'https';
  const hostname = String(req.hostname || 'localhost').replace(/^\[|\]$/g, '');
  const formattedHost = hostname.includes(':') ? `[${hostname}]` : hostname;
  return `${protocol}://${formattedHost}:${config.assistant.gatewayPort}/`;
}

function safeValidation(validation) {
  return {
    valid: Boolean(validation?.valid),
    errors: Array.isArray(validation?.errors) ? validation.errors.slice(0, 100) : []
  };
}

function createAssistantRuntime(options = {}) {
  const config = options.config || loadRuntimeConfig({ strictSecrets: false });
  const repoState = options.repoState || repositoryState(config.repoRoot);
  const appCommit = options.appCommit || repoState.commit;
  const maintenance = options.maintenance || createMaintenanceStore(config.runtime.maintenancePath);
  const usageLog = options.usageLog || createUsageLog(config.runtime.usageLogPath);
  const structuredTool = options.structuredTool || createStructuredToolClient({
    baseUrl: config.assistant.structuredToolBaseUrl,
    appCommit
  });
  const modelClient = options.modelClient || createDeepSeekClient({
    baseUrl: config.deepseek.baseUrl,
    timeoutMs: config.deepseek.requestTimeoutMs
  });
  const auth = options.auth || createAuth({
    accounts: config.accounts,
    sessionSecret: config.security.sessionSecret,
    sessionHours: config.security.sessionHours,
    secureCookie: !config.security.allowHttp,
    loginWindowMinutes: config.security.loginWindowMinutes,
    loginMaxAttempts: config.security.loginMaxAttempts
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 1,
      fileSize: config.security.maxUploadBytes
    }
  });
  const app = express();
  const structuredToolRoot = path.join(config.repoRoot, 'apps', 'structured-output-service');
  const diagramAssets = {
    cytoscape: path.join(structuredToolRoot, 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js'),
    renderer: path.join(structuredToolRoot, 'public', 'process-diagram.js')
  };

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    );
    next();
  });
  app.use(express.json({ limit: '12mb' }));

  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const user = auth.login(req, res);
    res.json({ user });
  }));

  app.get('/api/auth/me', (req, res) => {
    const authenticated = auth.authenticateRequest(req);
    if (!authenticated) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      user: auth.publicUser(authenticated.account, authenticated.payload.csrf)
    });
  });

  app.get('/assets/3001/cytoscape.min.js', (_req, res, next) => {
    res.sendFile(diagramAssets.cytoscape, error => {
      if (error) next(error);
    });
  });

  app.get('/assets/3001/process-diagram.js', (_req, res, next) => {
    res.sendFile(diagramAssets.renderer, error => {
      if (error) next(error);
    });
  });

  app.use('/api', auth.requireAuth);

  app.post('/api/auth/logout', auth.requireCsrf, (req, res) => {
    auth.logout(req, res);
    res.json({ ok: true });
  });

  app.get('/api/context', asyncRoute(async (req, res) => {
    const current = await structuredTool.snapshot();
    res.json({
      app_commit: current.appCommit,
      schema_version: current.schemaVersion,
      schema_digest: current.schemaDigest,
      maintenance_mode: maintenance.read(),
      structured_tool: current.structuredTool,
      structured_tool_url: gatewayUrl(req, config),
      models: {
        fill: config.deepseek.fillModel,
        review: config.deepseek.reviewModel
      }
    });
  }));

  app.get('/api/template', asyncRoute(async (_req, res) => {
    const current = await structuredTool.template();
    res.json({
      app_commit: current.appCommit,
      schema_version: current.schemaVersion,
      schema_digest: current.schemaDigest,
      data: current.data
    });
  }));

  app.post('/api/source/upload', auth.requireCsrf, upload.single('file'), asyncRoute(async (req, res) => {
    assertSourceConfirmation(req.body);
    const material = await extractReadableSource(req.file, config.security.maxModelInputChars);
    res.json({ material });
  }));

  app.post('/api/source/paste', auth.requireCsrf, asyncRoute(async (req, res) => {
    assertSourceConfirmation(req.body);
    res.json({
      material: sourceFromPaste(req.body?.text, config.security.maxModelInputChars)
    });
  }));

  async function guardedSnapshot(body, { blockMaintenance = true } = {}) {
    const maintenanceState = maintenance.read();
    if (blockMaintenance && maintenanceState.enabled) {
      throw new AppError(
        503,
        'MAINTENANCE_MODE',
        maintenanceState.message || '系统正在集中发布新版本，请先下载当前草稿。'
      );
    }
    const current = await structuredTool.snapshot();
    assertExpectedVersion(expectedVersion(body), current);
    return current;
  }

  function logModelOperation({
    req,
    rid,
    operation,
    model,
    current,
    result,
    validationValid,
    errorCode = null
  }) {
    const recordedUsage = result?.usage || result?.details?.usage || {};
    usageLog.append({
      request_id: rid,
      user_id: req.user.id,
      operation,
      model,
      prompt_tokens: Number(recordedUsage.prompt_tokens || 0),
      completion_tokens: Number(recordedUsage.completion_tokens || 0),
      total_tokens: Number(recordedUsage.total_tokens || 0),
      schema_version: current?.schemaVersion || null,
      schema_digest: current?.schemaDigest || null,
      validation_valid: Boolean(validationValid),
      error_code: errorCode,
      attempt_count: Number(result?.apiCallCount || result?.details?.apiCallCount || 0)
    });
  }

  app.post('/api/document/validate', auth.requireCsrf, asyncRoute(async (req, res) => {
    await guardedSnapshot(req.body, { blockMaintenance: false });
    const document = assertDocument(req.body?.document);
    const validation = await structuredTool.validate(document);
    res.json({
      ...safeValidation(validation),
      data: validation.data || document
    });
  }));

  app.post('/api/fill/turn', auth.requireCsrf, asyncRoute(async (req, res) => {
    const rid = requestId(req.headers['x-request-id']);
    const current = await guardedSnapshot(req.body);
    assertSourceConfirmation(req.body);
    const document = assertDocument(req.body?.document);
    const currentValidation = await structuredTool.validate(document);
    const sourceMaterials = normalizeSourceMaterials(
      req.body?.source_materials,
      config.security.maxModelInputChars
    );
    const messages = normalizeConversation(req.body?.messages);
    const priorFieldStatuses = normalizePriorFieldStatuses(req.body?.field_statuses);
    const userMessage = String(req.body?.user_message || '').trim().slice(0, 10000);
    if (!userMessage) throw new AppError(400, 'USER_MESSAGE_REQUIRED', '请输入本轮需要补充的信息。');
    if (!req.user.apiKey) throw new AppError(503, 'ACCOUNT_KEY_MISSING', '当前账号尚未配置DeepSeek接口密钥。');

    let result;
    try {
      result = await runFillTurn({
        client: modelClient,
        apiKey: req.user.apiKey,
        model: config.deepseek.fillModel,
        maxTokens: config.deepseek.fillMaxTokens,
        requestId: rid,
        schema: current.schema,
        document,
        sourceMaterials,
        messages,
        validationErrors: currentValidation.errors,
        priorFieldStatuses,
        userMessage,
        validateDocument: data => structuredTool.validate(data)
      });
      const after = await structuredTool.snapshot();
      assertExpectedVersion({
        app_commit: current.appCommit,
        schema_digest: current.schemaDigest
      }, after);
      logModelOperation({
        req,
        rid,
        operation: 'fill',
        model: config.deepseek.fillModel,
        current,
        result,
        validationValid: true
      });
    } catch (error) {
      logModelOperation({
        req,
        rid,
        operation: 'fill',
        model: config.deepseek.fillModel,
        current,
        result: error,
        validationValid: false,
        errorCode: error.code || 'INTERNAL_ERROR'
      });
      throw error;
    }
    res.json({
      request_id: rid,
      assistant_message: result.assistantMessage,
      questions: result.questions,
      document: result.document,
      field_statuses: result.fieldStatuses,
      validation: result.validation,
      usage: result.usage
    });
  }));

  app.post('/api/review/run', auth.requireCsrf, asyncRoute(async (req, res) => {
    const rid = requestId(req.headers['x-request-id']);
    const current = await guardedSnapshot(req.body);
    const document = assertDocument(req.body?.document);
    if (!req.user.apiKey) throw new AppError(503, 'ACCOUNT_KEY_MISSING', '当前账号尚未配置DeepSeek接口密钥。');
    const validation = await structuredTool.validate(document);

    let result;
    try {
      result = await runIndependentReview({
        client: modelClient,
        apiKey: req.user.apiKey,
        model: config.deepseek.reviewModel,
        maxTokens: config.deepseek.reviewMaxTokens,
        requestId: rid,
        schema: current.schema,
        document,
        validation
      });
      const after = await structuredTool.snapshot();
      assertExpectedVersion({
        app_commit: current.appCommit,
        schema_digest: current.schemaDigest
      }, after);
      logModelOperation({
        req,
        rid,
        operation: 'review',
        model: config.deepseek.reviewModel,
        current,
        result,
        validationValid: validation.valid
      });
    } catch (error) {
      logModelOperation({
        req,
        rid,
        operation: 'review',
        model: config.deepseek.reviewModel,
        current,
        result: error,
        validationValid: validation.valid,
        errorCode: error.code || 'INTERNAL_ERROR'
      });
      throw error;
    }

    res.json({
      request_id: rid,
      summary: result.summary,
      issues: result.issues,
      validation: result.validation,
      usage: result.usage
    });
  }));

  app.post('/api/review/apply', auth.requireCsrf, asyncRoute(async (req, res) => {
    await guardedSnapshot(req.body);
    const document = assertDocument(req.body?.document);
    const issue = req.body?.issue;
    const action = String(req.body?.action || '');
    if (!issue || !['hard_error', 'suggestion'].includes(issue.severity)) {
      throw new AppError(400, 'INVALID_REVIEW_ISSUE', '预审问题格式不正确。');
    }
    if (issue.severity === 'hard_error' && action !== 'apply') {
      throw new AppError(400, 'HARD_ERROR_MUST_BE_FIXED', '硬性结构错误必须修改，不能保持原值。');
    }
    if (issue.severity === 'suggestion' && action === 'keep') {
      const reason = String(req.body?.reason || '').trim().slice(0, 1000);
      if (!reason) throw new AppError(400, 'KEEP_REASON_REQUIRED', '保持原值时必须记录理由。');
      const validation = await structuredTool.validate(document);
      return res.json({
        document,
        disposition: {
          issue_id: String(issue.id || ''),
          action: 'keep',
          reason
        },
        validation: safeValidation(validation)
      });
    }
    if (action !== 'apply') {
      throw new AppError(400, 'INVALID_REVIEW_ACTION', '请选择“按建议修改”或“保持原值并记录理由”。');
    }
    if (!Array.isArray(issue.patch) || issue.patch.length === 0) {
      throw new AppError(
        400,
        'REVIEW_PATCH_MISSING',
        '该问题没有可自动执行的结构修改，请返回填报页修改后重新预审。'
      );
    }
    const updatedDocument = applyRestrictedPatch(document, issue.patch);
    const validation = await structuredTool.validate(updatedDocument);
    if (issue.severity === 'suggestion' && !validation.valid) {
      throw new AppError(
        422,
        'SUGGESTION_BREAKS_SCHEMA',
        '应用该建议后会产生硬性结构错误，系统没有修改当前JSON。'
      );
    }
    res.json({
      document: validation.data || updatedDocument,
      disposition: {
        issue_id: String(issue.id || ''),
        action: 'apply',
        reason: ''
      },
      validation: safeValidation(validation)
    });
  }));

  app.get('/api/account/balance', asyncRoute(async (req, res) => {
    if (!req.user.apiKey) throw new AppError(503, 'ACCOUNT_KEY_MISSING', '当前账号尚未配置DeepSeek接口密钥。');
    const balance = await modelClient.balance(req.user.apiKey);
    res.json({
      ...balance,
      warning: balance.totalBalance != null && balance.totalBalance < config.deepseek.lowBalanceCny
    });
  }));

  app.get('/api/admin/status', auth.requireAdmin, asyncRoute(async (_req, res) => {
    let current = null;
    let contextError = null;
    try {
      current = await structuredTool.snapshot();
    } catch (error) {
      contextError = {
        code: error.code || 'STRUCTURED_TOOL_UNAVAILABLE',
        message: error.message
      };
    }
    const balances = await Promise.all(config.accounts.map(async account => {
      if (!account.apiKey) {
        return {
          accountId: account.id,
          displayName: account.displayName,
          keyConfigured: false,
          error: '接口密钥未配置'
        };
      }
      try {
        const balance = await modelClient.balance(account.apiKey);
        return {
          accountId: account.id,
          displayName: account.displayName,
          keyConfigured: true,
          ...balance,
          warning: balance.totalBalance != null && balance.totalBalance < config.deepseek.lowBalanceCny
        };
      } catch (error) {
        return {
          accountId: account.id,
          displayName: account.displayName,
          keyConfigured: true,
          error: error.message
        };
      }
    }));
    res.json({
      app_commit: appCommit,
      repository_clean_at_startup: repoState.clean,
      schema_version: current?.schemaVersion || null,
      schema_digest: current?.schemaDigest || null,
      structured_tool: current?.structuredTool || null,
      context_error: contextError,
      maintenance_mode: maintenance.read(),
      models: {
        fill: config.deepseek.fillModel,
        review: config.deepseek.reviewModel
      },
      balances,
      usage: usageLog.summarize()
    });
  }));

  app.post('/api/admin/maintenance', auth.requireAdmin, auth.requireCsrf, asyncRoute(async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    if (!enabled) await structuredTool.snapshot();
    const state = maintenance.write({
      enabled,
      message: String(req.body?.message || '').trim().slice(0, 300),
      changedBy: req.user.id
    });
    res.json({ maintenance_mode: state });
  }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: '接口不存在。', code: 'API_NOT_FOUND' });
  });

  app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), {
      headers: { 'Cache-Control': 'no-store' }
    });
  });

  app.use((error, _req, res, _next) => {
    let normalized = error;
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      normalized = new AppError(413, 'SOURCE_FILE_TOO_LARGE', '文件超过10MB，未读取任何内容。');
    } else if (error instanceof multer.MulterError) {
      normalized = new AppError(400, 'SOURCE_UPLOAD_FAILED', '文件上传失败。');
    } else if (error?.type === 'entity.too.large') {
      normalized = new AppError(413, 'REQUEST_TOO_LARGE', '本次请求内容过大。');
    }
    const safe = asAppError(normalized);
    res.status(safe.status).json({
      error: safe.message,
      code: safe.code
    });
  });

  return {
    app,
    auth,
    config,
    appCommit,
    repoState,
    maintenance,
    usageLog,
    structuredTool,
    modelClient
  };
}

function createGatewayHandler({ auth, targetBaseUrl }) {
  const target = new URL(targetBaseUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {
    throw new AppError(500, 'INVALID_GATEWAY_TARGET', '结构化工具网关只能转发到本机地址。');
  }
  const transport = target.protocol === 'https:' ? https : http;
  return (req, res) => {
    const authenticated = auth.authenticateRequest(req);
    if (!authenticated) {
      res.writeHead(401, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end('<!doctype html><meta charset="utf-8"><title>请先登录</title><p>请先登录MDM-AI助手，再打开结构化工具。</p>');
      return;
    }

    const headers = { ...req.headers };
    delete headers.cookie;
    delete headers.authorization;
    delete headers.connection;
    headers.host = target.host;
    const proxy = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      headers
    }, proxyResponse => {
      const responseHeaders = { ...proxyResponse.headers };
      delete responseHeaders['set-cookie'];
      responseHeaders['cache-control'] = 'no-store';
      responseHeaders['x-content-type-options'] = 'nosniff';
      res.writeHead(proxyResponse.statusCode || 502, responseHeaders);
      proxyResponse.pipe(res);
    });
    proxy.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });
      }
      res.end(JSON.stringify({ error: '结构化工具暂时不可用。', code: 'STRUCTURED_TOOL_UNAVAILABLE' }));
    });
    req.pipe(proxy);
  };
}

function createServer(protocol, tlsOptions, handler) {
  return protocol === 'https' ? https.createServer(tlsOptions, handler) : http.createServer(handler);
}

async function listen(server, port, host) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
}

async function start() {
  const config = loadRuntimeConfig({ strictSecrets: true });
  const repoState = assertDeployableRepository(config.repoRoot, config.security.allowDirty);
  if (config.security.allowHttp && !['127.0.0.1', 'localhost', '::1'].includes(config.assistant.host)) {
    throw new AppError(
      500,
      'INSECURE_NETWORK_BIND',
      'HTTP开发模式只能监听本机地址，内网试点必须配置HTTPS。'
    );
  }
  let protocol = 'https';
  let tlsOptions = null;
  if (config.security.allowHttp) {
    protocol = 'http';
  } else {
    if (!config.security.tlsCertPath || !config.security.tlsKeyPath) {
      throw new AppError(
        500,
        'TLS_CONFIGURATION_REQUIRED',
        '内网试点必须配置HTTPS证书和私钥路径。'
      );
    }
    tlsOptions = {
      cert: fs.readFileSync(config.security.tlsCertPath),
      key: fs.readFileSync(config.security.tlsKeyPath),
      minVersion: 'TLSv1.2'
    };
  }

  const runtime = createAssistantRuntime({ config, repoState, appCommit: repoState.commit });
  await runtime.structuredTool.snapshot();
  const assistantServer = createServer(protocol, tlsOptions, runtime.app);
  const gatewayServer = createServer(protocol, tlsOptions, createGatewayHandler({
    auth: runtime.auth,
    targetBaseUrl: config.assistant.structuredToolBaseUrl
  }));
  await listen(assistantServer, config.assistant.port, config.assistant.host);
  try {
    await listen(gatewayServer, config.assistant.gatewayPort, config.assistant.host);
  } catch (error) {
    await new Promise(resolve => assistantServer.close(resolve));
    throw error;
  }

  console.log(`structure-assistant listening on ${protocol}://${config.assistant.host}:${config.assistant.port}`);
  console.log(`structured-tool gateway listening on ${protocol}://${config.assistant.host}:${config.assistant.gatewayPort}`);
  console.log(`Infomat commit ${repoState.commit}`);
  console.log('business content persistence: disabled');

  const shutdown = () => {
    assistantServer.close();
    gatewayServer.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { assistantServer, gatewayServer, runtime };
}

if (require.main === module) {
  start().catch(error => {
    const safe = asAppError(error);
    console.error(`${safe.code}: ${safe.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createAssistantRuntime,
  createGatewayHandler,
  start
};
