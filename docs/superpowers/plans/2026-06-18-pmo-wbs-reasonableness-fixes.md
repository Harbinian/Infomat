# PMO WBS Reasonableness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix PMO Gantt/WBS responsibility and reporting口径 issues found in the workgroup reasonableness review, without changing MDM platform code or process-map true sources.

**Architecture:** Treat `pmo/信息化项目_计划管控真源.md` and `pmo/信息化项目_WBS结构真源.md` as the PMO plan truth, and regenerate JSON snapshots through `pmo/convert_xlsx.py`. Keep reviewer/role wording, task control fields, and manifest statistics consistent so the Gantt app and H5/PMO views read the same口径.

**Tech Stack:** Markdown truth blocks, Python conversion script, JSON outputs, PowerShell/Node validation snippets, Vite PMO Gantt app smoke check.

---

## Scope

This plan fixes the PMO WBS/Gantt data口径 only.

In scope:
- `pmo/信息化项目_计划管控真源.md`
- `pmo/convert_xlsx.py`
- generated outputs from `python pmo/convert_xlsx.py`
- optional validation documentation in PMO notes, if needed

Out of scope:
- `apps/mdm-platform/`
- `docs/norms/`
- `docs/organization/项目组架构.svg`
- `pmo/deliverables/项目启动会会议材料H5.html`
- `scripts/parse-sankey-data.mjs`

## Current Findings To Fix

1. Manifest summary says `milestoneCount = 102`, while task detail has 46 rows with `milestone = 是`.
2. WBS still uses old reviewer labels `网络工程副主任;技术架构副主任` in 43 infrastructure tasks.
3. WBS 9 cross-system联调 is correctly coordinated by `信息化项目组`, but execution responsibility is not explicit enough for each联调/测试/推广 item.
4. 38 critical-control rows have no explicit `phaseGateNo`, `releaseRule`, `integrationStartCondition`, or `contractPaymentControl`.
5. `2.5.3 机房动力环境改造方案评审与采购草案准备（不发布）` is assigned to `信息化项目组`; it needs either reassignment to `基础设施工作组` or a clear execution note explaining PMO采购协调 vs. infrastructure technical confirmation.

## File Map

- Modify: `pmo/convert_xlsx.py`
  - Responsibility: generate `taskSummary` counts from actual task rows where possible, not stale summary metadata.
- Modify: `pmo/信息化项目_计划管控真源.md`
  - Responsibility: update reviewer labels, WBS 9 execution notes, critical-control fields, and the `2.5.3` assignment/notes.
- Regenerate: `pmo/tasks.json`
- Regenerate: `pmo/信息化项目.csv`
- Regenerate: `pmo/pmo-source-manifest.json`
- Regenerate: `pmo/gantt-react/public/tasks.json`
- Regenerate: `pmo/gantt-react/public/pmo-source-manifest.json`

## Task 1: Add Manifest Count Validation And Computed Summary

**Files:**
- Modify: `pmo/convert_xlsx.py`
- Regenerate later: `pmo/pmo-source-manifest.json`
- Regenerate later: `pmo/gantt-react/public/pmo-source-manifest.json`

- [ ] **Step 1: Review current manifest builder**

Run:

```powershell
Select-String -LiteralPath 'E:\CA001\Infomat\pmo\convert_xlsx.py' -Pattern 'taskSummary|milestoneCount|criticalControlCount|h5FocusCount' -Context 3,3
```

Expected: `milestoneCount`, `criticalControlCount`, and `h5FocusCount` are read from `summary.get(...)`.

- [ ] **Step 2: Change manifest counts to compute from tasks**

In `build_source_manifest`, add local computed values before `return`:

