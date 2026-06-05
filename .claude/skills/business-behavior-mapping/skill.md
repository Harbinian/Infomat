---
name: business-behavior-mapping
description: Use when decomposing department business processes into business behaviors, approval flows, cross-department transactions, system interaction mappings, or updating H5/HTML Sankey views after behavior mapping. Prerequisite: a completed department capability-process-system mapping must already exist.
metadata:
  short-description: 业务行为（A1）、审批流、部门审核稿
---

# Business Behavior Mapping (业务行为（A1） Layer)

Extend an existing department capability-process-system mapping by decomposing each 业务流程（L3） into 业务行为（A1）.

Default delivery posture: produce a **部门审核稿**. The goal is not to silently finalize every 业务行为（A1） on behalf of the department; the goal is to make every behavior, evidence basis, inference, and confirmation point clear enough for department reviewers to correct.

## Project Terminology Standard

Use these exact element names in deliverable titles, chart labels, table headers, legends, stats cards, tooltips, and review text. Do not invert the code/name order or invent aliases.

| Code | Required name |
|---|---|
| D1 | 部门（D1） |
| D2 | 办公室（D2） |
| L1 | 能力域（L1） |
| L2 | 业务能力（L2） |
| L3 | 业务流程（L3） |
| A1 | 业务行为（A1） |
| A2 | 业务行为（A2） |
| S1 | 应用系统（S1） |
| S2 | 应用模块（S2） |

`业务行为（A1）` is the primary behavior layer created by this skill. `业务行为（A2）` is an optional lower behavior layer and should be used only when the user asks for deeper decomposition. `办公室（D2）` and `应用模块（S2）` are optional layers: include them only when the source organization or system/module evidence supports them.

## Prerequisites

- A completed department mapping document (output of `department-capability-mapping`) covering 部门（D1）, 能力域（L1）, 业务能力（L2）, 业务流程（L3）, and 应用系统（S1）.
- Source documents referenced in that mapping (rules, procedures, standards, forms, ledgers, flow descriptions).
- Any process flow attachments (approval flow diagrams, responsibility matrices, countersign matrices) present in the source files.
- Existing department capability Sankey HTML/H5 page when the user asks to update a page after 业务行为（A1） mapping.

## Incremental Execution Protocol

Unless the user explicitly requests a full rebuild, always perform incremental execution.

### Step 0: Detect Change Scope

Before decomposition, check what has changed:

| Dimension | Detection Method | Triggered Action |
|---|---|---|
| 业务流程（L3） mapping changes | Read existing `{部门名}部门-能力-流程-系统映射关系.md`; compare 业务流程（L3） list and 变更记录 with previous run | New/revised 业务流程（L3） → decompose to 业务行为（A1）; deprecated 业务流程（L3） → mark 业务行为（A1） as deprecated |
| Source document changes | Compare file number + revision against the mapping document's evidence citations | Re-read only changed source sections; update affected 业务行为（A1） records |
| Existing 业务行为（A1） state | Read the `## 业务行为（A1）映射（BBM增补）` section inside `{部门名}部门-能力-流程-系统映射关系.md`; extract 业务行为（A1）编号 list | Existing unchanged 业务行为（A1） → skip; new 业务行为（A1） → decompose; changed evidence → re-validate |

### Step 1 Routing

- No `## 业务行为（A1）映射（BBM增补）` section in the standard mapping document → **full decomposition** of all 业务流程（L3） and append that section to `{部门名}部门-能力-流程-系统映射关系.md`.
- 业务行为（A1） section exists → **incremental**: only decompose new/revised 业务流程（L3）, re-validate 业务行为（A1） whose source evidence changed, append a change record inside the same standard mapping document.
- Full rebuild requested by user → rebuild the 业务行为（A1） section in the standard mapping document; do not create a separate 业务行为（A1） Markdown file.

### Change Record

Append changes to the 业务行为（A1） section of `{部门名}部门-能力-流程-系统映射关系.md` under its local `### 变更记录` / change-record subsection:

```
### YYYY-MM-DD 变更

| 变更类型 | 影响范围 | 说明 |
|---|---|---|
| 新增业务行为（A1） | 业务流程（L3）: {process} | {业务行为（A1）编号}–{业务行为（A1）编号} ({count}条) 基于新增/修订制度补充 |
| 审批流变更 | 业务行为（A1）: {业务行为（A1）编号} | {file number} 升版，审批节点从 {n} 级变为 {m} 级 |
| 证据更新 | 业务行为（A1）: {业务行为（A1）编号} | 制度依据从 §{old} 更新为 §{new} |
| 跨部门关系变更 | 业务行为（A1）: {业务行为（A1）编号} | `输出目标部门` 从 {old} 变更为 {new} |
| 废止业务行为（A1） | 业务流程（L3）: {process} | {业务行为（A1）编号}–{业务行为（A1）编号} 因 业务流程（L3）废止，标记为已废止 |
```

