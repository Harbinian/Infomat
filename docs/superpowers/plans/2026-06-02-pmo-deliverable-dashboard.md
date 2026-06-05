# PMO 交付物驱动项目管控看板 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 gantt-react 甘特图升级为交付物驱动的 PMO 项目管控看板，新增交付物台账、阶段门、本周/延期交付物、PMO周会5个视图。

**Architecture:** 新增2个数据层模块(deliverableUtils/phaseGateUtils) + 8个组件(5个PMO视图 + PMODatePicker + WBSQualityBanner + DeliverableDetail)，修改 App.jsx 做视图路由分发。数据源固定为 `信息化项目_WBS修复版_Project_H5可用.xlsx` 转出的修复版 `tasks.json`，并要求 `pmo/tasks.json` 与 `pmo/gantt-react/public/tasks.json` 保持一致。

**Tech Stack:** React 19 + Vite 8 + Canvas 2D API，无新依赖。

**数据质量基线（修复版 xlsx）：** 353任务 / 0重复WBS / 0孤儿节点 / 1个里程碑有子节点(ERP-MES集成，合理) / 308项有交付物 / 风险：高129 中189

---

## 主刀修订要点（2026-06-02）

本计划已经按预审问题修复为可执行版本，执行前必须遵循以下口径：

- `pmo/gantt-react/public/tasks.json` 是页面实际读取文件，必须先与 `pmo/tasks.json` 的修复版数据同步；验收基线为 353 任务 / 308 交付物 / 0 重复 WBS / 0 孤儿节点。
- `deliverableUtils.js` 的 `loadDeliverableStatusOverrides()` 必须在同一个代码块内创建并导出，避免 App.jsx import 失败。
- 阶段门匹配采用真正三层顺序：精确关键词 → 同 WBS 主线疑似 → 别名表疑似；只有精确匹配计入“已满足”，WBS/别名匹配计入“疑似”。
- 阶段门风险必须基于全局 `pmoDate` 重算，切换 PMO 观察日期后 `PhaseGateView` 和 `PMOWeeklyView` 都要更新。
- 交付物默认状态统一为 `未提交`，筛选项、颜色表、延期统计均按该状态体系处理。
- `DeliverableDetail` 通过 `gate.confirmed/gate.suspected` 反向查找关联阶段门，不再读取不存在的 `gate.matched`。
- 视觉按 PMO 管控看板处理：在保留甘特图可读性的前提下，新 PMO 控件采用米色暖宣纸系（赭红/鼠尾草/雾蓝/暗金），不再把“深色主题”作为验收标准。

## ChatGPT 审查修正清单（7项）

| # | 修正项 | 融入位置 |
|---|--------|---------|
| 1 | 覆盖率口径：区分设计/代码/运行验收 | Plan 末尾验收报告格式 |
| 2 | 交付路线：React/Vite 源码 + dist/ + README | Task 14-15 |
| 3 | 阶段门匹配：3层匹配(精确→WBS主线→别名表)，区分已满足/疑似/缺失 | Task 2 重写 |
| 4 | PMO观察日期：全局 pmoDate 状态 + 日期选择器 | Task 3.5 新增 PMODatePicker |
| 5 | 交付物状态覆盖：deliverable-status.json 覆盖机制 | Task 1 deliverableUtils + Task 12 App.jsx |
| 6 | WBS诊断面板：页面上显示数据质量提示 | Task 3.6 新增 WBSQualityBanner |
| 7 | 构建验证：npm run build + 功能检查清单 | Task 14-15 |

---

## 文件结构

```
pmo/gantt-react/src/
├── utils/
│   ├── dateUtils.js          # [已有] 日期/WBS/规范化/筛选
│   ├── deliverableUtils.js   # [新增] 交付物抽取/分类/等级 + 状态覆盖加载
│   └── phaseGateUtils.js     # [新增] 阶段门3层匹配/状态计算
├── components/
│   ├── DashboardCards.jsx     # [修改] 增加交付物统计
│   ├── FilterBar.jsx          # [修改] 新视图按钮
│   ├── PMODatePicker.jsx      # [新增] PMO观察日期选择器
│   ├── WBSQualityBanner.jsx   # [新增] WBS数据质量提示横幅
│   ├── TaskTree.jsx           # [已有] 不改
│   ├── GanttChart.jsx         # [已有] 不改
│   ├── TaskDetail.jsx         # [修改] 增加交付物关联字段
│   ├── MilestoneList.jsx      # [已有] 不改
│   ├── DeliverableLedger.jsx  # [新增] 交付物台账表格
│   ├── PhaseGateView.jsx      # [新增] 阶段门卡片(区分已满足/疑似/缺失)
│   ├── ThisWeekDeliverables.jsx # [新增] 本周交付物
│   ├── OverdueDeliverables.jsx  # [新增] 延期交付物
│   ├── PMOWeeklyView.jsx      # [新增] PMO周会四块视图
│   └── DeliverableDetail.jsx  # [新增] 交付物详情面板
├── App.jsx                    # [修改] 状态+视图路由+pmoDate+状态加载
└── App.css                    # [修改] 新样式
```

**数据流（修正后）：**
```
信息化项目_WBS修复版_Project_H5可用.xlsx → Python转换 → pmo/tasks.json + pmo/gantt-react/public/tasks.json (353任务, 0重复WBS)
  → fetch → normalizeTasks() → allTasks
    ├→ buildTaskTree() → 甘特图视图
    ├→ normalizeDeliverables() → deliverables[]
    │     ├→ 加载 deliverable-status.json 覆盖状态
    │     └→ buildPhaseGates() → phaseGates[] (3层匹配)
    └→ 新视图消费 deliverables[] + phaseGates[] + pmoDate
```

---

### Task 0: 固化修复版数据源

**Files:**
- Modify: `pmo/convert_xlsx_to_json.py`
- Copy/Update: `pmo/gantt-react/public/tasks.json`

- [ ] **Step 1: 将转换脚本数据源改为 WBS 修复版**

把 `pmo/convert_xlsx_to_json.py` 顶部的 `SRC` 改为修复版 Excel，并同时维护根目录备份和页面实际读取文件：

```python
"""Convert 信息化项目_WBS修复版_Project_H5可用.xlsx to tasks.json"""
import pandas as pd
import json
from pathlib import Path

SRC = Path('E:/CA001/Infomat/pmo/信息化项目_WBS修复版_Project_H5可用.xlsx')
PUBLIC_DST = Path('E:/CA001/Infomat/pmo/gantt-react/public/tasks.json')
ROOT_DST = Path('E:/CA001/Infomat/pmo/tasks.json')
```

把文件末尾写文件逻辑替换为：

```python
for dst in (ROOT_DST, PUBLIC_DST):
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)
    print(f'Written to {dst}')
```

- [ ] **Step 2: 重新生成页面实际数据**

```bash
cd pmo
python convert_xlsx_to_json.py
```

预期输出必须包含：

```text
Total tasks: 353
Duplicate WBS: 0 groups
Written to E:\CA001\Infomat\pmo\tasks.json
Written to E:\CA001\Infomat\pmo\gantt-react\public\tasks.json
```

- [ ] **Step 3: 校验 public/tasks.json 与验收基线一致**

```bash
node -e "const fs=require('fs');const tasks=JSON.parse(fs.readFileSync('pmo/gantt-react/public/tasks.json','utf8'));const wbs=new Map();for(const t of tasks)wbs.set(t.wbs,(wbs.get(t.wbs)||0)+1);const dup=[...wbs.values()].filter(c=>c>1).length;const all=new Set(tasks.map(t=>String(t.wbs)));const orphans=tasks.filter(t=>{const p=String(t.wbs).split('.');return p.length>1&&!all.has(p.slice(0,-1).join('.'))});console.log(JSON.stringify({tasks:tasks.length,deliverables:tasks.filter(t=>(t.deliverable||'').trim()).length,duplicateWbsGroups:dup,orphans:orphans.length,high:tasks.filter(t=>t.risk==='高').length,mid:tasks.filter(t=>t.risk==='中').length},null,2))"
```

预期：

```json
{
  "tasks": 353,
  "deliverables": 308,
  "duplicateWbsGroups": 0,
  "orphans": 0,
  "high": 129,
  "mid": 189
}
```

---

### Task 1: 创建 utils/deliverableUtils.js

**Files:**
- Create: `pmo/gantt-react/src/utils/deliverableUtils.js`

- [ ] **Step 1: 创建交付物工具模块**

