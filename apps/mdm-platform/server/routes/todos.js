const { sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const { terminologyScope } = require('../terminologyAccess');
const { logRequestFailure } = require('../securityLog');
const router = express.Router();
const {
  requireAuth,
  getUserEffectivePermissionsAsync,
  getUserByIdAsync
} = require('../auth');
const {
  resetTodoRepositoryFactory,
  setTodoRepositoryFactory,
  todoRepository
} = require('../todoMysqlRepository');

function handleDbError(res, error) {
  if (String(error.code || '').startsWith('TODO_TERM_')) return res.status(error.statusCode || 400).json({ code: error.code, error: error.message });
  if (error.code === 'OFFICE_TASK_REQUIRES_WORKBENCH') return res.status(409).json({code:error.code,error:error.message});
  if (sendMysqlUnavailable(res, error)) return;
  const code = String(error && error.code || '');
  const message = String(error && error.message || '');
  if (code.startsWith('ER_') || message.includes('constraint')) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  logRequestFailure(res, error);
  return res.status(500).json({ error: '服务器错误' });
}

function runAction(res, action) {
  return action().catch(error => handleDbError(res, error));
}

async function permissionSet(userId) {
  const { permSet } = await getUserEffectivePermissionsAsync(userId);
  return permSet;
}

async function hasPermission(req, permissionCode) {
  if (!req.session || !req.session.userId) return false;
  const perms = await permissionSet(req.session.userId);
  return perms.has(permissionCode);
}

async function todoScope(req) {
  return {
    canViewAll: await hasPermission(req, 'governance:read-global'),
    canViewDepartment: await hasPermission(req, 'governance:read-department'),
    userId: req.session.userId,
    departmentId: req.session.departmentId || null
  };
}

async function canUseTodo(req, todo) {
  if (!todo) return false;
  const sameDepartment = Boolean(
    todo.to_dept_id &&
    req.session.departmentId &&
    Number(todo.to_dept_id) === Number(req.session.departmentId)
  );
  if (!sameDepartment) return false;
  const perms = await permissionSet(req.session.userId);
  // Account administrators remain read-only even with department business roles.
  if (perms.has('identity:manage-account')) return false;
  return [
    'governance:draft-department',
    'governance:submit-department',
    'governance:review-department'
  ].some(code => perms.has(code));
}

// Called again after the request lock, because permissions and department may
// change while a same-key request waits. This adds no role or scope exception.
async function currentTermActor(req) {
  const current = await getUserByIdAsync(req.session.userId);
  if (req.session.accountId && (!current || current.accountStatus !== 'active' || current.status !== 'active' ||
      Number(current.accountId) !== Number(req.session.accountId) || Number(current.authVersion) !== Number(req.session.authVersion))) {
    throw Object.assign(new Error('账号状态或授权已经变化，请重新登录'), {statusCode:401,code:'TODO_TERM_SESSION_CHANGED'});
  }
  const permissions = await permissionSet(req.session.userId);
  const departmentId = current?.current_department_id ?? current?.department_id ?? null;
  const currentRequest = { ...req, session:{ ...req.session, userId:req.session.userId, departmentId } };
  return {
    actor_user_id:req.session.userId,actor_person_id:req.session.personId || req.session.userId,
    actor_dept_id:departmentId,can_assign_work:permissions.has('governance:assign-work'),
    is_admin:permissions.has('identity:manage-account'),term_scope:await terminologyScope(currentRequest)
  };
}

router.get('/', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await todoRepository();
    const result = await repo.listTodos({
      dept_id: req.query.dept_id || null,
      status: req.query.status || null,
      type: req.query.type || null
    }, await todoScope(req));
    return res.json(result);
  });
});

router.post('/', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const permissions = await permissionSet(req.session.userId);
    if (!permissions.has('governance:assign-work') || permissions.has('identity:manage-account')) {
      return res.status(403).json({ error: '无任务分派权限' });
    }
    const repo = await todoRepository();
    const created = await repo.createTodo(req.body || {}, {
      actor_user_id: req.session.userId,
      actor_person_id: req.session.personId || req.session.userId,
      actor_dept_id: req.session.departmentId || null,
      can_assign_work: true,
      is_admin: false,
      resolve_current: () => currentTermActor(req),
      term_scope: req.body?.related_term_id != null ? await terminologyScope(req) : null
    });
    return res.json({ id: created.id });
  });
});

router.post('/:id/done', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await todoRepository();
    const todo = await repo.getTodo(req.params.id);
    if (!todo) return res.status(404).json({ error: '待办不存在' });
    if (!await canUseTodo(req, todo)) return res.status(403).json({ error: '无权处理该待办' });
    const updated = await repo.completeTodo(req.params.id, {
      actor_user_id: req.session.userId,
      actor_dept_id: req.session.departmentId || null
    });
    if (!updated) return res.status(404).json({ error: '待办不存在' });
    return res.json({ success: true });
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await todoRepository();
    const todo = await repo.getTodo(req.params.id);
    if (!todo) return res.status(404).json({ error: '待办不存在' });
    const permissions = await permissionSet(req.session.userId);
    if (!permissions.has('governance:structure-gate') || permissions.has('identity:manage-account')) {
      return res.status(403).json({ error: '无权删除该待办' });
    }
    const deleted = await repo.deleteTodo(req.params.id, {
      actor_user_id: req.session.userId,
      actor_dept_id: req.session.departmentId || null
    });
    if (!deleted) return res.status(404).json({ error: '待办不存在' });
    return res.json({ success: true });
  });
});

router.setTodoRepositoryFactory = setTodoRepositoryFactory;
router.resetTodoRepositoryFactory = resetTodoRepositoryFactory;

module.exports = router;
