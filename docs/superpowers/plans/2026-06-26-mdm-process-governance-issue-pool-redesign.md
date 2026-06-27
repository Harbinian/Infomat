# MDM 流程治理统一问题池 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MDM 流程治理从“多个技术来源各自展示”改为“按当前用户工作动作组织的统一问题池”，让部门用户、部门长、信息化项目管理工作室和 MDM 工作组在同一张问题卡上完成确认、审核、协同、术语统一和最终裁决。

**Architecture:** 新增平台侧统一问题池 read model，候选抽取、正式映射核验、跨部门风险、质量检查和术语提示都作为来源输入；前端只读取问题池摘要、队列和单卡详情，不在打开页面时实时解析 Markdown 或跨多表拼装。问题卡以 A1 业务行为为上下文容器，问题点按类型流转，但审批链上的所有人都能看到完整 5W2H、证据、意见、历史和裁决。

**Tech Stack:** Express.js、MySQL、单文件前端 `apps/mdm-platform/public/index.html`、现有 `processGovernance` 路由与 MySQL repository、现有平台测试脚本。`docs/norms` 保持基线真源，不由本计划直接回写。

---

## 1. 设计共识

### 1.1 真实需求

“待确认问题”不是候选抽取表，也不是映射待办表。它是当前部门对自己流程资产必须确认、补证、纠偏、协同、审核、裁决和关闭的一切问题集合。

统一问题池应汇总：

- 新增资料或制度抽取出的待确认问题。
- 正式映射中的核验提醒、责任人不具体、完成标准待补、受控传递待补。
- 跨部门输入、输出、传递证据确认。
- 流程结构、系统落位、数据对象、字段和 MDM 相关问题。
- 术语不统一导致的确认、审核和裁决障碍。
- 已提交、待验证、待裁决和已关闭的历史处理记录。

### 1.2 用户入口

普通业务用户不应理解 `candidate review`、`mapping todo`、`quality case`、`read model` 等技术来源。前端继续说人话，第一屏按动作队列组织：

- 需要我确认
- 需要我审核
- 需要我协同
- 等待别人
- 待最终裁决
- 已完成

不同角色使用尽量一致的页面结构，但默认排序和高亮不同：

- 部门业务负责人优先看“需要我确认”和“需要我协同”。
- 部门长或授权审核账户优先看“需要我审核”。
- 信息化项目管理工作室优先看“需要工作室审核”和“跨部门卡住的问题”。
- MDM 工作组优先看“待最终裁决”和“涉及流程结构、系统落位、数据问题、术语裁决的问题”。
- 管理员优先看“超期未动”“无人认领”“数据准备异常”。

### 1.3 问题卡

一张问题卡以 A1 业务行为为主要上下文容器。卡片不能因为问题点不同而拆散整体信息。

卡片固定按 5W2H 表达：

| 维度 | 前端说法 | 内容要求 |
|---|---|---|
| What | 这是什么问题 | 用业务语言描述问题，不只显示编号 |
| Why | 为什么要你确认 | 说明不确认会影响什么 |
| Where | 在哪发现 | 显示部门、流程、A1 行为名称、来源文件/条款；编号必须配具体行为名称 |
| Who | 谁负责处理 | 主责部门、协同部门、审核人、裁决人 |
| When | 什么时候处理 | 当前轮次、截止时间、状态 |
| How | 怎么处理 | 结构化枚举、备注、证据、下一步 |
| How much | 影响多大 | 影响的 A1、跨部门关系、字段、系统落位或术语范围 |

示例：

```text
Where:
项目管理部流程映射表
业务流程：项目阶段划分与阶段评审
业务行为：XM-L3-03-A01 设置阶段评审计划
```

### 1.4 问题点

问题卡下可以有多个问题点，但所有问题点都在同一张卡内展示。

问题点类型第一版覆盖：

- 责任人不具体
- 完成标准待确认
- 受控传递待确认
- 跨部门协同确认
- 流程结构待裁决
- 系统落位待裁决
- 数据对象或字段待裁决
- 证据链待补
- 术语统一

问题点按类型提供专用枚举，不能只让用户写备注。

责任人问题：

```text
已有具体岗位
只能确认到部门
制度未写清，需补依据
不适用
```

完成标准问题：

```text
已有完成标准
需要补完成标准
该行为不需要完成标准
制度未写清
```

受控传递问题：

```text
有受控传递证据
没有受控传递证据
需要对方部门确认
不涉及跨部门传递
```

系统落位问题：

```text
当前应用落位合理
应用落位需调整
暂不落位系统
需要信息化工作组判断
```

术语问题：

```text
采用推荐术语
保留本部门表达并说明原因
需要多部门统一
提交 MDM 工作组裁决
```

### 1.5 验证与裁决

确认、审核和最终裁决必须分开。

| 问题范围 | 填写/确认 | 审核 | 最终裁决 |
|---|---|---|---|
| 部门内部业务事实 | 部门业务负责人 | 部门长或部门长指定账户 | 不需要 MDM 裁决，除非影响正式结构 |
| 跨部门传递 | 主责部门和协同部门分别确认 | 各部门授权审核账户 | 按问题类型进入工作室或 MDM |
| 涉及信息化项目管理工作室 | 相关部门或工作组补充 | 工作室审核 | 工作室为项目执行层最终审核人 |
| 流程结构 | 部门给业务事实 | 部门长审核 | MDM 工作组最终裁决 |
| 系统落位 | 部门给建议 | 工作室或系统工作组审核 | MDM 工作组最终裁决 |
| 数据对象/字段/MDM | 部门给业务事实 | 数据质量相关角色审核 | MDM 工作组最终裁决 |
| 术语统一 | 一个或多个部门长作答 | MDM 工作组汇总 | MDM 工作组裁决并进入术语真源 |

后续审核人不能覆盖前序意见，只能追加意见、要求补充、建议修订、提出不同意见或提交最终裁决。前端语气尊重同事成果，日常流转少用“驳回、错误、不合格、无效”，优先使用“需要补充依据、建议修订、请再确认、存在不同意见、已补充说明”。最终裁决层可以使用“采纳、暂不采纳、需重新确认、纳入后续治理”。

