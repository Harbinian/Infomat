---
name: department-capability-mapping
description: Use when turning department-submitted rules, procedures, standards, forms, ledgers, and process documents into department-capability-process-system mappings, MDM requirements, and Sankey-style visualization deliverables. Especially useful for Chinese enterprise informatization planning, capability abstraction, process evidence tracing, and OA/MES/PLM/ERP application mapping.
metadata:
  short-description: 部门（D1）能力流程系统映射
---

# Department Capability Mapping

Use this skill to convert departmental management documents into:

- `部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 业务流程（L3）→ 应用系统（S1）` mappings
- capability-layer and MDM requirements
- evidence-backed Markdown tables
- Sankey-style HTML visualizations

For a complete reusable prompt kit, read `references/prompts.md`.

## Canonical Deliverable Contract

For each department, DCM owns exactly these formal deliverables:

1. `{部门名}部门-能力-流程-系统映射关系.md`
2. `{部门名}能力层与MDM建设要求.md`
3. `{部门名}部门能力流程系统桑基图.html`

Do not create alternate deliverables such as `{部门名}A1业务行为映射关系.md`, `{部门名}部门能力流程行为系统桑基图.html`, `{部门名}业务能力系统图.html`, or any second naming口径 beside the three canonical files. If legacy duplicates already exist, consolidate back into the three canonical files before final delivery.

`{部门名}能力层与MDM建设要求.md` is a DCM output. BBM may later contribute behavior-level evidence or MDM gap suggestions, but the formal MDM requirements document remains part of the DCM three-file delivery set. MDM must never appear as 应用系统（S1）.

## Gold Standard Reference

Use `docs/norms/经营发展部部门能力流程系统桑基图.html` as the project gold-standard H5 reference when building or repairing department Sankey pages. Match its delivery principles:

- The page starts with the actual working view, not a landing page or narrative cover.
- The all-domain view preserves `部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 应用系统（S1）`.
- Domain filtering, stats cards, legends, tooltips, and detail tables use the exact project terminology with codes.
- The detail table is readable without horizontal scrolling on normal desktop widths.
- OA/MES/PLM/ERP labels are fully visible and not clipped.
- Uncertainty is made reviewable in tables/notes instead of being hidden by polished wording.

Do not freestyle a new visual language when a gold-standard page exists. Reuse the same information architecture, interaction posture, and reviewer-facing tone unless the user explicitly asks for a redesign.

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

`办公室（D2）` and `应用模块（S2）` are optional layers: include them only when the department organization or system evidence supports office-level ownership or module-level mapping. `业务行为（A1）/业务行为（A2）` belong to the downstream behavior-mapping layer; DCM should not create them unless the user explicitly asks for behavior decomposition.

## Incremental Execution Protocol

Unless the user explicitly requests a full rebuild, always perform incremental execution:

### Step 0: Detect Change Scope

Before any abstraction work, check what has changed since the last mapping:

| Dimension | Detection Method | Triggered Action |
|---|---|---|
| Source file changes | Compare file path, file number, revision, name, size, modified time, and extracted-text hash against the previous source manifest | Re-inventory changed files; re-abstract affected capabilities and processes |
| Existing mapping state | Read existing `{部门名}部门-能力-流程-系统映射关系.md`; extract current 业务流程（L3） list | New 业务流程（L3） → add mapping; removed 业务流程（L3） → mark as deprecated |
| Downstream 业务行为（A1） state | Check whether `{部门名}部门-能力-流程-系统映射关系.md` contains a `## 业务行为（A1）映射（BBM增补）` section | Exists → warn user that 业务行为（A1） decomposition may need sync after 业务流程（L3） changes |

Maintain a lightweight source manifest when possible: `文件路径 / 文件名称 / 文件号 / 版次 / 文件大小 / 修改时间 / 正文哈希 / 备注`. If file number and revision are unchanged but the extracted-text hash changes, treat it as `条款修订` and re-validate the affected 业务能力（L2）/业务流程（L3） rows instead of assuming no change.

### Step 1 Routing

- No existing mapping file → **full build** (follow Workflow steps 1–9 below).
- Existing mapping file → **incremental**: only re-process changed source files, add/update affected rows in the mapping table, append a change record. Do NOT re-read or re-abstract unchanged source files.
- Full rebuild requested by user → ignore existing artifacts, start from scratch.

