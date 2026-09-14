// Stage06 synthetic migration and recovery rehearsal. No fixed environment loader.
// Only fresh labelled tmpfs MySQL containers; never reads a supplied or historical backup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const m1 = require('../server/processV7PreviewReviewMigration');
const m2 = require('../server/processV7FormalMigration');
const sessions = require('../server/sessionMigration');
const { digest, canonicalCreateTable } = { ...require('../server/processV7M0Baseline'), ...m1 };
const { runMysqlHttpScenario } = require('./test-stage04-mysql-isolated');
const dg = require('../server/processDataGovernanceMigration');
const evidence = { stage:'06', kind:'synthetic-only', startedAt:new Date().toISOString(), steps:[], targets:[] };
const output = path.resolve(__dirname, '../../../artifacts/mdm-3000-launch', `stage06-${Date.now()}`);
fs.mkdirSync(output, {recursive:true});
const record = (name, details={}) => { evidence.steps.push({name,passed:true,...details}); console.log('PASS '+name); };
const schemaDebug=new Map();

async function baseSchema(pool, legacy=false) {
  await require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool).initSchema();
  const design=require('../server/routes/processDesignMysql');
  for(const name of ['ensureProcessDesignEditionSchema','ensureProcessDesignEvidenceStatusSchema','ensureProcessDesignFormStructureSchema','ensureProcessDesignStepTransitionSchema']) await design[name](pool);
  if(legacy) {
    await pool.execute('ALTER TABLE process_design_documents DROP INDEX uq_process_design_documents_process_ref, DROP COLUMN process_ref');
    await pool.execute('ALTER TABLE process_design_review_tasks DROP INDEX idx_process_design_review_content, DROP COLUMN content_hash, DROP COLUMN draft_revision_no');
    await pool.execute('ALTER TABLE process_design_versions MODIFY l1_name VARCHAR(255) NOT NULL, MODIFY l2_name VARCHAR(255) NOT NULL, MODIFY l3_name VARCHAR(255) NOT NULL, MODIFY content_json JSON NOT NULL');
  }
}

async function manifest(pool) {
  const [tables]=await pool.execute('SELECT TABLE_NAME AS name,TABLE_TYPE,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME');
  const [columns]=await pool.execute('SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION');
  const [indexes]=await pool.execute('SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE,IS_VISIBLE,COLLATION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX');
  const [refs]=await pool.execute('SELECT TABLE_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME');
  const result={};
  for(const table of tables) {
    const {name}=table;
    assert.match(name,/^[a-zA-Z0-9_]+$/);
    const [ddl]=await pool.execute(`SHOW CREATE TABLE \`${name}\``);
    // SHOW CREATE has the live next identifier; TABLES.AUTO_INCREMENT may be an uninitialized cached NULL.
    if(columns.some(c=>c.TABLE_NAME===name && c.EXTRA==='auto_increment')) table.AUTO_INCREMENT=Number(ddl[0]['Create Table'].match(/AUTO_INCREMENT=(\d+)/)?.[1]||1);
    const [rows]=await pool.execute(`SELECT * FROM \`${name}\``);
    const rowDigests=rows.map(digest).sort();
    const parts={table,columns:columns.filter(c=>c.TABLE_NAME===name),indexes:indexes.filter(c=>c.TABLE_NAME===name),refs:refs.filter(c=>c.TABLE_NAME===name),components:Object.fromEntries(require('../server/processV7M0Baseline').schemaComponents(ddl[0]['Create Table']))};
    const schema=digest(parts);schemaDebug.set(schema,parts);
    result[name]={count:rows.length,rows:digest(rowDigests),schema};
  }
  return result;
}

function interruptAfter(pool, pattern) {
  let interrupted=false;
  return {async execute(sql,args) {
    const result=await pool.execute(sql,args);
    if(!interrupted && pattern.test(sql)) {interrupted=true;throw Object.assign(new Error('Synthetic interruption after committed DDL'),{code:'STAGE06_INTERRUPTED'});}
    return result;
  }};
}
async function unchangedRejection(pool, action, code) {
  const before=await manifest(pool);
  await assert.rejects(action,error=>error.code===code || error.message.startsWith(code));
  assert.deepEqual(await manifest(pool),before,`${code}: rejected operation must not change rows or structure`);
}