### 1.6 术语治理

业务部门往往能在本部门语境里消化非标准表达，MDM 工作组客观上不具备这种语境能力。因此术语治理必须嵌入确认、审核和裁决过程。

输入时轻提示：

- 不弹窗打断。
- 在输入框旁提示可能的标准术语或相似术语。
- 允许用户保留原表达并说明原因。

提交前检查：

- 列出本次意见里的疑似非标准表达。
- 允许选择“按标准术语改写”“保留原表达并说明原因”“不确定，提交审核人判断”。

裁决阶段：

- MDM 工作组可以生成“术语统一待办”。
- 主送流程对应部门的部门长或授权账户。
- 涉及跨部门时允许多选部门，各部门分别作答。
- 所有部门意见回收后，继续由 MDM 工作组裁决。
- 裁决结果进入术语真源，不自动覆盖历史处理记录。

术语真源至少包含：

- 标准术语
- 允许别名
- 不推荐表达
- 适用业务范围
- 适用部门
- 来源问题卡
- 裁决人/裁决时间
- 版本
- 后续映射回写建议

### 1.7 文件层级优先级

平台应按文件层级帮助用户判断工作顺序。优先级不是评价文件价值，而是提示“先确认上位规则，再确认下位执行细节”。

文件层级：

1. 总则/规章
2. 程序/流程
3. 标准/作业文件
4. 表单/台账/模板

前端说法示例：

```text
这条问题来自程序文件，建议先处理；它会影响下方多个表单。
这条问题来自表单，建议在对应流程口径确认后处理。
```

### 1.8 空状态

“空”必须有管理含义，不能只显示“暂无”。

| 空状态 | 适用条件 | 前端文案方向 |
|---|---|---|
| 已准备且无待办 | 问题池生成成功，当前人确实无动作 | 今天没有需要你处理的问题；本轮待确认问题已清空 |
| 数据正在准备 | 管理员刚导入或正在生成 | 数据正在准备，请稍后查看 |
| 数据准备失败 | 平台侧生成失败 | 数据准备失败，请联系流程治理负责人 |
| 尚未纳入本轮治理 | 部门不在当前批次 | 本部门尚未纳入本轮治理 |
| 无权限 | 身份/部门/角色不匹配 | 当前账户没有查看本部门问题的权限 |

### 1.9 性能约束

这台 PC 需要优先考虑性能。页面不能一次拉全公司、全问题、全历史、全证据。

读取策略：

- 第一屏只拉队列摘要：数量、最紧急前 3 到 5 条、是否超期。
- 点开队列分页拉问题卡：默认 20 条以内。
- 点开单张问题卡再拉完整上下文：5W2H、证据、历史、验证链、裁决记录。
- 后台生成统一问题池，普通用户不触发重新抽取、重新导入、重新生成。
- 用户打开页面时不实时扫 Markdown、不实时解析 Sankey、不跨多张旧来源表拼全部数据。

平台侧生成原则：

- 由管理员、流程治理负责人或 MDM 工作组授权账户触发。
- 每次生成有批次号、来源、时间、操作者、结果摘要、失败原因。
- 普通用户只处理业务问题，不承担平台数据准备。

---

## 2. 文件结构

### 2.1 新增文件

- `apps/mdm-platform/server/processGovernanceIssuePoolRepository.js`
  - 统一问题池 MySQL repository。
  - 负责问题卡、问题点、队列摘要、单卡详情、事件流水、批次状态。

- `apps/mdm-platform/scripts/test-process-governance-issue-pool-repository.js`
  - 以 fake pool 或隔离 MySQL 方式测试 repository SQL 行为。

- `apps/mdm-platform/scripts/test-process-governance-issue-pool-api.js`
  - 测试问题池 API 的权限、队列、分页、详情、动作提交。

- `apps/mdm-platform/scripts/test-process-governance-issue-pool-frontend.js`
  - 测试前端是否使用人话队列、5W2H、空状态分层、性能分页入口。

### 2.2 修改文件

- `apps/mdm-platform/server/mysqlSchema.js`
  - 增加统一问题池表。
  - 增加术语统一待办和生成批次表。

- `apps/mdm-platform/server/routes/processGovernance.js`
  - 增加 `/api/process-governance/issue-pool/*` 路由。
  - 保留现有候选抽取、映射工作库、映射待办、质量问题接口，作为来源或兼容入口。

- `apps/mdm-platform/public/index.html`
  - `待确认问题` 子页改读统一问题池。
  - 保留现有映射工作、治理闭环等材料区。
  - 第一屏按动作队列和空状态分层展示。

- `apps/mdm-platform/package.json`
  - 增加 `test:process-governance-issue-pool`。
  - 将其纳入 `test:process-governance`。

- `apps/mdm-platform/docs/role-based-usage-guide.md`
  - 更新流程治理角色、队列、验证链和 MDM 裁决说明。

### 2.3 不直接修改

- `docs/norms/`
  - 本计划不修改正式映射真源。
  - 后续只有经过裁决且可回写的结论，才进入受控回写流程。

- `pmo/`
  - 本计划不修改 PMO 驾驶舱。

---

## 3. 数据模型

### 3.1 表：`process_governance_issue_batches`

用途：记录问题池生成批次，区分数据准备成功、准备中、失败、未纳入。

```sql
CREATE TABLE IF NOT EXISTS process_governance_issue_batches (
  batch_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  batch_key VARCHAR(128) NOT NULL UNIQUE,
  source_type VARCHAR(64) NOT NULL,
  source_snapshot_id BIGINT NULL,
  department_name VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'preparing',
  summary_json JSON NULL,
  error_message TEXT NULL,
  generated_by BIGINT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_issue_batches_status_dept (status, department_name),
  INDEX idx_issue_batches_generated_at (generated_at)
);
```

Allowed `status`:

```text
preparing
ready
failed
superseded
```

