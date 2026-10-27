const crypto = require('node:crypto');
const { sessionSubject, identityInteger, sameIdentityInteger } = require('./sessionSubject');
const { readPersonAuthority } = require('./identityMysqlRepository');
const { failure, normalizePublication } = require('./publicationSpreadsheet');
const { officePublicationState, exactColumns, splitIdentityRows, identityParam, planOffice, planMembership, applyOffices, applyMemberships } = require('./officePublication');

const keyOf = value => String(value || '').trim().toLowerCase();
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const DIRECTORY_SOURCE_HASH_VERSION = 'directory-publication-source-v2';
const metadataColumns = 'CAST(id AS CHAR) id,publication_ref,kind,dataset_key,title,version_no,CAST(previous_publication_id AS CHAR) previous_publication_id,source_file_name,content_hash,row_count,CAST(published_by_person_id AS CHAR) AS published_by_person_id,UNIX_TIMESTAMP(published_at) AS published_epoch';

// Only the short-lived import check uses this exact projection. Published
// payloads, content hashes and the legacy snapshot projection remain unchanged.
function directorySourceHash(kind, source) {
  const identities = new Set(['id','parent_id','person_id','current_department_id','org_unit_id','department_id','manager_person_id','office_id','todo_id','assignee_person_id','scope_department_id']);
  const exact = value => Array.isArray(value) ? value.map(exact) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([field,item]) => [field, identities.has(field) ? identityParam(item) : exact(item)])) : value;
  return hash({ sourceHashVersion:DIRECTORY_SOURCE_HASH_VERSION, kind, source:exact(source) });
}

function publicRow(row) {
  if (!row) return null;
  const result = { ...row,id:identityInteger(row.id),previous_publication_id:identityInteger(row.previous_publication_id),published_by_person_id: identityInteger(row.published_by_person_id), published_at: new Date(Number(row.published_epoch) * 1000).toISOString(),...(row.kind==='master_data'?require('./dataMapHandoffCompatibility').independentAsset('spreadsheet_publication',row.id,{versionRef:row.publication_ref,historyCompleteness:'fixed_published_payload'}):{}) };
  delete result.published_epoch;
  return result;
}

// Direct-maintenance history uses only names captured by that event. Current
// directory joins would silently replace historical names after a later change.
function directoryHistorySummary(value) {
  let metadata;
  try { metadata = typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const identity = record => record && typeof record === 'object' && !Array.isArray(record)
    ? Object.fromEntries(['employee_no','person_name','code','name'].filter(key => typeof record[key] === 'string').map(key => [key,record[key]])) : null;
  return { entity: ['person','department','office'].includes(metadata.entity) ? metadata.entity : null,
    operation: ['create','update'].includes(metadata.operation) ? metadata.operation : null,
    before: identity(metadata.before), after: identity(metadata.after),
    reason: typeof metadata.reason === 'string' ? metadata.reason : null };
}

function datasetKey(kind, proposed) {
  if (kind !== 'master_data') return kind;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(proposed || ''))) throw failure('数据集标识无效');
  return proposed;
}

function conflict(message) { const e = failure(message, 'PUBLICATION_SOURCE_CHANGED'); e.statusCode = 409; return e; }

function publicationWritePermission(kind) {
  return kind === 'master_data' ? 'governance:publish' : 'directory:maintain';
}

function directoryChangeReason(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000) {
    throw failure('请填写不超过2000个字符的变更原因', 'DIRECTORY_REASON_REQUIRED');
  }
  return value.trim();
}

