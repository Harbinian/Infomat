# 流程治理模型审核包

> 状态：审核用模型说明  
> 日期：2026-07-01  
> 用途：交给其他模型或人工评审人审核流程治理模型  
> 边界：本文件不替代任何真源，不修改 `docs/norms/` 流程输入基线，不触发 PMO 驾驶舱刷新，不写 MDM 数据库。

## 1. 请审核什么

请审核当前流程治理模型是否在业务口径、证据链、数据模型、权限审计和试点落地路径上自洽。

审核时重点看五件事：

1. 真源边界是否清楚，是否存在把展示副本、平台快照、临时产物当作流程输入基线的问题。
2. DCM/BBM/A1、证据、字段台账、待确认主数据之间的关系是否可追溯。
3. 存量治理线和增量创建线是否边界清楚，是否有未闭环的状态。
4. MDM 平台承接模型是否应收口到 MySQL-only，以及当前兼容路径是否会造成口径风险。
5. 单域试点前的阻断项、校验门槛和人工确认职责是否足够明确。

## 2. 当前仓库阶段

当前仓库处于“流程地图与数据地图的梳理与沉淀”阶段。默认分析对象是流程、数据、组织职责和项目资料，不是具体应用系统。

MDM 平台开发暂时搁置，保留为后续承接平台。PMO 驾驶舱是当前流程地图展示入口。流程输入基线仍以 `docs/norms/{部门}部门-能力-流程-系统映射关系.md` 为准。

审核时不要把 MDM 页面、PMO 驾驶舱、`docs/company-sankey-data.json`、MySQL 快照或 `artifacts/` 中间结果当作流程输入基线维护入口。

## 3. 主责资产和真源链路

### 3.1 组织真源

组织和部门到域映射以 `docs/organization/组织架构和部门职责.md` 为准。

当前部门到域口径：

| 域 | 部门 |
|---|---|
| 总经理直辖 | 工程技术部、质量管理部、财务部 |
| 经营副总 | 行政人事部、经营发展部、物资保障部 |
| 生产副总 | 项目管理部、复材车间、运维安环部 |

### 3.2 流程输入基线

流程输入基线是 `docs/norms/{部门}部门-能力-流程-系统映射关系.md`。

它承载：

- DCM 主表：`部门（D1） -> 能力域（L1） -> 业务能力（L2） -> 业务流程（L3） -> 应用系统（S1）`
- BBM/A1 主记录：`业务流程（L3） -> 业务行为（A1） -> 应用系统（S1）`
- 制度、表单、流程图、台账或部门确认后的证据依据
- MDM 建设要求和字段台账线索

应用系统（S1）只允许 `OA`、`MES`、`PLM`、`ERP` 或留空。`MDM` 不写入 S1。

### 3.3 生成和展示链路

```text
docs/organization/组织架构和部门职责.md
docs/norms/{部门}部门-能力-流程-系统映射关系.md
docs/norms/流程治理/*.md
  ↓
scripts/parse-sankey-data.mjs
  ↓
docs/company-sankey-data.json
  ↓
pmo/procedure-management/dashboard.html
  ↓
apps/mdm-platform 流程治理快照导入
```

规则：

- `docs/company-sankey-data.json` 是生成快照。
- PMO 驾驶舱是展示副本。
- MDM 流程治理快照只用于后续平台承接和验证。
- MDM 不反向覆盖 `docs/norms/`。

## 4. 业务治理模型

### 4.1 两条治理主线

| 主线 | 起点 | 处理对象 | 平台入口 | 结果 |
|---|---|---|---|---|
| 存量治理线 | 已从 `docs/norms/` 解析并导入的流程治理快照 | 已有 L3/A1、跨部门风险、映射待办、治理问题单 | `流程治理` | 回源整改、重新导入、关闭问题 |
| 增量创建线 | 当前快照中没有但业务认为实际存在的流程 | 流程草稿、步骤、在线表单、字段、证据、审核任务 | `报送管理`、`能力与流程申报`、`数据地图字段域` | 草稿提交、审核、发布，或形成回源变更 |

关键边界：

- “创建新流程”不是直接生效。
- 无来源文件的新流程只能保存为草稿或待确认，不能进入正式流程地图。
- 发布前必须有人确认 L1/L2/L3、A1、证据和字段。
- AI 或系统只做结构整理、预检、缺项提示和风险定位，不替人定义规则、拆 A1、定 L1/L2 或判断发布。