### 3.2 表：`process_governance_issues`

用途：统一问题卡，一张卡以 A1 行为或流程结构对象为上下文。

```sql
CREATE TABLE IF NOT EXISTS process_governance_issues (
  issue_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  issue_key VARCHAR(160) NOT NULL UNIQUE,
  batch_id BIGINT NULL,
  primary_dept_name VARCHAR(128) NOT NULL,
  owner_dept_name VARCHAR(128) NULL,
  source_layer VARCHAR(64) NOT NULL DEFAULT 'procedure',
  source_type VARCHAR(64) NOT NULL,
  source_ref_table VARCHAR(128) NULL,
  source_ref_id VARCHAR(128) NULL,
  l1_name VARCHAR(255) NULL,
  l2_name VARCHAR(255) NULL,
  l3_name VARCHAR(255) NULL,
  a1_code VARCHAR(128) NULL,
  a1_name VARCHAR(255) NULL,
  title VARCHAR(255) NOT NULL,
  what_text TEXT NOT NULL,
  why_text TEXT NOT NULL,
  where_text TEXT NOT NULL,
  who_text TEXT NOT NULL,
  when_text TEXT NOT NULL,
  how_text TEXT NOT NULL,
  how_much_text TEXT NOT NULL,
  display_status VARCHAR(64) NOT NULL DEFAULT 'waiting_my_action',
  priority_score INT NOT NULL DEFAULT 0,
  due_at DATETIME NULL,
  closed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_issues_dept_status (primary_dept_name, display_status, priority_score),
  INDEX idx_issues_a1 (a1_code),
  INDEX idx_issues_updated (updated_at),
  CONSTRAINT fk_issue_batch FOREIGN KEY (batch_id) REFERENCES process_governance_issue_batches(batch_id)
);
```

Allowed `source_layer`:

```text
rule
procedure
standard
form
unknown
```

Allowed `display_status`:

```text
waiting_my_action
waiting_others
waiting_department_review
waiting_studio_review
waiting_mdm_decision
completed
closed
data_preparing
data_failed
not_in_scope
no_permission
```

### 3.3 表：`process_governance_issue_points`

用途：问题卡下的问题点，每个点有自己的类型、枚举、验证链和状态。

```sql
CREATE TABLE IF NOT EXISTS process_governance_issue_points (
  point_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  issue_id BIGINT NOT NULL,
  point_key VARCHAR(180) NOT NULL UNIQUE,
  point_type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  prompt_text TEXT NOT NULL,
  enum_options_json JSON NOT NULL,
  selected_option VARCHAR(128) NULL,
  note TEXT NULL,
  evidence_json JSON NULL,
  current_step VARCHAR(64) NOT NULL DEFAULT 'business_confirm',
  point_status VARCHAR(64) NOT NULL DEFAULT 'pending_business_confirm',
  requires_mdm_decision TINYINT(1) NOT NULL DEFAULT 0,
  requires_studio_review TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_issue_points_issue (issue_id, point_status),
  INDEX idx_issue_points_type_status (point_type, point_status),
  CONSTRAINT fk_issue_points_issue FOREIGN KEY (issue_id) REFERENCES process_governance_issues(issue_id)
);
```

Allowed `point_type`:

```text
owner_role
completion_standard
controlled_transfer
cross_department
process_structure
system_landing
data_object
evidence_gap
terminology
```

Allowed `point_status`:

```text
pending_business_confirm
pending_department_review
pending_collaboration
pending_studio_review
pending_mdm_decision
needs_more_info
accepted
not_accepted
closed
```

### 3.4 表：`process_governance_issue_participants`

用途：一张问题卡上所有可见、可操作、可审核、可裁决的参与方。

```sql
CREATE TABLE IF NOT EXISTS process_governance_issue_participants (
  participant_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  issue_id BIGINT NOT NULL,
  point_id BIGINT NULL,
  participant_type VARCHAR(64) NOT NULL,
  dept_name VARCHAR(128) NULL,
  role_code VARCHAR(64) NULL,
  user_id BIGINT NULL,
  can_view TINYINT(1) NOT NULL DEFAULT 1,
  can_act TINYINT(1) NOT NULL DEFAULT 0,
  action_label VARCHAR(128) NULL,
  action_status VARCHAR(64) NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_issue_participants_issue (issue_id, can_view, can_act),
  INDEX idx_issue_participants_user (user_id, action_status),
  INDEX idx_issue_participants_dept (dept_name, action_status),
  CONSTRAINT fk_issue_participants_issue FOREIGN KEY (issue_id) REFERENCES process_governance_issues(issue_id),
  CONSTRAINT fk_issue_participants_point FOREIGN KEY (point_id) REFERENCES process_governance_issue_points(point_id)
);
```

Allowed `participant_type`:

```text
business_owner
department_reviewer
collaborator
studio_reviewer
mdm_decider
terminology_reviewer
observer
```

### 3.5 表：`process_governance_issue_events`

用途：事件流水，尊重同事成果，不覆盖前序意见。

```sql
CREATE TABLE IF NOT EXISTS process_governance_issue_events (
  event_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  issue_id BIGINT NOT NULL,
  point_id BIGINT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_user_id BIGINT NULL,
  actor_dept_name VARCHAR(128) NULL,
  actor_role_code VARCHAR(64) NULL,
  note TEXT NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_issue_events_issue (issue_id, created_at),
  INDEX idx_issue_events_point (point_id, created_at),
  CONSTRAINT fk_issue_events_issue FOREIGN KEY (issue_id) REFERENCES process_governance_issues(issue_id),
  CONSTRAINT fk_issue_events_point FOREIGN KEY (point_id) REFERENCES process_governance_issue_points(point_id)
);
```

Allowed `event_type`:

```text
created
business_confirmed
department_reviewed
collaboration_added
collaboration_answered
studio_reviewed
mdm_decided
more_info_requested
revision_suggested
different_opinion_added
terminology_task_created
terminology_answered
terminology_decided
closed
reopened
```

