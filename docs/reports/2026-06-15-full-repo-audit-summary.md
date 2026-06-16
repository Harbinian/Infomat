# Infomat 全库审计摘要（合并版）

**审计日期**：2026-06-15  
**范围**：仓库级脚本（`scripts/`）、PMO（`pmo/`）、MDM 平台（`apps/mdm-platform/`）、资料真源与契约（`docs/`）  
**输入来源**：

- 本次人工审计与抽样测试结论（不做代码改动）
- `docs/code-review-2026-06-15.md` 的审查结论（仅合并已复核或与本次证据一致的部分）

## 0. 复核说明（针对 code-review-2026-06-15）

- 复核策略：逐条对照仓库当前代码与文档，给出“成立 / 部分成立 / 不成立或夸大”的结论与证据链接。
- 本次复核覆盖度（按原报告分组统计）：
  - Critical：15/15 已复核
  - High：14/22 已复核
  - Medium：10/20 已复核
  - Architecture：7/8 已复核

## 1. 仓库主线与边界（共识口径）

- 当前阶段主线为“流程地图与数据地图梳理与沉淀”，分析对象是流程而非具体应用系统。
- 真源/快照/展示的主链路：
  - `docs/organization/组织架构和部门职责.md` + `docs/norms/*部门-能力-流程-系统映射关系.md`（真源）
  - → `scripts/parse-sankey-data.mjs`
  - → `docs/company-sankey-data.json`（快照）
  - → `pmo/procedure-management/dashboard.html`（展示副本，内嵌 `#sankey-data`）
  - → `apps/mdm-platform`（导入快照承接治理，不应反向覆盖真源）

## 2. 严重问题（CRITICAL，已确认）

### 2.1 平台安全

1. **缺少 CSRF 防护（全局）**  
   - 现状：服务端未见 `csurf`/CSRF token 相关实现，所有写接口天然暴露跨站请求风险。  
   - 证据：`apps/mdm-platform/server/` 内无 `csrf/csurf` 相关实现（审计检索）。  

2. **会话固定（session fixation）风险**  
   - 现状：登录流程未见 `req.session.regenerate()`。  
   - 证据：`apps/mdm-platform/server/routes/org.js` 中无 `session.regenerate` 调用（审计检索）。  

3. **统一固定首次登录密码 `000000`（且保留历史固定口令痕迹）**  
   - 现状：`FIRST_LOGIN_PASSWORD = '000000'`，且历史固定口令 `init1234` 仍在策略中被识别。  
   - 证据：`apps/mdm-platform/server/passwordPolicy.js`。  

4. **前端 inline `onclick` 拼接字符串导致 XSS 面（高概率可利用）**  
   - 现状：用户信息被拼进 `onclick="selectUserForRoles(..., '...')"` 形式的 JS 字符串，HTML 转义与 JS 字符串安全并非同一问题域。  
   - 证据：`apps/mdm-platform/public/index.html`（用户角色分配搜索结果渲染）。  

5. **审批/治理链路仍依赖遗留 `users.role='admin'`（RBAC 双轨导致路径不唯一）**  
   - 现状：`mappings` 流程中存在管理员 fallback 查询 `users.role='admin'`。  
   - 证据：`apps/mdm-platform/server/routes/mappings.js`（`SELECT ... FROM users WHERE role='admin'`）。  

6. **响应头安全基线缺失（未接入 helmet）**  
   - 证据：`apps/mdm-platform/server/index.js` 未引入/使用 helmet。  

7. **弱密码策略（至少存在“仅校验长度≥6”的路径）**  
   - 证据：`apps/mdm-platform/server/routes/org.js` 修改密码仅校验 `new_password.length < 6`。  

8. **无暴力破解防护（未见限流/锁定/验证码）**  
   - 证据：`apps/mdm-platform/server/routes/org.js` 登录失败直接 401；未见 rate limit 中间件接入。  

9. **Session secret 允许硬编码 fallback**  
   - 证据：`apps/mdm-platform/server/index.js` 在 `ALLOW_INSECURE_SESSION_SECRET === '1'` 时回退固定字符串。  

10. **创建用户/重置密码后在前端 Toast 明文展示初始密码**  
   - 证据：`apps/mdm-platform/public/index.html` 中 `showToast(... initial_password ...)`。  

