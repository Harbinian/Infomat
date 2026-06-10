const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requirePermission, applyFieldConstraints } = require('../auth');
const { generateCode } = require('../codeEngine');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

router.get('/', requireAuth, applyFieldConstraints('product_family'), (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    let sql = `SELECT * FROM product_family WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND status=?'; params.push(status); }
    if (search) { sql += ' AND (product_family_code LIKE ? OR model_name LIKE ? OR model_code LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY model_code, product_family_code LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    res.json({ rows: db.prepare(sql).all(...params), total: count, page: Number(page), limit: Number(limit) });
  } catch (e) { handleDbError(res, e); }
});

router.get('/:code', requireAuth, applyFieldConstraints('product_family'), (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM product_family WHERE product_family_code=?').get(req.params.code);
    if (!row) return res.status(404).json({ error: '产品族不存在' });
    const products = db.prepare('SELECT product_code, revision, lifecycle_state FROM product WHERE product_family_id=? ORDER BY created_at DESC').all(row.product_family_id);
    res.json({ ...row, products });
  } catch (e) { handleDbError(res, e); }
});

router.post('/', requireAuth, requirePermission('product_family:create'), (req, res) => {
  try {
    const { model_name, model_code, class_major, product_type } = req.body;
    if (!model_name || !model_code || !class_major) {
      return res.status(400).json({ error: '缺少必填字段 model_name/model_code/class_major' });
    }
    const code = generateCode('productFamily', { model_code: model_code.toUpperCase(), class_major: class_major.toUpperCase() });
    const result = db.prepare(`
      INSERT INTO product_family (product_family_code, model_name, model_code, class_major, product_type, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, model_name, model_code.toUpperCase(), class_major.toUpperCase(), product_type || null, req.session.userId, req.session.userId);
    res.status(201).json({ product_family_code: code });
  } catch (e) { handleDbError(res, e); }
});

router.post('/:code/activate', requireAuth, requirePermission('product_family:update'), (req, res) => {
  try {
    const r = db.prepare("UPDATE product_family SET status='active', updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE product_family_code=? AND status='draft'")
      .run(req.session.userId, req.params.code);
    if (r.changes === 0) return res.status(400).json({ error: '产品族不存在或非 draft 状态' });
    res.json({ success: true, status: 'active' });
  } catch (e) { handleDbError(res, e); }
});

router.put('/:code', requireAuth, requirePermission('product_family:update'), (req, res) => {
  try {
    const { model_name, product_type, status } = req.body;
    const existing = db.prepare('SELECT * FROM product_family WHERE product_family_code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '产品族不存在' });
    db.prepare(`
      UPDATE product_family SET model_name=?, product_type=?, status=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE product_family_code=?
    `).run(model_name || existing.model_name, product_type !== undefined ? product_type : existing.product_type, status || existing.status, req.session.userId, req.params.code);
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const pf = db.prepare('SELECT * FROM product_family WHERE product_family_code=?').get(req.params.code);
    if (!pf) return res.status(404).json({ error: '产品族不存在' });

    const cascaded = {};
    const products = db.prepare('SELECT product_id FROM product WHERE product_family_id=?').all(pf.product_family_id);
    const productIds = products.map(p => p.product_id);
    let productAttr = 0;
    let productMemberships = 0;
    let supersededRefs = 0;

    for (const productId of productIds) {
      productAttr += db.prepare("DELETE FROM attribute_value WHERE entity_type='product' AND entity_id=?").run(productId).changes;
      productMemberships += db.prepare("DELETE FROM entity_class_membership WHERE entity_type='product' AND entity_id=?").run(productId).changes;
      supersededRefs += db.prepare('UPDATE product SET superseded_by_product_id=NULL WHERE superseded_by_product_id=?').run(productId).changes;
      db.prepare("DELETE FROM external_identity WHERE entity_type='product' AND entity_id=?").run(productId);
    }

    cascaded.product_attribute_values = productAttr;
    cascaded.product_memberships = productMemberships;
    cascaded.superseded_refs = supersededRefs;
    cascaded.products = db.prepare('DELETE FROM product WHERE product_family_id=?').run(pf.product_family_id).changes;
    cascaded.family_attribute_values = db.prepare("DELETE FROM attribute_value WHERE entity_type='product_family' AND entity_id=?").run(pf.product_family_id).changes;
    cascaded.family_memberships = db.prepare("DELETE FROM entity_class_membership WHERE entity_type='product_family' AND entity_id=?").run(pf.product_family_id).changes;

    db.prepare("DELETE FROM external_identity WHERE entity_type='product_family' AND entity_id=?").run(pf.product_family_id);
    db.prepare('DELETE FROM product_family WHERE product_family_id=?').run(pf.product_family_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
