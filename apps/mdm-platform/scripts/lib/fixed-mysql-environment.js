const fs = require('node:fs');
const path = require('node:path');

function parseLocalEnv(source) {
  const result = {};
  for (const line of String(source || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (key) result[key] = value;
  }
  return result;
}

function loadFixedMysqlEnvironment(baseEnv = process.env, repositoryRoot = path.resolve(__dirname, '../../../..')) {
  const scriptsDirectory = path.join(repositoryRoot, 'scripts');
  const configPath = path.join(scriptsDirectory, 'infomat-services.config.json');
  const localEnvPath = path.join(scriptsDirectory, 'infomat-services.local.env');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const localEnv = fs.existsSync(localEnvPath)
    ? parseLocalEnv(fs.readFileSync(localEnvPath, 'utf8'))
    : {};
  const secrets = { ...baseEnv, ...localEnv };
  if (!secrets.MYSQL_PASSWORD) {
    throw new Error('Missing MYSQL_PASSWORD. Set it in scripts/infomat-services.local.env or the current shell.');
  }
  return {
    ...baseEnv,
    ...localEnv,
    MYSQL_HOST: String(config.mysql.host),
    MYSQL_PORT: String(config.mysql.port),
    MYSQL_USER: String(config.mysql.user),
    MYSQL_PASSWORD: String(secrets.MYSQL_PASSWORD),
    MYSQL_DATABASE: String(config.mysql.database),
    MYSQL_CONNECTION_LIMIT: String(config.mysql.connectionLimit)
  };
}

module.exports = {
  loadFixedMysqlEnvironment,
  parseLocalEnv
};
