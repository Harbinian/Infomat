---
name: process-evidence-mapping
description: >
  Use for Infomat process-governance work when converting or auditing department rules, procedures, standards, forms, ledgers, tables, flowcharts, flow-description spreadsheets, and source documents into one controlled evidence chain: DCM capability-process-system mapping, BBM business behavior (A1) decomposition, process-flow Markdown, form/ledger sub-tables, MDM requirements, Sankey HTML, cross-department checks, and source-vs-mapping consistency audits. Use this instead of separate department-capability-mapping or business-behavior-mapping for docs/norms work, especially when strict completeness, source coverage, flowchart/table extraction, or L3/A1 consistency matters.
---

# Process Evidence Mapping

This is the canonical Infomat skill for end-to-end process evidence mapping. It replaces separate DCM-first and BBM-later execution for `docs/norms` work.

The controlling idea is simple: **one source inventory, one evidence chain, one mapping document, one H5 page, one validation gate**. Do not let 能力域（L1）/业务流程（L3）, 业务行为（A1）, forms, flowcharts, and tables drift into separate truths.

## Operating Stance

- Spend the tokens needed to read the source evidence. For this workflow, incompleteness is more expensive than context usage.
- Treat workflows, forms, tables, ledgers, attachments, and flow diagrams as source evidence, not decoration.
- Produce a department review draft when evidence is incomplete. Do not smooth weak evidence into confident wording.
- Prefer explicit evidence over inference. Inference is allowed only when marked, explained, and made reviewable.
- The analysis object is the business process, not the application system.

## Required Repository Context

Before any cross-directory task, read:

1. `REPOSITORY_BOUNDARY.md`
2. `DIRECTORY_OWNERSHIP.md`
3. `MAINLINE_MAP.md`
4. `docs/norms/CLAUDE.md`
5. `docs/organization/组织架构和部门职责.md`

Respect current project rules:

- `docs/norms/` is the process-data source area.
- Department Sankey pages under `docs/norms/` must use local ECharts: `<script src="echarts.min.js"></script>`.
- PMO dashboards under `pmo/` use project-root ECharts relative to that page.
- MDM is never an employee-facing 应用系统（S1）.

## Canonical Deliverables

For each department, maintain exactly these canonical department outputs:

1. `{部门名}部门-能力-流程-系统映射关系.md`
2. `{部门名}能力层与MDM建设要求.md`
3. `{部门名}部门能力流程系统桑基图.html`

Add supporting evidence files only when they are source-derived:

- `{部门名}-{业务流程（L3）简称}-流程图.md` for each source flowchart/flow model used by A1.
- Tables/forms extracted from source documents when they carry process logic, approval chains, fields, ledgers, or templates.
- Cross-department completeness report after all involved departments have been mapped.

Do not create parallel deliverables such as `{部门名}A1业务行为映射关系.md` or `{部门名}部门能力流程行为系统桑基图.html`. Merge any legacy duplicates back into the canonical Markdown and HTML.

## Terminology Contract

Use these exact names everywhere:

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

Use `办公室（D2）`, `业务行为（A2）`, and `应用模块（S2）` only when source evidence supports the extra layer.

## End-To-End Workflow

### 1. Build The Source Manifest

Inventory every file under the department source folder before naming capabilities or behaviors.

Record at minimum:

| Field | Requirement |
|---|---|
| 文件路径 | Repository-relative path |
| 文件名称 | Full filename |
| 文件号 | Extract from content or filename; mark `待分配编号` if absent |
| 版次 | Extract from content when possible; mark `?` only after failed extraction |
| 文件类型 | Procedure, standard, form, ledger, flow model, flow description, image/template, reference copy, change record |
| 大小/修改时间 | For change detection |
| 正文哈希 | When text can be extracted |
| 表格数/图示数 | For docx/doc/pdf/xlsx where inspectable |
| 处理状态 | `纳入` / `排除` / `待复核` |
| 处理理由 | Required for every excluded or deferred file |

Do not call the mapping complete while source files are unclassified.

### 2. Extract Source Evidence

Read source titles, responsibilities, clauses, form fields, ledgers, tables, and flow attachments before abstraction.

Use source-specific rules:

- `.docx`: inspect paragraphs, tables, and inline shapes. Embedded tables and images may contain workflow data.
- `.doc`: convert or mark conversion failure; do not silently ignore.
- `.xlsx/.xls`: inspect workbook sheets, headers, flow-description rows, forms, and ledgers.
- `.vsd/.vsdx`: treat as process-flow source even when content cannot be parsed directly; pair with any flow-description spreadsheet.
- `.jpg/.png`: treat as possible form/template/process evidence when filename or context indicates it.
- `_extracted/`, `~$`, generated reports, and helper scripts are not source unless the user explicitly says otherwise.