### 3.6 表：`process_governance_term_tasks`

用途：裁决阶段发起的术语统一待办，独立可处理，但必须挂回原问题卡。

```sql
CREATE TABLE IF NOT EXISTS process_governance_term_tasks (
  term_task_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  issue_id BIGINT NOT NULL,
  point_id BIGINT NULL,
  term_text VARCHAR(255) NOT NULL,
  context_text TEXT NOT NULL,
  selected_departments_json JSON NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'pending_departments',
  decision_json JSON NULL,
  created_by BIGINT NULL,
  decided_by BIGINT NULL,
  decided_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_term_tasks_status (status),
  CONSTRAINT fk_term_tasks_issue FOREIGN KEY (issue_id) REFERENCES process_governance_issues(issue_id),
  CONSTRAINT fk_term_tasks_point FOREIGN KEY (point_id) REFERENCES process_governance_issue_points(point_id)
);
```

Allowed `status`:

```text
pending_departments
pending_mdm_decision
decided
closed
```

---

## 4. API 设计

All routes require login.

```text
GET  /api/process-governance/issue-pool/queues
GET  /api/process-governance/issue-pool/issues
GET  /api/process-governance/issue-pool/issues/:issueId
POST /api/process-governance/issue-pool/points/:pointId/confirm
POST /api/process-governance/issue-pool/points/:pointId/review
POST /api/process-governance/issue-pool/points/:pointId/collaborate
POST /api/process-governance/issue-pool/points/:pointId/studio-review
POST /api/process-governance/issue-pool/points/:pointId/mdm-decision
POST /api/process-governance/issue-pool/issues/:issueId/comment
POST /api/process-governance/issue-pool/issues/:issueId/close
POST /api/process-governance/issue-pool/issues/:issueId/reopen
POST /api/process-governance/issue-pool/term-tasks
POST /api/process-governance/issue-pool/term-tasks/:termTaskId/answer
POST /api/process-governance/issue-pool/term-tasks/:termTaskId/decision
POST /api/process-governance/issue-pool/batches/generate
GET  /api/process-governance/issue-pool/batches
```

### 4.1 `GET /queues`

Returns compact queue summary only.

```json
{
  "dataStatus": "ready",
  "departmentName": "项目管理部",
  "queues": [
    {
      "key": "need_confirm",
      "label": "需要我确认",
      "count": 12,
      "preview": [
        {
          "issue_id": 101,
          "title": "设置阶段评审计划：责任岗位待确认",
          "a1_code": "XM-L3-03-A01",
          "a1_name": "设置阶段评审计划",
          "source_layer_label": "程序/流程",
          "updated_at": "2026-06-26 14:32:00"
        }
      ]
    }
  ]
}
```

Allowed `dataStatus`:

```text
ready
preparing
failed
not_in_scope
no_permission
```

### 4.2 `GET /issues`

Query params:

```text
queue=need_confirm|need_review|need_collaboration|waiting|need_mdm_decision|completed
limit=20
offset=0
dept=项目管理部
```

Rules:

- Default `limit` is 20.
- Max `limit` is 50.
- Non-global users are scoped to their department and participant visibility.
- Response must not include full event history or all evidence.

### 4.3 `GET /issues/:issueId`

Returns complete card context:

- 5W2H.
- all issue points.
- all participants.
- evidence summary.
- event history.
- terminology tasks.
- source references.

### 4.4 Action routes

Action routes append events and update point state. They never overwrite earlier event notes.

`POST /points/:pointId/confirm` body:

```json
{
  "selected_option": "制度未写清，需补依据",
  "note": "项目阶段评审由项目管理部组织，但具体岗位需部门长确认。",
  "evidence": [
    {
      "source_file": "docs/norms/项目管理部部门-能力-流程-系统映射关系.md",
      "source_anchor": "XM-L3-03-A01",
      "label": "项目阶段划分与阶段评审 / 设置阶段评审计划"
    }
  ]
}
```

---

## 5. Implementation Tasks

### Task 1: Add Issue Pool Schema

**Files:**
- Modify: `apps/mdm-platform/server/mysqlSchema.js`
- Test: `apps/mdm-platform/scripts/test-mysql-config.js`

- [ ] **Step 1: Write the failing schema test**

Add assertions to `apps/mdm-platform/scripts/test-mysql-config.js`:

```js
[
  'CREATE TABLE IF NOT EXISTS process_governance_issue_batches',
  'CREATE TABLE IF NOT EXISTS process_governance_issues',
  'CREATE TABLE IF NOT EXISTS process_governance_issue_points',
  'CREATE TABLE IF NOT EXISTS process_governance_issue_participants',
  'CREATE TABLE IF NOT EXISTS process_governance_issue_events',
  'CREATE TABLE IF NOT EXISTS process_governance_term_tasks'
].forEach(needle => {
  assert.ok(schemaSql.includes(needle), `missing process governance issue pool table ${needle}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-mysql-config.js
```

Expected: FAIL with missing issue pool table assertion.

- [ ] **Step 3: Add schema SQL**

Modify `mdmMysqlSchemaSql()` in `apps/mdm-platform/server/mysqlSchema.js` to include the six tables from section 3.

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-mysql-config.js
```

Expected: PASS.

### Task 2: Build Repository Read Model

**Files:**
- Create: `apps/mdm-platform/server/processGovernanceIssuePoolRepository.js`
- Create: `apps/mdm-platform/scripts/test-process-governance-issue-pool-repository.js`
- Modify: `apps/mdm-platform/package.json`

- [ ] **Step 1: Write failing repository tests**

Create `apps/mdm-platform/scripts/test-process-governance-issue-pool-repository.js` with tests for:

```js
const assert = require('assert');
const { makeProcessGovernanceIssuePoolRepository } = require('../server/processGovernanceIssuePoolRepository');

async function main() {
  const calls = [];
  const fakePool = {
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM process_governance_issues')) {
        return [[
          {
            issue_id: 101,
            title: '设置阶段评审计划：责任岗位待确认',
            a1_code: 'XM-L3-03-A01',
            a1_name: '设置阶段评审计划',
            primary_dept_name: '项目管理部',
            display_status: 'waiting_my_action',
            priority_score: 80,
            updated_at: '2026-06-26 14:32:00'
          }
        ]];
      }
      return [[]];
    }
  };
  const repo = makeProcessGovernanceIssuePoolRepository(fakePool);
  assert.strictEqual(typeof repo.listQueues, 'function');
  assert.strictEqual(typeof repo.listIssues, 'function');
  assert.strictEqual(typeof repo.getIssueDetail, 'function');
  assert.strictEqual(typeof repo.confirmPoint, 'function');

  const issues = await repo.listIssues({ departmentName: '项目管理部', queue: 'need_confirm', limit: 20, offset: 0 });
  assert.strictEqual(issues.items.length, 1);
  assert.strictEqual(issues.items[0].a1_name, '设置阶段评审计划');
  assert.ok(calls.some(call => call.sql.includes('LIMIT ? OFFSET ?')), 'listIssues should paginate for PC performance');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-repository.js
```

Expected: FAIL because repository file does not exist or functions are missing.

- [ ] **Step 3: Implement repository**

Create `apps/mdm-platform/server/processGovernanceIssuePoolRepository.js` exporting:

```js
function makeProcessGovernanceIssuePoolRepository(pool) {
  function normalizeLimit(limit) {
    const value = Number(limit || 20);
    return Math.max(1, Math.min(50, Number.isFinite(value) ? value : 20));
  }

  return {
    async initSchema() {
      const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
      for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
        await pool.execute(statement);
      }
    },

    async listIssues({ departmentName, queue, limit = 20, offset = 0 } = {}) {
      const pageSize = normalizeLimit(limit);
      const pageOffset = Math.max(0, Number(offset || 0));
      const params = [];
      let whereSql = 'WHERE 1=1';
      if (departmentName) {
        whereSql += ' AND primary_dept_name=?';
        params.push(departmentName);
      }
      if (queue === 'need_confirm') {
        whereSql += " AND display_status='waiting_my_action'";
      }
      const [rows] = await pool.execute(
        `SELECT issue_id, title, a1_code, a1_name, primary_dept_name, display_status, priority_score, updated_at
         FROM process_governance_issues
         ${whereSql}
         ORDER BY priority_score DESC, updated_at DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, pageOffset]
      );
      return { items: rows, summary: { returned: rows.length, limit: pageSize, offset: pageOffset } };
    },

    async listQueues({ departmentName } = {}) {
      const [rows] = await pool.execute(
        `SELECT display_status, COUNT(*) AS count
         FROM process_governance_issues
         WHERE primary_dept_name=?
         GROUP BY display_status`,
        [departmentName || '']
      );
      return { items: rows };
    },

    async getIssueDetail(issueId) {
      const [rows] = await pool.execute('SELECT * FROM process_governance_issues WHERE issue_id=? LIMIT 1', [issueId]);
      return rows[0] || null;
    },

    async confirmPoint(pointId, payload = {}) {
      await pool.execute(
        `UPDATE process_governance_issue_points
         SET selected_option=?, note=?, point_status='pending_department_review', updated_at=CURRENT_TIMESTAMP
         WHERE point_id=?`,
        [payload.selected_option || '', payload.note || '', pointId]
      );
      await pool.execute(
        `INSERT INTO process_governance_issue_events
          (issue_id, point_id, event_type, actor_user_id, note, payload_json)
         SELECT issue_id, point_id, 'business_confirmed', ?, ?, ?
         FROM process_governance_issue_points
         WHERE point_id=?`,
        [payload.actor_user_id || null, payload.note || '', JSON.stringify(payload), pointId]
      );
      return { success: true };
    }
  };
}

module.exports = { makeProcessGovernanceIssuePoolRepository };
```

- [ ] **Step 4: Add test script**

Modify `apps/mdm-platform/package.json`:

```json
"test:process-governance-issue-pool": "node scripts/test-process-governance-issue-pool-repository.js"
```

- [ ] **Step 5: Run tests**

Run:

```powershell
cd apps/mdm-platform
npm run test:process-governance-issue-pool
```

Expected: PASS.

### Task 3: Add Issue Pool API

**Files:**
- Modify: `apps/mdm-platform/server/routes/processGovernance.js`
- Create: `apps/mdm-platform/scripts/test-process-governance-issue-pool-api.js`

- [ ] **Step 1: Write failing API test**

Create `apps/mdm-platform/scripts/test-process-governance-issue-pool-api.js` with route injection similar to existing process-governance tests. It must assert:

```js
assert.strictEqual(queueBody.dataStatus, 'ready');
assert.strictEqual(queueBody.queues[0].label, '需要我确认');
assert.strictEqual(issueBody.items[0].a1_name, '设置阶段评审计划');
assert.ok(issueBody.items.length <= 20, 'issue list should be paginated');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-api.js
```

Expected: FAIL because `/issue-pool/queues` route does not exist.

- [ ] **Step 3: Implement route factory hook**

In `apps/mdm-platform/server/routes/processGovernance.js`, add a repository factory for tests:

```js
let issuePoolRepositoryFactory = null;

async function issuePoolRepository() {
  if (issuePoolRepositoryFactory) return await issuePoolRepositoryFactory();
  const mysql = require('mysql2/promise');
  const { mysqlConfigFromEnv } = require('../mysqlConfig');
  const { makeProcessGovernanceIssuePoolRepository } = require('../processGovernanceIssuePoolRepository');
  const pool = mysql.createPool(mysqlConfigFromEnv());
  const repo = makeProcessGovernanceIssuePoolRepository(pool);
  await repo.initSchema();
  return repo;
}
```

Export:

```js
router.setIssuePoolRepositoryFactory = factory => { issuePoolRepositoryFactory = factory; };
router.resetIssuePoolRepositoryFactory = () => { issuePoolRepositoryFactory = null; };
```

- [ ] **Step 4: Implement read routes**

Add:

```js
router.get('/issue-pool/queues', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepository();
    const departmentName = await currentDepartmentNameAsync(req);
    const queues = await repo.listQueues({ departmentName });
    return res.json({ dataStatus: 'ready', departmentName, queues: mapIssueQueues(queues.items || []) });
  });
});