```python
    computed_summary = {
        "recordCount": len(tasks),
        "fieldCount": summary.get("fieldCount", 45),
        "projectStart": summary.get("projectStart"),
        "projectFinish": summary.get("projectFinish"),
        "milestoneCount": sum(1 for task in tasks if task.get("milestone") == "是"),
        "criticalControlCount": sum(1 for task in tasks if task.get("isCriticalControl") == "是"),
        "h5FocusCount": sum(1 for task in tasks if task.get("isH5Focus") == "是"),
    }
```

Then replace the current inline `taskSummary` object with:

```python
        "taskSummary": computed_summary,
```

- [ ] **Step 3: Run conversion**

Run:

```powershell
cd E:\CA001\Infomat\pmo
python convert_xlsx.py
```

Expected:

```text
Wrote 467 tasks from 信息化项目_计划管控真源.md
Wrote pmo-source-manifest.json
```

- [ ] **Step 4: Verify summary counts**

Run:

```powershell
@'
const fs = require('fs');
const tasks = JSON.parse(fs.readFileSync('pmo/gantt-react/public/tasks.json','utf8'));
const manifest = JSON.parse(fs.readFileSync('pmo/gantt-react/public/pmo-source-manifest.json','utf8'));
const expected = {
  recordCount: tasks.length,
  milestoneCount: tasks.filter(t => t.milestone === '是').length,
  criticalControlCount: tasks.filter(t => t.isCriticalControl === '是').length,
  h5FocusCount: tasks.filter(t => t.isH5Focus === '是').length,
};
console.log(JSON.stringify({ expected, actual: manifest.taskSummary }, null, 2));
if (JSON.stringify(expected) !== JSON.stringify({
  recordCount: manifest.taskSummary.recordCount,
  milestoneCount: manifest.taskSummary.milestoneCount,
  criticalControlCount: manifest.taskSummary.criticalControlCount,
  h5FocusCount: manifest.taskSummary.h5FocusCount,
})) process.exit(1);
'@ | node -
```

Expected: command exits successfully and shows `milestoneCount: 46`, `criticalControlCount: 75`, `h5FocusCount: 214`.

## Task 2: Normalize Reviewer Role Labels

**Files:**
- Modify: `pmo/信息化项目_计划管控真源.md`
- Regenerate later: PMO JSON/CSV outputs

- [ ] **Step 1: Locate old labels**

Run:

```powershell
Select-String -LiteralPath 'E:\CA001\Infomat\pmo\信息化项目_计划管控真源.md' -Pattern '网络工程副主任|技术架构副主任|张源|专员' | Select-Object LineNumber,Line
```

Expected: 43 rows contain `网络工程副主任;技术架构副主任`; no `张源` or `专员` should remain in PMO WBS truth.

- [ ] **Step 2: Replace old reviewer labels**

Replace every `审核人/审批组` value:

```json
"审核人/审批组": "网络工程副主任;技术架构副主任"
```

with:

```json
"审核人/审批组": "网络工程负责人;技术架构负责人"
```

- [ ] **Step 3: Verify old labels are gone**

Run:

```powershell
Select-String -LiteralPath 'E:\CA001\Infomat\pmo\信息化项目_计划管控真源.md' -Pattern '网络工程副主任|技术架构副主任|张源|专员'
```

Expected: no matches.

## Task 3: Clarify WBS 9 Cross-System RACI In Execution Notes

**Files:**
- Modify: `pmo/信息化项目_计划管控真源.md`
- Regenerate later: PMO JSON/CSV outputs

- [ ] **Step 1: Locate WBS 9 execution rows**

Run:

```powershell
@'
const fs = require('fs');
const tasks = JSON.parse(fs.readFileSync('pmo/gantt-react/public/tasks.json','utf8'));
console.log(JSON.stringify(tasks
  .filter(t => String(t.wbs).startsWith('9.') && t.type !== '摘要')
  .map(t => ({ wbs: t.wbs, name: t.name, department: t.department, vendor: t.vendor, reviewer: t.reviewer, executionNote: t.executionNote }))
, null, 2));
'@ | node -
```

