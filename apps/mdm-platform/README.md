# MDM 平台

## 先读这份

如果你想知道平台现在到底能做什么、每个角色应该怎么用，请先看：

- [MDM 平台角色化使用手册](docs/role-based-usage-guide.md)

这份手册按角色、页面、流程和当前限制说明现有能力，比下面的模块清单更适合开发者走读和演示。

## 边界和入口

`apps/mdm-platform/` 只负责 MDM 平台应用本身：Express 路由、MySQL 目标 schema、单文件前端、应用内脚本和平台使用说明。

不在本目录维护流程原始真源、PMO 驾驶舱或仓库级数据转换脚本：

- 流程真源：`docs/norms/{部门}部门-能力-流程-系统映射关系.md`
- 组织真源：`docs/organization/组织架构和部门职责.md`
- PMO 展示：`pmo/procedure-management/dashboard.html`
- 仓库级脚本：根目录 `scripts/`

开发 MDM 代码前先读 [AGENTS.md](AGENTS.md)。执行、调整或新增应用内脚本前先读 [scripts/README.md](scripts/README.md)。

## 快速启动

全新 clone 或另一台设备拉取后，使用 MySQL 配置和初始化脚本从仓库真源重建平台基线；不要复制或提交本地运行态数据库。

```powershell
cd apps/mdm-platform
npm install
$env:MYSQL_HOST="127.0.0.1"
$env:MYSQL_PORT="3306"
$env:MYSQL_USER="mdm_user"
$env:MYSQL_PASSWORD="your-mysql-password"
$env:MYSQL_DATABASE="infomat_mdm"
$env:MDM_ADMIN_EMPLOYEE_NO="your-admin-no"
$env:MDM_ADMIN_PASSWORD="your-long-random-password"
$env:ALLOW_INSECURE_SESSION_SECRET="1"
npm run init:mysql
npm run setup:local-baseline
npm run smoke
npm start
```

访问 `http://localhost:3000`。

平台不会创建默认管理员。首次初始化前请通过环境变量提供管理员工号和不少于 12 位的初始密码；脚本不会在仓库中保存密码、Cookie 或本地数据库。

`npm run init:mysql` 会初始化 MySQL schema 中已迁移的身份/RBAC、候选复核和流程治理读模型表。`npm run setup:local-baseline` 仍是迁移过渡期的幂等基线入口，会：

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
- 数据报送：表单录入 + Excel 批量导入
- 审批流：提交 -> 部门内审 -> 跨部门确认 -> 字段台账确认 -> 终审
- 跨部门待办：给其他部门派发待办
- 冲突管理：字段冲突 + 术语冲突，severity 分级
- 术语词典：术语维护 + 审批流
- 版本记录：映射和字段台账的关键修改历史
- Excel 导入：字段台账模板上传，按角色执行列级权限
- Excel 导出：字段台账 + 黄金源矩阵 + 术语冲突台账

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
npm run test:role-workbench-mysql
npm run init:mysql
npm run import:process-candidate-review -- --candidate-run artifacts/process-candidates/<run-id>
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
- `MDM_IDENTITY_READ_MODEL=mysql` 目前切换登录、`/api/org/session`、`/api/org/me`、本人密码状态、本人改密、管理员用户/部门/权限读写接口、`/api/roles` 角色读写接口、通用 `requirePermission` 权限中间件，以及角色工作台的当前用户、角色、部门和权限读取。业务内直接同步调用 `getUserEffectivePermissions()` 的检查和角色工作台流程待办数据层仍在后续迁移中。
- 候选映射复核正式入口为 `/api/process-governance/candidate-review/*`；候选运行通过 `npm run import:process-candidate-review -- --candidate-run artifacts/process-candidates/<run-id>` 导入 MySQL。
- `npm run test:mainline` 用于验证“流程治理 -> 字段台账 -> 主数据对象 -> 权限 -> 导入导出”主线，详见 `docs/plans/流程治理字段台账主线稳定性检查.md`。
- 不直接运行会删除共享数据库的旧式测试逻辑。
- `seed-demo-data.js` 和 `setup-mdm-project-users.js` 需要显式环境变量才可运行。

流程治理口径：

- 组织真源为 `docs/organization/组织架构和部门职责.md`。
- 流程真源为 `docs/norms/{部门}部门-能力-流程-系统映射关系.md`。
- 快照来源为 `docs/company-sankey-data.json`。
- PMO 静态驾驶舱仍通过 parser 和内嵌快照运行。
