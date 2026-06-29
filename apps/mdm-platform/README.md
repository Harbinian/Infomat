# MDM 平台

## 先读这份

如果你想知道平台现在到底能做什么、每个角色应该怎么用，请先看：

- [MDM 平台角色化使用手册](docs/role-based-usage-guide.md)

这份手册按角色、页面、流程和当前限制说明现有能力，比下面的模块清单更适合开发者走读和演示。

## 边界和入口

`apps/mdm-platform/` 只负责 MDM 平台应用本身：Express 路由、MySQL 目标 schema、单文件前端、应用内脚本和平台使用说明。

不在本目录维护流程原始真源、PMO 驾驶舱或仓库级数据转换脚本：

- 流程输入基线：`docs/norms/{部门}部门-能力-流程-系统映射关系.md`
- 组织真源：`docs/organization/组织架构和部门职责.md`
- PMO 展示：`pmo/procedure-management/dashboard.html`
- 仓库级脚本：根目录 `scripts/`

开发 MDM 代码前先读 [AGENTS.md](AGENTS.md)。执行、调整或新增应用内脚本前先读 [scripts/README.md](scripts/README.md)。

## 快速启动

MDM 和 PMO 从仓库根目录使用固定入口启动。固定入口会统一写入 MDM 端口、PMO 端口、MySQL 端口、MySQL 用户、数据库名和 MySQL 读模型。

```powershell
cd E:\CA001\Infomat
npm run start:infomat-services
npm run smoke:infomat-services
```

访问 `http://localhost:3000`。

固定配置在 `scripts/infomat-services.config.json`：

| 项 | 固定值 |
|---|---|
| MDM | `127.0.0.1:3000` |
| PMO | 本机访问 `127.0.0.1:5173`，服务监听 `0.0.0.0:5173` |
| MySQL | `localhost:3307` |
| MySQL 用户 / 库 | `mdm_user` / `infomat_mdm` |
| MySQL 连接池 | `MYSQL_CONNECTION_LIMIT=16` |
| 读模型 | `MDM_IDENTITY_READ_MODEL=mysql`、`PROCESS_GOVERNANCE_READ_MODEL=mysql` |
| 管理员工号 | `ADMIN001` |

本机密码放在仓库根目录的 `scripts/infomat-services.local.env`，该文件只保留在本机：

```text
MYSQL_PASSWORD=你的项目 MySQL 密码
MDM_ADMIN_PASSWORD=你的管理员密码
```

平台不会自动创建新的默认管理员。当前固定管理员账号是 `ADMIN001`，密码来自本机私有 env 文件。脚本不会在仓库中保存密码、Cookie 或本地数据库。

全新 clone 或另一台设备拉取后，如需重建 MySQL schema 和平台基线，先确认固定 MySQL 容器和 `scripts/infomat-services.local.env` 已准备好，再在 `apps/mdm-platform/` 下执行：

```powershell
cd E:\CA001\Infomat
$localEnv = Get-Content scripts\infomat-services.local.env
$env:MYSQL_PASSWORD = ($localEnv | Where-Object { $_ -like 'MYSQL_PASSWORD=*' }).Split('=',2)[1]
$env:MDM_ADMIN_PASSWORD = ($localEnv | Where-Object { $_ -like 'MDM_ADMIN_PASSWORD=*' }).Split('=',2)[1]
$env:MYSQL_HOST = "localhost"
$env:MYSQL_PORT = "3307"
$env:MYSQL_USER = "mdm_user"
$env:MYSQL_DATABASE = "infomat_mdm"
$env:MYSQL_CONNECTION_LIMIT = "16"
$env:MDM_IDENTITY_READ_MODEL = "mysql"
$env:PROCESS_GOVERNANCE_READ_MODEL = "mysql"
$env:MDM_ADMIN_EMPLOYEE_NO = "ADMIN001"
cd apps\mdm-platform
npm install
npm run init:mysql
npm run setup:local-baseline
```

