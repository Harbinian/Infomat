# 流程治理统一入口与跨部门承接迁移手册

## 1. 目标

迁移分两步：

1. 把现有`process_design_cross_dept_handoffs`升级为同时保存前置输入和后续承接的统一结构，迁移键为`2026-07-31-cross-dept-handoff-v2`。
2. 增加完整流程JSON、草稿修订、承接冲突和只追加事件，迁移键为`2026-07-31-process-governance-unified-entry`。

3001继续独立运行，不属于本迁移的停服或下线对象。

## 2. 安全边界

- 使用仓库固定MySQL配置，不临时改端口或数据库名。
- 不打印密码或本地环境文件内容。
- 先执行dry-run，再备份，再执行apply。
- 脚本可重复执行；迁移键已存在时返回当前核对结果，不重复改写。
- 不删除备份表。失败补偿只恢复本次批次记录，并在执行前核对批次标识。

## 3. 执行命令

在`apps/mdm-platform`目录运行：

```powershell
npm run migrate:cross-dept-handoff-v2:dry-run
npm run migrate:cross-dept-handoff-v2:apply
npm run migrate:process-governance-unified:dry-run
npm run migrate:process-governance-unified:apply
```

需要查看指定备份批次或执行补偿时：

```powershell
node scripts/migrate-cross-dept-handoff-v2.js --compensate --batch <backup_batch>
npm run migrate:process-governance-unified:rollback
npm run migrate:process-governance-unified:compensate
```

补偿属于破坏性恢复动作，只能对已核对的精确批次执行。已经产生新承接修订、问题项、决定或受控导入记录后，不直接覆盖，应按业务记录执行补偿并保留审计。

## 4. dry-run检查

确认输出包含：

- 当前承接记录总数；
- 旧状态分布；
- 缺失的v2列；
- 当前结构约束；
- 迁移是否已登记；
- 不完整引用和无效方向数量。

dry-run不得创建表、增加列、修改状态或登记迁移。

## 5. apply步骤

脚本按下列顺序执行：

1. 锁定并检查迁移键。
2. 创建备份表并按批次复制现有承接记录。
3. 增加v2字段和辅助索引。
4. 移除旧状态检查约束。
5. 将旧记录按兼容规则补齐方向、锚点、稳定标识、来源流程、修订号和当前标记。
6. 映射旧状态。
7. 建立v2状态与方向检查约束。
8. 创建受控导入审计表。
9. 登记迁移键。
10. 输出迁移后数量、状态和引用核对结果。

## 6. 迁移后核对

至少确认：

- 迁移前后记录总数相同；
- 每条旧记录均有`draft_id`、`handoff_ref`、`handoff_direction`、`source_process_ref`、`revision_no`；
- `is_current=1`的数量符合预期；
- 不存在无效方向或不支持状态；
- `process_design_processes.source_process_ref`和`process_design_steps.source_behavior_ref`可用于后续导入关联；
- 重复执行dry-run和apply不会新增或覆盖业务记录；
- 应用测试和服务烟测通过。

统一入口迁移另需核对：

- 草稿完整JSON取数优先级为已保存规范化JSON、现有结构化表重建、历史发布版本转换；
- 无法无损转换的对象列出对象编号、缺失字段和人工处理方法，停止该对象迁移，不填默认值；
- 草稿和版本的数量、内容哈希、修订号及稳定引用一致；
- 历史`rejected`已建立`pending_assignment`冲突，历史`escalated`已建立`pending_decision`冲突，原承接状态为`conflict_open`；
- 重复执行不重复创建冲突或事件；
- 迁移后发生新业务写入时，不允许整批回滚，只执行补偿并保留审计。

## 7. 当前本地演练记录

2026-07-31首次apply在增加列后遇到旧状态检查约束，事务内业务记录未改变。迁移顺序已调整为先移除旧约束，再映射状态。再次apply成功：

- 原记录：6条；
- 迁移后：6条；
- `pending_counterparty_detail`：2条；
- `pending_counterparty_review`：4条；
- 缺失关键列、缺失草稿引用、无效方向和无效修订：均为0。

该记录只说明当前本地演练结果。其他环境仍必须独立执行dry-run、备份和迁移后核对。

同日执行统一入口迁移的dry-run和apply，结果如下：

- 草稿总数：16；
- 已生成完整v2 JSON：16；
- 取数来源：13条由历史发布版本转换，3条由现有结构化表重建；
- 需要人工处理的对象：0；
- 备份批次：`2026-07-31-process-governance-unified-entry-20260731074228670`；
- apply后再次执行dry-run：迁移键已登记，16条草稿均有完整v2 JSON，缺失列和人工处理对象均为0；
- 冲突开放标记生成列和“同一承接最多一个未关闭冲突”唯一索引均已生效。

该批次仅用于当前本地环境的恢复核对。其他环境必须使用各自apply输出的备份批次，不得复制本批次标识执行回滚或补偿。
