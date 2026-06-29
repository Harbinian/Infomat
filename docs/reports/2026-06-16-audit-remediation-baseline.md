# 2026-06-16 审计修复执行基线

> 状态：执行前基线  
> 对应计划：`docs/superpowers/plans/2026-06-16-full-repo-audit-remediation.md`  
> 审查来源：`docs/reports/2026-06-15-full-repo-audit-summary.md`

## 1. Git 状态

- 当前分支：`codex/mdm-local-baseline`
- 当前目录不是 linked git worktree：`git rev-parse --git-dir` 与 `git rev-parse --git-common-dir` 均为 `.git`
- 当前分支不是 `main` / `master`
- 执行前工作区已有多项未提交改动；本轮不得回滚或重排这些既有改动

执行前 `git status --short` 摘要：

```text
 M .agents/skills/process-evidence-mapping/scripts/build-object-chains.mjs
 M .agents/skills/process-evidence-mapping/scripts/diff-reviewItems-with-mapping.mjs
 M .agents/skills/process-evidence-mapping/scripts/extract-process-input-baseline-review.mjs
 M .agents/skills/process-evidence-mapping/scripts/extract-role-reviewItems.mjs
 M .agents/skills/process-evidence-mapping/scripts/run-process-reviewItem-workflow.mjs
 M .agents/skills/process-evidence-mapping/scripts/test-reviewItem-workflow.mjs
 M .agents/skills/process-evidence-mapping/scripts/update-reviewItem-todo-md.mjs
 M docs/norms/_quality-report.md
 M docs/norms/复材车间部门能力流程系统桑基图.html
 M docs/norms/流程治理/输入基线问题待办.md
 M docs/norms/物资保障部部门能力流程系统桑基图.html
 M docs/norms/经营发展部部门能力流程系统桑基图.html
 M docs/norms/行政人事部部门能力流程系统桑基图.html
 M docs/norms/财务部部门能力流程系统桑基图.html
 M docs/norms/质量管理部部门能力流程系统桑基图.html
 M docs/norms/运维安环部部门能力流程系统桑基图.html
 M docs/norms/项目管理部部门能力流程系统桑基图.html
 M docs/organization/花名册.md
 M docs/reports/2026-06-11-engineering-source-manifest.md
 M docs/reports/2026-06-11-norms-source-manifest.md
 M package-lock.json
 M package.json
 M scripts/README.md
 M scripts/check-engineering-source-manifest.mjs
?? docs/code-review-2026-06-15.md
?? docs/norms/工程技术部部门能力流程系统桑基图.html
?? docs/organization/花名册岗位名称问题清单批注.md
?? docs/reports/2026-06-15-full-repo-audit-summary.md
?? docs/superpowers/plans/2026-06-16-full-repo-audit-remediation.md
?? scripts/build-reviewItem-sankey-preview.mjs
?? scripts/input-baseline-review-core.mjs
?? scripts/input-baseline-review-service.mjs
?? scripts/import-input-baseline-review-mysql.mjs
?? scripts/init-input-baseline-review-mysql.mjs
?? scripts/mark-sankey-preview-status.mjs
?? scripts/test-input-baseline-review-mysql.mjs
?? scripts/test-reviewItem-sankey-preview.mjs
?? scripts/test-sankey-preview-status.mjs
```

## 2. 根级流程治理主线

命令：

```powershell
npm run test:process-governance-mainline
```

结果：通过。

关键输出：

```text
Process governance mainline contract test passed
Dashboard data check passed.
Department domain mapping check passed: 9 departments
Engineering source manifest check passed: source directory, preview Sankey, 2 canonical gaps, and 47 review files
Source manifest hash check passed: 1613 files
Norms source manifest check passed: 9 departments, known gap 工程技术部
PMO task data check passed: 467 tasks, tasks 74936214301b, manifest db46f9392b8b
Process governance mainline checks passed
```

基线含义：

- 根级流程主线当前可验证。
- `工程技术部` 仍作为已知真源缺口存在，后续按计划 Task 9 处理。

## 3. MDM 平台基线

命令：

```powershell
cd apps/mdm-platform
npm run test:db-path
npm run test:security
npm run test:role-workbench
npm run test:process-governance
npm run test:mainline
```

结果：全部通过。

关键输出：

```text
DB path isolation test passed
User password script test passed
Password audit test passed
Route write permission audit test passed
Security route integration test passed
Role workbench API test passed
Process governance org sync test passed
Process governance schema test passed
Process governance import test passed
Process governance quality import test passed
Process mapping workspace import test passed
Process governance API test passed
Process governance frontend hook test passed
Process governance field link test passed
Organization structure sync test passed
Roster user/person import test passed
Product route test passed
Project role access test passed
[mainline] master data object isolated smoke passed
[mainline] stability check passed
```

基线含义：

- 当前 MDM 测试集通过，但尚未覆盖审计报告确认的 CSRF、会话固定、固定初始密码、inline handler XSS 等问题。
- 后续安全任务需要先补会失败的测试，再改实现。

## 4. PMO 甘特图 / 插件基线

命令：

```powershell
cd pmo/gantt-react
npm run test:plugin
npm run test:writeback
npm run build
```

结果：第一条命令失败，后续命令未继续执行。

失败点：

```text
> gantt-react@0.0.0 test:plugin
> node ../scripts/smoke-plugin-endpoints.mjs

Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from E:\CA001\Infomat\pmo\scripts\smoke-plugin-endpoints.mjs
```

环境观察：

```text
pmo/gantt-react/node_modules/vite exists: True
pmo/gantt-react/package-lock.json exists: True
repo root node_modules/vite exists: False
repo root package-lock.json exists: True
```

基线含义：

- 失败不是业务断言失败，而是 PMO smoke 脚本位于 `pmo/scripts` 时无法解析 `pmo/gantt-react/node_modules` 内的 `vite`。
- 后续 PMO runtime 分离任务执行前，需要先修正 smoke 脚本的依赖解析或执行入口。

## 5. 下一步

按计划进入 Task 2：MDM HTTP 安全基础。

Task 2 必须先补失败测试，覆盖：

- 登录成功后 session cookie 变化。
- 已登录写请求缺少 `X-CSRF-Token` 返回 403。
- 已登录用户可获取 CSRF token。
- 连续失败登录触发 429。
- 响应包含基础安全头。