async function directoryPlan(db, normalized, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [departmentRows] = await db.query('SELECT id,code,name,parent_id,department_type,status,CAST(final_responsible_person_id AS CHAR) AS directory_final_responsible_person_id,CAST(data_owner_person_id AS CHAR) AS directory_data_owner_person_id,' + exactColumns(['id','parent_id']) + ' FROM departments ORDER BY id' + suffix);
  const [personRows] = await db.query('SELECT person_id,employee_no,person_name,current_department_id,employment_status,status,mobile,email,' + exactColumns(['person_id','current_department_id']) + ' FROM person ORDER BY person_id' + suffix);
  const departmentState = splitIdentityRows(departmentRows, ['id','parent_id']);
  const responsibilities = departmentState.identities.map(row => ({departmentId:row.id,finalResponsiblePersonId:identityInteger(row.directory_final_responsible_person_id),dataOwnerPersonId:identityInteger(row.directory_data_owner_person_id)}));
  // Qualification references use the same locked read, but do not rewrite the
  // established legacy directory snapshot/hash projection or published payloads.
  for (const row of [...departmentState.snapshot,...departmentState.identities]) {
    delete row.directory_final_responsible_person_id; delete row.directory_data_owner_person_id;
  }
  const personState = splitIdentityRows(personRows, ['person_id','current_department_id']);
  const departments = departmentState.identities, persons = personState.identities;
  const byCode = new Map(departments.map(row => [keyOf(row.code), row]));
  const byId = new Map(departments.map(row => [String(row.id), row]));
  const people = new Map(persons.map(row => [keyOf(row.employee_no), row]));
  const errors = [];
  const changes = [];
  const reviewChanges = [];
  const summary = { added: 0, updated: 0, unchanged: 0, removed: 0 };
  const fields = normalized.content.mapping;
  const officeState = await officePublicationState(db, lock), offices = officeState.identities;
  // The exact comparison view is never serialized into the legacy source hash.
  const snapshot = {departments:departmentState.snapshot,persons:personState.snapshot};
  if (normalized.content.kind === 'organization') {
    const incoming = new Map(normalized.records.filter(row => row.unit_type === 'department').map(row => [keyOf(row.code), row]));
    const parentCodes = new Map(departments.map(row => [keyOf(row.code), keyOf(byId.get(String(row.parent_id))?.code)]));
    for (const [index, record] of normalized.records.entries()) {
      if (record.unit_type === 'office') {
        const result = planOffice(record, fields, offices, departments, persons, normalized.records, normalized.content.sourceRows[index]);
        errors.push(...result.errors); changes.push(result.change); reviewChanges.push(result.review);
        summary[result.review.action] += 1;
        continue;
      }
      const existing = byCode.get(keyOf(record.code));
      if (offices.offices.some(o => o.org_type === 'office' && keyOf(o.org_unit_code) === keyOf(record.code))) errors.push({row:normalized.content.sourceRows[index],message:'该组织编码已被办公室使用，不能转换为部门'});
      const desired = { ...record, status: record.status || existing?.status || 'active', department_type: fields.department_type ? record.department_type : existing?.department_type || null };
      const parentCode = fields.parent_code ? keyOf(record.parent_code) : keyOf(byId.get(String(existing?.parent_id))?.code);
      parentCodes.set(keyOf(record.code), parentCode);
      if (parentCode && !byCode.has(parentCode) && !incoming.has(parentCode)) errors.push({ row: normalized.content.sourceRows[index], message: '上级部门编码不存在' });
      if (parentCode && desired.status === 'active' && (incoming.get(parentCode)?.status || byCode.get(parentCode)?.status || 'active') !== 'active') errors.push({row:normalized.content.sourceRows[index],message:'启用部门的上级部门必须处于启用状态'});
      if (desired.status !== 'active' && existing && departments.some(child => {
        const next = incoming.get(keyOf(child.code));
        const nextStatus = next?.status || child.status;
        const nextParent = next && fields.parent_code ? keyOf(next.parent_code) : keyOf(byId.get(String(child.parent_id))?.code);
        return nextStatus === 'active' && nextParent === keyOf(existing.code);
      })) errors.push({row:normalized.content.sourceRows[index],message:'部门仍有启用的下级部门，请先调整下级部门'});
      if (desired.status !== 'active' && existing && persons.some(person => sameIdentityInteger(person.current_department_id, existing.id) && person.status === 'active' && person.employment_status === 'active')) errors.push({ row: normalized.content.sourceRows[index], message: '部门仍有在职人员，请先调整人员归属后再停用或归档' });
      if (desired.status !== 'active' && existing && offices.offices.some(o => sameIdentityInteger(o.department_id, existing.id) && o.org_type === 'office' && o.status === 'active')) errors.push({row:normalized.content.sourceRows[index],message:'部门仍有启用的办公室，请先调整办公室后再停用或归档'});
      const same = existing && existing.name === desired.name && String(existing.department_type || '') === String(desired.department_type || '') && existing.status === desired.status && keyOf(byId.get(String(existing.parent_id))?.code) === parentCode;
      summary[!existing ? 'added' : same ? 'unchanged' : 'updated'] += 1;
      changes.push({ existing, desired, parentCode, same });
      const before=existing?{name:existing.name,department_type:existing.department_type,status:existing.status,parent_code:byId.get(String(existing.parent_id))?.code||''}:{};
      const after={name:desired.name,department_type:desired.department_type,status:desired.status,parent_code:record.parent_code===undefined?before.parent_code||'':record.parent_code};
      reviewChanges.push({row:normalized.content.sourceRows[index],key:record.code,action:!existing?'added':same?'unchanged':'updated',fields:Object.keys(after).filter(field=>String(before[field]??'')!==String(after[field]??'')).map(field=>({field,before:before[field]??'',after:after[field]??''}))});
    }
    for (const [code] of incoming) {
      const visited = new Set(); let cursor = code;
      while (cursor) {
        if (visited.has(cursor)) { errors.push({ row: null, message: `部门编码${code}的上级关系形成循环` }); break; }
        visited.add(cursor); cursor = parentCodes.get(cursor) || '';
      }
    }
  } else {
    const [accountRows] = await db.query('SELECT person_id,account_status,' + exactColumns(['person_id']) + ' FROM user_accounts ORDER BY person_id' + suffix);
    const [assignmentRows] = await db.query("SELECT person_id,scope_department_id," + exactColumns(['person_id','scope_department_id']) + " FROM person_roles WHERE assignment_status='active' AND scope_type='department' ORDER BY person_id,role_id" + suffix);
    // publish's request-id read can establish an earlier RR snapshot. Keep this
    // target qualification current and locked on the same transaction connection.
    const [adminRows] = await db.query("SELECT DISTINCT pr.person_id," + exactColumns(['person_id'],'pr.') + " FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id WHERE pr.assignment_status='active' AND r.role_code='admin' AND r.status='active'" + (lock ? ' FOR SHARE' : ''));
    const accountState = splitIdentityRows(accountRows, ['person_id']), assignmentState = splitIdentityRows(assignmentRows, ['person_id','scope_department_id']), adminState = splitIdentityRows(adminRows, ['person_id']);
    const accounts = accountState.identities, assignments = assignmentState.identities;
    const adminIds = new Set(adminState.identities.map(row => String(row.person_id)));
    for (const [index, record] of normalized.records.entries()) {
      const existing = people.get(keyOf(record.employee_no));
      const matches = record.department_code ? departments.filter(row => keyOf(row.code) === keyOf(record.department_code)) : departments.filter(row => row.name === record.department_name);
      const department = matches.length === 1 ? matches[0] : null;
      if (!department || department.status !== 'active') errors.push({ row: normalized.content.sourceRows[index], message: '部门不存在、未启用或名称不唯一，请先发布组织架构或使用明确的部门编码' });
      if (department && record.department_name && record.department_name !== department.name) errors.push({ row: normalized.content.sourceRows[index], message: '部门编码与部门名称不一致' });
      const desired = { employee_no: record.employee_no, person_name: record.person_name, current_department_id: department?.id || null, employment_status: record.employment_status || existing?.employment_status || 'active', mobile: fields.mobile ? record.mobile || null : existing?.mobile || null, email: fields.email ? record.email || null : existing?.email || null };
      const membership = planMembership(record, fields, existing, offices, departments, normalized.content.sourceRows[index]);
      errors.push(...membership.errors);
      const same = existing && !membership.membershipChanged && ['person_name', 'current_department_id', 'employment_status', 'mobile', 'email'].every(field => String(existing[field] || '') === String(desired[field] || ''));
      if (existing && adminIds.has(String(existing.person_id)) && (!sameIdentityInteger(existing.current_department_id,desired.current_department_id) || existing.employment_status !== desired.employment_status || membership.membershipChanged)) errors.push({row:normalized.content.sourceRows[index],message:'此人员仍有系统管理员身份，请先调整管理员身份再变更部门、在职状态或办公室归属；姓名和联系方式可由目录维护人员更正'});
      if (existing && !sameIdentityInteger(existing.current_department_id, desired.current_department_id) && assignments.some(row => sameIdentityInteger(row.person_id, existing.person_id))) errors.push({ row: normalized.content.sourceRows[index], message: '此人员还有部门范围的有效角色，请先撤销原部门授权，再调整部门' });
      if (existing && desired.employment_status !== 'active' && accounts.some(row => sameIdentityInteger(row.person_id, existing.person_id) && row.account_status === 'active')) errors.push({ row: normalized.content.sourceRows[index], message: '离职或停职人员仍有有效账号，请先停用账号' });
      if (existing && (desired.employment_status !== 'active' || !sameIdentityInteger(existing.current_department_id,desired.current_department_id)) && responsibilities.some(row => sameIdentityInteger(row.finalResponsiblePersonId,existing.person_id) || sameIdentityInteger(row.dataOwnerPersonId,existing.person_id))) errors.push({row:normalized.content.sourceRows[index],message:'此人员仍有部门负责人或数据负责人职责，请先办理职责调整'});
      summary[!existing ? 'added' : same ? 'unchanged' : 'updated'] += 1;
      changes.push({ existing, desired, same, officeIds:membership.officeIds, membershipChanged:membership.membershipChanged });
      reviewChanges.push({row:normalized.content.sourceRows[index],key:record.employee_no,action:!existing?'added':same?'unchanged':'updated',fields:['person_name','current_department_id','employment_status','mobile','email'].filter(field=>String(existing?.[field]??'')!==String(desired[field]??'')).map(field=>({field:field==='current_department_id'?'department_name':field,before:field==='current_department_id'?byId.get(String(existing?.[field]))?.name||'':existing?.[field]??'',after:field==='current_department_id'?department?.name||'未匹配':desired[field]??''}))});
      if (membership.review) reviewChanges[reviewChanges.length-1].fields.push(membership.review);
    }
    return { summary, errors, changes, reviewChanges, baseHash: hash({ ...snapshot, accounts:accountState.snapshot, assignments:assignmentState.snapshot, admins:adminState.snapshot, offices:officeState.snapshot }), sourceHashVersion:DIRECTORY_SOURCE_HASH_VERSION,
      sourceHash:directorySourceHash(normalized.content.kind,{departments,persons,accounts:accountState.identities,assignments:assignmentState.identities,admins:adminState.identities,offices:officeState.identities}) };
  }
  return { summary, errors, changes, reviewChanges, baseHash: hash({ ...snapshot, offices:officeState.snapshot }), sourceHashVersion:DIRECTORY_SOURCE_HASH_VERSION,
    sourceHash:directorySourceHash(normalized.content.kind,{departments,persons,offices:officeState.identities}) };
}

