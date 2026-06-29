# MDM 一期升级方案设计

> 编制日期：2026-06-03
> 定位：MDM 一期内升级方案。先升级现有平台，再承接流程治理成果，最后沉淀长期蓝图。

## 1. 背景与判断

当前仓库处于“流程地图与数据地图的梳理与沉淀”阶段。现有 MDM 平台已经具备组织、能力、流程、映射、审批、字段台账、黄金源、术语和冲突管理等基础能力，但与当前流程治理成果之间还存在明显断点：

- MDM 当前业务地图只能表达“部门-能力-流程-应用系统”的发布映射。
- 流程治理真源已细化到 L3 流程、A1 业务行为、输入来源部门、输出目标部门、跨部门风险和交互链。
- PMO 驾驶舱当前依赖 `docs/company-sankey-data.json` 和 HTML 内嵌快照，不能直接切换到登录态 MDM API。
- 当前 MDM 测试脚本会清空或删除共享 `platform.db`，不适合继续在共享库上直接执行。
- 当前 MDM 数据库中业务地图核心表为空，部门口径也未完全对齐组织架构真源。

因此，MDM 一期需要先做平台升级，而不是继续只把它当作字段台账工具。升级后，MDM 应能承接流程治理成果，但 PMO 静态驾驶舱在一期内仍保留现有链路，直到平台数据、API、权限和验证能力都稳定。

## 2. 一期目标

MDM 一期升级要完成五件事：

1. 修正平台底座，使 MDM 能安全继续开发和验证。
2. 接入流程治理成果，形成可追溯的流程治理快照。
3. 支持 A1 业务行为与跨部门交互治理。
4. 将流程治理和字段台账、黄金源治理衔接起来。
5. 在一期内沉淀长期蓝图，为后续 ERP、MES、OA、PLM、集成总线和主数据治理建设提供依据。

一期结束时，MDM 不一定替代 PMO 静态驾驶舱，但必须具备替代条件的技术基础：有结构化数据、有只读视图、有校验脚本、有可隔离测试、有明确迁移路径。

## 3. 设计原则

- **一期内完成升级闭环**：本方案不命名为“二期”。平台升级、流程治理接入、长期蓝图沉淀都属于一期工作。
- **流程优先**：当前阶段分析对象是流程，不是具体应用系统。页面和报告只描述流程数量、承载关系和建议落位，不评价某个应用系统“最忙”“主用”。
- **真源不抢跑**：近期真源仍是 `docs/norms/`、`docs/organization/组织架构和部门职责.md` 和 parser 生成的 `docs/company-sankey-data.json`。
- **先快照，后编辑**：MDM 先只读接收流程治理快照，验证稳定后再允许人工维护、审批或回写。
- **先隔离，后测试**：任何会重置数据库的测试，必须先支持隔离测试库。
- **不破坏现有字段治理能力**：字段台账、黄金源、术语、冲突管理继续保留；流程治理能力作为新增域接入。

## 4. 一期范围

### P1 平台底座修正

目标：让 MDM 当前代码可以安全继续开发。

交付：

- 支持 `MDM_DB_PATH` 或等价环境变量，测试和开发可使用独立 SQLite 文件。
- 路由测试不再直接清空 `apps/mdm-platform/data/platform.db`。
- 部门维表同步到组织架构真源的 9 个部门和 3 个域。
- 对 `公司领导`、`信息化部`、`信息化项目组` 等非流程治理部门，不删除历史数据，按归档或“其他”口径处理。
- 降级旧 demo seed，明确它不能用于流程治理初始化。

### P2 流程治理快照接入

目标：把当前流程治理成果导入 MDM 的独立快照区，不直接污染现有 `mappings` 审批表。

输入：

- `docs/company-sankey-data.json`
- `docs/norms/{部门}部门-能力-流程-系统映射关系.md`
- `docs/norms/流程治理/*.md`
- `docs/organization/组织架构和部门职责.md`

交付：

- 新增流程治理快照表，记录来源文件、生成时间、hash、统计口径。
- 新增流程节点和关系表，表达根节点、域、部门、L2、L3、A1、应用系统建议之间的关系。
- 新增导入脚本，从 `docs/company-sankey-data.json` 建立只读快照。
- 新增校验脚本，对比 MDM 快照与 JSON 统计是否一致。
- 新增只读 API，返回与当前 PMO 驾驶舱兼容的数据结构。

### P3 A1 与跨部门治理

目标：把流程治理从 L3 映射升级到 A1 级别。

交付：

- A1 业务行为表：记录 A1 编号、所属部门、所属 L3、业务行为、执行角色、审批类型、输入来源部门、输出目标部门、应用系统建议、来源文件。
- 跨部门交互表：记录来源部门、目标部门、A1 编号、引用数量、风险等级、确认状态、说明和来源报告。
- 交互链表：记录端到端链路名称、状态、断点列表。
- 平台内“流程治理”视图：支持按全公司、域、部门、风险等级、确认状态筛选。
- 只读阶段不改变现有审批流；确认流程成熟后，再把跨部门确认任务接入 `approval_tasks`。

