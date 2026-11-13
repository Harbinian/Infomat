const { sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const { logRequestFailure } = require('../securityLog');
const router = express.Router();
const {identityInteger,sameIdentityInteger:same}=require('../sessionSubject');
const qualityActivity=require('../qualityAuditActivity');
const {
  requireAuth,
  getUserEffectivePermissionsAsync
} = require('../auth');
const {
  auditRepository,
  resetAuditRepositoryFactory,
  setAuditRepositoryFactory
} = require('../auditMysqlRepository');

const ALLOWED_SCOPES = new Set(['me', 'team', 'all']);
const ALLOWED_DAYS = new Set([90, 180, 365]);

async function canViewManagedActivityAsync(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet.has('governance:read-global') || permSet.has('identity:read-audit');
}

function parseDays(value) {
  const days = Number(value || 90);
  return ALLOWED_DAYS.has(days) ? days : 90;
}

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function isoDate(offsetDays) {
  return new Date(Date.now()+8*3600000+offsetDays*86400000).toISOString().slice(0,10);
}

function activityLevel(count) {
  if (count >= 6) return 3;
  if (count >= 3) return 2;
  if (count >= 1) return 1;
  return 0;
}

function dateRange(days,endDate) {
  const last=Date.parse(endDate+'T12:00:00Z');
  return Array.from({ length: days }, (_, index) => new Date(last+(index-days+1)*86400000).toISOString().slice(0,10));
}

function filterId(value){const result=identityInteger(value);if(result==null)throw Object.assign(new Error('请选择有效的人员或部门筛选条件'),{statusCode:400});return result;}

function buildBaseQuery(scope, req, query) {
  const params = {};
  const filters = [];

  if (scope === 'me') {
    filters.push('actor_user_id = @currentUserId');
    params.currentUserId = req.session.userId;
    params.currentPersonId = identityInteger(req.identity?.personId ?? req.identity?.person_id ?? req.session.personId);
  } else if (scope === 'team') {
    filters.push('department_id = @currentDepartmentId');
    params.currentDepartmentId = req.identity?.current_department_id ?? req.identity?.department_id ?? req.session.departmentId ?? -1;
  }

  if (query.department_id) {
    filters.push('department_id = @departmentId');
    params.departmentId = filterId(query.department_id);
  }
  if (query.user_id) {
    if(/^person:/.test(query.user_id)){filters.push('actor_person_id = @personId');params.personId=filterId(query.user_id.slice(7));}
    else{filters.push('actor_user_id = @userId');params.userId=filterId(query.user_id);}
  }

  return { filters, params };
}

function filterRows(rows, filters, params) {
  return rows.filter(row => filters.every(filter => {
    // A legacy user ID never establishes a person link, even when numbers match.
    if (filter === 'actor_user_id = @currentUserId') return params.currentPersonId!=null
      ? row.actorIdentityKind==='person'&&same(row.actorPersonId,params.currentPersonId)
      : row.actorIdentityKind!=='person'&&same(row.actorUserId,params.currentUserId);
    if (filter === 'department_id = @currentDepartmentId') return same(row.departmentId,params.currentDepartmentId);
    if (filter === 'department_id = @departmentId') return same(row.departmentId,params.departmentId);
    if (filter === 'actor_user_id = @userId') return row.actorIdentityKind!=='person'&&same(row.actorUserId,params.userId);
    if (filter === 'actor_person_id = @personId') return row.actorIdentityKind==='person'&&same(row.actorPersonId,params.personId);
    return true;
  }));
}

function addSource(target, sourceType, count = 1) {
  target[sourceType] = (target[sourceType] || 0) + count;
}

function buildPayload({ scope, days, startDate, endDate, rows }) {
  const byDate = new Map(dateRange(days,endDate).map(date => [date, { date, count: 0, level: 0, sources: {}, sourceLabels: {} }]));
  const userMap = new Map();
  const departmentMap = new Map();

  rows.forEach(row => {
    const day = byDate.get(dateOnly(row.date));
    if (!day) return;
    day.count += 1;
    addSource(day.sources, row.sourceType);
    day.sourceLabels[row.sourceType] = row.sourceLabel;

    const person=row.actorIdentityKind==='person',userKey=person?'person:'+row.actorPersonId:row.actorUserId;
    if (userKey != null) {
      const user = userMap.get(userKey) || {
        userId: userKey,
        ...(person?{identityKind:'person',personId:row.actorPersonId}:{}),
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
      if(person&&row.actorName)user.name=row.actorName;
      userMap.set(userKey, user);
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
      if(person&&row.departmentName)department.name=row.departmentName;
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
    const repo = await auditRepository();
    const base = buildBaseQuery(scope, req, req.query);
    const quality=qualityActivity.qualityAuditActivity();
    const [legacyRows,qualityRows]=await Promise.all([repo.listActivityRows({startDate,endDate}),quality?quality.listActivityRows(req.session,{scope,startDate,endDate}):[]]);
    const rows = filterRows([...legacyRows,...qualityRows], base.filters, base.params);
    const payload=buildPayload({ scope, days, startDate, endDate, rows });
    if(scope==='me'&&base.params.currentPersonId!=null)payload.identityNotice='本人活动按明确的人员身份统计。未建立人员关联的旧账号活动保留在管理查询中，不计入本人活动。';
    return res.json(payload);
  } catch (error) {
    if(error.code?.startsWith('QUALITY_AUDIT_'))return res.status(error.statusCode||503).json({error:'人工质量审计活动暂不可用，请联系维护人员核对'});
    if(error.statusCode===400)return res.status(400).json({error:error.message});
    if (sendMysqlUnavailable(res, error)) return;
    logRequestFailure(res, error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.setAuditRepositoryFactory = setAuditRepositoryFactory;
router.resetAuditRepositoryFactory = resetAuditRepositoryFactory;
router.setQualityAuditActivityFactory=qualityActivity.setQualityAuditActivityFactory;
router.resetQualityAuditActivityFactory=qualityActivity.resetQualityAuditActivityFactory;

module.exports = router;
