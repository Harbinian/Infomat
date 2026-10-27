import test from 'node:test';
import assert from 'node:assert/strict';
import { auditActorName, governanceCount, governanceLabel, protectDiagramLabels } from '../src/governancePresentation.js';

test('statistics distinguish actual zero, loading, failure and an unreadable count', () => {
  assert.equal(governanceCount({}, 0), '0');
  assert.equal(governanceCount({}, 12), '12');
  assert.equal(governanceCount({busy:true}, 12), '读取中…');
  assert.equal(governanceCount({error:new Error('synthetic')}, 0), '暂不可用');
  for (const value of [undefined, null, -1, '12', NaN, Infinity]) assert.equal(governanceCount({}, value), '数量待核对');
});

test('unknown governance enums never fall through as machine values', () => {
  assert.equal(governanceLabel('running', {running:'检查中'}), '检查中');
  for (const value of ['unexpected_machine_state', 'unexpected', '/api/synthetic']) assert.equal(governanceLabel(value, {}, '办理状态待核对'), '办理状态待核对');
  assert.equal(governanceLabel('已形成意见', {}), '已形成意见');
});

test('an audit actor without a name stays unknown unless the event explicitly links a maintenance identity', () => {
  const missing={actor_name:null,actor_person_id:null,actor_system_account_id:null};
  assert.equal(auditActorName(missing), '历史操作人姓名未记录');
  assert.equal(auditActorName({...missing,actor_person_id:'9007199254740999'}), '历史操作人姓名未记录');
  assert.equal(auditActorName({...missing,actor_system_account_id:'9007199254740999'}), '系统维护管理员（历史姓名未记录）');
  assert.equal(auditActorName({...missing,actor_name:'原记录提供的操作人'}), '原记录提供的操作人');
  assert.equal(auditActorName({...missing,actor_name:'/api/synthetic'}), '历史操作人姓名未记录');
  assert.deepEqual(missing,{actor_name:null,actor_person_id:null,actor_system_account_id:null});
});

test('chart labels hide technical content while keeping model identifiers and business labels', () => {
  const records = [{id:'behavior:internal-1',label:'采购申请'}, {id:'edge:internal-2',label:'/api/synthetic'}, {id:'edge:internal-3',label:'12345678-abcd-4321-9876-123456789abc'}, {id:'lane:internal-4',label:'GLTX-JY-27-A'}];
  protectDiagramLabels({elements:()=>records.map(row=>({data:(key,...value)=>value.length?(row[key]=value[0]):row[key]}))});
  assert.deepEqual(records.map(row=>row.id), ['behavior:internal-1','edge:internal-2','edge:internal-3','lane:internal-4']);
  assert.deepEqual(records.map(row=>row.label), ['采购申请','名称或说明待核对','名称或说明待核对','GLTX-JY-27-A']);
});
