# MDM 平台设计

> 编制日期：2026-05-11
> 定位：MDM 底座 V1 数据收集与评审工具，独立部署
> 适用范围：各部门报送人、信息化项目组（汇总审核）
> 最终输出：Excel 导出字段台账 + 黄金源矩阵 + 术语冲突台账，接 Infomat 暂不考虑

---

## 一、系统定位与形态

- **形态**：独立 Web 应用（HTML + Express.js + SQLite）
- **部署**：独立端口 3000，前端直连后端 API
- **用户**：各部门报送人、部门负责人、数据 owner、信息化项目组
- **V1 自建用户体系**，不接 OA、不接 MDM 组织主数据

---

## 二、视觉风格

- 参照 `docs/Demo/信息化系统应用与集成说明会.html` 的 CSS 视觉语言
- 主色：深蓝 `#0f2a5e`，强调蓝 `#1a56db`
- 卡片式布局，表格 hover 高亮
- 顶部 Tab 导航（`.tb` / `.tb.on`）
- 冲突分级色：红色（阻塞）/ 橙色（warn 挂起）/ 绿色（通过）
- **动画**：页面切换淡入、卡片 hover 上浮、提交成功 toast 弹出、冲突项闪烁高亮、待办到期脉冲提醒、甘特图节点脉冲

---

## 三、技术架构

```
mdm-platform/
├── server/
│   ├── index.js              # Express 入口，端口 3000
│   ├── db.js                 # SQLite 初始化，建表语句
│   ├── auth.js               # 最小认证：会话 + 密码哈希
│   └── routes/
│       ├── org.js            # 组织架构（部门/人员/岗位）CRUD
│       ├── systems.js         # 系统列表 CRUD
│       ├── capabilities.js    # 业务能力 CRUD
│       ├── mappings.js        # 映射 CRUD + 审批流
│       ├── fieldEntries.js    # 字段台账 CRUD
│       ├── fieldIdentities.js # 字段身份 + 黄金源确认
│       ├── todos.js           # 跨部门待办
│       ├── conflicts.js       # 冲突管理 + 冲突生成规则
│       ├── terminology.js     # 术语词典 CRUD + 审核流
│       ├── versions.js        # 版本记录查询
│       └── export.js          # Excel 导出
├── public/
│   ├── index.html            # 主界面（单文件 HTML）
│   └── template.xlsx         # Excel 导入模板
└── data/
    └── platform.db          # SQLite 数据文件
```

**依赖**：`express`, `better-sqlite3`, `exceljs`, `express-session`, `bcryptjs`

---

## 四、数据模型

### 4.1 组织架构

```sql
departments {
  id, name, code,
  parent_id,           -- 上级部门，NULL 表示根部门
  manager_user_id,     -- 部门负责人（用户ID）
  created_at
}

users {
  id, name, employee_no,
  department_id,       -- 主属部门
  post,                -- 岗位
  role: 'submitter|owner|reviewer|admin',
  password_hash,       -- bcrypt 哈希，不存储明文
  created_at
}

-- 用户-部门职责映射（一人多部门兼职场景）
user_dept_roles {
  user_id, department_id, role, is_primary
}
```

### 4.2 业务能力与流程

```sql
capabilities {
  id, name,
  level,               -- L1/L2/L3
  owner_dept_id,
  created_at
}

processes {
  id, name,
  capability_id,
  owner_dept_id,
  created_at
}

systems {
  id, name, dept_id
}
```

### 4.3 映射与审批流

#### mapping_related_departments（跨部门关联）

```sql
mapping_related_departments {
  id, mapping_id, department_id, relation: 'owner|consumer|collaborator'
}
```

#### mapping_systems（映射涉及系统）

```sql
mapping_systems {
  id, mapping_id, system_id,
  system_role: 'primary|secondary',  -- 主系统/辅系统
  sort_order                 -- 导入/导出时保持表单填写顺序，主系统 sort_order=1
}
```

#### mappings（主表）

```sql
mappings {
  id,
  process_id,
  description,           -- 流程描述（表单 C 列）
  approval_dept_id,     -- 审批部门（表单 L 列）
  -- owner_dept_id 从 processes.owner_dept_id 冗余而来，审批流节点计算用
  owner_dept_id,
  status: 'draft|submitted|dept_reviewed|cross_confirmed|fields_confirmed|final_reviewed|published',
  submitted_by, submitted_at,
  current_step,
  created_at, updated_at
}
```

#### approval_tasks（审批任务，记录每个节点的审核状态）

