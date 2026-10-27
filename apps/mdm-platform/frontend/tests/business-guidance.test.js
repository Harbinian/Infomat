import test from 'node:test';
import assert from 'node:assert/strict';
import {businessDateTime,historicalPersonName,responsibilityGuidance} from '../src/businessGuidance.js';

test('display time converts explicit offsets and does not invent missing time zones',()=>{
 assert.equal(businessDateTime('2026-10-21T06:49:39.762Z'),'2026-10-21 14:49:39（北京时间）');
 assert.equal(businessDateTime('2026-10-21T14:49:39+08:00'),'2026-10-21 14:49:39（北京时间）');
 assert.equal(businessDateTime('2026-10-21 10:00:00'),'2026-10-21 10:00:00（时区未记录）');
 assert.equal(businessDateTime(null),'时间未记录');
 assert.equal(businessDateTime('INTERNAL_TIMESTAMP_99'),'时间暂无法确认，请核对原记录');
 assert.equal(businessDateTime('2026-13-21T06:00:00Z'),'时间暂无法确认，请核对原记录');
});
test('historical names never fall back to current names or identifiers',()=>{
 assert.equal(historicalPersonName({assignee_person_id:900123,assignee_user_id:81,current_name:'现任人员'}),'历史姓名未记录');
 assert.equal(historicalPersonName({assignee_name:'当时的合成人员',assignee_person_id:81}),'当时的合成人员');
});
test('guidance uses explicit appointment action and preserves business role limits',()=>{
 const input={target_type:'case',assignment_kind:'owner',process_name:'合成材料核对流程',target_id:'9007199254740999'};
 const original=structuredClone(input),owner=responsibilityGuidance(input),appoint=responsibilityGuidance({...input,appointment_action:'assign_owner'});
 assert.match(owner.instruction,/不增加部门最终确认权/);assert.notEqual(owner.action,appoint.action);
 assert.match(appoint.instruction,/本次办理依据/);assert.match(responsibilityGuidance({...input,assignment_kind:'steward'}).instruction,/治理经办内容|经办内容/);
 assert.match(responsibilityGuidance({person_name:'某位负责人',target_id:81}).instruction,/不推定/);
 assert(!JSON.stringify(owner).includes(input.target_id));assert.deepEqual(input,original);
});