- Do NOT re-decompose unchanged 业务流程（L3）.
- Deprecated 业务行为（A1） stay in the table with strikethrough prefix and "已废止" note; never delete.
- Process flow md files only re-extracted when the source diagram changed.
- Domain detail Sankey only re-renders when 业务行为（A1） data actually changes.
- Do not leave a separate `{部门名}A1业务行为映射关系.md` beside the standard mapping document. If one exists from an earlier run, merge it into `{部门名}部门-能力-流程-系统映射关系.md` and remove the duplicate.

## H5 / HTML Update Responsibility

After 业务行为（A1） mapping is created or changed, this skill owns the H5/HTML update. Do not switch back to `department-capability-mapping` just because the next output is a Sankey page.

Use `department-capability-mapping` only as an upstream reference for:

- the existing 能力域（L1）/业务能力（L2）/业务流程（L3）/应用系统（S1） mapping
- the current all-domain Sankey structure and page style
- evidence and system-design wording already validated at the L3 layer

When the user says "BBM执行后更新H5", "更新HTML", "更新桑基图", "补业务行为（A1）页面", or similar after behavior work, continue with `business-behavior-mapping` and update the existing page in place when possible.

If an existing department H5 page is present:

- Preserve the global DCM view: `部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 应用系统（S1）`.
- Add or refresh 业务行为（A1） domain detail views: `业务能力（L2）→ 业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）`.
- If 应用模块（S2） evidence exists, expose it as detail metadata under 应用系统（S1）; do not replace 应用系统（S1） with 应用模块（S2）.
- Update stats, tables, tooltips, filters, and layout controls to reflect 业务行为（A1） data.
- Keep DCM-validated facts intact unless 业务行为（A1） evidence reveals a clear inconsistency that must be flagged.
- Present the page as a department review draft, with confirmation prompts rather than accusatory error labels.

If no existing H5 page is present, create the standard DCM-compatible page name: `{部门名}部门能力流程系统桑基图.html`. Do not create a second file named `{部门名}部门能力流程行为系统桑基图.html`; 业务行为（A1） is an added detail layer inside the same department-capability-process-system page, not a separate visualization口径.

When a previous run has already produced both `{部门名}部门能力流程系统桑基图.html` and `{部门名}部门能力流程行为系统桑基图.html`, consolidate them: keep `{部门名}部门能力流程系统桑基图.html` as the canonical page, merge the 业务行为（A1） views into it, and remove the duplicate behavior-named HTML after verifying the canonical page renders.

## Gold Standard H5 Pattern

Use `docs/norms/经营发展部部门能力流程系统桑基图.html` as the project gold-standard reference for post-BBM H5 updates. The goal is not to copy its data; the goal is to reuse its delivery discipline:

- Preserve the DCM all-domain structure and page identity.
- Add 业务行为（A1） only in domain-detail views, not in the all-domain view.
- Keep the default reading direction left-to-right; top-to-bottom may be an optional toggle only.
- Use the same reviewer-facing posture: visible uncertainty, clear核验提醒, and blank feedback fields for department review.
- Prefer compact, readable controls and tables over decorative redesign.
- Make the page usable immediately; do not add a marketing-style cover, separate narrative page, or unrelated visual theme.

If the new page is visibly worse than the gold-standard page, simplify the implementation and preserve structure before adding visual complexity.

## Hard Front-End Contract

These are non-negotiable for any BBM-updated H5 page:

- There is only one canonical HTML file: `{部门名}部门能力流程系统桑基图.html`.
- There is only one canonical mapping Markdown file: `{部门名}部门-能力-流程-系统映射关系.md`.
- 业务行为（A1） is an added detail layer inside the canonical page, never a second page or second口径.
- The visible 业务行为（A1） node label must be `业务行为（A1） + 执行角色`. The 业务行为（A1）编号 may be the internal key, tooltip field, or table column, but it must not be the front-end A1 label.
- The all-domain Sankey must remain `部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 应用系统（S1）`.
- The domain-detail Sankey must remain `业务能力（L2）→ 业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）`.
- Detail tables must include `序号`, `部门确认意见`, `是否调整`, and `调整建议`.
- Detail tables must avoid horizontal scrolling on common desktop widths unless the user explicitly requests an audit-wide table.
- Collective execution roles such as departments, offices, centers, groups, committees, and teams must produce visible review prompts in both chart and table.
- Do not use shorthand labels such as `业务行为(A1)`, `业务能力(L2)`, `业务流程(L3)`, or `应用系统(S1)` in visible page text.
- All department Sankey pages must use the **unified engine**: same helper functions (`isCollectiveRole`, `roleWarning`, `auditWarnings`, `acceptanceText`, `evidenceClass`, `trackingNote`, `a1DisplayLabel`), same `sankey_fb_v2_` storage key prefix, same `a1Index` structure with `sourceText` + per-field evidence fallbacks, and same 原文出处 block pattern in sidebar and tooltip.
- Detail table in domain view must include `业务能力（L2）` and `业务流程（L3）` columns (not just `业务行为（A1）编号`), plus `验收标准` using the `acceptanceText()` helper.
- Table CSS must use `table-layout: fixed` with column class widths; no `overflow-x: auto` or `min-width` values that cause horizontal scrollbars on common desktop widths (1440-1920px).

## Model Hierarchy

```
部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）
```

If module evidence exists, append `应用模块（S2）` as a supported detail layer under `应用系统（S1）`.

业务行为（A1） is the decomposition layer of 业务流程（L3）. Each 业务流程（L3） yields 3–8 业务行为（A1）.

## Stable L3 Identifier Rule

业务行为（A1） numbering must be anchored to a stable 业务流程（L3） identifier, not a volatile table row number.

- If the upstream mapping has `业务流程（L3）编号` or `业务流程编号`, use it directly.
- If the upstream mapping only has `序号`, create a stable `L3Key` from 部门（D1） + 能力域（L1） + 业务能力（L2） + 业务流程（L3） name + evidence citation, assign a stable 业务流程（L3） identifier once, and preserve it in the 业务行为（A1） mapping.
- Do not renumber existing 业务行为（A1） records just because the upstream mapping table was sorted, filtered, or had rows inserted. 不得因为表格排序、筛选或插入行而重排既有 业务行为（A1）编号。
- New 业务行为（A1） numbers follow `{稳定业务流程（L3）编号}-A{两位序号}`, for example `0103-A01`.

## 业务行为（A1） Granularity

One 业务行为（A1） = one role completing one independently describable task action.

A "task action" is a meaningful business step, not a system click. Examples:

- Correct: "提交危险作业申请" (one role, one action, one describable unit)
- Too fine: "点击提交按钮" (UI-level, not business-level)
- Too coarse: "完成危险作业审批" (contains multiple role transitions)

## 业务行为（A1） Master Record Fields

Each 业务行为（A1） is one row in the mapping table:

| Field | Type | Description |
|---|---|---|
| 业务行为（A1）编号 | auto | Grouped by stable 业务流程（L3） identifier, e.g. `0103-A01` |
| 业务行为（A1） | text | Role completing one independently describable task action |
| 执行角色 | text | Role or position performing the action |
| 执行角色依据 | text | Source quote, flowchart swimlane/node, or inference note supporting the role |
| 触发情景 | text | Event or condition that triggers this behavior |
| 触发情景依据 | text | Source quote, flowchart branch/node, or inference note supporting the trigger |
| 前置条件 | text | Preconditions that must be met before execution (separate from trigger: preconditions can be met while trigger has not fired) |
| 前置条件依据 | text | Source quote, flowchart upstream node, form state, or inference note supporting the precondition |
| 数据输入 | text | Data objects or forms consumed by this behavior |
| 数据输出 | text | Data objects or forms produced by this behavior |
| 输入来源部门 | text | Department providing data/message input; empty = internal |
| 输出目标部门 | text | Department receiving data/message output; empty = internal |
| 审批类型 | enum | `无审批` / `单人审批` / `多级审批` / `会签` |
| 应用系统（S1） | enum | OA/MES/PLM/ERP or blank with explanation; multiple separated by `、` |
| 应用模块（S2） | text | Optional module/menu/page under 应用系统（S1） when source or system design evidence supports it |
| 制度依据 | text | `文件号-版次《文件名》§条款号` |
| 证据类型 | enum | `原文明确-正文` / `原文明确-流程图` / `原文明确-表单` / `上下文推断` / `分析拆分` |
| 验收标准 | text | Required only for final L3 steps or last steps before cross-department handoff when `审批类型 = 无审批`; may be completion condition, output acceptance, review criterion, or record closure standard |
| 验收标准依据 | text | Source citation or `制度未明确，待补验收标准` |
| 核验提醒 | text | Department-facing confirmation prompt for role granularity, completion standard, weak evidence, or inference review |
| 部门确认意见 | text | Blank/review field for department reviewer feedback |
| 是否调整 | enum | `待确认` / `无需调整` / `需要调整` |
| 调整建议 | text | Department-provided correction, replacement wording, or responsibility clarification |
| 备注 | text | Gray areas not covered by source documents |