async function regression(context) {
  const {pool}=context;
  await baseSchema(pool);
  await m1.applyProcessV7PreviewReview(pool);
  await m2.applyProcessV7FormalFoundation(pool);
  await pool.execute('ALTER TABLE process_design_documents DROP INDEX uq_process_design_documents_process_ref');
  await unchangedRejection(pool,()=>m2.applyProcessV7FormalFoundation(pool),'V7_FORMAL_MIGRATION_INCONSISTENT');
  record('M2 recorded but missing index refuses repair');
  await pool.execute('ALTER TABLE process_design_documents ADD UNIQUE KEY uq_process_design_documents_process_ref(process_ref)');
  await pool.execute("ALTER TABLE process_design_documents ALTER COLUMN process_ref SET DEFAULT 'fabricated'");
  await unchangedRejection(pool,()=>m2.applyProcessV7FormalFoundation(pool),'V7_FORMAL_SCHEMA_DRIFT');
  await pool.execute('ALTER TABLE process_design_documents ALTER COLUMN process_ref DROP DEFAULT');
  await pool.execute('ALTER TABLE process_design_documents DROP INDEX uq_process_design_documents_process_ref, ADD UNIQUE KEY uq_process_design_documents_process_ref(process_ref(10))');
  await unchangedRejection(pool,()=>m2.applyProcessV7FormalFoundation(pool),'V7_FORMAL_SCHEMA_DRIFT');
  await pool.execute('ALTER TABLE process_design_documents DROP INDEX uq_process_design_documents_process_ref, ADD UNIQUE KEY uq_process_design_documents_process_ref(process_ref)');
  record('M2 default and prefix-index drift refuse all writes');
  await pool.execute("INSERT INTO departments(id,code,name) VALUES (691,'SYNTHETIC_REGRESSION','合成回归部')");
  await pool.execute("INSERT INTO process_design_documents(document_no,document_title,process_ref,owning_department_id) VALUES ('SYNTHETIC-UNRECORDED','合成未登记使用','synthetic_unrecorded',691)");
  await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[m2.MIGRATION_KEY]);
  await unchangedRejection(pool,()=>m2.applyProcessV7FormalFoundation(pool),'V7_FORMAL_UNRECORDED_NONEMPTY');
  record('M2 unrecorded business use cannot be adopted');
}

async function seedLegacy(pool) {
  await pool.execute("INSERT INTO departments(id,code,name) VALUES (691,'SYNTHETIC_LEGACY','合成历史部')");
  await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (681,'SYNTHETIC_LEGACY','合成历史人员',691)");
  const v3=require('../server/processGovernanceV2').createEmptyProcessGovernanceDocument({process_name:'合成历史流程',owning_department:'合成历史部'});
  const normalized=require('../server/processGovernanceV2').normalizeProcessGovernanceDocument(v3);
  assert.equal(normalized.errors.length,0);
  await pool.execute("INSERT INTO process_design_documents(id,document_no,document_title,owning_department_id) VALUES (6101,'SYNTHETIC-LEGACY','合成历史流程',691)");
  await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id,status,schema_version,process_content_json,content_hash) VALUES (6201,6101,'SYNTHETIC-LEGACY','合成历史流程','A','合成历史流程','合成兼容记录','现场实际','合成历史依据',691,'published','process-governance-v3',?,?)",[JSON.stringify(v3),normalized.content_hash]);
  await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,l1_name,l2_name,l3_name,content_json,schema_version,process_content_json,content_hash) VALUES (6301,6201,6101,'SYNTHETIC-LEGACY','合成历史流程','A','SYNTHETIC-LEGACY-A',691,'合成L1','合成L2','合成L3',?,'process-governance-v3',?,?)",[JSON.stringify(v3),JSON.stringify(v3),normalized.content_hash]);
  await pool.execute("UPDATE process_design_documents SET current_version_id=6301,current_edition='A' WHERE id=6101");
  await pool.execute("INSERT INTO process_design_review_tasks(id,draft_id,status,decision_note) VALUES (6401,6201,'approved','合成历史依据；当时缺少修订摘要绑定')");
  await pool.execute("INSERT INTO process_design_events(id,draft_id,event_type,note) VALUES (6501,6201,'publish','合成历史发布事件')");
}