```js
// deliverableUtils.js — 交付物抽取、类型分类、等级分类
import { isMilestoneTask, parseDate } from './dateUtils';

// 交付物类型分类关键词映射
const TYPE_KEYWORDS = [
  { type: '方案规范类', keywords: ['方案', '规范', '模型', '规则', '模板', '蓝图', '架构', '设计', '口径', '标准'] },
  { type: '需求规格类', keywords: ['需求', '规格', '需求规格说明书'] },
  { type: '系统功能类', keywords: ['模块', '功能', '平台', '系统', '环境', '接口', '配置', '开发', '台账', '审批流', '版本管理', '分发', '看板', '代码仓库', '数据库', '中间件', '服务器', '虚拟化'] },
  { type: '测试联调类', keywords: ['测试', '联调', '演练', '恢复', '压测', '验证', '试运行'] },
  { type: '评审验收类', keywords: ['评审', '上线', '验收', '发布', '确认单', '就绪', '纪要'] },
  { type: '报告清单类', keywords: ['报告', '清单', '审计', '问题', '差距', '风险', '质量报告', '试点报告'] },
  { type: '培训手册类', keywords: ['培训', '手册', '操作手册', '运维手册', '材料'] },
  { type: '过程记录类', keywords: ['记录', '会议纪要', '调研记录', '流程材料', '映射'] },
];

/** 根据任务名称和类型自动分类交付物类型 */
export function classifyDeliverableType(task) {
  const text = (task.name || '') + (task.deliverable || '') + (task.type || '');
  for (const { type, keywords } of TYPE_KEYWORDS) {
    if (keywords.some(kw => text.includes(kw))) return type;
  }
  return '其他';
}

// 阶段门关键任务名（A类判定用）
const GATE_TASK_NAMES = [
  '蓝图评审', '数据标准V1.0', 'MDM平台一期上线', 'MDM一期验收',
  'PLM基础深化验收', 'MES蓝图评审', 'MES一期试运行', 'MES一期正式上线',
  '全系统集成联调完成', '生产现场全面推广完成', '数据治理常态化机制验收',
  'AI应用/数字员工试点完成', '项目总体验收'
];

// 阶段门关键交付物名（A类判定用）
const GATE_DELIVERABLE_NAMES = [
  '验收报告', '上线确认单', '评审意见', '总体蓝图', '数据标准V1.0'
];

// MDM/PLM/MES/ERP/OA/QMS/基础设施/AI 主线 WBS 前缀
const MAINLINE_WBS_PREFIXES = ['3', '4', '5', '6', '7', '8', '9', '10'];

/** 根据任务属性和交付物类型自动分类交付物等级 (A/B/C/D) */
export function classifyDeliverableLevel(task, deliverableType) {
  // A类判定
  if (task.isMilestone) return 'A';
  const text = (task.name || '') + (task.deliverable || '');
  if (GATE_TASK_NAMES.some(n => text.includes(n))) return 'A';
  if (GATE_DELIVERABLE_NAMES.some(n => text.includes(n))) return 'A';

  // B类判定
  if (['系统功能类', '测试联调类', '需求规格类'].includes(deliverableType)) return 'B';
  if (task.risk === '高') return 'B';
  const topWbs = String(task.wbs || '').split('.')[0];
  if (MAINLINE_WBS_PREFIXES.includes(topWbs)) return 'B';
  const dlv = (task.deliverable || '');
  if (/接口|模块|测试报告|联调记录|主数据模型|质量校验|看板/.test(dlv)) return 'B';

  // C类判定
  if (/调研记录|培训记录|会议纪要|操作手册|运维手册|流程材料/.test(text)) return 'C';
  if (deliverableType === '培训手册类' || deliverableType === '过程记录类') return 'C';

  // D类判定
  if (/草案|初稿|内部材料|临时说明/.test(text)) return 'D';

  return 'C'; // 默认支撑过程
}

/** 从规范化任务中抽取非空交付物 */
export function normalizeDeliverables(normalizedTasks) {
  const deliverables = [];
  let counter = 1;

  for (const task of normalizedTasks) {
    const dlvName = (task.deliverable || '').trim();
    if (!dlvName) continue;
    // 跳过虚拟父节点
    if (task.notes && task.notes.includes('[自动生成的虚拟父节点]')) continue;
    // 跳过摘要任务（摘要任务通常没有实际交付物）
    if (task.isSummary && !task.isMilestone) continue;

    const dlvType = classifyDeliverableType(task);
    const dlvLevel = classifyDeliverableLevel(task, dlvType);

    deliverables.push({
      deliverableId: `DLV-${String(counter).padStart(3, '0')}`,
      taskId: task.originalId ?? task.id,
      taskName: task.name,
      originalWbs: task.originalWbs || task.wbs,
      normalizedWbs: task.normalizedWbs || task.wbs,
      nodeKey: task.nodeKey,
      deliverableName: dlvName,
      deliverableType: dlvType,
      deliverableLevel: dlvLevel,
      department: task.department || '',
      reviewer: task.reviewer || '',
      vendor: task.vendor || '',
      plannedFinish: task.finish || '',
      taskRisk: task.risk || '中',
      deliverableStatus: '未提交',
      isPhaseGate: dlvLevel === 'A',
      isRequiredForGate: false,
      notes: ''
    });
    counter++;
  }

  // 标记阶段门关联
  for (const d of deliverables) {
    if (d.deliverableLevel === 'A' || /验收|上线|评审|蓝图|标准/.test(d.deliverableName)) {
      d.isPhaseGate = true;
    }
  }

  console.log(`%c✓ 交付物抽取完成：${deliverables.length} 个 (A:${deliverables.filter(d=>d.deliverableLevel==='A').length} B:${deliverables.filter(d=>d.deliverableLevel==='B').length} C:${deliverables.filter(d=>d.deliverableLevel==='C').length} D:${deliverables.filter(d=>d.deliverableLevel==='D').length})`, 'color:#27ae60;');
  return deliverables;
}

/** 计算交付物统计 */
export function calcDeliverableStats(deliverables, tasks) {
  const now = new Date();
  const aLevel = deliverables.filter(d => d.deliverableLevel === 'A');
  const bLevel = deliverables.filter(d => d.deliverableLevel === 'B');
  const overdue = deliverables.filter(d => {
    if (!d.plannedFinish) return false;
    if (d.deliverableStatus === '通过' || d.deliverableStatus === '已归档') return false;
    const f = parseDate(d.plannedFinish);
    return f && f < now;
  });
  const highRiskDlv = deliverables.filter(d => d.taskRisk === '高');
  const highRiskTasks = tasks.filter(t => t.risk === '高');
  const normalTasks = tasks.filter(t => !t.isSummary && !t.isMilestone);
  const summaryTasks = tasks.filter(t => t.isSummary);
  const milestones = tasks.filter(t => t.isMilestone);

  return {
    totalTasks: tasks.length,
    normalTaskCount: normalTasks.length,
    summaryTaskCount: summaryTasks.length,
    milestoneCount: milestones.length,
    deliverableTotal: deliverables.length,
    aLevelCount: aLevel.length,
    bLevelCount: bLevel.length,
    overdueCount: overdue.length,
    highRiskTaskCount: highRiskTasks.length,
    highRiskDlvCount: highRiskDlv.length,
  };
}

/** 加载交付物状态覆盖文件（可选） */
export async function loadDeliverableStatusOverrides(deliverables) {
  try {
    const resp = await fetch('deliverable-status.json');
    if (!resp.ok) {
      console.log('%cℹ 未找到 deliverable-status.json，使用默认状态', 'color:#8b90a0;');
      return deliverables;
    }
    const overrides = await resp.json();
    const overrideMap = {};
    overrides.forEach(o => { overrideMap[o.deliverableId] = o; });

    const updated = deliverables.map(d => {
      const ov = overrideMap[d.deliverableId];
      if (ov) {
        return {
          ...d,
          deliverableStatus: ov.status || d.deliverableStatus,
          _actualSubmitDate: ov.actualSubmitDate || '',
          _actualPassDate: ov.actualPassDate || '',
          _ownerNote: ov.ownerNote || '',
          notes: ov.ownerNote || d.notes,
        };
      }
      return d;
    });

    const changed = updated.filter(d => overrideMap[d.deliverableId]);
    console.log(`%c✓ 加载交付物状态覆盖：${changed.length} 项`, 'color:#27ae60;');
    return updated;
  } catch (e) {
    console.warn('加载 deliverable-status.json 失败:', e.message);
    return deliverables;
  }
}
```

- [ ] **Step 2: 创建示例 deliverable-status.json**

```json
[
  {
    "deliverableId": "DLV-001",
    "status": "待评审",
    "actualSubmitDate": "2026-06-20",
    "actualPassDate": "",
    "ownerNote": "已提交初稿，等待 PMO 评审"
  }
]
```

文件位置：`pmo/gantt-react/public/deliverable-status.json`

- [ ] **Step 3: 验证模块导入无报错**

```bash
cd pmo/gantt-react
node -e "import('./src/utils/deliverableUtils.js').then(()=>console.log('deliverableUtils import ok'))"
```

预期：输出 `deliverableUtils import ok`，无 import / syntax 报错。

---

### Task 2: 创建 utils/phaseGateUtils.js（3层匹配版）

**Files:**
- Create: `pmo/gantt-react/src/utils/phaseGateUtils.js`

- [ ] **Step 1: 创建阶段门工具模块（3层匹配 + 区分已满足/疑似/缺失）**

```js
// phaseGateUtils.js — 阶段门定义、3层匹配、状态计算
import { parseDate } from './dateUtils';

// ===== 别名表：人工配置同义词 =====
const GATE_ALIAS_MAP = {
  '总体蓝图': ['总体蓝图', '蓝图文件', '总体方案'],
  '系统架构方案': ['系统架构方案', '架构方案', '技术架构方案'],
  'MES蓝图': ['MES蓝图', 'MES总体蓝图', 'MES实施蓝图'],
  '联调报告': ['联调报告', '集成联调报告', '接口联调报告'],
  '试运行报告': ['试运行报告', '试运行总结', '试运行总结报告'],
  '验收报告': ['验收报告', '验收总结报告', '阶段验收报告'],
  '培训材料': ['培训材料', '培训资料', '培训教材', '培训文档'],
  '测试报告': ['测试报告', '测试总结报告', '模块测试报告'],
};

// ===== 固定8个阶段门 =====
const GATE_DEFINITIONS = [
  {
    gateId: 'GATE-01', gateName: '总体蓝图评审', plannedDate: '',
    requiredDeliverables: ['总体蓝图', '系统架构方案', '总体实施计划', '评审材料'],
    blockingRule: '不通过不得进入详细建设'
  },
  {
    gateId: 'GATE-02', gateName: '数据标准V1.0发布',
    requiredDeliverables: ['主数据分类标准', '编码规则', '属性模板', '数据质量模板', '培训材料'],
    blockingRule: '不通过不得作为 MDM/MES 正式主数据依据'
  },
  {
    gateId: 'GATE-03', gateName: 'MDM一期上线',
    requiredDeliverables: ['主数据台账', '审批流', '版本管理', '数据分发', '质量校验', '数据质量看板', '试运行报告'],
    blockingRule: '不通过不得进入 MES 主数据联调'
  },
  {
    gateId: 'GATE-04', gateName: 'PLM基础深化验收',
    requiredDeliverables: ['EBOM规范', 'EBOM到MBOM转换规则', '工艺结构化模板', 'PLM-MDM接口', 'PLM-MES接口', '测试报告', '验收报告'],
    blockingRule: '不通过不得进入 MES 工艺/MBOM 联调'
  },
  {
    gateId: 'GATE-05', gateName: 'MES一期上线',
    requiredDeliverables: ['MES蓝图', '详细需求规格说明书', '详细设计说明书', '模块测试报告', '接口联调记录', '培训材料', '试运行报告', '正式上线报告'],
    blockingRule: '不通过不得进入生产现场全面推广'
  },
  {
    gateId: 'GATE-06', gateName: 'QMS低代码平台基础能力完成',
    requiredDeliverables: ['QMS原型', '质量流程配置', '问题闭环配置', '测试报告', '培训材料'],
    blockingRule: '不通过不得与 MES 质量闭环联动'
  },
  {
    gateId: 'GATE-07', gateName: '全系统集成联调完成',
    requiredDeliverables: ['联调方案', '联调记录', '问题清单', '整改关闭清单', '联调报告'],
    blockingRule: '不通过不得进入总体验收'
  },
  {
    gateId: 'GATE-08', gateName: '项目总体验收',
    requiredDeliverables: ['总体验收报告', '运维交接材料', '风险关闭清单', '问题关闭清单', '知识库归档'],
    blockingRule: '不通过不得关闭项目'
  }
];

/** 获取某需求关键词的别名列表 */
function getAliases(keyword) {
  return GATE_ALIAS_MAP[keyword] || [keyword];
}

/** 第1层：精确关键词包含匹配 */
function exactMatch(deliverableName, keyword) {
  const dlv = deliverableName.toLowerCase();
  return dlv.includes(keyword.toLowerCase());
}

/** 第2层：同一WBS主线内匹配 */
function sameMainlineMatch(deliverableName, keyword, deliverableWbs, gateWbsPrefixes) {
  // 如果交付物的WBS主线在阶段门关注的范围内，放宽匹配
  const dlvPrefix = String(deliverableWbs || '').split('.')[0];
  if (!gateWbsPrefixes || gateWbsPrefixes.includes(dlvPrefix)) {
    const dlv = deliverableName.toLowerCase();
    const kw = keyword.toLowerCase();
    // 至少包含关键词的2/3字符
    const kwChars = kw.replace(/\s+/g, '');
    let matchCount = 0;
    for (const ch of kwChars) {
      if (dlv.includes(ch)) matchCount++;
    }
    return matchCount >= kwChars.length * 0.75;
  }
  return false;
}

/** 第3层：别名表疑似匹配 */
function aliasMatch(deliverableName, keyword) {
  const dlv = deliverableName.toLowerCase();
  const aliases = getAliases(keyword).filter(alias => alias !== keyword);
  return aliases.some(alias => dlv.includes(alias.toLowerCase()));
}

// 阶段门关注的WBS主线前缀（按阶段门编号）
const GATE_WBS_PREFIXES = {
  'GATE-01': ['1'],        // 总体蓝图 → WBS 1.x
  'GATE-02': ['3'],        // 数据标准 → WBS 3.x
  'GATE-03': ['4'],        // MDM → WBS 4.x
  'GATE-04': ['5'],        // PLM → WBS 5.x
  'GATE-05': ['6'],        // MES → WBS 6.x
  'GATE-06': ['7'],        // QMS → WBS 7.x
  'GATE-07': ['8','9'],    // 集成联调 → WBS 8.x, 9.x
  'GATE-08': ['10'],       // 总体验收 → WBS 10.x
};

/** 3层匹配：返回 { confirmed: [...], suspected: [...], missing: [...] } */
export function matchDeliverablesToGate(gate, deliverables) {
  const confirmed = [];   // 第1层精确匹配：计入已满足
  const suspected = [];   // 第2/3层匹配：计入疑似，需 PMO 确认
  const missing = [];     // 未匹配
  const wbsPrefixes = GATE_WBS_PREFIXES[gate.gateId] || [];

  for (const req of gate.requiredDeliverables) {
    let exact = null;
    const wbsSuspects = [];
    const aliasSuspects = [];

    for (const d of deliverables) {
      if (exactMatch(d.deliverableName, req)) {
        exact = { required: req, deliverable: d, matchType: '精确' };
        break; // 精确匹配到一个就停止
      }
    }

    if (exact) {
      confirmed.push(exact);
      continue;
    }

    for (const d of deliverables) {
      if (sameMainlineMatch(d.deliverableName, req, d.normalizedWbs, wbsPrefixes)) {
        wbsSuspects.push({ required: req, deliverable: d, matchType: 'WBS主线' });
      }
    }

    if (wbsSuspects.length > 0) {
      suspected.push(...wbsSuspects);
      continue;
    }

    for (const d of deliverables) {
      if (aliasMatch(d.deliverableName, req)) {
        aliasSuspects.push({ required: req, deliverable: d, matchType: '别名表' });
      }
    }

    if (aliasSuspects.length > 0) {
      suspected.push(...aliasSuspects);
    } else {
      missing.push(req);
    }
  }

  return { confirmed, suspected, missing };
}

/** 计算阶段门状态（基于 pmoDate） */
function computeGateStatus(gate, confirmed, suspected, missing, referenceDate) {
  const now = referenceDate || new Date();
  const totalRequired = gate.requiredDeliverables.length;
  const confirmedCount = confirmed.length;
  const suspectedCount = suspected.length;

  if (confirmedCount === 0 && suspectedCount === 0) return { status: '未开始', color: '#6b7194' };
  if (confirmedCount === totalRequired) {
    // 全部精确匹配：检查是否有延期
    const allDlvs = confirmed.map(c => c.deliverable);
    const hasOverdue = allDlvs.some(d => {
      const f = parseDate(d.plannedFinish);
      return f && f < now && d.deliverableStatus !== '通过' && d.deliverableStatus !== '已归档';
    });
    if (hasOverdue) return { status: '风险', color: '#e74c3c' };
    return { status: '通过', color: '#4CAF50' };
  }
  if (confirmedCount > 0) {
    // 部分精确匹配 + 疑似
    const allDlvs = confirmed.map(c => c.deliverable);
    const hasOverdue = allDlvs.some(d => {
      const f = parseDate(d.plannedFinish);
      return f && f < now && (d.deliverableLevel === 'A' || d.deliverableLevel === 'B');
    });
    if (hasOverdue) return { status: '风险', color: '#e74c3c' };
    return { status: '进行中', color: '#4A90D9' };
  }
  // 仅有疑似匹配
  return { status: '待确认', color: '#f39c12' };
}

/** 构建阶段门列表（接受 referenceDate 用于风险判定） */
export function buildPhaseGates(deliverables, referenceDate) {
  return GATE_DEFINITIONS.map(gate => {
    const { confirmed, suspected, missing } = matchDeliverablesToGate(gate, deliverables);
    const { status, color } = computeGateStatus(gate, confirmed, suspected, missing, referenceDate);
    return {
      ...gate,
      confirmed,
      suspected,
      missing,
      status,
      statusColor: color,
      confirmedCount: confirmed.length,
      suspectedCount: suspected.length,
      totalRequired: gate.requiredDeliverables.length,
    };
  });
}

/** 阶段门风险数量 */
export function countGatesAtRisk(phaseGates) {
  return phaseGates.filter(g => g.status === '风险').length;
}
```

