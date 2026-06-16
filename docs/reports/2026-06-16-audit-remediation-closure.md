# 2026-06-16 审计修复关闭报告

> 对应审计：`docs/reports/2026-06-15-full-repo-audit-summary.md`
> 对应计划：`docs/superpowers/plans/2026-06-16-full-repo-audit-remediation.md`
> 分支：`codex/mdm-local-baseline`
> 状态：计划内修复已完成，最终回归通过。

## 1. 关闭提交

| 顺序 | 提交 | 关闭范围 |
|---:|---|---|
| 1 | `4d7f733 docs: record audit remediation baseline` | 记录执行前分支、既有脏工作区和基线验证结果 |
| 2 | `9cc6014 fix: add mdm http security controls` | CSRF、会话固定、基础安全响应头、登录失败限流、session secret 安全默认值 |
| 3 | `117849b fix: replace fixed initial passwords` | 固定初始密码、弱密码策略、前端 Toast 明文展示初始密码 |
| 4 | `48d266b fix: enforce rbac write boundaries` | 主数据写接口 RBAC 边界、审批/治理链路遗留 admin fallback |
| 5 | `f84c8c5 fix: harden mdm frontend rendering` | inline `onclick` XSS 面、ECharts tooltip 转义、roleWorkbench `todo/all` 模式区分 |
| 6 | `f840fc0 fix: strengthen mdm data integrity` | 编号事务、组织/分类树成环、冲突流程 GET 写副作用、冲突外键、迁移 `SELECT *` 风险、协调阈值与 resolve/final-decide 一致性 |
| 7 | `2ad6897 fix: isolate process governance scripts` | 主线同步强制 `MDM_DB_PATH`、组织同步默认 dry-run、应用导入读取快照、质量报告默认落到 `docs/reports/`、HTML 替换与批量归一化安全默认、硬编码本机路径移除 |
| 8 | `b184952 fix: separate pmo runtime deliverable assets` | PMO 上传原件与运行态历史迁移到 `artifacts/pmo/deliverables/`，版本目录只保留受控交付物 Markdown |
| 9 | `243622a docs: close engineering process source gap` | `docs/contracts/` 责任、工程技术部保守版 DCM 真源、工程技术部预览页、公司级流程快照和 PMO 嵌入数据刷新 |

## 2. CRITICAL / HIGH 关闭矩阵

| 审计项 | 状态 | 关闭提交 |
|---|---|---|
| 缺少 CSRF 防护 | 已关闭 | `9cc6014` |
| 登录会话固定风险 | 已关闭 | `9cc6014` |
| 响应头安全基线缺失 | 已关闭 | `9cc6014` |
| 无暴力破解防护 | 已关闭 | `9cc6014` |
| Session secret 允许不安全 fallback | 已关闭 | `9cc6014` |
| 固定首次登录密码与历史固定口令 | 已关闭 | `117849b` |
| 弱密码策略 | 已关闭 | `117849b` |
| 创建/重置密码后前端明文 Toast | 已关闭 | `117849b` |
| inline `onclick` 用户字符串拼接 XSS 面 | 已关闭 | `f84c8c5` |
| ECharts tooltip 未转义拼接点 | 已关闭 | `f84c8c5` |
| roleWorkbench `todo/all` 分支恒等 | 已关闭 | `f84c8c5` |
| 治理链路依赖 `users.role='admin'` fallback | 已关闭 | `48d266b` |
| 主数据写接口仅 `requireAuth` | 已关闭 | `48d266b` |
| 编号引擎事务外取号 | 已关闭 | `f840fc0` |
| 组织/分类树循环引用 | 已关闭 | `f840fc0` |
| 表重建迁移使用 `SELECT *` | 已关闭 | `f840fc0` |
| 冲突相关表缺少外键 | 已关闭 | `f840fc0` |
| 工程技术部映射真源缺失 | 已关闭为保守版 DCM；A1/MDM 要求仍列后续确认 | `243622a` |
| 硬编码本机路径 | 已关闭 | `2ad6897` |
| HTML 正则替换与批量覆盖风险 | 已关闭 | `2ad6897` |
| 主线同步误写共享库 | 已关闭 | `2ad6897` |
| 组织同步批量归档副作用 | 已关闭 | `2ad6897` |
| 应用导入跨边界扫描 `docs/norms` | 已关闭 | `2ad6897` |
| PMO 运行态与版本资产混线 | 已关闭 | `b184952` |
| `docs/contracts/` 责任不明 | 已关闭 | `243622a` |
| 质检报告默认写入 `docs/norms` | 已关闭 | `2ad6897` |

