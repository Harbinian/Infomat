# MDM MySQL 迁移数据影响审计

> 日期：2026-06-18  
> 范围：`apps/mdm-platform` 本地 SQLite 运行库与 Docker MySQL `infomat_mdm` 当前状态  
> 结论类型：只读审计；未执行恢复、补迁或删除操作

## 结论

当前现象不是旧 SQLite 数据被物理删除，而是运行态读模型已切到 MySQL，但 MySQL 没有承接旧 SQLite 的完整业务数据。

当前环境中：

- `MDM_IDENTITY_READ_MODEL=mysql`
- `PROCESS_GOVERNANCE_READ_MODEL=mysql`
- MySQL 目标库：`127.0.0.1:3307 / infomat_mdm`
- 旧 SQLite：`apps/mdm-platform/data/platform.db`

因此，MDM 平台在身份、流程治理等入口读取 MySQL 时，会看到一个基本空的 MySQL 运行态；旧 SQLite 中的用户和流程治理数据仍存在，但当前读模型不会使用它们。

## 关键计数对比

| 数据域 | SQLite `platform.db` | MySQL `infomat_mdm` | 判断 |
|---|---:|---:|---|
| 用户 `users` | 81 | 1 | 旧用户仍在 SQLite，未进入 MySQL |
| 用户角色 `user_roles` | 89 | 1 | 旧角色绑定仍在 SQLite，未进入 MySQL |
| 部门 `departments` | 10 | 10 | 两边都有，但 ID 顺序不同，补迁不能直接复制外键 |
| 流程快照 `process_governance_snapshots` | 12 | 5 | MySQL 有快照，但不是完整旧运行态 |
| 流程节点 `process_governance_nodes` | 20481 | 9170 | MySQL 有 Sankey 节点导入 |
| 流程边 `process_governance_edges` | 37484 | 16625 | MySQL 有 Sankey 边导入 |
| A1 明细 `process_a1_items` | 5451 | 0 | MySQL 未承接 A1 明细表 |
| 流程映射记录 `process_mapping_records` | 721 | 0 | MySQL 未承接映射记录读模型 |
| 映射待办 `process_mapping_todos` | 418 | 0 | MySQL 未承接流程映射待办 |
| 质量问题 `process_governance_quality_cases` | 3791 | 0 | MySQL 未承接质量问题 |
| 质量事件 `process_governance_quality_case_events` | 20717 | 0 | MySQL 未承接质量事件 |
| 旧映射 `mappings` / `mdm_mapping_records` | 1 | 0 | 旧映射审批数据未补迁 |
| 字段台账 `field_entries` / `data_map_fields` | 2 | 0 | 旧字段数据未补迁 |
| 字段冲突 `field_conflicts` / `mdm_field_conflicts` | 1 | 0 | 旧冲突数据未补迁 |
| 术语 `terms` / `terminology_terms` | 0 | 0 | 两边都无旧术语数据 |

MySQL 中还存在少量非旧库数据：

- `process_candidate_review_runs`: 1
- `process_candidate_review_items`: 1
- `data_map_objects`: 2
- `mdm_todos`: 2

这些属于近期 MySQL 功能验证或候选复核导入，不代表旧 SQLite 数据已完整迁移。

## 旧 SQLite 数据是否还在

`apps/mdm-platform/data/platform.db` 当前仍包含：

- 81 个用户
- 89 条用户角色绑定
- 721 条流程映射记录
- 418 条流程映射待办
- 3791 条流程治理质量问题
- 20717 条质量事件

核心表的最大业务时间集中在 2026-06-12 之前，说明本轮 MySQL 收口测试没有把这些旧业务行清空或重建为测试数据。

仓库中还存在旧备份：

- `apps/mdm-platform/data/platform.before-roster-users-20260611-143925.db`

该备份只有 3 个用户，是花名册导入前状态，不是当前 81 个用户状态的完整备份。

## 脚本审计

本轮涉及的 MySQL 初始化脚本：

- `apps/mdm-platform/scripts/init-mysql-schema.js`

行为：

