---
name: process-evidence-mapping
description: >
  Use for Infomat process-governance work when converting or auditing department rules, procedures, standards, forms, ledgers, tables, flowcharts, flow-description spreadsheets, and source documents into one controlled evidence chain: recursive source inventory to leaf directories, DCM capability-process-system mapping, BBM business behavior (A1) decomposition, process-flow Markdown, form/ledger sub-tables, MDM requirements, Sankey HTML with visible original/inferred basis, cross-department checks, and source-vs-mapping consistency audits. Use this instead of separate department-capability-mapping or business-behavior-mapping for docs/norms work, especially when strict completeness, source coverage, flowchart/table extraction, H5 evidence presentation, or L3/A1 consistency matters.
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

## Vectorization Boundary

Text embeddings may be used only as an Evidence Retrieval & Similarity Assist Layer. They can retrieve candidate clauses, tables, form fields, flow nodes, object aliases, similar processes, approval-chain snippets, controlled-transfer snippets, near-duplicate files, and review gaps.

Embedding similarity is never final business evidence. Do not use vector similarity alone to conclude L3/A1 validity, object identity, input/output departments, approval type, source-company department mapping, portable process abstraction, MDM ownership, or Sankey links.

Any vector-retrieved item that influences DCM, BBM/A1, MDM requirements, H5 evidence display, or a review conclusion must keep its original source anchor and `evidence_status`. If the item is not verified against the original clause, table, form, ledger, attachment, or flowchart location, keep it in a candidate/review report and mark `候选`, `待确认`, or `未见证据，待补`.

For detailed rules, read `references/vector-evidence-rules.md`. For chunk and embedding fields, read `references/chunking-spec.md`. For regression examples, read `references/minimal-vector-evidence-example.md`.

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

You must recurse to the deepest available directory level. Do not stop at high-level folders such as `管理体系程序文件`, `记录表单`, `流程图`, `附件`, or any department folder just because the visible files seem sufficient. A source manifest is incomplete until every reachable leaf directory has been listed and classified.

Record at minimum:

| Field | Requirement |
|---|---|
| 叶子目录 | Deepest directory containing the file, relative to the department source folder |
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
| source_company | Source company if visible; mark external/reference sources instead of mapping them into current departments |
| source_org_name | Raw organization names appearing in the source |
| embedding_status | `not_used` / `chunked` / `embedded` / `unsupported` / `failed` / `待复核` |
| source_boundary_flag | `本公司制度` / `外部参考` / `历史模板` / `候选旧版` / `待复核` |

Also record empty or unreadable leaf directories as `待复核` with reason, such as no supported files, access/conversion failure, or visual/manual extraction required. Do not call the mapping complete while any reachable leaf directory or source file is unclassified.

If vector retrieval will be used, build a source embedding manifest after the source manifest. This manifest prepares stable IDs, hashes, and retrieval metadata; it does not decide whether a file is included or excluded.

### 2. Extract Source Evidence

Read source titles, responsibilities, clauses, form fields, ledgers, tables, and flow attachments before abstraction.

Source authors may not write with structured process thinking. The same object/action chain may be described through different words across正文, 职责表, 附件, 表单签批栏, formulas, and tables. Normalize expressions only after reading all relevant source artifacts:

- Group evidence by concrete object first, such as `绩效评分表`, `工作任务调整申请单`, `公司月度综合打分表`, `台账`, `报告`, or `通知`.
- Treat wording such as `核算结果`, `综合打分表`, `得分表`, `评分表`, and `绩效结果` as possible aliases only when the source context proves they refer to the same object.
- Build the object chain from source verbs and signature fields: `编制`, `填写`, `汇总`, `提交`, `校对`, `核对`, `审核`, `初审`, `审批`, `批准`, `发布`, `通报`, `归档`.
- Do not merge distinct objects just because they appear under the same heading. A source heading may cover multiple objects and multiple approval chains.
- Expression normalization helps locate evidence; it is not evidence by itself. If the concrete object, transfer, or approval chain cannot be shown, mark `未见...证据，待补`.

Use source-specific rules:

- `.docx`: inspect paragraphs, tables, and inline shapes. Embedded tables and images may contain workflow data.
- `.doc`: convert or mark conversion failure; do not silently ignore.
- `.xlsx/.xls`: inspect workbook sheets, headers, flow-description rows, forms, and ledgers.
- `.vsd/.vsdx`: treat as process-flow source even when content cannot be parsed directly; pair with any flow-description spreadsheet.
- `.jpg/.png`: treat as possible form/template/process evidence when filename or context indicates it.
- `_extracted/`, `~$`, generated reports, and helper scripts are not source unless the user explicitly says otherwise.

When auditing GLTX-JY-05-like monthly performance rows, read `references/gltx-jy-05-golden.md` for the regression example of object-chain reconstruction from unstructured wording.

If vector retrieval is used, chunk source evidence after extraction and before DCM/BBM abstraction. Chunk by source evidence unit, not by arbitrary document size:

- clauses and heading-scoped paragraph groups
- table rows with headers
- form field groups and signature blocks
- ledger rows and status/handoff fields
- Excel sheet/header/row groups
- flowchart nodes, edges, swimlanes, decisions, and approval nodes
- attachment titles, templates, instructions, and signature areas

Every chunk must retain `source_file`, `doc_no`, `version`, source location, raw text, artifact type, retrieval method, vector model metadata if embedded, and review status. A chunk without a traceable original location cannot support DCM, BBM/A1, MDM, or Sankey conclusions.

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

Legacy template rule:

- If an existing A1 table is an older skill-generated table with missing BBM columns, treat it as skill/template migration debt, not as department source error.
- First perform a mechanical table migration: preserve existing cells in their matching fields, add missing columns, and use `旧模板未采集，待补`, `—`, or `待确认` for fields the old template did not collect.
- Do not infer trigger, precondition, data input/output, cross-department fields, acceptance basis, or department feedback while migrating old tables.
- If a row is visibly column-shifted, only move values when the value shape proves it (for example file number or `§` belongs in `制度依据`, and evidence-type enum belongs in `证据类型`). Otherwise keep the fact in `备注` and mark it for review.
- External actors or generic parties found in old template fields, such as 客户, 供应商, 银行, 主管部门, or 相关部门, must not be moved into `输入来源部门` / `输出目标部门` during migration unless controlled-transfer evidence is present.

Rules:

- Each 业务流程（L3） should usually have 3-8 业务行为（A1）. Document exceptions.
- Each A1 must hang on a DCM L3. If not, first update/merge the DCM L3.
- One A1 = one role performing one independently describable business action.
- Abstracted A1 names must be anchored back to a concrete source object or source action. If the row says `分析拆分` or `上下文推断`, the row must still identify what it was abstracted from, such as a named form, table, ledger, report, workflow node, or clause phrase. Put the source anchor in `制度依据`, `验收标准依据`, `备注`, or `核验提醒` using wording like `抽象自：公司月度综合打分表编制/校对/审核/批准链`.
- Do not let an abstracted verb such as `汇总核算`, `确认`, `处理`, `跟踪`, or `形成结果` create new facts by itself. The output object, approval chain, execution role, and target department must still come from the source object or clause. If the source names a specific object such as a form/table/report, prefer that object name over a generic `结果`, `数据`, or `材料`.
- `执行角色` should be a concrete role. If source only says department/group/committee, keep it but add `请部门确认具体岗位/责任人：当前为部门/组织`.
- Keep trigger and precondition separate.
- `证据类型` must be exactly one of: `原文明确-正文`, `原文明确-流程图`, `原文明确-表单`, `上下文推断`, `分析拆分`.
- Do not use generic `原文明确`.
- If role, trigger, precondition, or action is inferred, the relevant basis field must say how it was inferred.
- `审批类型` is evidence-controlled, not business-logic-controlled. Use `单人审批` only when the source shows one approving role for the same output object and no other review/approval/calibration/issuance node in that object's chain. Use `多级审批` or `会签` when the same object has multiple approval/control nodes such as `校对`, `核对`, `审核`, `审定`, `批准`, `会签`, `签发`, `复核`, or `初审`. Preparation nodes such as `编制`, `填写`, or `汇总` identify the object chain but do not by themselves turn one approving role into multi-level approval. Use `无审批` only after checking the source step and finding no approval/review/sign-off node for that action.
- If an A1 is abstracted (`分析拆分` / `上下文推断`) and the row sets `单人审批`, `多级审批`, or `会签`, the approval-chain evidence must be visible in the row's basis fields or remarks. A person or department placed in `输出目标部门` is not approval evidence.
- If `输入来源部门` or `输出目标部门` is non-empty, the visible 业务行为（A1） text must include a cross-department marker.
- `输入来源部门` / `输出目标部门` may only name a department when the source contains 受控传递证据 (controlled transfer evidence): a clause, flowchart arrow, form routing, ledger handoff, sign-off, notice, issuance, feedback, receipt, or equivalent handoff record showing the output object moves between departments.
- Do not put 依据来源, attachment/checklist owners, 执行主体, collaboration participants, approval actors, archive recipients, or external action owners into `输入来源部门` / `输出目标部门` unless that same source also proves a controlled transfer of a concrete output object.
- If the source only says an action is "based on" another department's document, lists that document as a preparation item, or names another department as responsible, keep that fact in `前置条件依据`, `制度依据`, `备注`, or `核验提醒`; write `未见受控传递证据，待补` rather than inferring an input/output department.
- Every A1 must identify system support, record carrier, or no-fit reason.
- If any A1 field was discovered through vector retrieval, the row must cite the verified original source anchor in the relevant basis field or `备注`. Vector-retrieved candidates default to review-only and must not populate `输入来源部门`, `输出目标部门`, `审批类型`, object identity, or final A1 text until `evidence_status=confirmed` through original source verification.

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
- Capability-domain tabs, section titles, filters, cards, and legend labels must show the covered level range. Do not use bare `能力域`; write labels such as `能力域（L1-L3）` for a view that drills from L1 through L3, or `能力域（L1-A1）` when A1 is included.
- Process-column labels must include a visible sequence or stable L3 code, such as `L3-04 月度绩效评分...` or `04 月度绩效评分...`; do not leave the sequence only in tooltip or hidden data.
- Behavior-column labels must include a visible A1 sequence or stable A1 code plus the action and role, such as `A04 编制公司月度综合打分表｜经营发展部部长`. Keep the full `业务行为（A1）编号` in tooltip/table as well, but do not hide all sequence information from the chart.
- Every node, link, tooltip, and detail-table row must expose an evidence basis. For source-backed items, show the original citation and a short source excerpt or object-chain phrase. For inferred items, show the inference basis, the original anchor used, and the missing evidence that still needs confirmation.
- Use a visible evidence legend and color system. `原文明确-正文` / `原文明确-流程图` / `原文明确-表单` use the normal palette. `上下文推断` and `分析拆分` must use a clearly different warning color on the node/link/detail badge. Evidence gaps such as `未见...证据，待补` must use a separate stronger warning or outline. Do not let inferred nodes or links share the same visual treatment as original-evidence nodes.
- Apply the same inference color rule anywhere the inferred conclusion appears: Sankey node, Sankey link, tooltip, side panel, detail table, filter chips, and exported/static embedded data if present.
- Show review prompts for collective roles, inferred fields, blank systems, weak evidence, and any cross-department field lacking controlled-transfer proof.
- If evidence was found through vector retrieval, show retrieval method and source verification status in tooltips or detail rows. Do not display similarity score as evidence strength. Unverified vector candidates must stay in a candidate/review panel or audit report, not in formal Sankey links.
- Include `序号`, `部门确认意见`, `是否调整`, and `调整建议` in detail tables.
- Avoid horizontal scrolling unless the user explicitly requests an audit-wide table.
- For `docs/norms/` pages, use `<script src="echarts.min.js"></script>`.