## 3. 计划外保留项

| 审计项 | 本轮处理 | 后续归属 |
|---|---|---|
| 根 `README.md` 部门口径漂移 | 未纳入本计划，避免扩大文档面 | 仓库入口文档整理 |
| 统计值硬编码 | 本轮主线校验继续通过；未做统计口径重构 | 流程治理校验演进 |
| capabilities 自引用循环约束 | 本轮覆盖组织/分类树成环；capabilities 专项约束后续处理 | MDM schema versioning |
| 冲突字段白名单代码与 DB CHECK 不一致 | 冲突流程关键路径已修复；枚举归一化后续处理 | MDM 数据模型治理 |
| 冲突检测 O(n²) | 性能优化未纳入 P0-P4 修复 | MDM 性能优化 |
| `dept_ids filter(Boolean)` | 未纳入本计划，需结合 ID 取值域确认影响 | MDM API 清理 |
| 前端 fetch `.catch` 覆盖不足 | 安全敏感渲染已修复；错误处理体验后续集中处理 | MDM 前端模块化 |
| 前端集中 mutable 全局 state | 作为架构债保留 | MDM 前端模块化 |
| 5300 行单文件前端 | 作为架构债保留 | MDM 前端模块化 |
| legacy `users.role` 与 RBAC 双轨 | 治理写路径已收敛到 RBAC；完全移除 legacy 需迁移窗口 | MDM 权限迁移 |
| 默认 MemoryStore session | 安全默认已增强；持久化 session store 属部署架构事项 | MDM 部署架构 |
| SQLite 内联条件迁移 | 本轮修复高风险迁移；显式 schema version 后续处理 | MDM schema versioning |
| 重复 `handleDbError` / `runDbAction` | 未纳入本计划 | MDM 路由重构 |
| 根/app 脚本体系割裂 | 已补边界隔离；入口整合后续处理 | 仓库脚本治理 |
| Python 依赖未锁定 | 路径可移植性已修复；依赖锁定后续处理 | 脚本运行环境治理 |

## 4. 最终验证

| 范围 | 命令 | 结果 |
|---|---|---|
| MDM 前端资产 | `cd apps/mdm-platform; npm run test:frontend` | 通过 |
| MDM 项目角色 | `cd apps/mdm-platform; npm run test:project-roles` | 通过 |
| MDM 角色工作台 | `cd apps/mdm-platform; npm run test:role-workbench` | 通过 |
| MDM 流程治理 | `cd apps/mdm-platform; npm run test:process-governance` | 通过 |
| MDM 主线 | `cd apps/mdm-platform; npm run test:mainline` | 通过 |
| MDM 安全 | `cd apps/mdm-platform; npm run test:security` | 通过 |
| 根流程治理主线 | `npm run test:process-governance-mainline` | 通过 |
| 部门域映射 | `npm run test:dept-domain-mapping` | 通过 |
| 源文件指纹 | `npm run test:source-manifest-hashes` | 通过 |
| PMO 插件端点 | `cd pmo/gantt-react; npm run test:plugin` | 通过 |
| PMO 写回 | `cd pmo/gantt-react; npm run test:writeback` | 通过 |
| PMO frontmatter | `cd pmo/gantt-react; npm run test:frontmatter` | 通过 |
| PMO 构建 | `cd pmo/gantt-react; npm run build` | 通过 |

补充验证：

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run test:engineering-source-manifest` | 通过 | 工程技术部源目录、保守版 DCM、预览页和剩余 MDM 缺口一致 |
| `npm run test:norms-source-manifest` | 通过 | 9 个部门均在合同中；工程技术部仍为唯一 canonical 缺口，原因是 MDM 要求说明未完成 |
| `node scripts/check-dcm-bbm.mjs --no-fail` | 通过执行，生成报告 | 报告模式输出 `BLOCK=236 WARN=161`，属于存量质量报告项；默认输出已在 `docs/reports/`，未写回 `docs/norms/` |
| `node scripts/audit-a1-transfer-evidence.mjs --no-write` | 通过 | `A1=1334 findings=0`，未写报告 |

## 5. 残余风险

1. 工程技术部本轮只建立保守版 DCM 主映射；A1、审批链、跨部门输入输出、MDM 要求说明和应用承接仍需工程技术部逐条确认。
2. `node scripts/check-dcm-bbm.mjs --no-fail` 仍报告存量 BLOCK/WARN，本轮只修复报告落位和工程技术部源缺口，不把存量质量项全部视为关闭。
3. 工作区仍有执行前已存在或用户侧生成的未提交改动；本轮提交未回滚、未重排这些文件。
