const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

const FIELD_ENTRY_CONFLICT_FIELDS = ['note', 'field_type', 'sync_mode', 'consume_systems'];

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

function addFilters(baseSql, params, severity, status) {
  let sql = `${baseSql} WHERE 1=1`;
  if (severity) {
    sql += ' AND severity=?';
    params.push(severity);
  }
  if (status) {
    sql += ' AND status=?';
    params.push(status);
  }
  return `${sql} ORDER BY created_at DESC`;
}

function conflictAlreadyExists(aId, bId, conflictField) {
  const existing = db.prepare(`
    SELECT id
    FROM field_conflicts
    WHERE field_entry_a_id=? AND field_entry_b_id=? AND conflict_field=? AND status='pending'
  `).get(aId, bId, conflictField);
  return Boolean(existing);
}

function detectConflictValues(aId, bId) {
  const identityA = db.prepare('SELECT * FROM field_identities WHERE field_entry_id=?').get(aId);
  const identityB = db.prepare('SELECT * FROM field_identities WHERE field_entry_id=?').get(bId);

  if (
    identityA &&
    identityB &&
    identityA.authoritative_system &&
    identityB.authoritative_system &&
    identityA.authoritative_system !== identityB.authoritative_system
  ) {
    return {
      conflictField: 'authoritative_system',
      severity: 'error',
      valueA: identityA.authoritative_system,
      valueB: identityB.authoritative_system
    };
  }

  const fieldA = db.prepare('SELECT note, field_type, sync_mode, consume_systems FROM field_entries WHERE id=?').get(aId);
  const fieldB = db.prepare('SELECT note, field_type, sync_mode, consume_systems FROM field_entries WHERE id=?').get(bId);
  if (!fieldA || !fieldB) return null;

  for (const fieldName of FIELD_ENTRY_CONFLICT_FIELDS) {
    const valueA = fieldA[fieldName] || '';
    const valueB = fieldB[fieldName] || '';
    if (valueA !== valueB) {
      return {
        conflictField: fieldName,
        severity: 'warn',
        valueA,
        valueB
      };
    }
  }

  return null;
}

router.get('/', requireAuth, (req, res) => {
  const { type, severity, status } = req.query;

  if (type === 'term') {
    const params = [];
    const sql = addFilters("SELECT tc.*, 'term' as conflict_type FROM term_conflicts tc", params, severity, status);
    return res.json(db.prepare(sql).all(...params));
  }

  if (type === 'field') {
    const params = [];
    const sql = addFilters("SELECT fc.*, 'field' as conflict_type FROM field_conflicts fc", params, severity, status);
    return res.json(db.prepare(sql).all(...params));
  }

  const termParams = [];
  const fieldParams = [];
  const termSql = addFilters("SELECT tc.*, 'term' as conflict_type FROM term_conflicts tc", termParams, severity, status);
  const fieldSql = addFilters("SELECT fc.*, 'field' as conflict_type FROM field_conflicts fc", fieldParams, severity, status);
  const termRows = db.prepare(termSql).all(...termParams);
  const fieldRows = db.prepare(fieldSql).all(...fieldParams);
  res.json([...termRows, ...fieldRows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
});

router.post('/detect', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { field_name_cn } = req.query;
    if (!field_name_cn) return res.status(400).json({ error: '缺少 field_name_cn' });

    const pairs = db.prepare(`
      SELECT a.id as a_id, b.id as b_id, a.submitted_by as sa, b.submitted_by as sb,
             ua.department_id as da, ub.department_id as db
      FROM field_entries a
      JOIN field_entries b ON a.field_name_cn = b.field_name_cn AND a.field_name_en = b.field_name_en AND a.id < b.id
      JOIN users ua ON a.submitted_by = ua.id
      JOIN users ub ON b.submitted_by = ub.id
      WHERE a.field_name_cn = ? AND ua.department_id != ub.department_id
    `).all(field_name_cn);

    const insertConflicts = db.transaction(() => {
      let inserted = 0;
      pairs.forEach(pair => {
        const result = detectConflictValues(pair.a_id, pair.b_id);
        if (!result) return;
        if (result.valueA === result.valueB) return;
        if (conflictAlreadyExists(pair.a_id, pair.b_id, result.conflictField)) return;

        db.prepare(`
          INSERT INTO field_conflicts
            (field_entry_a_id, field_entry_b_id, conflict_field, submitter_a, value_a, submitter_b, value_b, dept_a, dept_b, severity)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          pair.a_id,
          pair.b_id,
          result.conflictField,
          pair.sa,
          result.valueA,
          pair.sb,
          result.valueB,
          pair.da,
          pair.db,
          result.severity
        );
        inserted += 1;
      });
      return inserted;
    });

    res.json({ detected: insertConflicts() });
  });
});

router.post('/:id/resolve', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { resolution, adopted_value } = req.body;
    const conflict = db.prepare('SELECT * FROM field_conflicts WHERE id=?').get(req.params.id);
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });

    const resolve = db.transaction(() => {
      db.prepare("UPDATE field_conflicts SET status='resolved', resolution=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?").run(
        resolution || null,
        req.session.userId,
        req.params.id
      );

      if (conflict.conflict_field === 'authoritative_system' && adopted_value) {
        [conflict.field_entry_a_id, conflict.field_entry_b_id].forEach(fieldEntryId => {
          const identity = db.prepare('SELECT id FROM field_identities WHERE field_entry_id=?').get(fieldEntryId);
          if (identity) {
            db.prepare(`
              UPDATE field_identities
              SET authoritative_system=?, confirmed=1, confirmed_by=?, confirmed_at=datetime('now')
              WHERE field_entry_id=?
            `).run(adopted_value, req.session.userId, fieldEntryId);
          }
        });
      } else if (FIELD_ENTRY_CONFLICT_FIELDS.includes(conflict.conflict_field) && adopted_value !== undefined) {
        [conflict.field_entry_a_id, conflict.field_entry_b_id].forEach(fieldEntryId => {
          db.prepare(`UPDATE field_entries SET ${conflict.conflict_field}=?, updated_at=datetime('now') WHERE id=?`).run(adopted_value, fieldEntryId);
        });
      }

      const mapping = db.prepare(`
        SELECT m.id as mapping_id
        FROM mappings m
        JOIN field_entries fe ON fe.mapping_id = m.id
        WHERE fe.id IN (?, ?)
        LIMIT 1
      `).get(conflict.field_entry_a_id, conflict.field_entry_b_id);

      if (mapping) {
        const remainingErrors = db.prepare(`
          SELECT COUNT(DISTINCT fc.id) as cnt
          FROM field_conflicts fc
          JOIN field_entries fe ON fc.field_entry_a_id = fe.id OR fc.field_entry_b_id = fe.id
          WHERE fe.mapping_id = ? AND fc.severity = 'error' AND fc.status = 'pending'
        `).get(mapping.mapping_id);
        if (remainingErrors.cnt === 0) {
          db.prepare("UPDATE approval_tasks SET status='in_progress' WHERE mapping_id=? AND status='blocked'").run(mapping.mapping_id);
        }
      }
    });

    resolve();
    res.json({ success: true });
  });
});

router.post('/term/:id/resolve', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { resolution } = req.body;
    db.prepare("UPDATE term_conflicts SET status='resolved', resolution=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?").run(
      resolution || null,
      req.session.userId,
      req.params.id
    );
    res.json({ success: true });
  });
});

module.exports = router;
