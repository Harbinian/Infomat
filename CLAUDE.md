# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Infomat 是航空复材制造领域的业务关系映射与主数据管理工具集。当前分支正在建设 MDM 平台。

## 常用命令

### MDM 平台（主项目）

```bash
cd mdm-platform
npm install                # 安装依赖
npm start                  # 启动服务 (Express, 端口 3000)
npm run dev                # 开发模式 (nodemon 自动重启)
npm run init-db            # 初始化/重建数据库
npm run smoke              # 冒烟测试
npm test:org               # 组织架构路由测试
npm test:catalog           # 业务能力/流程目录测试
npm test:mappings          # 映射路由测试
npm test:conflicts         # 冲突管理测试
npm test:terms             # 术语与版本测试
npm test:export            # 导出测试
npm test:import            # 导入测试
npm test:frontend          # 前端静态资源测试
node scripts/smoke-master-data.js   # 主数据模块冒烟测试 (8 用例)
node scripts/smoke-integration.js    # 集成接口冒烟测试 (7 用例，含 API Key 鉴权)
```

### Gantt 渲染

```bash
python scripts/generate_digital_project_gantt_8k.py   # MD 数据 → 8K PNG (PIL)
node scripts/render_gantt_h5_png.mjs                    # H5 HTML → 8K PNG (headless Chrome)
```

### 独立 HTML 文件

`digital_project_gantt_H5.html`、`gantt.html` 等直接在浏览器打开即可使用，无构建步骤。

## 技术栈

**MDM 平台**：Express.js + better-sqlite3 (SQLite) + 原生 HTML/CSS/JS 前端 (ECharts)。后端 `express-session` 做会话管理，`bcryptjs` 做密码哈希，`exceljs` + `multer` 做 Excel 导入导出。

**Gantt 渲染**：Python (Pillow) 从 Markdown 表格生成 8K 甘特图 PNG；Node (Chrome DevTools Protocol) 从 H5 HTML 页面截图导出。

**无前端框架、无构建工具、无 TypeScript**。

## 代码架构

### MDM 平台 (`mdm-platform/`)

```
mdm-platform/
├── server/
│   ├── index.js           # Express 入口，动态注册路由
│   ├── db.js              # SQLite 建表 (V1 核心 + MDM v2 领域 12 表)
│   ├── auth.js            # 会话认证 + 角色鉴权 + 内部ID安全中间件
│   ├── access.js           # 行级可见性过滤 (mapping)
│   ├── integrationAuth.js  # API Key 认证中间件 (外部系统集成)
│   ├── codeEngine.js       # 分段流水编码引擎 (entity_type + scope_key)
│   └── routes/            # 22 个路由模块
│       ├── org.js         # 部门、用户、登录
│       ├── systems.js     # 应用系统清单
│       ├── capabilities.js # 业务能力 (L1/L2/L3)
│       ├── processes.js   # 业务流程
│       ├── mappings.js    # 流程→系统映射 + 审批流状态机
│       ├── fieldEntries.js # 字段台账
│       ├── fieldIdentities.js # 字段黄金源身份确认
│       ├── conflicts.js   # 跨部门字段/术语冲突检测
│       ├── terminology.js # 术语词典 + 审核流
│       ├── todos.js       # 跨部门待办
│       ├── versions.js    # 版本历史查询
│       ├── import.js      # Excel 导入
│       ├── export.js      # Excel 导出 (台账/黄金源矩阵/冲突)
│       ├── orgUnit.js     # MDM 组织单元 CRUD
│       ├── position.js    # MDM 岗位 CRUD
│       ├── person.js      # MDM 人员 CRUD + 任岗
│       ├── productFamily.js # MDM 产品族 CRUD
│       ├── product.js     # MDM 产品 CRUD + 生命周期
│       ├── classNode.js   # MDM 分类树 + 实体分类
│       ├── attribute.js   # MDM 属性定义 + 属性值
│       ├── external.js    # MDM 外部系统 + 标识映射
│       ├── integration.js # MDM 集成 API
│       └── quality.js     # MDM 数据质量仪表盘
├── public/
│   └── index.html         # 单文件前端 UI (Tab 导航 + ECharts 仪表盘)
├── scripts/               # init-db, smoke-test, 各路由测试脚本
└── data/
    └── platform.db       # SQLite 数据文件 (运行后生成)
```

**后端模式**：每个路由文件都是相同的模式 — `express.Router()` + `db` + `requireAuth` 中间件 + `handleDbError` 错误处理 wrapper。路由在 `index.js` 通过 `registerRouteIfExists()` 动态注册。

