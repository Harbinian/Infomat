# V7预览核对与原生正式基础迁移说明

## 0. 当前执行状态

截至2026-08-26，正式库M1、M2迁移记录与目标结构经当前只读检查一致，正式V7业务记录为0；原有8个主档、16个草稿、13个版本及已知历史例外只作当前基线保留。现有备份恢复、M0和隔离演练均形成于M1、M2首次执行之后，且不能替代本次状态机和迁移代码对应的隔离验收。本轮未启动3000，未开启V7预览或正式开关，也未配置试点`process_ref`。新的全库备份恢复、隔离MySQL验收和真实脱敏流程试点均待分别批准，不能把当前状态写成已经部署或已经完成业务验收。

## 1. 影响范围

M1新增四张V7预览核对表和对应索引、约束。M2增加正式主档`process_ref`、审核正文绑定、V7可空正式投影和提升审计表。两次迁移均不转换或补写现有V3业务数据。

## 2. 执行前检查

1. 运行`npm run inspect:process-v7-m0`，记录目标、版本、隔离级别、正式三表数量、结构差异、引用例外和稳定摘要。
2. 执行`npm run rehearse:process-v7-m0-backup-restore`，取得完整备份，并在专用临时数据库中恢复和核对全部对象数量、结构语义摘要及正式三表摘要。
3. 取得数据库变更的明确授权。没有授权时只允许评审代码、只读检查和隔离数据库演练。
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

M2只增加`process_ref`、V7审核正文绑定、V7可空正式投影和提升审计表，不创建V7业务行。执行后必须重新核对M0记录的8个主档、16个草稿、13个版本的数量和稳定摘要，并确认历史例外没有被补写。

M2 dry-run在`m1_preview_foundation`中原样返回M1的`migration_recorded`、`applied`和`consistency_status`，并通过`ready_for_m2`和M2顶层`ready_for_apply`表示是否允许进入应用。M2在任何建表、加列或加索引之前都会重新检查M1。只有M1的`consistency_status`为`applied`时才继续；其他五种状态返回`V7_FORMAL_M1_NOT_APPLIED`，M2不执行任何数据库结构变更。

当前只读检查结果：M1、M2迁移记录已存在，目标列、索引和表与预期结构摘要一致；正式V7案例、草稿、版本、审核正文绑定和提升审计仍为0。本轮没有执行迁移写入。

## 5. 回退

```powershell
npm run migrate:process-v7-preview:rollback
```

只有四张表均为空时，回退才删除表和迁移记录。任一表已有业务记录时，脚本停止并列出记录数，不自动删除或清空；运维人员应先保留数据，再制定单独迁移或停用方案。

M2只在`process_v7_promotions`为空、正式草稿和版本中没有V7数据、审核任务没有V7正文绑定时允许执行：

```powershell
npm run migrate:process-v7-formal:rollback
```

任一V7正式记录存在时，不删除结构。应关闭`PROCESS_V7_FORMAL_ENABLED`，保留只读数据，再制定补偿方案。MySQL DDL不是可整体回滚的事务；中断后必须先比对现有列、索引、外键和表，再续跑或在空表条件下反向删除。

## 6. 隔离演练

取得新的全库备份恢复批准并完成备份验证后，`npm run rehearse:process-v7-migrations-isolated`才能从该备份恢复专用临时数据库，依次验证M1部分结构时停止应用、M1干净应用和重复应用、M2部分DDL恢复、重复提升幂等、内容变化后重新打开、过期提升拒绝、退回修改后同一草稿重新提升、过期审核摘要拒绝、正式审核与发布、双并发发布一成一拒、`process_version_id`读回、预览响应不泄露正式正文、空表回退和正式V3摘要不变。隔离演练通过不等于V7业务试点完成。以前的演练证据不能代替本次状态机和迁移代码修改后的新验证。

正式 V7 阶段不直接调用仓储的提交、审核或发布方法。脚本只监听`127.0.0.1`的临时端口，通过公开 Express 路由和临时会话发送请求；每个请求都携带`expected_revision_no`和`expected_content_hash`。路由在事务内从隔离恢复库重新读取账号状态、角色、权限、部门范围和`auth_version`。脚本在创建任何预览或正式业务记录前，选择相互分离的归口部门`department_contact`、归口部门`department_mdm_reviewer`和全局`mdm_lead`账号；找不到完整组合时以`V7_ISOLATED_FORMAL_ACTORS_REQUIRED`停止，证据只记录缺少的角色代码，不记录人员姓名。

## 7. 当前停点

正式库只有管理员和一个没有有效治理角色的普通账号处于启用状态，无法由现有身份完成归口部门、承接部门、MDM工作组和正式审核的职责分离。未审核的仓库外文件不能由技术人员代填部门结论。因此当前只能确认“M1/M2结构已准备且只读检查一致”；本次代码对应的新备份恢复和隔离MySQL验收尚未执行，真实脱敏V7业务试点也未开始。本轮未启动3000、未开启V7开关、未配置试点`process_ref`。在取得数据库动作、运行配置和人员授权的分别批准前，正式库不得写入试点V7业务记录。