Expected: WBS 9 rows are mostly `department: 信息化项目组`, with vendors/workgroups listed but execution notes sparse.

- [ ] **Step 2: Add execution notes to WBS 9.1 and 9.2 rows**

Use these exact口径 patterns in the source JSON rows:

For WBS 9.1 interface联调 rows:

```json
"执行说明": "信息化项目组统筹联调节奏和问题台账；对应系统工作组负责本系统接口场景、供应商负责接口适配，MDM工作组负责主数据口径，数据质量工作组按复核口径抽审。"
```

For WBS 9.2 business scenario测试 rows:

```json
"执行说明": "信息化项目组统筹跨系统业务场景测试；业务场景对应工作组负责场景确认，供应商负责缺陷修复，数据质量工作组复核数据一致性和问题闭环证据。"
```

For WBS 9.3推广 rows:

```json
"执行说明": "信息化项目组统筹推广计划和培训节奏；对应业务部门和系统工作组负责现场确认，供应商负责培训材料和问题响应。"
```

For WBS 9.4治理常态化 rows:

```json
"执行说明": "信息化项目组统筹机制固化；MDM工作组维护主数据规则版本，数据质量工作组负责月度审计、复核和闭环跟踪。"
```

- [ ] **Step 3: Verify WBS 9 has explicit execution notes**

After regeneration in Task 6, run:

```powershell
@'
const fs = require('fs');
const tasks = JSON.parse(fs.readFileSync('pmo/gantt-react/public/tasks.json','utf8'));
const missing = tasks.filter(t => String(t.wbs).startsWith('9.') && t.type !== '摘要' && !t.executionNote);
console.log(JSON.stringify(missing.map(t => ({ wbs: t.wbs, name: t.name })), null, 2));
if (missing.length) process.exit(1);
'@ | node -
```

Expected: empty array.

## Task 4: Add Control Meaning To Critical-Control Rows

**Files:**
- Modify: `pmo/信息化项目_计划管控真源.md`
- Regenerate later: PMO JSON/CSV outputs

- [ ] **Step 1: Reproduce the missing-control list**

Run:

```powershell
@'
const fs=require('fs');
const tasks=JSON.parse(fs.readFileSync('pmo/gantt-react/public/tasks.json','utf8'));
const rows=tasks.filter(t => t.type !== '摘要'
  && t.isCriticalControl === '是'
  && !t.phaseGateNo
  && !t.integrationStartCondition
  && !t.releaseRule
  && !t.contractPaymentControl
);
console.log(JSON.stringify(rows.map(t => ({ wbs:t.wbs, name:t.name, type:t.type, department:t.department })), null, 2));
if (rows.length !== 38) process.exit(1);
'@ | node -
```

Expected: 38 rows.

- [ ] **Step 2: Fill the minimal control field**

For each listed row, add one of these fields rather than inventing a new column:

```json
"阶段门编号": "G0"
```

Use for project-start and blueprint approval gates such as `1.1.2` and `1.3.5`.

```json
"放行/阻断规则": "不通过不得进入对应供应商进场、上线、验收或总体验收下一阶段。"
```

Use for supplier进场、上线、验收、风险缓冲、总体验收 rows.

```json
"联调启动条件": "数据质量/推广/治理验收"
```

Use for WBS 9 completion,推广完成, and治理常态化验收 rows.

```json
"合同/付款控制口径": "作为验收或付款资料的一部分，需保留评审、验收或问题闭环证据。"
```

Use for hardware到货验收、基础设施整体验收、PLM验收、MES验收、总体验收材料 rows.

- [ ] **Step 3: Keep control wording factual**

Do not add wording such as `最忙`, `主用`, `承载最多`, or application ranking. Use only gate, evidence, release, payment, integration, and closure facts.

- [ ] **Step 4: Verify no critical-control row is unexplained**

After regeneration in Task 6, run:

