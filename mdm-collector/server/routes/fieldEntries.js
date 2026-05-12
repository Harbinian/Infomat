const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

const ALL_FIELD_ENTRY_FIELDS = ['field_name_cn', 'field_name_en', 'data_object', 'field_type', 'consume_systems', 'sync_mode', 'note'];
const SUBMITTER_WRITABLE = ['data_object', 'note'];
const OWNER_WRITABLE = ['field_name_cn', 'field_name_en', 'field_type', 'consume_systems', 'sync_mode'];

function handleDbError(res, error) {
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

function normalizeValue(fieldName, value) {
  if (fieldName === 'consume_systems' && Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function canCreateFieldForMapping(req, mappingId) {
  if (req.session.userRole === 'admin') return true;
  const mapping = db.prepare('SELECT submitted_by FROM mappings WHERE id=?').get(mappingId);
  return mapping && req.session.userRole === 'submitter' && mapping.submitted_by === req.session.userId;
}

function canEditOwnerColumns(req, field) {
  if (req.session.userRole === 'admin' || req.session.userRole === 'reviewer') return true;
  if (req.session.userRole !== 'owner') return false;

  const mapping = db.prepare('SELECT owner_dept_id FROM mappings WHERE id=?').get(field.mapping_id);
  return mapping && mapping.owner_dept_id === req.session.departmentId;
}

router.get('/mapping/:mappingId', requireAuth, (req, res) => {
  const fields = db.prepare('SELECT * FROM field_entries WHERE mapping_id=? ORDER BY id').all(req.params.mappingId);
  res.json(fields);
});

router.post('/', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note } = req.body;
    if (!canCreateFieldForMapping(req, mapping_id)) {
      return res.status(403).json({ error: '仅该映射报送人或管理员可创建字段' });
    }

    const normalizedConsumeSystems = normalizeValue('consume_systems', consume_systems);
    const values = req.session.userRole === 'admin'
      ? { field_name_cn, field_name_en, data_object, field_type, consume_systems: normalizedConsumeSystems, sync_mode, note }
      : { field_name_cn: null, field_name_en: null, data_object, field_type: null, consume_systems: null, sync_mode: null, note };

    const stmt = db.prepare(`
      INSERT INTO field_entries
        (mapping_id, field_name_cn, field_name_en, data_object, field_type, consume_systems, sync_mode, note, submitted_by, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const result = stmt.run(
      mapping_id,
      values.field_name_cn || null,
      values.field_name_en || null,
      values.data_object || null,
      values.field_type || null,
      values.consume_systems || null,
      values.sync_mode || null,
      values.note || null,
      req.session.userId
    );
    res.json({ id: result.lastInsertRowid });
  });
});

router.put('/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const fieldId = req.params.id;
    const field = db.prepare('SELECT * FROM field_entries WHERE id=?').get(fieldId);
    if (!field) return res.status(404).json({ error: '字段不存在' });

    let allowedFields;
    if (req.session.userRole === 'admin' || req.session.userRole === 'reviewer') {
      allowedFields = ALL_FIELD_ENTRY_FIELDS;
    } else if (canEditOwnerColumns(req, field)) {
      allowedFields = OWNER_WRITABLE;
    } else if (req.session.userRole === 'submitter' && field.submitted_by === req.session.userId) {
      allowedFields = SUBMITTER_WRITABLE;
    } else {
      return res.status(403).json({ error: '仅字段报送人、映射 owner 部门、评审人或管理员可修改字段' });
    }

    const updateField = db.transaction(() => {
      const nextValues = allowedFields.map(fieldName => {
        if (Object.prototype.hasOwnProperty.call(req.body, fieldName)) {
          return normalizeValue(fieldName, req.body[fieldName]);
        }
        return field[fieldName];
      });

      const changed = allowedFields
        .map((fieldName, index) => ({ fieldName, nextValue: nextValues[index] }))
        .filter(change => String(field[change.fieldName] ?? '') !== String(change.nextValue ?? ''));

      if (changed.length > 0) {
        const changeSet = db.prepare("INSERT INTO change_set (entity_type, entity_id, operated_by, description) VALUES ('field_entry', ?, ?, '更新字段')").run(
          fieldId,
          req.session.userId
        );
        changed.forEach(({ fieldName, nextValue }) => {
          db.prepare(`
            INSERT INTO version_log
              (entity_type, entity_id, field_name, old_value, new_value, operation, operated_by, change_set_id)
            VALUES ('field_entry', ?, ?, ?, ?, 'update', ?, ?)
          `).run(fieldId, fieldName, field[fieldName], nextValue, req.session.userId, changeSet.lastInsertRowid);
        });
      }

      const updates = allowedFields.map(fieldName => `${fieldName}=?`).join(', ');
      db.prepare(`UPDATE field_entries SET ${updates}, updated_at=datetime('now') WHERE id=?`).run(...nextValues, fieldId);
    });

    updateField();
    res.json({ success: true });
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    db.prepare('DELETE FROM field_entries WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });
});

module.exports = router;
