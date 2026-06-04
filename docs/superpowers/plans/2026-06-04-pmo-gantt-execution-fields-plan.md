# PMO 甘特图 — 新执行层字段集成 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `pmo/信息化项目_Project_H5最终执行版_导入表.xlsx` 中 17 个新执行层字段 + 8 个辅助 sheet 集成到 PMO 甘特图 React 服务（数据流 + 4 个 P0 筛选器 + Flag 视觉标记 + 任务详情执行层分组 + PMO 页"参考规则"Tab）。

**Architecture:** 真源 XLSX → `convert_xlsx.py` 一次性产出 `tasks.json`（45 列扁平）+ `reference.json`（8 张辅助表） → React 应用消费两份 JSON。React 端按域扩展：FilterBar 增 4 个筛选器；GanttChart 用 Canvas 在已有任务条上加红边/金菱形；TaskDetail 在字段数组里追加 14 行新分组；新增 ReferenceRules 组件作为 PMO 页的"参考规则"Tab 容器。

**Tech Stack:** Python 3 + openpyxl（数据流）；React 19 + Vite 8 + Canvas 2D + 原生 CSS（前端）。无测试框架，沿用项目"手动 HTTP/JSON 冒烟脚本"风格。

**关键约定：**
- 命名：JSON 字段 camelCase，React 组件 PascalCase，CSS 类 kebab-case
- 现有 15 个字段不动；新 17 个字段空值统一为 `""`（bool 为 `false`）
- 频繁小提交，每完成一个 task 立即 commit
- 视觉标记：Flag1 红色边框（`#c0392b` 2px），Flag2 金色菱形（`#d4af37` 12px 居中）

---

## 文件结构总览

| 文件 | 责任 | 状态 |
|---|---|---|
| `pmo/convert_xlsx.py` | XLSX → tasks.json + reference.json | 修改 |
| `pmo/gantt-react/public/tasks.json` | 任务数据 53KB | 自动生成 |
| `pmo/gantt-react/public/reference.json` | 8 辅助表 JSON | 新增（生成） |
| `pmo/gantt-react/src/utils/referenceData.js` | 参考表加载/分组工具 | 新增 |
| `pmo/gantt-react/src/utils/dateUtils.js` | applyFilters 增 4 分支 | 修改 |
| `pmo/gantt-react/src/App.jsx` | DEFAULT_FILTERS + pmoView 状态 | 修改 |
| `pmo/gantt-react/src/components/FilterBar.jsx` | 4 个新筛选器 | 修改 |
| `pmo/gantt-react/src/components/GanttChart.jsx` | Flag 渲染 + tooltip + legend | 修改 |
| `pmo/gantt-react/src/components/TaskDetail.jsx` | 执行层分组 | 修改 |
| `pmo/gantt-react/src/components/ReferenceRules.jsx` | 参考规则 Tab 容器 | 新增 |
| `pmo/gantt-react/src/App.css` | 徽章/分组/参考规则样式 | 修改 |
| `pmo/scripts/smoke-reference.js` | reference.json 校验 | 新增 |
| `pmo/scripts/smoke-task-fields.js` | 任务新字段校验 | 新增 |
| `pmo/CLAUDE.md` | 真源路径 + 删除 build-standalone 段 | 修改 |
| `pmo/README.md` | 真源切换 | 修改 |
| `pmo/gantt-react/README.md` | reference.json + 4 筛选器说明 | 修改 |
| `docs/glossary.md` | 7 个新术语 | 修改 |
| **删除** | `pmo/build-standalone.js` 等 5 个老文件 | 删除 |

---

## Task 1: 扩展 convert_xlsx.py 读 17 个新字段

**Files:**
- Modify: `pmo/convert_xlsx.py:19-24, 80-99`

- [ ] **Step 1: 添加 `norm_bool` 辅助函数**

在 `pmo/convert_xlsx.py` 的 `norm_int` 函数后（约第 25 行）新增：

```python
def norm_bool(v):
    s = norm_text(v)
    if s == "是":
        return True
    if s == "否":
        return False
    return False
```

- [ ] **Step 2: 扩充 `read_tasks_from_xlsx` 的 task 字典**

把 `pmo/convert_xlsx.py` 第 82-99 行的 `task = { ... }` 块替换为：

```python
        task = {
            "id": norm_int(get(r, "ID")),
            "wbs": norm_text(get(r, "WBS")),
            "name": task_name,
            "type": norm_text(get(r, "任务类型")),
            "duration": norm_text(get(r, "工期")),
            "start": norm_date(get(r, "开始时间")),
            "finish": norm_date(get(r, "完成时间")),
            "predecessors": norm_text(get(r, "前置任务")),
            "resources": norm_text(get(r, "主责资源")) or norm_text(get(r, "资源名称")),
            "resourcesPrimary": norm_text(get(r, "主责资源")),
            "resourcesCollab": norm_text(get(r, "协作资源")),
            "resourcesVendor": norm_text(get(r, "供应商资源")),
            "department": norm_text(get(r, "责任部门")),
            "vendor": norm_text(get(r, "供应商")),
            "reviewer": norm_text(get(r, "审核人/审批组")),
            "risk": norm_text(get(r, "风险等级")),
            "milestone": norm_text(get(r, "里程碑")),
            "deliverable": norm_text(get(r, "交付物")),
            "notes": norm_text(get(r, "备注")),
            "viewCategory": norm_text(get(r, "所属视图分类")),
            "gateId": norm_text(get(r, "阶段门编号")),
            "gateName": norm_text(get(r, "阶段门名称")),
            "isCriticalPath": norm_bool(get(r, "是否关键路径控制")),
            "isH5Focus": norm_bool(get(r, "是否H5重点展示")),
            "versionObject": norm_text(get(r, "版本控制对象")),
            "changeLevel": norm_text(get(r, "变更等级")),
            "integrationStartCondition": norm_text(get(r, "联调启动条件")),
            "releaseBlockRule": norm_text(get(r, "放行/阻断规则")),
            "contractControl": norm_text(get(r, "合同/付款控制口径")),
            "h5DiagnosticRule": norm_text(get(r, "H5诊断规则")),
            "execNote": norm_text(get(r, "执行说明")),
            "isVirtualSummary": norm_bool(get(r, "是否虚拟摘要")),
            "reviewOpinion": norm_text(get(r, "评审意见")),
        }
```

- [ ] **Step 3: 运行转换并验证新字段**

```bash
cd "E:/CA001/Infomat" && python pmo/convert_xlsx.py
```

Expected: `Wrote 434 tasks` 出现在最后一行。

- [ ] **Step 4: 抽样验证 tasks.json 含 17 个新字段**

```bash
cd "E:/CA001/Infomat" && python -c "
import json
tasks = json.load(open('pmo/gantt-react/public/tasks.json', encoding='utf-8'))
print('Total:', len(tasks))
new_fields = ['resourcesPrimary','resourcesCollab','resourcesVendor','viewCategory','gateId','gateName','isCriticalPath','isH5Focus','versionObject','changeLevel','integrationStartCondition','releaseBlockRule','contractControl','h5DiagnosticRule','execNote','isVirtualSummary','reviewOpinion']
filled = {f: sum(1 for t in tasks if t.get(f)) for f in new_fields}
for f, n in filled.items():
    print(f'  {f}: {n}')
critical = [t for t in tasks if t.get('isCriticalPath')]
focus = [t for t in tasks if t.get('isH5Focus')]
view = [t for t in tasks if t.get('viewCategory')]
print(f'\\nSample critical: {critical[0][\"wbs\"]} {critical[0][\"name\"]} (viewCategory={critical[0][\"viewCategory\"]})')
print(f'Sample focus: {focus[0][\"wbs\"]} {focus[0][\"name\"]} (gateId={focus[0][\"gateId\"]})')
"
```

Expected: 17 个字段填充率打印；至少 1 个 critical 任务有 viewCategory；至少 1 个 focus 任务有 gateId。

