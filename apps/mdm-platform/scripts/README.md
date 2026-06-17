# apps/mdm-platform/scripts 说明

> 状态：应用内脚本导航  
> 生效日期：2026-06-10  
> 范围：只服务 `apps/mdm-platform/` 的数据库、路由、前端资产和流程治理承接测试。

本目录脚本属于 MDM 平台应用内工具。跨 `docs/`、`pmo/` 和多个应用的仓库级脚本应放在仓库根 `scripts/`。

## 1. 常用测试入口

| 命令 | 覆盖范围 | 副作用 |
|---|---|---|
| `npm run test:security` | 安全专项：默认口令、历史口令审计、写接口盘点、越权路由红线 | 迁移过渡期使用隔离遗留本地库，测试结束清理 |
| `npm run test:mainline` | MDM 主线：组织同步、角色工作台、流程治理、导入导出、项目角色 | 迁移过渡期使用隔离遗留本地库，测试结束清理 |
| `npm run test:process-governance` | 流程治理快照导入、质量问题、映射待办、前端挂钩、字段引用、候选复核契约 | 迁移过渡期使用隔离遗留本地库；流程治理读模型和候选复核 repository 覆盖 MySQL SQL 契约，`/snapshots`、`/current`、`/sankey`、`/a1`、源文件、MDM 要求、证据和交互链接口可在受控开关下走 MySQL |
| `npm run test:identity-mysql` | 身份/RBAC MySQL 模型：repository 契约、登录、会话、本人改密、管理员用户/部门/权限读写路由验证 | 使用 fake MySQL pool 和 fake repository，不连接真实库；默认不开启该切换 |
| `npm run test:role-workbench-mysql` | 角色工作台在 `MDM_IDENTITY_READ_MODEL=mysql` 下从 MySQL 身份读模型读取当前用户、角色、部门和权限 | 使用 fake repository；流程待办数据仍使用隔离遗留本地库 |
| `npm run smoke:process-governance-mysql` | 可选真实 MySQL 冒烟：初始化 schema、导入 `docs/company-sankey-data.json`、读回 Sankey | 只有设置 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时写 MySQL；否则跳过 |
| `npm run test:mappings` | 映射草稿、字段台账、黄金源、审批流完整路径 | 迁移过渡期使用隔离遗留本地库，测试结束清理 |
| `npm run test:project-roles` | 项目工作角色访问边界 | 迁移过渡期使用隔离遗留本地库，测试结束清理 |
| `npm run test:frontend` | 前端静态资产和关键脚本片段 | 只读 |

## 2. 安全和审计脚本

| 脚本 | 作用 | 副作用 |
|---|---|---|
| `audit-fixed-default-passwords.js` | dry-run 检查历史库中是否仍有旧固定初始密码账号 | 只读，不输出密码哈希 |
| `test-password-audit.js` | 验证历史口令审计脚本只读、脱敏 | 使用隔离遗留本地库 |
| `audit-route-write-permissions.js` | 扫描 `server/routes/` 写接口，分类权限中间件、业务内检查、集成 Key、自助入口、未分类项 | 只读 |
| `test-route-write-audit.js` | 验证写接口扫描脚本没有未分类写入口 | 只读 |
| `test-security-routes.js` | 安全路由集成测试 | 使用隔离遗留本地库 |
| `test-user-password-scripts.js` | 验证批量用户脚本不再硬编码固定初始密码 | 使用隔离遗留本地库和临时输入文件 |

## 3. 初始化、种子和维护脚本

| 脚本 | 作用 | 副作用 |
|---|---|---|
| `init-mysql-schema.js` | 初始化 MySQL 中已迁移的平台 schema，当前包含身份/RBAC 表、候选复核表和流程治理读模型/待办表 | 写 MySQL，不写仓库真源 |
| `import-process-governance-mysql.js` | 将 `docs/company-sankey-data.json` 导入 MySQL 流程治理读模型，可用 `--a1-source` 显式补充 A1 Markdown | 写 MySQL 流程治理读模型、源文件、MDM 要求、证据和交互链表，不写流程真源 |
| `smoke-process-governance-mysql.js` | 可选真实 MySQL 端到端 smoke：初始化、导入、读回 Sankey | 缺少 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时跳过；不读取 `MDM_DB_PATH` |
| `import-process-candidate-review-mysql.js` | 将 `artifacts/process-candidates/<run-id>` 导入 MDM 候选复核表 | 写 MySQL `process_candidate_review_*` 表 |
| `init-db.js` | 历史本地库初始化入口，迁移完成前仅服务遗留测试链 | 写 `data/platform.db` 或 `MDM_DB_PATH` 指定库 |
| `setup-local-baseline.js` | 从现有 schema 初始化、组织真源同步和环境变量管理员 RBAC 绑定重建本地基础数据 | 迁移过渡期写隔离遗留本地库；不导入花名册账号、不保存密码 |
| `seed-demo-data.js` | 填充演示数据 | 写当前数据库，运行前确认目标库 |
| `setup-mdm-project-users.js` | 建立项目角色账号 | 写当前数据库；需要显式环境变量允许执行 |
| `import-mdm-users.js` | 从 Excel 花名册导入平台用户 | 写当前数据库；新账号生成一次性初始密码并标记首次登录改密 |
| `check-escalations.js` | 检查冲突升级状态 | 读取当前数据库，可能触发业务检查逻辑 |

