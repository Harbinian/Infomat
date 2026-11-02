# CLAUDE.md

本文件是 Claude Code 的仓库操作入口。当前阶段、授权边界和全仓规则以 [AGENTS.md](AGENTS.md) 为准；进入主责目录后读取其局部入口。全部局部入口只在 [DIRECTORY_OWNERSHIP.md](DIRECTORY_OWNERSHIP.md) 的注册块维护。

## 开发基线

当前重点是 3000 内的单流程编制、显式保存草稿、提交、核对、退回续修及审核发布，前后端通过 API 分离。用户可下载 JSON，在知识库 AI 对话中编辑后导回；导回内容不继承审核状态。本轮限本地及隔离验证，3001 保留独立、无状态和人工文件交接兼容。

3000 是组织与员工信息的唯一维护源，由行政人事维护；Excel 仅作明确导入材料。业务事实和职责来自用户指定的外部原始材料、实际业务说明和明确确认。`docs/` 中的技术合同、资料副本和历史记录不作为业务真源或治理依据。

开发时先核对 Git 状态并保留已有工作；不擅自暂存、提交、推送或清理历史资产。Secret 只核对配置路径和使用入口，不读取或输出内容。正式数据库、部署、权限、迁移和真实通知按目标及已有授权处理。

## 按任务定位

| 任务 | 当前维护入口 |
|---|---|
| 跨资产实施、排障、兼容升级和验证选择 | [CODEX.md](CODEX.md) |
| 目录职责、生成物和历史资产 | [目录职责](DIRECTORY_OWNERSHIP.md)、[仓库边界](REPOSITORY_BOUNDARY.md) |
| 应用与脚本的消费关系 | [MAINLINE_MAP.md](MAINLINE_MAP.md) |
| 3000 功能、身份授权、格式与兼容 | [平台入口](apps/mdm-platform/AGENTS.md)、[平台说明](apps/mdm-platform/README.md) |
| 3000 内编制、草稿保存与 JSON 往返 | [编制合同](apps/mdm-platform/PROCESS_AUTHORING.md) |
| 3000 构建、目标状态与恢复 | [Docker 说明](apps/mdm-platform/DOCKER.md)、[平台脚本说明](apps/mdm-platform/scripts/README.md) |
| 3001 独立工具、文件兼容与工作台 | [应用入口](apps/structured-output-service/AGENTS.md)、[应用说明](apps/structured-output-service/README.md) |
| PMO 来源、任务增补、生成与页面 | [PMO 入口](pmo/AGENTS.md)、[前端说明](pmo/gantt-react/README.md) |
| 其他应用 | [应用目录](apps/README.md) |
| 仓库级生成、运行及兼容脚本 | [scripts/README.md](scripts/README.md) |
| 工程技能配置 | 本文件下方的 Agent skills |

应用格式、角色数量、权限、开关和部署记录由对应入口维护，不在此复制版本清单。`process-v7` 等历史机器名称不代表正文格式；核对文件实际版本与应用支持策略。

## 常用本地命令

以下命令从仓库根目录执行。构建写入指定的全新 `artifacts/` 目录；目录名按本次任务选择，避免覆盖正在使用的构建。

```powershell
# 3000：独立候选前端构建，不覆盖 frontend/dist
npm --prefix apps/mdm-platform/frontend run build -- --outDir ../../../artifacts/mdm-frontend-candidate

# PMO：只读核对现有来源、生成结果及消费副本
node scripts/check-pmo-task-data.mjs
```

3001 工作台构建、候选端口及健康合同见其 README；该构建会写入受控的 `public/workbench/`，不作为全仓检查的默认步骤。仅维护一个应用时使用其专用入口；组合启动、数据库修复和迁移有独立副作用，按脚本说明及目标授权执行。

## 验证与交付

测试脚本及夹具仅保留在维护者本机，不随 Git 分发；本机原命令清单在仓库根 `.local-tests/commands.json`。先核对所选脚本、依赖及隔离条件，再直接调用实际存在的工具；清单中的历史命令不表示当前 `package.json` 已注册对应 npm 入口。新检出缺少工具时记录未执行项，不能把空占位内容当作验证步骤。

按影响面验证。纯说明核对事实、状态、命令、引用和差异，不启动应用或连接数据库。界面仅支持 Microsoft Edge、100% 缩放、1699×828 CSS 像素内容可视区；禁止窄屏适配和测试。浏览器验证使用明确的隔离候选地址，不指向正式 3000/3001。

报告区分“已实现”“已准备”“已开启”和“已验收”。候选代码、自动化、隔离测试和软件部署不能替代实时运行证据、人工体验或业务验收。

## Agent skills

### Issue tracker

工程问题和实施规格记录在 GitHub Issues：`Harbinian/Infomat`。见[工程问题跟踪配置](docs/agents/issue-tracker.md)；外部写入仍须有相应授权。

### Domain docs

采用 `single-context` 布局，复用根 `CONTEXT.md`、`docs/glossary.md` 和 `docs/adr/`。见[领域文档使用规则](docs/agents/domain.md)。这些文件用于技术语言及决策追溯，不取代业务确认。