async function legacySnapshot(pool) {
  const result={};
  for(const [table,columns] of Object.entries(m2.LEGACY_COLUMNS)) {
    const id={process_design_documents:6101,process_design_drafts:6201,process_design_versions:6301}[table];
    const [rows]=await pool.execute(`SELECT ${columns.map(c=>`\`${c}\``).join(',')} FROM ${table} WHERE id=?`,[id]);
    result[table]={count:rows.length,digest:digest(rows)};
  }
  for(const [table,where] of [['process_design_review_tasks','id=6401'],['process_design_events','id=6501'],['person','person_id=681'],['departments','id=691']]) {
    const [rows]=await pool.execute(`SELECT * FROM ${table} WHERE ${where}`);
    // M2 adds nullable review binding columns; historic review text and identifiers stay unchanged.
    const projected=rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['draft_revision_no','content_hash'].includes(key))));
    result[table]={count:rows.length,digest:digest(projected)};
  }
  return result;
}

async function migrations(context) {
  const {pool}=context;
  const before=await legacySnapshot(pool);
  await assert.rejects(()=>m1.applyProcessV7PreviewReview(interruptAfter(pool,/CREATE TABLE IF NOT EXISTS process_v7_preview_cases/i)),{code:'STAGE06_INTERRUPTED'});
  assert.equal((await m1.inspectProcessV7PreviewReview(pool)).consistency_status,'partial_structure');
  await unchangedRejection(pool,()=>m1.applyProcessV7PreviewReview(pool),'V7_PREVIEW_MIGRATION_INCONSISTENT');
  await unchangedRejection(pool,()=>m2.applyProcessV7FormalFoundation(pool),'V7_FORMAL_M1_NOT_APPLIED');
  await m1.rollbackProcessV7PreviewReview(pool); // Empty synthetic partial table only.
  record('M1 committed-DDL interruption and partial structure stop, M2 blocked');
  await m1.applyProcessV7PreviewReview(pool);
  const first=await manifest(pool); await m1.applyProcessV7PreviewReview(pool); assert.deepEqual(await manifest(pool),first);
  record('M1 first and repeat preserve all existing rows and migration timestamps');
  await pool.execute('ALTER TABLE process_v7_preview_cases MODIFY process_ref VARCHAR(159) NOT NULL');
  await unchangedRejection(pool,()=>m1.applyProcessV7PreviewReview(pool),'V7_PREVIEW_MIGRATION_INCONSISTENT');
  await pool.execute('ALTER TABLE process_v7_preview_cases MODIFY process_ref VARCHAR(160) NOT NULL');
  await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[m1.MIGRATION_KEY]);
  await unchangedRejection(pool,()=>m1.applyProcessV7PreviewReview(pool),'V7_PREVIEW_MIGRATION_INCONSISTENT');
  // Restore the exact synthetic migration record from the test fault; never general recovery logic.
  await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)',[m1.MIGRATION_KEY]);
  await pool.execute('DROP TABLE process_v7_preview_events');
  await unchangedRejection(pool,()=>m1.applyProcessV7PreviewReview(pool),'V7_PREVIEW_MIGRATION_INCONSISTENT');
  await pool.execute(m1.PROCESS_V7_PREVIEW_SCHEMA_SQL.split(/;\s*(?:\r?\n|$)/).find(s=>/CREATE TABLE IF NOT EXISTS process_v7_preview_events/.test(s)));
  record('M1 drift and complete unrecorded structure refuse repair');
  await assert.rejects(()=>m2.applyProcessV7FormalFoundation(interruptAfter(pool,/ALTER TABLE process_design_documents ADD COLUMN/i)),{code:'STAGE06_INTERRUPTED'});
  assert.equal((await m2.inspectProcessV7FormalFoundation(pool)).applied,false);
  await assert.rejects(()=>m2.applyProcessV7FormalFoundation(interruptAfter(pool,/CREATE TABLE IF NOT EXISTS process_v7_promotions/i)),{code:'STAGE06_INTERRUPTED'});
  await m2.applyProcessV7FormalFoundation(pool);
  const second=await manifest(pool); await m2.applyProcessV7FormalFoundation(pool);assert.deepEqual(await manifest(pool),second);
  assert.deepEqual(await legacySnapshot(pool),before);
  evidence.migrationLegacyBefore=before;evidence.migrationLegacyAfter=await legacySnapshot(pool);
  record('M2 first apply resumes matching unrecorded empty DDL; repeat makes zero writes; V3/history preserved');
  await pool.execute('UPDATE process_design_versions SET l1_name=NULL WHERE id=6301');
  await unchangedRejection(pool,()=>m2.rollbackProcessV7FormalFoundation(pool),'V7_FORMAL_ROLLBACK_LEGACY_NULLS');
  await pool.execute("UPDATE process_design_versions SET l1_name='合成L1' WHERE id=6301");
  record('M2 rejects incompatible legacy NULL rollback before dropping any object');
  await assert.rejects(()=>sessions.manageSessionSchema(interruptAfter(pool,/CREATE TABLE IF NOT EXISTS mdm_http_sessions/i),'apply'),{code:'STAGE06_INTERRUPTED'});
  assert.equal((await sessions.inspectSessionSchema(pool)).state,'unrecorded');
  await pool.execute('INSERT INTO mdm_http_sessions(sid_hash,session_json,expires_at) VALUES (?, ?, ?)', ['a'.repeat(64),'{}',1]);
  await unchangedRejection(pool,()=>sessions.manageSessionSchema(pool,'apply'),'SESSION_SCHEMA_UNRECORDED_NONEMPTY');
  await pool.execute('DELETE FROM mdm_http_sessions WHERE sid_hash=?',['a'.repeat(64)]); // Remove only this synthetic interruption fixture.
  await sessions.manageSessionSchema(pool,'apply');
  const sessionFirst=await manifest(pool);await sessions.manageSessionSchema(pool,'apply');assert.deepEqual(await manifest(pool),sessionFirst);
  await pool.execute('DROP INDEX idx_mdm_http_sessions_expiry ON mdm_http_sessions');
  await unchangedRejection(pool,()=>sessions.manageSessionSchema(pool,'apply'),'SESSION_SCHEMA_DRIFT');
  await pool.execute('CREATE INDEX idx_mdm_http_sessions_expiry ON mdm_http_sessions(expires_at)');
  record('sessions interrupted empty schema resumes; repeat unchanged; index drift refused');
  // D00 scope is unresolved: prove the optional migration remains unapplied, without enabling it.
  assert.equal((await dg.inspectProcessDataGovernance(pool)).consistency_status,'not_applied');
  record('optional downstream governance remains absent; no historical work package backfill');
  const m0=await require('../server/processV7M0Baseline').inspectProcessV7M0Baseline(pool);
  assert.equal(m0.content_hash_evidence.problem_count,0);
  assert.equal(m0.reference_evidence.non_null_reference_orphan_count,0);
  evidence.m0Synthetic={formal_tables:m0.formal_tables,references:m0.reference_evidence,hashes:m0.content_hash_evidence};
}

async function restoreAndHttp(source) {
  await baseSchema(source.pool,true); await seedLegacy(source.pool);
  const before=await manifest(source.pool);
  evidence.preMigrationManifest=before;
  const startedAt=new Date().toISOString();const dump=source.backup();
  assert.deepEqual(await manifest(source.pool),before);
  fs.writeFileSync(path.join(output,'synthetic-pre-migration.sql'),dump,{flag:'wx'});
  evidence.backup={kind:'synthetic-only',source:{host:'127.0.0.1',port:source.port,database:source.database,containerId:source.containerId},startedAt,finishedAt:new Date().toISOString(),bytes:dump.length,sha256:require('node:crypto').createHash('sha256').update(dump).digest('hex'),path:path.join(output,'synthetic-pre-migration.sql')};
  await withFreshMysql(async target=>{
    evidence.targets.push({host:'127.0.0.1',port:target.port,database:target.database,containerId:target.containerId,owner:target.owner});
    target.restore(dump);
    const restoredManifest=await manifest(target.pool);
    const mismatch=Object.keys(before).find(name=>before[name].schema!==restoredManifest[name]?.schema);
    if(mismatch)evidence.schemaMismatch={table:mismatch,source:schemaDebug.get(before[mismatch].schema),restored:schemaDebug.get(restoredManifest[mismatch]?.schema)};
    assert.deepEqual(restoredManifest,before);
    evidence.backup.restoreVerifiedBeforeMigration=true;
    record('synthetic logical backup restores to independent fresh MySQL: all table schemas/counts/row digests identical');
    const historicalBefore=await legacySnapshot(target.pool);
    evidence.http=await runMysqlHttpScenario(target,{
      prepareSchema:migrations,
      onRuntime:runtime=>{evidence.runtime=runtime;},
      afterHttp:async ({pool,expect})=>{
        await unchangedRejection(pool,()=>m1.rollbackProcessV7PreviewReview(pool),'V7_PREVIEW_ROLLBACK_NONEMPTY');
        await unchangedRejection(pool,()=>m2.rollbackProcessV7FormalFoundation(pool),'V7_FORMAL_ROLLBACK_NONEMPTY');
        await unchangedRejection(pool,()=>sessions.manageSessionSchema(pool,'rollback'),'SESSION_ROLLBACK_NONEMPTY');
        const current=await legacySnapshot(pool);
        // Compare the original rows, not later synthetic HTTP additions.
        assert.deepEqual(current,historicalBefore);
        const legacyContent=await expect('lead','/api/process-design/versions/6301/content','GET',undefined,200);
        assert.equal(legacyContent.document.process.process_name,'合成历史流程');
        const [legacyReview]=await pool.execute('SELECT draft_revision_no,content_hash FROM process_design_review_tasks WHERE id=6401');
        assert.deepEqual(legacyReview[0],{draft_revision_no:null,content_hash:null});
        record('populated M1/M2/session rollback rejected with zero changes; historical review binding remains NULL');
        const preRepeat=await manifest(pool);await m1.applyProcessV7PreviewReview(pool);await m2.applyProcessV7FormalFoundation(pool);await sessions.manageSessionSchema(pool,'apply');
        assert.deepEqual(await manifest(pool),preRepeat);
        record('applied populated M1/M2/sessions repeat without rebuilding or changing data');
        const inspection=require('./inspect-launch-stage06');
        const c=await pool.getConnection();let report;
        try {
          await c.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
          report=await inspection.inspectTarget(c);await c.rollback();
        }finally{c.release();}
        assert.equal(report.unavailable.length,0,JSON.stringify(report.unavailable));
        assert.equal(report.metadataStable,true);assert.ok(Object.values(report.references).every(count=>count===0));
        assert.equal(report.migrations.m0.content_hash_evidence.problem_count,0);
        assert.ok(report.previewContentHashes.every(row=>row.matching));
        assert.equal(report.ddlAuthorized,false);assert.equal(report.formalRestoreVerified,false);
        fs.writeFileSync(path.join(output,'synthetic-inspection-report.json'),JSON.stringify(report,null,2)+'\n');
        record('exact-target report queries execute in real read-only MySQL transaction; all references and native content hashes match');
        const all=await manifest(pool);evidence.postHttpManifest=all;const afterDump=target.backup();
        await withFreshMysql(async restored=>{
          restored.restore(afterDump);assert.deepEqual(await manifest(restored.pool),all);
          evidence.postHttpRestore={sourceContainer:target.containerId,targetContainer:restored.containerId,port:restored.port,tableCount:Object.keys(all).length,matched:true};
        },{stage:'06'});
        record('post-migration V3/V7/preview/review/session data restore to independent MySQL with identical full row digests');
      }
    });
  },{stage:'06'});
}

async function main() {
  try {
    await withFreshMysql(regression,{stage:'06'});
    await withFreshMysql(restoreAndHttp,{stage:'06'});
    evidence.passed=true;
  } catch(error) {
    evidence.passed=false; evidence.failure={code:error.code||error.name,message:String(error.message).slice(0,1800)};
    throw error;
  } finally {
    evidence.finishedAt=new Date().toISOString();
    fs.writeFileSync(path.join(output,'test-results.json'),JSON.stringify(evidence,null,2)+'\n');
    console.log('STAGE06_EVIDENCE '+output);
  }
}
if(require.main===module) main().catch(error=>{console.error(error.code||error.name,String(error.message).slice(0,1800));process.exitCode=1;});
module.exports={baseSchema,manifest,interruptAfter,unchangedRejection};