## 4. 流程治理承接脚本

| 脚本 | 作用 | 副作用 |
|---|---|---|
| `sync-organization-structure.js` | 从组织真源同步部门、岗位、人员到 MDM 结构 | 写当前数据库 |
| `sync-process-governance-org.js` | 为流程治理模块同步组织口径 | 写当前数据库 |
| `import-process-governance.js` | 迁移过渡期导入 `docs/company-sankey-data.json` 到遗留本地库 | 写当前数据库；后续由 MySQL 导入替代 |
| `import-process-governance-mysql.js` | 导入 `docs/company-sankey-data.json` 到 MySQL 流程治理读模型 | 写 MySQL；不读取 `MDM_DB_PATH` |
| `check-process-governance.js` | 检查当前数据库中的流程治理快照 | 只读 |
| `lib/processGovernanceImport.js` | 流程治理导入共享实现 | 被导入脚本和测试调用 |
| `test-process-governance-mysql-repository.js` | 验证流程治理 MySQL 读模型 repository 可替换活动快照并读回 Sankey、A1、源文件、MDM 要求、证据和交互链数据 | 使用 fake MySQL pool，只读仓库；不切换现有 Express 路由 |
| `test-process-governance-mysql-import.js` | 验证 `docs/company-sankey-data.json` 形态可转成 MySQL 读模型 bundle，并包含源文件、MDM 要求、证据和显式 A1 Markdown 数据 | 使用 fake repository，只读仓库 |
| `test-process-governance-mysql-smoke.js` | 验证真实 MySQL smoke 的跳过条件和可注入执行路径 | 使用 fake pool/repository，只读仓库 |
| `test-process-governance-sankey-mysql-api.js` | 验证 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 时流程治理只读接口读取 MySQL repository | 覆盖 `/snapshots`、`/current`、`/sankey`、`/a1`、`/source-files`、`/mdm-requirements`、`/evidence`、`/chains`；使用 fake repository，默认不开启该切换 |
| `test-process-candidate-review-mysql.js` | 验证 MDM 候选复核 MySQL repository 的导入、查询和结构化决策保存 | 使用 fake MySQL pool，只读仓库 |
| `test-process-candidate-review-api.js` | 验证 MDM 正式候选复核 API 保存结构化字段、以后端会话写 reviewer、内部抽取锚点不显示为页码或原文段落号 | 使用 fake repository 和临时候选目录 |
| `test-identity-mysql-repository.js` | 验证身份/RBAC MySQL repository 可读取用户、部门、登录凭据、角色、继承权限、字段约束、本人改密状态、管理员用户列表、部门列表、权限清单和管理员写入 | 使用 fake MySQL pool，不连接真实库 |
| `test-org-me-mysql-api.js` | 验证 `MDM_IDENTITY_READ_MODEL=mysql` 时登录、`/api/org/me`、`/api/org/session`、本人密码状态、本人改密、管理员用户/部门/权限读写接口走 MySQL repository | 使用 fake repository，不连接真实库 |
| `test-role-workbench-mysql-api.js` | 验证角色工作台在 MySQL 身份读模型下使用仓储返回的角色、部门名和 `data:view_all` 权限 | 使用 fake repository，不连接真实库 |

## 5. 单项测试脚本

| 类别 | 脚本 |
|---|---|
| 基础路由 | `test-org-route.js`、`test-catalog-routes.js`、`test-delete-routes.js`、`test-term-version-routes.js` |
| 映射与字段 | `test-mapping-routes.js`、`test-import-route.js`、`test-export-route.js` |
| 冲突和角色 | `test-conflict-routes.js`、`test-project-role-access.js`、`test-role-workbench-api.js`、`test-role-workbench-mysql-api.js`、`test-page-workflows-api.js` |
| 流程治理 | `test-process-governance-*.js`、`test-process-mapping-workspace-import.js` |
| 前端和视图 | `test-frontend-assets.js`、`test-views-routes.js`、`test-views-sankey-filters.js` |
| 冒烟 | `smoke-test.js`、`smoke-master-data.js`、`smoke-rbac.js`、`smoke-integration.js` |

## 6. 修改规则

1. 新增写数据库脚本时，默认使用 MySQL 配置；若仍服务遗留本地库，必须明确说明 `MDM_DB_PATH` 只是迁移过渡期隔离机制。
2. 新增测试脚本时，优先使用 `testHelpers/isolatedDb`，不要写共享 `data/platform.db`。
3. 新增安全红线时，优先接入 `npm run test:security`。
4. 修改流程治理导入链路后，运行 `npm run test:process-governance` 和 `npm run test:mainline`。
5. 不在本目录提交日志、数据库、Excel 临时文件或生成缓存。
