# MDM 剩余业务域 MySQL 迁移计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Data Map 字段域已直接切换到 MySQL 后，继续清理 MDM 平台仍依赖 SQLite 的业务域，优先迁移术语、旧映射审批、冲突、通用待办、版本/活动日志。

**Current Baseline:** `master` 已快进合并 `codex/mdm-data-map-mysql-direct-cutover`。候选复核、流程治理 MySQL 分支、身份/RBAC MySQL 基础、Data Map 字段域 MySQL 直接切换已经落地。

**Architecture:** 新迁移域必须走 MySQL repository 和 repository factory 注入，不在路由中直写 SQL。权限继续使用 MySQL-aware 身份/RBAC helper。旧 SQLite 数据不迁移，不桥接；`better-sqlite3` 暂留给未迁移域和隔离测试。

---

## Summary

本阶段不再回头扩大候选复核或 Data Map 字段域。当前剩余风险集中在仍 `require('../db')` 的业务域中，尤其是 `terminology`、`mappings`、`conflicts`、`todos`、`versions`、`activity` 仍会读取或写入 SQLite `terms`、`field_entries`、`field_identities`、`change_set`、`version_log` 等遗留表。

迁移按依赖顺序推进：先术语，再旧映射审批，再冲突/待办/版本日志。人员、产品、分类、系统等主数据对象 CRUD 面积更大，本轮只登记为后续迁移对象，不抢占当前主线。

## Migration Order

- [x] **Task 1: Terminology domain**
  - 新增独立 MySQL 术语 schema 与 `terminologyMysqlRepository`。
  - `/api/terminology` 保持现有 API 路径和响应语义，但运行态不再读 SQLite `terms`。
  - 不将旧术语治理数据悄悄合并到 `data_map_terms`；`data_map_terms` 只服务字段命名规则和 Data Map 字段域校验。
  - 补 `test:terminology-mysql`，覆盖列表、创建、更新、审批、删除、禁用词/推荐词、权限和 MySQL 身份模式。

- [x] **Task 2: Legacy mapping approval domain**
  - 新增 `mappingMysqlRepository`，迁移旧 `/api/mappings` 审批运行态数据。
  - 保留旧基础映射审批 UI 和 API 形状，但字段台账默认入口仍是 Data Map context。
  - 旧 `mapping_id` 不再作为字段台账归属锚点；需要字段上下文时显式引用 `context_id`。
  - 补 `test:mappings-mysql`，覆盖创建、草稿更新、提交、审批、退回、发布、详情和权限。

- [x] **Task 3: Conflict and todo domains**
  - 新增 `conflictMysqlRepository` 和 `todoMysqlRepository`。
  - 字段冲突改用 Data Map 字段域数据，术语冲突改用术语 MySQL repository。
  - 通用待办不再混用 SQLite 写入和 MySQL 读取；迁移后同一接口读写同库。
  - 补 `test:conflicts-mysql` 和 `test:todos-mysql`，覆盖冲突检测、解决、待办生成、领取/关闭和权限。

- [x] **Task 4: Version and activity domains**
  - 新增统一审计/版本 repository，承接旧 `change_set`、`version_log` 的运行态职责。
  - `/api/versions` 和活动热力图不再直接读 SQLite `version_log` 或 `terms`。
  - 与 Data Map 已有 `data_map_change_sets` / `data_map_version_log` 保持边界：字段域审计继续留在 Data Map，平台通用审计进入独立审计表。
  - 补 `test:versions-mysql` 和 `test:activity-mysql`。

- [x] **Task 5: Mainline cleanup**
  - `test:mainline` 纳入术语、映射、冲突、待办、版本/活动 MySQL 定向测试。
  - 更新 `apps/mdm-platform/README.md`、`apps/mdm-platform/scripts/README.md` 和本计划执行记录。
  - 重新嗅探剩余 `require('../db')`，把人员、产品、分类、系统、组织单元等主数据对象 CRUD 登记到下一轮计划。

## Public Interface Rules

- 保持现有公开路径不变：`/api/terminology`、`/api/mappings`、`/api/conflicts`、`/api/todos`、`/api/versions`、活动热力图相关接口不改 URL。
- 已迁移域运行态不得继续读取 SQLite 业务表；测试隔离可以保留 SQLite helper，但必须与运行态分开。
- 新 repository 返回值应兼容当前前端字段名，避免一次性重写旧 UI。
- 所有新增 MySQL 表进入 `apps/mdm-platform/server/mysqlSchema.js`，初始化由 `npm run init:mysql` 覆盖。
- 真实 MySQL smoke 只有实际连库、建表、写入、读回成功才算通过；环境缺失只能记录为跳过。

## Test Plan

