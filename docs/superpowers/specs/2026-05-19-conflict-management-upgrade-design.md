# MDM 冲突管理升级设计

## 目标

将冲突管理从"依赖人工指派 + 线下沟通"升级为"自动路由 + 系统内闭环"，消除线下协调环节。

三个核心痛点：
1. 冲突检测到但无人推动解决
2. warn 级低价值冲突消耗同等注意力
3. 协调过程缺少时间约束，可无限搁置

## 数据模型变更

### field_conflicts 表新增字段

```sql
ALTER TABLE field_conflicts ADD COLUMN deadline DATE;
ALTER TABLE field_conflicts ADD COLUMN escalated INTEGER DEFAULT 0;
ALTER TABLE field_conflicts ADD COLUMN resolution_type TEXT;
```

### term_conflicts 表同样新增

```sql
ALTER TABLE term_conflicts ADD COLUMN deadline DATE;
ALTER TABLE term_conflicts ADD COLUMN escalated INTEGER DEFAULT 0;
ALTER TABLE term_conflicts ADD COLUMN resolution_type TEXT;
```

### 状态值扩展

field_conflicts 和 term_conflicts 的 status CHECK 约束统一为：

```
('pending','silenced','coordinating','escalated','resolved','rejected','archived')
```

新增三个状态：
- `silenced` — warn 级冲突自动归入，不触发待办，不在主动冲突列表中展示
- `coordinating` — error 级冲突进入双方协调
- `escalated` — 超时未解决，自动升级到 reviewer

### 冲突等级映射（不变更 severity 值）

| conflict_field | severity | 路由 |
|---|---|---|
| authoritative_system | error | 自动双指派 + 限时协调 |
| field_type, sync_mode | warn | 静默 |
| note, consume_systems | warn | 静默 |
| term name conflict | error | 自动双指派 + 限时协调 |
| term definition差异 | warn | 静默 |

## 自动化流程

### 检测分流 (POST /detect)

```
检测到冲突 → 判断 severity
  ├── warn  → status='silenced', resolution_type='auto_silenced'
  │           不创建 conflict_assignments
  │           不创建 todos
  └── error → status='coordinating', 执行自动双指派
```

### 自动双指派

1. 解析 dept_a 和 dept_b
2. 查找各方 data_owner_user_id（优先）或 manager_user_id（回退）作为指派对象
3. conflict_assignments 插入两条记录，assigned_by = 0（系统指派）
4. 计算 deadline = today + 3个工作日
5. todos 创建两条待办，分别指向双方部门

### 协调提交增强 (POST /:id/coordination)

- 双方各自提交立场（result: A / B / compromise，note: 论据）
- 提交后检查双方是否均已提交：
  - 双方结果一致 → 状态推进到终裁等待
  - 双方立场对立 → 保持 coordinating，等待截止时间或 reviewer 介入

### 超时升级

两个触发点：
1. **查询时实时判断** — GET /conflicts 和 GET /conflicts/:id 在返回时检查 `deadline < today AND status='coordinating'`，满足条件则执行：status='escalated', escalated=1，推送待办给 reviewer
2. **手动脚本** — `node scripts/check-escalations.js`，可挂 cron

## API 变更

### 修改的端点

| 端点 | 变更 |
|------|------|
| POST /detect | 检测后按 severity 分流：warn→silenced，error→自动双指派+创建待办+设deadline |
| GET / | 返回增加 deadline, escalated, resolution_type；查询时实时判断超时升级 |
| GET /:id | 增加双方立场对比数据；查询时实时判断超时升级 |
| POST /:id/coordination | 提交后检查双方是否均已提交，判断是否可推进终裁 |
| POST /:id/final-decide | 终裁后解除关联 mapping 审批流的 blocked 状态 |

### 新增端点

| 端点 | 说明 |
|------|------|
| GET /stats | 冲突统计：按 status+severity 分组计数 |
| POST /:id/escalate | 手动提前升级（reviewer/admin 权限） |

### 废弃（保留但不推荐使用）

| 端点 | 原因 |
|------|------|
| POST /:id/assign | error 冲突改为自动指派 |
| PUT /:id/assign | 改派改为通过 escalate 后 reviewer 重新分配 |

## 前端变更

所有文案使用中文。

### 冲突列表拆分

| 标签 | 内容 | 可见范围 |
|------|------|----------|
| 待协调 | status=coordinating/escalated | 全部用户 |
| 静默归档 | status=silenced | 管理员 |

待协调列表每行显示：双方部门、冲突字段、严重程度、截止日期、当前状态、双方提交状态。

### 冲突详情增强

- **双方立场并排区** — 左 A 部门论据，右 B 部门论据。未提交方显示"待提交（截止：YYYY-MM-DD）"
- **操作区** — 当前用户为被指派人→显示"提交立场"表单；双方均已提交且当前用户为 reviewer→显示"终裁"按钮
- **时间线** — 检测→指派→A方提交→B方提交→升级→终裁，按时间倒序

### 仪表盘冲突概览卡片

```
冲突概览
├── 待协调: N 条（已升级: M 条）
├── 静默: K 条
└── 本月已解决: J 条
```

点击数字跳转到对应筛选后的冲突列表。

## 边界与约束

- 不新增 npm 依赖
- 不新增路由文件，所有改动在 server/routes/conflicts.js 内完成
- 前端保持在 public/index.html 单文件内
- 超时升级的"3个工作日"暂为固定值，后续可改为系统配置项
- 本升级不包含 Agent/LLM 调用，纯规则驱动
