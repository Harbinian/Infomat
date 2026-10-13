// Pure B02 office view/planner contracts. Run with blockRealMysql and --test.
// Synthetic input only; no sockets, files, database writes or resources.
const test=require('node:test'),assert=require('node:assert/strict');
const {splitIdentityRows,identityParam,planOffice,planMembership}=require('../server/officePublication');
const P0='9007199254741000',P1='9007199254741001',O0='9007199254741100',O1='9007199254741101',D0='9007199254740992',D1='9007199254740993';
const departments=[{id:D0,code:'D0',status:'active'},{id:D1,code:'D1',status:'active'}];
const persons=[{person_id:P0,employee_no:'P0',status:'active',employment_status:'active'},{person_id:P1,employee_no:'P1',status:'active',employment_status:'active'}];
const offices=[{org_unit_id:O0,org_unit_code:'O0',org_unit_name:'O0',org_type:'office',department_id:D0,manager_person_id:P0,status:'active'},
  {org_unit_id:O1,org_unit_code:'O1',org_unit_name:'O1',org_type:'office',department_id:D1,manager_person_id:P1,status:'active'}];
test('separate exact aliases preserve every raw field and original number type',()=>{
  const raw={person_id:Number(P1),current_department_id:Number(D1),unrecognized_history:'retain all historical text',nullable:null,exact_person_id:P1,exact_current_department_id:D1};
  const state=splitIdentityRows([raw],['person_id','current_department_id']);
  assert.deepEqual(state.snapshot,[{person_id:Number(P1),current_department_id:Number(D1),unrecognized_history:raw.unrecognized_history,nullable:null}]);
  assert.equal(state.identities[0].person_id,P1);assert.equal(state.identities[0].current_department_id,D1);
  state.identities[0].person_id=P0;assert.equal(state.snapshot[0].person_id,Number(P1));assert.equal(raw.exact_person_id,P1);
});
test('office manager retention uses exact person and owning department',()=>{
  const result=planOffice({code:'O1',name:'O1',owning_department_code:'D1'}, {},{offices,memberships:[],pending:[]},departments,persons,[],2);
  assert.equal(result.change.desired.manager_person_id,P1);assert.equal(result.review.action,'unchanged');assert.deepEqual(result.errors,[]);
});
test('adjacent pending assignee/office never blocks another person or office',()=>{
  const state={offices,memberships:[{person_id:P1,office_id:O1,status:'active'}],pending:[{office_id:O0,assignee_person_id:P0}]};
  const removal=planMembership({office_codes:''},{office_codes:'mapped'},{person_id:P1},state,departments,2);assert.deepEqual(removal.errors,[]);assert(removal.membershipChanged);
  const update=planOffice({code:'O1',name:'O1',owning_department_code:'D0'}, {},state,departments,persons,[],2);assert.deepEqual(update.errors,[]);
  state.pending.push({office_id:O1,assignee_person_id:P1});assert(planMembership({office_codes:''},{office_codes:'mapped'},{person_id:P1},state,departments,2).errors.some(e=>e.message.includes('未办结')));
  assert(planOffice({code:'O1',name:'O1',owning_department_code:'D0'}, {},state,departments,persons,[],2).errors.some(e=>e.message.includes('未办结')));
});
test('ordinary membership IDs keep number API type and compare equivalent decimals',()=>{
  const state={offices:[{org_unit_id:31,org_unit_code:'SAFE',org_type:'office',department_id:91,status:'active'}],memberships:[{person_id:81,office_id:'31',status:'active'}],pending:[]};
  const value=planMembership({office_codes:'SAFE'},{office_codes:'mapped'},{person_id:'81'},state,[{id:'91',status:'active'}],2);
  assert.deepEqual(value.officeIds,[31]);assert.equal(value.membershipChanged,false);assert.deepEqual(value.errors,[]);
});
test('decimal SQL identity bindings reject typed principals and already rounded numbers',()=>{
  assert.equal(identityParam(81),'81');assert.equal(identityParam(P1),P1);assert.equal(identityParam(null),null);
  for(const value of [Number(P1),'system-admin:1','9223372036854775808'])assert.throws(()=>identityParam(value));
});
