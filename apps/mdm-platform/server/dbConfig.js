const path = require('path');

function resolveDbPath(env = process.env) {
  const defaultDataDir = path.join(__dirname, '../data');
  return env.MDM_DB_PATH
    ? path.resolve(env.MDM_DB_PATH)
    : path.join(defaultDataDir, 'platform.db');
}

module.exports = { resolveDbPath };
