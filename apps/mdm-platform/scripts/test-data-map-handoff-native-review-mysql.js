// Native work-package completion and pending handoff binding share one caller
// transaction. All fixture writes use a new owner-labelled stage62 tmpfs MySQL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { seed } = require('./testHelpers/dataMapHandoffFixture');
const { makeProcessDataGovernanceRepository } = require('../server/processDataGovernanceRepository');
const { digest } = require('../server/dataMapHandoffPolicy');
const output = path.resolve(process.argv[2] || path.join(__dirname, '../../../artifacts/mdm-data-governance-handoff-implementation-20261020-01/native-review-' + crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep)); assert(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const checks = [], injections = []; let owned, passed = false, failure;
const oldEnv = Object.fromEntries(['DATA_MAP_HANDOFF_ENABLED', 'PROCESS_DATA_GOVERNANCE_READ_ONLY'].map(name => [name, process.env[name]]));
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
async function main() {
  process.env.DATA_MAP_HANDOFF_ENABLED = '0'; process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY = '0';
  try {
    await withFreshMysql(async target => {
      const { pool, owner, database, port, containerId } = target;
      owned = { owner, database, port, containerId, storage: 'owner-labelled tmpfs', canonicalFixture: 'dataMapHandoffFixture.seed' };
      const { session, packageSeed } = await seed(target);
      const source = await packageSeed(601, { status: 'mdm_review' });
      // A real large sequence proves the new binding/event does not round IDs.
      await pool.execute('ALTER TABLE process_data_governance_reviews AUTO_INCREMENT=9007199254740993');
      const read = async (sql, args = []) => (await pool.execute(sql, args))[0];
      async function physical() {
        const result = {};
        result.package = await read('SELECT CAST(id AS CHAR) id,status,revision_no,CAST(completed_at AS CHAR) completed_at,CAST(updated_by_person_id AS CHAR) updated_by_person_id,source_content_hash FROM process_data_governance_work_packages WHERE id=601');
        result.details = await read('SELECT CAST(id AS CHAR) id,detail_ref,status,revision_no,governance_json,candidate_json FROM process_data_governance_details WHERE work_package_id=601 ORDER BY id');
        result.reviews = await read('SELECT CAST(id AS CHAR) id,CAST(work_package_id AS CHAR) package_id,review_type,decision,basis_text,package_revision_no FROM process_data_governance_reviews WHERE work_package_id=601 ORDER BY id');
        result.events = await read('SELECT CAST(id AS CHAR) id,event_type,payload_json FROM process_data_governance_events WHERE work_package_id=601 ORDER BY id');
        result.detail_versions = await read('SELECT detail_version_id,CAST(detail_id AS CHAR) detail_id,revision_no,snapshot_json,snapshot_digest FROM process_data_governance_detail_versions WHERE detail_id=601 ORDER BY revision_no');
        result.bindings = await read('SELECT binding_id,CAST(package_id AS CHAR) package_id,binding_kind,CAST(native_review_id AS CHAR) native_review_id,snapshot_json,binding_digest,request_id FROM process_data_governance_review_bindings WHERE package_id=601 ORDER BY binding_id');
        result.heads = await read('SELECT CAST(package_id AS CHAR) package_id,binding_id,head_revision FROM data_map_handoff_binding_heads WHERE package_id=601');
        result.tasks = await read('SELECT task_id,CAST(package_id AS CHAR) package_id,binding_id,system_request_id,state,attempt,last_error FROM data_map_handoff_generation_tasks WHERE package_id=601 ORDER BY task_id');
        result.control = await read('SELECT CAST(graph_revision AS CHAR) graph_revision,CAST(next_definition_version_id AS CHAR) next_definition_version_id FROM data_map_governance_control WHERE control_id=1');
        result.source = await read('SELECT CAST(id AS CHAR) id,schema_version,process_content_json,content_hash,status FROM process_design_versions WHERE id=601');
        result.map = {};
        for (const table of ['data_map_publications', 'data_map_publication_items', 'data_map_effective_heads', 'data_map_handoff_drafts', 'data_map_handoff_approvals']) result.map[table] = String((await read('SELECT COUNT(*) n FROM ' + table))[0].n);
        result.legacy_definition_heads = await read('SELECT entity_type,CAST(entity_id AS CHAR) entity_id,CAST(current_version_id AS CHAR) current_version_id,revision_no FROM data_map_definition_heads ORDER BY entity_type,entity_id');
        return result;
      }
      const before = await physical(); save('before.json', before);
      for (const [name, marker] of [['binding', 'INSERT INTO process_data_governance_review_bindings'], ['task', 'INSERT INTO data_map_handoff_generation_tasks'], ['head', 'INSERT INTO data_map_handoff_binding_heads']]) {
        await check(name + ' failure rolls original review/package, append-only snapshots, pending task and binding head back together', async () => {
          const trace = [], committed = [], rolledBack = []; let leases = 0;
          const requestId = crypto.randomUUID();
          const injectingPool = { async getConnection() {
            const connection = await pool.getConnection();
            const lease = ++leases;
            return new Proxy(connection, { get(db, property) {
              if (property === 'execute') return async (sql, args) => { trace.push({ sql, lease, connection_id: db.connection.threadId }); if (sql.includes(marker)) throw Object.assign(new Error('synthetic native ' + name + ' insert failure'), { code: 'NATIVE_REVIEW_' + name.toUpperCase() + '_FAILURE' }); return db.execute(sql, args); };
              if (property === 'commit') return async () => { committed.push(lease); return db.commit(); };
              if (property === 'rollback') return async () => { rolledBack.push(lease); return db.rollback(); };
              return typeof db[property] === 'function' ? db[property].bind(db) : db[property];
            } });
          } };
          await assert.rejects(makeProcessDataGovernanceRepository(injectingPool).completeWorkPackage('601', 1, 'synthetic native review basis', session(11), { request_id: requestId }), { code: 'NATIVE_REVIEW_' + name.toUpperCase() + '_FAILURE' });
          assert.deepEqual(committed, [1]); assert(rolledBack.includes(2));
          const protectedWrites = trace.filter(row => /INSERT INTO process_data_governance_reviews|UPDATE process_data_governance_work_packages|INSERT INTO process_data_governance_detail_versions|INSERT INTO process_data_governance_review_bindings|INSERT INTO data_map_handoff_generation_tasks|INSERT INTO data_map_handoff_binding_heads/.test(row.sql));
          assert.deepEqual([...new Set(protectedWrites.map(row => row.lease))], [2]);
          assert.equal((await read('SELECT state FROM data_map_handoff_requests WHERE request_id=?', [requestId]))[0].state, 'prepared');
          const after = await physical(); assert.deepEqual(after, before);
          injections.push({ name, request_id: requestId, prepared_receipt_retained: true, business_rolled_back: true, rolledBack, committed, trace, unchanged_digest: digest(after) }); save('failure-injections.json', injections);
        });
      }
      const repo = makeProcessDataGovernanceRepository(pool); let completed;
      const completedRequestId = crypto.randomUUID();
      await check('successful original completion commits exact review, native binding, head and fixed pending UUID task while new feature is off', async () => {
        completed = await repo.completeWorkPackage('601', 1, 'synthetic native review basis', session(11), { request_id: completedRequestId });
        const after = await physical(); save('after-native-review.json', after); save('completion-response.json', completed);
        assert.equal(after.package[0].status, 'completed'); assert.equal(after.package[0].revision_no, 2);
        assert.equal(after.reviews.length, 1); assert.equal(after.bindings.length, 1); assert.equal(after.heads.length, 1); assert.equal(after.tasks.length, 1); assert.equal(after.detail_versions.length, 1);
        const review = after.reviews[0], binding = after.bindings[0], task = after.tasks[0];
        assert.equal(binding.request_id, completedRequestId); assert.equal(completed.request_id, completedRequestId); assert.notEqual(task.system_request_id, completedRequestId);
        assert.equal((await read('SELECT state FROM data_map_handoff_requests WHERE request_id=?', [completedRequestId]))[0].state, 'committed');
        assert(BigInt(review.id) > BigInt(Number.MAX_SAFE_INTEGER)); assert.equal(binding.native_review_id, review.id);
        assert.equal(binding.binding_kind, 'native_review'); assert.equal(after.heads[0].binding_id, binding.binding_id); assert.equal(task.binding_id, binding.binding_id);
        for (const value of [binding.binding_id, binding.request_id, task.task_id, task.system_request_id]) assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        assert.equal(task.state, 'pending'); assert.equal(task.attempt, 0); assert.equal(task.last_error, null);
        assert.equal(binding.snapshot_json.native_review.id, review.id); assert.equal(binding.snapshot_json.package_revision, 2); assert.equal(binding.snapshot_json.source_hash, source.hash);
        assert.equal(digest(binding.snapshot_json), binding.binding_digest); assert.equal(binding.snapshot_json.source_schema_version, 'process-governance-v8');
        assert.equal(completed.handoff.task_id, task.task_id); assert.equal(completed.handoff.system_request_id, task.system_request_id);
        assert.equal(completed.handoff.generation_state, 'pending'); assert.equal(completed.handoff.automatically_published, false);
        assert.equal(completed.review.id, review.id);
        const event = after.events.find(row => row.event_type === 'mdm_workgroup_review_approved'); assert.equal(event.payload_json.review_id, review.id);
        for (const count of Object.values(after.map)) assert.equal(count, '0');
        assert.deepEqual(after.source, before.source); assert.deepEqual(after.legacy_definition_heads, before.legacy_definition_heads);
        assert.equal(process.env.DATA_MAP_HANDOFF_ENABLED, '0'); assert.equal(BigInt(after.control[0].graph_revision), BigInt(before.control[0].graph_revision) + 1n);
      });
      await check('repeated completion cannot rewrite historical review or replace the original task UUID', async () => {
        const recorded = await physical();
        assert.deepEqual(await repo.completeWorkPackage('601', 1, 'synthetic native review basis', session(11), { request_id: completedRequestId }), completed);
        await assert.rejects(repo.completeWorkPackage('601', 1, 'changed payload must fail', session(11), { request_id: completedRequestId }), { code: 'HANDOFF_REQUEST_PAYLOAD_CONFLICT' });
        await assert.rejects(repo.completeWorkPackage('601', 1, 'duplicate completion must fail', session(11), { request_id: crypto.randomUUID() }), { code: 'PROCESS_DATA_GOVERNANCE_REVISION_CONFLICT' });
        await assert.rejects(repo.completeWorkPackage('601', 2, 'duplicate completion must fail', session(11), { request_id: crypto.randomUUID() }), { code: 'PROCESS_DATA_GOVERNANCE_PACKAGE_READ_ONLY' });
        assert.deepEqual(await physical(), recorded);
      });
      await check('a missing original request UUID explicitly rejects the old client without registering or changing any business content', async () => {
        const recorded = await physical(), count = (await read('SELECT COUNT(*) n FROM data_map_handoff_requests'))[0].n;
        await assert.rejects(repo.completeWorkPackage('601', 2, 'missing UUID must preserve input', session(11)), { code: 'PROCESS_DATA_GOVERNANCE_REQUEST_ID_REQUIRED', statusCode: 422 });
        assert.equal((await read('SELECT COUNT(*) n FROM data_map_handoff_requests'))[0].n, count); assert.deepEqual(await physical(), recorded);
      });
      await check('native review reply loss after actual commit uses the same global receipt UUID and preserves the original binding and generation task', async () => {
        await packageSeed(603, { status: 'mdm_review' });
        const requestId = crypto.randomUUID(); let injected = false, businessRollbacks = 0;
        const losingPool = { async getConnection() { const db = await pool.getConnection(); let business = false; return new Proxy(db, { get(connection, key) {
          if (key === 'execute') return async (sql, args) => { if (sql.includes("SET state='committed',result_json")) business = true; return connection.execute(sql, args); };
          if (key === 'commit') return async () => { await connection.commit(); if (business && !injected) { injected = true; throw Object.assign(new Error('synthetic native review commit reply lost'), { code: 'NATIVE_REVIEW_COMMIT_REPLY_LOST' }); } };
          if (key === 'rollback') return async () => { if (business) businessRollbacks++; return connection.rollback(); };
          return typeof connection[key] === 'function' ? connection[key].bind(connection) : connection[key];
        } }); } };
        await assert.rejects(makeProcessDataGovernanceRepository(losingPool).completeWorkPackage('603', 1, 'synthetic lost native reply', session(11), { request_id: requestId }), { code: 'HANDOFF_COMMIT_UNKNOWN' });
        assert.equal(businessRollbacks, 0);
        const result = await repo.completeWorkPackage('603', 1, 'synthetic lost native reply', session(11), { request_id: requestId });
        const [bound] = await read('SELECT binding_id,request_id FROM process_data_governance_review_bindings WHERE package_id=603');
        const tasks = await read('SELECT task_id,binding_id,state,system_request_id FROM data_map_handoff_generation_tasks WHERE package_id=603');
        assert.equal(result.request_id, requestId); assert.equal(bound.request_id, requestId); assert.equal(tasks.length, 1); assert.equal(tasks[0].binding_id, bound.binding_id); assert.equal(tasks[0].task_id, result.handoff.task_id); assert.equal(tasks[0].state, 'pending');
        assert.equal((await read('SELECT state FROM data_map_handoff_requests WHERE request_id=?', [requestId]))[0].state, 'committed');
        assert.equal((await read('SELECT COUNT(*) n FROM process_data_governance_reviews WHERE work_package_id=603'))[0].n, 1);
        save('native-commit-reply-loss.json', { request_id: requestId, businessRollbacks, result, bound, tasks });
      });
      await check('a prepared global receipt with a persisted native binding cannot repeat or wash the original review', async () => {
        const recorded = await physical();
        await pool.execute("UPDATE data_map_handoff_requests SET state='prepared',result_json=NULL,finished_at=NULL WHERE request_id=?", [completedRequestId]);
        await assert.rejects(repo.completeWorkPackage('601', 1, 'synthetic native review basis', session(11), { request_id: completedRequestId }), { code: 'HANDOFF_RECEIPT_INCONSISTENT' });
        assert.deepEqual(await physical(), recorded);
        await pool.execute("UPDATE data_map_handoff_requests SET state='committed',result_json=?,finished_at=UTC_TIMESTAMP(3) WHERE request_id=?", [JSON.stringify(completed), completedRequestId]);
      });
      await check('an actual NOT ENFORCED CHECK rejects native business writes and restoring it does not rewrite a rejected receipt', async () => {
        await packageSeed(604, { status: 'mdm_review' });
        const requestId = crypto.randomUUID();
        await pool.execute('ALTER TABLE data_map_handoff_generation_tasks ALTER CHECK chk_handoff_generation_state NOT ENFORCED');
        try {
          await assert.rejects(repo.completeWorkPackage('604', 1, 'synthetic schema-gated native review', session(11), { request_id: requestId }), { code: 'HANDOFF_SCHEMA_UNAVAILABLE' });
          const [pkg] = await read('SELECT status,revision_no FROM process_data_governance_work_packages WHERE id=604'); assert.equal(pkg.status, 'mdm_review'); assert.equal(pkg.revision_no, 1);
          for (const table of ['process_data_governance_reviews', 'process_data_governance_review_bindings', 'data_map_handoff_generation_tasks']) {
            const column = table === 'process_data_governance_reviews' ? 'work_package_id' : 'package_id'; assert.equal(Number((await read('SELECT COUNT(*) n FROM ' + table + ' WHERE ' + column + '=604'))[0].n), 0);
          }
          assert.equal((await read('SELECT state FROM data_map_handoff_requests WHERE request_id=?', [requestId]))[0].state, 'rejected');
        } finally { await pool.execute('ALTER TABLE data_map_handoff_generation_tasks ALTER CHECK chk_handoff_generation_state ENFORCED'); }
        await assert.rejects(repo.completeWorkPackage('604', 1, 'synthetic schema-gated native review', session(11), { request_id: requestId }), { code: 'HANDOFF_SCHEMA_UNAVAILABLE' });
        const accepted = await repo.completeWorkPackage('604', 1, 'synthetic schema-gated native review', session(11), { request_id: crypto.randomUUID() });
        assert.equal(accepted.handoff.generation_state, 'pending'); assert.notEqual(accepted.request_id, requestId);
        save('native-schema-check-gate.json', { rejectedRequestId: requestId, rejectedStateRetained: true, acceptedNewRequestId: accepted.request_id, noBusinessEffectsWhileConstraintDisabled: true });
      });
      await check('actual canonical v4 core roles complete a new native V8 review with exact binding and pending task without a runtime model migration', async () => {
        const baseline = require('../server/accessModelV4Baseline');
        const v5History = await physical();
        // Only this owned synthetic fixture is set to the frozen v4 contract.
        // The implementation under test has no role/model mutation path.
        await pool.execute("UPDATE roles SET status='retired' WHERE role_code='hr_directory_manager'");
        for (const role of baseline.ROLE_GUIDES) {
          await pool.execute("UPDATE roles SET model_version=?,status='active',role_name=?,description=? WHERE role_code=?", [baseline.ACCESS_MODEL_VERSION, role.name, role.description || null, role.code]);
          await pool.execute('DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id=rp.role_id WHERE r.role_code=?', [role.code]);
          for (const permission of role.permissions) {
            await pool.execute('INSERT IGNORE INTO permissions(perm_code,resource,action,default_scope) VALUES(?,?,?,?)', [permission.code, permission.resource, permission.action, permission.defaultScope || 'department']);
            await pool.execute("INSERT INTO role_permissions(role_id,perm_id,effect) SELECT r.role_id,p.perm_id,'allow' FROM roles r JOIN permissions p ON p.perm_code=? WHERE r.role_code=?", [permission.code, role.code]);
          }
        }
        const models = await read("SELECT DISTINCT model_version FROM roles WHERE status='active' ORDER BY model_version");
        assert.deepEqual(models.map(row => row.model_version), [baseline.ACCESS_MODEL_VERSION]);
        const canonical = await read("SELECT r.role_code,r.model_version,p.perm_code,rp.effect FROM roles r JOIN role_permissions rp ON rp.role_id=r.role_id JOIN permissions p ON p.perm_id=rp.perm_id WHERE r.status='active' ORDER BY r.role_code,p.perm_code");
        for (const role of baseline.ROLE_GUIDES) {
          const permissions = canonical.filter(row => row.role_code === role.code);
          assert.deepEqual(permissions.map(row => row.perm_code).sort(), role.permissions.map(permission => permission.code).sort());
          assert(permissions.every(row => row.effect === 'allow'));
        }
        const v4Source = await packageSeed(602, { status: 'mdm_review' });
        const result = await repo.completeWorkPackage('602', 1, 'synthetic actual v4 native review', session(11), { request_id: crypto.randomUUID() });
        const [review] = await read('SELECT CAST(id AS CHAR) id,package_revision_no FROM process_data_governance_reviews WHERE work_package_id=602');
        const [binding] = await read('SELECT binding_id,CAST(native_review_id AS CHAR) native_review_id,binding_kind,snapshot_json,binding_digest FROM process_data_governance_review_bindings WHERE package_id=602');
        const [head] = await read('SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=602');
        const [task] = await read('SELECT task_id,binding_id,system_request_id,state FROM data_map_handoff_generation_tasks WHERE package_id=602');
        const [detail] = await read('SELECT actor_json FROM process_data_governance_detail_versions WHERE detail_id=602');
        assert.equal(result.review.id, review.id); assert.equal(review.package_revision_no, 2);
        assert.equal(binding.native_review_id, review.id); assert.equal(binding.binding_kind, 'native_review'); assert.equal(binding.snapshot_json.source_hash, v4Source.hash);
        assert.equal(digest(binding.snapshot_json), binding.binding_digest); assert.equal(head.binding_id, binding.binding_id); assert.equal(task.binding_id, binding.binding_id);
        assert.equal(task.state, 'pending'); assert.equal(result.handoff.task_id, task.task_id); assert.equal(result.handoff.system_request_id, task.system_request_id);
        assert.equal(detail.actor_json.qualification.model_version, baseline.ACCESS_MODEL_VERSION);
        assert.deepEqual((await physical()).reviews, v5History.reviews); assert.deepEqual((await physical()).bindings, v5History.bindings); assert.deepEqual((await physical()).tasks, v5History.tasks);
        for (const table of ['data_map_handoff_drafts', 'data_map_handoff_approvals', 'data_map_publications', 'data_map_effective_heads']) assert.equal(String((await read('SELECT COUNT(*) n FROM ' + table))[0].n), '0');
        save('actual-v4-native-review.json', { canonical, activeModels: models, result, review, binding, head, task, detail });
      });
      await check('new native receipt and binding preserve BIGINT package/source identities as exact strings', async () => {
        const large='9007199254741099';await packageSeed(large,{status:'mdm_review'});
        const result=await repo.completeWorkPackage(large,1,'synthetic exact large source',session(11),{request_id:crypto.randomUUID()});
        assert.equal(result.package.id,large);assert.equal(result.package.process_version_id,large);assert.equal(result.package.source_document_id,large);assert.equal(result.review.work_package_id,large);assert.equal(result.review.actor_person_id,'11');
        const [bound]=await read('SELECT CAST(package_id AS CHAR) package_id,snapshot_json FROM process_data_governance_review_bindings WHERE package_id=?',[large]);assert.equal(bound.package_id,large);assert.equal(bound.snapshot_json.process_version_id,large);
      });
    }, { stage: '62', randomDatabase: true });
    owned.cleaned = true; passed = true;
  } catch (error) { failure = { code: error.code, message: error.message, stack: error.stack }; throw error; }
  finally {
    for (const [key, value] of Object.entries(oldEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    save('results.json', { passed, checks, owned, failure, formalDatabaseAccess: false, handoffFeatureEnabled: false, businessAccepted: false });
  }
  console.log('PASS HANDOFF_NATIVE_REVIEW_MYSQL ' + checks.length + ' checks; evidence ' + output);
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { main };