### Change Record

Append changes to the end of the mapping document under `## 变更记录`:

```
### YYYY-MM-DD 变更

| 变更类型 | 影响范围 | 说明 |
|---|---|---|
| 新增制度 | 业务能力（L2）: {capability} | {file number} {revision} 新增，补充 业务流程（L3） |
| 文件升版 | 业务流程（L3）: {process} | {file number} V{x}→V{y}，{change description} |
| 文件废止 | 业务流程（L3）: {process} | 标记对应流程为"已废止"，保留历史记录不删除 |
| 条款修订 | 业务流程（L3）: {process} | {file number} §{clause} 修订，{change summary} |
```

- Do NOT rewrite the entire document for incremental changes.
- Deprecated processes stay in the table with a strikethrough prefix and "已废止" note; never delete rows, preserve audit trail.
- Sankey HTML only re-renders when mapping data actually changes.

## Core Position

Most departments cannot directly submit capability/process mappings. Treat their rules, procedures, standards, forms, ledgers, flow descriptions, and templates as the source material. The agent performs abstraction:

- **Business capability (业务能力（L2）)**: abstract, stable business ability, usually noun phrase, but its wording must be supported by source document titles, clause headings, or repeated in-document concepts.
- **Business process (业务流程（L3）)**: executable work sequence or management routine, usually verb/object or workflow phrase.
- **Document evidence**: file number + revision + document name + original clause/paragraph numbers.
- **Application system (应用系统（S1）)**: employee-facing system only.

## Required System Boundary

When mapping business processes to application systems, only use:

- `OA`
- `MES`
- `PLM`
- `ERP`

Do not use MDM as an application system. MDM may appear only in a separate backstage data-governance/MDM requirements section or document.

If none of the four systems fits a process, leave the system field blank and explain why.

MES can be used as:

- a shop-floor or field task management platform
- an equipment/facility status and maintenance platform
- a collector or consumer of equipment, monitoring, energy metering, and inspection data

## Workflow

1. **Collect source files**
   - Ask for departmental rules, procedures, standards, forms, ledgers, flow descriptions, and system screenshots if available.
   - Do not ask department heads to invent capability architecture first.

2. **Inventory the document set**
   - Extract document name, file number, revision, type, department, process group, and notes.
   - Identify missing numbers, empty files, draft files, and duplicate/replaced files.

3. **Abstract capability layers**
   - Group documents by management theme.
   - Produce 能力域（L1）, 业务能力（L2）, and 业务流程（L3） clusters.
   - Prefer 5-9 能力域（L1） and readable 业务能力（L2） nodes.
   - Name 业务能力（L2） conservatively: prefer terms already present in document titles, clause headings, roles, forms, or repeated source text.
   - If adding broader words to a capability name, verify the source clauses prove that broader meaning. Otherwise keep the broader interpretation in the process description or notes instead of the capability label.

4. **Validate terminology against evidence**
   - Compare every 业务能力（L2） name with the source title and cited clauses before finalizing.
   - Flag capability names that introduce unsupported scope words such as strategy, governance, performance, risk, lifecycle, resource, or compliance.
   - Rewrite unsupported capability names to source-aligned wording, or add explicit evidence explaining why the broader name is justified.

5. **Map processes**
   - Consolidate multiple procedures/forms into one business process when they serve one management purpose.
   - Keep process names concrete enough to be auditable.

6. **Attach evidence**
   - For every process, cite specific evidence as:
     `文件号-版次《文件名》§条款号`
   - If a file number is pending, write `待分配编号《文件名》§条款号`.
   - If a file is empty or unavailable, state `文件为空，条款待补` or `文件未提供，条款待补`.
   - Avoid vague evidence such as only listing document names.

7. **Map application systems**
   - Choose among OA/MES/PLM/ERP only.
   - Multiple systems may be listed with `、`.
   - Leave blank when no system fits.
   - Provide a design basis for each mapped system.

8. **Separate MDM requirements**
   - Identify stable data objects, codes, classifications, statuses, responsibilities, lifecycle states, effective periods, and cross-system references.
   - Start from generic master-data reviewItems such as customer, supplier, contract, project, order, product/material, organization, role/person, form template, code rule, classification, status, and effective period; then add department-specific objects only when the source documents support them.
   - Present these as MDM construction requirements, not employee-facing workflow systems.