- [ ] **Step 2: 验证模块导入无报错**

```bash
cd pmo/gantt-react
node -e "import('./src/utils/phaseGateUtils.js').then(()=>console.log('phaseGateUtils import ok'))"
```

预期：输出 `phaseGateUtils import ok`，无 import / syntax 报错。

---

### Task 3: 修改 DashboardCards.jsx

**Files:**
- Modify: `pmo/gantt-react/src/components/DashboardCards.jsx`

- [ ] **Step 1: 重写 DashboardCards 增加交付物统计**

将现有 DashboardCards.jsx 替换为以下内容：

```jsx
import { useMemo } from 'react';
import { parseDate, unique } from '../utils/dateUtils';

export default function DashboardCards({ tasks, deliverables, phaseGates, pmoDate }) {
  const stats = useMemo(() => {
    const now = pmoDate || new Date();
    const milestones = tasks.filter(t => t.isMilestone);
    const highRisk = tasks.filter(t => t.risk === '高');
    const normalTasks = tasks.filter(t => !t.isSummary && !t.isMilestone);
    const summaryTasks = tasks.filter(t => t.isSummary);
    const inProgress = tasks.filter(t => {
      const s = parseDate(t.start), f = parseDate(t.finish);
      if (!s || !f) return false;
      return s <= now && f >= now;
    });
    const aLevel = (deliverables || []).filter(d => d.deliverableLevel === 'A');
    const bLevel = (deliverables || []).filter(d => d.deliverableLevel === 'B');
    const overdue = (deliverables || []).filter(d => {
      if (!d.plannedFinish) return false;
      if (d.deliverableStatus === '通过' || d.deliverableStatus === '已归档') return false;
      const f = parseDate(d.plannedFinish);
      return f && f < now;
    });
    const gatesAtRisk = (phaseGates || []).filter(g => g.status === '风险');
    const highRiskDlv = (deliverables || []).filter(d => d.taskRisk === '高');
    const depts = unique(tasks.map(t => t.department).filter(Boolean));

    return {
      total: tasks.length,
      normalTaskCount: normalTasks.length,
      summaryTaskCount: summaryTasks.length,
      milestones: milestones.length,
      highRisk: highRisk.length,
      inProgress: inProgress.length,
      deliverableTotal: (deliverables || []).length,
      aLevelCount: aLevel.length,
      bLevelCount: bLevel.length,
      overdueCount: overdue.length,
      gatesAtRisk: gatesAtRisk.length,
      highRiskDlvCount: highRiskDlv.length,
      departments: depts.length
    };
  }, [tasks, deliverables, phaseGates, pmoDate]);

  const cards = [
    { value: stats.total, label: '总任务数' },
    { value: stats.normalTaskCount, label: '普通任务' },
    { value: stats.summaryTaskCount, label: '摘要任务' },
    { value: stats.milestones, label: '里程碑' },
    { value: stats.highRisk, label: '高风险任务', highlight: true },
    { value: stats.deliverableTotal, label: '交付物总数' },
    { value: stats.aLevelCount, label: 'A类交付物', cls: 'stat-a' },
    { value: stats.bLevelCount, label: 'B类交付物', cls: 'stat-b' },
    { value: stats.overdueCount, label: '延期交付物', highlight: true },
    { value: stats.gatesAtRisk, label: '阶段门风险', highlight: true },
    { value: stats.highRiskDlvCount, label: '高风险交付物', highlight: true },
  ];

  // 只显示前8个卡片（适应屏幕），或全部显示
  const displayCards = cards;

  return (
    <div className="dashboard">
      {displayCards.map((c, i) => (
        <div key={i} className={`stat-card ${c.highlight ? 'highlight' : ''} ${c.cls || ''}`}>
          <div className="stat-value">{c.value}</div>
          <div className="stat-label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
```

---

### Task 3.5: 创建 PMODatePicker.jsx

**Files:**
- Create: `pmo/gantt-react/src/components/PMODatePicker.jsx`

- [ ] **Step 1: 创建 PMO 观察日期选择器**

```jsx
import { formatDate } from '../utils/dateUtils';

export default function PMODatePicker({ pmoDate, onDateChange, projectStart }) {
  const handleToday = () => onDateChange(new Date());
  const handleProjectStart = () => onDateChange(projectStart ? new Date(projectStart) : new Date(2026, 5, 1));
  const handleDateInput = (e) => {
    const [y, m, d] = e.target.value.split('-').map(Number);
    if (y && m && d) onDateChange(new Date(y, m - 1, d));
  };

  const dateStr = pmoDate ? formatDate(pmoDate) : '';

  return (
    <div className="pmo-date-picker">
      <span className="pmo-date-label">PMO观察日期：</span>
      <span className="pmo-date-value">{formatDate(pmoDate)}</span>
      <button className="pmo-date-btn" onClick={handleToday}>今天</button>
      <button className="pmo-date-btn" onClick={handleProjectStart}>项目开始</button>
      <input type="date" className="pmo-date-input" value={dateStr} onChange={handleDateInput} />
    </div>
  );
}
```

---

### Task 3.6: 创建 WBSQualityBanner.jsx

**Files:**
- Create: `pmo/gantt-react/src/components/WBSQualityBanner.jsx`

- [ ] **Step 1: 创建 WBS 数据质量提示横幅**

```jsx
export default function WBSQualityBanner({ rawTasks }) {
  if (!rawTasks || rawTasks.length === 0) return null;

  // 计算质量指标
  const wbsMap = {};
  rawTasks.forEach(t => {
    const w = t.wbs;
    if (!wbsMap[w]) wbsMap[w] = [];
    wbsMap[w].push(t);
  });
  const dupeWbs = Object.entries(wbsMap).filter(([, v]) => v.length > 1);

  const allWbs = new Set(rawTasks.map(t => t.wbs));
  const msWithChildren = rawTasks.filter(t => {
    const ms = t.milestone === '是' || t.type === '里程碑' || (t.duration || '').includes('0工作日');
    return ms && rawTasks.some(c => String(c.wbs).startsWith(String(t.wbs) + '.') && c.wbs !== t.wbs);
  });
  const toleratedMilestoneParents = msWithChildren.filter(t => /ERP-MES/.test(t.name || ''));
  const unexpectedMilestoneParents = msWithChildren.filter(t => !/ERP-MES/.test(t.name || ''));
  const orphans = rawTasks.filter(t => {
    const parts = String(t.wbs).split('.');
    return parts.length > 1 && !allWbs.has(parts.slice(0, -1).join('.'));
  });

  const backRefs = [];
  const idSet = new Set(rawTasks.map(t => t.id));
  rawTasks.forEach(t => {
    if (!t.predecessors) return;
    String(t.predecessors).split(',').forEach(p => {
      const pid = parseInt(p.trim());
      if (pid && idSet.has(pid) && pid > t.id) backRefs.push({ id: t.id, pred: pid });
    });
  });

  const issues = [];
  if (dupeWbs.length > 0) issues.push(`${dupeWbs.length} 组重复WBS`);
  if (unexpectedMilestoneParents.length > 0) issues.push(`${unexpectedMilestoneParents.length} 个里程碑占用父级编号`);
  if (orphans.length > 0) issues.push(`${orphans.length} 个子任务缺父级`);
  if (backRefs.length > 0) issues.push(`${backRefs.length} 处后向前置引用`);

  if (issues.length === 0) {
    return (
      <div className="wbs-quality-banner clean">
        <span>WBS 数据质量：通过 ✓</span>
        <span className="wbs-quality-detail">0重复WBS | 0孤儿节点 | {rawTasks.length}任务{toleratedMilestoneParents.length ? ` | ${toleratedMilestoneParents.length}个已确认父级里程碑` : ''}</span>
      </div>
    );
  }

  return (
    <div className="wbs-quality-banner warning">
      <span>WBS 数据质量：需关注（{issues.join('、')}）</span>
      <span className="wbs-quality-detail">源数据仍需治理，展示层已规范化处理</span>
    </div>
  );
}
```

