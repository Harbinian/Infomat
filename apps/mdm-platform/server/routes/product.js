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

router.get('/', requireAuth, applyFieldConstraints('product'), (req, res) => {
  try {
    const { product_family_id, lifecycle_state, search, page = 1, limit = 50 } = req.query;
    let fromSql = `
      FROM product p
      JOIN product_family pf ON p.product_family_id = pf.product_family_id
      WHERE 1=1
    `;
    const params = [];
    if (product_family_id) { fromSql += ' AND p.product_family_id=?'; params.push(product_family_id); }
    if (lifecycle_state) { fromSql += ' AND p.lifecycle_state=?'; params.push(lifecycle_state); }
    if (search) { fromSql += ' AND (p.product_code LIKE ? OR pf.model_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    const count = db.prepare(`SELECT COUNT(*) as cnt ${fromSql}`).get(...params).cnt;
    const sql = `
      SELECT p.*, pf.product_family_code, pf.model_name
      ${fromSql}
      ORDER BY p.updated_at DESC LIMIT ? OFFSET ?
    `;
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    res.json({ rows: db.prepare(sql).all(...params), total: count, page: Number(page), limit: Number(limit) });
  } catch (e) { handleDbError(res, e); }
});

router.get('/:code', requireAuth, applyFieldConstraints('product'), (req, res) => {
  try {
    const row = db.prepare(`
      SELECT p.*, pf.product_family_code, pf.model_name, pf.model_code,
             sup.product_code as superseded_by_code
      FROM product p
      JOIN product_family pf ON p.product_family_id = pf.product_family_id
      LEFT JOIN product sup ON p.superseded_by_product_id = sup.product_id
      WHERE p.product_code=?
    `).get(req.params.code);
    if (!row) return res.status(404).json({ error: '产品不存在' });
    res.json(row);
  } catch (e) { handleDbError(res, e); }
});

router.post('/', requireAuth, requirePermission('product:create'), (req, res) => {
  try {
    const { product_family_id, revision, class_mid, class_minor } = req.body;
    if (!product_family_id) return res.status(400).json({ error: '缺少必填字段 product_family_id' });
    const code = generateCode('product', {
      product_family_id,
      class_mid: (class_mid || '000').toUpperCase(),
      class_minor: (class_minor || '000').toUpperCase()
    });
    const result = db.prepare(`
      INSERT INTO product (product_code, product_family_id, revision, class_mid, class_minor, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, product_family_id, revision || null, (class_mid || '000').toUpperCase(), (class_minor || '000').toUpperCase(), req.session.userId, req.session.userId);
    res.status(201).json({ product_code: code });
  } catch (e) { handleDbError(res, e); }
});

router.post('/:code/release', requireAuth, requirePermission('product:update'), (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM product WHERE product_code=?').get(req.params.code);
    if (!product) return res.status(404).json({ error: '产品不存在' });
    if (product.lifecycle_state !== 'draft') return res.status(400).json({ error: '仅 draft 状态可发布' });
    db.transaction(() => {
      const activeProducts = db.prepare(
        "SELECT product_id FROM product WHERE product_family_id=? AND lifecycle_state='released'"
      ).all(product.product_family_id);
      db.prepare(`
        UPDATE product SET lifecycle_state='released', effective_from=CURRENT_DATE, updated_by=?, updated_at=CURRENT_TIMESTAMP
        WHERE product_id=?
      `).run(req.session.userId, product.product_id);
      for (const old of activeProducts) {
        db.prepare('UPDATE product SET superseded_by_product_id=?, effective_to=CURRENT_DATE, updated_at=CURRENT_TIMESTAMP WHERE product_id=?')
          .run(product.product_id, old.product_id);
      }
    })();
    res.json({ success: true, lifecycle_state: 'released' });
  } catch (e) { handleDbError(res, e); }
});

router.post('/:code/obsolete', requireAuth, requirePermission('product:update'), (req, res) => {
  try {
    const r = db.prepare(`
      UPDATE product SET lifecycle_state='obsolete', effective_to=CURRENT_DATE, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE product_code=? AND lifecycle_state IN ('draft','released')
    `).run(req.session.userId, req.params.code);
    if (r.changes === 0) return res.status(400).json({ error: '产品不存在或无法废止' });
    res.json({ success: true, lifecycle_state: 'obsolete' });
  } catch (e) { handleDbError(res, e); }
});

router.put('/:code', requireAuth, requirePermission('product:update'), (req, res) => {
  try {
    const { revision } = req.body;
    const existing = db.prepare('SELECT * FROM product WHERE product_code=?').get(req.params.code);
    if (!existing) return res.status(404).json({ error: '产品不存在' });
    db.prepare(`
      UPDATE product SET revision=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE product_code=?
    `).run(revision !== undefined ? revision : existing.revision, req.session.userId, req.params.code);
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

router.delete('/:code', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const prod = db.prepare('SELECT * FROM product WHERE product_code=?').get(req.params.code);
    if (!prod) return res.status(404).json({ error: '产品不存在' });

    const cascaded = {};
    cascaded.attribute_values = db.prepare("DELETE FROM attribute_value WHERE entity_type='product' AND entity_id=?").run(prod.product_id).changes;
    cascaded.memberships = db.prepare("DELETE FROM entity_class_membership WHERE entity_type='product' AND entity_id=?").run(prod.product_id).changes;
    cascaded.superseded_refs = db.prepare('UPDATE product SET superseded_by_product_id=NULL WHERE superseded_by_product_id=?').run(prod.product_id).changes;
    db.prepare("DELETE FROM external_identity WHERE entity_type='product' AND entity_id=?").run(prod.product_id);
    db.prepare('DELETE FROM product WHERE product_id=?').run(prod.product_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
