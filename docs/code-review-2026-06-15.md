# Infomat 全库代码审查报告

**审查日期**: 2026-06-15
**审查范围**: 213 个代码文件，~50 张数据库表，1 个 5300 行前端文件
**审查方法**: 7 个并行专业代理，覆盖安全、数据库、前端、路由（业务域+主数据域）、脚本、架构

---

## 严重问题 (CRITICAL) — 共 15 项

### 安全

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| C1 | 会话固定漏洞 | `routes/org.js:304-316` | 登录成功未调用 `req.session.regenerate()`，攻击者可劫持会话 |
| C2 | 完全缺少 CSRF 防护 | `server/index.js` (全局) | 无 csurf/CSRF token，所有 POST/PUT/DELETE 可被跨站攻击 |
| C3 | 弱默认密码 '000000' | `passwordPolicy.js:1-3` | 所有用户初始密码固定，可被批量撞库 |

### 数据库与SQL注入

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| C4 | 动态列名 SQL 注入风险 | `routes/fieldEntries.js:163-164` | 字段名来自白名单直接拼接 SQL，若白名单被污染即构成注入 |
| C5 | 数据库值作为 SQL 列名 | `routes/conflicts.js:786` | `conflict_field` 取自 DB 直接拼入 UPDATE SET，仅靠 CHECK 约束防御 |
| C6 | 表重建迁移可能丢数据 | `db.js:347-398, 698-763, 1066-1135` | 4 处使用 `INSERT INTO new SELECT * FROM old` 重建表，列顺序漂移则数据丢失 |

### 前端 XSS

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| C7 | HTML onclick 属性 XSS | `public/index.html:~5094, ~5185` | `escapeHtml` 将 `'` 编码为 `&#39;`，HTML 解析器在 JS 执行前将其解码回 `'`，造成注入 |
| C8 | 转义函数不一致 | `public/index.html:1272 vs 4698` | `escHtml` 不转义单引号但输出被放入 onclick，可破坏 JS 字符串 |

### 业务逻辑

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| C9 | 审批流 fallback 使用遗留角色 | `routes/mappings.js:329, 339` | 用 `users.role='admin'` 而非 RBAC 查管理员，纯 RBAC 体系下审批被绕过 |
| C10 | 编码引擎事务外调用 | `routes/position.js:48` 等多处 | `generateCode()` 先消耗序列号再 INSERT，INSERT 失败时不回滚序列 |
| C11 | 树节点循环引用无检测 | `routes/orgUnit.js:60-77` | PUT 设置 parent 时未检测是否会形成环，可导致无限递归 |
| C12 | roleWorkbench 恒等分支 | `routes/roleWorkbench.js:487` | `mode='todo'` 和 `mode='all'` 分支代码完全相同，功能区分失效 |
| C13 | 冲突表缺少外键约束 | `db.js:307-324` | `conflict_assignments` 和 `conflict_coordination_history` 的 `conflict_id` 无 FK |

### 脚本可移植性

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| C14 | 硬编码 Windows 绝对路径 | `scripts/merge_norms.py:11-12` | `SRC = Path(r"E:\CA001\Infomat\docs\norms")` 仅在一台机器可用 |
| C15 | 硬编码 Chrome 路径 | `scripts/render_gantt_h5_png.mjs:10` | `C:\Program Files\Google\Chrome\...` — Linux/macOS 不可用 |

---

## 高危问题 (HIGH) — 共 22 项

### 安全加固

| # | 问题 | 文件 |
|---|------|------|
| H1 | 无安全响应头 (helmet) | `index.js:12-29` |
| H2 | 密码策略过弱 (仅要求≥6位) | `routes/org.js:416` |
| H3 | 无暴力破解防护 | `routes/org.js:304-316` |
| H4 | external_key 对集成系统过度暴露 | `routes/integration.js:89-98` |
| H5 | Session secret 硬编码 fallback | `index.js:8-9` |
| H6 | 前端密码明文出现在 Toast 中 | `public/index.html:4932, 4959` |
| H7 | ECharts tooltip 未转义服务器数据 | `public/index.html:2407-2415, 3107-3114` |

### 数据完整性

| # | 问题 | 文件 |
|---|------|------|
| H8 | 大量 FK 列缺少索引 (10+处) | `db.js` 多张表 |
| H9 | SCD Type 2 实现不完整 | `db.js` — 缺少 CHECK 约束和行关闭逻辑 |
| H10 | attribute_value 多态值列无类型一致性约束 | `db.js:579-596` |
| H11 | person 表与 users 表数据重复无同步 | `db.js` V1+V2 表 |

### 业务逻辑

| # | 问题 | 文件 |
|---|------|------|
| H12 | DELETE departments 缺少级联处理 | `routes/org.js:185-189` |
| H13 | attribute boolean 转换错误 (`"false"` → 1) | `routes/attribute.js:93` |
| H14 | Excel 导入缺少行数限制 | `routes/import.js:77-94` |
| H15 | 审批端点无状态转换校验 (x3) | `capabilities.js, processes.js, terminology.js` |
| H16 | 桑基图数据泄露：所有用户可见全部部门 | `routes/views.js:20` |
| H17 | DELETE 映射/流程后 version_log 孤儿 | `mappings.js, processes.js` |

