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

function runDbAction(res, action) {
  try {
    return action();
  } catch (error) {
    return handleDbError(res, error);
  }
}

router.get('/', requireAuth, (req, res) => {
  const { status, dept_id } = req.query;
  let sql = `SELECT m.*, p.name as process_name, c.name as cap_name, d.name as owner_dept_name,
             (SELECT GROUP_CONCAT(s.name, ', ') FROM mapping_systems ms JOIN systems s ON ms.system_id = s.id WHERE ms.mapping_id = m.id) as systems
             FROM mappings m
             JOIN processes p ON m.process_id = p.id
             LEFT JOIN capabilities c ON p.capability_id = c.id
             JOIN departments d ON m.owner_dept_id = d.id
             WHERE 1=1`;
  const params = [];

  if (status) {
    sql += ' AND m.status=?';
    params.push(status);
  }
  if (dept_id) {
    sql += ' AND m.owner_dept_id=?';
    params.push(dept_id);
  }

  sql += ' ORDER BY m.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', requireAuth, (req, res) => {
  const mapping = db.prepare(`
    SELECT m.*, p.name as process_name, d.name as owner_dept_name
    FROM mappings m
    JOIN processes p ON m.process_id = p.id
    JOIN departments d ON m.owner_dept_id = d.id
    WHERE m.id=?
  `).get(req.params.id);
  if (!mapping) return res.status(404).json({ error: '映射不存在' });

  const systems = db.prepare(`
    SELECT ms.*, s.name as system_name
    FROM mapping_systems ms
    JOIN systems s ON ms.system_id = s.id
    WHERE ms.mapping_id=?
    ORDER BY ms.sort_order
  `).all(req.params.id);
  const fields = db.prepare('SELECT * FROM field_entries WHERE mapping_id=? ORDER BY id').all(req.params.id);
  const relatedDepts = db.prepare('SELECT * FROM mapping_related_departments WHERE mapping_id=?').all(req.params.id);
  const approvalTasks = db.prepare('SELECT * FROM approval_tasks WHERE mapping_id=? ORDER BY step, id').all(req.params.id);

  res.json({ ...mapping, systems, fields, relatedDepts, approvalTasks });
});

function mappingStatusAfterStep(step) {
  return {
    2: 'dept_reviewed',
    3: 'cross_confirmed',
    4: 'fields_confirmed',
    5: 'final_reviewed'
  }[Number(step)];
}

function hasPendingErrorConflicts(mappingId) {
  const row = db.prepare(`
    SELECT COUNT(DISTINCT fc.id) as cnt
    FROM field_conflicts fc
    JOIN field_entries fe ON fc.field_entry_a_id = fe.id OR fc.field_entry_b_id = fe.id
    WHERE fe.mapping_id = ? AND fc.severity = 'error' AND fc.status = 'pending'
  `).get(mappingId);
  return row.cnt > 0;
}

function remainingTasksForStep(mappingId, step) {
  return db.prepare(`
    SELECT COUNT(*) as cnt
    FROM approval_tasks
    WHERE mapping_id=? AND step=? AND status != 'approved'
  `).get(mappingId, step).cnt;
}

function replaceMappingRelations(mappingId, systems = [], relatedDepartments = []) {
  db.prepare('DELETE FROM mapping_systems WHERE mapping_id=?').run(mappingId);
  db.prepare('DELETE FROM mapping_related_departments WHERE mapping_id=?').run(mappingId);

  const msStmt = db.prepare('INSERT INTO mapping_systems (mapping_id, system_id, system_role, sort_order) VALUES (?, ?, ?, ?)');
  systems.forEach((system, index) => {
    msStmt.run(mappingId, system.system_id, system.system_role || 'secondary', system.sort_order || index + 1);
  });

  const rdStmt = db.prepare('INSERT INTO mapping_related_departments (mapping_id, department_id, relation) VALUES (?, ?, ?)');
  relatedDepartments.forEach(department => {
    rdStmt.run(mappingId, department.department_id, department.relation || 'collaborator');
  });
}

function advanceToNextRunnableStep(mappingId, completedStep) {
  let nextStep = Number(completedStep) + 1;

  while (nextStep <= 5) {
    const tasks = db.prepare('SELECT status FROM approval_tasks WHERE mapping_id=? AND step=?').all(mappingId, nextStep);
    if (tasks.length === 0 || tasks.every(task => task.status === 'approved')) {
      const status = mappingStatusAfterStep(nextStep);
      db.prepare("UPDATE mappings SET status=?, current_step=?, updated_at=datetime('now') WHERE id=?").run(status, nextStep + 1, mappingId);
      nextStep += 1;
      continue;
    }

    const status = mappingStatusAfterStep(completedStep);
    db.prepare("UPDATE mappings SET status=?, current_step=?, updated_at=datetime('now') WHERE id=?").run(status, nextStep, mappingId);
    db.prepare("UPDATE approval_tasks SET status='in_progress' WHERE mapping_id=? AND step=? AND status='pending'").run(mappingId, nextStep);
    return;
  }

  db.prepare("UPDATE mappings SET status='published', current_step=5, updated_at=datetime('now') WHERE id=?").run(mappingId);
}

router.post('/', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { process_id, description, approval_dept_id, owner_dept_id, systems = [], related_departments = [] } = req.body;
    const insertMapping = db.transaction(() => {
      const mStmt = db.prepare(`
        INSERT INTO mappings (process_id, description, approval_dept_id, owner_dept_id, status, submitted_by, current_step)
        VALUES (?, ?, ?, ?, 'draft', ?, 1)
      `);
      const result = mStmt.run(process_id, description || null, approval_dept_id || null, owner_dept_id, req.session.userId);
      const mappingId = result.lastInsertRowid;

      replaceMappingRelations(mappingId, systems, related_departments);

      const cs = db.prepare("INSERT INTO change_set (entity_type, entity_id, operated_by, description) VALUES ('mapping', ?, ?, '创建映射')").run(
        mappingId,
        req.session.userId
      );
      db.prepare("INSERT INTO version_log (entity_type, entity_id, operation, operated_by, change_set_id) VALUES ('mapping', ?, 'create', ?, ?)").run(
        mappingId,
        req.session.userId,
        cs.lastInsertRowid
      );

      return mappingId;
    });

    res.json({ id: insertMapping() });
  });
});