async function applyDirectory(db, kind, changes, actorId) {
  if (kind === 'organization') {
    const departmentChanges = changes.filter(change => change.entity !== 'office');
    for (const change of departmentChanges) {
      if (change.same) continue;
      const row = change.desired;
      if (change.existing) await db.execute('UPDATE departments SET name=?,department_type=?,status=? WHERE id=?', [row.name, row.department_type, row.status, identityParam(change.existing.id)]);
      else await db.execute("INSERT INTO departments (code,name,department_type,status,source_system) VALUES (?,?,?,?,'MANUAL_PUBLICATION')", [row.code, row.name, row.department_type, row.status]);
    }
    const [departments] = await db.query('SELECT CAST(id AS CHAR) AS id,code FROM departments');
    const byCode = new Map(departments.map(row => [keyOf(row.code), row.id]));
    for (const change of departmentChanges) if (!change.same) await db.execute('UPDATE departments SET parent_id=? WHERE id=?', [change.parentCode ? identityParam(byCode.get(change.parentCode)) : null, identityParam(byCode.get(keyOf(change.desired.code)))]);
    const [hierarchy] = await db.query('SELECT CAST(id AS CHAR) AS id,CAST(parent_id AS CHAR) AS parent_id,path FROM departments');
    const byId = new Map(hierarchy.map(row => [String(row.id), row]));
    for (const row of hierarchy) {
      const ids = [], visited = new Set(); let cursor = row;
      while (cursor) {
        if (visited.has(String(cursor.id))) throw failure('组织层级存在循环，请先修正');
        visited.add(String(cursor.id)); ids.unshift(cursor.id); cursor = byId.get(String(cursor.parent_id));
      }
      const path = '/' + ids.join('/') + '/';
      if (path.length > 1024) throw failure('组织层级过深，无法保存');
      if (row.path !== path) await db.execute('UPDATE departments SET path=? WHERE id=?', [path, identityParam(row.id)]);
    }
    await applyOffices(db, changes, actorId);
  } else {
    for (const change of changes) {
      if (change.same) continue;
      const row = change.desired;
      if (change.existing) await db.execute('UPDATE person SET person_name=?,current_department_id=?,employment_status=?,mobile=?,email=? WHERE person_id=?', [row.person_name, identityParam(row.current_department_id), row.employment_status, row.mobile, row.email, identityParam(change.existing.person_id)]);
      else await db.execute("INSERT INTO person (employee_no,person_name,current_department_id,employment_status,mobile,email,status) VALUES (?,?,?,?,?,?,'active')", [row.employee_no, row.person_name, identityParam(row.current_department_id), row.employment_status, row.mobile, row.email]);
    }
    await applyMemberships(db, changes, actorId);
  }
}

