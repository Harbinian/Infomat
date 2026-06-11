# Infomat 全库整改分流报告

> 日期：2026-06-10
> 范围：本报告只归并和分流本轮全库审查发现，不作为流程真源、PMO 真源或 MDM 配置真源。
> 执行策略：分批推进。第一批完成第 0 层核验分流和第 1 层验证体系止血；第二批先处理 MDM 安全边界中可明确测试的最小切片。

## 1. 实测基线

| 检查项 | 命令 | 当前结论 |
|---|---|---|
| 根目录流程治理主线聚合校验 | `npm run test:process-governance-mainline` | 已通过，包含合约、PMO 数据、部门域、source manifest 和 PMO 任务数据 |
| MDM 主线稳定性 | `cd apps/mdm-platform && npm run test:mainline` | 已通过 |
| MDM 安全专项 | `cd apps/mdm-platform && npm run test:security` | 已覆盖基础主数据越权、用户目录权限、最小候选人接口、字段约束读写、session secret、写接口盘点和 RBAC 管理员判断红线 |
| 2026-06-11 分层整改回归 | 见 `docs/reports/2026-06-11-remediation-verification-log.md` | 根主线、安全专项、MDM 主线、项目角色、流程治理专项均通过 |

口径修正：

- MINIMAX 关于根目录缺少 `sync:process-governance` 和 `scripts/sync-process-governance-mainline.mjs` 的结论已过时；当前 `package.json` 已有该脚本入口，目标脚本也存在。
- Trae 关于 `test:security` 红线和基础主数据写接口覆盖盲区的结论已确认；安全测试原先会在 Excel 断言处提前失败，后续越权断言跑不到。
- Deepseek 对前端单文件、测试框架、脚本膨胀等问题的判断保留为长期架构债，不进入第一批修复。

## 2. 问题分流