router.get('/issue-pool/issues', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepository();
    const departmentName = await currentDepartmentNameAsync(req);
    return res.json(await repo.listIssues({
      departmentName,
      queue: req.query.queue,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  });
});
```

`mapIssueQueues` must map status codes to human labels:

```js
function mapIssueQueues(rows) {
  const labels = {
    waiting_my_action: '需要我确认',
    waiting_department_review: '需要我审核',
    waiting_others: '等待别人',
    waiting_mdm_decision: '待最终裁决',
    completed: '已完成'
  };
  return rows.map(row => ({
    key: row.display_status,
    label: labels[row.display_status] || '待处理',
    count: Number(row.count || 0),
    preview: []
  }));
}
```

- [ ] **Step 5: Run API test**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-api.js
```

Expected: PASS.

### Task 4: Frontend Queue Shell

**Files:**
- Modify: `apps/mdm-platform/public/index.html`
- Create: `apps/mdm-platform/scripts/test-process-governance-issue-pool-frontend.js`

- [ ] **Step 1: Write failing frontend hook test**

Create `apps/mdm-platform/scripts/test-process-governance-issue-pool-frontend.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

[
  'function loadProcessGovernanceIssueQueues',
  'function renderProcessGovernanceIssueQueues',
  '/api/process-governance/issue-pool/queues',
  '/api/process-governance/issue-pool/issues',
  '需要我确认',
  '需要我审核',
  '需要我协同',
  '等待别人',
  '待最终裁决',
  '今天没有需要你处理的问题',
  '数据准备失败，请联系流程治理负责人',
  '业务行为',
  '这是什么问题',
  '为什么要你确认',
  '在哪发现',
  '怎么处理'
].forEach(needle => assert.ok(html.includes(needle), `missing issue pool frontend hook ${needle}`));

assert.ok(!html.includes('mapping todo'), 'frontend should not expose mapping todo wording');
assert.ok(!html.includes('quality case'), 'frontend should not expose quality case wording');
console.log('Process governance issue pool frontend hook test passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-frontend.js
```

Expected: FAIL because new issue pool hooks do not exist.

- [ ] **Step 3: Implement queue shell**

Add frontend functions:

```js
async function loadProcessGovernanceIssueQueues() {
  return await api('/api/process-governance/issue-pool/queues');
}

async function loadProcessGovernanceIssueList(queueKey) {
  var query = processGovernanceQuery({ queue: queueKey, limit: 20, offset: 0 });
  return await api('/api/process-governance/issue-pool/issues' + query);
}

function renderProcessGovernanceIssueQueues(data) {
  var queues = data.queues || [];
  if (data.dataStatus === 'failed') return '<div class="empty">数据准备失败，请联系流程治理负责人。</div>';
  if (data.dataStatus === 'preparing') return '<div class="empty">数据正在准备，请稍后查看。</div>';
  if (!queues.some(function(queue) { return Number(queue.count || 0) > 0; })) {
    return '<div class="empty">今天没有需要你处理的问题。</div>';
  }
  return queues.map(function(queue) {
    return '<button class="pg-issue-queue" data-issue-queue="' + escapeHtml(queue.key) + '">' +
      '<strong>' + safeText(queue.label) + '</strong><span>' + safeText(queue.count || 0) + '</span>' +
    '</button>';
  }).join('');
}
```