### Trigger vs Precondition

These are separate fields:

- **Precondition** is a state: "设备台账已建立", "人员资质已审核通过"
- **Trigger** is an event: "巡检发现设备异常", "申请人提交作业许可申请"

Preconditions can be met without the trigger firing. When the trigger fires while preconditions are met, the behavior executes.

### Evidence and Anti-Hallucination Rule

Do not label a 业务行为（A1） row as simply `原文明确`. Evidence must identify where each critical field came from:

- `执行角色` must be supported by a role name,岗位,流程图泳道, responsibility clause, form filler, or an explicit inference note.
- `触发情景` must be supported by a source event, timing clause, decision branch, upstream node, or explicit inference note.
- `前置条件` must be supported by source state, previous workflow node, required input, form state, or explicit inference note.

If the source is a flowchart image, mark the evidence type as `原文明确-流程图` and cite the visible node/swimlane/decision, not just the surrounding clause number. If the source is a form or ledger, mark `原文明确-表单`. If the field is inferred from neighboring clauses or workflow order, mark that field as `上下文推断` and explain the inference. A row may not be called fully explicit unless role, trigger, precondition, and action are all supported.

Never invent a plausible role, trigger, or precondition to make the table look complete. If support is insufficient, keep the value conservative and add a `核验提醒`.

### Concrete Execution Role Rule

`执行角色` must be a concrete role that can perform work, preferably a岗位/人员角色 such as `经营发展部绩效专员`, `采购经办人`, `合同评审负责人`, or a named approval role.

Department, office, center, committee, group, or team names such as `经营发展部`, `办公室`, `采购中心`, `评审小组`, `管理委员会` are not concrete execution roles. If the source only states a collective owner, keep the collective wording but mark:

- `核验提醒 = 请部门确认具体岗位/责任人：当前为部门/组织`
- H5/Sankey review prompt visible on the 业务行为（A1） node and detail table

Do not silently treat a department as a person-like actor.

### Completion Acceptance Rule

Do not require an acceptance standard for every `无审批` 业务行为（A1）. Acceptance standards are required only at control gates:

- the final 业务行为（A1） of a 业务流程（L3）
- the last 业务行为（A1） before handing data, materials, documents, or decisions to another department

中文口径：验收标准只要求在 业务流程（L3）的最终环节，或跨部门交接前的最后一个环节。

Middle steps such as drafting, collecting, preparing, communicating, checking progress, or maintaining a working draft do not need standalone acceptance standards unless the source document explicitly defines one.

For tracking-type tasks (`跟踪`, `进度`, `监测`, `监督`, `闭环`, `催办`, `提醒`), the preferred informatization design is not an artificial acceptance standard. 跟踪类任务应由信息化系统通过待办提醒、到期预警、状态看板、进度展示、超期提示和必要的闭环记录实现。

If a control-gate 业务行为（A1） has no approval flow and the source document does not state an acceptance or completion standard, do not invent one. Set:

- `验收标准 = 待补`
- `验收标准依据 = 制度未明确，待补验收标准`
- `核验提醒` includes `请部门确认是否需要验收/完成标准`

If a 业务行为（A1） is a middle step and not a cross-department handoff gate, set `验收标准 = 不适用-过程环节`. The H5 detail table should not alarm on that row.

### System Mapping Rule

Every 业务行为（A1） must identify system support, record carrier, or result write-back. Prefer OA/MES/PLM/ERP only when the source clauses or process logic support that mapping. If none of the four systems fits after careful analysis, leave `应用系统（S1）` blank and explain the record carrier or no-fit reason in `备注`.

Use `应用模块（S2）` only as a module/menu/page under a confirmed `应用系统（S1）`. Do not create a module name to compensate for an uncertain system mapping.

Do not force-fit a system just to avoid a blank field. Manual on-site actions often have results written back to a system, but that write-back must be evidenced or explicitly marked as an analysis-based inference.

中文口径：每个 业务行为（A1） 必须说明系统支撑、记录载体或结果回写；四类系统不适合时允许留空；不得为了避免空值而强行挂系统。