**审批流状态机** (`mappings.status`)：`draft → submitted → dept_reviewed → cross_confirmed → fields_confirmed → final_reviewed → published`，每个步骤在 `approval_tasks` 表中有对应记录，`approval_history` 记录完整审计轨迹。

**数据库设计要点**：外键约束开启 (`foreign_keys = ON`)，SCD Type 2 时间变体字段 (`effective_from/to`)，变更集 + 版本日志 (`change_set` + `version_log`)，CHECK 约束做枚举校验。

### 甘特图系统

- `output/digital_project_gantt_8k.md` — Markdown 格式的任务数据源
- `scripts/generate_digital_project_gantt_8k.py` — 读取 MD 表格，用 PIL 绘制 7680×4320 PNG
- `scripts/render_gantt_h5_png.mjs` — 用 headless Chrome DevTools Protocol 将 H5 HTML 渲染为同尺寸 PNG
- 多个 HTML 变体对应不同视图（基础版、PLM 子泳道版）

## 数据模型核心关系

```
departments → users (组织架构 + 用户)
capabilities (L1/L2/L3) → processes → mappings → systems (映射链)
mappings → field_entries → field_identities (字段台账 + 黄金源)
mappings → approval_tasks → approval_history (审批流)
terms → term_conflicts (术语管理)
field_entries → field_conflicts (字段冲突)
mappings → todos (跨部门待办)
```

## 关键约束

- 前端无模块化，mdm-platform UI 同样是一个 HTML 文件中的原生 JS
- 无自动化测试框架，测试靠 scripts/ 下的手动调 API 脚本
- V1 自建用户体系，不接 OA / 统一认证
- SQLite 是本地文件数据库，不适用于多进程并发部署
- 根目录 `package.json` 是旧的占位文件；实际项目级依赖在 `mdm-platform/package.json`

## MDM v2 领域数据模型 (2026-05-18)

基于首期 MDM 数据模型设计完全重建，12 张领域专用表替代旧通用 EAV 模式。

### 新增路由
| 路由前缀 | 模块文件 | 功能 |
|----------|----------|------|
| `/api/org-units` | `orgUnit.js` | 组织单元 CRUD、激活、树形层级 |
| `/api/positions` | `position.js` | 岗位 CRUD、编码基于归属组织 |
| `/api/persons` | `person.js` | 人员 CRUD、任岗关系管理 |
| `/api/product-families` | `productFamily.js` | 产品族/型号根 CRUD |
| `/api/products` | `product.js` | 版本化产品 CRUD、发布/废止生命周期 |
| `/api/class-nodes` | `classNode.js` | 分类树 CRUD、实体分类关联 |
| `/api/attributes` | `attribute.js` | 属性定义 + 强类型属性值批量 upsert |
| `/api/external` | `external.js` | 外部系统注册 + 标识映射 (external_key 权限隔离) |
| `/api/integration` | `integration.js` | 集成 API (API Key 鉴权)、外部标识同步 |
| `/api/quality` | `quality.js` | 数据质量仪表盘 (组织/人员/产品统计) |

### 新增数据表 (12 张)
**组织/人员域:** org_unit, position, person, person_position_assignment
**产品域:** product_family, product, class_node, entity_class_membership
**扩展:** attribute_def, attribute_value
**集成:** external_system, external_identity
**辅助:** code_sequences (编码流水)

### 编码引擎
`server/codeEngine.js` — 按 entity_type + scope_key 分段流水生成编码：
- OrgUnit: `OU-{type_code}-{mnemonic}-{seq}`
- Position: `POS-{org_mnemonic}-{pos_mnemonic}-{seq}`
- Person: `EMP-{seq}`
- ProductFamily: `PF-{model_code}-{class_major}-{seq}`
- Product: `PRD-{model_code}-{class_major}-{class_mid}-{class_minor}-{seq}`

### 安全中间件
- `auth.js` 新增 `stripInternalIds` — 非 admin 用户接口响应自动剥离内部 ID 字段
- `auth.js` 新增 `isAdmin()` 辅助函数
- `external_identity.external_key` 仅 admin 和集成账号可见

### 新增前端 Tab
组织架构、人员管理、产品主数据、数据质量

### 冒烟测试
```bash
node scripts/smoke-master-data.js   # 13 用例：组织/人员/产品 CRUD、编码生成、生命周期
node scripts/smoke-integration.js    # 7 用例：API Key 认证、外部标识同步、权限隔离
```
