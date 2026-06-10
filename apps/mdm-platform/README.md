# MDM 平台

## 先读这份

如果你想知道平台现在到底能做什么、每个角色应该怎么用，请先看：

- [MDM 平台角色化使用手册](docs/role-based-usage-guide.md)

这份手册按角色、页面、流程和当前限制说明现有能力，比下面的模块清单更适合开发者走读和演示。

## 边界和入口

`apps/mdm-platform/` 只负责 MDM 平台应用本身：Express 路由、SQLite 数据、单文件前端、应用内脚本和平台使用说明。

不在本目录维护流程原始真源、PMO 驾驶舱或仓库级数据转换脚本：

- 流程真源：`docs/norms/{部门}部门-能力-流程-系统映射关系.md`
- 组织真源：`docs/organization/组织架构和部门职责.md`
- PMO 展示：`pmo/procedure-management/dashboard.html`
- 仓库级脚本：根目录 `scripts/`

开发 MDM 代码前先读 [AGENTS.md](AGENTS.md)。执行、调整或新增应用内脚本前先读 [scripts/README.md](scripts/README.md)。

## 快速启动

```bash
cd apps/mdm-platform
npm install
set MDM_ADMIN_EMPLOYEE_NO=your-admin-no
set MDM_ADMIN_PASSWORD=your-long-random-password
npm run init-db
npm run smoke
npm start
```

访问 `http://localhost:3000`。

平台不会创建默认管理员。首次初始化前请通过环境变量提供管理员工号和不少于 12 位的初始密码。

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
- 后端：Express.js + SQLite (better-sqlite3)
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
npm run test:security
npm run test:mainline
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

- 默认数据库仍为 `apps/mdm-platform/data/platform.db`。
- 测试必须通过 `MDM_DB_PATH` 使用隔离 SQLite 文件。
- `npm run test:mainline` 用于验证“流程治理 -> 字段台账 -> 主数据对象 -> 权限 -> 导入导出”主线，详见 `docs/plans/流程治理字段台账主线稳定性检查.md`。
- 不直接运行会删除共享数据库的旧式测试逻辑。
- `seed-demo-data.js` 和 `setup-mdm-project-users.js` 需要显式环境变量才可运行。

流程治理口径：

- 组织真源为 `docs/organization/组织架构和部门职责.md`。
- 流程真源为 `docs/norms/{部门}部门-能力-流程-系统映射关系.md`。
- 快照来源为 `docs/company-sankey-data.json`。
- PMO 静态驾驶舱仍通过 parser 和内嵌快照运行。