- 执行 `CREATE TABLE IF NOT EXISTS ...`
- 写入或更新 `schema_migrations`
- 种子术语类型

未发现：

- `DELETE FROM users`
- `TRUNCATE users`
- `DROP TABLE users`

真实 MySQL smoke：

- `smoke-data-map-mysql.js` 只删除按本次 smoke 随机 key 创建的 Data Map 测试行。
- 一次性审计表 smoke 写入 `mdm_change_sets` / `mdm_version_log` 后已按随机 `entity_type/entity_id` 清理。

流程治理 MySQL 导入：

- `processGovernanceMysqlRepository.replaceActiveReadModel()` 会把 MySQL 中旧 active 快照标记为 archived。
- 它不会读取 SQLite，也不会删除 SQLite。
- 当前 MySQL 导入主要承接 Sankey 节点、边、源文件、MDM 要求和证据引用；旧 SQLite 中的 A1 明细、流程映射记录、质量问题和映射待办没有被补迁。

身份/花名册：

- `import-roster-users.js` 当前仍使用 `server/db`，即 SQLite 路径。
- 当前没有发现已落地的“SQLite 用户到 MySQL 用户”补迁脚本。

## 根因

计划中多次明确“旧 SQLite 本地库不迁移”，但后续本地环境又启用了：

- `MDM_IDENTITY_READ_MODEL=mysql`
- `PROCESS_GOVERNANCE_READ_MODEL=mysql`

这使平台开始读取 MySQL。由于 MySQL 没有完整补迁旧运行态数据，结果表现为：

- 用户看起来被清空；
- 流程治理待办、质量问题、A1 明细、映射记录看起来缺失；
- Data Map、旧映射、冲突等新 MySQL 表基本为空。

从现有证据看，这是“切库后数据不可见 / 未补迁”，不是“旧库被删除”。

## 风险

1. 如果继续在 `MDM_IDENTITY_READ_MODEL=mysql` 下使用平台，旧 SQLite 用户不会出现在登录、角色、权限接口中。
2. 如果继续在 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 下使用平台，旧 SQLite 的流程治理待办、质量问题和映射记录不会出现在流程治理接口中。
3. MySQL 与 SQLite 的部门 ID 顺序不同，不能直接复制 `users.department_id` 或其他外键，必须按部门编码或部门名称重建关系。
4. 旧 SQLite `platform.db` 是未跟踪运行态文件，不应被当作长期真源；补迁前应先做本地备份和 MySQL dump。

## 建议恢复路径

短期止血：

1. 临时关闭 `MDM_IDENTITY_READ_MODEL=mysql` 和 `PROCESS_GOVERNANCE_READ_MODEL=mysql`，让平台继续读取旧 SQLite。
2. 立即备份当前 `apps/mdm-platform/data/platform.db`。
3. 对当前 MySQL 做一次 dump，保留迁移后状态。

正式补迁：

1. 写只读审计脚本，生成 SQLite -> MySQL 的逐表补迁清单。
2. 先迁身份域：
   - `users`
   - `user_roles`
   - 必要角色和权限
   - 部门外键按 `departments.code` 或部门名称映射，不直接复制 ID。
3. 再迁流程治理运行态：
   - `process_a1_items`
   - `process_mapping_records`
   - `process_mapping_todos`
   - `process_mapping_todo_events`
   - `process_governance_quality_cases`
   - `process_governance_quality_case_events`
4. 最后评估是否迁旧映射、旧字段、旧冲突：
   - `mappings`
   - `field_entries`
   - `field_conflicts`
   - `approval_history`
   - `version_log`

保护措施：

1. 增加启动前 read-model readiness 检查：当 `MDM_IDENTITY_READ_MODEL=mysql` 但 MySQL 用户数低于阈值时，应提示未补迁，而不是静默进入空库。
2. 增加流程治理 readiness 检查：当 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 但 `process_mapping_records` 或质量问题为空时，应提示当前 MySQL 读模型不完整。
3. 未来真实 MySQL smoke 必须使用随机 key 并只清理自身创建的行，不得清理业务表。