---

### Task 4: 创建 DeliverableDetail.jsx

**Files:**
- Create: `pmo/gantt-react/src/components/DeliverableDetail.jsx`

- [ ] **Step 1: 创建交付物详情面板 (含关联阶段门反向查找)**

```jsx
import { useMemo } from 'react';
import { formatDate, parseDate } from '../utils/dateUtils';

// 等级颜色
const LEVEL_COLORS = { A: '#f4b400', B: '#7C4DFF', C: '#607D8B', D: '#6b7194' };
const STATUS_COLORS = { '未提交': '#9A8F7A', '编制中': '#4A90D9', '已提交': '#C9872B', '待评审': '#B88919', '通过': '#6C8F68', '退回整改': '#B24A3A', '已归档': '#6F7F8F' };

/** 反向查找该交付物关联的阶段门 */
function findRelatedGates(deliverable, phaseGates) {
  if (!phaseGates || !deliverable) return [];
  return phaseGates.filter(gate => {
    const matches = [...(gate.confirmed || []), ...(gate.suspected || [])];
    return matches.some(m => m.deliverable && m.deliverable.deliverableId === deliverable.deliverableId);
  });
}

export default function DeliverableDetail({ deliverable, phaseGates, onClose }) {
  if (!deliverable) return null;

  const relatedGates = useMemo(() => findRelatedGates(deliverable, phaseGates), [deliverable, phaseGates]);

  const fields = [
    { label: '交付物编号', value: deliverable.deliverableId },
    { label: '交付物名称', value: deliverable.deliverableName },
    { label: '交付物类型', value: deliverable.deliverableType },
    { label: '交付物等级', value: deliverable.deliverableLevel, badge: 'level' },
    { label: '关联任务', value: deliverable.taskName },
    { label: '原始WBS', value: deliverable.originalWbs },
    { label: '规范WBS', value: deliverable.normalizedWbs },
    { label: '责任部门', value: deliverable.department || '-' },
    { label: '供应商', value: deliverable.vendor || '-' },
    { label: '审核人/审批组', value: deliverable.reviewer || '-' },
    { label: '计划完成时间', value: formatDate(parseDate(deliverable.plannedFinish)) },
    { label: '风险等级', value: deliverable.taskRisk || '中', badge: 'risk' },
    { label: '交付物状态', value: deliverable.deliverableStatus, badge: 'status' },
    { label: '是否阶段门交付物', value: deliverable.isPhaseGate ? '是' : '否' },
    { label: '关联阶段门', value: relatedGates.length > 0 ? relatedGates.map(g => g.gateName).join('、') : '-' },
  ];

  return (
    <div className="detail-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="detail-header">
        <h3>交付物详情</h3>
        <button className="detail-close" onClick={onClose}>&times;</button>
      </div>
      <div className="detail-body">
        {fields.map((f, i) => (
          <div key={i} className="detail-field">
            <label>{f.label}</label>
            {f.badge === 'level'
              ? <span className="value badge" style={{ background: LEVEL_COLORS[f.value] + '22', color: LEVEL_COLORS[f.value], border: '1px solid ' + LEVEL_COLORS[f.value] }}>{f.value}类</span>
              : f.badge === 'risk'
                ? <span className={`value badge risk-${f.value}`}>{f.value}</span>
                : f.badge === 'status'
                  ? <span className="value badge" style={{ background: (STATUS_COLORS[f.value] || '#6b7194') + '22', color: STATUS_COLORS[f.value] || '#6b7194' }}>{f.value}</span>
                  : <span className="value">{f.value}</span>
            }
          </div>
        ))}
        {deliverable.notes && (
          <div className="detail-field">
            <label>备注</label>
            <span className="value">{deliverable.notes}</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

### Task 5: 创建 DeliverableLedger.jsx

**Files:**
- Create: `pmo/gantt-react/src/components/DeliverableLedger.jsx`

- [ ] **Step 1: 创建交付物台账表格视图**

```jsx
import { useState, useMemo } from 'react';
import { formatDate, parseDate, unique } from '../utils/dateUtils';

const LEVEL_COLORS = { A: '#f4b400', B: '#7C4DFF', C: '#607D8B', D: '#6b7194' };

