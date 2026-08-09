# 单流程治理v3表单状态迁移手册

## 1. 迁移范围

本迁移处理MySQL中的`process_design_drafts.process_content_json`和`process_design_versions.process_content_json`。目标是把仍在使用v1或v2的完整单流程JSON规范化为`process-governance-v3`，为每张历史表单补充`form_design_state=unspecified`，并同步更新`schema_version`和`content_hash`。

迁移不修改3001源文件，不根据表单名称、编号、字段类型或明细数量推断现状表单和拟设计表单，不拆建物理数据库表，也不改写字段、主明细分组、顺序或技术标识。

## 2. 发布前检查

3001、MDM和MDM-AI助手必须从同一个已提交版本启动。先运行：

```powershell
npm --prefix apps/structured-output-service test
npm --prefix apps/mdm-platform run test:process-governance-v3-migration
npm --prefix apps/mdm-platform run test:process-design
npm --prefix apps/structure-assistant test
npm --prefix apps/mdm-platform run migrate:process-governance-v3:dry-run
```

dry-run只读取数据，输出草稿数、发布版本数、待迁移数量和不能无损转换的对象。`manual_objects`不为空时必须停止；负责人先修复列出的JSON，不得用默认业务事实掩盖错误。

## 3. 执行迁移

指定可追溯批次执行：

```powershell
npm --prefix apps/mdm-platform run migrate:process-governance-v3:apply -- --batch=pg-v3-YYYYMMDD-HHMM
```

迁移在同一事务中完成批次备份、JSON更新、结构版本更新、摘要更新和迁移标记写入。任一更新失败时事务整体回滚。成功输出中的`backup_batch`是恢复依据，必须随发布记录保存。

迁移使用`process_design_governance_migration_backups`保存每行原有的结构版本、完整JSON和内容摘要。重复执行同一版本迁移时不重复改写；已经是v3且摘要一致的行不会进入待变更清单。

## 4. 迁移后核对

再次运行dry-run，并核对：

- `pending_changes`为0；
- `manual_objects`为空；
- 所有已迁移草稿和发布版本的`schema_version`为`process-governance-v3`；
- 每张从v1或v2迁移的表单都有`form_design_state=unspecified`；
- v3原有的`current_state`和`proposed_design`保持不变；
- `form_ref`、`area_ref`、`item_ref`、字段内容、主明细数量和顺序与迁移前一致；
- `content_hash`与规范化v3内容重新计算结果一致。

完成数据核对后，运行根服务烟测。只有3001、MDM和MDM-AI助手的结构版本、结构摘要和Git提交一致时，才能启用v3页面。

## 5. 按批次恢复

尚未产生需要保留的迁移后业务写入时，使用成功输出中的批次号恢复：

```powershell
npm --prefix apps/mdm-platform run migrate:process-governance-v3:rollback -- --batch=pg-v3-YYYYMMDD-HHMM
```

恢复会在事务中把草稿和发布版本的原结构版本、完整JSON及内容摘要写回，并移除本次迁移标记。找不到批次备份时停止，不执行部分恢复。恢复后重新运行dry-run和流程治理测试，确认待迁移数量回到执行前状态。
