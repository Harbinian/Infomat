# apps/mdm-platform/scripts 说明

> 状态：应用内脚本导航  
> 生效日期：2026-06-10  
> 范围：只服务 `apps/mdm-platform/` 的数据库、路由、前端资产和流程治理承接测试。

本目录脚本属于 MDM 平台应用内工具。跨 `docs/`、`pmo/` 和多个应用的仓库级脚本应放在仓库根 `scripts/`。

## 1. 常用测试入口

| 命令 | 覆盖范围 | 副作用 |
|---|---|---|
| `npm run test:rbac-raci-v2` | 固定十九项权限、七个MDM工作角色、十一项RACI、角色可见标签、账号接口、会话失效、迁移和空库初始化约束 | 命令名为兼容入口；使用fake repository和源码约束检查，不连接真实库 |
| `npm run test:process-governance-unified` | 完整v2草稿、修订冲突、承接队列、故事链、冲突处理链和管理员写入403 | 使用fake repository和接口测试，不连接真实库 |
| `npm run test:security` | 安全专项：默认口令、历史口令审计、写接口盘点、越权路由红线 | 迁移过渡期使用隔离遗留本地库，测试结束清理 |
| `npm run test:mainline` | MDM主线：组织结构、固定RBAC/RACI、角色工作台、人员身份、流程治理、数据地图、字段、术语、冲突、待办和导入导出 | MySQL路径使用fake pool/repository；遗留测试只使用隔离本地库并在结束后清理 |
| `npm run test:process-governance` | 流程治理 MySQL 读模型、MySQL 导入/冒烟、Sankey API、MySQL 身份权限、输入基线问题复核、文档结构化输出、统一问题池、前端挂钩和字段引用 | 正式口径为 MySQL-only；当前入口使用 fake MySQL pool / fake repository，不连接真实库，不纳入遗留 SQLite 服务器/仓储测试 |
| `npm run test:process-design` | 文档结构化输出 API、MySQL schema、制度主档、制度编号校验、A/B/AA 版次生成、下一版次完整重写草稿、制度 profile、术语、草稿级 L1/L2 既有映射枚举校验、流程明细、行为详情、跨部门承接回写、附表结构、字段新增/修改/删除/排序、自动编号、字段空格校验、证据状态核验、Markdown 草案导出、发布替代链路，以及术语/流程/业务行为编辑、删除、作废和只读状态 | 使用 fake process-design repository 和 fake MySQL 身份 repository，不连接真实库 |
| `npm run test:process-v7-preview-review` | V7完整规则校验、固定跨部门核对项、修订沿用与重开、部门范围、管理员只读、预览边界和迁移保护 | 使用fake repository和fake pool，不连接真实库 |
| `npm run test:process-data-governance` | 固定V7来源候选、精确单版本范围、MDM与业务责任隔离、管理员只读、API、迁移和全屏弹窗前端约束 | 使用确定性单元测试、fake repository和源码约束检查，不连接真实库 |
| `npm run migrate:process-data-governance:dry-run` | 只读检查六张后续数据治理表、迁移记录、已发布流程版本数量和结构一致性 | 通过固定MySQL配置连接；脱敏输出，不写MySQL |
| `npm run migrate:process-data-governance:apply` | 只在`not_applied`时创建六张空表和迁移记录；不回填历史工作包 | 写入目标MySQL；必须另行取得授权并先验证备份恢复 |
| `npm run migrate:process-data-governance:rollback` | 只在六张表全部为空时删除表和迁移记录 | 写入目标MySQL；发现任何治理记录即拒绝执行 |
| `npm run migrate:process-v7-preview:dry-run` | 只读检查四张V7预览核对表、迁移记录、正式三表数量和摘要，输出六种`consistency_status`之一 | 通过仓库固定服务配置和本机受控环境加载连接；目标脱敏输出，不写入MySQL |
| `npm run migrate:process-v7-preview:apply` | 在`not_applied`时建立V7预览核对专用表和迁移记录；`applied`时幂等返回 | 写入目标MySQL；其他不一致状态只报告并停止，不自动补表或记录 |
| `npm run migrate:process-v7-preview:rollback` | 仅在四张专用表均为空时删除表和迁移记录 | 写入目标MySQL；发现任何业务记录即拒绝执行 |
| `npm run inspect:process-v7-m0` | 读取正式三表数量、摘要、引用关系、JSON一致性和live schema差异 | 只读连接目标MySQL；证据写入`output/process-v7-m0/` |
| `npm run rehearse:process-v7-m0-backup-restore` | 生成全库备份，在专用临时MySQL恢复并核对全部对象与正式三表摘要 | 读取正式库；只写本机备份目录和临时数据库，不写正式库 |
| `npm run migrate:process-v7-formal:dry-run` | 只读检查M1的`migration_recorded`、`applied`和`consistency_status`，同时检查M2列、索引、提升审计表和正式V3摘要 | 连接目标MySQL但不写入；只有M1为`applied`时`ready_for_apply`才可为true |
| `npm run migrate:process-v7-formal:apply` | 增加原生V7正式基础，不创建V7业务行 | 写入目标MySQL；任何M2 DDL前要求M1`consistency_status=applied`，并必须取得单独授权 |
| `npm run migrate:process-v7-formal:rollback` | 仅在没有V7正式使用痕迹时移除M2对象 | 写入目标MySQL；发现提升、V7草稿、版本或审核正文绑定即拒绝执行 |
| `npm run rehearse:process-v7-migrations-isolated` | 在备份恢复的临时MySQL中验证M1部分结构停止应用、M2部分DDL恢复、提升幂等、过期审核拒绝、正式发布读回、并发发布和空表回退 | 不写正式库；完成后移除临时容器 |
| `npm run test:identity-mysql` | `person/user_accounts/person_roles`身份链路、登录、会话、本人改密、固定角色只读接口、通用权限中间件、范围helper和旧RBAC导入拒绝 | 使用fake MySQL pool和fake repository，不连接真实库 |
| `npm run test:access-mysql` | 验证 `access.js` 中角色码读取、管理员判断、全局查看、复核权限和待办处理判断的 MySQL-aware 异步 helper | 使用 fake repository，不连接真实库 |
| `npm run test:role-workbench-mysql` | 角色工作台在 `MDM_IDENTITY_READ_MODEL=mysql` 下从 MySQL 身份读模型读取当前用户、角色、部门和权限；在 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 下从流程治理 MySQL repository 读取质量问题和映射待办 | 使用 fake repository，不连接真实库 |
| `npm run test:activity` | 治理活跃热力图 API：本人/部门/全量视图、权限边界、治理动作来源汇总，以及 `MDM_IDENTITY_READ_MODEL=mysql` 下的管理视图权限判断 | 使用 fake repository，不连接真实库 |
| `npm run perf:local-concurrency` | 本机 10 并发性能验收：登录、本人信息、角色工作台、流程治理 Sankey、活动热力图，并输出 p50/p95/max、状态码和响应体大小 | 连接运行中的本机 MDM；只做登录和读接口，不输出密码或 Cookie |
| `npm run test:data-map-mysql` | 数据地图字段域 MySQL schema、repository 和上下文 API | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:field-entries-mysql` | 字段台账公开接口直接读取 Data Map MySQL repository，`mapping_id` 仅作 `context_id` 别名 | 使用 fake repository，不连接真实库 |
| `npm run test:field-identities-mysql` | 字段黄金源维护和确认接口直接读取 Data Map MySQL repository | 使用 fake repository，不连接真实库 |
| `npm run test:data-map-import-export-mysql` | 字段导入、字段导出和黄金源进度接口直接读取 Data Map MySQL repository | 使用 fake repository 和内存 Excel，不连接真实库 |
| `npm run test:terminology-mysql` | 术语治理 schema、repository 和 `/api/terminology` 接口直接读取 MySQL repository，不再读取 SQLite `terms` | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:mappings-mysql` | 旧映射审批 schema、repository 和 `/api/mappings` 接口直接读取 MySQL repository，不再读取 SQLite 映射、字段、术语或版本日志表 | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:conflicts-mysql` | 冲突治理 schema、repository 和 `/api/conflicts` 接口直接读取 MySQL repository；字段冲突来自 Data Map 字段域，术语冲突来自术语 MySQL 表 | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:todos-mysql` | 通用待办 schema、repository 和 `/api/todos` 接口直接读取 MySQL repository，不再读取或写入 SQLite `todos` | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:versions-mysql` | 平台通用版本记录 schema、repository 和 `/api/versions` 接口直接读取 MySQL `mdm_change_sets` / `mdm_version_log` | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run test:activity-mysql` | 治理活跃热力图从已迁移 MySQL 表汇总活动来源，不再读取 SQLite 版本、术语、冲突或待办表 | 使用 fake MySQL pool / fake repository，不连接真实库 |
| `npm run smoke:process-governance-mysql` | 可选真实 MySQL 冒烟：初始化 schema、导入 `docs/company-sankey-data.json`、读回 Sankey | 只有设置 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时写 MySQL；否则跳过 |
| `npm run smoke:data-map-mysql` | 可选真实 MySQL 冒烟：初始化 schema、写入 Data Map context、字段和黄金源并读回 | 只有设置 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时写 MySQL；否则跳过 |
| `npm run test:mappings` | 旧映射审批 MySQL 定向回归 | 等同 `npm run test:mappings-mysql`；不连接真实库 |
| `npm run test:conflicts` | 冲突治理 MySQL 定向回归 | 等同 `npm run test:conflicts-mysql`；不连接真实库 |
| `npm run test:project-roles` | 七个固定MDM工作角色、管理员业务只读、旧角色退休和无通配权限约束 | 源码和固定模型只读检查 |
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
| `init-mysql-schema.js` | 初始化MySQL schema，包含固定身份/RBAC字段、访问审计、责任记录、迁移备份、流程治理、数据地图、字段、术语、冲突、待办和平台审计表；不覆盖现有账号密码或状态 | 写MySQL结构，不写仓库真源 |
| `bootstrap-admin.js` | 仅在空身份库创建一次受控`ADMIN001`管理员入口；已有人员、账号或有效管理员时拒绝 | 写MySQL；一次性临时密码只在响应中显示 |
| `migrate-rbac-raci-v2.js --dry-run` | 盘点人员、账号、部门、角色、重复标识、孤立关系、缺失部门和缺失最终负责人 | 只读MySQL |
| `migrate-rbac-raci-v2.js --apply` | 备份身份授权数据，写入固定模型，仅保留`ADMIN001`管理员，停用其他旧账号并清除旧会话 | 写MySQL；执行前必须先dry-run |
| `migrate-rbac-raci-v2.js --rollback` | 在迁移后尚无新授权事件时按批次恢复账号、角色、权限和授权关系 | 写MySQL；必须指定迁移批次 |
| `migrate-rbac-raci-v2.js --compensate` | 已发生新授权事件后按批次补偿撤销迁移影响，不覆盖后续真实审计 | 写MySQL；必须指定迁移批次 |
| `migrate-process-governance-unified.js --dry-run` | 盘点完整流程JSON、冲突和事件迁移影响 | 只读MySQL |
| `migrate-process-governance-unified.js --apply` | 备份并迁移完整流程JSON、承接冲突和只追加事件 | 写MySQL；执行前必须先dry-run |
| `migrate-process-governance-unified.js --rollback` | 新版尚无业务写入时整批回滚 | 写MySQL；存在新业务写入时拒绝 |
| `migrate-process-governance-unified.js --compensate` | 新版已有业务写入时执行受控补偿 | 写MySQL；保留业务历史和审计 |
| `import-process-governance-mysql.js` | 将 `docs/company-sankey-data.json` 导入 MySQL 流程治理读模型，可用 `--a1-source` 显式补充 A1 Markdown | 写 MySQL 流程治理读模型、源文件、MDM 要求、证据和交互链表，不写流程输入基线 |
| `smoke-process-governance-mysql.js` | 可选真实 MySQL 端到端 smoke：初始化、导入、读回 Sankey | 缺少 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时跳过；不读取 `MDM_DB_PATH` |
| `smoke-data-map-mysql.js` | 可选真实 MySQL 端到端 smoke：初始化、写入 Data Map context、字段、黄金源并读回 | 缺少 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_DATABASE` 时跳过；不读取 `MDM_DB_PATH` |
| `import-process-input-baseline-review-mysql.js` | 将 `artifacts/process-input-baseline-review/<run-id>` 导入 MDM 输入基线问题复核表 | 写 MySQL `process_input_baseline_review_*` 表 |
| `init-db.js` | 历史本地库初始化入口，迁移完成前仅服务遗留测试链 | 写 `data/platform.db` 或 `MDM_DB_PATH` 指定库 |
| `setup-local-baseline.js` | 历史本地库测试基线入口，不是正式账号初始化入口 | 只允许隔离遗留测试；不得用于正式开户 |
| `seed-demo-data.js` | 历史演示数据入口；账号写入已拒绝 | 不得用于正式开户 |
| `setup-mdm-project-users.js` | 已退休的项目角色批量开户入口 | 执行即拒绝，不写账号 |
| `import-mdm-users.js`、`import-roster-users.js` | 已退休的Excel/花名册批量开户入口 | 执行即拒绝，不写账号 |
| `check-escalations.js` | 检查 MySQL 冲突治理记录中已超期的协调中冲突，并通过 `conflictMysqlRepository` 升级 | 写 MySQL 冲突治理和待办表，不读取 `MDM_DB_PATH` |

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
| `test-process-design-mysql-api.js` | 验证 `PROCESS_GOVERNANCE_READ_MODEL=mysql` 时 `/api/process-design/*` 使用 MySQL 路由，不加载 `server/db.js`，并覆盖制度编号 lookup、A 版创建、重复编号阻断、B/C 版完整重写草稿、发布替代、目的/范围、术语、草稿级 L1/L2 既有映射枚举、流程明细继承 L1/L2、业务行为详情、跨部门承接回写、附表结构、字段新增/修改/删除/排序、自动编号、字段空格校验、证据、Markdown 草案、提交、评审、发布路径；同时覆盖术语/流程更新删除、流程有关联行为时删除 409、业务行为改挂流程、作废、物理删除限制、跨部门降级限制和只读状态 | 使用 fake process-design repository 和 fake MySQL 身份 repository，不连接真实库 |
| `test-process-governance-issue-pool-mysql-permission-api.js` | 验证统一问题池详情、点位动作、关闭/重开和术语待办均通过 MySQL 身份、角色、部门和权限判断，越权请求不会进入写仓储；当前 `test:process-governance-issue-pool` 只纳入 MySQL/fake-repo 路径和前端入口检查 | 使用 fake issue-pool repository 和 fake MySQL 身份 repository，不连接真实库 |
| `test-process-input-baseline-review-mysql.js` | 验证 MDM 输入基线问题复核 MySQL repository 的导入、查询和结构化决策保存 | 使用 fake MySQL pool，只读仓库 |
| `test-process-input-baseline-review-api.js` | 验证 MDM 正式输入基线问题复核 API 保存结构化字段、以后端会话写 reviewer、内部抽取锚点不显示给业务用户，也不误显示为页码或原文段落号 | 使用 fake repository 和临时待确认目录 |
| `test-identity-mysql-repository.js` | 验证人员、账号、当前有效角色、权限、范围和`auth_version`会话校验只读取MySQL身份链路 | 使用fake MySQL pool，不连接真实库 |
| `test-org-me-mysql-api.js` | 验证登录和`/api/org/me`返回人员、账号、部门、全部有效角色、权限、数据范围和模型版本 | 使用fake repository，不连接真实库 |
| `test-roles-mysql-api.js` | 验证固定角色模型可读，角色、权限和矩阵写请求返回`CORE_GOVERNANCE_MODEL_READ_ONLY` | 使用fake repository，不连接真实库 |
| `test-auth-mysql-permission.js` | 验证 `MDM_IDENTITY_READ_MODEL=mysql` 时通用 `requirePermission` 从 MySQL repository 取权限和字段约束 | 使用 fake repository，不连接真实库 |
| `test-access-mysql-role-codes.js` | 验证 `MDM_IDENTITY_READ_MODEL=mysql` 时 `access.js` 可通过异步 helper 从 MySQL 身份读模型读取角色码 | 使用 fake repository，不连接真实库 |
| `test-access-mysql-permissions.js` | 验证 `MDM_IDENTITY_READ_MODEL=mysql` 时 `access.js` 的管理员、全局查看、复核权限和待办处理判断可通过异步 helper 读取 MySQL 权限 | 使用 fake repository，不连接真实库 |
| `test-import-rbac-mysql-api.js` | 验证 `MDM_IDENTITY_READ_MODEL=mysql` 时 RBAC 批量导入写接口不会在 MySQL 鉴权后回落 SQLite 写入 | 使用 fake repository，不连接真实库 |
| `test-role-workbench-mysql-api.js` | 验证角色工作台在 MySQL 身份读模型下使用仓储返回的角色、部门名和 `data:view_all` 权限 | 使用 fake repository，不连接真实库 |
| `test-role-workbench-process-governance-mysql-api.js` | 验证角色工作台在流程治理 MySQL 读模型下从 repository 读取质量问题和映射待办 | 使用 fake repository，不连接真实库 |
| `test-activity-mysql-repository.js` | 验证治理活跃热力图从 MySQL 活动来源表汇总动作，并断言不访问 SQLite 版本、术语、冲突或待办表 | 使用 fake MySQL pool，不连接真实库 |
| `test-activity-mysql-api.js` | 验证 `/api/activity/heatmap` 保持公开路径和响应口径，同时通过审计 repository 访问活动数据 | 使用 fake repository，不连接真实库 |
| `test-activity-heatmap-mysql-identity-api.js` | 验证 `MDM_IDENTITY_READ_MODEL=mysql` 时治理活跃热力图管理视图权限来自 MySQL 身份 helper，不回落 SQLite 角色/权限表 | 使用 fake repository，不连接真实库 |
| `test-data-map-mysql-repository.js` | 验证 Data Map MySQL repository 的上下文、字段、命名校验、黄金源、导入批次和进度统计 | 使用 fake MySQL pool，不连接真实库 |
| `test-data-map-contexts-api.js` | 验证 `/api/data-map/contexts` 上下文创建、查询和更新 | 使用 fake repository，不连接真实库 |
| `test-field-entries-mysql-api.js` | 验证 `/api/field-entries/*` 字段接口不再读取遗留字段表 | 使用 fake repository，不连接真实库 |
| `test-field-identities-mysql-api.js` | 验证 `/api/field-identities/*` 黄金源接口不再读取遗留字段表 | 使用 fake repository，不连接真实库 |
| `test-data-map-import-export-mysql-api.js` | 验证字段导入、导出和黄金源进度均通过 Data Map repository | 使用 fake repository 和内存 Excel，不连接真实库 |
| `test-terminology-mysql-repository.js` | 验证术语治理 MySQL repository 的术语类型、流程治理读模型范围、术语创建/更新/审批/删除，并断言不访问 SQLite `terms` | 使用 fake MySQL pool，不连接真实库 |
| `test-terminology-mysql-api.js` | 验证 `/api/terminology` 保持公开路径和响应口径，同时通过 terminology repository 访问术语数据 | 使用 fake repository，不连接真实库 |
| `test-mappings-mysql-repository.js` | 验证旧映射审批 MySQL repository 的创建、草稿更新、提交、审批、退回、发布、详情和删除，并断言不访问 SQLite 映射、字段、术语或版本日志表 | 使用 fake MySQL pool，不连接真实库 |
| `test-mappings-mysql-api.js` | 验证 `/api/mappings` 保持公开路径和响应口径，同时通过 mapping repository 访问映射审批数据 | 使用 fake repository，不连接真实库 |
| `test-conflicts-mysql-repository.js` | 验证冲突 MySQL repository 可检测 Data Map 字段冲突、术语冲突并完成指派、协调和终裁；断言不访问 SQLite 字段、术语、待办或冲突表 | 使用 fake MySQL pool，不连接真实库 |
| `test-conflicts-mysql-api.js` | 验证 `/api/conflicts` 保持公开路径和响应口径，同时通过 conflict repository 访问冲突治理数据 | 使用 fake repository，不连接真实库 |
| `test-conflicts-mysql-identity-api.js` | 验证 `/api/conflicts` 的权限判断可读取 MySQL 身份权限 helper，不依赖 SQLite 身份数据 | 使用 fake repository，不连接真实库 |
| `test-check-escalations-mysql.js` | 验证超期冲突升级维护脚本通过 conflict repository 工作，不加载 SQLite 本地库 | 使用 fake repository，不连接真实库 |
| `test-todos-mysql-repository.js` | 验证通用待办 MySQL repository 的创建、查询、完成和删除，并断言不访问 SQLite `todos` | 使用 fake MySQL pool，不连接真实库 |
| `test-todos-mysql-api.js` | 验证 `/api/todos` 保持公开路径和响应口径，同时通过 todo repository 访问待办数据 | 使用 fake repository，不连接真实库 |
| `test-versions-mysql-repository.js` | 验证平台通用审计 repository 可写入和读取 `mdm_change_sets` / `mdm_version_log`，并断言不访问 SQLite `change_set` / `version_log` | 使用 fake MySQL pool，不连接真实库 |
| `test-versions-mysql-api.js` | 验证 `/api/versions` 保持公开路径和响应口径，同时通过审计 repository 访问版本数据 | 使用 fake repository，不连接真实库 |

## 5. 单项测试脚本

| 类别 | 脚本 |
|---|---|
| 基础路由 | `test-org-route.js`、`test-catalog-routes.js`、`test-delete-routes.js`、`test-term-version-routes.js` |
| 映射与字段 | `test-mappings-mysql-repository.js`、`test-mappings-mysql-api.js`、`test-mapping-routes.js`、`test-import-route.js`、`test-export-route.js`、`test-data-map-mysql-repository.js`、`test-data-map-contexts-api.js`、`test-field-entries-mysql-api.js`、`test-field-identities-mysql-api.js`、`test-data-map-import-export-mysql-api.js` |
| 冲突和角色 | `test-conflicts-mysql-repository.js`、`test-conflicts-mysql-api.js`、`test-conflicts-mysql-identity-api.js`、`test-todos-mysql-repository.js`、`test-todos-mysql-api.js`、`test-project-role-access.js`、`test-role-workbench-api.js`、`test-role-workbench-mysql-api.js`、`test-role-workbench-process-governance-mysql-api.js`、`test-page-workflows-api.js` |
| 流程治理 | `test-process-governance-*.js`、`test-process-mapping-workspace-import.js` |
| 前端和视图 | `test-frontend-assets.js`、`test-views-routes.js`、`test-views-sankey-filters.js`、`test-activity-mysql-repository.js`、`test-activity-mysql-api.js`、`test-activity-heatmap-mysql-identity-api.js` |
| 冒烟 | `smoke-test.js`、`smoke-master-data.js`、`smoke-rbac.js`、`smoke-integration.js` |

## 6. 修改规则

1. 新增写数据库脚本时，默认使用 MySQL 配置；若仍服务遗留本地库，必须明确说明 `MDM_DB_PATH` 只是迁移过渡期隔离机制。
2. 新增测试脚本时，优先使用 `testHelpers/isolatedDb`，不要写共享 `data/platform.db`。
3. 新增安全红线时，优先接入 `npm run test:security`。
4. 修改流程治理导入链路后，运行 `npm run test:process-governance` 和 `npm run test:mainline`。
5. 不在本目录提交日志、数据库、Excel 临时文件或生成缓存。
