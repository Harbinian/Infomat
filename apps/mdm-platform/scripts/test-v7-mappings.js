// P07 real owned MySQL/API/Edge checks; synthetic input only. No private env.
// --output requires a new artifacts directory. Fixture closes its own resources.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const {applyDefinitions}=require('../server/dataMapDefinitionMigration');
const {applyV7Mappings,inspectV7Mappings}=require('../server/v7MappingMigration');
const {contentHash}=require('../server/processV7PreviewReview');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const {makeDataMapDefinitionRepository}=require('../server/dataMapDefinitionRepository');
const arg=process.argv.indexOf('--output');assert(arg>=0&&process.argv[arg+1]);const output=path.resolve(process.argv[arg+1]);assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const root='/api/v7-mappings',defs='/api/data-map-definitions',uuid=()=>crypto.randomUUID(),checks=[];
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
function addObjects(d){
  d.data_objects=['a','b'].map(k=>({data_ref:'data_'+k,data_name:'同名合成对象',description:'独立对象 '+k,information_type:'business_conclusion',
    fields:[{field_ref:'field_'+k,field_name:'编号',field_type:'文本',definition:'对应对象 '+k+' 的编号'}],behavior_links:[],source_relations:[],
    lifecycle:{applicability:'pending_confirmation',entry_state:{business_validity:'pending_confirmation',custody:'pending_confirmation',identifiability_applicability:'pending_confirmation',identifiability:'pending_confirmation'},routes:[],analysis:{analyzer_version:'',source_fingerprint:'',status:'not_analyzed'},decision_reason:'',decision_notes:''}}));return d;
}
function nativeV8(v7){
  // Use the native factory, then author decision/use evidence in the V8 contract.
  const d=require('../../structured-output-service/server').createEmptyProcessGovernanceDocument();
  d.process={...v7.process,process_ref:'p07_native_v8',process_name:'P07原生V8判断依据流程'};
  d.terms=structuredClone(v7.terms);d.behaviors=structuredClone(v7.behaviors);d.flow_relations=structuredClone(v7.flow_relations);
  addObjects(d);
  d.behaviors.push({...d.behaviors[0],behavior_ref:'decision_basis',node_type:'decision',behavior_name:'材料是否合格',current_actor_role:'全公司',actor_assignment_mode:'company_wide'});
  d.flow_relations.push({relation_ref:'relation_decision',relation_type:'sequence',from_behavior_ref:'behavior_receive',to_behavior_ref:'decision_basis',condition:''});
  d.data_objects[0].behavior_links=[{link_ref:'link_decision_basis',behavior_ref:'decision_basis',operation:'use',updated_field_refs:[]}];
  return d;
}
async function main(){await withStage05Fixture(async({pool,fixture,expect,request,backup,restore})=>{
  const get=(p='',who='lead',status=200)=>expect(who,root+p,'GET',undefined,status);
  const post=(p,b,who='lead',status=200)=>expect(who,root+p,'POST',b,status);
  const save=b=>expect('contact',defs+'/save','POST',{request_id:uuid(),...b});
  let source,obj,field,other,preview,published,browserServer,browser,page;
  const pw=runtime();
  // Local repository uploader covers exact raw bytes without a test-only API.
  const repo=makeDataMapDefinitionRepository(pool),session={personId:82,accountId:182,authVersion:1};
  const upload=(document,name='合成来源.json',sid=session)=>repo.registerV7Source(sid,{request_id:uuid(),source_kind:'uploaded_material',original_name:name},Buffer.isBuffer(document)?document:Buffer.from(JSON.stringify(document)));
  const map=(sid,b,who='lead',status=200)=>post('/sources/'+sid+'/mappings',{request_id:uuid(),...b},who,status);
  try{
    await check('missing migration returns 503 and application startup does not create mapping tables',async()=>{await get('/sources','lead',503);assert.equal((await pool.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_v7_sources'"))[0].length,0);});
    const db=await pool.getConnection();try{
      await applyDefinitions(db);
      await check('read-only inspect, partial DDL recovery, empty-table compensation, repeat apply and schema drift rejection',async()=>{
        const before=await inspectV7Mappings(db);assert.equal(before.missing.length,3);
        await assert.rejects(applyV7Mappings({execute:(sql,args)=>{if(sql.startsWith('CREATE TABLE IF NOT EXISTS data_map_v7_mappings'))throw Error('SYNTHETIC_DDL_FAILURE');return db.execute(sql,args);},query:(...a)=>db.query(...a)}),/SYNTHETIC_DDL_FAILURE/);
        assert.equal((await inspectV7Mappings(db)).missing.length,2);assert.equal(Number((await db.execute('SELECT COUNT(*) n FROM data_map_v7_sources'))[0][0].n),0);
        await db.execute('DROP TABLE data_map_v7_sources'); // only this owned, verified empty increment
        assert((await applyV7Mappings(db)).ready);assert((await applyV7Mappings(db)).ready);
        await db.execute('ALTER TABLE data_map_v7_sources ADD COLUMN synthetic_drift INT');assert((await inspectV7Mappings(db)).drift.length);await assert.rejects(applyV7Mappings(db),e=>e.code==='DEFINITION_V7_SCHEMA_DRIFT');await db.execute('ALTER TABLE data_map_v7_sources DROP COLUMN synthetic_drift');
        fs.writeFileSync(path.join(output,'migration.json'),JSON.stringify({before,after:await inspectV7Mappings(db),partial_recovery:true,empty_compensation:true,drift_rejected:true},null,2));
      });
    }finally{db.release();}
    await check('explicit owned target maintenance CLI inspect, default dry-run and repeated apply',async()=>{
      const c=pool.pool.config.connectionConfig,env=isolatedEnvironment({MYSQL_HOST:c.host,MYSQL_PORT:String(c.port),MYSQL_USER:c.user,MYSQL_PASSWORD:c.password,MYSQL_DATABASE:c.database});
      for(const mode of ['--inspect',null,'--apply'])assert(JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'manage-v7-mappings.js'),...(mode?[mode]:[]),'--target',c.host+':'+c.port+'/'+c.database],{env,encoding:'utf8',windowsHide:true,timeout:30000})).ready);
    });
    obj=await save({entity_type:'object',definition:{name:'同名合成对象',business_meaning:'对象甲'}});
    other=await save({entity_type:'object',definition:{name:'同名合成对象',business_meaning:'对象乙'}});
    field=await save({entity_type:'field',object_id:obj.entity_id,object_version_id:obj.version_id,definition:{name:'编号',business_meaning:'合成字段'}});
    const document=addObjects(structuredClone(fixture.document));
    await check('invalid JSON and invalid V7 persist explicit failure; raw-byte digest is distinct from parsed content',async()=>{
      for(const [value,state] of [[Buffer.from('{broken'),'parse_failed'],[{},'validation_failed']]){const r=await upload(value);assert.equal(r.validation_status,state);const d=await get('/sources/'+r.source_id);assert.equal(d.nodes.length,0);assert.equal(d.can_confirm,false);await map(r.source_id,{},'lead',409);}
      source=await upload(document);assert.equal(source.validation_status,'valid');const detail=await get('/sources/'+source.source_id);assert.equal(detail.raw_sha256,crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex'));assert.equal(detail.content_digest,contentHash(document));assert.notEqual(detail.raw_sha256,detail.content_digest);assert.equal(detail.mappings.length,0);assert.equal(detail.nodes.length,2);
      assert.equal(detail.schema_version,'process-governance-v7');assert.equal(detail.digest_algorithm,'sha256-v7-stable-json-v1');
      assert.equal((await upload(document)).source_id,source.source_id);
      const whitespace=await upload(Buffer.from(JSON.stringify(document,null,2)));assert.notEqual(whitespace.source_id,source.source_id);assert.equal((await get('/sources/'+whitespace.source_id)).content_digest,detail.content_digest);
    });
    const base={source_digest:contentHash(document),local_object_ref:'data_a',local_field_ref:null,object_version_id:obj.version_id,field_version_id:null,expected_revision:0,status:'candidate',basis:'合成证据：登记表 A 对象区'};
    await check('current identity, CSRF, administrator multi-role, source and target scope are enforced',async()=>{
      const anonymous=await pw.request.newContext({baseURL:fixture.baseURL});try{assert.equal((await anonymous.get(root+'/sources')).status(),401);await anonymous.post('/api/org/login',{data:{loginName:'SYNTHETIC_lead',password:fixture.loginPassword}});assert.equal((await anonymous.post(root+'/sources',{data:{}})).status(),403);}finally{await anonymous.dispose();}
      await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 88,role_id,'global','P07 synthetic',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
      assert.equal((await get('/capabilities','adminMulti')).can_write,false);await map(source.source_id,base,'adminMulti',403);await map(source.source_id,base,'contact',403);await get('/sources/'+source.source_id,'outsider',403);
      await assert.rejects(repo.registerV7Source({...session,authVersion:999},{request_id:uuid(),source_kind:'uploaded_material',original_name:'a.json'},Buffer.from('{}')),e=>e.statusCode===401);
      await pool.execute("UPDATE data_map_objects SET owner_dept_id=93 WHERE id=?",[other.entity_id]);await assert.rejects(repo.getVersion({personId:83,accountId:183,authVersion:1},other.version_id),e=>e.statusCode===403);await pool.execute("UPDATE data_map_objects SET owner_dept_id=91 WHERE id=?",[other.entity_id]);
    });
    let objectMap,fieldMap;
    await check('same-name objects stay separate; candidate is not confirmed; fixed field maps to exact object and version',async()=>{
      objectMap=await map(source.source_id,base);let d=await get('/sources/'+source.source_id);assert.equal(d.mappings.length,1);assert.equal(d.mappings[0].effective_confirmed,false);
      assert(!d.mappings.some(m=>m.local_object_ref==='data_b'));await map(source.source_id,{...base,local_object_ref:'data_b',object_version_id:other.version_id,status:'confirmed'});
      const fb={...base,local_field_ref:'field_a',field_version_id:field.version_id,status:'confirmed'};await map(source.source_id,fb,'lead',409);
      objectMap=await map(source.source_id,{...base,expected_revision:1,status:'confirmed'});fieldMap=await map(source.source_id,fb);
      d=await get('/sources/'+source.source_id);const f=d.mappings.find(m=>m.local_field_ref==='field_a');assert.equal(f.field_id,field.entity_id);assert.equal(f.parent_mapping_version_id,objectMap.mapping_version_id);assert(f.effective_confirmed);
      const e=await get('/sources/'+source.source_id+'/evidence?object=data_a&field=field_a');assert.deepEqual(e.evidence,document.data_objects[0].fields[0]);
      await map(source.source_id,{...fb,expected_revision:1,object_version_id:other.version_id},'lead',409);
    });
    await check('renaming a ledger field and reordering V7 arrays preserve historical IDs without automatic transfer',async()=>{
      const renamed=await save({entity_type:'field',entity_id:field.entity_id,object_id:obj.entity_id,object_version_id:obj.version_id,expected_revision:1,definition:{name:'修订后的编号'}});
      const d=await get('/sources/'+source.source_id);assert.equal(d.mappings.find(m=>m.local_field_ref==='field_a').field_name,'编号');assert.equal(renamed.entity_id,field.entity_id);
      const orderOnly=structuredClone(document);orderOnly.data_objects.reverse();const orderSource=await upload(orderOnly);assert.equal((await get('/sources/'+orderSource.source_id+'/evidence?object=data_a&field=field_a')).evidence.field_name,'编号');assert.equal((await get('/sources/'+orderSource.source_id)).mappings.length,0);
      const reordered=structuredClone(document);reordered.data_objects.reverse();reordered.data_objects[1].fields[0].field_name='改名后的 V7 编号';const next=await upload(reordered);assert.notEqual(next.source_id,source.source_id);const changed=await get('/sources/'+next.source_id);assert.equal(changed.mappings.length,0);assert.equal((await get('/sources/'+next.source_id+'/evidence?object=data_a&field=field_a')).evidence.field_name,'改名后的 V7 编号');
      assert.equal((await expect('contact',defs+'/version/'+field.version_id,'GET')).definition.name,'编号');
    });
    await check('duplicate requests, payload mismatch, concurrency, parent remap invalidation and transaction rollback',async()=>{
      const body={...base,request_id:uuid(),expected_revision:2,status:'confirmed'};const a=await post('/sources/'+source.source_id+'/mappings',body);assert.deepEqual(await post('/sources/'+source.source_id+'/mappings',body),a);await post('/sources/'+source.source_id+'/mappings',{...body,basis:'不同依据'},'lead',409);
      assert.equal((await get('/sources/'+source.source_id)).mappings.find(m=>m.local_field_ref==='field_a').needs_recheck,true);
      const concurrent=await Promise.all([1,2].map(()=>request('lead',root+'/sources/'+source.source_id+'/mappings','POST',{...base,expected_revision:3,request_id:uuid()})));assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
      const before=await get('/sources/'+source.source_id);
      await pool.query("CREATE TRIGGER p07_failure BEFORE INSERT ON data_map_v7_mapping_versions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_MAPPING_FAILURE'");await map(source.source_id,{...base,expected_revision:4},'lead',503);await pool.query('DROP TRIGGER p07_failure');assert.deepEqual(await get('/sources/'+source.source_id),before);
      assert((await expect('contact',defs+'/impact/field/'+field.entity_id,'GET')).counts.v7_mapping_versions>0);
    });
    let caseDetail=await expect('contact','/api/process-v7-preview/cases','POST',{document,source_file_name:'P07合成预览.json'},201);
    const bind=()=>({expected_revision_no:caseDetail.case.current_revision_no,expected_content_hash:caseDetail.case.current_content_hash});
    const caseId=String(caseDetail.case.id),revisionId=String(caseDetail.revision.id);
    await check('historical preview revision and published native V7 use separate fixed read adapters',async()=>{
      preview=await post('/sources',{request_id:uuid(),source_kind:'preview_revision',case_id:caseId,revision_id:revisionId});
      for(const who of ['reviewA','reviewB'])for(const item of caseDetail.items)await expect(who,'/api/process-v7-preview/items/'+item.id+'/decision','POST',{...bind(),decision:'confirmed',basis:'P07合成核对依据'});
      const promoted=await expect('lead','/api/process-v7-preview/cases/'+caseId+'/promote','POST',{...bind(),target:{mode:'create',document_no:'P07-SYNTHETIC',document_title:'P07合成流程'}},201);
      const formal={expected_revision_no:promoted.draft.revision_no,expected_content_hash:promoted.draft.content_hash};const submitted=await expect('contact','/api/process-design/drafts/'+promoted.draft.id+'/submit','POST',formal);
      await expect('reviewA','/api/process-design/review-tasks/'+submitted.reviewTask.id+'/decision','POST',{...formal,decision:'approve',note:'P07合成审核'});
      const p=await expect('lead','/api/process-design/drafts/'+promoted.draft.id+'/publish','POST',formal);
      published=await post('/sources',{request_id:uuid(),source_kind:'published_version',process_version_id:String(p.process_version_id)});
      await pool.execute("UPDATE process_design_versions SET status='superseded' WHERE id=?",[p.process_version_id]);
      const newer=structuredClone(document);newer.data_objects[0].fields[0].field_name='预览第二版字段';caseDetail=await expect('contact','/api/process-v7-preview/cases/'+caseId+'/revisions','POST',{...bind(),document:newer,source_file_name:'P07-r2.json'},201);
      assert.equal((await get('/sources/'+preview.source_id+'/evidence?object=data_a&field=field_a')).evidence.field_name,'编号');
      for(const r of [preview,published]){const d=await get('/sources/'+r.source_id);assert.equal(d.raw_sha256,null);assert.equal(d.raw_digest_status,'unavailable');await map(r.source_id,base);}
      const d=await get('/sources/'+preview.source_id);assert.equal(d.process_version_id,null);assert.equal(d.source_ref.revision_id,revisionId);
      const retry={request_id:uuid(),source_kind:'preview_revision',case_id:Number(caseId),revision_id:Number(revisionId)};assert.equal((await post('/sources',retry)).source_id,preview.source_id);assert.deepEqual(await post('/sources',retry),await post('/sources',retry));
      assert.equal((await repo.listV7Sources(session)).partial,true);await assert.rejects(repo.getV7Source(session,preview.source_id),e=>e.statusCode===503);
      await pool.execute('UPDATE process_design_versions SET department_id=93 WHERE id=?',[p.process_version_id]);await get('/sources/'+published.source_id,'contact',403);await pool.execute('UPDATE process_design_versions SET department_id=91 WHERE id=?',[p.process_version_id]);
      await post('/sources',{request_id:uuid(),source_kind:'preview_revision',case_id:caseId,revision_id:revisionId,process_version_id:String(p.process_version_id)},'lead',400);
      await get('/sources/'+preview.source_id,'outsider',403);await get('/sources/'+published.source_id,'outsider',403);
    });
    const protectedTables=['process_v7_preview_cases','process_v7_preview_revisions','process_v7_preview_review_items','process_v7_preview_events','process_v7_promotions','process_design_documents','process_design_drafts','process_design_versions','process_design_review_tasks'];
    const snapshots=async()=>Object.fromEntries(await Promise.all(protectedTables.map(async t=>[t,crypto.createHash('sha256').update(JSON.stringify((await pool.execute('SELECT * FROM '+t+' ORDER BY id'))[0])).digest('hex')])));
    let protectedBefore=await snapshots();
    await check('source digest mutation blocks writes and unresolved actor department cannot be manually confirmed',async()=>{
      const [[original]]=await pool.execute('SELECT content_json FROM process_v7_preview_revisions WHERE id=?',[revisionId]);await pool.execute('UPDATE process_v7_preview_revisions SET content_json=? WHERE id=?',[JSON.stringify({...document,terms:[]}),revisionId]);assert((await get('/sources/'+preview.source_id)).stale);await map(preview.source_id,{...base,expected_revision:1},'lead',409);await pool.execute('UPDATE process_v7_preview_revisions SET content_json=? WHERE id=?',[original.content_json,revisionId]);
      const unresolved=structuredClone(document);unresolved.behaviors[0].current_actor_role='不存在的合成部门人员';const r=await upload(unresolved),d=await get('/sources/'+r.source_id);assert(d.current_validation.blocking_issues.some(i=>i.code==='ACTOR_DEPARTMENT_UNRESOLVED'));await map(r.source_id,{...base,source_digest:contentHash(unresolved),status:'confirmed'},'lead',409);await map(r.source_id,{...base,source_digest:contentHash(unresolved)});
      for(const r of [preview,published])await get('/sources/'+r.source_id+'/evidence?object=data_a&field=field_a');assert.deepEqual(await snapshots(),protectedBefore);
      fs.writeFileSync(path.join(output,'v7-read-only-proof.json'),JSON.stringify({before:protectedBefore,after:await snapshots(),equal:true},null,2));
    });
    await check('owned full backup restoration and integrity checks preserve source, mapping and old ledger versions',async()=>{
      const before=await get('/sources/'+source.source_id),dump=backup();
      await pool.execute("UPDATE data_map_v7_mapping_versions SET snapshot_json=JSON_SET(snapshot_json,'$.basis','SYNTHETIC_CORRUPTION') WHERE mapping_id=?",[fieldMap.mapping_id]);await get('/sources/'+source.source_id,'lead',409);restore(dump);assert.deepEqual(await get('/sources/'+source.source_id),before);assert.deepEqual(await snapshots(),protectedBefore);
      fs.writeFileSync(path.join(output,'backup-restore.json'),JSON.stringify({sha256:crypto.createHash('sha256').update(dump).digest('hex'),restored:true,backup_persisted:false}));
    });
    const v8=nativeV8(document);let v8Source,v8Preview,v8Published;
    await check('native V8 multipart and preview keep format, body, refs, digest, object/field versions and history',async()=>{
      const c=await pw.request.newContext({baseURL:fixture.baseURL});try{
        await c.post('/api/org/login',{data:{loginName:'SYNTHETIC_lead',password:fixture.loginPassword}});
        const token=(await(await c.get('/api/csrf-token')).json()).csrfToken;
        const bytes=Buffer.from(JSON.stringify(v8,null,2)),r=await c.post(root+'/uploads',{headers:{'X-CSRF-Token':token},multipart:{request_id:uuid(),file:{name:'native-v8.json',mimeType:'application/json',buffer:bytes}}});
        assert.equal(r.status(),200);v8Source=await r.json();assert.equal(v8Source.validation_status,'valid');
        const d=await get('/sources/'+v8Source.source_id);assert.equal(d.schema_version,'process-governance-v8');assert.equal(d.digest_algorithm,'sha256-v7-stable-json-v1');assert.equal(d.raw_sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
      }finally{await c.dispose();}
      const p=await expect('contact','/api/process-v7-preview/cases','POST',{document:v8,source_file_name:'native-v8-preview.json'},201);
      v8Preview=await post('/sources',{request_id:uuid(),source_kind:'preview_revision',case_id:String(p.case.id),revision_id:String(p.revision.id)});
      const proof=[];
      for(const s of [v8Source,v8Preview]){
        const d=await get('/sources/'+s.source_id);assert.equal(d.schema_version,v8.schema_version);assert.equal(d.content_digest,contentHash(v8));assert(d.can_confirm);
        const [[stored]]=await pool.execute('SELECT content_json FROM data_map_v7_sources WHERE source_id=?',[s.source_id]);assert.deepEqual(typeof stored.content_json==='string'?JSON.parse(stored.content_json):stored.content_json,v8);
        const mb={...base,source_digest:contentHash(v8),status:'confirmed'};const om=await map(s.source_id,mb),fm=await map(s.source_id,{...mb,local_field_ref:'field_a',field_version_id:field.version_id});
        const e=await get('/sources/'+s.source_id+'/evidence?object=data_a');assert.equal(e.schema_version,v8.schema_version);assert.deepEqual(e.evidence,v8.data_objects[0]);
        const fe=await get('/sources/'+s.source_id+'/evidence?object=data_a&field=field_a');assert.deepEqual(fe.evidence,v8.data_objects[0].fields[0]);
        const h=await get('/sources/'+s.source_id+'/mappings/'+fm.mapping_id+'/history');assert.equal(h.items[0].parent_mapping_version_id,om.mapping_version_id);assert.equal(h.items[0].object_version_id,obj.version_id);assert.equal(h.items[0].field_version_id,field.version_id);assert.equal(h.items[0].schema_version,v8.schema_version);assert.equal(h.items[0].source_digest,d.content_digest);
        proof.push({source_id:s.source_id,source_ref:d.source_ref,schema_version:d.schema_version,content_digest:d.content_digest,digest_algorithm:d.digest_algorithm,mapping:fm,evidence:fe});
      }
      // Prepare native published V8 through existing formal APIs to prove native P07 published-reference support.
      const bound={expected_revision_no:p.case.current_revision_no,expected_content_hash:p.case.current_content_hash};
      for(const who of ['reviewA','reviewB'])for(const item of p.items)await expect(who,'/api/process-v7-preview/items/'+item.id+'/decision','POST',{...bound,decision:'confirmed',basis:'P07合成V8核对'});
      const promoted=await expect('lead','/api/process-v7-preview/cases/'+p.case.id+'/promote','POST',{...bound,target:{mode:'create',document_no:'P07-V8-SYNTHETIC',document_title:'P07原生V8合成流程'}},201);
      const formal={expected_revision_no:promoted.draft.revision_no,expected_content_hash:promoted.draft.content_hash};const submitted=await expect('contact','/api/process-design/drafts/'+promoted.draft.id+'/submit','POST',formal);
      await expect('reviewA','/api/process-design/review-tasks/'+submitted.reviewTask.id+'/decision','POST',{...formal,decision:'approve',note:'P07合成V8审核'});
      const published=await expect('lead','/api/process-design/drafts/'+promoted.draft.id+'/publish','POST',formal);v8Published=String(published.process_version_id);
      const publishedSource=await post('/sources',{request_id:uuid(),source_kind:'published_version',process_version_id:v8Published});assert.equal((await get('/sources/'+publishedSource.source_id)).schema_version,'process-governance-v8');
      fs.writeFileSync(path.join(output,'native-v8-proof.json'),JSON.stringify({proof,published_v8_id:v8Published,published_v8_p07_supported:true,document:v8},null,2));
    });
    await check('invalid native V8 stays isolated; old V8 history stays readable and preview format drift blocks writes',async()=>{
      const invalid=structuredClone(v8);invalid.data_objects[0].behavior_links[0].operation='create';
      const failed=await upload(invalid);assert.equal(failed.validation_status,'validation_failed');const f=await get('/sources/'+failed.source_id);assert.equal(f.nodes.length,0);assert.equal(f.can_confirm,false);await map(failed.source_id,{...base,source_digest:contentHash(invalid)},'lead',409);
      const d=await get('/sources/'+v8Preview.source_id),old=structuredClone(d);
      const [[original]]=await pool.execute('SELECT content_json,content_hash FROM process_v7_preview_revisions WHERE id=?',[d.source_ref.revision_id]);
      const changed=structuredClone(document);changed.process.process_ref=v8.process.process_ref;
      await pool.execute('UPDATE process_v7_preview_revisions SET content_json=?,content_hash=? WHERE id=?',[JSON.stringify(changed),contentHash(changed),d.source_ref.revision_id]);
      try{const stale=await get('/sources/'+v8Preview.source_id);assert(stale.stale,'preview body format drift must invalidate the fixed binding');assert.equal(stale.schema_version,'process-governance-v8');assert(stale.mappings.every(m=>m.needs_recheck));await map(v8Preview.source_id,{...base,source_digest:contentHash(v8),expected_revision:1},'lead',409);}
      finally{await pool.execute('UPDATE process_v7_preview_revisions SET content_json=?,content_hash=? WHERE id=?',[typeof original.content_json==='string'?original.content_json:JSON.stringify(original.content_json),original.content_hash,d.source_ref.revision_id]);}
      assert.deepEqual(await get('/sources/'+v8Preview.source_id),old);
      // Legacy mapping snapshots have no schema_version; reads project from the source,
      // and never rewrite the stored snapshot or its digest to add a format field.
      const [[snapshot]]=await pool.execute('SELECT snapshot_json,snapshot_digest FROM data_map_v7_mapping_versions WHERE mapping_version_id=?',[d.mappings[0].mapping_version_id]);
      assert(!Object.hasOwn(typeof snapshot.snapshot_json==='string'?JSON.parse(snapshot.snapshot_json):snapshot.snapshot_json,'schema_version'));
      await get('/sources/'+v8Preview.source_id+'/mappings/'+d.mappings[0].mapping_id+'/history');assert.deepEqual((await pool.execute('SELECT snapshot_json,snapshot_digest FROM data_map_v7_mapping_versions WHERE mapping_version_id=?',[d.mappings[0].mapping_version_id]))[0][0],snapshot);
    });
    await check('missing markers/partial columns are 503 without DDL; request receipt failure rolls the whole mapping back',async()=>{
      const marker=require('../server/v7MappingSchema').MIGRATION_KEY;
      await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[marker]);
      try{await get('/sources','lead',503);await map(v8Source.source_id,{...base,source_digest:contentHash(v8),expected_revision:1},'lead',503);}finally{await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)',[marker]);}
      for(const [table,column] of [['data_map_v7_sources','validation_json'],['data_map_v7_mapping_versions','snapshot_digest']]){
        await pool.execute('ALTER TABLE '+table+' RENAME COLUMN '+column+' TO synthetic_missing_column');
        try{await get('/sources/'+v8Source.source_id,'lead',503);await map(v8Source.source_id,{...base,source_digest:contentHash(v8),expected_revision:1},'lead',503);const [[r]]=await pool.execute('SELECT COUNT(*) n FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);assert.equal(Number(r.n),0);}
        finally{await pool.execute('ALTER TABLE '+table+' RENAME COLUMN synthetic_missing_column TO '+column);}
      }
      const before=await get('/sources/'+v8Source.source_id),[[count]]=await pool.execute('SELECT COUNT(*) n FROM data_map_definition_requests');
      await pool.query("CREATE TRIGGER p07_receipt_failure BEFORE UPDATE ON data_map_definition_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_RECEIPT_FAILURE'");
      try{await map(v8Source.source_id,{...base,source_digest:contentHash(v8),expected_revision:1},'lead',503);}finally{await pool.query('DROP TRIGGER p07_receipt_failure');}
      assert.deepEqual(await get('/sources/'+v8Source.source_id),before);assert.deepEqual((await pool.execute('SELECT COUNT(*) n FROM data_map_definition_requests'))[0][0],count);
    });
    await check('current source/target scope, parent race and old idempotent receipts are rechecked without drifting history',async()=>{
      const body={...base,source_digest:contentHash(v8),expected_revision:1,status:'confirmed',request_id:uuid()};
      const receipt=await post('/sources/'+v8Source.source_id+'/mappings',body);
      await map(v8Source.source_id,{...body,request_id:uuid(),expected_revision:2});assert.deepEqual(await post('/sources/'+v8Source.source_id+'/mappings',body),receipt);
      const race=await Promise.all([
        request('lead',root+'/sources/'+v8Source.source_id+'/mappings','POST',{...body,request_id:uuid(),expected_revision:3}),
        request('lead',root+'/sources/'+v8Source.source_id+'/mappings','POST',{...body,request_id:uuid(),expected_revision:1,local_field_ref:'field_a',field_version_id:field.version_id})
      ]);assert(race.every(r=>r.status===200||r.status===409));
      const d=await get('/sources/'+v8Source.source_id),parent=d.mappings.find(m=>!m.local_field_ref),child=d.mappings.find(m=>m.local_field_ref);assert.equal(child.needs_recheck,child.parent_mapping_version_id!==parent.mapping_version_id);
      await pool.execute('UPDATE person SET current_department_id=93 WHERE person_id=82');try{await post('/sources/'+v8Source.source_id+'/mappings',body,'lead',403);}finally{await pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=82');}
      const pd=await get('/sources/'+v8Preview.source_id);
      await pool.execute('UPDATE process_v7_preview_cases SET owning_department_id=93 WHERE id=?',[pd.source_ref.case_id]);try{await get('/sources/'+v8Preview.source_id,'contact',403);assert((await get('/sources')).items.some(s=>s.source_id===v8Preview.source_id));assert((await get('/sources/'+v8Preview.source_id)).stale);}finally{await pool.execute('UPDATE process_v7_preview_cases SET owning_department_id=91 WHERE id=?',[pd.source_ref.case_id]);}
      await pool.execute('UPDATE data_map_objects SET owner_dept_id=93 WHERE id=?',[obj.entity_id]);try{assert.equal((await get('/sources/'+v8Source.source_id,'contact')).mappings.length,0);await get('/sources/'+v8Source.source_id+'/mappings/'+child.mapping_id+'/history','contact',403);}finally{await pool.execute('UPDATE data_map_objects SET owner_dept_id=91 WHERE id=?',[obj.entity_id]);}
    });
    protectedBefore=await snapshots();
    if(!process.argv.includes('--no-browser')){
      const net=require('node:net');let port;for(let i=0;i<20;i++){const s=net.createServer(),p=crypto.randomInt(42000,49000);if(await new Promise(r=>{s.once('error',()=>r(false));s.listen(p,'127.0.0.1',()=>r(true));})){await new Promise(r=>s.close(r));port=p;break;}}assert(port);
      browserServer=await pw.chromium.launchServer({channel:'msedge',headless:true,host:'127.0.0.1',port});browser=await pw.chromium.connect(browserServer.wsEndpoint());
      const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});page=await context.newPage();page.setDefaultTimeout(12000);
      const pageErrors=[],consoleErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});
      const button=n=>page.getByRole('button',{name:n,exact:true}),label=n=>page.getByLabel(n,{exact:true});const idle=()=>page.waitForFunction(()=>!document.body.textContent.includes('正在处理来源映射…'));
      const login=async()=>{await page.locator('#login-name').fill('SYNTHETIC_lead');await page.locator('#login-password').fill(fixture.loginPassword);await button('登录').click();await page.getByRole('heading',{name:'固定来源与台账映射',exact:true}).waitFor();await idle();};
      const dismiss=async fn=>{const d=page.waitForEvent('dialog');const a=fn();await(await d).dismiss();await a;};
      const overflow=async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>visualViewport.scale),1);};
      const shot=async name=>{await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,name),fullPage:true});};
      const uiDoc=structuredClone(document);uiDoc.process.process_name='页面合成来源';const bytes=Buffer.from(JSON.stringify(uiDoc));const filePath=path.join(output,'synthetic-v7.json');fs.writeFileSync(filePath,bytes);const rawBefore=crypto.createHash('sha256').update(bytes).digest('hex');
      let uiSource;
      await check('Edge upload, explicit object mapping, candidate distinction, field mapping and exact evidence jumps',async()=>{
        await page.goto(fixture.baseURL+'/app/v7-mappings');await login();await button('登记固定来源').click();await label('V8/V7 JSON 文件').setInputFiles(filePath);await button('登记并校验来源').click();await idle();uiSource=(await get('/sources')).items.find(i=>i.raw_sha256===rawBefore)||{source_id:new URL(page.url()).searchParams.get('source')};
        await button('建立对象映射').first().click();assert(await label('台账对象固定版本 ID').evaluate(e=>e===document.activeElement));await label('台账对象固定版本 ID').fill(obj.version_id);await button('读取台账版本').click();await idle();await label('映射核对依据').fill('页面对象依据：合成对象登记表 A 区');await button('人工确认映射').click();await idle();
        await button('建立字段映射').first().click();await label('台账字段固定版本 ID').fill(field.version_id);await button('读取台账版本').click();await idle();await label('映射核对依据').fill('页面字段依据：合成登记表编号列。'+('中文长文核对。'.repeat(30)));
        await dismiss(()=>page.getByRole('link',{name:'当前身份',exact:true}).click());await dismiss(()=>page.reload().catch(()=>{}));assert((await label('映射核对依据').inputValue()).startsWith('页面字段依据'));
        await shot('mapping-edit-desktop.png');await overflow();
      });
      await check('Edge 403/409/503/network and real 401 preserve visible mapping input across re-login',async()=>{
        for(const status of [403,409,503]){await page.route('**'+root+'/sources/*/mappings',r=>r.fulfill({status,contentType:'application/json',body:JSON.stringify({code:'SYNTHETIC_FAILURE'})}),{times:1});await button('保存映射建议').click();await page.getByRole('alert').waitFor();await idle();assert((await label('映射核对依据').inputValue()).startsWith('页面字段依据'));}
        await page.route('**'+root+'/sources/*/mappings',r=>r.abort(),{times:1});await button('保存映射建议').click();await idle();assert((await label('映射核对依据').inputValue()).startsWith('页面字段依据'));
        await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=182');await button('保存映射建议').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await login();assert((await label('映射核对依据').inputValue()).startsWith('页面字段依据'));
        await expect('lead','/api/org/login','POST',{loginName:'SYNTHETIC_lead',password:fixture.loginPassword});
        await overflow();await button('保存映射建议').click();await idle();assert((await get('/sources/'+uiSource.source_id)).mappings.some(m=>m.local_field_ref==='field_a'&&m.status==='candidate'));
      });
      await check('Edge history, fixed ledger and source evidence, late response rejection, viewport and console checks',async()=>{
        await page.setViewportSize({width:1699,height:828});await button('查看字段来源证据').first().click();await idle();await page.getByRole('heading',{name:'固定来源证据',exact:true}).waitFor();await button('查看映射历史').last().click();await idle();assert((await page.getByRole('link',{name:'打开台账固定版本 ↗'}).last().getAttribute('href')).endsWith(field.version_id));
        await shot('mapped-desktop.png');await overflow();await overflow();
        let release;const gate=new Promise(r=>{release=r;});await page.route('**'+root+'/sources/'+source.source_id,async route=>{const response=await route.fetch();await gate;await route.fulfill({response}).catch(()=>{});},{times:1});await page.locator('.v7-source-choice').filter({hasText:'来源 '+source.source_id+' ·'}).click();await page.locator('.v7-source-choice').filter({hasText:'来源 '+uiSource.source_id+' ·'}).click();await idle();release();await page.unrouteAll({behavior:'wait'});assert(await page.getByRole('heading',{name:'来源 '+uiSource.source_id+'：独立上传材料',exact:true}).isVisible());
        assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors.filter(e=>!/Failed to load resource:.*(401|403|409|503|net::ERR_FAILED)/.test(e)),[]);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),rawBefore);assert.deepEqual(await snapshots(),protectedBefore);
      });
      await check('Edge native V8 upload/object/field/history and committed-but-lost responses reuse exact receipts',async()=>{
        const file=path.join(output,'synthetic-v8.json');fs.writeFileSync(file,JSON.stringify(v8,null,2));
        const accept=async fn=>{const d=page.waitForEvent('dialog');const a=fn();await(await d).accept();await a;};
        await button('登记固定来源').click();assert(await page.getByText('独立上传、预览固定修订和已发布固定版本均支持原生 V8', {exact:false}).count());
        await label('V8/V7 JSON 文件').setInputFiles(file);
        await page.route('**'+root+'/uploads',async route=>{await route.fetch();await route.abort();},{times:1});await button('登记并校验来源').click();await idle();assert((await label('V8/V7 JSON 文件').locator('..').textContent()).includes('synthetic-v8.json'));
        await button('登记并校验来源').click();await idle();assert.equal(new URL(page.url()).searchParams.get('source'),v8Source.source_id);
        assert(await page.getByText('格式 process-governance-v8',{exact:false}).count());
        const before=await get('/sources/'+v8Source.source_id),om=before.mappings.find(m=>!m.local_field_ref&&m.local_object_ref==='data_a');
        await button('修订对象映射').first().click();await button('读取台账版本').click();await idle();await label('映射核对依据').fill('V8合成判断数据依据：use，仅核对对应关系');
        await page.route('**'+root+'/sources/'+v8Source.source_id+'/mappings',async route=>{await route.fetch();await route.abort();},{times:1});await button('人工确认映射').click();await idle();assert.equal(await label('映射核对依据').inputValue(),'V8合成判断数据依据：use，仅核对对应关系');
        await button('人工确认映射').click();await idle();assert.equal((await get('/sources/'+v8Source.source_id)).mappings.find(m=>m.mapping_id===om.mapping_id).revision_no,om.revision_no+1);
        await button('修订字段映射').first().click();await button('读取台账版本').click();await idle();await label('映射核对依据').fill('V8字段合成依据：固定版本编号列');await button('人工确认映射').click();await idle();
        assert((await get('/sources/'+v8Source.source_id)).mappings.find(m=>m.local_field_ref==='field_a').effective_confirmed);
        await button('查看对象来源证据').first().click();await idle();assert(await page.locator('#v7-evidence').getByText('"operation": "use"',{exact:false}).count());
        await button('查看映射历史').first().click();await idle();await shot('native-v8-mapped-desktop.png');await overflow();
        // Preview fixed V8 is accepted through the same page; published V8 is accepted with the exact fixed version.
        await button('登记固定来源').click();await accept(()=>label('来源类型').selectOption('preview_revision'));
        const d=await get('/sources/'+v8Preview.source_id);await label('预览案例 ID').fill(d.source_ref.case_id);await label('固定修订 ID').fill(d.source_ref.revision_id);await button('登记并校验来源').click();await idle();assert.equal(new URL(page.url()).searchParams.get('source'),v8Preview.source_id);
        await button('登记固定来源').click();await accept(()=>label('来源类型').selectOption('published_version'));await label('已发布流程版本 ID').fill(v8Published);await button('登记并校验来源').click();await idle();assert((await page.locator('body').innerText()).includes('process-governance-v8'));
        await shot('published-v8-native-desktop.png');await overflow();assert.deepEqual(await snapshots(),protectedBefore);
      });
      fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({browser:'Microsoft Edge',zoom:1,viewports:[[1699,828]],pageErrors,consoleErrors,human_acceptance:false},null,2));
    }
    await check('numeric source pagination does not skip multi-digit IDs; parser depth is bounded',async()=>{
      const activeSession={...session,authVersion:process.argv.includes('--no-browser')?1:2};
      for(let i=0;i<105;i++)await upload(Buffer.from('SYNTHETIC_INVALID_JSON_'+i),'分页失败材料.json',activeSession);
      let after=null,all=[];do{const r=await get('/sources'+(after?'?after='+after:''));all.push(...r.items.map(i=>i.source_id));after=r.next;}while(after);
      const count=Number((await pool.execute('SELECT COUNT(*) n FROM data_map_v7_sources'))[0][0].n);assert.equal(all.length,count);assert.equal(new Set(all).size,count);assert.deepEqual(all,[...all].sort((a,b)=>Number(a)-Number(b)));
      await assert.rejects(upload(Buffer.from('['.repeat(70)+'0'+']'.repeat(70)),'deep.json',activeSession),e=>e.statusCode===413);
    });
    await check('BIGINT source/mapping/version IDs above JS safe integer stay exact decimal strings',async()=>{
      for(const t of ['data_map_v7_sources','data_map_v7_mappings','data_map_v7_mapping_versions'])await pool.execute('ALTER TABLE '+t+' AUTO_INCREMENT=9007199254740993');
      const doc=nativeV8(document);doc.process.process_ref='p07_bigint_native';
      const s=await upload(doc,'bigint-v8.json',{...session,authVersion:process.argv.includes('--no-browser')?1:2});assert.equal(s.source_id,'9007199254740993');
      // Browser re-login replaced its API session; acquire a fresh independent CSRF
      // token instead of using the fixture client's pre-login cached token.
      const c=await pw.request.newContext({baseURL:fixture.baseURL});let m;try{
        await c.post('/api/org/login',{data:{loginName:'SYNTHETIC_lead',password:fixture.loginPassword}});const token=(await(await c.get('/api/csrf-token')).json()).csrfToken;
        const r=await c.post(root+'/sources/'+s.source_id+'/mappings',{headers:{'X-CSRF-Token':token},data:{...base,request_id:uuid(),source_digest:contentHash(doc),status:'confirmed'}});assert.equal(r.status(),200);m=await r.json();
      }finally{await c.dispose();}
      assert.equal(m.mapping_id,'9007199254740993');assert.equal(m.mapping_version_id,'9007199254740993');
      const d=await get('/sources/'+s.source_id),h=await get('/sources/'+s.source_id+'/mappings/'+m.mapping_id+'/history');assert.equal(d.source_ref.batch_id,s.source_id);assert.equal(h.items[0].mapping_version_id,m.mapping_version_id);assert.equal(h.items[0].source_id,s.source_id);
      fs.writeFileSync(path.join(output,'bigint-proof.json'),JSON.stringify({source:s,mapping:m,history:h},null,2));
    });
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,step:'P07',formal_environment:false,human_acceptance:false},null,2));
  }catch(e){if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:e.message,checks},null,2));throw e;}
  finally{
    async function bounded(p){let timer;try{return await Promise.race([p,new Promise((_,r)=>{timer=setTimeout(()=>r(Error('close timeout')),10000);})]);}finally{clearTimeout(timer);}}
    const cleanup={owned_browser_pid:browserServer?.process().pid||null};if(browser)await bounded(browser.close()).catch(()=>{});if(browserServer){try{await bounded(browserServer.close());cleanup.graceful=true;}catch{await bounded(browserServer.kill());cleanup.forced_owned_only=true;}assert(browserServer.process().exitCode!==null||browserServer.process().signalCode!==null);}fs.writeFileSync(path.join(output,'browser-cleanup.json'),JSON.stringify(cleanup));
  }
},{evidenceDir:output,randomDatabase:true});}
main().catch(e=>{console.error(e);if(e.inspection)console.error(JSON.stringify(e.inspection,null,2));process.exitCode=1;});
