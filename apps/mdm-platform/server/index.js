const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { assertRuntimeConfig, legacyTestMode } = require('./runtimeBoundary');
assertRuntimeConfig(process.env);
const { requireAuth } = require('./auth');
const { securityHeaders, csrfProtection, issueCsrfToken } = require('./security');
const { sendBodyParserError, bodyParserError } = require('./httpErrorContract');
const { installRequestLogging, securityLog, logRequestFailure } = require('./securityLog');
const { closeAllPools } = require('./mysqlPoolRegistry');
const { ACCESS_MODEL_VERSION } = require('./roleDefinitions');
const { sessionConfig } = require('./sessionConfig');
const { MysqlSessionStore } = require('./mysqlSessionStore');
const { createReadiness } = require('./readiness');
const { runtimeVersion } = require('./runtimeVersion');

const app = express();
const PORT = process.env.PORT || 3000;
const config = sessionConfig();
const version = runtimeVersion();
const readiness = createReadiness({ env: { ...process.env }, version });
const store = config.store === 'mysql' ? new MysqlSessionStore(config) : new session.MemoryStore();
app.set('trust proxy', config.proxies.length ? config.proxies : false);
app.locals.sessionCookie = { name: config.name, options: { path: '/', httpOnly: true, sameSite: 'lax', secure: config.secure } };
app.locals.readiness = readiness;
let runtimeClosePromise;
app.locals.closeRuntime = () => {
  if (runtimeClosePromise) return runtimeClosePromise;
  const parsedBudget = Number(process.env.MDM_SHUTDOWN_DRAIN_MS);
  const timeoutMs = Number.isSafeInteger(parsedBudget) && parsedBudget > 0 ? parsedBudget : 5000;
  readiness.stop();
  const closeDependency = async (domain, action) => {
    let timer;
    try {
      await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DRAIN_TIMEOUT')), timeoutMs);
      })]);
      return null;
    } catch { return domain; }
    finally { clearTimeout(timer); }
  };
  runtimeClosePromise = (async () => {
    const [readinessFailure, sessionFailure, drained] = await Promise.all([
      closeDependency('readiness', () => readiness.close()),
      closeDependency('session', () => typeof store.close === 'function' ? store.close() : undefined),
      closeAllPools({ timeoutMs })
    ]);
    return { ...drained, notDrained: [...new Set([...drained.notDrained, readinessFailure, sessionFailure].filter(Boolean))] };
  })();
  return runtimeClosePromise;
};

app.use(securityHeaders);
// R06: request identity and the completion record are installed before any parser, so a request
// that fails during body parsing still gets an id and a log line.
installRequestLogging(app);
// Health endpoints bypass session storage, so database failure cannot hide process liveness.
app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ status: 'ok', identityModel: 'person', governanceModelVersion: ACCESS_MODEL_VERSION, version });
});
app.get('/api/ready', async (req, res, next) => {
  try {
    const result = await readiness.check();
    res.set('Cache-Control', 'no-store').status(result.ready ? 200 : 503).json(result);
  } catch (error) { next(error); }
});
app.use((req, res, next) => {
  if (config.secure && (!req.secure || req.hostname !== new URL(config.origin).hostname)) {
    return res.status(400).json({ code: 'HTTPS_PROXY_REQUIRED', error: '请使用已配置的HTTPS入口访问' });
  }
  next();
});
app.use('/app', require('./frontend').frontendRouter());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/api/analysis', express.json({ limit: '256kb' }));
app.use(express.json({ limit: '2mb' }));
app.use('/api/analysis', (error, req, res, next) => {
  if (!error) return next();
  const contract = bodyParserError(error);
  if (!contract) return next(error);
  res.set('Cache-Control', 'no-store').status(contract.status).json({
    code: error.type === 'entity.too.large' ? 'DEFINITION_ANALYSIS_PAYLOAD_TOO_LARGE' : 'DEFINITION_ANALYSIS_JSON_INVALID', error: '分析请求格式无效或超出允许大小。' });
  securityLog(req).write({ event: 'parse_failed', code: error.type, status: res.statusCode });
});
// R07: the general body contract. Registered after the analysis mapper (which keeps its own
// codes) and before the routes, so it sees parser failures only -- a malformed or oversized body
// on any other path is a client problem, not the generic 500 it used to become.
app.use((error, req, res, next) => {
  if (!error) return next();
  if (sendBodyParserError(res, error)) {
    securityLog(req).write({ event: 'parse_failed', code: error.type, status: res.statusCode });
    return undefined;
  }
  return next(error);
});