- [ ] **Step 5: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/convert_xlsx.py pmo/tasks.json pmo/gantt-react/public/tasks.json && git commit -m "feat(pmo): read 17 new execution-layer fields in convert_xlsx"
```

---

## Task 2: 转换脚本产出 reference.json（8 辅助表）

**Files:**
- Modify: `pmo/convert_xlsx.py:165-181` (main 函数)
- Create: `pmo/gantt-react/public/reference.json`（由脚本生成）

- [ ] **Step 1: 添加 `read_sheet_as_table` 辅助函数**

在 `pmo/convert_xlsx.py` 的 `norm_date` 函数后（约第 50 行）新增：

```python
def read_sheet_as_table(ws, skip_header=True):
    """读取 sheet 为 [[cell, ...], ...] 列表，跳过全空行。"""
    rows = []
    for r in ws.iter_rows(values_only=True):
        if all(c is None or (isinstance(c, str) and not c.strip()) for c in r):
            continue
        rows.append([norm_text(c) for c in r])
    return rows[1:] if skip_header and rows else rows


def read_pmo_weekly_mechanism(ws):
    """PMO周会机制 特殊：两段表头（关注顺序 + 重点追责事项）。"""
    rows = list(ws.iter_rows(values_only=True))
    out = {'order': [], 'responsibilities': []}
    section = None
    for r in rows[1:]:
        if all(c is None or (isinstance(c, str) and not c.strip()) for c in r):
            section = None
            continue
        a, b = norm_text(r[0]) if len(r) > 0 else '', norm_text(r[1]) if len(r) > 1 else ''
        if a == 'PMO重点追责事项':
            section = 'responsibilities'
            continue
        if section == 'responsibilities':
            out['responsibilities'].append([a, b])
        else:
            section = 'order'
            out['order'].append([a, b])
    return out


def read_reference(wb):
    """读 8 个辅助 sheet，组装为 dict。"""
    ref = {
        'h5ViewCategories': read_sheet_as_table(wb['H5视图分类']),
        'phaseGateControl': read_sheet_as_table(wb['阶段门控制体系']),
        'h5DiagnosticRules': read_sheet_as_table(wb['H5诊断规则']),
        'deliverableLevels': read_sheet_as_table(wb['交付物分级审查']),
        'pmoWeeklyMechanism': read_pmo_weekly_mechanism(wb['PMO周会机制']),
        'contractControls': read_sheet_as_table(wb['合同与供应商履约控制']),
        'dependencyRules': read_sheet_as_table(wb['Project依赖规则']),
        'wbsLineManagement': read_sheet_as_table(wb['一级WBS管理口径']),
    }
    from datetime import datetime
    ref['generatedAt'] = datetime.now().isoformat(timespec='seconds')
    ref['sourceFile'] = '信息化项目_Project_H5最终执行版_导入表.xlsx'
    return ref
