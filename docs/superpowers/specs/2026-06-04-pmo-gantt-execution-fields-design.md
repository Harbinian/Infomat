# PMO 甘特图服务 — 新执行层字段集成设计

## 概述

PMO 甘特图服务的真源已切换到 `pmo/信息化项目_Project_H5最终执行版_导入表.xlsx`。新真源含 45 列主表（比旧的 15 列多 30 列）+ 8 个辅助 sheet，新增大量执行层管控信息（视图分类、阶段门、关键路径控制、H5 重点展示、版本控制对象、变更等级、联调启动条件、合同/付款控制口径、H5 诊断规则等）。

本次设计目标：把新字段打通到数据流与 React 看板，新增 4 个 P0 筛选器、任务条 Flag 视觉标记、任务详情执行层分组、PMO 页"参考规则"Tab，让 PMO 周会能用看板跟踪执行层信息。

**不做**：H5 诊断规则的运行时自动评估（仅做参考列表展示）、WBS 重编码对照表、build-standalone.js 独立 HTML 模式。

## 审查补充：驾驶舱交互与交付物闭环

本轮审查后，设计范围从“执行字段展示”补强为“PMO 可操作驾驶舱”。补充项分为两层：

- **Codex 后端/数据层**：补齐交付物状态流转、状态覆盖文件校验、台账筛选排序纯逻辑、统计卡跳转意图契约，不改视觉布局。
- **Minimax-M3 前端/体验层**：负责统计卡单击跳转、表格可排序表头、交付物提交/审核操作入口、视觉指引强化和交互动效。

### 交付物状态流转契约

交付物状态统一使用：`未提交` → `编制中` → `已提交` → `待评审` → `通过` → `已归档`；`已提交` / `待评审` 可退回为 `退回整改`，`退回整改` 可重新提交。

状态覆盖文件 `public/deliverable-status.json` 支持：

```json
{
  "deliverableId": "DLV-001",
  "status": "待评审",
  "actualSubmitDate": "2026-06-20",
  "actualPassDate": "",
  "reviewer": "PMO",
  "reviewOpinion": "已提交初稿，等待 PMO 评审",
  "ownerNote": "已提交初稿，等待 PMO 评审",
  "workflowHistory": [
    { "action": "submit", "from": "未提交", "to": "已提交", "actor": "项目管理部", "at": "2026-06-20T09:00:00.000Z", "note": "提交初稿" }
  ]
}
```

前端提交/审核动作调用纯逻辑函数生成下一状态，避免在组件里手写状态判断。

### 台账筛选排序契约

交付物台账支持以下筛选维度：等级、类型、责任部门、计划月份、状态、审核人、风险、关键词。排序维度至少包括：计划完成、等级、状态、风险、责任部门、审核人、交付物名称、规范 WBS。

筛选排序逻辑由 `filterAndSortDeliverables(deliverables, filters, sort)` 提供，前端只负责把控件状态传入该函数，并渲染排序方向。

### 统计卡跳转契约

统计卡不再只是静态数字。`createDashboardCardIntents(...)` 输出每张卡的 `target`：

- 延期交付物 → PMO 看板 / 延期交付物视图
- 阶段门风险 → PMO 看板 / 阶段门视图 / 风险阶段门
- A/B 类交付物 → PMO 看板 / 交付物台账 / 对应等级筛选
- 高风险任务 → 甘特图 / 高风险视图或风险筛选

Minimax-M3 前端实现点击行为时，应消费 `target`，不要在组件内重复推导跳转规则。

### 视觉指引强化要求

- 可点击统计卡需要有 hover、pressed、focus-visible 状态，并用图标或箭头提示可钻取。
- 可排序表头需要显示排序方向，当前排序列应有明显但克制的强调。
- 交付物状态应使用稳定颜色：未提交灰、已提交暗金、待评审暗金、通过鼠尾草、退回整改赭红、已归档雾蓝。
- 待审核、退回整改、延期交付物应在台账和详情中有一致的视觉标识。

## 真源与数据流

### 真源

`pmo/信息化项目_Project_H5最终执行版_导入表.xlsx` — 21 个 sheet：

