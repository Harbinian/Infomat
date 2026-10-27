// Joint real HTTP/MySQL proof, using only an owned tmpfs target. Authenticated
// session establishment is synthetic; routes, identity, permissions, gates and
// transactions are real. This is technical coverage, never business acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Module=require('node:module');
const root=path.resolve(__dirname,'..'),candidateAt=process.argv.indexOf('--candidate-root');
const candidateRoot=candidateAt<0?root:path.resolve(process.argv[candidateAt+1]);
const modelAt=process.argv.indexOf('--role-model-root'),roleModelRoot=modelAt<0?candidateRoot:path.resolve(process.argv[modelAt+1]);
assert(candidateRoot===root||candidateRoot.startsWith(path.resolve(root,'../../artifacts')+path.sep));
if(candidateRoot!==root){
  process.env.NODE_PATH=[path.join(root,'node_modules'),process.env.NODE_PATH||''].filter(Boolean).join(path.delimiter);Module._initPaths();
  const original=Module._resolveFilename;
  Module._resolveFilename=function(request,parent,...args){
    const resolved=original.call(this,request,parent,...args);
    if(typeof resolved==='string'&&['server','shared'].some(name=>resolved.startsWith(path.join(root,name)+path.sep))){
      const candidate=path.join(candidateRoot,path.relative(root,resolved));if(fs.existsSync(candidate))return candidate;
    }
    return resolved;
  };
}
if(roleModelRoot!==candidateRoot){
  assert(roleModelRoot.startsWith(path.resolve(root,'../../artifacts')+path.sep));
  const local=path.join(root,'server/roleDefinitions.js'),selected=path.join(roleModelRoot,'server/roleDefinitions.js');
  const exports=require(selected);require.cache[local]={id:local,filename:selected,loaded:true,exports};
}
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {fixture}=require('./testHelpers/terminologyFrontendFixture');
const {draftBody}=require('./testHelpers/dataMapHandoffFixture');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {plan}=require('./prepare-governance-runtime-grants');
const settings={MDM_IDENTITY_READ_MODEL:'mysql',TERMINOLOGY_GOVERNANCE_ENABLED:'1',PROCESS_V7_FORMAL_ENABLED:'1',PROCESS_V7_PREVIEW_ENABLED:'1',PROCESS_DATA_GOVERNANCE_ENABLED:'1',DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'};Object.assign(process.env,settings);
const outputAt=process.argv.indexOf('--output'),output=outputAt<0?path.resolve(root,'../../artifacts/joint-terminology-handoff-'+crypto.randomUUID()):path.resolve(process.argv[outputAt+1]);
assert(output.startsWith(path.resolve(root,'../../artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const request=body=>({request_id:crypto.randomUUID(),...body}),checks=[],exchanges=[];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const model=require('../server/roleDefinitions').ACCESS_MODEL_VERSION;
async function check(name,work){await work();checks.push({name,passed:true});console.log('PASS '+name);}
async function main(){await withFreshMysql(async target=>{
  let runtimePool;
  const writePlan=plan(candidateRoot,{includeProcessGovernance:false}),f=await fixture(target,{jointHandoff:true,runtimePoolFactory:async source=>{
    const password=crypto.randomBytes(24).toString('hex');await source.pool.query("CREATE USER 'joint_governance_runtime'@'%' IDENTIFIED BY ?",[password]);
    await source.pool.execute(`GRANT SELECT ON ${source.database}.* TO 'joint_governance_runtime'@'%'`);
    for(const table of writePlan.enabled_period.tables)await source.pool.execute(`GRANT ${table.privileges.join(',')} ON ${source.database}.${table.table} TO 'joint_governance_runtime'@'%'`);
    for(const item of writePlan.locking_read_prerequisites)await source.pool.execute(`GRANT UPDATE (${item.columns.map(column=>'`'+column+'`').join(',')}) ON ${source.database}.${item.table} TO 'joint_governance_runtime'@'%'`);
    runtimePool=require('mysql2/promise').createPool({host:'127.0.0.1',port:source.port,user:'joint_governance_runtime',password,database:source.database,connectionLimit:4});return runtimePool;
  }});
  try{
    await target.pool.execute("INSERT INTO data_map_contexts(id,context_key,title,dept_id) VALUES(11,'JOINT-LEGACY-CONTEXT','合成原上下文',91)");
    await target.pool.execute("INSERT INTO data_map_fields(id,context_id,object_id,field_key,field_name_cn) VALUES(21,11,301,'JOINT-LEGACY-FIELD','合成原字段')");
    await target.pool.execute("INSERT INTO data_map_field_identities(field_id,confirmed,status) VALUES(21,1,'confirmed')");
    await f.base.packageSeed(702);
    const csrf=(await(await fetch(f.url+'/api/csrf-token',{headers:{'x-synthetic-role':'lead'}})).json()).csrfToken;
    async function call(role,url,method='GET',body,status=200){
      const response=await fetch(f.url+url,{method,headers:{'x-synthetic-role':role,'x-csrf-token':csrf,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
      const value=await response.json();exchanges.push({role,url,method,status:response.status,code:value.code||null});assert.equal(response.status,status,role+' '+method+' '+url+' '+JSON.stringify(value));return value;
    }
    const terms='/api/terminology-governance';
    await check('all governance flags operate on the exact supported access model with table-level INSERT/UPDATE and no DDL/DELETE',async()=>{
      assert([require('../server/accessModelV4Baseline').ACCESS_MODEL_VERSION,require('../server/roleDefinitions').ACCESS_MODEL_VERSION].includes(model));
      assert.equal((await call('contact',terms+'/capabilities')).ready,true);
      const capability=await call('lead','/api/data-map-handoffs/capabilities');assert.equal(capability.enabled,true);assert.equal(capability.schema_ready,true);
      const [grants]=await runtimePool.query('SHOW GRANTS');assert(!JSON.stringify(grants).match(/\b(?:DELETE|CREATE|ALTER|DROP|GRANT OPTION)\b/i));
    });
    let termId,termVersion;
    await check('actual HTTP term contact submission, current department head confirmation and MDM adoption work with admin overlap denied',async()=>{
      const body=request({term:'联合合成设备',definition:'合成采购设备定义',context:'合成采购语境',source_kind:'custom',reason:'合成联合办理依据'});
      await call('admin',terms+'/terms','POST',body,403);await call('employee',terms+'/terms','POST',body,403);
      const created=await call('contact',terms+'/terms','POST',{...body,request_id:crypto.randomUUID()});termId=created.term_id;
      for(const [actor,action,extra]of [['contact','submit',{}],['head','department_confirm',{}],['lead','source_check',{verified:true}],['lead','adopt',{}]]){
        const detail=await call('contact',terms+'/terms/'+termId);await call(actor,terms+'/terms/'+termId+'/actions','POST',request({expected_revision:detail.revision_no,action,reason:'合成明确办理依据',...extra}));
      }
      const current=await call('employee',terms+'/terms/'+termId);assert.equal(current.usable,true);termVersion=current.version_id;
    });
    await check('legacy terminology methods and old data projection methods stay sealed under the fully enabled combination',async()=>{
      for(const [url,method]of [['/api/terminology','POST'],['/api/terminology/1','PUT'],['/api/terminology/1','DELETE']])await call('contact',url,method,{},409);
      const writes=[['/api/data-map-definitions/save','POST',{entity_type:'object',entity_id:'301',request_id:crypto.randomUUID(),expected_revision:1,definition:{name:'合成拒绝旧写'}}],['/api/data-map-definitions/retire/object/301','POST',{request_id:crypto.randomUUID(),expected_revision:1,confirm:true,reason:'合成拒绝旧停用',impact_digest:'0'.repeat(64)}],['/api/field-entries','POST',{context_id:11,field_name_cn:'合成拒绝旧新增'}],['/api/field-entries/21','PUT',{field_name_cn:'合成拒绝旧修改'}],['/api/field-entries/21','DELETE',{}],['/api/field-identities/21','PUT',{note:'合成拒绝身份修改'}],['/api/field-identities/21/confirm','POST',{},'head'],['/api/data-map/contexts','POST',{title:'合成拒绝上下文',dept_id:91}],['/api/data-map/contexts/11','PUT',{title:'合成拒绝上下文'}]];
      for(const [url,method,body,actor='contact']of writes){const result=await call(actor,url,method,body,409);assert.equal(result.code,'HANDOFF_REQUIRED');}
      const old=await call('lead','/api/data-map-definitions/version/9007199254741001');assert.equal(old.definition.name,'Legacy original');assert.equal(old.referenceable,false);
    });
    let draft,approval;
    await check('real HTTP completed-package intake and exact source review create an unapproved draft with terminology gate blocking publication',async()=>{
      const intake=await call('steward','/api/data-map-handoffs/work-packages/702/intakes','POST',request({expected_revision:0}));
      const reviewed=await call('lead','/api/data-map-handoffs/intakes/'+intake.intake_id+'/reviews','POST',request({expected_revision:1,basis:'合成准确来源核对',detail_evidence:intake.required_detail_evidence.map(detail=>({...detail,basis:'合成逐项依据',evidence_refs:['synthetic:joint:evidence']}))}));
      const body=draftBody();body.items.find(item=>item.item_ref==='object').definition.name='联合合成设备';
      draft=await call('steward','/api/data-map-handoffs/from-work-packages/702','POST',request({expected_revision:0,binding_id:reviewed.binding_id,draft:body}));
      const checked=await call('lead','/api/data-map-handoffs/'+draft.handoff_id+'/checks','POST',request({expected_revision:draft.revision}));assert.equal(checked.report.ready_for_approval,false);
      assert.equal(Number((await runtimePool.execute('SELECT COUNT(*) n FROM data_map_publications'))[0][0].n),0);
    });
    await check('real HTTP terminology review enables approval only for the accurate immutable handoff revision',async()=>{
      const subject={target_type:'handoff_revision',target_id:draft.revision_id},read=await call('lead',terms+'/usages?target_type=handoff_revision&target_id='+draft.revision_id);
      const input=request({...subject,source_digest:read.source_digest,expected_revision:0,reason:'已核对其他定义，未发现须统一的已收录概念',items:[{location:'/items/0/definition/name',source_text:'联合合成设备',term_id:termId,version_id:termVersion,decision:'match',reason:'合成同一语境及概念明确'}]});
      await call('admin',terms+'/usages','POST',input,403);await call('lead',terms+'/usages','POST',{...input,request_id:crypto.randomUUID()});
      draft=await call('steward','/api/data-map-handoffs/'+draft.handoff_id+'/submit','POST',request({expected_revision:draft.revision}));
      const submitted=await call('lead',terms+'/usages?target_type=handoff_revision&target_id='+draft.revision_id);
      if(submitted.revision_no===0)await call('lead',terms+'/usages','POST',request({...input,target_id:draft.revision_id,source_digest:submitted.source_digest,expected_revision:0,reason:'明确核对提交后的准确修订',items:input.items}));
      const checked=await call('lead','/api/data-map-handoffs/'+draft.handoff_id+'/checks','POST',request({expected_revision:draft.revision}));assert.equal(checked.report.ready_for_approval,true,JSON.stringify(checked.report.gates));
      await call('steward','/api/data-map-handoffs/'+draft.handoff_id+'/approvals','POST',request({expected_revision:draft.revision,decision:'approved',basis:'合成经办不得批准',binding_digest:checked.report.binding_digest}),403);
      approval=await call('lead','/api/data-map-handoffs/'+draft.handoff_id+'/approvals','POST',request({expected_revision:draft.revision,decision:'approved',basis:'合成准确批准',binding_digest:checked.report.binding_digest}));assert.equal(approval.state,'approved');
    });
    let published;
    await check('reference pin failure rolls the publication back and exact UUID retry through HTTP atomically publishes fixed terminology references',async()=>{
      const payload=request({expected_revision:draft.revision,approval_id:approval.approval_id});
      const faultPool={execute:runtimePool.execute.bind(runtimePool),query:runtimePool.query.bind(runtimePool),getConnection:async()=>{const db=await runtimePool.getConnection();return new Proxy(db,{get(target,key){
        if(key==='execute')return(sql,args)=>{if(sql.startsWith('INSERT INTO tg_usage_heads')&&args?.[0]==='data_definition')throw Object.assign(Error('Synthetic pin failure'),{code:'SYNTHETIC_PIN_FAILURE'});return target.execute(sql,args);};
        const value=target[key];return typeof value==='function'?value.bind(target):value;
      }});}};
      const fault=createDataMapHandoffRepository(faultPool);await assert.rejects(fault.publish(draft.handoff_id,payload,f.sessions.lead),error=>{
        if(error.code==='ER_TABLEACCESS_DENIED_ERROR')console.error('JOINT_MINIMAL_GRANT_DENIAL '+error.sqlMessage);
        return error.code==='SYNTHETIC_PIN_FAILURE';
      });
      assert.equal(Number((await runtimePool.execute('SELECT COUNT(*) n FROM data_map_publications'))[0][0].n),0);
      published=await call('lead','/api/data-map-handoffs/'+draft.handoff_id+'/publish','POST',payload);
      const object=published.items.find(item=>item.target_kind==='object'),fixed=await call('lead',terms+'/usages?target_type=data_definition&target_id='+object.target_version_ref);
      assert.equal(fixed.fixed,true);assert.equal(fixed.items[0].version_id,termVersion);
      const current=await call('lead','/api/data-map-definitions/detail/object/'+object.target_id+'?view=current');assert.equal(current.current.version_id,object.target_version_ref);
    });
    await check('term availability changes reopen new-use review while the data definition keeps its fixed historical reference',async()=>{
      const current=await call('contact',terms+'/terms/'+termId);await call('lead',terms+'/terms/'+termId+'/actions','POST',request({expected_revision:current.revision_no,action:'suspend',reason:'合成暂停原因',effective_from:require('../server/terminologyGovernancePolicy').businessDate(),scope:'合成采购语境'}));
      const object=published.items.find(item=>item.target_kind==='object'),fixed=await call('lead',terms+'/usages?target_type=data_definition&target_id='+object.target_version_ref);
      assert.equal(fixed.items[0].version_id,termVersion);assert.equal(fixed.findings.length,0);assert.equal((await call('employee',terms+'/terms/'+termId)).usable,false);
    });
    await check('flag off, read-only and prepared maintenance close new writes while old writes stay sealed and fixed history stays readable',async()=>{
      process.env.DATA_MAP_HANDOFF_ENABLED='0';await call('lead','/api/data-map-handoffs/work-packages/702/intakes','POST',request({expected_revision:0}),503);
      await call('lead','/api/data-map-handoffs/publications/'+published.publication_id);await call('contact','/api/field-entries','POST',{context_id:11},409);
      process.env.DATA_MAP_HANDOFF_ENABLED='1';process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY='1';await call('lead','/api/data-map-handoffs/work-packages/702/intakes','POST',request({expected_revision:0}),409);
      process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY='0';await target.pool.execute("UPDATE data_map_governance_control SET cutover_state='prepared' WHERE control_id=1");
      await call('lead','/api/data-map-handoffs/work-packages/702/intakes','POST',request({expected_revision:0}),503);await call('contact','/api/field-entries','POST',{context_id:11},409);
      await call('lead','/api/data-map-definitions/version/9007199254741001');
    });
    const runtimeSources=[...new Map(Object.values(require.cache).filter(module=>module.filename&&[root,candidateRoot,roleModelRoot].some(base=>['server','shared'].some(folder=>module.filename.startsWith(path.join(base,folder)+path.sep)))).map(module=>{
      const base=[root,candidateRoot,roleModelRoot].find(base=>['server','shared'].some(folder=>module.filename.startsWith(path.join(base,folder)+path.sep)));
      const relative=path.relative(base,module.filename).replaceAll('\\','/');return [relative,{path:relative,sha256:sha(fs.readFileSync(module.filename))}];
    })).values()].sort((a,b)=>a.path.localeCompare(b.path));
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:'passed',checks,exchanges,access_model:model,candidate_root:candidateRoot,role_model_root:roleModelRoot,
      runtime_source_files:runtimeSources,runtime_manifest_sha256:sha(JSON.stringify(runtimeSources)),
      source_files:writePlan.sources,source_manifest_sha256:writePlan.source_manifest_sha256,role_definitions_sha256:sha(fs.readFileSync(path.join(roleModelRoot,'server/roleDefinitions.js'))),
      target:{owner:target.owner,database:target.database},runtime_privilege_plan:writePlan,session_establishment:'synthetic header; actual DB session/authority checks',
      formal_database_connected:false,business_acceptance:false,ui_acceptance:false},null,2)+'\n');
  }finally{await f.close();if(runtimePool)await runtimePool.end();}
},{stage:'79',randomDatabase:true});console.log('JOINT_TERMINOLOGY_HANDOFF_HTTP_PASSED '+checks.length+' '+output);}
if(require.main===module)main().catch(error=>{console.error(error.code||error.message);console.error(error.stack);process.exitCode=1;});
module.exports={main};
