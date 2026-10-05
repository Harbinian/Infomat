# pmo/procedure-management 说明

> 状态：流程地图驾驶舱目录  
> 生效日期：2026-06-10  
> 范围：PMO 流程地图单页驾驶舱和目录维护说明。

本目录保存流程地图驾驶舱静态页面。驾驶舱是展示副本。

页面内嵌数据来自保留的历史消费链。当前流程、组织和职责依据用户指定外部材料及明确业务确认；`docs/norms/`和`docs/organization/`仅保留旧消费资产。
修改页面前先读 `AGENTS.md`。

## 当前文件

| 文件 | 作用 |
|---|---|
| `dashboard.html` | 流程地图驾驶舱，内嵌 `#sankey-data` 和 `#cross-dept-data` |
| `AGENTS.md` | 本目录维护规则和页面结构说明 |

## 数据更新

仅在明确授权维护旧展示消费链时，核对输入及生成影响后从仓库根目录运行；这些命令不代表业务确认：

```powershell
node scripts/parse-sankey-data.mjs --legacy-display --domain-map <historical-domain-map.json> --out docs/company-sankey-data.json --dashboard pmo/procedure-management/dashboard.html
node scripts/check-dashboard-data.mjs
```

不要手工编辑 `dashboard.html` 内的 JSON 数据块来替代 parser。

## 使用边界

1. 页面样式和展示交互在本目录维护。
2. 业务事实依据用户指定外部材料及明确确认；旧parser输入路径只用于兼容定位，不自动修改资料或同步数据库。
3. PMO 项目计划和甘特任务数据回到 `pmo/` 根目录 Markdown 真源维护。
4. 修改页面前先读 `AGENTS.md`。
5. 驾驶舱支持全公司和单域两种只读视图，不提供 CSV 导出；关键发现只陈述数据事实，不对应用系统作评价。
6. 页面视觉延续米色暖宣纸色系，样式修改复用 `dashboard.html` 的现有 CSS 变量。