```sql
approval_tasks {
  id, mapping_id,
  step: 1|2|3|4|5,
  step_name,            -- 节点名称
  assignee_user_id,     -- 当前指派人
  assigned_dept_id,     -- 当前指派部门
  status: 'pending|in_progress|approved|rejected|blocked',
  opinion,              -- 审核意见
  reject_count: 0,      -- 被驳回次数
  operated_by, operated_at,
  created_at
}
```

#### approval_history（审批历史，全量留痕）

```sql
approval_history {
  id, mapping_id,
  step,
  operator_user_id,
  action: 'submit|approve|reject|auto_conflict',
  opinion,
  created_at
}
```

**审批节点定义**：

| step | 节点名称 | assignee 计算规则 |
|-----|---------|----------------|
| 1 | 提交 | submitted_by 用户 |
| 2 | 部门内审 | mappings.owner_dept_id（冗余自 processes.owner_dept_id）的 manager_user_id |
| 3 | 跨部门确认 | mapping_related_departments 中所有关联部门的 manager_user_id（并行） |
| 4 | 字段台账确认 | 优先派给 field_identities.owner_user_id；为空时派给 maintain_dept_id 对应部门下 role='owner' 的用户（并行） |
| 5 | 信息化项目组终审 | role='admin' 的所有用户 |

**驳回规则**：驳回后 step=1，reject_count +1，报送人修改后重新提交。

**冲突拦截规则**（见 4.7 冲突生成规则）：step=3 时检查 field_conflicts，若存在未解决的 severity=error 冲突，则该 approval_task.status='blocked'，阻止进入 step=4。

### 4.4 字段台账

```sql
field_entries {
  id, mapping_id,
  field_name_cn, field_name_en,
  data_object, field_type,
  -- consume_systems 用 JSON 数组存储，导出时展开为逗号分隔文本
  consume_systems: '["ERP","MES"]',  -- JSON 数组
  sync_mode,
  note,
  status: 'draft|submitted|confirmed|conflicted',
  submitted_by, submitted_at,
  created_at, updated_at
}
```

**字段说明**：
- `field_type`：文本/编码/日期/枚举/附件/JSON（6 种枚举值）
- `consume_systems`：JSON 数组格式，导入/导出时与逗号分隔文本互转
- `approval_dept_id`：存储在 mappings 上

### 4.5 字段身份与黄金源确认

```sql
field_identities {
  id, field_entry_id,
  candidate_systems: '["ERP","MES","PLM"]',  -- 候选系统（JSON 数组）
  authoritative_system,   -- 权威系统（从候选系统中确认一个）
  maintain_dept_id,      -- 维护部门（部门ID）
  -- owner_user_id：直接指明该字段的数据 owner，避免跨表查找
  owner_user_id,
  confirmed: bool,
  confirmed_by, confirmed_at,
  note
}
```

**确认规则**：
- `authoritative_system` 确认后写入本字段，不回写 field_entries（field_entries 只读引用 field_identities）
- `confirmed=true` 时该字段计入"黄金源已明确"
- 一个 field_entry 对应一个 field_identity（1:1）

### 4.6 术语词典

```sql
terms {
  id, term, definition, scope, forbidden,
  status: 'pending|approved|rejected',
  created_by, created_at,
  approved_by, approved_at
}
```

---

### 4.7 冲突管理

#### term_conflicts

```sql
term_conflicts {
  id, term,
  dept_a, dept_a_meaning,
  dept_b, dept_b_meaning,
  severity: 'warn|error',
  status: 'pending|resolved|rejected',
  resolution, resolved_by, resolved_at,
  created_at
}
```

#### field_conflicts（双向记录）

```sql
field_conflicts {
  id,
  field_entry_a_id,      -- 冲突字段 A（来自部门 A 的填写记录）
  field_entry_b_id,      -- 冲突字段 B（来自部门 B 的填写记录）
  conflict_field: 'authoritative_system|note|field_type|sync_mode|consume_systems|other',
  submitter_a, value_a,
  submitter_b, value_b,
  dept_a, dept_b,
  severity: 'warn|error',
  status: 'pending|resolved|rejected',
  resolution, resolved_by, resolved_at,
  created_at
}
```

#### 冲突生成规则（可执行定义）

**V1 实现方式**：由用户在冲突管理台手工创建，或在"冲突检测"按钮触发后由系统自动生成。

**V1.1 增强**：提交时自动触发检测。

**字段冲突自动触发条件**：

1. **同名字段归并**：当两个 field_entry 同时满足以下条件时自动创建 field_conflicts：
   - `field_name_cn` 完全相同（精确匹配）
   - `field_name_en` 完全相同（精确匹配）
   - 来自不同部门（通过 submitter_a/dept_a 和 submitter_b/dept_b 判断）
   - 对同一个 `conflict_field` 计算出的 `value_a` ≠ `value_b`

