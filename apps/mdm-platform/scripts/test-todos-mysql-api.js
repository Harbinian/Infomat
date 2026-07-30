const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const todosRouter = require('../server/routes/todos');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function makeFakeTodoRepository() {
  const state = {
    calls: [],
    nextId: 300,
    todos: [
      {
        id: 200,
        from_dept_id: 9,
        to_dept_id: 10,
        from_dept_name: 'Sales',
        to_dept_name: 'Finance',
        type: 'field_confirm',
        content: 'Confirm customer field',
        urgency: 'high',
        status: 'pending'
      }
    ]
  };

  function findTodo(id) {
    return state.todos.find(todo => Number(todo.id) === Number(id));
  }

  return {
    state,
    async listTodos(filters, scope) {
      state.calls.push(['listTodos', filters, scope]);
      return state.todos
        .filter(todo => !filters.status || todo.status === filters.status)
        .filter(todo => !filters.type || todo.type === filters.type)
        .filter(todo => !filters.dept_id || Number(todo.to_dept_id) === Number(filters.dept_id));
    },
    async createTodo(payload, actor) {
      state.calls.push(['createTodo', payload, actor]);
      const todo = {
        id: state.nextId++,
        from_dept_id: payload.from_dept_id || null,
        to_dept_id: payload.to_dept_id || null,
        type: payload.type,
        content: payload.content,
        due_date: payload.due_date || null,
        urgency: payload.urgency || 'medium',
        status: 'pending'
      };
      state.todos.push(todo);
      return todo;
    },
    async getTodo(id) {
      state.calls.push(['getTodo', Number(id)]);
      return findTodo(id) || null;
    },
    async completeTodo(id, actor) {
      state.calls.push(['completeTodo', Number(id), actor]);
      const todo = findTodo(id);
      if (!todo) return null;
      todo.status = 'done';
      todo.done_at = '2026-06-18 10:00:00';
      return todo;
    },
    async deleteTodo(id, actor) {
      state.calls.push(['deleteTodo', Number(id), actor]);
      const before = state.todos.length;
      state.todos = state.todos.filter(todo => Number(todo.id) !== Number(id));
      return state.todos.length !== before;
    }
  };
}

async function main() {
  assert.strictEqual(
    typeof todosRouter.setTodoRepositoryFactory,
    'function',
    'todos route should allow MySQL todo repository injection'
  );

  const repo = makeFakeTodoRepository();
  todosRouter.setTodoRepositoryFactory(async () => repo);
  let effectivePermissions = new Set([
    'governance:read-global',
    'governance:assign-work',
    'governance:structure-gate'
  ]);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      return { permSet: effectivePermissions, fieldConstraints: {} };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: 42,
      userId: 42,
      userName: '治理人员',
      departmentId: 10
    };
    next();
  });
  app.use('/api/todos', todosRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    let res = await fetch(`${baseUrl}/api/todos?dept_id=10&status=pending&type=field_confirm`);
    let body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].to_dept_name, 'Finance');

    res = await fetch(`${baseUrl}/api/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_dept_id: 9,
        to_dept_id: 10,
        type: 'field_confirm',
        related_mapping_id: 100,
        related_field_id: 101,
        content: 'Confirm golden source',
        due_date: '2026-06-20',
        urgency: 'high'
      })
    });
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.ok(body.id);

    effectivePermissions = new Set([
      'governance:read-department',
      'governance:draft-department'
    ]);
    res = await fetch(`${baseUrl}/api/todos/${body.id}/done`, { method: 'POST' });
    let doneBody = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(doneBody));
    assert.strictEqual(doneBody.success, true);

    effectivePermissions = new Set([
      'governance:read-global',
      'governance:assign-work',
      'governance:structure-gate'
    ]);
    res = await fetch(`${baseUrl}/api/todos/${body.id}`, { method: 'DELETE' });
    const deleteBody = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(deleteBody));
    assert.strictEqual(deleteBody.success, true);

    const callNames = repo.state.calls.map(call => call[0]);
    for (const expected of ['listTodos', 'createTodo', 'getTodo', 'completeTodo', 'deleteTodo']) {
      assert.ok(callNames.includes(expected), `todos route should call repository method ${expected}`);
    }

    console.log('Todos MySQL API test passed');
  } finally {
    await closeServer(server);
    todosRouter.resetTodoRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
});
