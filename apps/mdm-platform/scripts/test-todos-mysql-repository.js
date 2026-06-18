const assert = require('assert');

const { makeTodoMysqlRepository } = require('../server/todoMysqlRepository');

async function main() {
  const pool = {
    state: {
      statements: [],
      nextId: 1,
      todos: []
    },
    async execute(sql, params = []) {
      this.state.statements.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.startsWith('CREATE TABLE')) return [[], undefined];

      if (normalizedSql.includes('INSERT INTO mdm_todos')) {
        const id = this.state.nextId++;
        this.state.todos.push({
          id,
          from_dept_id: params[0],
          to_dept_id: params[1],
          type: params[2],
          related_mapping_id: params[3],
          related_field_id: params[4],
          content: params[5],
          due_date: params[6],
          urgency: params[7],
          status: 'pending'
        });
        return [{ insertId: id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_todo_events')) {
        return [{ insertId: this.state.nextId++, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('FROM mdm_todos t') && normalizedSql.includes('WHERE t.id=?')) {
        return [[this.state.todos.find(todo => Number(todo.id) === Number(params[0]))].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM mdm_todos t')) {
        let todos = this.state.todos.slice();
        if (normalizedSql.includes('t.to_dept_id=?')) {
          const dept = Number(params.find(value => Number(value) === 10 || Number(value) === 9));
          todos = todos.filter(todo => Number(todo.to_dept_id) === dept);
        }
        if (normalizedSql.includes('t.status=?')) {
          const status = params.find(value => ['pending', 'done', 'closed'].includes(String(value)));
          todos = todos.filter(todo => todo.status === status);
        }
        if (normalizedSql.includes('t.type=?')) {
          const type = params.find(value => String(value) === 'field_confirm');
          todos = todos.filter(todo => todo.type === type);
        }
        return [todos.map(todo => ({ ...todo, from_dept_name: 'Sales', to_dept_name: 'Finance' })), undefined];
      }

      if (normalizedSql.startsWith("UPDATE mdm_todos SET status='done'")) {
        const todo = this.state.todos.find(row => Number(row.id) === Number(params[params.length - 1]));
        if (todo) {
          todo.status = 'done';
          todo.done_at = '2026-06-18 10:00:00';
        }
        return [{ affectedRows: todo ? 1 : 0 }, undefined];
      }

      if (normalizedSql.startsWith('DELETE FROM mdm_todos')) {
        const before = this.state.todos.length;
        this.state.todos = this.state.todos.filter(todo => Number(todo.id) !== Number(params[0]));
        return [{ affectedRows: before - this.state.todos.length }, undefined];
      }

      throw new Error(`Unhandled SQL in fake todo pool: ${normalizedSql}`);
    }
  };

  const repo = makeTodoMysqlRepository(pool);
  await repo.initSchema();

  const created = await repo.createTodo({
    from_dept_id: 9,
    to_dept_id: 10,
    type: 'field_confirm',
    related_mapping_id: 100,
    related_field_id: 101,
    content: 'Confirm golden source',
    due_date: '2026-06-20',
    urgency: 'high'
  }, { actor_user_id: 42, actor_dept_id: 9 });
  assert.ok(created.id);
  assert.strictEqual(created.status, 'pending');

  const list = await repo.listTodos({ dept_id: 10, status: 'pending', type: 'field_confirm' }, {
    canManageAll: true,
    roleCodes: new Set(['admin']),
    departmentId: 10
  });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].to_dept_name, 'Finance');

  assert.strictEqual((await repo.getTodo(created.id)).id, created.id);

  const completed = await repo.completeTodo(created.id, { actor_user_id: 42 });
  assert.strictEqual(completed.status, 'done');

  assert.strictEqual(await repo.deleteTodo(created.id, { actor_user_id: 42 }), true);
  assert.strictEqual((await repo.listTodos({}, { canManageAll: true })).length, 0);

  const sqlText = pool.state.statements.map(entry => entry.sql).join('\n');
  assert.ok(!/\bFROM\s+todos\b/i.test(sqlText), 'todo repository must not query SQLite todos');
  assert.ok(!/\bINTO\s+todos\b/i.test(sqlText), 'todo repository must not insert SQLite todos');
  assert.ok(!/\bUPDATE\s+todos\b/i.test(sqlText), 'todo repository must not update SQLite todos');
  assert.ok(!sqlText.includes('sqlite_master'), 'todo repository must not use SQLite catalog tables');
  assert.ok(!sqlText.includes('PRAGMA'), 'todo repository must not use SQLite PRAGMA');
  assert.ok(!sqlText.includes('lastInsertRowid'), 'todo repository must not use SQLite lastInsertRowid');

  console.log('Todos MySQL repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
