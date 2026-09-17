// Pure synthetic tests: no network, database, worker or artifact writes.
const test=require('node:test'),assert=require('node:assert/strict');
const {compareAnalysisSnapshots:compare}=require('../server/analysisComparison');
const {digest}=require('../server/dataMapDefinitionValues');
function run(id='1'){
 const snapshot={kind:'v7_source',ref_id:'10',identity:{kind:'preview_revision',id:'20'},content_digest:'a'};
 return {run_id:id,scope_department_id:'91',status:'succeeded',manifest_digest:'manifest',manifest:{inputs:[{input_key:'material',snapshot}],check_scope:{check_ids:['v7.required']},rule_version:'v1',parser_versions:{parser:'v1'},ai_metadata:null,steps:[{step_key:'check',input_keys:['material'],check_ids:['v7.required'],parser_key:'parser'}]},documents:{material:{data_objects:[{data_ref:'order',fields:[{field_ref:'code',field_name:'编号'}]}]}},attempts:[{attempt_id:id+'1',step_key:'check',attempt_no:1,status:'succeeded',coverage:{checked:['v7.required'],missing:[]},evidence:[{evidence_key:'e1',input_key:'material',fixed_reference:snapshot,locator:'/data_objects/0/fields/0',locator_kind:'json_pointer',note:'待核实'}],findings:[{finding_id:id+'2',rule_id:'v7.required',rule_version:'v1',subject_input_keys:['material'],semantic_locator:'document.data_objects[data_ref=order].fields[field_ref=code]:required',evidence_keys:['e1'],comparison_algorithm:'analysis-subject-v1',finding_type:'material_constraint',message:'缺少定义'}]}]};
}
function check(name,expected,fn){test(name,()=>{const a=run(),b=run('2');fn(b,a);const hash=digest([a,b]),result=compare(a,b);assert.deepEqual(result.rows.map(r=>r.status),expected);assert.equal(digest([a,b]),hash);assert.equal(result.implies_remediation,false);assert.equal(result.changes_governance,false);});}
check('independent finding IDs and titles',['persistent'],b=>b.attempts[0].findings[0].message='新标题');
check('input keys and step names are not identities',['persistent'],b=>{b.manifest.inputs[0].input_key='renamed';b.manifest.steps[0].input_keys=['renamed'];b.manifest.steps[0].step_key='other';b.attempts[0].step_key='other';b.attempts[0].findings[0].subject_input_keys=['renamed'];b.attempts[0].evidence[0].input_key='renamed';});
check('reordering evidence never creates new findings',['evidence_changed'],b=>{b.attempts[0].evidence[0].locator='/data_objects/1/fields/0';b.manifest.inputs[0].snapshot.content_digest='reordered';});
check('field rename retains identity',['evidence_changed'],b=>{b.documents.material.data_objects[0].fields[0].field_name='新名称';b.manifest.inputs[0].snapshot.content_digest='renamed';});
check('checked absence is not remediation',['not_detected'],b=>b.attempts[0].findings=[]);
check('new finding in comparable complete scope',['added'],(b,a)=>a.attempts[0].findings=[]);
check('deleted object does not imply remediation',['incomparable'],b=>{b.attempts[0].findings=[];b.documents.material.data_objects=[];});
check('material leaves scope',['incomparable'],b=>{b.manifest.inputs[0].snapshot.identity.id='other';b.attempts[0].findings=[];});
check('rule upgrade without mapping',['incomparable'],b=>b.manifest.rule_version='v2');
check('parser upgrade',['incomparable'],b=>b.manifest.parser_versions.parser='v2');
check('parse failure preserves findings',['incomparable'],b=>{b.status='partial';b.attempts[0].status='partial';b.attempts[0].findings=[];b.attempts[0].coverage={checked:[],missing:['v7.required']};});
check('AI partial failure with synthetic metadata only',['incomparable'],(b,a)=>{a.manifest.ai_metadata=b.manifest.ai_metadata={model:'offline',prompt_version:'v1'};b.status='partial';b.attempts[0].status='failed';b.attempts[0].findings=[];b.attempts[0].coverage={checked:[],missing:['v7.required']};});
for(const state of ['failed','cancelled','running'])check(state+' run preserves old findings',['incomparable'],b=>{b.status=state;b.attempts[0].findings=[];});
for(const [name,alter] of [['algorithm',f=>f.comparison_algorithm='future'],['opaque identity',f=>f.semantic_locator='document[value=hash]'],['no evidence',f=>f.evidence_keys=[]]])check(name+' needs manual match',['manual_match'],(b,a)=>{alter(a.attempts[0].findings[0]);alter(b.attempts[0].findings[0]);});
check('duplicate logical source is ambiguous',['manual_match'],(b,a)=>{for(const r of [a,b])r.manifest.inputs.push({...structuredClone(r.manifest.inputs[0]),input_key:'duplicate'});});
check('latest failed retry does not reuse old coverage',['incomparable'],b=>{b.status='partial';b.attempts.push({...structuredClone(b.attempts[0]),attempt_no:2,attempt_id:'latest',status:'failed',findings:[],coverage:{checked:[],missing:['v7.required']}});});
check('removed handoff field pair',['incomparable'],(b,a)=>{for(const r of [a,b]){r.attempts[0].findings[0].semantic_locator='field=30->40:conflict';r.documents.material={pairs:[{source:{field_id:'30'},target:{field_id:'40'}}]};}b.documents.material.pairs=[];b.attempts[0].findings=[];});
check('unrelated missing rule does not block fully covered rule',['persistent'],(b,a)=>{for(const r of [a,b]){r.status='partial';r.attempts[0].status='partial';r.manifest.steps[0].check_ids.push('other');r.manifest.check_scope.check_ids.push('other');r.attempts[0].coverage.missing.push('other');}});
test('empty results still report incompatible rule version',()=>{const a=run(),b=run('2');a.attempts[0].findings=[];b.attempts[0].findings=[];b.manifest.rule_version='v2';assert(compare(a,b).comparability_reasons.includes('RULE_SEMANTICS_UNMAPPED'));});
function actual(document,id){
 const rules=require('../server/v7AnalysisRules'),r=run(id),s=r.manifest.inputs[0].snapshot;
 s.validation_status='valid';s.content_digest=digest(document);r.documents.material=document;
 r.manifest.rule_version=rules.VERSION;r.manifest.parser_versions={parser:rules.VERSION};r.manifest.check_scope.check_ids=rules.CHECKS;r.manifest.steps[0].check_ids=rules.CHECKS;
 const output=rules.analyze({step:{check_ids:rules.CHECKS},inputs:[{input_key:'material',snapshot:s,document}]});
 r.status=output.status;r.attempts[0].status=output.status;r.attempts[0].coverage={checked:output.checked_ids,missing:rules.CHECKS.filter(c=>!output.checked_ids.includes(c))};
 r.attempts[0].findings=output.findings.map((f,i)=>({...f,finding_id:id+String(i),rule_version:rules.VERSION,comparison_algorithm:'analysis-subject-v1'}));
 r.attempts[0].evidence=output.evidence.map(e=>({...e,fixed_reference:s}));return r;
}
test('actual P11 rules: reordered V7 arrays preserve every finding match',()=>{
 const samples=require('./testHelpers/v7AnalysisSamples'),d=samples.document();d.behaviors.push(samples.node('behavior_isolated'));d.behaviors[1].node_type='decision';
 const a=actual(d,'11'),reordered=structuredClone(d);reordered.behaviors.reverse();reordered.flow_relations.reverse();const b=actual(reordered,'22'),result=compare(a,b);
 assert(a.attempts[0].findings.length>0);assert.equal(result.rows.length,a.attempts[0].findings.length);assert(result.rows.every(r=>['persistent','evidence_changed'].includes(r.status)));
});
test('actual P11 rules: field rename keeps binding defect matched',()=>{
 const d=require('./testHelpers/v7AnalysisSamples').binding();d.forms[0].areas[0].items[0].data_field_ref='field_b';const a=actual(d,'31'),renamed=structuredClone(d);renamed.data_objects[0].fields[0].field_name='合成新名称';const b=actual(renamed,'32');
 const result=compare(a,b);assert(result.rows.length>0);assert(result.rows.every(r=>['persistent','evidence_changed'].includes(r.status)));
});
check('legacy finding without evidence cannot disappear',['manual_match'],(b,a)=>{a.attempts[0].findings[0].evidence_keys=[];b.attempts[0].findings=[];});
test('partial empty results expose coverage gaps',()=>{const a=run(),b=run('2');for(const r of [a,b]){r.attempts[0].findings=[];r.status='partial';r.attempts[0].status='partial';r.attempts[0].coverage={checked:[],missing:['v7.required']};}const result=compare(a,b);assert.equal(result.rows.length,0);assert.equal(result.comparison_complete,false);assert.deepEqual(result.coverage.after[0].missing,['v7.required']);});
test('actual P12 rule output keeps field pairs matched after reordering',()=>{
 const rules=require('../server/handoffAnalysisRules');
 const pair=(x,y)=>({identifier:true,source:{field_id:x,field_version_id:'3',definition:{data_type:'text',enum_values:[]}},target:{field_id:y,field_version_id:'4',definition:{data_type:'integer',enum_values:[]}},checks:Object.fromEntries(['field','format','enum','unit','version'].map(k=>[k,{mode:'same',rule:null,basis:'合成依据'}]))});
 const doc={claim_status:'analysis_pending',source:{object_id:'1'},target:{object_id:'1'},identity_rule:'编号相等',identity_basis:'合成规则',identifier_kind:'composite',delivery_condition:'交付',reception_requirement:'接收',evidence:[{side:'source'},{side:'target'}],pairs:[pair('2','4'),pair('5','6')]};
 function convert(d,id){const r=run(id),s=r.manifest.inputs[0].snapshot;s.kind='handoff';s.identity={kind:'handoff',id:'77'};s.content_digest=digest(d);r.documents.material=d;r.manifest.rule_version=rules.VERSION;r.manifest.parser_versions={parser:rules.VERSION};r.manifest.check_scope.check_ids=rules.CHECKS;r.manifest.steps[0].check_ids=rules.CHECKS;const out=rules.analyze({step:{check_ids:rules.CHECKS},inputs:[{input_key:'material',document:d}]});r.status=out.status;r.attempts[0].status=out.status;r.attempts[0].coverage={checked:out.checked_ids,missing:rules.CHECKS.filter(c=>!out.checked_ids.includes(c))};r.attempts[0].findings=out.findings.map((f,i)=>({...f,finding_id:id+String(i),rule_version:rules.VERSION,comparison_algorithm:'analysis-subject-v1'}));r.attempts[0].evidence=out.evidence.map(e=>({...e,fixed_reference:s}));return r;}
 const a=convert(doc,'41'),next=structuredClone(doc);next.pairs.reverse();const b=convert(next,'42'),result=compare(a,b);assert(result.rows.length>0);assert.equal(result.counts.added,0);assert.equal(result.counts.not_detected,0);assert.equal(result.counts.evidence_changed,3);assert.equal(result.counts.manual_match,3);assert.equal(result.comparison_complete,false);
});
