// Owned synthetic public repository contract. Requires --output in its dispatched
// run with source-baseline.json. The unchanged execution guard permits only fresh
// UUID/tmpfs mysql:8.4 resources, original CREATE and synthetic data; writes all
// evidence inside that run and cleans connections/container/port in finally.
// No HTTP, worker, AI, ordinary connection, runtime DDL or real configuration.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const cp = require('node:child_process'), net = require('node:net'), Module = require('node:module');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { ROLE_GUIDES, ACCESS_MODEL_VERSION } = require('../server/roleDefinitions');
const { json, digest, parse } = require('../server/dataMapDefinitionValues');
const schemas = ['dataMapDefinitionSchema', 'v7MappingSchema', 'designHandoffSchema', 'analysisRunSchema', 'analysisIssueSchema', 'analysisTaskSchema', 'analysisClosureSchema', 'wordEvidenceSchema'];
const schemaModules = schemas.map(m => require('../server/' + m));
const queueSchema = require('../server/analysisQueueSchema');
const P = '9007199254740992', N = '9007199254740993', D = '9007199254741100', E = '9007199254741101';
const people = [
  { personId: 7, accountId: 107, authVersion: 1, role: 'mdm_lead' },
  { personId: 8, accountId: 108, authVersion: 1, role: 'mdm_lead' },
  { personId: 9, accountId: 109, authVersion: 1, role: 'admin' },
  { personId: 10, accountId: 110, authVersion: 1, role: 'admin', extra: 'mdm_lead' },
  { personId: 11, accountId: 111, authVersion: 1, role: 'department_contact', dept: '92' },
  { personId: 12, accountId: 112, authVersion: 1, role: 'department_contact' },
  { personId: 13, accountId: 113, authVersion: 1, role: null },
  { personId: P, accountId: '9007199254741300', authVersion: '9007199254741400', role: 'mdm_lead', dept: D },
  { personId: N, accountId: '9007199254741301', authVersion: '9007199254741401', role: 'mdm_lead', dept: E }
];
const session = value => { const p = people.find(p => String(p.personId) === String(value)); return { identityKind: 'person', personId: p.personId, userId: p.personId, accountId: p.accountId, authVersion: p.authVersion }; };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const errorValue = e => ({ code: e.code, statusCode: e.statusCode, message: e.message, name: e.name, errno: e.errno, sqlState: e.sqlState });
const at = process.argv.indexOf('--output'); assert(at > 0, '--output required');
const output = path.resolve(process.argv[at + 1]), run = path.dirname(output);
assert.match(path.basename(run), /^B02-\d+-[a-f0-9]+$/); assert(!fs.existsSync(output), 'evidence is append only'); fs.mkdirSync(output);
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const manifest = JSON.parse(fs.readFileSync(path.join(run, 'source-baseline.json')));
const input = manifest.files.find(f => f.path === 'apps/mdm-platform/server/analysisQueue.js');
assert.equal(sha(fs.readFileSync(input.snapshot)), input.sha256);
const filename = require.resolve('../server/analysisQueue'), archived = new Module(filename, module);
archived.filename = filename; archived.paths = Module._nodeModulePaths(path.dirname(filename)); archived._compile(fs.readFileSync(input.snapshot, 'utf8'), filename);
const checks = [], operations = [], negatives = [], waits = [], precision = [];
let target, active, fault, beforeCommit;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uuid = () => crypto.randomUUID();
async function check(name, fn) { await fn(); checks.push(name); save('check-'+String(checks.length).padStart(2,'0')+'.json',{name,completedAt:new Date().toISOString()}); console.log('PASS ' + name); }
async function main() {
  try {
    await withFreshMysql(async ctx => {
      const { pool, owner, database, containerId, port, backup, restore } = ctx;
      target = { owner, database, containerId, port, host: '127.0.0.1', stage: '02', image: 'mysql:8.4', pull: 'never', tmpfs: true };
      save('owned-target.json', target);
      const ddl = new Map(splitSqlStatements(mdmMysqlSchemaSql()).map(s => [s.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)?.[1], s]));
      for (const s of [...schemaModules.flatMap(m => m.statements()), ...queueSchema.statements(), ...require('../server/officeSchema').officeSchemaStatements()]) ddl.set(s.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1], s);
      const created = new Set(), casts = new Map();
      async function create(t) {
        if (created.has(t)) return; assert(ddl.has(t), 'reviewed CREATE ' + t); created.add(t);
        const s = ddl.get(t); assert.match(s, /^CREATE TABLE IF NOT EXISTS /);
        for (const m of s.matchAll(/REFERENCES\s+(\w+)\s*\(/g)) if (m[1] !== t) await create(m[1]);
        await pool.query(s);
        const [cols] = await pool.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND DATA_TYPE IN ('bigint','datetime','timestamp') ORDER BY ORDINAL_POSITION", [t]);
        casts.set(t, cols.map(c => 'CAST(`' + c.COLUMN_NAME + '` AS CHAR) AS `' + c.COLUMN_NAME + '`').join(','));
      }
      for (const t of [...require('../server/dataMapDefinitionMigration').baseTables, ...require('../server/analysisDependencyReadiness').identityTables, ...schemaModules.flatMap(m => m.tables), ...queueSchema.tables, 'org_unit', 'mdm_todo_office_assignments', 'process_governance_issue_events', 'mdm_todo_events']) await create(t);
      save('reviewed-create-fixture.json', [...created].sort().map(t => ({ table: t, sql: ddl.get(t), sha256: sha(ddl.get(t)) })));
      for (const m of [...schemaModules,queueSchema]) await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [m.MIGRATION_KEY]);
      for (const d of ['91', '92', D, E]) await pool.execute('INSERT INTO departments(id,code,name,path) VALUES (CAST(? AS SIGNED),?,?,?)', [d, 'D' + d, 'synthetic ' + d, '/' + d + '/']);
      for (const r of ROLE_GUIDES) {
        await pool.execute('INSERT INTO roles(role_code,role_name,model_version,role_group) VALUES (?,?,?,?)', [r.code, r.name, ACCESS_MODEL_VERSION, r.code === 'admin' ? 'system' : 'mdm']);
        for (const p of r.permissions) {
          await pool.execute('INSERT IGNORE INTO permissions(perm_code,resource,action) VALUES (?,?,?)', [p.code, p.resource, p.action]);
          await pool.execute("INSERT INTO role_permissions(role_id,perm_id,effect) SELECT r.role_id,p.perm_id,'allow' FROM roles r JOIN permissions p ON p.perm_code=? WHERE r.role_code=?", [p.code, r.code]);
        }
      }
      for (const p of people) {
        await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (CAST(? AS SIGNED),?,?,CAST(? AS SIGNED))', [String(p.personId), 'P' + p.personId, 'synthetic ' + p.personId, p.dept || '91']);
        await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (CAST(? AS SIGNED),CAST(? AS SIGNED),?,'synthetic-unused','active',0,CAST(? AS SIGNED))", [String(p.accountId), String(p.personId), 'P' + p.personId, String(p.authVersion)]);
        for (const r of [p.role, p.extra].filter(Boolean)) await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT CAST(? AS SIGNED),role_id,?,CAST(? AS SIGNED),'synthetic B02',CURRENT_DATE FROM roles WHERE role_code=?", [String(p.personId), !p.scoped && ['admin', 'mdm_lead'].includes(r) ? 'global' : 'department', !p.scoped && ['admin', 'mdm_lead'].includes(r) ? null : p.dept || '91', r]);
      }
      await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (14,'P14','synthetic without account',91)");
      async function physical() {
        const value = {};
        for (const t of [...created].sort()) value[t] = (await pool.query('SELECT *' + (casts.get(t) ? ',' + casts.get(t) : '') + ' FROM `' + t + '` ORDER BY 1,2'))[0];
        return value;
      }
      const pinned = await pool.getConnection();
      const observed = { getConnection: async () => {
        const op = active; assert(op, 'public operation traced'); op.connectionId = pinned.threadId;
        const db = {};
        for (const method of ['execute', 'query']) db[method] = async (sql, params = []) => {
          assert(!/^(CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql.trim()), 'consumer cannot execute DDL');
          const q = { method, sql, params, connectionId: pinned.threadId, completed: false }; op.trace.push(q);
          if (fault?.(sql, params)) throw Object.assign(new Error('B02_INJECTED_WRITE_FAILURE'), { code: 'B02_INJECTED_WRITE_FAILURE' });
          const result = await pinned[method](sql, params); q.completed = true; return result;
        };
        db.beginTransaction = async () => { op.trace.push({ event: 'begin' }); return pinned.beginTransaction(); };
        db.commit = async () => { if (beforeCommit) await beforeCommit(pinned, op); await pinned.commit(); op.trace.push({ event: 'commit' }); };
        db.rollback = async () => { await pinned.rollback(); op.trace.push({ event: 'rollback' }); };
        db.release = () => op.trace.push({ event: 'release', pinned: true }); return db;
      } };
      const repo = makeDataMapDefinitionRepository(observed), current = require.cache[filename].exports;
      let oldRepo; try { require.cache[filename].exports = archived.exports; oldRepo = makeDataMapDefinitionRepository(observed); } finally { require.cache[filename].exports = current; }
      async function call(label, method, args, repository = repo) {
        const op = { label, method, args, variant: repository === oldRepo ? 'input-baseline' : 'current', trace: [] }; active = op;
        try { op.result = await repository[method](...args); return op.result; }
        catch (e) { op.error = errorValue(e); throw e; }
        finally { operations.push(op); active = null; }
      }
      async function reject(label, method, args, code, status = 409) {
        const before = await physical(); await assert.rejects(call(label, method, args), e => { assert.equal(e.code, code); if (status !== null) assert.equal(e.statusCode, status); return true; });
        const after=await physical(); const evidence='rollback-'+String(negatives.length+1).padStart(3,'0')+'.json'; save(evidence,{label,method,args,expectedCode:code,expectedStatus:status,before,after,beforeDigest:digest(before),afterDigest:digest(after),operation:operations.at(-1)}); assert.deepEqual(after,before,label+' every physical row unchanged'); negatives.push({label,method,code,status,physicalRollback:true,evidence});
      }
      const sources=[];
      const stub='p10-stub-v1',rules=require('../server/v7AnalysisRules');
      const payload=(source=sources[0],extra={})=>({request_id:uuid(),inputs:[{input_key:'source',kind:'v7_source',ref_id:source.id}],check_scope:{description:'synthetic queue identity',check_ids:['references']},parser_versions:{stub_success:stub},rule_version:stub,steps:[{step_key:'read',input_keys:['source'],check_ids:['references'],parser_key:'stub_success'}],ai_metadata:null,rerun_of_run_id:null,...extra});
      const createRun=(actor=7,body=payload())=>call('create-'+actor,'createAnalysisRun',[session(actor),body]);
      const enq=(r,extra={})=>({request_id:uuid(),run_id:r.run_id,...extra});
      const cancel=(r,extra={})=>({request_id:uuid(),run_id:r.run_id,expected_revision:r.revision_no,...extra});
      const write=(label,method,s,b,repository=repo)=>call(label,method,[s,b],repository);
      const read=(r,actor=7,repository=repo)=>call('read-'+r.run_id,'getAnalysisRun',[session(actor),r.run_id],repository);
      const queueCode=s=>'DEFINITION_ANALYSIS_QUEUE_'+s,runCode=s=>'DEFINITION_ANALYSIS_'+s;
      async function change(db,t,k,v,fields){return db.execute('UPDATE `'+t+'` SET '+Object.keys(fields).map(k=>'`'+k+'`=?').join(',')+' WHERE `'+k+'`=CAST(? AS SIGNED)',[...Object.values(fields),v]);}
      async function syntheticRunning(r,actor=7){
        // Reviewed original CREATE permits an existing running attempt. This is
        // explicit synthetic historical state, never a worker or claim operation.
        await pool.execute("INSERT INTO data_map_analysis_attempts(run_id,step_key,attempt_no,status,actor_person_id,started_at) VALUES (?,'read',1,'running',?,UTC_TIMESTAMP(3))",[r.run_id,String(actor)]);
        await pool.execute("UPDATE data_map_analysis_steps SET status='running',attempt_no=1 WHERE run_id=?",[r.run_id]);
        await pool.execute("UPDATE data_map_analysis_runs SET status='running',revision_no=2,started_at=UTC_TIMESTAMP(3) WHERE run_id=?",[r.run_id]);
        return {...r,revision_no:2,status:'running'};
      }
      try {
        await check('reviewed original CREATE markers and V8 V7 public upload fixtures',async()=>{
          for(const format of ['v8','v7']){const document=JSON.parse(fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-'+format+'.json')));const s=await call('upload-'+format,'registerV7Source',[session(7),{request_id:uuid(),source_kind:'uploaded_material',original_name:'synthetic-'+format+'.json'},Buffer.from(JSON.stringify(document))]);assert.equal(s.validation_status,'valid');sources.push({id:s.source_id,document,format});}
        });
        await check('same small-warmed execute connection adjacent BIGINT actor saved session scope receipt and cancellation attempts',async()=>{
          for(const actor of [7,P,N]){
            const s=session(actor),dept=people.find(p=>String(p.personId)===String(actor)).dept||'91',r=await createRun(actor),b=enq(r);
            const before=await read(r,actor),result=await write('precision-enqueue-'+actor,'enqueueAnalysis',s,b);const stored=await physical(),q=stored.data_map_analysis_queue.find(q=>q.run_id===r.run_id),req=stored.data_map_definition_requests.find(x=>x.request_id===b.request_id);
            assert.deepEqual(parse(q.session_json),{personId:String(s.personId),accountId:String(s.accountId),authVersion:String(s.authVersion)});assert.equal(req.actor_person_id,String(actor));assert.equal(req.scope_department_id,dept);assert.equal(req.action,'analysis_enqueue');assert.deepEqual(parse(req.result_json),result);
            assert.deepEqual(await read(r,actor),before);assert.equal(before.created_by_person_id,String(actor));assert.equal(before.scope_department_id,dept);assert.equal(before.manifest_digest,digest(before.manifest));assert.deepEqual(await read(r,actor,oldRepo),before);
            assert.deepEqual(await write('precision-enqueue-replay','enqueueAnalysis',s,b),result);assert.deepEqual(await physical(),stored);
            const running=await syntheticRunning(r,actor),cb=cancel(running),prior=await read(running,actor),c=await write('precision-cancel-'+actor,'cancelQueuedAnalysis',s,cb),after=await physical(),view=await read(running,actor);
            assert.equal(c.run_id,r.run_id);assert.equal(c.status,'cancelled');assert.equal(view.revision_no,3);assert.equal(view.attempts.length,1);assert.equal(view.attempts[0].completed_by_person_id,String(actor));assert.equal(view.attempts[0].actor_person_id,String(actor));assert.deepEqual(view.attempts[0].coverage,{expected:['references'],checked:[],missing:['references']});assert.equal(view.attempts[0].error_code,'RUN_CANCELLED');assert.equal(view.attempts[0].status,'cancelled');assert.deepEqual(view.manifest,prior.manifest);assert.equal(view.manifest_digest,prior.manifest_digest);
            assert.equal(after.data_map_analysis_queue.find(q=>q.run_id===r.run_id).state,'cancelled');assert.deepEqual(after.data_map_analysis_queue_events.filter(e=>e.run_id===r.run_id).map(e=>[e.event_type,e.error_code,e.worker_id]),[['enqueued',null,null],['cancelled','RUN_CANCELLED',null]]);
            for(const action of ['analysis_cancel_queue','analysis_finish']){const x=after.data_map_definition_requests.find(x=>x.request_id===cb.request_id&&x.action===action);assert.equal(x.actor_person_id,String(actor));assert.equal(x.scope_department_id,dept);assert.deepEqual(parse(x.result_json),c);}
            assert.deepEqual(await write('precision-cancel-replay','cancelQueuedAnalysis',s,cb),c);assert.deepEqual(await physical(),after);
            for(const method of ['enqueueAnalysis','cancelQueuedAnalysis'])for(const [field,other]of [['personId',actor===N?P:N],['accountId',actor===N?people[7].accountId:people[8].accountId],['authVersion',actor===N?people[7].authVersion:people[8].authVersion]])await reject('adjacent-'+method+'-'+actor+'-'+field,method,[{...s,[field]:other},method==='enqueueAnalysis'?enq(r):cancel(r)],'DEFINITION_AUTH_REQUIRED',401);
            precision.push({actor:String(actor),department:dept,connectionId:pinned.threadId,b,result,q,req,cancelBody:cb,cancelResult:c,before,prior,afterRun:view,physicalAfter:after});
          }
          assert(precision.every(p=>p.connectionId===pinned.threadId));save('precision.json',precision);
        });
        const queued=await createRun(),cancelQueued=await createRun(),cq=enq(cancelQueued);await write('setup-queued','enqueueAnalysis',session(7),cq);
        const runningBase=await createRun();await write('setup-running-queue','enqueueAnalysis',session(7),enq(runningBase));const running=await syntheticRunning(runningBase);
        const terminalRun=await createRun();await write('setup-terminal-enqueue','enqueueAnalysis',session(7),enq(terminalRun));await write('setup-terminal-cancel','cancelQueuedAnalysis',session(7),cancel(terminalRun));
        const base=await physical(),dump=backup();save('base-physical.json',base);fs.writeFileSync(path.join(output,'base-dump.sql'),dump,{flag:'wx'});
        async function reset(){restore(dump);assert.deepEqual(await physical(),base);}
        const entries=[['enqueueAnalysis',()=>enq(queued)],['cancelQueuedAnalysis',()=>cancel(cancelQueued)],['cancelQueuedAnalysis',()=>cancel(running)]];
        await check('adjacent physical BIGINT run queue IDs accurate after small prepared parameter warmup',async()=>{
          async function clone(t,r,newId,actor){const [cols]=await pool.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[t]);const replace={run_id:newId,...(t==='data_map_analysis_runs'?{created_by_person_id:actor,scope_department_id:people.find(p=>p.personId===actor).dept}:{})},bind=[];const names=cols.map(c=>'`'+c.COLUMN_NAME+'`'),expressions=cols.map(c=>{if(Object.hasOwn(replace,c.COLUMN_NAME)){bind.push(replace[c.COLUMN_NAME]);return 'CAST(? AS SIGNED)';}return '`'+c.COLUMN_NAME+'`';});await pool.execute('INSERT INTO `'+t+'`('+names.join(',')+') SELECT '+expressions.join(',')+' FROM `'+t+'` WHERE run_id=CAST(? AS SIGNED)',[...bind,r.run_id]);}
          const proof=[];for(const [i,actor]of [P,N].entries()){const r={run_id:'900719925474180'+i,revision_no:1};for(const t of ['data_map_analysis_runs','data_map_analysis_inputs','data_map_analysis_steps'])await clone(t,queued,r.run_id,actor);
            const before=await read(r,actor),result=await write('big-run-enqueue-'+actor,'enqueueAnalysis',session(actor),enq(r)),q=(await physical()).data_map_analysis_queue.find(q=>q.run_id===r.run_id);assert.equal(result.run_id,r.run_id);assert.deepEqual(parse(q.session_json),{personId:actor,accountId:session(actor).accountId,authVersion:session(actor).authVersion});assert.deepEqual(await read(r,actor),before);
            const cb=cancel(r),c=await write('big-run-cancel-'+actor,'cancelQueuedAnalysis',session(actor),cb);assert.equal(c.run_id,r.run_id);proof.push({actor,r,result,q,c,before});
          }
          assert.notEqual(proof[0].r.run_id,proof[1].r.run_id);assert.equal((await physical()).data_map_analysis_queue.filter(q=>proof.some(p=>p.r.run_id===q.run_id)).length,2);
          for(const method of ['enqueueAnalysis','cancelQueuedAnalysis']){const label=method==='enqueueAnalysis'?'big-run-enqueue-':'big-run-cancel-',body=operations.find(op=>op.label===label+N).args[1];await reject('neighbor-run-receipt-'+method,method,[session(N),{...body,run_id:proof[0].r.run_id}],'DEFINITION_IDEMPOTENCY_CONFLICT');}
          for(const method of ['enqueueAnalysis','cancelQueuedAnalysis'])for(const [field,value]of [['personId',Number(N)],['accountId',Number(session(N).accountId)],['authVersion',Number(session(N).authVersion)]])await reject('rounded-'+method+'-'+field,method,[{...session(N),[field]:value},method==='enqueueAnalysis'?enq(proof[1].r):cancel(proof[1].r)],'DEFINITION_ID_INVALID',400);
          for(const method of ['enqueueAnalysis','cancelQueuedAnalysis'])await reject('rounded-run-'+method,method,[session(N),{...(method==='enqueueAnalysis'?enq(proof[1].r):cancel(proof[1].r)),run_id:Number(proof[1].r.run_id)}],'DEFINITION_ID_INVALID',400);
          save('physical-bigint-reads.json',{proof,connectionId:pinned.threadId,onlyNewSyntheticClones:true,physical:await physical()});await reset();
        });
        await check('person admin overlay empty system-admin no-auth no-grant cross department original request contracts',async()=>{
          for(const [method,args]of entries)for(const [label,s,code,status]of [['admin',session(9),'DEFINITION_ACCESS_DENIED',403],['overlay',session(10),'DEFINITION_ACCESS_DENIED',403],['system-admin',{identityKind:'system_admin',accountId:109,authVersion:1},'DEFINITION_AUTH_REQUIRED',401],['typed-system-admin',{identityKind:'system_admin',personId:7,accountId:107,authVersion:1},'DEFINITION_AUTH_REQUIRED',401],['no-session',null,'DEFINITION_AUTH_REQUIRED',401],['no-auth',{},'DEFINITION_AUTH_REQUIRED',401],['no-grant',session(13),'DEFINITION_ACCESS_DENIED',403],['cross',session(11),'DEFINITION_ACCESS_DENIED',403]])await reject(label+'-'+method+'-'+args().run_id,method,[s,args()],code,status);
          for(const actor of [9,10])assert.equal((await read(queued,actor)).run_id,queued.run_id);assert.equal((await read(queued,12)).run_id,queued.run_id);await reject('department-read-cross','getAnalysisRun',[session(11),queued.run_id],'DEFINITION_ACCESS_DENIED',403);
        });
        const mutations=[['disabled','user_accounts','account_id','107',{account_status:'disabled'},'DEFINITION_AUTH_REQUIRED',401],['password-gate','user_accounts','account_id','107',{must_change_password:1},'DEFINITION_AUTH_REQUIRED',401],['password-change','user_accounts','account_id','107',{password_hash:'synthetic-changed',auth_version:2},'DEFINITION_AUTH_REQUIRED',401],['generation','user_accounts','account_id','107',{auth_version:2},'DEFINITION_AUTH_REQUIRED',401],['rebound','user_accounts','account_id','107',{person_id:14},'DEFINITION_AUTH_REQUIRED',401],['inactive','person','person_id','7',{status:'inactive'},'DEFINITION_AUTH_REQUIRED',401],['null-department','person','person_id','7',{current_department_id:null},'DEFINITION_DEPARTMENT_REQUIRED',403],['revoked','person_roles','person_role_id',base.person_roles.find(r=>r.person_id==='7').person_role_id,{assignment_status:'revoked'},'DEFINITION_ACCESS_DENIED',403]];
        await check('latest account person password generation binding department and permission qualification',async()=>{
          for(const [label,t,k,v,fields,code,status]of mutations)for(const [method,args]of entries){await change(pool,t,k,v,fields);await reject('current-'+label+'-'+method+'-'+args().run_id,method,[session(7),args()],code,status);await reset();}
          for(const [method,args]of entries){await change(pool,'person','person_id','7',{current_department_id:'92'});const b=args(),result=await write('moved-'+method,method,session(7),b);const req=(await physical()).data_map_definition_requests.find(x=>x.request_id===b.request_id&&x.action===(method==='enqueueAnalysis'?'analysis_enqueue':'analysis_cancel_queue'));assert.equal(req.scope_department_id,'92');assert.equal((await read({run_id:b.run_id})).scope_department_id,'91');await reset();}
          await change(pool,'person','person_id','7',{current_department_id:'92'});await reject('moved-prior-replay','enqueueAnalysis',[session(7),cq],'DEFINITION_ACCESS_DENIED',403);await reset();
        });
        const lockQuery='SELECT l.OBJECT_NAME object_name,l.LOCK_MODE lock_mode,t.PROCESSLIST_ID connection_id,b.PROCESSLIST_ID blocking_connection_id FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID JOIN performance_schema.threads b ON b.THREAD_ID=w.BLOCKING_THREAD_ID WHERE t.PROCESSLIST_ID=?';
        async function waitLock(connectionId){for(let i=0;i<200;i++){const [locks]=await pool.execute(lockQuery,[connectionId]);if(locks.length)return locks;await sleep(25);}throw Error('B02_REAL_LOCK_WAIT_NOT_OBSERVED');}
        async function lockChange(label,method,b,t,k,v,fields,code,status,s=session(7)){
          const before=await physical(),blocker=await pool.getConnection();let pending;
          try{await blocker.beginTransaction();await blocker.execute('SELECT `'+k+'` FROM `'+t+'` WHERE `'+k+'`=CAST(? AS SIGNED) FOR UPDATE',[v]);pending=write('wait-'+label,method,s,b).then(result=>({result}),error=>({error}));const evidence=await waitLock(pinned.threadId);assert(evidence.every(e=>e.connection_id===pinned.threadId&&e.blocking_connection_id===blocker.threadId));await change(blocker,t,k,v,fields);const [[row]]=await blocker.query('SELECT *'+(casts.get(t)?','+casts.get(t):'')+' FROM `'+t+'` WHERE `'+k+'`=CAST(? AS SIGNED)',[v]);await blocker.commit();const outcome=await pending;assert.equal(outcome.error?.code,code);assert.equal(outcome.error?.statusCode,status);
            const expected=structuredClone(before),index=expected[t].findIndex(x=>String(x[k])===String(v));assert(index>=0);expected[t][index]=row;const after=await physical(),file='wait-physical-'+String(waits.length+1).padStart(3,'0')+'.json';save(file,{label,method,before,expected,after,evidence,operation:operations.at(-1)});assert.deepEqual(after,expected);waits.push({label,method,t,k,v,fields,evidence,actorConnectionId:pinned.threadId,blockerConnectionId:blocker.threadId,error:errorValue(outcome.error),physicalRollback:true,externalRow:row,physicalEvidence:file});
          }finally{await blocker.rollback().catch(()=>{});blocker.release();if(pending)await pending;await reset();}
        }
        await check('real identity lock waits reject latest revocation generation gate rebound inactive and empty department',async()=>{
          for(const [method,args]of entries)for(const [label,t,k,v,fields,code,status]of mutations)await lockChange(label+'-'+method+'-'+args().run_id,method,args(),t,k,v,fields,code,status);
          for(const [method,args]of entries){const b=args(),blocker=await pool.getConnection();let pending;try{await blocker.beginTransaction();await blocker.execute('SELECT person_id FROM person WHERE person_id=7 FOR UPDATE');pending=write('wait-moved-'+method,method,session(7),b).then(result=>({result}),error=>({error}));const evidence=await waitLock(pinned.threadId);await change(blocker,'person','person_id','7',{current_department_id:'92'});await blocker.commit();const result=await pending;assert(!result.error);assert.equal((await physical()).data_map_definition_requests.find(x=>x.request_id===b.request_id).scope_department_id,'92');waits.push({label:'moved-'+method,evidence,actorConnectionId:pinned.threadId,blockerConnectionId:blocker.threadId,result:result.result,physicalAfter:await physical()});}finally{await blocker.rollback().catch(()=>{});blocker.release();if(pending)await pending;await reset();}}
          await lockChange('department-reader-moved','getAnalysisRun',queued.run_id,'person','person_id','12',{current_department_id:'92'},'DEFINITION_ACCESS_DENIED',403,session(12));
        });
        await check('request replay conflicts subject scoped receipts duplicate missing queue pristine and revision state errors',async()=>{
          for(const [method,args]of entries){const b=args(),first=await write('first-'+method,method,session(7),b),after=await physical();assert.deepEqual(await write('same-'+method,method,session(7),b),first);assert.deepEqual(await physical(),after);const changed=method==='enqueueAnalysis'?{...b,policy:{retry_ms:100}}:{...b,expected_revision:99};await reject('different-'+method,method,[session(7),changed],'DEFINITION_IDEMPOTENCY_CONFLICT');await change(pool,'person','person_id','7',{current_department_id:'92'});await reject('cross-dept-receipt-'+method,method,[session(7),b],'DEFINITION_ACCESS_DENIED',403);await reset();}
          await reject('duplicate-queue','enqueueAnalysis',[session(7),enq(cancelQueued)],queueCode('ALREADY_ENQUEUED'));
          await reject('missing-queue','cancelQueuedAnalysis',[session(7),cancel(queued)],queueCode('NOT_FOUND'),404);
          await reject('terminal-enqueue-priority','enqueueAnalysis',[session(7),enq(terminalRun)],queueCode('ALREADY_ENQUEUED'));
          await reject('terminal-revision-first','cancelQueuedAnalysis',[session(7),cancel(terminalRun)],runCode('REVISION_CONFLICT'));
          await reject('terminal-status','cancelQueuedAnalysis',[session(7),cancel(terminalRun,{expected_revision:2})],runCode('RUN_TERMINAL'));
          await reject('cancel-revision','cancelQueuedAnalysis',[session(7),cancel(cancelQueued,{expected_revision:99})],runCode('REVISION_CONFLICT'));
          await reject('cancel-property','cancelQueuedAnalysis',[session(7),cancel(cancelQueued,{unexpected:true})],runCode('PROPERTY_INVALID'),400);
          await reject('enqueue-property-priority','enqueueAnalysis',[null,enq(queued,{unexpected:true})],queueCode('PROPERTY_INVALID'),400);
          await reject('unauthorized-invalid-policy','enqueueAnalysis',[session(13),enq(queued,{policy:{bad:1}})],'DEFINITION_ACCESS_DENIED',403);
          assert(!base.data_map_analysis_runs.some(r=>r.run_id==='9999999'));
          for(const run_id of ['9999999',null,'01'])await reject('invalid-run-'+String(run_id),'enqueueAnalysis',[session(7),enq({run_id})],run_id==='9999999'?runCode('RUN_NOT_FOUND'):'DEFINITION_ID_INVALID',run_id==='9999999'?404:400);
          const started=await syntheticRunning(queued);await reject('non-pristine-running','enqueueAnalysis',[session(7),enq(started)],queueCode('PRISTINE_RUN_REQUIRED'));await reset();
          for(const status of ['succeeded','partial','failed','cancelled']){await change(pool,'data_map_analysis_runs','run_id',queued.run_id,{status,finished_at:'2026-10-10 00:00:00.000'});await reject('non-pristine-'+status,'enqueueAnalysis',[session(7),enq(queued)],queueCode('PRISTINE_RUN_REQUIRED'));await reset();}
          // Same UUID is namespaced to the real actor, not a globally shared receipt.
          const b=enq(queued),first=await write('actor-first','enqueueAnalysis',session(7),b);await reject('actor-other-enqueue','enqueueAnalysis',[session(8),b],queueCode('ALREADY_ENQUEUED'));await reset();
          const cb=cancel(cancelQueued);await write('actor-first-cancel','cancelQueuedAnalysis',session(7),cb);await reject('actor-other-cancel','cancelQueuedAnalysis',[session(8),cb],runCode('REVISION_CONFLICT'));await reset();
        });
        await check('original policy boundary values unknown properties adapter refusal readiness and request error priority',async()=>{
          for(const policy of [{unexpected:1},{max_attempts:0},{max_attempts:6},{lease_ms:299},{lease_ms:60001},{timeout_ms:1},{timeout_ms:600001},{retry_ms:-1},{retry_ms:60001},{retry_ms:1.5}])await reject('invalid-policy-'+json(policy),'enqueueAnalysis',[session(7),enq(queued,{policy})],queueCode('POLICY_INVALID'),400);
          for(const policy of [{max_attempts:1,lease_ms:300,timeout_ms:300,retry_ms:0},{max_attempts:5,lease_ms:60000,timeout_ms:600000,retry_ms:60000}]){const result=await write('policy-bound','enqueueAnalysis',session(7),enq(queued,{policy}));assert.deepEqual(result.policy,policy);await reset();}
          await reject('bad-request-uuid','enqueueAnalysis',[session(7),enq(queued,{request_id:'bad'})],'DEFINITION_REQUEST_ID_INVALID',400);
          const unknown=await createRun(7,payload(sources[0],{rule_version:'synthetic-unknown',parser_versions:{native:'synthetic-unknown'},steps:[{step_key:'read',input_keys:['source'],check_ids:['references'],parser_key:'native'}]}));await reject('adapter-not-enabled','enqueueAnalysis',[session(7),enq(unknown)],queueCode('ADAPTER_NOT_ENABLED'),400);await reset();
          await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[queueSchema.MIGRATION_KEY]);for(const [method,args]of entries)await reject('migration-priority-'+method,method,[null,args()],queueCode('MIGRATION_REQUIRED'),503);await reset();
        });
        await check('every actual request queue event run steps attempts and receipt write failure rolls back every complete physical row',async()=>{
          for(const [method,args]of entries){const b=args();await write('discover-writes-'+method,method,session(7),b);const trace=operations.at(-1).trace,writes=trace.filter(q=>/^(INSERT|UPDATE)\b/i.test(q.sql?.trim()||''));await reset();assert(writes.length>=4);const proof=[];
            for(let i=0;i<writes.length;i++){let seen=0;fault=sql=>/^(INSERT|UPDATE)\b/i.test(sql.trim())&&seen++===i;try{await reject('write-fault-'+method+'-'+b.run_id+'-'+i,method,[session(7),{...b,request_id:uuid()}],'B02_INJECTED_WRITE_FAILURE',null);}finally{fault=null;}const op=operations.at(-1),failed=op.trace.find(q=>q.sql&&!q.completed);assert.equal(failed.sql,writes[i].sql);proof.push({index:i,sql:writes[i].sql,operation:op,rollbackEvidence:negatives.at(-1).evidence});}
            save('write-faults-'+method+'-'+b.run_id+'.json',{method,runId:b.run_id,writes,proof,fullPhysicalRollback:true});
          }
        });
        await check('baseline SQL parameters transactions identity run queue lock order and real held locks exactly equivalent',async()=>{
          await reset();const [[clock]]=await pinned.execute('SELECT UNIX_TIMESTAMP() stamp');await pinned.execute('SET timestamp=?',[clock.stamp]);const proof=[];
          for(const [method,args]of entries){const b=args(),old=await write('baseline-'+method,method,session(7),b,oldRepo),traceBefore=operations.at(-1).trace,physicalBefore=await physical();await reset();
            beforeCommit=async(db,op)=>{const [locks]=await pool.execute('SELECT l.OBJECT_NAME,l.LOCK_MODE,l.LOCK_TYPE,l.LOCK_STATUS FROM performance_schema.data_locks l JOIN performance_schema.threads t ON t.THREAD_ID=l.THREAD_ID WHERE t.PROCESSLIST_ID=? AND l.OBJECT_SCHEMA=DATABASE()',[db.threadId]);for(const t of ['user_accounts','person','person_roles','roles','role_permissions','data_map_v7_sources','data_map_analysis_runs','data_map_analysis_queue','data_map_definition_requests'])assert(locks.some(l=>l.OBJECT_NAME===t&&l.LOCK_TYPE==='RECORD'&&l.LOCK_STATUS==='GRANTED'),t+' held');op.heldLocks=locks;};let result;try{result=await write('current-'+method,method,session(7),b);}finally{beforeCommit=null;}const op=operations.at(-1);assert.deepEqual(result,old);assert.deepEqual(op.trace,traceBefore);assert.deepEqual(await physical(),physicalBefore);
            const actorLock=op.trace.findIndex(q=>q.sql?.includes('FROM user_accounts WHERE account_id=? FOR UPDATE')),runLock=op.trace.findIndex(q=>q.sql?.includes('FROM data_map_analysis_runs WHERE run_id=? FOR UPDATE')),queueLock=op.trace.findIndex(q=>q.sql?.includes('FROM data_map_analysis_queue WHERE run_id=? FOR UPDATE'));assert(actorLock>=0&&actorLock<runLock&&runLock<queueLock);proof.push({method,b,result,traceBefore,current:op,physicalEqual:true});await reset();
          }await pinned.execute('SET timestamp=0');save('sql-order-equivalence.json',{proof,noPermittedDifferences:true,paramsAndOrderEqual:true});
        });
        await check('two actual public repository connections same enqueue and cancel request return one physical receipt and event',async()=>{
          const proof=[];for(const [method,args]of entries){const second=await pool.getConnection(),secondTrace=[];let pending,secondResult;
            const secondPool={getConnection:async()=>({execute:async(sql,params=[])=>{secondTrace.push({method:'execute',sql,params,connectionId:second.threadId});return second.execute(sql,params);},query:async(sql,params=[])=>{secondTrace.push({method:'query',sql,params,connectionId:second.threadId});return second.query(sql,params);},beginTransaction:async()=>{secondTrace.push({event:'begin',connectionId:second.threadId});return second.beginTransaction();},commit:async()=>{await second.commit();secondTrace.push({event:'commit',connectionId:second.threadId});},rollback:async()=>{await second.rollback();secondTrace.push({event:'rollback',connectionId:second.threadId});},release:()=>secondTrace.push({event:'release',pinned:true})})};const other=makeDataMapDefinitionRepository(secondPool),b=args();
            beforeCommit=async(db,op)=>{pending=other[method](session(7),b);const locks=await waitLock(second.threadId);assert(locks.every(l=>l.connection_id===second.threadId&&l.blocking_connection_id===pinned.threadId));op.concurrentWaits=locks;};try{const first=await write('concurrent-'+method,method,session(7),b);secondResult=await pending;assert.deepEqual(secondResult,first);const after=await physical(),action=method==='enqueueAnalysis'?'analysis_enqueue':'analysis_cancel_queue';assert.equal(after.data_map_definition_requests.filter(x=>x.request_id===b.request_id&&x.action===action).length,1);assert.equal(after.data_map_analysis_queue.filter(x=>x.run_id===b.run_id).length,1);const expectedEvent=method==='enqueueAnalysis'?'enqueued':'cancelled';assert.equal(after.data_map_analysis_queue_events.filter(x=>x.run_id===b.run_id&&x.event_type===expectedEvent).length,1);beforeCommit=null;assert.deepEqual(await write('concurrent-replay',method,session(7),b),first);assert.deepEqual(await physical(),after);proof.push({method,b,first,second:secondResult,firstOperation:operations.at(-2),secondTrace,physical:after});}finally{beforeCommit=null;if(pending)await pending;await second.rollback().catch(()=>{});second.release();await reset();}
          }save('concurrent-idempotency.json',proof);
        });
        await check('V8 current v3 supported V7 v1 v2 v3 original format boundary and immutable manifest inputs',async()=>{
          const proof=[];for(const source of sources)for(const version of source.format==='v8'?[rules.VERSION]:[rules.LEGACY_VERSION,rules.PREVIOUS_VERSION,rules.VERSION]){const b=payload(source,{rule_version:version,parser_versions:{[rules.PARSER]:version},check_scope:{description:'synthetic format',check_ids:[rules.CHECKS[0]]},steps:[{step_key:'read',input_keys:['source'],check_ids:[rules.CHECKS[0]],parser_key:rules.PARSER}]}),r=await createRun(7,b),view=await read(r),before=await physical();assert(rules.enabledManifest(view.manifest));const result=await write('native-enqueue','enqueueAnalysis',session(7),enq(r));assert.deepEqual(await read(r),view);const c=await write('native-cancel','cancelQueuedAnalysis',session(7),cancel(r)),after=await read(r);assert.deepEqual(after.manifest,view.manifest);assert.equal(after.manifest_digest,view.manifest_digest);assert.deepEqual((await physical()).data_map_v7_sources,before.data_map_v7_sources);proof.push({source,version,b,r,view,result,c,after});await reset();}
          for(const version of [rules.LEGACY_VERSION,rules.PREVIOUS_VERSION]){const b=payload(sources[0],{rule_version:version,parser_versions:{[rules.PARSER]:version},steps:[{step_key:'read',input_keys:['source'],check_ids:[rules.CHECKS[0]],parser_key:rules.PARSER}],check_scope:{description:'synthetic old format',check_ids:[rules.CHECKS[0]]}});await reject('old-rule-v8','createAnalysisRun',[session(7),b],runCode('SOURCE_FORMAT_UNSUPPORTED'));}
          save('native-formats.json',proof);
        });
        await check('all five current fixed references successful enqueue cancel reject integrity changes after true source locks',async()=>{
          const obj=await call('reference-object','saveDefinition',[session(11),{request_id:uuid(),entity_type:'object',department_id:'92',definition:{name:'synthetic object',business_meaning:'synthetic only'}}]);
          const document=structuredClone(sources[0].document);document.process.process_ref='process_synthetic_refs';document.process.process_name='synthetic references';document.behaviors=[{behavior_ref:'behavior_prepare',node_type:'action',behavior_name:'synthetic prepare',behavior_description:'synthetic',current_actor_role:'synthetic 91',actor_assignment_mode:'fixed_department',actor_department_data_ref:null,actor_position_rule:'',trigger:'synthetic',precondition:'',input_description:'synthetic',timing:null,completion_standard:'synthetic',output_description:'synthetic',countersign_all_required:false,countersign_target_departments:[]}];document.data_objects=[{data_ref:'data_a',data_name:'synthetic object',description:'synthetic',information_type:'business_conclusion',fields:[],behavior_links:[],source_relations:[],lifecycle:{applicability:'pending_confirmation',entry_state:{business_validity:'pending_confirmation',custody:'pending_confirmation',identifiability_applicability:'pending_confirmation',identifiability:'pending_confirmation'},routes:[],analysis:{analyzer_version:'',source_fingerprint:'',status:'not_analyzed'},decision_reason:'',decision_notes:''}}];
          const source=await call('reference-upload','registerV7Source',[session(7),{request_id:uuid(),source_kind:'uploaded_material',original_name:'synthetic-refs.json'},Buffer.from(JSON.stringify(document))]);assert.equal(source.validation_status,'valid');
          const meta=await call('reference-source','getV7Source',[session(7),source.source_id]),mapping=await call('reference-mapping','saveV7Mapping',[session(7),source.source_id,{request_id:uuid(),source_digest:meta.content_digest,local_object_ref:'data_a',local_field_ref:null,object_version_id:obj.version_id,field_version_id:null,expected_revision:0,status:'candidate',basis:'synthetic explicit comparison'}]);
          const hd={title:'synthetic handoff',claim_status:'material_declared',source:{mapping_version_id:mapping.mapping_version_id,behavior_ref:'behavior_prepare',operations:['deliver']},target:null,identifier_kind:'unknown',identity_rule:null,identity_basis:null,delivery_condition:'synthetic',reception_requirement:null,evidence:[{side:'source',locator:'synthetic source',note:'synthetic'}],pairs:[]},handoff=await call('reference-handoff','saveDesignHandoff',[session(7),{request_id:uuid(),handoff_id:null,expected_revision:0,definition:hd}]);
          const bytes=await require('./test-word-evidence').fixture(),defRun=await createRun(7,payload(sources[0],{inputs:[{input_key:'source',kind:'definition',ref_id:obj.version_id}]})),defView=await read(defRun),parsed=require('../server/wordEvidenceParser').extract(bytes,'synthetic.docx'),value={...parsed,document:{...parsed.document,links:[{anchor_id:'a1',kind:'definition',ref_id:obj.version_id,basis:'synthetic',fixed_reference:defView.manifest.inputs[0].snapshot}]}};value.content_digest=digest(value.document);
          const word=await call('reference-word','registerSource',[session(11),{request_id:uuid(),department_id:'92',parser_version:value.parser_version,template_profile_version:digest(value.document.links),original_name:'synthetic.docx'},bytes]);await pool.execute('INSERT INTO data_map_word_evidence(batch_id,snapshot_json,snapshot_digest) VALUES (?,?,?)',[word.batch_id,json(value),digest(value)]);
          const refs=[['v7_source',source.source_id,'data_map_v7_sources','source_id','content_digest','DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT'],['definition',obj.version_id,'data_map_definition_versions','version_id','content_digest','DEFINITION_VERSION_INTEGRITY_CONFLICT'],['mapping',mapping.mapping_version_id,'data_map_v7_mapping_versions','mapping_version_id','snapshot_digest','DEFINITION_V7_MAPPING_INTEGRITY_CONFLICT'],['handoff',handoff.handoff_version_id,'data_map_design_handoff_versions','handoff_version_id','snapshot_digest','DEFINITION_ANALYSIS_REFERENCE_CHANGED'],['template',word.batch_id,'data_map_word_evidence','batch_id','snapshot_digest','DEFINITION_WORD_INTEGRITY_CONFLICT']],fixed=[];
          for(const [kind,ref,t,k,field,expectedCode]of refs){const r=await createRun(7,payload(sources[0],{inputs:[{input_key:'source',kind,ref_id:ref}]})),view=await read(r);const local=backup(),start=await physical();
            const b=enq(r),result=await write('fixed-enqueue-'+kind,'enqueueAnalysis',session(7),b);assert.deepEqual(await read(r),view);const cb=cancel(r),c=await write('fixed-cancel-'+kind,'cancelQueuedAnalysis',session(7),cb);assert.equal(c.status,'cancelled');assert.deepEqual((await read(r)).manifest,view.manifest);restore(local);assert.deepEqual(await physical(),start);
            for(const method of ['enqueueAnalysis','cancelQueuedAnalysis']){if(method==='cancelQueuedAnalysis')await write('fixed-cancel-setup-'+kind,'enqueueAnalysis',session(7),enq(r));const body=method==='enqueueAnalysis'?enq(r):cancel(r),before=await physical(),blocker=await pool.getConnection();let pending;
              try{await blocker.beginTransaction();await blocker.execute('SELECT `'+k+'` FROM `'+t+'` WHERE `'+k+'`=CAST(? AS SIGNED) FOR UPDATE',[ref]);pending=write('fixed-wait-'+kind+'-'+method,method,session(7),body).then(result=>({result}),error=>({error}));const evidence=await waitLock(pinned.threadId);assert(evidence.every(e=>e.connection_id===pinned.threadId&&e.blocking_connection_id===blocker.threadId));await change(blocker,t,k,ref,{[field]:'0'.repeat(64)});const [[external]]=await blocker.query('SELECT *'+(casts.get(t)?','+casts.get(t):'')+' FROM `'+t+'` WHERE `'+k+'`=CAST(? AS SIGNED)',[ref]);await blocker.commit();const outcome=await pending;assert.equal(outcome.error?.code,expectedCode);assert.equal(outcome.error?.statusCode,409);const expected=structuredClone(before);expected[t][expected[t].findIndex(row=>String(row[k])===ref)]=external;const after=await physical(),file='fixed-physical-'+kind+'-'+method+'.json';save(file,{before,expected,after,operation:operations.at(-1),evidence});assert.deepEqual(after,expected);waits.push({label:'fixed-'+kind+'-'+method,kind,method,evidence,actorConnectionId:pinned.threadId,blockerConnectionId:blocker.threadId,error:errorValue(outcome.error),physicalRollback:true,physicalEvidence:file});
              }finally{await blocker.rollback().catch(()=>{});blocker.release();if(pending)await pending;restore(local);assert.deepEqual(await physical(),start);}
            }
            fixed.push({kind,ref,r,view,result,c,fixedSnapshot:view.manifest.inputs[0].snapshot,physicalRestored:true});
          }
          // Adapter enrollment is an existing manifest predicate, no runtime enable flag.
          for(const [ref,adapter]of [[handoff.handoff_version_id,require('../server/handoffAnalysisRules')],[word.batch_id,require('../server/wordEvidenceRules')]]){const kind=adapter.PARSER==='word_evidence'?'template':'handoff',r=await createRun(7,payload(sources[0],{inputs:[{input_key:'source',kind,ref_id:ref}],rule_version:adapter.VERSION,parser_versions:{[adapter.PARSER]:adapter.VERSION},check_scope:{description:'synthetic enrolled adapter',check_ids:[adapter.CHECKS[0]]},steps:[{step_key:'read',input_keys:['source'],check_ids:[adapter.CHECKS[0]],parser_key:adapter.PARSER}]})),view=await read(r);assert(adapter.enabledManifest(view.manifest));await write('adapter-enrolled-'+kind,'enqueueAnalysis',session(7),enq(r));await write('adapter-cancel-'+kind,'cancelQueuedAnalysis',session(7),cancel(r));}
          save('fixed-references.json',fixed);await reset();
        });
        await check('old queued V8 under v1 v2 and old schema-less snapshot rejected by enqueue while cancel retains fixed body',async()=>{
          for(const version of [rules.LEGACY_VERSION,rules.PREVIOUS_VERSION]){const r=await createRun(7,payload(sources[0],{rule_version:rules.VERSION,parser_versions:{[rules.PARSER]:rules.VERSION},check_scope:{description:'synthetic historical unsupported',check_ids:[rules.CHECKS[0]]},steps:[{step_key:'read',input_keys:['source'],check_ids:[rules.CHECKS[0]],parser_key:rules.PARSER}]})),view=await read(r),historical=structuredClone(view.manifest);historical.rule_version=version;historical.parser_versions[rules.PARSER]=version;delete historical.inputs[0].snapshot.schema_version;
            await change(pool,'data_map_analysis_runs','run_id',r.run_id,{manifest_json:json(historical),manifest_digest:digest(historical)});await pool.execute('UPDATE data_map_analysis_inputs SET snapshot_json=?,snapshot_digest=? WHERE run_id=?',[json(historical.inputs[0].snapshot),digest(historical.inputs[0].snapshot),r.run_id]);const before=await physical(),old=await read(r);await reject('old-v8-enqueue-'+version,'enqueueAnalysis',[session(7),enq(r)],runCode('SOURCE_FORMAT_UNSUPPORTED'));
            await pool.execute("INSERT INTO data_map_analysis_queue(run_id,session_json,policy_json,state,available_at,created_at,updated_at) VALUES (?,?,?,'ready',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[r.run_id,json({personId:7,accountId:107,authVersion:1}),json(require('../server/analysisQueue').policy())]);const c=await write('old-v8-cancel-'+version,'cancelQueuedAnalysis',session(7),cancel(r));assert.deepEqual((await read(r)).manifest,old.manifest);assert.equal((await read(r)).manifest_digest,old.manifest_digest);save('old-format-'+version+'.json',{before,old,c,after:await physical(),noHistoryRewrite:true});await reset();
          }
        });
        await check('historical unknown fields numeric string and null saved subjects JSON nonJSON events full rows dump restore exact',async()=>{
          const oldSessions=[{personId:7,accountId:107,authVersion:1},{personId:'7',accountId:'107',authVersion:'1',unknown:{old_id:'9007199254741993',value:null}},{personId:null,accountId:'107',authVersion:'1',unknown:null}];const proof=[];
          for(const old of oldSessions){await change(pool,'data_map_analysis_queue','run_id',cancelQueued.run_id,{session_json:json(old)});const view=await read(cancelQueued),m={...view.manifest,historical_unknown:{old_id:'9007199254741993',null_subject:null}};await change(pool,'data_map_analysis_runs','run_id',cancelQueued.run_id,{manifest_json:json(m),manifest_digest:digest(m)});
            await pool.execute("INSERT INTO data_map_analysis_queue_events(run_id,generation,worker_id,event_type,error_code,created_at) VALUES (?,0,NULL,?,NULL,UTC_TIMESTAMP(3))",[cancelQueued.run_id,'legacy nonJSON event']);await pool.execute("INSERT INTO data_map_analysis_queue_events(run_id,generation,worker_id,event_type,error_code,created_at) VALUES (?,0,NULL,?,NULL,UTC_TIMESTAMP(3))",[cancelQueued.run_id,json({old_id:'7',unknown:null})]);
            const before=await physical(),loaded=await read(cancelQueued);assert.deepEqual(await read(cancelQueued,7,oldRepo),loaded);assert.deepEqual(await physical(),before);const c=await write('old-session-cancel','cancelQueuedAnalysis',session(7),cancel(cancelQueued)),after=await physical();assert.deepEqual(parse(after.data_map_analysis_queue.find(q=>q.run_id===cancelQueued.run_id).session_json),old);assert.deepEqual((await read(cancelQueued)).manifest,m);const local=backup();restore(local);assert.deepEqual(await physical(),after);proof.push({old,before,loaded,c,after,dumpSha256:sha(local)});await reset();
          }
          // Evidence/finding snapshots remain fixed across cancellation of a
          // mixed existing run; the synthetic evidence itself is not analyzed.
          const r=await createRun(),a=await call('historical-begin','beginAnalysisAttempt',[session(7),{request_id:uuid(),run_id:r.run_id,expected_revision:1,step_key:'read'}]),evidence=[{evidence_key:'root',input_key:'source',locator_kind:'json_pointer',locator:'',note:'synthetic retained evidence'}],findings=[{rule_id:'references',finding_type:'observation',message:'synthetic retained finding',subject_input_keys:['source'],semantic_locator:'process:synthetic',evidence_keys:['root']}];
          const completed=await call('historical-complete','completeAnalysisAttempt',[session(7),{request_id:uuid(),run_id:r.run_id,attempt_id:a.attempt_id,expected_revision:a.revision_no,status:'succeeded',checked_ids:['references'],error_code:null,evidence,findings}]);
          await pool.execute("INSERT INTO data_map_analysis_queue(run_id,session_json,policy_json,state,available_at,created_at,updated_at) VALUES (?,?,?,'ready',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[r.run_id,json(oldSessions[1]),json(require('../server/analysisQueue').policy())]);const before=await physical(),loaded=await read(r);const c=await write('retained-evidence-cancel','cancelQueuedAnalysis',session(7),cancel({...r,revision_no:completed.revision_no})),after=await physical(),afterView=await read(r);assert.deepEqual(afterView.attempts,loaded.attempts);for(const t of ['data_map_analysis_inputs','data_map_analysis_evidence','data_map_analysis_findings','data_map_analysis_finding_inputs','data_map_analysis_finding_evidence'])assert.deepEqual(after[t],before[t]);const fullDump=backup();fs.writeFileSync(path.join(output,'history-dump.sql'),fullDump,{flag:'wx'});restore(fullDump);assert.deepEqual(await physical(),after);assert.deepEqual(await read(r),afterView);
          save('history-restore.json',{oldSessions:proof,evidenceBefore:loaded,evidenceAfter:afterView,c,fullPhysicalBefore:before,fullPhysicalAfter:after,dumpSha256:sha(fullDump),fullPhysicalEqual:true,oldJSONNonJSONNullAndUnknownPreserved:true,workerSavedSessionInterpretationOutsideScope:true});await reset();
        });
        save('operations.json',operations);save('negative-results.json',negatives);save('lock-waits.json',waits);await reset();save('restored-physical.json',await physical());
      } finally { beforeCommit = null; fault = null; pinned.release(); }
    }, { stage: '02', randomDatabase: true });
  } catch (e) { save('failure.json', { error: errorValue(e), stack: e.stack, checks, operations, negatives, waits, precision, target }); throw e; }
  finally {
    if (target) {
      const remaining = cp.execFileSync('docker', ['ps', '-aq', '--filter', 'id=' + target.containerId], { env: isolatedEnvironment(), encoding: 'utf8', windowsHide: true }).trim();
      const portResult = await new Promise(resolve => { const socket = net.connect(target.port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve('CONNECTED'); }); socket.once('error', e => resolve(e.code)); socket.setTimeout(1500, () => { socket.destroy(); resolve('TIMEOUT'); }); });
      save('cleanup.json', { ...target, remaining, portResult, passed: remaining === '' && portResult === 'ECONNREFUSED' }); assert.equal(remaining, ''); assert.equal(portResult, 'ECONNREFUSED');
    }
    save('loaded-dependencies.json', Object.keys(require.cache).filter(p => fs.existsSync(p)).map(p => ({ path: path.relative(path.resolve(__dirname, '../../..'), p).replaceAll('\\', '/'), sha256: sha(fs.readFileSync(p)) })).sort((a, b) => a.path.localeCompare(b.path)));
  }
  save('validation.json', { passed: true, fullWriteChainPassed: true, consumerIdentityPrecisionPassed: true, checks, operationCount: operations.length, negativeCount: negatives.length, lockWaitCount: waits.length, httpStarted: false, workerStarted: false, businesoRgaeptance: false }); console.log('B02_ANALYSIS_QUEUE_REQUEST_IDENTITY_PASSED');
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
