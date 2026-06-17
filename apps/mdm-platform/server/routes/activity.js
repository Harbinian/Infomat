const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  requireAuth,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync
} = require('../auth');

const MANAGER_ROLE_CODES = new Set(['admin', 'it_lead', 'project_lead', 'data_quality']);
const ALLOWED_SCOPES = new Set(['me', 'team', 'all']);
const ALLOWED_DAYS = new Set([90, 180, 365]);

async function roleCodesForUserAsync(userId, legacyRole) {
  const rows = await getUserRoleCodesAsync(userId, legacyRole);
  const codes = new Set((rows || []).map(row => row.code || row.role_code).filter(Boolean));
  if (legacyRole) codes.add(legacyRole);
  return codes;
}

async function canViewManagedActivityAsync(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  if (permSet.has('*:*') || permSet.has('admin:access') || permSet.has('data:view_all')) return true;
  const roleCodes = await roleCodesForUserAsync(req.session.userId, req.session.userRole);
  return Array.from(roleCodes).some(code => MANAGER_ROLE_CODES.has(code));
}

function parseDays(value) {
  const days = Number(value || 90);
  return ALLOWED_DAYS.has(days) ? days : 90;
}

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function isoDate(offsetDays) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function activityLevel(count) {
  if (count >= 6) return 3;
  if (count >= 3) return 2;
  if (count >= 1) return 1;
  return 0;
}

function dateRange(days) {
  return Array.from({ length: days }, (_, index) => isoDate(index - days + 1));
}

function buildBaseQuery(scope, req, query) {
  const params = {};
  const filters = [];

  if (scope === 'me') {
    filters.push('actor_user_id = @currentUserId');
    params.currentUserId = req.session.userId;
  } else if (scope === 'team') {
    filters.push('department_id = @currentDepartmentId');
    params.currentDepartmentId = req.session.departmentId || -1;
  }

  if (query.department_id) {
    filters.push('department_id = @departmentId');
    params.departmentId = Number(query.department_id);
  }
  if (query.user_id) {
    filters.push('actor_user_id = @userId');
    params.userId = Number(query.user_id);
  }

  return { filters, params };
}

function loadActivityRows(startDate, endDate) {
  const sql = `
    SELECT date(e.occurred_at) AS activity_date,
           e.source_type,
           e.source_label,
           e.actor_user_id,
           u.name AS actor_name,
           u.employee_no,
           COALESCE(u.department_id, e.department_id) AS department_id,
           d.name AS department_name
    FROM (
      SELECT created_at AS occurred_at, actor_user_id, 'process_mapping_todo' AS source_type, '流程映射待办' AS source_label, NULL AS department_id
      FROM process_mapping_todo_events
      WHERE actor_user_id IS NOT NULL

      UNION ALL
      SELECT created_at, actor_user_id, 'process_quality', '流程治理质量问题', NULL
      FROM process_governance_quality_case_events
      WHERE actor_user_id IS NOT NULL

      UNION ALL
      SELECT created_at, operator_user_id, 'mapping_review', '映射提交/审核', NULL
      FROM approval_history
      WHERE operator_user_id IS NOT NULL

      UNION ALL
      SELECT operated_at, operated_by, 'mapping_version', '映射版本记录', NULL
      FROM version_log
      WHERE operated_by IS NOT NULL

      UNION ALL
      SELECT created_at, created_by, 'terminology', '术语创建/审核', NULL
      FROM terms
      WHERE created_by IS NOT NULL

      UNION ALL
      SELECT approved_at, approved_by, 'terminology', '术语创建/审核', NULL
      FROM terms
      WHERE approved_by IS NOT NULL AND approved_at IS NOT NULL

      UNION ALL
      SELECT resolved_at, resolved_by, 'conflict', '冲突处理', NULL
      FROM term_conflicts
      WHERE resolved_by IS NOT NULL AND resolved_at IS NOT NULL

      UNION ALL
      SELECT resolved_at, resolved_by, 'conflict', '冲突处理', NULL
      FROM field_conflicts
      WHERE resolved_by IS NOT NULL AND resolved_at IS NOT NULL

      UNION ALL
      SELECT done_at, NULL, 'todo_done', '通用待办完成', to_dept_id
      FROM todos
      WHERE done_at IS NOT NULL
    ) e
    LEFT JOIN users u ON u.id = e.actor_user_id
    LEFT JOIN departments d ON d.id = COALESCE(u.department_id, e.department_id)
    WHERE e.occurred_at IS NOT NULL
      AND date(e.occurred_at) BETWEEN @startDate AND @endDate
    ORDER BY activity_date ASC, source_type ASC
  `;

  return db.prepare(sql).all({ startDate, endDate }).map(row => ({
    date: row.activity_date,
    sourceType: row.source_type,
    sourceLabel: row.source_label,
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    actorName: row.actor_name || null,
    employeeNo: row.employee_no || null,
    departmentId: row.department_id == null ? null : Number(row.department_id),
    departmentName: row.department_name || null
  }));
}

