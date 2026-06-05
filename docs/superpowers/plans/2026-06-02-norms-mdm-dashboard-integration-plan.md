# 流程治理数据 → PMO 驾驶舱集成 Implementation Plan

> **For agentic workers:** 本计划是 Claude 原草案的修订版。当前阶段不得执行 MDM DB/API 开发任务；所有近期工作都围绕 `scripts/parse-sankey-data.mjs`、`docs/company-sankey-data.json` 和 PMO 驾驶舱 HTML。

**Goal:** 将跨部门衔接风险从驾驶舱 HTML 的手工内嵌 JSON 收敛到 parser 生成的 `docs/company-sankey-data.json` 中，让 PMO 驾驶舱继续静态可用，并保持全公司/单域视图。

**Architecture:** `docs/norms/` 映射文档 + `docs/norms/流程治理/` 报告 → `scripts/parse-sankey-data.mjs` → `docs/company-sankey-data.json` → PMO 驾驶舱 HTML 内嵌快照渲染。

**Tech Stack:** Node.js + vanilla JS + static HTML；不使用 MDM API。

**Spec:** `docs/superpowers/specs/2026-06-02-norms-mdm-dashboard-integration-design.md`

---

## 文件结构

| 操作 | 文件 | 职责 |
|:---:|------|------|
| 修改 | `scripts/parse-sankey-data.mjs` | 解析部门映射与跨部门完整性报告，生成 `docs/company-sankey-data.json` 和内嵌快照 |
| 生成 | `docs/company-sankey-data.json` | parser 生成的数据真源，包含 Sankey 主数据和跨部门风险数据 |
| 修改 | `pmo/procedure-management/dashboard.html` (`#sankey-data`) | parser 注入 `docs/company-sankey-data.json` 的展示副本 |
| 修改 | `pmo/procedure-management/dashboard.html` | 优先读取 `sankey-data.crossDept`，保留旧 `#cross-dept-data` 兜底 |
| 新增 | `scripts/check-dashboard-data.mjs` | 校验生成 JSON 与 dashboard 内嵌数据一致 |
| 参考 | `docs/norms/流程治理/跨部门完整性检查报告.md` | 跨部门风险来源 |
| 参考 | `docs/organization/组织架构和部门职责.md` | 部门→域真源 |

---

## Guardrails

- [x] 不修改 `apps/mdm-platform/`。
- [x] 不新增 MDM 表、API、seed 脚本或 smoke 脚本。
- [x] 不要求登录、本地服务、CORS 或 API key。
- [x] 不提供 CSV 导出。
- [x] 页面文案避免“系统最忙/承载最多/主用”等评价性表述。
- [x] 新增/修改 norms 文件后仍通过 `node scripts/parse-sankey-data.mjs` 重生 `docs/company-sankey-data.json` 和 dashboard 内嵌快照。

---

### Task 0: 确认驾驶舱目标文件

**Files:**
- Inspect: `pmo/`
- Confirmed target: `pmo/procedure-management/dashboard.html`

- [x] **Step 1: 找到当前流程地图驾驶舱**

当前仓库中可见的流程地图驾驶舱是：

```text
pmo/procedure-management/dashboard.html
```

项目约定中的统计页示例路径是：

```text
pmo/dashboard.html
```

本期已确认继续使用当前文件；不要恢复或新增第二个流程地图驾驶舱副本。

- [x] **Step 2: 更新 parser 中的 dashboard 路径**

`scripts/parse-sankey-data.mjs` 当前应只指向 `pmo/procedure-management/dashboard.html`。不要同时维护两个驾驶舱副本。

---

### Task 1: parser 生成 crossDept 快照

**Files:**
- Modify: `scripts/parse-sankey-data.mjs`
- Generate: `docs/company-sankey-data.json`

- [x] **Step 1: 增加跨部门报告路径常量**

读取：

```js
const CROSS_DEPT_REPORT = resolve(NORMS, '流程治理', '跨部门完整性检查报告.md');
```

- [x] **Step 2: 新增 `parseCrossDeptReport(text)`**

