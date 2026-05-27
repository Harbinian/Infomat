# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Infomat 是航空复材制造领域的业务关系映射与主数据管理工具集。

**重要参考文件：**
- `docs/glossary.md` — 项目术语表，覆盖业务域/主数据域/体系文件域/技术域/供应链协同域 ~180 条术语定义。开发时遇到不熟悉的术语优先查阅此文件。

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
npm test:security          # 安全中间件测试
npm test:views             # 视图/桑基图过滤测试
npm test:frontend          # 前端静态资源测试
npm test:rbac              # RBAC 权限系统冒烟测试
npm test:delete            # 删除端点全覆盖测试
```

手动冒烟脚本（需要先 `npm start`）：

```bash
node scripts/smoke-master-data.js   # 组织/人员/产品 CRUD、编码生成、生命周期
node scripts/smoke-integration.js    # API Key 认证、外部标识同步、权限隔离
node scripts/smoke-rbac.js           # 角色 CRUD、权限分配、继承链、字段约束
node scripts/seed-demo-data.js       # 填充演示数据
node scripts/import-mdm-users.js     # 从外部文件批量导入用户
```

### Gantt 渲染

```bash
python scripts/generate_digital_project_gantt_8k.py   # MD 数据 → 8K PNG (PIL)
node scripts/render_gantt_h5_png.mjs                    # H5 HTML → 8K PNG (headless Chrome)
```

### 独立 HTML 文件

`digital_project_gantt_H5.html`、`gantt.html` 等直接在浏览器打开即可使用，无构建步骤。

## 技术栈

**MDM 平台**：Express.js + better-sqlite3 (SQLite) + 原生 HTML/CSS/JS 前端 (ECharts)。后端 `express-session` 做会话管理，`bcryptjs` 做密码哈希，`exceljs` + `multer` + `csv-parse` 做 Excel/CSV 导入导出。

**Gantt 渲染**：Python (Pillow) 从 Markdown 表格生成 8K 甘特图 PNG；Node (Chrome DevTools Protocol) 从 H5 HTML 页面截图导出。

**无前端框架、无构建工具、无 TypeScript**。

## 代码架构

### MDM 平台 (`mdm-platform/`)

```
mdm-platform/
├── server/
│   ├── index.js           # Express 入口，动态注册路由
│   ├── db.js              # SQLite 建表 + 内联迁移 + RBAC 种子数据
│   ├── auth.js            # 会话认证 + 角色鉴权 + RBAC 权限引擎 + 字段约束
│   ├── access.js           # 行级可见性过滤 (mapping)
│   ├── integrationAuth.js  # API Key 认证中间件 (外部系统集成)
│   ├── codeEngine.js       # 分段流水编码引擎 (entity_type + scope_key)
│   └── routes/            # 26 个路由模块
│       ├── org.js         # 部门、用户、登录
│       ├── systems.js     # 应用系统清单
│       ├── capabilities.js # 能力域（L1）/ 业务能力（L2）/ 业务流程（L3）
│       ├── processes.js   # 业务流程
│       ├── mappings.js    # 流程→系统映射 + 审批流状态机
│       ├── fieldEntries.js # 字段台账
│       ├── fieldIdentities.js # 字段黄金源身份确认
│       ├── conflicts.js   # 跨部门字段/术语冲突检测
│       ├── terminology.js # 术语词典 + 审核流
│       ├── todos.js       # 跨部门待办
│       ├── versions.js    # 版本历史查询
│       ├── import.js      # Excel 导入 (业务数据)
│       ├── importRbac.js  # RBAC 批量导入 (用户角色/权限) + 模板下载
│       ├── export.js      # Excel 导出 (台账/黄金源矩阵/冲突)
│       ├── roles.js       # 角色 CRUD + 权限矩阵 + 用户分配
│       ├── orgUnit.js     # 组织单元 CRUD + 激活 + 树形层级
│       ├── position.js    # 岗位 CRUD + 编码基于归属组织
│       ├── person.js      # 人员 CRUD + 任岗关系管理
│       ├── productFamily.js # 产品族/型号根 CRUD
│       ├── product.js     # 版本化产品 CRUD + 发布/废止生命周期
│       ├── classNode.js   # 分类树 CRUD + 实体分类关联
│       ├── attribute.js   # 属性定义 + 强类型属性值批量 upsert
│       ├── external.js    # 外部系统注册 + 标识映射 (external_key 权限隔离)
│       ├── integration.js # 集成 API (API Key 鉴权)
│       ├── quality.js     # 数据质量仪表盘
│       └── views.js       # [只读] 桑基图数据 + 流程详情汇总
├── public/
│   └── index.html         # 单文件前端 UI (Tab 导航，覆盖仪表盘、业务目录、映射、主数据、RBAC 管理等功能域)
├── scripts/               # init-db, smoke-test, 20 个路由测试脚本
└── data/
    └── platform.db       # SQLite 数据文件 (运行后生成)