### 4.2 存量治理线闭环

```text
查看已导入快照
  -> 定位 L3/A1、跨部门风险、证据问题
  -> 形成映射待办、质量问题或统一问题卡
  -> 责任人回到制度或表单源文件核验
  -> 修改源文件或说明核验项不是问题
  -> 重新解析、重新导入
  -> 问题消失后确认关闭
```

关闭标准：

- 不能只在 MDM 写备注就关闭。
- 不能只说“已处理”就关闭。
- 必须回源核验，必要时修改制度或表单源文件，重新导入后问题不再出现，并保留处理记录。

### 4.3 增量创建线闭环

```text
创建流程草稿
  -> 填写流程名称、为什么新增、依据类型、依据说明、是否涉及其他部门
  -> 补实际步骤
  -> 补在线表单和字段
  -> 补来源文件、来源锚点、确认人或待补说明
  -> 提交审核
  -> 审核通过、驳回或要求补正
  -> 通过后发布数据库流程版本，或形成已确认流程映射回源变更
```

发布前必须满足：

- L1、L2、L3 已确认。
- 至少有 1 个实际步骤。
- 至少有 1 条证据。
- 证据成熟度足以支撑发布。
- 待确认 L1/L2 未复核前不能作为正式能力结构发布。

## 5. 证据链模型

### 5.1 证据来源

流程治理证据优先来自：

- 制度、规程、管理标准
- 表单、台账、签批栏
- 流程图
- 部门确认意见
- 会议或访谈确认记录

中间 Markdown、抽取 JSON、OCR 临时结果、`_extracted/`、`artifacts/` 只能作为待复核线索，不作为正式证据直接入库。

### 5.2 证据状态

| 状态 | 含义 | 下游使用 |
|---|---|---|
| `verified` | 已能定位到源文件、条款、页码、表格或字段位置 | 可支撑已确认流程映射或关闭 |
| `pending_review` | 有来源线索，但还需人工打开原件核验 | 只能进入待确认 |
| `source_missing` | 源文件、位置或摘录缺失 | 阻断正式入库 |
| `ocr_extracted_not_confirmed` | OCR 得到文本但未人工复核 | 只能作为待复核线索 |
| `review_only` | 机器抽取或相似召回结果 | 不得直接写入已确认流程映射 |

### 5.3 问题卡展示口径

问题卡面向业务人员，只写用户能照着做的句子。

问题卡“在哪发现”应展示：

- 源文件编号
- 制度或表单名称
- 大概位置
- 业务流程
- 业务行为

不得向业务用户暴露：

- Markdown 文件名
- 中间 JSON
- 抽取脚本产物
- `_extracted/` 目录
- 仅供机器处理的 artifact 路径

如果只能定位到流程输入基线，必须明说这是残留问题，尚未定位到制度或表单原文段落。

## 6. 数据模型

### 6.1 输入真源目标模型

建议把部门流程输入基线逐步做成 `Markdown 正文 + 固定结构块` 的双轨制。

固定结构块建议包括：

| 结构块 | 用途 |
|---|---|
| `meta` | 部门、域、维护责任人、版本、状态、parser schema 版本 |
| `l3_catalog` | L2/L3 流程骨架、系统落位、owner、证据引用 |
| `a1_catalog` | A1 编号、所属 L3、行为、角色、入口、系统、证据引用 |
| `evidence_catalog` | 证据 ID、来源类型、源文件、引用位置、定位方式、状态 |
| `mdm_requirement_catalog` | 待确认主数据对象、关键字段、责任部门、治理要求、证据引用 |

parser 后续应优先读取结构块，逐步减少对正文标题、表头别名和 Markdown 格式漂移的猜测。

### 6.2 平台承接模型

当前平台已经有较完整的流程治理承接表组，但历史上存在 SQLite 与 MySQL 兼容路径。最新审计建议目标状态为 MySQL-only。

主要表组：