- `项目仪表盘` — 顶层说明
- `Project导入任务表_最终执行版` — **主表**，45 列，434 行
- `Project任务_导入` — Project 导入用副本
- `Project资源_导入` — 资源池
- `Project工作分配_导入` — 工作分配
- `映射_任务` / `映射_资源` / `映射_工作分配` — Project 字段映射
- `WBS重编码对照` — **不采用**（用户确认）
- `字段字典` — **不采用**（用户确认 8 个辅助表，不含此）
- `H5视图分类` / `阶段门控制体系` / `H5诊断规则` / `交付物分级审查` / `PMO周会机制` / `合同与供应商履约控制` / `Project依赖规则` / `一级WBS管理口径` — **8 个辅助 sheet**

### 数据流

```
pmo/信息化项目_Project_H5最终执行版_导入表.xlsx
   │
   ↓ python convert_xlsx.py
   │
   ├─ pmo/tasks.json                        (主表 → JSON 扁平化)
   ├─ pmo/gantt-react/public/tasks.json     (同源拷贝)
   └─ pmo/gantt-react/public/reference.json ← 新增：8 辅助 sheet
```

`reference.json` 结构：

```json
{
  "h5ViewCategories": [ ["Text10值","中文含义","H5视图","诊断/PMO用途"], ... ],
  "phaseGateControl": [ ["阶段门","放行范围","不满足时禁止推进","绑定动作"], ... ],
  "h5DiagnosticRules": [ ["诊断名称","规则","提示信息/处理方式"], ... ],
  "deliverableLevels": [ ["等级","类型","示例","审查方式","是否影响阶段门"], ... ],
  "pmoWeeklyMechanism": {
    "order": [ ["PMO周会关注顺序","内容"], ... 7 行 ],
    "responsibilities": [ ["PMO重点追责事项","说明"], ... 11 行 ]
  },
  "contractControls": [ ["类别","必须包含/规则","说明"], ... ],
  "dependencyRules": [ ["规则类型","内容","说明"], ... ],
  "wbsLineManagement": [ ["一级WBS","主线名称","最终管理重点"], ... ],
  "generatedAt": "2026-06-04T...",
  "sourceFile": "信息化项目_Project_H5最终执行版_导入表.xlsx"
}
```

### 文件变更

**新增**
- `pmo/gantt-react/public/reference.json`（由 `convert_xlsx.py` 生成）
- `pmo/gantt-react/src/utils/referenceData.js`
- `pmo/gantt-react/src/components/ReferenceRules.jsx`
- `pmo/scripts/smoke-reference.js`
- `pmo/scripts/smoke-task-fields.js`

**修改**
- `pmo/convert_xlsx.py` — 读 45 列主表 + 8 辅助 sheet；新增 `--check` 模式
- `pmo/CLAUDE.md` — 真源路径切换 + 删除 build-standalone 段
- `pmo/README.md` — 真源切换
- `pmo/gantt-react/README.md` — 新增 reference.json + 4 个新筛选器说明
- `pmo/gantt-react/src/App.jsx` — `DEFAULT_FILTERS` 增 4 键 + `pmoView` 增 `reference` 选项
- `pmo/gantt-react/src/components/FilterBar.jsx` — 4 个新筛选器
- `pmo/gantt-react/src/components/GanttChart.jsx` — Flag1 红色边框 / Flag2 金色菱形点
- `pmo/gantt-react/src/components/TaskDetail.jsx` — "执行层上下文"分组
- `pmo/gantt-react/src/App.css` — 新增徽章/分组/参考规则样式
- `pmo/gantt-react/src/utils/dateUtils.js` — `applyFilters` 增 4 个分支
- `docs/glossary.md` — 新增 7 个术语

**删除**
- `pmo/build-standalone.js`
- `pmo/信息化项目_Project_H5可用.xlsx`
- `pmo/信息化项目.csv`
- `pmo/信息化项目_资源池简化版_V2_管理版.csv`
- `pmo/信息化项目_资源池简化版_V2_执行版.csv`

## 任务数据模型

保留现有 15 个字段（id/wbs/name/type/duration/start/finish/predecessors/resources/department/vendor/reviewer/risk/milestone/deliverable/notes）。追加 17 个新字段：

**资源字段关系**：现有 `resources` 字段保留（向后兼容，转换逻辑沿用 `主责资源 or 资源名称` 兜底），仅在 TaskDetail 新分组中以 3 行展示新的 `resourcesPrimary` / `resourcesCollab` / `resourcesVendor`；其它位置（甘特 tooltip、任务树等）继续使用现有 `resources` 不变。