router.put('/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { process_id, description, approval_dept_id, owner_dept_id, systems = [], related_departments = [] } = req.body;
    const mapping = db.prepare('SELECT * FROM mappings WHERE id=?').get(req.params.id);
    if (!mapping) return res.status(404).json({ error: '映射不存在' });
    if (mapping.status !== 'draft') return res.status(400).json({ error: '只能修改草稿状态' });
    if (mapping.submitted_by !== req.session.userId && req.session.userRole !== 'admin') {
      return res.status(403).json({ error: '仅创建人或管理员可修改草稿' });
    }

    const updateMapping = db.transaction(() => {
      db.prepare(`
        UPDATE mappings
        SET process_id=?, description=?, approval_dept_id=?, owner_dept_id=?, updated_at=datetime('now')
        WHERE id=?
      `).run(process_id, description || null, approval_dept_id || null, owner_dept_id, req.params.id);
      replaceMappingRelations(req.params.id, systems, related_departments);

      const cs = db.prepare("INSERT INTO change_set (entity_type, entity_id, operated_by, description) VALUES ('mapping', ?, ?, '更新映射草稿')").run(
        req.params.id,
        req.session.userId
      );
      db.prepare("INSERT INTO version_log (entity_type, entity_id, operation, operated_by, change_set_id) VALUES ('mapping', ?, 'update', ?, ?)").run(
        req.params.id,
        req.session.userId,
        cs.lastInsertRowid
      );
    });
    updateMapping();
    res.json({ success: true });
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const mapping = db.prepare('SELECT * FROM mappings WHERE id=?').get(req.params.id);
    if (!mapping) return res.status(404).json({ error: '映射不存在' });
    if (mapping.status !== 'draft') return res.status(400).json({ error: '只能删除草稿状态' });
    if (mapping.submitted_by !== req.session.userId && req.session.userRole !== 'admin') {
      return res.status(403).json({ error: '仅创建人或管理员可删除草稿' });
    }
    db.prepare('DELETE FROM mappings WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });
});

