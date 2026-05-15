const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiKeyAuth, requireIntegrationPermission } = require('../integrationAuth');
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

// GET /api/integration/materials — 查询物料主数据（支持增量同步）
router.get('/materials', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { category_id, since, page = 1, limit = 200 } = req.query;
    let sql = `SELECT code, category_id, name, attributes_json, status, old_code, updated_at FROM master_data_items WHERE 1=1`;
    const params = [];

    if (category_id) { sql += ' AND category_id=?'; params.push(category_id); }
    if (since) { sql += ' AND updated_at >= ?'; params.push(since); }

    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY updated_at ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));

    const rows = db.prepare(sql).all(...params);
    rows.forEach(r => { r.attributes = JSON.parse(r.attributes_json || '{}'); delete r.attributes_json; });

    logSync(req.integrationSystem.name, 'GET /materials', req.query, rows.length, 'success', null, req);
    res.json({ rows, total: count, page: Number(page), limit: Number(limit) });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/materials/sync-status — 增量同步状态
router.get('/materials/sync-status', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const { since } = req.query;
    const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19);

    const created = db.prepare('SELECT COUNT(*) as cnt FROM master_data_items WHERE created_at >= ?').get(sinceDate).cnt;
    const updated = db.prepare('SELECT COUNT(*) as cnt FROM master_data_items WHERE updated_at >= ? AND created_at < ?').get(sinceDate, sinceDate).cnt;

    res.json({ since: sinceDate, created_count: created, updated_count: updated, total_changed: created + updated });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/materials/:code — 按编码查询单个物料
router.get('/materials/:code', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const row = db.prepare(`
      SELECT code, category_id, name, attributes_json, status, old_code, updated_at
      FROM master_data_items WHERE code=?
    `).get(req.params.code);
    if (!row) return res.status(404).json({ error: '主数据不存在' });

    row.attributes = JSON.parse(row.attributes_json || '{}');
    delete row.attributes_json;

    logSync(req.integrationSystem.name, `GET /materials/${req.params.code}`, {}, 1, 'success', null, req);
    res.json(row);
  } catch (e) { handleDbError(res, e); }
});

// GET /api/integration/old-code/:oldCode — 旧编码映射查询
router.get('/old-code/:oldCode', apiKeyAuth, requireIntegrationPermission('read'), (req, res) => {
  try {
    const mapping = db.prepare('SELECT * FROM old_new_code_mapping WHERE old_code=?').get(req.params.oldCode);
    if (!mapping) return res.status(404).json({ error: '未找到该旧编码的映射' });
    res.json(mapping);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/integration/callback/consistency-check — 消费系统上报一致性校验
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

// POST /api/integration/callback/stock-change — MES 库存变动反馈
router.post('/callback/stock-change', apiKeyAuth, requireIntegrationPermission('write'), (req, res) => {
  try {
    const { material_code, change_type, quantity, location } = req.body;
    if (!material_code || !change_type || quantity == null) {
      return res.status(400).json({ error: '缺少必填字段 material_code / change_type / quantity' });
    }

    const item = db.prepare('SELECT id FROM master_data_items WHERE code=?').get(material_code);
    if (!item) return res.status(404).json({ error: '物料不存在' });

    logSync(req.integrationSystem.name, 'POST /callback/stock-change', { material_code, change_type, quantity }, 1, 'success', null, req);
    res.json({ success: true, message: '库存变动已记录' });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/integration/credentials/generate — 管理系统生成 API Key（Admin only via session）
router.post('/credentials/generate', (req, res, next) => {
  const { requireAuth } = require('../auth');
  requireAuth(req, res, () => {
    if (req.session.userRole !== 'admin') return res.status(403).json({ error: '仅管理员可管理 API Key' });
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

// GET /api/integration/credentials — 列出已注册系统（不返回 Key）
router.get('/credentials', (req, res, next) => {
  const { requireAuth } = require('../auth');
  requireAuth(req, res, () => {
    if (req.session.userRole !== 'admin') return res.status(403).json({ error: '仅管理员' });
    next();
  });
}, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, system_name, permissions_json, enabled, created_at, last_used_at FROM integration_credentials ORDER BY created_at').all();
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
