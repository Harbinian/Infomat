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

router.get('/', requireAuth, applyFieldConstraints('person'), (req, res) => {
  try {
    const { employment_status, status, search, page = 1, limit = 50 } = req.query;
    let sql = `SELECT * FROM person WHERE 1=1`;
    const params = [];
    if (employment_status) { sql += ' AND employment_status=?'; params.push(employment_status); }
    if (status) { sql += ' AND status=?'; params.push(status); }
    if (search) { sql += ' AND (employee_no LIKE ? OR person_name LIKE ? OR mobile LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    const count = db.prepare(sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params).cnt;
    sql += ' ORDER BY employee_no LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    res.json({ rows: db.prepare(sql).all(...params), total: count, page: Number(page), limit: Number(limit) });
  } catch (e) { handleDbError(res, e); }
});

router.get('/:employeeNo', requireAuth, applyFieldConstraints('person'), (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!row) return res.status(404).json({ error: '人员不存在' });
    const assignments = db.prepare(`
      SELECT a.assignment_id, a.is_primary, a.start_date, a.end_date, a.status as asgn_status,
             p.position_code, p.position_name, ou.org_unit_code, ou.org_unit_name
      FROM person_position_assignment a
      JOIN position p ON a.position_id = p.position_id
      JOIN org_unit ou ON p.org_unit_id = ou.org_unit_id
      WHERE a.person_id=? AND a.status='active'
    `).all(row.person_id);
    res.json({ ...row, assignments });
  } catch (e) { handleDbError(res, e); }
});

router.post('/', requireAuth, (req, res) => {
  try {
    const { person_name, mobile, email, employment_status } = req.body;
    if (!person_name) return res.status(400).json({ error: '缺少必填字段 person_name' });
    const code = generateCode('person', {});
    const result = db.prepare(`
      INSERT INTO person (employee_no, person_name, mobile, email, employment_status, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, person_name, mobile || null, email || null, employment_status || 'active', req.session.userId, req.session.userId);
    res.status(201).json({ employee_no: code });
  } catch (e) { handleDbError(res, e); }
});

router.post('/:employeeNo/activate', requireAuth, requirePermission('person:update'), (req, res) => {
  try {
    const r = db.prepare("UPDATE person SET status='active', effective_from=CURRENT_DATE, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE employee_no=? AND status='draft'")
      .run(req.session.userId, req.params.employeeNo);
    if (r.changes === 0) return res.status(400).json({ error: '人员不存在或非 draft 状态' });
    res.json({ success: true, status: 'active' });
  } catch (e) { handleDbError(res, e); }
});

router.put('/:employeeNo', requireAuth, (req, res) => {
  try {
    const { person_name, mobile, email, employment_status } = req.body;
    const existing = db.prepare('SELECT * FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!existing) return res.status(404).json({ error: '人员不存在' });
    db.prepare(`
      UPDATE person SET person_name=?, mobile=?, email=?, employment_status=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE employee_no=?
    `).run(
      person_name || existing.person_name,
      mobile !== undefined ? mobile : existing.mobile,
      email !== undefined ? email : existing.email,
      employment_status || existing.employment_status,
      req.session.userId, req.params.employeeNo
    );
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

router.get('/:employeeNo/assignments', requireAuth, applyFieldConstraints('person'), (req, res) => {
  try {
    const person = db.prepare('SELECT person_id FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!person) return res.status(404).json({ error: '人员不存在' });
    const rows = db.prepare(`
      SELECT a.assignment_id, a.is_primary, a.start_date, a.end_date, a.status,
             p.position_code, p.position_name, ou.org_unit_code, ou.org_unit_name
      FROM person_position_assignment a
      JOIN position p ON a.position_id = p.position_id
      JOIN org_unit ou ON p.org_unit_id = ou.org_unit_id
      WHERE a.person_id=? ORDER BY a.is_primary DESC, a.start_date DESC
    `).all(person.person_id);
    res.json(rows);
  } catch (e) { handleDbError(res, e); }
});

router.post('/:employeeNo/assignments', requireAuth, (req, res) => {
  try {
    const { position_id, is_primary } = req.body;
    if (!position_id) return res.status(400).json({ error: '缺少 position_id' });
    const person = db.prepare('SELECT person_id FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!person) return res.status(404).json({ error: '人员不存在' });
    const result = db.transaction(() => {
      if (is_primary) {
        db.prepare("UPDATE person_position_assignment SET is_primary=0 WHERE person_id=? AND status='active'")
          .run(person.person_id);
      }
      const r = db.prepare(`
        INSERT INTO person_position_assignment (person_id, position_id, is_primary, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(person.person_id, position_id, is_primary ? 1 : 0, req.session.userId, req.session.userId);
      return r;
    })();
    res.status(201).json({ assignment_id: result.lastInsertRowid });
  } catch (e) { handleDbError(res, e); }
});

router.put('/:employeeNo/assignments/:id/deactivate', requireAuth, (req, res) => {
  try {
    const person = db.prepare('SELECT person_id FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!person) return res.status(404).json({ error: '人员不存在' });
    const r = db.prepare(`
      UPDATE person_position_assignment SET status='inactive', end_date=CURRENT_DATE, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE assignment_id=? AND person_id=?
    `).run(req.session.userId, req.params.id, person.person_id);
    if (r.changes === 0) return res.status(404).json({ error: '任岗记录不存在' });
    res.json({ success: true });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
