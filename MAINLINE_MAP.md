# Infomat 主线关系图

> 状态：执行规则  
> 生效日期：2026-06-07  
> 目的：说明 MDM 主线、PMO 主线、资料真源和脚本工具之间的数据流关系，防止误把展示副本当真源。

## 1. 当前阶段主线

当前仓库处于“流程地图与数据地图的梳理与沉淀”阶段。此阶段分析对象是流程，不是具体应用系统。

MDM 平台开发暂时搁置，保留为后续承接平台。PMO 驾驶舱是当前流程地图展示入口。资料真源仍在 `docs/`。

## 2. 流程治理主线

```text
docs/organization/组织架构和部门职责.md
docs/norms/{部门}部门-能力-流程-系统映射关系.md
docs/norms/流程治理/*.md
  ↓
scripts/parse-sankey-data.mjs
  ↓
docs/company-sankey-data.json
  ↓
pmo/procedure-management/dashboard.html
  内嵌 <script id="sankey-data">
  ↓
apps/mdm-platform 流程治理快照导入
  仅作后续平台承接与验证
```

规则：

- `docs/norms/` 是流程数据原始来源。
- `docs/company-sankey-data.json` 是 parser 生成快照。
- `pmo/procedure-management/dashboard.html` 是展示副本，不是流程原始来源。
- `apps/mdm-platform` 只在导入快照后承接结构化查看和后续治理，不反向覆盖 `docs/norms/`。

## 3. 字段台账与主数据主线

```text
业务流程（L3）/ 业务行为（A1）
  ↓
field_entries
  数据对象、字段、消费系统、同步方式、L3/A1 引用
  ↓
field_identities
  黄金源候选、权威系统、维护部门、owner、确认状态
  ↓
主数据对象候选
  组织、人员、岗位、产品、物料、供应商、工装、设备等
  ↓
后续 MDM 建模、权限、导入导出和接口设计
```

规则：

- 字段台账中的 `data_object` 是主数据对象候选，不等同于已经完成主数据建模。
- 黄金源确认必须按字段进行，不因流程建议落位自动认定。
- 主数据对象沉淀前必须确认维护部门、审批部门、消费系统和权限边界。

## 4. MDM 平台主线

```text
apps/mdm-platform/server/db.js
  ↓
apps/mdm-platform/server/routes/*
  ↓
apps/mdm-platform/public/index.html
  ↓
apps/mdm-platform/scripts/test-*.js
apps/mdm-platform/scripts/smoke-*.js
```

关键检查：

```bash
cd apps/mdm-platform
npm run test:mainline
```

该检查验证：

- 流程治理快照可运行。
- 字段台账可引用流程治理 L3/A1。
- 主数据对象基础路由可隔离运行。
- 项目角色权限边界可验证。
- 字段台账可导入导出。

规则：

- 平台测试必须使用隔离数据库或明确声明测试数据范围。
- 运行态数据库不是仓库真源。
- 平台脚本只服务 MDM 时留在 `apps/mdm-platform/scripts/`。
- 跨资料、跨 PMO、跨 app 的脚本进入仓库级 `scripts/`。

## 5. PMO 项目管理主线

```text
pmo/信息化项目_计划管控真源.md
pmo/信息化项目_WBS结构真源.md
pmo/信息化项目_工作平衡.md
pmo/信息化项目_工作开展原则.md
  ↓
pmo/convert_xlsx.py
  ↓
pmo/tasks.json
pmo/pmo-source-manifest.json
pmo/gantt-react/public/tasks.json
pmo/gantt-react/public/pmo-source-manifest.json
  ↓
pmo/gantt-react/
```

规则：

- PMO Markdown 是项目计划当前维护入口。
- XLSX 只作历史导入或备份口径，除非 PMO README 另行更新。
- `pmo/gantt-react/public/tasks.json` 是 React 应用消费数据，不是手工维护真源。

## 6. AI 协作与历史方案主线

```text
docs/superpowers/specs/*
docs/superpowers/plans/*
.planning/*
.agents/*
.claude/*
```

规则：

- `docs/superpowers/` 用于追溯历史设计和计划，不作为当前执行真源。
- `.agents/` 和 `.claude/` 是 AI 协作配置，不放项目生成物。
- 历史方案如与当前边界文件冲突，以 `REPOSITORY_BOUNDARY.md`、`DIRECTORY_OWNERSHIP.md` 和本文件为准。

## 7. 禁止的跨线操作

| 禁止操作 | 原因 | 正确做法 |
|---|---|---|
| 改 MDM 时顺手改 `docs/norms/` | 平台代码和流程真源混线 | 先确认是否是资料变更任务 |
| 改 PMO 驾驶舱时手工重造流程数据 | 展示副本会偏离 parser 真源 | 修改 `docs/norms/` 后运行 parser |
| 跑测试时写共享 `platform.db` | 会污染平台本地状态 | 使用 `MDM_DB_PATH` 隔离数据库 |
| 整理文档时移动 `apps/mdm-platform/` | 运行系统路径被脚本和说明引用 | 先写迁移计划和验证命令 |
| 把截图、zip、解包目录作为证据长期提交 | 检索噪音高，容易误导 AI | 放入 `artifacts/` 或精选到 `docs/samples/` |

## 8. 下一步收口路线

第一步：完成仓库边界审计和三份边界文件。  
第二步：为 `docs/reports/`、`docs/architecture/`、`scripts/` 分组补 README。  
第三步：只迁移低风险生成物和根目录临时文件。  
第四步：评估是否需要拆仓库；拆仓库前必须保持流程治理链路可验证。