app.use(session({
  name: config.name,
  secret: config.secret,
  store,
  resave: false,
  rolling: true,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secure,
    maxAge: config.ttlMs
  }
}));

app.use(csrfProtection);

app.get('/api/csrf-token', requireAuth, issueCsrfToken);

function registerRouteIfExists(basePath, routeName) {
  const routePath = path.join(__dirname, 'routes', `${routeName}.js`);
  if (fs.existsSync(routePath)) {
    app.use(basePath, require(routePath));
  } else {
    throw new Error(`Required route module is missing: ${routeName}`);
  }
}

registerRouteIfExists('/api/org/accounts', 'accounts');
registerRouteIfExists('/api/org', 'org');
registerRouteIfExists('/api/rbac', 'rbac');
registerRouteIfExists('/api/governance', 'governance');
registerRouteIfExists('/api/mappings', 'mappings');
registerRouteIfExists('/api/data-map', 'dataMap');
registerRouteIfExists('/api/master-data-template', 'masterDataTemplate');
registerRouteIfExists('/api/data-map-definitions', 'dataMapDefinitions');
registerRouteIfExists('/api/data-map-facts', 'dataMapFacts');
registerRouteIfExists('/api/v7-mappings', 'v7Mappings');
registerRouteIfExists('/api/design-handoffs', 'designHandoffs');
registerRouteIfExists('/api/analysis', 'analysis');
registerRouteIfExists('/api/field-entries', 'fieldEntries');
registerRouteIfExists('/api/field-identities', 'fieldIdentities');
registerRouteIfExists('/api/todos', 'todos');
registerRouteIfExists('/api/conflicts', 'conflicts');
registerRouteIfExists('/api/terminology', 'terminology');
registerRouteIfExists('/api/versions', 'versions');
registerRouteIfExists('/api/publications', 'publications');
registerRouteIfExists('/api/process-diagrams', 'processDiagrams');
registerRouteIfExists('/api/import', 'import');
registerRouteIfExists('/api/export', 'export');
registerRouteIfExists('/api/process-governance/guidance', 'governanceGuidance');
registerRouteIfExists('/api/process-governance', 'processGovernance');
registerRouteIfExists('/api/process-design', 'processDesignMysql');
registerRouteIfExists('/api/process-v7-preview', 'processPreviewReview');
registerRouteIfExists('/api/process-data-governance', 'processDataGovernance');
registerRouteIfExists('/api/role-workbench', 'roleWorkbench');
registerRouteIfExists('/api/page-workflows', 'pageWorkflows');
registerRouteIfExists('/api/offices', 'offices');
registerRouteIfExists('/api/quality', 'quality');
registerRouteIfExists('/api/roles', 'roles');
registerRouteIfExists('/api/import-rbac', 'importRbac');
registerRouteIfExists('/api/activity', 'activity');

app.get('/api/runtime-capabilities', requireAuth, (req, res) => {
  res.json({ legacyTestMode: legacyTestMode() });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (require('./mysqlRuntimeSchema').sendMysqlUnavailable(res, error)) return;
  const sessionFailure = error && error.code === 'SESSION_STORE_UNAVAILABLE';
  // R06: every unhandled failure is recorded with the request's correlation id, and only the
  // error's code -- never its message, SQL, parameters or stack.
  logRequestFailure(req, error, { status: sessionFailure ? 503 : 500 });
  res.status(sessionFailure ? 503 : 500).json({ code: sessionFailure ? error.code : 'REQUEST_FAILED',
    request_id: req.requestId || null,
    error: sessionFailure ? '会话服务暂不可用，请稍后重试' : '请求暂时无法完成' });
});

if (require.main === module) {
  const server = app.listen(PORT, config.host, () => {
    console.log(`MDM_LISTENING port=${server.address().port} sourceDigest=${version.sourceDigest}`);
  });
  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    readiness.stop();
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 15000);
    server.close(async () => {
      const drained = await app.locals.closeRuntime().catch(() => ({ notDrained: ['runtime'] }));
      // R11: what did not drain is named, so a stuck pool is visible instead of being hidden by
      // the hard exit. A clean stop reports nothing.
      if (drained && drained.notDrained && drained.notDrained.length) {
        console.log(`MDM_SHUTDOWN_NOT_DRAINED domains=${drained.notDrained.join(',')}`);
      } else console.log(`MDM_SHUTDOWN_DRAINED pools=${drained.closed}`);
      clearTimeout(deadline);
      process.exit(drained.notDrained.length ? 1 : 0);
    });
    server.closeIdleConnections();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('disconnect', shutdown);
  process.on('message', message => { if (message === 'mdm:stop') shutdown(); });
}

module.exports = app;
