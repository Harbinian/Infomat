# pmo/procedure-management 说明

> 状态：流程地图驾驶舱目录  
> 生效日期：2026-06-10  
> 范围：PMO 流程地图单页驾驶舱和目录维护说明。

本目录保存流程地图驾驶舱静态页面。驾驶舱是展示副本。

流程输入基线仍在 `docs/norms/`。
组织真源仍在 `docs/organization/`。
修改页面前先读 `AGENTS.md`。

## 当前文件

| 文件 | 作用 |
|---|---|
| `dashboard.html` | 流程地图驾驶舱，内嵌 `#sankey-data` 和 `#cross-dept-data` |
| `AGENTS.md` | 本目录维护规则和页面结构说明 |

## 数据更新

修改流程映射或跨部门完整性报告后，从仓库根目录运行：

```powershell
node scripts/parse-sankey-data.mjs
node scripts/check-dashboard-data.mjs
```

不要手工编辑 `dashboard.html` 内的 JSON 数据块来替代 parser。

## 使用边界

1. 页面样式和展示交互在本目录维护。
2. 流程输入基线回到 `docs/norms/` 修改；制度、表单等证据来源应定位到对应源文件和条款/页码/表格位置。
3. PMO 项目计划和甘特任务数据回到 `pmo/` 根目录 Markdown 真源维护。
4. 修改页面前先读 `AGENTS.md`。
5. 驾驶舱支持全公司和单域两种只读视图，不提供 CSV 导出；关键发现只陈述数据事实，不对应用系统作评价。
6. 页面视觉延续米色暖宣纸色系，样式修改复用 `dashboard.html` 的现有 CSS 变量。
