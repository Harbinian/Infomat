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
const input = manifest.files.find(f => f.path === 'apps/mdm-platform/server/analysisIssueTasks.js');
assert.equal(sha(fs.readFileSync(input.snapshot)), input.sha256);
const filename = require.resolve('../server/analysisIssueTasks'), archived = new Module(filename, module);
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
        const taskCode=s=>'DEFINITION_ANALYSIS_TASK_'+s;
        const purposes=['verify','correct','coordinate','review'];
        async function fixture(actor=7, source=sources[0], extra={}) {
          const r=await createRun(actor,payload(source,extra)),a=await call('fixture-begin','beginAnalysisAttempt',[session(actor),begin(r)]);
          const done=await call('fixture-complete','completeAnalysisAttempt',[session(actor),complete(r,a)]);
          await call('fixture-finish','finishAnalysisRun',[session(actor),finish(r,'succeeded',done.revision_no)]);
          const loaded=await call('fixture-load','getAnalysisRun',[session(actor),r.run_id]);
          return {actor,run:loaded,f:loaded.attempts[0].findings[0],e:loaded.attempts[0].evidence[0]};
        }
        const command=(f,action,extra={})=>({request_id:uuid(),run_id:f.run.run_id,finding_id:f.f.finding_id,expected_revision:1,action,reason:'synthetic reason',owner_department_id:people.find(p=>String(p.personId)===String(f.actor)).dept||'91',owner_basis:'synthetic explicit owner',evidence_ids:[f.e.evidence_id],...(action==='create'?{title:'synthetic issue'}:{}),...extra});
        const detail=(issueId,actor=7)=>call('issue-detail','getAnalysisIssue',[session(actor),issueId]);
        const tasks=(issueId,actor=7,repository=repo)=>call('task-list','getAnalysisIssueTasks',[session(actor),issueId],repository);
        const write=(label,s,body,repository=repo)=>call(label,'dispatchAnalysisIssueTask',[s,body],repository);
        const offices=new Map();
        async function change(db,t,k,v,fields){return db.execute('UPDATE `'+t+'` SET '+Object.keys(fields).map(k=>'`'+k+'`=?').join(',')+' WHERE `'+k+'`=CAST(? AS SIGNED)',[...Object.values(fields),v]);}
        async function issueFixture(actor=7,source=sources[0],extra={}) {
          const f=await fixture(actor,source,extra),result=await call('fixture-issue','decideAnalysisFinding',[session(actor),command(f,'create')]);
          return {...f,issueId:result.issue_id};
        }
        const body=(f,view,purpose='verify',round=1,extra={})=>({request_id:uuid(),issue_id:f.issueId,expected_revision:view.revision_no,expected_issue_digest:view.issue_digest,office_id:offices.get(people.find(p=>String(p.personId)===String(f.actor)).dept||'91'),purpose,round_no:round,instruction:'  SYNTHETIC_EXPLICIT_MINIMAL_INSTRUCTION  ',...extra});
        await check('original CREATE fixtures public V8 V7 uploads and explicit synthetic office scope',async()=>{
          for(const format of ['v8','v7']) {
            const document=JSON.parse(fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-'+format+'.json')));
            const s=await call('upload-'+format,'registerV7Source',[session(7),{request_id:uuid(),source_kind:'uploaded_material',original_name:'synthetic-'+format+'.json'},Buffer.from(JSON.stringify(document))]);assert.equal(s.validation_status,'valid');sources.push({id:s.source_id,document,format});
          }
          for(const [i,d] of ['91','92',D,E].entries()) {
            const officeId=['51','52','9007199254741500','9007199254741501'][i];
            await pool.execute("INSERT INTO org_unit(org_unit_id,org_unit_code,org_unit_name,org_type,department_id) VALUES (CAST(? AS SIGNED),?,?,'office',CAST(? AS SIGNED))",[officeId,'O'+officeId,'synthetic office '+d,d]);offices.set(d,officeId);
          }
        });
        await check('all four purposes small then adjacent BIGINT actors departments accounts generations persist exact physical rows',async()=>{
          for(const actor of [7,P,N]) {
            const f=await issueFixture(actor),records=[];
            for(const purpose of purposes) {
              const view=await tasks(f.issueId,actor),b=body(f,view,purpose),result=await write('precision-'+actor+'-'+purpose,session(actor),b),op=operations.at(-1),stored=await physical();
              const todo=stored.mdm_todos.find(t=>t.id===result.todo_id),a=stored.mdm_todo_office_assignments.find(t=>t.todo_id===result.todo_id),link=stored.data_map_analysis_issue_tasks.find(t=>t.todo_id===result.todo_id),snap=parse(link.snapshot_json);
              const dept=people.find(p=>String(p.personId)===String(actor)).dept||'91';
              assert.equal(todo.created_by,String(actor));assert.equal(todo.created_by_person_id,String(actor));assert.equal(todo.to_dept_id,dept);assert.equal(todo.type,'office_work');assert.equal(todo.status,'pending');assert(!todo.content.includes(b.instruction.trim()));
              assert.equal(a.assigned_by_person_id,String(actor));assert.equal(a.office_id,b.office_id);assert.equal(a.request_id,b.request_id);assert.equal(a.assignee_person_id,null);assert.equal(a.revision_no,1);
              assert.equal(link.created_by_person_id,String(actor));assert.equal(link.issue_id,f.issueId);assert.equal(link.snapshot_digest,digest(snap));assert.equal(snap.actor_person_id,String(actor));assert.equal(snap.office_id,b.office_id);assert.equal(snap.instruction,b.instruction.trim());assert.equal(snap.issue_revision,view.revision_no);assert.equal(snap.issue_digest,view.issue_digest);
              const source=(await detail(f.issueId,actor)).links;assert.deepEqual(snap.sources,source.map(l=>({run_id:l.run_id,finding_id:l.finding_id,review:l.reviews.at(-1)})));assert.equal(snap.sources[0].run_id,f.run.run_id);assert.equal(snap.sources[0].finding_id,f.f.finding_id);assert.deepEqual(snap.sources[0].review.fixed_inputs,f.run.manifest.inputs);
              const te=stored.mdm_todo_events.findLast(e=>e.todo_id===result.todo_id);assert.equal(te.actor_user_id,String(actor));assert.equal(te.actor_person_id,String(actor));assert.equal(te.event_type,'office_received');assert.deepEqual(parse(te.note),{office_id:b.office_id,issue_id:f.issueId,purpose,round_no:1});
              const ie=stored.process_governance_issue_events.findLast(e=>e.issue_id===f.issueId);assert.equal(ie.actor_person_id,String(actor));assert.equal(ie.event_type,'commented');assert.deepEqual(parse(ie.payload_json),{todo_id:result.todo_id,purpose,round_no:1});
              const req=stored.data_map_definition_requests.find(r=>r.request_id===b.request_id);assert.equal(req.actor_person_id,String(actor));assert.equal(req.scope_department_id,dept);assert.equal(req.action,'analysis_issue_dispatch');assert.deepEqual(parse(req.result_json),result);
              assert.deepEqual(await write('precision-replay',session(actor),b),result);assert.deepEqual(await physical(),stored);
              const current=await tasks(f.issueId,actor);assert.equal(current.can_dispatch,true);assert.equal(current.close_enabled,false);assert.equal(current.auto_dispatch_enabled,false);assert.deepEqual(await tasks(f.issueId,actor,oldRepo),current);assert.deepEqual(current.offices.map(o=>o.id),[b.office_id]);
              records.push({purpose,body:b,result,todo,assignment:a,task:link,snapshot:snap,todoEvent:te,issueEvent:ie,request:req,connectionId:op.connectionId});
              for(const [field,other]of [['accountId',actor===N?people[7].accountId:people[8].accountId],['authVersion',actor===N?people[7].authVersion:people[8].authVersion]]) await reject('adjacent-'+field+'-'+actor+'-'+purpose,'dispatchAnalysisIssueTask',[{...session(actor),[field]:other},{...b,request_id:uuid()}],'DEFINITION_AUTH_REQUIRED',401);
            }
            precision.push({actor:String(actor),issueId:f.issueId,f,records,connectionId:pinned.threadId});
          }
          assert(precision.every(p=>p.records.every(r=>r.connectionId===pinned.threadId)));save('precision.json',precision);
        });
        const fixtures=[];for(const purpose of purposes)fixtures.push({purpose,f:await issueFixture()});
        const targetIssue=precision[0].issueId;
        const base=await physical(),dump=backup();save('base-physical.json',base);
        async function reset(){restore(dump);assert.deepEqual(await physical(),base);}
        const entries=[];for(const {purpose,f}of fixtures)entries.push([purpose,()=>body(f,{revision_no:2,issue_digest:base.data_map_analysis_issue_bindings.find(b=>b.issue_id===f.issueId).issue_digest},purpose)]);
        const negative=(label,b,code,status=409,s=session(7))=>reject(label,'dispatchAnalysisIssueTask',[s,b],code,status);
        await check('adjacent physical BIGINT issue office todo run finding and prior todo select on same small-warmed prepared connection',async()=>{
          async function clone(t,where,params,replace){const [cols]=await pool.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[t]);const bind=[],names=cols.map(c=>'`'+c.COLUMN_NAME+'`'),expressions=cols.map(c=>{if(Object.hasOwn(replace,c.COLUMN_NAME)){bind.push(replace[c.COLUMN_NAME]);return 'CAST(? AS SIGNED)';}return '`'+c.COLUMN_NAME+'`';});await pool.execute('INSERT INTO `'+t+'`('+names.join(',')+') SELECT '+expressions.join(',')+' FROM `'+t+'` WHERE '+where,[...bind,...params]);}
          const prototype=fixtures[0].f,ids=['9007199254741800','9007199254741801'],proof=[];
          // Warm both the baseline and current previous-task statements with a real small predecessor.
          const small=entries[0][1](),first=await write('warm-first',session(7),small);await change(pool,'mdm_todos','id',first.todo_id,{status:'done'});const warm={...small,request_id:uuid(),round_no:2,expected_revision:first.revision_no};
          await write('warm-second',session(7),warm,oldRepo);await reset();await write('warm-first-current',session(7),small);await change(pool,'mdm_todos','id',first.todo_id,{status:'done'});await write('warm-second-current',session(7),warm);await reset();
          for(const [i,high]of ids.entries()) {
            const actor=[P,N][i],runId=high,attemptId=high,findingId=high,evidenceId=high;
            const original=base.data_map_analysis_runs.find(r=>r.run_id===prototype.run.run_id),runRow={...original,run_id:runId,manifest_json:json(parse(original.manifest_json))};await pool.query('INSERT INTO data_map_analysis_runs SET ?',runRow);
            await clone('data_map_analysis_inputs','run_id=?',[prototype.run.run_id],{run_id:runId});
            for(const t of ['data_map_analysis_steps','data_map_analysis_attempts','data_map_analysis_evidence','data_map_analysis_findings','data_map_analysis_finding_inputs','data_map_analysis_finding_evidence']) {const replace={run_id:runId};if(t!=='data_map_analysis_steps')replace.attempt_id=attemptId;if(t==='data_map_analysis_evidence')replace.evidence_id=evidenceId;if(['data_map_analysis_findings','data_map_analysis_finding_inputs','data_map_analysis_finding_evidence'].includes(t))replace.finding_id=findingId;await clone(t,'run_id=?',[prototype.run.run_id],replace);}
            const department=people.find(p=>p.personId===actor).dept;
            const row={...base.process_governance_issues.find(r=>r.issue_id===targetIssue),issue_id:high,issue_key:'synthetic-big-'+high,primary_dept_name:'synthetic '+department,owner_dept_name:'synthetic '+department};await pool.query('INSERT INTO process_governance_issues SET ?',row);
            const d=await detail(high,actor),loaded=await call('big-run-read','getAnalysisRun',[session(actor),runId]),f={actor,issueId:high,run:loaded,f:loaded.attempts[0].findings[0],e:loaded.attempts[0].evidence[0]};
            await call('big-binding','decideAnalysisFinding',[session(actor),command(f,'link',{issue_id:high,expected_issue_revision:1,expected_issue_digest:d.issue_digest})]);const view=await tasks(high,actor),b=body(f,view),result=await write('big-dispatch-'+high,session(actor),b),after=await tasks(high,actor);
            assert.equal(after.items[0].snapshot.issue_id,high);assert.equal(after.items[0].snapshot.office_id,offices.get(i?E:D));assert.equal(after.items[0].snapshot.sources[0].run_id,high);assert.equal(after.items[0].snapshot.sources[0].finding_id,high);
            // Make newly synthetic adjacent predecessor todos without rewriting any accepted history.
            const todoId='900719925474190'+i;
            if(todoId!==result.todo_id){await clone('mdm_todos','id=?',[result.todo_id],{id:todoId});await clone('mdm_todo_office_assignments','todo_id=?',[result.todo_id],{todo_id:todoId,request_id:null});await change(pool,'data_map_analysis_issue_tasks','todo_id',result.todo_id,{todo_id:todoId});}
            assert.equal((await tasks(high,actor)).items[0].todo_id,todoId);
            proof.push({actor,f,b,result,view:after,todoId});
          }
          await change(pool,'mdm_todos','id',proof[1].todoId,{status:'done'});
          const second=body(proof[1].f,await tasks(ids[1],N),'verify',2),before=await physical();let baselineResult,baselineError;
          try{baselineResult=await write('baseline-bigint-prior',session(N),second,oldRepo);}catch(e){baselineError=errorValue(e);}
          const baselineTrace=operations.at(-1).trace,priorRead=baselineTrace.find(q=>q.sql==='SELECT status FROM mdm_todos WHERE id=? FOR UPDATE');assert(priorRead);assert.notEqual(String(priorRead.params[0]),proof[1].todoId,'baseline rounded prior id must reproduce');assert.equal(baselineError?.code,taskCode('PREVIOUS_ACTION_PENDING'));assert.deepEqual(await physical(),before);
          save('baseline-bigint-regression.json',{baselineResult,baselineError,baselineTrace,expectedPreviousTodoId:proof[1].todoId,actualPreviousTodoId:priorRead.params[0],noBaselineRowsChanged:true});
          assert.equal(before.mdm_todos.find(r=>r.id===proof[1].todoId).status,'done');assert.equal(before.mdm_todos.find(r=>r.id===proof[0].todoId).status,'pending');
          const originalBinding=(await pinned.execute('SELECT status FROM mdm_todos WHERE id=? FOR UPDATE',[proof[1].todoId]))[0],exactBinding=(await pinned.execute('SELECT status FROM mdm_todos WHERE id=CAST(? AS SIGNED) FOR UPDATE',[proof[1].todoId]))[0];assert.equal(originalBinding[0].status,'pending');assert.equal(exactBinding[0].status,'done');save('prepared-bind-regression.json',{id:proof[1].todoId,originalBinding,exactBinding,physicalRows:before.mdm_todos.filter(r=>[proof[0].todoId,proof[1].todoId].includes(r.id)),connectionId:pinned.threadId});
          const current=await write('current-bigint-prior',session(N),second),trace=operations.at(-1).trace,currentPrior=trace.find(q=>q.sql==='SELECT status FROM mdm_todos WHERE id=CAST(? AS SIGNED) FOR UPDATE');assert.equal(currentPrior.params[0],proof[1].todoId);assert.equal(typeof currentPrior.params[0],'string');assert.equal((await tasks(ids[1],N)).items[1].todo_id,current.todo_id);
          await change(pool,'mdm_todos','id',proof[0].todoId,{status:'done'});const even=body(proof[0].f,await tasks(ids[0],P),'verify',2);await write('current-bigint-even-prior',session(P),even);assert.equal(operations.at(-1).trace.find(q=>q.sql==='SELECT status FROM mdm_todos WHERE id=CAST(? AS SIGNED) FOR UPDATE').params[0],proof[0].todoId);
          save('physical-bigint-reads.json',{ids,proof,current,baselineError,preparedConnection:pinned.threadId,syntheticNewRowsOnly:true});await reset();
        });
        await check('person admin overlay system-admin no-auth no-grant and cross-department original write read contracts',async()=>{
          for(const [purpose,args]of entries)for(const [label,s,code,status]of [
            ['admin',session(9),'DEFINITION_ACCESS_DENIED',403],['overlay',session(10),'DEFINITION_ACCESS_DENIED',403],['system-admin',{identityKind:'system_admin',personId:7,accountId:107,authVersion:1},'DEFINITION_AUTH_REQUIRED',401],['no-auth',{},'DEFINITION_AUTH_REQUIRED',401],['no-grant',session(13),'DEFINITION_ACCESS_DENIED',403],['cross-department',session(11),'DEFINITION_ACCESS_DENIED',403]
          ])await negative(label+'-'+purpose,args(),code,status,s);
          for(const actor of [9,10,12]){const view=await tasks(targetIssue,actor);assert.equal(view.can_dispatch,false);assert.deepEqual(view.offices,[]);assert.equal(view.close_enabled,false);assert.deepEqual(await tasks(targetIssue,actor,oldRepo),view);}
          for(const [label,s,code,status]of [['system-admin',{identityKind:'system_admin',accountId:109,authVersion:1},'DEFINITION_AUTH_REQUIRED',401],['no-auth',{},'DEFINITION_AUTH_REQUIRED',401],['no-grant',session(13),'DEFINITION_ACCESS_DENIED',403],['cross',session(11),'DEFINITION_ACCESS_DENIED',403]])await reject(label+'-read','getAnalysisIssueTasks',[s,targetIssue],code,status);
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
        await check('four dispatch purposes current actor qualification and moved request scope',async()=>{
          for(const [label,t,k,v,fields,code,status]of mutations)for(const [purpose,args]of entries){await change(pool,t,k,v,fields);await negative('current-'+label+'-'+purpose,args(),code,status);await reset();}
          for(const [purpose,args]of entries){await change(pool,'person','person_id','7',{current_department_id:'92'});const b=args(),result=await write('moved-'+purpose,session(7),b);const stored=await physical(),req=stored.data_map_definition_requests.find(r=>r.request_id===b.request_id),todo=stored.mdm_todos.find(t=>t.id===result.todo_id);assert.equal(req.scope_department_id,'92');assert.equal(todo.to_dept_id,'91');await reset();}
          const old=precision[0].records[0].body;await change(pool,'person','person_id','7',{current_department_id:'92'});await negative('moved-prior-replay',old,'DEFINITION_ACCESS_DENIED',403);await reset();
        });
        const lockQuery='SELECT l.OBJECT_NAME object_name,l.LOCK_MODE lock_mode,t.PROCESSLIST_ID connection_id,b.PROCESSLIST_ID blocking_connection_id FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID JOIN performance_schema.threads b ON b.THREAD_ID=w.BLOCKING_THREAD_ID WHERE t.PROCESSLIST_ID=?';
        async function waitLock(connectionId){for(let i=0;i<200;i++){const [locks]=await pool.execute(lockQuery,[connectionId]);if(locks.length)return locks;await sleep(25);}throw Error('B02_REAL_LOCK_WAIT_NOT_OBSERVED');}
        async function lockChange(label,b,t,k,v,fields,code,status,s=session(7),method='dispatchAnalysisIssueTask'){
          const before=await physical(),blocker=await pool.getConnection();let pending;
          try {await blocker.beginTransaction();await blocker.execute('SELECT `'+k+'` FROM `'+t+'` WHERE `'+k+'`=CAST(? AS SIGNED) FOR UPDATE',[v]);
            const args=method==='getAnalysisIssueTasks'?[s,b.issue_id]:[s,b];pending=call('wait-'+label,method,args).then(result=>({result}),error=>({error}));const evidence=await waitLock(pinned.threadId);assert(evidence.every(e=>e.connection_id===pinned.threadId&&e.blocking_connection_id===blocker.threadId));
            await change(blocker,t,k,v,fields);const [[row]]=await blocker.query('SELECT *'+(casts.get(t)?','+casts.get(t):'')+' FROM `'+t+'` WHERE `'+k+'`=CAST(? AS SIGNED)',[v]);await blocker.commit();const outcome=await pending;assert.equal(outcome.error?.code,code);assert.equal(outcome.error?.statusCode,status);
            const expected=structuredClone(before),index=expected[t].findIndex(x=>String(x[k])===String(v));assert(index>=0);expected[t][index]=row;assert.deepEqual(await physical(),expected);
            waits.push({label,method,t,k,v,fields,evidence,actorConnectionId:pinned.threadId,blockerConnectionId:blocker.threadId,error:errorValue(outcome.error),physicalRollback:true,externalRow:row});
          }finally{await blocker.rollback().catch(()=>{});blocker.release();if(pending)await pending;await reset();}
        }
        await check('real issue-first actor waits reject revocation generation gate account rebinding inactive and empty department',async()=>{
          for(const [purpose,args]of entries)for(const [label,t,k,v,fields,code,status]of mutations)await lockChange(label+'-'+purpose,args(),t,k,v,fields,code,status);
          const moved=entries[0][1](),blocker=await pool.getConnection();let pending;
          try{await blocker.beginTransaction();await blocker.execute('SELECT person_id FROM person WHERE person_id=7 FOR UPDATE');pending=write('wait-moved-global',session(7),moved).then(result=>({result}),error=>({error}));const evidence=await waitLock(pinned.threadId);await change(blocker,'person','person_id','7',{current_department_id:'92'});await blocker.commit();const outcome=await pending;assert(!outcome.error);assert.equal((await physical()).data_map_definition_requests.find(r=>r.request_id===moved.request_id).scope_department_id,'92');waits.push({label:'moved-global-write',evidence,result:outcome.result,positiveBeforeInvalidation:true});}finally{await blocker.rollback().catch(()=>{});blocker.release();if(pending)await pending;await reset();}
          const grant=base.person_roles.find(r=>r.person_id==='12'),readMutations=[
            ['read-disabled','user_accounts','account_id','112',{account_status:'disabled'},'DEFINITION_AUTH_REQUIRED',401],['read-gate','user_accounts','account_id','112',{must_change_password:1},'DEFINITION_AUTH_REQUIRED',401],['read-generation','user_accounts','account_id','112',{auth_version:2},'DEFINITION_AUTH_REQUIRED',401],['read-rebound','user_accounts','account_id','112',{person_id:14},'DEFINITION_AUTH_REQUIRED',401],['read-inactive','person','person_id','12',{status:'inactive'},'DEFINITION_AUTH_REQUIRED',401],['read-null-department','person','person_id','12',{current_department_id:null},'DEFINITION_ACCESS_DENIED',403],['read-revoked','person_roles','person_role_id',grant.person_role_id,{assignment_status:'revoked'},'DEFINITION_ACCESS_DENIED',403],['read-moved','person','person_id','12',{current_department_id:'92'},'DEFINITION_ACCESS_DENIED',403]
          ];
          await tasks(targetIssue,12);
          for(const [label,t,k,v,fields,code,status]of readMutations)await lockChange(label,{issue_id:targetIssue},t,k,v,fields,code,status,session(12),'getAnalysisIssueTasks');
        });
        await check('original errors priorities revision digest duplicate rounds pending prior action closed unlinked and office scope',async()=>{
          for(const [purpose,args]of entries){
            await negative('revision-'+purpose,{...args(),expected_revision:99},taskCode('REVISION_CONFLICT'));await negative('digest-'+purpose,{...args(),expected_issue_digest:'0'.repeat(64)},taskCode('REVISION_CONFLICT'));
            await negative('unknown-'+purpose,{...args(),unexpected:true},taskCode('PROPERTY_INVALID'),400);await negative('office-scope-before-action-'+purpose,{...args(),office_id:offices.get('92'),purpose:'bad'},taskCode('OFFICE_SCOPE_MISMATCH'),403);
            await negative('instruction-'+purpose,{...args(),instruction:' '},taskCode('INSTRUCTION_REQUIRED'),400);await negative('action-'+purpose,{...args(),purpose:'bad'},taskCode('ACTION_INVALID'),400);
            await negative('round-jump-'+purpose,{...args(),round_no:2},taskCode('ROUND_CONFLICT'));
            const b=args(),result=await write('first-'+purpose,session(7),b),stored=await physical();assert.deepEqual(await write('same-'+purpose,session(7),b),result);assert.deepEqual(await physical(),stored);await negative('different-'+purpose,{...b,instruction:'synthetic changed'},'DEFINITION_IDEMPOTENCY_CONFLICT');
            await negative('revision-before-duplicate-'+purpose,{...b,request_id:uuid()},taskCode('REVISION_CONFLICT'));await negative('duplicate-'+purpose,{...b,request_id:uuid(),expected_revision:result.revision_no},taskCode('ACTION_ALREADY_DISPATCHED'));
            await negative('pending-'+purpose,{...b,request_id:uuid(),round_no:2,expected_revision:result.revision_no},taskCode('PREVIOUS_ACTION_PENDING'));await negative('jump-'+purpose,{...b,request_id:uuid(),round_no:3,expected_revision:result.revision_no},taskCode('ROUND_CONFLICT'));
            // Explicit synthetic completed physical predecessor; office reply semantics are covered by unchanged accepted evidence.
            await change(pool,'mdm_todos','id',result.todo_id,{status:'done'});await pool.execute("INSERT INTO mdm_todo_events(todo_id,event_type,actor_user_id,actor_person_id,note) VALUES (?,'office_task_completed',?,?,?)",[result.todo_id,7,7,json({note:'synthetic valid prior completion'})]);
            const prior=await tasks(b.issue_id),next=await write('second-'+purpose,session(7),{...b,request_id:uuid(),round_no:2,expected_revision:result.revision_no});const view=await tasks(b.issue_id);assert.deepEqual(view.items[0],prior.items[0]);assert.equal(view.items[1].todo_id,next.todo_id);assert.equal(view.items[1].status,'pending');assert.equal((await detail(b.issue_id)).issue.display_status,'waiting_my_action');await reset();
          }
          for(const status of ['completed','closed','not_in_scope']){const b=entries[0][1]();await change(pool,'process_governance_issues','issue_id',b.issue_id,{display_status:status});const row=(await physical()).process_governance_issues.find(r=>r.issue_id===b.issue_id);await change(pool,'data_map_analysis_issue_bindings','issue_id',b.issue_id,{issue_digest:digest(row)});await negative('closed-before-conflict-'+status,{...b,expected_revision:99},taskCode('ISSUE_CLOSED'));await reset();}
          const b=entries[0][1]();await change(pool,'process_governance_issues','issue_id',b.issue_id,{what_text:'synthetic changed complete row'});await negative('full-row-digest-before-office',{...b,office_id:offices.get('92')},'DEFINITION_ANALYSIS_ISSUE_LEGACY_CHANGED');await reset();
          await pool.execute('DELETE FROM data_map_analysis_finding_reviews WHERE issue_id=?',[b.issue_id]);await pool.execute('DELETE FROM data_map_analysis_issue_bindings WHERE issue_id=?',[b.issue_id]);await negative('no-grant-before-unlinked',b,'DEFINITION_ACCESS_DENIED',403,session(13));await negative('unlinked-authorized',b,taskCode('ISSUE_UNLINKED'));await reject('unlinked-read','getAnalysisIssueTasks',[session(7),b.issue_id],taskCode('ISSUE_UNLINKED'));await reset();
          await negative('missing-issue', {...b,issue_id:'9223372036854775807'},'DEFINITION_ANALYSIS_ISSUE_NOT_FOUND',404);
          for(const [field,value]of [['personId',N],['accountId',people[8].accountId],['authVersion',people[8].authVersion]])await negative('rounded-session-'+field,b,'DEFINITION_ID_INVALID',400,{...session(N),[field]:Number(value)});
          for(const [field,value]of [['issue_id','9007199254741801'],['office_id',offices.get(E)]])await negative('rounded-payload-'+field,{...b,[field]:Number(value)},'DEFINITION_ID_INVALID',400);
          for(const round_no of [0,10001,1.5,'1'])await negative('invalid-round-'+round_no,{...b,round_no},taskCode('ACTION_INVALID'),400);
        });
        await check('office and target department current invalidation after real locks',async()=>{
          const b=entries[0][1]();for(const purpose of purposes){const value={...b,purpose,request_id:uuid()};
            await lockChange('office-inactive-'+purpose,value,'org_unit','org_unit_id',offices.get('91'),{status:'inactive'},taskCode('OFFICE_UNAVAILABLE'),404);
            await lockChange('department-inactive-'+purpose,value,'departments','id','91',{status:'inactive'},taskCode('OFFICE_UNAVAILABLE'),404);
            await lockChange('office-moved-'+purpose,value,'org_unit','org_unit_id',offices.get('91'),{department_id:'92'},taskCode('OFFICE_SCOPE_MISMATCH'),403);
          }
        });
        await check('real concurrent identical dispatch retains one receipt and one pending task',async()=>{
          const b=entries[0][1](),otherTrace=[];let pending,otherConnectionId,waitEvidence;
          const other=makeDataMapDefinitionRepository({getConnection:async()=>{const db=await pool.getConnection(),w={};otherConnectionId=db.threadId;for(const m of ['execute','query'])w[m]=async(sql,params)=>{otherTrace.push({method:m,sql,params,connectionId:db.threadId});return db[m](sql,params);};for(const m of ['beginTransaction','commit','rollback'])w[m]=()=>db[m]();w.release=()=>db.release();return w;}});
          beforeCommit=async()=>{pending=other.dispatchAnalysisIssueTask(session(7),b).then(result=>({result}),error=>({error}));for(let i=0;!otherConnectionId&&i<200;i++)await sleep(10);assert(otherConnectionId);waitEvidence=await waitLock(otherConnectionId);assert(waitEvidence.every(e=>e.object_name==='process_governance_issues'&&e.blocking_connection_id===pinned.threadId));};
          try{const first=await write('concurrent-first',session(7),b);beforeCommit=null;const second=await pending;assert(!second.error);assert.deepEqual(second.result,first);const stored=await physical();assert.equal(stored.data_map_analysis_issue_tasks.filter(t=>t.issue_id===b.issue_id).length,1);assert.equal(stored.data_map_definition_requests.filter(r=>r.request_id===b.request_id).length,1);assert.deepEqual(await write('concurrent-third-replay',session(7),b),first);assert.deepEqual(await physical(),stored);save('concurrent-idempotency.json',{first,second:second.result,waitEvidence,otherTrace,pinnedConnectionId:pinned.threadId,otherConnectionId});}
          finally{beforeCommit=null;if(pending)await pending;await reset();}
        });
        await check('every actual INSERT UPDATE and receipt mutation failure fully rolls back task event assignment and issue revision',async()=>{
          for(const [purpose,args]of entries){await write('write-probe-'+purpose,session(7),args());const writes=operations.at(-1).trace.filter(q=>/^(INSERT|UPDATE)\b/i.test(q.sql||'')).map(q=>q.sql);await reset();
            for(const [index,sql]of writes.entries()){fault=q=>q===sql;try{await negative('fault-'+purpose+'-'+index,args(),'B02_INJECTED_WRITE_FAILURE',null);}finally{fault=null;}await reset();}
          }
        });
        await check('original SQL params issue-first identity office department locks and complete transaction order compare to dispatched snapshot',async()=>{
          const [[clock]]=await pinned.execute('SELECT UNIX_TIMESTAMP() stamp');await pinned.execute('SET timestamp=?',[clock.stamp]);
          const normalize=trace=>trace.map(q=>q.sql?{...q,sql:q.sql.replace('SELECT CAST(todo_id AS CHAR) todo_id,round_no','SELECT todo_id,round_no').replace('SELECT status FROM mdm_todos WHERE id=CAST(? AS SIGNED) FOR UPDATE','SELECT status FROM mdm_todos WHERE id=? FOR UPDATE')}:q);
          for(const [purpose,args]of entries){const b=args(),old=await write('baseline-order-'+purpose,session(7),b,oldRepo),traceBefore=operations.at(-1).trace;await reset();
            beforeCommit=async(db,op)=>{const [locks]=await pool.execute('SELECT l.OBJECT_NAME,l.LOCK_MODE,l.LOCK_TYPE,l.LOCK_STATUS FROM performance_schema.data_locks l JOIN performance_schema.threads t ON t.THREAD_ID=l.THREAD_ID WHERE t.PROCESSLIST_ID=? AND l.OBJECT_SCHEMA=DATABASE()',[db.threadId]);for(const t of ['process_governance_issues','user_accounts','person','person_roles','roles','role_permissions','org_unit','departments','data_map_v7_sources','data_map_analysis_runs','data_map_analysis_findings','data_map_definition_requests'])assert(locks.some(l=>l.OBJECT_NAME===t&&l.LOCK_TYPE==='RECORD'&&l.LOCK_STATUS==='GRANTED'),t+' held');op.heldLocks=locks;};
            try{assert.deepEqual(await write('current-order-'+purpose,session(7),b),old);}finally{beforeCommit=null;}
            const trace=operations.at(-1).trace;assert.deepEqual(normalize(trace),normalize(traceBefore));const issueLock=trace.findIndex(q=>q.sql==='SELECT issue_id FROM process_governance_issues WHERE issue_id=? FOR UPDATE'),actorLock=trace.findIndex(q=>q.sql?.includes('FROM user_accounts WHERE account_id=? FOR UPDATE')),officeLock=trace.findIndex(q=>q.sql?.includes("o.status='active' AND d.status='active' FOR UPDATE"));assert(issueLock>=0&&issueLock<actorLock&&actorLock<officeLock);await reset();
          }
          await pinned.execute('SET timestamp=0');save('sql-order-equivalence.json',{timestamp:clock.stamp,onlyPermittedDifference:'exact previous todo_id text projection',paramsAndOrderOtherwiseEqual:true});
        });
        await check('immutable V8 and supported V7 v1 v2 v3 task review manifest finding evidence fixed body digests',async()=>{
          const rules=require('../server/v7AnalysisRules');for(const source of sources)for(const version of source.format==='v8'?[rules.VERSION]:[rules.LEGACY_VERSION,rules.PREVIOUS_VERSION,rules.VERSION]){
            const f=await issueFixture(7,source,{rule_version:version,parser_versions:{[rules.PARSER]:version},steps:[{step_key:'read',input_keys:['source'],check_ids:['references'],parser_key:rules.PARSER}]}),view=await tasks(f.issueId),result=await write('format-dispatch',session(7),body(f,view)),current=await tasks(f.issueId);assert.deepEqual(await tasks(f.issueId,7,oldRepo),current);const review=current.items[0].snapshot.sources[0].review;assert.equal(review.manifest_digest,f.run.manifest_digest);assert.equal(review.finding_digest,digest(f.f));assert.deepEqual(review.evidence,[f.e]);assert.deepEqual(review.fixed_inputs,f.run.manifest.inputs);assert.deepEqual((await physical()).data_map_v7_sources,base.data_map_v7_sources);save('format-'+source.format+'-'+version+'.json',{result,run:f.run,tasks:current,fixedBodiesUntouched:true});await reset();
          }
        });
        await check('source definition mapping handoff template current references reject dispatch after true waits while retaining fixed snapshots',async()=>{
          const obj=await call('reference-object','saveDefinition',[session(11),{request_id:uuid(),entity_type:'object',department_id:'92',definition:{name:'synthetic object',business_meaning:'synthetic only'}}]);
          const document=structuredClone(sources[0].document);document.process.process_ref='process_synthetic_refs';document.process.process_name='synthetic references';
          document.behaviors=[{behavior_ref:'behavior_prepare',node_type:'action',behavior_name:'synthetic prepare',behavior_description:'synthetic',current_actor_role:'synthetic 91',actor_assignment_mode:'fixed_department',actor_department_data_ref:null,actor_position_rule:'',trigger:'synthetic',precondition:'',input_description:'synthetic',timing:null,completion_standard:'synthetic',output_description:'synthetic',countersign_all_required:false,countersign_target_departments:[]}];
          document.data_objects=[{data_ref:'data_a',data_name:'synthetic object',description:'synthetic',information_type:'business_conclusion',fields:[],behavior_links:[],source_relations:[],lifecycle:{applicability:'pending_confirmation',entry_state:{business_validity:'pending_confirmation',custody:'pending_confirmation',identifiability_applicability:'pending_confirmation',identifiability:'pending_confirmation'},routes:[],analysis:{analyzer_version:'',source_fingerprint:'',status:'not_analyzed'},decision_reason:'',decision_notes:''}}];
          const source=await call('reference-upload','registerV7Source',[session(7),{request_id:uuid(),source_kind:'uploaded_material',original_name:'synthetic-refs.json'},Buffer.from(JSON.stringify(document))]);assert.equal(source.validation_status,'valid');
          const meta=await call('reference-source','getV7Source',[session(7),source.source_id]),mappingBody={request_id:uuid(),source_digest:meta.content_digest,local_object_ref:'data_a',local_field_ref:null,object_version_id:obj.version_id,field_version_id:null,expected_revision:0,status:'candidate',basis:'synthetic explicit comparison'};
          const mapping=await call('reference-mapping','saveV7Mapping',[session(7),source.source_id,mappingBody]);
          const hd={title:'synthetic handoff',claim_status:'material_declared',source:{mapping_version_id:mapping.mapping_version_id,behavior_ref:'behavior_prepare',operations:['deliver']},target:null,identifier_kind:'unknown',identity_rule:null,identity_basis:null,delivery_condition:'synthetic',reception_requirement:null,evidence:[{side:'source',locator:'synthetic source',note:'synthetic'}],pairs:[]};
          const handoff=await call('reference-handoff','saveDesignHandoff',[session(7),{request_id:uuid(),handoff_id:null,expected_revision:0,definition:hd}]);
          const bytes=await require('./test-word-evidence').fixture(),df=await fixture(7,sources[0],{inputs:[{input_key:'source',kind:'definition',ref_id:obj.version_id}]}),parsed=require('../server/wordEvidenceParser').extract(bytes,'synthetic.docx');
          const value={...parsed,document:{...parsed.document,links:[{anchor_id:'a1',kind:'definition',ref_id:obj.version_id,basis:'synthetic',fixed_reference:df.run.manifest.inputs[0].snapshot}]}};value.content_digest=digest(value.document);
          const word=await call('reference-template-fixture','registerSource',[session(11),{request_id:uuid(),department_id:'92',parser_version:value.parser_version,template_profile_version:digest(value.document.links),original_name:'synthetic.docx'},bytes]);await pool.execute('INSERT INTO data_map_word_evidence(batch_id,snapshot_json,snapshot_digest) VALUES (?,?,?)',[word.batch_id,json(value),digest(value)]);
          const versionRow=(await physical()).data_map_definition_versions.find(r=>r.version_id===obj.version_id),nextVersion={...versionRow,version_no:2,supersedes_version_id:obj.version_id,definition_json:json(parse(versionRow.definition_json)),base_snapshot_json:json(parse(versionRow.base_snapshot_json))};delete nextVersion.version_id;
          await pool.query('INSERT INTO data_map_definition_versions SET ?',nextVersion);const successor=(await pool.execute('SELECT CAST(version_id AS CHAR) id FROM data_map_definition_versions WHERE entity_type=? AND entity_id=? AND version_no=2',[versionRow.entity_type,obj.entity_id]))[0][0].id;
          const refs=[['v7_source',source.source_id],['definition',obj.version_id],['mapping',mapping.mapping_version_id],['handoff',handoff.handoff_version_id],['template',word.batch_id]],fixed=[];
          for(const [kind,ref]of refs){const f=await issueFixture(7,sources[0],{inputs:[{input_key:'source',kind,ref_id:ref}]}),view=await tasks(f.issueId),b=body(f,view),local=backup(),physicalBefore=await physical();
            const result=await write('reference-positive-'+kind,session(7),b),current=await tasks(f.issueId);assert.deepEqual(current.items[0].snapshot.sources[0].review.fixed_inputs,f.run.manifest.inputs);assert.deepEqual(await tasks(f.issueId,7,oldRepo),current);restore(local);assert.deepEqual(await physical(),physicalBefore);
            const blocker=await pool.getConnection();let pending;
            const [table,key,idValue]=kind==='v7_source'?['data_map_v7_sources','source_id',ref]:kind==='mapping'?['data_map_v7_mappings','mapping_id',mapping.mapping_id]:kind==='handoff'?['data_map_design_handoffs','handoff_id',handoff.handoff_id]:['data_map_definition_heads','entity_id',obj.entity_id];
            try{await blocker.beginTransaction();await blocker.execute('SELECT `'+key+'` FROM `'+table+'` WHERE `'+key+'`=? FOR UPDATE',[idValue]);pending=write('reference-wait-'+kind,session(7),b).then(result=>({result}),error=>({error}));const evidence=await waitLock(pinned.threadId);assert(evidence.every(e=>e.connection_id===pinned.threadId&&e.blocking_connection_id===blocker.threadId));
              if(kind==='v7_source')await change(blocker,table,key,idValue,{content_digest:'0'.repeat(64)});else if(kind==='definition'||kind==='template')await change(blocker,table,key,idValue,{current_version_id:successor,revision_no:2});else await change(blocker,table,key,idValue,{revision_no:2});
              const external=await blocker.query('SELECT *'+(casts.get(table)?','+casts.get(table):'')+' FROM `'+table+'` WHERE `'+key+'`=?',[idValue]);await blocker.commit();const outcome=await pending,code=kind==='v7_source'?'DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT':'DEFINITION_ANALYSIS_ISSUE_SOURCE_SUPERSEDED';assert.equal(outcome.error?.code,code);assert.equal(outcome.error?.statusCode,409);
              const expected=structuredClone(physicalBefore),index=expected[table].findIndex(r=>String(r[key])===String(idValue));expected[table][index]=external[0][0];assert.deepEqual(await physical(),expected);waits.push({label:'fixed-'+kind,evidence,error:errorValue(outcome.error),positiveBeforeInvalidation:true,physicalRollback:true});
            }finally{await blocker.rollback().catch(()=>{});blocker.release();if(pending)await pending;restore(local);assert.deepEqual(await physical(),physicalBefore);}
            assert.deepEqual(await tasks(f.issueId),view);fixed.push({kind,ref,f,result,current,restored:true});
          }save('fixed-references.json',fixed);await reset();
        });
        await check('historical JSON nonJSON events task integrity and own complete dump restore equality',async()=>{
          const todoId=precision[0].records[0].result.todo_id;
          for(const note of ['legacy plain text',json({record_id:'9007199254741993',unknown:null})])await pool.execute("INSERT INTO mdm_todo_events(todo_id,event_type,actor_user_id,actor_person_id,note) VALUES (?,'commented',?,?,?)",[todoId,N,N,note]);
          for(const note of ['legacy plain text',json({record_id:'9007199254741993',unknown:null})])await pool.execute("INSERT INTO process_governance_issue_events(issue_id,event_type,actor_person_id,note,payload_json) VALUES (?,'commented',?,?,?)",[targetIssue,N,note,null]);
          const before=await physical(),snapshot=backup(),view=await tasks(targetIssue);assert.deepEqual(await tasks(targetIssue,7,oldRepo),view);assert.deepEqual(await physical(),before);
          await change(pool,'data_map_analysis_issue_tasks','todo_id',todoId,{snapshot_digest:'0'.repeat(64)});await reject('tampered-task','getAnalysisIssueTasks',[session(7),targetIssue],taskCode('INTEGRITY_CONFLICT'));restore(snapshot);assert.deepEqual(await physical(),before);assert.deepEqual(await tasks(targetIssue),view);save('history-restore.json',{dumpSha256:sha(snapshot),fullPhysicalEqual:true,legacyJSONAndNonJSONPreserved:true});await reset();
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
  save('validation.json', { passed: true, fullWriteChainPassed: true, consumerIdentityPrecisionPassed: true, checks, operationCount: operations.length, negativeCount: negatives.length, lockWaitCount: waits.length, httpStarted: false, workerStarted: false, businessAcceptance: false }); console.log('B02_ANALYSIS_ISSUE_TASK_IDENTITY_PASSED');
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