`npm run init:mysql` 会初始化 MySQL schema 中已迁移的身份/RBAC、输入基线问题复核、流程治理读模型、数据地图字段域、术语治理、旧映射审批、冲突治理、通用待办和平台通用审计表。`npm run setup:local-baseline` 仍是迁移过渡期的幂等基线入口，会：

- 初始化遗留本地 schema 和系统角色/权限。
- 从 `docs/organization/组织架构和部门职责.md` 同步组织架构、领导岗位和对应人员。
- 仅为 `MDM_ADMIN_EMPLOYEE_NO` 指定的管理员创建/补齐 `admin` RBAC 角色。

默认基线不导入花名册账号或项目账号，避免把本机登录账号状态当成仓库真源。确需导入花名册用户时，先确认口令策略和数据边界，再单独运行对应导入脚本。

迁移完成前，如需运行仍依赖遗留本地库的测试，可通过隔离路径避免写默认运行态文件：

```powershell
$env:MDM_DB_PATH="$env:TEMP\mdm-platform-baseline.db"
```

## 功能模块

- 统计看板：各部门提交流程数、待办数、冲突数、字段台账完成率
- 数据地图：按上下文维护字段台账、字段定义、系统关系和黄金源
- 数据报送：表单录入 + Excel 批量导入
- 审批流：提交 -> 部门内审 -> 跨部门确认 -> 字段台账确认 -> 终审
- 跨部门待办：给其他部门派发待办
- 冲突管理：字段冲突 + 术语冲突，severity 分级
- 术语词典：术语维护 + 审批流
- 版本记录：映射和字段台账的关键修改历史
- Excel 导入：字段台账模板上传，按 Data Map context 入库
- Excel 导出：字段台账 + 黄金源矩阵

## 技术栈

- 前端：单文件 HTML（原生 JS + CSS，参考演示文件视觉风格）
- 后端：Express.js + MySQL（迁移过渡期仍有遗留 SQLite 代码待替换）
- 认证：bcryptjs + express-session
- 导入/导出：multer + exceljs

## 常用命令

```bash
npm run init-db
npm run smoke
npm run test:org
npm run test:catalog
npm run test:mappings
npm run test:conflicts
npm run test:terms
npm run test:export
npm run test:import
npm run test:user-password-scripts
npm run test:password-audit
npm run test:frontend
npm run test:local-baseline
npm run test:security
npm run test:mainline
npm run test:mysql-config
npm run test:identity-mysql
npm run test:data-map-mysql
npm run test:field-entries-mysql
npm run test:field-identities-mysql
npm run test:data-map-import-export-mysql
npm run test:terminology-mysql
npm run test:mappings-mysql
npm run test:conflicts-mysql
npm run test:todos-mysql
npm run test:versions-mysql
npm run test:activity-mysql
npm run test:role-workbench-mysql
npm run init:mysql
npm run smoke:data-map-mysql
npm run import:process-input-baseline-review -- --review-run artifacts/process-input-baseline-review/<run-id>
```

`npm run test:security` 已包含批量用户脚本口令红线：项目账号脚本和 Excel 用户导入脚本不得硬编码固定初始密码，新建账号必须标记首次登录改密。

如需只读检查历史库中是否仍有旧固定口令账号，可运行：

```bash
node scripts/audit-fixed-default-passwords.js
```

该脚本只做 dry-run 审计，不改密码、不输出密码哈希。

## MDM 一期升级命令

流程治理升级链路：

```bash
npm run test:mainline
npm run test:db-path
npm run test:process-governance
npm run sync:process-org
npm run import:process-governance
npm run check:process-governance
```

数据库安全约定：

