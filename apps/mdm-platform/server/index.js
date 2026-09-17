const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { assertRuntimeConfig, legacyTestMode } = require('./runtimeBoundary');
assertRuntimeConfig(process.env);
const { requireAuth } = require('./auth');
const { securityHeaders, csrfProtection, issueCsrfToken } = require('./security');
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
app.locals.closeRuntime = async () => {
  readiness.stop();
  await Promise.all([readiness.close(), typeof store.close === 'function' ? store.close() : Promise.resolve()]);
};

app.use(securityHeaders);
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
  res.set('Cache-Control', 'no-store').status(error.type === 'entity.too.large' ? 413 : 400).json({
    code: error.type === 'entity.too.large' ? 'DEFINITION_ANALYSIS_PAYLOAD_TOO_LARGE' : 'DEFINITION_ANALYSIS_JSON_INVALID', error: '分析请求格式无效或超出允许大小。' });
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
registerRouteIfExists('/api/process-v7-preview', 'processV7PreviewReview');
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
  const sessionFailure = error && error.code === 'SESSION_STORE_UNAVAILABLE';
  res.status(sessionFailure ? 503 : 500).json({ code: sessionFailure ? error.code : 'REQUEST_FAILED',
    error: sessionFailure ? '会话服务暂不可用，请稍后重试' : '请求暂时无法完成' });
});

if (require.main === module) {
  const server = app.listen(PORT, config.host, () => {
    console.log(`MDM_LISTENING port=${PORT} sourceDigest=${version.sourceDigest}`);
  });
  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    readiness.stop();
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 15000);
    server.close(async () => {
      await app.locals.closeRuntime().catch(() => {});
      clearTimeout(deadline);
      process.exit(0);
    });
    server.closeIdleConnections();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('disconnect', shutdown);
  process.on('message', message => { if (message === 'mdm:stop') shutdown(); });
}

module.exports = app;