2. **severity 判定规则**：
   - `error`：`conflict_field='authoritative_system'` 且两个 field_identity 确认了不同的权威系统 → 阻塞审批流
   - `warn`：`conflict_field='note'` 等非阻塞字段不一致 → 挂起但继续流转
   - `field_type`、`sync_mode`、`consume_systems` 默认按 warn 处理；信息化项目组可手工提升为 error

3. **解决后回写**：
   - 单条冲突 resolved 后，按 `mapping_id` 重新统计未解决的 `severity='error'` 冲突
   - 只有该 mapping 的未解决 error 数为 0 时，对应的 approval_task.status 才由 'blocked' 回退到 'in_progress'
   - resolved 时按 `conflict_field` 将被采纳的值同步回写到对应 field_identity 或 field_entries

**术语冲突**：由用户在冲突管理台手工创建，severity 由创建人判断。

### 4.8 跨部门待办

```sql
todos {
  id,
  from_dept_id, to_dept_id,
  type: 'field_confirm|gold_source|terminology|general',
  related_mapping_id, related_field_id,
  content,
  due_date,
  status: 'pending|done|overdue',
  created_at, done_at
}
```

### 4.9 版本记录

```sql
version_log {
  id, entity_type, entity_id,
  field_name, old_value, new_value,
  operation: 'create|update|delete',
  operated_by, operated_at,
  change_set_id
}

-- 变更集（批次回滚用）
change_set {
  id, entity_type, entity_id,
  operated_by, operated_at,
  description
}

version_log.change_set_id -> change_set.id
```

**回滚规则**：
- V1 暂不开放 UI 回滚功能，仅记录变更集
- 如需回滚，由管理员在数据库层面按 change_set 批量回写 old_value
- 多字段修改属于同一 change_set，回滚时必须同进同退

### 4.10 甘特图时间数据来源

**V1 不实现甘特图**，时间数据来源缺失问题后置。

甘特图所需时间字段（待 V1.1 补充）：
- `approval_tasks` 需新增 `planned_start`, `planned_end`, `actual_start`
- 或在 `mappings` 上新增 `deadline` 字段，由报送人或项目组填写

---

## 五、精细化表单模板

每张报送表单按列定义责任人 + 填写说明：

| 列 | 字段 | 责任人角色 | 填写说明 |
|---|-----|----------|---------|
| A | 业务能力 | 报送人 | 选择已有能力或新增，L2 能力需标注所属 L1 |
| B | 业务流程名称 | 报送人 | 动词+名词结构，如"编制MBOM"、"审批ECO" |
| C | 流程描述 | 报送人 | 1-2句话说明流程目的和起止 |
| D | 涉及应用系统 | 报送人 | 从系统列表选择，标注主/辅（主系统填第一格） |
| E | 涉及数据对象 | 报送人 | 如物料、BOM、工装、批次，可多选 |
| F | 对应字段（字段名） | 数据 owner | 如"物料编码"、"工艺规范版本"，按行填写 |
| G | 字段类型 | 数据 owner | 文本/编码/日期/枚举/附件，从下拉选 |
| H | 黄金源系统 | 数据 owner | 从候选系统中确认唯一权威源 |
| I | 维护部门 | 数据 owner | 从部门列表选择 |
| J | 消费系统 | 数据 owner | 从系统列表多选，导出时展开为多行 |
| K | 同步方式 | 数据 owner | 实时/批量/人工导入/事件触发，从下拉选 |
| L | 审批部门 | 报送人 | 从部门列表选择，关联该条映射的审批节点 |
| M | 字段说明/备注 | 报送人 | 口径、限制、示例、不确定项标注 |

**列权限联动**（由后端 API 控制，前端仅展示可编辑项）：

| 角色 | 可编辑列 |
|-----|---------|
| 报送人（submitter） | A、B、C、D、E、L、M |
| 数据 owner（owner） | F、G、H、I、J、K（收到待办后） |
| 部门负责人（reviewer） | A-M（审核时） |
| 信息化项目组（admin） | 全部列 |

---

## 六、功能模块（V1 范围）

> V1 聚焦"采集 + 审核 + 导出"闭环，甘特图、版本回滚、实时术语提示、复杂动画列入 V1.1。

### 6.1 统计看板

- 各部门提交流程数
- 待办数（含到期未完成数）
- 冲突数（error/warn 分级）
- 字段台账完成率
- 数据质量评分（各映射完整性 × 一致性 × 冲突率综合得分）
- ~~报送进度甘特图~~（→ V1.1）

### 6.2 数据报送