输出结构必须与当前 dashboard 兼容：

```js
{
  stats: {
    totalChecked: 168,
    confirmed: 158,
    pendingConfirm: 6,
    highRisk: 1,
    mediumRisk: 0
  },
  risks: [
    { source, target, a1, refs, risk, status, desc }
  ],
  interactionChains: [
    { name, status, breaks }
  ],
  source: 'docs/norms/流程治理/跨部门完整性检查报告.md'
}
```

解析策略：

- 优先解析报告中的汇总表，得到 `totalChecked`、`confirmed`、`pendingConfirm`、`highRisk`、`mediumRisk`。
- 从“未映射部门汇总”和“待确认事项”生成 `risks`。
- 保留“工程技术部 34 条”“复材车间 24 条”“6 条待确认”等现有口径。
- 对无法稳定解析的段落，允许保留小型显式映射表，但必须写清楚来源段落，避免伪装成自动推断。

- [x] **Step 3: 将 `crossDept` 写入 `finalData` 并输出 JSON 文件**

在 `finalData` 中新增：

```js
crossDept: parseCrossDeptReport(crossDeptReportText)
```

驾驶舱内嵌的 `#sankey-data` JSON 的 `nodes`、`links`、`systems`、`stats` 结构保持不变。`finalData` 必须先写入 `docs/company-sankey-data.json`，再注入 dashboard。

- [x] **Step 4: 同步内嵌 dashboard 的 `#cross-dept-data`**

现有 parser 已替换 `#sankey-data`。本任务新增对 `#cross-dept-data` 的替换：

```js
const crossTagRe = /(<script type="application\/json" id="cross-dept-data">)[\s\S]*?(<\/script>)/;
```

用 `JSON.stringify(finalData.crossDept)` 替换该标签内容，保证 dashboard 仍可双击打开。

- [x] **Step 5: 验证**

```bash
node scripts/parse-sankey-data.mjs
```

检查：

- 驾驶舱 HTML 内嵌 `#sankey-data` 包含 `crossDept`。
- `docs/company-sankey-data.json` 存在并包含 `crossDept`。
- `crossDept.stats.totalChecked` 为 `168`。
- `crossDept.risks` 至少包含工程技术部、复材车间和 6 条待确认项。
- 已确认的驾驶舱 HTML 的 `#cross-dept-data` 已更新。

---

### Task 2: dashboard 优先读取 `sankey-data.crossDept`

**Files:**
- Modify: 已确认的 PMO 驾驶舱 HTML

- [x] **Step 1: 调整数据加载顺序**

在 `loadData()` 成功解析 `#sankey-data` 后，如果 `data.crossDept` 存在，则赋值给 `crossDeptData`。

保留 `loadCrossDeptData()` 作为兜底：

```js
if (data.crossDept) {
  crossDeptData = data.crossDept;
} else {
  loadCrossDeptData();
}
```

- [x] **Step 2: 避免覆盖 parser 生成的数据**

`main()` 中不要先无条件调用 `loadCrossDeptData()` 再调用 `loadData()`。应由 `loadData()` 决定优先级。

- [x] **Step 3: 校正管理层文案**

检查 insights 和 KPI 副文案，避免“承载最多/最忙/主用”等系统或部门评价性表述。

推荐表达：

- “当前范围内识别出 X 个流程、Y 条承载关系。”
- “当前范围内 X 个流程建议落位到 Y 类应用。”
- “Z 个流程尚未明确落位的应用系统。”

- [ ] **Step 4: 浏览器打开验证**

直接打开已确认的 PMO 驾驶舱 HTML，确认。本轮因本地未发现 Playwright/Puppeteer 等浏览器自动化依赖，暂未把该项标为完成；已用 `scripts/check-dashboard-data.mjs` 完成数据一致性、普通脚本语法和公司级桑基图渲染配置缺失检查。

- 首屏正常渲染。
- 全公司/单域切换可用。
- 跨部门风险表显示工程技术部、复材车间和待确认项。
- 没有 API 请求失败提示。
- 控制台无运行时错误。

