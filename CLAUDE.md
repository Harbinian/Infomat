# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Infomat 是航空复材制造领域的业务关系映射与主数据管理工具集。当前分支正在建设 MDM 数据收集与评审系统。

## 常用命令

### MDM Collector（主项目）

```bash
cd mdm-collector
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
```

### Gantt 渲染

```bash
python scripts/generate_digital_project_gantt_8k.py   # MD 数据 → 8K PNG (PIL)
node scripts/render_gantt_h5_png.mjs                    # H5 HTML → 8K PNG (headless Chrome)
```

### 独立 HTML 文件

`digital_project_gantt_H5.html`、`gantt.html` 等直接在浏览器打开即可使用，无构建步骤。

## 技术栈

**MDM Collector**：Express.js + better-sqlite3 (SQLite) + 原生 HTML/CSS/JS 前端 (ECharts)。后端 `express-session` 做会话管理，`bcryptjs` 做密码哈希，`exceljs` + `multer` 做 Excel 导入导出。

**Gantt 渲染**：Python (Pillow) 从 Markdown 表格生成 8K 甘特图 PNG；Node (Chrome DevTools Protocol) 从 H5 HTML 页面截图导出。

**无前端框架、无构建工具、无 TypeScript**。

## 代码架构

### MDM Collector (`mdm-collector/`)

```
mdm-collector/
├── server/
│   ├── index.js           # Express 入口，动态注册路由
│   ├── db.js              # SQLite 建表 (20+ 表，SCD Type 2，审计日志)
│   ├── auth.js            # 会话认证 + 角色鉴权中间件
│   └── routes/            # 13 个路由模块，每个暴露 RESTful CRUD
│       ├── org.js         # 部门、用户、岗位
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
│       └── export.js      # Excel 导出 (台账/黄金源矩阵/冲突)
├── public/
│   └── index.html         # 单文件前端 UI (Tab 导航 + ECharts 仪表盘)
├── scripts/               # init-db, smoke-test, 各路由测试脚本
└── data/
    └── collector.db       # SQLite 数据文件 (运行后生成)
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

- 前端无模块化，mdm-collector UI 同样是一个 HTML 文件中的原生 JS
- 无自动化测试框架，测试靠 scripts/ 下的手动调 API 脚本
- V1 自建用户体系，不接 OA / 统一认证
- SQLite 是本地文件数据库，不适用于多进程并发部署
- 根目录 `package.json` 是旧的占位文件；实际项目级依赖在 `mdm-collector/package.json`