### 脚本/工具

| # | 问题 | 文件 |
|---|------|------|
| H18 | COM 对象泄漏风险 (Word/Visio) | `.agents/.../evidence_extractor.py` |
| H19 | 大量代码重复 (8+ 函数在 4-5 文件重复) | 多个 `scripts/*.mjs` |
| H20 | 脆弱 HTML 正则 patching | `scripts/parse-sankey-data.mjs` |
| H21 | 无 DRY-RUN 批量覆盖 HTML | `scripts/normalize-norms-sankey-h5.mjs` |
| H22 | Python 字体仅在 Windows 路径查找 | `scripts/generate_digital_project_gantt_8k.py` |

---

## 中等问题 (MEDIUM) — 共 20 项

| # | 问题 | 文件 |
|---|------|------|
| M1 | API Key 认证时序侧信道 | `integrationAuth.js:8-16` |
| M2 | 错误日志全量泄露错误对象 | 全部 29 个路由文件 |
| M3 | 旧版权限与 RBAC 双轨并存 | `auth.js:81-98, 112-117` |
| M4 | `isAdmin()` 在两个文件中重复定义 | `auth.js:50`, `access.js:4` |
| M5 | capabilities 表自引用无循环约束 | `db.js:92-103` |
| M6 | FIELD_ENTRY_CONFLICT_FIELDS 与 CHECK 不一致 | `conflicts.js:6` |
| M7 | codeEngine takeSeq SELECT-then-UPDATE 非原子 | `codeEngine.js:11-26` |
| M8 | GET /conflicts 有写副作用 (自动升级) | `conflicts.js:198-302` |
| M9 | 协调提交"双方完成"判断用硬编码 2 | `conflicts.js:533` |
| M10 | resolve vs final-decide 路径不对称 | `conflicts.js:549-813` |
| M11 | 冲突检测 O(n²) 算法 | `conflicts.js:652-749` |
| M12 | dept_ids filter(Boolean) 过滤掉 ID=0 | `views.js:22` |
| M13 | 版本历史无权限检查 | `versions.js:6-32` |
| M14 | 所有列表端点缺少分页 | 7+ 个路由 |
| M15 | DELETE 递归查询 N+1 问题 | `capabilities.js:75-107` |
| M16 | 变更检测 null/undefined/'' 视为等值 | `fieldEntries.js:146` |
| M17 | import.js 循环内重复计算权限 | `import.js:103-104` |
| M18 | position DELETE 未检查活跃任岗 | `position.js:82-94` |
| M19 | 前端 15+ fetch() 调用无 .catch() | `public/index.html` 多处 |
| M20 | 前端 mutable 全局状态无追踪 | `public/index.html:1254` |

---

## 架构问题 (ARCHITECTURE)

| # | 影响 | 问题 |
|---|------|------|
| A1 | 高 | `handleDbError`/`runDbAction` 在 20+ 文件中重复定义，实现已出现不一致 |
| A2 | 高 | 5300 行单文件前端 — 零模块化，不可测试，git merge 冲突必然 |
| A3 | 高 | SQLite 内联迁移无版本号 — 12+ 条件迁移每次启动扫描，不可回滚 |
| A4 | 高 | 双轨认证 V1 (users.role) + V2 (RBAC) — 权限判断路径不唯一 |
| A5 | 高 | express-session MemoryStore — 重启丢失登录态，无法多进程 |
| A6 | 中 | 两份 package.json 独立维护，两套 scripts/ 目录 |
| A7 | 中 | 无 Python requirements.txt |
| A8 | 中 | 无自动化测试框架 — 50+ 手动 HTTP 脚本 |

---

## 统计汇总

| 严重程度 | 数量 |
|----------|------|
| 严重 (Critical) | 15 |
| 高 (High) | 22 |
| 中 (Medium) | 20 |
| 架构 | 8 |
| **总计** | **65** |

---

## 优先修复建议 (TOP 10)

1. **C7/C8 — 前端 XSS**：用 `data-*` 属性 + 事件委托替换所有 inline `onclick`，统一转义函数
2. **C1 — 会话固定**：登录成功调用 `req.session.regenerate()`
3. **C2 — CSRF 防护**：引入 csurf 中间件 + CSRF token
4. **C3 — 弱密码**：用 `crypto.randomBytes()` 生成随机初始密码
5. **C9 — 审批绕过**：将 mappings.js 的 admin 查询从 `users.role` 迁移到 RBAC
6. **C4/C5 — SQL 注入**：动态列名映射到白名单校验，禁止直接拼接
7. **C10 — 编码引擎**：将 `generateCode()` 移入事务
8. **C11 — 树循环**：PUT orgUnit/classNode/roles 时加循环引用检测
9. **H8 — 索引缺失**：为 10+ 个高频 JOIN/WHERE 的 FK 列加索引
10. **A2 — 前端拆分**：按 Tab 功能域拆分为 ES 模块