## Hard Quality Gates

Do not call work complete until these gates have been checked:

1. **Source coverage gate**: every reachable leaf directory has been inspected, and every source file or unreadable/empty leaf directory is `纳入`, `排除`, or `待复核` with reason.
2. **DCM gate**: every L3 has source-backed L1/L2 names, clause-level evidence, S1 value or blank explanation, and system design basis.
3. **A1 attachment gate**: every A1 maps to an existing DCM L3.
4. **A1 field gate**: every A1 table has all required columns.
5. **Evidence gate**: role, trigger, precondition, action, system support, and acceptance/control gates are source-backed or explicitly inferred. Any abstracted A1 must show the concrete source object/action it was abstracted from; approval type, output object, and target role/department cannot be concluded from the abstract verb alone.
6. **Flow gate**: every source flowchart/flow model/flow-description artifact is either extracted to Markdown or listed in an unresolved flow register.
7. **Form/table gate**: every process-relevant form/table/ledger is in a form/ledger sub-table or listed with an exclusion reason.
8. **Cross-department gate**: every input/output department reference is marked in A1 text, backed by controlled transfer evidence, and prepared for completeness checking; basis-only, role-only, approval-only, archive-only, or external-executor-only references must be moved to basis/remarks/review prompts.
9. **HTML gate**: canonical H5 only; no second behavior HTML; visible labels and static asset path follow project rules. H5 must show original or inferred basis for nodes, links, and detail rows, with all inferred/analysis-split items colored differently from original-evidence items and explained in a legend. Capability-domain labels must include the covered L-level range, and visible process/behavior columns must include sequence numbers or stable codes for review alignment.
10. **Validation gate**: run applicable scripts and explain all remaining BLOCK/WARN items.
11. **Vector evidence gate**: every vector-retrieved candidate used in DCM, BBM/A1, MDM, Sankey, or review conclusions must be backed by original source evidence and carry `evidence_status=confirmed`. Similarity score, nearest-neighbor result, alias clustering, or semantic resemblance is not evidence. Unconfirmed vector results remain in candidate/review reports and must not populate final L3/A1, approval type, input/output department, source-company department mapping, or Sankey links.

If any gate fails, produce a整改清单 with severity and do not present the result as final.

## Validation Commands

Optional vector retrieval support, when used:

```powershell
node .agents/skills/process-evidence-mapping/scripts/source-chunker.mjs --root docs/norms --out build/evidence/evidence_chunks.jsonl
node .agents/skills/process-evidence-mapping/scripts/build-embedding-manifest.mjs --chunks build/evidence/evidence_chunks.jsonl
node .agents/skills/process-evidence-mapping/scripts/evidence-retriever.mjs --query "绩效结果 综合打分表 核算结果" --top-k 8
node .agents/skills/process-evidence-mapping/scripts/check-similarity-not-evidence.mjs --root docs/norms --no-fail
```

The vector commands only create candidate/review artifacts. They do not replace source extraction, parser generation, or DCM/BBM validation.

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