- `cd apps/mdm-platform && npm run test:identity-mysql`
- `cd apps/mdm-platform && npm run test:access-mysql`
- `cd apps/mdm-platform && npm run test:data-map-mysql`
- `cd apps/mdm-platform && npm run test:field-entries-mysql`
- `cd apps/mdm-platform && npm run test:field-identities-mysql`
- `cd apps/mdm-platform && npm run test:data-map-import-export-mysql`
- `cd apps/mdm-platform && npm run test:terminology-mysql`
- `cd apps/mdm-platform && npm run test:mappings-mysql`
- `cd apps/mdm-platform && npm run test:conflicts-mysql`
- `cd apps/mdm-platform && npm run test:todos-mysql`
- `cd apps/mdm-platform && npm run test:versions-mysql`
- `cd apps/mdm-platform && npm run test:activity-mysql`
- `cd apps/mdm-platform && npm run test:mainline`
- `cd apps/mdm-platform && npm run smoke:data-map-mysql`
- `git diff --check`
- `git diff -- docs/norms`

## Acceptance Criteria

- 术语、旧映射审批、冲突、通用待办、版本/活动日志运行态不再读取 SQLite `terms`、`field_entries`、`field_identities`、`change_set`、`version_log`。
- Data Map 字段域仍以 `context_id` 为公开主键，不恢复旧 `mappings.id` 作为字段台账默认入口。
- 权限判断全部走 MySQL-aware 身份/RBAC helper。
- `docs/norms` 无差异。
- `better-sqlite3` 仅因未迁移域和隔离测试保留，不再被已迁移域运行态依赖。

## Assumptions

- MySQL 目标版本为 8.0+。
- 旧 SQLite `platform.db` 不迁移。
- 本轮不迁人员、产品、分类、系统、组织单元等主数据对象 CRUD。
- 本轮不改公开 API 路径，不重排目录，不改 PMO 驾驶舱和流程真源。
- `2026-06-16-full-repo-audit-remediation.md` 仍作为后续全仓审计参考，但不抢占本阶段剩余 MySQL 迁移主线。

## Execution Notes

- 2026-06-18：已嗅探当前 `master` 合并后的剩余 SQLite 表面。核心遗留点集中在 `terminology`、`mappings`、`conflicts`、`todos`、`versions`、`activity` 以及部分主数据 CRUD 路由。
- 2026-06-18：`docs/norms` 在合并和计划新增前保持无差异。
- 2026-06-18：术语治理已新增独立 MySQL schema 与 `terminologyMysqlRepository`；`/api/terminology`、`/api/terminology/types` 改走 repository，`/api/terminology/processes` 读取流程治理 MySQL 读模型 `process_mapping_records`，不再读取 SQLite `terms`。新增 `test:terminology-mysql` 并纳入 `test:mainline`。
- 2026-06-18：旧映射审批已新增 `mdm_mapping_*` MySQL schema 与 `mappingMysqlRepository`；`/api/mappings` 改走 repository factory 注入，保留旧 API 路径和基本响应形状，详情中的 `fields` 固定为空数组以避免恢复旧 `field_entries` 归属。新增 `test:mappings-mysql` 和 MySQL 身份模式测试，并纳入 `test:mainline`。
- 2026-06-18：冲突治理和通用待办已新增 `mdm_field_conflicts`、`mdm_term_conflicts`、`mdm_conflict_assignments`、`mdm_conflict_coordination_history`、`mdm_todos`、`mdm_todo_events` MySQL schema；`/api/conflicts` 和 `/api/todos` 改走 `conflictMysqlRepository` / `todoMysqlRepository`。字段冲突检测读取 Data Map 字段域，术语冲突检测读取 `terminology_terms`，通用待办同一接口读写 `mdm_todos`。新增 `test:conflicts-mysql`、`test:todos-mysql` 和 MySQL 身份模式测试，并纳入 `test:mainline`。本地 Docker MySQL 已执行 `npm run init:mysql`、`npm run smoke:data-map-mysql` 和一次性冲突/待办真实库写读清理 smoke。
- 2026-06-18：版本与活动域已新增 `auditMysqlRepository`、`mdm_change_sets` 和 `mdm_version_log`，承接平台通用版本记录；`/api/versions` 通过 repository 查询版本记录，活动热力图从 `process_*_events`、`mdm_mapping_approval_history`、`mdm_version_log`、`terminology_terms`、`mdm_*_conflicts` 和 `mdm_todos` 汇总治理动作，不再直接读取 SQLite `change_set`、`version_log`、`terms`、`term_conflicts`、`field_conflicts` 或 `todos`。新增 `test:versions-mysql` 和 `test:activity-mysql`，并纳入 `test:mainline`。
- 2026-06-18：Task 5 收口已完成。`npm run test:mainline` 已覆盖术语、映射、冲突、待办、版本和活动 MySQL 定向测试；真实 MySQL 已执行 `npm run init:mysql`、`npm run smoke:data-map-mysql` 和一次性审计表写入-读回-清理 smoke。剩余 `require('../db')` 主要分布在下一轮对象：人员、产品、产品族、分类节点、系统、组织单元、组织/角色部分遗留路由、页面工作流汇总、角色工作台概览、流程删除级联、RBAC 导入和演示/旧式测试脚本。
