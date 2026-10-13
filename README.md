# Infomat

Infomat 是航空复材制造领域的信息化资料与工具仓库，保存业务资料、可运行应用、PMO 工具和仓库级脚本。

## 当前治理边界

当前工作主线为：用户指定的外部原始材料和业务确认，经 3001 编制单流程，由用户下载未审核 JSON 并手动上传 3000，完成治理、核对和审核后形成正式版本，再据此生成程序文件。具体职责和权限依据业务确认及任命，程序实现不能反向确定业务要求。

所有 `docs/` 文件均不作为业务真源或治理依据；技术说明、校验合同和历史消费关系用于定位实现及兼容边界。当前阶段和全仓硬规则见 [AGENTS.md](AGENTS.md)。

## 仓库级入口

| 任务需要 | 入口及职责 |
|---|---|
| 当前规则和任务路由 | [AGENTS.md](AGENTS.md) |
| 实施、文档维护、兼容和验证方法 | [CODEX.md](CODEX.md) |
| 仓库收纳、生成物和历史资产 | [REPOSITORY_BOUNDARY.md](REPOSITORY_BOUNDARY.md) |
| 目录责任和局部指令注册 | [DIRECTORY_OWNERSHIP.md](DIRECTORY_OWNERSHIP.md) |
| 流程治理、PMO、资料消费和生成关系 | [MAINLINE_MAP.md](MAINLINE_MAP.md) |
| 稳定术语和仓库概念 | [CONTEXT.md](CONTEXT.md) |
| 指令分层、预算和按需读取 | [上下文管理说明](docs/architecture/context-management.md) |

按任务选择相关入口，详细操作和应用规格由主责目录维护。

## 应用和工具入口

| 对象 | 主责入口 | 维护边界 |
|---|---|---|
| MDM 平台（3000） | [应用 README](apps/mdm-platform/README.md) | 身份、数据和流程治理；具体实现、权限、版本与运行门槛按应用入口核对 |
| 单流程编制工具（3001） | [应用 README](apps/structured-output-service/README.md) | 当前页面内存中编制和兼容导入；用户主动下载，不与 3000 自动互写或共享数据库 |
| 信息表收集服务（4000 / 4001） | [应用 README](apps/information-collection-service/README.md) | 只读复用身份数据，收集权限、答卷和附件按应用边界维护 |
| PMO 计划和展示 | [PMO README](pmo/README.md) | 计划维护、任务数据生成和展示；不据展示快照确定当前业务事实 |
| 历史流程地图驾驶舱 | [目录 README](pmo/procedure-management/README.md) | 展示已有内嵌数据；旧消费链更新须显式选择输入、输出及授权范围 |
| 仓库级脚本 | [脚本 README](scripts/README.md) | 查询输入、输出、副作用和验证入口；修改前按该目录指令路由 |

资料、副本、样例和历史记录分别按 [目录责任](DIRECTORY_OWNERSHIP.md) 定位。目录级指令的唯一清单在该文件的注册块，其他入口不复制清单。

## 运行与配置入口

仅操作一个应用或端口时，使用该应用 README 的专用入口并核对目标。3000 的独立运维使用应用的 `service:start|stop|restart|check`；具体前置条件按应用 README 核对。

以下仓库级命令操作 MDM、PMO 和 MySQL 的共同开发环境，任务授权覆盖该组合且前置条件满足时才使用：

```powershell
npm run start:infomat-services
npm run smoke:infomat-services
```

共同开发配置的 MySQL 入口为 `localhost:3307`，非敏感配置在 `scripts/infomat-services.config.json`，本机私有配置路径为 `scripts/infomat-services.local.env`。详细配置和副作用由 [脚本 README](scripts/README.md) 维护。配置描述不代表目标服务当前可用；运行结论须取得对应健康和内容证据。

## 技术合同与验证

文档结构化 v2 证据草稿的技术兼容合同见 [schema](docs/contracts/document-structured-output.schema.json) 和 [合同说明](docs/contracts/document-structured-output-schema.md)。它们说明机器格式，不确认业务事实。修改该合同或消费兼容行为时，按影响运行 `test:document-structured-output-schema` 和 `test:work-role-contract`。

修改项目指令、路由、注册或上下文预算后，从仓库根目录运行：

```powershell
npm run test:codex-context
```

应用改动的验证入口由应用 README、package.json 和测试说明维护；文档改动按受影响的事实、引用和格式检查。技术检查与业务验收分别报告。

## 当前说明与历史追溯

当前文档直接维护有效正文；详细维护方法见 [CODEX.md](CODEX.md)。设计经过、历史决策和阶段记录按需查询 [归档索引](docs/archives/README.md)、[ADR](docs/adr/) 和历史 [MEMORY.md](MEMORY.md)，不作为每次任务的默认阅读内容。仍然有效的要求保留在当前入口。

本轮整理前的仓库级原文及校验清单见 [历史快照索引](docs/archives/2026-10-09-repository-docs/README.md)。历史快照只用于追溯。

生成物、必要样例和已有受控派生文件的边界见 [仓库职责边界](REPOSITORY_BOUNDARY.md)，本入口不扩大纳管范围或改变 ADR 评审状态。