---

### Task 3: 静态数据一致性检查

**Files:**
- Modify or Create: `scripts/check-dashboard-data.mjs`（可选）

- [x] **Step 1: 读取 JSON 和 dashboard 内嵌数据**

检查 parser 注入后 `docs/company-sankey-data.json`、驾驶舱 HTML 中 `#sankey-data`、`#cross-dept-data` 是否一致。

- [x] **Step 2: 检查关键口径**

至少检查：

- 部门→域包含 9 个部门。
- `stats.departmentsEmpty` 与空部门节点数量一致。
- `crossDept.stats.totalChecked`、`pendingConfirm`、`highRisk` 与报告口径一致。
- `crossDept.risks[*].risk` 仅为 `high` / `medium` / `low`。

- [x] **Step 3: 验证**

```bash
node scripts/check-dashboard-data.mjs
```

Expected:

```text
Dashboard data check passed.
```

---

### Task 4: 后续 MDM 候选方案归档

**Files:**
- Modify: `docs/superpowers/specs/2026-06-02-norms-mdm-dashboard-integration-design.md`

- [x] **Step 1: 保留但降级 MDM 方案**

将 MDM 表/API 方案保留在“后续 MDM 候选方向”，不要写成本期任务。

- [x] **Step 2: 记录恢复 MDM 开发前置条件**

至少包括：

- MDM 平台开发重新启动。
- 明确静态 PMO 页面是否仍需离线可用。
- 明确 API 鉴权方式：登录 session、API key、同源托管或公开只读。
- 统一 API 响应结构与当前 `crossDept` 数据契约。

- [x] **Step 3: 记录当前 MDM 代码适配性审查**

2026-06-03 已检查 `apps/mdm-platform/`。结论已写入 spec 的“当前 MDM 适配性审查”章节：

- 当前 MDM 业务地图 API 只输出登录态四层 `{ nodes, links }`，不匹配 PMO 静态驾驶舱的 `stats`、`systems`、`crossDept` 契约。
- 当前 MDM 数据库业务地图核心表为空，部门口径也未完全对齐组织架构真源。
- 当前 MDM import/export 更偏字段台账和黄金源治理，不是流程治理 Markdown 或 `docs/company-sankey-data.json` 的导入出口。
- 当前 MDM 测试脚本会清空或删除共享 `platform.db`，恢复 MDM 开发前需要隔离测试库。

---

## 验证清单

- [x] `node scripts/parse-sankey-data.mjs` 成功注入驾驶舱 HTML。
- [x] `docs/company-sankey-data.json` 存在，且包含 `nodes`、`links`、`systems`、`stats`、`crossDept`。
- [x] 驾驶舱 HTML 内嵌 `#sankey-data.crossDept` 存在。
- [x] 已确认的驾驶舱 HTML 内嵌的 `#sankey-data` 和 `#cross-dept-data` 已同步。
- [ ] dashboard 直接打开可用，不依赖 MDM 服务。（待浏览器实开验证）
- [x] dashboard 支持全公司/单域视图。（静态结构与脚本语法已校验）
- [x] 页面无 CSV 导出入口。
- [x] 页面文案无“系统最忙/承载最多/主用”等评价性系统描述。
- [x] 未修改 `apps/mdm-platform/`。
- [x] 已审查当前 MDM 平台与流程治理数据链路的适配性，并确认近期不切换到 MDM API。
- [x] 未运行会清空或删除 `apps/mdm-platform/data/platform.db` 的 MDM 路由测试。

## 明确不执行

以下是 Claude 原草案中不适合当前阶段的内容，本计划不执行：

- 新增 `mapping_interactions` 表。
- 新增 `mapping_interaction_chains` 表。
- 新增 `v_cross_dept_risks` 视图。
- 新增 `/api/views/cross-dept-risks`。
- 新增 `/api/views/cross-dept-matrix`。
- 编写 MDM seed 或 smoke 脚本。
- 将 dashboard 切换为实时 API 模式。
- 直接运行会重置共享 `platform.db` 的 MDM 测试脚本。
