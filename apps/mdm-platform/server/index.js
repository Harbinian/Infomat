const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('./auth');
const { securityHeaders, csrfProtection, issueCsrfToken } = require('./security');
const { ACCESS_MODEL_VERSION } = require('./roleDefinitions');

function resolveSessionSecret(env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (env.ALLOW_INSECURE_SESSION_SECRET === '1') return 'mdm-platform-dev-secret-change-me';
  throw new Error('SESSION_SECRET is required; set ALLOW_INSECURE_SESSION_SECRET=1 only for local development');
}

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = resolveSessionSecret(process.env);
if (process.env.NODE_ENV === 'production' &&
    String(process.env.MDM_IDENTITY_READ_MODEL || '').toLowerCase() !== 'mysql') {
  throw new Error('3000 production runtime requires MDM_IDENTITY_READ_MODEL=mysql');
}

app.use(securityHeaders);
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json({ limit: '2mb' }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(csrfProtection);

app.get('/api/csrf-token', requireAuth, issueCsrfToken);

function registerRouteIfExists(basePath, routeName) {
  const routePath = path.join(__dirname, 'routes', `${routeName}.js`);
  if (fs.existsSync(routePath)) {
    app.use(basePath, require(routePath));
  }
}

registerRouteIfExists('/api/org/accounts', 'accounts');
registerRouteIfExists('/api/org', 'org');
registerRouteIfExists('/api/rbac', 'rbac');
registerRouteIfExists('/api/governance', 'governance');
registerRouteIfExists('/api/systems', 'systems');
registerRouteIfExists('/api/capabilities', 'capabilities');
registerRouteIfExists('/api/processes', 'processes');
registerRouteIfExists('/api/mappings', 'mappings');
registerRouteIfExists('/api/data-map', 'dataMap');
registerRouteIfExists('/api/field-entries', 'fieldEntries');
registerRouteIfExists('/api/field-identities', 'fieldIdentities');
registerRouteIfExists('/api/todos', 'todos');
registerRouteIfExists('/api/conflicts', 'conflicts');
registerRouteIfExists('/api/terminology', 'terminology');
registerRouteIfExists('/api/versions', 'versions');
registerRouteIfExists('/api/import', 'import');
registerRouteIfExists('/api/export', 'export');
registerRouteIfExists('/api/views', 'views');
registerRouteIfExists('/api/process-governance/guidance', 'governanceGuidance');
registerRouteIfExists('/api/process-governance', 'processGovernance');
registerRouteIfExists('/api/process-design/editor', 'processDesignEditor');
registerRouteIfExists('/api/process-design', process.env.PROCESS_GOVERNANCE_READ_MODEL === 'mysql' ? 'processDesignMysql' : 'processDesign');
registerRouteIfExists('/api/process-v7-preview', 'processV7PreviewReview');
registerRouteIfExists('/api/role-workbench', 'roleWorkbench');
registerRouteIfExists('/api/page-workflows', 'pageWorkflows');
registerRouteIfExists('/api/org-units', 'orgUnit');
registerRouteIfExists('/api/positions', 'position');
if (process.env.MDM_ALLOW_LEGACY_TEST_MODE === '1') {
  registerRouteIfExists('/api/persons', 'person');
}
registerRouteIfExists('/api/product-families', 'productFamily');
registerRouteIfExists('/api/products', 'product');
registerRouteIfExists('/api/class-nodes', 'classNode');
registerRouteIfExists('/api/attributes', 'attribute');
registerRouteIfExists('/api/external', 'external');
registerRouteIfExists('/api/integration', 'integration');
registerRouteIfExists('/api/quality', 'quality');
registerRouteIfExists('/api/roles', 'roles');
registerRouteIfExists('/api/import-rbac', 'importRbac');
registerRouteIfExists('/api/activity', 'activity');

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', identityModel: 'person', governanceModelVersion: ACCESS_MODEL_VERSION });
});

app.listen(PORT, () => {
  console.log(`MDM 平台 running on http://localhost:${PORT}`);
});
