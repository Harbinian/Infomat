const crypto = require('node:crypto');
const { makeTerminologyMysqlRepository } = require('./terminologyMysqlRepository');

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}
function sourceId(value) {
  const text = String(value ?? '');
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw fail(400, 'TODO_TERM_INVALID', '术语或部门编号无效，或超出现有术语接口的精确编号范围');
  }
  return text;
}

// Only explicitly linked terminology todos use this contract. Existing callers
// without a source keep the legacy payload. No source is inferred or backfilled.
async function createTermTodo(pool, payload, actor) {
  if (!actor.can_assign_work || actor.is_admin || !actor.term_scope) {
    throw fail(403, 'TODO_TERM_FORBIDDEN', '无权分派关联术语的待办');
  }
  const personId = sourceId(actor.actor_person_id || actor.actor_user_id);
  const termId = sourceId(payload.related_term_id);
  const departmentId = sourceId(payload.to_dept_id);
  const requestId = String(payload.request_id || '').toLowerCase();
  if (typeof payload.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    throw fail(400, 'TODO_TERM_INVALID', '请提供本次创建的有效请求编号');
  }
  const content = typeof payload.content === 'string' ? payload.content.trim() : '';
  const urgency = payload.urgency || 'medium';
  const due = payload.due_date || null;
  if (payload.type !== 'terminology' || payload.related_mapping_id != null || payload.related_field_id != null ||
      !content || content.length > 4000 || !['low', 'medium', 'high'].includes(urgency) ||
      (due !== null && (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due))) {
    throw fail(400, 'TODO_TERM_INVALID', '术语待办类型、内容、截止日期或关联字段不符合要求');
  }
  const normalized = { type: 'terminology', related_term_id: termId, to_dept_id: departmentId,
    from_dept_id: actor.actor_dept_id || null, content, due_date: due, urgency };
  const hash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  const key = `term_request:${requestId}`;
  const lockName = 'todo-term:' + crypto.createHash('sha256').update(`${personId}:${requestId}`).digest('hex').slice(0, 48);
  const db = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await db.execute('SELECT GET_LOCK(?,5) AS acquired', [lockName]);
    if (Number(lock.acquired) !== 1) throw fail(409, 'TODO_TERM_BUSY', '同一请求正在处理，请稍后核对结果');
    locked = true;
    await db.beginTransaction();
    const term = await makeTerminologyMysqlRepository(db).getTerm(termId, actor.term_scope, true);
    if (!term || String(term.id) !== termId) throw fail(404, 'TODO_TERM_UNAVAILABLE', '所选术语不存在或不在当前可读取范围内');
    const [[department]] = await db.execute("SELECT id FROM departments WHERE id=? AND status='active' AND (effective_from IS NULL OR effective_from<=CURRENT_DATE) AND (effective_to IS NULL OR effective_to>=CURRENT_DATE) FOR SHARE", [departmentId]);
    if (!department) throw fail(400, 'TODO_TERM_INVALID', '请选择当前有效的接收部门');
    // The version log survives todo deletion. It also prevents a retried request
    // from recreating a previously deleted todo. Keep metadata out of todo DTOs.
    const [[prior]] = await db.execute("SELECT entity_id,metadata_json FROM mdm_version_log WHERE entity_type='todo' AND operation='create' AND field_name=? AND operated_by_person_id=? ORDER BY id LIMIT 1", [key, personId]);
    if (prior) {
      const saved = typeof prior.metadata_json === 'string' ? JSON.parse(prior.metadata_json) : prior.metadata_json;
      if (saved?.payload_hash !== hash) throw fail(409, 'TODO_TERM_REQUEST_CONFLICT', '本次请求编号已用于不同内容，请先核对已有待办');
      const [[existing]] = await db.execute('SELECT id FROM mdm_todos WHERE id=? FOR SHARE', [prior.entity_id]);
      if (!existing) throw fail(409, 'TODO_TERM_REQUEST_DELETED', '该请求创建的待办已删除，不能重复创建');
      await db.commit();
      return { id: Number(existing.id) };
    }
    const [result] = await db.execute(`INSERT INTO mdm_todos
      (from_dept_id,to_dept_id,type,related_term_id,content,due_date,urgency,created_by,created_by_person_id)
      VALUES (?,?,'terminology',?,?,?,?,?,?)`,
    [normalized.from_dept_id, departmentId, termId, content, due, urgency, actor.actor_user_id || null, personId]);
    if (!Number.isSafeInteger(Number(result.insertId))) throw fail(409, 'TODO_TERM_INVALID', '待办编号超出现有接口范围，创建已撤销');
    await db.execute("INSERT INTO mdm_todo_events(todo_id,event_type,actor_user_id,actor_person_id,note) VALUES (?,'created',?,?,?)",
      [result.insertId, actor.actor_user_id || null, personId, JSON.stringify({ related_term_id: termId })]);
    await db.execute(`INSERT INTO mdm_version_log(entity_type,entity_id,field_name,operation,operated_by,operated_by_person_id,metadata_json)
      VALUES ('todo',?,?,'create',?,?,?)`, [result.insertId, key, actor.actor_user_id || null, personId,
      JSON.stringify({ schema_version: 'todo-term-source-v1', payload_hash: hash, todo: { id: String(result.insertId), ...normalized } })]);
    await db.commit();
    return { id: Number(result.insertId) };
  } catch (error) { await db.rollback(); throw error; }
  finally {
    if (locked) await db.execute('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    db.release();
  }
}

module.exports = { createTermTodo, sourceId };
