const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv } = require('./mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

let todoRepoPromise = null;
let todoRepositoryFactory = null;

async function rows(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return Array.isArray(result) ? result : [];
}

async function first(pool, sql, params = []) {
  const result = await rows(pool, sql, params);
  return result[0] || null;
}

function insertId(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.insertId || 0);
}

function affectedRows(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.affectedRows || 0);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function nullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function todoDomainSchemaStatements() {
  const allowed = [
    'schema_migrations',
    'departments',
    'mdm_todos',
    'mdm_todo_events'
  ];
  return splitSqlStatements(mdmMysqlSchemaSql()).filter(statement => {
    const normalized = statement.replace(/\s+/g, ' ');
    return allowed.some(table => normalized.includes(`CREATE TABLE IF NOT EXISTS ${table} `));
  });
}

function normalizeTodoPayload(payload = {}) {
  return {
    from_dept_id: payload.from_dept_id ? Number(payload.from_dept_id) : null,
    to_dept_id: payload.to_dept_id ? Number(payload.to_dept_id) : null,
    type: cleanText(payload.type) || 'general',
    related_mapping_id: payload.related_mapping_id ? Number(payload.related_mapping_id) : null,
    related_field_id: payload.related_field_id ? Number(payload.related_field_id) : null,
    content: nullableText(payload.content),
    due_date: nullableText(payload.due_date),
    urgency: cleanText(payload.urgency) || 'medium'
  };
}

function personIdFromActor(actor = {}) {
  return actor.actor_person_id || actor.actorPersonId || actor.person_id || actor.personId || actor.actor_user_id || null;
}

function publicTodo(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    from_dept_id: row.from_dept_id == null ? null : Number(row.from_dept_id),
    to_dept_id: row.to_dept_id == null ? null : Number(row.to_dept_id),
    related_mapping_id: row.related_mapping_id == null ? null : Number(row.related_mapping_id),
    related_field_id: row.related_field_id == null ? null : Number(row.related_field_id)
  };
}

function scopeClause(scope = {}) {
  if (scope.canViewAll) return { sql: '', params: [] };
  if (scope.canViewDepartment && scope.departmentId) {
    return { sql: ' AND t.to_dept_id=?', params: [scope.departmentId] };
  }
  return { sql: ' AND 1=0', params: [] };
}

function makeTodoMysqlRepository(pool) {
  async function insertEvent(todoId, eventType, actorUserId, note = null, actorPersonId = actorUserId) {
    await pool.execute(
      `INSERT INTO mdm_todo_events (todo_id, event_type, actor_user_id, actor_person_id, note)
       VALUES (?, ?, ?, ?, ?)`,
      [todoId, eventType, actorUserId || null, actorPersonId || null, note || null]
    );
  }

  return {
    async initSchema() {
      for (const statement of todoDomainSchemaStatements()) {
        await pool.execute(statement);
      }
    },

    async listTodos(filters = {}, scope = {}) {
      const params = [];
      const conditions = ['1=1'];
      const scoped = scopeClause(scope);
      if (scoped.sql) {
        conditions.push(scoped.sql.replace(/^ AND /, ''));
        params.push(...scoped.params);
      }
      if (filters.dept_id) {
        conditions.push('t.to_dept_id=?');
        params.push(Number(filters.dept_id));
      }
      if (filters.status) {
        conditions.push('t.status=?');
        params.push(filters.status);
      }
      if (filters.type) {
        conditions.push('t.type=?');
        params.push(filters.type);
      }

      return (await rows(
        pool,
        `SELECT t.*, fd.name AS from_dept_name, td.name AS to_dept_name
         FROM mdm_todos t
         LEFT JOIN departments fd ON fd.id = t.from_dept_id
         LEFT JOIN departments td ON td.id = t.to_dept_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY
           CASE t.urgency WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 2 END DESC,
           CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
           t.due_date ASC,
           t.created_at ASC`,
        params
      )).map(publicTodo);
    },

    async getTodo(todoId) {
      return publicTodo(await first(
        pool,
        `SELECT t.*, fd.name AS from_dept_name, td.name AS to_dept_name
         FROM mdm_todos t
         LEFT JOIN departments fd ON fd.id = t.from_dept_id
         LEFT JOIN departments td ON td.id = t.to_dept_id
         WHERE t.id=?
         LIMIT 1`,
        [todoId]
      ));
    },

    async createTodo(payload = {}, actor = {}) {
      const normalized = normalizeTodoPayload(payload);
      const actorPersonId = personIdFromActor(actor);
      const result = await pool.execute(
        `INSERT INTO mdm_todos
          (from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, due_date, urgency, created_by, created_by_person_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalized.from_dept_id,
          normalized.to_dept_id,
          normalized.type,
          normalized.related_mapping_id,
          normalized.related_field_id,
          normalized.content,
          normalized.due_date,
          normalized.urgency,
          actor.actor_user_id || null,
          actorPersonId
        ]
      );
      const todoId = insertId(result);
      await insertEvent(todoId, 'created', actor.actor_user_id || null, null, actorPersonId);
      return await this.getTodo(todoId);
    },

    async completeTodo(todoId, actor = {}) {
      const actorPersonId = personIdFromActor(actor);
      const result = await pool.execute(
        "UPDATE mdm_todos SET status='done', done_at=CURRENT_TIMESTAMP, completed_by=?, completed_by_person_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [actor.actor_user_id || null, actorPersonId, todoId]
      );
      if (affectedRows(result) === 0) return null;
      await insertEvent(todoId, 'done', actor.actor_user_id || null, null, actorPersonId);
      return await this.getTodo(todoId);
    },

    async deleteTodo(todoId, actor = {}) {
      const existing = await this.getTodo(todoId);
      if (!existing) return false;
      await insertEvent(todoId, 'deleted', actor.actor_user_id || null, null, personIdFromActor(actor));
      const result = await pool.execute('DELETE FROM mdm_todos WHERE id=?', [todoId]);
      return affectedRows(result) > 0;
    }
  };
}

async function todoRepository() {
  if (todoRepositoryFactory) return await todoRepositoryFactory();
  if (!todoRepoPromise) {
    todoRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeTodoMysqlRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await todoRepoPromise;
  } catch (error) {
    todoRepoPromise = null;
    throw error;
  }
}

function setTodoRepositoryFactory(factory) {
  todoRepositoryFactory = factory;
  todoRepoPromise = null;
}

function resetTodoRepositoryFactory() {
  todoRepositoryFactory = null;
  todoRepoPromise = null;
}

module.exports = {
  makeTodoMysqlRepository,
  todoRepository,
  setTodoRepositoryFactory,
  resetTodoRepositoryFactory
};