## Optional Sub-tables

### Approval Flow Sub-table

Required when `审批类型 ≠ 无审批`. One 业务行为（A1） may have multiple approval nodes.

| Field | Description |
|---|---|
| 节点序号 | Order in the approval chain |
| 审批角色 | Role or position that approves at this node |
| 审批条件 | Conditions under which this node is required (e.g. "金额>5000时触发") |
| 时限 | Time limit for approval response, if specified in source |

Extract from source file flow diagrams, approval matrices, or countersign matrices.

### Cross-department Transaction Sub-table

Required when `输入来源部门` or `输出目标部门` is non-empty.

| Field | Description |
|---|---|
| 协作部门 | The collaborating department |
| 协作事项 | Description of the collaborative matter |
| 我方职责 | Our department's responsibility in this transaction |
| 对方职责 | The other department's responsibility |
| 数据交换方向 | Direction of data flow: `接收` / `发送` / `双向` |

### Form/Ledger Sub-table

Required when source files include attached forms, templates, or ledgers relevant to this 业务行为（A1）.

| Field | Description |
|---|---|
| 表单名称 | Name of the form or ledger |
| 关键字段 | Key data fields in the form |
| 填报角色 | Role responsible for filling it out |
| 流转方向 | Where the form goes next |

## Process Flow Diagram Extraction

When source documents contain process flow diagrams (flowcharts, approval flow diagrams), do NOT write "参见原文件流程图" as a placeholder. Instead:

1. Extract the diagram into a standalone Markdown file per 业务流程（L3）.
2. Describe nodes, decision points, swimlanes (by role/department), and transitions.
3. Name the file `{部门名称}-{业务流程（L3）简称}-流程图.md` and place it alongside the mapping documents.
4. Reference this md file from the 业务行为（A1） records that use it.

The flowchart itself is a type of data — it documents process logic independently of the capability mapping.

## Cross-department Modeling

### In-department behavior with cross-department data flow

Use `输入来源部门` / `输出目标部门` fields. The behavior is executed by our department; the fields track where data comes from and goes to.

### Behavior where our department participates but another department leads

Set `执行角色` to our department's participation role (e.g. "参与审核", "协同签认"). Mark `证据类型 = 原文明确-正文` or `原文明确-流程图` if our source clauses or flowchart describe this participation. Do NOT expand the other department's internal behaviors — you don't have their documents.

**Rationale:**
1. Evidence chain stays within this department's documents — no guessing other departments' procedures.
2. `输入来源部门` / `输出目标部门` fields serve as future join keys for cross-department topology.
3. Avoids asymmetric modeling — each department maps its own 业务行为（A1） first; cross-department alignment is a downstream product, not an upstream input.

## Cross-department Completeness Check

After ALL departments have been mapped, produce an independent completeness report.

### Alarm Rule

If a 业务行为（A1） record from Department A has `输出目标部门 = Department B` (or `输入来源部门 = Department B`), but Department B has no corresponding system support (no 业务行为（A1） record, no source document, or no documented procedure covering this interaction), then **raise an alarm**.

### Report Fields

| Field | Description |
|---|---|
| 来源部门 | Department A |
| 目标部门 | Department B |
| 触发业务行为（A1） | The 业务行为（A1） in Department A that references Department B |
| 数据类型 | `数据输入` or `数据输出` |
| B部门状态 | `已映射-有对应业务行为（A1）` / `已映射-无对应业务行为（A1）` / `未映射` / `有制度文件-未建模` |
| 风险等级 | `高` = core business dependency; `中` = data/reporting dependency; `低` = informational |
| 建议 | Concrete action: "B部门需补充XX流程的A1行为" or "A部门与B部门需对齐XX数据口径" |

## Visualization Rules

Use these rules directly for post-BBM H5/HTML updates. The visualization task remains part of `business-behavior-mapping` whenever the page needs the 业务行为（A1） layer.

### Global Sankey (all-domain view)

Do NOT include 业务行为（A1） nodes. Keep the existing structure: `部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 应用系统（S1）`.

### Domain Detail Sankey (per L1 domain)

Structure: `业务能力（L2）→ 业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）`.