| 层级 | 主题 | 状态 | 第一批处理 |
|---|---|---|---|
| 第 1 层 | 安全测试固定列位断言脆弱 | 已确认 | 已纳入 |
| 第 1 层 | 普通登录用户可写基础主数据 | 已确认 | 已纳入 |
| 第 1 层 | `requireAuth` 写接口缺少系统盘点 | 已确认 | 已补只读审计脚本并接入安全专项 |
| 第 2 层 | 旧 `users.role` 与 RBAC 管理员判断并存 | 已确认 | 第二批小片已处理管理员判断 |
| 第 2 层 | 默认口令 `init1234` 制度化 | 已确认 | 第二批小片已处理平台用户管理和批量脚本 |
| 第 2 层 | `SESSION_SECRET` 固定回退 | 已确认 | 第二批小片已处理 |
| 第 2 层 | `/api/org/users` 员工目录暴露面过宽 | 已确认 | 第二批小片已处理目录收窄、后端候选人接口和前端切换 |
| 第 2 层 | `applyFieldConstraints` readonly 未执行 | 已确认 | 第二批小片已处理读写两侧 |
| 第 2 层 | 历史账号可能仍使用旧固定口令 | 待复核 | 第二批小片已补 dry-run 审计脚本 |
| 第 2 层 | 待办列表仍按旧基础角色单选过滤 | 已确认 | 第二批小片已处理多角色并集过滤 |
| 第 2 层 | 字段台账编辑仍按旧基础角色判断 | 已确认 | 第二批小片已处理 `fieldEntries` owner/submitter 判断 |
| 第 2 层 | 黄金源维护仍按旧基础角色判断 | 已确认 | 第二批小片已处理 `fieldIdentities` owner 判断 |
| 第 2 层 | 字段台账导入仍按旧基础角色判断 | 已确认 | 第二批小片已处理 `import` submitter 判断 |
| 第 2 层 | 流程映射草稿创建仍为登录即可 | 已确认 | 第二批小片已收紧为报送人或管理员 |
| 第 3 层 | 工程技术部流程映射交付物缺失 | 已确认风险 | 第三批小片已补缺口审计、source manifest 初版和候选源校验 |
| 第 3 层 | `crossDept` 从报告 Markdown 派生 | 已确认风险 | 第三批小片已处理校验不固化数字，并补来源指纹校验 |
| 第 3 层 | `综合管理部` 等历史/幽灵部门口径 | 已登记待确认 | 第三批小片已补缺口审计，并登记到过时部门名称追踪表 |
| 第 3 层 | 缺少部门 canonical 映射交付物清单 | 已确认 | 第三批小片已补只读 source manifest 和校验脚本 |
| 第 3 层 | 部门到域映射仍在组织真源、合同和 parser 中多处维护 | 已确认 | 第三批小片已补 `test:dept-domain-mapping`，parser 已改为从组织真源读取 |
| 第 4 层 | README / PMO 文档引用不存在入口或截图 | 已确认 | 第四批小片已处理失效导航 |
| 第 4 层 | `apps/` 缺少应用集合目录说明 | 已确认 | 第四批小片已补 README |
| 第 4 层 | `apps/mdm-platform/` 应用边界说明不够集中 | 已确认 | 第四批小片已补 README 边界入口 |
| 第 4 层 | `scripts/` 缺少脚本职责和副作用说明 | 已确认 | 第四批小片已补 README |
| 第 4 层 | `apps/mdm-platform/scripts/` 缺少应用内脚本职责说明 | 已确认 | 第四批小片已补 README |
| 第 4 层 | `docs/` 根目录资料与子目录职责不清 | 已确认 | 第四批小片已补导航 README，不迁移文件 |
| 第 4 层 | `docs/adr/` 缺少架构决策目录说明 | 已确认 | 第四批小片已补 README |
| 第 4 层 | `docs/archives/` 缺少历史归档目录说明 | 已确认 | 第四批小片已补 README |
| 第 4 层 | `docs/contracts/` 缺少校验合同目录说明 | 已确认 | 第四批小片已补 README |
| 第 4 层 | `docs/HardwareResearch/` 缺少基础设施知识库目录说明 | 已确认 | 第四批小片已补 README，不触碰既有正文改动 |
| 第 4 层 | `docs/integration/` 缺少集成方案目录说明 | 已确认 | 第四批小片已补 README |
| 第 4 层 | `docs/meetings/` 缺少会议记录目录说明 | 已确认 | 第四批小片已补 README |
| 第 4 层 | `docs/norms/` 缺少面向人的真源目录说明 | 已确认 | 第四批小片已补 README，不移动 norms 文件 |
| 第 4 层 | `docs/organization/` 缺少组织真源目录说明 | 已确认 | 第四批小片已补 README |
| 第 4 层 | `docs/plans/` 缺少计划文档目录说明 | 已确认 | 第四批小片已补 README |
| 第 4 层 | `docs/reports/` 缺少审计报告目录说明 | 已确认 | 第四批小片已补 README，不迁移报告 |
| 第 4 层 | `docs/外部参考/`、`docs/training/`、`docs/Demo/`、`docs/screenshots/`、`docs/U8SoftHelp/` 缺少参考资产目录说明 | 已确认 | 第四批小片已补 README，不移动大文件 |
| 第 4 层 | `pmo/archive/`、`pmo/deliverables/`、`pmo/procedure-management/`、`pmo/scripts/` 缺少子目录说明 | 已确认 | 第四批小片已补 README，不改 PMO 真源 |
| 第 4 层 | 废弃 `claude-to-im` skill 仍残留在锁文件 | 已确认 | 已删除本地失效入口并移除 `skills-lock.json` 记录 |
| 第 4 层 | 根目录散放资产仍需分流 | 已确认 | 第四批小片已补分流报告，`analyze-layout.js` 已迁入 `scripts/`，`temp_survey.txt` 已迁入 `docs/HardwareResearch/` |
| 第 4 层 | AI 协作、输入材料和历史快照目录缺少边界说明 | 已确认 | 第四批小片已补 README，不迁移历史输出 |
| 第 4 层 | 忽略型输出工作区仍需说明 | 已确认 | 第四批小片已补只读审计报告，不提交本地输出 |
| 第 4 层 | 大体积参考资产仍需迁移提案 | 已确认 | 第四批小片已补迁移提案，不移动文件 |
| 第 4 层 | 重复静态资产、日志、数据库备份、缓存入库 | 已确认 | 运行产物已处理；重复资产已补迁移提案 |
| 第 4 层 | PMO 双份任务数据缺少自动一致性检查 | 已确认 | 第四批小片已补 `test:pmo-task-data` |
| 第 5 层 | 前端单文件、测试 helper 重复、大脚本膨胀 | 已归类 | 延后 |
| 第 5 层 | 审批第 5 步状态返回 `undefined` | 过时/未复现 | 当前 `mappingStatusAfterStep(5)` 返回 `final_reviewed`，`test:mappings` 覆盖终审发布 |
| 第 5 层 | 编码流水号并发、冲突检测性能 | 待复核 | 延后 |