### P4 字段与黄金源衔接

目标：让流程治理成果成为字段台账和黄金源治理的入口。

交付：

- 从 L3/A1 查看相关字段台账和待确认黄金源。
- 字段台账可引用流程治理快照中的 L3 或 A1。
- 黄金源待确认系统仍按字段治理逻辑维护，不因流程建议落位自动认定。
- 冲突管理可以识别同一字段在不同部门、不同流程、不同待确认系统中的不一致。

### P5 一期长期蓝图沉淀

目标：在一期内形成长期建设路线，但不要求一期实现全部外部系统集成。

交付：

- 主数据域蓝图：组织、人员、岗位、物料、供应商、客户、项目、产品、工装、设备、质量记录等待确认域。
- 黄金源蓝图：每类主数据的待确认来源、维护部门、消费系统、同步方式和治理责任。
- 接口蓝图：MDM 与 ERP、MES、OA、PLM、集成总线的待确认接口清单。
- 数据质量蓝图：校验规则、重复识别、编码规则、字段标准、例外处理。
- 里程碑蓝图：一期平台升级完成后，后续如何进入集成总线、系统联调和主数据治理常态化。

## 5. 数据模型设计

### 5.1 快照主表

建议新增 `process_governance_snapshots`：

```sql
process_governance_snapshots {
  id,
  source_json_path,
  source_hash,
  generated_at,
  imported_at,
  imported_by,
  stats_json,
  status: 'active|archived',
  note
}
```

用途：

- 记录每次从流程治理成果导入 MDM 的快照。
- 同一时间只有一个 `active` 快照用于默认展示。
- 历史快照不删除，便于比较流程治理口径变化。

### 5.2 节点表

建议新增 `process_governance_nodes`：

```sql
process_governance_nodes {
  id,
  snapshot_id,
  node_key,
  node_type: 'root|domain|department|l2|l3|a1|system',
  name,
  domain_name,
  dept_name,
  parent_key,
  source_file,
  sort_order
}
```

用途：

- 承接 `docs/company-sankey-data.json` 的节点。
- 后续可在平台内按域、部门、流程层级检索。
- `system` 节点只表达“应用系统建议落位”，不自动认定黄金源。

### 5.3 关系表

建议新增 `process_governance_edges`：

```sql
process_governance_edges {
  id,
  snapshot_id,
  source_key,
  target_key,
  edge_type: 'root_domain|domain_dept|dept_l2|l2_l3|l3_a1|l3_system|a1_system',
  value,
  source_file
}
```

用途：

- 支撑平台内流程地图和只读 API。
- 保留 PMO 驾驶舱当前 `nodes`、`links` 口径的转换能力。

### 5.4 A1 业务行为表

建议新增 `process_a1_items`：

```sql
process_a1_items {
  id,
  snapshot_id,
  a1_code,
  dept_name,
  l3_name,
  behavior,
  execution_role,
  approval_type,
  input_source_dept,
  output_target_dept,
  suggested_systems,
  verification_note,
  source_file
}
```

用途：

- 让 MDM 能表达当前流程治理中最关键的 A1 粒度。
- 支撑跨部门输入输出检查。
- 为后续字段台账、黄金源和接口识别提供业务上下文。

### 5.5 跨部门交互表

建议新增 `process_cross_dept_interactions`：

```sql
process_cross_dept_interactions {
  id,
  snapshot_id,
  source_dept,
  target_dept,
  a1_code,
  refs,
  risk_level: 'high|medium|low',
  confirm_status: 'confirmed|pending|needs_review|not_mapped',
  description,
  source_report
}
```

用途：

- 承接 `crossDept.risks`。
- 支撑风险清单、跨部门确认队列和后续闭环。
- 风险等级只描述交互闭环状态，不评价部门或应用系统。

### 5.6 交互链表

建议新增 `process_interaction_chains`：

```sql
process_interaction_chains {
  id,
  snapshot_id,
  name,
  status: 'complete|partial|broken',
  breaks_json,
  source_report
}
```

用途：

- 承接 `crossDept.interactionChains`。
- 支撑管理层查看端到端链路断点。

## 6. API 与页面设计

### 6.1 只读 API

一期优先新增只读 API，不立即接入编辑审批：

| API | 用途 |
|-----|------|
| `GET /api/process-governance/snapshots` | 查看快照列表 |
| `GET /api/process-governance/current` | 返回当前 active 快照摘要 |
| `GET /api/process-governance/sankey` | 返回 `{ nodes, links, systems, stats, crossDept }` |
| `GET /api/process-governance/a1` | 查询 A1 业务行为 |
| `GET /api/process-governance/cross-dept` | 查询跨部门风险与确认状态 |
| `GET /api/process-governance/chains` | 查询交互链 |

### 6.2 平台页面

