const test = require('node:test');
const assert = require('node:assert/strict');
const {prepareChange,normalizeChange,hash} = require('../server/directoryContract');
const {publicationWritePermission,directoryChangeReason} = require('../server/publicationRepository');
const snapshot = {
  departments:[{id:'91',code:'HR',name:'行政人事部',parent_id:null,department_type:null,status:'active'}, {id:'92',code:'OPS',name:'运营部',parent_id:'91',status:'active'}],
  persons:[{person_id:'9007199254741001',employee_no:'P01',person_name:'合成人员',current_department_id:'91',employment_status:'active',status:'active',mobile:null,email:null,office_ids:['31']}],
  offices:[{id:'31',code:'O1',name:'合成办公室',department_id:'91',manager_person_id:null,status:'active'}]
};
const request = values => ({entity:'person',operation:'update',id:'9007199254741001',values,reason:'修正合成资料',expected_snapshot_hash:'a'.repeat(64)});
test('explicit stable person ID keeps existing fields and office membership',()=>{
  const result = prepareChange(snapshot,request({person_name:'更新合成人员'}));
  assert.equal(result.change.id,'9007199254741001');
  assert.equal(result.normalized.records[0].employee_no,'P01');
  assert.equal(result.normalized.records[0].office_codes,'O1');
  assert.equal(result.normalized.records[0].person_name,'更新合成人员');
});
test('create cannot overwrite by employee number or name, updates cannot rename identity key',()=>{
  assert.throws(()=>prepareChange(snapshot,{...request({employee_no:'P01',person_name:'另一个人',current_department_id:'91'}),operation:'create',id:null}),{code:'DIRECTORY_DUPLICATE_KEY'});
  assert.throws(()=>prepareChange(snapshot,request({employee_no:'P02'})),{code:'DIRECTORY_STABLE_KEY_REQUIRED'});
  const created = prepareChange(snapshot,{...request({employee_no:'P02',person_name:'合成人员',current_department_id:'91'}),operation:'create',id:null});
  assert.equal(created.existing,null);
});
test('malformed IDs, unsupported account fields and empty statuses are rejected',()=>{
  assert.throws(()=>normalizeChange({...request({}),id:Number('9007199254741001')}));
  assert.throws(()=>normalizeChange(request({roleAssignments:[]})));
  assert.throws(()=>normalizeChange(request({employment_status:''})));
  assert.throws(()=>normalizeChange({...request({}),reason:' '}),{code:'DIRECTORY_REASON_REQUIRED'});
  assert.throws(()=>normalizeChange(request({office_ids:['31',31]})));
});
test('request hash binds reason, expected snapshot and values independent of key order',()=>{
  const a = normalizeChange(request({mobile:'123',person_name:'新名'}));
  const b = normalizeChange(request({person_name:'新名',mobile:'123'}));
  assert.equal(hash(a),hash(b));
  assert.notEqual(hash(a),hash({...a,reason:'另一原因'}));
});
test('active children and department responsibilities prevent invalid transitions',()=>{
  assert.throws(()=>prepareChange(snapshot,{entity:'department',operation:'update',id:'91',values:{status:'inactive'},reason:'合成',expected_snapshot_hash:'a'.repeat(64)}),{code:'DIRECTORY_CHILD_DEPARTMENT_IN_USE'});
  const responsibility = {...snapshot,departments:snapshot.departments.map(row=>({...row,final_responsible_person_id:row.id === '91' ? '9007199254741001' : null}))};
  assert.throws(()=>prepareChange(responsibility,request({employment_status:'leave'})),{code:'DIRECTORY_RESPONSIBILITY_IN_USE'});
});
test('directory permission is separate from governance publication',()=>{
  assert.equal(publicationWritePermission('organization'),'directory:maintain');
  assert.equal(publicationWritePermission('roster'),'directory:maintain');
  assert.equal(publicationWritePermission('master_data'),'governance:publish');
  assert.equal(directoryChangeReason('  业务确认  '),'业务确认');
});