router.post('/:id/submit', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const mapping = db.prepare('SELECT * FROM mappings WHERE id=? AND submitted_by=?').get(req.params.id, req.session.userId);
    if (!mapping) return res.status(403).json({ error: '无权限或映射不存在' });
    if (mapping.status !== 'draft') return res.status(400).json({ error: '只能提交草稿状态' });

    const insertTasks = db.transaction(() => {
      db.prepare('DELETE FROM approval_tasks WHERE mapping_id=?').run(req.params.id);
      db.prepare("UPDATE mappings SET status='submitted', submitted_at=datetime('now'), current_step=2, updated_at=datetime('now') WHERE id=?").run(req.params.id);
      db.prepare("INSERT INTO approval_history (mapping_id, step, operator_user_id, action) VALUES (?, 1, ?, 'submit')").run(req.params.id, req.session.userId);

      const ownerDept = db.prepare('SELECT manager_user_id FROM departments WHERE id=?').get(mapping.owner_dept_id);
      db.prepare(`
        INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, assigned_dept_id, status)
        VALUES (?, 2, '部门内审', ?, ?, 'in_progress')
      `).run(req.params.id, ownerDept ? ownerDept.manager_user_id : null, mapping.owner_dept_id);

      const relatedDepts = db.prepare('SELECT department_id FROM mapping_related_departments WHERE mapping_id=?').all(req.params.id);
      if (relatedDepts.length === 0) {
        db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, assigned_dept_id, status) VALUES (?, 3, '跨部门确认', NULL, NULL, 'approved')").run(req.params.id);
      } else {
        relatedDepts.forEach(({ department_id }) => {
          const manager = db.prepare('SELECT manager_user_id FROM departments WHERE id=?').get(department_id);
          db.prepare(`
            INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, assigned_dept_id, status)
            VALUES (?, 3, '跨部门确认', ?, ?, 'pending')
          `).run(req.params.id, manager ? manager.manager_user_id : null, department_id);
        });
      }

      const fieldIdentities = db.prepare(`
        SELECT fi.owner_user_id, fi.maintain_dept_id
        FROM field_identities fi
        JOIN field_entries fe ON fi.field_entry_id = fe.id
        WHERE fe.mapping_id=?
      `).all(req.params.id);

      if (fieldIdentities.length === 0) {
        db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, status) VALUES (?, 4, '字段台账确认', 'approved')").run(req.params.id);
      } else {
        const taskKeys = new Set();
        fieldIdentities.forEach(({ owner_user_id, maintain_dept_id }) => {
          let assigneeUserId = owner_user_id;
          if (!assigneeUserId && maintain_dept_id) {
            const ownerUser = db.prepare("SELECT id FROM users WHERE department_id=? AND role='owner' LIMIT 1").get(maintain_dept_id);
            assigneeUserId = ownerUser ? ownerUser.id : null;
          }

          const key = `${assigneeUserId || 'dept'}:${maintain_dept_id || 'none'}`;
          if (taskKeys.has(key)) return;
          taskKeys.add(key);
          db.prepare(`
            INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, assigned_dept_id, status)
            VALUES (?, 4, '字段台账确认', ?, ?, 'pending')
          `).run(req.params.id, assigneeUserId, maintain_dept_id || null);
        });

        if (taskKeys.size === 0) {
          db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, status) VALUES (?, 4, '字段台账确认', 'approved')").run(req.params.id);
        }
      }

      const fallbackAdmin = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
      if (fallbackAdmin) {
        db.prepare("UPDATE approval_tasks SET assignee_user_id=? WHERE mapping_id=? AND assignee_user_id IS NULL AND status='pending'").run(
          fallbackAdmin.id,
          req.params.id
        );
      } else {
        db.prepare("UPDATE approval_tasks SET status='approved' WHERE mapping_id=? AND assignee_user_id IS NULL AND status='pending'").run(req.params.id);
      }

      const admins = db.prepare("SELECT id FROM users WHERE role='admin'").all();
      if (admins.length === 0) {
        db.prepare("INSERT INTO approval_tasks (mapping_id, step, step_name, status) VALUES (?, 5, '信息化项目组终审', 'approved')").run(req.params.id);
      } else {
        admins.forEach(({ id: adminId }) => {
          db.prepare(`
            INSERT INTO approval_tasks (mapping_id, step, step_name, assignee_user_id, status)
            VALUES (?, 5, '信息化项目组终审', ?, 'pending')
          `).run(req.params.id, adminId);
        });
      }
    });
    insertTasks();
    res.json({ success: true });
  });
});

