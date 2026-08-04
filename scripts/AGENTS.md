# AGENTS.md - 仓库级脚本

本文件约束 `scripts/` 下的仓库级自动化。根目录 `AGENTS.md`、`CODEX.md`、`REPOSITORY_BOUNDARY.md` 和 `DIRECTORY_OWNERSHIP.md` 仍然优先适用。

## 适用边界

- `scripts/` 放跨 `docs/`、`pmo/`、`apps/mdm-platform/` 的解析、生成、注入、校验和固定启动脚本。
- 只服务 MDM 平台的脚本留在 `apps/mdm-platform/scripts/`。
- 只服务 PMO 前端或插件的脚本留在 `pmo/`、`pmo/scripts/` 或对应应用目录。
- 本目录不放一次性调查脚本、日志、截图、数据库、缓存或运行输出。

## 脚本分类

- 只读校验脚本应保持只读；临时夹具和测试输出写入系统临时目录或被忽略的 `artifacts/`。
- 生成和注入脚本必须声明真源、生成文件和消费者页面，例如 `parse-sankey-data.mjs` 会回写公司级快照和 PMO 驾驶舱。
- 固定启动脚本可以操作本机运行态或 Docker 容器，但不得顺手修改业务真源。
- 同步和导入脚本如果会写数据库，必须通过显式环境变量、参数或固定配置声明目标库。

## 新增或修改脚本要求

- 在脚本头部或 `scripts/README.md` 写清命令、输入、输出/副作用、是否写文件、是否写数据库和验证命令。
- 修改解析器或生成器前，先确认真源文件、派生文件和下游消费页面。
- 本机密码只放 `scripts/infomat-services.local.env`；固定非敏感配置放 `scripts/infomat-services.config.json`。
- 命令、输出文件或运行前置条件变化时，同步更新 `scripts/README.md`、相关目录 README/AGENTS，以及必要的根目录规则。

## 验证口径

以下命令默认从仓库根目录运行；进入子项目运行的命令会单独说明。

流程地图解析或注入变化：

```powershell
node scripts/parse-sankey-data.mjs
node scripts/check-dashboard-data.mjs
npm run test:process-governance-mainline
```

PMO 任务生成链变化：

```powershell
npm run build:pmo-task-data
npm run test:pmo-task-data
```

固定启动配置变化：

```powershell
npm run test:infomat-services-config
npm run smoke:infomat-services
```

MDM 导入、流程治理或数据库写入链路变化时，在 `apps/mdm-platform/` 下补充对应测试；涉及流程治理主线时至少覆盖：

```powershell
npm run test:process-governance
```