9. **Produce deliverables**
   - `{部门名}部门-能力-流程-系统映射关系.md`.
   - `{部门名}能力层与MDM建设要求.md`.
   - `{部门名}部门能力流程系统桑基图.html` if requested.
   - In the Sankey, include evidence and system design basis in table and tooltips.

## Visualization Rules

For HTML Sankey pages:

- Match the organization style if a reference page exists; for this project, treat `docs/norms/经营发展部部门能力流程系统桑基图.html` as the default reference page.
- Use ECharts Sankey when available.
- Provide all-domain view and domain-detail views.
- Default to the standard left-to-right Sankey layout for capability/process/system mappings. If a department has many flows or crowded labels, provide top-to-bottom as an optional layout toggle, but do not make it default unless the user explicitly asks for it.
- Do not remove the business capability layer from the Sankey just to reduce clutter. If the all-domain view is dense, keep `部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 应用系统（S1）` and use compact/numbered capability labels, filtering, or a layout toggle.
- Show stats: department count, 能力域（L1）, 业务能力（L2）, 业务流程（L3）, 应用系统（S1）.
- Show table columns:
  `序号 / 部门（D1）/ 能力域（L1）/ 业务能力（L2）/ 业务流程（L3）/ 制度依据（文件号/条款） / 应用系统（S1）/ 系统设计依据`
- Keep detail tables readable without horizontal scrolling on common desktop widths. Prefer wrapping long text and reducing the `业务流程（L3）` and `制度依据` column widths before introducing horizontal scroll.
- Tooltip should include 业务流程（L3）, evidence, and system design basis.
- Ensure only OA, MES, PLM, ERP appear as system nodes.
- Do not draw links to blank system values.
- Ensure short system labels such as OA, MES, PLM, and ERP are fully visible in the chart; use enough right padding, label width, or right-aligned system labels to prevent clipping.

## Success Pattern To Reuse

The successful department page and documents came from this sequence:

1. Read source titles, clauses, forms, and flow evidence before naming capabilities.
2. Keep 业务能力（L2） wording close to source language; put broader interpretation in notes unless the source proves it.
3. Build the stable L1/L2/L3/S1 mapping first; do not let later behavior detail distort the all-domain structure.
4. Put MDM objects in the separate MDM requirements document, not in 应用系统（S1）.
5. Make every uncertainty visible as a department review item instead of smoothing it into a confident sentence.
6. Validate the H5 page against both facts and layout: terminology, layer order, system boundary, table readability, and label clipping.

## Verification Checklist

Before finalizing:

- Exactly the three canonical files exist for this department; no duplicate behavior-named Markdown or HTML remains.
- Step 0 change detection has been performed with a source manifest or equivalent evidence; unchanged source files were not re-read.
- Every mapped process has evidence with file number/revision and clause numbers.
- Terminology follows the project standard exactly: 部门（D1）, 办公室（D2）, 能力域（L1）, 业务能力（L2）, 业务流程（L3）, 业务行为（A1）, 业务行为（A2）, 应用系统（S1）, 应用模块（S2）.
- Every 业务能力（L2） name is either source-wording-aligned or has evidence-backed justification for broader wording.
- Application systems are only OA/MES/PLM/ERP or blank.
- MDM is absent from application system nodes and rows.
- `{部门名}能力层与MDM建设要求.md` exists and treats MDM as backstage data governance, not an employee-facing workflow system.
- Blank system rows are intentional and explained.
- System design basis is present for each nonblank system.
- HTML renders without broken chart, unreadable table, or text overlap.
- Dense Sankey views provide readable controls, such as domain-detail filtering or an optional layout toggle, without changing the default left-to-right reading order.
- Detail table includes a visible sequence number column.
- Detail table fits common desktop viewport width without requiring horizontal scrolling unless the user explicitly asks for a wide audit table.
- System node labels in the Sankey are not clipped or truncated.
- H5 text does not use shorthand aliases such as `业务能力(L2)`, `业务流程(L3)`, `应用系统(S1)`, or labels without project codes where a formal element name is expected.
- Counts in stats match the mapping table.
- For incremental runs: a `## 变更记录` section is appended with date, change type, impact scope, and description; deprecated processes are marked with strikethrough, not deleted.
