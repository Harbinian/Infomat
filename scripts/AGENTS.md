# AGENTS.md - 仓库级脚本

本文件约束 `scripts/` 下的仓库级自动化。根目录 `AGENTS.md`、`CODEX.md`、`REPOSITORY_BOUNDARY.md` 和 `DIRECTORY_OWNERSHIP.md` 仍然优先适用。

## 适用边界

- `scripts/` 放跨 `docs/`、`pmo/`、`apps/mdm-platform/` 的解析、生成、注入、校验和固定启动脚本。
- 只服务 MDM 平台的脚本留在 `apps/mdm-platform/scripts/`。
- 只服务 PMO 前端或插件的脚本留在 `pmo/`、`pmo/scripts/` 或对应应用目录。
- 本目录不放一次性调查脚本、日志、截图、数据库、缓存或运行输出。

## 脚本分类

- 只读校验脚本应保持只读；临时夹具和测试输出写入系统临时目录或被忽略的 `artifacts/`。
- 生成和注入脚本须声明输入资格、输出和消费者；旧 `docs/` 输入仅为历史展示或兼容，不决定当前治理。`parse-sankey-data.mjs` 要求 `--legacy-display --domain-map --out`，只有显式 `--dashboard` 才注入该 HTML，不默认回写保留快照或 PMO 页面。
- 固定启动脚本可以操作本机运行态或 Docker 容器，但不得顺手修改业务真源。
- 同步和导入脚本如果会写数据库，必须通过显式环境变量、参数或固定配置声明目标库。

## 新增或修改脚本要求

- 在脚本头部或 `scripts/README.md` 写清命令、输入、输出/副作用、是否写文件、是否写数据库和验证命令。
- 修改解析器或生成器前，先确认当前依据、所选输入的资格、派生文件和下游消费者；不能把技术合同或历史副本升为业务真源。
- 本机密码只放 `scripts/infomat-services.local.env`；固定非敏感配置放 `scripts/infomat-services.config.json`。
- 命令、输出文件或运行前置条件变化时，同步承载该信息的 `scripts/README.md` 或目录说明；目录职责、硬规则改变时才同步入口。

## 验证口径

按变化选择检查，默认从仓库根执行。测试工具不随 Git 分发，先核对本机 `.local-tests/commands.json`、脚本和依赖；缺失时按 `CODEX.md` 核对受影响合同并记录未执行项。已通过且未受新改动影响的检查不重复。

| 变化 | 检查与边界 |
|---|---|
| Codex 入口、注册或路由 | 本机 `node scripts/test-codex-context.mjs` 与 `node scripts/check-codex-context.mjs`；不启动服务、不连库 |
| 历史展示解析或注入 | `node scripts/check-dashboard-data.mjs` 及本机纯解析合同；隔离输出，不重造保留快照 |
| PMO 任务生成链 | 获准更新对应输入后运行 `npm run build:pmo-task-data`，再运行 `node scripts/check-pmo-task-data.mjs` 核对六份派生输出 |
| 固定启动配置 | 本机 `node scripts/test-infomat-services-config.mjs`；只检查配置，不启动服务 |
| 指定服务运行 | 核对该对象的监听、健康与内容；共同开发环境的冒烟工具为本机 `scripts/smoke-infomat-services.mjs`，不扩大单服务任务范围 |
| MDM 导入或治理链 | 进入主责应用选取隔离专项；本机聚合 `scripts/test-process-governance-mainline.mjs` 会创建夹具、隔离数据库和临时 HTTP，不是全程只读 |

历史正文或指纹比较使用显式 `--legacy-source-comparison`；副本变化导致失败时核对版本和输入，不以重生成保留快照掩盖差异。技术检查不证明目标已开启或业务已验收。
