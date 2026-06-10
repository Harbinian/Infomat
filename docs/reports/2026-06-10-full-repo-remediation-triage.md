# Infomat 全库整改分流报告

> 日期：2026-06-10
> 范围：本报告只归并和分流本轮全库审查发现，不作为流程真源、PMO 真源或 MDM 配置真源。
> 执行策略：分批推进。第一批完成第 0 层核验分流和第 1 层验证体系止血；第二批先处理 MDM 安全边界中可明确测试的最小切片。

## 1. 实测基线

| 检查项 | 命令 | 当前结论 |
|---|---|---|
| 根目录流程治理主线合约 | `npm run test:process-governance-mainline` | 已通过 |
| MDM 主线稳定性 | `cd apps/mdm-platform && npm run test:mainline` | 已通过 |
| MDM 安全专项 | `cd apps/mdm-platform && npm run test:security` | 已覆盖基础主数据越权、用户目录权限、最小候选人接口、字段约束读写、session secret 和 RBAC 管理员判断红线 |

口径修正：

- MINIMAX 关于根目录缺少 `sync:process-governance` 和 `scripts/sync-process-governance-mainline.mjs` 的结论已过时；当前 `package.json` 已有该脚本入口，目标脚本也存在。
- Trae 关于 `test:security` 红线和基础主数据写接口覆盖盲区的结论已确认；安全测试原先会在 Excel 断言处提前失败，后续越权断言跑不到。
- Deepseek 对前端单文件、测试框架、脚本膨胀等问题的判断保留为长期架构债，不进入第一批修复。

## 2. 问题分流

| 层级 | 主题 | 状态 | 第一批处理 |
|---|---|---|---|
| 第 1 层 | 安全测试固定列位断言脆弱 | 已确认 | 已纳入 |
| 第 1 层 | 普通登录用户可写基础主数据 | 已确认 | 已纳入 |
| 第 2 层 | 旧 `users.role` 与 RBAC 管理员判断并存 | 已确认 | 第二批小片已处理管理员判断 |
| 第 2 层 | 默认口令 `init1234` 制度化 | 已确认 | 延后 |
| 第 2 层 | `SESSION_SECRET` 固定回退 | 已确认 | 第二批小片已处理 |
| 第 2 层 | `/api/org/users` 员工目录暴露面过宽 | 已确认 | 第二批小片已处理目录收窄、后端候选人接口和前端切换 |
| 第 2 层 | `applyFieldConstraints` readonly 未执行 | 已确认 | 第二批小片已处理读写两侧 |
| 第 3 层 | 工程技术部流程映射交付物缺失 | 已确认风险 | 延后 |
| 第 3 层 | `crossDept` 从报告 Markdown 派生 | 已确认风险 | 第三批小片已处理校验不固化数字 |
| 第 3 层 | `综合管理部` 等历史/幽灵部门口径 | 待复核 | 延后 |
| 第 4 层 | README / PMO 文档引用不存在入口或截图 | 已确认 | 第四批小片已处理失效导航 |
| 第 4 层 | 重复静态资产、日志、数据库备份、缓存入库 | 待复核 | 延后 |
| 第 5 层 | 前端单文件、测试 helper 重复、大脚本膨胀 | 已归类 | 延后 |
| 第 5 层 | 编码流水号并发、审批状态机、冲突检测性能 | 待复核 | 延后 |

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
- 追加第二批安全红线：生产模式缺少 `SESSION_SECRET` 不得启动、普通用户不能读取全员用户目录、字段约束需剥离 `exclude` 并标记 `readonly`。
- 第二批对应最小实现：`/api/org/users` 增加管理员权限，`applyFieldConstraints` 在普通 GET 响应中加载有效字段约束并输出 `_readonly_fields`，`server/index.js` 不再使用隐式固定 session secret。
- 追加 RBAC 管理员红线：旧角色不是 `admin`、但具备 RBAC `admin` 角色的用户应能执行管理员归档动作。
- 第二批继续收敛管理员判断：`auth.isAdmin`、旧数据权限管理员旁路、冲突归档、术语维护和集成凭据管理改用 RBAC 管理员口径。
- 追加字段级写保护红线：具备受限写权限的用户不能写入该权限声明的 `readonly` 字段，但仍可写入非只读字段。
- 第二批继续执行字段约束：`requirePermission` 对写请求检查当前权限码的 `readonly` 字段，命中后返回 `403`。
- 追加用户目录替代红线：普通报送人不能查看指派候选人，冲突处理角色只能通过 `/api/org/users/assignable` 获取 `id/name/department_id/dept_name`。
- 第二批继续收窄员工目录：`/api/org/users` 保持管理员专用，新增后端最小候选人接口，并将冲突指派弹窗切到 `/api/org/users/assignable`。
- 追加第三批校验红线：`check-dashboard-data.mjs` 不得把 `crossDept` 统计固化为 `168/6/1` 等历史数字。
- 第三批先做只读校验收敛：`check-dashboard-data.mjs` 从 `跨部门完整性检查报告.md` 解析统计值，并与 `docs/company-sankey-data.json.crossDept`、PMO 内嵌 `#cross-dept-data` 比对；不改流程真源和生成快照。
- 第四批先做导航止血：修正根 README、PMO README、PMO CLAUDE 和流程驾驶舱 CLAUDE 中不存在的甘特入口、截图、旧文档和手工 JSON 替换说明；不移动静态资产或大体积资料。

## 5. 后续建议顺序

1. 第二批剩余 MDM 安全边界：默认口令、业务角色过滤口径。
2. 第三批继续处理流程真源完整性：工程技术部交付物缺失、跨部门风险来源生成口径、历史部门别名。
3. 第四批继续处理仓库边界：补 `scripts/` 与关键 docs 子目录职责说明，再对大体积资料与重复资产写迁移提案。
4. 第五批处理架构债：前端拆分、测试框架、大脚本拆分和性能问题。
