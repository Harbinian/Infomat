// Extends the legacy field identity routes using existing audit tables. No runtime DDL.
const { isDeepStrictEqual } = require('node:util');
const TYPE = 'data_map_field_identity';
const columns = ['id', 'field_id', 'authoritative_system_name', 'authoritative_system_code', 'maintain_dept_id', 'owner_user_id', 'owner_person_id', 'confidence_level', 'confirmed', 'confirmed_by', 'confirmed_by_person_id', 'confirmed_at', 'note', 'status'];
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const serial = value => JSON.parse(JSON.stringify(value));
function nullableId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw fail(400, '编号必须是有效的正整数');
  return Number(value);
}
async function first(db, sql, params) { return (await db.execute(sql, params))[0][0] || null; }
function makeFieldIdentityGovernance(pool) {
  const legacy = db => require('./dataMapMysqlRepository').makeDataMapMysqlRepository(db);
  async function mutate(fieldId, payload, actor, action) {
    if (!nullableId(actor.personId) || !['maintain', 'confirm'].includes(action)) throw fail(403, '缺少有效操作身份');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const field = await first(conn, 'SELECT id,context_id FROM data_map_fields WHERE id=? FOR UPDATE', [fieldId]);
      if (!field) throw fail(404, '字段不存在');
      const context = await first(conn, 'SELECT id,dept_id FROM data_map_contexts WHERE id=? FOR UPDATE', [field.context_id]);
      if (!context || Number(context.id) !== Number(actor.contextId) || Number(context.dept_id) !== Number(actor.departmentId)) throw fail(409, '字段所属范围已变化，请刷新核对');
      const repo = legacy(conn);
      const before = await repo.getFieldIdentity(fieldId);
      if (payload.expected_identity !== undefined && !isDeepStrictEqual(serial(before || {}), payload.expected_identity)) throw fail(409, '字段身份已变化，输入已保留，请刷新核对');
      if (action === 'maintain') {
        if (before?.owner_user_id && !before.owner_person_id) throw fail(409, '历史负责人尚未关联人员，请先明确人员映射后再维护');
        if (payload.confirmed || String(payload.status || '').trim() === 'confirmed') throw fail(403, '维护信息不能同时确认黄金源');
        for (const [key, limit] of [['authoritative_system', 255], ['authoritative_system_name', 255], ['authoritative_system_code', 128], ['note', 10000]]) {
          if (payload[key] != null && (typeof payload[key] !== 'string' || payload[key].length > limit)) throw fail(400, '字段身份文本格式或长度不符合要求');
        }
        const department = nullableId(payload.maintain_dept_id === undefined ? before?.maintain_dept_id : payload.maintain_dept_id);
        const person = nullableId(payload.owner_person_id === undefined ? before?.owner_person_id : payload.owner_person_id);
        const oldUser = nullableId(before?.owner_user_id);
        if (payload.owner_user_id !== undefined && nullableId(payload.owner_user_id) !== oldUser) throw fail(400, '历史用户编号只读，不能用它指定负责人');
        const ownershipChanged = department !== nullableId(before?.maintain_dept_id) || person !== nullableId(before?.owner_person_id);
        // Existing unresolved/retired references remain readable and are preserved unless explicitly edited.
        if (ownershipChanged) {
          if (department !== null && department !== Number(context.dept_id)) throw fail(400, '维护部门仅限字段所属部门');
          if (person !== null && department === null) throw fail(400, '指定负责人前请选择维护部门');
          if (department !== null) {
            const active = await first(conn, "SELECT id FROM departments WHERE id=? AND status='active' AND (effective_from IS NULL OR effective_from<=CURRENT_DATE) AND (effective_to IS NULL OR effective_to>=CURRENT_DATE) FOR SHARE", [department]);
            if (!active) throw fail(400, '维护部门当前无效');
          }
          if (person !== null) {
            const active = await first(conn, "SELECT person_id FROM person WHERE person_id=? AND current_department_id=? AND status='active' AND employment_status='active' FOR SHARE", [person, context.dept_id]);
            if (!active) throw fail(400, '负责人必须是字段所属部门的有效人员');
          }
        }
        if (oldUser && person === null) throw fail(409, '此记录含历史用户编号，清空人员需先完成明确的兼容处理');
        await repo.upsertFieldIdentity(fieldId, { ...payload, maintain_dept_id: department, owner_person_id: person, owner_user_id: oldUser, confirmed: false, status: 'needs_review' });
      } else {
        if (!before) throw fail(404, '字段身份不存在');
        if (before.confirmed) throw fail(409, '该记录已确认，请刷新核对，不能重复确认');
        for (const [key, original] of [['authoritative_system', before.authoritative_system], ['authoritative_system_name', before.authoritative_system_name], ['authoritative_system_code', before.authoritative_system_code]]) {
          if (payload[key] !== undefined && String(payload[key] || '').trim() !== String(original || '').trim()) throw fail(409, '确认内容与已保存记录不一致，请先维护并重新核对');
        }
        await repo.confirmFieldIdentity(fieldId, { authoritative_system: before.authoritative_system, authoritative_system_code: before.authoritative_system_code }, actor.personId);
      }
      const after = await repo.getFieldIdentity(fieldId);
      const [header] = await conn.execute('INSERT INTO data_map_change_sets(entity_type,entity_id,operated_by,operated_by_person_id,description) VALUES(?,?,?,?,?)', [TYPE, fieldId, actor.personId, actor.personId, action === 'maintain' ? '维护字段身份信息' : '部门确认字段身份']);
      for (const name of columns) {
        const oldValue = before?.[name] ?? null, newValue = after?.[name] ?? null;
        await conn.execute('INSERT INTO data_map_version_log(entity_type,entity_id,field_name,old_value,new_value,operation,operated_by,operated_by_person_id,change_set_id) VALUES(?,?,?,?,?,?,?,?,?)', [TYPE, fieldId, name, JSON.stringify(oldValue), JSON.stringify(newValue), before ? 'update' : 'create', actor.personId, actor.personId, header.insertId]);
      }
      await conn.commit();
      return after;
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  }
  return {
    mutate,
    async options(context) {
      const department = await first(pool, "SELECT id,name FROM departments WHERE id=? AND status='active' AND (effective_from IS NULL OR effective_from<=CURRENT_DATE) AND (effective_to IS NULL OR effective_to>=CURRENT_DATE)", [context.dept_id]);
      const people = department ? (await pool.execute("SELECT person_id,person_name FROM person WHERE current_department_id=? AND status='active' AND employment_status='active' ORDER BY person_id", [context.dept_id]))[0] : [];
      return { department, people };
    },
    async history(fieldId, beforeId) {
      const cursor = beforeId === undefined ? null : String(beforeId);
      if (cursor !== null && (!/^[1-9]\d{0,18}$/.test(cursor) || BigInt(cursor) > 9223372036854775807n)) throw fail(400, '历史记录游标无效');
      const [headers] = await pool.execute('SELECT CAST(id AS CHAR) AS id,CAST(operated_by_person_id AS CHAR) AS operated_by_person_id,operated_at,description FROM data_map_change_sets WHERE entity_type=? AND entity_id=? AND (? IS NULL OR id<?) ORDER BY data_map_change_sets.id DESC LIMIT 21', [TYPE, fieldId, cursor, cursor]);
      const items = headers.slice(0, 20);
      for (const item of items) {
        item.changes = (await pool.execute('SELECT field_name,old_value,new_value FROM data_map_version_log WHERE entity_type=? AND entity_id=? AND change_set_id=? ORDER BY id', [TYPE, fieldId, item.id]))[0];
      }
      return { field_id: Number(fieldId), items, next_cursor: headers.length > 20 ? String(items[19].id) : null, history_coverage: 'recorded_operations_only', legacy_history_available: false };
    }
  };
}
module.exports = { makeFieldIdentityGovernance };
