#!/usr/bin/env node
/**
 * Optional real MySQL smoke for the Data Map field domain.
 *
 * It runs only when MYSQL_HOST, MYSQL_USER and MYSQL_DATABASE are set.
 */
const assert = require('assert');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const { makeDataMapMysqlRepository } = require('../server/dataMapMysqlRepository');

const REQUIRED_MYSQL_SMOKE_ENV = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE'];

function mysqlSmokeReadiness(env = process.env) {
  if (String(env.MDM_MYSQL_SMOKE || '').trim() === '0') {
    return { ready: false, reason: 'disabled', missing: [] };
  }
  const missing = REQUIRED_MYSQL_SMOKE_ENV.filter(key => !String(env[key] || '').trim());
  if (missing.length) {
    return { ready: false, reason: `missing ${missing.join(', ')}`, missing };
  }
  return { ready: true, reason: '', missing: [] };
}

async function cleanupSmokeRows(pool, contextKey, objectKey) {
  const [contextRows] = await pool.execute('SELECT id FROM data_map_contexts WHERE context_key=?', [contextKey]);
  const contextIds = contextRows.map(row => Number(row.id)).filter(Boolean);
  for (const contextId of contextIds) {
    const [fieldRows] = await pool.execute('SELECT id FROM data_map_fields WHERE context_id=?', [contextId]);
    const fieldIds = fieldRows.map(row => Number(row.id)).filter(Boolean);
    if (fieldIds.length) {
      const placeholders = fieldIds.map(() => '?').join(', ');
      await pool.execute(`DELETE FROM data_map_field_identities WHERE field_id IN (${placeholders})`, fieldIds);
      await pool.execute(`DELETE FROM data_map_field_system_links WHERE field_id IN (${placeholders})`, fieldIds);
      await pool.execute(`DELETE FROM data_map_quality_issues WHERE field_id IN (${placeholders})`, fieldIds);
      await pool.execute(`DELETE FROM data_map_fields WHERE id IN (${placeholders})`, fieldIds);
    }
    await pool.execute('DELETE FROM data_map_quality_issues WHERE context_id=?', [contextId]);
    await pool.execute('DELETE FROM data_map_contexts WHERE id=?', [contextId]);
  }
  await pool.execute('DELETE FROM data_map_objects WHERE object_key=?', [objectKey]);
}

async function runDataMapMysqlSmoke({ env = process.env, log = console.log } = {}) {
  const readiness = mysqlSmokeReadiness(env);
  if (!readiness.ready) {
    const result = { skipped: true, reason: readiness.reason, missing: readiness.missing };
    log(`data_map_mysql_smoke_skipped=${readiness.reason}`);
    return result;
  }

  const config = mysqlConfigFromEnv(env);
  const pool = mysql.createPool(config);
  const repo = makeDataMapMysqlRepository(pool);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const contextKey = `smoke-data-map-${suffix}`;
  const objectKey = `smoke-object-${suffix}`;

  try {
    await repo.initSchema();
    const context = await repo.createContext({
      context_key: contextKey,
      title: 'Data Map MySQL Smoke Context',
      dept_name: '质量管理部',
      source_file: 'smoke-data-map-mysql.js'
    }, 1);
    const field = await repo.createField({
      context_id: context.id,
      object_key: objectKey,
      data_object: '客户',
      field_name_cn: '客户名称',
      field_name_en: 'customer_name',
      field_type: '文本',
      note: '真实 MySQL 冒烟字段',
      consume_systems: ['CRM'],
      sync_mode: 'manual'
    }, 1);
    await repo.upsertFieldIdentity(field.id, {
      authoritative_system_name: 'CRM',
      confidence_level: 'high',
      note: 'smoke'
    });
    const identity = await repo.confirmFieldIdentity(field.id, {
      authoritative_system_name: 'CRM'
    }, 1);
    const fields = await repo.getFieldsByContext(context.id);
    const progress = await repo.fieldIdentityProgress();

    assert.strictEqual(fields.length, 1);
    assert.strictEqual(fields[0].field_name_cn, '客户名称');
    assert.ok(identity && identity.confirmed);
    assert.ok(progress.overall.total >= 1);

    const result = {
      skipped: false,
      context_id: context.id,
      field_id: field.id,
      confirmed: identity.confirmed,
      mysql: redactMysqlConfig(config)
    };
    log(`data_map_mysql_smoke_passed=${JSON.stringify(result)}`);
    return result;
  } finally {
    try {
      await cleanupSmokeRows(pool, contextKey, objectKey);
    } finally {
      await pool.end();
    }
  }
}

if (require.main === module) {
  runDataMapMysqlSmoke().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  mysqlSmokeReadiness,
  runDataMapMysqlSmoke
};
