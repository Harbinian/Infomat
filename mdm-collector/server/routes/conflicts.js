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
  return `${sql} ORDER BY CASE severity WHEN 'blocking' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 WHEN 'error' THEN 4 WHEN 'warn' THEN 5 ELSE 6 END, created_at DESC`;
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

// GET / — list all conflicts, optionally filtered
router.get('/', requireAuth, (req, res) => {
  const { type, severity, status } = req.query;
  const userRole = req.session.userRole;

  if (type === 'term') {
    const params = [];
    let sql = addFilters("SELECT tc.*, 'term' as conflict_type FROM term_conflicts tc", params, severity, status);
    if (userRole !== 'admin' && !status) {
      sql = sql.replace('WHERE 1=1', "WHERE 1=1 AND tc.status != 'archived'");
    }
    return res.json(db.prepare(sql).all(...params));
  }

  if (type === 'field') {
    const params = [];
    let sql = addFilters("SELECT fc.*, 'field' as conflict_type FROM field_conflicts fc", params, severity, status);
    if (userRole !== 'admin' && !status) {
      sql = sql.replace('WHERE 1=1', "WHERE 1=1 AND fc.status != 'archived'");
    }
    return res.json(db.prepare(sql).all(...params));
  }

  const termParams = [];
  const fieldParams = [];
  let termSql = addFilters("SELECT tc.*, 'term' as conflict_type FROM term_conflicts tc", termParams, severity, status);
  let fieldSql = addFilters("SELECT fc.*, 'field' as conflict_type FROM field_conflicts fc", fieldParams, severity, status);

  if (userRole !== 'admin' && !status) {
    termSql = termSql.replace('WHERE 1=1', "WHERE 1=1 AND tc.status != 'archived'");
    fieldSql = fieldSql.replace('WHERE 1=1', "WHERE 1=1 AND fc.status != 'archived'");
  }

  const termRows = db.prepare(termSql).all(...termParams);
  const fieldRows = db.prepare(fieldSql).all(...fieldParams);
  res.json([...termRows, ...fieldRows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
});

// GET /:id — conflict detail with assignments and coordination history
router.get('/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { type } = req.query;
    const conflictType = type || 'field';

    let conflict;
    if (conflictType === 'term') {
      conflict = db.prepare('SELECT * FROM term_conflicts WHERE id=?').get(req.params.id);
    } else {
      conflict = db.prepare(`
        SELECT fc.*, fe_a.field_name_cn as field_name_a, fe_b.field_name_cn as field_name_b,
               da.name as dept_a_name, db.name as dept_b_name
        FROM field_conflicts fc
        JOIN field_entries fe_a ON fc.field_entry_a_id = fe_a.id
        JOIN field_entries fe_b ON fc.field_entry_b_id = fe_b.id
        LEFT JOIN departments da ON fc.dept_a = da.id
        LEFT JOIN departments db ON fc.dept_b = db.id
        WHERE fc.id=?
      `).get(req.params.id);
    }
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });

    const currentAssignee = db.prepare(`
      SELECT ca.*, u.name as assignee_name
      FROM conflict_assignments ca
      LEFT JOIN users u ON ca.assignee_user_id = u.id
      WHERE ca.conflict_id=? AND ca.conflict_type=?
      ORDER BY ca.created_at DESC LIMIT 1
    `).get(req.params.id, conflictType);

    const coordinationHistory = db.prepare(`
      SELECT cch.*, u.name as assignee_name
      FROM conflict_coordination_history cch
      LEFT JOIN users u ON cch.assignee_user_id = u.id
      WHERE cch.conflict_id=? AND cch.conflict_type=?
      ORDER BY cch.created_at DESC
    `).all(req.params.id, conflictType);

    const assignmentHistory = db.prepare(`
      SELECT ca.*, u.name as assignee_name, au.name as assigned_by_name
      FROM conflict_assignments ca
      LEFT JOIN users u ON ca.assignee_user_id = u.id
      LEFT JOIN users au ON ca.assigned_by = au.id
      WHERE ca.conflict_id=? AND ca.conflict_type=?
      ORDER BY ca.created_at DESC
    `).all(req.params.id, conflictType);

    res.json({ ...conflict, conflict_type: conflictType, currentAssignee, coordinationHistory, assignmentHistory });
  });
});