11. **ECharts tooltip 存在未转义的服务端数据拼接点（部分成立）**  
   - 成立部分：业务地图 tooltip 直接拼接 `nodeLabels[...]` 等文本生成 HTML，未做 escape。  
   - 不成立部分：流程治理 Sankey tooltip 使用 `safeText` 转义。  

### 2.2 权限边界（主数据写接口）

1. **多类主数据写接口仅 `requireAuth`，无统一 RBAC 闸门**  
   - 影响：低权限已登录用户具备越权写库可能性，且属于系统性模式（非单点疏漏）。  
   - 证据（示例）：  
     - `apps/mdm-platform/server/routes/person.js`（`POST /`、`PUT /:employeeNo` 等）  
     - `apps/mdm-platform/server/routes/product.js`（`POST /`、`PUT /:code`）  
     - `apps/mdm-platform/server/routes/orgUnit.js`（`PUT /:code`）  
     - `apps/mdm-platform/server/routes/attribute.js`（`POST /defs`、`PUT /values`）  

2. **编号引擎“先取号后写入”在事务外使用，可能导致序列消耗不可回滚**  
   - 证据：`apps/mdm-platform/server/codeEngine.js` `takeSeq()` 为 SELECT-then-UPDATE；`routes/position.js` 在 INSERT 前调用 `generateCode(...)`。  

3. **树结构更新缺少循环引用检测（组织/分类树）**  
   - 证据：`apps/mdm-platform/server/routes/orgUnit.js` `PUT /:code` 允许设置 `parent_org_unit_id`，未检测是否成环。  

4. **roleWorkbench 的 mode 分支逻辑恒等（todo/all 功能区分失效）**  
   - 证据：`apps/mdm-platform/server/routes/roleWorkbench.js` 中 `mode === 'todo' ? X : X`。  

### 2.3 数据库与 SQL 动态拼接

1. **动态列名拼接（风险口径需收敛）**  
   - 结论：存在动态列名拼接点，但列名来源是硬编码白名单常量，当前实现不构成“可由用户输入触发的 SQL 注入”。  
   - 证据：`apps/mdm-platform/server/routes/fieldEntries.js` `ALLOWED_FIELD_ENTRY_FIELDS` 白名单常量 + `SET ${field}=?`。  

2. **DB 值作为列名拼接（被双重白名单/约束收敛）**  
   - 结论：`conflict_field` 来自 DB 并进入 `SET ${conflict_field}=?`，但被 DB CHECK + 代码白名单双重限制。  
   - 证据：`apps/mdm-platform/server/routes/conflicts.js`（拼接点）+ `apps/mdm-platform/server/db.js`（CHECK 约束）。  

3. **表重建迁移使用 `SELECT *`（数量为 2 处，存在列顺序风险）**  
   - 结论：风险点成立，但“4 处”表述不准确；实际复核到 2 处 `INSERT INTO new SELECT * FROM old`。  
   - 证据：`apps/mdm-platform/server/db.js` 中 `field_conflicts_new`、`term_conflicts_new` 两处迁移段。  

4. **冲突相关表缺少外键约束（conflict_id 无 FK）**  
   - 证据：`apps/mdm-platform/server/db.js` 中 `conflict_assignments`、`conflict_coordination_history` 的 `conflict_id` 未声明 `REFERENCES conflicts(...)`。  

### 2.3 流程治理真源完整性

1. **工程技术部映射真源缺失导致跨部门链路断裂**  
   - 现状：`docs/norms/` 中缺少 `工程技术部部门-能力-流程-系统映射关系.md`，跨部门完整性报告明确“未映射-无文档”，并记录约 34 条跨部门引用在目标侧断裂。  
   - 证据：  
     - `docs/norms/流程治理/跨部门完整性检查报告.md`  
     - `docs/company-sankey-data.json`（`crossDept.risks` 中的工程技术部高风险项）  

## 3. 高危问题（HIGH，已确认）

### 3.1 脚本可移植性

- **硬编码 Windows 绝对路径**：`scripts/merge_norms.py` 写死 `E:\CA001\Infomat\docs\norms`。  
- **硬编码 Chrome 路径**：`scripts/render_gantt_h5_png.mjs` 写死 `C:\Program Files\Google\Chrome\...`。  
- **字体路径仅覆盖 Windows**：`scripts/generate_digital_project_gantt_8k.py` 仅在 `C:\Windows\Fonts` 查找字体。  