- Switchable by 能力域（L1）via tabs/buttons.
- 业务行为（A1） nodes must display `业务行为（A1）+ 执行角色`; do not display only the 业务行为（A1）编号 as the front-end node label. Keep 业务行为（A1）编号 in tooltip and detail table for traceability.
- The visible 业务行为（A1） layer/column must bind to the behavior-name field, not the identifier field. If records are stored as arrays like `[业务行为（A1）编号, 业务行为（A1）, 执行角色, ...]`, the Sankey label must use `row[1] + row[2]`, never `row[0]`.
- If the chart needs a stable unique key, keep 业务行为（A1）编号 as an internal node key or `meta.id`, then override the displayed node label with `label.formatter` or the equivalent rendering hook. The identifier may appear in tooltip or a separately named `业务行为（A1）编号` column, but it must never occupy the visible 业务行为（A1） layer.
- Tooltip must show: 业务行为（A1）编号, 业务行为（A1）, 执行角色, 触发情景, 前置条件, 审批类型, 制度依据, 证据类型, 应用系统（S1）, 应用模块（S2）, 核验提醒.
- Tooltip must include a **原文出处** section showing per-field evidence basis: 执行角色依据, 触发情景依据, 前置条件依据. These fields document WHERE in the source document each piece of information came from. The 制度依据 is the overall clause reference; the per-field evidence basis may be the same clause or more specific (e.g. a particular sentence, flowchart node, or form field).
- Only OA/MES/PLM/ERP appear as system nodes.
- System labels must not be clipped or truncated.
- If `执行角色` is a department/office/group/committee instead of a concrete role, show a visible warning on the 业务行为（A1） node and detail table.

### Detail Table

Columns: `序号 / 业务行为（A1）编号 / 业务能力（L2）/ 业务流程（L3）/ 业务行为（A1）/ 执行角色 / 触发情景 / 前置条件 / 审批类型 / 验收标准 / 制度依据 / 证据类型 / 应用系统（S1）/ 应用模块（S2）/ 核验提醒 / 部门确认意见 / 是否调整 / 调整建议`

- Table fits common desktop width without horizontal scroll.
- A table column named `业务行为（A1）` must show the behavior name/action text. Put the traceability code only in a separate column named `业务行为（A1）编号`, or in tooltip/detail metadata if the user asks to hide IDs.
- Long text wraps in 触发情景, 前置条件, 制度依据 columns.
- Sequence number column visible.
- Use subtle fill colors or left bands to visually group rows belonging to the same 业务流程（L3）. 明细表用浅色填充或左侧色带区分业务流程。
- For no-approval final rows or no-approval pre-handoff rows with no source-backed acceptance standard, show `请部门确认是否需要验收/完成标准` in 核验提醒. Do not alarm on ordinary middle steps.
- Include blank or placeholder department feedback fields so reviewers can mark `无需调整` / `需要调整` and provide corrections.

### Feedback Sidebar (A1 Click)

When a user clicks an 业务行为（A1） node or data row, a feedback sidebar/drawer opens. This sidebar must display 原文出处 (original text source) directly:

- **原文正文 (sourceText)**: A white card at the top of the 原文出处 block showing a synthesized readable evidence paragraph. This is the most important element — it proves concretely that the A1 behavior was identified from source documents, not invented. The paragraph reads like prose: "依据制度文件 XXX（证据类型），该条款明确由「角色」执行「行为名称」，触发情景为「…」，前置条件为「…」。审批类型：…，系统支撑：…。"
- **制度依据**: The overall clause reference (e.g. `GLTX-JY-04-A §5.1.1`).
- **原文出处区块**: A dedicated section showing per-field evidence basis (below the 原文正文 card):
  - 执行角色依据 — where the role assignment came from in the source
  - 触发情景依据 — where the trigger condition came from
  - 前置条件依据 — where the precondition came from
  - 证据类型 — the evidence classification for this row
- The 原文出处 section must appear before the feedback questions so the reviewer can verify evidence before answering.
- If a per-field evidence basis is the same as 制度依据 (common for `原文明确-正文` rows), display it concisely; if different (e.g. `上下文推断` rows with inference notes), display each field's unique basis.
- The feedback sidebar must also show the core A1 context (行为名称, 执行角色, 触发情景, 前置条件, 审批类型, 应用系统（S1）) alongside the evidence so reviewers can cross-reference.

**a1Index and sourceText Computation:**

Every BBM-updated H5 page must compute a `sourceText` (原文正文) field in the `a1Index` lookup. This field synthesizes the A1 data row `r[]` into a self-contained evidence paragraph that a department reviewer can read and verify against source documents. The computation pattern:

```javascript
var src = '依据制度文件 ' + (r[7] || '未标注') + '（' + (r[8] || '') + '），' +
  '该条款明确由「' + (r[2] || '') + '」执行「' + (r[1] || '') + '」，' +
  '触发情景为「' + (r[3] || '') + '」，前置条件为「' + (r[4] || '') + '」。' +
  '审批类型：' + (r[5] || '') + '，系统支撑：' + (r[6] || '') + '。';
a1Index[r[0]] = { ...other fields..., sourceText: src };
```

