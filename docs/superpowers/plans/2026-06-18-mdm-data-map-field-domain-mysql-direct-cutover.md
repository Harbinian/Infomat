# MDM 数据地图字段域 MySQL 彻底切换计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MDM 字段台账、字段身份、字段命名校验、字段导入导出和字段质量进度从 SQLite 直接切换到 MySQL Data Map 字段域。

**Architecture:** 新增 Data Map MySQL schema 与 repository，字段域路由只通过 repository 访问 MySQL。旧 SQLite 字段表不迁移、不桥接；`better-sqlite3` 暂留给未迁移业务域和隔离测试。

**Tech Stack:** Node.js, Express, mysql2, ExcelJS, MySQL 8.0+.

---

## Summary

本阶段按“字段域优先 + 直接替换 + 可大幅重构”执行。目标不是把 SQLite `field_entries` 原样搬到 MySQL，而是建立一套更完整的数据地图字段域：数据对象、字段上下文、字段定义、系统关系、黄金源、命名规则、质量问题、导入批次和审计记录全部进入 MySQL。

旧 SQLite 字段表不迁移、不桥接；字段域运行态接口直接走 MySQL。`docs/norms` 是流程输入基线，本计划不修改正式流程映射数据。

## Data Model

- `data_map_objects`：主数据对象待确认，包含 `object_key`、中英文名、对象类型、责任部门、数据管家、来源和状态。
- `data_map_contexts`：字段台账上下文，替代旧 `mappings.id` 作为字段归属锚点，保留流程快照、流程映射记录、L3/A1、来源文件和原文锚点。
- `data_map_fields`：字段定义主表，包含中英文名、业务定义、数据类型、格式、长度、可空、枚举、敏感等级、主数据等级、流程治理引用、来源证据、质量状态和审计字段。
- `data_map_field_system_links`：字段与系统的生产、消费、待确认权威、权威关系，包含同步方式、接口说明和主关系标记。
- `data_map_field_identities`：黄金源、维护部门、owner、置信度、确认状态和确认记录。
- `data_map_term_types`、`data_map_terms`、`data_map_naming_rules`：字段命名与禁用词校验。
- `data_map_quality_issues`：字段完整性、命名、黄金源、重复冲突等质量问题。
- `data_map_import_batches`：Excel / 基线导入批次。
- `data_map_change_sets`、`data_map_version_log`：字段域审计。

## Public Interfaces

- `GET /api/data-map/contexts`
- `POST /api/data-map/contexts`
- `GET /api/data-map/contexts/:id`
- `PUT /api/data-map/contexts/:id`
- `GET /api/field-entries/mapping/:contextId`
- `POST /api/field-entries`
- `PUT /api/field-entries/:id`
- `DELETE /api/field-entries/:id`
- `GET /api/field-identities/field/:fieldEntryId`
- `PUT /api/field-identities/:fieldEntryId`
- `POST /api/field-identities/:fieldEntryId/confirm`
- `POST /api/import/field-entries`
- `GET /api/export/excel`
- `GET /api/quality/field-identities/progress`

`context_id` 是字段域公开主键。`mapping_id` 只作为短期兼容别名，响应中两者同值。

## Implementation Tasks

- [x] **Task 1: Failing tests first**
  - 新增 `test:data-map-mysql`，覆盖 schema 和 repository。
  - 新增 `test:field-entries-mysql`、`test:field-identities-mysql`。
  - 新增 `test:data-map-import-export-mysql`。
  - 扩展前端资产测试，断言字段台账入口使用 `/api/data-map/contexts`。

- [x] **Task 2: Schema and repository**
  - 扩展 `apps/mdm-platform/server/mysqlSchema.js`。
  - 新增 `apps/mdm-platform/server/dataMapMysqlRepository.js` 和 repository factory 注入能力。
  - 新增 `smoke:data-map-mysql`，真实 MySQL 可用时初始化、写入 context、字段、黄金源并读回。

- [x] **Task 3: API cutover**
  - 重构字段台账、字段身份、字段导入、字段导出、字段质量进度路由。
  - 字段域路由不得再 `require('../db')`。
  - 字段命名校验不得再读 SQLite `terms`。
  - `mapping_id` 请求体字段仅作为 `context_id` 别名。

- [x] **Task 4: Frontend cutover**
  - 字段台账、导入、质量进度改从 Data Map context 加载。
  - 新增或调整“数据地图上下文”选择/创建入口。
  - 保留旧基础映射审批 UI，但不作为字段台账默认入口。

- [x] **Task 5: Documentation and verification**
  - 更新 MDM README、scripts README。
  - `test:mainline` 纳入 Data Map MySQL 定向测试。
  - 不删除 `better-sqlite3`，但字段域文档不再描述 SQLite 为当前形态。

## Validation Policy

- 字段名命中 `block` 级禁用词，返回 400。
- 字段名命中 `warn` 级规则，允许保存，但写入 `data_map_quality_issues`。
- `context_id` 不存在时返回 404。
- 非管理员只能维护本人提交或本部门 owner 范围内的数据。
- 所有权限判断继续使用 MySQL-aware 身份/RBAC helper。

## Test Plan

- `cd apps/mdm-platform && npm run test:data-map-mysql`
- `cd apps/mdm-platform && npm run test:field-entries-mysql`
- `cd apps/mdm-platform && npm run test:field-identities-mysql`
- `cd apps/mdm-platform && npm run test:data-map-import-export-mysql`
- `cd apps/mdm-platform && npm run test:identity-mysql`
- `cd apps/mdm-platform && npm run test:access-mysql`
- `cd apps/mdm-platform && npm run test:frontend`
- `cd apps/mdm-platform && npm run test:process-governance`
- `cd apps/mdm-platform && npm run test:role-workbench`
- `cd apps/mdm-platform && npm run test:mainline`
- `cd apps/mdm-platform && npm run smoke:data-map-mysql`
- `npm run test:process-input-baseline-review`
- `npm run test:process-input-baseline-review`
- `git diff --check`
- `git diff -- docs/norms`

## Acceptance Criteria

- 字段域公开入口不再读取 SQLite `field_entries`、`field_identities`、`terms`、`change_set`、`version_log`。
- 字段台账有独立 Data Map context，不再依赖旧 `mappings.id`。
- 字段名校验、黄金源确认、导入导出、质量进度都走 MySQL。
- 前端字段台账默认入口能创建/选择 Data Map context 并维护字段。
- 真实 MySQL smoke 只有实际执行成功才算通过；缺少环境变量只能记为跳过。
- `docs/norms` 无差异。

## Execution Notes

- 已新增 Data Map MySQL schema、repository、初始化迁移标记和可选真实库 smoke。
- 已将 `/api/data-map/contexts`、字段台账、字段黄金源、字段导入、字段导出和黄金源质量进度切到 Data Map repository。
- 已在前端新增“数据地图”入口，字段导入以 `context_id` 为归属锚点；旧映射审批 UI 保留为历史流程入口。
- `better-sqlite3` 暂留给未迁移业务域和隔离测试；本阶段不迁旧 `platform.db`。
- `docs/norms` 不属于本阶段改动范围，提交前需保持无差异。

## Assumptions

- MySQL 目标版本为 8.0+。
- 旧 SQLite 字段数据不迁移。
- 术语治理冲突、基础映射审批、旧待办、旧冲突工作流不在本阶段彻底迁移；但字段域不再依赖它们。
- 本阶段允许较大重构，但每一步必须有定向测试和小步提交。
