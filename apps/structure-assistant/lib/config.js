'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { AppError } = require('./errors');

const APP_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(APP_ROOT, '..', '..');
const DEFAULT_CONFIG_PATH = path.join(APP_ROOT, 'config', 'pilot.config.json');
const DEFAULT_LOCAL_ENV_PATH = path.join(REPO_ROOT, 'scripts', 'structure-pilot.local.env');

function parseBoolean(value) {
  return /^(1|true|yes)$/i.test(String(value || '').trim());
}

function parseLocalEnv(text) {
  const result = {};
  for (const sourceLine of String(text || '').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const splitAt = line.indexOf('=');
    if (splitAt <= 0) continue;
    const key = line.slice(0, splitAt).trim();
    let value = line.slice(splitAt + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

function loadLocalEnv(filePath = DEFAULT_LOCAL_ENV_PATH) {
  if (!fs.existsSync(filePath)) return {};
  return parseLocalEnv(fs.readFileSync(filePath, 'utf8'));
}

function numberFrom(env, key, fallback) {
  const value = env[key];
  if (value == null || value === '') return Number(fallback);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new AppError(500, 'INVALID_CONFIGURATION', `${key}必须是数字。`);
  return parsed;
}

function listFrom(value, fallback = []) {
  const values = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  return values.length ? values : [...fallback];
}

function loadRuntimeConfig(options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  const fixed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const localEnv = options.localEnv === false ? {} : loadLocalEnv(options.localEnvPath);
  const env = { ...localEnv, ...(options.env || process.env) };
  const strictSecrets = options.strictSecrets !== false;
  const runtimeDir = path.resolve(
    env.STRUCTURE_ASSISTANT_RUNTIME_DIR || path.join(os.tmpdir(), 'infomat-structure-pilot')
  );

  const accounts = fixed.accounts.map(account => ({
    ...account,
    passwordHash: env[account.passwordHashEnv] || ''
  }));

  const requiredSecrets = [
    'STRUCTURE_ASSISTANT_SESSION_SECRET',
    ...fixed.accounts.map(account => account.passwordHashEnv)
  ];
  const missingSecrets = requiredSecrets.filter(key => !env[key]);
  if (strictSecrets && missingSecrets.length) {
    throw new AppError(
      500,
      'MISSING_CONFIGURATION',
      `缺少试点本机配置：${missingSecrets.join('、')}。`
    );
  }

  return {
    appRoot: APP_ROOT,
    repoRoot: REPO_ROOT,
    configPath,
    assistant: {
      host: env.STRUCTURE_ASSISTANT_HOST || fixed.assistant.host,
      port: numberFrom(env, 'STRUCTURE_ASSISTANT_PORT', fixed.assistant.port),
      gatewayPort: numberFrom(env, 'STRUCTURE_ASSISTANT_GATEWAY_PORT', fixed.assistant.gatewayPort),
      structuredToolBaseUrl: env.STRUCTURED_TOOL_BASE_URL || fixed.assistant.structuredToolBaseUrl
    },
    security: {
      ...fixed.security,
      sessionHours: numberFrom(env, 'STRUCTURE_ASSISTANT_SESSION_HOURS', fixed.security.sessionHours),
      allowHttp: parseBoolean(env.STRUCTURE_ASSISTANT_ALLOW_HTTP),
      allowDirty: parseBoolean(env.STRUCTURE_ASSISTANT_ALLOW_DIRTY),
      sessionSecret: env.STRUCTURE_ASSISTANT_SESSION_SECRET || 'test-only-session-secret',
      tlsCertPath: env.STRUCTURE_ASSISTANT_TLS_CERT_PATH || '',
      tlsKeyPath: env.STRUCTURE_ASSISTANT_TLS_KEY_PATH || ''
    },
    deepseek: {
      ...fixed.deepseek,
      baseUrl: env.DEEPSEEK_BASE_URL || fixed.deepseek.baseUrl
    },
    dsh: {
      ...fixed.dsh,
      nodeExecutable: env.STRUCTURE_ASSISTANT_DSH_NODE_PATH || process.execPath,
      trustedPublicHosts: listFrom(
        env.STRUCTURE_ASSISTANT_PUBLIC_HOSTS,
        fixed.dsh.trustedPublicHosts
      )
    },
    accounts,
    runtime: {
      dir: runtimeDir,
      usageLogPath: path.join(runtimeDir, 'usage-metadata.jsonl'),
      maintenancePath: path.join(runtimeDir, 'maintenance.json'),
      dshRoot: path.join(runtimeDir, 'dsh')
    }
  };
}

module.exports = {
  APP_ROOT,
  REPO_ROOT,
  DEFAULT_CONFIG_PATH,
  DEFAULT_LOCAL_ENV_PATH,
  parseBoolean,
  parseLocalEnv,
  loadLocalEnv,
  loadRuntimeConfig
};
