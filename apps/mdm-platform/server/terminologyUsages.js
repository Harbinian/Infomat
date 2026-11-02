const {randomUUID}=require('node:crypto');
const {enabled,fail,hash,text}=require('./terminologyGovernancePolicy');
const {currentActor}=require('./terminologyGovernanceAuthority');
const {inspectDepartmentAccountability,assertDepartmentAccountability,decisionEvidence,inspectCurrentDepartmentDecision}=require('./departmentAccountability');
const {sameIdentityInteger:same}=require('./sessionSubject');
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const one=async(db,sql,args=[])=> (await db.execute(sql,args))[0][0]||null;
const TYPES=new Set(['process_draft','process_version','work_package','handoff_revision','data_definition']);
function subject(value){
  if(!TYPES.has(value.target_type)||!/^([1-9]\d{0,18}|[0-9a-f-]{36})$/.test(String(value.target_id||'')))throw fail('USAGE_TARGET_INVALID','引用对象无效',422);
  return {target_type:value.target_type,target_id:String(value.target_id)};
}
function positions(value,path='',out=[]){
  if(typeof value==='string'&&value.trim()&&value.length<=10000)out.push({location:path,source_text:value,label:path});
  else if(Array.isArray(value))value.forEach((v,i)=>positions(v,path+'/'+i,out));
  else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value)){
    // Technical identities are preserved, and never presented as business terms.
    if(/(^id$|_id$|_ref$|_refs$|hash|digest|schema_version|system_field|physical_table)/i.test(k))continue;
    positions(v,path+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1'),out);
  }
  return out;
}
const positionLabels={process:'流程',process_name:'流程名称',scope:'适用范围',owner:'责任归属',actor:'办理信息',owning_department:'归口部门',capability_domain:'能力领域',business_capability:'业务能力',behaviors:'流程环节',behavior_name:'环节名称',behavior_description:'环节说明',current_actor_role:'执行角色',actor_position_rule:'岗位确定条件',timing:'办理时限',countersign_target_departments:'会签部门',flow_relations:'环节之间的办理关系',description:'说明',data_objects:'数据对象',data_name:'对象名称',fields:'字段',field_name:'字段名称',field_name_cn:'字段名称',forms:'表单或记录',form_name:'表单名称',form_no:'表单编号',document_title:'制度名称',document_no:'制度编号',areas:'表单区域',area_title:'区域名称',items:'填写项',item_name:'填写项名称',terms:'术语',term_name:'术语名称',term:'术语名称',definition:'定义',business_meaning:'业务含义',name:'名称',title:'标题',label:'名称',purpose:'用途',reason:'依据',basis:'依据',basis_text:'依据',notes:'备注',note:'说明',instructions:'填写说明',candidate_json:'待核对内容',governance_json:'治理意见',details:'治理事项',source:'依据来源',authority_suggestion:'权威来源建议',governance:'治理意见',formation:'如何形成',maintenance:'如何维护',usage:'如何使用',storage:'如何保管',unique_identifiers:'记录识别依据',pending:'待明确事项',enum_values:'允许填写的值',data_format:'数据格式',length_precision:'长度与精度',identifier_role:'识别作用',source_links:'相关来源',source_relations:'外部来源',source_department:'来源部门',source_process_name:'来源流程',source_behavior_name:'来源环节',source_data_name:'来源数据对象',source_system_name:'来源系统',behavior_links:'数据在哪些环节使用',lifecycle:'数据使用规则',decision_notes:'判断说明',decision_reason:'判断依据',events:'数据使用事项',trigger:'触发条件',precondition:'前置条件',completion_standard:'完成标准',input_description:'输入说明',output_description:'输出说明',condition:'办理条件',responsibility:'责任说明',responsibilities:'责任说明',exception_handling:'异常处理',business_validity:'业务有效条件',custody:'保管要求',context:'适用语境'};
const nonTermField=/(?:^|_)(?:id|ids|ref|refs|hash|digest|revision|schema|token|uuid|code|pointer|manifest|request|checksum)(?:_|$)|^(?:system_field|physical_table|path|source_path|file_name|source_file_name|original_name|created_at|updated_at|effective_at|status|state|stage|operation|operations|type|kind|detail_type|field_type|data_type|node_type|area_type|item_type|source_type|source_kind|relation_type|record_scope|record_model|presence|mode|scope_mode|source_role|actor_assignment_mode|join_mode|availability_mode|information_type|sensitivity|masking|value_usage_mode|value_origin_mode|identifiability_applicability|operator|entry_state|exit_state|result_state|form_design_state|classification_status|conversion_status)$/i;
const readableName=value=>typeof value==='string'&&value.trim()&&!/^(?:\d+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)$|\/api\/|^[/.]|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[0-9a-f]{40,}\b|[<>]/i.test(value)?value.trim():'';
// Only the read projection changes. Validation still accepts exact legacy
// positions so an existing judgment is never silently dropped or rebound.
function businessPositions(value,path='',out=[],crumbs=[]){
  if(typeof value==='string'&&value.trim()&&value.length<=10000){
    if(/^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)+|[0-9a-f]{40,}|[0-9a-f]{8}-[0-9a-f-]{27,})$|\/api\/|^(?:GET|POST|PATCH|PUT|DELETE)\s+\/|(?:^|\s)(?:\/[a-z_][a-z0-9_.~-]*){2,}|(?:^|\s)[a-z_]+\[\d+\](?:\.[a-z_]+)+|\b[a-z0-9_-]+\.(?:jsx?|tsx?|cjs|mjs|json|sql)\b|<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*)?\/?\s*>|\bfunction\s+[a-z_$][\w$]*\s*\(|=>/i.test(value.trim()))return out;
    out.push({location:path,source_text:value,label:crumbs.join(' → ')||'业务内容'});return out;
  }
  if(Array.isArray(value)){value.forEach((item,index)=>businessPositions(item,path+'/'+index,out,crumbs));return out;}
  if(!value||typeof value!=='object')return out;
  const name=['process_name','behavior_name','data_name','field_name_cn','field_name','form_name','area_title','item_name','term_name','term','name','title','label'].map(key=>readableName(value[key])).find(Boolean);
  const context=name?[...crumbs,'“'+name+'”']:crumbs;
  for(const [key,item] of Object.entries(value)){
    // Export metadata describes transport, not source business wording. Skip
    // the whole branch; legacy validation and saved judgments stay exact.
    if(key==='export_meta'||nonTermField.test(key))continue;
    const label=positionLabels[key];
    // Unrecognized business fields remain available without exposing their
    // internal key. The original path and wording still identify the source.
    businessPositions(item,path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),out,[...context,label||'相关业务内容']);
  }
  return out;
}
async function ready(db){
  if(!enabled())throw fail('DISABLED','统一术语治理尚未开启',503);
  const row=await one(db,'SELECT migration_key FROM schema_migrations WHERE migration_key=?',[require('./terminologyGovernanceSchema').MIGRATION_KEY]);
  if(!row)throw fail('SCHEMA_REQUIRED','统一术语治理结构尚未准备',503);
  for(const table of require('./terminologyUsageSchema').TABLES)await db.execute('SELECT target_type,target_id,revision_no FROM '+table+' LIMIT 0');
}
async function loadTarget(db,input,lock=false){
  // This module never mutates its source rows. Shared locking reads prevent a
  // source rewrite until the usage transaction commits, without UPDATE grants
  // on immutable process/definition/revision rows or read-only review sources.
  const s=subject(input),suffix=lock?' FOR SHARE':'';let row,body,departmentId=null,packageId=null,fixed=false;
  if(s.target_type.startsWith('process_')){
    const draft=s.target_type==='process_draft';
    row=await one(db,`SELECT *,CAST(id AS CHAR) id,CAST(${draft?'id':'draft_id'} AS CHAR) source_draft_id,CAST(department_id AS CHAR) department_id FROM ${draft?'process_design_drafts':'process_design_versions'} WHERE id=?${suffix}`,[s.target_id]);
    if(!row)throw fail('USAGE_TARGET_NOT_FOUND','流程材料不存在',404);
    body=parse(row.process_content_json);departmentId=row.department_id;fixed=!draft||row.status==='published';
  }else if(s.target_type==='work_package'){
    row=await one(db,'SELECT *,CAST(id AS CHAR) id,CAST(process_version_id AS CHAR) process_version_id,CAST(owning_department_id AS CHAR) department_id FROM process_data_governance_work_packages WHERE id=?'+suffix,[s.target_id]);
    if(!row)throw fail('USAGE_TARGET_NOT_FOUND','治理工作包不存在',404);
    const [details]=await db.execute('SELECT CAST(id AS CHAR) id,detail_type,status,candidate_json,governance_json,revision_no FROM process_data_governance_details WHERE work_package_id=? ORDER BY id'+(lock?' FOR SHARE':''),[s.target_id]);
    body={process_version_id:String(row.process_version_id),details:details.map(d=>({...d,candidate_json:parse(d.candidate_json),governance_json:parse(d.governance_json)}))};departmentId=row.department_id;packageId=row.id;fixed=row.status==='completed';
  }else if(s.target_type==='handoff_revision'){
    row=await one(db,'SELECT r.*,CAST(d.package_id AS CHAR) package_id,d.state FROM data_map_handoff_revisions r JOIN data_map_handoff_drafts d ON d.handoff_id=r.handoff_id WHERE r.revision_id=?'+suffix,[s.target_id]);
    if(!row)throw fail('USAGE_TARGET_NOT_FOUND','数据交接修订不存在',404);
    body=parse(row.snapshot_json);packageId=String(row.package_id);fixed=row.state==='published';
  }else{
    row=await one(db,'SELECT *,CAST(version_id AS CHAR) version_id,CAST(entity_id AS CHAR) entity_id FROM data_map_definition_versions WHERE version_id=?'+suffix,[s.target_id]);
    if(!row)throw fail('USAGE_TARGET_NOT_FOUND','数据定义版本不存在',404);
    // Definition rows are immutable; new references enter through the current
    // work package/handoff and are pinned together with its publication.
    body=parse(row.definition_json);fixed=true;
    const head=await one(db,'SELECT CAST(current_version_id AS CHAR) current_version_id FROM data_map_definition_heads WHERE entity_type=? AND entity_id=?',[row.entity_type,row.entity_id]);
    if(head?.current_version_id!==s.target_id)fixed=true;
    const table=row.entity_type==='object'?'data_map_objects':'data_map_fields';
    const source=await one(db,`SELECT CAST(${row.entity_type==='object'?'owner_dept_id':'(SELECT dept_id FROM data_map_contexts WHERE id=context_id)'} AS CHAR) department_id FROM ${table} WHERE id=?`,[row.entity_id]);
    departmentId=source?.department_id;
  }
  if(!body)throw fail('USAGE_SOURCE_INVALID','引用来源正文缺失',409);
  const source_digest=s.target_type==='work_package'?hash(body):row.content_hash||row.content_digest||hash(body);
  if(s.target_type!=='work_package'&&hash(body)!==source_digest)throw fail('USAGE_SOURCE_CORRUPT','来源正文与固定摘要不一致，不能确认引用',409);
  return {...s,row,body,departmentId,packageId,fixed,source_digest,source_positions:positions(body)};
}
async function authority(db,session,target,write=false){
  const who=await currentActor(db,session,write);
  if(target.packageId){
    const scope=require('./processDataGovernanceScope');
    const unavailable=!scope.isProcessDataGovernanceEnabled()||scope.isProcessDataGovernanceReadOnly();
    if(write){
      scope.assertProcessDataGovernanceEnabled();scope.assertProcessDataGovernanceWritable();
      if(target.target_type==='handoff_revision'){
        require('./dataMapHandoffPolicy').writable(process.env);
        if((await require('./dataMapHandoffControl').readControl(db)).cutover_state!=='controlled')throw fail('USAGE_HANDOFF_MAINTENANCE','数据交接尚未处于受控办理状态',409);
      }
    }else if(unavailable&&target.target_type==='work_package'&&target.row.status!=='completed')throw fail('USAGE_SCOPE_DENIED','当前仅可查阅已完成的治理工作包',403);
    const action=write?'prepare':'read';
    const actor=await require('./dataMapHandoffAuthority').handoffActor(db,session,action,{packageId:target.packageId,lock:write,writeFields:write?['terminology_references']:undefined});
    const handoffOpen=target.target_type!=='handoff_revision'||process.env.DATA_MAP_HANDOFF_ENABLED==='1';
    return {...who,allowed:!unavailable&&handoffOpen&&!target.fixed&&(write||['mdm_lead','mdm_steward'].includes(actor.roleCode)),canConfirm:false,actor};
  }
  if(write&&target.target_type.startsWith('process_')&&process.env.PROCESS_V7_FORMAL_ENABLED!=='1')throw fail('USAGE_FORMAL_DISABLED','正式流程办理尚未开启',503);
  const scoped=same(who.departmentId,target.departmentId);
  const final=scoped&&!who.readOnly?await inspectDepartmentAccountability(db,who,target.departmentId,{lock:write}):{eligible:false};
  let assigned=false;
  if(who.steward&&target.target_type.startsWith('process_')){
    const promotion=await one(db,'SELECT CAST(preview_case_id AS CHAR) preview_case_id FROM process_v7_promotions WHERE draft_id=? ORDER BY id DESC LIMIT 1'+(write?' FOR SHARE':''),[target.row.source_draft_id]);
    if(promotion)assigned=await require('./governanceResponsibilities').hasAssignedResponsibility(db,session,'case',promotion.preview_case_id,'steward');
  }
  const reader=who.readOnly||who.lead||who.globalRead||scoped&&(who.contact||final.eligible)||assigned;
  if(!reader)throw fail('USAGE_SCOPE_DENIED','当前身份不能读取该材料的术语核对记录',403);
  const open=target.target_type==='process_draft'&&process.env.PROCESS_V7_FORMAL_ENABLED==='1';
  return {...who,operator:who.lead||who.steward&&assigned,finalResponsible:final.eligible,allowed:open&&!target.fixed&&scoped&&who.contact,canConfirm:open&&!target.fixed&&final.eligible};
}
async function readHead(db,target,lock=false){return one(db,'SELECT * FROM tg_usage_heads WHERE target_type=? AND target_id=?'+(lock?' FOR UPDATE':''),[target.target_type,target.target_id]);}
async function resolve(db,id,versionId){return require('./terminologyGovernanceRepository').resolveTerm(db,id,{versionId,lock:true});}
async function inspectItems(db,items){
  const findings=[];
  for(const item of items||[]){
    if(item.decision==='conflict')findings.push({code:'SUBSTANTIVE_CONFLICT',location:item.location,message:'已人工确认存在同语境实质矛盾，须处理后重新核对'});
    if(!item.term_id)continue;
    const term=await resolve(db,item.term_id,item.version_id);
    if(!term||!term.usable||term.version_id!==item.version_id||term.usage_token!==item.usage_token)findings.push({code:'TERM_CHANGED',location:item.location,message:'本次采用的术语内容或可用状态已变化，须重新核对该处引用'});
    if(item.decision==='synonym'&&term&&item.source_text!==term.term)findings.push({code:'CANONICAL_NAME_REQUIRED',location:item.location,message:'已确认同义，须由业务人员将新材料规范名称改为：'+term.term});
  }
  return findings;
}
async function inspect(db,target,{required=false,department=false}={}){
  await ready(db);const head=await readHead(db,target,true);
  if(!head){return {head:null,items:[],findings:required?[{code:'REVIEW_REQUIRED',message:'须明确核对本次关键概念；无适用词条可按业务定义记录未收录'}]:[]};}
  const snapshot=parse(head.snapshot_json),items=snapshot.items||[],findings=[];
  if(!Number(head.fixed)){
    if(head.source_digest!==target.source_digest)findings.push({code:'SOURCE_CHANGED',message:'材料正文已变化，须核对受影响位置后重新保存'});
    findings.push(...await inspectItems(db,items));
    if(department){
      const receipt=parse(head.confirmation_json);
      if(!receipt||receipt.revision_no!==Number(head.revision_no)||receipt.source_digest!==target.source_digest)findings.push({code:'DEPARTMENT_CONFIRMATION_REQUIRED',message:'须取得本次术语核对的部门负责人确认'});
      else{
        const status=await inspectCurrentDepartmentDecision(db,target.departmentId,receipt.evidence,{sourceRevision:Number(head.revision_no),sourceHash:target.source_digest,lock:true});
        if(!status.valid)findings.push({code:'DEPARTMENT_CONFIRMATION_STALE',message:'部门最终负责人资格已变化，须重新确认'});
      }
    }
  }
  return {head,items,reason:snapshot.reason||'',findings};
}
async function event(db,t,revision,actor,type,snapshot){await db.execute('INSERT INTO tg_usage_events(event_id,target_type,target_id,revision_no,actor_person_id,event_type,snapshot_json) VALUES(?,?,?,?,?,?,?)',[randomUUID(),t.target_type,t.target_id,revision,actor||null,type,JSON.stringify(snapshot)]);}
async function gate(db,t,{department=false}={}){
  if(!enabled())return null;
  const state=await inspect(db,t,{required:true,department});
  if(state.findings.length)throw Object.assign(fail('USAGE_REVIEW_REQUIRED','术语核对尚未完成，请处理受影响部分',409),{findings:state.findings});
  return state;
}
async function pin(db,from,to,actor,{items=null}={}){
  if(!enabled())return;
  const head=await readHead(db,from,true);
  if(!head)throw fail('USAGE_REVIEW_REQUIRED','缺少发布所依据的术语核对记录');
  const snapshot=parse(head.snapshot_json);if(items)snapshot.items=items;
  const existing=await readHead(db,to,true);
  if(existing)throw fail('USAGE_FIXED_EXISTS','正式版本已存在固定术语引用');
  await db.execute('INSERT INTO tg_usage_heads(target_type,target_id,revision_no,source_digest,snapshot_json,confirmation_json,fixed) VALUES(?,?,1,?,?,?,1)',[to.target_type,String(to.target_id),to.source_digest,JSON.stringify(snapshot),head.confirmation_json?JSON.stringify(parse(head.confirmation_json)):null]);
  await event(db,to,1,actor,'fixed',{...snapshot,source:{target_type:from.target_type,target_id:from.target_id,revision_no:head.revision_no}});
}
async function freeze(db,target,actor){
  if(!enabled())return;
  const state=await gate(db,target);
  await db.execute('UPDATE tg_usage_heads SET fixed=1 WHERE target_type=? AND target_id=?',[target.target_type,target.target_id]);
  await event(db,target,Number(state.head.revision_no),actor,'fixed',parse(state.head.snapshot_json));
}
function makeTerminologyUsages(pool){
  const tx=async work=>{const db=await pool.getConnection();let committing=false;try{await db.beginTransaction();const result=await work(db);committing=true;await db.commit();return result;}catch(e){if(!committing)await db.rollback().catch(()=>{});else if(!e.code?.startsWith('TERM_GOVERNANCE_'))throw fail('COMMIT_UNKNOWN','提交回执不明，请保留原请求标识并核对',503);throw e;}finally{db.release();}};
  async function read(session,input){return tx(async db=>{await ready(db);const t=await loadTarget(db,input,true),who=await authority(db,session,t),state=await inspect(db,t);
    return {enabled:true,...subject(t),source_digest:t.source_digest,source_positions:businessPositions(t.body),revision_no:Number(state.head?.revision_no||0),items:state.items,reason:state.reason||'',findings:state.findings,fixed:t.fixed||Boolean(Number(state.head?.fixed)),department_confirmed:Boolean(state.head?.confirmation_json),allowed_actions:[...(who.allowed?['save']:[]),...(who.canConfirm?['department_confirm']:[])]};});}
  async function write(session,input,confirm=false){return tx(async db=>{
    await ready(db);
    if(['work_package','handoff_revision'].includes(input.target_type)){
      // Match native/handoff mutation order: graph control precedes package,
      // source and usage locks, so a concurrent publication cannot invert it.
      await require('./dataMapHandoffControl').lockGraph(db);
    }
    const t=await loadTarget(db,input,true),who=await authority(db,session,t,true);
    if(t.fixed||!(confirm?who.canConfirm:who.allowed))throw fail('USAGE_WRITE_DENIED','当前身份或材料状态不能办理该术语核对动作',403);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input.request_id||'')))throw fail('REQUEST_ID_REQUIRED','请提供本次请求标识',422);
    const fingerprint=hash({subject:subject(t),input,confirm}),prior=await one(db,'SELECT request_hash,response_json FROM tg_requests WHERE actor_person_id=? AND request_id=? FOR UPDATE',[who.personId,input.request_id]);
    if(prior){if(prior.request_hash!==fingerprint)throw fail('REQUEST_CONFLICT','同一请求标识已用于不同内容');return parse(prior.response_json);}
    const head=await readHead(db,t,true),revision=Number(head?.revision_no||0);
    if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision!==revision||input.source_digest!==t.source_digest)throw fail('USAGE_STALE','材料正文或核对修订已变化，草稿已保留，请刷新核对',409);
    let snapshot,receipt=null;
    if(confirm){
      const state=await inspect(db,t,{required:true});if(state.findings.length)throw fail('USAGE_REVIEW_REQUIRED','请先处理当前术语核对问题');
      const qualification=await assertDepartmentAccountability(db,who,t.departmentId,{lock:true});snapshot=parse(head.snapshot_json);
      receipt={revision_no:revision+1,source_digest:t.source_digest,evidence:decisionEvidence(qualification,{sourceRevision:revision+1,sourceHash:t.source_digest}),confirmed_at:new Date().toISOString()};
    }else{
      if(!Array.isArray(input.items)||input.items.length>500)throw fail('USAGE_INPUT_INVALID','核对项格式无效',422);
      const map=new Map(t.source_positions.map(p=>[p.location,p.source_text])),seen=new Set(),items=[];
      for(const i of input.items){
        if(!map.has(i.location)||map.get(i.location)!==i.source_text||seen.has(i.location))throw fail('USAGE_LOCATION_INVALID','引用位置、原文或重复项与当前来源不符',422);seen.add(i.location);
        if(!['match','synonym','conflict','unlisted','not_applicable'].includes(i.decision)||!text(i.reason))throw fail('USAGE_REASON_REQUIRED','请选择人工核对结论并说明依据',422);
        const item={location:i.location,source_text:i.source_text,decision:i.decision,reason:text(i.reason)};
        if(['match','synonym','conflict'].includes(i.decision)){
          const term=await resolve(db,i.term_id,i.version_id);
          if(!term||!term.usable||term.version_id!==i.version_id)throw fail('USAGE_TERM_UNAVAILABLE','所选术语版本当前不能供新材料采用');
          Object.assign(item,{term_id:term.term_id,version_id:term.version_id,usage_token:term.usage_token,term_snapshot:term});
        }else if(i.term_id||i.version_id)throw fail('USAGE_INPUT_INVALID','未收录及不适用项不能携带术语引用',422);
        items.push(item);
      }
      if(!items.length&&!text(input.reason))throw fail('USAGE_REASON_REQUIRED','无关键概念时请明确说明本次核对范围和结论',422);
      snapshot={items,reason:text(input.reason),recorded_by:who.personId,recorded_at:new Date().toISOString()};
    }
    await db.execute('INSERT INTO tg_usage_heads(target_type,target_id,revision_no,source_digest,snapshot_json,confirmation_json,fixed) VALUES(?,?,?,?,?,?,0) ON DUPLICATE KEY UPDATE revision_no=VALUES(revision_no),source_digest=VALUES(source_digest),snapshot_json=VALUES(snapshot_json),confirmation_json=VALUES(confirmation_json)',[t.target_type,t.target_id,revision+1,t.source_digest,JSON.stringify(snapshot),receipt?JSON.stringify(receipt):null]);
    await event(db,t,revision+1,who.personId,confirm?'department_confirm':'record',snapshot);
    const response={ok:true,revision_no:revision+1,source_digest:t.source_digest};
    await db.execute('INSERT INTO tg_requests(actor_person_id,request_id,request_hash,response_json) VALUES(?,?,?,?)',[who.personId,input.request_id,fingerprint,JSON.stringify(response)]);return response;
  });}
  const mayDispose=who=>Boolean(!who.readOnly&&(who.operator||who.lead||who.finalResponsible||['mdm_lead','mdm_steward'].includes(who.actor?.roleCode)));
  async function impact(session,input){return tx(async db=>{
    await ready(db);const t=await loadTarget(db,input,true),who=await authority(db,session,t,true);
    if(!mayDispose(who))throw fail('USAGE_IMPACT_DENIED','须由有权责任方或受派MDM经办记录影响处置',403);
    if(!['no_change','later_revision','address_now'].includes(input.decision)||!text(input.reason))throw fail('USAGE_IMPACT_INVALID','请选择处置结论并记录依据',422);
    if(!/^[0-9a-f-]{36}$/i.test(String(input.request_id||'')))throw fail('REQUEST_ID_REQUIRED','请提供请求标识',422);
    const head=await readHead(db,t,true),fingerprint=hash({action:'impact',input});
    const old=await one(db,'SELECT request_hash,response_json FROM tg_requests WHERE actor_person_id=? AND request_id=? FOR UPDATE',[who.personId,input.request_id]);
    if(old){if(old.request_hash!==fingerprint)throw fail('REQUEST_CONFLICT','同一请求标识已用于不同内容');return parse(old.response_json);}
    if(!head||!Number.isSafeInteger(input.expected_revision)||Number(head.revision_no)!==input.expected_revision||input.source_digest!==head.source_digest)throw fail('USAGE_STALE','引用基线已变化，请核对后再记录影响处置');
    const refs=(parse(head.snapshot_json).items||[]).filter(i=>i.term_id===input.term_id);
    if(!refs.length)throw fail('USAGE_IMPACT_INVALID','该材料没有引用所选词条',422);
    const term=await resolve(db,input.term_id);
    const record={term_id:input.term_id,decision:input.decision,reason:text(input.reason),referenced_versions:[...new Set(refs.map(i=>i.version_id))],current_usage_token:term?.usage_token||null,actor_person_id:who.personId,recorded_at:new Date().toISOString()};
    await event(db,t,Number(head.revision_no),who.personId,'impact_disposition',record);
    const response={ok:true,record};await db.execute('INSERT INTO tg_requests(actor_person_id,request_id,request_hash,response_json) VALUES(?,?,?,?)',[who.personId,input.request_id,fingerprint,JSON.stringify(response)]);return response;
  });}
  async function reverse(session,termId){return tx(async db=>{await ready(db);await currentActor(db,session);const [rows]=await db.execute("SELECT target_type,target_id,revision_no,source_digest,snapshot_json,fixed FROM tg_usage_heads WHERE JSON_CONTAINS(snapshot_json,JSON_OBJECT('term_id',?),'$.items') ORDER BY target_type,target_id",[termId]);const items=[];
    for(const row of rows){if(!(parse(row.snapshot_json).items||[]).some(i=>i.term_id===termId))continue;const t=await loadTarget(db,row);try{await authority(db,session,t);}catch(e){if(e.statusCode===403)continue;throw e;}
      let impact_allowed=false;try{impact_allowed=mayDispose(await authority(db,session,t,true));}catch(e){if(!e.statusCode)throw e;}
      const [events]=await db.execute("SELECT snapshot_json FROM tg_usage_events WHERE target_type=? AND target_id=? AND event_type='impact_disposition' ORDER BY created_at,event_id",[row.target_type,row.target_id]);
      items.push({...row,snapshot_json:undefined,items:parse(row.snapshot_json).items.filter(i=>i.term_id===termId),impact_allowed,impact_decisions:events.map(e=>parse(e.snapshot_json)).filter(e=>e.term_id===termId)});
    }return {items};});}
  return {read,save:(session,input)=>write(session,input),action:(session,input)=>{if(input.action!=='department_confirm')throw fail('ACTION_INVALID','引用动作无效',422);return write(session,input,true);},reverse,impact};
}
module.exports={makeTerminologyUsages,loadTarget,positions,businessPositions,inspectItems,inspect,gate,pin,freeze,ready,subject};
