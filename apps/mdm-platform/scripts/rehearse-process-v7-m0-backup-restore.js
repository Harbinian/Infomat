#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const { canonicalCreateTable, inspectFormalProcessBaseline } = require('../server/processV7PreviewReviewMigration');
const { digest } = require('../server/processV7M0Baseline');
const { loadFixedMysqlEnvironment } = require('./lib/fixed-mysql-environment');

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function option(args, name) {
  const value = args.find(argument => argument.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : null;
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: options.encoding === null ? null : 'utf8',
    input: options.input,
    maxBuffer: 1024 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0) {
    const error = new Error(options.errorMessage || `Docker命令失败：${args[0] || 'unknown'}`);
    error.code = options.code || 'M0_DOCKER_COMMAND_FAILED';
    error.detail = String(result.stderr || '').trim().slice(0, 2000);
    throw error;
  }
  return result.stdout;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function recoverableSchema(value) {
  return canonicalCreateTable(value)
    .replace(/\bcharacter set utf8mb4\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\)\s+collate\b/g, ')collate')
    .trim();
}

async function waitForMysql(port, password) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let connection;
    try {
      connection = await mysql.createConnection({
        host: '127.0.0.1',
        port,
        user: 'root',
        password,
        connectTimeout: 1000
      });
      await connection.execute('SELECT 1');
      await connection.end();
      return;
    } catch (_error) {
      if (connection) await connection.end().catch(() => {});
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const error = new Error('隔离MySQL容器在60秒内没有就绪');
  error.code = 'M0_RESTORE_MYSQL_NOT_READY';
  throw error;
}

async function databaseInventory(pool, databaseName) {
  const [tables] = await pool.execute(`
    SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=?
    ORDER BY TABLE_NAME
  `, [databaseName]);
  const result = [];
  for (const table of tables) {
    const tableName = String(table.table_name);
    const [createRows] = await pool.execute(`SHOW CREATE TABLE \`${tableName}\``);
    const createSql = createRows[0] && (createRows[0]['Create Table'] || createRows[0]['Create View']) || '';
    let rowCount = null;
    if (String(table.table_type).toUpperCase() === 'BASE TABLE') {
      const [countRows] = await pool.execute(`SELECT COUNT(*) AS row_count FROM \`${tableName}\``);
      rowCount = Number(countRows[0] && countRows[0].row_count || 0);
    }
    result.push({
      table_name: tableName,
      table_type: String(table.table_type),
      row_count: rowCount,
      schema_digest: sha256(Buffer.from(recoverableSchema(createSql), 'utf8'))
    });
  }
  return { objects: result, digest: digest(result) };
}