| 中文字段 | JSON 字段 | 类型 | 来源列 |
|---|---|---|---|
| 主责资源 | `resourcesPrimary` | string | 主责资源 |
| 协作资源 | `resourcesCollab` | string | 协作资源 |
| 供应商资源 | `resourcesVendor` | string | 供应商资源 |
| 所属视图分类 | `viewCategory` | string | 所属视图分类（Text10） |
| 阶段门编号 | `gateId` | string | 阶段门编号（Text11） |
| 阶段门名称 | `gateName` | string | 阶段门名称 |
| 是否关键路径控制 | `isCriticalPath` | bool | 是否关键路径控制（Flag1） |
| 是否H5重点展示 | `isH5Focus` | bool | 是否H5重点展示（Flag2） |
| 版本控制对象 | `versionObject` | string | 版本控制对象（Text13） |
| 变更等级 | `changeLevel` | string | 变更等级（Text14） |
| 联调启动条件 | `integrationStartCondition` | string | 联调启动条件（Text15） |
| 放行/阻断规则 | `releaseBlockRule` | string | 放行/阻断规则 |
| 合同/付款控制口径 | `contractControl` | string | 合同/付款控制口径 |
| H5诊断规则 | `h5DiagnosticRule` | string | H5诊断规则 |
| 执行说明 | `execNote` | string | 执行说明 |
| 是否虚拟摘要 | `isVirtualSummary` | bool | 是否虚拟摘要 |
| 评审意见 | `reviewOpinion` | string | 评审意见 |

**类型归一化**
- `bool`：源值 `是` → `true`，`否` → `false`，其他 → `false`
- 日期字段：复用 `convert_xlsx.py` 的 `norm_date`
- int 字段：复用 `norm_int`
- 字符串：`.strip()`，空值 → `""`

## UI 改动

### FilterBar（4 个新筛选器）

| 控件 | 行为 |
|---|---|
| 视图分类 | multi-select chips：全部 / 核心招采 / 主数据版本 / 基础资源分批 / 联调准备 / 阶段门 / 合同付款控制 / 风险闭环 |
| 阶段门 | multi-select chips：全部 / G0 / G1 / G2 / G3 / G4 / G5 / G6 |
| 关键路径 | 2 段 toggle：全部 / 仅关键 |
| H5重点 | 2 段 toggle：全部 / 仅重点 |

`App.jsx` `DEFAULT_FILTERS` 增 4 键：

```js
{ viewCategory: 'all', gateId: 'all', criticalOnly: false, focusOnly: false }
```

`applyFilters(tasks, filters, view)` 在 `dateUtils.js` 增 4 个分支：

```js
if (filters.viewCategory !== 'all' && task.viewCategory !== filters.viewCategory) return false;
if (filters.gateId !== 'all' && task.gateId !== filters.gateId) return false;
if (filters.criticalOnly && !task.isCriticalPath) return false;
if (filters.focusOnly && !task.isH5Focus) return false;
```

### GanttChart（Flag 视觉标记）

- `isCriticalPath = true` → 任务条描 2px 红色边框（`#c0392b`）
- `isH5Focus = true` → 任务条中心绘制 12px 金色菱形（`#d4af37`）
- 悬停 tooltip 增 4 行：视图分类、阶段门、关键路径（是/否）、H5重点（是/否）
- 图例区在右下角增 2 条说明

### TaskDetail（执行层上下文分组）

插在"风险等级"分组之后，"备注"之前。包含 14 行键值：

- 视图分类: [Text10 中文含义]（点击切换筛选）
- 阶段门: G2 - 业务蓝图冻结
- 关键路径: 是 [红色徽章] / 否
- H5重点: 是 [金色徽章] / 否
- 主责资源 / 协作资源 / 供应商资源（拆 3 行）
- 版本对象: V1.0
- 变更等级: A
- 联调启动条件: ...
- 放行/阻断规则: ...
- 合同/付款控制: ...
- H5 诊断规则: ...
- 执行说明: ...
- 评审意见: ...

空值行不显示。

### ReferenceRules（新组件，PMO 页"参考规则"Tab）

8 个子页签切换，每个子页签渲染对应辅助 sheet 的只读表格：

