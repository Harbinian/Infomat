const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'mdm-platform-dev-secret-change-me';

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

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

function registerRouteIfExists(basePath, routeName) {
  const routePath = path.join(__dirname, 'routes', `${routeName}.js`);
  if (fs.existsSync(routePath)) {
    app.use(basePath, require(routePath));
  }
}

registerRouteIfExists('/api/org', 'org');
registerRouteIfExists('/api/systems', 'systems');
registerRouteIfExists('/api/capabilities', 'capabilities');
registerRouteIfExists('/api/processes', 'processes');
registerRouteIfExists('/api/mappings', 'mappings');
registerRouteIfExists('/api/field-entries', 'fieldEntries');
registerRouteIfExists('/api/field-identities', 'fieldIdentities');
registerRouteIfExists('/api/todos', 'todos');
registerRouteIfExists('/api/conflicts', 'conflicts');
registerRouteIfExists('/api/terminology', 'terminology');
registerRouteIfExists('/api/versions', 'versions');
registerRouteIfExists('/api/import', 'import');
registerRouteIfExists('/api/export', 'export');
registerRouteIfExists('/api/views', 'views');
registerRouteIfExists('/api/master-data', 'masterData');
registerRouteIfExists('/api/master-data', 'masterDataLifecycle');

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`MDM 平台 running on http://localhost:${PORT}`);
});
