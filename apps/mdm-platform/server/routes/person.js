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

function parseOptionalPositionId(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  const positionId = Number(value);
  if (!Number.isInteger(positionId) || positionId <= 0) return { error: '岗位ID无效' };
  return { value: positionId };
}

function parseOptionalOrgUnitId(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  const orgUnitId = Number(value);
  if (!Number.isInteger(orgUnitId) || orgUnitId <= 0) return { error: '组织ID无效' };
  return { value: orgUnitId };
}

function getPosition(positionId) {
  if (!positionId) return null;
  return db.prepare('SELECT position_id, org_unit_id FROM position WHERE position_id=?').get(positionId) || null;
}

function validatePositionOrg(positionId, orgUnitId) {
  if (!positionId && orgUnitId) return { error: '请选择任职岗位' };
  if (!positionId) return { position: null };
  const position = getPosition(positionId);
  if (!position) return { error: '岗位不存在' };
  if (orgUnitId && Number(position.org_unit_id) !== Number(orgUnitId)) {
    return { error: '任职岗位不属于所选组织' };
  }
  return { position };
}

function setPrimaryAssignment(personId, positionId, userId) {
  if (!positionId) return null;
  db.prepare("UPDATE person_position_assignment SET is_primary=0, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE person_id=? AND status='active'")
    .run(userId || null, personId);

  const existing = db.prepare(`
    SELECT assignment_id
    FROM person_position_assignment
    WHERE person_id=? AND position_id=? AND status='active'
    ORDER BY assignment_id LIMIT 1
  `).get(personId, positionId);

  if (existing) {
    db.prepare(`
      UPDATE person_position_assignment
      SET is_primary=1, end_date=NULL, status='active', updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE assignment_id=?
    `).run(userId || null, existing.assignment_id);
    return existing.assignment_id;
  }

  return db.prepare(`
    INSERT INTO person_position_assignment (person_id, position_id, is_primary, status, created_by, updated_by)
    VALUES (?, ?, 1, 'active', ?, ?)
  `).run(personId, positionId, userId || null, userId || null).lastInsertRowid;
}

router.get('/', requireAuth, applyFieldConstraints('person'), (req, res) => {
  try {
    const { employment_status, status, search, page = 1, limit = 50 } = req.query;
    let fromSql = `
      FROM person
      LEFT JOIN person_position_assignment a ON a.assignment_id = (
        SELECT assignment_id
        FROM person_position_assignment
        WHERE person_id = person.person_id AND status = 'active'
        ORDER BY is_primary DESC, start_date DESC, assignment_id DESC
        LIMIT 1
      )
      LEFT JOIN position p ON a.position_id = p.position_id
      LEFT JOIN org_unit ou ON p.org_unit_id = ou.org_unit_id
      WHERE 1=1
    `;
    const params = [];
    if (employment_status) { fromSql += ' AND person.employment_status=?'; params.push(employment_status); }
    if (status) { fromSql += ' AND person.status=?'; params.push(status); }
    if (search) {
      fromSql += ` AND (
        person.employee_no LIKE ? OR person.person_name LIKE ? OR person.mobile LIKE ? OR person.email LIKE ?
        OR p.position_code LIKE ? OR p.position_name LIKE ? OR ou.org_unit_code LIKE ? OR ou.org_unit_name LIKE ?
      )`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const count = db.prepare(`SELECT COUNT(*) as cnt ${fromSql}`).get(...params).cnt;
    const sql = `
      SELECT person.*,
             a.assignment_id as primary_assignment_id,
             p.position_id, p.position_code, p.position_name,
             ou.org_unit_id, ou.org_unit_code, ou.org_unit_name
      ${fromSql}
      ORDER BY person.employee_no LIMIT ? OFFSET ?
    `;
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
             p.position_id, p.position_code, p.position_name, ou.org_unit_id, ou.org_unit_code, ou.org_unit_name
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
    const { person_name, mobile, email, employment_status, position_id, org_unit_id } = req.body;
    if (!person_name) return res.status(400).json({ error: '缺少必填字段 person_name' });
    const parsedPosition = parseOptionalPositionId(position_id);
    if (parsedPosition.error) return res.status(400).json({ error: parsedPosition.error });
    const parsedOrgUnit = parseOptionalOrgUnitId(org_unit_id);
    if (parsedOrgUnit.error) return res.status(400).json({ error: parsedOrgUnit.error });
    const positionValidation = validatePositionOrg(parsedPosition.value, parsedOrgUnit.value);
    if (positionValidation.error) return res.status(400).json({ error: positionValidation.error });
    const code = generateCode('person', {});
    const result = db.transaction(() => {
      const created = db.prepare(`
        INSERT INTO person (employee_no, person_name, mobile, email, employment_status, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(code, person_name, mobile || null, email || null, employment_status || 'active', req.session.userId, req.session.userId);
      const assignmentId = setPrimaryAssignment(created.lastInsertRowid, parsedPosition.value, req.session.userId);
      return { employee_no: code, assignment_id: assignmentId };
    })();
    res.status(201).json(result);
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
    const { person_name, mobile, email, employment_status, position_id, org_unit_id } = req.body;
    const existing = db.prepare('SELECT * FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!existing) return res.status(404).json({ error: '人员不存在' });
    const parsedPosition = parseOptionalPositionId(position_id);
    if (parsedPosition.error) return res.status(400).json({ error: parsedPosition.error });
    const parsedOrgUnit = parseOptionalOrgUnitId(org_unit_id);
    if (parsedOrgUnit.error) return res.status(400).json({ error: parsedOrgUnit.error });
    const positionValidation = validatePositionOrg(parsedPosition.value, parsedOrgUnit.value);
    if (positionValidation.error) return res.status(400).json({ error: positionValidation.error });
    const result = db.transaction(() => {
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
      const assignmentId = position_id !== undefined ? setPrimaryAssignment(existing.person_id, parsedPosition.value, req.session.userId) : null;
      return { assignment_id: assignmentId };
    })();
    res.json({ success: true, assignment_id: result.assignment_id });
  } catch (e) { handleDbError(res, e); }
});

router.get('/:employeeNo/assignments', requireAuth, applyFieldConstraints('person'), (req, res) => {
  try {
    const person = db.prepare('SELECT person_id FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!person) return res.status(404).json({ error: '人员不存在' });
    const rows = db.prepare(`
      SELECT a.assignment_id, a.is_primary, a.start_date, a.end_date, a.status,
             p.position_id, p.position_code, p.position_name, ou.org_unit_id, ou.org_unit_code, ou.org_unit_name
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

router.delete('/:employeeNo', requireAuth, requirePermission('admin:access'), (req, res) => {
  try {
    const person = db.prepare('SELECT * FROM person WHERE employee_no=?').get(req.params.employeeNo);
    if (!person) return res.status(404).json({ error: '人员不存在' });

    const cascaded = {};
    cascaded.assignments = db.prepare('DELETE FROM person_position_assignment WHERE person_id=?').run(person.person_id).changes;
    cascaded.manager_refs = db.prepare('UPDATE org_unit SET manager_person_id=NULL WHERE manager_person_id=?').run(person.person_id).changes;
    db.prepare("DELETE FROM external_identity WHERE entity_type='person' AND entity_id=?").run(person.person_id);
    db.prepare('DELETE FROM person WHERE person_id=?').run(person.person_id);

    res.json({ success: true, cascaded });
  } catch (e) { handleDbError(res, e); }
});

module.exports = router;
