const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { hasGlobalView, isAdmin, validateAction } = require('../access');

function handleDbError(res, error) {
  if (error && (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(error.message).includes('UNIQUE constraint failed'))) {
    return res.status(409).json({ error: '术语已存在' });
  }
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runDbAction(res, action) {
  try {
    return action();
  } catch (error) {
    return handleDbError(res, error);
  }
}

function normalizeProcessId(value) {
  if (value === undefined || value === null || value === '') return null;
  const processId = Number(value);
  if (!Number.isInteger(processId) || processId <= 0) return NaN;
  return processId;
}

function normalizeTermTypeCode(value) {
  const code = String(value || 'noun').trim();
  return code || 'noun';
}

function validateTermTypeCode(res, code) {
  const termType = db.prepare('SELECT * FROM term_types WHERE code=? AND active=1').get(code);
  if (termType) return true;
  res.status(400).json({ error: '术语类型不存在' });
  return false;
}

function termGovernanceScope(alias, req, options = {}) {
  const global = options.global === undefined ? hasGlobalView(req) : options.global;
  if (global) return { sql: '', params: [] };
  if (!req.session.departmentId) return { sql: ' AND 1=0', params: [] };

  const table = alias || 'p';
  return {
    sql: ` AND (${table}.owner_dept_id=? OR EXISTS (
      SELECT 1 FROM mappings m
      WHERE m.process_id=${table}.id AND m.owner_dept_id=?
    ))`,
    params: [req.session.departmentId, req.session.departmentId]
  };
}

function findGovernableProcess(req, processId, options = {}) {
  const scope = termGovernanceScope('p', req, options);
  return db.prepare(`
    SELECT p.*, c.name as cap_name, d.name as dept_name
    FROM processes p
    LEFT JOIN capabilities c ON p.capability_id = c.id
    LEFT JOIN departments d ON p.owner_dept_id = d.id
    WHERE p.id=?${scope.sql}
  `).get(processId, ...scope.params);
}

function validateGovernableProcess(req, res, processId) {
  const globalManager = isAdmin(req);
  if (Number.isNaN(processId)) {
    res.status(400).json({ error: '业务流程不合法' });
    return false;
  }
  if (!processId) {
    if (globalManager) return true;
    res.status(400).json({ error: '请选择本部门映射关系线上的业务流程' });
    return false;
  }

  const process = findGovernableProcess(req, processId, { global: globalManager });
  if (process) return true;

  const exists = db.prepare('SELECT id FROM processes WHERE id=?').get(processId);
  if (!exists) {
    res.status(400).json({ error: '业务流程不存在' });
    return false;
  }

  res.status(403).json({ error: '不能选择其他部门的业务流程' });
  return false;
}

router.get('/processes', requireAuth, (req, res) => {
  const scope = termGovernanceScope('p', req, { global: isAdmin(req) });
  const rows = db.prepare(`
    SELECT p.*, c.name as cap_name, d.name as dept_name
    FROM processes p
    LEFT JOIN capabilities c ON p.capability_id = c.id
    LEFT JOIN departments d ON p.owner_dept_id = d.id
    WHERE 1=1${scope.sql}
    ORDER BY p.name
  `).all(...scope.params);
  res.json(rows);
});

router.get('/types', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT code, name, description, sort_order
    FROM term_types
    WHERE active=1
    ORDER BY sort_order, code
  `).all();
  res.json(rows);
});

router.get('/', requireAuth, (req, res) => {
  const { status } = req.query;
  let sql = `SELECT t.*, tt.name as term_type_name, tt.description as term_type_description,
                    p.name as process_name, p.owner_dept_id as process_owner_dept_id, d.name as process_dept_name
             FROM terms t
             LEFT JOIN term_types tt ON t.term_type_code = tt.code
             LEFT JOIN processes p ON t.process_id = p.id
             LEFT JOIN departments d ON p.owner_dept_id = d.id`;
  const params = [];
  const conditions = [];

  if (status) {
    conditions.push('t.status=?');
    params.push(status);
  }
  const scope = termGovernanceScope('p', req);
  if (scope.sql) {
    conditions.push(scope.sql.replace(/^ AND /, ''));
    params.push(...scope.params);
  }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');

  sql += ' ORDER BY t.term';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { term, definition, scope, forbidden, process_id } = req.body;
    const termTypeCode = normalizeTermTypeCode(req.body.term_type_code);
    if (!validateTermTypeCode(res, termTypeCode)) return;
    const normalizedProcessId = normalizeProcessId(process_id);
    if (!validateGovernableProcess(req, res, normalizedProcessId)) return;
    const stmt = db.prepare('INSERT INTO terms (term, term_type_code, definition, scope, forbidden, process_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(term, termTypeCode, definition || null, scope || null, forbidden || null, normalizedProcessId || null, req.session.userId);
    res.json({ id: result.lastInsertRowid });
  });
});

router.put('/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const existing = db.prepare('SELECT * FROM terms WHERE id=?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '术语不存在' });
    if (req.session.userRole !== 'admin' && (existing.created_by !== req.session.userId || existing.status !== 'pending')) {
      return res.status(403).json({ error: '仅创建人可修改待审术语，或由管理员维护术语' });
    }
    const { term, definition, scope, forbidden, process_id } = req.body;
    const termTypeCode = normalizeTermTypeCode(req.body.term_type_code);
    if (!validateTermTypeCode(res, termTypeCode)) return;
    const normalizedProcessId = normalizeProcessId(process_id);
    if (!validateGovernableProcess(req, res, normalizedProcessId)) return;
    db.prepare('UPDATE terms SET term=?, term_type_code=?, definition=?, scope=?, forbidden=?, process_id=? WHERE id=?').run(
      term,
      termTypeCode,
      definition || null,
      scope || null,
      forbidden || null,
      normalizedProcessId || null,
      req.params.id
    );
    res.json({ success: true });
  });
});

router.post('/:id/review', requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const { action } = req.body;
    if (!validateAction(action)) {
      return res.status(400).json({ error: '不支持的审核操作' });
    }
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    db.prepare("UPDATE terms SET status=?, approved_by=?, approved_at=datetime('now') WHERE id=?").run(
      newStatus,
      req.session.userId,
      req.params.id
    );
    res.json({ success: true });
  });
});

router.delete('/:id', requireAuth, requirePermission('admin:access'), (req, res) => {
  return runDbAction(res, () => {
    const result = db.prepare('DELETE FROM terms WHERE id=?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: '术语不存在' });
    res.json({ success: true });
  });
});

module.exports = router;
