import test from 'node:test';
import assert from 'node:assert/strict';
import {directoryValue,directoryColumns,directoryFieldLabel} from '../src/directoryPresentation.js';

const snapshot={departments:[{id:'9007199254741001',code:'DEPT_A',name:'合成甲部'}],persons:[{person_id:'9007199254741002',employee_no:'EMP_A',person_name:'合成负责人'}],offices:[{id:'31',code:'OFF_A',name:'合成一室'},{id:'32',code:'OFF_B',name:'合成二室'}]};
test('directory differences distinguish recorded names, exact IDs, employee numbers and multiple office codes',()=>{
 assert.equal(directoryValue('department_name','合成甲部',snapshot),'合成甲部');
 assert.equal(directoryValue('department_code','DEPT_A',snapshot),'合成甲部');
 assert.equal(directoryValue('部门编码','DEPT_A',snapshot),'合成甲部');
 assert.equal(directoryValue('current_department_id','9007199254741001',snapshot),'合成甲部');
 assert.equal(directoryValue('manager_employee_no','EMP_A',snapshot),'合成负责人');
 assert.equal(directoryValue('manager_person_id','9007199254741002',snapshot),'合成负责人');
 assert.equal(directoryValue('office_codes','OFF_A; OFF_B',snapshot),'合成一室、合成二室');
 assert.equal(directoryValue('office_ids',['31','32'],snapshot),'合成一室、合成二室');
});
test('historical missing names never become current names or internal references',()=>{
 assert.equal(directoryValue('manager_employee_no','EMP_A',snapshot,true),'历史负责人姓名未记录');
 assert.equal(directoryValue('office_codes','OFF_A;OFF_B',snapshot,true),'历史办公室名称未记录');
 assert.equal(directoryValue('department_name','当时的部门',snapshot,true),'当时的部门');
 assert.equal(directoryValue('部门编码','DEPT_A',snapshot,true),'历史所属部门未记录');
 assert.equal(directoryFieldLabel('部门编码'),'所属部门');
 assert(!directoryValue('current_department_id','9007199254741001',{},true).includes('9007199254741001'));
});
test('historical table labels and statuses are readable without changing original columns or values',()=>{
 const content={headers:['employee_no','person_name','employment_status','person_id','历史备注'],rows:[['EMP_A','合成员工','active','9007199254741002','原备注']]},before=structuredClone(content);
 assert.deepEqual(directoryColumns(content.headers).map(column=>column.label),['员工工号','姓名','在职状态','历史备注']);
 assert.equal(directoryValue('employment_status',content.rows[0][2]),'在职');
 assert.deepEqual(content,before);
});