// POST /:id/assign — assign owner (reviewer only)
router.post('/:id/assign', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    if (!['reviewer','admin'].includes(req.session.userRole)) {
      return res.status(403).json({ error: '仅 reviewer 可指定责任人' });
    }
    const { type } = req.query;
    const conflictType = type || 'field';
    const { assignee_user_id } = req.body;

    let conflict;
    if (conflictType === 'term') {
      conflict = db.prepare('SELECT * FROM term_conflicts WHERE id=?').get(req.params.id);
    } else {
      conflict = db.prepare('SELECT * FROM field_conflicts WHERE id=?').get(req.params.id);
    }
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });
    if (!['pending','coordinating'].includes(conflict.status)) {
      return res.status(409).json({ error: '只能在待处理或协调中状态指定责任人' });
    }

    db.transaction(() => {
      db.prepare(`
        INSERT INTO conflict_assignments (conflict_id, conflict_type, assignee_user_id, assigned_by)
        VALUES (?, ?, ?, ?)
      `).run(req.params.id, conflictType, assignee_user_id, req.session.userId);

      if (conflict.status === 'pending') {
        const table = conflictType === 'term' ? 'term_conflicts' : 'field_conflicts';
        db.prepare(`UPDATE ${table} SET status='coordinating' WHERE id=?`).run(req.params.id);
      }

      const assignee = db.prepare('SELECT * FROM users WHERE id=?').get(assignee_user_id);
      const fromDept = db.prepare('SELECT department_id FROM users WHERE id=?').get(req.session.userId);
      db.prepare(`
        INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, content, urgency)
        VALUES (?, ?, 'conflict_resolution', NULL, ?, 'high')
      `).run(
        fromDept ? fromDept.department_id : null,
        assignee ? assignee.department_id : null,
        `冲突协调：${conflictType === 'term' ? conflict.term : `字段冲突 #${conflict.id}`}`
      );
    })();

    res.json({ success: true });
  });
});

// PUT /:id/assign — reassign owner (reviewer only, coordinating only)
router.put('/:id/assign', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    if (!['reviewer','admin'].includes(req.session.userRole)) {
      return res.status(403).json({ error: '仅 reviewer 可改派责任人' });
    }
    const { type } = req.query;
    const conflictType = type || 'field';
    const { assignee_user_id } = req.body;

    const table = conflictType === 'term' ? 'term_conflicts' : 'field_conflicts';
    const conflict = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });
    if (conflict.status !== 'coordinating') {
      return res.status(409).json({ error: '仅协调中状态可改派' });
    }

    db.prepare(`
      INSERT INTO conflict_assignments (conflict_id, conflict_type, assignee_user_id, assigned_by)
      VALUES (?, ?, ?, ?)
    `).run(req.params.id, conflictType, assignee_user_id, req.session.userId);

    res.json({ success: true });
  });
});