```powershell
@'
const fs=require('fs');
const tasks=JSON.parse(fs.readFileSync('pmo/gantt-react/public/tasks.json','utf8'));
const rows=tasks.filter(t => t.type !== '摘要'
  && t.isCriticalControl === '是'
  && !t.phaseGateNo
  && !t.integrationStartCondition
  && !t.releaseRule
  && !t.contractPaymentControl
);
console.log(JSON.stringify(rows.map(t => ({ wbs:t.wbs, name:t.name })), null, 2));
if (rows.length) process.exit(1);
'@ | node -
```

Expected: empty array.

## Task 5: Resolve WBS 2.5.3 Responsibility

**Files:**
- Modify: `pmo/信息化项目_计划管控真源.md`
- Regenerate later: PMO JSON/CSV outputs

- [ ] **Step 1: Locate WBS 2.5.3**

Run:

```powershell
Select-String -LiteralPath 'E:\CA001\Infomat\pmo\信息化项目_计划管控真源.md' -Pattern '"WBS": "2.5.3"' -Context 0,30
```

Expected: `2.5.3 机房动力环境改造方案评审与采购草案准备（不发布）`.

- [ ] **Step 2: Choose the safer assignment**

Recommended change:

```json
"主责资源": "基础设施工作组",
"责任部门": "基础设施工作组",
"审核人/审批组": "信息化项目管理工作室;项目决策组",
"执行说明": "基础设施工作组负责机房动力环境技术方案和现场条件确认；信息化项目管理工作室负责采购节奏、材料齐套和决策组上会协调。"
```

This keeps technical responsibility in the infrastructure workgroup and PMO coordination explicit.

- [ ] **Step 3: Verify WBS 2.5 distribution**

After regeneration in Task 6, run:

```powershell
@'
const fs=require('fs');
const tasks=JSON.parse(fs.readFileSync('pmo/gantt-react/public/tasks.json','utf8'));
console.log(JSON.stringify(tasks
  .filter(t => String(t.wbs).startsWith('2.5'))
  .map(t => ({ wbs:t.wbs, name:t.name, department:t.department, executionNote:t.executionNote }))
, null, 2));
'@ | node -
```

Expected: `2.5.3` is assigned to `基础设施工作组` and retains an execution note separating technical confirmation from PMO coordination.

## Task 6: Regenerate PMO Outputs

**Files:**
- Regenerate: `pmo/tasks.json`
- Regenerate: `pmo/信息化项目.csv`
- Regenerate: `pmo/pmo-source-manifest.json`
- Regenerate: `pmo/gantt-react/public/tasks.json`
- Regenerate: `pmo/gantt-react/public/pmo-source-manifest.json`

- [ ] **Step 1: Run converter**

Run:

```powershell
cd E:\CA001\Infomat\pmo
python convert_xlsx.py
```

Expected:

```text
Wrote 467 tasks from 信息化项目_计划管控真源.md
Wrote pmo-source-manifest.json
```

- [ ] **Step 2: Confirm generated task snapshots match**

Run:

```powershell
$a=(Get-FileHash -Algorithm SHA256 -LiteralPath 'E:\CA001\Infomat\pmo\tasks.json').Hash
$b=(Get-FileHash -Algorithm SHA256 -LiteralPath 'E:\CA001\Infomat\pmo\gantt-react\public\tasks.json').Hash
"pmo/tasks.json $a"
"public/tasks.json $b"
if ($a -ne $b) { exit 1 }
```

Expected: both hashes are identical.

## Task 7: Run Reasonableness Regression Checks

**Files:**
- Read only: regenerated PMO JSON outputs

- [ ] **Step 1: Check department distribution remains reasonable**

Run:

