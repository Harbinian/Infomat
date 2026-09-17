const crypto = require('node:crypto');
const { makeIdentityMysqlRepository } = require('./identityMysqlRepository');
const { MIGRATION_KEY } = require('./dataMapDefinitionSchema');
const { failure, id, kind, json, digest, parse, rows, snapshot, lastId, insertVersion } = require('./dataMapDefinitionValues');

const uuid = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw failure('DEFINITION_REQUEST_ID_INVALID');
  return value.toLowerCase();
};
function text(value, max = 255) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw failure('DEFINITION_TEXT_INVALID');
  return value.trim();
}
function revision(value) { if (!Number.isSafeInteger(value) || value < 1) throw failure('DEFINITION_REVISION_REQUIRED'); return value; }
function definitionPatch(type, original, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Buffer.byteLength(json(patch)) > 65536) throw failure('DEFINITION_PAYLOAD_INVALID');
  const common = ['name','business_meaning','source','authority_suggestion'];
  const allowed = new Set([...common, ...(type === 'object' ? ['formation','maintenance','usage','storage','lifecycle','unique_identifiers','pending'] : ['data_type','data_format','length_precision','required','enum_values','identifier_role','sensitivity','masking'])]);
  for (const key of Object.keys(patch)) if (!allowed.has(key)) throw failure('DEFINITION_PROPERTY_NOT_ALLOWED');
  const result = { ...original, ...patch };
  result.name = text(result.name);
  for (const key of ['business_meaning','data_type','data_format','length_precision','identifier_role','sensitivity','masking']) {
    if (result[key] !== undefined && result[key] !== null && (typeof result[key] !== 'string' || result[key].length > 4096)) throw failure('DEFINITION_TEXT_INVALID');
  }
  for (const [key,limit] of Object.entries({data_type:64,data_format:128,length_precision:64,sensitivity:32})) {
    if (typeof result[key]==='string' && result[key].length>limit) throw failure('DEFINITION_TEXT_INVALID');
  }
  if (type === 'field') {
    if (result.required !== null && typeof result.required !== 'boolean') throw failure('DEFINITION_REQUIRED_INVALID');
    if (result.enum_values !== null && (!Array.isArray(result.enum_values) || result.enum_values.some(v => !['string','number','boolean'].includes(typeof v)))) throw failure('DEFINITION_ENUM_INVALID');
  }
  return result;
}

