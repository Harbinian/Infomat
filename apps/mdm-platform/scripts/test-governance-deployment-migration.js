// Actual formal-entry guards and additive preparation, using only caller-owned
// fresh tmpfs MySQL targets and synthetic source rows. No existing service/DB.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed}=require('./testHelpers/dataMapHandoffFixture');
const authorization=require('../server/governanceMigrationAuthorization');
const migration=require('../server/governanceDeploymentMigration');
const compatibility=require('../server/dataMapHandoffMigration');
const terminology=require('../server/terminologyGovernanceMigration');
const handoff=require('../server/dataMapHandoffSchema');
const foundation=require('../server/processDataGovernanceMigration');
const {digest}=require('../server/dataMapDefinitionValues');
const output=path.resolve(__dirname,'../../../artifacts/3000-governance-migration-preparation-20261020-'+crypto.randomUUID());
const checks=[];
async function check(name,work){await work();checks.push({name,passed:true});console.log('PASS '+name);}
async function sourceFingerprint(target){
  const value=await compatibility.inspectCompatibilityInventory(target.pool,{owner:target.owner,database:target.database});
  const {target:ignored,...manifest}=value.manifest;
  manifest.tables=manifest.tables.filter(table=>!foundation.TABLES.includes(table.table));
  manifest.exceptions=manifest.exceptions.filter(issue=>!foundation.TABLES.includes(issue.table));
  const termRows={};for(const table of Object.keys(terminology.SOURCES))termRows[table]=await terminology.sourceRows(target.pool,table);
  return digest({manifest,termRows});
}
async function main(){
  fs.mkdirSync(output,{recursive:true});
  await check('CLI refuses implicit targets and incomplete authorization before connection',async()=>{
    const cli=require('./manage-governance-deployment');
    assert.throws(()=>cli.argumentsFor(['--inspect'],{}),/GOVERNANCE_MIGRATION_EXPLICIT_TARGET_REQUIRED/);
    assert.throws(()=>cli.argumentsFor(['--apply'],{}),/GOVERNANCE_MIGRATION_EXPLICIT_TARGET_REQUIRED/);
  });
  await withFreshMysql(async source=>{
    await seed(source,{handoff:false});
    // Planned source-column compatibility DDL must precede the immutable
    // compatibility capture. A later DDL is real drift and cannot overwrite it.
    await require('../server/processFormalControlMigration').applyMigration(source.pool,{authorized:true});
    await foundation.rollbackProcessDataGovernance(source.pool);
    await source.pool.execute("INSERT INTO terminology_term_types(code,name) VALUES('noun','Synthetic noun')");
    await source.pool.execute("INSERT INTO terminology_terms(id,term,term_type_code,definition,status) VALUES(101,'Synthetic preserved','noun','  Original definition\\n  ','approved')");
    await source.pool.execute("INSERT INTO data_map_terms(id,term,definition,scope_type,severity,status) VALUES(201,'Synthetic preserved','Other original definition','field','warn','active')");
    const [[identity]]=await source.pool.execute('SELECT @@server_uuid server_uuid');
    const options={database:source.database,serverUuid:identity.server_uuid,deploymentId:crypto.randomUUID()};
    const before=await migration.inspectGovernanceDeployment(source.pool,options),original=await sourceFingerprint(source);
    await check('dry run is read only and reports the exact target and missing additive tables',async()=>{
      assert.equal(before.applicable,true);assert.equal(before.side_effects,'none');assert.equal(before.terminology.backfill.length,2);
      assert.equal(before.work_package_foundation.preparation_plan,'create_six_empty_tables');
      assert(before.handoff_schema.tables.some(table=>table.status==='missing'));
      assert.equal((await source.pool.execute("SELECT COUNT(*) n FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tg_terms'"))[0][0].n,0);
    });
    const backup=source.backup(),backupFile=path.join(output,'synthetic-backup.sql');fs.writeFileSync(backupFile,backup);
    const backupSha256=authorization.sha256(backup);
    await withFreshMysql(async restored=>{
      restored.restore(backup);
      const [[restoredIdentity]]=await restored.pool.execute('SELECT @@server_uuid server_uuid');
      const restoredFingerprint=await sourceFingerprint(restored);
      assert.equal(restoredFingerprint,original);
      const receipt={contract:'governance-backup-restore-v1',status:'passed',source:{database:source.database,server_uuid:identity.server_uuid,container_id:source.containerId},
        backup_sha256:backupSha256,restore_target:{database:restored.database,container_id:restored.containerId},schema_verified:true,data_verified:true,
        source_inventory_sha256:original,restored_inventory_sha256:restoredFingerprint};
      const receiptFile=path.join(output,'synthetic-restore-receipt.json');fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n');
      Object.assign(options,{authorizeFormalMigration:true,authorizationReference:'synthetic-test-only',writeFenceReference:'owned-synthetic-target-no-runtime',backupFile,backupSha256,
        restoreReceiptFile:receiptFile,restoreReceiptSha256:authorization.sha256(fs.readFileSync(receiptFile)),expectedManifestDigest:before.manifest_digest});
      await check('backup restoration has matching source/schema inventories in another owned target',async()=>{assert.equal(receipt.source_inventory_sha256,receipt.restored_inventory_sha256);});
      const textPool={getConnection:async()=>{
        const db=await source.pool.getConnection();return new Proxy(db,{get(target,key){
          if(key==='execute'||key==='query')return async(...args)=>{const result=await target[key](...args);return Array.isArray(result[0])?[result[0].map(row=>Object.fromEntries(Object.entries(row).map(([name,value])=>[name,typeof value==='number'?String(value):value]))),result[1]]:result;};
          const value=target[key];return typeof value==='function'?value.bind(target):value;
        }});
      }};
      await check('native mysql2 and text-row maintenance transports produce the same source manifests',async()=>{
        const native=await migration.inspectGovernanceDeployment(source.pool,options),text=await migration.inspectGovernanceDeployment(textPool,options);
        assert.equal(native.manifest_digest,text.manifest_digest);assert.equal(native.data_map.manifest_digest,text.data_map.manifest_digest);assert.equal(native.work_package_foundation.source_rows_sha256,text.work_package_foundation.source_rows_sha256);
        const {sourceValue}=require('../server/migrationSourceValues');
        assert.equal(sourceValue('9007199254741001',{data_type:'bigint'}),'9007199254741001');assert.equal(sourceValue('1.20',{data_type:'decimal'}),'1.20');
        assert.equal(sourceValue('42',{data_type:'unknown'}),'42');assert.equal(sourceValue(null,{data_type:'int'}),null);
        assert.throws(()=>sourceValue('9007199254740993',{data_type:'int'}),{code:'MIGRATION_SOURCE_NUMERIC_INVALID'});
        assert.equal(sourceValue('1.2345',{data_type:'float'}),Math.fround(1.2345));
      });
      await check('partial foundation structure is explicit and cannot be silently completed',async()=>{
        await source.pool.execute(foundation.splitStatements(foundation.PROCESS_DATA_GOVERNANCE_SCHEMA_SQL)[0]);
        const partial=await migration.inspectGovernanceDeployment(source.pool,options);assert.equal(partial.applicable,false);assert.equal(partial.work_package_foundation.preparation_plan,'requires_manual_resolution');
        await assert.rejects(migration.applyGovernanceDeployment(source.pool,options),{code:'GOVERNANCE_MIGRATION_PRECHECK_FAILED'});
        await source.pool.execute('DROP TABLE process_data_governance_creation_tasks');
      });
      await check('wrong server UUID and altered backup or absent recovery proof refuse before DDL',async()=>{
        await assert.rejects(migration.applyGovernanceDeployment(source.pool,{...options,serverUuid:crypto.randomUUID()}),{code:'GOVERNANCE_MIGRATION_TARGET_MISMATCH'});
        await assert.rejects(migration.applyGovernanceDeployment(source.pool,{...options,backupSha256:'0'.repeat(64)}),{code:'GOVERNANCE_MIGRATION_BACKUP_REQUIRED'});
        await assert.rejects(migration.applyGovernanceDeployment(source.pool,{...options,restoreReceiptSha256:'0'.repeat(64)}),{code:'GOVERNANCE_MIGRATION_RESTORE_REQUIRED'});
        await assert.rejects(migration.applyGovernanceDeployment(source.pool,{...options,authorizeFormalMigration:false}),{code:'GOVERNANCE_MIGRATION_AUTHORIZATION_REQUIRED'});
        assert.equal((await source.pool.execute("SELECT COUNT(*) n FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tg_terms'"))[0][0].n,0);
      });
      await check('a read permit or forged JSON cannot authorize either migration writer',async()=>{
        const db=await source.pool.getConnection();try{
          const readPermit=await authorization.createMigrationPermit(db,options);
          await assert.rejects(handoff.applyHandoffSchema(db,{database:source.database,formalTargetPermit:readPermit}),{code:'GOVERNANCE_MIGRATION_PERMIT_REQUIRED'});
          await assert.rejects(terminology.applyTerminologyGovernance(db,{database:source.database,formalTargetPermit:readPermit}),{code:'GOVERNANCE_MIGRATION_PERMIT_REQUIRED'});
          await assert.rejects(compatibility.applyCompatibility({getConnection(){throw Error('must not connect');}},{formalTargetPermit:{}}),{code:'GOVERNANCE_MIGRATION_PERMIT_REQUIRED'});
        }finally{db.release();}
      });
      await check('a stale dry-run fingerprint refuses all DDL and new data',async()=>{
        await assert.rejects(migration.applyGovernanceDeployment(source.pool,{...options,expectedManifestDigest:'0'.repeat(64)}),{code:'GOVERNANCE_MIGRATION_DRY_RUN_REQUIRED'});
      });
      await check('partial DDL stays inspectable and retry uses the same original source manifest',async()=>{
        let interrupted=false;
        const faultPool={getConnection:async()=>{
          const db=await source.pool.getConnection();return new Proxy(db,{get(target,key){
            if(key==='execute')return async(sql,args)=>{if(!interrupted&&sql.startsWith('CREATE TABLE IF NOT EXISTS data_map_handoff_revisions')){interrupted=true;throw Object.assign(Error('Synthetic DDL interruption'),{code:'SYNTHETIC_DDL_INTERRUPTION'});}return target.execute(sql,args);};
            const value=target[key];return typeof value==='function'?value.bind(target):value;
          }});
        }};
        await assert.rejects(migration.applyGovernanceDeployment(faultPool,options),{code:'SYNTHETIC_DDL_INTERRUPTION'});
        const partial=await migration.inspectGovernanceDeployment(source.pool,options);
        assert.equal(partial.applicable,true,JSON.stringify({term_drift:partial.terminology.drift,term_missing:partial.terminology.missing,term_issues:partial.terminology.issues,schema:partial.handoff_schema.tables.filter(table=>table.status==='drifted'),state:partial.cutover_state}));assert.equal(partial.terminology.ready,true,JSON.stringify(partial.terminology));assert.equal(partial.manifest_digest,before.manifest_digest);
        assert(partial.handoff_schema.tables.some(table=>table.status==='missing'));assert.equal(await sourceFingerprint(source),original);
      });
      await check('authorized preparation preserves old rows/heads and creates no approvals bindings effective heads or controlled mode',async()=>{
        const result=await migration.applyGovernanceDeployment(source.pool,options);
        assert.equal(result.terminology_ready,true);assert.equal(result.handoff_schema_ready,true);assert.equal(result.cutover_state,'prepared');assert.equal(result.runtime_enabled,false);
        assert.equal(result.manifest_digest,before.manifest_digest);assert.equal(await sourceFingerprint(source),original);
        for(const table of ['data_map_effective_heads','data_map_handoff_approvals','process_data_governance_review_bindings'])assert.equal(Number((await source.pool.execute('SELECT COUNT(*) n FROM '+table))[0][0].n),0);
        assert.equal((await source.pool.execute('SELECT CAST(current_version_id AS CHAR) id FROM data_map_definition_heads'))[0][0].id,'9007199254741001');
        assert.equal(Number((await source.pool.execute('SELECT COUNT(*) n FROM tg_legacy_links'))[0][0].n),2);
        assert.equal(result.work_package_foundation_ready,true);
        for(const table of foundation.TABLES)assert.equal(Number((await source.pool.execute('SELECT COUNT(*) n FROM '+table))[0][0].n),0);
        const native=await migration.inspectGovernanceDeployment(source.pool,options),text=await migration.inspectGovernanceDeployment(textPool,options);
        assert.equal(native.manifest_digest,text.manifest_digest);assert.equal(native.data_map.manifest_digest,text.data_map.manifest_digest);
        fs.writeFileSync(path.join(output,'synthetic-preparation-receipt.json'),JSON.stringify(result,null,2)+'\n');
      });
      await check('repeat uses the registered original capture without duplicate terminology or registry rows',async()=>{
        const prior=(await source.pool.execute('SELECT COUNT(*) n FROM data_map_legacy_registry'))[0][0].n;
        assert.equal((await migration.applyGovernanceDeployment(source.pool,options)).compatibility.idempotent,true);
        assert.equal((await source.pool.execute('SELECT COUNT(*) n FROM data_map_legacy_registry'))[0][0].n,prior);
        assert.equal((await source.pool.execute('SELECT COUNT(*) n FROM tg_term_events'))[0][0].n,2);
      });
      await check('controlled state rejects preparation before any subsequent write',async()=>{
        await source.pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled' WHERE control_id=1");
        assert.equal((await migration.inspectGovernanceDeployment(source.pool,options)).applicable,false);
        await assert.rejects(migration.applyGovernanceDeployment(source.pool,options),{code:'GOVERNANCE_MIGRATION_PRECHECK_FAILED'});
        await source.pool.execute("UPDATE data_map_governance_control SET cutover_state='prepared' WHERE control_id=1");
      });
      const cutover=require('../server/governanceControlledCutover');
      const setup=await source.pool.getConnection();try{
        const permit=await authorization.createMigrationPermit(setup,options,{write:true});
        assert.equal((await require('../server/processCaseGovernanceSchema').applyMigration(setup,{permit})).ready,true);
        assert.equal((await require('../server/processFormalControlMigration').applyMigration(setup,{authorized:true})).ready,true);
        assert.equal((await cutover.prepareCutoverSchema(setup,{formalTargetPermit:permit})).ready,true);
      }finally{setup.release();}
      const [[principalRow]]=await source.pool.execute('SELECT CURRENT_USER() principal');
      const [runtimeUser,runtimeHost]=principalRow.principal.split('@'),runtimePrincipal="'"+runtimeUser+"'@'"+runtimeHost+"'";
      const markerFile=path.join(output,'synthetic-gate-contract-only.json');
      fs.writeFileSync(markerFile,JSON.stringify({synthetic_contract_fixture:true,actual_TECH01_to_TECH05_acceptance:false})+'\n');
      const reference={path:markerFile,sha256:authorization.sha256(fs.readFileSync(markerFile))};
      const evidence={schema_version:cutover.CONTRACT,target:{database:options.database,server_uuid:options.serverUuid},deployment_id:options.deploymentId,
        prepared_manifest_sha256:before.manifest_digest,artifact:{source_manifest_sha256:'1'.repeat(64),image_id:'sha256:'+'2'.repeat(64)},
        permissions:{principal:runtimePrincipal,grants_sha256:await cutover.grantsFingerprint(source.pool,runtimePrincipal),model_sha256:await cutover.permissionFingerprint(source.pool),access_model:require('../server/roleDefinitions').ACCESS_MODEL_VERSION},
        maintenance:{drained:true,all_nodes_fixed:true,write_fence_reference:options.writeFenceReference},recovery:{compatible_maintenance_build_verified:true,retain_post_cutover_data:true,plan_reference:'synthetic-only'},review_reference:'synthetic-contract-validation-only',
        technical_gates:Object.fromEntries(['TECH-01','TECH-02','TECH-03','TECH-04','TECH-05'].map(id=>[id,{status:'passed',evidence:[reference]}])),
        entrypoints:Object.fromEntries([...Array.from({length:12},(_,i)=>'W'+String(i+1).padStart(2,'0')),...Array.from({length:8},(_,i)=>'R'+String(i+1).padStart(2,'0'))].map(id=>[id,{status:'passed',covered_branches:['synthetic-contract-only'],evidence:[reference]}])),
        performance:{concurrency:10,history_rows:10000,read_p95_ms:1,write_p95_ms:1,impact_p95_ms:1,restore_elapsed_ms:1,threshold_authorization_reference:'synthetic-test-contract-only'},
        business_sample_plan:{case_id:'2',department:'经营发展部',acceptance_owner:'部门负责人',reference:'synthetic-test-contract-only'}};
      const evidenceFile=path.join(output,'synthetic-cutover-evidence.json');
      function cutoverOptions(value=evidence){fs.writeFileSync(evidenceFile,JSON.stringify(value,null,2)+'\n');return {...options,authorizeControlledCutover:true,cutoverId:options.deploymentId,evidenceFile,evidenceSha256:authorization.sha256(fs.readFileSync(evidenceFile)),expectedPreparedManifestDigest:before.manifest_digest,
        expectedArtifactSha256:value.artifact.source_manifest_sha256,expectedImageId:value.artifact.image_id,runtimePrincipal,expectedGrantsSha256:value.permissions.grants_sha256,expectedPermissionsSha256:value.permissions.model_sha256,expectedAccessModel:value.permissions.access_model};}
      await check('controlled cutover refuses missing TECH or entrypoint evidence and changed grants without changing the prepared row',async()=>{
        const missing=structuredClone(evidence);missing.technical_gates['TECH-05'].status='pending';
        await assert.rejects(cutover.applyGovernanceControlledCutover(source.pool,cutoverOptions(missing)),{code:'GOVERNANCE_CUTOVER_TECHNICAL_GATE_REQUIRED'});
        const entry=structuredClone(evidence);delete entry.entrypoints.W12;
        await assert.rejects(cutover.applyGovernanceControlledCutover(source.pool,cutoverOptions(entry)),{code:'GOVERNANCE_CUTOVER_ENTRYPOINT_REVIEW_REQUIRED'});
        const changed=structuredClone(evidence);changed.permissions.grants_sha256='0'.repeat(64);
        await assert.rejects(cutover.applyGovernanceControlledCutover(source.pool,cutoverOptions(changed)),{code:'GOVERNANCE_CUTOVER_PERMISSIONS_CHANGED'});
        assert.equal((await source.pool.execute('SELECT cutover_state FROM data_map_governance_control'))[0][0].cutover_state,'prepared');
      });
      await check('passed evidence cannot bypass missing case marker or unprepared actual formal columns',async()=>{
        const cases=require('../server/processCaseGovernanceSchema');await source.pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[cases.MIGRATION_KEY]);
        await assert.rejects(cutover.applyGovernanceControlledCutover(source.pool,cutoverOptions()),{code:'GOVERNANCE_CUTOVER_OPERATIONAL_SCHEMA_REQUIRED'});
        await source.pool.execute('INSERT INTO schema_migrations(migration_key) VALUES(?)',[cases.MIGRATION_KEY]);
        await source.pool.execute('ALTER TABLE process_design_drafts MODIFY planned_edition VARCHAR(16) NOT NULL');
        await assert.rejects(cutover.applyGovernanceControlledCutover(source.pool,cutoverOptions()),{code:'GOVERNANCE_CUTOVER_OPERATIONAL_SCHEMA_REQUIRED'});
        await source.pool.execute('ALTER TABLE process_design_drafts MODIFY planned_edition VARCHAR(16) NULL');
        assert.equal((await source.pool.execute('SELECT cutover_state FROM data_map_governance_control'))[0][0].cutover_state,'prepared');assert.equal((await source.pool.execute('SELECT COUNT(*) n FROM governance_cutover_events'))[0][0].n,0);
      });
      await check('cutover audit failure rolls the control transition back atomically',async()=>{
        const fault={getConnection:async()=>{const db=await source.pool.getConnection();return new Proxy(db,{get(target,key){
          if(key==='execute')return async(sql,args)=>{if(sql.startsWith('INSERT INTO governance_cutover_events'))throw Object.assign(Error('Synthetic cutover event failure'),{code:'SYNTHETIC_CUTOVER_EVENT_FAILURE'});return target.execute(sql,args);};
          const value=target[key];return typeof value==='function'?value.bind(target):value;
        }});}};
        await assert.rejects(cutover.applyGovernanceControlledCutover(fault,cutoverOptions()),{code:'SYNTHETIC_CUTOVER_EVENT_FAILURE'});
        assert.equal((await source.pool.execute('SELECT cutover_state FROM data_map_governance_control'))[0][0].cutover_state,'prepared');assert.equal((await source.pool.execute('SELECT COUNT(*) n FROM governance_cutover_events'))[0][0].n,0);
      });
      await check('lost cutover commit acknowledgement is explicit and the same operation recovers its fixed receipt without business acceptance',async()=>{
        let discarded=0,uncertainReleased=0;
        const lost={getConnection:async()=>{const db=await source.pool.getConnection();let cutoverWritten=false;return new Proxy(db,{get(target,key){
          if(key==='execute')return async(sql,args)=>{const result=await target.execute(sql,args);if(sql.startsWith('INSERT INTO governance_cutover_events'))cutoverWritten=true;return result;};
          if(key==='commit')return async()=>{await target.commit();if(cutoverWritten)throw Error('Synthetic commit acknowledgement lost');};
          if(key==='destroy')return ()=>{discarded++;target.destroy();};
          if(key==='release')return ()=>{if(cutoverWritten)uncertainReleased++;target.release();};
          const value=target[key];return typeof value==='function'?value.bind(target):value;
        }});}};
        const exact=cutoverOptions();await assert.rejects(cutover.applyGovernanceControlledCutover(lost,exact),{code:'GOVERNANCE_CUTOVER_COMMIT_UNKNOWN'});
        assert.equal(discarded,1);assert.equal(uncertainReleased,0);
        const receipt=await cutover.applyGovernanceControlledCutover(source.pool,exact);
        assert.equal(receipt.cutover_state,'controlled');assert.equal(receipt.idempotent,true);assert.equal(receipt.business_acceptance,'not_attested');assert.equal(receipt.runtime_flags_changed,false);
        assert.equal((await source.pool.execute('SELECT COUNT(*) n FROM governance_cutover_events'))[0][0].n,1);assert.equal(await sourceFingerprint(source),original);
      });
    },{stage:'76',randomDatabase:true});
  },{stage:'75',randomDatabase:true});
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:'passed',checks,owned_containers_removed:true,formal_database_connected:false,runtime_changed:false},null,2)+'\n');
  console.log('GOVERNANCE_DEPLOYMENT_MIGRATION_PASSED '+checks.length);console.log('EVIDENCE '+output);
}
if(require.main===module)main().catch(error=>{console.error(error.code||error.message);if(error.code==='ERR_ASSERTION')console.error(error.message);process.exitCode=1;});
module.exports={main};
