// P05 management adapter. Uses the existing definition transaction, identities,
// stable entity IDs and immutable snapshots. No DDL, delete or formal approval.
const crypto = require('node:crypto');
const {failure,id,kind,parse,json,digest,snapshot,lastId,insertVersion} = require('./dataMapDefinitionValues');
const groups = ['对象是什么','从哪里来','谁维护','怎样使用','规则与待确认事项'];
const field = (path,label,group,max=4096,type='text') => ({path,label,group:groups[group],max,type});
const schema = {
  object:[field('name','对象名称',0,255),field('business_meaning','业务含义',0),
    field('formation.type','形成方式',1),field('formation.location','来源位置',1),field('formation.scenario','形成场景',1),field('source.description','对象来源补充',1),
    field('authority_suggestion.type','建议权威来源类型',1),field('authority_suggestion.name','建议权威来源名称',1),field('authority_suggestion.basis_type','建议依据类型',1),field('authority_suggestion.basis_description','建议依据说明',1),
    field('maintenance.department_text','维护部门说明',2),field('maintenance.role_text','维护岗位说明',2),
    field('usage.scope','使用范围',3),field('usage.scenario','使用场景',3),field('storage.location','保存位置',3),field('storage.current_source','当前取值来源',3),
    field('lifecycle.create','新增规则',4),field('lifecycle.change','变更规则',4),field('lifecycle.retire','停用规则',4),
    field('pending.missing','待确认内容',4),field('pending.owner','待确认主体说明',4),field('pending.expected_date','预计完成日期',4,32),field('pending.close_condition','关闭条件',4)],
  field:[field('name','字段名称',0,255),field('business_meaning','字段含义',0),field('source.type','字段值来源类型',1),field('source.description','字段值来源说明',1),
    field('data_type','数据类型',4,64),field('data_format','格式',4,128),field('length_precision','长度与精度',4,64),field('required','是否必填',4,0,'nullable_boolean'),
    field('enum_values','枚举允许值',4,0,'nullable_array'),field('identifier_role','标识角色说明',4),field('sensitivity','敏感程度',4,32),field('masking','脱敏说明',4)]
};
function page(input) {
  return input ? id(input) : null;
}
function mergePatch(type,original,patch) {
  if (!patch || Array.isArray(patch) || typeof patch!=='object' || Buffer.byteLength(json(patch))>65536) throw failure('DEFINITION_PAYLOAD_INVALID');
  const result={};
  for (const [key,value] of Object.entries(patch)) {
    if (key==='unique_identifiers' && type==='object') {
      if(value!==null&&(!Array.isArray(value)||value.some(group=>!group||Array.isArray(group)||typeof group!=='object'||Object.keys(group).some(k=>!['group_id','kind','field_version_ids'].includes(k)))))throw failure('DEFINITION_IDENTIFIERS_INVALID');
      result[key]=value;continue;
    }
    const entries=schema[type].filter(f=>f.path.split('.')[0]===key);
    if (!entries.length) throw failure('DEFINITION_PROPERTY_NOT_ALLOWED');
    if(entries[0].path.includes('.')) {
      if(!value || Array.isArray(value) || typeof value!=='object') throw failure('DEFINITION_PROPERTY_INVALID');
      if(original[key]!==null&&original[key]!==undefined&&(Array.isArray(original[key])||typeof original[key]!=='object'))throw failure('DEFINITION_PROPERTY_INVALID');
      result[key]={...(original[key]||{})};
      for(const [child,v] of Object.entries(value)) {
        const spec=entries.find(f=>f.path===`${key}.${child}`);
        if(!spec || v!==null && (typeof v!=='string'||v.length>spec.max)) throw failure('DEFINITION_PROPERTY_INVALID');
        result[key][child]=v;
      }
    } else {
      const spec=entries[0];
      if(spec.type==='text' && value!==null && (typeof value!=='string'||value.length>spec.max)) throw failure('DEFINITION_TEXT_INVALID');
      result[key]=value;
    }
  }
  return result;
}
module.exports = function management({transaction,actor,scope,entityScope,current,unchanged,version,request,save,event}) {
  async function readable(db,who,type,entityId,lock=false) {
    const scoped=await entityScope(db,kind(type),id(entityId),lock);scope(who,scoped.departmentId);
    return scoped;
  }
  async function impact(db,type,entityId,head) {
    const counts={};
    const count=async(label,sql,args)=>{counts[label]=Number((await db.execute(sql+' FOR SHARE',args))[0][0].n);};
    if(type==='object') {
      await count('fields','SELECT COUNT(*) n FROM data_map_fields WHERE object_id=?',[entityId]);
      await count('live_fields',"SELECT COUNT(*) n FROM data_map_fields WHERE object_id=? AND status<>'archived'",[entityId]);
      await count('fixed_field_versions',`SELECT COUNT(*) n FROM data_map_definition_versions f JOIN data_map_definition_versions o ON o.version_id=f.object_version_id WHERE o.entity_type='object' AND o.entity_id=?`,[entityId]);
    } else {
      await count('system_links','SELECT COUNT(*) n FROM data_map_field_system_links WHERE field_id=?',[entityId]);
      await count('identity_records','SELECT COUNT(*) n FROM data_map_field_identities WHERE field_id=?',[entityId]);
      await count('conflicts','SELECT COUNT(*) n FROM mdm_field_conflicts WHERE field_id_a=? OR field_id_b=?',[entityId,entityId]);
      await count('quality_issues','SELECT COUNT(*) n FROM data_map_quality_issues WHERE field_id=?',[entityId]);
      await count('identifier_versions',`SELECT COUNT(DISTINCT o.version_id) n FROM data_map_definition_versions o
        JOIN data_map_definition_versions f ON f.entity_type='field' AND f.entity_id=?
        WHERE o.entity_type='object' AND JSON_CONTAINS(JSON_EXTRACT(o.definition_json,'$.unique_identifiers[*].field_version_ids[*]'),JSON_QUOTE(CAST(f.version_id AS CHAR)))`,[entityId]);
    }
    await count('source_mappings',`SELECT COUNT(*) n FROM data_map_source_mappings m JOIN data_map_definition_versions v ON v.version_id=m.platform_version_id WHERE v.entity_type=? AND v.entity_id=?`,[type,entityId]);
    await count('review_events',`SELECT COUNT(*) n FROM data_map_definition_events e JOIN data_map_definition_versions v ON v.version_id=e.version_id WHERE v.entity_type=? AND v.entity_id=? AND e.event_type<>'definition_saved'`,[type,entityId]);
    const [[factTable]]=await db.execute("SELECT COUNT(*) n FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_fact_requests'");
    if(Number(factTable.n))await count('fact_requests',`SELECT COUNT(*) n FROM data_map_fact_requests r JOIN data_map_definition_versions v ON v.version_id=r.subject_version_id JOIN data_map_definition_versions o ON o.version_id=r.object_version_id WHERE (v.entity_type=? AND v.entity_id=?) OR (?='object' AND o.entity_id=?)`,[type,entityId,type,entityId]);
    const [[mappingTable]]=await db.execute("SELECT COUNT(*) n FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_v7_mapping_versions'");
    if(Number(mappingTable.n))await count('v7_mapping_versions',`SELECT COUNT(*) n FROM data_map_v7_mapping_versions m JOIN data_map_definition_versions o ON o.version_id=m.object_version_id LEFT JOIN data_map_definition_versions f ON f.version_id=m.field_version_id WHERE (?='object' AND o.entity_id=?) OR (?='field' AND f.entity_id=?)`,[type,entityId,type,entityId]);
    return {counts,impact_digest:digest({type,entityId,revision:head.revision_no,counts}),revision_no:head.revision_no};
  }
  return {
    managementCapabilities(session) {return transaction(async db=>{
      const who=await actor(db,session);
      const [[dept]]=await db.execute("SELECT id FROM departments WHERE id=? AND status='active'",[who.departmentId]);
      const source_labels=Object.fromEntries(Object.entries(require('./masterDataTemplateProfile.json').sections).map(([type,columns])=>[type,Object.fromEntries(columns.map(c=>[c.key,c.label]))]));
      return {person_id:who.personId,department_id:who.departmentId,can_write:Boolean(dept&&!who.readOnly&&who.permissions.has('governance:draft-department')),can_check:!who.readOnly&&who.permissions.has('governance:structure-gate'),schema,groups,source_labels};
    });},
    listManagedObjects(session,{after=null,search=''}={}) {return transaction(async db=>{
      const who=await actor(db,session),cursor=page(after);
      if(!who.permissions.has('governance:read-global'))scope(who,who.departmentId);
      if(typeof search!=='string'||search.length>255)throw failure('DEFINITION_TEXT_INVALID');
      const params=[],where=[];
      if(!who.permissions.has('governance:read-global')){where.push('o.owner_dept_id=?');params.push(who.departmentId);}
      if(cursor){where.push('o.id>?');params.push(cursor);}
      if(search){where.push('LOCATE(?,o.object_name_cn)>0');params.push(search);}
      const [items]=await db.execute(`SELECT CAST(o.id AS CHAR) entity_id,o.object_name_cn name,o.status,CAST(o.owner_dept_id AS CHAR) department_id,
        h.revision_no,CAST(h.current_version_id AS CHAR) version_id FROM data_map_objects o LEFT JOIN data_map_definition_heads h ON h.entity_type='object' AND h.entity_id=o.id
        ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY o.id LIMIT 101`,params);
      return {items:items.slice(0,100),next:items.length>100?items[99].entity_id:null};
    });},
    managedDetail(session,type,entityId,{after=null}={}) {return transaction(async db=>{
      const who=await actor(db,session),scoped=await readable(db,who,type,entityId);
      const v=await current(db,type,entityId);unchanged(v,scoped.source);
      let fields=[],next=null;
      if(type==='object') {
        const cursor=page(after);
        const [found]=await db.execute(`SELECT CAST(f.id AS CHAR) entity_id,f.field_name_cn name,f.status,CAST(h.current_version_id AS CHAR) version_id,h.revision_no
          FROM data_map_fields f JOIN data_map_contexts c ON c.id=f.context_id LEFT JOIN data_map_definition_heads h ON h.entity_type='field' AND h.entity_id=f.id
          WHERE f.object_id=? ${who.permissions.has('governance:read-global')?'':'AND c.dept_id=?'} ${cursor?'AND f.id>?':''} ORDER BY f.id LIMIT 101`,[entityId,...(who.permissions.has('governance:read-global')?[]:[who.departmentId]),...(cursor?[cursor]:[])]);
        fields=found.slice(0,100);next=found.length>100?fields[99].entity_id:null;
      }
      return {current:v,fields,next};
    });},
    managedHistory(session,type,entityId,{before=null}={}) {return transaction(async db=>{
      const who=await actor(db,session);await readable(db,who,type,entityId);
      const cursor=page(before);
      const [items]=await db.execute(`SELECT CAST(version_id AS CHAR) version_id,version_no revision_no,CAST(created_by_person_id AS CHAR) actor_person_id,
        DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at FROM data_map_definition_versions WHERE entity_type=? AND entity_id=? ${cursor?'AND version_id<?':''} ORDER BY version_id DESC LIMIT 51`,[type,entityId,...(cursor?[cursor]:[])]);
      return {items:items.slice(0,50),next:items.length>50?items[49].version_id:null};
    });},
    saveManaged(session,payload) {return transaction(async db=>{
      if(!payload||Object.keys(payload).some(k=>!['entity_type','entity_id','expected_revision','object_id','object_version_id','definition','request_id'].includes(k)))throw failure('DEFINITION_PROPERTY_NOT_ALLOWED');
      if(Object.hasOwn(payload,'entity_id'))id(payload.entity_id);
      const who=await actor(db,session,'governance:draft-department'),type=kind(payload.entity_type);
      return request(db,who,'manage_definition',payload,async()=>{
        let previous=null,contextId=null;
        if(payload.entity_id){const s=await readable(db,who,type,payload.entity_id,true);scope(who,s.departmentId,true);previous=await current(db,type,payload.entity_id,true);contextId=s.source.row.context_id;}
        const definition=mergePatch(type,previous?.definition||{},payload.definition);
        if(type==='field') {
          const parent=await readable(db,who,'object',payload.object_id,true);scope(who,parent.departmentId,true);
          if(!contextId){
            const key='definition_object_'+id(payload.object_id);
            const [[existing]]=await db.execute('SELECT CAST(id AS CHAR) id,CAST(dept_id AS CHAR) dept_id FROM data_map_contexts WHERE context_key=? FOR UPDATE',[key]);
            if(existing){scope(who,existing.dept_id,true);contextId=existing.id;}
            else {await db.execute("INSERT INTO data_map_contexts(context_key,context_type,title,dept_id,status,created_by_person_id) VALUES (?,'manual',?,?,'draft',?)",[key,'对象字段维护 '+payload.object_id,who.departmentId,who.personId]);contextId=await lastId(db);}
          }
        }
        return save(db,session,{...payload,definition,request_id:crypto.randomUUID(),department_id:who.departmentId,...(type==='field'?{context_id:contextId}:{})});
      });
    });},
    retirementImpact(session,type,entityId) {return transaction(async db=>{
      const who=await actor(db,session);const s=await readable(db,who,type,entityId,true),head=await current(db,type,entityId,true);unchanged(head,s.source);
      return impact(db,type,id(entityId),head);
    });},
    retireManaged(session,type,entityId,payload) {return transaction(async db=>{
      kind(type);entityId=id(entityId);
      if(!payload||Object.keys(payload).some(k=>!['request_id','expected_revision','confirm','reason','impact_digest'].includes(k)))throw failure('DEFINITION_PROPERTY_NOT_ALLOWED');
      const who=await actor(db,session,'governance:draft-department');
      return request(db,who,'retire_definition',{...payload,entity_type:type,entity_id:entityId},async()=>{
        const scoped=await readable(db,who,type,entityId,true);scope(who,scoped.departmentId,true);
        const head=await current(db,type,entityId,true);unchanged(head,scoped.source);
        if(payload.expected_revision!==head.revision_no)throw failure('DEFINITION_REVISION_CONFLICT',409);
        // Draft facts can be withdrawn; this never substitutes for formal review.
        if(!((type==='object'?['draft','active']:['draft']).includes(scoped.source.row.status)))throw failure('DEFINITION_STATE_NOT_EDITABLE',409);
        if(payload.confirm!==true||typeof payload.reason!=='string'||!payload.reason.trim()||payload.reason.length>4096)throw failure('DEFINITION_RETIRE_CONFIRM_REQUIRED');
        const affected=await impact(db,type,entityId,head);
        if(payload.impact_digest!==affected.impact_digest)throw failure('DEFINITION_IMPACT_CHANGED',409);
        await db.execute(`UPDATE ${type==='object'?'data_map_objects':'data_map_fields'} SET status=? WHERE id=?`,[type==='object'?'inactive':'archived',entityId]);
        const source=await snapshot(db,type,entityId,true);
        const saved=await insertVersion(db,{type,entityId,revision:head.revision_no+1,parent:head.object_version_id,previous:head.version_id,definition:head.definition,source,sourceKind:'manual',actor:who.personId});
        await event(db,saved.version_id,'definition_saved',{action:'retire',reason:payload.reason.trim(),previous_version_id:head.version_id,impact:affected},who.personId);
        return {...saved,impact:affected,status:source.row.status};
      });
    });}
  };
};
module.exports.schema=schema;