// POST /:id/coordination — submit coordination result (assignee only)
router.post('/:id/coordination', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { type } = req.query;
    const conflictType = type || 'field';
    const { result, note } = req.body;

    if (!['A','B','compromise'].includes(result)) {
      return res.status(422).json({ error: 'result 必须为 A, B, 或 compromise' });
    }

    const currentAssignee = db.prepare(`
      SELECT assignee_user_id FROM conflict_assignments
      WHERE conflict_id=? AND conflict_type=?
      ORDER BY created_at DESC LIMIT 1
    `).get(req.params.id, conflictType);

    if (!currentAssignee) return res.status(400).json({ error: '尚未指定责任人' });
    if (currentAssignee.assignee_user_id !== req.session.userId && req.session.userRole !== 'admin') {
      return res.status(403).json({ error: '仅当前责任人可提交协调结果' });
    }

    const table = conflictType === 'term' ? 'term_conflicts' : 'field_conflicts';
    const conflict = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });
    if (conflict.status !== 'coordinating') {
      return res.status(409).json({ error: '仅协调中状态可提交协调结果' });
    }

    db.prepare(`
      INSERT INTO conflict_coordination_history (conflict_id, conflict_type, assignee_user_id, result, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.id, conflictType, req.session.userId, result, note || null);

    res.json({ success: true });
  });
});

// POST /:id/final-decide — reviewer final decision
router.post('/:id/final-decide', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    if (!['reviewer','admin'].includes(req.session.userRole)) {
      return res.status(403).json({ error: '仅 reviewer 可终裁' });
    }
    const { type } = req.query;
    const conflictType = type || 'field';
    const { resolution, opinion } = req.body;

    const table = conflictType === 'term' ? 'term_conflicts' : 'field_conflicts';
    const conflict = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });
    if (conflict.status !== 'coordinating') {
      return res.status(409).json({ error: '仅协调中状态可终裁' });
    }

    db.prepare(`
      UPDATE ${table} SET status='resolved', resolution=?, resolved_by=?, resolved_at=datetime('now')
      WHERE id=?
    `).run(resolution || null, req.session.userId, req.params.id);

    res.json({ success: true });
  });
});

// POST /:id/reopen — reopen resolved conflict (reviewer only)
router.post('/:id/reopen', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    if (!['reviewer','admin'].includes(req.session.userRole)) {
      return res.status(403).json({ error: '仅 reviewer 可重开' });
    }
    const { type } = req.query;
    const conflictType = type || 'field';

    const table = conflictType === 'term' ? 'term_conflicts' : 'field_conflicts';
    const conflict = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });
    if (conflict.status !== 'resolved') {
      return res.status(409).json({ error: '仅已解决状态可重开' });
    }

    db.prepare(`UPDATE ${table} SET status='pending', resolution=NULL, resolved_by=NULL, resolved_at=NULL WHERE id=?`).run(req.params.id);
    res.json({ success: true });
  });
});

// POST /:id/archive — archive resolved conflict (admin only)
router.post('/:id/archive', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    if (req.session.userRole !== 'admin') {
      return res.status(403).json({ error: '仅管理员可归档' });
    }
    const { type } = req.query;
    const conflictType = type || 'field';

    const table = conflictType === 'term' ? 'term_conflicts' : 'field_conflicts';
    const conflict = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });
    if (conflict.status !== 'resolved') {
      return res.status(409).json({ error: '仅已解决状态可归档' });
    }

    db.prepare(`UPDATE ${table} SET status='archived' WHERE id=?`).run(req.params.id);
    res.json({ success: true });
  });
});

// Keep existing detect endpoint
router.post('/detect', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { field_name_cn } = req.query;

    const detectTerms = db.transaction(() => {
      let inserted = 0;
      const terms = db.prepare(`SELECT id, term, definition, scope FROM terms WHERE status='approved'`).all();

      for (let i = 0; i < terms.length; i++) {
        for (let j = i + 1; j < terms.length; j++) {
          const t1 = terms[i];
          const t2 = terms[j];

          // Detect term conflicts (e.g. similar term names but different scope/definition)
          if (t1.term === t2.term || (t1.term.includes(t2.term) && t1.term.length - t2.term.length < 3)) {
            if (t1.definition !== t2.definition || t1.scope !== t2.scope) {
              const existing = db.prepare(`SELECT id FROM term_conflicts WHERE term_id=? AND conflict_term_id=? AND status='pending'`).get(t1.id, t2.id);
              if (!existing) {
                 db.prepare(`
                   INSERT INTO term_conflicts (term_id, conflict_term_id, dept_a_meaning, dept_b_meaning, severity)
                   VALUES (?, ?, ?, ?, ?)
                 `).run(t1.id, t2.id, t1.definition, t2.definition, 'warn');
                 inserted += 1;
              }
            }
          }
        }
      }
      return inserted;
    });
    const termConflictsDetected = detectTerms();

    if (!field_name_cn) {
        return res.json({ detected: termConflictsDetected, message: '术语冲突检测完成，未提供 field_name_cn 故跳过字段冲突检测' });
    }

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

    res.json({ detected: insertConflicts() + termConflictsDetected });
  });
});

// Keep existing resolve endpoint
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

// Keep existing term resolve endpoint
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
