'use strict';

const path = require('path');

const MB = 1024 * 1024;

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function configFromEnv(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const scannerCommand = String(env.COLLECTION_AV_SCAN_COMMAND || '').trim();
  return {
    production,
    bindHost: env.COLLECTION_BIND_HOST || '127.0.0.1',
    adminPort: numberFromEnv(env.COLLECTION_ADMIN_PORT, 4000),
    respondentPort: numberFromEnv(env.COLLECTION_RESPONDENT_PORT, 4001),
    mysql: {
      host: env.MYSQL_HOST || '127.0.0.1',
      port: numberFromEnv(env.MYSQL_PORT, 3306),
      user: env.MYSQL_USER || 'root',
      password: env.MYSQL_PASSWORD || '',
      database: env.MYSQL_DATABASE || 'infomat_mdm',
      waitForConnections: true,
      connectionLimit: numberFromEnv(env.MYSQL_CONNECTION_LIMIT, 10),
      charset: 'utf8mb4',
      timezone: '+08:00'
    },
    fileRoot: path.resolve(env.COLLECTION_FILE_ROOT || path.join(__dirname, '..', '..', '..', 'artifacts', 'information-collection', 'files')),
    secureCookies: booleanFromEnv(env.COLLECTION_SECURE_COOKIES, production),
    trustProxy: booleanFromEnv(env.COLLECTION_TRUST_PROXY, production),
    sessionHours: numberFromEnv(env.COLLECTION_SESSION_HOURS, 12),
    attachment: {
      enabled: !production || Boolean(scannerCommand),
      scannerCommand,
      scannerArgs: env.COLLECTION_AV_SCAN_ARGS || '["{file}"]',
      maxFileBytes: numberFromEnv(env.COLLECTION_MAX_FILE_MB, 20) * MB,
      maxFilesPerField: numberFromEnv(env.COLLECTION_MAX_FILES_PER_FIELD, 5),
      maxTaskBytes: numberFromEnv(env.COLLECTION_MAX_TASK_ATTACHMENT_MB, 2048) * MB
    }
  };
}

function publicConfig(config) {
  return {
    bindHost: config.bindHost,
    adminPort: config.adminPort,
    respondentPort: config.respondentPort,
    mysql: {
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      database: config.mysql.database,
      password: config.mysql.password ? '***' : ''
    },
    fileRoot: config.fileRoot,
    secureCookies: config.secureCookies,
    attachmentEnabled: config.attachment.enabled
  };
}

module.exports = { configFromEnv, publicConfig };
