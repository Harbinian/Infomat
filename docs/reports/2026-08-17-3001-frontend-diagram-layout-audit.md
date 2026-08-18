# 3001前端流程图布局算法走读与数据对象上画布可行性评估

> 日期：2026-08-17
> 审计范围：`apps/structured-output-service/public/process-diagram.js`、`review-pattern-diagrams.js`，及 `index.html` 中画布挂载相关代码
> 数据来源：源码静态走读
> 改动状态：只读分析，未修改任何真源或源码

## 结论摘要

- `process-diagram.js`（1475 行）是纯只读渲染：`mount` 中 `autoungrabify: true`、`autounselectify: true`、`boxSelectionEnabled: false`；"可编辑流程图"在现有代码中不存在，属于新能力。
- `data_objects` 目前完全不参与画布元素生成（唯一引用是第 638 行 `dataNameByRef`，仅用于"运行时责任部门"泳道副标题）；`forms` 与 `behavior_links` 在图中零图形引用。
- 数据对象上画布的最合理形态是**挂在行为节点上的聚合徽标**，而非独立节点；独立节点需重写 rank 分层、列间距假设、泳道排序、边路由与泳道高度预留。

## 一、算法结构

### 1. 泳道分配

- 部门顺序：`departmentOrder = unique([owningDepartment, ...options.departmentOrder, ...DEFAULT_DEPARTMENT_ORDER])`（622—629 行），兜底为硬编码 10 部门 + 公司领导。
- 节点归泳道（`actorPlacement`，180—225 行）按执行主体三模式：`dynamic_from_data` → `__dynamic_department__`；`company_wide` 或 `全公司` → `__all_company__`；固定部门（`raw === 部门名 || raw.startsWith(部门名)`）→ 对应部门泳道；其余 → `__unknown_department__`。
- 泳道排序（`buildLaneOrder`，361—381 行）：归口部门（已使用时）最上 → 部门目录顺序 → 未知 laneKey 按 localeCompare → 全公司通用 → 运行时责任部门 → 执行部门待明确。
- 泳道高度（868—895 行）：`max(154, 上轨预留 + 列堆叠高 + 下轨预留 + 56)`，上下轨预留来自 `allocateRelationRoutes`。

### 2. 列排序与间距

- 列来源（`analyzeRelationGraph`，245—359 行）：对非 loop 关系建图做 Tarjan 强连通分量（SCC），再对凝聚 DAG 做 Kahn 拓扑分层，`rankById[node] = componentRank + 分量内局部索引`；每条非回路关系都指向更后的列。
- 列内顺序：按 `layoutOrder`（behaviors 数组索引）垂直堆叠。
- 列间距（847—858 行）：`max(440, 前一半宽 + 本列半宽 + 220标签 + 48净空)`；MIN_COLUMN_GAP=440 是下限。
- 并行分支：各分支目标因可达性都排在 split 后一列同列堆叠；汇合因 Kahn indegree 语义自然对齐到所有分支之后的那一列。

### 3. 边路由（`allocateRelationRoutes` 390—495 行 + `relationEdge` 497—570 行）

- 决策链（按序短路）：loop/backward → 下轨；重复源目标 → 上下错位；分支源（decision/parallel_split 出度>1）→ 按目标垂直方向；跨列 → 按源/目标位置；否则直线 taxi。
- 轨道按 bucket（位置 × 同/跨泳道）分配 slot 与 offset，间距 ROUTE_TRACK_GAP=24。
- 防重叠：事前 `laneReserves` 抬高泳道；事后 `findLayoutCollisions`（590—620 行）检测节点/标签碰撞。**代码中未见自动避让修复逻辑，只有检测与报告。**

### 4. 闭环检测

非 loop 关系 Tarjan SCC：分量长度>1 或自环 → 环分量内关系进"关系类型请核对"清单（`RELATION_CYCLE_REVIEW_MESSAGE`），非阻断、可定位关系卡、不自动改写关系类型。

### 5. 文字换行与节点尺寸

- `characterUnits`（57—59 行）：单字节计 0.56 单位、中文计 1 单位，按显示宽度计量。
- `wrapDisplayText`（61—101 行）按单位逐字符折行，返回 label/lineCount/maxLineUnits。
- `nodeDisplayMetrics`（103—145 行）：菱形节点 `nodeWidth = max(312, textMaxWidth/0.46)`、`nodeHeight = max(220, labelHeight/0.42)`；矩形节点用 baseWidth/baseHeight 加文字高度推导。
- `edgeDisplayMetrics`（147—155 行）：标签宽 clamp 84—220。

