# 原生流程预览核对与正式基础迁移说明

## 1. 当前适用范围

M1/M2是现行原生V8及受支持V7预览、提升和正式治理的基础结构。迁移键、表名、脚本和错误码保留V7兼容命名，不因此限制正文版本。迁移只准备结构，不转换旧V3数据，不创建业务行，不开启功能。

本指南不预设目标库的迁移状态、业务数量、当前账号或恢复点。执行前按具体目标取得读取、备份及变更所需授权，并保存当前结构、迁移登记、稳定标识和内容摘要基线。历史阶段结论与旧备份仅用于追溯，不能证明当前目标可恢复。

## 2. 执行前检查

1. 先审查准确目标和授权。`inspect:process-v7-m0`会加载固定配置和私有env，不得因只读名称而直接运行。没有正式读取授权时，使用`prepare:launch-stage06 -- --output <新建的本地输出目录>`生成查询及待填报告；显式目标只读入口为`inspect:launch-stage06`，见上线说明。
2. 正式备份另需准确目标、时间、受控位置和备份授权。旧`rehearse:process-v7-m0-backup-restore`固定源容器及`infomat_mdm`，默认写用户Documents备份目录，必须先重新核对并批准这些目标。该入口不得在未核对目标和授权时运行。备份只恢复到独立临时实例，验证成功后才依赖它演练迁移。
3. 数据库只读、备份和变更分别取得对应授权。没有正式授权时仅评审代码、准备查询及执行自有合成隔离验证。
4. 运行`npm run migrate:process-v7-preview:dry-run`和`npm run migrate:process-v7-formal:dry-run`，确认受控配置加载成功、目标脱敏显示，并记录待建对象。
5. 确认应用代码和迁移脚本来自同一提交；脏工作区只能用于候选验证，不能作为正式发布来源。是否已应用或部署须按目标实例和发布记录核对。

M0不写正式数据库。备份恢复只允许在专用临时数据库中执行；脚本完成后应移除临时容器或实例。

M1预检结果固定返回`migration_recorded`、`applied`和`consistency_status`。`consistency_status`只允许以下六个值：

| 状态 | 含义 | `--apply`处理 |
|---|---|---|
| `not_applied` | 无迁移记录，四张表均不存在 | 经授权后可建表并写入记录 |
| `applied` | 迁移记录存在，四张表完整且结构匹配 | 幂等返回，不重建表 |
| `record_without_structure` | 迁移记录存在，但缺少一张或多张表 | 停止，不删记录、不自动补表 |
| `structure_without_record` | 四张表完整匹配，但缺少迁移记录 | 停止，不自动补记录 |
| `schema_drift` | 已存在表的结构与目标结构不一致 | 停止，只报告差异 |
| `partial_structure` | 无迁移记录，但只存在部分且结构匹配的表 | 停止，不自动补表 |

`npm run init:mysql`不创建M1四张表，也不写入`2026-08-24-process-v7-preview-review`迁移记录。M1只能通过专用迁移入口执行。

## 3. M1应用

```powershell
npm run migrate:process-v7-preview:apply
```

只有预检结果为`not_applied`或`applied`时，迁移入口才能继续。`applied`可重复执行并幂等返回；其他不一致状态必须由运维人员保留证据并另行制定处理方案。

## 4. M1执行后核对

- 四张目标表均存在；
- `schema_migrations`存在`2026-08-24-process-v7-preview-review`；
- 现有`process_design_drafts`和`process_design_versions`记录数与执行前一致；
- 分别上传原生V8及受支持V7测试副本后只增加预览核对专用表记录。

M1通过并重新取得M2授权后，才执行：

```powershell
npm run migrate:process-v7-formal:apply
```

M2只增加`process_ref`、V7审核正文绑定、V7可空正式投影和提升审计表，不创建V7业务行。执行后核对本次经授权读取的主档、草稿、版本、审核及事件数量、稳定标识和摘要；历史审核缺少的绑定保持空值，不补造依据。

M2 dry-run在`m1_preview_foundation`中原样返回M1的`migration_recorded`、`applied`和`consistency_status`，并通过`ready_for_m2`和M2顶层`ready_for_apply`表示是否允许进入应用。M2在任何建表、加列或加索引之前都会重新检查M1。只有M1的`consistency_status`为`applied`时才继续；其他五种状态返回`V7_FORMAL_M1_NOT_APPLIED`，M2不执行任何数据库结构变更。

M2的`applied`保留“迁移登记存在”的原含义，并新增`structure_complete`、`consistency_status`和`business_usage`供维护核对。只有登记及结构完整匹配时重复应用才直接返回；登记存在但缺结构时返回`V7_FORMAL_MIGRATION_INCONSISTENT`，不补建。列默认值、扩展属性及索引前缀、类型、可见性、方向不匹配时按漂移拒绝。无登记且已有V7业务使用时返回`V7_FORMAL_UNRECORDED_NONEMPTY`，不自动认领。无登记、无V7使用且已有部分兼容DDL时仍可显式续接；必须先核对中断来源和恢复点。`ready_for_apply`不是变更授权。

## 5. 回退

```powershell
npm run migrate:process-v7-preview:rollback
```

只有四张表均为空时，回退才删除表和迁移记录。任一表已有业务记录时，脚本停止并列出记录数，不自动删除或清空；运维人员应先保留数据，再制定单独迁移或停用方案。

M2只在`process_v7_promotions`为空、正式草稿和版本中没有原生V8/V7数据、审核任务没有V7正文绑定时允许执行：

```powershell
npm run migrate:process-v7-formal:rollback
```

任一受支持原生正式记录存在时，不删除结构；按另行批准的运行操作受控停用并保留数据，再制定补偿方案。M2回退在任何DDL前要求登记与结构匹配，并检查历史版本的`l1_name/l2_name/l3_name/content_json`是否含旧结构不能容纳的空值；发现时返回`V7_FORMAL_ROLLBACK_LEGACY_NULLS`，不先删提升表再失败。MySQL DDL不是可整体回滚的事务；中断后先核对准确对象和恢复点，不直接重跑初始化或删除登记。

## 6. 隔离验证与证据

合成验证入口为`npm run test:stage06-mysql-isolated`，会创建自有临时MySQL并执行备份、恢复和迁移演练；须先核对源脚本及隔离条件。它不证明正式旧数据可恢复。

旧`rehearse:process-v7-migrations-isolated`涉及历史备份、恢复身份及临时会话，须在取得对应备份授权后重新审查目标和身份隔离，不能直接替代当前完整HTTP、会话及事务资格验证。原生格式必须分别覆盖V8及受支持V7，正式写入使用公开路由、准确修订和内容摘要，不代填业务意见。

实际运行、真实旧数据恢复、人工中文输入法及业务验收分别登记；只有取得对应证据后才确认。

## 历史追溯

整理前原文、阶段记录和已废止说明保留在[历史快照](../../../docs/archives/2026-10-09-leaf-docs/apps/mdm-platform/docs/Process-V7-Preview-Review-Migration-Runbook.md.before.txt)。仅在核对决策依据、兼容或历史问题时读取；它不覆盖本文的当前说明。