```powershell
@'
const fs=require('fs');
const tasks=JSON.parse(fs.readFileSync('pmo/gantt-react/public/tasks.json','utf8'));
const groups = Object.entries(tasks.reduce((m,t)=>(m[t.department]=(m[t.department]||0)+1,m),{}))
  .sort((a,b)=>b[1]-a[1]);
console.log(JSON.stringify(groups, null, 2));
const allowed = new Set(['信息化项目组','基础设施工作组','MDM工作组','PLM工作组','MES工作组','ERP·OA工作组']);
const bad = tasks.filter(t => !allowed.has(t.department));
if (bad.length) {
  console.log(JSON.stringify(bad.map(t => ({wbs:t.wbs,name:t.name,department:t.department})), null, 2));
  process.exit(1);
}
'@ | node -
```

Expected: no unexpected department labels. `基础设施工作组` count may increase by 1 if `2.5.3` is reassigned.

- [ ] **Step 2: Verify data quality stays review-only**

Run:

```powershell
@'
const fs=require('fs');
const tasks=JSON.parse(fs.readFileSync('pmo/gantt-react/public/tasks.json','utf8'));
const primary = tasks.filter(t => t.department === '数据质量工作组' || t.resources === '数据质量工作组');
const reviewed = tasks.filter(t => String(t.reviewer || '').includes('数据质量工作组'));
console.log(JSON.stringify({
  primaryCount: primary.length,
  reviewerCount: reviewed.length,
  h5Focus: reviewed.filter(t => t.isH5Focus === '是').length,
  critical: reviewed.filter(t => t.isCriticalControl === '是').length,
  milestones: reviewed.filter(t => t.milestone === '是').length
}, null, 2));
if (primary.length) process.exit(1);
'@ | node -
```

Expected: `primaryCount: 0`; data quality remains a reviewer/recheck role.

- [ ] **Step 3: Verify old labels are gone from generated output**

Run:

```powershell
Select-String -LiteralPath 'E:\CA001\Infomat\pmo\gantt-react\public\tasks.json' -Pattern '网络工程副主任|技术架构副主任|张源|专员'
```

Expected: no matches.

## Task 8: Optional Browser Smoke Check

**Files:**
- Read only: `pmo/gantt-react/`

- [ ] **Step 1: Start PMO Gantt dev server**

Run:

```powershell
cd E:\CA001\Infomat\pmo\gantt-react
npm run dev -- --host 127.0.0.1
```

Expected: Vite starts and prints a local URL.

- [ ] **Step 2: Open the Gantt page**

Use the printed local URL and verify:
- task count loads;
- department filters still show the six expected primary groups;
- no visible old labels `副主任` remain in task detail/reviewer display;
- WBS 9 rows show execution notes when details are opened.

## Acceptance Criteria

- `pmo-source-manifest.json` shows `milestoneCount: 46`, computed from actual rows.
- No PMO WBS truth or generated output contains `网络工程副主任`, `技术架构副主任`, `张源`, or `专员`.
- Data quality workgroup remains review-only: zero primary `department/resources`, nonzero reviewer count.
- WBS 9 cross-system tasks have execution notes clarifying PMO统筹, workgroup execution, supplier adaptation, MDM口径, and data-quality复核.
- Critical-control rows all have at least one explicit control field.
- `pmo/tasks.json` and `pmo/gantt-react/public/tasks.json` remain identical after regeneration.
- No files under `apps/mdm-platform/`, `docs/norms/`, or `docs/organization/` are changed.

## Commit Strategy

Use two small commits if executing:

```powershell
git add pmo/convert_xlsx.py pmo/pmo-source-manifest.json pmo/gantt-react/public/pmo-source-manifest.json
git commit -m "fix(pmo): compute manifest task summary from generated tasks"
```

```powershell
git add pmo/信息化项目_计划管控真源.md pmo/tasks.json pmo/信息化项目.csv pmo/gantt-react/public/tasks.json
git commit -m "fix(pmo): clarify WBS responsibility and reviewer labels"
```

Only commit after checking unrelated existing worktree changes and staging only the PMO files listed above.
