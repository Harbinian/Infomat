import test from 'node:test';
import assert from 'node:assert/strict';
import {accountAuditLink,accountAuditQuery,auditAccountReturn,authorizationContext,authorizationDescription} from '../src/accountReviewPresentation.js';
import {directoryRecordLabel,directoryResponsibleName,directoryHistoryTitle,directoryDisplayValue} from '../src/directoryIdentityPresentation.js';
import {directoryImportColumns,directoryChangeName} from '../src/directoryPresentation.js';
import {organizationInitialValues} from '../src/directoryMaintenancePresentation.js';

test('organization labels use exact department paths and preserve stored keys',()=>{
 const snapshot={departments:[{id:'9007199254740993',name:'合成总部门'},{id:'9007199254740994',name:'合成甲部',parent_id:'9007199254740993'},{id:'9007199254740995',name:'合成乙部'}],offices:[{id:'11',department_id:'9007199254740994',code:'OU-OFC-SYN-001',name:'同名办公室'},{id:'12',department_id:'9007199254740995',code:'OU-OFC-SYN-002',name:'同名办公室'}]};
 const before=structuredClone(snapshot);
 assert.equal(directoryRecordLabel(snapshot.offices[0],false,snapshot),'合成总部门 / 合成甲部 / 同名办公室');
 assert.notEqual(directoryRecordLabel(snapshot.offices[0],false,snapshot),directoryRecordLabel(snapshot.offices[1],false,snapshot));
 assert.equal(directoryDisplayValue('office_ids',['11'],snapshot),'合成总部门 / 合成甲部 / 同名办公室');
 assert(!directoryRecordLabel(snapshot.offices[0],false,snapshot).includes(snapshot.offices[0].code));
 assert.deepEqual(snapshot,before);
});
test('department responsibility only resolves the exact current registration and never infers a person',()=>{
 const snapshot={persons:[{person_id:'9007199254740993',person_name:'准确登记姓名'},{person_id:'9007199254740992',person_name:'相邻但不同人员'}]};
 assert.equal(directoryResponsibleName({kind:'department',final_responsible_person_id:'9007199254740993'},snapshot),'准确登记姓名');
 assert.equal(directoryResponsibleName({kind:'department',final_responsible_person_id:'9007199254740994'},snapshot),'负责人姓名未记录');
 assert.equal(directoryResponsibleName({kind:'department',manager_person_id:'9007199254740993'},snapshot),'尚未登记');
});
test('new organization keys are generated once with the draft while edits keep original and missing legacy keys',()=>{
 let calls=0;const generate=()=>{calls++;return 'synthetic-fixed-key';};
 const values=organizationInitialValues('department',null,generate),draft={values,request_id:'synthetic-request',reason:'合成原因'};
 const preview={...draft,checked:{request_hash:'synthetic-hash'}},uncertain={...preview,uncertain:true},recheck={...uncertain,expected_snapshot_hash:'new-basis'};
 assert.equal(calls,1);assert.equal(values.code,'org-synthetic-fixed-key');
 assert.equal(recheck.values.code,values.code);assert.equal(uncertain.request_id,draft.request_id);
 assert.equal(organizationInitialValues('office',{code:'OU-OLD-001',name:'旧办公室'},generate).code,'OU-OLD-001');
 assert.equal(organizationInitialValues('department',{name:'缺少旧键'},generate).code,'');assert.equal(calls,1);
});
test('employee audit links keep exact identity and only permit local account returns',()=>{
 const account={person_id:'9007199254740993',person_name:'不应进网址的姓名',employee_no:'合成工号'};
 const link=accountAuditLink(account,'/app/accounts?search=合成工号&department=9'),query=new URL(link,'http://local.invalid').searchParams;
 assert.equal(query.get('personId'),account.person_id);assert(!link.includes(account.person_name));
 const returned=new URL(auditAccountReturn(query.get('return_to')),'http://local.invalid');assert.equal(returned.pathname,'/app/accounts');assert.equal(returned.searchParams.get('search'),'合成工号');assert.equal(returned.searchParams.get('department'),'9');
 assert.equal(auditAccountReturn('https://outside.invalid/app/accounts'),'/app/accounts');
 assert.equal(auditAccountReturn('/app/roster'),'/app/accounts');
 assert.equal(new URL(accountAuditQuery('role_assigned',account.person_id),'http://local.invalid').searchParams.get('personId'),account.person_id);
});
test('revocation descriptions identify role range and dates without changing assignment data',()=>{
 const assignment={assignmentId:'old-internal-key',roleCode:'data_quality_auditor',roleName:'数据质量审计人',scopeType:'department',scopeDepartmentName:'合成甲部',effectiveFrom:'2026-10-01T00:00:00Z',effectiveTo:'2026-12-01',authorizationBasis:'/api/synthetic-basis'};
 const before=structuredClone(assignment),context=authorizationContext(assignment),text=authorizationDescription(context);
 for(const value of ['数据质量审计人','合成甲部','2026-10-01','2026-12-01'])assert(text.includes(value));
 assert(!text.includes(assignment.assignmentId));assert.deepEqual(assignment,before);
 assert.equal(authorizationContext(null),null);
 assert(!authorizationDescription(authorizationContext({...assignment,roleName:'/api/synthetic-role'})).includes('/api/'));
});
test('mapping labels use business names or distinct source columns while retaining exact source header values',()=>{
 const headers=['person_id','person_name','未命名业务内容','person_name','customField'],before=[...headers];
 const columns=directoryImportColumns(headers);
 assert.deepEqual(columns.map(c=>c.field),headers);assert.deepEqual(headers,before);
 assert(columns[1].label.startsWith('姓名'));assert.notEqual(columns[1].label,columns[3].label);
 assert(!columns.map(c=>c.label).join(' ').includes('person_id'));assert(!columns.map(c=>c.label).join(' ').includes('customField'));
 assert(columns[0].label.includes('A列'));assert(columns[4].label.includes('E列'));
});
test('history never borrows current organization names or exposes technical keys',()=>{
 const source={source_file_name:'directory-change.json',history_summary:{entity:'office',operation:'update',before:{code:'OU-OLD-001',name:'历史旧名称'},after:{code:'OU-OLD-001',name:'历史新名称'}}};
 const before=structuredClone(source);assert.equal(directoryHistoryTitle(source),'修改办公室 · 历史旧名称 → 历史新名称');
 assert.equal(directoryDisplayValue('code','OU-OLD-001',{offices:[{code:'OU-OLD-001',name:'现名'}]},true),'历史组织名称未记录');
 assert.equal(directoryChangeName({key:'OU-OLD-001',fields:[]},{offices:[{code:'OU-OLD-001',name:'现名'}]},true),'本次目录记录');
 assert.deepEqual(source,before);
});
