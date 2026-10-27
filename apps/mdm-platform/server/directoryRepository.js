const crypto = require('node:crypto');
const {sessionSubject,identityInteger,sameIdentityInteger} = require('./sessionSubject');
const {readPersonAuthority} = require('./identityMysqlRepository');
const {directoryPlan,applyDirectory} = require('./publicationRepository');
const {SCHEMA_VERSION,hash,error,id,normalizeChange,rowFor,prepareChange} = require('./directoryContract');

// This projection is shared by the browser and future authenticated consumers.
// The hash covers contact fields too; callers only receive those fields explicitly.
async function readDirectorySnapshot(db, {includeContacts = false, lock = false} = {}) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [departments] = await db.query('SELECT CAST(id AS CHAR) AS id,code,name,CAST(parent_id AS CHAR) AS parent_id,department_type,status,CAST(final_responsible_person_id AS CHAR) AS final_responsible_person_id,CAST(data_owner_person_id AS CHAR) AS data_owner_person_id FROM departments ORDER BY id' + suffix);
  const [persons] = await db.query('SELECT CAST(person_id AS CHAR) AS person_id,employee_no,person_name,CAST(current_department_id AS CHAR) AS current_department_id,employment_status,status,mobile,email FROM person ORDER BY person_id' + suffix);
  const [offices] = await db.query("SELECT CAST(org_unit_id AS CHAR) AS id,org_unit_code AS code,org_unit_name AS name,CAST(department_id AS CHAR) AS department_id,CAST(manager_person_id AS CHAR) AS manager_person_id,status FROM org_unit WHERE org_type='office' ORDER BY org_unit_id" + suffix);
  const [memberships] = await db.query('SELECT CAST(office_id AS CHAR) AS office_id,CAST(person_id AS CHAR) AS person_id,status FROM office_membership ORDER BY person_id,office_id' + suffix);
  const exact = (row, fields) => Object.fromEntries(Object.entries(row).map(([field,value]) => [field, fields.includes(field) ? (value == null ? null : id(value)) : value]));
  const content = {
    departments:departments.map(row => exact(row,['id','parent_id','final_responsible_person_id','data_owner_person_id'])),
    persons:persons.map(row => ({...exact(row,['person_id','current_department_id']),office_ids:memberships.filter(member => member.status === 'active' && sameIdentityInteger(member.person_id,row.person_id)).map(member => id(member.office_id))})),
    offices:offices.map(row => exact(row,['id','department_id','manager_person_id']))
  };
  const snapshot_hash = hash({...content,memberships});
  if (!includeContacts) content.persons = content.persons.map(({mobile,email,...person}) => person);
  return {schema_version:SCHEMA_VERSION,source:'3000',snapshot_hash,...content};
}

async function lockDirectoryActor(db, actor) {
  const subject = sessionSubject(actor), personId = identityInteger(subject.personId);
  if (!personId || subject.kind === 'system_admin') throw error('当前账号无权维护组织与人员目录', 'DIRECTORY_ACCESS_DENIED', 403);
  await db.execute('SELECT account_id FROM user_accounts WHERE person_id=CAST(? AS SIGNED) FOR UPDATE',[String(personId)]);
  await db.execute('SELECT person_id FROM person WHERE person_id=CAST(? AS SIGNED) FOR UPDATE',[String(personId)]);
  await db.execute('SELECT person_role_id FROM person_roles WHERE person_id=CAST(? AS SIGNED) FOR UPDATE',[String(personId)]);
  const authority = await readPersonAuthority(db,actor,personId,{currentRead:true});
  if (!authority.valid || authority.readOnly || !authority.permissions.has('directory:maintain')) throw error('账号或目录维护授权已变化，请重新登录核对', 'DIRECTORY_ACCESS_CHANGED', 403);
  return personId;
}