function filterRows(rows, filters, params) {
  return rows.filter(row => filters.every(filter => {
    if (filter === 'actor_user_id = @currentUserId') return row.actorUserId === params.currentUserId;
    if (filter === 'department_id = @currentDepartmentId') return row.departmentId === params.currentDepartmentId;
    if (filter === 'department_id = @departmentId') return row.departmentId === params.departmentId;
    if (filter === 'actor_user_id = @userId') return row.actorUserId === params.userId;
    return true;
  }));
}

function addSource(target, sourceType, count = 1) {
  target[sourceType] = (target[sourceType] || 0) + count;
}

function buildPayload({ scope, days, startDate, endDate, rows }) {
  const byDate = new Map(dateRange(days).map(date => [date, { date, count: 0, level: 0, sources: {}, sourceLabels: {} }]));
  const userMap = new Map();
  const departmentMap = new Map();

  rows.forEach(row => {
    const day = byDate.get(dateOnly(row.date));
    if (!day) return;
    day.count += 1;
    addSource(day.sources, row.sourceType);
    day.sourceLabels[row.sourceType] = row.sourceLabel;

    if (row.actorUserId != null) {
      const user = userMap.get(row.actorUserId) || {
        userId: row.actorUserId,
        name: row.actorName || `用户${row.actorUserId}`,
        employeeNo: row.employeeNo || '',
        departmentId: row.departmentId,
        departmentName: row.departmentName || '未绑定部门',
        count: 0,
        activeDays: new Set(),
        sources: {}
      };
      user.count += 1;
      user.activeDays.add(day.date);
      addSource(user.sources, row.sourceType);
      userMap.set(row.actorUserId, user);
    }

    if (row.departmentId != null) {
      const department = departmentMap.get(row.departmentId) || {
        departmentId: row.departmentId,
        name: row.departmentName || '未绑定部门',
        count: 0,
        activeDays: new Set(),
        sources: {}
      };
      department.count += 1;
      department.activeDays.add(day.date);
      addSource(department.sources, row.sourceType);
      departmentMap.set(row.departmentId, department);
    }
  });

  const dates = Array.from(byDate.values()).map(day => ({
    ...day,
    level: activityLevel(day.count)
  }));

  return {
    scope,
    days,
    startDate,
    endDate,
    summary: {
      totalActions: dates.reduce((sum, day) => sum + day.count, 0),
      activeDays: dates.filter(day => day.count > 0).length,
      maxDailyCount: dates.reduce((max, day) => Math.max(max, day.count), 0)
    },
    dates,
    users: Array.from(userMap.values())
      .map(user => ({ ...user, activeDays: user.activeDays.size }))
      .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'zh-CN')),
    departments: Array.from(departmentMap.values())
      .map(department => ({ ...department, activeDays: department.activeDays.size }))
      .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'zh-CN'))
  };
}

router.get('/heatmap', requireAuth, async (req, res) => {
  try {
    const scope = ALLOWED_SCOPES.has(req.query.scope) ? req.query.scope : 'me';
    const days = parseDays(req.query.days);
    const canManage = await canViewManagedActivityAsync(req);
    if (scope !== 'me' && !canManage) {
      return res.status(403).json({ error: '权限不足' });
    }
    if ((req.query.department_id || req.query.user_id) && !canManage) {
      return res.status(403).json({ error: '权限不足' });
    }

    const endDate = isoDate(0);
    const startDate = isoDate(-days + 1);
    const base = buildBaseQuery(scope, req, req.query);
    const rows = filterRows(loadActivityRows(startDate, endDate), base.filters, base.params);
    return res.json(buildPayload({ scope, days, startDate, endDate, rows }));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