| 表组 | 代表表 | 作用 |
|---|---|---|
| 快照读模型 | `process_governance_snapshots`、`process_governance_nodes`、`process_governance_edges`、`process_a1_items` | 承接导入后的流程地图快照、节点、边、A1 |
| 来源和证据 | `process_source_files`、`process_evidence_refs`、`process_mdm_requirement_items` | 记录源文件清单、证据引用、MDM 建设要求 |
| 跨部门链路 | `process_cross_dept_interactions`、`process_interaction_chains` | 记录跨部门输入输出、风险、链路完整性 |
| 质量闭环 | `process_governance_quality_findings`、`process_governance_quality_cases`、`process_governance_quality_case_events` | 质量发现、问题单、事件历史 |
| 映射工作 | `process_mapping_records`、`process_mapping_todos`、`process_mapping_todo_events` | L3/A1 读模型、映射待办、处理历史 |
| 输入基线复核 | `process_input_baseline_review_runs`、`process_input_baseline_review_items`、`process_input_baseline_review_excerpts`、`process_input_baseline_review_decisions` | 机器识别待确认项、摘录、人工复核结论 |
| 统一问题池 | `process_governance_issue_batches`、`process_governance_issues`、`process_governance_issue_points`、`process_governance_issue_participants`、`process_governance_issue_events`、`process_governance_term_tasks` | 面向业务人员的问题卡、核验项、参与者、事件和术语任务 |
| 增量流程设计 | `process_design_drafts`、`process_design_steps`、`process_design_forms`、`process_design_form_fields`、`process_design_evidence`、`process_design_risks`、`process_design_review_tasks`、`process_design_events`、`process_design_versions` | 新流程草稿、步骤、表单、字段、证据、风险、审核、发布版本 |
| 字段台账关联 | `field_entries.process_governance_node_key`、`field_entries.process_governance_a1_code` | 把字段台账挂回 L3/A1 |

### 6.3 目标收口

流程治理后续建议统一为 MySQL-only：

- 流程治理读模型只读 MySQL。
- 问题池只写 MySQL。
- 输入基线复核只以 MySQL 为结构化工作流存储。
- 质量问题、映射待办、问题卡和活动审计统一写 MySQL 事件面。
- 不再依赖 SQLite fallback 证明流程治理可用。

## 7. 状态机

### 7.1 质量问题和映射待办

共同闭环状态：

```text
open
  -> assigned
  -> rectifying
  -> submitted
  -> source_resolved
  -> closed
```

可重开：

```text
closed -> reopened -> rectifying/submitted/source_resolved
```

关键规则：

- `closed` 前应先达到 `source_resolved`。
- `source_resolved` 应来自重新导入后的事实变化，而不是用户手写备注。
- `reopened` 用于复核发现问题仍存在。

### 7.2 统一问题卡核验项

问题卡由 `issue` 和多个 `point` 组成。

`point_type` 包括：

- `owner_role`
- `completion_standard`
- `controlled_transfer`
- `cross_department`
- `process_structure`
- `system_landing`
- `data_object`
- `evidence_gap`
- `terminology`

核验项状态：

```text
pending_business_confirm
  -> pending_department_review
  -> pending_collaboration
  -> pending_studio_review
  -> pending_mdm_decision
  -> accepted / not_accepted / needs_more_info / closed
```

问题卡处理结论、处理方式、问题原因必须分层：

- 处理结论：判断核验项是否成立。
- 处理方式：只能是“修改制度或表单源文件后重新导入”或“说明这条核验项不是问题”。
- 问题原因：只在选择“不是问题”时出现。

### 7.3 增量流程草稿

```text
draft
  -> submitted
  -> under_review
  -> needs_changes / approved / rejected
  -> published
```

草稿发布后不能直接修改草稿，应通过新版本或回源变更处理。

## 8. 权限和责任

### 8.1 项目工作角色

| 角色 | 典型职责 |
|---|---|
| `it_lead` | 信息化负责人，跨部门流程治理和导入发布协调 |
| `project_lead` | 项目组长，组织本部门或本域事项处理 |
| `business_contact` | 业务对接人，补充业务事实、证据和处理说明 |
| `data_quality` | 数据质量员，检查字段、证据、数据对象和质量问题 |
| `decision_group` | 决策组，处理重大冲突、预算、边界或发布争议 |

### 8.2 基础权限角色

| 角色 | 典型职责 |
|---|---|
| `submitter` | 发起草稿或补充资料 |
| `owner` | 责任人或维护人 |
| `reviewer` | 审核人 |
| `admin` | 管理员 |

### 8.3 建议审核点

请重点审核：

- 是否有清晰的“谁能看、谁能改、谁能关”矩阵。
- 是否仍混用 permission code 和 role code 白名单。
- 关闭、重开、评论、提交、生成问题池等写操作是否统一记审计。
- 部门负责人、授权确认人和 MDM 工作组的最终确认边界是否清楚。