function makeDirectoryRepository(pool) {
  async function transaction(action) {
    const db = await pool.getConnection();
    try { await db.beginTransaction(); const result = await action(db); await db.commit(); return result; }
    catch (err) {
      await db.rollback();
      if (['ER_DUP_ENTRY','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(err.code)) throw error('目录已被其他人员更新，请保留输入并刷新核对', 'DIRECTORY_SOURCE_CHANGED', 409);
      throw err;
    } finally { db.release(); }
  }
  async function plan(db,input) {
    const snapshot = await readDirectorySnapshot(db,{includeContacts:true,lock:true});
    const prepared = prepareChange(snapshot,input);
    if (snapshot.snapshot_hash !== prepared.change.expected_snapshot_hash) throw error('目录已变化，原输入已保留，请刷新后重新核对', 'DIRECTORY_SOURCE_CHANGED', 409);
    const directory = await directoryPlan(db,prepared.normalized,true);
    return {...prepared,snapshot,directory};
  }
  return {
    snapshot(options = {}) { return transaction(db => readDirectorySnapshot(db,options)); },
    preview(input,actor) {
      return transaction(async db => {
        await lockDirectoryActor(db,actor);
        const prepared = await plan(db,input);
        return {snapshot_hash:prepared.snapshot.snapshot_hash,request_hash:prepared.requestHash,changes:prepared.directory.reviewChanges,errors:prepared.directory.errors,summary:prepared.directory.summary};
      });
    },
    save(input,actor) {
      const requestId = String(input?.request_id || '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw error('保存请求标识无效');
      const requestHash = hash(normalizeChange(input));
      if (requestHash !== input.request_hash) throw error('保存内容或原因与核对内容不一致，请重新核对', 'DIRECTORY_PREVIEW_CHANGED', 409);
      return transaction(async db => {
        const actorId = await lockDirectoryActor(db,actor);
        const [existing] = await db.execute('SELECT CAST(id AS CHAR) AS id,publication_ref,CAST(published_by_person_id AS CHAR) AS published_by_person_id,payload_json FROM mdm_publications WHERE request_id=? FOR UPDATE',[requestId]);
        if (existing[0]) {
          const content = JSON.parse(existing[0].payload_json), saved = content.directory_change;
          if (!saved || saved.request_hash !== requestHash || !sameIdentityInteger(existing[0].published_by_person_id,actorId)) throw error('相同请求标识不能用于其他变更', 'DIRECTORY_REQUEST_REUSED', 409);
          return {id:String(existing[0].id),publication_ref:existing[0].publication_ref,...saved.receipt,idempotent:true};
        }
        const prepared = await plan(db,input);
        if (prepared.directory.errors.length) throw Object.assign(error('目录信息仍有待处理问题', 'DIRECTORY_REVIEW_REQUIRED'),{details:{issues:prepared.directory.errors}});
        if (!prepared.directory.summary.added && !prepared.directory.summary.updated) throw error('未发现需要保存的目录变更', 'DIRECTORY_NO_CHANGE');
        // Capture the actor's name before applying a possible self-edit.
        // Old audit records remain untouched and never borrow a current name.
        const actorName = prepared.snapshot.persons.find(person => sameIdentityInteger(person.person_id,actorId))?.person_name;
        const kind = prepared.normalized.content.kind;
        const [versions] = await db.execute('SELECT CAST(id AS CHAR) AS id,version_no FROM mdm_publications WHERE kind=? AND dataset_key=? ORDER BY version_no DESC LIMIT 1 FOR UPDATE',[kind,kind]);
        await applyDirectory(db,kind,prepared.directory.changes,actorId);
        const after = await readDirectorySnapshot(db,{includeContacts:true,lock:true});
        const codeField = prepared.change.entity === 'person' ? 'employee_no' : 'code';
        const rows = after[prepared.change.entity === 'person' ? 'persons' : prepared.change.entity === 'department' ? 'departments' : 'offices'];
        const updated = prepared.change.id ? rowFor(after,prepared.change.entity,prepared.change.id) : rows.find(row => row[codeField] === prepared.change.values[codeField]);
        if (!updated) throw new Error('DIRECTORY_SAVED_RECORD_MISSING');
        const entityId = String(prepared.change.entity === 'person' ? updated.person_id : updated.id);
        const receipt = {entity:prepared.change.entity,entity_id:entityId,operation:prepared.change.operation,snapshot_hash:after.snapshot_hash};
        const content = {...prepared.normalized.content,directory_change:{request_hash:requestHash,receipt}};
        const ref = crypto.randomUUID(), contentHash = hash(content);
        await db.execute('INSERT INTO mdm_publications(publication_ref,request_id,kind,dataset_key,title,version_no,previous_publication_id,source_file_name,content_hash,payload_json,row_count,published_by_person_id) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)',
          [ref,requestId,kind,kind,content.title,Number(versions[0]?.version_no || 0)+1,versions[0]?.id || null,content.sourceFileName,contentHash,JSON.stringify(content),String(actorId)]);
        const [[inserted]] = await db.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
        await db.execute("INSERT INTO mdm_version_log(entity_type,entity_id,operation,operated_by_person_id,metadata_json) VALUES ('publication',?,'directory_change',?,?)",[inserted.id,String(actorId),JSON.stringify({schema_version:SCHEMA_VERSION,entity:prepared.change.entity,entity_id:entityId,operation:prepared.change.operation,reason:prepared.change.reason,...(actorName?{actor_name:actorName}:{}),before:prepared.existing,after:updated,changes:prepared.directory.reviewChanges,publication_ref:ref})]);
        return {id:String(inserted.id),publication_ref:ref,...receipt,idempotent:false};
      });
    }
  };
}

module.exports = {readDirectorySnapshot,lockDirectoryActor,makeDirectoryRepository};