| 子页签 | 行数 | 来源 |
|---|---|---|
| H5视图分类 | 8 | H5视图分类 |
| 阶段门控制 | 17 | 阶段门控制体系 |
| H5诊断规则 | 8 | H5诊断规则 |
| 交付物分级 | 5 | 交付物分级审查 |
| 周会机制 | 7+1+11 | PMO周会机制（双段表头：7 行关注顺序 + 1 空行分隔 + 11 行重点追责事项） |
| 合同付款 | 8 | 合同与供应商履约控制 |
| 依赖规则 | 14 | Project依赖规则 |
| WBS管理 | 11 | 一级WBS管理口径 |

PMO周会机制 子页签特殊：前 7 行"关注顺序" + 后 11 行"重点追责事项"用两个子表头呈现。

`App.jsx` `PMO_VIEW_LABELS` 增 `reference` 项，"参考规则"加在末尾。

### App.css 补充

- `.task-detail-execution` 分组容器
- `.badge-critical` / `.badge-focus` 徽章
- `.ref-subtabs` / `.ref-table` / `.ref-section-title` 参考规则容器

## 错误处理

`convert_xlsx.py` fail-fast 场景（抛错 + 含行号）：
- 主表 sheet 名找不到
- 关键新列（`所属视图分类` / `阶段门编号` / `是否关键路径控制` / `是否H5重点展示`）缺失
- 8 个辅助 sheet 任一缺失（列出已找到与缺失）
- 主表 ID 重复

`convert_xlsx.py` 警告场景（写 stderr，不阻塞）：
- 单个 cell 解析失败
- 辅助 sheet 行数异常

React 应用：
- `reference.json` 加载失败 → ReferenceRules 显示"参考规则加载失败，请运行 `python convert_xlsx.py` 重新生成"
- 单个新字段缺失 → 视作空值，不阻塞渲染
- Text10 值不在 8 个标准值内 → 仍按原值显示，warn 一次

## 测试

`pmo/scripts/` 新增 2 个冒烟脚本（沿用项目"手动 HTTP 请求脚本"风格，无 Jest/Vitest）：

- `smoke-reference.js` — 读 `reference.json` 校验 8 张表都有内容、行数与源 sheet 一致、列数 ≥ 2
- `smoke-task-fields.js` — 抽样 5 条带视图分类的任务，验证 17 个新字段非空且类型正确

`convert_xlsx.py` 加 `--check` 模式：只解析不写文件，输出统计信息（各字段填充率、辅助 sheet 行数）。

## 边界

- 旧真源 Excel 删除前用 Grep 全仓确认无脚本引用
- 删除 `build-standalone.js` 前确认 `package.json` scripts 未引用（已查 pmo 根无 package.json）
- WBS重编码对照 不引入（已与用户确认）
- 字段字典 不引入（已与用户确认 8 个辅助表）

## 文档更新

- `pmo/CLAUDE.md` — 真源路径改 `信息化项目_Project_H5最终执行版_导入表.xlsx`，删除"独立 HTML"段，更新"甘特图数据更新"流程
- `pmo/README.md` — 改真源文件名
- `pmo/gantt-react/README.md` — 加 reference.json 说明 + 4 个新筛选器
- `docs/glossary.md` — 新增 7 个术语（视图分类、阶段门、关键路径控制、H5重点展示、版本控制对象、变更等级、联调启动条件）

## 验收标准

- [ ] `python convert_xlsx.py` 跑通，生成 `tasks.json`（含 17 个新字段）和 `reference.json`（含 8 张表）
- [ ] `python convert_xlsx.py --check` 输出统计信息
- [ ] `node pmo/scripts/smoke-reference.js` 全部通过
- [ ] `node pmo/scripts/smoke-task-fields.js` 全部通过
- [ ] `npm run dev`（gantt-react）启动后，4 个新筛选器在 FilterBar 出现且生效
- [ ] 任务条 Flag1 红色边框 / Flag2 金色菱形 渲染正确
- [ ] 任务详情新增"执行层上下文"分组
- [ ] PMO 页"参考规则"Tab 含 8 个子页签
- [ ] 交付物状态支持提交、进入评审、审核通过、退回整改、归档的合法流转
- [ ] 交付物台账支持筛选、关键词搜索和列排序
- [ ] 统计卡可单击跳转到对应 PMO/Gantt 视图并带入筛选意图
- [ ] 前端视觉指引能区分可点击、可排序、待审核、已退回和延期状态
- [ ] 旧真源 Excel / build-standalone.js / V2 资源池 csv 已删除
- [ ] `docs/glossary.md` 新增 7 个术语
- [ ] CLAUDE.md / README.md 真源路径已切换
