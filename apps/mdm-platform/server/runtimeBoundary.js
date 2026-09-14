// Runtime selection only. This module never opens a database or applies a migration.
function legacyTestMode(env = process.env) {
  return env.NODE_ENV !== 'production' && env.MDM_ALLOW_LEGACY_TEST_MODE === '1';
}

function assertRuntimeConfig(env = process.env) {
  if (env.NODE_ENV === 'production' && env.MDM_ALLOW_LEGACY_TEST_MODE === '1') {
    throw new Error('MDM_LEGACY_MODE_FORBIDDEN: production cannot enable legacy test routes');
  }
  if (legacyTestMode(env)) {
    if (!env.MDM_DB_PATH) throw new Error('MDM_DB_PATH is required for isolated legacy tests');
    const path = require('path');
    if (path.resolve(env.MDM_DB_PATH).toLowerCase() === path.resolve(__dirname, '../data/platform.db').toLowerCase()) {
      throw new Error('LEGACY_SQLITE_SHARED_DB_FORBIDDEN: select an isolated database path');
    }
    return;
  }
  for (const key of ['MDM_IDENTITY_READ_MODEL', 'PROCESS_GOVERNANCE_READ_MODEL']) {
    if (env[key] !== 'mysql') throw new Error(`MDM_RUNTIME_CONFIG_INVALID: ${key}=mysql is required`);
  }
  for (const key of ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']) {
    if (!String(env[key] || '').trim()) throw new Error(`MDM_RUNTIME_CONFIG_INVALID: ${key} is required`);
  }
  const port = Number(env.MYSQL_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MYSQL_PORT must be a valid port');
  if (env.MYSQL_CONNECTION_LIMIT !== undefined &&
      (!Number.isInteger(Number(env.MYSQL_CONNECTION_LIMIT)) || Number(env.MYSQL_CONNECTION_LIMIT) < 1)) {
    throw new Error('MYSQL_CONNECTION_LIMIT must be a positive integer');
  }
  for (const key of ['PROCESS_INPUT_BASELINE_REVIEW_STORE', 'PROCESS_CANDIDATE_REVIEW_STORE']) {
    if (env[key] && env[key] !== 'mysql') throw new Error(`MDM_RUNTIME_CONFIG_INVALID: ${key} must use mysql`);
  }
}

function rejectLegacyRoute(req, res) {
  return res.status(410).json({
    code: 'LEGACY_SQLITE_ROUTE_ISOLATED',
    error: '此历史功能入口已暂停，已有资料保留。请联系项目负责人确认后续承接范围。'
  });
}

module.exports = { assertRuntimeConfig, legacyTestMode, rejectLegacyRoute };
