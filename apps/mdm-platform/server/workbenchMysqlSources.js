const { todoRepository } = require('./todoMysqlRepository');
const { conflictRepository } = require('./conflictMysqlRepository');

// Reuse the same repositories and visibility rules as /todos and /conflicts.
async function listPendingTodos(session, permissions) {
  const repo = await todoRepository();
  return repo.listTodos({ status: 'pending', includeFieldContext: true }, {
    canViewAll: permissions.has('governance:read-global'),
    canViewDepartment: permissions.has('governance:read-department'),
    userId: session.personId || session.userId,
    departmentId: session.departmentId || null
  });
}

async function listEscalatedConflicts(canDecideEscalated) {
  if (!canDecideEscalated) return [];
  const repo = await conflictRepository();
  return repo.listConflicts({ status: 'escalated' }, { mode: 'escalated', canViewAll: false });
}

module.exports = { listPendingTodos, listEscalatedConflicts };
