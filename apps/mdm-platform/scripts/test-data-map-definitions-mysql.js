// P02 uses only a freshly created, labelled, tmpfs MySQL. No env files or services.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const { makeDataMapMysqlRepository } = require('../server/dataMapMysqlRepository');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const { inspectDefinitions, applyDefinitions, tables, MIGRATION_KEY } = require('../server/dataMapDefinitionMigration');
const { snapshot, digest, id } = require('../server/dataMapDefinitionValues');
const { argumentsFor } = require('./manage-data-map-definitions');
const request = () => crypto.randomUUID();
const checks = [];
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex < 0 ? null : path.resolve(process.argv[outputIndex+1]);
if (output) {
  assert.ok(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));
  assert.ok(!fs.existsSync(output),'evidence file must be new');
  fs.mkdirSync(path.dirname(output),{recursive:true});
}
async function check(name,action) { await action();checks.push(name);console.log('PASS '+name); }
const rejects = (promise,code) => assert.rejects(promise,e=>{if(e.code!==code)throw e;return true;},code);
function failConnection(db,pattern) {
  return new Proxy(db,{get(target,key){if(key==='execute')return async(sql,args)=>{if(pattern.test(sql))throw Object.assign(new Error('SYNTHETIC_FAILURE'),{code:'SYNTHETIC_FAILURE'});return target.execute(sql,args);};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
}
async function main() {
  const evidence={step:'P02',started_at:new Date().toISOString(),checks};
  await withFreshMysql(async fixture=>{
    const {pool,containerId,database,port}=fixture;
    evidence.target={container_id:containerId,database,host:'127.0.0.1',port,storage:'owned tmpfs',synthetic_only:true};
    await makeIdentityMysqlRepository(pool).initSchema();
    for(const dept of [91,92])await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)',[dept,'P02_'+dept,'合成部门'+dept]);
    const sessions={};
    const actors=[['writer',['department_contact'],91],['other',['department_contact'],92],['lead',['mdm_lead'],91],['admin',['admin','department_contact','mdm_lead'],91],['reader',['department_mdm_reviewer'],91],['writer2',['department_contact'],91]];
    for(let i=0;i<actors.length;i++){
      const [name,roles,dept]=actors[i],personId=81+i,accountId=181+i;
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)',[personId,'P02_'+name,'合成'+name,dept]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,?,?,?,'active',0)",[accountId,personId,'P02_'+name,'disabled-synthetic-no-login']);
      for(const role of roles){const global=['admin','mdm_lead'].includes(role);await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,?,CURRENT_DATE FROM roles WHERE role_code=?",[personId,global?'global':'department',global?null:dept,'P02 synthetic only',role]);}
      sessions[name]={personId,accountId,authVersion:1};
    }
    const big='9007199254740993';
    await pool.execute("INSERT INTO data_map_objects(id,object_key,object_name_cn,owner_dept_id,description) VALUES (?,'legacy_key','旧对象',91,'原值保留')",[big]);
    await pool.execute("INSERT INTO data_map_contexts(id,context_key,title,dept_id) VALUES (11,'context_a','合成场景甲',91),(12,'context_b','合成场景乙',92)");
    await pool.execute("INSERT INTO data_map_fields(id,context_id,object_id,field_key,field_name_cn,enum_values_json) VALUES (21,11,?,'legacy_field','旧字段','unknown legacy text'),(22,11,NULL,'orphan','未归属字段',NULL)",[big]);
    await pool.execute("INSERT INTO data_map_field_identities(field_id,confidence_level) VALUES (21,'medium')");
    const db=await pool.getConnection();
    let obj,field,field2,source;
    try {
      const legacy=await snapshot(db,'object',big),legacyField=await snapshot(db,'field','21');
      const repo=makeDataMapMysqlRepository(pool).definitions();
      const maintenance=mode=>JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'manage-data-map-definitions.js'),mode,'--target',`127.0.0.1:${port}/${database}`],{
        env:isolatedEnvironment({MYSQL_HOST:'127.0.0.1',MYSQL_PORT:String(port),MYSQL_DATABASE:database,MYSQL_USER:'root',MYSQL_PASSWORD:fixture.password}),encoding:'utf8',windowsHide:true,timeout:30000
      }));
      await check('maintenance requires explicit matching target and rejects ambiguous arguments',async()=>{
        assert.throws(()=>argumentsFor(['--inspect'],{}));
        const env={MYSQL_HOST:'127.0.0.1',MYSQL_PORT:String(port),MYSQL_DATABASE:database,MYSQL_USER:'root',MYSQL_PASSWORD:'synthetic'};
        assert.equal(argumentsFor(['--dry-run','--target',`127.0.0.1:${port}/${database}`],env),'--dry-run');
        assert.throws(()=>argumentsFor(['--apply','--target','wrong'],env));
        assert.throws(()=>argumentsFor(['--apply','--target',`127.0.0.1:NaN/${database}`],{...env,MYSQL_PORT:'NaN'}));
      });
      await check('inspect is read only and new repository fails closed before migration',async()=>{
        const before=await inspectDefinitions(db);evidence.inspect_before=before;
        assert.deepEqual(before.drift,[]);assert.equal(before.missing.length,7);assert.equal(before.backfill.length,3);
        assert.deepEqual(maintenance('--inspect'),before);assert.deepEqual(maintenance('--dry-run'),before);
        await rejects(repo.getCurrent(sessions.writer,'object',big),'DEFINITION_MIGRATION_REQUIRED');
        assert.equal((await inspectDefinitions(db)).missing.length,7);
      });
      await check('owned empty additive DDL compensation preserves every legacy record',async()=>{
        await rejects(applyDefinitions(failConnection(db,/CREATE TABLE IF NOT EXISTS data_map_source_files/)),'SYNTHETIC_FAILURE');
        const partial=await inspectDefinitions(db);assert.equal(partial.missing.length,4);assert.deepEqual(partial.drift,[]);
        // Only these three empty tables were created by this test, in its owned DB.
        for(const table of tables.slice(0,3).reverse()) {
          assert.equal((await db.execute(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n,0);
          await db.execute(`DROP TABLE ${table}`);
        }
        assert.equal((await inspectDefinitions(db)).missing.length,7);
        assert.deepEqual(await snapshot(db,'object',big),legacy);assert.deepEqual(await snapshot(db,'field','21'),legacyField);
      });
      await check('partial DDL remains inspectable; backfill failure rolls back DML',async()=>{
        await rejects(applyDefinitions(failConnection(db,/CREATE TABLE IF NOT EXISTS data_map_source_files/)),'SYNTHETIC_FAILURE');
        await rejects(applyDefinitions(failConnection(db,/INSERT INTO data_map_definition_versions/)).catch(async error=>{assert.deepEqual((await inspectDefinitions(db)).drift,[]);throw error;}),'SYNTHETIC_FAILURE');
        assert.equal((await db.execute('SELECT COUNT(*) AS n FROM data_map_definition_versions'))[0][0].n,0);
        assert.equal((await db.execute('SELECT COUNT(*) AS n FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]))[0][0].n,0);
      });
      await check('first migration resumes; legacy IDs, unknown values and references are unchanged',async()=>{
        const after=await applyDefinitions(db);evidence.inspect_after=after;
        assert.equal(after.ready,true);assert.equal(after.unresolved[0].entity_id,'22');
        assert.deepEqual(await snapshot(db,'object',big),legacy);assert.deepEqual(await snapshot(db,'field','21'),legacyField);
        const v=await repo.getCurrent(sessions.writer,'field','21');
        assert.equal(v.definition.required,null);assert.equal(v.definition.enum_values,null);assert.equal(v.created_by_person_id,null);
        assert.equal(v.base_snapshot.row.enum_values_json,'unknown legacy text');assert.equal(v.base_snapshot.identities[0].confidence_level,'medium');
        assert.equal((await repo.getCurrent(sessions.writer,'object',big)).entity_id,big);
        assert.throws(()=>id(Number(big)));assert.match(v.created_at,/Z$/);
      });
      await check('repeat migration preserves immutable versions and produces no duplicate rows',async()=>{
        const before=(await db.execute('SELECT * FROM data_map_definition_versions ORDER BY version_id'))[0];
        assert.equal(maintenance('--apply').ready,true);assert.deepEqual((await db.execute('SELECT * FROM data_map_definition_versions ORDER BY version_id'))[0],before);
      });
      await check('legacy-only code path works with extension tables retained; runtime needs no DDL',async()=>{
        const legacyRepo=makeDataMapMysqlRepository(pool);
        const before=await legacyRepo.getField('21');
        await db.execute('DELETE FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]);
        await rejects(repo.getCurrent(sessions.writer,'field','21'),'DEFINITION_MIGRATION_REQUIRED');
        assert.deepEqual(await legacyRepo.getField('21'),before);
        await applyDefinitions(db);
        const restricted=makeDataMapDefinitionRepository({getConnection:async()=>failConnection(await pool.getConnection(),/^\s*(CREATE|ALTER|DROP|TRUNCATE)\s/i)});
        assert.equal((await restricted.getCurrent(sessions.writer,'field','21')).entity_id,'21');
      });
      await check('schema drift is reported and apply refuses without changing legacy data',async()=>{
        await db.execute('ALTER TABLE data_map_definition_events ADD COLUMN synthetic_drift INT NULL');
        assert.equal((await inspectDefinitions(db)).drift[0].table,'data_map_definition_events');
        await rejects(applyDefinitions(db),'DEFINITION_SCHEMA_DRIFT');
        await db.execute('ALTER TABLE data_map_definition_events DROP COLUMN synthetic_drift');
        assert.deepEqual(await snapshot(db,'field','21'),legacyField);
      });
      const createObject=(name='合成对象',dept='91')=>({request_id:request(),entity_type:'object',department_id:dept,definition:{name,source:{description:'对象登记来源'},authority_suggestion:{description:'待核实建议'}}});
      await check('server identity, department scope, admin multirole and formal decisions fail closed',async()=>{
        await rejects(repo.saveDefinition({},createObject()),'DEFINITION_AUTH_REQUIRED');
        await rejects(repo.saveDefinition({...sessions.writer,authVersion:99},createObject()),'DEFINITION_AUTH_REQUIRED');
        await rejects(repo.saveDefinition(sessions.other,createObject()),'DEFINITION_ACCESS_DENIED');
        await rejects(repo.saveDefinition(sessions.admin,createObject()),'DEFINITION_ACCESS_DENIED');
        await rejects(repo.saveDefinition(sessions.reader,createObject()),'DEFINITION_ACCESS_DENIED');
        await rejects(repo.saveDefinition(sessions.writer,{...createObject(),definition:{name:'非法结论',governance:{confirmed:true}}}),'DEFINITION_PROPERTY_NOT_ALLOWED');
      });
      await check('stable identity is independent of names and idempotency binds exact payload',async()=>{
        const payload=createObject();obj=await repo.saveDefinition(sessions.writer,payload);
        assert.equal(typeof obj.entity_id,'string');assert.deepEqual(await repo.saveDefinition(sessions.writer,payload),obj);
        await rejects(repo.saveDefinition(sessions.writer,{...payload,definition:{name:'不同内容'}}),'DEFINITION_IDEMPOTENCY_CONFLICT');
        const sameName=await repo.saveDefinition(sessions.writer,createObject());assert.notEqual(sameName.entity_id,obj.entity_id);
        await rejects(repo.getCurrent(sessions.other,'object',obj.entity_id),'DEFINITION_ACCESS_DENIED');
        assert.equal((await repo.getCurrent(sessions.admin,'object',obj.entity_id)).revision_no,1);
      });
      const createField=(name)=>({request_id:request(),entity_type:'field',object_id:obj.entity_id,object_version_id:obj.version_id,context_id:'11',definition:{name,source:{description:'独立字段来源'},required:false,enum_values:[]}});
      await check('field ownership and fixed object version are mandatory; sources remain independent',async()=>{
        await rejects(repo.saveDefinition(sessions.writer,{...createField('错归属'),context_id:'12'}),'DEFINITION_ACCESS_DENIED');
        await rejects(repo.saveDefinition(sessions.writer,{...createField('无对象'),object_id:null}),'DEFINITION_ID_INVALID');
        field=await repo.saveDefinition(sessions.writer,createField('合成字段甲'));field2=await repo.saveDefinition(sessions.writer,createField('合成字段乙'));
        const f=await repo.getCurrent(sessions.writer,'field',field.entity_id),o=await repo.getCurrent(sessions.writer,'object',obj.entity_id);
        assert.equal(f.definition.source.description,'独立字段来源');assert.equal(o.definition.source.description,'对象登记来源');assert.equal(f.definition.required,false);assert.deepEqual(f.definition.enum_values,[]);assert.equal(f.definition.governance,null);
      });
      await check('single and composite identifiers freeze distinct field versions without renaming IDs',async()=>{
        const old=await repo.getVersion(sessions.writer,obj.version_id);
        const unique_identifiers=[{group_id:request(),kind:'single',field_version_ids:[field.version_id]},{group_id:request(),kind:'composite',field_version_ids:[field.version_id,field2.version_id]}];
        obj=await repo.saveDefinition(sessions.writer,{request_id:request(),entity_type:'object',entity_id:obj.entity_id,expected_revision:1,definition:{name:'对象改名',unique_identifiers}});
        assert.equal(obj.revision_no,2);assert.deepEqual(await repo.getVersion(sessions.writer,old.version_id),old);
        await rejects(repo.saveDefinition(sessions.writer,{request_id:request(),entity_type:'object',entity_id:obj.entity_id,expected_revision:2,definition:{unique_identifiers:[{group_id:request(),kind:'composite',field_version_ids:[field.version_id,field.version_id]}]}}),'DEFINITION_IDENTIFIERS_INVALID');
        await rejects(repo.saveDefinition(sessions.writer,{...createField('旧父版本'),object_version_id:old.version_id}),'DEFINITION_OBJECT_VERSION_CHANGED');
      });
      await check('simultaneous editors yield one committed revision and one conflict',async()=>{
        const edits=[sessions.writer,sessions.writer2].map((session,i)=>repo.saveDefinition(session,{request_id:request(),entity_type:'object',entity_id:obj.entity_id,expected_revision:2,definition:{business_meaning:'合成修改'+i}}));
        const results=await Promise.allSettled(edits);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
        const failed=results.find(r=>r.status==='rejected').reason;
        assert.ok(['DEFINITION_REVISION_CONFLICT','DEFINITION_CONFLICT'].includes(failed.code),failed.code);
        const value=await repo.getCurrent(sessions.writer,'object',obj.entity_id);assert.equal(value.version_no,3);obj={...obj,version_id:value.version_id,revision_no:3};
      });
      await check('repository transaction failure removes base changes, version, event and request',async()=>{
        const before=(await db.execute('SELECT COUNT(*) AS n FROM data_map_objects'))[0][0].n;
        const broken=makeDataMapDefinitionRepository({getConnection:async()=>failConnection(await pool.getConnection(),/INSERT INTO data_map_definition_events/)});
        const payload=createObject('应回滚');await rejects(broken.saveDefinition(sessions.writer,payload),'SYNTHETIC_FAILURE');
        assert.equal((await db.execute('SELECT COUNT(*) AS n FROM data_map_objects'))[0][0].n,before);
        assert.equal((await db.execute('SELECT COUNT(*) AS n FROM data_map_definition_requests WHERE request_id=?',[payload.request_id]))[0][0].n,0);
      });
      await check('review is append-only, fixed-version and does not confer formal governance approval',async()=>{
        const payload={request_id:request(),version_id:obj.version_id,expected_revision:3,decision:'fact_checked',basis:['合成测试证据，不是业务验收']};
        const review=await repo.recordReview(sessions.lead,payload);assert.deepEqual(await repo.recordReview(sessions.lead,payload),review);
        await rejects(repo.recordReview(sessions.admin,{...payload,request_id:request()}),'DEFINITION_ACCESS_DENIED');
        await rejects(repo.recordReview(sessions.lead,{...payload,request_id:request(),decision:'approved'}),'DEFINITION_FORMAL_DECISION_NOT_ENABLED');
        await rejects(repo.recordReview(sessions.lead,{...payload,request_id:request(),expected_revision:2}),'DEFINITION_REVISION_CONFLICT');
        const orphan=await repo.getCurrent(sessions.writer,'field','22');
        await rejects(repo.recordReview(sessions.lead,{...payload,request_id:request(),version_id:orphan.version_id,expected_revision:1}),'DEFINITION_OBJECT_REQUIRED');
        assert.equal((await repo.getCurrent(sessions.writer,'object',obj.entity_id)).definition.governance,null);
      });
      await check('raw bytes hash and template-local identifiers stay separate from platform identity',async()=>{
        const payload={request_id:request(),department_id:'91',original_name:'synthetic.xlsx',parser_version:'p02-fixture',template_profile_version:'fixture-only'};
        source=await repo.registerSource(sessions.writer,payload,Buffer.from('synthetic-original-bytes'));
        assert.equal((await repo.registerSource(sessions.writer,{...payload,request_id:request()},Buffer.from('synthetic-original-bytes'))).batch_id,source.batch_id);
        assert.equal((await repo.registerSource(sessions.writer,{...payload,request_id:request()},null)).raw_digest_status,'unavailable');
        await repo.addSourceMapping(sessions.writer,{request_id:request(),batch_id:source.batch_id,sheet_name:'合成清单',record_type:'object',local_id:'OBJ-001',source_row:16,platform_version_id:obj.version_id,cells:[{address:'A16',raw_type:'string',raw_value:'OBJ-001'},{address:'B16',raw_type:'formula',raw_value:{formula:'1+1',cached:2}}]});
        await repo.addSourceMapping(sessions.writer,{request_id:request(),batch_id:source.batch_id,sheet_name:'合成清单',record_type:'field',local_id:null,source_row:52,platform_version_id:null,unresolved_reason:'OBJECT_REQUIRED',cells:[{address:'A52',raw_type:'blank',raw_value:null}]});
        const saved=await repo.getSource(sessions.writer,source.batch_id);assert.equal(saved.mappings[0].local_id,'OBJ-001');assert.equal(saved.mappings[0].platform_entity_id,obj.entity_id);assert.equal(saved.mappings[1].platform_entity_id,null);assert.deepEqual(saved.cells[1].raw_value,{formula:'1+1',cached:2});
        await rejects(repo.getSource(sessions.other,source.batch_id),'DEFINITION_ACCESS_DENIED');
      });
      await check('source mapping failure rolls back newly inserted cells; foreign keys and checks enforce invariants',async()=>{
        const payload={request_id:request(),batch_id:source.batch_id,sheet_name:'合成清单',record_type:'object',local_id:'OBJ-001',source_row:17,platform_version_id:obj.version_id,cells:[{address:'A17',raw_type:'string',raw_value:'duplicate-local-id'}]};
        await rejects(repo.addSourceMapping(sessions.writer,payload),'DEFINITION_CONFLICT');
        assert.equal((await db.execute("SELECT COUNT(*) AS n FROM data_map_source_cells WHERE cell_address='A17'"))[0][0].n,0);
        await assert.rejects(db.execute('UPDATE data_map_definition_heads SET current_version_id=? WHERE entity_type=? AND entity_id=?',[field.version_id,'object',obj.entity_id]),e=>e.code==='ER_NO_REFERENCED_ROW_2');
        await assert.rejects(db.execute('UPDATE data_map_definition_heads SET revision_no=0 WHERE entity_type=? AND entity_id=?',['object',obj.entity_id]),e=>e.code==='ER_CHECK_CONSTRAINT_VIOLATED');
        await db.execute('UPDATE data_map_definition_heads SET revision_no=99 WHERE entity_type=? AND entity_id=?',['object',obj.entity_id]);
        await rejects(repo.getCurrent(sessions.writer,'object',obj.entity_id),'DEFINITION_VERSION_INTEGRITY_CONFLICT');
        await db.execute('UPDATE data_map_definition_heads SET revision_no=3 WHERE entity_type=? AND entity_id=?',['object',obj.entity_id]);
      });
      await check('legacy writes remain compatible but new writes detect source changes and preserve history',async()=>{
        const old=await repo.getCurrent(sessions.writer,'field','21');
        await db.execute("UPDATE data_map_fields SET field_name_cn='旧路径变更' WHERE id=21");
        await rejects(repo.getCurrent(sessions.writer,'field','21'),'DEFINITION_LEGACY_SOURCE_CHANGED');
        const inspected=await applyDefinitions(db);assert.equal(inspected.changed[0].entity_id,'21');
        assert.deepEqual(await repo.getVersion(sessions.writer,old.version_id),old);
      });
      await check('owned backup and restore recover exact version and source content after simulated failure',async()=>{
        const before=(await db.execute('SELECT * FROM data_map_definition_versions ORDER BY version_id'))[0];
        const dump=fixture.backup();evidence.backup_sha256=crypto.createHash('sha256').update(dump).digest('hex');
        await db.execute("UPDATE data_map_definition_versions SET content_digest=REPEAT('0',64) WHERE version_id=?",[obj.version_id]);
        await rejects(repo.getVersion(sessions.writer,obj.version_id),'DEFINITION_VERSION_INTEGRITY_CONFLICT');
        fixture.restore(dump);
        assert.deepEqual((await db.execute('SELECT * FROM data_map_definition_versions ORDER BY version_id'))[0],before);
        assert.equal((await repo.getSource(sessions.writer,source.batch_id)).mappings.length,2);
        evidence.restore_verified=true;
      });
      evidence.final_inspect=await inspectDefinitions(db);
      evidence.legacy_object_digest=digest(await snapshot(db,'object',big));
      evidence.additive_tables=tables;
    } finally {db.release();}
  },{stage:'02'});
  evidence.finished_at=new Date().toISOString();evidence.owned_container_removed=true;evidence.status='passed';
  if(output)fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
  console.log(`P02_DEFINITIONS_PASS ${checks.length}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