### 3.2 质量脚本的批量改写风险

- **正则 patch HTML（结构敏感）**：`scripts/parse-sankey-data.mjs` 使用正则替换 `<script id="...">...</script>` 块内容。  
- **无 DRY-RUN 的批量覆盖**：`scripts/normalize-norms-sankey-h5.mjs` 检测到差异后直接 `writeFileSync` 覆盖页面。  

### 3.2 运行隔离与“误写共享库”

1. **根级主线同步会默认写入共享 DB（未强制隔离 `MDM_DB_PATH`）**  
   - 现状：`scripts/sync-process-governance-mainline.mjs` 串跑 `apps/mdm-platform` 的 `sync:process-org`、`import:process-governance` 等步骤，仅透传 `process.env`。  
   - 默认 DB：`apps/mdm-platform/server/dbConfig.js` 默认回落 `data/platform.db`。  
   - 风险：一次性同步可能污染共享运行态数据库。  

2. **“同步组织口径”脚本具破坏性副作用（批量归档非白名单部门）**  
   - 现状：`apps/mdm-platform/scripts/sync-process-governance-org.js` 会把不在白名单中的所有 `active` 部门批量改为 `archived`。  
   - 风险：共享库上运行会引发非流程治理部门主数据被静默归档。  

3. **应用导入脚本跨边界依赖仓库真源与根脚本**  
   - 现状：`apps/mdm-platform/scripts/import-process-governance.js` 直接扫描 `docs/norms`，并调用根级 `scripts/check-dcm-bbm.mjs`。  
   - 风险：`apps/mdm-platform` 无法作为独立应用稳定运行/迁移，根目录结构调整会牵连导入链路。  

### 3.3 PMO 运行态与版本资产混线

- **交付物插件把上传原件与状态历史写回版本目录**  
  - 现状：`pmo/gantt-react/plugins/pmoDeliverablesPlugin.js` 会把上传的原始文件归档到 `pmo/deliverables/_history/<id>/...`，并写回交付物 Markdown 正本。  
  - 风险：将运行态材料、上传二进制与交付物正本混入版本控制资产，容易形成脏提交、敏感材料入库、多人协作冲突。  

### 3.4 契约目录与报告落位冲突

1. **`docs/contracts` 已成为执行资产，但边界文件/目录责任未明示**  
   - 现状：`docs/contracts/README.md` 低估使用方范围，且 `DIRECTORY_OWNERSHIP.md` 未将其列为明确子目录责任。  

2. **质检报告默认写回 `docs/norms/_quality-report.md`，与“真源目录不放报告”口径冲突**  
   - 现状：`scripts/check-dcm-bbm.mjs` 默认输出到 `docs/norms/_quality-report.md`。  
   - 风险：真源目录混入生成型报告，易被误当上下文或真源补充。  

## 4. 中等问题（MEDIUM，已确认/高可信）

- **仓库入口文档口径漂移（部门域映射）**：根 `README.md` 仍写“复材一车间/二车间”，但组织真源与脚本已统一为“复材车间”。  
- **仓库级校验脚本对统计值硬编码**：如跨部门统计 `168/6/1` 等固定值校验，会把正常数据演进也固化为“必须等于历史快照”。  
- **capabilities 自引用无循环约束**：表结构允许 `parent_id REFERENCES capabilities(id)`，无 trigger/约束防止环。  
- **冲突字段白名单代码与 DB CHECK 不一致（代码覆盖子集）**：`FIELD_ENTRY_CONFLICT_FIELDS` 与 DB CHECK 集合不同。  
- **编号序列获取非原子（并发下可能重复取号/跳号）**：`takeSeq()` 使用 SELECT-then-UPDATE 未包事务。  
- **GET /conflicts 存在写副作用（自动升级）**：列表查询中调用升级逻辑并执行 UPDATE/INSERT。  
- **协调提交“双方完成”阈值硬编码为 2**：以 `cnt >= 2` 判定双方完成。  
- **resolve 与 final-decide 路径能力不对称**：一个路径会回写采用值，另一路径不回写。  
- **冲突检测存在 O(n²) 双循环**：术语冲突检测使用双层循环。  
- **dept_ids filter(Boolean) 过滤掉 0（实际影响依赖 ID 取值域）**：`split(',').map(Number).filter(Boolean)`。  
- **前端大量 fetch 链未显式 .catch**：文件内 fetch 调用远多于 .catch 处理点。  
- **前端存在集中 mutable 全局 state**：`const state = {...}` 承载大量页面状态。  

