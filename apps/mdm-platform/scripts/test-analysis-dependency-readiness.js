// Owned UUID/tmpfs MySQL and random HTTP only. Synthetic inputs; no private env,
// formal target, DDL during probes, recovery, lease changes or unrelated services.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {fork,spawnSync}=require('node:child_process'),{once}=require('node:events');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated'),{isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const {makeDataMapDefinitionRepository}=require('../server/dataMapDefinitionRepository'),diagnostics=require('../server/analysisDependencyReadiness');
const {document}=require('./testHelpers/v7AnalysisSamples'),rules=require('../server/v7AnalysisRules');
const index=process.argv.indexOf('--output'),out=path.resolve(process.argv[index+1]||'.');
assert(index>=0&&out.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const checks=[],uuid=()=>crypto.randomUUID(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),save=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2));
async function check(n,fn){await fn();checks.push(n);console.log('PASS '+n);}
async function waitFor(fn,ms=30000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(30);}throw Error('TEST_TIMEOUT');}
async function main(){await withStage05Fixture(async({pool,expect,request,backup,restore,fixture})=>{
 const c=pool.pool.config.connectionConfig,env=isolatedEnvironment({MYSQL_HOST:c.host,MYSQL_PORT:String(c.port),MYSQL_USER:c.user,MYSQL_PASSWORD:c.password,MYSQL_DATABASE:c.database}),target=`${c.host}:${c.port}/${c.database}`;
 const lead={personId:82,accountId:182,authVersion:1},repo=makeDataMapDefinitionRepository(pool),children=new Set(),events=[];
 const cli=(args,override={})=>spawnSync(process.execPath,[path.join(__dirname,'analysis-worker.js'),...args],{env:{...env,...override},windowsHide:true,encoding:'utf8',timeout:20000});
 const status=(override={})=>{const r=cli(['status','--target',target],override);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 function start(override={}){const p=fork(path.join(__dirname,'analysis-worker.js'),['start','--target',target],{env:{...env,...override},silent:true,windowsHide:true,execArgv:[]});children.add(p);p.on('exit',()=>children.delete(p));p.stdout.on('data',b=>String(b).trim().split('\n').forEach(s=>{try{events.push({owned_pid:p.pid,...JSON.parse(s)});}catch{}}));p.stderr.on('data',b=>events.push({owned_pid:p.pid,error:String(b).trim()}));return p;}
 async function stop(p){if(p.exitCode!==null||p.signalCode!==null)return;const e=once(p,'exit');p.send('stop');const t=setTimeout(()=>p.kill('SIGKILL'),10000);await e;clearTimeout(t);}
 const db=await pool.getConnection();try{await require('../server/todoTermSourceMigration').manageTodoTermSource(db,'apply');}finally{db.release();}
 try{
 await check('core ready is separate; absent analysis not_ready and CLI no registration',async()=>{
   assert.equal((await request('lead','/api/ready')).body.ready,true);
   const r=cli(['inspect','--target',target]);assert.equal(r.status,1);const s=JSON.parse(r.stdout);assert.equal(s.readiness.state,'not_ready');assert.equal(s.queue,null);assert.equal(s.worker_state,'not_checked');save('absent-analysis.json',s);
   const start=cli(['start','--target',target]);assert.equal(start.status,1);assert.equal(start.stderr.trim(),'ANALYSIS_DEPENDENCY_UNAVAILABLE');
 });
 const db=await pool.getConnection();try{for(const [file,fn] of [['dataMapDefinitionMigration','applyDefinitions'],['v7MappingMigration','applyV7Mappings'],['designHandofaNFigration','applyDesignHandoffs'],['analysisRunMigration','applyAnalysisRuns'],['analysisQueueMigration','applyAnalysisQueue']])await require('../server/'+file)[fn](db);}finally{db.release();}
 const sources={};sources.upload=await repo.registerV7Source(lead,{request_id:uuid(),source_kind:'uploaded_material',original_name:'synthetic.json'},Buffer.from(JSON.stringify(document())));
 const makePayload=s=>({request_id:uuid(),inputs:[{input_key:'source',kind:'v7_source',ref_id:s.source_id}],check_scope:{description:'合成依赖核对',check_ids:rules.CHECKS},rule_version:rules.VERSION,parser_versions:{[rules.PARSER]:rules.VERSION},steps:[{step_key:'v7',parser_key:rules.PARSER,input_keys:['source'],check_ids:rules.CHECKS}]});
 await check('prepared storage with disabled optional sources is not a worker process or business acceptance',async()=>{
   const s=status();assert.equal(s.readiness.ready,true);assert.equal(s.worker_state,'not_registered');assert.equal(s.worker_process,'not_checked');assert.equal(s.readiness.source_content_identity_scope,'not_checked');save('prepared-no-worker.json',s);
   const caps=await expect('lead','/api/analysis/capabilities','GET');assert.equal(caps.can_create,true);
   await diagnostics.inspectionScope(pool,()=>diagnostics.assertAnalysisStorage(pool,{queue:false}));
 });
 await check('every selected storage marker independently missing refuses active consumption/start with no writes',async()=>{
   for(const file of ['dataMapDefinitionSchema','v7MappingSchema','designHandoffSchema','analysisRunSchema','analysisQueueSchema']){
     const marker=require('../server/'+file).MIGRATION_KEY;await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[marker]);
     try{const r=cli(['inspect','--target',target]);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).readiness.ready,false);const x=await request('lead','/api/analysis/runs','POST',makePayload(sources.upload));assert.equal(x.status,503);assert(!JSON.stringify(x.body).includes('SELECT'));const start=cli(['start','--target',target]);assert.equal(start.status,1);assert.equal((await pool.execute('SELECT COUNT(*) count FROM data_map_analysis_workers'))[0][0].count,0);}
     finally{await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)',[marker]);}
   }
 });
 await check('missing P02/P07/P08/P09/partial queue structure diagnosed, core unaffected where not core-consumed',async()=>{
   for(const table of ['data_map_definition_requests','data_map_v7_mapping_versions','data_map_design_handoff_refs','data_map_analysis_findings','data_map_analysis_queue_events']){
     // Rename and restore only owned synthetic tables; probes perform no DDL.
     await pool.query(`RENAME TABLE ${table} TO synthetic_missing_${table}`);
     try{const s=cli(['status','--target',target]);assert.equal(s.status,1);assert.equal(JSON.parse(s.stdout).queue,null);const r=await request('lead','/api/analysis/runs','POST',makePayload(sources.upload));assert.equal(r.status,503);assert.equal(cli(['start','--target',target]).status,1);}
     finally{await pool.query(`RENAME TABLE synthetic_missing_${table} TO ${table}`);}
   }
 });
 await check('column/type/unknown structure drift rejected without defaults or markers',async()=>{
   for(const [table,column] of [['data_map_v7_sources','validation_json'],['data_map_analysis_workers','heartbeat_at']]){
     await pool.query(`ALTER TABLE ${table} RENAME COLUMN ${column} TO synthetic_missing_${column}`);
     try{assert.equal((await diagnostics.inspectAnalysisStorage(pool)).ready,false);assert.equal(cli(['start','--target',target]).status,1);assert.equal((await request('lead','/api/analysis/runs','POST',makePayload(sources.upload))).status,503);}
     finally{await pool.query(`ALTER TABLE ${table} RENAME COLUMN synthetic_missing_${column} TO ${column}`);}
   }
   for(const [table,column,type,original] of [['data_map_definition_requests','action','VARCHAR(64) NOT NULL','VARCHAR(32) NOT NULL'],['data_map_v7_sources','validation_status','VARCHAR(64) NOT NULL','VARCHAR(24) NOT NULL'],['data_map_analysis_workers','runtime_json','LONGTEXT NOT NULL','JSON NOT NULL'],['person','status','VARCHAR(64) NOT NULL DEFAULT \'active\'','VARCHAR(32) NOT NULL DEFAULT \'active\'']]){
     await pool.query(`ALTER TABLE ${table} MODIFY ${column} ${type}`);
     try{assert.equal((await diagnostics.inspectAnalysisStorage(pool)).ready,false);assert.equal(cli(['start','--target',target]).status,1);assert.equal((await request('lead','/api/analysis/runs','POST',makePayload(sources.upload))).status,503);}
     finally{await pool.query(`ALTER TABLE ${table} MODIFY ${column} ${original}`);}
   }
   await pool.query('ALTER TABLE data_map_analysis_steps ADD synthetic_unknown INT NULL');
   try{assert.equal((await diagnostics.inspectAnalysisStorage(pool)).ready,false);}finally{await pool.query('ALTER TABLE data_map_analysis_steps DROP synthetic_unknown');}
   await pool.query('ALTER TABLE data_map_analysis_steps ADD INDEX synthetic_unknown_index(status)');
   try{await assert.rejects(diagnostics.inspectionScope(pool,()=>diagnostics.assertAnalysisStorage(pool,{queue:false})),e=>e.statusCode===503);}finally{await pool.query('ALTER TABLE data_map_analysis_steps DROP INDEX synthetic_unknown_index');}
   await pool.query('ALTER TABLE data_map_definition_requests ENGINE=MyISAM');
   try{assert.equal((await diagnostics.inspectAnalysisStorage(pool)).ready,false);}finally{await pool.query('ALTER TABLE data_map_definition_requests ENGINE=InnoDB');}
   await pool.query('ALTER TABLE data_map_analysis_queue_events DROP FOREIGN KEY fk_dm_aqe_run');
   try{assert.equal((await diagnostics.inspectAnalysisStorage(pool)).ready,false);}finally{await pool.query('ALTER TABLE data_map_analysis_queue_events ADD CONSTRAINT fk_dm_aqe_run FOREIGN KEY(run_id) REFERENCES data_map_analysis_queue(run_id)');}
 });
 await check('P07 source list/read refuses missing marker, empty list never masquerades as successful coverage',async()=>{
   const marker=require('../server/v7MappingSchema').MIGRATION_KEY;await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[marker]);
   try{for(const url of ['/api/analysis/sources','/api/analysis/sources/v7_source/'+sources.upload.source_id])assert.equal((await request('lead',url)).status,503);}finally{await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)',[marker]);}
 });
 await check('inspect/status are only SELECT/SHOW; rows, leases, registration and markers untouched',async()=>{
   const seen=[],spy={execute:(sql,p)=>{seen.push(sql);return pool.execute(sql,p);},query:(sql,p)=>{seen.push(sql);return pool.query(sql,p);}};
   const before=await snapshot(pool);await diagnostics.inspectWorkerDependencies(spy,env);await diagnostics.readWorkerStatus(spy);await diagnostics.inspectionScope(spy,()=>diagnostics.assertAnalysisStorage(spy));assert(seen.every(s=>/^\s*(SELECT|SHOW)\b/i.test(s)));assert.deepEqual(await snapshot(pool),before);save('sql-spy.json',{statements:seen.length,select_show_only:true,unchanged:true});
 });
 await check('target mismatch/unknown/duplicate/UUID parameters rejected before any DB and unsupported config not_checked',async()=>{
   for(const args of [['status','--target','wrong:1/x'],['inspect','--target',target,'--unknown'],['start','--target',target,'--target',target],['stop','--target',target],['stop','--worker-id','1','--target',target],['status','--worker-id',uuid(),'--target',target]])assert.equal(cli(args).status,1);
   const r=cli(['inspect','--target',target],{MDM_IDENTITY_READ_MODEL:'sqlite'});assert.equal(r.status,1);const s=JSON.parse(r.stdout);assert.equal(s.readiness.reason,'CONFIG_UNSUPPORTED');assert.equal(s.readiness.storage.state,'not_checked');
   const unavailable=cli(['status','--target',target],{MYSQL_USER:'synthetic_missing_user'});assert.equal(unavailable.status,1);const u=JSON.parse(unavailable.stdout);assert.equal(u.readiness.state,'not_checked');assert.equal(u.readiness.reason,'DIAGNOSTIC_UNAVAILABLE');assert.equal(u.workers,null);assert(!unavailable.stdout.includes('synthetic_missing_user'));
   const noEnv=spawnSync(process.execPath,[path.join(__dirname,'analysis-worker.js'),'status','--target',target],{env:isolatedEnvironment(),encoding:'utf8',windowsHide:true});assert.equal(noEnv.status,1);assert.equal(noEnv.stdout,'');
 });
 let successful;
 await check('real owned worker registration recent heartbeat singleton actual exit; prior success retained',async()=>{
   const run=await repo.createQueuedAnalysis(lead,makePayload(sources.upload));const child=start();const ev=await waitFor(()=>events.find(e=>e.owned_pid===child.pid&&e.event==='worker_started'));
   const s=status();assert.equal(s.workers.find(w=>w.worker_id===ev.worker_id).diagnostic_state,'heartbeat_recent');assert.equal(s.workers[0].process_state,'not_checked');
   const runtime=s.workers.find(w=>w.worker_id===ev.worker_id).runtime_json;assert.equal(runtime.dependency_check_version,'analysis-dependency-readiness-v1');assert.equal(runtime.code_sha256['analysisDependencyReadiness.js'],crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../server/analysisDependencyReadiness'))).digest('hex'));
   const duplicate=start();await once(duplicate,'exit');assert.equal(duplicate.exitCode,1);assert(events.some(e=>e.owned_pid===duplicate.pid&&e.error==='ANALYSIS_WORKER_BUSY'));
   successful=await waitFor(async()=>{const r=await repo.getAnalysisRun(lead,run.run_id);return r.status==='succeeded'?r:null;});
   const stopped=cli(['stop','--worker-id',ev.worker_id,'--target',target]);assert.equal(stopped.status,0);await once(child,'exit');assert.equal(child.exitCode,0);assert.equal(status().workers.find(w=>w.worker_id===ev.worker_id).diagnostic_state,'stopped');save('successful-run.json',successful);
 });
 await check('expired/future heartbeats and interrupted owned process never claim process liveness',async()=>{
   const child=start();const ev=await waitFor(()=>events.find(e=>e.owned_pid===child.pid&&e.event==='worker_started'));const ended=once(child,'exit');child.kill('SIGKILL');await ended;
   await pool.execute('UPDATE data_map_analysis_workers SET heartbeat_at=TIMESTAMPADD(SECOND,-20,UTC_TIMESTAMP(3)) WHERE worker_id=?',[ev.worker_id]);assert.equal(status().workers.find(w=>w.worker_id===ev.worker_id).diagnostic_state,'heartbeat_expired');
   await pool.execute('UPDATE data_map_analysis_workers SET heartbeat_at=TIMESTAMPADD(SECOND,20,UTC_TIMESTAMP(3)) WHERE worker_id=?',[ev.worker_id]);assert.equal(status().workers.find(w=>w.worker_id===ev.worker_id).diagnostic_state,'heartbeat_invalid');assert.deepEqual(await repo.getAnalysisRun(lead,successful.run_id),successful);
 });
 await check('native V8 unsupported 409; no orphan run or successful zero-coverage result',async()=>{
   const d=document();d.schema_version='process-governance-v8';const s=await repo.registerV7Source(lead,{request_id:uuid(),source_kind:'uploaded_material',original_name:'synthetic-v8.json'},Buffer.from(JSON.stringify(d)));
   const before=await snapshot(pool);const r=await request('lead','/api/analysis/runs','POST',makePayload(s));assert.equal(r.status,409);assert.equal(r.body.code,'DEFINITION_ANALYSIS_SOURCE_FORMAT_UNSUPPORTED');assert.deepEqual(await snapshot(pool),before);
 });
 await check('current auth/scope revoked or admin stacked cannot consume/write fixed sources',async()=>{
   await assert.rejects(repo.getAnalysisRun({...lead,authVersion:99},successful.run_id),e=>e.statusCode===401);
   assert.equal((await request('outsider','/api/analysis/runs/'+successful.run_id)).status,404);
   assert.equal((await request('adminMulti','/api/analysis/runs','POST',makePayload(sources.upload))).status,403);
 });
 await check('fixed preview/published dependency flags and marker checked only on consumption',async()=>{
   const detail=await expect('contact','/api/process-v7-preview/cases','POST',{document:fixture.document,source_file_name:'synthetic-fixed.json'},201);
   // The real fixture preview is a fixed synthetic source; no business promotion.
   const [[revision]]=await pool.execute('SELECT CAST(id AS CHAR) revision_id,CAST(case_id AS CHAR) case_id FROM process_v7_preview_revisions ORDER BY id LIMIT 1');assert(revision);
   const old=process.env.PROCESS_V7_PREVIEW_ENABLED;process.env.PROCESS_V7_PREVIEW_ENABLED='1';
   try{sources.preview=await repo.registerV7Source(lead,{request_id:uuid(),source_kind:'preview_revision',...revision});await repo.createQueuedAnalysis(lead,makePayload(sources.preview));
     const disabled=cli(['inspect','--target',target]);assert.equal(disabled.status,1);assert.equal(JSON.parse(disabled.stdout).readiness.fixed_sources.preview_revision.state,'disabled');
     assert.equal(cli(['start','--target',target]).status,1);
     assert.equal(status({PROCESS_V7_PREVIEW_ENABLED:'1'}).readiness.ready,true);
     const marker=require('../server/processV7PreviewReviewMigration').MIGRATION_KEY;await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[marker]);
     try{assert.equal(cli(['start','--target',target],{PROCESS_V7_PREVIEW_ENABLED:'1'}).status,1);assert.equal((await request('lead','/api/analysis/sources/v7_source/'+sources.preview.source_id)).status,503);}
     finally{await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)',[marker]);}
     await pool.query('ALTER TABLE process_v7_preview_revisions MODIFY content_hash VARCHAR(80) NOT NULL');
     try{assert.equal((await diagnostics.inspectFixedReference(pool,'preview_revision',{PROCESS_V7_PREVIEW_ENABLED:'1'})).ready,false);assert.equal((await request('lead','/api/analysis/sources/v7_source/'+sources.preview.source_id)).status,503);}finally{await pool.query('ALTER TABLE process_v7_preview_revisions MODIFY content_hash CHAR(64) NOT NULL');}
     const formal=require('../server/processV7FormalMigration').MIGRATION_KEY;
     assert.equal((await diagnostics.inspectFixedReference(pool,'published_version',{PROCESS_V7_FORMAL_ENABLED:'0'})).state,'disabled');
     assert.equal((await diagnostics.inspectFixedReference(pool,'published_version',{PROCESS_V7_FORMAL_ENABLED:'1'})).ready,true);
     const bind={expected_revision_no:detail.revision.revision_no,expected_content_hash:detail.revision.content_hash};
     for(const who of ['reviewA','reviewB'])for(const item of detail.items)await expect(who,'/api/process-v7-preview/items/'+item.id+'/decision','POST',{...bind,decision:'confirmed',basis:'本期合成核对依据'});
     const promoted=await expect('lead','/api/process-v7-preview/cases/'+detail.case.id+'/promote','POST',{...bind,target:{mode:'create',document_no:'P25-DEPENDENCY-SYNTHETIC',document_title:'合成固定来源'}},201);
     const binding={expected_revision_no:promoted.draft.revision_no,expected_content_hash:promoted.draft.content_hash};
     const submit=await expect('contact','/api/process-design/drafts/'+promoted.draft.id+'/submit','POST',binding);
     await expect('reviewA','/api/process-design/review-tasks/'+submit.reviewTask.id+'/decision','POST',{...binding,decision:'approve',note:'合成隔离审核'});
     const pub=await expect('lead','/api/process-design/drafts/'+promoted.draft.id+'/publish','POST',binding);
     const savedFormal=process.env.PROCESS_V7_FORMAL_ENABLED;process.env.PROCESS_V7_FORMAL_ENABLED='1';
     try{sources.published=await repo.registerV7Source(lead,{request_id:uuid(),source_kind:'published_version',process_version_id:String(pub.process_version_id)});await repo.createQueuedAnalysis(lead,makePayload(sources.published));}
     finally{if(savedFormal===undefined)delete process.env.PROCESS_V7_FORMAL_ENABLED;else process.env.PROCESS_V7_FORMAL_ENABLED=savedFormal;}
     const pending=status({PROCESS_V7_PREVIEW_ENABLED:'1',PROCESS_V7_FORMAL_ENABLED:'1'});assert.equal(pending.readiness.fixed_sources.published_version.ready,true);
     await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[formal]);
     try{assert.equal((await diagnostics.inspectFixedReference(pool,'published_version',{PROCESS_V7_FORMAL_ENABLED:'1'})).ready,false);assert.equal((await request('lead','/api/analysis/sources/v7_source/'+sources.published.source_id)).status,503);assert.equal(cli(['start','--target',target],{PROCESS_V7_PREVIEW_ENABLED:'1',PROCESS_V7_FORMAL_ENABLED:'1'}).status,1);assert.equal((await diagnostics.inspectFixedReference(pool,'uploaded_material',{})).ready,true);}finally{await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)',[formal]);}
     save('pending-fixed-source-readiness.json',pending.readiness);
   }finally{if(old===undefined)delete process.env.PROCESS_V7_PREVIEW_ENABLED;else process.env.PROCESS_V7_PREVIEW_ENABLED=old;}
 });
 await check('synthetic restore preserves IDs JSON markers queued/successful history and worker diagnostics',async()=>{
   await sleep(30);const before=await snapshot(pool,true),dump=backup();restore(dump);assert.deepEqual(await snapshot(pool,true),before);save('restore.json',{allMatch:true,tables:Object.keys(before).length,before,after:await snapshot(pool,true),dump_persisted:false});
 });
 save('results.json',{passed:true,checks,owned_mysql:true,owned_http:true,real_owned_worker:true,formal_target:'not_checked',business_acceptance:false});
 }finally{for(const child of children)await stop(child);save('worker-events.json',events);save('cleanup.json',{owned_children_remaining:children.size});}
},{evidenceDir:out,randomDatabase:true});}
async function snapshot(pool,includeSessions=false){const [tables]=await pool.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");const result={};for(const t of tables){if(!includeSessions&&t.TABLE_NAME==='mdm_http_sessions')continue;const [rows]=await pool.query('SELECT * FROM '+t.TABLE_NAME);const normalized=rows.map(r=>require('../server/dataMapDefinitionValues').json(r)).sort();result[t.TABLE_NAME]={count:rows.length,digest:crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex')};}return result;}
if(require.main===module)main().catch(e=>{save('failure.json',{code:e.code,message:e.message,stack:e.stack,checks});console.error(e.code||e.message);process.exitCode=1;});
