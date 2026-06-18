const express = require('express');
const router = express.Router();
const {
  requireAuth,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync
} = require('../auth');
const {
  resetTodoRepositoryFactory,
  setTodoRepositoryFactory,
  todoRepository
} = require('../todoMysqlRepository');

function handleDbError(res, error) {
  const code = String(error && error.code || '');
  const message = String(error && error.message || '');
  if (code.startsWith('ER_') || message.includes('constraint')) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runAction(res, action) {
  return action().catch(error => handleDbError(res, error));
}

async function permissionSet(userId) {
  const { permSet } = await getUserEffectivePermissionsAsync(userId);
  return permSet;
}

async function isAdminRequest(req) {
  if (!req.session || !req.session.userId) return false;
  const perms = await permissionSet(req.session.userId);
  return perms.has('admin:access') || perms.has('*:*');
}

async function roleCodeSet(req) {
  const codes = new Set();
  if (req.session && req.session.userRole) codes.add(req.session.userRole);
  const roles = await getUserRoleCodesAsync(req.session.userId, req.session.userRole);
  for (const role of roles) {
    const code = role.code || role.role_code;
    if (code) codes.add(code);
  }
  return codes;
}

async function todoScope(req) {
  return {
    canManageAll: await isAdminRequest(req),
    roleCodes: await roleCodeSet(req),
    userId: req.session.userId,
    departmentId: req.session.departmentId || null
  };
}

async function canUseTodo(req, todo) {
  if (!todo) return false;
  if (await isAdminRequest(req)) return true;
  return Boolean(todo.to_dept_id && req.session.departmentId && Number(todo.to_dept_id) === Number(req.session.departmentId));
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
    if (!await isAdminRequest(req)) {
      return res.status(403).json({ error: '仅管理员可创建待办' });
    }
    const repo = await todoRepository();
    const created = await repo.createTodo(req.body || {}, {
      actor_user_id: req.session.userId,
      actor_dept_id: req.session.departmentId || null
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
    if (!await canUseTodo(req, todo)) return res.status(403).json({ error: '无权删除该待办' });
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
