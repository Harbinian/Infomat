# MDM 平台拓展计划

> 依据：`docs/Demo/信息化系统应用与集成说明会V1.0.html` 中 MDM 五阶段建设要求
> 日期：2026-05-15

---

## 一、差距总览

HTML 文档将 MDM 建设划分为五个阶段：**定标准 → 清存量 → 控过程 → 促集成 → 保运行**。当前 `mdm-platform` 已完成组织架构、流程映射、字段台账、黄金源身份确认、术语管理、冲突检测等基础能力，但在以下核心领域存在缺口：

| 文档阶段 | 关键缺口 | 严重程度 |
|----------|---------|---------|
| 一 · 定标准 | 6 大类主数据实体表缺失、编码规则引擎缺失、属性模板缺失 | **阻塞** |
| 二 · 清存量 | 去重策略引擎缺失、校验规则引擎缺失、多源导入兼容层缺失 | **阻塞** |
| 三 · 控过程 | 主数据生命周期状态机缺失、多级会签机制缺失、4W+1H 细粒度权限缺失 | **高** |
| 四 · 促集成 | 外部系统同步接口缺失、新旧编码映射表缺失、变更通知推送缺失 | **高** |
| 五 · 保运行 | 数据质量 KPI 仪表盘缺失、分批导入回滚缺失、定期巡检机制缺失 | **中** |

---

## 二、拓展模块设计

### 模块 A：主数据实体注册中心（Master Data Registry）

**对应文档阶段：** 一（定标准）+ 二（清存量）

**新增数据表：**

```
master_data_categories        — 6 大类（零组件/工艺组件/工装/原材料/设备/工具）
master_data_attributes        — 每类的属性模板（必填/可选、类型、校验规则）
master_data_items             — 主数据条目（统一编码、分类、属性 JSON、状态）
master_data_code_rules        — 编码规则配置（按分类定义段结构）
master_data_import_batches    — 分批导入批次记录
master_data_import_log        — 导入明细日志（含行级错误）
```

**核心能力：**

1. **编码自动生成** — 按分类 + 编码规则自动生成唯一编码，预留 30 位扩展空间
2. **属性模板引擎** — 按分类动态加载必填/可选字段，支持格式校验（标准号、牌号、供应状态等）
3. **批量导入校验** — 支持 Excel 批量导入，逐行校验后写入，异常行回滚记录
4. **去重检测** — 基于图号+名称+规格的相似度去重算法，标记可疑重复待人工确认

**涉及文件：**
- `server/db.js` — 新增 6 张表
- `server/routes/masterData.js` — CRUD + 编码生成 + 批量导入
- `public/index.html` — 新增 Tab「主数据台账」

---

### 模块 B：主数据生命周期引擎（Master Data Lifecycle）

**对应文档阶段：** 三（控过程）

**状态机设计：**

```
新增(draft) → 审核中(review) → 生效(active) → 变更中(changing) → 停用(discontinued) → 归档(archived)
                    ↓                    ↑
                 退回(rejected)    ← 变更驳回
```

关键规则：
- 不允许物理删除，停用/归档保留完整历史
- 变更需经过多级会签（如物料变更需仓储 + 技术 + 质量联合审批）
- 变更生效后触发通知

**新增数据表：**

```
master_data_change_requests   — 变更申请（关联 master_data_items）
master_data_change_approvals  — 变更审批记录（支持多级会签）
master_data_status_log        — 状态变更历史
```

**涉及文件：**
- `server/routes/masterDataLifecycle.js` — 状态流转 + 审批
- `server/db.js` — 新增 3 张表
- `public/index.html` — Tab 内嵌审批面板

---

### 模块 C：细粒度权限系统（4W+1H RBAC）

**对应文档阶段：** 三（控过程）

**当前状态：** auth.js 仅支持 `submitter / owner / reviewer / admin` 四级角色，权限粒度按映射表行级可见性控制。

**拓展方向：**

| 维度 | 当前 | 目标 |
|------|------|------|
| Who（角色） | 4 个固定角色 | 角色 + 部门复合身份 |
| What（对象） | 映射表级 | 细化到主数据分类级 |
| How（操作） | CRUD 全开/全关 | 按主数据类型区分增/删/改/查/审批 |
| When/Where | 无 | 可选（未来对接网络策略） |

**实现方式：** 扩展现有 `access.js` 的模式，新增 `masterDataAccess()` 函数，按 master_data_categories 与部门归属做行级过滤。

**不引入新表** — 复用 `user_dept_roles` 并在 `users` 表增加 `permissions` JSON 字段。

**涉及文件：**
- `server/auth.js` — 增加 `requireDataPermission(category, action)` 中间件
- `server/access.js` — 增加 `masterDataVisibility()`
- `server/db.js` — `users` 表加 `permissions TEXT` 字段

---

### 模块 D：系统集成接口层（Integration API）

**对应文档阶段：** 四（促集成）

**向外暴露的 API：**