function makePublicationRepository(pool) {
  async function latest(db, kind, key, lock = false) {
    const [rows] = await db.execute(`SELECT ${metadataColumns},payload_json FROM mdm_publications WHERE kind=? AND dataset_key=? ORDER BY version_no DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [kind, key]);
    return rows[0] || null;
  }
  async function plan(db, normalized, key, lock = false) {
    const previous = await latest(db, normalized.content.kind, key, lock);
    if (normalized.content.kind !== 'master_data') return { previous, ...await directoryPlan(db, normalized, lock) };
    const current = previous ? JSON.parse(previous.payload_json) : null;
    if (current && current.keyHeader !== normalized.content.keyHeader) throw failure('同一数据集的唯一标识列不能改变；需要其他标识时请建立新数据集');
    const keys = content => new Map(content.rows.map(row => [keyOf(row[content.headers.indexOf(content.keyHeader)]), JSON.stringify(content.headers.map((header, i) => [header, row[i]]).sort(([a], [b]) => a.localeCompare(b)))]));
    const before = current ? keys(current) : new Map(); const after = keys(normalized.content);
    const summary = { added: 0, updated: 0, unchanged: 0, removed: [...before.keys()].filter(key => !after.has(key)).length };
    for (const [key, value] of after) summary[!before.has(key) ? 'added' : before.get(key) === value ? 'unchanged' : 'updated'] += 1;
    return { previous, summary, errors: [], baseHash: previous?.content_hash || hash(null) };
  }
  return {
    async status() {
      const [rows] = await pool.query("SELECT COUNT(*) AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mdm_publications'");
      return { ready: Number(rows[0].present) === 1 };
    },
    async list(kind, { includeDirectoryHistory = false } = {}) {
      const [rows] = await pool.execute(`SELECT ${metadataColumns} FROM mdm_publications WHERE kind=? ORDER BY id DESC LIMIT 200`, [kind]);
      const result = rows.map(publicRow);
      const direct = includeDirectoryHistory && kind !== 'master_data' ? result.filter(row => row.source_file_name === 'directory-change.json') : [];
      if (!direct.length) return result;
      const [events] = await pool.execute(`SELECT CAST(entity_id AS CHAR) AS publication_id,metadata_json
        FROM mdm_version_log WHERE id IN (
          SELECT MAX(id) FROM mdm_version_log WHERE entity_type='publication'
          AND operation IN ('publish','directory_change') AND entity_id IN (${direct.map(() => '?').join(',')}) GROUP BY entity_id
        )`, direct.map(row => String(row.id)));
      const summaries = new Map(events.map(event => [String(event.publication_id),directoryHistorySummary(event.metadata_json)]));
      return result.map(row => row.source_file_name === 'directory-change.json' ? {...row,history_summary:summaries.get(String(row.id)) || null} : row);
    },
    async get(id) {
      const [rows] = await pool.execute(`SELECT ${metadataColumns},payload_json FROM mdm_publications WHERE id=?`, [id]);
      const row = rows[0]; if (!row) return null;
      const content = JSON.parse(row.payload_json);
      if (hash(content) !== row.content_hash) throw conflict('发布内容摘要不一致，请联系维护人员核对');
      const result = publicRow(row); delete result.payload_json;
      let audit = null;
      if (row.kind !== 'master_data') {
        const [events] = await pool.execute("SELECT metadata_json,CAST(operated_by_person_id AS CHAR) AS actor_person_id,UNIX_TIMESTAMP(operated_at) AS operated_epoch FROM mdm_version_log WHERE entity_type='publication' AND entity_id=? AND operation IN ('publish','directory_change') ORDER BY id DESC LIMIT 1", [id]);
        if (events[0]) {
          const metadata = JSON.parse(events[0].metadata_json || '{}');
          if (metadata.reason) audit = {...metadata,actor_person_id:String(events[0].actor_person_id),operated_at:new Date(Number(events[0].operated_epoch)*1000).toISOString()};
        }
      }
      return { ...result, content, ...(row.kind !== 'master_data' ? {audit} : {}) };
    },
    async preview(normalized, proposedKey) {
      const key = datasetKey(normalized.content.kind, proposedKey);
      const result = await plan(pool, normalized, key);
      return { datasetKey: key, expectedLatestId: identityInteger(result.previous?.id) || 0, baseHash: result.sourceHash || result.baseHash, ...(result.sourceHashVersion ? {sourceHashVersion:result.sourceHashVersion} : {}), contentHash: normalized.contentHash, summary: result.summary, changes: result.reviewChanges || [], errors: result.errors };
    },
    async publish(input, actor) {
      const subject = sessionSubject(actor);
      const actorId = identityInteger(subject.personId);
      if(!actorId)throw failure('缺少有效发布人');
      const normalized = normalizePublication(input.content);
      const reason = normalized.content.kind === 'master_data' ? null : directoryChangeReason(input.reason);
      const key = datasetKey(normalized.content.kind, input.datasetKey);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input.requestId || ''))) throw failure('发布请求标识无效');
      if (normalized.contentHash !== input.contentHash) throw conflict('文件或列对应关系已变化，请重新核对');
      const db = await pool.getConnection();
      try {
        await db.beginTransaction();
        await db.execute('SELECT account_id FROM user_accounts WHERE person_id=CAST(? AS SIGNED) FOR UPDATE',[identityParam(actorId)]);
        await db.execute('SELECT person_id FROM person WHERE person_id=CAST(? AS SIGNED) FOR UPDATE',[identityParam(actorId)]);
        await db.execute('SELECT person_role_id FROM person_roles WHERE person_id=CAST(? AS SIGNED) FOR UPDATE',[identityParam(actorId)]);
        const authority = await readPersonAuthority(db, actor, actorId, { currentRead: true });
        if(!authority.valid || !authority.permissions.has(publicationWritePermission(normalized.content.kind)) || authority.readOnly){
          const denied=failure('发布人的账号或授权已变化，请重新登录核对','PUBLICATION_ACCESS_CHANGED');denied.statusCode=403;throw denied;
        }
        const [already] = await db.execute(`SELECT ${metadataColumns} FROM mdm_publications WHERE request_id=?`, [input.requestId]);
        if (already[0]) {
          if (already[0].content_hash !== normalized.contentHash || already[0].dataset_key !== key || !sameIdentityInteger(already[0].published_by_person_id, actorId)) throw conflict('同一请求标识不能用于其他发布内容');
          if (reason) {
            const [events] = await db.execute("SELECT metadata_json FROM mdm_version_log WHERE entity_type='publication' AND entity_id=? AND operation='publish' ORDER BY id DESC LIMIT 1", [already[0].id]);
            if (!events[0] || JSON.parse(events[0].metadata_json || '{}').reason !== reason) throw conflict('同一请求标识不能用于其他变更原因');
          }
          await db.rollback(); return { ...publicRow(already[0]), idempotent: true };
        }
        // An old successful request can still recover its original receipt above.
        // An uncommitted old check must be reviewed again; never reinterpret it.
        if (normalized.content.kind !== 'master_data' && input.sourceHashVersion !== DIRECTORY_SOURCE_HASH_VERSION) {
          const expired = failure('目录核对方式已更新，请保留文件、列对应关系和原因，重新核对后再保存', 'PUBLICATION_SOURCE_CHECK_EXPIRED');
          expired.statusCode = 409; throw expired;
        }
        const prepared = await plan(db, normalized, key, true);
        const expectedMatches=prepared.previous?sameIdentityInteger(prepared.previous.id,input.expectedLatestId):Number(input.expectedLatestId)===0;
        if (!expectedMatches || (prepared.sourceHash || prepared.baseHash) !== input.baseHash) throw conflict('核对后目录或发布版本已变化，请重新核对');
        if (prepared.errors.length) throw failure('导入内容仍有待处理问题', 'PUBLICATION_REVIEW_REQUIRED', { issues: prepared.errors });
        if (normalized.content.kind !== 'master_data') await applyDirectory(db, normalized.content.kind, prepared.changes, actorId);
        const ref = crypto.randomUUID();
        await db.execute('INSERT INTO mdm_publications (publication_ref,request_id,kind,dataset_key,title,version_no,previous_publication_id,source_file_name,content_hash,payload_json,row_count,published_by_person_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [ref, input.requestId, normalized.content.kind, key, normalized.content.title, Number(prepared.previous?.version_no || 0) + 1, prepared.previous?.id || null, normalized.content.sourceFileName, normalized.contentHash, JSON.stringify(normalized.content), normalized.content.rows.length, identityParam(actorId)]);
        const [[created]]=await db.execute('SELECT CAST(LAST_INSERT_ID() AS CHAR) id');
        await db.execute("INSERT INTO mdm_version_log (entity_type,entity_id,operation,operated_by_person_id,metadata_json) VALUES ('publication',?,'publish',?,?)", [created.id, identityParam(actorId), JSON.stringify({ kind: normalized.content.kind, publicationRef: ref, contentHash: normalized.contentHash, rowCount: normalized.content.rows.length, ...(reason ? { reason, ...(authority.user?.personName?{actor_name:authority.user.personName}:{}), changes: prepared.reviewChanges, records: prepared.changes.map(change => ({ before: change.existing || null, after: change.desired })) } : {}) })]);
        await db.commit();
        const [published] = await db.execute(`SELECT ${metadataColumns} FROM mdm_publications WHERE id=?`, [created.id]);
        return publicRow(published[0]);
      } catch (error) {
        await db.rollback();
        if (error.code === 'ER_DUP_ENTRY' || error.code === 'ER_LOCK_DEADLOCK') throw conflict('其他人员已更新相同数据，请刷新后重新核对');
        throw error;
      } finally { db.release(); }
    }
  };
}

module.exports = { makePublicationRepository, directoryPlan, applyDirectory, datasetKey, publicationWritePermission, directoryChangeReason, DIRECTORY_SOURCE_HASH_VERSION, directorySourceHash };