export default function DeliverableLedger({ deliverables, onSelectDeliverable }) {
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterDept, setFilterDept] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const types = useMemo(() => unique(deliverables.map(d => d.deliverableType)).sort(), [deliverables]);
  const depts = useMemo(() => unique(deliverables.map(d => d.department).filter(Boolean)).sort(), [deliverables]);
  const months = useMemo(() => {
    const ms = new Set();
    deliverables.forEach(d => {
      const f = parseDate(d.plannedFinish);
      if (f) ms.add(`${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`);
    });
    return [...ms].sort();
  }, [deliverables]);

  const filtered = useMemo(() => {
    return deliverables.filter(d => {
      if (filterLevel !== 'all' && d.deliverableLevel !== filterLevel) return false;
      if (filterType !== 'all' && d.deliverableType !== filterType) return false;
      if (filterDept !== 'all' && d.department !== filterDept) return false;
      if (filterMonth !== 'all') {
        const f = parseDate(d.plannedFinish);
        if (!f) return false;
        const ym = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
        if (ym !== filterMonth) return false;
      }
      if (filterStatus !== 'all' && d.deliverableStatus !== filterStatus) return false;
      return true;
    });
  }, [deliverables, filterLevel, filterType, filterDept, filterMonth, filterStatus]);

  return (
    <div className="deliverable-view">
      <div className="dlv-filter-bar">
        <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)}>
          <option value="all">全部等级</option>
          <option value="A">A类-阶段门</option>
          <option value="B">B类-关键建设</option>
          <option value="C">C类-支撑过程</option>
          <option value="D">D类-参考材料</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="all">全部类型</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)}>
          <option value="all">全部部门</option>
          {depts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
          <option value="all">全部月份</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">全部状态</option>
          <option value="未提交">未提交</option>
          <option value="编制中">编制中</option>
          <option value="已提交">已提交</option>
          <option value="待评审">待评审</option>
          <option value="通过">通过</option>
          <option value="退回整改">退回整改</option>
          <option value="已归档">已归档</option>
        </select>
        <span className="dlv-count">共 {filtered.length} 项</span>
      </div>

      <div className="dlv-table-wrap">
        <table className="dlv-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>交付物名称</th>
              <th>类型</th>
              <th>等级</th>
              <th>关联任务</th>
              <th>规范WBS</th>
              <th>责任部门</th>
              <th>审核人</th>
              <th>供应商</th>
              <th>计划完成</th>
              <th>风险</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(d => (
              <tr key={d.deliverableId}
                className={`dlv-row dlv-level-${d.deliverableLevel} ${d.taskRisk === '高' ? 'dlv-high-risk' : ''}`}
                onClick={() => onSelectDeliverable && onSelectDeliverable(d)}>
                <td className="dlv-id">{d.deliverableId}</td>
                <td className="dlv-name" title={d.deliverableName}>{d.deliverableName}</td>
                <td>{d.deliverableType}</td>
                <td><span className="dlv-level-badge" style={{ color: LEVEL_COLORS[d.deliverableLevel], borderColor: LEVEL_COLORS[d.deliverableLevel] }}>{d.deliverableLevel}</span></td>
                <td className="dlv-task" title={d.taskName}>{d.taskName.length > 20 ? d.taskName.slice(0, 20) + '…' : d.taskName}</td>
                <td className="dlv-wbs">{d.normalizedWbs}</td>
                <td>{d.department || '-'}</td>
                <td className="dlv-reviewer" title={d.reviewer}>{d.reviewer ? (d.reviewer.length > 12 ? d.reviewer.slice(0, 12) + '…' : d.reviewer) : '-'}</td>
                <td>{d.vendor || '-'}</td>
                <td>{d.plannedFinish ? formatDate(parseDate(d.plannedFinish)) : '-'}</td>
                <td><span className={`dlv-risk risk-${d.taskRisk}`}>{d.taskRisk}</span></td>
                <td><span className="dlv-status">{d.deliverableStatus}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

### Task 6: 创建 PhaseGateView.jsx（区分已满足/疑似/缺失）

**Files:**
- Create: `pmo/gantt-react/src/components/PhaseGateView.jsx`

- [ ] **Step 1: 创建阶段门卡片视图（确认/疑似/缺失 三类标记）**

```jsx
export default function PhaseGateView({ phaseGates }) {
  if (!phaseGates || phaseGates.length === 0) {
    return <div className="empty-view">暂无阶段门数据</div>;
  }

  return (
    <div className="phasegate-view">
      <div className="phasegate-header-row">
        <span className="phasegate-title">阶段门管控视图</span>
        <span className="phasegate-summary">
          {phaseGates.filter(g => g.status === '通过').length}/{phaseGates.length} 通过
          {' | '}
          <span className="risk-text">{phaseGates.filter(g => g.status === '风险').length} 个风险</span>
        </span>
      </div>
      <div className="phasegate-grid">
        {phaseGates.map(gate => (
          <div key={gate.gateId} className={`gate-card gate-status-${gate.status}`}
            style={{ borderLeftColor: gate.statusColor }}>
            <div className="gate-card-header">
              <span className="gate-id">{gate.gateId}</span>
              <span className="gate-status-badge" style={{ background: gate.statusColor + '22', color: gate.statusColor }}>{gate.status}</span>
            </div>
            <h4 className="gate-name">{gate.gateName}</h4>
            <div className="gate-blocking">
              <span className="gate-label">阻断规则：</span>
              <span>{gate.blockingRule}</span>
            </div>
            <div className="gate-progress">
              <span>交付物匹配：{gate.confirmedCount}确认 + {gate.suspectedCount}疑似 / {gate.totalRequired}必需</span>
              <div className="gate-progress-bar">
                <div className="gate-progress-fill confirmed" style={{ width: (gate.confirmedCount / gate.totalRequired * 100) + '%', background: gate.statusColor }} />
                <div className="gate-progress-fill suspected" style={{ width: (gate.suspectedCount / gate.totalRequired * 100) + '%', background: '#f39c12' }} />
              </div>
            </div>
            {/* 确认匹配 */}
            {gate.confirmed.length > 0 && (
              <div className="gate-matched">
                <span className="gate-label">已满足 ({gate.confirmed.length})：</span>
                {gate.confirmed.map((c, i) => (
                  <span key={i} className="gate-matched-item confirmed" title={c.deliverable.deliverableName}>
                    {c.required}
                  </span>
                ))}
              </div>
            )}
            {/* 疑似匹配 */}
            {gate.suspected.length > 0 && (
              <div className="gate-matched">
                <span className="gate-label">疑似匹配 ({gate.suspected.length})：</span>
                {gate.suspected.map((s, i) => (
                  <span key={i} className="gate-matched-item suspected" title={`${s.deliverable.deliverableName} [${s.matchType}]`}>
                    {s.required} ?
                  </span>
                ))}
              </div>
            )}
            {/* 缺失 */}
            {gate.missing.length > 0 && (
              <div className="gate-missing">
                <span className="gate-label">缺失 ({gate.missing.length})：</span>
                {gate.missing.map((m, i) => <span key={i} className="gate-missing-tag">{m}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS 补充确认/疑似样式**（追加到 Task 13 App.css）

```css
.gate-progress-bar { display: flex; height: 4px; background: #2a2d3a; border-radius: 2px; margin-top: 4px; overflow: hidden; }
.gate-progress-fill { height: 100%; }
.gate-progress-fill.suspected { opacity: 0.6; }
.gate-matched-item.suspected { background: #3d3010; color: #f39c12; border: 1px dashed #f39c12; }
```

---

### Task 7: 创建 ThisWeekDeliverables.jsx

**Files:**
- Create: `pmo/gantt-react/src/components/ThisWeekDeliverables.jsx`

- [ ] **Step 1: 创建本周交付物视图**

```jsx
import { useMemo } from 'react';
import { parseDate, formatDate } from '../utils/dateUtils';

function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

export default function ThisWeekDeliverables({ deliverables, pmoDate }) {
  const date = pmoDate || new Date();
  const { monday, sunday } = useMemo(() => getWeekRange(date), [date]);

  const weekDlvs = useMemo(() => {
    return deliverables.filter(d => {
      if (!d.plannedFinish) return false;
      const f = parseDate(d.plannedFinish);
      if (!f) return false;
      return f >= monday && f <= sunday;
    }).sort((a, b) => {
      const levelOrder = { A: 0, B: 1, C: 2, D: 3 };
      return (levelOrder[a.deliverableLevel] ?? 2) - (levelOrder[b.deliverableLevel] ?? 2);
    });
  }, [deliverables, monday, sunday]);

  const highPriority = weekDlvs.filter(d => d.deliverableLevel === 'A' || d.deliverableLevel === 'B' || d.taskRisk === '高');

  if (weekDlvs.length === 0) {
    return (
      <div className="empty-view">
        <h3>本周交付物 ({formatDate(monday)} — {formatDate(sunday)})</h3>
        <p>本周暂无计划完成的交付物</p>
      </div>
    );
  }

  return (
    <div className="thisweek-view">
      <div className="week-header">
        <h3>本周交付物 ({formatDate(monday)} — {formatDate(sunday)})</h3>
        <span className="week-count">共 {weekDlvs.length} 项，重点 {highPriority.length} 项</span>
      </div>
      <div className="dlv-table-wrap">
        <table className="dlv-table">
          <thead>
            <tr>
              <th>计划完成</th>
              <th>交付物名称</th>
              <th>等级</th>
              <th>关联任务</th>
              <th>责任部门</th>
              <th>审核人</th>
              <th>风险</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {weekDlvs.map(d => (
              <tr key={d.deliverableId} className={`dlv-row dlv-level-${d.deliverableLevel} ${d.taskRisk === '高' ? 'dlv-high-risk' : ''}`}>
                <td>{formatDate(parseDate(d.plannedFinish))}</td>
                <td className="dlv-name">{d.deliverableName}</td>
                <td><span className={`dlv-level-badge level-${d.deliverableLevel}`}>{d.deliverableLevel}</span></td>
                <td className="dlv-task" title={d.taskName}>{d.taskName.length > 24 ? d.taskName.slice(0, 24) + '…' : d.taskName}</td>
                <td>{d.department || '-'}</td>
                <td className="dlv-reviewer" title={d.reviewer}>{d.reviewer ? (d.reviewer.length > 10 ? d.reviewer.slice(0, 10) + '…' : d.reviewer) : '-'}</td>
                <td><span className={`dlv-risk risk-${d.taskRisk}`}>{d.taskRisk}</span></td>
                <td><span className="dlv-status">{d.deliverableStatus}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

### Task 8: 创建 OverdueDeliverables.jsx

**Files:**
- Create: `pmo/gantt-react/src/components/OverdueDeliverables.jsx`

- [ ] **Step 1: 创建延期交付物视图**

```jsx
import { useMemo } from 'react';
import { parseDate, formatDate } from '../utils/dateUtils';

function getSuggestAction(deliverable) {
  switch (deliverable.deliverableLevel) {
    case 'A': return '提交 PMO 周会和项目决策组';
    case 'B': return '工作组说明原因并给出恢复计划';
    case 'C': return '阶段内补齐归档';
    case 'D': return '可延后处理';
    default: return '评估影响';
  }
}

export default function OverdueDeliverables({ deliverables, pmoDate }) {
  const now = pmoDate || new Date();
  const overdue = useMemo(() => {
    return deliverables.filter(d => {
      if (!d.plannedFinish) return false;
      if (d.deliverableStatus === '通过' || d.deliverableStatus === '已归档') return false;
      const f = parseDate(d.plannedFinish);
      return f && f < now;
    }).map(d => {
      const f = parseDate(d.plannedFinish);
      const daysOverdue = f ? Math.floor((now - f) / (1000 * 60 * 60 * 24)) : 0;
      return { ...d, daysOverdue, suggestAction: getSuggestAction(d) };
    }).sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [deliverables, now]);

  if (overdue.length === 0) {
    return (
      <div className="empty-view">
        <h3>延期交付物</h3>
        <p>当前无延期交付物</p>
      </div>
    );
  }

  return (
    <div className="overdue-view">
      <div className="week-header">
        <h3>延期交付物 ({overdue.length})</h3>
      </div>
      <div className="dlv-table-wrap">
        <table className="dlv-table">
          <thead>
            <tr>
              <th>延期天数</th>
              <th>计划完成</th>
              <th>交付物名称</th>
              <th>等级</th>
              <th>责任部门</th>
              <th>审核人</th>
              <th>关联任务</th>
              <th>风险</th>
              <th>建议动作</th>
            </tr>
          </thead>
          <tbody>
            {overdue.map(d => (
              <tr key={d.deliverableId} className={`dlv-row dlv-level-${d.deliverableLevel} ${d.taskRisk === '高' ? 'dlv-high-risk' : ''}`}>
                <td><span className="overdue-days">{d.daysOverdue}天</span></td>
                <td>{formatDate(parseDate(d.plannedFinish))}</td>
                <td className="dlv-name">{d.deliverableName}</td>
                <td><span className={`dlv-level-badge level-${d.deliverableLevel}`}>{d.deliverableLevel}</span></td>
                <td>{d.department || '-'}</td>
                <td className="dlv-reviewer" title={d.reviewer}>{d.reviewer ? (d.reviewer.length > 10 ? d.reviewer.slice(0, 10) + '…' : d.reviewer) : '-'}</td>
                <td className="dlv-task" title={d.taskName}>{d.taskName.length > 20 ? d.taskName.slice(0, 20) + '…' : d.taskName}</td>
                <td><span className={`dlv-risk risk-${d.taskRisk}`}>{d.taskRisk}</span></td>
                <td className="dlv-action">{d.suggestAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

### Task 9: 创建 PMOWeeklyView.jsx

**Files:**
- Create: `pmo/gantt-react/src/components/PMOWeeklyView.jsx`

- [ ] **Step 1: 创建 PMO 周会视图**

```jsx
import { useMemo } from 'react';
import { parseDate, formatDate } from '../utils/dateUtils';

function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

export default function PMOWeeklyView({ deliverables, phaseGates, tasks, pmoDate }) {
  const date = pmoDate || new Date();
  const { monday, sunday } = useMemo(() => getWeekRange(date), [date]);
  const now = date;

  // 1. 本周应完成的 A/B 类交付物
  const weekAB = useMemo(() => deliverables.filter(d => {
    if (!d.plannedFinish || (d.deliverableLevel !== 'A' && d.deliverableLevel !== 'B')) return false;
    const f = parseDate(d.plannedFinish);
    return f && f >= monday && f <= sunday;
  }), [deliverables, monday, sunday]);

  // 2. 已延期的 A/B 类交付物
  const overdueAB = useMemo(() => deliverables.filter(d => {
    if (!d.plannedFinish || (d.deliverableLevel !== 'A' && d.deliverableLevel !== 'B')) return false;
    if (d.deliverableStatus === '通过' || d.deliverableStatus === '已归档') return false;
    const f = parseDate(d.plannedFinish);
    return f && f < now;
  }).map(d => {
    const f = parseDate(d.plannedFinish);
    return { ...d, daysOverdue: f ? Math.floor((now - f) / (1000 * 60 * 60 * 24)) : 0 };
  }), [deliverables, now]);

  // 3. 阶段门缺失交付物
  const gateMissing = useMemo(() => {
    return (phaseGates || []).filter(g => g.missing && g.missing.length > 0);
  }, [phaseGates]);

  // 4. 高风险任务
  const highRiskTasks = useMemo(() => tasks.filter(t => t.risk === '高'), [tasks]);

  const renderDlvTable = (dlvs, showOverdue) => (
    <table className="dlv-table">
      <thead>
        <tr>
          <th>计划完成</th>
          <th>交付物名称</th>
          <th>等级</th>
          <th>关联任务</th>
          <th>责任部门</th>
          <th>风险</th>
          {showOverdue && <th>延期天数</th>}
        </tr>
      </thead>
      <tbody>
        {dlvs.map(d => (
          <tr key={d.deliverableId} className={`dlv-row dlv-level-${d.deliverableLevel}`}>
            <td>{formatDate(parseDate(d.plannedFinish))}</td>
            <td className="dlv-name">{d.deliverableName}</td>
            <td><span className={`dlv-level-badge level-${d.deliverableLevel}`}>{d.deliverableLevel}</span></td>
            <td className="dlv-task" title={d.taskName}>{d.taskName.length > 24 ? d.taskName.slice(0, 24) + '…' : d.taskName}</td>
            <td>{d.department || '-'}</td>
            <td><span className={`dlv-risk risk-${d.taskRisk}`}>{d.taskRisk}</span></td>
            {showOverdue && <td><span className="overdue-days">{d.daysOverdue}天</span></td>}
          </tr>
        ))}
        {dlvs.length === 0 && <tr><td colSpan={showOverdue ? 7 : 6} className="empty-row">无</td></tr>}
      </tbody>
    </table>
  );

  return (
    <div className="pmo-weekly-view">
      <div className="pmo-header">
        <h2>PMO 周会管控视图</h2>
        <span className="pmo-date">{formatDate(monday)} — {formatDate(sunday)}</span>
      </div>

      <div className="pmo-summary-cards">
        <div className="pmo-summary-card">
          <div className="pmo-summary-value">{weekAB.length}</div>
          <div className="pmo-summary-label">本周A/B交付物</div>
        </div>
        <div className="pmo-summary-card highlight">
          <div className="pmo-summary-value">{overdueAB.length}</div>
          <div className="pmo-summary-label">延期A/B交付物</div>
        </div>
        <div className="pmo-summary-card highlight">
          <div className="pmo-summary-value">{gateMissing.length}</div>
          <div className="pmo-summary-label">阶段门风险</div>
        </div>
        <div className="pmo-summary-card highlight">
          <div className="pmo-summary-value">{highRiskTasks.length}</div>
          <div className="pmo-summary-label">高风险任务</div>
        </div>
      </div>

      <div className="pmo-section">
        <h3>1. 本周应完成的 A/B 类交付物 ({weekAB.length})</h3>
        {renderDlvTable(weekAB, false)}
      </div>

      <div className="pmo-section">
        <h3>2. 已延期的 A/B 类交付物 ({overdueAB.length})</h3>
        {renderDlvTable(overdueAB, true)}
      </div>

      <div className="pmo-section">
        <h3>3. 阶段门缺失交付物 ({gateMissing.length})</h3>
        {gateMissing.length > 0 ? (
          <div className="gate-missing-list">
            {gateMissing.map(g => (
              <div key={g.gateId} className="gate-missing-card">
                <div className="gate-missing-header">
                  <span className="gate-id-tag">{g.gateId}</span>
                  <span className="gate-name-text">{g.gateName}</span>
                  <span className="gate-status-badge" style={{ background: g.statusColor + '22', color: g.statusColor }}>{g.status}</span>
                </div>
                <div className="gate-missing-tags">
                  {g.missing.map((m, i) => <span key={i} className="gate-missing-tag">{m}</span>)}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="empty-text">所有阶段门交付物均已匹配</p>}
      </div>

      <div className="pmo-section">
        <h3>4. 高风险任务 ({highRiskTasks.length})</h3>
        {highRiskTasks.length > 0 ? (
          <table className="dlv-table">
            <thead>
              <tr>
                <th>WBS</th>
                <th>任务名称</th>
                <th>责任部门</th>
                <th>计划完成</th>
                <th>交付物</th>
              </tr>
            </thead>
            <tbody>
              {highRiskTasks.map(t => (
                <tr key={t.nodeKey} className="dlv-high-risk">
                  <td className="dlv-wbs">{t.normalizedWbs || t.wbs}</td>
                  <td className="dlv-name">{t.name}</td>
                  <td>{t.department || '-'}</td>
                  <td>{formatDate(parseDate(t.finish))}</td>
                  <td className="dlv-task">{t.deliverable || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="empty-text">无高风险任务</p>}
      </div>
    </div>
  );
}
```

---

### Task 10: 修改 TaskDetail.jsx

**Files:**
- Modify: `pmo/gantt-react/src/components/TaskDetail.jsx`

- [ ] **Step 1: 在任务详情中增加交付物关联字段**

在现有 TaskDetail.jsx 的 fields 数组中，在 `{ label: '交付物', value: task.deliverable || '-' }` 之后，`{ label: '备注', ...}` 之前，增加以下字段：

```jsx
// 新增：关联交付物信息
{ label: '关联交付物编号', value: task._deliverableId || '-' },
{ label: '交付物名称', value: task._deliverableName || task.deliverable || '-' },
{ label: '交付物类型', value: task._deliverableType || '-' },
{ label: '交付物等级', value: task._deliverableLevel ? `${task._deliverableLevel}类` : '-', badge: task._deliverableLevel === 'A' ? 'milestone' : null },
{ label: '交付物状态', value: task._deliverableStatus || '-' },
{ label: '是否阶段门交付物', value: task._isPhaseGate ? '是' : '否' },
```

完整修改后的 TaskDetail.jsx:

```jsx
import { parseDate, formatDate } from '../utils/dateUtils';

export default function TaskDetail({ task, onClose }) {
  if (!task) return null;

  const s = parseDate(task.start);
  const f = parseDate(task.finish);

  const fields = [
    { label: '原始ID', value: task.originalId != null ? String(task.originalId) : (task.id != null ? String(task.id) : '-') },
    { label: '原始WBS', value: task.originalWbs || task.wbs || '-' },
    { label: '规范WBS', value: task.normalizedWbs || task.wbs || '-' },
    { label: '展示序号', value: task.displayIndex != null ? String(task.displayIndex) : '-' },
    { label: 'WBS层级', value: task.wbsLevel != null ? String(task.wbsLevel) : '-' },
    { label: '父级WBS', value: task.parentWbs || '-' },
    { label: '任务名称', value: task.name },
    { label: '是否摘要', value: task.isSummary ? '是' : '否' },
    { label: '是否里程碑', value: task.isMilestone ? '是' : '否' },
    { label: '任务类型', value: task.type || '-' },
    { label: '开始时间', value: formatDate(s) },
    { label: '完成时间', value: formatDate(f) },
    { label: '工期', value: task.duration || '-' },
    { label: '前置任务', value: task.predecessors || '-' },
    { label: '资源名称', value: task.resources || '-' },
    { label: '责任部门', value: task.department || '-' },
    { label: '供应商', value: task.vendor || '-' },
    { label: '审核人/审批组', value: task.reviewer || '-' },
    { label: '风险等级', value: task.risk || '中', badge: 'risk' },
    { label: '交付物', value: task.deliverable || '-' },
    // 新增：关联交付物信息（如果该任务有匹配的交付物）
    { label: '关联交付物编号', value: task._deliverableId || '-' },
    { label: '交付物类型', value: task._deliverableType || '-' },
    { label: '交付物等级', value: task._deliverableLevel ? `${task._deliverableLevel}类` : '-' },
    { label: '交付物状态', value: task._deliverableStatus || '-' },
    { label: '是否阶段门', value: task._isPhaseGate ? '是' : '否' },
    { label: '备注', value: task.notes ? (task.notes.length > 60 ? task.notes.slice(0, 60) + '…' : task.notes) : '-' }
  ];

  return (
    <div className="detail-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="detail-header">
        <h3>任务详情</h3>
        <button className="detail-close" onClick={onClose}>&times;</button>
      </div>
      <div className="detail-body">
        {fields.map((f, i) => (
          <div key={i} className="detail-field">
            <label>{f.label}</label>
            {f.badge === 'risk'
              ? <span className={`value badge risk-${f.value}`}>{f.value}</span>
              : f.badge === 'milestone'
                ? <span className="value badge tag-milestone">{f.value}</span>
                : <span className="value">{f.value}</span>
            }
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### Task 11: 修改 FilterBar.jsx

**Files:**
- Modify: `pmo/gantt-react/src/components/FilterBar.jsx`

- [ ] **Step 1: 增加新视图按钮和交付物筛选器**

在现有的 views 数组末尾增加5个新视图：

```jsx
{ key: 'deliverables', label: '交付物台账', special: true },
{ key: 'phasegates', label: '阶段门', special: true },
{ key: 'thisweek', label: '本周交付物', special: true },
{ key: 'overdue', label: '延期交付物', special: true },
{ key: 'pmo', label: 'PMO周会', special: true },
```

完整 FilterBar.jsx:

```jsx
export default function FilterBar({ tasks, filters, view, onFilterChange, onViewChange, hasDeliverables }) {
  const mainlines = [...new Set(tasks.map(t => String(t.wbs).split('.')[0]))].sort((a, b) => +a - +b);
  const departments = [...new Set(tasks.map(t => t.department).filter(Boolean))].sort();
  const vendors = [...new Set(tasks.map(t => t.vendor).filter(Boolean))].sort();
  const types = [...new Set(tasks.map(t => t.type).filter(Boolean))].sort();

  const ganttViews = [
    { key: 'all', label: '全部任务' },
    { key: 'overview', label: '总览视图' },
    { key: '2026', label: '2026年' },
    { key: '2027', label: '2027年' },
    { key: '2028', label: '2028年' },
    { key: 'milestones', label: '里程碑' },
    { key: 'highrisk', label: '高风险' },
    { key: 'toggleMilestonePanel', label: '关键里程碑', special: true }
  ];

  const pmoViews = [
    { key: 'deliverables', label: '交付物台账', special: true },
    { key: 'phasegates', label: '阶段门', special: true },
    { key: 'thisweek', label: '本周交付物', special: true },
    { key: 'overdue', label: '延期交付物', special: true },
    { key: 'pmo', label: 'PMO周会', special: true },
  ];

  const update = (key, value) => onFilterChange({ ...filters, [key]: value });

  const isPMOView = ['deliverables', 'phasegates', 'thisweek', 'overdue', 'pmo'].includes(view);

  return (
    <div className="filter-bar">
      {!isPMOView && (
        <>
          <select value={filters.year} onChange={e => { update('year', e.target.value); }}>
            <option value="all">全部年份</option>
            <option value="2026">2026年</option>
            <option value="2027">2027年</option>
            <option value="2028">2028年</option>
          </select>

          <select value={filters.mainline} onChange={e => update('mainline', e.target.value)}>
            <option value="all">全部主线</option>
            {mainlines.map(m => {
              const topTask = tasks.find(t => String(t.wbs).split('.')[0] === m && String(t.wbs).split('.').length === 1);
              return <option key={m} value={m}>{m}{topTask ? `-${topTask.name}` : ''}</option>;
            })}
          </select>

          <select value={filters.department} onChange={e => update('department', e.target.value)}>
            <option value="all">全部部门</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          <select value={filters.vendor} onChange={e => update('vendor', e.target.value)}>
            <option value="all">全部供应商</option>
            {vendors.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <select value={filters.risk} onChange={e => update('risk', e.target.value)}>
            <option value="all">全部风险</option>
            <option value="高">高风险</option>
            <option value="中">中风险</option>
            <option value="低">低风险</option>
          </select>

          <select value={filters.type} onChange={e => update('type', e.target.value)}>
            <option value="all">全部类型</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <select value={filters.milestone} onChange={e => update('milestone', e.target.value)}>
            <option value="all">全部任务</option>
            <option value="yes">仅里程碑</option>
          </select>

          <input type="text" placeholder="搜索任务名称/WBS..." value={filters.search}
            onChange={e => update('search', e.target.value)} />
        </>
      )}

      <div className="view-btns">
        {ganttViews.map(v => (
          <button key={v.key}
            className={`${view === v.key ? 'active' : ''}${v.special ? ' ms-btn' : ''}`}
            onClick={() => onViewChange(v.key)}>{v.label}</button>
        ))}
        <span className="view-sep" />
        {pmoViews.map(v => (
          <button key={v.key}
            className={`${view === v.key ? 'active' : ''}${v.special ? ' pmo-btn' : ''}`}
            onClick={() => onViewChange(v.key)}>{v.label}</button>
        ))}
      </div>
    </div>
  );
}
```

---

### Task 12: 修改 App.jsx 集成所有新组件（含 pmoDate + 状态加载 + WBS横幅）

**Files:**
- Modify: `pmo/gantt-react/src/App.jsx`

- [ ] **Step 1: 重写 App.jsx 集成交付物/阶段门/新视图/pmoDate/状态覆盖**

```jsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardCards from './components/DashboardCards';
import FilterBar from './components/FilterBar';
import PMODatePicker from './components/PMODatePicker';
import WBSQualityBanner from './components/WBSQualityBanner';
import TaskTree from './components/TaskTree';
import GanttChart from './components/GanttChart';
import TaskDetail from './components/TaskDetail';
import MilestoneList from './components/MilestoneList';
import DeliverableLedger from './components/DeliverableLedger';
import PhaseGateView from './components/PhaseGateView';
import ThisWeekDeliverables from './components/ThisWeekDeliverables';
import OverdueDeliverables from './components/OverdueDeliverables';
import PMOWeeklyView from './components/PMOWeeklyView';
import DeliverableDetail from './components/DeliverableDetail';
import { buildTaskTree, applyFilters, normalizeTasks, analyzeTasks, computeProjectRange, formatDate, parseDate } from './utils/dateUtils';
import { normalizeDeliverables, loadDeliverableStatusOverrides } from './utils/deliverableUtils';
import { buildPhaseGates } from './utils/phaseGateUtils';
import './App.css';

const DEFAULT_FILTERS = { year: 'all', mainline: 'all', department: 'all', vendor: 'all', risk: 'all', type: 'all', milestone: 'all', search: '' };
const PMO_VIEWS = ['deliverables', 'phasegates', 'thisweek', 'overdue', 'pmo'];

export default function App() {
  const [rawTasks, setRawTasks] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState('all');
  const [selectedNodeKey, setSelectedNodeKey] = useState(null);
  const [monthWidth, setMonthWidth] = useState(82);
  const [showMilestonePanel, setShowMilestonePanel] = useState(false);
  const [selectedDeliverable, setSelectedDeliverable] = useState(null);
  const [pmoDate, setPmoDate] = useState(new Date());       // PMO观察日期
  const [projectStart, setProjectStart] = useState(null);    // 项目开始日期

  useEffect(() => {
    fetch('tasks.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(async data => {
        setRawTasks(data);
        const normalized = normalizeTasks(data);
        computeProjectRange(normalized);
        analyzeTasks(data);
        setAllTasks(normalized);
        // 构建交付物
        let dlvs = normalizeDeliverables(normalized);
        // 加载状态覆盖
        dlvs = await loadDeliverableStatusOverrides(dlvs);
        setDeliverables(dlvs);
        // 设置项目开始日期
        const starts = normalized.map(t => parseDate(t.start)).filter(Boolean);
        if (starts.length) {
          setProjectStart(new Date(Math.min(...starts.map(d => d.getTime()))));
        }
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const treeData = useMemo(() => buildTaskTree(allTasks), [allTasks]);
  const phaseGates = useMemo(() => buildPhaseGates(deliverables, pmoDate), [deliverables, pmoDate]);

  const filteredTasks = useMemo(() => {
    if (!allTasks.length) return [];
    return applyFilters(allTasks, filters, view);
  }, [allTasks, filters, view]);

  // 将交付物信息关联回任务（用于任务详情显示）
  const tasksWithDeliverableInfo = useMemo(() => {
    const dlvByTaskId = {};
    deliverables.forEach(d => {
      if (d.taskId != null) dlvByTaskId[d.taskId] = d;
    });
    // 也按 nodeKey 关联
    const dlvByNodeKey = {};
    deliverables.forEach(d => {
      if (d.nodeKey) dlvByNodeKey[d.nodeKey] = d;
    });
    return allTasks.map(t => {
      const dlv = dlvByTaskId[t.originalId] || dlvByTaskId[t.id] || dlvByNodeKey[t.nodeKey];
      if (dlv) {
        return {
          ...t,
          _deliverableId: dlv.deliverableId,
          _deliverableName: dlv.deliverableName,
          _deliverableType: dlv.deliverableType,
          _deliverableLevel: dlv.deliverableLevel,
          _deliverableStatus: dlv.deliverableStatus,
          _isPhaseGate: dlv.isPhaseGate,
        };
      }
      return t;
    });
  }, [allTasks, deliverables]);

  const handleFilterChange = useCallback((newFilters) => { setFilters(newFilters); }, []);
  const handleViewChange = useCallback((newView) => {
    if (newView === 'toggleMilestonePanel') { setShowMilestonePanel(prev => !prev); return; }
    setView(newView);
    if (['2026', '2027', '2028'].includes(newView)) { setFilters(prev => ({ ...prev, year: newView })); }
    else { setFilters(prev => ({ ...prev, year: 'all' })); }
  }, []);

  const handleSelect = useCallback((nodeKey) => { setSelectedNodeKey(nodeKey); }, []);
  const handleToggle = useCallback((nodeKey) => {
    const node = treeData.map[nodeKey];
    if (node) node._expanded = !node._expanded;
    setSelectedNodeKey(prev => prev);
  }, [treeData]);

  const handleZoom = useCallback((w) => { setMonthWidth(Math.max(24, Math.min(280, w))); }, []);

  const selectedTask = useMemo(() => {
    if (!selectedNodeKey) return null;
    // 从增强后的任务列表中查找
    const task = tasksWithDeliverableInfo.find(t => t.nodeKey === selectedNodeKey);
    return task || treeData.map[selectedNodeKey] || null;
  }, [selectedNodeKey, treeData, tasksWithDeliverableInfo]);

  const handleSelectDeliverable = useCallback((dlv) => { setSelectedDeliverable(dlv); }, []);

  const subtitle = useMemo(() => {
    if (!allTasks.length) return '';
    const realTasks = allTasks.filter(t => !t.notes || !t.notes.includes('[自动生成的虚拟父节点]'));
    const starts = realTasks.map(t => parseDate(t.start)).filter(Boolean);
    const ends = realTasks.map(t => parseDate(t.finish)).filter(Boolean);
    if (!starts.length) return '';
    const ds = new Date(Math.min(...starts.map(d => d.getTime())));
    const de = new Date(Math.max(...ends.map(d => d.getTime())));
    return `${formatDate(ds)} — ${formatDate(de)} ｜ 数据来源：信息化项目_WBS修复版_Project_H5可用.xlsx ｜ 交付物 ${deliverables.length} 项`;
  }, [allTasks, deliverables]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setSelectedNodeKey(null); setSelectedDeliverable(null); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (loading) return <div className="loading">数据加载中</div>;
  if (error) return <div className="loading">数据加载失败：{error}</div>;

  const isPMOView = PMO_VIEWS.includes(view);

  const renderMainContent = () => {
    switch (view) {
      case 'deliverables':
        return <DeliverableLedger deliverables={deliverables} onSelectDeliverable={handleSelectDeliverable} />;
      case 'phasegates':
        return <PhaseGateView phaseGates={phaseGates} />;
      case 'thisweek':
        return <ThisWeekDeliverables deliverables={deliverables} pmoDate={pmoDate} />;
      case 'overdue':
        return <OverdueDeliverables deliverables={deliverables} pmoDate={pmoDate} />;
      case 'pmo':
        return <PMOWeeklyView deliverables={deliverables} phaseGates={phaseGates} tasks={allTasks} pmoDate={pmoDate} />;
      default:
        return (
          <div className="main-container">
            <TaskTree tasks={filteredTasks} treeMap={treeData.map}
              selectedNodeKey={selectedNodeKey} onSelect={handleSelect} onToggle={handleToggle} />

            <GanttChart tasks={filteredTasks} treeMap={treeData.map}
              monthWidth={monthWidth} selectedNodeKey={selectedNodeKey}
              onSelect={handleSelect} onZoomChange={handleZoom} />
          </div>
        );
    }
  };

  return (
    <>
      <div className="header">
        <h1>数字化底座 PMO 项目管控看板</h1>
        <div className="subtitle">{subtitle}</div>
      </div>

      <WBSQualityBanner rawTasks={rawTasks} />

      <DashboardCards tasks={allTasks} deliverables={deliverables} phaseGates={phaseGates} pmoDate={pmoDate} />

      <PMODatePicker pmoDate={pmoDate} onDateChange={setPmoDate} projectStart={projectStart} />

      <FilterBar tasks={allTasks} filters={filters} view={view}
        onFilterChange={handleFilterChange} onViewChange={handleViewChange} />

      {renderMainContent()}

      {!isPMOView && (
        <MilestoneList tasks={filteredTasks} show={showMilestonePanel}
          onClose={() => setShowMilestonePanel(false)} />
      )}

      {selectedTask && !isPMOView && <TaskDetail task={selectedTask} onClose={() => setSelectedNodeKey(null)} />}

      {selectedDeliverable && <DeliverableDetail deliverable={selectedDeliverable} phaseGates={phaseGates} onClose={() => setSelectedDeliverable(null)} />}
    </>
  );
}
```

---

### Task 13: 修改 App.css 新增样式

**Files:**
- Modify: `pmo/gantt-react/src/App.css`

- [ ] **Step 1: 在 App.css 末尾追加新视图样式**

```css
/* ===== PMO Warm Paper Tokens ===== */
:root {
  --pmo-paper: #F6F0E4;
  --pmo-paper-2: #EFE4D1;
  --pmo-ink: #2F2A24;
  --pmo-muted: #7A7164;
  --pmo-border: #D8C9AF;
  --pmo-red: #A64B3C;
  --pmo-sage: #6F8A6A;
  --pmo-blue: #6E879F;
  --pmo-gold: #B88919;
}

/* ===== PMO View Buttons ===== */
.view-sep { width: 1px; background: var(--pmo-border); margin: 0 4px; }
.pmo-btn { color: var(--pmo-red); border-color: var(--pmo-border) !important; background: var(--pmo-paper) !important; }
.pmo-btn:hover { border-color: var(--pmo-red) !important; color: var(--pmo-red) !important; }
.pmo-btn.active { background: #F1D9D4 !important; color: var(--pmo-red); border-color: var(--pmo-red) !important; }

/* ===== Dashboard Card Variants ===== */
.stat-card.stat-a .stat-value { color: var(--pmo-gold); }
.stat-card.stat-b .stat-value { color: var(--pmo-blue); }

/* ===== PMO Date Picker ===== */
.pmo-date-picker {
  display: flex; align-items: center; gap: 8px; padding: 10px 24px;
  background: var(--pmo-paper); border-bottom: 1px solid var(--pmo-border);
  color: var(--pmo-ink); flex-wrap: wrap;
}
.pmo-date-label { color: var(--pmo-muted); font-size: 13px; }
.pmo-date-value { color: var(--pmo-ink); font-size: 13px; font-weight: 700; }
.pmo-date-btn {
  background: #FFF8EA; color: var(--pmo-red); border: 1px solid var(--pmo-border);
  border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer;
}
.pmo-date-btn:hover { border-color: var(--pmo-red); }
.pmo-date-input {
  background: #FFF8EA; color: var(--pmo-ink); border: 1px solid var(--pmo-border);
  border-radius: 6px; padding: 5px 8px; font-size: 12px; outline: none;
}
.pmo-date-input:focus { border-color: var(--pmo-blue); }

/* ===== WBS Quality Banner ===== */
.wbs-quality-banner {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  padding: 8px 24px; font-size: 13px; border-bottom: 1px solid var(--pmo-border);
  background: #FFF8EA; color: var(--pmo-ink);
}
.wbs-quality-banner.clean { border-left: 4px solid var(--pmo-sage); }
.wbs-quality-banner.warning { border-left: 4px solid var(--pmo-gold); }
.wbs-quality-detail { color: var(--pmo-muted); font-size: 12px; }

/* ===== Deliverable Filter Bar ===== */
.dlv-filter-bar {
  display: flex; gap: 8px; padding: 10px 24px; background: #161822;
  border-bottom: 1px solid #2a2d3a; flex-wrap: wrap; align-items: center;
}
.dlv-filter-bar select {
  background: #1c1f2e; color: #c8ccd4; border: 1px solid #2a2d3a;
  border-radius: 6px; padding: 6px 10px; font-size: 13px; outline: none;
}
.dlv-filter-bar select:focus { border-color: #4A90D9; }
.dlv-count { margin-left: auto; font-size: 13px; color: #6b7194; }

/* ===== Deliverable Table ===== */
.deliverable-view, .thisweek-view, .overdue-view { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.dlv-table-wrap { flex: 1; overflow: auto; }
.dlv-table-wrap::-webkit-scrollbar { width: 8px; height: 8px; }
.dlv-table-wrap::-webkit-scrollbar-thumb { background: #2a2d3a; border-radius: 4px; }
.dlv-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dlv-table thead { position: sticky; top: 0; z-index: 2; }
.dlv-table th {
  background: #161822; color: #6b7194; font-weight: 600; font-size: 11px;
  padding: 8px 10px; text-align: left; border-bottom: 1px solid #2a2d3a;
  white-space: nowrap;
}
.dlv-table td {
  padding: 7px 10px; border-bottom: 1px solid #1a1d2a; color: #c8ccd4;
  white-space: nowrap;
}
.dlv-row { cursor: pointer; }
.dlv-row:hover { background: #1c1f30; }
.dlv-row.dlv-level-A { background: #2a2010; }
.dlv-row.dlv-level-A:hover { background: #3a2a14; }
.dlv-row.dlv-high-risk { border-left: 3px solid #e74c3c; }
.dlv-id { font-family: monospace; color: #6b7194; font-size: 11px; }
.dlv-name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.dlv-wbs { font-family: monospace; color: #6b7194; font-size: 11px; }
.dlv-task { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.dlv-reviewer { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.dlv-level-badge {
  display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px;
  font-weight: 700; border: 1px solid; text-align: center; min-width: 20px;
}
.dlv-risk { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 3px; }
.dlv-risk.risk-高 { color: #e74c3c; background: #3d1f1f; }
.dlv-risk.risk-中 { color: #f4b400; background: #3d3010; }
.dlv-risk.risk-低 { color: #4CAF50; background: #1a3026; }
.dlv-status { font-size: 11px; color: #6b7194; }
.dlv-action { font-size: 11px; color: #f39c12; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.overdue-days { color: #e74c3c; font-weight: 700; }
.empty-row { text-align: center; color: #6b7194; padding: 20px !important; }

/* ===== Week Header ===== */
.week-header { display: flex; align-items: center; gap: 12px; padding: 14px 24px; background: #141720; border-bottom: 1px solid #2a2d3a; }
.week-header h3 { font-size: 15px; color: #e8eaed; margin: 0; }
.week-count { font-size: 12px; color: #6b7194; }

/* ===== Empty View ===== */
.empty-view { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #6b7194; gap: 12px; }
.empty-view h3 { font-size: 16px; color: #8b90a0; }
.empty-view p { font-size: 14px; }

/* ===== Phase Gate View ===== */
.phasegate-view { flex: 1; overflow: auto; padding: 16px 24px; }
.phasegate-view::-webkit-scrollbar { width: 8px; }
.phasegate-view::-webkit-scrollbar-thumb { background: #2a2d3a; border-radius: 4px; }
.phasegate-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.phasegate-title { font-size: 16px; font-weight: 700; color: #e8eaed; }
.phasegate-summary { font-size: 13px; color: #8b90a0; }
.risk-text { color: #e74c3c; font-weight: 600; }
.phasegate-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 14px; }
.gate-card {
  background: #1c1f2e; border: 1px solid #2a2d3a; border-left: 4px solid #6b7194;
  border-radius: 8px; padding: 16px;
}
.gate-card.gate-status-风险 { border-left-color: #e74c3c; background: #1f1a1a; }
.gate-card.gate-status-通过 { border-left-color: #4CAF50; }
.gate-card.gate-status-待确认 { border-left-color: #f39c12; }
.gate-card.gate-status-进行中 { border-left-color: #4A90D9; }
.gate-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.gate-id { font-family: monospace; font-size: 12px; color: #6b7194; }
.gate-status-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
.gate-name { font-size: 15px; color: #e8eaed; margin: 8px 0; }
.gate-blocking { font-size: 12px; color: #8b90a0; margin-bottom: 10px; }
.gate-label { color: #6b7194; font-size: 11px; font-weight: 600; }
.gate-progress { margin-bottom: 8px; }
.gate-progress span { font-size: 12px; color: #8b90a0; }
.gate-progress-bar { height: 4px; background: #2a2d3a; border-radius: 2px; margin-top: 4px; }
.gate-progress-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
.gate-missing, .gate-matched { margin-bottom: 6px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.gate-missing-tag { font-size: 11px; background: #3d1f1f; color: #e74c3c; padding: 2px 8px; border-radius: 3px; }
.gate-matched-item { font-size: 11px; background: #1a3026; color: #4CAF50; padding: 2px 8px; border-radius: 3px; cursor: help; }

/* ===== PMO Weekly View ===== */
.pmo-weekly-view { flex: 1; overflow: auto; padding: 16px 24px; }
.pmo-weekly-view::-webkit-scrollbar { width: 8px; }
.pmo-weekly-view::-webkit-scrollbar-thumb { background: #2a2d3a; border-radius: 4px; }
.pmo-header { margin-bottom: 16px; }
.pmo-header h2 { font-size: 20px; color: #e8eaed; margin: 0; }
.pmo-date { font-size: 13px; color: #6b7194; }
.pmo-summary-cards { display: flex; gap: 12px; margin-bottom: 20px; }
.pmo-summary-card {
  background: #1c1f2e; border: 1px solid #2a2d3a; border-radius: 8px;
  padding: 14px 20px; flex: 1; text-align: center;
}
.pmo-summary-card.highlight { border-color: #e74c3c; }
.pmo-summary-value { font-size: 32px; font-weight: 700; color: #e8eaed; }
.pmo-summary-label { font-size: 12px; color: #6b7194; margin-top: 4px; }
.pmo-section { margin-bottom: 20px; }
.pmo-section h3 { font-size: 15px; color: #e8eaed; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #2a2d3a; }
.empty-text { color: #6b7194; font-size: 13px; padding: 12px 0; }
.gate-missing-list { display: flex; flex-direction: column; gap: 8px; }
.gate-missing-card { background: #1c1f2e; border: 1px solid #2a2d3a; border-left: 3px solid #e74c3c; border-radius: 6px; padding: 10px 14px; }
.gate-missing-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.gate-id-tag { font-family: monospace; font-size: 11px; color: #6b7194; }
.gate-name-text { font-size: 14px; color: #e8eaed; font-weight: 600; }
.gate-missing-tags { display: flex; flex-wrap: wrap; gap: 4px; }
```

---

### Task 14: 构建验证

**Files:**
- 无新建/修改

- [ ] **Step 1: npm run build（生产构建）**

```bash
cd pmo/gantt-react && npm run build
```

必须成功（exit code 0），输出 `dist/` 目录包含 `index.html` + JS/CSS 资源。

- [ ] **Step 2: npm run dev（开发服务器验证）**

```bash
cd pmo/gantt-react && npm run dev
```

打开浏览器，按以下清单逐项检查：

**基础检查：**
1. 页面是否白屏？→ 必须正常加载
2. 控制台是否有 JS 错误？→ 必须无 error
3. 控制台是否输出诊断报告？→ 应输出 WBS 诊断 + 交付物抽取日志
4. 中文是否乱码？→ 必须正常

**甘特图原功能：**
5. 全部任务视图：任务树 + 甘特图正常显示
6. 筛选器（年份/主线/部门/供应商/风险/类型）可用
7. 点击任务 → 详情面板打开，Esc关闭
8. 缩放、滚动同步正常

**新视图功能：**
9. WBS质量横幅显示（0重复WBS / 0孤儿 / 353任务）
10. PMO观察日期选择器可见，切换日期后视图更新
11. 交付物台账：表格有数据（~308项），5个筛选下拉可用，点击行打开详情
12. 阶段门：8个卡片，区分已满足(绿色)/疑似(橙色)/缺失(红色)
13. 本周交付物：基于PMO日期显示
14. 延期交付物：延期天数 + 建议动作
15. PMO周会：四块视图 + 顶部统计卡片
16. Dashboard：11张统计卡片（含交付物统计）

### Task 15: README.md

**Files:**
- Modify: `pmo/gantt-react/README.md`

- [ ] **Step 1: 更新 README**

```markdown
# 数字化底座项目 PMO 管控看板

基于 React + Vite 的交付物驱动项目管控看板，从甘特图升级为 PMO 周会可用工具。

## 快速开始

\`\`\`bash
npm install
npm run dev      # 开发模式 → http://localhost:5173
npm run build    # 生产构建 → dist/
npm run preview  # 预览构建结果
\`\`\`

## 数据来源

`public/tasks.json` — 由 `信息化项目_WBS修复版_Project_H5可用.xlsx` 通过 Python 脚本转换生成。

### 替换新任务数据

1. 准备 Excel 文件（需包含列：ID, WBS, 任务名称, 任务类型, 工期, 开始时间, 完成时间, ...）
2. 修改 `pmo/convert_xlsx_to_json.py` 顶部的 `SRC` 指向新 Excel
3. 运行转换：`cd pmo && python convert_xlsx_to_json.py`
4. 确认脚本同时写入 `pmo/tasks.json` 和 `pmo/gantt-react/public/tasks.json`
5. 刷新浏览器

## 交付物状态维护

创建 `public/deliverable-status.json` 来覆盖交付物状态：

\`\`\`json
[
  {
    "deliverableId": "DLV-001",
    "status": "待评审",
    "actualSubmitDate": "2026-06-20",
    "actualPassDate": "",
    "ownerNote": "已提交初稿，等待 PMO 评审"
  }
]
\`\`\`

如果不创建此文件，所有交付物状态默认为"未提交"。

## 功能视图

| 视图 | 说明 |
|------|------|
| 全部任务 | 传统甘特图 + 任务树 |
| 交付物台账 | 所有交付物表格，支持等级/类型/部门/月份/状态筛选 |
| 阶段门 | 8个阶段门卡片，区分已满足/疑似匹配/缺失 |
| 本周交付物 | 基于PMO观察日期的本周到期交付物 |
| 延期交付物 | 已延期 + 分级建议动作 |
| PMO周会 | 四块视图：本周AB/延期AB/阶段门缺失/高风险任务 |

## WBS 规范化规则

- WBS 使用数字段排序（1.2 < 1.10 < 1.11）
- 重复WBS通过 `${wbs}__${id}` 生成唯一 nodeKey
- 缺失父节点自动生成虚拟摘要
- 里程碑在同级排序靠后

## 交付物分类规则

- **类型**：方案规范类/需求规格类/系统功能类/测试联调类/评审验收类/报告清单类/培训手册类/过程记录类/其他
- **等级**：A(阶段门) / B(关键建设) / C(支撑过程) / D(参考材料)

## 阶段门规则

8个阶段门，使用3层匹配：
1. 精确关键词包含（含别名表）
2. 同WBS主线内匹配
3. 人工别名表

区分：已满足 / 疑似匹配 / 缺失

## PMO 周会视图用途

取代传统甘特图，让 PMO 每周快速回答：
1. 本周哪些关键交付物必须完成？
2. 哪些交付物已经延期？
3. 哪些阶段门缺交付物？
4. 哪些任务会阻断后续工作？
5. 哪些事项需要提交项目决策组？
```

---

## 验收报告格式（实现完成后输出）

```text
设计覆盖率：XX%
代码完成率：XX%
运行验收通过率：XX%
待验证项：
  - [ ] ...
已发现问题：
  - ...
```

- [ ] **Step 2: 输出最终验收报告**

---

## 实现完成检查清单

- [ ] `npm install` 无报错
- [ ] `npm run build` 成功，生成 dist/
- [ ] `npm run dev` 正常启动
- [ ] 页面不白屏
- [ ] 控制台无 JS error
- [ ] WBS质量横幅显示
- [ ] PMO观察日期可切换
- [ ] 13 个视图按钮全部可见且可切换（8个甘特图视图 + 5个PMO视图）
- [ ] 交付物台账：表格显示，5个筛选下拉可用
- [ ] 阶段门：8个卡片，区分已满足/疑似/缺失
- [ ] 本周交付物：基于PMO日期正确
- [ ] 延期交付物：延期天数 + 分级建议动作
- [ ] PMO周会：四块视图 + 顶部统计
- [ ] 交付物详情：点击打开，Esc关闭，显示关联阶段门
- [ ] 任务详情：包含交付物关联字段
- [ ] 甘特图原有功能不受影响
- [ ] PMO新增区域延续米色暖宣纸系，甘特图原区域可读性不受影响