- [ ] **Step 4: Run frontend test**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-frontend.js
```

Expected: PASS.

### Task 5: Single Issue Detail Card

**Files:**
- Modify: `apps/mdm-platform/server/processGovernanceIssuePoolRepository.js`
- Modify: `apps/mdm-platform/server/routes/processGovernance.js`
- Modify: `apps/mdm-platform/public/index.html`
- Test: `apps/mdm-platform/scripts/test-process-governance-issue-pool-api.js`
- Test: `apps/mdm-platform/scripts/test-process-governance-issue-pool-frontend.js`

- [ ] **Step 1: Extend tests for detail card**

API test must assert detail response includes:

```js
assert.strictEqual(detailBody.issue.a1_name, '设置阶段评审计划');
assert.ok(detailBody.issue.what_text);
assert.ok(detailBody.issue.why_text);
assert.ok(detailBody.points.length >= 1);
assert.ok(detailBody.events.length >= 1);
```

Frontend test must assert:

```js
[
  'function renderProcessGovernanceIssueDetail',
  '这是什么问题',
  '为什么要你确认',
  '在哪发现',
  '谁负责处理',
  '什么时候处理',
  '怎么处理',
  '影响多大',
  '业务行为'
].forEach(needle => assert.ok(html.includes(needle)));
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-api.js
node scripts/test-process-governance-issue-pool-frontend.js
```

Expected: FAIL due missing detail route/rendering.

- [ ] **Step 3: Implement detail repository and route**

Repository `getIssueDetail(issueId)` must return:

```js
{
  issue,
  points,
  participants,
  events,
  termTasks
}
```

Route:

```js
router.get('/issue-pool/issues/:issueId', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await issuePoolRepository();
    const detail = await repo.getIssueDetail(Number(req.params.issueId || 0));
    if (!detail || !detail.issue) return res.status(404).json({ error: '问题不存在' });
    return res.json(detail);
  });
});
```

- [ ] **Step 4: Implement detail renderer**

Frontend renderer must show 5W2H and not split context across unrelated pages:

```js
function renderProcessGovernanceIssueDetail(detail) {
  var issue = detail.issue || {};
  return '<article class="pg-issue-detail">' +
    '<h3>' + safeText(issue.title || '待确认问题') + '</h3>' +
    '<div class="pg-issue-a1">业务行为：' + safeText(issue.a1_code || '') + ' ' + safeText(issue.a1_name || '') + '</div>' +
    renderIssueFact('这是什么问题', issue.what_text) +
    renderIssueFact('为什么要你确认', issue.why_text) +
    renderIssueFact('在哪发现', issue.where_text) +
    renderIssueFact('谁负责处理', issue.who_text) +
    renderIssueFact('什么时候处理', issue.when_text) +
    renderIssueFact('怎么处理', issue.how_text) +
    renderIssueFact('影响多大', issue.how_much_text) +
    renderIssuePoints(detail.points || []) +
    renderIssueEvents(detail.events || []) +
  '</article>';
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
cd apps/mdm-platform
npm run test:process-governance-issue-pool
node scripts/test-process-governance-issue-pool-api.js
node scripts/test-process-governance-issue-pool-frontend.js
```

Expected: PASS.

### Task 6: Point Actions and Respectful Event History

**Files:**
- Modify: `apps/mdm-platform/server/processGovernanceIssuePoolRepository.js`
- Modify: `apps/mdm-platform/server/routes/processGovernance.js`
- Modify: `apps/mdm-platform/public/index.html`
- Test: `apps/mdm-platform/scripts/test-process-governance-issue-pool-api.js`

- [ ] **Step 1: Add action tests**

Test that submitting a confirmation:

- updates only the point current state.
- appends an event.
- does not delete or overwrite earlier events.

Test labels avoid harsh wording:

```js
['需要补充依据', '建议修订', '请再确认', '存在不同意见'].forEach(label => {
  assert.ok(html.includes(label), `missing respectful collaboration label ${label}`);
});
['驳回', '错误', '不合格', '无效'].forEach(label => {
  assert.ok(!html.includes(label), `avoid harsh workflow wording ${label}`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-api.js
node scripts/test-process-governance-issue-pool-frontend.js
```

Expected: FAIL due missing action behavior.

- [ ] **Step 3: Implement point action routes**

Implement:

```text
POST /issue-pool/points/:pointId/confirm
POST /issue-pool/points/:pointId/review
POST /issue-pool/points/:pointId/collaborate
POST /issue-pool/points/:pointId/studio-review
POST /issue-pool/points/:pointId/mdm-decision
```

Each route must append to `process_governance_issue_events`.

- [ ] **Step 4: Run tests**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-api.js
node scripts/test-process-governance-issue-pool-frontend.js
```

Expected: PASS.

### Task 7: Terminology Task Flow

**Files:**
- Modify: `apps/mdm-platform/server/processGovernanceIssuePoolRepository.js`
- Modify: `apps/mdm-platform/server/routes/processGovernance.js`
- Modify: `apps/mdm-platform/public/index.html`
- Test: `apps/mdm-platform/scripts/test-process-governance-issue-pool-api.js`

- [ ] **Step 1: Add terminology tests**

API test must assert:

```js
assert.strictEqual(createTermTaskBody.task.term_text, '项目主管领导');
assert.deepStrictEqual(createTermTaskBody.task.selected_departments, ['项目管理部', '工程技术部']);
assert.strictEqual(answerBody.success, true);
assert.strictEqual(decisionBody.decision.standard_term, '项目负责人');
```

Frontend test must assert:

```js
[
  '术语统一',
  '可能有标准术语',
  '保留原表达，并说明原因',
  '提交 MDM 工作组裁决',
  '术语裁决结果将进入术语真源'
].forEach(needle => assert.ok(html.includes(needle), `missing terminology governance copy ${needle}`));
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-api.js
node scripts/test-process-governance-issue-pool-frontend.js
```

Expected: FAIL due missing terminology routes and copy.

- [ ] **Step 3: Implement term task routes**

Implement:

```text
POST /issue-pool/term-tasks
POST /issue-pool/term-tasks/:termTaskId/answer
POST /issue-pool/term-tasks/:termTaskId/decision
```

The decision route must record enough data for later insertion into the terminology truth source:

```json
{
  "standard_term": "项目负责人",
  "allowed_aliases": ["项目主管领导", "项目经理"],
  "discouraged_terms": ["项目老大"],
  "business_scope": "项目阶段评审",
  "departments": ["项目管理部", "工程技术部"],
  "source_issue_id": 101
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-api.js
node scripts/test-process-governance-issue-pool-frontend.js
```

Expected: PASS.

### Task 8: Batch Generation Contract

**Files:**
- Modify: `apps/mdm-platform/server/processGovernanceIssuePoolRepository.js`
- Modify: `apps/mdm-platform/server/routes/processGovernance.js`
- Create: `apps/mdm-platform/scripts/test-process-governance-issue-pool-batch.js`
- Modify: `apps/mdm-platform/package.json`

- [ ] **Step 1: Write failing batch test**

Test that batch generation is admin/authorized only and returns safe status:

```js
assert.strictEqual(normalUserRes.status, 403);
assert.strictEqual(adminRes.status, 200);
assert.ok(adminBody.batch.batch_key);
assert.strictEqual(adminBody.batch.status, 'ready');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-batch.js
```

Expected: FAIL because batch route does not exist.

- [ ] **Step 3: Implement batch route**

Only `admin`, `it_lead`, `decision_group`, or users with `process_governance:generate_issue_pool` can generate.

Route:

```text
POST /api/process-governance/issue-pool/batches/generate
```

The route must:

- create a batch row.
- generate or refresh issues from existing process mapping records/todos as the first source.
- return status and counts.
- never expose local script details to normal users.

- [ ] **Step 4: Run batch test**

Run:

```powershell
cd apps/mdm-platform
node scripts/test-process-governance-issue-pool-batch.js
```

Expected: PASS.

### Task 9: Integration Into Existing Test Scripts

**Files:**
- Modify: `apps/mdm-platform/package.json`
- Modify: `apps/mdm-platform/scripts/test-process-governance-api.js`
- Modify: `apps/mdm-platform/scripts/test-process-governance-frontend.js`
- Modify: `apps/mdm-platform/docs/role-based-usage-guide.md`

- [ ] **Step 1: Add package scripts**

Add:

```json
"test:process-governance-issue-pool": "node scripts/test-process-governance-issue-pool-repository.js && node scripts/test-process-governance-issue-pool-api.js && node scripts/test-process-governance-issue-pool-frontend.js && node scripts/test-process-governance-issue-pool-batch.js"
```

Append `npm run test:process-governance-issue-pool` to `test:process-governance`.

- [ ] **Step 2: Update existing process governance tests**

`apps/mdm-platform/scripts/test-process-governance-api.js` should assert that `/issue-pool/queues` exists and returns human queue labels.

- [ ] **Step 3: Update role usage guide**

Document:

- problem pool definition.
- A1 issue card.
- 5W2H.
- department confirmation and department head review.
- workroom final review.
- MDM final decision for flow structure, system landing, data and terminology.
- performance paging rules.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
cd apps/mdm-platform
npm run test:process-governance-issue-pool
npm run test:process-governance-frontend
```

Expected: PASS.

### Task 10: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run frontend regression**

Run:

```powershell
cd apps/mdm-platform
npm run test:frontend
```

Expected: PASS.

- [ ] **Step 2: Run process governance regression**

Run:

```powershell
cd apps/mdm-platform
npm run test:process-governance
```

Expected: PASS.

- [ ] **Step 3: Run role workbench regression**

Run:

```powershell
cd apps/mdm-platform
npm run test:role-workbench
```

Expected: PASS.

- [ ] **Step 4: Run mainline if scope touched shared routes**

Run:

```powershell
cd apps/mdm-platform
npm run test:mainline
```

Expected: PASS.

---

## 6. Migration and Rollout

### 6.1 Phase 1: Read-only Issue Pool

- Generate issue cards from existing `process_mapping_records` and `process_mapping_todos`.
- Do not remove old candidate review or mapping todo views.
- Frontend “待确认问题” reads issue pool first.
- If no issue pool batch is ready, show data preparation status.

### 6.2 Phase 2: User Actions

- Enable department business confirmation.
- Enable department head or authorized account review.
- Append events only; do not overwrite.
- Keep old mapping todo handling available for fallback.

### 6.3 Phase 3: Collaboration and Decisions

- Enable cross-department collaboration.
- Enable workroom final review.
- Enable MDM final decision for structure, system landing and data issues.

### 6.4 Phase 4: Terminology Governance

- Add submit-time terminology prompts.
- Allow MDM Workgroup to create terminology tasks.
- Record terminology decision payload for terminology truth source integration.

### 6.5 Phase 5: Controlled Write-back Proposal

- Generate formal mapping change suggestions only after final decision.
- Do not auto-write `docs/norms`.
- Later implementation must define a separate controlled write-back plan.

---

## 7. Acceptance Criteria

Functional:

- 费常益 `100003` 进入流程治理时，不再因为候选抽取表为空而看到无意义空态。
- 项目管理部用户默认看到项目管理部问题池。
- 跨部门问题在主责部门可处理，在协同部门可确认，并在同一张问题卡保留整体上下文。
- 一张问题卡显示具体 A1 行为名称，不只显示代码。
- 问题点按类型提供结构化枚举。
- 部门业务负责人输出后，由部门长或指定账户审核。
- 涉及流程结构、系统落位、数据问题时，最终裁决人是 MDM 工作组。
- 涉及信息化项目管理工作室时，工作室作为项目执行层最终审核人。
- 术语统一可以由 MDM 工作组在裁决阶段发起，并最终进入术语真源。

Experience:

- 前端不用 `candidate review`、`mapping todo`、`quality case` 等技术词。
- 空状态区分“已清空”“准备中”“准备失败”“未纳入”“无权限”。
- 日常协作语气尊重同事成果，少用否定式按钮。
- 审批链上的所有人能看到完整上下文，不丧失整体感。

Performance:

- 第一屏只加载队列摘要。
- 列表默认最多 20 条。
- 单卡详情按需加载。
- 普通用户不能触发重新抽取、重新导入、重新生成问题池。
- 生成失败以平台数据准备状态呈现，不转嫁给业务用户。

---

## 8. Risks and Guards

| Risk | Guard |
|---|---|
| 把统一问题池做成又一个技术表列表 | 前端验收必须按动作队列和 5W2H 卡片检查 |
| 性能拖垮本机 | 队列摘要、分页、按需详情是硬性验收 |
| 术语治理变成训话 | 输入轻提示、提交前确认、裁决阶段才升级待办 |
| 后续审核覆盖前序意见 | 事件流水 append-only，不做覆盖更新 |
| MDM 工作组越权解释业务术语 | 术语待办先发给部门长或授权账户作答，再由 MDM 裁决 |
| 普通用户误触发数据准备 | 生成路由仅授权角色可用 |
| `docs/norms` 被 MDM 自动回写 | 本计划只产生回写建议，不直接改真源 |

---

## 9. Self Review

Spec coverage:

- 统一问题池：Task 1-4。
- A1 行为卡与 5W2H：Task 5。
- 问题点枚举：Task 3、Task 5、Task 6。
- 部门确认、部门长审核、工作室审核、MDM 裁决：Task 3、Task 6。
- 尊重同事成果、事件不覆盖：Task 6。
- 术语治理与术语真源：Task 7。
- 文件层级优先级：Task 2、Task 5。
- 空状态分层：Task 4。
- 性能约束：Task 2、Task 4、Task 8。
- 普通用户不触发本地/平台生成：Task 8。

Placeholder scan:

- No unresolved placeholder markers.
- No unspecified “add tests for the above” steps.

Type consistency:

- Issue card table uses `process_governance_issues`.
- Issue point table uses `process_governance_issue_points`.
- Event table uses `process_governance_issue_events`.
- Term task table uses `process_governance_term_tasks`.
- API prefix is consistently `/api/process-governance/issue-pool`.

---

## 10. Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-06-26-mdm-process-governance-issue-pool-redesign.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Given the scope and the need to protect existing dirty work, use Subagent-Driven execution in an isolated worktree when implementation starts.