## 5. 架构问题（ARCHITECTURE，已确认/高可信）

- **5300 行单文件前端（MDM 平台）**：可维护性与可测试性弱，merge 冲突概率高。  
- **认证与权限双轨（legacy `users.role` + RBAC）**：导致权限判断路径不唯一，审批与治理链更易出现绕过/漏判。  
- **默认 MemoryStore 的 session 架构限制**：未配置持久化 store，重启丢登录态且无法多进程水平扩展。  
- **SQLite 内联条件迁移（无 schema version / user_version）**：以多段条件判断在启动时扫描并执行结构修正/重建，缺少显式版本序列与回滚链路。  
- **错误处理/DB 包装函数重复定义（A1）**：`handleDbError` 至少在 22 个路由文件中重复定义，`runDbAction` 至少在 15 个路由文件中重复定义，且已出现分歧风险。  
- **脚本体系割裂（A6）**：仓库根 `package.json` 与 `apps/mdm-platform/package.json` 两套脚本入口并存。  
- **Python 依赖未锁定（A7）**：仓库未提供 `requirements.txt` 等依赖锁定文件，多个脚本依赖第三方包。  

## 6. 整改优先级建议（TOP 12，只列方向）

1. 安全：为写接口补齐 CSRF 策略（或明确同站/内网模型与替代控制）。  
2. 安全：登录成功后执行会话 regenerate，避免会话固定。  
3. 安全：移除固定首次登录密码（`000000`）与历史固定口令兼容逻辑，改为一次性随机初始化并强制改密。  
4. 前端：消除所有 inline `onclick` 拼接，改用 `data-*` + 事件委托。  
5. 权限：对主数据写接口建立统一 RBAC 闸门，避免“仅登录即可写”的模式扩散。  
6. 审批：移除 `users.role='admin'` fallback，统一走 RBAC。  
7. 数据隔离：根级联动脚本强制要求 `MDM_DB_PATH`，默认拒绝写共享库。  
8. 同步脚本：将“归档非白名单部门”的破坏性行为改为显式确认/干跑模式，并写入脚本说明与边界文件。  
9. 边界：让 `apps/mdm-platform` 导入只依赖快照与明确契约，不直接扫描真源目录与调用根脚本。  
10. PMO：将上传原件与运行态历史件迁出版本资产目录，仓库仅保留脱敏正本。  
11. 契约：补齐 `docs/contracts` 的目录归属与回归清单（列出所有读取该合同的脚本与命令）。  
12. 真源：补齐工程技术部 norms 映射文件，先让跨部门链路闭环再谈系统落位。

## 7. 附：关键证据索引（文件级）

- 安全策略：`apps/mdm-platform/server/index.js`、`apps/mdm-platform/server/passwordPolicy.js`、`apps/mdm-platform/server/routes/org.js`、`apps/mdm-platform/server/routes/mappings.js`、`apps/mdm-platform/public/index.html`  
- 运行隔离：`scripts/sync-process-governance-mainline.mjs`、`apps/mdm-platform/server/dbConfig.js`、`apps/mdm-platform/scripts/sync-process-governance-org.js`  
- PMO 写回：`pmo/gantt-react/plugins/pmoDeliverablesPlugin.js`  
- 真源缺口：`docs/norms/流程治理/跨部门完整性检查报告.md`、`docs/company-sankey-data.json`  
- DB/迁移与约束：`apps/mdm-platform/server/db.js`、`apps/mdm-platform/server/routes/conflicts.js`、`apps/mdm-platform/server/routes/fieldEntries.js`、`apps/mdm-platform/server/codeEngine.js`  
- 可移植性：`scripts/merge_norms.py`、`scripts/render_gantt_h5_png.mjs`、`scripts/generate_digital_project_gantt_8k.py`  
- 批量改写脚本：`scripts/parse-sankey-data.mjs`、`scripts/normalize-norms-sankey-h5.mjs`  
