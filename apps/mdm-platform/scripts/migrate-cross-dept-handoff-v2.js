const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { mysqlConfigFromEnv } = require('../server/mysqlConfig');
const {
  inspectCrossDeptHandoffV2,
  applyCrossDeptHandoffV2,
  compensateCrossDeptHandoffV2
} = require('../server/crossDeptHandoffV2Migration');

function loadLocalServiceEnvironment() {
  const scriptsDir = path.resolve(__dirname, '../../../scripts');
  const configPath = path.join(scriptsDir, 'infomat-services.config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.mysql) {
      process.env.MYSQL_HOST = String(config.mysql.host || process.env.MYSQL_HOST || '');
      process.env.MYSQL_PORT = String(config.mysql.port || process.env.MYSQL_PORT || '');
      process.env.MYSQL_USER = String(config.mysql.user || process.env.MYSQL_USER || '');
      process.env.MYSQL_DATABASE = String(config.mysql.database || process.env.MYSQL_DATABASE || '');
      process.env.MYSQL_CONNECTION_LIMIT = String(config.mysql.connectionLimit || process.env.MYSQL_CONNECTION_LIMIT || '');
    }
  }
  const envPath = path.join(scriptsDir, 'infomat-services.local.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}

function argumentValue(prefix) {
  const argument = process.argv.slice(2).find(item => item.startsWith(`${prefix}=`));
  return argument ? argument.slice(prefix.length + 1) : '';
}

async function main() {
  loadLocalServiceEnvironment();
  const args = new Set(process.argv.slice(2));
  const pool = mysql.createPool(mysqlConfigFromEnv());
  try {
    if (args.has('--dry-run')) {
      console.log(JSON.stringify({ mode: 'dry-run', ...(await inspectCrossDeptHandoffV2(pool)) }, null, 2));
      return;
    }
    if (args.has('--apply')) {
      const result = await applyCrossDeptHandoffV2(pool, { batchKey: argumentValue('--batch') || undefined });
      console.log(JSON.stringify({ mode: 'apply', ...result }, null, 2));
      return;
    }
    if (args.has('--compensate')) {
      const batchKey = argumentValue('--batch');
      if (!batchKey) throw new Error('补偿操作必须提供 --batch=<apply返回的backup_batch>');
      const result = await compensateCrossDeptHandoffV2(pool, batchKey);
      console.log(JSON.stringify({ mode: 'compensate', ...result }, null, 2));
      return;
    }
    throw new Error('必须明确指定 --dry-run、--apply 或 --compensate');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
