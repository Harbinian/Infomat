const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiKeyAuth, requireIntegrationPermission } = require('../integrationAuth');
const { requireAuth, isAdmin } = require('../auth');
const bcrypt = require('bcryptjs');

function handleDbError(res, error) {
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function logSync(systemName, endpoint, params, recordsReturned, status, errorReason, req) {
  db.prepare(`
    INSERT INTO integration_sync_log (system_name, endpoint, params_json, records_returned, status, error_reason, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(systemName, endpoint, JSON.stringify(params || {}), recordsReturned || 0, status, errorReason || null, req.ip || null);
}

// GET /api/integration/org-units
router.get('/org-units', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { code, since, page = 1, limit = 200 } = req.query;
    let sql = `SELECT org_unit_code, org_unit_name, org_type, org_mnemonic, status, effective_from, effective_to, updated_at FROM org_unit WHERE 1=1`;
    const params = [];
    if (code) { sql += ' AND org_unit_code=?'; params.push(code); }
    if (since) { sql += ' AND updated_at >= ?'; params.push(since); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY updated_at ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const rows = db.prepare(sql).all(...params);
    logSync(req.integrationSystem.name, 'GET /org-units', req.query, rows.length, 'success', null, req);
    res.json({ rows, total: count });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/persons
router.get('/persons', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { employee_no, since, page = 1, limit = 200 } = req.query;
    let sql = `SELECT employee_no, person_name, mobile, email, employment_status, status, updated_at FROM person WHERE 1=1`;
    const params = [];
    if (employee_no) { sql += ' AND employee_no=?'; params.push(employee_no); }
    if (since) { sql += ' AND updated_at >= ?'; params.push(since); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY updated_at ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const rows = db.prepare(sql).all(...params);
    logSync(req.integrationSystem.name, 'GET /persons', req.query, rows.length, 'success', null, req);
    res.json({ rows, total: count });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/products
router.get('/products', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { code, since, page = 1, limit = 200 } = req.query;
    let sql = `SELECT p.product_code, pf.product_family_code, pf.model_name, p.revision, p.lifecycle_state, p.effective_from, p.effective_to, p.updated_at
               FROM product p JOIN product_family pf ON p.product_family_id = pf.product_family_id WHERE 1=1`;
    const params = [];
    if (code) { sql += ' AND p.product_code=?'; params.push(code); }
    if (since) { sql += ' AND p.updated_at >= ?'; params.push(since); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY p.updated_at ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const rows = db.prepare(sql).all(...params);
    logSync(req.integrationSystem.name, 'GET /products', req.query, rows.length, 'success', null, req);
    res.json({ rows, total: count });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/sync-status
router.get('/sync-status', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { entity_type, since } = req.query;
    const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
    const tableMap = { org_unit: 'org_unit', person: 'person', product: 'product', product_family: 'product_family' };
    const table = tableMap[entity_type] || 'person';
    const created = db.prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE created_at >= ?`).get(sinceDate).cnt;
    const updated = db.prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE updated_at >= ? AND created_at < ?`).get(sinceDate, sinceDate).cnt;
    res.json({ entity_type: entity_type || 'person', since: sinceDate, created_count: created, updated_count: updated, total_changed: created + updated });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/external-identities
router.get('/external-identities', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { entity_type, entity_id, system_code } = req.query;
    let sql = `SELECT ei.*, es.system_name FROM external_identity ei JOIN external_system es ON ei.system_code = es.system_code WHERE 1=1`;
    const params = [];
    if (entity_type) { sql += ' AND ei.entity_type=?'; params.push(entity_type); }
    if (entity_id) { sql += ' AND ei.entity_id=?'; params.push(entity_id); }
    if (system_code) { sql += ' AND ei.system_code=?'; params.push(system_code); }
    const rows = db.prepare(sql).all(...params);
    logSync(req.integrationSystem.name, 'GET /external-identities', req.query, rows.length, 'success', null, req);
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/integration/external-identities
router.post('/external-identities', apiKeyAuth, requireIntegrationPermission('write'), (req, res) => {
  try {
    const { entity_type, entity_id, system_code, external_key, is_primary } = req.body;
    if (!entity_type || !entity_id || !system_code || !external_key) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    db.prepare(`
      INSERT INTO external_identity (entity_type, entity_id, system_code, external_key, is_primary, last_sync_at, last_sync_status)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'ok')
      ON CONFLICT(entity_type, entity_id, system_code) DO UPDATE SET
        external_key=excluded.external_key, is_primary=excluded.is_primary, last_sync_at=CURRENT_TIMESTAMP, last_sync_status='ok'
    `).run(entity_type, entity_id, system_code.toUpperCase(), external_key, is_primary ? 1 : 0);
    logSync(req.integrationSystem.name, 'POST /external-identities', req.body, 1, 'success', null, req);
    res.status(201).json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/integration/callback/consistency-check
router.post('/callback/consistency-check', apiKeyAuth, requireIntegrationPermission('write'), (req, res) => {
  try {
    const { system_name, checks } = req.body;
    if (!checks || !Array.isArray(checks)) return res.status(400).json({ error: 'checks 必须为数组' });
    const mismatchCount = checks.filter(c => !c.match).length;
    logSync(system_name || req.integrationSystem.name, 'POST /callback/consistency-check',
      { total: checks.length, mismatches: mismatchCount }, checks.length, 'success', null, req);
    res.json({ received: checks.length, mismatches: mismatchCount });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/integration/credentials/generate
router.post('/credentials/generate', (req, res, next) => {
  requireAuth(req, res, () => {
    if (!isAdmin(req)) return res.status(403).json({ error: '仅管理员可管理 API Key' });
    next();
  });
}, (req, res) => {
  try {
    const { system_name, permissions } = req.body;
    if (!system_name) return res.status(400).json({ error: '缺少 system_name' });
    const rawKey = 'sk-' + require('crypto').randomBytes(24).toString('hex');
    const hash = bcrypt.hashSync(rawKey, 10);
    db.prepare(`
      INSERT INTO integration_credentials (system_name, api_key_hash, permissions_json)
      VALUES (?, ?, ?)
      ON CONFLICT(system_name) DO UPDATE SET api_key_hash=excluded.api_key_hash, permissions_json=excluded.permissions_json
    `).run(system_name, hash, JSON.stringify(permissions || ['read']));
    res.status(201).json({ system_name, api_key: rawKey });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/credentials
router.get('/credentials', (req, res, next) => {
  requireAuth(req, res, () => {
    if (!isAdmin(req)) return res.status(403).json({ error: '仅管理员' });
    next();
  });
}, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, system_name, permissions_json, enabled, created_at, last_used_at FROM integration_credentials ORDER BY created_at').all();
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