**表单录入**：
- 选择/新增业务能力（L2） → 新增业务流程（L3） → 关联应用系统（S1）（主/辅）→ 填写流程描述 → 关联审批部门 → 填写字段台账信息
- 列级权限由后端控制（用户角色决定可编辑列）

**Excel 批量导入**：
- 下载标准模板（表头含填写说明和示例）
- 批量上传，格式校验后预览确认
- 冲突字段（格式错误/必填缺失）自动标红提示

### 6.3 审批流

- 提交 → 部门内审 → 跨部门确认（并行）→ 字段台账确认（并行）→ 终审
- **驳回**：填写意见，报送人修改后重新提交，reject_count +1
- **error 冲突拦截**：step=3 检查到未解决的 field_conflicts.severity=error，该节点置 blocked，阻止进入 step=4
- **warn 冲突挂起**：记录但不拦截，继续流转到终审台统一处理
- 每节点审核记录写入 approval_history（审核人、时间、意见）
- approval_tasks 全链路可查当前节点状态

### 6.4 跨部门待办

- 给任意部门创建待办（字段确认/黄金源确认/术语确认/一般事项）
- 待办推送到对应部门看板
- 到期前脉冲提醒，超期标红

### 6.5 冲突管理台

- 术语冲突台账 + 字段冲突台账（severity 分级展示）
- 驳回补正或标记挂起
- 冲突解决后按 mapping 重新计算未解决 error 数；归零后自动恢复 approval_tasks 状态
- **冲突检测**：V1 手工触发（按钮），V1.1 增强为提交时自动检测

### 6.6 汇总审核台（信息化项目组视角）

- 全量映射列表 + 状态筛选
- 每条映射关联 mapping_systems + 字段台账 + field_identities（黄金源确认状态）
- 可直接编辑任意字段
- 一键终审发布（发布后 status='published'，导出可用）

### 6.7 术语词典

- 管理员维护术语表（术语名、定义、适用场景、禁用场景）
- ~~报送人填写时实时提示~~（→ V1.1，V1 仅手工查阅）
- 新增术语需 admin 审批后生效
- 术语审核流程：新增 → pending → approved/rejected

### 6.8 冲突对比视图

- 当 field_conflicts 被触发时，界面并排展示 field_entry_a_id 和 field_entry_b_id 的原填写内容
- 按 conflict_field 展示本次冲突字段，value_a/value_b 只表示该字段的双方取值
- 差异高亮，填写说明和示例同步展示
- 仲裁后一键采纳某方填写或强制覆盖
- 解决结果写入 field_conflicts.resolution

### 6.9 ~~报送进度甘特图~~（→ V1.1）

### 6.10 版本记录 / 变更溯源

- 每条映射和字段记录全量修改历史（写入 version_log + change_set）
- 每条记录显示"已修订 N 次"，点击展开修改历史时间线
- ~~UI 回滚功能暂不开放~~（→ V1.1，变更集记录已完备）

### 6.11 导出

- 一键导出 Excel：字段台账 + field_identities（黄金源矩阵）+ 术语冲突台账
- mapping_systems 导出时按 sort_order 展开主/辅系统，主系统显示在第一位
- consume_systems 导出时从 JSON 数组展开为逗号分隔文本
- 导出格式与 MDM 方案中字段台账格式对齐

---

## 七、前置数据初始化

### 7.1 组织架构

- 管理员手工添加或 **Excel 模板批量导入**
- 数据：部门（编码/名称/上级部门/负责人）、人员（工号/姓名/部门/岗位）、角色
- **用户初始密码**：由管理员设置，首次登录后强制修改

### 7.2 系统列表

- 管理员维护应用系统基础数据

### 7.3 术语词典

- 信息化项目组初始化 V0.1（从 MDM 方案的优先治理术语导入）
- 持续追加审批

---

## 八、Spec 自检

- [x] mappings 新增 owner_dept_id（冗余自 processes.owner_dept_id），审批节点计算规则明确
- [x] 权威系统确认结果存于 field_identities.authoritative_system，不回写 field_entries
- [x] field_conflicts 使用 field_entry_a_id / field_entry_b_id 双向记录，仲裁回写准确
- [x] field_identities.maintain_dept_id + owner_user_id 明确，避免跨表查找歧义
- [x] V1 冲突检测为"手工触发"，V1.1 增强为"提交时自动"，策略无矛盾
- [x] 表单模板新增 L 列（审批部门）与 mappings.approval_dept_id 对应
- [x] mapping_systems 支持一条映射关联多个系统，system_role (primary/secondary) 与表单 D 列主/辅系统对应
- [x] field_conflicts 增加 conflict_field，value_a/value_b 回写目标明确
- [x] 冲突解除后按 mapping 重新统计未解决 error，避免仍有阻塞项时误恢复审批
