# 信息表收集服务数据库说明

## 1. 数据边界

本应用与 3000 共用 `infomat_mdm` 数据库，但只读取 `person`、`user_accounts`、`departments`。本应用只写入 `collection_*` 表，不修改 3000 的角色、权限和治理业务表。

## 2. 表与责任

| 表 | 保存内容 | 关键约束 |
|---|---|---|
| `collection_schema_migrations` | 本应用迁移记录 | `migration_key` 唯一 |
| `collection_app_grants` | 管理员和部门设计者授权 | 人员、角色和范围唯一；最后一名管理员不能撤销 |
| `collection_sessions` | 4000/4001 持久会话 | 只保存令牌哈希；核对 `auth_version` |
| `collection_forms` | 当前可编辑设计稿 | 归属部门和修订号 |
| `collection_form_versions` | 发布时不可变结构 | 表单和版本号唯一 |
| `collection_tasks` | 一次收集任务 | 发布请求标识幂等；状态受控 |
| `collection_task_targets` | 填报人员及发布快照 | 任务和人员唯一 |
| `collection_submissions` | 本人当前答卷 | 任务和人员唯一；修订号并发控制 |
| `collection_submission_versions` | 历次正式提交 | 答卷和提交次数唯一 |
| `collection_files` | 附件元数据与安全状态 | 随机存储键唯一；正文不进 MySQL |
| `collection_audit_events` | 授权、发布、提交、查看和导出事件 | 不保存完整答案或附件内容 |

所有外键使用 `ON DELETE RESTRICT`。服务不提供物理删除接口。

## 3. 迁移

实施人员先执行 dry-run。dry-run 只读取 `information_schema`，确认身份字段和计划表名，不创建表。apply 使用幂等 `CREATE TABLE IF NOT EXISTS` 并写入迁移键 `information-collection-v1-2026-08-10`。

初次迁移只新增表，不修改现有表。后续迁移必须先备份 MySQL 和附件目录，并提供 dry-run、数量核对、引用核对和补偿步骤。含业务数据的 `collection_*` 表不得由回滚脚本直接删除。