- MySQL 连接统一使用 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`MYSQL_CONNECTION_LIMIT`。
- 旧 SQLite `platform.db` 不迁移；MySQL 通过组织真源、流程快照和基线脚本重建。
- 迁移过渡期仍依赖遗留本地库的测试，必须通过隔离路径运行，不能污染共享运行态文件。
- 数据地图字段域已直接切换到 MySQL：`/api/data-map/contexts`、`/api/field-entries/*`、`/api/field-identities/*`、字段导入、字段导出和黄金源质量进度都通过 Data Map MySQL repository 访问；`context_id` 是公开主键，`mapping_id` 只作为短期兼容别名。
- 术语治理已切换到 MySQL：`/api/terminology` 和 `/api/terminology/types` 通过 `terminologyMysqlRepository` 访问独立 `terminology_*` 表；`/api/terminology/processes` 使用流程治理 MySQL 读模型 `process_mapping_records` 作为流程选择来源，不再读取 SQLite `terms`。
- 旧映射审批已切换到 MySQL：`/api/mappings` 通过 `mappingMysqlRepository` 访问 `mdm_mapping_*` 表，保留旧审批 API 形状；字段台账仍以 Data Map context 为正式归属，映射详情不再读取 SQLite `field_entries`、`field_identities`、`terms`、`change_set` 或 `version_log`。
- 冲突治理和通用待办已切换到 MySQL：`/api/conflicts` 通过 `conflictMysqlRepository` 访问 `mdm_field_conflicts`、`mdm_term_conflicts`、`mdm_conflict_*` 和 `mdm_todos`；字段冲突检测读取 Data Map 字段域，术语冲突检测读取 `terminology_terms`。`/api/todos` 通过 `todoMysqlRepository` 访问 `mdm_todos` 和 `mdm_todo_events`，不再混用 SQLite 写入和 MySQL 读取。
- 平台通用版本和活动热力图已切换到 MySQL：`/api/versions` 通过 `auditMysqlRepository` 访问 `mdm_change_sets` 和 `mdm_version_log`；`/api/activity/heatmap` 从流程治理事件、映射审批历史、版本记录、术语、冲突和通用待办 MySQL 表汇总，不再读取 SQLite `change_set`、`version_log`、`terms`、`term_conflicts`、`field_conflicts` 或 `todos`。
- `MDM_IDENTITY_READ_MODEL=mysql` 目前切换登录、`/api/org/session`、`/api/org/me`、本人密码状态、本人改密、管理员用户/部门/权限读写接口、`/api/roles` 角色读写接口、通用 `requirePermission` 权限中间件、角色工作台身份读取、流程治理 MySQL 分支权限判断、治理活跃热力图管理视图权限判断、字段台账查看/创建/维护中的身份权限判断，以及字段黄金源维护/确认中的身份权限判断。`auth.js` / `access.js` 已提供 MySQL-aware 异步权限、角色码、用户和部门读取 helper；后续业务路由接入时应优先复用这些 helper。
- `/api/import-rbac/*` 批量写入仍是遗留本地库实现；在 `MDM_IDENTITY_READ_MODEL=mysql` 下会显式拒绝，直到对应导入写入链路迁到 MySQL。
- 输入基线问题复核正式入口为 `/api/process-governance/input-baseline-review/*`；问题识别批次通过 `npm run import:process-input-baseline-review -- --review-run artifacts/process-input-baseline-review/<run-id>` 导入 MySQL。
- `npm run test:mainline` 用于验证“流程治理 -> 字段台账 -> 主数据对象 -> 权限 -> 导入导出”主线，详见 `docs/plans/流程治理字段台账主线稳定性检查.md`。
- 不直接运行会删除共享数据库的旧式测试逻辑。
- `seed-demo-data.js` 和 `setup-mdm-project-users.js` 需要显式环境变量才可运行。

流程治理口径：

- 组织真源为 `docs/organization/组织架构和部门职责.md`。
- 流程输入基线为 `docs/norms/{部门}部门-能力-流程-系统映射关系.md`。
- 快照来源为 `docs/company-sankey-data.json`。
- PMO 静态驾驶舱仍通过 parser 和内嵌快照运行。
