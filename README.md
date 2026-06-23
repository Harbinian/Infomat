# Infomat

Infomat 是航空复材制造领域的信息化资料与工具仓库，包含：

- 资料与交付文档：业务流程、数据地图、制度体系文件、集成方案等
- 可运行应用：MDM 平台（后续在业务部门完成流程地图/数据地图梳理后再进入开发迭代）
- 辅助工具与脚本：用于可视化、导入导出、文档生成与校验

## 仓库边界

开始跨目录任务前先读：

- [REPOSITORY_BOUNDARY.md](REPOSITORY_BOUNDARY.md)：仓库放什么、不放什么。
- [DIRECTORY_OWNERSHIP.md](DIRECTORY_OWNERSHIP.md)：每个目录的责任、真源和禁止事项。
- [MAINLINE_MAP.md](MAINLINE_MAP.md)：流程治理、字段台账、MDM、PMO 和脚本的数据流。
- [2026-06-07 仓库边界审计报告](docs/reports/2026-06-07-repo-boundary-audit.md)：当前混放、生成物和轻量整理建议。

## 目录结构（当前导航）

- `apps/`：可运行应用
  - `apps/mdm-platform/`：MDM 平台（Express + MySQL 目标形态 + 原生前端；SQLite 仅作历史/待迁移实现说明）
- `docs/`：资料、说明、方案与沉淀
  - `docs/samples/`：必要样例（用于复现、格式示例与对齐）
  - `docs/superpowers/`：历史方案与计划（可能含旧路径，按仓库结构说明做替换）
  - `docs/norms/`：制度文件与部门映射数据源（流程地图/数据地图）
  - `docs/organization/`：组织架构与部门职责（**部门→域映射的真源**）
  - `pmo/procedure-management/dashboard.html`：桑基图数据内嵌于 `<script id="sankey-data">`，由 `scripts/parse-sankey-data.mjs` 直接注入
- `pmo/`：项目管理工作室
  - `pmo/procedure-management/dashboard.html`：**流程地图驾驶舱**（单文件可双击打开，数据已内嵌于 `<script id="sankey-data">`）
  - `pmo/gantt-react/`：React 甘特图 / PMO 看板（开发模式 `npm run dev`）
- `scripts/`：仓库级脚本（与具体 app 无关）
  - `scripts/parse-sankey-data.mjs`：从 `docs/norms/` 生成桑基图 JSON
- `.planning/`：架构/结构/集成规划与扫描记录
- `.agents/` / `.claude/`：AI 辅助能力与工作区配置（不应包含生成物）

## 生成物与样例规则

- 所有可再生成输出统一放到 `artifacts/`（或工具自定义输出目录），不得提交到仓库
- 仅保留“必要样例”到 `docs/samples/`：用于说明输入输出格式、对齐契约、复现最小流程
- 禁止提交：浏览器 profile、抓取记录、临时解包目录、批量导出结果、含敏感信息的日志

## MDM 平台

MDM 平台使用仓库根目录的固定启动入口。

第一次启动前，在本机私有文件 `scripts/infomat-services.local.env` 写入两项密码；该文件已被 `.gitignore` 忽略，只保留在本机：

```text
MYSQL_PASSWORD=你的项目 MySQL 密码
MDM_ADMIN_PASSWORD=你的管理员密码
```

之后统一使用：

```powershell
npm run start:infomat-services
npm run smoke:infomat-services
```

固定配置见 `scripts/infomat-services.config.json`：

| 项 | 固定值 |
|---|---|
| MDM | `http://127.0.0.1:3000` |
| PMO | `http://127.0.0.1:5173` |
| MySQL | `localhost:3307` |
| MySQL 用户 / 库 | `mdm_user` / `infomat_mdm` |
| MySQL 连接池 | `MYSQL_CONNECTION_LIMIT=16` |
| 读模型 | `MDM_IDENTITY_READ_MODEL=mysql`、`PROCESS_GOVERNANCE_READ_MODEL=mysql` |
| 管理员工号 | `ADMIN001` |

启动脚本会使用固定 Docker 容器 `infomat-candidate-review-mysql`，并按固定环境启动 MDM 与 PMO。更多说明见 [apps/mdm-platform/README.md](apps/mdm-platform/README.md) 和 [scripts/README.md](scripts/README.md)。

## 流程地图驾驶舱

**双击即开**:直接双击 `pmo/procedure-management/dashboard.html` 即可在浏览器查看（数据已内嵌,无需 HTTP 服务,无双击空白问题）。

**单域直链**:
- `pmo/procedure-management/dashboard.html` — 全公司
- `pmo/procedure-management/dashboard.html?domain=经营域` — 经营域
- `pmo/procedure-management/dashboard.html?domain=生产域` — 生产域
- `pmo/procedure-management/dashboard.html?domain=总经理直辖域` — 总经理直辖域

**更新数据**:修改 `docs/norms/*.md` 后,运行:
```bash
node scripts/parse-sankey-data.mjs
```
脚本会直接注入 `pmo/procedure-management/dashboard.html` 的 `#sankey-data` 标签,刷新/重新双击即可看到最新数据。

**部门→域映射**以 `docs/organization/组织架构和部门职责.md` 为准(总经理直辖:工程技术部/质量管理部/财务部;经营副总:行政人事部/经营发展部/物资保障部;生产副总:项目管理部/复材一车间/复材二车间/运维安环部)。

