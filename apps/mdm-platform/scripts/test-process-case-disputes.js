// Real HTTP/session checks against an owned temporary MySQL; synthetic data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const outputAt = process.argv.indexOf('--output');
assert.ok(outputAt > 0, '--output required');
const output = path.resolve(process.argv[outputAt + 1]);
assert.ok(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output), 'evidence directory must be new');
fs.mkdirSync(output, { recursive: true });
function syntheticSource() {
  return { schema_version: 'process-governance-v8',
    export_meta: { package_ref: 'package_dispute', exported_at: '2026-10-19T00:00:00.000Z', initiating_department: '合成甲部', compiler: '合成编制人员' },
    process: { process_ref: 'process_dispute', process_name: '', owning_department: '', purpose: '', scope: '', capability_domain: null, business_capability: null, classification_status: 'unclassified' },
    behaviors: [], flow_relations: [], data_objects: [], forms: [], terms: [],
    migration: { source_schema_version: 'process-governance-v8', source_process_ref: null, source_process_count: 1,
      legacy_cross_department_records: [], reference_materials: [], internal_process_calls: [], work_roles: [], unresolved_actor_roles: [], unresolved_join_modes: [] } };
}
const root = '/api/process-v7-preview', dispute = '/api/process-case-disputes';
const binding = c => ({expected_revision_no:c.current_revision_no, expected_content_hash:c.current_content_hash});
async function main() {
  await withStage05Fixture(async ({fixture, expect, pool}) => {
    const checks=[];
    for(const [person,role] of [[86,'data_conflict_handler'],[87,'decision_group']]) {
      await pool.execute('INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,\'global\',NULL,\'synthetic dispute test\',CURRENT_DATE FROM roles WHERE role_code=?',[person,role]);
    }
    await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='expired' WHERE pr.person_id=87 AND r.role_code<>'decision_group'");
    const get=id=>expect('lead',root+'/cases/'+id,'GET');
    const state=(id,who='lead')=>expect(who,dispute+'/cases/'+id,'GET');
    const body=(s,action,extra={})=>({action,request_id:crypto.randomUUID(),expected_event_id:s.event_id,
      expected_revision_no:s.source_revision_no,expected_content_hash:s.source_content_hash,basis:'合成办理依据-'+action,
      ...(action==='escalate'?{escalation_materials:{issue_summary:'合成跨部门争议',impact_scope:'合成双方流程接口',coordination_history:'合成已协调仍有分歧',positions:s.related_departments.map(d=>({department_id:d.department_id,position:'合成各方观点',basis:'合成各方事实依据'}))}}:{}),...extra});
    const act=(id,who,data,status=200)=>expect(who,dispute+'/cases/'+id+'/actions','POST',data,status);
    async function create(schema,suffix) {
      const document=structuredClone(fixture.document); document.schema_version=schema;document.process.process_ref='dispute_'+suffix;
      return {document,detail:await expect('contact',root+'/cases','POST',{document,source_file_name:'synthetic.json'},201)};
    }
    async function opinions(id,who,decision,selected) {
      const d=await get(id);
      for(const item of d.items.filter(i=>!selected||selected.includes(i.id))) {
        const latest=await get(id);
        await expect(who,root+'/items/'+item.id+'/decision','POST',{...binding(d.case),expected_dispute_event_id:latest.review_dispute_event_id,decision,basis:'合成部门事实依据'});
      }
    }
    async function revise(id,document) {
      const d=await get(id); return expect('contact',root+'/cases/'+id+'/revisions','POST',{...binding(d.case),document,source_file_name:'synthetic-revision.json'},201);
    }
    for(const schema of ['process-governance-v8','process-governance-v7']) {
      const {document,detail}=await create(schema,schema); const id=detail.case.id;
      await opinions(id,'reviewA','confirmed'); await opinions(id,'reviewB','disputed',[detail.items[0].id]);
      let s=await state(id); assert.equal(s.state,'unassigned');
      await expect('outsider',dispute+'/cases/'+id,'GET',undefined,404);
      await expect('multi',dispute+'/cases/'+id,'GET',undefined,404);
      await expect('outsider',root+'/cases/'+id,'GET',undefined,403);
      await act(id,'admin',body(s,'assign',{coordinator_person_id:'86'}),403);
      await act(id,'contact',body(s,'assign',{coordinator_person_id:'86'}),403);
      await act(id,'lead',body(s,'assign',{coordinator_person_id:'83'}),422);
      const assignedBody=body(s,'assign',{coordinator_person_id:'86'});
      s=await act(id,'lead',assignedBody); assert.equal(s.state,'coordinating');
      assert.equal((await act(id,'lead',assignedBody)).idempotent,true);
      await act(id,'lead',{...assignedBody,basis:'changed request'},409);
      await act(id,'outsider',body({...s,event_id:'0'},'coordinate'),409);
      await expect('outsider',root+'/cases/'+id,'GET');
      assert.ok((await expect('outsider',dispute+'/workbench','GET')).items.some(i=>i.case_id===String(id)));
      checks.push(schema+': exact assignment visibility, invalid/admin/cross-role denial, stale and idempotent requests');
      await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='expired' WHERE pr.person_id=86 AND r.role_code='data_conflict_handler'");
      await act(id,'outsider',body(s,'coordinate'),404);
      await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='active' WHERE pr.person_id=86 AND r.role_code='data_conflict_handler'");
      s=await act(id,'outsider',body(s,'coordinate'));
      await act(id,'outsider',{...body(s,'escalate'),escalation_materials:undefined},422);
      s=await act(id,'outsider',body(s,'escalate')); assert.equal(s.state,'escalated');
      const oldReview=await get(id);
      const oldReviewBody={...binding(oldReview.case),expected_dispute_event_id:oldReview.review_dispute_event_id,decision:'confirmed',basis:'合成协调前旧核对请求'};
      await act(id,'lead',body(s,'decide',{decision:'recheck'}),403);
      s=await act(id,'multi',body(s,'decide',{decision:'recheck'})); assert.equal(s.state,'awaiting_recheck');
      const staleOpinion=await expect('reviewA',root+'/items/'+detail.items[0].id+'/decision','POST',oldReviewBody,409);
      assert.equal(staleOpinion.code,'PROCESS_DISPUTE_RECHECK_CHANGED');
      let d=await get(id); const reopened=d.items.find(i=>String(i.id)===String(detail.items[0].id));
      assert.equal(reopened.origin_status,'pending'); assert.equal(reopened.counterparty_status,'pending');
      assert.ok(s.history.some(h=>h.payload.department_positions.some(p=>p.counterparty_status==='disputed')));
      await expect('lead',root+'/cases/'+id+'/promote','POST',{...binding(d.case),target:{mode:'create',document_no:'DISPUTE-'+schema,document_title:'合成争议核对'}},409);
      await opinions(id,'reviewA','confirmed'); assert.equal((await state(id)).state,'awaiting_recheck');
      await opinions(id,'reviewB','disputed',[detail.items[1].id]);
      s=await state(id); assert.equal(s.state,'coordinating');
      s=await act(id,'outsider',body(s,'request_recheck'));
      assert.equal(s.state,'awaiting_recheck');
      assert.equal(s.history[0].payload.item_keys.length,2);
      await opinions(id,'reviewA','confirmed');
      await opinions(id,'reviewB','confirmed'); s=await state(id); assert.equal(s.state,'resolved');
      assert.equal(s.history[0].payload.action,'department_recheck_completed');
      d=await get(id);
      await expect('lead',root+'/cases/'+id+'/promote','POST',{...binding(d.case),target:{mode:'create',document_no:'DISPUTE-'+schema,document_title:'合成争议核对'}},201);
      checks.push(schema+': current qualification rechecked; existing coordinator/escalation authority; both departments reopen and audit preserved; publication gate');
      document.process.purpose+=' 合成后续修订';
      await revise(id,document); assert.equal((await state(id)).state,'resolved');
      await expect('multi',root+'/cases/'+id,'GET',undefined,403);
      await expect('multi',dispute+'/cases/'+id,'GET',undefined,404);
      await opinions(id,'reviewB','disputed');
      const nextRound=await act(id,'lead',body(await state(id),'assign',{coordinator_person_id:'86'}));
      assert.equal(nextRound.history[0].payload.was_escalated,false);
      await expect('multi',dispute+'/cases/'+id,'GET',undefined,404);
      checks.push(schema+': completed dispute remains closed across later revisions');
    }
    const {document,detail}=await create('process-governance-v8','source_change'); const id=detail.case.id;
    await opinions(id,'reviewB','disputed');
    let s=await act(id,'lead',body(await state(id),'assign',{coordinator_person_id:'86'}));
    s=await act(id,'outsider',body(s,'escalate'));
    document.process.purpose+=' 合成来源更新'; await revise(id,document); s=await state(id); assert.equal(s.state,'source_changed');
    s=await act(id,'lead',body(s,'assign',{coordinator_person_id:'86'})); assert.equal(s.state,'source_changed');
    s=await act(id,'lead',body(s,'rebase')); assert.equal(s.state,'escalated');
    s=await act(id,'multi',body(s,'decide',{decision:'return_for_revision'})); assert.equal(s.state,'awaiting_revision');
    await opinions(id,'reviewA','confirmed');await opinions(id,'reviewB','confirmed');
    let d=await get(id); assert.equal(d.case.status,'review_complete');
    const denied=await expect('lead',root+'/cases/'+id+'/promote','POST',{...binding(d.case),target:{mode:'create',document_no:'DISPUTE-REVISION',document_title:'合成来源变化'}},409);
    assert.equal(denied.code,'PROCESS_DISPUTE_UNRESOLVED');
    document.process.purpose+=' 合成修订完成';await revise(id,document);
    s=await act(id,'lead',body(await state(id),'rebase')); assert.equal(s.state,'coordinating');
    s=await act(id,'outsider',body(s,'request_recheck')); assert.equal(s.state,'awaiting_recheck');
    await opinions(id,'reviewA','confirmed');await opinions(id,'reviewB','confirmed');assert.equal((await state(id)).state,'resolved');
    checks.push('source drift blocks pending decisions; reassignment cannot rebind; rebase preserves escalation; revision decision cannot bypass with review statuses; explicit recheck closes');
    await expect('multi',dispute+'/cases/'+id,'GET');
    await opinions(id,'reviewB','disputed');
    await expect('multi',dispute+'/cases/'+id,'GET',undefined,404);
    await expect('multi',root+'/cases/'+id,'GET',undefined,403);
    await pool.execute("UPDATE person_roles SET assignment_status='expired' WHERE person_id IN (84,85)");
    await pool.execute('UPDATE departments SET final_responsible_person_id=84 WHERE id=91');
    await pool.execute('UPDATE departments SET final_responsible_person_id=85 WHERE id=92');
    assert.ok((await expect('reviewA',root+'/cases','GET')).items.some(c=>String(c.id)===String(id)));
    await expect('reviewA',root+'/cases/'+id,'GET');
    assert.equal((await expect('reviewB',root+'/cases','GET')).items.length,0);
    await expect('reviewB',root+'/cases/'+id,'GET',undefined,403);
    checks.push('roleless department final responsible reads owning-department cases only; participation does not disclose another department case');
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'passed',checks},null,2));
    console.log('PROCESS_CASE_DISPUTES_PASS '+checks.length+' scenario groups');
  },{evidenceDir:output,completeSource:true,randomDatabase:true,createDocument:syntheticSource});
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
