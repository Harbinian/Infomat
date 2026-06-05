# 流程治理数据 → PMO 驾驶舱集成设计（草案）

> 状态：草案修订版。本文用于校正 Claude 原草案中“立即推进 MDM Schema/API”的误导性方向。

## 0. 当前阶段边界

仓库当前处于“流程地图与数据地图的梳理与沉淀”阶段，MDM 平台开发暂时搁置。本期分析对象是流程，不是具体应用系统。

因此，本设计的近期目标不是让 MDM 成为实时权威源，而是把现有流程治理数据的来源、生成脚本和 PMO 驾驶舱展示收敛为一条稳定的静态数据链路：

```
docs/norms/{部门}部门-能力-流程-系统映射关系.md
docs/norms/流程治理/*.md
docs/organization/组织架构和部门职责.md
  ↓
scripts/parse-sankey-data.mjs
  ↓
docs/company-sankey-data.json
  ↓
PMO 驾驶舱 HTML (内嵌展示副本)
```

本期已确认维护当前流程地图驾驶舱：`pmo/procedure-management/dashboard.html`。`pmo/dashboard.html` 只是项目约定中的统计页示例路径，不作为本次 parser 注入目标。

## 1. 已确认决策

| # | 决策 | 说明 |
|---|------|------|
| D1 | 本期不修改 `apps/mdm-platform/` | 不新增表、不新增 API、不写 seed 脚本；MDM 方案仅作为后续候选 |
| D2 | `docs/company-sankey-data.json` 是生成数据真源 | `scripts/parse-sankey-data.mjs` 写出 JSON 文件，再把同一份快照注入 dashboard HTML 的 `<script>` 标签 |
| D3 | 跨部门衔接数据应由 parser 生成 | 不再长期手工复制到驾驶舱 HTML 的 `#cross-dept-data` |
| D4 | 驾驶舱 HTML 保持静态可用 | 页面继续支持直接打开；不依赖登录、API、CORS 或本地服务 |
| D5 | 统计页继续支持全公司/单域两种模式 | 单域口径来自组织架构真源，不在页面里另造部门-域映射 |
| D6 | 文案只描述流程数量和关系数量 | 避免“某系统最忙/承载最多/主用”等评价性系统表述 |

## 2. 数据真源

### 2.1 部门与域

部门到域映射以组织架构文档为准。当前仓库实际文件名是：

`docs/organization/组织架构和部门职责.md`

口径如下：

| 域 | 部门 |
|----|------|
| 总经理直辖域 | 工程技术部、质量管理部、财务部 |
| 经营域 | 行政人事部、经营发展部、物资保障部 |
| 生产域 | 项目管理部、复材车间、运维安环部 |

### 2.2 流程与系统落位建议

流程数据来自：

`docs/norms/{部门}部门-能力-流程-系统映射关系.md`

parser 解析部门、能力、流程、业务行为 A1 与应用系统建议，先写入 `docs/company-sankey-data.json`，再注入 PMO 驾驶舱 HTML。页面展示时应表达为”X 个流程建议落位到 Y 类应用”，不要表达为”Y 系统承载最多/最忙”。

### 2.3 跨部门衔接风险

近期跨部门风险来源仍是流程治理报告：

- `docs/norms/流程治理/跨部门流程识别报告.md`
- `docs/norms/流程治理/跨部门完整性检查报告.md`
- `docs/norms/流程治理/过时部门名称追踪表.md`
- `docs/norms/流程治理/A1编号全域规则.md`

目标是让 parser 读取这些报告或其结构化片段，生成与驾驶舱兼容的 `crossDept` 数据，并写入 `docs/company-sankey-data.json`，而不是在页面里维护第二份手工 JSON。

## 3. 目标数据契约

`docs/company-sankey-data.json` 保持现有主结构，并新增 `crossDept` 字段。驾驶舱内嵌的 `#sankey-data` 是该文件的展示副本：

```json
{
  "nodes": [],
  "links": [],
  "systems": [],
  "stats": {
    "mappings": 252,
    "a1": 425,
    "departmentsWithData": 8,
    "departmentsEmpty": 1
  },
  "crossDept": {
    "stats": {
      "totalChecked": 168,
      "confirmed": 158,
      "pendingConfirm": 6,
      "highRisk": 1,
      "mediumRisk": 0
    },
    "risks": [
      {
        "source": "全部已映射部门",
        "target": "工程技术部",
        "a1": "—",
        "refs": 34,
        "risk": "high",
        "status": "未映射-无文档",
        "desc": "指向工程技术部的 A1 在目标侧暂缺对应流程。"
      }
    ],
    "interactionChains": [
      {
        "name": "客户订单→交付链",
        "status": "partial",
        "breaks": ["工程技术部: BOM/工艺节点待补全"]
      }
    ],
    "source": "docs/norms/流程治理/跨部门完整性检查报告.md"
  }
}
```

