import test from 'node:test';
import assert from 'node:assert/strict';
import {directoryIdentityValue,directoryDisplayValue,directoryRecordLabel,directoryHistoryTitle} from '../src/directoryIdentityPresentation.js';

test('identity fallbacks distinguish missing business numbers from content withheld by presentation rules',()=>{
  assert.equal(directoryIdentityValue(null),'工号未记录');
  assert.equal(directoryIdentityValue('1022HR085246'),'1022HR085246');
  assert.equal(directoryIdentityValue('SYNTHETIC_hr'),'工号暂无法展示，请核对原资料');
  assert.equal(directoryIdentityValue('SYNTHETIC_91','组织编码'),'组织编码暂无法展示，请核对原资料');
  assert.equal(directoryRecordLabel({person_name:'合成员工',employee_no:'1022HR085246'},true),'合成员工 · 1022HR085246');
  assert.equal(directoryRecordLabel({},true),'员工姓名未记录 · 工号未记录');
  assert.equal(directoryDisplayValue('员工工号','SYNTHETIC_hr'),'工号暂无法展示，请核对原资料');
  assert.equal(directoryDisplayValue('部门编码','DEPT_A',{departments:[{code:'DEPT_A',name:'当前名称'}]},true),'历史所属部门未记录');
});
test('history identifies its own saved action, name changes and number without borrowing current directory names',()=>{
  const row={source_file_name:'directory-change.json',history_summary:{entity:'person',operation:'update',before:{employee_no:'HR1022',person_name:'当时旧姓名'},after:{employee_no:'HR1022',person_name:'当时新姓名'}}},original=structuredClone(row);
  assert.equal(directoryHistoryTitle(row),'修改员工 · 当时旧姓名 → 当时新姓名 · HR1022');
  assert.deepEqual(row,original);
  assert.equal(directoryHistoryTitle({...row,history_summary:{entity:'person',operation:'create',after:{employee_no:'HR1022',person_name:'当时新姓名'}}}),'新增员工 · 当时新姓名 · HR1022');
});
test('old missing history stays explicit; imported source titles stay unchanged',()=>{
  assert.equal(directoryHistoryTitle({source_file_name:'directory-change.json',title:'人员目录直接维护'}),'人员目录直接维护（维护对象未记录）');
  assert.equal(directoryHistoryTitle({source_file_name:'directory-change.json',history_summary:{entity:'person',operation:null,before:{person_name:'仅存旧姓名'}}}),'维护员工 · 变更前：仅存旧姓名 · 工号未记录');
  assert.equal(directoryHistoryTitle({source_file_name:'旧花名册.xlsx',title:'2025年人员导入'}),'2025年人员导入');
});
