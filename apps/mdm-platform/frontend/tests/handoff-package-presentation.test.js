import test from 'node:test';
import assert from 'node:assert/strict';
import {packageCorrectionRevision,packageParentSnapshot,packageDetailName,packageFactChoices,preservePackageChoice,packageInputDisplay,legacyPackageWrite,handoffReceiptGuide,handoffResultGuide} from '../src/handoffPackagePresentation.js';
import {freezeHandoffRequest} from '../src/dataMapHandoffRequest.js';

const binding='450b553c-541c-4727-906c-6ce9b234ed0b',fact='aac2728f-8dde-48f0-a82b-3bc17972ca61',old='265519e5-0640-4352-b4ea-bfca4ed4a708';
test('correction content uses the exact recorded revision and rejects missing or ambiguous matches',()=>{
  const head={correction_id:'c',current_revision:2},current={correction_id:'c',revision_no:2,snapshot_json:{name:'准确内容'}},trace={correction_revisions:[{correction_id:'c',revision_no:3},{correction_id:'other',revision_no:2},current,{correction_id:'c',revision_no:1}]};
  const before=structuredClone(trace);
  assert.equal(packageCorrectionRevision(trace,head),current);
  assert.equal(packageParentSnapshot(trace,'correction','c',2),current.snapshot_json);
  assert.equal(packageCorrectionRevision(trace,{...head,current_revision:4}),null);
  assert.equal(packageCorrectionRevision({...trace,correction_revisions:[current,current]},head),null);
  assert.equal(packageCorrectionRevision(trace,{correction_id:'c'}),null);
  assert.deepEqual(trace,before);
});
test('legacy names resolve only an exact fixed detail version, never a later name or list position',()=>{
  const trace={detail_sources:[{detail_version_id:'wrong',source:{data_name:'不能借用'}},{detail_version_id:'correct',source:{data_name:'合成收货记录',field_name:'记录号'}}]};
  assert.equal(packageDetailName(trace,{detail_id:'one',detail_version_id:'correct',detail_type:'critical_field'}),'合成收货记录 / 记录号');
  assert(!packageDetailName(trace,{detail_id:'one',detail_version_id:'missing',detail_type:'critical_field'}).includes('合成收货记录'));
  assert.equal(packageDetailName(trace,{detail_id:'one',detail_version_id:'correct',source:{data_name:'已留存原名称'}}),'已留存原名称');
});
test('an intake without review bindings uses names captured in its own exact detail while a missing source projection stays untrusted',()=>{
  const detail={detail_id:'507',detail_version_id:'de4dd3c9-2d7c-487d-b9b4-f5d9a840b1d2',detail_type:'data_object_identity',candidate:{data_ref:'source_1',data_name:'合成旧包重新接入流程记录',proposed_master_data_status:'pending_confirmation'}};
  const trace={bindings:[],detail_sources:[{detail_version_id:detail.detail_version_id,source:null},{detail_version_id:'another-version',source:{data_name:'不能借用的当前名称'}}]},before=structuredClone({detail,trace});
  assert.equal(packageDetailName(trace,detail),'数据对象识别：合成旧包重新接入流程记录');
  assert.equal(packageDetailName({...trace,detail_sources:trace.detail_sources.slice(1)},detail),'数据对象识别：合成旧包重新接入流程记录');
  assert(!packageDetailName(trace,{...detail,candidate:{proposed_master_data_status:'confirmed'}}).includes('合成旧包重新接入流程记录'));
  assert(!packageDetailName(trace,{...detail,candidate:{data_name:binding}}).includes(binding));
  assert(!packageDetailName(trace,detail).includes('pending_confirmation'));
  assert.equal(packageDetailName({detail_sources:[{detail_version_id:detail.detail_version_id,source:{data_name:'准确核对的固定来源名称'}}]},detail),'数据对象识别：准确核对的固定来源名称');
  assert.deepEqual({detail,trace},before);
});
test('original-question choices remain within the exact parent and detail while unavailable old selections survive',()=>{
  const parent={intake_id:'intake',current_revision:3,snapshot_json:{facts:[{fact_id:fact,detail_id:'detail',question_text:'请核实入库时间',status:'open'},{fact_id:'foreign-detail',detail_id:'other',question_text:'不能选择'}]}},trace={intakes:[{intake_id:'other',current_revision:3,snapshot_json:{facts:[{fact_id:'foreign-parent',detail_id:'detail',question_text:'不能借用'}]}},parent]};
  const before=structuredClone(trace),snapshot=packageParentSnapshot(trace,'intake','intake',3),choices=packageFactChoices(snapshot,'detail');
  assert.deepEqual(choices.map(row=>row.value),[fact]);assert.match(choices[0].label,/请核实入库时间/);
  assert.equal(packageParentSnapshot(trace,'intake','intake',2),null);
  assert.equal(packageFactChoices(snapshot,'missing').length,0);
  assert.equal(preservePackageChoice(choices,old).at(-1).value,old);
  assert(!preservePackageChoice(choices,old).at(-1).label.includes(old));
  assert.equal(preservePackageChoice(choices,''),choices);
  assert.equal(preservePackageChoice(choices,fact),choices);
  assert.deepEqual(trace,before);
});
test('technical original text is protected only for rendering and remains exact in the frozen correction',()=>{
  const raw='process_data_governance_review:'+binding,governance={unified_object_id:old,basis:'原依据',conclusion:'原结论'},values={parent_id:'c',parent_revision:4,reason:'合成更正',evidence:'原总依据',details:[{selected:true,detail_id:'d',detail_version_id:'v',status:'confirmed',governance,evidenceText:raw},{selected:false,detail_id:'unchanged'}]};
  const before=structuredClone(values);
  assert.deepEqual(packageInputDisplay(raw),{text:'',hidden:true});
  assert.deepEqual(packageInputDisplay('收货单第3页'),{text:'收货单第3页',hidden:false});
  assert.deepEqual(packageInputDisplay(''),{text:'',hidden:false});
  const write=legacyPackageWrite('save_correction',values,{package_id:'p'});
  assert.equal(write.method,'PATCH');assert.equal(write.path,'corrections/c');
  assert.deepEqual(write.body,{expected_revision:4,reason:'合成更正',evidence_refs:['原总依据'],details:[{detail_id:'d',expected_detail_version_id:'v',status:'confirmed',governance,evidence_refs:[raw]}]});
  const draft=freezeHandoffRequest({kind:'save_correction',values},{url:'/api/data-map-handoffs/'+write.path,method:write.method,body:write.body},()=>fact);
  assert.equal(draft.request.body.details[0].governance.unified_object_id,old);assert.equal(draft.request.body.details[0].evidence_refs[0],raw);
  assert.deepEqual(values,before);
});
test('all legacy operation bodies retain their original identity, scope and open fact-type contract',()=>{
  const resource={package_id:'pkg'};
  assert.deepEqual(legacyPackageWrite('prepare_intake',{},resource),{path:'work-packages/pkg/intakes',method:'POST',body:{expected_revision:0}});
  assert.deepEqual(legacyPackageWrite('create_handoff',{binding_id:binding,scope_mode:'historical'},resource).body,{expected_revision:0,binding_id:binding,scope_mode:'historical'});
  const intake=legacyPackageWrite('review_intake',{parent_id:'i',parent_revision:3,basis:'逐条核验',details:[{detail_id:'d',detail_version_id:'v',basis:'本条依据',evidence:'材料甲\n材料乙'}]},resource);
  assert.equal(intake.path,'intakes/i/reviews');assert.deepEqual(intake.body,{expected_revision:3,basis:'逐条核验',detail_evidence:[{detail_id:'d',detail_version_id:'v',basis:'本条依据',evidence_refs:['材料甲','材料乙']}]});
  assert.deepEqual(legacyPackageWrite('create_correction',{replaces_binding_id:binding,reason:'原因',evidence:'材料甲'},resource).body,{expected_revision:0,replaces_binding_id:binding,reason:'原因',evidence_refs:['材料甲']});
  assert.deepEqual(legacyPackageWrite('review_correction',{parent_id:'c',parent_revision:5,basis:'准确本次审核',evidence:'材料乙'},resource),{path:'corrections/c/reviews',method:'POST',body:{expected_revision:5,basis:'准确本次审核',evidence_refs:['材料乙']}});
  for(const factType of ['业务发生时间','business_meaning','UNKNOWN_LEGACY_TYPE']){
    const values={parent_kind:'intake',parent_id:'i',parent_revision:3,detail_id:'d',target_department_id:'91',fact_type:factType,question:'核实问题',reason:'核实原因',resolves_legacy_fact_id:old},before=structuredClone(values),write=legacyPackageWrite('legacy_fact',values,resource);
    assert.equal(write.path,'intakes/i/facts');assert.deepEqual(write.body,{expected_revision:0,intake_id:'i',expected_parent_revision:3,detail_id:'d',target_department_id:'91',requested_fact_type:factType,question_text:'核实问题',request_reason:'核实原因',resolves_legacy_fact_id:old});assert.deepEqual(values,before);
  }
  const fresh=legacyPackageWrite('legacy_fact',{parent_kind:'correction',parent_id:'c',parent_revision:2,resolves_legacy_fact_id:''},resource);assert.equal(fresh.path,'corrections/c/facts');assert(!Object.hasOwn(fresh.body,'resolves_legacy_fact_id'));
});
test('uncertain receipts explain safe next actions without asserting non-write or leaking machine states',()=>{
  assert.match(handoffReceiptGuide('not_observed'),/不能据此确认未保存/);assert.match(handoffReceiptGuide('not_observed'),/可能完成原操作/);
  assert.match(handoffReceiptGuide('retryable'),/可能完成原操作/);assert.match(handoffReceiptGuide('in_progress'),/仍在进行/);
  assert.match(handoffReceiptGuide('committed'),/确认本次办理结果/);assert(!handoffReceiptGuide('UNKNOWN_STATE').includes('UNKNOWN_STATE'));
  assert.match(handoffReceiptGuide('constructor'),/尚未核实/);
});
test('result guidance names the saved object and routes only by exact returned identifiers without modifying evidence',()=>{
  const result={business_outcome:'fact_saved',fact_id:fact,package_id:'pkg',status:'open'},before=structuredClone(result),display=handoffResultGuide('legacy_fact',result);
  assert.deepEqual(display.target,{kind:'fact',id:fact});assert.match(display.summary,/定向补核问题已保存/);assert.match(display.next,/目标部门答复/);assert.match(display.next,/不会自动完成审核/);
  assert(!JSON.stringify([display.summary,display.next,display.targetLabel]).includes(fact));assert.deepEqual(result,before);
  assert.equal(handoffResultGuide('prepare_intake',{business_outcome:'intake_prepared',intake_id:old}).target,null);
  assert.match(handoffResultGuide('review_correction',{business_outcome:'review_bound_pending_draft'}).next,/尚未形成数据地图发布/);
  assert.match(handoffResultGuide('create_correction',{business_outcome:'correction_saved'}).summary,/尚未完成更正审核/);
  assert.equal(handoffResultGuide('x',{business_outcome:'constructor'}).summary,'已收到本次办理结果。');
  const published=handoffResultGuide('publish',{business_outcome:'published_current',handoff_id:old,publication_id:fact});
  assert.deepEqual(published.target,{kind:'publication',id:fact});assert.match(published.targetLabel,/发布内容/);
  const conflict=handoffResultGuide('conflict_answer',{business_outcome:'conflict_saved',conflict_id:old,handoff_id:fact});assert.deepEqual(conflict.target,{kind:'conflict',id:old});
});
