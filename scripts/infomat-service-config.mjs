import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const configPath = path.join(scriptDir, 'infomat-services.config.json');

export const INFOMAT_SERVICE_CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf8'));

export function localEnvPath(rootDir = repoRoot) {
  return path.join(rootDir, 'scripts', 'infomat-services.local.env');
}

export function parseLocalEnv(text) {
  const parsed = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const splitAt = trimmed.indexOf('=');
    if (splitAt <= 0) continue;
    const key = trimmed.slice(0, splitAt).trim();
    const value = trimmed.slice(splitAt + 1).trim();
    if (key) parsed[key] = value;
  }
  return parsed;
}

export function loadLocalServiceEnv(rootDir = repoRoot) {
  const filePath = localEnvPath(rootDir);
  if (!fs.existsSync(filePath)) return {};
  return parseLocalEnv(fs.readFileSync(filePath, 'utf8'));
}

function requireValue(env, key) {
  if (!env[key]) {
    throw new Error(
      `Missing ${key}. Set it in scripts/infomat-services.local.env or the current shell before starting Infomat services.`
    );
  }
  return env[key];
}

export function buildFixedServiceEnv(baseEnv = process.env, rootDir = repoRoot) {
  const localEnv = loadLocalServiceEnv(rootDir);
  const secrets = { ...baseEnv, ...localEnv };
  const config = INFOMAT_SERVICE_CONFIG;

  const fixed = {
    ...baseEnv,
    ...localEnv,
    INFOMAT_MDM_URL: `http://${config.mdm.host}:${config.mdm.port}`,
    INFOMAT_PMO_URL: `http://${config.pmo.host}:${config.pmo.port}`,
    PORT: String(config.mdm.port),
    MYSQL_HOST: config.mysql.host,
    MYSQL_PORT: String(config.mysql.port),
    MYSQL_USER: config.mysql.user,
    MYSQL_PASSWORD: requireValue(secrets, 'MYSQL_PASSWORD'),
    MYSQL_DATABASE: config.mysql.database,
    MYSQL_CONNECTION_LIMIT: String(config.mysql.connectionLimit),
    MDM_IDENTITY_READ_MODEL: config.readModels.identity,
    PROCESS_GOVERNANCE_READ_MODEL: config.readModels.processGovernance,
    MDM_ADMIN_EMPLOYEE_NO: config.admin.employeeNo,
    MDM_ADMIN_PASSWORD: requireValue(secrets, 'MDM_ADMIN_PASSWORD'),
    ALLOW_INSECURE_SESSION_SECRET: config.session.allowInsecureDevSecret
  };

  if (secrets.SESSION_SECRET) fixed.SESSION_SECRET = secrets.SESSION_SECRET;
  return fixed;
}

export function redactedFixedServiceEnv(env) {
  return {
    mdmUrl: env.INFOMAT_MDM_URL,
    pmoUrl: env.INFOMAT_PMO_URL,
    mysql: {
      host: env.MYSQL_HOST,
      port: Number(env.MYSQL_PORT),
      user: env.MYSQL_USER,
      database: env.MYSQL_DATABASE,
      password: env.MYSQL_PASSWORD ? '***' : ''
    },
    readModels: {
      identity: env.MDM_IDENTITY_READ_MODEL,
      processGovernance: env.PROCESS_GOVERNANCE_READ_MODEL
    },
    adminEmployeeNo: env.MDM_ADMIN_EMPLOYEE_NO
  };
}
