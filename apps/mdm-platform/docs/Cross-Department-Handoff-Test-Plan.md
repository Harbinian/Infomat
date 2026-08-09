# 跨部门承接闭环测试说明

## 1. 3001结构与评分

覆盖：

- 前置输入和后续承接的创建、编辑和稳定引用；
- 待明确责任部门；
- 返回数据和本流程恢复行为；
- 前置输入箭头朝向本流程，后续承接箭头离开本流程；
- 每条承接五项评分；
- 无承接时按不适用获得5分；
- 外部门流程、行为、确认、完成标准、返回路径和证据缺口不扣当前编制人结构分；
- 评分前后JSON完全一致；
- v1导入、v2导出和v2重新导入；
- 原始源文件不变；
- 桌面和移动端侧栏及编辑区可操作。

命令：

```powershell
npm --prefix apps/structured-output-service test
```

## 2. MDM本地编制工作台

覆盖：

- 流程治理默认显示MDM本地的3001式工作台，旧分步表单不再显示；
- 新建、打开MDM草稿、导入3001文件、保存草稿、提交审核和导出备份；
- 左侧条目列表、稳定引用排序、结构化学习评分和跨职能流程图；
- `expected_revision`并发冲突和承接作废原因；
- 管理员只读，部门主对接人可以维护本部门草稿；
- 浏览器不使用`localStorage`、`sessionStorage`或IndexedDB保存流程内容；
- 桌面端和窄屏布局。

命令：

```powershell
npm --prefix apps/mdm-platform run test:process-governance-unified
npm --prefix apps/mdm-platform run test:process-governance-frontend
npm run smoke:infomat-services
```

## 3. 3000受控导入

覆盖：

- 预览零写入；
- v1、v2、v3服务端规范化，保存和导出统一为v3；
- 上传审核字段不可信；
- 审核哈希篡改返回409；
- 管理员业务写入返回403；
- 仅归口部门`department_mdm_reviewer`可以确认导入；
- MySQL事务内原子写入；
- 相同版本幂等返回；
- 内容变化生成新修订并重新审核；
- MDM直接保存完整v3 JSON时，同一事务同步治理投影和事件；
- 治理投影写入失败时，JSON修订、投影和事件全部回滚；
- 删除已有治理记录的承接时返回`HANDOFF_VOID_REASON_REQUIRED`，填写原因后只作废当前修订并保留历史；
- 未知部门进入`pending_assignment`。

命令：

```powershell
npm --prefix apps/mdm-platform run test:process-design
npm --prefix apps/mdm-platform run test:process-governance-unified
```

## 4. 承接待办与权限

覆盖：

- 分派、归口审核、外部门范围确认、外部门补充、外部门审核、结构卡口；
- `department_contact`只能补充本部门内容；
- 部门审核员不能代替另一部门决定；
- 最终负责人取当前部门配置；
- 操作同时校验角色、参与人、部门、`can_act`、状态和事项关联；
- 历史修订不能继续处理；
- 退回、拒绝和升级；
- 待办直接按承接状态和参与关系生成，不创建“待确认问题”第二事实；
- 故事链返回当前步骤、下一责任角色、里程碑、事件和关联冲突，不推测百分比；
- 进入冲突后仍保留此前已完成步骤，原责任步骤标记为冲突分支；下一步显示责任角色、部门和已分派处理人；
- 部门普通退回只返回上一责任步骤，不创建冲突；
- 冲突分派、方案记录、双方确认、结构卡口返回、项目决策三种结论；
- 存在未确认承接时发布被阻断。

命令：

```powershell
npm --prefix apps/mdm-platform run test:process-governance
npm --prefix apps/mdm-platform run test:role-workbench
npm --prefix apps/mdm-platform run test:role-workbench-mysql
npm --prefix apps/mdm-platform run test:rbac-raci-v2
```

## 5. 迁移与恢复

覆盖：

- dry-run零写入；
- 备份批次；
- 旧状态映射；
- 记录数、引用、方向、状态和修订核对；
- 重复执行；
- 失败后再次执行或按明确批次补偿。

命令：

```powershell
npm --prefix apps/mdm-platform run test:process-design
npm --prefix apps/mdm-platform run migrate:cross-dept-handoff-v2:dry-run
npm --prefix apps/mdm-platform run migrate:process-governance-unified:dry-run
```

## 6. 主线与浏览器验收

执行：

```powershell
npm --prefix apps/mdm-platform run test:frontend
npm --prefix apps/mdm-platform run test:project-roles
npm --prefix apps/mdm-platform run test:mainline
npm run start:infomat-services
npm run smoke:infomat-services
```

真实浏览器至少完成：

1. 确认3001首页和`/api/health`仍可访问，再分别导入v1、v2文件并导出v3。
2. 3000选择文件并完成预览，页面显示摘要、承接候选和哈希。
3. 非审核员只能预览；审核员填写依据后确认导入。
4. 角色工作台出现承接待办。
5. 归口部门与外部门分别完成各自动作和决定。
6. `mdm_lead`执行结构卡口。
7. 所有承接确认前发布被阻断，确认后承接卡口不再阻断。
8. 在MDM中保存完整v3 JSON；模拟旧修订保存返回409且不覆盖。
9. 部门拒绝后完成冲突分派、协调方案、双方确认；任一方不接受时完成项目决策。
10. 七个角色检查角色责任页、角色可见标签和多角色标签并集。

若测试环境没有对应真实身份，不得临时授予越权角色或使用管理员代办，应保留自动化接口证据并明确记录浏览器链路未完成的部分。
