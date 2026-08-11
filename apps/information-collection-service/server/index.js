'use strict';

const fs = require('fs');
const mysql = require('mysql2/promise');
const { createApps } = require('./app');
const { configFromEnv, publicConfig } = require('./config');
const { checkSchema } = require('./schema');

async function listen(app, port, host) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once('error', reject);
  });
}

async function main() {
  const config = configFromEnv();
  const pool = mysql.createPool(config.mysql);
  const schema = await checkSchema(pool);
  if (!schema.identity.ok || schema.missingTables.length || !schema.migrationApplied) {
    throw new Error(`Information collection schema is not ready. Run npm run migrate:dry-run then npm run migrate:apply. Missing: ${schema.missingTables.join(', ') || schema.identity.missing.join(', ')}`);
  }
  const [[adminCount]] = await pool.execute(
    "SELECT COUNT(*) AS total FROM collection_app_grants WHERE role_code='collection_admin' AND scope_type='global' AND status='active'"
  );
  if (Number(adminCount.total) < 1) throw new Error('No active collection_admin. Run npm run bootstrap:admin with COLLECTION_BOOTSTRAP_ADMIN_EMPLOYEE_NO.');
  fs.mkdirSync(config.fileRoot, { recursive: true });
  const { adminApp, respondentApp, service } = createApps({ pool, config });
  let adminServer;
  let respondentServer;
  try {
    adminServer = await listen(adminApp, config.adminPort, config.bindHost);
    respondentServer = await listen(respondentApp, config.respondentPort, config.bindHost);
  } catch (error) {
    if (adminServer) await new Promise(resolve => adminServer.close(resolve));
    if (respondentServer) await new Promise(resolve => respondentServer.close(resolve));
    await pool.end();
    throw error;
  }
  const timer = setInterval(() => service.reconcileTaskStatuses().catch(error => console.error('[information-collection] task reconcile failed:', error.message)), 60_000);
  timer.unref();
  console.log(JSON.stringify({ status: 'started', ...publicConfig(config) }));
  async function shutdown() {
    clearInterval(timer);
    await Promise.all([
      new Promise(resolve => adminServer.close(resolve)),
      new Promise(resolve => respondentServer.close(resolve))
    ]);
    await pool.end();
  }
  process.once('SIGINT', () => shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => shutdown().finally(() => process.exit(0)));
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[information-collection] startup failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
