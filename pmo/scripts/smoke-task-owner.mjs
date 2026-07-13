import assert from 'node:assert/strict';

import { resolveTaskOwner } from '../gantt-react/src/utils/taskOwnerUtils.js';

const cases = [
  [{ department: '信息化项目组', wbs: '1.1.1', name: '项目启动会准备' }, '刘春含'],
  [{ department: '基础设施工作组', wbs: '2.5.1', name: '基础设施-方案评审材料准备' }, '方嵩荐'],
  [{ department: 'PLM工作组', wbs: '6.1.1', name: 'PLM内部调研与问题清单' }, '池炳辉、常云龙'],
  [{ department: 'MDM工作组', wbs: '3.1.1', name: '组织/部门/岗位/人员标准-现状盘点' }, '张广懿'],
  [{ department: 'MES工作组', wbs: '8.1.1', name: 'MES/低代码平台需求清单' }, '范秋南'],
  [{ department: 'ERP·OA工作组', wbs: '2.10.1', name: 'ERP服务器现状资源评估与扩容需求确认' }, '李雪'],
  [{ department: 'ERP·OA工作组', wbs: '2.11.1', name: 'OA系统采购需求确认与边界梳理' }, '陈娟'],
  [{ department: 'ERP·OA工作组', wbs: '7.1.6', name: 'ERP/OA需求冻结' }, '李雪、陈娟'],
  [{ department: '未知工作组', wbs: '9.9.9', name: '临时任务' }, '-'],
];

for (const [task, expected] of cases) {
  assert.equal(resolveTaskOwner(task), expected, `${task.department} ${task.wbs}`);
}

console.log(`task owner mapping smoke passed (${cases.length} cases)`);
