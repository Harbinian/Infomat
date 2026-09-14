# V7预览核对与原生正式基础迁移说明

## 0. 当前执行状态

2026-09-10第06阶段只授权本地整改和自有隔离MySQL中的合成验证。正式数据库未连接，当前M1/M2登记、人员、业务数量及恢复点均未核验；正式旧数据恢复仍未完成。最新步骤及证据边界见[上线发布与恢复第10节](../../../docs/plans/2026-09-09-mdm-3000-launch/03-发布与恢复.md#10-第06阶段迁移核对与恢复)。

历史记录：2026-08-26曾记载正式库M1/M2结构与登记一致、V7为0，以及8个主档、16个草稿、13个版本。这些数量及当时账号状态只用于追溯，不能作为本次目标或门槛。旧备份和旧隔离演练不能证明当前工作区、当前正式库或真实旧数据可恢复。

## 1. 影响范围

M1新增四张V7预览核对表和对应索引、约束。M2增加正式主档`process_ref`、审核正文绑定、V7可空正式投影和提升审计表。两次迁移均不转换或补写现有V3业务数据。

## 2. 执行前检查

1. 先审查准确目标和授权。`inspect:process-v7-m0`会加载固定配置和私有env，不得因只读名称而直接运行。没有正式读取授权时，使用`prepare:launch-stage06 -- --output <新建的本地输出目录>`生成查询及待填报告；显式目标只读入口为`inspect:launch-stage06`，见上线说明。
2. 正式备份另需准确目标、时间、受控位置和备份授权。旧`rehearse:process-v7-m0-backup-restore`固定源容器及`infomat_mdm`，默认写用户Documents备份目录，必须先重新核对并批准这些目标。本阶段不运行该入口。备份只恢复到独立临时实例，验证成功后才依赖它演练迁移。
3. 数据库只读、备份和变更分别取得对应授权。没有正式授权时仅评审代码、准备查询及执行本轮自有合成隔离验证。
4. 运行`npm run migrate:process-v7-preview:dry-run`和`npm run migrate:process-v7-formal:dry-run`，确认受控配置加载成功、目标脱敏显示，并记录待建对象。
5. 确认应用代码和迁移脚本来自同一提交；脏工作区只能用于候选验证，不能作为正式发布来源。M1、M2历史上已经按用户明确授权执行；本轮不执行M1/M2 apply、rollback或新的DDL，当前候选代码也未部署。

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
- 上传一个测试V7后只增加预览核对专用表记录。

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

M2只在`process_v7_promotions`为空、正式草稿和版本中没有V7数据、审核任务没有V7正文绑定时允许执行：

```powershell
npm run migrate:process-v7-formal:rollback
```

任一V7正式记录存在时，不删除结构；按另行批准的运行操作受控停用并保留数据，再制定补偿方案。M2回退在任何DDL前要求登记与结构匹配，并检查历史版本的`l1_name/l2_name/l3_name/content_json`是否含旧结构不能容纳的空值；发现时返回`V7_FORMAL_ROLLBACK_LEGACY_NULLS`，不先删提升表再失败。MySQL DDL不是可整体回滚的事务；中断后先核对准确对象和恢复点，不直接重跑初始化或删除登记。

## 6. 隔离演练

第06阶段合成入口为`npm run test:stage06-mysql-isolated`。复用现有M0检查、M1/M2及会话迁移实现和第04阶段真实登录HTTP场景；备份由本轮新建合成源产生，恢复到另一自有实例后才演练迁移。该命令不接收正式备份、不读取固定配置，不沿用真实人员。下述旧备份入口保留历史用途，不能作为本次默认命令或全链路证明。

以下描述旧`rehearse:process-v7-migrations-isolated`的原演练设计，不表示当前可直接使用：它从指定备份恢复，演练M1部分结构、M2部分DDL、提升与再办、审核、发布及空表回退。该入口默认历史备份、使用恢复身份及临时头部会话，且提升和部分读回直接调用仓储，与当前完整登录/会话要求不同。取得真实备份授权后仍须重新审查并适配当前已应用M1/M2、真实身份隔离和清理条件，再单独验证；不得直接运行以替代本轮全HTTP技术证据或业务验收。

正式 V7 阶段不直接调用仓储的提交、审核或发布方法。脚本只监听`127.0.0.1`的临时端口，通过公开 Express 路由和临时会话发送请求；每个请求都携带`expected_revision_no`和`expected_content_hash`。路由在事务内从隔离恢复库重新读取账号状态、角色、权限、部门范围和`auth_version`。脚本在创建任何预览或正式业务记录前，选择相互分离的归口部门`department_contact`、归口部门`department_mdm_reviewer`和全局`mdm_lead`账号；找不到完整组合时以`V7_ISOLATED_FORMAL_ACTORS_REQUIRED`停止，证据只记录缺少的角色代码，不记录人员姓名。

## 7. 当前停点

当前正式账号及授权未知，不再引用2026-08-26账号数量作为当前结论。未审核材料不能由技术人员代填部门意见。第06阶段完成本地及合成验证后停止，正式旧数据恢复、部署拓扑、真实人员、人工中文输入法和业务验收继续待完成；不进入第07阶段，不开启真实试点。准确交接见[执行交接](../../../docs/plans/2026-09-09-mdm-3000-launch/04-执行交接.md)。