### 3. Build Or Update DCM

Create or update the DCM main table inside `{部门名}部门-能力-流程-系统映射关系.md`.

Required DCM columns:

`序号 / 部门（D1） / 能力域（L1） / 业务能力（L2） / 业务流程（L3） / 制度依据（文件号/条款） / 应用系统（S1） / 系统设计依据`

Rules:

- Name 能力域（L1） and 业务能力（L2） from source titles, clause headings, repeated terms, responsibilities, or forms.
- Keep 业务流程（L3） executable and concrete.
- Every 业务流程（L3） must cite file number, revision/name, and clause number. Use `待分配编号《文件名》§条款号` when no file number exists.
- If the source has only a form/table/flowchart, cite that artifact explicitly.
- Use only OA, MES, PLM, ERP, or blank for 应用系统（S1）. Blank values require a no-fit explanation in 系统设计依据.
- Put MDM objects only in the MDM requirements document, never as 应用系统（S1）.

### 4. Freeze Stable L3 Keys Before A1

Before decomposing A1, create or verify stable 业务流程（L3） identifiers.

- Use existing `业务流程（L3）编号` if present.
- Otherwise derive a stable key from 部门（D1） + 能力域（L1） + 业务能力（L2） + 业务流程（L3） + evidence citation.
- Never renumber existing A1 just because DCM rows were sorted or new rows inserted.

### 5. Build Or Update BBM Inside The Same Markdown

Append or update `## 业务行为（A1）映射（BBM增补）` inside the canonical mapping document.

Every A1 row must include these columns:

`业务行为（A1）编号 / 业务行为（A1） / 执行角色 / 执行角色依据 / 触发情景 / 触发情景依据 / 前置条件 / 前置条件依据 / 数据输入 / 数据输出 / 输入来源部门 / 输出目标部门 / 审批类型 / 应用系统（S1） / 应用模块（S2） / 制度依据 / 证据类型 / 验收标准 / 验收标准依据 / 核验提醒 / 部门确认意见 / 是否调整 / 调整建议 / 备注`

Rules:

- Each 业务流程（L3） should usually have 3-8 业务行为（A1）. Document exceptions.
- Each A1 must hang on a DCM L3. If not, first update/merge the DCM L3.
- One A1 = one role performing one independently describable business action.
- `执行角色` should be a concrete role. If source only says department/group/committee, keep it but add `请部门确认具体岗位/责任人：当前为部门/组织`.
- Keep trigger and precondition separate.
- `证据类型` must be exactly one of: `原文明确-正文`, `原文明确-流程图`, `原文明确-表单`, `上下文推断`, `分析拆分`.
- Do not use generic `原文明确`.
- If role, trigger, precondition, or action is inferred, the relevant basis field must say how it was inferred.
- If `输入来源部门` or `输出目标部门` is non-empty, the visible 业务行为（A1） text must include a cross-department marker.
- `输入来源部门` / `输出目标部门` may only name a department when the source contains 受控传递证据 (controlled transfer evidence): a clause, flowchart arrow, form routing, ledger handoff, sign-off, notice, issuance, feedback, receipt, or equivalent handoff record showing the output object moves between departments.
- Do not put 依据来源, attachment/checklist owners, 执行主体, collaboration participants, approval actors, archive recipients, or external action owners into `输入来源部门` / `输出目标部门` unless that same source also proves a controlled transfer of a concrete output object.
- If the source only says an action is "based on" another department's document, lists that document as a preparation item, or names another department as responsible, keep that fact in `前置条件依据`, `制度依据`, `备注`, or `核验提醒`; write `未见受控传递证据，待补` rather than inferring an input/output department.
- Every A1 must identify system support, record carrier, or no-fit reason.

### 6. Extract Flow Diagrams

If source files include flowcharts, approval diagrams, `.vsd/.vsdx`, flow-description spreadsheets, process images, or embedded flow diagrams, do not leave them as `参见原文件流程图`.

Create a standalone flow Markdown per used process:

`{部门名}-{业务流程（L3）简称}-流程图.md`

Include:

- source file path
- related 业务流程（L3）
- swimlanes or roles
- nodes
- decision points
- transitions
- approval nodes
- forms/records produced
- A1 rows supported by this flow
- unresolved parsing or visual-inspection gaps