### 6. 缩放与自适应（`showInitialViewport` 1375—1403 行）

`cy.fit(undefined, 34)` 得全图缩放；≥0.6 显示全图，<0.6 聚焦泳道表头 + 前两列并提示；`fit()`/`reset()` 分离。

### 7. mount 与 cytoscape 渲染（1405—1469 行）

preset 布局 `fit:false` 直接用自研坐标；边用 `data(segmentDistances)/taxiTurn` 驱动 cytoscape 折线；`cy.on('tap', ...)` → `onFocus` 定位文字编辑；整体只读。

## 二、数据对象上画布可行性

### 推荐形态：行为节点徽标（非独立节点）

理由：数据对象无执行部门、不在流程顺序中；代码已有 `countersign-badge`（987—1006 行）先例；与"data_objects 不入主图"约束兼容；独立节点形态仅在需要表达数据生命周期位置时才有增量价值。

### 独立节点方案的可复用性

| 现有组件 | 结论 |
|---|---|
| wrapDisplayText / characterUnits / nodeDisplayMetrics | 可复用 |
| findLayoutCollisions / elementBounds | 可复用 |
| mount / graphStyles 框架 / 视野适配 | 可复用 |
| laneReserves 上下轨预留 | 部分复用 |
| allocateRelationRoutes 轨道机制 | 部分复用 |
| analyzeRelationGraph rank 分层 | 必须重写 |
| 列间距假设 | 必须重写 |
| buildLaneOrder 泳道排序 | 必须重写 |
| 边路由 placement 决策 | 必须重写 |
| laneHeight 计算 | 必须重写 |

### 多对多关系表达

一个数据最多 1 个 create + 多个 update/use；一个行为可被多个数据引用（超图）。独立节点 + 全连线必然形成蜘蛛网。推荐聚合徽标 + 点击展开、零连线；若坚持独立节点，采用数据轨道方案，默认只画 create 连线、update/use 折叠。`source_relations` 无本图行为锚点，不应上画布。

### 表单上画布是否值得

不值得整张上画布。字段级关系信息量远超画布承载，已有"数据与表单关系总览"（`renderRelationshipOverview`，4784—4812 行）闭环。建议上限为"表单 ×N"徽标。

## 三、最小可行方案：数据/表单聚合徽标 + 点击定位

- 视觉形态：行为节点底部挂聚合徽标"数据 产出×N / 使用×N"、"表单 ×N"，复用 `countersign-badge` 定位与样式模板，新配色区分产出/使用/表单。
- 交互：tap 徽标 → `onFocus('data'|'form', ref)` → 现有 `focusEditorItem` 定位对应分区卡片，保持只读。
- 布局约束：徽标挂在节点边界内/边缘，不改变 nodeWidth/nodeHeight，不参与 rank/轨道/泳道计算。
- 改动点：
  1. `process-diagram.js` `buildGraphModel` 遍历 `data_objects[].behavior_links[]` 和 `forms[].behavior_links[]`，按 behavior_ref 聚合 operation 计数，生成 badge 节点。
  2. `graphStyles()` 增加 `.data-badge`/`.form-badge` 样式。
  3. `mount` 的 tap selector 增加 badge 类。
  4. `index.html` `renderDiagramLegend` 增加图例条目。
  5. 不动泳道/列/边路由/闭环检测任何函数。
- 风险：
  - 徽标密度：约 40 行为 × 多数据的代表性流程下节点底部徽标可能溢出，需聚合计数 + 溢出策略（"×N+"或换行）。
  - 与只读约束边界：徽标不违反"data_objects 不入主图"；独立数据节点需先修订 AGENTS.md 约束与验收口径。
  - "可编辑流程图"本身不存在，需独立交互层、数据写回与未保存保护策略，超出画布算法范畴。

## 附：评审图例复用关系

`review-pattern-diagrams.js` 的 9 个图例经 `buildDocument` 转成 v3 文档后完全复用 `ProcessDiagram.mount`；图例数据 `data_objects: []`、`forms: []`。若将来给图例加数据对象示例，也走同一 buildDocument→mount 通道。