```

- [ ] **Step 2: 修改 main 写入 reference.json**

把 `pmo/convert_xlsx.py` 的 `main` 函数（第 165-181 行）替换为：

```python
def main():
    xlsx_path = ROOT / "信息化项目_Project_H5最终执行版_导入表.xlsx"
    tasks_path = ROOT / "tasks.json"
    csv_path = ROOT / "信息化项目.csv"
    react_tasks_path = ROOT / "gantt-react" / "public" / "tasks.json"
    reference_path = ROOT / "gantt-react" / "public" / "reference.json"

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    tasks = read_tasks_from_xlsx(wb)
    reference = read_reference(wb)

    write_tasks_json(tasks, tasks_path)
    write_tasks_csv(tasks, csv_path)
    react_tasks_path.write_text(tasks_path.read_text(encoding="utf-8"), encoding="utf-8")
    reference_path.write_text(
        json.dumps(reference, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Wrote {len(tasks)} tasks, {len(reference)-2} reference tables")


if __name__ == "__main__":
    main()
```

同时修改 `read_tasks_from_xlsx` 函数签名：把 `xlsx_path` 改为 `wb`（已加载的 workbook），原签名里 `wb = openpyxl.load_workbook(xlsx_path, data_only=True)` 这一行删掉。具体改动是把函数定义从 `def read_tasks_from_xlsx(xlsx_path: pathlib.Path):` 改为 `def read_tasks_from_xlsx(wb):`，并把函数体的前 4 行：

```python
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    target = None
    for sn in wb.sheetnames:
        if "Project" in sn and "导入任务" in sn:
            target = sn
            break
    if target is None:
        raise RuntimeError(f"Sheet containing 'Project导入任务表' not found. Available: {wb.sheetnames}")
    ws = wb[target]
```

保留不变（这部分是读主表 sheet 的逻辑）。

- [ ] **Step 3: 运行并验证 reference.json**

```bash
cd "E:/CA001/Infomat" && python pmo/convert_xlsx.py
```

Expected: `Wrote 434 tasks, 8 reference tables`

```bash
cd "E:/CA001/Infomat" && python -c "
import json
ref = json.load(open('pmo/gantt-react/public/reference.json', encoding='utf-8'))
for k in ['h5ViewCategories','phaseGateControl','h5DiagnosticRules','deliverableLevels','pmoWeeklyMechanism','contractControls','dependencyRules','wbsLineManagement']:
    v = ref[k]
    n = len(v.get('order', v)) if isinstance(v, dict) else len(v)
    print(f'  {k}: {n} rows')
print(f'  generatedAt: {ref[\"generatedAt\"]}')
print(f'  sourceFile: {ref[\"sourceFile\"]}')
"
```

Expected: 8 行计数（h5ViewCategories=8, phaseGateControl=17, h5DiagnosticRules=8, deliverableLevels=5, pmoWeeklyMechanism 字典含 order=7 + responsibilities=10, contractControls=8, dependencyRules=14, wbsLineManagement=11）。

- [ ] **Step 4: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/convert_xlsx.py pmo/gantt-react/public/reference.json && git commit -m "feat(pmo): extract 8 reference sheets to reference.json"
```

---

## Task 3: 为 convert_xlsx.py 加 --check 模式

**Files:**
- Modify: `pmo/convert_xlsx.py:1-8, 165-181` (import + main)

- [ ] **Step 1: 顶部加 argparse 导入**

在 `pmo/convert_xlsx.py` 第 1 行 `import csv` 后新增：

```python
import argparse
```

- [ ] **Step 2: main 接受 --check 参数**

把 `pmo/convert_xlsx.py` 的 `main` 函数替换为：

```python
def main():
    parser = argparse.ArgumentParser(description='PMO XLSX → tasks.json + reference.json')
    parser.add_argument('--check', action='store_true', help='解析但不写文件，输出统计')
    args = parser.parse_args()

    xlsx_path = ROOT / "信息化项目_Project_H5最终执行版_导入表.xlsx"
    tasks_path = ROOT / "tasks.json"
    csv_path = ROOT / "信息化项目.csv"
    react_tasks_path = ROOT / "gantt-react" / "public" / "tasks.json"
    reference_path = ROOT / "gantt-react" / "public" / "reference.json"

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    tasks = read_tasks_from_xlsx(wb)
    reference = read_reference(wb)

    print(f"== 任务统计 ==")
    print(f"  总数: {len(tasks)}")
    new_fields = ['resourcesPrimary','resourcesCollab','resourcesVendor','viewCategory','gateId','gateName','isCriticalPath','isH5Focus','versionObject','changeLevel','integrationStartCondition','releaseBlockRule','contractControl','h5DiagnosticRule','execNote','isVirtualSummary','reviewOpinion']
    for f in new_fields:
        n = sum(1 for t in tasks if t.get(f) not in ('', None, False))
        print(f"  {f}: {n}")
    print(f"== 辅助表统计 ==")
    for k, v in reference.items():
        if isinstance(v, list):
            print(f"  {k}: {len(v)} 行")
        elif isinstance(v, dict) and 'order' in v:
            print(f"  {k}: order={len(v['order'])}, responsibilities={len(v['responsibilities'])}")

    if args.check:
        print("\n--check 模式：未写入文件")
        return

    write_tasks_json(tasks, tasks_path)
    write_tasks_csv(tasks, csv_path)
    react_tasks_path.write_text(tasks_path.read_text(encoding="utf-8"), encoding="utf-8")
    reference_path.write_text(
        json.dumps(reference, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\nWrote {len(tasks)} tasks, {len(reference)-2} reference tables")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 运行 --check 验证**

```bash
cd "E:/CA001/Infomat" && python pmo/convert_xlsx.py --check
```

Expected: 输出"== 任务统计 =="和"== 辅助表统计 =="两组信息，结尾 "--check 模式：未写入文件"。

- [ ] **Step 4: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/convert_xlsx.py && git commit -m "feat(pmo): add --check mode to convert_xlsx for field statistics"
```

---

## Task 4: 创建 smoke-reference.js 冒烟脚本

**Files:**
- Create: `pmo/scripts/smoke-reference.js`

- [ ] **Step 1: 写冒烟脚本**

创建 `pmo/scripts/smoke-reference.js`：

```javascript
// 用法: node pmo/scripts/smoke-reference.js
// 校验 pmo/gantt-react/public/reference.json 结构与行数

const fs = require('fs');
const path = require('path');

const REF_PATH = path.resolve(__dirname, '../gantt-react/public/reference.json');
const ref = JSON.parse(fs.readFileSync(REF_PATH, 'utf-8'));

const EXPECTED = {
  h5ViewCategories: { type: 'array', min: 8 },
  phaseGateControl: { type: 'array', min: 17 },
  h5DiagnosticRules: { type: 'array', min: 8 },
  deliverableLevels: { type: 'array', min: 5 },
  pmoWeeklyMechanism: { type: 'object', minOrder: 7, minResp: 10 },
  contractControls: { type: 'array', min: 8 },
  dependencyRules: { type: 'array', min: 14 },
  wbsLineManagement: { type: 'array', min: 11 },
};

let pass = 0;
let fail = 0;

for (const [key, exp] of Object.entries(EXPECTED)) {
  const v = ref[key];
  if (!v) {
    console.error(`✗ ${key}: 缺失`);
    fail++;
    continue;
  }
  if (exp.type === 'array') {
    if (!Array.isArray(v) || v.length < exp.min) {
      console.error(`✗ ${key}: 期望 ≥ ${exp.min} 行，实际 ${v ? v.length : 'N/A'}`);
      fail++;
    } else {
      console.log(`✓ ${key}: ${v.length} 行`);
      pass++;
    }
  } else if (exp.type === 'object') {
    if (!v.order || !v.responsibilities || v.order.length < exp.minOrder || v.responsibilities.length < exp.minResp) {
      console.error(`✗ ${key}: order=${v.order?.length || 0}, responsibilities=${v.responsibilities?.length || 0}`);
      fail++;
    } else {
      console.log(`✓ ${key}: order=${v.order.length}, responsibilities=${v.responsibilities.length}`);
      pass++;
    }
  }
}

if (!ref.generatedAt) { console.error('✗ generatedAt 缺失'); fail++; }
else { console.log(`✓ generatedAt: ${ref.generatedAt}`); pass++; }

if (!ref.sourceFile) { console.error('✗ sourceFile 缺失'); fail++; }
else { console.log(`✓ sourceFile: ${ref.sourceFile}`); pass++; }

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 运行验证**

```bash
cd "E:/CA001/Infomat" && node pmo/scripts/smoke-reference.js
```

Expected: 10 行 `✓` 输出（8 张表 + generatedAt + sourceFile），结尾 "结果: 10 通过, 0 失败"，退出码 0。

- [ ] **Step 3: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/scripts/smoke-reference.js && git commit -m "test(pmo): add smoke-reference.js for reference.json validation"
```

---

## Task 5: 创建 smoke-task-fields.js 冒烟脚本

**Files:**
- Create: `pmo/scripts/smoke-task-fields.js`

- [ ] **Step 1: 写冒烟脚本**

创建 `pmo/scripts/smoke-task-fields.js`：

```javascript
// 用法: node pmo/scripts/smoke-task-fields.js
// 校验 pmo/gantt-react/public/tasks.json 17 个新字段非空 + 类型正确

const fs = require('fs');
const path = require('path');

const TASKS_PATH = path.resolve(__dirname, '../gantt-react/public/tasks.json');
const tasks = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf-8'));

const STRING_FIELDS = [
  'resourcesPrimary', 'resourcesCollab', 'resourcesVendor',
  'viewCategory', 'gateId', 'gateName',
  'versionObject', 'changeLevel', 'integrationStartCondition',
  'releaseBlockRule', 'contractControl', 'h5DiagnosticRule',
  'execNote', 'reviewOpinion',
];
const BOOL_FIELDS = ['isCriticalPath', 'isH5Focus', 'isVirtualSummary'];

let pass = 0, fail = 0;

const withView = tasks.filter(t => t.viewCategory);
const withGate = tasks.filter(t => t.gateId);
const withCritical = tasks.filter(t => t.isCriticalPath);
const withFocus = tasks.filter(t => t.isH5Focus);

console.log(`== 抽样统计 ==`);
console.log(`  viewCategory 非空: ${withView.length} / ${tasks.length}`);
console.log(`  gateId 非空: ${withGate.length} / ${tasks.length}`);
console.log(`  isCriticalPath=true: ${withCritical.length} / ${tasks.length}`);
console.log(`  isH5Focus=true: ${withFocus.length} / ${tasks.length}`);

const samples = [...withView, ...withGate, ...withCritical, ...withFocus].slice(0, 5);
console.log(`\n== 抽样类型检查 (${samples.length} 条) ==`);

for (const t of samples) {
  for (const f of STRING_FIELDS) {
    const v = t[f];
    if (v !== undefined && v !== null && typeof v !== 'string') {
      console.error(`✗ task ${t.id} 字段 ${f} 类型错误: ${typeof v}`);
      fail++;
    }
  }
  for (const f of BOOL_FIELDS) {
    const v = t[f];
    if (v !== undefined && v !== null && typeof v !== 'boolean') {
      console.error(`✗ task ${t.id} 字段 ${f} 类型错误: ${typeof v}`);
      fail++;
    }
  }
  pass++;
}

if (withView.length < 10) {
  console.error(`✗ viewCategory 填充任务 < 10（实际 ${withView.length}）`);
  fail++;
} else {
  console.log(`✓ viewCategory 填充 ${withView.length} 条 ≥ 10`);
  pass++;
}

if (withGate.length < 5) {
  console.error(`✗ gateId 填充任务 < 5（实际 ${withGate.length}）`);
  fail++;
} else {
  console.log(`✓ gateId 填充 ${withGate.length} 条 ≥ 5`);
  pass++;
}

if (withCritical.length < 5) {
  console.error(`✗ isCriticalPath=true 任务 < 5（实际 ${withCritical.length}）`);
  fail++;
} else {
  console.log(`✓ isCriticalPath=true 任务 ${withCritical.length} 条 ≥ 5`);
  pass++;
}

if (withFocus.length < 10) {
  console.error(`✗ isH5Focus=true 任务 < 10（实际 ${withFocus.length}）`);
  fail++;
} else {
  console.log(`✓ isH5Focus=true 任务 ${withFocus.length} 条 ≥ 10`);
  pass++;
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 运行验证**

```bash
cd "E:/CA001/Infomat" && node pmo/scripts/smoke-task-fields.js
```

Expected: 9 行 `✓`（5 类型检查通过 + 4 抽样统计通过），结尾"结果: 9 通过, 0 失败"，退出码 0。

- [ ] **Step 3: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/scripts/smoke-task-fields.js && git commit -m "test(pmo): add smoke-task-fields.js for new field validation"
```

---

## Task 6: 创建 referenceData.js 工具模块

**Files:**
- Create: `pmo/gantt-react/src/utils/referenceData.js`

- [ ] **Step 1: 写工具模块**

创建 `pmo/gantt-react/src/utils/referenceData.js`：

```javascript
// referenceData.js — 8 个辅助 sheet 的元数据 + 加载工具

export const REFERENCE_TABLES = [
  {
    key: 'h5ViewCategories',
    title: 'H5视图分类',
    columns: ['Text10值', '中文含义', 'H5视图', '诊断/PMO用途'],
    source: 'H5视图分类',
  },
  {
    key: 'phaseGateControl',
    title: '阶段门控制',
    columns: ['阶段门', '放行范围', '不满足时禁止推进', '绑定动作'],
    source: '阶段门控制体系',
  },
  {
    key: 'h5DiagnosticRules',
    title: 'H5诊断规则',
    columns: ['诊断名称', '规则', '提示信息/处理方式'],
    source: 'H5诊断规则',
  },
  {
    key: 'deliverableLevels',
    title: '交付物分级',
    columns: ['等级', '类型', '示例', '审查方式', '是否影响阶段门'],
    source: '交付物分级审查',
  },
  {
    key: 'pmoWeeklyMechanism',
    title: '周会机制',
    isSplit: true,
    sections: [
      { key: 'order', title: 'PMO周会关注顺序', columns: ['顺序', '内容'] },
      { key: 'responsibilities', title: 'PMO重点追责事项', columns: ['事项', '说明'] },
    ],
    source: 'PMO周会机制',
  },
  {
    key: 'contractControls',
    title: '合同付款控制',
    columns: ['类别', '必须包含/规则', '说明'],
    source: '合同与供应商履约控制',
  },
  {
    key: 'dependencyRules',
    title: '依赖规则',
    columns: ['规则类型', '内容', '说明'],
    source: 'Project依赖规则',
  },
  {
    key: 'wbsLineManagement',
    title: '一级WBS管理',
    columns: ['一级WBS', '主线名称', '最终管理重点'],
    source: '一级WBS管理口径',
  },
];

let cached = null;

export async function loadReference() {
  if (cached) return cached;
  const r = await fetch('reference.json');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  cached = await r.json();
  return cached;
}

export function getTableMeta(key) {
  return REFERENCE_TABLES.find(t => t.key === key);
}
```

- [ ] **Step 2: 验证模块导出可被导入（Vite 8 build 已会验证，额外做一次）**

```bash
cd "E:/CA001/Infomat/pmo/gantt-react" && node --input-type=module -e "
import { REFERENCE_TABLES, loadReference, getTableMeta } from './src/utils/referenceData.js';
console.log('length:', REFERENCE_TABLES.length);
console.log('keys:', REFERENCE_TABLES.map(t => t.key).join(','));
console.log('getTableMeta(\"phaseGateControl\") title:', getTableMeta('phaseGateControl').title);
"
```

Expected: 输出 `length: 8`、8 个 key 逗号分隔、`getTableMeta('phaseGateControl') title: 阶段门控制`。

- [ ] **Step 3: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/gantt-react/src/utils/referenceData.js && git commit -m "feat(pmo): add referenceData.js with 8 table metadata"
```

---

## Task 7: 扩展 dateUtils.js applyFilters 增 4 分支

**Files:**
- Modify: `pmo/gantt-react/src/utils/dateUtils.js`（在 `applyFilters` 函数末尾）

- [ ] **Step 1: 定位 applyFilters 函数**

```bash
cd "E:/CA001/Infomat" && grep -n "applyFilters\|return true" pmo/gantt-react/src/utils/dateUtils.js | head -20
```

找到 `export function applyFilters(tasks, filters, view) {` 起点和函数最后一个 `return true;` 所在行号。

- [ ] **Step 2: 在 applyFilters 末尾（return true 之前）插入 4 个分支**

在 `applyFilters` 函数最后一个 `return true;` 之前插入：

```javascript
  if (filters.viewCategory && filters.viewCategory !== 'all' && task.viewCategory !== filters.viewCategory) return false;
  if (filters.gateId && filters.gateId !== 'all' && task.gateId !== filters.gateId) return false;
  if (filters.criticalOnly && !task.isCriticalPath) return false;
  if (filters.focusOnly && !task.isH5Focus) return false;
```

- [ ] **Step 3: 语法验证（导入测试）**

```bash
cd "E:/CA001/Infomat/pmo/gantt-react" && node --input-type=module -e "
import { applyFilters } from './src/utils/dateUtils.js';
const tasks = [
  { id: 1, viewCategory: 'Core_Procurement', gateId: 'G2', isCriticalPath: true, isH5Focus: false },
  { id: 2, viewCategory: 'MDM_Version', gateId: 'G0', isCriticalPath: false, isH5Focus: true },
];
const f1 = { viewCategory: 'Core_Procurement', gateId: 'all', criticalOnly: false, focusOnly: false };
console.log('view=Core:', applyFilters(tasks, f1, 'all').map(t => t.id));
const f2 = { viewCategory: 'all', gateId: 'all', criticalOnly: true, focusOnly: false };
console.log('critical:', applyFilters(tasks, f2, 'all').map(t => t.id));
const f3 = { viewCategory: 'all', gateId: 'all', criticalOnly: false, focusOnly: true };
console.log('focus:', applyFilters(tasks, f3, 'all').map(t => t.id));
"
```

Expected: `[1]`、`[1]`、`[2]`。

- [ ] **Step 4: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/gantt-react/src/utils/dateUtils.js && git commit -m "feat(pmo): add 4 new filter branches in applyFilters"
```

---

## Task 8: 更新 App.jsx DEFAULT_FILTERS 和 pmoView

**Files:**
- Modify: `pmo/gantt-react/src/App.jsx:21,25-31,116,367-374`

- [ ] **Step 1: DEFAULT_FILTERS 增 4 键**

`pmo/gantt-react/src/App.jsx` 第 21 行：

```javascript
const DEFAULT_FILTERS = { year: 'all', mainline: 'all', department: 'all', vendor: 'all', risk: 'all', type: 'all', milestone: 'all', search: '', wbsDepth: 'all' };
```

替换为：

```javascript
const DEFAULT_FILTERS = { year: 'all', mainline: 'all', department: 'all', vendor: 'all', risk: 'all', type: 'all', milestone: 'all', search: '', wbsDepth: 'all', viewCategory: 'all', gateId: 'all', criticalOnly: false, focusOnly: false };
```

- [ ] **Step 2: PMO_VIEW_LABELS 增 reference 项**

`pmo/gantt-react/src/App.jsx` 第 25-31 行：

```javascript
const PMO_VIEW_LABELS = [
  { key: 'pmo', label: 'PMO周会' },
  { key: 'deliverables', label: '交付物台账' },
  { key: 'phasegates', label: '阶段门' },
  { key: 'thisweek', label: '本周交付物' },
  { key: 'overdue', label: '延期交付物' },
];
```

替换为：

```javascript
const PMO_VIEW_LABELS = [
  { key: 'pmo', label: 'PMO周会' },
  { key: 'deliverables', label: '交付物台账' },
  { key: 'phasegates', label: '阶段门' },
  { key: 'thisweek', label: '本周交付物' },
  { key: 'overdue', label: '延期交付物' },
  { key: 'reference', label: '参考规则' },
];
```

- [ ] **Step 3: 增 ReferenceRules 导入**

`pmo/gantt-react/src/App.jsx` 第 14 行后新增：

```javascript
import ReferenceRules from './components/ReferenceRules';
```

- [ ] **Step 4: renderPMOContent 增 reference 分支**

`pmo/gantt-react/src/App.jsx` 第 311-325 行的 `renderPMOContent` 函数，在 default 之前增：

```javascript
      case 'reference':
        return <ReferenceRules />;
```

- [ ] **Step 5: 验证构建**

```bash
cd "E:/CA001/Infomat/pmo/gantt-react" && npm run build 2>&1 | tail -20
```

Expected: `built in ...ms` 出现在最后，0 错误。

- [ ] **Step 6: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/gantt-react/src/App.jsx && git commit -m "feat(pmo): add reference view to PMO tabs and 4 filter keys"
```

---

## Task 9: 更新 FilterBar.jsx 增 4 个筛选器

**Files:**
- Modify: `pmo/gantt-react/src/components/FilterBar.jsx:20-66`

- [ ] **Step 1: 在 WBS层级组之后、视图按钮组之前插入 4 个新控件**

定位 `FilterBar.jsx` 第 67-80 行（WBS层级 div）之后、第 82 行 `<div className="view-btns">` 之前，插入：

```jsx
      <select value={filters.viewCategory || 'all'} onChange={e => update('viewCategory', e.target.value)} title="按 Text10 视图分类筛选">
        <option value="all">全部视图</option>
        <option value="Core_Procurement">核心招采</option>
        <option value="MDM_Version">主数据版本</option>
        <option value="Infra_Phased">基础资源分批</option>
        <option value="G9_Ready">联调准备</option>
        <option value="Gate">阶段门</option>
        <option value="Contract_Control">合同付款控制</option>
        <option value="Risk_Control">风险闭环</option>
      </select>

      <select value={filters.gateId || 'all'} onChange={e => update('gateId', e.target.value)} title="按阶段门编号筛选">
        <option value="all">全部阶段门</option>
        {['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'].map(g => (
          <option key={g} value={g}>{g}</option>
        ))}
      </select>

      <div className="filter-toggle-group" title="仅显示关键路径控制任务 (Flag1)">
        <button
          className={`filter-toggle${filters.criticalOnly ? ' active' : ''}`}
          onClick={() => update('criticalOnly', !filters.criticalOnly)}>关键路径</button>
      </div>

      <div className="filter-toggle-group" title="仅显示 H5 重点展示任务 (Flag2)">
        <button
          className={`filter-toggle${filters.focusOnly ? ' active' : ''}`}
          onClick={() => update('focusOnly', !filters.focusOnly)}>H5重点</button>
      </div>
```

- [ ] **Step 2: 验证构建**

```bash
cd "E:/CA001/Infomat/pmo/gantt-react" && npm run build 2>&1 | tail -10
```

Expected: `built in ...ms`，0 错误。

- [ ] **Step 3: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/gantt-react/src/components/FilterBar.jsx && git commit -m "feat(pmo): add 4 new filter widgets (viewCategory/gateId/critical/focus)"
```

---

## Task 10: 更新 GanttChart.jsx 加 Flag 视觉标记

**Files:**
- Modify: `pmo/gantt-react/src/components/GanttChart.jsx:7-21, 230-245, 326-385`

- [ ] **Step 1: GANTT_THEME 增两个颜色常量**

`pmo/gantt-react/src/components/GanttChart.jsx` 第 13-21 行 `GANTT_THEME` 对象的最后一个键后加：

```javascript
  critical: '#c0392b',
  focusGold: '#d4af37',
```

- [ ] **Step 2: 改 tooltip HTML 增 4 行**

`pmo/gantt-react/src/components/GanttChart.jsx` 第 230-245 行（`onMove` 里的 tooltip.innerHTML 拼接），在 `风险` 行之后追加：

```javascript
            `<div class="tt-row">视图: <span>${task.viewCategory || '-'}</span></div>`,
            `<div class="tt-row">阶段门: <span>${task.gateId ? task.gateId + (task.gateName ? ' ' + task.gateName : '') : '-'}</span></div>`,
            `<div class="tt-row">关键路径: <span>${task.isCriticalPath ? '是' : '否'}</span></div>`,
            `<div class="tt-row">H5重点: <span>${task.isH5Focus ? '是' : '否'}</span></div>`
```

- [ ] **Step 3: drawTaskBar 加 Flag 渲染**

`pmo/gantt-react/src/components/GanttChart.jsx` 第 326-385 行（`drawTaskBar` 函数的 bar 绘制段），在 `if (isHighRisk)` 块（约第 360-365 行）之后、`if (isBuffer)` 块之前，插入：

```javascript
    if (task.isCriticalPath) {
      ctx.strokeStyle = GANTT_THEME.critical;
      ctx.lineWidth = 2;
      ctx.strokeRect(barX, barY, barWidth, BAR_HEIGHT);
    }
    if (task.isH5Focus) {
      const cx = barX + barWidth / 2;
      const cy = barY + BAR_HEIGHT / 2;
      const size = 6;
      ctx.fillStyle = GANTT_THEME.focusGold;
      ctx.strokeStyle = GANTT_THEME.focusGold;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx + size, cy);
      ctx.lineTo(cx, cy + size);
      ctx.lineTo(cx - size, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
```

- [ ] **Step 4: 添加图例（紧跟 `<canvas ref={canvasRef}>` 之后）**

`pmo/gantt-react/src/components/GanttChart.jsx` 第 278-302 行的 return 段，在第 287 行 `<canvas ref={canvasRef} className="gantt-canvas" />` 之后、tooltip 之前插入：

```jsx
        <div className="gantt-legend">
          <span className="gantt-legend-item"><span className="gantt-legend-bar critical-sample"></span>关键路径</span>
          <span className="gantt-legend-item"><span className="gantt-legend-diamond"></span>H5重点</span>
        </div>
```

- [ ] **Step 5: 验证构建**

```bash
cd "E:/CA001/Infomat/pmo/gantt-react" && npm run build 2>&1 | tail -10
```

Expected: `built in ...ms`，0 错误。

- [ ] **Step 6: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/gantt-react/src/components/GanttChart.jsx && git commit -m "feat(pmo): add isCriticalPath red border and isH5Focus gold diamond on bars"
```

---

## Task 11: 更新 TaskDetail.jsx 加"执行层上下文"分组

**Files:**
- Modify: `pmo/gantt-react/src/components/TaskDetail.jsx:22-47`

- [ ] **Step 1: 在 fields 数组"备注"行前插入 14 行新分组**

`pmo/gantt-react/src/components/TaskDetail.jsx` 第 46 行的 `{ label: '备注', ... }` 之前，插入：

```javascript
    { label: '─── 执行层上下文 ───', value: '', divider: true },
    { label: '视图分类', value: task.viewCategory || '-', badge: task.viewCategory ? 'view-' + task.viewCategory : null },
    { label: '阶段门', value: task.gateId ? `${task.gateId} - ${task.gateName || ''}`.trim() : '-' },
    { label: '关键路径', value: task.isCriticalPath ? '是' : '否', badge: task.isCriticalPath ? 'critical' : null },
    { label: 'H5重点', value: task.isH5Focus ? '是' : '否', badge: task.isH5Focus ? 'focus' : null },
    { label: '主责资源', value: task.resourcesPrimary || '-' },
    { label: '协作资源', value: task.resourcesCollab || '-' },
    { label: '供应商资源', value: task.resourcesVendor || '-' },
    { label: '版本对象', value: task.versionObject || '-' },
    { label: '变更等级', value: task.changeLevel || '-', badge: task.changeLevel ? 'change-' + task.changeLevel : null },
    { label: '联调启动条件', value: task.integrationStartCondition || '-' },
    { label: '放行/阻断规则', value: task.releaseBlockRule || '-' },
    { label: '合同/付款控制', value: task.contractControl || '-' },
    { label: 'H5诊断规则', value: task.h5DiagnosticRule || '-' },
    { label: '执行说明', value: task.execNote || '-' },
    { label: '评审意见', value: task.reviewOpinion || '-' },
```

- [ ] **Step 2: 改 JSX 渲染支持 divider（保持现有风险/里程碑徽章样式）**

`pmo/gantt-react/src/components/TaskDetail.jsx` 第 56-66 行的 map 渲染块，替换为：

```jsx
        {fields.map((f, i) => {
          if (f.divider) {
            return <div key={i} className="detail-divider">{f.label.replace(/^─── | ───$/g, '')}</div>;
          }
          const cls = f.badge === 'risk'
            ? `value badge risk-${f.value}`
            : f.badge === 'milestone' && f.value === '是'
              ? 'value badge tag-milestone'
              : f.badge
                ? `value badge badge-${f.badge}`
                : 'value';
          return (
            <div key={i} className="detail-field">
              <label>{f.label}</label>
              <span className={cls}>{f.value}</span>
            </div>
          );
        })}
```

- [ ] **Step 3: 验证构建**

```bash
cd "E:/CA001/Infomat/pmo/gantt-react" && npm run build 2>&1 | tail -10
```

Expected: `built in ...ms`，0 错误。

- [ ] **Step 4: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/gantt-react/src/components/TaskDetail.jsx && git commit -m "feat(pmo): add execution layer context section to TaskDetail"
```

---

## Task 12: 创建 ReferenceRules.jsx 组件

**Files:**
- Create: `pmo/gantt-react/src/components/ReferenceRules.jsx`

- [ ] **Step 1: 写组件**

创建 `pmo/gantt-react/src/components/ReferenceRules.jsx`：

```jsx
import { useEffect, useState } from 'react';
import { REFERENCE_TABLES, loadReference } from '../utils/referenceData';

export default function ReferenceRules() {
  const [ref, setRef] = useState(null);
  const [error, setError] = useState(null);
  const [activeKey, setActiveKey] = useState(REFERENCE_TABLES[0].key);

  useEffect(() => {
    loadReference()
      .then(setRef)
      .catch(e => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="reference-rules error">
        <p>参考规则加载失败：{error}</p>
        <p>请在 pmo/ 目录运行 <code>python convert_xlsx.py</code> 重新生成 reference.json</p>
      </div>
    );
  }

  if (!ref) {
    return <div className="reference-rules loading">参考规则加载中…</div>;
  }

  const active = REFERENCE_TABLES.find(t => t.key === activeKey);
  const data = ref[active.key];

  return (
    <div className="reference-rules">
      <div className="ref-subtabs">
        {REFERENCE_TABLES.map(t => (
          <button
            key={t.key}
            className={`ref-subtab${activeKey === t.key ? ' active' : ''}`}
            onClick={() => setActiveKey(t.key)}
            type="button">{t.title}</button>
        ))}
      </div>

      <div className="ref-content">
        {active.isSplit ? (
          <>
            {active.sections.map(sec => (
              <div key={sec.key} className="ref-section">
                <h4 className="ref-section-title">{sec.title}</h4>
                <table className="ref-table">
                  <thead>
                    <tr>{sec.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {data[sec.key].map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => <td key={ci}>{cell || '-'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        ) : (
          <table className="ref-table">
            <thead>
              <tr>{active.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {data.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => <td key={ci}>{cell || '-'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="ref-meta">生成时间: {ref.generatedAt} | 来源: {ref.sourceFile}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证构建**

```bash
cd "E:/CA001/Infomat/pmo/gantt-react" && npm run build 2>&1 | tail -10
```

Expected: `built in ...ms`，0 错误。

- [ ] **Step 3: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/gantt-react/src/components/ReferenceRules.jsx && git commit -m "feat(pmo): add ReferenceRules component with 8 sub-tabs"
```

---

## Task 13: App.css 补充新样式

**Files:**
- Modify: `pmo/gantt-react/src/App.css`（追加在文件末尾）

- [ ] **Step 1: 追加样式**

在 `pmo/gantt-react/src/App.css` 文件末尾追加：

```css
/* === 执行层上下文分组（TaskDetail） === */
.detail-divider {
  margin: 16px 0 8px;
  padding-top: 12px;
  border-top: 1px dashed rgba(58, 46, 31, 0.24);
  font-size: 12px;
  font-weight: 600;
  color: #7a6a56;
  letter-spacing: 0.5px;
}
.badge.badge-critical {
  background: #c0392b;
  color: #fff;
}
.badge.badge-focus {
  background: #d4af37;
  color: #2a2014;
}
.badge.badge-view-Core_Procurement { background: #c0392b; color: #fff; }
.badge.badge-view-MDM_Version { background: #d4af37; color: #2a2014; }
.badge.badge-view-Infra_Phased { background: #c97050; color: #fff; }
.badge.badge-view-G9_Ready { background: #6f7d4e; color: #fff; }
.badge.badge-view-Gate { background: #7e8e5b; color: #fff; }
.badge.badge-view-Contract_Control { background: #8f6d4d; color: #fff; }
.badge.badge-view-Risk_Control { background: #b88919; color: #fff; }
.badge.badge-change-A { background: #c0392b; color: #fff; }
.badge.badge-change-B { background: #d4af37; color: #2a2014; }
.badge.badge-change-C { background: #b8a88e; color: #2a2014; }

/* === 筛选器 Toggle（FilterBar） === */
.filter-toggle-group {
  display: inline-flex;
  margin-left: 8px;
}
.filter-toggle {
  background: #fbf6e9;
  border: 1px solid rgba(58, 46, 31, 0.16);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  color: #3d3023;
  cursor: pointer;
}
.filter-toggle.active {
  background: #c97050;
  color: #fff;
  border-color: #c97050;
}

/* === 甘特图图例 === */
.gantt-legend {
  position: absolute;
  right: 16px;
  bottom: 12px;
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #3d3023;
  background: rgba(251, 246, 233, 0.9);
  padding: 6px 10px;
  border-radius: 4px;
}
.gantt-legend-item { display: inline-flex; align-items: center; gap: 4px; }
.gantt-legend-bar.critical-sample {
  display: inline-block;
  width: 16px;
  height: 8px;
  border: 2px solid #c0392b;
  background: transparent;
}
.gantt-legend-diamond {
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 10px solid #d4af37;
  transform: rotate(45deg);
}

/* === 参考规则（ReferenceRules） === */
.reference-rules {
  padding: 16px 20px;
}
.reference-rules.loading,
.reference-rules.error {
  padding: 40px;
  text-align: center;
  color: #7a6a56;
}
.reference-rules.error {
  color: #c0392b;
}
.ref-subtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(58, 46, 31, 0.16);
  padding-bottom: 8px;
}
.ref-subtab {
  background: transparent;
  border: 1px solid rgba(58, 46, 31, 0.16);
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 13px;
  color: #3d3023;
  cursor: pointer;
}
.ref-subtab.active {
  background: #c97050;
  color: #fff;
  border-color: #c97050;
}
.ref-content {
  overflow-x: auto;
}
.ref-section {
  margin-bottom: 24px;
}
.ref-section-title {
  font-size: 14px;
  color: #2a2014;
  margin: 0 0 8px;
  font-weight: 600;
}
.ref-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ref-table th,
.ref-table td {
  border: 1px solid rgba(58, 46, 31, 0.12);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
.ref-table th {
  background: #f7f1e0;
  color: #2a2014;
  font-weight: 600;
}
.ref-table td {
  background: #fbf6e9;
  color: #3d3023;
}
.ref-meta {
  margin-top: 16px;
  font-size: 11px;
  color: #7a6a56;
}
```

- [ ] **Step 2: 验证构建**

```bash
cd "E:/CA001/Infomat/pmo/gantt-react" && npm run build 2>&1 | tail -10
```

Expected: `built in ...ms`，0 错误。

- [ ] **Step 3: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/gantt-react/src/App.css && git commit -m "style(pmo): add styles for execution layer badges, filter toggles, gantt legend, reference tabs"
```

---

## Task 14: 更新 docs/glossary.md 加 7 个新术语

**Files:**
- Modify: `docs/glossary.md`

- [ ] **Step 1: 找到术语表新增流程段**

```bash
cd "E:/CA001/Infomat" && grep -n "术语新增流程\|## " docs/glossary.md | head -20
```

- [ ] **Step 2: 在"术语新增流程"段之前追加 7 个新术语（按 `## 1. 业务域` 或最相关域）**

根据 CLAUDE.md，PMO/执行层字段最相关是 `## 1. 业务域`。在该域末尾追加：

```markdown
### 视图分类（Text10 / viewCategory）
- **中文**：视图分类
- **英文缩写**：Text10
- **定义**：PMO 看板按用途分组的 8 类标签。值域：`Core_Procurement`（核心招采）、`MDM_Version`（主数据版本）、`Infra_Phased`（基础资源分批）、`G9_Ready`（联调准备）、`Gate`（阶段门）、`Contract_Control`（合同付款控制）、`Risk_Control`（风险闭环）。来源：H5视图分类 sheet。
- **用途**：H5 看板按视图过滤、PMO 周会分议题讨论。

### 阶段门（gateId / gateName）
- **中文**：阶段门
- **英文缩写**：Gate
- **定义**：项目从立项到终验的关键放行节点，编号 G0-G6。G0 立项与预算框架通过 → G1 总体技术路线冻结 → G2 业务蓝图冻结 → G3 主数据标准V1.0冻结 → G4 测试环境验收 → G5 灾备与安全验收 → G6 业务试运行验收。
- **用途**：阶段门未通过禁止下游推进；与付款节点绑定。

### 关键路径控制（Flag1 / isCriticalPath）
- **中文**：关键路径控制
- **英文缩写**：Flag1
- **定义**：在 PMO 看板中标记为关键路径上必须重点跟踪的任务。是/否。
- **用途**：H5 默认红色报警 + Project 重点跟踪；PMO 周会追责项之一。

### H5重点展示（Flag2 / isH5Focus）
- **中文**：H5重点展示
- **英文缩写**：Flag2
- **定义**：在 PMO 看板中标记为 H5 视图默认突出显示的任务。是/否。
- **用途**：默认悬停/H5 列表置顶；与金色菱形点视觉绑定。

### 版本控制对象（Text13 / versionObject）
- **中文**：版本控制对象
- **英文缩写**：Text13
- **定义**：主数据渐进冻结的版本标签。值域：`V0.8`（设计版）、`V0.9`（字段草案）、`V1.0`（开发版）、`V1.1`（联调版）、`全版本`。
- **用途**：主数据版本管理；联调准入判定的依据。

### 变更等级（Text14 / changeLevel）
- **中文**：变更等级
- **英文缩写**：Text14
- **定义**：主数据变更分级。值域：`A`（重大变更，24小时强交底）、`B`（重要变更，PMO 评估）、`C`（一般变更，PMO 归档）。
- **用途**：A 类变更必须升级评审；B/C 类按常规流程处理。

### 联调启动条件（Text15 / integrationStartCondition）
- **中文**：联调启动条件
- **英文缩写**：Text15
- **定义**：WBS9 全系统集成联调必须满足的条件包。值域：招采、环境/访问、主数据、接口、规则中心、备份、接口测试、总包 8 类。
- **用途**：把 WBS9 从日期驱动改为条件驱动；联调准入诊断依据。
```

- [ ] **Step 3: 验证术语表仍可读**

```bash
cd "E:/CA001/Infomat" && node scripts/glossary.mjs --list 2>&1 | tail -10
```

Expected: 列出术语，含 7 个新加的（视图分类、阶段门、关键路径控制、H5重点展示、版本控制对象、变更等级、联调启动条件）。

- [ ] **Step 4: 提交**

```bash
cd "E:/CA001/Infomat" && git add docs/glossary.md && git commit -m "docs(glossary): add 7 execution-layer terms (viewCategory, gate, isCriticalPath, isH5Focus, versionObject, changeLevel, integrationStartCondition)"
```

---

## Task 15: 更新 pmo/CLAUDE.md

**Files:**
- Modify: `pmo/CLAUDE.md:21, 28, 47-58`

- [ ] **Step 1: 真源路径切换**

`pmo/CLAUDE.md` 第 21 行：

```
│   ├── 信息化项目_Project_H5可用.xlsx        # 甘特图数据文件 (XLSX 真源)
```

替换为：

```
│   ├── 信息化项目_Project_H5最终执行版_导入表.xlsx  # 甘特图数据文件 (XLSX 真源，45 列主表 + 8 辅助 sheet)
```

- [ ] **Step 2: 删除 build-standalone.js 和老 csv 行**

`pmo/CLAUDE.md` 第 23-24 行：

```
│   ├── 信息化项目.csv                      # XLSX 转换中间产物（不要手改）
│   ├── 信息化项目_资源池简化版_V2_管理版.csv  # WBS 管理版
│   ├── 信息化项目_资源池简化版_V2_执行版.csv  # WBS 执行版
```

替换为：

```
│   └── reference.json                       # 8 辅助 sheet 转换产物（不要手改）
```

（`reference.json` 在 `gantt-react/public/` 下，但本目录概览只列 pmo 根目录文件，所以放根目录说明里。）

- [ ] **Step 3: 删除 build-standalone.js 行**

`pmo/CLAUDE.md` 第 25 行：

```
│   ├── convert_xlsx.py                    # XLSX → tasks.json 转换脚本
│   ├── build-standalone.js                # 生成内嵌数据版 HTML
│   ├── report_no_pred_tasks.py            # 无前置任务报告脚本
```

替换为：

```
│   ├── convert_xlsx.py                    # XLSX → tasks.json + reference.json 转换脚本（支持 --check 模式）
│   └── report_no_pred_tasks.py            # 无前置任务报告脚本
```

- [ ] **Step 4: 更新"甘特图数据更新"流程**

`pmo/CLAUDE.md` 第 50-56 行：

```
### 甘特图数据更新

1. 修改 `信息化项目_Project_H5可用.xlsx`
2. 运行 `python convert_xlsx.py` 重新生成 `tasks.json`
3. 刷新浏览器
```

替换为：

```
### 甘特图数据更新

1. 修改 `信息化项目_Project_H5最终执行版_导入表.xlsx`
2. 运行 `python convert_xlsx.py` 重新生成 `tasks.json` 和 `gantt-react/public/reference.json`
3. （可选）`python convert_xlsx.py --check` 查看字段填充率
4. （可选）`node scripts/smoke-reference.js` 和 `node scripts/smoke-task-fields.js` 校验
5. 刷新浏览器
```

- [ ] **Step 5: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/CLAUDE.md && git commit -m "docs(pmo): switch source path, drop build-standalone section, update data flow"
```

---

## Task 16: 更新 pmo/README.md 和 pmo/gantt-react/README.md

**Files:**
- Modify: `pmo/README.md:1-30, 24-32`
- Modify: `pmo/gantt-react/README.md:1-23, 22-32`

- [ ] **Step 1: 改 pmo/README.md 真源文件名**

`pmo/README.md` 第 3 行：

```
基于 `信息化项目_Project_H5可用.xlsx` 构建的可交互 H5 甘特图看板，用于项目管理、领导汇报和进度跟踪。
```

替换为：

```
基于 `信息化项目_Project_H5最终执行版_导入表.xlsx` 构建的可交互 H5 甘特图看板，用于项目管理、领导汇报和进度跟踪。
```

- [ ] **Step 2: 改 pmo/README.md "更新任务数据"段**

`pmo/README.md` 第 26-32 行：

```
## 更新任务数据

1. 修改 `信息化项目_Project_H5可用.xlsx`
2. 重新生成 JSON：

\`\`\`bash
cd pmo
python convert_xlsx.py
\`\`\`

3. 刷新浏览器页面
```

替换为：

```
## 更新任务数据

1. 修改 `信息化项目_Project_H5最终执行版_导入表.xlsx`
2. 重新生成 JSON：

\`\`\`bash
cd pmo
python convert_xlsx.py
\`\`\`

3. 刷新浏览器页面

## 新执行层字段

主表新增 17 个字段（视图分类、阶段门、关键路径控制、H5 重点展示、版本控制对象、变更等级、联调启动条件等），转换脚本同步落 tasks.json。`reference.json` 含 8 个辅助 sheet（H5视图分类、阶段门控制体系、H5诊断规则、交付物分级审查、PMO周会机制、合同与供应商履约控制、Project依赖规则、一级WBS管理口径），在 PMO 页"参考规则"Tab 可查阅。
```

- [ ] **Step 3: 改 pmo/gantt-react/README.md "数据来源"段**

`pmo/gantt-react/README.md` 第 14-26 行：

```
## 数据来源

`public/tasks.json` 由 `pmo/信息化项目_Project_H5可用.xlsx` 通过 `pmo/convert_xlsx.py` 转换生成。页面实际读取 `public/tasks.json`，同时保留 `pmo/tasks.json` 作为 PMO 根目录备份。

### 替换新任务数据

1. 修改 `pmo/信息化项目_Project_H5可用.xlsx`。
2. 在 `pmo/` 下运行 `python convert_xlsx.py`。
3. 脚本同时写入 `pmo/tasks.json` 和 `pmo/gantt-react/public/tasks.json`。
4. 刷新浏览器。
```

替换为：

```
## 数据来源

- `public/tasks.json` — 由 `pmo/信息化项目_Project_H5最终执行版_导入表.xlsx` 通过 `pmo/convert_xlsx.py` 转换生成，45 列扁平化结构
- `public/reference.json` — 8 个辅助 sheet 转换产物（H5视图分类、阶段门控制、H5诊断规则、交付物分级、PMO周会机制、合同付款控制、依赖规则、一级WBS管理）

### 替换新任务数据

1. 修改 `pmo/信息化项目_Project_H5最终执行版_导入表.xlsx`。
2. 在 `pmo/` 下运行 `python convert_xlsx.py`。
3. 脚本同时写入 `pmo/tasks.json`、`pmo/gantt-react/public/tasks.json`、`pmo/gantt-react/public/reference.json`。
4. 刷新浏览器。
```

- [ ] **Step 4: 在 pmo/gantt-react/README.md "功能视图"表新增参考规则**

`pmo/gantt-react/README.md` 第 47-55 行的"功能视图"表格，在末尾增：

```
| 参考规则 | 8 个辅助 sheet 的只读表（H5视图分类、阶段门控制、诊断规则、交付物分级、PMO周会、合同付款、依赖规则、WBS管理） |
```

- [ ] **Step 5: 提交**

```bash
cd "E:/CA001/Infomat" && git add pmo/README.md pmo/gantt-react/README.md && git commit -m "docs(pmo): update README files for new source file and reference.json"
```

---

## Task 17: 删除老文件

**Files:**
- Delete: `pmo/build-standalone.js`
- Delete: `pmo/信息化项目_Project_H5可用.xlsx`
- Delete: `pmo/信息化项目.csv`
- Delete: `pmo/信息化项目_资源池简化版_V2_管理版.csv`
- Delete: `pmo/信息化项目_资源池简化版_V2_执行版.csv`

- [ ] **Step 1: Grep 确认无脚本引用**

```bash
cd "E:/CA001/Infomat" && grep -rln "信息化项目_Project_H5可用\|信息化项目\.csv\|资源池简化版_V2\|build-standalone" --include="*.py" --include="*.js" --include="*.mjs" --include="*.md" --include="*.json" --include="*.sh" 2>&1 | head -20
```

Expected: 仅 `pmo/CLAUDE.md` 自身（即将改）、`pmo/README.md`（即将改）、`pmo/gantt-react/.playwright-cli/*` 旧截图（可忽略）。如果还有其他引用，先逐个处理。

- [ ] **Step 2: 删除 5 个老文件**

```bash
cd "E:/CA001/Infomat" && git rm pmo/build-standalone.js pmo/信息化项目_Project_H5可用.xlsx pmo/信息化项目.csv pmo/信息化项目_资源池简化版_V2_管理版.csv pmo/信息化项目_资源池简化版_V2_执行版.csv
```

Expected: 5 个文件被 `rm`（旧 .csv/.xlsx 不在 git 跟踪中会显示为 warning，可忽略）。

- [ ] **Step 3: 验证目录无残留**

```bash
cd "E:/CA001/Infomat" && ls pmo/build-standalone.js pmo/信息化项目_Project_H5可用.xlsx pmo/信息化项目.csv pmo/信息化项目_资源池简化版_V2_管理版.csv pmo/信息化项目_资源池简化版_V2_执行版.csv 2>&1
```

Expected: 所有路径都"cannot access"或"No such file"。

- [ ] **Step 4: 提交**

```bash
cd "E:/CA001/Infomat" && git commit -m "chore(pmo): remove legacy source file, intermediate CSVs, and build-standalone"
```

---

## Task 18: 最终端到端验证

**Files:** 无（仅验证）

- [ ] **Step 1: 跑转换脚本**

```bash
cd "E:/CA001/Infomat" && python pmo/convert_xlsx.py
```

Expected: `Wrote 434 tasks, 8 reference tables`

- [ ] **Step 2: 跑两个冒烟脚本**

```bash
cd "E:/CA001/Infomat" && node pmo/scripts/smoke-reference.js && node pmo/scripts/smoke-task-fields.js
```

Expected: 两个脚本都"结果: N 通过, 0 失败"，退出码 0。

- [ ] **Step 3: 构建 React 应用**

```bash
cd "E:/CA001/Infomat/pmo/gantt-react" && npm run build 2>&1 | tail -10
```

Expected: `built in ...ms`，0 错误。

- [ ] **Step 4: 启动 dev server 并截图（可选）**

```bash
cd "E:/CA001/Infomat/pmo/gantt-react" && npm run dev &
sleep 4
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
```

Expected: `200`

然后切到 PMO Tab → 切换到"参考规则"Tab → 8 个子页签可点击且表格渲染。

- [ ] **Step 5: 关闭 dev server**

```bash
# 找到 dev server 进程并 kill
lsof -i :5173 -t | xargs -r kill 2>/dev/null
# 或在 Windows 上：
netstat -ano | grep 5173 | awk '{print $5}' | head -1 | xargs -r taskkill /F /PID
```

- [ ] **Step 6: 提交（如有未提交的修改）**

```bash
cd "E:/CA001/Infomat" && git status -s
```

如果有未提交改动：

```bash
cd "E:/CA001/Infomat" && git add -A && git commit -m "chore(pmo): end-to-end verification cleanup"
```

否则无需 commit。

---

## 验收对照

完成全部 18 个任务后，逐项检查：

- [ ] `python pmo/convert_xlsx.py` 跑通，输出 `Wrote 434 tasks, 8 reference tables`
- [ ] `python pmo/convert_xlsx.py --check` 输出字段填充率
- [ ] `node pmo/scripts/smoke-reference.js` 10 项通过
- [ ] `node pmo/scripts/smoke-task-fields.js` 9 项通过
- [ ] `npm run build` 0 错误
- [ ] 启动 `npm run dev` 后，FilterBar 出现 4 个新筛选器且能筛选任务
- [ ] 任务条 Flag1 任务有红色边框，Flag2 任务有金色菱形
- [ ] 点击任务打开详情，"执行层上下文"分组显示 14 行
- [ ] PMO 页"参考规则"Tab 含 8 个子页签，每个子页签渲染对应表格
- [ ] 5 个老文件已删
- [ ] `docs/glossary.md` 含 7 个新术语
- [ ] `pmo/CLAUDE.md` / `pmo/README.md` / `pmo/gantt-react/README.md` 真源路径已切换