If the flow cannot be parsed, still create a review note or register entry with source path and required manual extraction.

### 7. Extract Forms, Ledgers, Tables

Create or update form/ledger sub-tables when source files include forms, templates, ledgers, or tables relevant to A1.

Required form/ledger fields:

`表单名称 / 来源文件 / 关键字段 / 填报角色 / 流转方向 / 关联业务流程（L3） / 关联业务行为（A1） / 是否已纳入系统字段候选 / 待确认事项`

Rules:

- Do not count a form as covered just because its parent procedure is cited.
- If a form carries approval signatures, statuses, handoff fields, or ledger fields, reflect that in A1 or the form sub-table.
- Keep sample data out of extracted tables unless it is needed to explain a field. Mark uncertain examples for review.
- Excel tables should usually preserve headers, field names, sheet names, and instructions; avoid preserving filled-in production data.

### 8. Build MDM Requirements

In `{部门名}能力层与MDM建设要求.md`, identify backstage data-governance needs from L3/A1 evidence:

- master data objects
- code rules and classifications
- statuses and lifecycle states
- responsible departments/roles
- effective periods
- cross-system references
- quality rules
- golden-source candidates

Do not convert MDM into 应用系统（S1）.

### 9. Update The H5 Page

When updating `{部门名}部门能力流程系统桑基图.html`:

- Preserve the all-domain view as `部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 应用系统（S1）`.
- Add domain-detail views as `业务能力（L2）→ 业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）`.
- Use `业务行为（A1） + 执行角色` as visible A1 node labels; keep IDs in tooltip/table only.
- Show review prompts for collective roles, inferred fields, blank systems, and weak evidence.
- Include `序号`, `部门确认意见`, `是否调整`, and `调整建议` in detail tables.
- Avoid horizontal scrolling unless the user explicitly requests an audit-wide table.
- For `docs/norms/` pages, use `<script src="echarts.min.js"></script>`.

## Hard Quality Gates

Do not call work complete until these gates have been checked:

1. **Source coverage gate**: every source file is `纳入`, `排除`, or `待复核` with reason.
2. **DCM gate**: every L3 has source-backed L1/L2 names, clause-level evidence, S1 value or blank explanation, and system design basis.
3. **A1 attachment gate**: every A1 maps to an existing DCM L3.
4. **A1 field gate**: every A1 table has all required columns.
5. **Evidence gate**: role, trigger, precondition, action, system support, and acceptance/control gates are source-backed or explicitly inferred.
6. **Flow gate**: every source flowchart/flow model/flow-description artifact is either extracted to Markdown or listed in an unresolved flow register.
7. **Form/table gate**: every process-relevant form/table/ledger is in a form/ledger sub-table or listed with an exclusion reason.
8. **Cross-department gate**: every input/output department reference is marked in A1 text, backed by controlled transfer evidence, and prepared for completeness checking; basis-only, role-only, approval-only, archive-only, or external-executor-only references must be moved to basis/remarks/review prompts.
9. **HTML gate**: canonical H5 only; no second behavior HTML; visible labels and static asset path follow project rules.
10. **Validation gate**: run applicable scripts and explain all remaining BLOCK/WARN items.

If any gate fails, produce a整改清单 with severity and do not present the result as final.

## Validation Commands

After modifying department mapping Markdown:

```powershell
node scripts/parse-sankey-data.mjs
node scripts/check-dcm-bbm.mjs --no-fail
```

Interpret script findings against current repository rules. If the script contract conflicts with AGENTS rules, report the conflict and do not blindly follow the stale contract.

After modifying HTML, open or screenshot-check the page when a browser tool is available.

## Incremental Execution

Default to incremental execution unless the user explicitly requests a full rebuild.

Before editing:

- compare source manifest to current source files
- identify changed/new/deleted files
- compare DCM L3 list
- compare A1 IDs and evidence citations
- identify flow/form/table artifacts newly added or no longer referenced

Only reprocess affected evidence, but still run all quality gates over the resulting department document.

Append change records instead of silently rewriting history. Deprecated L3/A1 rows stay with strikethrough and `已废止` notes.

## Reporting Format

When auditing consistency, report:

- department summary table
- source coverage by type
- DCM issues
- BBM issues
- flowchart extraction gaps
- form/table/ledger gaps
- cross-department gaps
- system-boundary issues
- static-asset or quality-script contract conflicts
- prioritized整改顺序

Use `未命中` as a review signal, not as proof of error. Explain possible reasons such as reference copy, duplicate version, change record, cover page, or non-owner department evidence.