router.post('/:id/review', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    const { step, action, opinion } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: '不支持的审核操作' });
    }

    const task = db.prepare(`
      SELECT at.*
      FROM approval_tasks at
      WHERE at.mapping_id=? AND at.step=? AND at.assignee_user_id=?
        AND at.status NOT IN ('approved','rejected')
    `).get(req.params.id, step, req.session.userId);
    if (!task) return res.status(400).json({ error: '当前节点状态不允许审核，或您不是该节点审核人' });

    const updateTask = db.transaction(() => {
      if (action === 'approve' && Number(step) === 3 && hasPendingErrorConflicts(req.params.id)) {
        db.prepare("UPDATE approval_tasks SET status='blocked' WHERE mapping_id=? AND step=3 AND status IN ('pending','in_progress')").run(req.params.id);
        db.prepare("INSERT INTO approval_history (mapping_id, step, operator_user_id, action, opinion) VALUES (?, 3, ?, 'auto_conflict', ?)").run(
          req.params.id,
          req.session.userId,
          '存在未解决的 error 冲突，需先解决冲突'
        );
        return { blocked: true };
      }

      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      db.prepare("UPDATE approval_tasks SET status=?, opinion=?, operated_by=?, operated_at=datetime('now') WHERE id=?").run(
        newStatus,
        opinion || null,
        req.session.userId,
        task.id
      );
      db.prepare('INSERT INTO approval_history (mapping_id, step, operator_user_id, action, opinion) VALUES (?, ?, ?, ?, ?)').run(
        req.params.id,
        step,
        req.session.userId,
        action,
        opinion || null
      );

      if (action === 'reject') {
        db.prepare('UPDATE approval_tasks SET reject_count=reject_count+1 WHERE id=?').run(task.id);
        db.prepare("UPDATE approval_tasks SET status='rejected' WHERE mapping_id=? AND status IN ('pending','in_progress','blocked')").run(req.params.id);
        db.prepare("UPDATE mappings SET status='draft', current_step=1, updated_at=datetime('now') WHERE id=?").run(req.params.id);
        return {};
      }

      if (remainingTasksForStep(req.params.id, step) > 0) {
        return { waiting: true };
      }

      if (Number(step) === 5) {
        db.prepare("UPDATE mappings SET status='published', current_step=5, updated_at=datetime('now') WHERE id=?").run(req.params.id);
        return {};
      }

      db.prepare("UPDATE mappings SET status=?, updated_at=datetime('now') WHERE id=?").run(mappingStatusAfterStep(step), req.params.id);
      advanceToNextRunnableStep(req.params.id, step);
      return {};
    });

    const result = updateTask();
    if (result && result.blocked) {
      return res.json({ success: true, blocked: true, reason: '存在未解决的 error 冲突，需先解决冲突' });
    }
    if (result && result.waiting) {
      return res.json({ success: true, waiting: true, reason: '当前节点仍有其他并行审核任务未完成' });
    }
    res.json({ success: true });
  });
});

router.post('/:id/publish', requireAuth, (req, res) => {
  return runDbAction(res, () => {
    if (req.session.userRole !== 'admin') return res.status(403).json({ error: '仅信息化项目组可发布' });
    db.prepare("UPDATE mappings SET status='published', current_step=5, updated_at=datetime('now') WHERE id=?").run(req.params.id);
    res.json({ success: true });
  });
});

module.exports = router;
