# AGENTS.md — 流程地图驾驶舱

`pmo/procedure-management/` 包含昌兴复材流程地图驾驶舱。该页面是 PMO 展示副本，不是流程输入基线维护入口。

## 文件

| 文件 | 用途 |
|---|---|
| `dashboard.html` | 主驾驶舱，单文件 HTML；应用CSS/JS内联，ECharts读取仓库根目录本地资产 |
| `AGENTS.md` | 本目录维护规则和页面结构说明 |

## 启动方式

推荐直接双击 `dashboard.html` 打开。页面数据内嵌在 HTML 中，无需 HTTP 服务。

如需本地 HTTP 服务：

```powershell
cd pmo/procedure-management
python -m http.server 8080
```

访问 `http://localhost:8080/dashboard.html`。

## 数据源

驾驶舱读取两个内嵌 JSON 数据源：

1. `#sankey-data`：流程到系统桑基图数据，由 `scripts/parse-sankey-data.mjs` 注入。
2. `#cross-dept-data`：跨部门衔接风险数据，由 `scripts/parse-sankey-data.mjs` 从 `docs/norms/流程治理/跨部门完整性检查报告.md` 解析并注入。

不要手工编辑内嵌 JSON 来替代 parser。

## 边界

- 流程输入基线回到 `docs/norms/{部门}部门-能力-流程-系统映射关系.md` 修改。
- 组织真源回到 `docs/organization/组织架构和部门职责.md` 修改。
- PMO 项目计划和甘特任务数据回到 `pmo/` 根目录 Markdown 真源维护。
- 制度、表单等证据来源应定位到对应源文件和条款、页码或表格位置。

## 数据更新

从仓库根目录运行：

```powershell
node scripts/parse-sankey-data.mjs
node scripts/check-dashboard-data.mjs
```

## 页面维护

- `dashboard.html`内联应用CSS/JS，并通过`../../echarts.min.js`读取仓库根目录本地ECharts资产；不得改用CDN或复制第二份资产。
- 缩进使用 2 空格。
- 设计风格统一使用现有 CSS 变量，新增 UI 应延续同一套变量。
- KPI 卡片网格为 3 列布局，新增卡片注意保持布局稳定。
- 跨部门数据中的中文引号不要替换。
- 域筛选重置时需同步重置风险筛选。

## 文档同步

修改页面结构、交互、数据字段、静态资产引用或验证命令时，必须同步更新本文件和 `README.md`。无需更新文档时，在交付说明中写明原因。