```

**路由模式**：每个路由文件使用相同模式 — `express.Router()` + `db` + `requireAuth` 中间件 + `handleDbError`/`runDbAction` 错误处理。路由在 `index.js` 通过 `registerRouteIfExists()` 动态注册。

**审批流状态机** (`mappings.status`)：`draft → submitted → dept_reviewed → cross_confirmed → fields_confirmed → final_reviewed → published`，每个步骤在 `approval_tasks` 表中有对应记录，`approval_history` 记录完整审计轨迹。

**数据库设计要点**：外键约束开启 (`foreign_keys = ON`)，SCD Type 2 时间变体字段 (`effective_from/to`)，变更集 + 版本日志 (`change_set` + `version_log`)，CHECK 约束做枚举校验。数据库迁移通过 `db.js` 中的条件 DDL 内联处理，无独立迁移框架。

### 甘特图系统

- `output/digital_project_gantt_8k.md` — Markdown 格式的任务数据源
- `scripts/generate_digital_project_gantt_8k.py` — 读取 MD 表格，用 PIL 绘制 7680×4320 PNG
- `scripts/render_gantt_h5_png.mjs` — 用 headless Chrome DevTools Protocol 将 H5 HTML 渲染为同尺寸 PNG
- 多个 HTML 变体对应不同视图（基础版、PLM 子泳道版）

## 数据模型

### V1 映射域

```
departments → users (组织架构 + 用户)
能力域（L1）/ 业务能力（L2）/ 业务流程（L3）→ processes → mappings → 应用系统（S1）（映射链）
mappings → field_entries → field_identities (字段台账 + 黄金源)
mappings → approval_tasks → approval_history (审批流)
terms → term_conflicts (术语管理)
field_entries → field_conflicts (字段冲突)
mappings → todos (跨部门待办)
```

### MDM v2 主数据域 (12 张表)

**组织/人员:** org_unit → position → person → person_position_assignment
**产品:** product_family → product (版本化生命周期) + class_node → entity_class_membership
**扩展:** attribute_def → attribute_value (强类型值)
**集成:** external_system → external_identity (external_key 权限隔离)
**辅助:** code_sequences (编码流水)

### RBAC 权限域 (4 张表)

```
roles (支持 parent_role_id 自引用继承) → role_permissions ← permissions
user_roles → users
```

## RBAC 权限系统

### 核心概念

- **角色 (roles)**：系统角色 (`is_system=1`，不可删除）和自定义角色；支持 `parent_role_id` 自引用形成继承链
- **权限 (permissions)**：`resource:action` 格式（如 `mapping:approve`），admin 拥有通配 `*:*`
- **角色-权限 (role_permissions)**：多对多，effect 字段为 `allow` 或 `deny`
- **用户-角色 (user_roles)**：多对多，用户通过角色获得权限

### 权限继承与冲突解决

1. 用户直接分配的角色 + 所有祖先角色的权限递归合并
2. `deny` 覆盖 `allow`（role_permissions 按 effect 排序，deny 后处理）
3. `*:*` 通配权限授予一切访问权

### 种子系统角色

| 角色 | 编码 | 说明 |
|------|------|------|
| 管理员 | `admin` | `*:*` 通配，全部权限 |
| 审核员 | `reviewer` | 审核批准、冲突管理/解决、查看看板/映射、待办管理 |
| 业务负责人 | `owner` | 映射 CRUD + 提交、查看看板、待办管理 |
| 报送人 | `submitter` | 映射提交/查看、查看看板 |

权限码格式 `resource:action`，如 `mapping:create`、`review:approve`、`dashboard:view`。完整清单见 `db.js` 种子数据。

### 字段级约束 (Field Constraints)

`role_permissions.field_constraints` 存储 JSON，支持 `exclude` 和 `readonly` 字段列表。`applyFieldConstraints` 中间件在 JSON 序列化前剥离受限字段。

### 关键中间件

- `requirePermission(permCode)` — 检查当前用户是否拥有指定权限（含 `*:*` 通配判断），注入 `req.effectivePermissions` 和 `req.effectiveFieldConstraints`
- `applyFieldConstraints(resourceType)` — 根据生效约束过滤响应 JSON 中的敏感字段
- `getUserEffectivePermissions(userId)` — 递归计算用户最终权限集和字段约束
- `isAdmin(req)` — 判断当前会话是否为 admin

旧 `requireRole()` 中间件仍在部分路由中使用，逐步迁移到 `requirePermission()`。

### RBAC 批量导入 (`/api/import-rbac`)

- `POST /user-roles` — Excel/CSV 批量分配用户角色（工号 + 角色编码 + replace/add 模式）
- `POST /role-permissions` — Excel/CSV 批量定义角色权限（角色编码 + 权限码 + effect）
- `POST /full` — 统一导入：同文件定义角色、权限、用户分配
- `GET /templates/:type` — 下载导入模板 (user-roles / role-permissions / full)

## 编码引擎

`server/codeEngine.js` — 按 entity_type + scope_key 分段流水生成编码：
- OrgUnit: `OU-{type_code}-{mnemonic}-{seq}`
- Position: `POS-{org_mnemonic}-{pos_mnemonic}-{seq}`
- Person: `EMP-{seq}`
- ProductFamily: `PF-{model_code}-{class_major}-{seq}`
- Product: `PRD-{model_code}-{class_major}-{class_mid}-{class_minor}-{seq}`

## 安全中间件

- `auth.js` — `stripInternalIds`：非 admin 用户接口响应自动剥离内部 ID 字段（`org_unit_id`、`position_id` 等）
- `auth.js` — `isAdmin()`：会话级 admin 判断
- `integrationAuth.js` — API Key 认证中间件，用于外部系统集成
- `access.js` — 行级可见性过滤，基于 `mapping_related_departments`

## 关键约束

- 前端无模块化，整个 UI 是 `public/index.html` 一个文件中的原生 JS + ECharts
- 无自动化测试框架，测试靠 `scripts/` 下的手动 HTTP 请求脚本
- V1 自建用户体系（`users` 表 + `express-session`），不接 OA / 统一认证
- RBAC 构建在自建用户体系之上，旧 `requireRole` 和 `users.role` 字段仍存在用于向后兼容
- SQLite 是本地文件数据库，不适用于多进程并发部署
- 数据库迁移通过 `db.js` 中的条件 DDL（`ALTER TABLE IF NOT EXISTS` 模式）内联处理，无独立迁移工具
- 根目录 `package.json` 是旧的占位文件；实际项目级依赖在 `mdm-platform/package.json`
- `external_identity.external_key` 仅 admin 和集成账号可见
