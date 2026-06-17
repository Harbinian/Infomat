const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { getEffectiveRoleCodesAsync } = require('../access');

function handleDbError(res, error) {
  if (error && (String(error.code).startsWith('SQLITE_CONSTRAINT') || String(error.message).includes('constraint failed'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runAsyncAction(res, action) {
  return action().catch(error => handleDbError(res, error));
}

async function canEditFieldIdentity(req, fieldEntryId, identity) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  if (permSet.has('admin:access') || permSet.has('*:*')) return true;
  const roleCodes = await getEffectiveRoleCodesAsync(req);
  if (!roleCodes.has('owner')) return false;
  if (identity && identity.owner_user_id) return identity.owner_user_id === req.session.userId;

  const field = db.prepare(`
    SELECT m.owner_dept_id
    FROM field_entries fe
    JOIN mappings m ON fe.mapping_id = m.id
    WHERE fe.id=?
  `).get(fieldEntryId);
  return field && field.owner_dept_id === req.session.departmentId;
}

router.get('/field/:fieldEntryId', requireAuth, (req, res) => {
  const identity = db.prepare('SELECT * FROM field_identities WHERE field_entry_id=?').get(req.params.fieldEntryId);
  res.json(identity || {});
});

router.put('/:fieldEntryId', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const { candidate_systems, authoritative_system, maintain_dept_id, owner_user_id, confirmed, note } = req.body;
    const existing = db.prepare('SELECT * FROM field_identities WHERE field_entry_id=?').get(req.params.fieldEntryId);
    if (!await canEditFieldIdentity(req, req.params.fieldEntryId, existing)) {
      return res.status(403).json({ error: '仅数据 owner 或管理员可维护黄金源信息' });
    }

    const candidateSystems = Array.isArray(candidate_systems) ? JSON.stringify(candidate_systems) : candidate_systems;
    if (existing) {
      db.prepare(`
        UPDATE field_identities
        SET candidate_systems=?, authoritative_system=?, maintain_dept_id=?, owner_user_id=?, confirmed=?, note=?
        WHERE field_entry_id=?
      `).run(
        candidateSystems || null,
        authoritative_system || null,
        maintain_dept_id || null,
        owner_user_id || null,
        confirmed ? 1 : 0,
        note || null,
        req.params.fieldEntryId
      );
    } else {
      db.prepare(`
        INSERT INTO field_identities
          (field_entry_id, candidate_systems, authoritative_system, maintain_dept_id, owner_user_id, confirmed, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.params.fieldEntryId,
        candidateSystems || null,
        authoritative_system || null,
        maintain_dept_id || null,
        owner_user_id || null,
        confirmed ? 1 : 0,
        note || null
      );
    }
    res.json({ success: true });
  });
});

router.post('/:fieldEntryId/confirm', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const { authoritative_system } = req.body;
    const existing = db.prepare('SELECT * FROM field_identities WHERE field_entry_id=?').get(req.params.fieldEntryId);
    if (!existing) return res.status(404).json({ error: '字段身份不存在' });
    if (!await canEditFieldIdentity(req, req.params.fieldEntryId, existing)) {
      return res.status(403).json({ error: '仅该字段数据 owner 或管理员可确认权威系统' });
    }

    db.prepare(`
      UPDATE field_identities
      SET authoritative_system=?, confirmed=1, confirmed_by=?, confirmed_at=datetime('now')
      WHERE field_entry_id=?
    `).run(authoritative_system, req.session.userId, req.params.fieldEntryId);
    res.json({ success: true });
  });
});

module.exports = router;