MDM 平台内新增“流程治理”一级入口，建议包含四个视图：

1. **流程总览**：统计 L3、A1、部门覆盖、跨部门检查结果。
2. **流程地图**：平台内只读流程地图，支持全公司、域、部门切换。
3. **A1 明细**：按部门、L3、输入来源、输出目标、应用系统建议筛选。
4. **跨部门风险**：展示风险项、确认状态、交互链断点。

PMO 静态驾驶舱暂不改为调用 MDM API。等 MDM 快照导入、只读 API、权限和测试都稳定后，再评估是否由 parser 生成 HTML，还是由 PMO 页面读取只读 API。

## 7. 导入与校验

### 7.1 导入流程

1. 运行 `node scripts/parse-sankey-data.mjs`，生成 `docs/company-sankey-data.json`。
2. 运行 MDM 流程治理导入脚本，读取 JSON 和必要的 norms Markdown。
3. 写入新的快照、节点、关系、A1、跨部门交互和交互链表。
4. 将最新快照标记为 `active`，旧快照标记为 `archived`。
5. 运行一致性校验，确认 MDM 快照统计与 JSON 统计一致。

### 7.2 校验规则

导入后至少校验：

- 部门域映射包含 9 个部门。
- `stats.mappings` 与 JSON 一致。
- `stats.a1` 与 JSON 一致。
- `crossDept.stats.totalChecked`、`pendingConfirm`、`highRisk` 与 JSON 一致。
- 风险等级仅为 `high`、`medium`、`low`。
- `#sankey-data`、`docs/company-sankey-data.json` 和 MDM 只读 API 的统计口径一致。

## 8. 权限与治理状态

一期升级初期只读：

- 管理员可以导入快照和切换 active 快照。
- 普通用户可以查看自己有权限的部门、域和公开统计。
- 不允许普通用户直接改快照数据。

后续在一期内逐步打开确认能力：

- 部门负责人可对本部门相关 A1 和跨部门交互做“已确认/需复核”标记。
- 信息化项目组可维护风险状态和蓝图备注。
- 所有人工确认动作进入版本记录。

## 9. 测试策略

测试必须先解决数据库隔离：

- `server/db.js` 支持通过环境变量选择数据库路径。
- 所有路由测试使用临时库。
- 共享 `apps/mdm-platform/data/platform.db` 不作为测试目标。

新增测试分三层：

1. **导入脚本测试**：用小型 fixture JSON 验证节点、关系、A1 和风险表写入。
2. **API 测试**：验证只读 API 返回结构与 PMO JSON 契约一致。
3. **前端脚本测试**：验证流程治理页面加载空态、快照态和风险筛选态。

## 10. 风险与控制

| 风险 | 控制 |
|------|------|
| MDM 过早替代 PMO 静态驾驶舱 | 一期内先提供只读 API，不切换 PMO 链路 |
| 流程治理快照污染现有审批表 | 新增独立快照表，不直接写 `mappings` |
| 测试误删共享库 | 先做数据库路径隔离，再恢复自动化测试 |
| 部门口径不一致 | 以组织架构文档为真源，同步脚本只更新/归档，不硬删除 |
| 应用系统建议被误解为系统选型 | 页面文案统一写“建议落位到 X 类应用” |
| A1 数据太细导致平台复杂 | 初期只读检索，确认工作流后置 |

## 11. 验收标准

一期升级完成时，应满足：

- MDM 可以在隔离测试库上运行全量相关测试，不影响共享 `platform.db`。
- MDM 部门维表与组织架构真源一致，历史项目治理部门不影响流程统计。
- MDM 能导入当前 `docs/company-sankey-data.json`，并保留快照来源和 hash。
- MDM 只读 API 能返回与 PMO 驾驶舱兼容的 `{ nodes, links, systems, stats, crossDept }`。
- 平台内能查看 L3、A1、跨部门风险和交互链。
- 字段台账能引用流程治理快照中的 L3 或 A1。
- 一期蓝图文档覆盖主数据域、黄金源、接口、数据质量和后续里程碑。
- PMO 静态驾驶舱仍可按现有方式打开和验证。

## 12. 后续计划输入

本设计适合拆成以下 implementation plan 任务：

1. MDM 数据库隔离与安全测试改造。
2. 组织口径同步与 demo seed 降级。
3. 流程治理快照表与导入脚本。
4. A1 与跨部门交互数据模型。
5. 只读 API 与契约校验。
6. 平台内流程治理视图。
7. 字段台账与流程治理关联。
8. 一期长期蓝图文档沉淀。

## 13. 自检结果

- 未发现占位内容或空白章节。
- “一期升级”口径贯穿全文，未使用“二期”作为阶段名称。
- 当前真源仍保留在 `docs/norms` 与 `docs/company-sankey-data.json`，未要求 PMO 立即切换 MDM。
- 数据模型、API、页面、导入、测试和验收标准互相对应。
- 范围可拆成一个多任务实施计划，不需要再拆成独立项目。