The `a1Index` must also include per-field evidence fallbacks (`roleEvidence`, `triggerEvidence`, `preconditionEvidence`) defaulting to `r[7]` (制度依据) when dedicated per-field evidence columns (r[9]-r[11]) are absent from the data array.

### Feedback System (Non-Negotiable Implementation Contract)

Every department Sankey HTML page must implement the following feedback system:

**Persistence (localStorage):**
- `feedbackState` must be persisted to `localStorage`, keyed as `sankey_fb_v<variant>_<department>_<a1Rows.length>`.
- On page load, restore `feedbackState` from localStorage before the first render.
- Provide a "清空本地反馈" button with a double-confirmation dialog (建议先导出备份 → 再次确认).

**Import/Export:**
- Export button: "导出反馈 JSON". Output includes `data_version` (department_total_date), `source_page` (current HTML filename), `schema_version` (fixed string), and per-feedback context fields (`domain`, `capability`, `process`, `system`, `evidence`, `evidenceType`).
- Import button: "导入反馈 JSON". Reads a previously exported JSON file via `<input type="file">`, merges entries by `a1_id` into `feedbackState`, persists, refreshes progress and node colors, and re-renders.

**Progress Accuracy:**
- `TOTAL = a1Rows.length` (dynamic, never hardcoded).
- Progress bar displays `completed / TOTAL` where `completed` counts only feedback entries with `row_confirmed` (Q1) answered (i.e., `isComplete(fb)` returns true).

**Click Handler Stability:**
- Use a single-point function `attachFeedbackHandlers(chart)` that unbinds and rebinds exactly one click listener.
- Do NOT monkey-patch `myChart.setOption` or any global render function to bind click.
- Call `attachFeedbackHandlers` after every render and once on init.
- Domain switching, render, and refresh must keep A1 nodes clickable.

**Completion State:**
- Feedback card title shows "已完成" (green) or "未完成" (red) badge based on `isComplete(fb)`.
- When re-opening a completed A1, pre-fill previously selected answers; allow overwrite.

**UX Constraints:**
- Zero external CDN dependencies; page must work offline when double-clicked.
- Zero comments added solely for the fix.
- Button labels: 导出反馈 JSON / 导入反馈 JSON / 清空本地反馈.
- All file operations are browser-local (no upload).

**Verification:**
- Click A1 node → select Q1=准确 → confirm → refresh page → progress persists.
- Export → clear → import → progress restored.

## Deliverables

For each department:

1. **Updated Markdown mapping document** — append or update `## 业务行为（A1）映射（BBM增补）` inside `{部门名}部门-能力-流程-系统映射关系.md`; master record table + sub-tables are grouped by 业务流程（L3） in that same document.
2. **Process Flow md files** — one per 业务流程（L3） that has flow diagram attachments.
3. **Updated H5/Sankey HTML** — update `{部门名}部门能力流程系统桑基图.html` in place; global view unchanged; domain detail views now include 业务行为（A1） layer. Do not leave a second behavior-named Sankey page beside it.
4. **Cross-department Completeness Report** — generated after ALL departments complete, per the alarm rule above.

## Success Pattern To Reuse

The successful BBM refinement pattern is:

1. Start from the DCM three-file output; do not create a parallel artifact set.
2. Treat 业务行为（A1） as review evidence, not as a polished final truth. Unsupported role, trigger, precondition, or acceptance details become核验提醒.
3. Use source language first. If a behavior or capability name sounds broader than the original title/clauses, either prove it from the source or keep the source-aligned wording.
4. Store stable IDs for traceability, but display human-readable business behavior and role to department reviewers.
5. Only require 验收标准 at final L3 steps or pre-cross-department handoff gates; do not alarm every draft/preparation step.
6. Use systems to support tracking tasks through待办提醒, 到期预警, 状态看板, 进度展示, and闭环记录 instead of inventing artificial acceptance standards.
7. Before final delivery, check the page like a reviewer would: Can the department see what to confirm, where the evidence came from, and whether the system mapping is believable?

## Verification Checklist

Before finalizing a department's 业务行为（A1） mapping:

- Gold-standard comparison has been performed against `docs/norms/经营发展部部门能力流程系统桑基图.html`; any deviation is intentional and improves readability.
- Terminology follows the project standard exactly: 部门（D1）, 办公室（D2）, 能力域（L1）, 业务能力（L2）, 业务流程（L3）, 业务行为（A1）, 业务行为（A2）, 应用系统（S1）, 应用模块（S2）.
- Every 业务流程（L3） has been decomposed into 3–8 业务行为（A1）.
- Every 业务行为（A1） has a unique clause-level evidence citation.
- Every 业务行为（A1）'s 证据类型 is explicitly marked as 原文明确-正文, 原文明确-流程图, 原文明确-表单, 上下文推断, or 分析拆分.
- 执行角色、触发情景、前置条件 each have a source-backed basis or an explicit inference note; no row hides unsupported content under a generic `原文明确`.
- Collective execution roles such as department/office/group/committee are visible department-confirmation prompts, not silent role values.
- Every final or pre-cross-department-handoff `无审批` 业务行为（A1） has a source-backed 验收标准, or a visible `请部门确认是否需要验收/完成标准` prompt. Ordinary middle steps are marked `不适用-过程环节`.
- H5/detail tables are suitable as a department review draft and include department feedback fields.
- No 业务行为（A1） uses "参见原文件流程图" — all flow diagrams have been extracted into standalone md files.
- Every 业务行为（A1） identifies system support, record carrier, or result write-back; blank system fields have a justified no-fit explanation in 备注.
- 输入来源部门 / 输出目标部门 fields are populated for all cross-department data flows.
- Approval sub-table is present for all 业务行为（A1） with 审批类型 ≠ 无审批.
- Form/ledger sub-table is present where source files contain attached forms.
- 业务行为（A1） count per 业务流程（L3） is consistent and auditable.
- Cross-department references are recorded for downstream completeness check.
- Post-BBM H5/HTML updates were handled by this skill; DCM was used only as upstream page/data reference.
- Only one canonical mapping Markdown exists per department in the department output folder: `{部门名}部门-能力-流程-系统映射关系.md`. No duplicate `{部门名}A1业务行为映射关系.md` remains when the standard DCM mapping document exists.
- Only one canonical Sankey HTML exists per department in the department output folder: `{部门名}部门能力流程系统桑基图.html`. No duplicate `{部门名}部门能力流程行为系统桑基图.html` remains when the standard DCM page exists.
- Domain detail Sankey renders without broken links, label clipping, or text overlap.
- Visible 业务行为（A1） nodes and the `业务行为（A1）` table column show behavior name/action text plus role where appropriate; they do not show 业务行为（A1）编号 as the main A1 value.
- Static H5 check finds no visible shorthand terms such as `业务行为(A1)`, `业务能力(L2)`, `业务流程(L3)`, or `应用系统(S1)`.
- Static H5 check finds no obvious identifier-label binding such as `a1id +`, `id + name`, or `row[0]` used as the visible A1 label unless a formatter overrides display to `业务行为（A1） + 执行角色`.
- Static H5 check finds no default horizontal-scroll table styling such as `overflow-x:auto`, `overflow:auto`, or large `min-width` values unless the user explicitly requested a wide audit table.
- Tooltip on domain-detail 业务行为（A1） nodes and edges includes 原文出处 (执行角色依据, 触发情景依据, 前置条件依据) in addition to the overall 制度依据.
- Feedback sidebar displays 原文出处 (制度依据 + per-field evidence basis) in a dedicated section before the feedback questions.
- Feedback sidebar 原文出处 block contains a **原文正文** white card at the top, showing a synthesized readable evidence paragraph (`sourceText`) that proves the A1 behavior was identified from source documents.
- `a1Index` includes `sourceText` computed from A1 data fields (r[1]-r[8]), plus per-field evidence fallbacks (`roleEvidence`/`triggerEvidence`/`preconditionEvidence`) defaulting to r[7] when dedicated columns are absent.
- All department Sankey pages share the **unified engine**: same helper function set (`isCollectiveRole`, `roleWarning`, `auditWarnings`, `acceptanceText`, `evidenceClass`, `trackingNote`, `a1DisplayLabel`), same `sankey_fb_v2_` storage key, same `a1Index` structure.
- Detail table in domain view includes `业务能力（L2）`, `业务流程（L3）`, and `验收标准` columns (minimum 17 columns).
- Table CSS uses `table-layout: fixed` without `overflow-x: auto` or `min-width` hardcoded values.
- Inline scripts parse successfully, and the page has been opened or screenshot-checked when a browser is available.
- For incremental runs: a `## 变更记录` section is appended with date, change type, impact scope, and description; deprecated 业务行为（A1） are marked with strikethrough, not deleted.
