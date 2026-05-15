const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

const VALID_TRANSITIONS = {
  'draft':        ['review'],
  'review':       ['active', 'rejected'],
  'active':       ['changing', 'discontinued'],
  'changing':     ['active', 'rejected'],
  'discontinued': ['archived'],
  'archived':     [],
  'rejected':     ['review']
};

// POST /api/master-data/items/:code/transition — 状态流转
router.post('/items/:code/transition', requireAuth, (req, res) => {
  try {
    const { to_status, note } = req.body;
    if (!to_status) return res.status(400).json({ error: '缺少 to_status' });

    const item = db.prepare('SELECT * FROM master_data_items WHERE code=?').get(req.params.code);
    if (!item) return res.status(404).json({ error: '主数据不存在' });

    const allowed = VALID_TRANSITIONS[item.status] || [];
    if (!allowed.includes(to_status)) {
      return res.status(400).json({ error: `不允许 ${item.status} → ${to_status} 的状态变更` });
    }

    db.transaction(() => {
      db.prepare('UPDATE master_data_items SET status=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE code=?')
        .run(to_status, req.session.userId, req.params.code);

      db.prepare(`
        INSERT INTO master_data_status_log (item_id, from_status, to_status, operated_by, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(item.id, item.status, to_status, req.session.userId, note || null);
    })();

    res.json({ success: true, from: item.status, to: to_status });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/items/:code/status-log — 状态变更历史
router.get('/items/:code/status-log', requireAuth, (req, res) => {
  try {
    const item = db.prepare('SELECT id FROM master_data_items WHERE code=?').get(req.params.code);
    if (!item) return res.status(404).json({ error: '主数据不存在' });

    const rows = db.prepare(`
      SELECT sl.*, u.name as operated_by_name
      FROM master_data_status_log sl
      LEFT JOIN users u ON sl.operated_by = u.id
      WHERE sl.item_id=? ORDER BY sl.created_at DESC
    `).all(item.id);
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

// POST /api/master-data/change-requests — 发起变更申请（含多级会签）
router.post('/change-requests', requireAuth, (req, res) => {
  try {
    const { item_code, request_type, change_summary, new_values, approval_dept_ids } = req.body;
    if (!item_code || !request_type || !change_summary || !new_values) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    if (!Array.isArray(approval_dept_ids) || approval_dept_ids.length === 0) {
      return res.status(400).json({ error: '至少需要一个审批部门' });
    }

    const item = db.prepare('SELECT * FROM master_data_items WHERE code=?').get(item_code);
    if (!item) return res.status(404).json({ error: '主数据不存在' });

    const cr = db.transaction(() => {
      const oldValues = JSON.parse(item.attributes_json || '{}');

      const result = db.prepare(`
        INSERT INTO master_data_change_requests (item_id, request_type, change_summary, old_values_json, new_values_json, requested_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(item.id, request_type, change_summary, JSON.stringify(oldValues), JSON.stringify(new_values), req.session.userId);

      const crId = result.lastInsertRowid;

      const insertApproval = db.prepare(`
        INSERT INTO master_data_change_approvals (change_request_id, step_order, approver_dept_id)
        VALUES (?, ?, ?)
      `);
      approval_dept_ids.forEach((deptId, i) => {
        insertApproval.run(crId, i + 1, deptId);
      });

      if (item.status === 'active') {
        db.prepare('UPDATE master_data_items SET status=? WHERE id=?').run('changing', item.id);
        db.prepare(`
          INSERT INTO master_data_status_log (item_id, from_status, to_status, change_request_id, operated_by)
          VALUES (?, 'active', 'changing', ?, ?)
        `).run(item.id, crId, req.session.userId);
      }

      return { id: crId };
    })();

    res.status(201).json({ change_request_id: cr.id });
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/change-requests — 查询变更申请列表
router.get('/change-requests', requireAuth, (req, res) => {
  try {
    const { status, item_id } = req.query;
    let sql = `
      SELECT cr.*, i.code as item_code, i.name as item_name, u.name as requested_by_name,
        (SELECT GROUP_CONCAT(a.status) FROM master_data_change_approvals a WHERE a.change_request_id = cr.id) as approval_statuses
      FROM master_data_change_requests cr
      JOIN master_data_items i ON cr.item_id = i.id
      LEFT JOIN users u ON cr.requested_by = u.id
      WHERE 1=1
    `;
    const params = [];
    if (status) { sql += ' AND cr.status=?'; params.push(status); }
    if (item_id) { sql += ' AND cr.item_id=?'; params.push(item_id); }
    sql += ' ORDER BY cr.created_at DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (e) { handleDbError(res, e); }
});

// GET /api/master-data/change-requests/:id — 单个变更详情（含审批步骤）
router.get('/change-requests/:id', requireAuth, (req, res) => {
  try {
    const cr = db.prepare(`
      SELECT cr.*, i.code as item_code, i.name as item_name
      FROM master_data_change_requests cr
      JOIN master_data_items i ON cr.item_id = i.id
      WHERE cr.id=?
    `).get(req.params.id);
    if (!cr) return res.status(404).json({ error: '变更申请不存在' });

    const approvals = db.prepare(`
      SELECT a.*, d.name as dept_name, u.name as approver_name
      FROM master_data_change_approvals a
      JOIN departments d ON a.approver_dept_id = d.id
      LEFT JOIN users u ON a.approver_user_id = u.id
      WHERE a.change_request_id=? ORDER BY a.step_order
    `).all(req.params.id);

    res.json({ ...cr, approvals });
  } catch (e) { handleDbError(res, e); }
});

// POST /api/master-data/change-requests/:id/approve — 审批（通过/退回）
router.post('/change-requests/:id/approve', requireAuth, (req, res) => {
  try {
    const { step_order, action, opinion } = req.body;
    if (!step_order || !action || !['approved', 'rejected'].includes(action)) {
      return res.status(400).json({ error: '缺少 step_order / action (approved|rejected)' });
    }

    const cr = db.prepare('SELECT * FROM master_data_change_requests WHERE id=?').get(req.params.id);
    if (!cr) return res.status(404).json({ error: '变更申请不存在' });
    if (cr.status !== 'in_review' && cr.status !== 'pending') {
      return res.status(400).json({ error: '该变更申请当前状态不可审批' });
    }

    const step = db.prepare(
      'SELECT * FROM master_data_change_approvals WHERE change_request_id=? AND step_order=?'
    ).get(req.params.id, step_order);
    if (!step) return res.status(404).json({ error: '审批步骤不存在' });
    if (step.status !== 'pending') return res.status(400).json({ error: '该步骤已审批' });

    db.transaction(() => {
      if (cr.status === 'pending') {
        db.prepare('UPDATE master_data_change_requests SET status=? WHERE id=?').run('in_review', cr.id);
      }

      db.prepare(`
        UPDATE master_data_change_approvals SET status=?, approver_user_id=?, opinion=?, operated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(action === 'approved' ? 'approved' : 'rejected', req.session.userId, opinion || null, step.id);

      if (action === 'rejected') {
        db.prepare('UPDATE master_data_change_requests SET status=?, resolved_at=CURRENT_TIMESTAMP WHERE id=?')
          .run('rejected', cr.id);
        db.prepare("UPDATE master_data_items SET status='active' WHERE id=?").run(cr.item_id);
      } else {
        const pendingSteps = db.prepare(
          'SELECT COUNT(*) as cnt FROM master_data_change_approvals WHERE change_request_id=? AND status=?'
        ).get(cr.id, 'pending');
        if (pendingSteps.cnt === 0) {
          const newValues = JSON.parse(cr.new_values_json);
          db.prepare('UPDATE master_data_items SET attributes_json=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
            .run(JSON.stringify(newValues), 'active', cr.item_id);

          db.prepare('UPDATE master_data_change_requests SET status=?, resolved_at=CURRENT_TIMESTAMP WHERE id=?')
            .run('approved', cr.id);

          db.prepare(`
            INSERT INTO master_data_status_log (item_id, from_status, to_status, change_request_id, operated_by)
            VALUES (?, 'changing', 'active', ?, ?)
          `).run(cr.item_id, cr.id, req.session.userId);
        }
      }
    })();

    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