async function main() {
  const args = process.argv.slice(2);
  const runStamp = timestamp();
  const repositoryRoot = path.resolve(__dirname, '../../..');
  const fixedConfig = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'scripts', 'infomat-services.config.json'), 'utf8'));
  const sourceContainer = String(fixedConfig.mysql && fixedConfig.mysql.dockerContainer || '');
  const sourceDatabase = String(fixedConfig.mysql && fixedConfig.mysql.database || '');
  if (sourceDatabase !== 'infomat_mdm' || sourceContainer !== 'infomat-input-baseline-review-mysql') {
    throw Object.assign(new Error('固定MySQL目标与演练允许清单不一致'), { code: 'M0_TARGET_NOT_ALLOWLISTED' });
  }
  const restoreContainer = `infomat-m0-restore-${runStamp}`;
  if (!/^infomat-m0-restore-\d{14}$/.test(restoreContainer)) {
    throw Object.assign(new Error('隔离容器名称不符合安全规则'), { code: 'M0_RESTORE_TARGET_INVALID' });
  }
  const backupDirectory = path.join(os.homedir(), 'Documents', 'Infomat-Backups');
  const backupPath = path.join(backupDirectory, `infomat_mdm-m0-${runStamp}.sql`);
  const evidencePath = path.resolve(process.cwd(), option(args, '--evidence') || `output/process-v7-m0/backup-restore-${runStamp}.json`);
  fs.mkdirSync(backupDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });

  const sourceConfig = mysqlConfigFromEnv(loadFixedMysqlEnvironment());
  const sourcePool = mysql.createPool(sourceConfig);
  const restorePassword = crypto.randomBytes(32).toString('hex');
  let restorePool = null;
  let isolatedContainerCreated = false;
  let evidence;
  let stage = 'preflight';
  try {
    const existing = String(docker(['ps', '-a', '--filter', `name=^/${restoreContainer}$`, '--format', '{{.Names}}'])).trim();
    if (existing) throw Object.assign(new Error('隔离恢复容器名称已经存在，拒绝覆盖'), { code: 'M0_RESTORE_CONTAINER_EXISTS' });

    stage = 'source_baseline_before_backup';
    const sourceBefore = await databaseInventory(sourcePool, sourceDatabase);
    const formalBefore = await inspectFormalProcessBaseline(sourcePool);
    stage = 'logical_backup';
    const dump = docker([
      'exec', sourceContainer, 'sh', '-lc',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF infomat_mdm'
    ], { encoding: null, errorMessage: '全库逻辑备份失败', code: 'M0_BACKUP_FAILED' });
    if (!Buffer.isBuffer(dump) || dump.length < 1024) {
      throw Object.assign(new Error('全库逻辑备份内容为空或异常过小'), { code: 'M0_BACKUP_EMPTY' });
    }
    fs.writeFileSync(backupPath, dump, { mode: 0o600 });
    stage = 'source_baseline_after_backup';
    const sourceAfter = await databaseInventory(sourcePool, sourceDatabase);
    const formalAfter = await inspectFormalProcessBaseline(sourcePool);
    if (sourceBefore.digest !== sourceAfter.digest || formalBefore.digest !== formalAfter.digest) {
      throw Object.assign(new Error('备份窗口内正式数据库发生变化，当前备份不作为M0基线'), { code: 'M0_SOURCE_CHANGED_DURING_BACKUP' });
    }

    stage = 'create_restore_container';
    docker([
      'run', '-d', '--name', restoreContainer,
      '-e', `MYSQL_ROOT_PASSWORD=${restorePassword}`,
      '-p', '127.0.0.1::3306',
      'mysql:8.4'
    ], { errorMessage: '隔离恢复容器创建失败', code: 'M0_RESTORE_CONTAINER_CREATE_FAILED' });
    isolatedContainerCreated = true;
    const portOutput = String(docker(['port', restoreContainer, '3306/tcp'])).trim();
    const portMatch = portOutput.match(/127\.0\.0\.1:(\d+)/);
    if (!portMatch) throw Object.assign(new Error('无法取得隔离MySQL端口'), { code: 'M0_RESTORE_PORT_NOT_FOUND' });
    const restorePort = Number(portMatch[1]);
    stage = 'wait_restore_container';
    await waitForMysql(restorePort, restorePassword);
    stage = 'create_restore_database';
    restorePool = mysql.createPool({
      host: '127.0.0.1',
      port: restorePort,
      user: 'root',
      password: restorePassword,
      database: 'mysql',
      connectionLimit: 2,
      charset: 'utf8mb4'
    });
    await restorePool.execute(`CREATE DATABASE \`${sourceDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    stage = 'restore_backup';
    docker([
      'exec', '-i', '-e', `MYSQL_PWD=${restorePassword}`, restoreContainer,
      'mysql', '-uroot', sourceDatabase
    ], { input: dump, encoding: null, errorMessage: '隔离数据库恢复失败', code: 'M0_RESTORE_FAILED' });
    stage = 'reconnect_restored_database';
    await restorePool.end();
    restorePool = mysql.createPool({
      host: '127.0.0.1',
      port: restorePort,
      user: 'root',
      password: restorePassword,
      database: sourceDatabase,
      connectionLimit: 2,
      charset: 'utf8mb4'
    });
    stage = 'verify_restored_database';
    const restoredInventory = await databaseInventory(restorePool, sourceDatabase);
    const restoredFormal = await inspectFormalProcessBaseline(restorePool);
    const inventoryMatches = sourceBefore.digest === restoredInventory.digest;
    const formalRowsBefore = Object.fromEntries(Object.entries(formalBefore.tables).map(([tableName, value]) => [tableName, {
      row_count: value.row_count,
      row_digest: value.row_digest
    }]));
    const formalRowsRestored = Object.fromEntries(Object.entries(restoredFormal.tables).map(([tableName, value]) => [tableName, {
      row_count: value.row_count,
      row_digest: value.row_digest
    }]));
    const formalRowsBeforeDigest = digest(formalRowsBefore);
    const formalRowsRestoredDigest = digest(formalRowsRestored);
    const formalMatches = formalRowsBeforeDigest === formalRowsRestoredDigest;
    if (!inventoryMatches || !formalMatches) {
      const restoredByName = new Map(restoredInventory.objects.map(item => [item.table_name, item]));
      const objectDifferences = sourceBefore.objects.flatMap(sourceObject => {
        const restoredObject = restoredByName.get(sourceObject.table_name);
        if (!restoredObject) return [{ table_name: sourceObject.table_name, difference: 'missing_after_restore' }];
        const differences = [];
        if (sourceObject.table_type !== restoredObject.table_type) differences.push('table_type');
        if (sourceObject.row_count !== restoredObject.row_count) differences.push('row_count');
        if (sourceObject.schema_digest !== restoredObject.schema_digest) differences.push('schema_digest');
        return differences.length ? [{ table_name: sourceObject.table_name, difference: differences }] : [];
      });
      for (const restoredObject of restoredInventory.objects) {
        if (!sourceBefore.objects.some(item => item.table_name === restoredObject.table_name)) {
          objectDifferences.push({ table_name: restoredObject.table_name, difference: 'unexpected_after_restore' });
        }
      }
      const error = Object.assign(new Error('隔离恢复后的对象、行数或正式流程摘要与备份基线不一致'), {
        code: 'M0_RESTORE_VERIFY_FAILED'
      });
      error.detail = JSON.stringify({
        source_inventory_digest: sourceBefore.digest,
        restored_inventory_digest: restoredInventory.digest,
        source_formal_row_digest: formalRowsBeforeDigest,
        restored_formal_row_digest: formalRowsRestoredDigest,
        object_differences: objectDifferences,
        formal_table_digests: Object.fromEntries(Object.keys(formalBefore.tables).map(tableName => [tableName, {
          source: formalBefore.tables[tableName],
          restored: restoredFormal.tables[tableName]
        }]))
      });
      throw error;
    }
    evidence = {
      status: 'verified',
      verified_at: new Date().toISOString(),
      source: redactMysqlConfig(sourceConfig),
      backup: {
        path: backupPath,
        bytes: dump.length,
        sha256: sha256(dump),
        method: 'mysqldump --single-transaction --routines --triggers --events --hex-blob'
      },
      restore: {
        isolation: 'dedicated temporary mysql:8.4 container',
        container_name: restoreContainer,
        database_name: sourceDatabase,
        object_count: restoredInventory.objects.length,
        inventory_digest: restoredInventory.digest,
        formal_process_row_digest: formalRowsRestoredDigest,
        inventory_matches_source: inventoryMatches,
        formal_process_matches_source: formalMatches,
        container_removed_after_verification: true
      }
    };
    stage = 'verified';
  } catch (error) {
    error.stage = stage;
    if (isolatedContainerCreated && error.code !== 'M0_RESTORE_VERIFY_FAILED') {
      const logs = spawnSync('docker', ['logs', '--tail', '80', restoreContainer], {
        encoding: 'utf8',
        windowsHide: true
      });
      error.detail = [String(logs.stderr || ''), String(logs.stdout || ''), error.detail]
        .filter(Boolean)
        .join('\n')
        .trim()
        .slice(-6000);
    }
    throw error;
  } finally {
    await sourcePool.end();
    if (restorePool) await restorePool.end().catch(() => {});
    if (isolatedContainerCreated) {
      if (!/^infomat-m0-restore-\d{14}$/.test(restoreContainer)) {
        throw Object.assign(new Error('隔离容器清理目标校验失败'), { code: 'M0_RESTORE_CLEANUP_TARGET_INVALID' });
      }
      docker(['rm', '-f', restoreContainer], { errorMessage: '隔离恢复容器清理失败', code: 'M0_RESTORE_CLEANUP_FAILED' });
    }
  }
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    status: evidence.status,
    evidence_path: evidencePath,
    backup_path: evidence.backup.path,
    backup_bytes: evidence.backup.bytes,
    backup_sha256: evidence.backup.sha256,
    restored_object_count: evidence.restore.object_count,
    inventory_matches_source: evidence.restore.inventory_matches_source,
    formal_process_matches_source: evidence.restore.formal_process_matches_source,
    isolated_container_removed: true
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    error: error.message || String(error),
    code: error.code || 'M0_BACKUP_RESTORE_REHEARSAL_FAILED',
    detail: error.detail || undefined,
    stage: error.stage || undefined
  }, null, 2)}\n`);
  process.exitCode = 1;
});