说明：

- 字段名沿用当前驾驶舱 HTML 已消费的结构：`source`、`target`、`a1`、`refs`、`risk`、`status`、`desc`。
- `risk` 枚举仅使用 `high` / `medium` / `low`。
- `status` 保留业务口径，如“已映射-待确认”“已映射-待复核”“未映射-无文档”。
- `crossDept` 缺失时，驾驶舱可以继续读取页面内旧的 `#cross-dept-data` 作为兜底。

命名与结构约束：

- 不使用 `cross_dept`；统一使用 `crossDept`。
- 不把现有顶层结构改造成 `meta/sankey/crossDept` 包裹结构。
- 不新增第三套 API 风格字段名，例如 `source_dept`、`ref_count`、`risk_level`。这些字段只适合后续 MDM API 候选方案，不能混入当前静态 JSON 契约。

## 4. 驾驶舱行为

页面加载顺序：

1. 读取内嵌 `#sankey-data`。
2. 如果其中包含 `crossDept`，用 `crossDept` 渲染跨部门衔接表和 insights。
3. 如果没有 `crossDept`，继续读取旧 `#cross-dept-data`。
4. 不发起 MDM API 请求。
5. 不提供 CSV 导出。

全公司/单域切换继续保留。单域视图只过滤当前域内的部门、流程和风险项，不改变数据口径。

## 5. 本期不做

- 不新增 `mapping_interactions`、`mapping_interaction_chains` 等 MDM 表。
- 不新增 `/api/views/cross-dept-risks`、`/api/views/cross-dept-matrix` 等 MDM API。
- 不新增 MDM seed 脚本或 smoke 脚本。
- 不把 `scripts/parse-sankey-data.mjs` 标记废弃。
- 不把 `docs/norms/` 历史 Markdown 导入 MDM。

## 6. 当前 MDM 适配性审查

2026-06-03 已检查 `apps/mdm-platform/` 与流程治理数据的适配性。本轮只审查平台代码和现有库状态，不修改 MDM 代码。

结论：当前 MDM 平台可以作为后续候选承接平台，但尚不能作为本期流程治理数据真源，也不能替代 `docs/company-sankey-data.json` 或 PMO 静态驾驶舱。

主要证据：

- `server/db.js` 的业务地图主结构是 `departments`、`systems`、`capabilities`、`processes`、`mappings`、`mapping_related_departments`、`mapping_systems`。它可以表达“部门-能力-流程-应用系统”的发布映射，但没有 A1 业务行为、输入来源部门、输出目标部门、跨部门风险、交互链快照等结构。
- `server/routes/views.js` 的 `/api/views/sankey` 只从 `published` 映射生成四层 `{ nodes, links }`，没有 `stats`、`systems`、`crossDept`，与当前 `docs/company-sankey-data.json` 契约不兼容。
- `server/routes/import.js` 只支持字段台账 Excel 导入，不支持 `docs/norms/{部门}部门-能力-流程-系统映射关系.md`、`docs/company-sankey-data.json` 或跨部门报告导入。
- 当前 `apps/mdm-platform/data/platform.db` 中 `systems`、`capabilities`、`processes`、`mappings` 均为 0，且部门维表仍缺少 `运维安环部`，存在 `公司领导`、`信息化部` 等项目治理口径记录。
- `scripts/seed-demo-data.js` 与 `scripts/setup-mdm-project-users.js` 仍包含会议演示、项目组或旧部门口径，不能作为流程地图沉淀阶段的数据初始化来源。
- 多个 MDM 路由测试会重置或删除 `apps/mdm-platform/data/platform.db`。恢复 MDM 开发前，应先支持隔离测试库，避免验证动作破坏现有工作区数据。

因此，近期仍应保持“Markdown 真源 -> parser -> JSON 快照 -> PMO 静态驾驶舱”的链路。MDM 业务地图中存在的 Sankey 视图只属于登录态平台内视图，不应与 PMO 驾驶舱的静态展示混用。

## 7. 后续 MDM 候选方向

当 MDM 平台开发恢复后，可以重新评估以下方向：

1. 在 MDM 中结构化存储 A1 跨部门交互。
2. 为 PMO 驾驶舱提供只读 API。
3. 解决静态页面访问 API 时的鉴权、CORS、同源托管或 API key 方案。
4. 统一 API 响应结构与当前 dashboard 数据契约。
5. 用数据库查询替代流程治理 Markdown 报告。

这些内容应另起 MDM phase，不应混入当前流程地图沉淀阶段。