## 3. 第一批实际边界

第一批只收紧 MDM 基础主数据写接口：

- 人员：新增、更新、任岗挂接、任岗停用。
- 产品：新增、更新。
- 产品族：新增、更新。
- 岗位：新增、更新。
- 组织单元：新增入口仍禁止手工创建，更新增加权限校验。
- 分类节点：新增、更新、成员挂接。
- 属性：定义新增、定义更新、属性值写入。

第一批不处理：

- `todos`、`conflicts`、`processGovernance` 等业务流写接口。
- 工程技术部映射补全。
- PMO 驾驶舱、`docs/norms` 真源内容和大目录迁移。
- 前端单文件拆分、安全头、限流、session store。

## 4. 工作区状态提示

执行前工作区已有多处未提交修改和未跟踪文件，涉及 `.agents/`、`apps/mdm-platform/public/`、流程治理导入与测试、`docs/company-sankey-data.json`、`docs/norms/`、`package.json`、`pmo/procedure-management/dashboard.html`、`scripts/parse-sankey-data.mjs` 等。

本轮只应归因于以下新增或修改：

- 新增本报告。
- 修正 `apps/mdm-platform/scripts/test-security-routes.js` 的 Excel 表头定位和基础主数据写入权限红线。
- 给基础主数据写接口增加最小 RBAC 权限校验。
- 追加写接口盘点红线：新增 `apps/mdm-platform/scripts/audit-route-write-permissions.js` 和 `test-route-write-audit.js`，将写路由分类为权限中间件保护、集成 Key 保护、业务内检查、已知后续项、自助/登录类和未分类；当前未分类为 0，`POST /api/mappings` 草稿创建保留为后续项。
- 追加第二批安全红线：生产模式缺少 `SESSION_SECRET` 不得启动、普通用户不能读取全员用户目录、字段约束需剥离 `exclude` 并标记 `readonly`。
- 第二批对应最小实现：`/api/org/users` 增加管理员权限，`applyFieldConstraints` 在普通 GET 响应中加载有效字段约束并输出 `_readonly_fields`，`server/index.js` 不再使用隐式固定 session secret。
- 追加 RBAC 管理员红线：旧角色不是 `admin`、但具备 RBAC `admin` 角色的用户应能执行管理员归档动作。
- 第二批继续收敛管理员判断：`auth.isAdmin`、旧数据权限管理员旁路、冲突归档、术语维护和集成凭据管理改用 RBAC 管理员口径。
- 追加字段级写保护红线：具备受限写权限的用户不能写入该权限声明的 `readonly` 字段，但仍可写入非只读字段。
- 第二批继续执行字段约束：`requirePermission` 对写请求检查当前权限码的 `readonly` 字段，命中后返回 `403`。
- 追加用户目录替代红线：普通报送人不能查看指派候选人，冲突处理角色只能通过 `/api/org/users/assignable` 获取 `id/name/department_id/dept_name`。
- 第二批继续收窄员工目录：`/api/org/users` 保持管理员专用，新增后端最小候选人接口，并将冲突指派弹窗切到 `/api/org/users/assignable`。
- 追加默认口令红线：平台用户管理接口不得用固定 `init1234` 创建或重置账号，缺省时由服务端生成一次性初始密码并标记首次登录改密。
- 第二批继续收敛默认口令：页面账号入库和重置密码改为展示服务端返回的一次性初始密码；`setup-mdm-project-users.js`、`import-mdm-users.js` 改为生成本次一次性初始密码、写入 `must_change_password=1`，并接入 `test:security`。
- 追加历史账号审计红线：提供 `scripts/audit-fixed-default-passwords.js` dry-run 审计旧固定口令账号，不输出哈希、不修改用户；对应 `npm run test:password-audit` 已接入 `test:security`。
- 追加待办多角色红线：旧基础角色为报送人、但 RBAC 具备 owner 的用户，应能看到本部门待确认字段待办。
- 第二批继续统一角色口径：`GET /api/todos` 改为按 RBAC + 旧基础角色的并集过滤，并修正旧 SQL 字符串拼接导致报送人口径 500 的问题。
- 追加字段台账多角色红线：旧基础角色为报送人、但 RBAC 具备 owner 的用户，应能维护本部门字段 owner 列。
- 第二批继续统一角色口径：`fieldEntries` 创建、编辑和删除的 submitter/owner 判断改为 RBAC + 旧基础角色并集。
- 追加黄金源多角色红线：旧基础角色为报送人、但 RBAC 具备 owner 的用户，应能维护并确认本部门字段身份。
- 第二批继续统一角色口径：`fieldIdentities` 的 owner 判断改为 RBAC + 旧基础角色并集。
- 追加导入多角色红线：旧基础角色不是报送人、但 RBAC 具备 submitter 且本人是映射提交人时，应能导入字段台账。
- 第二批继续统一角色口径：`import` 字段台账导入的 submitter 判断改为 RBAC + 旧基础角色并集。
- 追加流程映射草稿创建红线：评审人等非报送人账号不能创建映射草稿，报送人和管理员仍可创建；`POST /api/mappings` 已增加报送人/管理员检查，并从写接口审计的后续项移入业务内保护。
- 复核 Deepseek 审批状态机结论：当前 `apps/mdm-platform/server/routes/mappings.js` 已包含第 5 步状态映射，`npm run test:mappings` 可跑完整终审发布路径，该单点标记为过时/未复现；不做代码改动。
- 追加第三批校验红线：`check-dashboard-data.mjs` 不得把 `crossDept` 统计固化为 `168/6/1` 等历史数字。
- 第三批继续收紧根主线入口：`npm run test:process-governance-mainline` 已改为聚合校验，依次执行主线合约、PMO 驾驶舱数据、部门域映射、流程真源清单和 PMO 任务数据一致性检查。
- 第三批先做只读校验收敛：`check-dashboard-data.mjs` 从 `跨部门完整性检查报告.md` 解析统计值，并与 `docs/company-sankey-data.json.crossDept`、PMO 内嵌 `#cross-dept-data` 比对；不改流程真源和生成快照。
- 第三批继续补跨部门来源新鲜度口径：新增并落地 `docs/reports/2026-06-11-cross-dept-source-freshness-proposal.md`，`parse-sankey-data.mjs` 已把两份跨部门报告来源指纹写入 `crossDept.sourceReports`，`check-dashboard-data.mjs` 已比对磁盘报告 hash、公司级 JSON 和 PMO 内嵌数据。
- 第三批继续补真源缺口审计：新增 `docs/reports/2026-06-10-process-truth-gap-audit.md`，确认工程技术部缺少 canonical 映射文件、`综合管理部` 属于待确认口径残留；不补写 norms、不重新生成 JSON。
- 第三批继续补历史部门/外部实体口径：更新 `docs/norms/流程治理/过时部门名称追踪表.md`，将 `综合管理部` 登记为待确认项，区分沈飞民机外部实体线索和昌兴制度旧称线索；确认前不自动归并到当前组织真源。
- 第三批继续补流程映射真源清单：新增 `docs/reports/2026-06-11-norms-source-manifest.md`，按组织真源和 DCM/BBM 合同登记 9 个部门、8 组 canonical 交付物和工程技术部缺口；新增 `docs/reports/2026-06-11-engineering-source-manifest.md`，登记工程技术部 source manifest 初版和外部候选资料；新增 `scripts/check-norms-source-manifest.mjs`、`scripts/check-engineering-source-manifest.mjs`、`npm run test:norms-source-manifest` 和 `npm run test:engineering-source-manifest`，校验合同、三件套、工程技术部缺口和 47 个候选源索引仍与仓库现状一致；当前协作提示已对齐 `复材车间` 口径，未来如拆分一、二车间需先改组织真源和合同；不改 `docs/norms/`。
- 第三批继续补部门域口径红线：新增 `scripts/check-dept-domain-mapping.mjs` 和 `npm run test:dept-domain-mapping`，从 `docs/organization/组织架构和部门职责.md` 解析三组部门，并校验 `docs/contracts/dcm-bbm-contract.json` 一致；`scripts/parse-sankey-data.mjs` 已移除部门到域硬编码，改为从组织真源读取，并在 `sourceManifest` 记录组织真源 hash。
- 第四批先做导航止血：修正根 README、PMO README、PMO CLAUDE 和流程驾驶舱 CLAUDE 中不存在的甘特入口、截图、旧文档和手工 JSON 替换说明；不移动静态资产或大体积资料。
- 第四批继续补应用集合导航：新增 `apps/README.md`，说明 `apps/` 只放可运行应用，当前唯一应用入口为 `apps/mdm-platform/`。
- 第四批继续补应用边界导航：更新 `apps/mdm-platform/README.md`，说明 MDM 目录只负责平台应用、应用内脚本和平台说明，不维护流程真源、组织真源、PMO 展示或仓库级脚本。
- 第四批继续补决策和归档目录说明：新增 `docs/adr/README.md`、`docs/archives/README.md`，区分长期架构决策、历史归档、阶段计划和审计报告。
- 第四批继续补脚本边界：新增 `scripts/README.md`，按主线入口、审计质量脚本、局部或历史工具说明输入、输出和写文件副作用；不移动脚本。
- 第四批继续补 MDM 应用内脚本边界：新增 `apps/mdm-platform/scripts/README.md`，分类测试、安全审计、初始化维护和流程治理承接脚本，并标注数据库副作用。
- 第四批继续补校验合同目录说明：新增 `docs/contracts/README.md`，说明 `dcm-bbm-contract.json` 是脚本合同，不替代组织或流程真源。
- 第四批继续补基础设施知识库目录说明：新增 `docs/HardwareResearch/README.md`，说明该目录服务基础设施方案和招标准备，不替代流程、组织、应用或 PMO 真源；未触碰该目录既有正文改动。
- 第四批继续补集成方案目录说明：新增 `docs/integration/README.md`，说明接口模板、集成关系、MDM 治理方案和选型评分材料只作方案参考，不替代流程落位或系统选型结论。
- 第四批继续补会议记录目录说明：新增 `docs/meetings/README.md`，说明会议记录和供应商洽谈材料只解释当时背景，正式口径需沉淀到真源、计划或 ADR。
- 第四批继续补组织真源目录说明：新增 `docs/organization/README.md`，说明部门清单、部门到域映射、组织编码、岗位和人员同步应优先核对 `组织架构和部门职责.md`。
- 第四批继续补计划目录说明：新增 `docs/plans/README.md`，说明计划和检查记录只解释阶段性安排，不能覆盖当前边界文件、真源和脚本入口。
- 第四批继续补参考资产目录说明：新增 `docs/外部参考/README.md`、`docs/training/README.md`、`docs/Demo/README.md`、`docs/screenshots/README.md`、`docs/U8SoftHelp/README.md`，说明外部参考、培训、演示、截图和 U8 帮助文件都不替代当前真源；同步修正 `docs/Demo/CLAUDE.md` 中的实际主文件名。
- 第四批继续补 PMO 子目录说明：新增 `pmo/archive/README.md`、`pmo/deliverables/README.md`、`pmo/procedure-management/README.md`、`pmo/scripts/README.md`，区分历史快照、交付物、流程地图驾驶舱和 PMO 局部 smoke 脚本；不改 PMO 真源、JSON 或驾驶舱 HTML。
- 第四批继续清理废弃 AI 协作入口：根据用户确认，删除本地未跟踪的 `.claude/skills/claude-to-im` 失效入口，并从 `skills-lock.json` 移除 `claude-to-im` 记录；历史审计报告不回写。
- 第四批继续补根目录散放资产分流：新增 `docs/reports/2026-06-10-root-loose-asset-triage.md`，将根目录文件分为保留、待复核迁移或已过时结论；随后将孤立布局脚本迁入 `scripts/analyze-layout.js` 并补 `npm run analyze:layout`，将 `temp_survey.txt` 原样迁入 `docs/HardwareResearch/06B厂房接入民机非密园区网需求调查表_抽取文本.txt`，静态资产仍不移动。
- 第四批继续补 AI/快照工作区说明：新增 `.agents/README.md`、`.claude/README.md`、`.planning/README.md`、`.superpowers/README.md`、`ai_materials/README.md`、`snapshots/README.md`，说明技能配置、历史计划、brainstorm 输出、AI 输入材料和 norms 历史快照都不替代当前真源。
- 第四批继续补忽略型输出工作区审计：新增 `docs/reports/2026-06-11-ignored-artifact-workspace-audit.md`，确认 `.playwright-cli/`、`output/`、`tests/__pycache__/` 均已忽略且未跟踪，`.superpowers/` 属于已跟踪历史输出，后续迁移需提案。
- 第四批继续补大体积参考资产迁移提案：新增 `docs/reports/2026-06-11-large-reference-asset-migration-proposal.md`，量化 `docs/U8SoftHelp/`、`docs/外部参考/`、`docs/training/`、`ai_materials/` 等目录体积并给出迁移路径；不移动大文件。
- 第四批继续补 PMO 双份任务数据校验：新增 `scripts/check-pmo-task-data.mjs` 和根命令 `npm run test:pmo-task-data`，校验 `pmo/tasks.json`、`pmo/gantt-react/public/tasks.json` 以及两份 source manifest 同源同 hash。
- 追加 2026-06-11 回归记录：新增 `docs/reports/2026-06-11-remediation-verification-log.md`，记录根主线、MDM 安全、MDM 主线、项目角色和流程治理专项均通过。
- 第四批继续做运行产物收口：补充 `.bak` 和点分隔数据库备份忽略规则，并将已跟踪的 `apps/mdm-platform/data/platform.db.after-admin-reset-20260609-152533.bak`、`scripts/__pycache__/generate_digital_project_gantt_8k.cpython-313.pyc` 从版本管理中移出；本地文件不删除。
- 重复静态资产仍只记录为后续治理项：`echarts.min.js` 多副本和 `pmo/tasks.json` 双副本本轮不迁移，避免误伤 PMO、MDM 和 norms 的静态页面引用约定。
- 第四批继续补资料目录边界：新增 `docs/README.md`，说明 `docs/` 真源入口、子目录职责、根目录历史散放文件口径和修改自检；不移动资料文件。
- 第四批继续补流程真源目录说明：新增 `docs/norms/README.md`，区分标准映射 Markdown、部门配套说明、静态桑基图、跨部门完整性报告和 `_quality-report.md` 生成物；不补写缺失部门映射。
- 第四批继续补审计报告目录说明：新增 `docs/reports/README.md`，明确报告只记录审计、分流和迁移提案，不替代组织、流程、PMO 或 MDM 真源。
- 第四批继续补重复资产迁移提案：新增 `docs/reports/2026-06-10-duplicate-asset-migration-proposal.md`，确认 5 份 `echarts.min.js` 同 hash、两份 PMO `tasks.json` 同 hash；本轮仅标出 `pmo/echarts.min.js` 等后续候选，不移动资产。

## 5. 后续建议顺序

1. 第二批剩余 MDM 安全边界：业务角色过滤口径。
2. 第三批继续处理流程真源完整性：工程技术部候选源归属确认与 canonical 三件套补齐、跨部门风险来源生成口径、历史部门别名。
3. 第四批继续处理仓库边界：补关键 docs 子目录职责说明，再对大体积资料与重复资产写迁移提案。
4. 第五批处理架构债：前端拆分、测试框架、大脚本拆分和性能问题。
