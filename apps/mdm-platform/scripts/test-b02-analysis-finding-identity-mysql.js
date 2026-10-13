// Owned synthetic public repository contract. No HTTP, worker, AI or runtime DDL.
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
const input = manifest.files.find(f => f.path === 'apps/mdm-platform/server/analysisIssues.js');
assert.equal(sha(fs.readFileSync(input.snapshot)), input.sha256);
const filename = require.resolve('../server/analysisIssues'), archived = new Module(filename, module);
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
      for (const t of [...require('../server/dataMapDefinitionMigration').baseTables, ...require('../server/analysisDependencyReadiness').identityTables, ...schemaModules.flatMap(m => m.tables), ...queueSchema.tables, 'process_governance_issue_events', 'mdm_todo_events']) await create(t);
      save('reviewed-create-fixture.json', [...created].sort().map(t => ({ table: t, sql: ddl.get(t), sha256: sha(ddl.get(t)) })));
      for (const m of schemaModules) await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [m.MIGRATION_KEY]);
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
        assert.deepEqual(await physical(), before, label + ' every physical row unchanged'); negatives.push({ label, method, code, status, physicalRollback: true });
      }
      const sources = [];
      const payload = (source = sources[0], extra = {}) => ({ request_id: uuid(), inputs: [{ input_key: 'source', kind: 'v7_source', ref_id: source.id }], check_scope: { description: 'synthetic identity contract', check_ids: ['references'] }, parser_versions: { native: 'synthetic-v1' }, rule_version: 'synthetic-v1', steps: [{ step_key: 'read', input_keys: ['source'], check_ids: ['references'], parser_key: 'native' }], ai_metadata: null, rerun_of_run_id: null, ...extra });
      const begin = r => ({ request_id: uuid(), run_id: r.run_id, expected_revision: r.revision_no, step_key: 'read' });
      const complete = (r, a, status = 'succeeded') => ({ request_id: uuid(), run_id: r.run_id, attempt_id: a.attempt_id, expected_revision: a.revision_no, status, checked_ids: status === 'succeeded' ? ['references'] : [], error_code: status === 'succeeded' ? null : 'SYNTHETIC_FAILURE', evidence: status === 'succeeded' ? [{ evidence_key: 'root', input_key: 'source', locator_kind: 'json_pointer', locator: '', note: 'synthetic' }] : [], findings: status === 'succeeded' ? [{ rule_id: 'references', finding_type: 'observation', message: 'synthetic', subject_input_keys: ['source'], semantic_locator: 'process:synthetic', evidence_keys: ['root'] }] : [] });
      const finish = (r, status, revision = r.revision_no) => ({ request_id: uuid(), run_id: r.run_id, expected_revision: revision, status });
      async function createRun(actor = 7, body = payload(), repository = repo) { return call('create-' + actor, 'createAnalysisRun', [session(actor), body], repository); }
      try {
        const issueCode = s => 'DEFINITION_ANALYSIS_ISSUE_' + s;
        async function fixture(actor=7, source=sources[0], extra={}, terminate=true) {
          const r=await createRun(actor,payload(source,extra)), a=await call('fixture-begin','beginAnalysisAttempt',[session(actor),begin(r)]);
          const done=await call('fixture-complete','completeAnalysisAttempt',[session(actor),complete(r,a)]);
          if(terminate) await call('fixture-finish','finishAnalysisRun',[session(actor),finish(r,'succeeded',done.revision_no)]);
          const loaded=await call('fixture-load','getAnalysisRun',[session(actor),r.run_id]);
          return {actor,run:loaded,f:loaded.attempts[0].findings[0],e:loaded.attempts[0].evidence[0]};
        }
        const command=(f,action,extra={})=>({request_id:uuid(),run_id:f.run.run_id,finding_id:f.f.finding_id,expected_revision:1,action,reason:'synthetic reason',owner_department_id:people.find(p=>String(p.personId)===String(f.actor)).dept||'91',owner_basis:'synthetic explicit owner',evidence_ids:[f.e.evidence_id],...(action==='create'?{title:'synthetic issue'}:{}),...extra});
        const write=(label,s,body,repository=repo)=>call(label,'decideAnalysisFinding',[s,body],repository);
        const review=f=>call('finding-review','getFindingReview',[session(f.actor),f.run.run_id,f.f.finding_id]);
        const detail=(id,actor=7)=>call('issue-detail','getAnalysisIssue',[session(actor),id]);
        async function legacyFrom(issueId,newId=null) {
          const row=(await physical()).process_governance_issues.find(r=>r.issue_id===issueId), value={...row,issue_key:'synthetic-legacy-'+uuid(),source_type:'process_mapping'};
          delete value.issue_id;if(newId)value.issue_id=newId;
          await pool.query('INSERT INTO process_governance_issues SET ?',value);
          return (await pool.execute('SELECT CAST(issue_id AS CHAR) id FROM process_governance_issues WHERE issue_key=?',[value.issue_key]))[0][0].id;
        }
        await check('original CREATE fixtures and public V8/V7 uploads',async()=>{
          for(const format of ['v8','v7']) {
            const document=JSON.parse(fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-'+format+'.json')));
            const s=await call('upload-'+format,'registerV7Source',[session(7),{request_id:uuid(),source_kind:'uploaded_material',original_name:'synthetic-'+format+'.json'},Buffer.from(JSON.stringify(document))]);
            assert.equal(s.validation_status,'valid');sources.push({id:s.source_id,document,format});
          }
        });
        await check('four public decisions small then adjacent BIGINT exact rows snapshots and receipts on one execute connection',async()=>{
          for(const actor of [7,P,N]) {
            const records=[];let issueId;
            for(const action of ['confirm','not_an_issue','create','link']) {
              const f=await fixture(actor), body=command(f,action);
              if(action==='link'){const target=await detail(issueId,actor);Object.assign(body,{issue_id:issueId,expected_issue_revision:target.revision_no,expected_issue_digest:target.issue_digest});}
              const result=await write('precision-'+actor+'-'+action,session(actor),body), op=operations.at(-1);
              const stored=await physical(),row=stored.data_map_analysis_finding_reviews.find(r=>r.review_id===result.review_id), snap=parse(row.snapshot_json);
              assert.equal(row.actor_person_id,String(actor));assert.equal(snap.actor_person_id,String(actor));assert.equal(snap.owner_department_id,body.owner_department_id);assert.equal(snap.issue_id,result.issue_id);assert.equal(row.snapshot_digest,digest(snap));
              assert.equal(snap.finding_id,f.f.finding_id);assert.equal(snap.run_id,f.run.run_id);assert.equal(snap.manifest_digest,f.run.manifest_digest);assert.equal(snap.finding_digest,digest(f.f));assert.deepEqual(snap.fixed_inputs,f.run.manifest.inputs);assert.deepEqual(snap.evidence,[f.e]);
              const receipt=stored.data_map_definition_requests.find(r=>r.request_id===body.request_id);assert.equal(receipt.actor_person_id,String(actor));assert.equal(receipt.scope_department_id,body.owner_department_id);assert.deepEqual(parse(receipt.result_json),result);
              if(result.issue_id){issueId=result.issue_id;const binding=stored.data_map_analysis_issue_bindings.find(b=>b.issue_id===issueId);assert.equal(binding.created_by_person_id,String(actor));assert.equal(binding.owner_department_id,body.owner_department_id);
                const ev=stored.process_governance_issue_events.findLast(e=>e.issue_id===issueId);assert.equal(ev.actor_person_id,String(actor));assert.equal(ev.note,body.reason);assert.deepEqual(parse(ev.payload_json),{source_type:'analysis_finding',review_id:result.review_id,run_id:f.run.run_id,finding_id:f.f.finding_id});
                assert.equal((await detail(issueId,actor)).issue.display_status,'waiting_my_action');
              }
              assert.deepEqual(await write('precision-replay',session(actor),body),result);assert.deepEqual(await physical(),stored);
              const history=await review(f);assert.deepEqual(await call('baseline-review','getFindingReview',[session(actor),f.run.run_id,f.f.finding_id],oldRepo),history);
              assert.equal(history.state.actor_person_id,String(actor));assert.equal(history.close_enabled,false);
              records.push({action,result,row,snapshot:snap,request:receipt,writeConnectionId:op.connectionId});
              for(const [field,other] of [['accountId',actor===N?people[7].accountId:people[8].accountId],['authVersion',actor===N?people[7].authVersion:people[8].authVersion]]) await reject('adjacent-'+field+'-'+actor+'-'+action,'decideAnalysisFinding',[{...session(actor),[field]:other},{...body,request_id:uuid()}],'DEFINITION_AUTH_REQUIRED',401);
            }
            precision.push({actor:String(actor),department:people.find(p=>String(p.personId)===String(actor)).dept||'91',connectionId:pinned.threadId,records});
          }
          assert(precision.every(p=>p.records.every(r=>r.writeConnectionId===pinned.threadId)));save('precision.json',precision);
        });
        const fixtures=await Promise.resolve([]);
        for(const action of ['confirm','not_an_issue','create','link'])fixtures.push({action,f:await fixture()});
        const targetIssue=precision[0].records.find(r=>r.action==='create').result.issue_id;
        const legacy=await legacyFrom(targetIssue);const legacyDetail=await detail(legacy);
        const entries=fixtures.map(({action,f})=>[action,()=>command(f,action,action==='link'?{issue_id:legacy,expected_issue_revision:1,expected_issue_digest:legacyDetail.issue_digest}:{})]);
        const unfinished=await fixture(7,sources[0],{},false);
        const base=await physical(),dump=backup();save('base-physical.json',base);
        async function reset(){restore(dump);assert.deepEqual(await physical(),base);}
        async function negative(label,body,code,status=409,s=session(7)){return reject(label,'decideAnalysisFinding',[s,body],code,status);}
        await check('person system-admin overlay no-auth no-grant cross-department write/read and target contracts',async()=>{
          for(const [action,args]of entries)for(const [label,s,code,status]of [
            ['admin',session(9),'DEFINITION_ACCESS_DENIED',403],['overlay',session(10),'DEFINITION_ACCESS_DENIED',403],['system-admin',{identityKind:'system_admin',personId:7,accountId:107,authVersion:1},'DEFINITION_AUTH_REQUIRED',401],['no-auth',{},'DEFINITION_AUTH_REQUIRED',401],['no-grant',session(13),'DEFINITION_ACCESS_DENIED',403],['cross-department',session(11),'DEFINITION_ACCESS_DENIED',403]
          ])await negative(label+'-'+action,args(),code,status,s);
          for(const actor of [9,10]){assert.equal((await detail(targetIssue,actor)).issue.issue_id,targetIssue);const r=await call('admin-review','getFindingReview',[session(actor),fixtures[0].f.run.run_id,fixtures[0].f.f.finding_id]);assert.equal(r.can_confirm,false);await reject('admin-targets','analysisIssueTargets',[session(actor)],'DEFINITION_ACCESS_DENIED',403);}
          for(const [method,args]of [['getFindingReview',[fixtures[0].f.run.run_id,fixtures[0].f.f.finding_id]],['getAnalysisIssue',[targetIssue]],['analysisIssueTargets',[]]]){
            await reject('system-admin-read-'+method,method,[{identityKind:'system_admin',accountId:109,authVersion:1},...args],'DEFINITION_AUTH_REQUIRED',401);
            await reject('no-auth-read-'+method,method,[{},...args],'DEFINITION_AUTH_REQUIRED',401);
          }
          await reject('cross-department-review','getFindingReview',[session(11),fixtures[0].f.run.run_id,fixtures[0].f.f.finding_id],'DEFINITION_ACCESS_DENIED',403);
          await reject('cross-department-issue','getAnalysisIssue',[session(11),targetIssue],'DEFINITION_ACCESS_DENIED',403);
          const targets=await call('targets','analysisIssueTargets',[session(7)]);assert.deepEqual(targets.items.map(x=>x.id),[D,E,'91','92']);
          assert.deepEqual((await call('targets-after-D','analysisIssueTargets',[session(P),D])).items.map(x=>x.id),[E]);
          assert.deepEqual(await call('targets-baseline','analysisIssueTargets',[session(7)],oldRepo),targets);
        });
        const mutations=[
          ['disabled','user_accounts','account_id','107',{account_status:'disabled'},'DEFINITION_AUTH_REQUIRED',401],
          ['password-gate','user_accounts','account_id','107',{must_change_password:1},'DEFINITION_AUTH_REQUIRED',401],
          ['password-change','user_accounts','account_id','107',{password_hash:'synthetic-changed',auth_version:'2'},'DEFINITION_AUTH_REQUIRED',401],
          ['inactive','person','person_id','7',{status:'inactive'},'DEFINITION_AUTH_REQUIRED',401],
          ['rebound','user_accounts','account_id','107',{person_id:'14'},'DEFINITION_AUTH_REQUIRED',401],
          ['null-department','person','person_id','7',{current_department_id:null},'DEFINITION_DEPARTMENT_REQUIRED',403],
          ['revoked','person_roles','person_role_id',base.person_roles.find(r=>r.person_id==='7').person_role_id,{assignment_status:'revoked'},'DEFINITION_ACCESS_DENIED',403]
        ];
        async function change(db,t,k,v,fields){return db.execute('UPDATE `'+t+'` SET '+Object.keys(fields).map(k=>'`'+k+'`=?').join(',')+' WHERE `'+k+'`=CAST(? AS SIGNED)',[...Object.values(fields),v]);}
        await check('all decisions current account person grant and department including moved request scope',async()=>{
          for(const [label,t,k,v,fields,code,status]of mutations)for(const [action,args]of entries){await change(pool,t,k,v,fields);await negative('current-'+label+'-'+action,args(),code,status);await reset();}
          for(const [action,args]of entries){await change(pool,'person','person_id','7',{current_department_id:'92'});const body={...args(),owner_department_id:'92'};
            if(action==='link')await negative('moved-link-owner',body,issueCode('OWNER_MISMATCH'));else {await write('moved-'+action,session(7),body);const p=(await physical()).data_map_definition_requests.find(r=>r.request_id===body.request_id);assert.equal(p.scope_department_id,'92');}await reset();}
          const saved=precision[0].records[0].request;await change(pool,'person','person_id','7',{current_department_id:'92'});
          const oldBody=operations.find(o=>o.result?.review_id===parse(saved.result_json).review_id&&o.method==='decideAnalysisFinding').args[1];await negative('moved-prior-replay',oldBody,'DEFINITION_ACCESS_DENIED',403);await reset();
        });
        const lockQuery='SELECT l.OBJECT_NAME object_name,l.LOCK_MODE lock_mode,t.PROCESSLIST_ID connection_id,b.PROCESSLIST_ID blocking_connection_id FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID JOIN performance_schema.threads b ON b.THREAD_ID=w.BLOCKING_THREAD_ID WHERE t.PROCESSLIST_ID=?';
        async function waitLock(connectionId){for(let i=0;i<200;i++){const [locks]=await pool.execute(lockQuery,[connectionId]);if(locks.length)return locks;await sleep(25);}throw Error('B02_REAL_LOCK_WAIT_NOT_OBSERVED');}
        async function lockChange(label,body,t,k,v,fields,code,status,s=session(7)){
          const before=await physical(),blocker=await pool.getConnection();let pending;
          try{await blocker.beginTransaction();await blocker.execute('SELECT `'+k+'` FROM `'+t+'` WHERE `'+k+'`=CAST(? AS SIGNED) FOR UPDATE',[v]);
            pending=write('wait-'+label,s,body).then(result=>({result}),error=>({error}));const evidence=await waitLock(pinned.threadId);assert(evidence.every(e=>e.connection_id===pinned.threadId&&e.blocking_connection_id===blocker.threadId));
            await change(blocker,t,k,v,fields);const [[row]]=await blocker.query('SELECT *'+(casts.get(t)?','+casts.get(t):'')+' FROM `'+t+'` WHERE `'+k+'`=CAST(? AS SIGNED)',[v]);await blocker.commit();
            const outcome=await pending;assert.equal(outcome.error?.code,code);assert.equal(outcome.error?.statusCode,status);
            const expected=structuredClone(before),index=expected[t].findIndex(x=>String(x[k])===String(v));assert(index>=0);expected[t][index]=row;assert.deepEqual(await physical(),expected);
            waits.push({label,t,k,v,fields,evidence,actorConnectionId:pinned.threadId,blockerConnectionId:blocker.threadId,error:errorValue(outcome.error),physicalRollback:true,externalRow:row});
          }finally{await blocker.rollback().catch(()=>{});blocker.release();if(pending)await pending;await reset();}
        }
        await check('four decisions reject real account person role lock waits including empty department',async()=>{
          for(const [action,args]of entries)for(const [label,t,k,v,fields,code,status]of mutations)await lockChange(label+'-'+action,args(),t,k,v,fields,code,status);
        });
        await check('original errors priorities final decisions evidence and late runs',async()=>{
          for(const [action,args]of entries){await negative('revision-'+action,{...args(),expected_revision:99},issueCode('REVISION_CONFLICT'));await negative('evidence-'+action,{...args(),evidence_ids:['9223372036854775807']},issueCode('EVIDENCE_INVALID'),400);await negative('owner-unresolved-'+action,{...args(),owner_department_id:null},issueCode('OWNER_UNRESOLVED'));await negative('unknown-property-'+action,{...args(),unexpected:true},issueCode('PROPERTY_INVALID'),400);}
          const link=entries[3][1];await negative('target-revision',{...link(),expected_issue_revision:99},issueCode('TARGET_CONFLICT'));await negative('target-digest',{...link(),expected_issue_digest:'0'.repeat(64)},issueCode('TARGET_CONFLICT'));await negative('owner-before-target',{...link(),owner_department_id:'92',expected_issue_digest:'0'.repeat(64)},issueCode('OWNER_MISMATCH'));
          await change(pool,'process_governance_issues','issue_id',legacy,{display_status:'closed'});await negative('closed-before-conflict',{...link(),expected_issue_digest:'0'.repeat(64)},issueCode('TARGET_CLOSED'));await reset();
          await change(pool,'process_governance_issues','issue_id',targetIssue,{what_text:'synthetic changed'});const f=fixtures[3].f;await negative('legacy-changed',command(f,'link',{issue_id:targetIssue,expected_issue_revision:3,expected_issue_digest:'0'.repeat(64)}),issueCode('LEGACY_CHANGED'));await reset();
          for(const [action,args]of entries){const body=args(),result=await write('first-'+action,session(7),body),stored=await physical();assert.deepEqual(await write('retry-'+action,session(7),body),result);assert.deepEqual(await physical(),stored);await negative('different-'+action,{...body,reason:'synthetic changed reason'},'DEFINITION_IDEMPOTENCY_CONFLICT');
            await negative('revision-before-final-'+action,{...body,request_id:uuid()},issueCode('REVISION_CONFLICT'));
            if(['not_an_issue','create','link'].includes(action))await negative('final-'+action,{...body,request_id:uuid(),expected_revision:2},issueCode('DECISION_FINAL'));else assert.equal((await write('confirm-followup',session(7),{...body,request_id:uuid(),action:'not_an_issue',expected_revision:2})).decision,'not_an_issue');await reset();}
          await negative('unfinished',command(unfinished,'confirm'),issueCode('ATTEMPT_NOT_CURRENT'));await call('cancel-unfinished','finishAnalysisRun',[session(7),finish(unfinished.run,'cancelled')]);await negative('late-cancelled',command(unfinished,'confirm'),issueCode('ATTEMPT_NOT_CURRENT'));await reset();
        });
        await check('every mutation and request receipt failure physically rolls back create/link partial work',async()=>{
          for(const [action,args]of entries){await write('write-probe-'+action,session(7),args());const writes=[...new Set(operations.at(-1).trace.filter(q=>/^(INSERT|UPDATE)\b/i.test(q.sql||'')).map(q=>q.sql))];await reset();
            for(const sql of writes){fault=q=>q===sql;try{await negative('fault-'+action+'-'+writes.indexOf(sql),args(),'B02_INJECTED_WRITE_FAILURE',null);}finally{fault=null;}await reset();}
          }
        });
        await check('baseline SQL params lock order and qualifications held to commit in each public decision',async()=>{
          const [[clock]]=await pinned.execute('SELECT UNIX_TIMESTAMP() stamp');await pinned.execute('SET timestamp=?',[clock.stamp]);
          for(const [action,args]of entries){const body=args(),old=await write('order-baseline-'+action,session(7),body,oldRepo),oldTrace=operations.at(-1).trace;await reset();
            beforeCommit=async(db,op)=>{const [locks]=await pool.execute('SELECT l.OBJECT_NAME,l.LOCK_MODE,l.LOCK_TYPE,l.LOCK_STATUS FROM performance_schema.data_locks l JOIN performance_schema.threads t ON t.THREAD_ID=l.THREAD_ID WHERE t.PROCESSLIST_ID=? AND l.OBJECT_SCHEMA=DATABASE()',[db.threadId]);for(const t of ['user_accounts','person','person_roles','roles','role_permissions','data_map_v7_sources','data_map_analysis_runs','data_map_analysis_findings','data_map_definition_requests'])assert(locks.some(l=>l.OBJECT_NAME===t&&l.LOCK_TYPE==='RECORD'&&l.LOCK_STATUS==='GRANTED'),t+' held');if(['create','link'].includes(action))assert(locks.some(l=>l.OBJECT_NAME==='process_governance_issues'&&l.LOCK_TYPE==='RECORD'));op.heldLocks=locks;};
            try{assert.deepEqual(await write('order-current-'+action,session(7),body),old);}finally{beforeCommit=null;}
            const trace=operations.at(-1).trace;assert.deepEqual(trace,oldTrace);if(action==='link'){const issueLock=trace.findIndex(q=>q.sql==='SELECT issue_id FROM process_governance_issues WHERE issue_id=? FOR UPDATE'),actorLock=trace.findIndex(q=>q.sql?.includes('FROM user_accounts WHERE account_id=? FOR UPDATE'));assert(issueLock<actorLock);}await reset();
          }
          await pinned.execute('SET timestamp=0');save('order-clock.json',{timestamp:clock.stamp,scope:'same test connection only, identical physical issue timestamps for baseline/current comparison',originalSQLAndParamsEqual:true});
        });
        await check('immutable V8 and V7 v1 v2 v3 bodies manifest evidence finding review digests and histories',async()=>{
          const rules=require('../server/v7AnalysisRules');
          for(const source of sources)for(const version of source.format==='v8'?[rules.VERSION]:[rules.LEGACY_VERSION,rules.PREVIOUS_VERSION,rules.VERSION]){
            const f=await fixture(7,source,{rule_version:version,parser_versions:{[rules.PARSER]:version},steps:[{step_key:'read',input_keys:['source'],check_ids:['references'],parser_key:rules.PARSER}]});
            const b=command(f,'confirm'),result=await write('format-confirm',session(7),b),saved=await review(f);assert.equal(saved.state.manifest_digest,f.run.manifest_digest);assert.equal(saved.state.finding_digest,digest(f.f));assert.deepEqual(saved.state.evidence,[f.e]);assert.equal(saved.state.decision,'confirmed');
            assert.deepEqual(await call('format-old-read','getFindingReview',[session(7),f.run.run_id,f.f.finding_id],oldRepo),saved);assert.deepEqual((await physical()).data_map_v7_sources,base.data_map_v7_sources);save('format-'+source.format+'-'+version+'.json',{result,run:f.run,review:saved,fixedBodiesUntouched:true});await reset();
          }
        });
        await check('historical nonJSON JSON notes legacy full rows and complete backup restore',async()=>{
          for(const note of ['legacy plain text',json({record_id:'9007199254741993',unknown:null})])await pool.execute("INSERT INTO process_governance_issue_events(issue_id,event_type,actor_person_id,note,payload_json) VALUES (?,'commented',?,?,?)",[targetIssue,N,note,null]);
          const before=await physical(),current=await detail(targetIssue);assert.deepEqual(await call('history-old','getAnalysisIssue',[session(7),targetIssue],oldRepo),current);assert.deepEqual(await physical(),before);
          const snapshot=backup();await change(pool,'data_map_analysis_finding_reviews','review_id',precision[0].records[0].result.review_id,{snapshot_digest:'0'.repeat(64)});await reject('tampered-history','getFindingReview',[session(7),precision[0].records[0].snapshot.run_id,precision[0].records[0].snapshot.finding_id],issueCode('INTEGRITY_CONFLICT'));restore(snapshot);assert.deepEqual(await physical(),before);assert.deepEqual(await detail(targetIssue),current);save('history-restore.json',{dumpSha256:sha(snapshot),fullPhysicalEqual:true,legacyJSONAndNonJSONPreserved:true});await reset();
        });
        await check('source definition mapping handoff and template current references retain fixed digest and refuse superseded writes',async()=>{
          const obj=await call('reference-object','saveDefinition',[session(11),{request_id:uuid(),entity_type:'object',department_id:'92',definition:{name:'synthetic object',business_meaning:'synthetic only'}}]);
          const document=structuredClone(sources[0].document);document.process.process_ref='process_synthetic_refs';document.process.process_name='synthetic references';
          document.behaviors=[{behavior_ref:'behavior_prepare',node_type:'action',behavior_name:'synthetic prepare',behavior_description:'synthetic',current_actor_role:'synthetic 91',actor_assignment_mode:'fixed_department',actor_department_data_ref:null,actor_position_rule:'',trigger:'synthetic',precondition:'',input_description:'synthetic',timing:null,completion_standard:'synthetic',output_description:'synthetic',countersign_all_required:false,countersign_target_departments:[]}];
          document.data_objects=[{data_ref:'data_a',data_name:'synthetic object',description:'synthetic',information_type:'business_conclusion',fields:[],behavior_links:[],source_relations:[],lifecycle:{applicability:'pending_confirmation',entry_state:{business_validity:'pending_confirmation',custody:'pending_confirmation',identifiability_applicability:'pending_confirmation',identifiability:'pending_confirmation'},routes:[],analysis:{analyzer_version:'',source_fingerprint:'',status:'not_analyzed'},decision_reason:'',decision_notes:''}}];
          const source=await call('reference-upload','registerV7Source',[session(7),{request_id:uuid(),source_kind:'uploaded_material',original_name:'synthetic-refs.json'},Buffer.from(JSON.stringify(document))]);assert.equal(source.validation_status,'valid');
          const meta=await call('reference-source','getV7Source',[session(7),source.source_id]);
          const mappingBody={request_id:uuid(),source_digest:meta.content_digest,local_object_ref:'data_a',local_field_ref:null,object_version_id:obj.version_id,field_version_id:null,expected_revision:0,status:'candidate',basis:'synthetic explicit comparison'};
          const mapping=await call('reference-mapping','saveV7Mapping',[session(7),source.source_id,mappingBody]);
          const hd={title:'synthetic handoff',claim_status:'material_declared',source:{mapping_version_id:mapping.mapping_version_id,behavior_ref:'behavior_prepare',operations:['deliver']},target:null,identifier_kind:'unknown',identity_rule:null,identity_basis:null,delivery_condition:'synthetic',reception_requirement:null,evidence:[{side:'source',locator:'synthetic source',note:'synthetic'}],pairs:[]};
          const handoff=await call('reference-handoff','saveDesignHandoff',[session(7),{request_id:uuid(),handoff_id:null,expected_revision:0,definition:hd}]);
          const bytes=await require('./test-word-evidence').fixture();
          // Prepare supported synthetic snapshot data without invoking the parser worker.
          // The decision and reference readers below still use the unmodified public repository.
          const df=await fixture(7,sources[0],{inputs:[{input_key:'source',kind:'definition',ref_id:obj.version_id}]});
          const parsed=require('../server/wordEvidenceParser').extract(bytes,'synthetic.docx');
          const value={...parsed,document:{...parsed.document,links:[{anchor_id:'a1',kind:'definition',ref_id:obj.version_id,basis:'synthetic',fixed_reference:df.run.manifest.inputs[0].snapshot}]}};value.content_digest=digest(value.document);
          const word=await call('reference-template-fixture','registerSource',[session(11),{request_id:uuid(),department_id:'92',parser_version:value.parser_version,template_profile_version:digest(value.document.links),original_name:'synthetic.docx'},bytes]);
          await pool.execute('INSERT INTO data_map_word_evidence(batch_id,snapshot_json,snapshot_digest) VALUES (?,?,?)',[word.batch_id,json(value),digest(value)]);
          const refs=[['v7_source',source.source_id],['definition',obj.version_id],['mapping',mapping.mapping_version_id],['handoff',handoff.handoff_version_id],['template',word.batch_id]];
          const fixed=[];
          for(const [kind,ref]of refs){const f=await fixture(7,sources[0],{inputs:[{input_key:'source',kind,ref_id:ref}]});const body=command(f,'confirm');const beforeRun=await call('reference-read-run','getAnalysisRun',[session(7),f.run.run_id]);
            const local=backup(),physicalBefore=await physical();await write('reference-confirm-'+kind,session(7),body);const r=await review(f);assert.deepEqual(r.state.fixed_inputs,f.run.manifest.inputs);assert.deepEqual(await call('reference-baseline-read','getFindingReview',[session(7),f.run.run_id,f.f.finding_id],oldRepo),r);
            restore(local);assert.deepEqual(await physical(),physicalBefore);
            if(kind==='v7_source')await change(pool,'data_map_v7_sources','source_id',source.source_id,{content_digest:'0'.repeat(64)});
            if(kind==='definition'||kind==='template')await call('supersede-definition','saveDefinition',[session(11),{request_id:uuid(),entity_type:'object',entity_id:obj.entity_id,expected_revision:1,definition:{name:'synthetic revised'}}]);
            if(kind==='mapping')await call('supersede-mapping','saveV7Mapping',[session(7),source.source_id,{...mappingBody,request_id:uuid(),expected_revision:1,basis:'synthetic changed'}]);
            if(kind==='handoff')await call('supersede-handoff','saveDesignHandoff',[session(7),{request_id:uuid(),handoff_id:handoff.handoff_id,expected_revision:1,definition:{...hd,title:'synthetic revised'}}]);
            for(const action of ['confirm','not_an_issue','create','link'])await negative('superseded-'+kind+'-'+action,command(f,action,action==='link'?{issue_id:legacy,expected_issue_revision:1,expected_issue_digest:legacyDetail.issue_digest}:{}),kind==='v7_source'?'DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT':issueCode('SOURCE_SUPERSEDED'));
            restore(local);assert.deepEqual(await physical(),physicalBefore);assert.deepEqual(await call('restored-reference-run','getAnalysisRun',[session(7),f.run.run_id]),beforeRun);fixed.push({kind,ref,run:f.run,review:r,restored:true});
          }
          save('fixed-references.json',fixed);await reset();
        });
        await check('adjacent physical BIGINT run finding issue and source references stay exact without history migration',async()=>{
          async function clone(t,where,params,replace){const [cols]=await pool.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[t]);
            const names=cols.map(c=>'`'+c.COLUMN_NAME+'`'),bind=[];const expressions=cols.map(c=>{if(Object.hasOwn(replace,c.COLUMN_NAME)){bind.push(replace[c.COLUMN_NAME]);return 'CAST(? AS SIGNED)';}return '`'+c.COLUMN_NAME+'`';});
            await pool.execute('INSERT INTO `'+t+'`('+names.join(',')+') SELECT '+expressions.join(',')+' FROM `'+t+'` WHERE '+where,[...bind,...params]);}
          const prototype=fixtures[0].f,ids=['9007199254741800','9007199254741801'],proof=[];
          for(const [i,high]of ids.entries()){
            const runId=high,attemptId=high,findingId=high,evidenceId=high,sourceId=high;
            const sourceRow=base.data_map_v7_sources.find(r=>r.source_id===sources[0].id);const row={...sourceRow,source_id:sourceId,source_key:sha('synthetic-'+high),validation_json:json(parse(sourceRow.validation_json)),content_json:json(parse(sourceRow.content_json))};await pool.query('INSERT INTO data_map_v7_sources SET ?',row);
            const original=base.data_map_analysis_runs.find(r=>r.run_id===prototype.run.run_id),manifest=structuredClone(prototype.run.manifest);manifest.inputs[0].snapshot.ref_id=sourceId;manifest.inputs[0].snapshot.identity.id=sourceId;manifest.inputs[0].snapshot.source_ref.batch_id=sourceId;
            const runRow={...original,run_id:runId,manifest_json:json(manifest),manifest_digest:digest(manifest)};await pool.query('INSERT INTO data_map_analysis_runs SET ?',runRow);
            await clone('data_map_analysis_inputs','run_id=?',[prototype.run.run_id],{run_id:runId,source_id:sourceId});
            await pool.execute('UPDATE data_map_analysis_inputs SET snapshot_json=?,snapshot_digest=? WHERE run_id=?',[json(manifest.inputs[0].snapshot),digest(manifest.inputs[0].snapshot),runId]);
            for(const t of ['data_map_analysis_steps','data_map_analysis_attempts','data_map_analysis_evidence','data_map_analysis_findings','data_map_analysis_finding_inputs','data_map_analysis_finding_evidence']){
              const replacements={run_id:runId};if(t!=='data_map_analysis_steps')replacements.attempt_id=attemptId;if(t==='data_map_analysis_evidence')replacements.evidence_id=evidenceId;if(['data_map_analysis_findings','data_map_analysis_finding_inputs','data_map_analysis_finding_evidence'].includes(t))replacements.finding_id=findingId;
              await clone(t,'run_id=?',[prototype.run.run_id],replacements);
            }
            const loaded=await call('big-run-finding-read','getAnalysisRun',[session(7),runId]);assert.equal(loaded.run_id,runId);assert.equal(loaded.attempts[0].findings[0].finding_id,findingId);assert.equal(loaded.manifest.inputs[0].snapshot.ref_id,sourceId);
            const actor=[P,N][i],f={actor,run:loaded,f:loaded.attempts[0].findings[0],e:loaded.attempts[0].evidence[0]},issueId=await legacyFrom(targetIssue,high);assert.equal(issueId,high);const department=people.find(p=>p.personId===actor).dept;
            await change(pool,'process_governance_issues','issue_id',issueId,{primary_dept_name:'synthetic '+department,owner_dept_name:'synthetic '+department});const target=await detail(issueId,actor);
            const body=command(f,'link',{issue_id:issueId,expected_issue_revision:1,expected_issue_digest:target.issue_digest}),result=await write('big-link-'+high,session(actor),body),r=await review(f),d=await detail(issueId,actor);
            assert.equal(result.issue_id,high);assert.equal(result.finding_id,high);assert.equal(r.state.issue_id,high);assert.equal(r.state.run_id,high);assert.equal(d.links[0].run_id,high);assert.equal(d.links[0].finding_id,high);assert.deepEqual(await call('big-baseline-read','getAnalysisIssue',[session(7),issueId],oldRepo),d);
            proof.push({ids:{runId,attemptId,findingId,evidenceId,sourceId,issueId},result,review:r,issue:d});
          }
          for(const [field,value]of [['run_id',ids[1]],['finding_id',ids[1]],['issue_id',ids[1]]]){const body={...command(prototype,'link',{issue_id:legacy,expected_issue_revision:1,expected_issue_digest:legacyDetail.issue_digest}),[field]:Number(value)};await negative('rounded-'+field,body,'DEFINITION_ID_INVALID',400);}
          save('physical-bigint-reads.json',{ids,proof,syntheticNewRowsOnly:true,samePreparedConnection:pinned.threadId});await reset();
        });
        await check('concurrent first link during actor wait retries original issue-first finding review transaction',async()=>{
          const f=fixtures[3].f,blocker=await pool.getConnection(),writerTrace=[];let pending;
          const other=makeDataMapDefinitionRepository({getConnection:async()=>{const db=await pool.getConnection(),w={};for(const m of ['execute','query'])w[m]=async(sql,params)=>{writerTrace.push({method:m,sql,params,connectionId:db.threadId});return db[m](sql,params);};for(const m of ['beginTransaction','commit','rollback'])w[m]=()=>db[m]();w.release=()=>db.release();return w;}});
          try{await blocker.beginTransaction();await blocker.execute('SELECT account_id FROM user_accounts WHERE account_id=107 FOR UPDATE');
            pending=call('concurrent-first-link-read','getFindingReview',[session(7),f.run.run_id,f.f.finding_id]).then(result=>({result}),error=>({error}));const evidence=await waitLock(pinned.threadId);
            const linked=await other.decideAnalysisFinding(session(8),entries[3][1]());await blocker.commit();const outcome=await pending;assert(!outcome.error);assert.equal(outcome.result.state.issue_id,linked.issue_id);
            const op=operations.at(-1),trace=op.trace;assert.equal(trace.filter(q=>q.event==='begin').length,2);assert.equal(trace.filter(q=>q.event==='commit').length,2);
            const starts=trace.map((q,i)=>q.event==='begin'?i:-1).filter(i=>i>=0),second=trace.slice(starts[1]);const issueFirst=second.findIndex(q=>q.sql==='SELECT issue_id FROM process_governance_issues WHERE issue_id=? FOR UPDATE'),identity=second.findIndex(q=>q.sql?.includes('FROM user_accounts WHERE account_id=? FOR UPDATE'));assert(issueFirst>=0&&issueFirst<identity);
            save('first-link-retry.json',{evidence,requestConnectionId:pinned.threadId,blockerConnectionId:blocker.threadId,writerTrace,linked,result:outcome.result,readerTrace:trace,originalRetryPreserved:true});
          }finally{await blocker.rollback().catch(()=>{});blocker.release();if(pending)await pending;await reset();}
        });
        await check('department reader current qualifications and actual person department movement after lock waits',async()=>{
          const f=fixtures[0].f,readers=[['getFindingReview',[f.run.run_id,f.f.finding_id]],['getAnalysisIssue',[targetIssue]]];
          const grant=base.person_roles.find(r=>r.person_id==='12'),changes=[
            ['read-account-disabled','user_accounts','account_id','112',{account_status:'disabled'},'DEFINITION_AUTH_REQUIRED',401],
            ['read-password-gate','user_accounts','account_id','112',{must_change_password:1},'DEFINITION_AUTH_REQUIRED',401],
            ['read-generation','user_accounts','account_id','112',{password_hash:'synthetic-new',auth_version:2},'DEFINITION_AUTH_REQUIRED',401],
            ['read-rebound','user_accounts','account_id','112',{person_id:'14'},'DEFINITION_AUTH_REQUIRED',401],
            ['read-inactive','person','person_id','12',{status:'inactive'},'DEFINITION_AUTH_REQUIRED',401],
            ['read-empty-department','person','person_id','12',{current_department_id:null},'DEFINITION_ACCESS_DENIED',403],
            ['read-revoked','person_roles','person_role_id',grant.person_role_id,{assignment_status:'revoked'},'DEFINITION_ACCESS_DENIED',403],
            ['read-moved-department','person','person_id','12',{current_department_id:'92'},'DEFINITION_ACCESS_DENIED',403]
          ];
          for(const [method,args]of readers){await call('contact-positive-'+method,method,[session(12),...args]);
            for(const [label,t,k,v,fields,code,status]of changes){const before=await physical(),blocker=await pool.getConnection();let pending;
              try{await blocker.beginTransaction();await blocker.execute('SELECT `'+k+'` FROM `'+t+'` WHERE `'+k+'`=CAST(? AS SIGNED) FOR UPDATE',[v]);pending=call(label+'-'+method,method,[session(12),...args]).then(result=>({result}),error=>({error}));const evidence=await waitLock(pinned.threadId);assert(evidence.every(e=>e.connection_id===pinned.threadId&&e.blocking_connection_id===blocker.threadId));
                await change(blocker,t,k,v,fields);const [[row]]=await blocker.query('SELECT *'+(casts.get(t)?','+casts.get(t):'')+' FROM `'+t+'` WHERE `'+k+'`=CAST(? AS SIGNED)',[v]);await blocker.commit();const outcome=await pending;assert.equal(outcome.error?.code,code);assert.equal(outcome.error?.statusCode,status);
                const expected=structuredClone(before);expected[t][expected[t].findIndex(r=>String(r[k])===String(v))]=row;assert.deepEqual(await physical(),expected);waits.push({label:label+'-'+method,method,evidence,actorConnectionId:pinned.threadId,blockerConnectionId:blocker.threadId,error:errorValue(outcome.error),physicalRollback:true,positiveBeforeInvalidation:true});
              }finally{await blocker.rollback().catch(()=>{});blocker.release();if(pending)await pending;await reset();}
            }
          }
          for(const [action,args]of entries)for(const field of ['personId','accountId','authVersion'])await negative('rounded-session-'+field+'-'+action,args(),'DEFINITION_ID_INVALID',400,{...session(N),[field]:Number(people[8][field])});
        });
        save('operations.json',operations);save('negative-results.json',negatives);save('lock-waits.json',waits);assert.deepEqual(await physical(),base);save('restored-physical.json',await physical());
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
  save('validation.json', { passed: true, fullWriteChainPassed: true, consumerIdentityPrecisionPassed: true, checks, operationCount: operations.length, negativeCount: negatives.length, lockWaitCount: waits.length, httpStarted: false, workerStarted: false, businessAcceptance: false }); console.log('B02_ANALYSIS_FINDING_IDENTITY_PASSED');
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