## 9. 试点门槛

不建议把当前状态理解为“补几个页面按钮即可上线”。当前更接近“流程治理承接能力原型”。

单域试点前至少需要满足：

1. 试点部门流程输入基线已代码化，结构块齐全。
2. parser 已优先读取结构块并通过结构、词表和语义校验。
3. 流程治理承接路径收口到 MySQL-only。
4. 权限矩阵明确，可解释谁能查看、处理和关闭事项。
5. 关键写操作有统一 MySQL 事件历史。
6. 问题卡能定位到制度或表单源文件；定位不到时明确标记为残留问题。
7. 角色工作台能把待确认问题、流程质量问题、映射待办和字段台账事项合并成“我现在该做什么”。

## 10. 验证入口

若只审核本文，不需要运行命令。若要验证链路，参考以下入口。

流程输入基线和 PMO 快照：

```powershell
node scripts/parse-sankey-data.mjs
node scripts/check-dcm-bbm.mjs --no-fail
node scripts/verify-norms-source-mapping.mjs
```

流程治理主线只读校验：

```powershell
npm run test:process-governance-mainline
```

MDM 平台流程治理回归：

```powershell
cd apps/mdm-platform
npm run test:process-governance
npm run test:role-workbench
npm run test:mainline
```

MDM/PMO 本地联动：

```powershell
npm run start:infomat-services
npm run smoke:infomat-services
```

## 11. 已知风险

| 风险 | 说明 | 建议 |
|---|---|---|
| 输入基线格式漂移 | 当前 parser 仍依赖 Markdown 表头和标题结构，部门写法变化会影响解析 | 推进固定结构块和结构校验 |
| 双栈读模型 | SQLite/MySQL 兼容路径可能造成页面口径不一致 | 收口到 MySQL-only |
| 聚合路由过大 | `processGovernance.js` 同时承载快照、问题、复核、待办、权限等职责 | 按子域拆出内部模块 |
| 权限解释不足 | 能操作不等于能解释为什么能操作 | 建动作、权限、角色矩阵 |
| 证据链不足 | 待确认项可能只有中间产物或输入基线位置，没有制度或表单原文定位 | 问题卡明确残留问题，回源核验后再关闭 |
| MDM 被误写成 S1 | MDM 是治理承接能力，不是 DCM/BBM 合同允许的应用系统枚举 | S1 只允许 OA/MES/PLM/ERP 或留空 |

## 12. 请外部模型输出的评审结论格式

请按以下格式给出审核意见：

```markdown
# 流程治理模型审核意见

## 总体结论

- 是否自洽：
- 是否具备单域试点条件：
- 最大阻断项：

## 主要问题

| 严重度 | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|

## 边界检查

- 真源边界：
- MDM/PMO/脚本边界：
- 证据链边界：
- 权限审计边界：

## 数据模型检查

- 缺表或缺字段：
- 状态机缺口：
- 事件审计缺口：
- 与字段台账/主数据对象的衔接问题：

## 试点建议

- 可以先试点的范围：
- 试点前必须补齐：
- 不建议做的事情：
```

## 13. 参考材料

本审核包依据以下仓库材料整理：

- `AGENTS.md`
- `CODEX.md`
- `REPOSITORY_BOUNDARY.md`
- `DIRECTORY_OWNERSHIP.md`
- `MAINLINE_MAP.md`
- `docs/organization/组织架构和部门职责.md`
- `docs/norms/AGENTS.md`
- `docs/norms/README.md`
- `docs/norms/流程映射表字段说明.md`
- `docs/norms/流程治理/MDM治理承接流程.md`
- `docs/norms/流程治理/A1编号全域规则.md`
- `docs/reports/2026-06-30-mdm-process-governance-readiness-audit.md`
- `docs/reports/2026-06-30-mdm-process-governance-hardening-proposal.md`
- `docs/plans/2026-06-29-mdm-governance-input-baseline-landing-plan.md`
- `docs/superpowers/plans/2026-06-22-mdm-new-process-governance-line.md`
- `apps/mdm-platform/server/db.js`
- `apps/mdm-platform/server/routes/processGovernance.js`
- `apps/mdm-platform/server/routes/processDesign.js`
- `apps/mdm-platform/server/processGovernanceMysqlRepository.js`
- `apps/mdm-platform/server/processGovernanceIssuePoolRepository.js`
- `apps/mdm-platform/package.json`
