# apps/mdm-platform/scripts 说明

> 状态：应用内脚本导航  
> 生效日期：2026-06-10  
> 范围：只服务 `apps/mdm-platform/` 的数据库、路由、前端资产和流程治理承接测试。

本目录脚本属于 MDM 平台应用内工具。跨 `docs/`、`pmo/` 和多个应用的仓库级脚本应放在仓库根 `scripts/`。

## 1. 常用测试入口

| 命令 | 覆盖范围 | 副作用 |
|---|---|---|
| `npm run test:security` | 安全专项：默认口令、历史口令审计、写接口盘点、越权路由红线 | 使用隔离 SQLite，测试结束清理 |
| `npm run test:mainline` | MDM 主线：组织同步、角色工作台、流程治理、导入导出、项目角色 | 使用隔离 SQLite，测试结束清理 |
| `npm run test:process-governance` | 流程治理快照导入、质量问题、映射待办、前端挂钩、字段引用 | 使用隔离 SQLite，测试结束清理 |
| `npm run test:mappings` | 映射草稿、字段台账、黄金源、审批流完整路径 | 使用隔离 SQLite，测试结束清理 |
| `npm run test:project-roles` | 项目工作角色访问边界 | 使用隔离 SQLite，测试结束清理 |
| `npm run test:frontend` | 前端静态资产和关键脚本片段 | 只读 |

## 2. 安全和审计脚本

| 脚本 | 作用 | 副作用 |
|---|---|---|
| `audit-fixed-default-passwords.js` | dry-run 检查历史库中是否仍有旧固定初始密码账号 | 只读，不输出密码哈希 |
| `test-password-audit.js` | 验证历史口令审计脚本只读、脱敏 | 使用隔离 SQLite |
| `audit-route-write-permissions.js` | 扫描 `server/routes/` 写接口，分类权限中间件、业务内检查、集成 Key、自助入口、未分类项 | 只读 |
| `test-route-write-audit.js` | 验证写接口扫描脚本没有未分类写入口 | 只读 |
| `test-security-routes.js` | 安全路由集成测试 | 使用隔离 SQLite |
| `test-user-password-scripts.js` | 验证批量用户脚本不再硬编码固定初始密码 | 使用隔离 SQLite 和临时输入文件 |

## 3. 初始化、种子和维护脚本

| 脚本 | 作用 | 副作用 |
|---|---|---|
| `init-db.js` | 初始化默认数据库和管理员账号 | 写 `data/platform.db` 或 `MDM_DB_PATH` 指定库 |
| `seed-demo-data.js` | 填充演示数据 | 写当前数据库，运行前确认目标库 |
| `setup-mdm-project-users.js` | 建立项目角色账号 | 写当前数据库；需要显式环境变量允许执行 |
| `import-mdm-users.js` | 从 Excel 花名册导入平台用户 | 写当前数据库；新账号生成一次性初始密码并标记首次登录改密 |
| `check-escalations.js` | 检查冲突升级状态 | 读取当前数据库，可能触发业务检查逻辑 |

## 4. 流程治理承接脚本

| 脚本 | 作用 | 副作用 |
|---|---|---|
| `sync-organization-structure.js` | 从组织真源同步部门、岗位、人员到 MDM 结构 | 写当前数据库 |
| `sync-process-governance-org.js` | 为流程治理模块同步组织口径 | 写当前数据库 |
| `import-process-governance.js` | 导入 `docs/company-sankey-data.json` 流程治理快照 | 写当前数据库 |
| `check-process-governance.js` | 检查当前数据库中的流程治理快照 | 只读 |
| `lib/processGovernanceImport.js` | 流程治理导入共享实现 | 被导入脚本和测试调用 |

## 5. 单项测试脚本

| 类别 | 脚本 |
|---|---|
| 基础路由 | `test-org-route.js`、`test-catalog-routes.js`、`test-delete-routes.js`、`test-term-version-routes.js` |
| 映射与字段 | `test-mapping-routes.js`、`test-import-route.js`、`test-export-route.js` |
| 冲突和角色 | `test-conflict-routes.js`、`test-project-role-access.js`、`test-role-workbench-api.js`、`test-page-workflows-api.js` |
| 流程治理 | `test-process-governance-*.js`、`test-process-mapping-workspace-import.js` |
| 前端和视图 | `test-frontend-assets.js`、`test-views-routes.js`、`test-views-sankey-filters.js` |
| 冒烟 | `smoke-test.js`、`smoke-master-data.js`、`smoke-rbac.js`、`smoke-integration.js` |

## 6. 修改规则

1. 新增写数据库脚本时，必须支持或明确说明 `MDM_DB_PATH`。
2. 新增测试脚本时，优先使用 `testHelpers/isolatedDb`，不要写共享 `data/platform.db`。
3. 新增安全红线时，优先接入 `npm run test:security`。
4. 修改流程治理导入链路后，运行 `npm run test:process-governance` 和 `npm run test:mainline`。
5. 不在本目录提交日志、数据库、Excel 临时文件或生成缓存。