| 端点 | 方法 | 用途 | 消费方 |
|------|------|------|--------|
| `/api/integration/materials` | GET | 查询物料主数据（支持增量同步） | ERP / MES |
| `/api/integration/materials/:code` | GET | 按编码查询单个物料 | ERP / MES / PLM |
| `/api/integration/materials/sync-status` | GET | 查询同步状态（哪些记录自某时间后变更） | 所有消费系统 |
| `/api/integration/old-code/:oldCode` | GET | 旧编码→新编码映射查询 | ERP / MES |

**向内的回调（接收外部系统反馈）：**

| 端点 | 方法 | 用途 | 主写方 |
|------|------|------|--------|
| `/api/integration/callback/stock-change` | POST | MES 库存变动反馈至 MDM | MES |
| `/api/integration/callback/consistency-check` | POST | 消费系统上报数据一致性校验结果 | ERP / MES |

**新增数据表：**

```
integration_sync_log          — 同步日志（谁、何时、拉取了哪些数据）
old_new_code_mapping          — 新旧编码映射
integration_credentials       — 外部系统 API 凭证（仅存 hash）
```

**安全约束：**
- 集成接口使用 API Key 认证（非 Session），Key 仅存 bcrypt hash
- 消费系统只有只读权限，不允许回写覆盖 MDM 标准值

**涉及文件：**
- `server/routes/integration.js` — 集成接口路由
- `server/integrationAuth.js` — API Key 认证中间件
- `server/db.js` — 新增 3 张表

---

### 模块 E：数据质量监控仪表盘（Data Quality Dashboard）

**对应文档阶段：** 五（保运行）

**5 项 KPI 指标：**

| 指标 | 计算方式 | 目标值 | 监控频率 |
|------|---------|--------|---------|
| 完整率 | 必填字段非空的条目占比 | ≥ 99% | 月度 |
| 准确率 | 字段值与标准一致的条目占比 | ≥ 98% | 季度 |
| 唯一率 | 无重复编码的条目占比 | 100% | 月度 |
| 及时率 | 变更后 24h 内同步的占比 | ≥ 95% | 实时 |
| 消费一致率 | ERP/MES 与 MDM 一致的占比 | ≥ 99% | 月度 |

**实现方式：**
- 后端新增 `/api/quality/dashboard` 端点，返回当前 KPI 数值
- 前端用 ECharts 渲染仪表盘（已有 echarts.min.js）
- 完整率、唯一率直接 SQL 查询计算
- 及时率依赖 `integration_sync_log` 时间戳对比
- 消费一致率依赖外部系统回调上报（模块 D）

**涉及文件：**
- `server/routes/quality.js` — KPI 查询
- `public/index.html` — 新增 Tab「数据质量」

---

### 模块 F：黄金源确认进度追踪

**对应文档阶段：** 黄金源说明矩阵（文档 §16）

**当前状态：** `field_identities` 表有 `confirmed` 布尔字段，但缺少进度聚合视图。

**拓展方向：**
- 按数据域（组织人员、物料、设备、工装等）分组统计确认进度
- 标记"可原则确认 / 需供应商确认 / 需部门预沟通"三种状态
- 新增 `/api/field-identities/progress` 端点

**不新增表** — 在 `field_identities` 增加 `confirm_status` 字段。

---

## 三、实施路线图

```
Week 1-2  │ 模块 A：主数据实体注册中心（6 张表 + CRUD + 编码引擎 + Excel 导入）
Week 3-4  │ 模块 B：生命周期引擎（状态机 + 多级会签审批）
Week 5    │ 模块 C：细粒度权限（4W+1H RBAC 升级）
Week 6-7  │ 模块 D：系统集成接口层（API Key 认证 + 同步端点 + 新旧编码映射）
Week 8    │ 模块 E：数据质量仪表盘 + 模块 F：黄金源进度追踪
Week 9    │ 联调测试 + 文档更新
```

---

## 四、技术约束（与现有架构一致）

- 继续使用 Express.js + better-sqlite3，不引入新框架
- 前端保持单文件 `public/index.html` + ECharts，不引入构建工具
- 新增路由遵循现有模式：`express.Router()` + `requireAuth` + `handleDbError`
- 数据库迁移沿用 `db.js` 内的 inline migration 模式
- 集成接口认证新建独立中间件，不修改现有 session 体系

---

## 五、新增文件清单

```
mdm-platform/
├── server/
│   ├── db.js                          # [修改] 新增约 12 张表
│   ├── auth.js                        # [修改] 增加 requireDataPermission
│   ├── access.js                      # [修改] 增加 masterDataVisibility
│   ├── integrationAuth.js             # [新增] API Key 认证
│   └── routes/
│       ├── masterData.js              # [新增] 主数据 CRUD + 编码 + 导入
│       ├── masterDataLifecycle.js     # [新增] 生命周期 + 审批
│       ├── integration.js             # [新增] 外部集成接口
│       └── quality.js                 # [新增] 数据质量 KPI
├── public/
│   └── index.html                     # [修改] 新增 3 个 Tab
└── scripts/
    ├── smoke-master-data.js           # [新增] 主数据模块冒烟测试
    └── smoke-integration.js           # [新增] 集成接口冒烟测试
```