function makeDataMapDefinitionRepository(pool) {
  async function transaction(action) {
    const db = await pool.getConnection();
    try {
      await db.execute("SET time_zone = '+00:00'");
      const [marker] = await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]);
      if (!marker.length) throw failure('DEFINITION_MIGRATION_REQUIRED',503);
      await db.beginTransaction();
      const result = await action(db); await db.commit(); return result;
    } catch (error) {
      await db.rollback();
      if (['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','ER_DUP_ENTRY'].includes(error.code)) throw failure('DEFINITION_CONFLICT',409);
      if (['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error.code)) throw failure('DEFINITION_SCHEMA_UNAVAILABLE',503);
      throw error;
    } finally { db.release(); }
  }
  async function actor(db, session, permission) {
    if (!session?.personId || !session?.accountId || !session?.authVersion) throw failure('DEFINITION_AUTH_REQUIRED',401);
    const personId = id(session.personId);
    const [[account]]=await db.execute('SELECT CAST(person_id AS CHAR) AS person_id,CAST(auth_version AS CHAR) AS auth_version,account_status,must_change_password FROM user_accounts WHERE account_id=? FOR UPDATE',[id(session.accountId)]);
    const [[person]]=await db.execute('SELECT CAST(current_department_id AS CHAR) AS department_id,status FROM person WHERE person_id=? FOR UPDATE',[personId]);
    if (!account || !person || account.account_status!=='active' || account.must_change_password || person.status!=='active' || account.person_id!==personId || account.auth_version!==id(session.authVersion)) throw failure('DEFINITION_AUTH_REQUIRED',401);
    await db.execute('SELECT person_id FROM person_roles WHERE person_id=? FOR UPDATE',[personId]);
    const identity = makeIdentityMysqlRepository(db);
    const validated = await identity.validateSession(session);
    if (!validated.valid || validated.user.must_change_password) throw failure('DEFINITION_AUTH_REQUIRED',401);
    const { permSet } = await identity.getUserEffectivePermissions(personId);
    const roles = await identity.getUserRoleCodes(personId);
    if (permission && (roles.some(r=>r.code==='admin') || !permSet.has(permission))) throw failure('DEFINITION_ACCESS_DENIED',403);
    return { personId, departmentId:person.department_id, permissions:permSet, readOnly:roles.some(r=>r.code==='admin') };
  }
  function scope(actor, departmentId, write = false) {
    if (!write && actor.permissions.has('governance:read-global')) return;
    if (!departmentId || String(departmentId) !== actor.departmentId || (!write && !actor.permissions.has('governance:read-department'))) throw failure('DEFINITION_ACCESS_DENIED',403);
  }
  async function entityScope(db, type, entityId, lock = false) {
    const source = await snapshot(db,type,entityId,lock);
    if (type === 'object') return { source, departmentId:source.row.owner_dept_id };
    const context = (await rows(db,'data_map_contexts','id=?',[source.row.context_id],lock))[0];
    return { source, departmentId:context?.dept_id };
  }
  async function version(db, versionId, lock = false) {
    const [[value]] = await db.execute(`SELECT *,CAST(version_id AS CHAR) AS version_id,CAST(entity_id AS CHAR) AS entity_id,
      CAST(object_version_id AS CHAR) AS object_version_id,CAST(supersedes_version_id AS CHAR) AS supersedes_version_id,
      CAST(created_by_person_id AS CHAR) AS created_by_person_id,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS created_at FROM data_map_definition_versions WHERE version_id=?${lock?' FOR SHARE':''}`,[id(versionId)]);
    if (!value) throw failure('DEFINITION_VERSION_NOT_FOUND',404);
    const definition=parse(value.definition_json),baseSnapshot=parse(value.base_snapshot_json);
    if (value.content_digest!==digest(definition)||value.base_digest!==digest(baseSnapshot)) throw failure('DEFINITION_VERSION_INTEGRITY_CONFLICT',409);
    return { ...value, revision_no:value.version_no, definition, base_snapshot:baseSnapshot };
  }
  async function current(db,type,entityId,lock=false) {
    const [[head]] = await db.execute(`SELECT CAST(current_version_id AS CHAR) AS version_id,revision_no FROM data_map_definition_heads WHERE entity_type=? AND entity_id=?${lock?' FOR UPDATE':''}`,[type,entityId]);
    if (!head) throw failure('DEFINITION_LEGACY_CAPTURE_REQUIRED',409);
    const value=await version(db,head.version_id,lock);
    if (head.revision_no!==value.version_no) throw failure('DEFINITION_VERSION_INTEGRITY_CONFLICT',409);
    return value;
  }
  function unchanged(v, source) { if (v.base_digest !== digest(source)) throw failure('DEFINITION_LEGACY_SOURCE_CHANGED',409); }
  async function request(db, actor, action, payload, operation) {
    const requestId = uuid(payload.request_id), hash = digest(payload);
    if (!actor.departmentId) throw failure('DEFINITION_DEPARTMENT_REQUIRED',403);
    await db.execute(`INSERT INTO data_map_definition_requests(actor_person_id,action,request_id,scope_department_id,payload_digest,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE request_id=request_id`,[actor.personId,action,requestId,actor.departmentId,hash]);
    const [[saved]] = await db.execute('SELECT CAST(scope_department_id AS CHAR) AS scope_department_id,payload_digest,result_json FROM data_map_definition_requests WHERE actor_person_id=? AND action=? AND request_id=? FOR UPDATE',[actor.personId,action,requestId]);
    scope(actor,saved.scope_department_id,true);
    if (saved.payload_digest !== hash) throw failure('DEFINITION_IDEMPOTENCY_CONFLICT',409);
    if (saved.result_json !== null) return parse(saved.result_json);
    const result = await operation();
    await db.execute('UPDATE data_map_definition_requests SET result_json=? WHERE actor_person_id=? AND action=? AND request_id=?',[json(result),actor.personId,action,requestId]);
    return result;
  }
  async function identifiers(db, entityId, value) {
    if (value === null) return;
    if (!Array.isArray(value) || value.length > 32) throw failure('DEFINITION_IDENTIFIERS_INVALID');
    const groups = new Set();
    for (const group of value) {
      uuid(group.group_id);
      if (groups.has(group.group_id)) throw failure('DEFINITION_IDENTIFIERS_INVALID');
      groups.add(group.group_id);
      const fields = group.field_version_ids;
      if (!Array.isArray(fields) || !['single','composite'].includes(group.kind) || (group.kind === 'single' ? fields.length !== 1 : fields.length < 2) || fields.length > 32 || new Set(fields.map(id)).size !== fields.length) throw failure('DEFINITION_IDENTIFIERS_INVALID');
      let parent;
      const entities = new Set();
      for (const fieldId of fields) {
        const field = await version(db,fieldId);
        if (field.entity_type !== 'field' || field.base_snapshot.row.object_id !== String(entityId) || !field.object_version_id) throw failure('DEFINITION_FIELD_OBJECT_MISMATCH');
        if (parent && field.object_version_id !== parent) throw failure('DEFINITION_IDENTIFIER_VERSION_MISMATCH');
        if (entities.has(field.entity_id)) throw failure('DEFINITION_IDENTIFIERS_INVALID');
        entities.add(field.entity_id);
        parent = field.object_version_id;
      }
    }
  }
  async function event(db,versionId,type,basis,personId) {
    await db.execute('INSERT INTO data_map_definition_events(version_id,event_type,basis_json,actor_person_id,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))',[versionId,type,json(basis),personId]);
    return await lastId(db);
  }
  async function saveDefinitionInTransaction(db,session,payload) {
      const type=kind(payload.entity_type);
      
        const who=await actor(db,session,'governance:draft-department');
        return request(db,who,'save_definition',payload,async()=>{
          let entityId=payload.entity_id ? id(payload.entity_id) : null, previous=null, parent=null;
          let original={ name:null,business_meaning:null,source:null,authority_suggestion:null,governance:null,
            ...(type==='object'?{unique_identifiers:null}:{required:null,enum_values:null}) };
          if (entityId) {
            const scoped=await entityScope(db,type,entityId,true);scope(who,scoped.departmentId,true);
            if (type==='field' ? scoped.source.row.status!=='draft' : !['draft','active'].includes(scoped.source.row.status)) throw failure('DEFINITION_STATE_NOT_EDITABLE',409);
            previous=await current(db,type,entityId,true);unchanged(previous,scoped.source);
            if (revision(payload.expected_revision)!==previous.version_no) throw failure('DEFINITION_REVISION_CONFLICT',409);
            original=previous.definition;
          } else if (payload.expected_revision !== undefined) throw failure('DEFINITION_CREATE_REVISION_INVALID');
          const definition=definitionPatch(type,original,payload.definition);
          if (type==='field') {
            const objectId=id(payload.object_id),contextId=id(payload.context_id);
            const object=await entityScope(db,'object',objectId,true);scope(who,object.departmentId,true);
            if (!['draft','active'].includes(object.source.row.status)) throw failure('DEFINITION_PARENT_INACTIVE',409);
            const objectCurrent=await current(db,'object',objectId,true);unchanged(objectCurrent,object.source);
            parent=id(payload.object_version_id);
            if (parent!==objectCurrent.version_id) throw failure('DEFINITION_OBJECT_VERSION_CHANGED',409);
            const context=(await rows(db,'data_map_contexts','id=?',[contextId],true))[0];
            if (!context) throw failure('DEFINITION_CONTEXT_REQUIRED');scope(who,context.dept_id,true);
            if (previous && (previous.base_snapshot.row.context_id!==contextId || previous.base_snapshot.row.object_id && previous.base_snapshot.row.object_id!==objectId)) throw failure('DEFINITION_FIELD_OBJECT_MISMATCH');
            if (!entityId) {
              await db.execute("INSERT INTO data_map_fields(context_id,object_id,field_key,field_name_cn,business_definition,status,submitted_by_person_id) VALUES (?,?,?,?,?,'draft',?)",[contextId,objectId,'fld_'+crypto.randomUUID(),definition.name,definition.business_meaning,who.personId]);
              entityId=await lastId(db);
            } else await db.execute('UPDATE data_map_fields SET object_id=?,field_name_cn=?,business_definition=? WHERE id=?',[objectId,definition.name,definition.business_meaning,entityId]);
            // Mirror representable values for existing readers. Legacy nullable
            // cannot express unknown; its preserved value is never the new fact.
            const updates=[],params=[];
            for (const key of ['data_type','data_format','length_precision']) {
              if (Object.hasOwn(payload.definition,key)) {updates.push(`${key}=?`);params.push(definition[key]);}
            }
            if (Object.hasOwn(payload.definition,'enum_values')) {updates.push('enum_values_json=?');params.push(definition.enum_values===null?null:json(definition.enum_values));}
            if (Object.hasOwn(payload.definition,'required') && definition.required!==null) {updates.push('nullable=?');params.push(definition.required?0:1);}
            if (updates.length) await db.execute(`UPDATE data_map_fields SET ${updates.join(',')} WHERE id=?`,[...params,entityId]);
          } else {
            if (!entityId) {
              const departmentId=id(payload.department_id);scope(who,departmentId,true);
              const [departments]=await db.execute("SELECT id FROM departments WHERE id=? AND status='active'",[departmentId]);
              if (!departments.length) throw failure('DEFINITION_DEPARTMENT_REQUIRED');
              await db.execute("INSERT INTO data_map_objects(object_key,object_name_cn,description,owner_dept_id,status,created_by_person_id) VALUES (?,?,?,?,'draft',?)",['obj_'+crypto.randomUUID(),definition.name,definition.business_meaning,departmentId,who.personId]);
              entityId=await lastId(db);
            } else await db.execute('UPDATE data_map_objects SET object_name_cn=?,description=?,updated_by_person_id=? WHERE id=?',[definition.name,definition.business_meaning,who.personId,entityId]);
            await identifiers(db,entityId,definition.unique_identifiers);
          }
          const source=await snapshot(db,type,entityId,true);
          const result=await insertVersion(db,{type,entityId,revision:previous?previous.version_no+1:1,parent,previous:previous?.version_id||null,definition,source,sourceKind:'manual',actor:who.personId});
          await event(db,result.version_id,'definition_saved',{previous_version_id:previous?.version_id||null},who.personId);
          return result;
        });
      
  }

  async function registerSourceInTransaction(db,session,payload,bytes=null) {
      if (bytes!==null && (!Buffer.isBuffer(bytes)||bytes.length>20*1024*1024)) throw failure('DEFINITION_SOURCE_SIZE_INVALID',413);
      const rawHash=bytes===null?null:crypto.createHash('sha256').update(bytes).digest('hex');
      const body={...payload,raw_sha256:rawHash,byte_length:bytes===null?null:bytes.length};
      
        const who=await actor(db,session,'governance:draft-department');
        return request(db,who,'register_source',body,async()=>{
          const dept=id(payload.department_id);scope(who,dept,true);
          const parser=text(payload.parser_version,64),profile=text(payload.template_profile_version,64),name=text(payload.original_name,512);
          if(rawHash){const [existing]=await db.execute('SELECT CAST(batch_id AS CHAR) AS batch_id FROM data_map_source_files WHERE raw_sha256=? AND parser_version=? AND template_profile_version=? AND scope_department_id=?',[rawHash,parser,profile,dept]);if(existing.length)return {...existing[0],duplicate:true};}
          await db.execute("INSERT INTO data_map_import_batches(source_type,file_name,status,note) VALUES ('template',?,'partial','source_registered_only')",[name]);
          const batchId=await lastId(db);
          await db.execute('INSERT INTO data_map_source_files(batch_id,raw_sha256,raw_digest_status,byte_length,parser_version,template_profile_version,scope_department_id,imported_by_person_id) VALUES (?,?,?,?,?,?,?,?)',[batchId,rawHash,rawHash?'available':'unavailable',body.byte_length,parser,profile,dept,who.personId]);
          return {batch_id:batchId,raw_sha256:rawHash,raw_digest_status:rawHash?'available':'unavailable'};
        });
      
  }

  async function addSourceMappingInTransaction(db,session,payload) {
      
        const who=await actor(db,session,'governance:draft-department');
        return request(db,who,'source_mapping',payload,async()=>{
          const batchId=id(payload.batch_id),sheet=text(payload.sheet_name,128),type=kind(payload.record_type);
          const [[batch]]=await db.execute('SELECT CAST(scope_department_id AS CHAR) AS scope_department_id FROM data_map_source_files WHERE batch_id=? FOR UPDATE',[batchId]);
          if (!batch) throw failure('DEFINITION_SOURCE_NOT_FOUND',404);scope(who,batch.scope_department_id,true);
          if (!Number.isInteger(payload.source_row)||payload.source_row<1||payload.source_row>1048576) throw failure('DEFINITION_SOURCE_ROW_INVALID');
          const local=payload.local_id===null?null:text(payload.local_id,128);
          const versionId=payload.platform_version_id===null?null:id(payload.platform_version_id);
          if(versionId){const v=await version(db,versionId);if(v.entity_type!==type)throw failure('DEFINITION_MAPPING_TYPE_MISMATCH');const s=await entityScope(db,type,v.entity_id);scope(who,s.departmentId,true);if(type==='field'&&!v.object_version_id)throw failure('DEFINITION_OBJECT_REQUIRED',409);}
          const reason=versionId?null:text(payload.unresolved_reason);
          if (!Array.isArray(payload.cells)||payload.cells.length===0||payload.cells.length>128)throw failure('DEFINITION_SOURCE_CELLS_REQUIRED');
          const cellIds=[];
          for(const cell of payload.cells){
            if(!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(cell.address)||!['blank','string','number','boolean','formula','date'].includes(cell.raw_type)||cell.raw_value===undefined||Buffer.byteLength(json(cell.raw_value))>16384)throw failure('DEFINITION_SOURCE_CELL_INVALID');
            const raw=json(cell.raw_value);
            const [[existing]]=await db.execute('SELECT CAST(cell_id AS CHAR) AS cell_id,raw_type,CAST(raw_value_json AS CHAR) AS raw_value_json FROM data_map_source_cells WHERE batch_id=? AND sheet_name=? AND cell_address=? FOR UPDATE',[batchId,sheet,cell.address]);
            if(existing){if(existing.raw_type!==cell.raw_type||json(parse(existing.raw_value_json))!==raw)throw failure('DEFINITION_SOURCE_CELL_CHANGED',409);cellIds.push(existing.cell_id);}
            else{await db.execute('INSERT INTO data_map_source_cells(batch_id,sheet_name,cell_address,raw_type,raw_value_json) VALUES (?,?,?,?,?)',[batchId,sheet,cell.address,cell.raw_type,raw]);cellIds.push(await lastId(db));}
          }
          await db.execute('INSERT INTO data_map_source_mappings(batch_id,sheet_name,record_type,local_id,source_row,platform_version_id,source_cell_ids_json,unresolved_reason) VALUES (?,?,?,?,?,?,?,?)',[batchId,sheet,type,local,payload.source_row,versionId,json(cellIds),reason]);
          return {mapping_id:await lastId(db),platform_version_id:versionId,cell_ids:cellIds,unresolved_reason:reason};
        });
      
  }
  return {
    ...require('./dataMapManagement')({transaction,actor,scope,entityScope,current,unchanged,version,request,save:saveDefinitionInTransaction,event}),
    ...require('./dataMapFacts')({transaction,actor,scope,entityScope,current,unchanged,version,request,event}),
    ...require('./v7Mappings')({transaction,actor,scope,entityScope,version,request}),
    async templateImportActor(session) {
      return transaction(async db => {
        const who = await actor(db,session,'governance:draft-department');
        const [departments] = await db.execute("SELECT id FROM departments WHERE id=? AND status='active'",[who.departmentId]);
        if (!departments.length) throw failure('DEFINITION_DEPARTMENT_REQUIRED',403);
        return {personId:who.personId,departmentId:who.departmentId};
      });
    },
    async importTemplate(session,payload,bytes) {
      const { prepareImport, recordDefinition } = require('./masterDataTemplateImport');
      const who = await this.templateImportActor(session);
      const prepared = await prepareImport(bytes,payload.original_name,payload.links,who);
      if (!prepared.preview.validation_passed || !prepared.preview.objects.length) throw Object.assign(failure('TEMPLATE_CORRECTION_REQUIRED'),{field_errors:prepared.preview.issues});
      if (payload.preview_digest !== prepared.preview_digest) throw failure('TEMPLATE_PREVIEW_CHANGED',409);
      if (payload.confirm !== true) throw failure('TEMPLATE_CONFIRM_REQUIRED');
      return transaction(async db => {
        const locked = await actor(db,session,'governance:draft-department');
        scope(locked,who.departmentId,true);
        const body = {request_id:payload.request_id,original_name:prepared.preview.source.original_name,plan_digest:prepared.plan_digest};
        return request(db,locked,'import_template',body,async () => {
          const source = await registerSourceInTransaction(db,session,{request_id:crypto.randomUUID(),department_id:who.departmentId,
            ...prepared.preview.source},bytes);
          const batchId = source.batch_id;
          if (source.duplicate) {
            const [[batch]] = await db.execute('SELECT status,note FROM data_map_import_batches WHERE id=? FOR UPDATE',[batchId]);
            let note; try { note=JSON.parse(batch.note); } catch { /* prior source-only registrations cannot be silently completed */ }
            if (batch.status!=='imported' || note?.schema_version!=='template-import-v1') throw failure('TEMPLATE_SOURCE_INCOMPLETE',409);
            if (note.plan_digest!==prepared.plan_digest) throw failure('TEMPLATE_BATCH_PLAN_CONFLICT',409);
            return {...note.result,duplicate:true};
          }
          // One explicit source context, never a formal process work package.
          await db.execute("INSERT INTO data_map_contexts(context_key,context_type,title,dept_id,source_file,status,created_by_person_id) VALUES (?,'import',?,?,?,'draft',?)",
            ['template_'+crypto.randomUUID(),'模板导入 '+batchId,who.departmentId,prepared.preview.source.original_name,who.personId]);
          const contextId = await lastId(db), mapped = [], objects = new Map();
          for (const record of [...prepared.preview.objects,...prepared.preview.fields]) {
            const link = prepared.links.find(l=>l.record_type===record.record_type&&l.source_row===record.source_row);
            const parent = record.record_type==='field' ? objects.get(record.object_source_row) : null;
            let fieldContext = contextId;
            if (link && record.record_type==='field') {
              const prior = await entityScope(db,'field',link.entity_id,true);scope(locked,prior.departmentId,true);
              if (prior.source.row.object_id!==parent?.entity_id) throw failure('DEFINITION_FIELD_OBJECT_MISMATCH');
              fieldContext=prior.source.row.context_id;
            }
            const saved = await saveDefinitionInTransaction(db,session,{request_id:crypto.randomUUID(),entity_type:record.record_type,
              ...(link?{entity_id:link.entity_id,expected_revision:link.expected_revision}:{}),department_id:who.departmentId,
              ...(parent?{object_id:parent.entity_id,object_version_id:parent.version_id,context_id:fieldContext}:{}),
              definition:recordDefinition(record,batchId)});
            if (record.record_type==='object') objects.set(record.source_row,saved);
            await addSourceMappingInTransaction(db,session,{request_id:crypto.randomUUID(),batch_id:batchId,
              sheet_name:record.sheet_name,record_type:record.record_type,local_id:record.local_id,source_row:record.source_row,
              platform_version_id:saved.version_id,cells:record.cells});
            mapped.push({record_type:record.record_type,local_id:record.local_id,source_row:record.source_row,
              entity_id:saved.entity_id,version_id:saved.version_id,revision_no:saved.revision_no,mode:link?'revision':'new'});
          }
          // Preserve all parsed source cells, including metadata and original headers.
          for (const cell of prepared.preview.source_cells) await db.execute('INSERT IGNORE INTO data_map_source_cells(batch_id,sheet_name,cell_address,raw_type,raw_value_json) VALUES (?,?,?,?,?)',[batchId,cell.sheet_name,cell.address,cell.raw_type,json(cell.raw_value)]);
          const result = {batch_id:batchId,context_id:contextId,verification_status:'pending_verification',duplicate:false,mappings:mapped};
          await db.execute("UPDATE data_map_import_batches SET context_id=?,row_count=?,status='imported',note=? WHERE id=?",
            [contextId,mapped.length,json({schema_version:'template-import-v1',plan_digest:prepared.plan_digest,result}),batchId]);
          return result;
        });
      });
    },
    async saveDefinition(session,payload) {
      return transaction(db => saveDefinitionInTransaction(db,session,payload));
    },
    async getCurrent(session,type,entityId) {
      kind(type);id(entityId);
      return transaction(async db=>{const who=await actor(db,session);const scoped=await entityScope(db,type,entityId);scope(who,scoped.departmentId);const v=await current(db,type,entityId);unchanged(v,scoped.source);return v;});
    },
    async getVersion(session,versionId) {
      return transaction(async db=>{
        const who=await actor(db,session),v=await version(db,versionId);
        // Historical bytes survive legacy deletion; only global readers may see
        // history when current entity/context scope can no longer be resolved.
        if (!who.permissions.has('governance:read-global')) {const scoped=await entityScope(db,v.entity_type,v.entity_id);scope(who,scoped.departmentId);}
        return v;
      });
    },
    async getSource(session,batchId) {
      return transaction(async db=>{
        const who=await actor(db,session);
        const [[batch]]=await db.execute(`SELECT f.*,CAST(f.batch_id AS CHAR) AS batch_id,CAST(f.byte_length AS CHAR) AS byte_length,
          CAST(f.scope_department_id AS CHAR) AS scope_department_id,CAST(f.imported_by_person_id AS CHAR) AS imported_by_person_id,
          b.file_name AS original_name,DATE_FORMAT(b.imported_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS imported_at
          FROM data_map_source_files f JOIN data_map_import_batches b ON b.id=f.batch_id WHERE f.batch_id=?`,[id(batchId)]);
        if (!batch) throw failure('DEFINITION_SOURCE_NOT_FOUND',404);scope(who,batch.scope_department_id);
        const [cells]=await db.execute('SELECT CAST(cell_id AS CHAR) AS cell_id,sheet_name,cell_address,raw_type,CAST(raw_value_json AS CHAR) AS raw_value_json FROM data_map_source_cells WHERE batch_id=? ORDER BY cell_id',[batchId]);
        const [mappings]=await db.execute(`SELECT CAST(m.mapping_id AS CHAR) AS mapping_id,m.sheet_name,m.record_type,m.local_id,m.source_row,
          CAST(m.platform_version_id AS CHAR) AS platform_version_id,CAST(v.entity_id AS CHAR) AS platform_entity_id,m.source_cell_ids_json,m.unresolved_reason
          FROM data_map_source_mappings m LEFT JOIN data_map_definition_versions v ON v.version_id=m.platform_version_id WHERE m.batch_id=? ORDER BY m.mapping_id`,[batchId]);
        return {...batch,cells:cells.map(c=>({...c,raw_value:parse(c.raw_value_json)})),mappings:mappings.map(m=>({...m,source_cell_ids:parse(m.source_cell_ids_json)}))};
      });
    },
    async recordReview(session,payload) {
      return transaction(async db=>{
        const who=await actor(db,session,'governance:structure-gate');
        return request(db,who,'record_review',payload,async()=>{
          const v=await version(db,payload.version_id),scoped=await entityScope(db,v.entity_type,v.entity_id,true);
          scope(who,scoped.departmentId);const head=await current(db,v.entity_type,v.entity_id,true);unchanged(head,scoped.source);
          if (v.entity_type==='field' && !v.object_version_id) throw failure('DEFINITION_OBJECT_REQUIRED',409);
          if (revision(payload.expected_revision)!==head.version_no || head.version_id!==v.version_id) throw failure('DEFINITION_REVISION_CONFLICT',409);
          if (!['fact_checked','needs_more_info'].includes(payload.decision)) throw failure('DEFINITION_FORMAL_DECISION_NOT_ENABLED',403);
          if (!Array.isArray(payload.basis) || !payload.basis.length || payload.basis.length>32) throw failure('DEFINITION_REVIEW_BASIS_REQUIRED');
          payload.basis.forEach(value=>text(value,4096));
          return { event_id:await event(db,v.version_id,payload.decision,payload.basis,who.personId),version_id:v.version_id };
        });
      });
    },
    async registerSource(session,payload,bytes=null) {
      return transaction(db => registerSourceInTransaction(db,session,payload,bytes));
    },
    async addSourceMapping(session,payload) {
      return transaction(db => addSourceMappingInTransaction(db,session,payload));
    }
  };
}
module.exports={makeDataMapDefinitionRepository};
